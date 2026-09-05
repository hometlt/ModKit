import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createKnowledgeCatalog,
  createSubjectEditing,
  openSubject,
  subjectOpenSnapshot,
} from '@modkit/host'
import {
  createFileEditingBackend,
  loadExtensionDirectory,
  openFileArtifactSource,
} from '@modkit/host/node'
import type {
  FidelityEvidence,
  PermissionGrant,
  ResolvedAssetDescriptor,
  ResourceBudget,
  SubjectFactsSource,
  TreeDataSource,
} from '@modkit/sdk'
import {
  GENERIC_SURFACE_ANCHORS,
  runGenericSurfaceSmoke,
  type GenericSurfaceAnchor,
  type SurfaceSmokeClaim,
  type SurfaceSmokeExecution,
} from '@modkit/testkit'
import { loadSubjectCardSections } from '@modkit/ui/card'
import {
  createFieldEditorRegistry,
  editOffer,
  mountFieldEditor,
  type FieldEditorModuleV1,
} from '@modkit/ui/field-editor'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { surfaceClaimsForCodec } from '../../../scripts/migration/lib/surface-matrix.mjs'
import { createModkitMcpServer, type McpEnvelope, type ModkitMcpHostPort } from '../src/index.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtureRoot = join(repoRoot, 'packages', 'testkit', 'fixtures', 'extension-surface-sample')
const fixtureSource = join(fixtureRoot, 'sample.surface')
const scratch = mkdtempSync(join(tmpdir(), 'modkit-extension-surface-'))
const subjectPath = join(scratch, 'sample.surface')
const grant: PermissionGrant = {
  id: 'extension-surface-smoke',
  classes: ['read-source', 'write-source'],
}
const budget: ResourceBudget = {
  maxInputBytes: 1_048_576n,
  maxDepth: 32,
  maxNodes: 1_024,
  maxScalarBytes: 1_048_576,
  maxDiagnostics: 100,
}
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        async release() {
          return undefined
        },
      }
    },
  },
])

let inventory: Awaited<ReturnType<typeof buildInventory>>
let codecSpec: Readonly<Record<string, unknown>>

beforeAll(async () => {
  copyFileSync(fixtureSource, subjectPath)
  const input = await loadExtensionDirectory(fixtureRoot)
  inventory = await buildInventory(
    [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
    createHostContributionContractRegistry(),
  )
  const codec = inventory.extensions[0]?.contributions.find(
    contribution => contribution.manifest?.id === 'org.example/surface-sample-codec',
  )
  if (codec?.manifest === undefined) throw new Error('fixture codec was not inventoried')
  codecSpec = codec.manifest.spec as Readonly<Record<string, unknown>>
})

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

async function openFixture() {
  const result = await openSubject({
    inventory,
    source: await openFileArtifactSource(subjectPath),
    path: subjectPath,
    mediaType: 'application/x-modkit-surface-sample',
    intent: 'full',
    target,
    grant,
    executionBackends,
    budget,
  })
  if (result.state !== 'opened') {
    throw new Error(`fixture did not open: ${result.reason}: ${JSON.stringify(result.diagnostics)}`)
  }
  if (result.descriptor.interpretation !== 'codec')
    throw new Error('opened fixture has no codec interpretation')
  return result as typeof result & { readonly descriptor: ResolvedAssetDescriptor }
}

const passed = (evidence: string): SurfaceSmokeExecution => ({
  executed: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
  evidence: [evidence],
})

const ensure = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}

function claims(): readonly SurfaceSmokeClaim[] {
  const projected = surfaceClaimsForCodec(codecSpec)
  return GENERIC_SURFACE_ANCHORS.map(anchor => ({
    anchor,
    applicable: projected[anchor].applicable,
    sources: projected[anchor].sources,
  }))
}

