import { describe, expect, it } from 'vitest'
import { createModelVariantSource } from '../src/model/sources.js'

describe('model variant source', () => {
  it('pages variants in the order they are published', async () => {
    const source = createModelVariantSource({
      variants: [
        {
          id: 'stop',
          name: 'standing',
          slot: 'treads',
          default: true,
          showPrimitiveIds: [],
          hidePrimitiveIds: [],
        },
        {
          id: 'move',
          name: 'moving',
          slot: 'treads',
          showPrimitiveIds: ['move'],
          hidePrimitiveIds: ['stop'],
        },
      ],
    })
    expect(await source.info()).toEqual({ variants: 2 })
    const page = await source.variants({ limit: 10 })
    expect(page.items.map(variant => variant.id)).toEqual(['stop', 'move'])
  })

  it('refuses a repeated id, two defaults of a slot and a primitive both shown and hidden', () => {
    const variant = { name: 'x', showPrimitiveIds: [], hidePrimitiveIds: [] }
    expect(() =>
      createModelVariantSource({
        variants: [
          { ...variant, id: 'a' },
          { ...variant, id: 'a' },
        ],
      }),
    ).toThrow(/repeated/)
    expect(() =>
      createModelVariantSource({
        variants: [
          { ...variant, id: 'a', default: true },
          { ...variant, id: 'b', default: true },
        ],
      }),
    ).toThrow(/two default/)
    expect(() =>
      createModelVariantSource({
        variants: [{ ...variant, id: 'a', showPrimitiveIds: ['p'], hidePrimitiveIds: ['p'] }],
      }),
    ).toThrow(/both shows and hides/)
  })
})
