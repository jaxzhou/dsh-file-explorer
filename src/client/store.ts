/**
 * The file explorer's view state: what each listed directory holds, which
 * directories are open, and what the preview is showing.
 *
 * The explorer is not one resource. A directory listing per level, expanded
 * lazily, plus one preview read for the selected file, is state the view owns —
 * so it lives in a Slot-standard exclusive store: the framework mints one
 * instance per Session, and the state survives switching to Chat or Trajectory
 * and back, which unmounts the component.
 *
 * Write actions run only after `start`; the store's keys are absolute paths,
 * because a child is its parent joined with the entry name and the host accepts
 * the absolute form for both listing and reading.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'

/** One directory's contents, as one expanded level of the tree. */
export interface DirLevel {
  /** The directory's entries, in the endpoint's order. */
  readonly entries: readonly WorkspaceDirectoryEntry[]
  /** The listing hit the endpoint's entry cap, so entries are missing. */
  readonly truncated: boolean
}

/** What one directory level is doing right now. */
export type LevelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly level: DirLevel }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }

/** One page of text, as the preview keeps it. */
export interface PreviewText {
  /** The page's lines joined with `\n`. */
  readonly text: string
  /** How many lines the page holds. */
  readonly lines: number
  /** Whether the page includes the file's last line. */
  readonly eof: boolean
  /** Byte size of the complete file, when the backend reports it. */
  readonly bytes: number | undefined
}

/** Complete image bytes, addressed as a URL the browser can draw directly. */
export interface PreviewImage {
  /** `data:` URL carrying the file's complete bytes under its media type. */
  readonly dataUrl: string
  /** Byte size of the complete file, when the backend reports it. */
  readonly bytes: number | undefined
}

/**
 * What one read delivered. The pane decides which arm it needs from the file's
 * name before reading, so the two never mix: a page of text for everything
 * readable as text, complete bytes for an image.
 */
export type PreviewContent =
  | { readonly kind: 'text'; readonly page: PreviewText }
  | { readonly kind: 'image'; readonly image: PreviewImage }

/**
 * Which body the pane draws for a file that has more than one. `null` leaves
 * the choice to the format's own default; selecting a file resets it there, so
 * a mode picked for one file never leaks into the next.
 */
export type PreviewMode = 'rendered' | 'source'

/** What the preview is showing right now. */
export type PreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly path: string }
  | { readonly kind: 'ready'; readonly path: string; readonly content: PreviewContent }
  | { readonly kind: 'failed'; readonly path: string; readonly failure: RemoteFailure }

/** The explorer's whole state for one Session. */
export interface FilesState {
  /** Absolute path of the workspace root this explorer is rooted at; `null` before it is known. */
  root: string | null
  /** Level state by absolute directory path; a path absent here was never asked for. */
  levels: Record<string, LevelState>
  /** Expanded absolute directory paths, root included, in expansion order. */
  expanded: string[]
  /** Absolute path of the file the preview is about, or `null`. */
  selected: string | null
  /** Preview state for `selected`. */
  preview: PreviewState
  /** Whether the preview wraps long lines instead of scrolling sideways. */
  wrap: boolean
  /** Explicit body choice for a two-body file; `null` follows the format's default. */
  mode: PreviewMode | null
}

/** The explorer store's write set. */
type FilesActions = {
  /** Seed the explorer at its workspace root, with the root expanded. */
  start: (draft: FilesState, root: string) => void
  /** Mark one directory as being listed. */
  loading: (draft: FilesState, path: string) => void
  /** Record one directory's contents. */
  loaded: (draft: FilesState, path: string, level: DirLevel) => void
  /** Record why one directory could not be listed. */
  failed: (draft: FilesState, path: string, failure: RemoteFailure) => void
  /** Open a collapsed directory, or collapse an open one. */
  toggled: (draft: FilesState, path: string) => void
  /** Drop every listed level, keeping what is expanded: the reload gesture's first half. */
  reset: (draft: FilesState) => void
  /** Select one file and mark its preview as being read. */
  selecting: (draft: FilesState, path: string) => void
  /** Record the selected file's contents. */
  previewLoaded: (draft: FilesState, path: string, content: PreviewContent) => void
  /** Record why the selected file could not be read. */
  previewFailed: (draft: FilesState, path: string, failure: RemoteFailure) => void
  /** Drop the preview, keeping nothing selected. */
  clearPreview: (draft: FilesState) => void
  /** Choose whether the preview wraps long lines. */
  setWrap: (draft: FilesState, wrap: boolean) => void
  /** Choose which body a two-body file shows. */
  setMode: (draft: FilesState, mode: PreviewMode) => void
}

/** The state a freshly created explorer starts from. */
function emptyState(): FilesState {
  return {
    root: null,
    levels: {},
    expanded: [],
    selected: null,
    preview: { kind: 'idle' },
    wrap: true,
    mode: null,
  }
}

/**
 * Declare the explorer's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per Session and disposes
 * it with that Session's binding.
 * @returns the store handle to declare on the registration.
 */
export function createFilesStore(): EngineStoreHandle<FilesState, FilesActions> {
  return defineStore({
    init: emptyState,
    actions: {
      start: (d, root) => {
        d.root = root
        d.levels = {}
        d.expanded = [root]
        d.selected = null
        d.preview = { kind: 'idle' }
      },
      loading: (d, path) => {
        d.levels[path] = { kind: 'loading' }
      },
      loaded: (d, path, level) => {
        d.levels[path] = { kind: 'ready', level }
      },
      failed: (d, path, failure) => {
        d.levels[path] = { kind: 'failed', failure }
      },
      toggled: (d, path) => {
        const at = d.expanded.indexOf(path)
        if (at >= 0) d.expanded.splice(at, 1)
        else d.expanded.push(path)
      },
      reset: (d) => {
        d.levels = {}
      },
      selecting: (d, path) => {
        d.selected = path
        d.preview = { kind: 'loading', path }
        // A body choice belongs to the file it was made for.
        d.mode = null
      },
      previewLoaded: (d, path, content) => {
        // A settlement for a file the reader already left writes nothing: the
        // store keys the preview by the selected path, not by arrival order.
        if (d.selected !== path) return
        d.preview = { kind: 'ready', path, content }
      },
      previewFailed: (d, path, failure) => {
        if (d.selected !== path) return
        d.preview = { kind: 'failed', path, failure }
      },
      clearPreview: (d) => {
        d.selected = null
        d.preview = { kind: 'idle' }
      },
      setWrap: (d, wrap) => {
        d.wrap = wrap
      },
      setMode: (d, mode) => {
        d.mode = mode
      },
    },
  })
}
