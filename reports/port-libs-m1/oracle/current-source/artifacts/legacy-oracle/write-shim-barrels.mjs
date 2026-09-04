import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot } from './load-mk2.mjs'
const root = path.join(codingRoot, 'modkit-core/packages/codec-kit/src')
const barrels = {
  'legacy/core': ['errors', 'logger'],
  'legacy/assets': ['artifact-codec', 'artifact-session', 'source', 'operations', 'descriptor', 'diagnostics', 'capabilities', 'cancellation', 'json', 'content', 'contributions', 'companions', 'editing', 'registry-compat'],
  'legacy/semantic': ['data', 'documents', 'layouts', 'localization', 'maps', 'mods', 'replays', 'saves', 'scripts'],
  'legacy/games': ['types'], 'legacy/world': ['contracts'], 'legacy/runtime': ['contracts'],
  crypto: ['sha1', 'mpq'], texture: ['gpu-texture', 'gpu-texture-wasm', 'compressed-texture', 'binary'],
}
for (const [directory, names] of Object.entries(barrels)) {
  await mkdir(path.join(root, directory), { recursive: true })
  await writeFile(path.join(root, directory, 'index.ts'), names.map(name => `export * from './${name}.js'`).join('\n') + '\n')
}
const packagePath = path.join(root, '../package.json')
const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
for (const name of ['legacy', ...Object.keys(barrels), 'legacy/language-contracts', 'legacy/entity-cards', 'legacy/vfs', 'compression']) pkg.exports[`./${name}`] = { types: `./dist/${name}/index.d.ts`, default: `./dist/${name}/index.js` }
await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n')
