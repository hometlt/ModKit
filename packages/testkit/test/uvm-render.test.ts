import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import {
  createHostTopology,
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ContractResolverPort,
  type JsonObject,
  type JsonValue,
  type ResourceBudget,
} from '@modkit/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createHostComposition,
  createHostServiceResolver,
  createExecutionBackendRegistry,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
} from '@modkit/host'
import { rendering3d } from '../../scene/src/module.js'
import { renderUvm, renderUvmPng } from '../../scene/src/uvm/render.js'
import { renderHeadless } from '../../scene/src/render/headless.js'
import { readUvmContainer, writeUvmContainer } from '../../uv/src/model/container.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'
import { createModelSceneSampler } from '../../scene/src/model/sampler.js'
import { appendUvmAccessors } from '../../uv/src/model/accessor-write.js'

const bytes = Uint8Array.from(
  Buffer.from(
    readFileSync(new URL('./fixtures/uvm/m3-triangle.uvm.glb.b64', import.meta.url), 'utf8'),
    'base64',
  ),
)
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
const request = {
  schemaVersion: 1,
  viewport: { width: 64, height: 48 },
  camera: { viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.5, -0.5, 0, 1] },
  rendererId: 'modkit.headless',
}
function withImportNotes(warnings: readonly JsonValue[], lost: readonly JsonValue[] = []) {
  const source = readUvmContainer(bytes)
  const extensions = source.document['extensions']
  if (extensions === null || typeof extensions !== 'object' || Array.isArray(extensions))
    throw new Error('fixture extensions missing')
  const provenance = (extensions as JsonObject)['UV_provenance']
  if (provenance === null || typeof provenance !== 'object' || Array.isArray(provenance))
    throw new Error('fixture provenance missing')
  return writeUvmContainer({
    ...source,
    document: {
      ...source.document,
      extensions: { ...extensions, UV_provenance: { ...provenance, warnings, lost } },
    },
  })
}
let services: ReturnType<typeof createHostServiceResolver>
beforeAll(async () => {
  const linked = linkedExtensionInputs([rendering3d])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  const realmId = 'modkit.test/uvm-render'
  const topology = createHostTopology({
    schemaVersion: 1,
    topologyId: realmId,
    realms: [
      {
        schemaVersion: 1,
        realmId,
        revision: '1',
        target: { environment: 'node', operatingSystem: 'linux', architecture: 'x64' },
        facilities: [],
        budgets: {
          maxConcurrentTasks: 2,
          maxWorkerCount: 0,
          maxResidentBytes: uint64('134217728'),
          maxTransferBytes: uint64('16777216'),
          defaultDeadlineMs: 10000,
        },
        policy: { id: 'modkit.test/uvm-render-policy', revision: '1' },
      },
    ],
    links: [],
  })
  const composition = await createHostComposition({
    topology,
    realmId,
    extensions: linked.inputs,
    executionBackends,
  })
  const definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
  services = createHostServiceResolver({
    ...composition,
    definitions,
    grant: { id: 'render', classes: [] },
    budgets: budget,
  })
}, 60000)
afterAll(async () => {
  await services?.release()
})

