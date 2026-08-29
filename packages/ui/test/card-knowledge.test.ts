import { describe, expect, it } from 'vitest'
import type { KnowledgeTarget, SubjectFactsSource } from '@modkitx-x3/sdk'
import { loadSubjectCardSections } from '@modkitx-x3/ui/card'

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
})
