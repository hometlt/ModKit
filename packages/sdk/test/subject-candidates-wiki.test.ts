import { describe, expect, it } from 'vitest'
import {
  loadSubjectCandidatePage,
  type SubjectCandidateProvider,
} from '../src/subjects/candidates.js'

const query = { target: { kind: 'subject-ref', subjectKind: 'unit' }, limit: 10 } as const

function provider(
  kinds: readonly { kind: string; count: number }[],
  portrait: string,
): SubjectCandidateProvider {
  return {
    summary: async () => ({
      snapshotId: 'wiki',
      totalSubjects: 1,
      completeness: 'complete',
      kinds,
    }),
    candidates: async () => ({
      items: [{ subjectId: 'unit/Marine', label: 'Marine', kind: 'unit', portrait }],
    }),
  }
}

describe('subject selector for a wiki', () => {
  it('carries the kinds with their counts and a portrait per candidate', async () => {
    const page = await loadSubjectCandidatePage(
      provider([{ kind: 'unit', count: 1 }], 'Assets\Textures\btn-unit-terran-marine.dds'),
      query,
    )
    expect(page.summary.kinds).toEqual([{ kind: 'unit', count: 1 }])
    expect(page.page.items[0]?.portrait).toBe('Assets\Textures\btn-unit-terran-marine.dds')
  })

  it('refuses a malformed count or an empty portrait at the shared seam', async () => {
    await expect(
      loadSubjectCandidatePage(provider([{ kind: 'unit', count: -1 }], 'a.dds'), query),
    ).rejects.toThrow(/summary is malformed/u)
    await expect(
      loadSubjectCandidatePage(provider([{ kind: 'unit', count: 1 }], ''), query),
    ).rejects.toThrow(TypeError)
  })
})
