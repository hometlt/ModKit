import { createPublicKey, type KeyObject } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

import type { NodeExtensionVfsOptions, NodeTrustedPublicKeys } from '@modkit/extension-manager/node'

const MAX_TRUST_ENV_BYTES = 256 * 1024
const MAX_TRUSTED_KEYS = 64
const MAX_KEY_ID_LENGTH = 256
const MAX_PUBLIC_KEY_BYTES = 32 * 1024
const MAX_ORIGINS_ENV_BYTES = 16 * 1024
const MAX_ALLOWED_ORIGINS = 64
const MAX_RAPID_POOL_ROOT_BYTES = 4 * 1024

export interface ExtensionManagerEnvironment {
  readonly MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS?: string | undefined
  readonly MODKIT_EXTENSION_ALLOWED_ORIGINS?: string | undefined
  readonly MODKIT_EXTENSION_RAPID_POOL_ROOT?: string | undefined
}

export interface ExtensionManagerSecurityOptions {
  readonly trustedPublicKeys: NodeTrustedPublicKeys
  readonly vfsOptions: NodeExtensionVfsOptions
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function environmentError(name: keyof ExtensionManagerEnvironment, reason: string): TypeError {
  return new TypeError(`${name} ${reason}`)
}

function trustedPublicKey(
  keyId: string,
  material: unknown,
  environmentName: keyof ExtensionManagerEnvironment,
): KeyObject {
  if (keyId.trim() !== keyId || keyId.length === 0 || keyId.length > MAX_KEY_ID_LENGTH) {
    throw environmentError(environmentName, 'contains an invalid key id')
  }
  if (
    typeof material !== 'string' ||
    material.trim().length === 0 ||
    byteLength(material) > MAX_PUBLIC_KEY_BYTES
  ) {
    throw environmentError(environmentName, `contains invalid public key material for ${keyId}`)
  }
  let key: KeyObject
  try {
    key = createPublicKey(material)
  } catch {
    throw environmentError(environmentName, `contains invalid public key material for ${keyId}`)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw environmentError(environmentName, `contains a non-Ed25519 public key for ${keyId}`)
  }
  return key
}

function trustedPublicKeyRecord(
  document: unknown,
  environmentName: keyof ExtensionManagerEnvironment,
): Readonly<Record<string, KeyObject>> {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw environmentError(environmentName, 'must be a JSON object of Ed25519 public keys')
  }
  const entries = Object.entries(document)
  if (entries.length > MAX_TRUSTED_KEYS) {
    throw environmentError(environmentName, 'contains too many keys')
  }
  const keys = Object.create(null) as Record<string, KeyObject>
  for (const [keyId, material] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    keys[keyId] = trustedPublicKey(keyId, material, environmentName)
  }
  return Object.freeze(keys)
}

function trustedPublicKeys(value: string | undefined): Readonly<Record<string, KeyObject>> {
  if (value === undefined || value.trim() === '') return Object.freeze({})
  if (byteLength(value) > MAX_TRUST_ENV_BYTES) {
    throw environmentError('MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS', 'exceeds its size limit')
  }
  let document: unknown
  try {
    document = JSON.parse(value)
  } catch {
    throw environmentError(
      'MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS',
      'must be a JSON object of Ed25519 public keys',
    )
  }
  return trustedPublicKeyRecord(document, 'MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS')
}

function allowedOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return Object.freeze([])
  if (byteLength(value) > MAX_ORIGINS_ENV_BYTES) {
    throw environmentError('MODKIT_EXTENSION_ALLOWED_ORIGINS', 'exceeds its size limit')
  }
  const inputs = value.split(',').map(item => item.trim())
  if (inputs.length > MAX_ALLOWED_ORIGINS) {
    throw environmentError('MODKIT_EXTENSION_ALLOWED_ORIGINS', 'contains too many origins')
  }
  const origins: string[] = []
  for (const input of inputs) {
    let parsed: URL
    try {
      parsed = new URL(input)
    } catch {
      throw environmentError('MODKIT_EXTENSION_ALLOWED_ORIGINS', 'contains an invalid origin')
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw environmentError(
        'MODKIT_EXTENSION_ALLOWED_ORIGINS',
        'must contain only HTTP(S) origins without paths, credentials, queries or fragments',
      )
    }
    if (origins.includes(parsed.origin)) {
      throw environmentError('MODKIT_EXTENSION_ALLOWED_ORIGINS', 'contains a duplicate origin')
    }
    origins.push(parsed.origin)
  }
  return Object.freeze(origins)
}

function rapidPoolRoot(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const root = value.trim()
  if (byteLength(root) > MAX_RAPID_POOL_ROOT_BYTES || root.includes('\0') || !isAbsolute(root)) {
    throw environmentError(
      'MODKIT_EXTENSION_RAPID_POOL_ROOT',
      'must be a bounded absolute filesystem path',
    )
  }
  return resolve(root)
}

/**
 * Parses the explicit VS Code extension-manager security boundary without doing I/O. Empty trust
 * and origin maps are intentional: remote catalogs cannot become trusted and VFS HTTP artifacts
 * cannot be opened until the user supplies both allowlists.
 */
export function extensionManagerSecurityOptions(
  environment: ExtensionManagerEnvironment,
  builtInTrustedPublicKeys: Readonly<Record<string, string>> = Object.freeze({}),
): ExtensionManagerSecurityOptions {
  const poolRoot = rapidPoolRoot(environment.MODKIT_EXTENSION_RAPID_POOL_ROOT)
  const builtInKeys = trustedPublicKeyRecord(
    builtInTrustedPublicKeys,
    'MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS',
  )
  const environmentKeys = trustedPublicKeys(environment.MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS)
  for (const keyId of Object.keys(environmentKeys)) {
    if (Object.hasOwn(builtInKeys, keyId)) {
      throw environmentError(
        'MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS',
        `cannot override built-in key ${keyId}`,
      )
    }
  }
  return Object.freeze({
    trustedPublicKeys: Object.freeze({ ...builtInKeys, ...environmentKeys }),
    vfsOptions: Object.freeze({
      allowedOrigins: allowedOrigins(environment.MODKIT_EXTENSION_ALLOWED_ORIGINS),
      ...(poolRoot === undefined ? {} : { rapidPoolRoot: poolRoot }),
    }),
  })
}
