import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { JsonObject, PermissionGrant, ResourceBudget } from '@modkit/sdk'
import { createHostTopology } from '@modkit/sdk'
import { uint64 } from '@modkit/core'
import {
  buildInventory,
  createHostContributionContractRegistry,
  createExecutionBackendRegistry,
  linkedExtensionInputs,
  linkedInProcessBackend,
  createBundledServiceDefinitionRegistry,
  registerServiceDefinitionsOrThrow,
  createHostServiceResolver,
  openSubject,
} from '../src/index.js'
import {
  loadExtensionDirectory,
  openFileArtifactSource,
  createFilesystemInputResolver,
  createNodeSubjectServices,
  nodeRuntimeTargetBase,
  nodeWorkerRealmProfile,
  nodeWorkerLinks,
  workerBackendPolicy,
  type NodeSubjectServices,
} from '../src/node/index.js'
import {
  createSubjectRasterResources,
  type SubjectRasterResourceState,
} from '../src/raster-resources.js'
import { sceneModule } from '../../scene/src/module.js'
import { renderUvmPng } from '../../scene/src/uvm/render.js'
import { encodeRgbaPng } from '../../scene/src/output/png.js'
import { readUvmContainer, writeUvmContainer } from '../../uv/src/model/container.js'
import { appendUvmAccessors } from '../../uv/src/model/accessor-write.js'
import {
  materialProgramCases,
  materialBudget,
} from '../../testkit/test/fixtures/scene-material-program.js'
import { snapshotJson } from '../../codec-kit/src/json-snapshot.js'
import { normalTextureFixtures } from './fixtures/normal-textures.js'
import { cubeTextureFixture } from '../../testkit/test/fixtures/cube-texture.js'

const root = resolve(import.meta.dirname, '../../..')
const scratch = mkdtempSync(join(tmpdir(), 'modkit-uvm-textures-'))
const grant: PermissionGrant = { id: 'uvm-textures-read', classes: ['read-source'] }
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const request = {
  schemaVersion: 1,
  viewport: { width: 64, height: 64 },
  camera: { viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.5, -0.5, 0, 1] },
  rendererId: 'modkit.headless',
}
const rgba = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255)
const linked = linkedExtensionInputs([sceneModule])
const backends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
let inventory: Awaited<ReturnType<typeof buildInventory>>
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>
let services: ReturnType<typeof createHostServiceResolver>
let dds: Uint8Array
let png: Uint8Array
let sequence = 0
let workerServices: NodeSubjectServices

