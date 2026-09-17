/**
 * A minimal Word writer: a valid `.docx` package built from the document model.
 *
 * Text stays text. That is the point of exporting Word as well as PDF — the PDF is
 * a picture of the page (Chinese text cannot be laid out as text without embedding
 * a font file), while a `.docx` carries the structure and lets Word render it with
 * its own fonts, so the reader can edit it, search it, and re-style it.
 *
 * The package is the smallest one Word accepts: a content-types part, the root
 * relationships, the document, and one media part per embedded image. Formatting is
 * applied directly on runs and paragraphs rather than through a styles part, which
 * removes a whole file from the package and a class of "style not found" failures.
 */
import type { Block, InlineRun } from './model.ts'
import { bytesOfDataUrl } from './pdf.ts'
import { zip, type ZipPart } from './zip.ts'

/** English Metric Units per CSS pixel at 96 dpi, which is how Word measures. */
const EMU_PER_PX = 9525

/** The width a picture may occupy: A4 inside one-inch margins, in EMU. */
const MAX_IMAGE_EMU = Math.round(6.5 * 914400)

/** Half-points per heading level, which is the unit `w:sz` uses. */
const HEADING_HALF_POINTS: Readonly<Record<number, number>> = {
  1: 36, 2: 30, 3: 26, 4: 24, 5: 22, 6: 22,
}

/** The media part one embedded image needs. */
interface Media {
  /** Relationship id the drawing references. */
  readonly id: string
  /** Part name under `word/`, such as `media/image1.png`. */
  readonly name: string
  /** The image's bytes. */
  readonly data: Uint8Array
  /** Content-type extension the package declares. */
  readonly extension: string
}

/**
 * Escape text for XML content.
 * @param value - the text.
 * @returns the text with markup characters escaped.
 */
function xml(value: string): string {
  return value.replace(/[&<>]/g, (character) => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      default: return '&gt;'
    }
  })
}

/**
 * One run of text as `w:r`.
 * @param run - the run, with its emphasis.
 * @returns the run's XML.
 */
function runXml(run: InlineRun): string {
  const properties = [
    run.bold === true ? '<w:b/>' : '',
    run.italic === true ? '<w:i/>' : '',
    run.code === true ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '',
  ].join('')
  const prefix = properties === '' ? '' : `<w:rPr>${properties}</w:rPr>`
  // A newline inside a run is a line break, not a paragraph separator.
  const parts = run.text.split('\n')
    .map((line, index) => `${index === 0 ? '' : '<w:br/>'}<w:t xml:space="preserve">${xml(line)}</w:t>`)
    .join('')
  return `<w:r>${prefix}${parts}</w:r>`
}

/**
 * One paragraph as `w:p`.
 * @param runs - the paragraph's runs.
 * @param properties - paragraph properties, already as XML.
 * @returns the paragraph's XML.
 */
function paragraphXml(runs: readonly InlineRun[], properties = ''): string {
  const prefix = properties === '' ? '' : `<w:pPr>${properties}</w:pPr>`
  return `<w:p>${prefix}${runs.map(runXml).join('')}</w:p>`
}

/**
 * One inline image as `w:drawing`, scaled to fit the text column.
 * @param media - the image's relationship and part.
 * @param width - its rendered width in CSS pixels.
 * @param height - its rendered height in CSS pixels, which sets the aspect ratio.
 * @returns the drawing's XML.
 */
function drawingXml(media: Media, width: number | undefined, height: number | undefined): string {
  const ratio = width !== undefined && height !== undefined && width > 0 ? height / width : 0.5
  const cx = Math.min(Math.round((width ?? 400) * EMU_PER_PX), MAX_IMAGE_EMU)
  const cy = Math.round(cx * ratio)
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="${xml(media.name)}"/>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic><pic:nvPicPr>'
    + `<pic:cNvPr id="0" name="${xml(media.name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${media.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/>'
    + `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
}

/**
 * One table as `w:tbl`, with visible borders and equal columns.
 * @param rows - the rows' cells.
 * @returns the table's XML.
 */
