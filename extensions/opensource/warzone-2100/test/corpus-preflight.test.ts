import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  openNestedSubject,
  registerServiceDefinitionsOrThrow,
  type Inventory,
  type SubjectServices,
} from '@modkitx-x3/host'
import { createPathSubjectOpener, loadExtensionDirectory } from '@modkitx-x3/host/node'
import type {
  AssetSession,
  ModelAnimationSource,
  ModelResourceRefsSource,
  ModelSceneSource,
  NamespaceEntry,
  NamespaceEntrySource,
  ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  drainModelProjection,
  materializeAndCompare,
  proves,
  unexplainedDifferences,
} from '@modkitx-x3/testkit'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const corpusRoot = process.env['MODKITX_WARZONE_ROOT']
const configured = typeof corpusRoot === 'string' && corpusRoot.length > 0
const archivePath = configured ? join(corpusRoot, 'data', 'base.wz') : ''
const candidatePath = 'components/bodies/cybd_run.pie'
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'warzone-pie-live', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 1_073_741_824n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 256 * 1024 * 1024,
  maxDiagnostics: 200,
}
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

async function listAll(source: NamespaceEntrySource): Promise<NamespaceEntry[]> {
  const entries: NamespaceEntry[] = []
  let cursor: string | undefined
  do {
    const page = await source.list(
      '',
      cursor === undefined ? { limit: 256 } : { cursor, limit: 256 },
    )
    entries.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return entries
}

interface Receipt {
  readonly form: string
  readonly planes: readonly { readonly planeId: string; readonly state: string }[]
}

function receiptOf(descriptor: unknown): Receipt {
  return (
    descriptor as {
      metadata: readonly { id: string; entries: readonly { value: unknown }[] }[]
    }
  ).metadata.find(group => group.id === 'uv-projection-receipt')?.entries[0]?.value as Receipt
}

describe.skipIf(!configured)('Warzone 2100 PIE live corpus', () => {
  let services: SubjectServices
  let archive: AssetSession | undefined
  let inventory: Inventory

  beforeAll(async () => {
    if (!existsSync(archivePath)) {
      throw new Error('MODKITX_WARZONE_ROOT does not identify a Warzone install with data/base.wz')
    }
    const inputs = await Promise.all([
      loadExtensionDirectory(join(repoRoot, 'extensions', 'common', 'archives')),
      loadExtensionDirectory(join(repoRoot, 'extensions', 'opensource', 'warzone-2100')),
    ])
    inventory = await buildInventory(
      inputs.map(input => ({
        ...input,
        execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
      })),
      createHostContributionContractRegistry(),
    )
    const serviceDefinitions = createBundledServiceDefinitionRegistry()
    await registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
    services = createSubjectServices({ inventory, target, executionBackends, serviceDefinitions })
    if (corpusRoot === undefined) throw new Error('MODKITX_WARZONE_ROOT is not configured')
    const open = createPathSubjectOpener({
      subjects: services,
      roots: [corpusRoot],
      budget,
      grant,
    })
    const result = await open(archivePath)
    if (result.session === undefined)
      throw new Error(`base.wz did not open: ${result.snapshot.state}`)
    archive = result.session
  }, 120_000)

  afterAll(async () => {
    await archive?.dispose()
  })

  it('opens cybd_run.pie through base.wz as a nested subject and materializes its live projection', async () => {
    const activeArchive = archive
    if (activeArchive === undefined) throw new Error('base.wz was not opened by the fixture setup')
    const archiveDescriptor = await activeArchive.descriptor()
    expect(archiveDescriptor.identity.codecId).toBe('org.modkitx/warzone-wz')
    const namespaceLease = await activeArchive.dataSource('common.view/namespace-entry-source', 1)
    const entries = await listAll(namespaceLease.value)
    await namespaceLease.release()
    expect(entries.filter(entry => entry.path.toLowerCase().endsWith('.pie'))).toHaveLength(761)
    const candidate = entries.find(entry => entry.path === candidatePath)
    expect(candidate).toBeDefined()
    if (candidate === undefined) throw new Error('the pinned PIE entry is missing')

    const extract = archiveDescriptor.operations.find(item => item.id === 'container.extract')
    if (extract === undefined) throw new Error('the ZIP extract operation is absent')
    const extracted = await activeArchive.operations().invoke(extract.handlerId, {
      entryId: candidate.id,
    })
    if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
      throw new Error('the Warzone WZ route refused the pinned PIE entry')
    }
    expect(extracted.output.value).toHaveLength(22_053)
    expect(createHash('sha256').update(extracted.output.value).digest('hex')).toBe(
      '0674a8044d71f12c8f9362eae9efea946f5b0ba04b065d9d8b861eae669fef23',
    )

    const nested = await openNestedSubject({
      parent: activeArchive,
      entryId: candidate.id,
      inventory,
      executionBackends,
      target,
      grant,
      budget,
    })
    if (nested.result.state !== 'opened') {
      throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 1000))
    }
    try {
      expect(nested.result.selected.contributionId).toBe('org.modkitx/warzone-pie')
      const descriptor = await nested.result.session.descriptor()
      const inspectOperation = descriptor.operations.find(item => item.id === 'view.inspect')
      if (inspectOperation === undefined) throw new Error('the PIE inspect operation is absent')
      const inspected = await nested.result.session
        .operations()
        .invoke(inspectOperation.handlerId, null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
        throw new Error('the PIE inspect operation did not return its summary')
      }
      const summary = inspected.output.value
      proves({
        contributionId: 'org.modkitx/warzone-pie',
        operation: 'inspect',
        note: 'real cybd_run.pie opens from base.wz through the stock nested-subject route',
      })

      const modelLease = await nested.result.session.dataSource('common.view/model-scene-source', 1)
      const model = modelLease.value as ModelSceneSource
      const info = await model.info()
      const projection = await drainModelProjection(model, { maxBytes: budget.maxScalarBytes })
      await modelLease.release()
      expect(info).toMatchObject({
        nodes: 6,
        meshes: 6,
        primitives: 6,
        textures: 1,
        animations: 6,
        geometryAccess: 'decoded',
      })
      expect(summary).toEqual({
        animObjects: 6,
        format: 'warzone-pie',
        levels: 6,
        namedRemainder: ['warzone-3do', 'pie-writing'],
        points: 108,
        polygons: 148,
        textures: 1,
        version: 3,
      })

      const animationLease = await nested.result.session.dataSource(
        'common.view/model-animation-source',
        1,
      )
      const animation = animationLease.value as ModelAnimationSource
      const animationInfo = await animation.info()
      const clips = await animation.clips({ limit: 64 })
      await animationLease.release()
      expect(animationInfo).toMatchObject({ clips: 6, channelled: 6, companionBound: 0 })
      expect(clips.items).toHaveLength(6)
      expect(clips.items.every(clip => clip.frames === 40 && clip.channels.length === 3)).toBe(true)

      const refsLease = await nested.result.session.dataSource(
        'common.view/model-resource-refs-source',
        1,
      )
      const refsInfo = await (refsLease.value as ModelResourceRefsSource).info()
      await refsLease.release()
      expect(refsInfo.references).toBe(1)

      const receipt = receiptOf(descriptor)
      expect(receipt.form).toBe('portable')
      expect(receipt.planes.find(plane => plane.planeId === 'animation')).toMatchObject({
        state: 'preserved',
      })
      expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)
      proves({
        contributionId: 'org.modkitx/warzone-pie',
        operation: 'read',
        note: 'six real ANIMOBJECT blocks yield six 40-record clips and portable projection evidence',
      })

      const verdict = await materializeAndCompare(repoRoot, projection, {
        assetId: `warzone/${candidatePath}`,
        sourceFormat: 'pie',
        subjectRevision: nested.result.session.revision,
        assetClass: 'unit',
      })
      expect(verdict.byteStable).toBe(true)
      expect(verdict.exact).toBe(false)
      expect(verdict.bytes).toHaveLength(15_116)
      expect(verdict.receipt.diff).toHaveLength(6)
      expect(unexplainedDifferences(verdict)).toEqual([])
      proves({
        contributionId: 'org.modkitx/warzone-pie',
        operation: 'materialize',
        note: 'real PIE projection materializes byte-stably with every independently observed diff explained',
      })
      console.info(
        `[warzone-live] ${candidatePath}: ${info.nodes} nodes, ${info.meshes} meshes, ` +
          `${info.primitives} primitives, ${refsInfo.references} texture refs, ` +
          `${animationInfo.clips} ANIMOBJECT clips; UVM ${verdict.bytes.byteLength} bytes, ` +
          `exact=${verdict.exact}, receipt=${verdict.receipt.diff.length}; summary=${JSON.stringify(summary)}`,
      )
    } finally {
      await nested.result.session.dispose()
    }
  }, 300_000)
})
