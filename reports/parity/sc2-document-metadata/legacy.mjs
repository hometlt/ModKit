// Pinned MK2 sc2-document-metadata oracle: the legacy codec session and its structural detector.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { hex, project } from './projection.mjs'

const adapter = fileURLToPath(import.meta.url)
const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-document-metadata/src'
const pathOf = input => input.install ?? input.fixture ?? input.name

export async function prepareOracle({ operation, corpus }) {
  const load = (entry, execution) =>
    loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, projection],
      operationOptions: { adapterProtocol: 'sc2-document-metadata-parity-v1', execution },
    })
  const [codecLoaded, detectLoaded, assetsLoaded] = await Promise.all([
    load(`${root}/codec.ts`, 'pinned-Sc2DocumentMetadataCodec'),
    load(`${root}/detect.ts`, 'pinned-detectSc2DocumentMetadata'),
    load('packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'),
  ])
  const codec = codecLoaded.module.createSc2DocumentMetadataCodec()
  const detect = detectLoaded.module
  const assets = assetsLoaded.module

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const bytes = await caseBytes(input)
    const source = assets.createMemoryAssetSource(bytes, { path: pathOf(input) })
    if (probe === 'detect') {
      // An MK2 host opened sidecars as children of their map/mod/campaign and said so in context.
      const parent = /\.(sc2map|sc2mod|sc2campaign)\//iu.exec(pathOf(input))?.[1].toLowerCase().replace('sc2', 'sc2-')
      const result = await detect.detectSc2DocumentMetadata(source, parent === undefined ? {} : { parentArtifactIds: [parent] })
      return project(probe, { value: { format: detect.detectSc2DocumentMetadataFormat(bytes) ?? null, accepted: result.confidence > 0 } })
    }
    const document = await codec.open(source, {})
    const descriptor = await codec.describe(document, {})
    const session = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source', 'write-source', 'write-workspace'] })
    const call = (id, request) => session.invoke(`sc2-document-metadata.${id}`, request)
    try {
      switch (probe) {
        case 'view.inspect': return project(probe, { legacy: await call('view.inspect') })
        case 'asset.validate': return project(probe, { legacy: await call('asset.validate') })
        case 'export.raw': return project(probe, { value: hex((await call('export.raw')).data) })
        case 'export.convert': return project(probe, { value: hex((await call('export.convert')).data) })
        case 'edit.content': {
          const plan = await call('edit.content', { dependencies: input.dependencies })
          if (plan.edits.length !== 1) throw new Error('dependency edit produced no replacement')
          return project(probe, { value: hex(plan.edits[0].bytes) })
        }
      }
    } finally { await session.dispose() }
    throw new Error(`unknown sc2-document-metadata probe: ${probe}`)
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: [codecLoaded.evidence, detectLoaded.evidence, assetsLoaded.evidence] },
  }
}
