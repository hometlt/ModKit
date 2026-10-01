import { describe, expect, it, vi } from 'vitest'

import { commandOutputLeaf, worldUvwReceiptOf } from '../src/command-output.js'
import { withVsCodeMapWorld } from '../src/map-preview.js'

describe('command output', () => {
  it('names a conversion after its subject and target, an extracted member after itself', () => {
    expect(commandOutputLeaf('subject.convert', 'C:\\Maps\\Amphion.SC2Map', 'world.uvw')).toBe(
      'Amphion.uvw',
    )
    expect(commandOutputLeaf('subject.convert', '/models/Marine.m3', 'uvm')).toBe('Marine.uvm')
    expect(commandOutputLeaf('subject.convert', undefined, 'world.uvw')).toBe('export.uvw')
    expect(commandOutputLeaf('subject.extract', 'C:\\mp.wz', 'multiplay/maps/rush.gam')).toBe(
      'rush.gam',
    )
  })

  it('reads the receipt of a world exported as UVW, and nothing else', () => {
    const receipt = {
      artifactDigest: 'sha256:ab',
      excludedFacetIds: ['navigation'],
      omittedObjects: 2,
      lostFields: [{ path: '/objects/0/tint', count: 3 }],
    }
    expect(worldUvwReceiptOf({ byteLength: 10, wroteTo: 'C:\\a.uvw', receipt })).toEqual(receipt)
    expect(worldUvwReceiptOf({ byteLength: 10, wroteTo: null })).toBeUndefined()
    expect(worldUvwReceiptOf(null)).toBeUndefined()
  })
})

describe('a map opened with its world (П24)', () => {
  const budgets = {
    maxInputBytes: 1n,
    maxDepth: 1,
    maxNodes: 1,
    maxScalarBytes: 1,
    maxDiagnostics: 1,
    deadlineMs: 1,
  } as const
  const opener = (dispose: () => Promise<void>) => async () => ({
    snapshot: { state: 'opened' } as never,
    session: { dispose } as never,
  })

  it('asks which map of a package, then adds its world to the subject', async () => {
    const preview = { dispose: vi.fn(async () => undefined) }
    const selections: (string | undefined)[] = []
    const open = withVsCodeMapWorld(
      opener(async () => undefined),
      {
        services: {} as never,
        grant: { id: 'test', classes: ['read-source'] },
        budgets,
        choose: async candidates => candidates[1]?.candidateId,
        coordinate: async request => {
          selections.push(request.selectionId)
          return request.selectionId === undefined
            ? {
                state: 'selection-required',
                candidates: [
                  { candidateId: 'a', displayName: 'A' },
                  { candidateId: 'b', displayName: 'B' },
                ],
                diagnostics: [],
              }
            : ({ state: 'opened', session: preview, diagnostics: [] } as never)
        },
      },
    )
    const opened = await open('C:\\maps\\mp.wz')
    expect(selections).toEqual([undefined, 'b'])
    // the world joins the subject, which keeps its own operations; releasing it releases both
    await opened.session?.dispose()
    expect(preview.dispose).toHaveBeenCalledOnce()
  })

  it('releases the subject when no map is chosen, and keeps a subject that is no map', async () => {
    const dispose = vi.fn(async () => undefined)
    const inputs = {
      services: {} as never,
      grant: { id: 'test', classes: ['read-source' as const] },
      budgets,
      choose: async () => undefined,
    }
    await expect(
      withVsCodeMapWorld(opener(dispose), {
        ...inputs,
        coordinate: async () => ({
          state: 'selection-required',
          candidates: [{ candidateId: 'a', displayName: 'A' }],
          diagnostics: [],
        }),
      })('C:\\campaign.SC2Campaign'),
    ).rejects.toThrow('no map was chosen')
    expect(dispose).toHaveBeenCalledOnce()

    const plain = await withVsCodeMapWorld(opener(dispose), {
      ...inputs,
      coordinate: async () => ({ state: 'not-applicable', diagnostics: [] }),
    })('C:\\picture.png')
    expect(plain.session).toEqual({ dispose })
  })
})
