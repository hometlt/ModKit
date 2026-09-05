import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { OperationCancelledError } from '@modkit/core'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
  parsePolicyLock,
} from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type ArtifactNamespaceSource,
  type ResourceBudget,
} from '@modkit/sdk'

declare global {
  var __x3ContainerComposition:
    | {
        carrierPackCalls: number
        carrierRawCalls: number
        semanticRawCalls: number
        entryRefReleases: number
      }
    | undefined
  var __x3ContainerAbortController: AbortController | undefined
  var __x3ContainerDisablePack: boolean | undefined
}

const fixture = fileURLToPath(
  new URL('./fixtures/subject-open-container-extension/', import.meta.url),
)
const budget: ResourceBudget = {
  maxInputBytes: 1_048_576n,
  maxDepth: 8,
  maxNodes: 64,
  maxScalarBytes: 65_536,
  maxDiagnostics: 32,
  deadlineMs: 10_000,
}

function source(name = 'map.car'): ArtifactByteSource {
  const bytes = new TextEncoder().encode('CARR-outer-secret')
  const uri = `memory://container-composition/${name}`
  return Object.freeze({
    kind: 'bytes' as const,
    ref: Object.freeze({ id: uri, uri }),
    revision: revisionId('content-hash.sha256:test-carrier'),
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number, signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream(range?: { readonly offset: bigint; readonly length?: bigint }) {
      const start = Number(range?.offset ?? 0n)
      const end = range?.length === undefined ? bytes.byteLength : start + Number(range.length)
      yield bytes.slice(start, end)
    },
  })
}

