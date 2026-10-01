import { describe, expect, it } from 'vitest'
import { ModkitError, OperationCancelledError } from '@modkit/core'
import {
  CAPABILITY_RPC_DOMAIN,
  DEFAULT_PROTOCOL_LIMITS,
  fromErrorDto,
  handleRef,
  isHandleRef,
  protocolLimits,
  toErrorDto,
  validateErrorDto,
  validateFrame,
  validateWireValue,
  createSurfaceRegistry,
  type Frame,
} from '../src/execution/index.js'

const limits = protocolLimits({
  maxDepth: 4,
  maxNodes: 50,
  maxStringLength: 16,
  maxArrayLength: 5,
  maxObjectKeys: 5,
  maxTransferBytes: 32,
  maxArgs: 3,
})

const envelope = {
  domain: CAPABILITY_RPC_DOMAIN,
  version: 1,
  session: 'sess',
  generation: 1,
} as const
const expect1 = { session: 'sess', generation: 1 }
const frame = (body: Record<string, unknown>, id = 1): unknown => ({ ...envelope, id, ...body })
const label = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item))

describe('capability-rpc protocol v1 — wire values', () => {
  it('accepts JSON-safe data, bigint and whole Uint8Arrays; measures nodes and transfer bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const checked = validateWireValue({ a: 1n, b: [true, null, 'x'], c: bytes }, limits)
    expect(checked.ok).toBe(true)
    if (!checked.ok) throw new Error('unexpected')
    expect(checked.value.transferBytes).toBe(4)
    expect(checked.value.transferables).toEqual([bytes.buffer])
    expect(checked.value.nodes).toBeGreaterThan(5)
    // an absent optional property is tolerated inside objects/arrays (structured clone keeps it)
    expect(validateWireValue({ truncation: undefined, items: [1, undefined] }, limits).ok).toBe(
      true,
    )
    // a detached buffer (already transferred) cannot cross again
    const moved = new Uint8Array([1, 2])
    structuredClone(moved, { transfer: [moved.buffer] })
    const detached = validateWireValue(moved, limits)
    expect(detached.ok).toBe(false)
    if (detached.ok) throw new Error('unexpected')
    expect(detached.violation.code).toBe('bad-value')
  })

  it.each([
    ['function', { f: () => 1 }, 'bad-value'],
    ['Map', new Map(), 'bad-value'],
    ['Date', new Date(), 'bad-value'],
    [
      'class instance',
      new (class Foo {
        readonly marker = 1
      })(),
      'bad-value',
    ],
    ['NaN', Number.NaN, 'bad-value'],
    ['Infinity', [Number.POSITIVE_INFINITY], 'bad-value'],
    ['symbol', Symbol('x'), 'bad-value'],
    ['undefined at the top', undefined, 'bad-value'],
    ['prototype key', JSON.parse('{"__proto__": {"polluted": true}}'), 'forbidden-key'],
    ['constructor key', { constructor: 1 }, 'forbidden-key'],
    ['prototype key literal', { prototype: 1 }, 'forbidden-key'],
    ['long string', 'x'.repeat(17), 'string-too-long'],
    ['long array', [1, 2, 3, 4, 5, 6], 'array-too-long'],
    ['too many keys', { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, 'too-many-keys'],
    ['too deep', [[[[[1]]]]], 'depth-exceeded'],
    ['ArrayBuffer', new ArrayBuffer(4), 'bad-value'],
    ['DataView', new DataView(new ArrayBuffer(4)), 'bad-value'],
    ['partial view', new Uint8Array(new ArrayBuffer(16), 4, 4), 'partial-typed-array'],
    ['partial f32 view', new Float32Array(new ArrayBuffer(32), 8, 2), 'partial-typed-array'],
    ['transfer too large', new Uint8Array(33), 'transfer-too-large'],
    ['transfer too large in elements', new Float32Array(9), 'transfer-too-large'],
  ] as const)('rejects %s', (_label, value, code) => {
    const checked = validateWireValue(value, limits)
    expect(checked.ok).toBe(false)
    if (checked.ok) throw new Error('unexpected')
    expect(checked.violation.code).toBe(code)
  })

  it('carries the 1024² image of a pixel operation as base64 in its JSON input by default', () => {
    const pixels = 'A'.repeat(Math.ceil((1024 * 1024 * 4) / 3) * 4)
    const image = { width: 1024, height: 1024, pixels }
    expect(validateWireValue({ image }, DEFAULT_PROTOCOL_LIMITS).ok).toBe(true)
  })

  it.each([
    ['Int32Array', new Int32Array([-1, 2])],
    ['Float32Array', new Float32Array([1.5, -0])],
    ['Float64Array', new Float64Array([Number.MAX_VALUE])],
    ['Uint32Array', new Uint32Array([4294967295])],
    ['Uint8ClampedArray', new Uint8ClampedArray([0, 255])],
    ['BigInt64Array', new BigInt64Array([-9223372036854775808n])],
  ] as const)(
    'accepts a whole %s, because a mesh and decoded audio are made of them',
    (_l, value) => {
      const checked = validateWireValue(value, limits)
      expect(checked.ok).toBe(true)
      if (!checked.ok) throw new Error(checked.violation.message)
      // it is transferable like any other whole buffer: the transport moves it instead of copying
      expect(checked.value.transferables).toEqual([value.buffer])
      expect(checked.value.transferBytes).toBe(value.byteLength)
    },
  )

  it('refuses a typed-array subclass, which the far side would rebuild as its base kind', () => {
    class Positions extends Float32Array {}
    const checked = validateWireValue(new Positions([1, 2, 3]), limits)
    expect(checked.ok).toBe(false)
    if (checked.ok) throw new Error('unexpected')
    expect(checked.violation.code).toBe('bad-value')
    expect(checked.violation.message).toContain('Positions')
  })

  it('rejects SharedArrayBuffer-backed bytes when the platform has SharedArrayBuffer', () => {
    if (typeof SharedArrayBuffer !== 'function') return
    const view = new Uint8Array(new SharedArrayBuffer(8))
    const checked = validateWireValue(view, limits)
    expect(checked.ok).toBe(false)
    if (checked.ok) throw new Error('unexpected')
    expect(checked.violation.code).toBe('shared-buffer')
  })

  it('counts nodes across the whole value and stops at the limit', () => {
    const wide = {
      a: [1, 2, 3, 4, 5],
      b: [1, 2, 3, 4, 5],
      c: [1, 2, 3, 4, 5],
      d: [1, 2, 3, 4, 5],
      e: [1, 2, 3, 4, 5],
    }
    const nested = [wide, wide, wide]
    const checked = validateWireValue(
      nested,
      protocolLimits({ ...limits, maxNodes: 20, maxDepth: 8 }),
    )
    expect(checked.ok).toBe(false)
    if (checked.ok) throw new Error('unexpected')
    expect(checked.violation.code).toBe('nodes-exceeded')
  })

  it('treats handle refs by position: forbidden by default, top-level or nested only when allowed', () => {
    const ref = handleRef('w1-3', 'lease', { contract: 'x3.demo/thing', major: 1 })
    expect(isHandleRef(ref)).toBe(true)
    expect(validateWireValue(ref, limits).ok).toBe(false)
    expect(validateWireValue(ref, limits, 'top').ok).toBe(true)
    expect(validateWireValue({ inner: ref }, limits, 'top').ok).toBe(false)
    expect(validateWireValue({ inner: ref }, limits, 'nested').ok).toBe(true)
    // a look-alike with extra keys or a bad id is never a handle
    expect(isHandleRef({ '@x3.handle': { id: 'w1-3', kind: 'lease' }, extra: 1 })).toBe(false)
    expect(isHandleRef({ '@x3.handle': { id: 'x1-3', kind: 'lease' } })).toBe(false)
    expect(
      isHandleRef({ '@x3.handle': { id: 'w1-3', kind: 'lease', contract: 'not qualified' } }),
    ).toBe(false)
    const malformed = validateWireValue(
      { '@x3.handle': { id: 'w1-3', kind: 'lease', evil: 1 } },
      limits,
      'nested',
    )
    expect(malformed.ok).toBe(false)
    if (malformed.ok) throw new Error('unexpected')
    expect(malformed.violation.code).toBe('bad-handle')
    // a ref may carry copied data fields; that data is a handle-free wire object wherever the ref is
    const withData = handleRef(
      'w1-4',
      'lease',
      { contract: 'x3.demo/thing', major: 1 },
      {
        revision: 'r1',
        size: 4n,
      },
    )
    expect(isHandleRef(withData)).toBe(true)
    expect(validateWireValue(withData, limits, 'top').ok).toBe(true)
    expect(validateWireValue({ inner: withData }, limits, 'nested').ok).toBe(true)
    const smuggled = {
      '@x3.handle': {
        id: 'w1-5',
        kind: 'lease',
        data: { nested: { '@x3.handle': { id: 'w1-6', kind: 'lease' } } },
      },
    }
    for (const mode of ['top', 'nested'] as const) {
      const checked = validateWireValue(
        mode === 'top' ? smuggled : { inner: smuggled },
        limits,
        mode,
      )
      expect(checked.ok).toBe(false)
      if (checked.ok) throw new Error('unexpected')
      expect(checked.violation.code).toBe('handle-not-allowed')
    }
    expect(isHandleRef({ '@x3.handle': { id: 'w1-5', kind: 'lease', data: 'nope' } })).toBe(false)
  })
})

