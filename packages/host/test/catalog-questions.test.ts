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

  it('asks the same context for localized strings, a bounded batch of keys at a time', async () => {
    const questions: { kind: string; keys: readonly string[]; locales?: readonly string[] }[] = []
    let opened = 0
    const contentSources = {
      async openModContext() {
        opened += 1
        return {
          query: async (question: (typeof questions)[number]) => {
            questions.push(question)
            return {
              strings: question.keys.map(key => ({
                key,
                requestedLocale: question.locales?.[0] ?? 'enUS',
                resolvedLocale: 'enUS',
                value: key.toUpperCase(),
                source: { rootId: 'liberty', path: 'enUS.SC2Data/LocalizedData/GameStrings.txt' },
                fallback: question.locales !== undefined,
              })),
            }
          },
          dispose: async () => undefined,
        }
      },
    } as unknown as ContentSources
    const catalog = subjectCatalogEntities(
      { contentSources: async () => contentSources },
      async () => 'file:///C:/Mods/Probe.SC2Mod',
    )
    const keys = Array.from({ length: 1500 }, (_, index) => `Button/Name/B${index}`)
    const answered = await catalog.strings(keys, ['ruRU'])
    expect(answered).toHaveLength(1500)
    expect(answered[0]).toMatchObject({
      key: 'Button/Name/B0',
      value: 'BUTTON/NAME/B0',
      fallback: true,
    })
    expect(
      questions.map(question => [question.kind, question.keys.length, question.locales]),
    ).toEqual([
      ['data.strings', 1024, ['ruRU']],
      ['data.strings', 476, ['ruRU']],
    ])
    await catalog.entities([{ namespace: 'Unit', entityId: 'Marine' }]).catch(() => undefined)
    expect(opened).toBe(1)
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
