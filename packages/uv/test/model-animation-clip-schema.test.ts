import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import { materializeUvmCore } from '../src/model/materializer.js'

// The pinned normative schema, not a copy: the writer's output must satisfy what multiverse publishes.
const clipsSchema = (
  JSON.parse(
    readFileSync(
      new URL('../../../vendor/multiverse-specs/specs/model/schema/uvm.animation.schema.json', import.meta.url),
      'utf8',
    ),
  ) as { $defs: { clips: { required?: string[]; properties: Record<string, unknown> } } }
).$defs.clips

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:clip-schema',
  options: { assetId: 'fixture/clip-schema', sourceFormat: 'test' },
} as never

const clip: ModelAnimationClip = {
  id: 'attack',
  name: 'Attack 01',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  loop: 'once',
  priority: 20,
  blendInSeconds: 0.15,
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
}

const projection = {
  info: { scenes: 1, nodes: 1, meshes: 1, primitives: 1, materials: 0, textures: 0, animations: 1, geometryAccess: 'decoded' },
  nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
  meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
  primitives: [{ id: 'tri', topology: 'triangles', positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) }],
  animations: [clip],
} as never

it('writes animation playback a role-less clip may carry under the pinned #clips schema', () => {
  const written = materializeUvmCore(projection, request) as unknown as {
    readonly document: { readonly animations: readonly { readonly extensions: { UV_game_animation_clips: Record<string, unknown> } }[] }
  }
  const attached = written.document.animations[0]!.extensions.UV_game_animation_clips
  // a native name is never turned into a role: no SDK role, so no clip
  expect(attached).not.toHaveProperty('clip')
  for (const key of clipsSchema.required ?? []) expect(attached, `schema requires ${key}`).toHaveProperty(key)
  for (const key of Object.keys(attached)) expect(Object.keys(clipsSchema.properties)).toContain(key)
})
