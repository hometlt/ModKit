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

import { isQualifiedId, ModkitError } from '@modkit/core'
import { isMethodName, type WireValue } from './protocol.js'

/**
 * What a method returns across the boundary:
 *  - `value`        — a bounded wire value, copied/transferred; nothing to release;
 *  - `lease`        — a capability the caller must release (`Lease<T>` or a bare capability
 *                     object); crosses as a handle of kind `lease` whose surface is `result` (or
 *                     is read from the arguments, `resultFromArgs`);
 *  - `leased-value` — `Lease<T>` of a plain value: the value crosses by copy, the lease as a
 *                     release-only handle (`return { value, lease }`);
 *  - `iterable`     — an `AsyncIterable`; crosses as a handle of kind `iterator`, pulled with `next`;
 *  - `events`       — an `AsyncIterable` of push events; crosses as a handle of kind `events`,
 *                     consumed through `subscribe`/`event`/`unsubscribe`.
 */
export type MethodKind = 'value' | 'lease' | 'leased-value' | 'iterable' | 'events'

/**
 * A place inside the positional arguments: the argument itself (`number`) or a top-level key of
 * an object argument (`{ arg, key }`) — where a request object carries `contract`/`major`, or its
 * own `signal`/`onProgress` (`ParseRequest.signal`, `OperationSession.invoke(…, { signal })`).
 */
export type ArgRef = number | { readonly arg: number; readonly key: string }

/** Where the executing side places the `AbortSignal` derived from `cancel` frames. */
export type SignalPlacement = 'last' | 'none' | { readonly arg: number; readonly key: string }

