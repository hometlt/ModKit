import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import { readUvmContainer } from '../src/model/container.js'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmAnimationClips } from '../src/model/animation-clips.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'

// The pinned normative schema, not a copy: the writer's output must satisfy what multiverse publishes.
interface SchemaObject {
  required?: string[]
  properties: Record<string, unknown>
  pattern?: string
  items?: { pattern: string }
}
const { $defs } = JSON.parse(
  readFileSync(
    new URL('../../../vendor/multiverse-specs/specs/model/schema/uvm.animation.schema.json', import.meta.url),
    'utf8',
  ),
) as { $defs: Record<'clips' | 'catalogClip' | 'clipRole' | 'clipTags', SchemaObject> }

function conforms(value: Record<string, unknown>, schema: SchemaObject): void {
  for (const key of schema.required ?? []) expect(value, `schema requires ${key}`).toHaveProperty(key)
  for (const key of Object.keys(value)) expect(Object.keys(schema.properties)).toContain(key)
  if (value['role'] !== undefined)
    expect(value['role']).toMatch(new RegExp($defs.clipRole.pattern!, 'u'))
  for (const tag of (value['tags'] as string[] | undefined) ?? [])
    expect(tag).toMatch(new RegExp($defs.clipTags.items!.pattern, 'u'))
}

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:clip-roles',
  options: { assetId: 'fixture/clip-roles', sourceFormat: 'test' },
} as never

const clip = (extra: Partial<ModelAnimationClip> = {}): ModelAnimationClip => ({
  id: 'attack',
  name: 'Attack 01',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  loop: 'once',
  priority: 20,
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
    info: { scenes: 1, nodes: 1, meshes: 1, primitives: 1, materials: 0, textures: 0, animations: 1, geometryAccess: 'decoded' },
    nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
    primitives: [{ id: 'tri', topology: 'triangles', positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) }],
    animations: [animation],
  }) as never

type Written = {
  readonly bytes: Uint8Array
  readonly document: {
    readonly animations: readonly { readonly extensions: { UV_game_animation_clips: Record<string, unknown> } }[]
    readonly extensions: { UV_game_animation_clips: { clips: Record<string, unknown>[] } }
  }
}

it('writes role-less playback that the pinned #clips schema admits', () => {
  const written = materializeUvmCore(projection(clip()), request) as unknown as Written
  const attached = written.document.animations[0]!.extensions.UV_game_animation_clips
  // a native name is never turned into a role
  expect(attached).not.toHaveProperty('clip')
  conforms(attached, $defs.clips)
  conforms(written.document.extensions.UV_game_animation_clips.clips[0]!, $defs.catalogClip)
})

it('carries a stated role and tags on the catalog record and back to the model', () => {
  const tags = ['moving', 'sage:suppressed', 'sc2:Attack Slow']
  const written = materializeUvmCore(projection(clip({ role: 'attack', tags })), request) as unknown as Written
  const record = written.document.extensions.UV_game_animation_clips.clips[0]!
  expect(record).toMatchObject({ role: 'attack', tags })
  conforms(record, $defs.catalogClip)
  const container = readUvmContainer(written.bytes)
  expect(readUvmAnimationClips(container.document)![0]).toMatchObject({ role: 'attack', tags })
  const model = readUvmModel(container.document as never, container.binary, { maxScalarBytes: 1 << 20 })
  expect(model.rig.clips[0]).toMatchObject({ role: 'attack', tags })
})

it('refuses an invalid role or tag set on capture and on reopen', () => {
  for (const extra of [
    { role: 'Attack 01' },
    { role: 'sage:DYING' },
    { tags: ['Damaged'] },
    { tags: ['left', 'left'] },
    { tags: ['sage:'] },
    { tags: ['sc2:line\nbreak'] },
  ])
    expect(() => materializeUvmCore(projection(clip(extra as never)), request)).toThrow()
  const written = materializeUvmCore(projection(clip({ role: 'attack' })), request) as unknown as Written
  const container = readUvmContainer(written.bytes)
  for (const [key, value] of [['role', 'attack\n'], ['tags', ['Damaged']]] as const) {
    const document = structuredClone(container.document) as never as Written['document']
    document.extensions.UV_game_animation_clips.clips[0]![key] = value
    expect(() => readUvmAnimationClips(document as never)).toThrow(/metadata/)
  }
})

it('requires an animation-attached role or tags to agree with its catalog record', () => {
  const written = materializeUvmCore(
    projection(clip({ role: 'attack', tags: ['left', 'fast'] })),
    request,
  ) as unknown as Written
  const container = readUvmContainer(written.bytes)
  const agreeing = structuredClone(container.document) as never as Written['document']
  Object.assign(agreeing.animations[0]!.extensions.UV_game_animation_clips, { clip: 'attack', tags: ['fast', 'left'] })
  expect(readUvmAnimationClips(agreeing as never)![0]!.role).toBe('attack')
  for (const disagreement of [{ clip: 'move' }, { tags: ['left'] }]) {
    const document = structuredClone(container.document) as never as Written['document']
    Object.assign(document.animations[0]!.extensions.UV_game_animation_clips, disagreement)
    expect(() => readUvmAnimationClips(document as never)).toThrow(/disagree/)
  }
})
