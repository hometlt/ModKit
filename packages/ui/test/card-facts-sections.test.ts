import { describe, expect, it } from 'vitest'
import type {
  RelatedSubjectFact,
  SubjectFact,
  SubjectFactGroup,
  SubjectFactsSource,
} from '@modkit/sdk'
import {
  cardRefAction,
  loadSubjectCardSections,
  type CardLocation,
  type CardRef,
  type CardSection,
} from '../src/card/index.js'

function source(
  facts: Readonly<Record<string, readonly SubjectFact[]>>,
  relations: readonly RelatedSubjectFact[] = [],
  identity: Partial<Awaited<ReturnType<SubjectFactsSource['summary']>>['identity']> = {},
  shapes: Readonly<Record<string, Partial<SubjectFactGroup>>> = {},
): SubjectFactsSource {
  const groups = Object.keys(facts).map(id => ({
    id,
    label: id,
    factCount: facts[id]!.length,
    ...shapes[id],
  }))
  return {
    async summary() {
      return {
        snapshotId: 'fixture',
        identity: {
          subjectId: 'unit:Marine',
          kind: 'Unit',
          label: 'Marine',
          origins: [],
          ...identity,
        },
        groupCount: groups.length,
        relationCount: relations.length,
      }
    },
    async groups() {
      return { items: groups }
    },
    async facts(groupId) {
      return { items: facts[groupId] ?? [] }
    },
    async relations() {
      return { items: relations }
    },
  }
}

const fact = (id: string, value: SubjectFact['value'], extra: Partial<SubjectFact> = {}) =>
  ({ id, label: id, value, provenance: [], ...extra }) satisfies SubjectFact

const header = (sections: readonly CardSection[]) => {
  const first = sections[0]
  if (first?.kind !== 'header') throw new Error('no header')
  return first
}

