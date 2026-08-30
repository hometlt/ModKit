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
  type ContributionContext,
  type NamespaceEntrySource,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const codecPath = join(repoRoot, 'extensions', 'ps1', 'src', 'ps1-cue-bin', 'codec.js')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const ISO_DESCRIPTOR_START = 16 * 2048

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('CUE/BIN has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('CUE/BIN has no foreign service dependency')
    },
  },
}

function byteSource(name: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://mk2-cue-bin/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${name}-${bytes.byteLength}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function bundleInput(cue: ArtifactByteSource, bin?: ArtifactByteSource): AssetInput {
  const candidate = {
    sourceKind: 'candidate' as const,
    bindingId: 'cue-sheet',
    role: 'cue-sheet',
    ownership: 'owned' as const,
    source: cue.ref,
    revision: cue.revision,
  }
  const companion =
    bin === undefined
      ? undefined
      : {
          sourceKind: 'requirement' as const,
          bindingId: 'disc-payload',
          requirementId: 'disc-payload',
          role: 'disc-payload',
          ownership: 'companion' as const,
          source: bin.ref,
          revision: bin.revision,
        }
  const bindings = companion === undefined ? [candidate] : [candidate, companion]
  return {
    originKind: 'bundle',
    bindings,
    primaryBindingId: candidate.bindingId,
    revisions: {
      topology: 'bundle',
      revision: cue.revision,
      bindings: bindings.map(binding => ({
        bindingId: binding.bindingId,
        revision: binding.revision,
      })),
      compositionFingerprint: `cue-bin:${cue.revision}:${bin?.revision ?? 'missing'}`,
    },
    bindingsFor(requirementId: string) {
      return companion !== undefined && requirementId === companion.requirementId ? [companion] : []
    },
    async openBinding(bindingId: string) {
      const source =
        bindingId === candidate.bindingId
          ? cue
          : bindingId === companion?.bindingId
            ? bin
            : undefined
      if (source === undefined) throw new TypeError(`unknown binding ${bindingId}`)
      return { value: source, release: async () => undefined }
    },
  } as unknown as AssetInput
}

async function codec(): Promise<Codec> {
  const module = (await import(pathToFileURL(codecPath).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function fixtures() {
  const [cue, bin] = await Promise.all([
    readFile(join(fixtureRoot, 'minimal.cue')),
    readFile(join(fixtureRoot, 'minimal.bin')),
  ])
  return { cue: new Uint8Array(cue), bin: new Uint8Array(bin) }
}

async function open(cueBytes: Uint8Array, binBytes: Uint8Array, resourceBudget = budget) {
  const implementation = await codec()
  return implementation.open(
    bundleInput(byteSource('minimal.cue', cueBytes), byteSource('minimal.bin', binBytes)),
    'full',
    resourceBudget,
  )
}

describe('ported MK2 PlayStation CUE/BIN codec', () => {
  it('detects CUE grammar and plans the exact host-resolved BIN companion', async () => {
    const { cue } = await fixtures()
    const implementation = await codec()
    const source = byteSource('minimal.cue', cue)
    const detection = await implementation.probe({
      source,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 4096 }], maxBytes: 4096 },
    })
    expect(detection.confidence).toBeGreaterThanOrEqual(0.9)
    const plan = await implementation.planInput?.(source, detection)
    expect(plan).toEqual(
      expect.objectContaining({
        originKind: 'bundle',
        candidate: expect.objectContaining({ bindingId: 'cue-sheet' }),
        requirements: [
          expect.objectContaining({
            id: 'disc-payload',
            patterns: ['minimal.bin'],
            cardinality: 'one',
            required: true,
          }),
        ],
      }),
    )
  })

  it('opens every data source and extracts raw, cooked, and ISO filesystem entries', async () => {
    const { cue, bin } = await fixtures()
    const session = await open(cue, bin)
    const descriptor = await session.descriptor()
    expect(descriptor.origin.kind).toBe('bundle')
    expect(descriptor.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'container.entries' }),
        expect.objectContaining({ id: 'content.binary' }),
      ]),
    )

    const byteRange = await session.dataSource('common.view/byte-range-source', 1)
    expect(await (byteRange.value as ByteRangeSource).size()).toBe(BigInt(bin.byteLength))
    expect(await (byteRange.value as ByteRangeSource).read(0n, 16)).toEqual(bin.slice(0, 16))

    const tree = await session.dataSource('common.view/tree-data-source', 1)
    const root = await (tree.value as TreeDataSource).root()
    expect((await (tree.value as TreeDataSource).facts(root)).label).toContain('MODKITX')

    const namespace = await session.dataSource('common.view/namespace-entry-source', 1)
    const page = await (namespace.value as NamespaceEntrySource).list('', { limit: 20 })
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'track-01-raw', path: 'tracks/track01.raw' }),
        expect.objectContaining({ id: 'track-01-cooked', path: 'tracks/track01.iso' }),
        expect.objectContaining({ id: 'track-01-iso-0', path: 'filesystem/HELLO.TXT' }),
      ]),
    )
    const extraction = await session
      .operations()
      .invoke('extract-entry', { entryId: 'track-01-iso-0' })
    if (extraction.state !== 'ok' || extraction.output.kind !== 'bytes') {
      throw new Error('CUE/BIN ISO extraction did not return bytes')
    }
    expect(new TextDecoder().decode(extraction.output.value)).toBe('hello\n')
    await Promise.all([byteRange.release(), tree.release(), namespace.release()])
    await session.dispose()
  })

  it('rejects corrupt data, unresolved companions, unsafe paths, and exhausted budgets', async () => {
    const { cue, bin } = await fixtures()
    const corrupted = bin.slice()
    corrupted[ISO_DESCRIPTOR_START + 1] = 0
    await expect(open(cue, corrupted)).rejects.toThrow(/ISO 9660 descriptor/u)

    const implementation = await codec()
    await expect(
      implementation.open(bundleInput(byteSource('minimal.cue', cue)), 'full', budget),
    ).rejects.toThrow(/exactly one resolved BIN companion/u)

    const unsafeCue = new TextEncoder().encode(
      'FILE "../minimal.bin" BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00\n',
    )
    const unsafeSource = byteSource('unsafe.cue', unsafeCue)
    const evidence = await implementation.probe({
      source: unsafeSource,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 4096 }], maxBytes: 4096 },
    })
    await expect(implementation.planInput?.(unsafeSource, evidence)).rejects.toThrow(/unsafe/u)

    await expect(open(cue, bin, { ...budget, maxNodes: 1 })).rejects.toThrow(/maxNodes/u)
    await expect(open(cue, bin, { ...budget, maxScalarBytes: bin.byteLength - 1 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
  })
})
