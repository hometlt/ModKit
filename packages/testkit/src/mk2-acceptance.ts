/**
 * Acceptance harness for the MK2 → MK3 converted extensions (OPUS-MK2-01 task B, extended by
 * OPUS-MK2-02 tasks E/F/G).
 *
 * Not a parity harness: it never compares MK3 output with an MK2 implementation. It answers the
 * only question the conversion pipeline has to answer — does a converted extension, loaded the
 * way a product loads one, open a file and hand back a descriptor and a working data source?
 *
 * `loadExtensionDirectory → buildInventory → openSubject` is exactly the product path
 * (packages/host/test/subject-open.test.ts). Samples come from two corpora and the outcome says
 * which one:
 *
 *   * `real` — the sibling `modkitx` checkout, read-only, never copied into the lab. When that
 *     checkout is absent every real case reports `skipped`, so CI without MK2 stays green.
 *   * `synthetic` — `test/fixtures/mk2-synthetic`, written from format specifications by
 *     `scripts/gen-synthetic-corpus.mjs`. These always run. They prove structural opening
 *     (probe, descriptor, one data source); they do not prove fidelity against real encoders.
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  artifactByteSourceFromRandomAccess,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
} from '@modkitx-x3/host'
import {
  createNodeExecutionBackends,
  loadExtensionDirectory,
  openFileSource,
} from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type ByteRangeSource,
  type OpenIntent,
  type ResourceBudget,
  type RuntimeTarget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

/** Which corpus a sample comes from; the report counts ported codecs separately per corpus. */
export type Mk2CorpusKind = 'real' | 'synthetic'

/** One corpus case: a file and the converted codec that must claim it. */
export interface Mk2CorpusEntry {
  /** Extension directory relative to `extensions/`, posix — `mk2/common-images`, `common/images`. */
  readonly extension: string
  /** Contribution the host must select — a different winner is a failure, not a pass. */
  readonly contributionId: string
  /** `real` samples live in the MK2 checkout, `synthetic` ones in the generated fixtures. */
  readonly corpus?: Mk2CorpusKind
  /** Sample path relative to that corpus root, posix separators. */
  readonly sample: string
  /** Lower bound on the selected candidate's probe confidence. */
  readonly minimumConfidence: number
  /** Data source contract that must answer its first request; `tree`, `table` or `byte-range`. */
  readonly dataSource: 'tree' | 'table' | 'byte-range'
  /**
   * What the host is told the subject is called. `path` passes the corpus-relative path, the way
   * a product opens a file inside a mount. `basename` passes the bare file name, which is what a
   * name-based rule cannot survive: it is how a case proves it routes on bytes (NXT-101B).
   */
  readonly route?: 'path' | 'basename'
  /** Assert the selected candidate was admitted by its signature rather than by its name. */
  readonly expectSignatureMatch?: boolean
  /** `probe` is not an open intent; the harness always opens for real. */
  readonly intent?: Exclude<OpenIntent, 'probe'>
  readonly mediaType?: string
  readonly note?: string
}

export type Mk2AcceptanceState = 'opened' | 'skipped' | 'failed'

export interface Mk2AcceptanceOutcome {
  readonly entry: Mk2CorpusEntry
  readonly state: Mk2AcceptanceState
  readonly corpus: Mk2CorpusKind
  /** Why it skipped or failed; absent when it opened. */
  readonly detail?: string
  readonly confidence?: number
  readonly variantId?: string
  readonly formatId?: string
  /** The host admitted this candidate by a declared byte signature, not by its name or path. */
  readonly signatureMatch?: boolean
  readonly traits?: readonly string[]
  readonly dataSourceContracts?: readonly string[]
}

/** Whole-tree counters printed by the acceptance test and copied into the conversion report. */
export interface Mk2ConversionTally {
  /** Contribution manifests under `extensions/mk2/`. */
  readonly converted: number
  /** Of those, the ones whose spec declares byte signatures, so probe compares real bytes. */
  readonly probing: number
  /** Of those, the ones whose module is hand-ported (the generated marker is gone). */
  readonly ported: number
  /** Converted minus ported: still throwing `x3.mk2/port-pending`. */
  readonly pending: number
  /** Codecs whose conversion notes carry at least one debt entry. */
  readonly withNotes: number
  /** Codecs left with no candidate rule at all — `match.signatures` must be declared by hand. */
  readonly needsSignatures: number
  /** Codecs whose v1 manifest declared a plane (viewer, language, …) v2 cannot carry. */
  readonly lostPlanes: number
}

const GENERATED_MARKER = '@generated by scripts/convert-mk2.mjs'

const DEFAULT_BUDGET: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 8_000_000,
  maxDiagnostics: 100,
}

