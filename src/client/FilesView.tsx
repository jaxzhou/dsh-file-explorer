/**
 * The Files Conversation View: the session workspace on the left, one preview
 * tab per opened file on the right.
 *
 * The view is one `conversation.view` entry, so it sits beside Chat and
 * Trajectory in the same tab strip and the shell renders it one at a time.
 * Everything the tree keeps lives in its store; everything it asks for goes
 * through its injected face. The component only decides what to draw for each
 * absolute path and what a click means: a directory toggles, a file opens a
 * preview tab (or focuses the one already open for it), and anything else is
 * shown but refuses to open.
 *
 * A tab's body follows the file's format (see `format.ts`): Markdown renders as a
 * document with a source view behind a toggle, JSON as a collapsible tree with
 * the same toggle, a recognized source suffix through the shared
 * syntax-highlighted code block, an image as the image, and everything else as
 * plain numbered text. All of it comes from
 * `@deepseek-ai/dsh-client-ui-primitives`, which the browser shell shares into its
 * frozen module table — the one way this bundle may use another package's values
 * at runtime.
 *
 * Switching to another tab unmounts this component but not its Session-scoped
 * store, so the tree, the open tabs, and the active tab survive the round trip. A
 * read left in flight when that happens settles into the store anyway, because
 * the face's requests ride the plugin's lifetime, not the component's.
 */
import {
  useEffect, useMemo, useRef, useState,
  type ComponentType, type MutableRefObject, type ReactNode,
} from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import {
  CodeBlock, FileTypeIcon, JsonTree, MarkdownText, Menu, classifyFileType, fileSizeText,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { shellIcon } from './shell.ts'
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import { canExportPdf, hasSourceToggle, officeKindOf, previewFormatFor } from './format.ts'
import { exportDocument, type ExportFormat } from './export/index.ts'
import { LegacyOfficePanel, OfficePreview, PdfPreview } from './DocumentPreview.tsx'
import type { PreviewFormat } from './format.ts'
import type { FilesInjected } from './face.ts'
import { relativeImageDestinations, resolveRelativePath } from './markdown-assets.ts'
import type { DownloadFailure } from './download.ts'
import {
  findMermaidFences, mermaidDestination, mermaidErrorMessage, renderMermaidPng,
  replaceMermaidFences,
} from './mermaid.ts'
import type {
  DownloadTask, FilesState, LevelState, PreviewContent, PreviewMode, PreviewState, PreviewText,
  createFilesStore,
} from './store.ts'
import type {} from './locales.ts'

/** The view's composed props: the Conversation View seat, its store, its face, and its copy. */
export type FilesViewProps =
  & ConvViewProps
  & PropsStore<ReturnType<typeof createFilesStore>>
  & InjectFace<FilesInjected>
  & PropsLocale<'fileExplorer'>

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The pane's glyphs, by the base name the shell's icon set spells either way.
 *
 * Harness 0.2.0 renamed every glyph from a size suffix to a weight suffix, and a
 * plugin is loaded into whichever shell the reader runs — so each entry names the
 * glyph once and {@link shellIcon} resolves it under either spelling. A glyph the
 * running shell does not have comes back undefined, which is what {@link Glyph}
 * is for: nothing is drawn, and the pane still works.
 */
const ICON = {
  browse: shellIcon('IconBrowseOutline'),
  check: shellIcon('IconCheckOutline'),
  close: shellIcon('IconCloseOutline'),
  code: shellIcon('IconCodeOutline'),
  copy: shellIcon('IconCopyOutline'),
  download: shellIcon('IconDownloadOutline'),
  folderClosed: shellIcon('IconFolderClose'),
  folderOpen: shellIcon('IconFolderOpen'),
  panelLeft: shellIcon('IconPanelLeftOutline', 'IconPanelLeft'),
  refresh: shellIcon('IconRefreshOutline'),
  wrap: shellIcon('IconRightUpOutline'),
  stop: shellIcon('IconStopFill'),
}

/**
 * One glyph, or nothing at all when this shell has neither of its names.
 *
 * Rendering an undefined component is not a missing icon: React throws on it and
 * takes the whole pane down with it, which is what a renamed glyph used to do.
 * @param props - the glyph, and the size to draw it at.
 * @returns the glyph.
 */
function Glyph({ of, size, className }: {
  of: ComponentType<IconProps> | undefined
  size?: number
  className?: string
}): ReactNode {
  if (of === undefined) return null
  const Icon = of
  return <Icon size={size} className={className} />
}

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * The absolute path of one child entry.
 *
 * Joined with `/` whatever the parent's separators: the host resolves mixed
 * separators, and the tree only needs a stable key.
 * @param parent - absolute path of the listed directory.
 * @param name - the entry's basename.
 * @returns the child's absolute path.
 */
export function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/**
 * Split a path into its directory prefix and its last segment, for a header
 * that greys the prefix and inks the name.
 * @param path - absolute path.
 * @returns the trailing-slash directory prefix and the basename.
 */
export function pathParts(path: string): { directory: string; name: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (at < 0) return { directory: '', name: path }
  return { directory: path.slice(0, at + 1), name: path.slice(at + 1) }
}

/**
 * The display label of every open tab.
 *
 * A tab shows its basename, which is what a strip can afford. Two open files
 * that share a basename are ambiguous on their own — `index.ts` in three
 * directories is the ordinary case — so those tabs carry their parent directory
 * as a prefix, and only those. The full path stays in each tab's tooltip.
 * @param open - open tab paths, in strip order.
 * @returns a label per path.
 */
export function tabLabels(open: readonly string[]): Record<string, string> {
  const twins = new Map<string, number>()
  for (const path of open) {
    const { name } = pathParts(path)
    twins.set(name, (twins.get(name) ?? 0) + 1)
  }
  const labels: Record<string, string> = {}
  for (const path of open) {
    const { directory, name } = pathParts(path)
    if ((twins.get(name) ?? 0) < 2) {
      labels[path] = name
      continue
    }
    const parent = pathParts(directory.replace(/[/\\]+$/, '')).name
    labels[path] = parent === '' ? name : `${parent}/${name}`
  }
  return labels
}

/**
 * Split one loaded page into its source lines.
 *
 * The page's own line count decides: `0` is a page past the file's last line
 * (an empty file on the first read), which has no lines to draw and must not
 * become one empty row. Otherwise the text is the page's lines joined with
 * `\n`, so splitting returns exactly what `lines` promised.
 * @param page - the loaded text page.
 * @returns the page's source lines, in order.
 */
export function previewLines(page: PreviewText): string[] {
  return page.lines === 0 ? [] : page.text.split('\n')
}

/**
 * Parse one complete JSON document for the tree view.
 * @param text - the file's text.
 * @returns the parsed container, or undefined when the text is not JSON a tree
 * can walk (a syntax error, or a bare scalar).
 */
export function parseJsonDocument(text: string): object | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  return typeof value === 'object' && value !== null ? value : undefined
}

