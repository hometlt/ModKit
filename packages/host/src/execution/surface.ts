/**
 * Method surfaces — the *port* through which the capability-RPC endpoints learn which methods a
 * capability of `contract@major` exposes and what each returns (NXT-105; owner decision D-7 /
 * NXT-103 make the standard surfaces a contract-definition authority in `sdk`).
 *
 * This file deliberately contains **no** surface data: it defines the shape, the grammar and a
 * registry builder. Production wiring injects surfaces from the NXT-103 adapter (standard
 * data-source contracts) and from the host-internal runtime-ABI set (codec/session/provider);
 * tests inject their own. Keeping data out of here is what makes the RPC core unable to become
 * a second allowlist next to `sdk` (review F-01/F-02).
 */

import { isQualifiedId, ModkitError } from '@modkitx-x3/core'
import { isMethodName, type WireValue } from './protocol.js'

/**
 * What a method returns across the boundary:
 *  - `value`    — a bounded wire value, copied/transferred; nothing to release;
 *  - `lease`    — a capability the caller must release (`Lease<T>` or a bare capability object);
 *                 crosses as a handle of kind `lease` whose surface is `result`;
 *  - `iterable` — an `AsyncIterable`; crosses as a handle of kind `iterator`, pulled with `next`;
 *  - `events`   — an `AsyncIterable` of push events; crosses as a handle of kind `events`,
 *                 consumed through `subscribe`/`event`/`unsubscribe`.
 */
export type MethodKind = 'value' | 'lease' | 'iterable' | 'events'

export interface MethodSurface {
  readonly kind: MethodKind
  /** Surface of the leased capability (`lease`) — required for `lease`, forbidden otherwise. */
  readonly result?: { readonly contract: string; readonly major: number }
  /**
   * ABI shape of a `lease` result on the consuming side: `'lease'` materializes as
   * `{ value, release }` (`AssetSession.dataSource()`), `'bare'` (default) as the capability
   * object itself whose `releaseVia` method releases the handle (`Codec.open()` → session).
   */
  readonly wrapper?: 'lease' | 'bare'
  /** Where the executing side appends an `AbortSignal` derived from `cancel` frames. */
  readonly signal?: 'last' | 'none'
  /** Optional argument validator run on both sides; returns a violation message or undefined. */
  readonly validateArgs?: (args: readonly WireValue[]) => string | undefined
  /** Optional return validator for `value` methods (items for `iterable`/`events`). */
  readonly validateReturn?: (value: WireValue | undefined) => string | undefined
}

export interface CapabilitySurface {
  readonly contract: string
  readonly major: number
  readonly methods: Readonly<Record<string, MethodSurface>>
  /**
   * A `value` method (e.g. `dispose`) whose completion also releases the handle on both sides,
   * so ABI objects that own their lifecycle (`AssetSession.dispose()`) map without a wrapper.
   */
  readonly releaseVia?: string
}

/** The port the endpoints depend on. Production supplies it; this module never guesses. */
export interface SurfaceRegistry {
  surfaceFor(contract: string, major: number): CapabilitySurface | undefined
}

export function surfaceKey(contract: string, major: number): string {
  return `${contract}@${major}`
}

function invalidSurface(message: string, context?: Record<string, unknown>): never {
  throw new ModkitError({
    code: 'x3.host/rpc-invalid-surface',
    message,
    ...(context === undefined ? {} : { context }),
  })
}

