/**
 * Browser-safe companion resolution contracts.
 *
 * Byte resolution and runtime-source resolution are deliberately separate: a byte resolver
 * transfers a payload value, while a source resolver returns a handle whose
 * lifecycle remains owned by its caller. This module therefore does not adapt source handles
 * to bytes or create source handles from bytes implicitly.
 */

import { ModkitError } from '@modkitx/core/errors'
import { throwIfCancelled } from './cancellation.js'
import type { AssetRequest, AssetResolver } from './companions.js'
import type { AssetReadOptions, AssetSource } from './source.js'

type MaybePromise<T> = T | Promise<T>

/** Resolves declared companions to byte payloads without exposing source-handle ownership. */
export interface AssetByteResolver {
  resolveBytes(
    request: AssetRequest,
    options?: AssetReadOptions,
  ): MaybePromise<Uint8Array | undefined>
  /** List candidate companions for picker/default selection. */
  list?(pattern: string, role?: string): MaybePromise<string[]>
}

/**
 * Resolves declared companions to runtime source handles.
 *
 * The caller owns the returned handle and decides whether or when its optional `dispose`
 * method is called. Resolver adapters must not dispose it implicitly.
 */
export interface AssetSourceResolver {
  resolveSource(request: AssetRequest, options?: AssetReadOptions): Promise<AssetSource | undefined>
}

/**
 * Presents the compatibility {@link AssetResolver} surface as an {@link AssetByteResolver}.
 *
 * Legacy resolvers cannot observe cancellation while their own work is running. The adapter
 * checks before dispatch and again before returning an async result, and enforces `maxBytes`
 * after resolution.
 */
export function assetByteResolverFromAssetResolver(resolver: AssetResolver): AssetByteResolver {
  return {
    resolveBytes(request, options) {
      throwIfCancelled(options?.cancellation, 'Companion resolution cancelled')
      const result = resolver.resolve(request)
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(bytes => validateResolvedBytes(bytes, request, options))
      }
      return validateResolvedBytes(result, request, options)
    },
    ...(resolver.list === undefined
      ? {}
      : { list: (pattern: string, role?: string) => resolver.list!(pattern, role) }),
  }
}

/** Presents an {@link AssetByteResolver} through the compatibility {@link AssetResolver} API. */
export function assetResolverFromAssetByteResolver(resolver: AssetByteResolver): AssetResolver {
  return {
    resolve: request => resolver.resolveBytes(request),
    ...(resolver.list === undefined
      ? {}
      : { list: (pattern: string, role?: string) => resolver.list!(pattern, role) }),
  }
}

/** Binds the optional relative resolver of one source as an explicit source resolver. */
export function assetSourceResolverFromSource(source: AssetSource): AssetSourceResolver {
  return {
    async resolveSource(request, options) {
      throwIfCancelled(options?.cancellation, 'Companion source resolution cancelled')
      return source.resolve?.(request, options)
    },
  }
}

function validateResolvedBytes(
  bytes: Uint8Array | undefined,
  request: AssetRequest,
  options: AssetReadOptions | undefined,
): Uint8Array | undefined {
  throwIfCancelled(options?.cancellation, 'Companion resolution cancelled')
  if (
    bytes !== undefined &&
    options?.maxBytes !== undefined &&
    bytes.byteLength > options.maxBytes
  ) {
    throw new ModkitError({
      code: 'ASSET_LIMIT_EXCEEDED',
      message: 'Resolved companion exceeds the configured byte limit.',
      context: {
        path: request.path,
        ...(request.role === undefined ? {} : { role: request.role }),
        actualBytes: bytes.byteLength,
        maxBytes: options.maxBytes,
      },
    })
  }
  return bytes
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === 'function'
}
