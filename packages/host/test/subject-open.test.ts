import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify, ModkitError, traitId } from '@modkit/core'
import {
  buildInventory,
  artifactNamespaceSourceFromVfsMount,
  createHostContributionContractRegistry,
  createExecutionBackendRegistry,
  createServiceContractDefinitionRegistry,
  createServiceFacetMatcherProfileRegistry,
  evaluateViewerContribution,
  linkedInProcessBackend,
  NATIVE_TEXT_INPUT,
  NATIVE_TEXT_MODULES,
  offersFromInventory,
  openSubject,
  parseCodecDetectionSelection,
  parsePolicyLock,
  replayCodecDetectionSelection,
  registerServiceContractDefinitionsFromInventory,
  replayPolicyLock,
  resolvePresentationPlan,
} from '@modkit/host'
import { VirtualFileSystem, type VfsMount } from '@modkit/vfs'
import { createFileVfsProvider } from '@modkit/vfs/providers/file'
import { loadExtensionDirectory } from '@modkit/host/node'
import {
  bindingId,
  presentationSlotId,
  revisionId,
  type ArtifactByteSource,
  type PresentationPlan,
  type RasterImageSource,
  type ResolvedBinding,
  type ResourceBudget,
} from '@modkit/sdk'

declare global {
  /** Bumped by the empty-match fixture entry point; proves it was never imported. */
  var __x3EmptyMatchImports: number | undefined
  /** Written by the grants fixture: counts createCodec calls (probe + open activations, R5). */
  var __x3GrantsFixture: { createCodecCalls: number } | undefined
}

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const imagesDir = join(repoRoot, 'extensions', 'images')
const archivesDir = join(repoRoot, 'extensions', 'archives')
const modelsDir = join(repoRoot, 'extensions', 'models')
const hostileProbeDir = join(import.meta.dirname, 'fixtures', 'subject-open-extension')
const grantsProbeDir = join(import.meta.dirname, 'fixtures', 'subject-open-grants-extension')
const ambiguousProbeDir = join(import.meta.dirname, 'fixtures', 'subject-open-ambiguous-extension')
const namespaceProbeDir = join(import.meta.dirname, 'fixtures', 'subject-open-namespace-extension')
const pngFixture = join(repoRoot, 'apps', 'web', 'public', 'favicon-32.png')
const uvmFixture = join(
  repoRoot,
  'packages',
  'testkit',
  'test',
  'fixtures',
  'uvm',
  'm3-native-triangle.uvm.glb.b64',
)

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

function byteSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://subject-open/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${name}-1`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream(range, signal) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      const start = Number(range?.offset ?? 0n)
      const end = range?.length === undefined ? bytes.byteLength : start + Number(range.length)
      yield bytes.slice(start, end)
    },
  }
}

function minimalJpeg(): Uint8Array {
  const frame = new Uint8Array([8, 0, 3, 0, 2, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0])
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, ...frame, 0xff, 0xd9])
}

async function bundledInventory(directory: string) {
  const input = await loadExtensionDirectory(directory)
  return buildInventory(
    [
      {
        ...input,
        execution: { origin: 'bundled', allowTrustedInProcess: true },
      },
    ],
    createHostContributionContractRegistry(),
  )
}

function countingTrustedBackends() {
  let releases = 0
  return {
    registry: createExecutionBackendRegistry([
      {
        profile: 'trusted-in-process',
        supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
        async activate(context) {
          return {
            module: (await import(context.entrypoint.href)) as Record<string, unknown>,
            async release() {
              releases += 1
            },
          }
        },
      },
    ]),
    releases: () => releases,
  }
}

