/** U4: the existing world source and UVP package retain terrain image-channel semantics. */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  createUvwWorldSceneSource, materializeWorldToUvpMap, materializeWorldToUvw,
  openUvpMapBundle, parseUvwProfile, serializeUvwProfile, validateUvwProfile,
  type UvwProfileDocument,
} from '../src/world/index.js'

/** Existing canonical fixture stripped to its terrain: no models or incidental texture lookup. */
async function input(normalEncoding?: string, specularEncoding?: string) {
  const document = JSON.parse(await readFile(new URL(
    '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json',
    import.meta.url), 'utf8'))
  const space = document.spaces[0]
  space.layers = space.layers.filter((layer: { kind: string }) =>
    layer.kind === 'heightfield' || layer.kind === 'terrain-materials')
  const materialLayer = space.layers.find((layer: { kind: string }) => layer.kind === 'terrain-materials')
  delete materialLayer.weightRasters
  materialLayer.materials = [{ id: 'grass',
    ...(normalEncoding === undefined ? {} : { normalEncoding }),
    ...(specularEncoding === undefined ? {} : { specularEncoding }),
  }]
  return document
}

describe('UVW terrain image channel conventions', () => {
  it.each([
    ['rgb', 'color'], ['rgb-inverted-y', 'gloss'], ['xy-in-alpha-green', 'color'],
  ])('retains %s/%s through source, reconstruction and detached UVP', async (normalEncoding, specularEncoding) => {
    const document = parseUvwProfile(serializeUvwProfile(await input(normalEncoding, specularEncoding)))
    const source = createUvwWorldSceneSource(document, { snapshotId: 'encoding-source' })
    const catalog = await source.page({ facet: 'layers', limit: 16 })
    const layer = catalog.items.find(item => item.facet === 'layers' && item.kind === 'terrain-materials')
    expect(layer?.facet === 'layers' ? layer.materials?.[0] : undefined)
      .toMatchObject({ normalEncoding, specularEncoding })
    const options = { maxPageItems: 32, maxTerrainItems: 1000, maxFacetItems: 1000,
      maxOutputBytes: 1024 * 1024 }
    const reconstructed = await materializeWorldToUvw(source, options)
    if (reconstructed.state !== 'materialized') throw new Error(JSON.stringify(reconstructed.refusals))
    expect(reconstructed.lostFields.some(field => /(?:normal|specular)Encoding$/.test(field.path))).toBe(false)
    const packed = await materializeWorldToUvpMap(source, {
      ...options, packageId: 'test/terrain-encodings', packageVersion: '1.0.0', title: 'Terrain encodings',
      maxTextureBytes: 1024, maxMediaBytes: 1024,
    })
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const reopened = await openUvpMapBundle(
      new Map([...packed.entries].map(([name, bytes]) => [name, Uint8Array.from(bytes)])),
      { snapshotId: 'detached-encoding-source' },
    )
    const materials = reopened.document.spaces[0]!.layers.find(item => item.kind === 'terrain-materials')
    if (materials?.kind !== 'terrain-materials') throw new Error('missing materials')
    expect(materials.materials[0]).toEqual({ id: 'grass', normalEncoding, specularEncoding })
  })

  it('keeps omitted defaults omitted and rejects unknown channel encodings', async () => {
    const admitted = validateUvwProfile(await input())
    const layer = admitted.spaces[0]!.layers.find(item => item.kind === 'terrain-materials')
    if (layer?.kind !== 'terrain-materials') throw new Error('missing materials')
    expect(layer.materials[0]).toEqual({ id: 'grass' })
    for (const normal of ['RGB', '', 'xyz', 1, null])
      expect(() => validateUvwProfile({ ...admitted, spaces: admitted.spaces.map(space => ({ ...space,
        layers: space.layers.map(item => item.kind !== 'terrain-materials' ? item : { ...item,
          materials: [{ id: 'grass', normalEncoding: normal }] }),
      })) } as unknown as UvwProfileDocument)).toThrow()
    expect(() => validateUvwProfile({ ...admitted, spaces: admitted.spaces.map(space => ({ ...space,
      layers: space.layers.map(item => item.kind !== 'terrain-materials' ? item : { ...item,
        materials: [{ id: 'grass', specularEncoding: 'roughness' }] }),
    })) } as unknown as UvwProfileDocument)).toThrow()
  })
})
