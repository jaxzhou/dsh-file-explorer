/**
 * Mermaid diagrams inside a Markdown document.
 *
 * A ```mermaid fence is a diagram, not source code, so the pane draws it. The
 * primitive this pane renders Markdown with has no hook for a fence renderer,
 * but it does accept a vocabulary that rewrites an image destination into a URL
 * the owner vouches for — and that vocabulary permits a `data:` URL. So a fence
 * is *replaced* by one image reference carrying the drawn diagram: the document
 * around it keeps its own semantics (tables, footnote numbering, list
 * continuation) because it is still parsed as one document.
 *
 * Two consequences decide the shape of this module:
 *
 * - The diagram is a **raster PNG**, not the SVG mermaid produces. The Word
 *   writer embeds PNG and JPEG only, and a PDF page is drawn by html2canvas,
 *   which is reliable with an `<img>` and not with an inline SVG or an SVG whose
 *   labels are `<foreignObject>`. One raster satisfies both writers and the
 *   preview, and `htmlLabels: false` is what makes the rasterisation portable.
 * - Finding the fences is pure text work, so it lives apart from the drawing
 *   below it: that is the part which has to be exactly right, so it is the part
 *   under test.
 *
 * Drawing is lazy. `mermaid` is inlined into this bundle (it is not on the
 * shell's module table), and its module body is evaluated only when the first
 * diagram is drawn — the same reason `html2canvas` is imported inside the
 * rasteriser next door.
 */

/** One ```mermaid fence: where it sits in the source, and the diagram it holds. */
export interface MermaidFence {
  /** Offset of the opening fence line's first character. */
  readonly start: number
  /** Offset just past the closing fence line, or the document's end when it never closes. */
  readonly end: number
  /** The fence exactly as written, opening and closing lines included. */
  readonly source: string
  /** The diagram source between the fences, with the trailing newline removed. */
  readonly code: string
}

/** A line of the document, with the offsets its fence offsets are measured in. */
interface SourceLine {
  /** Offset of the line's first character. */
  readonly start: number
  /** Offset of the line's newline, or the document's end. */
  readonly end: number
  /** The line's text, without its newline or a CR that preceded it. */
  readonly text: string
}

/** An opening fence: up to three spaces of indent, three or more markers, then the info string. */
const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/

/**
 * Split a document into lines that remember where they are.
 * @param markdown - the document.
 * @returns one entry per line, in document order.
 */
function sourceLines(markdown: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  while (start <= markdown.length) {
    const newline = markdown.indexOf('\n', start)
    const end = newline < 0 ? markdown.length : newline
    lines.push({ start, end, text: markdown.slice(start, end).replace(/\r$/, '') })
    if (newline < 0) break
    start = newline + 1
  }
  return lines
}

/**
 * Whether one line closes a fence opened with `marker`.
 *
 * The closing marker is the same character, at least as long as the opening
 * one, with nothing but whitespace after it.
 * @param line - the line's text.
 * @param marker - the opening fence's marker run, such as ` ``` `.
 * @returns whether the line closes the fence.
 */
function isClosingFence(line: string, marker: string): boolean {
  const body = line.replace(/^ {0,3}/, '')
  const character = marker.slice(0, 1)
  let length = 0
  while (body[length] === character) length++
  if (length < marker.length) return false
  return /^[ \t]*$/.test(body.slice(length))
}

/**
 * The first word of a fence's info string, lower-cased.
 * @param info - the info string as the fence wrote it.
 * @returns the word, or an empty string when the fence names no language.
 */
function fenceLanguage(info: string): string {
  return (info.trim().split(/\s+/)[0] ?? '').toLowerCase()
}

/**
 * Every ```mermaid fence in a document, in document order.
 *
 * The scan walks *all* fences, so a mermaid fence quoted inside another fenced
 * block is source text rather than a diagram — exactly as the Markdown parser
 * the pane renders with will read it. A fence that never closes runs to the end
 * of the document, which is what the parser does with it too. Indentation is
 * read the way a top-level document reads it — up to three spaces — so a fence
 * indented deeper, inside a list, stays a code block rather than becoming a
 * diagram the parser would not have agreed to.
 * @param markdown - the document's Markdown.
 * @returns the mermaid fences, with their offsets.
 */
