import assert from 'node:assert/strict'
import { it } from 'node:test'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { prepareUvmEditRequest } from '../src/uvm/operations.js'

const fixture = () =>
  writeUvmContainer({
    format: 'glb',
    extraChunks: [],
    document: { asset: { version: '2.0' }, buffers: [{ byteLength: 4 }], name: 'before' },
    binary: Uint8Array.of(1, 2, 3, 4),
  })

it('prepares one validated candidate containing both JSON and binary operation edits', () => {
  const input = fixture(),
    original = input.slice()
  const output = prepareUvmEditRequest(
    input,
    {
      json: [{ op: 'replace', path: '/name', value: 'after' }],
      binary: [{ byteOffset: 1, bytesHex: 'ff00' }],
    },
    {
      validate(container) {
        if (container.document.name === 'after')
          assert.deepEqual(container.binary, Uint8Array.of(1, 255, 0, 4))
      },
    },
  )
  const reopened = readUvmContainer(output)
  assert.equal(reopened.document.name, 'after')
  assert.deepEqual(reopened.binary, Uint8Array.of(1, 255, 0, 4))
  assert.deepEqual(input, original)
  assert.deepEqual(
    readUvmContainer(prepareUvmEditRequest(input, { binary: [{ byteOffset: 0, bytesHex: 'aa' }] }))
      .binary,
    Uint8Array.of(170, 2, 3, 4),
  )
})

it('refuses malformed, overlapping, out-of-range and rejected candidates without changing input', () => {
  const input = fixture(),
    original = input.slice()
  for (const request of [
    {},
    { json: null },
    { binary: null },
    { binary: [{ byteOffset: -1, bytesHex: '00' }] },
    { binary: [{ byteOffset: 0, bytesHex: '0' }] },
    { binary: [{ byteOffset: 0, bytesHex: 'gg' }] },
    { binary: [{ byteOffset: 0, bytesHex: '' }] },
    { binary: [{ byteOffset: 4, bytesHex: '00' }] },
    {
      binary: [
        { byteOffset: 0, bytesHex: '0000' },
        { byteOffset: 1, bytesHex: '00' },
      ],
    },
  ])
    assert.throws(() => prepareUvmEditRequest(input, request))
  const request = {
    json: [{ op: 'replace', path: '/name', value: 'after' }],
    binary: [{ byteOffset: 0, bytesHex: '00' }],
  }
  assert.throws(() => prepareUvmEditRequest(input, request, { maxEdits: 1 }), /maxEdits/)
  assert.throws(() => prepareUvmEditRequest(input, request, { signal: AbortSignal.abort() }), {
    name: 'AbortError',
  })
  assert.throws(
    () =>
      prepareUvmEditRequest(input, request, {
        validate(container) {
          if (container.document.name === 'after') throw new Error('semantic rejection')
        },
      }),
    /semantic rejection/,
  )
  assert.deepEqual(input, original)
})