describe('capability-rpc protocol v1 — frames', () => {
  it('validates the envelope exactly and rejects foreign session/generation/domain', () => {
    const good = validateFrame(frame({ t: 'cancel', target: 4 }), limits, expect1)
    expect(good.ok).toBe(true)
    for (const [bad, code] of [
      [{ ...envelope, id: 1, t: 'cancel', target: 4, session: 'other' }, 'bad-envelope'],
      [{ ...envelope, id: 1, t: 'cancel', target: 4, generation: 2 }, 'stale-generation'],
      [{ ...envelope, id: 1, t: 'cancel', target: 4, domain: 'nope' }, 'bad-envelope'],
      [{ ...envelope, id: 0, t: 'cancel', target: 4 }, 'bad-id'],
      [{ ...envelope, id: 1.5, t: 'cancel', target: 4 }, 'bad-id'],
      [{ ...envelope, id: 1, t: 'nope' }, 'bad-type'],
      [{ ...envelope, id: 1, t: 'cancel', target: 4, extra: 1 }, 'unknown-key'],
      [{ ...envelope, id: 1, t: 'cancel' }, 'missing-key'],
      ['not an object', 'not-an-object'],
      [null, 'not-an-object'],
      [[], 'not-an-object'],
    ] as const) {
      const checked = validateFrame(bad, limits, expect1)
      expect(checked.ok, label(bad)).toBe(false)
      if (checked.ok) throw new Error('unexpected')
      expect(checked.violation.code).toBe(code)
    }
  })

  it('validates every frame type with its own exact keys and grammars', () => {
    const ok = (body: Record<string, unknown>) =>
      expect(validateFrame(frame(body), limits, expect1).ok, label(body)).toBe(true)
    const bad = (body: Record<string, unknown>, code: string) => {
      const checked = validateFrame(frame(body), limits, expect1)
      expect(checked.ok, label(body)).toBe(false)
      if (checked.ok) throw new Error('unexpected')
      expect(checked.violation.code, label(body)).toBe(code)
    }
    const root = handleRef('w1-1', 'lease', { contract: 'x3.demo/module', major: 1 })
    ok({
      t: 'load',
      moduleUrl: 'file:///a.js',
      contributionId: 'org.example/x',
      variantId: 'portable',
      artifactDigest: 'sha256:1',
    })
    bad(
      {
        t: 'load',
        moduleUrl: '',
        contributionId: 'org.example/x',
        variantId: 'portable',
        artifactDigest: 'sha256:1',
      },
      'bad-value',
    )
    bad(
      {
        t: 'load',
        moduleUrl: 'file:///a.js',
        contributionId: 'Not Qualified',
        variantId: 'portable',
        artifactDigest: 'sha256:1',
      },
      'bad-value',
    )
    bad(
      {
        t: 'load',
        moduleUrl: 'file:///a.js',
        contributionId: 'org.example/x',
        variantId: 'Portable!',
        artifactDigest: 'sha256:1',
      },
      'bad-value',
    )
    ok({ t: 'ready', inReplyTo: 1, abiVersion: 1, exports: ['createCodec'], root })
    bad({ t: 'ready', inReplyTo: 1, abiVersion: 2, exports: [], root }, 'bad-value')
    bad({ t: 'ready', inReplyTo: 1, abiVersion: 1, exports: [1], root }, 'bad-value')
    bad(
      {
        t: 'ready',
        inReplyTo: 1,
        abiVersion: 1,
        exports: [],
        root: { '@x3.handle': { id: 'zz', kind: 'lease' } },
      },
      'bad-handle',
    )
    ok({ t: 'call', handle: 'w1-1', method: 'read', args: [1n, 'x', { nested: root }] })
    bad({ t: 'call', handle: 'w1-1', method: 'read.me', args: [] }, 'bad-method')
    bad({ t: 'call', handle: 'w1-1', method: 'Read', args: [] }, 'bad-method')
    bad({ t: 'call', handle: 'nope', method: 'read', args: [] }, 'bad-handle')
    bad({ t: 'call', handle: 'w1-1', method: 'read', args: [1, 2, 3, 4] }, 'too-many-args')
    // an object literal `{ __proto__: 1 }` only sets the prototype; a parsed JSON key is an own key
    bad(
      {
        t: 'call',
        handle: 'w1-1',
        method: 'read',
        args: [JSON.parse('{"__proto__": {"polluted": true}}')],
      },
      'forbidden-key',
    )
    bad(
      {
        t: 'call',
        handle: 'w1-1',
        method: 'read',
        args: [Object.create(null, { constructor: { value: 1, enumerable: true } })],
      },
      'forbidden-key',
    )
    bad({ t: 'call', handle: 'w1-1', method: 'read', args: [], deadlineMs: -1 }, 'bad-value')
    ok({ t: 'return', inReplyTo: 3 })
    ok({ t: 'return', inReplyTo: 3, value: root })
    bad({ t: 'return', inReplyTo: 3, value: { nested: root } }, 'handle-not-allowed')
    ok({
      t: 'throw',
      inReplyTo: 3,
      error: { code: 'x3.demo/boom', message: 'boom', retryability: 'never' },
    })
    bad(
      {
        t: 'throw',
        inReplyTo: 3,
        error: { code: 'not qualified', message: 'boom', retryability: 'never' },
      },
      'bad-error',
    )
    bad(
      {
        t: 'throw',
        inReplyTo: 3,
        error: { code: 'x3.demo/boom', message: 'boom', retryability: 'maybe' },
      },
      'bad-error',
    )
    bad(
      {
        t: 'throw',
        inReplyTo: 3,
        error: { code: 'x3.demo/boom', message: 'boom', retryability: 'never', stack: 'x' },
      },
      'bad-error',
    )
    ok({ t: 'next', handle: 'w1-2' })
    ok({ t: 'done', handle: 'w1-2', inReplyTo: 9 })
    ok({
      t: 'done',
      handle: 'w1-2',
      error: { code: 'x3.demo/end', message: 'end', retryability: 'never' },
    })
    ok({ t: 'subscribe', handle: 'w1-2' })
    ok({ t: 'event', subscription: 'ws1-1', value: { tick: 1 } })
    bad({ t: 'event', subscription: 's1-1', value: 1 }, 'bad-subscription')
    bad({ t: 'event', subscription: 'ws1-1', value: root }, 'handle-not-allowed')
    ok({ t: 'unsubscribe', subscription: 'hs1-1' })
    ok({ t: 'progress', inReplyTo: 2, progress: { completed: 1, total: 4, message: 'm' } })
    bad({ t: 'progress', inReplyTo: 2, progress: { completed: -1 } }, 'bad-progress')
    bad({ t: 'progress', inReplyTo: 2, progress: { completed: 1, extra: 1 } }, 'bad-progress')
    ok({ t: 'release', handle: 'h1-1' })
    ok({ t: 'terminate', reason: 'bye' })
    bad({ t: 'terminate', reason: '' }, 'bad-value')
  })
})

