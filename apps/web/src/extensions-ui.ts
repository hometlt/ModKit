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

import { subjectFactsSourceFromWire } from '@modkitx/extension-manager'
import {
  createSubjectCard,
  loadSubjectCardSections,
  type CardRef,
  type SubjectCard,
} from '@modkitx-x3/ui/card'
import { element, type PartName } from '@modkitx-x3/ui/viewer'
import type { BrowserSubtleCryptoLike } from '@modkitx-x3/host/browser'
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

const bundledProvenance = (root: string): string =>
  `Bundled with this build, served from ${root}; its digests were recorded when the app was built.`

const userProvenance = (label: string): string =>
  `Folder you granted («${label}»); its digests were computed by this page from the bytes it just read.`

/**
 * The rows the panel shows: bundled first (this host's own floor), then the folders the user
 * added, then every folder that did not load — with its code and message unedited, because a
 * user who picked the wrong folder needs the reason, not a shrug.
 */
export function describeExtensionList(input: ExtensionListInput): readonly ExtensionRow[] {
  const rows: ExtensionRow[] = []
  for (const entry of input.catalog.extensions) {
    const coordinate = containerCoordinate(entry.containers)
    rows.push({
      kind: 'bundled',
      state: 'loaded',
      label: entry.name,
      ...(coordinate === undefined ? {} : { coordinate }),
      provenance: bundledProvenance(entry.artifactRoot),
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
      provenance: userProvenance(label),
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
      provenance: userProvenance(label),
      code: failure.code,
      detail: failure.message,
    })
  }
  return Object.freeze(rows)
}

// ---------------------------------------------------------------------------------------------
// mounting

