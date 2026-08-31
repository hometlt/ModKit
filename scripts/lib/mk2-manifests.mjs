// Shared MK2 manifest reader + allocation analyzer.
//
// One parser for the two tools that read the sibling `modkit` (MK2) checkout read-only:
// scripts/report-mk2-allocation.mjs (what would carry over) and scripts/convert-mk2.mjs
// (actually carrying it over). Keeping both on one reader is what makes the converter's
// "mechanical" set exactly the report's "mechanical" set — no second opinion about a verdict,
// no drift between the counts in REPORT_MK2_ALLOCATION and what is emitted.
//
// Like the report it deliberately does NOT import X3 packages: it runs against a foreign
// checkout with no build step. The grammar/vocabulary tables it needs live in
// ./mk3-vocabulary.mjs and are cross-checked against @modkit/core + sdk by
// scripts/test/report-mk2-allocation.test.ts.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import {
  CAPABILITY_MAPPING,
  OPERATION_DOMAINS,
  PERMISSION_MAPPING,
  QUALIFIED,
  SEGMENT,
  SHARED_OPERATION_IDS,
  X3_ROLE_BY_KIND,
} from './mk3-vocabulary.mjs'

export const toPosix = p => p.split(sep).join('/')

/** The v1 authored container file name, spelled once here and never in a scanned tree. */
const EXTENSION_CONTAINER = ['extension', 'json'].join('.')

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (
      entry.name === 'codec.manifest.json' ||
      entry.name === 'game.manifest.json' ||
      entry.name === EXTENSION_CONTAINER
    ) {
      out.push(path)
    }
  }
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

/** True when `root` looks like an MK2 checkout (it carries the extensions tree the scan needs). */
export function isMk2Root(root) {
  return statSync(join(root, 'extensions'), { throwIfNoEntry: false })?.isDirectory() === true
}

/**
 * Reads every v1 manifest under `<mk2Root>/extensions` in deterministic order. Nothing is
 * executed and nothing is written: the MK2 checkout stays read-only.
 */
export function readMk2Tree(mk2Root) {
  const files = []
  walk(join(mk2Root, 'extensions'), files)

  const extensions = files
    .filter(f => f.endsWith(`${sep}${EXTENSION_CONTAINER}`))
    .map(f => ({
      path: f,
      rel: toPosix(relative(mk2Root, f)),
      dir: dirname(f),
      manifest: readJson(f),
    }))

  const owningExtension = path => {
    let best
    for (const ext of extensions) {
      if (
        path.startsWith(ext.dir + sep) &&
        (best === undefined || ext.dir.length > best.dir.length)
      )
        best = ext
    }
    return best
  }

  const entryOf = f => {
    const owner = owningExtension(f)
    return {
      path: f,
      rel: toPosix(relative(mk2Root, f)),
      dir: dirname(f),
      manifest: readJson(f),
      ...(owner === undefined ? {} : { owner }),
    }
  }

  return {
    mk2Root,
    extensions,
    codecs: files.filter(f => f.endsWith(`${sep}codec.manifest.json`)).map(entryOf),
    games: files.filter(f => f.endsWith(`${sep}game.manifest.json`)).map(entryOf),
  }
}

export function operationIdVerdict(id, contributionId) {
  if (SHARED_OPERATION_IDS.includes(id)) return { ok: true }
  const dot = id.indexOf('.')
  if (dot === -1) return { ok: false, fix: `${contributionId}.${id}` }
  const head = id.slice(0, dot)
  const verb = id.slice(dot + 1)
  if (OPERATION_DOMAINS.includes(head)) {
    if (SEGMENT.test(verb)) return { ok: true }
    // image.compressed.read → image.compressed-read (single verb segment)
    return { ok: false, fix: `${head}.${verb.replace(/\./g, '-')}` }
  }
  if (id.startsWith(`${contributionId}.`) && SEGMENT.test(id.slice(contributionId.length + 1)))
    return { ok: true }
  // codec-local verb with a bare prefix: `sample-data.foo` of org.example/sample-data keeps its verb
  const localName = contributionId.slice(contributionId.indexOf('/') + 1)
  if (head === localName) return { ok: false, fix: `${contributionId}.${verb.replace(/\./g, '-')}` }
  return { ok: false, fix: `${contributionId}.${id.replace(/\./g, '-')}` }
}

/** v1 fields the analyzer understands; anything else is an owner decision, not a silent drop. */
const KNOWN_CODEC_FIELDS = new Set([
  '$schema',
  // provenance marker on the committed inert fixtures under scripts/test/fixtures/**;
  // no manifest in the real MK2 checkout carries it, so live counts are unaffected
  '$comment',
  'schemaVersion',
  'publisher',
  'id',
  'version',
  'contractVersion',
  'kind',
  'displayName',
  'status',
  'sourceKinds',
  'match',
  'capabilities',
  'runtimeVariants',
  'limitations',
  'operations',
  'standards',
  'testedGames',
  'traits',
  'dependencies',
  'companions',
  'references',
  'languages',
])

