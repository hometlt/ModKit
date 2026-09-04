/**
 * Runtime operation dispatch for one opened semantic artifact.
 *
 * Descriptors carry stable handler IDs but never functions. A session binds those IDs to the
 * selected codec's runtime handlers for exactly one opened document, validates the descriptor's
 * per-document operation state and permissions, and keeps runtime values out of the serializable
 * descriptor contract.
 */

import { ModkitError } from '@modkitx/core/errors'
import { throwIfCancelled } from './cancellation.js'
import type { ArtifactContext } from './artifact-codec.js'
import type { AssetDescriptor } from './descriptor.js'
import { isJsonSerializable, type JsonValue } from './json.js'
import {
  operationHandlerId,
  type AssetOperationDescriptor,
  type AssetPermission,
} from './operations.js'

export type ArtifactOperationInput = JsonValue | undefined

export interface ArtifactOperationInvocation<TDocument> {
  readonly document: TDocument
  readonly context: ArtifactContext
  readonly descriptor: AssetDescriptor
  readonly operation: AssetOperationDescriptor
  readonly input: ArtifactOperationInput
}

export type ArtifactOperationHandler<TDocument> = (
  invocation: ArtifactOperationInvocation<TDocument>,
) => unknown | Promise<unknown>

export type ArtifactOperationHandlers<TDocument> = Readonly<
  Record<string, ArtifactOperationHandler<TDocument>>
>

export interface ArtifactOperationSessionOptions {
  /**
   * Permissions granted by the host for this session. An operation is rejected unless every
   * permission named by its descriptor is present here.
   */
  readonly grantedPermissions?: readonly AssetPermission[]
}

export interface ArtifactOperationSession {
  readonly codecId: string
  readonly context: ArtifactContext
  readonly descriptor: AssetDescriptor
  readonly disposed: boolean

  invoke(handlerId: string, input?: ArtifactOperationInput): Promise<unknown>
  dispose(): Promise<void>
}

export interface CreateArtifactOperationSessionInit<
  TDocument,
> extends ArtifactOperationSessionOptions {
  readonly codecId: string
  readonly document: TDocument
  readonly context: ArtifactContext
  readonly descriptor: AssetDescriptor
  readonly handlers: ArtifactOperationHandlers<TDocument>
  readonly onDispose?: () => void | Promise<void>
}

class DefaultArtifactOperationSession<TDocument> implements ArtifactOperationSession {
  readonly codecId: string
  readonly context: ArtifactContext
  readonly descriptor: AssetDescriptor

  private readonly document: TDocument
  private readonly handlers: ArtifactOperationHandlers<TDocument>
  private readonly permissions: ReadonlySet<AssetPermission>
  private readonly onDispose?: () => void | Promise<void>
  private disposePromise: Promise<void> | undefined

  constructor(init: CreateArtifactOperationSessionInit<TDocument>) {
    this.codecId = init.codecId
    this.document = init.document
    this.context = init.context
    this.descriptor = init.descriptor
    this.handlers = init.handlers
    this.permissions = new Set(init.grantedPermissions ?? [])
    if (init.onDispose !== undefined) this.onDispose = init.onDispose
  }

  get disposed(): boolean {
    return this.disposePromise !== undefined
  }

  async invoke(handlerId: string, input?: ArtifactOperationInput): Promise<unknown> {
    if (this.disposed) {
      throw new ModkitError({
        code: 'CONFIG_INVALID',
        message: 'Artifact operation session has already been disposed.',
        context: { codecId: this.codecId, handlerId },
      })
    }
    throwIfCancelled(this.context.cancellation)
    if (input !== undefined && !isJsonSerializable(input)) {
      throw new ModkitError({
        code: 'CONFIG_INVALID',
        message: 'Artifact operation input must be JSON-serializable.',
        context: { codecId: this.codecId, handlerId },
      })
    }

    const operation = this.descriptor.operations.find(
      candidate => operationHandlerId(candidate) === handlerId,
    )
    if (operation === undefined) {
      throw new ModkitError({
        code: 'CONFIG_INVALID',
        message: 'Artifact operation handler is not declared by this document.',
        context: { codecId: this.codecId, handlerId },
      })
    }
    if (operation.state !== 'available') {
      throw new ModkitError({
        code: 'CONFIG_INVALID',
        message: 'Artifact operation is not available for this document.',
        context: {
          codecId: this.codecId,
          handlerId,
          operationId: operation.id,
          state: operation.state,
          reason: operation.reason,
        },
        ...(operation.reason === undefined ? {} : { hint: operation.reason.message }),
      })
    }

    const missingPermissions = (operation.permissions ?? []).filter(
      permission => !this.permissions.has(permission),
    )
    if (missingPermissions.length > 0) {
      throw new ModkitError({
        code: 'CONFIG_INVALID',
        message: 'Artifact operation requires permissions not granted to this session.',
        context: {
          codecId: this.codecId,
          handlerId,
          operationId: operation.id,
          missingPermissions,
        },
      })
    }

    const handler = this.handlers[handlerId]
    if (handler === undefined) {
      throw new ModkitError({
        code: 'CONFIG_INVALID',
        message: 'Artifact operation handler is not registered by the selected codec.',
        context: { codecId: this.codecId, handlerId, operationId: operation.id },
      })
    }
    return handler({
      document: this.document,
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

export function createArtifactOperationSession<TDocument>(
  init: CreateArtifactOperationSessionInit<TDocument>,
): ArtifactOperationSession {
  return new DefaultArtifactOperationSession(init)
}
