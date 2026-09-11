import { afterAll, beforeAll, expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { createRenderMaterialSampler } from '../../scene/src/materials/render-model.js'
import { renderUvm } from '../../scene/src/uvm/render.js'
import { encodeRgbaPng } from '../../scene/src/output/png.js'
import { readUvmContainer } from '../../uv/src/model/container.js'
import { materialBudget } from '../../testkit/test/fixtures/scene-material-program.js'
import {
  createEnvironmentHostFixture,
  environmentBudget,
  environmentCube,
  environmentFaceColor,
  environmentIdentity,
  environmentModel,
  environmentRequest,
} from './fixtures/uvm-environment.js'
import { signedNormalModel, signedNormalRecord } from './fixtures/uvm-signed-normal.js'

const request: JsonObject = {
  ...environmentRequest,
  clearColor: [0, 0, 0, 0],
  materialContext: {
    ambient: [0, 0, 0, 0],
    environment: { worldToEnvironment: environmentIdentity },
  },
}
const cubeBytes = environmentCube().bytes
let host: Awaited<ReturnType<typeof createEnvironmentHostFixture>>

beforeAll(async () => {
  host = await createEnvironmentHostFixture()
  host.writeTexture(cubeBytes)
  // Charge the complete UVM/image/renderer cold start to setup, retaining the 5 s test limit.
  const warm = await host.open(signedNormalModel().bytes, 'worker')
  try {
    const rendered = await warm.session.operations().invoke('render-uvm-scene', request)
    expect(rendered.state, JSON.stringify(rendered.diagnostics)).toBe('ok')
    expect(rendered.diagnostics.filter(item => item.code.startsWith('common.'))).toEqual([])
    expect(warm.resources?.provenance().filter(item => item.state === 'resolved')).toHaveLength(1)
  } finally {
    await warm.session.dispose()
  }
}, 60_000)

afterAll(async () => {
  await host?.dispose()
})

it.each([
  {
    name: 'negative endpoint selects detail1 +X',
    first: -1,
    second: 0,
    secondMask: false,
    face: 0,
  },
  { name: 'zero preserves base +Z', first: 0, second: 0, secondMask: false, face: 4 },
  { name: 'positive endpoint selects detail2 +Y', first: 1, second: 0, secondMask: false, face: 2 },
  {
    name: 'disabled second mask contributes nothing',
    first: -1,
    second: 2,
    secondMask: false,
    face: 0,
  },
  {
    name: 'opposing masks cancel to base +Z',
    first: -0.75,
    second: 0.75,
    secondMask: true,
    face: 4,
  },
  {
    name: 'disabled second mask never requests its missing DDS',
    first: -1,
    second: 2,
    secondMask: false,
    secondMaskTexture: 'missing-mask2.dds',
    face: 0,
  },
] as const)('renders $name through public UVM/image/renderer workers', async item => {
  const input = signedNormalModel(item)
  const originalBytes = input.bytes.slice()
  expect(readUvmContainer(input.bytes).binary).toEqual(input.geometryBytes)
  expect(createRenderMaterialSampler(input.parameters, materialBudget).resources).toEqual([
    'environment.dds',
  ])
  // The oracle uses a constant environment color and no signed policy or normal-map calculation.
  const reference = await renderUvm(
    environmentModel({ color: environmentFaceColor(item.face) }),
    request,
    { contracts: host.contracts, budget: environmentBudget },
  )
  let coverage = 0
  for (let offset = 0; offset < reference.rgba.length; offset += 4) {
    if (reference.rgba[offset + 3] === 0) continue
    coverage++
    expect([...reference.rgba.subarray(offset, offset + 4)]).toEqual([item.face * 40, 80, 120, 255])
  }
  expect(coverage).toBeGreaterThan(100)
  expect(coverage).toBeLessThan(reference.width * reference.height)
  const expectedPng = await encodeRgbaPng(reference)
  let linkedPng: Uint8Array | undefined
  for (const lane of ['linked', 'worker'] as const) {
    const opened = await host.open(input.bytes, lane)
    try {
      const rendered = await opened.session.operations().invoke('render-uvm-scene', request)
      expect(rendered.state, JSON.stringify(rendered.diagnostics)).toBe('ok')
      if (rendered.state !== 'ok' || rendered.output.kind !== 'bytes')
        throw new Error('missing signed normal PNG')
      expect(rendered.output.value).toEqual(expectedPng)
      if (lane === 'linked') linkedPng = rendered.output.value.slice()
      else expect(rendered.output.value).toEqual(linkedPng)
      expect(rendered.diagnostics.filter(item => item.code.startsWith('common.'))).toEqual([])
      expect(opened.resources?.provenance().filter(item => item.state === 'resolved')).toHaveLength(
        1,
      )
      expect(opened.resources?.provenance().map(item => item.logicalId)).toEqual([
        'environment.dds',
      ])
      expect(opened.readModel()).toEqual(Buffer.from(originalBytes))
      expect(host.readTexture()).toEqual(Buffer.from(cubeBytes))
    } finally {
      await opened.session.dispose()
    }
  }
  expect(input.bytes).toEqual(originalBytes)
})

const invalid: readonly {
  name: string
  modify: (standard: JsonObject) => JsonObject
  message: RegExp
}[] = [
  {
    name: 'unknown blend mode',
    modify: standard => ({
      ...standard,
      normalBlendPolicy: { mode: 'unrecognized', secondMask: false },
    }),
    message: /normalBlendPolicy is unsupported/,
  },
  {
    name: 'nonboolean secondMask',
    modify: standard => ({
      ...standard,
      normalBlendPolicy: { mode: 'signed-two-detail', secondMask: 1 },
    }),
    message: /normalBlendPolicy is unsupported/,
  },
  {
    name: 'missing second detail layer',
    modify: standard => ({
      ...standard,
      layers: Object.fromEntries(
        Object.entries(signedNormalRecord(standard['layers'])).filter(
          ([slot]) => slot !== 'normalBlend2',
        ),
      ),
    }),
    message: /normalBlendPolicy requires both detail layers/,
  },
]

it.each(invalid)('refuses $name eagerly in the direct sampler', ({ modify, message }) => {
  const input = signedNormalModel({ modify })
  const original = structuredClone(input.parameters)
  expect(() => createRenderMaterialSampler(input.parameters, materialBudget)).toThrow(message)
  expect(input.parameters).toEqual(original)
})

it.each(invalid)(
  'refuses $name through the ordinary UVM worker operation',
  async ({ modify, message }) => {
    const input = signedNormalModel({ modify })
    const originalBytes = input.bytes.slice()
    const opened = await host.open(input.bytes, 'worker')
    try {
      await expect(opened.session.operations().invoke('render-uvm-scene', request)).rejects.toThrow(
        message,
      )
      expect(
        opened.resources?.provenance().filter(item => item.state === 'resolved') ?? [],
      ).toEqual([])
      expect(opened.readModel()).toEqual(Buffer.from(originalBytes))
      expect(input.bytes).toEqual(originalBytes)
      expect(host.readTexture()).toEqual(Buffer.from(cubeBytes))
    } finally {
      await opened.session.dispose()
    }
  },
)