it('renders UVM through the selected provider with the same pixels as a direct shared scene frame', async () => {
  const frame = await renderUvm(bytes, request, { contracts: services.port, budget })
  const c = readUvmContainer(bytes)
  const model = readUvmModel(c.document, c.binary, budget)
  const sample = createModelSceneSampler({ ...model.scene, skeleton: model.rig.bindings }).sample(0)
  const expected = await renderHeadless({
    outputKind: 'rgba8',
    viewport: request.viewport,
    camera: { viewProjection: Float32Array.from(request.camera.viewProjection) },
    scene: {
      primitives: sample.primitives.map(primitive => ({ ...primitive, materialId: 'default' })),
      materials: [{ id: 'default', baseColor: [1, 1, 1, 1], doubleSided: false, shading: 'unlit' }],
    },
  })
  expect(frame.rgba).toEqual(expected.rgba)
  expect(frame.statistics.fragments).toBeGreaterThan(0)
  expect(services.activationFacts.some(f => f.providerId === 'modkit/headless-renderer')).toBe(true)
  const png = await renderUvmPng(bytes, request, { contracts: services.port, budget })
  expect([...png.value.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
})

it('maps glTF opaque, mask and blend alpha into the shared renderer without changing UVM bytes', async () => {
  const source = readUvmContainer(bytes)
  const materials = source.document['materials']
  if (
    !Array.isArray(materials) ||
    materials[0] === null ||
    typeof materials[0] !== 'object' ||
    Array.isArray(materials[0])
  )
    throw new Error('fixture material missing')
  const original = materials[0]
  for (const [mode, cutoff, factor, expectedAlpha] of [
    ['OPAQUE', 0.5, 0, 255],
    ['MASK', 0.5, 0.25, 0],
    ['MASK', 0.5, 0.5, 255],
    ['MASK', 1 + Number.EPSILON, 1, 0],
    ['BLEND', 0.5, 0.5, 128],
  ] as const) {
    const model = writeUvmContainer({
      ...source,
      document: {
        ...source.document,
        materials: [
          {
            ...original,
            alphaMode: mode,
            ...(mode === 'MASK' ? { alphaCutoff: cutoff } : {}),
            pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, factor] },
          },
        ],
      },
    })
    const copy = model.slice()
    const frame = await renderUvm(model, request, { contracts: services.port, budget })
    const alphas = new Set([...frame.rgba].filter((_, index) => index % 4 === 3))
    expect(alphas.has(expectedAlpha)).toBe(true)
    expect([...alphas].every(alpha => alpha === 0 || alpha === expectedAlpha)).toBe(true)
    if (expectedAlpha !== 0) expect(frame.statistics.fragments).toBeGreaterThan(0)
    expect(frame.diagnostics.map(item => item.code)).not.toContain(
      'common.uvm/material-features-unrendered',
    )
    expect(model).toEqual(copy)
  }
})

it('exposes the same PNG and diagnostics through the ordinary UVM codec operation', async () => {
  const importWarning = 'Native collision topology is retained but has no active representation'
  const importLoss = { code: 'UNMAPPED_TRACK', severity: 'info', feature: 'source track', count: 3 }
  const inputBytes = withImportNotes([importWarning], [importLoss])
  const module = (await import(
    new URL('../../../extensions/models/src/uvm/codec.js', import.meta.url).href
  )) as {
    createCodec(context: ContributionContext): Codec
  }
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: 'render-uvm', uri: 'memory://render/model.uvm.glb' },
    revision: revisionId('content-hash.sha256:uvm-render-fixture'),
    size: BigInt(inputBytes.length),
    async read(offset, length) {
      return inputBytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield inputBytes.slice()
    },
  }
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  const input: AssetInput = {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: 'content', revision: source.revision }],
      compositionFingerprint: 'uvm-render-fixture',
    },
    bindingsFor: () => [],
    openBinding: async () => ({ value: source, release: async () => undefined }),
  }
  const codec = module.createCodec({
    contracts: services.port,
    budgets: budget,
    diagnostics: { report: () => undefined },
  })
  const session = await codec.open(input, 'full', budget)
  try {
    const result = await session.operations().invoke('render-uvm-scene', request)
    if (result.state !== 'ok' || result.output.kind !== 'bytes')
      throw new Error('UVM operation refused')
    const expected = await renderUvmPng(inputBytes, request, { contracts: services.port, budget })
    expect(result.output.value).toEqual(expected.value)
    expect(result.diagnostics.map(item => item.code)).toContain(
      'common.scene/material-shader-unsupported',
    )
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'common.uvm/import-warning',
          severity: 'warning',
          message: importWarning,
        }),
        expect.objectContaining({
          code: 'common.uvm/import-loss',
          severity: 'information',
          message: JSON.stringify(importLoss),
        }),
      ]),
    )
    expect(inputBytes).toEqual(withImportNotes([importWarning], [importLoss]))
    const clean = await renderUvm(bytes, request, { contracts: services.port, budget })
    expect(clean.diagnostics.some(item => item.message === importWarning)).toBe(false)
  } finally {
    await session.dispose()
  }
})

