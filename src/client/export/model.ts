/**
 * The document model one export serialises: the block structure an HTML document
 * or a rendered Markdown body actually has, with no presentation attached.
 *
 * A Word file is a text document, so unlike the PDF — which is a picture of what
 * the reader sees — it wants structure: a heading is a heading, a table is a
 * table, and Chinese stays text that Word renders with its own fonts. This module
 * is the one reading of the document that the `.docx` writer serialises.
 *
 * It walks a DOM, because both sources are one: a rendered Markdown body is a live
 * element, and an HTML file is parsed into an inert document first. Scripts never
 * run in either — the Markdown body is React output, and parsing is inert.
 */

/** One run of text with the emphasis its source element carried. */
export interface InlineRun {
  readonly text: string
  readonly bold?: boolean
  readonly italic?: boolean
  readonly code?: boolean
}

/** One table cell, as the runs it holds. */
export interface TableCell {
  readonly runs: readonly InlineRun[]
}

/** One block of the document. */
export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly runs: readonly InlineRun[] }
  | { readonly kind: 'paragraph'; readonly runs: readonly InlineRun[] }
  | { readonly kind: 'quote'; readonly runs: readonly InlineRun[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly depth: number; readonly runs: readonly InlineRun[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'rule' }
  | { readonly kind: 'table'; readonly rows: readonly { readonly cells: readonly TableCell[] }[] }
  | {
    readonly kind: 'image'
    /** `data:` URL when the image could be read; anything else is not embedded. */
    readonly src: string
    readonly alt: string
    /** Rendered width in CSS pixels, when the element reports one. */
    readonly width: number | undefined
    /** Rendered height in CSS pixels, when the element reports one. */
    readonly height: number | undefined
  }

/**
 * Elements whose inline children carry emphasis, and which therefore do not break
 * a paragraph.
 */
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'cite', 'code', 'del', 'em', 'i', 'ins', 'kbd', 'label', 'mark',
  'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
])

/** Heading tag name to level. */
const HEADING_LEVELS: Readonly<Record<string, number>> = {
  h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6,
}

/**
 * Collapse whitespace the way a document reader does, keeping one space between
 * words and none at the edges.
 * @param text - the raw text node.
 * @returns the collapsed text.
 */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/**
 * The runs of one element's inline content.
 *
 * Nested emphasis accumulates by tag name, a line break becomes a newline inside
 * the run stream, and images are skipped here — a picture is a block, and the
 * caller takes it from the element itself.
 * @param element - the element to read.
 * @param inherited - emphasis carried in from an ancestor.
 * @returns the runs, with empty ones dropped and edges trimmed.
 */
export function runsOf(
  element: Element,
  inherited: { bold?: boolean; italic?: boolean; code?: boolean } = {},
): InlineRun[] {
  const runs: InlineRun[] = []
  const push = (text: string, flags: typeof inherited, keepLeading: boolean): void => {
    if (text === '') return
    const trimmed = keepLeading ? text.replace(/\s+$/, '') : text.replace(/^\s+|\s+$/g, '')
    if (trimmed === '') return
    const previous = runs.at(-1)
    if (previous !== undefined && previous.bold === flags.bold
      && previous.italic === flags.italic && previous.code === flags.code) {
      runs[runs.length - 1] = { ...previous, text: previous.text + trimmed }
      return
    }
    runs.push({ text: trimmed, ...flags })
  }
  const walk = (node: Node, flags: typeof inherited, first: boolean): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        push(collapse(child.textContent ?? ''), flags, first && runs.length === 0)
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const tag = (child as Element).tagName.toLowerCase()
      if (tag === 'br') {
        const previous = runs.at(-1)
        if (previous !== undefined) runs[runs.length - 1] = { ...previous, text: `${previous.text}\n` }
        continue
      }
      if (tag === 'img') continue
      const next = {
        ...(flags.bold === true || tag === 'strong' || tag === 'b' ? { bold: true } : {}),
        ...(flags.italic === true || tag === 'em' || tag === 'i' ? { italic: true } : {}),
        ...(flags.code === true || tag === 'code' || tag === 'kbd' || tag === 'samp' ? { code: true } : {}),
      }
      walk(child, INLINE_TAGS.has(tag) ? next : flags, first)
    }
  }
  walk(element, inherited, true)
  // A trailing space would widen the last run for nothing.
  const last = runs.at(-1)
  if (last !== undefined) runs[runs.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') }
  return runs.filter(run => run.text !== '')
}

