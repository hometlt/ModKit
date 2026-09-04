import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadMk2, codingRoot, sha256, digestManifest } from './load-mk2.mjs'
import * as crypto from '../../modkit-core/packages/codec-kit/dist/crypto/index.js'
import * as compression from '../../modkit-core/packages/codec-kit/dist/compression/index.js'
import * as texture from '../../modkit-core/packages/codec-kit/dist/texture/index.js'
const root = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle')
const fixture = [[], [0], [1, 2, 3, 4, 5, 6, 7], Array.from({ length: 4096 }, (_, index) => (index * 31) & 255)]
const corpusManifest = { kind: 'deterministic-p9-fixtures', sha256: sha256(JSON.stringify(fixture)), strings: ['', 'abc', 'Привет 🙂', '(hash table)', '(block table)'] }
const evidence = [], checks = []
async function load(entry) {
  const result = await loadMk2(entry, { operation: 'M1-P9-parity', operationOptions: { version: 1 }, corpusManifest, loaderFiles: [fileURLToPath(import.meta.url)] })
  evidence.push(result.evidence)
  return result.module
}
const legacySha = await load('extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/sha1.ts')
const legacyCrypto = await load('packages/archives-processing/src/lib/crypto/index.ts')
const legacyCompression = await load('packages/archives-processing/src/lib/compression/index.ts')
const legacyTexture = await load('packages/image-processing/src/core/gpu-texture.ts')
for (const input of corpusManifest.strings) {
  assert.equal(crypto.sha1Hex(input), legacySha.sha1Hex(input)); checks.push('sha1')
  for (const key of [0, 1, 2, 3]) { assert.equal(crypto.mpqHash(input, key), legacyCrypto.mpqHash(input, key)); checks.push('mpqHash') }
}
for (const input of fixture.map(value => Uint8Array.from(value))) {
  assert.equal(crypto.crc32(input), legacyCrypto.crc32(input)); checks.push('crc32')
  for (const key of [0, 0x12345678, 0xffffffff]) {
    const encrypted = crypto.mpqEncrypt(input, key)
    assert.deepEqual(encrypted, legacyCrypto.mpqEncrypt(input, key))
    assert.deepEqual(crypto.mpqDecrypt(encrypted, key), legacyCrypto.mpqDecrypt(encrypted, key))
    assert.deepEqual(crypto.mpqDecrypt(encrypted, key), input); checks.push('mpq-crypt')
  }
  const compressed = await compression.deflate(input)
  assert.deepEqual(compressed, await legacyCompression.deflate(input))
  assert.deepEqual(await compression.inflate(compressed), await legacyCompression.inflate(compressed)); checks.push('deflate-inflate')
}
for (const [width, height] of [[1, 1], [4, 4], [5, 9], [128, 64]]) {
  const data = Uint8Array.from({ length: width * height * 4 }, (_, index) => index & 255)
  assert.deepEqual(texture.bgraToRgba(data, width, height), legacyTexture.bgraToRgba(data, width, height)); checks.push('bgra')
  assert.deepEqual(texture.wrapDx10Dds(width, height, 71, data), legacyTexture.wrapDx10Dds(width, height, 71, data)); checks.push('dds-wrapper')
}
const publicFiles = ['crypto/index.ts', 'compression/index.ts', 'compression/bzip2.ts', 'texture/index.ts']
const authored = []
for (const file of publicFiles) authored.push({ path: `packages/codec-kit/src/${file}`, sha256: sha256(await readFile(path.join(codingRoot, 'modkit-core/packages/codec-kit/src', file))) })
await writeFile(path.join(root, 'p9-parity.receipt.json'), JSON.stringify({ schemaVersion: 1, verdict: 'pass', checks: checks.length, counts: Object.fromEntries([...new Set(checks)].map(name => [name, checks.filter(item => item === name).length])), corpusManifest, corpusDigest: digestManifest(corpusManifest), authored, evidence, exclusions: ['bzip2 adapter is new bounded functionality, validated by real fixtures; not legacy stub parity', 'ADPCM unavailable, not an implemented claim'] }, null, 2) + '\n')
console.log(`P9 pinned parity: ${checks.length} nonempty comparisons pass across SHA1, MPQ hash/crypt, CRC, deflate/inflate and texture transforms`)