function fidelityEvidence(artifactDigest: string): FidelityEvidence {
  return {
    roundTrip: 'byte-identical',
    preservesUnknownData: true,
    evidenceId: 'extension-surface-sample-no-op-v1',
    corpusId: 'packages/testkit/fixtures/extension-surface-sample/sample.surface',
    corpusDigest: `sha256:${createHash('sha256').update(readFileSync(fixtureSource)).digest('hex')}`,
    conformanceProfile: 'modkit/codec-contribution-v1' as never,
    writer: {
      providerId: 'org.example/surface-sample-codec',
      providerVersion: '1.0.0',
      artifactDigest,
      formatId: 'surface-sample',
      representationId: 'source',
    },
    optionsFingerprint: 'options:none',
    inputClass: 'surface-sample-v1',
    provenAt: '2026-09-05T00:00:00Z',
  }
}

async function mcpInspect(): Promise<SurfaceSmokeExecution> {
  const knowledge = createKnowledgeCatalog(inventory)
  const opened = new Set<Awaited<ReturnType<typeof openFixture>>>()
  const host: ModkitMcpHostPort = {
    inventory,
    knowledge,
    roots: [scratch],
    extensionCoordinates: ['org.example/extension-surface-sample'],
    executionProfiles: ['trusted-in-process'],
    supportedExtensions: ['surface'],
    async open() {
      const result = await openFixture()
      opened.add(result)
      return {
        snapshot: subjectOpenSnapshot({
          result,
          sessionId: () => 'surface-smoke-mcp-session',
          diagnostics: result.diagnostics,
        }),
        session: result.session,
        async close() {
          if (!opened.delete(result)) return
          await result.session.dispose()
        },
      }
    },
    async close() {
      await Promise.all([...opened].map(result => result.session.dispose()))
      opened.clear()
    },
  }
  const app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'extension-surface-smoke', version: '1.0.0' })
  try {
    await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
    const openedEnvelope = (
      await client.callTool({ name: 'modkit.open_subject', arguments: { path: subjectPath } })
    ).structuredContent as McpEnvelope
    const handle = (openedEnvelope.data as { readonly handle?: unknown }).handle
    ensure(typeof handle === 'string', 'MCP did not return an opaque handle')
    const inspected = (await client.callTool({ name: 'modkit.inspect', arguments: { handle } }))
      .structuredContent as McpEnvelope
    ensure(inspected.trust === 'untrusted-data', 'MCP inspect did not mark data untrusted')
    ensure(JSON.stringify(inspected.data).includes('alpha'), 'MCP inspect omitted fixture metadata')
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
    return passed('mcp:modkit.open_subject->modkit.inspect->modkit.close_subject')
  } finally {
    await Promise.allSettled([client.close(), app.dispose(), host.close()])
  }
}

