/**
 * The file explorer's view state: what each listed directory holds, which
 * directories are open, which files are open in preview tabs, and what each tab
 * is showing.
 *
 * The explorer is not one resource. A directory listing per level, expanded
 * lazily, plus one read per open preview tab, is state the view owns — so it
 * lives in a Slot-standard exclusive store: the framework mints one instance per
 * Session, and the state survives switching to Chat or Trajectory and back, which
 * unmounts the component.
 *
 * Write actions run only after `start`; the store's keys are absolute paths,
 * because a child is its parent joined with the entry name and the host accepts
 * the absolute form for both listing and reading.
 *
 * Tabs are unbounded but loaded content is not: an image preview holds the
 * file's complete bytes as a base64 data URL, so keeping every tab's content
 * alive would let a reader grow the tab's memory to an arbitrary size. The store
 * therefore retains content for the active tab and the most recently visited
 * ones, and drops the rest — the tab stays open and simply reads again when it
 * is next activated. See {@link RETAINED_PREVIEWS}.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'

/**
 * How many tabs keep their loaded content. A dropped tab is still open: it reads
 * again when activated, which shows as a brief loading state.
 *
 * Five covers the working set — the tab being read, plus the few it was reached
 * through — while bounding what a reader who opens everything in a directory can
 * pin in memory.
 */
export const RETAINED_PREVIEWS = 5

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

/** One page of text, as a preview keeps it. */
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
 * What one read delivered. A tab decides which arm it needs from the file's name
 * before reading, so the two never mix: a page of text for everything readable
 * as text, complete bytes for an image.
 */
export type PreviewContent =
  | { readonly kind: 'text'; readonly page: PreviewText }
  | { readonly kind: 'image'; readonly image: PreviewImage }

/**
 * Which body a tab draws for a file that has more than one. An absent entry
 * leaves the choice to the format's own default, so a mode picked for one file
 * never leaks into another.
 */
export type PreviewMode = 'rendered' | 'source'

/** What one tab is showing right now. */
export type PreviewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly content: PreviewContent }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }

/** The explorer's whole state for one Session. */
export interface FilesState {
  /** Absolute path of the workspace root this explorer is rooted at; `null` before it is known. */
  root: string | null
  /** Level state by absolute directory path; a path absent here was never asked for. */
  levels: Record<string, LevelState>
  /** Expanded absolute directory paths, root included, in expansion order. */
  expanded: string[]
  /** Open preview tabs by absolute path, in open order. */
  open: string[]
  /** The tab being shown, or `null` when nothing is open. */
  active: string | null
  /** Loaded content by absolute path; a path absent here was never read or has been dropped. */
  previews: Record<string, PreviewState>
  /** Absolute paths whose content is retained, most recently used first. */
  retained: string[]
  /** Body choice by absolute path; an absent entry follows the format's default. */
  modes: Record<string, PreviewMode>
  /** Line-wrap preference by absolute path; an absent entry wraps. */
  wraps: Record<string, boolean>
}

/** The explorer store's write set. */
type FilesActions = {
  /** Seed the explorer at its workspace root, with the root expanded and no tabs. */
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
  /** Open a file in a tab and show it; an already-open file is focused, not duplicated. */
  openFile: (draft: FilesState, path: string) => void
  /** Show an open tab, keeping its position in the strip. */
  activate: (draft: FilesState, path: string) => void
  /** Close a tab, showing its right neighbour, else its left, else nothing. */
  closeFile: (draft: FilesState, path: string) => void
  /** Mark one tab as being read. */
  reading: (draft: FilesState, path: string) => void
  /** Record one tab's contents. */
  previewLoaded: (draft: FilesState, path: string, content: PreviewContent) => void
  /** Record why one file could not be read. */
  previewFailed: (draft: FilesState, path: string, failure: RemoteFailure) => void
  /** Forget one tab's loaded content, leaving the tab open. */
  dropPreview: (draft: FilesState, path: string) => void
  /** Choose whether one tab wraps long lines. */
  setWrap: (draft: FilesState, path: string, wrap: boolean) => void
  /** Choose which body one tab shows. */
  setMode: (draft: FilesState, path: string, mode: PreviewMode) => void
}

/** The state a freshly created explorer starts from. */
function emptyState(): FilesState {
  return {
    root: null,
    levels: {},
    expanded: [],
    open: [],
    active: null,
    previews: {},
    retained: [],
    modes: {},
    wraps: {},
  }
}

/**
 * Record one path as most recently used, and drop the content of tabs that fell
 * past the retention cap. The active tab is always kept, so nothing the reader is
 * looking at is ever dropped.
 * @param d - draft state.
 * @param path - the path whose content was just loaded, or is being shown.
 */
function retain(d: FilesState, path: string): void {
  d.retained = [path, ...d.retained.filter(candidate => candidate !== path)]
  const keep = new Set([...(d.active === null ? [] : [d.active]), ...d.retained.slice(0, RETAINED_PREVIEWS)])
  for (const candidate of Object.keys(d.previews)) {
    if (!keep.has(candidate)) delete d.previews[candidate]
  }
  d.retained = d.retained.filter(candidate => keep.has(candidate))
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
        Object.assign(d, emptyState())
        d.root = root
        d.expanded = [root]
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
      openFile: (d, path) => {
        if (!d.open.includes(path)) d.open.push(path)
        d.active = path
      },
      activate: (d, path) => {
        if (!d.open.includes(path)) return
        d.active = path
        // Showing a retained tab makes it the most recently used one, so the tab
        // the reader just came from is the first candidate for eviction.
        retain(d, path)
      },
      closeFile: (d, path) => {
        const at = d.open.indexOf(path)
        if (at < 0) return
        d.open.splice(at, 1)
        delete d.previews[path]
        delete d.modes[path]
        delete d.wraps[path]
        d.retained = d.retained.filter(candidate => candidate !== path)
        if (d.active !== path) return
        // The neighbour that takes over: the tab that slid into this slot, else
        // the one before it, matching how editors close.
        d.active = d.open[at] ?? d.open[at - 1] ?? null
      },
      reading: (d, path) => {
        if (!d.open.includes(path)) return
        d.previews[path] = { kind: 'loading' }
      },
      previewLoaded: (d, path, content) => {
        // A settlement for a tab the reader already closed writes nothing: the
        // store keys content by path, not by arrival order.
        if (!d.open.includes(path)) return
        d.previews[path] = { kind: 'ready', content }
        retain(d, path)
      },
      previewFailed: (d, path, failure) => {
        if (!d.open.includes(path)) return
        d.previews[path] = { kind: 'failed', failure }
      },
      dropPreview: (d, path) => {
        delete d.previews[path]
        d.retained = d.retained.filter(candidate => candidate !== path)
      },
      setWrap: (d, path, wrap) => {
        d.wraps[path] = wrap
      },
      setMode: (d, path, mode) => {
        d.modes[path] = mode
      },
    },
  })
}