/**
 * Read one image element into a block.
 * @param image - the element.
 * @returns the block, or undefined when it has no source to embed.
 */
function imageBlock(image: Element): Block | undefined {
  const src = image.getAttribute('src') ?? ''
  if (src === '') return undefined
  const rect = image.getBoundingClientRect()
  return {
    kind: 'image',
    src,
    alt: image.getAttribute('alt') ?? '',
    width: rect.width > 0 ? Math.round(rect.width) : undefined,
    height: rect.height > 0 ? Math.round(rect.height) : undefined,
  }
}

/**
 * The rows of one table.
 * @param table - the table element.
 * @returns each row's cells, with header cells included in place.
 */
function tableRows(table: Element): { cells: TableCell[] }[] {
  const rows: { cells: TableCell[] }[] = []
  for (const row of table.querySelectorAll('tr')) {
    const cells: TableCell[] = []
    for (const cell of row.children) {
      const tag = cell.tagName.toLowerCase()
      if (tag !== 'td' && tag !== 'th') continue
      cells.push({ runs: runsOf(cell) })
    }
    if (cells.length > 0) rows.push({ cells })
  }
  return rows
}

/**
 * Read one list element, recursing into nested lists.
 * @param list - the `ul` or `ol` element.
 * @param depth - nesting depth, where the outermost list is zero.
 * @param blocks - the block list to append to.
 */
function listBlocks(list: Element, depth: number, blocks: Block[]): void {
  const ordered = list.tagName.toLowerCase() === 'ol'
  for (const item of list.children) {
    if (item.tagName.toLowerCase() !== 'li') continue
    const runs = runsOf(item)
    if (runs.length > 0) blocks.push({ kind: 'list', ordered, depth, runs })
    for (const child of item.children) {
      const tag = child.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') listBlocks(child, depth + 1, blocks)
    }
  }
}

/**
 * Read a container's block structure.
 * @param root - the element whose children are blocks.
 * @returns the blocks, in document order.
 */
export function blocksFromElement(root: Element): Block[] {
  const blocks: Block[] = []
  const visit = (element: Element, depth: number): void => {
    for (const child of element.children) {
      const tag = child.tagName.toLowerCase()
      const level = HEADING_LEVELS[tag]
      if (level !== undefined) {
        const runs = runsOf(child)
        if (runs.length > 0) blocks.push({ kind: 'heading', level, runs })
        continue
      }
      if (tag === 'p') {
        const images = [...child.querySelectorAll('img')]
        const runs = runsOf(child)
        if (runs.length > 0) blocks.push({ kind: 'paragraph', runs })
        for (const image of images) {
          const block = imageBlock(image)
          if (block !== undefined) blocks.push(block)
        }
        continue
      }
      if (tag === 'img') {
        const block = imageBlock(child)
        if (block !== undefined) blocks.push(block)
        continue
      }
      if (tag === 'pre') {
        // The highlighted source, not the token spans: `innerText` keeps the line
        // structure the reader sees, `textContent` would glue lines together.
        const text = (child as HTMLElement).innerText.replace(/\n+$/, '')
        if (text !== '') blocks.push({ kind: 'code', text })
        continue
      }
      if (tag === 'ul' || tag === 'ol') {
        listBlocks(child, depth, blocks)
        continue
      }
      if (tag === 'blockquote') {
        for (const inner of child.querySelectorAll('p')) {
          const runs = runsOf(inner)
          if (runs.length > 0) blocks.push({ kind: 'quote', runs })
        }
        continue
      }
      if (tag === 'table') {
        const rows = tableRows(child)
        if (rows.length > 0) blocks.push({ kind: 'table', rows })
        continue
      }
      if (tag === 'hr') {
        blocks.push({ kind: 'rule' })
        continue
      }
      // Anything else — a section, a details, a div — is a container: read through
      // it rather than losing what it holds.
      visit(child, depth)
    }
  }
  visit(root, 0)
  return blocks
}
