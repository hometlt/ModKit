import {
  snapshotJson
} from "./chunk-3YDGNEY2.js";
import {
  ModkitError
} from "./chunk-NBEJVPOY.js";

// packages/uv/dist/model/legacy/container-kernels.js
var GLB_MAGIC = 1179937895;
var GLB_JSON_CHUNK = 1313821514;
var GLB_BIN_CHUNK = 5130562;
function decodeUvmContainer(bytes) {
  if (isGlb(bytes))
    return decodeGlb(bytes);
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("root");
    return { document: parsed, binary: new Uint8Array() };
  } catch (cause) {
    throw new ModkitError({
      code: "PARSE_FAILED",
      message: "UVM input is neither a valid GLB nor a JSON glTF document.",
      cause
    });
  }
}
function isGlb(bytes) {
  return bytes.length >= 12 && readUint32(bytes, 0) === GLB_MAGIC;
}
function decodeGlb(bytes) {
  if (readUint32(bytes, 4) !== 2)
    throw corrupt("Only GLB version 2 is supported.");
  const declaredLength = readUint32(bytes, 8);
  if (declaredLength !== bytes.length)
    throw corrupt("GLB declared length does not match input.");
  if (bytes.length < 20 || readUint32(bytes, 16) !== GLB_JSON_CHUNK) {
    throw corrupt("GLB JSON chunk is missing or not first.");
  }
  const jsonLength = readUint32(bytes, 12);
  const jsonEnd = 20 + jsonLength;
  if (jsonEnd > bytes.length)
    throw corrupt("GLB JSON chunk exceeds the input length.");
  let document;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, jsonEnd)).trimEnd();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("root");
    document = parsed;
  } catch (cause) {
    throw new ModkitError({
      code: "PARSE_FAILED",
      message: "UVM GLB JSON chunk is invalid.",
      cause
    });
  }
  if (jsonEnd === bytes.length)
    return { document, binary: new Uint8Array() };
  if (jsonEnd + 8 > bytes.length || readUint32(bytes, jsonEnd + 4) !== GLB_BIN_CHUNK) {
    throw corrupt("UVM GLB contains an invalid second chunk.");
  }
  const binLength = readUint32(bytes, jsonEnd);
  const binStart = jsonEnd + 8;
  if (binStart + binLength !== bytes.length)
    throw corrupt("GLB BIN chunk length is invalid.");
  return { document, binary: bytes.slice(binStart, binStart + binLength) };
}
function readUint32(bytes, offset) {
  if (offset + 4 > bytes.length)
    throw corrupt("GLB header is truncated.");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}
function corrupt(message) {
  return new ModkitError({ code: "PARSE_FAILED", message });
}

