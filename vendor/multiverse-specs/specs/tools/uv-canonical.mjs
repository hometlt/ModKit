/** UV semantic digest reference. The canonical form itself is browser-portable. */
import { createHash } from 'node:crypto'
import { canonicalBytes } from './uv-canonical-form.mjs'
export { canonicalBytes, canonicalStringify, compareCanonicalKeys } from './uv-canonical-form.mjs'

export function sha256Hex(bytes) { return createHash('sha256').update(bytes).digest('hex') }

/** Algorithm-qualified digest over a domain-tagged semantic canonical envelope. */
export function uvDigest(domain, value, { schemaVersion = 1, algorithm = 'sha256' } = {}) {
  if (algorithm !== 'sha256') throw new TypeError(`Unsupported UV digest algorithm: ${algorithm}`)
  return `sha256:${sha256Hex(canonicalBytes({ schemaVersion, domain, value }))}`
}

const QUALIFIED_DIGEST = /^sha256:[0-9a-f]{64}$/u
export function isAlgorithmQualifiedDigest(value) {
  return typeof value === 'string' && QUALIFIED_DIGEST.test(value)
}
