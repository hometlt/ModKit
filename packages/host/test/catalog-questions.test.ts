import { describe, expect, it } from 'vitest'
import type { DataResolvedEntity } from '@modkit/sdk'
import type { ContentSources, ModContextRequest } from '@modkit/vfs/content-sources'
import { operationCatalogQueries, subjectCatalogEntities } from '../src/catalog-questions.js'

const entity = (namespace: string, entityId: string) =>
  ({ namespace, entityId, fields: {}, complete: true }) as unknown as DataResolvedEntity

/** Sources whose loader answers `data.entities` for whatever is asked, and records its life. */
function sources() {
  const requests: ModContextRequest[] = []
  let disposed = 0
  const contentSources = {
    async openModContext(request: ModContextRequest) {
      requests.push(request)
      return {
        query: async (question: { refs: readonly { namespace: string; entityId: string }[] }) => ({
          entities: question.refs.map(ref => entity(ref.namespace, ref.entityId)),
        }),
        dispose: async () => {
          disposed += 1
        },
      }
    },
  } as unknown as ContentSources
  return { contentSources, requests, disposed: () => disposed }
}

describe('subject catalog questions', () => {
  it('opens the subject mod context on the first question, once, and releases it', async () => {
    const fixture = sources()
    const catalog = subjectCatalogEntities(
      { contentSources: async () => fixture.contentSources, baseMods: () => ['Mods/Liberty.SC2Mod'] },
      async () => 'file:///C:/Replays/Game.SC2Replay',
    )
    expect(fixture.requests).toEqual([])
    const answered = await catalog.entities([{ namespace: 'Unit', entityId: 'Marine' }])
    await catalog.entities([{ namespace: 'Unit', entityId: 'Zergling' }])
    expect(answered.map(item => item.entityId)).toEqual(['Marine'])
    expect(fixture.requests).toEqual([
      { schemaVersion: 1, target: 'C:/Replays/Game.SC2Replay', baseMods: ['Mods/Liberty.SC2Mod'] },
    ])
    await catalog.release()
    expect(fixture.disposed()).toBe(1)
  })

  it('answers nothing for a subject the sources cannot place, and never opens a context', async () => {
    const fixture = sources()
    const catalog = subjectCatalogEntities(
      { contentSources: async () => fixture.contentSources },
      async () => 'untitled:Scratch',
    )
    expect(await catalog.entities([{ namespace: 'Unit', entityId: 'Marine' }])).toEqual([])
    expect(fixture.requests).toEqual([])
    await catalog.release()
  })

  it('reads the questions only from a JSON result that names them', () => {
    const ok = (value: unknown) =>
      ({ state: 'ok', output: { kind: 'json', value }, diagnostics: [] }) as never
    expect(
      operationCatalogQueries(
        ok({ catalogQueries: [{ namespace: 'Unit', entityId: 'Marine' }, { namespace: '', entityId: 'x' }, 3] }),
      ),
    ).toEqual([{ namespace: 'Unit', entityId: 'Marine' }])
    expect(operationCatalogQueries(ok({ other: true }))).toEqual([])
    expect(
      operationCatalogQueries({ state: 'rejected', reason: 'permission-missing', diagnostics: [] } as never),
    ).toEqual([])
  })
})
