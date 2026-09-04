/**
 * Browser-safe lifecycle for an already-selected codec runtime entrypoint.
 *
 * Matching and variant routing remain owned by the generated registry pipeline. This module only
 * validates the selected entry against one host target, loads that exact entrypoint, activates it,
 * and owns deterministic cleanup. Runtime modules are interpreted by an explicit activator; this
 * layer never reflects export names or exposes a generic service locator.
 */

import { ModkitError } from '@modkitx/core/errors'
import {
  CancellationTokenNone,
  isCancellationError,
  throwIfCancelled,
  type CancellationToken,
} from './cancellation.js'
import type { AssetDiagnostic } from './diagnostics.js'
import { isJsonSerializable } from './json.js'
import {
  codecManifestCoordinate,
  selectCodecRuntimeVariants,
  type CodecCapability,
  type CodecHostCapability,
  type CodecPermissionClass,
  type CodecRuntimeEnvironment,
  type CodecRuntimeTarget,
  type CodecRuntimeVariant,
} from './codec-manifest.js'
import type {
  CodecEntrypointKind,
  CodecEntrypointLoader,
  CodecMatchingRegistryEntry,
} from './codec-matching.js'
import type { AssetProgressReporter } from './progress.js'

export type CodecRuntimeEntrypointKind = Exclude<CodecEntrypointKind, 'detect'>

export type CodecCleanup = () => void | Promise<void>

export interface CodecActivationContext {
  readonly coordinate: string
  readonly variantId: string
  readonly environment: CodecRuntimeEnvironment
  /** Claims copied from the selected manifest variant, never from runtime output. */
  readonly declaredCapabilities: readonly CodecCapability[]
  readonly declaredOperations: readonly string[]
  /** Exact grants supplied by the host. These values are not service implementations. */
  readonly grantedHostCapabilities: readonly CodecHostCapability[]
  readonly grantedPermissions: readonly CodecPermissionClass[]
  readonly cancellation: CancellationToken
  readonly progress?: AssetProgressReporter
  /** Registers one owned resource for reverse-order cleanup. */
  registerCleanup(cleanup: CodecCleanup): void
}

export interface CodecActivationResult<TRuntime = unknown> {
  readonly runtime: TRuntime
  /** Serializable non-fatal degradation reported while activating the runtime. */
  readonly diagnostics?: readonly AssetDiagnostic[]
}

export type CodecRuntimeActivator<TRuntime = unknown> = (
  moduleNamespace: unknown,
  context: CodecActivationContext,
) => CodecActivationResult<TRuntime> | Promise<CodecActivationResult<TRuntime>>

export interface CodecRuntimeLoadInput<TRuntime = unknown> {
  readonly entry: CodecMatchingRegistryEntry
  readonly runtimeEntrypoint: CodecRuntimeEntrypointKind
  readonly load: CodecEntrypointLoader
  readonly target: CodecRuntimeTarget
  readonly activate: CodecRuntimeActivator<TRuntime>
  readonly cancellation?: CancellationToken
  /** Shared reporter supplied by the caller. This lifecycle never completes it implicitly. */
  readonly progress?: AssetProgressReporter
}

export interface CodecActivationHandle<TRuntime = unknown> {
  readonly coordinate: string
  readonly variantId: string
  readonly environment: CodecRuntimeEnvironment
  readonly runtimeEntrypoint: CodecRuntimeEntrypointKind
  readonly runtime: TRuntime
  readonly capabilities: readonly CodecCapability[]
  readonly operations: readonly string[]
  readonly diagnostics: readonly AssetDiagnostic[]
  /** True as soon as disposal starts. */
  readonly disposed: boolean
  /** Idempotent. Concurrent calls return the same promise. */
  dispose(): Promise<void>
}

interface ErrorContext {
  readonly coordinate: string
  readonly variantId: string
  readonly environment: CodecRuntimeEnvironment
  readonly runtimeEntrypoint: CodecRuntimeEntrypointKind
}

function configError(context: ErrorContext, reason: string): ModkitError {
  return new ModkitError({
    code: 'CONFIG_INVALID',
    message: 'Selected codec runtime is incompatible with the host activation request.',
    context: { ...context, phase: 'validate', reason },
  })
}

function lifecycleError(
  code:
    | 'CODEC_RUNTIME_LOAD_FAILED'
    | 'CODEC_RUNTIME_ACTIVATION_FAILED'
    | 'CODEC_RUNTIME_DISPOSE_FAILED',
  context: ErrorContext,
  phase: 'load' | 'activate' | 'dispose',
  cause: unknown,
): ModkitError {
  const message =
    phase === 'load'
      ? 'Codec runtime entrypoint failed to load.'
      : phase === 'activate'
        ? 'Codec runtime entrypoint failed to activate.'
        : 'Codec runtime resources failed to dispose.'
  return new ModkitError({
    code,
    message,
    context: { ...context, phase },
    cause,
  })
}

function combinedCause(primary: unknown, cleanupErrors: readonly unknown[]): unknown {
  if (cleanupErrors.length === 0) return primary
  return new AggregateError([primary, ...cleanupErrors], 'Codec activation and cleanup failed.')
}

async function runCleanupStack(cleanups: CodecCleanup[]): Promise<readonly unknown[]> {
  const errors: unknown[] = []
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup === undefined) continue
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

