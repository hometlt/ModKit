// External-extension runner (S4/PR-23 shape): executed from this package's own cwd after
// a clean temp install of the packed lab tarballs. Drives the ONE public route through
// @modkitx-x3/testkit: load → inventory → resolve → grant → import → execute.
// `--deny` runs with an empty grant to prove deny-by-default blocks the import.

import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { asGreeterModule, greeterSpecEntry, runMinimalHost } from '@modkitx-x3/testkit'

const here = fileURLToPath(new URL('.', import.meta.url))
const deny = process.argv.includes('--deny')

const request = {
  contract: { contract: 'x3.demo/greeter', major: 1 },
  target: {
    environment: 'node',
    operatingSystem: process.platform === 'win32' ? 'windows' : 'linux',
    architecture: 'x64',
  },
  preferredOutputs: [{ id: 'demo.fancy', definitionRange: '^1.0' }],
  // --deny pins the provider that needs read-source, so the empty grant is refused
  // instead of deterministically falling back to the permissionless provider.
  ...(deny ? { pin: { providerId: 'org.example/x3-greeter-fancy' } } : {}),
}

try {
  const run = await runMinimalHost({
    extensionDirs: [here],
    contributionContracts: [greeterSpecEntry],
    request,
    grant: deny
      ? { id: 'deny-all', classes: [] }
      : { id: 'example-grant', classes: ['read-source'] },
  })
  const greeter = asGreeterModule(run.activation.module).createGreeter(
    run.inventory.extensions[0].contributions.find(
      c => c.manifest?.id === run.result.selected.offer.providerId,
    )?.manifest.spec,
  )
  const output = {
    selected: run.result.selected.offer.providerId,
    alternatives: run.result.alternatives.map(a => a.offer.providerId),
    lockBytes: run.lockText.length,
    greeting: greeter.greet('MK3'),
    fancy: await greeter.greetFromSource?.('MK3'),
  }
  console.log(JSON.stringify(output))
} catch (error) {
  console.error(
    JSON.stringify({
      failed: true,
      code: error?.code,
      message: error?.message,
      context: error?.context,
    }),
  )
  process.exit(3)
}
