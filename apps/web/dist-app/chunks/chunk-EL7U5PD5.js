import {
  createOrbitController
} from "./chunk-O2DY4UGD.js";
import {
  convertedFileName,
  exportOffer,
  invokeRefusalMessage,
  isRejected,
  mountFieldEditor
} from "./chunk-53F3LCKT.js";
import {
  canvasPng,
  createMediaShell,
  mountContributedSections
} from "./chunk-VIK5OGEB.js";
import {
  MODEL_FALLBACK_MESSAGES,
  MODEL_GIZMO_FALLBACK_MESSAGES,
  PART_ATTRIBUTE,
  ViewerMountScope,
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setPart,
  setState,
  setViewerText,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-NQFZC763.js";
import {
  applyColorKeyTransparency,
  billboardCameraRotation,
  createModelSceneSampler,
  createModelSkeletonNodes,
  modelPrimitiveByteLength,
  snapshotJson
} from "./chunk-OFFINWD7.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/ui/dist/model/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/scene/dist/model/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/scene/dist/model/team-color.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var TEAM_COLOR_SLOTS = /* @__PURE__ */ new Set(["teamcolor", "team"]);
var BASE_COLOR_SLOTS = /* @__PURE__ */ new Set(["diffuse", "basecolor", "albedo", "color"]);
var CHANNELS = { 1: "r", 2: "g", 4: "b", 8: "a" };
var slotKey = (slot) => slot.toLowerCase().replace(/[^a-z0-9]/gu, "");
function modelMaterialTeamColor(material, textures, uvSource) {
  const layer = material.layers?.find((candidate) => TEAM_COLOR_SLOTS.has(slotKey(candidate.slot)));
  if (layer === void 0)
    return void 0;
  const rule = layer.teamColor;
  const common = {
    blend: layer.blend ?? "multiply",
    ...rule?.strength === void 0 ? {} : { strength: rule.strength },
    ...rule?.defaultColor === void 0 ? {} : { defaultColor: rule.defaultColor },
    ...rule?.colorSource === "object-tint" ? { source: "object-tint" } : {},
    ...rule?.tint === "mask-rgb" ? { tint: "mask-rgb" } : {}
  };
  const source = layer.resourceId === void 0 && rule?.maskSource === "channelKey" ? material.layers?.find((candidate) => BASE_COLOR_SLOTS.has(slotKey(candidate.slot)) && candidate.resourceId !== void 0) : layer;
  if (source?.resourceId === void 0)
    return rule?.maskSource === void 0 ? { mask: "whole", ...common } : void 0;
  const texture = textures.get(source.resourceId);
  if (texture === void 0 || (source.uvSource ?? 0) !== uvSource)
    return void 0;
  const channel = CHANNELS[layer.colorChannels ?? 0];
  if (rule?.maskSource === "channelKey")
    return {
      mask: { texture: texture.id, channel: channel ?? "rgb" },
      ...common,
      key: {
        channels: rule.keyChannels ?? ["r", "g"],
        threshold: rule.keyThreshold ?? 0,
        intensity: rule.intensityChannel ?? "b"
      }
    };
  if (rule?.maskSource === "paletteRange")
    return rule.ramp === void 0 || rule.range === void 0 ? void 0 : {
      // the indices are one scalar channel
      mask: { texture: texture.id, channel: channel ?? "r" },
      ...common,
      ramp: {
        shades: rule.ramp,
        first: rule.range[0],
        scale: rule.paletteIndexScale ?? 255
      }
    };
  return { mask: { texture: texture.id, channel: channel ?? "rgb" }, ...common };
}

// ../MODDING/modkit-core/packages/ui/dist/model/source.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var MODEL_MAXIMUM_PRIMITIVE_BYTES = 64 * 1024 * 1024;
var MODEL_MAXIMUM_PRIMITIVES = 4096;
var MODEL_MAXIMUM_RECORDS = 65536;
async function readModelRecords(read, maximum, signal) {
  const records = [];
  const seen = /* @__PURE__ */ new Set();
  let cursor;
  let bytes = 0;
  do {
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    const limit = Math.min(256, maximum - records.length);
    if (limit <= 0)
      throw new RangeError("model source exceeds record budget");
    const page = await read({ limit, ...cursor === void 0 ? {} : { cursor } }, signal);
    if (!Array.isArray(page.items) || page.items.length > limit)
      throw new TypeError("model source exceeded page limit");
    const items = snapshotJson(page.items, { maxDepth: 64, maxNodes: 1e6, maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES - bytes }, signal);
    bytes += new TextEncoder().encode(JSON.stringify(items)).byteLength;
    records.push(...items);
    cursor = page.nextCursor;
    if (cursor !== void 0) {
      if (typeof cursor !== "string" || !cursor || cursor.length > 4096 || seen.has(cursor))
        throw new TypeError("model source repeated or invalid cursor");
      if (items.length === 0)
        throw new TypeError("model source returned an empty page with a cursor");
      seen.add(cursor);
    }
  } while (cursor !== void 0);
  return Object.freeze(records);
}
async function loadModelStage(source, signal) {
  const info = await source.info(signal);
  const meshes = await readModelRecords((page, abort) => source.meshes(page, abort), MODEL_MAXIMUM_PRIMITIVES, signal);
  const nodes = await readModelRecords((page, abort) => source.nodes(page, abort), MODEL_MAXIMUM_RECORDS, signal);
  const ids = /* @__PURE__ */ new Set();
  for (const mesh of meshes)
    for (const id of mesh.primitiveIds) {
      if (typeof id !== "string" || !id)
        throw new TypeError("invalid model primitive id");
      ids.add(id);
      if (ids.size > MODEL_MAXIMUM_PRIMITIVES)
        throw new RangeError("model source exceeds primitive budget");
    }
  const primitives = [];
  let bytes = 0;
  if (source.primitive !== void 0)
    for (const id of ids) {
      if (signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      const primitive = await source.primitive(id, { maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES - bytes }, signal);
      if (primitive.id !== id)
        throw new TypeError("model source returned a different primitive");
      bytes += modelPrimitiveByteLength(primitive);
      if (bytes > MODEL_MAXIMUM_PRIMITIVE_BYTES)
        throw new RangeError("model geometry exceeds byte budget");
      primitives.push(primitive);
    }
  return {
    info,
    nodes,
    meshes,
    primitives: Object.freeze(primitives),
    primitiveIds: Object.freeze([...ids]),
    ...primitives[0] === void 0 ? {} : { primitive: primitives[0] }
  };
}
function modelLodPrimitives(levels, model) {
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const meshes = new Map(model.meshes.map((mesh) => [mesh.id, mesh]));
  return [...levels].sort((a, b) => a.order - b.order).map((level) => {
    const primitiveIds = /* @__PURE__ */ new Set();
    const seen = /* @__PURE__ */ new Set();
    const pending = [...level.nodeIds];
    for (let id = pending.pop(); id !== void 0; id = pending.pop()) {
      const node = seen.has(id) ? void 0 : nodes.get(id);
      seen.add(id);
      if (node === void 0)
        continue;
      for (const meshId of node.meshIds)
        for (const primitiveId of meshes.get(meshId)?.primitiveIds ?? [])
          primitiveIds.add(primitiveId);
      pending.push(...node.childIds);
    }
    return { id: level.id, order: level.order, primitiveIds };
  }).filter((level) => level.primitiveIds.size > 0);
}

// ../MODDING/modkit-core/packages/ui/dist/model/scene.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var MODEL_FIELD_OF_VIEW = 0.8;
var MODEL_DEFAULT_BASE_COLOR = Object.freeze([0.78, 0.8, 0.84, 1]);
var MODEL_TEXTURED_BASE_COLOR = Object.freeze([1, 1, 1, 1]);
var MODEL_KEY_LIGHT = Object.freeze({
  direction: Object.freeze([0.35, 0.72, 0.6]),
  color: Object.freeze([1, 1, 1, 1]),
  ambient: 0.28
});
function upAxisCorrection(upAxis, handedness) {
  const left = handedness === "left";
  if (upAxis === "+z")
    return Float32Array.from([1, 0, 0, 0, 0, 0, left ? 1 : -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  return left ? Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]) : void 0;
}
function orientPrimitive(primitive, correction) {
  if (correction === void 0)
    return primitive;
  const existing = primitive.transform;
  if (existing === void 0)
    return { ...primitive, transform: correction };
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1)
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1)
        sum += (correction[k * 4 + row] ?? 0) * (existing[column * 4 + k] ?? 0);
      out[column * 4 + row] = sum;
    }
  return { ...primitive, transform: out };
}
var finite = (value) => typeof value === "number" && Number.isFinite(value);
function boundsFraming(bounds) {
  const { min, max } = bounds;
  if (!min.every(finite) || !max.every(finite))
    return void 0;
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return radius > 0 ? { center, radius } : { center, radius: 1 };
}
function framePrimitive(primitive) {
  if (primitive.bounds !== void 0) {
    const framing = boundsFraming(primitive.bounds);
    if (framing !== void 0)
      return framing;
  }
  const positions = primitive.positions;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    if (!finite(x) || !finite(y) || !finite(z))
      continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (minX > maxX)
    return { center: [0, 0, 0], radius: 1 };
  return boundsFraming({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }) ?? {
    center: [0, 0, 0],
    radius: 1
  };
}
function framePrimitives(primitives) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of primitives)
    for (let i = 0; i < primitive.positions.length; i += 3) {
      const x = primitive.positions[i], y = primitive.positions[i + 1], z = primitive.positions[i + 2];
      const matrix = primitive.transform;
      for (let axis = 0; axis < 3; axis++) {
        const value = matrix === void 0 ? primitive.positions[i + axis] : matrix[axis] * x + matrix[4 + axis] * y + matrix[8 + axis] * z + matrix[12 + axis];
        if (!Number.isFinite(value))
          throw new TypeError("invalid model framing positions");
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  return boundsFraming({ min, max }) ?? { center: [0, 0, 0], radius: 1 };
}
var dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
function modelCamera(framing, basis, distanceScale, viewport) {
  const radius = framing.radius > 0 && Number.isFinite(framing.radius) ? framing.radius : 1;
  const distance = radius / Math.sin(MODEL_FIELD_OF_VIEW / 2) * Math.max(0.15, distanceScale);
  const { right, up, backward } = basis;
  const eye = [
    framing.center[0] + backward[0] * distance,
    framing.center[1] + backward[1] * distance,
    framing.center[2] + backward[2] * distance
  ];
  const aspect = viewport.height <= 0 ? 1 : viewport.width / viewport.height;
  const focal = 1 / Math.tan(MODEL_FIELD_OF_VIEW / 2);
  const near = Math.max(distance - radius, radius * 1e-3, 1e-4);
  const far = distance + radius * 2 + near;
  const rightAxis = right;
  const upAxis = up;
  const backwardAxis = backward;
  const view = new Float32Array(16);
  view[0] = rightAxis[0];
  view[4] = rightAxis[1];
  view[8] = rightAxis[2];
  view[12] = -dot(rightAxis, eye);
  view[1] = upAxis[0];
  view[5] = upAxis[1];
  view[9] = upAxis[2];
  view[13] = -dot(upAxis, eye);
  view[2] = backwardAxis[0];
  view[6] = backwardAxis[1];
  view[10] = backwardAxis[2];
  view[14] = -dot(backwardAxis, eye);
  view[15] = 1;
  const projection = new Float32Array(16);
  projection[0] = focal / (aspect === 0 ? 1 : aspect);
  projection[5] = focal;
  projection[10] = (far + near) / (near - far);
  projection[11] = -1;
  projection[14] = 2 * far * near / (near - far);
  return { eye, framing, viewMatrix: view, viewProjection: multiply4x4(projection, view) };
}
function multiply4x4(left, right) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += left[index * 4 + row] * right[column * 4 + index];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}
function projectPoint(viewProjection, point, viewport) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const clipX = viewProjection[0] * x + viewProjection[4] * y + viewProjection[8] * z + viewProjection[12];
  const clipY = viewProjection[1] * x + viewProjection[5] * y + viewProjection[9] * z + viewProjection[13];
  const clipW = viewProjection[3] * x + viewProjection[7] * y + viewProjection[11] * z + viewProjection[15];
  if (!Number.isFinite(clipW) || clipW <= 1e-6)
    return void 0;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY))
    return void 0;
  return [(ndcX * 0.5 + 0.5) * viewport.width, (1 - (ndcY * 0.5 + 0.5)) * viewport.height];
}
function materialColorFor(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619) >>> 0;
  }
  const hue = hash % 3600 / 3600;
  const [red, green, blue] = hueToRgb(hue, 0.28, 0.72);
  return [red, green, blue, 1];
}
function hueToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue * 6;
  const second = chroma * (1 - Math.abs(sector % 2 - 1));
  const match = lightness - chroma / 2;
  const table = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second]
  ];
  const base = table[Math.min(5, Math.floor(sector))] ?? table[0];
  const rgb = base;
  return [rgb[0] + match, rgb[1] + match, rgb[2] + match];
}
var BASE_COLOR_SLOTS2 = Object.freeze([
  "diffuse",
  "basecolor",
  "albedo",
  "color",
  "colour",
  "mapkd"
]);
var slotKey2 = (value) => value.toLowerCase().replace(/[^a-z0-9]/gu, "");
function baseColorResourceOf(material) {
  const layers = material.layers ?? [];
  for (const slot of BASE_COLOR_SLOTS2) {
    for (const layer of layers) {
      if (slotKey2(layer.slot) === slot && layer.resourceId !== void 0)
        return layer.resourceId;
    }
  }
  return void 0;
}
var PBR_SLOTS = {
  metallicroughness: "metallicRoughness",
  occlusion: "occlusion",
  ao: "occlusion",
  ambientocclusion: "occlusion",
  emissive: "emissive",
  emission: "emissive",
  normal: "normal"
};
function materialPbr(ref, textures, uvSource) {
  const texture = (role) => {
    const layer = (ref.layers ?? []).find((item) => PBR_SLOTS[slotKey2(item.slot)] === role && item.resourceId !== void 0);
    if (layer?.resourceId === void 0 || (layer.uvSource ?? 0) !== uvSource)
      return void 0;
    return textures.get(layer.resourceId)?.id;
  };
  const metallicRoughnessTexture = texture("metallicRoughness");
  const occlusionTexture = texture("occlusion");
  const emissiveTexture = texture("emissive");
  const normalTexture = texture("normal");
  const emissive = ref.emissiveFactor ?? (emissiveTexture === void 0 ? void 0 : [1, 1, 1]);
  return {
    metallic: ref.metallicFactor ?? 0,
    roughness: ref.roughnessFactor ?? 1,
    ...metallicRoughnessTexture === void 0 ? {} : { metallicRoughnessTexture },
    ...occlusionTexture === void 0 ? {} : { occlusionTexture },
    ...emissive === void 0 ? {} : { emissive },
    ...emissiveTexture === void 0 ? {} : { emissiveTexture },
    ...normalTexture === void 0 ? {} : { normalTexture }
  };
}
function sceneMaterials(refs, textures, shaded) {
  const used = /* @__PURE__ */ new Map();
  const materials = refs.map((ref) => {
    const resourceId = baseColorResourceOf(ref);
    const texture = resourceId === void 0 ? void 0 : textures.get(resourceId);
    if (texture !== void 0)
      used.set(texture.id, texture);
    const bindings = [];
    const boundResources = /* @__PURE__ */ new Set();
    for (const layer of ref.layers ?? []) {
      if (layer.resourceId === void 0 || boundResources.has(layer.resourceId))
        continue;
      const layerTexture = textures.get(layer.resourceId);
      if (layerTexture === void 0)
        continue;
      boundResources.add(layer.resourceId);
      used.set(layerTexture.id, layerTexture);
      bindings.push({ resourceId: layer.resourceId, textureId: layerTexture.id });
    }
    const base = ref.layers?.find((layer) => layer.resourceId === resourceId);
    const teamColor = modelMaterialTeamColor(ref, textures, base?.uvSource ?? 0);
    return Object.freeze({
      id: ref.id,
      /*
       * A bound texture is the surface's own albedo, so it is shown at its own value. Modulating
       * it by the untextured grey made textured models darker than untextured ones — worst on the
       * dark textures where detail matters most.
       */
      // A stated factor multiplies the texture, or is the colour itself without one (glTF).
      baseColor: ref.baseColorFactor ?? (texture === void 0 ? materialColorFor(ref.id) : MODEL_TEXTURED_BASE_COLOR),
      ...texture === void 0 ? {} : { baseColorTexture: texture.id },
      // lit by its own glTF material (П11); an unlit one, or the flat view, draws its colour as is
      ...shaded && ref.unlit !== true ? { shading: "pbr", pbr: materialPbr(ref, textures, base?.uvSource ?? 0) } : { shading: "unlit" },
      ...ref.doubleSided === void 0 ? {} : { doubleSided: ref.doubleSided },
      ...ref.depthWrite === void 0 ? {} : { depthWrite: ref.depthWrite },
      ...ref.priority === void 0 ? {} : { priority: ref.priority },
      ...teamColor === void 0 ? {} : { teamColor },
      ...ref.alphaMode === void 0 ? {} : { alphaMode: ref.alphaMode },
      ...ref.alphaCutoff === void 0 ? {} : { alphaCutoff: ref.alphaCutoff },
      ...ref.shader === void 0 ? {} : { shader: ref.shader },
      ...bindings.length === 0 ? {} : { textureBindings: Object.freeze(bindings) }
    });
  });
  return Object.freeze({
    materials: Object.freeze(materials),
    textures: Object.freeze([...used.values()])
  });
}
function modelSceneRequest(options) {
  if (options.primitive === void 0 === (options.primitives === void 0))
    throw new TypeError("provide either one primitive or a complete primitive list");
  return {
    scene: {
      primitives: options.primitives ?? [options.primitive],
      ...options.materials === void 0 || options.materials.length === 0 ? {} : { materials: options.materials },
      ...options.textures === void 0 || options.textures.length === 0 ? {} : { textures: options.textures },
      ...options.light === void 0 ? {} : { light: options.light },
      ...options.materialContext === void 0 ? {} : { materialContext: options.materialContext }
    },
    camera: {
      viewProjection: options.camera.viewProjection,
      viewMatrix: options.camera.viewMatrix,
      eyePosition: options.camera.eye
    },
    viewport: options.viewport,
    ...options.clearColor === void 0 ? {} : { clearColor: options.clearColor },
    outputKind: "rgba8",
    ...options.signal === void 0 ? {} : { signal: options.signal }
  };
}
function skeletonJoints(bindings) {
  const hierarchyIds = [
    ...new Set(bindings.flatMap((binding) => typeof binding.hierarchyId === "string" && binding.hierarchyId ? [binding.hierarchyId] : []))
  ];
  const joints = [];
  for (const hierarchyId of hierarchyIds) {
    const hierarchy = bindings.filter((binding) => binding.hierarchyId === hierarchyId);
    const offset = joints.length;
    const sampled = createModelSceneSampler({
      nodes: createModelSkeletonNodes(hierarchy, hierarchyId),
      meshes: [],
      primitives: [],
      skeleton: hierarchy
    }).sample(0).joints;
    joints.push(...sampled.map((joint) => ({
      ...joint,
      ...joint.parent === void 0 ? {} : { parent: joint.parent + offset }
    })));
  }
  return Object.freeze(joints);
}

