import { describe, expect, it } from 'vitest'
import {
  ENCODED_MEDIA_SURFACE_ID,
  STANDARD_DATA_SOURCE_CONTRACTS,
  type DataSourceSurfaceV1Wire,
} from '@modkitx-x3/sdk'
import {
  ABI_ASSET_SESSION,
  ABI_CODEC,
  ABI_CODEC_MODULE,
  CAPABILITY_OF,
  RUNTIME_ABI_SURFACES,
  capabilitySurfaceFromDataSource,
  createEndpoint,
  createStandardSurfaceRegistry,
  protocolLimits,
  type Endpoint,
  type Frame,
  type FramePort,
  type RemoteCapability,
  type SurfaceRegistry,
} from '../src/execution/index.js'

// ------------------------------------------------------------------ minimal loopback

function loopback(): { a: FramePort; b: FramePort } {
  const handlers = { a: new Set<(f: unknown) => void>(), b: new Set<(f: unknown) => void>() }
  const port = (side: 'a' | 'b'): FramePort => ({
    post: (frame: Frame, transfer) => {
      const cloned = structuredClone(frame, { transfer: [...transfer] })
      const targets = handlers[side === 'a' ? 'b' : 'a']
      queueMicrotask(() => {
        for (const handler of targets) handler(cloned)
      })
    },
    onFrame: handler => {
      handlers[side].add(handler)
      return () => handlers[side].delete(handler)
    },
  })
  return { a: port('a'), b: port('b') }
}

function endpoints(
  surfaces: SurfaceRegistry,
  module: Record<string, unknown>,
  rootSurface: { contract: string; major: number },
): { host: Endpoint; worker: Endpoint; failures: unknown[] } {
  const wire = loopback()
  const failures: unknown[] = []
  const limits = protocolLimits({ defaultCallDeadlineMs: 2_000 })
  const host = createEndpoint({
    role: 'host',
    port: wire.a,
    session: 's',
    generation: 1,
    surfaces,
    limits,
    onFailure: failure => void failures.push(failure),
  })
  const worker = createEndpoint({
    role: 'worker',
    port: wire.b,
    session: 's',
    generation: 1,
    surfaces,
    limits,
    loader: async () => ({ module, surface: rootSurface }),
    onFailure: failure => void failures.push(failure),
  })
  return { host, worker, failures }
}

const load = {
  moduleUrl: 'file:///m.js',
  contributionId: 'org.example/m',
  variantId: 'v',
  artifactDigest: 'd',
}

// ------------------------------------------------------------------ registry

