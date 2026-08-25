/**
 * Block 11 exit gate — «ODT/Markdown use the shared flow viewer, ODS/CSV the table viewer,
 * ODG/SVG the vector viewer, with no format branch».
 *
 * The claim is about the *application*, so it is checked in the application: the real Electron
 * composition opens each file, and the shipped policy decides what the tab would offer. The stage
 * list is not hand-written here — it is read from the generated presentation catalog, so a stage
 * that ships is a stage this test sees. Nothing below names a format to the policy; it sees only
 * the contracts a descriptor publishes, which is exactly what makes the answer worth anything.
 *
 * The pairs are asserted as pairs. "ODS offers the table viewer" would also be satisfied by a
 * policy that offers the table viewer to everything; "ODS offers what CSV offers" would not.
 */

import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { PresentationSlot, ResourceBudget } from '@modkitx-x3/sdk'
import {
  createElectronSubjectServices,
  openFileArtifactSource,
  type ElectronSubjectServices,
} from '../src/index.js'
import {
  applicableStages,
  orderStages,
  preferredStage,
  type StageFacts,
} from '../src/view-policy.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const extensionsRoot = join(repositoryRoot, 'extensions')
const syntheticDir = join(
  repositoryRoot,
  'packages',
  'testkit',
  'test',
  'fixtures',
  'mk2-synthetic',
)

const require = createRequire(import.meta.url)
const presentation = require('../generated/presentation-catalog.cjs') as readonly PresentationSlot[]

/**
 * The shipped stages, as facts.
 *
 * Taken from the generated catalog rather than typed out, so this suite cannot drift from what the
 * app mounts. The viewer *modules* are deliberately not imported: they are browser bundles, and
 * the question here is which stage applies, which the policy answers from data alone. The trait
 * gate (`content.text` on the text stages) is not modelled because it only ever narrows, and both
 * halves of every pair below publish `content.text` — it cannot change a pair comparison.
 */
const STAGES: readonly StageFacts[] = orderStages(
  presentation
    .filter(slot => slot.kind === 'stage')
    .map(slot => ({
      id: slot.slotId,
      label: slot.slotId,
      // a stage binds exactly one source; the ref is a union with an opaque arm, and only the
      // contract name matters here
      contract: (slot.bindings[0] as { readonly contract?: string } | undefined)?.contract ?? '',
    })),
)

const budget: ResourceBudget = {
  maxInputBytes: 16_000_000n,
  maxDepth: 64,
  maxNodes: 200_000,
  maxScalarBytes: 8_000_000,
  maxDiagnostics: 200,
}
const grant = { id: 'odf-view-policy', classes: ['read-source'] } as const

const temporaries: string[] = []

// Sessions are disposed one by one as each file is read; the composition itself owns no handle to
// release (see `subject-open-smoke`, which tears down the same way).
afterAll(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

let shared: Promise<ElectronSubjectServices> | undefined

/** One composition for the whole suite: documents, delimited text and vector, nothing else. */
function subjects(): Promise<ElectronSubjectServices> {
  shared ??= createElectronSubjectServices([
    join(extensionsRoot, 'common', 'documents'),
    join(extensionsRoot, 'common', 'text-delimited'),
    join(extensionsRoot, 'common', 'vector'),
  ])
  return shared
}

interface Offered {
  readonly contributionId: string
  readonly stages: readonly string[]
  readonly first: string | undefined
}

/** Stage ids the Electron tab would offer for one file, in policy order. */
async function offeredFor(path: string): Promise<Offered> {
  const opened = await (
    await subjects()
  ).open({ source: await openFileArtifactSource(path), path, intent: 'full', grant, budget })
  if (opened.state !== 'opened') {
    throw new Error(`${path} did not open: ${JSON.stringify(opened.diagnostics)}`)
  }
  const descriptor = opened.descriptor as unknown as Record<string, unknown>
  const stages = applicableStages(STAGES, descriptor).map(stage => stage.id ?? stage.contract)
  await opened.session.dispose()
  return {
    contributionId: opened.selected.contributionId,
    stages,
    first: preferredStage(stages, undefined),
  }
}

const synthetic = (name: string): Promise<Offered> => offeredFor(join(syntheticDir, name))

/** The one format with no committed fixture; the smallest SVG the secure-static profile allows. */
async function svgFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'x3-odf-view-'))
  temporaries.push(directory)
  const path = join(directory, 'minimal.svg')
  await writeFile(
    path,
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>',
    'utf8',
  )
  return path
}

describe('block 11 exit gate: the ODF quartet reaches its viewer by contract, not by format', () => {
  it('gives ODS every stage CSV gets, led by the same one', async () => {
    const ods = await synthetic('minimal.ods')
    const csv = await synthetic('minimal.csv')
    expect(ods.contributionId).toBe('org.modkitx/ods')
    expect(csv.contributionId).toBe('org.modkitx/text-csv')
    // a spreadsheet is not a special case of anything: it offers what the delimited table offers
    expect(ods.stages).toEqual(expect.arrayContaining([...csv.stages]))
    expect(ods.first).toBe(csv.first)
    expect(ods.stages).toContain('table')
    // the difference is one *more* stage, from one more published source: the sheet/formula tree.
    // Richer is allowed; a different viewer for the same contract would not be.
    expect([...ods.stages].filter(id => !csv.stages.includes(id))).toEqual(['tree'])
  }, 120_000)

  it('gives ODG exactly the stages SVG gets, vector first', async () => {
    const odg = await synthetic('minimal.odg')
    const svg = await offeredFor(await svgFile())
    expect(odg.contributionId).toBe('org.modkitx/odg')
    expect(svg.contributionId).toBe('org.modkitx/vector-svg')
    expect(odg.stages).toEqual(svg.stages)
    expect(odg.stages).toContain('vector')
    expect(odg.first).toBe(svg.first)
  }, 120_000)

  it('previews ODP down the same vector path, and needs no slides stage to do it', async () => {
    const odp = await synthetic('minimal.odp')
    expect(odp.contributionId).toBe('org.modkitx/odp')
    expect(odp.stages).toContain('vector')
    // ADR-DOC-001: the deck is published for generic inspection and deliberately has no viewer in
    // this slice. A stage bound to it would have to be ranked in STAGE_ORDER; none is.
    expect(odp.stages).not.toContain('slides')
    expect(STAGES.some(stage => stage.contract === 'common.view/slide-deck-source')).toBe(false)
  }, 120_000)

  it('gives ODT the flow stages Markdown gets: no table, no scene', async () => {
    const odt = await synthetic('minimal.odt')
    const markdown = await synthetic('minimal.md')
    expect(odt.contributionId).toBe('org.modkitx/odt')
    expect(markdown.contributionId).toBe('org.modkitx/document-markdown')
    expect(odt.stages).toEqual(markdown.stages)
    expect(odt.stages).not.toContain('table')
    expect(odt.stages).not.toContain('vector')
  }, 120_000)
})
