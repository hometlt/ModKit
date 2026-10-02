import { encodeCanonicalValue } from './uv-value.mjs'

/** Authored addresses remain symbolic until the existing composition binder assigns IDs. */
export function scenarioInitialReferenceAddress(type: string, initial: unknown, version: string | undefined): string | undefined {
  if (['1.4', '1.5'].includes(version ?? '') && (type === 'ref<def>' || type === 'ref<player>')
    && (!initial || typeof initial !== 'object' || Array.isArray(initial)))
    throw new TypeError('UVS 1.4 or later definition/player initializers require an authored address, never a private numeric handle.')
  if (!type.startsWith('ref<') || !initial || typeof initial !== 'object' || Array.isArray(initial)) return undefined
  if (!['1.4', '1.5'].includes(version ?? '')) throw new TypeError('Address initializers require UVS 1.4 or later.')
  if (type !== 'ref<def>' && type !== 'ref<player>') throw new TypeError('Only fresh definition/player identities have authored addresses.')
  const value = initial as Record<string, unknown>
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, 'address') || typeof value['address'] !== 'string'
    || !value['address'] || value['address'].trim() !== value['address'] || value['address'].includes('\0'))
    throw new TypeError('Reference initial must contain exactly one nonempty address.')
  // The canonical string codec owns UTF-8 validity and the 1024-byte bound.
  encodeCanonicalValue({ type: 'strref', value: value['address'] })
  return value['address']
}