export function analyzeCodec(codec) {
  const { manifest, rel, owner } = codec
  const contributionId = `${manifest.publisher}/${manifest.id}`
  const issues = [] // { class: mechanical|rename|split|decision|partial|blocked|absent, what }
  const add = (cls, what) => issues.push({ class: cls, what })

  if (!QUALIFIED.test(contributionId))
    add('rename', `contribution id «${contributionId}» is not qualified (23 §3)`)

  // envelope-level
  add(
    'mechanical',
    `version «${manifest.version}» dropped (27 §0.5.1: release belongs to the extension artifact)`,
  )
  if (manifest.status !== undefined)
    add('mechanical', `status «${manifest.status}» → optional display hint (27 §0.5.2)`)
  if (manifest.status === 'unsupported')
    add(
      'decision',
      'status unsupported → data-only FormatDefinition (30 §2), not a codec (27 §0.5.2)',
    )

  // topology
  const kinds = manifest.sourceKinds ?? []
  const namespaceKinds = kinds.filter(k =>
    ['directory', 'vfs-root', 'installation-root'].includes(k),
  )
  const singleKinds = kinds.filter(k => ['file', 'archive-entry'].includes(k))
  let topology = 'single'
  if (namespaceKinds.length > 0 && singleKinds.length > 0) {
    topology = 'single+namespace'
    add(
      'split',
      `sourceKinds ${JSON.stringify(kinds)} span single and namespace topologies → two contributions or one namespace codec`,
    )
  } else if (namespaceKinds.length > 0) topology = 'namespace'

  // match
  const match = manifest.match ?? {}
  const matchKinds = Object.keys(match)
  if (match.magic)
    add('mechanical', `magic (${match.magic.length}) → spec.probe byte ranges + probe() code`)
  if (match.xmlRoots)
    add('partial', 'match.xmlRoots has no v2 match field → probe() must parse the root element')
  if (match.parentArtifacts)
    add('partial', 'match.parentArtifacts has no v2 field → host input planner / companion rule')

  // capabilities → operations
  const capHomes = new Map()
  for (const cap of manifest.capabilities ?? []) {
    const m = CAPABILITY_MAPPING[cap] ?? {
      home: 'unclear',
      note: `unknown capability verb «${cap}»`,
    }
    capHomes.set(cap, m.home)
    if (m.home === 'blocked') add('blocked', `capability «${cap}»: ${m.note}`)
    else if (m.home === 'absent') add('absent', `capability «${cap}»: ${m.note}`)
    else if (m.home === 'unclear') add('decision', `capability «${cap}»: ${m.note}`)
  }

  // operations grammar
  const badOps = []
  for (const op of manifest.operations ?? []) {
    const verdict = operationIdVerdict(op, contributionId)
    if (!verdict.ok) badOps.push(`${op} → ${verdict.fix}`)
  }
  if (badOps.length > 0) add('rename', `operation ids outside AC §5 grammar: ${badOps.join(', ')}`)
  if ((manifest.operations ?? []).length > 0)
    add(
      'partial',
      'operations need handlerId/mutatesSource/outputKinds from code (v1 lists ids only)',
    )

  // traits
  for (const t of manifest.traits ?? []) {
    add(
      'partial',
      `trait ${t.id} state «${t.state ?? 'n/a'}» → presence may/will-expose (fidelity ≠ presence, four-record model)`,
    )
  }

  // runtime variants
  const variants = manifest.runtimeVariants ?? []
  const variantSummary = []
  for (const v of variants) {
    const entryKeys = Object.keys(v.entrypoints ?? {})
    const summary = {
      id: v.id,
      environments: v.environments ?? [],
      entrypoints: entryKeys,
      availability: v.availability,
    }
    variantSummary.push(summary)
    if (!SEGMENT.test(String(v.id))) add('rename', `variant id «${v.id}» is not a segment (23 §3)`)
    if (!entryKeys.includes('runtime')) {
      if (entryKeys.length === 0)
        add(
          'absent',
          `variant «${v.id}» has no entrypoints (${v.availability ?? 'n/a'}: ${v.unavailableReason ?? 'catalog-only'}) → data-only FormatDefinition or drop`,
        )
      else
        add(
          'split',
          `variant «${v.id}» entrypoints ${JSON.stringify(entryKeys)} without runtime → detect-only variant has no v2 form (probe lives in the codec module)`,
        )
    }
    for (const key of entryKeys) {
      if (key === 'runtime' || key === 'detect') continue
      if (key === 'viewer')
        add('split', `variant «${v.id}» viewer entrypoint → separate viewer-contribution (13C)`)
      else if (key === 'language')
        add(
          'absent',
          `variant «${v.id}» language entrypoint → language contribution kind not in X3`,
        )
      else
        add('split', `variant «${v.id}» extra entrypoint «${key}» → separate contribution/variant`)
    }
    add(
      'decision',
      `variant «${v.id}»: executionProfile absent in v1 → assign (portable worker-brokered + trusted-node for bundled, R-A1/R-A2)`,
    )
    for (const p of v.permissions ?? []) {
      const mapped = PERMISSION_MAPPING[p]
      if (mapped === undefined)
        add('decision', `variant «${v.id}» permission «${p}» has no G4 mapping`)
      else if (mapped.length !== 1 || mapped[0] !== p)
        add('mechanical', `variant «${v.id}» permission «${p}» → ${mapped.join('+')} (G4)`)
    }
    if (
      v.operations &&
      manifest.operations &&
      JSON.stringify([...v.operations].sort()) !== JSON.stringify([...manifest.operations].sort())
    )
      add(
        'partial',
        `variant «${v.id}» declares a per-variant operation subset — v2 operations are per contribution`,
      )
    if (v.dependencies)
      add(
        'partial',
        `variant «${v.id}» dependencies (codec→codec) → dependsOn needs contract ids + mode/scope (23 §8)`,
      )
    if (v.companions)
      add('partial', `variant «${v.id}» companions → spec.companions CompanionRule (shape differs)`)
  }
  if (manifest.companions)
    add('partial', 'companions → spec.companions CompanionRule (shape differs)')
  if (manifest.dependencies)
    add(
      'partial',
      'dependencies (codec→codec requires/integrates) → dependsOn with contract ids + mode/scope (23 §8)',
    )
  if (manifest.standards)
    add(
      'mechanical',
      `standards (${manifest.standards.length}) → formatRefs labels now; EcosystemReference/FormatDefinition (30) absent in X3`,
    )
  if (manifest.testedGames)
    add('absent', 'testedGames evidence has no codec-spec field (game plane absent in X3)')
  if (manifest.references) add('absent', 'references (relation plane) has no v2 spec field yet')
  if (manifest.languages) add('absent', 'languages → language contribution kind not in X3')

  for (const key of Object.keys(manifest))
    if (!KNOWN_CODEC_FIELDS.has(key)) add('decision', `unknown v1 field «${key}»`)

  const classes = new Set(issues.map(i => i.class))
  const verdict =
    classes.has('absent') || classes.has('blocked')
      ? 'needs new contract'
      : classes.has('split') || classes.has('rename')
        ? 'convertible with rework'
        : 'mechanical'
  return {
    path: rel,
    contributionId,
    kind: manifest.kind,
    role: X3_ROLE_BY_KIND[manifest.kind] ?? 'semantic',
    status: manifest.status,
    owningExtension: owner ? `${owner.manifest.publisher}/${owner.manifest.id}` : undefined,
    topology,
    matchKinds,
    capabilities: manifest.capabilities ?? [],
    capHomes: Object.fromEntries(capHomes),
    operations: manifest.operations ?? [],
    variants: variantSummary,
    verdict,
    issues,
  }
}

