import path from 'node:path'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { createPinnedSource, codingRoot } from './load-mk2.mjs'
const require = createRequire(path.join(codingRoot, 'modkit-core/package.json'))
const ts = require('typescript')
const source = await createPinnedSource({ repoRoot: path.join(codingRoot, 'references/modkitmk2') })
const queue = ['artifact-codec', 'artifact-session', 'source', 'operations', 'descriptor', 'detection', 'diagnostics', 'capabilities', 'cancellation', 'json', 'editing', 'profiles/image-texture'].map(name => `packages/assets/src/${name}.ts`)
const seen = new Set()
const copies = []
for (let index = 0; index < queue.length; index++) {
  const file = queue[index]
  if (seen.has(file)) continue
  seen.add(file)
  const record = await source.read(file)
  const text = record.bytes.toString()
  copies.push({ source: file, destination: file.replace('packages/assets/src/', 'packages/codec-kit/src/legacy/assets/'), sha256: record.sha256, rewrites: text.includes("'@modkitx/core/errors'") ? [{ from: "'@modkitx/core/errors'", to: "'../core/errors.js'" }] : [] })
  for (const imported of ts.preProcessFile(text).importedFiles) {
    if (!imported.fileName.startsWith('.')) continue
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), imported.fileName)).replace(/\.js$/u, '.ts')
    queue.push(relative)
  }
}
for (const [from, to] of [
  ['packages/core/src/errors.ts', 'legacy/core/errors.ts'],
  ['packages/core/src/logger.ts', 'legacy/core/logger.ts'],
  ['packages/games/src/types.ts', 'legacy/games/types.ts'],
  ['packages/world/src/contracts.ts', 'legacy/world/contracts.ts'],
  ['packages/runtime/src/contracts.ts', 'legacy/runtime/contracts.ts'],
  ['extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/sha1.ts', 'crypto/sha1.ts'],
  ['packages/archives-processing/src/lib/crypto/index.ts', 'crypto/mpq.ts'],
  ['packages/archives-processing/src/lib/compression/index.ts', 'compression/legacy-original.ts'],
  ['packages/archives-processing/src/lib/compression/pako.d.ts', 'compression/pako.d.ts'],
  ...['gpu-texture', 'gpu-texture-wasm', 'compressed-texture', 'binary', 'types'].map(name => [`packages/image-processing/src/core/${name}.ts`, `texture/${name}.ts`]),
  ...['data', 'documents', 'layouts', 'localization', 'maps', 'mods', 'replays', 'saves', 'scripts'].map(name => [`packages/semantic/src/${name}.ts`, `legacy/semantic/${name}.ts`]),
  ...['module', 'document-kind', 'contributions', 'index'].map(name => [`packages/language-contracts/src/${name}.ts`, `legacy/language-contracts/${name}.ts`]),
  ...['model', 'graph', 'providers', 'address', 'index'].map(name => [`packages/entity-cards/src/${name}.ts`, `legacy/entity-cards/${name}.ts`]),
]) {
  const record = await source.read(from)
  copies.push({ source: from, destination: `packages/codec-kit/src/${to}`, sha256: record.sha256, rewrites: [] })
}
for (const copy of copies) {
  const text = (await source.read(copy.source)).bytes.toString()
  const legacyDirectory = copy.destination.includes('/src/legacy/')
  const substitutions = [
    ["'@modkitx/core/errors'", legacyDirectory ? "'../core/errors.js'" : "'../legacy/core/errors.js'"],
    ["'@modkitx/core'", "'../core/index.js'"],
    ["'@modkitx/assets'", legacyDirectory ? "'../assets/index.js'" : "'../legacy/assets/index.js'"],
    ["'@modkitx/assets/profiles/image-texture'", "'../legacy/assets/profiles/image-texture.js'"],
  ]
  copy.rewrites = substitutions.filter(([from]) => text.includes(from)).map(([from, to]) => ({ from, to }))
}
await writeFile(path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle/shim-copy-plan.json'), `${JSON.stringify({ oracleCommit: source.commit, copies }, null, 2)}\n`)
console.log(JSON.stringify(copies.map(copy => ({ source: copy.source, destination: copy.destination })), null, 2))