export interface ExtensionsUiOptions {
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
        status = `Added «${handle.name}»${coordinate === undefined ? '' : ` (${coordinate})`}.`
        await changed()
      } catch (error) {
        status = `Could not add that folder: ${describe(error)}`
        render()
      }
    })()
  }

  const remove = (rootId: string): void => {
    void (async () => {
      try {
        await options.store.remove(rootId)
        status = 'Removed. The extension is gone from the list; reload to rebuild the host.'
        await changed()
      } catch (error) {
        status = `Could not remove it: ${describe(error)}`
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
            ? `Access to «${record.label}» granted again.`
            : `Access to «${record.label}» was not granted (${state}).`
        await changed()
      } catch (error) {
        status = `Could not ask for access: ${describe(error)}`
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
        status = `Extension action failed: ${describe(error)}`
      }
      render()
    })()
  }

  const subjectAction = (action: () => void | Promise<void>, success: string): void => {
    void (async () => {
      try {
        await action()
        status = `${success} Reload the page to rebuild the running host.`
      } catch (error) {
        status = `Extension action failed: ${describe(error)}`
      }
      render()
    })()
  }

  const selectSubject = (entry: WebExtensionSubjectEntry, subjectId: string): void => {
    activeExtensionId = entry.id
    activeSubjectId = subjectId
    render()
  }

  const renderExtensionSubjectTree = (): HTMLElement | undefined => {
    const catalog = options.extensionSubjects?.()
    if (catalog === undefined) return undefined

    element(root, 'h3', { text: 'Installed extension subjects' })
    element(root, 'p', {
      part: 'settings.description',
      text:
        'These cards come from validated extension and contribution JSON. Contract rows are ' +
        'visual groups named by the exact declared contract id and major.',
    })
    const list = element(root, 'div', { part: 'settings.list' })
    for (const entry of catalog.entries) {
      const extension = entry.projection.extension
      const item = element(list, 'details', { part: 'settings.extension' }) as HTMLDetailsElement
      item.open = entry.id === activeExtensionId
      const summary = documentRef.createElement('summary')
      const state = documentRef.createElement('span')
      state.textContent = extension.enabled ? '●' : '○'
      state.setAttribute('aria-label', extension.enabled ? 'enabled' : 'disabled')
      const label = documentRef.createElement('span')
      label.dataset['mkPart'] = 'settings.label'
      label.textContent = extension.displayName
      summary.addEventListener('click', () => {
        selectSubject(entry, extension.subjectId)
      })
      summary.append(state, documentRef.createTextNode(' '), label)
      item.append(summary)
      if (options.setExtensionEnabled !== undefined) {
        button(item, 'settings.add', entry.configuredEnabled ? 'Disable' : 'Enable', () =>
          subjectAction(
            () => options.setExtensionEnabled?.(entry.id, !entry.configuredEnabled),
            `${entry.configuredEnabled ? 'Disabled' : 'Enabled'} ${extension.displayName}.`,
          ),
        )
      }
      if (entry.configuredEnabled && !extension.enabled) {
        element(item, 'span', {
          part: 'settings.description',
          text: 'The extension is enabled directly, but its distribution package is disabled.',
        })
      }

      for (const group of entry.projection.contractGroups) {
        const contract = documentRef.createElement('details')
        contract.open = true
        contract.dataset['mkPart'] = 'settings.row'
        const contractSummary = documentRef.createElement('summary')
        contractSummary.textContent = group.key
        contract.append(contractSummary)
        for (const contribution of group.contributions) {
          const row = element(contract, 'div', { part: 'settings.extension' })
          const openContribution = documentRef.createElement('button')
          openContribution.type = 'button'
          openContribution.dataset['mkPart'] = 'settings.label'
          openContribution.textContent = `${contribution.effectiveEnabled ? '●' : '○'} ${contribution.displayName}`
          openContribution.setAttribute(
            'aria-label',
            `${contribution.displayName}, ${contribution.effectiveEnabled ? 'enabled' : 'disabled'}`,
          )
          openContribution.addEventListener('click', () =>
            selectSubject(entry, contribution.subjectId),
          )
          row.append(openContribution)
          if (options.setContributionEnabled !== undefined) {
            button(row, 'settings.add', contribution.enabled ? 'Disable' : 'Enable', () =>
              subjectAction(
                () => options.setContributionEnabled?.(contribution.id, !contribution.enabled),
                `${contribution.enabled ? 'Disabled' : 'Enabled'} ${contribution.displayName}.`,
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
        text: 'The running host has no inventoried extension subjects.',
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
        const sections = await loadSubjectCardSections(subjectFactsSourceFromWire(active))
        if (revision !== cardRevision || !host.isConnected) return
        const toolbar = documentRef.createElement('div')
        toolbar.dataset['mkPart'] = 'settings.adder'
        const subject = active.subject
        if (
          subject.kind === 'org.modkitx/contribution' &&
          options.setContributionEnabled !== undefined
        ) {
          button(
            toolbar,
            'settings.add',
            subject.enabled ? 'Disable contribution' : 'Enable contribution',
            () =>
              subjectAction(
                () => options.setContributionEnabled?.(subject.id, !subject.enabled),
                `${subject.enabled ? 'Disabled' : 'Enabled'} ${subject.displayName}.`,
              ),
          )
        } else if (
          subject.kind === 'org.modkitx/extension' &&
          options.setExtensionEnabled !== undefined
        ) {
          button(
            toolbar,
            'settings.add',
            entry.configuredEnabled ? 'Disable extension' : 'Enable extension',
            () =>
              subjectAction(
                () => options.setExtensionEnabled?.(entry.id, !entry.configuredEnabled),
                `${entry.configuredEnabled ? 'Disabled' : 'Enabled'} ${subject.displayName}.`,
              ),
          )
        }
        activeCard?.destroy()
        const navigate = (ref: CardRef): void => {
          if (ref.href !== undefined && documents.has(ref.href)) {
            activeSubjectId = ref.href
            render()
          }
        }
        activeCard = createSubjectCard(documentRef, {
          label: active.subject.displayName,
          sections,
          onNavigate: navigate,
        })
        host.replaceChildren(toolbar, activeCard.root)
      } catch (error) {
        if (revision !== cardRevision || !host.isConnected) return
        element(host, 'p', {
          part: 'settings.status',
          text: `Could not open extension card: ${describe(error)}`,
        })
      }
    })()
  }

  const renderManagedExtensions = (): void => {
    const controller = options.managedExtensions
    if (controller === undefined) return
    const model = controller.snapshot()
    element(root, 'h3', { text: 'Downloadable extensions' })
    element(root, 'p', {
      part: 'settings.description',
      text:
        'The catalog is checked only when you ask. Installing stores verified package bytes; ' +
        'nothing on this page imports or runs them.',
    })
    const catalogActions = element(root, 'div', { part: 'settings.adder' })
    button(catalogActions, 'settings.add', 'Check available extensions', () =>
      managedAction(
        () => controller.refreshCatalog(),
        `Extension catalog checked at ${model.catalogLocation}.`,
      ),
    )
    element(catalogActions, 'span', {
      part: 'settings.description',
      text: model.catalogLoaded
        ? `Catalog loaded from ${model.catalogLocation}.`
        : `Catalog ${model.catalogLocation} has not been contacted in this session.`,
    })

    const list = element(root, 'div', { part: 'settings.list' })
    for (const row of model.rows) {
      const item = element(list, 'div', { part: 'settings.extension' })
      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', { part: 'settings.label', text: row.name })
      const states = [
        row.available ? `Available ${row.availableVersion ?? ''}`.trim() : 'Not in catalog',
        row.installed ? `Installed ${row.installedVersion ?? ''}`.trim() : 'Not installed',
        row.installed ? (row.enabled ? 'Enabled' : 'Disabled') : undefined,
        row.updateAvailable ? 'Update available' : undefined,
      ].filter((value): value is string => value !== undefined)
      element(text, 'div', { part: 'settings.description', text: states.join(' · ') })
      if (row.description !== undefined) {
        element(text, 'div', { part: 'settings.description', text: row.description })
      }
      element(text, 'div', {
        part: 'settings.description',
        text: `${row.trusted ? 'Trusted' : 'Not trusted'}: ${row.trustReason}`,
      })

      if (!row.installed && row.available) {
        const install = button(item, 'settings.add', 'Install', () =>
          managedAction(
            () => controller.install(row.id),
            `Installed ${row.name}. Reload the page to load the changed extension set.`,
          ),
        )
        if (!row.trusted) {
          install.setAttribute('disabled', '')
          install.setAttribute('title', row.trustReason)
        }
      }
      if (row.installed && row.updateAvailable) {
        const update = button(item, 'settings.add', 'Update', () =>
          managedAction(
            () => controller.update(row.id),
            `Updated ${row.name}. Reload the page to load the changed extension set.`,
          ),
        )
        if (!row.trusted) {
          update.setAttribute('disabled', '')
          update.setAttribute('title', row.trustReason)
        }
      }
      if (row.installed) {
        button(item, 'settings.add', row.enabled ? 'Disable' : 'Enable', () =>
          managedAction(
            () => controller.enable(row.id, !row.enabled),
            `${row.enabled ? 'Disabled' : 'Enabled'} ${row.name}. Reload the page to load the changed extension set.`,
          ),
        )
        button(item, 'settings.remove', 'Remove', () =>
          managedAction(
            () => controller.remove(row.id),
            `Removed ${row.name}. Reload the page to load the changed extension set.`,
          ),
        )
      }
    }
    if (model.rows.length === 0) {
      element(root, 'p', {
        part: 'settings.description',
        text: model.catalogLoaded
          ? 'The catalog contains no extensions.'
          : 'No downloaded extensions are installed. Check the catalog to see what is available.',
      })
    }
  }

  function render(): void {
    cardRevision += 1
    activeCard?.destroy()
    activeCard = undefined
    root.replaceChildren()
    element(root, 'h2', { text: 'Extensions' })
    element(root, 'p', { part: 'settings.description', text: USER_EXTENSION_TRUST_SENTENCE })
    element(root, 'p', { part: 'settings.description', text: USER_EXTENSION_PROVENANCE_NOTE })

    const adder = element(root, 'div', { part: 'settings.adder' })
    button(adder, 'settings.add', 'Add a folder…', add)
    element(adder, 'span', {
      part: 'settings.description',
      text: `Added folders are remembered in ${options.store.location}.`,
    })

    const subjectCardHost = renderExtensionSubjectTree()

    const rows = describeExtensionList({
      catalog: options.catalog,
      loaded,
      stored,
      ...(options.conflicts === undefined ? {} : { extraFailures: options.conflicts() }),
    })
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
          button(item, 'settings.add', 'Grant access', () => grant(rootId))
        }
        button(item, 'settings.remove', 'Remove', () => remove(rootId))
      }
    }

    if (rows.every(row => row.kind === 'bundled')) {
      element(root, 'p', {
        part: 'settings.description',
        text: 'No folders added yet.',
      })
    }
    renderManagedExtensions()
    element(root, 'p', { part: 'settings.status', text: status })
    if (subjectCardHost !== undefined) renderActiveSubjectCard(subjectCardHost)
  }

  render()
  return {
    root,
    reload,
    current: () => loaded,
  }
}
