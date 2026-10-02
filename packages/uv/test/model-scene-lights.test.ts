import { expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:scene-lights',
  options: { assetId: 'fixture/lamp', sourceFormat: 'm3' },
} as never

const projection = (lights?: unknown) =>
  ({
    info: {
      scenes: 1,
      nodes: 2,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded' as const,
    },
    nodes: [
      {
        id: 'root',
        childIds: ['bulb'],
        meshIds: ['mesh'],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      {
        id: 'bulb',
        childIds: [],
        meshIds: [],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1],
      },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles' as const,
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    ...(lights === undefined ? {} : { lights }),
  }) as never

interface Written {
  readonly document: {
    readonly extensionsUsed: readonly string[]
    readonly extensions: Record<string, unknown>
    readonly nodes: readonly { readonly name?: string }[]
  }
}

const lamp = {
  type: 'point',
  direction: [0, -1, 0],
  position: [0, 2, 0],
  color: [1, 0.8, 0.5],
  attenuationEnd: 6,
}

it("writes a model's lights as UV_scene_lights in the frame of the node it names", () => {
  const written = materializeUvmCore(
    projection({ spaceNodeId: 'bulb', ambient: [0.02, 0.02, 0.02], lights: [lamp] }),
    request,
  ) as unknown as Written
  const extension = written.document.extensions['UV_scene_lights'] as {
    readonly version: number
    readonly spaceNode: number
    readonly ambient: readonly number[]
    readonly lights: readonly unknown[]
  }
  expect(written.document.extensionsUsed).toContain('UV_scene_lights')
  expect(extension).toMatchObject({ version: 1, ambient: [0.02, 0.02, 0.02], lights: [lamp] })
  // the frame is the bulb: the node two units up that carries no mesh
  const frame = written.document.nodes[extension.spaceNode] as {
    readonly mesh?: number
    readonly translation?: readonly number[]
    readonly matrix?: readonly number[]
  }
  expect(frame.mesh).toBeUndefined()
  expect(frame.translation?.[1] ?? frame.matrix?.[13]).toBe(2)
  const plain = materializeUvmCore(projection(), request) as unknown as Written
  expect(plain.document.extensionsUsed).not.toContain('UV_scene_lights')
})

it('refuses lights a reader would refuse', () => {
  for (const lights of [
    { spaceNodeId: 'nowhere', lights: [lamp] },
    { spaceNodeId: 'bulb', lights: [{ ...lamp, position: undefined }] },
    { spaceNodeId: 'bulb', lights: [{ ...lamp, direction: [0, 0, 0] }] },
    { spaceNodeId: 'bulb', lights: [{ ...lamp, color: [-1, 0, 0] }] },
    { spaceNodeId: 'bulb', lights: [{ ...lamp, glow: 1 }] },
    { spaceNodeId: 'bulb', lights: [{ ...lamp, sequenceAnimation: { intensity: [] } }] },
    { spaceNodeId: 'bulb', ambient: [2, 0, 0], lights: [lamp] },
  ])
    expect(() =>
      materializeUvmCore(projection(JSON.parse(JSON.stringify(lights)) as unknown), request),
    ).toThrow(TypeError)
})
