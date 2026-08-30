import { describe, expect, it } from 'vitest'

import {
  createMemorySettingsStore,
  DEFAULT_SETTINGS,
  enabledExtensions,
  GAME_INSTALLATION_PATH_LIMIT,
  normalizeSettings,
  RECENT_LIMIT,
  serializeSettings,
  withRecent,
  type SettingsDocument,
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

  it('normalizes disabled extension coordinates as a deterministic independent set', () => {
    const normalized = normalizeSettings({
      extensions: [
        { id: 'org.example/pack', path: './pack', enabled: true },
        { id: 'org.example/off-at-source', path: './off', enabled: false },
      ],
      disabledExtensions: [
        ' org.example/zeta ',
        'org.example/alpha',
        'org.example/zeta',
        'NOT.QUALIFIED/value',
        'missing-slash',
        17,
      ],
      disabledContributions: ['org.example/one-codec'],
    })

    expect(normalized.document.disabledExtensions).toEqual([
      'org.example/alpha',
      'org.example/zeta',
    ])
    expect(normalized.document.disabledContributions).toEqual(['org.example/one-codec'])
    expect(normalized.problems).toEqual([
      'disabledExtensions[3] is not an extension coordinate; ignored',
      'disabledExtensions[4] is not an extension coordinate; ignored',
      'disabledExtensions[5] is not an extension coordinate; ignored',
    ])

    // Disablement is passed to host composition. It must not remove the extension before inventory
    // is built; the source-level `enabled` switch remains the only load filter here.
    expect(enabledExtensions(normalized.document).map(extension => extension.id)).toEqual([
      'org.example/pack',
    ])
  })

  it('serializes disabled extension coordinates canonically and accepts old schema-v1 objects', () => {
    const document = normalizeSettings({
      disabledExtensions: ['org.example/zeta', 'org.example/alpha'],
    }).document
    const serialized = serializeSettings(document)
    expect(serialized.indexOf('org.example/alpha')).toBeLessThan(
      serialized.indexOf('org.example/zeta'),
    )
    expect(normalizeSettings(JSON.parse(serialized)).document.disabledExtensions).toEqual([
      'org.example/alpha',
      'org.example/zeta',
    ])

    const legacy = { ...document } as Record<string, unknown>
    delete legacy['disabledExtensions']
    expect(
      JSON.parse(serializeSettings(legacy as unknown as SettingsDocument)).disabledExtensions,
    ).toEqual([])
  })

  it('normalizes bounded local game installation paths and preserves their priority order', () => {
    const tooMany = Array.from(
      { length: GAME_INSTALLATION_PATH_LIMIT + 2 },
      (_, index) => `C:\\Games\\ALPHA-${index}`,
    )
    const normalized = normalizeSettings({
      gameInstallations: {
        'ORG.EXAMPLE/GAME-ALPHA': {
          configuredPaths: [
            ' C:\\Games\\Example Game Alpha ',
            'https://example.invalid/game',
            'relative/game',
            'C:\\Games\\Example Game Alpha',
            ...tooMany,
          ],
        },
        'not-qualified': { configuredPaths: ['/ignored'] },
        'org.example/game-beta': {
          configuredPaths: ['/opt/gamebeta', 'bad\0path'],
        },
      },
    })

    expect(
      normalized.document.gameInstallations['org.example/game-alpha']?.configuredPaths,
    ).toEqual([
      'C:\\Games\\Example Game Alpha',
      ...tooMany.slice(0, GAME_INSTALLATION_PATH_LIMIT - 1),
    ])
    expect(normalized.document.gameInstallations['org.example/game-beta']?.configuredPaths).toEqual(
      ['/opt/gamebeta'],
    )
    expect(normalized.document.gameInstallations['not-qualified']).toBeUndefined()
    expect(normalized.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('not a valid local path'),
        expect.stringContaining('was truncated'),
        expect.stringContaining('is not a qualified game id'),
      ]),
    )
  })

  it('serializes game ids deterministically without reordering configured paths', () => {
    const document = normalizeSettings({
      gameInstallations: {
        'org.example/game-beta': { configuredPaths: ['/second', '/first'] },
        'org.example/game-alpha': { configuredPaths: ['D:\\ALPHA', 'C:\\ALPHA'] },
      },
    }).document
    const serialized = serializeSettings(document)
    expect(serialized.indexOf('org.example/game-alpha')).toBeLessThan(
      serialized.indexOf('org.example/game-beta'),
    )
    expect(serialized.indexOf('D:\\\\ALPHA')).toBeLessThan(serialized.indexOf('C:\\\\ALPHA'))
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
