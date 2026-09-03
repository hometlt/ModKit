import { SCENE_RENDERER_CONTRACT } from '@modkit/sdk/renderer'

const RENDERER_ID = 'modkit.browser-webgl'
const MAX_DIMENSION = 4_096

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  if (shader === null) throw new TypeError('WebGL could not allocate a shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown shader error'
    gl.deleteShader(shader)
    throw new TypeError(`WebGL shader compilation failed: ${message}`)
  }
  return shader
}

/*
 * One program for every primitive, branching on uniforms rather than on shader permutations.
 *
 * A permutation cache would be faster and would also mean the first frame of a textured model
 * pays a shader compile the wireframe fallback never does. The scenes this renderer draws are one
 * model at a time, so the branch costs nothing measurable and the code stays readable.
 *
 * `shaded`/`textured` are floats, not bools: WebGL2 uniform blocks with mixed bool/float layouts
 * are a portability trap across drivers, and a 0/1 float behaves identically in every one.
 */
const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 transform;
uniform mat4 model;
out vec3 worldNormal;
out vec3 worldPosition;
out vec2 texCoord;
void main() {
  worldNormal = mat3(model) * normal;
  worldPosition = (model * vec4(position, 1.0)).xyz;
  texCoord = uv;
  gl_Position = transform * vec4(position, 1.0);
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 worldNormal;
in vec3 worldPosition;
in vec2 texCoord;
uniform vec4 color;
uniform vec4 lightColor;
uniform vec3 lightDirection;
uniform float ambient;
uniform float shaded;
uniform float textured;
uniform float hasNormals;
uniform sampler2D baseColorMap;
out vec4 outColor;
void main() {
  vec4 base = color;
  if (textured > 0.5) base *= texture(baseColorMap, texCoord);
  if (shaded > 0.5) {
    /*
     * Derivatives of the world position stand in for a normal the geometry did not publish, which
     * is the same geometric face normal the CPU provider computes from the triangle's own corners
     * — so a mesh without normals is shaded rather than flat-filled, and both providers shade it
     * the same way. Two-sided, for the same reason the CPU provider is: real game meshes have
     * triangles wound both ways.
     */
    vec3 surface = hasNormals > 0.5
      ? normalize(worldNormal)
      : normalize(cross(dFdx(worldPosition), dFdy(worldPosition)));
    float lambert = min(1.0, ambient + (1.0 - ambient) * abs(dot(surface, lightDirection)));
    base.rgb *= lambert * lightColor.rgb;
  }
  outColor = base;
}`

function programFor(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (program === null) throw new TypeError('WebGL could not allocate a program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'unknown link error'
    gl.deleteProgram(program)
    throw new TypeError(`WebGL program link failed: ${message}`)
  }
  return program
}

function multiply(left, right) {
  const out = new Float32Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0
      for (let index = 0; index < 4; index += 1) {
        value += left[index * 4 + row] * right[column * 4 + index]
      }
      out[column * 4 + row] = value
    }
  }
  return out
}

function topology(gl, value) {
  if (value === 'triangles') return gl.TRIANGLES
  if (value === 'triangle-strip') return gl.TRIANGLE_STRIP
  if (value === 'triangle-fan') return gl.TRIANGLE_FAN
  return undefined
}

const IDENTITY = /* @__PURE__ */ new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/** One float attribute buffer bound to `location`, or `undefined` when the source is unusable. */
function attributeBuffer(gl, location, data, components) {
  const buffer = gl.createBuffer()
  if (buffer === null) throw new TypeError('WebGL could not allocate an attribute buffer')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0)
  return buffer
}

/**
 * Upload every texture the scene carries, once, before any primitive draws.
 *
 * `CLAMP_TO_EDGE` where the contract says clamp and `REPEAT` where it says repeat, with linear
 * minification but no mipmaps: generating them for a texture used for one frame costs more than
 * the aliasing it removes, and the model viewer redraws on every camera change.
 */
function uploadTextures(gl, textures, diagnostics) {
  const uploaded = new Map()
  for (const texture of textures ?? []) {
    if (
      typeof texture?.id !== 'string' ||
      texture.id.length === 0 ||
      !Number.isSafeInteger(texture.width) ||
      !Number.isSafeInteger(texture.height) ||
      texture.width <= 0 ||
      texture.height <= 0 ||
      texture.width > MAX_DIMENSION ||
      texture.height > MAX_DIMENSION ||
      !(texture.rgba instanceof Uint8Array) ||
      texture.rgba.length !== texture.width * texture.height * 4
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'modkit.browser-webgl/texture-invalid',
        message: `browser renderer skipped a malformed texture (${String(texture?.id)})`,
      })
      continue
    }
    const handle = gl.createTexture()
    if (handle === null) throw new TypeError('WebGL could not allocate a texture')
    gl.bindTexture(gl.TEXTURE_2D, handle)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      texture.width,
      texture.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      texture.rgba,
    )
    const wrap = mode => (mode === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(texture.wrapU))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(texture.wrapV))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    uploaded.set(texture.id, handle)
  }
  return uploaded
}

/** The scene's light with a unit direction, or `undefined` for a scene that declared none. */
function normalizedLight(light) {
  if (light === undefined || light === null) return undefined
  const direction = light.direction
  if (!Array.isArray(direction) || direction.length !== 3) {
    throw new TypeError('scene light direction must be an xyz vector')
  }
  const length = Math.hypot(direction[0], direction[1], direction[2])
  if (!Number.isFinite(length) || length < 1e-9) {
    throw new TypeError('scene light direction must be finite and non-zero')
  }
  return Object.freeze({
    direction: new Float32Array([
      direction[0] / length,
      direction[1] / length,
      direction[2] / length,
    ]),
    color: new Float32Array(light.color ?? [1, 1, 1, 1]),
    ambient: typeof light.ambient === 'number' ? light.ambient : 0.25,
  })
}

function flipRows(bytes, width, height) {
  const stride = width * 4
  const out = new Uint8Array(bytes.byteLength)
  for (let row = 0; row < height; row += 1) {
    out.set(bytes.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride)
  }
  return out
}

/** WebGL2 implementation of the portable scene-renderer contract. */
export async function renderBrowser(request) {
  request.signal?.throwIfAborted()
  const width = request.viewport?.width
  const height = request.viewport?.height
  if (
    request.outputKind !== 'rgba8' ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    width > MAX_DIMENSION ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    height > MAX_DIMENSION ||
    !(request.camera?.viewProjection instanceof Float32Array) ||
    request.camera.viewProjection.length !== 16 ||
    !Array.isArray(request.scene?.primitives)
  ) {
    throw new TypeError('browser renderer received an invalid scene request')
  }
  if (typeof OffscreenCanvas !== 'function') {
    throw new TypeError('OffscreenCanvas is unavailable in this browser worker')
  }
  const canvas = new OffscreenCanvas(width, height)
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: true,
    preserveDrawingBuffer: true,
  })
  if (gl === null) throw new TypeError('WebGL2 is unavailable in this browser worker')
  const program = programFor(gl)
  const position = gl.getAttribLocation(program, 'position')
  const normal = gl.getAttribLocation(program, 'normal')
  const uv = gl.getAttribLocation(program, 'uv')
  const transform = gl.getUniformLocation(program, 'transform')
  const color = gl.getUniformLocation(program, 'color')
  const uniform = name => gl.getUniformLocation(program, name)
  const modelUniform = uniform('model')
  const lightColor = uniform('lightColor')
  const lightDirection = uniform('lightDirection')
  const ambient = uniform('ambient')
  const shadedUniform = uniform('shaded')
  const texturedUniform = uniform('textured')
  const hasNormalsUniform = uniform('hasNormals')
  const baseColorMap = uniform('baseColorMap')
  if (position < 0 || transform === null || color === null || modelUniform === null) {
    gl.deleteProgram(program)
    throw new TypeError('WebGL renderer uniforms are unavailable')
  }
  const diagnostics = []
  const textures = uploadTextures(gl, request.scene.textures, diagnostics)
  const materials = new Map(
    (request.scene.materials ?? []).map(material => [
      material.id,
      Object.freeze({
        baseColor: material.baseColor,
        shading: material.shading ?? 'unlit',
        texture:
          material.baseColorTexture === undefined
            ? undefined
            : textures.get(material.baseColorTexture),
      }),
    ]),
  )
  for (const material of request.scene.materials ?? []) {
    if (material.baseColorTexture !== undefined && !textures.has(material.baseColorTexture)) {
      diagnostics.push({
        severity: 'warning',
        code: 'modkit.browser-webgl/texture-missing',
        message: `material ${material.id} names texture ${material.baseColorTexture}, which the scene did not carry`,
      })
    }
  }
  const light = normalizedLight(request.scene.light)
  const clear = request.clearColor ?? [0, 0, 0, 0]
  gl.viewport(0, 0, width, height)
  gl.clearColor(clear[0], clear[1], clear[2], clear[3])
  gl.clearDepth(1)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  gl.useProgram(program)
  if (light !== undefined) {
    if (lightColor !== null) gl.uniform4fv(lightColor, light.color)
    if (lightDirection !== null) gl.uniform3fv(lightDirection, light.direction)
    if (ambient !== null) gl.uniform1f(ambient, light.ambient)
  }
  if (baseColorMap !== null) gl.uniform1i(baseColorMap, 0)
  let triangles = 0
  for (const primitive of request.scene.primitives) {
    request.signal?.throwIfAborted()
    const mode = topology(gl, primitive.topology)
    if (mode === undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'modkit.browser-webgl/unsupported-topology',
        message: `browser renderer skipped ${primitive.topology}`,
        primitiveId: primitive.id,
      })
      continue
    }
    const vertexCount = primitive.positions.length / 3
    const vertexBuffer = gl.createBuffer()
    if (vertexBuffer === null) throw new TypeError('WebGL could not allocate a vertex buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, primitive.positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0)
    const surface = materials.get(primitive.materialId)
    const shaded = light !== undefined && surface?.shading === 'lambert'
    const normalBuffer =
      normal < 0 ||
      !shaded ||
      !(primitive.normals instanceof Float32Array) ||
      primitive.normals.length < primitive.positions.length
        ? undefined
        : attributeBuffer(gl, normal, primitive.normals, 3)
    const textured = surface?.texture !== undefined
    const uvBuffer =
      uv < 0 ||
      !textured ||
      !(primitive.textureCoordinates instanceof Float32Array) ||
      primitive.textureCoordinates.length < vertexCount * 2
        ? undefined
        : attributeBuffer(gl, uv, primitive.textureCoordinates, 2)
    /*
     * A disabled attribute keeps whatever generic value the context last held, so both are given
     * an explicit constant when their buffer is absent. Without this a primitive drawn after a
     * textured one samples the previous model's UVs.
     */
    if (normalBuffer === undefined && normal >= 0) {
      gl.disableVertexAttribArray(normal)
      gl.vertexAttrib3f(normal, 0, 0, 1)
    }
    if (uvBuffer === undefined && uv >= 0) {
      gl.disableVertexAttribArray(uv)
      gl.vertexAttrib2f(uv, 0, 0)
    }
    const model = primitive.transform
    gl.uniformMatrix4fv(
      transform,
      false,
      model === undefined
        ? request.camera.viewProjection
        : multiply(request.camera.viewProjection, model),
    )
    gl.uniformMatrix4fv(modelUniform, false, model ?? IDENTITY)
    gl.uniform4fv(color, surface?.baseColor ?? [0.78, 0.8, 0.84, 1])
    if (shadedUniform !== null) gl.uniform1f(shadedUniform, shaded ? 1 : 0)
    if (hasNormalsUniform !== null) {
      gl.uniform1f(hasNormalsUniform, normalBuffer === undefined ? 0 : 1)
    }
    const sampling = textured && uvBuffer !== undefined
    if (texturedUniform !== null) gl.uniform1f(texturedUniform, sampling ? 1 : 0)
    if (sampling) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, surface.texture)
    }
    let count = vertexCount
    let indexBuffer
    if (primitive.indices !== undefined) {
      indexBuffer = gl.createBuffer()
      if (indexBuffer === null) throw new TypeError('WebGL could not allocate an index buffer')
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, primitive.indices, gl.STATIC_DRAW)
      count = primitive.indices.length
      gl.drawElements(mode, count, gl.UNSIGNED_INT, 0)
    } else {
      gl.drawArrays(mode, 0, count)
    }
    triangles += primitive.topology === 'triangles' ? Math.floor(count / 3) : Math.max(0, count - 2)
    gl.deleteBuffer(indexBuffer)
    gl.deleteBuffer(normalBuffer)
    gl.deleteBuffer(uvBuffer)
    gl.deleteBuffer(vertexBuffer)
  }
  const bottomUp = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp)
  for (const texture of textures.values()) gl.deleteTexture(texture)
  gl.deleteProgram(program)
  const rgba = flipRows(bottomUp, width, height)
  let fragments = 0
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (
      rgba[offset] !== Math.round(clear[0] * 255) ||
      rgba[offset + 1] !== Math.round(clear[1] * 255) ||
      rgba[offset + 2] !== Math.round(clear[2] * 255) ||
      rgba[offset + 3] !== Math.round(clear[3] * 255)
    ) {
      fragments += 1
    }
  }
  return Object.freeze({
    outputKind: 'rgba8',
    width,
    height,
    rgba,
    diagnostics: Object.freeze(diagnostics),
    statistics: Object.freeze({
      primitives: request.scene.primitives.length,
      triangles,
      fragments,
    }),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([SCENE_RENDERER_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== SCENE_RENDERER_CONTRACT || selection.major !== 1) {
    throw new TypeError(`unsupported renderer selection ${selection.contract}@${selection.major}`)
  }
  return Object.freeze({
    value: Object.freeze({
      contract: SCENE_RENDERER_CONTRACT,
      rendererId: RENDERER_ID,
      outputKinds: Object.freeze(['rgba8']),
      render: renderBrowser,
    }),
    release: async () => undefined,
  })
}
