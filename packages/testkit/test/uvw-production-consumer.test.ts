import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  canonicalizeUvwProfile,
  createUvwWorldSceneSource,
  materializeWorldToUvw,
  parseUvwProfile,
} from '@modkit/uv/world'

describe('testkit consumes the production UVW API', () => {
  it('reopens and independently rematerializes the renderable world fixture', async () => {
    const path = join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'vendor',
      'multiverse-specs',
      'specs',
      'world',
      'fixtures',
      'uvw-profile-renderable-world.uvw.json',
    )
    const document = parseUvwProfile(new Uint8Array(await readFile(path)))
    const source = createUvwWorldSceneSource(document, {
      snapshotId: 'testkit-production-consumer',
      mapId: 'renderable-world.uvw',
      maxPageSize: 2,
    })
    const result = await materializeWorldToUvw(source, {
      maxPageItems: 2,
      maxTerrainItems: 16,
      maxFacetItems: 128,
      maxOutputBytes: 1_000_000,
    })
    expect(result.state).toBe('materialized')
    if (result.state !== 'materialized') return

    expect(parseUvwProfile(result.bytes)).toEqual(canonicalizeUvwProfile(document))
    expect(result.excludedFacetIds).toEqual([])
    expect(result.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })
})
