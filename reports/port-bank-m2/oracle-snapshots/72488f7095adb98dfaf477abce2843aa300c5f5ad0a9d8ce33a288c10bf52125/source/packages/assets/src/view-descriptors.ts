/**
 * Presentation-neutral code and hexadecimal view contracts.
 *
 * These values cross host/process boundaries, so they deliberately contain only JSON data.
 * Runtime sources, language services, save handlers, and UI factories are referenced by stable
 * IDs and are resolved by the owning host.
 */

import type { AssetSourceDescriptor, SourceRange } from './source.js'

export const VIEW_DESCRIPTOR_SCHEMA_VERSION = 1

export interface ViewSourceVersion {
  /** Provider-owned freshness token (etag, mtime+size hash, archive generation, etc.). */
  readonly token: string
  /** Size observed when the descriptor was produced. */
  readonly size?: number
  readonly modifiedAt?: number
}

export interface TextPosition {
  readonly line: number
  readonly column: number
}

export interface TextRange {
  readonly start: TextPosition
  readonly end: TextPosition
}

export interface CodeViewSelection {
  readonly range: TextRange
  readonly reveal?: 'start' | 'center' | 'end'
}

export interface HexViewSelection {
  readonly offset: number
  readonly length: number
}

export interface ViewCommandDescriptor {
  readonly id: string
  readonly label: string
  readonly group?: string
  readonly enabled: boolean
  readonly disabledReason?: string
}

export interface ViewEditCapability {
  readonly state: 'read-only' | 'editable'
  /** Stable host/codec handler ID. No handler means that the view is read-only. */
  readonly saveHandlerId?: string
  readonly reason?: string
}

export interface ViewResourcePolicy {
  /** Largest source this presentation may materialize as one decoded value. */
  readonly maxMaterializedBytes: number
  /** Sources above this threshold must use paging or metadata-only presentation. */
  readonly pageAboveBytes: number
  readonly pageBytes: number
}

export interface CodeViewDiffDescriptor {
  readonly original: AssetSourceDescriptor
  readonly originalVersion?: ViewSourceVersion
  readonly modified: AssetSourceDescriptor
  readonly modifiedVersion?: ViewSourceVersion
}

export interface CodeViewDescriptor {
  readonly schemaVersion: 1
  readonly kind: 'code'
  readonly id: string
  readonly title: string
  readonly source: AssetSourceDescriptor
  readonly sourceVersion?: ViewSourceVersion
  readonly mode: 'read-only' | 'edit' | 'diff'
  readonly languageId?: string
  readonly encoding: string
  readonly selection?: CodeViewSelection
  readonly diff?: CodeViewDiffDescriptor
  readonly languageContributionIds?: readonly string[]
  readonly commands?: readonly ViewCommandDescriptor[]
  readonly edit: ViewEditCapability
  readonly policy: ViewResourcePolicy
}

export interface StructureRangeAnnotation {
  readonly id: string
  readonly range: SourceRange
  readonly label: string
  readonly kind?: string
  readonly colorToken?: string
  readonly description?: string
  readonly diagnosticIds?: readonly string[]
  readonly reference?: {
    readonly subjectId?: string
    readonly sourceId?: string
    readonly range?: SourceRange
  }
}

export interface HexViewDiffDescriptor {
  readonly source: AssetSourceDescriptor
  readonly sourceVersion?: ViewSourceVersion
}

export interface HexViewDescriptor {
  readonly schemaVersion: 1
  readonly kind: 'hex'
  readonly id: string
  readonly title: string
  readonly source: AssetSourceDescriptor
  readonly sourceVersion?: ViewSourceVersion
  readonly selection?: HexViewSelection
  readonly bytesPerRow: number
  readonly groupBytes: number
  readonly endianness: 'little' | 'big'
  readonly annotations?: readonly StructureRangeAnnotation[]
  readonly diff?: HexViewDiffDescriptor
  readonly commands?: readonly ViewCommandDescriptor[]
  readonly edit: ViewEditCapability
  readonly policy: ViewResourcePolicy
}

export type AssetViewDescriptor = CodeViewDescriptor | HexViewDescriptor

