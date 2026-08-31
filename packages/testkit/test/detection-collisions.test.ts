import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  DETECTION_UNTIE_RULES,
  linkedInProcessBackend,
  NATIVE_TEXT_INPUT,
  NATIVE_TEXT_MODULES,
  isDetectionUntieRule,
  registerServiceDefinitionsOrThrow,
  type Inventory,
  type SubjectServices,
} from '@modkitx-x3/host'
import { createPathSubjectOpener, loadExtensionDirectory } from '@modkitx-x3/host/node'
import type { ResourceBudget } from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'detection-collisions', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 50_000_000n,
  maxDepth: 64,
  maxNodes: 500_000,
  maxScalarBytes: 20_000_000,
  maxDiagnostics: 200,
}
const roots = [
  ['common', 'data'],
  ['common', 'archives'],
  ['common', 'documents'],
] as const
const executionBackends = createExecutionBackendRegistry([
  linkedInProcessBackend(NATIVE_TEXT_MODULES),
])

let subjects: SubjectServices
let directory: string

beforeAll(async () => {
  const inputs = await Promise.all(
    roots.map(async parts => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  const inventory: Inventory = await buildInventory(
    [NATIVE_TEXT_INPUT, ...inputs],
    createHostContributionContractRegistry(),
  )
  const serviceDefinitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
  subjects = createSubjectServices({ inventory, target, executionBackends, serviceDefinitions })
  directory = await mkdtemp(join(tmpdir(), 'x3-common-collisions-'))
})

afterAll(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
})

interface Verdict {
  readonly state: string
  readonly winner: string | undefined
  readonly confidence: number | undefined
  readonly detected: Readonly<Record<string, number>>
}

async function open(name: string, content: string | { fixture: string }): Promise<Verdict> {
  const path = join(directory, name)
  if (typeof content === 'string') await writeFile(path, content, 'latin1')
  else await copyFile(join(fixtures, content.fixture), path)
  const opener = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
  const { snapshot, session } = await opener(path)
  const detected: Record<string, number> = {}
  for (const candidate of (snapshot.candidates ?? []) as readonly {
    readonly state: string
    readonly confidence?: number
    readonly contributionId: string
  }[]) {
    if (candidate.state !== 'rejected' && candidate.confidence !== undefined) {
      detected[candidate.contributionId] = candidate.confidence
    }
  }
  let winner: string | undefined
  let confidence: number | undefined
  if (session !== undefined) {
    const descriptor = (await session.descriptor()) as unknown as {
      identity?: { codecId?: string }
    }
    winner = descriptor.identity?.codecId
    confidence = detected[winner ?? '']
    await session.dispose()
  }
  return { state: snapshot.state, winner, confidence, detected }
}

describe('common codec collision arbitration', () => {
  it('lets ODF beat its generic ZIP carrier', async () => {
    const verdict = await open('document.odt', { fixture: 'minimal.odt' })
    expect(verdict.state).toBe('opened')
    expect(verdict.winner).toBe('org.modkitx/odt')
    expect(verdict.detected['org.modkitx/archive-zip']).toBeTypeOf('number')
    expect(verdict.confidence).toBeGreaterThan(
      verdict.detected['org.modkitx/archive-zip'] as number,
    )
  })

  it.each([
    ['notes.txt', 'plain text\n', 'org.modkitx/txt'],
    ['settings.xml', '<settings><volume value="7"/></settings>\n', 'org.modkitx/text-xml'],
    ['stats.json', '{ "name": "Fixture" }\n', 'org.modkitx/text-json'],
  ] as const)('keeps the generic route for %s', async (name, sample, winner) => {
    const verdict = await open(name, sample)
    expect(verdict.state).toBe('opened')
    expect(verdict.winner).toBe(winner)
  })

  it('does not let a misleading ODF name decide a foreign payload', async () => {
    const verdict = await open('fake.odt', 'this is not a package at all\n')
    expect(verdict.winner).not.toBe('org.modkitx/odt')
    expect(verdict.detected['org.modkitx/odt']).toBe(0)
    expect(verdict.state).toBe('unresolved')
  })

  it('keeps every declared untie rule cited by common conformance', () => {
    const cited = new Set([
      'strictly-highest-confidence-wins',
      'an-exact-tie-is-ambiguous',
      'below-the-floor-is-no-match',
      'a-carrier-ranks-below-its-passengers',
      'a-second-signal-breaks-a-would-be-tie',
      'an-extension-alone-never-decides',
      'a-foreign-format-scores-zero-not-low',
      'a-signature-shortlists-but-does-not-select',
      'a-declaration-scopes-a-generic',
    ])
    for (const id of cited) expect(isDetectionUntieRule(id), id).toBe(true)
    expect(DETECTION_UNTIE_RULES.map(rule => rule.id).sort()).toEqual([...cited].sort())
  })
})
