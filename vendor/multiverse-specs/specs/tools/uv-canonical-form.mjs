/** Portable UV canonical forms: typed semantic values and distinct RFC 8785/JCS JSON artifacts.
 * Web Crypto is used only by the artifact digest; no host imports.
 * One implementation is shared by Node and browser composition paths.
 */
import { uvwGltfGraph, UVW_GLTF_ARTIFACT_DOMAIN } from './uvw-gltf.mjs'

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
  if (!Number.isFinite(value)) throw new TypeError('UV canonical values cannot contain NaN or infinity')
  numberScratch.setFloat64(0, value === 0 ? 0 : value, false)
  return `${numberScratch.getUint32(0, false).toString(16).padStart(8, '0')}${numberScratch
    .getUint32(4, false).toString(16).padStart(8, '0')}`
}

function encodeCanonical(value, ancestors) {
  if (value === null) return '["null"]'
  if (typeof value === 'boolean') return `["boolean",${value ? 'true' : 'false'}]`
  if (typeof value === 'number') return `["number","${numberBits(value)}"]`
  if (typeof value === 'string') return `["string",${JSON.stringify(value)}]`
  if (typeof value !== 'object') throw new TypeError(`Unsupported UV canonical value: ${typeof value}`)
  if (ancestors.has(value)) throw new TypeError('UV canonical values cannot contain cycles')
  ancestors.add(value)
  try {
    if (Array.isArray(value))
      return `["array",[${value.map(entry => encodeCanonical(entry, ancestors)).join(',')}]]`
    const entries = Object.keys(value).sort(compareCanonicalKeys).map(key => {
      if (value[key] === undefined)
        throw new TypeError(`UV canonical values cannot contain undefined (key ${key})`)
      return `[${JSON.stringify(key)},${encodeCanonical(value[key], ancestors)}]`
    })
    return `["object",[${entries.join(',')}]]`
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalStringify(value) { return encodeCanonical(value, new Set()) }
export function canonicalBytes(value) { return encoder.encode(canonicalStringify(value)) }

/** RFC 8785/JCS document form, separate from the UV typed semantic form above.
 * The format owner must reject duplicate JSON keys while parsing source bytes.
 */
function jcsEncode(value, ancestors) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS cannot contain NaN or infinity')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i)
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('JCS cannot contain a lone surrogate')
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new TypeError('JCS cannot contain a lone surrogate')
      }
    }
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new TypeError(`JCS cannot contain ${typeof value}`)
  if (ancestors.has(value)) throw new TypeError('JCS cannot contain cycles')
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null) throw new TypeError('JCS needs a plain JSON object')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const items = []
      for (let i = 0; i < value.length; i += 1) {
        if (!Object.hasOwn(value, i)) throw new TypeError('JCS cannot contain sparse arrays')
        items.push(jcsEncode(value[i], ancestors))
      }
      return `[${items.join(',')}]`
    }
    const entries = Object.keys(value).sort(compareCodeUnits).map(key =>
      `${jcsEncode(key, ancestors)}:${jcsEncode(value[key], ancestors)}`)
    return `{${entries.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function jcsStringify(value) { return jcsEncode(value, new Set()) }
export function jcsBytes(value) { return encoder.encode(jcsStringify(value)) }

/** UVP JSON artifact profile. The family determines the domain; these are JCS bytes, not typed-form bytes. */
export async function uvpJsonArtifactDigest(family, document) {
  if (family !== 'uvd' && family !== 'uvw' && family !== 'uvs')
    throw new TypeError(`No UVP JSON artifact profile for ${family}`)
  let domain = `uvp/artifact/${family}@1`
  if (family === 'uvw' && document !== null && typeof document === 'object' && Object.hasOwn(document, 'asset')) {
    uvwGltfGraph(document)
    domain = UVW_GLTF_ARTIFACT_DOMAIN
  }
  const bytes = jcsBytes({ schemaVersion: 1, domain, value: document })
  return uvpMediaArtifactDigest(bytes)
}

/** Raw media bytes, unlike the domain-separated JSON/UVB semantic identities. */
export async function uvpMediaArtifactDigest(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('UVP media needs a byte witness')
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new TypeError('Web Crypto SHA-256 is required for UVP artifact digests')
  const hash = new Uint8Array(await subtle.digest('SHA-256', bytes))
  return `sha256:${[...hash].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}
