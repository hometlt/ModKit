import { describe, expect, it } from 'vitest'
import { resolveDataCatalog, type DataEntityPatch, type DataTypeSchema } from '../src/data/index.js'

const schemas: readonly DataTypeSchema[] = [
  {
    typeId: 'Unit',
    fields: [
      { fieldId: 'Life', cardinality: 'scalar' },
      { fieldId: 'Abilities', cardinality: 'indexed', indexKey: 'slot' },
    ],
  },
]

const patch = (fields: DataEntityPatch['fields'], documentIndex = 0): DataEntityPatch => ({
  namespace: 'Unit',
  typeId: 'Unit',
  entityId: 'Marine',
  fields,
  source: { rootId: 'root', path: `UnitData-${documentIndex}.xml`, documentIndex },
})

const resolve = (patches: readonly DataEntityPatch[], patchesResolved?: boolean) =>
  resolveDataCatalog({
    workspaceId: 'resolved-patches',
    gameId: 'example/game',
    analyzerId: 'example/analyzer',
    schemas,
    patches,
    queries: [{ namespace: 'Unit', entityId: 'Marine' }],
    maxEntities: 8,
    maxDepth: 8,
    ...(patchesResolved === undefined ? {} : { patchesResolved }),
  }).entities[0]?.fields

describe('patches an engine already resolved', () => {
  it('take their fields as they are and give what merging them would', () => {
    const fields = {
      Life: 45,
      Abilities: [
        { slot: '0', value: 'attack' },
        { slot: '1', value: 'stim' },
      ],
      Unknown: 1,
    }
    // the schema still leaves out what it does not know
    expect(resolve([patch(fields)], true)).toEqual({ Life: 45, Abilities: fields.Abilities })
    expect(resolve([patch(fields)], true)).toEqual(resolve([patch(fields)]))
  })

  it('still merge a second patch of the same entity over the first', () => {
    expect(
      resolve([patch({ Life: 40 }), patch({ Abilities: [{ slot: '0', value: 'move' }] }, 1)], true),
    ).toEqual({ Life: 40, Abilities: [{ slot: '0', value: 'move' }] })
  })
})
