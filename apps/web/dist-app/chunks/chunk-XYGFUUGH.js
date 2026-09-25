import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// packages/ui/dist/media/encoded.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
async function collectEncodedMedia(source, maximumBytes, signal) {
  const descriptor = await source.descriptor();
  if (descriptor.bytes > BigInt(maximumBytes) || descriptor.bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`encoded media exceeds the stage budget: ${descriptor.bytes} bytes`);
  }
  const total = Number(descriptor.bytes);
  const bytes = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    const chunk = await source.read(BigInt(offset), Math.min(1024 * 1024, total - offset), signal);
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError("encoded media ended outside its declared size");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { mediaType: descriptor.mediaType, bytes };
}

export {
  collectEncodedMedia
};
