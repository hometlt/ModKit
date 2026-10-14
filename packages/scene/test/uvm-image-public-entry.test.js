/** Public image acquisition entry: one mapper shared by model/GIF/world callers; no second decoder. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareUvmTextureImages, uvmImageTexels } from '@modkit/scene/uvm/images'

test('public UVM image mapper preserves texture indices and leaves URI authority with Host', () => {
  const document = {
    textures: [{ source: 1 }, { source: 0 }],
    images: [{ uri: 'modkit-resource:textures/body' }, { uri: 'modkit-resource:textures/normal' }],
  }
  const requests = prepareUvmTextureImages(document, new Uint8Array(), [0, 1], 1024)
  assert.deepEqual(requests.map((request) => [request.texture, request.image]), [[0, 1], [1, 0]])
  assert.equal(requests[0].source.kind, 'logical')
  assert.equal(typeof uvmImageTexels, 'function')
  const ambient = prepareUvmTextureImages({ textures: [{ source: 0 }],
    images: [{ uri: 'file:///ambient.png' }] }, new Uint8Array(), [0], 1024)
  assert.equal(ambient[0].source.kind, 'logical')
  assert.equal(ambient[0].source.requirement.logicalId, 'file:///ambient.png')
  assert.throws(() => prepareUvmTextureImages(document, new Uint8Array(), [2], 1024))
})
