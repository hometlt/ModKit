import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { revisionId, type ModelAnimationClip, type JsonValue } from '@modkit/sdk'
import {
  composeUvmAnimationBundle,
  attachUvmAnimationBundle,
  type UvmAnimationAttachmentRequest,
} from '../../scene/src/uvm/animation-attachment.js'
import { openUvmDocument } from '../../scene/src/uvm/document.js'
import { createRenderMaterialSampler } from '../../scene/src/materials/render-model.js'
import { renderUvm } from '../../scene/src/uvm/render.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'
import {
  readUvmAnimationClips,
  readUvmPrimitiveVisibility,
  readUvmAnimationMaterialTargets,
  materializeUvmAnimationMaterialTargets,
} from '../../uv/src/model/animation-clips.js'
import {
  readUvmContainer,
  writeUvmContainer,
  DEFAULT_UVM_CONTAINER_BUDGET,
} from '../../uv/src/model/container.js'
import { validateUvmDocument } from '../../uv/src/model/validation/index.js'
import { materializeUvmCore } from '../../uv/src/model/materializer.js'
import { appendUvmAccessors } from '../../uv/src/model/accessor-write.js'
import { snapshotModelAnimations } from '../../codec-kit/src/model/animation.js'
import {
  animationBudget,
  animationRenderRequest,
  animationFixtureBase,
  animationFixtureBundle,
  animationFixtureServices,
  animationFixtureInactiveBundle,
  needed,
  record,
  records,
} from './fixtures/uvm-animation-bundle.js'

const request: UvmAnimationAttachmentRequest = {
  id: 'bundle-one',
  clips: [
    { sourceId: 'visibility', id: 'attached-visibility', sequenceIndex: 40 },
    { sourceId: 'material-only', id: 'attached-material', sequenceIndex: 42 },
    { sourceId: 'truly-empty', id: 'attached-empty', sequenceIndex: 44 },
  ],
  nodes: [{ source: 0, target: 1 }],
  materials: [{ source: 0, target: 0 }],
  primitives: [{ source: { mesh: 0, primitive: 0 }, target: { mesh: 0, primitive: 0 } }],
}

it('attaches two bundles with explicit clip and node remaps without retaining source containers', async () => {
  const base = animationFixtureBase(),
    bundle = animationFixtureBundle(true)
  const originalBase = writeUvmContainer(base),
    originalBundle = writeUvmContainer(bundle)
  const first = await composeUvmAnimationBundle(base, bundle, request)
  expect(first.playbackLimitations).toEqual([
    'Node TRS target node-1 has no explicit skeleton binding for common scene playback',
  ])
  expect(first.clips.map(clip => [clip.id, clip.sourceSequenceIndex, clip.animation])).toEqual([
    ['attached-visibility', 40, 0],
    ['attached-material', 42, undefined],
    ['attached-empty', 44, undefined],
  ])
  const animation = needed(records(first.container.document['animations'])[0])
  const samplers = records(animation['samplers'])
  expect(needed(samplers[0])['input']).toBe(needed(samplers[1])['input'])
  expect(records(first.container.document['accessors'])).toHaveLength(
    records(base.document['accessors']).length + 3,
  )
  expect(record(needed(records(animation['channels'])[1])['target'])).toEqual({
    node: 1,
    path: 'translation',
  })
  const baseViews = records(base.document['bufferViews'])
  expect(records(first.container.document['bufferViews']).slice(0, baseViews.length)).toEqual(
    baseViews,
  )
  for (const view of records(first.container.document['bufferViews']).slice(baseViews.length))
    expect(Number(view['byteOffset']) % 4).toBe(0)
  expect(first.container.document['extras']).toEqual(base.document['extras'])
  expect(first.container.extraChunks).toEqual(base.extraChunks)
  expect(record(first.container.document['extensions'])['UV_source_blob']).toBeUndefined()
  const second = await composeUvmAnimationBundle(first.container, bundle, {
    ...request,
    id: 'bundle-two',
    clips: [{ sourceId: 'truly-empty', id: 'second-empty', sequenceIndex: 90 }],
    materials: [],
    nodes: [],
    primitives: [],
  })
  expect(readUvmAnimationClips(second.container.document)?.map(clip => clip.id)).toEqual([
    'base-empty',
    'attached-visibility',
    'attached-material',
    'attached-empty',
    'second-empty',
  ])
  expect(record(second.container.document['extensions'])['UV_source_blob']).toBeUndefined()
  expect(writeUvmContainer(base)).toEqual(originalBase)
  expect(writeUvmContainer(bundle)).toEqual(originalBundle)
  validateUvmDocument(second.container.document, {
    binaryByteLength: second.container.binary.length,
  })
})

