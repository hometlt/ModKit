import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openUvmDocument } from '../src/uvm/document.js'
import { writeUvmContainer } from '@modkit/uv/model/container'

const fixture = () =>
  writeUvmContainer({
    format: 'glb',
    document: {
      asset: { version: '2.0' },
      nodes: [{ name: 'original' }],
      extras: { BlizzardM3: { opaque: [17, 'unknown'] } },
    },
    binary: Uint8Array.of(1, 2, 3, 4),
    extraChunks: [{ type: 0x12345678, bytes: Uint8Array.of(7, 8, 9, 10) }],
  })
const rename = (expectedRevision, value) => ({
  expectedRevision,
  json: [{ op: 'replace', path: '/nodes/0/name', value }],
})
function stateCosts() {
  const document = openUvmDocument(fixture(), { maxHistoryEntries: 0 })
  try {
    const original = document.status().retainedBytes
    const first = document.apply(rename(0, 'first')).retainedBytes
    const second = document.apply(rename(1, 'second')).retainedBytes
    return { original, first, second }
  } finally {
    document.dispose()
  }
}

test('reset is opt-in and never pins hidden original bytes for existing callers', () => {
  const costs = stateCosts(),
    limit = Math.max(costs.original, costs.first)
  const ordinary = openUvmDocument(fixture(), { maxHistoryEntries: 0, maxHistoryBytes: limit })
  try {
    const state = ordinary.apply(rename(0, 'first'))
    assert.equal(state.retainedBytes, costs.first)
    assert.throws(() => ordinary.reset(state.revision), /not enabled/)
  } finally {
    ordinary.dispose()
  }
  const resettable = openUvmDocument(fixture(), {
    resettable: true,
    maxHistoryEntries: 0,
    maxHistoryBytes: limit,
  })
  try {
    const before = resettable.status()
    assert.throws(() => resettable.apply(rename(0, 'first')), /maxHistoryBytes/)
    assert.deepEqual(resettable.status(), before)
  } finally {
    resettable.dispose()
  }
})

test('reset pins the initial state once and restores exact bytes after history eviction', () => {
  const original = fixture(),
    expected = original.slice(),
    costs = stateCosts()
  const limit = costs.original + Math.max(costs.first, costs.second)
  const document = openUvmDocument(original, {
    resettable: true,
    maxHistoryEntries: 0,
    maxHistoryBytes: limit,
  })
  try {
    assert.equal(document.status().retainedBytes, costs.original)
    assert.equal(document.reset(0).revision, 0)
    original.fill(0)
    document.apply(rename(0, 'first'))
    const changed = document.apply(rename(1, 'second'))
    assert.equal(changed.canUndo, false)
    assert.equal(changed.retainedBytes, costs.original + costs.second)
    const reset = document.reset(2)
    assert.deepEqual(reset, {
      revision: 3,
      modified: false,
      canUndo: false,
      canRedo: false,
      retainedBytes: costs.original,
    })
    assert.deepEqual(document.serialize(3), expected)
    document.snapshot().binary.fill(0)
    document.snapshot().extraChunks[0].bytes.fill(0)
    assert.deepEqual(document.serialize(3), expected)
    assert.equal(document.reset(3).revision, 3)
    assert.throws(() => document.apply(rename(0, 'stale')), /stale/)
  } finally {
    document.dispose()
  }
  assert.throws(() => document.reset(3), /disposed/)
})

test('reset clears undo and redo even if undo already restored the original state', () => {
  const document = openUvmDocument(fixture(), { resettable: true })
  try {
    document.apply(rename(0, 'first'))
    const undone = document.undo(1)
    assert.equal(undone.modified, false)
    assert.equal(undone.canRedo, true)
    assert.throws(() => document.reset(1), /stale/)
    const reset = document.reset(2)
    assert.equal(reset.revision, 3)
    assert.equal(reset.canRedo, false)
    assert.equal(reset.canUndo, false)
    assert.equal(document.redo(3).revision, 3)
  } finally {
    document.dispose()
  }
})

test('counting the same initial state in undo/current/redo never charges it twice', () => {
  const costs = stateCosts(),
    document = openUvmDocument(fixture(), { resettable: true })
  try {
    assert.equal(document.apply(rename(0, 'first')).retainedBytes, costs.original + costs.first)
    assert.equal(document.undo(1).retainedBytes, costs.original + costs.first)
    assert.equal(document.redo(2).retainedBytes, costs.original + costs.first)
    assert.equal(document.reset(3).retainedBytes, costs.original)
  } finally {
    document.dispose()
  }
})

test('a rejected over-budget candidate preserves redo and a reset during validation invalidates the outer revision', () => {
  const costs = stateCosts(),
    original = fixture()
  const document = openUvmDocument(original, {
    resettable: true,
    maxHistoryBytes: costs.original + costs.first,
  })
  try {
    document.apply(rename(0, 'first'))
    document.undo(1)
    const before = document.status()
    assert.throws(() => document.apply(rename(2, 'x'.repeat(1000))), /maxHistoryBytes/)
    assert.deepEqual(document.status(), before)
    document.redo(2)
    assert.equal(document.snapshot().document.nodes[0].name, 'first')
  } finally {
    document.dispose()
  }
  let resetDuringValidation = false,
    reentrant
  reentrant = openUvmDocument(original, {
    resettable: true,
    validate() {
      if (resetDuringValidation) {
        resetDuringValidation = false
        reentrant.reset(1)
      }
    },
  })
  try {
    reentrant.apply(rename(0, 'first'))
    resetDuringValidation = true
    assert.throws(() => reentrant.apply(rename(1, 'second')), /stale/)
    assert.equal(reentrant.status().revision, 2)
    assert.deepEqual(reentrant.serialize(2), original)
  } finally {
    reentrant.dispose()
  }
})

test('cancelled reset leaves current state and history untouched', () => {
  const abort = new AbortController(),
    document = openUvmDocument(fixture(), { resettable: true, signal: abort.signal })
  document.apply(rename(0, 'first'))
  abort.abort()
  assert.throws(() => document.reset(1), /cancel|abort/i)
  document.dispose()
})