export function findMermaidFences(markdown: string): MermaidFence[] {
  const lines = sourceLines(markdown)
  const fences: MermaidFence[] = []
  let index = 0
  while (index < lines.length) {
    const opening = OPENING_FENCE.exec(lines[index]?.text ?? '')
    if (opening === null) {
      index++
      continue
    }
    const marker = opening[2] ?? ''
    const info = opening[3] ?? ''
    // A backtick fence's info string may not carry a backtick; such a line is
    // not a fence opener at all.
    if (marker.startsWith('`') && info.includes('`')) {
      index++
      continue
    }
    let closing = index + 1
    while (closing < lines.length && !isClosingFence(lines[closing]?.text ?? '', marker)) closing++
    const openLine = lines[index] as SourceLine
    const end = closing < lines.length ? (lines[closing] as SourceLine).end : markdown.length
    if (fenceLanguage(info) === 'mermaid') {
      const codeStart = openLine.end < markdown.length ? openLine.end + 1 : openLine.end
      const codeEnd = closing < lines.length ? (lines[closing] as SourceLine).start : markdown.length
      fences.push({
        start: openLine.start,
        end,
        source: markdown.slice(openLine.start, end),
        code: markdown.slice(codeStart, codeEnd).replace(/\r/g, '').replace(/\n$/, ''),
      })
    }
    index = closing < lines.length ? closing + 1 : lines.length
  }
  return fences
}

/**
 * The image destination one diagram's placeholder carries.
 *
 * It is a relative path on purpose: the primitive's image policy lets a remote
 * URL through untouched and asks the owner's vocabulary for everything else, so
 * a relative name is what routes the placeholder to us.
 * @param index - the diagram's position in the document.
 * @returns the destination as authored in the rewritten Markdown.
 */
export function mermaidDestination(index: number): string {
  return `dsh-mermaid-${index}.png`
}

/**
 * Replace every mermaid fence with whatever the caller says stands in its place.
 * @param markdown - the document's Markdown.
 * @param fences - the fences {@link findMermaidFences} found, in document order.
 * @param replacement - the text for one fence; index is its position among the fences.
 * @returns the rewritten document.
 */
export function replaceMermaidFences(
  markdown: string,
  fences: readonly MermaidFence[],
  replacement: (fence: MermaidFence, index: number) => string,
): string {
  let rewritten = ''
  let at = 0
  fences.forEach((fence, index) => {
    rewritten += markdown.slice(at, fence.start)
    rewritten += replacement(fence, index)
    at = fence.end
  })
  return rewritten + markdown.slice(at)
}

/**
 * One short line naming why a diagram could not be drawn.
 *
 * Mermaid's parse errors are a multi-line report that repeats the diagram
 * source; a failure line that the reader meets inline wants the first line of
 * that report and nothing more.
 * @param error - whatever the render rejected with.
 * @returns a single line, bounded in length.
 */
export function mermaidErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const line = raw.split('\n').map(part => part.trim()).find(part => part !== '') ?? raw
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

/** The slice of mermaid's API this module calls. */
type MermaidApi = typeof import('mermaid')['default']

/**
 * The raster's width per CSS pixel of the diagram.
 *
 * Two is the usual "crisp on a retina pane" factor, and it is also what makes an
 * A4 page's 1240-pixel raster of the preview legible once it is sliced into
 * pages.
 */
const RASTER_SCALE = 2

/** Ceiling on either side of the raster, in pixels; a canvas is not unbounded. */
const MAX_RASTER_SIDE = 4096

/**
 * The raster's background.
 *
 * Opaque white, in both themes: a PDF page and a Word document are white, and a
 * diagram drawn for a dark pane would be invisible on the page it is exported
 * to. The paper is the one that has to be right.
 */
const RASTER_BACKGROUND = '#ffffff'

/**
 * The font mermaid draws labels with.
 *
 * The rasteriser loads the SVG as an image, where the page's CSS variables do
 * not reach, so the stack has to be spelled out. The CJK faces are in it
 * because these documents are usually Chinese.
 */
const DIAGRAM_FONT = '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

/** One load per page: mermaid's configuration is global, and its module body is large. */
let loading: Promise<MermaidApi> | undefined

/** Renders run one at a time; mermaid's renderer owns shared global state. */
let queue: Promise<unknown> = Promise.resolve()

/** Distinguishes the temporary elements mermaid creates for concurrent callers. */
let nextDiagramId = 0

/**
 * Load and configure mermaid, once per page.
 * @returns the configured API.
 */
function loadMermaid(): Promise<MermaidApi> {
  // Imported here rather than at the top: mermaid's module body reads the
  // document as it runs, and a diagram renderer has no business running — or
  // needing a DOM — in a plugin that is only being loaded.
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      // The strict policy is what keeps an untrusted document's labels from
      // reaching the pane's DOM as markup.
      securityLevel: 'strict',
      // Text nodes instead of `<foreignObject>`: only then can the SVG be
      // rasterised through an `<img>` in every browser.
      htmlLabels: false,
      theme: 'default',
      fontFamily: DIAGRAM_FONT,
      flowchart: { htmlLabels: false },
    })
    return mermaid
  })
  return loading
}

