/**
 * Generic VS Code workbench workflows, kept free of the `vscode` module.
 *
 * These are policy and state transitions which all editor adapters need: bounded container search
 * and extraction, selected content roots, a readable diagnostic journal, and the accepted mapping
 * from the old focused views to the current host/presentation surfaces.  `extension.ts` only turns
 * their results into native pickers, documents and workspace writes.
 */

import { isAbsolute, relative, resolve } from 'node:path'

import type { GameInstallation } from '@modkit/sdk/games'

import type { ContainerIndex, ContainerNode } from './container-uri.js'

export const VSCODE_CONTAINER_SEARCH_LIMIT = 200
export const VSCODE_MATERIALIZATION_LIMIT_BYTES = 64 * 1024 * 1024

export interface ContainerSearchHit {
  readonly path: string
  readonly node: ContainerNode
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

/** Case-insensitive, path-aware search with a hard result ceiling. */
export function searchContainerIndex(
  index: ContainerIndex,
  query: string,
  limit = VSCODE_CONTAINER_SEARCH_LIMIT,
): readonly ContainerSearchHit[] {
  const needle = query.trim().replaceAll('\\', '/').toLowerCase()
  if (needle.length === 0) return Object.freeze([])
  const requested = Number.isSafeInteger(limit) && limit > 0 ? limit : VSCODE_CONTAINER_SEARCH_LIMIT
  const ceiling = Math.min(VSCODE_CONTAINER_SEARCH_LIMIT, requested)
  const hits: ContainerSearchHit[] = []
  for (const [path, node] of [...index.files].sort(([left], [right]) => compareText(left, right))) {
    if (!path.toLowerCase().includes(needle)) continue
    hits.push(Object.freeze({ path, node }))
    if (hits.length === ceiling) break
  }
  return Object.freeze(hits)
}

/** Refuse a directory or an entry whose declared/read size exceeds the host materialization cap. */
export function assertMaterializationBound(
  entry: string,
  node: ContainerNode,
  observedBytes?: number,
  maximumBytes = VSCODE_MATERIALIZATION_LIMIT_BYTES,
): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new TypeError('materialization maximumBytes must be a positive safe integer')
  }
  if (node.kind !== 'file')
    throw new Error(`«${entry}» is a directory, not a materializable member`)
  if (observedBytes === undefined && node.size === undefined) {
    throw new Error(`«${entry}» declares no size, so bounded materialization is unavailable`)
  }
  const size = observedBytes ?? node.size
  if (size !== undefined && size > maximumBytes) {
    throw new Error(
      `«${entry}» is ${(size / (1024 * 1024)).toFixed(1)} MiB, over the ` +
        `${(maximumBytes / (1024 * 1024)).toFixed(0)} MiB materialization limit`,
    )
  }
}

export interface SelectedContentSource {
  readonly gameId: string
  readonly displayName: string
  readonly installPath: string
  readonly normalizedPath: string
  readonly version?: string
  readonly buildName?: string
  readonly buildUid?: string
  /** Bounded, provider-verified display facts; never used as game version or dependency identity. */
  readonly installationDetails?: readonly string[]
}

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

const nonBlank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

/** Admit inert single-line facts once for discovery and persisted selections; omit empty metadata. */
function boundedInstallationDetails(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined
  const details = [
    ...new Set(
      value
        .filter(
          (item): item is string =>
            typeof item === 'string' &&
            item.length <= 512 &&
            item.trim().length > 0 &&
            !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(item),
        )
        .map(item => item.trim()),
    ),
  ]
  return details.length === 0 ? undefined : Object.freeze(details)
}

/** Parse persisted source selections without trusting workspace state. */
export function selectedContentSources(value: unknown): readonly SelectedContentSource[] {
  if (!Array.isArray(value)) return Object.freeze([])
  const byPath = new Map<string, SelectedContentSource>()
  for (const item of value) {
    const row = recordOf(item)
    const gameId = nonBlank(row?.['gameId'])
    const displayName = nonBlank(row?.['displayName'])
    const installPath = nonBlank(row?.['installPath'])
    const normalizedPath = nonBlank(row?.['normalizedPath'])
    const version = nonBlank(row?.['version'])
    const buildName = nonBlank(row?.['buildName'])
    const buildUid = nonBlank(row?.['buildUid'])
    const installationDetails = boundedInstallationDetails(row?.['installationDetails'])
    if (
      gameId === undefined ||
      displayName === undefined ||
      installPath === undefined ||
      normalizedPath === undefined
    ) {
      continue
    }
    byPath.set(
      normalizedPath,
      Object.freeze({
        gameId,
        displayName,
        installPath,
        normalizedPath,
        ...(version === undefined ? {} : { version }),
        ...(buildName === undefined ? {} : { buildName }),
        ...(buildUid === undefined ? {} : { buildUid }),
        ...(installationDetails === undefined ? {} : { installationDetails }),
      }),
    )
  }
  return Object.freeze(
    [...byPath.values()].sort((a, b) => compareText(a.normalizedPath, b.normalizedPath)),
  )
}

