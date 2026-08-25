/**
 * Reference implementation of the UV typed canonical form and of UV semantic digests.
 *
 * Normative text: ../foundation/SPEC_UV_CANONICALIZATION.md.
 *
 * This is the form that feeds *semantic* hashes (`projectionSemanticHash`,
 * `presentationSemanticHash`, proof roots). It is NOT the form that feeds
 * `artifactCanonicalDigest`: canonical document bytes stay on RFC 8785 (JCS) per
 * SPEC_UV_FOUNDATION §3. The two quantities are different by construction and are never
 * compared with each other.
 *
 * The encoding is byte-identical to the executable oracle it was lifted from
 * (`packages/world/src/canonical.ts` in the sealed legacy tree), so a digest produced here
 * and a digest produced by that implementation agree. `../conformance/canonical-form/vectors.json`
 * pins the agreement as data, so no implementation has to trust either copy of the code.
 *
 * Dependency-free by design: Node built-ins only. The specs repository must stay installable
 * as plain files.
 */

import { createHash } from 'node:crypto'

const encoder = new TextEncoder()
const numberScratch = new DataView(new ArrayBuffer(8))

function compareCodeUnits(left, right) {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

/** UTF-8 byte ordering with a code-unit tie-break for ill-formed UTF-16 input. */
export function compareCanonicalKeys(left, right) {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index] - rightBytes[index]
    if (difference !== 0) return difference
  }
  return leftBytes.length - rightBytes.length || compareCodeUnits(left, right)
}

function numberBits(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError('UV canonical values cannot contain NaN or infinity')
  }
  numberScratch.setFloat64(0, value === 0 ? 0 : value, false)
  return `${numberScratch.getUint32(0, false).toString(16).padStart(8, '0')}${numberScratch
    .getUint32(4, false)
    .toString(16)
    .padStart(8, '0')}`
}

function encodeCanonical(value, ancestors) {
  if (value === null) return '["null"]'
  if (typeof value === 'boolean') return `["boolean",${value ? 'true' : 'false'}]`
  if (typeof value === 'number') return `["number","${numberBits(value)}"]`
  if (typeof value === 'string') return `["string",${JSON.stringify(value)}]`
  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported UV canonical value: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new TypeError('UV canonical values cannot contain cycles')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return `["array",[${value.map(entry => encodeCanonical(entry, ancestors)).join(',')}]]`
    }
    const entries = Object.keys(value)
      .sort(compareCanonicalKeys)
      .map(key => {
        if (value[key] === undefined) {
          throw new TypeError(`UV canonical values cannot contain undefined (key ${key})`)
        }
        return `[${JSON.stringify(key)},${encodeCanonical(value[key], ancestors)}]`
      })
    return `["object",[${entries.join(',')}]]`
  } finally {
    ancestors.delete(value)
  }
}

/** Canonical, type-preserving text used only as the byte input to UV semantic digests. */
export function canonicalStringify(value) {
  return encodeCanonical(value, new Set())
}

export function canonicalBytes(value) {
  return encoder.encode(canonicalStringify(value))
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Algorithm-qualified digest over a domain-tagged canonical envelope.
 *
 * SPEC_UV_FOUNDATION §3: "Every digest states its algorithm and domain tag." The algorithm
 * prefix is part of the string so a bare hex digest can never be mistaken for a qualified one,
 * and so a future algorithm change is visible in every artifact that carries a digest.
 */
export function uvDigest(domain, value, { schemaVersion = 1, algorithm = 'sha256' } = {}) {
  if (algorithm !== 'sha256') throw new TypeError(`Unsupported UV digest algorithm: ${algorithm}`)
  return `sha256:${sha256Hex(canonicalBytes({ schemaVersion, domain, value }))}`
}

const QUALIFIED_DIGEST = /^sha256:[0-9a-f]{64}$/u

/** True for a digest string that names its algorithm and carries a well-formed payload. */
export function isAlgorithmQualifiedDigest(value) {
  return typeof value === 'string' && QUALIFIED_DIGEST.test(value)
}
