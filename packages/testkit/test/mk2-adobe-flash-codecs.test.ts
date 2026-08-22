import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'adobe-flash')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 1000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('FLA codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('FLA codec has no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array): ArtifactByteSource {
  const uri = 'memory://adobe-flash/fla'
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:adobe-flash-fla'),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function input(value: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: value.ref,
    revision: value.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: value.revision,
      bindings: [{ bindingId: 'content', revision: value.revision }],
      compositionFingerprint: value.ref.id,
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function flaCodec(): Promise<Codec> {
  const module = (await import(pathToFileURL(join(extension, 'src', 'fla', 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function open(bytes: Uint8Array, resourceBudget = budget) {
  return (await flaCodec()).open(input(source(bytes)), 'inspect', resourceBudget)
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

async function extract(session: Awaited<ReturnType<typeof open>>, entryId: string) {
  const result = await session.operations().invoke('extract-entry', { entryId })
  if (result.state !== 'ok' || result.output.kind !== 'bytes') throw new Error('extract failed')
  return result.output.value
}

describe('ported Adobe Flash FLA codec', () => {
  it('inventories a ZIP FLA and extracts stored and deflated project files', async () => {
    const bytes = new Uint8Array(await readFile(join(fixtures, 'minimal.fla')))
    const session = await open(bytes)
    expect(await inspect(session)).toMatchObject({
      format: 'fla',
      container: 'zip/fla',
      entries: 2,
      files: 2,
      extractable: true,
    })
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as NamespaceEntrySource
    expect((await namespace.list('', { limit: 10 })).items).toMatchObject([
      { id: 'DOMDocument.xml', path: 'DOMDocument.xml', kind: 'file' },
      { id: 'LIBRARY/Symbol.xml', path: 'LIBRARY/Symbol.xml', kind: 'file' },
    ])
    expect(new TextDecoder().decode(await extract(session, 'DOMDocument.xml'))).toContain(
      '<DOMDocument',
    )
    expect(new TextDecoder().decode(await extract(session, 'LIBRARY/Symbol.xml'))).toBe(
      '<DOMSymbolItem name="Symbol 1"/>',
    )
    await lease.release()
    await session.dispose()
  })

  it('maps a loose XFL document to a single extractable DOMDocument.xml', async () => {
    const bytes = new TextEncoder().encode('<?xml version="1.0"?><DOMDocument width="320"/>')
    const session = await open(bytes)
    expect(await inspect(session)).toMatchObject({
      format: 'fla',
      container: 'xfl',
      entries: 1,
      files: 1,
      extractable: true,
    })
    expect(await extract(session, 'DOMDocument.xml')).toEqual(bytes)
    await session.dispose()
  })

  it('keeps legacy binary FLA honest as metadata and raw bytes only', async () => {
    const session = await open(new Uint8Array([0x46, 0x4c, 0x41, 0x00, 0x01]))
    expect(await inspect(session)).toMatchObject({
      format: 'fla',
      container: 'opaque',
      entries: 0,
      extractable: false,
    })
    await expect(session.dataSource('common.view/namespace-entry-source', 1)).rejects.toThrow()
    await session.dispose()
  })

  it('rejects a ZIP without DOMDocument.xml and enforces entry budgets', async () => {
    const bytes = new Uint8Array(await readFile(join(fixtures, 'minimal.fla')))
    const missingRoot = bytes.slice()
    const central = Buffer.from(missingRoot).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    missingRoot[central + 46] = 0x58
    await expect(open(missingRoot)).rejects.toThrow(/DOMDocument/u)
    await expect(open(bytes, { ...budget, maxNodes: 1 })).rejects.toThrow(/maxNodes/u)
  })
})
