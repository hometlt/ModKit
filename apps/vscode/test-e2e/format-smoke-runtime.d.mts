export interface FormatSmokeRouteStep {
  readonly formatId: string
  readonly extensionId: string
  readonly contributionId: string
}

export interface FormatSmokeNamedExclusion {
  readonly kind: 'named-exclusion'
  readonly reason: string
}

export interface FormatSmokeFileCorpus {
  readonly kind: 'workspace-reference' | 'sc2-install-file' | 'warzone-install-file'
  path: string
  readonly bytes: number
  readonly sha256: string
}

export interface FormatSmokeContainerCorpus {
  readonly kind: 'sc2-casc-entry' | 'warzone-wz-entry'
  path: string
  readonly container?: string
  readonly bytes: number
  readonly sha256: string
}

export interface FormatSmokeAuthorityCase {
  readonly id: string
  readonly family: string
  readonly formats: readonly string[]
  readonly route: readonly FormatSmokeRouteStep[]
  readonly stage: 'raster' | 'tree-text' | 'tree' | 'metadata-tree' | 'model-or-wireframe'
  readonly runtime: { readonly vscode: 'open' }
  corpus: FormatSmokeNamedExclusion | FormatSmokeFileCorpus | FormatSmokeContainerCorpus
}

export interface FormatSmokeAuthority {
  readonly kind: 'x3.ga-recovery/format-family-smoke'
  readonly schemaVersion: 1
  cases: [FormatSmokeAuthorityCase, ...FormatSmokeAuthorityCase[]]
  readonly namedExclusions: readonly { readonly id: string; readonly reason: string }[]
}

export interface FormatSmokeRoots {
  readonly workspaceRoot: string
  readonly sc2InstallRoot: string
  readonly warzoneInstallRoot: string
}

export interface FormatSmokeFileSource {
  readonly kind: 'file'
  readonly filePath: string
  readonly uri: string
  readonly expectedBytes: number
  readonly expectedSha256: string
}

export interface FormatSmokeContainerSource {
  readonly kind: 'container-entry'
  readonly containerKind: 'sc2-casc' | 'warzone-wz'
  readonly containerPath: string
  readonly entryPath: string
  readonly uri: string
  readonly expectedBytes: number
  readonly expectedSha256: string
}

export interface FormatSmokeOpenCase {
  readonly kind: 'open'
  readonly id: string
  readonly family: string
  readonly formats: readonly string[]
  readonly stage: 'raster' | 'tree-text' | 'tree' | 'metadata-tree' | 'model-or-wireframe'
  readonly selectedRoute: readonly FormatSmokeRouteStep[]
  readonly source: FormatSmokeFileSource | FormatSmokeContainerSource
}

export interface FormatSmokeExcludedCase {
  readonly kind: 'excluded'
  readonly id: string
  readonly family: string
  readonly formats: readonly string[]
  readonly stage: string
  readonly selectedRoute: readonly FormatSmokeRouteStep[]
  readonly reason: string
}

export type FormatSmokeCase = FormatSmokeOpenCase | FormatSmokeExcludedCase

export interface FormatSmokeVerificationCase {
  readonly id: string
  readonly kind: 'open'
  readonly source: FormatSmokeFileSource | FormatSmokeContainerSource
}

export interface FormatSmokeWebviewObservation {
  readonly caseId: string
  readonly uri: string
  readonly selectedRoute: readonly FormatSmokeRouteStep[]
  readonly raster?: {
    readonly width: number
    readonly height: number
    readonly opaquePixels: number
  }
  readonly metadata?: { readonly entryCount: number }
  readonly tree?: { readonly nodeCount: number }
  readonly text?: { readonly characterCount: number }
  readonly model?: {
    readonly canvas?: { readonly width: number; readonly height: number }
    readonly wireframeFallback?: { readonly recorded: boolean; readonly segmentCount: number }
  }
}

export const DEFAULT_FORMAT_SMOKE_AUTHORITY: string
export const FORMAT_SMOKE_CASE_IDS: readonly string[]
export function validateFormatSmokeAuthority(value: unknown): FormatSmokeAuthority
export function loadFormatSmokeAuthority(authorityPath?: string): FormatSmokeAuthority
export function formatSmokeContainerUri(containerPath: string, entry: string): string
export function parseFormatSmokeContainerUri(
  uri: string,
): { readonly containerPath: string; readonly entryPath: string } | undefined
export function resolveFormatSmokeCases(
  authority: FormatSmokeAuthority,
  roots: FormatSmokeRoots,
): readonly FormatSmokeCase[]
export function verifyFormatSmokeCorpusBeforeOpen(
  testCase: FormatSmokeVerificationCase,
  options?: {
    readonly readContainerEntry?: (source: {
      readonly containerKind: 'sc2-casc' | 'warzone-wz'
      readonly containerPath: string
      readonly entryPath: string
      readonly uri: string
    }) => Promise<Uint8Array | ArrayBuffer>
  },
): Promise<{
  readonly caseId: string
  readonly verifiedBeforeOpen: true
  readonly bytes: number
  readonly sha256: string
}>
export function assertFormatSmokeWebviewResult(
  testCase: FormatSmokeOpenCase,
  observation: FormatSmokeWebviewObservation,
): {
  readonly verdict: 'pass'
  readonly stage: FormatSmokeOpenCase['stage']
  readonly assertions: readonly string[]
}
