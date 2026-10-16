import { describe, expect, it } from 'vitest'
import type {
  AssetSession,
  MediaExportRequest,
  MediaFormatOffer,
  MediaTimelineReport,
} from '@modkit/sdk'
import {
  commandRequest,
  createSubjectCommandRuntime,
  executeCommandRequest,
  type CommandContext,
  type CommandSubject,
} from '../src/index.js'

// a subject that publishes a world (a map, a cutscene, a model shown as one) and a codec export
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
    ref: 'map.w3m',
    snapshot: { state: 'opened', diagnostics: [] } as unknown as CommandSubject['snapshot'],
    session,
    dispose: async () => undefined,
  }
}

const GIF: MediaFormatOffer = {
  id: 'gif',
  label: 'GIF',
  kind: 'animation',
  extension: '.gif',
  mediaType: 'image/gif',
  alpha: false,
  lossy: true,
}

const report: MediaTimelineReport = {
  schemaVersion: 1,
  animated: true,
  sampledTime: false,
  sourceCamera: false,
  objects: 3,
  animatedObjects: 2,
  models: [],
  formats: [GIF],
  complete: true,
}

async function convert(
  input: Readonly<Record<string, unknown>>,
  hooks: Pick<CommandContext, 'mediaFormats' | 'renderMedia' | 'inspectMedia'>,
  world = true,
) {
  const released: string[] = []
  const written: string[] = []
  const receipt = await executeCommandRequest(
    createSubjectCommandRuntime(),
    commandRequest('subject.convert', { subject: 'map.w3m', ...input } as never),
    {
      openSubject: async () => subject(released, world),
      writeOutput: async name => {
        written.push(name)
        return `out/${name}`
      },
      ...hooks,
    },
  )
  return { result: receipt.result, released, written }
}

describe('subject.convert to media', () => {
  it('renders the published world in the offered format, with the rest of the request as input', async () => {
    const seen: { source: unknown; request: MediaExportRequest }[] = []
    const run = await convert(
      {
        target: 'gif',
        operationInput: { width: 320, height: 200, animations: [{ clip: 'Walk' }] },
      },
      {
        mediaFormats: [GIF],
        renderMedia: async (source, request) => {
          seen.push({ source, request })
          return {
            bytes: new Uint8Array(5),
            receipt: {
              format: 'gif',
              mediaType: 'image/gif',
              extension: '.gif',
              width: 320,
              height: 200,
              frames: 12,
              fps: 12,
              startMs: 0,
              durationMs: 1000,
              camera: 'default',
              alpha: false,
              audio: false,
              animatedObjects: 2,
              unmatchedAnimations: [],
              models: { total: 1, converted: 1 },
              complete: true,
            },
            diagnostics: [
              { code: 'x3.media/alpha-flattened', message: 'flattened', severity: 'information' },
            ],
          }
        },
      },
    )
    expect(seen).toEqual([
      {
        source: WORLD,
        request: {
          schemaVersion: 1,
          width: 320,
          height: 200,
          animations: [{ clip: 'Walk' }],
          format: 'gif',
        },
      },
    ])
    expect(run.result).toMatchObject({
      state: 'ok',
      data: {
        via: 'common.view/world-scene-source',
        byteLength: 5,
        wroteTo: 'out/render.gif',
        receipt: { frames: 12 },
      },
      diagnostics: [{ code: 'x3.media/alpha-flattened', severity: 'information' }],
    })
    expect(run.released).toEqual(['common.view/world-scene-source'])
  })

  it('reports what of the world moves as media-info', async () => {
    const run = await convert(
      { target: 'media-info' },
      { mediaFormats: [GIF], inspectMedia: async () => report },
    )
    expect(run.result).toMatchObject({
      state: 'ok',
      data: { outputKind: 'json', report: { animatedObjects: 2 } },
    })
    expect(run.written).toEqual(['media-info.json'])
  })

  it('leaves a target no media format offers, and a subject without a world, to the codec', async () => {
    const render = async (): Promise<never> => {
      throw new Error('not a media target')
    }
    const other = await convert({ target: 'png' }, { mediaFormats: [GIF], renderMedia: render })
    expect(other.result).toMatchObject({ state: 'ok', data: { via: 'export.convert' } })
    const flat = await convert(
      { target: 'gif' },
      { mediaFormats: [GIF], renderMedia: render },
      false,
    )
    expect(flat.result).toMatchObject({ state: 'ok', data: { via: 'export.convert' } })
  })

  it('is unavailable where the application draws no worlds, and refuses a request that is no object', async () => {
    const none = await convert({ target: 'media-info' }, { mediaFormats: [GIF] })
    expect(none.result).toMatchObject({ state: 'unavailable' })
    const bad = await convert(
      { target: 'gif', operationInput: [1] },
      {
        mediaFormats: [GIF],
        renderMedia: async () => {
          throw new Error('unreached')
        },
      },
    )
    expect(bad.result).toMatchObject({ state: 'failed' })
  })
})
