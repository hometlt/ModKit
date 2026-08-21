import { describe, expect, it } from 'vitest'
import { resolveDataCatalog, type DataEntityPatch, type DataTypeSchema } from '@modkitx-x3/sdk/data'

const schemas: readonly DataTypeSchema[] = [
  { typeId: 'Base', fields: [] },
  {
    typeId: 'Unit',
    parentTypeId: 'Base',
    fields: [
      { fieldId: 'Life', cardinality: 'scalar' },
      { fieldId: 'Tags', cardinality: 'append' },
      { fieldId: 'Abilities', cardinality: 'indexed', indexKey: 'slot' },
    ],
  },
]

function patch(
  entityId: string,
  documentIndex: number,
  fields: DataEntityPatch['fields'],
  parentEntityId?: string,
): DataEntityPatch {
  return {
    namespace: 'Unit',
    typeId: 'Unit',
    entityId,
    ...(parentEntityId === undefined ? {} : { parentEntityId }),
    fields,
    source: {
      rootId: `root-${documentIndex}`,
      path: `UnitData-${documentIndex}.xml`,
      documentIndex,
    },
  }
}

describe('game-neutral data catalog resolution', () => {
  it('merges ordered patches and resolves schema-driven parent inheritance', () => {
    const snapshot = resolveDataCatalog({
      workspaceId: 'semantic-map',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      schemas,
      patches: [
        patch('Infantry', 0, {
          Life: 40,
          Tags: ['biological'],
          Abilities: [{ slot: '0', value: 'move' }],
        }),
        patch('Infantry', 1, {
          Life: 45,
          Tags: ['armored'],
          Abilities: [{ slot: '0', value: 'attack' }],
        }),
        patch(
          'Marine',
          2,
          { Tags: ['ranged'], Abilities: [{ slot: '1', value: 'stim' }] },
          'Infantry',
        ),
      ],
      queries: [{ namespace: 'Unit', entityId: 'Marine' }],
      maxEntities: 16,
      maxDepth: 8,
    })

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      entityCount: 2,
      patchCount: 3,
      complete: true,
    })
    expect(snapshot.entities).toHaveLength(1)
    expect(snapshot.entities[0]).toMatchObject({
      namespace: 'Unit',
      typeId: 'Unit',
      entityId: 'Marine',
      parentEntityId: 'Infantry',
      fields: {
        Life: 45,
        Tags: ['biological', 'armored', 'ranged'],
        Abilities: [
          { slot: '0', value: 'attack' },
          { slot: '1', value: 'stim' },
        ],
      },
    })
    expect(snapshot.entities[0]?.inheritanceChain.map(item => item.entityId)).toEqual([
      'Infantry',
      'Marine',
    ])
    expect(snapshot.entities[0]?.sources.map(item => item.documentIndex)).toEqual([0, 1, 2])
  })

  it('reports missing and cyclic entity parents as structured incomplete evidence', () => {
    const snapshot = resolveDataCatalog({
      workspaceId: 'invalid',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      schemas,
      patches: [patch('A', 0, {}, 'B'), patch('B', 0, {}, 'A'), patch('C', 0, {}, 'Missing')],
      queries: [
        { namespace: 'Unit', entityId: 'A' },
        { namespace: 'Unit', entityId: 'C' },
      ],
      maxEntities: 16,
      maxDepth: 8,
    })

    expect(snapshot.complete).toBe(false)
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'common.data/entity-inheritance-cycle' }),
        expect.objectContaining({ code: 'common.data/entity-parent-unavailable', entityId: 'C' }),
      ]),
    )
  })
})
