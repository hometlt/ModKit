import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const receipt = JSON.parse(
  readFileSync(resolve(root, 'migration/history/externalization/owner-receipts.json'), 'utf8'),
)
if (receipt.schemaVersion !== 1 || !Array.isArray(receipt.owners) || receipt.owners.length !== 5) {
  throw new Error('externalization owner receipt is incomplete')
}
for (const owner of receipt.owners) {
  if (typeof owner.repository !== 'string' || !/^[a-f0-9]{7,40}$/u.test(owner.commit)) {
    throw new Error('externalization owner receipt has an invalid repository or commit')
  }
}
const groups = readdirSync(resolve(root, 'extensions'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()
const expectedRoots = [
  'archives',
  'audio',
  'data',
  'documents',
  'images',
  'java',
  'lua',
  'models',
  'translation',
  'vector',
  'video',
]
if (JSON.stringify(groups) !== JSON.stringify(expectedRoots)) {
  throw new Error(`core extension roots must match the bundled set; found ${groups.join(', ')}`)
}
console.log(
  `owner receipts checked: ${receipt.owners.length}; core extension roots: ${groups.join(', ')}`,
)
