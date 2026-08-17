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
const registryBindings = new WeakMap<
  ExecutionBackendRegistry,
  ReadonlyMap<ExecutionProfile, BackendBinding>
>()

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
  const registry: ExecutionBackendRegistry = Object.freeze({
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
  })
  registryBindings.set(registry, bindings)
  return registry
}

/** Internal gate-to-backend dispatch. Not exported from the package root. */
export async function activateExecutionBackend(
  registry: ExecutionBackendRegistry,
  context: ExecutionBackendActivation,
): Promise<ExecutionModuleLease> {
  throwIfAborted(context.signal)
  const bindings = registryBindings.get(registry)
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

const trustedInProcessBackend = Object.freeze({
  profile: 'trusted-in-process',
  supports: (_target: RuntimeTarget, variant: RuntimeVariantDeclaration) =>
    variant.executionProfile === 'trusted-in-process',
  async activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
    throwIfAborted(context.signal)
    const module = (await import(context.entrypoint.href)) as Record<string, unknown>
    return Object.freeze({ module, release: async () => undefined })
  },
} satisfies ExecutionBackend)

/** Compatibility composition used until an application supplies explicit worker/process realms. */
export const DEFAULT_EXECUTION_BACKENDS: ExecutionBackendRegistry = createExecutionBackendRegistry([
  trustedInProcessBackend,
])
