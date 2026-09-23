import { describe, expect, it } from 'vitest'
import {
  resolveDataAuthoringIndex,
  resolveDataCatalog,
  type DataEntityPatch,
  type DataTypeSchema,
} from '@modkit/sdk/data'

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
  it('builds bounded parent deltas with defaults, sources and indexed tombstones', () => {
    const source = (documentIndex: number) => ({
      rootId: `root-${documentIndex}`,
      path: `UnitData-${documentIndex}.xml`,
      documentIndex,
    })
    const authoringSchemas: readonly DataTypeSchema[] = [
      {
        typeId: 'Unit',
        fields: [
          { fieldId: 'Life', cardinality: 'scalar' },
          { fieldId: 'Abilities', cardinality: 'indexed', indexKey: 'index' },
          {
            fieldId: 'Cost',
            cardinality: 'scalar',
            fields: [
              { fieldId: 'Link', cardinality: 'scalar' },
              { fieldId: 'Time', cardinality: 'scalar' },
            ],
          },
        ],
      },
    ]
    const index = resolveDataAuthoringIndex({
      workspaceId: 'authoring',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      snapshotId: 'authoring:1',
      schemas: authoringSchemas,
      patches: [
        {
          namespace: 'Unit',
          typeId: 'Unit',
          entityId: 'Base',
          fields: {
            Life: 40,
            Abilities: [{ index: 'Move', value: 1 }],
            Cost: { Time: 5 },
          },
          source: source(0),
        },
        {
          namespace: 'Unit',
          typeId: 'Unit',
          entityId: 'Child',
          parentEntityId: 'Base',
          fields: { Abilities: [{ index: 'Move', value: 0, removed: true }] },
          source: source(1),
        },
      ],
      basePatches: [
        {
          namespace: 'Unit',
          typeId: 'Unit',
          entityId: 'Child',
          fields: { Cost: { Link: 'Unit/Child' } },
          source: source(2),
        },
      ],
      maxEntities: 8,
      maxDepth: 8,
      maxOutputBytes: 1_048_576,
    })
    const child = index.entities.find(entity => entity.entityId === 'Child')
    expect(child).toMatchObject({
      identity: 'Unit\0Child',
      parentEntityId: 'Base',
      source: 1,
      complete: true,
    })
    expect(child?.fields).toEqual([
      expect.objectContaining({ fieldId: 'Abilities', value: [], originEntityId: 'Child' }),
      expect.objectContaining({
        fieldId: 'Cost',
        value: { Link: 'Unit/Child', Time: 5 },
        originEntityId: 'Base',
        origins: [
          { path: ['Link'], source: 2, originEntityId: 'Child' },
          { path: ['Time'], source: 0, originEntityId: 'Base' },
        ],
      }),
    ])
    expect(child?.fields?.some(field => field.fieldId === 'Life')).toBe(false)
    expect(child?.tombstones).toEqual([{ path: ['Abilities', 'Move'], source: 1 }])
    expect(index.sourceTable).toHaveLength(3)
    expect(index.valuesComplete).toBe(true)
  })

  it('tracks leaf origins and inherited tokens consistently across compact and full results', () => {
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
    const index = resolveDataAuthoringIndex({
      workspaceId: 'origin-parity',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      snapshotId: 'origin-parity:1',
      schemas: [schema],
      patches,
      ownerMetadata,
      maxEntities: 8,
      maxDepth: 8,
      maxOutputBytes: 1_048_576,
    })
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
    const child = index.entities.find(entity => entity.entityId === 'Child')
    const config = child?.fields?.find(field => field.fieldId === 'Config')
    const slots = child?.fields?.find(field => field.fieldId === 'Slots')
    expect(config?.origins).toEqual([
      { path: ['Changed'], source: 1, originEntityId: 'Base' },
      { path: ['Inherited'], source: 0, originEntityId: 'Base' },
      { path: ['Local'], source: 2, originEntityId: 'Child' },
    ])
    expect(slots?.origins).toEqual([
      { path: ['A', 'Change'], source: 2, originEntityId: 'Child' },
      { path: ['A', 'Keep'], source: 0, originEntityId: 'Base' },
    ])
    expect(child?.tokens).toEqual([
      { id: 'Local', value: 'yes' },
      { id: 'Tone', value: 'red' },
      { id: 'Unit', type: 'CUnitLink', value: 'Marauder' },
    ])
    expect(child?.defaultTemplate).toBeUndefined()
    expect(index.entities.find(entity => entity.entityId === 'Base')?.defaultTemplate).toBe(true)
    expect(snapshot.definitions?.find(entity => entity.entityId === 'Child')?.tokens).toEqual(
      child?.tokens,
    )
    expect(snapshot.definitions?.find(entity => entity.entityId === 'Base')?.defaultTemplate).toBe(
      true,
    )
    expect(index.ownerMetadata).toEqual(ownerMetadata)
    expect(snapshot.ownerMetadata).toEqual(ownerMetadata)
    expect(Object.isFrozen(index.ownerMetadata)).toBe(true)
    expect(Object.isFrozen(snapshot.ownerMetadata)).toBe(true)
  })

  it('drops all values on overflow while preserving every identity and winning source', () => {
    const index = resolveDataAuthoringIndex({
      workspaceId: 'bounded-authoring',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      snapshotId: 'bounded:1',
      schemas: [{ typeId: 'Unit', fields: [{ fieldId: 'Blob', cardinality: 'scalar' }] }],
      patches: [patch('Large', 0, { Blob: 'x'.repeat(10_000) })],
      maxEntities: 2,
      maxDepth: 2,
      maxOutputBytes: 2_048,
    })
    expect(index.valuesComplete).toBe(false)
    expect(index.entities).toEqual([
      expect.objectContaining({ identity: 'Unit\0Large', source: 0 }),
    ])
    expect(index.entities[0]).not.toHaveProperty('fields')
    expect(index.sourceTable).toEqual([
      expect.objectContaining({ rootId: 'root-0', path: 'UnitData-0.xml' }),
    ])
    expect(new TextEncoder().encode(JSON.stringify(index)).byteLength).toBeLessThanOrEqual(2_048)
  })

  it('bounds diagnostic evidence while retaining exact severity totals', () => {
    const index = resolveDataAuthoringIndex({
      workspaceId: 'diagnostic-authoring',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      snapshotId: 'diagnostics:1',
      schemas: [{ typeId: 'Unit', fields: [] }],
      patches: [patch('Marine', 0, {})],
      diagnostics: Array.from({ length: 80 }, (_, item) => ({
        severity: item % 2 === 0 ? ('warning' as const) : ('information' as const),
        code: `example/${'c'.repeat(300)}`,
        message: `diagnostic\0${'m'.repeat(3_000)}`,
      })),
      maxEntities: 2,
      maxDepth: 2,
      maxOutputBytes: 1_048_576,
    })
    expect(index.diagnostics).toMatchObject({
      errorCount: 0,
      warningCount: 40,
      informationCount: 40,
      truncated: true,
    })
    expect(index.diagnostics.items).toHaveLength(64)
    expect(index.diagnostics.items[0]?.code).toHaveLength(256)
    expect(index.diagnostics.items[0]?.message).toHaveLength(2_048)
    expect(index.diagnostics.items[0]?.message).not.toContain('\0')
  })

  it('keeps a many-entity identity/source index inside a fixed transfer budget', () => {
    const entityCount = 5_000
    const index = resolveDataAuthoringIndex({
      workspaceId: 'scale-authoring',
      gameId: 'example/game',
      analyzerId: 'example/analyzer',
      snapshotId: 'scale:1',
      schemas: [{ typeId: 'Unit', fields: [{ fieldId: 'Blob', cardinality: 'scalar' }] }],
      patches: Array.from({ length: entityCount }, (_, entity) =>
        patch(`Unit${entity}`, 0, { Blob: 'x'.repeat(2_048) }),
      ),
      maxEntities: entityCount,
      maxDepth: 8,
      maxOutputBytes: 4 * 1_024 * 1_024,
    })
    expect(index.entityCount).toBe(entityCount)
    expect(index.entities).toHaveLength(entityCount)
    expect(index.sourceTable).toHaveLength(1)
    expect(index.valuesComplete).toBe(false)
    expect(new TextEncoder().encode(JSON.stringify(index)).byteLength).toBeLessThanOrEqual(
      4 * 1_024 * 1_024,
    )
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
