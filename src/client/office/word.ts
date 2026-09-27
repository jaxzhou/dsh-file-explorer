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
import type { Block, BlockAlign, BlockMetrics, InlineRun, TableCell } from '../export/model.ts'
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
  readonly underline: boolean
  readonly strike: boolean
  readonly sup: boolean
  readonly sub: boolean
  readonly color: string | undefined
  readonly highlight: string | undefined
  readonly size: number | undefined
  readonly font: string | undefined
}

const PLAIN: RunStyle = {
  bold: false, italic: false, code: false, underline: false, strike: false, sup: false, sub: false,
  color: undefined, highlight: undefined, size: undefined, font: undefined,
}

/**
 * The block-level formatting one paragraph ends up with.
 *
 * In OOXML most of this lives on the paragraph *style* rather than on the
 * paragraph — a document's Normal style carrying `w:jc` is what justifies every
 * body paragraph in it — so these are resolved through the style chain rather
 * than read off one element.
 */
interface ParagraphStyle {
  readonly align: BlockAlign | undefined
  readonly indent: number | undefined
  readonly firstLine: number | undefined
  readonly before: number | undefined
  readonly after: number | undefined
  readonly lineHeight: number | undefined
}

const PLAIN_PARAGRAPH: ParagraphStyle = {
  align: undefined, indent: undefined, firstLine: undefined, before: undefined, after: undefined,
  lineHeight: undefined,
}

/** One style, as the styles part defines it. */
interface StyleDefinition {
  /** The style's id, which is what an element names it by. */
  readonly id: string
  readonly type: string
  readonly name: string | undefined
  readonly basedOn: string | undefined
  readonly runProperties: XmlElement | undefined
  readonly paragraphProperties: XmlElement | undefined
}

/** Every style a document defines, and the defaults beneath them. */
interface StyleTable {
  /** The run properties every run starts from, from `w:docDefaults`. */
  readonly defaultRun: XmlElement | undefined
  /** The paragraph style that applies where a paragraph names none. */
  readonly defaultParagraph: string | undefined
  readonly byId: ReadonlyMap<string, StyleDefinition>
}

/** Twips (a twentieth of a point) to CSS pixels at 96 dpi. */
function twipsToPx(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const twips = Number(value)
  return Number.isFinite(twips) ? Math.round((twips / 20) * (96 / 72)) : undefined
}

/** Half-points, which is how OOXML states a font size, to CSS pixels. */
function halfPointsToPx(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const half = Number(value)
  return Number.isFinite(half) && half > 0 ? Math.round((half / 2) * (96 / 72)) : undefined
}

/**
 * The font family one run properties element names.
 *
 * A theme reference (`w:asciiTheme`) is not a font name, and resolving one means
 * reading the theme part; the page's own default is a better answer than a guess,
 * so only named faces count here.
 * @param properties - the `w:rPr` element, when there is one.
 * @returns a CSS font stack, or undefined.
 */
function fontOf(properties: XmlElement | undefined): string | undefined {
  if (properties === undefined) return undefined
  const fonts = elements(properties, 'rFonts')[0]
  if (fonts === undefined) return undefined
  const names = ['eastAsia', 'ascii', 'hAnsi']
    .map(local => attribute(fonts, local))
    .filter((name): name is string => name !== undefined && name !== '')
  const unique = [...new Set(names)]
  return unique.length === 0
    ? undefined
    : unique.map(name => (/\s/.test(name) ? `"${name}"` : name)).join(', ')
}

/**
 * Word's named highlight colours, as the CSS colours they mean.
 *
 * A highlight is a *name* in OOXML rather than a colour — `w:highlight
 * w:val="yellow"` — so the two spellings have to be mapped in both directions,
 * here and in the writer.
 */
const HIGHLIGHT_COLORS: Readonly<Record<string, string>> = {
  black: '#000000', blue: '#0000ff', cyan: '#00ffff', green: '#00ff00', magenta: '#ff00ff',
  red: '#ff0000', yellow: '#ffff00', white: '#ffffff', darkblue: '#000080', darkcyan: '#008080',
  darkgreen: '#008000', darkmagenta: '#800080', darkred: '#800000', darkyellow: '#808000',
  darkgray: '#808080', lightgray: '#c0c0c0',
}

/**
 * The CSS colour a six-digit hex value means.
 * @param value - the value as the document wrote it.
 * @returns the colour, or undefined for `auto` and for anything that is not a
 * hex value this model can carry.
 */
