import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { contractId } from '@modkit/core'
import {
  buildInventory,
  createHostContributionContractRegistry,
  offersFromInventory,
} from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ModelSceneSource,
  type ProviderRequest,
  type ResourceBudget,
} from '@modkit/sdk'
import { runMinimalHost } from '@modkit/testkit'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const modelsDir = join(repoRoot, 'extensions', 'models')
const uvmEntrypoint = join(modelsDir, 'src', 'uvm', 'codec.js')
const m3UvmFixture = join(here, 'fixtures', 'uvm', 'm3-native-triangle.uvm.glb.b64')

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const request: ProviderRequest = {
  contract: {
    contract: contractId('common.model/scene-metadata'),
    major: 1,
    range: '*',
  },
  target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
  pin: {
    providerId: 'modkit/model-uvm',
    runtimeVariant: 'trusted-node',
    offerId: 'uvm-scene',
  },
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('UVM core codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('UVM core codec has no foreign service dependency')
    },
  },
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let cursor = 0
  for (const part of parts) {
    result.set(part, cursor)
    cursor += part.byteLength
  }
  return result
}

function le32(value: number): Uint8Array {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, true)
  return result
}

function pad4(bytes: Uint8Array, fill: number): Uint8Array {
  const result = new Uint8Array((bytes.byteLength + 3) & ~3)
  result.fill(fill)
  result.set(bytes)
  return result
}

function glbChunk(type: number, payload: Uint8Array): Uint8Array {
  return concat(le32(payload.byteLength), le32(type), payload)
}

function minimalUvm(
  binaryPadding = 0,
  collision = false,
  collisionSize: readonly [number, number, number] = [2, 3, 4],
  teamColorOperation?: string,
  materialSnapshotVersion?: number,
  effects = false,
  pointerTarget = '/extensions/UV_game_effects/particles/0/emissionRate',
  effectLineType: number | undefined = 2,
  effectScope: string | undefined = 'global',
  effectGlobalSeqId: number | null | undefined = 4,
): Uint8Array {
  const binary = new Uint8Array((effects ? 112 : 80) + binaryPadding)
  const view = new DataView(binary.buffer)
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1]
  positions.forEach((value, index) => view.setFloat32(index * 4, value, true))
  normals.forEach((value, index) => view.setFloat32(36 + index * 4, value, true))
  ;[0, 1, 2].forEach((value, index) => view.setUint16(72 + index * 2, value, true))
  if (effects) {
    view.setFloat32(80, 0, true)
    view.setFloat32(84, 1, true)
    ;[0, 8, 4, 4, 16, 0].forEach((value, index) => view.setFloat32(88 + index * 4, value, true))
  }
  const materialExtensions = {
    ...(teamColorOperation === undefined
      ? {}
      : {
          UV_game_material_team_color: {
            maskSource: 'whole',
            targets: ['baseColor'],
            blend: 'multiply',
            extras: {
              renderModel: { target: 'team-color', operation: teamColorOperation },
            },
          },
        }),
    ...(materialSnapshotVersion === undefined
      ? {}
      : {
          UV_game_material: {
            shader: 'modkit.render-material.v1',
            params: {
              renderModel: {
                version: materialSnapshotVersion,
                standard: { layers: {}, blendMode: 0 },
              },
            },
          },
        }),
  }
  const document = {
    asset: {
      version: '2.0',
      generator: 'modkit UVM convergence fixture',
      extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } },
    },
    extensionsUsed: [
      'UV_asset',
      'UV_provenance',
      ...(collision ? ['UV_game_collision'] : []),
      ...(teamColorOperation === undefined ? [] : ['UV_game_material_team_color']),
      ...(materialSnapshotVersion === undefined ? [] : ['UV_game_material']),
      ...(effects ? ['UV_game_effects', 'KHR_animation_pointer'] : []),
    ],
    extensions: {
      UV_asset: { id: 'corpus/a2-a3-triangle', class: 'prop', coreRenderable: true },
      UV_provenance: {
        source: { format: 'obj', file: 'triangle.obj' },
        importer: { id: 'modkit/uvm-writer', version: '0.1.0' },
        lost: [],
      },
      ...(effects
        ? {
            UV_game_effects: {
              profile: 'common',
              trackTimeUnit: 'seconds',
              particles: [
                {
                  name: 'Smoke',
                  node: 0,
                  material: 0,
                  emitShape: 'sphere',
                  emissionRate: 8,
                  lifeSpan: 1,
                  speed: 2,
                  gravity: -1,
                  orientationMode: 'billboard',
                  maxParticles: 64,
                },
              ],
              ribbons: [],
              forces: [],
              warps: [],
              projectors: [],
            },
          }
        : {}),
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'Triangle',
        mesh: 0,
        ...(collision
          ? {
              extensions: {
                UV_game_collision: {
                  shapes: [{ kind: 'box', size: collisionSize, collisionMask: 3 }],
                },
              },
            }
          : {}),
      },
    ],
    meshes: [
      {
        name: 'Triangle Mesh',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'UVM Default',
        ...(Object.keys(materialExtensions).length > 0 ? { extensions: materialExtensions } : {}),
      },
    ],
    ...(effects
      ? {
          animations: [
            {
              name: 'Effect animation',
              samplers: [{ input: 3, output: 4, interpolation: 'CUBICSPLINE' }],
              extras: {
                uv: {
                  ...(effectScope === undefined ? {} : { effectTrackScope: effectScope }),
                  ...(effectGlobalSeqId === undefined ? {} : { globalSeqId: effectGlobalSeqId }),
                },
              },
              channels: [
                {
                  sampler: 0,
                  extras: {
                    uv: {
                      ...(effectLineType === undefined ? {} : { sourceLineType: effectLineType }),
                    },
                  },
                  target: {
                    path: 'pointer',
                    extensions: { KHR_animation_pointer: { pointer: pointerTarget } },
                  },
                },
              ],
            },
          ],
        }
      : {}),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ...(effects
        ? [
            { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' },
            { bufferView: 4, componentType: 5126, count: 6, type: 'SCALAR' },
          ]
        : []),
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
      ...(effects
        ? [
            { buffer: 0, byteOffset: 80, byteLength: 8 },
            { buffer: 0, byteOffset: 88, byteLength: 24 },
          ]
        : []),
    ],
    buffers: [{ byteLength: binary.byteLength }],
  }
  const json = pad4(new TextEncoder().encode(JSON.stringify(document)), 0x20)
  const jsonChunk = glbChunk(0x4e4f534a, json)
  const binaryChunk = glbChunk(0x004e4942, binary)
  const length = 12 + jsonChunk.byteLength + binaryChunk.byteLength
  return concat(le32(0x46546c67), le32(2), le32(length), jsonChunk, binaryChunk)
}

