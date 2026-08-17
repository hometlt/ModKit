#!/usr/bin/env node
// MK2 → MK3 allocation report (MK3/27 §8/§12.6/§12.19; MK3/23 §3.1; MK3/24 §3 G4; decision 54).
//
// Read-only over the sibling `modkitx` checkout: for every v1 `codec.manifest.json`,
// `game.manifest.json` and `extension.json` it computes what a mechanical converter into the
// MK3 contribution envelope (`ContributionManifestV1` + `CodecContributionSpecV1`) could carry
// over unchanged, what needs a rename/split, and what has NO home in the current X3 contracts.
// It changes nothing anywhere: it is the "machine-readable allocation source" 27 §12.19 asks
// for, so the counts in the owner catalog can be reproduced instead of maintained by hand.
//
// It deliberately does not import X3 packages (so it runs against any MK2 snapshot); the small
// grammar/vocabulary tables it needs live in scripts/lib/mk3-vocabulary.mjs and are
// cross-checked by scripts/test/report-mk2-allocation.test.ts against @modkitx-x3/core + sdk.
//
// Usage: node scripts/report-mk2-allocation.mjs [--mk2-root <dir>] [--out <file.md>]
//        [--json <file.json>] [--quiet]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  CAPABILITY_MAPPING,
  OPERATION_DOMAINS,
  PERMISSION_MAPPING,
  QUALIFIED,
  SEGMENT,
  SHARED_OPERATION_IDS,
  X3_ROLE_BY_KIND,
} from './lib/mk3-vocabulary.mjs'

const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const x3Root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const mk2Root = resolve(argValue('--mk2-root') ?? join(x3Root, '..', 'modkitx'))
const outPath = argValue('--out')
const jsonPath = argValue('--json')
const quiet = args.includes('--quiet')

if (!existsSync(join(mk2Root, 'extensions'))) {
  console.error(`mk2 allocation report: no extensions/ under ${mk2Root} (use --mk2-root)`)
  process.exit(2)
}

// ---------------------------------------------------------------- X3 vocabulary: scripts/lib/mk3-vocabulary.mjs

// ---------------------------------------------------------------- MK2 scan

const toPosix = p => p.split(sep).join('/')

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
      entry.name === 'extension.json'
    ) {
      out.push(path)
    }
  }
}

const files = []
walk(join(mk2Root, 'extensions'), files)
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

const extensions = files
  .filter(f => f.endsWith(`${sep}extension.json`))
  .map(f => ({ path: f, dir: dirname(f), manifest: readJson(f) }))

function owningExtension(path) {
  let best
  for (const ext of extensions) {
    if (path.startsWith(ext.dir + sep) && (best === undefined || ext.dir.length > best.dir.length))
      best = ext
  }
  return best
}

// ---------------------------------------------------------------- per-codec analysis

function operationIdVerdict(id, contributionId) {
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
  // codec-local verb with a bare prefix: `sc2-data.foo` of org.modkitx/sc2-data keeps its verb
  const localName = contributionId.slice(contributionId.indexOf('/') + 1)
  if (head === localName) return { ok: false, fix: `${contributionId}.${verb.replace(/\./g, '-')}` }
  return { ok: false, fix: `${contributionId}.${id.replace(/\./g, '-')}` }
}

