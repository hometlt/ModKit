export function canonicalStringify(value: unknown): string
export function canonicalBytes(value: unknown): Uint8Array
export function compareCanonicalKeys(left: string, right: string): number
export function jcsStringify(value: unknown): string
export function jcsBytes(value: unknown): Uint8Array
export function uvpJsonArtifactDigest(family: 'uvd' | 'uvw' | 'uvs', document: unknown): Promise<string>
export function uvpMediaArtifactDigest(bytes: Uint8Array): Promise<string>
