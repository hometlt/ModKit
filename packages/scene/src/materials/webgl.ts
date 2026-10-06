import type { StandardMaterialProgram } from './standard-program.js'
import { textureAnisotropy } from '../render/texture-filtering.js'

/** A single leased shader program; uploaded texture objects remain owned by the caller. */
export interface WebGlMaterialProgram {
  readonly program: WebGLProgram
  /** Bind material uniforms/textures. The geometry adapter supplies camera and vertex attributes. */
  bind(): void
  /**
   * Upload the material uniforms and sampler units into `program`, which must be current. Uniform
   * values stay in the program, so a caller that tracks the last upload can skip repeating it.
   * `uniforms` uploads the values of another program of this layout (the same uniform names): the
   * program a draw kept from an earlier frame stands for at this one.
   */
  uploadUniforms(uniforms?: StandardMaterialProgram['uniforms']): void
  /** The texture and sampler `bind` puts on each unit, in unit order. */
  readonly textureUnits: readonly Readonly<{
    texture: WebGLTexture
    sampler: WebGLSampler
    target: number
  }>[]
  release(): void
}

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type)
  if (result === null) throw new TypeError('could not allocate a material shader')
  gl.shaderSource(result, source)
  gl.compileShader(result)
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(result) ?? 'unknown compile error'
    gl.deleteShader(result)
    throw new TypeError(`material shader compilation failed: ${message}`)
  }
  return result
}

/**
 * Compile and link programs without querying their status. Status queries block until the driver
 * finishes, so issuing every link first lets ANGLE compile them in parallel; each program's status
 * is checked when `createWebGlMaterialProgram` first leases it.
 */
const shaderPairKeys = new WeakMap<object, string>()

/**
 * The program cache key of a shader pair (its vertex and fragment source joined), kept with the
 * pair object. Programs that follow the clock are new objects every frame but lease the same shader
 * pair, and joining its ~20 KB of source for every lease and warm-up allocated and hashed a new key
 * string each time (on Amphion ~6 MiB a frame).
 */
export function shaderPairCacheKey(
  pair: Readonly<{ vertexSource: string; fragmentSource: string }>,
): string {
  let key = shaderPairKeys.get(pair)
  if (key === undefined)
    shaderPairKeys.set(pair, (key = `${pair.vertexSource}\u0000${pair.fragmentSource}`))
  return key
}

export function linkWebGlMaterialProgramsInParallel(
  gl: WebGL2RenderingContext,
  sources: Iterable<Readonly<{ vertexSource: string; fragmentSource: string }>>,
  programCache: Map<string, WebGLProgram>,
  pendingPrograms: Set<WebGLProgram>,
): number {
  let linked = 0
  for (const source of sources) {
    const cacheKey = shaderPairCacheKey(source)
    if (programCache.has(cacheKey)) continue
    const program = gl.createProgram()
    if (program === null) throw new TypeError('could not allocate a material program')
    for (const [type, text] of [
      [gl.VERTEX_SHADER, source.vertexSource],
      [gl.FRAGMENT_SHADER, source.fragmentSource],
    ] as const) {
      const item = gl.createShader(type)
      if (item === null) throw new TypeError('could not allocate a material shader')
      gl.shaderSource(item, text)
      gl.compileShader(item)
      gl.attachShader(program, item)
      // Flagged for deletion; the program keeps the shader alive until it is deleted.
      gl.deleteShader(item)
    }
    gl.linkProgram(program)
    programCache.set(cacheKey, program)
    pendingPrograms.add(program)
    linked += 1
  }
  return linked
}

const textureUnitLimits = new WeakMap<WebGL2RenderingContext, number>()
const uniformLocations = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>()

/** Cached getUniformLocation; locations never change for a linked program. */
export function uniformLocation(gl: WebGL2RenderingContext, program: WebGLProgram, name: string) {
  let locations = uniformLocations.get(program)
  if (locations === undefined) uniformLocations.set(program, (locations = new Map()))
  if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name))
  return locations.get(name) ?? null
}

/**
 * The value each material uniform holds in its linked program, by program and location. Materials that share a linked program switch it back
 * and forth within a frame and mostly agree on most values: every switch uploaded every value and
 * sampler unit again, most of a frame's GL calls. Only uploadUniforms writes these locations (the
 * frame, light and placement uniforms have other names), so this is the program's own state and
 * an equal float32 value (or unit) needs no call.
 */
