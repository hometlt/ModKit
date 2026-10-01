import { describe, expect, it } from 'vitest'
import type { AssetSession } from '@modkit/sdk'
import { withMapPreviewSources } from '../src/maps/index.js'

// a map codec with its own archive source and trait, and the preview built around it
function session(name: string, descriptor: object, disposed: string[]): AssetSession {
  return {
    revision: `rev-${name}`,
    state: () => 'open',
    descriptor: async () => descriptor,
    dataSource: async (contract: string) => ({
      value: `${name}:${contract}`,
      release: async () => {},
    }),
    operations: () => `${name} operations`,
    events: () => `${name} events`,
    dispose: async () => void disposed.push(name),
  } as unknown as AssetSession
}
const trait = (id: string, extra: object = {}) => ({
  id,
  descriptorVersion: 1,
  state: 'available',
  ...extra,
})

describe('withMapPreviewSources', () => {
  it('adds what only the preview has: data sources, traits and the diagnostics they cite', async () => {
    const disposed: string[] = []
    const codec = session(
      'codec',
      {
        traits: [trait('content.archive')],
        dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
        diagnostics: [{ id: 'codec-1', message: 'own' }],
      },
      disposed,
    )
    const preview = session(
      'preview',
      {
        traits: [
          trait('content.archive'),
          trait('model.geometry', { state: 'partial', diagnosticIds: ['preview-1'] }),
        ],
        dataSources: [
          { contract: 'common.view/namespace-entry-source', major: 1 },
          { contract: 'common.view/world-scene-source', major: 1 },
        ],
        diagnostics: [
          { id: 'preview-1', message: 'models are placeholders' },
          { id: 'preview-2', message: 'not cited' },
        ],
      },
      disposed,
    )
    const merged = withMapPreviewSources(codec, preview)
    const descriptor = (await merged.descriptor()) as unknown as {
      traits: { id: string }[]
      dataSources: { contract: string }[]
      diagnostics: { id: string }[]
    }
    expect(descriptor.traits.map(item => item.id)).toEqual(['content.archive', 'model.geometry'])
    expect(descriptor.dataSources.map(item => item.contract)).toEqual([
      'common.view/namespace-entry-source',
      'common.view/world-scene-source',
    ])
    expect(descriptor.diagnostics.map(item => item.id)).toEqual(['codec-1', 'preview-1'])
    // each source comes from the session that publishes it; operations stay the codec's
    expect((await merged.dataSource('common.view/world-scene-source', 1)).value).toBe(
      'preview:common.view/world-scene-source',
    )
    expect((await merged.dataSource('common.view/namespace-entry-source', 1)).value).toBe(
      'codec:common.view/namespace-entry-source',
    )
    expect(merged.operations()).toBe('codec operations')
    await merged.dispose()
    expect(disposed).toEqual(['preview'])
  })
})