describe('capability-rpc protocol v1 — error DTO', () => {
  it('carries ModkitError code/context/retryability, drops non-wire context, never a stack', () => {
    const rich = toErrorDto(
      new ModkitError({ code: 'x3.demo/x', message: 'm', context: { a: 1 }, retryability: 'safe' }),
      DEFAULT_PROTOCOL_LIMITS,
    )
    expect(rich).toEqual({
      code: 'x3.demo/x',
      message: 'm',
      retryability: 'safe',
      context: { a: 1 },
    })
    expect(Object.keys(rich)).not.toContain('stack')
    const dropped = toErrorDto(
      new ModkitError({ code: 'x3.demo/x', message: 'm', context: { fn: () => 1 } }),
      DEFAULT_PROTOCOL_LIMITS,
    )
    expect(dropped.context).toBeUndefined()
    expect(dropped.contextDropped).toBe(true)
    const foreign = toErrorDto(new TypeError('plain'), DEFAULT_PROTOCOL_LIMITS)
    expect(foreign).toEqual({
      code: 'x3.host/rpc-foreign-error',
      message: 'plain',
      retryability: 'never',
    })
    const cancelled = toErrorDto(new OperationCancelledError('stop'), DEFAULT_PROTOCOL_LIMITS)
    expect(cancelled.cancelled).toBe(true)
    expect(fromErrorDto(cancelled)).toBeInstanceOf(OperationCancelledError)
    const back = fromErrorDto(rich)
    expect(back).toBeInstanceOf(ModkitError)
    expect(back.code).toBe('x3.demo/x')
    expect(back.context).toEqual({ a: 1 })
    expect(back.retryability).toBe('safe')
    // the DTO validator rejects unknown keys and bad flags
    expect(validateErrorDto({ ...rich, cancelled: false }, DEFAULT_PROTOCOL_LIMITS).ok).toBe(false)
    expect(
      validateErrorDto(
        { code: 'x3.demo/x', message: 'm', retryability: 'never', context: [1] },
        DEFAULT_PROTOCOL_LIMITS,
      ).ok,
    ).toBe(false)
  })

  it('a validated frame is a Frame', () => {
    const checked = validateFrame(frame({ t: 'terminate', reason: 'x' }), limits, expect1)
    if (!checked.ok) throw new Error('unexpected')
    const typed: Frame = checked.value
    expect(typed.t).toBe('terminate')
  })
})

