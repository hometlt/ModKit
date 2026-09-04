import { writeFileSync } from 'node:fs'
import { readFile as read, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
const output = process.env.MK2_CORPUS_RECORD
const expected = process.env.MK2_CORPUS_EXPECT ? JSON.parse(await read(process.env.MK2_CORPUS_EXPECT, 'utf8')) : null
const reads = []
export async function trackedReadFile(file, ...args) {
  const bytes = await read(file, ...args)
  if (typeof file === 'string' && /\.dds$/iu.test(file)) {
    const record = { path: path.resolve(file), byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    if (expected && JSON.stringify(expected.files[reads.length]) !== JSON.stringify(record)) throw new Error(`Corpus bytes/order changed at ${reads.length}: ${file}`)
    reads.push(record)
  }
  return bytes
}
export async function oracleRunOptions() {
  let manifest = expected
  const argv = process.argv.slice(2)
  const roots = argv.flatMap((value, index) => value === '--corpus' ? [argv[index + 1]] : [])
  if (!roots.length && process.env.MODKITX_SC2_ROOT) roots.push(process.env.MODKITX_SC2_ROOT)
  if (!manifest) {
    const files = []
    async function walk(directory) {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) await walk(file)
        else if (entry.isFile() && /\.dds$/iu.test(entry.name)) {
          const bytes = await read(file)
          files.push({ path: path.resolve(file), byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
        }
      }
    }
    for (const root of roots) await walk(root)
    if (roots.length && !files.length) throw new Error('Empty DDS corpus is not parity evidence')
    manifest = { schemaVersion: 1, roots, selection: 'complete candidate corpus; harness digest and argv define sampling/synthetic inputs', files }
  }
  return {
    operation: path.basename(process.argv[1] ?? 'module-load').replace('.old-m1', ''),
    operationOptions: { argv: process.argv.slice(2), legacyWasmSelection: 'real MK2 runtime; no algorithm stubs' },
    corpusManifest: manifest,
    loaderFiles: [...(process.argv[1] ? [process.argv[1]] : []), new URL('./track-corpus.mjs', import.meta.url)],
  }
}
process.on('exit', () => {
  if (!output) return
  if (expected && reads.length !== expected.files.length) { console.error(`Corpus read count changed: ${reads.length} != ${expected.files.length}`); process.exitCode = 1 }
  writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, operation: path.basename(process.argv[1]).replace('.old-m1', ''), argv: process.argv.slice(2), files: reads }, null, 2)}\n`)
})
