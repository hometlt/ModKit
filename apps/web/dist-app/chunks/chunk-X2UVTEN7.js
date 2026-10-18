import {
  uvmImageLogicalId,
  uvmImageResourceId
} from "./chunk-UX2AHY32.js";

// packages/scene/dist/uvm/values.js
function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value;
}
function field(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return void 0;
  return value[key];
}
function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function string(value, label) {
  if (!nonBlank(value))
    throw new TypeError(`UVM ${label} must be a nonempty string`);
  return value;
}
function array(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [];
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : [];
}
function safeIndex(value, length, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`);
  return value;
}
function required(value, label) {
  if (value === void 0)
    throw new TypeError(`missing UVM ${label}`);
  return value;
}
function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item));
}
function vector3(value) {
  if (!finiteArray(value, 3))
    throw new TypeError("UVM node TRS must contain finite VEC3/VEC4 values");
  return [required(value[0], "x"), required(value[1], "y"), required(value[2], "z")];
}
function vector4(value) {
  if (!finiteArray(value, 4))
    throw new TypeError("UVM node TRS must contain finite VEC3/VEC4 values");
  return [
    required(value[0], "x"),
    required(value[1], "y"),
    required(value[2], "z"),
    required(value[3], "w")
  ];
}

// packages/scene/dist/uvm/images.js
function opaqueTexels(rgba) {
  const opaque = rgba.slice();
  for (let alpha = 3; alpha < opaque.length; alpha += 4)
    opaque[alpha] = 255;
  return opaque;
}
function uvmImageFilters(document) {
  const textures = array(document, "textures");
  const samplers = document["samplers"] === void 0 ? [] : array(document, "samplers");
  const byImage = /* @__PURE__ */ new Map();
  for (const candidate of textures) {
    const texture = object(candidate, "texture");
    const source = texture["source"];
    const samplerIndex = texture["sampler"];
    if (typeof source !== "number" || typeof samplerIndex !== "number")
      continue;
    const magnified = object(samplers[samplerIndex] ?? {}, "sampler")["magFilter"];
    const filter = magnified === 9728 ? "nearest" : magnified === 9729 ? "linear" : void 0;
    if (filter === void 0)
      continue;
    const known = byImage.get(source);
    byImage.set(source, known === void 0 || known === filter ? filter : null);
  }
  const filters = /* @__PURE__ */ new Map();
  for (const [image, filter] of byImage)
    if (filter !== null)
      filters.set(uvmImageResourceId(document, image), filter);
  return filters;
}
function prepareUvmTextureImages(document, binary, indices, maxEmbeddedBytes, signal) {
  const textures = array(document, "textures"), images = array(document, "images");
  const imageIndices = indices.map((textureIndex) => {
    const texture = object(textures[safeIndex(textureIndex, textures.length, "texture")], "texture");
    return safeIndex(texture["source"], images.length, "texture image");
  });
  return prepareUvmImages(document, binary, imageIndices, maxEmbeddedBytes, signal).map((image, index) => Object.freeze({ ...image, texture: indices[index] }));
}
function prepareUvmImages(document, binary, indices, maxEmbeddedBytes, signal) {
  if (!Number.isSafeInteger(maxEmbeddedBytes) || maxEmbeddedBytes < 0)
    throw new TypeError("invalid image budget");
  const images = array(document, "images"), views = array(document, "bufferViews");
  const captured = /* @__PURE__ */ new Map();
  let remaining = maxEmbeddedBytes;
  return indices.map((index) => {
    signal?.throwIfAborted();
    const imageIndex = safeIndex(index, images.length, "image");
    let source = captured.get(imageIndex);
    if (source === void 0) {
      const image = object(images[imageIndex], "image");
      const mediaType = image["mimeType"] === void 0 ? void 0 : string(image["mimeType"], "image mimeType");
      if (image["uri"] === void 0 === (image["bufferView"] === void 0))
        throw new TypeError("UVM image requires exactly one URI or bufferView");
      if (image["uri"] !== void 0) {
        const uri = string(image["uri"], "image URI");
        if (uri.startsWith("data:")) {
          const comma = uri.indexOf(",");
          if (comma < 0)
            throw new TypeError("invalid image data URI");
          const declaration = uri.slice(5, comma), payload = uri.slice(comma + 1);
          const declaredType = declaration.split(";")[0];
          if (mediaType !== void 0 && declaredType !== "" && declaredType !== mediaType)
            throw new TypeError("image data URI and mimeType disagree");
          let bytes;
          if (declaration.endsWith(";base64")) {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload))
              throw new TypeError("invalid image base64");
            const length = payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
            if (length > remaining)
              throw new RangeError("embedded images exceed budget");
            bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
          } else {
            let length = 0;
            for (let i = 0; i < payload.length; i++, length++) {
              if (payload[i] === "%") {
                if (!/^[0-9a-f]{2}$/iu.test(payload.slice(i + 1, i + 3)))
                  throw new TypeError("invalid image URI escape");
                i += 2;
              } else if (payload.charCodeAt(i) > 127)
                throw new TypeError("image URI bytes must be percent encoded");
            }
            if (length > remaining)
              throw new RangeError("embedded images exceed budget");
            bytes = new Uint8Array(length);
            for (let i = 0, j = 0; i < payload.length; i++, j++) {
              if (payload[i] === "%") {
                bytes[j] = parseInt(payload.slice(i + 1, i + 3), 16);
                i += 2;
              } else
                bytes[j] = payload.charCodeAt(i);
            }
          }
          remaining -= bytes.length;
          const type = mediaType ?? declaredType;
          source = { kind: "embedded", bytes, ...type ? { mediaType: type } : {} };
        } else
          source = {
            kind: "logical",
            requirement: {
              id: `uvm-image-${imageIndex}`,
              logicalId: uvmImageLogicalId(uri),
              role: "texture",
              scopes: [
                "sibling-directory",
                "workspace-dependency-layer",
                "current-mount",
                "enclosing-container"
              ]
            }
          };
      } else {
        const view = object(views[safeIndex(image["bufferView"], views.length, "image bufferView")], "image bufferView");
        const offset = view["byteOffset"] ?? 0, length = view["byteLength"];
        if (view["buffer"] !== 0 || view["byteStride"] !== void 0 || typeof offset !== "number" || typeof length !== "number" || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > binary.length || length > binary.length - offset)
          throw new TypeError("image bufferView must name a bounded slice of the UVM BIN chunk");
        if (length > remaining)
          throw new RangeError("embedded images exceed budget");
        remaining -= length;
        source = {
          kind: "embedded",
          bytes: binary.slice(offset, offset + length),
          ...mediaType === void 0 ? {} : { mediaType }
        };
      }
      captured.set(imageIndex, source);
    }
    return Object.freeze({ image: imageIndex, source });
  });
}
function uvmImageTexels(result, options = {}) {
  if (options.channels !== void 0 && options.channels !== "color" && options.channels !== "data")
    throw new TypeError("invalid image channel interpretation");
  const { info, region } = result;
  if (!["top-left", "bottom-left"].includes(info.orientation))
    throw new TypeError("image orientation is unknown");
  if (options.channels !== "data" && !["none", "straight", "premultiplied", "unknown"].includes(info.alphaMode))
    throw new TypeError("image alpha mode is invalid");
  if (!(region.pixels instanceof Uint8Array) || region.pixelFormat !== "rgba8" || region.width !== info.width || region.height !== info.height || !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || info.width <= 0 || info.height <= 0 || !Number.isSafeInteger(region.rowStride) || region.rowStride < info.width * 4 || region.rowStride * (info.height - 1) + info.width * 4 > region.pixels.length)
    throw new TypeError("invalid image region");
  const rgba = new Uint8Array(info.width * info.height * 4);
  for (let y = 0; y < info.height; y++) {
    const sourceY = info.orientation === "top-left" ? y : info.height - 1 - y;
    rgba.set(region.pixels.subarray(sourceY * region.rowStride, sourceY * region.rowStride + info.width * 4), y * info.width * 4);
  }
  if (options.channels !== "data" && info.alphaMode === "premultiplied")
    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3] ?? 0;
      for (let channel = 0; channel < 3; channel++)
        rgba[i + channel] = alpha === 0 ? 0 : Math.min(255, Math.round((rgba[i + channel] ?? 0) * 255 / alpha));
    }
  return rgba;
}

export {
  object,
  field,
  nonBlank,
  string,
  array,
  safeIndex,
  required,
  finiteArray,
  vector3,
  vector4,
  opaqueTexels,
  uvmImageFilters,
  prepareUvmTextureImages,
  prepareUvmImages,
  uvmImageTexels
};
