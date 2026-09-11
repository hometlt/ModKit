import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { uint64 } from '@modkit/core'
import { createHostTopology, type JsonObject, type ResourceBudget } from '@modkit/sdk'
import {
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createHostServiceResolver,
  linkedExtensionInputs,
  linkedInProcessBackend,
  openSubject,
  registerServiceDefinitionsOrThrow,
} from '../../src/index.js'
import {
  createFilesystemInputResolver,
  createNodeSubjectServices,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  openFileArtifactSource,
  workerBackendPolicy,
} from '../../src/node/index.js'
import { sceneModule } from '../../../scene/src/module.js'
import { writeUvmContainer } from '../../../uv/src/model/container.js'
import { appendUvmAccessors } from '../../../uv/src/model/accessor-write.js'
import { snapshotJson } from '../../../codec-kit/src/json-snapshot.js'
import {
  materialBudget,
  materialProgramCases,
} from '../../../testkit/test/fixtures/scene-material-program.js'
import { cubeTextureFixture } from '../../../testkit/test/fixtures/cube-texture.js'

export const environmentBudget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
export const environmentIdentity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export const environmentQuarterTurn = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]
export const environmentRequest = {
  schemaVersion: 1,
  viewport: { width: 48, height: 48 },
  camera: { viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.5, -0.5, 0, 1] },
  rendererId: 'modkit.headless',
}
export const environmentFaceColor = (face: number) => [(face * 40) / 255, 80 / 255, 120 / 255, 1]

/** Each face is spatially constant, so a known major axis gives an independent frame oracle. */
export function environmentCube() {
  const cube = cubeTextureFixture()
  let offset = 128
  for (const [face, levels] of cube.surfaces.entries())
    for (const rgba of levels) {
      for (let pixel = 0; pixel < rgba.length; pixel += 4)
        rgba.set([face * 40, 80, 120, 255], pixel)
      cube.bytes.set(rgba, offset)
      offset += rgba.length
    }
  return cube
}

/** Authored directly as UVM. This fixture carries no native model blob or native metadata. */
export function environmentModel(
  options: {
    uvSource?: 2 | 7
    color?: readonly number[]
    texturePath?: string
    slot?: 'envi' | 'enviMask'
  } = {},
) {
  const base = appendUvmAccessors(
    {
      format: 'glb',
      binary: new Uint8Array(),
      extraChunks: [],
      document: {
        asset: {
          version: '2.0',
          extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } },
        },
        extensionsUsed: ['UV_asset', 'UV_provenance'],
        extensions: {
          UV_asset: { id: 'test/environment-triangle', class: 'prop' },
          UV_provenance: {
            source: { format: 'uvm' },
            importer: { id: 'modkit.test/uvm-environment', version: '1.0' },
          },
        },
        buffers: [{ byteLength: 0 }],
      },
    },
    [
      { type: 'VEC3', values: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) },
      { type: 'VEC3', values: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1) },
      { type: 'VEC2', values: Float32Array.of(0, 0, 1, 0, 0, 1) },
    ],
  )
  const [position, normal, uv] = base.accessors
  if (position === undefined || normal === undefined || uv === undefined)
    throw new Error('missing UVM fixture accessor')
  const material = materialProgramCases().find(item => item.name === 'layer-envi')?.material
  const envi = material?.layers.envi,
    diffuse = material?.layers.diffuse
  if (material === undefined || envi === undefined || diffuse === undefined)
    throw new Error('missing environment material fixture')
  const slot = options.slot ?? 'envi'
  const layer = {
    ...envi,
    slot,
    channels: 1,
    uvSource: options.uvSource ?? 7,
    texturePath: options.color === undefined ? (options.texturePath ?? 'environment.dds') : null,
    ...(options.color === undefined ? {} : { constantColor: { value: options.color } }),
  }
  const layers = {
    diffuse: { ...diffuse, texturePath: null, constantColor: { value: [0, 0, 0, 1] } },
    ...(slot === 'enviMask'
      ? { envi: { ...envi, texturePath: null, constantColor: { value: [1, 1, 1, 1] } } }
      : {}),
    [slot]: layer,
  }
  return writeUvmContainer({
    ...base.container,
    document: {
      ...base.container.document,
      extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_material'],
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, material: 0 },
          ],
        },
      ],
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
                      unshaded: true,
                      layers,
                    },
                  },
                },
                materialBudget,
              ) as JsonObject,
            },
          },
        },
      ],
    },
  })
}

