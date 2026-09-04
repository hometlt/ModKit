import { describe, it, expect } from 'vitest'
import { parseComponentList, parseSc2ComponentList } from '../../../src/legacy/xml/index.js'

// Verbatim real ComponentList.SC2Components content (SC2GameData + the committed fixture).
const FRONTIERS = `<?xml version="1.0" encoding="us-ascii"?>
<Components>
    <DataComponent Type="gada">GameData</DataComponent>
    <DataComponent Type="text" Locale="enUS">GameText</DataComponent>
    <DataComponent Type="info">DocumentInfo</DataComponent>
    <DataComponent Type="trig">Triggers</DataComponent>
    <DataComponent Type="uiui">UI/Layout/DescIndex.SC2Layout</DataComponent>
</Components>`

const SWARMSTORYUTIL = `<?xml version="1.0" encoding="us-ascii"?>
<Components>
    <DataComponent Type="gada">GameData</DataComponent>
    <DataComponent Type="text" Locale="enUS">GameText</DataComponent>
    <DataComponent Type="text" Locale="koKR">GameText</DataComponent>
    <DataComponent Type="text" Locale="deDE">GameText</DataComponent>
    <DataComponent Type="text" Locale="esES">GameText</DataComponent>
    <DataComponent Type="text" Locale="frFR">GameText</DataComponent>
    <DataComponent Type="text" Locale="itIT">GameText</DataComponent>
    <DataComponent Type="text" Locale="plPL">GameText</DataComponent>
    <DataComponent Type="text" Locale="ruRU">GameText</DataComponent>
    <DataComponent Type="text" Locale="zhCN">GameText</DataComponent>
    <DataComponent Type="text" Locale="zhTW">GameText</DataComponent>
    <DataComponent Type="text" Locale="ptBR">GameText</DataComponent>
    <DataComponent Type="text" Locale="esMX">GameText</DataComponent>
    <DataComponent Type="info">DocumentInfo</DataComponent>
    <DataComponent Type="trig">Triggers</DataComponent>
    <DataComponent Type="cuts">Cutscenes/Index</DataComponent>
    <DataComponent Type="plob">Objects</DataComponent>
    <DataComponent Type="text" Locale="enGB">GameText</DataComponent>
</Components>`

// The committed fixture — note the self-closing <Optimized/> that must be ignored.
const FIXTURE = `<?xml version="1.0" encoding="us-ascii"?>
<Components>
    <Optimized/>
    <DataComponent Type="gada">GameData</DataComponent>
    <DataComponent Type="text" Locale="enUS">GameText</DataComponent>
    <DataComponent Type="info">DocumentInfo</DataComponent>
    <DataComponent Type="mapi">MapInfo</DataComponent>
    <DataComponent Type="trig">Triggers</DataComponent>
</Components>`

describe('parseComponentList (Plan 4e-A A1)', () => {
  it('parses an enUS-only mod (frontiers) incl. a uiui component', () => {
    const r = parseComponentList(FRONTIERS)
    expect(r.isXml).toBe(true)
    expect(r.locales).toEqual(['enUS'])
    expect(r.components.map(c => c.type)).toEqual(['gada', 'text', 'info', 'trig', 'uiui'])
    expect(r.components.find(c => c.type === 'uiui')?.path).toBe('UI/Layout/DescIndex.SC2Layout')
    expect(r.components.find(c => c.type === 'text')?.locale).toBe('enUS')
  })

  it('enumerates all declared locales in first-seen order (multi-locale campaign)', () => {
    const r = parseComponentList(SWARMSTORYUTIL)
    expect(r.locales).toEqual([
      'enUS',
      'koKR',
      'deDE',
      'esES',
      'frFR',
      'itIT',
      'plPL',
      'ruRU',
      'zhCN',
      'zhTW',
      'ptBR',
      'esMX',
      'enGB',
    ])
    expect(r.components.find(c => c.type === 'cuts')?.locale).toBeUndefined()
    expect(r.components.find(c => c.type === 'plob')?.path).toBe('Objects')
  })

  it('ignores <Optimized/> and other non-DataComponent tags (fixture)', () => {
    const r = parseComponentList(FIXTURE)
    expect(r.isXml).toBe(true)
    expect(r.components).toHaveLength(5) // Optimized excluded
    expect(r.components.map(c => c.type)).toContain('mapi')
    expect(r.locales).toEqual(['enUS'])
  })

  it('strips a BOM and dedups repeated locales', () => {
    const r = parseComponentList(
      '﻿<Components><DataComponent Type="text" Locale="enUS">GameText</DataComponent>' +
        '<DataComponent Type="text" Locale="enUS">GameText</DataComponent></Components>',
    )
    expect(r.locales).toEqual(['enUS'])
    expect(r.components).toHaveLength(2)
  })

  it('is not XML for the legacy flat-text convention; the legacy reader still works', () => {
    const r = parseComponentList('mods/liberty.sc2mod\nmods/void.sc2mod\n// comment')
    expect(r.isXml).toBe(false)
    expect(r.components).toEqual([])
    expect(r.locales).toEqual([])
    expect(parseSc2ComponentList('mods/liberty.sc2mod\n// c\nmods/void.sc2mod')).toEqual([
      'mods/liberty.sc2mod',
      'mods/void.sc2mod',
    ])
  })
})
