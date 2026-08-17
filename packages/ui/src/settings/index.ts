/**
 * Settings surface — VS Code's shape: groups on the left, editors on the right.
 *
 * Declarative, so a host adds a group by adding data rather than UI code. The component reads and
 * writes a `SettingsStore`, which is the only part a host implements: a JSON file in Electron and
 * the CLI, storage in the browser, workspace configuration in VS Code.
 *
 * Extension entries are edited here as identity + location + enabled, which is exactly the portable
 * shape `SettingsDocument` persists. A host that cannot load from arbitrary paths still round-trips
 * the same file — it just refuses to activate what it cannot reach, and says so.
 */
import { element, setPart, setState, safeViewerText } from '../viewer/index.js'
import {
  DEFAULT_SETTINGS,
  type ExtensionSetting,
  type SettingsDocument,
  type SettingsStore,
} from './model.js'

export interface ThemeChoice {
  readonly id: string
  readonly label: string
}

export interface SettingsUiOptions {
  readonly store: SettingsStore
  /** Themes this host ships. Empty disables the appearance group's theme picker. */
  readonly themes: readonly ThemeChoice[]
  /** Applied whenever appearance changes, so the preview is live rather than on restart. */
  onAppearance?(appearance: SettingsDocument['appearance']): void
  /** Called after any successful write. Hosts use it to reload extensions. */
  onChange?(document: SettingsDocument): void
  /**
   * Let the user pick an extension folder with a native/browser picker. Absent means the host can
   * only accept a typed path — which is still enough to edit the same settings file.
   */
  browseForExtension?(): Promise<{ readonly id: string; readonly path: string } | undefined>
}

export interface SettingsUi {
  readonly root: HTMLElement
  reload(): Promise<void>
  destroy(): void
}

interface Group {
  readonly id: string
  readonly label: string
  render(host: HTMLElement): void
}

