// The world browser payload `scripts/render-world-payload.mjs` renders: world.json holds the renderer
// input with every typed array, Map and bigint as a reference ({ $typed, offset, byteLength },
// { $map }, { $bigint }), world.bin the array bytes. Any game's product-route test writes one from
// the world it inspected (`inspectCandidateWorld`), so a headless render needs no game data.
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const EFFECTS = new TextEncoder().encode('UV_game_effects')

/** Whether the UVM declares model effects: the renderer simulates them from the UVM itself. */
function declaresEffects(bytes) {
  outer: for (let index = 0; index <= bytes.length - EFFECTS.length; index++) {
    for (let offset = 0; offset < EFFECTS.length; offset++)
      if (bytes[index + offset] !== EFFECTS[offset]) continue outer
    return true
  }
  return false
}

/**
 * The renderer input of an inspected world: its scene items without the resource and layer
 * listings or object catalogs, its converted models, terrain and water. A model keeps its UVM
 * bytes only when they carry effects (geyser smoke), to keep the payload small.
 */
export function worldRenderSource(inspected, { objects = () => true } = {}) {
  const players = inspected.info?.players ?? []
  const items = inspected.layers
    .flatMap(layer => [...(layer.layer.latticeOverview === undefined ? [] : [layer.layer]), ...layer.page.items])
    .flatMap(item => {
      if (item.facet === 'resources' || (item.facet === 'layers' && item.latticeOverview === undefined)) return []
      if (item.facet !== 'objects') return [item]
      if (!objects(item)) return []
      const { catalog: _catalog, ...renderItem } = item
      return [renderItem]
    })
  const models = new Map(
    [...(inspected.models ?? [])].flatMap(([id, model]) =>
      model.state === 'converted'
        ? [
            [
              id,
              {
                ...model,
                uvmBytes:
                  model.uvmBytes !== undefined && declaresEffects(model.uvmBytes)
                    ? model.uvmBytes
                    : undefined,
                diagnostics: [],
              },
            ],
          ]
        : [],
    ),
  )
  return {
    items,
    models,
    terrainMaterials: inspected.layers.flatMap(layer => layer.layer.materials ?? []),
    // The renderer input of packages/ui/src/world: without rasters every cell falls back to
    // constant per-cell splat weights.
    terrainWeightRasters: inspected.layers.flatMap(layer => layer.layer.weightRasters ?? []),
    terrainTextures: inspected.terrainTextures,
    waterMaterials: inspected.layers.flatMap(layer => layer.layer.waterMaterials ?? []),
    // player slots' colours and ramps, as drawCandidateWorld hands them to the renderer
    teamColors: new Map(
      players.flatMap(player => (player.color === undefined ? [] : [[player.id, player.color]])),
    ),
    teamRamps: new Map(
      players.flatMap(player =>
        player.colorRamp === undefined ? [] : [[player.id, player.colorRamp]],
      ),
    ),
  }
}

/**
 * The payload of a value: JSON text with references, and the bytes they point into. One array
 * object is stored once however often it occurs, so shared arrays stay shared when read back;
 * each starts 8-byte aligned, so the reader views it in place.
 */
export function encodeWorldPayload(value) {
  const chunks = []
  const views = new WeakMap()
  let byteLength = 0
  const encode = item => {
    if (item === undefined) return undefined
    if (typeof item === 'bigint') return { $bigint: item.toString() }
    if (ArrayBuffer.isView(item)) {
      let stored = views.get(item)
      if (stored === undefined) {
        const padding = (8 - (byteLength % 8)) % 8
        if (padding > 0) {
          chunks.push(new Uint8Array(padding))
          byteLength += padding
        }
        stored = { offset: byteLength, byteLength: item.byteLength }
        chunks.push(new Uint8Array(item.buffer, item.byteOffset, item.byteLength))
        byteLength += item.byteLength
        views.set(item, stored)
      }
      return { $typed: item.constructor.name, ...stored }
    }
    if (item instanceof Map)
      return { $map: [...item].map(([key, entry]) => [encode(key), encode(entry)]) }
    if (Array.isArray(item)) return item.map(encode)
    if (typeof item === 'object' && item !== null)
      return Object.fromEntries(
        Object.entries(item)
          .map(([key, entry]) => [key, encode(entry)])
          .filter(([, entry]) => entry !== undefined),
      )
    return item
  }
  const json = JSON.stringify(encode(value))
  return { json, chunks, byteLength }
}

/** Writes world.json, world.bin and meta.json of an inspected world into `directory`. */
export function writeWorldPayload(directory, inspected, { objects, meta = {} } = {}) {
  const { json, chunks, byteLength } = encodeWorldPayload(
    worldRenderSource(inspected, objects === undefined ? {} : { objects }),
  )
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'world.json'), json)
  const file = openSync(join(directory, 'world.bin'), 'w')
  try {
    for (const chunk of chunks) writeSync(file, chunk)
  } finally {
    closeSync(file)
  }
  const sizes = { jsonBytes: Buffer.byteLength(json), binaryBytes: byteLength }
  writeFileSync(
    join(directory, 'meta.json'),
    `${JSON.stringify({ snapshotId: inspected.snapshotId, ...sizes, ...meta }, null, 2)}\n`,
  )
  return sizes
}
