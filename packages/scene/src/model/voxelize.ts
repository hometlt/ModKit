/**
 * Scene-owned static surface voxelization of renderer geometry in Y-up space. Reuses posed
 * material geometry, the terrain polygon clipper, texture sampler, pinned codec-kit obj2voxel
 * kernel and exposed-face mesher. UV materialization owns the resulting GLB serialization.
 * One RGB sample per clipped triangle; MASK is centroid-tested, BLEND/effects are refused.
 * Surface shell only: no volume fill, Minecraft blocks, animation, PBR or native write claim.
 * At most 100000 clipped triangles, resolution 2..128, bounded cells and output; cooperative
 * cancellation is checked around synchronous WASM (which cannot be interrupted in-process).
 */
import type { SceneRendererScene } from '@modkit/sdk/renderer'
import { revisionId } from '@modkit/sdk'
import { createPinnedVoxelKernel } from '@modkit/codec-kit/model/voxel-kernel'
import { voxelSurface } from '@modkit/codec-kit/model/geometry'
import { materializeUvmCore } from '@modkit/uv'
import { clipPolygon } from '../world/webgl.js'
import { materialGeometry, prepareMaterialGeometry } from '../render/material-geometry.js'
import { sampleMaterialTexture } from '../render/materials.js'
import { Triangle, Vector3 } from 'three'

