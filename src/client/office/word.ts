/**
 * Reading a `.docx`: the Word document model back out of an OOXML package.
 *
 * The model is the one the exporter next door writes — the same `Block` list —
 * because that is what a Word file *is* here: headings, paragraphs, lists,
 * tables, code, rules, and pictures. Writing it and reading it through one type
 * is what lets the tests round-trip a document instead of comparing XML by hand.
 *
 * Three parts of a package carry what this reader needs: `word/document.xml` for
 * the body, `word/_rels/document.xml.rels` for the pictures it points at, and —
 * where the document has them — `word/styles.xml` and `word/numbering.xml` for
 * the two things OOXML keeps *outside* the paragraph: which style means
 * "heading", and which numbering definition means "ordered list".
 *
 * Headings are found by outline level rather than by style name. `w:outlineLvl`
 * is direct formatting that means exactly "this paragraph is heading level N",
 * it survives a document whose styles are named in a language this reader does
 * not know, and it is what the exporter writes.
 */
import type { Block, InlineRun, TableCell } from '../export/model.ts'
import { dataUrlOf, imageMediaTypeOf, resolvePart } from './binary.ts'
import { readRelationships, type Relationship } from './package.ts'
import {
  attribute, descendants, elements, firstDescendant, isElement, parseXml, textContent,
  type XmlElement,
} from './xml.ts'
import { openZip, type ZipArchive } from './zip.ts'

/** A Word document, as the preview draws it. */
export interface WordDocument {
  readonly kind: 'word'
  /** The document's blocks, in order. */
  readonly blocks: readonly Block[]
  /** The document held more than this reader shows. */
  readonly truncated: boolean
}

/** How many blocks one document may contribute to the pane. */
const MAX_BLOCKS = 4000

/** How many pictures one document may carry into the pane. */
const MAX_IMAGES = 64

/** English Metric Units per CSS pixel at 96 dpi, which is how Word measures. */
const EMU_PER_PX = 9525

/** The emphasis one run inherits from the runs around it. */
interface RunStyle {
  readonly bold: boolean
  readonly italic: boolean
  readonly code: boolean
}

const PLAIN: RunStyle = { bold: false, italic: false, code: false }

/**
 * One child element's `w:val`, which is how OOXML states most of its properties.
 * @param element - the parent, which may be absent.
 * @param local - the child's local name.
 * @returns the value, or undefined when either is missing.
 */
function childValue(element: XmlElement | undefined, local: string): string | undefined {
  if (element === undefined) return undefined
  const child = elements(element, local)[0]
  return child === undefined ? undefined : attribute(child, 'val')
}

/**
 * Whether a toggle property is on.
 *
 * OOXML's toggles are present-or-absent, and a present one may still say `0` or
 * `false` — which means what it says.
 * @param element - the toggle element, when the document has it.
 * @returns whether the property is on.
 */
function isOn(element: XmlElement | undefined): boolean {
  if (element === undefined) return false
  const value = attribute(element, 'val')
  return value === undefined || (value !== '0' && value !== 'false' && value !== 'off')
}

/**
 * Clamp a heading level to the ones a document has.
 * @param level - the level.
 * @returns the level, between one and six.
 */
function headingLevel(level: number): number {
  return Math.min(Math.max(Math.round(level), 1), 6)
}

/**
 * Read which style ids mean which heading level.
 *
 * A style's outline level is authoritative; the id itself is the fallback, and
 * it is checked in both the English and the Chinese spelling because a document
 * written by a localized Word names its own styles.
 * @param zip - the open package.
 * @returns a level by style id.
 */
