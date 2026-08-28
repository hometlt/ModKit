import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// @ts-expect-error -- the canonical YAML subset reader is untyped tooling JavaScript
import { parseCanonicalYaml } from '../migration/lib/canonical-yaml.mjs'
// @ts-expect-error -- untyped tooling JavaScript, like the reader above
import { blockNumber, nearestOwedBlock } from '../migration/lib/nearest-block.mjs'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const gate = join(scriptsDir, 'migration', 'check-registry.mjs')
const fixtures = join(scriptsDir, 'test', 'fixtures', 'migration-registry')

function runGate(registry: string, projections = 'valid.projections.yaml') {
  const result = spawnSync(
    process.execPath,
    [
      gate,
      '--inventory',
      join(fixtures, 'inventory.json'),
      '--registry',
      join(fixtures, registry),
      '--projections',
      join(fixtures, projections),
    ],
    { encoding: 'utf8' },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function runCommittedGateWithCorpora(corpora: string) {
  const result = spawnSync(process.execPath, [gate, '--corpora', join(fixtures, corpora)], {
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('capability registry gate (plan §3.3–3.4, block 10 works 4–6 and 10–11)', () => {
  it('accepts a registry whose rows are complete and whose inventory is fully accounted for', () => {
    const { status, stdout, stderr } = runGate('valid.capabilities.yaml')
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('1 mapped + 1 unmapped = 2 source units')
  })

  it('refuses an operation-level projection proof the row does not actually list', () => {
    /*
     * Block 12 item 10. The four projection state fields answer "does a projection of this kind
     * exist", which is a different question from "which operations over it are proven" — and one
     * badge let a row that proved `inspect` read as though it had proved `materialize` too. Each
     * operation now names its test, and this is the rule that stops the field being decorative: a
     * named test must also be in the row's own `closedBy.tests`, so evidence cannot be claimed by
     * pointing at a file nobody connected to this capability.
     */
    const { status, stderr } = runGate('unlisted-operation-proof.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('projection.operations.inspect')
    expect(stderr).toContain('does not list in closedBy.tests')
  })

  it('refuses a capability row with no owner', () => {
    const { status, stderr } = runGate('no-owner.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('owner is required')
  })

  it('refuses a source inventory ID the inventory does not contain', () => {
    const { status, stderr } = runGate('unknown-source-unit.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('does not exist in the source inventory')
  })

  it('refuses a lost source unit: neither mapped to a capability nor declared unmapped', () => {
    const { status, stderr } = runGate('lost-unit.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('neither mapped to a capability nor listed as unmapped')
    expect(stderr).toContain('legacy/script/demo.ts')
  })

  it('refuses a document plane that claims the UVD portable profile', () => {
    const { status, stderr } = runGate(
      'valid.capabilities.yaml',
      'uvd-as-document.projections.yaml',
    )
    expect(status).toBe(1)
    expect(stderr).toContain('uvd-is-not-a-document')
  })

  it('refuses a UVP plane that also claims an execute action', () => {
    const { status, stderr } = runGate('valid.capabilities.yaml', 'uvp-executes.projections.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('uvp-is-data-only')
  })

  it('refuses a plane that makes a publisher-candidate facet required', () => {
    const { status, stderr } = runGate(
      'valid.capabilities.yaml',
      'candidate-facet-required.projections.yaml',
    )
    expect(status).toBe(1)
    expect(stderr).toContain('candidate-facet-is-not-admitted')
  })

  it('keeps the committed slides facet a candidate in both the registry and the SDK', async () => {
    // ADR-DOC-001 lives in two places by necessity — the SDK owns the contract, the projection
    // matrix owns the plane — so the two are pinned to each other here. Admitting the contract
    // means changing both, which is exactly the decision block 30 reserves.
    const { dataSourceMaturity } = await import('@modkitx-x3/sdk')
    const matrix = parseCanonicalYaml(
      readFileSync(join(scriptsDir, '..', 'migration', 'projections.yaml'), 'utf8'),
    ) as { readonly planes: readonly Record<string, unknown>[] }
    const document = matrix.planes.find(plane => plane['plane'] === 'document')
    expect((document?.['facetMaturity'] as Record<string, string>)['slides']).toBe(
      'publisher-candidate',
    )
    expect(dataSourceMaturity('common.view/slide-deck-source')).toBe('publisher-candidate')
    expect((document?.['requiredFacets'] as readonly string[]) ?? []).not.toContain('slides')
  })

  it('refuses a dependsOn target the registry does not contain', () => {
    const { status, stderr } = runGate('unknown-dependency.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('does not exist in the registry')
  })

  it('checks the committed registry and projection matrix against the real inventory', () => {
    const result = spawnSync(process.execPath, [gate], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('projection planes')
  })

  it('refuses a readiness environment variable absent from the oracle lock even before the corpus is available', () => {
    const { status, stderr } = runCommittedGateWithCorpora('unknown-readiness-environment.json')
    expect(status).toBe(1)
    expect(stderr).toContain('MODKITX_RA3_UNKNOWN_ROOT')
    expect(stderr).toContain('is not described in the oracle lock')
  })

  it('refuses a named-game discovery row bound to another game dialect corpus', () => {
    const { status, stderr } = runCommittedGateWithCorpora('mismatched-game-discovery-corpus.json')
    expect(status).toBe(1)
    expect(stderr).toContain('game/cnc3-tiberium-wars/discover-open')
    expect(stderr).toContain('must use exact corpus environment MODKITX_CNC3_KW_ROOT')
    expect(stderr).toContain('found MODKITX_CNC3_TW_ROOT')
  })
})

const priorityGate = join(scriptsDir, 'migration', 'emit-priority-scope.mjs')
// Fixture runs never write into the repository: the closure output goes to a throwaway directory.
const scopeOut = mkdtempSync(join(tmpdir(), 'x3-priority-scope-'))

const BLOCK_20_PRODUCT_GA_OBLIGATIONS = [
  'platform/apps/command-runtime-session-conformance',
  'platform/apps/priority-workflows',
  'platform/apps/recovery',
  'platform/extensions/lifecycle',
  'platform/extensions/out-of-tree',
  'platform/presentation/common-plan',
  'platform/release/migration-zero-gap',
  'platform/release/reproducible-rc',
  'platform/tools/ga-priority',
] as const

function runPriority(registry: string, extra: readonly string[] = []) {
  const result = spawnSync(
    process.execPath,
    [priorityGate, '--registry', join(fixtures, registry), '--out-dir', scopeOut, ...extra],
    { encoding: 'utf8' },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('phase-aware priority gate (plan §3.5, block 10 works 6–7)', () => {
  it('keeps every Block 20 Product GA obligation inside the machine-readable mk3-ga closure', () => {
    const root = join(scriptsDir, '..', 'migration')
    const registry = parseCanonicalYaml(readFileSync(join(root, 'capabilities.yaml'), 'utf8')) as {
      readonly capabilities: readonly {
        readonly capabilityId: string
        readonly plannedBlock: number
        readonly releaseTrack: string
        readonly dependsOn: readonly string[]
      }[]
    }
    const ga = JSON.parse(readFileSync(join(root, 'priority-scope.mk3-ga.json'), 'utf8')) as {
      readonly units: readonly {
        readonly capabilityId: string
        readonly plannedBlock: number
      }[]
    }
    const rows = new Map(registry.capabilities.map(row => [row.capabilityId, row]))
    const scoped = new Map(ga.units.map(unit => [unit.capabilityId, unit]))

    for (const id of BLOCK_20_PRODUCT_GA_OBLIGATIONS) {
      expect(rows.get(id), `${id} registry row`).toMatchObject({
        plannedBlock: 20,
        releaseTrack: 'mk3-priority',
      })
      expect(scoped.get(id), `${id} mk3-ga unit`).toMatchObject({ plannedBlock: 20 })
    }

    const zeroGap = rows.get('platform/release/migration-zero-gap')
    expect(new Set(zeroGap?.dependsOn)).toEqual(
      new Set(
        BLOCK_20_PRODUCT_GA_OBLIGATIONS.filter(id => id !== 'platform/release/migration-zero-gap'),
      ),
    )
  })

  it('emits three monotonic release closures deterministically', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'x3-three-release-scope-'))
    const run = () =>
      spawnSync(
        process.execPath,
        [
          priorityGate,
          '--registry',
          join(fixtures, 'valid.capabilities.yaml'),
          '--out-dir',
          outDir,
        ],
        { encoding: 'utf8' },
      )
    const first = run()
    expect(first.stderr).toBe('')
    expect(first.status).toBe(0)
    const names = ['mk3-ga', 'mk3-multiverse-ga', 'mk3-deferred-games'] as const
    const before = names.map(name =>
      readFileSync(join(outDir, `priority-scope.${name}.json`), 'utf8'),
    )
    const documents = before.map(text => JSON.parse(text))
    expect(documents.map(document => document.release)).toEqual(names)
    expect(documents.map(document => document.extends)).toEqual([
      null,
      'mk3-ga',
      'mk3-multiverse-ga',
    ])
    expect(documents.map(document => document.activation)).toEqual([
      'active-product-ga',
      'active-after-mk3-ga',
      'inactive-until-owner-resume-after-multiverse-stop',
    ])
    expect(documents[2].renamedFrom).toBe('mk3-pre-multiverse')
    for (let index = 1; index < documents.length; index += 1) {
      const current = new Set(
        documents[index].units.map((unit: { capabilityId: string }) => unit.capabilityId),
      )
      expect(
        documents[index - 1].units.every((unit: { capabilityId: string }) =>
          current.has(unit.capabilityId),
        ),
      ).toBe(true)
    }
    const second = run()
    expect(second.stderr).toBe('')
    expect(second.status).toBe(0)
    expect(
      names.map(name => readFileSync(join(outDir, `priority-scope.${name}.json`), 'utf8')),
    ).toEqual(before)
    rmSync(outDir, { recursive: true, force: true })
  })

  it('fails closed when a registry row uses a release track outside the three-release model', () => {
    const temp = mkdtempSync(join(tmpdir(), 'x3-unknown-release-track-'))
    const registry = join(temp, 'capabilities.yaml')
    writeFileSync(
      registry,
      readFileSync(join(fixtures, 'valid.capabilities.yaml'), 'utf8').replace(
        "releaseTrack: 'mk3-priority'",
        "releaseTrack: 'misspelled-priority'",
      ),
    )
    const result = spawnSync(
      process.execPath,
      [priorityGate, '--registry', registry, '--out-dir', temp],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unsupported releaseTrack "misspelled-priority"')
    rmSync(temp, { recursive: true, force: true })
  })

  it('fails freshness when the deferred closure is missing', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'x3-missing-release-scope-'))
    const args = [
      priorityGate,
      '--registry',
      join(fixtures, 'valid.capabilities.yaml'),
      '--out-dir',
      outDir,
    ]
    expect(spawnSync(process.execPath, args, { encoding: 'utf8' }).status).toBe(0)
    rmSync(join(outDir, 'priority-scope.mk3-deferred-games.json'))
    const checked = spawnSync(process.execPath, [...args, '--check'], { encoding: 'utf8' })
    expect(checked.status).toBe(1)
    expect(checked.stderr).toContain('priority-scope.mk3-deferred-games.json is missing')
    rmSync(outDir, { recursive: true, force: true })
  })

  it('passes a phase in which nothing is due yet', () => {
    const { status, stdout, stderr } = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-10',
    ])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('phase block-10 clean')
  })

  it('fails on a priority unit whose planned block has passed while it is still unresolved', () => {
    const { status, stderr } = runPriority('overdue.capabilities.yaml', ['--phase', 'block-10'])
    expect(status).toBe(1)
    expect(stderr).toContain('overdue priority unit')
    expect(stderr).toContain('migrationState missing')
  })

  it('audits a later closure when its phase scope is selected explicitly', () => {
    /*
     * Block numbers repeat across release waves after C&C moved behind Product GA. The default
     * phase scope is deliberately mk3-ga; a later wave names its wider closure and gets the same
     * overdue-unit protection without making Block 16 C&C block Block 17A Warzone.
     */
    const { status, stderr } = runPriority('overdue-multiverse.capabilities.yaml', [
      '--phase',
      'block-10',
      '--phase-scope',
      'mk3-multiverse-ga',
    ])
    expect(status).toBe(1)
    expect(stderr).toContain('overdue priority unit')
    expect(stderr).toContain('[mk3-multiverse-ga]')
    expect(stderr).toContain('migrationState missing')
  })

  it('fails closed on an unknown phase scope', () => {
    const { status, stderr } = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-10',
      '--phase-scope',
      'mk3-typo',
    ])
    expect(status).toBe(1)
    expect(stderr).toContain('--phase-scope expects one of')
  })

  it('names no closure for a row that mk3-ga already carries, so the common case stays quiet', () => {
    // the mk3-priority fixture keeps its original message: a tag on every line would be noise
    const { stderr } = runPriority('overdue.capabilities.yaml', ['--phase', 'block-10'])
    expect(stderr).toContain('overdue priority unit')
    expect(stderr).not.toContain('[mk3-')
  })

  it('fails on a hidden skip: an overdue unit resting on a corpus published as unavailable', () => {
    const { status, stderr } = runPriority('hidden-skip.capabilities.yaml', [
      '--phase',
      'block-10',
      '--corpora',
      join(fixtures, 'unavailable-corpora.json'),
    ])
    expect(status).toBe(1)
    expect(stderr).toContain('hidden skip, not a pass')
  })

  it('refuses to start a corpus-backed vertical while its evidence path still needs owner action or is unavailable', () => {
    const { status, stderr } = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-16',
      '--corpora',
      join(fixtures, 'phase-start-blocked-corpora.json'),
    ])
    expect(status).toBe(1)
    expect(stderr).toContain('phase-start corpus')
    expect(stderr).toContain('owner-action-now (MODKITX_OWNER_ACTION_ROOT)')
    expect(stderr).toContain('status owner-action-required')
    expect(stderr).toContain('unavailable-now (MODKITX_UNAVAILABLE_ROOT)')
    expect(stderr).toContain('status unavailable')
    expect(stderr).not.toContain('owner-action-later')
  })

  it('accepts available and pre-approved legal-alternative corpora and ignores a later vertical', () => {
    const { status, stdout, stderr } = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-16',
      '--corpora',
      join(fixtures, 'phase-start-ready-corpora.json'),
    ])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('phase block-16 clean')
  })

  it('keeps deferred-game corpora out of the first-GA phase gate but audits them after owner resume', () => {
    const phase = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-17',
      '--corpora',
      join(fixtures, 'phase-start-ready-corpora.json'),
    ])
    expect(phase.stderr).toBe('')
    expect(phase.status).toBe(0)

    const multiverseRelease = runPriority('valid.capabilities.yaml', [
      '--release',
      'mk3-multiverse-ga',
      '--corpora',
      join(fixtures, 'phase-start-ready-corpora.json'),
    ])
    expect(multiverseRelease.stderr).toBe('')
    expect(multiverseRelease.status).toBe(0)

    const deferredRelease = runPriority('valid.capabilities.yaml', [
      '--release',
      'mk3-deferred-games',
      '--corpora',
      join(fixtures, 'phase-start-ready-corpora.json'),
    ])
    expect(deferredRelease.status).toBe(1)
    expect(deferredRelease.stderr).toContain('mk3-deferred-games corpus')
    expect(deferredRelease.stderr).toContain('owner-action-later')
  })

  it('fails closed when the phase-start readiness document cannot be read', () => {
    const { status, stderr } = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-16',
      '--corpora',
      join(fixtures, 'missing-phase-start-corpora.json'),
    ])
    expect(status).toBe(1)
    expect(stderr).toContain('phase-start corpus')
    expect(stderr).toContain('is unreadable; phase start fails closed')
  })

  it('fails closed when the phase-start readiness schema or corpora collection is malformed', () => {
    const wrongSchema = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-16',
      '--corpora',
      join(fixtures, 'phase-start-wrong-schema-corpora.json'),
    ])
    expect(wrongSchema.status).toBe(1)
    expect(wrongSchema.stderr).toContain('schemaVersion must be corpora-readiness-1')

    const missingCorpora = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-16',
      '--corpora',
      join(fixtures, 'phase-start-missing-corpora.json'),
    ])
    expect(missingCorpora.status).toBe(1)
    expect(missingCorpora.stderr).toContain('corpora must be an array')
  })

  it('fails closed on malformed corpus entries instead of silently skipping them', () => {
    const { status, stderr } = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-16',
      '--corpora',
      join(fixtures, 'phase-start-malformed-entry-corpora.json'),
    ])
    expect(status).toBe(1)
    expect(stderr).toContain('corpus missing-block: verticalBlock must be an integer')
    expect(stderr).toContain('corpus bad-status: unsupported status "maybe-ready"')
    expect(stderr).toContain('id is required; phase start fails closed')
  })

  it('keeps the committed closures fresh and free of overdue units at the current phase', () => {
    const result = spawnSync(process.execPath, [priorityGate, '--check', '--phase', 'block-10'], {
      encoding: 'utf8',
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('mk3-ga')
  })

  it('keeps C&C and BAR outside mk3-ga and Multiverse, then adds them only after STOP', () => {
    const root = join(scriptsDir, '..', 'migration')
    const ga = JSON.parse(readFileSync(join(root, 'priority-scope.mk3-ga.json'), 'utf8'))
    const multiverse = JSON.parse(
      readFileSync(join(root, 'priority-scope.mk3-multiverse-ga.json'), 'utf8'),
    )
    const deferred = JSON.parse(
      readFileSync(join(root, 'priority-scope.mk3-deferred-games.json'), 'utf8'),
    )
    const gaIds = new Set(ga.units.map((unit: { capabilityId: string }) => unit.capabilityId))
    const multiverseIds = new Set(
      multiverse.units.map((unit: { capabilityId: string }) => unit.capabilityId),
    )
    const deferredIds = new Set(
      deferred.units.map((unit: { capabilityId: string }) => unit.capabilityId),
    )
    const multiverseOnly = multiverse.units.filter(
      (unit: { capabilityId: string }) => !gaIds.has(unit.capabilityId),
    )
    expect(
      ga.units.every(
        (unit: { releaseTrack: string }) => unit.releaseTrack !== 'deferred-games-priority',
      ),
    ).toBe(true)
    expect(
      multiverse.units.every(
        (unit: { releaseTrack: string }) => unit.releaseTrack !== 'deferred-games-priority',
      ),
    ).toBe(true)
    expect(multiverseOnly.length).toBeGreaterThan(0)
    expect(
      multiverseOnly.every(
        (unit: { releaseTrack: string }) => unit.releaseTrack === 'multiverse-priority',
      ),
    ).toBe(true)
    const deferredGameRows = deferred.units.filter(
      (unit: { capabilityId: string; releaseTrack: string }) =>
        unit.releaseTrack === 'deferred-games-priority' && !gaIds.has(unit.capabilityId),
    )
    expect(deferredGameRows.length).toBeGreaterThan(0)
    expect(
      deferredGameRows.every(
        (unit: { capabilityId: string }) => !multiverseIds.has(unit.capabilityId),
      ),
    ).toBe(true)
    for (const id of [
      'game/cnc3-tiberium-wars/discover-open',
      'game/red-alert-3/discover-open',
      'game/beyond-all-reason/discover-open',
      'vertical/cnc3-kanes-wrath/native-inspect-authoring',
      'vertical/beyond-all-reason/native-inspect-authoring',
    ]) {
      expect(gaIds.has(id), id).toBe(false)
      expect(multiverseIds.has(id), id).toBe(false)
      expect(deferredIds.has(id), id).toBe(true)
    }
    expect(multiverse.extends).toBe('mk3-ga')
    expect(multiverse.seedTracks).toEqual(['mk3-priority', 'multiverse-priority'])
    expect(deferred.extends).toBe('mk3-multiverse-ga')
    expect(deferred.seedTracks).toEqual([
      'mk3-priority',
      'multiverse-priority',
      'deferred-games-priority',
    ])
  })
})

