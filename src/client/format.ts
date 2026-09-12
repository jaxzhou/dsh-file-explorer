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
export type PreviewFormatKind = 'markdown' | 'json' | 'code' | 'image' | 'text'

/** One file's preview format. */
export interface PreviewFormat {
  /** Which body the pane draws. */
  readonly kind: PreviewFormatKind
  /** Grammar hint for the highlighted source view; absent when no grammar is known. */
  readonly lang: string | undefined
  /** Media type the read bytes are labelled with; present only for `image`. */
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
  const lang = extension === undefined ? undefined : GRAMMAR_BY_EXTENSION.get(extension)
  if (lang === undefined) return { kind: 'text', lang: undefined, mediaType: undefined }
  if (lang === 'json') return { kind: 'json', lang, mediaType: undefined }
  // Markdown gets a rendered body and a source body; MDX stays on the source
  // side, because its JSX would render as prose.
  if (lang === 'markdown') return { kind: 'markdown', lang, mediaType: undefined }
  return { kind: 'code', lang, mediaType: undefined }
}

/**
 * Whether the pane offers a rendered/source switch for a format.
 * @param format - the file's format.
 * @returns whether both bodies exist.
 */
export function hasSourceToggle(format: PreviewFormat): boolean {
  return format.kind === 'markdown' || format.kind === 'json'
}
