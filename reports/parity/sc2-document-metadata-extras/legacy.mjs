// Pinned MK2 sc2-document-metadata oracle: dependency-only DocumentInfo writers and the declared
// source.save state.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'

const adapter = fileURLToPath(import.meta.url)
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-document-metadata/src'

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  for (const [entry, execution] of [
    [`${root}/edit.ts`, 'pinned-sc2-document-metadata-edit'],
    [`${root}/codec.ts`, 'pinned-Sc2DocumentMetadataCodec'],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'],
  ])
    loaded.push(await loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile],
      operationOptions: { adapterProtocol: 'sc2-document-metadata-extras-parity-v1', execution },
    }))
  const [editLoaded, codecLoaded, assetsLoaded] = loaded
  const codec = codecLoaded.module.createSc2DocumentMetadataCodec()
  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    if (input.probe === 'write-dependencies') {
      const data = editLoaded.module.buildSc2DocumentInfoDependencies(input.dependencies)
      return { data: JSON.parse(JSON.stringify(data)), text: editLoaded.module.writeSc2DocumentInfoDependencies(input.dependencies) }
    }
    const source = assetsLoaded.module.createMemoryAssetSource(await caseBytes(input), { path: input.name })
    const descriptor = await codec.describe(await codec.open(source, {}), {})
    const save = descriptor.operations.find(item => item.id === 'source.save')
    return { save: save?.state ?? 'absent', hostOwned: save?.reason?.code === 'host-unsupported' }
  }
  return { module: { [operation]: invoke }, evidence: { modules: loaded.map(item => item.evidence) } }
}