describe('capability-RPC method-surface ingress', () => {
  it('rejects malformed declarations and snapshots method behaviour at registration time', () => {
    const mutable = {
      kind: 'value' as const,
      validateArgs: () => undefined,
    }
    const registry = createSurfaceRegistry([
      {
        contract: 'x3.demo/snapshot',
        major: 1,
        methods: { ping: mutable },
      },
    ])
    ;(mutable as { kind: unknown; validateArgs: unknown }).kind = 'lease'
    ;(mutable as { validateArgs: unknown }).validateArgs = () => 'mutated'
    const surface = registry.surfaceFor('x3.demo/snapshot', 1)
    expect(surface?.methods['ping']?.kind).toBe('value')
    expect(surface?.methods['ping']?.validateArgs?.([])).toBeUndefined()
    expect(() =>
      createSurfaceRegistry([
        {
          contract: 'x3.demo/invalid',
          major: 1,
          methods: { ping: { kind: 'lease' } },
        },
      ]),
    ).toThrow(/must name the surface/u)
    expect(() =>
      createSurfaceRegistry([
        {
          contract: 'x3.demo/invalid',
          major: 1,
          methods: { ping: { kind: 'value', wrapper: 'lease' } },
        },
      ]),
    ).toThrow(/only lease method/u)
  })
})
