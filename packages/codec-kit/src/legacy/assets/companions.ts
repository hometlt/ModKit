/**
 * Companion (sidecar) request and declaration contracts.
 *
 * Companions are declared and resolved through sources, never guessed from arbitrary global
 * filesystem scans (`ASSET_CAPABILITIES.md` design rule 7). {@link CompanionSpec} is the
 * declaration; {@link import('./descriptor.js').CompanionDescriptor} is its resolved state on a
 * concrete asset.
 */

export interface AssetRequest {
  /** Name or relative path as referenced by a codec, e.g. "unittem.pal". */
  path: string
  /** Optional role so hosts can search the right resource pool. */
  role?: string
}

export interface AssetResolver {
  /** Resolve one companion to bytes, or undefined when not found. */
  resolve(request: AssetRequest): Promise<Uint8Array | undefined> | Uint8Array | undefined
  /** List candidate companions for picker/default selection. */
  list?(pattern: string, role?: string): Promise<string[]> | string[]
}

export interface CompanionSpec {
  role: string
  patterns: readonly string[]
  required: boolean
  selectable?: boolean
  description?: string
}
