import { expect, it } from 'vitest'
import { openArchiveLayers, type LayerArchive } from '../src/content-sources.js'
const layer = (id: string, close: () => Promise<void>): LayerArchive => ({
  id,
  close,
  entries: [],
  read: async () => new Uint8Array(),
})

it('preserves native layer precedence', async () => {
  const opened = await openArchiveLayers(
    ['pak1', 'pak0', 'loose'].map(id => async () => layer(id, async () => {})),
  )
  expect(opened.map(value => value.id)).toEqual(['pak1', 'pak0', 'loose'])
})

it('closes every acquired layer even when cleanup fails and retains the original open error', async () => {
  const closed: string[] = []
  const cause = new Error('invalid next archive')
  await expect(
    openArchiveLayers([
      async () =>
        layer('a', async () => {
          closed.push('a')
          throw new Error('close error')
        }),
      async () =>
        layer('b', async () => {
          closed.push('b')
        }),
      async () => {
        throw cause
      },
    ]),
  ).rejects.toBe(cause)
  expect(closed.sort()).toEqual(['a', 'b'])
})

it('closes a layer acquired while cancellation was arriving', async () => {
  const controller = new AbortController()
  let closed = false
  await expect(
    openArchiveLayers(
      [
        async () => {
          controller.abort()
          return layer('a', async () => {
            closed = true
          })
        },
      ],
      controller.signal,
    ),
  ).rejects.toThrow(/abort/iu)
  expect(closed).toBe(true)
})
