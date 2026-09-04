import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPinnedSource, loadMk2, MK2_PIN } from '../../../../../modkit-core/scripts/migration/lib/legacy-oracle.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../../..')
const repoRoot = path.join(workspace, 'references', 'modkitmk2')
const cacheDir = path.join(here, 'cache')
const codecEntry = 'extensions/blizzard/starcraft-2/codecs/sc2-bank/src/codec.ts'
const assetsEntry = 'packages/assets/src/source.ts'
const fixture = 'extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/fixtures/endofdreamsbank2.SC2Bank'
const operations = new Set([
  'view.inspect',
  'asset.validate',
  'edit.content',
  'source.save-as',
  'export.raw',
  'save.sign',
  'blizzard/sc2-bank.verify',
])

const sha256 = value => createHash('sha256').update(value).digest('hex')

function assertOperation(operation) {
  if (!operations.has(operation)) throw new Error(`Unsupported SC2 bank oracle operation: ${operation}`)
}

function signatureInfo(input) {
  const value = input?.signatureInfo
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object') throw new Error('signatureInfo must be an object')
  for (const key of ['bankName', 'authorId', 'playerId']) {
    if (typeof value[key] !== 'string' || !value[key]) throw new Error(`signatureInfo.${key} is required`)
  }
  return value
}

async function bytesFor(input, corpus, pinnedSource) {
  if (typeof input?.xml === 'string') return { xml: input.xml, sourcePath: input.path ?? '/synthetic.SC2Bank' }
  if (input?.pinnedFixture === true) {
    const record = await pinnedSource.read(fixture)
    return { xml: record.bytes.toString('utf8'), sourcePath: input.path ?? '/tmp/endofdreamsbank2.SC2Bank' }
  }
  if (typeof input?.file !== 'string' || !input.file) throw new Error('Case needs xml, pinnedFixture, or file')
  const declared = corpus.files?.find(item => item.path === input.file)
  if (!declared) throw new Error(`Case source is absent from corpus manifest: ${input.file}`)
  const bytes = await readFile(input.file)
  if (bytes.length !== declared.byteLength || sha256(bytes) !== declared.sha256)
    throw new Error(`Corpus bytes changed since manifest: ${input.file}`)
  return { xml: bytes.toString('utf8'), sourcePath: input.path ?? input.file }
}

function patchRequest(bank, input) {
  if (input?.patch && typeof input.patch === 'object') return input.patch
  if (input?.patchMode !== 'first-value-noop') throw new Error('edit.content case needs patch or first-value-noop')
  for (const section of bank.sections)
    for (const key of section.keys)
      if (key.value !== undefined)
        return { section: section.name, key: key.name, type: key.value.type, value: key.value.value }
  throw new Error('No Value node exists for first-value-noop')
}

/**
 * loadMk2 snapshots only Git blobs. The module's evidence binds this adapter, its loader,
 * fast-xml-parser and the exact operation/corpus JSON passed to runDifferentialCli.
 */
export async function prepareOracle({ operation, corpus }) {
  assertOperation(operation)
  const pinnedSource = await createPinnedSource({ repoRoot, commit: MK2_PIN })
  const [codecLoaded, assetsLoaded] = await Promise.all([
    loadMk2(codecEntry, {
      repoRoot,
      commit: MK2_PIN,
      cacheDir,
      operation,
      operationOptions: { adapterProtocol: 'sc2-bank-oracle-v2', execution: 'pinned-Sc2BankCodec' },
      corpusManifest: corpus,
      additionalFiles: [fixture],
      runtimeDependencies: [{ name: 'fast-xml-parser' }],
      loaderFiles: [fileURLToPath(import.meta.url)],
    }),
    loadMk2(assetsEntry, {
      repoRoot,
      commit: MK2_PIN,
      cacheDir,
      operation,
      operationOptions: { adapterProtocol: 'sc2-bank-oracle-v2', execution: 'pinned-createMemoryAssetSource' },
      corpusManifest: corpus,
      loaderFiles: [fileURLToPath(import.meta.url)],
    }),
  ])
  const dependency = codecLoaded.evidence.dependencies.find(item => item.name === 'fast-xml-parser')
  if (dependency?.version !== '4.5.6') throw new Error(`Pinned fast-xml-parser 4.5.6 required, got ${dependency?.version ?? 'missing'}`)
  const codec = codecLoaded.module.createSc2BankCodec()
  const assets = assetsLoaded.module
  if (typeof assets.createMemoryAssetSource !== 'function') throw new Error('Pinned assets lacks createMemoryAssetSource')
  const invoke = async input => {
    const { xml, sourcePath } = await bytesFor(input, corpus, pinnedSource)
    const source = assets.createMemoryAssetSource(new TextEncoder().encode(xml), { path: sourcePath })
    const document = await codec.open(source, {})
    const descriptor = await codec.describe(document, {})
    const session = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source'] })
    try {
      switch (operation) {
        case 'view.inspect': return await session.invoke('sc2-bank.view.inspect')
        case 'asset.validate': return await session.invoke('sc2-bank.asset.validate')
        case 'edit.content': {
          const patch = await session.invoke('sc2-bank.edit.content', patchRequest(document.bank, input))
          if (patch.ok === false) throw Object.assign(new Error(patch.reason), { code: 'PATCH_REFUSED' })
          return patch
        }
        case 'source.save-as': return await session.invoke('sc2-bank.source.save-as', input?.serializeOptions ?? {})
        case 'export.raw': return await session.invoke('sc2-bank.export.raw')
        case 'save.sign': {
          const info = signatureInfo(input)
          const signed = info === undefined
            ? await session.invoke('sc2-bank.save.sign')
            : codec.sign(document, info)
          if (signed.ok === false) throw Object.assign(new Error(signed.reason), { code: 'PATCH_REFUSED' })
          return signed
        }
        case 'blizzard/sc2-bank.verify': return codec.verify(document, signatureInfo(input))
        default: throw new Error(`Unhandled oracle operation: ${operation}`)
      }
    } finally { await session.dispose() }
  }
  return { module: { [operation]: invoke }, evidence: { modules: [codecLoaded.evidence, assetsLoaded.evidence] } }
}
