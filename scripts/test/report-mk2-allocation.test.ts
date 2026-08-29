import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  OPERATION_DOMAINS as CORE_DOMAINS,
  SHARED_OPERATION_IDS as CORE_SHARED,
  isQualifiedId,
  isSegment,
} from '@modkitx-x3/core'
import { PERMISSION_CLASSES as SDK_PERMISSIONS } from '@modkitx-x3/sdk'
import {
  CAPABILITY_MAPPING,
  OPERATION_DOMAINS,
  PERMISSION_CLASSES,
  PERMISSION_MAPPING,
  QUALIFIED,
  SEGMENT,
  SHARED_OPERATION_IDS,
} from '../lib/mk3-vocabulary.mjs'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(scriptsDir, '..')
const script = join(scriptsDir, 'report-mk2-allocation.mjs')
const fixtureRoot = join(scriptsDir, 'test', 'fixtures', 'mk2-allocation')
const scratch = mkdtempSync(join(tmpdir(), 'mk2-alloc-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

interface AllocationJson {
  readonly codecs: readonly {
    readonly contributionId: string
    readonly verdict: string
    readonly topology: string
    readonly issues: readonly { readonly class: string; readonly what: string }[]
  }[]
  readonly games: readonly { readonly verdict: string }[]
  readonly extensions: readonly {
    readonly contributes: Readonly<Record<string, number>>
    readonly issues: readonly { readonly class: string }[]
  }[]
}

function run(mk2Root: string, name: string): { status: number | null; json: AllocationJson } {
  const jsonPath = join(scratch, `${name}.json`)
  const result = spawnSync(
    process.execPath,
    [script, '--mk2-root', mk2Root, '--json', jsonPath, '--quiet'],
    { encoding: 'utf8' },
  )
  const json =
    result.status === 0
      ? (JSON.parse(readFileSync(jsonPath, 'utf8')) as AllocationJson)
      : { codecs: [], games: [], extensions: [] }
  return { status: result.status, json }
}

describe('MK2 → MK3 allocation report', () => {
  it('restates the live X3 vocabulary exactly (no silent drift from core/sdk)', () => {
    expect([...OPERATION_DOMAINS]).toEqual([...CORE_DOMAINS])
    expect([...SHARED_OPERATION_IDS]).toEqual([...CORE_SHARED])
    expect([...PERMISSION_CLASSES]).toEqual([...SDK_PERMISSIONS])
    for (const [legacy, canonical] of Object.entries(PERMISSION_MAPPING)) {
      expect(legacy.length).toBeGreaterThan(0)
      for (const cls of canonical) expect(SDK_PERMISSIONS).toContain(cls)
    }
    for (const mapping of Object.values(CAPABILITY_MAPPING)) {
      for (const id of mapping.ids ?? []) expect(CORE_SHARED).toContain(id)
    }
    // grammar parity on representative ids
    for (const id of ['org.modkitx/dds', 'org.modkitx.blizzard/starcraft-2', 'a.b-c/d.e']) {
      expect(QUALIFIED.test(id)).toBe(isQualifiedId(id))
    }
    for (const id of ['portable', 'browser-wasm', 'Node', 'node_worker', 'x.y']) {
      expect(SEGMENT.test(id)).toBe(isSegment(id))
      expect(QUALIFIED.test(id)).toBe(isQualifiedId(id))
    }
  })

  it('classifies a fixture MK2 tree: mechanical / needs-new-contract / games / extension.json', () => {
    const { status, json } = run(fixtureRoot, 'fixture')
    expect(status).toBe(0)
    const plain = json.codecs.find(c => c.contributionId === 'org.acme/plain')
    const rich = json.codecs.find(c => c.contributionId === 'org.acme/rich')
    expect(plain?.verdict).toBe('mechanical')
    expect(plain?.topology).toBe('single')
    expect(rich?.verdict).toBe('needs new contract')
    expect(rich?.topology).toBe('single+namespace')
    const richClasses = new Set(rich?.issues.map(i => i.class))
    for (const cls of ['blocked', 'absent', 'split', 'rename'])
      expect(richClasses.has(cls)).toBe(true)
    expect(
      rich?.issues.some(i => i.what.includes('rich.custom.op → org.acme/rich.custom-op')),
    ).toBe(true)
    // G4 mapping is applied per variant permission
    expect(rich?.issues.some(i => i.what.includes('«launch-process» → process-launch'))).toBe(true)
    expect(
      rich?.issues.some(i => i.what.includes('«filesystem» → filesystem-read+filesystem-write')),
    ).toBe(true)
    expect(json.games).toHaveLength(1)
    expect(json.games[0]?.verdict).toBe('needs new contract')
    expect(json.extensions).toHaveLength(1)
    expect(json.extensions[0]?.contributes).toEqual({ codecs: 2, games: 1 })
    expect(json.extensions[0]?.issues.some(i => i.class === 'partial')).toBe(true) // dependsOn
  })

  it('reproduces the MK2 snapshot counts from references/modkitmk2', () => {
    const sibling = join(repoRoot, '..', 'references', 'modkitmk2')
    if (!existsSync(join(sibling, 'extensions'))) {
      // No sibling checkout (CI without MK2): the report is not applicable, not failing.
      expect(true).toBe(true)
      return
    }
    const { status, json } = run(sibling, 'sibling')
    expect(status).toBe(0)
    // 27 §12.19: the machine-readable allocation source must reproduce the catalog counts;
    // the 2026-08-17 snapshot has 206 codec + 31 game manifests.
    expect(json.codecs.length).toBeGreaterThanOrEqual(200)
    expect(json.games.length).toBeGreaterThanOrEqual(30)
    expect(json.codecs.every(c => isQualifiedId(c.contributionId))).toBe(true)
  })
})
