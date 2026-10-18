/** Full Tiger V1 bytes, independently executed pinned RustCrypto oracle; no ERA truncation here.
 * Boundary inputs: byte[i]=(i*73+19)%256. Source pin/provenance accompanies the implementation.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { tiger192, createTiger192 } from '../dist/checksum/index.js'
import { TIGER_TABLES } from '../dist/checksum/tiger-tables.js'

const vectors = [
  {
    digest: '3293ac630c13f0245f92bbb1766e16167a4e58492dde73f3',
    tiger2: '4441be75f6018773c206c22745374b924aa8313fef919f41',
    length: 0,
  },
  {
    digest: '2019a26122205b65c0c6ee26560f13ecb714242a222bee5e',
    tiger2: 'f253f9091cd5f65db0a288f0bef65693a2e1e83d081597b3',
    length: 1,
  },
  {
    digest: '4f4ef0e2653acccbfffaea6b7ec04a985953c66b9fbd8f13',
    tiger2: 'bb91ecf4a4ffcc9614adc8a4c318c6f5ba8de75dd130cd51',
    length: 1024,
  },
  {
    digest: '6caa99973d6200410d8592ec62e22288627ecbc0e1bfe1e0',
    tiger2: 'f7325877b9e70a4b5c4fb4147210025d03b799cc4296c287',
    length: 127,
  },
  {
    digest: 'c327a1d7c4aa8c60da26e27d645b16cd44bd1a31023418bf',
    tiger2: '0facf38ce74377e5db57fb9c092212dfbf568151fcc2deda',
    length: 128,
  },
  {
    digest: '8153f7141eb3cb88dc457e5a2cbf3884de765dfb3c1d6370',
    tiger2: 'a1d58244f755b0cab9720579e2ac55967c4d950107a54a17',
    length: 129,
  },
  {
    digest: '4d9b198b17477730b8b1a4d288489102c2d88ce12444bae6',
    tiger2: '26ed8bcfaddbdaac4a12f673ae17d97ddd107dd8b7f570b3',
    length: 3,
  },
  {
    digest: '21ddaaf6081e897efeb9471533326068209db3e09c7e3bbe',
    tiger2: '2eba833788b09c75a47c3564948a4099cbb9f60ba2f4fd86',
    length: 4097,
  },
  {
    digest: '0ca45afeac32bdd0501f6624592293753b6670c2e4aeba6e',
    tiger2: 'a622dd6b2ff2edb622a43923c9a349eb41b466fc2033bc26',
    length: 55,
  },
  {
    digest: '16a80f3223072e4d52a84b78e23030f39651154bddc91eca',
    tiger2: 'f5a909c1d612f74701b1701eafa1e4e90436c72e01b751aa',
    length: 56,
  },
  {
    digest: 'cc5bd6be8fa4aa2f7dee7d276a29ca3bae204952d8865717',
    tiger2: '6e66760820c1347f7710c80e77fb88f36032adb1ad298210',
    length: 63,
  },
  {
    digest: 'ea2fffdbeeafcc20ae0734f55a8b1bf0ec6e98adfbebcd6c',
    tiger2: '44cb69aeddfad8b442a998d646284e6a148098176482a254',
    length: 64,
  },
  {
    digest: 'e8cf17442d8b363fb8ac7f2b1625f053971e3d3203f65074',
    tiger2: 'd1ebaab58da5cc783070994942d2d4b7b717725ae6f706d6',
    length: 65,
  },
  {
    digest: '710f3a193532296735643667a4223148b506061603d44471',
    tiger2: 'b536e94076593fb32ff534ed700aa5ee7838f063ce778ba9',
    length: 65536,
  },
  {
    digest: '77befbef2e7ef8ab2ec8f93bf587a7fc613e247f5f247809',
    tiger2: '67e6ae8e9e968999f70a23e72aeaa9251cbc7c78a7916636',
    text: 'a',
  },
  {
    digest: '2aab1484e8c158f2bfb8c5ff41b57a525129131c957b5f93',
    tiger2: 'f68d7bc5af4b43a06e048d7829560d4a9415658bb0b1f3bf',
    text: 'abc',
  },
  {
    digest: 'f71c8583902afb879edfe610f82c0d4786a3a534504486b5',
    tiger2: '159b380ab79294e0da19f16282ce6dce0f84d34f729dbea3',
    text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-',
  },
]
const pattern = length => Uint8Array.from({ length }, (_, index) => (index * 73 + 19) & 255)
const input = vector =>
  vector.text === undefined ? pattern(vector.length) : new TextEncoder().encode(vector.text)
const hex = bytes => Buffer.from(bytes).toString('hex')

test('Tiger V1 matches full external 192-bit vectors and respects sliced input views', () => {
  for (const vector of vectors) {
    const bytes = input(vector)
    const storage = new Uint8Array(bytes.length + 19).fill(0xed)
    storage.set(bytes, 7)
    const before = storage.slice()
    assert.equal(hex(tiger192(storage.subarray(7, 7 + bytes.length))), vector.digest)
    assert.deepEqual(storage, before, 'hashing must not mutate its input')
    assert.notEqual(vector.digest, vector.tiger2, 'V1 uses 0x01 padding, not Tiger2 0x80')
  }
})

test('incremental fixed and seeded partitions preserve the external block-boundary vectors', () => {
  for (const vector of vectors) {
    const bytes = input(vector)
    for (const stride of [1, 2, 3, 7, 8, 31, 55, 56, 63, 64, 65, 127, 1024]) {
      const hasher = createTiger192()
      for (let offset = 0; offset < bytes.length; offset += stride)
        hasher.update(bytes.subarray(offset, Math.min(bytes.length, offset + stride)))
      assert.equal(hex(hasher.digest()), vector.digest, `${bytes.length}:${stride}`)
    }
    const hasher = createTiger192()
    let seed = 0x12345678
    for (let offset = 0; offset < bytes.length;) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const end = Math.min(bytes.length, offset + 1 + (seed % 129))
      hasher.update(bytes.subarray(offset, end))
      offset = end
    }
    assert.equal(hex(hasher.digest()), vector.digest, 'seeded chunk partition')
  }
})

test('digest snapshots own their bytes, do not finalize, and retained input tails are copied', () => {
  const vector = vectors.find(item => item.length === 129)
  assert.ok(vector)
  const bytes = input(vector)
  const original = bytes.slice()
  const hasher = createTiger192()
  hasher.update(bytes.subarray(0, 55))
  const snapshot = hasher.digest()
  const repeated = hasher.digest()
  assert.notStrictEqual(snapshot, repeated)
  assert.deepEqual(snapshot, repeated)
  assert.equal(hex(snapshot), hex(tiger192(original.subarray(0, 55))))
  snapshot.fill(0)
  bytes.fill(255, 0, 55)
  assert.deepEqual(hasher.digest(), repeated)
  hasher.update(new Uint8Array())
  hasher.update(original.subarray(55))
  assert.equal(hex(hasher.digest()), vector.digest)
  const all = createTiger192()
  all.update(original)
  original.fill(0) // full blocks consumed synchronously; the last partial block must be owned.
  assert.equal(hex(all.digest()), vector.digest)
})

test('private frozen S-box words reproduce the exact upstream tables.bin byte fingerprint', () => {
  assert.equal(TIGER_TABLES.length, 1024)
  assert.ok(Object.isFrozen(TIGER_TABLES))
  const raw = new Uint8Array(8192)
  const view = new DataView(raw.buffer)
  TIGER_TABLES.forEach((word, index) => view.setBigUint64(index * 8, word, true))
  assert.equal(
    createHash('sha256').update(raw).digest('hex'),
    '364d73427379144b709fb0565ba1536c2c32ef9b02ab6201b1aefc30857372ea',
  )
})