export function withSelectedContentSource(
  current: readonly SelectedContentSource[],
  source: SelectedContentSource,
): readonly SelectedContentSource[] {
  return selectedContentSources([
    ...current.filter(item => item.normalizedPath !== source.normalizedPath),
    source,
  ])
}

export function withoutSelectedContentSource(
  current: readonly SelectedContentSource[],
  normalizedPath: string,
): readonly SelectedContentSource[] {
  return Object.freeze(current.filter(item => item.normalizedPath !== normalizedPath))
}

/** The selection stored for one provider-verified installation. */
export function selectedContentSource(installation: GameInstallation): SelectedContentSource {
  const installationDetails = boundedInstallationDetails(
    installation.evidence
      .filter(item => item.found && item.detail !== undefined)
      .slice(0, 16)
      .map(item => item.detail),
  )
  return Object.freeze({
    gameId: installation.gameId,
    displayName: installation.displayName,
    installPath: installation.installPath,
    normalizedPath: installation.normalizedPath,
    ...(installation.version === undefined ? {} : { version: installation.version }),
    ...(installation.buildName === undefined ? {} : { buildName: installation.buildName }),
    ...(installation.buildUid === undefined ? {} : { buildUid: installation.buildUid }),
    ...(installationDetails === undefined ? {} : { installationDetails }),
  })
}

/**
 * The installations a provider proved at the folder the user chose by hand. The same discovery also
 * reports what it found through the registry or default folders; those do not answer for the folder.
 */
export function installationsAtFolder(
  installations: readonly GameInstallation[],
  folder: string,
): readonly SelectedContentSource[] {
  return Object.freeze(
    installations
      .filter(
        item =>
          item.origins.includes('configured-path') &&
          relative(resolve(folder), resolve(item.installPath)) === '',
      )
      .map(selectedContentSource),
  )
}

/**
 * Game ids are extension facts, not an application allowlist.  This reads only the standard
 * installation-discovery offer facet, so a future game extension appears without a VS Code edit.
 */
export function installationGameIds(inventory: unknown): readonly string[] {
  return Object.freeze(
    [...new Set([...installationGameIdsByExtension(inventory).values()].flat())].sort(),
  )
}

/**
 * The installation an extension's content sources read: the selected one of a game that extension's
 * own installation discovery names. The offer facts say which game is whose; there is no game list.
 *
 * With none selected, a confirmed installation `found` without a choice: the one holding one of
 * `anchors` (a workspace folder, an open file), else the only one, as a map preview takes it (Core
 * `66a4733f`). v85: Arena.mmx inside RA2 with no installation chosen — no mod context, 0/36 resources.
 */
export function selectedInstallationDirectory(
  inventory: unknown,
  selected: readonly SelectedContentSource[],
  extension: string,
  found: {
    readonly installations: readonly SelectedContentSource[]
    readonly anchors: readonly string[]
  } = { installations: [], anchors: [] },
): string | undefined {
  const gameIds = installationGameIdsByExtension(inventory).get(extension) ?? []
  const chosen = selected.find(source => gameIds.includes(source.gameId))
  if (chosen !== undefined) return chosen.installPath
  const candidates = found.installations.filter(source => gameIds.includes(source.gameId))
  const holding = candidates.filter(source =>
    found.anchors.some(anchor => {
      const path = relative(resolve(source.installPath), resolve(anchor))
      return path === '' || (!path.startsWith('..') && !isAbsolute(path))
    }),
  )
  return (holding.length === 1 ? holding : candidates.length === 1 ? candidates : [])[0]
    ?.installPath
}

/**
 * The installations a game's map can be written for (a map encoder's catalog questions, WT10): those
 * of the games the encoding extensions discover, once each, in the order given (the chosen first).
 * The offer names formats, not games; with several games of one extension the person picks.
 */
export function encoderTargetInstallations(
  inventory: unknown,
  extensions: readonly string[],
  installations: readonly SelectedContentSource[],
): readonly SelectedContentSource[] {
  const byExtension = installationGameIdsByExtension(inventory)
  const games = new Set(extensions.flatMap(extension => byExtension.get(extension) ?? []))
  const seen = new Set<string>()
  return Object.freeze(
    installations.filter(source => {
      if (!games.has(source.gameId) || seen.has(source.normalizedPath)) return false
      seen.add(source.normalizedPath)
      return true
    }),
  )
}

