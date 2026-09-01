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
} from '@modkit/ui'
import { contributionContractLabel, type UiLocalizer } from '@modkit/ui/localization'
import {
  subjectFactsSourceFromWire,
  type ExtensionSubjectCardWireDocument,
  type ExtensionManagerClient,
  type ExtensionManagerEntry,
  type ExtensionManagerSnapshot,
} from '@modkit/extension-manager'
import { createElectronLocalizer } from './localization.js'

export type { ExtensionManagerSnapshot } from '@modkit/extension-manager'

// ---------------------------------------------------------------------------------------------
// machine-readable operation lifecycle

export type ExtensionOperationState = 'busy' | 'applied' | 'failed' | 'refused'
export type ExtensionOperationTerminalState = Exclude<ExtensionOperationState, 'busy'>

export interface ExtensionOperationMarker {
  readonly revision: number
  readonly state: ExtensionOperationState
}

export interface ExtensionOperationLifecycle {
  readonly busy: boolean
  readonly marker: ExtensionOperationMarker
  begin(): number | undefined
  finish(revision: number, state: ExtensionOperationTerminalState): boolean
}

interface ExtensionOperationMarkerSource {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null
}

/**
 * One monotonic lifecycle shared by every mutation on the Extensions & Contributions page.
 * A terminal state keeps the revision of its matching `busy` state, so an observer cannot mistake
 * an older success message for completion of the operation it just started.
 */
export function createExtensionOperationLifecycle(): ExtensionOperationLifecycle {
  let marker: ExtensionOperationMarker = Object.freeze({ revision: 0, state: 'applied' })
  let activeRevision: number | undefined

  return {
    get busy() {
      return activeRevision !== undefined
    },
    get marker() {
      return marker
    },
    begin() {
      if (activeRevision !== undefined) return undefined
      activeRevision = marker.revision + 1
      marker = Object.freeze({ revision: activeRevision, state: 'busy' })
      return activeRevision
    },
    finish(revision, state) {
      if (activeRevision !== revision) return false
      marker = Object.freeze({ revision, state })
      activeRevision = undefined
      return true
    },
  }
}

export function extensionOperationIsTerminal(
  state: ExtensionOperationState,
): state is ExtensionOperationTerminalState {
  return state === 'applied' || state === 'failed' || state === 'refused'
}

/** Read only the stable machine attributes; localized status copy is deliberately outside it. */
export function readExtensionOperationMarker(
  root: ExtensionOperationMarkerSource,
): ExtensionOperationMarker | undefined {
  const node = root.querySelector('[data-operation-revision][data-operation-state]')
  const revisionText = node?.getAttribute('data-operation-revision')
  const state = node?.getAttribute('data-operation-state')
  const revision =
    revisionText === null || revisionText === undefined ? Number.NaN : Number(revisionText)
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    (state !== 'busy' && state !== 'applied' && state !== 'failed' && state !== 'refused')
  ) {
    return undefined
  }
  return Object.freeze({ revision, state })
}

