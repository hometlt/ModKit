import type {
  RenderRibbonEmitter,
  RenderEffectSequenceTracks,
  RenderScalarAnimationTrack,
} from '@modkit/codec-kit/legacy/models'
import {
  effectRibbonRingVertexCount,
  writeEffectRibbonRingPositions,
  effectVariationValue,
  sampleEffectSequenceScalar,
  sampleEffectSequenceVector,
  type EffectRibbonState,
} from '@modkit/codec-kit/model-math/effects-sim'

type Vec3 = readonly [number, number, number]
type Color = readonly [number, number, number, number]
const finite = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value))
    throw new TypeError('invalid live ribbon scalar')
  return value
}
const clamp = (v: number) => Math.max(0, Math.min(1, v))
function curve(values: readonly number[], phase: number, middle: number) {
  const split = clamp(middle),
    left = phase < split ? 0 : 1,
    t =
      phase < split
        ? split > 0
          ? phase / split
          : 0
        : split < 1
          ? (phase - split) / (1 - split)
          : 1
  const a = finite(values[left]),
    b = finite(values[left + 1])
  return a + (b - a) * t
}
function tracks(emitter: RenderRibbonEmitter, key: string): RenderEffectSequenceTracks | undefined {
  return (
    emitter.sequenceAnimation as
      Readonly<Record<string, RenderEffectSequenceTracks | undefined>> | undefined
  )?.[key]
}
function scalar(
  emitter: RenderRibbonEmitter,
  key: string,
  sequence: number | null,
  time: number,
  fallback: number,
) {
  const legacy = (
    emitter.animation as
      Readonly<Record<string, RenderScalarAnimationTrack | undefined>> | undefined
  )?.[key]
  return sampleEffectSequenceScalar(tracks(emitter, key), legacy, sequence, time, fallback)
}
function vector(
  emitter: RenderRibbonEmitter,
  key: string,
  sequence: number | null,
  time: number,
  fallback: Vec3,
): Vec3 {
  const value = sampleEffectSequenceVector(tracks(emitter, key), sequence, time, fallback)
  return [finite(value[0]), finite(value[1]), finite(value[2])]
}
export interface UvmRibbonGeometry {
  readonly emitter: number
  readonly positions: Float32Array
  readonly colors: Float32Array
  readonly textureCoordinates: Float32Array
  readonly indices: Uint32Array
}
/** Pinned raw WebGL ring presentation: appendLiveRibbonIndices/writeLiveRibbonFrame and
 * ribbonPreviewColor/Width, commit 1a14ba4eddd0ae88de273348ebd44cfb98a0581d.
 * Existing simulator vertices already contain their sampled emitter anchors. They must not
 * be multiplied by that node matrix a second time. Caller applies sourceToWorld once. */
