import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createPinnedSource, MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../..')
const codecFile = process.env.SC2_BANK_NATIVE_CODEC ?? path.join(workspace, 'modkit-extensions-blizzard', 'starcraft2', 'dist', 'modules', 'banks', 'codecs', 'bank', 'src', 'codec.js')
const contributionFile = process.env.SC2_BANK_CONTRIBUTION ?? path.join(workspace, 'modkit-extensions-blizzard', 'starcraft2', 'modules', 'banks', 'codecs', 'bank', 'codec.json')
const mk2Root = path.join(workspace, 'references', 'modkitmk2')
const pinnedFixture = 'extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/fixtures/endofdreamsbank2.SC2Bank'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const sha256 = value => createHash('sha256').update(value).digest('hex')
const budget = Object.freeze({ maxInputBytes: 4_000_000n, maxDepth: 64, maxNodes: 100_000, maxScalarBytes: 4_000_000, maxDiagnostics: 1_000 })

const legacyToNative = Object.freeze({
  'view.inspect': { id: 'view.inspect', handlerId: 'inspect', output: 'json' },
  'asset.validate': { id: 'asset.validate', handlerId: 'validate', output: 'json' },
  'export.raw': { id: 'export.raw', handlerId: 'export-raw', output: 'bytes' },
  'edit.content': { id: 'edit.content', handlerId: 'patch-value', output: 'edit-plan' },
  'source.save-as': { id: 'source.save-as', handlerId: 'save-as', output: 'text' },
  'save.sign': { id: 'blizzard/sc2-bank.sign', handlerId: 'sign', output: 'edit-plan' },
  'blizzard/sc2-bank.verify': { id: 'blizzard/sc2-bank.verify', handlerId: 'verify', output: 'json' },
})
let apiPromise
let pinnedSourcePromise

function assetInput(bytes, uri) {
  const revision = `content-hash.sha256:${sha256(bytes)}`
  const ref = { id: uri, uri }
  const source = {
    kind: 'bytes', ref, revision, size: BigInt(bytes.length),
    async read(offset, length, signal) { signal?.throwIfAborted(); return bytes.slice(Number(offset), Number(offset) + length) },
    async *stream() { yield bytes },
  }
  const binding = { sourceKind: 'candidate', bindingId: 'content', role: 'content', ownership: 'owned', source: ref, revision }
  return {
    originKind: 'single', bindings: [binding], primaryBindingId: 'content',
    revisions: { topology: 'single', revision, bindings: [{ bindingId: 'content', revision }], compositionFingerprint: 'sc2-bank-parity' },
    bindingsFor: () => [], async openBinding() { return { value: source, release: async () => {} } },
  }
}

function requireSignatureInfo(input) {
  const value = input?.signatureInfo
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || ['bankName', 'authorId', 'playerId'].some(key => typeof value[key] !== 'string' || !value[key]))
    throw new TypeError('signatureInfo requires bankName, authorId and playerId strings')
  return value
}

async function nativeApi() {
  if (apiPromise) return apiPromise
  apiPromise = (async () => {
    const codecUrl = pathToFileURL(path.resolve(codecFile)).href
    const codec = await import(codecUrl)
    const core = await import(new URL('./core.js', codecUrl).href)
    const manifest = JSON.parse(await readFile(contributionFile, 'utf8'))
    for (const mapping of Object.values(legacyToNative)) {
      if (!manifest.spec?.operations?.some(item => item.id === mapping.id && item.handlerId === mapping.handlerId))
        throw new Error(`Published native operation is absent: ${mapping.id}/${mapping.handlerId}`)
    }
    for (const [legacyId, mapping] of Object.entries(legacyToNative).filter(([id]) => id !== 'blizzard/sc2-bank.verify')) {
      const actual = codec.SC2_BANK_OPERATION_MAP?.[legacyId]
      if (actual?.id !== mapping.id || actual?.handlerId !== mapping.handlerId)
        throw new Error(`Native operation map differs for ${legacyId}`)
    }
    return { codec, core }
  })()
  return apiPromise
}

