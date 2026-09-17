// Declared SC2 GameData comparison projection, applied identically to both arms.
export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) =>
  item instanceof Map ? [...item.entries()] : ArrayBuffer.isView(item) ? Buffer.from(item.buffer, item.byteOffset, item.byteLength).toString('hex') : typeof item === 'bigint' ? String(item) : item)))
export const hex = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex')

/** Rename plans: MK2 source edits vs MK3 byte replacements; MK3 spells a valid no-op as one identity edit. */
function renamePlan(edits, diagnostics) {
  return { edits, diagnostics }
}

export function project(probe, { legacy, native, value }) {
  switch (probe) {
    case 'detect':
      return { accepted: value.confidence > 0, confidence: Math.round(value.confidence * 1e6) / 1e6 }
    case 'describe':
      // MK3 adds the content.text trait every MK3 text codec publishes; the MK2 set is compared.
      return { traits: (legacy ?? native).traits.filter(item => item.id !== 'content.text').map(item => ({ id: item.id, state: item.state })) }
    case 'edit.content':
      if (legacy !== undefined)
        return renamePlan(
          legacy.edits.map(edit => ({ offset: edit.range.offset, length: edit.range.length, hex: edit.bytes ? hex(edit.bytes) : Buffer.from(edit.text).toString('hex') })),
          legacy.diagnostics.map(item => ({ code: item.code ?? item.id, severity: item.severity })),
        )
      return renamePlan(
        native.edits
          .filter(edit => edit.label !== 'SC2 Data entity rename no-op')
          .map(edit => ({ offset: Number(edit.range.offset), length: Number(edit.range.length), hex: hex(edit.payload.bytes) })),
        native.diagnostics.map(item => ({ code: item.data?.legacyCode, severity: item.severity === 'information' ? 'info' : item.severity })),
      )
    case 'export.convert':
      // One output is returned as bytes by MK3; several as a JSON list.
      if (legacy !== undefined) {
        const rows = legacy.map(item => ({ path: item.path, hex: hex(item.data) }))
        return rows.length === 1 ? [{ hex: rows[0].hex }] : rows
      }
      return native.kind === 'bytes'
        ? [{ hex: hex(native.value) }]
        : native.value.outputs.map(item => ({ path: item.path, hex: Buffer.from(item.bytes).toString('hex') }))
    case 'view.inspect':
    case 'asset.search':
    case 'asset.validate':
    case 'sc2-data.references':
    case 'sc2-data.resolve-inheritance':
      return plain(value)
  }
  throw new Error(`unknown sc2-data probe: ${probe}`)
}
