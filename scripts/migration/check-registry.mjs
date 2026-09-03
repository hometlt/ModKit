#!/usr/bin/env node
// Semantic capability registry and projection matrix validator
// (PLAN_MODKIT_MK3_FINAL_RU.md §3.3–3.4, блок 10 работы 4–6, 10–11).
//
// migration/capabilities.yaml and migration/projections.yaml are a hand+machine hybrid: the
// skeleton was derived from the sealed-oracle inventory and the X3 ratchets, the semantic fields
// are authored. Nothing regenerates them, so this gate re-derives every machine fact from the same
// sources and compares — a hand-written allocation, parity status or evidence level cannot drift
// away from the tree without failing here.
//
// What it proves:
//   1. canonical form — the artifacts parse in the canonical YAML subset, keys follow the canonical
//      order and rows are sorted, so the hybrid stays reviewable and deterministic;
//   2. every row carries an owner, an obligation and a planned block;
//   3. every sourceUnitId exists in migration/generated/source-inventory.json;
//   4. no source unit is lost: each inventory unit is either mapped by at least one capability or
//      covered by exactly one explicit unmapped rule with a reason, a plan and an exact count;
//   5. allocation coverage and implementation/evidence state are different fields, and evidence is
//      earned rather than inherited from allocation;
//   6. the scope lock holds and frozen owner additions cannot silently widen the release scope;
//   7. the projection matrix respects its own declared invariants.
//
// Usage: node scripts/migration/check-registry.mjs [--registry <path>] [--projections <path>]
//                                                  [--inventory <path>] [--workflow-ledger <path>]
//                                                  [--parity-report <path>] [--artifacts <path>]
//                                                  [--quiet]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseCanonicalYaml } from './lib/canonical-yaml.mjs'
import { externalRepositoryRoot } from './lib/external-extension-roots.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const quiet = args.includes('--quiet')
const registryPath = path.resolve(
  argValue('--registry') ?? path.join(repoRoot, 'migration/capabilities.yaml'),
)
const projectionsPath = path.resolve(
  argValue('--projections') ?? path.join(repoRoot, 'migration/projections.yaml'),
)
const inventoryPath = path.resolve(
  argValue('--inventory') ?? path.join(repoRoot, 'migration/generated/source-inventory.json'),
)
const workflowLedgerPath = path.resolve(
  argValue('--workflow-ledger') ??
    path.join(repoRoot, 'migration/generated/vscode-workflow-ledger.json'),
)
const parityReportPath = path.resolve(
  argValue('--parity-report') ?? path.join(repoRoot, 'reports/parity/latest.json'),
)

const problems = []
const fail = message => problems.push(message)
// A rule that cannot be evaluated (its source data is missing) is not the same as a rule that
// passed. It must never be silent: every entry here is printed in its own section, separate from
// `problems`, in both branches of the verdict below, and it forces the same non-zero exit a real
// problem would — an unavailable check is not a clean run.
const unavailableChecks = []
const flagUnavailable = message => unavailableChecks.push(message)
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
// Same blind spot as deriveX3Facts, one layer over: a proof path is only as good as the repository
// this resolves it into. `extensions/ea/` and `extensions/opensource/spring/` were unhandled — not
// because those repositories are absent (modkit.workspace.json has always declared both) but
// because nobody added the branch when they joined blizzard/warzone/other here. Both additions
// below are verified against the real checkouts: `extensions/ea/emperor/test/emperor-xbf-depth.test.ts`
// resolves to `emperor/test/emperor-xbf-depth.test.ts` in modkit-extensions-ea, and
// `extensions/opensource/spring/test/codec.test.ts` resolves to `test/codec.test.ts` in
// modkit-extensions-spring; both files exist on disk. Before this fix every proof path under either
// prefix fell through to the `repoRoot`-relative default and was reported as "does not exist" —
// not because the test was deleted (that is a real, separate registry problem elsewhere in this
// run) but because this function never looked in the right repository.
const resolvedProductPath = value => {
  const portable = value.replaceAll('\\', '/')
  if (portable.startsWith('extensions/blizzard/')) {
    return path.join(
      externalRepositoryRoot(repoRoot, 'blizzard'),
      portable.slice('extensions/blizzard/'.length),
    )
  }
  if (portable.startsWith('extensions/opensource/warzone-2100/')) {
    return path.join(
      externalRepositoryRoot(repoRoot, 'warzone'),
      portable.slice('extensions/opensource/warzone-2100/'.length),
    )
  }
  if (portable.startsWith('extensions/ea/')) {
    return path.join(
      externalRepositoryRoot(repoRoot, 'ea'),
      portable.slice('extensions/ea/'.length),
    )
  }
  if (portable.startsWith('extensions/opensource/spring/')) {
    return path.join(
      externalRepositoryRoot(repoRoot, 'spring'),
      portable.slice('extensions/opensource/spring/'.length),
    )
  }
  if (portable.startsWith('extensions/ps1/')) {
    return path.join(
      externalRepositoryRoot(repoRoot, 'other'),
      portable.slice('extensions/'.length),
    )
  }
  return path.join(repoRoot, value)
}

// --- canonical shape -----------------------------------------------------------------------------

const CAPABILITY_KEYS = [
  'capabilityId',
  'userScenario',
  'releaseTrack',
  'origin',
  'obligation',
  'owner',
  'plannedBlock',
  'dependsOn',
  'sourceUnitIds',
  'legacyEvidence',
  'hostFacilities',
  'mk3Contributions',
  'mk3Operations',
  'allocation',
  'migrationState',
  'supportState',
  'runtimeAvailability',
  'evidenceLevel',
  'hostEvidence',
  'writerEvidence',
  'parityEvidence',
  'fixtures',
  'corpusDescriptors',
  'projection',
  'knownLoss',
  'receipts',
  'replacementWorkflow',
  'closedBy',
]
const ALLOCATION_KEYS = ['state', 'x3ContributionId', 'portFamily', 'portVerdict']
/*
 * Receipt slots (GA recovery step 2C, finding F26).
 *
 * The first three are projection receipts: they say a machine-checkable artefact was issued for a
 * projection, a materialization or a native export. `installedHost` is a different kind of claim
 * and needed its own slot: it names the *acceptance run* in which a live workflow of this row
 * passed inside an installed application, as `<receipt path>#<anchor>`. Both halves are load
 * bearing. A receipt without an anchor points at a run and leaves the reader to guess which part
 * of it belongs to this row, which is how `vscode-manual-pending` became a permanent car park.
 */
const RECEIPT_KEYS = ['projection', 'materialization', 'nativeExport', 'installedHost']
const PARITY_KEYS = ['coverageStatus', 'rows', 'corpusKinds', 'verdicts', 'liveSources']
const PROJECTION_KEYS = [
  'plane',
  'liveProjection',
  'portableMaterialization',
  'opaquePreservation',
  'nativeExport',
  'operations',
]

