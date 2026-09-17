// MK3 sc2-triggers arm: the published blizzard/sc2-triggers contribution through the codec ABI,
// plus the public @modkit/blizzard-starcraft2 triggers/document and triggers/detection exports.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetInput, blizzardRoot, budget, caseBytes, caseName, importPublic, invokeHandler, publishedCodec, resolveInput, sha256 } from '../lib/kit.mjs'
import { DISABLED_VERBS, project, referencesTo } from './projection.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/triggers/codecs/triggers/codec.json'
export const handlers = Object.freeze({
  'view.inspect': 'inspect',
  'script.symbols': 'symbols',
  'script.references': 'references',
  'asset.validate': 'validate',
  'asset.search': 'search',
  'edit.content': 'rename-gamelinks',
  'export.convert': 'export-convert',
  'blizzard/sc2-triggers.to-engine': 'to-engine',
  'blizzard/sc2-triggers.galaxy-to-triggers': 'galaxy-to-triggers',
})
const decoder = new TextDecoder('utf-8', { fatal: false })

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest, handlers)
  const document = await importPublic(packageDir, '@modkit/blizzard-starcraft2/triggers/document')
  const detection = await importPublic(packageDir, '@modkit/blizzard-starcraft2/triggers/detection')
  const manifestJson = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8'))
  const lib = document.module
  const uri = name => `file:///parity/${name}`
  const call = (bytes, name, id, request) => invokeHandler(published.codec, bytes, uri(name), handlers[id], request)
  const json = async (...args) => {
    const output = await call(...args)
    if (output.kind !== 'json') throw new Error(`expected json output, got ${output.kind}`)
    return output.value
  }

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const bytes = await caseBytes(input)
    const name = caseName(input)
    const text = decoder.decode(bytes)
    switch (probe) {
      case 'view.inspect':
        return project(probe, { native: await json(bytes, name, 'view.inspect') })
      case 'script.symbols':
        return project(probe, { native: await json(bytes, name, 'script.symbols') })
      case 'script.references': {
        const own = (await json(bytes, name, 'view.inspect')).libraries[0]
        return project(probe, { native: referencesTo(await json(bytes, name, 'script.references'), input.target, own) })
      }
      case 'asset.validate':
        return project(probe, { native: await json(bytes, name, 'asset.validate') })
      case 'asset.search':
        return project(probe, { native: await json(bytes, name, 'asset.search', { query: input.query, ...(input.types ? { types: input.types } : {}) }) })
      case 'export.convert': {
        const output = await call(bytes, name, 'export.convert', { part: input.part })
        return project(probe, { value: decoder.decode(output.value) })
      }
      case 'edit.content': {
        const output = await call(bytes, name, 'edit.content', { renames: input.renames })
        const edit = output.plan.edits[0]
        if (edit === undefined) throw new Error('gamelink rename refused')
        const patched = Number(/^rename (\d+) /u.exec(edit.label)?.[1])
        return project(probe, { value: { patched, output: patched > 0 ? decoder.decode(edit.payload.bytes) : null } })
      }
      case 'disabled-verbs': {
        const rows = Object.fromEntries(DISABLED_VERBS.map(id => [id, manifestJson.spec.operations.some(item => item.id === id) ? 'available' : 'disabled']))
        const owner = manifestJson.limitations.some(line => /Runtime execution remains owned by the separately permissioned sc2-runtime codec/u.test(line))
        return project(probe, { value: { rows, compileOwner: owner ? 'sc2-runtime' : null } })
      }
      case 'content-scripts': {
        const session = await published.codec.createCodec().open(assetInput(bytes, uri(name)), 'full', budget)
        try {
          const descriptor = typeof session.descriptor === 'function' ? await session.descriptor() : session.descriptor
          const trait = descriptor.traits.find(item => item.id === 'content.scripts')
          return project(probe, { value: trait === undefined ? null : { blocks: trait.parameters.blocks } })
        } finally { await session.dispose() }
      }
      case 'detect':
        return project(probe, { value: detection.module.detectTriggerBytes(bytes.subarray(0, 64 * 1024), { uri: uri(name) }) })
      case 'sax-read':
      case 'sax-read-strings': {
        const strings = input.strings === undefined ? undefined : decoder.decode(await caseBytes(resolveInput({ f: input.strings }, corpus)))
        return project(probe, { value: await lib.readTriggerLibraryFast(text, strings) })
      }
      case 'xml2js-read':
        return project(probe, { value: await lib.readTriggerLibrary(text) })
      case 'source-index':
        return project(probe, { value: lib.scanTriggerSource(text, { sourcePath: name }) })
      case 'trigger-strings':
        return project(probe, { value: lib.parseTriggerStrings(text) })
      case 'to-engine':
        return project(probe, { value: (await json(bytes, name, 'blizzard/sc2-triggers.to-engine', { includeRawFallbacks: true })).program })
      case 'g2t': {
        const script = decoder.decode(await caseBytes(resolveInput({ f: input.script }, corpus)))
        const header = input.header === undefined ? '' : decoder.decode(await caseBytes(resolveInput({ f: input.header }, corpus)))
        const result = await json(bytes, name, 'blizzard/sc2-triggers.galaxy-to-triggers', { libraryId: input.libraryId, script, header })
        return project(probe, { native: result.output })
      }
    }
    throw new Error(`unknown sc2-triggers probe: ${probe}`)
  }
  const self = fileURLToPath(import.meta.url)
  const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
  return {
    module: { 'sc2-triggers.parity': invoke },
    evidence: {
      ...published.evidence,
      publicExports: await Promise.all([document, detection].map(async item => ({
        file: path.relative(blizzardRoot, item.file).replaceAll('\\', '/'),
        sha256: sha256(await readFile(item.file)),
      }))),
      projectionSha256: sha256(await readFile(projection)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
