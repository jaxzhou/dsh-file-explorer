/**
 * Office documents, read from the file into the shape the pane draws.
 *
 * One entry point for the three package kinds, so the pane asks for "this file,
 * read as a Word document" and gets a document or an error that says why not.
 * The readers are separate because the three packages share a container and
 * nothing else: a `.docx` is paragraphs, an `.xlsx` is cells, and a `.pptx` is
 * slides.
 */
import type { Block } from '../export/model.ts'
import { readSheet, type SheetTable } from './sheet.ts'
import { readSlides, type SlideContent } from './slides.ts'
import { readWord } from './word.ts'

export type { SheetTable } from './sheet.ts'
export type { SlideContent } from './slides.ts'

/** Which OOXML package a file is. */
export type OfficeKind = 'word' | 'sheet' | 'slides'

/** A package, read into the content the pane shows. */
export type OfficeDocument =
  | {
    readonly kind: 'word'
    /** The document's blocks, in order. */
    readonly blocks: readonly Block[]
    /** The document held more than was read. */
    readonly truncated: boolean
  }
  | {
    readonly kind: 'sheet'
    /** The worksheets, in workbook order. */
    readonly sheets: readonly SheetTable[]
    /** The workbook held more than was read. */
    readonly truncated: boolean
  }
  | {
    readonly kind: 'slides'
    /** The slides, in presentation order. */
    readonly slides: readonly SlideContent[]
    /** The deck held more than was read. */
    readonly truncated: boolean
  }

/**
 * Read an Office package.
 * @param kind - which of the three packages it is.
 * @param bytes - the file's complete bytes.
 * @returns the document, laid out for the pane.
 * @throws when the package is not the kind its suffix claimed, or is damaged.
 */
export async function readOfficeDocument(kind: OfficeKind, bytes: Uint8Array): Promise<OfficeDocument> {
  switch (kind) {
    case 'word': return readWord(bytes)
    case 'sheet': return readSheet(bytes)
    case 'slides': return readSlides(bytes)
    default: throw new Error(`unsupported Office kind: ${String(kind)}`)
  }
}
