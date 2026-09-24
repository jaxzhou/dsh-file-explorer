/**
 * Saving a workspace file to the reader's own disk.
 *
 * A download cannot be one Remote call. The Host caps a **complete** read, and a
 * file worth downloading is usually well past that cap — a release tarball is
 * hundreds of megabytes — so the file can only be had a window at a time.
 * `readBytes` is that window, and a window is not subject to the complete-file
 * cap, which is what lets this module save a file of any size.
 *
 * Two sinks, because two sizes want different things:
 *
 * - A file up to {@link SILENT_DOWNLOAD_LIMIT} is collected and handed to the
 *   browser as one Blob — the silent download the reader already expects, with
 *   no dialog.
 * - A larger one is streamed into a file the reader picks, one window at a time.
 *   The memory this costs stays flat however big the file is, which is the whole
 *   point: collecting a 260 MiB download first would hold all of it.
 *
 * Neither sink is required for the transfer loop to be testable — the loop takes
 * a window reader and a sink, and the tests give it both.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { downloadBlob } from './export/index.ts'

/** Why a download could not be finished. */
export type DownloadFailure =
  | { readonly kind: 'remote'; readonly failure: RemoteFailure }
  | { readonly kind: 'local'; readonly message: string }

/** One byte window read back, or the Remote failure that refused it. */
export type WindowResult =
  | { readonly ok: true; readonly data: Uint8Array; readonly eof: boolean }
  | { readonly ok: false; readonly failure: RemoteFailure }

/**
 * The largest file saved without asking where to put it.
 *
 * It sits at the same order as the complete read the previews use: a file small
 * enough to hold in the page is small enough to hand over in one piece, and a
 * file past that is one worth streaming instead.
 */
export const SILENT_DOWNLOAD_LIMIT = 32 * 1024 * 1024

/**
 * Bytes one Remote window asks for.
 *
 * A deployment caps a window with `maxBytes`, and this module cannot read that
 * number; asking for the shipped default and halving on a refusal is what keeps
 * a download working under a stricter one.
 */
export const READ_WINDOW_BYTES = 2 * 1024 * 1024

/** The smallest window this module falls back to before giving up. */
export const MIN_READ_WINDOW_BYTES = 64 * 1024

/** Where a download's bytes go as they arrive. */
export interface DownloadSink {
  /** Whether the bytes are going straight into a file the reader chose. */
  readonly streaming: boolean
  /**
   * Take one window's bytes.
   * @param chunk - the bytes.
   */
  write: (chunk: Uint8Array) => Promise<void>
  /** Keep what was written. */
  finish: () => Promise<void>
  /** Throw away what was written, because the transfer failed or was abandoned. */
  discard: () => Promise<void>
}

/**
 * Decode one base64 payload, which is how every byte window arrives.
 *
 * Not routed through a `data:` URL: a window is two megabytes and a download is
 * a hundred of them, so building a URL only to take it apart again would copy
 * the whole file twice over for nothing.
 * @param data - the base64 text.
 * @returns its bytes.
 */
export function bytesOfBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** The File System Access entry points this module uses, which the DOM types do not carry. */
interface SavePicker {
  showSaveFilePicker?: (options: { suggestedName?: string }) => Promise<{
    createWritable: () => Promise<{
      write: (chunk: Uint8Array) => Promise<void>
      close: () => Promise<void>
      abort: () => Promise<void>
    }>
  }>
}

/**
 * Whether one download should stream into a file rather than be collected.
 * @param size - the file's size, when the backend reports one.
 * @param canStream - whether this browser can write a file the reader picks.
 * @returns whether to ask for a file and stream into it.
 */
export function prefersStreamingSink(size: number | undefined, canStream: boolean): boolean {
  return canStream && size !== undefined && size > SILENT_DOWNLOAD_LIMIT
}

/**
 * Whether a rejection is the reader dismissing a dialog.
 * @param error - what was thrown.
 * @returns whether it means "the reader said no".
 */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * A sink that collects the file and hands it to the browser in one piece.
 * @param name - the file's name.
 * @param mediaType - the type its bytes carry.
 * @returns the sink.
 */
function collectedSink(name: string, mediaType: string): DownloadSink {
  const parts: BlobPart[] = []
  return {
    streaming: false,
    write: async (chunk) => { parts.push(chunk) },
    finish: async () => { downloadBlob(new Blob(parts, { type: mediaType }), name) },
    discard: async () => { parts.length = 0 },
  }
}

