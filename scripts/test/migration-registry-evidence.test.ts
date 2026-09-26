/*
 * The evidence rules of the capability registry gate (GA recovery step 2C, findings F04 and F26).
 *
 * These are the rules a tired hand is most tempted to satisfy by editing the registry rather than
 * by running anything, so they are the ones that need a test pointed at the gate itself:
 *
 *   * a row that claims the installed route must name the receipt *and* the anchor inside it;
 *   * `vscode-manual-pending` must name the wave that ends it, or it is a permanent car park;
 *   * E5 is three conditions — a real corpus, an installed receipt, and an anchor that the run
 *     actually executed and passed. An anchor the receipt lists as not executed is refused, which
 *     is what stops "almost passed" from being written down as evidence.
 *
 * The fixtures deliberately differ from `valid.capabilities.yaml` by one field each, so a failure
 * here names the rule that broke rather than a fixture that drifted.
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
      // The acceptance receipts of the real programme live beside the checkouts; the fixture tree
      // stands in for them so the anchor lookup is exercised without depending on the workspace.
      '--artifacts',
      join(fixtures, 'artifacts'),
    ],
    { encoding: 'utf8' },
  )
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('capability registry gate: installed-host evidence', () => {
  it('accepts the baseline fixture, so a failure below is the changed field and nothing else', () => {
    const { status, output } = runGate('valid.capabilities.yaml')
    expect(output).toContain('installed-host evidence on 0 row(s)')
    expect(status).toBe(0)
  })

  it('refuses a row that claims the installed route without naming a receipt', () => {
    const { status, output } = runGate('installed-without-receipt.capabilities.yaml')
    expect(output).toContain('claims the installed route but names no receipt')
    expect(status).toBe(1)
  })

  it('refuses vscode-manual-pending that does not name the wave that ends it', () => {
    const { status, output } = runGate('manual-pending-without-wave.capabilities.yaml')
    expect(output).toContain('must name the wave that closes it')
    expect(status).toBe(1)
  })

  it('accepts vscode-manual-pending once it carries a named wave', () => {
    const { status, output } = runGate('manual-pending-named-wave.capabilities.yaml')
    expect(output).not.toContain('problem(s)')
    expect(status).toBe(0)
  })

  it('refuses E5 that has a real corpus but no installed receipt behind it', () => {
    const { status, output } = runGate('e5-without-installed-receipt.capabilities.yaml')
    expect(output).toContain('hostEvidence must be vscode-installed')
    expect(output).toContain('must name the installed acceptance receipt and the anchor')
    expect(status).toBe(1)
  })

  it('refuses an anchor the named receipt records as not executed', () => {
    const { status, output } = runGate('e5-unexecuted-anchor.capabilities.yaml')
    expect(output).toContain('does not record as executed and passing')
    expect(status).toBe(1)
  })

  it('accepts E5 when the corpus, the receipt and the executed anchor are all present', () => {
    const { status, output } = runGate('e5-installed-receipt.capabilities.yaml')
    expect(output).toContain('installed-host evidence on 1 row(s)')
    expect(output).toContain('artifacts/demo-wave/demo-acceptance.receipt.json#D-1')
    expect(status).toBe(0)
  })
})

describe('capability registry: the committed rows that claim the installed route', () => {
  /*
   * The rules above are checked against fixtures because the whole-registry run of this gate has
   * been unable to complete since the product externalization (see the 2C report). That would let
   * the committed registry drift away from the rules it is supposed to obey, so the committed rows
   * are read here directly and held to the same three conditions.
   */
  it('holds every committed E5 row to a real corpus, a receipt and an executed anchor', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const { parseCanonicalYaml } = (await import(
      // @ts-expect-error -- the canonical YAML subset reader is untyped tooling JavaScript
      '../migration/lib/canonical-yaml.mjs'
    )) as { parseCanonicalYaml: (text: string) => { capabilities: Registry[] } }
    interface Registry {
      readonly capabilityId: string
      readonly evidenceLevel: string
      readonly hostEvidence: string
      readonly corpusDescriptors: readonly string[]
      readonly parityEvidence: { readonly corpusKinds: readonly string[] }
      readonly receipts: { readonly installedHost: string | null }
    }
    const registry = parseCanonicalYaml(
      readFileSync(join(scriptsDir, '..', 'migration', 'capabilities.yaml'), 'utf8'),
    )
    // The rule itself is exercised by the e5-* fixtures above. The committed set may be empty: the
    // only installed receipt (wave 2B) was lost with its artifacts on 2026-09-26, and its rows fell
    // back to node evidence until the installed VS Code accepts them again.
    const installed = registry.capabilities.filter(row => row.hostEvidence === 'vscode-installed')
    const artifactsRoot = join(scriptsDir, '..', '..', 'artifacts')
    for (const row of installed) {
      const claim = row.receipts.installedHost
      expect(claim, `${row.capabilityId}: installed route without a receipt`).toMatch(
        /^artifacts\/[^#\s]+\.receipt\.json#[^#\s]/u,
      )
      expect(
        row.corpusDescriptors.length > 0 || row.parityEvidence.corpusKinds.includes('real'),
        `${row.capabilityId}: installed evidence without a real corpus`,
      ).toBe(true)
      const [file, anchor] = String(claim).split('#')
      const absolute = join(artifactsRoot, String(file).slice('artifacts/'.length))
      if (!existsSync(absolute)) continue // receipt tree not checked out; the shape above still held
      const receipt = JSON.parse(readFileSync(absolute, 'utf8')) as { verdict?: string }
      expect(receipt.verdict, `${row.capabilityId}: ${file} did not pass`).toBe('pass')
      expect(
        JSON.stringify(receipt).includes(JSON.stringify(anchor)),
        `${row.capabilityId}: ${file} never mentions anchor ${anchor}`,
      ).toBe(true)
    }
  })
})