export function analyzeGame(game) {
  const { manifest, rel } = game
  return {
    path: rel,
    contributionId: `${manifest.publisher}/${manifest.id}`,
    status: manifest.status,
    featureGroups: Object.keys(manifest.featureGroups ?? {}),
    testedGames: manifest.testedGames ?? [],
    variants: (manifest.runtimeVariants ?? []).map(v => ({
      id: v.id,
      availability: v.availability,
    })),
    verdict: 'needs new contract',
    issues: [
      {
        class: 'absent',
        what: 'X3 has no game contribution kind (30 §3 EcosystemReference / 27 §6 game spec absent); featureGroups.requires → ScopedContractRequirement',
      },
    ],
  }
}

export function analyzeExtension(ext) {
  const m = ext.manifest
  const issues = []
  issues.push({
    class: 'mechanical',
    what: 'publisher/id/version/license → package.json#modkit + npm fields (27 §0.2)',
  })
  issues.push({
    class: 'mechanical',
    what: 'contributes.* → contributionManifests glob over data-only child envelopes (27 §0.3)',
  })
  if (m.displayName || m.description || m.metadata)
    issues.push({
      class: 'mechanical',
      what: 'displayName/description/metadata dropped from the normalized minimal manifest (Q76)',
    })
  if (m.dependsOn)
    issues.push({
      class: 'partial',
      what: 'dependsOn → ExtensionRequirement needs mode + mandatory scope (Q75)',
    })
  const contributes = m.contributes ?? {}
  return {
    path: ext.rel,
    coordinate: `${m.publisher}/${m.id}`,
    contributes: Object.fromEntries(
      Object.entries(contributes).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
    ),
    issues,
  }
}

/** The whole allocation in one call: what both the report and the converter start from. */
export function analyzeMk2Tree(mk2Root) {
  const tree = readMk2Tree(mk2Root)
  const codecs = tree.codecs.map(analyzeCodec)
  const games = tree.games.map(analyzeGame)
  const extensions = tree.extensions.map(analyzeExtension)
  codecs.sort((a, b) => (a.contributionId < b.contributionId ? -1 : 1))
  games.sort((a, b) => (a.contributionId < b.contributionId ? -1 : 1))
  extensions.sort((a, b) => (a.coordinate < b.coordinate ? -1 : 1))
  return { tree, codecs, games, extensions }
}
