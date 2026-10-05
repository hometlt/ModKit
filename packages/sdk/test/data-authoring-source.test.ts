import { describe, expect, it } from 'vitest'
import {
  dataAuthoringSource,
  type ResolvedDataAuthoringIndexV1,
  type ResolvedDataAuthoringIndexV2,
} from '@modkit/sdk/data'

describe('canonical authoring declaration sources', () => {
  const document = {
    rootId: 'mod',
    path: 'GameData/UnitData.xml',
    documentIndex: 2,
    revision: 'v1',
  }
  const range = { utf16Offset: 100, utf16Length: 20, line: 5, column: 4 }
  const metadata = {
    kind: 'resolved-data-authoring-index' as const,
    workspaceId: 'workspace',
    gameId: 'game',
    analyzerId: 'data',
    snapshotId: 'snapshot',
    namespaces: [],
    entityCount: 0,
    patchCount: 0,
    entities: [],
    diagnostics: {
      errorCount: 0,
      warningCount: 0,
      informationCount: 0,
      items: [],
      truncated: false,
    },
    complete: true,
    valuesComplete: true,
  }
  const compact: ResolvedDataAuthoringIndexV2 = {
    ...metadata,
    schemaVersion: 2,
    sourceDocuments: [document],
    sourceTable: [[0], [0, 100, 20, 5, 4], [0, 200, 40, 9, 2]],
  }

  it('preserves document identity and each exact declaration span in both versions', () => {
    const legacy: ResolvedDataAuthoringIndexV1 = {
      ...metadata,
      schemaVersion: 1,
      sourceTable: [document, { ...document, range }],
    }
    expect(dataAuthoringSource(compact, 0)).toEqual(dataAuthoringSource(legacy, 0))
    expect(dataAuthoringSource(compact, 1)).toEqual(dataAuthoringSource(legacy, 1))
    expect(dataAuthoringSource(compact, 2)?.range).toEqual({
      utf16Offset: 200,
      utf16Length: 40,
      line: 9,
      column: 2,
    })
    expect(Object.isFrozen(dataAuthoringSource(compact, 1)?.range)).toBe(true)
  })

  it.each([-1, 0.5, Number.NaN, 3])('rejects invalid source index %s', source => {
    expect(dataAuthoringSource(compact, source)).toBeUndefined()
  })

  it('rejects missing documents, partial spans and invalid span coordinates', () => {
    for (const location of [[1], [0, 1], [0, 1, 2, -1, 0], [0, 1, 2, 0.5, 0]]) {
      const index = {
        ...compact,
        sourceTable: [location],
      } as unknown as ResolvedDataAuthoringIndexV2
      expect(dataAuthoringSource(index, 0)).toBeUndefined()
    }
  })
})