describe('subject card projection of typed facts', () => {
  it('carries notes and renders lists and flat records as lines, not JSON', async () => {
    const sections = await loadSubjectCardSections(
      source({
        header: [
          fact('hash2', 7, { note: 'Expected to match the first hash' }),
          fact('dependencies', ['bnet:Liberty/0.0/999', 'bnet:Swarm/0.0/1001']),
          fact('info', { name: 'All Races', version: 2 }),
          fact('deep', { nested: { value: 1 } }),
        ],
      }),
    )
    const fields = sections.find(section => section.kind === 'fields')
    expect(fields).toMatchObject({
      fields: [
        { name: 'hash2', value: '7', note: 'Expected to match the first hash' },
        { name: 'dependencies', value: 'bnet:Liberty/0.0/999\nbnet:Swarm/0.0/1001' },
        { name: 'info', value: 'name: All Races\nversion: 2' },
        { name: 'deep', value: '{"nested":{"value":1}}' },
      ],
    })
  })

  it('lifts a stats group into the header and titles it with the chosen locale', async () => {
    const load = (locale?: string) =>
      loadSubjectCardSections(
        source(
          {
            stats: [fact('life', 45, { note: 'Maximum' }), fact('unit-minerals', 50)],
            text: [
              fact('description', 'Infantry', { locale: 'enUS' }),
              fact('description', 'Пехота', { locale: 'ruRU' }),
              fact('id', 'Marine'),
            ],
          },
          [],
          {
            portrait: 'Assets/Textures/btn-unit-terran-marine.dds',
            localizedLabels: { enUS: 'Marine', ruRU: 'Морпех' },
          },
        ),
        locale === undefined ? {} : { locale },
      )
    const english = await load()
    expect(header(english)).toMatchObject({
      title: 'Marine',
      description: 'Infantry',
      portraitImage: 'Assets/Textures/btn-unit-terran-marine.dds',
      stats: [
        { icon: '\u2665', value: '45', title: 'life \u2014 Maximum' },
        { icon: '\u25C6', value: '50' },
      ],
      aside: { options: ['enUS', 'ruRU'], value: 'enUS' },
    })
    expect(english.some(section => section.kind !== 'header' && section.id === 'stats')).toBe(false)
    const russian = await load('ruRU')
    expect(header(russian)).toMatchObject({ title: 'Морпех', description: 'Пехота' })
    const text = russian.find(section => section.kind === 'fields' && section.id === 'text')
    expect(text).toMatchObject({ fields: [{ value: 'Пехота' }, { value: 'Marine' }] })
  })

  it('lists each relation role as its own link section', async () => {
    const sections = await loadSubjectCardSections(
      source({}, [
        { role: 'weapon', subjectId: 'w', label: 'Gauss Rifle', kind: 'Weapon' },
        { role: 'ability', subjectId: 'a', label: 'Stimpack', kind: 'Abil' },
        { role: 'weapon', subjectId: 'x', label: 'Missing', kind: 'Weapon', dead: true },
      ]),
    )
    expect(
      sections
        .filter(section => section.kind === 'links')
        .map(section => [section.id, section.title]),
    ).toEqual([
      ['related:weapon', 'weapon'],
      ['related:ability', 'ability'],
    ])
    expect(sections.find(section => section.kind === 'links')).toMatchObject({
      links: [
        { label: 'Gauss Rifle', href: 'w' },
        { label: 'Missing', dead: true },
      ],
    })
  })

  it('lists every source of a fact in order and opens a declaration at its line', async () => {
    const unitData = {
      id: 'liberty-unitdata',
      uri: 'content-source://local:casc/mods/liberty.sc2mod/base.sc2data/GameData/UnitData.xml',
    }
    const sections = await loadSubjectCardSections(
      source(
        {
          combat: [
            fact('life', 45, {
              provenance: [
                { label: 'core:Core.SC2Mod' },
                {
                  label: 'liberty:UnitData.xml',
                  source: unitData,
                  range: { utf16Offset: 120, utf16Length: 9, line: 41, column: 4 },
                },
              ],
            }),
          ],
        },
        [],
        { origins: [{ label: 'UnitData.xml', source: unitData }] },
      ),
    )
    const declared: CardRef = {
      label: 'liberty:UnitData.xml',
      href: unitData.uri,
      location: { uri: unitData.uri, line: 41, column: 4 },
    }
    expect(sections.find(section => section.kind === 'fields')).toMatchObject({
      fields: [{ name: 'life', sources: [{ label: 'core:Core.SC2Mod' }, declared] }],
    })
    expect(header(sections).refs).toEqual([
      { label: 'UnitData.xml', href: unitData.uri, location: { uri: unitData.uri } },
    ])

    const opened: CardLocation[] = []
    const navigated: CardRef[] = []
    const open = (location: CardLocation) => void opened.push(location)
    const navigate = (item: CardRef) => void navigated.push(item)
    cardRefAction(declared, navigate, open)?.()
    expect(opened).toEqual([{ uri: unitData.uri, line: 41, column: 4 }])
    // a host without an editor still follows the address; a label without a file is only text
    cardRefAction(declared, navigate)?.()
    expect(navigated).toEqual([declared])
    expect(cardRefAction({ label: 'core:Core.SC2Mod' }, navigate, open)).toBeUndefined()
    expect(cardRefAction({ ...declared, dead: true }, navigate, open)).toBeUndefined()
  })

  it('marks a fact the codec declares writable with the write a table cell would make', async () => {
    const editable = { write: { operation: 'edit.field' } } as unknown as SubjectFact['editable']
    const sections = await loadSubjectCardSections(
      source({
        combat: [
          fact('life', 45, {
            type: { kind: 'number' } as SubjectFact['type'],
            unit: 'hp',
            editable,
          }),
          fact('armor', 0, { type: { kind: 'number' } as SubjectFact['type'] }),
        ],
      }),
    )
    const fields = sections.find(section => section.kind === 'fields')
    expect(fields).toMatchObject({
      fields: [
        {
          name: 'life',
          edit: {
            type: { kind: 'number' },
            unit: 'hp',
            editable,
            value: 45,
            target: { groupId: 'combat', key: 'life' },
          },
        },
        { name: 'armor' },
      ],
    })
    // a value without a declared write stays text
    expect(fields?.kind === 'fields' ? fields.fields[1]?.edit : 'not fields').toBeUndefined()
  })

  it('writes a fact at the semantic path its source names, so the codec knows the entity', async () => {
    const editable = { write: { operation: 'edit.field' } } as unknown as SubjectFact['editable']
    const sections = await loadSubjectCardSections(
      source({
        combat: [
          fact('LifeMax', 45, {
            type: { kind: 'number' } as SubjectFact['type'],
            editable,
            provenance: [
              { label: 'Liberty' },
              { label: 'Core', semanticPath: ['Unit', 'Marine', 'LifeMax'] },
            ],
          }),
        ],
      }),
    )
    const fields = sections.find(section => section.kind === 'fields')
    expect(fields?.kind === 'fields' ? fields.fields[0]?.edit?.target : 'not fields').toEqual({
      groupId: 'combat',
      key: 'LifeMax',
      path: ['Unit', 'Marine', 'LifeMax'],
    })
  })

  it('lays a slots group out as a command card, each fact a cell of its grid (5.12)', async () => {
    const pages = [
      { id: 'Root', label: 'Commands' },
      { id: 'Build', label: 'Build structure' },
    ]
    const sections = await loadSubjectCardSections(
      source(
        {
          'command-card': [
            fact(
              'Move',
              { description: 'Moves the unit.' },
              {
                slot: { row: 0, column: 0, page: 'Root', hotkey: 'M', subjectId: 'button:Move' },
              },
            ),
            fact('Build', 'Opens the build menu', {
              note: 'A submenu',
              slot: { row: 2, column: 0, page: 'Root', image: 'btn-build', opensPage: 'Build' },
            }),
            fact('Loose', 'not on the grid'),
          ],
        },
        [],
        {},
        { 'command-card': { presentation: 'slots', slots: { rows: 3, columns: 5, pages } } },
      ),
    )
    const grid = sections.find(section => section.kind === 'grid')
    if (grid?.kind !== 'grid') throw new Error('no grid section')
    expect([grid.rows, grid.columns, grid.pages]).toEqual([3, 5, pages])
    expect(grid.cells).toEqual([
      {
        id: 'Move',
        label: 'Move',
        row: 0,
        column: 0,
        page: 'Root',
        hotkey: 'M',
        detail: 'description: Moves the unit.',
        ref: { label: 'Move', href: 'button:Move' },
      },
      {
        id: 'Build',
        label: 'Build',
        row: 2,
        column: 0,
        page: 'Root',
        image: 'btn-build',
        detail: 'A submenu\nOpens the build menu',
        opensPage: 'Build',
      },
    ])
    // a fact without a cell is still shown, as a field
    const fields = sections.find(
      section => section.kind === 'fields' && section.id === 'command-card',
    )
    expect(fields?.kind === 'fields' ? fields.fields.map(field => field.name) : []).toEqual([
      'Loose',
    ])
  })
})
