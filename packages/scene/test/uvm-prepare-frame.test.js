import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { createUvmFramePreparer, prepareUvmRender, renderUvm } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const { bytes } = materializeUvmCore(
  {
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
    nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
    primitives: [
      {
        id: 'tri',
        topology: 'triangles',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
  },
  {
    scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
    profile: 'UVM/core@1.0',
    subjectRevision: 'provider-token:frame',
    options: { assetId: 'fixture/frame', sourceFormat: 'test' },
  },
)
const budget = {
  maxInputBytes: 64000000n,
  maxScalarBytes: 64000000,
  maxNodes: 100000,
  maxDepth: 96,
  maxDiagnostics: 100,
}
const request = {
  schemaVersion: 1,
  time: 0,
  viewport: { width: 4, height: 4 },
  camera: { viewProjection: identity, viewMatrix: identity },
}

it('prepares the frame renderUvm draws, without a renderer', async () => {
  const prepared = await prepareUvmRender(bytes, request, { budget })
  assert.deepEqual(prepared.request.viewport, { width: 4, height: 4 })
  assert.equal(prepared.request.scene.primitives.length, 1)
  let rendered
  const contracts = {
    async resolve() {
      return {
        value: {
          async render(input) {
            rendered = input
            return renderHeadless(input)
          },
        },
        async release() {},
      }
    },
  }
  await renderUvm(bytes, request, { budget, contracts })
  assert.deepEqual(
    rendered.scene.primitives.map(item => item.id),
    prepared.request.scene.primitives.map(item => item.id),
  )
  assert.deepEqual(
    Array.from(rendered.camera.viewProjection),
    Array.from(prepared.request.camera.viewProjection),
  )
  assert.equal(prepared.metersPerSourceUnit, 1)
  assert.deepEqual(prepared.effectPrimitiveIds, [])
})

it('names the source unit the frame was scaled from (UV_units)', async () => {
  const { bytes: scaled } = materializeUvmCore(
    {
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
      nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
      primitives: [
        {
          id: 'tri',
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: Uint32Array.from([0, 1, 2]),
        },
      ],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:inches',
      options: {
        assetId: 'fixture/inches',
        sourceFormat: 'test',
        units: { metersPerSourceUnit: 0.0254, sourceUnit: 'inch' },
      },
    },
  )
  const prepared = await prepareUvmRender(scaled, request, { budget })
  assert.equal(prepared.metersPerSourceUnit, 0.0254)
})

it('prepares many frames of one document the same as one by one', async () => {
  const preparer = createUvmFramePreparer(bytes, { budget })
  const turned = {
    ...request,
    camera: {
      viewProjection: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      viewMatrix: identity,
    },
  }
  for (const frame of [request, turned, request]) {
    const kept = await preparer.prepare(frame)
    const fresh = await prepareUvmRender(bytes, frame, { budget })
    assert.deepEqual(
      Array.from(kept.request.camera.viewProjection),
      Array.from(fresh.request.camera.viewProjection),
    )
    assert.deepEqual(
      kept.request.scene.primitives.map(item => [item.id, Array.from(item.positions)]),
      fresh.request.scene.primitives.map(item => [item.id, Array.from(item.positions)]),
    )
  }
  preparer.dispose()
  await assert.rejects(preparer.prepare(request), /disposed/)
})

function clockFrameAsset(loop = 'loop') {
  const channel = (target, kind, a, b, concurrent = false, end = 1) => ({
    target,
    kind,
    firstFrame: 0,
    lastFrame: 1,
    interpolation: kind === 'visibility' ? 'step' : 'linear',
    ...(concurrent ? { concurrent: true, wrapSeconds: 1 } : {}),
    samples: [
      { frame: 0, timeSeconds: 0, value: a },
      { frame: 1, timeSeconds: end, value: b },
    ],
  })
  return materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 3,
        meshes: 3,
        primitives: 3,
        materials: 0,
        textures: 0,
        animations: 1,
        geometryAccess: 'decoded',
      },
      nodes: ['body', 'helper', 'marker'].map(id => ({
        id,
        childIds: id === 'body' ? ['helper'] : [],
        meshIds: [id],
        transform: identity,
        trs: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      })),
      meshes: ['body', 'helper', 'marker'].map(id => ({ id, primitiveIds: [id] })),
      primitives: ['body', 'helper', 'marker'].map(id => ({
        id,
        topology: 'triangles',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
        ...(id === 'body'
          ? { morphTargets: [{ positions: Float32Array.of(0, 4, 0, 0, 0, 0, 0, 0, 0) }] }
          : {}),
      })),
      animations: [
        {
          id: 'clock',
          name: 'clock',
          kind: 'animation',
          provenance: 'direct',
          frames: 2,
          durationSeconds: 0.5,
          loop,
          channels: [
            channel('body', 'translation', [0, 0, 0], [2, 0, 0], false, 0.5),
            channel('helper', 'translation', [0, 0, 0], [0, 4, 0], true),
            channel('body', 'weights', [0], [1], true),
            channel('marker', 'visibility', [1], [0], true, 0.5),
          ],
        },
      ],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:clock-frame',
      options: { assetId: 'fixture/clocks', sourceFormat: 'test' },
    },
  ).bytes
}

