import { expect, it } from 'vitest'
import { createUvmExportHandler } from '../src/model/export-handler.js'
import { readUvmContainer } from '../src/model/container.js'
import type { InspectionContext } from '@modkit/codec-kit'
import type { ModelProjection } from '../src/model/materializer.js'

const projection: ModelProjection = {
  info: {
    scenes: 1,
    nodes: 1,
    meshes: 1,
    primitives: 1,
    materials: 0,
    textures: 0,
    animations: 0,
    geometryAccess: 'decoded',
  },
  nodes: [
    {
      id: 'body',
      childIds: [],
      meshIds: ['mesh'],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    },
  ],
  meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
  primitives: [
    {
      id: 'triangle',
      topology: 'triangles',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: Uint32Array.from([0, 1, 2]),
    },
  ],
}
const context = {
  source: { revision: 'provider-token:fixture', ref: { id: 'fixture/triangle' } },
  budget: { maxScalarBytes: 1024 * 1024, maxNodes: 1000, maxDepth: 32 },
} as InspectionContext
const fixed = { sourceFormat: 'fixture-fixed', sourceUnit: 'source-unit', metersPerSourceUnit: 1 }

it('exports through the canonical UVM materializer with codec-selected units', async () => {
  const handler = createUvmExportHandler(projection, context, fixed)
  const result = await handler({ schemaVersion: 1 }, {} as never)
  expect(result.kind).toBe('bytes')
  if (result.kind !== 'bytes') throw new Error('expected UVM bytes')
  const container = readUvmContainer(result.value)
  expect(container.document['asset']).toBeDefined()
  expect(container.document['meshes']).toHaveLength(1)
  expect(container.binary.byteLength).toBeGreaterThan(0)
})

it('preserves explicit scale opt-in and rejects invalid requests', async () => {
  const strict = createUvmExportHandler(projection, context, fixed)
  await expect(strict({ schemaVersion: 1, metersPerSourceUnit: 2 }, {} as never)).rejects.toThrow(
    /option/u,
  )
  for (const input of [null, [], 1, {}, { schemaVersion: 2 }])
    await expect(strict(input, {} as never)).rejects.toThrow(TypeError)
  const scaled = createUvmExportHandler(projection, context, {
    ...fixed,
    metersPerSourceUnit: 0.01,
    allowUnitOverride: true,
  })
  const a = await scaled({ schemaVersion: 1 }, {} as never)
  const b = await scaled({ schemaVersion: 1, metersPerSourceUnit: 2 }, {} as never)
  if (a.kind !== 'bytes' || b.kind !== 'bytes') throw new Error('expected UVM bytes')
  expect(a.value).not.toEqual(b.value)
  await expect(scaled({ schemaVersion: 1, metersPerSourceUnit: 0 }, {} as never)).rejects.toThrow(
    /positive/u,
  )
  await expect(
    scaled({ schemaVersion: 1, metersPerSourceUnit: null }, {} as never),
  ).rejects.toThrow(/positive/u)
})

it('honors source cancellation when no invocation signal is supplied', async () => {
  const controller = new AbortController()
  controller.abort()
  const handler = createUvmExportHandler(
    projection,
    { ...context, signal: controller.signal },
    fixed,
  )
  await expect(handler({ schemaVersion: 1 }, {} as never)).rejects.toThrow(/abort/iu)
})
