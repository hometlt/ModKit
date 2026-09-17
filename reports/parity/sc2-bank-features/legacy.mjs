// Pinned MK2 sc2-bank oracle for library and codec features: core/node API, CLI, codec session
// metadata and structural detection.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { runProbe, plain } from './probes.mjs'

const adapter = fileURLToPath(import.meta.url)
const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-bank/src'
const decoder = new TextDecoder('utf-8', { fatal: false })
export const uriOf = input => `file:///parity/${input.install ?? input.fixture ?? input.name}`

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  for (const [entry, execution] of [
    [`${root}/core/node.ts`, 'pinned-sc2-bank-node'],
    [`${root}/core/cli.ts`, 'pinned-sc2-bank-cli'],
    [`${root}/codec.ts`, 'pinned-Sc2BankCodec'],
    [`${root}/detect.ts`, 'pinned-detectSc2Bank'],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'],
  ])
    loaded.push(await loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, probes],
      operationOptions: { adapterProtocol: 'sc2-bank-features-parity-v1', execution },
      runtimeDependencies: [{ name: 'fast-xml-parser' }],
    }))
  const [nodeLoaded, cliLoaded, codecLoaded, detectLoaded, assetsLoaded] = loaded
  const api = { ...nodeLoaded.module, runBankCli: cliLoaded.module.runBankCli }
  const codec = codecLoaded.module.createSc2BankCodec()

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    const text = decoder.decode(bytes)
    const source = () => assetsLoaded.module.createMemoryAssetSource(bytes, { path: uriOf(input) })
    switch (input.probe) {
      case 'detect': {
        const result = await detectLoaded.module.detectSc2Bank(source(), {})
        return { accepted: result.confidence > 0 }
      }
      case 'metadata':
      case 'export.raw': {
        const document = await codec.open(source(), {})
        const descriptor = await codec.describe(document, {})
        const session = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source'] })
        try {
          if (input.probe === 'metadata') return plain(await session.invoke('sc2-bank.view.inspect'))
          const output = await session.invoke('sc2-bank.export.raw')
          return Buffer.from(typeof output === 'string' ? output : output.data).toString('hex')
        } finally { await session.dispose() }
      }
    }
    return runProbe(api, input.probe, input, text)
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: loaded.map(item => item.evidence) },
  }
}
