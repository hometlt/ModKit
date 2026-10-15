import type { SceneRendererTexture } from '@modkit/sdk/renderer'
import type { StandardLayerSlot } from '@modkit/codec-kit/legacy/models/material'
import {
  angleLookupUvCpu,
  computeLayerColorCpu,
  computeTriPlanarWeightsCpu,
  planarLocalUvCpu,
  sphericalEnvironmentUvCpu,
  type StandardLayerDefines,
  type Vec2,
  type Vec3,
  type Vec4,
  type CpuSceneLighting,
} from '@modkit/codec-kit/model-math/standard-material-glsl'
import type { StandardMaterialProgram } from '../materials/index.js'
import { dot, unit, type MaterialVertex } from './material-geometry.js'
import { sampleMaterialTexture } from './materials.js'
import { sampleCubeTexture } from '../textures/cube.js'
import { environmentVector, isEnvironmentBinding } from '../materials/environment.js'
import { sampleLightGeometry, type PreviewLighting } from './preview-lighting.js'

const components = (v: Vec3, axis: number): Vec2 =>
  axis === 0 ? [v[1], v[2]] : axis === 1 ? [v[0], v[2]] : [v[0], v[1]]
const uniform = (
  program: StandardMaterialProgram,
  name: string,
  index = 0,
  fallback = 0,
): number => {
  const value = program.uniforms[name]
  return typeof value === 'number' ? value : (value?.[index] ?? fallback)
}
const vector = (program: StandardMaterialProgram, name: string): Vec3 => [
  uniform(program, name, 0),
  uniform(program, name, 1),
  uniform(program, name, 2),
]

/** CPU mirror of the shared GLSL cube-atlas lookup (four columns by three rows). */
function cubeUv(direction: Vec3): Vec2 {
  const d = unit(direction),
    a = d.map(Math.abs)
  let face: Vec2, cell: Vec2, magnitude: number
  if ((a[0] ?? 0) >= (a[1] ?? 0) && (a[0] ?? 0) >= (a[2] ?? 0)) {
    face = [d[0] > 0 ? -d[2] : d[2], d[1]]
    cell = d[0] > 0 ? [2, 1] : [0, 1]
    magnitude = Math.max(a[0] ?? 0, 0.0001)
  } else if ((a[1] ?? 0) >= (a[2] ?? 0)) {
    face = [d[0], d[1] > 0 ? -d[2] : d[2]]
    cell = d[1] > 0 ? [1, 2] : [1, 0]
    magnitude = Math.max(a[1] ?? 0, 0.0001)
  } else {
    face = [d[2] > 0 ? d[0] : -d[0], d[1]]
    cell = d[2] > 0 ? [1, 1] : [3, 1]
    magnitude = Math.max(a[2] ?? 0, 0.0001)
  }
  return [
    ((face[0] / magnitude) * 0.5 + 0.5 + cell[0]) / 4,
    ((face[1] / magnitude) * 0.5 + 0.5 + cell[1]) / 3,
  ]
}

function transformUv(
  program: StandardMaterialProgram,
  layer: StandardLayerDefines,
  uv: Vec2,
  axis: number,
  parallax: Vec2,
): Vec2 {
  let u = uv[0],
    v = uv[1]
  if (layer.hasUvTransform) {
    const prefix = `u_${layer.slot}`,
      angle = uniform(program, `${prefix}UvAngle`, axis),
      c = Math.cos(angle),
      s = Math.sin(angle)
    // As the shader: GLSL mat2(c,-s,s,c) rotates clockwise around the UV center, the offset moves the
    // image, and tiling scales about the center.
    u =
      ((uv[0] - 0.5) * c + (uv[1] - 0.5) * s - uniform(program, `${prefix}UvOffset`, 0)) *
        uniform(program, `${prefix}UvTiling`, 0, 1) +
      0.5
    v =
      (-(uv[0] - 0.5) * s + (uv[1] - 0.5) * c - uniform(program, `${prefix}UvOffset`, 1)) *
        uniform(program, `${prefix}UvTiling`, 1, 1) +
      0.5
  }
  return layer.slot === 'height' ? [u, v] : [u + parallax[0], v + parallax[1]]
}