it('preserves base and source clip extras and unknown fields while changing only explicit attachment identities', async () => {
  const annotate = (container: ReturnType<typeof animationFixtureBase>, marker: string) => {
    const extensions = record(container.document['extensions']),
      catalog = record(extensions['UV_game_animation_clips'])
    return {
      ...container,
      document: {
        ...container.document,
        extensions: {
          ...extensions,
          UV_game_animation_clips: {
            ...catalog,
            clips: records(catalog['clips']).map(clip => ({
              ...clip,
              extras: { marker, retained: [1, 'x', { flag: true }] },
              futureClipMetadata: { owner: marker },
            })),
          },
        },
      },
    }
  }
  const base = annotate(animationFixtureBase(), 'base'),
    source = annotate(animationFixtureBundle(), 'source')
  const originalBase = writeUvmContainer(base)
  const result = await composeUvmAnimationBundle(base, source, request)
  const clips = records(
    record(record(result.container.document['extensions'])['UV_game_animation_clips'])['clips'],
  )
  expect(needed(clips[0])).toEqual(
    needed(
      records(record(record(base.document['extensions'])['UV_game_animation_clips'])['clips'])[0],
    ),
  )
  for (const clip of clips.slice(1)) {
    expect(clip['extras']).toEqual({ marker: 'source', retained: [1, 'x', { flag: true }] })
    expect(clip['futureClipMetadata']).toEqual({ owner: 'source' })
  }
  expect(needed(clips[1])['sourceSequenceIndex']).toBe(40)
  expect(needed(clips[1])['id']).toBe('attached-visibility')
  expect(record(result.container.document['extensions'])['UV_source_blob']).toBeUndefined()
  expect(writeUvmContainer(base)).toEqual(originalBase)
})

it('owns bundle data and mappings before composition and commits attachment through undo/redo/reopen', async () => {
  const base = animationFixtureBase(),
    bundle = animationFixtureBundle()
  const original = writeUvmContainer(base),
    source = writeUvmContainer(bundle)
  const document = openUvmDocument(original)
  const mutable = structuredClone(request)
  const pending = attachUvmAnimationBundle(document, 0, bundle, mutable)
  bundle.binary.fill(99)
  Object.assign(mutable, { id: 'mutated', clips: [] })
  const attached = await pending
  expect(attached.status.revision).toBe(1)
  const written = document.serialize(1)
  expect(record(document.snapshot().document['extensions'])['UV_source_blob']).toBeUndefined()
  expect(writeUvmContainer(bundle)).not.toEqual(source)
  const reopened = readUvmContainer(written)
  expect(
    readUvmModel(reopened.document, reopened.binary, animationBudget).rig.clips.map(clip => [
      clip.id,
      clip.sequenceIndex,
      clip.channels.length,
    ]),
  ).toEqual([
    ['base-empty', 0, 0],
    ['attached-visibility', 40, 1],
    ['attached-material', 42, 0],
    ['attached-empty', 44, 0],
  ])
  document.undo(1)
  expect(document.serialize(2)).toEqual(original)
  document.redo(2)
  expect(document.serialize(3)).toEqual(written)
  document.dispose()
})

it('rejects a concurrent document edit after preparation without overwriting it or creating attachment history', async () => {
  const document = openUvmDocument(writeUvmContainer(animationFixtureBase()))
  const pending = attachUvmAnimationBundle(document, 0, animationFixtureBundle(), request)
  document.apply({
    expectedRevision: 0,
    json: [{ op: 'add', path: '/extras/concurrent', value: 'preserved' }],
  })
  const before = document.serialize(1)
  await expect(pending).rejects.toThrow('stale')
  expect(document.serialize(1)).toEqual(before)
  expect(readUvmAnimationClips(document.snapshot().document)).toHaveLength(1)
  document.undo(1)
  expect(document.status().canUndo).toBe(false)
  document.dispose()
})

