import test from 'node:test'
import assert from 'node:assert/strict'
import { createInspectionCodec } from '../dist/index.js'

const budget = {
  maxInputBytes: 1024n,
  maxScalarBytes: 4096,
  maxDepth: 32,
  maxNodes: 1000,
  maxDiagnostics: 10,
}
const revision = 'provider-token:settings-fixture'

/** A byte codec that reports the settings its inspect was handed. */
function fixture(uri, settings) {
  const bytes = new TextEncoder().encode('fixture')
  const source = {
    kind: 'bytes',
    ref: { id: 'fixture', uri },
    revision,
    size: BigInt(bytes.length),
    read: async (offset, length) => bytes.slice(Number(offset), Number(offset) + length),
  }
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
      return { value: source, release: async () => {} }
    },
  }
  let seen
  const codec = createInspectionCodec(
    {
      id: 'example/settings',
      format: { id: 'example/settings', label: 'Settings' },
      detect: async () => ({ confidence: 1, kind: 'magic' }),
      async inspect(_bytes, context) {
        seen = context.settings
        return { summary: null, metadata: [], traits: [] }
      },
    },
    settings === undefined
      ? undefined
      : {
          budgets: budget,
          diagnostics: { report() {} },
          contracts: { resolve: async () => undefined, resolveUnknown: async () => undefined },
          settings,
        },
  )
  return { open: () => codec.open(input, 'full', budget, undefined), seen: () => seen }
}

test('a codec is handed the settings of the source it opens', async () => {
  const f = fixture('file:///games/one', {
    values: { cacheIndex: true, depth: 2 },
    bySource: { 'file:///games/one': { cacheIndex: false } },
  })
  const session = await f.open()
  await session.descriptor()
  // The source's own override wins; keys it does not mention keep the contribution-wide value.
  assert.deepEqual(f.seen(), { cacheIndex: false, depth: 2 })
  await session.dispose()
})

test('a source without an override keeps the contribution-wide values', async () => {
  const f = fixture('file:///games/two', {
    values: { cacheIndex: true },
    bySource: { 'file:///games/one': { cacheIndex: false } },
  })
  const session = await f.open()
  await session.descriptor()
  assert.deepEqual(f.seen(), { cacheIndex: true })
  await session.dispose()
})

test('a codec without configured settings sees an empty record, never undefined', async () => {
  const f = fixture('file:///games/three', undefined)
  const session = await f.open()
  await session.descriptor()
  assert.deepEqual(f.seen(), {})
  await session.dispose()
})
