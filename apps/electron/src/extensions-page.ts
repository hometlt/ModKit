/**
 * Electron's Extensions & Codecs settings groups — where a user connects a third-party extension
 * and switches individual codecs off.
 *
 * Everything it draws needs an answer the portable settings component cannot have: what the host
 * made of the folder the user named. Main answers that over `modkitExtensions`; these groups plug
 * the answer into `createSettingsUi(extraGroups)` without creating a second settings shell.
 *
 * It stamps the `settings.*` part vocabulary — the same grid, rows, list and status the shared
 * page uses — so a theme that styles the settings surface styles this one too, and the user cannot
 * tell that two components drew it.
 *
 * Nothing here has filesystem access. The folder dialog, the probe, the settings write and the
 * recomposition all happen in main; this file holds the document, the switches and the words.
 */
import {
  element,
  safeViewerText,
  setState,
  type SettingsDocument,
  type SettingsStore,
  type SettingsUiGroup,
  type SettingsUiGroupContext,
} from '@modkitx-x3/ui'

// ---------------------------------------------------------------------------------------------
// what main reports

/** One entry of the settings document, joined with what the loader made of it. */
export interface ExtensionEntryReport {
  /** Coordinate the settings file records. Absent only for a hand-edited entry with no id. */
  readonly id?: string
  /** Location as written in the settings file. */
  readonly path: string
  /** The same location, resolved by main — the identity a failure is keyed by. */
  readonly root: string
  readonly enabled: boolean
  /**
   * `loaded` — the inventory holds it; `disabled` — the user switched it off, so it was never
   * offered to the loader; `failed` — the loader refused it and `code`/`message` say why;
   * `absent` — enabled and not refused, yet not in the inventory either (a settings id that no
   * longer matches the directory, say). Every one of the four is shown, none is hidden.
   */
  readonly state: 'loaded' | 'disabled' | 'failed' | 'absent'
  readonly code?: string
  readonly message?: string
}

export interface ExtensionRootFailureReport {
  readonly root: string
  readonly code: string
  readonly message: string
}

/** One contribution of the inventory, with the switch it is currently in. */
export interface ContributionReport {
  readonly id?: string
  readonly displayName: string
  readonly contract?: string
  readonly contractMajor?: number
  readonly extension: string
  readonly origin: string
  readonly activationEligible: boolean
  readonly disabled: boolean
  readonly path: string
}

export interface ExtensionsReport {
  /** Where the settings document lives, for display. */
  readonly location: string
  /** The settings file could not be read at all; the composition ran without it. */
  readonly problem?: string
  readonly bundled: readonly string[]
  readonly installed: readonly string[]
  readonly entries: readonly ExtensionEntryReport[]
  /** Roots that failed and are not in the settings list — a broken directory of this build. */
  readonly unconfiguredFailures: readonly ExtensionRootFailureReport[]
  readonly contributions: readonly ContributionReport[]
  readonly disabledContributions: readonly string[]
  readonly supportedExtensions: readonly string[]
}

/** What the native folder dialog plus main's probe answered. */
export type BrowseResult =
  | { readonly canceled: true }
  | {
      readonly canceled: false
      readonly state: 'extension'
      readonly root: string
      readonly id: string
    }
  | {
      readonly canceled: false
      readonly state: 'refused'
      readonly root: string
      readonly code: string
      readonly message: string
    }
  | {
      readonly canceled: false
      readonly state: 'already-configured'
      readonly root: string
      readonly id?: string
    }

// ---------------------------------------------------------------------------------------------
// the page

export interface ExtensionsSettingsGroupsOptions {
  /** The very same portable document the shared settings page edits. */
  readonly store: SettingsStore
  /** What the running composition holds right now. */
  report(): Promise<ExtensionsReport>
  /** Native directory dialog in main, followed by a probe of the directory. */
  browse(): Promise<BrowseResult>
  /**
   * Make the settings document true of the running application: main recomposes and the shell
   * reopens whatever tabs were open. Resolves with the report of the *new* composition.
   *
   * This is what lets the page promise "applies immediately" and mean it. A host that could not
   * offer it would have to say "restart to apply" in the same sentence the switch is drawn in.
   */
  apply(): Promise<ExtensionsReport>
}

export interface ExtensionsSettingsGroups {
  readonly groups: readonly SettingsUiGroup[]
}

const CONTRACT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'org.modkitx/codec-contribution': 'codec',
  'org.modkitx/viewer-contribution': 'viewer',
  'org.modkitx/editor-contribution': 'editor',
  'org.modkitx/service-provider-contribution': 'service provider',
  'org.modkitx/contract-definition': 'contract definition',
  'org.modkitx/trait-definition': 'trait definition',
})