function hexColor(value: string | undefined): string | undefined {
  return value !== undefined && /^[0-9a-fA-F]{6}$/.test(value) ? `#${value.toLowerCase()}` : undefined
}

/**
 * Whether one run is underlined.
 *
 * `w:u` is not a toggle like `w:b`: it carries *which* rule to draw, and `none`
 * is the one value that means there is no underline.
 * @param properties - the run's `w:rPr`, when it has one.
 * @returns whether the run is underlined.
 */
function underlineOf(properties: XmlElement | undefined): boolean | undefined {
  if (properties === undefined) return undefined
  const underline = elements(properties, 'u')[0]
  if (underline === undefined) return undefined
  const value = attribute(underline, 'val')
  return value === undefined
    || (value !== 'none' && value !== '0' && value !== 'false' && value !== 'off')
}

/**
 * The colour one run is drawn in.
 * @param properties - the run's `w:rPr`, when it has one.
 * @returns the colour, or undefined when the document sets none.
 */
function colorOf(properties: XmlElement | undefined): string | undefined {
  return hexColor(childValue(properties, 'color'))
}

/**
 * The highlight behind one run.
 *
 * A named highlight is the usual spelling, but a shading fill is how a colour
 * outside the named set is written; both are read, and the page's own white is
 * not a highlight at all.
 * @param properties - the run's `w:rPr`, when it has one.
 * @returns the colour, or undefined when the run has no fill.
 */
function highlightOf(properties: XmlElement | undefined): string | undefined {
  const named = childValue(properties, 'highlight')
  if (named !== undefined) return HIGHLIGHT_COLORS[named.toLowerCase()]
  if (properties === undefined) return undefined
  const shading = elements(properties, 'shd')[0]
  if (shading === undefined) return undefined
  const fill = attribute(shading, 'fill')
  return fill !== undefined && fill.toLowerCase() !== 'ffffff' ? hexColor(fill) : undefined
}

/**
 * Where one paragraph's text sits across the column.
 * @param properties - the paragraph's `w:pPr`, when it has one.
 * @returns the alignment, or undefined for the left default and for the values
 * this model does not carry.
 */
function alignOf(properties: XmlElement | undefined): BlockAlign | undefined {
  const value = childValue(properties, 'jc')
  if (value === 'center') return 'center'
  if (value === 'right' || value === 'end') return 'right'
  if (value === 'both' || value === 'distribute') return 'justify'
  return undefined
}

/**
 * The first-line indent one `w:ind` states, as pixels.
 * @param indent - the `w:ind` element, when there is one.
 * @returns the indent, positive for a first-line indent and negative for a
 * hanging one.
 */
function firstLineOf(indent: XmlElement | undefined): number | undefined {
  if (indent === undefined) return undefined
  const first = twipsToPx(attribute(indent, 'firstLine'))
  if (first !== undefined) return first
  const hanging = twipsToPx(attribute(indent, 'hanging'))
  return hanging === undefined ? undefined : -hanging
}

/**
 * Fold one run properties element into a run style.
 *
 * A property the element *states* wins, including when it states it off — a
 * later style turning bold off is as meaningful as one turning it on. A property
 * it does not mention leaves the inherited value alone, which is what makes this
 * fold a cascade rather than an override.
 * @param style - the style inherited so far.
 * @param properties - the `w:rPr` element, when there is one.
 * @returns the style after this element.
 */
function applyRunProperties(style: RunStyle, properties: XmlElement | undefined): RunStyle {
  if (properties === undefined) return style
  const stated = (local: string): boolean | undefined => {
    const element = elements(properties, local)[0]
    return element === undefined ? undefined : isOn(element)
  }
  const vertical = childValue(properties, 'vertAlign')
  return {
    bold: stated('b') ?? style.bold,
    italic: stated('i') ?? style.italic,
    code: style.code || isCodeFont(properties),
    underline: underlineOf(properties) ?? style.underline,
    strike: stated('strike') ?? stated('dstrike') ?? style.strike,
    // A vertical alignment clears whichever of the two it is not.
    sup: vertical === 'superscript'
      ? true
      : vertical === 'subscript' || vertical === 'baseline' ? false : style.sup,
    sub: vertical === 'subscript'
      ? true
      : vertical === 'superscript' || vertical === 'baseline' ? false : style.sub,
    color: colorOf(properties) ?? style.color,
    highlight: highlightOf(properties) ?? style.highlight,
    size: halfPointsToPx(childValue(properties, 'sz')) ?? style.size,
    font: fontOf(properties) ?? style.font,
  }
}

