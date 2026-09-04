import { describe, expect, it } from 'vitest'

import {
  createEffectCollisionShapeProvider,
  EFFECT_COLLISION_OBJECTS,
  EFFECT_COLLISION_TERRAIN,
  effectRibbonRingVertexCount,
  ModelEffectSimulation,
  sampleEffectSequenceScalar,
  writeEffectRibbonRingPositions,
  writeEffectParticleRenderPosition,
  type MutableEffectEmitterAnchor,
  type EffectAnchorProvider,
  type RenderModelEffects,
  type RenderParticleEmitter,
  type RenderRibbonEmitter,
} from '../../../src/legacy-model-support.js'

function effects(
  particles: RenderParticleEmitter[] = [],
  ribbons: RenderRibbonEmitter[] = [],
): RenderModelEffects {
  return { particles, ribbons }
}

function particle(overrides: Partial<RenderParticleEmitter> = {}): RenderParticleEmitter {
  return {
    name: 'particles',
    boneIndex: 0,
    materialIndex: 0,
    emissionRate: 4,
    lifeSpan: 2,
    width: 2,
    length: 3,
    speed: 5,
    gravity: 1,
    latitude: 30,
    variation: 0.25,
    ...overrides,
  }
}

function ribbon(overrides: Partial<RenderRibbonEmitter> = {}): RenderRibbonEmitter {
  return {
    name: 'ribbon',
    boneIndex: 1,
    materialIndex: 0,
    emissionRate: 2,
    lifeSpan: 1,
    heightAbove: 2,
    heightBelow: 1,
    ...overrides,
  }
}

function particleSnapshot(simulation: ModelEffectSimulation): number[] {
  const values: number[] = []
  const state = simulation.particles
  for (let index = 0; index < state.activeCount; index += 1) {
    const slot = state.activeSlots[index]!
    values.push(
      slot,
      state.emitterIndices[slot]!,
      state.ages[slot]!,
      ...state.positions.subarray(slot * 3, slot * 3 + 3),
      ...state.velocities.subarray(slot * 3, slot * 3 + 3),
    )
  }
  return values
}

function anchor(): MutableEffectEmitterAnchor {
  return {
    position: new Float32Array(3),
    xAxis: new Float32Array([1, 0, 0]),
    yAxis: new Float32Array([0, 1, 0]),
    zAxis: new Float32Array([0, 0, 1]),
  }
}

