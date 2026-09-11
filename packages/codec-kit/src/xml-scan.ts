/**
 * A position-aware, lenient XML scanner — the shared one.
 *
 * Ported from MK2's `sc2-data/src/language/xml-scan.ts`, which is where it was written and proven.
 * It lives here rather than inside one codec because several XML formats had each grown their own
 * scanner, and scanners of the same grammar disagree eventually — the disagreement shows up as a
 * diagnostic that fires in one editor and not another. sc2-bank, sc2-style, sc2-data and
 * sc2-strings read through this one.
 *
 * One reader stayed separate and should: sc2-layout's is a validating, bounded, cancellable parser
 * that reports coded diagnostics, which is a different job from recovering silently. It shares the
 * entity layer below rather than the walk, which is the part the two actually had to agree on.
 *
 * Two properties matter and are why a general XML parser is not used here.
 *
 * Every tag and attribute value carries its character offset, because editor features — diagnostics,
 * completion, hover — are ranges over source text, and a parser that builds a document object model
 * has already thrown those away.
 *
 * It never throws. It runs on documents that are mid-edit, and a parser that refuses malformed input
 * reports nothing at exactly the moment help is worth most.
 *
 * It is deliberately not a general XML parser: text content and namespaces are ignored, because the
 * formats it serves do not use them in ways that change what an editor must show. Entities in
 * attribute values are *not* ignored — see `decodeXmlEntities` below for why.
 */

/**
 * Turn `&quot;`, `&#65;` and `&#x41;` back into the characters they stand for.
 *
 * The scanner used to hand back attribute values verbatim, on the reasoning that the formats do not
 * use entities. They do: a sweep of 400 game files found 59 attributes carrying one, most of them
 * quoted speech inside conversation text. A checker comparing such a value against a name, or a
 * table showing it to a reader, was working with `&quot;Objective&quot;` where the document means
 * `"Objective"` — so the string it reported was never the string the game sees.
 *
 * An entity this does not recognise is left exactly as written. A lenient scanner's job is to keep
 * going; replacing an unknown `&foo;` with a guess would corrupt the one document that needs it.
 */
export function decodeXmlEntities(source: string): string {
  // Fast path: most values have no '&' at all, and this runs over every attribute of every file.
  if (!source.includes('&')) return source
  return source.replace(/&(?:#(x[0-9A-Fa-f]+|[0-9]+)|([A-Za-z][A-Za-z0-9]*));/gu, (raw, numeric, named) => {
    if (numeric !== undefined) {
      const hex = numeric[0]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(hex ? numeric.slice(1) : numeric, hex ? 16 : 10)
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : raw
    }
    return NAMED_ENTITIES[(named as string).toLowerCase()] ?? raw
  })
}

/**
 * The five entities XML defines itself.
 *
 * Deliberately not the HTML set: an XML document that writes `&nbsp;` without declaring it is
 * malformed, and silently accepting it here would hide that from whoever has to fix the file.
 */
const NAMED_ENTITIES: Record<string, string> = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
})

/**
 * Escape a string so it can be written as XML element text.
 *
 * The inverse of `decodeXmlEntities`, and here for the same reason the decoder is: five writers
 * across the codecs had each written this by hand and no two agreed. One escaped `>` and another
 * did not; one handled both quote characters and another one. None of the differences produced a
 * malformed document — they produced documents that differ byte for byte from each other for the
 * same input, which is what makes a round-trip claim impossible to keep.
 *
 * `>` is escaped although XML only requires it inside `]]>`. Every writer that existed did so, and
 * a reader diffing two files should not have to know which one was written by which.
 */
export function encodeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Escape a string for use inside an attribute's quotes.
 *
 * `quote` says which delimiter the writer uses, because only that one has to be escaped. `'both'`
 * is for a writer that would rather its output be safe under either delimiter than depend on its
 * own formatting staying the same.
 */
export function encodeXmlAttribute(value: string, quote: '"' | "'" | 'both' = '"'): string {
  const escaped = encodeXmlText(value)
  if (quote === 'both') return escaped.replaceAll('"', '&quot;').replaceAll("'", '&apos;')
  return quote === '"' ? escaped.replaceAll('"', '&quot;') : escaped.replaceAll("'", '&apos;')
}

export interface ScannedAttr {
  name: string
  /** Offset of the first character of the attribute name. */
  nameStart: number
  /** Offset just past the attribute name. */
  nameEnd: number
  /**
   * Attribute value with surrounding quotes stripped and entities decoded — what the document
   * means, which is what a checker should compare and a viewer should show.
   *
   * This is no longer the same string as the source span. Anything that edits the document, or
   * measures a byte offset inside the value, must slice the source text by `valueStart`/`valueEnd`
   * instead: those still say where the value is, entities and all.
   */
  value: string
  /** Offset of the first character of the value (inside the quotes). */
  valueStart: number
  /** Offset just past the last character of the value. */
  valueEnd: number
}

export interface ScannedElement {
  /** Element/tag name, e.g. `CUnit` or `LifeMax`. */
  tag: string
  /** Offset of the tag name in the opening tag. */
  tagStart: number
  tagEnd: number
  /** Offset of the opening `<`. */
  start: number
  /** Offset just past the closing `>` (of `/>` or `</tag>`). */
  end: number
  /** Offset just past the open tag's own `>` (where element content begins). */
  openEnd: number
  attrs: ScannedAttr[]
  children: ScannedElement[]
}

interface OpenTag {
  tag: string
  tagStart: number
  tagEnd: number
  attrs: ScannedAttr[]
  /** Offset just past the `>` of the opening tag. */
  openEnd: number
  selfClosing: boolean
}

