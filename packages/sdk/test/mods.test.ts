import { describe, expect, it } from 'vitest'
import { resolveModWorkspaceGraph, type ModWorkspaceGraphRoot } from '@modkitx-x3/sdk/mods'

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
})