/** Wait for an operation newer than `afterRevision` without inspecting any human-facing text. */
export async function waitForExtensionOperation(
  read: () => ExtensionOperationMarker | undefined,
  afterRevision: number,
  options: { readonly attempts?: number; readonly intervalMs?: number } = {},
): Promise<ExtensionOperationMarker> {
  const attempts = options.attempts ?? 600
  const intervalMs = options.intervalMs ?? 100
  let last = read()
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = read()
    if (
      last !== undefined &&
      last.revision > afterRevision &&
      extensionOperationIsTerminal(last.state)
    ) {
      return last
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(
    `extension operation after revision ${afterRevision} did not complete; ` +
      `last=${last === undefined ? 'missing' : `${last.revision}:${last.state}`}`,
  )
}

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

/**
 * A whole-extension switch leaves its contributions inventoried but makes each one inactive.
 * Count that state in the UI summary too: otherwise a receipt can say "applied" and "off: 0"
 * for a disabled one-contribution extension.
 */
export function disabledContributionCount(contributions: readonly ContributionReport[]): number {
  return contributions.filter(item => item.disabled || item.extensionDisabled).length
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
  /** Host-selected locale; omitted hosts follow Chromium's BCP-47 preferences. */
  readonly localizer?: UiLocalizer
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

function extensionCopy(localizer: UiLocalizer) {
  return {
    extensions: localizer.text('extensions.title'),
    contributions: localizer.text('extensions.contributions'),
    back: localizer.text('electron.extensions.back'),
    loadingCard: localizer.text('electron.extensions.loadingCard'),
    enable: localizer.text('common.enable'),
    disable: localizer.text('common.disable'),
    enableContribution: localizer.text('extensions.action.enableContribution'),
    disableContribution: localizer.text('extensions.action.disableContribution'),
    enableExtension: localizer.text('extensions.action.enableExtension'),
    disableExtension: localizer.text('extensions.action.disableExtension'),
    install: localizer.text('common.install'),
    update: localizer.text('common.update'),
    remove: localizer.text('common.remove'),
    dismiss: localizer.text('common.dismiss'),
    enabled: localizer.text('common.enabled'),
    disabled: localizer.text('common.disabled'),
    available: localizer.text('extensions.group.available'),
    installed: localizer.text('extensions.group.installed'),
    enabledGroup: localizer.text('extensions.group.enabled'),
    updates: localizer.text('extensions.group.updates'),
    problems: localizer.text('extensions.group.problems'),
    refreshCatalog: localizer.text('extensions.refreshCatalog'),
    addFolder: localizer.text('extensions.addFolder'),
    connected: localizer.text('extensions.connected'),
    notAdded: localizer.text('extensions.notAdded'),
    shippedNotLoaded: localizer.text('extensions.shippedNotLoaded'),
    bundled: localizer.text('extensions.bundled'),
    noId: localizer.text('electron.extensions.noId'),
    unreadable: localizer.text('electron.extensions.unreadable'),
    noContributions: localizer.text('electron.extensions.noContributions'),
    noManagerProblems: localizer.text('extensions.emptyManagerProblems'),
    emptyConnected: localizer.text('electron.extensions.emptyConnected'),
    extensionsDescription: (location: string) =>
      localizer.text('electron.extensions.description', { location }),
    immediateDescription: localizer.text('electron.extensions.immediateDescription'),
    contributionsDescription: localizer.text('electron.extensions.contributionsDescription'),
    contributionDiagnostic: localizer.text('electron.extensions.contributionDiagnostic'),
    settingsFailed: (reason: string) =>
      localizer.text('electron.extensions.settingsFailed', { reason }),
    notInstalled: localizer.text('common.notInstalled'),
    trustedSource: localizer.text('electron.extensions.trustedSource'),
    untrustedSource: localizer.text('electron.extensions.untrustedSource'),
    noInstallable: localizer.text('electron.extensions.noInstallable'),
    noInstalled: localizer.text('electron.extensions.noInstalled'),
    noEnabled: localizer.text('electron.extensions.noEnabled'),
    noUpdates: localizer.text('electron.extensions.noUpdates'),
    noSettingsId: localizer.text('electron.extensions.noSettingsId'),
    entryLoaded: localizer.text('electron.extensions.entryLoaded'),
    entryDisabled: localizer.text('electron.extensions.entryDisabled'),
    entryAbsent: localizer.text('electron.extensions.entryAbsent'),
    entryFailed: (code: string, message: string) =>
      localizer.text('electron.extensions.entryFailed', { code, message }),
    bundledEnabled: localizer.text('electron.extensions.bundledEnabled'),
    bundledDisabled: localizer.text('electron.extensions.bundledDisabled'),
    contributionOwnerDisabled: localizer.text('electron.extensions.contributionOwnerDisabled'),
    contributionDisabled: localizer.text('electron.extensions.contributionDisabled'),
    contributionActive: (origin: string) =>
      localizer.text('electron.extensions.contributionActive', { origin }),
    contributionInert: (origin: string) =>
      localizer.text('electron.extensions.contributionInert', { origin }),
    ownerSummary: (owner: string, count: number, off: number) =>
      localizer.text(
        off === 0 ? 'electron.extensions.ownerSummary' : 'electron.extensions.ownerSummaryOff',
        off === 0 ? { owner, count } : { owner, count, off },
      ),
    summary: (loaded: number, contributions: number, off: number, types: number) =>
      localizer.text('electron.extensions.summary', {
        loaded,
        contributions,
        off,
        types,
      }),
    operation: (
      verb: 'add' | 'refresh' | 'install' | 'enable' | 'disable' | 'remove' | 'update',
      id: string,
    ) => localizer.text(`electron.extensions.operation.${verb}`, { id }),
    saving: (what: string) => localizer.text('electron.extensions.saving', { what }),
    applied: (what: string, summary: string) =>
      localizer.text('electron.extensions.applied', { what, summary }),
    failed: (what: string, reason: string) =>
      localizer.text('electron.extensions.failed', { what, reason }),
    complete: (what: string, summary?: string) =>
      localizer.text(
        summary === undefined
          ? 'electron.extensions.complete'
          : 'electron.extensions.completeSummary',
        summary === undefined ? { what } : { what, summary },
      ),
    browseFailed: (reason: string) =>
      localizer.text('electron.extensions.browseFailed', { reason }),
    noFolder: localizer.text('electron.extensions.noFolder'),
    alreadyListed: (root: string) => localizer.text('electron.extensions.alreadyListed', { root }),
    notAddedStatus: (root: string, code: string, message: string) =>
      localizer.text('electron.extensions.notAddedStatus', { root, code, message }),
    missingCard: (id: string) => localizer.text('electron.extensions.missingCard', { id }),
    stateReadFailed: (reason: string) =>
      localizer.text('electron.extensions.stateReadFailed', { reason }),
    cardFailed: (reason: string) => localizer.text('electron.extensions.cardFailed', { reason }),
  } as const
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
  const localizer = options.localizer ?? createElectronLocalizer(globalThis.navigator?.languages)
  const copy = extensionCopy(localizer)
  let report: ExtensionsReport | undefined
  let managerSnapshot: ExtensionManagerSnapshot | undefined
  const managerProblems: string[] = []
  let groupContext: SettingsUiGroupContext | undefined
  let selectedSubjectId: string | undefined
  let mountedCard: SubjectCard | undefined
  let cardLoadRevision = 0
  /** Busy while main recomposes: a second toggle mid-flight would compose against stale bytes. */
  const operation = createExtensionOperationLifecycle()
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

  const beginOperation = (): number | undefined => {
    const revision = operation.begin()
    if (revision !== undefined) draw()
    return revision
  }

  const finishOperation = (revision: number, state: ExtensionOperationTerminalState): void => {
    if (operation.finish(revision, state)) draw()
  }

  const markOperation = (host: HTMLElement): void => {
    host.dataset['operationRevision'] = String(operation.marker.revision)
    host.dataset['operationState'] = operation.marker.state
  }

  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  const summarise = (value: ExtensionsReport): string => {
    const loaded = value.bundled.length + value.installed.length
    const off = disabledContributionCount(value.contributions)
    return copy.summary(loaded, value.contributions.length, off, value.supportedExtensions.length)
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
    activeRevision?: number,
  ): Promise<void> => {
    const revision = activeRevision ?? beginOperation()
    if (revision === undefined) return
    let terminal: ExtensionOperationTerminalState = 'applied'
    say(copy.saving(what))
    try {
      await options.store.write(change((await options.store.read()).document))
      report = await options.apply()
      say(copy.applied(what, summarise(report)))
    } catch (error) {
      terminal = 'failed'
      say(copy.failed(what, describe(error)), true)
    } finally {
      finishOperation(revision, terminal)
    }
  }

  /** Run one explicit manager command, then safely recompose from manager state plus settings. */
  const manage = async (
    what: string,
    operation: () => Promise<void>,
    recompose = true,
  ): Promise<void> => {
    const revision = beginOperation()
    if (revision === undefined) return
    let terminal: ExtensionOperationTerminalState = 'applied'
    say(`${what}…`)
    try {
      await operation()
      managerSnapshot = await options.manager?.snapshot()
      managerProblems.length = 0
      if (recompose) report = await options.apply()
      say(copy.complete(what, report === undefined ? undefined : summarise(report)))
    } catch (error) {
      terminal = 'failed'
      const problem = copy.failed(what, describe(error))
      managerProblems.unshift(problem)
      say(problem, true)
    } finally {
      finishOperation(revision, terminal)
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
      say(copy.missingCard(id), true)
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
    node.title = localizer.text(
      kind === 'modkit/contribution'
        ? 'extensions.action.openContributionCard'
        : 'extensions.action.openExtensionCard',
    )
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
    icon.setAttribute('aria-label', `${label} ${enabled ? copy.enabled : copy.disabled}`)
    return icon
  }

  const mutateContribution = (id: string, enabled: boolean): void => {
    void mutate(copy.operation(enabled ? 'enable' : 'disable', id), document =>
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
    if (wire.subject.kind === 'modkit/contribution' || wire.subject.kind === 'modkit/extension') {
      addEnablementIcon(
        actions,
        wire.subject.kind === 'modkit/contribution'
          ? wire.subject.effectiveEnabled === true
          : wire.subject.enabled === true,
        wire.subject.displayName,
      )
    }
    const back = element(actions, 'button', {
      part: 'settings.add',
      text: copy.back,
    }) as HTMLButtonElement
    back.type = 'button'
    back.dataset['action'] = 'close-subject-card'
    back.addEventListener('click', () => {
      selectedSubjectId = undefined
      draw()
    })

    if (wire.subject.kind === 'modkit/contribution') {
      const toggle = element(actions, 'button', {
        part: 'settings.add',
        text: wire.subject.enabled ? copy.disableContribution : copy.enableContribution,
      }) as HTMLButtonElement
      toggle.type = 'button'
      toggle.disabled = operation.busy
      toggle.dataset['action'] = wire.subject.enabled
        ? 'disable-contribution'
        : 'enable-contribution'
      toggle.addEventListener('click', () =>
        mutateContribution(wire.subject.id, !wire.subject.enabled),
      )
    } else if (wire.subject.kind === 'modkit/extension') {
      const toggle = element(actions, 'button', {
        part: 'settings.add',
        text: wire.subject.enabled ? copy.disableExtension : copy.enableExtension,
      }) as HTMLButtonElement
      toggle.type = 'button'
      toggle.disabled = operation.busy
      toggle.dataset['action'] = wire.subject.enabled ? 'disable-extension' : 'enable-extension'
      toggle.addEventListener('click', () => {
        void mutate(
          copy.operation(wire.subject.enabled ? 'disable' : 'enable', wire.subject.id),
          document => withExtensionEnabled(document, wire.subject.id, !wire.subject.enabled),
        )
      })
    }

    const cardHost = element(host, 'div', { part: 'settings.list' })
    cardHost.dataset['subjectId'] = wire.subject.subjectId
    element(cardHost, 'p', { part: 'settings.description', text: copy.loadingCard })
    const revision = cardLoadRevision
    void (async () => {
      try {
        const sections = await loadSubjectCardSections(subjectFactsSourceFromWire(wire), {
          localizer,
        })
        if (revision !== cardLoadRevision || selectedSubjectId !== wire.subject.subjectId) return
        const card = createSubjectCard(cardHost.ownerDocument, {
          localizer,
          label: wire.subject.displayName,
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
          text: copy.cardFailed(describe(error)),
        })
        setState(problem, ['error'])
      }
    })()
    return true
  }

  // ------------------------------------------------------------------ extensions group
  const addFolder = (): void => {
    void (async () => {
      const revision = beginOperation()
      if (revision === undefined) return
      let picked: BrowseResult
      try {
        picked = await options.browse()
      } catch (error) {
        say(copy.browseFailed(describe(error)), true)
        finishOperation(revision, 'failed')
        return
      }
      if (picked.canceled) {
        say(copy.noFolder)
        finishOperation(revision, 'refused')
        return
      }
      if (picked.state === 'already-configured') {
        say(copy.alreadyListed(picked.root))
        finishOperation(revision, 'refused')
        return
      }
      if (picked.state === 'refused') {
        // Verbatim, and it stays on the page: "that folder is not an extension, here is the
        // loader's reason" is the whole answer a user who picked the wrong directory needs.
        refusals.unshift({ root: picked.root, code: picked.code, message: picked.message })
        say(copy.notAddedStatus(picked.root, picked.code, picked.message), true)
        finishOperation(revision, 'refused')
        return
      }
      const entry = { id: picked.id, path: picked.root, enabled: true }
      await mutate(
        copy.operation('add', picked.id),
        document => ({
          ...document,
          extensions: [...document.extensions.filter(other => other.id !== entry.id), entry],
        }),
        revision,
      )
    })()
  }

  const renderExtensions = (host: HTMLElement): void => {
    markOperation(host)
    if (renderSelectedSubject(host)) return
    const value = report
    element(host, 'p', {
      part: 'settings.description',
      text: copy.extensionsDescription(options.store.location),
    })
    element(host, 'p', {
      part: 'settings.description',
      text: copy.immediateDescription,
    })
    if (value?.problem !== undefined) {
      const problem = element(host, 'p', {
        part: 'settings.description',
        text: copy.settingsFailed(value.problem),
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
        text: copy.refreshCatalog,
      }) as HTMLButtonElement
      refresh.type = 'button'
      refresh.dataset['action'] = 'refresh-catalog'
      refresh.disabled = operation.busy
      refresh.addEventListener('click', () => {
        void manage(copy.operation('refresh', copy.extensions), () => manager.refresh(), false)
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
              `${entry.installedVersion ?? copy.notInstalled} → ${entry.availableVersion} · ` +
              `${entry.trusted ? copy.trustedSource : copy.untrustedSource}`,
          })
          makeSubjectLink(text, 'modkit/extension', entry.id)
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
        control.disabled = operation.busy
        control.addEventListener('click', run)
      }

      renderManagedRows(
        copy.available,
        managed.available,
        (entry, row) => {
          button(row, copy.install, 'install', () => {
            void manage(copy.operation('install', entry.id), () =>
              manager.install(entry.id, entry.availableVersion),
            )
          })
        },
        copy.noInstallable,
      )
      renderManagedRows(
        copy.installed,
        managed.installed,
        (entry, row) => {
          button(
            row,
            entry.enabled ? copy.disable : copy.enable,
            entry.enabled ? 'disable' : 'enable',
            () => {
              void manage(copy.operation(entry.enabled ? 'disable' : 'enable', entry.id), () =>
                manager.setEnabled(entry.id, !entry.enabled),
              )
            },
          )
          button(row, copy.remove, 'remove', () => {
            void manage(copy.operation('remove', entry.id), () => manager.remove(entry.id))
          })
        },
        copy.noInstalled,
      )
      renderManagedRows(
        copy.enabledGroup,
        managed.enabled,
        (entry, row) => {
          button(row, copy.disable, 'disable', () => {
            void manage(copy.operation('disable', entry.id), () =>
              manager.setEnabled(entry.id, false),
            )
          })
        },
        copy.noEnabled,
      )
      renderManagedRows(
        copy.updates,
        managed.updates,
        (entry, row) => {
          button(row, copy.update, 'update', () => {
            void manage(copy.operation('update', entry.id), () => manager.update(entry.id))
          })
        },
        copy.noUpdates,
      )

      element(host, 'div', { part: 'settings.label', text: copy.problems })
      const problems = element(host, 'div', { part: 'settings.list' })
      if (managed.problems.length === 0) {
        element(problems, 'p', { part: 'settings.description', text: copy.noManagerProblems })
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
      text: copy.addFolder,
    }) as HTMLButtonElement
    add.type = 'button'
    add.dataset['action'] = 'add-folder'
    add.disabled = operation.busy
    add.addEventListener('click', addFolder)

    // ---- what the user connected
    element(host, 'div', { part: 'settings.label', text: copy.connected })
    const list = element(host, 'div', { part: 'settings.list' })
    const entries = value?.entries ?? []
    if (entries.length === 0) {
      element(list, 'p', {
        part: 'settings.description',
        text: copy.emptyConnected,
      })
    }
    for (const entry of entries) {
      const item = element(list, 'div', { part: 'settings.extension' })
      if (entry.state === 'failed') setState(item, ['error'])
      addEnablementIcon(item, entry.enabled, entry.id ?? entry.path)
      const toggle = element(item, 'input', { part: 'settings.toggle' }) as HTMLInputElement
      toggle.type = 'checkbox'
      toggle.checked = entry.enabled
      toggle.disabled = operation.busy || entry.id === undefined
      toggle.dataset['action'] = entry.enabled ? 'disable-extension' : 'enable-extension'
      toggle.dataset['extension'] = entry.id ?? entry.path
      toggle.setAttribute('aria-label', `${copy.enable} ${entry.id ?? entry.path}`)
      toggle.addEventListener('change', () => {
        const wanted = toggle.checked
        const key = entry.id
        if (key === undefined) return
        void mutate(copy.operation(wanted ? 'enable' : 'disable', key), document =>
          withExtensionEnabled(document, key, wanted),
        )
      })

      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', {
        part: 'settings.label',
        text: safeViewerText(entry.id ?? copy.noSettingsId, 200),
      })
      element(text, 'div', { part: 'settings.description', text: safeViewerText(entry.path, 400) })
      element(text, 'div', {
        part: 'settings.description',
        // The loader's own words. A paraphrase here would send the user looking for the wrong bug.
        text:
          entry.state === 'loaded'
            ? copy.entryLoaded
            : entry.state === 'disabled'
              ? copy.entryDisabled
              : entry.state === 'failed'
                ? copy.entryFailed(entry.code ?? '', entry.message ?? '')
                : copy.entryAbsent,
      })
      if (entry.id !== undefined) makeSubjectLink(text, 'modkit/extension', entry.id)

      const remove = element(item, 'button', {
        part: 'settings.remove',
        text: copy.remove,
      }) as HTMLButtonElement
      remove.type = 'button'
      remove.dataset['action'] = 'remove-folder'
      remove.dataset['extension'] = entry.id ?? entry.path
      remove.disabled = operation.busy
      remove.addEventListener('click', () => {
        void mutate(copy.operation('remove', entry.id ?? entry.path), document => ({
          ...document,
          extensions: document.extensions.filter(other =>
            entry.id === undefined ? other.path !== entry.path : other.id !== entry.id,
          ),
        }))
      })
    }

    // ---- folders the user picked that were not extensions
    if (refusals.length > 0) {
      element(host, 'div', { part: 'settings.label', text: copy.notAdded })
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
          text: copy.dismiss,
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
      element(host, 'div', { part: 'settings.label', text: copy.shippedNotLoaded })
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
    element(host, 'div', { part: 'settings.label', text: copy.bundled })
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
        text: enabled ? copy.bundledEnabled : copy.bundledDisabled,
      })
      makeSubjectLink(text, 'modkit/extension', coordinate)
    }
  }

  // ------------------------------------------------------------------ codecs group
  const renderCodecs = (host: HTMLElement): void => {
    markOperation(host)
    if (renderSelectedSubject(host)) return
    const value = report
    element(host, 'p', {
      part: 'settings.description',
      text: copy.contributionsDescription,
    })
    element(host, 'p', {
      part: 'settings.description',
      text: copy.contributionDiagnostic,
    })

    const contributions = value?.contributions ?? []
    if (contributions.length === 0) {
      element(host, 'p', {
        part: 'settings.description',
        text: copy.noContributions,
      })
      return
    }

    const owners = [...new Set(contributions.map(item => item.extension))]
    for (const owner of owners) {
      const owned = contributions.filter(item => item.extension === owner)
      const off = owned.filter(item => item.disabled).length
      const ownerLabel = element(host, 'div', {
        part: 'settings.label',
        text: copy.ownerSummary(owner, owned.length, off),
      })
      makeSubjectLink(ownerLabel, 'modkit/extension', owner)
      for (const contractGroup of groupContributionsByContract(owned)) {
        element(host, 'div', {
          part: 'settings.description',
          text: contributionContractLabel(localizer, contractGroup.key),
        })
        const contractHeading = host.lastElementChild
        if (contractHeading instanceof HTMLElement && contractGroup.key !== undefined) {
          contractHeading.title = localizer.text('extensions.tooltip.exactContract', {
            contract: contractGroup.key,
          })
        }
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
            element(item, 'div', { part: 'settings.description', text: copy.noId })
          } else {
            const toggle = element(item, 'input', { part: 'settings.toggle' }) as HTMLInputElement
            toggle.type = 'checkbox'
            toggle.checked = !contribution.disabled
            toggle.disabled = operation.busy
            toggle.dataset['action'] = contribution.disabled
              ? 'enable-contribution'
              : 'disable-contribution'
            toggle.dataset['contribution'] = id
            toggle.setAttribute('aria-label', `${copy.enable} ${id}`)
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
              ? copy.contributionOwnerDisabled
              : contribution.disabled
                ? copy.contributionDisabled
                : contribution.activationEligible
                  ? copy.contributionActive(contribution.origin)
                  : copy.contributionInert(contribution.origin),
          })
          if (id !== undefined) makeSubjectLink(text, 'modkit/contribution', id)
        }
      }
    }
  }

  const extensionsGroup: SettingsUiGroup = {
    id: 'extensions',
    label: copy.extensions,
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
        const problem = copy.stateReadFailed(describe(error))
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
    label: copy.contributions,
    render(host, context) {
      groupContext = context
      renderCodecs(host)
    },
  }

  return {
    groups: [extensionsGroup, codecsGroup],
  }
}