describe('host-owned subject opening pipeline', () => {
  it('matches a case-insensitive **/ glob at the subject root', async () => {
    const result = await openSubject({
      inventory: await bundledInventory(grantsProbeDir),
      source: byteSource(new TextEncoder().encode('GRANTS'), 'GrantsRoot'),
      path: 'GrantsRoot',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-root-glob', classes: ['read-source', 'write-source'] },
      executionBackends: countingTrustedBackends().registry,
      budget,
    })

    expect(result.state).toBe('opened')
    if (result.state === 'opened') {
      expect(result.selected.contributionId).toBe('org.example/grants-codec')
      await result.session.dispose()
    }
  })

  it('selects a portable variant only when its execution backend is present', async () => {
    const inventory = await bundledInventory(imagesDir)
    const bytes = new Uint8Array(await readFile(pngFixture))
    const source = byteSource(bytes, 'favicon-32.png')
    const request = {
      inventory,
      source,
      path: 'favicon-32.png',
      intent: 'full' as const,
      target: {
        environment: 'node-worker' as const,
        operatingSystem: 'windows' as const,
        architecture: 'x64' as const,
      },
      grant: { id: 'subject-open-portable-png', classes: ['read-source'] as const },
      budget,
    }

    const unavailable = await openSubject(request)
    expect(unavailable.state).toBe('unresolved')
    expect(unavailable.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributionId: 'modkit/image-png',
          variantId: 'portable',
          state: 'rejected',
          diagnostics: [expect.objectContaining({ code: 'x3.host/codec-execution-unavailable' })],
        }),
      ]),
    )

    let releases = 0
    const workerBackends = createExecutionBackendRegistry([
      {
        profile: 'worker-brokered',
        supports: (target, variant) =>
          target.environment === 'node-worker' && variant.executionProfile === 'worker-brokered',
        async activate(context) {
          return {
            module: (await import(context.entrypoint.href)) as Record<string, unknown>,
            async release() {
              releases += 1
            },
          }
        },
      },
    ])
    const opened = await openSubject({ ...request, executionBackends: workerBackends })
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error('portable PNG backend did not open')
    expect(opened.ticket.variantId).toBe('portable')
    expect(opened.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'x3.host/full-process-authority' })]),
    )
    await opened.session.dispose()
    expect(releases).toBe(1)
  })

  it('opens PNG through the real image inventory and resolves a bounded raster presentation', async () => {
    const inventory = await bundledInventory(imagesDir)
    const execution = countingTrustedBackends()
    const bytes = new Uint8Array(await readFile(pngFixture))
    const base = byteSource(bytes, 'favicon-32.png')
    const reads: { readonly offset: bigint; readonly length: number }[] = []
    const source: ArtifactByteSource = {
      ...base,
      async read(offset, length, signal) {
        reads.push({ offset, length })
        return base.read(offset, length, signal)
      },
    }
    const result = await openSubject({
      inventory,
      source,
      path: 'favicon-32.png',
      mediaType: 'image/png',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-png', classes: ['read-source'] },
      executionBackends: execution.registry,
      budget,
    })

    if (result.state !== 'opened') {
      throw new TypeError(`unexpected ${result.reason}: ${JSON.stringify(result)}`)
    }
    expect(result.selected).toEqual({
      extensionId: 'modkit/images',
      contributionId: 'modkit/image-png',
      variantId: 'trusted-node',
      offerId: 'raster-metadata',
      confidence: 0.999,
    })
    expect(parsePolicyLock(result.lockText).entries).toEqual([])
    const detectionSelection = parseCodecDetectionSelection(result.detectionSelectionText)
    expect(detectionSelection).toMatchObject({
      schemaVersion: 1,
      sourceRevision: source.revision,
      selected: {
        extensionId: 'modkit/images',
        contributionId: 'modkit/image-png',
        variantId: 'trusted-node',
        offerId: 'raster-metadata',
        sourceTopology: 'single',
        confidence: 0.999,
        evidence: [expect.objectContaining({ kind: 'magic' })],
      },
    })
    expect(
      replayCodecDetectionSelection(inventory, source.revision, result.detectionSelectionText),
    ).toEqual(detectionSelection)
    expect(() =>
      replayCodecDetectionSelection(
        inventory,
        revisionId('content-hash.sha256:different-source'),
        result.detectionSelectionText,
      ),
    ).toThrow(/different source revision/u)
    expect(result.descriptor).toMatchObject({
      schemaVersion: 2,
      interpretation: 'codec',
      subjectUri: source.ref.uri,
      revision: source.revision,
      identity: { codecId: 'modkit/image-png', formatId: 'png' },
      traits: expect.arrayContaining([
        expect.objectContaining({ id: 'image.raster', state: 'available' }),
      ]),
      dataSources: expect.arrayContaining([
        expect.objectContaining({ contract: 'common.view/raster-image-source', major: 1 }),
      ]),
    })
    // The complete image inventory needs one bounded 12-byte head window and one bounded 18-byte
    // tail window. Detection then stays inside PNG's declared 32-byte probe before the selected
    // codec performs its separately budgeted full-input read.
    expect(reads).toEqual([
      { offset: 0n, length: 12 },
      { offset: BigInt(bytes.byteLength - 18), length: 18 },
      { offset: 0n, length: 32 },
      { offset: 0n, length: bytes.byteLength },
    ])

    const rasterLease = await result.session.dataSource('common.view/raster-image-source', 1)
    const raster = rasterLease.value as RasterImageSource
    expect(await raster.info()).toMatchObject({
      width: 32,
      height: 32,
      frames: 1,
      decodedAccess: true,
    })
    const encoded = await raster.encoded()
    expect(await encoded.read(0n, 8)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    const readRegion = raster.readRegion
    if (readRegion === undefined) throw new TypeError('PNG must expose bounded decoded regions')
    await expect(
      readRegion({ x: 0, y: 0, width: 1, height: 1, pixelFormat: 'rgba8', maxBytes: 3 }),
    ).rejects.toThrow(/maxBytes/u)

    const imageBinding = {
      bindingId: bindingId('image-content'),
      contract: 'common.view/raster-image-source' as const,
      major: 1 as const,
    }
    const imageSpec = {
      kind: 'stage' as const,
      requiresTraits: [{ id: traitId('image.raster'), states: ['available' as const] }],
      consumesDataSources: [{ contract: imageBinding.contract, major: imageBinding.major }],
      priority: 360,
      singletonGroup: 'center-stage',
    }
    const eligibility = evaluateViewerContribution(imageSpec, result.descriptor, {
      interpretation: 'codec',
      sourceBytes: BigInt(bytes.byteLength),
    })
    // a raster stage declares no optional facets, so nothing is bound beyond the required source
    expect(eligibility).toEqual({ eligible: true, missing: [], optionalBound: [] })

    interface PresentationTicket {
      readonly bindingId: string
    }
    const digest = (plan: PresentationPlan) => `canonical:${canonicalJsonStringify(plan)}`
    const presentation = await resolvePresentationPlan<PresentationTicket>({
      descriptor: result.descriptor,
      candidates: [
        {
          slotId: presentationSlotId('image'),
          kind: imageSpec.kind,
          contributionId: 'modkit.ui/image-stage',
          extensionId: 'modkit/ui',
          priority: imageSpec.priority,
          singletonGroup: imageSpec.singletonGroup,
          bindings: [imageBinding],
          ...eligibility,
        },
      ],
      digest,
      ticketMatches: binding => binding.ticket.bindingId === binding.bindingId,
      async resolveBinding(binding) {
        return {
          ...binding,
          offerId: `session:${binding.bindingId}`,
          providerId: result.selected.contributionId,
          variantId: result.selected.variantId,
          ticket: { bindingId: binding.bindingId },
        } as ResolvedBinding<PresentationTicket>
      },
    })
    expect(presentation.plan).toMatchObject({
      activeStage: 'image',
      alternateStages: [],
      slots: [
        expect.objectContaining({
          contributionId: 'modkit.ui/image-stage',
          bindings: [imageBinding],
        }),
      ],
    })
    expect(presentation.bindings).toEqual([
      expect.objectContaining({
        bindingId: imageBinding.bindingId,
        providerId: 'modkit/image-png',
        variantId: 'trusted-node',
      }),
    ])

    // Two codecs publishing the same raster representation do not collide in the provider lock:
    // their independently replayable detection selections carry the distinction.
    const jpegSource = byteSource(minimalJpeg(), 'sample.jpeg')
    const jpeg = await openSubject({
      inventory,
      source: jpegSource,
      path: 'sample.jpeg',
      mediaType: 'image/jpeg',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-jpeg', classes: ['read-source'] },
      executionBackends: execution.registry,
      budget,
    })
    if (jpeg.state !== 'opened') {
      throw new TypeError(`unexpected JPEG ${jpeg.reason}: ${JSON.stringify(jpeg)}`)
    }
    expect(jpeg.lockText).toBe(result.lockText)
    expect(parseCodecDetectionSelection(jpeg.detectionSelectionText).selected).toMatchObject({
      contributionId: 'modkit/image-jpeg',
      offerId: 'raster-metadata',
    })
    expect(jpeg.detectionSelectionText).not.toBe(result.detectionSelectionText)

    await jpeg.session.dispose()
    expect(execution.releases()).toBe(1)
    await rasterLease.release()
    await result.session.dispose()
    await result.session.dispose()
    expect(execution.releases()).toBe(2)
  })

  it('opens a real UVM artifact through inventory, ticket, bounded probe and session', async () => {
    const encoded = (await readFile(uvmFixture, 'utf8')).replace(/\s+/gu, '')
    const source = byteSource(new Uint8Array(Buffer.from(encoded, 'base64')), 'triangle.uvm.glb')
    const result = await openSubject({
      inventory: await bundledInventory(modelsDir),
      source,
      path: 'triangle.uvm.glb',
      mediaType: 'model/gltf-binary; profile=uvm-1.0',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open', classes: ['read-source'] },
      budget,
    })

    if (result.state !== 'opened') {
      throw new TypeError(`unexpected ${result.reason}: ${JSON.stringify(result)}`)
    }
    expect(result.state).toBe('opened')
    expect(result.selected).toEqual({
      extensionId: 'modkit/models',
      contributionId: 'modkit/model-uvm',
      variantId: 'trusted-node',
      offerId: 'uvm-scene',
      confidence: 0.995,
    })
    expect(result.descriptor).toMatchObject({
      schemaVersion: 2,
      interpretation: 'codec',
      subjectUri: source.ref.uri,
      revision: source.revision,
      identity: { codecId: 'modkit/model-uvm', formatId: 'uvm' },
    })
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributionId: 'modkit/model-uvm',
          variantId: 'portable',
          state: 'rejected',
        }),
        expect.objectContaining({
          contributionId: 'modkit/model-uvm',
          variantId: 'trusted-node',
          state: 'selected',
          confidence: 0.995,
        }),
      ]),
    )
    expect(parsePolicyLock(result.lockText).entries).toEqual([])
    expect(parseCodecDetectionSelection(result.detectionSelectionText).selected).toMatchObject({
      contributionId: 'modkit/model-uvm',
      variantId: 'trusted-node',
      offerId: 'uvm-scene',
    })
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'x3.host/full-process-authority' })]),
    )
    await result.session.dispose()
  })

  it('returns a validated unresolved descriptor and an explicit text/hex fallback', async () => {
    const source = byteSource(new TextEncoder().encode('plain but unknown\n'), 'unknown.bin')
    const result = await openSubject({
      inventory: await bundledInventory(modelsDir),
      source,
      path: 'unknown.bin',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open', classes: ['read-source'] },
      budget,
    })

    expect(result).toMatchObject({
      state: 'unresolved',
      reason: 'no-candidate',
      fallback: { preferred: 'text', available: ['text', 'hex'] },
      descriptor: {
        schemaVersion: 2,
        interpretation: 'none',
        subjectUri: source.ref.uri,
        revision: source.revision,
        candidates: [],
      },
    })
  })

  it('does not silently run a worker-only path on node or trust an unapproved install', async () => {
    const encoded = (await readFile(uvmFixture, 'utf8')).replace(/\s+/gu, '')
    const source = byteSource(new Uint8Array(Buffer.from(encoded, 'base64')), 'triangle.uvm.glb')
    const inventory = await buildInventory(
      [await loadExtensionDirectory(modelsDir)],
      createHostContributionContractRegistry(),
    )
    const result = await openSubject({
      inventory,
      source,
      path: 'triangle.uvm.glb',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-untrusted', classes: ['read-source'] },
      budget,
    })

    expect(result.state).toBe('unresolved')
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: 'portable',
          state: 'rejected',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: 'x3.host/codec-execution-unavailable' }),
          ]),
        }),
        expect.objectContaining({
          variantId: 'trusted-node',
          state: 'rejected',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: 'x3.host/codec-execution-unavailable' }),
          ]),
        }),
      ]),
    )
  })

  it('opens JSON through a separately ticketed syntax provider under a child grant', async () => {
    const inventory = await buildInventory(
      [NATIVE_TEXT_INPUT],
      createHostContributionContractRegistry(),
    )
    const definitions = createServiceContractDefinitionRegistry({
      matcherProfiles: createServiceFacetMatcherProfileRegistry(),
      isNamespaceOwner: () => true,
      validateJsonSchemaRef: () => [],
    })
    expect(await registerServiceContractDefinitionsFromInventory(inventory, definitions)).toEqual([
      { state: 'committed' },
    ])
    const source = byteSource(
      new TextEncoder().encode('{"name":"modkit","ready":true}\n'),
      'document.json',
    )
    const result = await openSubject({
      inventory,
      source,
      path: 'document.json',
      mediaType: 'application/json',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-json', classes: ['read-source'] },
      budget,
      serviceDefinitions: definitions,
      executionBackends: createExecutionBackendRegistry([
        linkedInProcessBackend(NATIVE_TEXT_MODULES),
      ]),
    })

    if (result.state !== 'opened') {
      throw new TypeError(`unexpected ${result.reason}: ${JSON.stringify(result)}`)
    }
    expect(result.state).toBe('opened')
    expect(result.selected).toMatchObject({
      contributionId: 'modkit/text-json',
      variantId: 'core-native',
      offerId: 'syntax-document',
    })
    expect(result.descriptor).toMatchObject({
      interpretation: 'codec',
      identity: { codecId: 'modkit/text-json', formatId: 'json' },
      traits: expect.arrayContaining([
        expect.objectContaining({ id: 'structure.hierarchy', state: 'available' }),
      ]),
    })
    expect(parsePolicyLock(result.lockText).entries).toEqual([
      expect.objectContaining({
        primary: expect.objectContaining({
          contributionId: 'modkit/json-syntax-default',
          offerId: 'json-syntax-default-v1',
        }),
      }),
    ])
    expect(parseCodecDetectionSelection(result.detectionSelectionText).selected).toMatchObject({
      contributionId: 'modkit/text-json',
      offerId: 'syntax-document',
    })
    expect(
      result.diagnostics.filter(item => item.code === 'x3.host/full-process-authority'),
    ).toHaveLength(2)
    expect(
      result.diagnostics
        .filter(item => item.code === 'x3.host/full-process-authority')
        .map(item =>
          item.data !== null && typeof item.data === 'object' && !Array.isArray(item.data)
            ? Reflect.get(item.data, 'classes')
            : undefined,
        ),
    ).toEqual(expect.arrayContaining([['read-source'], []]))

    const shuffledOffers = [...offersFromInventory(inventory)].reverse()
    for (const entry of parsePolicyLock(result.lockText).entries) {
      const replayed = replayPolicyLock(
        {
          contract: {
            contract: entry.key.contract,
            major: entry.key.major,
            range: entry.key.normalizedRange,
          },
          target: {
            environment: 'node',
            operatingSystem: 'windows',
            architecture: 'x64',
            grantedPermissions: ['read-source'],
          },
          requiredOutputs: entry.key.requiredOutputs,
          preferredOutputs: entry.key.preferredOutputs,
          ...(entry.key.operation === undefined ? {} : { operation: entry.key.operation }),
          ...(entry.key.workload === undefined ? {} : { workload: entry.key.workload }),
        },
        shuffledOffers,
        result.lockText,
      )
      expect(replayed).toMatchObject({
        state: 'resolved',
        selected: { offer: { providerId: entry.primary.contributionId } },
      })
    }

    const tree = await result.session.dataSource('common.view/tree-data-source', 1)
    const root = await tree.value.root()
    expect(await tree.value.facts(root)).toMatchObject({ kind: 'value', label: 'root' })
    await tree.release()
    await result.session.dispose()
  })

  it('blocks a codec read outside its declared probe budget before touching the source', async () => {
    const reads: number[] = []
    const base = byteSource(new Uint8Array(16), 'payload.escape')
    const source: ArtifactByteSource = {
      ...base,
      async read(offset, length, signal) {
        reads.push(length)
        return base.read(offset, length, signal)
      },
    }
    const inventory = await bundledInventory(hostileProbeDir)
    expect(inventory.diagnostics).toEqual([])
    const result = await openSubject({
      inventory,
      source,
      path: 'payload.escape',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-hostile', classes: ['read-source'] },
      budget,
    })

    expect(result.state).toBe('unresolved')
    expect(result.candidates).toEqual([
      expect.objectContaining({
        contributionId: 'org.example/probe-escape',
        state: 'rejected',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'x3.host/probe-range-violation' }),
        ]),
      }),
    ])
    // The 9-byte hostile request was stopped by the wrapper. Only the host's explicit
    // 16-byte UTF-8 fallback sniff reached the underlying source.
    expect(reads).toEqual([16])
  })

  it('opens a real directory through file VFS, the namespace bridge, Host and codec-kit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'modkit-namespace-'))
    await writeFile(join(directory, 'project.marker'), 'namespace fixture\n')
    await writeFile(join(directory, 'not-declared.txt'), 'must not be probed\n')
    const filesystem = new VirtualFileSystem().registerProvider(createFileVfsProvider())
    const openedMount = await filesystem.openMount(pathToFileURL(directory).href)
    const accessed: string[] = []
    const mount: VfsMount = {
      id: openedMount.id,
      rootUri: openedMount.rootUri,
      revision: openedMount.revision,
      async stat(path, signal) {
        accessed.push(`stat:${path}`)
        return openedMount.stat(path, signal)
      },
      async *list(path, signal) {
        accessed.push(`list:${path}`)
        yield* openedMount.list(path, signal)
      },
      async open(path, signal) {
        accessed.push(`open:${path}`)
        return openedMount.open(path, signal)
      },
      dispose: () => openedMount.dispose(),
    }
    filesystem.mount('', mount)
    const source = artifactNamespaceSourceFromVfsMount(mount)
    try {
      const namespaceLease = await source.openNamespace()
      await expect(namespaceLease.value.open('../outside')).rejects.toMatchObject({
        code: 'x3.vfs/path-escape-refused',
      })
      await namespaceLease.release()

      const execution = countingTrustedBackends()
      const result = await openSubject({
        inventory: await bundledInventory(namespaceProbeDir),
        source,
        intent: 'full',
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        grant: { id: 'subject-open-namespace', classes: ['read-source'] },
        executionBackends: execution.registry,
        budget,
      })

      if (result.state !== 'opened') {
        throw new TypeError(`unexpected ${result.reason}: ${JSON.stringify(result)}`)
      }
      expect(result.selected).toMatchObject({
        contributionId: 'org.example/namespace-project',
        confidence: 0.99,
      })
      expect(result.descriptor).toMatchObject({
        subjectUri: source.ref.uri,
        revision: source.revision,
        origin: { kind: 'namespace', root: source.ref, revision: source.revision },
        identity: { codecId: 'org.example/namespace-project', formatId: 'namespace-project' },
        constraints: { seekable: false, randomAccess: false },
      })
      expect(parseCodecDetectionSelection(result.detectionSelectionText).selected).toMatchObject({
        contributionId: 'org.example/namespace-project',
        sourceTopology: 'namespace',
        evidence: [expect.objectContaining({ kind: 'structure' })],
      })
      expect(result.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contributionId: 'org.example/namespace-overread',
            state: 'rejected',
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: 'x3.host/namespace-probe-byte-budget-exceeded' }),
            ]),
          }),
          expect.objectContaining({
            contributionId: 'org.example/namespace-traversal',
            state: 'rejected',
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: 'x3.host/namespace-probe-traversal-refused' }),
            ]),
          }),
        ]),
      )
      expect(accessed).not.toContain('stat:not-declared.txt')
      expect(accessed).not.toContain('open:not-declared.txt')
      expect(accessed.some(item => item.startsWith('list:'))).toBe(false)
      expect(accessed.filter(item => item.endsWith(':project.marker')).length).toBeGreaterThan(0)
      await result.session.dispose()
      expect(execution.releases()).toBe(3)
    } finally {
      await filesystem.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('releases every activated candidate before returning an ambiguous result', async () => {
    const execution = countingTrustedBackends()
    const emptyMatchImports = globalThis.__x3EmptyMatchImports ?? 0
    const source = byteSource(new Uint8Array([1, 2, 3, 4]), 'payload.ambiguous')
    const result = await openSubject({
      inventory: await bundledInventory(ambiguousProbeDir),
      source,
      path: 'payload.ambiguous',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-ambiguous', classes: ['read-source'] },
      executionBackends: execution.registry,
      budget,
    })

    expect(result.state).toBe('unresolved')
    expect(result).toMatchObject({ reason: 'ambiguous' })
    expect(result.candidates).toEqual([
      expect.objectContaining({ variantId: 'trusted-a', state: 'detected', confidence: 0.8 }),
      expect.objectContaining({ variantId: 'trusted-b', state: 'detected', confidence: 0.8 }),
    ])
    expect(execution.releases()).toBe(2)
    expect(globalThis.__x3EmptyMatchImports ?? 0).toBe(emptyMatchImports)
  })
})

