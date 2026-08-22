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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  artifactByteSourceFromRandomAccess,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
  type SubjectInputResolver,
} from '@modkitx-x3/host'
import {
  createNodeExecutionBackends,
  loadExtensionDirectory,
  openFileSource,
} from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactSource,
  type AssetInput,
  type ArtifactByteSource,
  type ByteRangeSource,
  type JsonValue,
  type NamespaceEntrySource,
  type OpenIntent,
  type ModelSceneSource,
  type RasterImageSource,
  type ResolvedRequirementInputBinding,
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
  /** Data source contract that must answer its first request. */
  readonly dataSource: 'tree' | 'table' | 'byte-range' | 'model' | 'namespace' | 'raster'
  /** Optional exact RGBA8 oracle for a raster case's first decoded pixel. */
  readonly expectedFirstPixelRgba?: readonly [number, number, number, number]
  /**
   * What the host is told the subject is called. `path` passes the corpus-relative path, the way
   * a product opens a file inside a mount. `basename` passes the bare file name, which is what a
   * name-based rule cannot survive: it is how a case proves it routes on bytes (NXT-101B).
   */
  readonly route?: 'path' | 'basename' | 'opaque'
  /** Assert the selected candidate was admitted by its signature rather than by its name. */
  readonly expectSignatureMatch?: boolean
  /** `probe` is not an open intent; the harness always opens for real. */
  readonly intent?: Exclude<OpenIntent, 'probe'>
  readonly mediaType?: string
  /** Optional declared handler call used to prove more than namespace enumeration. */
  readonly operation?: {
    readonly handlerId: string
    readonly input: JsonValue
    readonly outputKind: 'bytes'
    readonly minimumBytes: number
  }
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
  model: 'common.view/model-scene-source',
  namespace: 'common.view/namespace-entry-source',
  raster: 'common.view/raster-image-source',
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

function exactCompanionPath(samplePath: string, pattern: string): string {
  if (pattern.length === 0 || /[*?\[\]]/u.test(pattern) || isAbsolute(pattern)) {
    throw new TypeError(
      `MK2 corpus resolver requires one exact relative companion path, got ${pattern}`,
    )
  }
  const root = dirname(samplePath)
  const target = resolve(root, pattern.replaceAll('/', sep).replaceAll('\\', sep))
  const fromRoot = relative(root, target)
  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new TypeError(`MK2 corpus companion escapes the sample directory: ${pattern}`)
  }
  return target
}

/**
 * Product-path fixture resolver. The codec returns exact requirements; this host-owned adapter
 * pins those files and constructs the bundle. It intentionally implements no globbing or search,
 * so a codec cannot smuggle path discovery through an acceptance-only convenience.
 */
