import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import { createHostTopology } from '@modkit/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
} from '@modkit/host'
import { createSceneRendererPort, resolveSceneRenderer } from '@modkit/host/renderer'
import type { SceneRenderer } from '@modkit/sdk/renderer'
import { sceneRendererContractSuite } from './scene-renderer-contract.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { softwareRenderer } = (await import(
  pathToFileURL(join(repoRoot, 'examples', 'extensions', 'software-renderer', 'src', 'linked.js'))
    .href
)) as { readonly softwareRenderer: LinkedExtension }
const renderingRoot = join(repoRoot, 'packages', 'scene')
const { rendering3d } = (await import(
  pathToFileURL(join(renderingRoot, 'src', 'module.js')).href
)) as { readonly rendering3d: LinkedExtension }
const referenceModule = (await import(
  pathToFileURL(join(repoRoot, 'examples', 'extensions', 'software-renderer', 'src', 'provider.js'))
    .href
)) as RendererModule
const headlessModule = (await import(
  pathToFileURL(join(renderingRoot, 'src', 'render', 'headless.js')).href
)) as RendererModule
const { encodeRgbaPng } = (await import(
  pathToFileURL(join(renderingRoot, 'src', 'output', 'png.js')).href
)) as {
  encodeRgbaPng(frame: { width: number; height: number; rgba: Uint8Array }): Promise<Uint8Array>
}

interface RendererModule {
  createProvider(selection: {
    contract: 'common.render/scene-3d'
    major: 1
    offerId: string
    facet: { outputKind: 'rgba8' }
  }): { value: SceneRenderer }
}

function providerRenderer(module: RendererModule): SceneRenderer {
  return module.createProvider({
    contract: 'common.render/scene-3d',
    major: 1,
    offerId: 'contract-suite',
    facet: { outputKind: 'rgba8' },
  }).value
}

sceneRendererContractSuite('reference software', () => providerRenderer(referenceModule))
sceneRendererContractSuite('product headless', () => providerRenderer(headlessModule))

const REALM = 'modkit.test/renderer-host'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'modkit.test/renderer',
  realms: [
    {
      schemaVersion: 1,
      realmId: REALM,
      revision: '1',
      target: { environment: 'node', operatingSystem: 'linux', architecture: 'x64' },
      facilities: [],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('134217728'),
        maxTransferBytes: uint64('16777216'),
        defaultDeadlineMs: 10_000,
      },
      policy: { id: 'modkit.test/renderer-policy', revision: '1' },
    },
  ],
  links: [],
})
const activationBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const identity = (): Float32Array =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const linked = linkedExtensionInputs([softwareRenderer, rendering3d])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: linked.inputs,
    executionBackends,
  })
  definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
})

