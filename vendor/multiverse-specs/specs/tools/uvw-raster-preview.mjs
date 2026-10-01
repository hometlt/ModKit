/** Exact addressed comparison of legacy inline weights to verified RGBA8 raster samples.
 * The target UVW verifier owns raster metadata and the compositor owns byte witnesses.
 */
const refuse = (rule, message) => { throw new TypeError(`${rule}: ${message}`) }
const maxPreviewSamples = 16_000_000

function axis(position, size) {
  const texel = position * size - 0.5
  const lower = Math.floor(texel), upper = lower + 1
  return [Math.max(0, Math.min(size - 1, lower)),
    Math.max(0, Math.min(size - 1, upper)), texel - lower]
}

/** Refuse unless each inline grid point matches the target's declared bilinear raster policy. */
export function assertUvwRasterInlinePreview(layer, inlineSamples, rasters, maxAbsError) {
  if (!Number.isFinite(maxAbsError) || maxAbsError < 0 || maxAbsError > 1 / 255
    || !Number.isSafeInteger(layer?.rows) || !Number.isSafeInteger(layer?.columns)
    || layer.rows < 2 || layer.columns < 2
    || layer.rows * layer.columns > maxPreviewSamples
    || !Array.isArray(inlineSamples) || inlineSamples.length !== layer.rows
    || !Array.isArray(rasters) || !rasters.length || rasters.length > 2
    || layer.rasterSampling?.coordinates !== 'material-grid-extent'
    || layer.rasterSampling?.filter !== 'bilinear'
    || layer.rasterSampling?.wrap !== 'clamp'
    || layer.rasterSampling?.normalization !== 'sum')
    refuse('uvw-raster-preview-policy', 'Expected bounded inline grid and explicit bilinear raster policy')
  if (!Array.isArray(layer.materials) || layer.materials.some(row => typeof row?.id !== 'string'))
    refuse('uvw-raster-preview-raster', 'Invalid terrain material catalog')
  const materials = new Set(layer.materials.map(row => row.id))
  if (materials.size !== layer.materials.length)
    refuse('uvw-raster-preview-raster', 'Duplicate terrain material ID')
  const width = rasters[0].width, height = rasters[0].height
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1
    || !Number.isSafeInteger(width * height * 4) || width * height * 4 > 64 * 1024 * 1024)
    refuse('uvw-raster-preview-raster', 'Invalid raster dimensions')
  const channels = new Set()
  for (const raster of rasters) {
    if (raster.width !== width || raster.height !== height
      || !Array.isArray(raster.materialIds) || raster.materialIds.length < 1
      || raster.materialIds.length > 4
      || raster.materialIds.some((id, index) => !materials.has(id) || channels.has(id)
        || raster.materialIds.indexOf(id) !== index)
      || !(raster.bytes instanceof Uint8Array) || raster.bytes.length !== width * height * 4)
      refuse('uvw-raster-preview-raster', 'Raster metadata or bytes differ from the checked layer')
    for (const id of raster.materialIds) channels.add(id)
  }
  for (let row = 0; row < layer.rows; row++) {
    const samples = inlineSamples[row]
    if (!Array.isArray(samples) || samples.length !== layer.columns)
      refuse('uvw-raster-preview-inline', `Incomplete inline row ${row}`)
    const [y0, y1, fy] = axis(row / (layer.rows - 1), height)
    for (let column = 0; column < layer.columns; column++) {
      const sample = samples[column]
      if (!sample || Object.keys(sample).join(',') !== 'weights' || !Array.isArray(sample.weights)
        || !sample.weights.length)
        refuse('uvw-raster-preview-inline', `Only pure inline weights can be proved at ${column},${row}`)
      const inline = new Map(); let inlineSum = 0
      for (const weight of sample.weights) {
        if (!weight || Object.keys(weight).sort().join(',') !== 'materialId,weight'
          || !materials.has(weight.materialId) || inline.has(weight.materialId)
          || !Number.isFinite(weight.weight) || weight.weight <= 0 || weight.weight > 1)
          refuse('uvw-raster-preview-inline', `Invalid inline weight at ${column},${row}`)
        inline.set(weight.materialId, weight.weight); inlineSum += weight.weight
      }
      if (Math.abs(inlineSum - 1) > 1e-6)
        refuse('uvw-raster-preview-inline', `Inline weights do not sum to one at ${column},${row}`)
      const [x0, x1, fx] = axis(column / (layer.columns - 1), width)
      const rasterWeights = new Map(); let rasterSum = 0
      for (const raster of rasters) for (const [channel, materialId] of raster.materialIds.entries()) {
        const bytes = raster.bytes
        const a = bytes[(y0 * width + x0) * 4 + channel]
        const b = bytes[(y0 * width + x1) * 4 + channel]
        const c = bytes[(y1 * width + x0) * 4 + channel]
        const d = bytes[(y1 * width + x1) * 4 + channel]
        const value = ((a * (1 - fx) + b * fx) * (1 - fy)
          + (c * (1 - fx) + d * fx) * fy)
        rasterWeights.set(materialId, value); rasterSum += value
      }
      if (rasterSum === 0) {
        if (layer.rasterSampling.zeroSum?.mode !== 'material')
          refuse('uvw-raster-preview-zero-sum', `Zero raster weights at ${column},${row}`)
        rasterWeights.set(layer.rasterSampling.zeroSum.materialId, 1)
        rasterSum = 1
      }
      for (const materialId of materials)
        if (Math.abs((inline.get(materialId) ?? 0)
          - (rasterWeights.get(materialId) ?? 0) / rasterSum) > maxAbsError + 1e-12)
          refuse('uvw-raster-preview-mismatch', `Inline and raster differ for ${materialId} at ${column},${row}`)
    }
  }
}
