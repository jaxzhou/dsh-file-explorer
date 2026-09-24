/**
 * Reading a `.pptx`: what each slide says, and the pictures on it.
 *
 * A slide is a canvas of positioned shapes, and drawing that canvas faithfully
 * needs a layout engine, a theme, and every font the deck names — none of which
 * is here, and none of which could be, at the size a preview pane can carry. So
 * this reader takes the part of a slide that survives without layout: its title,
 * its text, in shape order, and its pictures. A deck read this way is an outline
 * of itself — which is what someone looking for the right file in a file browser
 * is trying to see.
 */
import { dataUrlOf, imageMediaTypeOf, resolvePart } from './binary.ts'
import { readRelationships } from './package.ts'
import { attribute, descendants, elements, firstDescendant, isElement, parseXml, textContent, type XmlElement } from './xml.ts'
import { openZip, type ZipArchive } from './zip.ts'

/** One slide, as the pane draws it. */
export interface SlideContent {
  /** The deck's own title for the slide, when it has a title placeholder. */
  readonly title: string | undefined
  /** The text on the slide, one entry per paragraph, in shape order. */
  readonly lines: readonly string[]
  /** The pictures on the slide, as data URLs. */
  readonly images: readonly string[]
}

/** A presentation, as the preview draws it. */
export interface SlidesDocument {
  readonly kind: 'slides'
  /** The slides, in presentation order. */
  readonly slides: readonly SlideContent[]
  /** The deck held more slides than this reader shows. */
  readonly truncated: boolean
}

/** How many slides one deck may contribute to the pane. */
const MAX_SLIDES = 30

/** How many pictures one slide may contribute. */
const MAX_SLIDE_IMAGES = 8

/** How many text paragraphs one slide may contribute. */
const MAX_SLIDE_LINES = 40

/**
 * The text of one drawing paragraph, breaks included.
 * @param paragraph - the `a:p` element.
 * @returns its text.
 */
function paragraphText(paragraph: XmlElement): string {
  let text = ''
  for (const child of paragraph.children) {
    if (!isElement(child)) continue
    if (child.local === 'br') text += '\n'
    else if (child.local === 'r' || child.local === 'fld') {
      text += descendants(child, 't').map(node => textContent(node)).join('')
    }
  }
  return text
}

/**
 * The text of one shape's body.
 * @param shape - the shape element.
 * @returns its paragraphs, newline-joined.
 */
function shapeText(shape: XmlElement): string {
  const body = elements(shape, 'txBody')[0]
  if (body === undefined) return ''
  return elements(body, 'p').map(paragraphText).filter(text => text !== '').join('\n')
}

/**
 * Whether one shape is the slide's title placeholder.
 * @param shape - the shape element.
 * @returns whether it holds the title.
 */
function isTitleShape(shape: XmlElement): boolean {
  const placeholder = firstDescendant(shape, 'ph')
  if (placeholder === undefined) return false
  const type = attribute(placeholder, 'type')
  return type === 'title' || type === 'ctrTitle'
}

/**
 * Read every picture one slide points at.
 * @param zip - the open package.
 * @param part - the slide's part path.
 * @returns a data URL by relationship id.
 */
async function slideMedia(zip: ZipArchive, part: string): Promise<Map<string, string>> {
  const media = new Map<string, string>()
  const folder = part.slice(0, part.lastIndexOf('/'))
  for (const [id, relationship] of await readRelationships(zip, part)) {
    if (relationship.external) continue
    const path = resolvePart(folder, relationship.target)
    const mediaType = imageMediaTypeOf(path)
    if (mediaType === undefined) continue
    const data = await zip.read(path)
    if (data === undefined) continue
    media.set(id, dataUrlOf(data, mediaType))
  }
  return media
}

/**
 * The pictures one shape draws.
 * @param shape - the shape or picture element.
 * @param media - the slide's pictures by relationship id.
 * @returns their data URLs, in shape order.
 */
function shapeImages(shape: XmlElement, media: ReadonlyMap<string, string>): string[] {
  const found: string[] = []
  for (const blip of descendants(shape, 'blip')) {
    const id = blip.attributes.get('r:embed') ?? attribute(blip, 'embed')
    if (id === undefined) continue
    const src = media.get(id)
    if (src !== undefined) found.push(src)
  }
  return found
}

/**
 * Read one slide.
 * @param zip - the open package.
 * @param part - the slide's part path.
 * @param source - the slide's XML.
 * @returns the slide's content.
 */
async function readSlide(zip: ZipArchive, part: string, source: string): Promise<SlideContent> {
  const media = await slideMedia(zip, part)
  const root = parseXml(source)
  let title: string | undefined
  const lines: string[] = []
  const images: string[] = []
  const shapes = [
    ...descendants(root, 'sp'),
    // A picture is its own shape kind, not a shape with a fill.
    ...descendants(root, 'pic'),
    // A table or a chart lives in a graphic frame; its text is still text.
    ...descendants(root, 'graphicFrame'),
  ]
  for (const shape of shapes) {
    const text = shapeText(shape)
    if (text !== '' && title === undefined && isTitleShape(shape)) {
      title = text
    } else if (text !== '') {
      for (const line of text.split('\n')) {
        if (lines.length >= MAX_SLIDE_LINES) break
        lines.push(line)
      }
    }
    for (const image of shapeImages(shape, media)) {
      if (images.length >= MAX_SLIDE_IMAGES) break
      images.push(image)
    }
  }
  return { title, lines, images }
}

/**
 * Read one `.pptx` package.
 * @param bytes - the package's bytes.
 * @returns the deck's slides.
 */
export async function readSlides(bytes: Uint8Array): Promise<SlidesDocument> {
  const zip = openZip(bytes)
  const presentation = await zip.text('ppt/presentation.xml')
  if (presentation === undefined) {
    throw new Error('this file is not a presentation: it has no ppt/presentation.xml part')
  }
  const relationships = await readRelationships(zip, 'ppt/presentation.xml')
  const slides: SlideContent[] = []
  let truncated = false
  // The slide list is the order the deck shows, which is not the order the parts
  // are named in.
  for (const node of descendants(parseXml(presentation), 'sldId')) {
    if (slides.length >= MAX_SLIDES) {
      truncated = true
      break
    }
    const id = node.attributes.get('r:id') ?? attribute(node, 'id')
    const relationship = id === undefined ? undefined : relationships.get(id)
    if (relationship === undefined || relationship.external) {
      slides.push({ title: undefined, lines: [], images: [] })
      continue
    }
    const part = resolvePart('ppt', relationship.target)
    const source = await zip.text(part)
    slides.push(source === undefined
      ? { title: undefined, lines: [], images: [] }
      : await readSlide(zip, part, source))
  }
  return { kind: 'slides', slides, truncated }
}
