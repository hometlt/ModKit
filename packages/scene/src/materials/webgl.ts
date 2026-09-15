import type { StandardMaterialProgram } from './standard-program.js'
import { textureAnisotropy } from '../render/texture-filtering.js'

/** A single leased shader program; uploaded texture objects remain owned by the caller. */
export interface WebGlMaterialProgram {
  readonly program: WebGLProgram
  /** Bind material uniforms/textures. The geometry adapter supplies camera and vertex attributes. */
  bind(): void
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
  } = {},
): WebGlMaterialProgram {
  if (options.filter !== undefined && options.filter !== 'nearest' && options.filter !== 'linear')
    throw new TypeError('material texture filter must be nearest or linear')
  const available: unknown = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)
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
  const program = gl.createProgram()
  if (program === null) throw new TypeError('could not allocate a material program')
  const shaders: WebGLShader[] = [],
    samplers: WebGLSampler[] = []
  let live = true
  const release = () => {
    if (!live) return
    live = false
    for (const sampler of samplers) gl.deleteSampler(sampler)
    gl.deleteProgram(program)
  }
  try {
    shaders.push(shader(gl, gl.VERTEX_SHADER, source.vertexSource))
    shaders.push(shader(gl, gl.FRAGMENT_SHADER, source.fragmentSource))
    for (const item of shaders) gl.attachShader(program, item)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new TypeError(
        `material shader link failed: ${gl.getProgramInfoLog(program) ?? 'unknown link error'}`,
      )
    const values = Object.entries(source.uniforms).map(([name, value]) => ({
      location: gl.getUniformLocation(program, name),
      value: typeof value === 'number' ? value : Float32Array.from(value),
    }))
    const maps = bindings.map(({ binding, texture, filter: filterMode }) => {
      const sampler = gl.createSampler()
      if (sampler === null) throw new TypeError('could not allocate a material sampler')
      samplers.push(sampler)
      const wrap = (mode: string) => (mode === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT)
      const cube = binding.dimension === 'cube'
      gl.samplerParameteri(
        sampler,
        gl.TEXTURE_WRAP_S,
        cube ? gl.CLAMP_TO_EDGE : wrap(binding.wrapU),
      )
      gl.samplerParameteri(
        sampler,
        gl.TEXTURE_WRAP_T,
        cube ? gl.CLAMP_TO_EDGE : wrap(binding.wrapV),
      )
      if (cube) gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
      const filter = filterMode === 'nearest' ? gl.NEAREST : gl.LINEAR
      const mipmapped = options.mipmaps === true && filterMode !== 'nearest'
      gl.samplerParameteri(
        sampler,
        gl.TEXTURE_MIN_FILTER,
        mipmapped ? gl.LINEAR_MIPMAP_LINEAR : filter,
      )
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, filter)
      const anisotropy = mipmapped ? textureAnisotropy(gl) : undefined
      if (anisotropy !== undefined)
        gl.samplerParameterf(sampler, anisotropy.parameter, anisotropy.value)
      return {
        texture,
        sampler,
        target: cube ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D,
        location: gl.getUniformLocation(program, binding.uniform),
      }
    })
    return Object.freeze({
      program,
      bind() {
        if (!live) throw new TypeError('material program has been released')
        gl.useProgram(program)
        for (const { location, value } of values) {
          if (location === null) continue
          if (typeof value === 'number') gl.uniform1f(location, value)
          else if (value.length === 2) gl.uniform2fv(location, value)
          else if (value.length === 3) gl.uniform3fv(location, value)
          else if (value.length === 4) gl.uniform4fv(location, value)
          else if (value.length === 9) gl.uniformMatrix3fv(location, false, value)
          else throw new TypeError('invalid material uniform arity')
        }
        maps.forEach(({ texture, sampler, target, location }, unit) => {
          gl.activeTexture(gl.TEXTURE0 + unit)
          gl.bindTexture(target, texture)
          gl.bindSampler(unit, sampler)
          gl.uniform1i(location, unit)
        })
      },
      release,
    })
  } catch (error) {
    release()
    throw error
  } finally {
    for (const item of shaders) gl.deleteShader(item)
  }
}