export interface MethodSurface {
  readonly kind: MethodKind
  /**
   * Surface of the leased capability (`lease`): one of `result`/`resultFromArgs` is required
   * for `lease`, both are forbidden for every other kind.
   */
  readonly result?: { readonly contract: string; readonly major: number }
  /**
   * `lease` whose surface depends on the call: positions of the contract id and the major in the
   * arguments (`AssetSession.dataSource(contract, major)`). The executing side resolves the
   * surface from the decoded arguments and refuses unknown ones with `x3.host/rpc-bad-argument`.
   */
  readonly resultFromArgs?: { readonly contract: ArgRef; readonly major: ArgRef }
  /**
   * Positional argument count before the signal. The executing side pads omitted trailing
   * arguments with `undefined` up to `arity` before appending the signal, so
   * `encoded(trackId?, signal?)` called as `encoded()` still receives its signal last.
   */
  readonly arity?: number
  /** The ABI declares the method with `?`; an implementation may lack it (v1: proxies still define it). */
  readonly optional?: boolean
  /**
   * ABI shape of a `lease` result on the consuming side: `'lease'` materializes as
   * `{ value, release }` (`AssetSession.dataSource()`), `'bare'` (default) as the capability
   * object itself whose `releaseVia` method releases the handle (`Codec.open()` → session).
   */
  readonly wrapper?: 'lease' | 'bare'
  /**
   * Where the executing side places the `AbortSignal` derived from `cancel` frames: appended last,
   * nowhere, or as a key of an object argument (the consumer strips that key before sending, the
   * executor re-creates it — the argument object itself stays a plain wire value).
   */
  readonly signal?: SignalPlacement
  /**
   * Where a progress callback lives inside an object argument. The consumer strips the function
   * and routes it to the call's `onProgress`; the executor places a function there that emits
   * `progress` frames for the in-flight call.
   */
  readonly progress?: { readonly arg: number; readonly key: string }
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
   * Data properties of the capability object copied to the consumer when a handle for it is
   * created (`AssetSession.revision`, `ArtifactByteSource.size`, a module's `abiVersion`). Each
   * must be a bounded wire value without handles; the materialized proxy exposes them as own
   * read-only properties next to the methods.
   */
  readonly fields?: readonly string[]
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

function isKeyRef(value: unknown): value is { readonly arg: number; readonly key: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isSafeInteger((value as { arg?: unknown }).arg) &&
    ((value as { arg: number }).arg as number) >= 0 &&
    typeof (value as { key?: unknown }).key === 'string' &&
    isMethodName((value as { key: string }).key)
  )
}

function isArgRef(value: unknown): value is ArgRef {
  return (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || isKeyRef(value)
}

const argRefKey = (ref: ArgRef) => (typeof ref === 'number' ? `${ref}` : `${ref.arg}.${ref.key}`)
const freezeArgRef = (ref: ArgRef): ArgRef =>
  typeof ref === 'number' ? ref : Object.freeze({ ...ref })

/** Reads an `ArgRef` off decoded positional arguments (undefined when absent). */
export function readArgRef(args: readonly unknown[], ref: ArgRef): unknown {
  if (typeof ref === 'number') return args[ref]
  const holder = args[ref.arg]
  return typeof holder === 'object' && holder !== null
    ? (holder as Record<string, unknown>)[ref.key]
    : undefined
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
  const resultFromArgs = raw.resultFromArgs
  const wrapper = raw.wrapper
  const signal = raw.signal
  const progress = raw.progress
  const arity = raw.arity
  const optional = raw.optional
  const validateArgs = raw.validateArgs
  const validateReturn = raw.validateReturn
  if (
    kind !== 'value' &&
    kind !== 'lease' &&
    kind !== 'leased-value' &&
    kind !== 'iterable' &&
    kind !== 'events'
  ) {
    return invalidSurface(`method «${name}» has an invalid kind`, { surface })
  }
  if (arity !== undefined && (!Number.isSafeInteger(arity) || arity < 0 || arity > 16)) {
    return invalidSurface(`method «${name}» has an invalid arity`, { surface })
  }
  if (optional !== undefined && typeof optional !== 'boolean') {
    return invalidSurface(`method «${name}» has a non-boolean optional flag`, { surface })
  }
  if (
    resultFromArgs !== undefined &&
    (typeof resultFromArgs !== 'object' ||
      resultFromArgs === null ||
      !isArgRef(resultFromArgs.contract) ||
      !isArgRef(resultFromArgs.major) ||
      argRefKey(resultFromArgs.contract) === argRefKey(resultFromArgs.major))
  ) {
    return invalidSurface(`method «${name}» has invalid resultFromArgs positions`, { surface })
  }
  if (wrapper !== undefined && wrapper !== 'lease' && wrapper !== 'bare') {
    return invalidSurface(`method «${name}» has an invalid wrapper`, { surface })
  }
  if (wrapper !== undefined && kind !== 'lease') {
    return invalidSurface(`only lease method «${name}» may declare a wrapper`, { surface })
  }
  if (signal !== undefined && signal !== 'last' && signal !== 'none' && !isKeyRef(signal)) {
    return invalidSurface(`method «${name}» has an invalid signal placement`, { surface })
  }
  if (progress !== undefined && !isKeyRef(progress)) {
    return invalidSurface(`method «${name}» has an invalid progress placement`, { surface })
  }
  if (
    isKeyRef(signal) &&
    progress !== undefined &&
    signal.arg === progress.arg &&
    signal.key === progress.key
  ) {
    return invalidSurface(`method «${name}» places signal and progress on the same key`, {
      surface,
    })
  }
  if (validateArgs !== undefined && typeof validateArgs !== 'function') {
    return invalidSurface(`method «${name}» has a non-function argument validator`, { surface })
  }
  if (validateReturn !== undefined && typeof validateReturn !== 'function') {
    return invalidSurface(`method «${name}» has a non-function return validator`, { surface })
  }
  if (kind === 'lease') {
    if ((result === undefined) === (resultFromArgs === undefined)) {
      return invalidSurface(
        `lease method «${name}» must name the surface of its result (result or resultFromArgs)`,
        { surface },
      )
    }
    if (
      result !== undefined &&
      (!isQualifiedId(result.contract) || !Number.isSafeInteger(result.major) || result.major < 0)
    ) {
      return invalidSurface(`lease method «${name}» must name the surface of its result`, {
        surface,
      })
    }
  } else if (result !== undefined || resultFromArgs !== undefined) {
    return invalidSurface(`${kind} method «${name}» must not declare a result surface`, {
      surface,
    })
  }
  return Object.freeze({
    kind,
    ...(result === undefined
      ? {}
      : { result: Object.freeze({ contract: result.contract, major: result.major }) }),
    ...(resultFromArgs === undefined
      ? {}
      : {
          resultFromArgs: Object.freeze({
            contract: freezeArgRef(resultFromArgs.contract),
            major: freezeArgRef(resultFromArgs.major),
          }),
        }),
    ...(wrapper === undefined ? {} : { wrapper }),
    ...(signal === undefined
      ? {}
      : { signal: typeof signal === 'string' ? signal : Object.freeze({ ...signal }) }),
    ...(progress === undefined ? {} : { progress: Object.freeze({ ...progress }) }),
    ...(arity === undefined ? {} : { arity }),
    ...(optional === undefined ? {} : { optional }),
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
  if (surface.fields !== undefined) {
    if (!Array.isArray(surface.fields) || surface.fields.length > 64) {
      return invalidSurface('fields must be an array of at most 64 names', {
        surface: surfaceKey(surface.contract, surface.major),
      })
    }
    const seen = new Set<string>()
    for (const field of surface.fields) {
      if (typeof field !== 'string' || !isMethodName(field) || seen.has(field)) {
        return invalidSurface(`field name «${String(field)}» is not lowerCamel or repeats`, {
          surface: surfaceKey(surface.contract, surface.major),
        })
      }
      if (Object.hasOwn(surface.methods, field)) {
        return invalidSurface(`«${field}» cannot be both a field and a method`, {
          surface: surfaceKey(surface.contract, surface.major),
        })
      }
      seen.add(field)
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
      ...(surface.fields === undefined ? {} : { fields: Object.freeze([...surface.fields]) }),
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