it('captures the attachment signal before async hashing instead of rereading caller options', async () => {
  const document = openUvmDocument(writeUvmContainer(animationFixtureBase()))
  const original = new AbortController(),
    replacement = new AbortController()
  replacement.abort(new Error('replacement signal must not apply'))
  const options = { signal: original.signal }
  const pending = attachUvmAnimationBundle(document, 0, animationFixtureBundle(), request, options)
  options.signal = replacement.signal
  expect((await pending).status.revision).toBe(1)
  document.dispose()
})

it.each([
  ['unknown clip', { clips: [{ sourceId: 'absent', id: 'new', sequenceIndex: 40 }] }, /unknown/u],
  [
    'duplicate destination',
    { clips: [{ sourceId: 'visibility', id: 'base-empty', sequenceIndex: 40 }] },
    /duplicate/u,
  ],
  [
    'sequence collision',
    { clips: [{ sourceId: 'visibility', id: 'new', sequenceIndex: 0 }] },
    /duplicate/u,
  ],
  ['missing node map', { nodes: [] }, /node mapping/u],
  ['missing primitive map', { primitives: [] }, /primitive mapping/u],
  ['missing material map', { materials: [] }, /material mapping/u],
  ['unknown mapping field', { nodes: [{ source: 0, target: 1, guess: true }] }, /unknown/u],
] as const)('refuses %s atomically', async (_label, change, message) => {
  const document = openUvmDocument(writeUvmContainer(animationFixtureBase()))
  const original = document.serialize(0),
    status = document.status()
  await expect(
    attachUvmAnimationBundle(document, 0, animationFixtureBundle(true), { ...request, ...change }),
  ).rejects.toThrow(message)
  expect(document.status()).toEqual(status)
  expect(document.serialize(0)).toEqual(original)
  document.dispose()
})

it('rejects exhausted working/output budgets, cancellation and malformed animation output without partial results', async () => {
  const base = animationFixtureBase(),
    bundle = animationFixtureBundle()
  await expect(
    composeUvmAnimationBundle(base, bundle, request, { maxWorkingBytes: 1 }),
  ).rejects.toThrow('maxWorkingBytes')
  await expect(
    composeUvmAnimationBundle(base, bundle, request, {
      budget: { ...DEFAULT_UVM_CONTAINER_BUDGET, maxInputBytes: 16 },
    }),
  ).rejects.toThrow('maxInputBytes')
  const controller = new AbortController()
  const beforeBase = writeUvmContainer(base),
    beforeBundle = writeUvmContainer(bundle)
  const pending = composeUvmAnimationBundle(base, bundle, request, { signal: controller.signal })
  controller.abort(new Error('attachment cancelled'))
  await expect(pending).rejects.toThrow('attachment cancelled')
  expect(writeUvmContainer(base)).toEqual(beforeBase)
  expect(writeUvmContainer(bundle)).toEqual(beforeBundle)
  const accessors = records(bundle.document['accessors']).map((accessor, index) =>
    index === 4 ? { ...accessor, count: 1 } : accessor,
  )
  await expect(
    composeUvmAnimationBundle(
      base,
      { ...bundle, document: { ...bundle.document, accessors } },
      request,
    ),
  ).rejects.toThrow()
})