function byteSource(bytes: Uint8Array, label = 'triangle'): ArtifactByteSource {
  const uri = `memory://uvm-convergence/${label}.uvm.glb`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:uvm-a2-a3-${label}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('cancelled')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: 'uvm-a2-a3-triangle',
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function readBase64Fixture(path: string): Promise<Uint8Array> {
  const encoded = (await readFile(path, 'utf8')).replace(/\s+/g, '')
  return new Uint8Array(Buffer.from(encoded, 'base64'))
}

function asCodecModule(value: Record<string, unknown>): {
  readonly createCodec: (context: ContributionContext) => Codec
} {
  if (typeof value['createCodec'] !== 'function') {
    throw new TypeError('activated UVM contribution does not export createCodec')
  }
  return value as { readonly createCodec: (context: ContributionContext) => Codec }
}

describe('UVM convergence through A-2 inventory and A-3 sessions', () => {
  it('resolves, tickets and activates the isolated UVM contribution deterministically', async () => {
    const grant = { id: 'uvm-smoke-grant', classes: ['read-source'] as const }
    const inventory = await buildInventory(
      [await loadExtensionDirectory(modelsDir)],
      createHostContributionContractRegistry(),
    )
    expect(inventory.diagnostics).toEqual([])
    const uvmContribution = inventory.extensions
      .flatMap(extension => extension.contributions)
      .find(contribution => contribution.manifest?.id === 'modkit/model-uvm')
    expect(uvmContribution?.diagnostics).toEqual([])
    expect(uvmContribution).toMatchObject({ inventoryEligible: true, activationEligible: true })
    expect(
      offersFromInventory(inventory).find(offer => offer.providerId === 'modkit/model-uvm'),
    ).toMatchObject({
      providerId: 'modkit/model-uvm',
      provides: [
        {
          offerId: 'uvm-scene',
          contract: 'common.model/scene-metadata',
          major: 1,
          version: '1.0.0',
        },
      ],
    })
    const run = await runMinimalHost({
      extensionDirs: [modelsDir],
      extensionExecution: { origin: 'bundled', allowTrustedInProcess: true },
      request,
      grant,
    })
    expect(run.result.state).toBe('resolved')
    if (run.result.state !== 'resolved') throw new TypeError('UVM provider did not resolve')
    expect(run.result.selected.offer).toMatchObject({
      providerId: 'modkit/model-uvm',
      runtimeVariant: 'trusted-node',
      provides: [
        {
          offerId: 'uvm-scene',
          contract: 'common.model/scene-metadata',
          major: 1,
          version: '1.0.0',
        },
      ],
    })
    expect(run.activation.variant).toMatchObject({
      variantId: 'trusted-node',
      entrypoint: './src/uvm/codec.js',
      executionProfile: 'trusted-in-process',
    })
    expect(run.activation.effectiveGrant.classes).toEqual(['read-source'])
    expect(
      run.inventory.extensions[0]?.contributions.find(
        contribution => contribution.manifest?.id === 'modkit/model-uvm',
      ),
    ).toMatchObject({ inventoryEligible: true, activationEligible: true })

    const again = await runMinimalHost({
      extensionDirs: [modelsDir],
      extensionExecution: { origin: 'bundled', allowTrustedInProcess: true },
      request,
      grant,
    })
    expect(again.lockText).toBe(run.lockText)

    const codec = asCodecModule(run.activation.module).createCodec(context)
    const m3ConvertedUvm = await readBase64Fixture(m3UvmFixture)
    expect(createHash('sha256').update(m3ConvertedUvm).digest('hex')).toBe(
      '5c2e542301419bc4e5afb3892fd2db372d1a63f752fd562ceacbf0d3a703dd08',
    )
    const source = byteSource(m3ConvertedUvm)
    const largeSource = byteSource(minimalUvm(70_000))
    const largeDetection = await codec.probe({
      source: largeSource,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 65536 }], maxBytes: 65536 },
    })
    expect(largeDetection.confidence).toBe(0.995)
    const detection = await codec.probe({
      source,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 65536 }], maxBytes: 65536 },
    })
    expect(detection).toMatchObject({
      codecId: 'modkit/model-uvm',
      confidence: 0.995,
      evidence: [{ kind: 'structure', note: 'uvm-core-1.0' }],
    })

    const session = await codec.open(inputFor(source), 'full', budget)
    const descriptor = await session.descriptor()
    expect(descriptor).toMatchObject({
      schemaVersion: 2,
      subjectUri: source.ref.uri,
      interpretation: 'codec',
      identity: {
        codecId: 'modkit/model-uvm',
        formatId: 'uvm',
        formatLabel: 'Universal Verse Model 1.0',
      },
      origin: { kind: 'single' },
      dataSources: expect.arrayContaining([
        { contract: 'common.view/model-scene-source', major: 1 },
      ]),
    })
    expect(descriptor.traits.map(trait => trait.id)).toEqual(
      expect.arrayContaining(['model.geometry', 'scene.objects', 'structure.hierarchy']),
    )

    const modelLease = await session.dataSource('common.view/model-scene-source', 1)
    const model = modelLease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      scenes: 1,
      nodes: 2,
      meshes: 1,
      primitives: 1,
      animations: 1,
      geometryAccess: 'decoded',
    })
    const primitive = await model.primitive?.('mesh-0-primitive-0', { maxBytes: 1024 })
    expect(primitive?.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    expect(primitive?.normals).toHaveLength(9)
    expect(primitive?.normals?.[2]).toBeCloseTo(1, 4)
    expect(primitive?.normals?.[5]).toBeCloseTo(1, 4)
    expect(primitive?.normals?.[8]).toBeCloseTo(1, 4)
    expect(primitive?.indices).toEqual(new Uint32Array([0, 1, 2]))
    await modelLease.release()

    expect(await session.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'uvm',
          profile: 'core',
          assetId: 'corpus/m3-native-triangle',
          sourceFormat: 'm3',
          primitives: 1,
          collisionShapes: 0,
          advancedMaterialContracts: 1,
          advancedMaterialKinds: { standard: 1, composite: 0 },
          preservedSourceBlobs: 1,
          losses: [{ code: 'M3_TEXTURES_UNRESOLVED', severity: 'warning' }],
        },
      },
    })
    await session.dispose()

    const collisionSource = byteSource(minimalUvm(0, true), 'collision-triangle')
    const collisionSession = await codec.open(inputFor(collisionSource), 'full', budget)
    expect(await collisionSession.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'uvm',
          primitives: 1,
          collisionShapes: 1,
          collisionKinds: { box: 1 },
        },
      },
    })
    await collisionSession.dispose()

    const invalidCollision = byteSource(
      minimalUvm(0, true, [-1, 2, 3]),
      'invalid-collision-triangle',
    )
    await expect(codec.open(inputFor(invalidCollision), 'full', budget)).rejects.toThrow(
      'invalid box extents',
    )

    const teamColorSource = byteSource(
      minimalUvm(0, false, [2, 3, 4], 'hsv-shade'),
      'team-colour-triangle',
    )
    const teamColorSession = await codec.open(inputFor(teamColorSource), 'full', budget)
    expect(await teamColorSession.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          teamColorMaterials: 1,
          teamColorOperations: { 'hsv-shade': 1 },
        },
      },
    })
    await teamColorSession.dispose()

    const invalidTeamColor = byteSource(
      minimalUvm(0, false, [2, 3, 4], 'execute-shader'),
      'invalid-team-colour-triangle',
    )
    await expect(codec.open(inputFor(invalidTeamColor), 'full', budget)).rejects.toThrow(
      'invalid neutral remap metadata',
    )

    const invalidMaterial = byteSource(
      minimalUvm(0, false, [2, 3, 4], undefined, 2),
      'invalid-material-triangle',
    )
    await expect(codec.open(inputFor(invalidMaterial), 'full', budget)).rejects.toThrow(
      'unsupported version',
    )

    const effectSource = byteSource(
      minimalUvm(0, false, [2, 3, 4], undefined, undefined, true),
      'effect-triangle',
    )
    const effectSession = await codec.open(inputFor(effectSource), 'full', budget)
    expect(await effectSession.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          effects: 1,
          effectProfile: 'common',
          effectKinds: { particles: 1, ribbons: 0, forces: 0, warps: 0, projectors: 0 },
          animatedEffectProperties: 1,
        },
      },
    })
    await effectSession.dispose()

    const unsafePointer = byteSource(
      minimalUvm(0, false, [2, 3, 4], undefined, undefined, true, '/buffers/0/byteLength'),
      'unsafe-effect-pointer',
    )
    await expect(codec.open(inputFor(unsafePointer), 'full', budget)).rejects.toThrow(
      'pointer target is unsafe or unresolved',
    )

    const mismatchedInterpolation = byteSource(
      minimalUvm(
        0,
        false,
        [2, 3, 4],
        undefined,
        undefined,
        true,
        '/extensions/UV_game_effects/particles/0/emissionRate',
        1,
      ),
      'mismatched-effect-interpolation',
    )
    await expect(codec.open(inputFor(mismatchedInterpolation), 'full', budget)).rejects.toThrow(
      'sourceLineType does not match interpolation',
    )

    const missingGlobalSequence = byteSource(
      minimalUvm(
        0,
        false,
        [2, 3, 4],
        undefined,
        undefined,
        true,
        '/extensions/UV_game_effects/particles/0/emissionRate',
        2,
        'global',
        null,
      ),
      'missing-effect-global-sequence',
    )
    await expect(codec.open(inputFor(missingGlobalSequence), 'full', budget)).rejects.toThrow(
      'globalSeqId is invalid or missing',
    )
  })

  it('keeps the UVM activation bundle free of sibling model codecs', async () => {
    const result = await build({
      absWorkingDir: repoRoot,
      entryPoints: [uvmEntrypoint],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      packages: 'external',
      write: false,
      metafile: true,
      logLevel: 'silent',
    })
    const inputs = Object.keys(result.metafile?.inputs ?? {}).map(path =>
      path.replaceAll('\\', '/'),
    )
    expect(inputs.some(path => path.includes('/obj/'))).toBe(false)
    expect(inputs.some(path => path.includes('/gltf/'))).toBe(false)
    expect(inputs).toContain('extensions/models/src/uvm/codec.js')
  })
})
