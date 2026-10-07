/**
 * The bodies that draw a file the pane has to build for itself: a PDF, and the
 * three Office packages.
 *
 * A PDF needs no building — the browser has a reader, and handing it the file's
 * own bytes is both the highest-fidelity preview available and the only one that
 * costs nothing. It is embedded as an `<object>` rather than a frame so that the
 * browser which cannot show it says so through the element's own fallback,
 * instead of painting an empty rectangle.
 *
 * An Office package is unpacked here. What comes back is content, not layout:
 * a Word document's blocks, a workbook's cells, a deck's text and pictures. That
 * is the honest ceiling of reading OOXML without a layout engine, and it is what
 * an outline of the file is for.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { Block, BlockMetrics, InlineRun } from './export/model.ts'
import type { OfficeDocument, OfficeKind, SheetTable, SlideContent } from './office/index.ts'
import { readOfficeDocument } from './office/index.ts'
import type { PreviewFile } from './store.ts'

/** The copy a document body needs. */
type Copy = TranslateNS<'fileExplorer'>

/**
 * A PDF, drawn by the browser's own reader.
 * @param props - the file's bytes, its name, and the pane's copy.
 * @returns the embedded reader, or the browser's own "cannot show this" fallback.
 */
export function PdfPreview({ file, name, t }: {
  file: PreviewFile
  name: string
  t: Copy
}): ReactNode {
  // The bytes the shell sent, handed to the browser's own reader as a local
  // blob: no `data:` URL to build and nothing to decode.
  const url = useMemo(
    () => URL.createObjectURL(new Blob([file.data], { type: 'application/pdf' })),
    [file.data],
  )
  useEffect(() => () => { if (url !== undefined) URL.revokeObjectURL(url) }, [url])
  if (url === undefined) {
    return (
      <div className="dsh-fe-scroll" data-preview-state="failed">
        <p className="dsh-fe-note dsh-fe-note-error" data-preview-row="pdf-undecodable">
          {t('office.failed', { message: t('office.undecodable') })}
        </p>
      </div>
    )
  }
  return (
    <div className="dsh-fe-scroll dsh-fe-pdfhost" data-preview-state="ready" data-preview-format="pdf">
      <object className="dsh-fe-pdf" type="application/pdf" data={url} aria-label={name}>
        <p className="dsh-fe-note" data-preview-row="pdf-unavailable">{t('preview.pdfUnavailable')}</p>
      </object>
    </div>
  )
}

/**
 * The style one block's metrics take.
 *
 * These are the document's own numbers — resolved through its style chain — so a
 * paragraph the reader sees here sits where it sits in Word, rather than at
 * whatever this sheet would otherwise give a `<p>`.
 * @param metrics - the block's metrics, when it states any.
 * @returns the style, or undefined to leave the block as the sheet draws it.
 */
function metricsStyle(metrics: BlockMetrics | undefined): CSSProperties | undefined {
  if (metrics === undefined) return undefined
  const style: CSSProperties = {
    ...(metrics.align === undefined ? {} : { textAlign: metrics.align }),
    ...(metrics.indent === undefined ? {} : { marginLeft: metrics.indent }),
    ...(metrics.firstLine === undefined ? {} : { textIndent: metrics.firstLine }),
    ...(metrics.before === undefined ? {} : { marginTop: metrics.before }),
    ...(metrics.after === undefined ? {} : { marginBottom: metrics.after }),
    ...(metrics.lineHeight === undefined ? {} : { lineHeight: metrics.lineHeight }),
  }
  return Object.keys(style).length === 0 ? undefined : style
}

/**
 * One run of text, with the formatting its source carried.
 *
 * The wrappers nest in a fixed order — emphasis outside, script inside — so the
 * same run always produces the same tree whatever order the document listed its
 * properties in.
 * @param props - the run.
 * @returns the run as markup.
 */
function Run({ run }: { run: InlineRun }): ReactNode {
  let node: ReactNode = run.text
  if (run.code === true) node = <code>{node}</code>
  if (run.bold === true && run.italic === true) node = <strong><em>{node}</em></strong>
  else if (run.bold === true) node = <strong>{node}</strong>
  else if (run.italic === true) node = <em>{node}</em>
  if (run.underline === true) node = <u>{node}</u>
  if (run.strike === true) node = <s>{node}</s>
  if (run.sup === true) node = <sup>{node}</sup>
  else if (run.sub === true) node = <sub>{node}</sub>
  const style: CSSProperties = {
    ...(run.color === undefined ? {} : { color: run.color }),
    ...(run.highlight === undefined ? {} : { backgroundColor: run.highlight }),
    ...(run.size === undefined ? {} : { fontSize: run.size }),
    ...(run.font === undefined ? {} : { fontFamily: run.font }),
  }
  if (Object.keys(style).length > 0) node = <span style={style}>{node}</span>
  return <>{node}</>
}

