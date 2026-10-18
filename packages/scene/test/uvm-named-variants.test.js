import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { readUvmNamedVariants, uvmVariantHiddenPrimitives } from '@modkit/uv/model/animation-clips'
import { readUvmModel } from '../src/uvm/model.js'
import { renderUvm } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const triangle = id => ({
  id,
  topology: 'triangles',
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: Uint32Array.from([0, 1, 2]),
})

/** A tank whose treads stand or move: one slot of two named variants (SPEC_UVM §15.2, K4). */
function model() {
  const { bytes } = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 3,
        materials: 0,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [{ id: 'tank', childIds: [], meshIds: ['tank-mesh'], transform: identity }],
      meshes: [{ id: 'tank-mesh', primitiveIds: ['hull', 'stop', 'move'] }],
      primitives: [triangle('hull'), triangle('stop'), triangle('move')],
      variants: [
        {
          id: 'standing',
          name: 'Treads standing',
          slot: 'treads',
          default: true,
          showPrimitiveIds: ['stop'],
          hidePrimitiveIds: ['move'],
        },
        {
          id: 'moving',
          name: 'moving',
          slot: 'treads',
          showPrimitiveIds: ['move'],
          hidePrimitiveIds: ['stop'],
        },
      ],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:named-variants',
      options: { assetId: 'fixture/named-variants', sourceFormat: 'json' },
    },
  )
  return bytes
}

const budget = {
  maxInputBytes: 64_000_000n,
  maxScalarBytes: 64_000_000,
  maxNodes: 100_000,
  maxDepth: 96,
  maxDiagnostics: 100,
}

const drawn = async variants => {
  let captured
  await renderUvm(
    model(),
    {
      schemaVersion: 1,
      time: 0,
      viewport: { width: 4, height: 4 },
      camera: { viewProjection: identity },
      ...(variants === undefined ? {} : { variants }),
    },
    {
      budget,
      contracts: {
        async resolve() {
          return {
            value: {
              async render(input) {
                captured = input
                return renderHeadless(input)
              },
            },
            async release() {},
          }
        },
      },
    },
  )
  return (captured.scene?.primitives ?? captured.primitives).map(primitive => primitive.id).sort()
}

it('writes named variants as UV_game_variants and reads them back', () => {
  const { document } = readUvmContainer(model())
  assert.ok(document.extensionsUsed.includes('UV_game_variants'))
  const variants = readUvmNamedVariants(document)
  assert.deepEqual(
    variants.map(variant => [variant.name, variant.label, variant.slot, variant.default]),
    [
      ['standing', 'Treads standing', 'treads', true],
      ['moving', 'moving', 'treads', undefined],
    ],
  )
  assert.deepEqual([...uvmVariantHiddenPrimitives(variants)], ['mesh-0-primitive-2'])
  assert.deepEqual([...uvmVariantHiddenPrimitives(variants, ['moving'])], ['mesh-0-primitive-1'])
  assert.throws(() => uvmVariantHiddenPrimitives(variants, ['flying']), /no variant/)
  assert.throws(() => uvmVariantHiddenPrimitives(variants, ['moving', 'standing']), /two variants/)
})

it('decodes the default look: the slot default hides its primitives', () => {
  const { document, binary } = readUvmContainer(model())
  const { scene } = readUvmModel(document, binary, { maxScalarBytes: 16_000_000 })
  assert.deepEqual(
    scene.primitives.map(primitive => [primitive.id, primitive.hidden === true]),
    [
      ['mesh-0-primitive-0', false],
      ['mesh-0-primitive-1', false],
      ['mesh-0-primitive-2', true],
    ],
  )
})

it('renders the default look, a chosen variant, and refuses an unknown one', async () => {
  assert.deepEqual(await drawn(undefined), ['mesh-0-primitive-0', 'mesh-0-primitive-1'])
  assert.deepEqual(await drawn(['standing']), ['mesh-0-primitive-0', 'mesh-0-primitive-1'])
  assert.deepEqual(await drawn(['moving']), ['mesh-0-primitive-0', 'mesh-0-primitive-2'])
  await assert.rejects(drawn(['flying']), /no variant/)
})
