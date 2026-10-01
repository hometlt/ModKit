import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkit/core'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  bindingId,
  createSpecSchemaRegistry,
  presentationSlotId,
  revisionId,
  validateContributionManifest,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionManifestV1Wire,
  type ResolvedBinding,
} from '@modkit/sdk'
import { resolvePresentationPlan } from '@modkit/host'
import { assertAuthoringPackable } from '@modkit/sdk/authoring'
import {
  addInterpretation,
  createRootSubjectState,
  removeInterpretation,
  rootSubject,
  selectInterpretation,
} from '@modkit/sdk/subjects'

const here = dirname(fileURLToPath(import.meta.url))
const extensionRoot = join(here, '..', '..', '..', 'examples', 'modkit-extension-plain-text')
const manifestPath = join(extensionRoot, 'contributions', 'codec-plain-text.json')

interface PlainTextModule {
  createCodec(): Codec
}

async function extensionModule(): Promise<PlainTextModule> {
  return import(
    pathToFileURL(join(extensionRoot, 'src', 'entrypoint.js')).href
  ) as Promise<PlainTextModule>
}

function byteSource(bytes: Uint8Array, uri: string) {
  let largestRead = 0
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:plain-1'),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('aborted')
      largestRead = Math.max(largestRead, length)
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes.slice()
    },
  }
  return { source, largestRead: () => largestRead }
}

function inputFor(source: ArtifactByteSource, onRelease: () => void): AssetInput {
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
      bindings: [{ bindingId: binding.bindingId, revision: binding.revision }],
      compositionFingerprint: 'plain-text-fixture',
    },
    bindingsFor: () => [],
    async openBinding() {
      let released = false
      return {
        value: source,
        async release() {
          if (released) return
          released = true
          onRelease()
        },
      }
    },
  }
}