describe('standard surface registry (NXT-103 → NXT-105 adapter)', () => {
  it('resolves every standard data-source surface, the auxiliary surface and the ABI surfaces', () => {
    const registry = createStandardSurfaceRegistry()
    for (const contract of STANDARD_DATA_SOURCE_CONTRACTS) {
      expect(registry.surfaceFor(contract, 1), contract).toBeDefined()
      expect(registry.surfaceFor(contract, 2), `${contract}@2`).toBeUndefined()
    }
    expect(registry.surfaceFor(ENCODED_MEDIA_SURFACE_ID, 1)).toBeDefined()
    for (const surface of RUNTIME_ABI_SURFACES) {
      expect(registry.surfaceFor(surface.contract, surface.major)).toBeDefined()
    }
    const text = registry.surfaceFor('common.view/text-data-source', 1)
    expect(text?.methods['search']).toMatchObject({ kind: 'iterable', signal: 'last' })
    const audio = registry.surfaceFor('common.view/audio-media-source', 1)
    expect(audio?.methods['encoded']).toMatchObject({
      kind: 'lease',
      wrapper: 'bare',
      arity: 1,
      result: { contract: ENCODED_MEDIA_SURFACE_ID, major: 1 },
    })
    const namespace = registry.surfaceFor('common.view/namespace-entry-source', 1)
    expect(namespace?.methods['openEntry']).toMatchObject({ kind: 'leased-value' })
    expect(namespace?.methods['search']).toMatchObject({ kind: 'value', optional: true })
    const session = registry.surfaceFor(ABI_ASSET_SESSION.contract, 1)
    expect(session?.fields).toEqual(['revision'])
    expect(session?.releaseVia).toBe('dispose')
    expect(session?.methods['dataSource']).toMatchObject({
      kind: 'lease',
      resultFromArgs: { contract: 0, major: 1 },
    })
  })

  it('adds foreign definitions with a surface, skips those without one, and never lets them shadow the standard set', () => {
    const foreign: DataSourceSurfaceV1Wire = {
      methods: { ping: { kind: 'value' }, stream: { kind: 'iterable', signal: 'last' } },
    }
    const shadow: DataSourceSurfaceV1Wire = { methods: { hijack: { kind: 'value' } } }
    const registry = createStandardSurfaceRegistry({
      definitions: [
        { contract: 'org.example/thing-source', major: 2, surface: foreign },
        { contract: 'org.example/opaque-source', major: 1 },
        { contract: 'common.view/text-data-source', major: 1, surface: shadow },
      ],
    })
    expect(registry.surfaceFor('org.example/thing-source', 2)?.methods['stream']).toMatchObject({
      kind: 'iterable',
    })
    expect(registry.surfaceFor('org.example/opaque-source', 1)).toBeUndefined()
    expect(
      registry.surfaceFor('common.view/text-data-source', 1)?.methods['hijack'],
    ).toBeUndefined()
    expect(registry.surfaceFor('common.view/text-data-source', 1)?.methods['info']).toBeDefined()
  })

  it('a foreign lease that names an unknown surface is refused when the registry is built', () => {
    expect(() =>
      createStandardSurfaceRegistry({
        definitions: [
          {
            contract: 'org.example/parent',
            major: 1,
            surface: {
              methods: {
                child: { kind: 'lease', result: { contract: 'org.example/missing', major: 1 } },
              },
            },
          },
        ],
      }),
    ).toThrow(/unregistered surface/)
  })
})

// ------------------------------------------------------------------ real data-source objects over the wire

