/**
 * CSF — the Command & Conquer String File: the compiled string table of SAGE games (Tiberium Wars,
 * Kane's Wrath, Red Alert 3) and of Westwood's Tiberian Sun and Red Alert 2, whose `UIName` keys
 * name its labels. One reader for the string-table codec and for game data that shows those names.
 *
 * ```
 * header   " FSC"  u32 version  u32 labels  u32 strings  u32 unused  u32 language
 * label    " LBL"  u32 pairs    u32 nameLen  char[nameLen] name
 * value    " RTS" | "WRTS"  u32 units  u16[units] value      // each unit stored bitwise-NOT
 *          WRTS only: u32 extraLen  char[extraLen] extra     // designer note, not shown in game
 * ```
 *
 * Tags are stored little-endian, so `CSF `/`LBL `/`STR `/`STRW` read back reversed; values are
 * UTF-16LE with every code unit complemented. Moved here from the SAGE localization codec (MK2
 * port), verified there against Kane's Wrath 1.2 `cnc3.csf` (7261 records).
 */

export interface CsfEntry {
  readonly label: string
  readonly value: string
  /** Further values under the same label: the format allows them, retail data has none. */
  readonly extraValues: readonly string[]
  /** The `WRTS` designer note, when present. */
  readonly note?: string
}

export interface CsfFile {
  readonly version: number
  readonly declaredLabels: number
  readonly declaredStrings: number
  readonly language: number
  readonly entries: readonly CsfEntry[]
}

const HEADER_TAG = ' FSC'
const LABEL_TAG = ' LBL'
const STRING_TAG = ' RTS'
const STRING_WITH_NOTE_TAG = 'WRTS'

export function isCsf(data: Uint8Array): boolean {
  return data.length >= 4 && latin1(data, 0, 4) === HEADER_TAG
}

export function parseCsf(data: Uint8Array): CsfFile {
  if (!isCsf(data)) throw new TypeError('not a CSF string table')
  if (data.length < 24) throw new RangeError('CSF header is truncated')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const version = view.getUint32(4, true)
  const declaredLabels = view.getUint32(8, true)
  const declaredStrings = view.getUint32(12, true)
  const language = view.getUint32(20, true)
  // every label takes at least its 12-byte header: a count the file cannot hold is refused early
  if (declaredLabels > (data.length - 24) / 12)
    throw new RangeError(`CSF declares ${declaredLabels} labels in ${data.length} bytes`)
  const u32 = (at: number): number => {
    if (at + 4 > data.length) throw new RangeError(`CSF read out of bounds at ${at}`)
    return view.getUint32(at, true)
  }
  const entries: CsfEntry[] = []
  let cursor = 24
  for (let index = 0; index < declaredLabels; index += 1) {
    const labelTag = latin1(data, cursor, 4)
    if (labelTag !== LABEL_TAG)
      throw new TypeError(`CSF label ${index} has tag ${JSON.stringify(labelTag)} at ${cursor}`)
    const pairs = u32(cursor + 4)
    const nameLength = u32(cursor + 8)
    cursor += 12
    const label = latin1(data, cursor, nameLength)
    cursor += nameLength
    const values: string[] = []
    let note: string | undefined
    for (let pair = 0; pair < pairs; pair += 1) {
      const valueTag = latin1(data, cursor, 4)
      if (valueTag !== STRING_TAG && valueTag !== STRING_WITH_NOTE_TAG)
        throw new TypeError(`CSF value tag ${JSON.stringify(valueTag)} at ${cursor}`)
      const units = u32(cursor + 4)
      cursor += 8
      if (cursor + units * 2 > data.length)
        throw new RangeError(`CSF value of ${units} units runs past the end at ${cursor}`)
      let value = ''
      for (let start = 0; start < units; start += 4096) {
        const chunk: number[] = []
        for (let unit = start; unit < Math.min(units, start + 4096); unit += 1)
          chunk.push(~view.getUint16(cursor + unit * 2, true) & 0xffff)
        value += String.fromCharCode(...chunk)
      }
      cursor += units * 2
      values.push(value)
      if (valueTag === STRING_WITH_NOTE_TAG) {
        const noteLength = u32(cursor)
        cursor += 4
        note ??= latin1(data, cursor, noteLength)
        cursor += noteLength
      }
    }
    entries.push({
      label,
      value: values[0] ?? '',
      extraValues: values.slice(1),
      ...(note === undefined ? {} : { note }),
    })
  }
  if (cursor !== data.length)
    throw new RangeError(`CSF trailing data: consumed ${cursor} of ${data.length}`)
  return { version, declaredLabels, declaredStrings, language, entries }
}

/** Label → value, the last one winning, as the engine resolves a repeated label. */
export function csfToMap(file: CsfFile): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of file.entries) map.set(entry.label, entry.value)
  return map
}

function latin1(data: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length < 0 || offset + length > data.length)
    throw new RangeError(`CSF read out of bounds at ${offset}+${length}`)
  let out = ''
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(data[offset + index]!)
  return out
}
