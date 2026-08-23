export function classifyParity(canonicalFeatures, x3Features, x3Available = true) {
  if (!x3Available) {
    return Object.freeze({ classification: 'нет в X3', missing: [...canonicalFeatures], extra: [] })
  }
  const canonical = new Set(canonicalFeatures)
  const x3 = new Set(x3Features)
  const missing = [...canonical].filter(feature => !x3.has(feature)).sort()
  const extra = [...x3].filter(feature => !canonical.has(feature)).sort()
  const classification =
    missing.length > 0 ? 'X3 беднее' : extra.length > 0 ? 'X3 богаче' : 'паритет'
  return Object.freeze({ classification, missing, extra })
}

export function comparableMetadataFeatures(input) {
  const keys = ['animations', 'materials', 'meshes', 'nodes', 'primitives', 'scenes', 'textures']
  return keys.filter(key => Number.isSafeInteger(input[key])).map(key => `metadata:${key}`)
}
