import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { uvpJsonArtifactDigest, uvpMediaArtifactDigest } from './uv-canonical-form.mjs'
import { composeVerifiedReceipt, verifiedCompositionMedia, VERIFIED_MEDIA_LIMITS } from './uv-composition.mjs'
import { uvwGltfGraph, uvwGltfImageReferences } from './uvw-gltf.mjs'
import { restoreUvwProfileDocument } from './uvw-profile.mjs'
import { resolveUvpResourceUri } from './uvp-resource-paths.mjs'

const world = JSON.parse(await readFile(new URL('../world/fixtures/uvw-gltf-textured.uvw.gltf', import.meta.url), 'utf8'))
const image = new Uint8Array(await readFile(new URL('../world/fixtures/media/checker.png', import.meta.url)))

async function input() {
  const document = structuredClone(world), bytes = image.slice()
  const contents = [
    { family: 'uvw', path: 'world.uvw.gltf', hash: await uvpJsonArtifactDigest('uvw', document) },
    { family: 'media', path: 'media/checker.png', hash: await uvpMediaArtifactDigest(bytes) },
  ]
  const manifest = { id: 'sample/world', version: '1.0.0', kind: 'map', contents,
    dependencies: [], requires: { intrinsics: [], capabilities: [] } }
  return { document, bytes, manifest }
}

function compose(data, read, signal) {
  return composeVerifiedReceipt(data.manifest.id, [data.manifest], { intrinsics: [] }, [],
    read ?? (async ({ content }) => content.family === 'uvw'
      ? { digest: content.hash, document: data.document }
      : { digest: content.hash, bytes: data.bytes }), signal)
}

test('package URI resolution is document-relative, decoded once and cannot leave the package', () => {
  for (const [uri, expected] of [['../media/checker.png', 'media/checker.png'],
    ['./a..b.png', 'worlds/a..b.png'], ['../media/a%20b.png', 'media/a b.png'],
    ['../media/%D0%BC%D0%B8%D1%80.png', 'media/мир.png'], ['../media/%63hecker.png', 'media/checker.png']])
    assert.equal(resolveUvpResourceUri('worlds/main.gltf', uri), expected)
  for (const uri of ['../../a.png', '../%2e%2e/a.png', '../../worlds/a.png', '/a.png', '//host/a.png',
    'https://host/a.png', 'data:image/png,a', 'file:///a.png', 'C:/a.png', 'a\\b.png',
    'a.png?x=1', 'a.png#x', 'a%2fb.png', '%5ca.png', '%00.png', '%253a.png', '%2',
    'a//b.png', 'a/', '.', '..', '%2e', 'a b.png', ''])
    assert.throws(() => resolveUvpResourceUri('worlds/main.gltf', uri), /resource-/)
  assert.throws(() => resolveUvpResourceUri('../world.gltf', 'image.png'), /resource-path/)
})

test('all glTF material slots share standard tables and even unused rows are checked', () => {
  assert.equal(uvwGltfGraph(world), world.extensions.UV_world_graph)
  assert.deepEqual(uvwGltfImageReferences(world, 'world.uvw.gltf'),
    [{ imageIndex: 0, path: 'media/checker.png', mimeType: 'image/png' }])
  for (const mutate of [d => { d.textures.push({ source: 99 }) },
    d => { d.textures[0].sampler = 99 }, d => { d.textures[0].source = 0.5 },
    d => { d.samplers.push({ wrapT: 0 }) }, d => { d.images.push({ uri: 'https://bad/a.png', mimeType: 'image/png' }) },
    d => { d.images[0].mimeType = 'image/x-tga' }, d => { d.images[0].bufferView = 0 },
    d => { d.images = Array(4097).fill(d.images[0]) },
    d => { d.materials[0].normalTexture.texCoord = 1 },
    d => { d.materials[0].normalTexture.extensions = { KHR_texture_transform: { texCoord: 1 } } },
    d => { d.extensionsUsed = d.extensionsUsed.filter(name => name !== 'KHR_texture_transform') },
    d => { d.extensionsUsed.push('UNKNOWN'); d.materials[0].normalTexture.extensions = { UNKNOWN: {} } },
  ]) {
    const invalid = structuredClone(world); mutate(invalid)
    assert.throws(() => uvwGltfGraph(invalid), /resource|material|envelope/)
  }
  const resourceOnly = structuredClone(world)
  delete resourceOnly.materials
  resourceOnly.extensions.UV_world_graph.spaces[0].layers = resourceOnly.extensions.UV_world_graph.spaces[0].layers.filter(l => !['water', 'terrain-materials'].includes(l.kind))
  assert.throws(() => restoreUvwProfileDocument(resourceOnly), e => e.rule === 'uvw-gltf-restore-material')
})

