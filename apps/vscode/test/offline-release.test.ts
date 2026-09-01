import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { extensionCatalogSigningBytes } from '@modkit/extension-manager'

const {
  copyOfflineReleaseToDist,
  offlineReleaseCatalog,
  offlineReleaseDescriptor,
  verifyOfflineReleaseDirectory,
  verifyVirtualOfflineRelease,
} = await import('../scripts/offline-release.mjs')

const roots = Object.freeze([
  'blizzard/sc2-archives',
  'blizzard/sc2-audio',
  'blizzard/sc2-data',
  'blizzard/sc2-documents',
  'blizzard/sc2-images',
  'blizzard/sc2-models',
  'blizzard/sc2-vector',
  'blizzard/sc2-video',
  'wz2100project/warzone-2100',
])

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeFixture(root: string): void {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const artifacts = Object.freeze([
    {
      id: 'blizzard/starcraft-2',
      roots: roots.slice(0, 8),
      path: 'starcraft-2.repository.json',
      bytes: Buffer.from('{"package":"starcraft-2"}\n'),
    },
    {
      id: 'wz2100project/warzone-2100',
      roots: roots.slice(8),
      path: 'warzone-2100.repository.json',
      bytes: Buffer.from('{"package":"warzone-2100"}\n'),
    },
  ])
  mkdirSync(root, { recursive: true })
  for (const artifact of artifacts) writeFileSync(join(root, artifact.path), artifact.bytes)
  const unsignedCatalog = {
    schemaVersion: 1,
    registryId: 'modkit/offline',
    generatedAt: '2026-09-01T00:00:00Z',
    packages: artifacts.map(artifact => ({
      id: artifact.id,
      displayName: artifact.id,
      publisher: artifact.id.slice(0, artifact.id.indexOf('/')),
      summary: `${artifact.id} offline package`,
      versions: [
        {
          version: '1.0.0',
          channel: 'stable',
          extensions: artifact.roots,
          source: {
            kind: 'bundle',
            uri: `./${artifact.path}`,
            integrity: sha256(artifact.bytes),
            bytes: artifact.bytes.byteLength,
            trust: { mode: 'signed' },
          },
        },
      ],
    })),
  }
  const signature = {
    algorithm: 'Ed25519',
    keyId: 'fixture-release',
    value: Buffer.from(
      sign(null, extensionCatalogSigningBytes(unsignedCatalog), privateKey),
    ).toString('base64'),
  }
  const catalog = { ...unsignedCatalog, signature }
  writeJson(join(root, offlineReleaseCatalog), catalog)
  const catalogBytes = readFileSync(join(root, offlineReleaseCatalog))
  writeJson(join(root, offlineReleaseDescriptor), {
    $comment:
      'Generated immutable offline package set. The Ed25519 private key is supplied explicitly and is never copied into this directory.',
    schemaVersion: 1,
    releaseId: 'modkit/ga-recovery-wave1b',
    generatedAt: '2026-09-01T00:00:00.000Z',
    catalog: {
      file: offlineReleaseCatalog,
      bytes: catalogBytes.byteLength,
      sha256: sha256(catalogBytes),
    },
    signing: {
      algorithm: 'Ed25519',
      keyId: signature.keyId,
      keySource: 'explicit-local-path-outside-repository',
      publicKeyPem,
    },
    packages: artifacts.map(artifact => ({
      id: artifact.id,
      version: '1.0.0',
      extensions: artifact.roots,
      file: artifact.path,
      bytes: artifact.bytes.byteLength,
      sha256: sha256(artifact.bytes),
    })),
  })
}

describe('VS Code offline managed release verification', () => {
  const cleanup: string[] = []

  afterEach(() => {
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'x3-offline-release-test-'))
    cleanup.push(root)
    return root
  }

  it('accepts, copies and re-verifies the exact signed offline inventory', () => {
    const source = tempRoot()
    const output = tempRoot()
    writeFixture(source)

    expect(verifyOfflineReleaseDirectory(source)).toMatchObject({
      packages: 2,
      roots: 9,
      files: [
        'catalog.v1.json',
        'release.v1.json',
        'starcraft-2.repository.json',
        'warzone-2100.repository.json',
      ],
    })
    expect(copyOfflineReleaseToDist({ source, output })).toMatchObject({ packages: 2, roots: 9 })
    expect(existsSync(join(output, 'managed-packages', offlineReleaseDescriptor))).toBe(true)
  })

  it('rejects extra files outside the descriptor/catalog/artifact closure', () => {
    const source = tempRoot()
    writeFixture(source)
    writeFileSync(join(source, 'unexpected.txt'), 'nope\n')

    expect(() => verifyOfflineReleaseDirectory(source)).toThrow(/offline release inventory drifted/)
  })

  it('rejects artifact bytes that do not match the descriptor and catalog hash', () => {
    const source = tempRoot()
    writeFixture(source)
    const artifactPath = join(source, 'warzone-2100.repository.json')
    writeFileSync(artifactPath, Buffer.alloc(readFileSync(artifactPath).byteLength, 0x61))

    expect(() => verifyOfflineReleaseDirectory(source)).toThrow(/artifact .*sha256/)
  })

  it('verifies VSIX-contained managed-package entries without trusting the staged tree', () => {
    const source = tempRoot()
    writeFixture(source)
    const files = [
      offlineReleaseCatalog,
      offlineReleaseDescriptor,
      'starcraft-2.repository.json',
      'warzone-2100.repository.json',
    ]

    expect(
      verifyVirtualOfflineRelease(files, name => readFileSync(join(source, ...name.split('/')))),
    ).toMatchObject({ packages: 2, roots: 9 })
  })
})
