#!/usr/bin/env node
// Product profile / composition lock gate (PLAN_MODKIT_MK3_FINAL_RU.md §4.2–4.3, блок 10 работа 8).
//
// migration/product-profiles.json is composition data, not a fork of an application. This gate
// proves the data still describes the tree:
//
//   1. every extension family a preset names exists in scripts/app-extension-sets.mjs, and every
//      contribution that family claims exists in extensions/*/*/contributions/**;
//   2. every service provider and every planned-family contribution a preset names exists;
//   3. a preset declared `minimalClosure` carries no optional family — a minimal profile never
//      picks up an editor or a renderer by accident;
//   4. a preset whose families all exist may not hide behind `status: planned`, and a preset with
//      planned families may not claim `status: available`;
//   5. the reference bundle baseline still lists exactly the entries scripts/bundle-hashes.json
//      ratchets, so a profile cannot be widened silently;
//   6. every reference profile of §4.3 is still asserted by scripts/test/minimal-build.test.ts,
//      and a declared byte budget is a number that test actually contains.
//
// Usage: node scripts/migration/check-profiles.mjs [--profiles <path>] [--quiet]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { READY_APP_EXTENSIONS } from '../app-extension-sets.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const quiet = args.includes('--quiet')
const profilesPath = path.resolve(
  argValue('--profiles') ?? path.join(repoRoot, 'migration/product-profiles.json'),
)

const problems = []
const fail = message => problems.push(message)
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

const profiles = readJson(profilesPath)
if (profiles.schemaVersion !== 'product-profiles-1') {
  fail(
    `schemaVersion must be "product-profiles-1", found ${JSON.stringify(profiles.schemaVersion)}`,
  )
}

const RELEASE_CLOSURES = ['mk3-ga', 'mk3-pre-multiverse', 'mk3-multiverse-ga']

const contributionIds = new Set()
for (const file of execFileSync(
  'git',
  ['-C', repoRoot, 'ls-files', 'extensions/*/*/contributions/*.json'],
  {
    maxBuffer: 1 << 30,
  },
)
  .toString('utf8')
  .trim()
  .split('\n')
  .filter(Boolean)) {
  contributionIds.add(readJson(path.join(repoRoot, file)).id)
}

const optional = new Set(profiles.optionalFamilies ?? [])
for (const family of optional) {
  if (!(family in READY_APP_EXTENSIONS))
    fail(`optionalFamilies names ${family}, which is not a known family`)
}

const presetIds = new Set()
for (const preset of profiles.presets ?? []) {
  const label = `preset ${preset.id}`
  if (presetIds.has(preset.id)) fail(`${label}: duplicate preset id`)
  presetIds.add(preset.id)
  if (!['available', 'planned'].includes(preset.status)) {
    fail(`${label}: status must be available or planned, found ${preset.status}`)
  }
  if (!RELEASE_CLOSURES.includes(preset.introducedInClosure)) {
    fail(
      `${label}: introducedInClosure must be one of ${RELEASE_CLOSURES.join(' | ')}, found ${JSON.stringify(preset.introducedInClosure)}`,
    )
  }
  if (!Array.isArray(preset.hosts) || preset.hosts.length === 0)
    fail(`${label}: hosts must not be empty`)

  for (const family of preset.extensionFamilies ?? []) {
    const entry = READY_APP_EXTENSIONS[family]
    if (entry === undefined) {
      fail(`${label}: extension family ${family} is not declared in scripts/app-extension-sets.mjs`)
      continue
    }
    for (const id of entry.contributions) {
      if (!contributionIds.has(id)) {
        fail(
          `${label}: family ${family} claims contribution ${id}, which the extension tree does not contain`,
        )
      }
    }
    if (preset.minimalClosure === true && optional.has(family)) {
      fail(`${label}: a minimal closure profile must not carry the optional family ${family}`)
    }
  }

  for (const planned of preset.plannedFamilies ?? []) {
    if (!Array.isArray(planned.contributions) || planned.contributions.length === 0) {
      fail(`${label}: planned family ${planned.directory} names no contribution`)
    }
    for (const id of planned.contributions ?? []) {
      if (!contributionIds.has(id)) {
        fail(`${label}: planned family ${planned.directory} names ${id}, which does not exist`)
      }
    }
  }

  for (const id of preset.serviceProviders ?? []) {
    if (!contributionIds.has(id)) fail(`${label}: service provider ${id} does not exist`)
  }

  const hasPlanned = (preset.plannedFamilies ?? []).length > 0
  if (hasPlanned && preset.status === 'available') {
    fail(`${label}: a preset that still depends on a staging family cannot be available`)
  }
  if (!hasPlanned && preset.status === 'planned') {
    fail(`${label}: every family already exists, so the preset may not hide behind status planned`)
  }
}

const declaredCounts = profiles.counts ?? {}
const actual = {
  presets: (profiles.presets ?? []).length,
  available: (profiles.presets ?? []).filter(preset => preset.status === 'available').length,
  planned: (profiles.presets ?? []).filter(preset => preset.status === 'planned').length,
  referenceProfiles: (profiles.referenceProfiles?.profiles ?? []).length,
}
for (const [key, value] of Object.entries(actual)) {
  if (declaredCounts[key] !== value)
    fail(`counts.${key} declares ${declaredCounts[key]}, actual ${value}`)
}
const declaredByClosure = declaredCounts.byIntroducedInClosure ?? {}
const actualByClosure = Object.fromEntries(
  RELEASE_CLOSURES.map(closure => [
    closure,
    (profiles.presets ?? []).filter(preset => preset.introducedInClosure === closure).length,
  ]),
)
if (Object.keys(declaredByClosure).join('\n') !== RELEASE_CLOSURES.join('\n')) {
  fail(
    `counts.byIntroducedInClosure must name exactly ${RELEASE_CLOSURES.join(', ')} in release order`,
  )
}
for (const [closure, count] of Object.entries(actualByClosure)) {
  if (declaredByClosure[closure] !== count) {
    fail(
      `counts.byIntroducedInClosure.${closure} declares ${declaredByClosure[closure]}, actual ${count}`,
    )
  }
}