describe('A-7 external common/plain-text vertical slice', () => {
  it('validates the executable manifest, standard traits, operation namespaces, and read-only v1', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ContributionManifestV1Wire
    const result = await validateContributionManifest(
      manifest,
      createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES),
    )
    expect(result.specState, JSON.stringify(result.diagnostics)).toBe('validated')
    const spec = manifest.spec as {
      operations: { id: string; mutatesSource: boolean }[]
      traitDeclarations: { id: string }[]
    }
    expect(spec.operations.map(item => item.id)).toEqual([
      'view.inspect',
      'asset.validate',
      'asset.search',
      'export.raw',
    ])
    expect(spec.operations.every(item => item.mutatesSource === false)).toBe(true)
    expect(spec.traitDeclarations.map(item => item.id)).toEqual([
      'content.text',
      'content.binary',
      'content.metadata',
    ])

    const injected = {
      ...manifest,
      spec: {
        ...(manifest.spec as object),
        operations: [{ id: 'text.parse', handlerId: 'bad', mutatesSource: false }],
      },
    }
    expect(
      (
        await validateContributionManifest(
          injected,
          createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES),
        )
      ).specState,
    ).toBe('invalid')
  })

  it('bounds detection and lets negative structure outweigh a misleading extension', async () => {
    const { createCodec } = await extensionModule()
    const { sampleLooksText } = (await import(
      pathToFileURL(join(extensionRoot, 'src', 'shared', 'probe.js')).href
    )) as {
      sampleLooksText(bytes: Uint8Array): { readonly text: boolean; readonly reason: string }
    }
    const codec = createCodec()
    const plan = {
      kind: 'bytes' as const,
      ranges: [{ from: 'start' as const, length: 4096 }],
      maxBytes: 4096,
    }
    const cases = [
      ['memory://fixtures/readme.txt', new TextEncoder().encode('hello\nworld\n')],
      ['memory://fixtures/readme', new TextEncoder().encode('renamed strict utf-8 text\n')],
      ['memory://fixtures/fake.txt', new Uint8Array([0x41, 0, 0x42])],
      ['memory://fixtures/malformed.txt', new Uint8Array([0xc3, 0x28])],
    ] as const
    const results = []
    for (const [uri, bytes] of cases) {
      const observed = byteSource(bytes, uri)
      results.push(await codec.probe({ source: observed.source, plan }))
      expect(observed.largestRead()).toBeLessThanOrEqual(plan.maxBytes)
    }
    expect(results[0]?.confidence).toBeGreaterThan(0.9)
    expect(results[1]?.confidence).toBeGreaterThan(0.85)
    expect(results[2]?.confidence).toBeLessThan(0.1)
    expect(results[3]?.confidence).toBeLessThan(0.1)
    expect(sampleLooksText(new Uint8Array([0x41, 0, 0x42]))).toMatchObject({
      text: false,
      reason: 'nul-byte',
    })
  })

  it('preserves root identity across install, selection, and degraded removal', () => {
    const ref = rootSubject({ id: 'memory://fixtures/hello.txt' })
    const unknown = createRootSubjectState(ref)
    const installed = addInterpretation(unknown, {
      id: 'modkit/plain-text',
      displayName: 'Plain text',
    })
    const selected = selectInterpretation(installed, 'modkit/plain-text')
    const degraded = removeInterpretation(selected, 'modkit/plain-text')
    expect(unknown.interpretations).toEqual([])
    expect(selected.selected).toBe('modkit/plain-text')
    expect(degraded).toMatchObject({ ref, interpretations: [] })
    expect(degraded.selected).toBeUndefined()
    expect(installed.ref).toBe(ref)
    expect(degraded.ref).toBe(ref)
  })

  it('opens a stable subject, publishes lazy text/bytes, invokes operations, and disposes once', async () => {
    const { createCodec } = await extensionModule()
    const codec = createCodec()
    const bytes = new TextEncoder().encode('Hello Modkit\nSecond line\n')
    const observed = byteSource(bytes, 'memory://fixtures/hello.txt')
    let releases = 0
    const input = inputFor(observed.source, () => {
      releases += 1
    })
    const session = await codec.open(input, 'inspect', {
      maxInputBytes: 1_000_000n,
      maxDepth: 4,
      maxNodes: 1000,
      maxScalarBytes: 1_000_000,
      maxDiagnostics: 100,
    })
    const descriptor = await session.descriptor()
    expect(descriptor).toMatchObject({
      subjectUri: 'memory://fixtures/hello.txt',
      interpretation: 'codec',
      identity: { codecId: 'modkit/plain-text' },
      traits: [{ id: 'content.text' }, { id: 'content.binary' }, { id: 'content.metadata' }],
      dataSources: [
        { contract: 'common.view/text-data-source', major: 1 },
        { contract: 'common.view/byte-range-source', major: 1 },
        { contract: 'common.view/subject-facts-source', major: 1 },
      ],
      // the host's fallback facts, named as its own (963f39a8)
      hostDataSources: [{ contract: 'common.view/subject-facts-source', major: 1 }],
    })
    const textLease = await session.dataSource('common.view/text-data-source', 1)
    const page = await textLease.value.slice({
      kind: 'from-line',
      line: 0,
      lineCount: 1,
      maxBytes: 100,
    })
    expect(page.text).toBe('Hello Modkit\n')
    await textLease.release()
    expect(await session.operations().invoke('search', { pattern: 'Second' })).toMatchObject({
      state: 'ok',
      output: { kind: 'json', value: [{ byteOffset: '13', byteLength: '6' }] },
    })
    const exported = await session.operations().invoke('export-raw', null)
    expect(exported).toMatchObject({ state: 'ok', output: { kind: 'bytes' } })
    await session.dispose()
    await session.dispose()
    expect(releases).toBe(1)
  })

  it('gives a synthetic content.text codec the same catalog stages without viewer changes', async () => {
    const { createCodec } = await extensionModule()
    const bytes = new TextEncoder().encode('same traits\n')
    const observed = byteSource(bytes, 'memory://fixtures/same.txt')
    const session = await createCodec().open(
      inputFor(observed.source, () => undefined),
      'inspect',
      {
        maxInputBytes: 1000n,
        maxDepth: 1,
        maxNodes: 10,
        maxScalarBytes: 1000,
        maxDiagnostics: 10,
      },
    )
    const plainDescriptor = await session.descriptor()
    const syntheticDescriptor = Object.freeze({
      ...plainDescriptor,
      identity:
        plainDescriptor.interpretation === 'codec'
          ? { ...plainDescriptor.identity, codecId: 'org.example/synthetic-text' }
          : undefined,
    }) as typeof plainDescriptor
    const textBinding = {
      bindingId: bindingId('text'),
      contract: 'common.view/text-data-source' as const,
      major: 1 as const,
    }
    const catalog = [
      {
        slotId: presentationSlotId('text-stage'),
        kind: 'stage' as const,
        contributionId: 'modkit/text-stage',
        extensionId: 'modkit/platform-viewers',
        priority: 100,
        singletonGroup: 'primary',
        bindings: [textBinding],
        eligible: true,
      },
    ]
    const resolve = (descriptor: typeof plainDescriptor) =>
      resolvePresentationPlan<{ bindingId: string }>({
        descriptor,
        candidates: catalog,
        digest: plan => canonicalJsonStringify(plan),
        ticketMatches: binding => binding.ticket.bindingId === binding.bindingId,
        async resolveBinding(binding) {
          return {
            ...binding,
            offerId: 'text',
            providerId: 'modkit/text-source',
            variantId: 'portable',
            ticket: { bindingId: binding.bindingId },
          } as ResolvedBinding<{ bindingId: string }>
        },
      })
    const [plainPlan, syntheticPlan] = await Promise.all([
      resolve(plainDescriptor),
      resolve(syntheticDescriptor),
    ])
    expect(syntheticPlan.plan.slots).toEqual(plainPlan.plan.slots)
    await session.dispose()
  })

  it('is browser-safe and does not pull implementation code into core/sdk/host', async () => {
    for (const file of [
      'src/index.js',
      'src/entrypoint.js',
      'src/codec.js',
      'src/shared/probe.js',
      'src/shared/decode.js',
    ]) {
      expect(await readFile(join(extensionRoot, file), 'utf8'), file).not.toMatch(/node:/)
    }
    expect(await readFile(join(extensionRoot, 'src', 'index.js'), 'utf8')).not.toMatch(
      /\.\/codec\.js/,
    )
  })

  it('has passing smoke evidence for every declared environment', async () => {
    const { plainTextDefinition } = (await import(
      pathToFileURL(join(extensionRoot, 'src', 'authoring.js')).href
    )) as {
      plainTextDefinition: Parameters<typeof assertAuthoringPackable>[0]
    }
    expect(() =>
      assertAuthoringPackable(plainTextDefinition, [
        { variantId: 'browser-main', environment: 'browser-main', state: 'passed' },
        { variantId: 'browser-worker', environment: 'browser-worker', state: 'passed' },
        { variantId: 'node', environment: 'node', state: 'passed' },
        { variantId: 'node-worker', environment: 'node-worker', state: 'passed' },
      ]),
    ).not.toThrow()
  })
})
