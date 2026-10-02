/** Shared cross-field checks for UVW atlas layers. The JSON schema owns the wire shape. */
function refuse(rule: string, message: string): never {
  throw Object.assign(new TypeError(`${rule}: ${message}`), { rule })
}
function record(value: unknown, rule: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(rule, 'Expected an object')
  return value as Record<string, unknown>
}
const integer = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
const keys = (row: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(row).every(key => allowed.includes(key))
const tuple = (value: unknown, length: number, accepts: (item: unknown) => boolean): boolean =>
  Array.isArray(value) && value.length === length && Array.from(value).every(accepts)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Atlas declarations and tile joins are identical before/after glTF migration. Actual
 * image dimensions/column bounds stay with the texture owner; no second image decoder.
 */
export function assertTerrainAtlas(layerValue: unknown, gltfValue?: unknown): void {
  const layer = record(layerValue, 'terrain-atlas')
  const materials = Array.isArray(layer['materials']) ? layer['materials'] : []
  const catalog = new Map<string, Record<string, unknown>>()
  for (const value of materials) {
    const material = record(value, 'terrain-atlas')
    if (typeof material['id'] === 'string') catalog.set(material['id'], material)
    if (material['atlas'] === undefined) continue
    const atlas = record(material['atlas'], 'terrain-atlas')
    if (!keys(atlas, ['rows', 'tileTop']) || !integer(atlas['rows'], 1)
      || (atlas['tileTop'] !== undefined && atlas['tileTop'] !== 'local-y-1' && atlas['tileTop'] !== 'local-y-0'))
      refuse('terrain-atlas', 'An atlas needs a positive exact integer row count')
    let textured = typeof material['baseColorResourceId'] === 'string' && material['baseColorResourceId'].length > 0
    if (gltfValue !== undefined) {
      const document = record(gltfValue, 'terrain-atlas')
      const rows = Array.isArray(document['materials']) ? document['materials'] : []
      const index = material['material']
      const target = integer(index, 0) ? rows[index] : undefined
      const pbr = target && record(target, 'terrain-atlas')['pbrMetallicRoughness']
      textured = !!pbr && record(pbr, 'terrain-atlas')['baseColorTexture'] !== undefined
    }
    if (!textured) refuse('terrain-atlas', 'Atlas material needs a base-colour texture')
  }
  const samples = Array.isArray(layer['samples']) ? layer['samples'] : []
  for (const row of samples) {
    if (!Array.isArray(row)) continue // The existing geometry checker owns grid dimensions.
    for (const sampleValue of row) {
      const sample = record(sampleValue, 'terrain-atlas-sample')
      if (sample['cornerUv'] !== undefined && !tuple(sample['cornerUv'], 4, value => tuple(value, 2, finite)))
        refuse('terrain-corner-uv', 'A sample needs four finite UV pairs in authored corner order')
      if (sample['layers'] === undefined) continue
      if (!keys(sample, ['weights', 'uvTransform', 'cornerUv', 'layers']) || !Array.isArray(sample['layers'])
        || sample['layers'].length === 0 || sample['layers'].length > 256)
        refuse('terrain-atlas-sample', 'An atlas sample needs 1..256 ordered tile layers')
      for (const value of sample['layers']) {
        const entry = record(value, 'terrain-atlas-tile')
        const material = typeof entry['materialId'] === 'string' ? catalog.get(entry['materialId']) : undefined
        const atlas = material?.['atlas']
        const tile = record(entry['tile'], 'terrain-atlas-tile')
        if (!keys(entry, ['materialId', 'tile', 'cornerAlpha']) || !material || !atlas
          || !keys(tile, ['column', 'row']) || !integer(tile['column'], 0) || !integer(tile['row'], 0)
          || tile['row'] >= (record(atlas, 'terrain-atlas')['rows'] as number))
          refuse('terrain-atlas-tile', 'Tile needs a declared atlas material and an in-range row/column')
        if (entry['cornerAlpha'] !== undefined
          && !tuple(entry['cornerAlpha'], 4, value => finite(value) && value >= 0 && value <= 1))
          refuse('terrain-corner-alpha', 'A tile layer needs four linear coverage factors in 0..1')
      }
      if (sample['weights'] !== undefined)
        assertTerrainBlend(sample, new Set(catalog.keys()), String(layer['id']))
    }
  }
}

/** The existing normalized blend rule; atlas-only samples deliberately have no weights.
 * Retained weights must remain valid even when atlas layers select the rendered ground.
 */
export function assertTerrainBlend(sampleValue: unknown, ids: ReadonlySet<string>, context: string): void {
  const sample = record(sampleValue, 'uvw-gltf-material-weight')
  if (sample['weights'] === undefined && sample['layers'] !== undefined) return
  if (!Array.isArray(sample['weights']) || !sample['weights'].length)
    refuse('uvw-gltf-material-weight', 'Every blend sample needs weights or ordered atlas layers')
  const seen = new Set<string>(); let total = 0; let previous: string | undefined
  for (const value of sample['weights']) {
    const entry = record(value, 'uvw-gltf-material-weight')
    const id = entry['materialId'], weight = entry['weight']
    if (typeof id !== 'string' || !ids.has(id) || seen.has(id) || typeof weight !== 'number'
      || !Number.isFinite(weight) || weight <= 0 || weight > 1)
      refuse('uvw-gltf-material-weight', `Invalid, repeated or unresolved blend in ${context}`)
    if (previous !== undefined && previous >= id)
      refuse('uvw-gltf-material-order', `IDs must be unique and ordered in blend sample ${context}`)
    previous = id; seen.add(id); total += weight
  }
  if (Math.abs(total - 1) > 1e-6) refuse('uvw-gltf-material-weight', 'Blend weights must sum to one')
}

export function assertDerivedCliffObject(instanceValue: unknown): void {
  const instance = record(instanceValue, 'objects-instance')
  if (instance['derivedFrom'] !== undefined
    && (instance['derivedFrom'] !== 'cliffs' || instance['objectKind'] !== 'doodad'))
    refuse('objects-derived-from', 'Only a doodad may be a derived cliff presentation piece')
}
