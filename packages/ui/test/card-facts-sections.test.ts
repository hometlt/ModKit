import { describe, expect, it } from 'vitest'
import type { RelatedSubjectFact, SubjectFact, SubjectFactsSource } from '@modkit/sdk'
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
): SubjectFactsSource {
  const groups = Object.keys(facts).map(id => ({ id, label: id, factCount: facts[id]!.length }))
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
})
