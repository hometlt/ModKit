import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const receipt = JSON.parse(await readFile(path.join(root, 'receipt.json')))
const manifestBytes = await readFile(path.join(root, 'manifest.json'))
if (sha(manifestBytes) !== receipt.evidenceManifest.sha256) throw new Error('Manifest digest mismatch')
const manifest = JSON.parse(manifestBytes)
if (manifest.files.length !== receipt.evidenceManifest.fileCount || manifest.files.length === 0) throw new Error('Evidence count mismatch')
const seen = new Set()
for (const item of manifest.files) {
  if (typeof item.path !== 'string' || item.path.split('/').some(part => !part || part === '..' || part === '.') || /[:\\]/u.test(item.path) || seen.has(item.path)) throw new Error('Unsafe or duplicate evidence path')
  seen.add(item.path)
  const bytes = await readFile(path.join(root, item.path))
  if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) throw new Error(`Evidence mismatch: ${item.path}`)
}
console.log(`M1 evidence: ${manifest.files.length} files verified; this verifies archived bytes, not a fresh test run or owner acceptance`)
