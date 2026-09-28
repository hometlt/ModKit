/**
 * Files of a game's confirmed installation, offered by a desktop host through
 * `ContributionContext.installationFiles`: what a game keeps outside its archives and a codec or
 * provider must read (Diablo III's type registry, in its executable). Read-only, by a path under
 * the installation root, a range at a time; nothing outside the root, and no listing. The host
 * chooses the installation (the one the user selected or discovery confirmed); a host that knows
 * none, or a browser, offers no such port and a contribution reports the file unavailable.
 */

export interface InstallationFileRequest {
  /** The game whose installation is read (`blizzard/diablo-3`). */
  readonly gameId: string
  /** `/`-separated, relative to the installation root (`x64/Diablo III64.exe`). */
  readonly path: string
  readonly signal?: AbortSignal
}

export interface InstallationFileRangeRequest extends InstallationFileRequest {
  readonly offset: number
  /** Bytes read at most; the host bounds one read (64 MiB) and a read never passes the file's end. */
  readonly length: number
}

export interface InstallationFiles {
  /** The file's size in bytes, or `undefined` when the installation or the file is not there. */
  size(request: InstallationFileRequest): Promise<number | undefined>
  read(request: InstallationFileRangeRequest): Promise<Uint8Array>
}
