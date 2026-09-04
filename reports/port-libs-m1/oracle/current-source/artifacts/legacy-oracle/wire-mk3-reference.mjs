import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot } from './load-mk2.mjs'
const entries = { 'compare-legacy-dds': 'dds/codec.js', 'compare-legacy-dds-bptc': 'dds/codec.js', 'compare-legacy-dds-compressed': 'dds/compressed.js', 'compare-legacy-dds-encode': 'dds/encode.js', 'compare-legacy-image-ops': 'ops/raster-ops.js' }
for (const [name, entry] of Object.entries(entries)) for (const suffix of ['', '.old-m1']) {
  const file = path.join(codingRoot, `artifacts/legacy-parity-textures/${name}${suffix}.mjs`)
  let text = await readFile(file, 'utf8')
  if (text.includes("from '../legacy-oracle/mk3-reference.mjs'")) continue
  if (entry === 'dds/codec.js') text = text.replace('const mk3 = await import(pathToFileURL(mk3Codec).href)', `const mk3 = await loadMk3Reference('${entry}', mk3Codec)`)
  else text = text.replace(/const mk3 = await import\([\s\S]*?\r?\n\)/u, `const mk3 = await loadMk3Reference('${entry}', path.join(codingRoot, 'modkit-core/extensions/images/src/${entry}'))`)
  text = `import { loadMk3Reference } from '../legacy-oracle/mk3-reference.mjs'\n${text}`
  await writeFile(file, text)
}
