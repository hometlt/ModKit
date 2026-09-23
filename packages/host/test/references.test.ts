import { describe, expect, it } from 'vitest'
import { type ReferenceOccurrenceBatch } from '@modkit/sdk'
import { createWorkspaceReferenceIndex } from '../src/references.js'

const target = (workspace: string) => ({
  owner: 'blizzard/sc2-data',
  kind: 'catalog-entity',
  namespace: 'unit',
  typeId: 'CUnit',
  id: 'Marine',
  workspace,
})

const batch = (
  contextId: string,
  revision: string,
  uri: string,
  precedence: number,
  role: 'declaration' | 'reference',
): ReferenceOccurrenceBatch => ({
  contextId,
  contextRevision: revision,
  semanticComplete: true,
  sourceUri: uri,
  sourceRevision: `${revision}:${uri}`,
  occurrences: [
    {
      target: target(contextId),
      source: {
        uri,
        sourceRevision: `${revision}:${uri}`,
        span: { utf16Offset: 1, utf16Length: 6, line: 0, column: 1 },
        origin: {
          uri,
          layerId: `${contextId}:${precedence}`,
          logicalId: 'GameData/UnitData.xml',
          precedence,
          sourceRevision: `${revision}:${uri}`,
          readOnly: precedence === 0,
        },
      },
      semanticPath: ['unit', 'Marine'],
      role,
      form: 'literal',
      provenance: 'test/sc2-data',
      ...(role === 'declaration'
        ? {
            subject: {
              workspace: contextId,
              source: { id: uri },
              identity: { kind: 'blizzard/sc2-data-entity', key: 'unit/Marine' },
            },
          }
        : {}),
    },
  ],
})

describe('workspace typed reference index', () => {
  it('keeps occurrences, selects the strongest declaration and reports shadowing', () => {
    const index = createWorkspaceReferenceIndex()
    index.replace(batch('workspace-a', 'r1', 'content://base/unit.xml', 0, 'declaration'))
    index.replace(batch('workspace-a', 'r1', 'file:///mod/unit.xml', 2, 'declaration'))
    index.replace(batch('workspace-a', 'r1', 'file:///mod/strings.txt', 2, 'reference'))
    expect(index.occurrences(target('workspace-a'))).toHaveLength(3)
    expect(index.resolveIndexed(target('workspace-a'))).toMatchObject({
      state: 'resolved',
      declaration: { source: { uri: 'file:///mod/unit.xml' }, effective: true },
      shadowedDeclarations: [{ source: { uri: 'content://base/unit.xml' } }],
    })
  })

  it('replaces a document and never mixes contexts or revisions', () => {
    const index = createWorkspaceReferenceIndex()
    index.replace(batch('workspace-a', 'r1', 'file:///a.xml', 1, 'reference'))
    index.replace({
      ...batch('workspace-a', 'r1', 'file:///a.xml', 1, 'reference'),
      occurrences: [],
    })
    expect(index.snapshot()).toMatchObject({ documents: 1, targets: 0, occurrences: 0 })
    index.replace(batch('workspace-b', 'r1', 'file:///b.xml', 1, 'reference'))
    expect(index.occurrences(target('workspace-a'))).toHaveLength(0)
    expect(index.snapshot()).toMatchObject({ contextId: 'workspace-b', documents: 1 })
    index.replace(batch('workspace-b', 'r2', 'file:///c.xml', 1, 'reference'))
    expect(index.occurrencesIn('file:///b.xml')).toHaveLength(0)
  })

  it('recomputes completeness when a bounded document batch is replaced', () => {
    const index = createWorkspaceReferenceIndex()
    index.replace({
      ...batch('workspace-a', 'r1', 'file:///a.xml', 1, 'reference'),
      semanticComplete: false,
    })
    expect(index.resolveIndexed(target('workspace-a'))).toMatchObject({ state: 'incomplete' })
    index.replace(batch('workspace-a', 'r1', 'file:///a.xml', 1, 'reference'))
    expect(index.resolveIndexed(target('workspace-a'))).toMatchObject({ state: 'missing' })
  })

  it('rejects stale asynchronous resolutions after a context change', async () => {
    const index = createWorkspaceReferenceIndex()
    index.replace(batch('workspace-a', 'r1', 'file:///a.xml', 1, 'reference'))
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const pending = index.resolve(target('workspace-a'), {
      owner: 'blizzard/sc2-data',
      async resolve(value) {
        await gate
        return { state: 'missing', target: value }
      },
    })
    index.replace(batch('workspace-a', 'r2', 'file:///a.xml', 1, 'reference'))
    release()
    await expect(pending).resolves.toMatchObject({ state: 'incomplete' })
  })
})