// packages/uv/dist/model/container.js
var GLB_MAGIC2 = 1179937895;
var JSON_CHUNK = 1313821514;
var BIN_CHUNK = 5130562;
var encoder = new TextEncoder();
var DEFAULT_UVM_CONTAINER_BUDGET = Object.freeze({
  maxInputBytes: 268435456,
  maxJsonBytes: 67108864,
  maxDepth: 128,
  maxNodes: 1e6
});
function checkUvmContainerBudget(budget) {
  for (const value of [budget.maxInputBytes, budget.maxJsonBytes, budget.maxDepth, budget.maxNodes])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError("invalid UVM container budget");
}
function readUvmContainer(bytes, budget = DEFAULT_UVM_CONTAINER_BUDGET, signal) {
  checkUvmContainerBudget(budget);
  if (signal?.aborted)
    throw new DOMException("operation cancelled", "AbortError");
  if (bytes.byteLength > budget.maxInputBytes)
    throw new RangeError("UVM exceeds maxInputBytes");
  bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = isGlb(bytes) ? "glb" : "gltf";
  const extraChunks = [];
  let primary = bytes;
  if (format === "glb") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8, true) !== bytes.byteLength || view.getUint32(4, true) !== 2)
      throw new TypeError("invalid GLB version or declared length");
    let cursor = 12;
    let count = 0;
    let primaryEnd = 12;
    while (cursor < bytes.length) {
      if (cursor + 8 > bytes.length)
        throw new TypeError("truncated GLB chunk header");
      const length = view.getUint32(cursor, true);
      const type = view.getUint32(cursor + 4, true);
      const end = cursor + 8 + length;
      if (length % 4 !== 0 || end > bytes.length)
        throw new TypeError("invalid GLB chunk length or alignment");
      if (count === 0 && type !== JSON_CHUNK)
        throw new TypeError("GLB JSON chunk must be first");
      if (type === JSON_CHUNK) {
        if (count !== 0)
          throw new TypeError("duplicate GLB JSON chunk");
        if (length > budget.maxJsonBytes)
          throw new RangeError("UVM exceeds maxJsonBytes");
        primaryEnd = end;
      } else if (type === BIN_CHUNK) {
        if (count !== 1)
          throw new TypeError("GLB BIN chunk must be second and unique");
        primaryEnd = end;
      } else {
        extraChunks.push(Object.freeze({ type, bytes: bytes.slice(cursor + 8, end) }));
      }
      cursor = end;
      count++;
      if (count > budget.maxNodes)
        throw new RangeError("GLB chunk count exceeds maxNodes");
    }
    if (extraChunks.length > 0) {
      primary = bytes.slice(0, primaryEnd);
      new DataView(primary.buffer, primary.byteOffset, primary.byteLength).setUint32(8, primary.byteLength, true);
    }
  } else if (bytes.byteLength > budget.maxJsonBytes)
    throw new RangeError("UVM exceeds maxJsonBytes");
  const decoded = decodeUvmContainer(primary);
  const document = snapshotJson(decoded.document, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
  return Object.freeze({
    format,
    document,
    binary: decoded.binary,
    extraChunks: Object.freeze(extraChunks)
  });
}
function writeUvmContainer(container, budget = DEFAULT_UVM_CONTAINER_BUDGET, signal) {
  checkUvmContainerBudget(budget);
  if (container.format !== "glb" && container.format !== "gltf")
    throw new TypeError("invalid UVM container format");
  if (container.extraChunks.length > budget.maxNodes)
    throw new RangeError("GLB chunk count exceeds maxNodes");
  const document = snapshotJson(container.document, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
  const jsonBytes = encoder.encode(JSON.stringify(document));
  const length = container.format === "gltf" ? jsonBytes.byteLength : 28 + Math.ceil(jsonBytes.byteLength / 4) * 4 + Math.ceil(container.binary.byteLength / 4) * 4 + container.extraChunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0);
  if (length > budget.maxInputBytes || length > 4294967295)
    throw new RangeError("UVM output exceeds maxInputBytes");
  if (container.format === "gltf") {
    if (container.binary.byteLength || container.extraChunks.length)
      throw new TypeError("JSON glTF cannot carry unbound binary chunks");
    return jsonBytes;
  }
  for (const chunk of container.extraChunks)
    if (!Number.isSafeInteger(chunk.type) || chunk.type < 0 || chunk.type > 4294967295 || chunk.type === JSON_CHUNK || chunk.type === BIN_CHUNK || chunk.bytes.length % 4 !== 0)
      throw new TypeError("invalid opaque GLB chunk");
  const standard = packSerializedUvmGlb(jsonBytes, container.binary);
  if (container.extraChunks.length === 0)
    return standard;
  const parts = [standard];
  for (const chunk of container.extraChunks)
    parts.push(le32(chunk.bytes.length), le32(chunk.type), chunk.bytes);
  const result = concat(parts);
  new DataView(result.buffer).setUint32(8, result.byteLength, true);
  return result;
}
function le32(value) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}
function pad4(bytes, fill) {
  const result = new Uint8Array(bytes.byteLength + 3 & ~3);
  result.fill(fill);
  result.set(bytes);
  return result;
}
function concat(parts) {
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const result = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    result.set(part, cursor);
    cursor += part.byteLength;
  }
  return result;
}
function packUvmGlb(document, binary) {
  return packSerializedUvmGlb(encoder.encode(JSON.stringify(document)), binary);
}
function packSerializedUvmGlb(jsonBytes, binary) {
  const json = pad4(jsonBytes, 32);
  const bin = pad4(binary, 0);
  const length = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  return concat([
    le32(GLB_MAGIC2),
    le32(2),
    le32(length),
    le32(json.byteLength),
    le32(JSON_CHUNK),
    json,
    le32(bin.byteLength),
    le32(BIN_CHUNK),
    bin
  ]);
}
var URI_PATH_CHARACTER = /^[A-Za-z0-9\-._~!$&'()*+,;=@/]$/u;
function uvmImageUri(logicalId) {
  let uri = "";
  for (const character of logicalId) {
    if (URI_PATH_CHARACTER.test(character))
      uri += character;
    else
      for (const byte of encoder.encode(character))
        uri += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return uri;
}
function uvmImageLogicalId(uri) {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

export {
  DEFAULT_UVM_CONTAINER_BUDGET,
  checkUvmContainerBudget,
  readUvmContainer,
  writeUvmContainer,
  packUvmGlb,
  uvmImageUri,
  uvmImageLogicalId
};
