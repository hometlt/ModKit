/** Browser-portable canonical UVB 2 value codec. */
export function encodeCanonicalValue(input: Readonly<{ type: string; value: unknown }>,
  declarations?: readonly unknown[]): Uint8Array
export function decodeCanonicalValue(bytes: Uint8Array,
  declarations?: readonly unknown[]): Readonly<{ type: string; value: unknown }>
