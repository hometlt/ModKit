// MK3 sc2-document-metadata arm: the published contribution's entrypoint exports and manifest.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, invokeHandler, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/mod/codecs/document-metadata/codec.json'

// Declared projection: MK3 returns the XML as bytes, MK2 as a string; both compare as text.
const asText = value => (typeof value === 'string' ? value : new TextDecoder().decode(value))

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest, { 'view.inspect': 'inspect' })
  const manifestJson = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8'))
  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    if (input.probe === 'write-dependencies') {
      const data = published.codec.buildSc2DocumentInfoDependencies(input.dependencies)
      return { data: JSON.parse(JSON.stringify(data)), text: asText(published.codec.writeSc2DocumentInfoDependencies(input.dependencies)) }
    }
    // The document must open; source.save is not published and persistence stays host-owned.
    await invokeHandler(published.codec, await caseBytes(input), `file:///parity/${input.name}`, 'inspect')
    const publishedSave = manifestJson.spec.operations.some(item => item.id === 'source.save')
    const hostOwned = manifestJson.limitations?.some(line => /host/iu.test(line) && /(persist|save)/iu.test(line)) ?? false
    return { save: publishedSave ? 'available' : 'disabled', hostOwned }
  }
  const self = fileURLToPath(import.meta.url)
  return {
    module: { 'sc2-document-metadata.extras-parity': invoke },
    evidence: { ...published.evidence, adapterSha256: sha256(await readFile(self)) },
  }
}
