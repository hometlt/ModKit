/**
 * The model stage's scene assembly, and the route from it into a real renderer provider.
 *
 * DOM-free: everything here is the part of the stage that decides *what* to send — the camera, the
 * materials, the bone poses — plus one end-to-end pass through the shipped headless provider, so a
 * regression in the maths is caught in Node rather than only in a browser suite.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ModelBoneBinding, ModelMaterialRef, ModelPrimitive } from '@modkit/sdk'
import {
  framePrimitive,
  materialColorFor,
  MODEL_KEY_LIGHT,
  MODEL_RENDERER_BACKENDS,
  MODEL_WIREFRAME_BACKEND,
  modelCamera,
  modelRendererBackend,
  modelSceneRequest,
  projectPoint,
  sceneMaterials,
  skeletonJoints,
} from '@modkit/ui/model'
import { createOrbitController } from '@modkit/ui/model'

const repoRoot = join(import.meta.dirname, '..', '..', '..')

interface HeadlessFrame {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
  readonly diagnostics: readonly { readonly code: string }[]
  readonly statistics: { readonly fragments: number; readonly triangles: number }
}

const headless = async (): Promise<
  (request: Record<string, unknown>) => Promise<HeadlessFrame>
> => {
  const module = (await import(
    pathToFileURL(join(repoRoot, 'packages', 'scene', 'src', 'render', 'headless.js')).href
  )) as { renderHeadless(request: Record<string, unknown>): Promise<HeadlessFrame> }
  return module.renderHeadless
}

/** A unit cube centred on the origin, with outward normals and a full UV square per face. */
function cube(materialId?: string): ModelPrimitive {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const faces: readonly (readonly [number, number, number])[] = [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ]
  for (const normal of faces) {
    const base = positions.length / 3
    // two in-plane axes for this face
    const axisA: readonly [number, number, number] =
      Math.abs(normal[1]) === 1 ? [1, 0, 0] : [normal[1], normal[2], normal[0]]
    const axisB: readonly [number, number, number] = [
      normal[1] * axisA[2] - normal[2] * axisA[1],
      normal[2] * axisA[0] - normal[0] * axisA[2],
      normal[0] * axisA[1] - normal[1] * axisA[0],
    ]
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      positions.push(
        (normal[0] + axisA[0] * u + axisB[0] * v) * 0.5,
        (normal[1] + axisA[1] * u + axisB[1] * v) * 0.5,
        (normal[2] + axisA[2] * u + axisB[2] * v) * 0.5,
      )
      normals.push(normal[0], normal[1], normal[2])
      uvs.push((u + 1) / 2, (v + 1) / 2)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return {
    id: 'cube',
    topology: 'triangles',
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    textureCoordinates: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    ...(materialId === undefined ? {} : { materialId }),
  }
}

const viewport = { width: 64, height: 64 } as const

describe('model stage camera', () => {
  it('frames a primitive from its own bounds and keeps the centre on screen', () => {
    const framing = framePrimitive(cube())
    expect(framing.center.map(value => Math.round(value * 1000) / 1000)).toEqual([0, 0, 0])
    expect(framing.radius).toBeGreaterThan(0.5)
    const camera = createOrbitController()
    const placement = modelCamera(framing, camera.basis(), 1, viewport)
    const centre = projectPoint(placement.viewProjection, framing.center, viewport)
    expect(centre).toBeDefined()
    expect(centre?.[0]).toBeCloseTo(viewport.width / 2, 3)
    expect(centre?.[1]).toBeCloseTo(viewport.height / 2, 3)
  })

  it('frames a primitive with no declared bounds from its positions', () => {
    const primitive = cube()
    expect(primitive.bounds).toBeUndefined()
    expect(framePrimitive(primitive).radius).toBeGreaterThan(0)
  })

  it('never produces a non-finite matrix for a degenerate primitive', () => {
    const degenerate: ModelPrimitive = {
      id: 'point',
      topology: 'points',
      positions: new Float32Array([1, 1, 1]),
    }
    const framing = framePrimitive(degenerate)
    expect(framing.radius).toBeGreaterThan(0)
    const placement = modelCamera(framing, createOrbitController().basis(), 1, viewport)
    expect([...placement.viewProjection].every(Number.isFinite)).toBe(true)
  })

  it('pulls the camera back as the pose zooms out', () => {
    const framing = framePrimitive(cube())
    const basis = createOrbitController().basis()
    const near = modelCamera(framing, basis, 1, viewport)
    const far = modelCamera(framing, basis, 2, viewport)
    const distance = (eye: readonly [number, number, number]): number =>
      Math.hypot(eye[0], eye[1], eye[2])
    expect(distance(far.eye)).toBeGreaterThan(distance(near.eye))
  })
})

describe('model stage materials', () => {
  it('gives every material id its own stable colour', () => {
    const first = materialColorFor('hull')
    expect(materialColorFor('hull')).toEqual(first)
    expect(materialColorFor('canopy')).not.toEqual(first)
    expect(first.every(component => component >= 0 && component <= 1)).toBe(true)
  })

  it('asks for lambert shading and carries no texture when none resolved', () => {
    const refs: readonly ModelMaterialRef[] = [
      { id: 'hull', name: 'Hull', layers: [{ slot: 'diffuse', resourceId: 'hull.dds' }] },
    ]
    const surfaces = sceneMaterials(refs, new Map(), true)
    expect(surfaces.textures).toEqual([])
    expect(surfaces.materials[0]).toMatchObject({ id: 'hull', shading: 'lambert' })
    expect(surfaces.materials[0]?.baseColorTexture).toBeUndefined()
  })

  it('binds a resolved texture to the layer that names it', () => {
    const refs: readonly ModelMaterialRef[] = [
      { id: 'hull', layers: [{ slot: 'Diffuse' }, { slot: 'diffuse', resourceId: 'hull.dds' }] },
    ]
    const texture = {
      id: 'texture:hull.dds',
      width: 1,
      height: 1,
      rgba: new Uint8Array([255, 0, 0, 255]),
    }
    const surfaces = sceneMaterials(refs, new Map([['hull.dds', texture]]), true)
    expect(surfaces.textures).toEqual([texture])
    expect(surfaces.materials[0]?.baseColorTexture).toBe('texture:hull.dds')
  })
})

describe('model stage skeleton', () => {
  const binding = (
    boneIndex: number,
    translation: readonly [number, number, number],
    parentBoneIndex?: number | null,
  ): ModelBoneBinding => ({
    partId: 'part',
    boneIndex,
    boneName: `bone-${boneIndex}`,
    provenance: 'direct',
    ...(parentBoneIndex === undefined ? {} : { parentBoneIndex }),
    restMatrix: [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      translation[0],
      translation[1],
      translation[2],
      1,
    ],
  })

  it('reads joint positions from the rest matrix translation and links parents', () => {
    const joints = skeletonJoints([
      binding(0, [0, 0, 0], null),
      binding(1, [0, 1, 0], 0),
      binding(2, [0, 2, 0], 1),
    ])
    expect(joints.map(joint => joint.position)).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
    ])
    expect(joints.map(joint => joint.parent)).toEqual([undefined, 0, 1])
  })

  it('drops a binding with no rest matrix rather than placing it at the origin', () => {
    const named: ModelBoneBinding = {
      partId: 'part',
      boneIndex: 7,
      boneName: 'named-only',
      provenance: 'direct',
    }
    expect(skeletonJoints([named])).toEqual([])
  })
})