it.each(['LINEAR', 'CUBICSPLINE'] as const)(
  'refuses non-unit quaternion values for %s without confusing cubic tangents with rotations',
  async interpolation => {
    const source = animationFixtureBundle(true)
    const quaternions =
      interpolation === 'LINEAR'
        ? Float32Array.of(0, 0, 0, 2, 0, 0, 0, 1)
        : Float32Array.of(5, 5, 5, 5, 0, 0, 0, 2, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 1, 5, 5, 5, 5)
    const appended = appendUvmAccessors(source, [{ type: 'VEC4', values: quaternions }])
    const animation = needed(records(source.document['animations'])[0])
    const document = {
      ...source.document,
      accessors: needed(appended.container.document['accessors']),
      bufferViews: needed(appended.container.document['bufferViews']),
      buffers: needed(appended.container.document['buffers']),
      animations: [
        {
          ...animation,
          samplers: records(animation['samplers']).map((sampler, index) =>
            index === 1
              ? { ...sampler, output: needed(appended.accessors[0]), interpolation }
              : sampler,
          ),
          channels: records(animation['channels']).map((channel, index) =>
            index === 1 ? { ...channel, target: { node: 0, path: 'rotation' } } : channel,
          ),
        },
      ],
    }
    await expect(
      composeUvmAnimationBundle(
        animationFixtureBase(),
        { ...appended.container, document },
        request,
      ),
    ).rejects.toThrow('unit quaternion')
    if (interpolation === 'CUBICSPLINE') {
      quaternions[7] = 1
      const valid = appendUvmAccessors(source, [{ type: 'VEC4', values: quaternions }])
      const result = await composeUvmAnimationBundle(
        animationFixtureBase(),
        {
          ...valid.container,
          document: {
            ...document,
            accessors: needed(valid.container.document['accessors']),
            bufferViews: needed(valid.container.document['bufferViews']),
            buffers: needed(valid.container.document['buffers']),
          },
        },
        request,
      )
      expect(result.playbackLimitations.some(message => message.startsWith('CUBICSPLINE'))).toBe(
        true,
      )
    }
  },
)

it('retains channel-less clips in materializer output with source identity and non-positional material sequence indices', () => {
  const clip: ModelAnimationClip = {
    id: 'native-empty',
    name: 'Empty',
    kind: 'animation',
    provenance: 'direct',
    frames: 0,
    durationSeconds: 3,
    sequenceIndex: 71,
    channels: [],
  }
  const output = materializeUvmCore(
    {
      info: {
        scenes: 0,
        nodes: 0,
        meshes: 0,
        primitives: 0,
        materials: 0,
        textures: 0,
        animations: 1,
        geometryAccess: 'decoded',
      },
      nodes: [],
      meshes: [],
      primitives: [],
      animations: [clip],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: revisionId('provider-token:clip-catalog'),
      options: { assetId: 'fixture/empty', sourceFormat: 'facets' },
    },
  )
  const container = readUvmContainer(output.bytes)
  expect(container.document['animations']).toBeUndefined()
  expect(readUvmAnimationClips(container.document)).toEqual([
    {
      id: 'sequence-71',
      name: 'Empty',
      sourceId: 'native-empty',
      durationSeconds: 3,
      sourceSequenceIndex: 71,
      kind: 'animation',
      frames: 0,
    },
  ])
  expect(output.receipt.lostFacetIds).not.toContain('common.view/model-animation-source@1')
  for (const sequenceIndex of [-1, 1.2])
    expect(() => snapshotModelAnimations([{ ...clip, sequenceIndex }])).toThrow('sequence')
  expect(() => snapshotModelAnimations([{ ...clip, sequenceIndex: Infinity }])).toThrow('non-JSON')
})

it('materializes native-neutral visibility facets into actual primitive pointers and reopens their scalar clock semantics', () => {
  const base = animationFixtureBase()
  const scene = readUvmModel(base.document, base.binary, animationBudget).scene
  const clip: ModelAnimationClip = {
    id: 'visibility-source',
    name: 'Visibility',
    kind: 'animation',
    provenance: 'direct',
    frames: 2,
    durationSeconds: 2,
    sequenceIndex: 15,
    channels: [
      {
        target: 'mesh-0-primitive-0',
        kind: 'visibility',
        firstFrame: 0,
        lastFrame: 1,
        interpolation: 'step',
        concurrent: true,
        wrapSeconds: 2,
        samples: [
          { frame: 0, timeSeconds: 0, value: [2] },
          { frame: 1, timeSeconds: 1, value: [-1] },
        ],
      },
    ],
  }
  const output = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 2,
        meshes: 1,
        primitives: 1,
        materials: 1,
        textures: 0,
        animations: 1,
        geometryAccess: 'decoded',
      },
      nodes: scene.nodes,
      meshes: scene.meshes,
      primitives: scene.primitives,
      animations: [clip],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: revisionId('provider-token:visibility'),
      options: { assetId: 'fixture/visibility', sourceFormat: 'facets' },
    },
  )
  const converted = readUvmContainer(output.bytes)
  validateUvmDocument(converted.document, { binaryByteLength: converted.binary.length })
  expect(readUvmPrimitiveVisibility(converted.document)).toEqual([
    { mesh: 0, primitive: 0, value: 1 },
  ])
  const reopened = needed(
    readUvmModel(converted.document, converted.binary, animationBudget).rig.clips[0],
  )
  expect(reopened.sequenceIndex).toBe(15)
  expect(reopened.channels).toEqual(clip.channels)
  expect(output.receipt.lostFacetIds).not.toContain('common.view/model-animation-source@1')
})