async function readStyleHeadings(zip: ZipArchive): Promise<Map<string, number>> {
  const headings = new Map<string, number>()
  const text = await zip.text('word/styles.xml')
  if (text === undefined) return headings
  for (const style of descendants(parseXml(text), 'style')) {
    if (attribute(style, 'type') !== 'paragraph') continue
    const id = attribute(style, 'styleId')
    if (id === undefined) continue
    const outline = childValue(elements(style, 'pPr')[0], 'outlineLvl')
    if (outline !== undefined) {
      const level = Number(outline)
      // Nine is "body text" spelled as an outline level: not a heading.
      if (Number.isFinite(level) && level >= 0 && level <= 8) headings.set(id, headingLevel(level + 1))
      continue
    }
    const named = /^(?:heading|标题)\s*([1-9])$/i.exec(id.trim())
    if (named !== null) headings.set(id, headingLevel(Number(named[1])))
    else if (/^(?:title|标题)$/i.test(id.trim())) headings.set(id, 1)
  }
  return headings
}

/**
 * Read the numbering definitions, so a list can say whether it is ordered.
 * @param zip - the open package.
 * @returns the number format by numbering id and level.
 */
async function readNumbering(zip: ZipArchive): Promise<Map<string, Map<number, string>>> {
  const formats = new Map<string, Map<number, string>>()
  const text = await zip.text('word/numbering.xml')
  if (text === undefined) return formats
  const root = parseXml(text)
  const abstract = new Map<string, Map<number, string>>()
  for (const node of descendants(root, 'abstractNum')) {
    const id = attribute(node, 'abstractNumId')
    if (id === undefined) continue
    const levels = new Map<number, string>()
    for (const level of elements(node, 'lvl')) {
      const index = Number(attribute(level, 'ilvl') ?? '')
      const format = childValue(level, 'numFmt')
      if (Number.isFinite(index) && format !== undefined) levels.set(index, format)
    }
    abstract.set(id, levels)
  }
  for (const node of descendants(root, 'num')) {
    const id = attribute(node, 'numId')
    const reference = childValue(node, 'abstractNumId')
    if (id === undefined || reference === undefined) continue
    formats.set(id, abstract.get(reference) ?? new Map())
  }
  return formats
}

/**
 * Read every picture the document points at, as data URLs.
 *
 * Read up front rather than on demand, because the walk below is synchronous and
 * a picture's place in the block list has to be decided as it goes. The cap is
 * what keeps that honest for a document with hundreds of them.
 * @param zip - the open package.
 * @param relationships - the document's relationships.
 * @returns a data URL by relationship id, and whether the cap was reached.
 */
async function readMedia(
  zip: ZipArchive,
  relationships: ReadonlyMap<string, Relationship>,
): Promise<{ media: Map<string, string>; truncated: boolean }> {
  const media = new Map<string, string>()
  let truncated = false
  for (const [id, relationship] of relationships) {
    if (relationship.external) continue
    const path = resolvePart('word', relationship.target)
    const mediaType = imageMediaTypeOf(path)
    if (mediaType === undefined) continue
    if (media.size >= MAX_IMAGES) {
      truncated = true
      break
    }
    const data = await zip.read(path)
    if (data === undefined) continue
    media.set(id, dataUrlOf(data, mediaType))
  }
  return { media, truncated }
}

/**
 * Append one run's text, merging it into the previous run when the emphasis is
 * the same.
 * @param runs - the run list to append to.
 * @param text - the text to add.
 * @param style - the emphasis it carries.
 */
function pushText(runs: InlineRun[], text: string, style: RunStyle): void {
  if (text === '') return
  const previous = runs.at(-1)
  const same = previous !== undefined
    && (previous.bold === true) === style.bold
    && (previous.italic === true) === style.italic
    && (previous.code === true) === style.code
  if (same && previous !== undefined) {
    runs[runs.length - 1] = { ...previous, text: previous.text + text }
    return
  }
  runs.push({
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.code ? { code: true } : {}),
  })
}

/**
 * Whether a run's properties name a font this reader calls code.
 * @param properties - the run's `w:rPr`, when it has one.
 * @returns whether the run is monospaced.
 */
