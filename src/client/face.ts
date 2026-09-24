/**
 * The explorer's asynchronous half: listing directories, and reading whichever
 * file a tab asks for in the form its format needs.
 *
 * The component never awaits anything. It calls `list` / `read`, and this face
 * performs the Remote call and writes the outcome through the store's own
 * actions — the Slot-standard `inject` shape, so the Session id is resolved by
 * the framework and the write set stays the store's.
 *
 * One level has one listing in force: asking for a level again (the reload
 * gesture, a directory reopened after a reset) retires the listing still in
 * flight for it, whose settlement then writes nothing. Each tab has one read in
 * force in the same way, and the store additionally drops a settlement for a tab
 * that has since been closed. Requests carry the plugin's lifetime signal:
 * unloading the plugin abandons everything in flight, and no settlement writes
 * after that.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { bytesOfBase64, openSink, receiveFile } from './download.ts'
import { previewFormatFor, readsAllBytes } from './format.ts'
import { MAX_ASSET_BYTES } from './markdown-assets.ts'
import type { DownloadOutcome, PreviewText, createFilesStore } from './store.ts'

/** The slice of the Client Remote face this plugin calls. */
export type WorkspaceFilesRemote = Pick<ClientRemote, 'workspaceFiles'>

/**
 * Largest number of leading lines one text preview asks for. The host's own
 * `maxLines` default is higher; keeping the page small is this viewer's choice,
 * and a file that does not reach `eof` says so in the header.
 */
export const PREVIEW_LINES = 2000

/** The explorer's injected business face, as the component receives it. */
export interface FilesInjected {
  /**
   * List one directory into the store, retiring any listing in flight for it.
   * @param path - absolute directory path.
   */
  readonly list: (path: string) => void
  /**
   * Read one open tab into the store: a page of text, or the file's complete
   * bytes when its format draws an image, a PDF, or an Office document.
   * @param path - absolute file path of an open tab.
   */
  readonly read: (path: string) => void
  /**
   * Read one image for a document that references it, as a URL the renderer can
   * draw. Answers nothing for a path that is not an image, for one the host
   * cannot read, or for one past {@link MAX_ASSET_BYTES} — an unresolved
   * reference stays inert, which is what the primitive already does with one.
   * @param path - absolute file path.
   * @param signal - the requesting document's lifetime; aborting abandons the read.
   */
  readonly readImage: (path: string, signal: AbortSignal) => Promise<string | undefined>
  /**
   * Read one text asset an export needs to stand alone, such as a stylesheet a
   * document links to.
   * @param path - absolute file path.
   * @param signal - the requesting document's lifetime; aborting abandons the read.
   */
  readonly readText: (path: string, signal: AbortSignal) => Promise<string | undefined>
  /**
   * Save one file to the reader's downloads — the file itself, not a conversion
   * of it, so this is the one control that works for every kind of file.
   *
   * Returns as soon as the transfer has been started: its progress and its
   * outcome are the store's, because several downloads run at once and each
   * needs its own row rather than the tool button that began it.
   * @param path - absolute file path.
   * @param name - the file's name, which becomes the download's name.
   */
  readonly download: (path: string, name: string) => void
  /**
   * Abandon one download that is still running, discarding what it has written.
   * @param id - the download task's id, as the store records it.
   */
  readonly cancelDownload: (id: string) => void
}

/**
 * Distinguishes one download from the next, across every face this module hands
 * out.
 */
let nextDownloadId = 0

/**
 * The transfers in flight, by task id.
 *
 * Module scope rather than the face's, because a face is minted with its view:
 * leaving the Files tab and coming back would otherwise leave a download running
 * with nothing left that can cancel it, which is the one state a cancel control
 * exists to prevent.
 */
const transfers = new Map<string, AbortController>()

/**
 * Bind the explorer's face to one Session's Remote namespace.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @param sessionId - the Session whose workspace root authorizes every call.
 * @param signal - the plugin's lifetime signal; aborting abandons in-flight work.
 * @param actions - the bound store actions this face writes through.
 * @returns the listing and preview operations the component calls.
 */