/**
 * The regions a reference download signs in to first: those of the roots it downloads from that
 * declare a credential and are not connected yet. A region no download needs is left alone.
 */
export function regionsToConnect(
  sourceIds: readonly string[],
  roots: readonly { readonly id: string; readonly region: string }[],
  regions: readonly { readonly id: string; readonly credentialId?: string }[],
  connected: readonly string[],
): readonly string[] {
  const needed = new Set(sourceIds.map(id => roots.find(root => root.id === id)?.region))
  return regions
    .filter(
      region =>
        region.credentialId !== undefined &&
        needed.has(region.id) &&
        !connected.includes(region.id),
    )
    .map(region => region.id)
}

/**
 * The log level of one journal line. The product writes `[area] error …` and `[area] warning …`
 * (a diagnostic's own severity word); everything else is information.
 */
export function logLevelOf(line: string): 'error' | 'warning' | 'info' {
  const level = /^\[[^\]]+\] (error|warning)\b/u.exec(line)?.[1]
  return level === 'error' || level === 'warning' ? level : 'info'
}

/** Game-data locales the picker offers; `modkit.locale` also takes any other code. */
export const GAME_LOCALES: readonly string[] = Object.freeze([
  'enUS',
  'deDE',
  'esES',
  'esMX',
  'frFR',
  'itIT',
  'jaJP',
  'koKR',
  'plPL',
  'ptBR',
  'ruRU',
  'zhCN',
  'zhTW',
])

/**
 * Game-string locales in preference order (`modkit.locale`): the configured code, or when it is
 * empty the one VS Code's display language names (`ru` → `ruRU`, `pt-br` → `ptBR`), then enUS,
 * which every stock game package has. A viewer falls back along it to the first locale a mod has.
 */
export function gameLocales(configured: unknown, displayLanguage: string): readonly string[] {
  const code = typeof configured === 'string' ? configured.trim() : ''
  const [language = '', region = ''] = displayLanguage.toLowerCase().split('-')
  const fromDisplay = GAME_LOCALES.find(
    locale =>
      locale.slice(0, 2).toLowerCase() === language &&
      (region === '' || locale.slice(2).toLowerCase() === region),
  )
  const chosen =
    code === ''
      ? fromDisplay
      : (GAME_LOCALES.find(locale => locale.toLowerCase() === code.toLowerCase()) ?? code)
  return Object.freeze([...new Set([...(chosen === undefined ? [] : [chosen]), 'enUS'])])
}

/** The games one extension's installation discovery names (`publisher/id` of the extension). */
export function extensionInstallationGameIds(
  inventory: unknown,
  extension: string,
): readonly string[] {
  return Object.freeze([...(installationGameIdsByExtension(inventory).get(extension) ?? [])])
}

/** The extensions whose installation discovery names `gameId`, as the offer facts say. */
export function installationExtensions(inventory: unknown, gameId: string): readonly string[] {
  return Object.freeze(
    [...installationGameIdsByExtension(inventory)]
      .filter(([, games]) => games.includes(gameId))
      .map(([extension]) => extension),
  )
}

/** The installation-discovery game ids of each extension, keyed by its `publisher/id`. */
function installationGameIdsByExtension(
  inventory: unknown,
): ReadonlyMap<string, readonly string[]> {
  const byExtension = new Map<string, string[]>()
  const extensions = recordOf(inventory)?.['extensions']
  if (!Array.isArray(extensions)) return byExtension
  for (const extension of extensions) {
    const identity = recordOf(recordOf(extension)?.['manifest'])
    const key = `${String(identity?.['publisher'])}/${String(identity?.['id'])}`
    const contributions = recordOf(extension)?.['contributions']
    if (!Array.isArray(contributions)) continue
    for (const contribution of contributions) {
      const manifest = recordOf(recordOf(contribution)?.['manifest'])
      const provides = recordOf(manifest?.['spec'])?.['provides']
      if (!Array.isArray(provides)) continue
      for (const offer of provides) {
        const row = recordOf(offer)
        if (row?.['contract'] !== 'common.game/installation-discovery' || row['major'] !== 1)
          continue
        const gameIds = recordOf(row['facet'])?.['gameIds']
        if (!Array.isArray(gameIds)) continue
        for (const gameId of gameIds) {
          const id = nonBlank(gameId)
          if (id === undefined) continue
          const ids = byExtension.get(key) ?? []
          if (!ids.includes(id)) ids.push(id)
          byExtension.set(key, ids)
        }
      }
    }
  }
  return byExtension
}

