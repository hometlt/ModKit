import { describe, expect, it, vi } from 'vitest'
import { OperationCancelledError } from '@modkit/core'
import {
  revisionId,
  type Codec,
  type JsonValue,
  type OperationDecl,
  type OperationOutput,
  type PermissionGrant,
} from '@modkit/sdk'
import { assembleSubjectDescriptor, createAssetSession } from '@modkit/host'
import { resolvedDescriptorWire } from './fixtures/descriptor.js'

const operations = [
  {
    id: 'example.codec/session.good',
    handlerId: 'good',
    state: 'available',
    mutatesSource: false,
  },
  {
    id: 'example.codec/session.disabled',
    handlerId: 'disabled',
    state: 'disabled',
    reason: 'disabled by fixture',
    mutatesSource: false,
  },
  {
    id: 'example.codec/session.dependency',
    handlerId: 'dependency',
    state: 'dependency-required',
    reason: 'fixture dependency missing',
    mutatesSource: false,
  },
  {
    id: 'example.codec/session.permission',
    handlerId: 'permission',
    state: 'available',
    mutatesSource: false,
  },
  {
    id: 'example.codec/session.unregistered',
    handlerId: 'unregistered',
    state: 'available',
    mutatesSource: false,
  },
  {
    id: 'example.codec/session.cancel',
    handlerId: 'cancel',
    state: 'available',
    mutatesSource: false,
  },
] as const

async function fixture() {
  const descriptor = await assembleSubjectDescriptor(resolvedDescriptorWire(operations))
  const declarations: OperationDecl[] = descriptor.operations.map(operation => ({
    id: operation.id,
    handlerId: operation.handlerId,
    mutatesSource: operation.mutatesSource,
    ...(operation.handlerId === 'permission' ? { requiredPermissions: ['network'] as const } : {}),
    outputKinds: ['json'],
  }))
  const grant: PermissionGrant = {
    id: 'session-grant',
    classes: ['read-source'],
  }
  const release = vi.fn(async () => undefined)
  const handlers = new Map<string, (input: JsonValue) => Promise<OperationOutput>>([
    [
      'good',
      async input => ({
        kind: 'json',
        value: input,
      }),
    ],
    ['permission', async () => ({ kind: 'json', value: null })],
    [
      'cancel',
      async () => {
        throw new OperationCancelledError()
      },
    ],
  ])
  const managed = createAssetSession({
    revision: descriptor.revision,
    descriptor,
    operationDeclarations: declarations,
    permissionGrant: grant,
    handlers,
    openDataSource: async () => {
      throw new Error('fixture has no data sources')
    },
    release: [release],
  })
  return { descriptor, managed, release }
}

describe('A-3 asset and operation sessions', () => {
  it('makes all eight operation rejection reasons reachable and dispatches owned JSON', async () => {
    const { managed } = await fixture()
    const invoke = managed.session.operations().invoke.bind(managed.session.operations())

    expect(await invoke('missing', null)).toMatchObject({
      state: 'rejected',
      reason: 'not-declared',
    })
    expect(await invoke('disabled', null)).toMatchObject({ state: 'rejected', reason: 'disabled' })
    expect(await invoke('dependency', null)).toMatchObject({
      state: 'rejected',
      reason: 'dependency-required',
    })
    expect(await invoke('permission', null)).toMatchObject({
      state: 'rejected',
      reason: 'permission-missing',
    })
    expect(await invoke('good', { value: 1n } as never)).toMatchObject({
      state: 'rejected',
      reason: 'input-not-serializable',
    })
    expect(await invoke('unregistered', null)).toMatchObject({
      state: 'rejected',
      reason: 'handler-unregistered',
    })
    expect(await invoke('cancel', null)).toMatchObject({ state: 'rejected', reason: 'cancelled' })

    const input = { nested: ['owned'] }
    const result = await invoke('good', input)
    input.nested[0] = 'mutated-after-dispatch'
    expect(result).toEqual({
      state: 'ok',
      output: { kind: 'json', value: { nested: ['owned'] } },
      diagnostics: [],
    })

    managed.updateSourceRevision(revisionId('content-hash.sha256:session-2'))
    expect(await invoke('good', null)).toMatchObject({
      state: 'rejected',
      reason: 'stale-revision',
    })
  })

  it('publishes descriptor/state events and releases resources once on double dispose', async () => {
    const { managed, release } = await fixture()
    const descriptor = await managed.session.descriptor()
    const events = managed.session.events()[Symbol.asyncIterator]()
    expect(await events.next()).toEqual({
      value: { kind: 'descriptor', descriptor },
      done: false,
    })
    const staleEvent = events.next()
    managed.updateSourceRevision(revisionId('content-hash.sha256:session-2'))
    expect(await staleEvent).toMatchObject({ value: { kind: 'diagnostic' }, done: false })
    expect(await events.next()).toEqual({
      value: { kind: 'state', state: 'stale-revision' },
      done: false,
    })

    await Promise.all([managed.session.dispose(), managed.session.dispose()])
    expect(release).toHaveBeenCalledTimes(1)
    expect(managed.session.state()).toBe('disposed')
  })

  it('executes the probe → planInput → open → session → dispose lifecycle without leaks', async () => {
    const { managed, release } = await fixture()
    const codec: Codec = {
      probe: async request => ({
        codecId: 'example.codec/session',
        confidence: request.source.kind === 'bytes' ? 1 : 0,
        evidence: [{ kind: 'structure', weight: 1 }],
        requiredRanges: [],
      }),
      planInput: async source => {
        if (source.kind === 'derived') throw new Error('fixture expects a physical candidate')
        return {
          originKind: 'single',
          candidate: { bindingId: source.ref.id, role: 'content', ownership: 'owned' },
          requirements: [],
        }
      },
      open: async () => managed.session,
    }
    const source = {
      kind: 'bytes' as const,
      ref: { id: 'candidate', uri: 'memory://fixtures/session.bin' },
      revision: revisionId('content-hash.sha256:session-1'),
      read: async () => new Uint8Array([1]),
      async *stream() {
        yield new Uint8Array([1])
      },
    }
    const detection = await codec.probe({
      source,
      plan: { kind: 'bytes', ranges: [], maxBytes: 1 },
    })
    expect(detection.confidence).toBe(1)
    expect(await codec.planInput?.(source, detection)).toMatchObject({ originKind: 'single' })
    const session = await codec.open({} as never, 'inspect', {
      maxInputBytes: 1n,
      maxDepth: 1,
      maxNodes: 1,
      maxScalarBytes: 1,
      maxDiagnostics: 1,
    })
    await session.dispose()
    await session.dispose()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
