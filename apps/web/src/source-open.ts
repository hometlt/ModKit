/**
 * Product-owned source adapters for locators that are not browser byte blobs.
 *
 * A CASC entry starts at an installed SC2 directory. The PWA cannot turn that locator into an
 * `ArtifactNamespaceSource` unless its composed host profile publishes random filesystem reads.
 * Refuse at this boundary, before reading or transporting entry bytes, and keep the error context
 * limited to path-free identities that an acceptance receipt may safely retain.
 */
import { ModkitError } from '@modkit/core'
import type { HostProfile } from '@modkit/sdk'

export const WEB_SOURCE_OPEN_BOUNDARY = 'modkit.app.web/source-open'
export const WEB_SOURCE_FACILITY_UNAVAILABLE = 'x3.host/facility-unavailable'
export const WEB_SOURCE_ADAPTER_UNAVAILABLE = 'x3.host/source-adapter-unavailable'
export const WEB_SOURCE_FILESYSTEM_READ_RANDOM = 'filesystem.read-random'

export interface WebSc2CascSourceOpenRequest {
  /** Opaque correlation id; never a filesystem locator. */
  readonly requestId: string
  readonly source: {
    readonly kind: 'sc2-casc-entry'
    /** Relative CASC entry locator. It is validated here and never copied into thrown context. */
    readonly entryPath: string
    readonly contentSha256: string
    readonly bytes: number
  }
  readonly requestedFormatId: string
}

export interface WebSourceOpenAdapter {
  openSc2CascEntry(request: WebSc2CascSourceOpenRequest): Promise<never>
}

type SourceHostProfile = Pick<HostProfile, 'realmId' | 'facilities'>

function validateSc2CascRequest(request: WebSc2CascSourceOpenRequest): void {
  const normalized = request.source.entryPath.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (
    request.requestId === '' ||
    request.source.kind !== 'sc2-casc-entry' ||
    normalized === '' ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    parts.some(part => part === '' || part === '.' || part === '..') ||
    !/^[a-f0-9]{64}$/u.test(request.source.contentSha256) ||
    !Number.isSafeInteger(request.source.bytes) ||
    request.source.bytes <= 0 ||
    request.requestedFormatId === ''
  ) {
    throw new TypeError('invalid SC2/CASC source-open request')
  }
}

/**
 * Bind source opening to the profile published by the composed page host.
 *
 * The current PWA intentionally has no filesystem adapter. If a future browser host publishes the
 * facility, it must also supply a real adapter rather than silently treating authority metadata as
 * entry bytes.
 */
export function createWebSourceOpenAdapter(profile: SourceHostProfile): WebSourceOpenAdapter {
  const facilities = new Set(profile.facilities)
  return Object.freeze({
    async openSc2CascEntry(request: WebSc2CascSourceOpenRequest): Promise<never> {
      validateSc2CascRequest(request)
      const safeContext = {
        boundary: WEB_SOURCE_OPEN_BOUNDARY,
        requestId: request.requestId,
        sourceKind: request.source.kind,
        contentSha256: request.source.contentSha256,
        bytes: request.source.bytes,
        requestedFormatId: request.requestedFormatId,
      } as const
      if (!facilities.has(WEB_SOURCE_FILESYSTEM_READ_RANDOM)) {
        throw new ModkitError({
          code: WEB_SOURCE_FACILITY_UNAVAILABLE,
          message: `the browser source host does not publish «${WEB_SOURCE_FILESYSTEM_READ_RANDOM}»`,
          context: {
            ...safeContext,
            facility: WEB_SOURCE_FILESYSTEM_READ_RANDOM,
          },
        })
      }
      throw new ModkitError({
        code: WEB_SOURCE_ADAPTER_UNAVAILABLE,
        message: 'the browser host publishes random filesystem reads but has no SC2/CASC adapter',
        context: safeContext,
      })
    },
  })
}
