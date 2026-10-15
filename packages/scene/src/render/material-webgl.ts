import { applyWebGlDepthBias } from './depth-bias.js'
import { WORLD_VISIBILITY_GLSL, bindWorldVisibility, checkedWorldVisibilityBounds, type WorldVisibilityBounds } from '../world/world-visibility.js'
import type {
  SceneRendererCamera,
  SceneRendererDirectionalLight,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import {
  createWebGlMaterialProgram,
  linkWebGlMaterialProgramsInParallel,
  shaderPairCacheKey,
  uniformLocation,
  type WebGlMaterialProgram,
} from '../materials/webgl.js'
import type { StandardMaterialProgram } from '../materials/index.js'
import {
  materialFrameGeometry,
  materialMirrors,
  materialModelMatrix,
  materialNormalMatrix,
  sceneMaterialVertexSource,
} from './material-geometry.js'
import { materialIsSolid, type MaterialDraw } from './material-draws.js'
import { materialSkinOf } from './material-skin.js'
import { primitiveFade, primitiveVertexTints } from './tint.js'
import { primitiveVertexPlacements } from './vertex-placements.js'
import { WORLD_SHADOW_GLSL, type WorldShadowReceiver } from './world-shadow.js'
import {
  LIGHT_GEOMETRY_GLSL, bindPreviewLighting, readPreviewLighting, type PreviewLighting,
} from './preview-lighting.js'

/**
 * The vertex and fragment stages a draw needs beyond its material's: a skin posed on the GPU
 * (ModelSceneSkin) and per-vertex tints (primitiveVertexTints). Each combination is its own lease.
 */
interface MaterialStages {
  readonly skinned: boolean
  readonly tinted: boolean
  readonly spatial?: boolean
  /** The program cache's key for these stages. */
  readonly key: string
}

/** The four stage choices, made once: a draw asks for its stages every frame. */
const STAGES: readonly (readonly (readonly MaterialStages[])[])[] = [false,true].map(spatial =>
  [false, true].map(skinned => Object.freeze(
    [false, true].map(tinted =>
      Object.freeze({ skinned, tinted, spatial,
        key: `${String(skinned)}|${String(tinted)}${spatial?'|spatial':''}` }),
    ),
  )),
)

const materialStagesOf = (primitive: MaterialDraw['primitive'], spatial = false): MaterialStages =>
  STAGES[spatial?1:0]![materialSkinOf(primitive) === undefined ? 0 : 1]![
    primitiveVertexTints(primitive) === undefined ? 0 : 1
  ]!

const PLAIN_STAGES = STAGES[0]![0]![0]!

const stagesKey = (stages: MaterialStages) => stages.key
import { requiresEnvironmentEye, snapshotEyePosition } from '../materials/environment.js'
import { cubeNearestSamplerSource } from '../materials/cube-maps.js'

/** Placements of one draw's geometry and material: sixteen column-major floats per instance. */
export interface MaterialInstances {
  readonly matrices: Float32Array
  readonly count: number
  /**
   * A skinned draw's pose per instance (ModelSceneSkin.palette), in the order of the matrices:
   * placements of one mesh in different poses draw at once. Absent, every instance takes the
   * draw's own palette.
   */
  readonly palettes?: readonly Float32Array[]
}

/** One draw of a sequence; with `instances` it draws every placement at once (`drawInstanced`). */
export interface MaterialSequenceDraw {
  readonly draw: MaterialDraw
  readonly instances?: MaterialInstances
}

/**
 * For draws a caller keeps across frames while their materials play: the program each draw's
 * program stands for at this frame, of the same layout (shader, textures, blend and uniform names).
 * The draw keeps its GPU lease; uniform values, the material frame and pipeline state come from the
 * program it stands for.
 */
export type MaterialSequencePrograms = ReadonlyMap<StandardMaterialProgram, StandardMaterialProgram>

const IDENTITY_MATRIX = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const worldToMaterialMatrices = new WeakMap<StandardMaterialProgram, Float32Array>()

const worldToMaterialOf = (source: StandardMaterialProgram) => {
  let matrix = worldToMaterialMatrices.get(source)
  if (matrix === undefined)
    worldToMaterialMatrices.set(
      source,
      (matrix =
        source.worldToMaterial === undefined
          ? IDENTITY_MATRIX
          : Float32Array.from(source.worldToMaterial)),
    )
  return matrix
}

/** Materials whose shading reads world-space inputs; the vertex stage and frame uniforms differ. */
const materialWorldShading = (source: StandardMaterialProgram) =>
  source.normalBlendPolicy !== undefined || source.normalMapSpace === 'object'

/** Two vertex array keys holding the same values in order (see geometryKey). */
const sameEntries = (left: readonly unknown[], right: readonly unknown[]) => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

/** What a draw's UV set `set` reads: that set's coordinates, or for set 0 textureCoordinates. */
function uvCoordinatesOf(primitive: MaterialDraw['primitive'], set: number) {
  let found: Float32Array | undefined
  const sets = primitive.textureCoordinateSets
  if (sets !== undefined)
    for (const uv of sets)
      if (uv.set === set) {
        found = uv.coordinates
        break
      }
  return found ?? (set === 0 ? primitive.textureCoordinates : undefined)
}

const sameNumbers = (left: ArrayLike<number> | undefined, right: ArrayLike<number> | undefined) => {
  if (left === undefined || right === undefined) return left === right
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

/**
 * Object-space normal maps read the draw's normal matrix per fragment (`u_sceneWorldNormalMatrix`),
 * which instanced draws derive per vertex; such materials draw one placement at a time.
 */
export const materialCanInstance = (program: StandardMaterialProgram) =>
  program.normalMapSpace !== 'object'

/**
 * Uploaded textures of material draws: by texture id, or by the texture itself when ids are not
 * unique (a world whose models carry one texture path at different reduced sizes).
 */
export type MaterialTextureHandles =
  ReadonlyMap<string, WebGLTexture> | ((texture: SceneRendererTexture) => WebGLTexture | undefined)

/**
 * Skin palettes (see ModelSceneSkin) live in one float texture of this many texels a row, four a
 * matrix, on this texture unit: past the material textures and the world's own units (0-11).
 */
const SKIN_PALETTE_WIDTH = 1024
const SKIN_PALETTE_UNIT = 15
/**
 * The world's shadow map (MaterialSceneLight.shadow) on this unit, below the skin palettes: a program
 * lit by the scene's key light reads it as a 2D sampler. A material of more textures takes no shadow.
 */
const SHADOW_MAP_UNIT = 14

/** Retained GPU program/geometry leases. Scene owns camera matrices and render state. */
export function materialWebGlDraws(
  gl: WebGL2RenderingContext,
  textures: MaterialTextureHandles,
  /**
   * `mipmaps`: the caller uploaded every linear texture with a full mip chain.
   * `checkEachDraw: false`: the caller checks WebGL errors per pass; `getError` forces a GPU sync,
   * which dominated frame time with tens of thousands of draws.
   */
  options: Readonly<{ mipmaps?: boolean; checkEachDraw?: boolean }> = {},
) {
  // A lease per material program and stage variant (see MaterialStages), and the programs of each
  // variant a frame used.
  const programs = new Map<string, Map<StandardMaterialProgram, WebGlMaterialProgram>>()
  const usedPrograms = new Map<string, Set<StandardMaterialProgram>>()
  // Leases hold per-material uniforms and samplers; linked GL programs are shared by shader source.
  const linked = new Map<string, WebGLProgram>()
  const pendingPrograms = new Set<WebGLProgram>()
  let programCompilations = 0
  let drawCalls = 0
  // Cumulative (counters()): vertex arrays and buffers made, placements drawn.
  let vertexArraysCreated = 0,
    buffersCreated = 0,
    placementsDrawn = 0
  // Primitive arrays are immutable for the lifetime of a draw plan; keep their GPU copies across
  // frames instead of re-uploading every attribute on every draw. `sweep()` drops arrays a frame
  // did not touch, `release()` drops everything.
  interface BufferEntry {
    buffer: WebGLBuffer
    target: number
    byteLength: number
    used: boolean
  }
  interface VertexArrayEntry {
    vao: WebGLVertexArrayObject
    data: readonly (ArrayBufferView | undefined)[]
    buffers: BufferEntry[]
    constants: { location: number; value: Float32Array }[]
    /** Model-matrix column attributes; a single draw sets them as constant values. */
    placement: readonly number[]
    /**
     * An instanced vertex array's own buffer of placements, and the matrices it holds: a group whose
     * placements change (a unit moves, a rigid part animates) uploads its new matrices into it,
     * keeping the vertex array, instead of making a vertex array for each frame's matrices.
     */
    instances?: { buffer: WebGLBuffer; data: Float32Array; byteLength: number }
    /**
     * The index array the vertex array binds now, and its retained buffer: a blended primitive's
     * triangles sorted again for the view (depthSortedTriangles) rebind the vertex array's elements
     * instead of making a vertex array for each order.
     */
    elements?: { data: ArrayBufferView; buffer: BufferEntry }
    /**
     * An instanced skinned vertex array's own buffer of first palette texels (a_instanceSkinBase)
     * and the values it holds; a single skinned draw's vertex array reads a constant value.
     */
    skinBases?: { buffer: WebGLBuffer; data: Float32Array }
    used: boolean
  }
  /** The placement slot of an instanced vertex array's key: its matrices are not part of the key. */
  const INSTANCED = new Float32Array(0)
  /** The index slot of an indexed vertex array's key: its index array is not part of the key. */
  const INDEXED = new Uint32Array(0)
  const retained = new Map<ArrayBufferView, BufferEntry>()
  // Buffers of arrays a frame stopped drawing, by target and size, for the next frame's new arrays:
  // an animated scene draws new sprite and skin arrays of the same sizes every frame (on Amphion
  // ~1 500 buffers), and creating and deleting a buffer for each was half of its GPU process work.
  // A new array respecifies a spare's storage (bufferData), so a frame still in flight is not waited
  // for.
  const spareBuffers = new Map<string, WebGLBuffer[]>()
  let spareBytes = 0
  const MAX_SPARE_BYTES = 64 * 1024 * 1024
  // Instances share arrays, but not primitive objects. Attribute layouts belong to the linked
  // program; uniforms (including transform/tint) do not belong in the VAO key.
  const vertexArrays = new Map<WebGLProgram, Map<Float32Array, VertexArrayEntry[]>>()
  // Uniform values stay in their linked program until changed: remember what each program holds
  // and skip uploads that would repeat it. Frame uniforms follow the camera and light (`frames`).
  const programFrames = new WeakMap<WebGLProgram, number>()
  const programLeases = new WeakMap<WebGLProgram, WebGlMaterialProgram>()
  const programUniforms = new WeakMap<WebGLProgram, StandardMaterialProgram['uniforms']>()
  const programWorldToMaterial = new WeakMap<WebGLProgram, Float32Array>()
  const programTints = new WeakMap<WebGLProgram, readonly number[]>()
  // Leases with equal sampling parameters share one sampler object; per-time leases of animated
  // materials otherwise created and deleted hundreds of samplers every frame.
  const samplers = new Map<string, WebGLSampler>()
  /**
   * Context state the previous draw of a sequence left behind; unset fields are unknown. Nothing
   * but the sequence touches the context while it runs, so draws skip what is already in place.
   */
  /**
   * Whether a generic attribute holds these four values: every generic attribute write of a sequence
   * is recorded in its state, so equal values (defaults of different vertex arrays, the columns of
   * one placement's consecutive draws) need no call.
   */
  const holdsAttribute = (held: Float32Array | undefined, values: Float32Array, from: number) =>
    held !== undefined &&
    held.length === 4 &&
    Object.is(held[0], values[from]) &&
    Object.is(held[1], values[from + 1]) &&
    Object.is(held[2], values[from + 2]) &&
    Object.is(held[3], values[from + 3])
  interface SequenceState {
    program?: WebGLProgram
    vertexArray?: WebGLVertexArrayObject
    readonly units: (WebGlMaterialProgram['textureUnits'][number] | undefined)[]
    /** The texture unit this sequence last made active. */
    activeUnit?: number
    /** The unit a binding change last concerned: the one a sequence leaves active (see restore). */
    lastUnit?: number
    readonly constants: Map<number, Float32Array>
    /** The skin palettes' texture is bound on its unit (see SKIN_PALETTE_UNIT). */
    skinPalettes?: boolean
    colorMask?: boolean
    depthMask?: boolean
    depthTest?: boolean
    depthFunction?: number
    depthBias?: string
    cull?: boolean
    /** The winding culling keeps: CCW, or CW for a mirrored model (glTF). */
    frontFace?: number
    blend?: string
  }
  interface MaterialFrame {
    readonly serial: number
    readonly camera: SceneRendererCamera
    readonly light: MaterialSceneLight | undefined
    readonly spatialLighting: PreviewLighting | undefined
    readonly geometry: ReturnType<typeof materialFrameGeometry>
    readonly eyePosition: ReturnType<typeof snapshotEyePosition>
    worldLighting(): ReturnType<typeof materialFrameGeometry>['worldLighting']
  }
  let frameSerial = 0
  let lastFrame: MaterialFrame | undefined
  let lastFrameValues:
    | Readonly<{
        viewProjection: Float32Array
        viewMatrix: Float32Array | undefined
        eyePosition: readonly number[] | undefined
        light: MaterialSceneLight | undefined
        lightJson: string
      }>
    | undefined
  /** The frame of a camera and light; equal values keep the serial, so programs keep their uploads. */
  const frameOf = (camera: SceneRendererCamera, light: MaterialSceneLight | undefined) => {
    const eyePosition = snapshotEyePosition(camera.eyePosition)
    const spatialLighting = light?.spatialLighting === undefined ? undefined :
      readPreviewLighting(light.spatialLighting.lights,light.spatialLighting.ambient)
    const lightJson =
      spatialLighting === undefined && lastFrame?.spatialLighting === undefined &&
      lastFrameValues !== undefined && light === lastFrameValues.light
        ? lastFrameValues.lightJson
        : JSON.stringify(light ?? null)
    if (
      lastFrame === undefined ||
      lastFrameValues === undefined ||
      !sameNumbers(camera.viewProjection, lastFrameValues.viewProjection) ||
      !sameNumbers(camera.viewMatrix, lastFrameValues.viewMatrix) ||
      !sameNumbers(eyePosition, lastFrameValues.eyePosition) ||
      lightJson !== lastFrameValues.lightJson
    ) {
      let lighting: ReturnType<typeof materialFrameGeometry>['worldLighting']
      frameSerial += 1
      lastFrame = {
        serial: frameSerial,
        camera,
        light,
        spatialLighting,
        geometry: materialFrameGeometry(camera, light, false),
        eyePosition,
        worldLighting: () => (lighting ??= materialFrameGeometry(camera, light, true).worldLighting),
      }
      lastFrameValues = {
        viewProjection: Float32Array.from(camera.viewProjection),
        viewMatrix: camera.viewMatrix === undefined ? undefined : Float32Array.from(camera.viewMatrix),
        eyePosition: eyePosition === undefined ? undefined : [...eyePosition],
        light,
        lightJson,
      }
    }
    return lastFrame
  }
  // The frame's skin palettes, packed one after another in the texture: each palette's first texel,
  // and the packed values. A frame packs them at once (prepareSkins); a palette first drawn later is
  // appended. Each program holds the palette unit and the first texel of its last skinned draw.
  let skinTexture: WebGLTexture | null = null
  let skinRows = 0
  let skinData = new Float32Array(0)
  let skinTexels = 0
  let skinBases = new Map<Float32Array, number>()
  const skinUnits = new WeakSet<WebGLProgram>()
  // Whether a program's draw takes the shadow (MaterialDraw.receiveShadows), as its uniform holds it.
  const programShadowReceivers = new WeakMap<WebGLProgram, number>()
  // The texture on SHADOW_MAP_UNIT across sequences: none at first (only the shadow map is put there
  // by this renderer), undefined once a material's own texture went there.
  let shadowUnitTexture: WebGLTexture | null | undefined = null
  /** Room in the packed values for `texels` texels, keeping those packed so far. */
  const reserveSkinTexels = (texels: number) => {
    const rows = Math.ceil(texels / SKIN_PALETTE_WIDTH)
    if (skinData.length >= rows * SKIN_PALETTE_WIDTH * 4) return
    const grown = new Float32Array(
      Math.max(rows, (2 * skinData.length) / (SKIN_PALETTE_WIDTH * 4)) * SKIN_PALETTE_WIDTH * 4,
    )
    grown.set(skinData)
    skinData = grown
  }
  /**
   * Uploads the packed rows from `first` up to the last packed texel, first growing the texture to
   * hold them (a new storage takes every row packed so far). Leaves the palette unit active with
   * the texture bound.
   */
  const uploadSkinRows = (first: number) => {
    const rows = Math.ceil(skinTexels / SKIN_PALETTE_WIDTH)
    gl.activeTexture(gl.TEXTURE0 + SKIN_PALETTE_UNIT)
    if (skinTexture === null) {
      skinTexture = gl.createTexture()
      if (skinTexture === null) throw new TypeError('could not allocate the skin palette texture')
      gl.bindTexture(gl.TEXTURE_2D, skinTexture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    } else gl.bindTexture(gl.TEXTURE_2D, skinTexture)
    if (rows > skinRows) {
      skinRows = Math.max(rows, skinRows * 2, 16)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        SKIN_PALETTE_WIDTH,
        skinRows,
        0,
        gl.RGBA,
        gl.FLOAT,
        null,
      )
      first = 0
    }
    if (rows > first)
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        first,
        SKIN_PALETTE_WIDTH,
        rows - first,
        gl.RGBA,
        gl.FLOAT,
        skinData,
        first * SKIN_PALETTE_WIDTH * 4,
      )
  }
  const checkPalette = (palette: Float32Array) => {
    if (palette.length === 0 || palette.length % 16 !== 0)
      throw new TypeError('invalid skin palette')
  }
  /** The palette's first texel this frame, appending and uploading it when it is new. */
  const skinBase = (palette: Float32Array): number | undefined => {
    const known = skinBases.get(palette)
    if (known !== undefined) return known
    checkPalette(palette)
    const base = skinTexels
    reserveSkinTexels(base + palette.length / 4)
    skinData.set(palette, base * 4)
    skinTexels = base + palette.length / 4
    skinBases.set(palette, base)
    uploadSkinRows(Math.floor(base / SKIN_PALETTE_WIDTH))
    return undefined
  }
  // A linked program's attribute locations never change: each vertex array asked for all of them
  // again (an animated frame builds hundreds of vertex arrays, ~3 000 getAttribLocation calls).
  const attributeLocations = new WeakMap<WebGLProgram, Map<string, number>>()
  const attributeLocation = (program: WebGLProgram, name: string) => {
    let locations = attributeLocations.get(program)
    if (locations === undefined) attributeLocations.set(program, (locations = new Map()))
    let location = locations.get(name)
    if (location === undefined)
      locations.set(name, (location = gl.getAttribLocation(program, name)))
    return location
  }
  const retainedBuffer = (target: number, data: ArrayBufferView) => {
    let entry = retained.get(data)
    if (entry === undefined) {
      const spare = spareBuffers.get(`${target}:${data.byteLength}`)?.pop()
      if (spare !== undefined) spareBytes -= data.byteLength
      const buffer = spare ?? gl.createBuffer()
      if (buffer === null) throw new TypeError('could not allocate material geometry')
      if (spare === undefined) buffersCreated += 1
      gl.bindBuffer(target, buffer)
      gl.bufferData(target, data, gl.STATIC_DRAW)
      entry = { buffer, target, byteLength: data.byteLength, used: true }
      retained.set(data, entry)
    } else gl.bindBuffer(target, entry.buffer)
    entry.used = true
    return entry
  }
  // A draw's vertex array key, written into one scratch array for every draw and copied only into
  // a new vertex array's entry: the attribute arrays, then indexing, instancing, skin, tints and
  // placements per vertex.
  const geometryKey: (ArrayBufferView | undefined)[] = []
  const bindGeometry = (
    program: WebGLProgram,
    source: StandardMaterialProgram,
    primitive: MaterialDraw['primitive'],
    instances: Float32Array | undefined,
    state: SequenceState,
  ) => {
    const key = geometryKey
    key.length = 0
    key.push(primitive.positions, primitive.normals, primitive.tangents, primitive.colors)
    for (let set = 0; set < source.defines.uvSetCount; set++)
      key.push(uvCoordinatesOf(primitive, set))
    const attributeCount = key.length
    const skin = materialSkinOf(primitive)
    const tints = primitiveVertexTints(primitive)
    // Model matrices per instance (the vertex array's own buffer), or per vertex
    // (primitiveVertexPlacements, retained like the other attributes): read alike.
    const vertexPlacements = instances === undefined ? primitiveVertexPlacements(primitive) : undefined
    key.push(
      primitive.indices === undefined ? undefined : INDEXED,
      instances === undefined ? undefined : INSTANCED,
      skin?.joints,
      skin?.weights,
      tints,
      vertexPlacements,
    )
    const geometries = vertexArrays.get(program)
    const variants = geometries?.get(primitive.positions)
    let entry: VertexArrayEntry | undefined
    if (variants !== undefined)
      for (const candidate of variants)
        if (sameEntries(candidate.data, key)) {
          entry = candidate
          break
        }
    if (entry === undefined) {
      const data = key.slice()
      const attributes = data.slice(0, attributeCount)
      const vao = gl.createVertexArray()
      if (vao === null) throw new TypeError('could not allocate material vertex array')
      vertexArraysCreated += 1
      const created: VertexArrayEntry = {
        vao,
        data,
        buffers: [],
        constants: [],
        placement: [],
        used: true,
      }
      entry = created
      gl.bindVertexArray(vao)
      try {
        const attribute = (name: string, index: number, size: number, fallback: number[]) => {
          const location = attributeLocation(program, name)
          if (location < 0) return
          const values = attributes[index]
          if (values === undefined) {
            gl.disableVertexAttribArray(location)
            created.constants.push({ location, value: Float32Array.from(fallback) })
          } else {
            created.buffers.push(retainedBuffer(gl.ARRAY_BUFFER, values))
            gl.enableVertexAttribArray(location)
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
          }
        }
        attribute('a_position', 0, 3, [0, 0, 0, 1])
        attribute('a_normal', 1, 3, [0, 0, 1, 1])
        attribute('a_tangent', 2, 4, [1, 0, 0, 1])
        attribute('a_color', 3, 4, [1, 1, 1, 1])
        for (let set = 0; set < source.defines.uvSetCount; set++)
          attribute(`a_uv${set}`, 4 + set, 2, [0, 0, 0, 1])
        if (skin !== undefined)
          for (const [name, values, type] of [
            [
              'a_skinJoints',
              skin.joints,
              skin.joints instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT,
            ],
            ['a_skinWeights', skin.weights, gl.FLOAT],
          ] as const) {
            const location = attributeLocation(program, name)
            if (location < 0) continue
            created.buffers.push(retainedBuffer(gl.ARRAY_BUFFER, values))
            gl.enableVertexAttribArray(location)
            gl.vertexAttribPointer(location, 4, type, false, 0, 0)
          }
        const skinBaseLocation =
          skin === undefined || instances === undefined
            ? -1
            : attributeLocation(program, 'a_instanceSkinBase')
        if (skinBaseLocation >= 0) {
          const buffer = gl.createBuffer()
          if (buffer === null) throw new TypeError('could not allocate material skin bases')
          buffersCreated += 1
          created.skinBases = { buffer, data: new Float32Array(0) }
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
          gl.enableVertexAttribArray(skinBaseLocation)
          gl.vertexAttribPointer(skinBaseLocation, 1, gl.FLOAT, false, 4, 0)
          gl.vertexAttribDivisor(skinBaseLocation, 1)
        }
        const tintLocation = tints === undefined ? -1 : attributeLocation(program, 'a_vertexTint')
        if (tints !== undefined && tintLocation >= 0) {
          created.buffers.push(retainedBuffer(gl.ARRAY_BUFFER, tints))
          gl.enableVertexAttribArray(tintLocation)
          gl.vertexAttribPointer(tintLocation, 4, gl.FLOAT, false, 0, 0)
        }
        if (primitive.indices !== undefined)
          created.elements = {
            data: primitive.indices,
            buffer: retainedBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.indices),
          }
        created.placement = [0, 1, 2, 3].map(column =>
          attributeLocation(program, `a_instanceMatrix${column}`),
        )
        if (instances !== undefined) {
          const buffer = gl.createBuffer()
          if (buffer === null) throw new TypeError('could not allocate material instances')
          buffersCreated += 1
          created.instances = { buffer, data: instances, byteLength: instances.byteLength }
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
          gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW)
        } else if (vertexPlacements !== undefined)
          entry.buffers.push(retainedBuffer(gl.ARRAY_BUFFER, vertexPlacements))
        if (instances !== undefined || vertexPlacements !== undefined)
          created.placement.forEach((location, column) => {
            if (location < 0) return
            gl.enableVertexAttribArray(location)
            gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 64, column * 16)
            gl.vertexAttribDivisor(location, instances === undefined ? 0 : 1)
          })
      } catch (error) {
        gl.bindVertexArray(null)
        if (created.instances !== undefined) gl.deleteBuffer(created.instances.buffer)
        if (created.skinBases !== undefined) gl.deleteBuffer(created.skinBases.buffer)
        gl.deleteVertexArray(vao)
        throw error
      }
      const retainedGeometries = geometries ?? new Map<Float32Array, VertexArrayEntry[]>()
      retainedGeometries.set(primitive.positions, [...(variants ?? []), entry])
      vertexArrays.set(program, retainedGeometries)
    } else {
      if (state.vertexArray !== entry.vao) gl.bindVertexArray(entry.vao)
      for (const buffer of entry.buffers) buffer.used = true
      // Other indices for the same vertex array (another order, another primitive over the same
      // vertices): bound into it, retained as any array. A buffer this vertex array binds was used
      // in each frame since it was bound, so the sweep has not reused it.
      if (primitive.indices !== undefined && entry.elements !== undefined) {
        if (entry.elements.data !== primitive.indices)
          entry.elements = {
            data: primitive.indices,
            buffer: retainedBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.indices),
          }
        else entry.elements.buffer.used = true
      }
      // New placements for the same vertex array: respecified in its buffer (a frame still in
      // flight keeps the storage it read).
      if (instances !== undefined && entry.instances !== undefined && entry.instances.data !== instances) {
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.instances.buffer)
        gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW)
        entry.instances.data = instances
        entry.instances.byteLength = instances.byteLength
      }
    }
    state.vertexArray = entry.vao
    entry.used = true
    // Generic attribute values are context state, not VAO state: other draws and passes change
    // them, so set missing normal/tangent/color/UV defaults unless this sequence already did.
    for (const { location, value } of entry.constants)
      if (!holdsAttribute(state.constants.get(location), value, 0)) {
        gl.vertexAttrib4fv(location, value)
        state.constants.set(location, value)
      }
    return entry
  }
  const leaseFor = (
    source: StandardMaterialProgram,
    material: NonNullable<MaterialDraw['material']>,
    stages: MaterialStages,
  ): WebGlMaterialProgram => {
    const key = stagesKey(stages)
    let leases = programs.get(key)
    if (leases === undefined) programs.set(key, (leases = new Map()))
    let used = usedPrograms.get(key)
    if (used === undefined) usedPrograms.set(key, (used = new Set()))
    used.add(source)
    let lease = leases.get(source)
    if (lease === undefined) {
      const bound = new Map<string, WebGLTexture>()
      for (const [resource, texture] of material.textures) {
        const handle = typeof textures === 'function' ? textures(texture) : textures.get(texture.id)
        if (handle === undefined) throw new TypeError(`GPU material texture missing: ${resource}`)
        bound.set(resource, handle)
      }
      const shaders = leaseShaderSources(source, material, stages)
      const { vertexSource, fragmentSource, filters } = shaders
      lease = createWebGlMaterialProgram(gl, { ...source, vertexSource, fragmentSource }, bound, {
        filters,
        programCache: linked,
        programCacheKey: shaderPairCacheKey(shaders),
        pendingPrograms,
        samplerCache: samplers,
        ...(options.mipmaps === true ? { mipmaps: true } : {}),
      })
      programCompilations += 1
      leases.set(source, lease)
    }
    return lease
  }
  const topologyMode = (primitive: MaterialDraw['primitive']) =>
    primitive.topology === 'triangles'
      ? gl.TRIANGLES
      : primitive.topology === 'triangle-strip'
        ? gl.TRIANGLE_STRIP
        : primitive.topology === 'triangle-fan'
          ? gl.TRIANGLE_FAN
          : undefined
  /**
   * Camera, light and world-shading uniforms: they depend on the frame and on the linked program's
   * shader alone (its sources fix the lighting, environment and world-shading defines), so each
   * program receives them once per frame.
   */
  const bindFrameUniforms = (
    program: WebGLProgram,
    source: StandardMaterialProgram,
    frame: MaterialFrame,
  ) => {
    if (programFrames.get(program) === frame.serial) return
    const uniform = (name: string) => uniformLocation(gl, program, name)
    gl.uniformMatrix4fv(uniform('u_view'), false, frame.geometry.view)
    gl.uniformMatrix4fv(uniform('u_viewProjection'), false, frame.camera.viewProjection)
    gl.uniform3fv(uniform('u_lightDirection'), frame.geometry.lightDirection)
    gl.uniform1f(uniform('u_orthographic'), frame.geometry.orthographic ? 1 : 0)
    // Decided by the uniforms the program declares, not by whichever material draws it first.
    if (source.defines.sceneLighting === true || uniform('u_sceneLightColor') !== null)
      bindSceneLight(program, frame.camera, frame.light)
    if (source.defines.sceneLighting === true) bindSceneShadow(program, source, frame.light?.shadow)
    bindSceneFrame(
      program,
      frame.eyePosition,
      materialWorldShading(source) || uniform('u_sceneLightDirection') !== null
        ? frame.worldLighting()
        : undefined,
    )
    if (frame.spatialLighting !== undefined) {
      bindPreviewLighting(gl,program,frame.spatialLighting)
      gl.uniform1i(uniform('u_sceneDirectLightCount'),3+frame.spatialLighting.lights.length)
    }
    programFrames.set(program, frame.serial)
  }
  const bindSceneLight = (
    program: WebGLProgram,
    camera: SceneRendererCamera,
    light: MaterialSceneLight | undefined,
  ) => {
    const uniform = (name: string) => uniformLocation(gl, program, name)
    const color = light?.color ?? [1, 1, 1, 1]
    const ambient = light?.ambient ?? 0.25
    gl.uniform3f(uniform('u_sceneLightColor'), color[0], color[1], color[2])
    gl.uniform3fv(uniform('u_sceneSpecularColor'), light?.specularColor ?? color.slice(0, 3))
    gl.uniform3fv(
      uniform('u_sceneAmbientColor'),
      light?.ambientColor ?? [ambient, ambient, ambient],
    )
    for (let index = 0; index < 2; index++) {
      const fill = light?.fills?.[index]
      const direction = fill?.direction ?? [0, 0, 0]
      const length = Math.hypot(...direction) || 1
      const d = direction.map(value => value / length)
      const view = camera.viewMatrix
      const inView = view === undefined ? d : [
        view[0]! * d[0]! + view[4]! * d[1]! + view[8]! * d[2]!,
        view[1]! * d[0]! + view[5]! * d[1]! + view[9]! * d[2]!,
        view[2]! * d[0]! + view[6]! * d[1]! + view[10]! * d[2]!,
      ]
      gl.uniform3fv(uniform(`u_sceneFillViewDirection${index}`), inView)
      gl.uniform3fv(uniform(`u_sceneFillWorldDirection${index}`), d)
      gl.uniform3fv(uniform(`u_sceneFillColor${index}`), fill?.color ?? [0, 0, 0])
    }
  }
  /**
   * The key light's shadow as the program's lighting reads it. The sampler names a unit no sampler
   * of another type in the program uses, with or without a shadow (WebGL refuses the draw otherwise).
   */
  const bindSceneShadow = (
    program: WebGLProgram,
    source: StandardMaterialProgram,
    shadow: WorldShadowReceiver | undefined,
  ) => {
    const uniform = (name: string) => uniformLocation(gl, program, name)
    const sampler = uniform('u_sceneShadowMap')
    if (sampler === null) return
    const free = source.textures.length <= SHADOW_MAP_UNIT
    gl.uniform1i(
      sampler,
      free
        ? SHADOW_MAP_UNIT
        : Math.max(
            0,
            source.textures.findIndex(binding => binding.dimension !== 'cube'),
          ),
    )
    gl.uniform1f(uniform('u_sceneShadowEnabled'), shadow !== undefined && free ? 1 : 0)
    if (shadow === undefined || !free) return
    gl.uniformMatrix4fv(uniform('u_sceneShadowViewProjection'), false, shadow.viewProjection)
    gl.uniform2f(uniform('u_sceneShadowTexelSize'), shadow.texelSize[0], shadow.texelSize[1])
    gl.uniform3fv(uniform('u_sceneShadowRangeEye'), shadow.rangeEye)
    gl.uniform1f(uniform('u_sceneShadowRangeDistance'), shadow.rangeDistance)
  }
  /** Puts `texture` (the shadow map, or none) on SHADOW_MAP_UNIT unless it is there already. */
  const bindShadowMap = (texture: WebGLTexture | null, state: SequenceState) => {
    if (shadowUnitTexture === texture) return
    if (state.activeUnit !== SHADOW_MAP_UNIT) {
      gl.activeTexture(gl.TEXTURE0 + SHADOW_MAP_UNIT)
      state.activeUnit = SHADOW_MAP_UNIT
    }
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.bindSampler(SHADOW_MAP_UNIT, null)
    state.lastUnit = SHADOW_MAP_UNIT
    state.units[SHADOW_MAP_UNIT] = undefined
    shadowUnitTexture = texture
  }
  /** Environment eye and world-shading frame: per frame, not per placement. */
  const bindSceneFrame = (
    program: WebGLProgram,
    eyePosition: ReturnType<typeof snapshotEyePosition>,
    lighting: ReturnType<typeof materialFrameGeometry>['worldLighting'],
  ) => {
    const uniform = (name: string) => uniformLocation(gl, program, name)
    const eye = uniform('u_sceneEyePosition')
    if (eye !== null) gl.uniform3fv(eye, eyePosition ?? [0, 0, 0])
    if (lighting === undefined) return
    gl.uniform3fv(uniform('u_sceneLightDirection'), lighting.lightDirection)
    gl.uniform3fv(uniform('u_sceneLightingEye'), lighting.eyePosition)
    gl.uniform3fv(uniform('u_sceneLightingViewDirection'), lighting.viewDirection)
    gl.uniform1f(uniform('u_sceneLightingOrthographic'), lighting.orthographic ? 1 : 0)
  }
  /** Pipeline state of one draw; calls only for what differs from the sequence's current state. */
  const applyDrawState = (
    source: StandardMaterialProgram,
    primitive: MaterialDraw['primitive'],
    depthOnly: boolean,
    state: SequenceState,
    mirrored: boolean,
    depthCompare?: 'always',
  ) => {
    const color = !depthOnly
    if (state.colorMask !== color) {
      gl.colorMask(color, color, color, color)
      state.colorMask = color
    }
    const depthWrite = depthOnly || materialIsSolid(source)
    if (state.depthMask !== depthWrite) {
      gl.depthMask(depthWrite)
      state.depthMask = depthWrite
    }
    if (state.depthTest !== true) {
      gl.enable(gl.DEPTH_TEST)
      state.depthTest = true
    }
    const depthFunction = depthCompare === 'always' ? gl.ALWAYS : gl.LEQUAL
    if (state.depthFunction !== depthFunction) {
      gl.depthFunc(depthFunction)
      state.depthFunction = depthFunction
    }
    const bias = primitive.depthBias
    const biasKey = bias === undefined ? '' : `${bias.slopeScale}:${bias.units}`
    if (state.depthBias !== biasKey) {
      applyWebGlDepthBias(gl, bias)
      state.depthBias = biasKey
    }
    const cull = !source.twoSided
    // glTF: a node whose world matrix mirrors (negative determinant) has clockwise front faces
    const front = cull && mirrored ? gl.CW : gl.CCW
    if (state.frontFace !== front) {
      gl.frontFace(front)
      state.frontFace = front
    }
    if (state.cull !== cull) {
      if (cull) {
        gl.enable(gl.CULL_FACE)
        gl.cullFace(gl.BACK)
      } else gl.disable(gl.CULL_FACE)
      state.cull = cull
    }
    // a fading solid pass (tint alpha below 1) blends by its fade
    const fading = materialIsSolid(source) && primitiveFade(primitive) < 1
    const blend =
      depthOnly || (materialIsSolid(source) && !fading)
        ? 'none'
        : fading
          ? 'blend'
          : source.blend
    if (state.blend === blend) return
    state.blend = blend
    if (blend === 'none') gl.disable(gl.BLEND)
    else {
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      switch (blend) {
        case 'blend':
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
          break
        case 'premultiplied':
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
          break
        case 'additive':
          gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE)
          break
        case 'add-alpha':
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE)
          break
        case 'modulate':
          gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE)
          break
        case 'modulate2x':
          gl.blendFuncSeparate(gl.DST_COLOR, gl.SRC_COLOR, gl.ZERO, gl.ONE)
          break
      }
    }
  }
  const submit = (mode: number, primitive: MaterialDraw['primitive'], instances?: number) => {
    const count = primitive.indices?.length ?? primitive.positions.length / 3
    if (instances === undefined) {
      if (primitive.indices === undefined) gl.drawArrays(mode, 0, count)
      else gl.drawElements(mode, count, gl.UNSIGNED_INT, 0)
    } else if (primitive.indices === undefined) gl.drawArraysInstanced(mode, 0, count, instances)
    else gl.drawElementsInstanced(mode, count, gl.UNSIGNED_INT, 0, instances)
    drawCalls += 1
    placementsDrawn += instances ?? 1
    if (options.checkEachDraw !== false) {
      const error = gl.getError()
      if (error !== gl.NO_ERROR) throw new TypeError(`material WebGL draw failed (${error})`)
    }
    const triangles =
      primitive.topology === 'triangles' ? Math.floor(count / 3) : Math.max(0, count - 2)
    return triangles * (instances ?? 1)
  }
  /** Leave the shared context as a single draw always has: no samplers, no VAO, colour, no culling. */
  const restore = (state: SequenceState) => {
    state.units.forEach((binding, unit) => {
      if (binding !== undefined) gl.bindSampler(unit, null)
    })
    // A sequence has always left the unit of its last binding change active.
    if (state.lastUnit !== undefined && state.activeUnit !== state.lastUnit)
      gl.activeTexture(gl.TEXTURE0 + state.lastUnit)
    gl.bindVertexArray(null)
    gl.colorMask(true, true, true, true)
    if (state.depthFunction === gl.ALWAYS) gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.CULL_FACE)
    if (state.frontFace !== gl.CCW) gl.frontFace(gl.CCW)
  }
  const bindTextureUnits = (lease: WebGlMaterialProgram, state: SequenceState) => {
    // Only what changes is set: a unit keeps its texture and its sampler apart (materials mostly
    // share samplers), and the active unit changes only for a texture of another unit.
    lease.textureUnits.forEach((binding, unit) => {
      const bound = state.units[unit]
      const texture =
        bound === undefined || bound.texture !== binding.texture || bound.target !== binding.target
      const sampler = bound === undefined || bound.sampler !== binding.sampler
      if (!texture && !sampler) return
      state.lastUnit = unit
      if (texture) {
        if (state.activeUnit !== unit) {
          gl.activeTexture(gl.TEXTURE0 + unit)
          state.activeUnit = unit
        }
        gl.bindTexture(binding.target, binding.texture)
      }
      if (sampler) gl.bindSampler(unit, binding.sampler)
      state.units[unit] = binding
      if (unit === SHADOW_MAP_UNIT) shadowUnitTexture = undefined
    })
  }
  const drawInSequence = (
    { draw, instances }: MaterialSequenceDraw,
    frame: MaterialFrame,
    state: SequenceState,
    programs: MaterialSequencePrograms | undefined,
    visibilityBounds?: WorldVisibilityBounds,
  ): number => {
    const { program: leased, material, primitive } = draw
    if (leased === undefined || material === undefined) throw new TypeError('missing GPU material')
    // A draw kept from an earlier frame leases its program's layout; this frame's values and state
    // are those of the program it stands for now.
    const source = programs?.get(leased) ?? leased
    const placed = primitiveVertexPlacements(primitive) !== undefined
    if (placed && (instances !== undefined || !materialCanInstance(source)))
      throw new TypeError('placed vertices draw once, without object-space normals')
    if (instances !== undefined) {
      if (!materialCanInstance(source))
        throw new TypeError('object-space normal materials cannot be instanced')
      if (frame.camera.viewMatrix === undefined)
        throw new TypeError('instanced material draws require a view matrix')
      if (
        !Number.isSafeInteger(instances.count) ||
        instances.count < 0 ||
        instances.matrices.length < instances.count * 16 ||
        (instances.palettes !== undefined && instances.palettes.length !== instances.count)
      )
        throw new TypeError('invalid material instances')
    }
    if (requiresEnvironmentEye(source) && frame.eyePosition === undefined)
      throw new TypeError('explicit reflection environment requires eyePosition')
    const mode = topologyMode(primitive)
    if (mode === undefined || instances?.count === 0) return 0
    const model = instances === undefined && !placed ? materialModelMatrix(primitive) : undefined
    const skin = materialSkinOf(primitive)
    const spatial = frame.spatialLighting !== undefined && source.defines.sceneLighting === true &&
      source.defines.pbr !== true && !source.defines.unshaded
    const lease = leaseFor(leased, material, materialStagesOf(primitive,spatial))
    const program = lease.program
    const geometry = bindGeometry(program, leased, primitive, instances?.matrices, state)
    if (state.program !== program) {
      gl.useProgram(program)
      state.program = program
    }
    if (skin !== undefined) {
      // The first texel of a palette, appended this frame when new. An upload leaves the palette
      // unit active with the palettes bound.
      const baseOf = (palette: Float32Array): number => {
        const base = skinBase(palette)
        if (base !== undefined) return base
        state.activeUnit = SKIN_PALETTE_UNIT
        state.lastUnit = SKIN_PALETTE_UNIT
        state.skinPalettes = true
        return skinBases.get(palette)!
      }
      const location = attributeLocation(program, 'a_instanceSkinBase')
      if (instances === undefined) {
        // A single draw's first texel as a constant value, as its model matrix.
        const value = Float32Array.of(baseOf(skin.palette), 0, 0, 1)
        if (location >= 0 && !holdsAttribute(state.constants.get(location), value, 0)) {
          gl.vertexAttrib4fv(location, value)
          state.constants.set(location, value)
        }
      } else if (geometry.skinBases !== undefined) {
        // Each instance's first texel, into the vertex array's buffer when they changed.
        const bases = new Float32Array(instances.count)
        for (let index = 0; index < instances.count; index++)
          bases[index] = baseOf(instances.palettes?.[index] ?? skin.palette)
        const held = geometry.skinBases.data
        if (held.length !== bases.length || held.some((value, index) => value !== bases[index])) {
          gl.bindBuffer(gl.ARRAY_BUFFER, geometry.skinBases.buffer)
          gl.bufferData(gl.ARRAY_BUFFER, bases, gl.DYNAMIC_DRAW)
          geometry.skinBases.data = bases
        }
      }
      if (state.skinPalettes !== true) {
        if (state.activeUnit !== SKIN_PALETTE_UNIT) {
          gl.activeTexture(gl.TEXTURE0 + SKIN_PALETTE_UNIT)
          state.activeUnit = SKIN_PALETTE_UNIT
        }
        gl.bindTexture(gl.TEXTURE_2D, skinTexture)
        state.lastUnit = SKIN_PALETTE_UNIT
        state.skinPalettes = true
      }
      if (!skinUnits.has(program)) {
        gl.uniform1i(uniformLocation(gl, program, 'u_skinPalette'), SKIN_PALETTE_UNIT)
        skinUnits.add(program)
      }
    }
    if (programLeases.get(program) !== lease || programUniforms.get(program) !== source.uniforms) {
      lease.uploadUniforms(source === leased ? undefined : source.uniforms)
      programLeases.set(program, lease)
      programUniforms.set(program, source.uniforms)
    }
    bindTextureUnits(lease, state)
    // The placement vertex stage reads the model matrix from attributes: constants for one draw.
    // Consecutive draws of one placement find its columns already set.
    if (model !== undefined)
      geometry.placement.forEach((location, column) => {
        if (location < 0) return
        const from = column * 4
        if (holdsAttribute(state.constants.get(location), model, from)) return
        // A copy: what the attribute holds must not follow a later change of the matrix.
        const value = Float32Array.of(
          model[from]!,
          model[from + 1]!,
          model[from + 2]!,
          model[from + 3]!,
        )
        gl.vertexAttrib4fv(location, value)
        state.constants.set(location, value)
      })
    const tint = primitiveTint(primitive)
    const lastTint = programTints.get(program)
    if (lastTint === undefined || !sameNumbers(lastTint, tint)) {
      gl.uniform4fv(uniformLocation(gl, program, 'u_instanceTint'), tint)
      programTints.set(program, tint)
    }
    const worldToMaterial = worldToMaterialOf(source)
    if (programWorldToMaterial.get(program) !== worldToMaterial) {
      gl.uniformMatrix4fv(uniformLocation(gl, program, 'u_worldToMaterial'), false, worldToMaterial)
      programWorldToMaterial.set(program, worldToMaterial)
    }
    bindFrameUniforms(program, source, frame)
    bindWorldVisibility(gl, program, visibilityBounds)
    if (source.defines.sceneLighting === true) {
      const shadow = frame.light?.shadow
      if (shadow !== undefined && source.textures.length <= SHADOW_MAP_UNIT)
        bindShadowMap(shadow.texture, state)
      const receiver = draw.receiveShadows === false ? 0 : 1
      if (programShadowReceivers.get(program) !== receiver) {
        gl.uniform1f(uniformLocation(gl, program, 'u_sceneShadowReceiver'), receiver)
        programShadowReceivers.set(program, receiver)
      }
    }
    // Object-space normal maps turn the decoded normal by the model's normal matrix per fragment.
    if (model !== undefined && source.normalMapSpace === 'object')
      gl.uniformMatrix3fv(
        uniformLocation(gl, program, 'u_sceneWorldNormalMatrix'),
        false,
        materialNormalMatrix(model).matrix,
      )
    applyDrawState(
      source,
      primitive,
      draw.depthOnly === true,
      state,
      model !== undefined && materialMirrors(model),
      draw.depthCompare,
    )
    return submit(mode, primitive, instances?.count)
  }
  /**
   * Draw in order with one camera and light. Within the sequence nothing else touches the context,
   * so each draw only changes what differs from the previous one (program, material uniforms,
   * textures, vertex array, pipeline state); linked programs keep their frame uniforms across
   * sequences of the same frame. The shared context state is restored once, at the end.
   */
  const drawSequence = (
    draws: Iterable<MaterialSequenceDraw>,
    camera: SceneRendererCamera,
    light?: MaterialSceneLight,
    programs?: MaterialSequencePrograms,
    options?: Readonly<{ visibilityBounds?: WorldVisibilityBounds | undefined }>,
  ): number => {
    const frame = frameOf(camera, light)
    const visibilityBounds = checkedWorldVisibilityBounds(options?.visibilityBounds)
    const state: SequenceState = { units: [], constants: new Map() }
    let triangles = 0
    try {
      // A pass without the world's shadow (the shadow pass draws into that map) leaves no shadow map
      // on a unit its programs sample.
      if (light?.shadow === undefined && shadowUnitTexture !== null) bindShadowMap(null, state)
      for (const item of draws) triangles += drawInSequence(item, frame, state, programs, visibilityBounds)
    } finally {
      restore(state)
    }
    return triangles
  }
  return {
    programCompilations: () => programCompilations,
    /** Cumulative drawArrays/drawElements submissions, including depth-only material passes.
     * Snapshot before/after a pass or frame for its direct draw count. */
    drawCalls: () => drawCalls,
    /**
     * Cumulative work counters: vertex arrays and buffers made (a frame of known geometry makes
     * none) and placements drawn (an instanced draw counts its instances).
     */
    counters: () => Object.freeze({ vertexArraysCreated, buffersCreated, placementsDrawn }),
    /** Snapshot of this renderer's owned GPU geometry; no GL queries or frame-state changes.
     * Each retained entry owns one distinct buffer, even for views sharing CPU backing storage;
     * spare buffers waiting for the next frame's arrays count as held.
     * Bytes describe uploaded buffer storage, excluding textures and driver VAO/program overhead. */
    stats() {
      let bufferBytesRetained = spareBytes
      for (const entry of retained.values()) bufferBytesRetained += entry.byteLength
      let spares = 0
      for (const buffers of spareBuffers.values()) spares += buffers.length
      let vertexArrayEntries = 0,
        instanceBuffers = 0
      for (const geometries of vertexArrays.values())
        for (const variants of geometries.values()) {
          vertexArrayEntries += variants.length
          for (const entry of variants) {
            if (entry.instances !== undefined) {
              instanceBuffers += 1
              bufferBytesRetained += entry.instances.byteLength
            }
            if (entry.skinBases !== undefined) {
              instanceBuffers += 1
              bufferBytesRetained += entry.skinBases.data.byteLength
            }
          }
        }
      return Object.freeze({
        bufferEntries: retained.size + spares + instanceBuffers,
        bufferBytesRetained,
        vertexArrayEntries,
      })
    },
    /** Link every program these draws still need in one parallel batch, before any of them draws. */
    warm(draws: Iterable<MaterialDraw>, spatialLighting = false): number {
      // Each variant's shader pair is one object (leaseShaderSources keeps it); equal sources of two
      // pairs link once, the second finds the first in the program cache.
      const sources = new Set<Readonly<{ vertexSource: string; fragmentSource: string }>>()
      for (const draw of draws) {
        if (draw.program === undefined || draw.material === undefined) continue
        const stages = materialStagesOf(draw.primitive, spatialLighting &&
          draw.program.defines.sceneLighting === true && draw.program.defines.pbr !== true &&
          !draw.program.defines.unshaded)
        if (programs.get(stagesKey(stages))?.has(draw.program) === true) continue
        sources.add(leaseShaderSources(draw.program, draw.material, stages))
      }
      return linkWebGlMaterialProgramsInParallel(gl, sources, linked, pendingPrograms)
    },
    /**
     * The skin palettes a frame's skinned draws use (see ModelSceneSkin), packed into the palette
     * texture with one upload; a palette a draw brings later is appended with its own. Leaves the
     * palette unit active.
     */
    prepareSkins(palettes: Iterable<Float32Array>): void {
      skinBases = new Map()
      skinTexels = 0
      for (const palette of palettes) {
        if (skinBases.has(palette)) continue
        checkPalette(palette)
        reserveSkinTexels(skinTexels + palette.length / 4)
        skinData.set(palette, skinTexels * 4)
        skinBases.set(palette, skinTexels)
        skinTexels += palette.length / 4
      }
      if (skinTexels > 0) uploadSkinRows(0)
    },
    release() {
      for (const geometries of vertexArrays.values())
        for (const variants of geometries.values())
          for (const entry of variants) {
            gl.deleteVertexArray(entry.vao)
            if (entry.instances !== undefined) gl.deleteBuffer(entry.instances.buffer)
            if (entry.skinBases !== undefined) gl.deleteBuffer(entry.skinBases.buffer)
          }
      vertexArrays.clear()
      for (const leases of programs.values()) for (const lease of leases.values()) lease.release()
      programs.clear()
      usedPrograms.clear()
      if (skinTexture !== null) gl.deleteTexture(skinTexture)
      skinTexture = null
      skinRows = 0
      skinData = new Float32Array(0)
      skinTexels = 0
      skinBases = new Map()
      for (const program of linked.values()) gl.deleteProgram(program)
      linked.clear()
      pendingPrograms.clear()
      for (const sampler of samplers.values()) gl.deleteSampler(sampler)
      samplers.clear()
      for (const entry of retained.values()) gl.deleteBuffer(entry.buffer)
      retained.clear()
      for (const buffers of spareBuffers.values())
        for (const buffer of buffers) gl.deleteBuffer(buffer)
      spareBuffers.clear()
      spareBytes = 0
    },
    sweep() {
      // Per-frame materials (effects, playback-time uniforms) must not accumulate leases.
      for (const [key, leases] of programs) {
        const used = usedPrograms.get(key)
        for (const [source, lease] of leases)
          if (used?.has(source) !== true) {
            lease.release()
            leases.delete(source)
          }
        used?.clear()
      }
      // The next frame packs its own palettes.
      skinBases = new Map()
      skinTexels = 0
      // A linked program no lease uses any more (its models left the scene) is deleted too, so a
      // renderer that outlives many scenes does not keep every shader it ever linked.
      const leased = new Set<WebGLProgram>()
      for (const leases of programs.values())
        for (const lease of leases.values()) leased.add(lease.program)
      for (const [key, program] of linked)
        if (!leased.has(program) && !pendingPrograms.has(program)) {
          gl.deleteProgram(program)
          linked.delete(key)
        }
      // Delete unused VAOs before their buffers, including replaced animated attribute arrays.
      for (const [program, geometries] of vertexArrays) {
        for (const [positions, variants] of geometries) {
          const live = variants.filter(entry => {
            if (!entry.used) {
              gl.deleteVertexArray(entry.vao)
              if (entry.instances !== undefined) gl.deleteBuffer(entry.instances.buffer)
              if (entry.skinBases !== undefined) gl.deleteBuffer(entry.skinBases.buffer)
              return false
            }
            entry.used = false
            return true
          })
          if (live.length === 0) geometries.delete(positions)
          else geometries.set(positions, live)
        }
        if (geometries.size === 0) vertexArrays.delete(program)
      }
      // Spares nothing took since the last sweep are deleted; this frame's released buffers wait
      // for the next one.
      for (const buffers of spareBuffers.values())
        for (const buffer of buffers) gl.deleteBuffer(buffer)
      spareBuffers.clear()
      spareBytes = 0
      for (const [data, entry] of retained) {
        if (entry.used) entry.used = false
        else {
          retained.delete(data)
          if (spareBytes + entry.byteLength > MAX_SPARE_BYTES) {
            gl.deleteBuffer(entry.buffer)
            continue
          }
          const key = `${entry.target}:${entry.byteLength}`
          const buffers = spareBuffers.get(key)
          if (buffers === undefined) spareBuffers.set(key, [entry.buffer])
          else buffers.push(entry.buffer)
          spareBytes += entry.byteLength
        }
      }
    },
    /** One draw, restoring the shared context state afterwards (see `drawSequence`). */
    draw(draw: MaterialDraw, camera: SceneRendererCamera, light?: MaterialSceneLight): number {
      return drawSequence([{ draw }], camera, light)
    },
    /**
     * One draw for every placement in `instances`: the model matrix comes from per-instance
     * attributes and the vertex stage derives the normal matrices and signs from it. Everything else
     * — material, tint, depth bias, pipeline state — is the draw's, shared by all placements.
     */
    drawInstanced(
      draw: MaterialDraw,
      instances: MaterialInstances,
      camera: SceneRendererCamera,
      light?: MaterialSceneLight,
    ): number {
      return drawSequence([{ draw, instances }], camera, light)
    },
    drawSequence,
  }
}

