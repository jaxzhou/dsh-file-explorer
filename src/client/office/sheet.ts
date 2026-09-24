/**
 * Reading a `.xlsx`: the cells of a workbook, as a grid the pane can draw.
 *
 * A worksheet's XML holds references, not values: a cell says which *shared
 * string* it means by index, and how it should be *displayed* by pointing at a
 * style — which is where a date lives, because Excel stores one as a number and
 * only the number format makes it a date. Both indirections are resolved here,
 * because neither is visible in the cell itself.
 *
 * What comes back is what a reader would see in the cell, not a spreadsheet
 * engine: formula results are the values the file cached, and the cell's own
 * number format is applied only far enough to make a date a date. Colours,
 * borders, column widths, charts, and pivot tables are layout, and layout is not
 * what this preview is for.
 */
import { resolvePart } from './binary.ts'
import { readRelationships } from './package.ts'
import { attribute, descendants, elements, parseXml, textContent, type XmlElement } from './xml.ts'
import { openZip, type ZipArchive } from './zip.ts'

/** One row of a worksheet. */
export interface SheetRow {
  /**
   * The row's number in the sheet, as the file states it.
   *
   * Kept rather than assumed from the row's position, because a sheet skips rows
   * it has nothing in and a reader checking a cell against the file needs the
   * number the file uses.
   */
  readonly number: number
  /** The cells the row has, from the row's first cell to its last non-empty one. */
  readonly cells: readonly string[]
}

/** One worksheet, as the pane draws it. */
export interface SheetTable {
  /** The sheet's name, as the workbook tab shows it. */
  readonly name: string
  /** Its rows, in sheet order, with skipped rows kept as empty ones. */
  readonly rows: readonly SheetRow[]
  /** The sheet held more rows or columns than this reader shows. */
  readonly truncated: boolean
}

/** A workbook, as the preview draws it. */
export interface SheetDocument {
  readonly kind: 'sheet'
  /** The worksheets, in workbook order. */
  readonly sheets: readonly SheetTable[]
  /** The workbook held more sheets than this reader shows. */
  readonly truncated: boolean
}

/** How many worksheets one workbook may contribute to the pane. */
const MAX_SHEETS = 8

/** How many rows one worksheet may contribute. */
const MAX_ROWS = 300

/** How many columns one worksheet may contribute. */
const MAX_COLUMNS = 60

/**
 * The number formats Excel ships as built-in, of which these are the ones that
 * mean a date or a time. A number carrying one of them is drawn as a date.
 */
const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
])

/**
 * Whether one format code describes a date.
 *
 * The code is stripped of the parts that are literals — quoted text, bracketed
 * sections such as `[Red]` or `[$-409]`, and backslash escapes — because a
 * currency format that spells "days" in quotes is not a date format.
 * @param code - the format code.
 * @returns whether what is left names a date field.
 */
function isDateFormat(code: string): boolean {
  const stripped = code
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
  return /[ymd]/i.test(stripped)
}

/**
 * Draw one Excel serial number as a date.
 *
 * Excel counts days from 1900-01-01 but believes 1900 was a leap year, so every
 * serial below the phantom 29 February 1900 is one day further along than a
 * plain epoch conversion says.
 * @param serial - the stored number.
 * @returns the date, as `YYYY-MM-DD`, with a time when the serial carries one.
 */
