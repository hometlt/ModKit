/**
 * Where games install from: the registry's public key the package carries and the signed catalog
 * of the packages folder beside it. Free of `vscode`, so it is tested under Node.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  MANAGED_PACKAGES_DIRECTORY,
  MANAGED_RELEASE_CATALOG,
  MANAGED_RELEASE_DESCRIPTOR,
  REGISTRY_TRUST_FILE,
} from './constants.js'

export interface PackagedManagedRegistry {
  /** The signed catalog games install from; absent when no packages folder holds one. */
  readonly catalogPath?: string
  readonly trustedPublicKeys: Readonly<Record<string, string>>
}

/**
 * Where this window installs games from (owner decision 29.09). The package carries only the
 * registry's public key (`registry-trust.v1.json`); the signed catalog and the bundles are in a
 * packages folder published beside it (`modkit.extensionPackages`), and the key found in that
 * folder is never trusted. A build from before the split carries the whole release in
 * `managed-packages` and is read as it was.
 */
export function readPackagedManagedRegistry(
  extensionRoot: string,
  packagesFolder?: string,
): PackagedManagedRegistry | undefined {
  const releaseRoot = join(extensionRoot, 'dist-app', MANAGED_PACKAGES_DIRECTORY)
  const trustPath = join(extensionRoot, 'dist-app', REGISTRY_TRUST_FILE)
  const embeddedDescriptor = join(releaseRoot, MANAGED_RELEASE_DESCRIPTOR)
  const signing = existsSync(trustPath)
    ? (JSON.parse(readFileSync(trustPath, 'utf8')) as {
        readonly keyId?: unknown
        readonly publicKeyPem?: unknown
      })
    : existsSync(embeddedDescriptor)
      ? embeddedSigning(embeddedDescriptor)
      : undefined
  if (signing === undefined) return undefined
  const keyId = signing.keyId
  const publicKeyPem = signing.publicKeyPem
  if (typeof keyId !== 'string' || keyId.trim() === '') {
    throw new Error('the managed release signing keyId must be non-empty')
  }
  if (typeof publicKeyPem !== 'string' || publicKeyPem.trim() === '') {
    throw new Error('the managed release public key must be non-empty PEM')
  }
  const folderCatalog =
    packagesFolder === undefined || packagesFolder.trim() === ''
      ? undefined
      : join(packagesFolder.trim(), MANAGED_RELEASE_CATALOG)
  const catalogPath =
    folderCatalog !== undefined && existsSync(folderCatalog)
      ? folderCatalog
      : existsSync(embeddedDescriptor)
        ? join(releaseRoot, MANAGED_RELEASE_CATALOG)
        : undefined
  return Object.freeze({
    ...(catalogPath === undefined ? {} : { catalogPath }),
    trustedPublicKeys: Object.freeze({ [keyId]: publicKeyPem }),
  })
}

/** The signing block of a release a build embedded before the split. */
function embeddedSigning(descriptorPath: string): {
  readonly keyId?: unknown
  readonly publicKeyPem?: unknown
} {
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as {
    readonly catalog?: { readonly file?: unknown }
    readonly signing?: { readonly keyId?: unknown; readonly publicKeyPem?: unknown }
  }
  if (descriptor.catalog?.file !== MANAGED_RELEASE_CATALOG) {
    throw new Error(`packaged managed catalog file must be ${MANAGED_RELEASE_CATALOG}`)
  }
  return descriptor.signing ?? {}
}
