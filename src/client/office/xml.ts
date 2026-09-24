/**
 * A very small XML reader, for the OOXML parts inside an Office package.
 *
 * `DOMParser` would parse these too, and it is the obvious choice — except that
 * it does not exist outside a browser, and this repository tests its parsing in
 * Node. A reader that works in both is worth a hundred lines, and OOXML is a
 * narrow dialect to read: machine-generated, well-formed, no DTD, no entity
 * declarations beyond the five named ones and numeric references.
 *
 * Elements keep their qualified name (`w:p`) and their local name (`p`), because
 * every OOXML part binds its own prefixes and a reader that trusts `w:` is
 * trusting a convention rather than the document. Lookups go by local name.
 *
 * Text is kept exactly as written, whitespace included: `<w:t xml:space="preserve">
 * </w:t>` is a space the document means to show, and collapsing it would change
 * what the reader sees.
 */

/** One parsed element. */
export interface XmlElement {
  /** The element's qualified name, such as `w:p`. */
  readonly name: string
  /** The element's local name, such as `p`. */
  readonly local: string
  /** Its attributes, keyed by qualified name. */
  readonly attributes: ReadonlyMap<string, string>
  /** Its children, in document order: elements and text. */
  readonly children: readonly (XmlElement | string)[]
}

/** How deep an element may nest before the document is called malformed. */
const MAX_DEPTH = 200

/** The five entities XML defines by name. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

/**
 * Resolve the character references in one run of text.
 * @param text - the raw text.
 * @returns the text with known references resolved and unknown ones kept.
 */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const hexadecimal = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(hexadecimal ? body.slice(2) : body.slice(1), hexadecimal ? 16 : 10)
      const valid = Number.isFinite(code) && code > 0 && code <= 0x10ffff
      return valid ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

/**
 * Parse one XML document.
 * @param source - the document's text.
 * @returns its root element.
 */
export function parseXml(source: string): XmlElement {
  let at = 0

  const isSpace = (character: string | undefined): boolean =>
    character === ' ' || character === '\t' || character === '\n' || character === '\r'

  const skipSpace = (): void => { while (at < source.length && isSpace(source[at])) at++ }

  /** Step over the prolog: declarations, comments, and a DOCTYPE if one is there. */
  const skipProlog = (): void => {
    for (;;) {
      skipSpace()
      if (source.startsWith('<?', at)) {
        const end = source.indexOf('?>', at)
        if (end < 0) throw new Error('the XML declaration is never closed')
        at = end + 2
        continue
      }
      if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at)
        if (end < 0) throw new Error('an XML comment is never closed')
        at = end + 3
        continue
      }
      if (source.startsWith('<!', at)) {
        // A DOCTYPE, which OOXML parts do not carry; skipping to its `>` is
        // enough because nothing here is expanded from it.
        const end = source.indexOf('>', at)
        if (end < 0) throw new Error('a declaration is never closed')
        at = end + 1
        continue
      }
      return
    }
  }

  const readName = (): string => {
    const start = at
    while (at < source.length) {
      const character = source[at] as string
      if (isSpace(character) || character === '>' || character === '/' || character === '=') break
      at++
    }
    if (at === start) throw new Error(`expected a name at offset ${at}`)
    return source.slice(start, at)
  }

  const expect = (character: string): void => {
    if (source[at] !== character) throw new Error(`expected "${character}" at offset ${at}`)
    at++
  }

  const makeElement = (
    name: string,
    attributes: ReadonlyMap<string, string>,
    children: readonly (XmlElement | string)[],
  ): XmlElement => {
    const colon = name.indexOf(':')
    return { name, local: colon < 0 ? name : name.slice(colon + 1), attributes, children }
  }

  const parseElement = (depth: number): XmlElement => {
    if (depth > MAX_DEPTH) throw new Error('the document nests too deeply to read')
    expect('<')
    const name = readName()
    const attributes = new Map<string, string>()
    for (;;) {
      skipSpace()
      const character = source[at]
      if (character === '/') {
        at++
        expect('>')
        return makeElement(name, attributes, [])
      }
      if (character === '>') {
        at++
        break
      }
      if (character === undefined) throw new Error(`<${name}> is never closed`)
      const attribute = readName()
      skipSpace()
      expect('=')
      skipSpace()
      const quote = source[at]
      if (quote !== '"' && quote !== "'") throw new Error(`attribute ${attribute} has no quoted value`)
      at++
      const end = source.indexOf(quote, at)
      if (end < 0) throw new Error(`attribute ${attribute} has no closing quote`)
      attributes.set(attribute, decodeEntities(source.slice(at, end)))
      at = end + 1
    }

    const children: (XmlElement | string)[] = []
    for (;;) {
      if (at >= source.length) throw new Error(`<${name}> is never closed`)
      if (source.startsWith('</', at)) {
        at += 2
        const closing = readName()
        skipSpace()
        expect('>')
        if (closing !== name) throw new Error(`</${closing}> closes <${name}>`)
        return makeElement(name, attributes, children)
      }
      if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at)
        if (end < 0) throw new Error('an XML comment is never closed')
        at = end + 3
        continue
      }
      if (source.startsWith('<![CDATA[', at)) {
        const end = source.indexOf(']]>', at)
        if (end < 0) throw new Error('a CDATA section is never closed')
        children.push(source.slice(at + 9, end))
        at = end + 3
        continue
      }
      if (source.startsWith('<?', at)) {
        const end = source.indexOf('?>', at)
        if (end < 0) throw new Error('a processing instruction is never closed')
        at = end + 2
        continue
      }
      if (source[at] === '<') {
        children.push(parseElement(depth + 1))
        continue
      }
      const next = source.indexOf('<', at)
      const end = next < 0 ? source.length : next
      children.push(decodeEntities(source.slice(at, end)))
      at = end
    }
  }

  skipProlog()
  if (source[at] !== '<') throw new Error('the document holds no root element')
  return parseElement(0)
}

