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

import { element, type PartName } from '@modkitx-x3/ui'
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
import { catalogCoordinates, type WebExtensionCatalog } from './subjects.js'

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

function button(parent: HTMLElement, part: PartName, label: string, onClick: () => void): void {
  const node = element(parent, 'button', { part, text: label })
  node.setAttribute('type', 'button')
  node.addEventListener('click', onClick)
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
    serve: async url => ({
      ok: false,
      status: 404,
      arrayBuffer: () => Promise.reject(new Error(`404 ${url}`)),
    }),
  }
  let status = ''

  const loadOptions = () => ({
    subtle: options.subtle,
    claimed: catalogCoordinates(options.catalog),
    ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
    ...(options.maxTotalBytes === undefined ? {} : { maxTotalBytes: options.maxTotalBytes }),
  })

  const reload = async (): Promise<void> => {
    stored = await options.store.list()
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

  function render(): void {
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
    element(root, 'p', { part: 'settings.status', text: status })
  }

  render()
  return {
    root,
    reload,
    current: () => loaded,
  }
}
