import { describe, expect, it, vi } from 'vitest'
import type { SubjectCandidateProvider } from '@modkit/sdk'
import {
  advertisesSubjectCandidates,
  selectScopedSubjectCandidates,
  SUBJECT_SELECTOR_SOURCE,
  type VsCodeScopedSubjectCandidates,
} from '../src/subject-candidates.js'

const served = (
  subjectUri: string,
  workspaceUri: string,
  subjectId: string,
  containerUri?: string,
): VsCodeScopedSubjectCandidates => {
  const provider: SubjectCandidateProvider = {
    summary: async () => ({
      snapshotId: subjectId,
      totalSubjects: 1,
      completeness: 'complete',
    }),
    candidates: async () => ({
      items: [{ subjectId, label: subjectId, kind: 'fixture' }],
    }),
  }
  return {
    uri: subjectUri,
    workspaceUri,
    ...(containerUri === undefined ? {} : { containerUri }),
    available: true,
    open: vi.fn(async () => ({ value: provider, release: async () => undefined })),
  }
}

describe('VS Code language subject candidate scope', () => {
  it('accepts only the exact advertised subject selector source contract', () => {
    expect(SUBJECT_SELECTOR_SOURCE).toEqual({
      contract: 'common.view/subject-selector-source',
      major: 1,
    })
    expect(
      advertisesSubjectCandidates({
        dataSources: [{ contract: 'common.view/subject-selector-source', major: 1 }],
      }),
    ).toBe(true)
    expect(
      advertisesSubjectCandidates({
        dataSources: [
          { contract: 'common.view/subject-selector-source', major: 2 },
          { contract: 'common.view/subject-selector', major: 1 },
        ],
      }),
    ).toBe(false)
  })

  it('never mixes two simultaneously served selector subjects in one workspace', async () => {
    const alpha = served('file:///workspace/alpha.data', 'file:///workspace', 'unit/Alpha')
    const beta = served('file:///workspace/beta.data', 'file:///workspace', 'unit/Beta')

    const ambiguous = selectScopedSubjectCandidates(
      { uri: 'file:///workspace/script.lang', workspaceUri: 'file:///workspace' },
      [alpha, beta],
    )
    expect(ambiguous).toBeUndefined()
    expect(alpha.open).not.toHaveBeenCalled()
    expect(beta.open).not.toHaveBeenCalled()

    const exact = selectScopedSubjectCandidates(
      { uri: 'file:///workspace/alpha.data', workspaceUri: 'file:///workspace' },
      [alpha, beta],
    )
    const lease = await exact?.open()
    expect(
      (
        await lease?.value.candidates({
          target: { kind: 'subject-ref', subjectKind: 'unit' },
          limit: 1,
        })
      )?.items.map(item => item.subjectId),
    ).toEqual(['unit/Alpha'])
    await lease?.release()
    expect(beta.open).not.toHaveBeenCalled()
  })

  it('maps a container document only to one selector served for that container', () => {
    const containerUri = 'file:///workspace/archive.pkg'
    const nested = served(
      'modkit-container:/archive.pkg/data.xml',
      'file:///workspace',
      'unit/Nested',
      containerUri,
    )
    const other = served('file:///workspace/other.data', 'file:///workspace', 'unit/Other')
    expect(
      selectScopedSubjectCandidates(
        {
          uri: 'modkit-container:/archive.pkg/script.lang',
          containerUri,
          workspaceUri: 'file:///workspace',
        },
        [nested, other],
      ),
    ).toBe(nested)
  })

  it('fails closed when two live subjects claim the same exact URI', () => {
    const uri = 'file:///workspace/shared.data'
    const first = served(uri, 'file:///workspace', 'unit/First')
    const second = served(uri, 'file:///workspace', 'unit/Second')

    expect(
      selectScopedSubjectCandidates({ uri, workspaceUri: 'file:///workspace' }, [first, second]),
    ).toBeUndefined()
    expect(first.open).not.toHaveBeenCalled()
    expect(second.open).not.toHaveBeenCalled()
  })
})