function layerTexel(
  program: StandardMaterialProgram,
  layer: StandardLayerDefines,
  texture: SceneRendererTexture,
  vertex: MaterialVertex,
  parallax: Vec2,
  worldNormal?: Vec3,
): Vec4 {
  const binding = program.textures.find(binding => binding.slot === layer.slot)
  if (binding === undefined) throw new TypeError(`missing material sampler ${layer.slot}`)
  const sample = (uv: Vec2, axis = 2) => {
    const mapped = transformUv(program, layer, uv, axis, parallax)
    return sampleMaterialTexture(texture, mapped[0], mapped[1], binding.wrapU, binding.wrapV)
  }
  if (layer.angleLookup !== undefined) {
    // angle coordinates take no parallax, as in the shader
    const mapped = transformUv(
      program,
      layer,
      angleLookupUvCpu(layer.angleLookup, vertex.lightDirection, vertex.viewDirection),
      2,
      [0, 0],
    )
    return sampleMaterialTexture(texture, mapped[0], mapped[1], binding.wrapU, binding.wrapV)
  }
  const source = layer.uvSource
  if (source >= 16 && source <= 18) {
    const local = source === 16,
      hybrid = source === 18
    const position = local ? vertex.modelPosition : vertex.worldPosition
    const normal = local
      ? vertex.modelNormal
      : hybrid
        ? ([vertex.worldNormal[0], vertex.worldNormal[1], vertex.modelNormal[2]] as const)
        : vertex.worldNormal
    const weights = computeTriPlanarWeightsCpu(normal)
    const texels = [0, 1, 2].map(axis => {
      let p = hybrid && axis === 2 ? vertex.modelPosition : position
      if (layer.hasUvTransform)
        p = [0, 1, 2].map(
          i =>
            ((p[i] ?? 0) + uniform(program, `u_${layer.slot}UvTriplanarOffset`, i)) *
            uniform(program, `u_${layer.slot}UvTriplanarScale`, i, 1),
        ) as unknown as Vec3
      return sample(components(p, axis), axis)
    })
    const mix = (channel: number) =>
      texels.reduce((sum, texel, i) => sum + (texel[channel] ?? 0) * (weights[i] ?? 0), 0)
    return [mix(0), mix(1), mix(2), mix(3)]
  }
  if (source === 2 || source === 7) {
    if (program.environment !== undefined && isEnvironmentBinding(binding)) {
      if (worldNormal === undefined) throw new TypeError('environment normal has not been sampled')
      let direction = environmentVector(program.environment, worldNormal)
      if (source === 2) {
        const incident = vertex.environment?.eyeToVertex
        if (incident === undefined)
          throw new TypeError('environment reflection requires camera.eyePosition')
        const view = environmentVector(program.environment, unit(incident))
        const factor = 2 * dot(view, direction)
        direction = [
          view[0] - factor * direction[0],
          view[1] - factor * direction[1],
          view[2] - factor * direction[2],
        ]
      }
      return sampleCubeTexture(
        texture,
        direction.every(component => component === 0) ? [0, 0, 1] : direction,
      )
    }
    let direction = unit(vertex.viewNormal)
    if (source === 2) {
      const view = unit(vertex.viewPosition),
        factor = 2 * dot(view, direction)
      direction = [
        view[0] - factor * direction[0],
        view[1] - factor * direction[1],
        view[2] - factor * direction[2],
      ]
    }
    return texture.dimension === 'cube'
      ? sampleCubeTexture(texture, direction)
      : sample(cubeUv(direction))
  }
  if (source === 3 || source === 8)
    return sample(sphericalEnvironmentUvCpu(vertex.viewPosition, vertex.viewNormal, source === 3))
  if ([4, 5, 11, 12, 13, 14].includes(source)) {
    const local = source === 4 || source === 11 || source === 12
    const axis = source === 4 || source === 5 ? 2 : source === 11 || source === 13 ? 0 : 1
    if (local) return sample(planarLocalUvCpu(vertex.modelPosition, axis), axis)
    const uv = components(vertex.worldPosition, axis)
    return sample(
      [
        uv[0] * uniform(program, 'u_terrainTiling', 0, 1) + uniform(program, 'u_terrainTiling', 2),
        1 -
          (uv[1] * uniform(program, 'u_terrainTiling', 1, 1) +
            uniform(program, 'u_terrainTiling', 3)),
      ],
      axis,
    )
  }
  if (source === 15) {
    const w = Math.max(Math.abs(vertex.clip[3]), 0.0001)
    return sample([(vertex.clip[0] / w) * 0.5 + 0.5, (vertex.clip[1] / w) * -0.5 + 0.5])
  }
  return sample(vertex.uv[source === 1 ? 1 : source === 9 ? 2 : source === 10 ? 3 : 0] ?? [0, 0])
}