describe('P7/P8 extension surface foundation', () => {
  it('discovers the removable fixture without registering host or UI switch statements', async () => {
    expect(inventory.diagnostics).toEqual([])
    expect(inventory.extensions).toHaveLength(1)
    expect(
      inventory.extensions[0]?.contributions.map(contribution => ({
        id: contribution.manifest?.id,
        inventoryEligible: contribution.inventoryEligible,
      })),
    ).toEqual([
      { id: 'org.example/surface-sample-codec', inventoryEligible: true },
      { id: 'org.example/surface-name-field-editor', inventoryEligible: true },
      { id: 'org.example/surface-sample-kind', inventoryEligible: true },
      { id: 'org.example/surface-sample-panel', inventoryEligible: true },
    ])
    const withoutFixture = await buildInventory([], createHostContributionContractRegistry())
    expect(withoutFixture.extensions).toEqual([])
    expect(withoutFixture.diagnostics).toEqual([])
  })

  it('discovers, renders and validates a contributed custom field editor', async () => {
    const result = await openFixture()
    const contribution = inventory.extensions[0]?.contributions.find(
      item => item.manifest?.id === 'org.example/surface-name-field-editor',
    )
    if (contribution?.manifest === undefined)
      throw new Error('custom field editor was not inventoried')
    const entrypoint = contribution.manifest.runtimeVariants[0]?.entrypoint
    if (entrypoint === undefined) throw new Error('custom field editor published no entrypoint')
    const imported = (await import(pathToFileURL(join(fixtureRoot, entrypoint)).href)) as {
      readonly default: FieldEditorModuleV1
    }
    const registry = createFieldEditorRegistry(
      [
        {
          spec: contribution.manifest.spec as never,
          module: imported.default,
        },
      ],
      'test',
    )
    try {
      const offer = editOffer(result.descriptor, { editable: true, fieldEditors: registry })
      expect(offer.unsupported).toEqual([])
      expect(offer.forms.map(form => form.id)).toEqual(['surface-sample-set-name'])
      const form = offer.forms[0]
      const field = form?.fields[0]
      if (form === undefined || field === undefined)
        throw new Error('custom field form was not resolved')

      const target = {} as { rendered?: { kind: string; value: string } }
      const controller = new AbortController()
      const control = await mountFieldEditor(
        target as unknown as HTMLElement,
        field,
        controller.signal,
        registry,
        'org.example/surface-name-editor',
      )
      expect(target.rendered).toEqual({ kind: 'surface-name', value: 'alpha' })
      expect(control.read()).toBe('alpha')
      expect(control.validate()).toBeUndefined()
      if (target.rendered === undefined) throw new Error('custom editor did not render')
      target.rendered.value = ''
      expect(control.validate()).toBe('surface name is required')
      target.rendered.value = 'beta'

      const request = form.build(new Map([['value', control.read()]]))
      expect(request).toEqual({ groupId: 'identity', key: 'name', value: 'beta' })
      const invoked = await result.session.operations().invoke(form.handlerId, request)
      expect(invoked.state).toBe('ok')
      if (invoked.state !== 'ok') throw new Error('custom field edit was rejected')
      const editing = createSubjectEditing({
        opened: result,
        grant,
        backendFor: () => createFileEditingBackend({ roots: [scratch] }),
        evidenceFor: () =>
          fidelityEvidence(
            inventory.extensions[0]?.contributions.find(
              item => item.manifest?.id === 'org.example/surface-sample-codec',
            )?.record?.artifactDigest ?? '',
          ),
      })
      const plan = editing.planFromOperation(invoked.output)
      const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
      expect(prepared.state).toBe('ready')
      if (prepared.state !== 'ready') throw new Error('custom field edit did not prepare')
      expect(
        await editing.coordinator.commit(prepared.prepared, { grant: editing.grantSnapshot }),
      ).toMatchObject({ state: 'committed' })
      const reopened = await openFixture()
      try {
        expect(reopened.descriptor.metadata[0]?.entries[0]?.value).toBe('beta')
      } finally {
        await reopened.session.dispose()
      }
      await control.unmount?.()
      expect(target.rendered).toBeUndefined()
    } finally {
      await result.session.dispose()
      copyFileSync(fixtureSource, subjectPath)
    }
  })

  it('executes every applicable inventory anchor and commits a byte-identical no-op edit', async () => {
    const result = await openFixture()
    const artifactDigest = inventory.extensions[0]?.contributions.find(
      contribution => contribution.manifest?.id === 'org.example/surface-sample-codec',
    )?.record?.artifactDigest
    if (artifactDigest === undefined) throw new Error('fixture codec has no inventory attestation')
    const original = readFileSync(subjectPath)
    const executors: Partial<
      Record<GenericSurfaceAnchor, () => Promise<SurfaceSmokeExecution> | SurfaceSmokeExecution>
    > = {
      sections: () => {
        ensure(result.descriptor.metadata.length > 0, 'metadata sections are empty')
        return passed('descriptor.metadata:identity')
      },
      tree: async () => {
        const lease = await result.session.dataSource('common.view/tree-data-source', 1)
        try {
          const tree = lease.value as TreeDataSource
          const children = await tree.children(await tree.root(), { limit: 16 })
          ensure(children.items.length > 0, 'tree has no children')
          return passed(`tree:children=${children.items.length}`)
        } finally {
          await lease.release()
        }
      },
      hex: async () => {
        const lease = await result.session.dataSource('common.view/byte-range-source', 1)
        try {
          const source = lease.value as {
            size(): Promise<bigint>
            read(offset: bigint, length: number): Promise<Uint8Array>
          }
          const size = await source.size()
          const bytes = await source.read(0n, Number(size))
          ensure(bytes.byteLength > 0, 'hex source returned zero bytes')
          return passed(`hex:bytes=${bytes.byteLength}`)
        } finally {
          await lease.release()
        }
      },
      card: async () => {
        const lease = await result.session.dataSource('common.view/subject-facts-source', 1)
        try {
          const sections = await loadSubjectCardSections(lease.value as SubjectFactsSource)
          ensure(sections.length > 0, 'card projection returned no sections')
          return passed(`card:sections=${sections.length}`)
        } finally {
          await lease.release()
        }
      },
      'mcp-inspect': mcpInspect,
      script: () => {
        ensure(
          (result.descriptor.metadata[0]?.entries.length ?? 0) > 0,
          'script metadata projection is empty',
        )
        return passed('script:open().metadata() projection')
      },
      'no-op-edit': async () => {
        const invoked = await result.session.operations().invoke('set-name', {
          groupId: 'identity',
          key: 'name',
          value: 'alpha',
        })
        ensure(
          invoked.state === 'ok' && invoked.output.kind === 'edit-plan',
          'edit operation returned no plan',
        )
        if (invoked.state !== 'ok') throw new Error('edit operation was rejected')
        const editing = createSubjectEditing({
          opened: result,
          grant,
          backendFor: () => createFileEditingBackend({ roots: [scratch] }),
          evidenceFor: () => fidelityEvidence(artifactDigest),
        })
        const plan = editing.planFromOperation(invoked.output)
        const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
        ensure(prepared.state === 'ready', 'no-op edit did not prepare')
        if (prepared.state !== 'ready') throw new Error('no-op edit did not prepare')
        const committed = await editing.coordinator.commit(prepared.prepared, {
          grant: editing.grantSnapshot,
        })
        ensure(committed.state === 'committed', 'no-op edit did not commit')
        ensure(
          Buffer.compare(original, readFileSync(subjectPath)) === 0,
          'no-op edit changed bytes',
        )
        const reopened = await openFixture()
        try {
          ensure(
            reopened.descriptor.interpretation === 'codec' &&
              reopened.descriptor.metadata[0]?.entries[0]?.value === 'alpha',
            'reopen did not preserve metadata',
          )
        } finally {
          await reopened.session.dispose()
        }
        return passed('edit.field:plan->prepare->commit->reopen:byte-identical')
      },
    }
    try {
      const report = await runGenericSurfaceSmoke({
        descriptor: result.descriptor,
        claims: claims(),
        executors,
      })
      expect(report.verdict, report.problems.join('\n')).toBe('pass')
      expect(report.anchors.filter(anchor => anchor.applicable)).toHaveLength(7)
      expect(
        report.anchors
          .filter(anchor => anchor.applicable)
          .every(anchor => (anchor.execution?.executed ?? 0) > 0),
      ).toBe(true)
    } finally {
      await result.session.dispose()
    }
  })

  it('fails closed on a missing claim, zero execution and a skipped check', async () => {
    const result = await openFixture()
    try {
      const baseline = Object.fromEntries(
        GENERIC_SURFACE_ANCHORS.map(anchor => [anchor, () => passed(`fixture:${anchor}`)]),
      )
      const missing = await runGenericSurfaceSmoke({
        descriptor: result.descriptor,
        claims: claims().filter(claim => claim.anchor !== 'tree'),
        executors: baseline,
      })
      expect(missing.verdict).toBe('fail')
      expect(missing.problems).toContain('tree: missing claim')

      const zero = await runGenericSurfaceSmoke({
        descriptor: result.descriptor,
        claims: claims(),
        executors: {
          ...baseline,
          tree: () => ({ executed: 0, passed: 0, failed: 0, skipped: 0, evidence: ['zero'] }),
        },
      })
      expect(zero.verdict).toBe('fail')
      expect(zero.problems).toContain('tree: executed zero checks')

      const skipped = await runGenericSurfaceSmoke({
        descriptor: result.descriptor,
        claims: claims(),
        executors: {
          ...baseline,
          tree: () => ({ executed: 1, passed: 0, failed: 0, skipped: 1, evidence: ['skip'] }),
        },
      })
      expect(skipped.verdict).toBe('fail')
      expect(skipped.problems).toContain('tree: 1 check(s) skipped')
    } finally {
      await result.session.dispose()
    }
  })
})
