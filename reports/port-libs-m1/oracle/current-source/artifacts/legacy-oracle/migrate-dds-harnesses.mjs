import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot } from './load-mk2.mjs'
const names = ['compare-legacy-dds', 'compare-legacy-dds-bptc', 'compare-legacy-dds-compressed', 'compare-legacy-dds-encode', 'compare-legacy-image-ops']
const archive = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle/old-snapshot')
for (const name of names) {
  let text = await readFile(path.join(archive, `${name}.mjs`), 'utf8')
  text = text.replace('import { readFile, ', 'import { ')
  text = `import { trackedReadFile as readFile } from '../legacy-oracle/track-corpus.mjs'\n${text}`
  if (name === 'compare-legacy-dds' || name === 'compare-legacy-dds-bptc') {
    const start = text.indexOf('/** Load the legacy decoder,') >= 0 ? text.indexOf('/** Load the legacy decoder,') : text.indexOf('/**\n * Load the legacy decoder with')
    const call = 'const legacy = await loadLegacy()'
    const end = text.indexOf(call, start)
    if (start < 0 || end < 0) throw new Error(`Cannot locate archived loader: ${name}`)
    text = `${text.slice(0, start)}const legacy = (await loadPinnedLegacy()).dds${text.slice(end + call.length)}`
    text = `import { loadLegacy as loadPinnedLegacy } from './legacy-mk2.mjs'\n${text}`
    text = text.replace("import { mkdtempSync, writeFileSync } from 'node:fs'\r\n", '').replace("import { mkdtempSync, writeFileSync } from 'node:fs'\n", '')
    text = text.replace("import { tmpdir } from 'node:os'\r\n", '').replace("import { tmpdir } from 'node:os'\n", '')
    text = text.replace(/const legacySource = path\.join\([\s\S]*?\n\)\r?\n/u, '')
    text = text.replace(/const legacyWasm = path\.join\([\s\S]*?\n\)\r?\n/u, '')
  }
  // Preserve comparison algorithms, sampling, synthetic generators and refusal accounting.
  const firstCommentEnd = text.indexOf('*/')
  const firstCommentStart = text.indexOf('/**')
  text = `${text.slice(0, firstCommentStart)}/** Pinned MK2 vs MK3 parity. Universal loader: step 0.3; original harness in M1 old-snapshot.\n * --corpus is required for real files; original default caps and synthetic cases are unchanged.\n */${text.slice(firstCommentEnd + 2)}`
  await writeFile(path.join(codingRoot, 'artifacts/legacy-parity-textures', `${name}.mjs`), text)
}
