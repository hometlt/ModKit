// MK3 Galaxy arm: published blizzard/galaxy probe plus the public galaxy/analysis and
// galaxy/fallback-audit package exports.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, caseName, importPublic, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { drive } from './probes.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/galaxy/codecs/galaxy/codec.json'

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest, {})
  const analysis = await importPublic(packageDir, '@modkit/blizzard-starcraft2/galaxy/analysis')
  const audit = await importPublic(packageDir, '@modkit/blizzard-starcraft2/galaxy/fallback-audit')
  const probePlan = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8')).spec.probe
  const api = {
    ...analysis.module,
    ...audit.module,
    async accepted(bytes, name) {
      const uri = `file:///parity/${name}`
      const source = {
        kind: 'bytes', ref: { id: uri, uri }, size: BigInt(bytes.length),
        async read(offset, length) { return bytes.slice(Number(offset), Number(offset) + length) },
      }
      return (await published.codec.createCodec().probe({ source, plan: probePlan })).confidence > 0
    },
  }
  const self = fileURLToPath(import.meta.url)
  const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
  return {
    module: { 'galaxy.extras-parity': raw => drive(api, resolveInput(raw, corpus), corpus, { caseBytes, caseName, resolveInput }) },
    evidence: {
      ...published.evidence,
      publicExports: await Promise.all([analysis, audit].map(async item => ({
        file: path.relative(blizzardRoot, item.file).replaceAll('\\', '/'),
        sha256: sha256(await readFile(item.file)),
      }))),
      probesSha256: sha256(await readFile(probes)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
