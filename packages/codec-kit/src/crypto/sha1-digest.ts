/**
 * SHA-1 of bytes through the platform's Web Crypto (Node, browsers, workers); the pinned MK2
 * `crypto/sha1` hashes strings only. For formats that store a SHA-1 for integrity (the Unreal pak
 * index), not for security.
 */
export async function sha1Digest(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined)
    throw new TypeError('SHA-1 needs the standard Web Crypto implementation')
  return new Uint8Array(await subtle.digest('SHA-1', Uint8Array.from(bytes)))
}