function isCodeFont(properties: XmlElement | undefined): boolean {
  if (properties === undefined) return false
  const fonts = elements(properties, 'rFonts')[0]
  if (fonts === undefined) return false
  const name = attribute(fonts, 'ascii') ?? attribute(fonts, 'hAnsi')
  return name !== undefined && /consolas|courier|monospace|menlo|monaco/i.test(name)
}

/**
 * Read one `w:r` into the run list.
 * @param run - the run element.
 * @param inherited - the emphasis carried in from an enclosing run property.
 * @param runs - the list to append to.
 */
function pushRun(run: XmlElement, inherited: RunStyle, runs: InlineRun[]): void {
  const properties = elements(run, 'rPr')[0]
  const toggle = (local: string): boolean =>
    isOn(properties === undefined ? undefined : elements(properties, local)[0])
  const style: RunStyle = {
    bold: inherited.bold || toggle('b'),
    italic: inherited.italic || toggle('i'),
    code: inherited.code || isCodeFont(properties),
  }
  let text = ''
  for (const node of run.children) {
    if (!isElement(node)) continue
    switch (node.local) {
      case 't': text += textContent(node); break
      case 'br': case 'cr': text += '\n'; break
      case 'tab': text += '\t'; break
      case 'noBreakHyphen': text += '\u2011'; break
      default: break
    }
  }
  pushText(runs, text, style)
}

/**
 * Read every run of one container, following the wrappers that hold them.
 * @param container - the paragraph or wrapper element.
 * @param inherited - the emphasis carried in.
 * @param runs - the list to append to.
 */
function readRuns(container: XmlElement, inherited: RunStyle, runs: InlineRun[]): void {
  for (const child of container.children) {
    if (!isElement(child)) continue
    switch (child.local) {
      case 'r': pushRun(child, inherited, runs); break
      case 'hyperlink': case 'ins': case 'smartTag': case 'dir': case 'bdo':
        readRuns(child, inherited, runs)
        break
      case 'sdt': {
        const content = elements(child, 'sdtContent')[0]
        if (content !== undefined) readRuns(content, inherited, runs)
        break
      }
      // Anything else — `w:pPr`, `w:del` and its deleted text, bookmarks, proofing
      // marks, comment anchors — contributes nothing to what the reader sees.
      default: break
    }
  }
}

/**
 * Every picture one paragraph draws.
 * @param paragraph - the paragraph.
 * @param media - the document's pictures by relationship id.
 * @param blocks - the list to append the image blocks to.
 */
function pushImages(
  paragraph: XmlElement,
  media: ReadonlyMap<string, string>,
  blocks: Block[],
): void {
  const drawings = [...descendants(paragraph, 'drawing'), ...descendants(paragraph, 'pict')]
  for (const drawing of drawings) {
    const blip = firstDescendant(drawing, 'blip')
    const embed = blip === undefined
      ? undefined
      : blip.attributes.get('r:embed') ?? attribute(blip, 'embed')
    const imageData = firstDescendant(drawing, 'imagedata')
    const id = embed
      ?? (imageData === undefined
        ? undefined
        : imageData.attributes.get('r:id') ?? attribute(imageData, 'id'))
    if (id === undefined) continue
    const src = media.get(id)
    if (src === undefined) continue
    const extent = firstDescendant(drawing, 'extent')
    const cx = Number(attribute(extent ?? drawing, 'cx') ?? '')
    const cy = Number(attribute(extent ?? drawing, 'cy') ?? '')
    const name = firstDescendant(drawing, 'docPr')
    blocks.push({
      kind: 'image',
      src,
      alt: name === undefined ? '' : attribute(name, 'descr') ?? attribute(name, 'name') ?? '',
      width: Number.isFinite(cx) && cx > 0 ? Math.round(cx / EMU_PER_PX) : undefined,
      height: Number.isFinite(cy) && cy > 0 ? Math.round(cy / EMU_PER_PX) : undefined,
    })
  }
}

