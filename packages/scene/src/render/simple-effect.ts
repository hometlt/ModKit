import type { SceneRendererMaterial, SceneRendererSimpleEffect } from '@modkit/sdk/renderer'
import type { StandardMaterialProgram } from '../materials/index.js'

/** Unlit texel-times-RGBA pass. Blend names describe equations, not native material types. */
export type SimpleEffectState = SceneRendererSimpleEffect
export function readSimpleEffect(
  value: SimpleEffectState | undefined,
): SimpleEffectState | undefined {
  if (value === undefined) return undefined
  if (
    ![
      'opaque',
      'alpha-test',
      'blend',
      'premultiplied',
      'additive',
      'additive-one-one',
      'add-alpha',
      'modulate',
      'modulate2x',
    ].includes(value.blend) ||
    ![value.depthTest, value.depthWrite, value.doubleSided].every(v => typeof v === 'boolean') ||
    !Number.isFinite(value.alphaCutoff) ||
    value.alphaCutoff < 0 ||
    ![value.wrapU, value.wrapV].every(v => v === 'repeat' || v === 'clamp') ||
    (value.textureResource !== undefined &&
      (typeof value.textureResource !== 'string' || value.textureResource.length === 0))
  )
    throw new TypeError('invalid simple effect state')
  return {
    ...value,
    ...(value.screenUv === undefined ? {} : { screenUv: readScreenEffectUv(value.screenUv) }),
  }
}

function readScreenEffectUv(
  value: NonNullable<SceneRendererSimpleEffect['screenUv']>,
): NonNullable<SceneRendererSimpleEffect['screenUv']> {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray(value.offset) ||
    value.offset.length !== 2 ||
    !Array.isArray(value.tiling) ||
    value.tiling.length !== 2 ||
    ![...value.offset, ...value.tiling, value.angle, value.threshold].every(
      v => typeof v === 'number' && Number.isFinite(Math.fround(v)),
    ) ||
    value.threshold < 0
  )
    throw new TypeError('invalid simple effect screen UV')
  for (const axis of [0, 1] as const)
    if (
      !Number.isFinite(Math.fround(Math.abs(value.offset[axis]) + 2 * Math.abs(value.tiling[axis])))
    )
      throw new RangeError('screen UV transform exceeds float32')
  return {
    offset: [Math.fround(value.offset[0]), Math.fround(value.offset[1])],
    tiling: [Math.fround(value.tiling[0]), Math.fround(value.tiling[1])],
    angle: Math.fround(value.angle),
    threshold: Math.fround(value.threshold),
  }
}

/** Pinned live-effect fragment equation, independent of native metadata and camera projection. */
export function sampleScreenEffectUv(
  value: NonNullable<SceneRendererSimpleEffect['screenUv']>,
  x: number,
  y: number,
  width: number,
  height: number,
): readonly [number, number] | undefined {
  if (value.threshold > 0 && Math.max(width, height) < value.threshold) return undefined
  const centeredX = x / Math.max(1, width) - 0.5,
    centeredY = y / Math.max(1, height) - 0.5
  const cosine = Math.cos(value.angle),
    sine = Math.sin(value.angle)
  return [
    Math.fround((cosine * centeredX + sine * centeredY + 0.5) * value.tiling[0] + value.offset[0]),
    Math.fround((-sine * centeredX + cosine * centeredY + 0.5) * value.tiling[1] + value.offset[1]),
  ]
}
export const simpleEffectSolid = (state: SimpleEffectState) =>
  state.blend === 'opaque' || state.blend === 'alpha-test'
export function bindSimpleEffectTexture<
  T extends SceneRendererMaterial & { readonly simpleEffect?: SimpleEffectState },