// --- reference bundle baseline ---------------------------------------------------------------------

const baseline = profiles.bundleBaseline ?? {}
const hashes = readJson(path.join(repoRoot, baseline.source ?? 'scripts/bundle-hashes.json'))
const hashKeys = Object.keys(hashes).sort((left, right) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right)),
)
if (baseline.entryCount !== hashKeys.length) {
  fail(
    `bundleBaseline.entryCount declares ${baseline.entryCount}, ${baseline.source} has ${hashKeys.length}`,
  )
}
if ((baseline.entries ?? []).join('\n') !== hashKeys.join('\n')) {
  fail(
    `bundleBaseline.entries no longer matches ${baseline.source}; run the profile update deliberately`,
  )
}

// --- §4.3 reference profiles -----------------------------------------------------------------------

const minimalBuildPath = path.join(
  repoRoot,
  profiles.referenceProfiles?.source ?? 'scripts/test/minimal-build.test.ts',
)
let minimalBuild = ''
try {
  minimalBuild = readFileSync(minimalBuildPath, 'utf8')
} catch {
  fail(`referenceProfiles.source ${profiles.referenceProfiles?.source} cannot be read`)
}
for (const profile of profiles.referenceProfiles?.profiles ?? []) {
  if (!minimalBuild.includes(profile.entry)) {
    fail(
      `reference profile ${profile.id}: ${minimalBuildPath.split(path.sep).pop()} no longer bundles ${profile.entry}`,
    )
  }
  if (profile.budgetBytes !== null) {
    const literal = String(profile.budgetBytes).replace(/\B(?=(\d{3})+(?!\d))/g, '_')
    if (!minimalBuild.includes(literal) && !minimalBuild.includes(String(profile.budgetBytes))) {
      fail(
        `reference profile ${profile.id}: budget ${profile.budgetBytes} is not asserted by the minimal build test`,
      )
    }
  }
}

// --- 7: capability-scoped optional closures (block 12 item 18) ------------------------------------

/*
 * A closure is only meaningful if declining it is cheap, so two things are checked: that every
 * surface a closure names is really published (otherwise a product cannot opt in), and that every
 * such surface is its own bundle entry (otherwise it cannot be dropped, and «optional» is a word
 * rather than a property). A closure with no published surface may only be `planned` — declaring
 * it available would promise an opt-in nobody can take.
 */
const OPTIONAL_CAPABILITIES = ['lsp', 'renderer', 'runtime', 'agent', 'external-tools']
const optionalClosures = profiles.optionalClosures
if (optionalClosures === undefined) {
  fail('product-profiles.json declares no optionalClosures; block 12 item 18 requires all five')
} else {
  const declared = optionalClosures.closures.map(closure => closure.capability)
  if (declared.join(',') !== OPTIONAL_CAPABILITIES.join(',')) {
    fail(
      `optional closures must be exactly ${OPTIONAL_CAPABILITIES.join(', ')}; found ${declared.join(', ')}`,
    )
  }
  const baselineEntries = new Set(baseline.entries ?? [])
  for (const closure of optionalClosures.closures) {
    const label = `optional closure ${closure.capability}`
    if (!['available', 'planned'].includes(closure.status)) {
      fail(`${label}: status must be available or planned`)
    }
    if (closure.status === 'planned' && closure.subpaths.length > 0) {
      fail(`${label}: a planned closure names published subpaths; it is available, not planned`)
    }
    if (closure.status === 'available' && closure.subpaths.length === 0) {
      fail(`${label}: an available closure must name at least one published subpath`)
    }
    for (const family of closure.extensionFamilies ?? []) {
      if (!optional.has(family)) {
        fail(`${label}: names extension family ${family}, which is not declared optional`)
      }
    }
    for (const subpath of closure.subpaths) {
      const match = /^@modkitx-x3\/([a-z-]+)(\/.+)?$/u.exec(subpath)
      if (match === null) {
        fail(`${label}: ${subpath} is not a @modkitx-x3 specifier`)
        continue
      }
      const [, packageName, rest] = match
      const manifestPath = path.join(repoRoot, 'packages', packageName, 'package.json')
      if (!existsSync(manifestPath)) {
        fail(`${label}: ${subpath} names package ${packageName}, which does not exist`)
        continue
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const key = rest === undefined ? '.' : `.${rest}`
      if (manifest.exports?.[key] === undefined) {
        fail(`${label}: ${subpath} is not a published export of ${packageName}`)
        continue
      }
      // droppable means "its own entry": a surface fused into the package root cannot be declined
      const entry = `packages/${packageName}/dist${rest === undefined ? '' : rest}/index.js`
      if (!baselineEntries.has(entry)) {
        fail(
          `${label}: ${subpath} is not a separate bundle entry (${entry}); a surface that cannot be dropped is not optional`,
        )
      }
    }
  }
}

// --- verdict ------------------------------------------------------------------------------------------

if (problems.length > 0) {
  console.error(`profiles:check: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
if (!quiet) {
  console.log(
    `profiles:check: ${actual.presets} presets (${actual.available} available, ${actual.planned} planned); ${actual.referenceProfiles} reference profiles; bundle baseline ${baseline.entryCount} entries`,
  )
}
