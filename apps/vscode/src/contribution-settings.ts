/**
 * `modkit.contributionSettings` → the settings the host hands each contribution.
 *
 * One setting holds them all, keyed by contribution id, because the codecs and providers a window
 * has are discovered at runtime: a generated `configuration` property per contribution would be a
 * build-time list of something only the installed extensions know.
 *
 * ```jsonc
 * "modkit.contributionSettings": {
 *   "blizzard/casc": {
 *     "cacheIndex": true,                                  // every source of this contribution
 *     "bySource": {
 *       "file:///c%3A/Games/StarCraft II": { "cacheIndex": false }   // this installation only
 *     }
 *   }
 * }
 * ```
 *
 * The host adds `cacheDirectory` to every contribution: its own writable directory, one per
 * contribution id, for anything a contribution wants to keep between windows. It also adds the one
 * shared `indexCacheDirectory` (sdk `index-caches`), and turns `modkit.indexCaches` into
 * `games.<product>.cacheIndex`. A contribution that knows none of these keys is unaffected — it
 * never reads them.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { INDEX_CACHE_DIRECTORY_SETTING, type ContributionSettings } from '@modkit/sdk'

export interface ContributionSettingsOptions {
  /** Raw value of `modkit.contributionSettings`, exactly as the editor returned it. */
  readonly configured?: unknown
  /** Root of the host's own storage; each contribution gets a subdirectory of it. */
  readonly cacheDirectory?: string
  /** The host's one directory of index caches, shared by every contribution and content source. */
  readonly indexCacheDirectory?: string
  /** Raw value of `modkit.indexCaches`. */
  readonly indexCaches?: unknown
}

/** `modkit.indexCaches`: per game product, the index switches the user turned. Unset means on. */
export interface IndexCacheSwitches {
  readonly byProduct: ReadonlyMap<string, { readonly names?: boolean; readonly content?: boolean }>
  readonly problems: readonly string[]
}

export function configuredIndexCaches(value: unknown): IndexCacheSwitches {
  const byProduct = new Map<string, { names?: boolean; content?: boolean }>()
  const problems: string[] = []
  if (value !== undefined && value !== null && !isRecord(value))
    problems.push('modkit.indexCaches must be an object keyed by game product')
  for (const [product, entry] of Object.entries(isRecord(value) ? value : {})) {
    if (!isRecord(entry)) {
      problems.push(`modkit.indexCaches['${product}'] must be an object`)
      continue
    }
    const switches: { names?: boolean; content?: boolean } = {}
    for (const kind of ['names', 'content'] as const) {
      if (typeof entry[kind] === 'boolean') switches[kind] = entry[kind]
      else if (entry[kind] !== undefined)
        problems.push(`modkit.indexCaches['${product}'].${kind} must be true or false`)
    }
    byProduct.set(product, switches)
  }
  return Object.freeze({ byProduct, problems: Object.freeze(problems) })
}

/** Whether a product's index of this kind is kept; every index is, unless turned off. */
export function indexCacheEnabled(
  switches: IndexCacheSwitches,
  product: string | undefined,
  kind: 'names' | 'content',
): boolean {
  return product === undefined || switches.byProduct.get(product)?.[kind] !== false
}

export interface ContributionSettingsResult {
  readonly settingsFor: (contributionId: string) => ContributionSettings | undefined
  /** Malformed entries, reported like any other bad setting instead of being swallowed. */
  readonly problems: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A directory name for one contribution id: readable, and short enough for a deep path. */
function directoryFor(root: string, contributionId: string): string {
  const readable = contributionId.replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(0, 48)
  const digest = createHash('sha256').update(contributionId).digest('hex').slice(0, 8)
  return join(root, `${readable}-${digest}`)
}

export function configuredContributionSettings(
  options: ContributionSettingsOptions = {},
): ContributionSettingsResult {
  const problems: string[] = []
  const configured = options.configured
  const byContribution = new Map<string, { values: Record<string, unknown>; bySource?: Record<string, Record<string, unknown>> }>()
  if (configured !== undefined && configured !== null) {
    if (!isRecord(configured)) {
      problems.push('modkit.contributionSettings must be an object keyed by contribution id')
    } else {
      for (const [contributionId, entry] of Object.entries(configured)) {
        if (!isRecord(entry)) {
          problems.push(`modkit.contributionSettings['${contributionId}'] must be an object`)
          continue
        }
        const { bySource, ...values } = entry
        const overrides: Record<string, Record<string, unknown>> = {}
        if (bySource !== undefined) {
          if (!isRecord(bySource)) {
            problems.push(
              `modkit.contributionSettings['${contributionId}'].bySource must be an object keyed by source uri`,
            )
          } else {
            for (const [sourceUri, override] of Object.entries(bySource)) {
              if (!isRecord(override)) {
                problems.push(
                  `modkit.contributionSettings['${contributionId}'].bySource['${sourceUri}'] must be an object`,
                )
                continue
              }
              overrides[sourceUri] = { ...override }
            }
          }
        }
        byContribution.set(contributionId, {
          values,
          ...(Object.keys(overrides).length === 0 ? {} : { bySource: overrides }),
        })
      }
    }
  }

  const switches = configuredIndexCaches(options.indexCaches)
  problems.push(...switches.problems)
  // A name index the user turned off, as the per-game switch a codec reads (`games.<product>`).
  const nameSwitches = [...switches.byProduct].flatMap(([product, item]) =>
    item.names === undefined ? [] : [[product, item.names] as const],
  )

  const cache = new Map<string, ContributionSettings | undefined>()
  const settingsFor = (contributionId: string): ContributionSettings | undefined => {
    if (cache.has(contributionId)) return cache.get(contributionId)
    const entry = byContribution.get(contributionId)
    const declaredGames = entry?.values['games']
    const ownGames: Record<string, unknown> = isRecord(declaredGames) ? declaredGames : {}
    const games: Record<string, unknown> = { ...ownGames }
    for (const [product, cacheIndex] of nameSwitches) {
      // what the user wrote for this contribution wins over the switch for every contribution
      const own = ownGames[product]
      games[product] = { cacheIndex, ...(isRecord(own) ? own : {}) }
    }
    const values: Record<string, unknown> = {
      ...(entry?.values ?? {}),
      ...(nameSwitches.length === 0 ? {} : { games }),
      // Host-owned: a contribution is told where it may write, never asked.
      ...(options.cacheDirectory === undefined
        ? {}
        : { cacheDirectory: directoryFor(options.cacheDirectory, contributionId) }),
      ...(options.indexCacheDirectory === undefined
        ? {}
        : { [INDEX_CACHE_DIRECTORY_SETTING]: options.indexCacheDirectory }),
    }
    const resolved =
      Object.keys(values).length === 0 && entry?.bySource === undefined
        ? undefined
        : Object.freeze({
            values: Object.freeze(values),
            ...(entry?.bySource === undefined ? {} : { bySource: Object.freeze(entry.bySource) }),
          })
    cache.set(contributionId, resolved)
    return resolved
  }
  return Object.freeze({ settingsFor, problems: Object.freeze(problems) })
}
