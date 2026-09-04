import { describe, it, expect } from 'vitest'
import { parseCatalogXml } from '../../../src/legacy/xml/parser.js'

const MARINE_XML = `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
  <CUnit id="Marine" parent="Terran_GroundUnit_Baseline">
    <Name value="Unit/Name/Marine"/>
    <LifeMax value="45"/>
    <Speed value="2.25"/>
    <Attributes index="Light" value="1"/>
    <Attributes index="Biological" value="1"/>
    <WeaponArray index="0" Link="GuassRifle"/>
    <WeaponArray index="1" Link="GuassRifleUb"/>
    <GlossaryStrongArray value="Marauder"/>
    <GlossaryStrongArray value="Medivac"/>
  </CUnit>
  <CUnit id="Marauder">
    <LifeMax value="125"/>
  </CUnit>
</Catalog>`

describe('parseCatalogXml', () => {
  it('parses root types', () => {
    const result = parseCatalogXml(MARINE_XML)
    expect(result.rootTypes).toContain('CUnit')
  })

  it('extracts two CUnit entries', () => {
    const result = parseCatalogXml(MARINE_XML)
    const units = result.entries.get('CUnit')
    expect(units).toHaveLength(2)
  })

  it('captures id and parent', () => {
    const result = parseCatalogXml(MARINE_XML)
    const marine = result.entries.get('CUnit')![0]!
    expect(marine.id).toBe('Marine')
    expect(marine.parent).toBe('Terran_GroundUnit_Baseline')
  })

  it('collapses single value= attribute to scalar', () => {
    const result = parseCatalogXml(MARINE_XML)
    const marine = result.entries.get('CUnit')![0]!
    expect(marine.fields['LifeMax']).toBe('45')
    expect(marine.fields['Speed']).toBe('2.25')
  })

  it('parses multi-attribute element as object', () => {
    const result = parseCatalogXml(MARINE_XML)
    const marine = result.entries.get('CUnit')![0]!
    // WeaponArray entries have index + Link attributes
    const weapons = marine.fields['WeaponArray']
    expect(Array.isArray(weapons)).toBe(true)
    const arr = weapons as any[]
    expect(arr[0]).toMatchObject({ index: '0', Link: 'GuassRifle' })
    expect(arr[1]).toMatchObject({ index: '1', Link: 'GuassRifleUb' })
  })

  it('parses indexed attributes array', () => {
    const result = parseCatalogXml(MARINE_XML)
    const marine = result.entries.get('CUnit')![0]!
    const attrs = marine.fields['Attributes'] as any[]
    expect(Array.isArray(attrs)).toBe(true)
    expect(attrs).toHaveLength(2)
    expect(attrs[0]).toMatchObject({ index: 'Light', value: '1' })
  })

  it('parses append array (no index)', () => {
    const result = parseCatalogXml(MARINE_XML)
    const marine = result.entries.get('CUnit')![0]!
    const glossary = marine.fields['GlossaryStrongArray'] as any[]
    expect(Array.isArray(glossary)).toBe(true)
    expect(glossary).toHaveLength(2)
  })
})

describe('parseSc2Strings', () => {
  it('parses key=value string file', async () => {
    const { parseSc2Strings } = await import('../../../src/legacy/xml/formats.js')
    const map = parseSc2Strings('Unit/Name/Marine=Marine\nUnit/Tooltip/Marine=A basic soldier\n')
    expect(map.get('Unit/Name/Marine')).toBe('Marine')
    expect(map.get('Unit/Tooltip/Marine')).toBe('A basic soldier')
  })

  it('keeps significant trailing whitespace in the value', async () => {
    const { parseSc2Strings } = await import('../../../src/legacy/xml/formats.js')
    // Blizzard's own GameStrings ships `UI/Unlocks_Colon=Unlocks: `; the trailing space
    // is the gap before the unit list in the tech-tree panel.
    const map = parseSc2Strings('UI/Unlocks_Colon=Unlocks: \r\n  Indented/Key=v\n')
    expect(map.get('UI/Unlocks_Colon')).toBe('Unlocks: ')
    expect(map.get('Indented/Key')).toBe('v') // leading whitespace still stripped
  })
})
