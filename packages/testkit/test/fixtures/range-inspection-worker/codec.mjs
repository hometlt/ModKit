// A range-mode inspection codec (CodecModule ABI v1) for the Node worker test: it runs inside the
// worker and reads a container's index and one entry through ranges of the host-side source.
import { createInspectionCodec } from '@modkit/codec-kit'

export const abiVersion = 1

export function createCodec(context) {
  return createInspectionCodec(
    {
      id: 'example/ranges',
      access: 'ranges',
      format: { id: 'example/ranges', label: 'Ranges' },
      detect: async prefix => ({
        confidence: prefix[0] === 0x52 && prefix[3] === 0x45 ? 1 : 0,
        kind: 'magic',
      }),
      async inspect(inspection) {
        const index = await inspection.byteSource.read(0n, 16)
        const view = new DataView(index.buffer, index.byteOffset, index.byteLength)
        const offset = view.getBigUint64(4, true)
        const entry = await inspection.byteSource.read(offset, view.getUint32(12, true))
        return { summary: { offset: String(offset), entry: [...entry] }, metadata: [], traits: [] }
      },
    },
    context,
  )
}
