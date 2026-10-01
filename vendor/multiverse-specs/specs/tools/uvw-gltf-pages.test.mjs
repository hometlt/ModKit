import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { packUvwExactPage } from './uvw-exact-page.ts'
import { materializeUvwGltfPages, uvwGltfPagedArtifactDigest,
  uvwGltfPagedBufferReferences } from './uvw-gltf-pages.mjs'
import { uvpJsonArtifactDigest } from './uv-canonical-form.mjs'
import { uvpMediaArtifactDigest } from './uv-canonical-form.mjs'
import { composeVerifiedReceipt, verifiedCompositionDocuments,
  verifiedCompositionWorldSpaces } from './uv-composition.mjs'
import { packGlb, packCanonicalGlb, unpackStrictGlb } from './gltf-container.mjs'

const fixture = JSON.parse(await readFile(new URL('../world/fixtures/uvw-gltf-spatial.uvw.gltf', import.meta.url)))
const flatten = grid => grid.flat()

function pagedWorld() {
  const document = structuredClone(fixture)
  document.asset.extras.uv.profile = 'space-graph-paged'
  document.buffers = [{ uri: '../media/world.bin', byteLength: 0 },
    { uri: '../media/unused.bin', byteLength: 3 }]
  document.bufferViews = []
  const chunks = []
  let offset = 0
  for (const [layerIndex, field, encoding] of [[0, 'samples', 'f64-le'],
    [1, 'walkable', 'bool-lsb0'], [1, 'exits', 'u8']]) {
    const layer = document.extensions.UV_world_graph.spaces[0].layers[layerIndex]
    const values = flatten(layer[field])
    const packed = packUvwExactPage(encoding, values)
    offset = Math.ceil(offset / 8) * 8
    const bufferView = document.bufferViews.push({ buffer: 0, byteOffset: offset,
      byteLength: packed.bytes.length }) - 1
    chunks.push({ offset, bytes: packed.bytes })
    offset += packed.bytes.length
    layer[field] = { count: values.length, pages: [{ start: 0, bufferView,
      descriptor: packed.descriptor }] }
  }
  document.buffers[0].byteLength = offset
  const bytes = new Uint8Array(offset)
  for (const chunk of chunks) bytes.set(chunk.bytes, chunk.offset)
  return { document, buffers: [bytes, Uint8Array.of(7, 8, 9)] }
}

test('distinct paged profile reconstructs exact geometry through the existing verifier', async () => {
  const { document, buffers } = pagedWorld()
  const original = structuredClone(document)
  assert.deepEqual(materializeUvwGltfPages(document, buffers), fixture)
  assert.deepEqual(document, original)
  assert.deepEqual(uvwGltfPagedBufferReferences(document, 'world/map.uvw.gltf'), [
    { index: 0, path: 'media/world.bin', byteLength: buffers[0].length },
    { index: 1, path: 'media/unused.bin', byteLength: 3 },
  ])
  await assert.rejects(uvpJsonArtifactDigest('uvw', document), /uvw-gltf-envelope/)
  const digest = await uvwGltfPagedArtifactDigest(document, buffers)
  assert.match(digest, /^sha256:[0-9a-f]{64}$/)
  const different = buffers.map(bytes => Uint8Array.from(bytes))
  different[1][0] ^= 1
  assert.notEqual(await uvwGltfPagedArtifactDigest(document, different), digest)
  different[1] = Uint8Array.from(buffers[1])
  different[0][0] ^= 1
  assert.notEqual(await uvwGltfPagedArtifactDigest(document, different), digest)
})

test('paged admission refuses missing bytes, aliasing, noncanonical pages and padding', () => {
  const { document, buffers } = pagedWorld()
  for (const [caseIndex, mutation] of [
    (d, b) => { b[0] = b[0].subarray(1) },
    d => { d.bufferViews[1].byteOffset = d.bufferViews[0].byteOffset },
    d => { d.bufferViews[1].byteOffset++ },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].samples.pages[0].descriptor.encoding = 'u32-le' },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].samples.count++ },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].samples.pages[0].start = 1 },
    d => { d.extensions.UV_world_graph.spaces[0].layers[1].exits.pages[0].bufferView = 1 },
    d => { d.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: 1 }) },
    (d, b) => { b[0][d.bufferViews[1].byteOffset + d.bufferViews[1].byteLength] = 1 },
  ].entries()) {
    const invalid = structuredClone(document), witnesses = buffers.map(bytes => Uint8Array.from(bytes))
    mutation(invalid, witnesses)
    assert.throws(() => materializeUvwGltfPages(invalid, witnesses),
      /uvw-pages|uvw-exact-page/, `Case ${caseIndex} must refuse`)
  }
})

