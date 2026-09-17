// MK3 sc2-strings arm: public strings/core and strings/node exports; hotkey validation and
// detection through the published blizzard/sc2-strings contribution.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, importPublic, invokeHandler, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { hotkeyDiagnostic, pathOf } from './legacy.mjs'
import { drive, plain } from './probes.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/strings/codecs/strings/codec.json'
const decoder = new TextDecoder('utf-8', { fatal: false })

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest, { 'asset.validate': 'validate' })
  const core = await importPublic(packageDir, '@modkit/blizzard-starcraft2/strings/core')
  const node = await importPublic(packageDir, '@modkit/blizzard-starcraft2/strings/node')
  const probePlan = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8')).spec.probe
  const api = { ...core.module, ...node.module }

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    const uri = `file:///parity/${pathOf(input)}`
    if (input.probe === 'detect') {
      const source = {
        kind: 'bytes', ref: { id: uri, uri }, size: BigInt(bytes.length),
        async read(offset, length) { return bytes.slice(Number(offset), Number(offset) + length) },
      }
      return { accepted: (await published.codec.createCodec().probe({ source, plan: probePlan })).confidence > 0 }
    }
    if (input.probe === 'hotkeys') {
      const diagnostics = (await invokeHandler(published.codec, bytes, uri, 'validate')).value
      return plain(diagnostics
        .filter(item => item.id.startsWith('sc2-strings.hotkeys.'))
        .map(item => hotkeyDiagnostic({
          code: item.code.replace(/^blizzard\.sc2-strings\//u, ''),
          message: item.message,
          severity: item.severity,
          line: item.data.line,
          start: item.data.start,
          end: item.data.end,
        })))
    }
    return drive(api, input, decoder.decode(bytes))
  }
  const self = fileURLToPath(import.meta.url)
  const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
  return {
    module: { 'sc2-strings.extras-parity': invoke },
    evidence: {
      ...published.evidence,
      publicExports: await Promise.all([core, node].map(async item => ({
        file: path.relative(blizzardRoot, item.file).replaceAll('\\', '/'),
        sha256: sha256(await readFile(item.file)),
      }))),
      probesSha256: sha256(await readFile(probes)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