/*
 * Operation-level projection evidence (block 12 item 10).
 *
 * The four state fields above answer "does a projection of this kind exist", which is not the same
 * question as "which operations over it are actually proven" — and a single badge let a row that
 * proved `inspect` read as though it had proved `materialize` too. Each operation now names the
 * test that proves it, or `null`, and null is the honest default: an unproven operation is the
 * normal state for most rows and says so.
 *
 * The rule below is what stops the field from becoming decorative: a named test must also appear in
 * the row's own `closedBy.tests`, so evidence cannot be claimed by pointing at a file nobody
 * connected to this capability.
 */
const PROJECTION_OPERATION_KEYS = ['inspect', 'validate', 'read', 'materialize']

const ENUMS = {
  releaseTrack: ['mk3-priority', 'multiverse-priority', 'deferred-games-priority', 'post-ga'],
  origin: ['legacy', 'owner-addition'],
  obligation: [
    'legacy-required',
    'focused-required-addition',
    'post-ga-required-proof',
    'experimental-optional',
  ],
  // `superseded-staging-present` is the honest third state block 11 produced: the legacy id still
  // physically exists under extensions/mk2/** but no longer wins routing, the named replacement is
  // the single active route, and physical removal belongs to the block-30 mk2 emptying.
  allocationState: [
    'covered',
    'superseded',
    'superseded-staging-present',
    'absent',
    'not-applicable',
  ],
  migrationState: [
    'implemented',
    'equivalent-better',
    'relocated-multiverse',
    'superseded',
    'partial',
    'missing',
    'blocked',
    'unknown',
    'deferred-post-ga',
  ],
  supportState: ['supported', 'partial', 'unsupported', 'unknown'],
  runtimeAvailability: [
    'browser-and-node',
    'browser-only',
    'node-only',
    'host-facility-dependent',
    'none',
  ],
  evidenceLevel: ['E0', 'E1', 'E2', 'E3', 'E4', 'E5'],
  writerEvidence: [
    'not-declared',
    'declared-not-proven',
    'write-reopen-compared',
    'write-reopen-compared-metadata-plane',
  ],
  projectionState: ['none', 'planned', 'live', 'materialized', 'proven', 'not-applicable'],
  action: [
    'defer',
    'edit',
    'execute',
    'export-native',
    'materialize',
    'preserve-opaque',
    'project-live',
    'retain',
  ],
  artifactMaturity: ['reader-only', 'reader-and-writer', 'writer-only', 'none'],
  // ADR-DOC-001. `admitted` is the settled state; `publisher-candidate` is a shape proved by one
  // publisher only. The vocabulary mirrors packages/sdk DATA_SOURCE_MATURITY, and
  // scripts/test/migration-registry.test.ts pins the two together so neither can drift alone.
  facetMaturity: ['admitted', 'publisher-candidate'],
}

/*
 * `hostEvidence` grammar (GA recovery step 2C, finding F26).
 *
 * Until 2C this was a flat five-value enum with two holes in it.
 *
 * The first hole: there was no value at all for "this passed in an **installed** application",
 * even though the installed acceptance of waves 1–2 exists and leaves receipts. The strongest
 * evidence the programme produces could not be written down, so it was not written down.
 *
 * The second hole: `vscode-manual-pending` had no end. A row could sit in it indefinitely and
 * nothing went red, which is the opposite of what a pending state is for. It now has to name the
 * wave that will close it, in the value itself, where a reader cannot miss it.
 *
 * `vscode-installed` is deliberately *not* self-certifying: the row must also fill
 * `receipts.installedHost` with a receipt and an anchor, and — when the receipt tree is at hand —
 * that receipt is opened and the anchor looked up in it. Editing this field cannot turn a gate
 * green on its own; the run has to have happened.
 */
const HOST_EVIDENCE_VALUES = [
  'none',
  'node',
  'node-and-browser-worker',
  'electron-smoke',
  'vscode-installed',
]
const HOST_EVIDENCE_PENDING = 'vscode-manual-pending'
const HOST_EVIDENCE_PENDING_PATTERN = /^vscode-manual-pending@wave-(?:[0-9]+[A-Z]?|[a-z0-9-]+)$/u
/** `<receipt under artifacts/**>#<anchor id>`; both halves required, neither may be empty. */
const INSTALLED_HOST_RECEIPT_PATTERN = /^(artifacts\/[^#\s]+\.receipt\.json)#([^#\s][^#]*)$/u

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))

function checkKeyOrder(label, value, expected) {
  const actual = Object.keys(value)
  if (actual.join(',') !== expected.join(',')) {
    fail(
      `${label}: keys are not in canonical order\n    expected ${expected.join(', ')}\n    found    ${actual.join(', ')}`,
    )
  }
}

function checkEnum(label, field, value, allowed) {
  if (!allowed.includes(value))
    fail(`${label}: ${field} "${value}" is not one of ${allowed.join(' | ')}`)
}

/*
 * Acceptance receipts live beside the checkouts rather than inside one: a run of the installed
 * application is evidence about the *programme*, not about a repository, and several repositories
 * cite the same run. A checkout without that sibling tree is a legitimate state (a fresh clone, a
 * CI job that only builds), so the shape of the claim is always checked and the content of the
 * receipt is checked whenever the tree is actually there. What is never allowed is the reverse:
 * naming a receipt that the present tree contradicts.
 */
const artifactsRoot = path.resolve(
  argValue('--artifacts') ?? path.join(repoRoot, '..', 'artifacts'),
)
const artifactsTreePresent = existsSync(artifactsRoot)

/** Every anchor a receipt records as executed and passing, wherever in the document it sits. */
function passingAnchorsOf(receipt) {
  const anchors = new Set()
  const notExecuted = new Set()
  const walk = node => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node.anchor === 'string' && node.verdict === 'pass') anchors.add(node.anchor)
    if (Array.isArray(node.anchorsObserved)) {
      for (const anchor of node.anchorsObserved) {
        if (typeof anchor === 'string') anchors.add(anchor)
      }
    }
    if (Array.isArray(node.anchorsNotExecuted)) {
      for (const anchor of node.anchorsNotExecuted) {
        if (typeof anchor === 'string') notExecuted.add(anchor)
      }
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(receipt)
  for (const anchor of notExecuted) anchors.delete(anchor)
  return anchors
}

/** Validates `receipts.installedHost` down to the anchor inside the named receipt. */
function checkInstalledHostReceipt(label, value) {
  const match = INSTALLED_HOST_RECEIPT_PATTERN.exec(value)
  if (match === null) {
    fail(
      `${label}: receipts.installedHost «${value}» must name a receipt under artifacts/** and the anchor inside it, as «artifacts/<wave>/<file>.receipt.json#<anchor>»`,
    )
    return
  }
  const [, file, anchor] = match
  if (!artifactsTreePresent) return
  const absolute = path.join(artifactsRoot, file.slice('artifacts/'.length))
  if (!existsSync(absolute)) {
    fail(`${label}: receipts.installedHost names «${file}», which does not exist`)
    return
  }
  let receipt
  try {
    receipt = readJson(absolute)
  } catch (error) {
    fail(`${label}: receipts.installedHost «${file}» is not readable JSON — ${error.message}`)
    return
  }
  if (receipt.verdict !== 'pass') {
    fail(
      `${label}: receipts.installedHost names «${file}», whose overall verdict is ${JSON.stringify(receipt.verdict)} — a run that did not pass is not evidence`,
    )
    return
  }
  const anchors = passingAnchorsOf(receipt)
  if (!anchors.has(anchor)) {
    fail(
      `${label}: receipts.installedHost names anchor «${anchor}», which «${file}» does not record as executed and passing${anchors.size === 0 ? '' : ` (it records ${[...anchors].sort(compareUtf8).join(', ')})`}`,
    )
  }
}

