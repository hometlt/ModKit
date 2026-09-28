import { applyWebGlDepthBias } from './depth-bias.js'
import type {
  SceneRendererCamera,
  SceneRendererDirectionalLight,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import {
  createWebGlMaterialProgram,
  linkWebGlMaterialProgramsInParallel,
  uniformLocation,
  type WebGlMaterialProgram,
} from '../materials/webgl.js'
import type { StandardMaterialProgram } from '../materials/index.js'
import {
  materialFrameGeometry,
  materialModelMatrix,
  materialNormalMatrix,
  sceneMaterialVertexSource,
} from './material-geometry.js'
import { materialIsSolid, type MaterialDraw } from './material-draws.js'
import { requiresEnvironmentEye, snapshotEyePosition } from '../materials/environment.js'
import { cubeNearestSamplerSource } from '../materials/cube-maps.js'

/** Placements of one draw's geometry and material: sixteen column-major floats per instance. */
export interface MaterialInstances {
  readonly matrices: Float32Array
  readonly count: number
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
  | ReadonlyMap<string, WebGLTexture>
  | ((texture: SceneRendererTexture) => WebGLTexture | undefined)

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
  const programs = new Map<StandardMaterialProgram, WebGlMaterialProgram>()
  // Leases hold per-material uniforms and samplers; linked GL programs are shared by shader source.
  const linked = new Map<string, WebGLProgram>()
  const pendingPrograms = new Set<WebGLProgram>()
  const usedPrograms = new Set<StandardMaterialProgram>()
  let programCompilations = 0
  let drawCalls = 0
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
    used: boolean
  }
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
    readonly constants: Map<number, Float32Array>
    colorMask?: boolean
    depthMask?: boolean
    depthTest?: boolean
    depthBias?: string
    cull?: boolean
    blend?: string
  }
  interface MaterialFrame {
    readonly serial: number
    readonly camera: SceneRendererCamera
    readonly light: MaterialSceneLight | undefined
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
    const lightJson =
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
      gl.bindBuffer(target, buffer)
      gl.bufferData(target, data, gl.STATIC_DRAW)
      entry = { buffer, target, byteLength: data.byteLength, used: true }
      retained.set(data, entry)
    } else gl.bindBuffer(target, entry.buffer)
    entry.used = true
    return entry
  }
  const bindGeometry = (
    program: WebGLProgram,
    source: StandardMaterialProgram,
    primitive: MaterialDraw['primitive'],
    instances: Float32Array | undefined,
    state: SequenceState,
  ) => {
    const attributes = [
      primitive.positions,
      primitive.normals,
      primitive.tangents,
      primitive.colors,
    ]
    for (let set = 0; set < source.defines.uvSetCount; set++)
      attributes.push(
        primitive.textureCoordinateSets?.find(uv => uv.set === set)?.coordinates ??
          (set === 0 ? primitive.textureCoordinates : undefined),
      )
    const data = [...attributes, primitive.indices, instances]
    const geometries = vertexArrays.get(program)
    const variants = geometries?.get(primitive.positions)
    let entry = variants?.find(
      candidate =>
        candidate.data.length === data.length &&
        candidate.data.every((value, index) => value === data[index]),
    )
    if (entry === undefined) {
      const vao = gl.createVertexArray()
      if (vao === null) throw new TypeError('could not allocate material vertex array')
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
        if (primitive.indices !== undefined)
          entry.buffers.push(retainedBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.indices))
        created.placement = [0, 1, 2, 3].map(column =>
          attributeLocation(program, `a_instanceMatrix${column}`),
        )
        if (instances !== undefined) {
          entry.buffers.push(retainedBuffer(gl.ARRAY_BUFFER, instances))
          created.placement.forEach((location, column) => {
            if (location < 0) return
            gl.enableVertexAttribArray(location)
            gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 64, column * 16)
            gl.vertexAttribDivisor(location, 1)
          })
        }
      } catch (error) {
        gl.bindVertexArray(null)
        gl.deleteVertexArray(vao)
        throw error
      }
      const retainedGeometries = geometries ?? new Map<Float32Array, VertexArrayEntry[]>()
      retainedGeometries.set(primitive.positions, [...(variants ?? []), entry])
      vertexArrays.set(program, retainedGeometries)
    } else {
      if (state.vertexArray !== entry.vao) gl.bindVertexArray(entry.vao)
      for (const buffer of entry.buffers) buffer.used = true
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
  ): WebGlMaterialProgram => {
    usedPrograms.add(source)
    let lease = programs.get(source)
    if (lease === undefined) {
      const bound = new Map<string, WebGLTexture>()
      for (const [resource, texture] of material.textures) {
        const handle = typeof textures === 'function' ? textures(texture) : textures.get(texture.id)
        if (handle === undefined) throw new TypeError(`GPU material texture missing: ${resource}`)
        bound.set(resource, handle)
      }
      const { vertexSource, fragmentSource, filters } = leaseShaderSources(source, material)
      lease = createWebGlMaterialProgram(gl, { ...source, vertexSource, fragmentSource }, bound, {
        filters,
        programCache: linked,
        pendingPrograms,
        samplerCache: samplers,
        ...(options.mipmaps === true ? { mipmaps: true } : {}),
      })
      programCompilations += 1
      programs.set(source, lease)
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
    bindSceneFrame(
      program,
      frame.eyePosition,
      materialWorldShading(source) || uniform('u_sceneLightDirection') !== null
        ? frame.worldLighting()
        : undefined,
    )
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
    gl.uniform3fv(uniform('u_sceneAmbientColor'), light?.ambientColor ?? [ambient, ambient, ambient])
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
      gl.depthFunc(gl.LEQUAL)
      state.depthTest = true
    }
    const bias = primitive.depthBias
    const biasKey = bias === undefined ? '' : `${bias.slopeScale}:${bias.units}`
    if (state.depthBias !== biasKey) {
      applyWebGlDepthBias(gl, bias)
      state.depthBias = biasKey
    }
    const cull = !source.twoSided
    if (state.cull !== cull) {
      if (cull) {
        gl.enable(gl.CULL_FACE)
        gl.cullFace(gl.BACK)
        gl.frontFace(gl.CCW)
      } else gl.disable(gl.CULL_FACE)
      state.cull = cull
    }
    const blend = materialIsSolid(source) || depthOnly ? 'none' : source.blend
    if (state.blend === blend) return
    state.blend = blend
    if (blend === 'none') gl.disable(gl.BLEND)
    else {
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      switch (source.blend) {
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
    gl.bindVertexArray(null)
    gl.colorMask(true, true, true, true)
    gl.disable(gl.CULL_FACE)
  }
  const bindTextureUnits = (lease: WebGlMaterialProgram, state: SequenceState) => {
    lease.textureUnits.forEach((binding, unit) => {
      const bound = state.units[unit]
      if (
        bound !== undefined &&
        bound.texture === binding.texture &&
        bound.sampler === binding.sampler &&
        bound.target === binding.target
      )
        return
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(binding.target, binding.texture)
      gl.bindSampler(unit, binding.sampler)
      state.units[unit] = binding
    })
  }
  const drawInSequence = (
    { draw, instances }: MaterialSequenceDraw,
    frame: MaterialFrame,
    state: SequenceState,
    programs: MaterialSequencePrograms | undefined,
  ): number => {
    const { program: leased, material, primitive } = draw
    if (leased === undefined || material === undefined) throw new TypeError('missing GPU material')
    // A draw kept from an earlier frame leases its program's layout; this frame's values and state
    // are those of the program it stands for now.
    const source = programs?.get(leased) ?? leased
    if (instances !== undefined) {
      if (!materialCanInstance(source))
        throw new TypeError('object-space normal materials cannot be instanced')
      if (frame.camera.viewMatrix === undefined)
        throw new TypeError('instanced material draws require a view matrix')
      if (
        !Number.isSafeInteger(instances.count) ||
        instances.count < 0 ||
        instances.matrices.length < instances.count * 16
      )
        throw new TypeError('invalid material instances')
    }
    if (requiresEnvironmentEye(source) && frame.eyePosition === undefined)
      throw new TypeError('explicit reflection environment requires eyePosition')
    const mode = topologyMode(primitive)
    if (mode === undefined || instances?.count === 0) return 0
    const model = instances === undefined ? materialModelMatrix(primitive) : undefined
    const lease = leaseFor(leased, material)
    const program = lease.program
    const geometry = bindGeometry(program, leased, primitive, instances?.matrices, state)
    if (state.program !== program) {
      gl.useProgram(program)
      state.program = program
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
    // Object-space normal maps turn the decoded normal by the model's normal matrix per fragment.
    if (model !== undefined && source.normalMapSpace === 'object')
      gl.uniformMatrix3fv(
        uniformLocation(gl, program, 'u_sceneWorldNormalMatrix'),
        false,
        materialNormalMatrix(model).matrix,
      )
    applyDrawState(source, primitive, draw.depthOnly === true, state)
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
  ): number => {
    const frame = frameOf(camera, light)
    const state: SequenceState = { units: [], constants: new Map() }
    let triangles = 0
    try {
      for (const item of draws) triangles += drawInSequence(item, frame, state, programs)
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
    /** Snapshot of this renderer's owned GPU geometry; no GL queries or frame-state changes.
     * Each retained entry owns one distinct buffer, even for views sharing CPU backing storage;
     * spare buffers waiting for the next frame's arrays count as held.
     * Bytes describe uploaded buffer storage, excluding textures and driver VAO/program overhead. */
    stats() {
      let bufferBytesRetained = spareBytes
      for (const entry of retained.values()) bufferBytesRetained += entry.byteLength
      let spares = 0
      for (const buffers of spareBuffers.values()) spares += buffers.length
      let vertexArrayEntries = 0
      for (const geometries of vertexArrays.values())
        for (const variants of geometries.values()) vertexArrayEntries += variants.length
      return Object.freeze({
        bufferEntries: retained.size + spares,
        bufferBytesRetained,
        vertexArrayEntries,
      })
    },
    /** Link every program these draws still need in one parallel batch, before any of them draws. */
    warm(draws: Iterable<MaterialDraw>): number {
      const sources = new Map<string, Readonly<{ vertexSource: string; fragmentSource: string }>>()
      for (const draw of draws) {
        if (draw.program === undefined || draw.material === undefined) continue
        if (programs.has(draw.program)) continue
        const shaders = leaseShaderSources(draw.program, draw.material)
        sources.set(`${shaders.vertexSource}\n//\n${shaders.fragmentSource}`, shaders)
      }
      return linkWebGlMaterialProgramsInParallel(gl, sources.values(), linked, pendingPrograms)
    },
    release() {
      for (const geometries of vertexArrays.values())
        for (const variants of geometries.values())
          for (const entry of variants) gl.deleteVertexArray(entry.vao)
      vertexArrays.clear()
      for (const lease of programs.values()) lease.release()
      programs.clear()
      usedPrograms.clear()
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
      for (const [source, lease] of programs)
        if (!usedPrograms.has(source)) {
          lease.release()
          programs.delete(source)
        }
      usedPrograms.clear()
      // A linked program no lease uses any more (its models left the scene) is deleted too, so a
      // renderer that outlives many scenes does not keep every shader it ever linked.
      const leased = new Set<WebGLProgram>()
      for (const lease of programs.values()) leased.add(lease.program)
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
  readonly fills?: readonly {
    readonly direction: readonly [number, number, number]
    readonly color: readonly [number, number, number]
  }[]
}
import { primitiveTint } from './tint.js'

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
) {
  let key = `${String(source.twoSided)}|${source.blend}|${String(source.environment !== undefined)}|${String(source.normalBlendPolicy !== undefined)}|${source.normalMapSpace}`
  for (const binding of source.textures)
    key += `|${binding.slot}:${binding.resourceId}:${binding.uniform}:${binding.dimension ?? ''}:${binding.wrapU}:${binding.wrapV}`
  for (const [resource, texture] of material.textures)
    key += `|${resource}=${texture.filter ?? 'linear'}`
  let variants = leasedShaderSources.get(source.defines)
  if (variants === undefined) leasedShaderSources.set(source.defines, (variants = new Map()))
  const cached = variants.get(key)
  if (cached !== undefined && cached.fragment === source.fragmentSource) return cached.sources
  const sources = buildLeaseShaderSources(source, material)
  variants.set(key, Object.freeze({ fragment: source.fragmentSource, sources }))
  return sources
}

function buildLeaseShaderSources(
  source: StandardMaterialProgram,
  material: NonNullable<MaterialDraw['material']>,
) {
  const filters = new Map<string, 'nearest' | 'linear'>()
  for (const [resource, texture] of material.textures)
    filters.set(resource, texture.filter ?? 'linear')
  // Opaque passes replace the target but the public framebuffer still stores premultiplied RGB.
  let fragment = source.fragmentSource
  if (source.twoSided) {
    const main = fragment.search(/void main\s*\(\s*\)/u)
    if (main >= 0) {
      const body = fragment.slice(main).replace(
        /vec3 normal\s*=\s*/u,
        match => `${match}(gl_FrontFacing ? 1.0 : -1.0) * `,
      )
      fragment = fragment.slice(0, main) + body
    }
  }
  const worldShading = source.normalBlendPolicy !== undefined || source.normalMapSpace === 'object'
  if (source.defines.sceneLighting) {
    fragment = fragment.replace('uniform vec3 u_sceneLightColor;', 'uniform vec3 u_sceneLightColor;\nuniform vec3 u_sceneSpecularColor;')
      .replace('spec * u_sceneLightColor * lambert', 'spec * u_sceneSpecularColor * lambert')
    const lambert = (direction: string) => source.defines.doubleLambert
      ? `clamp(-1.0 + 2.0 * dot(normal, ${direction}), 0.0, 1.0)`
      : `max(dot(normal, ${direction}), 0.0)`
    fragment = fragment.replace('precision highp float;', `precision highp float;
      uniform vec3 u_sceneFillColor0, u_sceneFillColor1;
      ${worldShading ? 'uniform vec3 u_sceneFillWorldDirection0, u_sceneFillWorldDirection1;' : 'in vec3 v_sceneFillDir0, v_sceneFillDir1;'}
    `).replace('u_sceneAmbientColor + u_sceneLightColor * lambert',
      `u_sceneAmbientColor + u_sceneLightColor * lambert +
       u_sceneFillColor0 * ${lambert(worldShading ? 'u_sceneFillWorldDirection0' : 'v_sceneFillDir0')} +
       u_sceneFillColor1 * ${lambert(worldShading ? 'u_sceneFillWorldDirection1' : 'v_sceneFillDir1')}`)
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
    '\nuniform vec4 u_instanceTint;\nvoid main(){materialMain();materialColor*=u_instanceTint;' +
    // A solid pass covers its pixel whole: an alpha-tested leaf that survives the test is opaque.
    // Multiplying its colour by the texel alpha drew SC2 foliage (alpha 0.3-0.7) dark with black rims.
    (materialIsSolid(source)
      ? (source.defines.sceneLighting ? '' : 'materialColor.rgb=clamp(materialColor.rgb,0.0,1.0);') + 'materialColor.a=1.0;'
      : '') +
    '}\n'
  // One program serves single and instanced draws: both read the placement from attributes.
  const vertexSource = sceneMaterialVertexSource(
    source.defines,
    source.environment !== undefined,
    worldShading,
    true,
  )
  return { vertexSource, fragmentSource, filters }
}
