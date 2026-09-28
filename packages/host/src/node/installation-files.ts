/**
 * `ContributionContext.installationFiles` of a desktop host: a game installation's own files, read
 * by path under its root. The application says which installation a game has (the one the user
 * selected, or discovery confirmed); a path that leaves the root, through `..` or a link, is refused,
 * and nothing is listed. Read-only; one read is at most 64 MiB.
 */
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  InstallationFileRangeRequest,
  InstallationFileRequest,
  InstallationFiles,
} from '@modkit/sdk'

const MAX_READ_BYTES = 64 * 1024 * 1024

export interface NodeInstallationFilesOptions {
  /** The root of the game's installation, or `undefined` when the host knows none. */
  readonly installationOf: (
    gameId: string,
    signal?: AbortSignal,
  ) => string | undefined | Promise<string | undefined>
}

export function createNodeInstallationFiles(
  options: NodeInstallationFilesOptions,
): InstallationFiles {
  /** The real path of a file inside the game's installation, or `undefined` when there is none. */
  const locate = async (request: InstallationFileRequest): Promise<string | undefined> => {
    request.signal?.throwIfAborted()
    const root = await options.installationOf(request.gameId, request.signal)
    if (root === undefined) return undefined
    const segments = request.path.split(/[\\/]+/u).filter(segment => segment !== '')
    if (segments.length === 0 || segments.some(segment => segment === '..' || segment === '.'))
      throw new RangeError(`installation path «${request.path}» must name a file under the root`)
    const realRoot = await realpath(resolve(root)).catch(() => undefined)
    if (realRoot === undefined) return undefined
    const real = await realpath(resolve(realRoot, ...segments)).catch(() => undefined)
    if (real === undefined) return undefined
    // a link that leads out of the installation is not its file
    const inside = relative(realRoot, real)
    if (inside === '' || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside))
      throw new RangeError(`installation path «${request.path}» leaves the installation`)
    return real
  }
  return Object.freeze({
    async size(request: InstallationFileRequest): Promise<number | undefined> {
      const path = await locate(request)
      if (path === undefined) return undefined
      const info = await stat(path)
      return info.isFile() ? info.size : undefined
    },
    async read(request: InstallationFileRangeRequest): Promise<Uint8Array> {
      if (!Number.isSafeInteger(request.offset) || request.offset < 0)
        throw new RangeError('an installation file read starts at a non-negative offset')
      if (
        !Number.isSafeInteger(request.length) ||
        request.length < 0 ||
        request.length > MAX_READ_BYTES
      )
        throw new RangeError(`an installation file read is 0..${MAX_READ_BYTES} bytes`)
      const path = await locate(request)
      if (path === undefined)
        throw new RangeError(`${request.gameId} has no installation file «${request.path}»`)
      const handle = await open(path, 'r')
      try {
        const { size } = await handle.stat()
        const length = Math.max(0, Math.min(request.length, size - request.offset))
        const bytes = new Uint8Array(length)
        let filled = 0
        while (filled < length) {
          request.signal?.throwIfAborted()
          const { bytesRead } = await handle.read(
            bytes,
            filled,
            length - filled,
            request.offset + filled,
          )
          if (bytesRead === 0) break
          filled += bytesRead
        }
        // a buffer of its own: the worker boundary refuses a view into a larger one
        return filled === length ? bytes : bytes.slice(0, filled)
      } finally {
        await handle.close()
      }
    },
  })
}
