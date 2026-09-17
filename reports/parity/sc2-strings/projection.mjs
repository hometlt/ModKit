// Declared SC2 strings comparison projection, applied identically to both arms.
// Entry lists are compared sorted by key with a code-point comparator: MK2 reports model index
// order, MK3 sorts its effective entries.
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const refKey = item => JSON.stringify([item.ns, item.entity, item.field])
export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) =>
  item instanceof Map ? [...item.entries()] : ArrayBuffer.isView(item) ? [...item] : item)))

export function project(probe, { legacy, native, value }) {
  switch (probe) {
    case 'view.inspect':
      return legacy !== undefined
        ? { entries: legacy.length, duplicateKeys: legacy.filter(item => item.duplicate).length }
        : { entries: native.entries, duplicateKeys: native.duplicateKeys }
    case 'asset.validate':
      return legacy !== undefined
        ? legacy.map(item => ({ code: item.code, message: item.message, severity: item.severity, line: item.line, start: item.start ?? null, end: item.end ?? null }))
        : native.map(item => ({
            code: item.code.replace(/^blizzard\.sc2-strings\//u, ''),
            message: item.message,
            severity: item.severity,
            line: item.data.line,
            start: item.data.start ?? null,
            end: item.data.end ?? null,
          }))
    case 'references':
      return value.map(item => ({ ns: item.ns, entity: item.entity, field: item.field })).sort((a, b) => order(refKey(a), refKey(b)))
    case 'export.convert':
    case 'edit.content':
      return { text: value }
    case 'export.entries':
      return value.map(item => ({ key: item.key, value: item.value })).sort((a, b) => order(a.key, b.key))
    case 'parse':
    case 'compare-locales':
    case 'resolve-fallback':
      return plain(value)
  }
  throw new Error(`unknown sc2-strings probe: ${probe}`)
}