/** Scene lighting for material draws; `ambientColor` defaults to the scalar `ambient` as gray. */
export type MaterialSceneLight = SceneRendererDirectionalLight & {
  readonly ambientColor?: readonly [number, number, number]
  readonly specularColor?: readonly [number, number, number]
  /** Additional admitted direct lights; the key/fills and their shadow remain distinct. */
  readonly spatialLighting?: PreviewLighting
  /** The world's shadow of the key light (render/world-shadow.ts); none where it is absent. */
  readonly shadow?: WorldShadowReceiver
  readonly fills?: readonly {
    readonly direction: readonly [number, number, number]
    readonly color: readonly [number, number, number]
  }[]
}
import { primitiveTint } from './tint.js'

/**
 * The key light's shadow in a scene-lit program: the world's formula (WORLD_SHADOW_GLSL) at the
 * fragment's world position (the vertex stage's v_sceneShadowWorld), times one where the draw takes
 * none (MaterialDraw.receiveShadows) or the frame has none.
 */
const SCENE_SHADOW_FRAGMENT = `uniform sampler2D u_sceneShadowMap;
      uniform mat4 u_sceneShadowViewProjection;
      uniform float u_sceneShadowEnabled, u_sceneShadowReceiver, u_sceneShadowRangeDistance;
      uniform vec2 u_sceneShadowTexelSize;
      uniform vec3 u_sceneShadowRangeEye;
      in vec3 v_sceneShadowWorld;
      ${WORLD_SHADOW_GLSL}
      float sceneKeyShadow(float lightCosine) {
        if (u_sceneShadowEnabled < 0.5 || u_sceneShadowReceiver < 0.5) return 1.0;
        return modkitWorldShadow(u_sceneShadowMap, u_sceneShadowViewProjection * vec4(v_sceneShadowWorld, 1.0),
          v_sceneShadowWorld, lightCosine, u_sceneShadowTexelSize, u_sceneShadowRangeEye, u_sceneShadowRangeDistance);
      }`