test('UVP composition closes every paged buffer and exposes the same checked world geometry', async () => {
  const { document, buffers } = pagedWorld()
  const worldHash = await uvwGltfPagedArtifactDigest(document, buffers)
  const root = { id: 'sample/pages', version: '1.0.0', kind: 'map', dependencies: [],
    requires: { intrinsics: [], capabilities: [] }, contents: [
      { family: 'uvw', path: 'world/map.uvw.gltf', hash: worldHash },
      { family: 'media', path: 'media/world.bin', hash: await uvpMediaArtifactDigest(buffers[0]) },
      { family: 'media', path: 'media/unused.bin', hash: await uvpMediaArtifactDigest(buffers[1]) },
    ] }
  const read = async ({ content }) => content.family === 'uvw'
    ? { digest: content.hash, document }
    : { digest: content.hash, bytes: buffers[content.path === 'media/world.bin' ? 0 : 1] }
  const result = await composeVerifiedReceipt(root.id, [root], { intrinsics: [] }, [], read)
  assert.equal(result.refusal, undefined)
  assert.deepEqual((await verifiedCompositionDocuments(result.receipt)).documents[0].document, fixture)
  const world = await verifiedCompositionWorldSpaces(result.receipt)
  assert.equal(world.spaces[0].space.layers[0].samples[0][0], 1 + 2 ** -32)
  const absent = structuredClone(root)
  absent.contents.pop()
  assert.equal((await composeVerifiedReceipt(absent.id, [absent], { intrinsics: [] }, [], read))
    .refusal?.rule, 'world-page-unverified')
  const altered = structuredClone(root)
  altered.contents[0].hash = await uvpJsonArtifactDigest('uvw', fixture)
  assert.equal((await composeVerifiedReceipt(altered.id, [altered], { intrinsics: [] }, [], read))
    .refusal?.rule, 'artifact-digest-mismatch')
})

test('shared strict GLB container admits the same paged geometry and rejects ambiguous bytes', async () => {
  const { document, buffers } = pagedWorld()
  delete document.buffers[0].uri
  document.buffers.pop()
  const bytes = packCanonicalGlb(document, buffers[0])
  assert.deepEqual(packCanonicalGlb(document, buffers[0]), bytes)
  const parsed = unpackStrictGlb(bytes)
  assert.deepEqual(parsed.document, document)
  assert.deepEqual(parsed.binary, buffers[0])
  assert.throws(() => unpackStrictGlb(packGlb(document, buffers[0])), /glb-container/)
  const hash = await uvwGltfPagedArtifactDigest(document, [buffers[0]])
  const root = { id: 'sample/glb', version: '1.0.0', kind: 'map', dependencies: [],
    requires: { intrinsics: [], capabilities: [] }, contents: [
      { family: 'uvw', path: 'world.uvw.glb', hash },
    ] }
  const read = async ({ content }) => ({ digest: content.hash, bytes })
  const result = await composeVerifiedReceipt(root.id, [root], { intrinsics: [] }, [], read)
  assert.equal(result.refusal, undefined)
  assert.deepEqual((await verifiedCompositionDocuments(result.receipt)).documents[0].document, fixture)
  for (const mutate of [
    b => { b[0] = 0 },
    b => { b[8] = 0 },
    b => { b[16] = 0 },
    b => { b[b.length - 1] = 1 },
  ]) {
    const invalid = bytes.slice(); mutate(invalid)
    assert.throws(() => unpackStrictGlb(invalid), /glb-container/)
  }
  const appendChunk = (type, payload = new Uint8Array(4)) => {
    const extra = new Uint8Array(bytes.length + 8 + payload.length)
    extra.set(bytes)
    const view = new DataView(extra.buffer)
    view.setUint32(8, extra.length, true)
    view.setUint32(bytes.length, payload.length, true)
    view.setUint32(bytes.length + 4, type, true)
    extra.set(payload, bytes.length + 8)
    return extra
  }
  for (const type of [0x004e4942, 0x4e4f534a, 0x12345678])
    assert.throws(() => unpackStrictGlb(appendChunk(type)), /glb-container/)
  const wrongLength = structuredClone(document)
  wrongLength.buffers[0].byteLength--
  assert.throws(() => unpackStrictGlb(packCanonicalGlb(wrongLength, buffers[0])), /glb-container/)
  const changed = bytes.slice(); changed[changed.length - 1] ^= 1
  assert.equal((await composeVerifiedReceipt(root.id, [root], { intrinsics: [] }, [],
    async ({ content }) => ({ digest: content.hash, bytes: changed }))).refusal?.rule,
  'world-glb-invalid')
})
