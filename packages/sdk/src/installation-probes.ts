/**
 * Read-only probes of where a platform installed a game, offered by a trusted desktop host to a
 * `common.game/installation` provider through its ContributionContext. One implementation lives in
 * the host (`@modkit/host/node`); a provider no longer shells out to `reg.exe` or parses Steam files
 * itself, and a browser host simply offers none. Game-specific marker validation stays with the game.
 * Every answer is `undefined` (or an empty record) when the platform, key or product is absent.
 */
import type { CredentialPort } from './credentials.js'
import type { IndexCacheSwitches } from './index-caches.js'
import type { ContractResolverPort } from './service-contracts.js'

export type RegistryHive = 'HKLM' | 'HKCU'

/**
 * A per-user or machine folder a game keeps its documents, data or launcher state in:
 * `roaming-app-data` is `%APPDATA%` (`.minecraft`, Bedrock GDK `Minecraft Bedrock`),
 * `local-app-data` is `%LOCALAPPDATA%`, `home` the user's home directory (`~/.minecraft`).
 */
export type KnownFolder =
  'documents' | 'program-data' | 'roaming-app-data' | 'local-app-data' | 'home'

export interface InstallationProbes {
  /**
   * Values under one registry key (`SOFTWARE\\Blizzard Entertainment\\StarCraft II`) as strings:
   * REG_SZ as is, REG_EXPAND_SZ unexpanded, DWORD/QWORD as `0x…`, REG_BINARY as lowercase hex digits.
   */
  registryValues(
    hive: RegistryHive,
    key: string,
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, string>>>
  /** A Steam app's install folder: libraryfolders.vdf → appmanifest_<id>.acf → steamapps/common/<dir>. */
  steamAppDir(appId: number, signal?: AbortSignal): Promise<string | undefined>
  /** An Epic Games Store install location, from the launcher's manifests by AppName. */
  epicInstallLocation(appName: string, signal?: AbortSignal): Promise<string | undefined>
  /** A GOG Galaxy install path by product id. */
  gogInstallPath(productId: string, signal?: AbortSignal): Promise<string | undefined>
  /** A Microsoft Store package's install location by package family name. */
  storePackageLocation(familyName: string, signal?: AbortSignal): Promise<string | undefined>
  /** The user's Documents folder (as the shell resolves it, even when moved) or ProgramData. */
  knownFolder(folder: KnownFolder, signal?: AbortSignal): Promise<string | undefined>
}

/** What a trusted host hands a content-source module beside its options. */
export interface ContentSourceModuleContext {
  readonly installationProbes?: InstallationProbes
  /** The credential broker's port for the module's own extension (its declared credentials). */
  readonly credentials?: CredentialPort
  /**
   * Host-authorized service resolution for this module's extension (for example an optional
   * compression decoder). Modules release each acquired lease; the host owns the resolver
   * and keeps it alive until the content sources have been disposed. Absent on hosts without
   * service resolution; never construct a decoder or bypass the activation gate as a fallback.
   */
  readonly contracts?: ContractResolverPort
  /** The host's one directory of index caches (see `index-caches.ts`), shared with codecs. */
  readonly indexCacheDirectory?: string
  /** The user's index cache switches per product; read them with `indexCacheEnabled`. */
  readonly indexCaches?: IndexCacheSwitches
  /**
   * The host's language of a file by its path, over the language routes of the host's inventory
   * (`@modkit/host/language` `createLanguageFileClassifier`): a module that reads language
   * documents itself — a mod server's language sets — classifies them as the host's language
   * snapshot does. `candidates` lists the languages an ambiguous route claims.
   */
  readonly languageFiles?: (path: string) => {
    readonly languageId?: string
    readonly dialect?: string
    readonly candidates: readonly string[]
  }
}
