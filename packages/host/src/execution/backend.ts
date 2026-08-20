/** Host-composed execution mechanisms. Security admission remains in security/gate.ts. */

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import type {
  ExecutionProfile,
  PermissionGrant,
  RuntimeTarget,
  RuntimeVariantDeclaration,
} from '@modkitx-x3/sdk'
import type { ActivationTicket } from '../security/gate.js'

export interface ExecutionBackendActivation {
  /** A gate-issued ticket that has already passed identity/digest/target checks. */
  readonly ticket: ActivationTicket
  readonly entrypoint: URL
  readonly artifactRoot: URL
  /**
   * Per-file digests of the artifact as inventoried (posix path relative to `artifactRoot` →
   * `sha256:…`), still valid because the gate re-verified the artifact digest just now. A backend
   * that evaluates files elsewhere verifies each one against this map right before evaluation.
   */
  readonly fileDigests?: Readonly<Record<string, string>>
  readonly variant: RuntimeVariantDeclaration
  readonly target: RuntimeTarget
  readonly grant: PermissionGrant
  readonly signal?: AbortSignal
}

export interface ExecutionModuleLease {
  readonly module: Record<string, unknown>
  /** Idempotent release of the backend realm/process/worker resources. */
  release(): Promise<void>
}

export interface ExecutionBackend {
  readonly profile: ExecutionProfile
  /** Pure feature/realm availability check. Throwing means unavailable. */
  readonly supports: (target: RuntimeTarget, variant: RuntimeVariantDeclaration) => boolean
  readonly activate: (
    context: ExecutionBackendActivation,
  ) => ExecutionModuleLease | Promise<ExecutionModuleLease>
}

export interface ExecutionBackendRegistry {
  readonly profiles: readonly ExecutionProfile[]
  supports(
    profile: ExecutionProfile,
    target: RuntimeTarget,
    variant: RuntimeVariantDeclaration,
  ): boolean
}

interface BackendBinding {
  readonly profile: ExecutionProfile
  readonly supports: ExecutionBackend['supports']
  readonly activate: ExecutionBackend['activate']
}

const PROFILE_VALUES: readonly ExecutionProfile[] = Object.freeze([
  'browser-sandbox',
  'worker-brokered',
  'process-brokered',
  'wasm-brokered',
  'trusted-in-process',
  'remote-provider',
])
/**
 * The private bindings travel on the registry object under a global symbol (not a module-local
 * WeakMap): the published entries of this package (`.`, `./node`) are bundled separately, so a
 * registry created by `@modkitx-x3/host/node` must be honoured by the gate inside
 * `@modkitx-x3/host`. Non-enumerable and symbol-keyed: a spread copy or a hand-built look-alike
 * still carries no bindings and is refused.
 */
const REGISTRY_BINDINGS = Symbol.for('x3.host/execution-backend-registry-bindings')

function bindingsOf(
  registry: ExecutionBackendRegistry,
): ReadonlyMap<ExecutionProfile, BackendBinding> | undefined {
  const value = (registry as unknown as Record<symbol, unknown>)[REGISTRY_BINDINGS]
  return value instanceof Map ? (value as ReadonlyMap<ExecutionProfile, BackendBinding>) : undefined
}

function invalid(message: string): ModkitError {
  return new ModkitError({ code: 'x3.host/invalid-execution-backend', message })
}