export function filesFace(
  remote: WorkspaceFilesRemote,
  sessionId: SessionId,
  signal: AbortSignal,
  actions: BoundActions<ReturnType<typeof createFilesStore>>,
): FilesInjected {
  /** Per absolute path: the listing generation a settlement must match; the latest request wins. */
  const listingGenerations = new Map<string, number>()
  /** Per open tab: the read generation a settlement must match; the latest request wins. */
  const readGenerations = new Map<string, number>()

  return {
    list(path) {
      if (signal.aborted) return
      const generation = (listingGenerations.get(path) ?? 0) + 1
      listingGenerations.set(path, generation)
      actions.loading(path)
      void remote.workspaceFiles.list(sessionId, path, signal).then((result) => {
        if (signal.aborted || listingGenerations.get(path) !== generation) return
        if (result.ok) {
          actions.loaded(path, {
            entries: result.value.entries,
            truncated: result.value.truncated,
          })
        } else {
          actions.failed(path, result.error)
        }
      })
    },
    read(path) {
      if (signal.aborted) return
      const generation = (readGenerations.get(path) ?? 0) + 1
      readGenerations.set(path, generation)
      const format = previewFormatFor(path)
      actions.reading(path)
      const settle = (write: () => void): void => {
        if (signal.aborted || readGenerations.get(path) !== generation) return
        write()
      }
      // A picture and a document need their bytes whole; everything else needs a
      // page of lines, because the source view can show a bounded prefix of any
      // text file.
      if (format.kind === 'image') {
        void remote.workspaceFiles.readAll(sessionId, path, signal).then((result) => {
          settle(() => {
            if (result.ok) {
              actions.previewLoaded(path, {
                kind: 'image',
                image: {
                  dataUrl: `data:${format.mediaType};base64,${result.value.data}`,
                  bytes: result.value.bytes,
                },
              })
            } else {
              actions.previewFailed(path, result.error)
            }
          })
        })
        return
      }
      // A PDF and an Office package are drawn from the file itself, so the read
      // is the whole file — bounded by the deployment's complete-read cap, whose
      // refusal reaches the pane as any other read failure does.
      if (readsAllBytes(format)) {
        void remote.workspaceFiles.readAll(sessionId, path, signal).then((result) => {
          settle(() => {
            if (result.ok) {
              actions.previewLoaded(path, {
                kind: 'file',
                file: {
                  data: result.value.data,
                  mediaType: format.mediaType ?? 'application/octet-stream',
                  bytes: result.value.bytes,
                },
              })
            } else {
              actions.previewFailed(path, result.error)
            }
          })
        })
        return
      }
      void remote.workspaceFiles.read(sessionId, path, { offset: 1, limit: PREVIEW_LINES }, signal)
        .then((result) => {
          settle(() => {
            if (result.ok) {
              const page: PreviewText = {
                text: result.value.text,
                lines: result.value.lines,
                eof: result.value.eof,
                bytes: result.value.bytes,
              }
              actions.previewLoaded(path, { kind: 'text', page })
            } else {
              actions.previewFailed(path, result.error)
            }
          })
        })
    },
    readImage(path, request) {
      // The plugin's own lifetime ends every read with it, even one a document is
      // still waiting for.
      if (signal.aborted || request.aborted) return Promise.resolve(undefined)
      const format = previewFormatFor(path)
      if (format.kind !== 'image') return Promise.resolve(undefined)
      return remote.workspaceFiles.readAll(sessionId, path, request).then((result) => {
        if (!result.ok || request.aborted) return undefined
        const { bytes, data } = result.value
        if (bytes !== undefined && bytes > MAX_ASSET_BYTES) return undefined
        return `data:${format.mediaType};base64,${data}`
      })
    },
    readText(path, request) {
      if (signal.aborted || request.aborted) return Promise.resolve(undefined)
      return remote.workspaceFiles.readAll(sessionId, path, request).then((result) => {
        if (!result.ok || request.aborted) return undefined
        const { bytes, data } = result.value
        if (bytes !== undefined && bytes > MAX_ASSET_BYTES) return undefined
        const binary = atob(data)
        const raw = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index++) raw[index] = binary.charCodeAt(index)
        return new TextDecoder().decode(raw)
      })
    },
    download(path, name) {
      const id = `download-${nextDownloadId++}`
      const controller = new AbortController()
      transfers.set(id, controller)
      const mediaType = previewFormatFor(path).mediaType ?? 'application/octet-stream'
      const settle = (state: DownloadOutcome): void => { actions.downloadSettled(id, state) }
      actions.downloadStarted({
        id, path, name, loaded: 0, total: undefined, state: { kind: 'running' },
      })
      void (async () => {
        // The size comes first because it decides the sink: a file past the
        // collect limit is streamed into one the reader picks, and a smaller one
        // is handed over silently.
        const stat = await remote.workspaceFiles.stat(sessionId, path, controller.signal)
        if (!stat.ok) {
          settle({ kind: 'failed', failure: { kind: 'remote', failure: stat.error } })
          return
        }
        const size = stat.value.bytes
        const choice = await openSink(name, size, mediaType)
        if (choice.kind === 'cancelled') {
          settle({ kind: 'cancelled' })
          return
        }
        if (choice.kind === 'failed') {
          settle({ kind: 'failed', failure: choice.failure })
          return
        }
        const result = await receiveFile({
          size,
          sink: choice.sink,
          signal: controller.signal,
          readWindow: async (offset, length) => {
            const window = await remote.workspaceFiles.readBytes(
              sessionId, path, { offset, length }, controller.signal,
            )
            return window.ok
              ? { ok: true, data: bytesOfBase64(window.value.data), eof: window.value.eof }
              : { ok: false, failure: window.error }
          },
          onProgress: (loaded, total) => { actions.downloadProgress(id, loaded, total) },
        })
        settle(
          result.kind === 'done'
            ? { kind: 'done' }
            : result.kind === 'cancelled' ? { kind: 'cancelled' } : result,
        )
      })()
        .catch((error: unknown) => {
          // An abort reaches here when it landed before the first window: that is
          // a cancellation, not a failure.
          settle(controller.signal.aborted
            ? { kind: 'cancelled' }
            : {
              kind: 'failed',
              failure: { kind: 'local', message: error instanceof Error ? error.message : String(error) },
            })
        })
        .finally(() => { transfers.delete(id) })
    },
    cancelDownload(id) {
      transfers.get(id)?.abort()
    },
  }
}