describe('detection-hostile: the bounded data-only signature index (NXT-101B / F6)', () => {
  /** PNG magic + IHDR — the same shape favicon-32.png starts with; content after does not matter for the shortlist. */
  async function pngBytes(): Promise<Uint8Array> {
    return new Uint8Array(await readFile(pngFixture))
  }
  /** A comment-free ZIP end-of-central-directory record: 'PK' + 18 zero bytes = 22 bytes. */
  function zipEocd(): Uint8Array {
    const eocd = new Uint8Array(22)
    eocd.set([0x50, 0x4b, 0x05, 0x06], 0)
    return eocd
  }
  async function inventoryOf(...dirs: string[]) {
    const inputs = await Promise.all(dirs.map(directory => loadExtensionDirectory(directory)))
    return buildInventory(
      inputs.map(input => ({
        ...input,
        execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
      })),
      createHostContributionContractRegistry(),
    )
  }
  function countingSource(bytes: Uint8Array, name: string) {
    const reads: { offset: bigint; length: number }[] = []
    const base = byteSource(bytes, name)
    const source: ArtifactByteSource = {
      ...base,
      async read(offset, length, signal) {
        reads.push({ offset, length })
        return base.read(offset, length, signal)
      },
    }
    return { source, reads }
  }

  it('a renamed PNG (.dat) reaches the PNG probe through its declared signature and opens; the reads stay bounded', async () => {
    const inventory = await inventoryOf(imagesDir)
    const bytes = await pngBytes()
    const { source, reads } = countingSource(bytes, 'renamed.dat')
    const result = await openSubject({
      inventory,
      source,
      path: 'renamed.dat', // no extension/media/path rule matches this
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'sig-renamed', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    expect(result.selected.contributionId).toBe('modkit/image-png')
    // the shortlist admission is explained, not silent
    const selected = result.candidates.find(item => item.state === 'selected')
    expect(selected?.diagnostics.map(item => item.code)).toContain('x3.host/signature-match')
    // Complete image inventory windows (12-byte head and 18-byte tail), PNG probe (32), then open.
    expect(reads).toEqual([
      { offset: 0n, length: 12 },
      { offset: BigInt(bytes.byteLength - 18), length: 18 },
      { offset: 0n, length: 32 },
      { offset: 0n, length: bytes.byteLength },
    ])
    await result.session.dispose()
  })

  it('a PNG+ZIP polyglot shortlists both codecs (start and end signatures); the probes decide, nothing is bypassed', async () => {
    const inventory = await inventoryOf(imagesDir, archivesDir)
    const png = await pngBytes()
    const polyglot = new Uint8Array(png.length + 22)
    polyglot.set(png, 0)
    polyglot.set(zipEocd(), png.length)
    const { source, reads } = countingSource(polyglot, 'polyglot.bin')
    const result = await openSubject({
      inventory,
      source,
      path: 'polyglot.bin',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'sig-polyglot', classes: ['read-source'] },
      budget,
    })
    // both codecs were admitted and probed — the polyglot cannot dodge either detector
    const probedIds = new Set(
      result.candidates.filter(item => item.state !== 'rejected').map(item => item.contributionId),
    )
    expect(probedIds.has('modkit/image-png')).toBe(true)
    expect(probedIds.has('modkit/archive-zip')).toBe(true)
    // the signature windows are two bounded reads: head (max prefix need) + tail (EOCD window)
    expect(reads[0]?.offset).toBe(0n)
    expect(Number(reads[0]?.length)).toBeLessThanOrEqual(4096 + 64)
    expect(reads[1]?.offset).toBe(BigInt(polyglot.length - 22))
    expect(reads[1]?.length).toBe(22)
    // deterministic outcome: the PNG probe wins detection (0.999 vs the ZIP probe's floor), and
    // then the PNG codec's own open() refuses the trailing ZIP bytes — the polyglot is probed by
    // both detectors and opened by neither
    expect(result.state).toBe('unresolved')
    if (result.state === 'unresolved') {
      expect(result.reason).toBe('input-unresolved')
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'x3.host/subject-input-open-failed',
          message: expect.stringMatching(/^subject input-open failed closed: .+/u),
        }),
      )
      const png = result.candidates.find(
        item => item.contributionId === 'modkit/image-png' && item.variantId === 'trusted-node',
      )
      const zip = result.candidates.find(
        item => item.contributionId === 'modkit/archive-zip' && item.variantId === 'trusted-node',
      )
      expect(png?.confidence).toBeGreaterThan(0.9)
      expect(zip?.confidence).toBeLessThan(0.1)
    }
  })

  it('names input-open when a foreign codec exception has crossed an execution boundary', async () => {
    const inventory = await bundledInventory(imagesDir)
    const executionBackends = createExecutionBackendRegistry([
      {
        profile: 'trusted-in-process',
        supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
        async activate(context) {
          const loaded = (await import(context.entrypoint.href)) as Record<string, unknown>
          const createCodec = loaded['createCodec'] as () => Record<string, unknown>
          return {
            module: {
              ...loaded,
              createCodec: () => {
                const codec = createCodec()
                const open = codec['open'] as (...args: unknown[]) => Promise<unknown>
                return {
                  ...codec,
                  open: async (...args: unknown[]) => {
                    try {
                      return await open.apply(codec, args)
                    } catch (error) {
                      throw new ModkitError({
                        code: 'x3.host/rpc-foreign-error',
                        message: error instanceof Error ? error.message : String(error),
                      })
                    }
                  },
                }
              },
            },
            release: async () => undefined,
          }
        },
      },
    ])
    const corrupt = new Uint8Array(20)
    corrupt.set(new TextEncoder().encode('DDS '), 0)
    const result = await openSubject({
      inventory,
      source: byteSource(corrupt, 'corrupt.dds'),
      path: 'corrupt.dds',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-foreign-input', classes: ['read-source'] },
      executionBackends,
      budget,
    })

    expect(result.state).toBe('unresolved')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'x3.host/subject-input-open-failed',
        message: 'subject input-open failed closed: DDS header is truncated',
      }),
    )
  })

  it('a magic collision (PNG signature, corrupt body) is probed and rejected honestly — shortlisting is not detection', async () => {
    const inventory = await inventoryOf(imagesDir)
    const collision = new Uint8Array(64)
    collision.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0) // magic, then zeros: no IHDR
    const { source } = countingSource(collision, 'collision.bin')
    const result = await openSubject({
      inventory,
      source,
      path: 'collision.bin',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'sig-collision', classes: ['read-source'] },
      budget,
    })
    // the PNG codec was shortlisted by its signature; its probe is the authority and refuses
    expect(result.state).toBe('unresolved')
    if (result.state !== 'unresolved') throw new Error('collision must not open')
    const png = result.candidates.find(item => item.contributionId === 'modkit/image-png')
    expect(png).toBeDefined()
    expect(png?.state).not.toBe('selected')
  })

  it('a subject with no matching name and no matching signature stays no-candidate with bounded reads', async () => {
    const inventory = await inventoryOf(imagesDir)
    const noise = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const { source, reads } = countingSource(noise, 'noise.qqq')
    const result = await openSubject({
      inventory,
      source,
      path: 'noise.qqq',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'sig-noise', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('unresolved')
    if (result.state === 'unresolved') expect(result.reason).toBe('no-candidate')
    // Head and tail windows both clamp to this ten-byte subject; the last read is the
    // pre-existing text/hex fallback sniff. No codec probe ever ran.
    expect(reads).toEqual([
      { offset: 0n, length: noise.byteLength },
      { offset: 0n, length: noise.byteLength },
      { offset: 0n, length: noise.byteLength },
    ])
  })
})

