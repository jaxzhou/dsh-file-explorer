/**
 * Turning one previewed document into a file the reader can save.
 *
 * Two formats, two shapes of output, and the difference is deliberate:
 *
 * - **PDF** is a picture of the page. It cannot be text: these documents are
 *   usually Chinese, the standard PDF fonts carry no CJK glyphs, and embedding a
 *   font would mean shipping megabytes in a preview plugin. So the pages are
 *   rasterised from what the reader is looking at, and {@link rasterPages} slices
 *   the document into A4-proportioned chunks.
 * - **Word** is a document. Structure and text survive, which is what makes it
 *   editable and searchable, and Chinese renders with Word's own fonts.
 *
 * Both downloads are built in the page and saved through a Blob URL, because the
 * request is a download rather than a trip through the print dialog.
 *
 * Rasterising inlines `html2canvas`. It is the one outside module in this bundle,
 * and it is here for one reason: a PDF of these documents cannot be text — the
 * standard PDF fonts carry no CJK glyphs — so something has to draw the DOM, and
 * the browser exposes no API for that.
 */
import { A4_HEIGHT_PT, A4_WIDTH_PT, bytesOfDataUrl, pdfFromPages, type PdfPage } from './pdf.ts'
import { docxFromBlocks } from './docx.ts'
import { blocksFromElement } from './model.ts'
import { isRelativeDestination, MAX_DOCUMENT_IMAGES, resolveRelativePath } from '../markdown-assets.ts'

/** The format a reader can export to. */
export type ExportFormat = 'pdf' | 'word'

/** The document being exported, and how to reach it. */
export interface ExportRequest {
  /** The file's name, which becomes the download's name. */
  readonly name: string
  /** The document's title, kept as package metadata in a Word file. */
  readonly title: string
  /** Which body the preview is showing, because the two are read differently. */
  readonly kind: 'markdown' | 'html'
  /** The rendered Markdown container. */
  readonly prose: HTMLElement | null
  /** The HTML file's text, for an `html` document. */
  readonly html: string
  /** Absolute directory holding the file, which its relative assets resolve against. */
  readonly directory: string
  /** The readers that let an HTML export stand alone. */
  readonly assets: ExportAssetReaders
}

/** The raster width of one PDF page: A4 at about 150 dpi. */
const PAGE_RASTER_WIDTH = 1240

/** A document taller than this is truncated rather than rasterised forever. */
const MAX_PAGES = 60

/** How long to wait for the document's images before rasterising without them. */
const IMAGE_SETTLE_MS = 10_000

/**
 * Make every image in one subtree loadable and wait for it.
 *
 * The preview marks images `loading="lazy"`, so an image below the fold has not
 * been fetched when the export starts — and a rasterised page cannot wait for a
 * load that will never begin. Forcing eager and awaiting `decode` puts the page's
 * pictures on the page, and the timeout keeps one broken image from stopping the
 * export.
 * @param root - the element about to be rasterised.
 */
async function settleImages(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll('img')]
  const pending = images.map((image) => {
    image.loading = 'eager'
    return image.decode().catch(() => undefined)
  })
  if (pending.length === 0) return
  await Promise.race([
    Promise.allSettled(pending),
    new Promise(resolve => setTimeout(resolve, IMAGE_SETTLE_MS)),
  ])
}

/**
 * Rasterise one element into A4-proportioned pages.
 *
 * The element is drawn **once** and the canvas is sliced, rather than drawn once
 * per page: a rasteriser walks the whole document on every call, so a nineteen-page
 * document would otherwise be laid out nineteen times. One call also means one
 * chance for the layout to differ from what the reader sees.
 * @param element - the element holding the document.
 * @returns one page per slice, each carrying its JPEG.
 */
export async function rasterPages(element: HTMLElement): Promise<PdfPage[]> {
  // Imported here rather than at the top: `html2canvas` reads the document as its
  // module body runs, and a rasteriser has no business running — or needing a DOM —
  // in a plugin that is only being loaded. The bytes are in the same artifact either
  // way; this is about when they execute.
  const { default: html2canvas } = await import('html2canvas')
  await settleImages(element)
  const width = Math.max(Math.ceil(element.getBoundingClientRect().width), 1)
  const rendered = await html2canvas(element, {
    scale: PAGE_RASTER_WIDTH / width,
    backgroundColor: '#ffffff',
    logging: false,
  })
  const pageHeight = Math.round(rendered.width * (A4_HEIGHT_PT / A4_WIDTH_PT))
  const pageCount = Math.min(Math.ceil(rendered.height / pageHeight), MAX_PAGES)
  const pages: PdfPage[] = []
  for (let index = 0; index < pageCount; index++) {
    const top = index * pageHeight
    const height = Math.min(pageHeight, rendered.height - top)
    if (height <= 0) break
    const slice = document.createElement('canvas')
    slice.width = rendered.width
    slice.height = height
    const context = slice.getContext('2d')
    if (context === null) continue
    // The slice's own coordinate space starts at this page's top.
    context.drawImage(rendered, 0, -top)
    const jpeg = bytesOfDataUrl(slice.toDataURL('image/jpeg', 0.92))
    if (jpeg !== undefined) pages.push({ jpeg, width: slice.width, height: slice.height })
  }
  return pages
}

/**
 * Render an HTML document off screen so it can be read as a DOM and rasterised.
 *
 * The preview's own frame is sandboxed and opaque to this code by design, so the
 * export needs its own copy. This one is same-origin — but the copy it is given has
 * had its scripts and handlers stripped first, so there is nothing in it that could
 * use that origin.
 * @param html - a complete, script-free HTML document.
 * @returns the frame, and a disposer that removes it.
 */
