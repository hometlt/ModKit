// MK3 Galaxy arm: the published blizzard/galaxy contribution through the codec ABI, plus the
// public @modkit/blizzard-starcraft2/galaxy/analysis package export for library-level features.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, caseBytes, caseName, resolveInput, importPublic, invokeHandler, publishedCodec, sha256 } from '../lib/kit.mjs'
import { project, workspaceProbe } from './projection.mjs'

const packageDir = path.join(blizzardRoot, 'starcraft2')
const manifest = 'modules/galaxy/codecs/galaxy/codec.json'
export const handlers = Object.freeze({
  'view.inspect': 'inspect',
  'script.symbols': 'symbols',
  'script.references': 'references',
  'asset.validate': 'validate',
  'script.completion': 'completion',
  'script.format': 'format',
  'edit.structure': 'rename',
  'export.convert': 'export-convert',
  'blizzard/galaxy.to-engine': 'to-engine',
})
const decoder = new TextDecoder('utf-8', { fatal: true })

export async function prepareMigrated({ corpus }) {
  const published = await publishedCodec(packageDir, manifest, handlers)
  const analysis = await importPublic(packageDir, '@modkit/blizzard-starcraft2/galaxy/analysis')
  const manifestJson = JSON.parse(await readFile(path.join(packageDir, manifest), 'utf8'))
  const lib = analysis.module
  const call = (bytes, name, id, request) => invokeHandler(published.codec, bytes, `file:///parity/${name}`, handlers[id], request)
  const json = async (...args) => {
    const output = await call(...args)
    if (output.kind !== 'json') throw new Error(`expected json output, got ${output.kind}`)
    return output.value
  }
  const text = async (...args) => {
    const output = await call(...args)
    if (output.kind !== 'bytes') throw new Error(`expected bytes output, got ${output.kind}`)
    return decoder.decode(output.value)
  }

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    if (probe === 'workspace') {
      const files = await Promise.all(input.files.map(async index => {
        const file = resolveInput({ f: index }, corpus)
        return { name: caseName(file), text: decoder.decode(await caseBytes(file)) }
      }))
      return project(probe, { value: { store: workspaceProbe(new lib.GalaxyStore(), files, input), index: workspaceProbe(new lib.GalaxyWorkspaceIndex(), files, input) } })
    }
    const bytes = await caseBytes(input)
    const name = caseName(input)
    const source = decoder.decode(bytes)
    switch (probe) {
      case 'view.inspect':
        return project(probe, { native: { summary: await json(bytes, name, 'view.inspect'), validate: await json(bytes, name, 'asset.validate') } })
      case 'script.symbols':
        return project(probe, { native: lib.toGalaxySymbolTree(await json(bytes, name, 'script.symbols')) })
      case 'script.references':
        return project(probe, { value: await json(bytes, name, 'script.references', { offset: input.offset }) })
      case 'asset.validate':
      case 'type-check':
        return project(probe, { native: await json(bytes, name, 'asset.validate') })
      case 'script.completion':
        return project(probe, { value: await json(bytes, name, 'script.completion', { offset: input.offset }) })
      case 'script.format':
        return project(probe, { text: await text(bytes, name, 'script.format', input.options ?? {}) })
      case 'export.convert':
        return project(probe, { text: await text(bytes, name, 'export.convert') })
      case 'edit.structure': {
        const output = await call(bytes, name, 'edit.structure', { offset: input.offset, newName: input.newName })
        const edit = output.plan?.edits?.[0]
        if (output.kind !== 'edit-plan' || output.plan.edits.length !== 1 || edit.range?.kind !== 'bytes' || edit.range.offset !== 0n || edit.payload?.kind !== 'inline')
          throw new Error('Galaxy rename plan is not one whole-source replacement')
        const previousName = /^rename (.*) to /u.exec(edit.label ?? edit.description ?? '')?.[1]
        return project(probe, { native: { previousName, output: decoder.decode(edit.payload.bytes) } })
      }
      case 'script.compile': {
        const published = manifestJson.spec.operations.some(item => item.id === 'script.compile')
        const owner = manifestJson.limitations.some(line => /owned by the separately permissioned sc2-runtime codec/u.test(line)) ? 'sc2-runtime' : null
        return project(probe, { native: { state: published ? 'available' : 'disabled', owner } })
      }
      case 'to-engine':
        return project(probe, { value: (await json(bytes, name, 'blizzard/galaxy.to-engine', { moduleId: name, includeRawFallbacks: true })).program })
      case 'analyze-script':
        return project(probe, { value: lib.analyzeGalaxyScript(name, source) })
      case 'language-index':
        return project(probe, { value: lib.analyzeGalaxyLanguage(source, name) })
      case 'language-at':
        return project(probe, {
          value: {
            hover: lib.galaxyHoverAt(source, input.offset, name) ?? null,
            definition: lib.galaxyDefinitionAt(source, input.offset, name) ?? null,
            signature: lib.galaxySignatureAt(source, input.offset, name) ?? null,
            word: lib.galaxyWordAt(source, input.offset) ?? null,
          },
        })
    }
    throw new Error(`unknown galaxy probe: ${probe}`)
  }
  const self = fileURLToPath(import.meta.url)
  const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
  return {
    module: { 'galaxy.parity': invoke },
    evidence: {
      ...published.evidence,
      analysisExport: path.relative(blizzardRoot, analysis.file).replaceAll('\\', '/'),
      analysisExportSha256: sha256(await readFile(analysis.file)),
      projectionSha256: sha256(await readFile(projection)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