it.each([
  'omitted-linked',
  'duplicate-id',
  'duplicate-sequence',
  'invalid-link',
  'empty-animation',
] as const)('refuses malformed complete catalog: %s', kind => {
  const bundle = animationFixtureBundle(),
    extensions = record(bundle.document['extensions']),
    catalog = record(extensions['UV_game_animation_clips'])
  let clips = [...records(catalog['clips'])]
  if (kind === 'omitted-linked') clips = clips.slice(1)
  if (kind === 'duplicate-id') clips = [...clips, { ...needed(clips[1]), sourceSequenceIndex: 99 }]
  if (kind === 'duplicate-sequence') clips = [...clips, { ...needed(clips[1]), id: 'different' }]
  if (kind === 'invalid-link') clips = [{ ...needed(clips[0]), animation: 99 }, ...clips.slice(1)]
  const animations =
    kind === 'empty-animation'
      ? [{ channels: [], samplers: [] }]
      : needed(bundle.document['animations'])
  expect(() =>
    validateUvmDocument({
      ...bundle.document,
      animations,
      extensions: { ...extensions, UV_game_animation_clips: { ...catalog, clips } },
    }),
  ).toThrow()
})

it('attaches neutral inactive material slots with explicit sourceKind and refuses resource paths or orphan sequences', async () => {
  const source = animationFixtureInactiveBundle(),
    base = animationFixtureBase()
  validateUvmDocument(source.document, { binaryByteLength: source.binary.length })
  expect(source.document['materials']).toBeUndefined()
  const slots = readUvmAnimationMaterialTargets(source.document)
  expect(slots).toHaveLength(1)
  expect(needed(slots[0]).id).toBe('inactive-material')
  expect(needed(slots[0]).properties.map(property => property.path)).toEqual([
    '/renderModel/standard/layers/diffuse/constantColor',
  ])
  const mapping: UvmAnimationAttachmentRequest = {
    id: 'inactive',
    clips: [{ sourceId: 'material-only', id: 'material-slot', sequenceIndex: 55 }],
    materials: [{ sourceKind: 'animation-target', source: 0, target: 0 }],
  }
  const output = await composeUvmAnimationBundle(base, source, mapping)
  expect(records(output.container.document['materials'])).toHaveLength(1)
  expect(output.container.document['animations']).toBeUndefined()
  expect(output.clips.map(clip => [clip.id, clip.animation, clip.sourceSequenceIndex])).toEqual([
    ['material-slot', undefined, 55],
  ])
  await expect(
    composeUvmAnimationBundle(base, source, { ...mapping, materials: [{ source: 0, target: 0 }] }),
  ).rejects.toThrow('source material target')
  const extensions = record(source.document['extensions']),
    catalog = record(extensions['UV_game_animation_clips'])
  for (const properties of [
    [{ path: '/renderModel/standard/layers/diffuse/texturePath', value: 1, sequenceTracks: [] }],
    needed(slots[0]).properties.map(property => ({
      ...property,
      sequenceTracks: property.sequenceTracks.map(track => ({ ...track, sequenceIndex: 999 })),
    })),
  ])
    expect(() =>
      validateUvmDocument({
        ...source.document,
        extensions: {
          ...extensions,
          UV_game_animation_clips: { ...catalog, materialTargets: [{ id: 'bad', properties }] },
        },
      }),
    ).toThrow()
})

