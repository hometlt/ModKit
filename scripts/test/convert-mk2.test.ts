import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

interface CodecDebt {
  readonly lostPlanes: readonly { readonly plane: string; readonly entrypoint: string }[]
  readonly contractGaps: readonly string[]
  readonly renames: readonly { readonly from: string; readonly to: string }[]
  readonly converterDefaults: readonly string[]
  readonly droppedOperations: readonly string[]
  readonly needsSignatures: boolean
}

interface ConversionJson {
  readonly summary: {
    readonly rework: boolean
    readonly extensions: number
    readonly converted: number
    readonly skipped: number
    readonly handPorted: number
    readonly withNotes: number
    readonly needsSignatures: number
    readonly withSignatures: number
    readonly lostPlanes: number
    readonly ported: number
    readonly byVerdict: Readonly<Record<string, number>>
  }
  readonly converted: readonly {
    readonly contributionId: string
    readonly verdict: string
    readonly signatures: number
    readonly notes: readonly string[]
    readonly debt: CodecDebt
    readonly portState: string
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

/** The inert notes file the converter writes beside every converted extension (task D). */
interface ConversionNotes {
  readonly schemaVersion: number
  readonly source: { readonly repository: string; readonly manifests: readonly string[] }
  readonly verdict: string
  readonly codecs: Readonly<
    Record<string, CodecDebt & { readonly verdict: string; readonly portState: string }>
  >
}

interface EmittedSpec {
  readonly spec: {
    readonly match: {
      readonly pathGlobs?: readonly string[]
      readonly signatures?: readonly { readonly bytesHex: string }[]
    }
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

function committedExtensionDirectories(): string[] {
  return readdirSync(committedTree, { withFileTypes: true })
    .filter(
      entry => entry.isDirectory() && existsSync(join(committedTree, entry.name, 'package.json')),
    )
    .map(entry => entry.name)
}

function notesOf(out: string): ConversionNotes {
  return JSON.parse(
    readFileSync(join(out, 'acme-pack', 'MK2-CONVERSION.json'), 'utf8'),
  ) as ConversionNotes
}

async function inventoryOf(directory: string) {
  const input = await loadExtensionDirectory(directory)
  return buildInventory([input], createHostContributionContractRegistry())
}

describe('MK2 → MK3 converter (OPUS-MK2-01 task A, OPUS-MK2-02 tasks D/D2/E)', () => {
  const out = join(scratch, 'default')
  const first = run(out)

  it('converts every representable read plane and skips only definitions without a codec form', () => {
    expect(first.status).toBe(0)
    expect(first.json.summary).toMatchObject({
      rework: true,
      extensions: 1,
      converted: 6,
      byVerdict: {
        mechanical: 4,
        'convertible with rework': 1,
        'needs new contract': 1,
      },
    })
    expect(listFiles(out)).toEqual([
      'acme-pack/MK2-CONVERSION.json',
      'acme-pack/README.md',
      'acme-pack/contributions/codec-atlas.json',
      'acme-pack/contributions/codec-exotic.json',
      'acme-pack/contributions/codec-namespaced.json',
      'acme-pack/contributions/codec-tile.json',
      'acme-pack/contributions/codec-wildcard.json',
      'acme-pack/contributions/codec-writer.json',
      'acme-pack/package.json',
      'acme-pack/src/atlas/codec.js',
      'acme-pack/src/exotic/codec.js',
      'acme-pack/src/namespaced/codec.js',
      'acme-pack/src/tile/codec.js',
      'acme-pack/src/wildcard/codec.js',
      'acme-pack/src/writer/codec.js',
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
        probe: {
          kind: 'namespace',
          markers: ['.modkit-namespace-probe-marker'],
          maxEntries: 1,
          maxBytes: 4096,
          maxDepth: 1,
          maxPathBytes: 4096,
        },
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

  it('emits honest stubs for representable read planes and skips unsupported definitions', () => {
    const reasons = new Map(first.json.skipped.map(item => [item.contributionId, item]))
    const writer = first.json.converted.find(item => item.contributionId === 'org.acme/writer')
    expect(writer).toMatchObject({
      verdict: 'needs new contract',
    })
    expect(writer?.debt.contractGaps.some(gap => gap.includes('write'))).toBe(true)
    // 27 §0.5.2: a v1 codec that declares itself unsupported is a FormatDefinition, and the lab
    // has no format-definition contract yet (REPORT §9.6) — a named skip, not a fake codec.
    expect(reasons.get('org.acme/retired')).toMatchObject({
      verdict: 'mechanical',
      reason: 'format-definition-pending',
    })
    // `map` now reuses the bundled entry-namespace representation; no new contract is invented.
    expect(
      first.json.converted.find(item => item.contributionId === 'org.acme/atlas'),
    ).toMatchObject({ verdict: 'mechanical' })
    expect(listFiles(out).some(path => path.includes('retired'))).toBe(false)
  })

  it('writes the conversion debt beside the extension as inert data (task D)', () => {
    const notes = notesOf(out)
    expect(notes.schemaVersion).toBe(1)
    expect(notes.source).toEqual({
      repository: 'modkitx',
      manifests: [
        'extensions/acme/pack/codecs/atlas/codec.manifest.json',
        'extensions/acme/pack/codecs/exotic/codec.manifest.json',
        'extensions/acme/pack/codecs/namespaced/codec.manifest.json',
        'extensions/acme/pack/codecs/tile/codec.manifest.json',
        'extensions/acme/pack/codecs/wildcard/codec.manifest.json',
        'extensions/acme/pack/codecs/writer/codec.manifest.json',
      ],
    })
    // a missing extra plane is the weakest verdict in the group, even though its readable side
    // is still represented by an honest port-pending stub
    expect(notes.verdict).toBe('needs-new-contract')
    expect(Object.keys(notes.codecs)).toEqual([
      'org.acme/atlas',
      'org.acme/exotic',
      'org.acme/namespaced',
      'org.acme/tile',
      'org.acme/wildcard',
      'org.acme/writer',
    ])

    // the split verdict is a lost viewer plane, named with the v1 entrypoint that carried it —
    // the converter does not invent a viewer contribution (13C)
    const exotic = notes.codecs['org.acme/exotic']
    expect(exotic?.verdict).toBe('convertible-with-rework')
    expect(exotic?.lostPlanes).toEqual([{ plane: 'viewer', entrypoint: './viewer.js' }])
    expect(exotic?.contractGaps).toEqual([])
    expect(exotic?.lostPlanes.every(lost => lost.plane === 'viewer')).toBe(true)
    expect(exotic?.renames).toEqual([
      { from: 'image.compressed.read', to: 'image.compressed-read' },
    ])
    expect(exotic?.droppedOperations).toEqual(['image.compressed-read'])
    expect(exotic?.portState).toBe('port-pending')

    // a mechanical codec loses no plane and renames nothing, but still records the defaults v1
    // never made — REPORT §7.6/§7.7 asks each port to narrow them
    const tile = notes.codecs['org.acme/tile']
    expect(tile?.lostPlanes).toEqual([])
    expect(tile?.renames).toEqual([])
    expect(tile?.converterDefaults).toContain('variants:pair')
    expect(tile?.droppedOperations).toEqual(['image.inspect', 'image.read'])
    expect(notes.codecs['org.acme/namespaced']?.converterDefaults).toContain('permissions:union')

    // the notes file is not a contribution: the loader glob must not pick it up
    const pkg = JSON.parse(readFileSync(join(out, 'acme-pack', 'package.json'), 'utf8')) as {
      readonly modkit: { readonly contributionManifests: readonly string[] }
    }
    expect(pkg.modkit.contributionManifests).toEqual(['./contributions/*.json'])
  })

  it('drops the everything-glob and admits the codec has no rule left (task E)', () => {
    const wildcard = JSON.parse(
      readFileSync(join(out, 'acme-pack', 'contributions', 'codec-wildcard.json'), 'utf8'),
    ) as EmittedSpec
    // the everything-glob is not a v2 wildcard (matchesGlob needs a directory component) and MK3
    // spells detect-by-content as match.signatures; carrying the glob would be carrying a lie
    expect(wildcard.spec.match).toEqual({})

    const notes = notesOf(out)
    expect(notes.codecs['org.acme/wildcard']?.needsSignatures).toBe(true)
    expect(notes.codecs['org.acme/wildcard']?.converterDefaults).toContain(
      'match:wildcard-glob-dropped',
    )
    expect(first.json.summary.needsSignatures).toBe(1)
    // it is still emitted and still inventory-eligible; it simply cannot be shortlisted yet
    expect(notes.codecs['org.acme/tile']?.needsSignatures).toBe(false)

    const module = readFileSync(join(out, 'acme-pack', 'src', 'wildcard', 'codec.js'), 'utf8')
    expect(module).toContain('MK2-CONVERSION.json')
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

  it('never overwrites a hand-ported module, and records it as ported in the notes', () => {
    const module = join(out, 'acme-pack', 'src', 'tile', 'codec.js')
    const ported = '// hand-ported for the acceptance harness\nexport const abiVersion = 1\n'
    writeFileSync(module, ported)

    const rerun = run(out)
    expect(rerun.status).toBe(0)
    expect(readFileSync(module, 'utf8')).toBe(ported)
    expect(rerun.json.handPorted).toEqual(['acme-pack/src/tile/codec.js'])
    // the port state is data: losing the generated marker rewrites the notes and the README
    // column that mirrors them, and nothing else — least of all the module itself
    expect(rerun.json.drift.changed).toEqual([
      'acme-pack/MK2-CONVERSION.json',
      'acme-pack/README.md',
    ])
    expect(notesOf(out).codecs['org.acme/tile']?.portState).toBe('ported')
    expect(rerun.json.summary.ported).toBe(1)

    const checked = run(out, ['--check'])
    expect(checked.status).toBe(0)
    rmSync(module)
    run(out) // restore the generated module for the remaining assertions
    expect(notesOf(out).codecs['org.acme/tile']?.portState).toBe('port-pending')
  })

  it('--mechanical-only reproduces the narrower OPUS-MK2-01 tree (task D2)', () => {
    const mechanicalOut = join(scratch, 'mechanical-only')
    const mechanical = run(mechanicalOut, ['--mechanical-only'])
    expect(mechanical.status).toBe(0)
    expect(mechanical.json.summary.rework).toBe(false)
    expect(mechanical.json.summary.byVerdict).toEqual({
      mechanical: 4,
      'needs new contract': 1,
    })
    expect(
      mechanical.json.skipped.find(item => item.contributionId === 'org.acme/exotic')?.reason,
    ).toBe('convertible with rework')
    expect(listFiles(mechanicalOut)).not.toContain('acme-pack/contributions/codec-exotic.json')
  })

  it('every generated manifest is inventory-eligible against the production registry', async () => {
    const inventory = await inventoryOf(join(out, 'acme-pack'))
    expect(inventory.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const contributions = inventory.extensions.flatMap(extension => extension.contributions)
    expect(contributions).toHaveLength(6)
    for (const contribution of contributions) {
      expect(contribution.diagnostics.filter(d => d.severity === 'error')).toEqual([])
      expect(contribution.specState).toBe('validated')
      expect(contribution.inventoryEligible).toBe(true)
    }
  })

  it('the committed extensions/mk2 tree is inventory-eligible in full', async () => {
    const directories = committedExtensionDirectories().map(directory =>
      join(committedTree, directory),
    )
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
    // Block 8 moved 18 valid contributions into domain-owned roots, block 11 slice 11A moved plain
    // text into extensions/common/plain-text, and slice 11B moved the OpenDocument trio into
    // extensions/common/documents. Keep the remaining converted staging tree ratcheted while
    // PIE plus the five WZ-family codecs moved to the final opensource/warzone-2100 owner. The
    // staging floor therefore drops by six while check-mk2-ports keeps the global floor at 169.
    expect(contributions).toBeGreaterThanOrEqual(78)
  })

  it('the committed tree carries notes per extension whose port states match the modules', () => {
    const directories = committedExtensionDirectories()
    let ported = 0
    for (const directory of directories) {
      const notes = JSON.parse(
        readFileSync(join(committedTree, directory, 'MK2-CONVERSION.json'), 'utf8'),
      ) as ConversionNotes
      expect(notes.schemaVersion).toBe(1)
      expect(notes.source.repository).toBe('modkitx')
      for (const [contributionId, debt] of Object.entries(notes.codecs)) {
        const localId = contributionId.split('/').at(-1) ?? ''
        const module = readFileSync(
          join(committedTree, directory, 'src', localId, 'codec.js'),
          'utf8',
        )
        // `ported` means exactly one thing: a human owns the module, so the generated marker is
        // gone and the converter has stopped rewriting it.
        expect({ id: contributionId, ported: debt.portState === 'ported' }).toEqual({
          id: contributionId,
          ported: !module.includes('@generated by scripts/convert-mk2.mjs'),
        })
        if (debt.portState === 'ported') ported += 1
      }
    }
    // OPUS-MK2-02 definition of done: six earlier pilots plus port campaign wave 1.
    expect(ported).toBeGreaterThanOrEqual(12)
  })

  it('the remaining staging v1 containers route by signature, with the source cited', () => {
    // Relocated common media codecs are product-owned and covered by their product acceptance
    // suites. This converter regression follows only families that still live in the staging tree.
    const expected: Readonly<Record<string, readonly string[]>> = {
      'adobe-flash/contributions/codec-flv.json': ['464c5601'],
      'adobe-flash/contributions/codec-swf.json': ['465753', '435753', '5a5753'],
    }
    for (const [path, patterns] of Object.entries(expected)) {
      const manifest = JSON.parse(
        readFileSync(join(committedTree, ...path.split('/')), 'utf8'),
      ) as EmittedSpec
      expect(manifest.spec.match.pathGlobs).toBeUndefined()
      expect(manifest.spec.match.signatures?.map(rule => rule.bytesHex)).toEqual(patterns)
      const readme = readFileSync(
        join(committedTree, path.split('/')[0] ?? '', 'README.md'),
        'utf8',
      )
      expect(readme).toContain('Signatures added at port time')
      for (const pattern of patterns) expect(readme).toContain(pattern)
    }
  })
})
