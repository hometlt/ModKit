/**
 * Settings for the browser host.
 *
 * The portable `SettingsDocument` is the same one Electron writes to `userData` and the CLI reads;
 * only the storage differs, which is the whole point of `SettingsStore` being an interface. Here it
 * is one `localStorage` key, written canonically so the bytes match what another host would write.
 *
 * The extensions list inside the settings document is deliberately not writable, and the reason
 * has changed since S12-web: a user *can* now add an extension (a granted folder — see
 * `./extension-roots.ts`) and can switch an inventoried coordinate through the portable
 * `disabledExtensions` set. The folder locator still lives in IndexedDB because a directory handle
 * cannot be serialised to text. So a write to `extensions` is refused *with the reason* rather than
 * accepted and silently ignored on the next boot.
 *
 * `Storage` is taken structurally so the store is tested in Node against a plain map.
 */
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  serializeSettings,
  type NormalizedSettings,
  type SettingsDocument,
  type SettingsStore,
} from '@modkit/ui/settings'
import { applyDensity, applyTheme } from '@modkit/ui/tokens'

/** The `localStorage` surface this module uses. */
export interface WebStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SETTINGS_STORAGE_KEY = 'modkit.app.web/settings'

export const EXTENSIONS_READ_ONLY_REASON =
  'browser extension locations are managed through granted folders and downloaded packages, so ' +
  'the portable locator list cannot be written here; use the Extensions panel to add sources or ' +
  'enable and disable inventoried extensions'

const sameExtensions = (
  left: SettingsDocument['extensions'],
  right: SettingsDocument['extensions'],
): boolean =>
  left.length === right.length &&
  left.every((entry, index) => {
    const other = right[index]
    return other !== undefined && other.id === entry.id && other.enabled === entry.enabled
  })

/**
 * A settings store over web storage.
 *
 * Reading never throws: a settings value edited by hand (or written by an older build) degrades to
 * "that part was ignored, here is why", which is what `normalizeSettings` reports and what the
 * settings panel shows.
 */
export function createWebSettingsStore(
  storage: WebStorageLike,
  key: string = SETTINGS_STORAGE_KEY,
): SettingsStore {
  let current: SettingsDocument = DEFAULT_SETTINGS
  return {
    location: `localStorage[${key}]`,

    async read(): Promise<NormalizedSettings> {
      const raw = storage.getItem(key)
      if (raw === null) {
        current = DEFAULT_SETTINGS
        return { document: DEFAULT_SETTINGS, problems: [] }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        current = DEFAULT_SETTINGS
        return {
          document: DEFAULT_SETTINGS,
          problems: [
            `stored settings are not valid JSON (${
              error instanceof Error ? error.message : String(error)
            }); defaults were used`,
          ],
        }
      }
      const normalized = normalizeSettings(parsed)
      current = normalized.document
      return normalized
    },

    async write(document: SettingsDocument): Promise<void> {
      if (!sameExtensions(document.extensions, current.extensions)) {
        throw new Error(EXTENSIONS_READ_ONLY_REASON)
      }
      storage.setItem(key, serializeSettings(document))
      current = document
    },
  }
}

/** Element shape `applyTheme`/`applyDensity` need, so appearance is provable without a browser. */
export interface ThemeTargetLike {
  readonly style: object
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/**
 * Stamp the chosen appearance on the document root.
 *
 * Both attributes go on the same element the shipped stylesheet and every installed theme select
 * on, so a theme switch is one attribute write and reaches every viewer at once.
 */
export function applyAppearance(
  root: ThemeTargetLike,
  appearance: SettingsDocument['appearance'],
): void {
  applyTheme(root, appearance.theme)
  applyDensity(root, appearance.density)
}
