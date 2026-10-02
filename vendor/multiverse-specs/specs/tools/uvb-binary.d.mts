/** Type surface used by the runtime's verified-composition fixture. */
export function encodeUvb(module: unknown): Uint8Array
export function uvbIdentityDigest(bytes: Uint8Array): Promise<string>
export function decodeUvb(bytes: Uint8Array): Readonly<{
  namespace: string
  functions: readonly Readonly<{ name: string; params: readonly string[]; returns: string
    effects: Readonly<{ reads: readonly string[]; writes: readonly string[] }> }>[]
  requires: Readonly<{ intrinsics: readonly string[] }>
}>
