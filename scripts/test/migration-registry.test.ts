import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
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
})

const priorityGate = join(scriptsDir, 'migration', 'emit-priority-scope.mjs')
// Fixture runs never write into the repository: the closure output goes to a throwaway directory.
const scopeOut = mkdtempSync(join(tmpdir(), 'x3-priority-scope-'))

function runPriority(registry: string, extra: readonly string[] = []) {
  const result = spawnSync(
    process.execPath,
    [priorityGate, '--registry', join(fixtures, registry), '--out-dir', scopeOut, ...extra],
    { encoding: 'utf8' },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('phase-aware priority gate (plan §3.5, block 10 works 6–7)', () => {
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

  it('audits every closure, not just mk3-ga: a multiverse-priority row can be overdue too', () => {
    /*
     * The blind spot slice 12-2 closed. Every UV row is `multiverse-priority`, so it lives only in
     * the `mk3-multiverse-ga` closure — and the audit used to walk `mk3-ga` alone. This fixture has
     * *no* mk3-ga units at all, so an mk3-ga-only audit reports it clean by construction; the union
     * audit finds the overdue row and names the closure it came from.
     */
    const { status, stderr } = runPriority('overdue-multiverse.capabilities.yaml', [
      '--phase',
      'block-10',
    ])
    expect(status).toBe(1)
    expect(stderr).toContain('overdue priority unit')
    expect(stderr).toContain('[mk3-multiverse-ga]')
    expect(stderr).toContain('migrationState missing')
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

  it('keeps the committed closures fresh and free of overdue units at the current phase', () => {
    const result = spawnSync(process.execPath, [priorityGate, '--check', '--phase', 'block-10'], {
      encoding: 'utf8',
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('mk3-ga')
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
})

describe('the generated status page names the block that still owes something', () => {
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

  it('agrees with the committed page: its nearest block is the first with a non-zero gap', () => {
    const page = readFileSync(join(scriptsDir, '..', 'migration', 'generated', 'status.md'), 'utf8')
    const named = /\|\s*`mk3-ga`\s*\|(?:[^|]*\|){4}\s*(block-\d+)\s*\|/u.exec(page)?.[1]
    expect(named).toBeDefined()
    // the deadline table below it lists units and unresolved counts per block, in block order
    const rows = [...page.matchAll(/\|\s*`(block-\d+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gu)]
    const firstOwing = rows.find(row => Number(row[3]) > 0)?.[1]
    expect(firstOwing).toBeDefined()
    expect(named).toBe(firstOwing)
  })
})
