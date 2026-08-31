export type IdentityFamily = 'package' | 'qualified' | 'source'
export type IdentityDocumentKind = 'settings' | 'extension-lock' | 'policy-lock' | 'catalog'
export type IdentityFileStatus =
  'skipped' | 'error' | 'blocked' | 'changed' | 'would-change' | 'unchanged'

export interface IdentityMigrationRule {
  readonly id: string
  readonly family: IdentityFamily
  readonly kind: 'exact' | 'prefix'
  readonly from: string
  readonly to: string
}

export interface NormalizedIdentifier {
  readonly value: unknown
  readonly changed: boolean
  readonly rule?: string
}

export interface IdentityMigrationChange {
  readonly path: string
  readonly from: string
  readonly to: string
  readonly rule: string | undefined
  readonly family: IdentityFamily
}

export interface IdentityMigrationCollision {
  readonly path: string
  readonly target: string
  readonly sources: readonly string[]
  readonly reason: string
}

export interface IdentityMigrationSkippedReference {
  readonly path: string
  readonly reason: string
}

export interface IdentityMigrationDocumentResult {
  readonly schemaVersion: 1
  readonly document: unknown
  readonly documentKind: IdentityDocumentKind
  readonly changed: boolean
  readonly writable: boolean
  readonly changes: readonly IdentityMigrationChange[]
  readonly collisions: readonly IdentityMigrationCollision[]
  readonly skippedReferences: readonly IdentityMigrationSkippedReference[]
}

export interface IdentityFileResult {
  readonly schemaVersion: 1
  readonly path: string
  readonly status: IdentityFileStatus
  readonly documentKind?: IdentityDocumentKind
  readonly reason?: string
  readonly mode: 'audit' | 'write'
  readonly changes: readonly IdentityMigrationChange[]
  readonly collisions: readonly IdentityMigrationCollision[]
  readonly skippedReferences: readonly IdentityMigrationSkippedReference[]
}

export interface IdentityMigrationReport {
  readonly schemaVersion: 1
  readonly mode: 'audit' | 'write'
  readonly root: string
  readonly files: readonly IdentityFileResult[]
  readonly summary: Readonly<{
    readonly changed: number
    readonly wouldChange: number
    readonly unchanged: number
    readonly skipped: number
    readonly blocked: number
    readonly errors: number
    readonly changes: number
    readonly collisions: number
    readonly skippedReferences: number
  }>
}

export const IDENTITY_MIGRATION_SCHEMA_VERSION: 1
export const IDENTITY_MIGRATION_RULES: readonly IdentityMigrationRule[]

export function normalizeIdentifier(
  value: unknown,
  options?: { readonly family?: IdentityFamily },
): NormalizedIdentifier

export function isLegacyIdentifier(value: unknown): boolean
export function parseIdentityJson(text: string, label?: string): unknown
export function renderIdentityJson(value: unknown): string

export function migrateIdentityDocument(
  input: unknown,
  options?: { readonly documentKind?: IdentityDocumentKind },
): IdentityMigrationDocumentResult

export function historicalIdentityPathReason(path: string, root?: string): string | undefined
export function classifyIdentityDocumentPath(
  path: string,
  options?: {
    readonly root?: string
    readonly documentKind?: IdentityDocumentKind
    readonly forceHistorical?: boolean
  },
):
  | Readonly<{ readonly status: 'skipped'; readonly reason: string }>
  | Readonly<{ readonly status: 'recognized'; readonly documentKind: IdentityDocumentKind }>

export function migrateIdentityFile(
  path: string,
  options?: {
    readonly root?: string
    readonly documentKind?: IdentityDocumentKind
    readonly forceHistorical?: boolean
    readonly write?: boolean
  },
): IdentityFileResult

export function discoverIdentityDocumentPaths(root?: string): readonly string[]
export function identityMigrationReport(
  paths?: readonly string[],
  options?: {
    readonly root?: string
    readonly documentKind?: IdentityDocumentKind
    readonly forceHistorical?: boolean
    readonly write?: boolean
  },
): IdentityMigrationReport
export function assertIdentityMigrationReportWritable(report: IdentityMigrationReport): void
export function existingIdentityDocumentPaths(paths: readonly string[]): readonly string[]
export function writeIdentityMigrationReport(path: string, report: IdentityMigrationReport): string
export function ensureIdentityMigrationReportDirectory(path: string): string