/**
 * Fold one paragraph properties element into a paragraph style.
 * @param style - the style inherited so far.
 * @param properties - the `w:pPr` element, when there is one.
 * @returns the style after this element.
 */
function applyParagraphProperties(
  style: ParagraphStyle,
  properties: XmlElement | undefined,
): ParagraphStyle {
  if (properties === undefined) return style
  const indent = elements(properties, 'ind')[0]
  const spacing = elements(properties, 'spacing')[0]
  const line = Number(spacing === undefined ? '' : attribute(spacing, 'line') ?? '')
  const rule = spacing === undefined ? undefined : attribute(spacing, 'lineRule')
  return {
    align: alignOf(properties) ?? style.align,
    indent: (indent === undefined
      ? undefined
      : twipsToPx(attribute(indent, 'left') ?? attribute(indent, 'start'))) ?? style.indent,
    firstLine: firstLineOf(indent) ?? style.firstLine,
    before: (spacing === undefined ? undefined : twipsToPx(attribute(spacing, 'before'))) ?? style.before,
    after: (spacing === undefined ? undefined : twipsToPx(attribute(spacing, 'after'))) ?? style.after,
    // `w:line` is 240ths of a line under the `auto` rule; the other two rules are
    // a fixed height this model has no way to state as a multiple.
    lineHeight: Number.isFinite(line) && line > 0 && rule !== 'exact' && rule !== 'atLeast'
      ? Math.round((line / 240) * 100) / 100
      : style.lineHeight,
  }
}

/**
 * A style and everything it is based on, nearest first.
 * @param table - the document's styles.
 * @param styleId - the style an element names, when it names one.
 * @returns the chain, nearest first; empty when nothing is named or defined.
 */
function styleChain(table: StyleTable, styleId: string | undefined): StyleDefinition[] {
  const chain: StyleDefinition[] = []
  const seen = new Set<string>()
  let id = styleId
  while (id !== undefined && !seen.has(id)) {
    seen.add(id)
    const style = table.byId.get(id)
    if (style === undefined) break
    chain.push(style)
    id = style.basedOn
  }
  return chain
}

/**
 * The run style a paragraph establishes for every run inside it.
 *
 * This is the whole reason the preview needs a style table: a real document's
 * runs carry almost nothing, and the font size and weight a reader sees come from
 * the document defaults and the paragraph style chain above them.
 * @param table - the document's styles.
 * @param styleId - the paragraph's effective style id.
 * @returns the inherited run style.
 */
function paragraphBaseStyle(table: StyleTable, styleId: string | undefined): RunStyle {
  let style = applyRunProperties(PLAIN, table.defaultRun)
  for (const definition of styleChain(table, styleId).reverse()) {
    style = applyRunProperties(style, definition.runProperties)
  }
  return style
}

/**
 * The block metrics one paragraph ends up with.
 * @param table - the document's styles.
 * @param paragraphProperties - the paragraph's own `w:pPr`, when it has one.
 * @param styleId - the paragraph's effective style id.
 * @returns the resolved metrics.
 */
function paragraphMetrics(
  table: StyleTable,
  paragraphProperties: XmlElement | undefined,
  styleId: string | undefined,
): ParagraphStyle {
  let style = PLAIN_PARAGRAPH
  for (const definition of styleChain(table, styleId).reverse()) {
    style = applyParagraphProperties(style, definition.paragraphProperties)
  }
  return applyParagraphProperties(style, paragraphProperties)
}

/**
 * The metrics a block carries, or undefined when the paragraph states none.
 * @param style - the resolved paragraph style.
 * @returns the block's metrics.
 */
function toMetrics(style: ParagraphStyle): BlockMetrics | undefined {
  const metrics: BlockMetrics = {
    ...(style.align === undefined ? {} : { align: style.align }),
    ...(style.indent === undefined ? {} : { indent: style.indent }),
    ...(style.firstLine === undefined ? {} : { firstLine: style.firstLine }),
    ...(style.before === undefined ? {} : { before: style.before }),
    ...(style.after === undefined ? {} : { after: style.after }),
    ...(style.lineHeight === undefined ? {} : { lineHeight: style.lineHeight }),
  }
  return Object.keys(metrics).length === 0 ? undefined : metrics
}

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
 * Read which style ids mean which heading level, and which mean a quote.
 *
 * A style's outline level is authoritative; the id itself is the fallback, and
 * it is checked in both the English and the Chinese spelling because a document
 * written by a localized Word names its own styles.
 * @param zip - the open package.
 * @returns the levels by style id, and the style ids that mean a quote.
 */
