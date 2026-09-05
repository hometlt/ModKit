import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const scratches: string[] = []

afterEach(() => {
  for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true })
})

const base = {
  schemaVersion: 1,
  contract: { id: 'modkit/codec-contribution', major: 1 },
  displayName: 'fixture',
  spec: {
    artifactStages: ['authored'],
    openIntents: ['probe', 'full'],
    representations: [
      { id: 'native', contract: 'org.example/native', major: 1, stage: 'authored', lossy: false },
    ],
    implementationTier: { claimed: 1 },
    budgets: {
      maxInputBytes: '1024',
      maxDepth: 8,
      maxNodes: 8,
      maxScalarBytes: 1024,
      maxDiagnostics: 8,
    },
  },
}

function fixture(providerOverrides: Record<string, unknown> = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'modkit-containers-check-'))
  scratches.push(scratch)
  const provider = {
    ...base,
    id: 'org.example/carrier',
    spec: {
      ...base.spec,
      formatRefs: [{ formatId: 'carrier', label: 'Carrier' }],
      roles: ['container'],
      sourceTopology: 'single',
      match: {
        extensions: ['car'],
        signatures: [{ from: 'start', offset: 0, bytesHex: '43415252' }],
      },
      probe: { kind: 'bytes', ranges: [{ from: 'start', length: 4 }], maxBytes: 4 },
      publishesDataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
      operations: [
        {
          id: 'container.extract',
          handlerId: 'extract',
          mutatesSource: false,
          outputKinds: ['bytes'],
        },
        {
          id: 'container.pack',
          handlerId: 'pack',
          mutatesSource: true,
          outputKinds: ['edit-plan'],
        },
        { id: 'export.raw', handlerId: 'raw', mutatesSource: false, outputKinds: ['bytes'] },
      ],
      ...providerOverrides,
    },
  }
  const alias = {
    ...base,
    id: 'org.example/semantic',
    spec: {
      ...base.spec,
      formatRefs: [{ formatId: 'semantic', label: 'Semantic' }],
      roles: ['semantic'],
      sourceTopology: 'namespace',
      container: { formatId: 'carrier' },
      match: { extensions: ['car'] },
      probe: {
        kind: 'namespace',
        markers: ['marker'],
        maxEntries: 1,
        maxBytes: 16,
        maxDepth: 2,
        maxPathBytes: 32,
      },
      publishesDataSources: [],
      operations: [
        { id: 'edit.content', handlerId: 'edit', mutatesSource: true, outputKinds: ['edit-plan'] },
        { id: 'export.raw', handlerId: 'raw', mutatesSource: false, outputKinds: ['bytes'] },
      ],
    },
  }
  mkdirSync(join(scratch, 'contributions'))
  writeFileSync(join(scratch, 'contributions', 'provider.json'), JSON.stringify(provider))
  writeFileSync(join(scratch, 'contributions', 'alias.json'), JSON.stringify(alias))
  return scratch
}

function check(directory: string) {
  return spawnSync(
    process.execPath,
    [join(root, 'scripts', 'check-containers.mjs'), '--root', directory],
    { cwd: root, encoding: 'utf8' },
  )
}

describe('containers:check', () => {
  it('accepts one complete data-only carrier/semantic composition', () => {
    const result = check(fixture())
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('1 aliases, 1 container providers')
  })

  it('rejects a mutating alias when the carrier has no host pack seam', () => {
    const result = check(
      fixture({
        operations: [
          {
            id: 'container.extract',
            handlerId: 'extract',
            mutatesSource: false,
            outputKinds: ['bytes'],
          },
          { id: 'export.raw', handlerId: 'raw', mutatesSource: false, outputKinds: ['bytes'] },
        ],
      }),
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must publish container.pack -> edit-plan')
  })

  it('rejects an ambiguous provider set without importing executable modules', () => {
    const scratch = fixture()
    const provider = JSON.parse(
      readFileSync(join(scratch, 'contributions', 'provider.json'), 'utf8'),
    )
    provider.id = 'org.example/carrier-two'
    writeFileSync(join(scratch, 'contributions', 'provider-two.json'), JSON.stringify(provider))
    const result = check(scratch)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('has 2 providers; exactly one is required')
  })
})