/**
 * The folders `modkit.installationSearchFolders` names for the installation search: a plain name is
 * that folder at the root of every local drive (`Games`), anything else a folder as it is — a
 * network share only this way — with `%VARIABLE%` expanded from the environment.
 */
export function installationSearchFolders(
  value: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): { readonly driveFolders: readonly string[]; readonly folders: readonly string[] } {
  const driveFolders: string[] = []
  const folders: string[] = []
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string' || item.trim() === '') continue
    const expanded = item
      .trim()
      .replace(/%([^%]+)%/gu, (whole, name: string) => environment[name] ?? whole)
    if (/[\\/:]/u.test(expanded)) folders.push(expanded)
    else driveFolders.push(expanded)
  }
  return { driveFolders, folders }
}

/** A setting whose name says it holds a secret: its value never leaves the window. */
const SECRET_SETTING = /key|token|secret|passw|credential|ticket|cookie|auth/iu

/**
 * Settings as a diagnostics report may show them: every value under a name that sounds like a
 * secret (`apiKey` in `contributionSettings`, a key left in an old setting) is replaced, at any
 * depth. Sign-ins and keys live in the broker's SecretStorage, which a report never reads; this
 * catches what an extension or an old setting put beside the rest.
 */
export function redactedSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactedSettings)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [
      name,
      SECRET_SETTING.test(name) ? '[redacted]' : redactedSettings(item),
    ]),
  )
}

/** What «Export diagnostics» writes: one JSON a person can send, with no secret in it (plan 8.5). */
export function diagnosticsReport(input: {
  readonly createdAt: string
  readonly versions: Readonly<Record<string, string>>
  readonly settings: unknown
  readonly contentSources: readonly Readonly<Record<string, string>>[]
  readonly loadedMods: readonly { readonly id: string; readonly label: string }[]
  readonly journal: string
}): string {
  return `${JSON.stringify(
    {
      schema: 'modkit.vscode-diagnostics@1',
      createdAt: input.createdAt,
      versions: input.versions,
      settings: redactedSettings(input.settings),
      contentSources: input.contentSources,
      loadedMods: input.loadedMods.map(mod => ({ id: mod.id, label: mod.label })),
      journal: input.journal.split(/\r?\n/u).filter(line => line !== ''),
    },
    null,
    2,
  )}\n`
}

export interface DiagnosticJournal {
  append(line: string): void
  lines(): readonly string[]
  text(): string
}

/** A bounded, directly readable mirror of the Output channel. */
export function createDiagnosticJournal(maximumLines = 2_000): DiagnosticJournal {
  if (!Number.isSafeInteger(maximumLines) || maximumLines <= 0) {
    throw new TypeError('diagnostic journal maximumLines must be a positive safe integer')
  }
  const entries: string[] = []
  return Object.freeze({
    append(line: string) {
      entries.push(...line.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n'))
      if (entries.length > maximumLines) entries.splice(0, entries.length - maximumLines)
    },
    lines: () => Object.freeze([...entries]),
    text: () => `${entries.join('\n')}\n`,
  })
}

export type WorkbenchReplacementSurface =
  | 'native-explorer'
  | 'extensions-view'
  | 'host-view'
  | 'presentation:tree'
  | 'presentation:relations'
  | 'presentation:edit'
  | 'presentation:workbench'

export interface LegacyViewReplacement {
  readonly legacyViewId: string
  readonly surfaces: readonly WorkbenchReplacementSurface[]
  readonly reason: string
}

/** Machine-checkable replacement map for every focused view removed from the current manifest. */
export const VSCODE_LEGACY_VIEW_REPLACEMENTS: readonly LegacyViewReplacement[] = Object.freeze([
  Object.freeze({
    legacyViewId: 'modkitArchiveTree',
    surfaces: Object.freeze(['native-explorer'] as const),
    reason: 'Container members are mounted by the read-only modkit-container filesystem provider.',
  }),
  Object.freeze({
    legacyViewId: 'modkitGameCodecsTree',
    surfaces: Object.freeze(['extensions-view'] as const),
    reason: 'Loaded and refused codec contributions are shown by the generic Extensions view.',
  }),
  Object.freeze({
    legacyViewId: 'modkitModTree',
    surfaces: Object.freeze([
      'presentation:tree',
      'presentation:relations',
      'presentation:edit',
    ] as const),
    reason: 'The active subject publishes generic tree, relation and evidence-gated edit stages.',
  }),
  Object.freeze({
    legacyViewId: 'modkitView',
    surfaces: Object.freeze(['host-view'] as const),
    reason: 'Topology, facilities, sources and inventory health are native Host view rows.',
  }),
])
