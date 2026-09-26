import type {
  SceneRendererPrimitive,
  SceneRendererMaterial,
  SceneRendererDiagnostic,
} from '@modkit/sdk/renderer'
import type { StandardMaterialProgram } from '../materials/index.js'
import type { SceneMaterialPrograms } from './materials.js'
import { alphaDrawOrder, materialAlpha } from './alpha.js'
import { prepareMaterialGeometry } from './material-geometry.js'

export interface MaterialDraw {
  readonly primitive: SceneRendererPrimitive
  readonly material?: SceneMaterialPrograms
  readonly program?: StandardMaterialProgram
  readonly depthOnly?: boolean
}
export const materialIsSolid = (program: StandardMaterialProgram) =>
  program.blend === 'opaque' || program.blend === 'alpha-test'

type PreparedGeometry = Readonly<{
  primitive: SceneRendererPrimitive
  bytes: number
  diagnostics: readonly SceneRendererDiagnostic[]
}>

/**
 * Validation, normal expansion and tangent generation depend only on the immutable source primitive
 * and the UV choice, so retained renderers reuse them across frames instead of repeating them per draw.
 */
const preparedGeometry = new WeakMap<
  ArrayBufferView,
  Map<number | undefined, PreparedGeometry & { readonly source: SceneRendererPrimitive }>
>()

/** Placed instances of one model are distinct primitive objects over the same vertex arrays. */
function sameGeometry(left: SceneRendererPrimitive, right: SceneRendererPrimitive) {
  const sets = (primitive: SceneRendererPrimitive) => primitive.textureCoordinateSets ?? []
  return (
    left.topology === right.topology &&
    left.positions === right.positions &&
    left.indices === right.indices &&
    left.normals === right.normals &&
    left.tangents === right.tangents &&
    left.colors === right.colors &&
    left.textureCoordinates === right.textureCoordinates &&
    sets(left).length === sets(right).length &&
    sets(left).every(
      (set, index) =>
        set.set === sets(right)[index]?.set && set.coordinates === sets(right)[index]?.coordinates,
    )
  )
}

/** The cached vertex arrays with this instance's identity, transform, material and tint. */
function rebindPrepared(
  prepared: SceneRendererPrimitive,
  cachedSource: SceneRendererPrimitive,
  source: SceneRendererPrimitive,
): SceneRendererPrimitive {
  if (prepared === cachedSource) return source
  const { indices, ...instance } = source
  void indices
  return {
    ...instance,
    topology: prepared.topology,
    positions: prepared.positions,
    ...(prepared.normals === undefined ? {} : { normals: prepared.normals }),
    ...(prepared.tangents === undefined ? {} : { tangents: prepared.tangents }),
    ...(prepared.colors === undefined ? {} : { colors: prepared.colors }),
    ...(prepared.textureCoordinates === undefined
      ? {}
      : { textureCoordinates: prepared.textureCoordinates }),
    ...(prepared.textureCoordinateSets === undefined
      ? {}
      : { textureCoordinateSets: prepared.textureCoordinateSets }),
  }
}

function preparedMaterialGeometry(
  source: SceneRendererPrimitive,
  texCoord: number | undefined,
  maxBytes: number,
  diagnostics: SceneRendererDiagnostic[],
): PreparedGeometry {
  // Keyed by vertex arrays, not the primitive object: a map places the same model thousands of
  // times, and per-instance tangent generation and GPU uploads made the first frame take minutes.
  const cached = preparedGeometry.get(source.positions)?.get(texCoord)
  if (cached !== undefined && cached.bytes <= maxBytes && sameGeometry(cached.source, source)) {
    diagnostics.push(...cached.diagnostics)
    return { ...cached, primitive: rebindPrepared(cached.primitive, cached.source, source) }
  }
  const emitted: SceneRendererDiagnostic[] = []
  const primitive = prepareMaterialGeometry(source, maxBytes, {
    ...(texCoord === undefined ? {} : { texCoord }),
    diagnostics: emitted,
  })
  diagnostics.push(...emitted)
  const buffers = new Set<ArrayBufferLike>()
  let bytes = 0
  if (primitive !== source)
    for (const buffer of [
      primitive.positions,
      primitive.normals,
      primitive.tangents,
      primitive.colors,
      primitive.textureCoordinates,
      ...(primitive.textureCoordinateSets ?? []).map(set => set.coordinates),
    ])
      if (buffer !== undefined && !buffers.has(buffer.buffer)) {
        buffers.add(buffer.buffer)
        bytes += buffer.byteLength
      }
  const result = Object.freeze({ primitive, bytes, diagnostics: Object.freeze(emitted) })
  const choices =
    preparedGeometry.get(source.positions) ??
    new Map<number | undefined, PreparedGeometry & { readonly source: SceneRendererPrimitive }>()
  choices.set(texCoord, Object.freeze({ ...result, source }))
  preparedGeometry.set(source.positions, choices)
  return result
}

