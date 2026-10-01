import { afterAll, beforeAll, expect, it } from 'vitest'
import type { JsonObject, RasterResourcePort } from '@modkit/sdk'
import { renderUvmPng } from '../../scene/src/uvm/render.js'
import {
  createEnvironmentHostFixture,
  environmentBudget,
  environmentCube,
  environmentFaceColor,
  environmentIdentity,
  environmentModel,
  environmentQuarterTurn,
  environmentRequest,
} from './fixtures/uvm-environment.js'

let host: Awaited<ReturnType<typeof createEnvironmentHostFixture>>
beforeAll(async () => {
  host = await createEnvironmentHostFixture()
  host.writeTexture(environmentCube().bytes)
  // Include image decoding in the cold-start setup, matching the ordinary UVM texture tests.
  const warm = await host.open(environmentModel(), 'worker')
  try {
    const result = await warm.session
      .operations()
      .invoke('render-uvm-scene', request(environmentIdentity))
    expect(result.state, JSON.stringify(result.diagnostics)).toBe('ok')
    expect(result.diagnostics.filter(item => item.code.startsWith('common.'))).toEqual([])
    expect(warm.resources?.provenance().filter(item => item.state === 'resolved')).toHaveLength(1)
  } finally {
    await warm.session.dispose()
  }
}, 60_000)
afterAll(async () => {
  await host?.dispose()
})

const request = (matrix: readonly number[], eye?: readonly number[]): JsonObject => ({
  ...environmentRequest,
  camera: { ...environmentRequest.camera, ...(eye === undefined ? {} : { eyePosition: [...eye] }) },
  materialContext: { environment: { worldToEnvironment: [...matrix] } },
})

function deferred() {
  let finish: (() => void) | undefined
  const promise = new Promise<void>(resolve => {
    finish = resolve
  })
  if (finish === undefined) throw new Error('missing promise resolver')
  return { promise, resolve: finish }
}

it.each([
  { name: 'normal cube in the world frame', uvSource: 7, matrix: environmentIdentity, face: 4 },
  {
    name: 'normal cube after a quarter turn',
    uvSource: 7,
    matrix: environmentQuarterTurn,
    face: 0,
  },
  {
    name: 'reflection from an eye above the triangle',
    uvSource: 2,
    matrix: environmentIdentity,
    eye: [0, 0, 10],
    face: 4,
  },
  {
    name: 'reflection from an eye right of the triangle',
    uvSource: 2,
    matrix: environmentIdentity,
    eye: [10, 0, 0],
    face: 1,
  },
  {
    name: 'environment mask after a quarter turn',
    uvSource: 7,
    matrix: environmentQuarterTurn,
    slot: 'enviMask',
    face: 0,
  },
] as const)('passes $name through public UVM/image/renderer workers', async item => {
  const uvSource = item.uvSource
  const slot = 'slot' in item ? item.slot : 'envi'
  const bytes = environmentModel({ uvSource, slot })
  const reference = await renderUvmPng(
    environmentModel({ uvSource, slot, color: environmentFaceColor(item.face) }),
    environmentRequest,
    { contracts: host.contracts, budget: environmentBudget },
  )
  for (const lane of ['linked', 'worker'] as const) {
    const opened = await host.open(bytes, lane)
    try {
      const rendered = await opened.session
        .operations()
        .invoke('render-uvm-scene', request(item.matrix, 'eye' in item ? item.eye : undefined))
      expect(rendered.state, JSON.stringify(rendered.diagnostics)).toBe('ok')
      if (rendered.state !== 'ok' || rendered.output.kind !== 'bytes')
        throw new Error('missing environment PNG')
      expect(rendered.output.value).toEqual(reference.value)
      expect(rendered.diagnostics.filter(item => item.code.startsWith('common.'))).toEqual([])
      expect(opened.resources?.provenance().filter(item => item.state === 'resolved')).toHaveLength(
        1,
      )
      expect(opened.readModel()).toEqual(Buffer.from(bytes))
    } finally {
      await opened.session.dispose()
    }
  }
  expect(host.readTexture()).toEqual(Buffer.from(environmentCube().bytes))
})

