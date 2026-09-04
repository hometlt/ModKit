import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot, sha256 } from './load-mk2.mjs'
export const names = ['compare-legacy-dds', 'compare-legacy-dds-bptc', 'compare-legacy-dds-compressed', 'compare-legacy-dds-encode', 'compare-legacy-image-ops']
const textureRoot = path.join(codingRoot, 'artifacts/legacy-parity-textures')
const archive = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle/old-snapshot')
await mkdir(archive, { recursive: true })
const hashes = []
for (const name of [...names, 'legacy-mk2']) {
  const original = await readFile(path.join(textureRoot, `${name}.mjs`))
  const archived = path.join(archive, `${name}.mjs`)
  try { await writeFile(archived, original, { flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const snapshot = await readFile(archived)
  hashes.push({ path: `${name}.mjs`, sha256: sha256(snapshot) })
  if (name === 'legacy-mk2') {
    await writeFile(path.join(textureRoot, 'legacy-mk2.old-m1.mjs'), snapshot)
    continue
  }
  let text = snapshot.toString()
  text = text.replace("from './legacy-mk2.mjs'", "from './legacy-mk2.old-m1.mjs'")
  text = text.replace('import { readFile, ', 'import { ')
  text = `import { trackedReadFile as readFile } from '../legacy-oracle/track-corpus.mjs'\n${text}`
  await writeFile(path.join(textureRoot, `${name}.old-m1.mjs`), text)
}
await writeFile(path.join(archive, 'manifest.json'), `${JSON.stringify({ files: hashes }, null, 2)}\n`)