function selectedVariant(input: CodecRuntimeLoadInput, context: ErrorContext): CodecRuntimeVariant {
  const variants = input.entry.manifest.runtimeVariants.filter(
    variant => variant.id === input.entry.variant.id,
  )
  if (variants.length !== 1) {
    throw configError(context, variants.length === 0 ? 'variant-not-found' : 'variant-id-ambiguous')
  }
  const variant = variants[0]!
  if (input.entry.variant.environment !== input.target.environment) {
    throw configError(context, 'target-environment-mismatch')
  }
  if (input.entry.loaders[input.runtimeEntrypoint] !== input.load) {
    throw configError(context, 'entrypoint-loader-mismatch')
  }
  const selection = selectCodecRuntimeVariants({ runtimeVariants: [variant] }, input.target)
  if (!selection.variantIds.includes(variant.id)) {
    const rejection = selection.rejectedVariants[0]
    throw configError(context, rejection?.code ?? 'variant-incompatible')
  }
  return variant
}

function validateActivationResult<TRuntime>(result: CodecActivationResult<TRuntime>): void {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new ModkitError({
      code: 'CONFIG_INVALID',
      message: 'Codec activation must return an object.',
      context: { phase: 'activate', reason: 'activation-result-invalid' },
    })
  }
  if (result.diagnostics !== undefined && !isJsonSerializable(result.diagnostics)) {
    throw new ModkitError({
      code: 'CONFIG_INVALID',
      message: 'Codec activation diagnostics must be JSON-serializable.',
      context: { phase: 'activate', reason: 'activation-diagnostics-invalid' },
    })
  }
}

/** Loads and activates exactly one registry entry selected by the caller. */
export async function loadAndActivateCodecRuntime<TRuntime>(
  input: CodecRuntimeLoadInput<TRuntime>,
): Promise<CodecActivationHandle<TRuntime>> {
  const coordinate = codecManifestCoordinate(input.entry.manifest)
  const errorContext: ErrorContext = {
    coordinate,
    variantId: input.entry.variant.id,
    environment: input.entry.variant.environment,
    runtimeEntrypoint: input.runtimeEntrypoint,
  }
  const variant = selectedVariant(input, errorContext)
  const cancellation = input.cancellation ?? CancellationTokenNone
  throwIfCancelled(cancellation, 'Codec runtime loading was cancelled')

  let moduleNamespace: unknown
  try {
    moduleNamespace = await input.load()
  } catch (error) {
    if (isCancellationError(error)) throw error
    throw lifecycleError('CODEC_RUNTIME_LOAD_FAILED', errorContext, 'load', error)
  }
  throwIfCancelled(cancellation, 'Codec runtime loading was cancelled')

  const cleanups: CodecCleanup[] = []
  let cleanupStarted = false
  const activationContext: CodecActivationContext = {
    coordinate,
    variantId: variant.id,
    environment: input.entry.variant.environment,
    declaredCapabilities: Object.freeze([...variant.capabilities]),
    declaredOperations: Object.freeze([...(variant.operations ?? [])]),
    grantedHostCapabilities: Object.freeze([...(input.target.hostCapabilities ?? [])]),
    grantedPermissions: Object.freeze([...(input.target.grantedPermissions ?? [])]),
    cancellation,
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    registerCleanup(cleanup) {
      if (cleanupStarted) throw configError(errorContext, 'cleanup-registration-closed')
      if (typeof cleanup !== 'function') throw configError(errorContext, 'cleanup-not-function')
      cleanups.push(cleanup)
    },
  }

  let result: CodecActivationResult<TRuntime>
  try {
    result = await input.activate(moduleNamespace, activationContext)
    validateActivationResult(result)
    throwIfCancelled(cancellation, 'Codec runtime activation was cancelled')
  } catch (error) {
    cleanupStarted = true
    const cleanupErrors = await runCleanupStack(cleanups)
    if (isCancellationError(error) && cleanupErrors.length === 0) throw error
    throw lifecycleError(
      'CODEC_RUNTIME_ACTIVATION_FAILED',
      errorContext,
      'activate',
      combinedCause(error, cleanupErrors),
    )
  }

  const capabilities = Object.freeze([...variant.capabilities])
  const operations = Object.freeze([...(variant.operations ?? [])])
  const diagnostics = Object.freeze([...(result.diagnostics ?? [])])
  let disposePromise: Promise<void> | undefined

  return {
    coordinate,
    variantId: variant.id,
    environment: input.entry.variant.environment,
    runtimeEntrypoint: input.runtimeEntrypoint,
    runtime: result.runtime,
    capabilities,
    operations,
    diagnostics,
    get disposed(): boolean {
      return disposePromise !== undefined
    },
    dispose(): Promise<void> {
      if (disposePromise === undefined) {
        cleanupStarted = true
        disposePromise = runCleanupStack(cleanups).then(errors => {
          if (errors.length > 0) {
            const cause =
              errors.length === 1
                ? errors[0]
                : new AggregateError(errors, 'Multiple codec cleanup callbacks failed.')
            throw lifecycleError('CODEC_RUNTIME_DISPOSE_FAILED', errorContext, 'dispose', cause)
          }
        })
      }
      return disposePromise
    },
  }
}
