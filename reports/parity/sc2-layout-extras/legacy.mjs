// Pinned MK2 sc2-layout oracle: detection, the simple parser and the reference-rename plan.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'

const adapter = fileURLToPath(import.meta.url)
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-layout/src'
export const uriOf = input => `file:///parity/${input.install ?? input.fixture ?? input.name}`
const hex = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex')
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`, 'u')

/** The rename request MK3 accepts, expressed as the MK2 options object. */
export const renameOptions = ({ namespace, oldId, newId }) => ({
  canon: raw => (raw.toLocaleLowerCase() === namespace.toLocaleLowerCase() ? namespace : undefined),
  mapped: (candidate, id) => (candidate === namespace && id === oldId ? newId : undefined),
})

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  for (const [entry, execution] of [
    [`${root}/codec.ts`, 'pinned-Sc2LayoutCodec'],
    [`${root}/detect.ts`, 'pinned-detectSc2Layout'],
    ['packages/layouts-processing/src/sc2-layout-core/simple-parse/index.ts', 'pinned-sc2-layout-simple-parse'],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'],
  ])
    loaded.push(await loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile],
      operationOptions: { adapterProtocol: 'sc2-layout-extras-parity-v1', execution },
      runtimeDependencies: [{ name: 'fast-xml-parser' }],
    }))
  const [codecLoaded, detectLoaded, parseLoaded, assetsLoaded] = loaded
  const codec = codecLoaded.module.createSc2LayoutCodec()
  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    const source = assetsLoaded.module.createMemoryAssetSource(bytes, { path: uriOf(input) })
    switch (input.probe) {
      case 'detect':
        return { accepted: (await detectLoaded.module.detectSc2Layout(source, {})).confidence > 0 }
      case 'parse': {
        const text = new TextDecoder().decode(bytes).replace(BOM, '')
        return {
          file: JSON.parse(JSON.stringify(parseLoaded.module.parseLayout(text))),
          references: input.values.map(value => JSON.parse(JSON.stringify(parseLoaded.module.parseReference(value, 'Frame/Child', 'Texture') ?? null))),
        }
      }
      case 'rename': {
        const document = await codec.open(source, {})
        const plan = codec.createReferenceRenameEditTransaction(document, renameOptions(input.request)).plans[0]
        return { patched: plan.summary.referencesPatched, output: plan.edits.length === 0 ? null : hex(plan.edits[0].bytes) }
      }
    }
    throw new Error(`unknown probe ${input.probe}`)
  }
  return { module: { [operation]: invoke }, evidence: { modules: loaded.map(item => item.evidence) } }
}