/** Texture sampling and layer composition for one perspective-interpolated fragment. */
export function shadeMaterial(
  program: StandardMaterialProgram,
  textures: ReadonlyMap<string, SceneRendererTexture>,
  vertex: MaterialVertex,
  sceneLighting?: CpuSceneLighting,
  spatialLighting?: PreviewLighting,
) {
  const texels: Partial<Record<StandardLayerSlot, Vec4>> = {}
  let worldNormal: Vec3 | undefined
  let sampledNormal: Vec3 | undefined
  const directLights = spatialLighting !== undefined && program.defines.sceneLighting === true &&
    program.defines.pbr !== true && !program.defines.unshaded
  const read = (layer: StandardLayerDefines, parallax: Vec2): Vec4 => {
    const binding = program.textures.find(binding => binding.slot === layer.slot)
    const texture = binding === undefined ? undefined : textures.get(binding.resourceId)
    if (texture === undefined) throw new TypeError(`missing acquired texture for ${layer.slot}`)
    return layerTexel(program, layer, texture, vertex, parallax, worldNormal)
  }
  let parallax: Vec2 = [0, 0]
  const height = program.defines.layers.find(layer => layer.slot === 'height')
  if (height !== undefined) {
    const texel: Vec4 = height.hasTexture
      ? read(height, [0, 0])
      : ([0, 1, 2, 3].map(i => uniform(program, 'u_heightColor', i)) as unknown as Vec4)
    if (height.hasTexture) texels.height = texel
    const value = computeLayerColorCpu(
      {
        ...height,
        texel,
        colorMultiply: uniform(program, 'u_heightMultiply', 0, 1),
        colorAdd: uniform(program, 'u_heightAdd'),
        alphaFactor: uniform(program, 'u_heightAlphaFactor', 0, 1),
      },
      vector(program, 'u_teamColor'),
      vertex.viewNormal,
      vertex.viewPosition,
    )[0]
    const view = unit(vertex.viewDirection),
      factor =
        ((value - 0.5) * uniform(program, 'u_parallaxHeight')) / Math.max(Math.abs(view[2]), 0.15)
    parallax = [view[0] * factor, view[1] * factor]
  }
  const deferred =
    program.environment === undefined
      ? []
      : program.textures.filter(isEnvironmentBinding).map(binding => binding.slot)
  for (const layer of program.defines.layers)
    if (layer.hasTexture && layer.slot !== 'height' && !deferred.includes(layer.slot))
      texels[layer.slot] = read(layer, parallax)
  if (
    program.environment !== undefined ||
    program.normalBlendPolicy !== undefined ||
    program.normalMapSpace === 'object' || directLights
  ) {
    const frame = vertex.environment
    if (frame === undefined) throw new TypeError('environment material requires world geometry')
    const pixel = {
      texels,
      normal: [0, 0, 1] as const,
      viewNormal: vertex.viewNormal,
      eyeToVertex: vertex.viewPosition,
    }
    if (program.normalMapSpace === 'object') {
      const matrix = frame.objectNormalMatrix
      worldNormal = program.sampleNormal(pixel, {
        tangent: [matrix[0] ?? 0, matrix[1] ?? 0, matrix[2] ?? 0],
        bitangent: [matrix[3] ?? 0, matrix[4] ?? 0, matrix[5] ?? 0],
        normal: [matrix[6] ?? 0, matrix[7] ?? 0, matrix[8] ?? 0],
      })
      sampledNormal = worldNormal
    } else if (program.normalBlendPolicy !== undefined)
      sampledNormal = worldNormal = program.sampleNormal(pixel, frame)
    else {
      const n = program.sampleNormal(pixel)
      sampledNormal = n
      worldNormal = unit([
        frame.tangent[0] * n[0] + frame.bitangent[0] * n[1] + frame.normal[0] * n[2],
        frame.tangent[1] * n[0] + frame.bitangent[1] * n[1] + frame.normal[1] * n[2],
        frame.tangent[2] * n[0] + frame.bitangent[2] * n[1] + frame.normal[2] * n[2],
      ])
    }
    for (const layer of program.defines.layers)
      if (layer.hasTexture && deferred.includes(layer.slot))
        texels[layer.slot] = read(layer, parallax)
  }
  let lightDirection = vertex.lightDirection,
    halfVector = vertex.halfVector,
    viewDirection = vertex.viewDirection
  if (program.normalBlendPolicy !== undefined || program.normalMapSpace === 'object') {
    const frame = vertex.environment,
      lighting = frame?.worldLighting
    if (frame === undefined || lighting === undefined || worldNormal === undefined)
      throw new TypeError('world-space normal policy requires world lighting')
    lightDirection = lighting.lightDirection
    const eye = lighting.orthographic
      ? lighting.viewDirection
      : unit([
          lighting.eyePosition[0] - frame.position[0],
          lighting.eyePosition[1] - frame.position[1],
          lighting.eyePosition[2] - frame.position[2],
        ])
    const half = unit([
      eye[0] + lightDirection[0],
      eye[1] + lightDirection[1],
      eye[2] + lightDirection[2],
    ])
    halfVector = [-half[0], -half[1], -half[2]]
    viewDirection = eye
  }
  let pixelLighting = sceneLighting
  if (directLights) {
    const frame = vertex.environment, lighting = frame?.worldLighting
    if (frame === undefined || lighting === undefined || worldNormal === undefined)
      throw new TypeError('spatial material lighting requires scene-world geometry')
    const eye = lighting.orthographic ? lighting.viewDirection : unit([
      lighting.eyePosition[0] - frame.position[0],
      lighting.eyePosition[1] - frame.position[1],
      lighting.eyePosition[2] - frame.position[2],
    ])
    pixelLighting = {
      ...(sceneLighting ?? {ambientColor:spatialLighting.ambient,lightColor:[0,0,0] as const}),
      normal: worldNormal,
      lights: spatialLighting.lights.map(light => {
        const {vector,distance,attenuation} = sampleLightGeometry(light,frame.position)
        const direction: Vec3 = distance === 0 ? [0,0,0] :
          [vector[0]/distance,vector[1]/distance,vector[2]/distance]
        const half = unit([eye[0]+direction[0],eye[1]+direction[1],eye[2]+direction[2]])
        const color: Vec3 = [light.color[0]*attenuation,light.color[1]*attenuation,light.color[2]*attenuation]
        return {direction,halfVector:[-half[0],-half[1],-half[2]] as Vec3,diffuseColor:color,specularColor:color}
      }),
    }
  }
  return program.shade({
    texels,
    normal: [0, 0, 1],
    ...(directLights && sampledNormal !== undefined ? {shadingNormal:sampledNormal} :
    (program.normalBlendPolicy === undefined && program.normalMapSpace !== 'object') ||
    worldNormal === undefined
      ? {}
      : { shadingNormal: worldNormal }),
    lightDirection,
    halfVector,
    viewDirection,
    viewNormal: vertex.viewNormal,
    eyeToVertex: vertex.viewPosition,
    vertexColor: vertex.color,
    ...(pixelLighting === undefined ? {} : { sceneLighting: pixelLighting }),
  })
}

