/**
 * A minimal ZIP reader, which is what reading a `.docx`, `.xlsx` or `.pptx`
 * needs: an OOXML package is a zip archive of XML parts and media.
 *
 * The writer next door stores its entries; other people's archives are usually
 * deflated, and the decompression is the browser's own `DecompressionStream`
 * rather than a third-party inflater. That is the whole reason this reader can
 * exist at a size worth shipping: no inflate implementation, no dependency.
 *
 * Entry sizes and offsets come from the **central directory**, never from the
 * local headers: a streamed archive writes zeros there and puts the real sizes in
 * a data descriptor after the bytes. The local header is still consulted, because
 * only it says where its own name and extra field end — which is where the data
 * starts.
 *
 * Pure but for `DecompressionStream`, so the tests can unzip what the writer
 * next door wrote.
 */

/** One entry, as the central directory records it. */
interface ZipEntry {
  /** Path inside the archive, `/`-separated. */
  readonly name: string
  /** Compression method: 0 stored, 8 deflated. */
  readonly method: number
  /** General-purpose flags. */
  readonly flags: number
  /** The entry's stored size in bytes. */
  readonly compressedSize: number
  /** Offset of the entry's local file header. */
  readonly localOffset: number
}

/** A readable OOXML package. */
export interface ZipArchive {
  /** Every entry's path, in the order the directory lists them. */
  readonly names: readonly string[]
  /**
   * Whether one path is present.
   * @param name - the entry's path.
   * @returns whether the archive holds it.
   */
  has: (name: string) => boolean
  /**
   * One entry's bytes, decompressed.
   * @param name - the entry's path.
   * @returns the bytes, or undefined when the archive holds no such entry.
   */
  read: (name: string) => Promise<Uint8Array | undefined>
  /**
   * One entry as UTF-8 text.
   * @param name - the entry's path.
   * @returns the text, or undefined when the archive holds no such entry or the
   *   entry is not UTF-8.
   */
  text: (name: string) => Promise<string | undefined>
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** The end record's own size, before its optional trailing comment. */
const EOCD_SIZE = 22

/** Largest comment a ZIP may carry, which bounds the backwards scan. */
const MAX_COMMENT = 0xffff

/** Local file header fields before its name. */
const LOCAL_HEADER_SIZE = 30

/** Central directory header fields before its name. */
const CENTRAL_HEADER_SIZE = 46

/**
 * Read one 16-bit little-endian field.
 * @param view - the archive.
 * @param at - the field's offset.
 * @returns the value.
 */
function u16(view: DataView, at: number): number {
  return view.getUint16(at, true)
}

/**
 * Read one 32-bit little-endian field.
 * @param view - the archive.
 * @param at - the field's offset.
 * @returns the value, unsigned.
 */
function u32(view: DataView, at: number): number {
  return view.getUint32(at, true)
}

/**
 * Find the end-of-central-directory record.
 *
 * It is last but for the archive comment, whose length is only known once the
 * record is found — so the scan walks backwards over the largest comment a ZIP
 * could carry.
 * @param view - the archive.
 * @returns the record's offset.
 */
function findEndRecord(view: DataView): number {
  const first = Math.max(0, view.byteLength - EOCD_SIZE - MAX_COMMENT)
  for (let at = view.byteLength - EOCD_SIZE; at >= first; at--) {
    if (u32(view, at) === EOCD_SIGNATURE) return at
  }
  throw new Error('not a ZIP archive: no end-of-central-directory record')
}

/**
 * Walk the central directory.
 * @param view - the archive.
 * @returns one entry per file, in directory order.
 */
function readCentralDirectory(view: DataView): ZipEntry[] {
  const end = findEndRecord(view)
  const count = u16(view, end + 10)
  const offset = u32(view, end + 16)
  // A full-file read cannot exceed the deployment's cap, so an archive this
  // large is not one of ours to read; say so rather than walking garbage.
  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported')
  }
  const entries: ZipEntry[] = []
  let at = offset
  for (let index = 0; index < count; index++) {
    if (at + CENTRAL_HEADER_SIZE > view.byteLength || u32(view, at) !== CENTRAL_SIGNATURE) {
      throw new Error('this ZIP archive\'s central directory is damaged')
    }
    const flags = u16(view, at + 8)
    const nameLength = u16(view, at + 28)
    const extraLength = u16(view, at + 30)
    const commentLength = u16(view, at + 32)
    const name = new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset + at + CENTRAL_HEADER_SIZE, nameLength),
    )
    entries.push({
      name,
      method: u16(view, at + 10),
      flags,
      compressedSize: u32(view, at + 20),
      localOffset: u32(view, at + 42),
    })
    at += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Inflate one raw deflate stream.
 * @param data - the compressed bytes.
 * @returns the decompressed bytes.
 */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // A copy, so the stream never holds a view over the whole archive alive.
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Read one entry's bytes.
 * @param bytes - the whole archive.
 * @param view - the archive as fields.
 * @param entry - the entry to read.
 * @returns its decompressed bytes.
 */
async function readEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry): Promise<Uint8Array> {
  if ((entry.flags & 0x1) !== 0) throw new Error(`"${entry.name}" is encrypted`)
  const at = entry.localOffset
  if (at + LOCAL_HEADER_SIZE > view.byteLength || u32(view, at) !== LOCAL_SIGNATURE) {
    throw new Error(`"${entry.name}" has no local file header`)
  }
  const start = at + LOCAL_HEADER_SIZE + u16(view, at + 26) + u16(view, at + 28)
  const end = start + entry.compressedSize
  if (end > bytes.length) throw new Error(`"${entry.name}" runs past the end of the archive`)
  const stored = bytes.subarray(start, end)
  if (entry.method === 0) return stored.slice()
  if (entry.method === 8) return inflate(stored)
  throw new Error(`"${entry.name}" uses unsupported compression method ${entry.method}`)
}

/**
 * Open an OOXML package.
 *
 * The directory is read eagerly — it is small and every reader asks what is in
 * the package before it asks for anything — while entries are decompressed on
 * demand, so a package's images cost nothing until something draws them.
 * @param bytes - the archive.
 * @returns the readable package.
 */
export function openZip(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = readCentralDirectory(view)
  const byName = new Map(entries.map(entry => [entry.name, entry] as const))
  const decoder = new TextDecoder('utf-8', { fatal: true })
  return {
    names: [...byName.keys()],
    has: name => byName.has(name),
    read: async (name) => {
      const entry = byName.get(name)
      return entry === undefined ? undefined : readEntry(bytes, view, entry)
    },
    text: async (name) => {
      const entry = byName.get(name)
      if (entry === undefined) return undefined
      try {
        return decoder.decode(await readEntry(bytes, view, entry))
      } catch {
        // A part that is not UTF-8 is not a part this reader can use; the caller
        // treats it the same as a missing one rather than failing the document.
        return undefined
      }
    },
  }
}