export async function createEnvironmentHostFixture() {
  const root = resolve(import.meta.dirname, '../../../..')
  const scratch = mkdtempSync(join(tmpdir(), 'modkit-uvm-environment-'))
  const grant = { id: 'uvm-environment-read', classes: ['read-source'] } as const
  const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
  const linked = linkedExtensionInputs([sceneModule])
  const backends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  const extensions = await Promise.all(
    ['images', 'models'].map(async name => ({
      ...(await loadExtensionDirectory(join(root, 'extensions', name))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  const inventory = await buildInventory(
    [...linked.inputs, ...extensions],
    createHostContributionContractRegistry(),
  )
  const definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(inventory, definitions)
  const services = createHostServiceResolver({
    inventory,
    definitions,
    executionBackends: backends,
    target,
    grant,
    budgets: environmentBudget,
  })
  const scene = await loadExtensionDirectory(join(root, 'packages/scene'))
  const documents = new Map<string, unknown>(),
    documentDigests = new Map<string, string>()
  for (const path of sceneModule.input.documents.keys()) {
    const bytes = readFileSync(join(root, 'packages/scene', path))
    documents.set(path, JSON.parse(bytes.toString('utf8')) as unknown)
    documentDigests.set(path, `sha256:${createHash('sha256').update(bytes).digest('hex')}`)
  }
  const host = 'org.example.uvm-environment/host',
    workers = 'org.example.uvm-environment/workers'
  const realmBudget = {
    maxConcurrentTasks: 4,
    maxWorkerCount: 2,
    maxResidentBytes: uint64('1073741824'),
    maxTransferBytes: uint64('268435456'),
    defaultDeadlineMs: 60_000,
  }
  const workerServices = await createNodeSubjectServices({
    bootstrapUrl: new URL('../../dist/node/worker-bootstrap.js', import.meta.url),
    topology: createHostTopology({
      schemaVersion: 1,
      topologyId: 'org.example.uvm-environment/test',
      realms: [
        {
          schemaVersion: 1,
          realmId: host,
          revision: '1',
          target: nodeRuntimeTargetBase(),
          facilities: ['filesystem.read-random', 'worker.module'],
          budgets: realmBudget,
          policy: { id: 'org.example.uvm-environment/host-policy', revision: '1' },
        },
        nodeWorkerRealmProfile({
          realmId: workers,
          budgets: realmBudget,
          policy: { id: 'org.example.uvm-environment/worker-policy', revision: '1' },
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
  let sequence = 0
  return {
    contracts: services.port,
    writeTexture(bytes: Uint8Array) {
      writeFileSync(join(scratch, 'environment.dds'), bytes)
    },
    readTexture() {
      return readFileSync(join(scratch, 'environment.dds'))
    },
    async open(bytes: Uint8Array, lane: 'linked' | 'worker') {
      const path = join(scratch, `${lane}-${sequence++}.uvm.glb`)
      writeFileSync(path, bytes)
      const source = await openFileArtifactSource(path)
      const common = {
        source,
        path,
        intent: 'full' as const,
        grant,
        budget: environmentBudget,
        resolveInput: createFilesystemInputResolver({
          primaryPath: path,
          roots: [scratch],
          inventory: lane === 'linked' ? inventory : workerServices.inventory,
        }),
      }
      const result =
        lane === 'worker'
          ? await workerServices.open(common)
          : await openSubject({
              ...common,
              inventory,
              target,
              executionBackends: backends,
              serviceDefinitions: definitions,
            })
      if (result.state !== 'opened')
        throw new Error(`environment UVM open failed: ${JSON.stringify(result.diagnostics)}`)
      if (result.selected.contributionId !== 'modkit/model-uvm')
        throw new Error('fixture did not select the UVM codec')
      return { ...result, readModel: () => readFileSync(path) }
    },
    async dispose() {
      await services.release()
      if (
        !resolve(scratch).startsWith(resolve(tmpdir()) + sep) ||
        !basename(scratch).startsWith('modkit-uvm-environment-')
      )
        throw new Error('unexpected fixture directory')
      rmSync(scratch, { recursive: true, force: true })
    },
  }
}
