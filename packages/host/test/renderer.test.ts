import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology } from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
} from '@modkitx-x3/host'
import { resolveSceneRenderer } from '@modkitx-x3/host/renderer'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { softwareRenderer } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'reference', 'software-renderer', 'src', 'linked.js'))
    .href
)) as { readonly softwareRenderer: LinkedExtension }

const REALM = 'org.modkitx.test/renderer-host'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/renderer',
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
      policy: { id: 'org.modkitx.test/renderer-policy', revision: '1' },
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
  const linked = linkedExtensionInputs([softwareRenderer])
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
    expect(resolution.state).toBe('resolved')
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
