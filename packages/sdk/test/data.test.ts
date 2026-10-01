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
  it('inherits tokens, the default template and owner metadata in the full result', () => {
    const schema: DataTypeSchema = {
      typeId: 'Unit',
      fields: [
        {
          fieldId: 'Config',
          cardinality: 'scalar',
          fields: [
            { fieldId: 'Inherited', cardinality: 'scalar' },
            { fieldId: 'Changed', cardinality: 'scalar' },
            { fieldId: 'Local', cardinality: 'scalar' },
          ],
        },
        {
          fieldId: 'Slots',
          cardinality: 'indexed',
          indexKey: 'index',
          fields: [
            { fieldId: 'Keep', cardinality: 'scalar' },
            { fieldId: 'Change', cardinality: 'scalar' },
          ],
        },
      ],
    }
    const ownerMetadata = { fixture: { editorCategories: ['units'] } }
    const patches: readonly DataEntityPatch[] = [
      {
        ...patch('Base', 0, {
          Config: { Inherited: 'base', Changed: 'old' },
          Slots: [{ index: 'A', value: { Keep: 1, Change: 'old' } }],
        }),
        defaultTemplate: true,
        tokens: [
          { id: 'Tone', value: 'blue' },
          { id: 'Unit', type: 'CUnitLink', value: 'Marine' },
        ],
      },
      {
        ...patch('Base', 1, { Config: { Changed: 'new' } }),
        tokens: [{ id: 'Tone', value: 'red' }],
      },
      {
        ...patch(
          'Child',
          2,
          {
            Config: { Local: 'child' },
            Slots: [{ index: 'A', value: { Change: 'child' } }],
          },
          'Base',
        ),
        defaultTemplate: false,
        tokens: [
          { id: 'Local', value: 'yes' },
          { id: 'Unit', type: 'CUnitLink', value: 'Marauder' },
        ],
      },
    ]
    const snapshot = resolveDataCatalog({
      workspaceId: 'origin-parity',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      schemas: [schema],
      patches,
      queries: [],
      ownerMetadata,
      includeWorkspaceFacets: true,
      includeFieldSources: true,
      maxEntities: 8,
      maxDepth: 8,
    })
    expect(snapshot.definitions?.find(entity => entity.entityId === 'Child')?.tokens).toEqual([
      { id: 'Local', value: 'yes' },
      { id: 'Tone', value: 'red' },
      { id: 'Unit', type: 'CUnitLink', value: 'Marauder' },
    ])
    expect(snapshot.definitions?.find(entity => entity.entityId === 'Base')?.defaultTemplate).toBe(
      true,
    )
    expect(snapshot.ownerMetadata).toEqual(ownerMetadata)
    expect(Object.isFrozen(snapshot.ownerMetadata)).toBe(true)
  })

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

  it('keeps the declaration range a source names', () => {
    const range = { utf16Offset: 10, utf16Length: 24, line: 2, column: 4 }
    const declared = patch('Marine', 0, { Life: 45 })
    const snapshot = resolveDataCatalog({
      workspaceId: 'semantic-map',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      schemas,
      patches: [{ ...declared, source: { ...declared.source, range } }],
      queries: [{ namespace: 'Unit', entityId: 'Marine' }],
      maxEntities: 16,
      maxDepth: 8,
    })
    expect(snapshot.entities[0]?.sources[0]?.range).toEqual(range)
  })

  /*
   * A child that overrides one subfield of a struct, or one attribute of an indexed slot, inherits
   * everything else — the engine's rule and MK2's `TypedCatalog`. Replacing the whole value made
   * resolved facts, relations and cards silently lose the parent's subfields.
   */
  it('merges structured scalar values and indexed slots deeply through the nested schema', () => {
    const nestedSchemas: readonly DataTypeSchema[] = [
      {
        typeId: 'Buff',
        fields: [
          {
            fieldId: 'Modification',
            cardinality: 'scalar',
            fields: [
              { fieldId: 'MoveSpeedMultiplier', cardinality: 'scalar' },
              { fieldId: 'AttackSpeedMultiplier', cardinality: 'scalar' },
              { fieldId: 'DamageDealtScaled', cardinality: 'indexed', indexKey: 'index' },
            ],
          },
          {
            fieldId: 'CmdButtonArray',
            cardinality: 'indexed',
            indexKey: 'index',
            fields: [
              { fieldId: 'DefaultButtonFace', cardinality: 'scalar' },
              { fieldId: 'Requirements', cardinality: 'scalar' },
              { fieldId: 'Flags', cardinality: 'indexed', indexKey: 'index' },
            ],
          },
        ],
      },
    ]
    const buff = (
      entityId: string,
      documentIndex: number,
      fields: DataEntityPatch['fields'],
      parentEntityId?: string,
    ): DataEntityPatch => ({
      ...patch(entityId, documentIndex, fields, parentEntityId),
      namespace: 'Buff',
      typeId: 'Buff',
    })
    const snapshot = resolveDataCatalog({
      workspaceId: 'deep-merge',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      schemas: nestedSchemas,
      patches: [
        buff('Base', 0, {
          Modification: {
            MoveSpeedMultiplier: 1.5,
            DamageDealtScaled: [{ index: 'Melee', value: 0.5 }],
          },
          CmdButtonArray: [
            {
              index: 'Execute',
              value: {
                DefaultButtonFace: 'Face',
                Requirements: 'Req',
                Flags: [{ index: 'Hidden', value: 1 }],
              },
            },
          ],
        }),
        buff(
          'Child',
          1,
          {
            Modification: {
              AttackSpeedMultiplier: 2,
              DamageDealtScaled: [{ index: 'Ranged', value: 0.25 }],
            },
            CmdButtonArray: [
              {
                index: 'Execute',
                value: { DefaultButtonFace: 'Other', Flags: [{ index: 'Queued', value: 1 }] },
              },
            ],
          },
          'Base',
        ),
      ],
      queries: [{ namespace: 'Buff', entityId: 'Child' }],
      maxEntities: 16,
      maxDepth: 8,
    })
    expect(snapshot.entities[0]?.fields).toEqual({
      Modification: {
        MoveSpeedMultiplier: 1.5,
        DamageDealtScaled: [
          { index: 'Melee', value: 0.5 },
          { index: 'Ranged', value: 0.25 },
        ],
        AttackSpeedMultiplier: 2,
      },
      CmdButtonArray: [
        {
          index: 'Execute',
          value: {
            DefaultButtonFace: 'Other',
            Requirements: 'Req',
            Flags: [
              { index: 'Hidden', value: 1 },
              { index: 'Queued', value: 1 },
            ],
          },
        },
      ],
    })
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

  it('optionally tracks the winning source of patched and inherited top-level fields', () => {
    const snapshot = resolveDataCatalog({
      workspaceId: 'field-provenance',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      schemas,
      patches: [
        patch('Infantry', 0, { Life: 40, Tags: ['biological'] }),
        patch('Infantry', 1, { Tags: ['armored'] }),
        patch('Marine', 2, { Abilities: [{ slot: '0', value: 'move' }] }, 'Infantry'),
        patch('Marine', 3, { Abilities: [{ slot: '0', value: 'attack' }] }),
      ],
      queries: [{ namespace: 'Unit', entityId: 'Marine' }],
      includeWorkspaceFacets: true,
      includeFieldSources: true,
      maxEntities: 16,
      maxDepth: 8,
    })

    expect(snapshot.entities[0]?.fieldSources).toEqual({
      Life: expect.objectContaining({ documentIndex: 0 }),
      Tags: expect.objectContaining({ documentIndex: 1 }),
      Abilities: expect.objectContaining({ documentIndex: 3 }),
    })
    expect(Object.isFrozen(snapshot.entities[0]?.fieldSources)).toBe(true)
  })

  it('keeps exact numeric and named selectors in indexed typed-link relation paths', () => {
    const source = { rootId: 'workspace', path: 'UnitData.xml', documentIndex: 0 }
    const snapshot = resolveDataCatalog({
      workspaceId: 'indexed-relations',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      schemas: [
        { typeId: 'Weapon', fields: [] },
        {
          typeId: 'Unit',
          fields: [
            {
              fieldId: 'WeaponArray',
              cardinality: 'indexed',
              indexKey: 'index',
              fields: [
                {
                  fieldId: 'Link',
                  cardinality: 'scalar',
                  type: { kind: 'subject-ref', subjectKind: 'fixture/weapon' },
                  linkNamespace: 'Weapon',
                },
              ],
            },
          ],
        },
      ],
      patches: [
        {
          namespace: 'Unit',
          typeId: 'Unit',
          entityId: 'Marine',
          fields: {
            WeaponArray: [
              { index: '0', value: { Link: 'Rifle' } },
              { index: 'Secondary', value: { Link: 'Laser' } },
            ],
          },
          source,
        },
        { namespace: 'Weapon', typeId: 'Weapon', entityId: 'Rifle', fields: {}, source },
        { namespace: 'Weapon', typeId: 'Weapon', entityId: 'Laser', fields: {}, source },
      ],
      queries: [],
      includeWorkspaceFacets: true,
      maxEntities: 8,
      maxDepth: 8,
    })
    expect(snapshot.relations?.map(relation => relation.role)).toEqual([
      'WeaponArray.0.Link',
      'WeaponArray.Secondary.Link',
    ])
  })
})
