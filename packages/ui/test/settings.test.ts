import { describe, expect, it } from 'vitest'

import {
  createMemorySettingsStore,
  enabledExtensions,
  normalizeSettings,
  serializeSettings,
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