// ../MODDING/modkit-core/packages/ui/dist/model/effects.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var MODEL_EFFECT_BUDGET = Object.freeze({
  maxInputBytes: 512n * 1024n * 1024n,
  maxScalarBytes: 512 * 1024 * 1024,
  maxNodes: 1e6,
  maxDepth: 96,
  maxDiagnostics: 256
});
var MODEL_EFFECT_LOOP_SECONDS = 10;
function effectFraming(framing, metersPerSourceUnit) {
  const scale = metersPerSourceUnit;
  return {
    center: [framing.center[0] * scale, framing.center[1] * scale, framing.center[2] * scale],
    radius: framing.radius * scale
  };
}
function modelEffectRequest(options) {
  return {
    schemaVersion: 1,
    viewport: { width: options.viewport.width, height: options.viewport.height },
    camera: {
      viewProjection: Array.from(options.camera.viewProjection),
      viewMatrix: Array.from(options.camera.viewMatrix),
      eyePosition: [...options.camera.eye]
    },
    time: options.time,
    ...options.clipId === void 0 ? {} : { clipId: options.clipId },
    ...options.teamColor === void 0 ? {} : { materialContext: { teamColor: [...options.teamColor] } }
  };
}
function withModelEffectLayer(request, frame) {
  const wanted = new Set(frame.effectPrimitiveIds);
  const named = (id) => `effect:${id}`;
  const shrink = 1 / frame.metersPerSourceUnit;
  const unscale = Float32Array.from([shrink, 0, 0, 0, 0, shrink, 0, 0, 0, 0, shrink, 0, 0, 0, 0, 1]);
  const primitives = frame.request.scene.primitives.filter((primitive) => wanted.has(primitive.id)).map((primitive) => ({
    ...primitive,
    id: named(primitive.id),
    transform: primitive.transform === void 0 ? unscale : multiply4x4(unscale, primitive.transform),
    ...primitive.materialId === void 0 ? {} : { materialId: named(primitive.materialId) }
  }));
  const materialIds = new Set(primitives.map((primitive) => primitive.materialId));
  const materials = (frame.request.scene.materials ?? []).filter((material) => materialIds.has(named(material.id))).map((material) => ({
    ...material,
    id: named(material.id),
    ...material.baseColorTexture === void 0 ? {} : { baseColorTexture: named(material.baseColorTexture) },
    ...material.textureBindings === void 0 ? {} : {
      textureBindings: material.textureBindings.map((binding) => ({
        ...binding,
        textureId: named(binding.textureId)
      }))
    }
  }));
  const textureIds = new Set(materials.flatMap((material) => [
    ...material.baseColorTexture === void 0 ? [] : [material.baseColorTexture],
    ...(material.textureBindings ?? []).map((binding) => binding.textureId)
  ]));
  const textures = (frame.request.scene.textures ?? []).filter((texture) => textureIds.has(named(texture.id))).map((texture) => ({ ...texture, id: named(texture.id) }));
  if (primitives.length === 0)
    return request;
  return {
    ...request,
    scene: {
      ...request.scene,
      primitives: [...request.scene.primitives, ...primitives],
      materials: [...request.scene.materials ?? [], ...materials],
      textures: [...request.scene.textures ?? [], ...textures]
    }
  };
}
function rememberingRasterPort(port, signal) {
  const read = /* @__PURE__ */ new Map();
  return {
    read(request) {
      if (request.kind !== "logical")
        return port.read(request, signal);
      const { kind, requirement, maxBytes, selection, compressedFormats } = request;
      const key = JSON.stringify({ kind, requirement, maxBytes, selection, compressedFormats });
      let answer = read.get(key);
      if (answer === void 0) {
        answer = port.read(request, signal);
        read.set(key, answer);
        answer.catch(() => read.delete(key));
      }
      return answer;
    }
  };
}