/**
 * Say why a directory could not be listed, in terms of the directory.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the directory.
 */
export function treeFailureLine(
  t: TranslateNS<'fileExplorer'>,
  failure: RemoteFailure,
): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('tree.error.notFound')
    case 'workspace-file/outside-workspace': return t('tree.error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('tree.error.notDirectory')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default: return t('tree.error.unavailable', { message: failure.message })
  }
}

/**
 * Say why a file could not be previewed, in terms of the file.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show in the preview pane.
 */
export function previewFailureLine(
  t: TranslateNS<'fileExplorer'>,
  failure: RemoteFailure,
): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('preview.error.notFound')
    case 'workspace-file/not-text': return t('preview.error.notText')
    case 'workspace-file/too-large': return t('preview.error.tooLarge')
    case 'workspace-file/not-regular-file': return t('preview.error.notRegularFile')
    default: return t('preview.error.unavailable', { message: failure.message })
  }
}

/** What every level shares: the explorer's state and the two gestures. */
interface TreeContext {
  readonly state: FilesState
  readonly open: ReadonlySet<string>
  readonly onToggle: (path: string) => void
  readonly onOpen: (path: string) => void
  readonly t: TranslateNS<'fileExplorer'>
}

/** One directory's rows: its state while listing, its entries once listed. */
function Level({ path, tree }: { path: string; tree: TreeContext }): ReactNode {
  const { state, t } = tree
  const level: LevelState | undefined = state.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <li className="dsh-fe-note" data-files-row="loading">{t('tree.loading')}</li>
  }
  if (level.kind === 'failed') {
    return (
      <li
        className="dsh-fe-note dsh-fe-note-error"
        data-files-row="failed"
        data-files-code={level.failure.code}
      >
        {treeFailureLine(t, level.failure)}
      </li>
    )
  }
  const entries = orderEntries(level.level.entries)
  return (
    <>
      {entries.length === 0 && <li className="dsh-fe-note" data-files-row="empty">{t('tree.empty')}</li>}
      {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} tree={tree} />)}
      {level.level.truncated && (
        <li className="dsh-fe-note" data-files-row="truncated">{t('tree.truncated')}</li>
      )}
    </>
  )
}

/** One entry's row, and its children when it is an expanded directory. */
function Entry({
  parent,
  entry,
  tree,
}: {
  parent: string
  entry: WorkspaceDirectoryEntry
  tree: TreeContext
}): ReactNode {
  const path = childPath(parent, entry.name)
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <li className="dsh-fe-item" data-files-entry="directory" data-files-path={path}>
        <button
          type="button"
          className="dsh-fe-row"
          aria-expanded={expanded}
          onClick={() => { tree.onToggle(path) }}
        >
          {expanded
            ? <Glyph of={ICON.folderOpen} className="dsh-fe-icon" />
            : <Glyph of={ICON.folderClosed} className="dsh-fe-icon" />}
          <span className="dsh-fe-name">{entry.name}</span>
        </button>
        {expanded && <ul className="dsh-fe-level"><Level path={path} tree={tree} /></ul>}
      </li>
    )
  }
  if (entry.type === 'file') {
    const isOpen = tree.open.has(path)
    return (
      <li
        className="dsh-fe-item"
        data-files-entry="file"
        data-files-path={path}
        data-files-open={isOpen || undefined}
      >
        <button
          type="button"
          className="dsh-fe-row"
          aria-current={tree.state.active === path}
          onClick={() => { tree.onOpen(path) }}
        >
          <FileTypeIcon kind={classifyFileType(entry.name)} size={16} />
          <span className="dsh-fe-name">{entry.name}</span>
          {isOpen && <span className="dsh-fe-open-dot" aria-hidden="true" />}
        </button>
      </li>
    )
  }
  return (
    <li className="dsh-fe-item" data-files-entry="other" data-files-path={path}>
      <span className="dsh-fe-row dsh-fe-row-static" title={tree.t('tree.other')}>
        <span className="dsh-fe-name">{entry.name}</span>
      </span>
    </li>
  )
}

/**
 * One file's source text through the shared syntax highlighter.
 *
 * `CodeBlock` owns the grammar lookup, the numbered gutter, and the copy
 * control; the owning class only replaces the chat card's chrome (margin,
 * radius, grey fill) with the pane's, and states the wrap preference: lines wrap
 * at their spaces and keep every word whole, and a token that cannot fit on a
 * line by itself still breaks rather than sliding under a scrollbar.
 */
function HighlightedSource({
  page,
  lang,
  wrap,
  t,
}: {
  page: PreviewText
  lang: string | undefined
  wrap: boolean
  t: TranslateNS<'fileExplorer'>
}): ReactNode {
  return (
    <div className="dsh-fe-source" data-wrap={wrap} data-preview-lang={lang ?? 'plain'}>
      <CodeBlock
        code={page.text}
        lang={lang}
        lineNumbers
        copyLabel={t('code.copy')}
        copiedLabel={t('code.copied')}
      />
    </div>
  )
}

