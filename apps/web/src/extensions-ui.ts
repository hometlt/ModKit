/**
 * The installed-extensions surface: what this host has loaded, where each one came from, and what
 * that provenance is actually worth.
 *
 * The list is deliberately one list with two provenances, never two lists that look alike:
 *
 *  - a **bundled** extension's digests were recorded when the app was built, by the build, and the
 *    page checks the served bytes against that record. Someone other than the user vouched for it;
 *  - a **user folder**'s digests were computed by this page, a moment ago, from the bytes it read
 *    through the handle the user granted. Nobody vouched for anything. The digest is a
 *    measurement, not an attestation: it pins the bytes between being read and being run, and
 *    says nothing whatsoever about who wrote them.
 *
 * Both run in a worker and only in a worker. There is no control here for anything else, because
 * there is nothing else a browser host offers and offering the choice would be theatre.
 *
 * The view model (`describeExtensionList`) is a pure function of the load result, so what this
 * panel claims is unit-tested in Node; `mountExtensionsUi` only renders it and wires the buttons.
 * The shell owns composition — this module never builds a host — so adding or removing a folder
 * reports through `onChanged` and lets the composition root decide when to rebuild.
 */

import { subjectFactsSourceFromWire } from '@modkit/extension-manager'
import {
  createSubjectCard,
  loadSubjectCardSections,
  SubjectNavigationHistory,
  type CardRef,
  type SubjectCard,
} from '@modkit/ui/card'
import { element, type PartName } from '@modkit/ui/viewer'
import { contributionContractLabel, type UiLocalizer } from '@modkit/ui/localization'
import type { BrowserSubtleCryptoLike } from '@modkit/host/browser'
import {
  containerCoordinate,
  EXTENSION_ROOT_FAILURE_CODES,
  loadUserExtensionRoots,
  requestUserExtensionPermission,
  type LoadedUserExtensionRoots,
  type UserExtensionRootFailure,
  type WebExtensionDirectoryHandle,
} from './extension-roots.js'
import type { StoredUserExtension, UserExtensionStore } from './extension-store.js'
import type { ManagedExtensionsController } from './managed-extensions-controller.js'
import { catalogCoordinates, type WebExtensionCatalog } from './subjects.js'
import type { WebExtensionSubjectCatalog, WebExtensionSubjectEntry } from './extension-subjects.js'
import { webExtensionSubjectCardBundle } from './extension-subjects.js'
import { createWebLocalizer } from './localization.js'

// ---------------------------------------------------------------------------------------------
// the one sentence

/** The trust model in plain language. Shown once, above the list, never buried in a tooltip. */
export const USER_EXTENSION_TRUST_SENTENCE =
  'A folder you add here is trusted because you picked it and for no other reason — nothing is ' +
  'signed and nobody has reviewed it; this page hashes every file as it reads them so that a ' +
  'file changed afterwards is refused instead of run, and user extensions always run in a ' +
  'worker, never on the page.'

/** Why the two provenances in the list are not the same fact. */
export const USER_EXTENSION_PROVENANCE_NOTE =
  'Bundled extensions carry digests this app recorded when it was built. Folders you added carry ' +
  'digests this page computed itself just now — a measurement of the bytes it read, not a claim ' +
  'about who wrote them.'

