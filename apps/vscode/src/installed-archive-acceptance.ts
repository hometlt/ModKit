/**
 * The bounded Wave 2A evidence contract layered on top of the installed A7/A8 receipt.
 *
 * It deliberately names product actions, not codec internals: the installed harness drives the
 * editor's container commands and records their ordinary provider outcomes, including the
 * acceptance-gated native Save As bridge.  Keeping the receipt validator free of `vscode` lets a
 * missing phase stay red before an expensive installed-product run begins.
 */

export const INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS = Object.freeze([
  'mpq-tree-search-lazy',
  'casc-tree-search-lazy',
  'wz-tree-search-lazy',
  'casc-dds-nested-open',
  'casc-dds-materialize',
  'mpq-m3-nested-open',
  'mpq-m3-materialize',
  'wz-pie-nested-open',
  'wz-pie-materialize',
  'wte70-save-as-reopen',
  'armod-open',
  'corrupt-mpq-then-canary',
  'corrupt-casc-then-canary',
  'corrupt-wz-then-canary',
])

/*
 * ARmod's installed route reads 65,557 bytes of metadata from a 102 MB archive.  128 MiB leaves
 * room for the VS Code process-tree scheduling around that bounded read, while still making a
 * full unbounded archive materialization visible in the installed acceptance evidence.
 */
export const ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES = 128 * 1024 * 1024
export const ARMOD_EXTERNAL_PROCESS_TREE_MAX_OBSERVED_INTERVAL_MS = 15_000
export const ARMOD_EXTERNAL_PROCESS_TREE_MIN_SAMPLES = 3

const CORRUPT_AUTHORITIES = Object.freeze({
  'corrupt-mpq-then-canary': Object.freeze({
    family: 'mpq',
    route: 'file-container',
    contributionId: 'blizzard/mpq',
    formatId: 'mpq',
  }),
  'corrupt-casc-then-canary': Object.freeze({
    family: 'casc',
    route: 'casc-namespace',
    contributionId: 'blizzard/casc',
    formatId: 'casc',
  }),
  'corrupt-wz-then-canary': Object.freeze({
    family: 'wz',
    route: 'file-container',
    contributionId: 'modkit/warzone-wz',
    formatId: 'warzone-wz',
  }),
})

const SEARCH_AUTHORITIES = Object.freeze({
  'mpq-tree-search-lazy': Object.freeze({
    entry:
      'Assets/Doodads/SpacePlatform_LandingLights_NoLensFlare/avex_SpacePlatform_LandingLights_NoLensFlare.m3',
    query: 'LandingLights_NoLensFlare.m3',
  }),
  'casc-tree-search-lazy': Object.freeze({
    entry: 'campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds',
    query: 'alpha2.dds',
  }),
  'wz-tree-search-lazy': Object.freeze({
    entry: 'components/bodies/cybd_run.pie',
    query: 'cybd_run.pie',
  }),
})

export const INSTALLED_ARCHIVE_AUTHORITIES = Object.freeze({
  wte70: Object.freeze({
    path: 'Maps/ex/WTE70_Madlibrarian.SC2Map',
    bytes: 22_703,
    sha256: 'f654e212dcff3ffe3e1090e383b7b25fac4def2a723b4eda408c1b5cdfb2a305',
    savedBytes: 22_703,
    savedSha256: '695b36139334fca493bd89a7cad49524ef28e96a13f30334307106ed5149a312',
    modifiedWriterReceiptSha256: 'CDE80A9C7FD856D024B1FC3C7E95A8D4CF7922F330150CBE0C47B1D9A265D1AD',
  }),
  rustBucketM3: Object.freeze({
    path: 'Maps/RustBucketYZ.SC2Map',
    bytes: 4_342_646,
    sha256: '156e3cd8685baf6874efbe8ad083503af63b278f8c5b233af960be3f470e43b6',
    entry:
      'Assets/Doodads/SpacePlatform_LandingLights_NoLensFlare/avex_SpacePlatform_LandingLights_NoLensFlare.m3',
    entryBytes: 27_968,
    entrySha256: '4b5b6137720be779adf341790e75b134a026321181d8b37db96abf2669d250e8',
  }),
  cascDds: Object.freeze({
    entry: 'campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds',
    bytes: 824,
    sha256: 'b0a41b1a08611e2e6f6070c6c0f9122646389974e059793f37ac018874733b79',
  }),
  warzonePie: Object.freeze({
    container: 'data/base.wz',
    entry: 'components/bodies/cybd_run.pie',
    bytes: 22_053,
    sha256: '0674a8044d71f12c8f9362eae9efea946f5b0ba04b065d9d8b861eae669fef23',
  }),
  armod: Object.freeze({
    path: 'references/ARmod_4.0.1.wz',
    bytes: 102_362_635,
    sha256: '69997de6acbbccae87838d830958ad377cc5fa607587a61ff8dfefb1afb0f241',
    route: Object.freeze({
      extensionId: 'wz2100project/warzone-2100',
      contributionId: 'modkit/warzone-wz',
      variantId: 'trusted-node',
      entrypoint: './src/warzone-wz/range-codec.js',
      manifestDigest: 'sha256:9f09effbbae1ee1e9755619cc250085dd5581cee395154d4f44d21055d733d20',
      artifactDigest: 'sha256:f68011827cbc50bff184910c78776c6ffae39d4607f2827c77d6af7782556db9',
      installedManifestSha256:
        'sha256:777d236663780b6f327e60bd014be9eab09a3efb7921c2a1353c0bf84255f306',
    }),
  }),
})