/**
 * Final shader sources by compiled variant: every sample of one material template shares its
 * `defines` (and fragment source), and the string key holds the rest these sources read. Materials
 * that follow the clock bring new program objects every frame, and building the sources ran several
 * regular expressions over each shader for every lease.
 */
const leasedShaderSources = new WeakMap<
  object,
  Map<string, Readonly<{ fragment: string; sources: ReturnType<typeof buildLeaseShaderSources> }>>
>()

/** Final GPU shader sources of a material lease: nearest-filtered samplers and the instance tint. */
export function leaseShaderSources(
  source: StandardMaterialProgram,
  material: NonNullable<MaterialDraw['material']>,
  stages: MaterialStages = PLAIN_STAGES,
) {
  let key = `${String(source.twoSided)}|${source.blend}|${String(source.environment !== undefined)}|${String(source.normalBlendPolicy !== undefined)}|${source.normalMapSpace}|${stagesKey(stages)}`
  for (const binding of source.textures)
    key += `|${binding.slot}:${binding.resourceId}:${binding.uniform}:${binding.dimension ?? ''}:${binding.wrapU}:${binding.wrapV}`
  for (const [resource, texture] of material.textures)
    key += `|${resource}=${texture.filter ?? 'linear'}`
  let variants = leasedShaderSources.get(source.defines)
  if (variants === undefined) leasedShaderSources.set(source.defines, (variants = new Map()))
  const fragment = stages.spatial === true
    ? source.fragmentSourceForSceneLights?.() : source.fragmentSource
  if (fragment === undefined) throw new TypeError('material has no spatial lighting variant')
  const cached = variants.get(key)
  if (cached !== undefined && cached.fragment === fragment) return cached.sources
  const sources = buildLeaseShaderSources(source, material, stages)
  variants.set(key, Object.freeze({ fragment, sources }))
  return sources
}

