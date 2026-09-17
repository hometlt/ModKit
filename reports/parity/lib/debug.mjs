// Development aid (not evidence): run both adapters over a corpus and print a compact summary of
// differing/refused cases per probe, without retaining full outputs on disk.
// Usage: node reports/parity/lib/debug.mjs <codec-dir> [probe-filter] [max-per-probe]
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [dir, filter, maxArg] = process.argv.slice(2)
const max = Number(maxArg ?? 2)
const config = JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'))
const corpus = JSON.parse(await readFile(path.join(dir, config.corpus), 'utf8'))
const legacy = await import(pathToFileURL(path.resolve(dir, config.legacy)).href)
const native = await import(pathToFileURL(path.resolve(dir, config.migrated)).href)
const left = (await legacy.prepareOracle({ operation: config.operation, corpus })).module[config.operation]
const right = (await native.prepareMigrated({ operation: config.operation, corpus })).module[config.operation]
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
const run = async fn => { try { return { ok: JSON.parse(stable(await fn(), 0)) } } catch (error) { return { error: String(error?.message ?? error).slice(0, 300) } } }
const firstDiff = (a, b, at = '') => {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDiff(a[key], b[key], `${at}/${key}`)
      if (found) return found
    }
  }
  return `${at}: ${JSON.stringify(a)?.slice(0, 200)} <> ${JSON.stringify(b)?.slice(0, 200)}`
}
const stats = new Map()
for (const item of corpus.cases) {
  if (filter && !item.id.startsWith(filter)) continue
  const probe = item.id.split('/')[0]
  const row = stats.get(probe) ?? { same: 0, diff: 0, refused: 0, shown: 0 }
  stats.set(probe, row)
  const t = Date.now()
  const [a, b] = [await run(() => left(structuredClone(item.input))), await run(() => right(structuredClone(item.input)))]
  const ms = Date.now() - t
  if (a.error && b.error) row.refused++
  else if (JSON.stringify(a) === JSON.stringify(b)) row.same++
  else {
    row.diff++
    if (row.shown++ < max) console.log(`DIFF ${item.id} (${ms}ms)\n  ${a.error ? `L-ERR ${a.error}` : b.error ? `M-ERR ${b.error}` : firstDiff(a.ok, b.ok)}`)
  }
  if (a.error && b.error && row.refused <= max) console.log(`BOTH-REFUSED ${item.id}: ${a.error} | ${b.error}`)
}
for (const [probe, row] of stats) console.log(probe, JSON.stringify({ same: row.same, diff: row.diff, refused: row.refused }))