// ../MODDING/modkit-core/packages/ui/dist/field-write/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function fieldEditTargetText(target) {
  if (target.state === "resolved")
    return target.destination.label;
  if (target.state === "selection-required") {
    const choices = target.candidates.map((item) => `${item.rootId} \u2192 ${item.path}`).join("; ");
    return choices.length === 0 ? target.reason : `${target.reason}: ${choices}`;
  }
  return target.reason;
}
function mountFieldEditTarget(container, target) {
  if (target === void 0)
    return void 0;
  const node = element(container, "small", { part: "field.target" });
  node.dataset["editTargetState"] = target.state;
  node.setAttribute("role", "status");
  setViewerText(node, fieldEditTargetText(target), 2048);
  return node;
}
function fieldWriteRefusal(descriptor, editable, route) {
  if (route !== void 0 && (route.commit === void 0 || route.authorization === void 0)) {
    return "this surface was mounted without a route to save a change";
  }
  if (editable === void 0)
    return "this codec does not offer this value for editing";
  if (editable.readonlyReason !== void 0)
    return editable.readonlyReason;
  const write = editable.write;
  if (write === void 0)
    return "this codec does not offer this value for editing";
  if (!("operation" in write)) {
    return "this value is written through a writer service this surface does not hold";
  }
  const operation = descriptor.operations.find((candidate) => candidate.id === write.operation);
  if (operation === void 0)
    return `the codec declares no operation \xAB${String(write.operation)}\xBB`;
  if (operation.state !== "available") {
    return `the operation \xAB${String(write.operation)}\xBB is ${operation.state} for this file`;
  }
  return void 0;
}
function editPlanOf(result) {
  const output = result.output;
  return output?.kind === "edit-plan" ? output.plan : void 0;
}
async function commitOperationWrite(route, operationId, input, signal) {
  const operation = route.descriptor.operations.find((candidate) => candidate.id === operationId);
  if (operation === void 0)
    return `the codec declares no operation \xAB${operationId}\xBB`;
  if (operation.state !== "available") {
    return `the operation \xAB${operationId}\xBB is ${operation.state} for this file`;
  }
  const coordinator = route.commit;
  const authorization = route.authorization;
  if (coordinator === void 0 || authorization === void 0) {
    return "no route to save this change";
  }
  const options = signal === void 0 ? {} : { signal };
  const result = await route.operations.invoke(operation.handlerId, input, options);
  if (isRejected(result))
    return invokeRefusalMessage(result);
  const plan = editPlanOf(result);
  if (plan === void 0)
    return "the codec returned no edit plan for this write";
  const grant = await authorization.request(plan, options);
  if (grant === void 0)
    return "not authorised to write this file";
  const prepared = await coordinator.prepare(plan, { grant: grant.grant, ...options });
  if (prepared.state !== "ready") {
    return prepared.state === "conflict" ? "the file changed after this view opened it" : `refused: ${prepared.reason ?? prepared.state}`;
  }
  const receipt = await coordinator.commit(prepared.prepared, { grant: grant.grant, ...options });
  return receipt.state === "committed" ? void 0 : `not saved: ${receipt.state}`;
}
function controlField(options) {
  const initialText = options.value === null || options.value === void 0 ? "" : String(options.value);
  return Object.freeze({
    key: options.target.key,
    label: options.label,
    type: options.type,
    inputPath: ["value"],
    name: options.target.key,
    kind: "text",
    initial: options.value,
    initialText,
    ...options.editable?.editor === void 0 ? {} : { editorId: options.editable.editor }
  });
}
async function mountInlineField(container, options) {
  const root = element(container, "span", { part: "field" });
  const refusal = fieldWriteRefusal(options.descriptor, options.editable, {
    ...options.commit === void 0 ? {} : { commit: options.commit },
    ...options.authorization === void 0 ? {} : { authorization: options.authorization }
  });
  if (refusal !== void 0) {
    const text = element(root, "span", { part: "field.control" });
    setViewerText(text, options.value ?? "", 4096);
    text.title = refusal;
    root.dataset["readonly"] = "true";
    return {
      root,
      async commit() {
        return false;
      },
      read() {
        return void 0;
      },
      async unmount() {
        root.remove();
      }
    };
  }
  const host = element(root, "span", { part: "field.control" });
  const status = element(root, "span", { part: "field.status" });
  const control = await mountFieldEditor(host, controlField(options), options.signal, options.fieldEditors, options.editable?.editor, options.candidates);
  const write = options.editable?.write;
  const operationId = write !== void 0 && "operation" in write ? write.operation : void 0;
  const operation = options.descriptor.operations.find((candidate) => candidate.id === operationId);
  const read = () => {
    const problem = control.validate();
    if (problem === void 0)
      return { value: control.read() };
    setViewerText(status, problem, 512);
    return void 0;
  };
  const commit = async () => {
    if (operation === void 0) {
      setViewerText(status, "no route to save this change", 512);
      return false;
    }
    const typed = read();
    if (typed === void 0)
      return false;
    const value = typed.value;
    const request = {
      groupId: options.target.groupId,
      key: options.target.key,
      ...options.target.path === void 0 ? {} : { path: options.target.path },
      value
    };
    setViewerText(status, "\u2026", 8);
    const refusal2 = await commitOperationWrite(options, operation.id, request, options.signal);
    if (refusal2 !== void 0) {
      setViewerText(status, refusal2, 512);
      return false;
    }
    setViewerText(status, "", 1);
    await options.onWritten?.(value);
    return true;
  };
  return {
    root,
    commit,
    read,
    async unmount() {
      await control.unmount?.();
      root.remove();
    }
  };
}

// ../MODDING/modkit-core/packages/ui/dist/model/gizmo.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var SVG_NS = "http://www.w3.org/2000/svg";
var GIZMO_SIZE = 80;
var CENTER = GIZMO_SIZE / 2;
var RADIUS_FRONT = 28;
var RADIUS_BACK = 18;
var HANDLE_FRONT = 11;
var HANDLE_BACK = 6;
var AXES = Object.freeze([
  { key: "+x", label: "X", vector: [1, 0, 0], token: "--mk-color-axis-x" },
  { key: "-x", label: "", vector: [-1, 0, 0], token: "--mk-color-axis-x" },
  { key: "+y", label: "Y", vector: [0, 1, 0], token: "--mk-color-axis-y" },
  { key: "-y", label: "", vector: [0, -1, 0], token: "--mk-color-axis-y" },
  { key: "+z", label: "Z", vector: [0, 0, 1], token: "--mk-color-axis-z" },
  { key: "-z", label: "", vector: [0, 0, -1], token: "--mk-color-axis-z" }
]);
function createViewGizmo(host, options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, MODEL_GIZMO_FALLBACK_MESSAGES);
  const document = host.ownerDocument;
  const root = element(host, "div", { part: "gizmo" });
  root.setAttribute("aria-label", localizer.text("viewer.viewAxis"));
  root.setAttribute("role", "group");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(GIZMO_SIZE));
  svg.setAttribute("height", String(GIZMO_SIZE));
  svg.setAttribute("viewBox", `0 0 ${GIZMO_SIZE} ${GIZMO_SIZE}`);
  setPart(svg, "gizmo.svg");
  root.append(svg);
  const pivot = document.createElementNS(SVG_NS, "circle");
  pivot.setAttribute("cx", String(CENTER));
  pivot.setAttribute("cy", String(CENTER));
  pivot.setAttribute("r", "3");
  pivot.setAttribute("fill", "var(--mk-color-canvas-gizmo)");
  svg.append(pivot);
  const nodes = [];
  for (const spec of AXES) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(CENTER));
    line.setAttribute("y1", String(CENTER));
    line.setAttribute("stroke", `var(${spec.token})`);
    line.setAttribute("stroke-linecap", "round");
    setPart(line, "gizmo.axis");
    svg.append(line);
    const hit = document.createElementNS(SVG_NS, "g");
    hit.setAttribute("role", "button");
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("aria-label", localizer.text("viewer.viewFromAxis", { axis: spec.key.toUpperCase() }));
    setPart(hit, "gizmo.handle");
    const handle = document.createElementNS(SVG_NS, "circle");
    handle.setAttribute("fill", `var(${spec.token})`);
    hit.append(handle);
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.setAttribute("fill", "var(--mk-color-fg-inverse)");
    label.textContent = spec.label;
    setPart(label, "gizmo.label");
    hit.append(label);
    const activate = () => options.onAxis?.(spec.key);
    hit.addEventListener("click", activate);
    hit.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ")
        return;
      event.preventDefault();
      activate();
    });
    svg.append(hit);
    nodes.push({ spec, line, handle, label, hit });
  }
  const update = (yaw, pitch) => {
    const backward = [
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ];
    const horizontal = Math.hypot(backward[0], backward[2]) || 1;
    const right = [backward[2] / horizontal, 0, -backward[0] / horizontal];
    const up = [
      backward[1] * right[2],
      backward[2] * right[0] - backward[0] * right[2],
      -backward[1] * right[0]
    ];
    for (const { spec, line, handle, label, hit } of nodes) {
      const screenX = spec.vector[0] * right[0] + spec.vector[2] * right[2];
      const screenY = spec.vector[0] * up[0] + spec.vector[1] * up[1] + spec.vector[2] * up[2];
      const depth = spec.vector[0] * backward[0] + spec.vector[1] * backward[1] + spec.vector[2] * backward[2];
      const front = depth >= 0;
      const x = CENTER + screenX * (front ? RADIUS_FRONT : RADIUS_BACK);
      const y = CENTER - screenY * (front ? RADIUS_FRONT : RADIUS_BACK);
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke-width", front ? "2.5" : "1.5");
      line.setAttribute("opacity", front ? "1" : "0.35");
      handle.setAttribute("cx", String(x));
      handle.setAttribute("cy", String(y));
      handle.setAttribute("r", String((front ? HANDLE_FRONT : HANDLE_BACK) / 2 + 3));
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(y));
      label.setAttribute("font-size", front ? "9" : "0");
      hit.setAttribute("opacity", front ? "1" : "0.5");
    }
  };
  update(0.7, 0.45);
  return {
    root,
    update,
    destroy() {
      root.remove();
    }
  };
}