it('does not reinterpret slash or tilde-bearing unknown material keys as published animation paths', () => {
  const property = {
    value: [1, 0, 0, 1],
    sequenceTracks: [
      {
        sequenceIndex: 11,
        track: { lineType: 1, globalSeqId: null, keys: [{ frame: 0, vector: [1, 0, 0, 1] }] },
      },
    ],
  }
  const parameters = {
    renderModel: {
      version: 1,
      'standard/layers/diffuse/constantColor': property,
      'standard~1layers~1diffuse~1constantColor': property,
      standard: { layers: { 'diffuse/constantColor': property } },
      extras: { standard: { layers: { diffuse: { constantColor: property } } } },
    },
  }
  const before = structuredClone(parameters)
  expect(
    materializeUvmAnimationMaterialTargets([
      { id: 'unknown-path', shader: { id: 'modkit.render-material.v1', parameters } },
    ]),
  ).toEqual([])
  expect(parameters).toEqual(before)
})

it('refuses unsupported render material versions before extracting inactive animation properties', () => {
  const source = animationFixtureBundle()
  const material = needed(records(source.document['materials'])[0])
  const shader = record(record(material['extensions'])['UV_game_material'])
  const original = record(shader['params'])
  for (const version of [2, '1', null]) {
    const parameters = { ...original, renderModel: { ...record(original['renderModel']), version } }
    const before = structuredClone(parameters)
    expect(() =>
      materializeUvmAnimationMaterialTargets([
        { id: 'unknown-version', shader: { id: 'modkit.render-material.v1', parameters } },
      ]),
    ).toThrow('unsupported animation material version')
    expect(parameters).toEqual(before)
  }
})

describe('UVM bundle animation through the ordinary shared renderer', () => {
  let services: Awaited<ReturnType<typeof animationFixtureServices>>
  beforeAll(async () => {
    services = await animationFixtureServices()
  }, 60000)
  afterAll(async () => {
    await services?.release()
  })
  it('selects material-only and empty clips and renders scalar primitive visibility with independent nonempty coverage/color oracles', async () => {
    const original = writeUvmContainer(animationFixtureBase())
    const result = await composeUvmAnimationBundle(
      readUvmContainer(original),
      animationFixtureBundle(),
      request,
    )
    const bytes = writeUvmContainer(result.container)
    const render = async (clipId: string, time: number) =>
      renderUvm(
        bytes,
        { ...animationRenderRequest, clipId, time },
        { contracts: services.port, budget: animationBudget },
      )
    const red = await render('base-empty', 1),
      green = await render('attached-material', 1),
      empty = await render('attached-empty', 1)
    expect(red.statistics.fragments).toBeGreaterThan(0)
    expect(green.statistics.fragments).toBe(red.statistics.fragments)
    expect(empty.rgba).toEqual(red.rgba)
    let covered = 0
    for (let offset = 0; offset < red.rgba.length; offset += 4)
      if (red.rgba[offset + 3] === 255) {
        covered++
        expect([...red.rgba.slice(offset, offset + 4)]).toEqual([255, 0, 0, 255])
        expect([...green.rgba.slice(offset, offset + 4)]).toEqual([0, 255, 0, 255])
      }
    expect(covered).toBeGreaterThan(0)
    const visible = await render('attached-visibility', 0),
      hidden = await render('attached-visibility', 1)
    expect(visible.rgba).toEqual(red.rgba)
    expect(hidden.statistics.fragments).toBe(0)
    expect(hidden.rgba.every(value => value === 0)).toBe(true)
    expect(
      visible.diagnostics.some(value => value.code.endsWith('animation-channels-unrendered')),
    ).toBe(false)
    expect(readUvmPrimitiveVisibility(result.container.document)).toEqual([
      { mesh: 0, primitive: 0, value: 1 },
    ])
    expect(writeUvmContainer(result.container)).toEqual(bytes)
  })
  it('plays a material-only clip attached from a geometry-free neutral bundle', async () => {
    const result = await composeUvmAnimationBundle(
      animationFixtureBase(),
      animationFixtureInactiveBundle(),
      {
        id: 'inactive-render',
        clips: [{ sourceId: 'material-only', id: 'slot-animation', sequenceIndex: 57 }],
        materials: [{ sourceKind: 'animation-target', source: 0, target: 0 }],
      },
    )
    const frame = await renderUvm(
      writeUvmContainer(result.container),
      { ...animationRenderRequest, clipId: 'slot-animation', time: 1 },
      { contracts: services.port, budget: animationBudget },
    )
    expect(frame.statistics.fragments).toBeGreaterThan(0)
    for (let offset = 0; offset < frame.rgba.length; offset += 4)
      if (frame.rgba[offset + 3] === 255)
        expect([...frame.rgba.slice(offset, offset + 4)]).toEqual([0, 255, 0, 255])
  })
})


