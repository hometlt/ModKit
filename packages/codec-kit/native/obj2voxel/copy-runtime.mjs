/** Build-only byte copy of the pinned official glue/declaration; no native compile or runtime API.
 * Fixed paths under this package work after package tsc and explicit private reference builds.
 * Runtime packs need dist plus LICENSE/notices, not this script or the upstream source tree.
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const native = dirname(fileURLToPath(import.meta.url))
const root = resolve(native, '../..')
const provenance = JSON.parse(readFileSync(join(native, 'PROVENANCE.json'), 'utf8'))
const names = ['obj2voxel.mjs', 'obj2voxel.d.mts']
/** Compare byte hashes with the reviewed source manifest before overwriting generated output. */
function verify(path, expected) {
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected, `voxel runtime asset drift: ${path}`)
}
const entries = names.map(name => {
  const source = `src/lib/obj2voxel/${name}`
  const entry = provenance.files.find(item => item.path === source)
  assert(entry && typeof entry.sha256 === 'string', `unlisted voxel runtime asset: ${source}`)
  verify(join(root, source), entry.sha256)
  return { name, source, sha256: entry.sha256 }
})
const output = join(root, 'dist/lib/obj2voxel')
mkdirSync(output, { recursive: true })
for (const entry of entries) {
  copyFileSync(join(root, entry.source), join(output, entry.name))
  verify(join(output, entry.name), entry.sha256)
}
console.log('Pinned voxel runtime: official glue and declaration byte-copied (2 files)')