it.each(['environment', 'eyePosition'] as const)(
  'owns the explicit %s before asynchronous raster acquisition',
  async field => {
    const uvSource = field === 'environment' ? 7 : 2
    const face = field === 'environment' ? 0 : 4
    const matrix = [...(field === 'environment' ? environmentQuarterTurn : environmentIdentity)]
    const eye = [0, 0, 10]
    const input = {
      ...environmentRequest,
      camera: { ...environmentRequest.camera, eyePosition: eye },
      materialContext: { environment: { worldToEnvironment: matrix } },
    }
    const entered = deferred(),
      gate = deferred()
    const cube = environmentCube()
    let reads = 0
    const rasterResources: RasterResourcePort = {
      async read(request) {
        reads++
        // every cube face, at the most detailed level that fits the texture's share
        expect(request.selection).toEqual({ face: 'all', mipLevel: 'fit' })
        entered.resolve()
        await gate.promise
        return {
          state: 'decoded-surfaces',
          diagnostics: [],
          info: {
            width: 4,
            height: 4,
            depth: 1,
            layers: 1,
            faces: 6,
            mipLevels: 2,
            frames: 1,
            channels: 4,
            bitDepth: 8,
            colorSpace: 'linear',
            alphaMode: 'straight',
            orientation: 'top-left',
            decodedAccess: true,
            channelLayout: 'rgba',
            compression: 'none',
          },
          surfaces: cube.surfaces.map((levels, face) => {
            const pixels = levels[0]
            if (pixels === undefined) throw new Error('missing fixture face')
            return {
              subresource: { frame: 0, mipLevel: 0, layer: 0, face, slice: 0 },
              region: {
                width: 4,
                height: 4,
                rowStride: 16,
                pixelFormat: 'rgba8',
                pixels: pixels.slice(),
              },
            }
          }),
        }
      },
    }
    const pending = renderUvmPng(environmentModel({ uvSource }), input, {
      contracts: host.contracts,
      budget: environmentBudget,
      rasterResources,
    })
    await Promise.race([
      entered.promise,
      pending.then(() => {
        throw new Error('render did not await raster acquisition')
      }),
    ])
    if (field === 'environment') matrix.splice(0, matrix.length, ...environmentIdentity)
    else eye.splice(0, eye.length, 10, 0, 0)
    gate.resolve()
    const result = await pending
    const reference = await renderUvmPng(
      environmentModel({ uvSource, color: environmentFaceColor(face) }),
      environmentRequest,
      { contracts: host.contracts, budget: environmentBudget },
    )
    expect(result.value).toEqual(reference.value)
    expect(reads).toBe(1)
  },
)

const invalidRequests: readonly { name: string; value: JsonObject }[] = [
  {
    name: 'environment is not an object',
    value: { ...environmentRequest, materialContext: { environment: [] } },
  },
  {
    name: 'missing matrix',
    value: { ...environmentRequest, materialContext: { environment: {} } },
  },
  {
    name: 'unknown environment field',
    value: {
      ...environmentRequest,
      materialContext: { environment: { worldToEnvironment: environmentIdentity, unknown: 1 } },
    },
  },
  { name: 'matrix arity', value: request(environmentIdentity.slice(1)) },
  { name: 'matrix float32 overflow', value: request([1e100, ...environmentIdentity.slice(1)]) },
  { name: 'matrix nonfinite', value: request([Number.NaN, ...environmentIdentity.slice(1)]) },
  {
    name: 'projective matrix',
    value: request(environmentIdentity.map((value, index) => (index === 3 ? 1 : value))),
  },
  { name: 'wrong homogeneous component', value: request([...environmentIdentity.slice(0, 15), 0]) },
  { name: 'eye arity', value: request(environmentIdentity, [0, 0]) },
  { name: 'eye float32 overflow', value: request(environmentIdentity, [0, 0, 1e100]) },
]

it.each(invalidRequests)('refuses $name before acquiring any pixels', async ({ value }) => {
  let reads = 0
  const rasterResources: RasterResourcePort = {
    async read() {
      reads++
      throw new Error('invalid request reached raster acquisition')
    },
  }
  await expect(
    renderUvmPng(environmentModel(), value, {
      contracts: host.contracts,
      budget: environmentBudget,
      rasterResources,
    }),
  ).rejects.toThrow()
  expect(reads).toBe(0)
})

it.each([
  {
    name: 'missing reflection eye',
    uvSource: 2,
    input: request(environmentIdentity),
    message: /eyePosition/,
  },
  {
    name: 'projective environment',
    uvSource: 7,
    input: request(environmentIdentity.map((value, index) => (index === 7 ? 1 : value))),
    message: /worldToEnvironment must be affine/,
  },
  {
    name: 'eye float32 overflow',
    uvSource: 7,
    input: request(environmentIdentity, [0, 0, 1e100]),
    message: /eyePosition requires 3 finite float32/,
  },
] as const)(
  'reports $name through the ordinary UVM worker operation',
  async ({ uvSource, input, message }) => {
    const opened = await host.open(environmentModel({ uvSource }), 'worker')
    try {
      await expect(opened.session.operations().invoke('render-uvm-scene', input)).rejects.toThrow(
        message,
      )
      expect(opened.readModel()).toEqual(Buffer.from(environmentModel({ uvSource })))
    } finally {
      await opened.session.dispose()
    }
  },
)
