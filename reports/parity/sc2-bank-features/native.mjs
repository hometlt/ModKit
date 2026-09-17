// MK3 sc2-bank arm: public @modkit/blizzard-starcraft2/bank/node API (library, discovery, IO, CLI)
// and the published blizzard/sc2-bank contribution through the codec ABI.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, importPublic, invokeHandler, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { uriOf } from './legacy.mjs'
import { plain, runProbe } from './probes.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/banks/codecs/bank/codec.json'
const decoder = new TextDecoder('utf-8', { fatal: false })

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest, { 'view.inspect': 'inspect', 'export.raw': 'export-raw' })
  const node = await importPublic(packageDir, '@modkit/blizzard-starcraft2/bank/node')
  const probePlan = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8')).spec.probe

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    const text = decoder.decode(bytes)
    const uri = uriOf(input)
    switch (input.probe) {
      case 'detect': {
        const source = {
          kind: 'bytes', ref: { id: uri, uri }, size: BigInt(bytes.length),
          async read(offset, length) { return bytes.slice(Number(offset), Number(offset) + length) },
        }
        const result = await published.codec.createCodec().probe({ source, plan: probePlan })
        return { accepted: result.confidence > 0 }
      }
      case 'metadata':
        return plain((await invokeHandler(published.codec, bytes, uri, 'inspect')).value)
      case 'export.raw':
        return Buffer.from((await invokeHandler(published.codec, bytes, uri, 'export-raw')).value).toString('hex')
    }
    return runProbe(node.module, input.probe, input, text)
  }
  const self = fileURLToPath(import.meta.url)
  const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
  return {
    module: { 'sc2-bank.features-parity': invoke },
    evidence: {
      ...published.evidence,
      publicExports: [{ file: path.relative(blizzardRoot, node.file).replaceAll('\\', '/'), sha256: sha256(await readFile(node.file)) }],
      probesSha256: sha256(await readFile(probes)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
