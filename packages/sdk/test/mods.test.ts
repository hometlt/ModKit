import { describe, expect, it } from 'vitest'
import { resolveModWorkspaceGraph, type ModWorkspaceGraphRoot } from '@modkit/sdk/mods'

const source = { sourceId: 'fixture', kind: 'memory', location: 'memory://mods' }

function root(
  rootId: string,
  dependencies: ModWorkspaceGraphRoot['dependencies'] = [],
): ModWorkspaceGraphRoot {
  return {
    rootId,
    sourceId: source.sourceId,
    sourcePath: `${rootId}.mod`,
    displayName: rootId,
    kind: 'mod',
    dependencies,
  }
}

describe('game-neutral mod workspace graph', () => {
  it('preserves declared root case policy and refuses malformed policy values', () => {
    const input = {
      workspaceId: 'case-policy',
      gameId: 'example/game',
      activeRootId: 'strict',
      sources: [source],
      roots: [{ ...root('strict'), caseSensitive: true }],
      maxRoots: 4,
      maxDepth: 4,
    }
    expect(resolveModWorkspaceGraph(input).loadOrder[0]?.caseSensitive).toBe(true)
    expect(() =>
      resolveModWorkspaceGraph({
        ...input,
        roots: [{ ...root('strict'), caseSensitive: 'true' as never }],
      }),
    ).toThrow(/invalid caseSensitive/u)
  })

  it('emits deterministic dependency-first order', () => {
    const lock = resolveModWorkspaceGraph({
      workspaceId: 'ordered',
      gameId: 'example/game',
      activeRootId: 'map',
      sources: [source],
      roots: [
        root('map', [
          { targetRootId: 'game', ref: 'game', required: true, provenance: 'declared' },
          { targetRootId: 'assets', ref: 'assets', required: true, provenance: 'declared' },
        ]),
        root('assets', [
          { targetRootId: 'core', ref: 'core', required: true, provenance: 'declared' },
        ]),
        root('game', [
          { targetRootId: 'core', ref: 'core', required: true, provenance: 'implicit' },
        ]),
        root('core'),
      ],
      maxRoots: 16,
      maxDepth: 8,
    })

    expect(lock.complete).toBe(true)
    expect(lock.loadOrder.map(item => item.rootId)).toEqual(['core', 'game', 'assets', 'map'])
    expect(lock.dependencyOrder.map(item => item.rootId)).toEqual(['core', 'game', 'assets'])
    expect(lock.logicalRoots?.map(item => item.rootId)).toEqual(['map', 'assets', 'game', 'core'])
  })

  it('keeps structured evidence for missing and cyclic required dependencies', () => {
    const lock = resolveModWorkspaceGraph({
      workspaceId: 'incomplete',
      gameId: 'example/game',
      activeRootId: 'a',
      sources: [source],
      roots: [
        root('a', [
          { targetRootId: 'b', ref: 'b', required: true, provenance: 'declared' },
          { targetRootId: 'missing', ref: 'missing', required: true, provenance: 'declared' },
        ]),
        root('b', [{ targetRootId: 'a', ref: 'a', required: true, provenance: 'declared' }]),
      ],
      maxRoots: 16,
      maxDepth: 8,
    })

    expect(lock.complete).toBe(false)
    expect(lock.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'common.mod/dependency-cycle', cycle: ['a', 'b', 'a'] }),
        expect.objectContaining({
          code: 'common.mod/dependency-unresolved',
          rootId: 'a',
          dependencyRef: 'missing',
        }),
      ]),
    )
  })

  it('keeps sibling-branch overlay precedence independent of root enumeration order', () => {
    const map = root('map', [
      { targetRootId: 'left', ref: 'left', required: true, provenance: 'declared' },
      { targetRootId: 'right', ref: 'right', required: true, provenance: 'declared' },
    ])
    const left = root('left', [
      { targetRootId: 'base', ref: 'base', required: true, provenance: 'declared' },
    ])
    const right = root('right', [
      { targetRootId: 'base', ref: 'base', required: true, provenance: 'declared' },
    ])
    const base = root('base')
    const resolve = (roots: readonly ModWorkspaceGraphRoot[]) =>
      resolveModWorkspaceGraph({
        workspaceId: 'branches',
        gameId: 'example/game',
        activeRootId: 'map',
        sources: [source],
        roots,
        maxRoots: 16,
        maxDepth: 8,
      })

    const forward = resolve([map, left, right, base])
    const scrambled = resolve([right, base, map, left])
    expect(forward.loadOrder.map(item => item.rootId)).toEqual(['base', 'left', 'right', 'map'])
    expect(forward.logicalRoots?.map(item => item.rootId)).toEqual(['map', 'right', 'left', 'base'])
    expect(scrambled.logicalRoots?.map(item => item.rootId)).toEqual(
      forward.logicalRoots?.map(item => item.rootId),
    )
  })
})