/**
 * Run one task after every task queued before it.
 * @param task - the work to run.
 * @returns the task's own result.
 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  // The queue must survive a task that rejects, or every later diagram would
  // inherit the failure.
  queue = result.then(() => undefined, () => undefined)
  return result
}

/**
 * The diagram's own size, from the SVG mermaid wrote.
 * @param svg - the rendered SVG.
 * @returns its width and height in CSS pixels.
 */
function svgSize(svg: string): { width: number; height: number } {
  const viewBox = /viewBox="([^"]*)"/.exec(svg)?.[1]
  const numbers = viewBox?.trim().split(/[\s,]+/).map(Number)
  if (numbers !== undefined && numbers.length === 4
    && numbers.every(Number.isFinite) && (numbers[2] ?? 0) > 0 && (numbers[3] ?? 0) > 0) {
    return { width: numbers[2] as number, height: numbers[3] as number }
  }
  const width = Number(/\bwidth="([\d.]+)/.exec(svg)?.[1])
  const height = Number(/\bheight="([\d.]+)/.exec(svg)?.[1])
  return {
    width: Number.isFinite(width) && width > 0 ? width : 800,
    height: Number.isFinite(height) && height > 0 ? height : 600,
  }
}

/**
 * Give the SVG an explicit pixel size.
 *
 * Mermaid writes a `max-width` style and a viewBox instead of fixed dimensions,
 * which leaves an `<img>` free to size the diagram itself; pinning both makes
 * the raster deterministic and the scaling below meaningful.
 * @param svg - the rendered SVG.
 * @param width - width in CSS pixels.
 * @param height - height in CSS pixels.
 * @returns the SVG with fixed dimensions.
 */
function withIntrinsicSize(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    const bare = tag
      .replace(/\swidth="[^"]*"/, '')
      .replace(/\sheight="[^"]*"/, '')
      .replace(/\sstyle="[^"]*"/, '')
    return bare.replace('<svg', `<svg width="${width}" height="${height}"`)
  })
}

/**
 * The raster's pixel size for one diagram, bounded on both axes.
 * @param width - the diagram's width in CSS pixels.
 * @param height - the diagram's height in CSS pixels.
 * @returns the canvas size.
 */
function rasterSize(width: number, height: number): { width: number; height: number } {
  // The cap wins over the scale: a diagram larger than the cap is downscaled to
  // it rather than drawn past it.
  const scale = Math.min(RASTER_SCALE, MAX_RASTER_SIDE / width, MAX_RASTER_SIDE / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Draw one rendered SVG onto a canvas and hand back its PNG.
 * @param svg - the rendered SVG.
 * @returns the PNG as a `data:` URL.
 */
async function svgToPng(svg: string): Promise<string> {
  const intrinsic = svgSize(svg)
  const size = rasterSize(intrinsic.width, intrinsic.height)
  const image = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => { resolve() }
    image.onerror = () => { reject(new Error('the diagram could not be drawn as an image')) }
  })
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withIntrinsicSize(svg, intrinsic.width, intrinsic.height))}`
  await loaded
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('the diagram could not be drawn: no 2D canvas context')
  context.fillStyle = RASTER_BACKGROUND
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(image, 0, 0, size.width, size.height)
  return canvas.toDataURL('image/png')
}

/**
 * Whether the requesting document has already been abandoned.
 *
 * A function rather than an inline property test: the second check has to be a
 * real second read, and TypeScript's narrowing would otherwise remember the
 * first one's answer.
 * @param signal - the requesting document's lifetime, when there is one.
 * @returns whether the request was abandoned.
 */
function abandoned(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted
}

/**
 * Draw one mermaid diagram as a PNG the pane and the exports can both carry.
 *
 * Diagrams are drawn one at a time, because mermaid's renderer keeps its state
 * on the document it writes into; the queue is what makes a document with
 * several diagrams deterministic rather than a race.
 * @param code - the diagram's source, as the fence held it.
 * @param signal - the requesting document's lifetime; an aborted request is not drawn.
 * @returns the diagram as a PNG `data:` URL.
 */
export async function renderMermaidPng(code: string, signal?: AbortSignal): Promise<string> {
  return serialize(async () => {
    if (abandoned(signal)) throw new Error('the diagram was abandoned before it was drawn')
    const mermaid = await loadMermaid()
    const id = `dsh-fe-mermaid-${nextDiagramId++}`
    // A diagram mermaid cannot parse is drawn as an error picture *into the
    // document* and left there when the call throws. That node is not this
    // pane's markup — the pane names the failure itself and keeps the source —
    // so it does not stay behind. A successful render has already cleaned up.
    const { svg } = await mermaid.render(id, code).finally(() => {
      document.getElementById(id)?.remove()
    })
    if (abandoned(signal)) throw new Error('the diagram was abandoned before it was drawn')
    return svgToPng(svg)
  })
}