async function readStyles(zip: ZipArchive): Promise<StyleTable> {
  const byId = new Map<string, StyleDefinition>()
  let defaultRun: XmlElement | undefined
  let defaultParagraph: string | undefined
  const text = await zip.text('word/styles.xml')
  if (text === undefined) return { defaultRun, defaultParagraph, byId }
  const root = parseXml(text)
  const defaults = firstDescendant(root, 'docDefaults')
  if (defaults !== undefined) {
    const runDefault = elements(defaults, 'rPrDefault')[0]
    if (runDefault !== undefined) defaultRun = elements(runDefault, 'rPr')[0]
  }
  for (const style of descendants(root, 'style')) {
    const id = attribute(style, 'styleId')
    if (id === undefined) continue
    const type = attribute(style, 'type') ?? 'paragraph'
    // The default paragraph style is what applies where a paragraph names none,
    // and it is where a document's body formatting usually lives.
    if (type === 'paragraph' && attribute(style, 'default') === '1') defaultParagraph = id
    byId.set(id, {
      id,
      type,
      name: childValue(style, 'name'),
      basedOn: childValue(style, 'basedOn'),
      runProperties: elements(style, 'rPr')[0],
      paragraphProperties: elements(style, 'pPr')[0],
    })
  }
  return { defaultRun, defaultParagraph, byId }
}

/**
 * Whether one style id or style name means a quote.
 * @param value - the style's id or its name.
 * @returns whether it is the quote style.
 */
function isQuoteName(value: string): boolean {
  return /^(?:quote|blockquote|引用)$/i.test(value.trim())
}

/**
 * The heading level a paragraph's style chain states.
 *
 * A style's outline level is authoritative; its name and then its id are the
 * fallback, which is what catches the localized documents a Word in another
 * language writes — a Chinese Word names its heading styles `1`, `2`, `3` and
 * gives them the name `heading 1`.
 * @param chain - the style chain, nearest first.
 * @returns the level, or undefined when the chain states none.
 */
function headingLevelOf(chain: readonly StyleDefinition[]): number | undefined {
  for (const definition of chain) {
    const outline = childValue(definition.paragraphProperties, 'outlineLvl')
    if (outline === undefined) continue
    const level = Number(outline)
    // Nine is "body text" spelled as an outline level: not a heading.
    return Number.isFinite(level) && level >= 0 && level <= 8 ? headingLevel(level + 1) : undefined
  }
  // The style's own name is what a localized Word writes (`heading 1` under an id
  // of `1`); the id is what a document written in English carries.
  for (const definition of chain) {
    for (const candidate of [definition.name, definition.id]) {
      if (candidate === undefined) continue
      const named = /^(?:heading|标题)\s*([1-9])$/i.exec(candidate.trim())
      if (named !== null) return headingLevel(Number(named[1]))
      if (/^(?:title|标题)$/i.test(candidate.trim())) return 1
    }
  }
  // A numeric id with no name is still a heading level in a localized document.
  for (const definition of chain) {
    const numeric = /^([1-9])$/.exec(definition.id.trim())
    if (numeric !== null) return headingLevel(Number(numeric[1]))
  }
  return undefined
}

/**
 * Whether a paragraph's style chain says it is a quote.
 * @param chain - the style chain, nearest first.
 * @returns whether any style in it is the quote style.
 */
function isQuoteStyle(chain: readonly StyleDefinition[]): boolean {
  return chain.some(definition => isQuoteName(definition.name ?? '') || isQuoteName(definition.id))
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
  if (previous !== undefined && sameStyle(previous, style)) {
    runs[runs.length - 1] = { ...previous, text: previous.text + text }
    return
  }
  runs.push({
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.code ? { code: true } : {}),
    ...(style.underline ? { underline: true } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(style.sup ? { sup: true } : {}),
    ...(style.sub ? { sub: true } : {}),
    ...(style.color === undefined ? {} : { color: style.color }),
    ...(style.highlight === undefined ? {} : { highlight: style.highlight }),
    ...(style.size === undefined ? {} : { size: style.size }),
    ...(style.font === undefined ? {} : { font: style.font }),
  })
}

/**
 * Whether a run already in the list carries the same emphasis as the text
 * arriving, which is what lets the two become one run.
 * @param run - the run already there.
 * @param style - the emphasis the arriving text carries.
 * @returns whether they merge.
 */