function analyzeCodec(path, manifest) {
  const rel = toPosix(relative(mk2Root, path))
  const contributionId = `${manifest.publisher}/${manifest.id}`
  const owner = owningExtension(path)
  const issues = [] // { class: 'mechanical'|'rename'|'split'|'decision'|'partial'|'blocked'|'absent', what }
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
  let variantSummary = []
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

  const known = new Set([
    '$schema',
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
  for (const key of Object.keys(manifest))
    if (!known.has(key)) add('decision', `unknown v1 field «${key}»`)

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

function analyzeGame(path, manifest) {
  return {
    path: toPosix(relative(mk2Root, path)),
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

function analyzeExtension(ext) {
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
    path: toPosix(relative(mk2Root, ext.path)),
    coordinate: `${m.publisher}/${m.id}`,
    contributes: Object.fromEntries(
      Object.entries(contributes).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
    ),
    issues,
  }
}

const codecs = files
  .filter(f => f.endsWith(`${sep}codec.manifest.json`))
  .map(f => analyzeCodec(f, readJson(f)))
const games = files
  .filter(f => f.endsWith(`${sep}game.manifest.json`))
  .map(f => analyzeGame(f, readJson(f)))
const exts = extensions.map(analyzeExtension)
codecs.sort((a, b) => (a.contributionId < b.contributionId ? -1 : 1))
games.sort((a, b) => (a.contributionId < b.contributionId ? -1 : 1))
exts.sort((a, b) => (a.coordinate < b.coordinate ? -1 : 1))

// ---------------------------------------------------------------- aggregation

const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)
const byVerdict = new Map()
const byKind = new Map()
const byIssueClass = new Map()
const issueKinds = new Map() // normalized issue text → count
const normalizeIssue = what =>
  what
    .replace(/«[^»]*»/g, '«…»')
    .replace(/\([^)]*\)/g, '(…)')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\[.*?\]/g, '[…]')
    .replace(/: .*→/, ': … →')
for (const c of codecs) {
  count(byVerdict, c.verdict)
  count(byKind, `${c.kind}|${c.verdict}`)
  const seen = new Set()
  for (const i of c.issues) {
    const key = `${i.class}: ${normalizeIssue(i.what)}`
    if (seen.has(key)) continue
    seen.add(key)
    count(byIssueClass, i.class)
    count(issueKinds, key)
  }
}

const opIdFixes = new Map()
for (const c of codecs)
  for (const op of c.operations) {
    const v = operationIdVerdict(op, c.contributionId)
    if (!v.ok) count(opIdFixes, `${op} → ${v.fix}`)
  }

// ---------------------------------------------------------------- render

const md = []
md.push('# MK2 → MK3 allocation report')
md.push('')
md.push(
  `Generated by \`node scripts/report-mk2-allocation.mjs\` from \`${toPosix(mk2Root)}\` (read-only). Re-run to reproduce; do not hand-edit counts (27 §12.19).`,
)
md.push('')
md.push('## Snapshot')
md.push('')
md.push(
  `- codec manifests: **${codecs.length}**; game manifests: **${games.length}**; extension.json: **${exts.length}**`,
)
md.push(
  `- codec verdicts: ${[...byVerdict.entries()]
    .sort()
    .map(([k, v]) => `**${k}** ${v}`)
    .join(' · ')}`,
)
md.push(`- games: all ${games.length} «needs new contract» (no game contribution kind in X3)`)
md.push('')
md.push(
  'Verdict legend: **mechanical** — a converter can emit a valid envelope from the manifest alone (code still has to implement `probe/open`); **convertible with rework** — renames (ids/operations) or a split into several contributions/variants; **needs new contract** — at least one capability/plane has no home in the current X3 contracts (write/edit for binaries, language, runtime/launch, game, relations).',
)
md.push('')
md.push('## Codec verdict by family (v1 `kind`)')
md.push('')
md.push('| kind | X3 role | mechanical | convertible with rework | needs new contract | total |')
md.push('| --- | --- | ---: | ---: | ---: | ---: |')
const kinds = [...new Set(codecs.map(c => c.kind))].sort()
for (const kind of kinds) {
  const rows = codecs.filter(c => c.kind === kind)
  const n = v => rows.filter(c => c.verdict === v).length
  md.push(
    `| ${kind} | ${X3_ROLE_BY_KIND[kind] ?? 'semantic'} | ${n('mechanical')} | ${n('convertible with rework')} | ${n('needs new contract')} | ${rows.length} |`,
  )
}
md.push('')
md.push('## Issue classes (codec manifests affected)')
md.push('')
md.push('| class | manifests | meaning |')
md.push('| --- | ---: | --- |')
const classMeaning = {
  mechanical: 'converter emits it without a decision',
  rename: 'coordinate/operation/variant id must change to the MK3 grammar (23 §3, AC §5)',
  split:
    'one v1 unit becomes several v2 contributions/variants (viewer/language entrypoints, mixed topology)',
  decision:
    'an owner/author decision is required (execution profile, unsupported stubs, unknown fields)',
  partial:
    'field exists in v2 but with a different shape/semantics; needs code inspection or hand mapping',
  blocked:
    'expressible only after an X3 contract that is planned but not present (13D writer for binaries)',
  absent: 'plane/kind absent in X3 (language, runtime/launch, game, relations, testedGames)',
}
for (const cls of ['mechanical', 'rename', 'split', 'decision', 'partial', 'blocked', 'absent']) {
  const n = codecs.filter(c => c.issues.some(i => i.class === cls)).length
  md.push(`| ${cls} | ${n} | ${classMeaning[cls]} |`)
}
md.push('')
md.push('## Most frequent issue kinds')
md.push('')
md.push('| count | issue |')
md.push('| ---: | --- |')
for (const [key, n] of [...issueKinds.entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  .slice(0, 40)) {
  md.push(`| ${n} | ${key.replace(/\|/g, '\\|')} |`)
}
md.push('')
md.push('## Operation ids outside the AC §5 grammar (rename table)')
md.push('')
if (opIdFixes.size === 0) md.push('none')
else {
  md.push('| occurrences | v1 id → suggested v2 id |')
  md.push('| ---: | --- |')
  for (const [k, n] of [...opIdFixes.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  ))
    md.push(`| ${n} | \`${k}\` |`)
}
md.push('')
md.push('## Field mapping v1 codec.manifest.json → v2 envelope/spec')
md.push('')
md.push('| v1 | v2 | class |')
md.push('| --- | --- | --- |')
for (const row of [
  [
    'publisher + id',
    'contribution `id` = `publisher/id` (23 §3.1: coordinates preserved, no inheritance from extension)',
    'mechanical',
  ],
  [
    'version',
    'dropped — release/version belongs to the extension artifact (27 §0.5.1)',
    'mechanical',
  ],
  [
    'contractVersion',
    'envelope `contract: {id: org.modkitx/codec-contribution, major: 1}` (different meaning: envelope contract, not codec API)',
    'mechanical',
  ],
  [
    'kind',
    '`spec.roles` (media/container/semantic…) + operation domain; `kind` is not a v2 field (27 §6)',
    'mechanical',
  ],
  [
    'status',
    'optional display hint; `unsupported` stubs → data-only FormatDefinition (27 §0.5.2, 30 §2)',
    'decision',
  ],
  [
    'sourceKinds',
    '`spec.sourceTopology` single | namespace (bundle when companions); mixed → split',
    'partial',
  ],
  [
    'match.extensions / pathGlobs',
    '`spec.match.extensions` (no leading dot) / `pathGlobs`',
    'mechanical',
  ],
  [
    'match.magic',
    '`spec.probe {kind: bytes, ranges, maxBytes}` + byte compare inside `codec.probe()`',
    'mechanical + code',
  ],
  [
    'match.xmlRoots / parentArtifacts',
    'no v2 match field → probe() logic / host input planner',
    'partial',
  ],
  [
    'capabilities (verbs)',
    'operations (`view.inspect`, `export.*`, `container.extract`, `asset.validate`, `content.resolve-dependencies`), data plane (`read`), implicit (`detect`); `write/edit` blocked (v1 read-only), `language/sign/provision/launch/play` absent',
    'mixed',
  ],
  [
    'operations (ids)',
    '`spec.operations[] {id, handlerId, mutatesSource, requiredPermissions, outputKinds}` — ids must fit AC §5 grammar (rename table above)',
    'partial',
  ],
  [
    'traits[] {id, representations, state}',
    '`spec.traitDeclarations[] {id, representation, presence}` — `state` is fidelity, `presence` is not (four-record trait model)',
    'partial',
  ],
  [
    'runtimeVariants[].id / environments / operatingSystems / architectures',
    '`variantId` (segment) / `target.environments|operatingSystems|architectures`',
    'mechanical',
  ],
  [
    'runtimeVariants[].entrypoints {runtime, detect, viewer, language, …}',
    'single `entrypoint` = runtime; `detect` merges into the module (`probe`); `viewer` → viewer contribution; `language` → absent',
    'split',
  ],
  [
    'runtimeVariants[].capabilities / operations',
    'dropped — operations are per contribution in v2 (per-variant subsets lost)',
    'partial',
  ],
  ['runtimeVariants[].permissions', '`requestedPermissionClasses` via G4 mapping', 'mechanical'],
  [
    '(none)',
    '`executionProfile` — must be assigned: portable `worker-brokered` + `trusted-node` for bundled (R-A1/R-A2)',
    'decision',
  ],
  [
    'runtimeVariants[].availability / unavailableReason',
    'no v2 field; unavailable variant = catalog stub → FormatDefinition or drop',
    'absent',
  ],
  [
    'runtimeVariants[].requiredHostCapabilities',
    'same JSON name in `target` (23 §8 keeps v1 names)',
    'mechanical',
  ],
  [
    'dependencies / runtimeVariants[].dependencies (requires/integrates by codec id)',
    '`dependsOn[] {contract, major, mode, scope}` — needs contract ids, not codec ids (23 §8)',
    'partial',
  ],
  ['companions', '`spec.companions[]` CompanionRule (bundle topology)', 'partial'],
  [
    'standards',
    '`formatRefs[].label`; ecosystem/format knowledge → 30 §2/§3 (absent in X3)',
    'mechanical',
  ],
  ['limitations', '`limitations`', 'mechanical'],
  [
    'testedGames / references / languages',
    'no v2 codec-spec field (game/relation/language planes absent in X3)',
    'absent',
  ],
])
  md.push(`| ${row[0]} | ${row[1]} | ${row[2]} |`)
md.push('')
md.push('## Games (31) and extension.json (45)')
md.push('')
md.push(
  `- games: no \`game\` contribution kind in X3; \`featureGroups.requires\` (codec ids + ranges) would become ScopedContractRequirement lists; \`testedGames\` is evidence (30 §3). Coordinates: ${games.map(g => `\`${g.contributionId}\``).join(', ')}.`,
)
md.push(
  `- extension.json → package.json#modkit: publisher/id/version/license carry over, \`contributes.*\` is replaced by \`contributionManifests\` globs, displayName/description/metadata are dropped (Q76), \`dependsOn\` (${exts.filter(e => e.issues.some(i => i.class === 'partial')).length}) needs mode+scope (Q75).`,
)
md.push('')
md.push('## Per-codec allocation')
md.push('')
md.push(
  '| contribution | kind | status | topology | variants (id: envs / entrypoints) | verdict | blockers / decisions |',
)
md.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const c of codecs) {
  const variants = c.variants
    .map(
      v =>
        `${v.id}: ${v.environments.join('+') || '—'} / ${v.entrypoints.join('+') || '—'}${v.availability ? ` (${v.availability})` : ''}`,
    )
    .join('<br>')
  const blockers = c.issues
    .filter(
      i =>
        i.class === 'blocked' ||
        i.class === 'absent' ||
        i.class === 'split' ||
        i.class === 'rename',
    )
    .map(i => `${i.class}: ${i.what}`)
    .join('<br>')
  md.push(
    `| \`${c.contributionId}\`<br><sub>${c.owningExtension ?? '?'}</sub> | ${c.kind} | ${c.status} | ${c.topology} | ${variants} | ${c.verdict} | ${blockers.replace(/\|/g, '\\|')} |`,
  )
}
md.push('')

const report = md.join('\n')
if (outPath) writeFileSync(resolve(outPath), report)
if (jsonPath)
  writeFileSync(
    resolve(jsonPath),
    JSON.stringify({ mk2Root: toPosix(mk2Root), codecs, games, extensions: exts }, null, 2),
  )
if (!outPath && !jsonPath) process.stdout.write(report)
else if (!quiet) {
  console.log(
    `mk2 allocation report: ${codecs.length} codecs, ${games.length} games, ${exts.length} extensions → ${[outPath, jsonPath].filter(Boolean).join(', ')}`,
  )
  console.log(
    `  verdicts: ${[...byVerdict.entries()]
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  )
}