async function sourceFor(input) {
  if (typeof input?.xml === 'string') return { bytes: encoder.encode(input.xml), uri: input.path ?? '/synthetic.SC2Bank' }
  if (input?.pinnedFixture === true) {
    pinnedSourcePromise ??= createPinnedSource({ repoRoot: mk2Root, commit: MK2_PIN })
    const record = await (await pinnedSourcePromise).read(pinnedFixture)
    return { bytes: record.bytes, uri: input.path ?? '/tmp/endofdreamsbank2.SC2Bank' }
  }
  if (typeof input?.file !== 'string' || !input.file) throw new Error('Case needs xml or file')
  const bytes = await readFile(input.file)
  if (bytes.length !== input.expectedByteLength || sha256(bytes) !== input.expectedSha256)
    throw new Error(`Corpus bytes changed since manifest: ${input.file}`)
  return { bytes, uri: input.path ?? input.file }
}

function patchInput(core, text, input) {
  if (input?.patch && typeof input.patch === 'object') return input.patch
  if (input?.patchMode !== 'first-value-noop') throw new Error('edit.content case needs patch or first-value-noop')
  const bank = core.parseBank(text)
  for (const section of bank.sections)
    for (const key of section.keys)
      if (key.value !== undefined)
        return { section: section.name, key: key.name, type: key.value.type, value: key.value.value }
  throw new Error('No Value node exists for first-value-noop')
}

function unwrap(operation, result, originalBytes) {
  if (result?.state !== 'ok') {
    if (operation === 'edit.content' && result?.reason)
      throw Object.assign(new Error(result.reason), { code: 'PATCH_REFUSED' })
    const error = Object.assign(new Error(result?.reason ?? `Native ${operation} refused`), { code: result?.code ?? (operation === 'save.sign' ? 'CONFIG_INVALID' : undefined) })
    throw error
  }
  const output = result.output
  if (output?.kind === 'json' || output?.kind === 'text') return output.value
  if (output?.kind === 'bytes') return decoder.decode(output.value)
  if (output?.kind === 'edit-plan') {
    const edit = output.plan?.edits?.[0]
    if (edit?.operation !== 'replace' || edit?.range?.kind !== 'bytes' || edit?.range?.offset !== 0n || edit?.payload?.kind !== 'inline')
      throw new Error('Native bank edit plan is not a complete byte replacement')
    const bytes = edit.payload.bytes
    const changed = bytes.length !== originalBytes.length || bytes.some((value, index) => value !== originalBytes[index])
    return { ok: true, xml: decoder.decode(bytes), changed }
  }
  throw new Error(`Unexpected native ${operation} output`)
}

async function invoke(operation, input) {
  const mapping = legacyToNative[operation]
  if (mapping === undefined) throw new Error(`Unsupported native operation: ${operation}`)
  const [{ codec, core }, source] = await Promise.all([nativeApi(), sourceFor(input)])
  const info = requireSignatureInfo(input)
  const instance = info === undefined ? codec.createCodec() : codec.createCodecWithOptions({ signatureInfo: info })
  const session = await instance.open(assetInput(source.bytes, source.uri), 'full', budget)
  try {
    const request = operation === 'edit.content' ? patchInput(core, decoder.decode(source.bytes), input)
      : operation === 'source.save-as' ? input?.serializeOptions ?? {}
        : operation === 'blizzard/sc2-bank.verify' ? (info === undefined ? {} : { signatureInfo: info }) : {}
    try {
      return unwrap(operation, await session.operations().invoke(mapping.handlerId, request), source.bytes)
    } catch (error) {
      if (operation === 'edit.content' || operation === 'save.sign') {
        const cause = error?.cause
        const wrapped = new RegExp(`^operation handler ${operation === 'edit.content' ? 'patch-value' : 'sign'} failed:\\s*`, 'u')
        const message = cause?.message ?? String(error?.message ?? error).replace(wrapped, '')
        if (cause !== undefined || wrapped.test(String(error?.message ?? ''))) {
          throw Object.assign(new Error(message), { code: 'PATCH_REFUSED' })
        }
      }
      throw error
    }
  } finally { await session.dispose() }
}

const inspect = input => invoke('view.inspect', input)
const validate = input => invoke('asset.validate', input)
const patch = input => invoke('edit.content', input)
const saveAs = input => invoke('source.save-as', input)
const exportRaw = input => invoke('export.raw', input)
const sign = input => invoke('save.sign', input)
const verify = input => invoke('blizzard/sc2-bank.verify', input)

export {
  inspect as 'view.inspect',
  validate as 'asset.validate',
  patch as 'edit.content',
  saveAs as 'source.save-as',
  exportRaw as 'export.raw',
  sign as 'save.sign',
  verify as 'blizzard/sc2-bank.verify',
}
