import "../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/crypto/sha1-digest.js
async function sha1Digest(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === void 0)
    throw new TypeError("SHA-1 needs the standard Web Crypto implementation");
  return new Uint8Array(await subtle.digest("SHA-1", Uint8Array.from(bytes)));
}
export {
  sha1Digest
};
