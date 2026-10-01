/** The canonical UVW profile validator is the owner of world shape checks. */
export function assertUvwProfile(document: unknown): void
export function createUvwGltfDocument(document: unknown, options?: {
  materialPolicies?: readonly { spaceId: string; layerId: string; materialId: string; policy: {
    metallicFactor: number; roughnessFactor: number; alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
    alphaCutoff?: number; doubleSided?: boolean; waterColorSpace?: 'linear' | 'srgb';
  } }[]
}): Record<string, unknown>
/** Structural preparation only; verifyUvwGltfMigration binds two verified UVP compositions. */
export function prepareUvwGltfMigration(document: unknown, options: {
  sourcePath: string; targetPath: string;
  materialPolicies?: readonly { spaceId: string; layerId: string; materialId: string; policy: Record<string, unknown> }[];
  resourceMappings?: readonly { spaceId: string; layerId: string; resourceId: string;
    originalPath?: string; outputs: readonly { usage: string; uri: string; mimeType?: 'image/png' | 'image/jpeg';
      encoding?: 'rgba8-unorm'; sampler?: Record<string, unknown> }[] }[];
  rasterPolicies?: readonly { spaceId: string; layerId: string; sampling: Record<string, unknown>;
    inlinePreview?: { role: 'assert-equivalent-preview'; maxAbsError: number } }[];
}): { document: Record<string, unknown>; inventory: readonly unknown[]; materials: readonly unknown[];
  rasters: readonly unknown[]; visualLayers: readonly unknown[];
  scope: 'prepared' | 'preview' }
export function restoreUvwProfileDocument(document: unknown): Record<string, unknown>
