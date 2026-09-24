/**
 * The few byte-level helpers the Office readers share.
 *
 * An OOXML package carries its pictures as real image files, so a reader that
 * wants to show one needs the bytes back as a `data:` URL — the same shape the
 * preview already uses for a workspace image.
 */

/** Image media types this pane can actually draw, by file suffix. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/**
 * One part's media type from its name.
 * @param path - the part's path inside the package.
 * @returns the media type, or undefined when this pane cannot draw it.
 */
export function imageMediaTypeOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  return IMAGE_MEDIA_TYPES[name.slice(dot + 1).toLowerCase()]
}

/**
 * Encode bytes as base64.
 *
 * Chunked because `String.fromCharCode` takes its arguments on the stack: one
 * call per eight kilobytes keeps a multi-megabyte image from overflowing it.
 * @param bytes - the bytes.
 * @returns their base64.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x2000
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, Math.min(at + chunk, bytes.length)))
  }
  return btoa(binary)
}

/**
 * One image as a URL the renderer can draw.
 * @param bytes - the image's bytes.
 * @param mediaType - its media type.
 * @returns the `data:` URL.
 */
export function dataUrlOf(bytes: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`
}

/**
 * Resolve one package-relative path against the part that named it.
 *
 * A relationship's target is written relative to the folder holding its own
 * part, and OOXML uses `..` freely; folding it here keeps a part name absolute
 * inside the package, which is what every lookup wants.
 * @param base - the naming part's folder, such as `word`.
 * @param target - the target as written.
 * @returns the resolved part path.
 */
export function resolvePart(base: string, target: string): string {
  const segments = target.startsWith('/') ? [] : base.split('/').filter(part => part !== '')
  for (const part of target.replace(/^\//, '').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return segments.join('/')
}
