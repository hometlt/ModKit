/**
 * The font codec on generated fonts: a two-glyph TrueType, the same font wrapped as WOFF, and a
 * bare WOFF2 header. The glyph sheet must reach the vector stage as a secure static SVG.
 */
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { VectorSceneSource } from '@modkit/sdk'
import { openVectorCodec } from './codec-session.js'

function table(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size)
  fill(new DataView(bytes.buffer))
  return bytes
}

/** A square glyph 100..900 on a 1000-unit em, as one simple TrueType contour. */
function squareGlyph(): Uint8Array {
  return table(10 + 2 + 2 + 4 + 16, view => {
    view.setInt16(0, 1) // contours
    view.setInt16(2, 100)
    view.setInt16(4, 100)
    view.setInt16(6, 900)
    view.setInt16(8, 900)
    view.setUint16(10, 3) // last point index
    view.setUint16(12, 0) // no instructions
    for (let index = 0; index < 4; index += 1) view.setUint8(14 + index, 1) // on-curve, long coords
    // x: 100, +800, 0, -800 ; y: 100, 0, +800, 0
    view.setInt16(18, 100)
    view.setInt16(20, 800)
    view.setInt16(22, 0)
    view.setInt16(24, -800)
    view.setInt16(26, 100)
    view.setInt16(28, 0)
    view.setInt16(30, 800)
    view.setInt16(32, 0)
  })
}

function tables(): Record<string, Uint8Array> {
  const glyph = squareGlyph()
  const glyf = new Uint8Array(glyph.byteLength + (glyph.byteLength % 2))
  glyf.set(glyph)
  const name = new TextEncoder().encode('Probe')
  const utf16 = new Uint8Array(name.length * 2)
  name.forEach((byte, index) => (utf16[index * 2 + 1] = byte))
  return {
    head: table(54, view => {
      view.setUint32(12, 0x5f0f3cf5)
      view.setUint16(18, 1000)
      view.setInt16(50, 0) // short loca
    }),
    maxp: table(6, view => {
      view.setUint32(0, 0x5000)
      view.setUint16(4, 2)
    }),
    'OS/2': table(6, view => view.setUint16(4, 700)),
    name: table(6 + 12 + utf16.length, view => {
      view.setUint16(2, 1)
      view.setUint16(4, 18)
      view.setUint16(6, 3)
      view.setUint16(8, 1)
      view.setUint16(12, 1) // family
      view.setUint16(14, utf16.length)
      new Uint8Array(view.buffer).set(utf16, 18)
    }),
    // format 4 mapping 'A' (0x41) to glyph 1, plus the required 0xFFFF segment
    cmap: table(12 + 32, view => {
      view.setUint16(2, 1)
      view.setUint16(4, 3)
      view.setUint16(6, 1)
      view.setUint32(8, 12)
      const at = 12
      view.setUint16(at, 4)
      view.setUint16(at + 2, 32)
      view.setUint16(at + 6, 4) // segCountX2
      view.setUint16(at + 14, 0x41)
      view.setUint16(at + 16, 0xffff)
      view.setUint16(at + 20, 0x41)
      view.setUint16(at + 22, 0xffff)
      view.setUint16(at + 24, (1 - 0x41) & 0xffff)
      view.setUint16(at + 26, 1)
    }),
    loca: table(6, view => {
      view.setUint16(0, 0)
      view.setUint16(2, 0)
      view.setUint16(4, glyf.byteLength / 2)
    }),
    glyf,
  }
}

function ttf(): Uint8Array {
  const entries = Object.entries(tables())
  const size = 12 + entries.length * 16 + entries.reduce((sum, [, data]) => sum + data.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, entries.length)
  let offset = 12 + entries.length * 16
  entries.forEach(([tag, data], index) => {
    const at = 12 + index * 16
    for (let char = 0; char < 4; char += 1) out[at + char] = tag.charCodeAt(char)
    view.setUint32(at + 8, offset)
    view.setUint32(at + 12, data.length)
    out.set(data, offset)
    offset += data.length
  })
  return out
}

function woff(): Uint8Array {
  const entries = Object.entries(tables()).map(([tag, data]) => {
    const packed = deflateSync(data)
    return { tag, data, stored: packed.length < data.length ? packed : data }
  })
  const size = 44 + entries.length * 20 + entries.reduce((sum, item) => sum + item.stored.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode('wOFF'), 0)
  view.setUint32(4, 0x00010000)
  view.setUint32(8, size)
  view.setUint16(12, entries.length)
  let offset = 44 + entries.length * 20
  entries.forEach((item, index) => {
    const at = 44 + index * 20
    out.set(new TextEncoder().encode(item.tag), at)
    view.setUint32(at + 4, offset)
    view.setUint32(at + 8, item.stored.length)
    view.setUint32(at + 12, item.data.length)
    out.set(item.stored, offset)
    offset += item.stored.length
  })
  return out
}

async function inspect(bytes: Uint8Array) {
  const session = await openVectorCodec('font/codec.js', bytes)
  try {
    const descriptor = (await session.descriptor()) as unknown as {
      metadata: { id: string; entries: { key: string; value: unknown }[] }[]
      dataSources: { contract: string }[]
      traits: { id: string }[]
    }
    const facts = Object.fromEntries(
      descriptor.metadata.find(group => group.id === 'font')!.entries.map(e => [e.key, e.value]),
    )
    let svg: string | undefined
    if (descriptor.dataSources.some(s => s.contract === 'common.view/vector-scene-source')) {
      const lease = await session.dataSource('common.view/vector-scene-source', 1)
      svg = (await (lease.value as VectorSceneSource).document()).text
      await lease.release()
    }
    return { facts, svg, traits: descriptor.traits.map(trait => trait.id) }
  } finally {
    await session.dispose()
  }
}

describe('font codec', () => {
  it('reads TrueType facts and draws the mapped glyph', async () => {
    const { facts, svg, traits } = await inspect(ttf())
    // the font stage shows a subject by this trait
    expect(traits).toContain('content.fonts')
    expect(facts).toMatchObject({
      container: 'ttf',
      family: 'Probe',
      outlines: 'truetype',
      unitsPerEm: 1000,
      glyphs: 2,
      weightClass: 700,
    })
    expect(svg).toContain('<path id="glyph-1"')
    expect(svg).toContain('d="M100,100L900,100L900,900L100,900Z"')
    expect(svg).not.toMatch(/<script|data:|@font-face/u)
  })

  it('inflates WOFF tables to the same facts and sheet', async () => {
    const plain = await inspect(ttf())
    const wrapped = await inspect(woff())
    expect(wrapped.facts['container']).toBe('woff')
    expect(wrapped.facts['family']).toBe('Probe')
    expect(wrapped.svg?.replace('WOFF', 'TrueType')).toBe(plain.svg)
  })

  it('reports a WOFF2 header without a sheet', async () => {
    const bytes = new Uint8Array(48 + 2)
    const view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode('wOF2'), 0)
    view.setUint32(4, 0x00010000)
    view.setUint32(8, bytes.length)
    view.setUint16(12, 1)
    bytes[48] = 1 // known tag index 1: head, untransformed
    bytes[49] = 54 // origLength
    const { facts, svg } = await inspect(bytes)
    expect(facts).toMatchObject({ container: 'woff2', tables: 1, outlines: 'truetype' })
    expect(svg).toBeUndefined()
  })

  it('refuses a file that is not a font', async () => {
    await expect(inspect(new TextEncoder().encode('definitely not a font'))).rejects.toThrow()
  })
})