export function createSettingsUi(document: Document, options: SettingsUiOptions): SettingsUi {
  const root = document.createElement('div')
  root.className = 'modkit-viewer modkit-settings'
  setPart(root, 'settings')

  const groupList = element(root, 'nav', { part: 'settings.groups' })
  groupList.setAttribute('aria-label', 'Settings groups')
  const pane = element(root, 'div', { part: 'settings.pane' })
  const status = element(root, 'output', { part: 'settings.status' })

  let current: SettingsDocument = DEFAULT_SETTINGS
  let activeGroup = 'appearance'

  const say = (message: string, bad = false): void => {
    status.textContent = message
    setState(status, bad ? ['error'] : [])
  }

  const persist = async (next: SettingsDocument): Promise<void> => {
    try {
      await options.store.write(next)
      current = next
      options.onChange?.(next)
      say(`Saved to ${options.store.location}`)
    } catch (error) {
      say(`Could not save: ${error instanceof Error ? error.message : String(error)}`, true)
    }
  }

  // ------------------------------------------------------------------ rows
  const row = (host: HTMLElement, label: string, description: string): HTMLElement => {
    const wrapper = element(host, 'div', { part: 'settings.row' })
    element(wrapper, 'div', { part: 'settings.label', text: label })
    element(wrapper, 'div', { part: 'settings.description', text: description })
    return element(wrapper, 'div', { part: 'settings.control' })
  }

  // ------------------------------------------------------------------ appearance
  const appearanceGroup: Group = {
    id: 'appearance',
    label: 'Appearance',
    render(host) {
      if (options.themes.length > 0) {
        const control = row(host, 'Color theme', 'Applies immediately and to every viewer surface.')
        const select = element(control, 'select', { part: 'settings.select' }) as HTMLSelectElement
        select.setAttribute('aria-label', 'Color theme')
        for (const theme of options.themes) {
          const option = document.createElement('option')
          option.value = theme.id
          option.textContent = theme.label
          select.append(option)
        }
        select.value = current.appearance.theme
        select.addEventListener('change', () => {
          const appearance = { ...current.appearance, theme: select.value }
          options.onAppearance?.(appearance)
          void persist({ ...current, appearance })
        })
      }

      const densityControl = row(
        host,
        'Density',
        'Compact matches VS Code list metrics; comfortable suits touch and larger displays.',
      )
      const density = element(densityControl, 'select', {
        part: 'settings.select',
      }) as HTMLSelectElement
      density.setAttribute('aria-label', 'Density')
      for (const value of ['compact', 'comfortable'] as const) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = value[0]?.toUpperCase() + value.slice(1)
        density.append(option)
      }
      density.value = current.appearance.density
      density.addEventListener('change', () => {
        const appearance = {
          ...current.appearance,
          density: density.value as SettingsDocument['appearance']['density'],
        }
        options.onAppearance?.(appearance)
        void persist({ ...current, appearance })
      })
    },
  }

  // ------------------------------------------------------------------ extensions
  const extensionsGroup: Group = {
    id: 'extensions',
    label: 'Extensions',
    render(host) {
      const intro = element(host, 'p', { part: 'settings.description' })
      intro.textContent =
        `Extensions are listed in ${options.store.location}. Each entry is an id, a path the host ` +
        'loads from, and whether it is enabled. The same file is read by the desktop app, the web ' +
        'app and a headless run.'

      const list = element(host, 'div', { part: 'settings.list' })

      const draw = (): void => {
        list.replaceChildren()
        if (current.extensions.length === 0) {
          element(list, 'p', {
            part: 'settings.description',
            text: 'No extensions are configured yet.',
          })
        }
        for (const entry of current.extensions) {
          const item = element(list, 'div', { part: 'settings.extension' })
          const toggle = element(item, 'input', {
            part: 'settings.toggle',
          }) as HTMLInputElement
          toggle.type = 'checkbox'
          toggle.checked = entry.enabled
          toggle.setAttribute('aria-label', `Enable ${entry.id}`)
          toggle.addEventListener('change', () => {
            void persist({
              ...current,
              extensions: current.extensions.map(other =>
                other.id === entry.id ? { ...other, enabled: toggle.checked } : other,
              ),
            }).then(draw)
          })

          const text = element(item, 'div', { part: 'settings.extension-text' })
          element(text, 'div', { part: 'settings.label', text: safeViewerText(entry.id, 200) })
          element(text, 'div', {
            part: 'settings.description',
            text: safeViewerText(entry.path, 400),
          })

          const remove = element(item, 'button', {
            part: 'settings.remove',
            text: 'Remove',
          }) as HTMLButtonElement
          remove.type = 'button'
          remove.addEventListener('click', () => {
            void persist({
              ...current,
              extensions: current.extensions.filter(other => other.id !== entry.id),
            }).then(draw)
          })
        }
      }
      draw()

      // ---- add by path
      const adder = element(host, 'div', { part: 'settings.adder' })
      const id = element(adder, 'input', { part: 'settings.input' }) as HTMLInputElement
      id.placeholder = 'publisher/name'
      id.setAttribute('aria-label', 'Extension id')
      const path = element(adder, 'input', { part: 'settings.input' }) as HTMLInputElement
      path.placeholder = 'path, package or URL'
      path.setAttribute('aria-label', 'Extension location')

      const add = (entry: ExtensionSetting): void => {
        void persist({
          ...current,
          extensions: [...current.extensions.filter(other => other.id !== entry.id), entry],
        }).then(draw)
      }

      const addButton = element(adder, 'button', {
        part: 'settings.add',
        text: 'Add',
      }) as HTMLButtonElement
      addButton.type = 'button'
      addButton.addEventListener('click', () => {
        const entryId = id.value.trim()
        const entryPath = path.value.trim()
        if (entryId === '' || entryPath === '') {
          say('An extension needs both an id and a location.', true)
          return
        }
        add({ id: entryId, path: entryPath, enabled: true })
        id.value = ''
        path.value = ''
      })

      if (options.browseForExtension !== undefined) {
        const browse = element(adder, 'button', {
          part: 'settings.add',
          text: 'Browse…',
        }) as HTMLButtonElement
        browse.type = 'button'
        browse.addEventListener('click', () => {
          void (async () => {
            const picked = await options.browseForExtension?.()
            if (picked !== undefined) add({ ...picked, enabled: true })
          })()
        })
      }
    },
  }

  const groups: readonly Group[] = [appearanceGroup, extensionsGroup]

  const showGroup = (group: Group): void => {
    activeGroup = group.id
    pane.replaceChildren()
    for (const node of groupList.querySelectorAll('[data-mk-part="settings.group"]')) {
      const selected = node.getAttribute('data-group') === group.id
      node.setAttribute('aria-selected', String(selected))
      setState(node, selected ? ['selected'] : [])
    }
    group.render(pane)
  }

  for (const group of groups) {
    const button = element(groupList, 'button', {
      part: 'settings.group',
      text: group.label,
    }) as HTMLButtonElement
    button.type = 'button'
    button.dataset['group'] = group.id
    button.setAttribute('role', 'tab')
    button.addEventListener('click', () => {
      showGroup(group)
    })
  }

  const ui: SettingsUi = {
    root,

    async reload() {
      const { document: loaded, problems } = await options.store.read()
      current = loaded
      options.onAppearance?.(loaded.appearance)
      const group = groups.find(item => item.id === activeGroup) ?? groups[0]
      if (group !== undefined) showGroup(group)
      say(
        problems.length === 0
          ? `Loaded from ${options.store.location}`
          : `Loaded with ${problems.length} problem(s): ${problems.join('; ')}`,
        problems.length > 0,
      )
    },

    destroy() {
      root.remove()
    },
  }

  return ui
}

export {
  createMemorySettingsStore,
  DEFAULT_SETTINGS,
  enabledExtensions,
  normalizeSettings,
  serializeSettings,
  SETTINGS_SCHEMA_VERSION,
  type AppearanceSettings,
  type Density,
  type ExtensionSetting,
  type NormalizedSettings,
  type SettingsDocument,
  type SettingsStore,
} from './model.js'