/**
 * One HTML file drawn as a page, in a sandboxed iframe over a Blob URL.
 *
 * `allow-scripts` without `allow-same-origin` puts the document in an opaque
 * origin: its scripts run, but nothing in it can reach this application's DOM,
 * storage, or session. The same pair is what the shipped Sidebar document
 * preview uses, so the two HTML surfaces in the harness behave alike.
 *
 * Relative assets are not fetched — a Blob document has no base to resolve them
 * against, and packing them would mean reading the workspace beside the file.
 * See the README's limitations.
 */
function HtmlFrame({ html, title }: { html: string; title: string }): ReactNode {
  const url = useMemo(
    () => URL.createObjectURL(new Blob([html], { type: 'text/html' })),
    [html],
  )
  useEffect(() => () => { URL.revokeObjectURL(url) }, [url])
  return (
    <iframe
      className="dsh-fe-html-frame"
      src={url}
      sandbox="allow-scripts"
      title={title}
      data-preview-html
    />
  )
}

/**
 * The data URLs a rendered document already resolved, keyed by absolute path.
 *
 * Module scope rather than component state: switching tabs unmounts the pane, and
 * a document whose images were read once should not read them again. The cap keeps
 * the cache in the same spirit as the preview retention next door.
 */
const assetCache = new Map<string, string>()

/** Ceiling on {@link assetCache} entries; the oldest read is evicted first. */
const ASSET_CACHE_LIMIT = 64

/**
 * Remember one image's data URL, evicting the least recently loaded past the cap.
 * @param path - absolute file path.
 * @param dataUrl - the image, as a URL the renderer can draw.
 */
function cacheAsset(path: string, dataUrl: string): void {
  assetCache.delete(path)
  assetCache.set(path, dataUrl)
  while (assetCache.size > ASSET_CACHE_LIMIT) {
    const oldest = assetCache.keys().next().value
    if (oldest === undefined) break
    assetCache.delete(oldest)
  }
}