export function createExecutionBackendRegistry(
  backends: readonly ExecutionBackend[],
): ExecutionBackendRegistry {
  const bindings = new Map<ExecutionProfile, BackendBinding>()
  for (const [index, backend] of backends.entries()) {
    if (typeof backend !== 'object' || backend === null) {
      throw invalid(`execution backend[${index}] must be an object`)
    }
    const profile = backend.profile
    const supports = backend.supports
    const activate = backend.activate
    if (!PROFILE_VALUES.includes(profile)) {
      throw invalid(`execution backend[${index}] has an invalid profile`)
    }
    if (typeof supports !== 'function' || typeof activate !== 'function') {
      throw invalid(`execution backend ${profile} must provide supports and activate callbacks`)
    }
    if (bindings.has(profile)) {
      throw invalid(`execution backend profile ${profile} is registered more than once`)
    }
    bindings.set(profile, Object.freeze({ profile, supports, activate }))
  }
  const profiles = Object.freeze([...bindings.keys()].sort())
  const registry: ExecutionBackendRegistry = {
    profiles,
    supports(
      profile: ExecutionProfile,
      target: RuntimeTarget,
      variant: RuntimeVariantDeclaration,
    ): boolean {
      try {
        const binding = bindings.get(profile)
        if (binding === undefined || variant.executionProfile !== profile) return false
        return binding.supports(target, variant) === true
      } catch {
        return false
      }
    },
  }
  Object.defineProperty(registry, REGISTRY_BINDINGS, {
    value: bindings,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return Object.freeze(registry)
}

/** Internal gate-to-backend dispatch. Not exported from the package root. */
export async function activateExecutionBackend(
  registry: ExecutionBackendRegistry,
  context: ExecutionBackendActivation,
): Promise<ExecutionModuleLease> {
  throwIfAborted(context.signal)
  const bindings = bindingsOf(registry)
  if (bindings === undefined) {
    throw invalid('execution backend registry was not created by this host')
  }
  const profile = context.variant.executionProfile
  const binding = bindings.get(profile)
  if (binding === undefined || !registry.supports(profile, context.target, context.variant)) {
    throw new ModkitError({
      code: 'x3.host/execution-backend-unavailable',
      message: `no execution backend can honour ${profile} for ${context.target.environment}`,
      context: { profile, environment: context.target.environment },
    })
  }
  const raw = await binding.activate({
    ...context,
    entrypoint: new URL(context.entrypoint.href),
    artifactRoot: new URL(context.artifactRoot.href),
  })
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof raw.module !== 'object' ||
    raw.module === null ||
    Array.isArray(raw.module) ||
    typeof raw.release !== 'function'
  ) {
    if (typeof raw === 'object' && raw !== null && typeof raw.release === 'function') {
      try {
        await raw.release()
      } catch {
        // The malformed backend result is already rejected; cleanup failure cannot make it valid.
      }
    }
    throw invalid(`execution backend ${profile} returned an invalid module lease`)
  }
  let released = false
  return Object.freeze({
    module: raw.module,
    async release(): Promise<void> {
      if (released) return
      released = true
      await raw.release()
    },
  })
}

/**
 * The in-process backend: `import()` of the entrypoint in the host realm. It is offered to
 * variants declaring `trusted-in-process`; the gate additionally requires the inventory's explicit
 * `allowTrustedInProcess` decision for the artifact (24 §5.1: full process authority is never
 * inferred). Composition roots register it next to their brokered backends.
 */
export const TRUSTED_IN_PROCESS_EXECUTION_BACKEND: ExecutionBackend = Object.freeze({
  profile: 'trusted-in-process',
  supports: (_target: RuntimeTarget, variant: RuntimeVariantDeclaration) =>
    variant.executionProfile === 'trusted-in-process',
  async activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
    throwIfAborted(context.signal)
    const module = (await import(context.entrypoint.href)) as Record<string, unknown>
    return Object.freeze({ module, release: async () => undefined })
  },
} satisfies ExecutionBackend)

/**
 * The in-process backend of a host with statically linked extensions.
 *
 * Same profile and same gate as `TRUSTED_IN_PROCESS_EXECUTION_BACKEND`; the difference is where
 * the module comes from. A linked entrypoint (`modkit-linked://…`, minted by
 * `defineLinkedExtension`) is served from the registry of modules the application imported at
 * build time — that code is already in the process, and `import()` of a synthetic URL would be
 * both impossible and beside the point. Anything not in the registry falls back to the plain
 * dynamic `import()`, so one backend serves a host that mixes linked and directory extensions.
 */
export function linkedInProcessBackend(
  linked: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): ExecutionBackend {
  return Object.freeze({
    profile: 'trusted-in-process',
    supports: (_target: RuntimeTarget, variant: RuntimeVariantDeclaration) =>
      variant.executionProfile === 'trusted-in-process',
    async activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
      throwIfAborted(context.signal)
      const preLinked = linked.get(context.entrypoint.href)
      if (preLinked !== undefined) {
        return Object.freeze({ module: preLinked, release: async () => undefined })
      }
      if (context.entrypoint.protocol === 'modkit-linked:') {
        throw new ModkitError({
          code: 'x3.host/linked-module-missing',
          message: `no linked module was registered for ${context.entrypoint.href}`,
          context: { entrypoint: context.entrypoint.href },
        })
      }
      const module = (await import(context.entrypoint.href)) as Record<string, unknown>
      return Object.freeze({ module, release: async () => undefined })
    },
  } satisfies ExecutionBackend)
}

/** Compatibility composition used until an application supplies explicit worker/process realms. */
export const DEFAULT_EXECUTION_BACKENDS: ExecutionBackendRegistry = createExecutionBackendRegistry([
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
])
