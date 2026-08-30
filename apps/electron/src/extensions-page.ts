/**
 * Electron's Extensions & Contributions settings groups — where a user connects a third-party
 * extension and switches individual declared contributions off.
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
  createSubjectCard,
  element,
  loadSubjectCardSections,
  safeViewerText,
  setState,
  type CardRef,
  type SettingsDocument,
  type SettingsStore,
  type SettingsUiGroup,
  type SettingsUiGroupContext,
  type SubjectCard,
} from '@modkitx-x3/ui'
import {
  subjectFactsSourceFromWire,
  type ExtensionSubjectCardWireDocument,
  type ExtensionManagerClient,
  type ExtensionManagerEntry,
  type ExtensionManagerSnapshot,
} from '@modkitx/extension-manager'

export type { ExtensionManagerSnapshot } from '@modkitx/extension-manager'

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
  /** Owner extension is off; direct contribution preference remains visible and unchanged. */
  readonly extensionDisabled: boolean
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
  /** Inert generic subject-card documents projected from the validated main-process inventory. */
  readonly subjectCards: readonly ExtensionSubjectCardWireDocument[]
  readonly disabledExtensions: readonly string[]
  readonly disabledContributions: readonly string[]
  readonly supportedExtensions: readonly string[]
}

/** Common package-level entry; its artifact-store record may contain several extension roots. */
export type ManagedExtensionEntry = ExtensionManagerEntry

/** Electron's IPC bridge implements the shared app-level manager contract exactly. */
export type ElectronExtensionManagerPort = ExtensionManagerClient

export interface ExtensionManagerGroups {
  readonly available: readonly ManagedExtensionEntry[]
  readonly installed: readonly ManagedExtensionEntry[]
  readonly enabled: readonly ManagedExtensionEntry[]
  readonly updates: readonly ManagedExtensionEntry[]
  readonly problems: readonly string[]
}

/** Stable grouping shared by the page and focused tests; entries retain the manager's order. */
export function groupManagedExtensions(
  snapshot: ExtensionManagerSnapshot,
  problems: readonly string[] = Object.freeze([]),
): ExtensionManagerGroups {
  return Object.freeze({
    available: Object.freeze(
      snapshot.entries.filter(entry => entry.installedVersion === undefined),
    ),
    installed: Object.freeze(
      snapshot.entries.filter(entry => entry.installedVersion !== undefined),
    ),
    enabled: Object.freeze(
      snapshot.entries.filter(entry => entry.installedVersion !== undefined && entry.enabled),
    ),
    updates: Object.freeze(snapshot.entries.filter(entry => entry.updateAvailable)),
    problems: Object.freeze([...problems]),
  })
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
  /** Optional install/update lifecycle. Folder connections below remain available without it. */
  readonly manager?: ElectronExtensionManagerPort
}

export interface ExtensionsSettingsGroups {
  readonly groups: readonly SettingsUiGroup[]
}

export interface ContributionContractGroup {
  /** Exact declared contract coordinate. Absent only for an unreadable contribution envelope. */
  readonly key?: string
  readonly contributions: readonly ContributionReport[]
}

export function contributionContractKey(contribution: ContributionReport): string | undefined {
  return contribution.contract === undefined || contribution.contractMajor === undefined
    ? undefined
    : `${contribution.contract}@${contribution.contractMajor}`
}

/** Groups real contributions only by the exact `contract.id@major` stored in their manifest. */
export function groupContributionsByContract(
  contributions: readonly ContributionReport[],
): readonly ContributionContractGroup[] {
  const grouped = new Map<string | undefined, ContributionReport[]>()
  for (const contribution of contributions) {
    const key = contributionContractKey(contribution)
    const entries = grouped.get(key) ?? []
    entries.push(contribution)
    grouped.set(key, entries)
  }
  return Object.freeze(
    [...grouped.entries()]
      .sort(([left], [right]) => {
        if (left === undefined) return right === undefined ? 0 : 1
        if (right === undefined) return -1
        return left.localeCompare(right, 'en')
      })
      .map(([key, entries]) =>
        Object.freeze({
          ...(key === undefined ? {} : { key }),
          contributions: Object.freeze([...entries]),
        }),
      ),
  )
}

