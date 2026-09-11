/**
 * The shared XML scanner, pinned where it is easy to get wrong.
 *
 * These cases are not a grammar exercise: each one is a way the scanner previously answered wrongly,
 * or a property a consumer depends on and would not notice losing until a file was already written.
 */
import { describe, expect, it } from 'vitest'

import {
  attrAt,
  decodeXmlEntities,
  elementPathAt,
  encodeXmlAttribute,
  encodeXmlText,
  getAttr,
  scanXml,
} from '../src/xml-scan.js'

describe('decodeXmlEntities', () => {
  it('decodes the five XML entities and both numeric forms', () => {
    expect(decodeXmlEntities('&quot;Objective&quot;')).toBe('"Objective"')
    expect(decodeXmlEntities('a &amp;&lt;&gt;&apos; b')).toBe('a &<>\' b')
    expect(decodeXmlEntities('&#65;&#x41;&#x1F600;')).toBe('AA\u{1F600}')
  })

  it('leaves an entity it does not know exactly as written', () => {
    // Guessing here would corrupt the one document that actually needs the literal text.
    expect(decodeXmlEntities('&nbsp;')).toBe('&nbsp;')
    expect(decodeXmlEntities('&#xZZ;')).toBe('&#xZZ;')
    expect(decodeXmlEntities('100% & rising')).toBe('100% & rising')
  })
})

describe('scanXml attributes', () => {
  it('reports the decoded value and keeps the source text beside it', () => {
    const text = '<Line text="Need another take. &quot;Objective&quot; came through"/>'
    const [root] = scanXml(text)
    const attr = getAttr(root!, 'text')!
    expect(attr.value).toBe('Need another take. "Objective" came through')
    // Offsets stay offsets into the document, not into the decoded string: an edit writes bytes.
    expect(text.slice(attr.valueStart, attr.valueEnd)).toBe(
      'Need another take. &quot;Objective&quot; came through',
    )
  })

  it('leaves a value without entities exactly as written', () => {
    const text = '<Frame type="Label" name="Title"/>'
    const attr = getAttr(scanXml(text)[0]!, 'name')!
    expect(attr.value).toBe('Title')
    expect(text.slice(attr.valueStart, attr.valueEnd)).toBe('Title')
  })

  it('finds the attribute containing an offset inside an entity', () => {
    const text = '<Line text="a &amp; b"/>'
    const [root] = scanXml(text)
    expect(attrAt(root!, text.indexOf('&amp;') + 2)?.name).toBe('text')
  })
})

describe('scanXml structure', () => {
  it('nests children and closes elements at the end tag', () => {
    const text = '<Catalog><CUnit id="Marine"><LifeMax value="45"/></CUnit></Catalog>'
    const [root] = scanXml(text)
    expect(root!.tag).toBe('Catalog')
    expect(root!.children[0]!.children[0]!.tag).toBe('LifeMax')
    expect(text.slice(root!.start, root!.end)).toBe(text)
  })

  it('extends an unclosed element to the end so a cursor inside it is still contained', () => {
    // This is the mid-edit case: help is worth most exactly when the document is malformed.
    const text = '<Catalog><CUnit id="Marine">'
    const path = elementPathAt(text, text.length - 1)
    expect(path.map(el => el.tag)).toEqual(['Catalog', 'CUnit'])
  })

  it('skips comments, CDATA and processing instructions', () => {
    const text = '<?xml version="1.0"?><!-- <Ghost/> --><Root><![CDATA[<Ghost/>]]></Root>'
    expect(scanXml(text).map(el => el.tag)).toEqual(['Root'])
  })
})

describe('encodeXmlText / encodeXmlAttribute', () => {
  it('escapes the markup characters, and the delimiter the writer chose', () => {
    expect(encodeXmlText(`a & b < c > d "e" 'f'`)).toBe(`a &amp; b &lt; c &gt; d "e" 'f'`)
    expect(encodeXmlAttribute('say "hi"')).toBe('say &quot;hi&quot;')
    expect(encodeXmlAttribute("say 'hi'", "'")).toBe('say &apos;hi&apos;')
    expect(encodeXmlAttribute(`"a" 'b'`, 'both')).toBe('&quot;a&quot; &apos;b&apos;')
  })

  it('round-trips through the scanner', () => {
    // The property the five hand-written copies were each trying to have, stated once.
    const value = 'Need <another> take. &  "Objective" — 100%'
    const text = `<Line text="${encodeXmlAttribute(value)}"/>`
    expect(getAttr(scanXml(text)[0]!, 'text')?.value).toBe(value)
  })

  it('escapes the ampersand first, so an escape is not escaped twice', () => {
    expect(encodeXmlText('&lt;')).toBe('&amp;lt;')
    expect(decodeXmlEntities(encodeXmlText('&lt;'))).toBe('&lt;')
  })
})