/**
 * One table as a block.
 * @param table - the `w:tbl` element.
 * @returns the block, or undefined when the table holds no cell.
 */
function tableBlock(table: XmlElement): Block | undefined {
  const rows: { cells: TableCell[] }[] = []
  for (const row of elements(table, 'tr')) {
    const cells: TableCell[] = []
    for (const cell of elements(row, 'tc')) {
      const runs: InlineRun[] = []
      for (const paragraph of elements(cell, 'p')) {
        const own: InlineRun[] = []
        readRuns(paragraph, PLAIN, own)
        if (own.length === 0) continue
        if (runs.length > 0) runs.push({ text: '\n' })
        runs.push(...own)
      }
      cells.push({ runs })
    }
    if (cells.length > 0) rows.push({ cells })
  }
  return rows.length === 0 ? undefined : { kind: 'table', rows }
}

/**
 * Read one `.docx` package.
 * @param bytes - the package's bytes.
 * @returns the document's blocks.
 */
export async function readWord(bytes: Uint8Array): Promise<WordDocument> {
  const zip = openZip(bytes)
  const source = await zip.text('word/document.xml')
  if (source === undefined) {
    throw new Error('this file is not a Word document: it has no word/document.xml part')
  }
  const relationships = await readRelationships(zip, 'word/document.xml')
  const { media, truncated: mediaTruncated } = await readMedia(zip, relationships)
  const styles = await readStyleHeadings(zip)
  const numbering = await readNumbering(zip)

  const blocks: Block[] = []
  let truncated = mediaTruncated

  const visitParagraph = (paragraph: XmlElement): void => {
    if (blocks.length >= MAX_BLOCKS) {
      truncated = true
      return
    }
    const properties = elements(paragraph, 'pPr')[0]
    const runs: InlineRun[] = []
    readRuns(paragraph, PLAIN, runs)
    const outline = childValue(properties, 'outlineLvl')
    const styleId = childValue(properties, 'pStyle')
    const level = outline !== undefined && Number(outline) >= 0 && Number(outline) <= 8
      ? headingLevel(Number(outline) + 1)
      : styleId === undefined
        ? undefined
        : styles.get(styleId)
    if (runs.length > 0) {
      if (level !== undefined) {
        blocks.push({ kind: 'heading', level, runs })
      } else {
        const numberingProperties = properties === undefined ? undefined : elements(properties, 'numPr')[0]
        const numberingId = childValue(numberingProperties, 'numId')
        if (numberingId === undefined) {
          blocks.push({ kind: 'paragraph', runs })
        } else {
          const depth = Number(childValue(numberingProperties, 'ilvl') ?? '0')
          const format = numbering.get(numberingId)?.get(Number.isFinite(depth) ? depth : 0)
          // A numbering definition this package does not describe is still a list
          // item; it is shown as a bullet rather than as a bare paragraph.
          const ordered = format !== undefined && format !== 'bullet' && format !== 'none'
          blocks.push({ kind: 'list', ordered, depth: Number.isFinite(depth) ? depth : 0, runs })
        }
      }
    }
    pushImages(paragraph, media, blocks)
  }

  /** Walk a container's block-level children, following content controls. */
  const visitBlocks = (container: XmlElement): void => {
    for (const child of elements(container)) {
      if (blocks.length >= MAX_BLOCKS) {
        truncated = true
        return
      }
      if (child.local === 'p') {
        visitParagraph(child)
        continue
      }
      if (child.local === 'tbl') {
        const table = tableBlock(child)
        if (table !== undefined) blocks.push(table)
        continue
      }
      if (child.local === 'sdt') {
        const content = elements(child, 'sdtContent')[0]
        if (content !== undefined) visitBlocks(content)
      }
    }
  }

  const root = parseXml(source)
  const body = elements(root, 'body')[0] ?? root
  visitBlocks(body)
  return { kind: 'word', blocks, truncated }
}