const heldUniforms = new WeakMap<WebGLProgram, Map<WebGLUniformLocation, number | Float32Array>>()

function holdsUniform(
  program: Map<WebGLUniformLocation, number | Float32Array>,
  location: WebGLUniformLocation,
  value: number | Float32List,
): boolean {
  const held = program.get(location)
  if (held === undefined) return false
  if (typeof value === 'number')
    return typeof held === 'number' && Object.is(held, Math.fround(value))
  if (typeof held === 'number' || held.length !== value.length) return false
  for (let index = 0; index < held.length; index++)
    if (!Object.is(held[index], Math.fround(value[index]!))) return false
  return true
}

/** Bind generated material programs to WebGL2, without native texture decoding or scene ownership. */
export function createWebGlMaterialProgram(
  gl: WebGL2RenderingContext,
  source: StandardMaterialProgram,
  textures: ReadonlyMap<string, WebGLTexture>,
  options: {
    readonly filter?: 'nearest' | 'linear'
    readonly filters?: ReadonlyMap<string, 'nearest' | 'linear'>
    /** Linear textures carry a full mip chain; sample it with trilinear + anisotropic filtering. */
    readonly mipmaps?: boolean
    /**
     * Linked programs by shader source, owned (and deleted) by the caller. Programs regenerated for
     * a new playback time differ only in uniforms; relinking them per frame dominated animated scenes.
     */
    readonly programCache?: Map<string, WebGLProgram>
    /** The source's key in `programCache`, when the caller keeps it (see shaderPairCacheKey). */
    readonly programCacheKey?: string
    /** Cached programs linked by `linkWebGlMaterialProgramsInParallel` whose status is still unchecked. */
    readonly pendingPrograms?: Set<WebGLProgram>
    /**
     * Sampler objects by their parameters, owned (and deleted) by the caller: leases with equal
     * wrap and filter settings share one instead of creating and deleting their own.
     */
    readonly samplerCache?: Map<string, WebGLSampler>
  } = {},
): WebGlMaterialProgram {
  if (options.filter !== undefined && options.filter !== 'nearest' && options.filter !== 'linear')
    throw new TypeError('material texture filter must be nearest or linear')
  // getParameter and getUniformLocation synchronize with the GPU process; query once per context/program.
  let available: unknown = textureUnitLimits.get(gl)
  if (available === undefined) {
    available = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)
    if (typeof available === 'number') textureUnitLimits.set(gl, available)
  }
  if (typeof available !== 'number' || source.textures.length > available)
    throw new RangeError(
      `material needs ${source.textures.length} texture samplers; WebGL offers ${String(available)}`,
    )
  const bindings = source.textures.map(binding => {
    const texture = textures.get(binding.resourceId)
    if (texture === undefined)
      throw new TypeError(`material texture is unresolved: ${binding.resourceId}`)
    const filter = options.filters?.get(binding.resourceId) ?? options.filter ?? 'linear'
    if (filter !== 'nearest' && filter !== 'linear')
      throw new TypeError('material texture filter must be nearest or linear')
    return { binding, texture, filter }
  })
  const cacheKey = options.programCacheKey ?? `${source.vertexSource}\u0000${source.fragmentSource}`
  const cached = options.programCache?.get(cacheKey)
  const program = cached ?? gl.createProgram()
  if (program === null) throw new TypeError('could not allocate a material program')
  const shaders: WebGLShader[] = [],
    samplers: WebGLSampler[] = []
  let live = true
  const release = () => {
    if (!live) return
    live = false
    for (const sampler of samplers) gl.deleteSampler(sampler)
    if (options.programCache === undefined) gl.deleteProgram(program)
  }
  try {
    if (cached !== undefined && options.pendingPrograms?.has(cached)) {
      options.pendingPrograms.delete(cached)
      if (!gl.getProgramParameter(cached, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(cached) ?? 'unknown link error'
        options.programCache?.delete(cacheKey)
        gl.deleteProgram(cached)
        throw new TypeError(`material shader link failed: ${message}`)
      }
    }
    if (cached === undefined) {
      shaders.push(shader(gl, gl.VERTEX_SHADER, source.vertexSource))
      shaders.push(shader(gl, gl.FRAGMENT_SHADER, source.fragmentSource))
      for (const item of shaders) gl.attachShader(program, item)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) ?? 'unknown link error'
        gl.deleteProgram(program)
        throw new TypeError(`material shader link failed: ${message}`)
      }
      options.programCache?.set(cacheKey, program)
    }
    const values = Object.entries(source.uniforms).map(([name, value]) => ({
      name,
      location: uniformLocation(gl, program, name),
      value: typeof value === 'number' ? value : Float32Array.from(value),
    }))
    const maps = bindings.map(({ binding, texture, filter: filterMode }) => {
      const wrap = (mode: string) => (mode === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT)
      const cube = binding.dimension === 'cube'
      const wrapS = cube ? gl.CLAMP_TO_EDGE : wrap(binding.wrapU)
      const wrapT = cube ? gl.CLAMP_TO_EDGE : wrap(binding.wrapV)
      const filter = filterMode === 'nearest' ? gl.NEAREST : gl.LINEAR
      const mipmapped = options.mipmaps === true && filterMode !== 'nearest'
      const minFilter = mipmapped ? gl.LINEAR_MIPMAP_LINEAR : filter
      const anisotropy = mipmapped ? textureAnisotropy(gl) : undefined
      const key = `${cube ? 'cube' : '2d'}:${wrapS}:${wrapT}:${minFilter}:${filter}:${anisotropy?.value ?? 0}`
      let sampler = options.samplerCache?.get(key) ?? null
      if (sampler === null) {
        sampler = gl.createSampler()
        if (sampler === null) throw new TypeError('could not allocate a material sampler')
        if (options.samplerCache === undefined) samplers.push(sampler)
        else options.samplerCache.set(key, sampler)
        gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, wrapS)
        gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, wrapT)
        if (cube) gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
        gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, minFilter)
        gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, filter)
        if (anisotropy !== undefined)
          gl.samplerParameterf(sampler, anisotropy.parameter, anisotropy.value)
      }
      return {
        texture,
        sampler,
        target: cube ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D,
        location: uniformLocation(gl, program, binding.uniform),
      }
    })
    let held = heldUniforms.get(program)
    if (held === undefined) heldUniforms.set(program, (held = new Map()))
    const holds = held
    const uploadUniforms = (uniforms?: StandardMaterialProgram['uniforms']) => {
      if (!live) throw new TypeError('material program has been released')
      for (const { name, location, value: own } of values) {
        if (location === null) continue
        // WebGL reads a plain array into float32 as it reads the lease's own Float32Array copy.
        const value = (uniforms === undefined ? own : uniforms[name]) as number | Float32List
        if (value === undefined) throw new TypeError(`material uniform ${name} has no value`)
        // vec2-vec4, a mat3, or an array of vec3 longer than one mat3 (a team ramp's shades)
        if (
          typeof value !== 'number' &&
          ![2, 3, 4, 9].includes(value.length) &&
          !(value.length > 9 && value.length % 3 === 0)
        )
          throw new TypeError('invalid material uniform arity')
        if (holdsUniform(holds, location, value)) continue
        if (typeof value === 'number') gl.uniform1f(location, value)
        else if (value.length === 2) gl.uniform2fv(location, value)
        else if (value.length === 3 || value.length > 9) gl.uniform3fv(location, value)
        else if (value.length === 4) gl.uniform4fv(location, value)
        else gl.uniformMatrix3fv(location, false, value)
        holds.set(
          location,
          typeof value === 'number' ? Math.fround(value) : Float32Array.from(value),
        )
      }
      maps.forEach(({ location }, unit) => {
        if (location === null || holds.get(location) === unit) return
        gl.uniform1i(location, unit)
        holds.set(location, unit)
      })
    }
    return Object.freeze({
      program,
      bind() {
        if (!live) throw new TypeError('material program has been released')
        gl.useProgram(program)
        uploadUniforms()
        maps.forEach(({ texture, sampler, target }, unit) => {
          gl.activeTexture(gl.TEXTURE0 + unit)
          gl.bindTexture(target, texture)
          gl.bindSampler(unit, sampler)
        })
      },
      uploadUniforms,
      textureUnits: Object.freeze(
        maps.map(({ texture, sampler, target }) => Object.freeze({ texture, sampler, target })),
      ),
      release,
    })
  } catch (error) {
    release()
    throw error
  } finally {
    for (const item of shaders) gl.deleteShader(item)
  }
}
