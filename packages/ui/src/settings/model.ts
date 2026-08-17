/**
 * Portable settings document.
 *
 * One JSON shape for every host. Electron writes it to `userData`, the web app to storage, VS Code
 * beside the workspace, and the CLI reads the very same file — so a user who enables an extension in
 * the desktop app sees it enabled in a headless run against the same profile.
 *
 * Pure data and pure functions: no DOM, no filesystem. Hosts supply persistence through
 * `SettingsStore`, which is the only part that differs between them.
 *
 * Normalisation never throws on bad input. A settings file is user-editable by design, so a typo
 * must degrade to "that entry was ignored, here is why" rather than refusing to start the app.
 */
import { compareUtf8 } from '@modkitx-x3/core'

export type Density = 'compact' | 'comfortable'

/** How a host locates and configures one extension. */
export interface ExtensionSetting {
  /** Qualified id, e.g. `org.modkitx/text-json`. Identity, not location. */
  readonly id: string
  /** Where the host loads it from: a directory path, a package name or a URL. */
  readonly path: string
  readonly enabled: boolean
  /** Extension-specific parameters. Opaque here; the extension validates its own shape. */
  readonly options?: Readonly<Record<string, unknown>>
}

export interface AppearanceSettings {
  readonly theme: string
  readonly density: Density
}

export interface SettingsDocument {
  readonly schemaVersion: 1
  readonly appearance: AppearanceSettings
  readonly extensions: readonly ExtensionSetting[]
}

export const SETTINGS_SCHEMA_VERSION = 1

export const DEFAULT_SETTINGS: SettingsDocument = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  appearance: Object.freeze({ theme: 'modkit-dark', density: 'compact' as Density }),
  extensions: Object.freeze([]),
})

export interface NormalizedSettings {
  readonly document: SettingsDocument
  /** Human-readable reasons entries were dropped or corrected. Never thrown, always reported. */
  readonly problems: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/**
 * Coerce arbitrary JSON into a valid document.
 *
 * Duplicate extension ids collapse to the last entry: a settings file merged by hand or by two
 * tools writing at once should not produce an extension that is both enabled and disabled.
 */
export function normalizeSettings(value: unknown): NormalizedSettings {
  const problems: string[] = []
  if (!isRecord(value)) {
    return {
      document: DEFAULT_SETTINGS,
      problems: value === undefined ? [] : ['settings root is not an object; defaults were used'],
    }
  }

  const version = value['schemaVersion']
  if (version !== undefined && version !== SETTINGS_SCHEMA_VERSION) {
    problems.push(
      `unknown schemaVersion ${String(version)}; expected ${SETTINGS_SCHEMA_VERSION}. ` +
        'Unrecognised fields were ignored.',
    )
  }

  const appearanceInput = isRecord(value['appearance']) ? value['appearance'] : {}
  const theme = asText(appearanceInput['theme']) ?? DEFAULT_SETTINGS.appearance.theme
  const densityInput = appearanceInput['density']
  const density: Density =
    densityInput === 'compact' || densityInput === 'comfortable'
      ? densityInput
      : DEFAULT_SETTINGS.appearance.density
  if (densityInput !== undefined && densityInput !== density) {
    problems.push(`appearance.density "${String(densityInput)}" is not valid; used "${density}"`)
  }

  const extensions: ExtensionSetting[] = []
  const seen = new Map<string, number>()
  const listInput = value['extensions']
  if (listInput !== undefined && !Array.isArray(listInput)) {
    problems.push('extensions must be an array; it was ignored')
  } else {
    for (const [index, item] of (listInput ?? []).entries()) {
      if (!isRecord(item)) {
        problems.push(`extensions[${index}] is not an object; ignored`)
        continue
      }
      const id = asText(item['id'])
      const path = asText(item['path'])
      if (id === undefined || path === undefined) {
        problems.push(`extensions[${index}] needs both "id" and "path"; ignored`)
        continue
      }
      const entry: ExtensionSetting = {
        id,
        path,
        // Absent means enabled: adding a path to the file is how a user asks for an extension.
        enabled: item['enabled'] !== false,
        ...(isRecord(item['options']) ? { options: Object.freeze({ ...item['options'] }) } : {}),
      }
      const existing = seen.get(id)
      if (existing === undefined) {
        seen.set(id, extensions.length)
        extensions.push(entry)
      } else {
        problems.push(`extensions[${index}] duplicates id "${id}"; the later entry won`)
        extensions[existing] = entry
      }
    }
  }

  return {
    document: Object.freeze({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      appearance: Object.freeze({ theme, density }),
      extensions: Object.freeze(extensions),
    }),
    problems: Object.freeze(problems),
  }
}

/** Serialize canonically so two hosts writing the same settings produce the same bytes. */
export function serializeSettings(document: SettingsDocument): string {
  return `${JSON.stringify(
    {
      schemaVersion: document.schemaVersion,
      appearance: { theme: document.appearance.theme, density: document.appearance.density },
      extensions: [...document.extensions]
        .sort((a, b) => compareUtf8(a.id, b.id))
        .map(entry => ({
          id: entry.id,
          path: entry.path,
          enabled: entry.enabled,
          ...(entry.options === undefined ? {} : { options: entry.options }),
        })),
    },
    null,
    2,
  )}\n`
}

/** The extensions a host should actually load. */
export function enabledExtensions(document: SettingsDocument): readonly ExtensionSetting[] {
  return document.extensions.filter(entry => entry.enabled)
}

export interface SettingsStore {
  read(): Promise<NormalizedSettings>
  write(document: SettingsDocument): Promise<void>
  /** Where the settings live, for display. A path, a URL, or a storage key. */
  readonly location: string
}

/** Non-persistent store, for a host with nowhere to write yet (and for tests). */
export function createMemorySettingsStore(
  initial: SettingsDocument = DEFAULT_SETTINGS,
): SettingsStore {
  let current = initial
  return {
    location: 'memory',
    async read() {
      return normalizeSettings(JSON.parse(serializeSettings(current)))
    },
    async write(document) {
      current = document
    },
  }
}
