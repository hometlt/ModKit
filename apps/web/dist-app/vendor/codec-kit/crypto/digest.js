import {
  ModkitError
} from "../../../chunks/chunk-XYIUXPQM.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// ../../MODDING/modkit-core/packages/codec-kit/dist/crypto/digest.js
async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ModkitError({
      code: "CODEC_RUNTIME_LOAD_FAILED",
      message: "The UVM writer requires the standard Web Crypto SHA-256 implementation."
    });
  }
  const input = Uint8Array.from(bytes);
  const digest = new Uint8Array(await subtle.digest("SHA-256", input));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}
export {
  sha256Hex
};
