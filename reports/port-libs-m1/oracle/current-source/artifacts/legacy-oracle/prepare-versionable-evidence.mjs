import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { codingRoot, sha256, digestManifest } from './load-mk2.mjs'
const root = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle')
const target = path.join(root, 'versionable')
await mkdir(target, { recursive: true })
const records = []
async function copy(origin, destination, expected, extra = {}) {
  const bytes = await readFile(origin)
  const originSha256 = sha256(bytes)
  if (expected && expected !== originSha256) throw new Error(`Evidence source hash mismatch: ${origin}`)
  const compressed = bytes.length >= 5 * 1024 * 1024 && destination.endsWith('.json')
  if (compressed) destination += '.gz'
  const stored = compressed ? gzipSync(bytes, { level: 9 }) : bytes
  await mkdir(path.dirname(path.join(target, destination)), { recursive: true })
  await writeFile(path.join(target, destination), stored)
  records.push({ path: destination.replaceAll('\\', '/'), origin, sha256: sha256(stored), byteLength: stored.length, originSha256, originByteLength: bytes.length, encoding: compressed ? 'gzip' : 'identity', ...extra })
}
const selected = (await readdir(root)).filter(name => /\.(?:old|new)\.(?:receipt\.json|corpus\.json|loader\.json|(?:stdout\.|stderr\.)?log)$/u.test(name) || ['receipt.json', 'mk3-reference.json', 'mk3-reference.initial.json', 'p9-parity.receipt.json', 'shim.receipt.json', 'oracle-verification.receipt.json'].includes(name) || /^(?:shim-|oracle-|p9-parity).*\.log$/u.test(name))
for (const name of selected) await copy(path.join(root, name), `receipts/${name}`)
const snapshots = new Map()
for (const name of selected.filter(name => name.endsWith('.loader.json') || name === 'mk3-reference.json' || name === 'mk3-reference.initial.json' || name === 'p9-parity.receipt.json')) {
  const receipt = JSON.parse(await readFile(path.join(root, name), 'utf8'))
  const modules = receipt.evidence ?? (Array.isArray(receipt.modules) ? receipt.modules : Object.values(receipt.modules ?? {}))
  for (const module of modules) for (const snapshot of module.loaderSnapshots ?? []) {
    const key = `${snapshot.sha256}/${path.basename(snapshot.path)}`
    const record = snapshots.get(key) ?? { ...snapshot, references: [] }
    record.references.push({ receipt: name, cacheKey: module.cacheKey, originalPath: snapshot.path })
    snapshots.set(key, record)
  }
}
for (const [name, snapshot] of snapshots) await copy(snapshot.snapshot, `tested-loader-snapshots/${name}`, snapshot.sha256, { referencedBy: snapshot.references })
for (const name of await readdir(path.join(root, 'old-snapshot'))) await copy(path.join(root, 'old-snapshot', name), `old-snapshot/${name}`)
for (const name of await readdir(path.join(codingRoot, 'artifacts/legacy-oracle'))) if (name.endsWith('.mjs') || name === 'README.md') await copy(path.join(codingRoot, 'artifacts/legacy-oracle', name), `current-source/artifacts/legacy-oracle/${name}`)
for (const name of await readdir(path.join(codingRoot, 'artifacts/legacy-parity-textures'))) if (/^(?:compare-legacy-dds(?:-bptc|-compressed|-encode)?|compare-legacy-image-ops|legacy-mk2)(?:\.old-m1)?\.mjs$/u.test(name)) await copy(path.join(codingRoot, 'artifacts/legacy-parity-textures', name), `current-source/artifacts/legacy-parity-textures/${name}`)
for (const file of ['scripts/migration/lib/legacy-oracle.mjs', 'scripts/migration/test/legacy-oracle.test.mjs']) await copy(path.join(codingRoot, 'modkit-core', file), `current-source/modkit-core/${file}`)
const readme = `# M1 oracle and shared-library evidence\n\nThis selection contains receipts, text logs, ordered corpus hash manifests and exact loader/harness source versions. It includes no game binary corpus, cache bundles, node_modules or WASM binary. The original working artifacts remain intact. JSON above 5 MiB uses lossless gzip; manifest originSha256 is the decompressed digest.\n\nAbsolute C:/FILES/SC2Files paths identify the original local execution environment. To reproduce elsewhere, place the listed repositories at the corresponding layout or adjust the harness corpus root explicitly and record a new receipt. The game corpus is externally supplied and must match each ordered path/size/hash manifest; filenames or counts alone are insufficient. MK2 git commit and accepted MK3 git commit are pinned in the receipts. npm dependency files and runtime data are identified by digests in loader evidence and resolved from installed dependencies, not silently replaced.\n\nThe exact sources used by old/new runs are in tested-loader-snapshots with per-receipt references. The final engine was formatted for lint and its discarded destructured bytes variable explicitly marked used; the additional fixture proves enum, legacy decorator and parameter-property transforms. Final current-source files are distinct from tested snapshots and have separate verification. Historical OLD DDS source raw hashes differ from git blobs only in CRLF, proven by normalized digests. NEW always read pinned git blobs.\n\nAll five OLD/NEW runs used isolated accepted MK3 M0; they do not claim final-current-M1 parity. run-dds-current.mjs is a separate full-corpus post-freeze runner and writes distinct current receipts. ADPCM and inherited WebCrypto MD5 are not implemented P9 claims. The public bzip2 adapter is new bounded functionality, not parity with the inherited throwing placeholder.\n`
await writeFile(path.join(target, 'README.md'), readme)
records.push({ path: 'README.md', origin: 'generated by prepare-versionable-evidence.mjs', sha256: sha256(readme), byteLength: Buffer.byteLength(readme), encoding: 'identity' })
const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), files: records, filesDigest: digestManifest(records), fileCount: records.length, totalBytes: records.reduce((total, record) => total + record.byteLength, 0) }
await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ path: target, files: manifest.fileCount, bytes: manifest.totalBytes, digest: manifest.filesDigest }))
