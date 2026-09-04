import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { transform, version } from '../../../../modkit-core/node_modules/esbuild/lib/main.js'

const cwd = 'C:/FILES/SC2Files/coding/modkit-core'
const baselineCommit = '878f9cd7658bc065a3eaa034a7f89e5020c887fe'
const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const sha256 = text => createHash('sha256').update(text).digest('hex')
const files = git(['ls-tree', '-r', '--name-only', baselineCommit, '--', 'packages/uv/src']).trim().split('\n').filter(file => file.endsWith('.js'))
assert.equal(files.length, 10, 'UV baseline must contain all ten authored JavaScript files')
const records = []
for (const file of files) {
  const original = git(['show', `${baselineCommit}:${file}`])
  const currentFile = file.replace(/\.js$/u, '.ts')
  const current = await readFile(`${cwd}/${currentFile}`, 'utf8')
  const packagingRewrite = file.endsWith('/module.js')
  const relocated = packagingRewrite ? original.replaceAll('./src/', './dist/') : original
  const options = { loader: 'ts', target: 'esnext', minifySyntax: true, minifyWhitespace: true, legalComments: 'none' }
  const before = (await transform(relocated, options)).code
  const after = (await transform(current, options)).code
  records.push({ file, currentFile, packagingRewrite, sourceSha256: sha256(original), currentSourceSha256: sha256(current), normalizedBeforeSha256: sha256(before), normalizedAfterSha256: sha256(after), equal: before === after })
}
const receipt = { baselineCommit, esbuildVersion: version, files: records.length, identical: records.filter(row => row.equal).length, records }
await writeFile(new URL('./uv-runtime-equivalence.json', import.meta.url), `${JSON.stringify(receipt, null, 2)}\n`)
assert.equal(receipt.identical, 10)
console.log(JSON.stringify({ baselineCommit, files: receipt.files, identical: receipt.identical }))
