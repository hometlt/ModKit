import { describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OperationCancelledError } from '@modkit/core'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  invokeContainerPack,
  openSubject,
  parsePolicyLock,
} from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import { createCompanionInputResolver } from '../src/input-resolution.js'
import { createSubjectEditing } from '../src/subject-editing.js'
import {
  revisionId,
  type ArtifactByteSource,
  type ArtifactNamespaceSource,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkit/sdk'

declare global {
  var __x3ContainerComposition:
    | {
        carrierPackCalls: number
        carrierRawCalls: number
        semanticRawCalls: number
        entryRefReleases: number
        carrierExtractCalls: number
      }
    | undefined
  var __x3ContainerAbortController: AbortController | undefined
  var __x3ContainerDisablePack: boolean | undefined
  var __x3ContainerAbortDuringExtract: boolean | undefined
  var __x3ContainerFailExtract: boolean | undefined
  var __x3ContainerSkipInspectRead: boolean | undefined
  var __x3ContainerDeclaredEntrySize: bigint | undefined
  var __x3ContainerNoEntries: boolean | undefined
  var __x3ContainerUnlisted: boolean | undefined
  var __x3ContainerMaliciousPlan: 'target' | 'revision' | 'source-uri' | undefined
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

function source(
  name = 'map.car',
  bytes: Uint8Array = new TextEncoder().encode('CARR-outer-secret'),
): ArtifactByteSource {
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

async function harness(
  options: {
    readonly abortDuringExtract?: boolean
    readonly declaredEntrySize?: bigint
    readonly disablePack?: boolean
    readonly failExtract?: boolean
    readonly skipInspectRead?: boolean
    readonly noEntries?: boolean
  } = {},
) {
  globalThis.__x3ContainerComposition = {
    carrierPackCalls: 0,
    carrierRawCalls: 0,
    semanticRawCalls: 0,
    entryRefReleases: 0,
    carrierExtractCalls: 0,
  }
  globalThis.__x3ContainerDisablePack = options.disablePack ?? false
  globalThis.__x3ContainerAbortDuringExtract = options.abortDuringExtract ?? false
  globalThis.__x3ContainerFailExtract = options.failExtract ?? false
  globalThis.__x3ContainerSkipInspectRead = options.skipInspectRead ?? false
  globalThis.__x3ContainerDeclaredEntrySize = options.declaredEntrySize
  globalThis.__x3ContainerNoEntries = options.noEntries ?? false
  globalThis.__x3ContainerMaliciousPlan = undefined
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
  it('resolves semantic resources inside the carrier without using an outer filesystem origin', async () => {
    const built = await harness()
    let outerReads = 0
    const result = await openSubject({
      inventory: built.inventory,
      source: source(),
      path: 'map.car',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-resources', classes: ['read-source', 'write-source'] },
      executionBackends: built.executionBackends,
      budget,
      resolveInput: createCompanionInputResolver({
        primaryLogicalId: 'map.car',
        caseSensitivity: 'sensitive',
        scopes: ['sibling-directory'],
        async *enumerate() {
          outerReads++
          yield { logicalId: 'world.bin' }
        },
        async open() {
          outerReads++
          throw new Error('outer resources must not serve the semantic namespace')
        },
      }),
    })
    if (result.state !== 'opened' || result.resources === undefined)
      throw new Error('semantic resource origin missing')
    const resources = result.resources
    try {
      const world = await resources.resolve({
        id: 'world',
        logicalId: 'Base.SC2Data/world.bin',
        role: 'buffer',
        scopes: ['current-mount'],
      })
      if (world.state !== 'resolved' || world.lease.value.kind !== 'bytes')
        throw new Error('world missing from carrier')
      expect(new TextDecoder().decode(await world.lease.value.read(0n, 9))).toBe('old-world')
      expect(outerReads).toBe(0)
      expect(world.lease.value.ref.uri).toMatch(/^test-entry:/)
    } finally {
      await result.session.dispose()
    }
    expect(resources.state()).toBe('disposed')
  })

  it('opens an entry the listing cannot name through the carrier lookup', async () => {
    globalThis.__x3ContainerUnlisted = true
    try {
      const { result } = await openedComposition()
      try {
        expect(result.selected.contributionId).toBe('org.example/test-semantic')
      } finally {
        await result.session.dispose()
      }
    } finally {
      globalThis.__x3ContainerUnlisted = false
    }
  })

  it('passes a bounded carrier preamble to the root semantic namespace', async () => {
    const { result } = await openedComposition()
    try {
      const inspected = await result.session.operations().invoke('inspect', null)
      expect(inspected).toMatchObject({
        state: 'ok',
        output: { kind: 'json', value: { preamble: 'carrier-preamble' } },
      })
    } finally {
      await result.session.dispose()
    }
  })

  it('invokes typed creation through inventory on the application-owned empty target and reopens', async () => {
    const built = await harness({ noEntries: true })
    const targetSource = source('created.newcar', new Uint8Array())
    const opened = await openSubject({
      inventory: built.inventory,
      source: targetSource,
      path: 'created.newcar',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-create', classes: ['read-source', 'write-source'] },
      executionBackends: built.executionBackends,
      budget,
    })
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error(`empty target did not open: ${opened.reason}`)
    expect(opened.selected.contributionId).toBe('org.example/test-carrier')
    const packed = await invokeContainerPack(opened, {
      schemaVersion: 1,
      mode: 'create',
      expectedContainerRevision: targetSource.revision,
      files: [{ name: 'hello.txt', bytesBase64: 'aGVsbG8=' }],
    })
    expect(packed.state).toBe('ok')
    if (packed.state !== 'ok') throw new Error('container create was rejected')
    const edit = packed.output.plan.edits[0]
    if (edit?.operation !== 'replace' || edit.payload.kind !== 'inline') {
      throw new Error('container create did not return an inline replacement')
    }
    expect(edit.source).toEqual(targetSource.ref)
    expect(edit.range).toEqual({ kind: 'bytes', offset: 0n, length: 0n })
    await opened.session.dispose()

    const reopened = await openSubject({
      inventory: built.inventory,
      source: source('created.newcar', edit.payload.bytes),
      path: 'created.newcar',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-reopen', classes: ['read-source'] },
      executionBackends: built.executionBackends,
      budget,
    })
    expect(reopened.state).toBe('opened')
    if (reopened.state === 'opened') await reopened.session.dispose()
  })

  it('refuses mixed create/replace input before dispatching the provider handler', async () => {
    const built = await harness({ noEntries: true })
    const targetSource = source('invalid-create.newcar', new Uint8Array())
    const opened = await openSubject({
      inventory: built.inventory,
      source: targetSource,
      path: 'invalid-create.newcar',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-create-invalid', classes: ['read-source', 'write-source'] },
      executionBackends: built.executionBackends,
      budget,
    })
    if (opened.state !== 'opened') throw new Error('empty target did not open')
    await expect(
      invokeContainerPack(opened, {
        schemaVersion: 1,
        mode: 'create',
        expectedContainerRevision: targetSource.revision,
        files: [],
        replacements: [],
      } as never),
    ).rejects.toMatchObject({ code: 'x3.host/container-pack-input-invalid' })
    expect(globalThis.__x3ContainerComposition?.carrierPackCalls).toBe(0)

    await expect(
      invokeContainerPack(opened, {
        schemaVersion: 1,
        mode: 'create',
        expectedContainerRevision: revisionId('content-hash.sha256:stale-container'),
        files: [],
      }),
    ).rejects.toMatchObject({ code: 'x3.host/container-pack-stale-revision' })
    expect(globalThis.__x3ContainerComposition?.carrierPackCalls).toBe(0)
    for (const bytesBase64 of ['AB==', 'AAB=']) {
      await expect(
        invokeContainerPack(opened, {
          schemaVersion: 1,
          mode: 'create',
          expectedContainerRevision: targetSource.revision,
          files: [{ name: 'noncanonical.bin', bytesBase64 }],
        }),
      ).rejects.toMatchObject({ code: 'x3.host/container-pack-input-invalid' })
    }
    expect(globalThis.__x3ContainerComposition?.carrierPackCalls).toBe(0)
    await opened.session.dispose()
  })

  it('rejects provider plans aimed outside the application source or open revision', async () => {
    for (const malicious of ['target', 'revision', 'source-uri'] as const) {
      const built = await harness({ noEntries: true })
      const targetSource = source(`malicious-${malicious}.newcar`, new Uint8Array())
      const opened = await openSubject({
        inventory: built.inventory,
        source: targetSource,
        path: `malicious-${malicious}.newcar`,
        intent: 'full',
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        grant: { id: 'container-create-malicious', classes: ['read-source', 'write-source'] },
        executionBackends: built.executionBackends,
        budget,
      })
      if (opened.state !== 'opened') throw new Error('empty target did not open')
      globalThis.__x3ContainerMaliciousPlan = malicious
      await expect(
        invokeContainerPack(opened, {
          schemaVersion: 1,
          mode: 'create',
          expectedContainerRevision: targetSource.revision,
          files: [],
        }),
      ).rejects.toMatchObject({ code: 'x3.host/edit-plan-subject-mismatch' })
      expect(globalThis.__x3ContainerComposition?.carrierPackCalls).toBe(1)
      globalThis.__x3ContainerMaliciousPlan = undefined
      await opened.session.dispose()
    }
  })

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
    expect(globalThis.__x3ContainerComposition?.carrierExtractCalls).toBe(1)
    expect(result.candidates.some(item => item.contributionId.endsWith('-other'))).toBe(false)

    const beforeDispose = releases.length
    await result.session.operations().dispose()
    expect(result.session.state()).toBe('live')
    await expect(result.session.descriptor()).resolves.toMatchObject({
      identity: { formatId: 'test-semantic' },
    })
    await expect(result.session.operations().invoke('edit-world', null)).resolves.toMatchObject({
      state: 'rejected',
      reason: 'cancelled',
    })
    expect(releases).toHaveLength(beforeDispose)
    await result.session.dispose()
    expect(releases.slice(beforeDispose)).toEqual(['semantic.mjs', 'carrier.mjs'])
  })

  it('keeps carrier entry extraction lazy and memoized behind byte access', async () => {
    const built = await harness({ skipInspectRead: true, failExtract: true })
    const opened = await openSubject({
      inventory: built.inventory,
      source: source(),
      path: 'map.car',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
      executionBackends: built.executionBackends,
      budget,
    })
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error(`composition did not open: ${opened.reason}`)
    expect(globalThis.__x3ContainerComposition?.carrierExtractCalls).toBe(0)

    globalThis.__x3ContainerFailExtract = false
    const read = await opened.session.operations().invoke('read-lazy', null)
    expect(read).toMatchObject({
      state: 'ok',
      output: { kind: 'json', value: { first: 9, second: 9, streamed: 9 } },
    })
    expect(globalThis.__x3ContainerComposition?.carrierExtractCalls).toBe(1)
    await opened.session.dispose()
  })

  it('enforces an entry scalar budget before lazy carrier extraction', async () => {
    const built = await harness({ skipInspectRead: true })
    const opened = await openSubject({
      inventory: built.inventory,
      source: source(),
      path: 'map.car',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
      executionBackends: built.executionBackends,
      budget: { ...budget, maxScalarBytes: 8 },
    })
    if (opened.state !== 'opened') throw new Error('scalar-budget fixture did not open')
    await expect(opened.session.operations().invoke('read-lazy', null)).rejects.toMatchObject({
      code: 'x3.host/container-entry-scalar-budget-exceeded',
    })
    expect(globalThis.__x3ContainerComposition?.carrierExtractCalls).toBe(0)
    await opened.session.dispose()
  })

  it('propagates cancellation and rejects a carrier entry size mismatch on first read', async () => {
    const cancelled = await harness({ skipInspectRead: true, abortDuringExtract: true })
    const cancelledOpen = await openSubject({
      inventory: cancelled.inventory,
      source: source(),
      path: 'map.car',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
      executionBackends: cancelled.executionBackends,
      budget,
    })
    if (cancelledOpen.state !== 'opened') throw new Error('cancel fixture did not open')
    const controller = new AbortController()
    globalThis.__x3ContainerAbortController = controller
    await expect(
      cancelledOpen.session.operations().invoke('read-lazy', null, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OperationCancelledError)
    expect(globalThis.__x3ContainerComposition?.carrierExtractCalls).toBe(1)
    globalThis.__x3ContainerAbortController = undefined
    await cancelledOpen.session.dispose()

    const mismatched = await harness({ skipInspectRead: true, declaredEntrySize: 10n })
    const mismatchedOpen = await openSubject({
      inventory: mismatched.inventory,
      source: source(),
      path: 'map.car',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
      executionBackends: mismatched.executionBackends,
      budget,
    })
    if (mismatchedOpen.state !== 'opened') throw new Error('size fixture did not open')
    await expect(
      mismatchedOpen.session.operations().invoke('read-lazy', null),
    ).rejects.toMatchObject({ code: 'x3.host/container-entry-size-mismatch' })
    await mismatchedOpen.session.dispose()
  })

  it('adds carrier-only inspect facts without overriding semantic summary fields', async () => {
    const { result } = await openedComposition()
    const inspected = await result.session.operations().invoke('inspect', null)
    expect(inspected).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          carrierVersion: 7,
          format: 'semantic',
          entries: 2,
          world: 'old-world',
        },
      },
    })
    await result.session.dispose()
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
    // the subject is written as its carrier: the editing facade accepts the outer plan
    expect(result.carrier?.selected.contributionId).toBe('org.example/test-carrier')
    const editing = createSubjectEditing({
      opened: result,
      grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
      backendFor: () => undefined,
      evidenceFor: () => undefined,
    })
    expect(editing.planFromOperation(edited.output).edits).toHaveLength(1)
    await editing.dispose()
    await result.session.dispose()
  })

  it('lists and extracts through the carrier when the semantic codec has no namespace', async () => {
    const { result } = await openedComposition()
    try {
      const descriptor = await result.session.descriptor()
      expect(
        descriptor.dataSources.some(item => item.contract === 'common.view/namespace-entry-source'),
      ).toBe(true)
      const extract = descriptor.operations.find(item => item.id === 'container.extract')
      expect(extract?.handlerId).toBe('x3.host/carrier-container-extract')
      const lease = await result.session.dataSource('common.view/namespace-entry-source', 1)
      const page = await (lease.value as NamespaceEntrySource).list('', { limit: 100 })
      await lease.release()
      const world = page.items.find(item => item.path.endsWith('world.bin'))
      if (world === undefined) throw new Error('the carrier listed no world.bin')
      const extracted = await result.session
        .operations()
        .invoke(extract!.handlerId, { entryId: world.id })
      if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes')
        throw new Error('the carrier did not extract')
      expect(new TextDecoder().decode(extracted.output.value)).toBe('old-world')
    } finally {
      await result.session.dispose()
    }
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

  it('keeps the generic carrier open when every semantic alias is a no-match', async () => {
    const { inventory, executionBackends, releases } = await harness({ noEntries: true })
    const result = await openSubject({
      inventory,
      source: source(),
      path: 'map.car',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
      executionBackends,
      budget,
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') {
      throw new Error(`generic carrier did not remain open: ${result.reason}`)
    }
    expect(result.selected.contributionId).toBe('org.example/test-carrier')
    expect(result.descriptor).toMatchObject({ identity: { formatId: 'test-carrier' } })
    expect(releases).toContain('semantic.mjs')
    const carrierReleasesBeforeDispose = releases.filter(name => name === 'carrier.mjs').length
    expect(carrierReleasesBeforeDispose).toBe(1)
    await result.session.dispose()
    expect(releases.at(-1)).toBe('carrier.mjs')
    expect(releases.filter(name => name === 'carrier.mjs')).toHaveLength(
      carrierReleasesBeforeDispose + 1,
    )
  })

  it('says so when an invalid semantic alias leaves the file to the bare carrier', async () => {
    // An older SDK rejects a container field it does not know (as it did `assetRoots`): the
    // semantic codec becomes ineligible and the packed file opens as its carrier.
    // A sibling of the fixture, so its relative imports still resolve.
    const copy = mkdtempSync(join(fixture, '..', 'tmp-invalid-alias-'))
    try {
      cpSync(fixture, copy, { recursive: true })
      const manifest = join(copy, 'contributions', 'semantic.json')
      writeFileSync(
        manifest,
        readFileSync(manifest, 'utf8').replace(
          '"container": { "formatId": "test-carrier" }',
          '"container": { "formatId": "test-carrier", "unknownField": [] }',
        ),
      )
      const { executionBackends } = await harness()
      const input = await loadExtensionDirectory(copy)
      const inventory = await buildInventory(
        [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
        createHostContributionContractRegistry(),
      )
      const result = await openSubject({
        inventory,
        source: source(),
        path: 'map.car',
        intent: 'full',
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        grant: { id: 'container-composition', classes: ['read-source'] },
        executionBackends,
        budget,
      })
      expect(result.state).toBe('opened')
      if (result.state !== 'opened') return
      expect(result.selected.contributionId).toBe('org.example/test-carrier')
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'x3.host/candidate-suppressed',
          severity: 'warning',
          message: expect.stringContaining('org.example/test-semantic'),
        }),
      )
      await result.session.dispose()
    } finally {
      rmSync(copy, { recursive: true, force: true })
    }
  })

  it('fails closed when semantic aliases tie instead of returning the generic carrier', async () => {
    const { inventory, executionBackends, releases } = await harness()
    const result = await openSubject({
      inventory,
      source: source('map.other'),
      path: 'map.other',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-composition', classes: ['read-source', 'write-source'] },
      executionBackends,
      budget,
    })
    expect(result).toMatchObject({ state: 'unresolved', reason: 'ambiguous' })
    expect(releases.filter(name => name === 'carrier.mjs')).toHaveLength(2)
    expect(releases).toEqual(
      expect.arrayContaining(['semantic-other.mjs', 'semantic-other-tie.mjs', 'carrier.mjs']),
    )
  })
})

describe('container alias absence is on the record', () => {
  it('says so when no alias codec was in the inventory at open time', async () => {
    const { inventory, executionBackends } = await harness()
    // The shape of "the file was opened before the extension's codecs reached the inventory".
    const withoutAliases = {
      ...inventory,
      extensions: inventory.extensions.map(extension => ({
        ...extension,
        contributions: extension.contributions.filter(
          contribution =>
            (contribution.manifest?.spec as { container?: unknown } | undefined)?.container ===
            undefined,
        ),
      })),
    }
    const result = await openSubject({
      inventory: withoutAliases,
      source: source(),
      path: 'map.car',
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'container-alias-absent', classes: ['read-source', 'write-source'] },
      executionBackends,
      budget,
    })
    expect(result.state).toBe('opened')
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'x3.host/container-alias-none',
          message: expect.stringContaining('map.car'),
        }),
      ]),
    )
    if (result.state === 'opened') await result.session.dispose()
  })

  it('stays quiet when an alias did run and won', async () => {
    const { result } = await openedComposition()
    try {
      expect(result.diagnostics.map(item => item.code)).not.toContain(
        'x3.host/container-alias-none',
      )
    } finally {
      await result.session.dispose()
    }
  })
})