const MATERIALIZATION_AUTHORITIES = Object.freeze({
  'casc-dds-materialize': Object.freeze({
    entry: INSTALLED_ARCHIVE_AUTHORITIES.cascDds.entry,
    target: 'wave2a-casc-alpha2.dds',
    bytes: INSTALLED_ARCHIVE_AUTHORITIES.cascDds.bytes,
    sha256: INSTALLED_ARCHIVE_AUTHORITIES.cascDds.sha256,
  }),
  'mpq-m3-materialize': Object.freeze({
    entry: INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entry,
    target: 'wave2a-rustbucket.m3',
    bytes: INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entryBytes,
    sha256: INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entrySha256,
  }),
  'wz-pie-materialize': Object.freeze({
    entry: INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.entry,
    target: 'wave2a-cybd_run.pie',
    bytes: INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.bytes,
    sha256: INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.sha256,
  }),
})

const NESTED_ROUTE_AUTHORITIES = Object.freeze({
  'casc-dds-nested-open': Object.freeze({
    parent: Object.freeze({ formatId: 'casc', contributionId: 'blizzard/casc' }),
    child: Object.freeze({ formatId: 'dds', contributionId: 'modkit/dds' }),
  }),
  'mpq-m3-nested-open': Object.freeze({
    parent: Object.freeze({ formatId: 'mpq', contributionId: 'blizzard/mpq' }),
    child: Object.freeze({ formatId: 'm3', contributionId: 'blizzard/m3' }),
  }),
  'wz-pie-nested-open': Object.freeze({
    parent: Object.freeze({
      formatId: 'warzone-wz',
      contributionId: 'modkit/warzone-wz',
    }),
    child: Object.freeze({ formatId: 'warzone-pie', contributionId: 'modkit/warzone-pie' }),
  }),
})

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u
const RECEIPT_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u
const GENERIC_BROWSE_REFUSAL = 'x3.app/vscode-not-a-container'

interface ArchiveCaseRecord {
  readonly caseId?: unknown
  readonly evidence?: unknown
  readonly verdict?: unknown
}