function extensionCopy(localizer: UiLocalizer) {
  return {
    title: localizer.text('extensions.title'),
    subjects: localizer.text('extensions.subjects'),
    subjectsDescription: localizer.text('web.extensions.subjectsDescription'),
    emptySubjects: localizer.text('extensions.emptySubjects'),
    downloadable: localizer.text('extensions.downloadable'),
    downloadableDescription: localizer.text('web.extensions.downloadableDescription'),
    checkAvailable: localizer.text('extensions.checkCatalog'),
    addFolder: localizer.text('extensions.addFolder'),
    grantAccess: localizer.text('extensions.grantAccess'),
    enable: localizer.text('common.enable'),
    disable: localizer.text('common.disable'),
    enableContribution: localizer.text('extensions.action.enableContribution'),
    disableContribution: localizer.text('extensions.action.disableContribution'),
    enableExtension: localizer.text('extensions.action.enableExtension'),
    disableExtension: localizer.text('extensions.action.disableExtension'),
    install: localizer.text('common.install'),
    update: localizer.text('common.update'),
    remove: localizer.text('common.remove'),
    enabled: localizer.text('common.enabled'),
    disabled: localizer.text('common.disabled'),
    notInstalled: localizer.text('common.notInstalled'),
    notInCatalog: localizer.text('web.extensions.notInCatalog'),
    updateAvailable: localizer.text('web.extensions.updateAvailable'),
    trusted: localizer.text('web.extensions.trusted'),
    notTrusted: localizer.text('web.extensions.notTrusted'),
    emptyFolders: localizer.text('extensions.emptyFolders'),
    catalogEmpty: localizer.text('web.extensions.catalogEmpty'),
    noDownloaded: localizer.text('web.extensions.noDownloaded'),
    packageDisabled: localizer.text('web.extensions.packageDisabled'),
    reloadPending: localizer.text('web.extensions.reloadPending'),
    removedPending: localizer.text('web.extensions.removedPending'),
    trustSentence: localizer.text('web.extensions.trustSentence'),
    provenanceNote: localizer.text('web.extensions.provenanceNote'),
    remembered: (location: string) => localizer.text('web.extensions.remembered', { location }),
    added: (name: string, coordinate?: string) =>
      localizer.text('web.extensions.added', {
        name,
        coordinate: coordinate === undefined ? '' : ` (${coordinate})`,
      }),
    actionFailed: (reason: string) => localizer.text('web.extensions.actionFailed', { reason }),
    addFailed: (reason: string) => localizer.text('web.extensions.addFailed', { reason }),
    removeFailed: (reason: string) => localizer.text('web.extensions.removeFailed', { reason }),
    accessFailed: (reason: string) => localizer.text('web.extensions.accessFailed', { reason }),
    accessGranted: (name: string) => localizer.text('web.extensions.accessGranted', { name }),
    accessDenied: (name: string, state: string) =>
      localizer.text('web.extensions.accessDenied', { name, state }),
    catalogChecked: (location: string) =>
      localizer.text('web.extensions.catalogChecked', { location }),
    catalogLoaded: (location: string) =>
      localizer.text('web.extensions.catalogLoaded', { location }),
    catalogNotContacted: (location: string) =>
      localizer.text('web.extensions.catalogNotContacted', { location }),
    installedStatus: (name: string) => localizer.text('web.extensions.installedStatus', { name }),
    updatedStatus: (name: string) => localizer.text('web.extensions.updatedStatus', { name }),
    removedStatus: (name: string) => localizer.text('web.extensions.removedStatus', { name }),
    cardFailed: (reason: string) => localizer.text('web.extensions.cardFailed', { reason }),
  } as const
}

// ---------------------------------------------------------------------------------------------
// view model

export type ExtensionRowKind = 'bundled' | 'user'
export type ExtensionRowState = 'loaded' | 'needs-permission' | 'failed'

export interface ExtensionRow {
  readonly kind: ExtensionRowKind
  readonly state: ExtensionRowState
  /** Stored root id, for the rows a user can act on. */
  readonly rootId?: string
  readonly label: string
  readonly coordinate?: string
  /** Where these bytes came from, and what that buys. */
  readonly provenance: string
  /** Failure code, verbatim — the same string the Node host would print. */
  readonly code?: string
  /** Failure message, verbatim. */
  readonly detail?: string
}

export interface ExtensionListInput {
  readonly catalog: WebExtensionCatalog
  readonly loaded: LoadedUserExtensionRoots
  /** The stored records, so a row can show the folder name the user actually picked. */
  readonly stored?: readonly StoredUserExtension[]
  /** Conflicts a composition found afterwards (`WebSubjectServices.userExtensionConflicts`). */
  readonly extraFailures?: readonly UserExtensionRootFailure[]
}

const bundledProvenance = (root: string, localizer: UiLocalizer): string =>
  localizer.text('web.extensions.bundledProvenance', { root })

const userProvenance = (label: string, localizer: UiLocalizer): string =>
  localizer.text('web.extensions.userProvenance', { label })

/**
 * The rows the panel shows: bundled first (this host's own floor), then the folders the user
 * added, then every folder that did not load — with its code and message unedited, because a
 * user who picked the wrong folder needs the reason, not a shrug.
 */
