/**
 * Block 11 slice 11A — plain text in its final home, `extensions/common/data/plain-text`.
 *
 * The MK2 route decoded strict UTF-8 and rejected everything else. The relocated codec keeps the
 * contribution identity `org.modkitx/txt`, stays read-only, and proves the three things the plan
 * asks of it: a bounded UTF-8/UTF-16 decode whose byte-order mark is provenance rather than
 * content, binary rejection with a named reason, and a text source published only where its line
 * index is actually true. Editing is the separate writer contribution — proven in
 * `packages/host/test/text-writers.test.ts`, never here.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  createSpecSchemaRegistry,
  revisionId,
  validateContributionManifest,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionManifestV1Wire,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const extensionRoot = join(repoRoot, 'extensions', 'common', 'data', 'plain-text')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 16,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

function byteSource(bytes: Uint8Array, uri: string): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:common-plain-text'),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('cancelled')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: 'common-plain-text',
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function codec(): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(extensionRoot, 'src', 'txt', 'codec.js')).href
  )) as { createCodec(): Codec }
  return module.createCodec()
}

async function probe(bytes: Uint8Array, uri = 'memory://plain-text/sample.txt') {
  return (await codec()).probe({
    source: byteSource(bytes, uri),
    plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
  })
}

async function open(bytes: Uint8Array, uri = 'memory://plain-text/sample.txt') {
  return (await codec()).open(inputFor(byteSource(bytes, uri)), 'inspect', budget)
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const utf16 = (text: string, endian: 'le' | 'be'): Uint8Array => {
  const body = new Uint8Array(text.length * 2)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    body[index * 2] = endian === 'le' ? code & 0xff : code >> 8
    body[index * 2 + 1] = endian === 'le' ? code >> 8 : code & 0xff
  }
  const bom = endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]
  return new Uint8Array([...bom, ...body])
}

describe('11A common/plain-text', () => {
  it('validates its contributions and keeps the codec read-only with the writer beside it', async () => {
    const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)
    for (const file of ['codec-txt.json', 'writer-plain-text.json']) {
      const manifest = JSON.parse(
        await readFile(join(extensionRoot, 'contributions', file), 'utf8'),
      ) as ContributionManifestV1Wire
      const result = await validateContributionManifest(manifest, registry)
      expect(result.specState, `${file}: ${JSON.stringify(result.diagnostics)}`).toBe('validated')
    }

    const codecManifest = JSON.parse(
      await readFile(join(extensionRoot, 'contributions', 'codec-txt.json'), 'utf8'),
    ) as ContributionManifestV1Wire & {
      spec: { operations: readonly { id: string; mutatesSource: boolean }[] }
    }
    expect(codecManifest.id).toBe('org.modkitx/txt')
    expect(codecManifest.spec.operations.map(operation => operation.id).toSorted()).toEqual([
      'asset.search',
      'asset.validate',
      'export.raw',
      'view.inspect',
    ])
    expect(codecManifest.spec.operations.some(operation => operation.mutatesSource)).toBe(false)
  })

  it('reads UTF-8, UTF-8 with a mark, and UTF-16 in both byte orders as the same document', async () => {
    const text = 'First paragraph.\r\nStill first.\r\n\r\nSecond paragraph.\r\n'
    const samples = [
      ['utf-8', utf8(text), false],
      ['utf-8', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]), true],
      ['utf-16le', utf16(text, 'le'), true],
      ['utf-16be', utf16(text, 'be'), true],
    ] as const

    for (const [encoding, bytes, bom] of samples) {
      expect((await probe(bytes)).confidence, encoding).toBeGreaterThan(0.8)
      const session = await open(bytes)
      const trait = (await session.descriptor()).traits.find(item => item.id === 'content.text')
      expect(trait?.parameters, encoding).toMatchObject({ encoding, bom, newline: 'crlf' })
      const inspected = await session.operations().invoke('inspect', null)
      expect(inspected.state).toBe('ok')
      if (inspected.state === 'ok' && inspected.output.kind === 'json') {
        // The mark never becomes content: every encoding reports the same shape.
        expect(inspected.output.value).toMatchObject({
          format: 'txt',
          encoding,
          bom,
          lines: 5,
          words: 6,
          paragraphs: 2,
        })
      }
      await session.dispose()
    }
  })

  it('publishes the lazy text source only where its line index is true', async () => {
    const eight = await open(utf8('alpha\nbeta\n'))
    const eightContracts = (await eight.descriptor()).dataSources.map(source => source.contract)
    expect(eightContracts).toContain('common.view/text-data-source')
    expect(eightContracts).toContain('common.view/tree-data-source')
    expect(eightContracts).toContain('common.view/byte-range-source')
    await eight.dispose()

    const sixteen = await open(utf16('alpha\nbeta\n', 'le'))
    const sixteenContracts = (await sixteen.descriptor()).dataSources.map(source => source.contract)
    expect(sixteenContracts).not.toContain('common.view/text-data-source')
    expect(sixteenContracts).toContain('common.view/tree-data-source')
    await expect(sixteen.dataSource('common.view/text-data-source', 1)).rejects.toThrow(
      /does not publish/u,
    )
    // the outline is still real, so a UTF-16 note is a document, not a refusal
    const lease = await sixteen.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const root = await tree.root()
    expect(await tree.facts(root)).toMatchObject({ kind: 'document', label: 'Plain text' })
    const children = await tree.children(root, { limit: 8 })
    expect(children.items.length).toBe(1)
    await lease.release()
    await sixteen.dispose()
  })

  it('refuses binary with a named reason instead of returning replacement characters', async () => {
    const cases = [
      ['nul-byte', new Uint8Array([0x68, 0x69, 0x00, 0x68, 0x69])],
      ['undecodable', new Uint8Array([0xc3, 0x28, 0xa0, 0xa1])],
      [
        'control-ratio',
        new Uint8Array(Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0x41 : 0x07))),
      ],
    ] as const
    for (const [reason, bytes] of cases) {
      const detected = await probe(bytes)
      expect(detected.confidence, reason).toBeLessThan(0.1)
      expect(detected.evidence[0]?.note, reason).toBe(reason)
      await expect(open(bytes)).rejects.toThrow(/rejected a binary source/u)
    }
  })

  it('yields a .txt that a game owns instead of racing a codec with format evidence', async () => {
    const bytes = utf8('Cmd/Name=Attack\r\n')
    const owned = [
      'memory://plain-text/Mods/Core.SC2Mod/enUS.SC2Assets/LocalizedData/GameStrings.txt',
      'file:///games/Campaigns/Liberty.SC2Campaign/Base.SC2Data/notes.txt',
    ]
    for (const uri of owned) {
      const detected = await probe(bytes, uri)
      expect(detected.confidence, uri).toBeLessThanOrEqual(0.05)
      expect(detected.evidence[0]?.note, uri).toBe('owned-game-namespace')
    }
    // outside a game namespace the same bytes are ordinary plain text
    expect((await probe(bytes, 'memory://plain-text/notes.txt')).confidence).toBeGreaterThan(0.8)
    // and a .txt without the extension evidence is plausible, not confident
    expect((await probe(bytes, 'memory://plain-text/notes')).confidence).toBeLessThan(0.8)
  })

  it('inspects, validates, searches and exports the parity fixture byte-for-byte', async () => {
    const bytes = new Uint8Array(await readFile(join(fixtureRoot, 'minimal.txt')))
    const session = await open(bytes)
    const operations = session.operations()

    await expect(operations.invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: { kind: 'json', value: { format: 'txt', characters: 53, lines: 5, paragraphs: 2 } },
    })
    await expect(operations.invoke('validate', null)).resolves.toMatchObject({ state: 'ok' })

    const found = await operations.invoke('search', { pattern: 'paragraph' })
    expect(found.state).toBe('ok')
    if (found.state === 'ok' && found.output.kind === 'json') {
      expect((found.output.value as readonly unknown[]).length).toBe(2)
    }

    const exported = await operations.invoke('export-raw', null)
    expect(exported.state).toBe('ok')
    if (exported.state === 'ok' && exported.output.kind === 'bytes') {
      expect(Array.from(exported.output.value)).toEqual(Array.from(bytes))
    }
    await session.dispose()
  })
})
