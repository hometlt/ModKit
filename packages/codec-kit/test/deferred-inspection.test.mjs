import test from 'node:test'
import assert from 'node:assert/strict'
import { createInspectionCodec } from '../dist/index.js'
import { deferAssetSession } from '../dist/deferred-session.js'

const budget = {
  maxInputBytes: 1024n,
  maxScalarBytes: 4096,
  maxDepth: 32,
  maxNodes: 1000,
  maxDiagnostics: 10,
}
const revision = 'provider-token:deferred-fixture'
function gate() {
  let release
  const promise = new Promise(resolve => {
    release = resolve
  })
  return { promise, release: () => release() }
}
function fixture(inspect, options = {}) {
  const bytes = new TextEncoder().encode('fixture')
  const source = {
    kind: 'bytes',
    ref: { id: 'fixture', uri: 'memory:deferred-fixture' },
    revision,
    size: BigInt(bytes.length),
    read: async (offset, length) => bytes.slice(Number(offset), Number(offset) + length),
  }
  let opens = 0,
    releases = 0,
    inspections = 0
  const input = {
    originKind: 'single',
    primaryBindingId: 'content',
    revisions: { topology: 'single', revision },
    bindings: [
      {
        bindingId: 'content',
        role: 'content',
        source: source.ref,
        sourceKind: 'candidate',
        ownership: 'owned',
        revision,
      },
    ],
    async openBinding() {
      opens++
      return {
        value: source,
        release: async () => {
          releases++
        },
      }
    },
  }
  const codec = createInspectionCodec(
    {
      id: 'example/deferred',
      deferInspection: true,
      format: { id: 'example/deferred', label: 'Deferred' },
      detect: async () => ({ confidence: 1, kind: 'magic' }),
      async inspect(bytes, context) {
        inspections++
        const result = await inspect(bytes, context)
        return { summary: null, metadata: [], traits: [], ...result }
      },
    },
    options.context,
  )
  return {
    open: () => codec.open(input, 'full', budget, options.signal),
    counts: () => ({ opens, releases, inspections }),
  }
}

test('first descriptor, data source, operation and event share one post-open inspection', async () => {
  let live = false,
    discoveries = 0
  const entered = gate(),
    finish = gate()
  const logicalResources = {
    async discover() {
      assert.equal(live, true)
      discoveries++
      entered.release()
      await finish.promise
      return { count: 2 }
    },
  }
  const f = fixture(
    async (_bytes, context) => {
      assert.equal(context.logicalResources, logicalResources)
      const result = await context.logicalResources.discover({ role: 'sidecar', extension: '.m3a' })
      return {
        summary: result,
        metadata: [
          {
            id: 'companions',
            label: 'Companions',
            entries: [{ key: 'count', value: result.count }],
          },
        ],
      }
    },
    { context: { logicalResources, budgets: budget } },
  )
  const session = await f.open()
  assert.deepEqual(f.counts(), { opens: 0, releases: 0, inspections: 0 })
  assert.equal(session.revision, revision)
  live = true
  const descriptor = session.descriptor()
  const second = session.descriptor()
  const source = session.dataSource('common.view/byte-range-source', 1)
  const operation = session.operations().invoke('inspect', null)
  const events = session.events()[Symbol.asyncIterator]()
  const event = events.next()
  await entered.promise
  assert.equal(discoveries, 1)
  finish.release()
  const [firstDescriptor, secondDescriptor, lease, result, initialEvent] = await Promise.all([
    descriptor,
    second,
    source,
    operation,
    event,
  ])
  assert.equal(firstDescriptor, secondDescriptor)
  assert.equal(
    firstDescriptor.metadata.find(group => group.id === 'companions').entries[0].value,
    2,
  )
  assert.deepEqual(result.output, { kind: 'json', value: { count: 2 } })
  assert.equal(initialEvent.value.kind, 'descriptor')
  assert.equal(initialEvent.value.descriptor, firstDescriptor)
  await lease.release()
  await events.return()
  await session.dispose()
  assert.deepEqual(f.counts(), { opens: 1, releases: 1, inspections: 1 })
})

test('disposing an unused deferred session opens no source and invokes no inspection', async () => {
  const f = fixture(async () => {
    throw new Error('must not inspect')
  })
  const session = await f.open()
  await session.operations().dispose()
  await session.dispose()
  assert.equal(session.state(), 'disposed')
  await assert.rejects(session.descriptor(), /disposed/)
  assert.equal((await session.operations().invoke('inspect', null)).reason, 'cancelled')
  assert.deepEqual(f.counts(), { opens: 0, releases: 0, inspections: 0 })
})

test('failed initialization is cached and releases the source exactly once', async () => {
  const failure = new Error('sidecar admission refused')
  const f = fixture(async () => {
    throw failure
  })
  const session = await f.open()
  await assert.rejects(session.descriptor(), error => error === failure)
  await assert.rejects(
    session.dataSource('common.view/byte-range-source', 1),
    error => error === failure,
  )
  await session.dispose()
  await session.dispose()
  assert.deepEqual(f.counts(), { opens: 1, releases: 1, inspections: 1 })
})