export function createUvmRibbonGeometry(
  state: EffectRibbonState,
  emitters: readonly RenderRibbonEmitter[],
  options: {
    readonly cameraPosition: Vec3
    readonly time: number
    readonly sequenceIndex?: number
    readonly maxBytes: number
    readonly maxNodes: number
    readonly signal?: AbortSignal
  },
) {
  for (const value of [options.maxBytes, options.maxNodes])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError('invalid ribbon geometry budget')
  const sequence = options.sequenceIndex ?? null,
    entries: UvmRibbonGeometry[] = []
  let bytes = 0,
    nodes = 0
  for (const [emitterIndex, emitter] of emitters.entries()) {
    options.signal?.throwIfAborted()
    const count = state.emitterCounts[emitterIndex]
    if (count === undefined || count > state.capacity)
      throw new TypeError('invalid ribbon point count')
    if (
      count < 2 ||
      scalar(emitter, 'visibility', sequence, options.time, emitter.visibility ?? 1) <= 0
    )
      continue
    const ring = effectRibbonRingVertexCount(emitter.ribbonType, emitter.sides),
      vertices = count * ring,
      indexCount = (count - 1) * (ring - 1) * 6
    bytes += vertices * 36 + indexCount * 4 + count * 32 + 1024
    nodes += count + vertices + indexCount / 3
    if (!Number.isSafeInteger(bytes) || bytes > options.maxBytes || nodes > options.maxNodes)
      throw new RangeError('ribbon rings exceed geometry budget')
    // Prove linked chain ownership before allocating the output buffers.
    const slots: number[] = [],
      seen = new Set<number>()
    let slot = state.firstSlots[emitterIndex] ?? -1,
      previous = -1
    for (let point = 0; point < count; point++) {
      options.signal?.throwIfAborted()
      if (
        !Number.isSafeInteger(slot) ||
        slot < 0 ||
        slot >= state.capacity ||
        seen.has(slot) ||
        state.emitterIndices[slot] !== emitterIndex ||
        state.previousSlots[slot] !== previous
      )
        throw new TypeError('invalid live ribbon chain')
      slots.push(slot)
      seen.add(slot)
      previous = slot
      slot = state.nextSlots[slot] ?? -1
    }
    if (slot !== -1 || state.lastSlots[emitterIndex] !== previous)
      throw new TypeError('incomplete live ribbon chain')
    const positions = new Float32Array(vertices * 3),
      colors = new Float32Array(vertices * 4),
      textureCoordinates = new Float32Array(vertices * 2),
      indices = new Uint32Array(indexCount)
    const centerAt = (slot: number, component: number) => {
      const offset = slot * 6 + component
      return (finite(state.vertices[offset]) + finite(state.vertices[offset + 3])) * 0.5
    }
    const rows = Math.max(1, Math.trunc(emitter.rows ?? 1)),
      columns = Math.max(1, Math.trunc(emitter.columns ?? 1))
    const fallback = vector(
        emitter,
        'color',
        sequence,
        options.time,
        emitter.color ?? [0.45, 0.85, 1],
      ),
      fallbackAlpha = scalar(emitter, 'alpha', sequence, options.time, emitter.alpha ?? 1)
    const colorStages = ['Start', 'Middle', 'End'].map((suffix, index) =>
      vector(
        emitter,
        `segmentColor${suffix}`,
        sequence,
        options.time,
        emitter.segmentColors?.[index] ?? fallback,
      ),
    )
    const alphaStages = ['Start', 'Middle', 'End'].map((suffix, index) =>
      scalar(
        emitter,
        `segmentAlpha${suffix}`,
        sequence,
        options.time,
        emitter.segmentAlphas?.[index] ?? fallbackAlpha,
      ),
    )
    const fallbackWidth =
      scalar(emitter, 'heightAbove', sequence, options.time, emitter.heightAbove ?? 0.5) +
      scalar(emitter, 'heightBelow', sequence, options.time, emitter.heightBelow ?? 0.5)
    const widthStages = ['Start', 'Middle', 'End'].map((suffix, index) =>
      scalar(
        emitter,
        `width${suffix}`,
        sequence,
        options.time,
        emitter.widths?.[index] ?? fallbackWidth,
      ),
    )
    let indexWrite = 0
    for (const [point, slot] of slots.entries()) {
      options.signal?.throwIfAborted()
      const center: Vec3 = [centerAt(slot, 0), centerAt(slot, 1), centerAt(slot, 2)]
      const previous = state.previousSlots[slot] ?? -1,
        next = state.nextSlots[slot] ?? -1,
        offset = slot * 6
      const tangent: Vec3 = [0, 1, 2].map(
        c =>
          (next < 0 ? finite(center[c]) : centerAt(next, c)) -
          (previous < 0 ? finite(center[c]) : centerAt(previous, c)),
      ) as unknown as Vec3
      const up: Vec3 = [0, 1, 2].map(
        c => finite(state.vertices[offset + c]) - finite(state.vertices[offset + c + 3]),
      ) as unknown as Vec3
      const camera: Vec3 = [
        options.cameraPosition[0] - center[0],
        options.cameraPosition[1] - center[1],
        options.cameraPosition[2] - center[2],
      ]
      const age = finite(state.ages[slot]),
        phase = clamp(age / Math.max(0.000001, finite(state.lifeSpans[slot])))
      const width =
        Math.max(0.0001, curve(widthStages, phase, emitter.widthTimeMiddle ?? 0.5)) *
        Math.max(
          0,
          1 + effectVariationValue(emitter.scaleVariation, age, finite(state.randomSeeds[slot])),
        )
      writeEffectRibbonRingPositions(
        positions,
        point * ring,
        3,
        center,
        tangent,
        up,
        camera,
        width * 0.5,
        emitter.ribbonType,
        emitter.sides,
        emitter.starRatio,
      )
      const rgba: Color = [0, 1, 2]
        .map(component =>
          clamp(
            curve(
              colorStages.map(value => finite(value[component])),
              phase,
              emitter.colorTimeMiddle ?? 0.5,
            ),
          ),
        )
        .concat(
          clamp(
            clamp(curve(alphaStages, phase, emitter.colorTimeMiddle ?? 0.5)) *
              finite(state.alphas[slot]),
          ),
        ) as unknown as Color
      const textureSlot = finite(state.textureSlots[slot]),
        cellX = (textureSlot % columns) / columns,
        cellY = (Math.floor(textureSlot / columns) % rows) / rows
      for (let cross = 0; cross < ring; cross++) {
        const vertex = point * ring + cross
        textureCoordinates[vertex * 2] = cellX + cross / Math.max(1, ring - 1) / columns
        textureCoordinates[vertex * 2 + 1] = cellY + point / (count - 1) / rows
        colors.set(rgba, vertex * 4)
      }
      if (point > 0)
        for (let edge = 0; edge < ring - 1; edge++) {
          const a = (point - 1) * ring + edge,
            b = point * ring + edge
          indices.set([a, a + 1, b + 1, a, b + 1, b], indexWrite)
          indexWrite += 6
        }
    }
    if (
      !positions.every(Number.isFinite) ||
      !colors.every(Number.isFinite) ||
      !textureCoordinates.every(Number.isFinite)
    )
      throw new RangeError('ribbon geometry exceeds float32')
    entries.push({
      emitter: emitterIndex,
      positions,
      colors,
      textureCoordinates,
      indices,
    })
  }
  return { entries, bytes, nodes }
}
