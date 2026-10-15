import { expect, it } from 'vitest'
import { uvmImageResourceId } from '../src/model/container.js'
import { uvmImageResourceId as sceneIdentity } from '../../scene/src/uvm/images.js'

it('uses the same image identity in UV, Scene and renamed portable media', () => {
  expect(sceneIdentity).toBe(uvmImageResourceId)
  expect(uvmImageResourceId({ images: [{ name: 'authored/texture.dds', uri: 'media/packed.png' }] }, 0)).toBe('authored/texture.dds')
  expect(uvmImageResourceId({ images: [{ uri: 'textures/with%20space.png' }] }, 0)).toBe('textures/with space.png')
  expect(uvmImageResourceId({ images: [{ bufferView: 0 }] }, 0)).toBe('uvm-image-0')
  expect(() => uvmImageResourceId({ images: [] }, 0)).toThrow(RangeError)
})
