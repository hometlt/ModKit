/**
 * A2: settings and the panel's operation policy, both provable without a browser.
 *
 * The settings document is the portable one every host writes, so the assertions are about storage
 * and honesty: what round-trips, what a theme choice does to the document root, what the picker is
 * allowed to offer, and what happens when something tries to write an extension list this host
 * cannot honour.
 */
import { describe, expect, it } from 'vitest'
import type { AnyDescriptor } from '@modkitx-x3/sdk'
import { DEFAULT_SETTINGS, normalizeSettings, type SettingsDocument } from '@modkitx-x3/ui'
import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import {
  applyAppearance,
  createWebSettingsStore,
  EXTENSIONS_READ_ONLY_REASON,
  SETTINGS_STORAGE_KEY,
  type WebStorageLike,
} from '../src/settings.js'
import { NON_MUTATING_OPERATION_IDS, nonMutatingDescriptor } from '../src/inspector.js'

function memoryStorage(initial?: string): WebStorageLike & { readonly written: string[] } {
  const written: string[] = []
  let value = initial
  return {
    written,
    getItem: () => value ?? null,
    setItem: (_key, next) => {
      value = next
      written.push(next)
    },
  }
}

/** The two calls `applyTheme`/`applyDensity` make, and nothing else. */
function fakeRoot(): { readonly attributes: Map<string, string>; readonly style: object } & {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
} {
  const attributes = new Map<string, string>()
  return {
    attributes,
    style: {},
    setAttribute: (name, value) => void attributes.set(name, value),
    removeAttribute: name => void attributes.delete(name),
  }
}

describe('web settings', () => {
  it('starts from the shared defaults when nothing was ever written', async () => {
    const store = createWebSettingsStore(memoryStorage())
    const loaded = await store.read()
    expect(loaded.document).toEqual(DEFAULT_SETTINGS)
    expect(loaded.problems).toEqual([])
    expect(store.location).toContain(SETTINGS_STORAGE_KEY)
  })

  it('persists a theme choice and reads it back as the same document', async () => {
    const storage = memoryStorage()
    const store = createWebSettingsStore(storage)
    await store.read()
    const chosen: SettingsDocument = {
      ...DEFAULT_SETTINGS,
      appearance: { theme: 'nexus-forge', density: 'comfortable' },
    }
    await store.write(chosen)
    expect(storage.written).toHaveLength(1)

    const reopened = createWebSettingsStore(storage)
    const loaded = await reopened.read()
    expect(loaded.document.appearance).toEqual({ theme: 'nexus-forge', density: 'comfortable' })
    // canonical bytes: another host reading the same key normalizes to the same document
    expect(normalizeSettings(JSON.parse(storage.written[0] ?? '{}')).document).toEqual(
      loaded.document,
    )
  })

  it('degrades to the defaults, with the reason, when the stored value is not settings', async () => {
    const broken = await createWebSettingsStore(memoryStorage('{not json')).read()
    expect(broken.document).toEqual(DEFAULT_SETTINGS)
    expect(broken.problems[0]).toMatch(/not valid JSON/u)

    const wrong = await createWebSettingsStore(
      memoryStorage(JSON.stringify({ appearance: { density: 'roomy' } })),
    ).read()
    expect(wrong.document.appearance.density).toBe('compact')
    expect(wrong.problems.join(' ')).toMatch(/density "roomy" is not valid/u)
  })

  it('refuses to write an extension list, naming the reason instead of dropping it silently', async () => {
    const store = createWebSettingsStore(memoryStorage())
    await store.read()
    await expect(
      store.write({
        ...DEFAULT_SETTINGS,
        extensions: [{ id: 'someone/thing', path: 'https://example.test/thing', enabled: true }],
      }),
    ).rejects.toThrow(EXTENSIONS_READ_ONLY_REASON)
  })

  it('applies the appearance by stamping the two attributes the stylesheet selects on', () => {
    const root = fakeRoot()
    applyAppearance(root, { theme: 'fixture', density: 'comfortable' })
    expect(root.attributes.get('data-mk-theme')).toBe('fixture')
    expect(root.attributes.get('data-mk-density')).toBe('comfortable')
    applyAppearance(root, { theme: 'modkit-light', density: 'compact' })
    expect(root.attributes.get('data-mk-theme')).toBe('modkit-light')
    expect(root.attributes.get('data-mk-density')).toBe('compact')
  })

  it('lists the attested catalog and names why the rest is not served here', () => {
    expect(WEB_EXTENSION_CATALOG.extensions.length).toBeGreaterThan(0)
    for (const excluded of WEB_EXTENSION_CATALOG.excluded) {
      expect(excluded.reason).toMatch(/not vendored/u)
    }
    expect(WEB_EXTENSION_CATALOG.excluded.map(entry => entry.name)).toContain('text-json')
  })
})

describe('inspector operation policy', () => {
  const descriptor = (
    operations: readonly { id: string; handlerId: string; mutatesSource: boolean }[],
  ): AnyDescriptor =>
    ({
      schemaVersion: 2,
      subjectUri: 'memory://web/ops',
      revision: 'content-hash.sha256:ops',
      interpretation: 'none',
      candidates: [],
      origin: { kind: 'source' },
      constraints: { readOnly: true, seekable: true, randomAccess: true, trusted: false },
      traits: [],
      dataSources: [],
      diagnostics: [],
      operations: operations.map(operation => ({ ...operation, state: 'available' })),
    }) as unknown as AnyDescriptor

  it('offers exactly the three standard non-mutating operations', () => {
    const filtered = nonMutatingDescriptor(
      descriptor([
        { id: 'view.inspect', handlerId: 'inspect', mutatesSource: false },
        { id: 'asset.validate', handlerId: 'validate', mutatesSource: false },
        { id: 'export.raw', handlerId: 'export-raw', mutatesSource: false },
        { id: 'edit.field', handlerId: 'set-text', mutatesSource: true },
        { id: 'org.example/archive.extract-entry', handlerId: 'x', mutatesSource: false },
      ]),
    )
    expect(filtered.operations.map(operation => operation.id)).toEqual(NON_MUTATING_OPERATION_IDS)
  })

  it('drops an operation that claims a standard id but mutates the source', () => {
    const filtered = nonMutatingDescriptor(
      descriptor([{ id: 'export.raw', handlerId: 'export-raw', mutatesSource: true }]),
    )
    expect(filtered.operations).toEqual([])
  })
})
