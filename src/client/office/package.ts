/**
 * The parts every OOXML package shares, whichever document is inside it.
 *
 * A package names its pieces indirectly: the document points at a picture or a
 * worksheet by *relationship id*, and the id is defined in a `.rels` part beside
 * the pointing part. Reading that indirection is the same work for Word, Excel,
 * and PowerPoint, so it lives here once.
 */
import { attribute, descendants, parseXml } from './xml.ts'
import type { ZipArchive } from './zip.ts'

/** One relationship target, as a package records it. */
export interface Relationship {
  /** The target as written: package-relative, or a URL when external. */
  readonly target: string
  /** A target outside the package, which this reader never fetches. */
  readonly external: boolean
}

/**
 * The relationships part that belongs to one part.
 * @param part - the part's path, such as `word/document.xml`.
 * @returns its relationships part's path.
 */
export function relationshipsPart(part: string): string {
  const slash = part.lastIndexOf('/')
  const folder = slash < 0 ? '' : part.slice(0, slash + 1)
  return `${folder}_rels/${part.slice(slash + 1)}.rels`
}

/**
 * Read one part's relationships.
 * @param zip - the open package.
 * @param part - the part whose relationships are wanted.
 * @returns the targets by relationship id.
 */
export async function readRelationships(
  zip: ZipArchive,
  part: string,
): Promise<Map<string, Relationship>> {
  const relationships = new Map<string, Relationship>()
  const text = await zip.text(relationshipsPart(part))
  if (text === undefined) return relationships
  for (const node of descendants(parseXml(text), 'Relationship')) {
    const id = attribute(node, 'Id')
    const target = attribute(node, 'Target')
    if (id === undefined || target === undefined) continue
    relationships.set(id, { target, external: attribute(node, 'TargetMode') === 'External' })
  }
  return relationships
}
