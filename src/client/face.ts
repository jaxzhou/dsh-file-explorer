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
import { previewFormatFor } from './format.ts'
import type { PreviewText, createFilesStore } from './store.ts'

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
   * Read one open tab into the store: a page of text, or complete bytes when the
   * file's format draws an image.
   * @param path - absolute file path of an open tab.
   */
  readonly read: (path: string) => void
}

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
      // An image needs its bytes whole; everything else needs a page of lines,
      // because the source view can show a bounded prefix of any text file.
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
  }
}
