import { describe, expect, it } from 'vitest'
import { classifyParity, comparableMetadataFeatures } from '../parity/classify.mjs'

describe('parity classification', () => {
  it('distinguishes parity, poorer, richer and missing X3 surfaces', () => {
    expect(classifyParity(['source:model'], ['source:model'])).toMatchObject({
      classification: 'паритет',
    })
    expect(classifyParity(['source:model', 'geometry:decoded'], ['source:model'])).toMatchObject({
      classification: 'X3 беднее',
      missing: ['geometry:decoded'],
    })
    expect(classifyParity(['source:model'], ['source:model', 'source:tree'])).toMatchObject({
      classification: 'X3 богаче',
      extra: ['source:tree'],
    })
    expect(classifyParity(['source:model'], [], false)).toMatchObject({
      classification: 'нет в X3',
    })
  })

  it('normalizes only comparable integer metadata counters', () => {
    expect(comparableMetadataFeatures({ meshes: 1, nodes: 2, label: 'model' })).toEqual([
      'metadata:meshes',
      'metadata:nodes',
    ])
  })
})
