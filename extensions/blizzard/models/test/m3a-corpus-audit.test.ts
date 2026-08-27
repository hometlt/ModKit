import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openNestedSubject,
  openSubject,
  type Inventory,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import type {
  Lease,
  ModelAnimationSource,
  ModelResourceRefsSource,
  ModelSkeletonSource,
  NamespaceEntrySource,
  ResourceBudget,
  RevisionId,
} from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWorkspaceNamespaceCompanionOrigin } from '../../../../packages/host/src/namespace-origin.js'
import { createResourceSession } from '../../../../packages/host/src/resource-session.js'
import { resolveM3AnimationSidecars } from '../src/m3/sidecar-projection.node.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const sc2Root = process.env.MODKITX_SC2_ROOT?.trim()
const installed = sc2Root !== undefined && existsSync(join(sc2Root, '.build.info'))
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'm3a-corpus-audit', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

const ROOT_PREFIX = 'campaigns/liberty.sc2campaign/base.sc2assets'
const BASE_DIRECTORY = `${ROOT_PREFIX}/assets/storymodecharacters/protoss/sm_zeratul/`
const BASE_PATH = `${BASE_DIRECTORY}sm_zeratul.m3`
const SIDECAR_DIRECTORY = `${ROOT_PREFIX}/assets/storymodecharacters/protoss/sm_zeratul_dialogue03/`
const SIDECAR_PATH = `${SIDECAR_DIRECTORY}sm_zeratul_dialogue03.m3a`
const SIDECAR_LOGICAL_ID =
  'assets/storymodecharacters/protoss/sm_zeratul_dialogue03/sm_zeratul_dialogue03.m3a'
const UNRELATED_BASE_PATH =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const SIDECAR_BYTES = 1_382_592
const SIDECAR_SHA256 = '3549347c81c70f63c72d84ea441b21e6405c6b748001c33f84b8e04c6dba16ad'
const SIDECAR_ANIMATION_HASH = 840_957_610
const EXPECTED_TEXTURES = Object.freeze([
  'Assets/Textures/sm_zt_eye_Diff.dds',
  'Assets/Textures/sm_zt_eye_emis.dds',
  'Assets/Textures/sm_zt_eye_Norm.dds',
  'Assets/Textures/sm_zt_head_Diff.dds',
  'Assets/Textures/sm_zt_head_spec.dds',
  'Assets/Textures/sm_zt_head_Norm.dds',
  'Assets/Textures/sm_zt_aocc.dds',
  'Assets/Textures/sm_zt_others_Diff.dds',
  'Assets/Textures/sm_zt_others_spec.dds',
  'Assets/Textures/sm_zt_others_emis.dds',
  'Assets/Textures/Reflection_MarSaraBar.dds',
  'Assets/Textures/sm_zt_others_Norm.dds',
  'Assets/Textures/sm_zt_env.dds',
  'Assets/Textures/SM_ZT_body_Diff.dds',
  'Assets/Textures/sm_zt_body_spec.dds',
  'Assets/Textures/sm_zt_body_Norm.dds',
])

const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])

let inventoryValue: Inventory | undefined
let cascResult: Awaited<ReturnType<typeof openSubject>> | undefined
let namespaceLease: Lease<unknown> | undefined
let namespaceValue: NamespaceEntrySource | undefined
let cascRevision: RevisionId | undefined

function inventory(): Inventory {
  if (inventoryValue === undefined) throw new TypeError('M3A corpus inventory is not open')
  return inventoryValue
}

function casc() {
  if (cascResult?.state !== 'opened') throw new TypeError('M3A corpus CASC session is not open')
  return cascResult
}

function namespace(): NamespaceEntrySource {
  if (namespaceValue === undefined) throw new TypeError('M3A corpus namespace is not open')
  return namespaceValue
}

async function extract(entryId: string, signal?: AbortSignal): Promise<Uint8Array> {
  const payload = await casc()
    .session.operations()
    .invoke('extract-entry', { entryId }, signal === undefined ? {} : { signal })
  if (payload.state !== 'ok' || payload.output.kind !== 'bytes') {
    throw new Error(`CASC extraction failed for ${entryId}`)
  }
  return payload.output.value
}

