import { describe, expect, it } from 'vitest'
import { editPlanFromInput, replaceBytes } from '../src/index.js'

describe('editPlanFromInput', () => {
  it('preserves nested source ancestry in the owner target and edit', () => {
    const source = {
      id: 'file:///map.SC2Map?vfs-path=t3HeightMap',
      uri: 'file:///map.SC2Map?vfs-path=t3HeightMap',
      parentIds: ['file:///map.SC2Map'],
    }
    const input = {
      originKind: 'single',
      bindings: [{
        sourceKind: 'candidate',
        bindingId: 'content',
        role: 'content',
        ownership: 'owned',
        source,
        revision: 'provider-token:nested-height-map',
      }],
      primaryBindingId: 'content',
      revisions: {
        topology: 'single',
        revision: 'provider-token:nested-height-map',
        bindings: [{ bindingId: 'content', revision: 'provider-token:nested-height-map' }],
        compositionFingerprint: 'nested-height-map',
      },
    }
    const plan = editPlanFromInput(input as never, {
      planId: 'nested-source',
      edits: [replaceBytes(0, 1, new Uint8Array([1]))],
      fidelity: { roundTrip: 'semantic', preservesUnknownData: true },
    })
    expect(plan.targets[0]?.ownerSource).toEqual(source)
    expect(plan.edits[0]?.source).toEqual(source)
  })
})
