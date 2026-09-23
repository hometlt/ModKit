import { describe, expect, it, vi } from 'vitest'
import type { DataCatalogSnapshot, DataEntityRef, DataResolvedEntity } from '@modkit/sdk'
import { analyzeWithCatalogEntities } from '../src/maps/index.js'

const entity = (namespace: string, entityId: string, fields: Record<string, string> = {}) =>
  ({ namespace, entityId, fields }) as unknown as DataResolvedEntity

/** The catalog the host never sends: a unit, its actor, the actor's model, and one unrelated unit. */
const held = new Map(
  [
    entity('Unit', 'Marine'),
    entity('Actor', 'Marine', { Model: 'MarineModel' }),
    entity('Model', 'MarineModel'),
    entity('Unit', 'Zergling'),
  ].map(item => [`${item.namespace}/${item.entityId}`, item]),
)

/** A map placing a Marine: it names the unit and actor, then whatever model the actor names. */
function mapAnalyzer() {
  const catalogs: (DataCatalogSnapshot | undefined)[] = []
  const analyze = vi.fn(async (catalog: DataCatalogSnapshot | undefined) => {
    catalogs.push(catalog)
    const queries: DataEntityRef[] = [
      { namespace: 'Unit', entityId: 'Marine' },
      { namespace: 'Actor', entityId: 'Marine' },
    ]
    const actor = catalog?.entities.find(item => item.namespace === 'Actor')
    const model = (actor?.fields as Record<string, string> | undefined)?.['Model']
    if (model !== undefined) queries.push({ namespace: 'Model', entityId: model })
    return { semantic: { catalogQueries: queries } }
  })
  return { analyze, catalogs }
}

describe('map analysis with catalog entities', () => {
  it('asks only for what the map names, until it names nothing new', async () => {
    const map = mapAnalyzer()
    const asked: string[][] = []
    const catalogEntities = vi.fn(async (refs: readonly DataEntityRef[]) => {
      asked.push(refs.map(ref => `${ref.namespace}/${ref.entityId}`))
      return refs.flatMap(ref => held.get(`${ref.namespace}/${ref.entityId}`) ?? [])
    })
    await analyzeWithCatalogEntities({
      workspace: { workspaceId: 'w', gameId: 'g' },
      analyze: map.analyze,
      catalogEntities,
    })
    expect(asked).toEqual([['Unit/Marine', 'Actor/Marine'], ['Model/MarineModel']])
    // three analyses: without a catalog, with the unit and actor, with the model as well
    expect(map.catalogs.map(catalog => catalog?.entities.map(item => item.entityId))).toEqual([
      undefined,
      ['Marine', 'Marine'],
      ['Marine', 'Marine', 'MarineModel'],
    ])
    expect(map.catalogs[1]).toMatchObject({ schemaVersion: 1, workspaceId: 'w', gameId: 'g' })
  })

  it('stops after a bounded number of rounds when every answer names something new', async () => {
    let next = 0
    const analyze = vi.fn(async () => ({
      semantic: { catalogQueries: [{ namespace: 'Unit', entityId: `U${next++}` }] },
    }))
    await analyzeWithCatalogEntities({
      workspace: { workspaceId: 'w', gameId: 'g' },
      analyze,
      catalogEntities: async () => [],
    })
    expect(analyze.mock.calls.length).toBeLessThanOrEqual(7)
  })
})
