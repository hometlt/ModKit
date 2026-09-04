import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const receipt = JSON.parse(await readFile(path.join(root, 'receipt.json')))
const manifestBytes = await readFile(path.join(root, 'manifest.json'))
if (sha256(manifestBytes) !== receipt.evidenceManifest.sha256)
  throw new Error('Evidence manifest digest differs')
const manifest = JSON.parse(manifestBytes)
if (!manifest.files.length || manifest.files.length !== receipt.evidenceManifest.fileCount)
  throw new Error('Evidence file count differs')
const seen = new Set()
for (const file of manifest.files) {
  if (typeof file.path !== 'string' || /[:\\]/u.test(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..') || seen.has(file.path))
    throw new Error('Unsafe or duplicate evidence path')
  seen.add(file.path)
  const bytes = await readFile(path.join(root, file.path))
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
    throw new Error(`Evidence bytes differ: ${file.path}`)
}
if (sha256(await readFile(new URL('../PORT_SC2_sc2-bank_2026-09-04.md', import.meta.url))) !== receipt.report.sha256)
  throw new Error('Report digest differs')
console.log(`M2 evidence: ${manifest.files.length} files verified. Archived-byte integrity only; not a fresh test run or owner acceptance.`)
