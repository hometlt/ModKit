// MK3 sc2-document-metadata arm: the published blizzard/sc2-document-metadata contribution through
// the codec ABI (probe, open, operations); its entrypoint's exported structural format selector.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, invokeHandler, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { hex, project } from './projection.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/mod/codecs/document-metadata/codec.json'
export const handlers = Object.freeze({
  'view.inspect': 'inspect',
  'asset.validate': 'validate',
  'export.raw': 'export-raw',
  'export.convert': 'export-convert',
  'edit.content': 'replace-dependencies',
})
const pathOf = input => input.install ?? input.fixture ?? input.name

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest, handlers)
  const probePlan = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8')).spec.probe
  const codec = published.codec
  const uri = input => `file:///parity/${pathOf(input)}`
  const call = async (bytes, input, id, request) => invokeHandler(codec, bytes, uri(input), handlers[id], request)

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const bytes = await caseBytes(input)
    switch (probe) {
      case 'detect': {
        const source = {
          kind: 'bytes', ref: { id: uri(input), uri: uri(input) }, size: BigInt(bytes.length),
          async read(offset, length) { return bytes.slice(Number(offset), Number(offset) + length) },
        }
        const result = await codec.createCodec().probe({ source, plan: probePlan })
        const format = codec.metadataFormat(bytes.subarray(0, 4096), uri(input))
        // The MK2 selector is structural only; an empty sidecar is accepted by path context alone.
        return project(probe, { value: { format: bytes.length === 0 ? null : format ?? null, accepted: result.confidence > 0 } })
      }
      case 'view.inspect': {
        const output = await call(bytes, input, 'view.inspect')
        return project(probe, { native: output.value })
      }
      case 'asset.validate':
        return project(probe, { native: (await call(bytes, input, 'asset.validate')).value })
      case 'export.raw':
      case 'export.convert':
        return project(probe, { value: hex((await call(bytes, input, probe)).value) })
      case 'edit.content': {
        const output = await call(bytes, input, 'edit.content', { dependencies: input.dependencies })
        return project(probe, { value: hex(output.plan.edits[0].payload.bytes) })
      }
    }
    throw new Error(`unknown sc2-document-metadata probe: ${probe}`)
  }
  const self = fileURLToPath(import.meta.url)
  const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
  return {
    module: { 'sc2-document-metadata.parity': invoke },
    evidence: {
      ...published.evidence,
      projectionSha256: sha256(await readFile(projection)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
