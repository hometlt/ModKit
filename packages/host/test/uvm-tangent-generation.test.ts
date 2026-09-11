import { afterAll, beforeAll, expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { createRenderMaterialSampler } from '../../scene/src/materials/render-model.js'
import { encodeRgbaPng } from '../../scene/src/output/png.js'
import { renderUvm } from '../../scene/src/uvm/render.js'
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
import {
  tangentGenerationModel,
  type TangentGenerationFixtureOptions,
} from './fixtures/uvm-tangent-generation.js'

const request: JsonObject = {
  ...environmentRequest,
  clearColor: [0, 0, 0, 0],
  materialContext: {
    ambient: [0, 0, 0, 0],
    environment: { worldToEnvironment: environmentIdentity },
  },
}
const cubeBytes = environmentCube().bytes
const rotatedUv1 = [0, 0, 0, -1, 1, 0] as const
const mirroredUv1 = [0, 0, -1, 0, 0, 1] as const
const authoredMinusY = [0, -1, 0, 1] as const
const degenerateWarning = 'common.scene/tangent-generation-degenerate-uv'
let host: Awaited<ReturnType<typeof createEnvironmentHostFixture>>

beforeAll(async () => {
  host = await createEnvironmentHostFixture()
  host.writeTexture(cubeBytes)
  // Exercise the complete public UVM/image/renderer chain during setup; tests keep the 5 s limit.
  const warm = await host.open(
    tangentGenerationModel({ uv1: rotatedUv1, tangentGeneration: { texCoord: 1 } }).bytes,
    'worker',
  )
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

const cases: readonly {
  name: string
  options: TangentGenerationFixtureOptions
  face: number
  degenerate?: boolean
}[] = [
  {
    name: 'default UV0 tangent +X despite rotated UV1',
    options: { uv1: rotatedUv1 },
    face: 0,
  },
  {
    name: 'explicit rotated UV1 tangent +Y',
    options: { uv1: rotatedUv1, tangentGeneration: { texCoord: 1 } },
    face: 2,
  },
  {
    name: 'explicit mirrored UV1 tangent -X',
    options: { uv1: mirroredUv1, tangentGeneration: { texCoord: 1 } },
    face: 1,
  },
  {
    name: 'authored tangent -Y overrides conflicting UV1',
    options: {
      uv1: rotatedUv1,
      tangentGeneration: { texCoord: 1 },
      authoredTangent: authoredMinusY,
    },
    face: 3,
  },
  {
    name: 'authored tangent -Y does not require selected UV4',
    options: { tangentGeneration: { texCoord: 4 }, authoredTangent: authoredMinusY },
    face: 3,
  },
  {
    name: 'degenerate selected UV1 uses geometric tangent +X and warns',
    options: { uv1: [0, 0, 0, 0, 0, 0], tangentGeneration: { texCoord: 1 } },
    face: 0,
    degenerate: true,
  },
]

it.each(cases)('renders $name through public UVM/image/renderer workers', async item => {
  const input = tangentGenerationModel(item.options)
  const originalBytes = input.bytes.slice()
  // Independent oracle: axis normals imply a known constant face color, with no tangent policy.
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
        throw new Error('missing generated tangent PNG')
      // Exact PNG equality carries the independently checked nonempty coverage to both lanes.
      expect(rendered.output.value).toEqual(expectedPng)
      if (lane === 'linked') linkedPng = rendered.output.value.slice()
      else expect(rendered.output.value).toEqual(linkedPng)
      const diagnostics = rendered.diagnostics.filter(value => value.code.startsWith('common.'))
      if (item.degenerate === true) {
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]).toMatchObject({
          code: degenerateWarning,
          severity: 'warning',
          message:
            'Tangent generation for TEXCOORD_1 used geometric fallback for 1 triangle(s) with a degenerate UV determinant.',
        })
      } else expect(diagnostics).toEqual([])
      expect(
        opened.resources?.provenance().filter(value => value.state === 'resolved'),
      ).toHaveLength(1)
      expect(opened.resources?.provenance().map(value => value.logicalId)).toEqual([
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

const invalid = [
  {
    name: 'unknown tangent generation field',
    tangentGeneration: { texCoord: 1, unexpected: true },
    message: /tangentGeneration has unsupported properties/,
  },
  {
    name: 'fractional tangent UV index',
    tangentGeneration: { texCoord: 1.5 },
    message: /tangentGeneration\.texCoord/,
  },
  {
    name: 'out-of-range tangent UV index',
    tangentGeneration: { texCoord: 5 },
    message: /tangentGeneration\.texCoord/,
  },
] as const

it.each(invalid)(
  'refuses $name eagerly in the direct sampler',
  ({ tangentGeneration, message }) => {
    const input = tangentGenerationModel({ uv1: rotatedUv1, tangentGeneration })
    const original = structuredClone(input.parameters)
    expect(() => createRenderMaterialSampler(input.parameters, materialBudget)).toThrow(message)
    expect(input.parameters).toEqual(original)
  },
)

it.each([
  ...invalid.map(item => ({ ...item, expectPixels: false })),
  {
    name: 'missing explicitly selected TEXCOORD_2 without authored tangent',
    tangentGeneration: { texCoord: 2 },
    message: /lacks TEXCOORD_2 for tangent generation/,
    expectPixels: true,
  },
])('refuses $name through the ordinary UVM worker operation', async item => {
  const input = tangentGenerationModel({
    uv1: rotatedUv1,
    tangentGeneration: item.tangentGeneration,
  })
  const originalBytes = input.bytes.slice()
  const opened = await host.open(input.bytes, 'worker')
  try {
    await expect(opened.session.operations().invoke('render-uvm-scene', request)).rejects.toThrow(
      item.message,
    )
    // Shape validation precedes image acquisition; the renderer checks missing geometry later.
    expect(
      opened.resources?.provenance().filter(value => value.state === 'resolved') ?? [],
    ).toHaveLength(item.expectPixels ? 1 : 0)
    expect(opened.readModel()).toEqual(Buffer.from(originalBytes))
    expect(input.bytes).toEqual(originalBytes)
    expect(host.readTexture()).toEqual(Buffer.from(cubeBytes))
  } finally {
    await opened.session.dispose()
  }
})