/** The harness runs in-process on the machine executing the test, never a synthetic target. */
function nodeRuntimeTarget(): RuntimeTarget {
  const operatingSystems: Readonly<Record<string, RuntimeTarget['operatingSystem']>> = {
    win32: 'windows',
    linux: 'linux',
    darwin: 'darwin',
    android: 'android',
  }
  const architectures: Readonly<Record<string, RuntimeTarget['architecture']>> = {
    x64: 'x64',
    ia32: 'x86',
    arm: 'arm32',
    arm64: 'arm64',
  }
  return {
    environment: 'node',
    operatingSystem: operatingSystems[process.platform] ?? 'linux',
    architecture: architectures[process.arch] ?? 'x64',
  }
}

const DATA_SOURCE_CONTRACTS = {
  tree: 'common.view/tree-data-source',
  table: 'common.view/table-data-source',
  'byte-range': 'common.view/byte-range-source',
} as const

function directoryExists(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true
}

/**
 * The MK2 checkout to read samples from: `MODKITX_MK2_ROOT` when set, else the sibling
 * `../modkitx`. `undefined` means "no corpus here" — callers skip instead of failing.
 */
export function resolveMk2Root(repoRoot: string, env = process.env): string | undefined {
  const override = env.MODKITX_MK2_ROOT
  const candidate = override === undefined ? join(repoRoot, '..', 'modkitx') : override
  return directoryExists(join(candidate, 'extensions')) ? candidate : undefined
}

/** Where `gen-synthetic-corpus.mjs` writes; committed, so it is always there. */
export function syntheticCorpusRoot(): string {
  return join(import.meta.dirname, '..', 'test', 'fixtures', 'mk2-synthetic')
}

/** Counts the converted tree without loading or executing anything in it. */
export function tallyMk2Conversion(mk2ExtensionsRoot: string): Mk2ConversionTally {
  const empty: Mk2ConversionTally = {
    converted: 0,
    probing: 0,
    ported: 0,
    pending: 0,
    withNotes: 0,
    needsSignatures: 0,
    lostPlanes: 0,
  }
  if (!directoryExists(mk2ExtensionsRoot)) return empty
  let converted = 0
  let probing = 0
  let ported = 0
  let withNotes = 0
  let needsSignatures = 0
  let lostPlanes = 0
  for (const extension of readdirSync(mk2ExtensionsRoot, { withFileTypes: true })) {
    if (!extension.isDirectory()) continue
    const directory = join(mk2ExtensionsRoot, extension.name)
    const contributions = join(directory, 'contributions')
    if (!directoryExists(contributions)) continue
    for (const file of readdirSync(contributions)) {
      if (!file.endsWith('.json')) continue
      converted += 1
      const manifest = JSON.parse(readFileSync(join(contributions, file), 'utf8')) as {
        readonly spec?: { readonly match?: { readonly signatures?: readonly unknown[] } }
        readonly runtimeVariants?: readonly { readonly entrypoint?: string }[]
      }
      if ((manifest.spec?.match?.signatures?.length ?? 0) > 0) probing += 1
      const entrypoint = manifest.runtimeVariants?.[0]?.entrypoint
      if (entrypoint === undefined) continue
      const modulePath = join(directory, ...entrypoint.split('/'))
      const source =
        statSync(modulePath, { throwIfNoEntry: false })?.isFile() === true
          ? readFileSync(modulePath, 'utf8')
          : undefined
      if (source !== undefined && !source.includes(GENERATED_MARKER)) ported += 1
    }
    // The debt file is inert data beside the extension, so counting it costs one read and no
    // parsing of the manifests it describes.
    const notesPath = join(directory, 'MK2-CONVERSION.json')
    if (statSync(notesPath, { throwIfNoEntry: false })?.isFile() !== true) continue
    const notes = JSON.parse(readFileSync(notesPath, 'utf8')) as {
      readonly codecs?: Readonly<
        Record<
          string,
          {
            readonly lostPlanes?: readonly unknown[]
            readonly renames?: readonly unknown[]
            readonly droppedOperations?: readonly unknown[]
            readonly needsSignatures?: boolean
          }
        >
      >
    }
    for (const debt of Object.values(notes.codecs ?? {})) {
      const carries =
        (debt.lostPlanes?.length ?? 0) > 0 ||
        (debt.renames?.length ?? 0) > 0 ||
        (debt.droppedOperations?.length ?? 0) > 0 ||
        debt.needsSignatures === true
      if (carries) withNotes += 1
      if (debt.needsSignatures === true) needsSignatures += 1
      if ((debt.lostPlanes?.length ?? 0) > 0) lostPlanes += 1
    }
  }
  return {
    converted,
    probing,
    ported,
    pending: converted - ported,
    withNotes,
    needsSignatures,
    lostPlanes,
  }
}

