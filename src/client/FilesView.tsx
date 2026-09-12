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
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import {
  CodeBlock, FileTypeIcon, IconFolderClose16, IconFolderOpen16, IconRefreshOutline16, JsonTree,
  MarkdownText, classifyFileType, fileSizeText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import { hasSourceToggle, previewFormatFor } from './format.ts'
import type { PreviewFormat } from './format.ts'
import type { FilesInjected } from './face.ts'
import type {
  FilesState, LevelState, PreviewContent, PreviewMode, PreviewState, PreviewText,
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
            ? <IconFolderOpen16 className="dsh-fe-icon" />
            : <IconFolderClose16 className="dsh-fe-icon" />}
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
 * A Markdown file as a document, and a JSON file as a collapsible tree.
 *
 * The label objects are memoized on the translated strings rather than on `t`:
 * the bound translate keeps one identity across a locale change while its output
 * changes, and a fresh labels object on every render would discard the
 * primitives' parse memos.
 */
function FormattedBody({
  page,
  format,
  jsonDocument,
  t,
}: {
  page: PreviewText
  format: PreviewFormat
  /** Parsed JSON for a `json` format, decided by the pane before it elected this body. */
  jsonDocument: object | undefined
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
      <div className="dsh-fe-prose" data-preview-format="markdown">
        <MarkdownText text={page.text} labels={markdownLabels} />
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
type PreviewBodyKind = 'rendered' | 'source' | 'image'

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
  if (!hasSourceToggle(format)) return 'source'
  if ((mode ?? 'rendered') === 'source') return 'source'
  // JSON the tree cannot walk falls back to its source, so the controls offer the
  // body that is actually on screen.
  if (format.kind === 'json' && !jsonWalkable) return 'source'
  return 'rendered'
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
        ? <FormattedBody page={page} format={format} jsonDocument={jsonDocument} t={t} />
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
 * The Files view: the workspace tree, the open preview tabs, and the active tab.
 * @param props - the Conversation View seat, store, injected face, and copy.
 * @returns the two-pane explorer.
 */
export function FilesView({
  sessionId, useSessions, useStore, actions, list, read, t,
}: FilesViewProps): ReactNode {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store)
  const activeTabRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (cwd === undefined || state.root === cwd) return
    actions.start(cwd)
    list(cwd)
  }, [actions, cwd, list, state.root])

  const active = state.active
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
    onOpen: (path) => { actions.openFile(path) },
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
  const closeTab = (path: string): void => {
    actions.closeFile(path)
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
  const meta = content === null
    ? null
    : content.kind === 'text'
      ? [
        t('preview.lines', { lines: content.page.lines }),
        content.page.bytes === undefined ? null : fileSizeText(content.page.bytes),
      ].filter(part => part !== null).join(' · ')
      : content.image.bytes === undefined
        ? null
        : fileSizeText(content.image.bytes)

  return (
    <div
      className="dsh-fe-root"
      data-files-state="tree"
      data-files-root={state.root}
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
              <IconRefreshOutline16 />
            </button>
          </div>
          <div className="dsh-fe-scroll">
            <ul className="dsh-fe-level"><Level path={state.root} tree={tree} /></ul>
          </div>
        </div>
        <div className="dsh-fe-preview" data-files-pane="preview">
          <div className="dsh-fe-head dsh-fe-tabhead">
            {state.open.length === 0
              ? <span className="dsh-fe-path dsh-fe-path-muted">{t('preview.title')}</span>
              : (
                <div className="dsh-fe-tabs" role="tablist" aria-label={t('preview.tabs')} data-preview-tabs>
                  {state.open.map(path => {
                    const isActive = path === active
                    return (
                      <span className="dsh-fe-tab" key={path} role="presentation" data-preview-tab={path} data-active={isActive || undefined}>
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
                          <span aria-hidden="true">×</span>
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            {content !== null && meta !== null && (
              <span className="dsh-fe-meta" data-preview-meta>{meta}</span>
            )}
            {active !== null && format !== null && hasSourceToggle(format) && (
              <button
                type="button"
                className="dsh-fe-tool"
                aria-pressed={body === 'source'}
                aria-label={body === 'source' ? t('preview.rendered') : t('preview.source')}
                title={body === 'source' ? t('preview.rendered') : t('preview.source')}
                data-preview-mode-toggle
                onClick={() => { actions.setMode(active, body === 'source' ? 'rendered' : 'source') }}
              >
                {body === 'source' ? t('preview.rendered') : t('preview.source')}
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
                onClick={() => { actions.setWrap(active, !wrap) }}
              >
                {wrap ? '↵' : '→'}
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
                <IconRefreshOutline16 />
              </button>
            )}
          </div>
          {active === null && <div className="dsh-fe-status">{t('preview.placeholder')}</div>}
          {active !== null && (preview === undefined || preview.kind === 'loading') && (
            <div className="dsh-fe-status">{t('preview.loading')}</div>
          )}
          {active !== null && preview?.kind === 'failed' && (
            <div className="dsh-fe-scroll" data-preview-state="failed">
              <p className="dsh-fe-note dsh-fe-note-error" data-preview-code={preview.failure.code}>
                {previewFailureLine(t, preview.failure)}
              </p>
              <button type="button" className="dsh-fe-tool" onClick={reloadPreview}>
                {t('preview.reload')}
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
              t={t}
            />
          )}
        </div>
      </div>
    </div>
  )
}
