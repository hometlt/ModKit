// MK3 sc2-layout arm: the published blizzard/sc2-layout contribution through the codec ABI.
// Workspace validation, visual rendering and schema completion use its published operations.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, invokeHandler, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { project } from './projection.mjs'
import { uriOf } from './legacy.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/layout/codecs/layout/codec.json'
export const handlers = Object.freeze({
  'sc2-layout.parse': 'parse',
  'view.inspect': 'inspect',
  'view.render': 'render-structural',
  'export.convert': 'export-html',
  'export.raw': 'export-raw',
  'asset.validate': 'validate',
  'blizzard/sc2-layout.render-visual': 'render-visual',
  'blizzard/sc2-layout.language-features': 'language-features',
})
const targets = Object.freeze({ 'sc2-layout.parse': 'blizzard/sc2-layout.parse' })
export const targetOperation = legacy => targets[legacy] ?? legacy
const decoder = new TextDecoder('utf-8', { fatal: true })
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`, 'u')

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest,
    Object.fromEntries(Object.entries(handlers).map(([id, handler]) => [targetOperation(id), handler])))
  const call = async (bytes, input, id, request = {}) =>
    (await invokeHandler(published.codec, bytes, uriOf(input), handlers[id], request)).value
  const text = async input => decoder.decode(await caseBytes(input)).replace(BOM, '')

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const bytes = await caseBytes(input)
    switch (probe) {
      case 'parse': return project(probe, { value: await call(bytes, input, 'sc2-layout.parse') })
      case 'view.inspect':
      case 'view.render':
      case 'export.convert':
      case 'export.raw': return project(probe, { value: await call(bytes, input, probe) })
      case 'store-check':
      case 'render-visual': {
        const documents = await Promise.all(input.workspace.map(async f => {
          const file = resolveInput({ f }, corpus)
          return { uri: uriOf(file), text: await text(file) }
        }))
        const id = probe === 'store-check' ? 'asset.validate' : 'blizzard/sc2-layout.render-visual'
        return project(probe, { native: await call(bytes, input, id, { documents, ...(input.rootPath === undefined ? {} : { rootPath: input.rootPath }) }) })
      }
      case 'schema': {
        const snapshot = await call(bytes, input, 'blizzard/sc2-layout.language-features', { rootPath: input.rootPath })
        return project(probe, { value: snapshot.completions })
      }
    }
    throw new Error(`unknown sc2-layout probe: ${probe}`)
  }
  const self = fileURLToPath(import.meta.url)
  const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
  return {
    module: { 'sc2-layout.parity': invoke },
    evidence: {
      ...published.evidence,
      projectionSha256: sha256(await readFile(projection)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