function buildLeaseShaderSources(
  source: StandardMaterialProgram,
  material: NonNullable<MaterialDraw['material']>,
  stages: MaterialStages,
) {
  const filters = new Map<string, 'nearest' | 'linear'>()
  for (const [resource, texture] of material.textures)
    filters.set(resource, texture.filter ?? 'linear')
  // Opaque passes replace the target but the public framebuffer still stores premultiplied RGB.
  let fragment = stages.spatial === true ? source.fragmentSourceForSceneLights?.() : source.fragmentSource
  if (fragment === undefined) throw new TypeError('material has no spatial lighting variant')
  if (source.twoSided) {
    const main = fragment.search(/void main\s*\(\s*\)/u)
    if (main >= 0) {
      const body = fragment
        .slice(main)
        .replace(/vec3 normal\s*=\s*/u, match => `${match}((gl_FrontFacing == (v_sceneModelOrientation > 0.0)) ? 1.0 : -1.0) * `)
      fragment = fragment.slice(0, main) + 'flat in float v_sceneModelOrientation;\n' + body
    }
  }
  const worldShading = source.normalBlendPolicy !== undefined || source.normalMapSpace === 'object'
  if (stages.spatial === true) {
    const frameDeclarations = fragment.includes('uniform vec3 u_sceneLightDirection,') ? '' :
      'uniform vec3 u_sceneLightDirection, u_sceneLightingEye, u_sceneLightingViewDirection;\nuniform float u_sceneLightingOrthographic;'
    fragment = fragment.replace('void main() {',`
      ${frameDeclarations}
      uniform vec3 u_sceneSpecularColor, u_sceneFillColor0, u_sceneFillColor1;
      uniform vec3 u_sceneFillWorldDirection0, u_sceneFillWorldDirection1;
      uniform vec3 previewDirections[4], previewColors[4], previewPositions[4];
      uniform int previewTypes[4];
      uniform vec4 previewFades[4];
      uniform vec2 previewCones[4];
      ${SCENE_SHADOW_FRAGMENT}
      ${LIGHT_GEOMETRY_GLSL}
      vec3 sceneDirectUnit(vec3 value){float size=length(value);return size>1e-8?value/size:vec3(0.0,0.0,1.0);}
      vec3 sceneDirectNormal(vec3 normal){return ${worldShading ? 'normal' : 'sceneDirectUnit(mat3(v_sceneWorldTangent,v_sceneWorldBitangent,v_sceneWorldNormal)*normal)'};}
      void sceneDirectLight(int index, vec3 normal, out vec3 direction, out vec3 halfVector,
          out vec3 diffuseColor, out vec3 specularColor){
        vec3 eye=u_sceneLightingOrthographic>0.5?u_sceneLightingViewDirection:sceneDirectUnit(u_sceneLightingEye-v_sceneWorldPosition);
        if(index==0){
          direction=u_sceneLightDirection;
          float shade=sceneKeyShadow(max(dot(normal,direction),0.0));
          diffuseColor=u_sceneLightColor*shade;specularColor=u_sceneSpecularColor*shade;
        }else if(index<3){
          direction=index==1?u_sceneFillWorldDirection0:u_sceneFillWorldDirection1;
          diffuseColor=index==1?u_sceneFillColor0:u_sceneFillColor1;specularColor=vec3(0.0);
        }else{
          int at=index-3;vec3 v;float d,attenuation;
          sceneLightGeometry(previewTypes[at],previewDirections[at],previewPositions[at],previewFades[at],previewCones[at],v_sceneWorldPosition,v,d,attenuation);
          direction=d>0.0?v/d:vec3(0.0);diffuseColor=previewColors[at]*attenuation;specularColor=diffuseColor;
        }
        halfVector=-sceneDirectUnit(eye+direction);
      }
    \nvoid main() {`)
  } else if (source.defines.sceneLighting) {
    fragment = fragment
      .replace(
        'uniform vec3 u_sceneLightColor;',
        'uniform vec3 u_sceneLightColor;\nuniform vec3 u_sceneSpecularColor;',
      )
      .replace('spec * u_sceneLightColor;', 'spec * u_sceneSpecularColor;')
    const lambert = (direction: string) => source.defines.doubleLambert
      ? `clamp(-1.0 + 2.0 * dot(normal, ${direction}), 0.0, 1.0)`
      : `max(dot(normal, ${direction}), 0.0)`
    fragment = fragment.replace('precision highp float;', `precision highp float;
      uniform vec3 u_sceneFillColor0, u_sceneFillColor1;
      ${worldShading ? 'uniform vec3 u_sceneFillWorldDirection0, u_sceneFillWorldDirection1;' : 'in vec3 v_sceneFillDir0, v_sceneFillDir1;'}
      ${SCENE_SHADOW_FRAGMENT}
    `,
      )
      .replace(
        'vec3 shaded = color * (u_sceneAmbientColor',
        'float sceneKeyShade = sceneKeyShadow(max(dot(normal, v_lightDir), 0.0));\n  vec3 sceneKeyLight = u_sceneLightColor * sceneKeyShade;\n  vec3 shaded = color * (u_sceneAmbientColor',
      )
      .replace('spec * u_sceneSpecularColor;', 'spec * (u_sceneSpecularColor * sceneKeyShade);')
      .replace(
        'pbrLight, u_sceneLightColor, u_sceneAmbientColor);',
        `pbrLight, u_sceneLightColor * sceneKeyShadow(max(dot(pbrNormal, pbrLight), 0.0)), u_sceneAmbientColor);
  shaded += pbrBase * (1.0 - clamp(pbrMetallic, 0.0, 1.0)) * (
    u_sceneFillColor0 * max(dot(pbrNormal, ${worldShading ? 'u_sceneFillWorldDirection0' : 'normalize(v_sceneFillDir0)'}), 0.0) +
    u_sceneFillColor1 * max(dot(pbrNormal, ${worldShading ? 'u_sceneFillWorldDirection1' : 'normalize(v_sceneFillDir1)'}), 0.0));`,
      )
      .replace('u_sceneAmbientColor + u_sceneLightColor * lambert',
      `u_sceneAmbientColor + sceneKeyLight * lambert +
       u_sceneFillColor0 * ${lambert(worldShading ? 'u_sceneFillWorldDirection0' : 'v_sceneFillDir0')} +
       u_sceneFillColor1 * ${lambert(worldShading ? 'u_sceneFillWorldDirection1' : 'v_sceneFillDir1')}`,
      )
  }
  const samplers: string[] = []
  const declarations: string[] = []
  for (const binding of source.textures)
    if (filters.get(binding.resourceId) === 'nearest') {
      const name = `sceneSample_${binding.slot}`
      const cube = binding.dimension === 'cube'
      declarations.push(`vec4 ${name}(${cube ? 'vec3 direction' : 'vec2 uv'});`)
      fragment = fragment.replaceAll(`texture(${binding.uniform},`, `${name}(`)
      if (cube) samplers.push(cubeNearestSamplerSource(name, binding.uniform))
      else
        samplers.push(`vec4 ${name}(vec2 uv){
            ivec2 size=textureSize(${binding.uniform},0);
            vec2 addressed=vec2(${binding.wrapU === 'clamp' ? 'clamp(uv.x,0.0,1.0)' : 'fract(uv.x)'},${binding.wrapV === 'clamp' ? 'clamp(uv.y,0.0,1.0)' : 'fract(uv.y)'});
            ivec2 pixel=clamp(ivec2(floor(addressed*vec2(size))),ivec2(0),size-1);
            return texelFetch(${binding.uniform},pixel,0);
          }`)
    }
  fragment = fragment.replace(/void main\s*\(\s*\)/, `${samplers.join('\n')}\nvoid main()`)
  fragment = fragment.replace(
    'precision highp float;',
    `precision highp float;\n${declarations.join('\n')}`,
  )
  const fragmentSource =
    fragment.replace(/void main\s*\(\s*\)/, 'void materialMain()') +
    (fragment.includes('in vec3 v_sceneWorldPosition') ? '' : '\nin vec3 v_sceneWorldPosition;\n') +
    WORLD_VISIBILITY_GLSL +
    // Per-vertex tints arrive flat: a sprite's four corners hold its one tint, exactly.
    (stages.tinted
      ? '\nuniform vec4 u_instanceTint;\nflat in vec4 v_vertexTint;\nvoid main(){if(!worldPointVisible(v_sceneWorldPosition))discard;materialMain();materialColor*=u_instanceTint*v_vertexTint;'
      : '\nuniform vec4 u_instanceTint;\nvoid main(){if(!worldPointVisible(v_sceneWorldPosition))discard;materialMain();materialColor*=u_instanceTint;') +
    // An additive pass blends ONE, ONE: a tint's alpha (a particle's lifecycle alpha) fades its
    // colour here, as the material's own fade already did (modAlpha).
    (source.defines.modAlpha === true
      ? stages.tinted
        ? 'materialColor.rgb*=u_instanceTint.a*v_vertexTint.a;'
        : 'materialColor.rgb*=u_instanceTint.a;'
      : '') +
    // A solid pass covers its pixel whole: an alpha-tested leaf that survives the test is opaque.
    // Multiplying its colour by the texel alpha drew SC2 foliage (alpha 0.3-0.7) dark with black rims.
    // A fading solid pass (tint alpha below 1) covers by its fade instead.
    (materialIsSolid(source)
      ? (source.defines.sceneLighting ? '' : 'materialColor.rgb=clamp(materialColor.rgb,0.0,1.0);') +
        'materialColor.a=u_instanceTint.a;'
      : '') +
    '}\n'
  // One program serves single and instanced draws: both read the placement from attributes.
  const vertexSource = sceneMaterialVertexSource(
    source.defines,
    source.environment !== undefined,
    worldShading,
    true,
    stages.skinned,
    stages.tinted,
    stages.spatial === true,
  )
  return { vertexSource, fragmentSource, filters }
}