export function renderOffscreen(html: string): { frame: HTMLIFrameElement, body: HTMLElement, ready: Promise<void>, dispose: () => void } {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.dataset.previewRender = ''
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;background:#fff'
  document.body.append(frame)
  const ready = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => { resolve() }, { once: true })
  })
  const doc = frame.contentDocument
  if (doc !== null) {
    doc.open()
    doc.write(html)
    doc.close()
  }
  return {
    frame,
    body: (frame.contentDocument?.body ?? frame) as HTMLElement,
    ready,
    dispose: () => { frame.remove() },
  }
}

/**
 * Save one Blob to the reader's downloads.
 * @param blob - the file's contents.
 * @param name - the file's name.
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // The download reads the URL after this task returns, so it is released late.
  setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
}

/**
 * Strip the parts of an HTML document that must not run, and keep the rest.
 *
 * A PDF is static and a Word file is text, so neither export needs the document's
 * scripts — and dropping them is what lets the export render a same-origin copy
 * without handing the file this application's origin. Parsing is done by the
 * browser rather than by a pattern, so markup inside an attribute or a comment
 * cannot smuggle a tag past the strip.
 * @param source - the file's text.
 * @param title - title to add when the document declares none.
 * @returns an inert document with no scripts, handlers, or javascript URLs.
 */
export function parseHtml(source: string, title: string): Document {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  for (const script of [...parsed.querySelectorAll('script')]) script.remove()
  for (const element of [...parsed.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) element.removeAttribute(attribute.name)
      else if (/^\s*javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name)
    }
  }
  if (parsed.title === '') {
    const tag = parsed.createElement('title')
    tag.textContent = title
    parsed.head.append(tag)
  }
  return parsed
}

/**
 * Make an HTML document stand on its own, by reading what it points at.
 *
 * A file on disk refers to its pictures and its stylesheet by a path beside it. A
 * blob document has no base to resolve those against, and the export's own copy is
 * written into a frame the same way — so without this step the export of an HTML
 * file is a document with a hole where each image was and none of its styling. Only
 * destinations this reader resolves are fetched, once each; anything else is left
 * as the document wrote it.
 * @param source - the file's text.
 * @param title - title to add when the document declares none.
 * @param directory - absolute directory holding the file.
 * @param assets - the readers for the two asset kinds an export stands alone with.
 * @returns the document, and the HTML to render it from.
 */
export async function standaloneHtml(
  source: string,
  title: string,
  directory: string,
  assets: { readImage: ExportAssetReaders['readImage']; readText: ExportAssetReaders['readText'] },
): Promise<{ document: Document; html: string }> {
  const parsed = parseHtml(source, title)
  const controller = new AbortController()
  const done: Promise<void>[] = []
  // A styled page usually names one stylesheet and several images; both are read
  // through the same bounds as a Markdown document's images.
  for (const link of [...parsed.querySelectorAll('link[rel~="stylesheet"][href]')].slice(0, MAX_DOCUMENT_IMAGES)) {
    const href = link.getAttribute('href') ?? ''
    if (!isRelativeDestination(href)) continue
    const path = resolveRelativePath(directory, href)
    done.push(assets.readText(path, controller.signal).then((text) => {
      if (text === undefined) return
      const style = parsed.createElement('style')
      style.textContent = text
      link.replaceWith(style)
    }))
  }
  for (const image of [...parsed.querySelectorAll('img[src]')].slice(0, MAX_DOCUMENT_IMAGES)) {
    const src = image.getAttribute('src') ?? ''
    if (!isRelativeDestination(src)) continue
    const path = resolveRelativePath(directory, src)
    done.push(assets.readImage(path, controller.signal).then((dataUrl) => {
      if (dataUrl !== undefined) image.setAttribute('src', dataUrl)
    }))
  }
  await Promise.allSettled(done)
  return { document: parsed, html: `<!doctype html>${parsed.documentElement.outerHTML}` }
}

/** The readers an export needs to make a document stand alone. */
export interface ExportAssetReaders {
  readonly readImage: (path: string, signal: AbortSignal) => Promise<string | undefined>
  readonly readText: (path: string, signal: AbortSignal) => Promise<string | undefined>
}

/** A file name with its final extension replaced by another. */
function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^./\\]+$/, '')}.${extension}`
}

/**
 * Export one document, and download it.
 * @param format - the format to write.
 * @param request - the document and how to reach it.
 */
export async function exportDocument(format: ExportFormat, request: ExportRequest): Promise<void> {
  // An HTML document is rendered once here and read twice below, so both formats
  // work from the same inert, script-free DOM rather than from the sandboxed frame
  // the reader sees.
  let offscreen: ReturnType<typeof renderOffscreen> | undefined
  let root: HTMLElement | null = request.prose
  try {
    if (request.kind !== 'markdown') {
      const standalone = await standaloneHtml(request.html, request.title, request.directory, request.assets)
      // Word reads the parsed document directly; the PDF needs a frame to draw.
      if (format === 'word') {
        downloadBlob(
          new Blob([docxFromBlocks(blocksFromElement(standalone.document.body), request.title)], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
          withExtension(request.name, 'docx'),
        )
        return
      }
      offscreen = renderOffscreen(standalone.html)
      await offscreen.ready
      root = offscreen.body
    }
    if (root === null) return
    if (format === 'word') {
      downloadBlob(
        new Blob([docxFromBlocks(blocksFromElement(root), request.title)], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        withExtension(request.name, 'docx'),
      )
      return
    }
    const pages = await rasterPages(root)
    if (pages.length === 0) return
    downloadBlob(
      new Blob([pdfFromPages(pages)], { type: 'application/pdf' }),
      withExtension(request.name, 'pdf'),
    )
  } finally {
    offscreen?.dispose()
  }
}
