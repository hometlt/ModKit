import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssetSession } from '@modkit/host'
import { sha1Hex } from '@modkit/codec-kit/crypto/sha1'
import { createInspectionCodec, INSPECTION_OPERATIONS } from '../dist/index.js'

const sign = Object.freeze({
  id: 'example/inspection.sign',
  handlerId: 'sign',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  outputKinds: Object.freeze(['json']),
})
const reason = 'Signing requires signature information for this document'
const bytes = new TextEncoder().encode('fixture')

test('the direct SHA1 export resolves the canonical implementation', () => {
  assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d')
})

function fixture(kind, operationStates, operations = [sign]) {
  let calls = 0
  let releases = 0
  const root = { id: 'fixture', uri: 'memory:fixture' }
  const revisions = {
    topology: kind,
    revision: 'provider-token:fixture-revision',
    namespaceRevision: 'provider-token:fixture-namespace-revision',
  }
  const lease = value => ({
    value,
    release: async () => {
      releases++
    },
  })
  const input =
    kind === 'namespace'
      ? { originKind: kind, root, revisions, openNamespace: async () => lease({}) }
      : {
          originKind: kind,
          revisions,
          primaryBindingId: 'content',
          bindings: [
            {
              bindingId: 'content',
              role: 'content',
              source: root,
              sourceKind: 'candidate',
              ownership: 'owned',
              revision: revisions.revision,
            },
          ],
          openBinding: async () =>
            lease({
              kind: 'bytes',
              ref: root,
              size: BigInt(bytes.length),
              read: async (offset, length) => bytes.slice(Number(offset), Number(offset) + length),
            }),
        }
  const detect = async () => ({ confidence: 1, kind: 'structure' })
  const inspect = async () => ({
    summary: { kind },
    traits: [],
    metadata: [],
    detection: await detect(),
    ...(operationStates === undefined ? {} : { operationStates }),
    handlers: {
      sign: async input => {
        calls++
        return { kind: 'json', value: input }
      },
    },
  })
  const codec = createInspectionCodec({
    id: 'example/inspection',
    format: { id: 'example/fixture', label: 'Fixture' },
    operations,
    ...(kind === 'namespace' ? { namespace: { detect, inspect } } : { detect, inspect }),
  })
  return {
    open: () => codec.open(input, { kind: 'inspect' }, { maxInputBytes: 1024n }),
    calls: () => calls,
    releases: () => releases,
  }
}