export function describeExtensionList(
  input: ExtensionListInput,
  localizer: UiLocalizer = createWebLocalizer('en'),
): readonly ExtensionRow[] {
  const rows: ExtensionRow[] = []
  for (const entry of input.catalog.extensions) {
    const coordinate = containerCoordinate(entry.containers)
    rows.push({
      kind: 'bundled',
      state: 'loaded',
      label: entry.name,
      ...(coordinate === undefined ? {} : { coordinate }),
      provenance: bundledProvenance(entry.artifactRoot, localizer),
    })
  }
  const labels = new Map((input.stored ?? []).map(record => [record.id, record.label]))
  for (const [index, extension] of input.loaded.inputs.entries()) {
    const rootId = input.loaded.rootIds[index]
    const coordinate = input.loaded.coordinates[index]
    const label = (rootId === undefined ? undefined : labels.get(rootId)) ?? extension.source
    rows.push({
      kind: 'user',
      state: 'loaded',
      ...(rootId === undefined ? {} : { rootId }),
      label,
      ...(coordinate === undefined ? {} : { coordinate }),
      provenance: userProvenance(label, localizer),
    })
  }
  for (const failure of [...input.loaded.failures, ...(input.extraFailures ?? [])]) {
    // The name the user saw when they added it, so a folder does not change identity in the list
    // the moment it stops loading; the loader's own `root` is the fallback.
    const label = labels.get(failure.rootId) ?? failure.root
    rows.push({
      kind: 'user',
      state:
        failure.code === EXTENSION_ROOT_FAILURE_CODES.permissionRequired
          ? 'needs-permission'
          : 'failed',
      rootId: failure.rootId,
      label,
      provenance: userProvenance(label, localizer),
      code: failure.code,
      detail: failure.message,
    })
  }
  return Object.freeze(rows)
}

// ---------------------------------------------------------------------------------------------
// mounting

export interface ExtensionsUiOptions {
  /** Host-selected locale; omitted hosts follow the browser's BCP-47 preference list. */
  readonly localizer?: UiLocalizer
  readonly store: UserExtensionStore
  readonly catalog: WebExtensionCatalog
  /** Optional catalog-backed package manager. Its catalog is read only after a visible action. */
  readonly managedExtensions?: ManagedExtensionsController
  /** Claims loaded before user folders, such as enabled downloaded packages. */
  readonly additionalClaimedCoordinates?: readonly string[]
  /** WebCrypto's `subtle`; every digest in this panel is computed by the page with it. */
  readonly subtle: BrowserSubtleCryptoLike
  /**
   * Opens the browser's folder picker. Must be reachable only from a user gesture — this module
   * calls it from a click handler and nowhere else.
   */
  pickDirectory(): Promise<WebExtensionDirectoryHandle | undefined>
  /** Called after the installed set changed, so the composition root can rebuild its host. */
  onChanged?(loaded: LoadedUserExtensionRoots): void | Promise<void>
  /** Conflicts the composition reported for the current host, shown alongside the load failures. */
  conflicts?(): readonly UserExtensionRootFailure[]
  /** Validated subjects of the currently composed host. Undefined while the host is booting. */
  extensionSubjects?(): WebExtensionSubjectCatalog | undefined
  /** Portable settings action for one authored contribution. */
  setContributionEnabled?(id: string, enabled: boolean): void | Promise<void>
  /** Portable settings action for one extension coordinate. */
  setExtensionEnabled?(id: string, enabled: boolean): void | Promise<void>
  newId?(): string
  readonly maxFiles?: number
  readonly maxTotalBytes?: number
}

