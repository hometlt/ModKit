import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkit/core'
import { createUvwWorldSceneSource, parseUvwProfile, materializeWorldToUvpMap, openUvpMapBundle } from '../src/world/index.js'
const options = { packageId: 'test/artifact-identity', packageVersion: '1.0.0', maxPageItems: 64, maxTerrainItems: 64,
  maxFacetItems: 128, maxOutputBytes: 128_000, maxTextureBytes: 128, maxMediaBytes: 128 }
async function pack(title?: string) {
  const bytes = await readFile(new URL('../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-single-space.uvw.json', import.meta.url))
  const result = await materializeWorldToUvpMap(createUvwWorldSceneSource(parseUvwProfile(bytes), { snapshotId: 'identity-fixture' }),
    { ...options, ...(title === undefined ? {} : { title }) })
  if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
  return result
}
it('writes the normative UVW logical identity rather than a digest of JSON formatting bytes', async () => {
  const packed = await pack()
  const manifest = JSON.parse(new TextDecoder().decode(packed.entries.get('uvp.manifest.json')!))
  const entry = manifest.contents.find((entry: { family: string }) => entry.family === 'uvw')
  // Independent normative oracle over the published fixture after the existing source route
  // omits its nonsemantic root comment; the serializer itself has published JCS vectors.
  expect(entry.hash).toBe('sha256:975afc9f951d54b6bef0ec944e65894334424fcc4068daec6b645fc6be7aac4f')
  expect(entry.hash).not.toBe(`sha256:${createHash('sha256').update(packed.entries.get(entry.path)!).digest('hex')}`)
})
it('keeps logical identity across formatting and property order, and reopens/repackages without identity drift', async () => {
  const packed = await pack(), entries = new Map([...packed.entries].map(([path, bytes]) => [path, bytes.slice()]))
  const world = JSON.parse(new TextDecoder().decode(entries.get('world/main.uvw.json')!))
  const reordered = { connections: world.connections, spaces: world.spaces, uv: world.uv, ...(world.$comment === undefined ? {} : { $comment: world.$comment }) }
  entries.set('world/main.uvw.json', new TextEncoder().encode(JSON.stringify(reordered, null, 4)))
  const opened = await openUvpMapBundle(entries, { snapshotId: 'reordered-artifact' })
  const again = await materializeWorldToUvpMap(opened.source, options)
  if (again.state !== 'materialized') throw new Error(JSON.stringify(again.refusals))
  expect(again.entries.get('uvp.manifest.json')).toEqual(packed.entries.get('uvp.manifest.json'))
})
it('refuses changed world semantics, old raw-only identities and duplicate-key JSON rather than hiding them during parse', async () => {
  const packed = await pack()
  const bytes = packed.entries.get('world/main.uvw.json')!
  const world = JSON.parse(new TextDecoder().decode(bytes))
  world.spaces[0].layers[0].samples[0][0] += 1
  const corrupt = new Map(packed.entries); corrupt.set('world/main.uvw.json', new TextEncoder().encode(JSON.stringify(world)))
  await expect(openUvpMapBundle(corrupt, { snapshotId: 'corrupt-world' })).rejects.toThrow('hash mismatch')
  const duplicate = new Map(packed.entries)
  const text = new TextDecoder().decode(bytes)
  duplicate.set('world/main.uvw.json', new TextEncoder().encode(text.replace('"version": "1.0"', '"version":"wrong", "version":"1.0"')))
  await expect(openUvpMapBundle(duplicate, { snapshotId: 'duplicate-world' })).rejects.toThrow('not valid JSON')
  const manifestBytes = packed.entries.get('uvp.manifest.json')!, manifestText = new TextDecoder().decode(manifestBytes)
  const repeated = new Map(packed.entries)
  repeated.set('uvp.manifest.json', new TextEncoder().encode(manifestText.replace('"kind": "map"', '"kind":"wrong", "kind":"map"')))
  await expect(openUvpMapBundle(repeated, { snapshotId: 'duplicate-manifest' })).rejects.toThrow('not valid UTF-8 JSON')
  const manifest = JSON.parse(manifestText)
  manifest.contents.find((entry: { family: string }) => entry.family === 'uvw').hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const legacy = new Map(packed.entries); legacy.set('uvp.manifest.json', new TextEncoder().encode(canonicalJsonStringify(manifest)))
  await expect(openUvpMapBundle(legacy, { snapshotId: 'raw-only-old-export' })).rejects.toThrow('logical artifact hash mismatch')
  await expect(pack('\ud800')).rejects.toThrow('manifest is not valid UTF-8 JSON')
})