/** One draw schedule for both providers, including composite passes and requested depth prepasses. */
export function sceneMaterialDraws(
  primitives: readonly SceneRendererPrimitive[],
  materials: readonly SceneRendererMaterial[],
  programs: ReadonlyMap<string, SceneMaterialPrograms>,
  viewProjection: Float32Array,
  diagnostics: SceneRendererDiagnostic[],
  clearAlpha: number,
  maxGeometryBytes = 256 * 1024 * 1024,
): readonly MaterialDraw[] {
  if (!Number.isSafeInteger(maxGeometryBytes) || maxGeometryBytes < 0)
    throw new TypeError('invalid material geometry byte budget')
  const prepasses: MaterialDraw[] = [],
    entries = new Map<SceneRendererPrimitive, MaterialDraw>()
  const alphas = new Map(materials.map(material => [material.id, materialAlpha(material)]))
  const prepared = new Map<
    SceneRendererPrimitive,
    Map<number | undefined, SceneRendererPrimitive>
  >()
  const preparedBuffers = new Set<ArrayBufferLike>()
  let remaining = maxGeometryBytes
  const prepare = (source: SceneRendererPrimitive, program: StandardMaterialProgram) => {
    // Authored tangents win even when normals need expansion. Explicit UV0 stays distinct from
    // omission because only the explicit choice requires that UV set and emits fallback warnings.
    const texCoord = source.tangents === undefined ? program.tangentGeneration?.texCoord : undefined
    let choices = prepared.get(source)
    const cached = choices?.get(texCoord)
    if (cached !== undefined) return cached
    const { primitive } = preparedMaterialGeometry(source, texCoord, remaining, diagnostics)
    if (primitive !== source)
      for (const buffer of [
        primitive.positions,
        primitive.normals,
        primitive.tangents,
        primitive.colors,
        primitive.textureCoordinates,
        ...(primitive.textureCoordinateSets ?? []).map(set => set.coordinates),
      ])
        if (buffer !== undefined && !preparedBuffers.has(buffer.buffer)) {
          preparedBuffers.add(buffer.buffer)
          remaining -= buffer.byteLength
        }
    if (choices === undefined) {
      choices = new Map()
      prepared.set(source, choices)
    }
    choices.set(texCoord, primitive)
    return primitive
  }
  let emissionWarning = false
  for (const source of primitives) {
    const material = programs.get(source.materialId ?? '')
    if (material === undefined) {
      entries.set(source, { primitive: source })
      continue
    }
    for (const pass of material.passes)
      for (const layer of pass.defines.layers) {
        const set =
          layer.uvSource === 0 || layer.uvSource === 6
            ? 0
            : layer.uvSource === 1
              ? 1
              : layer.uvSource === 9
                ? 2
                : layer.uvSource === 10
                  ? 3
                  : undefined
        if (
          layer.hasTexture &&
          set !== undefined &&
          !source.textureCoordinateSets?.some(uv => uv.set === set) &&
          !(set === 0 && source.textureCoordinates !== undefined)
        )
          throw new TypeError(`primitive ${source.id} lacks TEXCOORD_${set}`)
      }
    for (const program of material.passes) {
      const primitive = prepare(source, program)
      const key = { ...primitive }
      entries.set(key, { primitive, material, program })
      if (program.depthPrepass) prepasses.push({ primitive, material, program, depthOnly: true })
      if (clearAlpha !== 1 && !materialIsSolid(program) && program.blend !== 'blend')
        emissionWarning = true
    }
  }
  if (emissionWarning)
    diagnostics.push({
      severity: 'warning',
      code: 'common.scene/material-background-alpha',
      message:
        'Additive and modulate passes preserve destination alpha. A transparent RGBA export cannot retain emission over zero alpha; use an opaque background for these passes.',
    })
  const alpha = (primitive: SceneRendererPrimitive) => {
    const program = entries.get(primitive)?.program
    return program === undefined
      ? (alphas.get(primitive.materialId ?? '') ?? materialAlpha())
      : { mode: materialIsSolid(program) ? ('opaque' as const) : ('blend' as const), cutoff: 0 }
  }
  // Unique scheduling ids allow the existing stable depth sort to retain composite pass identity.
  const keys = [...entries.keys()].map((primitive, index) => ({
    ...primitive,
    materialId: String(index),
  }))
  const originals = [...entries.keys()]
  const ordered = alphaDrawOrder(
    keys,
    id => {
      const p = originals[Number(id)]
      return p === undefined ? materialAlpha() : alpha(p)
    },
    viewProjection,
  )
  const draws = ordered.map(key => {
    const original = originals[Number(key.materialId)],
      entry = original === undefined ? undefined : entries.get(original)
    if (entry === undefined) throw new TypeError('invalid material draw')
    return entry
  })
  draws.sort((a, b) => {
    const solid = (draw: MaterialDraw) =>
      draw.program === undefined
        ? (alphas.get(draw.primitive.materialId ?? '')?.mode ?? 'opaque') !== 'blend'
        : materialIsSolid(draw.program)
    return (
      Number(solid(b)) - Number(solid(a)) ||
      (solid(a) ? 0 : (a.program?.priority ?? 0) - (b.program?.priority ?? 0))
    )
  })
  return [...prepasses, ...draws]
}

/** RGBA8 target blend equations match WebGL's normalized framebuffer, including destination alpha. */
export function blendMaterialPixel(
  frame: Uint8Array,
  offset: number,
  rgba: readonly [number, number, number, number],
  program: StandardMaterialProgram,
): void {
  const clamp = (value: number) => Math.max(0, Math.min(1, value)),
    a = clamp(rgba[3]),
    mode = program.blend
  for (let channel = 0; channel < 3; channel++) {
    const source = clamp(rgba[channel] ?? 0),
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
    frame[offset + channel] = Math.round(clamp(value) * 255)
  }
  // A solid pass covers the pixel whole (an alpha-tested fragment that survived is opaque).
  if (materialIsSolid(program)) frame[offset + 3] = 255
  else if (mode === 'blend' || mode === 'premultiplied')
    frame[offset + 3] = Math.round((a + ((frame[offset + 3] ?? 0) / 255) * (1 - a)) * 255)
}