async function directoryEntries(prefix: string): Promise<readonly string[]> {
  const entries: string[] = []
  let cursor: string | undefined
  for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
    const page = await namespace().list(prefix, { cursor, limit: 64 })
    entries.push(...page.items.map(item => item.id))
    cursor = page.nextCursor
    if (cursor === undefined) return Object.freeze(entries)
  }
  throw new RangeError(`retail M3 directory «${prefix}» exceeded four pages`)
}

function resourceSession(primaryLogicalId: string) {
  if (cascRevision === undefined) throw new TypeError('M3A corpus revision is absent')
  return createResourceSession({
    origin: createWorkspaceNamespaceCompanionOrigin({
      namespace: namespace(),
      primaryLogicalId,
      containerRevision: cascRevision,
      logicalRoots: [
        {
          rootId: 'retail:liberty.sc2campaign',
          pathPrefix: ROOT_PREFIX,
        },
      ],
      pageLimit: 64,
      maxPages: 4,
      extract,
    }),
    revision: cascRevision,
    limits: { maxEntries: 256 },
  })
}

describe.skipIf(!installed)('installed StarCraft II M3A corpus', () => {
  beforeAll(async () => {
    if (sc2Root === undefined) throw new TypeError('MODKITX_SC2_ROOT is not set')
    const inputs = await Promise.all(
      [
        ['blizzard', 'casc'],
        ['blizzard', 'models'],
      ].map(async parts => ({
        ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
        execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
      })),
    )
    inventoryValue = await buildInventory(inputs, createHostContributionContractRegistry())
    const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
    const mount = await vfs.openMount(pathToFileURL(sc2Root).href)
    cascResult = await openSubject({
      inventory: inventoryValue,
      source: artifactNamespaceSourceFromVfsMount(mount),
      path: sc2Root,
      intent: 'full',
      target,
      grant,
      budget,
      executionBackends,
    })
    if (cascResult.state !== 'opened') {
      throw new Error(
        `CASC did not open: ${cascResult.reason} ${JSON.stringify({ candidates: cascResult.candidates, diagnostics: cascResult.diagnostics })}`,
      )
    }
    namespaceLease = await cascResult.session.dataSource('common.view/namespace-entry-source', 1)
    namespaceValue = namespaceLease.value as NamespaceEntrySource
    cascRevision = (await cascResult.session.descriptor()).revision
  }, 300_000)

  afterAll(async () => {
    try {
      await namespaceLease?.release()
    } finally {
      if (cascResult?.state === 'opened') await cascResult.session.dispose()
    }
  })

  it('pairs a pinned retail Zeratul M3A through the workspace resource session', async () => {
    expect(await directoryEntries(BASE_DIRECTORY)).toContain(BASE_PATH)
    expect(await directoryEntries(SIDECAR_DIRECTORY)).toContain(SIDECAR_PATH)

    const [baseBytes, sidecarBytes] = await Promise.all([extract(BASE_PATH), extract(SIDECAR_PATH)])
    expect(sidecarBytes).toHaveLength(SIDECAR_BYTES)
    expect(createHash('sha256').update(sidecarBytes).digest('hex')).toBe(SIDECAR_SHA256)

    const resources = resourceSession(BASE_PATH)
    try {
      const pairing = await resolveM3AnimationSidecars({
        baseBytes,
        candidates: [{ logicalId: SIDECAR_LOGICAL_ID }],
        resources,
        budget,
      })
      expect(pairing.accepted).toEqual([
        expect.objectContaining({
          logicalId: SIDECAR_LOGICAL_ID,
          bytes: SIDECAR_BYTES,
          hashes: [SIDECAR_ANIMATION_HASH],
          clips: 1,
        }),
      ])
      expect(pairing.references).toEqual([
        {
          id: SIDECAR_LOGICAL_ID,
          role: 'sidecar',
          provenance: 'companion',
          bytes: SIDECAR_BYTES,
        },
      ])
      expect(pairing.clips).toHaveLength(1)
      expect(pairing.clips[0]).toMatchObject({
        id: 'm3a-0-sequence-0',
        name: 'Dialogue 03',
        kind: 'animation',
        provenance: 'companion',
        frames: 1_684,
        hierarchyId: 'm3/bone-table',
        unsupportedChannels: 171,
      })
      expect(pairing.clips[0]?.channels).toHaveLength(402)
      expect(pairing.clips[0]?.channels.every(channel => channel.target.startsWith('bone/'))).toBe(
        true,
      )
      expect(pairing.diagnostics.map(item => item.code)).toEqual(['x3.m3/animation-target-refused'])
      expect(pairing.provenance).toEqual([
        expect.objectContaining({
          logicalId: SIDECAR_LOGICAL_ID,
          state: 'resolved',
          bytes: BigInt(SIDECAR_BYTES),
        }),
      ])
    } finally {
      await resources.dispose()
    }
    expect(resources.state()).toBe('disposed')
  })

  it('opens the retail M3A directly without fabricating companion-bound facts', async () => {
    const nested = await openNestedSubject({
      parent: casc().session,
      entryId: SIDECAR_PATH,
      inventory: inventory(),
      executionBackends,
      target,
      grant,
      budget,
    })
    if (nested.result.state !== 'opened') {
      throw new Error(`${SIDECAR_PATH}: ${JSON.stringify(nested.result.diagnostics)}`)
    }
    try {
      expect(nested.result.selected.contributionId).toBe('org.modkitx/m3')
      const animationLease = await nested.result.session.dataSource(
        'common.view/model-animation-source',
        1,
      )
      try {
        const resourceLease = await nested.result.session.dataSource(
          'common.view/model-resource-refs-source',
          1,
        )
        try {
          const skeletonLease = await nested.result.session.dataSource(
            'common.view/model-skeleton-source',
            1,
          )
          try {
            const animations = animationLease.value as ModelAnimationSource
            const resources = resourceLease.value as ModelResourceRefsSource
            const skeleton = skeletonLease.value as ModelSkeletonSource
            expect(await animations.info()).toEqual({ clips: 1, channelled: 1, companionBound: 0 })
            const clips = (await animations.clips({ limit: 8 })).items
            expect(clips).toHaveLength(1)
            expect(clips[0]).toMatchObject({
              id: 'm3-sequence-0',
              name: 'Dialogue 03',
              provenance: 'direct',
              frames: 1_684,
              unsupportedChannels: 171,
            })
            expect(clips[0]?.channels).toHaveLength(402)

            expect(await resources.info()).toEqual({
              references: EXPECTED_TEXTURES.length,
              bound: 0,
              truncated: false,
            })
            const references = (await resources.references({ limit: 32 })).items
            expect(references.map(item => item.id)).toEqual(EXPECTED_TEXTURES)
            expect(references.every(item => item.provenance === 'reference-only')).toBe(true)
            expect(await skeleton.info()).toEqual({
              bindings: 134,
              named: 134,
              companionBound: 0,
              hierarchies: 1,
            })
          } finally {
            await skeletonLease.release()
          }
        } finally {
          await resourceLease.release()
        }
      } finally {
        await animationLease.release()
      }
    } finally {
      await nested.result.session.dispose()
    }
  })

  it('rejects that retail M3A against an unrelated shipped base', async () => {
    const resources = resourceSession(UNRELATED_BASE_PATH)
    try {
      const pairing = await resolveM3AnimationSidecars({
        baseBytes: await extract(UNRELATED_BASE_PATH),
        candidates: [{ logicalId: SIDECAR_LOGICAL_ID }],
        resources,
        budget,
      })
      expect(pairing.accepted).toEqual([])
      expect(pairing.clips).toEqual([])
      expect(pairing.references).toEqual([])
      expect(pairing.diagnostics.map(item => item.code)).toContain(
        'x3.m3/m3a-sidecar-hash-mismatch',
      )
      expect(pairing.provenance).toEqual([
        expect.objectContaining({ logicalId: SIDECAR_LOGICAL_ID, state: 'resolved' }),
      ])
    } finally {
      await resources.dispose()
    }
    expect(resources.state()).toBe('disposed')
  })
})
