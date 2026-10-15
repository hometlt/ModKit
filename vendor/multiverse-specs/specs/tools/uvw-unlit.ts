/** Validate the optional presentation policy without materializing interpreted defaults. */
export function assertUnlitLighting(layer: Record<string, unknown>): void {
  if (layer['model'] !== undefined && layer['model'] !== 'lit' && layer['model'] !== 'unlit')
    throw new TypeError('lighting-value: Unsupported lighting model')
  const color = layer['unlitColor']
  if (color !== undefined && (!Array.isArray(color) || color.length !== 3
    || color.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)))
    throw new TypeError('lighting-value: unlitColor must be non-negative finite linear RGB')
}
