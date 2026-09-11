import { describe, expect, it } from 'vitest'
import type { JsonObject, JsonValue } from '@modkit/sdk'
import { validateUvmDocument } from '../../uv/src/model/validation/index.js'
import { readUvmFacets } from '../../scene/src/uvm/facets.js'
import { readUvmContainer, writeUvmContainer } from '../../uv/src/model/container.js'
import { prepareUvmJsonEdits } from '../../scene/src/uvm/operations.js'

const budget = { maxScalarBytes: 1_000_000 }
const baseExtensions: JsonObject = {
  UV_asset: { id: 'test/shared-uvm', class: 'model' },
  UV_provenance: { source: { format: 'test' }, importer: { id: 'test', version: '1' } },
}
function document(extra: JsonObject = {}, extensions: JsonObject = {}): JsonObject {
  return {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    extensionsUsed: [...Object.keys(baseExtensions), ...Object.keys(extensions)],
    extensions: { ...baseExtensions, ...extensions },
    ...extra,
  }
}
function pointerDocument(
  value: JsonValue,
  pointer = '/extras/value',
  output: JsonObject = {},
): JsonObject {
  return document({
    extras: { value },
    extensionsUsed: [...Object.keys(baseExtensions), 'KHR_animation_pointer'],
    accessors: [
      { componentType: 5126, count: 1, type: 'SCALAR' },
      { componentType: 5126, count: 1, type: 'SCALAR', ...output },
    ],
    animations: [
      {
        samplers: [{ input: 0, output: 1 }],
        channels: [
          {
            sampler: 0,
            target: { path: 'pointer', extensions: { KHR_animation_pointer: { pointer } } },
          },
        ],
      },
    ],
  })
}

describe('shared UVM profile and extension validation', () => {
  it.each([
    'UV_game_material',
    'UV_game_material_team_color',
    'UV_game_socket',
    'UV_game_collision',
    'UV_game_effects',
    'KHR_animation_pointer',
  ])('rejects %s declared without metadata', name => {
    expect(() =>
      validateUvmDocument(document({ extensionsUsed: [...Object.keys(baseExtensions), name] })),
    ).toThrow(/declared but absent/u)
  })

  it('keeps unknown JSON extras inert and preserves them through validated editing', () => {
    const original = document(
      {
        extras: { BlizzardM3: { unknown: ['opaque', { nativeFlags: 4_294_967_295 }] } },
        nodes: [{ extras: 17 }],
        materials: [{ extras: [1, 'future'] }],
      },
      { VENDOR_future: { payload: [false, null, 'untouched'] } },
    )
    const bytes = writeUvmContainer({
      format: 'glb',
      document: original,
      binary: new Uint8Array(),
      extraChunks: [],
    })
    const edited = prepareUvmJsonEdits(
      bytes,
      [{ op: 'add', path: '/nodes/0/name', value: 'Edited node' }],
      {
        validate: container =>
          validateUvmDocument(container.document, { binaryByteLength: container.binary.length }),
      },
    )
    const reopened = readUvmContainer(edited)
    expect(reopened.document).toEqual({ ...original, nodes: [{ extras: 17, name: 'Edited node' }] })
    expect(() => readUvmFacets(reopened.document, reopened.binary, budget)).not.toThrow()
  })

  it('rejects source blobs', () => {
    const blob: JsonObject = {
      format: 'blizzard.m3',
      chunk: 'source',
      sha256: '0'.repeat(64),
      bufferView: 0,
    }
    expect(() =>
      validateUvmDocument(document({}, { UV_source_blob: { blobs: [blob] } })),
    ).toThrow('UVM source blobs are not supported')
  })

  it('rejects malformed pointer targets even when both target and output width are undefined', () => {
    for (const value of [null, {}, [], 'text', NaN])
      expect(() =>
        validateUvmDocument(pointerDocument(value, '/extras/value', { type: 'INVALID' })),
      ).toThrow('pointer accessor shape is invalid')
    expect(() =>
      validateUvmDocument(pointerDocument(1, '/extras/value', { normalized: true })),
    ).toThrow('pointer accessor shape is invalid')
    expect(() => validateUvmDocument(pointerDocument(1))).not.toThrow()
  })

  it('resolves valid JSON Pointer escapes and refuses malformed escapes and protected storage', () => {
    const escaped = {
      ...pointerDocument(1, '/extras/a~1b/~0mark'),
      extras: { 'a/b': { '~mark': 1 } },
    }
    expect(() => validateUvmDocument(escaped)).not.toThrow()
    const malformed = { ...pointerDocument(1, '/extras/a~2b'), extras: { 'a~2b': 1 } }
    expect(() => validateUvmDocument(malformed)).toThrow('pointer target is unsafe or unresolved')
    const storage = { ...pointerDocument(1, '/buffers/0/byteLength'), buffers: [{ byteLength: 4 }] }
    expect(() => validateUvmDocument(storage)).toThrow('pointer target is unsafe or unresolved')
  })

  it('propagates cancellation through validation and facet reads', () => {
    const controller = new AbortController()
    controller.abort(new Error('cancel shared UVM validation'))
    expect(() => validateUvmDocument(document(), { signal: controller.signal })).toThrow(
      'cancel shared UVM validation',
    )
    expect(() => readUvmFacets(document(), new Uint8Array(), budget, controller.signal)).toThrow(
      'cancel shared UVM validation',
    )
  })
})

