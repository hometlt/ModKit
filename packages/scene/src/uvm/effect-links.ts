import type { RenderParticleEmitter } from '@modkit/codec-kit/legacy/models'

/** Validate authored UVM ordinals before translating into a filtered simulator table. A zero
 * emission rate/visibility is a valid linked template: the existing kernel owns its spawn rules.
 * This mapping never changes document/source arrays and never matches by names. */
export function bindUvmEffectLinks(
  particles: RenderParticleEmitter[],
  particleOrdinals: readonly number[],
  ribbonOrdinals: readonly number[],
  sourceParticleCount: number,
  sourceRibbonCount: number,
  maxBytes: number,
  maxNodes: number,
  signal?: AbortSignal,
) {
  const count = particleOrdinals.length + ribbonOrdinals.length,
    maxLinks = particles.length * 3,
    bytes = count * 96 + maxLinks * 64,
    nodes = count + maxLinks
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 0 ||
    nodes > maxNodes ||
    bytes > maxBytes
  )
    throw new RangeError('effect link mapping exceeds budget')
  const map = (ordinals: readonly number[], sourceCount: number) => {
    if (!Number.isSafeInteger(sourceCount) || sourceCount < 0)
      throw new TypeError('invalid authored emitter count')
    const output = new Map<number, number>()
    for (const [index, ordinal] of ordinals.entries()) {
      signal?.throwIfAborted()
      if (
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        ordinal >= sourceCount ||
        output.has(ordinal)
      )
        throw new TypeError('ambiguous authored effect ordinal')
      output.set(ordinal, index)
    }
    return output
  }
  if (particles.length !== particleOrdinals.length)
    throw new TypeError('effect ordinal table differs')
  const particleMap = map(particleOrdinals, sourceParticleCount),
    ribbonMap = map(ribbonOrdinals, sourceRibbonCount)
  const changes: {
    emitter: RenderParticleEmitter
    key: 'collisionEmitterIndex' | 'trailEmitterIndex' | 'bounceRibbonEmitterIndex'
    target: number
  }[] = []
  for (const emitter of particles)
    for (const key of [
      'collisionEmitterIndex',
      'trailEmitterIndex',
      'bounceRibbonEmitterIndex',
    ] as const) {
      signal?.throwIfAborted()
      const value = emitter[key]
      if (value === undefined) continue
      const limit = key === 'bounceRibbonEmitterIndex' ? sourceRibbonCount : sourceParticleCount,
        targetMap = key === 'bounceRibbonEmitterIndex' ? ribbonMap : particleMap
      if (!Number.isSafeInteger(value) || value < 0 || value >= limit)
        throw new TypeError(`invalid authored ${key}`)
      const target = targetMap.get(value)
      if (target === undefined)
        throw new TypeError(`${key} target has unsupported geometry or no sampled scene transform`)
      changes.push({ emitter, key, target })
    }
  // All correspondences validated before changing the ephemeral simulator inputs.
  for (const change of changes) change.emitter[change.key] = change.target
  return { bytes, nodes }
}
