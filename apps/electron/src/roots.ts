/**
 * Granted-root confinement for the Electron file broker.
 *
 * The explorer needs to name paths, which means the renderer sends strings the main process then
 * reads. Without a check that is an arbitrary-file-read primitive: a compromised or merely buggy
 * renderer could ask for `C:\Users\...\.ssh\id_rsa`.
 *
 * So a path is readable only when it sits inside a directory the user explicitly picked in a native
 * dialog. Grants live in the main process, never in the renderer, and nothing but the dialog adds
 * one.
 *
 * The comparison is deliberately done on resolved, normalised paths: `..` segments are collapsed
 * before the prefix test, so `root/../../secrets` cannot pass by looking like it starts with `root`.
 * The separator check matters too — without it `C:\data-private` would pass as a child of
 * `C:\data`.
 */

export interface GrantedRoots {
  /** Record a directory the user picked. Returns the normalised root. */
  grant(path: string): string
  /** True when `path` is the root itself or sits underneath one. */
  allows(path: string): boolean
  /** Throws unless `allows(path)`. Returns the resolved path to use. */
  require(path: string): string
  list(): readonly string[]
}

export interface PathTools {
  resolve(path: string): string
  readonly separator: string
  /** Windows paths are case-insensitive; POSIX ones are not. */
  readonly caseSensitive: boolean
}

export function createGrantedRoots(tools: PathTools): GrantedRoots {
  const roots: string[] = []
  const fold = (value: string): string => (tools.caseSensitive ? value : value.toLowerCase())

  const contains = (root: string, candidate: string): boolean => {
    const a = fold(root)
    const b = fold(candidate)
    if (a === b) return true
    // The separator guard: `C:\data` must not swallow `C:\data-private`.
    const prefix = a.endsWith(tools.separator) ? a : a + tools.separator
    return b.startsWith(prefix)
  }

  return {
    grant(path) {
      const resolved = tools.resolve(path)
      if (!roots.some(root => contains(root, resolved))) roots.push(resolved)
      return resolved
    },

    allows(path) {
      const resolved = tools.resolve(path)
      return roots.some(root => contains(root, resolved))
    },

    require(path) {
      const resolved = tools.resolve(path)
      if (!roots.some(root => contains(root, resolved))) {
        throw new Error(`path is outside every granted root: ${path}`)
      }
      return resolved
    },

    list() {
      return Object.freeze([...roots])
    },
  }
}
