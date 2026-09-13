/**
 * The images a Markdown document references by relative path, and where inside
 * the workspace each one resolves.
 *
 * A rendered document has its own vocabulary for local images — the primitive's
 * `pathImages.resolve` — but it is synchronous, so the pane has to know which
 * destinations to fetch before it renders. That decision is pure text work, which
 * is why it lives here rather than in the component: it is the part that has to be
 * right, so it is the part under test.
 */

/**
 * How many images one document may pull in. A document is untrusted input; the
 * cap keeps one file from turning a preview into an unbounded number of reads.
 */
export const MAX_DOCUMENT_IMAGES = 24

/**
 * Largest asset a document may reference. The host's own complete-file cap is
 * higher, but a preview holds what it loads as a data URL, and an image that big
 * is not being read as a picture in a pane.
 */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024

/**
 * One `![alt](destination)` occurrence, in the shape CommonMark accepts: a
 * pointy-bracket destination, or a bare one with balanced parentheses, then an
 * optional title. A bare destination may not contain a space, so
 * `(images/with space.png)` is not a reference at all and must not half-match into
 * a read of `images/with`.
 */
const IMAGE_REFERENCE
  = /!\[[^\]]*\]\(\s*(?:<([^<>\n]*)>|([^\s()]*(?:\([^\s()]*\)[^\s()]*)*))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g

/** A fenced block or an inline code span, whose contents are examples, not references. */
const FENCED_BLOCK = /^[ \t]*(?:```|~~~)[\s\S]*?^[ \t]*(?:```|~~~)[^\n]*$/gm
const INLINE_CODE = /`[^`\n]*`/g

/**
 * Whether a destination is one this reader resolves against the document.
 *
 * Remote URLs belong to the primitive, which already renders them; a fragment is
 * not a file; an absolute path is the author naming the machine rather than the
 * workspace, and is left inert along with every other scheme.
 * @param destination - the destination as the author wrote it.
 * @returns whether it names a file beside the document.
 */
function isRelativeDestination(destination: string): boolean {
  const value = destination.trim()
  if (value === '' || value.startsWith('#') || value.startsWith('/') || value.startsWith('//')) {
    return false
  }
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
}

/**
 * Remove the spans that only look like references: a document about Markdown
 * contains `![alt](path.png)` inside its fences, and fetching that would be both
 * wrong and noisy.
 * @param text - the document's Markdown.
 * @returns the text with fenced blocks and inline code spans removed.
 */
function withoutCode(text: string): string {
  return text.replace(FENCED_BLOCK, '').replace(INLINE_CODE, '')
}

/**
 * Every distinct relative image destination one document references, in document
 * order and capped at {@link MAX_DOCUMENT_IMAGES}.
 * @param text - the document's Markdown.
 * @returns the destinations, as written.
 */
export function relativeImageDestinations(text: string): string[] {
  const found = new Set<string>()
  for (const match of withoutCode(text).matchAll(IMAGE_REFERENCE)) {
    const destination = match[1] ?? match[2] ?? ''
    if (!isRelativeDestination(destination)) continue
    found.add(destination)
    if (found.size >= MAX_DOCUMENT_IMAGES) break
  }
  return [...found]
}

/**
 * Resolve one relative destination against the directory holding the document.
 *
 * `..` is folded rather than sent to the host, a percent-escape is decoded because
 * a destination is a URL while a path is not, and the separator follows the base's
 * own style so a Windows path stays one.
 * @param baseDirectory - absolute directory of the document, with or without its trailing separator.
 * @param destination - the destination as the author wrote it.
 * @returns the absolute path to read.
 */
export function resolveRelativePath(baseDirectory: string, destination: string): string {
  let decoded = destination
  try {
    decoded = decodeURIComponent(destination)
  } catch {
    // A malformed escape is kept as written rather than losing the reference.
  }
  const separator = baseDirectory.includes('\\') && !baseDirectory.includes('/') ? '\\' : '/'
  const segments: string[] = []
  for (const part of [...baseDirectory.split(/[\\/]+/), ...decoded.split(/[\\/]+/)]) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segments.pop()
      continue
    }
    segments.push(part)
  }
  const rooted = /^[\\/]/.test(baseDirectory)
  return `${rooted ? separator : ''}${segments.join(separator)}`
}