// --- inputs ---------------------------------------------------------------------------------------

if (!existsSync(inventoryPath)) {
  console.error('migration:check registry: source inventory is missing; run pnpm migration:emit')
  process.exit(1)
}
const inventory = readJson(inventoryPath)
const inventoryIds = new Set(inventory.units.map(unit => unit.sourceUnitId))
const unitKindById = new Map(inventory.units.map(unit => [unit.sourceUnitId, unit.kind]))
// Fixture-driven registry tests pass an alternate inventory and deliberately stay independent of
// the production ledger. The default gate, and any explicit --workflow-ledger invocation, require
// the block-14 allocation as a second non-vacuous mapping source.
const useWorkflowLedger =
  argValue('--workflow-ledger') !== undefined || argValue('--inventory') === undefined
let workflowLedger
if (useWorkflowLedger) {
  if (!existsSync(workflowLedgerPath)) {
    console.error('migration:check registry: workflow ledger is missing; run pnpm migration:emit')
    process.exit(1)
  }
  workflowLedger = readJson(workflowLedgerPath)
  if (workflowLedger.schemaVersion !== 'vscode-workflow-ledger-2') {
    fail(`workflow ledger: unsupported schema ${String(workflowLedger.schemaVersion)}`)
  }
  if (workflowLedger.counts?.total !== 266 || workflowLedger.units?.length !== 266) {
    fail('workflow ledger: expected exact 258 VS Code + 8 CLI coverage')
  }
  const workflowDispositionCounts = workflowLedger.counts?.byDisposition ?? {}
  if (
    workflowLedger.counts?.decisionRequired !== 0 ||
    ['already-equivalent', 'release-candidate', 'post-release'].some(
      disposition => !Number.isInteger(workflowDispositionCounts[disposition]),
    ) ||
    Object.values(workflowDispositionCounts).reduce((sum, count) => sum + count, 0) !== 266 ||
    workflowLedger.units.some(
      unit =>
        !['already-equivalent', 'release-candidate', 'post-release'].includes(
          unit.classification?.disposition,
        ),
    )
  ) {
    fail('workflow ledger: every fact must remain in exactly one Block 20 disposition')
  }
}

let registry
let projections
try {
  registry = parseCanonicalYaml(readFileSync(registryPath, 'utf8'))
} catch (error) {
  console.error(
    `migration:check registry: ${path.basename(registryPath)} is not canonical YAML — ${error.message}`,
  )
  process.exit(1)
}
try {
  projections = parseCanonicalYaml(readFileSync(projectionsPath, 'utf8'))
} catch (error) {
  console.error(
    `migration:check registry: ${path.basename(projectionsPath)} is not canonical YAML — ${error.message}`,
  )
  process.exit(1)
}

/**
 * Generated evidence declarations (block 12 slice 12-5).
 *
 * Absent is tolerated and means "no declaration backs anything": every operation then falls back to
 * the older `closedBy` link. That keeps this gate runnable on a checkout that has never run the
 * suite, which is the only state where the file legitimately does not exist.
 */
let evidence = { operations: {} }
try {
  evidence = JSON.parse(
    readFileSync(path.join(repoRoot, 'migration', 'generated', 'evidence.json'), 'utf8'),
  )
} catch {
  // no declarations yet
}

if (registry.schemaVersion !== 'capability-registry-1') {
  fail(
    `registry schemaVersion must be "capability-registry-1", found ${JSON.stringify(registry.schemaVersion)}`,
  )
}
if (projections.schemaVersion !== 'projection-matrix-1') {
  fail(
    `projections schemaVersion must be "projection-matrix-1", found ${JSON.stringify(projections.schemaVersion)}`,
  )
}

const capabilities = registry.capabilities ?? []
const unmappedRules = registry.unmapped ?? []

// --- machine facts, re-derived ----------------------------------------------------------------------

const isDefaultRegistry = registryPath === path.join(repoRoot, 'migration/capabilities.yaml')