export const DEFAULT_CODE_VIEW_POLICY: ViewResourcePolicy = Object.freeze({
  maxMaterializedBytes: 16 * 1024 * 1024,
  pageAboveBytes: 4 * 1024 * 1024,
  pageBytes: 256 * 1024,
})

export const DEFAULT_HEX_VIEW_POLICY: ViewResourcePolicy = Object.freeze({
  maxMaterializedBytes: 1024 * 1024,
  pageAboveBytes: 0,
  pageBytes: 64 * 1024,
})

export interface ViewFallbackInput {
  readonly source: AssetSourceDescriptor
  /** A codec/provider declaration is authoritative over sampling. */
  readonly contentKind?: 'text' | 'binary'
  readonly sample?: Uint8Array
  readonly hostId: string
  readonly codePolicy?: ViewResourcePolicy
  readonly hexPolicy?: ViewResourcePolicy
  readonly languageId?: string
}

export interface ViewFallbackRoute {
  readonly target: 'native-code' | 'code-viewer' | 'hex-viewer'
  readonly descriptor: CodeViewDescriptor | HexViewDescriptor
  readonly reason: 'declared-text' | 'declared-binary' | 'sampled-text' | 'unknown-binary'
}

/** Conservative content probe used only when no codec/provider declared the content kind. */
export function sampleLooksText(sample: Uint8Array): boolean {
  const length = Math.min(sample.byteLength, 4096)
  if (length === 0) return true
  let controls = 0
  for (let index = 0; index < length; index += 1) {
    const byte = sample[index]!
    if (byte === 0) return false
    if (byte < 9 || (byte > 13 && byte < 32)) controls += 1
  }
  return controls / length < 0.02
}

/**
 * Chooses the standard fallback without interpreting a format name or extension. VS Code uses its
 * native editor for code/text; every other host resolves the same descriptor with code-viewer.
 */
export function routeViewFallback(input: ViewFallbackInput): ViewFallbackRoute {
  const isText =
    input.contentKind === 'text' ||
    (input.contentKind === undefined && input.sample !== undefined && sampleLooksText(input.sample))
  const reason =
    input.contentKind === 'text'
      ? 'declared-text'
      : input.contentKind === 'binary'
        ? 'declared-binary'
        : isText
          ? 'sampled-text'
          : 'unknown-binary'
  const version = sourceVersionOf(input.source)

  if (isText) {
    const descriptor: CodeViewDescriptor = {
      schemaVersion: VIEW_DESCRIPTOR_SCHEMA_VERSION,
      kind: 'code',
      id: `code:${input.source.id}`,
      title: input.source.name,
      source: input.source,
      ...(version === undefined ? {} : { sourceVersion: version }),
      mode: 'read-only',
      ...(input.languageId === undefined ? {} : { languageId: input.languageId }),
      encoding: 'utf-8',
      edit: { state: 'read-only', reason: 'Fallback views do not own a codec save transaction.' },
      policy: input.codePolicy ?? DEFAULT_CODE_VIEW_POLICY,
    }
    return {
      target: input.hostId === 'vscode' ? 'native-code' : 'code-viewer',
      descriptor,
      reason,
    }
  }

  return {
    target: 'hex-viewer',
    descriptor: {
      schemaVersion: VIEW_DESCRIPTOR_SCHEMA_VERSION,
      kind: 'hex',
      id: `hex:${input.source.id}`,
      title: input.source.name,
      source: input.source,
      ...(version === undefined ? {} : { sourceVersion: version }),
      bytesPerRow: 16,
      groupBytes: 1,
      endianness: 'little',
      edit: { state: 'read-only', reason: 'Hex viewer v1 is read-only.' },
      policy: input.hexPolicy ?? DEFAULT_HEX_VIEW_POLICY,
    },
    reason,
  }
}

function sourceVersionOf(source: AssetSourceDescriptor): ViewSourceVersion | undefined {
  if (
    source.versionToken === undefined &&
    source.size === undefined &&
    source.modifiedAt === undefined
  ) {
    return undefined
  }
  return {
    token: source.versionToken ?? `${source.modifiedAt ?? 'unknown'}:${source.size ?? 'unknown'}`,
    ...(source.size === undefined ? {} : { size: source.size }),
    ...(source.modifiedAt === undefined ? {} : { modifiedAt: source.modifiedAt }),
  }
}