function snapshotMethod(
  name: string,
  raw: MethodSurface | undefined,
  surface: string,
): MethodSurface {
  if (raw === undefined || typeof raw !== 'object') {
    return invalidSurface(`method «${name}» has no declaration`, { surface })
  }
  const kind = raw.kind
  const result = raw.result
  const wrapper = raw.wrapper
  const signal = raw.signal
  const validateArgs = raw.validateArgs
  const validateReturn = raw.validateReturn
  if (kind !== 'value' && kind !== 'lease' && kind !== 'iterable' && kind !== 'events') {
    return invalidSurface(`method «${name}» has an invalid kind`, { surface })
  }
  if (wrapper !== undefined && wrapper !== 'lease' && wrapper !== 'bare') {
    return invalidSurface(`method «${name}» has an invalid wrapper`, { surface })
  }
  if (wrapper !== undefined && kind !== 'lease') {
    return invalidSurface(`only lease method «${name}» may declare a wrapper`, { surface })
  }
  if (signal !== undefined && signal !== 'last' && signal !== 'none') {
    return invalidSurface(`method «${name}» has an invalid signal placement`, { surface })
  }
  if (validateArgs !== undefined && typeof validateArgs !== 'function') {
    return invalidSurface(`method «${name}» has a non-function argument validator`, { surface })
  }
  if (validateReturn !== undefined && typeof validateReturn !== 'function') {
    return invalidSurface(`method «${name}» has a non-function return validator`, { surface })
  }
  if (kind === 'lease') {
    if (
      result === undefined ||
      !isQualifiedId(result.contract) ||
      !Number.isSafeInteger(result.major) ||
      result.major < 0
    ) {
      return invalidSurface(`lease method «${name}» must name the surface of its result`, {
        surface,
      })
    }
  } else if (result !== undefined) {
    return invalidSurface(`${kind} method «${name}» must not declare a result surface`, {
      surface,
    })
  }
  return Object.freeze({
    kind,
    ...(result === undefined
      ? {}
      : { result: Object.freeze({ contract: result.contract, major: result.major }) }),
    ...(wrapper === undefined ? {} : { wrapper }),
    ...(signal === undefined ? {} : { signal }),
    ...(validateArgs === undefined ? {} : { validateArgs }),
    ...(validateReturn === undefined ? {} : { validateReturn }),
  })
}

function assertSurface(surface: CapabilitySurface): void {
  if (
    !isQualifiedId(surface.contract) ||
    !Number.isSafeInteger(surface.major) ||
    surface.major < 0
  ) {
    return invalidSurface(
      `surface contract must be a qualified id with a non-negative major: ${surface.contract}@${String(surface.major)}`,
    )
  }
  const names = Object.keys(surface.methods)
  if (surface.releaseVia !== undefined && surface.methods[surface.releaseVia]?.kind !== 'value') {
    return invalidSurface(`releaseVia «${surface.releaseVia}» must name a declared value method`, {
      surface: surfaceKey(surface.contract, surface.major),
    })
  }
  if (names.length === 0) {
    return invalidSurface(
      `surface ${surfaceKey(surface.contract, surface.major)} declares no methods`,
    )
  }
  for (const name of names) {
    const method = surface.methods[name]
    if (!isMethodName(name) || method === undefined) {
      return invalidSurface(`method name «${name}» is not lowerCamel or has no declaration`, {
        surface: surfaceKey(surface.contract, surface.major),
      })
    }
  }
}

/**
 * Builds a frozen registry from explicit surfaces. Duplicate `contract@major` entries are refused;
 * a `lease` result that names an unregistered surface is refused too, so a proxy can never be
 * created for a capability whose method set is unknown.
 */
export function createSurfaceRegistry(surfaces: readonly CapabilitySurface[]): SurfaceRegistry {
  const byKey = new Map<string, CapabilitySurface>()
  for (const surface of surfaces) {
    assertSurface(surface)
    const key = surfaceKey(surface.contract, surface.major)
    if (byKey.has(key)) {
      throw new ModkitError({
        code: 'x3.host/rpc-duplicate-surface',
        message: `surface ${key} is registered twice`,
      })
    }
    const methods: Record<string, MethodSurface> = {}
    for (const [name, method] of Object.entries(surface.methods)) {
      methods[name] = snapshotMethod(name, method, key)
    }
    const snapshot = Object.freeze({
      contract: surface.contract,
      major: surface.major,
      methods: Object.freeze(methods),
      ...(surface.releaseVia === undefined ? {} : { releaseVia: surface.releaseVia }),
    })
    byKey.set(key, snapshot)
  }
  for (const surface of byKey.values()) {
    for (const [name, method] of Object.entries(surface.methods)) {
      if (
        method.kind === 'lease' &&
        method.result !== undefined &&
        !byKey.has(surfaceKey(method.result.contract, method.result.major))
      ) {
        throw new ModkitError({
          code: 'x3.host/rpc-unknown-result-surface',
          message: `lease method «${name}» of ${surfaceKey(surface.contract, surface.major)} names unregistered surface ${surfaceKey(method.result.contract, method.result.major)}`,
        })
      }
    }
  }
  return Object.freeze({
    surfaceFor(contract: string, major: number) {
      return byKey.get(surfaceKey(contract, major))
    },
  })
}

/** Composes registries; the first that knows a surface wins (test doubles before defaults). */
export function composeSurfaceRegistries(
  ...registries: readonly SurfaceRegistry[]
): SurfaceRegistry {
  return Object.freeze({
    surfaceFor(contract: string, major: number) {
      for (const registry of registries) {
        const found = registry.surfaceFor(contract, major)
        if (found !== undefined) return found
      }
      return undefined
    },
  })
}
