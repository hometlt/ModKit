/** Supported UVS minor versions; callers never infer a version from expression shape. */
export function scenarioVersion(value: unknown): '1.0' | '1.1' | '1.2' | '1.3' | '1.4' | '1.5' | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const uv = value as Record<string, unknown>
  return uv['format'] === 'UVS' && (uv['version'] === '1.0' || uv['version'] === '1.1' || uv['version'] === '1.2' || uv['version'] === '1.3' || uv['version'] === '1.4' || uv['version'] === '1.5')
    ? uv['version'] : undefined
}
