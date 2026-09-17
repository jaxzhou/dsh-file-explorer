/**
 * A minimal ZIP writer, which is what a `.docx` is: an OOXML package is a zip
 * archive of XML parts and media.
 *
 * Entries are **stored**, not deflated. A document export is a download, not a
 * shipping artifact — a few hundred kilobytes of redundant XML cost nothing next
 * to the images beside it — and storing keeps this writer to a size a reader can
 * check: a local header, the bytes, a central directory, and an end record. No
 * compression level to get wrong, no deflate stream to trust.
 *
 * Pure: it takes parts and returns bytes, so the tests can unzip what it wrote.
 */

/** One file in the archive. */
export interface ZipPart {
  /** Path inside the archive, `/`-separated, as OOXML parts are named. */
  readonly name: string
  /** The part's bytes. */
  readonly data: Uint8Array
}

/** CRC-32 table, built once. The polynomial is the one ZIP specifies. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/**
 * The CRC-32 of one part, which the central directory records and a reader checks.
 * @param data - the part's bytes.
 * @returns the checksum, unsigned.
 */
export function crc32(data: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

/** Little-endian byte writer, appending into a growing array. */
class ByteWriter {
  private readonly chunks: Uint8Array[] = []
  private length = 0

  /** @returns how many bytes have been written so far. */
  get offset(): number {
    return this.length
  }

  /**
   * Append raw bytes.
   * @param bytes - the bytes to append.
   */
  bytes(bytes: Uint8Array): void {
    this.chunks.push(bytes)
    this.length += bytes.length
  }

  /**
   * Append one 16-bit little-endian value.
   * @param value - the value to append.
   */
  u16(value: number): void {
    const bytes = new Uint8Array(2)
    new DataView(bytes.buffer).setUint16(0, value, true)
    this.bytes(bytes)
  }

  /**
   * Append one 32-bit little-endian value.
   * @param value - the value to append.
   */
  u32(value: number): void {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
    this.bytes(bytes)
  }

  /** @returns every appended byte, joined. */
  finish(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const chunk of this.chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }
}

/**
 * Encode one path as UTF-8. Part names are ASCII in practice, but the flag and
 * encoding are stated rather than assumed.
 * @param value - the text to encode.
 * @returns its UTF-8 bytes.
 */
function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/**
 * Write the parts as a stored-entry ZIP archive.
 * @param parts - the archive's files, in the order they should appear.
 * @returns the archive's bytes.
 */
export function zip(parts: readonly ZipPart[]): Uint8Array {
  const out = new ByteWriter()
  const directory: { name: Uint8Array; crc: number; size: number; offset: number }[] = []
  // `mtime`/`mdate` are fixed rather than taken from the clock: an export must not
  // vary run to run for the same document, which also keeps it reproducible.
  const time = 0
  const date = 0x2821 // 2000-01-01, the earliest a reader is guaranteed to accept.

  for (const part of parts) {
    const name = utf8(part.name)
    const crc = crc32(part.data)
    const offset = out.offset
    out.u32(0x04034b50) // local file header
    out.u16(20) // version needed
    out.u16(0x0800) // UTF-8 names
    out.u16(0) // stored
    out.u16(time)
    out.u16(date)
    out.u32(crc)
    out.u32(part.data.length)
    out.u32(part.data.length)
    out.u16(name.length)
    out.u16(0) // no extra field
    out.bytes(name)
    out.bytes(part.data)
    directory.push({ name, crc, size: part.data.length, offset })
  }

  const directoryOffset = out.offset
  for (const entry of directory) {
    out.u32(0x02014b50) // central directory header
    out.u16(20) // version made by
    out.u16(20) // version needed
    out.u16(0x0800)
    out.u16(0)
    out.u16(time)
    out.u16(date)
    out.u32(entry.crc)
    out.u32(entry.size)
    out.u32(entry.size)
    out.u16(entry.name.length)
    out.u16(0) // extra
    out.u16(0) // comment
    out.u16(0) // disk number
    out.u16(0) // internal attributes
    out.u32(0) // external attributes
    out.u32(entry.offset)
    out.bytes(entry.name)
  }
  const directorySize = out.offset - directoryOffset

  out.u32(0x06054b50) // end of central directory
  out.u16(0)
  out.u16(0)
  out.u16(directory.length)
  out.u16(directory.length)
  out.u32(directorySize)
  out.u32(directoryOffset)
  out.u16(0) // no comment
  return out.finish()
}
