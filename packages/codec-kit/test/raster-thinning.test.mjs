import { test } from 'node:test'
import assert from 'node:assert/strict'
import { thinBinaryMask, fillSmallBinaryHoles, binaryMaskComponents } from '../dist/raster/thinning.js'

test('narrows a broad straight band without modifying input or disconnecting its path', () => {
  const mask = new Uint8Array(15 * 15)
  for (let y = 1; y < 14; y++) for (let x = 5; x < 10; x++) mask[x + y * 15] = 1
  const copy = mask.slice(), out = thinBinaryMask(15, 15, mask)
  assert.deepEqual(mask, copy)
  for (let y = 4; y < 10; y++) assert.equal(out.slice(y * 15, (y + 1) * 15).reduce((a, b) => a + b, 0), 1)
  assert.ok(out.reduce((a, b) => a + b, 0) >= 7)
  assert.deepEqual(thinBinaryMask(15, 15, out), out)
})
test('retains a ring hole and rejects oversized or cancelled work', () => {
  const mask = new Uint8Array(81)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) if (x < 3 || x > 5 || y < 3 || y > 5) mask[x + y * 9] = 1
  const out = thinBinaryMask(9, 9, mask)
  assert.equal(out[4 + 4 * 9], 0)
  assert.ok(out.slice(9, 36).some(Boolean))
  assert.ok(out.slice(45, 72).some(Boolean))
  assert.throws(() => thinBinaryMask(2, 3, new Uint8Array(2)))
  const controller = new AbortController(); controller.abort()
  assert.throws(() => thinBinaryMask(9, 9, mask, controller.signal))
})

test('does not erase a two-by-two component', () => {
  const out = thinBinaryMask(2, 2, Uint8Array.from([1,1,1,1]))
  assert.ok(out.some(Boolean))
})

test('fills only small enclosed raster holes, preserving the exterior and larger interiors', () => {
  const mask = new Uint8Array(81).fill(1)
  mask[0] = 0; mask[2 + 2 * 9] = 0
  for(let y=4;y<7;y++)for(let x=4;x<7;x++)mask[x+y*9]=0
  const out = fillSmallBinaryHoles(9,9,mask,1)
  assert.equal(out[0],0)
  assert.equal(out[2+2*9],1)
  assert.equal(out[5+5*9],0)
  assert.equal(mask[2+2*9],0)
})

test('reports isolated and exterior zero regions without mutating the barrier mask', () => {
  const mask = Uint8Array.from([0,1,1,1,1, 1,0,0,1,1, 1,1,1,1,1])
  const regions=[...binaryMaskComponents(5,3,mask)]
  assert.deepEqual(regions,[{cells:[0],exterior:true},{cells:[6,7],exterior:false}])
  assert.equal(mask[6],0)
  assert.throws(()=>[...binaryMaskComponents(2,2,new Uint8Array(3))])
  const controller=new AbortController();controller.abort()
  assert.throws(()=>[...binaryMaskComponents(1,1,new Uint8Array(1),controller.signal)])
})