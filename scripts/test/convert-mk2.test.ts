import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildInventory, createHostContributionContractRegistry } from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(scriptsDir, '..')
const converter = join(scriptsDir, 'convert-mk2.mjs')
const fixtureRoot = join(scriptsDir, 'test', 'fixtures', 'mk2')
const committedTree = join(repoRoot, 'extensions', 'mk2')
const scratch = mkdtempSync(join(tmpdir(), 'convert-mk2-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

interface ConversionJson {
  readonly summary: {
    readonly rework: boolean
    readonly extensions: number
    readonly converted: number
    readonly skipped: number
    readonly handPorted: number
    readonly byVerdict: Readonly<Record<string, number>>
  }
  readonly converted: readonly {
    readonly contributionId: string
    readonly verdict: string
    readonly signatures: number
    readonly notes: readonly string[]
  }[]
  readonly skipped: readonly {
    readonly contributionId: string
    readonly verdict: string
    readonly reason: string
  }[]
  readonly handPorted: readonly string[]
  readonly drift: {
    readonly added: readonly string[]
    readonly changed: readonly string[]
    readonly removed: readonly string[]
  }
}

let runs = 0

function run(
  out: string,
  extra: readonly string[] = [],
): { status: number | null; stderr: string; stdout: string; json: ConversionJson } {
  runs += 1
  const jsonPath = join(scratch, `run-${runs}.json`)
  const result = spawnSync(
    process.execPath,
    [converter, '--mk2-root', fixtureRoot, '--out', out, '--json', jsonPath, '--quiet', ...extra],
    { encoding: 'utf8' },
  )
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    json: JSON.parse(readFileSync(jsonPath, 'utf8')) as ConversionJson,
  }
}

function listFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

async function inventoryOf(directory: string) {
  const input = await loadExtensionDirectory(directory)
  return buildInventory([input], createHostContributionContractRegistry())
}

describe('MK2 → MK3 converter (OPUS-MK2-01 task A)', () => {
  const out = join(scratch, 'default')
  const first = run(out)

  it('emits one MK3 extension per v1 container and only for mechanical verdicts', () => {
    expect(first.status).toBe(0)
    expect(first.json.summary).toMatchObject({
      rework: false,
      extensions: 1,
      converted: 2,
      byVerdict: { mechanical: 2 },
    })
    expect(listFiles(out)).toEqual([
      'acme-pack/README.md',
      'acme-pack/contributions/codec-namespaced.json',
      'acme-pack/contributions/codec-tile.json',
      'acme-pack/package.json',
      'acme-pack/src/namespaced/codec.js',
      'acme-pack/src/tile/codec.js',
    ])
  })

  it('carries the v1 fields the report maps and derives nothing it cannot justify', () => {
    const tile = JSON.parse(
      readFileSync(join(out, 'acme-pack', 'contributions', 'codec-tile.json'), 'utf8'),
    ) as Record<string, never>
    expect(tile).toMatchObject({
      schemaVersion: 1,
      contract: { id: 'org.modkitx/codec-contribution', major: 1 },
      id: 'org.acme/tile',
      displayName: 'Acme tile image',
      status: 'supported',
      // 27 §0.5.1: the v1 `version` is dropped, it belongs to the extension artifact
      limitations: ['Palette animation is inventoried but not applied.'],
      runtimeVariants: [
        {
          variantId: 'trusted-node',
          entrypoint: './src/tile/codec.js',
          executionProfile: 'trusted-in-process',
          requestedPermissionClasses: ['read-source'],
        },
        {
          variantId: 'portable',
          target: { environments: ['browser-worker', 'node-worker'] },
          executionProfile: 'worker-brokered',
        },
      ],
      spec: {
        roles: ['media'],
        sourceTopology: 'single',
        match: {
          // leading dots stripped, case folded; ascii and hex magic both become S3 signatures
          extensions: ['til', 'tile'],
          signatures: [
            { from: 'start', offset: 0, bytesHex: '54494c45' },
            { from: 'start', offset: 4, bytesHex: '0a0d' },
          ],
        },
        probe: { kind: 'bytes', ranges: [{ from: 'start', length: 4096 }], maxBytes: 4096 },
        // v1 `state` is fidelity; only a stateless v1 trait becomes a will-expose claim
        traitDeclarations: [
          { id: 'content.binary', representation: 'source', presence: 'may-expose' },
          { id: 'image.raster', representation: 'source', presence: 'will-expose' },
        ],
        implementationTier: { claimed: 1 },
      },
    })
    expect('version' in tile).toBe(false)
    expect('dependsOn' in tile).toBe(false)

    const namespaced = JSON.parse(
      readFileSync(join(out, 'acme-pack', 'contributions', 'codec-namespaced.json'), 'utf8'),
    ) as Record<string, never>
    expect(namespaced).toMatchObject({
      runtimeVariants: [
        // G4: the coarse v1 `filesystem` permission expands, and read-source is always requested
        { requestedPermissionClasses: ['filesystem-read', 'filesystem-write', 'read-source'] },
        { requestedPermissionClasses: ['filesystem-read', 'filesystem-write', 'read-source'] },
      ],
      spec: {
        sourceTopology: 'namespace',
        probe: { kind: 'namespace', maxEntries: 100000, maxDepth: 64, maxPathBytes: 4096 },
      },
    })

    // 27 §0.2: the authored container is package.json#modkit, carrying the v1 coordinate
    const pkg = JSON.parse(readFileSync(join(out, 'acme-pack', 'package.json'), 'utf8')) as Record<
      string,
      never
    >
    expect(pkg).toMatchObject({
      version: '2.4.0',
      license: 'Apache-2.0',
      modkit: {
        schemaVersion: 1,
        publisher: 'org.acme',
        id: 'pack',
        contributionManifests: ['./contributions/*.json'],
      },
    })
  })

  it('generates an honest probe: real magic compares bytes, no magic claims nothing', () => {
    const tile = readFileSync(join(out, 'acme-pack', 'src', 'tile', 'codec.js'), 'utf8')
    expect(tile).toContain('@generated by scripts/convert-mk2.mjs')
    expect(tile).toContain('0x54, 0x49, 0x4c, 0x45')
    expect(tile).toContain('confidence: 0.99')
    expect(tile).toContain("code: 'x3.mk2/port-pending'")

    const namespaced = readFileSync(join(out, 'acme-pack', 'src', 'namespaced', 'codec.js'), 'utf8')
    expect(namespaced).not.toContain('confidence: 0.99')
    expect(namespaced).toContain('confidence: 0')
    expect(namespaced).toContain('TODO(port)')
  })

  it('skips what it cannot convert and says why — never a stub', () => {
    const reasons = new Map(first.json.skipped.map(item => [item.contributionId, item]))
    expect(reasons.get('org.acme/writer')).toMatchObject({
      verdict: 'needs new contract',
      reason: 'needs new contract',
    })
    expect(reasons.get('org.acme/exotic')).toMatchObject({
      verdict: 'convertible with rework',
      reason: 'convertible with rework',
    })
    // mechanical by verdict, but `map` has no bundled representation contract: 27 §6 forbids
    // inventing one, so the converter refuses instead of guessing.
    expect(reasons.get('org.acme/atlas')?.verdict).toBe('mechanical')
    expect(reasons.get('org.acme/atlas')?.reason).toContain('does not invent one')
    expect(listFiles(out).some(path => path.includes('writer') || path.includes('atlas'))).toBe(
      false,
    )
  })

  it('is byte-stable on a re-run and --check reports drift', () => {
    const before = listFiles(out).map(path => readFileSync(join(out, path), 'utf8'))
    const second = run(out)
    expect(second.status).toBe(0)
    expect(second.json.drift).toEqual({ added: [], changed: [], removed: [] })
    expect(listFiles(out).map(path => readFileSync(join(out, path), 'utf8'))).toEqual(before)

    const clean = run(out, ['--check'])
    expect(clean.status).toBe(0)

    const manifest = join(out, 'acme-pack', 'contributions', 'codec-tile.json')
    const original = readFileSync(manifest, 'utf8')
    writeFileSync(manifest, original.replace('"Acme tile image"', '"Edited by hand"'))
    const drifted = run(out, ['--check'])
    expect(drifted.status).toBe(1)
    expect(drifted.stderr).toContain('acme-pack/contributions/codec-tile.json')
    writeFileSync(manifest, original)
  })

  it('never overwrites a hand-ported module, and does not call it drift', () => {
    const module = join(out, 'acme-pack', 'src', 'tile', 'codec.js')
    const ported = '// hand-ported for the acceptance harness\nexport const abiVersion = 1\n'
    writeFileSync(module, ported)

    const rerun = run(out)
    expect(rerun.status).toBe(0)
    expect(readFileSync(module, 'utf8')).toBe(ported)
    expect(rerun.json.handPorted).toEqual(['acme-pack/src/tile/codec.js'])
    expect(rerun.json.drift.changed).not.toContain('acme-pack/src/tile/codec.js')

    const checked = run(out, ['--check'])
    expect(checked.status).toBe(0)
    rmSync(module)
    run(out) // restore the generated module for the remaining assertions
  })

  it('--rework adds the renamed/split verdicts and records the AC §5 rename (task A2)', () => {
    const reworkOut = join(scratch, 'rework')
    const rework = run(reworkOut, ['--rework'])
    expect(rework.status).toBe(0)
    expect(rework.json.summary.byVerdict).toEqual({ mechanical: 2, 'convertible with rework': 1 })
    const exotic = rework.json.converted.find(item => item.contributionId === 'org.acme/exotic')
    expect(exotic?.verdict).toBe('convertible with rework')
    expect(exotic?.notes.some(note => note.includes('image.compressed-read'))).toBe(true)
  })

  it('every generated manifest is inventory-eligible against the production registry', async () => {
    const inventory = await inventoryOf(join(out, 'acme-pack'))
    expect(inventory.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const contributions = inventory.extensions.flatMap(extension => extension.contributions)
    expect(contributions).toHaveLength(2)
    for (const contribution of contributions) {
      expect(contribution.diagnostics.filter(d => d.severity === 'error')).toEqual([])
      expect(contribution.specState).toBe('validated')
      expect(contribution.inventoryEligible).toBe(true)
    }
  })

  it('the committed extensions/mk2 tree is inventory-eligible in full', async () => {
    const directories = readdirSync(committedTree, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(committedTree, entry.name))
    expect(directories.length).toBeGreaterThan(0)
    let contributions = 0
    for (const directory of directories) {
      const inventory = await inventoryOf(directory)
      expect(inventory.diagnostics.filter(d => d.severity === 'error')).toEqual([])
      for (const extension of inventory.extensions) {
        for (const contribution of extension.contributions) {
          contributions += 1
          expect({
            path: `${directory}/${contribution.path}`,
            state: contribution.specState,
            eligible: contribution.inventoryEligible,
          }).toEqual({
            path: `${directory}/${contribution.path}`,
            state: 'validated',
            eligible: true,
          })
        }
      }
    }
    // OPUS-MK2-01 definition of done: at least 100 mechanical v1 manifests convert validly.
    expect(contributions).toBeGreaterThanOrEqual(100)
  })
})