describe('standard data-source objects round-trip through the RPC core with the adapted surfaces', () => {
  const registry = createStandardSurfaceRegistry({
    surfaces: [
      {
        contract: 'x3.test/session-holder',
        major: 1,
        methods: {
          text: { kind: 'lease', result: { contract: 'common.view/text-data-source', major: 1 } },
          namespace: {
            kind: 'lease',
            result: { contract: 'common.view/namespace-entry-source', major: 1 },
          },
          audio: {
            kind: 'lease',
            result: { contract: 'common.view/audio-media-source', major: 1 },
          },
          session: { kind: 'lease', result: ABI_ASSET_SESSION },
        },
      },
    ],
  })

  const encoded = {
    descriptor: async () => ({ mediaType: 'audio/ogg', bytes: 3n }),
    read: async (offset: bigint, length: number) =>
      new Uint8Array([1, 2, 3]).slice(Number(offset), Number(offset) + length),
  }
  const seenEncodedArgs: unknown[][] = []
  const releasedEntries: string[] = []
  const world = {
    text: {
      info: async () => ({
        bytes: 11n,
        encoding: 'utf-8',
        bom: false,
        newline: 'lf',
        lines: 1,
        longestLineBytes: 11,
      }),
      slice: async (request: { from: number; to: number }) =>
        'hello world'.slice(request.from, request.to),
      search: async function* (query: { text: string }) {
        if ('hello world'.includes(query.text)) yield { from: 0, to: query.text.length }
      },
    },
    namespace: {
      list: async () => ({
        items: [{ id: 'a', path: '/a', name: 'a', kind: 'file', revision: 'r1' }],
      }),
      search: async (query: { basenames: readonly string[] }) => ({
        items: query.basenames.includes('a')
          ? [{ id: 'a', path: '/a', name: 'a', kind: 'file', revision: 'r1' }]
          : [],
      }),
      openEntry: async (id: string) => ({
        value: { kind: 'entry', id, revision: 'r1' },
        release: async () => void releasedEntries.push(id),
      }),
    },
    audio: {
      info: async () => ({ tracks: 1 }),
      encoded: async (...args: unknown[]) => {
        seenEncodedArgs.push(args)
        return encoded
      },
      // readPcm intentionally absent: an optional ABI method
    },
    session: {
      revision: 'rev-42',
      state: () => 'live',
      descriptor: async () => ({ id: 'd' }),
      dataSource: async (contract: string) => ({
        value: contract === 'common.view/text-data-source' ? world.text : world.namespace,
        release: async () => undefined,
      }),
      operations: () => ({ invoke: async () => ({ kind: 'ok' }), dispose: async () => undefined }),
      events: async function* () {
        yield { kind: 'state', state: 'live' }
      },
      dispose: async () => undefined,
    },
  }
  const holder = {
    text: () => world.text,
    namespace: () => world.namespace,
    audio: () => world.audio,
    session: () => world.session,
  }

  async function open(): Promise<{
    host: Endpoint
    worker: Endpoint
    holder: Record<string, unknown>
    failures: unknown[]
  }> {
    const e = endpoints(registry, holder, { contract: 'x3.test/session-holder', major: 1 })
    const loaded = await e.host.load(load)
    return { ...e, holder: e.host.materialize(loaded.root) }
  }

  it('TextDataSource: value, cancellable value and iterable methods behave like the ABI', async () => {
    const { holder: root, failures } = await open()
    const text = (await (root['text'] as () => Promise<Record<string, unknown>>)()) as {
      info(): Promise<{ bytes: bigint; encoding: string }>
      slice(r: unknown, s?: AbortSignal): Promise<string>
      search(q: unknown, s?: AbortSignal): Promise<AsyncIterable<{ from: number; to: number }>>
    }
    expect((await text.info()).bytes).toBe(11n)
    expect(await text.slice({ from: 0, to: 5 })).toBe('hello')
    const spans: unknown[] = []
    for await (const span of await text.search({ text: 'world' })) spans.push(span)
    expect(spans).toEqual([{ from: 0, to: 5 }])
    expect(failures).toEqual([])
  })

  it('NamespaceEntrySource.openEntry is a leased value: data by copy, release-only lease', async () => {
    const { holder: root, worker } = await open()
    const namespace = (await (root['namespace'] as () => Promise<Record<string, unknown>>)()) as {
      search(
        query: unknown,
        page: unknown,
        signal?: AbortSignal,
      ): Promise<{ items: readonly { path: string }[] }>
      openEntry(
        id: string,
        s?: AbortSignal,
      ): Promise<{ value: { id: string }; release(): Promise<void> }>
    }
    const found = await namespace.search(
      { kind: 'basename-any', basenames: ['a'], caseSensitive: true },
      { limit: 8 },
    )
    expect(found.items).toEqual([{ id: 'a', path: '/a', name: 'a', kind: 'file', revision: 'r1' }])
    const lease = await namespace.openEntry('a')
    expect(lease.value).toEqual({ kind: 'entry', id: 'a', revision: 'r1' })
    const before = worker.counters().localHandles
    await lease.release()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(releasedEntries).toEqual(['a'])
    expect(worker.counters().localHandles).toBe(before - 1)
  })

  it('AudioMediaSource.encoded(): bare lease of the auxiliary encoded-media surface, arity keeps the signal last, optional methods are absent-tolerant', async () => {
    const { holder: root } = await open()
    const audio = (await (root['audio'] as () => Promise<Record<string, unknown>>)()) as {
      encoded(
        trackId?: string,
        s?: AbortSignal,
      ): Promise<{
        descriptor(): Promise<unknown>
        read(o: bigint, l: number): Promise<Uint8Array>
      }>
      readPcm?: (request: unknown) => Promise<unknown>
    }
    const media = await audio.encoded()
    expect(seenEncodedArgs[0]?.length).toBe(2)
    expect(seenEncodedArgs[0]?.[0]).toBeUndefined()
    expect(seenEncodedArgs[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(await media.descriptor()).toEqual({ mediaType: 'audio/ogg', bytes: 3n })
    expect([...(await media.read(1n, 2))]).toEqual([2, 3])
    // readPcm is optional on the ABI and this audio object does not implement it: protocol 1.1
    // `has` lists only present optional methods, so the proxy never defines readPcm and
    // `typeof audio.readPcm === 'function'` answers false — feature detection across the boundary
    expect(typeof audio.readPcm).toBe('undefined')
  })

  it('AssetSession ABI surface: revision travels as a field, dataSource resolves its lease surface from the arguments, dispose releases', async () => {
    const { holder: root, host } = await open()
    const session = (await (root['session'] as () => Promise<Record<string, unknown>>)()) as {
      revision: string
      state(): Promise<string>
      dataSource(
        c: string,
        m: number,
      ): Promise<{ value: Record<string, unknown>; release(): Promise<void> }>
      dispose(): Promise<void>
    }
    expect(session.revision).toBe('rev-42')
    expect(await session.state()).toBe('live')
    const text = await session.dataSource('common.view/text-data-source', 1)
    expect(
      (text.value as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]?.contract,
    ).toBe('common.view/text-data-source')
    expect(
      await (text.value['slice'] as (r: unknown) => Promise<string>)({ from: 6, to: 11 }),
    ).toBe('world')
    await text.release()
    await expect(session.dataSource('common.view/nope-source', 1)).rejects.toMatchObject({
      code: 'x3.host/rpc-bad-argument',
    })
    const remote = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    await session.dispose()
    expect(remote?.isReleased).toBe(true)
    expect(host.state).toBe('open')
  })

  it('declared limits become validators on both sides', async () => {
    const limited = capabilitySurfaceFromDataSource('org.example/limited', 1, {
      methods: {
        echo: { kind: 'value', limits: { maxStringLength: 6, maxBytes: 2, maxPageItems: 1 } },
      },
    })
    const reg = createStandardSurfaceRegistry({
      surfaces: [
        limited,
        {
          contract: 'x3.test/root',
          major: 1,
          methods: {
            limited: { kind: 'lease', result: { contract: 'org.example/limited', major: 1 } },
          },
        },
      ],
    })
    const target = { echo: async (v: unknown) => v }
    const e = endpoints(reg, { limited: () => target }, { contract: 'x3.test/root', major: 1 })
    const loaded = await e.host.load(load)
    const root = e.host.materialize(loaded.root)
    const proxy = (await (root['limited'] as () => Promise<Record<string, unknown>>)()) as {
      echo(v: unknown): Promise<unknown>
    }
    expect(await proxy.echo('abcdef')).toBe('abcdef')
    await expect(proxy.echo('abcdefg')).rejects.toMatchObject({
      code: 'x3.host/rpc-bad-argument',
    })
    await expect(proxy.echo(new Uint8Array(3))).rejects.toMatchObject({
      code: 'x3.host/rpc-bad-return',
    })
    await expect(proxy.echo({ items: [1, 2] })).rejects.toMatchObject({
      code: 'x3.host/rpc-bad-return',
    })
    expect(await proxy.echo({ items: [1] })).toEqual({ items: [1] })
    expect(e.failures).toEqual([])
  })

  it('the ABI surfaces name only registered result surfaces', () => {
    const registry = createStandardSurfaceRegistry()
    expect(registry.surfaceFor(ABI_CODEC_MODULE.contract, 1)?.methods['createCodec']).toMatchObject(
      {
        result: ABI_CODEC,
      },
    )
    expect(registry.surfaceFor(ABI_CODEC.contract, 1)?.methods['open']).toMatchObject({
      result: ABI_ASSET_SESSION,
    })
  })
})
