/**
 * Host-neutral contracts for game identity, installation candidates, and installation evidence.
 *
 * Nothing in this module touches the filesystem, a process, or the OS registry — those live in
 * `@modkitx/games/node`. Every shape here must stay JSON-serializable so it can cross a VS Code
 * webview or browser boundary.
 */

/**
 * Stable game coordinate: the same `<publisher>/<local-id>` shape codec manifests use (see
 * `codecManifestCoordinate` in `@modkitx/assets`), e.g. `org.modkitx/starcraft-2`. A detected
 * installation is correlated with its game's codec manifest and `resolveGameContributions()`
 * output through this one coordinate scheme — there is no second identity scheme here.
 */
export type GameCoordinate = string

/** Statically known metadata about a supported game, registered by a host or codec package. */
export interface GameDescriptor {
  /** Stable `<publisher>/<local-id>` coordinate, matching the game's codec manifest. */
  readonly coordinate: GameCoordinate
  /** Local ID segment of the coordinate (matches the codec manifest `id` field). */
  readonly id: string
  readonly displayName: string
}

/** Where an installation candidate's evidence originated. */
export const INSTALL_CANDIDATE_ORIGINS = [
  'registry',
  'default-directory',
  'configured-path',
  'steam',
  'epic',
] as const

export type InstallCandidateOrigin = (typeof INSTALL_CANDIDATE_ORIGINS)[number]

/**
 * Pre-verification evidence: a place worth probing, not yet confirmed to actually contain the
 * game. Analogous to `InstallCandidate`/`DetectedGameInstall` in the legacy Node-only discovery
 * files, but host-neutral — this is the shape, not the filesystem/registry access that produces
 * it.
 */
export interface InstallCandidate {
  readonly origin: InstallCandidateOrigin
  readonly displayName: string
  readonly path: string
  readonly appId?: string
  readonly manifestPath?: string
}

/** One structured, "what evidence was found" record — never a bare boolean. */
export interface InstallEvidenceEntry {
  readonly kind: string
  readonly path: string
  readonly found: boolean
  readonly detail?: string
}

/**
 * The deterministic, structured result of actually probing one candidate. JSON-serializable: no
 * functions or class instances, so it can cross a VS Code webview or browser boundary later.
 */
export interface GameInstallEvidence {
  readonly coordinate: GameCoordinate
  readonly candidate: InstallCandidate
  readonly confirmed: boolean
  readonly installPath?: string
  readonly contentRoots?: readonly string[]
  readonly version?: string
  readonly buildName?: string
  readonly buildUid?: string
  readonly evidence: readonly InstallEvidenceEntry[]
}

/**
 * Injected capability used to turn candidates into confirmed evidence. Node-only implementations
 * live in `@modkitx/games/node`; this interface itself has no `node:*` imports.
 */
export interface GameInstallProbe {
  /** Enumerate installation candidates for one registered game. */
  listCandidates(coordinate: GameCoordinate): Promise<readonly InstallCandidate[]>
  /** Probe one candidate and return deterministic, structured evidence. */
  probeCandidate(
    coordinate: GameCoordinate,
    candidate: InstallCandidate,
  ): Promise<GameInstallEvidence>
}

/** Stable export a manifest-declared `installProbe` module exposes. */
export const GAME_INSTALL_PROBE_FACTORY_EXPORT = 'createGameInstallProbe' as const

/** No-argument production factory loaded lazily from a game manifest's install-probe entrypoint. */
export type GameInstallProbeFactory = () => GameInstallProbe

/** Module namespace contract for a manifest-declared game installation probe. */
export interface GameInstallProbeModule {
  readonly createGameInstallProbe: GameInstallProbeFactory
}

/** Input accepted by `openInstall` — either raw evidence or a bare path a caller already trusts. */
export type OpenInstallInput = GameInstallEvidence | { readonly path: string }

/** Result of acknowledging/selecting an install. Validates and normalizes only — no side effects. */
export interface OpenedInstall {
  readonly path: string
  readonly normalizedPath: string
  readonly evidence?: GameInstallEvidence
}

/** Manifest operation implemented by a game runtime that can open an installation. */
export const GAME_OPEN_INSTALL_OPERATION = 'game.open-install' as const

/** Stable named export expected from a runtime that declares {@link GAME_OPEN_INSTALL_OPERATION}. */
export const GAME_INSTALL_OPENER_EXPORT = 'openGameInstall' as const

/** Input passed to a catalog-loaded game installation opener. */
export interface GameInstallOpenRequest {
  readonly input: OpenInstallInput
  /** Codec-owned options. Hosts treat this value as opaque and the selected game validates it. */
  readonly options?: unknown
}

/**
 * Open installation plus its live Node-host resource. The resource deliberately remains unknown
 * here: concrete games may expose an archive reader, VFS mount, workspace, or another host-owned
 * capability without making the browser-safe games contract depend on those packages.
 */
export interface GameInstallOpenResult {
  readonly install: OpenedInstall
  readonly resourceKind: string
  readonly resource: unknown
}

export type GameInstallOpener = (request: GameInstallOpenRequest) => Promise<GameInstallOpenResult>