function sameStyle(run: InlineRun, style: RunStyle): boolean {
  return (run.bold === true) === style.bold
    && (run.italic === true) === style.italic
    && (run.code === true) === style.code
    && (run.underline === true) === style.underline
    && (run.strike === true) === style.strike
    && (run.sup === true) === style.sup
    && (run.sub === true) === style.sub
    && (run.color ?? '') === (style.color ?? '')
    && (run.highlight ?? '') === (style.highlight ?? '')
    && (run.size ?? 0) === (style.size ?? 0)
    && (run.font ?? '') === (style.font ?? '')
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
function pushRun(run: XmlElement, base: RunStyle, table: StyleTable, runs: InlineRun[]): void {
  const properties = elements(run, 'rPr')[0]
  // The run's own formatting is the last word in a cascade that starts at the
  // document defaults and passes through the paragraph's style chain.
  let style = base
  for (const definition of styleChain(table, childValue(properties, 'rStyle')).reverse()) {
    style = applyRunProperties(style, definition.runProperties)
  }
  style = applyRunProperties(style, properties)
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
function readRuns(
  container: XmlElement,
  base: RunStyle,
  table: StyleTable,
  runs: InlineRun[],
): void {
  for (const child of container.children) {
    if (!isElement(child)) continue
    switch (child.local) {
      case 'r': pushRun(child, base, table, runs); break
      case 'hyperlink': case 'ins': case 'smartTag': case 'dir': case 'bdo':
        readRuns(child, base, table, runs)
        break
      case 'sdt': {
        const content = elements(child, 'sdtContent')[0]
        if (content !== undefined) readRuns(content, base, table, runs)
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
 * @param element - the `w:tbl` element.
 * @param styles - the document's styles, which a cell's runs inherit from.
 * @returns the block, or undefined when the table holds no cell.
 */
function tableBlock(element: XmlElement, styles: StyleTable): Block | undefined {
  const rows: { cells: TableCell[] }[] = []
  for (const row of elements(element, 'tr')) {
    const cells: TableCell[] = []
    for (const cell of elements(row, 'tc')) {
      const runs: InlineRun[] = []
      for (const paragraph of elements(cell, 'p')) {
        const own: InlineRun[] = []
        const properties = elements(paragraph, 'pPr')[0]
        readRuns(
          paragraph,
          paragraphBaseStyle(styles, childValue(properties, 'pStyle') ?? styles.defaultParagraph),
          styles,
          own,
        )
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
  const styles = await readStyles(zip)
  const numbering = await readNumbering(zip)

  const blocks: Block[] = []
  let truncated = mediaTruncated

  const visitParagraph = (paragraph: XmlElement): void => {
    if (blocks.length >= MAX_BLOCKS) {
      truncated = true
      return
    }
    const properties = elements(paragraph, 'pPr')[0]
    // A paragraph that names no style still has one: the document's default.
    // That is where a document's body formatting usually lives, so missing it
    // would drop the justification and the font size of every ordinary line.
    const style = childValue(properties, 'pStyle') ?? styles.defaultParagraph
    const chain = styleChain(styles, style)
    const runs: InlineRun[] = []
    readRuns(paragraph, paragraphBaseStyle(styles, style), styles, runs)
    const outline = childValue(properties, 'outlineLvl')
    const level = outline !== undefined && Number(outline) >= 0 && Number(outline) <= 8
      ? headingLevel(Number(outline) + 1)
      : headingLevelOf(chain)
    const metrics = toMetrics(paragraphMetrics(styles, properties, style))
    if (runs.length > 0) {
      const withMetrics = metrics === undefined ? {} : { metrics }
      if (level !== undefined) {
        blocks.push({ kind: 'heading', level, runs, ...withMetrics })
      } else if (isQuoteStyle(chain)) {
        blocks.push({ kind: 'quote', runs, ...withMetrics })
      } else {
        const numberingProperties = properties === undefined ? undefined : elements(properties, 'numPr')[0]
        const numberingId = childValue(numberingProperties, 'numId')
        if (numberingId === undefined) {
          blocks.push({ kind: 'paragraph', runs, ...withMetrics })
        } else {
          const depth = Number(childValue(numberingProperties, 'ilvl') ?? '0')
          const format = numbering.get(numberingId)?.get(Number.isFinite(depth) ? depth : 0)
          // A numbering definition this package does not describe is still a list
          // item; it is shown as a bullet rather than as a bare paragraph.
          const ordered = format !== undefined && format !== 'bullet' && format !== 'none'
          blocks.push({
            kind: 'list',
            ordered,
            depth: Number.isFinite(depth) ? depth : 0,
            runs,
            ...withMetrics,
          })
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
        const table = tableBlock(child, styles)
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
