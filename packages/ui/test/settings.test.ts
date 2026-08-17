import { describe, expect, it } from 'vitest'

import {
  createMemorySettingsStore,
  DEFAULT_SETTINGS,
  enabledExtensions,
  normalizeSettings,
  RECENT_LIMIT,
  serializeSettings,
  withRecent,
} from '@modkitx-x3/ui/settings'

describe('portable settings', () => {
  it('normalizes malformed input without refusing startup', () => {
    const normalized = normalizeSettings({
      schemaVersion: 99,
      appearance: { theme: ' custom ', density: 'tiny' },
      extensions: [
        { id: 'org.example/one', path: './one' },
        { id: 'org.example/one', path: './replacement', enabled: false },
        { id: '', path: './invalid' },
      ],
    })

    expect(normalized.document.appearance).toEqual({ theme: 'custom', density: 'compact' })
    expect(normalized.document.extensions).toEqual([
      { id: 'org.example/one', path: './replacement', enabled: false },
    ])
    expect(normalized.problems).toHaveLength(4)
    expect(enabledExtensions(normalized.document)).toEqual([])
  })

  it('serializes extension identities in deterministic order and round-trips through a store', async () => {
    const document = normalizeSettings({
      schemaVersion: 1,
      appearance: { theme: 'modkit-dark', density: 'comfortable' },
      extensions: [
        { id: 'org.example/z', path: './z', enabled: true },
        { id: 'org.example/a', path: './a', enabled: true },
      ],
    }).document

    expect(serializeSettings(document).indexOf('org.example/a')).toBeLessThan(
      serializeSettings(document).indexOf('org.example/z'),
    )

    const store = createMemorySettingsStore()
    await store.write(document)
    const restored = await store.read()
    expect(restored.problems).toEqual([])
    expect(restored.document.appearance).toEqual(document.appearance)
    expect(restored.document.extensions.map(extension => extension.id)).toEqual([
      'org.example/a',
      'org.example/z',
    ])
  })
})

describe('recent entries', () => {
  it('moves a reopened path to the front instead of duplicating it', () => {
    let document = DEFAULT_SETTINGS
    document = withRecent(document, { path: '/a', kind: 'folder' })
    document = withRecent(document, { path: '/b', kind: 'file' })
    document = withRecent(document, { path: '/a', kind: 'folder' })
    expect(document.recent.map(entry => entry.path)).toEqual(['/a', '/b'])
  })

  it('keeps the list bounded so the menu stays readable', () => {
    let document = DEFAULT_SETTINGS
    for (let index = 0; index < RECENT_LIMIT + 5; index += 1) {
      document = withRecent(document, { path: `/p${index}`, kind: 'folder' })
    }
    expect(document.recent).toHaveLength(RECENT_LIMIT)
    // Most recent first: the last write is at the front and the oldest fell off.
    expect(document.recent[0]?.path).toBe(`/p${RECENT_LIMIT + 4}`)
    expect(document.recent.some(entry => entry.path === '/p0')).toBe(false)
  })

  it('survives a hand-edited file with junk entries and preserves order', () => {
    const { document } = normalizeSettings({
      recent: [
        { path: '/keep', kind: 'file' },
        { nonsense: true },
        { path: '/keep', kind: 'folder' },
        { path: '/second', kind: 'nonsense' },
      ],
    })
    // Duplicates collapse, unknown kinds fall back to folder, and recency order is not sorted away.
    expect(document.recent).toEqual([
      { path: '/keep', kind: 'file' },
      { path: '/second', kind: 'folder' },
    ])
  })

  it('round-trips recency through serialize without reordering', () => {
    const document = {
      ...DEFAULT_SETTINGS,
      recent: [
        { path: '/z', kind: 'folder' as const },
        { path: '/a', kind: 'file' as const },
      ],
    }
    const restored = normalizeSettings(JSON.parse(serializeSettings(document))).document
    expect(restored.recent.map(entry => entry.path)).toEqual(['/z', '/a'])
  })
})
