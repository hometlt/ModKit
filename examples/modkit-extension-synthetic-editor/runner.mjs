import { readFile } from 'node:fs/promises'
import { createHostContributionContractRegistry } from '@modkit/host'
import { validateContributionManifest } from '@modkit/sdk'
import editor from './src/editor.js'
import writerModule from './src/writer.js'

const registry = createHostContributionContractRegistry().validationRegistry()
const results = []
for (const name of ['editor.json', 'writer.json']) {
  const manifest = JSON.parse(
    await readFile(new URL(`./contributions/${name}`, import.meta.url), 'utf8'),
  )
  results.push(await validateContributionManifest(manifest, registry))
}

if (results.some(result => result.specState !== 'validated' || !result.inventoryEligible)) {
  process.stderr.write(`${JSON.stringify(results)}\n`)
  process.exitCode = 2
} else {
  process.stdout.write(
    `${JSON.stringify({ editorAbi: editor.abiVersion, writerAbi: writerModule.abiVersion })}\n`,
  )
}
