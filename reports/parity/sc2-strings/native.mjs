// MK3 sc2-strings arm: the published blizzard/sc2-strings contribution through the codec ABI and
// the public @modkit/codec-kit/legacy/xml line model it is built on.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, importPublic, invokeHandler, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { project } from './projection.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/strings/codecs/strings/codec.json'
export const handlers = Object.freeze({
  'view.inspect': 'inspect',
  'asset.validate': 'validate',
  'export.convert': 'export-convert',
  'edit.content': 'edit-strings',
  'sc2-strings.references': 'references',
  'asset.compare': 'compare-locales',
  'sc2-strings.resolve-fallback': 'resolve-fallback',
})
const targets = Object.freeze({
  'sc2-strings.references': 'blizzard/sc2-strings.references',
  'sc2-strings.resolve-fallback': 'blizzard/sc2-strings.resolve-fallback',
})
export const targetOperation = legacy => targets[legacy] ?? legacy
const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
const pathOf = input => input.install ?? input.fixture ?? input.name

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest,
    Object.fromEntries(Object.entries(handlers).map(([legacy, handler]) => [targetOperation(legacy), handler])))
  const xml = await importPublic(packageDir, '@modkit/codec-kit/legacy/xml')
  const lib = xml.module
  const call = (bytes, input, id, request) => invokeHandler(published.codec, bytes, `file:///parity/${pathOf(input)}`, handlers[id], request)
  const json = async (...args) => {
    const output = await call(...args)
    if (output.kind !== 'json') throw new Error(`expected json output, got ${output.kind}`)
    return output.value
  }
  const planText = output => {
    const edit = output.plan?.edits?.[0]
    if (output.kind !== 'edit-plan' || output.plan.edits.length !== 1 || edit.range.offset !== 0n || edit.payload?.kind !== 'inline')
      throw new Error('strings edit plan is not one whole-source replacement')
    return decoder.decode(edit.payload.bytes)
  }
  const otherLocale = async input => {
    const other = resolveInput({ f: input.other }, corpus)
    const model = lib.parseSc2StringsOrdered(await caseBytes(other))
    const entries = [...model.index.keys()].map(key => ({ key, value: lib.effectiveValue(model, key) }))
    const locale = /\/([a-z]{2}[A-Z]{2})\.SC2Data\//iu.exec(pathOf(other))?.[1] ?? 'secondary'
    return { entries, locale }
  }

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const bytes = await caseBytes(input)
    switch (probe) {
      case 'parse': {
        const model = lib.parseSc2StringsOrdered(bytes)
        return project(probe, { value: { model, serialized: lib.serializeStringModel(model) } })
      }
      case 'view.inspect':
        return project(probe, { native: await json(bytes, input, 'view.inspect') })
      case 'asset.validate':
        return project(probe, { native: await json(bytes, input, 'asset.validate') })
      case 'references':
        return project(probe, { value: await json(bytes, input, 'sc2-strings.references', input.key === undefined ? {} : { key: input.key }) })
      case 'export.convert': {
        const output = await call(bytes, input, 'export.convert', {})
        return project(probe, { value: decoder.decode(output.value) })
      }
      case 'export.entries':
        return project(probe, { value: await json(bytes, input, 'export.convert', { format: 'entries' }) })
      case 'edit.content':
        return project(probe, { value: planText(await call(bytes, input, 'edit.content', input.edit)) })
      case 'compare-locales': {
        const { targetLocale: _locale, ...comparison } = await json(bytes, input, 'asset.compare', await otherLocale(input))
        return project(probe, { value: comparison })
      }
      case 'resolve-fallback': {
        const result = await json(bytes, input, 'sc2-strings.resolve-fallback', { ...(await otherLocale(input)), key: input.key })
        return project(probe, { value: { key: result.key, value: result.value ?? null, fromPrimary: result.fromPrimary } })
      }
    }
    throw new Error(`unknown sc2-strings probe: ${probe}`)
  }
  const self = fileURLToPath(import.meta.url)
  const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
  return {
    module: { 'sc2-strings.parity': invoke },
    evidence: {
      ...published.evidence,
      publicExports: [{ file: path.relative(blizzardRoot, xml.file).replaceAll('\\', '/'), sha256: sha256(await readFile(xml.file)) }],
      projectionSha256: sha256(await readFile(projection)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