it('the public frame boundary samples local pose and independent concurrent clocks consistently', async () => {
  const asset = clockFrameAsset()
  const draw = input =>
    prepareUvmRender(asset, { ...request, clipId: 'clock', ...input }, { budget })
  const global = (await draw({ time: 0.25, globalTime: 0.75 })).request.scene
  assert.equal(global.materialContext.time, 0.75)
  assert.equal(global.materialContext.sequenceTime, 0.25)
  assert.equal(global.primitives.length, 2)
  assert.equal(global.primitives[0].transform[12], 1)
  assert.equal(global.primitives[0].positions[1], 3)
  assert.deepEqual([...global.primitives[1].transform].slice(12, 15), [1, 3, 0])
  const zero = (await draw({ time: 0.25, globalTime: 0 })).request.scene
  assert.equal(zero.materialContext.time, 0)
  assert.equal(zero.primitives[0].positions[1], 0)
  assert.equal(zero.primitives.length, 3)
  const wrapped = (await draw({ time: 0.25, globalTime: 1.25 })).request.scene
  assert.equal(wrapped.primitives[0].positions[1], 1)
  assert.equal(wrapped.primitives[0].transform[12], 1)
  assert.deepEqual([...wrapped.primitives[1].transform].slice(12, 15), [1, 1, 0])
  const local = (await draw({ time: 0.25 })).request.scene
  assert.equal(local.primitives[0].positions[1], 1)
  assert.equal(local.materialContext.time, 0.25)
  for (const loop of ['loop', 'once', 'hold']) {
    const data = clockFrameAsset(loop)
    for (const [time, x] of [
      [0.25, 1],
      [0.5, 2],
      [0.75, 2],
    ]) {
      const frame = await prepareUvmRender(data, { ...request, clipId: 'clock', time }, { budget })
      assert.equal(frame.request.scene.primitives[0].transform[12], x)
      assert.equal(frame.request.scene.materialContext.sequenceTime, time)
    }
  }
  const noClip = await prepareUvmRender(
    bytes,
    { ...request, time: 0, globalTime: 0.75 },
    { budget },
  )
  assert.equal(noClip.request.scene.materialContext.time, 0.75)
  for (const invalid of [-1, null, '0', NaN, Infinity, -Infinity])
    await assert.rejects(draw({ time: 0.25, globalTime: invalid }))
  await assert.rejects(draw({ time: 0.25, sequenceTime: 0.75 }), /unsupported/)
  await assert.rejects(draw({ time: 0.25, materialContext: { time: 0.75 } }), /material context/)
  await assert.rejects(
    prepareUvmRender(
      asset,
      { ...request, globalTime: 0.75 },
      { budget, signal: AbortSignal.abort() },
    ),
    /abort/i,
  )
})

it('different clocks refuse even inactive history before resource work on cold and warm frames', async () => {
  const base = structuredClone(readUvmContainer(bytes))
  base.document.extensionsUsed.push('UV_game_effects')
  base.document.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }]
  base.document.meshes[0].primitives[0].material = 0
  base.document.textures = [{ source: 0 }]
  base.document.images = [{ uri: 'guard.png' }]
  for (const kind of ['particles', 'ribbons']) {
    const document = structuredClone(base)
    document.document.extensions.UV_game_effects = {
      profile: 'common',
      trackTimeUnit: 'seconds',
      particles: [],
      ribbons: [],
      [kind]: [
        {
          name: 'inactive',
          node: 0,
          material: 0,
          emissionRate: 0,
          lifeSpan: 1,
          speed: 0,
          width: 1,
          length: 1,
          alpha: 0,
          visibility: 0,
          heightAbove: 0.1,
          heightBelow: 0.1,
          color: [1, 1, 1],
        },
      ],
    }
    const encoded = writeUvmContainer(document)
    let raster = 0,
      models = 0
    const options = {
      budget,
      modelResources: {
        async acquire() {
          models++
          throw new Error('unexpected model work')
        },
      },
      rasterResources: {
        async read() {
          raster++
          return {
            state: 'decoded',
            diagnostics: [],
            info: { width: 1, height: 1, faces: 1, orientation: 'top-left', alphaMode: 'straight' },
            region: {
              width: 1,
              height: 1,
              rowStride: 4,
              pixelFormat: 'rgba8',
              pixels: Uint8Array.of(255, 255, 255, 255),
            },
          }
        },
      },
    }
    const preparer = createUvmFramePreparer(encoded, options)
    try {
      await assert.rejects(
        preparer.prepare({ ...request, time: 0.25, globalTime: 0.75 }),
        /historical particles or ribbons/,
      )
      assert.deepEqual([raster, models], [0, 0])
      await preparer.prepare({ ...request, time: 0.25, globalTime: 0.25 })
      assert(raster > 0)
      raster = 0
      await assert.rejects(
        preparer.prepare({ ...request, time: 0.25, globalTime: 0.75 }),
        /historical particles or ribbons/,
      )
      assert.deepEqual([raster, models], [0, 0])
    } finally {
      preparer.dispose()
    }
    for (const malformed of ['unknown-history', {}, [null]]) {
      const bad = structuredClone(document)
      bad.document.extensions.UV_game_effects[kind] = malformed
      await assert.rejects(
        prepareUvmRender(writeUvmContainer(bad), { ...request, globalTime: 0.75 }, options),
      )
      assert.deepEqual([raster, models], [0, 0])
    }
  }
})
