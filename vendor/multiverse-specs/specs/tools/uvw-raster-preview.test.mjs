import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertUvwRasterInlinePreview } from './uvw-raster-preview.mjs'

const layer = { rows: 3, columns: 3, materials: [{ id: 'grass' }, { id: 'rock' }],
  rasterSampling: { coordinates: 'material-grid-extent', filter: 'bilinear',
    wrap: 'clamp', normalization: 'sum', zeroSum: { mode: 'refuse' } } }
const sample = grass => ({ weights: grass === 1 ? [{ materialId: 'grass', weight: 1 }]
  : grass === 0 ? [{ materialId: 'rock', weight: 1 }]
    : [{ materialId: 'grass', weight: grass }, { materialId: 'rock', weight: 1 - grass }] })
const inline = [[sample(1), sample(0.5), sample(0)],
  [sample(0.5), sample(0.5), sample(0.5)],
  [sample(0), sample(0.5), sample(1)]]
const raster = { width: 2, height: 2, materialIds: ['grass', 'rock'],
  bytes: Uint8Array.from([255, 0, 0, 0, 0, 255, 0, 0,
    0, 255, 0, 0, 255, 0, 0, 0]) }

test('inline preview checks bilinear texel centres, edges and normalization', () => {
  assert.equal(assertUvwRasterInlinePreview(layer, inline, [raster], 0), undefined)
  const wrong = structuredClone(inline)
  wrong[1][1] = sample(0.6)
  assert.throws(() => assertUvwRasterInlinePreview(layer, wrong, [raster], 0),
    /uvw-raster-preview-mismatch/)
  const transformed = structuredClone(inline)
  transformed[0][0].uvTransform = { offset: [0, 0], scale: [1, 1], rotation: 0 }
  assert.throws(() => assertUvwRasterInlinePreview(layer, transformed, [raster], 0),
    /uvw-raster-preview-inline/)
  assert.throws(() => assertUvwRasterInlinePreview(layer, inline, [raster], 0.1),
    /uvw-raster-preview-policy/)
  const duplicate = { ...raster, materialIds: ['grass', 'grass'] }
  assert.throws(() => assertUvwRasterInlinePreview(layer, inline, [duplicate], 0),
    /uvw-raster-preview-raster/)
})
