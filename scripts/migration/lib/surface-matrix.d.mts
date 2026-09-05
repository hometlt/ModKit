export type SurfaceMatrixAnchor =
  | 'sections'
  | 'tree'
  | 'hex'
  | 'card'
  | 'preview'
  | 'relations'
  | 'selector'
  | 'mcp-inspect'
  | 'script'
  | 'no-op-edit'

export interface SurfaceMatrixClaim {
  readonly applicable: boolean
  readonly sources: readonly string[]
}

export const SURFACE_ANCHORS: readonly SurfaceMatrixAnchor[]

export function surfaceClaimsForCodec(
  spec: unknown,
  writers?: readonly { readonly source: string }[],
): Readonly<Record<SurfaceMatrixAnchor, SurfaceMatrixClaim>>

export function buildSurfaceMatrix(inventories: readonly unknown[]): unknown

export function loadInventorySources(options: {
  readonly repoRoot: string
  readonly roots?: readonly { readonly label: string; readonly directory: string }[]
  readonly snapshots?: readonly {
    readonly label: string
    readonly repository: string
    readonly commit: string
  }[]
}): Promise<readonly unknown[]>