describe('standard scene renderer contract and software provider', () => {
  it('routes typed geometry and returns an owned RGBA8 frame', async () => {
    const resolution = await resolveSceneRenderer({
      services: { ...composition, serviceDefinitions: definitions },
      rendererId: 'reference.software',
      outputKind: 'rgba8',
      grant: { id: 'renderer-test', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state, JSON.stringify(resolution.diagnostics)).toBe('resolved')
    if (resolution.state !== 'resolved') throw new Error('software renderer did not resolve')

    try {
      const frame = await resolution.renderer.render({
        scene: {
          materials: [{ id: 'red', baseColor: [1, 0, 0, 1] }],
          primitives: [
            {
              id: 'triangle',
              topology: 'triangles',
              positions: new Float32Array([-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0]),
              indices: new Uint32Array([0, 1, 2]),
              materialId: 'red',
            },
          ],
        },
        camera: { viewProjection: identity() },
        viewport: { width: 16, height: 16 },
        clearColor: [0, 0, 0, 1],
        outputKind: 'rgba8',
      })

      expect(frame.outputKind).toBe('rgba8')
      expect(frame.rgba).toBeInstanceOf(Uint8Array)
      expect(frame.rgba).toHaveLength(16 * 16 * 4)
      expect(frame.diagnostics).toEqual([])
      expect(frame.statistics).toMatchObject({ primitives: 1, triangles: 1 })
      expect(frame.statistics.fragments).toBeGreaterThan(0)

      let redPixels = 0
      for (let offset = 0; offset < frame.rgba.length; offset += 4) {
        if (
          frame.rgba[offset] === 255 &&
          frame.rgba[offset + 1] === 0 &&
          frame.rgba[offset + 2] === 0 &&
          frame.rgba[offset + 3] === 255
        ) {
          redPixels += 1
        }
      }
      expect(redPixels).toBe(frame.statistics.fragments)
    } finally {
      await resolution.release()
    }
  })

  it('routes the product headless provider and produces a deterministic PNG fixture', async () => {
    const resolution = await resolveSceneRenderer({
      services: { ...composition, serviceDefinitions: definitions },
      rendererId: 'modkit.headless',
      outputKind: 'rgba8',
      grant: { id: 'renderer-test-headless', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state, JSON.stringify(resolution.diagnostics)).toBe('resolved')
    if (resolution.state !== 'resolved') throw new Error('headless renderer did not resolve')
    try {
      const frame = await resolution.renderer.render({
        scene: {
          materials: [{ id: 'blue', baseColor: [0.1, 0.3, 1, 1] }],
          primitives: [
            {
              id: 'triangle',
              topology: 'triangles',
              positions: new Float32Array([-0.75, -0.75, 0, 0.75, -0.75, 0, 0, 0.75, 0]),
              indices: new Uint32Array([0, 1, 2]),
              materialId: 'blue',
            },
          ],
        },
        camera: { viewProjection: identity() },
        viewport: { width: 32, height: 32 },
        clearColor: [0.02, 0.03, 0.04, 1],
        outputKind: 'rgba8',
      })
      const first = await encodeRgbaPng(frame)
      const second = await encodeRgbaPng(frame)
      expect(second).toEqual(first)
      expect(Array.from(first.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(createHash('sha256').update(first).digest('hex')).toBe(
        '794eddf238b7062203d8be5e2d9fd9391e13ea1889cc6ad7e8486295822d840b',
      )
    } finally {
      await resolution.release()
    }
  })

  it('does not select the software offer for another renderer route', async () => {
    const resolution = await resolveSceneRenderer({
      services: { ...composition, serviceDefinitions: definitions },
      rendererId: 'reference.gpu',
      outputKind: 'rgba8',
      grant: { id: 'renderer-test-mismatch', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain('x3.host/renderer-unresolved')
  })
})

/**
 * The consumer half: what a viewer is handed instead of an inventory.
 *
 * The point of the port is that a package which depends on `@modkit/sdk` alone — every viewer in
 * `@modkit/ui` — can request a provider through the standard resolver without composing a host. So
 * these assert the two answers a consumer must be able to act on, and that a refusal arrives as a
 * stated reason rather than as an exception or an empty optional.
 */
describe('scene renderer port', () => {
  it('leases a provider resolved by the standard resolver', async () => {
    const port = createSceneRendererPort({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'renderer-port', classes: [] },
      budgets: activationBudget,
    })
    const acquisition = await port.acquire({ outputKind: 'rgba8', rendererId: 'modkit.headless' })
    expect(acquisition.state, JSON.stringify(acquisition.diagnostics)).toBe('resolved')
    if (acquisition.state !== 'resolved') throw new Error('renderer port did not resolve')
    try {
      expect(acquisition.lease.renderer.rendererId).toBe('modkit.headless')
      expect(acquisition.lease.renderer.contract).toBe('common.render/scene-3d')
      const frame = await acquisition.lease.renderer.render({
        scene: {
          materials: [{ id: 'lit', baseColor: [1, 1, 1, 1], shading: 'lambert' }],
          primitives: [
            {
              id: 'triangle',
              topology: 'triangles',
              positions: new Float32Array([-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0]),
              indices: new Uint32Array([0, 1, 2]),
              materialId: 'lit',
            },
          ],
          light: { direction: [0, 0, 1], ambient: 0.2 },
        },
        camera: { viewProjection: identity() },
        viewport: { width: 16, height: 16 },
        clearColor: [0, 0, 0, 1],
        outputKind: 'rgba8',
      })
      expect(frame.statistics.fragments).toBeGreaterThan(0)
      expect(frame.diagnostics).toEqual([])
    } finally {
      await acquisition.lease.release()
    }
  })

  it('refuses with typed contract diagnostics rather than throwing', async () => {
    const port = createSceneRendererPort({
      services: { ...composition, serviceDefinitions: definitions },
      grant: { id: 'renderer-port-mismatch', classes: [] },
      budgets: activationBudget,
    })
    const acquisition = await port.acquire({ outputKind: 'rgba8', rendererId: 'nobody.at.all' })
    expect(acquisition.state).toBe('unresolved')
    expect(acquisition.diagnostics.map(item => item.code)).toContain('x3.host/renderer-unresolved')
    // the contract's severity vocabulary has no `hint`; the host's does, and it is mapped, not leaked
    for (const item of acquisition.diagnostics) {
      expect(['error', 'warning', 'information']).toContain(item.severity)
    }
  })

  it('refuses when the host registered no service-contract definitions', async () => {
    const port = createSceneRendererPort({
      services: composition,
      grant: { id: 'renderer-port-undefined', classes: [] },
      budgets: activationBudget,
    })
    const acquisition = await port.acquire({ outputKind: 'rgba8' })
    expect(acquisition.state).toBe('unresolved')
    expect(acquisition.diagnostics.map(item => item.code)).toEqual(['x3.host/renderer-unavailable'])
  })
})
