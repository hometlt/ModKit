import { describe, expect, it } from 'vitest'
import {
  AnimatorControllerRuntime,
  type RenderAnimatorController,
} from '../../../src/model-math/animation-controller.js'

function controller(): RenderAnimatorController {
  return {
    name: 'Locomotion',
    parameters: [
      { id: 1, name: 'Speed', type: 'float', defaultValue: 0 },
      { id: 2, name: 'Jump', type: 'trigger', defaultValue: false },
    ],
    layers: [
      {
        index: 0,
        name: 'Base Layer',
        stateMachineIndex: 0,
        defaultWeight: 1,
        blendingMode: 'override',
        ikPass: true,
      },
    ],
    stateMachines: [
      {
        index: 0,
        defaultState: 0,
        anyStateTransitions: [
          {
            destinationState: 2,
            conditions: [{ mode: 'if', parameterId: 2, threshold: 0 }],
            duration: 0,
            offset: 0,
            exitTime: 0,
            hasExitTime: false,
            hasFixedDuration: true,
          },
        ],
        states: [
          {
            index: 0,
            id: 10,
            name: 'Idle',
            speed: 1,
            cycleOffset: 0,
            loop: true,
            motion: { kind: 'clip', animationIndex: 0 },
            transitions: [
              {
                destinationState: 1,
                conditions: [{ mode: 'greater', parameterId: 1, threshold: 0.1 }],
                duration: 0.25,
                offset: 0,
                exitTime: 0,
                hasExitTime: false,
                hasFixedDuration: false,
              },
            ],
          },
          {
            index: 1,
            id: 11,
            name: 'Move',
            speed: 1,
            cycleOffset: 0,
            loop: true,
            motion: {
              kind: 'blend-tree',
              blendType: 'simple-1d',
              parameterId: 1,
              children: [
                { threshold: 0, motion: { kind: 'clip', animationIndex: 1 } },
                { threshold: 2, motion: { kind: 'clip', animationIndex: 2 } },
              ],
            },
            transitions: [],
          },
          {
            index: 2,
            id: 12,
            name: 'Jump',
            speed: 1,
            cycleOffset: 0,
            loop: false,
            motion: { kind: 'clip', animationIndex: 3 },
            transitions: [],
          },
        ],
      },
    ],
  }
}

function blendController(
  blendType: 'simple-directional-2d' | 'freeform-directional-2d' | 'freeform-cartesian-2d',
  positions: readonly (readonly [number, number])[],
): RenderAnimatorController {
  return {
    name: 'Blend',
    parameters: [
      { id: 1, name: 'X', type: 'float', defaultValue: 0 },
      { id: 2, name: 'Y', type: 'float', defaultValue: 0 },
    ],
    layers: [
      {
        index: 0,
        name: 'Base Layer',
        stateMachineIndex: 0,
        defaultWeight: 1,
        blendingMode: 'override',
        ikPass: false,
      },
    ],
    stateMachines: [
      {
        index: 0,
        defaultState: 0,
        anyStateTransitions: [],
        states: [
          {
            index: 0,
            id: 1,
            name: 'Blend',
            speed: 1,
            cycleOffset: 0,
            loop: true,
            motion: {
              kind: 'blend-tree',
              blendType,
              parameterId: 1,
              parameterYId: 2,
              children: positions.map((position, animationIndex) => ({
                position,
                motion: { kind: 'clip', animationIndex },
              })),
            },
            transitions: [],
          },
        ],
      },
    ],
  }
}

