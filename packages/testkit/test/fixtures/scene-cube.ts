import type { JsonObject } from '@modkit/sdk'
import type { SceneRenderRequest, SceneRendererTexture } from '@modkit/sdk/renderer'
import type { StandardMaterialModel } from '@modkit/codec-kit/legacy/models/material'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { renderBrowser } from '../../../scene/src/render/browser.js'
import { renderHeadless } from '../../../scene/src/render/headless.js'
import { frameRequest } from './scene-material-frame.js'
import { materialBudget, materialProgramCases } from './scene-material-program.js'

type Direction = readonly [number, number, number]
type FacePoint = readonly [face: number, x: number, y: number]
export type CubeFilter = 'nearest' | 'linear'
export interface CubeCase {
  readonly name: string
  readonly direction: Direction
  /** Independently specified texel coordinates; no production projection/sampling helpers. */
  readonly points: readonly FacePoint[]
  readonly kind: 'interior' | 'edge' | 'corner'
}
export const cubeSize = 8

// OpenGL cube-map table 3.21: sc/tc are -z/-y, z/-y, x/z, x/-z, x/-y, -x/-y.
// DDS face order is +X,-X,+Y,-Y,+Z,-Z. These explicit vectors/texel positions form the oracle.
// https://registry.khronos.org/OpenGL/extensions/OES/OES_texture_cube_map.txt
export const cubeInteriorCases: readonly CubeCase[] = [
  ...(
    [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const
  ).map((direction, face) => ({
    name: `face-${face}-center`,
    direction,
    points: [[face, 3.5, 3.5] as const],
    kind: 'interior' as const,
  })),
  ...(
    [
      [1, -0.3125, 0.5625],
      [-1, -0.3125, -0.5625],
      [-0.5625, 1, 0.3125],
      [-0.5625, -1, -0.3125],
      [-0.5625, -0.3125, 1],
      [0.5625, -0.3125, -1],
    ] as const
  ).map((direction, face) => ({
    name: `face-${face}-spatial`,
    direction,
    points: [[face, 1.25, 4.75] as const],
    kind: 'interior' as const,
  })),
]

export const cubeEdgeCases: readonly CubeCase[] = [
  {
    name: 'edge-xp-yp',
    direction: [1, 1, 0],
    points: [
      [0, 3.5, 0],
      [2, 7, 3.5],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-xp-yn',
    direction: [1, -1, 0],
    points: [
      [0, 3.5, 7],
      [3, 7, 3.5],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-xp-zp',
    direction: [1, 0, 1],
    points: [
      [0, 0, 3.5],
      [4, 7, 3.5],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-xp-zn',
    direction: [1, 0, -1],
    points: [
      [0, 7, 3.5],
      [5, 0, 3.5],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-xn-yp',
    direction: [-1, 1, 0],
    points: [
      [1, 3.5, 0],
      [2, 0, 3.5],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-xn-yn',
    direction: [-1, -1, 0],
    points: [
      [1, 3.5, 7],
      [3, 0, 3.5],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-xn-zp',
    direction: [-1, 0, 1],
    points: [
      [1, 7, 3.5],
      [4, 0, 3.5],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-xn-zn',
    direction: [-1, 0, -1],
    points: [
      [1, 0, 3.5],
      [5, 7, 3.5],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-yp-zp',
    direction: [0, 1, 1],
    points: [
      [2, 3.5, 7],
      [4, 3.5, 0],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-yp-zn',
    direction: [0, 1, -1],
    points: [
      [2, 3.5, 0],
      [5, 3.5, 0],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-yn-zp',
    direction: [0, -1, 1],
    points: [
      [3, 3.5, 0],
      [4, 3.5, 7],
    ],
    kind: 'edge',
  },
  {
    name: 'edge-yn-zn',
    direction: [0, -1, -1],
    points: [
      [3, 3.5, 7],
      [5, 3.5, 7],
    ],
    kind: 'edge',
  },
]

export const cubeCornerCases: readonly CubeCase[] = [
  {
    name: 'corner-ppp',
    direction: [1, 1, 1],
    points: [
      [0, 0, 0],
      [2, 7, 7],
      [4, 7, 0],
    ],
    kind: 'corner',
  },
  {
    name: 'corner-ppn',
    direction: [1, 1, -1],
    points: [
      [0, 7, 0],
      [2, 7, 0],
      [5, 0, 0],
    ],
    kind: 'corner',
  },
  {
    name: 'corner-pnp',
    direction: [1, -1, 1],
    points: [
      [0, 0, 7],
      [3, 7, 0],
      [4, 7, 7],
    ],
    kind: 'corner',
  },
  {
    name: 'corner-pnn',
    direction: [1, -1, -1],
    points: [
      [0, 7, 7],
      [3, 7, 7],
      [5, 0, 7],
    ],
    kind: 'corner',
  },
  {
    name: 'corner-npp',
    direction: [-1, 1, 1],
    points: [
      [1, 7, 0],
      [2, 0, 7],
      [4, 0, 0],
    ],
    kind: 'corner',
  },
  {
    name: 'corner-npn',
    direction: [-1, 1, -1],
    points: [
      [1, 0, 0],
      [2, 0, 0],
      [5, 7, 0],
    ],
    kind: 'corner',
  },
  {
    name: 'corner-nnp',
    direction: [-1, -1, 1],
    points: [
      [1, 7, 7],
      [3, 0, 0],
      [4, 0, 7],
    ],
    kind: 'corner',
  },
  {
    name: 'corner-nnn',
    direction: [-1, -1, -1],
    points: [
      [1, 0, 7],
      [3, 0, 7],
      [5, 7, 7],
    ],
    kind: 'corner',
  },
]

export function cubeTexel(face: number, x: number, y: number): readonly number[] {
  return [20 + face * 32, 16 + x * 24, 24 + y * 22, 255]
}

export const sharedCorner = [83, 127, 191, 255] as const

export function cubeTexture(filter: CubeFilter, cornersMatch = false): SceneRendererTexture {
  const rgba = new Uint8Array(6 * cubeSize * cubeSize * 4)
  for (let face = 0; face < 6; face++)
    for (let y = 0; y < cubeSize; y++)
      for (let x = 0; x < cubeSize; x++) {
        const corner = (x === 0 || x === cubeSize - 1) && (y === 0 || y === cubeSize - 1)
        // Exact axis reflection uses a 45-degree float32 normal. Give the central four texels
        // equal color so infinitesimal roundoff at their boundary cannot change the face oracle.
        // The separate off-center spatial cases retain distinct x/y gradients.
        const center = (x === 3 || x === 4) && (y === 3 || y === 4)
        rgba.set(
          cornersMatch && corner
            ? sharedCorner
            : center
              ? cubeTexel(face, 3.5, 3.5)
              : cubeTexel(face, x, y),
          ((face * cubeSize + y) * cubeSize + x) * 4,
        )
      }
  return { id: 'cube.dds', dimension: 'cube', width: cubeSize, height: cubeSize, rgba, filter }
}

/** Historic 4x3 atlas has a vertical face convention distinct from six native DDS surfaces. */
function atlasTexture(filter: CubeFilter): SceneRendererTexture {
  const rgba = new Uint8Array(4 * 3 * cubeSize * cubeSize * 4)
  const cells = [
    [2, 1],
    [0, 1],
    [1, 2],
    [1, 0],
    [1, 1],
    [3, 1],
  ] as const
  cells.forEach(([cx, cy], face) => {
    for (let y = 0; y < cubeSize; y++)
      for (let x = 0; x < cubeSize; x++)
        rgba.set(
          cubeTexel(face, x, y),
          ((cy * cubeSize + y) * cubeSize * 4 + cx * cubeSize + x) * 4,
        )
  })
  return { id: 'cube.dds', width: cubeSize * 4, height: cubeSize * 3, rgba, filter }
}

function directionNormal(direction: Direction, source: 2 | 7): Direction {
  if (source === 7) return direction
  // For orthographic incident vector I=(0,0,-1), N=normalize(R-I) gives reflect(I,N)=R.
  const length = Math.hypot(...direction)
  const halfway: Direction = [
    direction[0] / length,
    direction[1] / length,
    direction[2] / length + 1,
  ]
  const magnitude = Math.hypot(...halfway)
  return magnitude < 1e-8
    ? [1, 0, 0]
    : [halfway[0] / magnitude, halfway[1] / magnitude, halfway[2] / magnitude]
}

export function cubeRequest(
  direction: Direction,
  source: 2 | 7,
  filter: CubeFilter,
  variant: 'cube' | 'atlas' | 'matching-corners' = 'cube',
): SceneRenderRequest {
  const base = frameRequest(1),
    template = materialProgramCases()[1],
    primitive = base.scene.primitives[0],
    surface = base.scene.materials?.[0],
    layer = template?.material.layers.diffuse
  if (
    template === undefined ||
    primitive === undefined ||
    surface === undefined ||
    layer === undefined
  )
    throw new Error('missing standard material frame fixture')
  const standard: StandardMaterialModel = {
    ...template.material,
    layers: { diffuse: { ...layer, channels: 0, texturePath: 'cube.dds', uvSource: source } },
  }
  const normal = directionNormal(direction, source)
  return {
    ...base,
    scene: {
      ...base.scene,
      primitives: [
        { ...primitive, normals: Float32Array.from([normal, normal, normal, normal].flat()) },
      ],
      materials: [
        {
          ...surface,
          shader: {
            id: 'modkit.render-material.v1',
            parameters: snapshotJson(
              { renderModel: { version: 1, standard } },
              materialBudget,
            ) as JsonObject,
          },
          textureBindings: [{ resourceId: 'cube.dds', textureId: 'cube.dds' }],
        },
      ],
      textures: [
        variant === 'atlas'
          ? atlasTexture(filter)
          : cubeTexture(filter, variant === 'matching-corners'),
      ],
      materialContext: { time: 0, ambient: [0, 0, 0, 0] },
    },
  }
}

export async function cubeFrameProbe(
  direction: Direction,
  source: 2 | 7,
  filter: CubeFilter,
  variant: 'cube' | 'atlas' | 'matching-corners' = 'cube',
) {
  const request = cubeRequest(direction, source, filter, variant)
  const cpu = await renderHeadless(request),
    gpu = await renderBrowser(request)
  return {
    cpu: Array.from(cpu.rgba),
    gpu: Array.from(gpu.rgba),
    diagnostics: [...cpu.diagnostics, ...gpu.diagnostics],
    triangles: [cpu.statistics.triangles, gpu.statistics.triangles],
  }
}
