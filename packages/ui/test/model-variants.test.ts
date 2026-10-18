import type { ModelVariantRef } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { chooseModelVariant, modelVariantSlots } from '../src/model/source.js'

const variant = (
  id: string,
  slot: string | undefined,
  showPrimitiveIds: string[],
  hidePrimitiveIds: string[],
): ModelVariantRef => ({
  id,
  name: id,
  ...(slot === undefined ? {} : { slot }),
  showPrimitiveIds,
  hidePrimitiveIds,
})

describe('model variants in the viewer', () => {
  it('groups by slot and swaps what a slot hides, keeping other primitives', () => {
    const slots = modelVariantSlots([
      variant('stop', 'treads', ['p-stop'], ['p-move']),
      variant('move', 'treads', ['p-move'], ['p-stop']),
      variant('open', undefined, [], ['p-door']),
    ])
    expect([...slots.keys()]).toEqual(['treads', ''])
    const hidden = new Set(['p-lod-far'])
    chooseModelVariant(hidden, slots.get('treads') ?? [], 'stop')
    expect([...hidden].sort()).toEqual(['p-lod-far', 'p-move'])
    chooseModelVariant(hidden, slots.get('treads') ?? [], 'move')
    expect([...hidden].sort()).toEqual(['p-lod-far', 'p-stop'])
    chooseModelVariant(hidden, slots.get('treads') ?? [], '')
    expect([...hidden]).toEqual(['p-lod-far'])
  })
})