describe('AnimatorControllerRuntime', () => {
  it('evaluates conditional transitions and crossfades normalized duration', () => {
    const runtime = new AnimatorControllerRuntime(controller(), {
      clipDurations: [2, 1, 0.5, 0.8],
    })
    expect(runtime.update(0).clips).toEqual([
      expect.objectContaining({ animationIndex: 0, weight: 1, timeSeconds: 0 }),
    ])

    runtime.setFloat('Speed', 1)
    const started = runtime.update(0.1)
    expect(started.layers[0]?.transitionProgress).toBe(0)
    const halfway = runtime.update(0.25)
    expect(halfway.layers[0]?.transitionProgress).toBeCloseTo(0.5)
    expect(halfway.clips.map(sample => sample.animationIndex)).toEqual([0, 1, 2])
    expect(halfway.clips.find(sample => sample.animationIndex === 1)?.weight).toBeCloseTo(0.25)
    expect(halfway.clips.find(sample => sample.animationIndex === 2)?.weight).toBeCloseTo(0.25)
  })

  it('consumes triggers when an Any State transition starts', () => {
    const runtime = new AnimatorControllerRuntime(controller(), {
      clipDurations: [2, 1, 0.5, 0.8],
    })
    runtime.setTrigger('Jump')
    const evaluation = runtime.update(0)
    expect(evaluation.layers[0]?.stateName).toBe('Jump')
    expect(evaluation.clips[0]?.animationIndex).toBe(3)
    expect(runtime.getParameter('Jump')).toBe(false)
  })

  it('evaluates serialized entry selectors and mutable layer weights', () => {
    const definition = controller()
    definition.parameters[0]!.defaultValue = 1
    definition.stateMachines[0]!.selectorStates = [
      {
        fullPathId: 100,
        isEntry: true,
        transitions: [
          {
            destinationState: 1,
            conditions: [{ mode: 'greater', parameterId: 1, threshold: 0.5 }],
          },
        ],
      },
    ]
    const runtime = new AnimatorControllerRuntime(definition, {
      clipDurations: [1, 1, 1, 1],
    })
    runtime.setLayerWeight(0, 0.35)
    const evaluation = runtime.update(0)
    expect(evaluation.layers[0]?.stateName).toBe('Move')
    expect(evaluation.clips.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(0.35)
    expect(runtime.getLayerWeight(0)).toBeCloseTo(0.35)
  })

  it('rechecks a looping exit time on each loop instead of leaving it permanently open', () => {
    const definition = controller()
    Object.assign(definition.stateMachines[0]!.states[0]!.transitions[0]!, {
      hasExitTime: true,
      exitTime: 0.75,
    })
    const runtime = new AnimatorControllerRuntime(definition, {
      clipDurations: [1, 1, 1, 1],
    })
    runtime.update(0.8)
    runtime.update(0.3)
    runtime.setFloat('Speed', 1)
    expect(runtime.update(0).layers[0]?.stateName).toBe('Idle')
    expect(runtime.update(0.65).layers[0]?.stateName).toBe('Move')
  })

  it('uses center and angular interpolation for Simple Directional 2D', () => {
    const runtime = new AnimatorControllerRuntime(
      blendController('simple-directional-2d', [
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
      { clipDurations: [1, 1, 1] },
    )
    runtime.setFloat('X', 0.5)
    const clips = runtime.update(0).clips
    expect(clips.find(sample => sample.animationIndex === 0)?.weight).toBeCloseTo(0.5)
    expect(clips.find(sample => sample.animationIndex === 1)?.weight).toBeCloseTo(0.5)
    expect(clips.find(sample => sample.animationIndex === 2)).toBeUndefined()
  })

  it('uses polar gradient bands for Freeform Directional 2D', () => {
    const runtime = new AnimatorControllerRuntime(
      blendController('freeform-directional-2d', [
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
      { clipDurations: [1, 1, 1] },
    )
    runtime.setFloat('X', 1.5)
    const clips = runtime.update(0).clips
    expect(clips.find(sample => sample.animationIndex === 0)).toBeUndefined()
    expect(clips.find(sample => sample.animationIndex === 1)?.weight).toBeCloseTo(0.5)
    expect(clips.find(sample => sample.animationIndex === 2)?.weight).toBeCloseTo(0.5)
  })

  it('uses Cartesian gradient bands for Freeform Cartesian 2D', () => {
    const runtime = new AnimatorControllerRuntime(
      blendController('freeform-cartesian-2d', [
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
      { clipDurations: [1, 1, 1] },
    )
    runtime.setFloat('X', 0.25)
    runtime.setFloat('Y', 0.25)
    const clips = runtime.update(0).clips
    expect(clips.find(sample => sample.animationIndex === 0)?.weight).toBeCloseTo(0.6)
    expect(clips.find(sample => sample.animationIndex === 1)?.weight).toBeCloseTo(0.2)
    expect(clips.find(sample => sample.animationIndex === 2)?.weight).toBeCloseTo(0.2)
  })
})
