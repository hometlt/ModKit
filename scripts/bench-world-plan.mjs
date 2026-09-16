#!/usr/bin/env node
// CPU benchmark of the world draw plan (no GPU): the part of a frame that builds batches, material
// programs and pick meshes from a saved payload (MODKIT_WORLD_PAYLOAD_OUT).
//
//   node --cpu-prof --cpu-prof-dir <dir> scripts/bench-world-plan.mjs --payload <dir> [--time 3] [--runs 2]
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    payload: { type: 'string' },
    time: { type: 'string', default: '0' },
    runs: { type: 'string', default: '2' },
  },
})
if (values.payload === undefined) throw new TypeError('--payload is required')
const outfile = join(tmpdir(), `bench-world-plan-${process.pid}.mjs`)
await build({
  entryPoints: [join(coreRoot, 'packages/scene/src/world/webgl.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  sourcemap: 'inline',
  logLevel: 'error',
})
const { createWorldWebGlPlan } = await import(pathToFileURL(outfile).href)
const payloadDir = resolve(values.payload)
const binary = readFileSync(join(payloadDir, 'world.bin'))
const constructors = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array }
const revive = value => {
  if (Array.isArray(value)) return value.map(revive)
  if (value === null || typeof value !== 'object') return value
  if ('$bigint' in value) return BigInt(value.$bigint)
  if ('$typed' in value) {
    const bytes = binary.buffer.slice(binary.byteOffset + value.offset, binary.byteOffset + value.offset + value.byteLength)
    return value.$typed === 'DataView' ? new DataView(bytes) : new constructors[value.$typed](bytes)
  }
  if ('$map' in value) return new Map(value.$map.map(([key, item]) => [revive(key), revive(item)]))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]))
}
let started = performance.now()
const payload = revive(JSON.parse(readFileSync(join(payloadDir, 'world.json'), 'utf8')))
console.log(`[bench-world-plan] load ${Math.round(performance.now() - started)} ms`)
const timeSeconds = Number(values.time)
for (let run = 0; run < Number(values.runs); run += 1) {
  started = performance.now()
  const plan = createWorldWebGlPlan({ ...payload, timeSeconds })
  console.log(
    `[bench-world-plan] plan ${run}: ${Math.round(performance.now() - started)} ms, objects ${plan.stats.objectInstances}, model triangles ${plan.stats.modelTriangles}, material scenes ${plan.modelMaterialScenes.length}`,
  )
}
