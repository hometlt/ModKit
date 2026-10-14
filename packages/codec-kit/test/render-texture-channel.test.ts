import { expect, it } from 'vitest'
import {
  isRenderTextureChannel,
  type StandardMaterialLayer,
} from '../src/legacy/models/material.js'

it('bounds render-texture channels independently of material UV selection', () => {
  const layer: Pick<StandardMaterialLayer, 'renderTextureChannel' | 'uvSource'> = {
    renderTextureChannel: 6,
    uvSource: 17,
  }
  expect(layer.renderTextureChannel).toBe(6)
  expect([0, 1, 2, 3, 4, 5, 6].every(isRenderTextureChannel)).toBe(true)
  expect([-1, 7, 0.5, NaN, '2', null].some(isRenderTextureChannel)).toBe(false)
})
