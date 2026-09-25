/** Trusted, in-process preparation capability on a game's ContentSources.
 * A ModContext has live methods and leases, so it must never be serialized as a service value.
 * The host validates this local capability before a game-neutral Runtime workflow invokes it.
 */
import type {
  ContentDependencyResolution,
  ContentSources,
  ModContext,
} from '@modkit/vfs/content-sources'
import type { ResourceBudget } from '@modkit/sdk'
import type { RuntimeHostServices } from './index.js'

export const RUNTIME_PREPARER_MAJOR = 1 as const

export interface RuntimePreparationRequest {
  readonly context: ModContext
  readonly closure: ContentDependencyResolution
  readonly selection: unknown
  readonly services: RuntimeHostServices
  readonly budgets: ResourceBudget
  readonly quantizeFixed64Decimal: (value: string) => string
  readonly signal?: AbortSignal
}

export interface RuntimeCompositionPreparer {
  readonly major: typeof RUNTIME_PREPARER_MAJOR
  readonly gameId: string
  readonly adapter: Readonly<{ id: string; version: string }>
  prepare(request: RuntimePreparationRequest): Promise<unknown>
}

export type RuntimePreparerResolution =
  | Readonly<{ state: 'resolved'; preparer: RuntimeCompositionPreparer }>
  | Readonly<{ state: 'unavailable'; code: string; message: string }>

const ADAPTER_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\/[a-z0-9][a-z0-9-]*$/u
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

/** Select only a source-owned, version-compatible preparer for the opened context's game. */
export function resolveContentRuntimePreparer(
  contentSources: ContentSources,
  gameId: string,
): RuntimePreparerResolution {
  // A composed catalogue carries every game's preparer (`runtimePreparers`); take this game's.
  const sources = contentSources as ContentSources & {
    readonly runtimePreparer?: unknown
    readonly runtimePreparers?: readonly unknown[]
  }
  const candidates = sources.runtimePreparers ?? (sources.runtimePreparer === undefined ? [] : [sources.runtimePreparer])
  const candidate =
    candidates.find(item => (item as { readonly gameId?: unknown } | null)?.gameId === gameId) ?? candidates[0]
  if (candidate === undefined)
    return {
      state: 'unavailable',
      code: 'x3.host/runtime-preparer-unavailable',
      message: `No Runtime preparer is available for ${gameId}.`,
    }
  if (typeof candidate !== 'object' || candidate === null)
    return {
      state: 'unavailable',
      code: 'x3.host/runtime-preparer-invalid',
      message: 'The game content source has an invalid Runtime preparer.',
    }
  const row = candidate as Partial<RuntimeCompositionPreparer>
  if (row.major !== RUNTIME_PREPARER_MAJOR)
    return {
      state: 'unavailable',
      code: 'x3.host/runtime-preparer-version',
      message: 'The game content source requires an unsupported Runtime preparer major.',
    }
  if (
    row.gameId !== gameId ||
    typeof row.adapter?.id !== 'string' ||
    !ADAPTER_ID.test(row.adapter.id) ||
    typeof row.adapter.version !== 'string' ||
    !VERSION.test(row.adapter.version) ||
    typeof row.prepare !== 'function'
  )
    return {
      state: 'unavailable',
      code: 'x3.host/runtime-preparer-invalid',
      message: `The Runtime preparer does not match ${gameId} or has an invalid adapter.`,
    }
  return { state: 'resolved', preparer: row as RuntimeCompositionPreparer }
}
