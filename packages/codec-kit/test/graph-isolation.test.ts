import { describe, expect, it } from 'vitest'
import { analyzeGraphIsolation, type GraphIsolationEdge } from '../src/graph-isolation.js'

const edge = (
  id: string,
  from: string,
  to: string,
  rewritable = true,
): GraphIsolationEdge => ({ id, from, to, relation: 'typed-link', rewritable })

describe('graph isolation analysis', () => {
  it('reports other owners and rewires only the exact selected owner edge', () => {
    expect(
      analyzeGraphIsolation({
        schemaVersion: 1,
        ownerId: 'Unit/Marine',
        targetId: 'Weapon/GaussRifle',
        edges: [
          edge('marine.weapon.0', 'Unit/Marine', 'Weapon/GaussRifle'),
          edge('marine.weapon.1', 'Unit/Marine', 'Weapon/GaussRifle'),
          edge('marauder.weapon.0', 'Unit/Marauder', 'Weapon/GaussRifle'),
        ],
        selectedEdgeIds: ['marine.weapon.0'],
        complete: true,
        maxEdges: 8,
      }),
    ).toEqual({
      schemaVersion: 1,
      state: 'ready',
      ownerId: 'Unit/Marine',
      targetId: 'Weapon/GaussRifle',
      shared: true,
      referrers: [
        { nodeId: 'Unit/Marauder', edgeIds: ['marauder.weapon.0'] },
        { nodeId: 'Unit/Marine', edgeIds: ['marine.weapon.0', 'marine.weapon.1'] },
      ],
      otherReferrerIds: ['Unit/Marauder'],
      rewireEdgeIds: ['marine.weapon.0'],
    })
  })

  it('handles cycles elsewhere without treating outgoing edges as referrers', () => {
    const result = analyzeGraphIsolation({
      schemaVersion: 1,
      ownerId: 'A',
      targetId: 'B',
      edges: [edge('a-b', 'A', 'B'), edge('b-a', 'B', 'A')],
      complete: true,
      maxEdges: 2,
    })
    expect(result).toMatchObject({ state: 'ready', shared: false, rewireEdgeIds: ['a-b'] })
  })

  it('refuses incomplete graphs and non-rewritable owner links', () => {
    expect(
      analyzeGraphIsolation({
        schemaVersion: 1,
        ownerId: 'A',
        targetId: 'B',
        edges: [edge('a-b', 'A', 'B')],
        complete: false,
        maxEdges: 1,
      }),
    ).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('incomplete') })
    expect(
      analyzeGraphIsolation({
        schemaVersion: 1,
        ownerId: 'A',
        targetId: 'B',
        edges: [edge('parent', 'A', 'B', false)],
        complete: true,
        maxEdges: 1,
      }),
    ).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('no selected') })
  })

  it('enforces edge bounds and stable identities', () => {
    expect(() =>
      analyzeGraphIsolation({
        schemaVersion: 1,
        ownerId: 'A',
        targetId: 'B',
        edges: [edge('one', 'A', 'B'), edge('two', 'C', 'B')],
        complete: true,
        maxEdges: 1,
      }),
    ).toThrow(/limit exceeded/u)
    expect(() =>
      analyzeGraphIsolation({
        schemaVersion: 1,
        ownerId: 'A',
        targetId: 'B',
        edges: [edge('same', 'A', 'B'), edge('same', 'C', 'B')],
        complete: true,
        maxEdges: 2,
      }),
    ).toThrow(/duplicate graph edge/u)
  })
})