function dateText(serial: number): string {
  const days = Math.floor(serial)
  const fraction = serial - days
  const adjusted = days < 60 ? days + 1 : days
  const date = new Date(Date.UTC(1899, 11, 30) + adjusted * 86400000)
  if (!Number.isFinite(date.getTime())) return String(serial)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  if (fraction <= 0) return day
  const seconds = Math.round(fraction * 86400)
  return `${day} ${pad(Math.floor(seconds / 3600) % 24)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

/**
 * The zero-based column one cell reference names.
 * @param reference - the reference, such as `B7`.
 * @param fallback - the column to use when the reference is absent or malformed.
 * @returns the column index.
 */
function columnOf(reference: string | undefined, fallback: number): number {
  if (reference === undefined) return fallback
  let column = 0
  let letters = 0
  for (const character of reference) {
    const code = character.charCodeAt(0)
    if (code < 65 || code > 90) break
    column = column * 26 + (code - 64)
    letters++
  }
  return letters === 0 ? fallback : column - 1
}

/**
 * The text of every `<t>` under one element, in order.
 *
 * Concatenating the text nodes directly would also collect the whitespace a
 * pretty-printed part leaves between elements; a shared string's runs are what
 * the string is.
 * @param element - the element.
 * @returns its text.
 */
function runsText(element: XmlElement): string {
  return descendants(element, 't').map(node => textContent(node)).join('')
}

/**
 * Read the shared string table.
 * @param zip - the open package.
 * @returns the strings, by index.
 */
async function readSharedStrings(zip: ZipArchive): Promise<readonly string[]> {
  const text = await zip.text('xl/sharedStrings.xml')
  if (text === undefined) return []
  return descendants(parseXml(text), 'si').map(runsText)
}

/**
 * Read which cell styles draw a date.
 * @param zip - the open package.
 * @returns the style indices whose format is a date.
 */
async function readDateStyles(zip: ZipArchive): Promise<ReadonlySet<number>> {
  const dates = new Set<number>()
  const text = await zip.text('xl/styles.xml')
  if (text === undefined) return dates
  const root = parseXml(text)
  const custom = new Map<number, string>()
  for (const node of descendants(root, 'numFmt')) {
    const id = Number(attribute(node, 'numFmtId') ?? '')
    const code = attribute(node, 'formatCode')
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code)
  }
  const formats = elements(root, 'cellXfs')[0]
  if (formats === undefined) return dates
  elements(formats, 'xf').forEach((cellFormat, index) => {
    const id = Number(attribute(cellFormat, 'numFmtId') ?? '')
    if (!Number.isFinite(id)) return
    const code = custom.get(id)
    if (BUILT_IN_DATE_FORMATS.has(id) || (code !== undefined && isDateFormat(code))) dates.add(index)
  })
  return dates
}

/**
 * One cell's text, as the file says it should be shown.
 * @param cell - the `c` element.
 * @param shared - the shared string table.
 * @param dateStyles - the style indices whose format is a date.
 * @returns the cell's text.
 */
function cellText(cell: XmlElement, shared: readonly string[], dateStyles: ReadonlySet<number>): string {
  const type = attribute(cell, 't') ?? 'n'
  if (type === 'inlineStr') {
    const inline = elements(cell, 'is')[0]
    return inline === undefined ? '' : runsText(inline)
  }
  const value = elements(cell, 'v')[0]
  const raw = value === undefined ? '' : textContent(value)
  switch (type) {
    case 's': {
      const index = Number(raw)
      return Number.isInteger(index) ? shared[index] ?? '' : ''
    }
    case 'b': return raw === '1' ? 'TRUE' : 'FALSE'
    case 'str': case 'e': return raw
    default: {
      if (raw === '') return ''
      const serial = Number(raw)
      const style = Number(attribute(cell, 's') ?? '')
      if (dateStyles.has(style) && Number.isFinite(serial)) return dateText(serial)
      return raw
    }
  }
}

/**
 * Read one worksheet's grid.
 * @param source - the worksheet part's XML.
 * @param shared - the shared string table.
 * @param dateStyles - the style indices whose format is a date.
 * @returns the rows, and whether the sheet was cut.
 */
function sheetRows(
  source: string,
  shared: readonly string[],
  dateStyles: ReadonlySet<number>,
): { rows: SheetRow[]; truncated: boolean } {
  const rows: SheetRow[] = []
  let truncated = false
  const data = elements(parseXml(source), 'sheetData')[0]
  if (data === undefined) return { rows, truncated }
  let expected = 1
  for (const row of elements(data, 'row')) {
    if (rows.length >= MAX_ROWS) {
      truncated = true
      break
    }
    const declared = Number(attribute(row, 'r') ?? '')
    const number = Number.isInteger(declared) && declared > 0 ? declared : expected
    // A row the sheet skipped is still a row: filling the gap is what keeps the
    // numbers a reader checks against the file true.
    while (expected < number) {
      if (rows.length >= MAX_ROWS) {
        truncated = true
        break
      }
      rows.push({ number: expected, cells: [] })
      expected += 1
    }
    if (rows.length >= MAX_ROWS) {
      truncated = true
      break
    }
    const cells: string[] = []
    let next = 0
    for (const cell of elements(row, 'c')) {
      const column = columnOf(attribute(cell, 'r'), next)
      if (column >= MAX_COLUMNS) {
        truncated = true
        continue
      }
      next = column + 1
      while (cells.length < column) cells.push('')
      cells[column] = cellText(cell, shared, dateStyles)
    }
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    rows.push({ number, cells })
    expected = number + 1
  }
  // Excel declares rows and columns it has nothing in; a grid of blanks is not a
  // preview of anything.
  while (rows.length > 0 && rows[rows.length - 1]?.cells.length === 0) rows.pop()
  return { rows, truncated }
}

/**
 * Read one `.xlsx` package.
 * @param bytes - the package's bytes.
 * @returns the workbook's sheets.
 */
export async function readSheet(bytes: Uint8Array): Promise<SheetDocument> {
  const zip = openZip(bytes)
  const workbook = await zip.text('xl/workbook.xml')
  if (workbook === undefined) {
    throw new Error('this file is not a workbook: it has no xl/workbook.xml part')
  }
  const relationships = await readRelationships(zip, 'xl/workbook.xml')
  const shared = await readSharedStrings(zip)
  const dateStyles = await readDateStyles(zip)

  const sheets: SheetTable[] = []
  let truncated = false
  for (const node of descendants(parseXml(workbook), 'sheet')) {
    if (sheets.length >= MAX_SHEETS) {
      truncated = true
      break
    }
    const name = attribute(node, 'name') ?? `Sheet${sheets.length + 1}`
    const id = node.attributes.get('r:id') ?? attribute(node, 'id')
    const relationship = id === undefined ? undefined : relationships.get(id)
    if (relationship === undefined || relationship.external) {
      sheets.push({ name, rows: [], truncated: false })
      continue
    }
    const source = await zip.text(resolvePart('xl', relationship.target))
    if (source === undefined) {
      sheets.push({ name, rows: [], truncated: false })
      continue
    }
    const grid = sheetRows(source, shared, dateStyles)
    sheets.push({ name, rows: grid.rows, truncated: grid.truncated })
    if (grid.truncated) truncated = true
  }
  return { kind: 'sheet', sheets, truncated }
}
