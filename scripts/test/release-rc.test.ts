import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { READY_APP_EXTENSIONS } from '../app-extension-sets.mjs'
import {
  buildRc,
  buildLicenseDocuments,
  canonicalExtensionDigest,
  checkRc,
  emitRcMetadata,
  verifyRc,
} from '../release/rc.mjs'
import { activeRc, installRc, rollbackRc } from '../release/install-rc.mjs'

const temporaryRoots: string[] = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function json(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function text(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value, 'utf8')
}

function packageMetadata(name: string, license?: string, privatePackage = false) {
  return {
    name,
    version: '1.0.0',
    ...(license === undefined ? {} : { license }),
    ...(privatePackage ? { private: true } : {}),
    type: 'module',
  }
}

function extension(
  root: string,
  path: string,
  name: string,
  publisher: string,
  id: string,
  license: string,
) {
  json(join(root, path, 'package.json'), {
    ...packageMetadata(name, license),
    modkit: { schemaVersion: 1, publisher, id, contributionManifests: ['./contributions/*.json'] },
  })
  json(join(root, path, 'contributions', 'codec.json'), {
    schemaVersion: 1,
    id: `${publisher}/${id}-codec`,
    contract: { id: 'modkit/codec-contribution', major: 1 },
    spec: {},
  })
  text(join(root, path, 'LICENSE.md'), `${license}\nhttps://example.invalid/license \n`)
  text(join(root, path, 'src', 'linked.js'), `export const extensionId = '${publisher}/${id}'\n`)
}

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'x3-release-rc-test-'))
  temporaryRoots.push(parent)
  const root = join(parent, 'repo')
  mkdirSync(root, { recursive: true })
  const images = READY_APP_EXTENSIONS.images
  if (images === undefined) throw new Error('the fixture requires the images extension family')
  json(join(root, 'config', 'build-composition.json'), {
    schemaVersion: 1,
    bundledBaseRoots: ['extensions'],
    extensionSets: { release: ['images'] },
    releaseSet: 'release',
  })

  const active = [
    ['common-documents', []],
    ['headless-mod-ci', []],
    ['universal-asset-explorer', ['images']],
  ].map(([id, extensionFamilies]) => ({
    id,
    introducedInClosure: 'mk3-ga',
    status: 'available',
    extensionFamilies,
    serviceProviders: [],
  }))
  json(join(root, 'migration', 'product-profiles.json'), {
    schemaVersion: 'product-profiles-1',
    presets: [...active],
  })
  json(join(root, 'apps', 'vscode', 'generated', 'bundled-catalog.json'), {
    schemaVersion: 1,
    roots: [
      {
        name: 'images',
        directory: 'images',
        declared: true,
        coordinate: 'modkit/images',
        contributions: [...images.contributions].sort(),
        digest: 'pending',
      },
    ],
  })
  text(join(root, 'apps', 'electron', 'generated', 'bundled-catalog.cjs'), 'module.exports=[]\n')
  text(join(root, 'apps', 'web', 'generated', 'extension-catalog.js'), 'export const catalog=[]\n')
  text(join(root, 'scripts', 'app-extension-sets.mjs'), 'export const fixture=true\n')
  text(join(root, 'scripts', 'release', 'INSTALL.md'), '# Fixture install guide\n')
  text(
    join(root, 'licenses', 'MIT.txt'),
    'MIT License\n\nPermission is hereby granted for this fixture.\n',
  )

  extension(root, 'extensions/images', 'modkit-extension-images', 'modkit', 'images', 'MIT')
  extension(root, 'external/alpha', 'fixture-alpha', 'example.test', 'alpha', 'MIT')
  const catalogPath = join(root, 'apps', 'vscode', 'generated', 'bundled-catalog.json')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  catalog.roots[0].digest = canonicalExtensionDigest(root, 'extensions/images')
  json(catalogPath, catalog)
  for (const app of [
    ['automation-host', '@modkit/automation-host'],
    ['electron', '@modkit/electron-app'],
    ['cli', '@modkit/modkit-cli'],
    ['vscode', 'modkit.modkit'],
    ['server', '@modkit/server'],
    ['web', '@modkit/web-app'],
  ] as const) {
    json(join(root, 'apps', app[0], 'package.json'), packageMetadata(app[1], undefined, true))
  }
  json(join(root, 'apps', 'vscode', 'package.nls.json'), {
    'extension.displayName': 'Modkit MK3',
  })
  json(join(root, 'apps', 'vscode', 'package.nls.ru.json'), {
    'extension.displayName': 'Modkit MK3',
  })
  text(join(root, 'apps', 'cli', 'dist', 'main.js'), 'export const main = true\n')
  const cliBytes = readFileSync(join(root, 'apps', 'cli', 'dist', 'main.js'))
  json(join(root, 'scripts', 'bundle-hashes.json'), {
    'apps/cli/dist/main.js': createHash('sha256').update(cliBytes).digest('hex'),
  })
  json(join(root, 'package.json'), packageMetadata('@modkit/workspace-root', undefined, true))
  text(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  text(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  return { parent, root }
}

function outputFiles(root: string) {
  const files = new Map<string, Buffer>()
  const walk = (directory: string, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, relative)
      else files.set(relative, readFileSync(path))
    }
  }
  walk(root)
  return files
}

