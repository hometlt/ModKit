import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createPinnedSource, codingRoot, sha256 } from './load-mk2.mjs'
const plan = JSON.parse(await readFile(path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle/shim-copy-plan.json'), 'utf8'))
const source = await createPinnedSource({ repoRoot: path.join(codingRoot, 'references/modkitmk2') })
for (const copy of plan.copies) {
  if (!copy.destination.startsWith('packages/codec-kit/src/')) throw new Error('Outside assigned package')
  const original = await source.read(copy.source)
  if (original.sha256 !== copy.sha256) throw new Error('Pinned source changed')
  let text = original.bytes.toString()
  for (const rewrite of copy.rewrites) text = text.replaceAll(rewrite.from, rewrite.to)
  const destination = path.join(codingRoot, 'modkit-core', copy.destination)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, text)
  copy.sha256Destination = sha256(text)
}
await writeFile(path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle/shim-copy-plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
console.log(`Copied ${plan.copies.length} pinned neutral library files with exact import rewrites`)
