import {
  ModkitError
} from "../../../chunks/chunk-22GOWHCF.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/model/draco.js
var DEFAULT_LIMITS = Object.freeze({
  maxPoints: 16e6,
  maxFaces: 32e6
});
var runtime;
function cache(pending, message, hint) {
  runtime = pending.catch((cause) => {
    runtime = void 0;
    if (cause instanceof ModkitError)
      throw cause;
    throw new ModkitError({
      code: "codec-kit/draco-runtime-unavailable",
      message,
      cause,
      context: { hint }
    });
  });
  return runtime;
}
function isNodeRuntime() {
  const processValue = globalThis.process;
  return typeof processValue?.versions?.node === "string";
}
function initializeDracoBrowser(options) {
  if (runtime === void 0) {
    const text = String(options.assetBaseUrl);
    const base = new URL(text.endsWith("/") ? text : `${text}/`, import.meta.url);
    const moduleUrl = new URL("draco_decoder.js", base).href;
    runtime = cache(import(
      /* @vite-ignore @modkitx-external-runtime */
      moduleUrl
    ).then(async (module) => {
      const factory = module.default ?? globalThis.DracoDecoderModule;
      if (typeof factory !== "function")
        throw new Error("draco_decoder.js does not export a decoder factory");
      return factory({ locateFile: (path) => new URL(path, base).href });
    }), "Draco browser runtime failed to initialize", "Verify assetBaseUrl and that draco_decoder.js and draco_decoder.wasm are deployed.");
  }
  return runtime.then(() => void 0);
}
function decoderModule() {
  if (runtime === void 0) {
    if (!isNodeRuntime()) {
      throw new ModkitError({
        code: "codec-kit/draco-runtime-unavailable",
        message: "Draco decoding is not initialized in this browser host",
        context: { hint: "Call initializeDracoBrowser({ assetBaseUrl }) before decoding." }
      });
    }
    const packageName = ["draco", "3d"].join("");
    runtime = cache(import(
      /* @modkitx-external-runtime */
      packageName
    ).then((module) => {
      const exports = module;
      const factory = exports.createDecoderModule ?? exports.default?.createDecoderModule;
      if (typeof factory !== "function")
        throw new Error("draco3d does not export createDecoderModule");
      return factory({});
    }), "Draco Node runtime failed to load", "Install the draco3d dependency of @modkit/codec-kit.");
  }
  return runtime;
}
var DRACO_MALFORMED = "codec-kit/draco-malformed";
function malformed(message) {
  const error = new RangeError(`Draco geometry ${message}`);
  Object.defineProperty(error, "code", { value: DRACO_MALFORMED, enumerable: true });
  return error;
}
function attributeType(module, value) {
  if (value === module.POSITION)
    return "position";
  if (value === module.NORMAL)
    return "normal";
  if (value === module.COLOR)
    return "color";
  if (value === module.TEX_COORD)
    return "texcoord";
  if (value === module.GENERIC)
    return "generic";
  return "invalid";
}
function dataType(module, value) {
  switch (value) {
    case module.DT_INT8:
      return "int8";
    case module.DT_UINT8:
      return "uint8";
    case module.DT_INT16:
      return "int16";
    case module.DT_UINT16:
      return "uint16";
    case module.DT_INT32:
      return "int32";
    case module.DT_UINT32:
      return "uint32";
    default:
      return "float32";
  }
}
var BYTES = Object.freeze({
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4
});
function typed(type, bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  switch (type) {
    case "int8":
      return new Int8Array(buffer);
    case "uint8":
      return new Uint8Array(buffer);
    case "int16":
      return new Int16Array(buffer);
    case "uint16":
      return new Uint16Array(buffer);
    case "int32":
      return new Int32Array(buffer);
    case "uint32":
      return new Uint32Array(buffer);
    case "float32":
      return new Float32Array(buffer);
  }
}
async function decodeDracoGeometry(bytes, limits = DEFAULT_LIMITS) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("Draco input must be bytes");
  const module = await decoderModule();
  const decoder = new module.Decoder();
  const buffer = new module.DecoderBuffer();
  let geometry;
  try {
    buffer.Init(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength);
    const kind = decoder.GetEncodedGeometryType(buffer);
    let status;
    if (kind === module.TRIANGULAR_MESH) {
      geometry = new module.Mesh();
      status = decoder.DecodeBufferToMesh(buffer, geometry);
    } else if (kind === module.POINT_CLOUD) {
      geometry = new module.PointCloud();
      status = decoder.DecodeBufferToPointCloud(buffer, geometry);
    } else {
      throw malformed("has an unknown geometry type");
    }
    if (!status.ok())
      throw malformed(`could not be decoded: ${status.error_msg()}`);
    const pointCount = geometry.num_points();
    if (pointCount > limits.maxPoints)
      throw malformed(`has ${pointCount} points, over the ${limits.maxPoints} limit`);
    const copyOut = (byteLength, fill) => {
      const pointer = module._malloc(byteLength);
      try {
        if (!fill(pointer))
          throw malformed("refused to export its data");
        return module.HEAPU8.slice(pointer, pointer + byteLength);
      } finally {
        module._free(pointer);
      }
    };
    let indices;
    if (kind === module.TRIANGULAR_MESH) {
      const faces = geometry.num_faces?.() ?? 0;
      if (faces > limits.maxFaces)
        throw malformed(`has ${faces} faces, over the ${limits.maxFaces} limit`);
      const mesh = geometry;
      const raw = copyOut(faces * 12, (pointer) => decoder.GetTrianglesUInt32Array(mesh, faces * 12, pointer));
      indices = new Uint32Array(raw.buffer, raw.byteOffset, faces * 3);
    }
    const attributes = [];
    const count = geometry.num_attributes();
    for (let index = 0; index < count; index += 1) {
      const attribute = decoder.GetAttribute(geometry, index);
      const type = dataType(module, attribute.data_type());
      const componentCount = attribute.num_components();
      const byteLength = pointCount * componentCount * BYTES[type];
      const nativeType = type === "float32" ? module.DT_FLOAT32 : attribute.data_type();
      const target = geometry;
      const raw = copyOut(byteLength, (pointer) => decoder.GetAttributeDataArrayForAllPoints(target, attribute, nativeType, byteLength, pointer));
      attributes.push(Object.freeze({
        uniqueId: attribute.unique_id(),
        type: attributeType(module, attribute.attribute_type()),
        componentCount,
        dataType: type,
        normalized: attribute.normalized(),
        data: typed(type, raw)
      }));
    }
    return Object.freeze({
      kind: kind === module.TRIANGULAR_MESH ? "mesh" : "point-cloud",
      pointCount,
      ...indices === void 0 ? {} : { indices },
      attributes: Object.freeze(attributes)
    });
  } finally {
    if (geometry !== void 0)
      module.destroy(geometry);
    module.destroy(buffer);
    module.destroy(decoder);
  }
}
export {
  DRACO_MALFORMED,
  decodeDracoGeometry,
  initializeDracoBrowser
};