describe('emissive gain animation attachment', () => {
  const scalarBudget = { maxDepth: 64, maxNodes: 100000, maxBytes: 10000000 }
  const paramsOf = (container: ReturnType<typeof animationFixtureBase>) => record(record(
    record(needed(records(container.document['materials'])[0]))['extensions'],
  )['UV_game_material'])['params']
  const fixture = (composite: boolean, animated: boolean, gainOverride?: JsonValue): ReturnType<typeof animationFixtureBase> => {
    const container = animationFixtureBase()
    const params = record(paramsOf(container)), model = record(params['renderModel'])
    const gain = gainOverride === undefined ? (animated ? { value: -0.5, sequenceTracks: [{ sequenceIndex: 3,
      track: { lineType: 1, globalSeqId: null,
        keys: [{ frame: 0, vector: [0] }, { frame: 1, vector: [2] }] },
    }] } : 1.5) : gainOverride
    const standard = { ...record(model['standard']), emisMult: gain }
    const { standard: _standard, ...withoutStandard } = model
    void _standard
    const renderModel = composite
      ? { ...withoutStandard, composite: { priority: 0, passes: [{ material: standard, alphaFactor: { value: 1 } }] } }
      : { ...model, standard }
    const extensions = record(container.document['extensions'])
    return { ...container, document: { ...container.document,
      materials: records(container.document['materials']).map(value => ({ ...value,
        extensions: { ...record(value['extensions']), UV_game_material: {
          ...record(record(value['extensions'])['UV_game_material']), params: { ...params, renderModel },
        } },
      })),
      extensions: { ...extensions, UV_game_animation_clips: {
        ...record(extensions['UV_game_animation_clips']), ...(animated ? { clips: [
          { id: 'gain', name: 'Gain', durationSeconds: 1, sourceSequenceIndex: 3 },
        ] } : {}),
      } },
    } }
  }
  const gainOf = (params: unknown, composite: boolean) => {
    const model = record(record(params)['renderModel'])
    return composite
      ? record(needed(records(record(model['composite'])['passes'])[0])['material'])['emisMult']
      : record(model['standard'])['emisMult']
  }
  const mapping = (inactive: boolean): UvmAnimationAttachmentRequest => ({
    id: 'gain-bundle', clips: [{ sourceId: 'gain', id: 'attached-gain', sequenceIndex: 41 }],
    materials: [{ sourceKind: inactive ? 'animation-target' : 'material', source: 0, target: 0 }],
  })
  it.each([[false, false], [true, false], [false, true], [true, true]] as const)(
    'owns numeric fallback through encoded %s composite / %s inactive attachment and reopen', async (composite, inactive) => {
      const base = fixture(composite, false)
      let source = fixture(composite, true)
      if (inactive) {
        const params = record(paramsOf(source))
        const targets = materializeUvmAnimationMaterialTargets([{ id: 'gain-slot', shader: {
          id: 'modkit.render-material.v1', parameters: params,
        } }])
        const catalog = record(record(source.document['extensions'])['UV_game_animation_clips'])
        source = { ...source, document: { asset: source.document['asset']!, buffers: source.document['buffers']!,
          extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_animation_clips'],
          extensions: { ...record(source.document['extensions']),
            UV_game_animation_clips: { ...catalog, materialTargets: JSON.parse(JSON.stringify(targets)) },
          },
        } }
      }
      const originalBase = writeUvmContainer(base), originalSource = writeUvmContainer(source)
      // Both inputs are parsed bytes, not the original facet JSON used to make them.
      const document = openUvmDocument(originalBase)
      const parsedSource = readUvmContainer(originalSource)
      try {
        await attachUvmAnimationBundle(document, 0, parsedSource, mapping(inactive))
        const written = document.serialize(1), reopened = readUvmContainer(written)
        validateUvmDocument(reopened.document, { binaryByteLength: reopened.binary.byteLength })
        const model = readUvmModel(reopened.document, reopened.binary, animationBudget)
        expect(model.rig.clips.map(clip => [clip.id, clip.sequenceIndex])).toEqual([
          ['base-empty', 0], ['attached-gain', 41],
        ])
        const params = record(paramsOf(reopened)), gain = record(gainOf(params, composite))
        expect(gain['value']).toBe(1.5)
        expect(records(gain['sequenceTracks']).map(track => track['sequenceIndex'])).toEqual([41])
        const sampler = createRenderMaterialSampler(params, scalarBudget)
        expect(sampler.sample({ time: 0.5, sequenceIndex: 41 })[0]!.material.emisMult).toBe(1)
        expect(sampler.sample({ time: 0.5, sequenceIndex: 0 })[0]!.material.emisMult).toBe(1.5)
        expect(sampler.sample({ time: 0.5 })[0]!.material.emisMult).toBe(1.5)
        expect(sampler.sample({ time: 0.5, sequenceIndex: 41 })[0]!.material.emisMult).toBe(1)
        expect(writeUvmContainer(reopened)).toEqual(written)
        expect(writeUvmContainer(base)).toEqual(originalBase)
        expect(writeUvmContainer(source)).toEqual(originalSource)
        expect(writeUvmContainer(parsedSource)).toEqual(originalSource)
        document.undo(1)
        expect(document.serialize(2)).toEqual(originalBase)
        document.redo(2)
        expect(document.serialize(3)).toEqual(written)
      } finally { document.dispose() }
    },
  )
  it('keeps numeric source properties inert without selected tracks', async () => {
    const base = fixture(false, false), source = fixture(false, true, 7)
    const before = writeUvmContainer(base), sourceBefore = writeUvmContainer(source)
    const output = await composeUvmAnimationBundle(base, source, mapping(false))
    expect(gainOf(paramsOf(output.container), false)).toBe(1.5)
    expect(writeUvmContainer(base)).toEqual(before)
    expect(writeUvmContainer(source)).toEqual(sourceBefore)
  })
  it('refuses absent parent, malformed target, duplicate sequences and legacy fallback atomically', async () => {
    for (const kind of ['parent', 'null', 'width', 'collision', 'legacy', 'mapping'] as const) {
      let gain: JsonValue | undefined
      if (kind === 'null') gain = null
      if (kind === 'width') gain = { value: [1, 2] }
      if (kind === 'collision') gain = { value: 1.5, sequenceTracks: [
          { sequenceIndex: 41, track: { lineType: 1, globalSeqId: null,
            keys: [{ frame: 0, vector: [1] }] } },
        ] }
      if (kind === 'legacy') gain = { value: 1.5, track: {
        lineType: 1, globalSeqId: null, keys: [{ frame: 0, vector: [1] }],
      } }
      let base = fixture(kind === 'parent', false, gain)
      const source = fixture(false, true)
      if (kind === 'collision') base = { ...base, document: { ...base.document,
        extensions: { ...record(base.document['extensions']), UV_game_animation_clips: { clips: [
          { id: 'base-empty', name: 'Base', durationSeconds: 1, sourceSequenceIndex: 0 },
          { id: 'existing', name: 'Existing', durationSeconds: 1, sourceSequenceIndex: 41 },
        ] } },
      } }
      const before = writeUvmContainer(base), sourceBefore = writeUvmContainer(source)
      await expect(composeUvmAnimationBundle(base, source,
        kind === 'mapping' ? { ...mapping(false), materials: [] } : mapping(false))).rejects.toThrow()
      expect(writeUvmContainer(base)).toEqual(before)
      expect(writeUvmContainer(source)).toEqual(sourceBefore)
    }
  })
})
