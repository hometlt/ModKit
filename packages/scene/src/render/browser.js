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

function programFor(gl) {
  const vertex = compile(
    gl,
    gl.VERTEX_SHADER,
    '#version 300 es\nin vec3 position; uniform mat4 transform; void main(){gl_Position=transform*vec4(position,1.0);}',
  )
  const fragment = compile(
    gl,
    gl.FRAGMENT_SHADER,
    '#version 300 es\nprecision highp float; uniform vec4 color; out vec4 outColor; void main(){outColor=color;}',
  )
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
  const transform = gl.getUniformLocation(program, 'transform')
  const color = gl.getUniformLocation(program, 'color')
  if (position < 0 || transform === null || color === null) {
    gl.deleteProgram(program)
    throw new TypeError('WebGL renderer uniforms are unavailable')
  }
  const materials = new Map(
    (request.scene.materials ?? []).map(material => [material.id, material.baseColor]),
  )
  const clear = request.clearColor ?? [0, 0, 0, 0]
  gl.viewport(0, 0, width, height)
  gl.clearColor(clear[0], clear[1], clear[2], clear[3])
  gl.clearDepth(1)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  gl.useProgram(program)
  let triangles = 0
  const diagnostics = []
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
    const vertexBuffer = gl.createBuffer()
    if (vertexBuffer === null) throw new TypeError('WebGL could not allocate a vertex buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, primitive.positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0)
    const model = primitive.transform
    gl.uniformMatrix4fv(
      transform,
      false,
      model === undefined
        ? request.camera.viewProjection
        : multiply(request.camera.viewProjection, model),
    )
    gl.uniform4fv(color, materials.get(primitive.materialId) ?? [0.78, 0.8, 0.84, 1])
    let count = primitive.positions.length / 3
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
    gl.deleteBuffer(vertexBuffer)
  }
  const bottomUp = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp)
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