test('dispose cancels initialization and waits for source cleanup without publishing late data', async () => {
  const entered = gate(),
    finish = gate()
  let inspectionSignal
  const f = fixture(async (_bytes, context) => {
    inspectionSignal = context.signal
    entered.release()
    await finish.promise
    return { summary: { late: true } }
  })
  const session = await f.open()
  const rejected = assert.rejects(session.descriptor(), /disposed|cancel/i)
  await entered.promise
  const disposed = session.dispose()
  assert.equal(inspectionSignal.aborted, true)
  assert.equal(session.state(), 'disposed')
  finish.release()
  await Promise.all([disposed, rejected])
  assert.deepEqual(f.counts(), { opens: 1, releases: 1, inspections: 1 })
})

test('first operation captures its JSON input before asynchronous inspection', async () => {
  const finish = gate(),
    entered = gate()
  let observed
  const f = fixture(async () => {
    entered.release()
    await finish.promise
    return {
      handlers: {
        inspect: async value => {
          observed = value
          return { kind: 'json', value }
        },
      },
    }
  })
  const session = await f.open()
  const input = { nested: { value: 1 }, names: ['first'] }
  const result = session.operations().invoke('inspect', input)
  input.nested.value = 99
  input.names.push('second')
  await entered.promise
  finish.release()
  assert.equal((await result).state, 'ok')
  assert.deepEqual(observed, { nested: { value: 1 }, names: ['first'] })
  await session.dispose()
})

test('operation cancellation while initializing does not poison another descriptor caller', async () => {
  const finish = gate(),
    entered = gate()
  let calls = 0
  const f = fixture(async () => {
    entered.release()
    await finish.promise
    return {
      handlers: {
        inspect: async () => {
          calls++
          return { kind: 'none' }
        },
      },
    }
  })
  const session = await f.open()
  const controller = new AbortController()
  const invoked = session.operations().invoke('inspect', null, { signal: controller.signal })
  const descriptor = session.descriptor()
  await entered.promise
  controller.abort()
  finish.release()
  assert.equal((await invoked).reason, 'cancelled')
  assert.equal((await descriptor).revision, revision)
  assert.equal(calls, 0)
  await session.dispose()
})

test('a deferred initializer cannot change revision or leak its rejected session', async () => {
  let releases = 0
  const session = deferAssetSession(
    revision,
    async () => ({
      revision: 'provider-token:other',
      dispose: async () => {
        releases++
      },
    }),
    budget,
  )
  await assert.rejects(session.descriptor(), /revision/)
  await session.dispose()
  assert.equal(releases, 1)
})

test('an active handler cannot return success after the deferred session is disposed', async () => {
  const entered = gate(),
    finish = gate()
  let handlerSignal
  const f = fixture(async () => ({
    handlers: {
      inspect: async (_input, options) => {
        handlerSignal = options.signal
        entered.release()
        await finish.promise
        return { kind: 'json', value: { late: true } }
      },
    },
  }))
  const session = await f.open()
  const invoked = session.operations().invoke('inspect', null)
  await entered.promise
  await session.dispose()
  assert.equal(handlerSignal.aborted, true)
  finish.release()
  assert.equal((await invoked).reason, 'cancelled')
})

test('a data-source lease arriving after disposal is released before refusal', async () => {
  const entered = gate(),
    finish = gate()
  let leaseReleases = 0,
    sessionReleases = 0
  const session = deferAssetSession(
    revision,
    async () => ({
      revision,
      async dataSource() {
        entered.release()
        await finish.promise
        return {
          value: {},
          release: async () => {
            leaseReleases++
          },
        }
      },
      dispose: async () => {
        sessionReleases++
      },
    }),
    budget,
  )
  const rejected = assert.rejects(
    session.dataSource('common.view/byte-range-source', 1),
    /disposed/,
  )
  await entered.promise
  await session.dispose()
  finish.release()
  await rejected
  assert.equal(leaseReleases, 1)
  assert.equal(sessionReleases, 1)
})

test('a descriptor arriving after disposal is not published', async () => {
  const entered = gate(),
    finish = gate()
  const session = deferAssetSession(
    revision,
    async () => ({
      revision,
      async descriptor() {
        entered.release()
        await finish.promise
        return { late: true }
      },
      dispose: async () => undefined,
    }),
    budget,
  )
  const rejected = assert.rejects(session.descriptor(), /disposed/)
  await entered.promise
  await session.dispose()
  finish.release()
  await rejected
})

test('a cancelled event subscriber stops before shared initialization completes', async () => {
  const entered = gate(),
    finish = gate()
  const f = fixture(async () => {
    entered.release()
    await finish.promise
    return {}
  })
  const session = await f.open()
  const controller = new AbortController()
  const iterator = session.events(controller.signal)[Symbol.asyncIterator]()
  const next = iterator.next()
  const descriptor = session.descriptor()
  await entered.promise
  controller.abort()
  assert.deepEqual(await next, { done: true, value: undefined })
  finish.release()
  assert.equal((await descriptor).revision, revision)
  await session.dispose()
})

test('cancelling the opening lifetime stops an already subscribed event iterator', async () => {
  const controller = new AbortController()
  const f = fixture(async () => ({}), { signal: controller.signal })
  const session = await f.open()
  const iterator = session.events()[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value.kind, 'descriptor')
  const next = iterator.next()
  controller.abort()
  assert.deepEqual(await next, { done: true, value: undefined })
  await session.dispose()
})
