import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type ByteRangeSource,
  type Codec,
  type NamespaceEntrySource,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'ea', 'big')
const fixturePath = join(import.meta.dirname, 'fixtures', 'mk2-synthetic', 'minimal.big')
const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 1000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

function source(bytes: Uint8Array): ArtifactByteSource {
  const uri = 'memory://ea-big/minimal.big'
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:ea-big-fixture'),
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

async function codec(): Promise<Codec> {
  const module = (await import(pathToFileURL(join(extension, 'src', 'big', 'codec.js')).href)) as {
    createCodec(): Codec
  }
  return module.createCodec()
}

async function open(bytes: Uint8Array, resourceBudget = budget) {
  return (await codec()).open(input(source(bytes)), 'inspect', resourceBudget)
}

async function fixture(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath))
}

describe('ported EA BIG archive codec', () => {
  it('lists stable entry facts and extracts stored and RefPack payloads byte-exactly', async () => {
    const bytes = await fixture()
    const session = await open(bytes)
    expect(await session.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: { kind: 'json', value: { format: 'big', entries: 2, compressed: 1 } },
    })

    const namespaceLease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = namespaceLease.value as NamespaceEntrySource
    const page = await namespace.list('', { limit: 10 })
    expect(
      page.items.map(entry => [
        entry.id,
        entry.path,
        entry.size,
        entry.storedSize,
        entry.compression,
      ]),
    ).toEqual([
      ['0', 'hello.txt', 5n, 12n, 'refpack'],
      ['1', 'raw.bin', 3n, 3n, 'stored'],
    ])
    const opened = await namespace.openEntry('0')
    expect(opened.value).toMatchObject({
      uri: expect.stringMatching(/^big-entry:/u),
      parentIds: ['memory://ea-big/minimal.big'],
    })
    await opened.release()
    await namespaceLease.release()

    const compressed = await session.operations().invoke('extract-entry', { entryId: '0' })
    if (compressed.state !== 'ok' || compressed.output.kind !== 'bytes')
      throw new Error('RefPack extraction failed')
    expect(new TextDecoder().decode(compressed.output.value)).toBe('hello')
    const stored = await session.operations().invoke('extract-entry', { entryId: '1' })
    if (stored.state !== 'ok' || stored.output.kind !== 'bytes')
      throw new Error('stored extraction failed')
    expect(Array.from(stored.output.value)).toEqual([1, 2, 3])

    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    const treeRoot = await tree.root()
    expect(await tree.facts(treeRoot)).toMatchObject({ kind: 'archive', label: 'BIG4' })
    expect(
      await Promise.all(
        (await tree.children(treeRoot, { limit: 10 })).items.map(node => tree.facts(node)),
      ),
    ).toMatchObject([
      { kind: 'file', label: 'hello.txt', preview: '5 bytes, 12 stored, RefPack' },
      { kind: 'file', label: 'raw.bin', preview: '3 bytes, 3 stored' },
    ])
    await treeLease.release()

    const byteLease = await session.dataSource('common.view/byte-range-source', 1)
    const byteSource = byteLease.value as ByteRangeSource
    expect(await byteSource.size()).toBe(BigInt(bytes.byteLength))
    expect(new TextDecoder().decode(await byteSource.read(0n, 4))).toBe('BIG4')
    await byteLease.release()
    await session.dispose()
  })

  it('rejects corrupt tables and enforces node and expanded-entry budgets', async () => {
    const bytes = await fixture()
    await expect(open(bytes, { ...budget, maxNodes: 1 })).rejects.toThrow(/node budget/u)

    const corrupt = bytes.slice()
    new DataView(corrupt.buffer).setUint32(20, 0xffff_ffff, false)
    await expect(open(corrupt)).rejects.toThrow(/outside the archive/u)

    const bounded = await open(bytes, { ...budget, maxScalarBytes: 4 })
    await expect(bounded.operations().invoke('extract-entry', { entryId: '0' })).rejects.toThrow(
      /scalar budget/u,
    )
    await bounded.dispose()
  })
})
