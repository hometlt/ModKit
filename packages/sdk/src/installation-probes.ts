/**
 * Read-only probes of where a platform installed a game, offered by a trusted desktop host to a
 * `common.game/installation` provider through its ContributionContext. One implementation lives in
 * the host (`@modkit/host/node`); a provider no longer shells out to `reg.exe` or parses Steam files
 * itself, and a browser host simply offers none. Game-specific marker validation stays with the game.
 * Every answer is `undefined` (or an empty record) when the platform, key or product is absent.
 */
export type RegistryHive = 'HKLM' | 'HKCU'

export interface InstallationProbes {
  /** String values under one registry key (`SOFTWARE\\Blizzard Entertainment\\StarCraft II`). */
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
}
