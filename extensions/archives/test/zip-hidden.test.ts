import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
// @ts-expect-error the ZIP codec is a JS module without declarations
import { createCodec } from '../src/zip/codec.js'

/** A stored-only ZIP of the given names (a trailing slash makes a folder entry). */
function buildZip(names: readonly string[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const name of names) {
    const path = encoder.encode(name)
    const data = name.endsWith('/') ? new Uint8Array() : encoder.encode(`bytes of ${name}`)
    const crc = crc32(data)
    const local = new Uint8Array(30 + path.byteLength + data.byteLength)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.byteLength, true)
    lv.setUint32(22, data.byteLength, true)
    lv.setUint16(26, path.byteLength, true)
    local.set(path, 30)
    local.set(data, 30 + path.byteLength)
    const central = new Uint8Array(46 + path.byteLength)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.byteLength, true)
    cv.setUint32(24, data.byteLength, true)
    cv.setUint16(28, path.byteLength, true)
    cv.setUint32(42, offset, true)
    central.set(path, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.byteLength
  }
  const centralSize = centrals.reduce((total, part) => total + part.byteLength, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, names.length, true)
  ev.setUint16(10, names.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const bytes = new Uint8Array(offset + centralSize + 22)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    bytes.set(part, at)
    at += part.byteLength
  }
  return bytes
}

describe('ZIP entries hidden by convention', () => {
  it('marks __MACOSX, dot names and thumbnails, and everything under a hidden folder', async () => {
    const zip = buildZip(['readme.txt', '__MACOSX/', '__MACOSX/._readme.txt', '.git/config', 'art/.DS_Store', 'art/Thumbs.db', 'art/logo.png'])
    const revision = 'provider-token:zip-hidden'
    const source = {
      kind: 'bytes',
      ref: { id: 'zip', uri: 'memory:hidden.zip' },
      revision,
      size: BigInt(zip.byteLength),
      async read(offset: bigint, length: number) {
        return zip.slice(Number(offset), Number(offset) + length)
      },
    }
    const input = {
      originKind: 'single',
      primaryBindingId: 'content',
      revisions: { topology: 'single', revision },
      bindings: [{ bindingId: 'content', role: 'content', source: source.ref, sourceKind: 'candidate', ownership: 'owned', revision }],
      async openBinding() {
        return { value: source, release: async () => undefined }
      },
    }
    const budget = { maxInputBytes: 1024n * 1024n, maxScalarBytes: 4096, maxDepth: 32, maxNodes: 1000, maxDiagnostics: 10 }
    const session = await createCodec().open(input, 'full', budget)
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const { items } = await lease.value.list('', { limit: 100 })
    const hidden = Object.fromEntries(items.map((item: { path: string; hidden?: true }) => [item.path, item.hidden === true]))
    expect(hidden).toEqual({
      'readme.txt': false,
      '__MACOSX/': true,
      '__MACOSX/._readme.txt': true,
      '.git/config': true,
      'art/.DS_Store': true,
      'art/Thumbs.db': true,
      'art/logo.png': false,
    })
    await lease.release()
    await session.operations().dispose()
  })
})