export interface SceneVoxelOptions {
  readonly region: 'all' | 'southwest'
  readonly resolution: number
  readonly assetId: string
  readonly revision: string
  readonly maxBytes: number
  readonly signal?: AbortSignal
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
type Vertex = { p: readonly number[]; uv: readonly number[]; c: readonly number[] }

/** Clip first, then voxelize just the selected geometry on one uniform grid. */
export async function voxelizeScene(scene: SceneRendererScene, options: SceneVoxelOptions) {
  const { signal, resolution, region } = options
  signal?.throwIfAborted()
  if (
    !Number.isInteger(resolution) ||
    resolution < 2 ||
    resolution > 128 ||
    !['all', 'southwest'].includes(region) ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1
  )
    throw new RangeError('invalid scene voxel options')
  if (
    scene.primitives.length > 4096 ||
    scene.primitives.reduce((n, p) => n + p.positions.length / 3, 0) > 1000000
  )
    throw new RangeError('voxel source exceeds primitive/vertex budget')
  const prepared = scene.primitives
    .filter(p => p.topology === 'triangles')
    .map(p => prepareMaterialGeometry(p, 64 * 1024 ** 2))
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  const geometries = prepared.map(p => ({
    p,
    g: materialGeometry(p, { viewProjection: IDENTITY }),
  }))
  for (const { p, g } of geometries)
    for (let i = 0; i < p.positions.length / 3; i++) {
      if ((i & 1023) === 0) signal?.throwIfAborted()
      const v = g.vertex(i).worldPosition
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, v[a]!)
        max[a] = Math.max(max[a]!, v[a]!)
      }
    }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite))
    throw new RangeError('empty voxel scene')
  // North-up Y-up projection: X right, Z down; southwest is min-X / max-Z.
  const bounds =
    region === 'southwest'
      ? [min[0]!, (min[2]! + max[2]!) / 2, (min[0]! + max[0]!) / 2, max[2]!]
      : [min[0]!, min[2]!, max[0]!, max[2]!]
  const materials = new Map((scene.materials ?? []).map(m => [m.id, m]))
  const textures = new Map((scene.textures ?? []).map(t => [t.id, t]))
  const positions: number[] = [],
    rgb: number[] = []
  const area = new Triangle(new Vector3(), new Vector3(), new Vector3())
  const ab = new Vector3(),
    ac = new Vector3()
  let inputTriangles = 0,
    omittedTransparent = 0,
    omittedDegenerate = 0
  for (const { p, g } of geometries) {
    const material = p.materialId === undefined ? undefined : materials.get(p.materialId)
    if (p.materialId !== undefined && material === undefined)
      throw new TypeError('missing voxel source material')
    if (material?.shader !== undefined || material?.alphaMode === 'blend')
      throw new TypeError(
        'voxelize a static base-colour GLB first; layered/blended materials are unsupported',
      )
    const texture =
      material?.baseColorTexture === undefined ? undefined : textures.get(material.baseColorTexture)
    if (material?.baseColorTexture !== undefined && texture === undefined)
      throw new TypeError('missing voxel source texture')
    const corners = p.indices?.length ?? p.positions.length / 3
    for (let i = 0; i < corners; i += 3) {
      if ((i & 1023) === 0) signal?.throwIfAborted()
      inputTriangles++
      let polygon: Vertex[] = [0, 1, 2].map(k => {
        const v = g.vertex(p.indices?.[i + k] ?? i + k)
        return { p: v.worldPosition, uv: v.uv[0] ?? [0, 0], c: v.color }
      })
      const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => ({
        p: a.p.map((v, k) => v + (b.p[k]! - v) * t),
        uv: a.uv.map((v, k) => v + (b.uv[k]! - v) * t),
        c: a.c.map((v, k) => v + (b.c[k]! - v) * t),
      })
      for (const [axis, edge, sign] of [
        [0, bounds[0]!, 1],
        [2, bounds[1]!, 1],
        [0, bounds[2]!, -1],
        [2, bounds[3]!, -1],
      ])
        polygon = clipPolygon(polygon, v => (v.p[axis!]! - edge!) * sign!, interpolate)
      for (let j = 1; j + 1 < polygon.length; j++) {
        // The kernel snapshots float32: test collapse after the same rounding, not in JS doubles.
        const tri = [polygon[0]!, polygon[j]!, polygon[j + 1]!].map(v => ({
          ...v,
          p: v.p.map(Math.fround),
        }))
        area.a.fromArray(tri[0]!.p)
        area.b.fromArray(tri[1]!.p)
        area.c.fromArray(tri[2]!.p)
        // Use the kernel's first-corner edge convention: nearly collinear float32 points can
        // cancel differently around the second corner used by Triangle.getArea().
        ab.subVectors(area.b, area.a)
        ac.subVectors(area.c, area.a)
        if (ab.cross(ac).length() <= 1e-10) {
          omittedDegenerate++
          continue
        }
        const mean = (key: 'uv' | 'c', axis: number) =>
          tri.reduce((n, v) => n + v[key][axis]!, 0) / 3
        const texel =
          texture === undefined
            ? [1, 1, 1, 1]
            : sampleMaterialTexture(
                texture,
                mean('uv', 0),
                mean('uv', 1),
                texture.wrapU ?? 'repeat',
                texture.wrapV ?? 'repeat',
              )
        const factor = material?.baseColor ?? [1, 1, 1, 1]
        if (
          material?.alphaMode === 'mask' &&
          texel[3]! * factor[3] * mean('c', 3) < (material.alphaCutoff ?? 0.5)
        ) {
          omittedTransparent++
          continue
        }
        if (rgb.length / 3 >= 100000)
          throw new RangeError('selected region exceeds 100000 voxel triangles')
        for (const v of tri) positions.push(...v.p)
        for (let a = 0; a < 3; a++)
          rgb.push(Math.max(0, Math.min(1, texel[a]! * factor[a]! * mean('c', a))))
      }
    }
  }
  if (!positions.length) throw new RangeError('selected voxel region has no opaque triangles')
  const grid = await createPinnedVoxelKernel({
    maxRawCells: 128 ** 3,
    maxAccountedBytes: 256 * 1024 ** 2,
  }).run(
    {
      resolution,
      geometry: {
        kind: 'triangle-rgb',
        positions: Float32Array.from(positions),
        triangleRgb: Float32Array.from(rgb),
      },
    },
    signal,
  )
  const surface = voxelSurface(grid.grid, {
    maxCells: 128 ** 3,
    maxOutputBytes: options.maxBytes,
    ...(signal === undefined ? {} : { signal }),
  })
  const written = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 1,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
        upAxis: '+y',
      },
      nodes: [
        {
          id: 'node-0',
          name: 'voxels',
          childIds: [],
          meshIds: ['mesh-0'],
          transform: grid.transform.gridToSource,
        },
      ],
      meshes: [{ id: 'mesh-0', primitiveIds: [surface.primitive.id] }],
      primitives: [{ ...surface.primitive, materialId: 'voxel-colour' }],
      materials: [
        {
          id: 'voxel-colour',
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      ],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: revisionId(options.revision),
      options: { assetId: options.assetId, sourceFormat: 'scene-surface-voxels' },
    },
    signal === undefined ? {} : { signal },
  )
  if (written.bytes.byteLength > options.maxBytes)
    throw new RangeError('voxel GLB exceeds output budget')
  return {
    bytes: written.bytes,
    receipt: {
      region,
      bounds,
      sourceBounds: { minimum: min, maximum: max },
      resolution,
      inputTriangles,
      selectedTriangles: rgb.length / 3,
      omittedTransparent,
      omittedDegenerate,
      cells: surface.cells,
      faces: surface.faces,
      cellSize: grid.transform.cellSize,
      gridToSource: grid.transform.gridToSource,
      losses: [
        'surface-shell-only',
        'one-colour-per-clipped-triangle',
        'mask-centroid-coverage',
        'animation-and-pbr-omitted',
      ],
      kernelLosses: grid.losses,
    },
  }
}