>(material: T): T {
  const state = readSimpleEffect(material.simpleEffect)
  if (state === undefined || state.textureResource === undefined) return material
  const binding = material.textureBindings?.find(item => item.resourceId === state.textureResource)
  return binding === undefined ? material : { ...material, baseColorTexture: binding.textureId }
}
export function applySimpleEffectState(gl: WebGL2RenderingContext, state: SimpleEffectState): void {
  if (state.depthTest) gl.enable(gl.DEPTH_TEST)
  else gl.disable(gl.DEPTH_TEST)
  gl.depthMask(state.depthWrite)
  if (state.doubleSided) gl.disable(gl.CULL_FACE)
  else gl.enable(gl.CULL_FACE)
  gl.blendEquation(gl.FUNC_ADD)
  if (simpleEffectSolid(state)) {
    gl.disable(gl.BLEND)
    return
  }
  gl.enable(gl.BLEND)
  switch (state.blend) {
    case 'blend':
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      break
    case 'premultiplied':
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      break
    case 'additive':
      gl.blendFuncSeparate(gl.SRC_COLOR, gl.ONE, gl.ZERO, gl.ONE)
      break
    case 'additive-one-one':
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
/** RGBA8 accumulation follows the common renderer's premultiplied target contract. */
export function blendSimpleEffectPixel(
  frame: Uint8Array | Float32Array,
  offset: number,
  rgba: readonly [number, number, number, number],
  state: SimpleEffectState,
): void {
  if (state.blend === 'additive-one-one') {
    blendMaterialPixel(frame, offset, rgba, { blend: 'additive' })
    return
  }
  const clamp = (v: number) => Math.max(0, Math.min(1, v)),
    a = clamp(rgba[3]),
    solid = simpleEffectSolid(state)
  for (let channel = 0; channel < 3; channel++) {
    const source = frame instanceof Float32Array ? Math.max(0, rgba[channel] ?? 0) : clamp(rgba[channel] ?? 0),
      destination = (frame[offset + channel] ?? 0) / 255
    const value = solid
      ? source * a
      : state.blend === 'blend'
        ? source * a + destination * (1 - a)
        : state.blend === 'premultiplied'
          ? source + destination * (1 - a)
        : state.blend === 'additive'
          ? source * source + destination
          : state.blend === 'add-alpha'
            ? source * a + destination
            : state.blend === 'modulate'
              ? source * destination
              : 2 * source * destination
    frame[offset + channel] = frame instanceof Float32Array ? value * 255 : Math.round(clamp(value) * 255)
  }
  if (solid) frame[offset + 3] = Math.round(a * 255)
  else if (state.blend === 'blend' || state.blend === 'premultiplied')
    frame[offset + 3] = Math.round(clamp(a + ((frame[offset + 3] ?? 0) / 255) * (1 - a)) * 255)
}

export const materialIsSolid = (program: Pick<StandardMaterialProgram, 'blend'>) =>
  program.blend === 'opaque' || program.blend === 'alpha-test'

/** RGBA8 target blend equations match WebGL's normalized framebuffer, including destination alpha. */
export function blendMaterialPixel(
  frame: Uint8Array | Float32Array,
  offset: number,
  rgba: readonly [number, number, number, number],
  program: Pick<StandardMaterialProgram, 'blend'>,
  /** The primitive's fade (primitiveFade): a solid pass below 1 is blended by it. */
  fade = 1,
): void {
  const fading = fade < 1 && materialIsSolid(program)
  const clamp = (value: number) => Math.max(0, Math.min(1, value)),
    a = clamp(fading ? fade : rgba[3]),
    mode = fading ? 'blend' : program.blend
  for (let channel = 0; channel < 3; channel++) {
    const source = frame instanceof Float32Array ? Math.max(0, rgba[channel] ?? 0) : clamp(rgba[channel] ?? 0),
      dest = (frame[offset + channel] ?? 0) / 255
    const value =
      mode === 'blend'
        ? source * a + dest * (1 - a)
        : mode === 'premultiplied'
          ? source + dest * (1 - a)
          : mode === 'additive'
            ? source + dest
            : mode === 'add-alpha'
              ? source * a + dest
              : mode === 'modulate'
                ? source * dest
                : mode === 'modulate2x'
                  ? 2 * source * dest
                  : source
    frame[offset + channel] = frame instanceof Float32Array ? value * 255 : Math.round(clamp(value) * 255)
  }
  // A solid pass covers the pixel whole (an alpha-tested fragment that survived is opaque).
  if (materialIsSolid(program) && !fading) frame[offset + 3] = 255
  else if (mode === 'blend' || mode === 'premultiplied')
    frame[offset + 3] = Math.round((a + ((frame[offset + 3] ?? 0) / 255) * (1 - a)) * 255)
}