/** What the save dialog answered. */
export type SinkChoice =
  | { readonly kind: 'sink'; readonly sink: DownloadSink }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly failure: DownloadFailure }

/**
 * Choose where one download's bytes go.
 *
 * The save dialog is only in the way for a file that is worth streaming, and
 * only when the browser can stream at all. Anything else about it failing — a
 * gesture that expired while the file was being measured, a policy — leaves the
 * download possible, so the bytes are collected instead of the reader being told
 * no twice.
 * @param name - the file's name.
 * @param size - the file's size, when the backend reports one.
 * @param mediaType - the type its bytes carry.
 * @returns the sink, the reader's refusal, or why neither could be had.
 */
export async function openSink(
  name: string,
  size: number | undefined,
  mediaType: string,
): Promise<SinkChoice> {
  const picker = (globalThis as unknown as SavePicker).showSaveFilePicker
  if (prefersStreamingSink(size, typeof picker === 'function')) {
    try {
      const handle = await (picker as NonNullable<SavePicker['showSaveFilePicker']>)({ suggestedName: name })
      const writable = await handle.createWritable()
      return {
        kind: 'sink',
        sink: {
          streaming: true,
          write: async (chunk) => { await writable.write(chunk) },
          finish: async () => { await writable.close() },
          discard: async () => { await writable.abort() },
        },
      }
    } catch (error) {
      if (isAbort(error)) return { kind: 'cancelled' }
    }
  }
  return { kind: 'sink', sink: collectedSink(name, mediaType) }
}

/** What one transfer did. */
export type ReceiveResult =
  | { readonly kind: 'done'; readonly bytes: number }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly failure: DownloadFailure }

/** What one transfer needs. */
export interface ReceiveOptions {
  /** The file's size in bytes, when the backend reports one. */
  readonly size: number | undefined
  /**
   * Read one window. A refusal is reported rather than thrown, because one
   * refusal is answerable — see the loop below.
   * @param offset - first byte of the window.
   * @param length - how many bytes to ask for.
   */
  readonly readWindow: (offset: number, length: number) => Promise<WindowResult>
  /** Where the bytes go. */
  readonly sink: DownloadSink
  /**
   * Called after each window with what has arrived.
   * @param loaded - bytes received so far.
   * @param total - the file's size, when it is known.
   */
  readonly onProgress?: (loaded: number, total: number | undefined) => void
  /** Abandons the transfer between windows. */
  readonly signal: AbortSignal
}

/**
 * Read a whole file a window at a time, into a sink.
 * @param options - the window reader, the sink, and the transfer's lifetime.
 * @returns what the transfer did.
 */
export async function receiveFile(options: ReceiveOptions): Promise<ReceiveResult> {
  const { size, sink, onProgress, signal } = options
  let window = READ_WINDOW_BYTES
  let offset = 0
  try {
    for (;;) {
      if (signal.aborted) {
        await sink.discard()
        return { kind: 'cancelled' }
      }
      const result = await options.readWindow(offset, window)
      if (!result.ok) {
        // A deployment may cap a window below what this module asks for. Halving
        // is what turns a refusal into a slower download rather than a limit the
        // reader can do nothing about.
        if (result.failure.code === 'workspace-file/too-large' && window > MIN_READ_WINDOW_BYTES) {
          window = Math.max(MIN_READ_WINDOW_BYTES, Math.floor(window / 2))
          continue
        }
        await sink.discard()
        return { kind: 'failed', failure: { kind: 'remote', failure: result.failure } }
      }
      if (result.data.length === 0) {
        // Nothing arrived and the Host did not claim the end: reading on would
        // ask for the same window for ever.
        if (result.eof) break
        await sink.discard()
        return { kind: 'failed', failure: { kind: 'local', message: 'the file ended without saying so' } }
      }
      await sink.write(result.data)
      offset += result.data.length
      onProgress?.(offset, size)
      if (result.eof) break
    }
    await sink.finish()
    return { kind: 'done', bytes: offset }
  } catch (error) {
    // A sink that refused mid-write leaves a partial file; discarding it is what
    // keeps a failed download from looking like a complete one.
    await sink.discard().catch(() => undefined)
    return {
      kind: 'failed',
      failure: { kind: 'local', message: error instanceof Error ? error.message : String(error) },
    }
  }
}