/**
 * The runs of one span of text.
 * @param runs - the runs.
 * @returns them as markup.
 */
function Runs({ runs }: { runs: readonly InlineRun[] }): ReactNode {
  return <>{runs.map((run, index) => <Run key={index} run={run} />)}</>
}

/**
 * One block of a Word document.
 * @param props - the block.
 * @returns the block as markup.
 */
function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const runs = <Runs runs={block.runs} />
      const style = metricsStyle(block.metrics)
      switch (block.level) {
        case 1: return <h1 style={style}>{runs}</h1>
        case 2: return <h2 style={style}>{runs}</h2>
        case 3: return <h3 style={style}>{runs}</h3>
        case 4: return <h4 style={style}>{runs}</h4>
        case 5: return <h5 style={style}>{runs}</h5>
        default: return <h6 style={style}>{runs}</h6>
      }
    }
    case 'paragraph':
      return <p style={metricsStyle(block.metrics)}><Runs runs={block.runs} /></p>
    case 'quote':
      return <blockquote style={metricsStyle(block.metrics)}><Runs runs={block.runs} /></blockquote>
    case 'code':
      return <pre className="dsh-fe-doc-code">{block.text}</pre>
    case 'rule':
      return <hr className="dsh-fe-doc-rule" />
    case 'table':
      return (
        <table className="dsh-fe-doc-table">
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.cells.map((cell, cellIndex) => (
                  <td key={cellIndex}><Runs runs={cell.runs} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'image':
      return <img className="dsh-fe-doc-image" src={block.src} alt={block.alt} data-office-image />
    case 'list':
      // Lists are gathered by the walk below, which is the only place a marker's
      // number is known.
      return <p><Runs runs={block.runs} /></p>
  }
}

/**
 * A Word document's blocks, with runs of list items gathered into real lists so
 * an ordered one numbers itself.
 * @param props - the blocks, and the pane's copy.
 * @returns the document as markup.
 */
function BlocksView({ blocks, t }: { blocks: readonly Block[]; t: Copy }): ReactNode {
  if (blocks.length === 0) return <p className="dsh-fe-note">{t('office.empty')}</p>
  const nodes: ReactNode[] = []
  let index = 0
  while (index < blocks.length) {
    const block = blocks[index]
    if (block === undefined) break
    if (block.kind !== 'list') {
      nodes.push(<BlockView key={index} block={block} />)
      index += 1
      continue
    }
    const { ordered, depth } = block
    const items: InlineRun[][] = []
    while (index < blocks.length) {
      const next = blocks[index]
      if (next === undefined || next.kind !== 'list' || next.ordered !== ordered || next.depth !== depth) break
      items.push([...next.runs])
      index += 1
    }
    const entries = items.map((runs, at) => <li key={at}><Runs runs={runs} /></li>)
    nodes.push(
      <div className="dsh-fe-doc-list" data-depth={depth} key={`list-${index}`}>
        {ordered ? <ol>{entries}</ol> : <ul>{entries}</ul>}
      </div>,
    )
  }
  return <div className="dsh-fe-doc">{nodes}</div>
}

/**
 * A workbook's sheets, one table at a time.
 * @param props - the sheets and the pane's copy.
 * @returns the grid, with a tab per sheet.
 */
function SheetsView({ sheets, t }: { sheets: readonly SheetTable[]; t: Copy }): ReactNode {
  const [selected, setSelected] = useState(0)
  const sheet = sheets[selected] ?? sheets[0]
  if (sheet === undefined) return <p className="dsh-fe-note">{t('office.empty')}</p>
  return (
    <div className="dsh-fe-sheet">
      {sheets.length > 1 && (
        <div className="dsh-fe-sheet-tabs" role="tablist" aria-label={t('office.sheets')}>
          {sheets.map((item, index) => (
            <button
              key={`${item.name}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === selected}
              className="dsh-fe-sheet-tab"
              data-sheet-tab={item.name}
              onClick={() => { setSelected(index) }}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div className="dsh-fe-scroll dsh-fe-sheet-scroll">
        <table className="dsh-fe-sheet-table">
          <tbody>
            {sheet.rows.map(row => (
              <tr key={row.number}>
                <th scope="row" className="dsh-fe-sheet-index">{row.number}</th>
                {row.cells.map((cell, cellIndex) => <td key={cellIndex} title={cell}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.truncated && <p className="dsh-fe-note" data-preview-row="sheet-truncated">{t('office.truncated')}</p>}
    </div>
  )
}

/**
 * A deck's slides, as an outline of itself.
 * @param props - the slides and the pane's copy.
 * @returns one card per slide.
 */
function SlidesView({ slides, t }: { slides: readonly SlideContent[]; t: Copy }): ReactNode {
  if (slides.length === 0) return <p className="dsh-fe-note">{t('office.empty')}</p>
  return (
    <div className="dsh-fe-slides">
      {slides.map((slide, index) => (
        <section className="dsh-fe-slide" key={index} data-slide={index + 1}>
          <div className="dsh-fe-slide-index">{t('office.slide', { index: index + 1 })}</div>
          {slide.title !== undefined && <h3 className="dsh-fe-slide-title">{slide.title}</h3>}
          {slide.lines.length > 0 && (
            <ul className="dsh-fe-slide-lines">
              {slide.lines.map((line, at) => <li key={at}>{line}</li>)}
            </ul>
          )}
          {slide.images.length > 0 && (
            <div className="dsh-fe-slide-images">
              {slide.images.map((src, at) => <img className="dsh-fe-slide-image" key={at} src={src} alt="" />)}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

/** What one Office package is doing right now. */
type OfficeState =
  | { readonly kind: 'reading' }
  | { readonly kind: 'ready'; readonly document: OfficeDocument }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * An Office package, unpacked and drawn.
 * @param props - which package it is, the file's bytes, and the pane's copy.
 * @returns the reading state, the document, or the line naming why not.
 */
export function OfficePreview({ kind, file, t }: {
  kind: OfficeKind
  file: PreviewFile
  t: Copy
}): ReactNode {
  const [state, setState] = useState<OfficeState>({ kind: 'reading' })
  useEffect(() => {
    let live = true
    setState({ kind: 'reading' })
    // Unpacking is decompression work over the whole file. It starts on a later
    // task so the pane draws its reading state first, rather than freezing on the
    // render that asked for it.
    void Promise.resolve()
      .then(() => readOfficeDocument(kind, file.data))
      .then(
        (document) => { if (live) setState({ kind: 'ready', document }) },
        (error: unknown) => {
          if (live) setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
        },
      )
    return () => { live = false }
  }, [kind, file.data, file.mediaType, t])

  if (state.kind === 'reading') {
    return <div className="dsh-fe-status" data-preview-state="reading">{t('office.reading')}</div>
  }
  if (state.kind === 'failed') {
    return (
      <div className="dsh-fe-scroll" data-preview-state="failed">
        <p className="dsh-fe-note dsh-fe-note-error" data-preview-row="office-failed">
          {t('office.failed', { message: state.message })}
        </p>
      </div>
    )
  }
  const document = state.document
  return (
    <div
      className="dsh-fe-scroll"
      data-preview-state="ready"
      data-preview-format={document.kind}
      data-office-kind={document.kind}
    >
      {document.kind === 'word' && <BlocksView blocks={document.blocks} t={t} />}
      {document.kind === 'sheet' && <SheetsView sheets={document.sheets} t={t} />}
      {document.kind === 'slides' && <SlidesView slides={document.slides} t={t} />}
      {document.truncated && (
        <p className="dsh-fe-note" data-preview-row="office-truncated">{t('office.truncated')}</p>
      )}
    </div>
  )
}

/**
 * The panel a legacy binary Office file gets: what it is, and that the download
 * is the way to open it.
 * @param props - the pane's copy.
 * @returns the explanation.
 */
export function LegacyOfficePanel({ t }: { t: Copy }): ReactNode {
  return (
    <div className="dsh-fe-scroll" data-preview-state="ready" data-preview-format="legacyOffice">
      <p className="dsh-fe-note" data-preview-row="legacy-office">{t('office.legacy')}</p>
    </div>
  )
}