/** What one ```mermaid fence in the open document is doing right now. */
type DiagramState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'ready'; readonly dataUrl: string }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * A Markdown document with the images it references read from the workspace, and
 * its ```mermaid fences drawn as diagrams.
 *
 * The primitive resolves local destinations synchronously through `pathImages`,
 * so the reads and the drawings happen first and the document renders with
 * whatever arrived — a reference with no answer stays inert alt text, exactly as
 * it does for a destination this reader never resolves.
 *
 * A diagram is drawn to a PNG and handed to the primitive as an image, which is
 * what keeps the document one document: the fence is replaced by one image
 * reference, so tables, footnotes and list numbering around it are parsed
 * exactly as they were written. The same `<img>` is what the PDF rasteriser
 * draws and what the Word writer embeds, so an exported document carries the
 * diagram as a picture without either writer knowing mermaid exists.
 *
 * A diagram that cannot be drawn keeps its source: the failure is named in a
 * quote above the fence, because a preview that silently drops a diagram reads
 * as a document that had none.
 */
function RenderedMarkdown({
  text,
  directory,
  readImage,
  labels,
  proseRef,
  t,
}: {
  text: string
  /** Absolute directory holding the document, which its destinations resolve against. */
  directory: string
  readImage: FilesInjected['readImage']
  labels: MarkdownLabels
  proseRef: MutableRefObject<HTMLDivElement | null>
  t: TranslateNS<'fileExplorer'>
}): ReactNode {
  const destinations = useMemo(() => relativeImageDestinations(text), [text])
  const [assets, setAssets] = useState<Readonly<Record<string, string>>>({})
  const fences = useMemo(() => findMermaidFences(text), [text])
  const [diagrams, setDiagrams] = useState<readonly DiagramState[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const resolved: Record<string, string> = {}
    const missing: { destination: string; path: string }[] = []
    for (const destination of destinations) {
      const path = resolveRelativePath(directory, destination)
      const cached = assetCache.get(path)
      if (cached === undefined) missing.push({ destination, path })
      else resolved[destination] = cached
    }
    setAssets(resolved)
    for (const { destination, path } of missing) {
      void readImage(path, controller.signal).then((dataUrl) => {
        if (dataUrl === undefined || controller.signal.aborted) return
        cacheAsset(path, dataUrl)
        setAssets(current => ({ ...current, [destination]: dataUrl }))
      })
    }
    return () => { controller.abort() }
  }, [destinations, directory, readImage])

  // Diagrams are drawn one at a time and each settlement reaches the document on
  // its own, so a long document shows its first diagram while the rest are still
  // being laid out.
  useEffect(() => {
    if (fences.length === 0) {
      setDiagrams([])
      return
    }
    const controller = new AbortController()
    const settle = (index: number, state: DiagramState): void => {
      if (controller.signal.aborted) return
      setDiagrams(current => current.map((existing, at) => (at === index ? state : existing)))
    }
    setDiagrams(fences.map((): DiagramState => ({ kind: 'pending' })))
    fences.forEach((fence, index) => {
      void renderMermaidPng(fence.code, controller.signal).then(
        dataUrl => { settle(index, { kind: 'ready', dataUrl }) },
        (error: unknown) => { settle(index, { kind: 'failed', message: mermaidErrorMessage(error) }) },
      )
    })
    return () => { controller.abort() }
  }, [fences])

  // The fences are replaced, not removed: everything the author wrote around one
  // survives, and a failed diagram keeps its own source underneath the failure.
  const rewritten = useMemo(() => replaceMermaidFences(text, fences, (fence, index) => {
    const state = diagrams[index]
    if (state?.kind === 'ready') return `![${t('mermaid.label')}](${mermaidDestination(index)})`
    if (state?.kind === 'failed') {
      return `> ${t('mermaid.failed', { message: state.message })}\n\n${fence.source}`
    }
    return `![${t('mermaid.loading')}](${mermaidDestination(index)})`
  }), [text, fences, diagrams, t])

  // Which placeholder destination belongs to which diagram. A document cannot
  // name one of these itself without colliding, which is the point of the
  // reserved prefix.
  const diagramAt = useMemo(
    () => new Map(fences.map((_, index) => [mermaidDestination(index), index] as const)),
    [fences],
  )

  // One identity per settled set: a fresh object each render would discard the
  // primitive's parse memo.
  const pathImages = useMemo(
    () => ({
      resolve: (value: string) => {
        const index = diagramAt.get(value)
        if (index === undefined) return assets[value]
        const state = diagrams[index]
        // A diagram still being drawn resolves to nothing, which is the
        // primitive's own "inert" arm: the reader sees the placeholder label
        // until the drawing lands.
        return state?.kind === 'ready' ? state.dataUrl : undefined
      },
    }),
    [assets, diagramAt, diagrams],
  )
  return (
    <div className="dsh-fe-prose" ref={proseRef} data-preview-format="markdown">
      <MarkdownText text={rewritten} labels={labels} pathImages={pathImages} />
    </div>
  )
}

/**
 * A Markdown file as a document, a JSON file as a collapsible tree, and an HTML
 * file as a page.
 *
 * The label objects are memoized on the translated strings rather than on `t`:
 * the bound translate keeps one identity across a locale change while its output
 * changes, and a fresh labels object on every render would discard the
 * primitives' parse memos.
 */
function FormattedBody({
  page,
  format,
  directory,
  jsonDocument,
  readImage,
  proseRef,
  t,
}: {
  page: PreviewText
  format: PreviewFormat
  /** Absolute directory holding the file, which its relative destinations resolve against. */
  directory: string
  /** Parsed JSON for a `json` format, decided by the pane before it elected this body. */
  jsonDocument: object | undefined
  readImage: FilesInjected['readImage']
  /** The rendered Markdown document, which the PDF export clones. */
  proseRef: MutableRefObject<HTMLDivElement | null>
  t: TranslateNS<'fileExplorer'>
}): ReactNode {
  const copyLabel = t('code.copy')
  const copiedLabel = t('code.copied')
  const footnotes = t('footnotes')
  const markdownLabels = useMemo<MarkdownLabels>(
    () => ({ code: { copyLabel, copiedLabel }, footnotes }),
    [copyLabel, copiedLabel, footnotes],
  )
  const copyValue = t('json.copyValue')
  const copyJson = t('json.copyJson')
  const copyPath = t('json.copyPath')
  const copyPrettyJson = t('json.copyPrettyJson')
  const copyCompactJson = t('json.copyCompactJson')
  const copied = t('json.copied')
  const copyFailed = t('json.copyFailed')
  const collapseNode = t('json.collapseNode')
  const expandNode = t('json.expandNode')
  const jsonLabels = useMemo<JsonTreeLabels>(() => ({
    copyValue,
    copyJson,
    copyPath,
    copyPrettyJson,
    copyCompactJson,
    copied,
    copyFailed,
    collapseNode,
    expandNode,
    // Reads the live translate at call time, so the tooltip follows a locale
    // change without rebuilding this object; `t` is stable by contract.
    copyButtonTitle: action => t('json.copyTitle', { action }),
  }), [
    collapseNode, copyCompactJson, copyFailed, copyJson, copyPath, copyPrettyJson,
    copyValue, copied, expandNode, t,
  ])

  if (format.kind === 'markdown') {
    return (
      <RenderedMarkdown
        text={page.text}
        directory={directory}
        readImage={readImage}
        labels={markdownLabels}
        proseRef={proseRef}
        t={t}
      />
    )
  }
  if (format.kind === 'html') {
    return (
      <div className="dsh-fe-html" data-preview-format="html">
        <HtmlFrame html={page.text} title={t('preview.htmlFrame')} />
      </div>
    )
  }
  // The pane elects this body for `json` only once the document parses.
  if (jsonDocument === undefined) return null
  return (
    <div className="dsh-fe-json" data-preview-format="json">
      <JsonTree
        data={jsonDocument}
        label={t('preview.jsonLabel')}
        labels={jsonLabels}
        expandTopLevel={false}
      />
    </div>
  )
}

/** Which body a tab is drawing, which is also which controls apply. */
type PreviewBodyKind = 'rendered' | 'source' | 'image' | 'pdf' | 'office' | 'legacy'

/**
 * Resolve the body a file's format and the tab's mode choice agree on.
 * @param content - what the read delivered, or null while it has not settled.
 * @param format - the file's format.
 * @param mode - the tab's explicit choice, or undefined to follow the default.
 * @param jsonWalkable - whether a `json` format's document parsed into a tree.
 * @returns the body kind.
 */
function bodyKindOf(
  content: PreviewContent | null,
  format: PreviewFormat,
  mode: PreviewMode | undefined,
  jsonWalkable: boolean,
): PreviewBodyKind {
  if (content !== null && content.kind === 'image') return 'image'
  // A format this pane refuses to draw says why, and says it before anything is
  // read: there is no failure to report, only a document it will not open.
  if (format.kind === 'legacyOffice') return 'legacy'
  if (content !== null && content.kind === 'file') return format.kind === 'pdf' ? 'pdf' : 'office'
  if (!hasSourceToggle(format)) return 'source'
  if ((mode ?? 'rendered') === 'source') return 'source'
  // JSON the tree cannot walk falls back to its source, so the controls offer the
  // body that is actually on screen.
  if (format.kind === 'json' && !jsonWalkable) return 'source'
  return 'rendered'
}

/**
 * The line of facts the pane's header shows about one settled read.
 * @param content - what the read delivered.
 * @param t - the pane's translate.
 * @returns the line, or null when the read reported nothing to say.
 */
function previewMeta(content: PreviewContent, t: TranslateNS<'fileExplorer'>): string | null {
  if (content.kind === 'text') {
    return [
      t('preview.lines', { lines: content.page.lines }),
      content.page.bytes === undefined ? null : fileSizeText(content.page.bytes),
    ].filter(part => part !== null).join(' · ')
  }
  const bytes = content.kind === 'image' ? content.image.size : content.file.size
  return bytes === undefined ? null : fileSizeText(bytes)
}

/**
 * Say why one download could not be finished.
 * @param t - namespace-bound translate.
 * @param failure - what the transfer reported.
 * @returns the line to show in the download's row.
 */
function downloadFailureLine(t: TranslateNS<'fileExplorer'>, failure: DownloadFailure): string {
  if (failure.kind === 'local') return t('download.failed', { message: failure.message })
  // A window the Host refused is the one Remote failure a download can be held
  // to; everything else reads as the preview's own failure lines do.
  return failure.failure.code === 'workspace-file/too-large'
    ? t('download.error.tooLarge')
    : previewFailureLine(t, failure.failure)
}

/**
 * What one download's row says about it.
 * @param task - the download.
 * @param t - namespace-bound translate.
 * @returns the line.
 */
function downloadStatus(task: DownloadTask, t: TranslateNS<'fileExplorer'>): string {
  switch (task.state.kind) {
    case 'running': {
      const loaded = fileSizeText(task.loaded)
      if (task.total === undefined || task.total === 0) return t('download.saving', { loaded })
      const percent = Math.min(100, Math.round((task.loaded / task.total) * 100))
      return t('download.progress', { percent, loaded, total: fileSizeText(task.total) })
    }
    case 'done': return t('download.done', { size: fileSizeText(task.loaded) })
    case 'cancelled': return t('download.cancelled')
    case 'failed': return downloadFailureLine(t, task.state.failure)
  }
}

/**
 * The body of one settled preview tab.
 * @param props - the tab's content, its format, the elected body, and copy.
 * @returns the scrollport holding that body.
 */
function PreviewBody({
  path,
  content,
  format,
  body,
  jsonDocument,
  jsonFallback,
  wrap,
  readImage,
  proseRef,
  t,
}: {
  path: string
  content: PreviewContent
  format: PreviewFormat
  body: PreviewBodyKind
  jsonDocument: object | undefined
  /** The reader asked for the tree and the file does not parse; say so above the source. */
  jsonFallback: boolean
  wrap: boolean
  readImage: FilesInjected['readImage']
  /** Handed to the rendered Markdown container, which the PDF export clones. */
  proseRef: MutableRefObject<HTMLDivElement | null>
  t: TranslateNS<'fileExplorer'>
}): ReactNode {
  if (content.kind === 'image') {
    const { name } = pathParts(path)
    return (
      <div className="dsh-fe-scroll dsh-fe-imagehost" data-preview-state="ready" data-preview-format="image">
        <img className="dsh-fe-image" src={content.image.dataUrl} alt={name} data-preview-image />
      </div>
    )
  }
  // A PDF and an Office package are drawn from the file itself; each body brings
  // its own scrollport, because a PDF fills the pane and a document has to.
  if (content.kind === 'file') {
    const { name } = pathParts(path)
    if (format.kind === 'pdf') return <PdfPreview file={content.file} name={name} t={t} />
    const kind = officeKindOf(format)
    return kind === undefined
      ? null
      : <OfficePreview key={path} kind={kind} file={content.file} t={t} />
  }
  const page = content.page
  const lines = previewLines(page)
  if (lines.length === 0) {
    return (
      <div
        className="dsh-fe-scroll"
        data-preview-state="ready"
        data-preview-format={format.kind}
        data-preview-lines="0"
      >
        <p className="dsh-fe-note" data-preview-row="empty">{t('preview.empty')}</p>
      </div>
    )
  }
  return (
    <div
      className="dsh-fe-scroll"
      data-preview-state="ready"
      data-preview-format={format.kind}
      data-preview-lines={lines.length}
      data-preview-body={body}
    >
      {jsonFallback && (
        <p className="dsh-fe-note dsh-fe-note-error" data-preview-row="invalid-json">
          {t('preview.jsonInvalid')}
        </p>
      )}
      {body === 'rendered'
        ? (
          <FormattedBody
            key={path}
            page={page}
            format={format}
            directory={pathParts(path).directory}
            jsonDocument={jsonDocument}
            readImage={readImage}
            proseRef={proseRef}
            t={t}
          />
        )
        : <HighlightedSource page={page} lang={format.lang} wrap={wrap} t={t} />}
      {!page.eof && (
        <p className="dsh-fe-note" data-preview-row="truncated">
          {t('preview.truncated', { lines: page.lines })}
        </p>
      )}
    </div>
  )
}

/**
 * The width below which the tree and the preview take turns rather than sitting
 * side by side.
 *
 * It is the same number the stylesheet's own breakpoint uses; the two are one
 * decision written twice, so they have to change together.
 */
const NARROW_PANE = '(max-width: 720px)'

/**
 * Whether the pane is too narrow for both panes at once.
 *
 * Read at the moment of a gesture rather than watched: nothing here re-renders
 * on a resize, and the only thing the answer decides is whether opening a file
 * is also the gesture that shows it.
 * @returns whether one pane is showing at a time.
 */
function isNarrowPane(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NARROW_PANE).matches
}

/**
 * Where a tab's context menu should open.
 *
 * A pointer reports where it was; a keyboard asking for the context menu
 * (Shift+F10, the menu key) reports nothing at all, so the tab's own lower-left
 * corner stands in for it and the menu opens where the reader is looking.
 * @param event - the `contextmenu` event.
 * @returns the viewport point to anchor the menu at.
 */
function menuPointOf(event: { clientX: number; clientY: number; currentTarget: Element }): {
  x: number
  y: number
} {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY }
  }
  const box = event.currentTarget.getBoundingClientRect()
  return { x: box.left, y: box.bottom }
}

/**
 * The Files view: the workspace tree, the open preview tabs, and the active tab.
 * @param props - the Conversation View seat, store, injected face, and copy.
 * @returns the two-pane explorer.
 */
export function FilesView({
  sessionId, useSessions, useStore, actions, list, read, readImage, readText, download,
  cancelDownload, t,
}: FilesViewProps): ReactNode {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store)
  const activeTabRef = useRef<HTMLButtonElement | null>(null)
  /** The rendered Markdown document, which the PDF export clones. */
  const proseRef = useRef<HTMLDivElement | null>(null)
  /** The tab whose text was just copied, so only its button confirms. */
  const [copied, setCopied] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Whether the export menu is showing. */
  const [exportOpen, setExportOpen] = useState(false)
  /** Whether an export is being written, so the control can say so. */
  const [exporting, setExporting] = useState(false)
  /** Why the last export could not be written. */
  const [exportError, setExportError] = useState<string | null>(null)
  /**
   * The tab the reader right-clicked, and where the pointer was, which is where
   * its menu opens. One menu serves the whole strip: a menu is about the tab it
   * was asked from, and two of them cannot be open at once anyway.
   */
  const [tabMenu, setTabMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  /** The tab the open menu was asked from, so the keyboard can go back to it. */
  const tabMenuTrigger = useRef<HTMLElement | null>(null)

  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  useEffect(() => {
    if (cwd === undefined || state.root === cwd) return
    actions.start(cwd)
    list(cwd)
  }, [actions, cwd, list, state.root])

  const active = state.active
  const treeOpen = state.treeOpen
  const format: PreviewFormat | null = active === null ? null : previewFormatFor(active)
  const content = active !== null && state.previews[active]?.kind === 'ready'
    ? (state.previews[active] as { content: PreviewContent }).content
    : null

  // A JSON document is parsed here, once per settled read, because both the
  // controls' body election and the tree body need the answer. Parsing stays a
  // function of the pane's own decision, not of the read: a file the tree cannot
  // walk is still previewed, as source.
  const jsonDocument = useMemo(() => {
    if (active === null || content === null || content.kind !== 'text') return undefined
    if ((state.modes[active] ?? 'rendered') === 'source') return undefined
    if (previewFormatFor(active).kind !== 'json') return undefined
    return parseJsonDocument(content.page.text)
  }, [active, content, state.modes])

  /**
   * Content follows the active tab, not the click that opened it: a tab whose
   * content was dropped for retention reads again the moment it is shown, and a
   * tab that is already loaded costs nothing.
   */
  useEffect(() => {
    if (active === null) return
    // A legacy binary document is never read: the pane says why it will not draw
    // it rather than reading bytes the host would refuse to decode as text.
    if (previewFormatFor(active).kind === 'legacyOffice') return
    if (state.previews[active] !== undefined) return
    read(active)
  }, [active, read, state.previews])

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  if (cwd === undefined) {
    return (
      <div className="dsh-fe-root" data-files-state="no-workspace">
        <div className="dsh-fe-status">{t('tree.noWorkspace')}</div>
      </div>
    )
  }
  if (state.root === null) return null

  const openSet = new Set(state.open)
  const tree: TreeContext = {
    state,
    open: openSet,
    onToggle: (path) => {
      const loaded = state.levels[path] !== undefined
      actions.toggled(path)
      if (!loaded) list(path)
    },
    // Opening a file on a pane that shows one pane at a time is also the gesture
    // that shows it — otherwise the reader taps a file and nothing appears to
    // happen.
    onOpen: (path) => {
      actions.openFile(path)
      if (isNarrowPane()) actions.setTree(false)
    },
    t,
  }
  // Reload drops every level and asks again for the expanded ones; a collapsed
  // level is fetched again the next time it opens.
  const reloadTree = (): void => {
    actions.reset()
    for (const path of state.expanded) list(path)
  }
  const reloadPreview = (): void => {
    if (active !== null) read(active)
  }
  // One copy control serves every body that has text: a rendered document's
  // source, a JSON tree's document, highlighted code, and plain text all copy
  // the file's own text, which is what a reader pastes somewhere else.
  const copyActive = (): void => {
    if (active === null || content === null || content.kind !== 'text') return
    const path = active
    const text = content.page.text
    void writeClipboard(text).then((ok: boolean) => {
      if (!ok) return
      setCopied(path)
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => { setCopied(null) }, 1000)
    })
  }
  /**
   * Save the active tab's file to the reader's downloads.
   *
   * The file itself, not a conversion of it — which makes this the one control
   * that works for every kind of file the tree can list, including the ones this
   * pane declines to draw. The transfer reports through the store rather than
   * through this component, because several of them can be running at once and
   * each needs its own row, its own progress, and its own way out.
   */
  const downloadActive = (): void => {
    if (active === null) return
    download(active, pathParts(active).name)
  }
  /**
   * Export the rendered body as a file, and download it.
   *
   * Markdown is read from the live document node, so the Word file and the PDF
   * pages carry exactly what the reader sees — including the code fences the
   * primitive highlighted and the images it loaded. An HTML document is read from
   * its own text, re-rendered off screen by the export, because the frame the
   * reader sees is sandboxed and unreadable from here by design.
   * @param target - the file to write.
   */
  const runExport = (target: ExportFormat): void => {
    if (active === null || format === null || content === null || content.kind !== 'text') return
    if (!canExportPdf(format)) return
    const name = pathParts(active).name
    setExportError(null)
    setExporting(true)
    void exportDocument(target, {
      name,
      title: name,
      kind: format.kind === 'html' ? 'html' : 'markdown',
      prose: proseRef.current,
      html: content.page.text,
      directory: pathParts(active).directory,
      assets: { readImage, readText },
    })
      .catch((error: unknown) => {
        // An export that cannot be written says so; a download that silently never
        // arrives is the one outcome a reader cannot diagnose.
        setExportError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { setExporting(false) })
  }
  const closeTab = (path: string): void => {
    // A tab's own menu has nothing left to act on once the tab is gone.
    setTabMenu(menu => (menu?.path === path ? null : menu))
    actions.closeFile(path)
  }
  /**
   * Dismiss the tab context menu.
   *
   * The rows unmount with it, which would leave the keyboard on the page body;
   * the tab the menu was asked from is where the reader was working, so it takes
   * the keyboard back — unless the menu is what closed it.
   */
  const releaseTabMenu = (): void => {
    const trigger = tabMenuTrigger.current
    tabMenuTrigger.current = null
    setTabMenu(null)
    if (trigger !== null && document.contains(trigger)) trigger.focus()
  }
  const root = pathParts(state.root)
  const labels = tabLabels(state.open)
  const wrap = active === null ? true : state.wraps[active] ?? true
  const preview: PreviewState | undefined = active === null ? undefined : state.previews[active]
  const body = bodyKindOf(content, format ?? { kind: 'text', lang: undefined, mediaType: undefined }, active === null ? undefined : state.modes[active], jsonDocument !== undefined)
  const jsonFallback = format?.kind === 'json'
    && (active === null ? 'rendered' : state.modes[active] ?? 'rendered') === 'rendered'
    && jsonDocument === undefined
    && content !== null
    && content.kind === 'text'
  // The menu's export rows need a rendered document — the body that has a page to
  // write — while its Download row needs only a file, which is why the menu
  // itself is offered for every tab.
  const canExport = body === 'rendered' && format !== null && canExportPdf(format)
    && content !== null && content.kind === 'text'
  const meta = content === null ? null : previewMeta(content, t)

  return (
    <div
      className="dsh-fe-root"
      data-files-state="tree"
      data-files-root={state.root}
      data-tree={treeOpen ? 'open' : 'closed'}
      data-conversation-composer-overlay=""
    >
      <div className="dsh-fe-panes">
        <div className="dsh-fe-tree" data-files-pane="tree">
          <div className="dsh-fe-head">
            <span className="dsh-fe-path" title={state.root}>
              <span>
                <span className="dsh-fe-path-muted">{root.directory}</span>
                {root.name}
              </span>
            </span>
            <button
              type="button"
              className="dsh-fe-tool"
              aria-label={t('tree.reload')}
              title={t('tree.reload')}
              data-files-reload
              onClick={reloadTree}
            >
              <Glyph of={ICON.refresh} />
            </button>
            <button
              type="button"
              className="dsh-fe-tool"
              aria-label={t('tree.collapse')}
              title={t('tree.collapse')}
              data-files-tree-toggle
              data-tree-action="collapse"
              onClick={() => { actions.setTree(false) }}
            >
              <Glyph of={ICON.panelLeft} />
            </button>
          </div>
          <div className="dsh-fe-scroll">
            <ul className="dsh-fe-level"><Level path={state.root} tree={tree} /></ul>
          </div>
        </div>
        <div className="dsh-fe-preview" data-files-pane="preview">
          <div className="dsh-fe-head dsh-fe-tabhead">
            {/* The tree's own toggle lives in the header of whichever pane is on
                the left, so the control that brings the file list back is always
                the one at the edge it would come from. */}
            {!treeOpen && (
              <button
                type="button"
                className="dsh-fe-tool"
                aria-label={t('tree.expand')}
                title={t('tree.expand')}
                data-files-tree-toggle
                data-tree-action="expand"
                onClick={() => { actions.setTree(true) }}
              >
                <Glyph of={ICON.panelLeft} />
              </button>
            )}
            {state.open.length === 0
              ? <span className="dsh-fe-path dsh-fe-path-muted">{t('preview.title')}</span>
              : (
                <div className="dsh-fe-tabs" role="tablist" aria-label={t('preview.tabs')} data-preview-tabs>
                  {state.open.map(path => {
                    const isActive = path === active
                    return (
                      <span
                        className="dsh-fe-tab"
                        key={path}
                        role="presentation"
                        data-preview-tab={path}
                        data-active={isActive || undefined}
                        onContextMenu={(event) => {
                          // The strip's own menu, not the browser's: this is the one
                          // place a reader can close every tab at once.
                          event.preventDefault()
                          tabMenuTrigger.current = event.currentTarget.querySelector('button')
                          setTabMenu({ path, ...menuPointOf(event) })
                        }}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          className="dsh-fe-tab-label"
                          title={path}
                          ref={isActive ? activeTabRef : undefined}
                          data-preview-tab-open={path}
                          onClick={() => { actions.activate(path) }}
                          onAuxClick={(event) => {
                            // Middle click closes, as it does in every editor.
                            if (event.button === 1) closeTab(path)
                          }}
                        >
                          <FileTypeIcon kind={classifyFileType(path)} size={14} />
                          <span className="dsh-fe-tab-name">{labels[path]}</span>
                        </button>
                        <button
                          type="button"
                          className="dsh-fe-tab-close"
                          aria-label={t('preview.close', { name: labels[path] })}
                          title={t('preview.close', { name: labels[path] })}
                          data-preview-tab-close={path}
                          onClick={() => { closeTab(path) }}
                        >
                          <Glyph of={ICON.close} size={12} />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            {tabMenu !== null && (
              <Menu
                open
                // Portalled for the same reason the export menu is: the strip
                // clips its own overflow, and a context menu must be able to hang
                // past the edge it was asked from.
                portal
                align="start"
                side="bottom"
                autoFocus
                className="dsh-fe-tabmenu"
                // The pointer is the anchor: an empty trigger is rendered because a
                // menu needs one, and its rect is answered from the gesture instead.
                anchor={<span />}
                getAnchorRect={() => new DOMRect(tabMenu.x, tabMenu.y, 0, 0)}
                items={[
                  { id: 'close', label: t('preview.closeTab') },
                  {
                    id: 'close-others',
                    label: t('preview.closeOthers'),
                    // With one tab open there is nothing else to close, and a row
                    // that would do nothing is better shown as unavailable.
                    disabled: state.open.length < 2,
                  },
                  { type: 'separator', id: 'close-separator' },
                  { id: 'close-all', label: t('preview.closeAll') },
                ]}
                onSelect={(id) => {
                  const path = tabMenu.path
                  releaseTabMenu()
                  if (id === 'close') closeTab(path)
                  else if (id === 'close-others') actions.closeOthers(path)
                  else actions.closeAll()
                }}
                onClose={releaseTabMenu}
              />
            )}
            {active !== null && body === 'source' && format?.lang !== undefined && (
              <span className="dsh-fe-lang" data-preview-lang-badge>{format.lang}</span>
            )}
            {content !== null && meta !== null && (
              <span className="dsh-fe-meta" data-preview-meta>{meta}</span>
            )}
            {content !== null && content.kind === 'text' && (
              <button
                type="button"
                className="dsh-fe-tool"
                aria-label={copied === active ? t('preview.copied') : t('preview.copy')}
                title={copied === active ? t('preview.copied') : t('preview.copy')}
                data-preview-copy
                data-preview-copy-state={copied === active ? 'copied' : 'idle'}
                onClick={copyActive}
              >
                {copied === active ? <Glyph of={ICON.check} /> : <Glyph of={ICON.copy} />}
              </button>
            )}
            {active !== null && (
              <Menu
                open={exportOpen}
                anchor={(
                  <button
                    type="button"
                    className="dsh-fe-tool"
                    aria-label={t('export.menu')}
                    title={t('export.menu')}
                    aria-haspopup="menu"
                    aria-expanded={exportOpen}
                    aria-busy={exporting || undefined}
                    data-preview-export
                    onClick={() => { setExportOpen(open => !open) }}
                  >
                    <Glyph of={ICON.download} />
                  </button>
                )}
                items={[
                  // Saving the file is the row every kind of file has; exporting a
                  // document is what two of them add below it.
                  { id: 'download', label: t('preview.download') },
                  ...(canExport
                    ? [
                      { type: 'separator' as const, id: 'export-separator' },
                      { id: 'pdf', label: t('export.pdf'), disabled: exporting },
                      { id: 'word', label: t('export.word'), disabled: exporting },
                    ]
                    : []),
                ]}
                onSelect={(id) => {
                  setExportOpen(false)
                  if (id === 'download') downloadActive()
                  else runExport(id === 'word' ? 'word' : 'pdf')
                }}
                onClose={() => { setExportOpen(false) }}
                // Portalled: this pane clips its own overflow, so an in-place list
                // would be cropped by the view's edge.
                portal
                align="end"
                side="bottom"
              />
            )}
            {active !== null && format !== null && hasSourceToggle(format) && (
              <button
                type="button"
                className="dsh-fe-tool"
                aria-pressed={body === 'source'}
                aria-label={body === 'source' ? t('preview.rendered') : t('preview.source')}
                title={body === 'source' ? t('preview.rendered') : t('preview.source')}
                data-preview-mode-toggle
                data-preview-mode={body === 'source' ? 'source' : 'rendered'}
                onClick={() => { actions.setMode(active, body === 'source' ? 'rendered' : 'source') }}
              >
                {/* The icon names what pressing it shows, which is the other body. */}
                {body === 'source' ? <Glyph of={ICON.browse} /> : <Glyph of={ICON.code} />}
              </button>
            )}
            {active !== null && body === 'source' && (
              <button
                type="button"
                className="dsh-fe-tool"
                aria-pressed={wrap}
                aria-label={wrap ? t('preview.nowrap') : t('preview.wrap')}
                title={wrap ? t('preview.nowrap') : t('preview.wrap')}
                data-preview-wrap-toggle
                data-preview-wrap={wrap ? 'on' : 'off'}
                onClick={() => { actions.setWrap(active, !wrap) }}
              >
                <Glyph of={ICON.wrap} />
              </button>
            )}
            {active !== null && (
              <button
                type="button"
                className="dsh-fe-tool"
                aria-label={t('preview.reload')}
                title={t('preview.reload')}
                data-preview-reload
                onClick={reloadPreview}
              >
                <Glyph of={ICON.refresh} />
              </button>
            )}
          </div>
          {active === null && <div className="dsh-fe-status">{t('preview.placeholder')}</div>}
          {exportError !== null && (
            <p className="dsh-fe-note dsh-fe-note-error" data-preview-export-error>
              {t('export.failed', { message: exportError })}
            </p>
          )}
          {state.downloads.length > 0 && (
            <div className="dsh-fe-downloads" data-preview-downloads aria-label={t('download.title')}>
              {state.downloads.map(task => (
                <div className="dsh-fe-download" key={task.id} data-download-state={task.state.kind}>
                  <span className="dsh-fe-download-name" title={task.path}>{task.name}</span>
                  <span className="dsh-fe-download-status" data-download-status>
                    {downloadStatus(task, t)}
                  </span>
                  <button
                    type="button"
                    className="dsh-fe-tool dsh-fe-download-control"
                    data-download-control={task.state.kind === 'running' ? 'cancel' : 'dismiss'}
                    aria-label={task.state.kind === 'running' ? t('download.cancel') : t('download.dismiss')}
                    onClick={() => {
                      if (task.state.kind === 'running') cancelDownload(task.id)
                      else actions.downloadDismissed(task.id)
                    }}
                  >
                    {/* Stopping a transfer and clearing its row are different
                        acts, so they are different glyphs. */}
                    {task.state.kind === 'running' ? <Glyph of={ICON.stop} /> : <Glyph of={ICON.close} />}
                  </button>
                </div>
              ))}
            </div>
          )}
          {active !== null && format !== null && format.kind === 'legacyOffice' && (
            <LegacyOfficePanel t={t} />
          )}
          {active !== null && format?.kind !== 'legacyOffice'
            && (preview === undefined || preview.kind === 'loading') && (
            <div className="dsh-fe-status">{t('preview.loading')}</div>
          )}
          {active !== null && preview?.kind === 'failed' && (
            <div className="dsh-fe-scroll" data-preview-state="failed">
              <p className="dsh-fe-note dsh-fe-note-error" data-preview-code={preview.failure.code}>
                {previewFailureLine(t, preview.failure)}
              </p>
              <button
                type="button"
                className="dsh-fe-tool"
                aria-label={t('preview.reload')}
                title={t('preview.reload')}
                data-preview-reload-failed
                onClick={reloadPreview}
              >
                <Glyph of={ICON.refresh} />
              </button>
            </div>
          )}
          {active !== null && content !== null && format !== null && (
            <PreviewBody
              path={active}
              content={content}
              format={format}
              body={body}
              jsonDocument={jsonDocument}
              jsonFallback={jsonFallback}
              wrap={wrap}
              readImage={readImage}
              proseRef={proseRef}
              t={t}
            />
          )}
        </div>
      </div>
    </div>
  )
}