beforeAll(async () => {
  const extensions = await Promise.all(
    ['images', 'models'].map(async name => ({
      ...(await loadExtensionDirectory(join(root, 'extensions', name))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  inventory = await buildInventory(
    [...linked.inputs, ...extensions],
    createHostContributionContractRegistry(),
  )
  definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(inventory, definitions)
  services = createHostServiceResolver({
    inventory,
    definitions,
    executionBackends: backends,
    target,
    grant,
    budgets: budget,
  })
  const encoder = (await import(
    new URL('../../../extensions/images/src/dds/encode.js', import.meta.url).href
  )) as {
    encodeDds(
      image: { width: number; height: number; pixels: Uint8Array },
      options: { format: string },
    ): Uint8Array
  }
  dds = encoder.encodeDds({ width: 2, height: 2, pixels: rgba }, { format: 'rgba8' })
  png = await encodeRgbaPng({ width: 2, height: 2, rgba })
  // The built-in's linked lane contains only in-process variants. For this boundary test,
  // compose its authored provider manifests against the loader's actual file attestations.
  const scene = await loadExtensionDirectory(join(root, 'packages/scene'))
  const documents = new Map<string, unknown>()
  const documentDigests = new Map<string, string>()
  for (const path of sceneModule.input.documents.keys()) {
    const bytes = readFileSync(join(root, 'packages/scene', path))
    documents.set(path, JSON.parse(bytes.toString('utf8')) as unknown)
    documentDigests.set(path, `sha256:${createHash('sha256').update(bytes).digest('hex')}`)
  }
  const host = 'org.example.uvm-raster/host',
    workers = 'org.example.uvm-raster/workers'
  const realmsBudget = {
    maxConcurrentTasks: 4,
    maxWorkerCount: 2,
    maxResidentBytes: uint64('1073741824'),
    maxTransferBytes: uint64('268435456'),
    defaultDeadlineMs: 60_000,
  }
  workerServices = await createNodeSubjectServices({
    bootstrapUrl: new URL('../dist/node/worker-bootstrap.js', import.meta.url),
    topology: createHostTopology({
      schemaVersion: 1,
      topologyId: 'org.example.uvm-raster/test',
      realms: [
        {
          schemaVersion: 1,
          realmId: host,
          revision: '1',
          target: nodeRuntimeTargetBase(),
          facilities: ['filesystem.read-random', 'worker.module'],
          budgets: realmsBudget,
          policy: { id: 'org.example.uvm-raster/host-policy', revision: '1' },
        },
        nodeWorkerRealmProfile({
          realmId: workers,
          budgets: realmsBudget,
          policy: { id: 'org.example.uvm-raster/worker-policy', revision: '1' },
        }),
      ],
      links: [...nodeWorkerLinks(host, workers)],
    }),
    realms: { host, workers },
    extensions: [
      ...extensions,
      { ...scene, containers: sceneModule.input.containers, documents, documentDigests },
    ],
    policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 15_000 }),
  })
  const warm = await workerFixture(
    model({ uri: `data:image/png;base64,${Buffer.from(png).toString('base64')}` }),
  )
  try {
    await warm.session
      .operations()
      .invoke('render-uvm-scene', request)
      .catch(error => {
        throw new Error(
          `warming the UVM raster worker route failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      })
  } finally {
    await warm.session.dispose()
  }
}, 60_000)
afterAll(async () => {
  await services?.release()
  if (
    !resolve(scratch).startsWith(resolve(tmpdir()) + sep) ||
    !basename(scratch).startsWith('modkit-uvm-textures-')
  )
    throw new Error('unexpected test directory')
  rmSync(scratch, { recursive: true, force: true })
})

function model(image: JsonObject, embedded?: Uint8Array) {
  const source = readUvmContainer(
    Buffer.from(
      readFileSync(
        join(root, 'packages/testkit/test/fixtures/uvm/m3-triangle.uvm.glb.b64'),
        'utf8',
      ),
      'base64',
    ),
  )
  const appended = appendUvmAccessors(source, [
    { type: 'VEC2', values: Float32Array.of(0.25, 0.25, 0.75, 0.25, 0.25, 0.75) },
  ])
  const uv = appended.accessors[0]
  if (uv === undefined) throw new Error('no UV accessor')
  const c = appended.container,
    meshes = c.document['meshes'] as JsonObject[],
    extensions = c.document['extensions'] as JsonObject,
    provenance = extensions['UV_provenance'] as JsonObject
  const mesh = meshes[0]
  if (mesh === undefined) throw new Error('no mesh')
  const primitive = (mesh['primitives'] as JsonObject[])[0]
  if (primitive === undefined) throw new Error('no primitive')
  const views = c.document['bufferViews'] as JsonObject[]
  const offset = Math.ceil(c.binary.length / 4) * 4
  const binary = embedded === undefined ? c.binary : new Uint8Array(offset + embedded.length)
  if (embedded !== undefined) {
    binary.set(c.binary)
    binary.set(embedded, offset)
  }
  return writeUvmContainer({
    ...c,
    binary,
    document: {
      ...c.document,
      extensions: {
        ...extensions,
        UV_provenance: { ...provenance, lost: [] },
      },
      buffers: [{ byteLength: binary.length }],
      bufferViews:
        embedded === undefined
          ? views
          : [...views, { buffer: 0, byteOffset: offset, byteLength: embedded.length }],
      extensionsUsed: [
        ...((c.document['extensionsUsed'] ?? []) as string[]).filter(x => x !== 'UV_game_material'),
        'KHR_materials_unlit',
      ],
      extensionsRequired: ((c.document['extensionsRequired'] ?? []) as string[]).filter(
        x => x !== 'UV_game_material',
      ),
      meshes: [
        {
          ...mesh,
          primitives: [
            {
              ...primitive,
              material: 0,
              attributes: { ...(primitive['attributes'] as JsonObject), TEXCOORD_0: uv },
            },
          ],
        },
      ],
      materials: [
        {
          extensions: { KHR_materials_unlit: {} },
          doubleSided: true,
          pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        },
      ],
      textures: [{ source: 0 }],
      images: [embedded === undefined ? image : { ...image, bufferView: views.length }],
    },
  })
}
async function fixture(bytes: Uint8Array) {
  const path = join(scratch, `model-${sequence++}.uvm.glb`)
  writeFileSync(path, bytes)
  const result = await openSubject({
    inventory,
    source: await openFileArtifactSource(path),
    path,
    intent: 'full',
    target,
    grant,
    budget,
    executionBackends: backends,
    serviceDefinitions: definitions,
    resolveInput: createFilesystemInputResolver({ primaryPath: path, roots: [scratch], inventory }),
  })
  if (result.state !== 'opened')
    throw new Error(`open failed: ${JSON.stringify(result.diagnostics)}`)
  expect(result.selected.contributionId).toBe('modkit/model-uvm')
  return { opened: result, path }
}
async function expected(bytes: Uint8Array) {
  return renderUvmPng(bytes, request, {
    contracts: services.port,
    budget,
    textures: new Map([[0, { id: 'expected', width: 2, height: 2, rgba }]]),
  })
}

async function workerFixture(bytes: Uint8Array) {
  const path = join(scratch, `worker-${sequence++}.uvm.glb`)
  writeFileSync(path, bytes)
  const result = await workerServices.open({
    source: await openFileArtifactSource(path),
    path,
    intent: 'full',
    grant,
    budget,
    resolveInput: createFilesystemInputResolver({
      primaryPath: path,
      roots: [scratch],
      inventory: workerServices.inventory,
    }),
  })
  if (result.state !== 'opened')
    throw new Error(
      `worker open: ${JSON.stringify(result, (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value))}`,
    )
  expect(result.selected.contributionId).toBe('modkit/model-uvm')
  return result
}

function cubeModel(path: string, direction: readonly number[], color?: readonly number[]) {
  const appended = appendUvmAccessors(readUvmContainer(model({ uri: path })), [
    { type: 'VEC3', values: Float32Array.from([...direction, ...direction, ...direction]) },
  ])
  const normal = appended.accessors[0]
  const base = appended.container
  const mesh = (base.document['meshes'] as JsonObject[])[0]
  const primitive = (mesh?.['primitives'] as JsonObject[] | undefined)?.[0]
  const material = materialProgramCases().find(item => item.name === 'layer-diffuse')?.material
  const diffuse = material?.layers.diffuse
  if (
    normal === undefined ||
    mesh === undefined ||
    primitive === undefined ||
    material === undefined ||
    diffuse === undefined
  )
    throw new Error('missing cube fixture')
  return writeUvmContainer({
    ...base,
    document: {
      ...base.document,
      extensionsUsed: [
        ...new Set([
          ...(Array.isArray(base.document['extensionsUsed'])
            ? base.document['extensionsUsed']
            : []
          ).filter(value => value !== 'KHR_materials_unlit'),
          'UV_game_material',
        ]),
      ],
      meshes: [
        {
          ...mesh,
          primitives: [
            {
              ...primitive,
              attributes: { ...(primitive['attributes'] as JsonObject), NORMAL: normal },
            },
          ],
        },
      ],
      images: [],
      textures: [],
      materials: [
        {
          extensions: {
            UV_game_material: {
              shader: 'modkit.render-material.v1',
              params: snapshotJson(
                {
                  renderModel: {
                    version: 1,
                    standard: {
                      ...material,
                      unshaded: true,
                      twoSided: true,
                      layers: {
                        diffuse: {
                          ...diffuse,
                          uvSource: 7,
                          texturePath: color === undefined ? path : null,
                          ...(color === undefined ? {} : { constantColor: { value: color } }),
                        },
                      },
                    },
                  },
                },
                materialBudget,
              ),
            },
          },
        },
      ],
    },
  })
}

it.each([
  { face: 0, direction: [1, 0, 0] },
  { face: 1, direction: [-1, 0, 0] },
  { face: 2, direction: [0, 1, 0] },
  { face: 3, direction: [0, -1, 0] },
  { face: 4, direction: [0, 0, 1] },
  { face: 5, direction: [0, 0, -1] },
])(
  'renders DDS cube face $face through ordinary UVM/image/renderer workers',
  async ({ face, direction }) => {
    const path = join(scratch, `cube-${face}.dds`)
    const cube = cubeTextureFixture()
    writeFileSync(path, cube.bytes)
    const bytes = cubeModel(basename(path), direction)
    // Independent oracle: the center of each 4x4 face linearly averages x/y texels 1 and 2.
    // Red is constant per face. Choosing face zero for every direction fails five cases.
    const reference = await renderUvmPng(
      cubeModel(basename(path), direction, [(face * 40) / 255, 90 / 255, 90 / 255, 1]),
      request,
      { contracts: services.port, budget },
    )
    const linked = await fixture(bytes)
    try {
      const worker = await workerFixture(bytes)
      try {
        for (const opened of [linked.opened, worker]) {
          const rendered = await opened.session.operations().invoke('render-uvm-scene', request)
          expect(rendered.state, JSON.stringify(rendered.diagnostics)).toBe('ok')
          if (rendered.state !== 'ok' || rendered.output.kind !== 'bytes')
            throw new Error('missing cube PNG')
          expect(rendered.diagnostics.filter(item => item.code.startsWith('common.'))).toEqual([])
          expect(rendered.output.value).toEqual(reference.value)
          const textures = opened.resources?.provenance().filter(item => item.state === 'resolved')
          expect(textures).toHaveLength(1)
          expect(textures?.[0]?.logicalId).toBe(basename(path))
        }
        expect(readFileSync(path)).toEqual(Buffer.from(cube.bytes))
      } finally {
        await worker.session.dispose()
      }
    } finally {
      await linked.opened.session.dispose()
    }
  },
  15_000,
)

it.each(normalTextureFixtures())(
  'renders $name normals through UVM/image/renderer workers against independently known texels',
  async ({ name, bytes: imageBytes, format, texel }) => {
    const imagePath = join(scratch, `normal-${name}.dds`)
    writeFileSync(imagePath, imageBytes)
    const base = readUvmContainer(model({ uri: basename(imagePath) }))
    const material = materialProgramCases().find(item => item.name === 'layer-normal')?.material
    const normal = material?.layers.normal
    if (material === undefined || normal === undefined) throw new Error('no normal fixture')
    const bytes = (constant: boolean) =>
      writeUvmContainer({
        ...base,
        document: {
          ...base.document,
          extensionsUsed: [
            ...new Set([
              ...(Array.isArray(base.document['extensionsUsed'])
                ? base.document['extensionsUsed']
                : []
              ).filter(value => value !== 'KHR_materials_unlit'),
              'UV_game_material',
            ]),
          ],
          images: [],
          textures: [],
          materials: [
            {
              extensions: {
                UV_game_material: {
                  shader: 'modkit.render-material.v1',
                  params: snapshotJson(
                    {
                      renderModel: {
                        version: 1,
                        standard: {
                          ...material,
                          twoSided: true,
                          ...(constant ? { normalMapFormat: format } : {}),
                          layers: {
                            ...material.layers,
                            normal: {
                              ...normal,
                              texturePath: constant ? null : basename(imagePath),
                              ...(constant
                                ? { constantColor: { value: texel.map(value => value / 255) } }
                                : {}),
                            },
                          },
                        },
                      },
                    },
                    materialBudget,
                  ),
                },
              },
            },
          ],
        },
      })
    const expected = await renderUvmPng(bytes(true), request, { contracts: services.port, budget })
    const opened = await workerFixture(bytes(false))
    try {
      const rendered = await opened.session.operations().invoke('render-uvm-scene', request)
      expect(rendered.state, JSON.stringify(rendered.diagnostics)).toBe('ok')
      if (rendered.state !== 'ok' || rendered.output.kind !== 'bytes')
        throw new Error('no normal PNG')
      expect(rendered.diagnostics.filter(item => item.code.startsWith('common.'))).toEqual([])
      expect(rendered.output.value).toEqual(expected.value)
    } finally {
      await opened.session.dispose()
    }
  },
  15_000,
)

it('renders a game material and shared DDS layers through the ordinary UVM/image/renderer workers', async () => {
  const imagePath = join(scratch, 'game-material.dds')
  writeFileSync(imagePath, dds)
  const base = readUvmContainer(model({ uri: basename(imagePath) }))
  const fixtureMaterial = materialProgramCases().find(
    item => item.name === 'layer-diffuse',
  )?.material
  const diffuse = fixtureMaterial?.layers.diffuse
  if (fixtureMaterial === undefined || diffuse === undefined)
    throw new Error('no shared material fixture')
  const parameters = snapshotJson(
    {
      renderModel: {
        version: 1,
        standard: {
          ...fixtureMaterial,
          twoSided: true,
          unshaded: true,
          layers: {
            diffuse: { ...diffuse, texturePath: basename(imagePath) },
            decal: { ...diffuse, slot: 'decal', texturePath: basename(imagePath), op: 0 },
          },
        },
      },
    },
    materialBudget,
  ) as JsonObject
  const bytes = writeUvmContainer({
    ...base,
    document: {
      ...base.document,
      extensionsUsed: [
        ...new Set([
          ...(Array.isArray(base.document['extensionsUsed'])
            ? base.document['extensionsUsed']
            : []
          ).filter(value => value !== 'KHR_materials_unlit'),
          'UV_game_material',
        ]),
      ],
      materials: [
        {
          extensions: {
            UV_game_material: { shader: 'modkit.render-material.v1', params: parameters },
          },
        },
      ],
      images: [],
      textures: [],
    },
  })
  const linked = await fixture(bytes),
    worker = await workerFixture(bytes)
  try {
    const direct = await linked.opened.session.operations().invoke('render-uvm-scene', request)
    const remote = await worker.session.operations().invoke('render-uvm-scene', request)
    expect(direct.state, JSON.stringify(direct.diagnostics)).toBe('ok')
    expect(remote.state, JSON.stringify(remote.diagnostics)).toBe('ok')
    if (
      direct.state !== 'ok' ||
      direct.output.kind !== 'bytes' ||
      remote.state !== 'ok' ||
      remote.output.kind !== 'bytes'
    )
      throw new Error('missing material PNG')
    expect(remote.output.value).toEqual(direct.output.value)
    expect(direct.output.value.length).toBeGreaterThan(100)
    for (const result of [direct, remote])
      expect(result.diagnostics.filter(item => item.code.startsWith('common.'))).toEqual([])
    const provenance = linked.opened.resources
      ?.provenance()
      .filter(item => item.state === 'resolved')
    expect(provenance).toHaveLength(1)
    writeFileSync(imagePath, Uint8Array.from([...dds, 0]))
    const changed = await worker.session.operations().invoke('render-uvm-scene', request)
    expect(changed.diagnostics.map(item => item.code)).toContain(
      'x3.host/resource-revision-changed',
    )
    expect(changed.diagnostics.map(item => item.code)).toContain(
      'common.scene/material-texture-unresolved',
    )
  } finally {
    await linked.opened.session.dispose()
    await worker.session.dispose()
  }
})

it.each(['dds', 'png'] as const)(
  'renders %s through real model, image and renderer workers',
  async format => {
    const imagePath = join(scratch, 'worker-texture.dds')
    writeFileSync(imagePath, dds)
    const bytes =
      format === 'dds' ? model({ uri: basename(imagePath) }) : model({ mimeType: 'image/png' }, png)
    const opened = await workerFixture(bytes)
    try {
      const rendered = await opened.session.operations().invoke('render-uvm-scene', request)
      expect(rendered.state, JSON.stringify(rendered.diagnostics)).toBe('ok')
      if (rendered.state !== 'ok' || rendered.output.kind !== 'bytes')
        throw new Error('no worker PNG')
      expect(rendered.output.value).toEqual((await expected(bytes)).value)
      expect(
        rendered.diagnostics.map(item => item.code),
        JSON.stringify(rendered.diagnostics),
      ).toEqual(['x3.host/worker-shared-process', 'x3.host/permission-degraded'])
    } finally {
      await opened.session.dispose()
    }
  },
)

it.each(['dds', 'png'] as const)(
  'resolves an external %s through the ordinary host codec and keeps its revision pinned',
  async format => {
    const imagePath = join(scratch, `tex-${sequence}.${format}`)
    const encoded = format === 'dds' ? dds : png
    writeFileSync(imagePath, encoded)
    const bytes = model({ uri: basename(imagePath) })
    const { opened, path } = await fixture(bytes)
    try {
      const baseline = await expected(bytes)
      for (let i = 0; i < 2; i++) {
        const rendered = await opened.session.operations().invoke('render-uvm-scene', request)
        if (rendered.state !== 'ok' || rendered.output.kind !== 'bytes') throw new Error('no PNG')
        expect(
          rendered.diagnostics.map(item => item.code),
          JSON.stringify(rendered.diagnostics),
        ).toEqual(['x3.host/full-process-authority', 'x3.host/permission-degraded'])
        expect(rendered.output.value).toEqual(baseline.value)
      }
      expect(
        opened.resources?.provenance().filter(item => item.state === 'resolved').length,
      ).toBeGreaterThan(0)
      writeFileSync(imagePath, Uint8Array.from([...encoded, 0]))
      const changed = await opened.session.operations().invoke('render-uvm-scene', request)
      expect(changed.diagnostics.map(item => item.code)).toContain(
        'x3.host/resource-revision-changed',
      )
      expect(readFileSync(path)).toEqual(Buffer.from(bytes))
    } finally {
      await opened.session.dispose()
    }
  },
)

it('publishes the opened subject raster port used by remote model viewers', async () => {
  const imagePath = join(scratch, `viewer-tex-${sequence}.png`)
  writeFileSync(imagePath, png)
  const { opened } = await fixture(model({ uri: basename(imagePath) }))
  const port = opened.rasterResources
  if (port === undefined) throw new Error('opened subject has no raster resource port')
  try {
    const decoded = await port.read({
      kind: 'logical',
      requirement: {
        id: 'viewer-diffuse',
        logicalId: basename(imagePath),
        role: 'texture',
        scopes: ['sibling-directory'],
      },
      maxBytes: 16,
    })
    if (decoded.state !== 'decoded') throw new Error(JSON.stringify(decoded.diagnostics))
    expect(decoded.region.pixels).toEqual(rgba)
    expect(decoded.provenance).toMatchObject({
      requirementId: 'viewer-diffuse',
      logicalId: basename(imagePath),
      state: 'resolved',
    })
  } finally {
    await opened.session.dispose()
  }
  const late = await port.read({
    kind: 'logical',
    requirement: {
      id: 'late',
      logicalId: basename(imagePath),
      role: 'texture',
      scopes: ['sibling-directory'],
    },
    maxBytes: 16,
  })
  expect(late.state).toBe('unresolved')
  expect(late.diagnostics.map(item => item.code)).toContain('x3.host/raster-context-unavailable')
})

it.each(['bufferView', 'data-uri'] as const)(
  'decodes embedded PNG from %s through the same host image codec',
  async kind => {
    const bytes =
      kind === 'bufferView'
        ? model({ mimeType: 'image/png' }, png)
        : model({ uri: `data:image/png;base64,${Buffer.from(png).toString('base64')}` })
    const { opened } = await fixture(bytes)
    try {
      const rendered = await opened.session.operations().invoke('render-uvm-scene', request)
      if (rendered.state !== 'ok' || rendered.output.kind !== 'bytes') throw new Error('no PNG')
      expect(
        rendered.diagnostics.map(item => item.code),
        JSON.stringify(rendered.diagnostics),
      ).toEqual(['x3.host/full-process-authority', 'x3.host/permission-degraded'])
      expect(rendered.output.value).toEqual((await expected(bytes)).value)
      expect(opened.resources?.provenance()).toEqual([])
    } finally {
      await opened.session.dispose()
    }
  },
)

it.each([
  ['../outside.dds', 'x3.host/resource-path-refused'],
  ['%2e%2e/outside.dds', 'x3.host/resource-path-refused'],
  ['https://example.invalid/remote.png', 'x3.host/resource-not-found'],
])(
  'leaves an unavailable image URI %s confined to the existing resource origin',
  async (uri, code) => {
    const { opened } = await fixture(model({ uri }))
    try {
      const result = await opened.session.operations().invoke('render-uvm-scene', request)
      expect(
        result.diagnostics.map(item => item.code),
        JSON.stringify(result.diagnostics),
      ).toContain(code)
      expect(opened.resources?.provenance().every(item => item.state === 'unresolved')).toBe(true)
    } finally {
      await opened.session.dispose()
    }
  },
)

it('owns embedded input before awaiting, shares the decoded budget, and refuses a disposed context', async () => {
  const state: SubjectRasterResourceState = { live: true, reservedBytes: 0 }
  let resume: (() => void) | undefined
  const gate = new Promise<void>(resolve => {
    resume = resolve
  })
  const port = createSubjectRasterResources({
    state,
    budget: { ...budget, maxScalarBytes: 16 },
    isAuthorized: () => true,
    async open(source, hint, signal) {
      await gate
      return openSubject({
        inventory,
        source,
        ...hint,
        target,
        grant,
        budget,
        intent: 'full',
        executionBackends: backends,
        serviceDefinitions: definitions,
        provideRasterResources: false,
        ...(signal === undefined ? {} : { signal }),
      })
    },
  })
  const bytes = dds.slice()
  const pending = port.read({ kind: 'embedded', bytes, maxBytes: 16 })
  bytes.fill(0)
  const exceeded = await port.read({ kind: 'embedded', bytes: dds, maxBytes: 16 })
  expect(exceeded.diagnostics.map(item => item.code)).toContain('x3.host/resource-budget-exceeded')
  if (resume === undefined) throw new Error('no gate')
  resume()
  const result = await pending
  if (result.state !== 'decoded') throw new Error(JSON.stringify(result.diagnostics))
  expect(result.region.pixels).toEqual(rgba)
  expect(result.info).toMatchObject({ channelLayout: 'rgba', compression: 'none' })
  expect(state.reservedBytes).toBe(0)
  state.live = false
  expect((await port.read({ kind: 'embedded', bytes: dds, maxBytes: 16 })).state).toBe('unresolved')
  await expect(
    port.read({ kind: 'embedded', bytes: dds, maxBytes: 16 }, AbortSignal.abort()),
  ).rejects.toThrow()
})
