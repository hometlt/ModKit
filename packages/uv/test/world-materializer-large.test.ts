import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  createUvwWorldSceneSource,
  materializeWorldToUvw,
  parseUvwProfile,
} from '../src/world/index.js'

// 460² terrain cells with one material weight each are ~1.06 million JSON values: past the fixed
// million-value ceiling that used to refuse every real BAR map (avalanche 513²), within the bytes.
it('writes a terrain whose material weights pass a million values, within the byte budget', async () => {
  const bytes = await readFile(
    fileURLToPath(
      new URL(
        '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json',
        import.meta.url,
      ),
    ),
  )
  const n = 460
  const world = JSON.parse(new TextDecoder().decode(bytes)) as {
    spaces: { bounds: unknown; layers: Record<string, unknown>[] }[]
  }
  const space = world.spaces[0]!
  space.bounds = { min: [0, 0, 0], max: [n - 1, 3, n - 1] }
  space.layers = space.layers.flatMap(layer => {
    if (layer.kind === 'heightfield')
      return [
        {
          ...layer,
          columns: n,
          rows: n,
          samples: Array.from({ length: n }, () => Array(n).fill(0)),
        },
      ]
    if (layer.kind === 'terrain-materials') {
      const { weightRasters: _, ...rest } = layer
      const cell = { weights: [{ materialId: 'grass', weight: 1 }] }
      return [
        {
          ...rest,
          columns: n,
          rows: n,
          samples: Array.from({ length: n }, () => Array(n).fill(cell)),
        },
      ]
    }
    return layer.kind === 'resources' ? [layer] : []
  })
  const limits = { maxNodes: 4_000_000, maxBytes: 256 * 1024 * 1024 }
  const document = parseUvwProfile(new TextEncoder().encode(JSON.stringify(world)), limits)
  const result = await materializeWorldToUvw(
    createUvwWorldSceneSource(document, { snapshotId: 'large-weights', limits }),
    {
      maxPageItems: 65_536,
      maxTerrainItems: n * n,
      maxFacetItems: 4 * n * n,
      maxOutputBytes: 64 * 1024 * 1024,
    },
  )
  expect(result.state).toBe('materialized')
}, 60_000)
