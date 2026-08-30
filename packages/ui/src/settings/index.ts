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
import { type UiLocalizer } from '../localization/index.js'
import { SETTINGS_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export interface ThemeChoice {
  readonly id: string
  readonly label: string
}

export interface AppThemeChoice extends ThemeChoice {
  readonly stylesheet: string
}

export interface AppThemeDocumentLike {
  getElementById(id: string): { readonly textContent: string | null } | null
}

export const APP_THEME_DOM_ID = 'modkit-app-themes'

const APP_THEME_ID = /^[a-z][a-z0-9-]{0,63}$/u
const APP_THEME_STYLESHEET = /^\.\/(?:modkit-ui|theme-[a-z][a-z0-9-]{0,63})\.css$/u

/**
 * Read the exact static theme set emitted by an application build.
 *
 * The runtime has no product or game theme registry. A generic build script validates source
 * manifests, copies their stylesheets, and embeds this bounded JSON data in the host document.
 */
export function readAppThemeChoices(document: AppThemeDocumentLike): readonly AppThemeChoice[] {
  const node = document.getElementById(APP_THEME_DOM_ID)
  if (node?.textContent === null || node?.textContent === undefined) {
    throw new Error(`missing #${APP_THEME_DOM_ID} build data`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(node.textContent)
  } catch (error) {
    throw new Error(
      `invalid #${APP_THEME_DOM_ID} JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64) {
    throw new Error(`#${APP_THEME_DOM_ID} must contain between 1 and 64 themes`)
  }
  const ids = new Set<string>()
  return Object.freeze(
    parsed.map((value, index) => {
      const entry =
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : undefined
      const id = entry?.['id']
      const label = entry?.['label']
      const stylesheet = entry?.['stylesheet']
      if (typeof id !== 'string' || !APP_THEME_ID.test(id)) {
        throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid id`)
      }
      if (ids.has(id)) throw new Error(`#${APP_THEME_DOM_ID} contains duplicate theme id ${id}`)
      ids.add(id)
      if (
        typeof label !== 'string' ||
        label.trim() !== label ||
        label.length === 0 ||
        label.length > 80 ||
        /[\u0000-\u001f\u007f]/u.test(label)
      ) {
        throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid label`)
      }
      if (typeof stylesheet !== 'string' || !APP_THEME_STYLESHEET.test(stylesheet)) {
        throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid stylesheet`)
      }
      return Object.freeze({ id, label, stylesheet })
    }),
  )
}

/** Host-owned state exposed to a settings group without giving it ownership of the shell. */
export interface SettingsUiGroupContext {
  readonly settings: SettingsDocument
  report(message: string, bad?: boolean): void
  /** Redraw the currently selected group after its host-owned state changes. */
  refresh(): void
}

/**
 * A host-specific group rendered inside the portable settings surface.
 *
 * An extra group whose id matches a built-in group replaces that group in place. This lets a host
 * provide a richer implementation of (for example) `extensions` without drawing a second settings
 * page or changing where menus and shortcuts navigate.
 */
export interface SettingsUiGroup {
  readonly id: string
  readonly label: string
  render(host: HTMLElement, context: SettingsUiGroupContext): void
  /** Refresh host-owned state whenever the settings surface reloads. */
  reload?(context: SettingsUiGroupContext): void | Promise<void>
  destroy?(): void
}

export interface SettingsUiOptions {
  readonly localizer?: UiLocalizer
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
  /**
   * File types this host can preview right now, derived from the loaded codecs. The associations
   * group offers exactly these — a host must never advertise itself for a format it cannot open.
   */
  readonly associableTypes?: readonly string[]
  /** Register the app for the chosen extensions. Absent hides the group entirely. */
  registerFileTypes?(extensions: readonly string[]): Promise<string>
  /**
   * Why this host cannot change the extension list, when it cannot.
   *
   * A host that serves only what its build attested has no way to honour an Add or a Remove. With
   * this set the group still *shows* what is loaded — that is the useful half — but draws no
   * controls that would fail, and states the reason once. Without it the group is editable, which
   * is right for a host with an install path.
   */
  readonly extensionsReadOnly?: string
  /** Host-specific groups, or replacements for built-in groups with the same id. */
  readonly extraGroups?: readonly SettingsUiGroup[]
  /** Shown as a close affordance. Absent means the host closes the panel its own way. */
  onClose?(): void
}

export interface SettingsUi {
  readonly root: HTMLElement
  reload(): Promise<void>
  /** Select a group by id. Returns false when no such group exists. */
  showGroup(groupId: string): boolean
  destroy(): void
}

interface Group {
  readonly id: string
  readonly label: string
  render(host: HTMLElement, context: SettingsUiGroupContext): void
  reload?(context: SettingsUiGroupContext): void | Promise<void>
  destroy?(): void
}

export function createSettingsUi(document: Document, options: SettingsUiOptions): SettingsUi {
  const localizer = withEnglishUiFallback(options.localizer, SETTINGS_FALLBACK_MESSAGES)
  const root = document.createElement('div')
  root.className = 'modkit-viewer modkit-settings'
  setPart(root, 'settings')

  const groupList = element(root, 'nav', { part: 'settings.groups' })
  groupList.setAttribute('aria-label', localizer.text('settings.groups'))

  // A panel that can only be dismissed from a menu is a trap for anyone who opened it by accident.
  if (options.onClose !== undefined) {
    const close = element(groupList, 'button', {
      part: 'settings.close',
      text: localizer.text('settings.back'),
    }) as HTMLButtonElement
    close.type = 'button'
    close.title = localizer.text('settings.close')
    close.addEventListener('click', () => options.onClose?.())
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') options.onClose?.()
    })
    // Focusable so Escape reaches the handler without the user clicking first.
    root.tabIndex = -1
  }
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
      say(localizer.text('settings.savedTo', { location: options.store.location }))
    } catch (error) {
      say(
        localizer.text('settings.saveError', {
          reason: error instanceof Error ? error.message : String(error),
        }),
        true,
      )
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
    label: localizer.text('settings.appearance'),
    render(host) {
      if (options.themes.length > 0) {
        const control = row(
          host,
          localizer.text('settings.colorTheme'),
          localizer.text('settings.themeDescription'),
        )
        const select = element(control, 'select', { part: 'settings.select' }) as HTMLSelectElement
        select.setAttribute('aria-label', localizer.text('settings.colorTheme'))
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
        localizer.text('settings.density'),
        localizer.text('settings.densityDescription'),
      )
      const density = element(densityControl, 'select', {
        part: 'settings.select',
      }) as HTMLSelectElement
      density.setAttribute('aria-label', localizer.text('settings.density'))
      for (const value of ['compact', 'comfortable'] as const) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = localizer.text(
          value === 'compact' ? 'settings.compact' : 'settings.comfortable',
        )
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
    label: localizer.text('settings.extensions'),
    render(host) {
      const intro = element(host, 'p', { part: 'settings.description' })
      intro.textContent = localizer.text('settings.extensionsLocationIntro', {
        location: options.store.location,
      })

      const readOnly = options.extensionsReadOnly
      if (readOnly !== undefined) {
        element(host, 'p', {
          part: 'settings.description',
          text: safeViewerText(readOnly, 400),
        })
      }

      const list = element(host, 'div', { part: 'settings.list' })

      const draw = (): void => {
        list.replaceChildren()
        if (current.extensions.length === 0) {
          element(list, 'p', {
            part: 'settings.description',
            text: localizer.text('settings.noExtensions'),
          })
        }
        for (const entry of current.extensions) {
          const item = element(list, 'div', { part: 'settings.extension' })
          if (readOnly === undefined) {
            const toggle = element(item, 'input', {
              part: 'settings.toggle',
            }) as HTMLInputElement
            toggle.type = 'checkbox'
            toggle.checked = entry.enabled
            toggle.setAttribute(
              'aria-label',
              localizer.text('settings.enableExtension', { id: entry.id }),
            )
            toggle.addEventListener('change', () => {
              void persist({
                ...current,
                extensions: current.extensions.map(other =>
                  other.id === entry.id ? { ...other, enabled: toggle.checked } : other,
                ),
              }).then(draw)
            })
          } else {
            // `settings.description`, not a new part: the parts list is a contract themes
            // style against, and one read-only annotation does not earn an entry in it
            element(item, 'div', {
              part: 'settings.description',
              text: localizer.text(entry.enabled ? 'common.enabled' : 'common.disabled'),
            })
          }

          const text = element(item, 'div', { part: 'settings.extension-text' })
          element(text, 'div', { part: 'settings.label', text: safeViewerText(entry.id, 200) })
          element(text, 'div', {
            part: 'settings.description',
            text: safeViewerText(entry.path, 400),
          })

          if (readOnly === undefined) {
            const remove = element(item, 'button', {
              part: 'settings.remove',
              text: localizer.text('common.remove'),
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
      }
      draw()

      // ---- add by path
      if (readOnly !== undefined) return
      const adder = element(host, 'div', { part: 'settings.adder' })
      const id = element(adder, 'input', { part: 'settings.input' }) as HTMLInputElement
      id.placeholder = 'publisher/name'
      id.setAttribute('aria-label', localizer.text('settings.extensionId'))
      const path = element(adder, 'input', { part: 'settings.input' }) as HTMLInputElement
      path.placeholder = localizer.text('settings.extensionPathPlaceholder')
      path.setAttribute('aria-label', localizer.text('settings.extensionLocation'))

      const add = (entry: ExtensionSetting): void => {
        void persist({
          ...current,
          extensions: [...current.extensions.filter(other => other.id !== entry.id), entry],
        }).then(draw)
      }

      const addButton = element(adder, 'button', {
        part: 'settings.add',
        text: localizer.text('settings.add'),
      }) as HTMLButtonElement
      addButton.type = 'button'
      addButton.addEventListener('click', () => {
        const entryId = id.value.trim()
        const entryPath = path.value.trim()
        if (entryId === '' || entryPath === '') {
          say(localizer.text('settings.extensionRequired'), true)
          return
        }
        add({ id: entryId, path: entryPath, enabled: true })
        id.value = ''
        path.value = ''
      })

      if (options.browseForExtension !== undefined) {
        const browse = element(adder, 'button', {
          part: 'settings.add',
          text: localizer.text('settings.browse'),
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

  // ------------------------------------------------------------------ file associations
  // Bound once: the option is optional, and the group only exists when the host supplied it.
  const registerFileTypes = options.registerFileTypes

  const associationsGroup: Group = {
    id: 'associations',
    label: localizer.text('settings.fileAssociations'),
    render(host) {
      const types = [...(options.associableTypes ?? [])].sort()
      element(host, 'p', {
        part: 'settings.description',
        text: localizer.text('settings.associationsDescription'),
      })

      if (types.length === 0) {
        element(host, 'p', {
          part: 'settings.description',
          text: localizer.text('settings.noCodecs'),
        })
        return
      }

      const chosen = new Set(types)
      const list = element(host, 'div', { part: 'settings.list' })
      for (const type of types) {
        const item = element(list, 'div', { part: 'settings.extension' })
        const toggle = element(item, 'input', { part: 'settings.toggle' }) as HTMLInputElement
        toggle.type = 'checkbox'
        toggle.checked = true
        toggle.setAttribute('aria-label', localizer.text('settings.associate', { type }))
        toggle.addEventListener('change', () => {
          if (toggle.checked) chosen.add(type)
          else chosen.delete(type)
        })
        const text = element(item, 'div', { part: 'settings.extension-text' })
        element(text, 'div', { part: 'settings.label', text: `.${type}` })
      }

      const actions = element(host, 'div', { part: 'settings.adder' })
      const all = element(actions, 'button', {
        part: 'settings.add',
        text: localizer.text('settings.selectAll'),
      }) as HTMLButtonElement
      all.type = 'button'
      all.addEventListener('click', () => {
        for (const node of list.querySelectorAll('input')) {
          node.checked = true
          node.dispatchEvent(new Event('change'))
        }
      })

      const none = element(actions, 'button', {
        part: 'settings.add',
        text: localizer.text('settings.selectNone'),
      }) as HTMLButtonElement
      none.type = 'button'
      none.addEventListener('click', () => {
        for (const node of list.querySelectorAll('input')) {
          node.checked = false
          node.dispatchEvent(new Event('change'))
        }
      })

      const apply = element(actions, 'button', {
        part: 'settings.add',
        text: localizer.text('settings.defaultApp'),
      }) as HTMLButtonElement
      apply.type = 'button'
      apply.addEventListener('click', () => {
        void (async () => {
          if (chosen.size === 0) {
            say(localizer.text('settings.pickFileType'), true)
            return
          }
          try {
            apply.disabled = true
            say(
              (await registerFileTypes?.([...chosen])) ??
                localizer.text('settings.nothingToRegister'),
            )
          } catch (error) {
            say(
              localizer.text('settings.registerError', {
                reason: error instanceof Error ? error.message : String(error),
              }),
              true,
            )
          } finally {
            apply.disabled = false
          }
        })()
      })
    },
  }

  const extraGroups = options.extraGroups ?? []
  const extraIds = new Set<string>()
  for (const group of extraGroups) {
    if (group.id.trim() === '' || group.label.trim() === '') {
      throw new Error('settings extra groups require a non-empty id and label')
    }
    if (extraIds.has(group.id)) throw new Error(`duplicate settings group id: ${group.id}`)
    extraIds.add(group.id)
  }

  // New groups sit before file associations, while a matching id replaces a built-in at its
  // established position. Electron therefore gets Appearance · Extensions · Codecs · File
  // associations, with its host-aware Extensions implementation in the one expected place.
  const extrasById = new Map(extraGroups.map(group => [group.id, group] as const))
  const primaryGroups = [appearanceGroup, extensionsGroup].map(
    group => extrasById.get(group.id) ?? group,
  )
  const primaryIds = new Set(primaryGroups.map(group => group.id))
  const additionalGroups = extraGroups.filter(
    group =>
      !primaryIds.has(group.id) &&
      !(options.registerFileTypes !== undefined && group.id === associationsGroup.id),
  )
  const groups: readonly Group[] = [
    ...primaryGroups,
    ...additionalGroups,
    ...(options.registerFileTypes === undefined
      ? []
      : [extrasById.get(associationsGroup.id) ?? associationsGroup]),
  ]

  function showActiveGroup(): void {
    const group = groups.find(item => item.id === activeGroup) ?? groups[0]
    if (group !== undefined) showGroup(group)
  }
  const groupContext: SettingsUiGroupContext = {
    get settings() {
      return current
    },
    report: say,
    refresh() {
      showActiveGroup()
    },
  }

  const showGroup = (group: Group): void => {
    activeGroup = group.id
    pane.replaceChildren()
    for (const node of groupList.querySelectorAll('[data-mk-part="settings.group"]')) {
      const selected = node.getAttribute('data-group') === group.id
      node.setAttribute('aria-selected', String(selected))
      setState(node, selected ? ['selected'] : [])
    }
    group.render(pane, groupContext)
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
      say(
        problems.length === 0
          ? localizer.text('settings.loadedFrom', { location: options.store.location })
          : localizer.text('settings.loadedProblems', {
              count: problems.length,
              problems: problems.join('; '),
            }),
        problems.length > 0,
      )
      for (const group of groups) await group.reload?.(groupContext)
      showActiveGroup()
    },

    showGroup(groupId) {
      const group = groups.find(item => item.id === groupId)
      if (group === undefined) return false
      showGroup(group)
      return true
    },

    destroy() {
      for (const group of groups) group.destroy?.()
      root.remove()
    },
  }

  return ui
}

export {
  createMemorySettingsStore,
  DEFAULT_SETTINGS,
  enabledExtensions,
  GAME_INSTALLATION_PATH_LENGTH_LIMIT,
  GAME_INSTALLATION_PATH_LIMIT,
  normalizeSettings,
  RECENT_LIMIT,
  serializeSettings,
  SETTINGS_SCHEMA_VERSION,
  withRecent,
  type AppearanceSettings,
  type Density,
  type ExtensionSetting,
  type GameInstallationSetting,
  type NormalizedSettings,
  type RecentEntry,
  type SettingsDocument,
  type SettingsStore,
} from './model.js'
