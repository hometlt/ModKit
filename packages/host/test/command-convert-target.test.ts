import { describe, expect, it } from 'vitest'
import type { AssetSession } from '@modkit/sdk'
import {
  commandRequest,
  createSubjectCommandRuntime,
  executeCommandRequest,
  type CommandSubject,
} from '../src/index.js'

interface Call {
  readonly handler: string
  readonly input: unknown
}

// a subject publishing the given exports; a native one answers with its encoder's extension
function subject(operations: readonly string[], calls: Call[]): CommandSubject {
  const session = {
    async descriptor() {
      return {
        operations: operations.map(id => ({ id, handlerId: `run:${id}`, state: 'available' })),
        dataSources: [],
      }
    },
    operations: () => ({
      async invoke(handler: string, input: unknown) {
        calls.push({ handler, input })
        return {
          state: 'ok',
          diagnostics: [],
          output: {
            kind: 'bytes',
            value: new Uint8Array(4),
            ...(handler.endsWith('native')
              ? { extension: 'm3', mediaType: 'application/octet-stream' }
              : {}),
          },
        }
      },
    }),
  } as unknown as AssetSession
  return {
    ref: 'file:///models/marine.uvm',
    snapshot: { state: 'opened', diagnostics: [] } as unknown as CommandSubject['snapshot'],
    session,
    dispose: async () => undefined,
  }
}

async function convert(input: Readonly<Record<string, string>>, operations: readonly string[]) {
  const calls: Call[] = []
  const written: string[] = []
  const receipt = await executeCommandRequest(
    createSubjectCommandRuntime(),
    commandRequest('subject.convert', { subject: 'marine.uvm', ...input }),
    {
      openSubject: async () => subject(operations, calls),
      writeOutput: async name => {
        written.push(name)
        return `out/${name}`
      },
    },
  )
  return { result: receipt.result, calls, written }
}

describe('subject.convert by target', () => {
  const uvm = ['export.raw', 'model.export-uvm', 'model.export-native']

  it('writes another model format with the native encoder, named by its extension', async () => {
    const run = await convert({ target: 'm3' }, uvm)
    expect(run.calls).toEqual([
      { handler: 'run:model.export-native', input: { schemaVersion: 1, formatId: 'm3' } },
    ])
    expect(run.written).toEqual(['marine.m3'])
    expect(run.result).toMatchObject({
      state: 'ok',
      data: {
        via: 'model.export-native',
        extension: 'm3',
        mediaType: 'application/octet-stream',
        wroteTo: 'out/marine.m3',
      },
    })
  })

  it('writes UVM with the model export and a game map with the map encoder', async () => {
    expect((await convert({ target: 'uvm' }, uvm)).calls[0]?.handler).toBe('run:model.export-uvm')
    const map = await convert({ target: 'ra2-map' }, ['map.export-native'])
    expect(map.calls).toEqual([
      { handler: 'run:map.export-native', input: { schemaVersion: 1, formatId: 'ra2-map' } },
    ])
  })

  it('keeps a named operation, and the first export without a target', async () => {
    const named = await convert({ target: 'm3', operation: 'export.raw' }, uvm)
    expect(named.calls[0]?.handler).toBe('run:export.raw')
    expect((await convert({}, uvm)).calls[0]?.handler).toBe('run:export.raw')
  })
})

describe('subject.convert answering a map encoder from the target game (question 67)', () => {
  const uvw: CommandSubject = {
    ref: 'file:///worlds/dune.uvw',
    snapshot: { state: 'opened', diagnostics: [] } as unknown as CommandSubject['snapshot'],
    session: {
      async descriptor() {
        return {
          operations: [{ id: 'map.export-native', handlerId: 'native', state: 'available' }],
          dataSources: [],
        }
      },
      operations: () => ({
        // the encoder asks for the unit type until it is answered, then writes
        async invoke(_handler: string, input: { readonly catalogEntities?: unknown[] }) {
          return {
            state: 'ok',
            diagnostics: [],
            output:
              input.catalogEntities === undefined
                ? {
                    kind: 'json',
                    value: { catalogQueries: [{ namespace: 'vehicle', entityId: 'HTNK' }] },
                  }
                : { kind: 'bytes', value: Uint8Array.of(9), extension: 'map' },
          }
        },
      }),
    } as unknown as AssetSession,
    dispose: async () => undefined,
  }
  const run = async (input: Readonly<Record<string, string>>, catalog = true) => {
    const opened: string[] = []
    const asked: unknown[] = []
    const receipt = await executeCommandRequest(
      createSubjectCommandRuntime(),
      commandRequest('subject.convert', { subject: 'dune.uvw', target: 'ra2-map', ...input }),
      {
        openSubject: async () => uvw,
        writeOutput: async name => `out/${name}`,
        ...(catalog
          ? {
              openTargetCatalog: async (target: string) => {
                opened.push(target)
                return {
                  entities: async refs => {
                    asked.push(...refs)
                    return refs.map(ref => ({ ...ref, typeId: 'vehicle', fields: {} }) as never)
                  },
                  dispose: async () => void opened.push(`closed ${target}`),
                }
              },
            }
          : {}),
      },
    )
    return { result: receipt.result, opened, asked }
  }

  it('asks the target context and writes the map with the answers', async () => {
    const answered = await run({ targetContext: 'F:/GAMES/Red Alert 2' })
    expect(answered.asked).toEqual([{ namespace: 'vehicle', entityId: 'HTNK' }])
    expect(answered.opened).toEqual(['F:/GAMES/Red Alert 2', 'closed F:/GAMES/Red Alert 2'])
    expect(answered.result).toMatchObject({
      state: 'ok',
      data: { via: 'map.export-native', extension: 'map', wroteTo: 'out/dune.map' },
    })
  })

  it('is unavailable without a target context to answer from', async () => {
    expect((await run({})).result).toMatchObject({ state: 'unavailable' })
    expect((await run({ targetContext: 'F:/GAMES/RA2' }, false)).result).toMatchObject({
      state: 'unavailable',
    })
  })
})
