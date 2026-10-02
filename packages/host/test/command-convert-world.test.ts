import { describe, expect, it } from 'vitest'
import type { AssetSession } from '@modkit/sdk'
import {
  commandRequest,
  createSubjectCommandRuntime,
  executeCommandRequest,
  type CommandContext,
  type CommandSubject,
  type CommandWorldExport,
} from '../src/index.js'

// a map that publishes its world, and an export.convert of its own
const WORLD = { name: 'the world source' }
function subject(released: string[], world = true): CommandSubject {
  const session = {
    async descriptor() {
      return {
        operations: [{ id: 'export.convert', handlerId: 'convert', state: 'available' }],
        dataSources: world ? [{ contract: 'common.view/world-scene-source', major: 1 }] : [],
      }
    },
    async dataSource(contract: string) {
      return { value: WORLD, release: async () => void released.push(contract) }
    },
    operations: () => ({
      async invoke() {
        return { state: 'ok', diagnostics: [], output: { kind: 'bytes', value: new Uint8Array(3) } }
      },
    }),
  } as unknown as AssetSession
  return {
    ref: 'map.sc2map',
    snapshot: { state: 'opened', diagnostics: [] } as unknown as CommandSubject['snapshot'],
    session,
    dispose: async () => undefined,
  }
}

async function convert(
  input: Readonly<Record<string, string>>,
  worldToUvw?: CommandContext['worldToUvw'],
  world = true,
  worldToUvp?: CommandContext['worldToUvp'],
) {
  const released: string[] = []
  const written: string[] = []
  const receipt = await executeCommandRequest(
    createSubjectCommandRuntime(),
    commandRequest('subject.convert', { subject: 'map.sc2map', ...input }),
    {
      openSubject: async () => subject(released, world),
      writeOutput: async name => {
        written.push(name)
        return `out/${name}`
      },
      ...(worldToUvw === undefined ? {} : { worldToUvw }),
      ...(worldToUvp === undefined ? {} : { worldToUvp }),
    },
  )
  return { result: receipt.result, released, written }
}

const materialized: CommandWorldExport = {
  state: 'materialized',
  bytes: new Uint8Array(10),
  artifactDigest: 'sha256:00',
  excludedFacetIds: ['navigation'],
  omittedObjects: 2,
  lostFields: [{ path: 'world.objects.tint', count: 4 }],
}

describe('subject.convert to UVW', () => {
  it('materializes the world the map publishes, with the receipt of what UVW lacks', async () => {
    const seen: unknown[] = []
    const run = await convert({ target: 'uvw' }, async source => {
      seen.push(source)
      return materialized
    })
    expect(seen).toEqual([WORLD])
    expect(run.result).toMatchObject({
      state: 'ok',
      data: {
        via: 'common.view/world-scene-source',
        byteLength: 10,
        wroteTo: 'out/world.uvw',
        receipt: {
          artifactDigest: 'sha256:00',
          excludedFacetIds: ['navigation'],
          omittedObjects: 2,
          lostFields: [{ path: 'world.objects.tint', count: 4 }],
        },
      },
    })
    // the world lease does not outlive the command
    expect(run.released).toEqual(['common.view/world-scene-source'])
  })

  it('fails with the refusals when the world does not make a UVW', async () => {
    const run = await convert({ target: 'uvw' }, async () => ({
      state: 'refused',
      refusals: [{ code: 'x3.uv/world-no-terrain', message: 'no terrain' }],
    }))
    expect(run.result).toMatchObject({
      state: 'failed',
      code: 'x3.host/world-uvw-refused',
      message: 'x3.uv/world-no-terrain: no terrain',
    })
    expect(run.written).toEqual([])
    expect(run.released).toEqual(['common.view/world-scene-source'])
  })

  it('is unavailable where the application has no UV module', async () => {
    const run = await convert({ target: 'uvw' })
    expect(run.result).toMatchObject({ state: 'unavailable' })
  })

  it('refuses UVW for a subject without a world, rather than writing its raw export', async () => {
    const run = await convert({ target: 'uvw' }, async () => materialized, false)
    expect(run.result).toMatchObject({ state: 'unavailable' })
    expect(run.written).toEqual([])
  })

  it('leaves a named operation and any other target to the codec', async () => {
    const world = async () => materialized
    const named = await convert({ target: 'uvw', operation: 'export.convert' }, world)
    expect(named.result).toMatchObject({ state: 'ok', data: { via: 'export.convert' } })
    const other = await convert({ target: 'json' }, world)
    expect(other.result).toMatchObject({ state: 'ok', data: { via: 'export.convert' } })
  })
})

describe('subject.convert to a single-file UVP', () => {
  it('writes the world with its models and textures through its own hook, as a .uvp', async () => {
    const uvw = async (): Promise<CommandWorldExport> => {
      throw new Error('a UVP is not a UVW')
    }
    const run = await convert({ target: 'uvp' }, uvw, true, async () => materialized)
    expect(run.result).toMatchObject({
      state: 'ok',
      data: { wroteTo: 'out/world.uvp', receipt: { artifactDigest: 'sha256:00' } },
    })
    expect(run.released).toEqual(['common.view/world-scene-source'])
    const refused = await convert({ target: 'uvp' }, uvw, true, async () => ({
      state: 'refused',
      refusals: [{ code: 'x3.uv/invalid-package-options', message: 'bad id' }],
    }))
    expect(refused.result).toMatchObject({ state: 'failed', code: 'x3.host/world-uvp-refused' })
    // an application that writes UVW only has no UVP to offer
    expect((await convert({ target: 'uvp' }, uvw)).result).toMatchObject({ state: 'unavailable' })
  })
})
