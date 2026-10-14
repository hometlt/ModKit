import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { OperationCancelledError, diagnostic, type Diagnostic } from '@modkit/core'
import {
  revisionId,
  type Codec,
  type JsonValue,
  type OperationDecl,
  type OperationOutput,
  type PermissionGrant,
} from '@modkit/sdk'
import {
  assembleSubjectDescriptor,
  createAssetSession,
  type HostOperationHandler,
} from '@modkit/host'
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

async function diagnosticSession(handler: HostOperationHandler, limit = 2) {
  const descriptor = await assembleSubjectDescriptor(resolvedDescriptorWire([operations[0]]))
  const operation = descriptor.operations[0]
  if (operation === undefined) throw new Error('diagnostic operation is absent')
  return createAssetSession({
    revision: descriptor.revision,
    descriptor,
    maxOperationDiagnostics: limit,
    operationDeclarations: [
      { id: operation.id, handlerId: 'good', mutatesSource: false, outputKinds: ['bytes'] },
    ],
    permissionGrant: { id: 'diagnostics', classes: ['read-source'] },
    handlers: new Map([['good', handler]]),
    openDataSource: async () => {
      throw new Error('not used')
    },
  }).session
}

describe('operation binary output ownership', () => {
  it.each([
    ['Uint8Array', () => Uint8Array.of(1, 2, 3)],
    ['offset Uint8Array', () => Uint8Array.of(90, 1, 2, 3, 91).subarray(1, 4)],
    ['Buffer', () => Buffer.from([1, 2, 3])],
    ['offset Buffer', () => Buffer.from([90, 1, 2, 3, 91]).subarray(1, 4)],
  ] as const)(
    'copies the visible range of %s independently in both directions',
    async (_name, create) => {
      const producer = create()
      const session = await diagnosticSession(async () => ({
        kind: 'bytes',
        value: producer,
        extension: 'uvm',
        mediaType: 'model/gltf-binary',
      }))
      try {
        const result = await session.operations().invoke('good', null)
        if (result.state !== 'ok' || result.output.kind !== 'bytes')
          throw new Error('expected binary output')
        const published = result.output.value
        expect(Array.from(published)).toEqual([1, 2, 3])
        expect(result.output).toMatchObject({ extension: 'uvm', mediaType: 'model/gltf-binary' })
        producer[0] = 77
        expect(Array.from(published)).toEqual([1, 2, 3])
        published[1] = 88
        expect(Array.from(producer)).toEqual([77, 2, 3])
        const next = await session.operations().invoke('good', null)
        if (next.state !== 'ok' || next.output.kind !== 'bytes')
          throw new Error('expected next binary output')
        expect(Array.from(next.output.value)).toEqual([77, 2, 3])
        producer[2] = 99
        expect(Array.from(next.output.value)).toEqual([77, 2, 3])
        expect(Array.from(published)).toEqual([1, 88, 3])
      } finally {
        await session.dispose()
      }
    },
  )
})

describe('operation diagnostics accompanying binary output', () => {
  it('owns per-call diagnostics and ignores reports after completion', async () => {
    let late: ((value: Diagnostic) => void) | undefined
    const data = { value: 1 }
    const session = await diagnosticSession(async (_input, context) => {
      context.reportDiagnostic?.(
        diagnostic('warning', 'example/render-partial', 'Texture missing', undefined, data),
      )
      data.value = 9
      late = context.reportDiagnostic
      return { kind: 'bytes', value: Uint8Array.of(137, 80, 78, 71) }
    })
    try {
      const result = await session.operations().invoke('good', null)
      expect(result).toMatchObject({
        state: 'ok',
        output: { kind: 'bytes' },
        diagnostics: [{ data: { value: 1 } }],
      })
      late?.(diagnostic('warning', 'example/late', 'Late report'))
      expect(result.diagnostics).toHaveLength(1)
      const next = await session.operations().invoke('good', null)
      expect(next.diagnostics).toHaveLength(1)
      expect(next.diagnostics[0]?.data).toEqual({ value: 9 })
    } finally {
      await session.dispose()
    }
  })
  it('bounds diagnostic count and replaces malformed data without losing binary output', async () => {
    const session = await diagnosticSession(async (_input, context) => {
      const cyclic: Record<string, unknown> = {}
      cyclic['self'] = cyclic
      context.reportDiagnostic?.(diagnostic('warning', 'example/bad', 'Cyclic', undefined, cyclic))
      context.reportDiagnostic?.(diagnostic('warning', 'example/one', 'One'))
      context.reportDiagnostic?.(diagnostic('warning', 'example/two', 'Two'))
      return { kind: 'bytes', value: Uint8Array.of(1) }
    })
    try {
      const result = await session.operations().invoke('good', null)
      expect(result.state).toBe('ok')
      expect(result.diagnostics.map(item => item.code)).toEqual([
        'x3.host/invalid-operation-diagnostic',
        'x3.host/operation-diagnostics-truncated',
      ])
    } finally {
      await session.dispose()
    }
  })
})

describe('the file a binary output is', () => {
  it('keeps a plausible extension and media type with the bytes, and drops others', async () => {
    const answer = (extension: string, mediaType: string) =>
      diagnosticSession(async () => ({
        kind: 'bytes',
        value: Uint8Array.of(1, 2),
        extension,
        mediaType,
      }))
    const named = await answer('m3', 'application/vnd.blizzard.m3')
    const odd = await answer('../m3', 'not a media type')
    try {
      expect(await named.operations().invoke('good', null)).toMatchObject({
        output: { kind: 'bytes', extension: 'm3', mediaType: 'application/vnd.blizzard.m3' },
      })
      const dropped = await odd.operations().invoke('good', null)
      expect(dropped.state === 'ok' ? dropped.output : undefined).toEqual({
        kind: 'bytes',
        value: Uint8Array.of(1, 2),
      })
    } finally {
      await named.dispose()
      await odd.dispose()
    }
  })
})

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
