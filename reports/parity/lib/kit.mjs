// Shared parity-harness plumbing for pinned MK2 (oracle) and published MK3 (native) adapters.
// Adapters list this file in their loader/runtime evidence; it contains no codec semantics.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPinnedSource, loadMk2, MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'

export const kitFile = fileURLToPath(import.meta.url)
export const workspace = path.resolve(path.dirname(kitFile), '../../../..')
export const mk2Root = path.join(workspace, 'references', 'modkitmk2')
export const blizzardRoot = path.join(workspace, 'modkit-extensions-blizzard')
export const sha256 = value => createHash('sha256').update(value).digest('hex')
// The oracle bundle cache is reproducible scratch, never evidence; keep it out of the repositories.
export const cacheDir = process.env.MODKIT_PARITY_CACHE ?? path.join(os.tmpdir(), 'modkit-parity-cache')

let pinned
export const pinnedSource = () =>
  (pinned ??= createPinnedSource({ repoRoot: mk2Root, commit: MK2_PIN, observeWorkingTree: false }))

/** A case input may name a corpus-level fixture by index (`f`) to keep receipts compact. */
export const resolveInput = (input, corpus) =>
  Number.isSafeInteger(input?.f) ? { ...input, ...corpus.fixtures[input.f] } : input

/** Case bytes: pinned MK2 Git blob, declared corpus file (hash-checked) or inline text. */
export async function caseBytes(input) {
  if (typeof input?.text === 'string') return new TextEncoder().encode(input.text)
  if (typeof input?.fixture === 'string') {
    const record = await (await pinnedSource()).read(input.fixture)
    if (input.sha256 !== undefined && record.sha256 !== input.sha256)
      throw new Error(`pinned fixture differs from corpus: ${input.fixture}`)
    return new Uint8Array(record.bytes)
  }
  if (typeof input?.file === 'string') {
    const bytes = await readFile(path.resolve(workspace, input.file))
    if (sha256(bytes) !== input.sha256) throw new Error(`corpus file changed: ${input.file}`)
    return new Uint8Array(bytes)
  }
  throw new Error('case needs text, fixture or file')
}

export const caseName = input =>
  input?.name ?? path.posix.basename(input?.fixture ?? input?.file?.replaceAll('\\', '/') ?? 'Lib.galaxy')

/** loadMk2 wrapper binding the executed operation/corpus and every adapter-side loader file. */
export function loadPinned(entry, { operation, corpus, loaderFiles, ...options }) {
  if (!loaderFiles?.includes(kitFile)) throw new Error('loaderFiles must bind the adapter and kit')
  return loadMk2(entry, {
    repoRoot: mk2Root,
    commit: MK2_PIN,
    cacheDir,
    operation,
    corpusManifest: corpus,
    observeWorkingTree: false,
    loaderFiles,
    ...options,
  })
}

/** Resolve a public export of an installed MK3 package from the given package directory. */
export async function importPublic(packageDir, specifier) {
  const require = createRequire(path.join(packageDir, 'package.json'))
  const file = require.resolve(specifier)
  return { module: await import(pathToFileURL(file).href), file }
}

/** Single-binding host input, the same shape the host passes to a published codec. */
export function assetInput(bytes, uri) {
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
    revisions: { topology: 'single', revision, bindings: [{ bindingId: 'content', revision }], compositionFingerprint: 'parity' },
    bindingsFor: () => [], async openBinding() { return { value: source, release: async () => {} } },
  }
}

export const budget = Object.freeze({ maxInputBytes: 64_000_000n, maxDepth: 256, maxNodes: 5_000_000, maxScalarBytes: 64_000_000, maxDiagnostics: 100_000 })

/**
 * Load a published codec contribution: the manifest must be listed by the package and publish every
 * operation/handler pair used; the entrypoint is the manifest's own trusted-node variant.
 */
export async function publishedCodec(packageDir, manifestRelative, required) {
  const pkg = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
  if (!(pkg.modkit?.contributionManifests ?? pkg.modkit?.contributions ?? []).some(item => path.posix.normalize(item) === path.posix.normalize(`./${manifestRelative}`)))
    throw new Error(`package does not publish ${manifestRelative}`)
  const manifestFile = path.join(packageDir, manifestRelative)
  const manifestBytes = await readFile(manifestFile)
  const manifest = JSON.parse(manifestBytes)
  for (const [id, handlerId] of Object.entries(required))
    if (!manifest.spec?.operations?.some(item => item.id === id && item.handlerId === handlerId))
      throw new Error(`published operation absent: ${id}/${handlerId}`)
  const variant = manifest.runtimeVariants.find(item => item.variantId === 'trusted-node') ?? manifest.runtimeVariants[0]
  // Entrypoints are package-root relative.
  const entryFile = path.resolve(packageDir, variant.entrypoint)
  const bytes = await readFile(entryFile)
  const codec = await import(pathToFileURL(entryFile).href)
  return {
    codec,
    evidence: {
      manifest: path.relative(workspace, manifestFile).replaceAll('\\', '/'),
      manifestSha256: sha256(manifestBytes),
      entrypoint: path.relative(workspace, entryFile).replaceAll('\\', '/'),
      entrypointSha256: sha256(bytes),
      kitSha256: sha256(await readFile(kitFile)),
    },
  }
}

/** Open bytes through the codec ABI and invoke one handler; the session is always disposed. */
export async function invokeHandler(codec, bytes, uri, handlerId, request = {}) {
  const session = await codec.createCodec().open(assetInput(bytes, uri), 'full', budget)
  try {
    const result = await session.operations().invoke(handlerId, request)
    if (result?.state !== 'ok') throw Object.assign(new Error(result?.reason ?? `${handlerId} refused`), { code: result?.code })
    return result.output
  } finally { await session.dispose() }
}
