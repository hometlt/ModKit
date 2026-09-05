import { describe, expect, it } from 'vitest'
import { resolveDataCatalog, type DataEntityPatch, type DataTypeSchema } from '@modkit/sdk/data'

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

  it('keeps extended definitions, typed links and winner-first locale provenance additive', () => {
    const linkedSchemas: readonly DataTypeSchema[] = [
      { typeId: 'Weapon', fields: [] },
      {
        typeId: 'Unit',
        fields: [
          {
            fieldId: 'Weapon',
            cardinality: 'scalar',
            type: { kind: 'subject-ref', subjectKind: 'fixture/weapon' },
            linkNamespace: 'Weapon',
          },
          {
            fieldId: 'Name',
            cardinality: 'scalar',
            type: { kind: 'text-key', catalog: 'GameStrings' },
            linkNamespace: '',
          },
        ],
      },
    ]
    const source = (rootId: string, documentIndex: number) => ({
      rootId,
      path: `${rootId}/unit.xml`,
      documentIndex,
    })
    const snapshot = resolveDataCatalog({
      workspaceId: 'overlay',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      schemas: linkedSchemas,
      patches: [
        {
          namespace: 'Unit',
          typeId: 'Unit',
          entityId: 'Marine',
          fields: { Weapon: 'Rifle', Name: 'Unit/Name/Marine' },
          source: source('core', 0),
        },
        {
          namespace: 'Weapon',
          typeId: 'Weapon',
          entityId: 'Rifle',
          fields: {},
          source: source('liberty', 1),
        },
        {
          namespace: 'Unit',
          typeId: 'Unit',
          entityId: 'Marine',
          fields: { Weapon: 'Missing' },
          source: source('workspace', 2),
        },
      ],
      localizationPatches: [
        {
          locale: 'enUS',
          key: 'Unit/Name/Marine',
          value: 'Workspace Marine',
          source: source('workspace', 0),
        },
        {
          locale: 'enUS',
          key: 'Unit/Name/Marine',
          value: 'Core Marine',
          source: source('core', 1),
        },
      ],
      localePreferences: ['frFR', 'enUS'],
      localizationKeys: ['Unit/Name/Marine', 'Unit/Name/Missing'],
      queries: [{ namespace: 'Unit', entityId: 'Marine' }],
      snapshotId: 'revision:actual-content',
      includeWorkspaceFacets: true,
      maxEntities: 16,
      maxDepth: 8,
    })

    expect(snapshot.definitions).toHaveLength(2)
    expect(snapshot.relations).toEqual([
      expect.objectContaining({
        from: { namespace: 'Unit', entityId: 'Marine' },
        to: { namespace: 'Weapon', entityId: 'Missing' },
        role: 'Weapon',
        dead: true,
      }),
    ])
    expect(snapshot.localizedStrings).toEqual([
      expect.objectContaining({
        key: 'Unit/Name/Marine',
        value: 'Workspace Marine',
        requestedLocale: 'frFR',
        resolvedLocale: 'enUS',
        fallback: true,
        source: expect.objectContaining({ rootId: 'workspace' }),
      }),
    ])
    expect(snapshot.snapshotId).toBe('revision:actual-content')
    expect(snapshot.schemas?.[1]?.fields.map(field => field.type)).toEqual([
      { kind: 'subject-ref', subjectKind: 'fixture/weapon' },
      { kind: 'text-key', catalog: 'GameStrings' },
    ])
    expect(Object.isFrozen(snapshot.schemas?.[1]?.fields[0]?.type)).toBe(true)
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'common.data/relation-target-unavailable' }),
        expect.objectContaining({ code: 'common.data/localization-fallback' }),
        expect.objectContaining({ code: 'common.data/localization-key-unavailable' }),
      ]),
    )

    const legacy = resolveDataCatalog({
      workspaceId: 'legacy',
      gameId: 'example/game',
      analyzerId: 'old-v1-provider',
      schemas: linkedSchemas,
      patches: [],
      queries: [],
      maxEntities: 1,
      maxDepth: 1,
    })
    expect(Object.keys(legacy).sort()).toEqual([
      'analyzerId',
      'complete',
      'diagnostics',
      'entities',
      'entityCount',
      'gameId',
      'namespaces',
      'patchCount',
      'schemaVersion',
      'typeIds',
      'workspaceId',
    ])
  })
})
