import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify, traitId } from '@modkitx-x3/core'
import {
  buildInventory,
  createHostContributionContractRegistry,
  createServiceContractDefinitionRegistry,
  createServiceFacetMatcherProfileRegistry,
  evaluateViewerContribution,
  offersFromInventory,
  openSubject,
  parsePolicyLock,
  registerServiceContractDefinitionsFromInventory,
  replayPolicyLock,
  resolvePresentationPlan,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  bindingId,
  presentationSlotId,
  revisionId,
  type ArtifactByteSource,
  type PresentationPlan,
  type RasterImageSource,
  type ResolvedBinding,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const imagesDir = join(repoRoot, 'extensions', 'common', 'images')
const modelsDir = join(repoRoot, 'extensions', 'common', 'models')
const textJsonDir = join(repoRoot, 'extensions', 'common', 'text-json')
const hostileProbeDir = join(import.meta.dirname, 'fixtures', 'subject-open-extension')
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

describe('host-owned subject opening pipeline', () => {
  it('opens PNG through the real image inventory and resolves a bounded raster presentation', async () => {
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
      inventory: await bundledInventory(imagesDir),
      source,
      path: 'favicon-32.png',
      mediaType: 'image/png',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'subject-open-png', classes: ['read-source'] },
      budget,
    })

    if (result.state !== 'opened') {
      throw new TypeError(`unexpected ${result.reason}: ${JSON.stringify(result)}`)
    }
    expect(result.selected).toEqual({
      extensionId: 'org.modkitx/images',
      contributionId: 'org.modkitx/image-png',
      variantId: 'trusted-node',
      offerId: 'raster-metadata',
      confidence: 0.999,
    })
    expect(result.descriptor).toMatchObject({
      schemaVersion: 2,
      interpretation: 'codec',
      subjectUri: source.ref.uri,
      revision: source.revision,
      identity: { codecId: 'org.modkitx/image-png', formatId: 'png' },
      traits: expect.arrayContaining([
        expect.objectContaining({ id: 'image.raster', state: 'available' }),
      ]),
      dataSources: expect.arrayContaining([
        expect.objectContaining({ contract: 'common.view/raster-image-source', major: 1 }),
      ]),
    })
    // Detection stays inside the declared 32-byte probe before the selected codec performs its
    // separately budgeted full-input read.
    expect(reads).toEqual([
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
    expect(eligibility).toEqual({ eligible: true, missing: [] })

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
          contributionId: 'org.modkitx.ui/image-stage',
          extensionId: 'org.modkitx/ui',
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
          contributionId: 'org.modkitx.ui/image-stage',
          bindings: [imageBinding],
        }),
      ],
    })
    expect(presentation.bindings).toEqual([
      expect.objectContaining({
        bindingId: imageBinding.bindingId,
        providerId: 'org.modkitx/image-png',
        variantId: 'trusted-node',
      }),
    ])

    await rasterLease.release()
    await result.session.dispose()
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
      extensionId: 'org.modkitx/models',
      contributionId: 'org.modkitx/model-uvm',
      variantId: 'trusted-node',
      offerId: 'uvm-scene',
      confidence: 0.995,
    })
    expect(result.descriptor).toMatchObject({
      schemaVersion: 2,
      interpretation: 'codec',
      subjectUri: source.ref.uri,
      revision: source.revision,
      identity: { codecId: 'org.modkitx/model-uvm', formatId: 'uvm' },
    })
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributionId: 'org.modkitx/model-uvm',
          variantId: 'portable',
          state: 'rejected',
        }),
        expect.objectContaining({
          contributionId: 'org.modkitx/model-uvm',
          variantId: 'trusted-node',
          state: 'selected',
          confidence: 0.995,
        }),
      ]),
    )
    expect(result.lockText).toContain('org.modkitx/model-uvm')
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
    const inventory = await bundledInventory(textJsonDir)
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
    })

    if (result.state !== 'opened') {
      throw new TypeError(`unexpected ${result.reason}: ${JSON.stringify(result)}`)
    }
    expect(result.state).toBe('opened')
    expect(result.selected).toMatchObject({
      contributionId: 'org.modkitx/text-json',
      variantId: 'trusted-node',
      offerId: 'syntax-document',
    })
    expect(result.descriptor).toMatchObject({
      interpretation: 'codec',
      identity: { codecId: 'org.modkitx/text-json', formatId: 'json' },
      traits: expect.arrayContaining([
        expect.objectContaining({ id: 'structure.hierarchy', state: 'available' }),
      ]),
    })
    expect(result.lockText).toContain('org.modkitx/text-json')
    expect(result.lockText).toContain('org.modkitx/json-syntax-default')
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
})