describe('detection probes run under the probe grant; the open re-activates under the caller grant (R5)', () => {
  const grantsBytes = () => new Uint8Array([0x47, 0x52, 0x41, 0x4e, 1, 2, 3, 4]) // "GRAN…"
  // read via a function so TS control-flow narrowing of the global assignment does not stick
  const createCodecCalls = () => globalThis.__x3GrantsFixture?.createCodecCalls

  function activationCounter() {
    let activations = 0
    return {
      registry: createExecutionBackendRegistry([
        {
          profile: 'trusted-in-process',
          supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
          async activate(context) {
            activations += 1
            return {
              module: (await import(context.entrypoint.href)) as Record<string, unknown>,
              release: async () => undefined,
            }
          },
        },
      ]),
      activations: () => activations,
    }
  }

  it('a codec requesting write-source probes under read-source only, then opens under a second activation with the full grant', async () => {
    const inventory = await bundledInventory(grantsProbeDir)
    const execution = activationCounter()
    // This module may already be cached by the earlier root-glob regression; reset its observable
    // state explicitly instead of relying on the fixture's module-evaluation initializer.
    globalThis.__x3GrantsFixture = { createCodecCalls: 0 }
    const result = await openSubject({
      inventory,
      source: byteSource(grantsBytes(), 'demo.grants'),
      path: 'demo.grants',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'g-grants-full', classes: ['read-source', 'write-source'] },
      executionBackends: execution.registry,
      budget,
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    // one activation for the probe (probe-scoped child grant), one for the open (caller grant)
    expect(execution.activations()).toBe(2)
    expect(createCodecCalls()).toBe(2)
    await result.session.dispose()
  })

  it('the same codec under a read-only grant is refused at resolution — no probe, no activation, no partial open', async () => {
    // The resolver's permission stage is earlier than the probe seam: an offer whose variant
    // requires write-source cannot serve a read-only grant at all, so the host does not spend a
    // probe on a codec the caller could never open (the seam's clamp is proven at the gate).
    const inventory = await bundledInventory(grantsProbeDir)
    const execution = activationCounter()
    globalThis.__x3GrantsFixture = { createCodecCalls: 0 }
    const result = await openSubject({
      inventory,
      source: byteSource(grantsBytes(), 'demo.grants'),
      path: 'demo.grants',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'g-grants-read', classes: ['read-source'] },
      executionBackends: execution.registry,
      budget,
    })
    expect(result.state).toBe('unresolved')
    if (result.state !== 'unresolved') throw new Error('read-only grant must not open')
    expect(result.reason).toBe('no-match')
    expect(execution.activations()).toBe(0)
    expect(createCodecCalls()).toBe(0)
    expect(
      result.candidates.some(
        item =>
          item.contributionId === 'org.example/grants-codec' &&
          item.state === 'rejected' &&
          item.diagnostics.some(d => d.code === 'x3.host/codec-resolution-unresolved'),
      ),
    ).toBe(true)
  })
})