/** Changes only the already configured coordinate; renderer code never supplies a replacement root. */
export function withExtensionEnabled(
  document: SettingsDocument,
  id: string,
  enabled: boolean,
): SettingsDocument {
  return {
    ...document,
    disabledExtensions: enabled
      ? document.disabledExtensions.filter(other => other !== id)
      : [...new Set([...document.disabledExtensions, id])],
    // Keep the legacy per-root flag in sync; bundled extensions have no row and use only the set.
    extensions: document.extensions.map(entry => (entry.id === id ? { ...entry, enabled } : entry)),
  }
}

/** Keeps disabled contributions inventoried while changing their direct user preference. */
export function withContributionEnabled(
  document: SettingsDocument,
  id: string,
  enabled: boolean,
): SettingsDocument {
  return {
    ...document,
    disabledContributions: enabled
      ? document.disabledContributions.filter(other => other !== id)
      : [...new Set([...document.disabledContributions, id])],
  }
}

export function createExtensionsSettingsGroups(
  options: ExtensionsSettingsGroupsOptions,
): ExtensionsSettingsGroups {
  let report: ExtensionsReport | undefined
  let managerSnapshot: ExtensionManagerSnapshot | undefined
  const managerProblems: string[] = []
  let groupContext: SettingsUiGroupContext | undefined
  let selectedSubjectId: string | undefined
  let mountedCard: SubjectCard | undefined
  let cardLoadRevision = 0
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

  /** Run one explicit manager command, then safely recompose from manager state plus settings. */
  const manage = async (
    what: string,
    operation: () => Promise<void>,
    recompose = true,
  ): Promise<void> => {
    if (busy) return
    busy = true
    say(`${what}…`)
    draw()
    try {
      await operation()
      managerSnapshot = await options.manager?.snapshot()
      managerProblems.length = 0
      if (recompose) report = await options.apply()
      say(`${what}: complete${report === undefined ? '.' : `. ${summarise(report)}`}`)
    } catch (error) {
      const problem = `${what} failed: ${describe(error)}`
      managerProblems.unshift(problem)
      say(problem, true)
    } finally {
      busy = false
      draw()
    }
  }

  const subjectCards = (): readonly ExtensionSubjectCardWireDocument[] =>
    report?.subjectCards ?? Object.freeze([])

  const subjectCardFor = (
    kind: ExtensionSubjectCardWireDocument['subject']['kind'],
    id: string,
  ): ExtensionSubjectCardWireDocument | undefined =>
    subjectCards().find(document => document.subject.kind === kind && document.subject.id === id)

  const openSubjectCard = (
    kind: ExtensionSubjectCardWireDocument['subject']['kind'],
    id: string,
  ): void => {
    const document = subjectCardFor(kind, id)
    if (document === undefined) {
      say(`${id} has no loaded manifest card in the current composition.`, true)
      return
    }
    selectedSubjectId = document.subject.subjectId
    draw()
  }

  const makeSubjectLink = (
    node: HTMLElement,
    kind: ExtensionSubjectCardWireDocument['subject']['kind'],
    id: string,
  ): void => {
    if (subjectCardFor(kind, id) === undefined) return
    node.tabIndex = 0
    node.setAttribute('role', 'button')
    node.title = `Open ${id} subject card`
    node.dataset['subjectKind'] = kind
    node.dataset['subject'] = id
    node.addEventListener('click', () => openSubjectCard(kind, id))
    node.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      openSubjectCard(kind, id)
    })
  }

  const addEnablementIcon = (row: HTMLElement, enabled: boolean, label: string): HTMLElement => {
    const icon = element(row, 'span', {
      part: 'settings.description',
      text: enabled ? '●' : '○',
    })
    icon.dataset['enablement'] = enabled ? 'enabled' : 'disabled'
    icon.setAttribute('role', 'img')
    icon.setAttribute('aria-label', `${label} ${enabled ? 'enabled' : 'disabled'}`)
    return icon
  }

  const mutateContribution = (id: string, enabled: boolean): void => {
    void mutate(`${enabled ? 'Enabling' : 'Disabling'} ${id}`, document =>
      withContributionEnabled(document, id, enabled),
    )
  }

  /**
   * Draws the selected subject using the shared generic SubjectCard. The surrounding controls are
   * host actions, not a second card implementation; every fact and relation still comes from the
   * presentation-neutral SubjectFactsSource reconstructed from the inert IPC document.
   */
  const renderSelectedSubject = (host: HTMLElement): boolean => {
    mountedCard?.destroy()
    mountedCard = undefined
    cardLoadRevision += 1
    const subjectId = selectedSubjectId
    if (subjectId === undefined) return false
    const wire = subjectCards().find(document => document.subject.subjectId === subjectId)
    if (wire === undefined) {
      selectedSubjectId = undefined
      return false
    }

    const actions = element(host, 'div', { part: 'settings.adder' })
    addEnablementIcon(
      actions,
      wire.subject.kind === 'org.modkitx/contribution'
        ? wire.subject.effectiveEnabled === true
        : wire.subject.enabled,
      wire.subject.displayName,
    )
    const back = element(actions, 'button', {
      part: 'settings.add',
      text: 'Back to extensions',
    }) as HTMLButtonElement
    back.type = 'button'
    back.dataset['action'] = 'close-subject-card'
    back.addEventListener('click', () => {
      selectedSubjectId = undefined
      draw()
    })

    if (wire.subject.kind === 'org.modkitx/contribution') {
      const toggle = element(actions, 'button', {
        part: 'settings.add',
        text: wire.subject.enabled ? 'Disable contribution' : 'Enable contribution',
      }) as HTMLButtonElement
      toggle.type = 'button'
      toggle.disabled = busy
      toggle.dataset['action'] = wire.subject.enabled
        ? 'disable-contribution'
        : 'enable-contribution'
      toggle.addEventListener('click', () =>
        mutateContribution(wire.subject.id, !wire.subject.enabled),
      )
    } else {
      const toggle = element(actions, 'button', {
        part: 'settings.add',
        text: wire.subject.enabled ? 'Disable extension' : 'Enable extension',
      }) as HTMLButtonElement
      toggle.type = 'button'
      toggle.disabled = busy
      toggle.dataset['action'] = wire.subject.enabled ? 'disable-extension' : 'enable-extension'
      toggle.addEventListener('click', () => {
        void mutate(
          `${wire.subject.enabled ? 'Disabling' : 'Enabling'} ${wire.subject.id}`,
          document => withExtensionEnabled(document, wire.subject.id, !wire.subject.enabled),
        )
      })
    }

    const cardHost = element(host, 'div', { part: 'settings.list' })
    cardHost.dataset['subjectId'] = wire.subject.subjectId
    element(cardHost, 'p', { part: 'settings.description', text: 'Loading subject card…' })
    const revision = cardLoadRevision
    void (async () => {
      try {
        const sections = await loadSubjectCardSections(subjectFactsSourceFromWire(wire))
        if (revision !== cardLoadRevision || selectedSubjectId !== wire.subject.subjectId) return
        const card = createSubjectCard(cardHost.ownerDocument, {
          label: `${wire.subject.displayName} subject card`,
          sections,
          onNavigate(reference: CardRef) {
            if (
              reference.href === undefined ||
              !subjectCards().some(document => document.subject.subjectId === reference.href)
            ) {
              return
            }
            selectedSubjectId = reference.href
            draw()
          },
        })
        mountedCard = card
        cardHost.replaceChildren(card.root)
      } catch (error) {
        if (revision !== cardLoadRevision) return
        cardHost.replaceChildren()
        const problem = element(cardHost, 'p', {
          part: 'settings.description',
          text: `Could not render this subject card: ${describe(error)}`,
        })
        setState(problem, ['error'])
      }
    })()
    return true
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
    if (renderSelectedSubject(host)) return
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

    const manager = options.manager
    if (manager !== undefined) {
      const managed = groupManagedExtensions(
        managerSnapshot ?? { entries: Object.freeze([]) },
        managerProblems,
      )
      const managerActions = element(host, 'div', { part: 'settings.adder' })
      const refresh = element(managerActions, 'button', {
        part: 'settings.add',
        text: 'Refresh extension catalog',
      }) as HTMLButtonElement
      refresh.type = 'button'
      refresh.dataset['action'] = 'refresh-catalog'
      refresh.disabled = busy
      refresh.addEventListener('click', () => {
        void manage('Refreshing extension catalog', () => manager.refresh(), false)
      })

      const renderManagedRows = (
        label: string,
        entries: readonly ManagedExtensionEntry[],
        action: (entry: ManagedExtensionEntry, row: HTMLElement) => void,
        empty: string,
      ): void => {
        element(host, 'div', { part: 'settings.label', text: label })
        const list = element(host, 'div', { part: 'settings.list' })
        if (entries.length === 0) {
          element(list, 'p', { part: 'settings.description', text: empty })
          return
        }
        for (const entry of entries) {
          const row = element(list, 'div', { part: 'settings.extension' })
          if (!entry.trusted) setState(row, ['error'])
          if (entry.installedVersion !== undefined) {
            addEnablementIcon(row, entry.enabled, entry.displayName)
          }
          const text = element(row, 'div', { part: 'settings.extension-text' })
          element(text, 'div', {
            part: 'settings.label',
            text: safeViewerText(entry.displayName, 200),
          })
          element(text, 'div', {
            part: 'settings.description',
            text:
              `${safeViewerText(entry.id, 200)} · ` +
              `${entry.installedVersion ?? 'not installed'} → ${entry.availableVersion} · ` +
              `${entry.trusted ? 'trusted source' : 'untrusted remote source'}`,
          })
          makeSubjectLink(text, 'org.modkitx/extension', entry.id)
          action(entry, row)
        }
      }

      const button = (row: HTMLElement, label: string, action: string, run: () => void): void => {
        const control = element(row, 'button', {
          part: 'settings.remove',
          text: label,
        }) as HTMLButtonElement
        control.type = 'button'
        control.dataset['action'] = action
        control.disabled = busy
        control.addEventListener('click', run)
      }

      renderManagedRows(
        'Available',
        managed.available,
        (entry, row) => {
          button(row, 'Install', 'install', () => {
            void manage(`Installing ${entry.id}`, () =>
              manager.install(entry.id, entry.availableVersion),
            )
          })
        },
        'No installable extensions are in the current catalog.',
      )
      renderManagedRows(
        'Installed',
        managed.installed,
        (entry, row) => {
          button(
            row,
            entry.enabled ? 'Disable' : 'Enable',
            entry.enabled ? 'disable' : 'enable',
            () => {
              void manage(`${entry.enabled ? 'Disabling' : 'Enabling'} ${entry.id}`, () =>
                manager.setEnabled(entry.id, !entry.enabled),
              )
            },
          )
          button(row, 'Remove', 'remove', () => {
            void manage(`Removing ${entry.id}`, () => manager.remove(entry.id))
          })
        },
        'No extensions are installed by the manager.',
      )
      renderManagedRows(
        'Enabled',
        managed.enabled,
        (entry, row) => {
          button(row, 'Disable', 'disable', () => {
            void manage(`Disabling ${entry.id}`, () => manager.setEnabled(entry.id, false))
          })
        },
        'No managed extensions are enabled.',
      )
      renderManagedRows(
        'Updates',
        managed.updates,
        (entry, row) => {
          button(row, 'Update', 'update', () => {
            void manage(`Updating ${entry.id}`, () => manager.update(entry.id))
          })
        },
        'All managed extensions use the catalog version.',
      )

      element(host, 'div', { part: 'settings.label', text: 'Problems' })
      const problems = element(host, 'div', { part: 'settings.list' })
      if (managed.problems.length === 0) {
        element(problems, 'p', { part: 'settings.description', text: 'No manager problems.' })
      }
      for (const message of managed.problems) {
        const problem = element(problems, 'p', {
          part: 'settings.description',
          text: safeViewerText(message, 600),
        })
        setState(problem, ['error'])
      }
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
      addEnablementIcon(item, entry.enabled, entry.id ?? entry.path)
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
        void mutate(`${wanted ? 'Enabling' : 'Disabling'} ${key}`, document =>
          withExtensionEnabled(document, key, wanted),
        )
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
      if (entry.id !== undefined) makeSubjectLink(text, 'org.modkitx/extension', entry.id)

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
      const enabled = !(value?.disabledExtensions ?? []).includes(coordinate)
      addEnablementIcon(item, enabled, coordinate)
      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', { part: 'settings.label', text: safeViewerText(coordinate, 200) })
      element(text, 'div', {
        part: 'settings.description',
        // Whole bundled extensions are not removable here; their contributions are, next door.
        text: enabled
          ? 'ships with the application — enabled; open its card to switch it off'
          : 'ships with the application — disabled; its contributions remain inventoried',
      })
      makeSubjectLink(text, 'org.modkitx/extension', coordinate)
    }
  }

  // ------------------------------------------------------------------ codecs group
  const renderCodecs = (host: HTMLElement): void => {
    if (renderSelectedSubject(host)) return
    const value = report
    element(host, 'p', {
      part: 'settings.description',
      text:
        'Every contribution the host inventoried, whichever extension ships it. Switching one off ' +
        'keeps the record — it stays listed here, and the host refuses to activate it — so a file ' +
        'that only that contribution could read opens as raw bytes instead, and the inspector says why.',
    })
    element(host, 'p', {
      part: 'settings.description',
      text:
        'Changes apply immediately: the app recomposes and reopens the files you had open. The ' +
        'reason a disabled contribution gives is the diagnostic x3.host/contribution-disabled.',
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
      const ownerLabel = element(host, 'div', {
        part: 'settings.label',
        text: `${owner} — ${owned.length} contribution(s)${off === 0 ? '' : `, ${off} off`}`,
      })
      makeSubjectLink(ownerLabel, 'org.modkitx/extension', owner)
      for (const contractGroup of groupContributionsByContract(owned)) {
        element(host, 'div', {
          part: 'settings.description',
          text: contractGroup.key ?? 'Unreadable contribution manifest',
        })
        const list = element(host, 'div', { part: 'settings.list' })
        for (const contribution of contractGroup.contributions) {
          const item = element(list, 'div', { part: 'settings.extension' })
          if (contribution.disabled) setState(item, ['error'])
          addEnablementIcon(
            item,
            !contribution.disabled && !contribution.extensionDisabled,
            contribution.displayName,
          )
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
            toggle.addEventListener('change', () => mutateContribution(id, toggle.checked))
          }

          const text = element(item, 'div', { part: 'settings.extension-text' })
          element(text, 'div', {
            part: 'settings.label',
            text: safeViewerText(contribution.displayName, 200),
          })
          element(text, 'div', {
            part: 'settings.description',
            text: safeViewerText(id ?? contribution.path, 200),
          })
          element(text, 'div', {
            part: 'settings.description',
            text: contribution.extensionDisabled
              ? 'inactive — the owner extension is switched off'
              : contribution.disabled
                ? 'switched off — the host will not activate it'
                : contribution.activationEligible
                  ? `active · ${contribution.origin}`
                  : `inventoried, not activatable · ${contribution.origin}`,
          })
          if (id !== undefined) makeSubjectLink(text, 'org.modkitx/contribution', id)
        }
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
        managerSnapshot = await options.manager?.snapshot()
        managerProblems.length = 0
        say(summarise(report))
      } catch (error) {
        const problem = `Could not read the extension state: ${describe(error)}`
        managerProblems.unshift(problem)
        say(problem, true)
      }
      draw()
    },
    destroy() {
      cardLoadRevision += 1
      mountedCard?.destroy()
      mountedCard = undefined
    },
  }

  const codecsGroup: SettingsUiGroup = {
    id: 'codecs',
    label: 'Contributions',
    render(host, context) {
      groupContext = context
      renderCodecs(host)
    },
  }

  return {
    groups: [extensionsGroup, codecsGroup],
  }
}
