/**
 * A person's small viewer preferences — the media shell's layout, recent colours, loop — kept
 * between tabs and sessions.
 *
 * The page's own storage by default. A host whose pages share no storage installs a store that
 * keeps them on its side: VS Code gives every webview an origin of its own, so `localStorage`
 * there lasted only as long as one tab.
 */
export interface UiPreferenceStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

const browserPreferences: UiPreferenceStore = {
  get(key) {
    try {
      const text = globalThis.localStorage?.getItem(`modkit.${key}`)
      return text === null || text === undefined ? undefined : (JSON.parse(text) as unknown)
    } catch {
      return undefined
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(`modkit.${key}`, JSON.stringify(value))
    } catch {
      // a page without storage keeps the choice until it closes
    }
  },
}

let preferences: UiPreferenceStore = browserPreferences

/** Where preferences are kept, set once by a host before it mounts viewers. */
export function setUiPreferenceStore(store: UiPreferenceStore): void {
  preferences = store
}

export function uiPreference(key: string): unknown {
  return preferences.get(key)
}

export function rememberUiPreference(key: string, value: unknown): void {
  preferences.set(key, value)
}