/** Weights already include reciprocal clip-W, so every varying follows the GPU interpolation. */
export function interpolateMaterialVertex(
  vertices: readonly [MaterialVertex, MaterialVertex, MaterialVertex],
  weights: readonly [number, number, number],
): MaterialVertex {
  const mix = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
    a.map((value, i) => value * weights[0] + (b[i] ?? 0) * weights[1] + (c[i] ?? 0) * weights[2])
  const v3 = (
    key:
      | 'modelPosition'
      | 'modelNormal'
      | 'worldPosition'
      | 'worldNormal'
      | 'viewPosition'
      | 'viewNormal'
      | 'lightDirection'
      | 'halfVector'
      | 'viewDirection',
  ) => mix(vertices[0][key], vertices[1][key], vertices[2][key]) as unknown as Vec3
  const [a, b, c] = vertices.map(vertex => vertex.environment)
  const environment =
    a === undefined || b === undefined || c === undefined
      ? undefined
      : {
          position: mix(a.position, b.position, c.position) as unknown as Vec3,
          normal: mix(a.normal, b.normal, c.normal) as unknown as Vec3,
          tangent: mix(a.tangent, b.tangent, c.tangent) as unknown as Vec3,
          bitangent: mix(a.bitangent, b.bitangent, c.bitangent) as unknown as Vec3,
          objectNormalMatrix: a.objectNormalMatrix,
          ...(a.worldLighting === undefined ? {} : { worldLighting: a.worldLighting }),
          ...(a.eyeToVertex === undefined ||
          b.eyeToVertex === undefined ||
          c.eyeToVertex === undefined
            ? {}
            : {
                eyeToVertex: mix(a.eyeToVertex, b.eyeToVertex, c.eyeToVertex) as unknown as Vec3,
              }),
        }
  return {
    ...(environment === undefined ? {} : { environment }),
    modelPosition: v3('modelPosition'),
    modelNormal: v3('modelNormal'),
    worldPosition: v3('worldPosition'),
    worldNormal: v3('worldNormal'),
    viewPosition: v3('viewPosition'),
    viewNormal: v3('viewNormal'),
    lightDirection: v3('lightDirection'),
    halfVector: v3('halfVector'),
    viewDirection: v3('viewDirection'),
    uv: [0, 1, 2, 3].map(
      set =>
        mix(
          vertices[0].uv[set] ?? [0, 0],
          vertices[1].uv[set] ?? [0, 0],
          vertices[2].uv[set] ?? [0, 0],
        ) as unknown as Vec2,
    ),
    clip: mix(vertices[0].clip, vertices[1].clip, vertices[2].clip) as unknown as Vec4,
    color: mix(vertices[0].color, vertices[1].color, vertices[2].color) as unknown as Vec4,
  }
}
