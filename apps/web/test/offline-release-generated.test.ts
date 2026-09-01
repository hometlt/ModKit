import { createHash, createPublicKey, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  extensionCatalogSigningBytes,
  parseExtensionCatalog,
} from '@modkit/extension-manager/browser'
import { WEB_OFFLINE_RELEASE } from '../generated/offline-release.js'

const root = resolve(import.meta.dirname, '..', '..', '..')
const release = join(root, 'packages', 'extension-manager', 'generated', 'offline-release')

describe('generated Wave 1B browser release identity', () => {
  it('pins the exact signed catalog, packages and roots with a reproducible public JWK', async () => {
    const catalogBytes = readFileSync(join(release, 'catalog.v1.json'))
    const descriptor = JSON.parse(readFileSync(join(release, 'release.v1.json'), 'utf8'))
    expect(createPublicKey(descriptor.signing.publicKeyPem).export({ format: 'jwk' })).toEqual(
      WEB_OFFLINE_RELEASE.publicJwk,
    )
    expect(`sha256:${createHash('sha256').update(catalogBytes).digest('hex')}`).toBe(
      WEB_OFFLINE_RELEASE.catalogSha256,
    )
    expect(catalogBytes.byteLength).toBe(WEB_OFFLINE_RELEASE.catalogBytes)
    const catalog = parseExtensionCatalog(JSON.parse(catalogBytes.toString('utf8')))
    expect(catalog.packages.map(entry => entry.id).sort()).toEqual(WEB_OFFLINE_RELEASE.packageIds)
    expect(catalog.packages.flatMap(entry => entry.versions[0]?.extensions ?? []).sort()).toEqual(
      WEB_OFFLINE_RELEASE.roots,
    )
    const key = await webcrypto.subtle.importKey(
      'jwk',
      WEB_OFFLINE_RELEASE.publicJwk,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const signature = Buffer.from(catalog.signature?.value ?? '', 'base64')
    await expect(
      webcrypto.subtle.verify('Ed25519', key, signature, extensionCatalogSigningBytes(catalog)),
    ).resolves.toBe(true)
  })
})
