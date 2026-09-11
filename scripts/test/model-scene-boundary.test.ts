import { build } from 'esbuild'
import { expect, it } from 'vitest'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('bundle metadata is absent')
  return value
}

it('scene model processing bundles without UI, platform or native codec runtime', async () => {
  const result = await build({
    entryPoints: ['packages/scene/src/model/index.ts'],
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  })
  expect(
    Object.values(required(result.metafile).outputs).flatMap(output => output.imports),
  ).toEqual([])
  const allowed = new Set([
    'packages/scene/src/model/index.ts',
    'packages/scene/src/model/sampler.ts',
    'packages/scene/src/model/unweighted.ts',
    'packages/codec-kit/dist/json-snapshot.js',
    'packages/codec-kit/dist/model/geometry.js',
    'packages/codec-kit/dist/model/skeleton.js',
    'packages/codec-kit/dist/model/animation.js',
    'packages/codec-kit/dist/model/skinning.js',
    'packages/codec-kit/dist/model/legacy/skinning-kernels.js',
    'packages/codec-kit/dist/model-math/sequence-pose.js',
  ])
  expect(new Set(Object.keys(required(result.metafile).inputs))).toEqual(allowed)
})

for (const [entry, inputs] of [
  [
    'packages/scene/src/uvm/sockets.ts',
    [
      'packages/codec-kit/dist/json-snapshot.js',
      'packages/codec-kit/dist/legacy/core/errors.js',
      'packages/codec-kit/dist/legacy/core/logger.js',
      'packages/codec-kit/dist/legacy/core/index.js',
      'packages/uv/dist/model/legacy/container-kernels.js',
      'packages/uv/dist/model/container.js',
      'packages/uv/dist/model/validation/values.js',
      'packages/uv/dist/model/validation/spatial.js',
      'packages/uv/dist/model/validation/effects.js',
      'packages/uv/dist/model/accessor.js',
      'packages/uv/dist/model/validation/animation.js',
      'packages/uv/dist/model/validation/materials.js',
      'packages/uv/dist/model/validation/index.js',
      'packages/scene/src/uvm/values.ts',
      'packages/scene/src/uvm/sockets.ts',
    ],
  ],
  [
    'packages/scene/src/uvm/inspection.ts',
    [
      'packages/codec-kit/dist/paging.js',
      'packages/codec-kit/dist/json-snapshot.js',
      'packages/codec-kit/dist/model/materials.js',
      'packages/codec-kit/dist/model-math/sequence-pose.js',
      'packages/codec-kit/dist/model/animation.js',
      'packages/codec-kit/dist/model/skeleton.js',
      'packages/codec-kit/dist/model/geometry.js',
      'packages/codec-kit/dist/model/sources.js',
      'packages/codec-kit/dist/projection.js',
      'packages/codec-kit/dist/tree/json-tree.js',
      'packages/uv/dist/model/validation/values.js',
      'packages/uv/dist/model/validation/spatial.js',
      'packages/uv/dist/model/validation/effects.js',
      'packages/uv/dist/model/accessor.js',
      'packages/uv/dist/model/validation/animation.js',
      'packages/uv/dist/model/validation/materials.js',
      'packages/uv/dist/model/validation/index.js',
      'packages/scene/src/uvm/values.ts',
      'packages/scene/src/uvm/rig.ts',
      'packages/scene/src/uvm/geometry.ts',
      'packages/scene/src/uvm/model.ts',
      'packages/scene/src/uvm/collision-mesh.ts',
      'packages/scene/src/uvm/facets.ts',
      'packages/scene/src/uvm/inspection.ts',
    ],
  ],
  [
    'packages/uv/src/model/validation/index.ts',
    [
      'packages/uv/src/model/validation/index.ts',
      'packages/uv/src/model/validation/values.ts',
      'packages/uv/src/model/validation/spatial.ts',
      'packages/uv/src/model/validation/materials.ts',
      'packages/uv/src/model/validation/effects.ts',
      'packages/uv/src/model/validation/animation.ts',
      'packages/uv/src/model/accessor.ts',
    ],
  ],
  [
    'packages/scene/src/uvm/facets.ts',
    [
      'packages/uv/dist/model/accessor.js',
      'packages/scene/src/uvm/values.ts',
      'packages/scene/src/uvm/collision-mesh.ts',
      'packages/scene/src/uvm/facets.ts',
    ],
  ],
  [
    'packages/scene/src/uvm/model.ts',
    [
      'packages/uv/dist/model/accessor.js',
      'packages/codec-kit/dist/model-math/sequence-pose.js',
      'packages/scene/src/uvm/values.ts',
      'packages/scene/src/uvm/geometry.ts',
      'packages/scene/src/uvm/rig.ts',
      'packages/scene/src/uvm/model.ts',
    ],
  ],
  [
    'packages/scene/src/uvm/index.ts',
    [
      'packages/codec-kit/dist/json-snapshot.js',
      'packages/codec-kit/dist/legacy/core/errors.js',
      'packages/codec-kit/dist/legacy/core/logger.js',
      'packages/codec-kit/dist/legacy/core/index.js',
      'packages/uv/dist/model/legacy/container-kernels.js',
      'packages/uv/dist/model/container.js',
      'packages/scene/src/uvm/json-edit.ts',
      'packages/scene/src/uvm/document.ts',
      'packages/scene/src/uvm/operations.ts',
      'packages/scene/src/uvm/index.ts',
    ],
  ],
] as const) {
  it(`${entry} bundles without platform, UI or format-specific code`, async () => {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
    })
    expect(
      Object.values(required(result.metafile).outputs).flatMap(output => output.imports),
    ).toEqual([])
    expect(new Set(Object.keys(required(result.metafile).inputs))).toEqual(new Set(inputs))
  })
}