async function harness(options: { readonly disablePack?: boolean } = {}) {
  globalThis.__x3ContainerComposition = {
    carrierPackCalls: 0,
    carrierRawCalls: 0,
    semanticRawCalls: 0,
    entryRefReleases: 0,
  }
  globalThis.__x3ContainerDisablePack = options.disablePack ?? false
  const input = await loadExtensionDirectory(fixture)
  const inventory = await buildInventory(
    [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
    createHostContributionContractRegistry(),
  )
  const releases: string[] = []
  const executionBackends = createExecutionBackendRegistry([
    {
      profile: 'trusted-in-process',
      supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
      async activate(context) {
        return {
          module: (await import(context.entrypoint.href)) as Record<string, unknown>,
          async release() {
            releases.push(context.entrypoint.href.split('/').at(-1) ?? context.entrypoint.href)
          },
        }
      },
    },
  ])
  return { inventory, executionBackends, releases }
}

async function openedComposition() {
  const built = await harness()
  const result = await openSubject({
    inventory: built.inventory,
    source: source(),
    path: 'map.car',
    intent: 'full',
    target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
    grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
    executionBackends: built.executionBackends,
    budget,
  })
  if (result.state !== 'opened') {
    throw new Error(`composition did not open: ${result.reason} ${JSON.stringify(result)}`)
  }
  return { ...built, result }
}

describe('host-owned container composition', () => {
  it('selects the semantic alias through a declared prefix and synthesized directory', async () => {
    const { result, releases } = await openedComposition()
    expect(result.selected.contributionId).toBe('org.example/test-semantic')
    expect(result.descriptor).toMatchObject({
      subjectUri: 'memory://container-composition/map.car',
      origin: { kind: 'namespace' },
      identity: { formatId: 'test-semantic' },
    })
    expect(parsePolicyLock(result.lockText).entries).toEqual([
      expect.objectContaining({
        primary: expect.objectContaining({ contributionId: 'org.example/test-carrier' }),
      }),
    ])
    expect(globalThis.__x3ContainerComposition?.entryRefReleases).toBe(2)

    const beforeDispose = releases.length
    await result.session.operations().dispose()
    await result.session.dispose()
    expect(releases.slice(beforeDispose)).toEqual(['semantic.mjs', 'carrier.mjs'])
  })

  it('turns a semantic entry replacement into a carrier-owned outer edit plan', async () => {
    const { result } = await openedComposition()
    const edited = await result.session.operations().invoke('edit-world', { text: 'new-world' })
    expect(edited.state).toBe('ok')
    if (edited.state !== 'ok' || edited.output.kind !== 'edit-plan') {
      throw new Error('container pack did not return an edit plan')
    }
    const edit = edited.output.plan.edits[0]
    expect(edit).toMatchObject({
      operation: 'replace',
      source: { id: 'memory://container-composition/map.car' },
    })
    if (edit?.operation !== 'replace' || edit.payload.kind !== 'inline') {
      throw new Error('carrier plan did not contain inline outer bytes')
    }
    expect(new TextDecoder().decode(edit.payload.bytes)).toBe('CARR:new-world')
    expect(globalThis.__x3ContainerComposition).toMatchObject({
      carrierPackCalls: 1,
      semanticRawCalls: 0,
    })
    await result.session.dispose()
  })

  it('delegates export.raw to the carrier without invoking semantic raw code', async () => {
    const { result } = await openedComposition()
    const exported = await result.session.operations().invoke('export-raw', null)
    expect(exported.state).toBe('ok')
    if (exported.state !== 'ok' || exported.output.kind !== 'bytes') {
      throw new Error('raw export did not return bytes')
    }
    expect(new TextDecoder().decode(exported.output.value)).toBe('CARR-outer-secret')
    expect(globalThis.__x3ContainerComposition).toMatchObject({
      carrierRawCalls: 1,
      semanticRawCalls: 0,
    })
    await result.session.dispose()
  })

  it('rejects stale entry refs and cancellation before parent pack', async () => {
    const stale = await openedComposition()
    await expect(
      stale.result.session.operations().invoke('edit-world', { stale: true }),
    ).rejects.toMatchObject({ code: 'x3.host/container-entry-edit-plan-invalid' })
    expect(globalThis.__x3ContainerComposition?.carrierPackCalls).toBe(0)
    await stale.result.session.dispose()

    const cancelled = await openedComposition()
    const controller = new AbortController()
    globalThis.__x3ContainerAbortController = controller
    await expect(
      cancelled.result.session
        .operations()
        .invoke('edit-world', { abortBeforePack: true }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OperationCancelledError)
    expect(globalThis.__x3ContainerComposition?.carrierPackCalls).toBe(0)
    globalThis.__x3ContainerAbortController = undefined
    await cancelled.result.session.dispose()
  })

  it('rejects duplicate, unreferenced, malformed, and read-only entry edit plans', async () => {
    for (const input of [
      { duplicateTargets: true },
      { unreferencedTarget: true },
      { malformedTarget: true },
    ]) {
      const opened = await openedComposition()
      await expect(
        opened.result.session.operations().invoke('edit-world', input),
      ).rejects.toMatchObject({ code: 'x3.host/container-entry-edit-plan-invalid' })
      expect(globalThis.__x3ContainerComposition?.carrierPackCalls).toBe(0)
      await opened.result.session.dispose()
    }

    const readOnly = await openedComposition()
    await expect(
      readOnly.result.session.operations().invoke('read-edit', null),
    ).rejects.toMatchObject({ code: 'x3.host/container-entry-edit-plan-invalid' })
    expect(globalThis.__x3ContainerComposition?.carrierPackCalls).toBe(0)
    await readOnly.result.session.dispose()
  })

  it('disposes the opened semantic session before carrier resources on pre-wrap failure', async () => {
    const { inventory, executionBackends, releases } = await harness({ disablePack: true })
    await expect(
      openSubject({
        inventory,
        source: source(),
        path: 'map.car',
        intent: 'full',
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
        executionBackends,
        budget,
      }),
    ).rejects.toMatchObject({ code: 'x3.host/container-pack-unavailable' })
    expect(releases.slice(-2)).toEqual(['semantic.mjs', 'carrier.mjs'])
    expect(globalThis.__x3ContainerComposition?.entryRefReleases).toBeGreaterThan(0)
  })

  it('does not run a container alias for a direct directory namespace', async () => {
    const { inventory, executionBackends } = await harness()
    const uri = 'memory://container-composition/directory'
    const directory: ArtifactNamespaceSource = Object.freeze({
      kind: 'namespace',
      ref: Object.freeze({ id: uri, uri }),
      revision: revisionId('provider-token:directory'),
      async openNamespace() {
        return Object.freeze({
          value: Object.freeze({
            revision: revisionId('provider-token:directory'),
            async *list() {},
            async open() {
              throw new Error('direct directory must not be probed by a container alias')
            },
          }),
          release: async () => undefined,
        })
      },
    })
    const result = await openSubject({
      inventory,
      source: directory,
      path: 'directory',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'direct-directory', classes: ['read-source'] },
      executionBackends,
      budget,
    })
    expect(result.state).toBe('unresolved')
    if (result.state === 'unresolved') expect(result.reason).toBe('no-candidate')
  })
})
