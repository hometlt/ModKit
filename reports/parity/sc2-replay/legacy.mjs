// Pinned MK2 sc2-replay oracle: the Node replay codec (pinned @modkitx/replay decoder) session.
import { fileURLToPath } from 'node:url'
import { caseBytes, caseName, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { project } from './projection.mjs'

const adapter = fileURLToPath(import.meta.url)
const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-replay/src'

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  for (const [entry, execution] of [
    [`${root}/node.ts`, 'pinned-createNodeSc2ReplayCodec'],
    [`${root}/detect.ts`, 'pinned-detectSc2Replay'],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'],
  ])
    loaded.push(await loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, projection],
      operationOptions: { adapterProtocol: 'sc2-replay-parity-v1', execution },
    }))
  const [nodeLoaded, detectLoaded, assetsLoaded] = loaded
  // MK3 decodes every known stream; ask the MK2 decoder for the same set.
  const codec = nodeLoaded.module.createNodeSc2ReplayCodec({ parseOptions: { gameEvents: true, messageEvents: true, initData: true, loadInfo: true } })

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    const source = assetsLoaded.module.createMemoryAssetSource(bytes, { path: `/parity/${caseName(input)}`, name: caseName(input) })
    if (input.probe === 'detect')
      return project('detect', { value: (await detectLoaded.module.detectSc2Replay(source, {})).confidence > 0 })
    const document = await codec.open(source, {})
    const descriptor = await codec.describe(document, {})
    const session = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source'] })
    const call = (id, request) => session.invoke(`sc2-replay.${id}`, request)
    try {
      switch (input.probe) {
        case 'view.inspect': return project(input.probe, { legacy: await call('view.inspect') })
        case 'asset.validate': return project(input.probe, { legacy: await call('asset.validate') })
        case 'export.raw': return project(input.probe, { value: await call('export.raw') })
        case 'export.convert': return project(input.probe, { legacy: await call('export.convert') })
        case 'sc2-replay.analyze': return project(input.probe, { legacy: await call('sc2-replay.analyze') })
        case 'view.render': return project(input.probe, { legacy: await call('view.render', { loop: input.loop }) })
        case 'media.seek': return project(input.probe, { legacy: await call('media.seek', { loop: input.loop }) })
        case 'media.play': {
          await call('media.seek', { loop: input.loop })
          return project(input.probe, { legacy: await call('media.play', { action: 'toggle' }) })
        }
      }
    } finally { await session.dispose() }
    throw new Error(`unknown sc2-replay probe: ${input.probe}`)
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: loaded.map(item => item.evidence) },
  }
}