describe('ModelEffectSimulation', () => {
  it('replays seeded particle spawning deterministically', () => {
    const modelEffects = effects([particle()])
    const first = new ModelEffectSimulation(modelEffects, { seed: 1234 })
    const second = new ModelEffectSimulation(modelEffects, { seed: 1234 })
    const otherSeed = new ModelEffectSimulation(modelEffects, { seed: 5678 })

    first.seek(0.75)
    second.seek(0.75)
    otherSeed.seek(0.75)

    expect(first.particles.activeCount).toBe(3)
    expect(particleSnapshot(first)).toEqual(particleSnapshot(second))
    expect(particleSnapshot(first)).not.toEqual(particleSnapshot(otherSeed))
  })

  it('bounds emitter budgets and reuses fixed pool storage after kills', () => {
    const simulation = new ModelEffectSimulation(
      effects([particle({ emissionRate: 100, lifeSpan: 0.1, maxParticles: 2 })]),
      { maxParticles: 8, maxParticlesPerEmitter: 8, maxSpawnPerStep: 8 },
    )
    const positions = simulation.particles.positions
    const activeSlots = simulation.particles.activeSlots

    const first = simulation.update(0.1)
    expect(first.activeParticles).toBe(2)
    expect(first.droppedParticles).toBeGreaterThan(0)

    const second = simulation.update(0.1)
    expect(second.killedParticles).toBe(2)
    expect(second.activeParticles).toBe(2)
    expect(simulation.particles.positions).toBe(positions)
    expect(simulation.particles.activeSlots).toBe(activeSlots)
    expect(Array.from(activeSlots.subarray(0, 2)).sort()).toEqual([0, 1])
  })

  it('emits squirt counts once per animation key', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          squirt: true,
          lifeSpan: 10,
          animation: {
            emissionRate: {
              lineType: 0,
              globalSeqId: null,
              keys: [
                { frame: 0, vector: [2] },
                { frame: 0.5, vector: [3] },
              ],
            },
          },
        }),
      ]),
      { maxParticles: 16 },
    )

    expect(simulation.update(0.1, { animationTime: 0 }).spawnedParticles).toBe(2)
    expect(simulation.update(0.1, { animationTime: 0.25 }).spawnedParticles).toBe(0)
    expect(simulation.update(0.3, { animationTime: 0.5 }).spawnedParticles).toBe(3)
    expect(simulation.particles.activeCount).toBe(5)
  })

  it('uses M3 emit-count tracks for squirt burst size and key timing', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          squirt: true,
          emitCount: 1,
          emissionRate: 99,
          lifeSpan: 10,
          sequenceAnimation: {
            emitCount: [
              {
                sequenceIndex: 2,
                track: {
                  lineType: 0,
                  globalSeqId: null,
                  keys: [
                    { frame: 0, vector: [2] },
                    { frame: 0.5, vector: [3] },
                  ],
                },
              },
            ],
          },
        }),
      ]),
      { maxParticles: 16 },
    )

    expect(simulation.update(0.1, { sequenceId: 2, animationTime: 0 }).spawnedParticles).toBe(2)
    expect(simulation.update(0.1, { sequenceId: 2, animationTime: 0.25 }).spawnedParticles).toBe(0)
    expect(simulation.update(0.3, { sequenceId: 2, animationTime: 0.5 }).spawnedParticles).toBe(3)
  })

  it('selects sparse effect tracks by numeric sequence id while retaining static fallback', () => {
    const track = (sequenceIndex: number, value: number) => ({
      sequenceIndex,
      track: {
        lineType: 0,
        globalSeqId: null,
        keys: [{ frame: 0, vector: [value] }],
      },
    })
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 0,
          lifeSpan: 10,
          sequenceAnimation: { emissionRate: [track(0, 0), track(1, 4)] },
        }),
      ]),
    )

    expect(
      simulation.update(1, { sequenceId: 0, sequenceTimeSeconds: 1, animationTime: 0 })
        .spawnedParticles,
    ).toBe(0)
    expect(
      simulation.update(1, { sequenceId: 1, sequenceTimeSeconds: 1, animationTime: 0 })
        .spawnedParticles,
    ).toBe(4)
    expect(simulation.particles.activeCount).toBe(4)
  })

  it('preserves Hermite and Bezier interpolation for effect parameters', () => {
    const tracks = (lineType: number, outTan: number, inTan: number) => [
      {
        sequenceIndex: 1,
        track: {
          lineType,
          globalSeqId: null,
          keys: [
            { frame: 0, vector: [0], outTan: [outTan] },
            { frame: 1, vector: [0], inTan: [inTan] },
          ],
        },
      },
    ]

    expect(sampleEffectSequenceScalar(tracks(2, 8, 0), undefined, 1, 0.5, 0)).toBeCloseTo(1)
    expect(sampleEffectSequenceScalar(tracks(3, 4 / 3, 4 / 3), undefined, 1, 0.5, 0)).toBeCloseTo(1)
  })

  it('maintains and unlinks bounded ribbon chains', () => {
    const simulation = new ModelEffectSimulation(effects([], [ribbon()]), {
      maxRibbons: 4,
      maxRibbonsPerEmitter: 4,
    })

    simulation.update(0.5)
    simulation.update(0.5)
    const state = simulation.ribbons
    const first = state.firstSlots[0]!
    const second = state.lastSlots[0]!
    expect(state.activeCount).toBe(2)
    expect(state.nextSlots[first]).toBe(second)
    expect(state.previousSlots[second]).toBe(first)
    expect(Array.from(state.vertices.subarray(first * 6, first * 6 + 6))).toEqual([
      0, 2, 0, 0, -1, 0,
    ])

    simulation.update(0.51, { allowSpawn: false })
    expect(state.activeCount).toBe(1)
    expect(state.firstSlots[0]).toBe(second)
    expect(state.lastSlots[0]).toBe(second)
    expect(state.previousSlots[second]).toBe(-1)
  })

  it('rebuilds SRIB cubic splines at authored spatial cadence', () => {
    let endpointX = 0
    const simulation = new ModelEffectSimulation(
      effects(
        [],
        [
          ribbon({
            emissionOffset: [0, 0, 0],
            emissionVector: [1, 0, 0],
            speed: 1,
            divisions: 4,
            splineEndpoints: [
              {
                boneIndex: 2,
                emissionOffset: [4, 0, 0],
                emissionVector: [1, 0, 0],
                velocity: 1,
                velocityBaseFactor: 1,
                velocityEndFactor: 1,
                yaw: 0,
                pitch: 0,
                sequenceAnimation: {
                  velocity: [
                    {
                      sequenceIndex: 2,
                      track: {
                        lineType: 0,
                        globalSeqId: null,
                        keys: [{ frame: 0, vector: [3] }],
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ],
      ),
      { maxRibbons: 16, maxRibbonsPerEmitter: 16 },
    )
    const anchorProvider: EffectAnchorProvider = (_kind, _emitter, bone, _time, out) => {
      if (bone === 2) out.position[0] = endpointX
    }

    simulation.update(1 / 60, { anchorProvider })
    const state = simulation.ribbons
    expect(state.activeCount).toBe(5)
    expect(state.emitterCounts[0]).toBe(5)

    const slots: number[] = []
    let slot = state.firstSlots[0]!
    while (slot >= 0) {
      slots.push(slot)
      slot = state.nextSlots[slot]!
    }
    expect(slots).toHaveLength(5)
    expect(slots.map(current => state.ages[current])).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(state.positions[slots[0]! * 3]).toBeCloseTo(0)
    expect(state.positions[slots[2]! * 3]).toBeCloseTo(2)
    expect(state.positions[slots[4]! * 3]).toBeCloseTo(4)

    endpointX = 2
    simulation.update(1 / 60, { anchorProvider })
    expect(state.activeCount).toBe(5)
    expect(state.firstSlots[0]).toBe(slots[0])
    expect(state.lastSlots[0]).toBe(slots[4])
    expect(state.positions[slots[4]! * 3]).toBeCloseTo(6)

    endpointX = 0
    simulation.update(1 / 60, { sequenceId: 2, animationTime: 0, anchorProvider })
    const animatedMiddle = state.nextSlots[state.nextSlots[state.firstSlots[0]!]!]!
    expect(state.positions[animatedMiddle * 3]).toBeCloseTo(1.25)
  })

  it('resets on sequence changes and rebuilds deterministic seek state', () => {
    const simulation = new ModelEffectSimulation(effects([particle({ lifeSpan: 10 })]), {
      seed: 42,
    })
    simulation.seek(0.5, undefined, 'Stand')
    const original = particleSnapshot(simulation)
    expect(original.length).toBeGreaterThan(0)

    simulation.update(0.1, { sequenceId: 'Walk', sequenceTimeSeconds: 0.1 })
    expect(simulation.particles.activeCount).toBe(0)

    const stats = simulation.seek(0.5, undefined, 'Stand')
    const replay = particleSnapshot(simulation)
    expect(replay).toEqual(original)
    expect(simulation.seek(0.5, undefined, 'Stand')).toBe(stats)
    expect(particleSnapshot(simulation)).toEqual(original)
  })

  it('keeps model/bone-space particles transformable by the current moving anchor', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 0,
          gravity: 0,
          width: 0,
          length: 0,
          modelSpace: true,
          boneAnchored: true,
        }),
      ]),
    )
    simulation.update(1, {
      anchorProvider: (_kind, _index, _bone, _time, out) => {
        out.position[0] = 1
      },
    })
    const state = simulation.particles
    const slot = state.activeSlots[0]!
    expect(state.spaces[slot]).toBe(2)
    expect(state.positions[slot * 3]).toBe(1)

    const current = anchor()
    current.position[0] = 5
    const rendered = new Float32Array(3)
    writeEffectParticleRenderPosition(rendered, 0, state, slot, current)
    expect(Array.from(rendered)).toEqual([6, 0, 0])

    simulation.update(1, { allowSpawn: false })
    expect(state.positions[slot * 3]).toBe(1)
    current.position[0] = 9
    writeEffectParticleRenderPosition(rendered, 0, state, slot, current)
    expect(Array.from(rendered)).toEqual([10, 0, 0])
  })

  it('uses analytic M3 drag while retaining collision friction data', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 10,
          variation: 0,
          latitude: 0,
          gravity: 0,
          drag: 2,
          friction: 0.25,
          width: 0,
          length: 0,
        }),
      ]),
    )
    simulation.update(1)
    const slot = simulation.particles.activeSlots[0]!
    simulation.update(1, { allowSpawn: false })

    expect(simulation.particles.velocities[slot * 3 + 2]).toBeCloseTo(10 * Math.exp(-2), 5)
    expect(simulation.particles.positions[slot * 3 + 2]).toBeCloseTo(
      (10 * (1 - Math.exp(-2))) / 2,
      5,
    )
    expect(simulation.particles.frictions[slot]).toBeCloseTo(0.25)
  })

  it('emits uniformly along authored M3 spline segments', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 0,
          gravity: 0,
          emitShape: 'spline',
          emitShapePoints: [
            [1, 2, 3],
            [3, 2, 3],
          ],
        }),
      ]),
      { seed: 42 },
    )

    simulation.update(1)
    const slot = simulation.particles.activeSlots[0]!
    const offset = slot * 3
    expect(simulation.particles.positions[offset]).toBeGreaterThanOrEqual(1)
    expect(simulation.particles.positions[offset]).toBeLessThanOrEqual(3)
    expect(simulation.particles.positions[offset + 1]).toBeCloseTo(2)
    expect(simulation.particles.positions[offset + 2]).toBeCloseTo(3)
  })

  it('samples animated SVC3 particle-spline control points per sequence', () => {
    const animatedPoint = [
      {
        sequenceIndex: 2,
        track: {
          lineType: 1,
          globalSeqId: null,
          keys: [{ frame: 0, vector: [5, 6, 7] }],
        },
      },
    ]
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 0,
          gravity: 0,
          emitShape: 'spline',
          emitShapePoints: [
            [1, 2, 3],
            [1, 2, 3],
          ],
          emitShapePointSequenceAnimations: [animatedPoint, animatedPoint],
        }),
      ]),
    )

    simulation.update(1, { sequenceId: 2, animationTime: 0 })
    const slot = simulation.particles.activeSlots[0]!
    expect(Array.from(simulation.particles.positions.subarray(slot * 3, slot * 3 + 3))).toEqual([
      5, 6, 7,
    ])
  })

  it('samples authored mesh-region triangles by surface area', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 0,
          gravity: 0,
          emitShape: 'mesh',
          emitShapeMeshes: [
            {
              positions: new Float32Array([0, 0, 5, 4, 0, 5, 0, 4, 5]),
              indices: new Uint16Array([0, 1, 2]),
            },
          ],
        }),
      ]),
      { seed: 42 },
    )

    simulation.update(1)
    const slot = simulation.particles.activeSlots[0]!
    const offset = slot * 3
    const x = simulation.particles.positions[offset]!
    const y = simulation.particles.positions[offset + 1]!
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(x + y).toBeLessThanOrEqual(4)
    expect(simulation.particles.positions[offset + 2]).toBeCloseTo(5)
  })

  it('rejects bounded inner cutout volumes during emission', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 32,
          lifeSpan: 10,
          speed: 0,
          gravity: 0,
          maxParticles: 32,
          emitShape: 'plane',
          emitShapeSize: [10, 10, 0],
          emitShapeCutout: true,
          emitShapeCutoutSize: [6, 6, 0],
        }),
      ]),
      { seed: 7, maxParticles: 32, maxParticlesPerEmitter: 32 },
    )

    simulation.update(1)
    expect(simulation.particles.activeCount).toBe(32)
    for (let index = 0; index < simulation.particles.activeCount; index += 1) {
      const slot = simulation.particles.activeSlots[index]!
      const offset = slot * 3
      expect(
        Math.abs(simulation.particles.positions[offset]!) >= 3 ||
          Math.abs(simulation.particles.positions[offset + 1]!) >= 3,
      ).toBe(true)
    }
  })

  it('applies channel-selected wind and one-shot explosion fields', () => {
    const simulation = new ModelEffectSimulation({
      ...effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 0,
          gravity: 0,
          emitShape: 'point',
          worldForceChannels: 1,
        }),
      ]),
      forces: [
        {
          name: 'wind',
          boneIndex: 1,
          type: 'wind',
          shape: 'sphere',
          channels: 1,
          strength: 2,
          width: 100,
          height: 100,
          length: 100,
        },
        {
          name: 'blast',
          boneIndex: 2,
          type: 'explosion',
          shape: 'sphere',
          channels: 1,
          strength: 3,
          width: 100,
          height: 100,
          length: 100,
        },
      ],
    })
    const anchorProvider = (
      kind: string,
      _index: number,
      _bone: number,
      _time: number,
      out: MutableEffectEmitterAnchor,
    ) => {
      if (kind === 'force') out.position[0] = -1
    }

    simulation.update(1, { anchorProvider })
    simulation.update(1, { anchorProvider })
    const slot = simulation.particles.activeSlots[0]!
    const offset = slot * 3
    expect(simulation.particles.velocities[offset]).toBeCloseTo(3)
    expect(simulation.particles.velocities[offset + 2]).toBeCloseTo(2)

    simulation.update(1, { anchorProvider })
    expect(simulation.particles.velocities[offset]).toBeCloseTo(3)
    expect(simulation.particles.velocities[offset + 2]).toBeCloseTo(4)
  })

  it('applies bounded angular, axial, and radial warp components', () => {
    const simulation = new ModelEffectSimulation({
      ...effects([
        particle({ emissionRate: 1, lifeSpan: 10, speed: 0, gravity: 0, emitShape: 'point' }),
      ]),
      warps: [
        {
          name: 'vortex',
          boneIndex: 0,
          warpType: 0,
          radius: 10,
          height: 10,
          strength: 2,
          angular: 1,
          axial: 0.5,
          radial: 0.25,
        },
      ],
    })

    simulation.update(1)
    simulation.update(1)
    const slot = simulation.particles.activeSlots[0]!
    const offset = slot * 3
    expect(simulation.particles.velocities[offset]).toBeCloseTo(0.5)
    expect(simulation.particles.velocities[offset + 1]).toBeCloseTo(2)
    expect(simulation.particles.velocities[offset + 2]).toBeCloseTo(1)
  })

  it('delegates swept collision and applies authored bounce plus tangent friction', () => {
    let providerCalls = 0
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 5,
          variation: 0,
          latitude: 0,
          gravity: 0,
          width: 0,
          length: 0,
          collideTerrain: true,
          bounce: 0.5,
          friction: 0.25,
        }),
      ]),
      {
        collisionProvider: (query, out) => {
          providerCalls += 1
          expect(query.collisionMask).toBe(EFFECT_COLLISION_TERRAIN)
          expect(query.space).toBe(0)
          expect(query.sequenceTimeSeconds).toBe(2)
          const startZ = query.startPosition[2]!
          const endZ = query.endPosition[2]!
          if (!(startZ >= 0 && endZ < 0)) return false
          const hit = startZ / (startZ - endZ)
          out.position[0] =
            query.startPosition[0]! + (query.endPosition[0]! - query.startPosition[0]!) * hit
          out.position[1] =
            query.startPosition[1]! + (query.endPosition[1]! - query.startPosition[1]!) * hit
          out.position[2] = 0
          out.normal[0] = 0
          out.normal[1] = 0
          out.normal[2] = 4 // Core normalizes host normals.
          return true
        },
      },
    )

    simulation.update(1, {
      anchorProvider: (_kind, _index, _bone, _time, out) => {
        out.position[2] = 1
        out.zAxis[0] = 0.6
        out.zAxis[1] = 0
        out.zAxis[2] = -0.8
      },
    })
    const slot = simulation.particles.activeSlots[0]!
    const stats = simulation.update(1, { allowSpawn: false })
    const offset = slot * 3

    expect(providerCalls).toBe(1)
    expect(stats.collidedParticles).toBe(1)
    expect(stats.killedParticles).toBe(0)
    expect(simulation.particles.collisionCounts[slot]).toBe(1)
    expect(Array.from(simulation.particles.positions.subarray(offset, offset + 3))).toEqual([
      0.75, 0, 0,
    ])
    expect(simulation.particles.velocities[offset]).toBeCloseTo(2.25)
    expect(simulation.particles.velocities[offset + 1]).toBeCloseTo(0)
    expect(simulation.particles.velocities[offset + 2]).toBeCloseTo(2)
  })

  it('culls particles after the authored collision event budget', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 1,
          variation: 0,
          latitude: 0,
          gravity: 0,
          width: 0,
          length: 0,
          collideObjects: true,
          bounce: 1,
          maxCollisionEvents: 1,
        }),
      ]),
      {
        collisionProvider: (_query, out) => {
          out.position.fill(0)
          out.normal[0] = 0
          out.normal[1] = 0
          out.normal[2] = 1
          return true
        },
      },
    )

    simulation.update(1, {
      anchorProvider: (_kind, _index, _bone, _time, out) => {
        out.position[2] = 0.5
        out.zAxis[2] = -1
      },
    })
    const stats = simulation.update(1, { allowSpawn: false })

    expect(stats.collidedParticles).toBe(1)
    expect(stats.killedParticles).toBe(1)
    expect(stats.activeParticles).toBe(0)
  })

  it('defers bounded collision-linked child emitters at the impact point', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 1,
          variation: 0,
          latitude: 0,
          gravity: 0,
          width: 0,
          length: 0,
          collideTerrain: true,
          maxCollisionEvents: 1,
          collisionEmitterIndex: 1,
          collisionEmitMin: 2,
          collisionEmitMax: 2,
          collisionEmitChance: 1,
          collisionEmitEnergy: 0.5,
        }),
        particle({
          name: 'impact children',
          emissionRate: 0,
          lifeSpan: 10,
          speed: 4,
          variation: 0,
          latitude: 0,
          gravity: 0,
          width: 0,
          length: 0,
        }),
      ]),
      {
        collisionProvider: (query, out) => {
          if (query.emitterIndex !== 0) return false
          out.position[0] = 2
          out.position[1] = 3
          out.position[2] = 0
          out.normal[0] = 0
          out.normal[1] = 0
          out.normal[2] = 1
          return true
        },
      },
    )

    simulation.update(1, {
      anchorProvider: (_kind, _index, _bone, _time, out) => {
        out.position[2] = 0.5
        out.zAxis[2] = -1
      },
    })
    const stats = simulation.update(1, { allowSpawn: false })

    expect(stats.collidedParticles).toBe(1)
    expect(stats.killedParticles).toBe(1)
    expect(stats.spawnedParticles).toBe(2)
    expect(stats.activeParticles).toBe(2)
    expect(simulation.particles.emitterCounts[1]).toBe(2)
    for (let index = 0; index < simulation.particles.activeCount; index += 1) {
      const slot = simulation.particles.activeSlots[index]!
      const offset = slot * 3
      expect(Array.from(simulation.particles.positions.subarray(offset, offset + 3))).toEqual([
        2, 3, 0,
      ])
      expect(simulation.particles.velocities[offset + 2]).toBeCloseTo(2)
    }
  })

  it('spawns v23-linked ribbons at particle bounce points', () => {
    const simulation = new ModelEffectSimulation(
      effects(
        [
          particle({
            emissionRate: 1,
            lifeSpan: 10,
            speed: 1,
            variation: 0,
            latitude: 0,
            gravity: 0,
            width: 0,
            length: 0,
            collideTerrain: true,
            maxCollisionEvents: 1,
            bounceRibbonEmitterIndex: 0,
            bounceRibbonChance: 1,
          }),
        ],
        [ribbon({ emissionRate: 0, heightAbove: 2, heightBelow: 3 })],
      ),
      {
        collisionProvider: (_query, out) => {
          out.position.set([2, 3, 4])
          out.normal.set([0, 0, 1])
          return true
        },
      },
    )

    simulation.update(1, {
      anchorProvider: (_kind, _index, _bone, _time, out) => {
        out.position[2] = 0.5
        out.zAxis[2] = -1
      },
    })
    const stats = simulation.update(1, { allowSpawn: false })
    const slot = simulation.ribbons.activeSlots[0]!
    const positionOffset = slot * 3
    const vertexOffset = slot * 6

    expect(stats.spawnedRibbons).toBe(1)
    expect(stats.activeRibbons).toBe(1)
    expect(
      Array.from(simulation.ribbons.positions.subarray(positionOffset, positionOffset + 3)),
    ).toEqual([2, 3, 4])
    expect(
      Array.from(simulation.ribbons.vertices.subarray(vertexOffset, vertexOffset + 6)),
    ).toEqual([2, 5, 4, 2, 0, 4])
  })

  it('emits bounded lifetime projectors at collision splat points', () => {
    const modelEffects = effects([
      particle({
        emissionRate: 1,
        lifeSpan: 10,
        speed: 1,
        variation: 0,
        latitude: 0,
        gravity: 0,
        width: 0,
        length: 0,
        collideTerrain: true,
        collisionProjectorIndex: 0,
        collisionProjectorChance: 1,
      }),
    ])
    modelEffects.projectors = [
      {
        name: 'impact',
        boneIndex: -1,
        materialIndex: 0,
        projectionType: 'orthographic',
        offset: [0, 0, 0],
        pitch: 0,
        yaw: 0,
        roll: 0,
        fieldOfView: 1,
        aspectRatio: 1,
        near: 0.1,
        far: 1,
        boxOffsetZBottom: 0,
        boxOffsetZTop: 1,
        boxOffsetXLeft: -1,
        boxOffsetXRight: 1,
        boxOffsetYFront: 1,
        boxOffsetYBack: -1,
        falloff: 0,
        alphaInit: 0,
        alphaMid: 1,
        alphaEnd: 0,
        lifetimeAttack: 0.5,
        lifetimeHold: 0.5,
        lifetimeDecay: 0.5,
        attenuationDistance: 0,
        active: 0,
        layer: 0,
        flags: 0,
      },
    ]
    const simulation = new ModelEffectSimulation(modelEffects, {
      maxProjectorSplats: 2,
      collisionProvider: (_query, out) => {
        out.position.set([2, 3, 4])
        out.normal.set([0, 0, 1])
        return true
      },
    })
    simulation.update(1, {
      anchorProvider: (_kind, _index, _bone, _time, out) => {
        out.position[2] = 0.5
        out.zAxis[2] = -1
      },
    })
    const stats = simulation.update(1, { allowSpawn: false })
    const slot = simulation.projectorSplats.activeSlots[0]!

    expect(stats.spawnedProjectorSplats).toBe(1)
    expect(stats.activeProjectorSplats).toBe(1)
    expect(
      Array.from(simulation.projectorSplats.positions.subarray(slot * 3, slot * 3 + 3)),
    ).toEqual([2, 3, 4])
    expect(Array.from(simulation.projectorSplats.normals.subarray(slot * 3, slot * 3 + 3))).toEqual(
      [0, 0, 1],
    )
    simulation.update(2, { allowSpawn: false })
    expect(simulation.projectorSplats.activeCount).toBe(0)
  })

  it('bounds fixed-step seek work for hostile targets', () => {
    const simulation = new ModelEffectSimulation(effects([particle()]), {
      fixedStepSeconds: 1 / 60,
      maxSeekSteps: 4,
      maxParticles: 8,
    })
    const stats = simulation.seek(100)
    expect(stats.seekClamped).toBe(true)
    expect(stats.timeSeconds).toBe(100)
    expect(stats.activeParticles).toBeLessThanOrEqual(8)
  })

  it('inherits cached emitter motion without repeated anchor sampling', () => {
    const simulation = new ModelEffectSimulation(
      effects([
        particle({
          emissionRate: 1,
          lifeSpan: 10,
          speed: 0,
          gravity: 0,
          variation: 0,
          width: 0,
          length: 0,
          latitude: 0,
          parentVelocity: 2,
        }),
      ]),
      { seed: 17 },
    )
    let anchorCalls = 0
    const anchorProvider: EffectAnchorProvider = (_kind, _index, _bone, time, out): void => {
      anchorCalls += 1
      out.position[0] = time
    }

    simulation.update(1, { anchorProvider })
    simulation.update(1, { anchorProvider })
    const firstSlot = simulation.particles.activeSlots[0]!
    const secondSlot = simulation.particles.activeSlots[1]!
    const newest =
      simulation.particles.ages[firstSlot]! < simulation.particles.ages[secondSlot]!
        ? firstSlot
        : secondSlot

    expect(anchorCalls).toBe(2)
    expect(simulation.particles.positions[newest * 3]).toBeCloseTo(2)
    expect(simulation.particles.velocities[newest * 3]).toBeCloseTo(2)
  })

  it('applies M3 spread waveform variation at particle birth', () => {
    const base = particle({
      emissionRate: 1,
      lifeSpan: 10,
      speed: 1,
      gravity: 0,
      variation: 0,
      emitAngleX: 0,
      emitAngleY: 0,
      emitSpreadX: 0.5,
      emitSpreadY: 0,
    })
    const withoutVariation = new ModelEffectSimulation(effects([base]), { seed: 321 })
    const withVariation = new ModelEffectSimulation(
      effects([
        {
          ...base,
          spreadXVariation: { shape: 'saw', amplitude: 0.75, frequency: 1 },
        },
      ]),
      { seed: 321 },
    )

    withoutVariation.update(1)
    withVariation.update(1)
    const first = withoutVariation.particles.activeSlots[0]! * 3
    const second = withVariation.particles.activeSlots[0]! * 3

    expect(
      Array.from(withoutVariation.particles.velocities.subarray(first, first + 3)),
    ).not.toEqual(Array.from(withVariation.particles.velocities.subarray(second, second + 3)))
  })

  it('sweeps particles against animated model collision primitives', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const provider = createEffectCollisionShapeProvider(
      [
        {
          kind: 'box',
          boneIndex: 3,
          matrix: identity,
          size: [2, 2, 2],
        },
      ],
      (_kind, _index, boneIndex, _time, out) => {
        expect(boneIndex).toBe(3)
        out.position[0] = 3
      },
    )
    const result = { position: new Float32Array(3), normal: new Float32Array(3) }
    const collided = provider(
      {
        emitterKind: 'particle',
        emitterIndex: 0,
        slot: 0,
        collisionMask: EFFECT_COLLISION_OBJECTS,
        space: 1,
        sequenceTimeSeconds: 0.25,
        startPosition: new Float32Array([0, 0, 0]),
        endPosition: new Float32Array([5, 0, 0]),
        velocity: new Float32Array([5, 0, 0]),
      },
      result,
    )

    expect(collided).toBe(true)
    expect(Array.from(result.position)).toEqual([2, 0, 0])
    expect(Array.from(result.normal)).toEqual([-1, 0, 0])
  })

  it('builds bounded planar, cylindrical, and star ribbon cross-sections', () => {
    const center = new Float32Array([0, 0, 0])
    const tangent = new Float32Array([1, 0, 0])
    const up = new Float32Array([0, 1, 0])
    const camera = new Float32Array([0, 0, 1])

    const billboard = new Float32Array(6)
    expect(
      writeEffectRibbonRingPositions(billboard, 0, 3, center, tangent, up, camera, 2, 'billboard'),
    ).toBe(2)
    expect(Array.from(billboard)).toEqual([0, 2, 0, 0, -2, 0])

    const cylinder = new Float32Array(effectRibbonRingVertexCount('cylinder', 4) * 3)
    writeEffectRibbonRingPositions(cylinder, 0, 3, center, tangent, up, camera, 2, 'cylinder', 4)
    expect(effectRibbonRingVertexCount('cylinder', 4)).toBe(5)
    for (let component = 0; component < 3; component += 1) {
      expect(cylinder[component]).toBeCloseTo(cylinder[cylinder.length - 3 + component]!)
    }
    expect(Math.hypot(cylinder[1]!, cylinder[2]!)).toBeCloseTo(2)

    const star = new Float32Array(effectRibbonRingVertexCount('star', 3) * 3)
    writeEffectRibbonRingPositions(star, 0, 3, center, tangent, up, camera, 2, 'star', 3, 0.25)
    expect(effectRibbonRingVertexCount('star', 3)).toBe(7)
    expect(Math.hypot(star[1]!, star[2]!)).toBeCloseTo(2)
    expect(Math.hypot(star[4]!, star[5]!)).toBeCloseTo(0.5)
    expect(effectRibbonRingVertexCount('star', 10_000)).toBe(65)
  })
})