function tableXml(rows: readonly { readonly cells: readonly { readonly runs: readonly InlineRun[] }[] }[]): string {
  const columns = Math.max(...rows.map(row => row.cells.length))
  const width = Math.floor(9360 / Math.max(columns, 1))
  const borders = '<w:tblBorders>'
    + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
      .join('')
    + '</w:tblBorders>'
  const grid = `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`
  const body = rows.map((row) => {
    const cells = row.cells.map(cell =>
      `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraphXml(cell.runs)}</w:tc>`)
    return `<w:tr>${cells.join('')}</w:tr>`
  }).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>${grid}${body}</w:tbl>`
}

/**
 * Write one document model as a `.docx` package.
 * @param blocks - the document's blocks, in order.
 * @param title - the document title, kept as package metadata and as a heading-less first line only if it is a block already.
 * @returns the package's bytes.
 */
export function docxFromBlocks(blocks: readonly Block[], title: string): Uint8Array {
  const media: Media[] = []
  const body: string[] = []
  /** Items already emitted for the list being written, and which list that is. */
  let listRun = { ordered: false, depth: -1, count: 0 }

  for (const block of blocks) {
    // A block that is not a list ends the run, so the next list starts at one.
    if (block.kind !== 'list') listRun = { ordered: false, depth: -1, count: 0 }
    switch (block.kind) {
      case 'heading': {
        const size = HEADING_HALF_POINTS[block.level] ?? 24
        body.push(paragraphXml(
          block.runs.map(run => ({ ...run, bold: true })),
          `<w:spacing w:before="240" w:after="120"/><w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`,
        ))
        break
      }
      case 'paragraph':
        body.push(paragraphXml(block.runs, '<w:spacing w:after="120"/>'))
        break
      case 'quote':
        body.push(paragraphXml(
          block.runs.map(run => ({ ...run, italic: true })),
          '<w:ind w:left="480"/><w:spacing w:after="120"/>',
        ))
        break
      case 'list': {
        // Markers are written into the text rather than taken from a numbering
        // definition: a package with no numbering part has nowhere else to keep
        // them, and a number typed here is still a number Word shows.
        const sameList = listRun.ordered === block.ordered && listRun.depth === block.depth
        listRun = { ordered: block.ordered, depth: block.depth, count: sameList ? listRun.count + 1 : 1 }
        const marker = block.ordered ? `${listRun.count}.\u00a0` : '\u2022\u00a0'
        const indent = 360 + block.depth * 360
        body.push(paragraphXml(
          [{ text: marker }, ...block.runs],
          `<w:ind w:left="${indent}" w:hanging="180"/><w:spacing w:after="40"/>`,
        ))
        break
      }
      case 'code': {
        const lines = block.text.split('\n')
        body.push(...lines.map(line => paragraphXml(
          line === '' ? [] : [{ text: line, code: true }],
          '<w:ind w:left="240"/><w:spacing w:after="0"/><w:shd w:val="clear" w:fill="F2F3F5"/>'
          + '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr>',
        )))
        break
      }
      case 'rule':
        body.push(paragraphXml([], '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr>'))
        break
      case 'table':
        body.push(tableXml(block.rows))
        break
      case 'image': {
        const data = bytesOfDataUrl(block.src)
        // Only an image this export could read is embedded; a remote one would need
        // a fetch the page is not allowed to make. Its alt text keeps the place.
        if (data === undefined) {
          if (block.alt !== '') body.push(paragraphXml([{ text: block.alt, italic: true }]))
          break
        }
        const extension = block.src.slice(5, block.src.indexOf(';')) === 'image/jpeg' ? 'jpeg' : 'png'
        const name = `media/image${media.length + 1}.${extension}`
        const entry: Media = { id: `rIdImage${media.length + 1}`, name, data, extension }
        media.push(entry)
        body.push(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${drawingXml(entry, block.width, block.height)}</w:p>`)
        break
      }
    }
  }

  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document'
    + ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<w:body>${body.join('')}`
    // A4 in twips, with one-inch margins: the same page the PDF export uses.
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>'
    + '</w:sectPr>'
    + '</w:body></w:document>'

  const extensions = new Set(media.map(entry => entry.extension))
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + (extensions.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : '')
    + (extensions.has('jpeg') ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : '')
    + '<Override PartName="/word/document.xml"'
    + ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    // The package's own properties part needs its content type stated too, or a
    // reader sees a part it cannot name.
    + '<Override PartName="/docProps/core.xml"'
    + ' ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '</Types>'

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdDocument"'
    + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
    + ' Target="word/document.xml"/>'
    + '</Relationships>'

  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + media.map(entry => '<Relationship'
      + ` Id="${entry.id}"`
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'
      + ` Target="${entry.name}"/>`).join('')
    + '</Relationships>'

  const parts: ZipPart[] = [
    { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
    { name: '_rels/.rels', data: new TextEncoder().encode(rootRels) },
    { name: 'word/document.xml', data: new TextEncoder().encode(document) },
    ...(media.length === 0 ? [] : [{ name: 'word/_rels/document.xml.rels', data: new TextEncoder().encode(documentRels) }]),
    ...media.map(entry => ({ name: `word/${entry.name}`, data: entry.data })),
    // Word records the title as package metadata; the reader sees it as the file's
    // name when saving, which is where a title belongs for an export.
    { name: 'docProps/core.xml', data: new TextEncoder().encode(coreXml(title)) },
  ]
  return zip(parts)
}

/**
 * The package's core properties part, carrying the document title.
 * @param title - the document's title.
 * @returns the part's XML.
 */
function coreXml(title: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties'
    + ' xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + `<dc:title>${xml(title)}</dc:title>`
    + '</cp:coreProperties>'
}
