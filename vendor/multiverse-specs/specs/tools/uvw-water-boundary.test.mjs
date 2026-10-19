import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile, createUvwGltfDocument, restoreUvwProfileDocument } from './uvw-profile.mjs'
import { assertUvwWaterBoundary, UVW_WATER_POLYGON_MAX_POINTS } from './uvw-water-boundary.ts'

// the smallest world that converts to glTF, with one water zone added after its other layers
const fixture = JSON.parse(await readFile(new URL('../world/fixtures/uvw-unlit.uvw.json', import.meta.url), 'utf8'))
fixture.spaces[0].layers.push({
  schemaVersion: 1, id: 'water', kind: 'water',
  zones: [{ id: 'pool', minimum: [0.1, 0.1], maximum: [0.9, 0.9], elevation: 0 }],
})
const withPolygon = polygon => {
  const document = structuredClone(fixture)
  document.spaces[0].layers.find(layer => layer.kind === 'water').zones[0].polygon = polygon
  return document
}
const zone = polygon => ({ id: 'pool', minimum: [0, 0], maximum: [4, 4], polygon })

test('a water boundary survives the spatial profile and the glTF graph in its authored order', () => {
  for (const polygon of [
    [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
    [[0.9, 0.9], [0.1, 0.9], [0.5, 0.1]],
    [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.5, 0.4], [0.1, 0.9]],
  ]) {
    const document = withPolygon(polygon)
    assertUvwProfile(document)
    assert.deepEqual(restoreUvwProfileDocument(createUvwGltfDocument(document)), document)
  }
  // without a polygon the zone stays the rectangle it was
  assertUvwProfile(fixture)
})

test('a water boundary is a simple open ring with area inside its bounds', () => {
  const refused = {
    'too few points': [[0, 0], [1, 0]],
    'outside bounds': [[0, 0], [5, 0], [0, 1]],
    'closing point repeated': [[0, 0], [1, 0], [0, 1], [0, 0]],
    'consecutive duplicate': [[0, 0], [1, 0], [1, 0], [0, 1]],
    'no area': [[0, 0], [1, 1], [2, 2]],
    'bow tie': [[0, 0], [2, 2], [2, 0], [0, 2]],
    'touching vertex': [[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 1]],
    'fold back': [[0, 0], [2, 0], [1, 0], [1, 2]],
    'not finite': [[0, 0], [Number.NaN, 0], [0, 1]],
  }
  for (const [name, polygon] of Object.entries(refused))
    assert.throws(() => assertUvwWaterBoundary(zone(polygon)), /uvw-water-boundary/, name)
  assert.throws(
    () => assertUvwWaterBoundary(zone(Array.from({ length: UVW_WATER_POLYGON_MAX_POINTS + 1 }, (_, i) => [i % 4, 0]))),
    /3\.\.4096/,
  )
  // either winding, convex or not, collinear runs that keep going forward
  for (const polygon of [
    [[0, 0], [2, 0], [2, 2], [0, 2]],
    [[0, 0], [0, 2], [2, 2], [2, 0]],
    [[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]],
    [[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]],
  ])
    assert.doesNotThrow(() => assertUvwWaterBoundary(zone(polygon)))
  // the graph refuses what the boundary rule refuses
  assert.throws(() => assertUvwProfile(withPolygon([[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]])), /uvw-water-boundary/)
})

test('translation preserves a small boundary, while arithmetic overflow refuses explicitly', () => {
  const origin = 1e9
  assert.doesNotThrow(() => assertUvwWaterBoundary({
    id: 'translated', minimum: [origin, origin], maximum: [origin + 1, origin + 1],
    polygon: [[origin, origin], [origin + 1, origin], [origin, origin + 1]],
  }))
  assert.throws(() => assertUvwWaterBoundary({
    id: 'overflow', minimum: [0, 0], maximum: [1e308, 1e308],
    polygon: [[0, 0], [1e308, 0], [0, 1e308]],
  }), /uvw-water-boundary.*arithmetic/)
})
