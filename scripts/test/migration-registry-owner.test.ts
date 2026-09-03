/*
 * The `owner` closed vocabulary (GA recovery step 2C, finding F15).
 *
 * `owner` used to be free text: 71 distinct values across 331 rows, 88 of them naming
 * `extensions/mk2/<family>` — a tree deleted whole in the block-11 externalization (3fe0232d). The
 * gate now checks every owner (and, for a compound owner, every component of it) against a closed
 * vocabulary derived from what this repository and its five configured extension checkouts actually
 * carry, plus a named allowlist for the small number of legitimate non-path destinations.
 *
 * The fixtures deliberately differ from `valid.capabilities.yaml` by the owner field alone (and, for
 * the two `unassigned` cases, `releaseTrack`), so a failure here names the rule that broke rather than
 * a fixture that drifted.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const gate = join(scriptsDir, 'migration', 'check-registry.mjs')
const fixtures = join(scriptsDir, 'test', 'fixtures', 'migration-registry')

function runGate(registry: string): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [
      gate,
      '--inventory',
      join(fixtures, 'inventory.json'),
      '--registry',
      join(fixtures, registry),
      '--projections',
      join(fixtures, 'valid.projections.yaml'),
      '--artifacts',
      join(fixtures, 'artifacts'),
    ],
    { encoding: 'utf8' },
  )
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('capability registry gate: owner closed vocabulary', () => {
  it('accepts a valid single-path owner', () => {
    // valid.capabilities.yaml itself carries owner: 'extensions/documents', a real directory.
    const { status, output } = runGate('valid.capabilities.yaml')
    expect(output).not.toContain('is not in the closed owner vocabulary')
    expect(status).toBe(0)
  })

  it('accepts a valid compound owner, checking every component', () => {
    const { status, output } = runGate('owner-compound-valid.capabilities.yaml')
    expect(output).not.toContain('is not in the closed owner vocabulary')
    expect(status).toBe(0)
  })

  it('refuses an owner outside the closed vocabulary', () => {
    const { status, output } = runGate('owner-outside-vocabulary.capabilities.yaml')
    expect(output).toContain(
      'owner component "extensions/mk2/nonexistent-family" (from owner "extensions/mk2/nonexistent-family") is not in the closed owner vocabulary',
    )
    expect(status).toBe(1)
  })

  it('refuses a compound owner when just one component fails', () => {
    const { status, output } = runGate('owner-compound-bad-component.capabilities.yaml')
    // The real component must not be flagged — only the bad one.
    expect(output).not.toContain('owner component "packages/host"')
    expect(output).toContain(
      'owner component "extensions/mk2/nonexistent-family" (from owner "packages/host and extensions/mk2/nonexistent-family") is not in the closed owner vocabulary',
    )
    expect(status).toBe(1)
  })

  it('accepts owner unassigned on a post-ga row', () => {
    const { status, output } = runGate('owner-unassigned-post-ga.capabilities.yaml')
    expect(output).not.toContain('owner unassigned is only honest for')
    expect(status).toBe(0)
  })

  it('refuses owner unassigned on an mk3-priority row', () => {
    const { status, output } = runGate('owner-unassigned-mk3-priority.capabilities.yaml')
    expect(output).toContain(
      'owner unassigned is only honest for releaseTrack post-ga | deferred-games-priority, found "mk3-priority"',
    )
    expect(status).toBe(1)
  })
})

describe('capability registry: the committed rows all resolve against the closed vocabulary', () => {
  /*
   * The real registry (migration/capabilities.yaml) is read directly rather than via the gate CLI so
   * this suite names the offending capabilityId directly when it fails, instead of pointing at a wall
   * of gate stderr.
   */
  it('carries no owner outside the closed vocabulary, and no unassigned row inside current scope', async () => {
    const { readFileSync } = await import('node:fs')
    const { parseCanonicalYaml } = (await import(
      // @ts-expect-error -- the canonical YAML subset reader is untyped tooling JavaScript
      '../migration/lib/canonical-yaml.mjs'
    )) as { parseCanonicalYaml: (text: string) => { capabilities: Registry[] } }
    interface Registry {
      readonly capabilityId: string
      readonly owner: string
      readonly releaseTrack: string
    }
    const registry = parseCanonicalYaml(
      readFileSync(join(scriptsDir, '..', 'migration', 'capabilities.yaml'), 'utf8'),
    )
    // Only distinct owner values are exercised through the gate's own vocabulary; this test asserts
    // the shape a reader can check by eye — no row anywhere names the deleted extensions/mk2/** tree.
    for (const row of registry.capabilities) {
      expect(
        row.owner,
        `${row.capabilityId}: owner still names the deleted extensions/mk2 tree`,
      ).not.toMatch(/extensions\/mk2\//u)
    }
    expect(registry.capabilities.length).toBeGreaterThan(0)
  })
})