describe('shared UVM metadata facets', () => {
  it('retains material parameters, restored fields, socket identity and collision/effect descriptions', () => {
    const params = {
      renderModel: { version: 1, standard: { nativeFlags: 7 }, composite: { passes: [] } },
      future: { value: 11 },
    }
    const candidate = document(
      {
        extensionsUsed: [
          ...Object.keys(baseExtensions),
          'UV_game_material',
          'UV_game_material_team_color',
          'UV_game_socket',
          'UV_game_collision',
          'UV_game_effects',
        ],
        nodes: [
          {
            extensions: {
              UV_game_socket: {
                role: 'attach',
                sourceName: 'Ref_Weapon',
                forward: '+x',
                up: '+z',
                extras: { modkit: { id: 'socket/native', nodeId: 'node-0' } },
              },
              UV_game_collision: { role: 'hit', shapes: [{ kind: 'sphere', radius: 2 }] },
            },
          },
        ],
        materials: [
          {
            name: 'Authored',
            extras: {
              modkit: { material: { version: 1, fields: { type: 'standard', priority: 7 } } },
            },
            extensions: {
              UV_game_material: { shader: 'modkit.render-material.v1', params },
              UV_game_material_team_color: { maskSource: 'whole', blend: 'replace' },
            },
          },
        ],
      },
      {
        UV_game_effects: {
          profile: 'm3',
          particles: [{ name: 'Smoke', node: 0, material: 0, maxParticles: 20 }],
        },
      },
    )
    validateUvmDocument(candidate)
    const result = readUvmFacets(candidate, new Uint8Array(), budget)
    expect(result.materialRefs).toEqual([
      {
        id: 'material-0',
        name: 'Authored',
        type: 'standard',
        priority: 7,
        contracts: [
          'UV_game_material/standard',
          'UV_game_material/composite',
          'UV_game_material_team_color',
        ],
        shader: { id: 'modkit.render-material.v1', parameters: params },
      },
    ])
    expect(result.sockets).toEqual([
      {
        id: 'socket/native',
        nodeId: 'node-0',
        role: 'attach',
        sourceName: 'Ref_Weapon',
        orientation: { forward: '+x', up: '+z' },
      },
    ])
    expect(result.collisions).toMatchObject({
      total: 1,
      byKind: { sphere: 1 },
      volumes: [
        { id: 'node-0-collision-0', kind: 'sphere', origin: 'declared-volume', types: ['hit'] },
      ],
    })
    expect(result.teamColors).toMatchObject({ total: 1, byOperation: { replace: 1 } })
    expect(result.advancedMaterials).toEqual({
      total: 1,
      byContract: { standard: 1, composite: 1 },
    })
    expect(result.effects).toMatchObject({
      total: 1,
      profile: 'm3',
      byKind: { particles: 1 },
      animated: 0,
    })
  })

  it('refuses stored material fields that replace the document identity', () => {
    const candidate = document({
      materials: [
        { extras: { modkit: { material: { version: 1, fields: { id: 'another-material' } } } } },
      ],
    })
    expect(() => readUvmFacets(candidate, new Uint8Array(), budget)).toThrow('metadata shadows id')
  })
})
