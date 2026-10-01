/** Type surface used by the runtime's verified-composition fixture. */
export function encodeUvb(module: unknown): Uint8Array
export function uvbIdentityDigest(bytes: Uint8Array): Promise<string>
export function decodeUvb(bytes: Uint8Array): Readonly<{
  requires: Readonly<{ intrinsics: readonly string[] }>
}>