/**
 * Whether one node is an element.
 * @param node - the node.
 * @returns whether it is an element rather than text.
 */
export function isElement(node: XmlElement | string): node is XmlElement {
  return typeof node !== 'string'
}

/**
 * One attribute's value, looked up by local name so a bound prefix does not
 * matter.
 * @param element - the element.
 * @param local - the attribute's local name, such as `val`.
 * @returns its value, or undefined when the attribute is absent.
 */
export function attribute(element: XmlElement, local: string): string | undefined {
  const direct = element.attributes.get(local)
  if (direct !== undefined) return direct
  for (const [name, value] of element.attributes) {
    const colon = name.indexOf(':')
    if (colon >= 0 && name.slice(colon + 1) === local) return value
  }
  return undefined
}

/**
 * An element's direct element children.
 * @param element - the element.
 * @param local - when given, only children with this local name.
 * @returns the children, in document order.
 */
export function elements(element: XmlElement, local?: string): XmlElement[] {
  const found: XmlElement[] = []
  for (const child of element.children) {
    if (!isElement(child)) continue
    if (local === undefined || child.local === local) found.push(child)
  }
  return found
}

/**
 * Whether a subtree is the legacy branch of an `mc:AlternateContent` wrapper.
 *
 * Markup Compatibility lets one document carry two spellings of the same shape —
 * a modern `mc:Choice` and an older `mc:Fallback`. Reading both would count every
 * such shape twice, and the fallback is by definition the one the producing
 * application did not prefer.
 * @param node - the node to test.
 * @returns whether to skip it.
 */
function isFallbackBranch(node: XmlElement | string): boolean {
  return isElement(node) && node.local === 'Fallback'
}

/**
 * Every descendant element with one local name, in document order.
 * @param element - the element to search, which is not itself tested.
 * @param local - the local name to match.
 * @returns the matching descendants.
 */
export function descendants(element: XmlElement, local: string): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (node: XmlElement): void => {
    for (const child of node.children) {
      if (!isElement(child) || isFallbackBranch(child)) continue
      if (child.local === local) found.push(child)
      walk(child)
    }
  }
  walk(element)
  return found
}

/**
 * The first descendant element with one local name.
 * @param element - the element to search.
 * @param local - the local name to match.
 * @returns the element, or undefined when there is none.
 */
export function firstDescendant(element: XmlElement, local: string): XmlElement | undefined {
  return descendants(element, local)[0]
}

/**
 * All the text under one element, in document order.
 * @param element - the element.
 * @returns its text, with element boundaries contributing nothing.
 */
export function textContent(element: XmlElement): string {
  let text = ''
  for (const child of element.children) {
    if (isElement(child)) text += textContent(child)
    else text += child
  }
  return text
}