/** «codec» for the contracts a user recognises, the contract id itself for anything else. */
function contractLabel(contribution: ContributionReport): string {
  if (contribution.contract === undefined) return 'unreadable manifest'
  return CONTRACT_LABELS[contribution.contract] ?? contribution.contract
}

export function createExtensionsSettingsGroups(
  options: ExtensionsSettingsGroupsOptions,
): ExtensionsSettingsGroups {
  let report: ExtensionsReport | undefined
  let groupContext: SettingsUiGroupContext | undefined
  /** Busy while main recomposes: a second toggle mid-flight would compose against stale bytes. */
  let busy = false
  /**
   * Folders the user picked that were not extensions, kept for the life of this window.
   *
   * They are deliberately *not* written to the settings file: the document keys an extension by
   * identity, and a directory that declares none has no identity to key it by — writing one under
   * a made-up id would put a permanent lie in a file other hosts read. But a folder that simply
   * vanished after the user chose it would be the worst possible answer, so the refusal stays on
   * the page, with the loader's own code and message, until the user dismisses it. Leaving the
   * page and coming back does not clear it; only closing the application does, by which time the
   * folder was never connected and there is nothing left to explain.
   */
  const refusals: { root: string; code: string; message: string }[] = []

  const say = (message: string, bad = false): void => {
    groupContext?.report(safeViewerText(message, 600), bad)
  }

  const draw = (): void => groupContext?.refresh()

  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  const summarise = (value: ExtensionsReport): string => {
    const loaded = value.bundled.length + value.installed.length
    const off = value.contributions.filter(item => item.disabled).length
    return (
      `${loaded} extension(s) loaded, ${value.contributions.length} contribution(s), ` +
      `${off} switched off, ${value.supportedExtensions.length} detectable type(s).`
    )
  }

  /**
   * Read the document, change it, write it, and make the running application match it.
   *
   * One action, under one `busy` flag held from before the read until after the recomposition.
   * Splitting it would leave a window in which two toggles both read the same document and the
   * second write erased the first — and re-reading rather than trusting a cached copy is what
   * keeps a change made on the shared Settings page from being clobbered here.
   *
   * The write and the recomposition are one action for the same reason: a settings file that says
   * a codec is off while the host still runs it is exactly the "toggle that silently does nothing"
   * this page exists to avoid, so nothing is reported as applied until it is.
   */
  const mutate = async (
    what: string,
    change: (document: SettingsDocument) => SettingsDocument,
  ): Promise<void> => {
    if (busy) return
    busy = true
    say(`${what}: saving and recomposing…`)
    draw()
    try {
      await options.store.write(change((await options.store.read()).document))
      report = await options.apply()
      say(`${what}: applied. ${summarise(report)}`)
    } catch (error) {
      say(`${what} failed: ${describe(error)}`, true)
    } finally {
      busy = false
      draw()
    }
  }

  // ------------------------------------------------------------------ extensions group
  const addFolder = (): void => {
    void (async () => {
      if (busy) return
      let picked: BrowseResult
      try {
        picked = await options.browse()
      } catch (error) {
        say(`The folder dialog failed: ${describe(error)}`, true)
        return
      }
      if (picked.canceled) {
        say('No folder was chosen.')
        return
      }
      if (picked.state === 'already-configured') {
        say(`${picked.root} is already in the list.`)
        return
      }
      if (picked.state === 'refused') {
        // Verbatim, and it stays on the page: "that folder is not an extension, here is the
        // loader's reason" is the whole answer a user who picked the wrong directory needs.
        refusals.unshift({ root: picked.root, code: picked.code, message: picked.message })
        say(`${picked.root} was not added — ${picked.code}: ${picked.message}`, true)
        draw()
        return
      }
      const entry = { id: picked.id, path: picked.root, enabled: true }
      await mutate(`Adding ${picked.id}`, document => ({
        ...document,
        extensions: [...document.extensions.filter(other => other.id !== entry.id), entry],
      }))
    })()
  }

  const renderExtensions = (host: HTMLElement): void => {
    const value = report
    element(host, 'p', {
      part: 'settings.description',
      text:
        `Extensions are recorded in ${options.store.location}. Connect a folder and this build ` +
        'loads it as an installed artifact — never inside the main process, always in the worker ' +
        'realm the bundled codecs run in.',
    })
    element(host, 'p', {
      part: 'settings.description',
      text:
        'Changes here apply immediately: the app recomposes its host and reopens the files you ' +
        'had open. Nothing waits for a restart.',
    })
    if (value?.problem !== undefined) {
      const problem = element(host, 'p', {
        part: 'settings.description',
        text: `The settings file could not be read: ${value.problem}`,
      })
      setState(problem, ['error'])
    }

    const actions = element(host, 'div', { part: 'settings.adder' })
    const add = element(actions, 'button', {
      part: 'settings.add',
      text: 'Add extension folder…',
    }) as HTMLButtonElement
    add.type = 'button'
    add.dataset['action'] = 'add-folder'
    add.disabled = busy
    add.addEventListener('click', addFolder)

    // ---- what the user connected
    element(host, 'div', { part: 'settings.label', text: 'Connected extensions' })
    const list = element(host, 'div', { part: 'settings.list' })
    const entries = value?.entries ?? []
    if (entries.length === 0) {
      element(list, 'p', {
        part: 'settings.description',
        text: 'None yet. Everything below ships with this build.',
      })
    }
    for (const entry of entries) {
      const item = element(list, 'div', { part: 'settings.extension' })
      if (entry.state === 'failed') setState(item, ['error'])
      const toggle = element(item, 'input', { part: 'settings.toggle' }) as HTMLInputElement
      toggle.type = 'checkbox'
      toggle.checked = entry.enabled
      toggle.disabled = busy || entry.id === undefined
      toggle.dataset['extension'] = entry.id ?? entry.path
      toggle.setAttribute('aria-label', `Enable ${entry.id ?? entry.path}`)
      toggle.addEventListener('change', () => {
        const wanted = toggle.checked
        const key = entry.id
        if (key === undefined) return
        void mutate(`${wanted ? 'Enabling' : 'Disabling'} ${key}`, document => ({
          ...document,
          extensions: document.extensions.map(other =>
            other.id === key ? { ...other, enabled: wanted } : other,
          ),
        }))
      })

      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', {
        part: 'settings.label',
        text: safeViewerText(entry.id ?? '(no id in the settings file)', 200),
      })
      element(text, 'div', { part: 'settings.description', text: safeViewerText(entry.path, 400) })
      element(text, 'div', {
        part: 'settings.description',
        // The loader's own words. A paraphrase here would send the user looking for the wrong bug.
        text:
          entry.state === 'loaded'
            ? 'loaded — its contributions are in the list of codecs'
            : entry.state === 'disabled'
              ? 'switched off — this folder is not offered to the loader at all'
              : entry.state === 'failed'
                ? `not loaded — ${entry.code ?? ''}: ${entry.message ?? ''}`
                : 'enabled, but the composition did not report it under this id',
      })

      const remove = element(item, 'button', {
        part: 'settings.remove',
        text: 'Remove',
      }) as HTMLButtonElement
      remove.type = 'button'
      remove.disabled = busy
      remove.addEventListener('click', () => {
        void mutate(`Removing ${entry.id ?? entry.path}`, document => ({
          ...document,
          extensions: document.extensions.filter(other =>
            entry.id === undefined ? other.path !== entry.path : other.id !== entry.id,
          ),
        }))
      })
    }

    // ---- folders the user picked that were not extensions
    if (refusals.length > 0) {
      element(host, 'div', { part: 'settings.label', text: 'Not added' })
      const refused = element(host, 'div', { part: 'settings.list' })
      for (const item of refusals) {
        const row = element(refused, 'div', { part: 'settings.extension' })
        setState(row, ['error'])
        const text = element(row, 'div', { part: 'settings.extension-text' })
        element(text, 'div', { part: 'settings.label', text: safeViewerText(item.root, 400) })
        element(text, 'div', {
          part: 'settings.description',
          text: `${item.code}: ${item.message}`,
        })
        const dismiss = element(row, 'button', {
          part: 'settings.remove',
          text: 'Dismiss',
        }) as HTMLButtonElement
        dismiss.type = 'button'
        dismiss.addEventListener('click', () => {
          const index = refusals.indexOf(item)
          if (index >= 0) refusals.splice(index, 1)
          draw()
        })
      }
    }

    // ---- roots that failed and are not in the settings list
    const orphans = value?.unconfiguredFailures ?? []
    if (orphans.length > 0) {
      element(host, 'div', { part: 'settings.label', text: 'Shipped, but not loaded' })
      const failed = element(host, 'div', { part: 'settings.list' })
      for (const item of orphans) {
        const row = element(failed, 'div', { part: 'settings.extension' })
        setState(row, ['error'])
        const text = element(row, 'div', { part: 'settings.extension-text' })
        element(text, 'div', { part: 'settings.label', text: safeViewerText(item.root, 400) })
        element(text, 'div', {
          part: 'settings.description',
          text: `${item.code}: ${item.message}`,
        })
      }
    }

    // ---- what shipped with the build
    element(host, 'div', { part: 'settings.label', text: 'Bundled with this build' })
    const bundled = element(host, 'div', { part: 'settings.list' })
    for (const coordinate of value?.bundled ?? []) {
      const item = element(bundled, 'div', { part: 'settings.extension' })
      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', { part: 'settings.label', text: safeViewerText(coordinate, 200) })
      element(text, 'div', {
        part: 'settings.description',
        // Whole bundled extensions are not removable here; their individual codecs are, next door.
        text: 'ships with the application — switch its individual codecs off under Codecs',
      })
    }
  }

  // ------------------------------------------------------------------ codecs group
  const renderCodecs = (host: HTMLElement): void => {
    const value = report
    element(host, 'p', {
      part: 'settings.description',
      text:
        'Every contribution the host inventoried, whichever extension ships it. Switching one off ' +
        'keeps the record — it stays listed here, and the host refuses to activate it — so a file ' +
        'that only that codec could read opens as raw bytes instead, and the inspector says why.',
    })
    element(host, 'p', {
      part: 'settings.description',
      text:
        'Changes apply immediately: the app recomposes and reopens the files you had open. The ' +
        'reason a disabled codec gives is the diagnostic x3.host/contribution-disabled.',
    })

    const contributions = value?.contributions ?? []
    if (contributions.length === 0) {
      element(host, 'p', {
        part: 'settings.description',
        text: 'No contributions are loaded, so there is nothing to switch.',
      })
      return
    }

    const owners = [...new Set(contributions.map(item => item.extension))]
    for (const owner of owners) {
      const owned = contributions.filter(item => item.extension === owner)
      const off = owned.filter(item => item.disabled).length
      element(host, 'div', {
        part: 'settings.label',
        text: `${owner} — ${owned.length} contribution(s)${off === 0 ? '' : `, ${off} off`}`,
      })
      const list = element(host, 'div', { part: 'settings.list' })
      for (const contribution of owned) {
        const item = element(list, 'div', { part: 'settings.extension' })
        if (contribution.disabled) setState(item, ['error'])
        const id = contribution.id
        if (id === undefined) {
          // No id means the envelope did not parse: it is inspectable, never activatable, and
          // there is nothing for a switch to name.
          element(item, 'div', { part: 'settings.description', text: 'no id' })
        } else {
          const toggle = element(item, 'input', { part: 'settings.toggle' }) as HTMLInputElement
          toggle.type = 'checkbox'
          toggle.checked = !contribution.disabled
          toggle.disabled = busy
          toggle.dataset['contribution'] = id
          toggle.setAttribute('aria-label', `Enable ${id}`)
          toggle.addEventListener('change', () => {
            const wanted = toggle.checked
            void mutate(`${wanted ? 'Enabling' : 'Disabling'} ${id}`, document => ({
              ...document,
              disabledContributions: wanted
                ? document.disabledContributions.filter(other => other !== id)
                : [...document.disabledContributions, id],
            }))
          })
        }

        const text = element(item, 'div', { part: 'settings.extension-text' })
        element(text, 'div', {
          part: 'settings.label',
          text: safeViewerText(contribution.displayName, 200),
        })
        element(text, 'div', {
          part: 'settings.description',
          text: `${safeViewerText(id ?? contribution.path, 200)} · ${contractLabel(contribution)}`,
        })
        element(text, 'div', {
          part: 'settings.description',
          text: contribution.disabled
            ? 'switched off — the host will not activate it'
            : contribution.activationEligible
              ? `active · ${contribution.origin}`
              : `inventoried, not activatable · ${contribution.origin}`,
        })
      }
    }
  }

  const extensionsGroup: SettingsUiGroup = {
    id: 'extensions',
    label: 'Extensions',
    render(host, context) {
      groupContext = context
      renderExtensions(host)
    },
    async reload(context) {
      groupContext = context
      try {
        report = await options.report()
        say(summarise(report))
      } catch (error) {
        say(`Could not read the extension state: ${describe(error)}`, true)
      }
      draw()
    },
  }

  const codecsGroup: SettingsUiGroup = {
    id: 'codecs',
    label: 'Codecs',
    render(host, context) {
      groupContext = context
      renderCodecs(host)
    },
  }

  return {
    groups: [extensionsGroup, codecsGroup],
  }
}
