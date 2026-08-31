import { describe, expect, it } from 'vitest'
import type { KnowledgeTarget, SubjectFactsSource } from '@modkit/sdk'
import { loadSubjectCardSections, type CardSection } from '../src/card/index.js'
import { createUiLocalizer } from '../src/localization/index.js'

const linkSection = (
  section: CardSection,
): section is Extract<CardSection, { readonly kind: 'links' }> => section.kind === 'links'

describe('subject-card knowledge projection', () => {
  it('preserves the exact codec-owned knowledge target on the projected field', async () => {
    const target: KnowledgeTarget = {
      kind: 'field',
      ecosystem: 'fixture',
      schema: { contract: 'org.example/schema', major: 1, revision: 'fixture-1' },
      typeId: 'Fixture',
      canonicalPath: ['Value'],
    }
    const source: SubjectFactsSource = {
      async summary() {
        return {
          snapshotId: 'content-hash.sha256:fixture',
          identity: { subjectId: 'fixture', kind: 'entity', label: 'Fixture', origins: [] },
          groupCount: 1,
          relationCount: 0,
        }
      },
      async groups() {
        return { items: [{ id: 'core', label: 'Core', factCount: 1 }] }
      },
      async facts() {
        return {
          items: [
            {
              id: 'value',
              label: 'Value',
              value: 7,
              provenance: [],
              knowledgeTarget: target,
            },
          ],
        }
      },
      async relations() {
        return { items: [] }
      },
    }

    const sections = await loadSubjectCardSections(source)
    const fields = sections.find(section => section.kind === 'fields')
    expect(fields).toMatchObject({
      kind: 'fields',
      fields: [{ name: 'Value', value: '7', knowledgeTarget: target }],
    })
  })

  it('localizes stable extension-subject ids while preserving codec-owned labels', async () => {
    const source: SubjectFactsSource = {
      async summary() {
        return {
          snapshotId: 'extension-fixture',
          identity: {
            subjectId: 'contribution-fixture',
            kind: 'modkit/contribution',
            label: 'Fixture contribution',
            origins: [],
          },
          groupCount: 1,
          relationCount: 0,
        }
      },
      async groups() {
        return { items: [{ id: 'overview', label: 'Overview', factCount: 2 }] }
      },
      async facts() {
        return {
          items: [
            { id: 'id', label: 'Contribution ID', value: 'fixture', provenance: [] },
            { id: 'spec.codec-field', label: 'Codec-owned field', value: 7, provenance: [] },
          ],
        }
      },
      async relations() {
        return { items: [] }
      },
    }

    const english = await loadSubjectCardSections(source, { localizer: createUiLocalizer('en') })
    const russian = await loadSubjectCardSections(source, { localizer: createUiLocalizer('ru') })
    expect(english.find(section => section.kind === 'fields')).toMatchObject({
      title: 'Overview',
      fields: [{ name: 'Contribution ID' }, { name: 'Codec-owned field' }],
    })
    expect(russian.find(section => section.kind === 'fields')).toMatchObject({
      title: 'Обзор',
      fields: [{ name: 'Идентификатор возможности' }, { name: 'Codec-owned field' }],
    })
  })

  it('renders extension contributions as navigable links instead of JSON fields', async () => {
    const source: SubjectFactsSource = {
      async summary() {
        return {
          snapshotId: 'extension-fixture',
          identity: {
            subjectId: 'extension-fixture',
            kind: 'modkit/extension',
            label: 'Fixture extension',
            origins: [],
          },
          groupCount: 1,
          relationCount: 1,
        }
      },
      async groups() {
        return { items: [{ id: 'contributions', label: 'Contributions', factCount: 1 }] }
      },
      async facts() {
        return {
          items: [
            {
              id: 'contribution.fixture',
              label: 'Fixture codec',
              value: { subjectId: 'fixture-codec' },
              provenance: [],
            },
          ],
        }
      },
      async relations() {
        return {
          items: [
            {
              role: 'owns',
              subjectId: 'fixture-codec',
              label: 'Fixture codec',
              kind: 'modkit/contribution',
            },
          ],
        }
      },
    }

    const english = await loadSubjectCardSections(source, { localizer: createUiLocalizer('en') })
    const russian = await loadSubjectCardSections(source, { localizer: createUiLocalizer('ru') })
    expect(
      english.filter(section => linkSection(section) && section.id === 'contributions'),
    ).toEqual([
      expect.objectContaining({
        kind: 'links',
        title: 'Contributions',
        links: [expect.objectContaining({ label: 'Fixture codec', href: 'fixture-codec' })],
      }),
    ])
    expect(
      russian.find(section => linkSection(section) && section.id === 'contributions'),
    ).toMatchObject({
      kind: 'links',
      title: 'Возможности',
    })
  })

  it('promotes a projected description into the card header', async () => {
    const source: SubjectFactsSource = {
      async summary() {
        return {
          snapshotId: 'described',
          identity: { subjectId: 'described', kind: 'entity', label: 'Described', origins: [] },
          groupCount: 1,
          relationCount: 0,
        }
      },
      async groups() {
        return { items: [{ id: 'overview', label: 'Overview', factCount: 1 }] }
      },
      async facts() {
        return {
          items: [
            { id: 'description', label: 'Description', value: 'Readable summary.', provenance: [] },
          ],
        }
      },
      async relations() {
        return { items: [] }
      },
    }

    const sections = await loadSubjectCardSections(source)
    expect(sections[0]).toMatchObject({
      kind: 'header',
      title: 'Described',
      description: 'Readable summary.',
    })
  })

  it('renders safe repository game resources as localized links', async () => {
    const source: SubjectFactsSource = {
      async summary() {
        return {
          snapshotId: 'game-profile',
          identity: {
            subjectId: 'game-profile',
            kind: 'modkit/game',
            label: 'Example Game',
            origins: [],
          },
          groupCount: 2,
          relationCount: 0,
        }
      },
      async groups() {
        return {
          items: [
            { id: 'overview', label: 'Overview', factCount: 1 },
            { id: 'resources', label: 'Resources', factCount: 1 },
          ],
        }
      },
      async facts(groupId) {
        return groupId === 'overview'
          ? {
              items: [
                {
                  id: 'description',
                  label: 'Description',
                  value: 'A repository-owned game profile.',
                  provenance: [],
                },
              ],
            }
          : {
              items: [
                {
                  id: 'resource.official-site',
                  label: 'Official site',
                  value: {
                    id: 'official-site',
                    label: 'Official site',
                    url: 'https://game.example/',
                  },
                  provenance: [],
                },
              ],
            }
      },
      async relations() {
        return { items: [] }
      },
    }

    const russian = await loadSubjectCardSections(source, { localizer: createUiLocalizer('ru') })
    expect(russian[0]).toMatchObject({
      kind: 'header',
      description: 'A repository-owned game profile.',
    })
    expect(
      russian.find(section => linkSection(section) && section.id === 'resources'),
    ).toMatchObject({
      kind: 'links',
      title: 'Ресурсы',
      links: [{ label: 'Official site', href: 'https://game.example/' }],
    })
  })
})