// ../MODDING/modkit-core/packages/ui/dist/model/index.js
function modelAnimationPlaybackDuration(clip) {
  if (clip === void 0)
    return 0;
  let duration = clip.durationSeconds ?? 0;
  if (clip.repeatCount !== void 0 && clip.repeatCount > 0)
    duration = Math.max(duration, duration * clip.repeatCount);
  for (const channel of clip.channels) {
    if (channel.concurrent === true && channel.wrapSeconds !== void 0 && channel.repeatCount !== void 0 && channel.repeatCount > 0)
      duration = Math.max(duration, channel.wrapSeconds * channel.repeatCount);
  }
  return duration;
}
var MODEL_RENDERER_BACKENDS = Object.freeze({
  "modkit.browser-webgl": "webgl2",
  "modkit.headless": "cpu-raster"
});
var MODEL_WIREFRAME_BACKEND = "wireframe";
var CLIP_RENAME_OPERATION = "edit.field";
var MODEL_CONVERT_OPERATION = "model.export-native";
var MODEL_UVM_OPERATION = "model.export-uvm";
var UVM_EXPORT_INPUT = Object.freeze({ schemaVersion: 1 });
var UVM_WRITES = Object.freeze({
  format: Object.freeze({ id: "uvm", label: "UVM" }),
  extension: ".uvm",
  mediaType: "model/gltf-binary; profile=uvm-1.0"
});
function modelConversions(descriptor) {
  const native = exportOffer(descriptor, MODEL_CONVERT_OPERATION).flatMap((form2) => {
    if (form2.writes === void 0)
      return [];
    try {
      return [{ form: form2, input: form2.build(/* @__PURE__ */ new Map()) }];
    } catch {
      return [];
    }
  });
  const uvm = descriptor.operations.find((item) => item.id === MODEL_UVM_OPERATION && item.state === "available" && !item.mutatesSource);
  if (uvm === void 0)
    return native;
  const form = Object.freeze({
    id: "uvm",
    label: "UVM",
    operationId: MODEL_UVM_OPERATION,
    handlerId: uvm.handlerId,
    summary: "UVM",
    fields: Object.freeze([]),
    writes: UVM_WRITES,
    build: () => UVM_EXPORT_INPUT
  });
  return [...native, { form, input: UVM_EXPORT_INPUT }];
}
function modelRendererBackend(rendererId) {
  return MODEL_RENDERER_BACKENDS[rendererId] ?? "provider";
}
var MODEL_FACET_DETAIL_LIMIT = 64;
var MODEL_FACET_CONTRACTS = Object.freeze([
  "common.view/model-resource-refs-source",
  "common.view/model-skeleton-source",
  "common.view/model-animation-source",
  "common.view/model-collision-source",
  "common.view/model-material-source",
  "common.view/model-socket-source",
  "common.view/model-effect-source",
  "common.view/model-light-source",
  "common.view/model-camera-source",
  "common.view/model-physics-source",
  "common.view/model-node-behaviour-source",
  "common.view/model-lod-source"
]);
var FACET_READOUT = Object.freeze({
  "common.view/model-resource-refs-source": {
    labelKey: "viewer.modelResources",
    key: "references"
  },
  "common.view/model-skeleton-source": { labelKey: "viewer.modelBones", key: "bindings" },
  "common.view/model-animation-source": { labelKey: "viewer.modelClips", key: "clips" },
  "common.view/model-collision-source": { labelKey: "viewer.modelCollision", key: "volumes" },
  "common.view/model-material-source": { labelKey: "viewer.modelMaterials", key: "materials" },
  "common.view/model-socket-source": { labelKey: "viewer.modelSockets", key: "sockets" },
  "common.view/model-effect-source": { labelKey: "viewer.modelEffects", key: "effects" },
  "common.view/model-light-source": { labelKey: "viewer.modelLights", key: "lights" },
  "common.view/model-camera-source": { labelKey: "viewer.modelCameras", key: "cameras" },
  "common.view/model-physics-source": { labelKey: "viewer.modelPhysics", key: "bodies" },
  "common.view/model-node-behaviour-source": {
    labelKey: "viewer.modelBehaviours",
    key: "behaviours"
  },
  "common.view/model-lod-source": { labelKey: "viewer.modelLods", key: "levels" }
});
var MODEL_PANEL_SECTIONS = Object.freeze([
  {
    id: "meshes",
    title: "Meshes",
    contract: "common.view/model-material-source",
    icon: "symbol-method"
  },
  {
    id: "materials",
    title: "Materials",
    contract: "common.view/model-material-source",
    icon: "paintcan"
  },
  {
    id: "resources",
    title: "Resources",
    contract: "common.view/model-resource-refs-source",
    icon: "file-media"
  },
  {
    id: "bones",
    title: "Bones",
    contract: "common.view/model-skeleton-source",
    icon: "type-hierarchy"
  },
  {
    id: "animations",
    title: "Animations",
    contract: "common.view/model-animation-source",
    icon: "play"
  },
  {
    id: "attachments",
    title: "Attachments",
    contract: "common.view/model-socket-source",
    icon: "pinned"
  },
  {
    id: "hit-volumes",
    title: "Hit Volumes",
    contract: "common.view/model-collision-source",
    icon: "shield"
  },
  { id: "lights", title: "Lights", contract: "common.view/model-light-source", icon: "lightbulb" },
  {
    id: "turrets",
    title: "Turrets",
    contract: "common.view/model-node-behaviour-source",
    kind: "turret",
    icon: "target"
  },
  {
    id: "cameras",
    title: "Cameras",
    contract: "common.view/model-camera-source",
    icon: "device-camera"
  },
  {
    id: "ribbons",
    title: "Ribbons",
    contract: "common.view/model-effect-source",
    kind: "ribbon",
    icon: "sparkle"
  },
  {
    id: "ribbon-splines",
    title: "Ribbon Splines",
    contract: "common.view/model-effect-source",
    kind: "ribbon-spline",
    icon: "sparkle"
  },
  {
    id: "particles",
    title: "Particles",
    contract: "common.view/model-effect-source",
    kind: "particle",
    icon: "sparkle"
  },
  {
    id: "particle-copies",
    title: "Particle Copies",
    contract: "common.view/model-effect-source",
    kind: "particle-copy",
    icon: "sparkle"
  },
  {
    id: "projections",
    title: "Projections",
    contract: "common.view/model-effect-source",
    kind: "projection",
    icon: "sparkle"
  },
  {
    id: "forces",
    title: "Forces",
    contract: "common.view/model-effect-source",
    kind: "force",
    icon: "sparkle"
  },
  {
    id: "billboards",
    title: "Billboards",
    contract: "common.view/model-node-behaviour-source",
    kind: "billboard",
    icon: "target"
  },
  {
    id: "warps",
    title: "Warps",
    contract: "common.view/model-effect-source",
    kind: "warp",
    icon: "sparkle"
  },
  {
    id: "shadow-boxes",
    title: "Shadow Boxes",
    contract: "common.view/model-effect-source",
    kind: "shadow-box",
    icon: "sparkle"
  },
  {
    id: "rigid-bodies",
    title: "Rigid Bodies",
    contract: "common.view/model-physics-source",
    kind: "rigid-body",
    icon: "circuit-board"
  },
  {
    id: "physics-shapes",
    title: "Physics Shapes",
    contract: "common.view/model-physics-source",
    kind: "shape",
    icon: "circuit-board"
  },
  {
    id: "physics-joints",
    title: "Physics Joints",
    contract: "common.view/model-physics-source",
    kind: "joint",
    icon: "circuit-board"
  },
  {
    id: "physics-cloths",
    title: "Physics Cloths",
    contract: "common.view/model-physics-source",
    kind: "cloth",
    icon: "circuit-board"
  },
  {
    id: "cloth-constraints",
    title: "Cloth Constraints",
    contract: "common.view/model-physics-source",
    kind: "cloth-constraint",
    icon: "circuit-board"
  },
  {
    id: "ik",
    title: "Inverse Kinematics",
    contract: "common.view/model-node-behaviour-source",
    kind: "ik",
    icon: "target"
  }
]);
var MODEL_TEAM_COLOR_PRESETS = Object.freeze([
  "#d9140f",
  "#2563eb",
  "#16a34a",
  "#facc15",
  "#9333ea",
  "#06b6d4",
  "#f97316",
  "#e5e7eb"
]);
function modelRecordRows(record) {
  if (typeof record !== "object" || record === null || Array.isArray(record))
    return [];
  const rows = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === void 0 || value === null)
      continue;
    if (key === "properties" && Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
          continue;
        const property = entry;
        if (typeof property.key !== "string")
          continue;
        rows.push([property.key, describeModelValue(property.value)]);
      }
      continue;
    }
    rows.push([key, describeModelValue(value)]);
  }
  return rows;
}
function describeModelValue(value) {
  if (value === null || value === void 0)
    return "";
  if (Array.isArray(value))
    return value.map((item) => typeof item === "number" ? Number(item.toFixed(4)) : describeModelValue(item)).join(", ");
  if (typeof value === "number")
    return String(Number(value.toFixed(4)));
  if (typeof value === "object")
    return JSON.stringify(value);
  return String(value);
}
async function readModelFacets(sources, slot, scope, signal, localizer = withEnglishUiFallback(void 0, MODEL_FALLBACK_MESSAGES)) {
  const parts = [];
  for (const contract of MODEL_FACET_CONTRACTS) {
    const lease = await unknownSourceLease(sources, slot, contract);
    if (lease === void 0)
      continue;
    scope.lease(lease);
    const readout = FACET_READOUT[contract];
    const source = lease.value;
    const info = await source.info(signal);
    const value = info[readout?.key ?? ""];
    if (typeof value === "number") {
      parts.push(`${value} ${readout === void 0 ? contract : localizer.text(readout.labelKey)}`);
    }
  }
  return parts;
}
function short(value) {
  const text = String(value ?? "").trim();
  return text.length <= 160 ? text : `${text.slice(0, 157)}\u2026`;
}
function facetItem(contract, value, localizer) {
  if (contract === "common.view/model-resource-refs-source") {
    const item2 = value;
    return `${short(item2.id)} \xB7 ${item2.role} \xB7 ${item2.provenance}`;
  }
  if (contract === "common.view/model-skeleton-source") {
    const item2 = value;
    const parent = item2.parentBoneIndex === void 0 ? "?" : item2.parentBoneIndex ?? "root";
    return `#${item2.boneIndex} ${short(item2.boneName ?? localizer.text("viewer.modelUnnamed"))} \xB7 ${localizer.text("viewer.modelParent", { parent })} \xB7 ${item2.flagNames?.join(", ") || localizer.text("viewer.modelNoNamedFlags")}`;
  }
  if (contract === "common.view/model-animation-source") {
    const item2 = value;
    const samples = item2.channels.reduce((total, channel) => total + (channel.samples?.length ?? 0), 0);
    return `${short(item2.name)} \xB7 ${localizer.text("viewer.modelClipDetail", {
      frames: item2.frames,
      channels: item2.channels.length,
      samples
    })}`;
  }
  if (contract === "common.view/model-collision-source") {
    const item2 = value;
    return `${short(item2.id)} \xB7 ${item2.kind} \xB7 ${item2.origin}`;
  }
  if (contract === "common.view/model-material-source") {
    const item2 = value;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.type ?? localizer.text("viewer.modelMaterial")} \xB7 ${item2.blendMode ?? localizer.text("viewer.modelBlendUnknown")} \xB7 ${localizer.text("viewer.modelLayers", { count: item2.layers?.length ?? 0 })}`;
  }
  if (contract === "common.view/model-light-source") {
    const item2 = value;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.kind} \xB7 ${item2.nodeId ?? "\u2014"}`;
  }
  if (contract === "common.view/model-camera-source") {
    const item2 = value;
    const fov = item2.fieldOfViewRadians === void 0 ? "\u2014" : `${(item2.fieldOfViewRadians * 180 / Math.PI).toFixed(1)}\xB0`;
    return `${short(item2.name ?? item2.id)} \xB7 ${fov} \xB7 ${item2.nodeId ?? "\u2014"}`;
  }
  if (contract === "common.view/model-physics-source") {
    const item2 = value;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.kind}${item2.shape === void 0 ? "" : ` \xB7 ${item2.shape}`} \xB7 ${item2.nodeId ?? "\u2014"}`;
  }
  if (contract === "common.view/model-node-behaviour-source") {
    const item2 = value;
    const spans = item2.nodeIds === void 0 ? "" : ` \xB7 ${String(item2.nodeIds.length)}`;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.kind} \xB7 ${item2.nodeId ?? "\u2014"}${spans}`;
  }
  if (contract === "common.view/model-effect-source") {
    const item2 = value;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.kind} \xB7 ${item2.nodeId ?? "\u2014"} \xB7 ${localizer.text("viewer.modelEffectProperties", { count: item2.properties?.length ?? 0 })}`;
  }
  if (contract === "common.view/model-lod-source") {
    const item2 = value;
    return `${short(item2.id)} \xB7 ${localizer.text("viewer.modelLodLevel", { order: item2.order })} \xB7 ${String(item2.nodeIds.length)}`;
  }
  const item = value;
  return `${short(item.sourceName ?? item.id)} \xB7 ${item.role} \xB7 ${item.nodeId}`;
}
var FACET_PAGE_METHOD = Object.freeze({
  "common.view/model-resource-refs-source": "references",
  "common.view/model-skeleton-source": "bindings",
  "common.view/model-animation-source": "clips",
  "common.view/model-collision-source": "volumes",
  "common.view/model-material-source": "materials",
  "common.view/model-socket-source": "sockets",
  "common.view/model-effect-source": "effects",
  "common.view/model-light-source": "lights",
  "common.view/model-camera-source": "cameras",
  "common.view/model-physics-source": "bodies",
  "common.view/model-node-behaviour-source": "behaviours",
  "common.view/model-lod-source": "levels"
});
async function readModelFacetPages(sources, slot, scope, signal) {
  const pages = /* @__PURE__ */ new Map();
  for (const contract of MODEL_FACET_CONTRACTS) {
    const lease = await unknownSourceLease(sources, slot, contract);
    if (lease === void 0)
      continue;
    scope.lease(lease);
    const source = lease.value;
    const method = source[FACET_PAGE_METHOD[contract]];
    if (method === void 0)
      continue;
    const items = await readModelRecords((request, abort) => method.call(source, request, abort), MODEL_MAXIMUM_RECORDS, signal);
    pages.set(contract, { items, truncated: false });
  }
  return pages;
}
function describeModelFacetPages(pages, localizer = withEnglishUiFallback(void 0, MODEL_FALLBACK_MESSAGES)) {
  const details = [];
  for (const contract of MODEL_FACET_CONTRACTS) {
    const page = pages.get(contract);
    if (page === void 0)
      continue;
    const readout = FACET_READOUT[contract];
    details.push(Object.freeze({
      contract,
      label: readout === void 0 ? contract : localizer.text(readout.labelKey),
      items: Object.freeze(page.items.slice(0, MODEL_FACET_DETAIL_LIMIT).map((item) => facetItem(contract, item, localizer))),
      truncated: page.truncated || page.items.length > MODEL_FACET_DETAIL_LIMIT
    }));
  }
  return Object.freeze(details);
}
async function readModelFacetDetails(sources, slot, scope, signal, localizer = withEnglishUiFallback(void 0, MODEL_FALLBACK_MESSAGES)) {
  return describeModelFacetPages(await readModelFacetPages(sources, slot, scope, signal), localizer);
}
function drawPrimitive(canvas, primitive, viewProjection) {
  const context = canvas.getContext("2d");
  if (context === null)
    throw new TypeError("2d canvas context is unavailable");
  const positions = primitive.positions;
  if (positions.length % 3 !== 0 || !positions.every(Number.isFinite))
    throw new TypeError("model primitive positions are malformed");
  const matrix = primitive.transform === void 0 ? viewProjection : multiply4x4(viewProjection, primitive.transform);
  const point = (vertex) => projectPoint(matrix, [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]], { width: canvas.width, height: canvas.height });
  const indices = primitive.indices ?? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const vertexCount = positions.length / 3;
  if (indices.some((index) => index >= vertexCount)) {
    throw new RangeError("model primitive index is outside the position buffer");
  }
  const stroke = getComputedStyle(canvas).getPropertyValue("--mk-chart-categorical-1").trim() || "#4daafc";
  context.strokeStyle = stroke;
  context.fillStyle = stroke;
  context.lineWidth = 1;
  const edge = (from, to) => {
    const a = point(from);
    const b = point(to);
    if (a === void 0 || b === void 0)
      return;
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
  };
  const triangle = (first, second, third) => {
    const a = point(first);
    const b = point(second);
    const c = point(third);
    if (a === void 0 || b === void 0 || c === void 0)
      return;
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.lineTo(c[0], c[1]);
    context.closePath();
    context.stroke();
  };
  if (primitive.topology === "points") {
    for (const vertex of indices) {
      const value = point(vertex);
      if (value === void 0)
        continue;
      context.fillRect(value[0] - 1, value[1] - 1, 3, 3);
    }
  } else if (primitive.topology === "lines") {
    for (let index = 0; index + 1 < indices.length; index += 2) {
      edge(indices[index], indices[index + 1]);
    }
  } else if (primitive.topology === "line-strip") {
    for (let index = 0; index + 1 < indices.length; index += 1) {
      edge(indices[index], indices[index + 1]);
    }
  } else if (primitive.topology === "triangles") {
    for (let index = 0; index + 2 < indices.length; index += 3) {
      triangle(indices[index], indices[index + 1], indices[index + 2]);
    }
  } else if (primitive.topology === "triangle-strip") {
    for (let index = 0; index + 2 < indices.length; index += 1) {
      triangle(indices[index], indices[index + 1], indices[index + 2]);
    }
  } else {
    for (let index = 1; index + 1 < indices.length; index += 1) {
      triangle(indices[0], indices[index], indices[index + 1]);
    }
  }
}
var MODEL_STAGE_WIDTH = 720;
var MODEL_STAGE_HEIGHT = 480;
function drawNormals(context, primitive, viewProjection, viewport, length, stroke) {
  const { positions, normals } = primitive;
  if (normals === void 0 || normals.length !== positions.length)
    return 0;
  const matrix = primitive.transform === void 0 ? viewProjection : multiply4x4(viewProjection, primitive.transform);
  context.save();
  context.strokeStyle = stroke;
  context.lineWidth = 1;
  context.beginPath();
  let drawn = 0;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    const from = projectPoint(matrix, [x, y, z], viewport);
    const to = projectPoint(matrix, [
      x + normals[index] * length,
      y + normals[index + 1] * length,
      z + normals[index + 2] * length
    ], viewport);
    if (from === void 0 || to === void 0)
      continue;
    context.moveTo(from[0], from[1]);
    context.lineTo(to[0], to[1]);
    drawn += 1;
  }
  context.stroke();
  context.restore();
  return drawn;
}
function drawSkeleton(context, joints, viewProjection, viewport, stroke) {
  const projected = joints.map((joint) => projectPoint(viewProjection, joint.position, viewport));
  context.save();
  context.strokeStyle = stroke;
  context.fillStyle = stroke;
  context.lineWidth = 1.5;
  let drawn = 0;
  for (const [index, joint] of joints.entries()) {
    const point = projected[index];
    if (point === void 0)
      continue;
    drawn += 1;
    context.beginPath();
    context.arc(point[0], point[1], 2.5, 0, Math.PI * 2);
    context.fill();
    const parent = joint.parent === void 0 ? void 0 : projected[joint.parent];
    if (parent === void 0)
      continue;
    context.beginPath();
    context.moveTo(parent[0], parent[1]);
    context.lineTo(point[0], point[1]);
    context.stroke();
  }
  context.restore();
  return drawn;
}
function themeColor(canvas, token, fallback) {
  return getComputedStyle(canvas).getPropertyValue(token).trim() || fallback;
}
async function resolveModelViewerTextures(port, references, signal, report) {
  const maximumBytes = 64 * 1024 * 1024;
  let remaining = maximumBytes;
  let index = 0;
  const textures = /* @__PURE__ */ new Map();
  const wanted = new Set(references.filter((item) => item.role === "texture").map((item) => item.id));
  const share = Math.max(4 * 1024 * 1024, Math.floor(maximumBytes / Math.max(1, wanted.size)));
  for (const reference of references) {
    signal?.throwIfAborted();
    if (reference.role !== "texture" || textures.has(reference.id))
      continue;
    if (remaining <= 0) {
      report?.(reference.id, `over the ${maximumBytes / (1024 * 1024)} MiB the viewer reads`);
      continue;
    }
    const textureId = `model-texture-${index++}`;
    const result = await port.read({
      kind: "logical",
      requirement: {
        id: textureId,
        logicalId: reference.id,
        role: "texture",
        scopes: [
          "sibling-directory",
          "workspace-dependency-layer",
          "current-mount",
          "enclosing-container"
        ]
      },
      maxBytes: Math.min(remaining, share),
      selection: { face: "all", mipLevel: "fit" }
    }, signal);
    signal?.throwIfAborted();
    if (result.state === "unresolved" || result.state === "compressed") {
      const codes = [...new Set(result.diagnostics.map((item) => item.code))].join(", ");
      report?.(reference.id, codes === "" ? result.state : codes);
      continue;
    }
    const faces = result.info.faces ?? 1;
    if (faces !== 1 && faces !== 6 || faces === 6 && result.info.width !== result.info.height) {
      report?.(reference.id, `${faces} faces of ${result.info.width}\xD7${result.info.height}`);
      continue;
    }
    const surfaces = result.state === "decoded-surfaces" ? result.surfaces : [
      {
        subresource: result.subresource ?? {
          frame: 0,
          mipLevel: 0,
          layer: 0,
          face: 0,
          slice: 0
        },
        region: result.region
      }
    ];
    const chosen = surfaces[0];
    if (chosen === void 0) {
      report?.(reference.id, "no surface");
      continue;
    }
    const { width, height } = chosen.region;
    const mipLevel = chosen.subresource.mipLevel;
    const faceBytes = width * height * 4;
    const byteLength = faceBytes * faces;
    if (surfaces.length !== faces || byteLength > remaining) {
      report?.(reference.id, `${width}\xD7${height}: over what is left of the viewer's budget`);
      continue;
    }
    const rgba = new Uint8Array(byteLength);
    let valid = true;
    for (const [face, surface] of surfaces.entries()) {
      const selected = surface.subresource;
      const region = surface.region;
      if (selected.face !== face || selected.frame !== 0 || selected.mipLevel !== mipLevel || selected.layer !== 0 || selected.slice !== 0 || region.width !== width || region.height !== height || region.pixelFormat !== "rgba8" || region.rowStride < region.width * 4 || region.rowStride * (region.height - 1) + region.width * 4 > region.pixels.length) {
        valid = false;
        break;
      }
      for (let row = 0; row < region.height; row += 1) {
        const sourceOffset = row * region.rowStride;
        const targetOffset = face * faceBytes + row * region.width * 4;
        rgba.set(region.pixels.subarray(sourceOffset, sourceOffset + region.width * 4), targetOffset);
      }
    }
    if (!valid) {
      report?.(reference.id, "a surface the viewer cannot read");
      continue;
    }
    remaining -= byteLength;
    if (reference.ignoreStoredAlpha === true) {
      for (let alpha = 3; alpha < rgba.length; alpha += 4)
        rgba[alpha] = 255;
    }
    const key = reference.colorKey;
    const keyed = key === void 0 || faces !== 1 ? rgba : applyColorKeyTransparency({ width, height, pixels: rgba }, {
      target: { r: key.color[0], g: key.color[1], b: key.color[2] },
      tolerance: key.tolerance ?? 0
    }).pixels;
    textures.set(reference.id, {
      id: textureId,
      width,
      height,
      rgba: keyed,
      ...faces === 6 ? { dimension: "cube" } : {},
      // sampled as the game samples it: `nearest` keeps pixel art and its cut-outs sharp
      ...reference.filter === void 0 ? {} : { filter: reference.filter },
      ...result.info.channelLayout === void 0 ? {} : { channelLayout: result.info.channelLayout },
      ...result.info.compression === void 0 ? {} : { compression: result.info.compression }
    });
  }
  return textures;
}
function clipNamePath(clip, ordinal) {
  const index = Number.isSafeInteger(clip.sequenceIndex) ? clip.sequenceIndex : ordinal;
  return ["animations", String(index), "name"];
}
function canRenameClips(route) {
  const operation = route.descriptor.operations.find((candidate) => candidate.id === CLIP_RENAME_OPERATION);
  if (operation === void 0 || operation.state !== "available")
    return false;
  return route.commit !== void 0 && route.authorization !== void 0;
}
function mountClipRename(toolbar, options) {
  if (!canRenameClips(options))
    return void 0;
  const field = element(toolbar, "input", { part: "model.animation-name" });
  field.type = "text";
  field.disabled = true;
  field.setAttribute("aria-label", options.localizer.text("viewer.modelAnimationName"));
  const status = element(toolbar, "output", { part: "model.animation-name-status" });
  const selectedClip = () => {
    const ordinal = options.clips.findIndex((candidate) => candidate.id === options.selector.value);
    const clip = options.clips[ordinal];
    return clip === void 0 ? void 0 : { clip, ordinal };
  };
  const syncToSelection = () => {
    const selected = selectedClip();
    field.disabled = selected === void 0;
    field.value = selected?.clip.name ?? "";
    status.textContent = "";
  };
  syncToSelection();
  options.selector.addEventListener("change", syncToSelection, {
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  const rename = async () => {
    const selected = selectedClip();
    const name = field.value.trim();
    if (selected === void 0 || name === "" || name === selected.clip.name) {
      syncToSelection();
      return;
    }
    field.disabled = true;
    status.textContent = options.localizer.text("viewer.modelAnimationRenaming");
    const refusal = await commitOperationWrite({
      descriptor: options.descriptor,
      operations: options.operations,
      ...options.commit === void 0 ? {} : { commit: options.commit },
      ...options.authorization === void 0 ? {} : { authorization: options.authorization }
    }, CLIP_RENAME_OPERATION, {
      groupId: "tree",
      path: [...clipNamePath(selected.clip, selected.ordinal)],
      key: "name",
      value: name
    }, options.signal);
    field.disabled = false;
    if (refusal !== void 0) {
      status.textContent = refusal;
      return;
    }
    status.textContent = "";
    const option = [...options.selector.options].find((candidate) => candidate.value === selected.clip.id);
    if (option !== void 0)
      option.text = name;
  };
  field.addEventListener("change", () => void rename(), {
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  return () => {
    field.remove();
    status.remove();
  };
}
function modelFrameCamera(placement, correction) {
  const view = correction === void 0 ? placement.viewMatrix : multiply4x4(placement.viewMatrix, correction);
  const [x, y, z] = placement.eye;
  const position = correction === void 0 ? [x, y, z] : [0, 1, 2].map((axis) => (correction[axis * 4] ?? 0) * x + (correction[axis * 4 + 1] ?? 0) * y + (correction[axis * 4 + 2] ?? 0) * z);
  return { rotation: billboardCameraRotation(Array.from(view)), position };
}
var MODEL_ANIMATION_SPEEDS = [0.25, 0.5, 1, 2, 4];
function createModelViewer(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, MODEL_FALLBACK_MESSAGES);
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("viewer.model"));
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...args.gallery === void 0 ? {} : { gallery: args.gallery }
      });
      root.append(shell.root);
      scope.cleanup(() => shell.destroy());
      if (args.gallery !== void 0)
        void shell.refreshGallery(scope.signal).catch(() => void 0);
      const stage = element(shell.stage, "div", { part: "model" });
      const readout = element(stage, "output", { part: "model.readout" });
      const toolbar = element(stage, "div", { part: "model.toolbar", role: "toolbar" });
      toolbar.setAttribute("aria-label", localizer.text("viewer.modelView"));
      const canvas = element(stage, "canvas", { part: "model.canvas" });
      canvas.setAttribute("role", "img");
      canvas.setAttribute("data-model-renderer", MODEL_WIREFRAME_BACKEND);
      canvas.setAttribute("data-model-renderer-status", "unavailable");
      canvas.tabIndex = 0;
      const camera = createOrbitController();
      const gizmo = createViewGizmo(stage, { localizer, onAxis: (axis) => camera.snapTo(axis) });
      const lease = await unknownSourceLease(args.sources, args.slot, "common.view/model-scene-source");
      if (lease === void 0)
        throw new TypeError("model binding is unavailable");
      scope.lease(lease);
      setState(stage, ["loading"]);
      try {
        const sceneSource = lease.value;
        const model = await loadModelStage(sceneSource, scope.signal);
        const [facets, facetPages] = await Promise.all([
          readModelFacets(args.sources, args.slot, scope, scope.signal, localizer),
          readModelFacetPages(args.sources, args.slot, scope, scope.signal)
        ]);
        const facetDetails = describeModelFacetPages(facetPages, localizer);
        setViewerText(readout, localizer.text("viewer.modelSummary", {
          nodes: model.info.nodes,
          meshes: model.info.meshes,
          primitives: model.info.primitives,
          materials: model.info.materials,
          animations: model.info.animations,
          facets: facets.length === 0 ? "" : ` \xB7 ${facets.join(" \xB7 ")}`
        }));
        const panel = {
          rendering: shell.section("rendering", localizer.text("viewer.modelRendering"), {
            icon: "device-camera-video",
            collapsed: false
          }),
          animation: shell.section("animation", localizer.text("viewer.modelAnimation"), {
            icon: "play",
            collapsed: false
          }),
          editing: shell.section("editing", localizer.text("viewer.modelEditing"), {
            icon: "edit"
          }),
          teamColor: shell.section("team-color", localizer.text("viewer.modelTeamColor"), {
            icon: "symbol-color"
          }),
          export: shell.section("export", localizer.text("viewer.modelExport"), {
            icon: "export"
          })
        };
        const controlRow = (section, label) => {
          const grid = section.body.querySelector(`[${PART_ATTRIBUTE}="model.controls"]`) ?? element(section.body, "div", { part: "model.controls" });
          const row = element(grid, "div", { part: "model.control-row" });
          element(row, "span", { text: label, part: "model.control-label" });
          return { row, field: element(row, "span", { part: "model.control-field" }) };
        };
        const body = shell.section("properties", localizer.text("viewer.modelProperties"), {
          icon: "symbol-misc",
          collapsed: false
        }).body;
        const list = element(body, "dl", { part: "image.metadata" });
        for (const [label, value] of [
          [localizer.text("viewer.modelSceneCount"), String(model.info.scenes)],
          [localizer.text("viewer.modelNodeCount"), String(model.info.nodes)],
          [localizer.text("viewer.modelMeshCount"), String(model.info.meshes)],
          [localizer.text("viewer.modelPrimitiveCount"), String(model.info.primitives)],
          [localizer.text("viewer.modelMaterialCount"), String(model.info.materials)],
          [localizer.text("viewer.modelTextureCount"), String(model.info.textures)],
          [localizer.text("viewer.modelAnimationCount"), String(model.info.animations)],
          [localizer.text("viewer.modelUpAxis"), model.info.upAxis ?? "+y"],
          [localizer.text("viewer.modelGeometryAccess"), model.info.geometryAccess]
        ]) {
          const row = element(list, "div", { part: "metadata.row" });
          element(row, "dt", { text: label, part: "metadata.label" });
          setViewerText(element(row, "dd", { part: "metadata.value" }), value, 64);
        }
        if (model.info.bounds !== void 0) {
          const bounds = model.info.bounds;
          const boundsList = element(shell.section("bounds", localizer.text("viewer.modelBounds"), {
            icon: "symbol-ruler",
            collapsed: true
          }).body, "dl", { part: "image.metadata" });
          const extent = bounds.max.map((value, axis) => value - (bounds.min[axis] ?? 0));
          for (const [label, value] of [
            [localizer.text("viewer.modelBoundsMinimum"), describeModelValue(bounds.min)],
            [localizer.text("viewer.modelBoundsMaximum"), describeModelValue(bounds.max)],
            [localizer.text("viewer.modelBoundsExtent"), describeModelValue(extent)]
          ]) {
            const row = element(boundsList, "div", { part: "metadata.row" });
            element(row, "dt", { text: label, part: "metadata.label" });
            setViewerText(element(row, "dd", { part: "metadata.value" }), value, 160);
          }
        }
        mountContributedSections(shell, options.sections, args, (unmount) => scope.cleanup(unmount));
        for (const spec of MODEL_PANEL_SECTIONS) {
          const page = facetPages.get(spec.contract);
          if (page === void 0)
            continue;
          const records = spec.kind === void 0 ? page.items : page.items.filter((item) => typeof item === "object" && item !== null && item.kind === spec.kind);
          if (records.length === 0)
            continue;
          const section = shell.section(spec.id, `${spec.title} (${records.length})`, {
            icon: spec.icon,
            collapsed: true
          });
          for (const record of records) {
            const rows = modelRecordRows(record);
            if (rows.length === 0)
              continue;
            const named = record;
            const entry = element(section.body, "details", { part: "model.facet-item" });
            element(entry, "summary", {
              text: String((typeof named.name === "string" && named.name !== "" ? named.name : void 0) ?? named.id ?? spec.title)
            });
            const list2 = element(entry, "dl", { part: "image.metadata" });
            for (const [key, value] of rows) {
              const row = element(list2, "div", { part: "metadata.row" });
              element(row, "dt", { text: key, part: "metadata.label" });
              setViewerText(element(row, "dd", { part: "metadata.value" }), value, 160);
            }
          }
        }
        const diagnostics = shell.section("diagnostics", localizer.text("viewer.modelDiagnosticsSection"), { icon: "warning", collapsed: true });
        const diagnosticsList = element(diagnostics.body, "dl", { part: "image.metadata" });
        const diagnosticRow = (label, value) => {
          const row = element(diagnosticsList, "div", { part: "metadata.row" });
          element(row, "dt", { text: label, part: "metadata.label" });
          setViewerText(element(row, "dd", { part: "metadata.value" }), value, 160);
        };
        for (const detail of facetDetails) {
          diagnosticRow(detail.label, detail.items.join(" \xB7 ") + (detail.truncated ? " \u2026" : ""));
        }
        const sceneTotals = model.primitives.reduce((totals, primitive) => ({
          vertices: totals.vertices + Math.floor(primitive.positions.length / 3),
          triangles: totals.triangles + Math.floor((primitive.indices?.length ?? primitive.positions.length / 3) / 3)
        }), { vertices: 0, triangles: 0 });
        const boneCount = facetPages.get("common.view/model-skeleton-source")?.items.length ?? 0;
        const resourceCount = facetPages.get("common.view/model-resource-refs-source")?.items.length ?? 0;
        const sceneStatus = [
          {
            id: "scene",
            icon: "symbol-misc",
            text: localizer.text("viewer.modelSceneCounts", {
              meshes: model.info.meshes,
              materials: model.info.materials,
              animations: model.info.animations
            }),
            align: "start"
          },
          {
            id: "geometry",
            icon: "symbol-method",
            text: `${sceneTotals.vertices} v \xB7 ${sceneTotals.triangles} tri`,
            align: "start"
          },
          ...boneCount === 0 ? [] : [
            {
              id: "rig",
              icon: "type-hierarchy",
              text: `${boneCount} bones`,
              align: "start"
            }
          ],
          ...resourceCount === 0 ? [] : [
            {
              id: "resources",
              icon: "file-media",
              text: `${resourceCount} textures`,
              align: "start"
            }
          ]
        ];
        const degrees = (radians) => Math.round(radians * 180 / Math.PI);
        const publishStatus = () => args.status?.set([
          ...sceneStatus,
          {
            id: "camera",
            icon: "device-camera",
            text: localizer.text("viewer.modelCamera", {
              yaw: degrees(camera.pose.yaw),
              pitch: degrees(camera.pose.pitch),
              zoom: (1 / camera.pose.distanceScale).toFixed(2)
            }),
            tooltip: localizer.text("viewer.modelCameraReset"),
            align: "end",
            action: true
          }
        ], (itemId) => {
          if (itemId === "camera")
            camera.reset();
        });
        publishStatus();
        let statusTimer;
        scope.cleanup(camera.onChange(() => {
          statusTimer ??= setTimeout(() => {
            statusTimer = void 0;
            publishStatus();
          }, 150);
        }));
        scope.cleanup(() => {
          if (statusTimer !== void 0)
            clearTimeout(statusTimer);
          args.status?.clear();
        });
        if (model.primitive === void 0) {
          canvas.remove();
          gizmo.destroy();
          toolbar.remove();
          element(stage, "p", {
            part: "viewer.empty",
            text: localizer.text("viewer.modelGeometryUnavailable")
          });
        } else {
          const viewport = { width: MODEL_STAGE_WIDTH, height: MODEL_STAGE_HEIGHT };
          const view = canvas.ownerDocument.defaultView;
          const measureViewport = () => {
            const rect = canvas.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
              return false;
            const density = Math.min(2, view?.devicePixelRatio ?? 1);
            const scale = Math.min(density, 2048 / rect.width, 2048 / rect.height);
            const width = Math.max(1, Math.round(rect.width * scale));
            const height = Math.max(1, Math.round(rect.height * scale));
            if (viewport.width === width && viewport.height === height)
              return false;
            viewport.width = width;
            viewport.height = height;
            return true;
          };
          let provider;
          if (options.renderer !== void 0) {
            try {
              const acquisition = await options.renderer.acquire({
                outputKind: "rgba8",
                signal: scope.signal
              });
              if (acquisition.state === "resolved") {
                provider = acquisition.lease.renderer;
                scope.cleanup(() => acquisition.lease.release());
                canvas.setAttribute("data-model-renderer", modelRendererBackend(provider.rendererId));
                canvas.setAttribute("data-model-renderer-id", provider.rendererId);
                canvas.setAttribute("data-model-renderer-status", "resolved");
              } else {
                canvas.setAttribute("data-model-renderer-status", "unresolved");
                const reason = acquisition.diagnostics.at(-1);
                if (reason !== void 0) {
                  canvas.setAttribute("data-model-renderer-diagnostic", reason.code);
                }
              }
            } catch (error) {
              canvas.setAttribute("data-model-renderer-status", "unresolved");
              canvas.setAttribute("data-model-renderer-diagnostic", "x3.ui/renderer-acquire-threw");
              canvas.setAttribute("data-model-renderer-detail", error instanceof Error ? error.message : String(error));
            }
          }
          const materialRefs = facetPages.get("common.view/model-material-source")?.items ?? [];
          const resourceRefs = facetPages.get("common.view/model-resource-refs-source")?.items ?? [];
          const boneBindings = facetPages.get("common.view/model-skeleton-source")?.items ?? [];
          const clips = facetPages.get("common.view/model-animation-source")?.items ?? [];
          const projection = { ...model, skeleton: boneBindings };
          const correction = upAxisCorrection(model.info.upAxis, model.info.handedness);
          const orient = (sampled) => correction === void 0 ? sampled : {
            ...sampled,
            primitives: sampled.primitives.map((one) => orientPrimitive(one, correction))
          };
          let player = createModelSceneSampler(projection, {
            signal: scope.signal,
            billboardCameraPerSample: true
          });
          let scene = orient(player.sample(0, scope.signal));
          const hiddenPrimitives = /* @__PURE__ */ new Set();
          const lodLevels = modelLodPrimitives(facetPages.get("common.view/model-lod-source")?.items ?? [], model);
          const showLod = (chosen) => {
            for (const level of lodLevels)
              for (const id of level.primitiveIds)
                if (chosen === void 0 || chosen.primitiveIds.has(id))
                  hiddenPrimitives.delete(id);
                else
                  hiddenPrimitives.add(id);
          };
          if (lodLevels.length > 1)
            showLod(lodLevels[0]);
          const primitiveBoxes = /* @__PURE__ */ new Map();
          const syncPrimitiveBoxes = () => {
            for (const [id, box] of primitiveBoxes)
              box.checked = !hiddenPrimitives.has(id);
          };
          let activeClip;
          let timeSeconds = 0;
          let teamColor = [0.851, 0.078, 0.059];
          const restFraming = framePrimitives(scene.primitives);
          const playbackStatus = element(stage, "output", { part: "model.playback-status" });
          const showDiagnostics = () => {
            setViewerText(playbackStatus, player.diagnostics.map((item) => item.message).join(" "));
            canvas.setAttribute("data-model-pose-diagnostics", player.diagnostics.map((item) => item.code).join(" "));
          };
          showDiagnostics();
          let texels = /* @__PURE__ */ new Map();
          const unresolved = /* @__PURE__ */ new Map();
          if (options.textures !== void 0 && provider !== void 0 && resourceRefs.length > 0) {
            texels = await options.textures(args.descriptor, resourceRefs, scope.signal, (id, reason) => unresolved.set(id, reason)).catch((error) => {
              const reason = error instanceof Error ? error.message : String(error);
              for (const item of resourceRefs)
                unresolved.set(item.id, reason);
              return /* @__PURE__ */ new Map();
            });
          }
          const surfaces = sceneMaterials(materialRefs, texels, true);
          canvas.setAttribute("data-model-textures", String(surfaces.textures.length));
          diagnosticRow(localizer.text("viewer.modelRendererLabel"), `${canvas.getAttribute("data-model-renderer") ?? ""} \xB7 ${canvas.getAttribute("data-model-renderer-status") ?? ""}${provider === void 0 ? "" : ` \xB7 ${provider.rendererId}`}`);
          const drawn = new Set(surfaces.textures.map((texture) => texture.id));
          const expected = resourceRefs.filter((item) => item.role === "texture");
          const undrawn = expected.flatMap((item) => {
            const texel = texels.get(item.id);
            if (texel !== void 0 && drawn.has(texel.id))
              return [];
            const reason = texel !== void 0 ? localizer.text("viewer.modelTextureUnbound") : unresolved.get(item.id) ?? localizer.text("viewer.modelTextureUnresolved");
            return [`${item.id}: ${reason}`];
          });
          diagnosticRow(localizer.text("viewer.modelTextureStatus"), [`${surfaces.textures.length} / ${expected.length}`, ...undrawn].join(" \xB7 "));
          canvas.setAttribute("data-model-skeleton", String(scene.joints.length));
          let skeletonVisible = scene.joints.length > 0;
          let wireframeVisible = false;
          let normalsVisible = false;
          const overlay = (context, primitives, viewProjection, size, shaded) => {
            if (wireframeVisible && shaded)
              for (const primitive of primitives)
                drawPrimitive(canvas, primitive, viewProjection);
            if (!normalsVisible)
              return;
            const stroke = themeColor(canvas, "--mk-chart-categorical-2", "#7ec27e");
            for (const primitive of primitives)
              drawNormals(context, primitive, viewProjection, size, framing().radius * 0.04, stroke);
          };
          const framing = () => restFraming;
          const effectRefs = facetPages.get("common.view/model-effect-source")?.items ?? [];
          const uvmExport = args.descriptor.operations.find((item) => item.id === MODEL_UVM_OPERATION && item.state === "available" && !item.mutatesSource);
          const effectsOffered = provider !== void 0 && effectRefs.length > 0 && uvmExport !== void 0;
          let effectsOn = effectsOffered;
          let effectPreparer;
          let effectLoading;
          let effectFailure;
          let effectUnits;
          let effectStatus;
          const effectClockStart = performance.now();
          canvas.setAttribute("data-model-effects-status", effectsOffered ? "off" : "none");
          const showEffects = (status, text, title = "") => {
            canvas.setAttribute("data-model-effects-status", status);
            if (effectStatus === void 0)
              return;
            setViewerText(effectStatus, text);
            effectStatus.title = title;
          };
          const effectsFailed = (error) => {
            effectFailure = error instanceof Error ? error.message : String(error);
            showEffects("failed", localizer.text("viewer.modelEffectsFailed", { reason: effectFailure }));
          };
          const loadEffects = () => effectLoading ??= (async () => {
            if (uvmExport === void 0)
              return;
            showEffects("loading", localizer.text("viewer.modelEffectsLoading"));
            try {
              const result = await args.operations.invoke(uvmExport.handlerId, UVM_EXPORT_INPUT, {
                signal: scope.signal
              });
              if (result.state !== "ok")
                throw new Error(result.reason);
              const output = result.output;
              if (output.kind !== "bytes" || !(output.value instanceof Uint8Array))
                throw new Error(`the codec answered ${output.kind}, not bytes`);
              const { createUvmFramePreparer } = await import("./render-BBEEJQBS.js");
              const raster = options.rasterResources?.(args.descriptor);
              const preparer = createUvmFramePreparer(output.value, {
                budget: MODEL_EFFECT_BUDGET,
                ...raster === void 0 ? {} : { rasterResources: rememberingRasterPort(raster, scope.signal) }
              });
              scope.cleanup(() => preparer.dispose());
              effectPreparer = preparer;
              generation++;
              redraw();
              animateEffects();
            } catch (error) {
              if (!scope.signal.aborted)
                effectsFailed(error);
            }
          })();
          const effectLayerFor = async (time) => {
            if (!effectsOn || effectFailure !== void 0)
              return void 0;
            const preparer = effectPreparer;
            if (preparer === void 0) {
              void loadEffects();
              return void 0;
            }
            try {
              const at = (units) => preparer.prepare(modelEffectRequest({
                // the frame lies in metres: the same orbit around the model made `units` larger
                camera: modelCamera(effectFraming(framing(), units), camera.basis(), camera.pose.distanceScale, viewport),
                viewport,
                time: activeClip === void 0 ? (performance.now() - effectClockStart) / 1e3 % MODEL_EFFECT_LOOP_SECONDS : time,
                ...activeClip === void 0 ? {} : { clipId: activeClip.id },
                teamColor
              }), scope.signal);
              effectUnits ??= (await at(1)).metersPerSourceUnit;
              const frame = await at(effectUnits);
              canvas.setAttribute("data-model-effects", String(frame.effectPrimitiveIds.length));
              showEffects("drawn", localizer.text("viewer.modelEffectsDrawn", {
                count: frame.effectPrimitiveIds.length
              }), frame.diagnostics.map((item) => item.message).join("\n"));
              return frame;
            } catch (error) {
              if (!scope.signal.aborted)
                effectsFailed(error);
              return void 0;
            }
          };
          let effectFrameId = 0;
          const animateEffects = () => {
            cancelAnimationFrame(effectFrameId);
            if (!effectsOn || effectPreparer === void 0 || effectFailure !== void 0 || activeClip !== void 0 || scope.signal.aborted)
              return;
            redraw();
            effectFrameId = requestAnimationFrame(animateEffects);
          };
          scope.cleanup(() => cancelAnimationFrame(effectFrameId));
          let generation = 0;
          const drawWireframe = () => {
            measureViewport();
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const placement = modelCamera(framing(), camera.basis(), camera.pose.distanceScale, viewport);
            for (const primitive of scene.primitives)
              if (!hiddenPrimitives.has(primitive.id))
                drawPrimitive(canvas, primitive, placement.viewProjection);
            const context = canvas.getContext("2d");
            if (context !== null)
              overlay(context, scene.primitives.filter((item) => !hiddenPrimitives.has(item.id)), placement.viewProjection, viewport, false);
            if (context !== null && skeletonVisible)
              drawSkeleton(context, scene.joints, placement.viewProjection, viewport, themeColor(canvas, "--mk-chart-categorical-3", "#f0a04b"));
            canvas.setAttribute("data-model-animation-time", String(timeSeconds));
          };
          let renderBusy = false;
          let redrawPending = false;
          let pendingFrame;
          const redraw = () => {
            measureViewport();
            const pose = camera.pose;
            gizmo.update(pose.yaw, pose.pitch);
            const request = generation;
            if (scope.signal.aborted)
              return;
            if (renderBusy) {
              redrawPending = true;
              return;
            }
            const viewPlacement = modelCamera(framing(), camera.basis(), pose.distanceScale, viewport);
            try {
              scene = orient(player.sample(timeSeconds, scope.signal, modelFrameCamera(viewPlacement, correction)));
            } catch (error) {
              setViewerText(playbackStatus, error instanceof Error ? error.message : String(error));
              canvas.setAttribute("data-model-pose-diagnostics", "common.model/pose-failed");
              return;
            }
            const drawnTime = timeSeconds;
            const joints = scene.joints;
            const primitives = scene.primitives.filter((item) => !hiddenPrimitives.has(item.id));
            canvas.setAttribute("data-model-primitives", String(primitives.length));
            canvas.setAttribute("data-model-skeleton", String(joints.length));
            if (provider === void 0) {
              drawWireframe();
              return;
            }
            measureViewport();
            const placement = modelCamera(framing(), camera.basis(), pose.distanceScale, viewport);
            const renderer = provider;
            renderBusy = true;
            pendingFrame = (async () => {
              try {
                const effects = await effectLayerFor(drawnTime);
                const sceneRequest = modelSceneRequest({
                  primitives,
                  camera: placement,
                  viewport,
                  materials: surfaces.materials,
                  textures: surfaces.textures,
                  clearColor: [0, 0, 0, 0],
                  light: MODEL_KEY_LIGHT,
                  materialContext: {
                    // Scene lighting, as the headless render: the key light's ambient lights every
                    // face and emission and environment show whatever the facing. Without it a
                    // standard material shaded inside `lambert > 0` — faces turned from the light
                    // drew black and lost their glow.
                    sceneLighting: true,
                    time: drawnTime,
                    sequenceTime: drawnTime,
                    teamColor,
                    ...activeClip?.sequenceIndex === void 0 ? {} : { sequenceIndex: activeClip.sequenceIndex }
                  },
                  signal: scope.signal
                });
                const frame = await renderer.render(effects === void 0 ? sceneRequest : withModelEffectLayer(sceneRequest, effects));
                if (request !== generation || scope.signal.aborted)
                  return;
                const context = canvas.getContext("2d");
                if (context === null)
                  throw new TypeError("2d canvas context is unavailable");
                const expected2 = frame.width * frame.height * 4;
                if (frame.rgba.length !== expected2) {
                  throw new TypeError(`renderer returned ${frame.rgba.length} bytes for a ${frame.width}x${frame.height} frame`);
                }
                canvas.width = frame.width;
                canvas.height = frame.height;
                const pixels = new Uint8ClampedArray(expected2);
                pixels.set(frame.rgba);
                context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
                canvas.setAttribute("data-model-animation-time", String(drawnTime));
                overlay(context, primitives, placement.viewProjection, frame, true);
                if (skeletonVisible && joints.length > 0) {
                  drawSkeleton(context, joints, placement.viewProjection, { width: frame.width, height: frame.height }, themeColor(canvas, "--mk-chart-categorical-3", "#f0a04b"));
                }
              } catch (error) {
                if (scope.signal.aborted)
                  return;
                provider = void 0;
                canvas.setAttribute("data-model-renderer", MODEL_WIREFRAME_BACKEND);
                canvas.removeAttribute("data-model-renderer-id");
                canvas.setAttribute("data-model-renderer-status", "failed");
                canvas.setAttribute("data-model-renderer-diagnostic", "x3.ui/renderer-frame-failed");
                canvas.setAttribute("data-model-renderer-detail", error instanceof Error ? error.message : String(error));
                canvas.setAttribute("data-model-textures", "0");
                drawWireframe();
              } finally {
                renderBusy = false;
                if (redrawPending && !scope.signal.aborted) {
                  redrawPending = false;
                  redraw();
                }
              }
            })();
          };
          scope.cleanup(async () => {
            await pendingFrame;
          });
          scope.cleanup(camera.onChange(redraw));
          camera.attach(canvas, scope.signal);
          const button = (parent, label, title, run) => {
            const node = element(parent, "button", { part: "operations.button", text: label });
            node.setAttribute("type", "button");
            node.title = title;
            node.addEventListener("click", run, { signal: scope.signal });
            return node;
          };
          const viewRow = controlRow(panel.rendering, localizer.text("viewer.modelView3d")).field;
          button(viewRow, localizer.text("viewer.reset"), localizer.text("viewer.resetCamera"), () => camera.reset());
          button(viewRow, "\u2212", localizer.text("viewer.zoomOut"), () => camera.zoom(1));
          button(viewRow, "+", localizer.text("viewer.zoomIn"), () => camera.zoom(-1));
          if (scene.joints.length > 0) {
            const toggle = button(viewRow, localizer.text("viewer.modelBones"), localizer.text("viewer.modelSkeletonOverlay"), () => {
              skeletonVisible = !skeletonVisible;
              toggle.setAttribute("aria-pressed", String(skeletonVisible));
              canvas.setAttribute("data-model-skeleton-visible", String(skeletonVisible));
              redraw();
            });
            toggle.setAttribute("aria-pressed", String(skeletonVisible));
            canvas.setAttribute("data-model-skeleton-visible", String(skeletonVisible));
          }
          const overlayToggle = (label, title, flip) => {
            const toggle = button(viewRow, localizer.text(label), localizer.text(title), () => {
              toggle.setAttribute("aria-pressed", String(flip()));
              redraw();
            });
            toggle.setAttribute("aria-pressed", "false");
          };
          overlayToggle("viewer.modelWireframe", "viewer.modelWireframeOverlay", () => {
            wireframeVisible = !wireframeVisible;
            return wireframeVisible;
          });
          overlayToggle("viewer.modelNormals", "viewer.modelNormalsOverlay", () => {
            normalsVisible = !normalsVisible;
            return normalsVisible;
          });
          if (effectsOffered) {
            const effectsField = controlRow(panel.rendering, localizer.text("viewer.modelEffectsLabel")).field;
            const effectsLabel = element(effectsField, "label");
            const effectsBox = element(effectsLabel, "input");
            effectsBox.type = "checkbox";
            effectsBox.checked = effectsOn;
            effectsLabel.append(" ", localizer.text("viewer.modelEffectsDraw"));
            effectStatus = element(effectsField, "output", { part: "model.readout" });
            effectsBox.addEventListener("change", () => {
              effectsOn = effectsBox.checked;
              if (!effectsOn)
                showEffects("off", "");
              generation++;
              redraw();
              animateEffects();
            }, { signal: scope.signal });
          }
          if (materialRefs.length > 0) {
            const swatchRow = controlRow(panel.teamColor, localizer.text("viewer.modelTeamColorCustom"));
            const picker = element(swatchRow.field, "input", {
              part: "model.team-color"
            });
            picker.type = "color";
            picker.value = "#d9140f";
            picker.setAttribute("aria-label", localizer.text("viewer.modelTeamColorCustom"));
            const applyTeamColor = (hex) => {
              const value = /^#([0-9a-f]{6})$/iu.exec(hex)?.[1];
              if (value === void 0)
                return;
              teamColor = Object.freeze([
                Number.parseInt(value.slice(0, 2), 16) / 255,
                Number.parseInt(value.slice(2, 4), 16) / 255,
                Number.parseInt(value.slice(4, 6), 16) / 255
              ]);
              canvas.setAttribute("data-model-team-color", `#${value.toLowerCase()}`);
              generation++;
              redraw();
            };
            picker.addEventListener("input", () => applyTeamColor(picker.value), {
              signal: scope.signal
            });
            const presets = controlRow(panel.teamColor, localizer.text("viewer.modelTeamColorPresets")).field;
            presets.setAttribute("role", "group");
            for (const preset of MODEL_TEAM_COLOR_PRESETS) {
              const swatch = button(presets, "", preset, () => {
                picker.value = preset;
                applyTeamColor(preset);
              });
              swatch.style.setProperty("background", preset);
              swatch.setAttribute("aria-label", preset);
            }
            canvas.setAttribute("data-model-team-color", "#d9140f");
          }
          const [detailed] = lodLevels;
          if (detailed !== void 0 && lodLevels.length > 1) {
            const field = controlRow(panel.rendering, localizer.text("viewer.modelLod")).field;
            const selector = element(field, "select");
            selector.setAttribute("aria-label", localizer.text("viewer.modelLod"));
            const all = element(selector, "option", {
              text: localizer.text("viewer.modelLodAll")
            });
            all.value = "";
            for (const level of lodLevels) {
              const option = element(selector, "option", {
                text: localizer.text("viewer.modelLodLevel", { order: level.order })
              });
              option.value = level.id;
            }
            selector.value = detailed.id;
            canvas.setAttribute("data-model-lod", selector.value);
            selector.addEventListener("change", () => {
              showLod(lodLevels.find((level) => level.id === selector.value));
              canvas.setAttribute("data-model-lod", selector.value);
              syncPrimitiveBoxes();
              generation++;
              redraw();
            }, { signal: scope.signal });
          }
          if (model.primitiveIds.length > 1) {
            const field = controlRow(panel.rendering, localizer.text("viewer.modelPrimitive")).field;
            const boxes = primitiveBoxes;
            const apply = () => {
              syncPrimitiveBoxes();
              generation++;
              redraw();
            };
            const bulk = element(field, "div", { part: "model.toolbar" });
            button(bulk, localizer.text("viewer.modelAllPrimitives"), "", () => {
              hiddenPrimitives.clear();
              apply();
            });
            button(bulk, localizer.text("viewer.modelNoPrimitives"), "", () => {
              for (const id of model.primitiveIds)
                hiddenPrimitives.add(id);
              apply();
            });
            const list2 = element(field, "div", { part: "model.primitive-selector" });
            list2.setAttribute("role", "group");
            list2.setAttribute("aria-label", localizer.text("viewer.modelPrimitive"));
            for (const id of model.primitiveIds) {
              const line = element(list2, "label");
              const box = element(line, "input");
              box.type = "checkbox";
              box.checked = !hiddenPrimitives.has(id);
              line.append(" ", id);
              boxes.set(id, box);
              box.addEventListener("change", () => {
                if (box.checked)
                  hiddenPrimitives.delete(id);
                else
                  hiddenPrimitives.add(id);
                generation++;
                redraw();
              }, { signal: scope.signal });
            }
          }
          const snapshotRow = controlRow(panel.export, localizer.text("viewer.modelSnapshot"));
          const snapshot = element(snapshotRow.field, "button", {
            part: "operations.button",
            text: localizer.text("viewer.modelSnapshotSave")
          });
          snapshot.type = "button";
          const snapshotStatus = element(snapshotRow.field, "output", {
            part: "model.convert-status"
          });
          const writeSnapshot = options.exportBytes;
          if (writeSnapshot === void 0) {
            snapshot.disabled = true;
            snapshotStatus.textContent = localizer.text("viewer.modelConvertUnavailable");
          } else
            snapshot.addEventListener("click", () => void (async () => {
              try {
                const base = options.exportBaseName?.(args.descriptor) ?? "model";
                const outcome = await writeSnapshot([
                  {
                    name: `${base}.png`,
                    mediaType: "image/png",
                    bytes: await canvasPng(canvas)
                  }
                ], scope.signal);
                snapshotStatus.textContent = outcome.state === "written" ? localizer.text("viewer.modelSnapshotSaved") : outcome.reason ?? outcome.state;
              } catch (error) {
                snapshotStatus.textContent = error instanceof Error ? error.message : String(error);
              }
            })(), { signal: scope.signal });
          const conversions = modelConversions(args.descriptor);
          if (conversions.length > 0) {
            const exportRow = controlRow(panel.export, localizer.text("viewer.modelConvert"));
            const convert = element(exportRow.field, "select", {
              part: "model.convert-selector"
            });
            convert.setAttribute("aria-label", localizer.text("viewer.modelConvert"));
            const prompt = element(convert, "option", {
              text: localizer.text("viewer.modelConvert")
            });
            prompt.value = "";
            for (const preset of conversions) {
              const option = element(convert, "option", { text: preset.form.label });
              option.value = preset.form.id;
            }
            const convertStatus = element(exportRow.field, "output", {
              part: "model.convert-status"
            });
            const writeFiles = options.exportBytes;
            if (writeFiles === void 0) {
              convert.disabled = true;
              convertStatus.textContent = localizer.text("viewer.modelConvertUnavailable");
            } else
              convert.addEventListener("change", () => {
                const preset = conversions.find((item) => item.form.id === convert.value);
                convert.value = "";
                if (preset === void 0)
                  return;
                convertStatus.textContent = localizer.text("viewer.modelConverting", {
                  preset: preset.form.label
                });
                void (async () => {
                  try {
                    const result = await args.operations.invoke(preset.form.handlerId, preset.input, { signal: scope.signal });
                    if (result.state !== "ok")
                      throw new Error(result.reason);
                    const output = result.output;
                    if (output.kind !== "bytes" || !(output.value instanceof Uint8Array))
                      throw new Error(`the codec answered ${output.kind}, not bytes`);
                    const base = options.exportBaseName?.(args.descriptor) ?? "model";
                    const writes = preset.form.writes;
                    if (writes === void 0)
                      throw new Error(`${preset.form.id} declares no write target`);
                    const outcome = await writeFiles([
                      {
                        name: convertedFileName(base, preset.form.id, writes.extension),
                        mediaType: writes.mediaType,
                        bytes: output.value
                      }
                    ], scope.signal);
                    convertStatus.textContent = outcome.state === "written" ? localizer.text("viewer.modelConverted", { preset: preset.form.label }) : outcome.reason ?? outcome.state;
                  } catch (error) {
                    convertStatus.textContent = error instanceof Error ? error.message : String(error);
                  }
                })();
              }, { signal: scope.signal });
          }
          if (clips.length > 0) {
            const sequenceField = controlRow(panel.animation, localizer.text("viewer.modelAnimation")).field;
            const selector = element(sequenceField, "select", {
              part: "model.animation-selector"
            });
            const renameClip = mountClipRename(controlRow(panel.editing, localizer.text("viewer.modelAnimationRename")).field, {
              localizer,
              descriptor: args.descriptor,
              operations: args.operations,
              ...args.commit === void 0 ? {} : { commit: args.commit },
              ...args.authorization === void 0 ? {} : { authorization: args.authorization },
              selector,
              clips,
              signal: scope.signal
            });
            if (renameClip !== void 0)
              scope.cleanup(renameClip);
            selector.setAttribute("aria-label", localizer.text("viewer.modelAnimation"));
            const rest = element(selector, "option", {
              text: localizer.text("viewer.modelRestPose")
            });
            rest.value = "";
            for (const clip of clips) {
              const option = element(selector, "option", { text: clip.name });
              option.value = clip.id;
            }
            const playbackField = controlRow(panel.animation, localizer.text("viewer.modelPlayback")).field;
            const seekField = controlRow(panel.animation, localizer.text("viewer.modelAnimationTime")).field;
            const seek = element(seekField, "input", {
              part: "model.animation-seek"
            });
            const clock = element(seekField, "output", { part: "model.readout" });
            const pace = controlRow(panel.animation, localizer.text("viewer.modelSpeed")).field;
            const speedSelect = element(pace, "select");
            speedSelect.setAttribute("aria-label", localizer.text("viewer.modelSpeed"));
            for (const value of MODEL_ANIMATION_SPEEDS) {
              const option = element(speedSelect, "option", {
                text: `${value}\xD7`
              });
              option.value = String(value);
            }
            speedSelect.value = "1";
            const loopLabel = element(pace, "label");
            const loop = element(loopLabel, "input");
            loop.type = "checkbox";
            loopLabel.append(" ", localizer.text("viewer.modelLoop"));
            let speed = 1;
            seek.type = "range";
            seek.min = "0";
            seek.max = "0";
            seek.step = "0.001";
            seek.value = "0";
            seek.disabled = true;
            seek.setAttribute("aria-label", localizer.text("viewer.modelAnimationTime"));
            let frameId = 0;
            let playing = false;
            let duration = 0;
            let startedAt = 0;
            const showClock = () => setViewerText(clock, localizer.text("viewer.modelClock", {
              time: timeSeconds.toFixed(2),
              duration: duration.toFixed(2)
            }));
            const toggle = button(playbackField, "\u25B6", localizer.text("viewer.playPause"), () => {
              if (duration <= 0)
                return;
              playing = !playing;
              if (playing) {
                if (timeSeconds >= duration)
                  timeSeconds = 0;
                startedAt = performance.now() - timeSeconds / speed * 1e3;
                frameId = requestAnimationFrame(tick);
              } else
                cancelAnimationFrame(frameId);
              toggle.setAttribute("aria-pressed", String(playing));
            });
            speedSelect.addEventListener("change", () => {
              speed = Number(speedSelect.value) || 1;
              if (playing)
                startedAt = performance.now() - timeSeconds / speed * 1e3;
            }, { signal: scope.signal });
            toggle.setAttribute("aria-pressed", "false");
            const stop = () => {
              playing = false;
              cancelAnimationFrame(frameId);
              toggle.setAttribute("aria-pressed", "false");
            };
            const tick = (now) => {
              if (!playing || scope.signal.aborted)
                return;
              timeSeconds = Math.min(duration, (now - startedAt) / 1e3 * speed);
              if (timeSeconds >= duration && loop.checked) {
                startedAt = now;
                timeSeconds = 0;
              }
              seek.value = String(timeSeconds);
              showClock();
              redraw();
              if (timeSeconds < duration)
                frameId = requestAnimationFrame(tick);
              else
                stop();
            };
            selector.addEventListener("change", () => {
              stop();
              try {
                const clip = clips.find((item) => item.id === selector.value);
                const nextPlayer = createModelSceneSampler(projection, {
                  signal: scope.signal,
                  billboardCameraPerSample: true,
                  ...clip === void 0 ? {} : { clip }
                });
                player = nextPlayer;
                activeClip = clip;
                duration = modelAnimationPlaybackDuration(clip);
                timeSeconds = 0;
                generation++;
                seek.max = String(duration);
                seek.value = "0";
                seek.disabled = duration <= 0;
                showClock();
                canvas.setAttribute("data-model-animation", clip?.id ?? "");
                animateEffects();
                showDiagnostics();
                redraw();
              } catch (error) {
                setViewerText(playbackStatus, error instanceof Error ? error.message : String(error));
              }
            }, { signal: scope.signal });
            seek.addEventListener("input", () => {
              stop();
              generation++;
              timeSeconds = Number(seek.value);
              showClock();
              redraw();
            }, { signal: scope.signal });
            scope.cleanup(stop);
          }
          scope.cleanup(() => gizmo.destroy());
          const resizeObserver = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(() => {
            if (measureViewport())
              redraw();
          });
          resizeObserver?.observe(canvas);
          scope.cleanup(() => resizeObserver?.disconnect());
          redraw();
        }
        for (const section of Object.values(panel)) {
          if (section.body.childElementCount === 0)
            section.root.remove();
        }
        if (toolbar.childElementCount === 0)
          toolbar.remove();
        setState(stage, []);
      } catch (error) {
        setState(stage, ["error"]);
        canvas.remove();
        element(stage, "p", {
          part: "viewer.empty",
          text: localizer.text("viewer.modelError", {
            reason: error instanceof Error ? error.message : String(error)
          })
        });
      }
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset["revision"] = descriptor.revision;
      });
    }
  });
}
var modelViewer = createModelViewer();

export {
  modelMaterialTeamColor,
  MODEL_MAXIMUM_PRIMITIVE_BYTES,
  MODEL_MAXIMUM_PRIMITIVES,
  loadModelStage,
  MODEL_FIELD_OF_VIEW,
  MODEL_DEFAULT_BASE_COLOR,
  MODEL_KEY_LIGHT,
  framePrimitive,
  framePrimitives,
  modelCamera,
  multiply4x4,
  projectPoint,
  materialColorFor,
  baseColorResourceOf,
  sceneMaterials,
  modelSceneRequest,
  skeletonJoints,
  mountFieldEditTarget,
  fieldWriteRefusal,
  commitOperationWrite,
  mountInlineField,
  GIZMO_SIZE,
  createViewGizmo,
  modelAnimationPlaybackDuration,
  MODEL_RENDERER_BACKENDS,
  MODEL_WIREFRAME_BACKEND,
  modelConversions,
  modelRendererBackend,
  MODEL_FACET_CONTRACTS,
  readModelFacets,
  readModelFacetPages,
  describeModelFacetPages,
  readModelFacetDetails,
  resolveModelViewerTextures,
  clipNamePath,
  canRenameClips,
  createModelViewer,
  modelViewer
};
