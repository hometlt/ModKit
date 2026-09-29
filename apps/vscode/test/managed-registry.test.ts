import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readPackagedManagedRegistry } from '../src/managed-registry.js'

const REGISTRY_KEY = '-----BEGIN PUBLIC KEY-----\nregistry\n-----END PUBLIC KEY-----\n'
const FOLDER_KEY = '-----BEGIN PUBLIC KEY-----\nplanted\n-----END PUBLIC KEY-----\n'

describe('where games install from', () => {
  const cleanup: string[] = []
  afterEach(() => {
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
  })
  const temp = (): string => {
    const path = mkdtempSync(join(tmpdir(), 'modkit-managed-registry-'))
    cleanup.push(path)
    return path
  }
  const writeJson = (path: string, value: unknown): void => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(value))
  }
  /** A packages folder as the integrator publishes it, with a key of its own planted beside. */
  const packagesFolder = (): string => {
    const folder = temp()
    writeJson(join(folder, 'catalog.v1.json'), { schemaVersion: 1 })
    writeJson(join(folder, 'release.v1.json'), {
      catalog: { file: 'catalog.v1.json' },
      signing: { keyId: 'planted', publicKeyPem: FOLDER_KEY },
    })
    return folder
  }

  it('reads the catalog beside the package and trusts only the key the package carries', () => {
    const extension = temp()
    writeJson(join(extension, 'dist-app', 'registry-trust.v1.json'), {
      schemaVersion: 1,
      keyId: 'modkit.registry',
      algorithm: 'Ed25519',
      publicKeyPem: REGISTRY_KEY,
    })
    const folder = packagesFolder()
    expect(readPackagedManagedRegistry(extension, folder)).toEqual({
      catalogPath: join(folder, 'catalog.v1.json'),
      trustedPublicKeys: { 'modkit.registry': REGISTRY_KEY },
    })
    // no folder, or one without a catalog: the key stays, there is nothing to install from
    expect(readPackagedManagedRegistry(extension)).toEqual({
      trustedPublicKeys: { 'modkit.registry': REGISTRY_KEY },
    })
    expect(readPackagedManagedRegistry(extension, temp())).toEqual({
      trustedPublicKeys: { 'modkit.registry': REGISTRY_KEY },
    })
  })

  it('reads a build from before the split, whose release is inside the package', () => {
    const extension = temp()
    const release = join(extension, 'dist-app', 'managed-packages')
    writeJson(join(release, 'catalog.v1.json'), { schemaVersion: 1 })
    writeJson(join(release, 'release.v1.json'), {
      catalog: { file: 'catalog.v1.json' },
      signing: { keyId: 'modkit.registry', publicKeyPem: REGISTRY_KEY },
    })
    expect(readPackagedManagedRegistry(extension)).toEqual({
      catalogPath: join(release, 'catalog.v1.json'),
      trustedPublicKeys: { 'modkit.registry': REGISTRY_KEY },
    })
  })

  it('has nothing to offer a package that carries no key', () => {
    expect(readPackagedManagedRegistry(temp(), packagesFolder())).toBeUndefined()
  })
})
