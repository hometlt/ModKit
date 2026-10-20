import { expect, it } from 'vitest'
import { voxelizeScene } from '../src/model/voxelize.js'
import { readUvmContainer } from '@modkit/uv/model/container'
import { readUvmModel } from '../src/uvm/model.js'
import { createModelSceneSampler } from '../src/model/sampler.js'

const scene = {
  primitives: [
    {
      id: 'plateau',
      topology: 'triangles' as const,
      positions: Float32Array.from([0, 2, 0, 8, 2, 0, 8, 2, 8, 0, 2, 8]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
      materialId: 'ground',
    },
  ],
  materials: [{ id: 'ground', baseColor: [0.2, 0.7, 0.3, 1] as const }],
}
const options = {
  region: 'southwest' as const,
  resolution: 16,
  assetId: 'test/quarter',
  revision: 'provider-token:scene-voxel-test',
  maxBytes: 8 * 1024 ** 2,
}
it('clips crossing triangles to the southwest quarter, preserves the source frame and writes reopenable coloured voxel faces', async () => {
  const result = await voxelizeScene(scene, options)
  expect(result.receipt.bounds).toEqual([0, 4, 4, 8])
  expect(result.receipt.cells).toBeGreaterThan(0)
  expect(result.receipt.cellSize).toBeCloseTo(4 / 15.5)
  const container = readUvmContainer(result.bytes)
  const model = readUvmModel(container.document, container.binary, {
    maxScalarBytes: 8 * 1024 ** 2,
  })
  const sampled = createModelSceneSampler(model.scene).sample(0)
  expect(sampled.primitives.length).toBeGreaterThan(0)
  const p = model.scene.primitives[0]!
  expect(p.colors![0]).toBeCloseTo(0.2, 2)
  expect(p.colors![1]).toBeCloseTo(0.7, 2)
  const transform = result.receipt.gridToSource
  expect(transform[12]).toBeLessThanOrEqual(0)
  expect(transform[14]).toBeCloseTo(4 - result.receipt.cellSize / 4)
})
it('refuses unsupported material semantics, invalid resolutions and cancellation', async () => {
  await expect(
    voxelizeScene({ ...scene, materials: [{ id: 'ground', alphaMode: 'blend' }] }, options),
  ).rejects.toThrow(/unsupported/)
  await expect(voxelizeScene(scene, { ...options, resolution: 129 })).rejects.toThrow()
  const controller = new AbortController()
  controller.abort()
  await expect(voxelizeScene(scene, { ...options, signal: controller.signal })).rejects.toThrow()
})
