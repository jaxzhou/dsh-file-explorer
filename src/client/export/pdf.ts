/**
 * A minimal PDF writer, for one document made of page-sized images.
 *
 * There is no PDF library in this bundle, and there cannot be a text-mode one:
 * the documents this plugin previews are usually Chinese, and the standard PDF
 * fonts carry no CJK glyphs — laying the text out as text would mean embedding a
 * font file of several megabytes. So the pages are rasterised from what the
 * reader is already looking at, and this module writes the container: a catalog,
 * a page tree, and per page one JPEG image and one content stream that paints it.
 *
 * Pure: bytes in, bytes out, so the tests can parse what it wrote.
 */

/** One page: a JPEG of the page's content, at the pixel size it was rasterised to. */
export interface PdfPage {
  /** The page's image, JPEG-encoded (DCTDecode accepts it unchanged). */
  readonly jpeg: Uint8Array
  /** Image width in pixels. */
  readonly width: number
  /** Image height in pixels. */
  readonly height: number
}

/** A4 in PDF points (72 per inch), which is the page box every page is fitted to. */
export const A4_WIDTH_PT = 595.28
export const A4_HEIGHT_PT = 841.89

/** ASCII bytes of a PDF keyword, comment, or object frame. */
function ascii(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index++) out[index] = value.charCodeAt(index) & 0x7f
  return out
}

/**
 * Write one PDF whose pages each carry one JPEG.
 *
 * Page media boxes keep the image's own aspect ratio and are fitted to A4's width,
 * so a short final page prints short rather than padded with white. Objects are
 * laid out in one predictable order — catalog, page tree, then per page its page
 * dictionary, content stream, and image — which is what makes the cross-reference
 * table computable as the file is built rather than patched afterwards.
 * @param pages - the pages, in order.
 * @returns the file's bytes.
 */
export function pdfFromPages(pages: readonly PdfPage[]): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 0
  /** Byte offset of each object, indexed by object number (1-based). */
  const offsets: number[] = []

  const write = (bytes: Uint8Array): void => {
    chunks.push(bytes)
    offset += bytes.length
  }
  const object = (number: number, body: Uint8Array, stream?: Uint8Array): void => {
    offsets[number] = offset
    write(ascii(`${number} 0 obj\n`))
    write(body)
    if (stream !== undefined) {
      write(ascii('\nstream\n'))
      write(stream)
      write(ascii('\nendstream'))
    }
    write(ascii('\nendobj\n'))
  }

  // Object numbering: 1 catalog, 2 page tree, then three per page.
  const pageObject = (index: number): number => 3 + index * 3
  const contentObject = (index: number): number => 4 + index * 3
  const imageObject = (index: number): number => 5 + index * 3

  write(ascii('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'))
  object(1, ascii(`<< /Type /Catalog /Pages 2 0 R >>`))
  const kids = pages.map((_page, index) => `${pageObject(index)} 0 R`).join(' ')
  object(2, ascii(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`))

  for (const [index, page] of pages.entries()) {
    const pageHeight = A4_WIDTH_PT * (page.height / page.width)
    object(
      pageObject(index),
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_PT.toFixed(2)} ${pageHeight.toFixed(2)}]`
        + ` /Resources << /XObject << /Im0 ${imageObject(index)} 0 R >> >>`
        + ` /Contents ${contentObject(index)} 0 R >>`,
      ),
    )
    // The unit square the image paints into is the whole page: `cm` scales it.
    const content = `q\n${A4_WIDTH_PT.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`
    object(contentObject(index), ascii(`<< /Length ${content.length} >>`), ascii(content))
    object(
      imageObject(index),
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height}`
        + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`
        + ` /Length ${page.jpeg.length} >>`,
      ),
      page.jpeg,
    )
  }

  const objectCount = offsets.length
  const xrefOffset = offset
  write(ascii(`xref\n0 ${objectCount}\n`))
  write(ascii('0000000000 65535 f \n'))
  for (let number = 1; number < objectCount; number++) {
    const at = offsets[number]
    // A gap would mean an object was skipped, which this builder never does; the
    // fallback keeps the table parseable if one ever were.
    write(ascii(`${String(at ?? 0).padStart(10, '0')} 00000 n \n`))
  }
  write(ascii(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`))
  return concatenate(chunks)
}

/**
 * Join byte chunks into one buffer.
 * @param chunks - the chunks, in order.
 * @returns their concatenation.
 */
function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0
  for (const chunk of chunks) length += chunk.length
  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * Decode the base64 payload of a data URL.
 * @param dataUrl - a `data:...;base64,...` URL.
 * @returns its bytes, or undefined when it is not a base64 data URL.
 */
export function bytesOfDataUrl(dataUrl: string): Uint8Array | undefined {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !dataUrl.slice(0, comma).includes(';base64')) return undefined
  try {
    const binary = atob(dataUrl.slice(comma + 1))
    const out = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index)
    return out
  } catch {
    return undefined
  }
}
