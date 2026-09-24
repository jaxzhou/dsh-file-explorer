/**
 * What a workspace file is, for preview purposes.
 *
 * The pane picks a display from the file's own name before it reads anything,
 * so the read itself can differ: an image needs its complete bytes, everything
 * else needs a page of text. The decision is a pure function of the path, which
 * keeps it testable and keeps the read path honest — the pane never reads bytes
 * it will not draw.
 *
 * Only grammars the shared syntax highlighter actually carries are mapped. An
 * unrecognized suffix is plain text on purpose: a wrong grammar colours the
 * file misleadingly, while plain numbered text is merely unadorned.
 */

/** The display a file's contents get. */
export type PreviewFormatKind
  = 'markdown' | 'html' | 'json' | 'code' | 'image' | 'text'
    | 'pdf' | 'word' | 'sheet' | 'slides' | 'legacyOffice'

/** One file's preview format. */
export interface PreviewFormat {
  /** Which body the pane draws. */
  readonly kind: PreviewFormatKind
  /** Grammar hint for the highlighted source view; absent when no grammar is known. */
  readonly lang: string | undefined
  /** Media type the file's own bytes carry, when its suffix says so. */
  readonly mediaType: string | undefined
}

/** Image suffixes and the media type their bytes carry. */
const IMAGE_MEDIA_TYPES = new Map<string, string>([
  ['png', 'image/png'],
  ['apng', 'image/apng'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['jfif', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['ico', 'image/x-icon'],
  // An SVG draws as an image here; `<img>` neither runs its scripts nor lets it
  // reach the application origin, so the markup stays inert.
  ['svg', 'image/svg+xml'],
])

/**
 * Suffix → document format, for the files whose preview needs the whole file
 * rather than a page of text: a PDF and the three OOXML packages, plus the
 * legacy binary formats, which are recognised only so the pane can say why it
 * will not draw them instead of reporting a binary file as unreadable text.
 */
const DOCUMENT_MEDIA_TYPES = new Map<string, { kind: PreviewFormatKind; mediaType: string }>([
  ['pdf', { kind: 'pdf', mediaType: 'application/pdf' }],
  ['docx', { kind: 'word', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
  ['docm', { kind: 'word', mediaType: 'application/vnd.ms-word.document.macroEnabled.12' }],
  ['xlsx', { kind: 'sheet', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
  ['xlsm', { kind: 'sheet', mediaType: 'application/vnd.ms-excel.sheet.macroEnabled.12' }],
  ['pptx', { kind: 'slides', mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }],
  ['pptm', { kind: 'slides', mediaType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12' }],
  // The formats before OOXML are OLE compound files, not packages; reading one
  // means a second container format and a second document model, for documents
  // a browser preview could not lay out anyway.
  ['doc', { kind: 'legacyOffice', mediaType: 'application/msword' }],
  ['xls', { kind: 'legacyOffice', mediaType: 'application/vnd.ms-excel' }],
  ['ppt', { kind: 'legacyOffice', mediaType: 'application/vnd.ms-powerpoint' }],
])

/**
 * Suffix → grammar id, restricted to the ids the shared highlighter resolves
 * (its own alias list). A suffix whose grammar is absent stays unmapped so the
 * file falls through to plain text rather than a wrong colouring.
 */
const GRAMMAR_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  typescript: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'],
  shellscript: ['sh', 'bash', 'zsh', 'ksh', 'shell'],
  json: ['json', 'jsonc', 'jsonl', 'ndjson', 'map', 'webmanifest'],
  python: ['py', 'pyw', 'pyi'],
  ruby: ['rb', 'rake', 'gemspec', 'ru'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  c: ['c', 'h'],
  cpp: ['cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx', 'ipp'],
  csharp: ['cs', 'csx'],
  kotlin: ['kt', 'kts'],
  swift: ['swift'],
  php: ['php', 'phtml', 'php3', 'php4', 'php5'],
  yaml: ['yaml', 'yml'],
  toml: ['toml'],
  ini: ['ini', 'cfg', 'conf', 'properties', 'desktop', 'service'],
  markdown: ['md', 'markdown', 'mkd', 'mdown', 'mdwn'],
  mdx: ['mdx'],
  html: ['html', 'htm', 'xhtml', 'shtml'],
  css: ['css'],
  scss: ['scss'],
  less: ['less'],
  sql: ['sql', 'ddl', 'dml'],
  xml: ['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist'],
  lua: ['lua'],
}

const GRAMMAR_BY_EXTENSION = new Map(Object.entries(GRAMMAR_EXTENSIONS)
  .flatMap(([grammar, suffixes]) => suffixes.map(suffix => [suffix, grammar] as const)))

/**
 * The lowercase suffix a file name ends in.
 *
 * A name that starts with its dot has no suffix: `.gitignore` is a whole name,
 * not a `gitignore` file. A trailing dot has none either.
 * @param path - absolute or relative path, in either separator style.
 * @returns the suffix without its dot, or undefined.
 */
export function extensionOf(path: string): string | undefined {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  const at = name.lastIndexOf('.')
  if (at <= 0 || at === name.length - 1) return undefined
  return name.slice(at + 1).toLowerCase()
}

/**
 * Decide how one file is previewed, from its name alone.
 * @param path - absolute or relative path of the file.
 * @returns its preview format.
 */
export function previewFormatFor(path: string): PreviewFormat {
  const extension = extensionOf(path)
  const mediaType = extension === undefined ? undefined : IMAGE_MEDIA_TYPES.get(extension)
  if (mediaType !== undefined) return { kind: 'image', lang: undefined, mediaType }
  const document = extension === undefined ? undefined : DOCUMENT_MEDIA_TYPES.get(extension)
  if (document !== undefined) return { kind: document.kind, lang: undefined, mediaType: document.mediaType }
  const lang = extension === undefined ? undefined : GRAMMAR_BY_EXTENSION.get(extension)
  if (lang === undefined) return { kind: 'text', lang: undefined, mediaType: undefined }
  if (lang === 'json') return { kind: 'json', lang, mediaType: undefined }
  // Markdown and HTML each get a rendered body and a source body; MDX stays on
  // the source side, because its JSX would render as prose.
  if (lang === 'markdown') return { kind: 'markdown', lang, mediaType: undefined }
  if (lang === 'html') return { kind: 'html', lang, mediaType: undefined }
  return { kind: 'code', lang, mediaType: undefined }
}

/**
 * Whether a format's preview is built from the file's complete bytes.
 *
 * A picture, a PDF and an Office package are not readable as a page of lines, so
 * the read that fills their tab asks for the whole file — which is why the file
 * size that read can carry is the one the deployment sets for a complete read.
 * @param format - the file's format.
 * @returns whether the read is a complete-file read.
 */
export function readsAllBytes(format: PreviewFormat): boolean {
  switch (format.kind) {
    case 'image': case 'pdf': case 'word': case 'sheet': case 'slides': return true
    default: return false
  }
}

/**
 * Which Office package one format names.
 * @param format - the file's format.
 * @returns the package kind, or undefined when it is not an OOXML document.
 */
export function officeKindOf(format: PreviewFormat): 'word' | 'sheet' | 'slides' | undefined {
  switch (format.kind) {
    case 'word': case 'sheet': case 'slides': return format.kind
    default: return undefined
  }
}

/**
 * Whether the pane offers a rendered/source switch for a format.
 * @param format - the file's format.
 * @returns whether both bodies exist.
 */
export function hasSourceToggle(format: PreviewFormat): boolean {
  return format.kind === 'markdown' || format.kind === 'html' || format.kind === 'json'
}

/**
 * Whether the rendered body of a format can be exported as a PDF.
 *
 * Only the two formats whose rendered body is a *document*: a JSON tree and a
 * source listing have no page to print, and an image or plain text is already
 * what it is.
 * @param format - the file's format.
 * @returns whether the export control applies.
 */
export function canExportPdf(format: PreviewFormat): boolean {
  return format.kind === 'markdown' || format.kind === 'html'
}
