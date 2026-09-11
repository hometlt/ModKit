import { createWebGlMaterialProgram } from '../../../scene/src/materials/webgl.js'
import { materialProgramCases, materialCaseProgram } from './scene-material-program.js'

/** Constant-varying raster harness isolates material arithmetic from geometry interpolation. */
export function renderMaterialCase(index: number) {
  const item = materialProgramCases()[index]
  if (item === undefined) throw new Error('missing material case')
  const source = materialCaseProgram(item),
    pixel = item.pixel ?? {}
  const canvas = new OffscreenCanvas(8, 8),
    gl = canvas.getContext('webgl2', { antialias: false, alpha: true })
  if (gl === null) throw new Error('WebGL2 unavailable')
  const textures = new Map<string, WebGLTexture>()
  for (const binding of source.textures) {
    const rgba = pixel.texels?.[binding.slot]
    if (rgba === undefined) throw new Error(`no texel fixture for ${binding.slot}`)
    const texture = gl.createTexture()
    if (texture === null) throw new Error('texture allocation failed')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      Uint8Array.from(rgba, x => Math.round(x * 255)),
    )
    textures.set(binding.resourceId, texture)
  }
  // Link the real generated vertex and fragment sources together as well as drawing the isolated
  // fragment harness. The harness alone would miss an incompatible varying or vertex syntax.
  const full = createWebGlMaterialProgram(gl, source, textures)
  full.bind()
  full.release()
  full.release()
  let releasedRefused = false
  try {
    full.bind()
  } catch {
    releasedRefused = true
  }
  const vec = (values: readonly number[]) =>
    `vec${values.length}(${values.map(x => (Number.isInteger(x) ? `${x}.0` : String(x))).join(',')})`
  const varyings = {
    v_normal: pixel.normal ?? [0, 0, 1],
    v_lightDir: pixel.lightDirection ?? [0, 0, 1],
    v_halfVec: pixel.halfVector ?? [0, 0, -1],
    v_viewDir: [0, 0, 1],
    v_viewPosition: pixel.eyeToVertex ?? [0, 0, -1],
    v_viewNormal: pixel.viewNormal ?? [0, 0, 1],
    v_modelPosition: [0.1, 0.2, 0.3],
    v_worldPosition: [0.1, 0.2, 0.3],
    v_modelNormal: [0, 0, 1],
    v_worldNormal: [0, 0, 1],
    v_clipPosition: [0, 0, 0, 1],
    v_vertexColor: pixel.vertexColor ?? [1, 1, 1, 1],
    v_uv0: [0.3, 0.7],
    v_uv1: [0.3, 0.7],
    v_uv2: [0.3, 0.7],
    v_uv3: [0.3, 0.7],
  }
  const vertexSource = `#version 300 es
precision highp float;
${Object.entries(varyings)
  .map(([name, values]) => `out vec${values.length} ${name};`)
  .join('\n')}
void main(){
  vec2 p=gl_VertexID==0?vec2(-1.0,-1.0):gl_VertexID==1?vec2(3.0,-1.0):vec2(-1.0,3.0);
  gl_Position=vec4(p,0.0,1.0);
  ${Object.entries(varyings)
    .map(([name, values]) => `${name}=${vec(values)};`)
    .join('\n')}
}`
  const harness = createWebGlMaterialProgram(gl, { ...source, vertexSource }, textures, {
    filter: 'nearest',
  })
  gl.disable(gl.DITHER)
  gl.viewport(0, 0, 8, 8)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  harness.bind()
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const rgba = new Uint8Array(8 * 8 * 4)
  gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
  const error = gl.getError()
  harness.release()
  for (const texture of textures.values()) gl.deleteTexture(texture)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { name: item.name, rgba: Array.from(rgba), error, releasedRefused }
}

export function materialFailureProbe() {
  const item = materialProgramCases().find(item => item.name === 'layer-diffuse')
  if (item === undefined) throw new Error('missing textured material fixture')
  const source = materialCaseProgram(item)
  const gl = new OffscreenCanvas(8, 8).getContext('webgl2')
  if (gl === null) throw new Error('WebGL2 unavailable')
  let allocated = 0,
    deleted = 0,
    shaderDeletes = 0
  const originalCreate = gl.createProgram.bind(gl),
    originalDelete = gl.deleteProgram.bind(gl),
    originalDeleteShader = gl.deleteShader.bind(gl),
    originalParameter = gl.getParameter.bind(gl)
  gl.createProgram = () => {
    allocated++
    return originalCreate()
  }
  gl.deleteProgram = program => {
    deleted++
    originalDelete(program)
  }
  gl.deleteShader = shader => {
    shaderDeletes++
    originalDeleteShader(shader)
  }
  const refuse = (action: () => unknown) => {
    try {
      action()
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  const missing = refuse(() => createWebGlMaterialProgram(gl, source, new Map()))
  const missingAllocations = allocated
  gl.getParameter = name => (name === gl.MAX_TEXTURE_IMAGE_UNITS ? 0 : originalParameter(name))
  const limit = refuse(() => createWebGlMaterialProgram(gl, source, new Map()))
  const limitAllocations = allocated
  gl.getParameter = originalParameter
  const texture = gl.createTexture()
  if (texture === null) throw new Error('texture allocation failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    Uint8Array.of(255, 255, 255, 255),
  )
  const textures = new Map(source.textures.map(binding => [binding.resourceId, texture]))
  const compile = refuse(() =>
    createWebGlMaterialProgram(
      gl,
      { ...source, fragmentSource: '#version 300 es\ninvalid shader' },
      textures,
    ),
  )
  const link = refuse(() =>
    createWebGlMaterialProgram(
      gl,
      {
        ...source,
        fragmentSource: `#version 300 es
precision highp float;
in vec2 v_normal; out vec4 color;
void main(){color=vec4(v_normal,0.0,1.0);}`,
      },
      textures,
    ),
  )
  const originalSampler = gl.createSampler.bind(gl)
  Reflect.set(gl, 'createSampler', () => null) // Inject the allocation failure allowed by WebGL.
  const sampler = refuse(() => createWebGlMaterialProgram(gl, source, textures))
  gl.createSampler = originalSampler
  const clean = allocated === deleted
  const ownedTextureAlive = gl.isTexture(texture)
  gl.deleteTexture(texture)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return {
    missing,
    missingAllocations,
    limit,
    limitAllocations,
    compile,
    link,
    sampler,
    allocated,
    deleted,
    shaderDeletes,
    clean,
    ownedTextureAlive,
  }
}