export interface ExtensionsUi {
  readonly root: HTMLElement
  /**
   * Replace the provisional built-in localizer after data-only language packs have been read.
   * The panel is constructed early so it can discover user-granted roots, but the shell does not
   * attach it to the visible settings view until this handoff has happened.
   */
  setLocalizer(localizer: UiLocalizer): void
  /** Re-reads the stored folders and re-hashes every file. Never trusts a cached digest. */
  reload(): Promise<void>
  /** The last load, for a composition root that wants to hand it to `createWebSubjectServices`. */
  current(): LoadedUserExtensionRoots
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function defaultId(): string {
  const source = globalThis.crypto as { randomUUID?: () => string } | undefined
  const uuid = source?.randomUUID?.()
  return uuid ?? `root-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function button(
  parent: HTMLElement,
  part: PartName,
  label: string,
  onClick: () => void,
): HTMLElement {
  const node = element(parent, 'button', { part, text: label })
  node.setAttribute('type', 'button')
  node.addEventListener('click', onClick)
  return node
}

/**
 * Mount the panel. The returned `root` is appended by the composition root (the shell), which is
 * also what decides when a changed extension list becomes a rebuilt host.
 */
export function mountExtensionsUi(
  documentRef: Document,
  options: ExtensionsUiOptions,
): ExtensionsUi {
  const root = documentRef.createElement('section')
  root.className = 'web-extensions-view'
  const newId = options.newId ?? defaultId
  let localizer = options.localizer ?? createWebLocalizer(globalThis.navigator?.languages)
  let copy = extensionCopy(localizer)

  let stored: readonly StoredUserExtension[] = []
  let loaded: LoadedUserExtensionRoots = {
    inputs: [],
    failures: [],
    coordinates: [],
    rootIds: [],
    moduleMap: {},
    moduleMapOwners: {},
    verifiedModuleRoots: [],
    serve: async url => ({
      ok: false,
      status: 404,
      arrayBuffer: () => Promise.reject(new Error(`404 ${url}`)),
    }),
  }
  let status = ''
  let activeExtensionId: string | undefined
  let activeSubjectId: string | undefined
  let activeCard: SubjectCard | undefined
  let cardRevision = 0
  const subjectHistory = new SubjectNavigationHistory()

  const loadOptions = () => ({
    subtle: options.subtle,
    claimed: [
      ...catalogCoordinates(options.catalog),
      ...(options.additionalClaimedCoordinates ?? []),
    ],
    ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
    ...(options.maxTotalBytes === undefined ? {} : { maxTotalBytes: options.maxTotalBytes }),
  })

  const reload = async (): Promise<void> => {
    const [nextStored] = await Promise.all([
      options.store.list(),
      // IndexedDB only: this never contacts the injected catalog port.
      options.managedExtensions?.refreshInstalled(),
    ])
    stored = nextStored
    loaded = await loadUserExtensionRoots(
      stored.map(record => ({
        id: record.id,
        handle: record.handle,
        ...(record.coordinate === undefined ? {} : { expectedId: record.coordinate }),
      })),
      loadOptions(),
    )
    render()
  }

  const changed = async (): Promise<void> => {
    await reload()
    await options.onChanged?.(loaded)
    render()
  }

  const add = (): void => {
    void (async () => {
      try {
        const handle = await options.pickDirectory()
        if (handle === undefined) return
        const id = newId()
        // Loaded before it is stored: a folder that is not an extension is refused with its
        // reason instead of joining the list and failing silently on every future reload.
        const probe = await loadUserExtensionRoots([{ id, handle }], {
          ...loadOptions(),
          claimed: [...catalogCoordinates(options.catalog), ...loaded.coordinates],
        })
        const failure = probe.failures[0]
        if (failure !== undefined) {
          status = `${handle.name}: ${failure.message} (${failure.code})`
          render()
          return
        }
        const coordinate = probe.coordinates[0]
        await options.store.add({
          id,
          label: handle.name,
          addedAt: Date.now(),
          ...(coordinate === undefined ? {} : { coordinate }),
          handle,
        })
        status = copy.added(handle.name, coordinate)
        await changed()
      } catch (error) {
        status = copy.addFailed(describe(error))
        render()
      }
    })()
  }

  const remove = (rootId: string): void => {
    void (async () => {
      try {
        await options.store.remove(rootId)
        status = copy.removedPending
        await changed()
      } catch (error) {
        status = copy.removeFailed(describe(error))
        render()
      }
    })()
  }

  /*
   * The prompt happens here and only here: a click. Asking on load would either be ignored by the
   * browser or teach the user to dismiss the dialog, so a lapsed grant sits in the list saying so
   * until the user acts on it.
   */
  const grant = (rootId: string): void => {
    void (async () => {
      const record = stored.find(entry => entry.id === rootId)
      if (record === undefined) return
      try {
        const state = await requestUserExtensionPermission(record.handle)
        status =
          state === 'granted'
            ? copy.accessGranted(record.label)
            : copy.accessDenied(record.label, state)
        await changed()
      } catch (error) {
        status = copy.accessFailed(describe(error))
        render()
      }
    })()
  }

  const managedAction = (action: () => Promise<unknown>, success: string): void => {
    void (async () => {
      try {
        await action()
        status = success
      } catch (error) {
        status = copy.actionFailed(describe(error))
      }
      render()
    })()
  }

  const subjectAction = (action: () => void | Promise<void>, success: string): void => {
    void (async () => {
      try {
        await action()
        status = `${success} ${copy.reloadPending}`
      } catch (error) {
        status = copy.actionFailed(describe(error))
      }
      render()
    })()
  }

  const selectSubject = (entry: WebExtensionSubjectEntry, subjectId: string): void => {
    activeExtensionId = entry.id
    activeSubjectId = subjectId
    subjectHistory.reset(subjectId)
    render()
  }

  const renderExtensionSubjectTree = (): HTMLElement | undefined => {
    const catalog = options.extensionSubjects?.()
    if (catalog === undefined) return undefined

    element(root, 'h3', { text: copy.subjects })
    element(root, 'p', {
      part: 'settings.description',
      text: copy.subjectsDescription,
    })
    const list = element(root, 'div', { part: 'settings.list' })
    for (const entry of catalog.entries) {
      const extension = entry.projection.extension
      const item = element(list, 'details', { part: 'settings.extension' }) as HTMLDetailsElement
      item.open = entry.id === activeExtensionId
      const summary = documentRef.createElement('summary')
      const state = documentRef.createElement('span')
      state.textContent = extension.enabled ? '●' : '○'
      state.setAttribute('aria-label', extension.enabled ? copy.enabled : copy.disabled)
      const label = documentRef.createElement('span')
      label.dataset['mkPart'] = 'settings.label'
      label.textContent = extension.displayName
      summary.addEventListener('click', () => {
        selectSubject(entry, extension.subjectId)
      })
      summary.append(state, documentRef.createTextNode(' '), label)
      item.append(summary)
      if (options.setExtensionEnabled !== undefined) {
        button(item, 'settings.add', entry.configuredEnabled ? copy.disable : copy.enable, () =>
          subjectAction(
            () => options.setExtensionEnabled?.(entry.id, !entry.configuredEnabled),
            `${entry.configuredEnabled ? copy.disabled : copy.enabled} ${extension.displayName}.`,
          ),
        )
      }
      if (entry.configuredEnabled && !extension.enabled) {
        element(item, 'span', {
          part: 'settings.description',
          text: copy.packageDisabled,
        })
      }

      for (const group of entry.projection.contractGroups) {
        const contract = documentRef.createElement('details')
        contract.open = true
        contract.dataset['mkPart'] = 'settings.row'
        const contractSummary = documentRef.createElement('summary')
        contractSummary.textContent = contributionContractLabel(localizer, group.key)
        contractSummary.title = localizer.text('extensions.tooltip.exactContract', {
          contract: group.key,
        })
        contract.append(contractSummary)
        for (const contribution of group.contributions) {
          const row = element(contract, 'div', { part: 'settings.extension' })
          const openContribution = documentRef.createElement('button')
          openContribution.type = 'button'
          openContribution.dataset['mkPart'] = 'settings.label'
          openContribution.textContent = `${contribution.effectiveEnabled ? '●' : '○'} ${contribution.displayName}`
          openContribution.setAttribute(
            'aria-label',
            `${contribution.displayName}, ${contribution.effectiveEnabled ? copy.enabled : copy.disabled}`,
          )
          openContribution.addEventListener('click', () =>
            selectSubject(entry, contribution.subjectId),
          )
          row.append(openContribution)
          if (options.setContributionEnabled !== undefined) {
            button(row, 'settings.add', contribution.enabled ? copy.disable : copy.enable, () =>
              subjectAction(
                () => options.setContributionEnabled?.(contribution.id, !contribution.enabled),
                `${contribution.enabled ? copy.disabled : copy.enabled} ${contribution.displayName}.`,
              ),
            )
          }
        }
        item.append(contract)
      }
      list.append(item)
    }
    if (catalog.entries.length === 0) {
      element(list, 'p', {
        part: 'settings.description',
        text: copy.emptySubjects,
      })
    }
    const cardHost = documentRef.createElement('div')
    cardHost.className = 'web-extension-subject-card'
    root.append(cardHost)
    return cardHost
  }

  const renderActiveSubjectCard = (host: HTMLElement): void => {
    const catalog = options.extensionSubjects?.()
    const entry =
      activeExtensionId === undefined ? undefined : catalog?.extension(activeExtensionId)
    if (entry === undefined || activeSubjectId === undefined) return
    const requestedSubjectId = activeSubjectId
    const revision = ++cardRevision
    void (async () => {
      try {
        const bundle = await webExtensionSubjectCardBundle(entry, requestedSubjectId)
        if (revision !== cardRevision || !host.isConnected) return
        const documents = new Map(
          bundle.documents.map(document => [document.subject.subjectId, document]),
        )
        const active = documents.get(requestedSubjectId)
        if (active === undefined) throw new Error(`unknown extension subject ${requestedSubjectId}`)
        const sections = await loadSubjectCardSections(subjectFactsSourceFromWire(active), {
          localizer,
        })
        if (revision !== cardRevision || !host.isConnected) return
        const toolbar = documentRef.createElement('div')
        toolbar.dataset['mkPart'] = 'settings.adder'
        const historyBack = button(toolbar, 'settings.add', '←', () => {
          const subjectId = subjectHistory.back()
          if (subjectId === undefined || !documents.has(subjectId)) return
          activeSubjectId = subjectId
          render()
        }) as HTMLButtonElement
        historyBack.disabled = !subjectHistory.canBack
        historyBack.setAttribute('aria-label', localizer.text('card.historyBack'))
        const historyForward = button(toolbar, 'settings.add', '→', () => {
          const subjectId = subjectHistory.forward()
          if (subjectId === undefined || !documents.has(subjectId)) return
          activeSubjectId = subjectId
          render()
        }) as HTMLButtonElement
        historyForward.disabled = !subjectHistory.canForward
        historyForward.setAttribute('aria-label', localizer.text('card.historyForward'))
        const subject = active.subject
        if (
          subject.kind === 'modkit/contribution' &&
          options.setContributionEnabled !== undefined
        ) {
          button(
            toolbar,
            'settings.add',
            subject.enabled ? copy.disableContribution : copy.enableContribution,
            () =>
              subjectAction(
                () => options.setContributionEnabled?.(subject.id, !subject.enabled),
                `${subject.enabled ? copy.disabled : copy.enabled} ${subject.displayName}.`,
              ),
          )
        } else if (
          subject.kind === 'modkit/extension' &&
          options.setExtensionEnabled !== undefined
        ) {
          button(
            toolbar,
            'settings.add',
            entry.configuredEnabled ? copy.disableExtension : copy.enableExtension,
            () =>
              subjectAction(
                () => options.setExtensionEnabled?.(entry.id, !entry.configuredEnabled),
                `${entry.configuredEnabled ? copy.disabled : copy.enabled} ${subject.displayName}.`,
              ),
          )
        }
        activeCard?.destroy()
        const navigate = (ref: CardRef): void => {
          if (ref.href !== undefined && documents.has(ref.href)) {
            subjectHistory.open(ref.href)
            activeSubjectId = ref.href
            render()
          }
        }
        activeCard = createSubjectCard(documentRef, {
          localizer,
          label: active.subject.displayName,
          sections,
          onNavigate: navigate,
        })
        host.replaceChildren(toolbar, activeCard.root)
      } catch (error) {
        if (revision !== cardRevision || !host.isConnected) return
        element(host, 'p', {
          part: 'settings.status',
          text: copy.cardFailed(describe(error)),
        })
      }
    })()
  }

  const renderManagedExtensions = (): void => {
    const controller = options.managedExtensions
    if (controller === undefined) return
    const model = controller.snapshot()
    element(root, 'h3', { text: copy.downloadable })
    element(root, 'p', {
      part: 'settings.description',
      text: copy.downloadableDescription,
    })
    const catalogActions = element(root, 'div', { part: 'settings.adder' })
    button(catalogActions, 'settings.add', copy.checkAvailable, () =>
      managedAction(() => controller.refreshCatalog(), copy.catalogChecked(model.catalogLocation)),
    )
    element(catalogActions, 'span', {
      part: 'settings.description',
      text: model.catalogLoaded
        ? copy.catalogLoaded(model.catalogLocation)
        : copy.catalogNotContacted(model.catalogLocation),
    })

    const list = element(root, 'div', { part: 'settings.list' })
    for (const row of model.rows) {
      const item = element(list, 'div', { part: 'settings.extension' })
      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', { part: 'settings.label', text: row.name })
      const states = [
        row.available
          ? `${localizer.text('extensions.group.available')} ${row.availableVersion ?? ''}`.trim()
          : copy.notInCatalog,
        row.installed
          ? `${localizer.text('extensions.group.installed')} ${row.installedVersion ?? ''}`.trim()
          : copy.notInstalled,
        row.installed ? (row.enabled ? copy.enabled : copy.disabled) : undefined,
        row.updateAvailable ? copy.updateAvailable : undefined,
      ].filter((value): value is string => value !== undefined)
      element(text, 'div', { part: 'settings.description', text: states.join(' · ') })
      if (row.description !== undefined) {
        element(text, 'div', { part: 'settings.description', text: row.description })
      }
      element(text, 'div', {
        part: 'settings.description',
        text: `${row.trusted ? copy.trusted : copy.notTrusted}: ${row.trustReason}`,
      })

      if (!row.installed && row.available) {
        const install = button(item, 'settings.add', copy.install, () =>
          managedAction(() => controller.install(row.id), copy.installedStatus(row.name)),
        )
        if (!row.trusted) {
          install.setAttribute('disabled', '')
          install.setAttribute('title', row.trustReason)
        }
      }
      if (row.installed && row.updateAvailable) {
        const update = button(item, 'settings.add', copy.update, () =>
          managedAction(() => controller.update(row.id), copy.updatedStatus(row.name)),
        )
        if (!row.trusted) {
          update.setAttribute('disabled', '')
          update.setAttribute('title', row.trustReason)
        }
      }
      if (row.installed) {
        button(item, 'settings.add', row.enabled ? copy.disable : copy.enable, () =>
          managedAction(
            () => controller.enable(row.id, !row.enabled),
            `${row.enabled ? copy.disabled : copy.enabled} ${row.name}. ${copy.reloadPending}`,
          ),
        )
        button(item, 'settings.remove', copy.remove, () =>
          managedAction(() => controller.remove(row.id), copy.removedStatus(row.name)),
        )
      }
    }
    if (model.rows.length === 0) {
      element(root, 'p', {
        part: 'settings.description',
        text: model.catalogLoaded ? copy.catalogEmpty : copy.noDownloaded,
      })
    }
  }

  function render(): void {
    cardRevision += 1
    activeCard?.destroy()
    activeCard = undefined
    root.replaceChildren()
    element(root, 'h2', { text: copy.title })
    element(root, 'p', { part: 'settings.description', text: copy.trustSentence })
    element(root, 'p', { part: 'settings.description', text: copy.provenanceNote })

    const adder = element(root, 'div', { part: 'settings.adder' })
    button(adder, 'settings.add', copy.addFolder, add)
    element(adder, 'span', {
      part: 'settings.description',
      text: copy.remembered(options.store.location),
    })

    const subjectCardHost = renderExtensionSubjectTree()

    const rows = describeExtensionList(
      {
        catalog: options.catalog,
        loaded,
        stored,
        ...(options.conflicts === undefined ? {} : { extraFailures: options.conflicts() }),
      },
      localizer,
    )
    const list = element(root, 'div', { part: 'settings.list' })
    for (const row of rows) {
      const item = element(list, 'div', { part: 'settings.extension' })
      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', {
        part: 'settings.label',
        text: row.coordinate ?? row.label,
      })
      element(text, 'div', { part: 'settings.description', text: row.provenance })
      if (row.code !== undefined) {
        element(text, 'div', {
          part: 'settings.description',
          text: `${row.code}: ${row.detail ?? ''}`,
        })
      }
      if (row.kind === 'user' && row.rootId !== undefined) {
        const rootId = row.rootId
        if (row.state === 'needs-permission') {
          button(item, 'settings.add', copy.grantAccess, () => grant(rootId))
        }
        button(item, 'settings.remove', copy.remove, () => remove(rootId))
      }
    }

    if (rows.every(row => row.kind === 'bundled')) {
      element(root, 'p', {
        part: 'settings.description',
        text: copy.emptyFolders,
      })
    }
    renderManagedExtensions()
    element(root, 'p', { part: 'settings.status', text: status })
    if (subjectCardHost !== undefined) renderActiveSubjectCard(subjectCardHost)
  }

  render()
  return {
    root,
    setLocalizer(nextLocalizer) {
      localizer = nextLocalizer
      copy = extensionCopy(nextLocalizer)
      render()
    },
    reload,
    current: () => loaded,
  }
}
