import { readSimpleEffectColors } from './effect-colors.js'
import { PREVIEW_LIGHT_GLSL, bindPreviewLighting, readPreviewLighting } from './preview-lighting.js'
import {
  bindSimpleEffectTexture,
  readSimpleEffect,
  applySimpleEffectState,
  simpleEffectSolid,
} from './simple-effect.js'
import { applyWebGlDepthBias } from './depth-bias.js'
import type { SceneRendererShadingModel } from '@modkit/sdk/renderer'
import type {
  SceneRenderRequest,
  SceneRenderFrame,
  SceneRenderer,
  SceneRendererColor,
  SceneRendererTexture,
  SceneRendererDirectionalLight,
  SceneRendererDiagnostic,
} from '@modkit/sdk/renderer'
import { SCENE_RENDERER_CONTRACT } from '@modkit/sdk/renderer'
import { materialAlpha, straightenAlpha } from './alpha.js'
import { prepareSceneMaterialPrograms } from './materials.js'
import { sceneMaterialDraws } from './material-draws.js'
import { materialWebGlDraws } from './material-webgl.js'
import { applyTextureFilter } from './texture-filtering.js'
import { sceneTextureBytes } from '../textures/cube.js'
import { TEAM_COLOR_GLSL } from '@modkit/codec-kit/model-math/color-remap'
import { PBR_GLSL } from '@modkit/codec-kit/model-math/pbr'
import { drawTeamColor, teamMaskTexture } from './team-color.js'
import { drawPbr } from './pbr-material.js'