it('refuses malformed or over-budget imported diagnostics before acquiring a renderer', async () => {
  let acquired = false
  const contracts: ContractResolverPort = {
    async resolve() {
      acquired = true
      throw new Error('unexpected renderer acquisition')
    },
    async resolveUnknown() {
      acquired = true
      throw new Error('unexpected renderer acquisition')
    },
  }
  await expect(
    renderUvm(withImportNotes(['a', 'b']), request, {
      contracts,
      budget: { ...budget, maxDiagnostics: 1 },
    }),
  ).rejects.toThrow('maxDiagnostics')
  for (const note of [null, 5, [], ''] as const)
    await expect(
      renderUvm(withImportNotes([note]), request, { contracts, budget }),
    ).rejects.toThrow('requires text or a diagnostic object')
  expect(acquired).toBe(false)
})

it('selects a clip and refuses unknown animations and malformed requests before rendering', async () => {
  expect(
    (
      await renderUvm(
        bytes,
        { ...request, clipId: 'animation-0', time: 0.25 },
        { contracts: services.port, budget },
      )
    ).statistics.fragments,
  ).toBeGreaterThan(0)
  for (const change of [
    { clipId: 'missing' },
    { time: -1 },
    { viewport: { width: 4097, height: 1 } },
    { camera: { viewProjection: [1] } },
    { unexpected: true },
  ])
    await expect(
      renderUvm(bytes, { ...request, ...change }, { contracts: services.port, budget }),
    ).rejects.toThrow()
  await expect(
    renderUvm(bytes, request, {
      contracts: services.port,
      budget: { ...budget, maxScalarBytes: 1000 },
    }),
  ).rejects.toThrow('maxScalarBytes')
  await expect(
    renderUvm(bytes, request, { contracts: services.port, budget, signal: AbortSignal.abort() }),
  ).rejects.toThrow()
  await expect(
    renderUvm(
      bytes,
      { ...request, rendererId: 'missing.renderer' },
      { contracts: services.port, budget },
    ),
  ).rejects.toThrow()
})

it('reports preserved game material features alongside PNG output', async () => {
  const c = readUvmContainer(bytes)
  const diagnostics: string[] = []
  const modified = writeUvmContainer({
    ...c,
    document: {
      ...c.document,
      materials: [
        {
          extensions: { UV_game_material: { shader: 'example/shader', params: {} } },
        },
      ],
    },
  })
  const result = await renderUvmPng(modified, request, {
    contracts: services.port,
    budget,
    reportDiagnostic: value => diagnostics.push(value.code),
  })
  expect(result.value.length).toBeGreaterThan(8)
  expect(diagnostics).toContain('common.scene/material-shader-unsupported')
})

it('renders only the selected scene, retaining joint nodes for pose evaluation', async () => {
  const source = readUvmContainer(bytes)
  const multiple = writeUvmContainer({
    ...source,
    document: { ...source.document, scene: 0, scenes: [{ nodes: [0, 1] }, { nodes: [1] }] },
  })
  expect(
    (await renderUvm(multiple, request, { contracts: services.port, budget })).statistics
      .primitives,
  ).toBe(1)
  const empty = await renderUvm(
    multiple,
    { ...request, sceneIndex: 1 },
    { contracts: services.port, budget },
  )
  expect(empty.statistics.primitives).toBe(0)
  expect(empty.statistics.fragments).toBe(0)
  await expect(
    renderUvm(multiple, { ...request, sceneIndex: 2 }, { contracts: services.port, budget }),
  ).rejects.toThrow('scene')
})

