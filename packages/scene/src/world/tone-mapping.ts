import type { WorldToneMapping } from '@modkit/sdk/maps'
import { uniformLocation } from '../materials/webgl.js'
import { Matrix4 } from 'three'
import { createWorldColorLut } from './colorization.js'

/** SC2 HDR.fx/PSTonemap.fx luminance weights and extended Reinhard operator. */
export function toneMapWorldColor(color: readonly number[], settings: WorldToneMapping): number[] {
  const luminance = color[0]! * 0.35 + color[1]! * 0.5 + color[2]! * 0.125
  if (luminance <= 1e-6) return [0, 0, 0]
  const exposed = Math.pow(luminance, settings.contrast) * settings.exposure
  const mapped = settings.operator === 'exponential' ? 1 - Math.exp(-exposed)
    : settings.operator === 'logarithmic' ? Math.log(Math.pow(luminance, settings.contrast) + 1) / Math.log(settings.exposure + 1)
    : settings.operator === 'linear' ? Math.pow(luminance, settings.contrast)
    : settings.operator === 'filmic' ? (() => { const x = Math.pow(luminance, 2.2) * settings.exposure; return x * (12.3 * x + 0.5) / (x * (12.3 * x + 4) + 0.02) })()
    : (exposed * (1 + exposed / settings.whitePoint ** 2)) / (1 + exposed)
  return color.slice(0, 3).map(value => (value * mapped) / luminance)
}

