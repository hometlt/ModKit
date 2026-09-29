import { describe, expect, it } from 'vitest'
import type { ResolvedDataWorkspaceSnapshot } from '@modkit/sdk/data'
import { createSnapshotDataWorkspace } from '../src/index.js'

const source = { rootId: 'game', path: 'rules.ini', documentIndex: 0 }
const snapshot = (id: string) =>
  ({
    snapshotId: id,
    schemas: [
      {
        typeId: 'Infantry',
        fields: [
          { fieldId: 'Strength', cardinality: 'one' },
          { fieldId: 'Primary', cardinality: 'one', linkNamespace: 'Weapon' },
        ],
      },
    ],
    definitions: [
      {
        namespace: 'Infantry',
        entityId: 'E1',
        fields: { Strength: '125', Primary: 'M60' },
        fieldSources: { Strength: source },
        complete: true,
      },
    ],
    relations: [
      {
        from: { namespace: 'Infantry', entityId: 'E1' },
        to: { namespace: 'Weapon', entityId: 'M60' },
        role: 'Primary',
        dead: true,
      },
    ],
    localizedStrings: [
      {
        key: 'Name:E1',
        requestedLocale: 'en',
        resolvedLocale: 'en',
        value: 'GI',
        source,
        fallback: false,
      },
    ],
  }) as unknown as ResolvedDataWorkspaceSnapshot

describe('a resolved-data provider over snapshots', () => {
  it('publishes schema, definitions, strings and relations of an analyzed snapshot', async () => {
    let analyzed = 0
    const workspace = createSnapshotDataWorkspace({
      providerId: 'example.data',
      gameIds: ['example/game'],
      label: 'Example data',
      plan: async () => ({}) as never,
      analyze: async () => snapshot(`s${String((analyzed += 1))}`),
      relations: { completeness: 'partial', reason: 'groups are not entities' },
      maxSnapshots: 1,
      extend: snapshotOf => ({
        openSubjectFacts: async request => {
          snapshotOf({ snapshotId: request.snapshotId, maxPageSize: 1 })
          return { value: {} as never, release: async () => undefined }
        },
      }),
    })
    const { snapshotId } = await workspace.analyze({} as never)
    const open = { snapshotId, maxPageSize: 100 }

    const tree = (await workspace.openSchemaTree(open)).value
    const [type] = (await tree.children(await tree.root(), { limit: 10 })).items
    const fields = await tree.children(type!, { limit: 10 })
    expect(
      await Promise.all(fields.items.map(async item => (await tree.facts(item)).preview)),
    ).toEqual(['one', '→ Weapon'])

    const table = (await workspace.openDefinitionTable(open)).value
    expect((await table.shape()).header).toEqual(['namespace', 'id', 'Primary', 'Strength'])

    const strings = (await workspace.openLocalizationTable(open)).value
    expect((await strings.rows({ kind: 'range', from: 0, count: 10 })).items[0]?.cells).toEqual([
      'Name:E1',
      'GI',
      'en',
      'game',
      'rules.ini',
    ])

    const graph = (await workspace.openRelations(open)).value
    const summary = await graph.summary()
    expect(summary).toMatchObject({ completeness: 'partial', reason: 'groups are not entities' })
    expect((await graph.nodes({ limit: 10 })).items.map(node => node.type).sort()).toEqual([
      'Infantry',
      'missing-Weapon',
    ])

    expect(workspace.openSubjectFacts).toBeTypeOf('function')
    // one snapshot kept: the first is gone once a second is analyzed
    await workspace.analyze({} as never)
    await expect(workspace.openDefinitionTable(open)).rejects.toThrow(/stale/u)
  })
})