describe('focused local RC artifacts', () => {
  it('builds byte-identical unsigned outputs and signs/verifies with an external Ed25519 key', () => {
    const { parent, root } = fixture()
    const first = join(parent, 'first')
    const second = join(parent, 'second')
    const firstBuild = buildRc({ repoRoot: root, outDir: first })
    buildRc({ repoRoot: root, outDir: second })

    expect(firstBuild.manifest.composition.externalExtensions).toEqual([])

    const firstFiles = outputFiles(first)
    const secondFiles = outputFiles(second)
    expect([...secondFiles.keys()].sort()).toEqual([...firstFiles.keys()].sort())
    for (const [name, bytes] of firstFiles) expect(secondFiles.get(name), name).toEqual(bytes)
    expect(readFileSync(join(first, 'LICENSE-NOTICES.txt'), 'utf8')).not.toMatch(/[ \t]+$/mu)
    expect(readFileSync(join(first, 'LICENSE-NOTICES.txt'), 'utf8')).toContain(
      'License document: licenses/MIT.txt',
    )
    const sbom = JSON.parse(readFileSync(join(first, 'sbom.cdx.json'), 'utf8'))
    expect(
      sbom.components
        .filter((component: { name: string }) => component.name === '@modkit/workspace-root')
        .every((component: { licenses?: unknown }) => component.licenses === undefined),
    ).toBe(true)
    expect(readFileSync(join(first, 'artifacts', 'modkit-common.tar'), 'utf8')).toContain(
      'licenses/MIT.txt',
    )
    const platformArtifact = readFileSync(join(first, 'artifacts', 'modkit-platform.tar'), 'utf8')
    expect(platformArtifact).toContain('licenses/MIT.txt')
    expect(platformArtifact).toContain('apps/vscode/package.nls.json')
    expect(platformArtifact).toContain('apps/vscode/package.nls.ru.json')

    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const privatePath = join(parent, 'local-private.pem')
    const publicPath = join(parent, 'local-public.pem')
    writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }))
    const signed = join(parent, 'signed')
    buildRc({ repoRoot: root, outDir: signed, signingKeyPath: privatePath })
    expect(verifyRc({ outDir: signed, publicKeyPath: publicPath })).toEqual({
      state: 'verified-signed',
      artifactCount: 2,
    })
    const signatureText = readFileSync(join(signed, 'release-signature.json'), 'utf8')
    expect(signatureText).not.toContain(
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    )

    const artifact = join(signed, 'artifacts', 'modkit-common.tar')
    const originalArtifact = readFileSync(artifact)
    writeFileSync(artifact, Buffer.concat([originalArtifact, Buffer.from('tamper')]))
    expect(() => verifyRc({ outDir: signed, publicKeyPath: publicPath })).toThrow(
      /release artifact digest mismatch/u,
    )
    writeFileSync(artifact, originalArtifact)
    const manifest = join(signed, 'release-manifest.json')
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('local-rc', 'local-rx'))
    expect(() => verifyRc({ outDir: signed, publicKeyPath: publicPath })).toThrow(
      /signed release manifest digest mismatch/u,
    )

    const inRepoKey = join(root, 'private.pem')
    writeFileSync(inRepoKey, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    expect(() =>
      buildRc({ repoRoot: root, outDir: join(parent, 'unsafe'), signingKeyPath: inRepoKey }),
    ).toThrow(/private key must be passed from outside the repository/u)
  })

  it('fails closed on missing package licenses', () => {
    const { parent, root } = fixture()
    const packagePath = join(root, 'extensions', 'images', 'package.json')
    const metadata = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>
    delete metadata.license
    metadata.private = true
    json(packagePath, metadata)
    const catalogPath = join(root, 'apps', 'vscode', 'generated', 'bundled-catalog.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.roots[0].digest = canonicalExtensionDigest(root, 'extensions/images')
    json(catalogPath, catalog)
    expect(() => buildRc({ repoRoot: root, outDir: join(parent, 'missing-license') })).toThrow(
      /release component has no declared license: extensions\/images\/package.json/u,
    )
  })

  it('fails closed on unknown first-party license declarations', () => {
    const { parent, root } = fixture()
    const packagePath = join(root, 'extensions', 'images', 'package.json')
    const metadata = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>
    metadata.license = 'LicenseRef-Unknown'
    json(packagePath, metadata)
    const catalogPath = join(root, 'apps', 'vscode', 'generated', 'bundled-catalog.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.roots[0].digest = canonicalExtensionDigest(root, 'extensions/images')
    json(catalogPath, catalog)
    expect(() => buildRc({ repoRoot: root, outDir: join(parent, 'unknown-license') })).toThrow(
      /unsupported first-party license LicenseRef-Unknown/u,
    )
  })

  it('rejects a stale generated catalog', () => {
    const { parent, root } = fixture()
    const catalogPath = join(root, 'apps', 'vscode', 'generated', 'bundled-catalog.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.roots[0].digest = 'sha256:stale'
    json(catalogPath, catalog)
    expect(() => buildRc({ repoRoot: root, outDir: join(parent, 'stale-catalog') })).toThrow(
      /generated extension catalog digest is stale for extensions\/images/u,
    )
  })

  it('keeps roots outside the selected composition out of every artifact', () => {
    const { parent, root } = fixture()
    const output = join(parent, 'focused')
    const { manifest } = buildRc({ repoRoot: root, outDir: output })
    const rendered = JSON.stringify(manifest)
    expect(rendered).not.toContain('external/alpha')
    for (const artifact of manifest.artifacts) {
      const bytes = readFileSync(join(output, artifact.file)).toString('utf8')
      expect(bytes).not.toContain('external/alpha')
    }

    const catalogPath = join(root, 'apps', 'vscode', 'generated', 'bundled-catalog.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.roots.push({ name: 'alpha', directory: '../../external/alpha', digest: 'sha256:bad' })
    json(catalogPath, catalog)
    const second = buildRc({ repoRoot: root, outDir: join(parent, 'unselected') })
    expect(JSON.stringify(second.manifest)).not.toContain('external/alpha')
  })

  it('resolves nested npm dependencies from the logical pnpm package link', () => {
    const { parent, root } = fixture()
    const appRoot = join(root, 'apps', 'cli')
    const pnpmNodeModules = join(
      parent,
      'external-pnpm-store',
      'node_modules',
      '.pnpm',
      'ajv@8.17.1',
      'node_modules',
    )
    const ajvStoreRoot = join(pnpmNodeModules, 'ajv')
    const ajvLogicalRoot = join(appRoot, 'node_modules', 'ajv')
    const fastRoot = join(pnpmNodeModules, 'fast-deep-equal')
    json(join(appRoot, 'package.json'), {
      ...packageMetadata('@modkit/modkit-cli', undefined, true),
      dependencies: { ajv: '8.17.1' },
    })
    json(join(ajvStoreRoot, 'package.json'), {
      ...packageMetadata('ajv', 'MIT'),
      version: '8.17.1',
      dependencies: { 'fast-deep-equal': '3.1.3' },
    })
    json(join(fastRoot, 'package.json'), {
      ...packageMetadata('fast-deep-equal', 'MIT'),
      version: '3.1.3',
    })
    mkdirSync(dirname(ajvLogicalRoot), { recursive: true })
    symlinkSync(ajvStoreRoot, ajvLogicalRoot, 'junction')

    const { sbomBytes } = buildLicenseDocuments({
      repoRoot: root,
      releaseVersion: '1.0.0',
      artifacts: [
        {
          id: 'platform',
          entries: new Map([
            ['apps/cli/package.json', readFileSync(join(appRoot, 'package.json'))],
          ]),
        },
      ],
    })

    const sbom = JSON.parse(sbomBytes.toString('utf8'))
    const refs = new Set(
      sbom.components.map((component: { 'bom-ref': string }) => component['bom-ref']),
    )
    expect(refs.has('pkg:npm/ajv@8.17.1')).toBe(true)
    expect(refs.has('pkg:npm/fast-deep-equal@3.1.3')).toBe(true)
  })

  it('ratchets manifest, SBOM and notices against two clean unsigned builds', () => {
    const { parent, root } = fixture()
    const generatedDir = join(parent, 'generated')
    expect(emitRcMetadata({ repoRoot: root, generatedDir })).toEqual({ state: 'emitted', count: 3 })
    expect(checkRc({ repoRoot: root, generatedDir })).toEqual({ state: 'checked', fileCount: 6 })
    writeFileSync(join(generatedDir, 'release-manifest.json'), '{}\n')
    expect(() => checkRc({ repoRoot: root, generatedDir })).toThrow(
      /generated release ratchet is stale: release-manifest.json/u,
    )
  })

  it('installs on an empty target, updates immutably and rolls back', async () => {
    const { parent, root } = fixture()
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const privatePath = join(parent, 'local-private.pem')
    const publicPath = join(parent, 'local-public.pem')
    writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }))
    const firstRc = join(parent, 'rc-1')
    const storeRoot = join(parent, 'clean-install-store')
    buildRc({ repoRoot: root, outDir: firstRc, signingKeyPath: privatePath })
    const first = installRc({ outDir: firstRc, storeRoot, publicKeyPath: publicPath })
    expect(activeRc({ storeRoot })).toEqual({
      manifestDigest: first.manifestDigest,
      root: first.root,
    })
    expect(existsSync(join(first.root, 'release', 'INSTALL.md'))).toBe(true)
    expect(existsSync(join(first.root, 'external'))).toBe(false)
    const firstManifest = JSON.parse(
      readFileSync(join(first.root, 'release', 'release-manifest.json'), 'utf8'),
    )
    expect(firstManifest.composition.externalExtensions).toEqual([])

    const cliPath = join(root, 'apps', 'cli', 'dist', 'main.js')
    text(cliPath, 'export const main = "v2"\n')
    json(join(root, 'scripts', 'bundle-hashes.json'), {
      'apps/cli/dist/main.js': createHash('sha256').update(readFileSync(cliPath)).digest('hex'),
    })
    const secondRc = join(parent, 'rc-2')
    buildRc({ repoRoot: root, outDir: secondRc, signingKeyPath: privatePath })
    const second = installRc({ outDir: secondRc, storeRoot, publicKeyPath: publicPath })
    expect(second.manifestDigest).not.toBe(first.manifestDigest)
    expect(activeRc({ storeRoot })?.root).toBe(second.root)
    expect(existsSync(first.root)).toBe(true)

    const rolledBack = rollbackRc({ storeRoot })
    expect(rolledBack.manifestDigest).toBe(first.manifestDigest)
    expect(activeRc({ storeRoot })?.root).toBe(first.root)
  })
})
