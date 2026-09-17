// MK3 sc2-data arm: the published blizzard/sc2-data contribution through the codec ABI
// (probe, open, descriptor, operations).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetInput, blizzardRoot, budget, caseBytes, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { uriOf } from './legacy.mjs'
import { project } from './projection.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/data/codecs/sc2data/codec.json'
export const handlers = Object.freeze({
  'view.inspect': 'inspect',
  'asset.search': 'search',
  'asset.validate': 'validate',
  'sc2-data.references': 'references',
  'sc2-data.resolve-inheritance': 'resolve-inheritance',
  'edit.content': 'rename-entity',
  'export.convert': 'export-catalog',
})
const targets = Object.freeze({
  'sc2-data.references': 'blizzard/sc2-data.references',
  'sc2-data.resolve-inheritance': 'blizzard/sc2-data.resolve-inheritance',
})
export const targetOperation = legacy => targets[legacy] ?? legacy

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest,
    Object.fromEntries(Object.entries(handlers).map(([id, handler]) => [targetOperation(id), handler])))
  const probePlan = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8')).spec.probe
  const codec = published.codec

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const bytes = await caseBytes(input)
    const uri = uriOf(input)
    if (probe === 'detect') {
      const source = {
        kind: 'bytes', ref: { id: uri, uri }, size: BigInt(bytes.length),
        async read(offset, length) { return bytes.slice(Number(offset), Number(offset) + length) },
      }
      return project(probe, { value: await codec.createCodec().probe({ source, plan: probePlan }) })
    }
    const session = await codec.createCodec().open(assetInput(bytes, uri), 'full', budget)
    try {
      if (probe === 'describe') {
        const descriptor = typeof session.descriptor === 'function' ? await session.descriptor() : session.descriptor
        return project(probe, { native: descriptor })
      }
      const result = await session.operations().invoke(handlers[probe], input.request ?? {})
      if (result?.state !== 'ok') throw Object.assign(new Error(result?.reason ?? `${probe} refused`), { code: result?.code })
      const output = result.output
      if (probe === 'edit.content') return project(probe, { native: output.plan })
      if (probe === 'export.convert') return project(probe, { native: output })
      return project(probe, { value: output.value })
    } finally { await session.dispose() }
  }
  const self = fileURLToPath(import.meta.url)
  const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
  return {
    module: { 'sc2-data.parity': invoke },
    evidence: {
      ...published.evidence,
      projectionSha256: sha256(await readFile(projection)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