const objectOf = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} evidence is missing`)
  }
  return value as Readonly<Record<string, unknown>>
}

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const exactCases = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  JSON.stringify(value) === JSON.stringify(INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS)

const routeStepMatches = (
  value: unknown,
  expected: { readonly formatId: string; readonly contributionId: string },
): boolean => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const step = value as Readonly<Record<string, unknown>>
  return step.formatId === expected.formatId && step.contributionId === expected.contributionId
}

const exactDigest = (
  value: Readonly<Record<string, unknown>>,
  expected: { readonly bytes: number; readonly sha256: string },
): boolean =>
  value.bytes === expected.bytes &&
  value.sha256 === expected.sha256 &&
  typeof value.sha256 === 'string' &&
  SHA256_HEX_PATTERN.test(value.sha256)

/** Fail closed when a prior installed receipt omitted the Wave 2A generation-three phase. */
export function assertInstalledArchiveAcceptanceReceipt(value: unknown): asserts value is {
  readonly kind: 'x3.vscode-installed-archive-acceptance'
  readonly schemaVersion: 1
  readonly cases: readonly ArchiveCaseRecord[]
  readonly failures: readonly unknown[]
  readonly verdict: 'pass'
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Wave 2A archive acceptance is missing')
  }
  const receipt = value as Record<string, unknown>
  if (
    receipt.kind !== 'x3.vscode-installed-archive-acceptance' ||
    receipt.schemaVersion !== 1 ||
    !Array.isArray(receipt.cases) ||
    !Array.isArray(receipt.failures) ||
    receipt.verdict !== 'pass' ||
    !exactCases(receipt.expectedCases) ||
    typeof receipt.artifactSha256 !== 'string' ||
    !RECEIPT_SHA256_PATTERN.test(receipt.artifactSha256)
  ) {
    throw new TypeError('Wave 2A archive acceptance has the wrong receipt shape')
  }
  const actual = receipt.cases.map(item =>
    item !== null && typeof item === 'object' ? (item as ArchiveCaseRecord).caseId : undefined,
  )
  if (JSON.stringify(actual) !== JSON.stringify(INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS)) {
    throw new TypeError(`Wave 2A archive acceptance case order is ${JSON.stringify(actual)}`)
  }
  if (receipt.cases.some(item => (item as ArchiveCaseRecord).verdict !== 'pass')) {
    throw new TypeError('Wave 2A archive acceptance has a non-passing case')
  }
  if (receipt.failures.length !== 0) {
    throw new TypeError('Wave 2A archive acceptance reports failures')
  }
  const byId = new Map(
    receipt.cases.map(item => [
      String((item as ArchiveCaseRecord).caseId),
      item as ArchiveCaseRecord,
    ]),
  )
  for (const caseId of Object.keys(SEARCH_AUTHORITIES) as (keyof typeof SEARCH_AUTHORITIES)[]) {
    const evidence = objectOf(byId.get(caseId)?.evidence, caseId)
    const explorerMember = objectOf(evidence.explorerMember, caseId)
    const expected = SEARCH_AUTHORITIES[caseId]
    if (
      evidence.browseCommand !== 'modkit.browseContainer' ||
      evidence.explorerFileSystem !== 'modkit-container' ||
      (evidence.workspaceEffect !== 'added' && evidence.workspaceEffect !== 'already-present') ||
      evidence.searchCommand !== 'modkit.searchContainer' ||
      evidence.resultOnly !== false ||
      evidence.uiPickerObserved !== true ||
      evidence.inputBoxObserved !== true ||
      evidence.quickPickObserved !== true ||
      evidence.pickedLabel !== expected.entry ||
      evidence.requiredEntry !== expected.entry ||
      evidence.selectedRoute !== 'modkit-container' ||
      !nonEmptyString(evidence.selectedUri) ||
      !evidence.selectedUri.startsWith('modkit-container:') ||
      !evidence.selectedUri.endsWith(`/${expected.entry}`) ||
      evidence.query !== expected.query ||
      !Number.isSafeInteger(evidence.indexedFiles) ||
      !Number.isSafeInteger(evidence.explorerRootEntries) ||
      explorerMember.entry !== expected.entry ||
      explorerMember.kind !== 'file' ||
      !Number.isSafeInteger(explorerMember.size) ||
      evidence.extractionCountWhileIndexing !== 0 ||
      evidence.foreignExtractionCount !== 0
    ) {
      throw new TypeError(
        `${caseId} did not prove visible registered browse/search and lazy Explorer access`,
      )
    }
  }
  for (const caseId of Object.keys(
    MATERIALIZATION_AUTHORITIES,
  ) as (keyof typeof MATERIALIZATION_AUTHORITIES)[]) {
    const evidence = objectOf(byId.get(caseId)?.evidence, caseId)
    const corpus = objectOf(evidence.corpus, caseId)
    const extraction = objectOf(evidence.extraction, caseId)
    const expected = MATERIALIZATION_AUTHORITIES[caseId]
    if (
      evidence.command !== 'modkit.materializeContainerEntry' ||
      evidence.dialogBypass !== true ||
      evidence.target !== expected.target ||
      !exactDigest(corpus, expected) ||
      extraction.entry !== expected.entry ||
      !nonEmptyString(extraction.container) ||
      extraction.bytes !== expected.bytes
    ) {
      throw new TypeError(`${caseId} did not prove its registered explicit-target materialization`)
    }
  }
  for (const caseId of Object.keys(
    NESTED_ROUTE_AUTHORITIES,
  ) as (keyof typeof NESTED_ROUTE_AUTHORITIES)[]) {
    const evidence = objectOf(byId.get(caseId)?.evidence, caseId)
    const selected = objectOf(evidence.selected, caseId)
    const expected = NESTED_ROUTE_AUTHORITIES[caseId]
    if (
      !Array.isArray(evidence.selectedRoute) ||
      evidence.selectedRoute.length !== 2 ||
      !routeStepMatches(evidence.selectedRoute[0], expected.parent) ||
      !routeStepMatches(evidence.selectedRoute[1], expected.child) ||
      selected.contributionId !== expected.child.contributionId ||
      !nonEmptyString(selected.variantId)
    ) {
      throw new TypeError(`${caseId} did not prove its nested product route`)
    }
  }
  for (const caseId of [
    'corrupt-mpq-then-canary',
    'corrupt-casc-then-canary',
    'corrupt-wz-then-canary',
  ] as const) {
    const evidence = objectOf(byId.get(caseId)?.evidence, caseId)
    const refusal = objectOf(evidence.refusal, caseId)
    const canary = objectOf(evidence.appAlive, caseId)
    const expected = CORRUPT_AUTHORITIES[caseId]
    const attempted = objectOf(evidence.attempted, caseId)
    const attemptedDiagnostic = objectOf(attempted.diagnostic, caseId)
    if (
      evidence.family !== expected.family ||
      evidence.route !== expected.route ||
      !nonEmptyString(evidence.corpusMutation) ||
      evidence.failedStep !== 'container-index' ||
      attempted.contributionId !== expected.contributionId ||
      attempted.formatId !== expected.formatId ||
      attempted.state !== 'rejected' ||
      !nonEmptyString(attemptedDiagnostic.code) ||
      !nonEmptyString(attemptedDiagnostic.message) ||
      attemptedDiagnostic.code === GENERIC_BROWSE_REFUSAL ||
      refusal.source !== 'candidate-diagnostic' ||
      refusal.code !== attemptedDiagnostic.code ||
      refusal.message !== attemptedDiagnostic.message ||
      canary.validCascCanary !== true
    ) {
      throw new TypeError(
        `${caseId} did not prove a typed family refusal followed by an alive canary`,
      )
    }
  }
  const armodEvidence = objectOf(byId.get('armod-open')?.evidence, 'armod-open')
  const armodIo = objectOf(armodEvidence.metadataIo, 'armod-open')
  const armodInspection = objectOf(armodEvidence.inspection, 'armod-open')
  const armodDetection = objectOf(armodEvidence.selectedDetection, 'armod-open')
  const armodSelected = objectOf(armodEvidence.selected, 'armod-open')
  const externalMemory = objectOf(armodEvidence.externalProcessTreeMemory, 'armod-open')
  const externalMemoryStart = objectOf(externalMemory.startAcknowledgement, 'armod-open')
  const externalMemoryStop = objectOf(externalMemory.stopAcknowledgement, 'armod-open')
  const externalWorkingSet = objectOf(externalMemoryStop.workingSetBytes, 'armod-open')
  const externalPrivateBytes = objectOf(externalMemoryStop.privateBytes, 'armod-open')
  const externalSamples = Array.isArray(externalMemoryStop.samples)
    ? externalMemoryStop.samples.map((sample, index) =>
        objectOf(sample, `armod-open external process-tree sample ${index + 1}`),
      )
    : []
  const externalObservedCadence = objectOf(
    externalMemoryStop.observedCadence,
    'armod-open external process-tree observed cadence',
  )
  const extensionHostRss = objectOf(armodEvidence.extensionHostRss, 'armod-open')
  const externalSampleCount = externalMemoryStop.sampleCount
  const extensionHostRssBaselineBytes = extensionHostRss.baselineBytes
  const extensionHostRssPeakBytes = extensionHostRss.peakBytes
  const extensionHostRssDeltaBytes = extensionHostRss.deltaBytes
  const armodRoute = INSTALLED_ARCHIVE_AUTHORITIES.armod.route
  const validExternalMetric = (metric: Readonly<Record<string, unknown>>): boolean => {
    const baselineBytes = metric.baselineBytes
    const peakBytes = metric.peakBytes
    const deltaBytes = metric.deltaBytes
    return (
      typeof baselineBytes === 'number' &&
      Number.isSafeInteger(baselineBytes) &&
      baselineBytes >= 0 &&
      typeof peakBytes === 'number' &&
      Number.isSafeInteger(peakBytes) &&
      peakBytes >= baselineBytes &&
      typeof deltaBytes === 'number' &&
      Number.isSafeInteger(deltaBytes) &&
      deltaBytes === peakBytes - baselineBytes &&
      metric.deltaCeilingBytes === ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES &&
      deltaBytes <= ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES
    )
  }
  const validExternalCadence = (
    samples: readonly Readonly<Record<string, unknown>>[],
    cadence: Readonly<Record<string, unknown>>,
  ): boolean => {
    if (samples.length < 2) return false
    const safeTimestamps: number[] = []
    for (const sample of samples) {
      const timestampMs = sample.timestampMs
      if (
        typeof timestampMs !== 'number' ||
        !Number.isSafeInteger(timestampMs) ||
        !Number.isSafeInteger(sample.workingSetBytes) ||
        !Number.isSafeInteger(sample.privateBytes)
      ) {
        return false
      }
      safeTimestamps.push(timestampMs)
    }
    const intervals: number[] = []
    for (let index = 1; index < safeTimestamps.length; index += 1) {
      const previous = safeTimestamps[index - 1]
      const current = safeTimestamps[index]
      // Strictly increasing timestamps are what makes the sampled cadence readable at all.
      if (previous === undefined || current === undefined || current <= previous) return false
      intervals.push(current - previous)
    }
    const averageIntervalMs =
      intervals.reduce((total, interval) => total + interval, 0) / intervals.length
    return (
      cadence.intervalCount === intervals.length &&
      cadence.minIntervalMs === Math.min(...intervals) &&
      cadence.maxIntervalMs === Math.max(...intervals) &&
      cadence.averageIntervalMs === averageIntervalMs &&
      typeof cadence.averageIntervalMs === 'number' &&
      Number.isFinite(cadence.averageIntervalMs) &&
      cadence.minIntervalMs > 0 &&
      cadence.maxIntervalMs >= cadence.minIntervalMs &&
      cadence.maxIntervalMs <= ARMOD_EXTERNAL_PROCESS_TREE_MAX_OBSERVED_INTERVAL_MS &&
      cadence.averageIntervalMs >= cadence.minIntervalMs &&
      cadence.averageIntervalMs <= cadence.maxIntervalMs
    )
  }
  if (
    armodEvidence.installedManifestSha256 !== armodRoute.installedManifestSha256 ||
    armodEvidence.entrypoint !== armodRoute.entrypoint ||
    armodSelected.extensionId !== armodRoute.extensionId ||
    armodSelected.contributionId !== armodRoute.contributionId ||
    armodSelected.variantId !== armodRoute.variantId ||
    !Array.isArray(armodEvidence.selectedRoute) ||
    !routeStepMatches(armodEvidence.selectedRoute.at(-1), {
      formatId: 'warzone-wz',
      contributionId: armodRoute.contributionId,
    }) ||
    externalMemoryStart.kind !== 'x3.vscode-installed-archive-acceptance-ack' ||
    externalMemoryStart.schemaVersion !== 1 ||
    externalMemoryStart.artifactSha256 !== receipt.artifactSha256 ||
    externalMemoryStart.generation !== 3 ||
    externalMemoryStart.caseId !== 'armod-open' ||
    externalMemoryStart.stage !== 'armod-memory-sampling-start' ||
    externalMemoryStart.observedBy !== 'external-process-tree' ||
    externalMemoryStart.collector !== 'Win32_Process' ||
    externalMemoryStart.requestedSampleIntervalMs !== 25 ||
    externalMemoryStart.verdict !== 'pass' ||
    externalMemoryStop.kind !== 'x3.vscode-installed-archive-acceptance-ack' ||
    externalMemoryStop.schemaVersion !== 1 ||
    externalMemoryStop.artifactSha256 !== receipt.artifactSha256 ||
    externalMemoryStop.generation !== 3 ||
    externalMemoryStop.caseId !== 'armod-open' ||
    externalMemoryStop.stage !== 'armod-memory-sampling-stop' ||
    externalMemoryStop.observedBy !== 'external-process-tree' ||
    externalMemoryStop.collector !== 'Win32_Process' ||
    externalMemoryStop.requestedSampleIntervalMs !== 25 ||
    externalMemoryStop.verdict !== 'pass' ||
    !Array.isArray(externalMemoryStop.matchedRootPids) ||
    externalMemoryStop.matchedRootPids.length === 0 ||
    externalMemoryStop.matchedRootPids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) ||
    !Array.isArray(externalMemoryStop.descendantPids) ||
    externalMemoryStop.descendantPids.length === 0 ||
    externalMemoryStop.descendantPids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) ||
    typeof externalSampleCount !== 'number' ||
    !Number.isSafeInteger(externalSampleCount) ||
    externalSampleCount < ARMOD_EXTERNAL_PROCESS_TREE_MIN_SAMPLES ||
    !Array.isArray(externalMemoryStop.samples) ||
    externalSamples.length !== externalSampleCount ||
    !validExternalCadence(externalSamples, externalObservedCadence) ||
    !Array.isArray(externalMemoryStop.errors) ||
    externalMemoryStop.errors.length !== 0 ||
    !validExternalMetric(externalWorkingSet) ||
    !validExternalMetric(externalPrivateBytes) ||
    extensionHostRss.source !== 'process.memoryUsage().rss' ||
    typeof extensionHostRssBaselineBytes !== 'number' ||
    !Number.isSafeInteger(extensionHostRssBaselineBytes) ||
    typeof extensionHostRssPeakBytes !== 'number' ||
    !Number.isSafeInteger(extensionHostRssPeakBytes) ||
    typeof extensionHostRssDeltaBytes !== 'number' ||
    !Number.isSafeInteger(extensionHostRssDeltaBytes) ||
    extensionHostRssPeakBytes < extensionHostRssBaselineBytes ||
    extensionHostRssDeltaBytes !== extensionHostRssPeakBytes - extensionHostRssBaselineBytes ||
    extensionHostRss.deltaCeilingBytes !== ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES ||
    extensionHostRssDeltaBytes > extensionHostRss.deltaCeilingBytes ||
    !Number.isSafeInteger(armodIo.readCount) ||
    !Number.isSafeInteger(armodIo.bytes) ||
    !Number.isSafeInteger(armodIo.maxReadBytes) ||
    armodIo.readCount !== 8 ||
    armodIo.bytes !== 70_978 ||
    armodIo.maxReadBytes !== 65_557 ||
    armodIo.streamCount !== 0 ||
    armodInspection.inspectionMode !== 'metadata-first-range' ||
    armodInspection.sourceBytes !== '102362635' ||
    armodInspection.metadataBytesRead !== 65_557 ||
    armodDetection.formatId !== 'warzone-wz' ||
    armodDetection.manifestDigest !== armodRoute.manifestDigest ||
    armodDetection.artifactDigest !== armodRoute.artifactDigest
  ) {
    throw new TypeError(
      'armod-open did not prove bounded metadata-first installed-route telemetry and external process-tree memory',
    )
  }
  const saveAs = byId.get('wte70-save-as-reopen')
  const saveAsEvidence = saveAs?.evidence
  const source =
    saveAsEvidence !== null && typeof saveAsEvidence === 'object' && !Array.isArray(saveAsEvidence)
      ? objectOf((saveAsEvidence as Record<string, unknown>).source, 'wte70-save-as-reopen source')
      : undefined
  const saved =
    saveAsEvidence !== null && typeof saveAsEvidence === 'object' && !Array.isArray(saveAsEvidence)
      ? objectOf((saveAsEvidence as Record<string, unknown>).saved, 'wte70-save-as-reopen saved')
      : undefined
  const nativeWriterReceipt =
    saveAsEvidence !== null && typeof saveAsEvidence === 'object' && !Array.isArray(saveAsEvidence)
      ? objectOf(
          (saveAsEvidence as Record<string, unknown>).nativeWriterReceipt,
          'wte70-save-as-reopen native writer receipt',
        )
      : undefined
  const changedEntries =
    nativeWriterReceipt !== undefined && Array.isArray(nativeWriterReceipt.changed)
      ? nativeWriterReceipt.changed
      : []
  const changedMapScript = changedEntries.find(
    item =>
      item !== null &&
      typeof item === 'object' &&
      (item as Record<string, unknown>).path === 'MapScript.galaxy',
  )
  const elapsedMs =
    saveAsEvidence !== null && typeof saveAsEvidence === 'object' && !Array.isArray(saveAsEvidence)
      ? (saveAsEvidence as Record<string, unknown>).elapsedMs
      : undefined
  const saveOperationElapsedMs =
    saveAsEvidence !== null && typeof saveAsEvidence === 'object' && !Array.isArray(saveAsEvidence)
      ? (saveAsEvidence as Record<string, unknown>).saveOperationElapsedMs
      : undefined
  if (
    saveAsEvidence === null ||
    typeof saveAsEvidence !== 'object' ||
    Array.isArray(saveAsEvidence) ||
    (saveAsEvidence as Record<string, unknown>).bridge !== 'live-custom-document-save-as' ||
    (saveAsEvidence as Record<string, unknown>).providerMethod !==
      'CustomEditorProvider.saveCustomDocumentAs' ||
    (saveAsEvidence as Record<string, unknown>).mode !== 'live-provider-bridge' ||
    (saveAsEvidence as Record<string, unknown>).acceptanceGated !== true ||
    (saveAsEvidence as Record<string, unknown>).cleanCopy !== false ||
    (saveAsEvidence as Record<string, unknown>).nativeUserCommandProof !== false ||
    (saveAsEvidence as Record<string, unknown>).nativeWriterProof !== true ||
    (saveAsEvidence as Record<string, unknown>).classification !==
      'installed-acceptance-native-writer-save-as' ||
    (saveAsEvidence as Record<string, unknown>).sourceObservedByCdp !== true ||
    (saveAsEvidence as Record<string, unknown>).targetObservedByCdp !== true ||
    (saveAsEvidence as Record<string, unknown>).elapsedScope !== 'save-as-through-cdp-reopen' ||
    (saveAsEvidence as Record<string, unknown>).sourceUnchanged !== true ||
    (saveAsEvidence as Record<string, unknown>).modifiedWriterReceiptSha256 !==
      INSTALLED_ARCHIVE_AUTHORITIES.wte70.modifiedWriterReceiptSha256 ||
    nativeWriterReceipt === undefined ||
    nativeWriterReceipt.kind !== 'mpq-native-export-receipt-v1' ||
    nativeWriterReceipt.strategy !== 'whole-archive-save-as-fixed-slots' ||
    nativeWriterReceipt.archiveByteIdentity !== 'changed' ||
    nativeWriterReceipt.sourceArchiveDigest !==
      `sha256:${INSTALLED_ARCHIVE_AUTHORITIES.wte70.sha256}` ||
    nativeWriterReceipt.outputArchiveDigest !==
      `sha256:${INSTALLED_ARCHIVE_AUTHORITIES.wte70.savedSha256}` ||
    changedMapScript === undefined ||
    typeof elapsedMs !== 'number' ||
    elapsedMs >= 60_000 ||
    typeof saveOperationElapsedMs !== 'number' ||
    saveOperationElapsedMs < 0 ||
    saveOperationElapsedMs > elapsedMs ||
    source === undefined ||
    source.bytes !== INSTALLED_ARCHIVE_AUTHORITIES.wte70.bytes ||
    source.sha256 !== INSTALLED_ARCHIVE_AUTHORITIES.wte70.sha256 ||
    saved === undefined ||
    saved.bytes !== INSTALLED_ARCHIVE_AUTHORITIES.wte70.savedBytes ||
    saved.sha256 !== INSTALLED_ARCHIVE_AUTHORITIES.wte70.savedSha256 ||
    String(saved.sha256) === String(source.sha256)
  ) {
    throw new TypeError('Wave 2A WTE70 Save As did not prove the live custom-document bridge')
  }
}