test('media uses raw SHA-256 and receipt bytes are isolated from input and other readers', async () => {
  const data = await input(), digest = `sha256:${createHash('sha256').update(image).digest('hex')}`
  assert.equal(data.manifest.contents[1].hash, digest)
  const result = await compose(data)
  assert.equal(result.refusal, undefined, JSON.stringify(result))
  data.bytes.fill(0)
  const first = await verifiedCompositionMedia(result.receipt)
  assert.equal(first.media.length, 1)
  assert.deepEqual(first.media[0], { packageId: data.manifest.id, path: 'media/checker.png', digest, bytes: image })
  first.media[0].bytes.fill(1)
  assert.deepEqual((await verifiedCompositionMedia(result.receipt)).media[0].bytes, image)
  assert.equal((await verifiedCompositionMedia(structuredClone(result.receipt))).refusal.rule, 'unverified-composition-receipt')
})

test('a claimed digest, missing/wrong-family media or tampered bytes cannot authorize an image', async () => {
  const cases = [
    ['world-resource-unverified', async d => { d.manifest.contents.pop() }],
    ['world-resource-unverified', async d => { d.manifest.contents[1].family = 'uvt' }],
    ['artifact-digest-mismatch', async d => { d.bytes[0] ^= 1 }],
    ['artifact-path-duplicate', async d => { d.manifest.contents.push({ ...d.manifest.contents[1], family: 'uvt' }) }],
    ['world-resource-reference', async d => { d.document.images[0].uri = '../media/checker.png'; d.manifest.contents[0].hash = await uvpJsonArtifactDigest('uvw', d.document) }],
    ['world-resource-unverified', async d => { d.document.images.push({ uri: 'media/missing.png', mimeType: 'image/png' }); d.manifest.contents[0].hash = await uvpJsonArtifactDigest('uvw', d.document) }],
    ['world-resource-mime-conflict', async d => { d.document.images.push({ uri: 'media/checker.png', mimeType: 'image/jpeg' }); d.manifest.contents[0].hash = await uvpJsonArtifactDigest('uvw', d.document) }],
  ]
  for (const [rule, mutate] of cases) {
    const data = await input(); await mutate(data)
    assert.equal((await compose(data)).refusal?.rule, rule)
  }
  const data = await input()
  const result = await compose(data, async ({ content }) => content.family === 'uvw'
    ? { digest: content.hash, document: data.document } : content.hash)
  assert.equal(result.refusal?.rule, 'world-resource-unverified')
})

test('resource hashes affect composition identity without altering world JSON identity', async () => {
  const a = await input(), b = await input()
  b.bytes[b.bytes.length - 1] ^= 1 // Byte integrity, not an image decode/format claim.
  b.manifest.contents[1].hash = await uvpMediaArtifactDigest(b.bytes)
  assert.equal(a.manifest.contents[0].hash, b.manifest.contents[0].hash)
  assert.notEqual((await compose(a)).receipt.compositionHash, (await compose(b)).receipt.compositionHash)
})

test('resource joins stay in their declaring package and accept nested documents and shared images', async () => {
  const data = await input()
  data.manifest.contents[0].path = 'worlds/main.gltf'
  data.document.images[0].uri = '../media/checker.png'
  data.document.images.push({ ...data.document.images[0] })
  data.manifest.contents[0].hash = await uvpJsonArtifactDigest('uvw', data.document)
  const result = await compose(data)
  assert.equal(result.refusal, undefined, JSON.stringify(result))
  assert.equal((await verifiedCompositionMedia(result.receipt)).media.length, 1)
  const foreign = { ...data.manifest, id: 'sample/dependency', kind: 'base', contents: [data.manifest.contents.pop()] }
  data.manifest.dependencies = [{ id: foreign.id, range: '1.0.0' }]
  const bad = await composeVerifiedReceipt(data.manifest.id, [foreign, data.manifest], { intrinsics: [] }, [],
    async ({ content }) => content.family === 'media' ? { digest: content.hash, bytes: data.bytes }
      : { digest: content.hash, document: data.document })
  assert.equal(bad.refusal?.rule, 'world-resource-unverified')
})

test('media is bounded before copying and cancellation never produces an executable receipt', async () => {
  const data = await input()
  data.bytes = new Uint8Array(VERIFIED_MEDIA_LIMITS.artifactBytes + 1)
  assert.equal((await compose(data)).refusal?.rule, 'artifact-media-budget')
  data.bytes = new Uint8Array()
  assert.equal((await compose(data)).refusal?.rule, 'artifact-media-budget')
  const controller = new AbortController()
  const cancelled = await compose(await input(), async ({ content }) => {
    controller.abort()
    return { digest: content.hash, document: world }
  }, controller.signal)
  assert.equal(cancelled.refusal?.rule, 'cancelled')
})

test('unrelated legacy digest-only media retains its identity and is not presented as verified bytes', async () => {
  const data = await input(); data.manifest.contents.shift()
  const result = await compose(data, ({ content }) => content.hash)
  assert.equal(result.refusal, undefined)
  assert.deepEqual((await verifiedCompositionMedia(result.receipt)).media, [])
})