function corpusInputResolver(samplePath: string): SubjectInputResolver {
  return async context => {
    if (context.signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const { plan, source } = context
    if (
      source.kind !== 'bytes' ||
      plan.originKind === 'namespace' ||
      plan.originKind === 'derived'
    ) {
      throw new TypeError(`MK2 corpus resolver cannot satisfy ${plan.originKind} topology`)
    }
    const candidate = plan.candidate
    const candidateBinding = Object.freeze({
      sourceKind: 'candidate' as const,
      bindingId: candidate.bindingId,
      role: candidate.role,
      ownership: candidate.ownership,
      source: source.ref,
      revision: source.revision,
    })
    if (plan.originKind === 'single') {
      if (plan.requirements.length !== 0)
        throw new TypeError('single input unexpectedly has requirements')
      return Object.freeze({
        originKind: 'single' as const,
        bindings: Object.freeze([candidateBinding] as const),
        primaryBindingId: candidateBinding.bindingId,
        revisions: Object.freeze({
          topology: 'single' as const,
          revision: source.revision,
          bindings: Object.freeze([
            Object.freeze({ bindingId: candidateBinding.bindingId, revision: source.revision }),
          ] as const),
          compositionFingerprint: JSON.stringify({
            topology: 'single',
            bindingId: candidateBinding.bindingId,
            source: candidateBinding.source,
            revision: source.revision,
          }),
        }),
        bindingsFor: () => Object.freeze([]),
        async openBinding(
          bindingId: string,
        ): Promise<{ value: ArtifactSource; release(): Promise<void> }> {
          if (bindingId !== candidateBinding.bindingId)
            throw new TypeError(`unknown input binding ${bindingId}`)
          return Object.freeze({ value: source, release: async () => undefined })
        },
      })
    }

    const requirementBindings: ResolvedRequirementInputBinding[] = []
    const sources = new Map<string, ArtifactSource>([[candidateBinding.bindingId, source]])
    for (const requirement of plan.requirements) {
      const [pattern] = requirement.patterns ?? []
      if (
        requirement.required !== true ||
        requirement.cardinality !== 'one' ||
        requirement.patterns?.length !== 1 ||
        pattern === undefined
      ) {
        throw new TypeError(
          `MK2 corpus resolver supports one exact required binding for ${requirement.id}`,
        )
      }
      const companionPath = exactCompanionPath(samplePath, pattern)
      if ((await stat(companionPath).catch(() => undefined))?.isFile() !== true) {
        throw new TypeError(`required MK2 corpus companion is missing: ${requirement.patterns[0]}`)
      }
      const companion = await corpusByteSource(companionPath)
      const bindingId = requirement.id
      if (sources.has(bindingId)) throw new TypeError(`duplicate input binding ${bindingId}`)
      sources.set(bindingId, companion)
      requirementBindings.push(
        Object.freeze({
          sourceKind: 'requirement' as const,
          bindingId,
          requirementId: requirement.id,
          role: requirement.role,
          ownership: requirement.ownership,
          source: companion.ref,
          revision: companion.revision,
        }),
      )
    }
    const bindings = Object.freeze([candidateBinding, ...requirementBindings])
    const revisions = Object.freeze(
      bindings.map(binding =>
        Object.freeze({
          bindingId: binding.bindingId,
          revision: binding.revision,
        }),
      ),
    )
    return Object.freeze({
      originKind: 'bundle' as const,
      bindings,
      primaryBindingId: candidateBinding.bindingId,
      revisions: Object.freeze({
        topology: 'bundle' as const,
        revision: source.revision,
        bindings: revisions,
        compositionFingerprint: JSON.stringify({
          topology: 'bundle',
          bindings: bindings.map(binding => ({
            bindingId: binding.bindingId,
            source: binding.source,
            revision: binding.revision,
          })),
        }),
      }),
      bindingsFor(requirementId: string) {
        return Object.freeze(
          requirementBindings.filter(binding => binding.requirementId === requirementId),
        )
      },
      async openBinding(
        bindingId: string,
      ): Promise<{ value: ArtifactSource; release(): Promise<void> }> {
        const resolved = sources.get(bindingId)
        if (resolved === undefined) throw new TypeError(`unknown input binding ${bindingId}`)
        return Object.freeze({ value: resolved, release: async () => undefined })
      },
    }) as AssetInput
  }
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
  const path =
    entry.route === 'basename'
      ? (entry.sample.split('/').at(-1) ?? '')
      : entry.route === 'opaque'
        ? 'opaque.bin'
        : entry.sample
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
    resolveInput: corpusInputResolver(samplePath),
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
    const global = result.diagnostics
      .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
      .join(', ')
    return {
      entry,
      corpus,
      state: 'failed',
      detail: `openSubject returned ${result.reason}${explanation === '' ? '' : ` (${explanation})`}${
        global === '' ? '' : ` [${global}]`
      }`,
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
    } else if (entry.dataSource === 'model') {
      const model = lease.value as ModelSceneSource
      const info = await model.info()
      const nodes = await model.nodes({ limit: 1 })
      if (info.scenes < 1 || nodes.items.length === 0) {
        return fail(`${contract} exposes no scene nodes`)
      }
    } else if (entry.dataSource === 'namespace') {
      const namespace = lease.value as NamespaceEntrySource
      const page = await namespace.list('', { limit: 1 })
      if (page.items.length === 0) return fail(`${contract} exposes no entries`)
    } else if (entry.dataSource === 'raster') {
      const raster = lease.value as RasterImageSource
      const info = await raster.info()
      if (info.width < 1 || info.height < 1 || raster.readRegion === undefined) {
        return fail(`${contract} exposes no decoded pixels`)
      }
      const region = await raster.readRegion({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        pixelFormat: 'rgba8',
        maxBytes: 4,
      })
      if (region.pixels.byteLength !== 4) return fail(`${contract} returned no RGBA pixel`)
      if (
        entry.expectedFirstPixelRgba !== undefined &&
        !entry.expectedFirstPixelRgba.every((value, index) => region.pixels[index] === value)
      ) {
        return fail(
          `${contract} first pixel was ${[...region.pixels].join(',')}, expected ${entry.expectedFirstPixelRgba.join(',')}`,
        )
      }
    } else {
      const table = lease.value as unknown as { columns(): Promise<readonly unknown[]> }
      const columns = await table.columns()
      if (columns.length === 0) return fail(`${contract} exposed no columns`)
    }
    await lease.release()
  } catch (error) {
    return fail(`${contract} threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (entry.operation !== undefined) {
    try {
      const operation = await result.session
        .operations()
        .invoke(entry.operation.handlerId, entry.operation.input)
      if (operation.state !== 'ok') {
        return fail(`${entry.operation.handlerId} was rejected: ${operation.reason}`)
      }
      if (operation.output.kind !== entry.operation.outputKind) {
        return fail(
          `${entry.operation.handlerId} returned ${operation.output.kind}, expected ${entry.operation.outputKind}`,
        )
      }
      if (
        operation.output.kind === 'bytes' &&
        operation.output.value.byteLength < entry.operation.minimumBytes
      ) {
        return fail(`${entry.operation.handlerId} returned too few bytes`)
      }
    } catch (error) {
      return fail(
        `${entry.operation.handlerId} threw: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
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