async function corpusByteSource(path: string): Promise<ArtifactByteSource> {
  const bytes = await readFile(path)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const random = await openFileSource(path)
  return artifactByteSourceFromRandomAccess(random, {
    ref: { id: random.id, uri: random.id },
    revision: revisionId(`content-hash.sha256:${digest}`),
  })
}

export interface Mk2AcceptanceOptions {
  /** Lab repository root (the directory holding `extensions/`). */
  readonly repoRoot: string
  /** MK2 checkout root; `undefined` skips every `real` case and leaves synthetic ones running. */
  readonly mk2Root: string | undefined
  /** Synthetic fixture root; defaults to the committed `test/fixtures/mk2-synthetic`. */
  readonly syntheticRoot?: string
  readonly budget?: ResourceBudget
  /**
   * Resolve the `portable` variant in a Node worker instead of the trusted in-process one. The
   * worker backend verifies every artifact file against the loader's digests before evaluating
   * it, so this is the case that proves a converted extension is self-contained.
   */
  readonly workerBrokered?: boolean
}

/**
 * Runs one corpus case end to end. Every failure mode is reported, never thrown, so one broken
 * port cannot hide the state of the others in the summary table.
 */
export async function runMk2AcceptanceCase(
  entry: Mk2CorpusEntry,
  options: Mk2AcceptanceOptions,
): Promise<Mk2AcceptanceOutcome> {
  const corpus: Mk2CorpusKind = entry.corpus ?? 'real'
  const corpusRoot =
    corpus === 'synthetic' ? (options.syntheticRoot ?? syntheticCorpusRoot()) : options.mk2Root
  if (corpusRoot === undefined) {
    return { entry, corpus, state: 'skipped', detail: 'no MK2 checkout beside the lab' }
  }
  const samplePath = join(corpusRoot, ...entry.sample.split('/'))
  if ((await stat(samplePath).catch(() => undefined))?.isFile() !== true) {
    return { entry, corpus, state: 'skipped', detail: `corpus sample is missing: ${entry.sample}` }
  }
  const directory = join(options.repoRoot, 'extensions', ...entry.extension.split('/'))
  if (!directoryExists(directory)) {
    return {
      entry,
      corpus,
      state: 'failed',
      detail: `converted extension is missing: ${entry.extension}`,
    }
  }

  const input = await loadExtensionDirectory(directory)
  const inventory = await buildInventory(
    [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
    createHostContributionContractRegistry(),
  )
  const source = await corpusByteSource(samplePath)
  // `path` is the corpus-relative path, the way a product opens a file inside a mount.
  // `basename` deliberately throws the path away: nothing about the name can help, so the only
  // way a candidate can reach probe is the declared byte signature.
  const path = entry.route === 'basename' ? (entry.sample.split('/').at(-1) ?? '') : entry.sample
  const result = await openSubject({
    inventory,
    source,
    path,
    ...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType }),
    intent: entry.intent ?? 'full',
    target:
      options.workerBrokered === true
        ? { ...nodeRuntimeTarget(), environment: 'node-worker' }
        : nodeRuntimeTarget(),
    grant: { id: `mk2-acceptance-${entry.contributionId}`, classes: ['read-source'] },
    executionBackends:
      options.workerBrokered === true
        ? createNodeExecutionBackends()
        : createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND]),
    budget: options.budget ?? DEFAULT_BUDGET,
  })

  if (result.state !== 'opened') {
    const explanation = result.candidates
      .map(candidate => {
        const why = candidate.diagnostics
          .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
          .join(', ')
        return `${candidate.contributionId}/${candidate.variantId}: ${candidate.state}${
          why === '' ? '' : ` — ${why}`
        }`
      })
      .join('; ')
    return {
      entry,
      corpus,
      state: 'failed',
      detail: `openSubject returned ${result.reason}${explanation === '' ? '' : ` (${explanation})`}`,
    }
  }

  const selected = result.selected
  const descriptor = result.descriptor
  const signatureMatch = result.candidates.some(
    candidate =>
      candidate.state === 'selected' &&
      candidate.diagnostics.some(diagnostic => diagnostic.code === 'x3.host/signature-match'),
  )
  const observed = {
    corpus,
    confidence: selected.confidence,
    variantId: selected.variantId,
    ...(descriptor.interpretation === 'codec' ? { formatId: descriptor.identity.formatId } : {}),
    signatureMatch,
    traits: descriptor.traits.map(trait => trait.id),
    dataSourceContracts: descriptor.dataSources.map(entryRef => entryRef.contract),
  }

  const fail = async (detail: string): Promise<Mk2AcceptanceOutcome> => {
    await result.session.dispose()
    return { entry, state: 'failed', detail, ...observed }
  }

  if (selected.contributionId !== entry.contributionId) {
    return fail(`selected ${selected.contributionId}, expected ${entry.contributionId}`)
  }
  if (selected.confidence < entry.minimumConfidence) {
    return fail(`confidence ${selected.confidence} is below ${entry.minimumConfidence}`)
  }
  if (entry.expectSignatureMatch === true && !signatureMatch) {
    return fail('the winning candidate was admitted by name, not by its declared signature')
  }

  // One declared data source has to answer its first request; a descriptor that promises a
  // source the session cannot lease is exactly the failure this harness exists to catch.
  const contract = DATA_SOURCE_CONTRACTS[entry.dataSource]
  try {
    const lease = await result.session.dataSource(contract, 1)
    if (entry.dataSource === 'byte-range') {
      const bytes = await (lease.value as ByteRangeSource).read(0n, 8)
      if (bytes.byteLength === 0) return fail(`${contract} returned an empty first read`)
    } else if (entry.dataSource === 'tree') {
      const tree = lease.value as TreeDataSource
      const root = await tree.root()
      const facts = await tree.facts(root)
      if (facts.label.length === 0) return fail(`${contract} root node has no label`)
    } else {
      const table = lease.value as unknown as { columns(): Promise<readonly unknown[]> }
      const columns = await table.columns()
      if (columns.length === 0) return fail(`${contract} exposed no columns`)
    }
    await lease.release()
  } catch (error) {
    return fail(`${contract} threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  await result.session.dispose()
  return { entry, state: 'opened', ...observed }
}

export async function runMk2Acceptance(
  entries: readonly Mk2CorpusEntry[],
  options: Mk2AcceptanceOptions,
): Promise<readonly Mk2AcceptanceOutcome[]> {
  const outcomes: Mk2AcceptanceOutcome[] = []
  for (const entry of entries) outcomes.push(await runMk2AcceptanceCase(entry, options))
  return outcomes
}

/** The converted / probing / ported / pending table task B asks the test to print. */
export function formatMk2AcceptanceTable(
  tally: Mk2ConversionTally,
  outcomes: readonly Mk2AcceptanceOutcome[],
): string {
  const openedIn = (corpus: Mk2CorpusKind): number =>
    outcomes.filter(outcome => outcome.state === 'opened' && outcome.corpus === corpus).length
  const lines: string[] = []
  lines.push('MK2 → MK3 conversion state')
  lines.push(`  converted        ${tally.converted}`)
  lines.push(`  with notes       ${tally.withNotes}  (MK2-CONVERSION.json carries debt)`)
  lines.push(`  probing          ${tally.probing}  (spec declares byte signatures)`)
  lines.push(`  needsSignatures  ${tally.needsSignatures}  (no candidate rule survives)`)
  lines.push(`  lost planes      ${tally.lostPlanes}  (v1 viewer/language entrypoints dropped)`)
  lines.push(`  ported           ${tally.ported}  (hand-written open())`)
  lines.push(`  port-pending     ${tally.pending}  (x3.mk2/port-pending)`)
  lines.push(`  opened on real corpus      ${openedIn('real')}`)
  lines.push(`  opened on synthetic corpus ${openedIn('synthetic')}`)
  lines.push('')
  const width = Math.max(12, ...outcomes.map(outcome => outcome.entry.contributionId.length))
  lines.push(`  ${'contribution'.padEnd(width)}  state    corpus     conf  route  sample`)
  for (const outcome of outcomes) {
    const confidence = outcome.confidence === undefined ? '—' : outcome.confidence.toFixed(3)
    const route = outcome.signatureMatch === true ? 'bytes' : 'name '
    lines.push(
      `  ${outcome.entry.contributionId.padEnd(width)}  ${outcome.state.padEnd(7)}  ${outcome.corpus.padEnd(
        9,
      )}  ${confidence.padStart(5)}  ${route}  ${outcome.entry.sample}${
        outcome.detail === undefined ? '' : `  [${outcome.detail}]`
      }`,
    )
  }
  return lines.join('\n')
}

/** Reads a corpus file written as data (`packages/testkit/test/fixtures/mk2-corpus.json`). */
export function loadMk2Corpus(path: string): readonly Mk2CorpusEntry[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { readonly entries?: unknown }
  if (!Array.isArray(parsed.entries)) throw new TypeError('mk2 corpus must carry an entries array')
  return parsed.entries as readonly Mk2CorpusEntry[]
}

/** Directory holding the converted extensions of a lab checkout. */
export function mk2ExtensionsRoot(repoRoot: string): string {
  return join(repoRoot, 'extensions', 'mk2')
}