describe('product profile gate (plan §4.2–4.3, block 10 work 8)', () => {
  it('accepts the committed composition lock', () => {
    const result = spawnSync(
      process.execPath,
      [join(scriptsDir, 'migration', 'check-profiles.mjs')],
      {
        encoding: 'utf8',
      },
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('bundle baseline')
  })

  it('refuses a preset that names an extension family the tree does not declare', () => {
    const broken = join(fixtures, 'broken-profiles.json')
    const result = spawnSync(
      process.execPath,
      [join(scriptsDir, 'migration', 'check-profiles.mjs'), '--profiles', broken],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not declared in scripts/app-extension-sets.mjs')
  })

  it('refuses a preset assigned outside the three named release closures', () => {
    const temp = mkdtempSync(join(tmpdir(), 'x3-profile-release-'))
    const profiles = JSON.parse(
      readFileSync(join(scriptsDir, '..', 'migration', 'product-profiles.json'), 'utf8'),
    )
    profiles.presets[0].introducedInClosure = 'ad-hoc-release'
    const broken = join(temp, 'profiles.json')
    writeFileSync(broken, JSON.stringify(profiles))
    const result = spawnSync(
      process.execPath,
      [join(scriptsDir, 'migration', 'check-profiles.mjs'), '--profiles', broken],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('introducedInClosure must be one of')
    rmSync(temp, { recursive: true, force: true })
  })
})

describe('the generated status page names only a block that still owes something', () => {
  /*
   * The line this covers said «block-11» while block 11 had zero unresolved rows: its deadlines
   * were all met. `Object.keys(deadlines).sort()[0]` answers "the first key by text", which is
   * neither "the earliest block" nor "the earliest block that still owes anything" — and a reader
   * asking what is due next was pointed at finished work.
   */
  const unresolved = (...ids: readonly string[]) => {
    const owed = new Set(ids)
    return (id: string) => owed.has(id)
  }

  it('skips blocks whose deadlines are all met', () => {
    const deadlines = { 'block-11': ['a', 'b'], 'block-12': ['c'], 'block-15': ['d'] }
    expect(nearestOwedBlock(deadlines, unresolved('c'))).toBe('block-12')
    // and when a later block is the only one owing, it is not overtaken by an earlier finished one
    expect(nearestOwedBlock(deadlines, unresolved('d'))).toBe('block-15')
  })

  it('orders blocks by number, not by text', () => {
    // the bug this pins: `block-11` sorts before `block-9`, and `block-22` before both
    const deadlines = { 'block-9': ['nine'], 'block-11': ['eleven'], 'block-22': ['twentytwo'] }
    expect(Object.keys(deadlines).sort()[0]).toBe('block-11')
    expect(nearestOwedBlock(deadlines, unresolved('nine', 'eleven', 'twentytwo'))).toBe('block-9')
    expect(blockNumber('block-9')).toBeLessThan(blockNumber('block-11'))
  })

  it('answers nothing when the closure owes nothing, rather than naming a block at random', () => {
    const deadlines = { 'block-11': ['a'], 'block-12': ['b'] }
    expect(nearestOwedBlock(deadlines, unresolved())).toBeUndefined()
    expect(nearestOwedBlock({}, unresolved('a'))).toBeUndefined()
  })

  it('agrees with the clean committed page without inventing a nearest block', () => {
    const page = readFileSync(join(scriptsDir, '..', 'migration', 'generated', 'status.md'), 'utf8')
    const named = /\|\s*`mk3-ga`\s*\|(?:[^|]*\|){4}\s*([^|]+?)\s*\|/u.exec(page)?.[1]
    expect(named).toBe('—')
    // the deadline table below it lists units and unresolved counts per block, in block order
    const rows = [...page.matchAll(/\|\s*`(block-\d+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gu)]
    const firstOwing = rows.find(row => Number(row[3]) > 0)?.[1]
    expect(firstOwing).toBeUndefined()
  })
})