it('uses TEXCOORD_4 and owns model, camera and texels before asynchronous provider acquisition', async () => {
  const appended = appendUvmAccessors(readUvmContainer(bytes), [
    { type: 'VEC2', values: Float32Array.of(0.25, 0.5, 0.25, 0.5, 0.25, 0.5) },
    { type: 'VEC2', values: Float32Array.of(1.25, 0.5, 1.25, 0.5, 1.25, 0.5) },
  ])
  const [uv0, uv4] = appended.accessors
  if (uv0 === undefined || uv4 === undefined) throw new Error('missing UV accessors')
  const source = appended.container
  const mesh = (source.document['meshes'] as JsonObject[])[0]
  if (mesh === undefined) throw new Error('missing mesh')
  const primitive = (mesh['primitives'] as JsonObject[])[0]
  if (primitive === undefined) throw new Error('missing primitive')
  const model = writeUvmContainer({
    ...source,
    document: {
      ...source.document,
      extensionsUsed: [
        ...((source.document['extensionsUsed'] ?? []) as string[]).filter(
          name => name !== 'UV_game_material',
        ),
        'KHR_materials_unlit',
      ],
      extensionsRequired: ((source.document['extensionsRequired'] ?? []) as string[]).filter(
        name => name !== 'UV_game_material',
      ),
      meshes: [
        {
          ...mesh,
          primitives: [
            {
              ...primitive,
              material: 0,
              attributes: {
                ...(primitive['attributes'] as JsonObject),
                TEXCOORD_0: uv0,
                TEXCOORD_1: uv0,
                TEXCOORD_2: uv0,
                TEXCOORD_3: uv0,
                TEXCOORD_4: uv4,
              },
            },
          ],
        },
      ],
      images: [{ uri: 'texture.png' }],
      textures: [{ source: 0, sampler: 0 }],
      samplers: [{ wrapS: 33071, wrapT: 33071 }],
      materials: [
        {
          extensions: { KHR_materials_unlit: {} },
          doubleSided: true,
          pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 4 } },
        },
      ],
    },
  })
  const texels = {
    id: 'test-texture',
    width: 2,
    height: 1,
    rgba: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255),
    wrapU: 'clamp' as const,
    wrapV: 'clamp' as const,
  }
  const textured = readUvmContainer(model)
  const repeating = writeUvmContainer({
    ...textured,
    document: { ...textured.document, samplers: [{}] },
  })
  const repeated = await renderUvm(repeating, request, {
    contracts: services.port,
    budget,
    textures: new Map([[0, texels]]),
  })
  expect(repeated.statistics.fragments).toBeGreaterThan(0)
  expect(
    repeated.rgba.some((value, i) => i % 4 === 0 && value === 255 && repeated.rgba[i + 1] === 0),
  ).toBe(true)
  await expect(
    renderUvm(model, request, {
      contracts: services.port,
      budget,
      textures: new Map([[1, texels]]),
    }),
  ).rejects.toThrow('decoded texture')
  const mirrored = writeUvmContainer({
    ...textured,
    document: { ...textured.document, samplers: [{ wrapS: 33648 }] },
  })
  await expect(
    renderUvm(mirrored, request, {
      contracts: services.port,
      budget,
      textures: new Map([[0, texels]]),
    }),
  ).rejects.toThrow('not supported')
  let resume: (() => void) | undefined
  const ready = new Promise<void>(resolve => {
    resume = resolve
  })
  const delayed: ContractResolverPort = {
    async resolve(request) {
      await ready
      return services.port.resolve(request)
    },
    resolveUnknown: request => services.port.resolveUnknown(request),
  }
  const rgba = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255)
  const ownedRequest = structuredClone(request)
  const pending = renderUvm(model, ownedRequest, {
    contracts: delayed,
    budget,
    textures: new Map([
      [0, { id: 'test-texture', width: 2, height: 1, rgba, wrapU: 'clamp', wrapV: 'clamp' }],
    ]),
  })
  model.fill(0)
  ownedRequest.camera.viewProjection.fill(0)
  rgba.fill(0)
  if (resume === undefined) throw new Error('missing acquisition gate')
  resume()
  const frame = await pending
  let green = 0
  for (let i = 0; i < frame.rgba.length; i += 4)
    if (
      frame.rgba[i] === 0 &&
      frame.rgba[i + 1] === 255 &&
      frame.rgba[i + 2] === 0 &&
      frame.rgba[i + 3] === 255
    )
      green++
  expect(green).toBeGreaterThan(0)
  // Runtime texels do not erase the fixture's historical import-loss record.
  expect(frame.diagnostics).toHaveLength(1)
  const importNote = frame.diagnostics[0]
  if (importNote === undefined) throw new Error('fixture import loss was hidden')
  expect(importNote).toMatchObject({ code: 'common.uvm/import-loss', severity: 'warning' })
  expect(JSON.parse(importNote.message)).toEqual({
    code: 'M3_TEXTURES_UNRESOLVED',
    count: 1,
    feature: 'external texture references',
    severity: 'warning',
  })
})
