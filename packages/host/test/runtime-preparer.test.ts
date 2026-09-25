import { describe, expect, it } from 'vitest'
import { resolveContentRuntimePreparer } from '@modkit/host/runtime'
import type { ContentSources } from '@modkit/vfs/content-sources'

const source = (runtimePreparer?: unknown): ContentSources =>
  ({ runtimePreparer }) as unknown as ContentSources

const admitted = {
  major: 1,
  gameId: 'blizzard/starcraft-2',
  adapter: { id: 'blizzard.sc2/galaxy-runtime', version: '0.1.0' },
  async prepare() {
    return {}
  },
}

describe('source-owned Runtime preparer admission', () => {
  it('selects only the opened context game and exact major', () => {
    const selected = resolveContentRuntimePreparer(source(admitted), 'blizzard/starcraft-2')
    expect(selected.state).toBe('resolved')
    if (selected.state === 'resolved') expect(selected.preparer).toBe(admitted)
    expect(resolveContentRuntimePreparer(source(admitted), 'warzone/2100')).toMatchObject({
      state: 'unavailable',
      code: 'x3.host/runtime-preparer-invalid',
    })
    expect(
      resolveContentRuntimePreparer(source({ ...admitted, major: 2 }), 'blizzard/starcraft-2'),
    ).toMatchObject({ state: 'unavailable', code: 'x3.host/runtime-preparer-version' })
  })

  it('refuses missing, malformed and non-callable capabilities', () => {
    expect(resolveContentRuntimePreparer(source(), 'blizzard/starcraft-2')).toMatchObject({
      state: 'unavailable',
      code: 'x3.host/runtime-preparer-unavailable',
    })
    for (const candidate of [
      null,
      { ...admitted, adapter: { id: '../escape', version: '0.1.0' } },
      { ...admitted, prepare: null },
    ]) {
      expect(
        resolveContentRuntimePreparer(source(candidate), 'blizzard/starcraft-2'),
      ).toMatchObject({ state: 'unavailable', code: 'x3.host/runtime-preparer-invalid' })
    }
  })
})
