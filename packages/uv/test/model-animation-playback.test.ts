import { expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import { readUvmContainer } from '../src/model/container.js'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:playback',
  options: { assetId: 'fixture/playback', sourceFormat: 'test' },
} as never

const clip = (extra: Partial<ModelAnimationClip> = {}): ModelAnimationClip => ({
  id: 'attack',
  name: 'Attack',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  channels: [
    {
      target: 'body',
      kind: 'translation',
      firstFrame: 0,
      lastFrame: 1,
      interpolation: 'linear',
      samples: [
        { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
        { frame: 1, timeSeconds: 1, value: [1, 0, 0] },
      ],
    },
  ],
  ...extra,
})

const projection = (animation: ModelAnimationClip) =>
  ({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 1,
      geometryAccess: 'decoded',
    },
    nodes: [
      {
        id: 'body',
        childIds: [],
        meshIds: ['mesh'],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        trs: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
    primitives: [
      {
        id: 'tri',
        topology: 'triangles',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    animations: [animation],
  }) as never

const playback = {
  loop: 'ping-pong',
  priority: 20,
  speedScale: 1.5,
  blendInSeconds: 0.15,
  blendOutSeconds: 0.25,
} as const

it('carries how a clip plays to UV_game_animation_clips of its animation and back', () => {
  const written = materializeUvmCore(projection(clip(playback)), request) as unknown as {
    readonly bytes: Uint8Array
    readonly document: { readonly animations: readonly { readonly extensions?: unknown }[] }
  }
  expect(written.document.animations[0]!.extensions).toEqual({ UV_game_animation_clips: playback })
  const container = readUvmContainer(written.bytes)
  const model = readUvmModel(container.document as never, container.binary, {
    maxScalarBytes: 1 << 20,
  })
  expect(model.rig.clips[0]).toMatchObject(playback)
})

it('writes no playback extension for a clip that states none, and refuses an invalid one', () => {
  const written = materializeUvmCore(projection(clip()), request) as unknown as {
    readonly document: { readonly animations: readonly { readonly extensions?: unknown }[] }
  }
  expect(written.document.animations[0]!.extensions).toBeUndefined()
  for (const extra of [{ speedScale: 0 }, { priority: 1.5 }, { blendInSeconds: -1 }])
    expect(() => materializeUvmCore(projection(clip(extra)), request)).toThrow()
})

it('carries a clip’s events to UV_game_animation_events, their node as a socket index, and back', () => {
  const events = [
    { timeSeconds: 0.5, name: 'fire_weapon', nodeId: 'body', payload: { weapon: 'cannon' } },
    { timeSeconds: 0.9, name: 'sound', durationSeconds: 0.2 },
  ]
  const written = materializeUvmCore(projection(clip({ events })), request) as unknown as {
    readonly bytes: Uint8Array
    readonly document: {
      readonly extensionsUsed: readonly string[]
      readonly animations: readonly { readonly extensions?: Record<string, unknown> }[]
    }
  }
  expect(written.document.animations[0]!.extensions?.['UV_game_animation_events']).toEqual({
    events: [
      { t: 0.5, name: 'fire_weapon', socket: 0, payload: { weapon: 'cannon' } },
      { t: 0.9, name: 'sound', duration: 0.2 },
    ],
  })
  expect(written.document.extensionsUsed).toContain('UV_game_animation_events')
  const container = readUvmContainer(written.bytes)
  const model = readUvmModel(container.document as never, container.binary, {
    maxScalarBytes: 1 << 20,
  })
  expect(model.rig.clips[0]!.events).toEqual([
    { timeSeconds: 0.5, name: 'fire_weapon', nodeId: 'node-0', payload: { weapon: 'cannon' } },
    { timeSeconds: 0.9, name: 'sound', durationSeconds: 0.2 },
  ])
  expect(() =>
    materializeUvmCore(
      projection(clip({ events: [{ timeSeconds: 0, name: 'hit', nodeId: 'missing' }] })),
      request,
    ),
  ).toThrow(/event node/)
})
