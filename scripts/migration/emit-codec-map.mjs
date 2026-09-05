#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { coreRoot, stateRoot, portContext } from './lib/port-context.mjs'
import { codecFamily, discoverContributions, hash, readJson, stable } from './lib/port-state.mjs'

const context = await portContext({ discoverRepositories: true })
const contributions = await discoverContributions(context.repositories)
const ledger = await readJson(path.join(stateRoot, 'feature-ledger.json'))
const byId = new Map(ledger.entries.map(row => [row.id, row]))
const rows = context.units.map(unit => {
  const id = unit.extracted.id
  const requirements = context.requirements.filter(row => row.sourceUnitId === unit.sourceUnitId)
  const pending = requirements.filter(
    row => !byId.has(row.id) || byId.get(row.id).status === 'pending',
  ).length
  const candidates = contributions.filter(
    row => row.formats.includes(id) || row.id.split('/').at(-1) === id,
  )
  return {
    sourceUnitId: unit.sourceUnitId,
    codec: id,
    source: unit.path,
    family: codecFamily(id, context.audits),
    featureAudit: context.audits[id] ? 'available' : 'pending',
    pending,
    requirements: requirements.length,
    status: pending ? 'pending' : 'evidence-ready',
    candidates: candidates.map(row => ({ repository: row.repository, path: row.path, id: row.id })),
  }
})
const output = {
  schemaVersion: 1,
  inventorySha256: hash(stable(context.inventory)),
  legacyCount: rows.length,
  sc2AuditCount: Object.keys(context.audits).length,
  contributionCount: contributions.length,
  rows,
  authored: context.authored,
}
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
const markdown = [
  '# Codec port map',
  '',
  '206 frozen legacy rows; 12 SC2 codec source audits plus 2 shared MPQ/CASC source audits. Identifier matches below are candidates, not parity claims.',
  'Pending requires source copy, behavioral evidence and the declared acceptance surfaces. Existing manifest status does not close a row.',
  '',
  '| Legacy codec | Family | MK3 contribution candidates | Source audit | Pending / required | Status |',
  '|---|---|---|---|---|---|',
  ...rows.map(
    row =>
      `| ${escape(row.codec)} | ${row.family} | ${escape(row.candidates.map(item => `${item.repository}:${item.id}`).join(', ') || 'none')} | ${row.featureAudit} | ${row.pending} / ${row.requirements} | ${row.status} |`,
  ),
  '',
  '## Authored additions outside the frozen 206',
  '',
  ...context.authored.map(
    row =>
      `- ${row.id}: ${row.requirements.length} authored requirements; ${row.plan}. No MK2 parity claim.`,
  ),
  '',
].join('\n')
const artifacts = new Map([
  ['codec-map.json', stable(output)],
  ['codec-map.md', markdown],
  ['port-requirements.json', stable({ schemaVersion: 1, requirements: context.requirements })],
])
for (const [name, bytes] of artifacts) {
  const file = path.join(coreRoot, 'migration/generated', name)
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')) !== bytes)
      throw new Error(`stale generated artifact: ${file}`)
  } else {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }
}
console.log(
  `codec-map: legacy ${rows.length}, SC2 audits ${Object.keys(context.audits).length}, contributions ${contributions.length}, authored ${context.authored.length}`,
)
