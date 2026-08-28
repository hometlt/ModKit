import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

import { READY_APP_EXTENSIONS } from '../app-extension-sets.mjs'
import {
  buildRc,
  canonicalExtensionDigest,
  checkRc,
  emitRcMetadata,
  verifyRc,
} from '../release/rc.mjs'
import { activeRc, installRc, rollbackRc } from '../release/install-rc.mjs'

const temporaryRoots: string[] = []
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

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
    contract: { id: 'org.modkitx/codec-contribution', major: 1 },
    spec: {},
  })
  text(join(root, path, 'src', 'linked.js'), `export const extensionId = '${publisher}/${id}'\n`)
}

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'x3-release-rc-test-'))
  temporaryRoots.push(parent)
  const root = join(parent, 'repo')
  mkdirSync(root, { recursive: true })
  const images = READY_APP_EXTENSIONS.images
  if (images === undefined) throw new Error('the fixture requires the images extension family')

  const active = [
    ['common-documents', []],
    ['headless-mod-ci', []],
    ['sc2-mod-studio', ['blizzard-starcraft2']],
    ['universal-asset-explorer', ['images']],
    ['warzone-2100-studio', ['opensource-warzone-2100']],
  ].map(([id, extensionFamilies]) => ({
    id,
    introducedInClosure: 'mk3-ga',
    status: 'available',
    extensionFamilies,
    serviceProviders: [],
  }))
  json(join(root, 'migration', 'product-profiles.json'), {
    schemaVersion: 'product-profiles-1',
    presets: [
      ...active,
      {
        id: 'cnc-sage-studio',
        introducedInClosure: 'mk3-deferred-games',
        status: 'available',
        extensionFamilies: ['ea-sage'],
        serviceProviders: [],
      },
      {
        id: 'bar-spring-studio',
        introducedInClosure: 'mk3-deferred-games',
        status: 'planned',
        extensionFamilies: [],
        serviceProviders: [],
      },
    ],
  })
  json(join(root, 'apps', 'modkit-vscode', 'generated', 'bundled-catalog.json'), {
    schemaVersion: 1,
    roots: [
      {
        name: 'images',
        directory: 'common/images',
        declared: true,
        coordinate: 'org.modkitx/images',
        contributions: [...images.contributions].sort(),
        digest: 'pending',
      },
    ],
  })
  text(join(root, 'apps', 'electron', 'generated', 'bundled-catalog.cjs'), 'module.exports=[]\n')
  text(join(root, 'apps', 'web', 'generated', 'extension-catalog.js'), 'export const catalog=[]\n')
  text(join(root, 'scripts', 'app-extension-sets.mjs'), 'export const fixture=true\n')
  text(join(root, 'scripts', 'release', 'INSTALL.md'), '# Fixture install guide\n')

  extension(
    root,
    'extensions/common/images',
    'modkit-extension-x3-images',
    'org.modkitx',
    'images',
    'MIT',
  )
  extension(
    root,
    'extensions/blizzard/starcraft2',
    'modkit-extension-x3-blizzard-starcraft2',
    'org.modkitx.blizzard',
    'starcraft2',
    'MIT',
  )
  extension(
    root,
    'extensions/opensource/warzone-2100',
    'modkit-extension-x3-opensource-warzone-2100',
    'org.modkitx.opensource',
    'warzone-2100',
    'GPL-2.0-or-later',
  )

  const catalogPath = join(root, 'apps', 'modkit-vscode', 'generated', 'bundled-catalog.json')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  catalog.roots[0].digest = canonicalExtensionDigest(root, 'extensions/common/images')
  json(catalogPath, catalog)
  extension(
    root,
    'extensions/ea/sage',
    'modkit-extension-x3-ea-sage',
    'org.modkitx.ea',
    'sage',
    'MIT',
  )
  extension(
    root,
    'extensions/opensource/spring',
    'modkit-extension-x3-opensource-spring',
    'org.modkitx.opensource',
    'spring',
    'GPL-2.0-or-later',
  )

  for (const app of [
    ['automation-host', '@modkitx-x3/automation-host'],
    ['electron', '@modkitx-x3/electron-app'],
    ['modkit-cli', '@modkitx-x3/modkit-cli'],
    ['modkit-vscode', 'modkitx.modkit'],
    ['server', '@modkitx-x3/server'],
    ['web', '@modkitx-x3/web-app'],
  ] as const) {
    json(join(root, 'apps', app[0], 'package.json'), packageMetadata(app[1], undefined, true))
  }
  text(join(root, 'apps', 'modkit-cli', 'dist', 'main.js'), 'export const main = true\n')
  const cliBytes = readFileSync(join(root, 'apps', 'modkit-cli', 'dist', 'main.js'))
  json(join(root, 'scripts', 'bundle-hashes.json'), {
    'apps/modkit-cli/dist/main.js': createHash('sha256').update(cliBytes).digest('hex'),
  })
  json(join(root, 'package.json'), packageMetadata('@modkitx-x3/workspace-root', undefined, true))
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

    const sc2 = firstBuild.manifest.artifacts.find(artifact => artifact.id === 'sc2-mod-studio')
    expect(sc2?.catalog).toEqual([
      expect.objectContaining({
        root: 'extensions/blizzard/starcraft2',
        sourceDigest: canonicalExtensionDigest(root, 'extensions/blizzard/starcraft2'),
      }),
    ])

    const firstFiles = outputFiles(first)
    const secondFiles = outputFiles(second)
    expect([...secondFiles.keys()].sort()).toEqual([...firstFiles.keys()].sort())
    for (const [name, bytes] of firstFiles) expect(secondFiles.get(name), name).toEqual(bytes)

    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const privatePath = join(parent, 'local-private.pem')
    const publicPath = join(parent, 'local-public.pem')
    writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }))
    const signed = join(parent, 'signed')
    buildRc({ repoRoot: root, outDir: signed, signingKeyPath: privatePath })
    expect(verifyRc({ outDir: signed, publicKeyPath: publicPath })).toEqual({
      state: 'verified-signed',
      artifactCount: 4,
    })
    const signatureText = readFileSync(join(signed, 'release-signature.json'), 'utf8')
    expect(signatureText).not.toContain(
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    )

    const artifact = join(signed, 'artifacts', 'modkitx-common.tar')
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
    const packagePath = join(root, 'extensions', 'common', 'images', 'package.json')
    const metadata = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>
    delete metadata.license
    metadata.private = true
    json(packagePath, metadata)
    const catalogPath = join(root, 'apps', 'modkit-vscode', 'generated', 'bundled-catalog.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.roots[0].digest = canonicalExtensionDigest(root, 'extensions/common/images')
    json(catalogPath, catalog)
    expect(() => buildRc({ repoRoot: root, outDir: join(parent, 'missing-license') })).toThrow(
      /release component has no declared license: extensions\/common\/images\/package.json/u,
    )
  })

  it('matches the public host digest and rejects a stale generated catalog', async () => {
    const sc2Root = join(repoRoot, 'extensions', 'blizzard', 'starcraft2')
    const loaded = await loadExtensionDirectory(sc2Root)
    expect(canonicalExtensionDigest(repoRoot, 'extensions/blizzard/starcraft2')).toBe(
      loaded.artifact.artifactDigest,
    )

    const { parent, root } = fixture()
    const catalogPath = join(root, 'apps', 'modkit-vscode', 'generated', 'bundled-catalog.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.roots[0].digest = 'sha256:stale'
    json(catalogPath, catalog)
    expect(() => buildRc({ repoRoot: root, outDir: join(parent, 'stale-catalog') })).toThrow(
      /generated extension catalog digest is stale for extensions\/common\/images/u,
    )
  })

  it('keeps C&C and Spring after the STOP out of every focused artifact', () => {
    const { parent, root } = fixture()
    const output = join(parent, 'focused')
    const { manifest } = buildRc({ repoRoot: root, outDir: output })
    const rendered = JSON.stringify(manifest)
    expect(rendered).toContain('cnc-sage-studio')
    expect(rendered).toContain('bar-spring-studio')
    expect(rendered).not.toContain('extensions/ea/')
    expect(rendered).not.toContain('extensions/opensource/spring')
    for (const artifact of manifest.artifacts) {
      const bytes = readFileSync(join(output, artifact.file)).toString('utf8')
      expect(bytes).not.toContain('extensions/ea/')
      expect(bytes).not.toContain('extensions/opensource/spring')
    }

    const catalogPath = join(root, 'apps', 'modkit-vscode', 'generated', 'bundled-catalog.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.roots.push({ name: 'sage', directory: 'ea/sage', digest: 'sha256:bad' })
    json(catalogPath, catalog)
    expect(() => buildRc({ repoRoot: root, outDir: join(parent, 'leaked') })).toThrow(
      /deferred C&C or Spring extension entered the focused RC/u,
    )
  })

  it('ratchets manifest, SBOM and notices against two clean unsigned builds', () => {
    const { parent, root } = fixture()
    const generatedDir = join(parent, 'generated')
    expect(emitRcMetadata({ repoRoot: root, generatedDir })).toEqual({ state: 'emitted', count: 3 })
    expect(checkRc({ repoRoot: root, generatedDir })).toEqual({ state: 'checked', fileCount: 8 })
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
    const installedSc2 = await loadExtensionDirectory(
      join(first.root, 'extensions', 'blizzard', 'starcraft2'),
    )
    const installedMetadata = installedSc2.containers.packageJson as {
      readonly modkit?: { readonly publisher?: string; readonly id?: string }
    }
    expect(installedMetadata.modkit).toMatchObject({
      publisher: 'org.modkitx.blizzard',
      id: 'starcraft2',
    })

    text(
      join(root, 'extensions', 'blizzard', 'starcraft2', 'src', 'linked.js'),
      "export const extensionId = 'org.modkitx.blizzard/starcraft2-v2'\n",
    )
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
