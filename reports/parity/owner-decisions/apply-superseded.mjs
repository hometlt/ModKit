// Applies an owner "superseded" decision record to the feature ledger and operation map.
//   node reports/parity/owner-decisions/apply-superseded.mjs <record.json>
// The record names its rows, the owner's reason and the MK3 evidence it summarizes.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { stateRoot, workspaceRoot } from '../../../scripts/migration/lib/port-context.mjs'

const file = path.resolve(process.argv[2])
const record = JSON.parse(await readFile(file, 'utf8'))
const reference = {
  path: path.relative(workspaceRoot, file).split(path.sep).join('/'),
  sha256: createHash('sha256').update(await readFile(file)).digest('hex'),
}
const ledgerPath = path.join(stateRoot, 'feature-ledger.json')
const mapPath = path.join(stateRoot, 'operation-map.json')
const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
const map = JSON.parse(await readFile(mapPath, 'utf8'))
for (const { id, contribution } of record.rows) {
  const row = ledger.entries.find(item => item.id === id)
  if (row?.status !== 'pending') throw new Error(`not a pending row: ${id}`)
  Object.assign(row, {
    status: 'superseded',
    evidence: [reference],
    decision: { approvedBy: 'owner', date: record.date, reason: record.reason, ...reference },
  })
  const mapping = map.entries.find(item => item.id === id)
  if (mapping) Object.assign(mapping, { status: 'superseded' }, contribution ? { contribution } : {})
}
await writeFile(ledgerPath, stable(ledger))
await writeFile(mapPath, stable(map))
console.log(`superseded ${record.rows.length} rows`)
