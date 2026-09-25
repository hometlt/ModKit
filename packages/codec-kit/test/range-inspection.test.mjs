import test from 'node:test'
import assert from 'node:assert/strict'
import { createInspectionCodec } from '../dist/index.js'

// A container far larger than any budget: 4.5 GiB, one entry past the 4 GiB mark. Nothing is
// allocated for it — every byte is computed from its offset, and every read is counted.
const GiB = 1024n ** 3n
const size = 4n * GiB + GiB / 2n + 4096n
const entryOffset = 4n * GiB + 12_345n
const entryLength = 4096
const header = new Uint8Array(16)
header.set([0x52, 0x4e, 0x47, 0x45]) // RNGE
new DataView(header.buffer).setBigUint64(4, entryOffset, true)
new DataView(header.buffer).setUint32(12, entryLength, true)
const byteAt = position =>
  position < 16n ? header[Number(position)] : Number(((position * 2_654_435_761n) >> 13n) & 0xffn)
const expected = (offset, length) =>
  Uint8Array.from({ length }, (_, index) => byteAt(offset + BigInt(index)))

const budget = {
  maxInputBytes: 1024n * 1024n,
  maxScalarBytes: 4096,
  maxDepth: 32,
  maxNodes: 1000,
  maxDiagnostics: 10,
}
const revision = 'provider-token:range-fixture'

function fixture() {
  const reads = []
  const source = {
    kind: 'bytes',
    ref: { id: 'fixture', uri: 'memory:range-fixture' },
    revision,
    size,
    async read(offset, length) {
      // like a real ArtifactByteSource: a range past the end is an error, never a short read
      if (offset < 0n || offset + BigInt(length) > size) throw new RangeError('past the source')
      reads.push({ offset, length })
      return expected(offset, length)
    },
  }
  const input = {
    originKind: 'single',
    primaryBindingId: 'content',
    revisions: { topology: 'single', revision },
    bindings: [
      {
        bindingId: 'content',
        role: 'content',
        source: source.ref,
        sourceKind: 'candidate',
        ownership: 'owned',
        revision,
      },
    ],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
  const codec = createInspectionCodec({
    id: 'example/ranges',
    access: 'ranges',
    format: { id: 'example/ranges', label: 'Ranges' },
    detect: async prefix => ({
      confidence: prefix[0] === 0x52 && prefix[3] === 0x45 ? 1 : 0,
      kind: 'magic',
    }),
    async inspect(context) {
      const index = await context.byteSource.read(0n, 16)
      const view = new DataView(index.buffer, index.byteOffset, index.byteLength)
      const offset = view.getBigUint64(4, true)
      const entry = await context.byteSource.read(offset, view.getUint32(12, true))
      return {
        summary: { offset: String(offset), entry: [...entry] },
        metadata: [],
        traits: [],
      }
    },
  })
  return { reads, open: () => codec.open(input, 'full', budget) }
}

test('a range codec opens a 4.5 GiB container by reading its header, never the file', async () => {
  const { reads, open } = fixture()
  const session = await open()
  const opened = reads.reduce((total, read) => total + read.length, 0)
  // the 64 KiB detection prefix, the 16-byte index and the entry: not the 4.5 GiB behind them
  assert.ok(opened <= 64 * 1024 + 16 + entryLength, `open read ${opened} bytes`)
  const inspected = await session.operations().invoke('inspect', null)
  assert.equal(inspected.state, 'ok')
  assert.equal(inspected.output.value.offset, String(entryOffset))
  assert.deepEqual(inspected.output.value.entry, [...expected(entryOffset, entryLength)])
  const descriptor = await session.descriptor()
  assert.ok(!descriptor.operations.some(operation => operation.id === 'export.raw'))
  assert.equal(descriptor.constraints.seekable, true)
  assert.equal(descriptor.constraints.randomAccess, true)
  assert.equal(descriptor.constraints.maxDecodedBytes, String(size))
  await session.operations().dispose()
})

test('the byte range source reads the real source by ranges and refuses what it must', async () => {
  const { reads, open } = fixture()
  const session = await open()
  const lease = await session.dataSource('common.view/byte-range-source', 1)
  const source = lease.value
  assert.equal(await source.size(), size)
  reads.length = 0
  assert.deepEqual(await source.read(entryOffset + 100n, 32), expected(entryOffset + 100n, 32))
  assert.deepEqual(reads, [{ offset: entryOffset + 100n, length: 32 }])
  // a range running past the end is cut at it, and the source is never asked past it
  assert.deepEqual(await source.read(size - 10n, 100), expected(size - 10n, 10))
  await assert.rejects(source.read(size + 1n, 1), /outside the source/)
  await assert.rejects(source.read(-1n, 1), /outside the source/)
  await assert.rejects(source.read(0n, Number(budget.maxInputBytes) + 1), /inspection budget/)
  await lease.release()
  await session.operations().dispose()
})
