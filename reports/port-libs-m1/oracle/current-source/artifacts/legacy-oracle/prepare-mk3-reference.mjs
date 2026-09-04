import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { codingRoot, loadMk2 } from './load-mk2.mjs'
const repoRoot = path.join(codingRoot, 'modkit-core')
const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', '878f9cd7^{commit}'], { encoding: 'utf8', windowsHide: true }).trim()
const evidenceRoot = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle')
const entries = ['dds/codec.js', 'dds/compressed.js', 'dds/encode.js', 'ops/raster-ops.js']
const modules = {}
for (const entry of entries) {
  const result = await loadMk2(`extensions/images/src/${entry}`, {
    repoRoot, commit, cacheDir: path.join(codingRoot, 'artifacts/legacy-oracle/mk3-reference-cache'),
    workspaceScopes: ['@modkit'], operation: 'accepted-m0-mk3-reference',
    loaderFiles: [fileURLToPath(import.meta.url)],
    additionalFiles: ['extensions/images/vendor/texture2ddecoder/texture2ddecoder.js', 'extensions/images/vendor/texture2ddecoder/texture2ddecoder.wasm'],
  })
  modules[entry] = result.evidence
  console.log(`${entry}: ${result.evidence.sourceFiles.length} pinned inputs, ${result.evidence.cacheKey}`)
}
await writeFile(path.join(evidenceRoot, 'mk3-reference.json'), `${JSON.stringify({ commit, modules }, null, 2)}\n`)