/** One retained full-scene HDR target, so alpha/additive draws blend BEFORE tone mapping. */
export function createWorldToneMapper(gl: WebGL2RenderingContext) {
  if (!gl.getExtension('EXT_color_buffer_float')) return undefined
  const shader = (type: number, source: string) => {
    const value = gl.createShader(type)!
    gl.shaderSource(value, source)
    gl.compileShader(value)
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(value)
      gl.deleteShader(value)
      throw new Error(`world tone mapping shader: ${message}`)
    }
    return value
  }
  const vertex = shader(
    gl.VERTEX_SHADER,
    `#version 300 es
    precision highp float;
    out vec2 uv;
    void main() {
      uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    }`,
  )
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision highp float;
    precision highp sampler3D;
    in vec2 uv;
    uniform sampler2D image;
    uniform sampler2D depthMap;
    uniform sampler3D colorMap;
    uniform vec3 mapping;
    uniform int operatorId;
    uniform bool colorizationEnabled;
    uniform bool correctGamma;
    uniform vec4 aoSettings;
    uniform vec2 pixelSize;
    uniform mat4 inverseViewProjection;
    uniform mat4 viewProjection;
    out vec4 outColor;
    vec3 positionAt(vec2 coord) {
      // NEAREST depth belongs to a texel centre, not the continuous kernel coordinate.
      // Reconstructing from different coordinates invents blockers on sloped planar triangles.
      coord = clamp((floor(coord / pixelSize) + 0.5) * pixelSize, pixelSize * 0.5, vec2(1.0) - pixelSize * 0.5);
      vec4 p = inverseViewProjection * vec4(coord * 2.0 - 1.0, texture(depthMap, coord).r * 2.0 - 1.0, 1.0);
      return p.xyz / p.w;
    }
    vec3 surfaceNormal(vec2 coord, vec3 p) {
      // Average both sides across a continuous surface so the two triangles of a terrain ramp use
      // one smooth normal. At a real depth break, keep the derivative on the nearer side instead of
      // pulling the background or an adjacent object into the normal.
      vec2 x = vec2(pixelSize.x, 0.0), y = vec2(0.0, pixelSize.y);
      vec3 left = positionAt(coord - x), right = positionAt(coord + x);
      vec3 down = positionAt(coord - y), up = positionAt(coord + y);
      vec4 gap = vec4(length(p - left), length(right - p), length(p - down), length(up - p));
      vec3 dx = max(gap.x, gap.y) <= max(min(gap.x, gap.y) * 4.0, 0.01)
        ? right - left : (gap.x < gap.y ? p - left : right - p);
      vec3 dy = max(gap.z, gap.w) <= max(min(gap.z, gap.w) * 4.0, 0.01)
        ? up - down : (gap.z < gap.w ? p - down : up - p);
      vec3 n = cross(dx, dy);
      return n / max(length(n), 0.000001);
    }
    // Bounded screen-space approximation. Native SC2's 64-sample blocker LUT kernel is not recovered.
    float occlusion() {
      if (aoSettings.x <= 0.0 || texture(depthMap, uv).r >= 0.999999) return 1.0;
      vec3 p = positionAt(uv);
      vec3 n = surfaceNormal(uv, p);
      vec4 projected = viewProjection * vec4(p, 1.0);
      float scaleX = length(vec3(viewProjection[0][0], viewProjection[1][0], viewProjection[2][0]));
      float scaleY = length(vec3(viewProjection[0][1], viewProjection[1][1], viewProjection[2][1]));
      vec2 radius = aoSettings.x * vec2(scaleX, scaleY) / (2.0 * max(abs(projected.w), 0.000001));
      if (max(radius.x / pixelSize.x, radius.y / pixelSize.y) < 1.0) return 1.0;
      float blocked = 0.0;
      for (int i = 0; i < 12; i++) {
        float angle = float(i) * 2.39996323;
        vec2 coord = uv + vec2(cos(angle), sin(angle)) * radius * sqrt((float(i) + 0.5) / 12.0);
        if (any(lessThan(coord, vec2(0.0))) || any(greaterThan(coord, vec2(1.0))) || texture(depthMap, coord).r >= 0.999999) continue;
        vec3 delta = positionAt(coord) - p;
        float distance = length(delta);
        float signedHeight = dot(n, delta);
        float tangentDistance = length(delta - n * signedHeight);
        // Adjacent terrain triangles form a visually smooth ramp even when their reconstructed
        // planes differ slightly. Ignore that shallow crease instead of drawing the shared edge
        // as an AO blocker; real contact geometry remains above this angular bias.
        float above = max(signedHeight - max(0.005, tangentDistance * 0.25), 0.0);
        float blocker = clamp((above / max(distance, 0.000001) - aoSettings.z) / max(aoSettings.y - aoSettings.z, 0.000001), 0.0, 1.0);
        blocked += blocker * (1.0 - smoothstep(aoSettings.x * 0.5, aoSettings.x, distance));
      }
      return pow(clamp(1.0 - blocked / 12.0, 0.0, 1.0), max(aoSettings.w, 0.0));
    }
    void main() {
      vec3 color = max(texture(image, uv).rgb, vec3(0.0)) * occlusion();
      float luminance = dot(color, vec3(0.35, 0.5, 0.125));
      float exposed = pow(luminance, mapping.z) * mapping.x;
      float mapped = exposed * (1.0 + exposed / (mapping.y * mapping.y)) / (1.0 + exposed);
      if (operatorId == 1) mapped = 1.0 - exp(-exposed);
      if (operatorId == 2) mapped = log(pow(luminance, mapping.z) + 1.0) / log(mapping.x + 1.0);
      if (operatorId == 3) mapped = pow(luminance, mapping.z);
      if (operatorId == 4) { float x = pow(luminance, 2.2) * mapping.x; mapped = x * (12.3 * x + 0.5) / (x * (12.3 * x + 4.0) + 0.02); }
      color *= mapped / max(luminance, 0.000001);
      if (colorizationEnabled) color = texture(colorMap, (clamp(color, 0.0, 1.0) * 15.0 + 0.5) / 16.0).rgb;
      if (correctGamma) color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
      outColor = vec4(color, 1.0);
    }`,
  )
  const program = gl.createProgram()!
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`world tone mapping program: ${message}`)
  }
  const framebuffer = gl.createFramebuffer()!,
    texture = gl.createTexture()!
  const depth = gl.createTexture()!, lut = gl.createTexture()!,
    vao = gl.createVertexArray()!
  let width = 0,
    height = 0
  let lutKey: string | undefined
  const identity = new Matrix4()
  // A copy of the scene depth for passes that read it while this target keeps testing against its
  // own: WebGL refuses to sample a texture attached to the framebuffer being drawn.
  let depthCopy: WebGLTexture | undefined
  let depthCopyFramebuffer: WebGLFramebuffer | undefined
  let depthCopyWidth = 0,
    depthCopyHeight = 0
  return {
    bytes: () =>
      width * height * 12 +
      depthCopyWidth * depthCopyHeight * 4 +
      (lutKey === undefined ? 0 : 16 ** 3 * 4),
    /** The depth drawn so far into this target, copied; the target stays bound for drawing. */
    sceneDepth(): WebGLTexture {
      if (depthCopy === undefined || depthCopyFramebuffer === undefined) {
        depthCopy = gl.createTexture()!
        depthCopyFramebuffer = gl.createFramebuffer()!
      }
      if (depthCopyWidth !== width || depthCopyHeight !== height) {
        gl.bindTexture(gl.TEXTURE_2D, depthCopy)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.bindFramebuffer(gl.FRAMEBUFFER, depthCopyFramebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthCopy, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error('world scene depth copy framebuffer is incomplete')
        depthCopyWidth = width
        depthCopyHeight = height
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, depthCopyFramebuffer)
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      return depthCopy
    },
    begin(w: number, h: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      if (w !== width || h !== height) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        gl.bindTexture(gl.TEXTURE_2D, depth)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error('world HDR framebuffer is incomplete')
        width = w
        height = h
      }
    },
    finish(settings: WorldToneMapping, viewProjection?: Float32Array) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)
      gl.disable(gl.CULL_FACE)
      gl.useProgram(program)
      gl.bindVertexArray(vao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(uniformLocation(gl, program, 'image'), 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, depth)
      gl.uniform1i(uniformLocation(gl, program, 'depthMap'), 1)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_3D, lut)
      const key = JSON.stringify(settings.colorization ?? null)
      if (key !== lutKey) {
        const neutral = { inputLow: 0, inputHigh: 1, inputGamma: 1, outputLow: 0, outputHigh: 1, brightness: 1, contrast: 1, hue: 0, saturation: 0, lightness: 0, blend: 0 }
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 16, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, createWorldColorLut(settings.colorization ?? neutral))
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE)
        lutKey = key
      }
      gl.uniform1i(uniformLocation(gl, program, 'colorMap'), 2)
      gl.uniform1i(uniformLocation(gl, program, 'colorizationEnabled'), settings.colorization === undefined ? 0 : 1)
      gl.uniform1i(uniformLocation(gl, program, 'correctGamma'), settings.correctGamma === true ? 1 : 0)
      gl.uniform1i(uniformLocation(gl, program, 'operatorId'), ['reinhard', 'exponential', 'logarithmic', 'linear', 'filmic'].indexOf(settings.operator))
      const ao = settings.ambientOcclusion
      gl.uniform4f(uniformLocation(gl, program, 'aoSettings'), viewProjection === undefined ? 0 : ao?.radius ?? 0, ao?.noOcclusion ?? 0.6, ao?.fullOcclusion ?? 0.05, ao?.power ?? 2)
      gl.uniform2f(uniformLocation(gl, program, 'pixelSize'), 1 / width, 1 / height)
      const matrix = viewProjection === undefined ? identity : new Matrix4().fromArray(viewProjection)
      gl.uniformMatrix4fv(uniformLocation(gl, program, 'viewProjection'), false, matrix.elements)
      gl.uniformMatrix4fv(uniformLocation(gl, program, 'inverseViewProjection'), false, matrix.clone().invert().elements)
      gl.uniform3f(
        uniformLocation(gl, program, 'mapping'),
        settings.exposure,
        settings.whitePoint,
        settings.contrast,
      )
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(null)
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer)
      gl.deleteTexture(texture)
      gl.deleteTexture(depth)
      if (depthCopyFramebuffer !== undefined) gl.deleteFramebuffer(depthCopyFramebuffer)
      if (depthCopy !== undefined) gl.deleteTexture(depthCopy)
      gl.deleteTexture(lut)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
    },
  }
}
