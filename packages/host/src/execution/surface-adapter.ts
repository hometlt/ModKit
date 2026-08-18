/**
 * NXT-103 → NXT-105 adapter: turns the SDK's data-only method surfaces (contract-definition
 * authority) into the capability-RPC core's `CapabilitySurface`s and builds the one surface
 * registry a host endpoint runs with — the 13 standard data-source surfaces, the auxiliary
 * `common.view/encoded-media@1`, the host-internal runtime-ABI surfaces and the surfaces of
 * every registered foreign data-source definition. No transport or application keeps a method
 * allowlist next to this.
 *
 * `limits` declared on a method become validators: `maxStringLength` bounds strings in arguments
 * and results, `maxBytes` bounds the bytes a result carries, `maxPageItems` bounds `items` of a
 * page-shaped result. Everything else maps one to one.
 */

import {
  AUXILIARY_DATA_SOURCE_SURFACES,
  STANDARD_DATA_SOURCE_SURFACES,
  type DataSourceMethodSurfaceV1Wire,
  type DataSourceSurfaceV1Wire,
} from '@modkitx-x3/sdk'
import { RUNTIME_ABI_SURFACES } from './abi-surfaces.js'
import type { WireValue } from './protocol.js'
import {
  createSurfaceRegistry,
  type CapabilitySurface,
  type MethodSurface,
  type SurfaceRegistry,
} from './surface.js'

/** A registered data-source definition as the host sees it (contract, major and its surface). */
export interface DataSourceSurfaceSource {
  readonly contract: string
  readonly major: number
  readonly surface?: DataSourceSurfaceV1Wire | undefined
}

// ---------------------------------------------------------------------------------------------
// limits → validators

function walkStrings(value: unknown, max: number): string | undefined {
  if (typeof value === 'string') {
    return value.length > max ? `a string is longer than ${max}` : undefined
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = walkStrings(item, max)
      if (problem !== undefined) return problem
    }
    return undefined
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Uint8Array)) {
    for (const [key, item] of Object.entries(value)) {
      if (key.length > max) return `a key is longer than ${max}`
      const problem = walkStrings(item, max)
      if (problem !== undefined) return problem
    }
  }
  return undefined
}

function countBytes(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countBytes(item), 0)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).reduce<number>((sum, item) => sum + countBytes(item), 0)
  }
  return 0
}

function limitValidators(
  limits: NonNullable<DataSourceMethodSurfaceV1Wire['limits']>,
): Pick<MethodSurface, 'validateArgs' | 'validateReturn'> {
  const { maxStringLength, maxBytes, maxPageItems } = limits
  const validateArgs =
    maxStringLength === undefined
      ? undefined
      : (args: readonly WireValue[]) => walkStrings(args, maxStringLength)
  const validateReturn =
    maxStringLength === undefined && maxBytes === undefined && maxPageItems === undefined
      ? undefined
      : (value: WireValue | undefined) => {
          if (maxStringLength !== undefined) {
            const problem = walkStrings(value, maxStringLength)
            if (problem !== undefined) return problem
          }
          if (maxBytes !== undefined && countBytes(value) > maxBytes) {
            return `result carries more than ${maxBytes} bytes`
          }
          if (
            maxPageItems !== undefined &&
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            Array.isArray((value as { items?: unknown }).items) &&
            (value as { items: unknown[] }).items.length > maxPageItems
          ) {
            return `page carries more than ${maxPageItems} items`
          }
          return undefined
        }
  return {
    ...(validateArgs === undefined ? {} : { validateArgs }),
    ...(validateReturn === undefined ? {} : { validateReturn }),
  }
}

// ---------------------------------------------------------------------------------------------
// adapter

function methodSurfaceFrom(method: DataSourceMethodSurfaceV1Wire): MethodSurface {
  return {
    kind: method.kind,
    ...(method.kind === 'lease'
      ? {
          result: { contract: method.result.contract, major: method.result.major },
          ...(method.wrapper === undefined ? {} : { wrapper: method.wrapper }),
        }
      : {}),
    ...(method.signal === undefined ? {} : { signal: method.signal }),
    ...(method.arity === undefined ? {} : { arity: method.arity }),
    ...(method.optional === undefined ? {} : { optional: method.optional }),
    ...(method.limits === undefined ? {} : limitValidators(method.limits)),
  }
}

/** One data-source surface (standard or foreign) as the RPC core consumes it. */
export function capabilitySurfaceFromDataSource(
  contract: string,
  major: number,
  surface: DataSourceSurfaceV1Wire,
): CapabilitySurface {
  const methods: Record<string, MethodSurface> = {}
  for (const [name, method] of Object.entries(surface.methods)) {
    methods[name] = methodSurfaceFrom(method)
  }
  return {
    contract,
    major,
    methods,
    ...(surface.releaseVia === undefined ? {} : { releaseVia: surface.releaseVia }),
  }
}

/** The standard + auxiliary data-source surfaces, adapted. */
export function standardDataSourceCapabilitySurfaces(): readonly CapabilitySurface[] {
  const out: CapabilitySurface[] = []
  for (const table of [STANDARD_DATA_SOURCE_SURFACES, AUXILIARY_DATA_SOURCE_SURFACES]) {
    for (const [contract, surface] of Object.entries(table)) {
      out.push(capabilitySurfaceFromDataSource(contract, 1, surface))
    }
  }
  return out
}

export interface StandardSurfaceRegistryOptions {
  /**
   * Registered foreign data-source definitions (`DataSourceRegistry.list()`); those without a
   * `surface` cannot cross an execution boundary and are skipped — a host that needs them proxied
   * must ship a definition with a surface, never guess one.
   */
  readonly definitions?: Iterable<DataSourceSurfaceSource>
  /** Extra host-composed surfaces (tests, adapters); the standard/ABI set always wins conflicts. */
  readonly surfaces?: readonly CapabilitySurface[]
}

/**
 * The registry a host endpoint runs with: standard data-source surfaces + auxiliary + runtime-ABI
 * surfaces + registered foreign definitions with a surface + extras. Duplicate coordinates from
 * `definitions`/`surfaces` are ignored in favour of the standard set (the standard table is the
 * authority for its own contracts).
 */
export function createStandardSurfaceRegistry(
  options: StandardSurfaceRegistryOptions = {},
): SurfaceRegistry {
  const byKey = new Map<string, CapabilitySurface>()
  const add = (surface: CapabilitySurface, override: boolean) => {
    const key = `${surface.contract}@${surface.major}`
    if (!override && byKey.has(key)) return
    byKey.set(key, surface)
  }
  for (const surface of standardDataSourceCapabilitySurfaces()) add(surface, true)
  for (const surface of RUNTIME_ABI_SURFACES) add(surface, true)
  for (const definition of options.definitions ?? []) {
    if (definition.surface === undefined) continue
    add(
      capabilitySurfaceFromDataSource(definition.contract, definition.major, definition.surface),
      false,
    )
  }
  for (const surface of options.surfaces ?? []) add(surface, false)
  return createSurfaceRegistry([...byKey.values()])
}
