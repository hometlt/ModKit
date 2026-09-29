import { describe, expect, it } from 'vitest'
import { csfToMap, isCsf, parseCsf } from '../src/text/index.js'

/** A CSF with the given labels; a value with a note is written as `WRTS`. */
function csf(labels: readonly { label: string; value: string; note?: string }[]): Uint8Array {
  const parts: number[] = []
  const u32 = (value: number) =>
    parts.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24)
  const ascii = (text: string) => parts.push(...[...text].map(character => character.charCodeAt(0)))
  ascii(' FSC')
  u32(3) // version
  u32(labels.length)
  u32(labels.length)
  u32(0)
  u32(0) // language: US English
  for (const item of labels) {
    ascii(' LBL')
    u32(1)
    u32(item.label.length)
    ascii(item.label)
    ascii(item.note === undefined ? ' RTS' : 'WRTS')
    u32(item.value.length)
    for (const unit of [...item.value].map(character => character.charCodeAt(0))) {
      const stored = ~unit & 0xffff
      parts.push(stored & 0xff, stored >>> 8)
    }
    if (item.note !== undefined) {
      u32(item.note.length)
      ascii(item.note)
    }
  }
  return Uint8Array.from(parts)
}

describe('CSF string tables', () => {
  it('reads labels, complemented UTF-16 values and designer notes', () => {
    const bytes = csf([
      { label: 'Name:E1', value: 'GI' },
      { label: 'Name:Tanya', value: 'Tanya', note: 'hero' },
      { label: 'Name:E1', value: 'Conscript' },
    ])
    expect(isCsf(bytes)).toBe(true)
    const file = parseCsf(bytes)
    expect(file.entries[1]).toEqual({
      label: 'Name:Tanya',
      value: 'Tanya',
      extraValues: [],
      note: 'hero',
    })
    // a repeated label: the last one wins, as in the engine
    expect(csfToMap(file).get('Name:E1')).toBe('Conscript')
  })

  it('refuses a truncated table, trailing bytes and a label count the file cannot hold', () => {
    const bytes = csf([{ label: 'Name:E1', value: 'GI' }])
    expect(() => parseCsf(bytes.slice(0, bytes.length - 1))).toThrow(RangeError)
    expect(() => parseCsf(Uint8Array.from([...bytes, 0]))).toThrow(/trailing/u)
    const lying = bytes.slice()
    new DataView(lying.buffer).setUint32(8, 0xffffffff, true)
    expect(() => parseCsf(lying)).toThrow(/declares/u)
    expect(isCsf(new TextEncoder().encode('not a table'))).toBe(false)
  })
})
