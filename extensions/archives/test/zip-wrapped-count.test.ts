/** Nonconforming legacy count is admitted only by an explicit bounded reader profile. */
import { expect, it } from 'vitest'
import { readZipByRanges } from '../src/zip/codec.js'

function archive(count: number, declared = count % 65536) {
  const bytes = new Uint8Array(count * 47 + 22), view = new DataView(bytes.buffer)
  for (let i = 0; i < count; i++) {
    const at = i * 47
    view.setUint32(at, 0x02014b50, true); view.setUint16(at + 28, 1, true); bytes[at + 46] = 120
  }
  const end = count * 47
  view.setUint32(end, 0x06054b50, true)
  view.setUint16(end + 8, declared, true); view.setUint16(end + 10, declared, true)
  view.setUint32(end + 12, end, true)
  return bytes
}
function source(bytes: Uint8Array) {
  return { size: async () => BigInt(bytes.length), read: async (at: bigint, length: number) => bytes.slice(Number(at), Number(at) + length) }
}
const budget = { maxInputBytes: 8 << 20, maxNodes: 100000 }
const compatibility = { compatibility: 'legacy-wrapped-entry-count' as const }
it('strict mode refuses a wrapped count; opt-in scans and diagnoses every complete record', async () => {
  const input = source(archive(65537))
  await expect(readZipByRanges(input, budget)).rejects.toThrow(/central-directory size/)
  const result = await readZipByRanges(input, budget, undefined, compatibility)
  expect(result.entries).toHaveLength(65537)
  expect(result.diagnostics[0]?.code).toBe('x3.zip/legacy-wrapped-entry-count')
})
it('legacy mode refuses wrong modulo, incomplete directory and actual-count budget', async () => {
  await expect(readZipByRanges(source(archive(65537, 2)), budget, undefined, compatibility)).rejects.toThrow(/wrapped entry count/)
  await expect(readZipByRanges(source(archive(65537)), { ...budget, maxNodes: 65536 }, undefined, compatibility)).rejects.toThrow(/actual entry count/)
  const bytes = archive(65537); bytes[47 * 65536] = 0
  await expect(readZipByRanges(source(bytes), budget, undefined, compatibility)).rejects.toThrow(/invalid ZIP central/)
})
it('mismatched per-disk count is refused in both policies', async () => {
  const bytes = archive(1), view = new DataView(bytes.buffer); view.setUint16(bytes.length - 14, 0, true)
  await expect(readZipByRanges(source(bytes), budget, undefined, compatibility)).rejects.toThrow(/per-disk/)
  await expect(readZipByRanges(source(bytes), budget)).rejects.toThrow(/per-disk/)
})
