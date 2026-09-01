import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  IDENTITY_MIGRATION_RULES,
  migrateIdentityDocument,
  normalizeIdentifier,
} from '../migration/lib/identity-migration.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const cli = join(repoRoot, 'scripts', 'migration', 'migrate-identifiers.mjs')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'modkit-identity-migration-'))
  temporaryRoots.push(root)
  return root
}

function runCli(root: string, args: readonly string[]) {
  return spawnSync(process.execPath, [cli, '--root', root, ...args], { encoding: 'utf8' })
}

describe('identity migration mapping', () => {
  it('keeps the active identifier rename table declarative and ordered', () => {
    expect(IDENTITY_MIGRATION_RULES.map(rule => rule.id)).toEqual([
      'package-scope:modkitx-x3',
      'package-scope:modkitx',
      'game-id:starcraft-2',
      'game-id:warzone-2100',
      'vendor-extension:spring-recoil',
      'vendor-extension:warzone-2100',
      'vendor-contribution:legacy-warzone-2100',
      'vendor-contribution:intermediate-warzone-2100',
      'vendor-publisher:blizzard',
      'vendor-publisher:ea',
      'builtin-id:slash',
      'builtin-id:dotted',
      'source-id:blizzard',
      'source-id:ea',
      'source-id:opensource',
      'source-id:modkit',
    ])

    expect(normalizeIdentifier('@modkitx-x3/ui', { family: 'package' })).toMatchObject({
      value: '@modkit/ui',
      rule: 'package-scope:modkitx-x3',
    })
    expect(normalizeIdentifier('@modkitx/extension-manager', { family: 'package' })).toMatchObject({
      value: '@modkit/extension-manager',
      rule: 'package-scope:modkitx',
    })
    expect(normalizeIdentifier('org.modkitx/image-png')).toMatchObject({
      value: 'modkit/image-png',
      rule: 'builtin-id:slash',
    })
    expect(normalizeIdentifier('org.modkitx.ui/image-stage')).toMatchObject({
      value: 'modkit.ui/image-stage',
      rule: 'builtin-id:dotted',
    })
    expect(normalizeIdentifier('org.modkitx.blizzard/casc')).toMatchObject({
      value: 'blizzard/casc',
      rule: 'vendor-publisher:blizzard',
    })
    expect(normalizeIdentifier('org.modkitx.ea/sage-w3x')).toMatchObject({
      value: 'ea/sage-w3x',
      rule: 'vendor-publisher:ea',
    })
    expect(normalizeIdentifier('org.modkitx.opensource/spring')).toMatchObject({
      value: 'spring/recoil',
      rule: 'vendor-extension:spring-recoil',
    })
    expect(normalizeIdentifier('org.modkitx.opensource/warzone-2100')).toMatchObject({
      value: 'wz2100project/warzone-2100',
      rule: 'vendor-extension:warzone-2100',
    })
    expect(normalizeIdentifier('org.modkitx.opensource/warzone2100-map-semantic')).toMatchObject({
      value: 'wz2100project/warzone2100-map-semantic',
      rule: 'vendor-contribution:legacy-warzone-2100',
    })
    expect(normalizeIdentifier('modkit.opensource/warzone2100-data')).toMatchObject({
      value: 'wz2100project/warzone2100-data',
      rule: 'vendor-contribution:intermediate-warzone-2100',
    })
    expect(normalizeIdentifier('org.modkitx/starcraft-2')).toMatchObject({
      value: 'blizzard/starcraft-2',
      rule: 'game-id:starcraft-2',
    })
    expect(normalizeIdentifier('org.modkitx/warzone-2100')).toMatchObject({
      value: 'wz2100project/warzone-2100',
      rule: 'game-id:warzone-2100',
    })
  })

  it('migrates settings identity arrays and is idempotent', () => {
    const settings = {
      schemaVersion: 1,
      extensions: [
        { id: 'org.modkitx/images', path: '@modkitx-x3/ui', enabled: true },
        { id: 'org.modkitx.blizzard/casc', path: 'C:\\extensions\\casc', enabled: false },
      ],
      disabledExtensions: ['org.modkitx/archives'],
      disabledContributions: ['org.modkitx/image-png', 'org.modkitx.ui/image-stage'],
      gameInstallations: {
        'org.modkitx/starcraft-2': { configuredPaths: ['C:\\Games\\StarCraft II'] },
        'org.modkitx.opensource/warzone-2100': { configuredPaths: ['C:\\Games\\Warzone 2100'] },
      },
    }

    const migrated = migrateIdentityDocument(settings, { documentKind: 'settings' })
    expect(migrated.writable).toBe(true)
    expect(migrated.collisions).toEqual([])
    expect(migrated.document).toMatchObject({
      extensions: [
        { id: 'modkit/images', path: '@modkit/ui' },
        { id: 'blizzard/casc', path: 'C:\\extensions\\casc' },
      ],
      disabledExtensions: ['modkit/archives'],
      disabledContributions: ['modkit/image-png', 'modkit.ui/image-stage'],
      gameInstallations: {
        'blizzard/starcraft-2': { configuredPaths: ['C:\\Games\\StarCraft II'] },
        'wz2100project/warzone-2100': { configuredPaths: ['C:\\Games\\Warzone 2100'] },
      },
    })

    const second = migrateIdentityDocument(migrated.document, { documentKind: 'settings' })
    expect(second.changed).toBe(false)
    expect(second.document).toEqual(migrated.document)
  })

  it('reports collisions instead of folding legacy and current ids together', () => {
    const result = migrateIdentityDocument(
      {
        schemaVersion: 1,
        extensions: [
          { id: 'org.modkitx/images', path: '@modkitx-x3/ui', enabled: true },
          { id: 'modkit/images', path: '@modkit/ui', enabled: false },
        ],
        disabledContributions: ['org.modkitx/image-png', 'modkit/image-png'],
      },
      { documentKind: 'settings' },
    )

    expect(result.writable).toBe(false)
    expect(result.collisions).toEqual([
      {
        path: '$.extensions',
        target: 'modkit/images',
        sources: ['modkit/images', 'org.modkitx/images'],
        reason: 'settings extension entries would share one id',
      },
      {
        path: '$.disabledContributions',
        target: 'modkit/image-png',
        sources: ['modkit/image-png', 'org.modkitx/image-png'],
        reason: 'multiple identifiers normalize to one value',
      },
    ])
  })

  it('migrates lock and catalog references without entering sealed artifact snapshots', () => {
    const lock = migrateIdentityDocument(
      {
        schemaVersion: 1,
        extensions: [
          {
            id: 'org.modkitx.blizzard/casc',
            source: 'org.modkitx.blizzard',
            version: '1.0.0',
            digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
          {
            id: 'org.modkitx.opensource/spring',
            source: 'spring',
            version: '1.0.0',
            digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
        ],
      },
      { documentKind: 'extension-lock' },
    )
    expect(lock.document).toMatchObject({
      extensions: [
        { id: 'blizzard/casc', source: 'blizzard' },
        { id: 'spring/recoil', source: 'spring' },
      ],
    })

    const policyLock = migrateIdentityDocument(
      {
        schemaVersion: 1,
        entries: [
          {
            key: {
              contract: 'org.modkitx/codec-contribution',
              major: 1,
              normalizedRange: '*',
              requiredOutputs: [],
              preferredOutputs: [],
            },
            primary: {
              extension: 'org.modkitx/images',
              contributionId: 'org.modkitx/image-png',
              contractMajor: 1,
              offerId: 'default',
            },
            allowedFallbacks: [
              {
                extension: 'org.modkitx.blizzard/casc',
                contributionId: 'org.modkitx.blizzard/casc',
                contractMajor: 1,
                offerId: 'fallback',
              },
            ],
            resolverVersion: 1,
          },
        ],
      },
      { documentKind: 'policy-lock' },
    )
    expect(policyLock.document).toMatchObject({
      entries: [
        {
          key: { contract: 'modkit/codec-contribution' },
          primary: { extension: 'modkit/images', contributionId: 'modkit/image-png' },
          allowedFallbacks: [{ extension: 'blizzard/casc', contributionId: 'blizzard/casc' }],
        },
      ],
    })

    const catalog = migrateIdentityDocument(
      {
        schemaVersion: 1,
        roots: [
          {
            coordinate: 'org.modkitx/images',
            contributions: ['org.modkitx/image-png', 'org.modkitx.ui/image-stage'],
          },
        ],
        extensions: [
          {
            name: 'images',
            id: 'org.modkitx/images',
            containers: { packageJson: { modkit: { publisher: 'org.modkitx', id: 'images' } } },
            artifact: {
              artifactDigest:
                'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            },
          },
        ],
      },
      { documentKind: 'catalog' },
    )
    expect(catalog.document).toMatchObject({
      roots: [
        {
          coordinate: 'modkit/images',
          contributions: ['modkit/image-png', 'modkit.ui/image-stage'],
        },
      ],
      extensions: [{ id: 'modkit/images' }],
    })
    expect(catalog.skippedReferences).toEqual([
      { path: '$.extensions[0].containers', reason: 'sealed artifact snapshot' },
    ])
  })

  it('audits by default and skips historical report paths even with --write', () => {
    const root = tempRoot()
    const lockPath = join(root, 'modkit.extensions.lock.json')
    const lockText = `${JSON.stringify(
      {
        schemaVersion: 1,
        extensions: [{ id: 'org.modkitx.blizzard/casc', source: 'org.modkitx.blizzard' }],
      },
      null,
      2,
    )}\n`
    writeFileSync(lockPath, lockText, 'utf8')

    const auditReportPath = join(root, 'identity-audit.json')
    const audit = runCli(root, [
      '--audit',
      '--json',
      auditReportPath,
      'modkit.extensions.lock.json',
    ])
    expect(audit.status, audit.stderr).toBe(0)
    const auditReport = JSON.parse(audit.stdout)
    expect(auditReport.summary).toMatchObject({ wouldChange: 1, changed: 0 })
    expect(auditReport.files[0].status).toBe('would-change')
    expect(readFileSync(lockPath, 'utf8')).toBe(lockText)

    mkdirSync(join(root, 'reports', 'block20'), { recursive: true })
    const reportPath = join(root, 'reports', 'block20', 'receipt.json')
    const reportText = `${JSON.stringify({ extensions: [{ id: 'org.modkitx/images' }] }, null, 2)}\n`
    writeFileSync(reportPath, reportText, 'utf8')

    const skippedReportPath = join(root, 'identity-skip.json')
    const skipped = runCli(root, [
      '--write',
      '--json',
      skippedReportPath,
      'reports/block20/receipt.json',
    ])
    expect(skipped.status, skipped.stderr).toBe(0)
    const skippedReport = JSON.parse(skipped.stdout)
    expect(skippedReport.files[0]).toMatchObject({
      status: 'skipped',
      reason: 'report/audit artifact',
    })
    expect(readFileSync(reportPath, 'utf8')).toBe(reportText)
  })
})
