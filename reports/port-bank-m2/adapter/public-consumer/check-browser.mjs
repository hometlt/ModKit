import { readFileSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = 'C:/FILES/SC2Files/coding/modkit-extensions-blizzard'
const metaPath = fileURLToPath(new URL('../browser/metafile.json', import.meta.url))
const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/u, '')))
const imports = [...Object.entries(meta.inputs), ...Object.entries(meta.outputs)]
  .flatMap(([owner, value]) => (value.imports ?? []).map(entry => ({ owner, ...entry })))
const nodeImports = imports.filter(entry => entry.path.startsWith('node:') || builtins.has(entry.path))
const externalImports = imports.filter(entry => entry.external === true)
const receipt = {
  publicEntrypoints: ['@modkit/blizzard-starcraft2/bank/codec', '@modkit/blizzard-starcraft2/bank/core'],
  compiler: 'esbuild', platform: 'browser',
  inputFiles: Object.keys(meta.inputs).length,
  importEdges: imports.length,
  nodeImports,
  externalImports,
  outputs: Object.entries(meta.outputs).map(([path, output]) => ({
    path, bytes: output.bytes,
    sha256: createHash('sha256').update(readFileSync(resolve(workspace, path))).digest('hex'),
  })),
  pass: nodeImports.length === 0 && externalImports.length === 0,
}
writeFileSync(new URL('./browser-check.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt, null, 2))
if (!receipt.pass) process.exitCode = 1