function deriveX3Facts() {
  // Contributions live under extensions/** (the original layout) and, since the externalization,
  // also directly under packages/** (e.g. packages/host/native-text, where the plain-text/JSON
  // family relocated) and examples/** (reference vertical slices that ship a real contribution
  // alongside their tutorial value, e.g. examples/modkit-extension-plain-text). All three are
  // scanned so a relocation out of extensions/** cannot silently fall out of the X3 fact base; the
  // contract.id filter below is what keeps fixture/demo contributions (org.modkitx/*, x3.demo/*)
  // from ever entering the map, so widening the glob cannot pull in noise.
  const internal = execFileSync(
    'git',
    [
      '-C',
      repoRoot,
      'ls-files',
      ':(glob)extensions/**/contributions/*.json',
      ':(glob)packages/**/contributions/*.json',
      ':(glob)examples/**/contributions/*.json',
    ],
    {
      maxBuffer: 1 << 30,
    },
  )
    .toString('utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
  // modkit.workspace.json declares five sibling sources; the focused-ga profile only activates
  // blizzard and warzone, but a source being outside the active profile does not mean its
  // repository is absent from disk or absent from the registry (compare: `other` is not in any
  // profile either and is scanned below). All five must be read or the fact base is only ever as
  // complete as the launch profile of the day.
  const external = [
    ['blizzard', externalRepositoryRoot(repoRoot, 'blizzard')],
    ['warzone', externalRepositoryRoot(repoRoot, 'warzone')],
    ['ea', externalRepositoryRoot(repoRoot, 'ea')],
    ['spring', externalRepositoryRoot(repoRoot, 'spring')],
    ['other', externalRepositoryRoot(repoRoot, 'other')],
  ].flatMap(([repository, root]) =>
    execFileSync('git', ['-C', root, 'ls-files', 'contributions/*.json', '*/contributions/*.json'])
      .toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(file => ({ file: `external:${repository}/${file}`, absolute: path.join(root, file) })),
  )
  const files = [
    ...internal.map(file => ({ file, absolute: path.join(repoRoot, file) })),
    ...external,
  ]
  const byId = new Map()
  for (const file of files) {
    const json = readJson(file.absolute)
    if (json.contract?.id !== 'modkit/codec-contribution') continue
    byId.set(json.id, { file: file.file, json })
  }
  return byId
}

const commonCoveragePath = path.join(repoRoot, 'scripts/parity/common-coverage.json')

function deriveParityFacts() {
  // scripts/parity/common-coverage.json left the repo with the 2026-08-30 externalization
  // (commit 3fe0232d) and has not been relocated. That is a real gap, not a reason to abort the
  // whole gate: `coverage` is `null` when the file is absent, and every consumer below must treat
  // null as "cannot verify" and say so via flagUnavailable — never as "nothing to report".
  const coverage = existsSync(commonCoveragePath)
    ? new Map(readJson(commonCoveragePath).coverage.map(row => [row.contributionId, row.status]))
    : null
  const byShortId = new Map()
  for (const row of readJson(parityReportPath).results) {
    const short = `modkit/${row.contributionId.slice(row.contributionId.lastIndexOf('/') + 1)}`
    if (!byShortId.has(short)) byShortId.set(short, [])
    byShortId.get(short).push(row)
  }
  return { coverage, byShortId }
}

const DOMAIN_SOURCES = new Set([
  'common.view/model-scene-source',
  'common.view/raster-image-source',
  'common.view/namespace-entry-source',
  'common.view/table-data-source',
  'common.view/text-source',
  'common.view/tree-data-source',
  'common.view/vector-scene-source',
])

if (isDefaultRegistry) {
  const x3 = deriveX3Facts()
  const { coverage, byShortId } = deriveParityFacts()
  const ratchetTotal = Object.values(
    readJson(path.join(repoRoot, 'scripts/mk2-port-ratchet.json')).families,
  ).reduce((total, count) => total + count, 0)

  const formatRows = capabilities.filter(row => row.capabilityId.startsWith('format/'))
  const codecUnits = inventory.units.filter(unit => unit.kind === 'codec-manifest')
  if (formatRows.length !== codecUnits.length) {
    fail(
      `every codec manifest needs exactly one format row: ${formatRows.length} rows for ${codecUnits.length} manifests`,
    )
  }

  let coveredRows = 0
  let retiredRouteRows = 0
  let coverageChecksSkipped = 0
  for (const row of formatRows) {
    const label = `capability ${row.capabilityId}`
    const declared = row.allocation.x3ContributionId
    const legacyId = row.sourceUnitIds[0]?.replace('legacy/codec-manifest/', '')
    const identityCovered = legacyId !== undefined && x3.has(legacyId)
    if (row.allocation.state === 'covered') {
      coveredRows += 1
      if (!identityCovered) {
        fail(
          `${label}: allocation covered, but no X3 contribution carries the legacy id ${legacyId}`,
        )
      }
      if (declared !== legacyId)
        fail(`${label}: covered allocation must name the legacy id, found ${declared}`)
    }
    if (row.allocation.state === 'absent' && identityCovered) {
      fail(`${label}: allocation absent, but the X3 tree does carry ${legacyId}`)
    }
    if (row.allocation.state === 'superseded') {
      if (identityCovered)
        fail(`${label}: allocation superseded, but the legacy id still exists in X3`)
      if (declared === null || !x3.has(declared)) {
        fail(
          `${label}: superseded allocation must name an existing X3 replacement, found ${declared}`,
        )
      }
      if (row.replacementWorkflow === null) {
        fail(`${label}: a superseded row must name its replacement workflow`)
      }
    }
    if (row.allocation.state === 'superseded-staging-present') {
      retiredRouteRows += 1
      if (!identityCovered) {
        fail(
          `${label}: the staging contribution ${legacyId} is gone, so this row is plainly superseded`,
        )
      } else if (!x3.get(legacyId)?.file.startsWith('extensions/mk2/')) {
        fail(
          `${label}: ${legacyId} does not live in staging, so a retired-route state is not the truth`,
        )
      }
      if (declared === null || !x3.has(declared) || declared === legacyId) {
        fail(
          `${label}: a retired route must name the replacement that actually wins, found ${declared}`,
        )
      }
      if (row.replacementWorkflow === null) {
        fail(`${label}: a retired route must name its replacement workflow`)
      }
    }
    // A declared x3ContributionId that the (now complete, see deriveX3Facts) scan cannot find must
    // be recorded, never passed over: a miss here previously left the supportState cross-check
    // silently unperformed — no failure, no counter, nothing to read. It is now unconditional: a
    // miss is itself a problem, distinct from (and reported alongside, not instead of) whatever the
    // state-specific rules above already said about this row's allocation.
    const entry = declared === null ? undefined : x3.get(declared)
    if (declared !== null && entry === undefined) {
      fail(
        `${label}: allocation.x3ContributionId names ${declared}, which no X3 contribution carries — supportState cannot be cross-checked against it`,
      )
    } else if (entry !== undefined) {
      const status = entry.json.status
      const expected =
        status === 'supported' ? 'supported' : status === 'partial' ? 'partial' : 'unknown'
      if (row.supportState !== expected) {
        fail(
          `${label}: supportState ${row.supportState} contradicts contribution status ${status ?? 'undefined'}`,
        )
      }
    }
    if (coverage === null) {
      // Cannot compare against a file that is not there. This is not a pass — it is counted and
      // reported below via flagUnavailable, once, for the whole batch of skipped rows.
      coverageChecksSkipped += 1
    } else {
      const declaredCoverage = row.parityEvidence.coverageStatus
      const actualCoverage = declared === null ? undefined : coverage.get(declared)
      if (declaredCoverage !== (actualCoverage ?? null)) {
        fail(
          `${label}: parityEvidence.coverageStatus ${JSON.stringify(declaredCoverage)} contradicts common-coverage.json ${JSON.stringify(actualCoverage ?? null)}`,
        )
      }
    }
    const parityRows = declared === null ? [] : (byShortId.get(declared) ?? [])
    const actualRowIds = parityRows.map(entry => entry.id).sort(compareUtf8)
    if (row.parityEvidence.rows.join(',') !== actualRowIds.join(',')) {
      fail(`${label}: parityEvidence.rows contradicts reports/parity/latest.json`)
    }
    const observedParityRows = parityRows.filter(entry => entry.state === 'compared')
    const actualLive = [
      ...new Set(
        observedParityRows
          .flatMap(entry => entry.x3?.actualSources ?? [])
          .filter(id => DOMAIN_SOURCES.has(id)),
      ),
    ].sort(compareUtf8)
    const declaredLive = new Set(row.parityEvidence.liveSources)
    const unexpectedLive = actualLive.filter(id => !declaredLive.has(id))
    const completeObservation = observedParityRows.length === parityRows.length
    if (
      unexpectedLive.length > 0 ||
      (completeObservation && row.parityEvidence.liveSources.join(',') !== actualLive.join(','))
    ) {
      fail(`${label}: parityEvidence.liveSources contradicts the observed X3 sources`)
    }
  }
  if (coverage === null) {
    flagUnavailable(
      `parityEvidence.coverageStatus cross-check: scripts/parity/common-coverage.json not found (ENOENT) — ` +
        `${coverageChecksSkipped} format row(s) NOT verified against recorded coverage. This file left ` +
        `the repo in the 2026-08-30 externalization (commit 3fe0232d) and has not been relocated to ` +
        `where the parity suite now lives. Every other registry rule still ran; this one specific ` +
        `cross-check did not.`,
    )
  }
  // Allocation coverage and the MK2 ratchet are the same fact seen twice. A route retired in
  // favour of a richer MK3 contribution still leaves its hand-ported module in staging until the
  // block-30 emptying, so the ratchet keeps counting it and the two states are summed here.
  if (coveredRows + retiredRouteRows !== ratchetTotal) {
    fail(
      `covered (${coveredRows}) + retired-route (${retiredRouteRows}) format rows must equal the MK2 port ratchet total (${ratchetTotal}); allocation coverage and the ratchet are the same fact`,
    )
  }
}

// --- per-row structural rules --------------------------------------------------------------------

const capabilityIds = new Set()
let previousId = ''
for (const row of capabilities) {
  const label = `capability ${row.capabilityId ?? '(missing id)'}`
  checkKeyOrder(label, row, CAPABILITY_KEYS)

  if (typeof row.capabilityId !== 'string' || row.capabilityId === '')
    fail(`${label}: capabilityId is required`)
  if (capabilityIds.has(row.capabilityId)) fail(`${label}: duplicate capabilityId`)
  capabilityIds.add(row.capabilityId)
  if (previousId !== '' && compareUtf8(previousId, row.capabilityId) >= 0) {
    fail(`${label}: rows must be sorted by capabilityId in UTF-8 byte order (after ${previousId})`)
  }
  previousId = row.capabilityId

  if (typeof row.userScenario !== 'string' || row.userScenario.length < 10) {
    fail(`${label}: userScenario must describe what the user can do`)
  }
  if (typeof row.owner !== 'string' || row.owner === '') fail(`${label}: owner is required`)
  if (!Number.isInteger(row.plannedBlock)) fail(`${label}: plannedBlock is required`)

  checkEnum(label, 'releaseTrack', row.releaseTrack, ENUMS.releaseTrack)
  checkEnum(label, 'origin', row.origin, ENUMS.origin)
  checkEnum(label, 'obligation', row.obligation, ENUMS.obligation)
  checkEnum(label, 'migrationState', row.migrationState, ENUMS.migrationState)
  checkEnum(label, 'supportState', row.supportState, ENUMS.supportState)
  checkEnum(label, 'runtimeAvailability', row.runtimeAvailability, ENUMS.runtimeAvailability)
  checkEnum(label, 'evidenceLevel', row.evidenceLevel, ENUMS.evidenceLevel)
  checkEnum(label, 'writerEvidence', row.writerEvidence, ENUMS.writerEvidence)

  // --- hostEvidence and its two qualifiers (2C, F26) ---------------------------------------------
  const installedHostReceipt = row.receipts?.installedHost ?? null
  if (typeof row.hostEvidence !== 'string') {
    fail(`${label}: hostEvidence is required`)
  } else if (row.hostEvidence === HOST_EVIDENCE_PENDING) {
    fail(
      `${label}: hostEvidence ${HOST_EVIDENCE_PENDING} must name the wave that closes it, as «${HOST_EVIDENCE_PENDING}@wave-4B» — a pending state without an end is a parking space`,
    )
  } else if (row.hostEvidence.startsWith(`${HOST_EVIDENCE_PENDING}@`)) {
    if (!HOST_EVIDENCE_PENDING_PATTERN.test(row.hostEvidence)) {
      fail(
        `${label}: hostEvidence "${row.hostEvidence}" does not name a wave; expected «${HOST_EVIDENCE_PENDING}@wave-<id>»`,
      )
    }
  } else if (!HOST_EVIDENCE_VALUES.includes(row.hostEvidence)) {
    fail(
      `${label}: hostEvidence "${row.hostEvidence}" is not one of ${HOST_EVIDENCE_VALUES.join(' | ')} | ${HOST_EVIDENCE_PENDING}@wave-<id>`,
    )
  }
  if (row.hostEvidence === 'vscode-installed') {
    if (typeof installedHostReceipt !== 'string' || installedHostReceipt.trim() === '') {
      fail(
        `${label}: hostEvidence vscode-installed claims the installed route but names no receipt; fill receipts.installedHost with «artifacts/<wave>/<file>.receipt.json#<anchor>»`,
      )
    } else {
      checkInstalledHostReceipt(label, installedHostReceipt)
    }
  } else if (installedHostReceipt !== null) {
    // A receipt nobody claims is decoration; a claim with no receipt is a wish. They travel together.
    fail(
      `${label}: receipts.installedHost is filled while hostEvidence is ${JSON.stringify(row.hostEvidence)}; the installed receipt belongs to hostEvidence vscode-installed`,
    )
  }

  checkKeyOrder(`${label}.allocation`, row.allocation, ALLOCATION_KEYS)
  checkEnum(label, 'allocation.state', row.allocation.state, ENUMS.allocationState)
  checkKeyOrder(`${label}.parityEvidence`, row.parityEvidence, PARITY_KEYS)
  checkKeyOrder(`${label}.receipts`, row.receipts, RECEIPT_KEYS)
  checkKeyOrder(`${label}.projection`, row.projection, PROJECTION_KEYS)
  for (const field of [
    'liveProjection',
    'portableMaterialization',
    'opaquePreservation',
    'nativeExport',
  ]) {
    checkEnum(label, `projection.${field}`, row.projection[field], ENUMS.projectionState)
  }
  checkKeyOrder(
    `${label}.projection.operations`,
    row.projection.operations,
    PROJECTION_OPERATION_KEYS,
  )
  const closedTests = new Set(row.closedBy.tests ?? [])
  for (const operation of PROJECTION_OPERATION_KEYS) {
    const proof = row.projection.operations[operation]
    if (proof === null) continue
    if (typeof proof !== 'string' || proof.trim() === '') {
      fail(`${label}: projection.operations.${operation} must be null or a test path`)
      continue
    }
    /*
     * Three things must line up, and slice 12-5 made the first of them possible.
     *
     * Until then the only available link was `closedBy.tests`, which says a test is *related* to a
     * row — a weaker claim than "this test proves this operation". Now a test declares that with
     * `proves()`, so the declaration is the authority and this checks against it: the operation is
     * backed by a real declaration, the named test is the one that made it, and that file exists.
     * A row may still name a `closedBy` test instead, for evidence that predates the mechanism.
     */
    const declared = evidence.operations?.[row.capabilityId]?.[operation]
    if (declared === undefined && !closedTests.has(proof)) {
      fail(
        `${label}: projection.operations.${operation} names «${proof}», which no test declares and the row does not list in closedBy.tests`,
      )
    } else if (declared !== undefined && declared !== proof) {
      fail(
        `${label}: projection.operations.${operation} names «${proof}», but the declaration comes from «${declared}»`,
      )
    }
    if (!existsSync(resolvedProductPath(proof))) {
      fail(`${label}: projection.operations.${operation} names «${proof}», which does not exist`)
    }
  }
  if (
    row.projection.operations.materialize !== null &&
    row.projection.portableMaterialization === 'none'
  ) {
    fail(
      `${label}: projection.operations.materialize names a proof while portableMaterialization is none`,
    )
  }

  for (const id of row.sourceUnitIds) {
    if (!inventoryIds.has(id))
      fail(`${label}: sourceUnitId ${id} does not exist in the source inventory`)
  }
  if (row.sourceUnitIds.length === 0 && row.origin !== 'owner-addition') {
    fail(`${label}: a legacy row must name at least one source inventory unit`)
  }
  if (!Array.isArray(row.dependsOn)) fail(`${label}: dependsOn must be a list`)
  else if (row.dependsOn.includes(row.capabilityId)) {
    fail(`${label}: dependsOn must not name the row itself`)
  }

  // Allocation coverage and implementation/evidence are independent fields: evidence has to be
  // earned by a real corpus or a test, never inherited from the fact that a port exists.
  const realCorpus =
    row.corpusDescriptors.length > 0 || row.parityEvidence.corpusKinds.includes('real')
  // E3 and E5 are corpus/workflow rungs: they are false without a real corpus behind them.
  if (row.evidenceLevel === 'E3' || row.evidenceLevel === 'E5') {
    if (!realCorpus) {
      fail(
        `${label}: evidenceLevel ${row.evidenceLevel} claims a real corpus but names no corpus descriptor`,
      )
    }
  }
  /*
   * E5 is the top rung of plan §3.4: "a named live app workflow passes on the target host". It is
   * three conditions, not two, and 2C made the third writable. The real corpus above says the
   * workflow ran over something real; the installed receipt says it ran *in the shipped app*;
   * the anchor inside that receipt says which named workflow it was. A unit test satisfies none of
   * the last two, and a run that only nearly closed its anchor satisfies none of them either — the
   * receipt reader above refuses an anchor the run did not execute and pass.
   */
  if (row.evidenceLevel === 'E5') {
    if (row.hostEvidence !== 'vscode-installed') {
      fail(
        `${label}: evidenceLevel E5 is a live app workflow on the target host, so hostEvidence must be vscode-installed, found ${JSON.stringify(row.hostEvidence)}`,
      )
    }
    if (typeof installedHostReceipt !== 'string' || installedHostReceipt.trim() === '') {
      fail(
        `${label}: evidenceLevel E5 must name the installed acceptance receipt and the anchor that closed it in receipts.installedHost`,
      )
    }
  }
  /*
   * E4 is the differential rung (plan §3.4): "result against the legacy oracle is not poorer". Its
   * axis is the comparison, not the corpus — so a synthetic differential can carry it. What it may
   * never be is automatic: a synthetic-only differential also has to name the operation-level test
   * that proved the operations, otherwise every passing synthetic row would inherit E4 for free.
   */
  if (row.evidenceLevel === 'E4') {
    const verdicts = row.parityEvidence.verdicts
    const differential = verdicts.length > 0 && !verdicts.includes('poorer')
    if (!differential && !(realCorpus && row.closedBy.tests.length > 0)) {
      fail(
        `${label}: evidenceLevel E4 needs a not-poorer differential against the sealed oracle, or a real corpus with the test that proved it`,
      )
    }
    if (differential && !realCorpus && row.closedBy.tests.length === 0) {
      fail(
        `${label}: evidenceLevel E4 on a synthetic-only differential must also name the operation-level test that proved it`,
      )
    }
  }
  if (row.writerEvidence.startsWith('write-reopen-compared') && row.closedBy.tests.length === 0) {
    fail(`${label}: a proven writer must name the test that proved write → reopen → compare`)
  }
  if (row.allocation.state === 'absent' && row.migrationState === 'implemented') {
    fail(`${label}: nothing is allocated, so migrationState cannot be implemented`)
  }
  if (
    row.allocation.state === 'absent' &&
    row.mk3Contributions.length > 0 &&
    row.migrationState === 'missing'
  ) {
    fail(`${label}: MK3 contributions are named, so migrationState missing is dishonest`)
  }

  if (registry.ownerAdditionsFrozen === true && row.origin === 'owner-addition') {
    if (row.obligation === 'legacy-required') {
      fail(`${label}: an owner addition cannot carry the legacy-required obligation`)
    }
  }
  if (row.releaseTrack === 'post-ga' && row.obligation === 'focused-required-addition') {
    fail(`${label}: a focused-required-addition cannot sit outside the focused release tracks`)
  }
}

// --- dependency graph: resolvable and acyclic -------------------------------------------------------

const dependencyEdges = new Map(capabilities.map(row => [row.capabilityId, row.dependsOn ?? []]))
for (const [id, targets] of dependencyEdges) {
  for (const target of targets) {
    if (!capabilityIds.has(target)) {
      fail(`capability ${id}: dependsOn ${target} does not exist in the registry`)
    }
  }
}
const walkState = new Map()
const findCycle = (id, trail) => {
  const state = walkState.get(id)
  if (state === 'done') return
  if (state === 'open') {
    fail(`capability dependency cycle: ${[...trail.slice(trail.indexOf(id)), id].join(' -> ')}`)
    return
  }
  walkState.set(id, 'open')
  for (const target of dependencyEdges.get(id) ?? []) {
    if (capabilityIds.has(target)) findCycle(target, [...trail, id])
  }
  walkState.set(id, 'done')
}
for (const id of dependencyEdges.keys()) findCycle(id, [])

// --- no source unit is lost ------------------------------------------------------------------------

const capabilityMapped = new Set(capabilities.flatMap(row => row.sourceUnitIds))
const workflowMapped = new Set(workflowLedger?.units?.map(row => row.sourceUnitId) ?? [])
for (const id of workflowMapped) {
  if (!inventoryIds.has(id)) fail(`workflow ledger: sourceUnitId ${id} does not exist in inventory`)
  if (capabilityMapped.has(id))
    fail(`source unit ${id} is mapped by both capability registry and workflow ledger`)
}
const mapped = new Set([...capabilityMapped, ...workflowMapped])
const coveredByRule = new Map()
for (const rule of unmappedRules) {
  if (typeof rule.selector !== 'string' || rule.selector === '')
    fail('unmapped rule: selector is required')
  if (typeof rule.reason !== 'string' || rule.reason.length < 10) {
    fail(`unmapped rule ${rule.selector}: a reason is required`)
  }
  if (typeof rule.plan !== 'string' || rule.plan.length < 3) {
    fail(`unmapped rule ${rule.selector}: a plan is required`)
  }
  const units = inventory.units.filter(
    unit => unit.kind === rule.selector && !mapped.has(unit.sourceUnitId),
  )
  if (units.length !== rule.count) {
    fail(
      `unmapped rule ${rule.selector}: declares ${rule.count} units, the inventory has ${units.length} unmapped units of that kind`,
    )
  }
  for (const unit of units) {
    if (coveredByRule.has(unit.sourceUnitId)) {
      fail(`source unit ${unit.sourceUnitId} is covered by more than one unmapped rule`)
    }
    coveredByRule.set(unit.sourceUnitId, rule.selector)
  }
}

const lost = inventory.units
  .filter(unit => !mapped.has(unit.sourceUnitId) && !coveredByRule.has(unit.sourceUnitId))
  .map(unit => unit.sourceUnitId)
if (lost.length > 0) {
  const kinds = [...new Set(lost.map(id => unitKindById.get(id)))].sort(compareUtf8)
  fail(
    `${lost.length} source unit(s) are neither mapped to a capability nor listed as unmapped (kinds: ${kinds.join(', ')}); first: ${lost.slice(0, 3).join(', ')}`,
  )
}

const declaredCounts = registry.counts ?? {}
const actualCounts = {
  capabilities: capabilities.length,
  unmappedRules: unmappedRules.length,
  unmappedUnits: coveredByRule.size,
  mappedUnits: mapped.size,
  inventoryUnits: inventory.units.length,
}
for (const [key, value] of Object.entries(actualCounts)) {
  if (declaredCounts[key] !== value) {
    fail(`registry counts.${key} declares ${declaredCounts[key]}, actual ${value}`)
  }
}
if (mapped.size + coveredByRule.size !== inventory.units.length) {
  fail(
    `mapped (${mapped.size}) + unmapped (${coveredByRule.size}) must equal the inventory (${inventory.units.length})`,
  )
}

// --- scope lock ---------------------------------------------------------------------------------

const scopeLock = registry.scopeLock ?? {}
for (const obligation of Object.keys(scopeLock)) {
  checkEnum('scopeLock', 'obligation', obligation, ENUMS.obligation)
  const rows = capabilities.filter(row => row.obligation === obligation)
  if (rows.length === 0) fail(`scopeLock declares ${obligation} but no capability carries it`)
}
if (registry.ownerAdditionsFrozen !== true) {
  fail('ownerAdditionsFrozen must be true: block 10 freezes the required owner-addition set')
}
if (
  typeof registry.ownerAdditionsFrozenOn !== 'string' ||
  !/^\d{4}-\d{2}-\d{2}$/.test(registry.ownerAdditionsFrozenOn)
) {
  fail('ownerAdditionsFrozenOn must carry the freeze date')
}

// --- corpora readiness ---------------------------------------------------------------------------

const CORPUS_STATUSES = [
  'available',
  'owner-action-required',
  'legal-alternative-ready',
  'unavailable',
]
const corporaPath = path.resolve(
  argValue('--corpora') ?? path.join(repoRoot, 'migration/corpora-readiness.json'),
)
if (isDefaultRegistry) {
  const corpora = readJson(corporaPath)
  if (corpora.schemaVersion !== 'corpora-readiness-1') {
    fail(
      `corpora readiness schemaVersion must be "corpora-readiness-1", found ${corpora.schemaVersion}`,
    )
  }
  const lockVariables = new Set(
    Object.keys(
      readJson(path.join(repoRoot, corpora.oracleLock)).corpusDescriptors?.variables ?? {},
    ),
  )
  const capabilityById = new Map(capabilities.map(row => [row.capabilityId, row]))
  const corpusRootVariables = new Set(
    [...lockVariables].filter(variable => variable.endsWith('_ROOT')),
  )
  const seen = new Set()
  for (const entry of corpora.corpora ?? []) {
    const label = `corpus ${entry.id}`
    if (seen.has(entry.id)) fail(`${label}: duplicate corpus id`)
    seen.add(entry.id)
    checkEnum(label, 'status', entry.status, CORPUS_STATUSES)
    checkEnum(label, 'releaseTrack', entry.releaseTrack, [
      'mk3-priority',
      'deferred-games-priority',
    ])
    if (!Number.isInteger(entry.verticalBlock)) fail(`${label}: verticalBlock is required`)
    if (typeof entry.evidence !== 'string' || entry.evidence.length < 10) {
      fail(`${label}: evidence must state what was actually observed`)
    }
    if (entry.status === 'available' && entry.ownerAction !== null) {
      fail(`${label}: an available corpus must not also demand an owner action`)
    }
    if (entry.status !== 'available' && (entry.ownerAction === null || entry.ownerAction === '')) {
      fail(
        `${label}: a corpus that is not available must name the owner action, not defer to a later skip`,
      )
    }
    for (const variable of entry.environmentVariables ?? []) {
      if (!lockVariables.has(variable)) {
        fail(
          `${label}: ${variable} is published by corpora readiness but is not described in the oracle lock`,
        )
      }
    }
    for (const id of entry.capabilityIds ?? []) {
      if (!capabilityIds.has(id))
        fail(`${label}: capabilityId ${id} does not exist in the registry`)

      const capability = capabilityById.get(id)
      if (capability !== undefined && capability.releaseTrack !== entry.releaseTrack) {
        fail(
          `${label}: capabilityId ${id} has releaseTrack ${capability.releaseTrack}, expected ${entry.releaseTrack}`,
        )
      }

      if (/^game\/.+\/discover-open$/u.test(id)) {
        const expectedRootVariables = (entry.environmentVariables ?? []).filter(variable =>
          variable.endsWith('_ROOT'),
        )
        if (expectedRootVariables.length !== 1) {
          fail(
            `${label}: named game discovery ${id} requires exactly one *_ROOT environment variable`,
          )
          continue
        }
        // An E0 row may still have no corpus binding, but once it names one it must not borrow
        // another named game's root and thereby turn one retail dialect into evidence for another.
        const declaredRootVariables = (capabilityById.get(id)?.corpusDescriptors ?? []).filter(
          variable => corpusRootVariables.has(variable),
        )
        if (
          declaredRootVariables.length > 0 &&
          (declaredRootVariables.length !== 1 ||
            declaredRootVariables[0] !== expectedRootVariables[0])
        ) {
          fail(
            `${label}: named game discovery ${id} must use exact corpus environment ${expectedRootVariables[0]}, found ${declaredRootVariables.join(', ')}`,
          )
        }
      }
    }
  }
  const expected = {
    corpora: (corpora.corpora ?? []).length,
    available: (corpora.corpora ?? []).filter(entry => entry.status === 'available').length,
    ownerActionRequired: (corpora.corpora ?? []).filter(
      entry => entry.status === 'owner-action-required',
    ).length,
    legalAlternativeReady: (corpora.corpora ?? []).filter(
      entry => entry.status === 'legal-alternative-ready',
    ).length,
    unavailable: (corpora.corpora ?? []).filter(entry => entry.status === 'unavailable').length,
    mk3Priority: (corpora.corpora ?? []).filter(entry => entry.releaseTrack === 'mk3-priority')
      .length,
    deferredGamesPriority: (corpora.corpora ?? []).filter(
      entry => entry.releaseTrack === 'deferred-games-priority',
    ).length,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (corpora.counts?.[key] !== value) {
      fail(`corpora readiness counts.${key} declares ${corpora.counts?.[key]}, actual ${value}`)
    }
  }
  // Plan block 10 work 9: the six priority verticals must all be published.
  for (const required of [
    'starcraft-2',
    'cnc3-tiberium-wars',
    'cnc3-kanes-wrath',
    'red-alert-3',
    'warzone-2100',
    'beyond-all-reason',
  ]) {
    if (!seen.has(required))
      fail(`corpora readiness does not publish the required corpus ${required}`)
  }
}

// --- projection matrix -----------------------------------------------------------------------------

const planes = projections.planes ?? []
const planeNames = new Set()
for (const plane of planes) {
  const label = `plane ${plane.plane}`
  if (planeNames.has(plane.plane)) fail(`${label}: duplicate plane`)
  planeNames.add(plane.plane)
  checkEnum(label, 'action', plane.action, ENUMS.action)
  for (const action of plane.secondaryActions ?? [])
    checkEnum(label, 'secondaryActions', action, ENUMS.action)
  checkEnum(label, 'artifactMaturity', plane.artifactMaturity, ENUMS.artifactMaturity)
  if (!Array.isArray(plane.requiredFacets) || plane.requiredFacets.length === 0) {
    fail(`${label}: requiredFacets must not be empty`)
  }
  // invariant candidate-facet-is-not-admitted
  const declaredFacets = new Set([...(plane.requiredFacets ?? []), ...(plane.optionalFacets ?? [])])
  for (const [facet, maturity] of Object.entries(plane.facetMaturity ?? {})) {
    checkEnum(label, `facetMaturity.${facet}`, maturity, ENUMS.facetMaturity)
    if (!declaredFacets.has(facet)) {
      fail(`${label}: facetMaturity names ${facet}, which the plane does not declare as a facet`)
    }
    if (maturity === 'publisher-candidate' && (plane.requiredFacets ?? []).includes(facet)) {
      fail(
        `${label}: invariant candidate-facet-is-not-admitted — facet ${facet} is proved by one publisher and may not be required`,
      )
    }
  }
  if (typeof plane.portableProfile !== 'string') fail(`${label}: portableProfile is required`)
  if (plane.portableProfile !== 'none' && !/^UV[A-Z]$/.test(plane.portableProfile)) {
    fail(`${label}: portableProfile must be "none" or a UV profile, found ${plane.portableProfile}`)
  }
  if (typeof plane.derivedPresentation !== 'string' || plane.derivedPresentation === '') {
    fail(`${label}: derivedPresentation must state what is derived rather than a new source`)
  }
  if (typeof plane.contractOwner !== 'string' || plane.contractOwner === '') {
    fail(
      `${label}: contractOwner is required — every priority projection names who owns its contract`,
    )
  }
  if (!Array.isArray(plane.knownLoss)) {
    fail(`${label}: knownLoss is the fidelity/loss policy and must be a list, even when empty`)
  }
  if (typeof plane.fidelity !== 'string' || plane.fidelity === '') {
    fail(`${label}: fidelity is required`)
  }
  if (!(plane.portableProfile in (projections.portableProfileSemantics ?? {}))) {
    fail(`${label}: portableProfile ${plane.portableProfile} has no declared semantics`)
  }
  // invariant portable-profile-none-is-honest
  if (plane.portableProfile === 'none') {
    if (typeof plane.contract !== 'string' || plane.contract === '') {
      fail(
        `${label}: invariant portable-profile-none-is-honest — a plane without a portable profile still publishes a contract`,
      )
    }
    if (plane.action === 'defer') {
      fail(
        `${label}: invariant portable-profile-none-is-honest — "none" is an honest state, not a reason to defer the viewer`,
      )
    }
  }
  // invariants uvp-is-data-only and uve-requires-trust-profile
  const planeActions = [plane.action, ...(plane.secondaryActions ?? [])]
  if (plane.portableProfile === 'UVP') {
    if (planeActions.includes('execute')) {
      fail(
        `${label}: invariant uvp-is-data-only — a UVP package is data, never an executable extension`,
      )
    }
    if (plane.packageTrust === 'not-applicable') {
      fail(`${label}: invariant uvp-is-data-only — a UVP package must name its trust profile`)
    }
  }
  if (plane.portableProfile === 'UVE' && plane.packageTrust === 'not-applicable') {
    fail(
      `${label}: invariant uve-requires-trust-profile — an executable extension must name its trust profile`,
    )
  }
  for (const id of plane.capabilityIds ?? []) {
    if (!capabilityIds.has(id)) fail(`${label}: capabilityId ${id} does not exist in the registry`)
  }
  // invariant uvd-is-not-a-document
  if (plane.plane === 'document' && plane.portableProfile === 'UVD') {
    fail(
      `${label}: invariant uvd-is-not-a-document — a document plane may not claim the UVD profile`,
    )
  }
  if (plane.plane === 'definition' && plane.portableProfile !== 'UVD') {
    fail(`${label}: invariant uvd-is-not-a-document — the definition plane owns the UVD profile`)
  }
  // invariant archive-is-not-a-package
  if (plane.plane === 'container') {
    if (plane.packageTrust !== 'generic-archive-is-untrusted-data-never-a-package') {
      fail(
        `${label}: invariant archive-is-not-a-package — the container plane must declare that trust`,
      )
    }
    if (['materialize', 'export-native'].includes(plane.action)) {
      fail(`${label}: invariant archive-is-not-a-package — browse never derives pack or repack`)
    }
  }
  // invariant reader-does-not-imply-writer
  if (
    plane.artifactMaturity === 'reader-only' &&
    ['edit', 'materialize', 'export-native'].includes(plane.action)
  ) {
    fail(
      `${label}: invariant reader-does-not-imply-writer — a reader-only plane cannot make ${plane.action} its primary action`,
    )
  }
}
for (const invariant of projections.invariants ?? []) {
  if (invariant.enforcedBy !== 'scripts/migration/check-registry.mjs') {
    fail(`projection invariant ${invariant.id}: enforcedBy must name this gate`)
  }
}
if (projections.counts?.planes !== planes.length) {
  fail(`projections counts.planes declares ${projections.counts?.planes}, actual ${planes.length}`)
}

// --- verdict ---------------------------------------------------------------------------------------

// Unavailable checks are reported first, and unconditionally — in the clean-looking branch as much
// as the failing one — because the one thing that must never happen is a reader seeing a summary
// and believing every rule ran. "Unavailable" forces the same non-zero exit "problem" does: a run
// that could not evaluate one of its own rules is not a passing run.
if (unavailableChecks.length > 0) {
  console.error(
    `migration:check registry: ${unavailableChecks.length} check(s) UNAVAILABLE — not performed, ` +
      `and that is not the same as passed`,
  )
  for (const message of unavailableChecks) console.error(`  ! ${message}`)
}
if (problems.length > 0) {
  console.error(`migration:check registry: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
}
if (problems.length > 0 || unavailableChecks.length > 0) {
  process.exit(1)
}
if (!quiet) {
  const track = {}
  const obligation = {}
  const evidence = {}
  const installedRows = []
  for (const row of capabilities) {
    track[row.releaseTrack] = (track[row.releaseTrack] ?? 0) + 1
    obligation[row.obligation] = (obligation[row.obligation] ?? 0) + 1
    evidence[row.evidenceLevel] = (evidence[row.evidenceLevel] ?? 0) + 1
    if (row.hostEvidence === 'vscode-installed') {
      installedRows.push(`${row.capabilityId} → ${row.receipts.installedHost}`)
    }
  }
  const render = counts =>
    Object.entries(counts)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, value]) => `${key} ${value}`)
      .join(', ')
  console.log(
    `migration:check registry: ${capabilities.length} capabilities (${render(track)}); obligations ${render(obligation)}; evidence ${render(evidence)}; ${mapped.size} mapped + ${coveredByRule.size} unmapped = ${inventory.units.length} source units; ${planes.length} projection planes`,
  )
  // The installed rows are printed by name: E5 is the rung a reader is most likely to doubt, and
  // the receipt plus anchor behind each one should be readable without opening the registry.
  console.log(
    `migration:check registry: installed-host evidence on ${installedRows.length} row(s)${artifactsTreePresent ? '' : ' (receipt tree absent; shape checked, content not)'}`,
  )
  for (const row of installedRows.sort(compareUtf8)) console.log(`  · ${row}`)
}