for (const kind of ['single', 'namespace']) {
  test(`${kind}: explicit shared operation contracts replace defaults without duplicates`, async () => {
    const validate = {
      id: 'asset.validate',
      handlerId: 'sign',
      mutatesSource: false,
      requiredPermissions: ['read-source'],
      outputKinds: ['json'],
    }
    const session = await fixture(kind, undefined, [validate]).open()
    try {
      const descriptor = await session.descriptor()
      assert.equal(
        descriptor.operations.filter(operation => operation.id === 'asset.validate').length,
        1,
      )
      assert.equal(
        descriptor.operations.find(operation => operation.id === 'asset.validate').handlerId,
        'sign',
      )
      assert.equal(
        (await session.operations().invoke('sign', { checked: true })).output.kind,
        'json',
      )
    } finally {
      await session.dispose()
    }
    assert.throws(
      () => fixture(kind, undefined, [validate, validate]),
      /Duplicate custom operation/,
    )
    assert.throws(
      () => fixture(kind, undefined, [{ ...sign, handlerId: 'inspect' }]),
      /Duplicate operation handler/,
    )
  })
  test(`${kind}: omitted states retain shared and custom operation behavior`, async () => {
    const f = fixture(kind)
    const session = await f.open()
    try {
      const descriptor = await session.descriptor()
      assert.equal(descriptor.operations.length, kind === 'namespace' ? 3 : 4)
      assert.ok(descriptor.operations.every(operation => operation.state === 'available'))
      assert.deepEqual(await session.operations().invoke('sign', { value: 7 }), {
        state: 'ok',
        output: { kind: 'json', value: { value: 7 } },
        diagnostics: [],
      })
      assert.equal(f.calls(), 1)
      assert.equal((await session.operations().invoke('inspect', null)).state, 'ok')
    } finally {
      await session.dispose()
    }
    assert.equal(f.releases(), 1)
  })

  for (const state of ['disabled', 'dependency-required']) {
    test(`${kind}: ${state} is published and refused before the custom handler`, async () => {
      const override = { id: sign.id, state, reason }
      const states = [override]
      const f = fixture(kind, states)
      const session = await f.open()
      try {
        const descriptor = await session.descriptor()
        assert.deepEqual(
          descriptor.operations.find(operation => operation.id === sign.id),
          {
            id: sign.id,
            handlerId: sign.handlerId,
            mutatesSource: true,
            state,
            reason,
          },
        )
        // The parser cannot mutate a published session back into an available state.
        override.state = 'available'
        states.length = 0
        const rejected = await session.operations().invoke('sign', null)
        assert.equal(rejected.state, 'rejected')
        assert.equal(rejected.reason, state)
        assert.equal(rejected.diagnostics[0].message, reason)
        assert.equal(f.calls(), 0)
        assert.equal((await session.operations().invoke('inspect', null)).state, 'ok')
        const nextSession = await f.open()
        try {
          assert.equal((await nextSession.operations().invoke('sign', null)).state, 'ok')
          assert.equal((await session.operations().invoke('sign', null)).reason, state)
          assert.equal(f.calls(), 1)
        } finally {
          await nextSession.dispose()
        }
      } finally {
        await session.dispose()
      }
      assert.equal(f.releases(), 2)
    })
  }

  test(`${kind}: explicit availability retains declaration identity and permission checks`, async () => {
    const f = fixture(kind, [
      {
        id: sign.id,
        state: 'available',
        handlerId: 'inspect',
        mutatesSource: false,
        requiredPermissions: [],
      },
    ])
    const session = await f.open()
    try {
      const descriptor = await session.descriptor()
      assert.deepEqual(
        descriptor.operations.find(operation => operation.id === sign.id),
        {
          id: sign.id,
          handlerId: 'sign',
          mutatesSource: true,
          state: 'available',
        },
      )
      assert.equal(descriptor.constraints.readOnly, false)
      const restricted = createAssetSession({
        descriptor,
        revision: descriptor.revision,
        operationDeclarations: [...INSPECTION_OPERATIONS, sign],
        permissionGrant: { id: 'read-only-fixture', classes: ['read-source'] },
        handlers: new Map([
          [
            'sign',
            async () => {
              assert.fail('permission bypass')
            },
          ],
        ]),
        openDataSource: async () => {
          assert.fail('unexpected data source request')
        },
      }).session
      try {
        const denied = await restricted.operations().invoke('sign', null)
        assert.equal(denied.state, 'rejected')
        assert.equal(denied.reason, 'permission-missing')
      } finally {
        await restricted.dispose()
      }
      assert.equal((await session.operations().invoke('sign', 7)).state, 'ok')
      assert.equal(f.calls(), 1)
    } finally {
      await session.dispose()
    }
  })

  test(`${kind}: shared operations can be disabled for a document`, async () => {
    const f = fixture(kind, [{ id: 'view.inspect', state: 'disabled', reason }])
    const session = await f.open()
    try {
      assert.equal((await session.operations().invoke('inspect', null)).reason, 'disabled')
      assert.equal((await session.operations().invoke('sign', null)).state, 'ok')
    } finally {
      await session.dispose()
    }
  })

  for (const [label, states, pattern] of [
    ['unknown id', [{ id: 'example/inspection.unknown', state: 'available' }], /undeclared/],
    [
      'duplicate id',
      [
        { id: sign.id, state: 'available' },
        { id: sign.id, state: 'disabled', reason },
      ],
      /duplicate/,
    ],
    ['invalid state', [{ id: sign.id, state: 'unsupported' }], /invalid operation state/],
    ['missing reason', [{ id: sign.id, state: 'disabled' }], /invalid operation state/],
    ['empty reason', [{ id: sign.id, state: 'disabled', reason: '' }], /invalid operation state/],
    [
      'object reason',
      [{ id: sign.id, state: 'disabled', reason: { message: reason } }],
      /invalid operation state/,
    ],
    ['available reason', [{ id: sign.id, state: 'available', reason }], /cannot have a reason/],
  ]) {
    test(`${kind}: rejects ${label} and releases the opened input`, async () => {
      const f = fixture(kind, states)
      await assert.rejects(f.open(), pattern)
      assert.equal(f.calls(), 0)
      assert.equal(f.releases(), 1)
    })
  }
}