describe('model stage backend names', () => {
  it('separates the 2D fallback from a resolved GPU provider', () => {
    expect(MODEL_WIREFRAME_BACKEND).toBe('wireframe')
    expect(modelRendererBackend('modkit.browser-webgl')).toBe('webgl2')
    expect(modelRendererBackend('modkit.headless')).toBe('cpu-raster')
    expect(MODEL_RENDERER_BACKENDS['modkit.browser-webgl']).toBe('webgl2')
  })

  it('names an unknown third-party provider without pretending to know its backend', () => {
    expect(modelRendererBackend('reference.software')).toBe('provider')
  })
})

describe('the stage request drawn by the shipped headless provider', () => {
  it('shades a mesh, so a lit face and a face turned away are different colours', async () => {
    const renderHeadless = await headless()
    const primitive = cube('hull')
    const surfaces = sceneMaterials([{ id: 'hull' }], new Map(), true)
    const placement = modelCamera(
      framePrimitive(primitive),
      createOrbitController().basis(),
      1,
      viewport,
    )
    const shaded = await renderHeadless(
      modelSceneRequest({
        primitive,
        camera: placement,
        viewport,
        materials: surfaces.materials,
        clearColor: [0, 0, 0, 0],
        light: MODEL_KEY_LIGHT,
      }) as unknown as Record<string, unknown>,
    )
    expect(shaded.statistics.fragments).toBeGreaterThan(0)
    expect(shaded.diagnostics).toEqual([])

    const luminances = new Set<number>()
    for (let offset = 0; offset < shaded.rgba.length; offset += 4) {
      if (shaded.rgba[offset + 3] === 0) continue
      luminances.add(shaded.rgba[offset] as number)
    }
    // A flat fill produces exactly one covered luminance; a shaded cube shows its faces apart.
    expect(luminances.size).toBeGreaterThan(1)
  })

  it('draws the base colour flat when the scene carries no light', async () => {
    const renderHeadless = await headless()
    const primitive = cube('hull')
    const placement = modelCamera(
      framePrimitive(primitive),
      createOrbitController().basis(),
      1,
      viewport,
    )
    const unlit = await renderHeadless(
      modelSceneRequest({
        primitive,
        camera: placement,
        viewport,
        materials: [{ id: 'hull', baseColor: [1, 0, 0, 1] }],
        clearColor: [0, 0, 0, 0],
      }) as unknown as Record<string, unknown>,
    )
    const covered = new Set<string>()
    for (let offset = 0; offset < unlit.rgba.length; offset += 4) {
      if (unlit.rgba[offset + 3] === 0) continue
      covered.add(`${unlit.rgba[offset]},${unlit.rgba[offset + 1]},${unlit.rgba[offset + 2]}`)
    }
    expect([...covered]).toEqual(['255,0,0'])
  })

  it('samples a base-colour texture through the material that names it', async () => {
    const renderHeadless = await headless()
    const primitive = cube('hull')
    // A 2x2 checker: any UV mapping that is actually sampled produces more than one colour.
    const texture = {
      id: 'texture:checker',
      width: 2,
      height: 2,
      rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]),
    }
    const surfaces = sceneMaterials(
      [{ id: 'hull', layers: [{ slot: 'diffuse', resourceId: 'checker' }] }],
      new Map([['checker', texture]]),
      false,
    )
    expect(surfaces.textures).toHaveLength(1)
    const frame = await renderHeadless(
      modelSceneRequest({
        primitive,
        camera: modelCamera(
          framePrimitive(primitive),
          createOrbitController().basis(),
          1,
          viewport,
        ),
        viewport,
        materials: surfaces.materials,
        textures: surfaces.textures,
        clearColor: [0, 0, 0, 0],
      }) as unknown as Record<string, unknown>,
    )
    const covered = new Set<string>()
    for (let offset = 0; offset < frame.rgba.length; offset += 4) {
      if (frame.rgba[offset + 3] === 0) continue
      covered.add(`${frame.rgba[offset]},${frame.rgba[offset + 1]},${frame.rgba[offset + 2]}`)
    }
    expect(covered.size).toBeGreaterThan(1)
  })

  it('reports a dangling texture reference and still draws the model', async () => {
    const renderHeadless = await headless()
    const primitive = cube('hull')
    const frame = await renderHeadless(
      modelSceneRequest({
        primitive,
        camera: modelCamera(
          framePrimitive(primitive),
          createOrbitController().basis(),
          1,
          viewport,
        ),
        viewport,
        materials: [{ id: 'hull', baseColor: [1, 1, 1, 1], baseColorTexture: 'texture:absent' }],
        clearColor: [0, 0, 0, 0],
      }) as unknown as Record<string, unknown>,
    )
    expect(frame.diagnostics.map(item => item.code)).toContain('modkit.headless/texture-missing')
    expect(frame.statistics.fragments).toBeGreaterThan(0)
  })
})