const RENDERER_ID = 'modkit.browser-webgl'
const MAX_DIMENSION = 4_096

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
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
in vec4 vertexColor;
out vec4 interpolatedVertexColor;
uniform mat4 transform;
uniform mat4 model;
out vec3 worldNormal;
out vec3 worldPosition;
out vec2 texCoord;
void main() {
  worldNormal = mat3(model) * normal;
  worldPosition = (model * vec4(position, 1.0)).xyz;
  texCoord = uv;
  interpolatedVertexColor = vertexColor;
  gl_Position = transform * vec4(position, 1.0);
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 worldNormal;
in vec3 worldPosition;
in vec2 texCoord;
in vec4 interpolatedVertexColor;
uniform vec4 color;
uniform vec4 instanceTint;
uniform vec4 lightColor;
uniform vec3 lightDirection;
uniform float ambient;
uniform float shaded;
uniform float textured;
uniform float hasNormals;
uniform float coverageMode;
uniform float alphaCutoff;
uniform float screenUvEnabled;
uniform vec2 screenUvViewport;
uniform vec2 screenUvOffset;
uniform vec2 screenUvTiling;
uniform float screenUvAngle;
uniform float screenUvThreshold;
uniform sampler2D baseColorMap;
// UV_game_material_team_color: 0 none, 1 whole, 2 weighed by a mask texture
uniform float teamColorMode;
uniform sampler2D teamMaskMap;
// mask channel 0-3, or 4 for one weight per channel
uniform float teamMaskChannel;
uniform float teamBlend;
uniform float teamStrength;
uniform vec3 teamColor;
// a pbr material: the one glTF BRDF (codec-kit model-math/pbr) under the scene light
uniform float pbrEnabled;
uniform float pbrMetallic;
uniform float pbrRoughness;
uniform float pbrOcclusionStrength;
uniform vec3 pbrEmissive;
uniform float pbrMetallicRoughnessTextured;
uniform sampler2D pbrMetallicRoughnessMap;
uniform float pbrOcclusionTextured;
uniform sampler2D pbrOcclusionMap;
uniform float pbrEmissiveTextured;
uniform sampler2D pbrEmissiveMap;
uniform float eyeKnown;
uniform vec3 eyePosition;
${PREVIEW_LIGHT_GLSL}
${TEAM_COLOR_GLSL}
${PBR_GLSL}
vec3 modkitSrgbToLinear(vec3 value) {
  return mix(value / 12.92, pow((value + 0.055) / 1.055, vec3(2.4)), vec3(greaterThan(value, vec3(0.04045))));
}
vec3 modkitLinearToSrgb(vec3 value) {
  return mix(value * 12.92, 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055, vec3(greaterThan(value, vec3(0.0031308))));
}
out vec4 outColor;
void main() {
  vec4 base = color;
  base *= interpolatedVertexColor;
  vec2 sampleUv = texCoord;
  if (coverageMode > 2.5 && screenUvEnabled > 0.5 &&
      (screenUvThreshold <= 0.0 || max(screenUvViewport.x, screenUvViewport.y) >= screenUvThreshold)) {
    vec2 centered = gl_FragCoord.xy / max(screenUvViewport, vec2(1.0)) - vec2(0.5);
    float cosine = cos(screenUvAngle);
    float sine = sin(screenUvAngle);
    sampleUv = (mat2(cosine, -sine, sine, cosine) * centered + vec2(0.5)) * screenUvTiling + screenUvOffset;
  }
  if (textured > 0.5) base *= texture(baseColorMap, sampleUv);
  if (teamColorMode > 0.5) {
    vec3 mask = vec3(1.0);
    if (teamColorMode > 1.5) {
      vec4 texel = texture(teamMaskMap, sampleUv);
      float channel = teamMaskChannel < 0.5 ? texel.r : teamMaskChannel < 1.5 ? texel.g : teamMaskChannel < 2.5 ? texel.b : texel.a;
      mask = teamMaskChannel > 3.5 ? texel.rgb : vec3(channel);
    }
    base.rgb = modkitTeamColor(base.rgb, mask, teamColor, int(teamBlend + 0.5), teamStrength);
  }
  if (pbrEnabled > 0.5) {
    vec3 surfaceNormal = hasNormals > 0.5
      ? normalize(worldNormal)
      : normalize(cross(dFdx(worldPosition), dFdy(worldPosition)));
    vec3 view = eyeKnown > 0.5 ? normalize(eyePosition - worldPosition) : surfaceNormal;
    vec4 metallicRoughness = pbrMetallicRoughnessTextured > 0.5
      ? texture(pbrMetallicRoughnessMap, sampleUv)
      : vec4(1.0);
    float occlusion = pbrOcclusionTextured > 0.5
      ? 1.0 + pbrOcclusionStrength * (texture(pbrOcclusionMap, sampleUv).r - 1.0)
      : 1.0;
    vec3 emissive = pbrEmissive * (pbrEmissiveTextured > 0.5
      ? modkitSrgbToLinear(texture(pbrEmissiveMap, sampleUv).rgb)
      : vec3(1.0));
    vec3 lit = modkitPbr(modkitSrgbToLinear(clamp(base.rgb, 0.0, 1.0)), pbrMetallic * metallicRoughness.b,
      pbrRoughness * metallicRoughness.g, occlusion, emissive, surfaceNormal, view, lightDirection,
      lightColor.rgb * (1.0 - ambient), lightColor.rgb * ambient);
    base.rgb = modkitLinearToSrgb(clamp(lit, 0.0, 1.0));
  }
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
    if (previewLightingEnabled == 1) base.rgb *= previewLighting(surface, worldPosition);
    else {
      float lambert = min(1.0, ambient + (1.0 - ambient) * abs(dot(surface, lightDirection)));
      base.rgb *= lambert * lightColor.rgb;
    }
  }
  base *= instanceTint;
  if (coverageMode > 2.5) {
    if (alphaCutoff > 0.0 && base.a < alphaCutoff) discard;
    outColor = coverageMode > 3.5 ? vec4(base.rgb * base.a, base.a) : base;
    return;
  }
  if (coverageMode > 0.5 && coverageMode < 1.5 && base.a < alphaCutoff) discard;
  if (coverageMode < 1.5) base.a = 1.0;
  outColor = vec4(base.rgb * base.a, base.a);
}`

function programFor(gl: WebGL2RenderingContext) {
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

function multiply(left: Float32Array, right: Float32Array) {
  const out = new Float32Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0
      for (let index = 0; index < 4; index += 1) {
        value += (left[index * 4 + row] as number) * (right[column * 4 + index] as number)
      }
      out[column * 4 + row] = value
    }
  }
  return out
}

function topology(gl: WebGL2RenderingContext, value: string) {
  if (value === 'triangles') return gl.TRIANGLES
  if (value === 'triangle-strip') return gl.TRIANGLE_STRIP
  if (value === 'triangle-fan') return gl.TRIANGLE_FAN
  return undefined
}

const IDENTITY = /* @__PURE__ */ new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/** One float attribute buffer bound to `location`, or `undefined` when the source is unusable. */
function attributeBuffer(
  gl: WebGL2RenderingContext,
  location: number,
  data: Float32Array,
  components: number,
) {
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
function uploadTextures(
  gl: WebGL2RenderingContext,
  textures: readonly SceneRendererTexture[] | undefined,
  diagnostics: SceneRendererDiagnostic[],
  uploaded: Map<string, WebGLTexture>,
) {
  for (const texture of textures ?? []) {
    if (
      typeof texture?.id !== 'string' ||
      texture.id.length === 0 ||
      !Number.isSafeInteger(texture.width) ||
      !Number.isSafeInteger(texture.height) ||
      texture.width <= 0 ||
      texture.height <= 0 ||
      texture.width > MAX_DIMENSION ||
      texture.height > MAX_DIMENSION
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'modkit.browser-webgl/texture-invalid',
        message: `browser renderer skipped a malformed texture (${String(texture?.id)})`,
      })
      continue
    }
    try {
      sceneTextureBytes(texture)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      diagnostics.push({
        severity: 'warning',
        code: 'modkit.browser-webgl/texture-invalid',
        message: `browser renderer skipped texture ${texture.id}: ${error.message}`,
      })
      continue
    }
    const handle = gl.createTexture()
    if (handle === null) throw new TypeError('WebGL could not allocate a texture')
    const previous = uploaded.get(texture.id)
    if (previous !== undefined) gl.deleteTexture(previous)
    uploaded.set(texture.id, handle)
    const cube = texture.dimension === 'cube'
    const target = cube ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D
    gl.bindTexture(target, handle)
    const faceBytes = texture.width * texture.height * 4
    for (let face = 0; face < (cube ? 6 : 1); face++)
      gl.texImage2D(
        cube ? gl.TEXTURE_CUBE_MAP_POSITIVE_X + face : target,
        0,
        gl.RGBA,
        texture.width,
        texture.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        cube ? texture.rgba.subarray(face * faceBytes, (face + 1) * faceBytes) : texture.rgba,
      )
    const wrap = (mode: string | undefined) => (mode === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT)
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, cube ? gl.CLAMP_TO_EDGE : wrap(texture.wrapU))
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, cube ? gl.CLAMP_TO_EDGE : wrap(texture.wrapV))
    if (cube) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    applyTextureFilter(gl, target, texture.filter ?? 'linear')
    uploaded.set(texture.id, handle)
  }
  return uploaded
}

/** The scene's light with a unit direction, or `undefined` for a scene that declared none. */
function normalizedLight(light: SceneRendererDirectionalLight | undefined) {
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

function flipRows(bytes: Uint8Array, width: number, height: number) {
  const stride = width * 4
  const out = new Uint8Array(bytes.byteLength)
  for (let row = 0; row < height; row += 1) {
    out.set(bytes.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride)
  }
  return out
}

/** WebGL2 implementation of the portable scene-renderer contract. */
export async function renderBrowser(request: SceneRenderRequest): Promise<SceneRenderFrame> {
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
  const defaultAlpha = materialAlpha()
  const alphas = new Map(
    (request.scene.materials ?? [])
      .map(bindSimpleEffectTexture)
      .map(material => [material.id, materialAlpha(material)]),
  )
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
  const vertexColor = gl.getAttribLocation(program, 'vertexColor')
  const transform = gl.getUniformLocation(program, 'transform')
  const color = gl.getUniformLocation(program, 'color')
  const uniform = (name: string) => gl.getUniformLocation(program, name)
  const modelUniform = uniform('model')
  const lightColor = uniform('lightColor')
  const lightDirection = uniform('lightDirection')
  const ambient = uniform('ambient')
  const shadedUniform = uniform('shaded')
  const texturedUniform = uniform('textured')
  const hasNormalsUniform = uniform('hasNormals')
  const baseColorMap = uniform('baseColorMap')
  const teamColorMode = uniform('teamColorMode'),
    teamMaskMap = uniform('teamMaskMap'),
    teamMaskChannel = uniform('teamMaskChannel'),
    teamBlend = uniform('teamBlend'),
    teamStrength = uniform('teamStrength'),
    teamColorUniform = uniform('teamColor')
  const coverageMode = uniform('coverageMode')
  const alphaCutoff = uniform('alphaCutoff')
  const screenUvEnabled = uniform('screenUvEnabled'),
    screenUvViewport = uniform('screenUvViewport'),
    screenUvOffset = uniform('screenUvOffset'),
    screenUvTiling = uniform('screenUvTiling'),
    screenUvAngle = uniform('screenUvAngle'),
    screenUvThreshold = uniform('screenUvThreshold')
  if (position < 0 || transform === null || color === null || modelUniform === null) {
    gl.deleteProgram(program)
    throw new TypeError('WebGL renderer uniforms are unavailable')
  }
  const diagnostics: SceneRendererDiagnostic[] = []
  const textures = new Map<string, WebGLTexture>()
  const gameDraws = materialWebGlDraws(gl, textures, { mipmaps: true })
  try {
    uploadTextures(gl, request.scene.textures, diagnostics, textures)
    const materialPrograms = prepareSceneMaterialPrograms(
      request.scene.materials ?? [],
      new Map(
        (request.scene.textures ?? [])
          .filter(texture => textures.has(texture.id))
          .map(texture => [texture.id, texture]),
      ),
      request.scene.materialContext,
      diagnostics,
      request.signal,
    )
    const cubeIds = new Set(
      (request.scene.textures ?? [])
        .filter(texture => texture.dimension === 'cube')
        .map(texture => texture.id),
    )
    const sceneTextures = new Map(
      (request.scene.textures ?? []).map(texture => [texture.id, texture] as const),
    )
    const materials = new Map(
      (request.scene.materials ?? [])
        .map(bindSimpleEffectTexture)
        .map(material => {
          let team = drawTeamColor(material, request.scene.materialContext)
          const mask = teamMaskTexture(team, sceneTextures)
          if (team?.maskTexture !== undefined && (mask === undefined || !textures.has(mask.id))) {
            diagnostics.push({
              severity: 'warning',
              code: 'common.scene/team-color-mask-missing',
              message: `material ${material.id} names team colour mask ${team.maskTexture}, which the scene did not carry as a 2D texture`,
            })
            team = undefined
          }
          return [material.id, team, mask, material] as const
        })
        .map(([id, team, mask, material]) => [
          id,
          Object.freeze({
            team,
            teamMask: team === undefined || mask === undefined ? undefined : mask,
            pbr: drawPbr(material, sceneTextures, diagnostics),
            baseColor: material.baseColor,
            simpleEffect: readSimpleEffect(material.simpleEffect),
            sourceTexture: (request.scene.textures ?? []).find(
              texture => texture.id === material.baseColorTexture,
            ),
            shading: material.shading ?? 'unlit',
            texture:
              material.baseColorTexture === undefined || cubeIds.has(material.baseColorTexture)
                ? undefined
                : textures.get(material.baseColorTexture),
          }),
        ]),
    )
    for (const material of (request.scene.materials ?? []).map(bindSimpleEffectTexture)) {
      if (material.baseColorTexture !== undefined && cubeIds.has(material.baseColorTexture))
        diagnostics.push({
          severity: 'warning',
          code: 'common.scene/base-color-texture-dimension',
          message: `Material ${material.id}: base-color UV sampling requires a 2D texture.`,
        })
      if (material.baseColorTexture !== undefined && !textures.has(material.baseColorTexture)) {
        diagnostics.push({
          severity: 'warning',
          code: 'modkit.browser-webgl/texture-missing',
          message: `material ${material.id} names texture ${material.baseColorTexture}, which the scene did not carry`,
        })
      }
    }
    const light = normalizedLight(request.scene.light)
    const preview = readPreviewLighting(request.scene.lights, request.scene.ambientLight)
    const clear: SceneRendererColor = request.clearColor ?? [0, 0, 0, 0]
    gl.viewport(0, 0, width, height)
    gl.clearColor(clear[0] * clear[3], clear[1] * clear[3], clear[2] * clear[3], clear[3])
    gl.clearDepth(1)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program)
    bindPreviewLighting(gl, program, preview)
    if (light !== undefined) {
      if (lightColor !== null) gl.uniform4fv(lightColor, light.color)
      if (lightDirection !== null) gl.uniform3fv(lightDirection, light.direction)
      if (ambient !== null) gl.uniform1f(ambient, light.ambient)
    }
    if (baseColorMap !== null) gl.uniform1i(baseColorMap, 0)
    if (teamMaskMap !== null) gl.uniform1i(teamMaskMap, 1)
    const eye = request.camera.eyePosition
    gl.uniform1f(uniform('eyeKnown'), eye === undefined ? 0 : 1)
    if (eye !== undefined) gl.uniform3f(uniform('eyePosition'), eye[0], eye[1], eye[2])
    let triangles = 0
    for (const draw of sceneMaterialDraws(
      request.scene.primitives,
      request.scene.materials ?? [],
      materialPrograms,
      request.camera.viewProjection,
      diagnostics,
      clear[3],
    )) {
      const primitive = draw.primitive
      request.signal?.throwIfAborted()
      applyWebGlDepthBias(gl, primitive.depthBias)
      if (draw.program !== undefined) {
        triangles += gameDraws.draw(draw, request.camera, request.scene.light)
        continue
      }
      gl.useProgram(program)
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
      const vertexColors = readSimpleEffectColors(primitive)
      const vertexCount = primitive.positions.length / 3
      const vertexBuffer = gl.createBuffer()
      if (vertexBuffer === null) throw new TypeError('WebGL could not allocate a vertex buffer')
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, primitive.positions, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0)
      const surface = materials.get(primitive.materialId as string)
      const alpha = alphas.get(primitive.materialId ?? '') ?? defaultAlpha
      const effect = surface?.simpleEffect
      const screenUv = effect?.screenUv
      if (screenUvEnabled !== null) gl.uniform1f(screenUvEnabled, screenUv === undefined ? 0 : 1)
      if (screenUv !== undefined) {
        if (screenUvViewport !== null) gl.uniform2f(screenUvViewport, width, height)
        if (screenUvOffset !== null) gl.uniform2f(screenUvOffset, ...screenUv.offset)
        if (screenUvTiling !== null) gl.uniform2f(screenUvTiling, ...screenUv.tiling)
        if (screenUvAngle !== null) gl.uniform1f(screenUvAngle, screenUv.angle)
        if (screenUvThreshold !== null) gl.uniform1f(screenUvThreshold, screenUv.threshold)
      }
      gl.enable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)
      if (coverageMode !== null)
        gl.uniform1f(coverageMode, alpha.mode === 'opaque' ? 0 : alpha.mode === 'mask' ? 1 : 2)
      if (alphaCutoff !== null) gl.uniform1f(alphaCutoff, alpha.cutoff)
      gl.depthMask(alpha.depthWrite)
      if (alpha.mode === 'blend') {
        gl.enable(gl.BLEND)
        gl.blendEquation(gl.FUNC_ADD)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      } else gl.disable(gl.BLEND)
      if (effect !== undefined) {
        applySimpleEffectState(gl, effect)
        if (coverageMode !== null) gl.uniform1f(coverageMode, simpleEffectSolid(effect) ? 4 : 3)
        if (alphaCutoff !== null)
          gl.uniform1f(alphaCutoff, effect.alphaCutoff > 1 ? 2 : effect.alphaCutoff)
      }
      const colorBuffer =
        vertexColor < 0 || vertexColors === undefined
          ? undefined
          : attributeBuffer(gl, vertexColor, vertexColors, 4)
      if (colorBuffer === undefined && vertexColor >= 0) {
        gl.disableVertexAttribArray(vertexColor)
        gl.vertexAttrib4f(vertexColor, 1, 1, 1, 1)
      }
      const shaded =
        effect === undefined &&
        (light !== undefined || preview !== undefined) &&
        surface?.shading === 'lambert'
      const pbr = effect === undefined && light !== undefined ? surface?.pbr : undefined
      const normalBuffer =
        normal < 0 ||
        (!shaded && pbr === undefined) ||
        !(primitive.normals instanceof Float32Array) ||
        primitive.normals.length < primitive.positions.length
          ? undefined
          : attributeBuffer(gl, normal, primitive.normals, 3)
      const textured = surface?.texture !== undefined
      const team = effect === undefined ? surface?.team : undefined
      const uvBuffer =
        uv < 0 ||
        (!textured &&
          surface?.teamMask === undefined &&
          pbr?.metallicRoughness === undefined &&
          pbr?.occlusion === undefined &&
          pbr?.emissiveTexture === undefined) ||
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
      gl.uniform4fv(color, (surface?.baseColor ?? [0.78, 0.8, 0.84, 1]) as number[])
      gl.uniform4fv(
        gl.getUniformLocation(program, 'instanceTint'),
        primitiveTint(primitive) as number[],
      )
      if (shadedUniform !== null) gl.uniform1f(shadedUniform, shaded ? 1 : 0)
      if (hasNormalsUniform !== null) {
        gl.uniform1f(hasNormalsUniform, normalBuffer === undefined ? 0 : 1)
      }
      const sampling = textured && (uvBuffer !== undefined || screenUv !== undefined)
      if (texturedUniform !== null) gl.uniform1f(texturedUniform, sampling ? 1 : 0)
      if (sampling) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(
          gl.TEXTURE_2D,
          (
            surface as Readonly<{
              baseColor: SceneRendererColor
              shading: SceneRendererShadingModel
              texture: WebGLTexture | undefined
            }>
          ).texture as WebGLTexture,
        )
      }
      if (sampling) {
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_WRAP_S,
          surface?.sourceTexture?.wrapU === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT,
        )
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_WRAP_T,
          surface?.sourceTexture?.wrapV === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT,
        )
      }
      if (sampling && effect !== undefined) {
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_WRAP_S,
          effect.wrapU === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE,
        )
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_WRAP_T,
          effect.wrapV === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE,
        )
      }
      gl.uniform1f(uniform('pbrEnabled'), pbr === undefined ? 0 : 1)
      if (pbr !== undefined) {
        gl.uniform1f(uniform('pbrMetallic'), pbr.metallic)
        gl.uniform1f(uniform('pbrRoughness'), pbr.roughness)
        gl.uniform1f(uniform('pbrOcclusionStrength'), pbr.occlusionStrength)
        gl.uniform3f(uniform('pbrEmissive'), ...pbr.emissive)
        const bindPbr = (
          texture: SceneRendererTexture | undefined,
          flag: string,
          sampler: string,
          unit: number,
        ) => {
          const handle =
            texture === undefined || uvBuffer === undefined ? undefined : textures.get(texture.id)
          gl.uniform1f(uniform(flag), handle === undefined ? 0 : 1)
          if (handle === undefined) return
          gl.activeTexture(gl.TEXTURE0 + unit)
          gl.bindTexture(gl.TEXTURE_2D, handle)
          gl.uniform1i(uniform(sampler), unit)
          gl.activeTexture(gl.TEXTURE0)
        }
        bindPbr(pbr.metallicRoughness, 'pbrMetallicRoughnessTextured', 'pbrMetallicRoughnessMap', 2)
        bindPbr(pbr.occlusion, 'pbrOcclusionTextured', 'pbrOcclusionMap', 3)
        bindPbr(pbr.emissiveTexture, 'pbrEmissiveTextured', 'pbrEmissiveMap', 4)
      }
      const teamMasked = team !== undefined && surface?.teamMask !== undefined
      if (teamColorMode !== null)
        gl.uniform1f(
          teamColorMode,
          team === undefined ? 0 : !teamMasked ? 1 : uvBuffer === undefined ? 0 : 2,
        )
      if (team !== undefined) {
        if (teamBlend !== null) gl.uniform1f(teamBlend, team.blendIndex)
        if (teamStrength !== null) gl.uniform1f(teamStrength, team.strength)
        if (teamColorUniform !== null) gl.uniform3f(teamColorUniform, ...team.color)
        if (teamMaskChannel !== null)
          gl.uniform1f(teamMaskChannel, team.channel === 'rgb' ? 4 : team.channel)
        if (teamMasked) {
          const mask = surface.teamMask!
          gl.activeTexture(gl.TEXTURE1)
          gl.bindTexture(gl.TEXTURE_2D, textures.get(mask.id)!)
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_WRAP_S,
            mask.wrapU === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT,
          )
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_WRAP_T,
            mask.wrapV === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT,
          )
          gl.activeTexture(gl.TEXTURE0)
        }
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
      triangles +=
        primitive.topology === 'triangles' ? Math.floor(count / 3) : Math.max(0, count - 2)
      gl.deleteBuffer(indexBuffer as WebGLBuffer | null)
      gl.deleteBuffer(colorBuffer as WebGLBuffer | null)
      gl.deleteBuffer(normalBuffer as WebGLBuffer | null)
      gl.deleteBuffer(uvBuffer as WebGLBuffer | null)
      gl.deleteBuffer(vertexBuffer)
    }
    const bottomUp = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp)
    const rgba = flipRows(bottomUp, width, height)
    straightenAlpha(rgba)
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
  } finally {
    gameDraws.release()
    for (const texture of textures.values()) gl.deleteTexture(texture)
    gl.deleteProgram(program)
  }
}

export const abiVersion = 1
export const provides = Object.freeze([SCENE_RENDERER_CONTRACT] as const)

export function createProvider(selection: { readonly contract: string; readonly major: number }): {
  readonly value: SceneRenderer
  release(): Promise<void>
} {
  if (selection.contract !== SCENE_RENDERER_CONTRACT || selection.major !== 1) {
    throw new TypeError(`unsupported renderer selection ${selection.contract}@${selection.major}`)
  }
  return Object.freeze({
    value: Object.freeze({
      contract: SCENE_RENDERER_CONTRACT,
      rendererId: RENDERER_ID,
      outputKinds: Object.freeze(['rgba8'] as const),
      render: renderBrowser,
    }),
    release: async () => undefined,
  })
}
import { primitiveTint } from './tint.js'
