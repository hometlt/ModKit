import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readUvmKeyTimes, uvmKeyTimesMetadata } from '@modkit/uv/model/key-times'
import { sampleTrackValue } from '@modkit/codec-kit/model-math/sequence-pose'

test('exact key times retain 100ms boundaries, with bounded accessor coherence and strict version', () => {
  const metadata = uvmKeyTimesMetadata([0, 0.1, 0.2]).keyTimes
  const input = { values: Float32Array.from([0, 0.1, 0.2]), maxScalarBytes: 24 }
  assert.deepEqual(readUvmKeyTimes(metadata, input), [0, 0.1, 0.2])
  assert.deepEqual(uvmKeyTimesMetadata([0, 1]), {})
  assert.throws(() => readUvmKeyTimes(metadata, { ...input, maxScalarBytes: 23 }), /budget/)
  assert.throws(() => readUvmKeyTimes({ ...metadata, seconds: [0, 0.11, 0.2] }, input), /accessor/)
  assert.throws(() => readUvmKeyTimes({ ...metadata, seconds: [0, 0.1, 0.1] }), /increase/)
  assert.throws(() => readUvmKeyTimes({ ...metadata, version: 2 }), /version/)
  assert.throws(() => readUvmKeyTimes(metadata, input, AbortSignal.abort()))
})
test('independent clocks select exact discrete keys after many decimal periods', () => {
  const track = {
    lineType: 0,
    globalSeqId: null,
    keys: [
      { frame: 0, vector: [0] },
      { frame: 0.1, vector: [1] },
      { frame: 0.2, vector: [0] },
    ],
  }
  for (const time of [0.1, 0.3, 0.5, 1.1, 1000.1])
    assert.deepEqual(sampleTrackValue(track, time, [], { wrapSeconds: 0.2 }), [1], `time=${time}`)
  for (const time of [0, 0.2, 0.4, 1, 1000])
    assert.deepEqual(sampleTrackValue(track, time, [], { wrapSeconds: 0.2 }), [0], `time=${time}`)
  assert.deepEqual(sampleTrackValue(track, 0.099999, [], { wrapSeconds: 0.2 }), [0])
})
