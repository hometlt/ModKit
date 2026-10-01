/** Requires in-process source and target composition receipts issued by the UVP compositor. */
export function verifyUvwGltfMigration(sourceReceipt: unknown, targetReceipt: unknown, options: {
  sourcePackageId: string; sourcePath: string; targetPackageId: string; targetPath: string;
  materialPolicies?: readonly { spaceId: string; layerId: string; materialId: string; policy: Record<string, unknown> }[];
  resourceMappings?: readonly { spaceId: string; layerId: string; resourceId: string;
    originalPath?: string; outputs: readonly { usage: string; uri: string; mimeType?: 'image/png' | 'image/jpeg';
      encoding?: 'rgba8-unorm'; sampler?: Record<string, unknown> }[] }[];
  rasterPolicies?: readonly { spaceId: string; layerId: string; sampling: Record<string, unknown>;
    inlinePreview?: { role: 'assert-equivalent-preview'; maxAbsError: number } }[];
}): Promise<Record<string, unknown>>
