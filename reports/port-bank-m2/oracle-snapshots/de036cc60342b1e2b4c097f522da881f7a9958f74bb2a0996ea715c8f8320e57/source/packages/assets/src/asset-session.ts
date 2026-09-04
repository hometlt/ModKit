/**
 * Generic runtime operation dispatch for one resolved asset.
 *
 * Descriptors declare stable handler IDs while runtime functions stay in the session. The
 * session is presentation-neutral and does not choose a codec, game, route, or host service.
 */

import { ModkitError } from '@modkitx/core/errors'
import { throwIfCancelled, type CancellationToken } from './cancellation.js'
import type { AssetDescriptor } from './descriptor.js'
import { isJsonSerializable, type JsonValue } from './json.js'
import {
  operationHandlerId,
  type AssetOperationDescriptor,
  type AssetPermission,
} from './operations.js'
import type { AssetProgressReporter } from './progress.js'

export type AssetOperationInput = JsonValue | undefined

/** Minimal runtime facilities understood by the generic session. */
export interface AssetOperationContext {
  readonly cancellation?: CancellationToken
  readonly progress?: AssetProgressReporter
}

export interface AssetOperationInvocation<
  TAsset,
  TContext extends AssetOperationContext = AssetOperationContext,
> {
  readonly asset: TAsset
  readonly context: TContext
  readonly descriptor: AssetDescriptor
  readonly operation: AssetOperationDescriptor
  readonly input: AssetOperationInput
}

export type AssetOperationHandler<
  TAsset,
  TContext extends AssetOperationContext = AssetOperationContext,
> = (invocation: AssetOperationInvocation<TAsset, TContext>) => unknown | Promise<unknown>

export type AssetOperationHandlers<
  TAsset,
  TContext extends AssetOperationContext = AssetOperationContext,
> = Readonly<Record<string, AssetOperationHandler<TAsset, TContext>>>

export interface AssetOperationSessionOptions {
  /** Every permission declared by an operation must be granted before its handler can run. */
  readonly grantedPermissions?: readonly AssetPermission[]
}

export interface AssetOperationSession<
  TContext extends AssetOperationContext = AssetOperationContext,
> {
  readonly context: TContext
  readonly descriptor: AssetDescriptor
  readonly disposed: boolean

  invoke(handlerId: string, input?: AssetOperationInput): Promise<unknown>
  dispose(): Promise<void>
}

export interface CreateAssetOperationSessionInit<
  TAsset,
  TContext extends AssetOperationContext = AssetOperationContext,
> extends AssetOperationSessionOptions {
  readonly asset: TAsset
  readonly context: TContext
  readonly descriptor: AssetDescriptor
  readonly handlers: AssetOperationHandlers<TAsset, TContext>
  readonly onDispose?: () => void | Promise<void>
}

class DefaultAssetOperationSession<
  TAsset,
  TContext extends AssetOperationContext,
> implements AssetOperationSession<TContext> {
  readonly context: TContext
  readonly descriptor: AssetDescriptor

  private readonly asset: TAsset
  private readonly handlers: AssetOperationHandlers<TAsset, TContext>
  private readonly permissions: ReadonlySet<AssetPermission>
  private readonly onDispose?: () => void | Promise<void>
  private disposePromise: Promise<void> | undefined

  constructor(init: CreateAssetOperationSessionInit<TAsset, TContext>) {
    this.asset = init.asset
    this.context = init.context
    this.descriptor = init.descriptor
    this.handlers = init.handlers
    this.permissions = new Set(init.grantedPermissions ?? [])
    if (init.onDispose !== undefined) this.onDispose = init.onDispose
  }

  get disposed(): boolean {
    return this.disposePromise !== undefined
  }

  async invoke(handlerId: string, input?: AssetOperationInput): Promise<unknown> {
    const errorContext = {
      sourceId: this.descriptor.source.id,
      handlerId,
    }
    if (this.disposed) {
      throw invalidSession('Asset operation session has already been disposed.', errorContext)
    }
    throwIfCancelled(this.context.cancellation, 'Asset operation was cancelled')
    if (input !== undefined && !isJsonSerializable(input)) {
      throw invalidSession('Asset operation input must be JSON-serializable.', errorContext)
    }

    const matchingOperations = this.descriptor.operations.filter(
      operation => operationHandlerId(operation) === handlerId,
    )
    if (matchingOperations.length === 0) {
      throw invalidSession(
        'Asset operation handler is not declared by this descriptor.',
        errorContext,
      )
    }
    if (matchingOperations.length > 1) {
      throw invalidSession(
        'Asset operation handler is declared more than once by this descriptor.',
        {
          ...errorContext,
          operationIds: matchingOperations.map(operation => operation.id),
        },
      )
    }

    const operation = matchingOperations[0]!
    if (operation.state !== 'available') {
      throw invalidSession(
        'Asset operation is not available for this descriptor.',
        {
          ...errorContext,
          operationId: operation.id,
          state: operation.state,
          reason: operation.reason,
        },
        operation.reason?.message,
      )
    }

    const missingPermissions = (operation.permissions ?? []).filter(
      permission => !this.permissions.has(permission),
    )
    if (missingPermissions.length > 0) {
      throw invalidSession('Asset operation requires permissions not granted to this session.', {
        ...errorContext,
        operationId: operation.id,
        missingPermissions,
      })
    }

    const handler = this.handlers[handlerId]
    if (handler === undefined) {
      throw invalidSession('Asset operation handler is not registered by this session.', {
        ...errorContext,
        operationId: operation.id,
      })
    }
    return handler({
      asset: this.asset,
      context: this.context,
      descriptor: this.descriptor,
      operation,
      input,
    })
  }

  dispose(): Promise<void> {
    if (this.disposePromise === undefined) {
      this.disposePromise = Promise.resolve().then(() => this.onDispose?.())
    }
    return this.disposePromise
  }
}

function invalidSession(
  message: string,
  context: Record<string, unknown>,
  hint?: string,
): ModkitError {
  return new ModkitError({
    code: 'CONFIG_INVALID',
    message,
    context,
    ...(hint === undefined ? {} : { hint }),
  })
}

export function createAssetOperationSession<
  TAsset,
  TContext extends AssetOperationContext = AssetOperationContext,
>(init: CreateAssetOperationSessionInit<TAsset, TContext>): AssetOperationSession<TContext> {
  return new DefaultAssetOperationSession(init)
}
