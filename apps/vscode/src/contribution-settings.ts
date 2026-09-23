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
 * contribution id, for anything a contribution wants to keep between windows. A contribution that
 * knows none of these keys is unaffected — it never reads them.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

import type { ContributionSettings } from '@modkit/sdk'

export interface ContributionSettingsOptions {
  /** Raw value of `modkit.contributionSettings`, exactly as the editor returned it. */
  readonly configured?: unknown
  /** Root of the host's own storage; each contribution gets a subdirectory of it. */
  readonly cacheDirectory?: string
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

  const cache = new Map<string, ContributionSettings | undefined>()
  const settingsFor = (contributionId: string): ContributionSettings | undefined => {
    if (cache.has(contributionId)) return cache.get(contributionId)
    const entry = byContribution.get(contributionId)
    const values: Record<string, unknown> = {
      ...(entry?.values ?? {}),
      // Host-owned: a contribution is told where it may write, never asked.
      ...(options.cacheDirectory === undefined
        ? {}
        : { cacheDirectory: directoryFor(options.cacheDirectory, contributionId) }),
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
