import { describe, expect, it } from 'vitest'

import {
  configuredContributionSettings,
  configuredIndexCaches,
  indexCacheEnabled,
} from '../src/contribution-settings.js'

describe('configuredContributionSettings', () => {
  it('keys settings by contribution and narrows them per source', () => {
    const resolved = configuredContributionSettings({
      configured: {
        'blizzard/casc': {
          cacheIndex: true,
          bySource: { 'file:///c%3A/Games/StarCraft II': { cacheIndex: false } },
        },
        'blizzard/mpq': { something: 1 },
      },
    })

    expect(resolved.problems).toEqual([])
    const casc = resolved.settingsFor('blizzard/casc')
    expect(casc?.values).toMatchObject({ cacheIndex: true })
    expect(casc?.bySource?.['file:///c%3A/Games/StarCraft II']).toEqual({ cacheIndex: false })
    expect(resolved.settingsFor('blizzard/mpq')?.values).toEqual({ something: 1 })
    // `bySource` is the narrowing key, never a value of its own.
    expect(casc?.values).not.toHaveProperty('bySource')
  })

  it('gives every contribution its own cache directory, even with nothing configured', () => {
    const resolved = configuredContributionSettings({ cacheDirectory: '/storage/cache' })
    const first = resolved.settingsFor('blizzard/casc')?.values['cacheDirectory']
    const second = resolved.settingsFor('blizzard/mpq')?.values['cacheDirectory']

    expect(typeof first).toBe('string')
    expect(first).not.toBe(second)
    expect(String(first)).toContain('blizzard-casc')
    // Stable across calls: a contribution finds last window's cache where it left it.
    expect(resolved.settingsFor('blizzard/casc')?.values['cacheDirectory']).toBe(first)
  })

  it('returns nothing for a contribution the user never configured and no storage', () => {
    expect(configuredContributionSettings({}).settingsFor('blizzard/casc')).toBeUndefined()
  })

  it('reports a malformed setting instead of swallowing it', () => {
    const resolved = configuredContributionSettings({
      configured: { 'blizzard/casc': ['not', 'an', 'object'], 'blizzard/mpq': { bySource: 7 } },
    })

    expect(resolved.problems).toHaveLength(2)
    expect(resolved.problems[0]).toContain('blizzard/casc')
    expect(resolved.problems[1]).toContain('bySource')
    expect(configuredContributionSettings({ configured: 'nonsense' }).problems).toHaveLength(1)
  })

  it('shares one index cache directory and turns name switches into each game key', () => {
    const resolved = configuredContributionSettings({
      indexCacheDirectory: '/storage/index-cache',
      indexCaches: { s2: { names: false }, d3: { content: false } },
      configured: { 'blizzard/casc': { games: { s2: { cacheIndex: true }, hero: { other: 1 } } } },
    })

    expect(resolved.problems).toEqual([])
    // every contribution is told the same directory: a codec and a content source share a cache
    expect(resolved.settingsFor('blizzard/casc')?.values['indexCacheDirectory']).toBe(
      '/storage/index-cache',
    )
    expect(resolved.settingsFor('blizzard/mpq')?.values['indexCacheDirectory']).toBe(
      '/storage/index-cache',
    )
    // a switch applies to every contribution; what one contribution's own entry says wins
    expect(resolved.settingsFor('blizzard/mpq')?.values['games']).toEqual({
      s2: { cacheIndex: false },
    })
    expect(resolved.settingsFor('blizzard/casc')?.values['games']).toEqual({
      s2: { cacheIndex: true },
      hero: { other: 1 },
    })
  })

  it('keeps every index unless a product turns it off, and reports a malformed switch', () => {
    const switches = configuredIndexCaches({ s2: { content: false }, d3: { names: 'no' } })

    expect(indexCacheEnabled(switches, 's2', 'content')).toBe(false)
    expect(indexCacheEnabled(switches, 's2', 'names')).toBe(true)
    expect(indexCacheEnabled(switches, 'wow', 'content')).toBe(true)
    expect(indexCacheEnabled(switches, undefined, 'content')).toBe(true)
    expect(switches.problems).toEqual(["modkit.indexCaches['d3'].names must be true or false"])
    expect(configuredIndexCaches([1]).problems).toHaveLength(1)
  })
})
