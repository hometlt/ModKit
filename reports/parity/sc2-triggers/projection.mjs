// Declared SC2 TriggerData comparison projection, applied identically to both arms.
// Values are finite JSON: undefined members are absent, Maps become sorted entry arrays.
export const plain = value =>
  value === undefined
    ? null
    : JSON.parse(JSON.stringify(value, (_key, item) =>
        item instanceof Map ? [...item.entries()].sort(([a], [b]) => String(a).localeCompare(String(b), 'en')) : item,
      ))

const sortKeys = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')))
const offsets = range => ({ startOffset: range.startOffset, endOffset: range.endOffset })
const symbol = item => ({ type: item.type, id: item.id, name: item.name ?? null, library: item.library ?? null })
const kebab = code => code.toLowerCase().replaceAll('_', '-')

/** Element kinds of the pinned MK2 TriggerLibraryJson; MK3 adds SubFuncType/Comment/CustomScript. */
const MK2_ELEMENT_TYPES = new Set(['Category', 'Trigger', 'FunctionDef', 'FunctionCall', 'Variable', 'Param', 'ParamDef', 'Preset', 'PresetValue', 'Structure', 'Label', 'CategoryRef'])

/** Language-service verbs MK2 declared disabled, and the owner named for compilation. */
export const DISABLED_VERBS = ['script.completion', 'script.format', 'edit.structure', 'script.compile']

export function project(probe, { legacy, native, value }) {
  switch (probe) {
    case 'view.inspect':
      // MK2 returns the library model, MK3 a summary; the operations overlap on library identity.
      return legacy !== undefined ? { libraryId: legacy.id } : { libraryId: native.libraries[0] }
    case 'script.symbols':
      return legacy !== undefined
        ? legacy.map(item => ({ ...symbol(item), offset: item.offset }))
        : native.map(item => ({ ...symbol(item), offset: item.offset }))
    case 'script.references':
      // MK2 filters by target; MK3 returns every anchor and the adapter applies the same filter.
      return (legacy ?? native).map(item => ({
        kind: item.kind,
        role: item.role ?? null,
        source: plain(item.source),
        target: plain(item.target),
        range: offsets(item.range),
      }))
    case 'asset.validate':
      return legacy !== undefined
        ? legacy.map(item => ({ code: kebab(item.code), message: item.message, library: item.library ?? null, elementId: item.elementId ?? null }))
        : native.map(item => ({
            code: item.code.replace(/^blizzard\.sc2-triggers\//u, ''),
            message: item.message,
            library: item.data.library ?? null,
            elementId: item.data.elementId ?? null,
          }))
    case 'asset.search':
      return (legacy ?? native).map(symbol)
    case 'detect':
      return {
        confidence: Math.round(value.confidence * 1e6) / 1e6,
        notes: value.evidence.map(item => item.detail ?? item.note).filter(note => typeof note === 'string').sort(),
      }
    case 'edit.content':
    case 'disabled-verbs':
    case 'content-scripts':
      return value
    case 'export.convert':
      // MK3 prints with the SC2 Editor layout (spaces, same-line braces); compare token text.
      return { tokens: value.replace(/\s+/gu, '') }
    case 'sax-read':
    case 'sax-read-strings':
      return {
        id: value.library.id,
        name: value.library.name ?? null,
        rootItems: value.library.items.filter(item => MK2_ELEMENT_TYPES.has(item.type)).map(item => `${item.type}:${item.id}`),
        elements: Object.values(value.library.elements)
          .filter(item => MK2_ELEMENT_TYPES.has(item.type))
          .map(item => ({ type: item.type, id: item.id, name: item.name ?? null }))
          .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`, 'en')),
        refs: plain(value.allRefs ?? null),
      }
    case 'to-engine':
      return JSON.parse(JSON.stringify(value, (key, item) => (key === 'gameType' ? undefined : item)))
    case 'xml2js-read':
    case 'source-index':
    case 'trigger-strings':
      return plain(value)
    case 'g2t':
      // Reverse conversion is compared on the reconstructed element inventory.
      if (legacy !== undefined) {
        const typeCounts = {}
        for (const element of Object.values(legacy.elements)) typeCounts[element.type] = (typeCounts[element.type] ?? 0) + 1
        return { elements: Object.keys(legacy.elements).length, typeCounts: sortKeys(typeCounts) }
      }
      return { elements: native.elements, typeCounts: sortKeys(native.typeCounts) }
  }
  throw new Error(`unknown sc2-triggers probe: ${probe}`)
}

/** Shared reference filter (MK2 Sc2TriggersCodec.references). */
export function referencesTo(references, target, ownLibrary) {
  return references.filter(reference => {
    if (reference.target?.type !== target.type || reference.target.id !== target.id) return false
    if (target.library === undefined) return true
    return (reference.target.library ?? ownLibrary) === target.library
  })
}
