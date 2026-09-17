// MK3 sc2-layout arm: published blizzard/sc2-layout probe and rename-reference operation, and the
// public @modkit/blizzard-starcraft2/layout/parse export.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, importPublic, invokeHandler, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { uriOf } from './legacy.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/layout/codecs/layout/codec.json'
const hex = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex')
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`, 'u')

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest, { 'edit.content': 'rename-reference' })
  const parse = await importPublic(packageDir, '@modkit/blizzard-starcraft2/layout/parse')
  const probePlan = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8')).spec.probe
  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    const uri = uriOf(input)
    switch (input.probe) {
      case 'detect': {
        const source = {
          kind: 'bytes', ref: { id: uri, uri }, size: BigInt(bytes.length),
          async read(offset, length) { return bytes.slice(Number(offset), Number(offset) + length) },
        }
        return { accepted: (await published.codec.createCodec().probe({ source, plan: probePlan })).confidence > 0 }
      }
      case 'parse': {
        const text = new TextDecoder().decode(bytes).replace(BOM, '')
        return {
          file: JSON.parse(JSON.stringify(parse.module.parseLayout(text))),
          references: input.values.map(value => JSON.parse(JSON.stringify(parse.module.parseReference(value, 'Frame/Child', 'Texture') ?? null))),
        }
      }
      case 'rename': {
        const output = await invokeHandler(published.codec, bytes, uri, 'rename-reference', input.request)
        const edit = output.plan.edits[0]
        const patched = Number(/^rename (\d+) /u.exec(edit.label)?.[1])
        // MK3 spells a no-op as an identity replacement; MK2 as an empty plan.
        return { patched, output: patched === 0 ? null : hex(edit.payload.bytes) }
      }
    }
    throw new Error(`unknown probe ${input.probe}`)
  }
  const self = fileURLToPath(import.meta.url)
  return {
    module: { 'sc2-layout.extras-parity': invoke },
    evidence: {
      ...published.evidence,
      publicExport: path.relative(blizzardRoot, parse.file).split(path.sep).join('/'),
      publicExportSha256: sha256(await readFile(parse.file)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