const NAME_CHAR = /[A-Za-z0-9_:.-]/

/** Parse the contents of one `<...>` opening/self-closing tag starting at `lt`. */
function readTag(
  text: string,
  lt: number,
): { open: OpenTag; next: number; closing: boolean } | undefined {
  let i = lt + 1
  let closing = false
  if (text[i] === '/') {
    closing = true
    i++
  }

  const tagStart = i
  while (i < text.length && NAME_CHAR.test(text[i]!)) i++
  if (i === tagStart) return undefined // not a tag (e.g. a stray '<')
  const tag = text.slice(tagStart, i)
  const tagEnd = i

  const attrs: ScannedAttr[] = []
  let selfClosing = false

  // Walk to the matching '>', collecting attributes, respecting quoted values.
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '>') {
      i++
      break
    }
    if (ch === '/' && text[i + 1] === '>') {
      selfClosing = true
      i += 2
      break
    }
    // An unquoted '<' means the tag was never closed (mid-edit) — stop here rather
    // than greedily consuming the following markup into this tag.
    if (ch === '<') break
    if (NAME_CHAR.test(ch)) {
      const nameStart = i
      while (i < text.length && NAME_CHAR.test(text[i]!)) i++
      const name = text.slice(nameStart, i)
      const nameEnd = i
      while (i < text.length && /\s/.test(text[i]!)) i++
      if (text[i] === '=') {
        i++
        while (i < text.length && /\s/.test(text[i]!)) i++
        const quote = text[i]
        if (quote === '"' || quote === "'") {
          const valueStart = i + 1
          const close = text.indexOf(quote, valueStart)
          const valueEnd = close === -1 ? text.length : close
          attrs.push({
            name,
            nameStart,
            nameEnd,
            value: decodeXmlEntities(text.slice(valueStart, valueEnd)),
            valueStart,
            valueEnd,
          })
          i = close === -1 ? text.length : close + 1
        }
      }
      continue
    }
    i++
  }

  return {
    open: { tag, tagStart, tagEnd, attrs, openEnd: i, selfClosing },
    next: i,
    closing,
  }
}

/**
 * Scan the document into a forest of `ScannedElement`s (the top-level catalog
 * entities). Children are nested. Robust to malformed/incomplete markup.
 */
export function scanXml(text: string): ScannedElement[] {
  const roots: ScannedElement[] = []
  const stack: Array<{ el: ScannedElement; tag: string }> = []
  let i = 0

  const attach = (el: ScannedElement): void => {
    const parent = stack[stack.length - 1]
    if (parent) parent.el.children.push(el)
    else roots.push(el)
  }

  while (i < text.length) {
    const lt = text.indexOf('<', i)
    if (lt === -1) break

    // Skip comments / CDATA / DOCTYPE / processing instructions.
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt + 4)
      i = e === -1 ? text.length : e + 3
      continue
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt + 9)
      i = e === -1 ? text.length : e + 3
      continue
    }
    if (text.startsWith('<?', lt)) {
      const e = text.indexOf('?>', lt + 2)
      i = e === -1 ? text.length : e + 2
      continue
    }
    if (text.startsWith('<!', lt)) {
      const e = text.indexOf('>', lt + 2)
      i = e === -1 ? text.length : e + 1
      continue
    }

    const parsed = readTag(text, lt)
    if (!parsed) {
      i = lt + 1
      continue
    }

    if (parsed.closing) {
      // Pop the matching open element (search from the top for resilience). Any
      // dangling open children above it (mid-edit, never closed) extend to EOF so a
      // cursor inside them is still found.
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s]!.tag === parsed.open.tag) {
          for (let k = s + 1; k < stack.length; k++) stack[k]!.el.end = text.length
          stack[s]!.el.end = parsed.next
          stack.length = s
          break
        }
      }
      i = parsed.next
      continue
    }

    const { open } = parsed
    const el: ScannedElement = {
      tag: open.tag,
      tagStart: open.tagStart,
      tagEnd: open.tagEnd,
      start: lt,
      end: open.openEnd,
      openEnd: open.openEnd,
      attrs: open.attrs,
      children: [],
    }
    attach(el)
    if (!open.selfClosing) stack.push({ el, tag: open.tag })
    i = parsed.next
  }

  // Elements left open at EOF (mid-edit / unclosed) extend to the end of the text,
  // so a cursor inside them is correctly found as contained.
  for (const s of stack) s.el.end = text.length

  return roots
}

/** Find the attribute named `name` (case-sensitive), if present. */
export function getAttr(el: ScannedElement, name: string): ScannedAttr | undefined {
  return el.attrs.find(a => a.name === name)
}

/**
 * Path of elements from the root entity down to the deepest one containing `offset`.
 * Containment is half-open `(start, end)`: a cursor exactly at an element's `<` is
 * "before" it, and one at a self-closed element's trailing boundary is "after" it —
 * so `<Foo/>|` lands in the parent's content, not inside `Foo`.
 */
export function elementPathAt(text: string, offset: number): ScannedElement[] {
  return pathTo(scanXml(text), offset, [])
}

function pathTo(els: ScannedElement[], offset: number, acc: ScannedElement[]): ScannedElement[] {
  for (const el of els) {
    if (offset > el.start && offset < el.end) {
      acc.push(el)
      pathTo(el.children, offset, acc)
      return acc
    }
  }
  return acc
}

/** The attribute whose value span contains `offset`, if any. */
export function attrAt(el: ScannedElement, offset: number): ScannedAttr | undefined {
  return el.attrs.find(a => offset >= a.valueStart && offset <= a.valueEnd)
}
