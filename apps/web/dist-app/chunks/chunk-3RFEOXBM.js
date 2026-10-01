import {
  array as array2,
  field,
  object as object2,
  safeIndex
} from "./chunk-I4Z5J3HX.js";
import {
  BufferBuilder,
  addAccessor
} from "./chunk-QONSPCLP.js";
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  checkUvmContainerBudget,
  writeUvmContainer
} from "./chunk-OAFBQXD6.js";
import {
  uvmAccessorWidth,
  validateUvmDocument
} from "./chunk-VWR4X3UB.js";
import {
  array,
  isStandardLayerSlot,
  object
} from "./chunk-I43233HX.js";
import {
  decomposeMatrix4,
  normalizeQuat,
  quaternionFromRotationMatrix
} from "./chunk-MUN4JEOH.js";
import {
  snapshotJson
} from "./chunk-ZSDVUSRM.js";
import {
  sampleTrackValue
} from "./chunk-5SBJANAJ.js";

// ../MODDING/modkit-core/packages/scene/dist/materials/environment.js
function vector(value, length, name) {
  if (!Array.isArray(value) || value.length !== length)
    throw new TypeError(`${name} requires ${length} finite float32 components`);
  const captured = [];
  for (let index = 0; index < length; index++) {
    const item = value[index];
    if (typeof item !== "number" || !Number.isFinite(item) || !Number.isFinite(Math.fround(item)))
      throw new TypeError(`${name} requires ${length} finite float32 components`);
    captured.push(Math.fround(item));
  }
  return Object.freeze(captured);
}
function snapshotEnvironment(value) {
  if (value === void 0)
    return void 0;
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => key !== "worldToEnvironment"))
    throw new TypeError("invalid environment frame");
  const worldToEnvironment = vector(Reflect.get(value, "worldToEnvironment"), 16, "worldToEnvironment");
  if ([3, 7, 11].some((index) => worldToEnvironment[index] !== 0) || worldToEnvironment[15] !== 1)
    throw new TypeError("worldToEnvironment must be affine");
  const envelope = Math.max(...[0, 1, 2].map((row) => [0, 4, 8, 12].reduce((sum, column) => sum + Math.abs(worldToEnvironment[row + column] ?? 0), 0)));
  if (envelope + 6 * envelope ** 3 > 34028234663852886e22 / 2)
    throw new TypeError("worldToEnvironment exceeds safe float32 reflection arithmetic");
  return Object.freeze({ worldToEnvironment });
}
function snapshotEyePosition(value) {
  return value === void 0 ? void 0 : vector(value, 3, "eyePosition");
}
var SCENE_ENVIRONMENT_RESOURCE = "modkit:scene-environment";
var SKY_SIZE = 16;
var ZENITH = [168, 180, 196];
var HORIZON = [216, 216, 212];
var NADIR = [92, 88, 84];
var DEFAULT_SCENE_ENVIRONMENT = Object.freeze({
  id: SCENE_ENVIRONMENT_RESOURCE,
  dimension: "cube",
  width: SKY_SIZE,
  height: SKY_SIZE,
  rgba: (() => {
    const rgba = new Uint8Array(SKY_SIZE * SKY_SIZE * 4 * 6);
    for (let face = 0; face < 6; face++)
      for (let row = 0; row < SKY_SIZE; row++)
        for (let column = 0; column < SKY_SIZE; column++) {
          const x = (column + 0.5) / SKY_SIZE * 2 - 1, y = (row + 0.5) / SKY_SIZE * 2 - 1;
          const up = (face === 2 ? 1 : face === 3 ? -1 : -y) / Math.hypot(1, x, y);
          const [toward, amount] = up >= 0 ? [ZENITH, up] : [NADIR, Math.min(1, -up * 1.5)];
          const at = ((face * SKY_SIZE + row) * SKY_SIZE + column) * 4;
          for (let channel = 0; channel < 3; channel++)
            rgba[at + channel] = Math.round(HORIZON[channel] + (toward[channel] - HORIZON[channel]) * amount);
          rgba[at + 3] = 255;
        }
    return rgba;
  })()
});
var isEnvironmentBinding = (binding) => binding.dimension === "cube" && (binding.slot === "envi" || binding.slot === "enviMask");

// ../MODDING/modkit-core/packages/scene/dist/materials/frame.js
function materialFrame(value) {
  if (!Array.isArray(value) || value.length !== 16 || value[3] !== 0 || value[7] !== 0 || value[11] !== 0 || value[15] !== 1)
    throw new TypeError(MATERIAL_FRAME_CONTRACT);
  const result = new Array(16);
  for (let index = 0; index < 16; index++) {
    const component = value[index];
    if (typeof component !== "number" || !Number.isFinite(component) || !Number.isFinite(Math.fround(component)))
      throw new TypeError(MATERIAL_FRAME_CONTRACT);
    result[index] = component;
  }
  invertMaterialFrame(result);
  return Object.freeze(result);
}
var MATERIAL_FRAME_CONTRACT = "material worldToMaterial must be a finite affine float32 matrix";
var inverseRows = new Float64Array(32);
function invertMaterialFrame(matrix2) {
  const rows = inverseRows;
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 8; column++)
      rows[row * 8 + column] = column < 4 ? matrix2[column * 4 + row] ?? 0 : Number(column - 4 === row);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++)
      if (Math.abs(rows[row * 8 + column]) > Math.abs(rows[pivot * 8 + column]))
        pivot = row;
    if (rows[pivot * 8 + column] === 0)
      throw new TypeError("material frame must be invertible");
    const selected = column * 8;
    if (pivot !== column)
      for (let j = 0; j < 8; j++) {
        const value = rows[selected + j];
        rows[selected + j] = rows[pivot * 8 + j];
        rows[pivot * 8 + j] = value;
      }
    const divisor = rows[selected + column];
    for (let j = 0; j < 8; j++)
      rows[selected + j] = rows[selected + j] / divisor;
    for (let row = 0; row < 4; row++) {
      if (row === column)
        continue;
      const target = row * 8, factor = rows[target + column];
      for (let j = 0; j < 8; j++)
        rows[target + j] = rows[target + j] - factor * rows[selected + j];
    }
  }
  const result = new Array(16);
  for (let index = 0; index < 16; index++) {
    const value = rows[index % 4 * 8 + 4 + Math.floor(index / 4)];
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
      throw new TypeError("material frame inverse exceeds float32");
    result[index] = value;
  }
  return Object.freeze(result);
}
function multiplyMaterialFrames(left, right) {
  const output = new Array(16);
  for (let index = 0; index < 16; index++) {
    const row = index % 4, column = Math.floor(index / 4);
    let value = 0;
    for (let j = 0; j < 4; j++)
      value += (left[j * 4 + row] ?? 0) * (right[column * 4 + j] ?? 0);
    output[index] = value;
  }
  return materialFrame(output);
}
var IDENTITY_MATERIAL_FRAME = Object.freeze([
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1
]);

// ../MODDING/modkit-core/packages/scene/dist/materials/render-model.js
var RENDER_MATERIAL_SHADER = "modkit.render-material.v1";
var MATERIAL_LAYERS_SHADER = "modkit.material-layers.v1";
function activeLayers(material) {
  return Object.values(material.layers).filter((layer) => layer.slot !== "normalBlend2Mask" || material.normalBlendPolicy?.secondMask !== false);
}
var PRESENTATIONS = ["surface", "screen-distortion", "terrain-projection"];
var record = (value, path) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${path} must be an object`);
  return value;
};
var finite = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new TypeError(`${path} must be a finite float32 number`);
  return value;
};
var integer = (value, path, min, max) => {
  const result = finite(value, path);
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new TypeError(`${path} must be an integer in ${min}..${max}`);
  return result;
};
var vector2 = (value, path, size) => {
  if (!Array.isArray(value) || value.length !== size)
    throw new TypeError(`${path} must contain ${size} components`);
  for (const component of value)
    finite(component, path);
};
var flags = (value, path, names, optional = false) => {
  for (const key of names)
    if ((!optional || value[key] !== void 0) && typeof value[key] !== "boolean")
      throw new TypeError(`${path}.${key} must be boolean`);
};
function validateTrack(value, path, size, signal) {
  const track = record(value, path);
  integer(track["lineType"], `${path}.lineType`, 0, 1);
  if (track["globalSeqId"] !== null)
    throw new TypeError(`${path}.globalSeqId requires an explicit global sequence timeline`);
  const keys = track["keys"];
  if (!Array.isArray(keys) || keys.length === 0)
    throw new TypeError(`${path}.keys must be nonempty`);
  let previous = -Infinity;
  for (const [index, item] of keys.entries()) {
    signal?.throwIfAborted();
    const keyPath = `${path}.keys[${index}]`, key = record(item, keyPath);
    const frame = finite(key["frame"], `${keyPath}.frame`);
    if (frame < previous)
      throw new TypeError(`${path} keys must be ordered by frame`);
    previous = frame;
    vector2(key["vector"], `${keyPath}.vector`, size);
    for (const tangent of ["inTan", "outTan"])
      if (key[tangent] !== void 0)
        vector2(key[tangent], `${keyPath}.${tangent}`, size);
  }
}
function animated(value, path, size, signal) {
  const property = record(value, path);
  if (size === 1)
    finite(property["value"], `${path}.value`);
  else
    vector2(property["value"], `${path}.value`, size);
  if (property["track"] !== void 0)
    validateTrack(property["track"], `${path}.track`, size, signal);
  const sequences = property["sequenceTracks"];
  if (sequences === void 0)
    return;
  if (!Array.isArray(sequences))
    throw new TypeError(`${path}.sequenceTracks must be an array`);
  const seen = /* @__PURE__ */ new Set();
  for (const [index, entry] of sequences.entries()) {
    const trackPath = `${path}.sequenceTracks[${index}]`, track = record(entry, trackPath);
    const sequence = integer(track["sequenceIndex"], `${trackPath}.sequenceIndex`, 0, 4294967295);
    if (seen.has(sequence))
      throw new TypeError(`${path} has duplicate sequence ${sequence}`);
    seen.add(sequence);
    flags(track, trackPath, ["concurrent"], true);
    if (track["wrapSeconds"] !== void 0 || track["concurrent"] === true) {
      if (finite(track["wrapSeconds"], `${trackPath}.wrapSeconds`) <= 0)
        throw new TypeError(`${trackPath}.wrapSeconds must be positive`);
    }
    validateTrack(track["track"], `${trackPath}.track`, size, signal);
  }
}
var LAYER_ANIMATIONS = [
  ["constantColor", 4],
  ["colorMultiply", 1],
  ["colorAdd", 1],
  ["alphaFactor", 1],
  ["uvOffset", 2],
  ["uvAngle", 3],
  ["uvTiling", 2],
  ["uvTriplanarOffset", 3],
  ["uvTriplanarScale", 3]
];
function validateLayer(value, slot, path, signal) {
  const layer = record(value, path);
  if (layer["slot"] !== slot)
    throw new TypeError(`${path}.slot does not match its layer key`);
  if (layer["texturePath"] !== null && (typeof layer["texturePath"] !== "string" || layer["texturePath"].trim() === ""))
    throw new TypeError(`${path}.texturePath must be a nonempty logical id or null`);
  if (layer["sceneEnvironment"] !== void 0) {
    if (layer["sceneEnvironment"] !== true || slot !== "envi" || layer["texturePath"] !== null || layer["constantColor"] !== void 0)
      throw new TypeError(`${path}.sceneEnvironment is true only on an envi layer without a texture or constant color`);
  } else if (layer["texturePath"] === null && layer["constantColor"] === void 0)
    throw new TypeError(`${path} has no texture or constant color`);
  integer(layer["uvSource"], `${path}.uvSource`, 0, 18);
  integer(layer["channels"], `${path}.channels`, 0, 5);
  integer(layer["op"], `${path}.op`, 0, 6);
  integer(layer["teamColorMode"], `${path}.teamColorMode`, 0, 2);
  flags(layer, path, ["invert", "clampResult", "wrapX", "wrapY"]);
  for (const [key, size] of LAYER_ANIMATIONS)
    if (layer[key] !== void 0)
      animated(layer[key], `${path}.${key}`, size, signal);
  if (layer["flipbook"] !== void 0) {
    const flip = record(layer["flipbook"], `${path}.flipbook`);
    integer(flip["rows"], `${path}.flipbook.rows`, 1, 65535);
    integer(flip["cols"], `${path}.flipbook.cols`, 1, 65535);
    if (flip["frameSize"] !== void 0) {
      vector2(flip["frameSize"], `${path}.flipbook.frameSize`, 2);
      if (flip["frameSize"].some((component) => component <= 0))
        throw new TypeError(`${path}.flipbook.frameSize must be positive`);
    }
    animated(flip["frame"], `${path}.flipbook.frame`, 1, signal);
  }
  if (layer["fresnel"] !== void 0) {
    const fresnel = record(layer["fresnel"], `${path}.fresnel`);
    integer(fresnel["mode"], `${path}.fresnel.mode`, 1, 2);
    integer(fresnel["transformMode"], `${path}.fresnel.transformMode`, 0, 2);
    for (const key of ["exponent", "min", "maxOffset"])
      finite(fresnel[key], `${path}.fresnel.${key}`);
    flags(fresnel, `${path}.fresnel`, ["localTransform", "doNotMirror"]);
    for (const key of ["translation", "invertMask"])
      vector2(fresnel[key], `${path}.fresnel.${key}`, 3);
    vector2(fresnel["rotation"], `${path}.fresnel.rotation`, 2);
  }
}
function validateStandard(value, path, signal) {
  const material = record(value, path);
  if (material["tangentGeneration"] !== void 0) {
    const generation = record(material["tangentGeneration"], `${path}.tangentGeneration`);
    if (Object.keys(generation).some((key) => key !== "texCoord"))
      throw new TypeError(`${path}.tangentGeneration has unsupported properties`);
    integer(generation["texCoord"], `${path}.tangentGeneration.texCoord`, 0, 4);
  }
  integer(material["blendMode"], `${path}.blendMode`, 0, 6);
  integer(material["specMode"], `${path}.specMode`, 0, 1);
  for (const key of ["priority", "specularity", "specMult", "emisMult"])
    finite(material[key], `${path}.${key}`);
  const threshold = finite(material["alphaTestThreshold"], `${path}.alphaTestThreshold`);
  if (threshold < 0 || threshold > 1)
    throw new TypeError(`${path}.alphaTestThreshold must be in 0..1`);
  flags(material, path, [
    "twoSided",
    "unshaded",
    "doubleLambert",
    "clampOutput",
    "usesVertexColor",
    "usesVertexAlpha"
  ]);
  flags(material, path, ["depthPrepass", "specularEnergyConservation"], true);
  for (const key of ["sourceFlags", "sourceAdditionalFlags", "materialClass"])
    if (material[key] !== void 0)
      integer(material[key], `${path}.${key}`, 0, 4294967295);
  for (const key of ["environmentMultipliers", "emissiveTint"])
    if (material[key] !== void 0)
      vector2(material[key], `${path}.${key}`, 3);
  if (material["parallaxHeight"] !== void 0)
    animated(material["parallaxHeight"], `${path}.parallaxHeight`, 1, signal);
  const factors = material["normalBlendFactors"];
  if (factors !== void 0) {
    if (!Array.isArray(factors) || factors.length !== 8)
      throw new TypeError(`${path}.normalBlendFactors must have 8 entries`);
    for (const [index, factor] of factors.entries())
      animated(factor, `${path}.normalBlendFactors[${index}]`, 1, signal);
  }
  if (material["normalMapFormat"] !== void 0 && (typeof material["normalMapFormat"] !== "string" || !["dxt5nm", "bc5", "rgb8", "luminance-alpha"].includes(material["normalMapFormat"])))
    throw new TypeError(`${path}.normalMapFormat is unsupported`);
  if (material["normalMapSpace"] !== void 0 && material["normalMapSpace"] !== "tangent" && material["normalMapSpace"] !== "object")
    throw new TypeError(`${path}.normalMapSpace is unsupported`);
  if (material["normalMapTransform"] !== void 0)
    vector2(material["normalMapTransform"], `${path}.normalMapTransform`, 9);
  const lightingModel = material["lightingModel"] ?? "m3";
  if (lightingModel !== "m3" && lightingModel !== "pbr-metallic-roughness")
    throw new TypeError(`${path}.lightingModel is unsupported`);
  for (const key of ["metallicFactor", "roughnessFactor"])
    if (material[key] !== void 0) {
      const factor = finite(material[key], `${path}.${key}`);
      if (factor < 0 || factor > 1)
        throw new TypeError(`${path}.${key} must be in 0..1`);
    }
  const colorPipeline = material["colorPipeline"] ?? "m3";
  if (colorPipeline !== "m3" && colorPipeline !== "linear-srgb")
    throw new TypeError(`${path}.colorPipeline is unsupported`);
  if (colorPipeline === "linear-srgb" && lightingModel !== "pbr-metallic-roughness")
    throw new TypeError(`${path}.colorPipeline linear-srgb requires the pbr lighting model`);
  if (material["tonemap"] !== void 0) {
    vector2(material["tonemap"], `${path}.tonemap`, 5);
    const curve = material["tonemap"];
    if (curve.some((term) => term < 0) || !(curve[4] > 0))
      throw new TypeError(`${path}.tonemap needs nonnegative terms and e > 0`);
    if (colorPipeline !== "linear-srgb")
      throw new TypeError(`${path}.tonemap requires the linear-srgb color pipeline`);
  }
  if (material["normalMapSpace"] !== "object" && material["normalMapTransform"] !== void 0)
    throw new TypeError(`${path}.normalMapTransform requires object-space normals`);
  const layers = record(material["layers"], `${path}.layers`);
  if (material["normalMapSpace"] === "object" && (layers["normal"] === void 0 || ["normalBlend1", "normalBlend2", "normalBlend1Mask", "normalBlend2Mask"].some((slot) => layers[slot] !== void 0)))
    throw new TypeError(`${path}.normalMapSpace object requires one primary normal layer`);
  if (material["normalBlendPolicy"] !== void 0) {
    const policy = record(material["normalBlendPolicy"], `${path}.normalBlendPolicy`);
    if (policy["mode"] !== "signed-two-detail" || typeof policy["secondMask"] !== "boolean" || Object.keys(policy).some((key) => key !== "mode" && key !== "secondMask"))
      throw new TypeError(`${path}.normalBlendPolicy is unsupported`);
    if (layers["normalBlend1"] === void 0 || layers["normalBlend2"] === void 0)
      throw new TypeError(`${path}.normalBlendPolicy requires both detail layers`);
  }
  for (const [slot, layer] of Object.entries(layers)) {
    if (!isStandardLayerSlot(slot))
      throw new TypeError(`${path} has unknown layer ${slot}`);
    validateLayer(layer, slot, `${path}.layers.${slot}`, signal);
  }
}
function createRenderMaterialSampler(parameters, budget, signal) {
  const params = record(snapshotJson(parameters, budget, signal), "material params");
  const model = record(params["renderModel"], "material params.renderModel");
  if (model["version"] !== 1)
    throw new TypeError("unsupported render material version");
  const presentation = model["presentation"] ?? "surface";
  if (typeof presentation !== "string" || !PRESENTATIONS.includes(presentation))
    throw new TypeError("unsupported render material presentation");
  const colorless = presentation !== "surface";
  const worldToMaterial = model["worldToMaterial"] === void 0 ? void 0 : materialFrame(model["worldToMaterial"]);
  let priority;
  let passes;
  if (model["composite"] !== void 0) {
    const composite = record(model["composite"], "composite material");
    priority = finite(composite["priority"], "composite material.priority");
    if (!Array.isArray(composite["passes"]) || composite["passes"].length === 0)
      throw new TypeError("composite material.passes must be nonempty");
    for (const [index, value] of composite["passes"].entries()) {
      const pass = record(value, `material pass ${index}`);
      validateStandard(pass["material"], `material pass ${index}`, signal);
      animated(pass["alphaFactor"], `material pass ${index}.alphaFactor`, 1, signal);
    }
    passes = composite["passes"].map((pass) => ({
      ...pass,
      material: withSceneEnvironment(pass.material)
    }));
    if (model["standard"] !== void 0)
      validateStandard(model["standard"], "standard material", signal);
  } else {
    validateStandard(model["standard"], "standard material", signal);
    passes = [
      {
        material: withSceneEnvironment(model["standard"]),
        alphaFactor: { value: 1 }
      }
    ];
  }
  const resources = Object.freeze(colorless ? [] : [
    ...new Set(passes.flatMap((pass) => activeLayers(pass.material).flatMap((layer) => layer.texturePath === null || layer.texturePath === SCENE_ENVIRONMENT_RESOURCE ? [] : [layer.texturePath])))
  ]);
  return Object.freeze({
    resources,
    usesSceneEnvironment: !colorless && passes.some((pass) => pass.material.layers.envi?.texturePath === SCENE_ENVIRONMENT_RESOURCE),
    presentation,
    ...worldToMaterial === void 0 ? {} : { worldToMaterial },
    usesWorldProjection: passes.some((pass) => (
      // Rebasing preserves authored coordinates even for a layer that may be enabled later.
      Object.values(pass.material.layers).some((layer) => layer.texturePath !== null && [5, 13, 14, 17, 18].includes(layer.uvSource))
    )),
    sample(time, sampleSignal) {
      if (!Number.isFinite(time.time) || time.time < 0)
        throw new TypeError("material time must be finite and nonnegative");
      if (time.sequenceTime !== void 0 && (!Number.isFinite(time.sequenceTime) || time.sequenceTime < 0))
        throw new TypeError("material sequenceTime must be finite and nonnegative");
      if (time.sequenceIndex !== void 0)
        integer(time.sequenceIndex, "material sequenceIndex", 0, 4294967295);
      sampleSignal?.throwIfAborted();
      if (colorless)
        return Object.freeze([]);
      return Object.freeze(passes.map((pass, index) => {
        sampleSignal?.throwIfAborted();
        return Object.freeze({
          material: sampleMaterial(pass.material, time, sampleSignal),
          // Render-model composites use their first pass as the base; its CMS opacity is ignored.
          alpha: index === 0 ? 1 : sampleAnimated(pass.alphaFactor, time).value,
          priority: priority ?? pass.material.priority
        });
      }));
    }
  });
}
function withSceneEnvironment(material) {
  const envi = material.layers.envi;
  if (envi?.sceneEnvironment !== true)
    return material;
  const { sceneEnvironment: _, ...layer } = envi;
  void _;
  return {
    ...material,
    layers: { ...material.layers, envi: { ...layer, texturePath: SCENE_ENVIRONMENT_RESOURCE } }
  };
}
function sampleAnimated(value, time) {
  const sequence = time.sequenceIndex === void 0 ? void 0 : value.sequenceTracks?.find((entry) => entry.sequenceIndex === time.sequenceIndex);
  const track = value.sequenceTracks === void 0 ? value.track : sequence?.track;
  let sampled = value.value;
  if (track !== void 0) {
    const components = sampleTrackValue(track, sequence?.concurrent === true ? time.time : time.sequenceTime ?? time.time, [], sequence?.concurrent === true ? { wrapSeconds: sequence.wrapSeconds } : {});
    if (components.length === 0)
      throw new TypeError("material sample produced no components");
    for (const component of components)
      finite(component, "material sample");
    sampled = typeof value.value === "number" ? components[0] : Object.freeze(components);
  }
  return Object.freeze({ value: sampled });
}
function sampleMaterial(material, time, signal) {
  const layers = {};
  for (const layer of activeLayers(material)) {
    const slot = layer.slot;
    signal?.throwIfAborted();
    if (!isStandardLayerSlot(slot))
      throw new TypeError(`unknown material slot ${slot}`);
    const sampled = { ...layer };
    for (const [key] of LAYER_ANIMATIONS) {
      const property = layer[key];
      if (property !== void 0)
        Object.assign(sampled, {
          [key]: sampleAnimated(property, time)
        });
    }
    if (layer.flipbook !== void 0)
      sampled.flipbook = Object.freeze({
        ...layer.flipbook,
        frame: sampleAnimated(layer.flipbook.frame, time)
      });
    layers[slot] = Object.freeze(sampled);
  }
  return Object.freeze({
    ...material,
    layers: Object.freeze(layers),
    ...material.parallaxHeight === void 0 ? {} : { parallaxHeight: sampleAnimated(material.parallaxHeight, time) },
    ...material.normalBlendFactors === void 0 ? {} : {
      normalBlendFactors: Object.freeze(material.normalBlendFactors.map((factor) => sampleAnimated(factor, time)))
    }
  });
}

// ../MODDING/modkit-core/packages/scene/dist/model/billboard-math.js
function invertQuat(rotation2) {
  const lengthSq = rotation2[0] * rotation2[0] + rotation2[1] * rotation2[1] + rotation2[2] * rotation2[2] + rotation2[3] * rotation2[3];
  if (lengthSq === 0)
    return [0, 0, 0, 1];
  return [
    -rotation2[0] / lengthSq,
    -rotation2[1] / lengthSq,
    -rotation2[2] / lengthSq,
    rotation2[3] / lengthSq
  ];
}
function multiplyQuat(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ]);
}
function invertMatrix4OrNull(matrix2) {
  const out = new Float32Array(16);
  const b00 = (matrix2[0] ?? 0) * (matrix2[5] ?? 0) - (matrix2[1] ?? 0) * (matrix2[4] ?? 0);
  const b01 = (matrix2[0] ?? 0) * (matrix2[6] ?? 0) - (matrix2[2] ?? 0) * (matrix2[4] ?? 0);
  const b02 = (matrix2[0] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[4] ?? 0);
  const b03 = (matrix2[1] ?? 0) * (matrix2[6] ?? 0) - (matrix2[2] ?? 0) * (matrix2[5] ?? 0);
  const b04 = (matrix2[1] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[5] ?? 0);
  const b05 = (matrix2[2] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[6] ?? 0);
  const b06 = (matrix2[8] ?? 0) * (matrix2[13] ?? 0) - (matrix2[9] ?? 0) * (matrix2[12] ?? 0);
  const b07 = (matrix2[8] ?? 0) * (matrix2[14] ?? 0) - (matrix2[10] ?? 0) * (matrix2[12] ?? 0);
  const b08 = (matrix2[8] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[12] ?? 0);
  const b09 = (matrix2[9] ?? 0) * (matrix2[14] ?? 0) - (matrix2[10] ?? 0) * (matrix2[13] ?? 0);
  const b10 = (matrix2[9] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[13] ?? 0);
  const b11 = (matrix2[10] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[14] ?? 0);
  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < 1e-12)
    return null;
  determinant = 1 / determinant;
  out[0] = ((matrix2[5] ?? 0) * b11 - (matrix2[6] ?? 0) * b10 + (matrix2[7] ?? 0) * b09) * determinant;
  out[1] = ((matrix2[2] ?? 0) * b10 - (matrix2[1] ?? 0) * b11 - (matrix2[3] ?? 0) * b09) * determinant;
  out[2] = ((matrix2[13] ?? 0) * b05 - (matrix2[14] ?? 0) * b04 + (matrix2[15] ?? 0) * b03) * determinant;
  out[3] = ((matrix2[10] ?? 0) * b04 - (matrix2[9] ?? 0) * b05 - (matrix2[11] ?? 0) * b03) * determinant;
  out[4] = ((matrix2[6] ?? 0) * b08 - (matrix2[4] ?? 0) * b11 - (matrix2[7] ?? 0) * b07) * determinant;
  out[5] = ((matrix2[0] ?? 0) * b11 - (matrix2[2] ?? 0) * b08 + (matrix2[3] ?? 0) * b07) * determinant;
  out[6] = ((matrix2[14] ?? 0) * b02 - (matrix2[12] ?? 0) * b05 - (matrix2[15] ?? 0) * b01) * determinant;
  out[7] = ((matrix2[8] ?? 0) * b05 - (matrix2[10] ?? 0) * b02 + (matrix2[11] ?? 0) * b01) * determinant;
  out[8] = ((matrix2[4] ?? 0) * b10 - (matrix2[5] ?? 0) * b08 + (matrix2[7] ?? 0) * b06) * determinant;
  out[9] = ((matrix2[1] ?? 0) * b08 - (matrix2[0] ?? 0) * b10 - (matrix2[3] ?? 0) * b06) * determinant;
  out[10] = ((matrix2[12] ?? 0) * b04 - (matrix2[13] ?? 0) * b02 + (matrix2[15] ?? 0) * b00) * determinant;
  out[11] = ((matrix2[9] ?? 0) * b02 - (matrix2[8] ?? 0) * b04 - (matrix2[11] ?? 0) * b00) * determinant;
  out[12] = ((matrix2[5] ?? 0) * b07 - (matrix2[4] ?? 0) * b09 - (matrix2[6] ?? 0) * b06) * determinant;
  out[13] = ((matrix2[0] ?? 0) * b09 - (matrix2[1] ?? 0) * b07 + (matrix2[2] ?? 0) * b06) * determinant;
  out[14] = ((matrix2[13] ?? 0) * b01 - (matrix2[12] ?? 0) * b03 - (matrix2[14] ?? 0) * b00) * determinant;
  out[15] = ((matrix2[8] ?? 0) * b03 - (matrix2[9] ?? 0) * b01 + (matrix2[10] ?? 0) * b00) * determinant;
  return out;
}
function rotationTranslationScaleOriginMatrix(rotation2, translation2, scaling, origin) {
  const x = rotation2[0];
  const y = rotation2[1];
  const z = rotation2[2];
  const w = rotation2[3];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const sx = scaling[0];
  const sy = scaling[1];
  const sz = scaling[2];
  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];
  const out = new Float32Array(16);
  out[0] = (1 - yy - zz) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - xx - zz) * sy;
  out[6] = (yz + wx) * sy;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - xx - yy) * sz;
  out[12] = translation2[0] + ox - (out[0] * ox + out[4] * oy + out[8] * oz);
  out[13] = translation2[1] + oy - (out[1] * ox + out[5] * oy + out[9] * oz);
  out[14] = translation2[2] + oz - (out[2] * ox + out[6] * oy + out[10] * oz);
  out[15] = 1;
  return out;
}
function multiplyMatrix4(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] = (a[0 * 4 + row] ?? 0) * (b[col * 4 + 0] ?? 0) + (a[1 * 4 + row] ?? 0) * (b[col * 4 + 1] ?? 0) + (a[2 * 4 + row] ?? 0) * (b[col * 4 + 2] ?? 0) + (a[3 * 4 + row] ?? 0) * (b[col * 4 + 3] ?? 0);
    }
  }
  return out;
}

// ../MODDING/modkit-core/packages/scene/dist/model/billboards.js
var AIM_LOCKS = ["free", "frame-x", "frame-y", "frame-z", "own-x", "own-y"];
function needed(value, label) {
  if (value === void 0)
    throw new TypeError("billboard " + label + " absent");
  return value;
}
function rotation(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item) && Number.isFinite(Math.fround(item))) || Math.hypot(...value) === 0)
    throw new TypeError("billboard quaternion must be finite and nonzero");
  return normalizeQuat(value);
}
function matrix(value) {
  if (value.length !== 16 || !value.every(Number.isFinite) || [3, 7, 11].some((index) => value[index] !== 0) || value[15] !== 1)
    throw new TypeError("billboard matrix must be finite affine");
  const result = Float32Array.from(value);
  if (!result.every(Number.isFinite))
    throw new RangeError("billboard matrix exceeds float32");
  return result;
}
function position(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === "number" && Number.isFinite(item)))
    throw new TypeError("billboard position must contain three finite numbers");
  return [value[0], value[1], value[2]];
}
function snapshotModelBillboards(values, maxBytes, signal) {
  const owned = snapshotJson(values, { maxBytes, maxDepth: 8, maxNodes: Math.floor(maxBytes / 16) }, signal);
  if (!Array.isArray(owned))
    throw new TypeError("billboard constraints must be an array");
  const seen = /* @__PURE__ */ new Set();
  for (const item of owned) {
    if (!item || typeof item.nodeId !== "string" || !item.nodeId || seen.has(item.nodeId))
      throw new TypeError("invalid or duplicate billboard constraint");
    if (item.mode === "inverse-camera") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "basisRotations"].includes(key)) || !Array.isArray(item.basisRotations) || item.basisRotations.length > 4)
        throw new TypeError("invalid inverse-camera billboard constraint");
      for (const basis of item.basisRotations)
        rotation(basis);
    } else if (item.mode === "face-camera") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "rotationAxes", "pivot"].includes(key)) || !["z", "xz"].includes(item.rotationAxes))
        throw new TypeError("invalid face-camera billboard constraint");
      position(item.pivot);
    } else if (item.mode === "aim") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "aim", "lock", "correction", "rootCorrection"].includes(key)) || item.aim !== "view" && item.aim !== "eye" || !AIM_LOCKS.includes(item.lock))
        throw new TypeError("invalid aim billboard constraint");
      if (item.correction !== void 0)
        rotation(item.correction);
      if (item.rootCorrection !== void 0)
        rotation(item.rootCorrection);
    } else
      throw new TypeError("invalid billboard mode");
    seen.add(item.nodeId);
  }
  return owned;
}
function translation(value) {
  return Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, value[0], value[1], value[2], 1);
}
function rotationX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return Float32Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1);
}
function rotationZ(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return Float32Array.of(c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
}
function applyModelFaceCameraBillboard(sourceWorld, constraint, cameraPosition) {
  const world = matrix(sourceWorld);
  const inverse = invertMatrix4OrNull(world);
  if (inverse === null)
    throw new TypeError("face-camera billboard world is singular");
  const camera = position(cameraPosition);
  const pivot = position(constraint.pivot);
  const x = (inverse[0] ?? 0) * camera[0] + (inverse[4] ?? 0) * camera[1] + (inverse[8] ?? 0) * camera[2] + (inverse[12] ?? 0) - pivot[0];
  let y = (inverse[1] ?? 0) * camera[0] + (inverse[5] ?? 0) * camera[1] + (inverse[9] ?? 0) * camera[2] + (inverse[13] ?? 0) - pivot[1];
  const z = (inverse[2] ?? 0) * camera[0] + (inverse[6] ?? 0) * camera[1] + (inverse[10] ?? 0) * camera[2] + (inverse[14] ?? 0) - pivot[2];
  let result = multiplyMatrix4(world, translation(pivot));
  if (constraint.rotationAxes === "xz") {
    const pitch = Math.atan2(z, y);
    result = multiplyMatrix4(result, rotationX(pitch));
    y = Math.hypot(y, z);
  }
  result = multiplyMatrix4(result, rotationZ(-Math.atan2(x, y)));
  result = multiplyMatrix4(result, translation([-pivot[0], -pivot[1], -pivot[2]]));
  if (!result.every(Number.isFinite))
    throw new RangeError("face-camera billboard exceeds float32");
  return result;
}
function billboardCameraRotation(view) {
  const inverse = invertMatrix4OrNull(matrix(view));
  if (inverse === null)
    throw new TypeError("billboard camera view is singular");
  return decomposeMatrix4(inverse).rotation;
}
function applyModelBillboards(pose, bindings, constraints, cameraRotation, hierarchyFrame, maxBytes, signal, cameraPosition) {
  signal?.throwIfAborted();
  const inverseConstraints = constraints.filter((item) => item.mode === "inverse-camera" || item.mode === "aim");
  if (cameraRotation === void 0 || inverseConstraints.length === 0)
    return pose;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || pose.length * 2048 + inverseConstraints.length * 256 > maxBytes)
    throw new RangeError("billboard pose exceeds byte budget");
  const byNode = new Map(inverseConstraints.map((item) => [item.nodeId, item])), source = /* @__PURE__ */ new Map(), bones = new Map(bindings.map((item) => [item.boneIndex, item]));
  for (const item of pose) {
    if (source.has(item.boneIndex))
      throw new TypeError("duplicate billboard pose bone");
    source.set(item.boneIndex, item);
  }
  if (!pose.some((item) => byNode.has(item.nodeId)))
    return pose;
  const cameraInFrame = multiplyQuat(invertQuat(decomposeMatrix4(matrix(hierarchyFrame)).rotation), rotation(cameraRotation));
  const frameInverse = invertMatrix4OrNull(matrix(hierarchyFrame));
  const eye = cameraPosition === void 0 || frameInverse === null ? void 0 : transformPoint(frameInverse, position(cameraPosition));
  const camera = {
    forward: rotateVector(cameraInFrame, [0, 0, -1]),
    up: rotateVector(cameraInFrame, [0, 1, 0]),
    axisX: rotateVector(cameraInFrame, [1, 0, 0]),
    ...eye === void 0 ? {} : { eye }
  };
  const adjusted = /* @__PURE__ */ new Map(), output = /* @__PURE__ */ new Map();
  for (const entry of pose) {
    const chain = [], visiting = /* @__PURE__ */ new Set();
    let cursor = entry.boneIndex;
    while (cursor !== null && !adjusted.has(cursor)) {
      if (visiting.has(cursor))
        throw new TypeError("cyclic billboard hierarchy");
      visiting.add(cursor);
      chain.push(cursor);
      const parent = needed(bones.get(cursor), "bone binding").parentBoneIndex;
      if (parent === void 0)
        throw new TypeError("billboard parent is unknown");
      cursor = parent;
    }
    for (const index of chain.reverse()) {
      signal?.throwIfAborted();
      const bone = needed(bones.get(index), "binding"), original = needed(source.get(index), "source pose"), parent = bone.parentBoneIndex;
      if (parent === void 0)
        throw new TypeError("billboard parent is unknown");
      const originalWorld = matrix(original.worldMatrix), originalParent = parent === null ? null : matrix(needed(source.get(parent), "parent pose").worldMatrix), inverseOriginalParent = originalParent === null ? null : invertMatrix4OrNull(originalParent);
      const local = originalParent !== null && inverseOriginalParent !== null ? multiplyMatrix4(inverseOriginalParent, originalWorld) : originalWorld;
      const adjustedParent = parent === null ? void 0 : needed(adjusted.get(parent), "adjusted parent");
      let world = adjustedParent === void 0 ? local : multiplyMatrix4(adjustedParent, local);
      const constraint = byNode.get(original.nodeId);
      if (constraint !== void 0) {
        const localTransform = decomposeMatrix4(local), parentInverse = adjustedParent === void 0 ? [0, 0, 0, 1] : invertQuat(decomposeMatrix4(adjustedParent).rotation);
        let facing;
        if (constraint.mode === "inverse-camera") {
          facing = multiplyQuat(parentInverse, cameraInFrame);
          for (const basis of constraint.basisRotations)
            facing = multiplyQuat(facing, rotation(basis));
          facing = multiplyQuat(facing, localTransform.rotation);
        } else {
          const aimed = aimRotation(constraint, camera, world, parent === null, localTransform.rotation);
          if (aimed !== void 0)
            facing = multiplyQuat(parentInverse, aimed);
        }
        if (facing !== void 0) {
          const billboardLocal = rotationTranslationScaleOriginMatrix(normalizeQuat(facing), localTransform.translation, localTransform.scaling, [0, 0, 0]);
          world = adjustedParent === void 0 ? billboardLocal : multiplyMatrix4(adjustedParent, billboardLocal);
        }
      }
      if (!world.every(Number.isFinite))
        throw new RangeError("billboard world exceeds float32");
      adjusted.set(index, world);
      const skin = bone.inverseBindMatrix === void 0 ? void 0 : multiplyMatrix4(world, matrix(bone.inverseBindMatrix));
      if (skin !== void 0 && !skin.every(Number.isFinite))
        throw new RangeError("billboard skin exceeds float32");
      output.set(index, {
        boneIndex: index,
        nodeId: original.nodeId,
        worldMatrix: Array.from(world),
        ...skin === void 0 ? {} : { skinningMatrix: Array.from(skin) }
      });
    }
  }
  signal?.throwIfAborted();
  return pose.map((item) => needed(output.get(item.boneIndex), "result"));
}
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
var unit = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : v;
};
var unit2 = (a, b) => {
  const length = Math.hypot(a, b);
  return length > 0 ? [a / length, b / length] : [a, b];
};
function rotateVector(q, v) {
  const u = [q[0], q[1], q[2]];
  const c1 = cross(u, v);
  const t = [c1[0] * 2, c1[1] * 2, c1[2] * 2];
  const c2 = cross(u, t);
  return [v[0] + q[3] * t[0] + c2[0], v[1] + q[3] * t[1] + c2[1], v[2] + q[3] * t[2] + c2[2]];
}
function transformPoint(m, p) {
  const row = (r) => (m[r] ?? 0) * p[0] + (m[4 + r] ?? 0) * p[1] + (m[8 + r] ?? 0) * p[2] + (m[12 + r] ?? 0);
  return [row(0), row(1), row(2)];
}
var AXIS_EPSILON = 2384185791015625e-22;
var DEGENERATE_LENGTH_SQUARED = 1e-4;
var ORTHONORMAL_TOLERANCE = 1e-3;
function aimRotation(constraint, camera, world, root, spin) {
  let d;
  if (constraint.aim === "eye") {
    if (camera.eye === void 0)
      return void 0;
    d = unit(sub([world[12] ?? 0, world[13] ?? 0, world[14] ?? 0], camera.eye));
  } else
    d = camera.forward;
  if (d.every((component) => Math.abs(component) < AXIS_EPSILON))
    return void 0;
  let rows = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  switch (constraint.lock) {
    case "frame-x": {
      let v = [0, d[1], d[2]];
      if (d[1] * d[1] + d[2] * d[2] < DEGENERATE_LENGTH_SQUARED)
        v = camera.axisX;
      v = unit(v);
      const p = unit2(-v[2], v[1]);
      rows = [[1, 0, 0], v, [0, p[0], p[1]]];
      break;
    }
    case "frame-y": {
      let v = [d[0], 0, d[2]];
      if (d[2] * d[2] + d[0] * d[0] < DEGENERATE_LENGTH_SQUARED)
        v = camera.up;
      v = unit(v);
      const p = unit2(-v[2], v[0]);
      rows = [v, [0, 1, 0], [p[0], 0, p[1]]];
      break;
    }
    case "frame-z": {
      let v = [d[0], d[1], 0];
      if (d[1] * d[1] + d[0] * d[0] < DEGENERATE_LENGTH_SQUARED)
        v = camera.up;
      v = unit(v);
      const p = unit2(v[1], -v[0]);
      rows = [[p[0], p[1], 0], v, [0, 0, 1]];
      break;
    }
    case "own-x":
    case "own-y": {
      const column = constraint.lock === "own-x" ? 0 : 4;
      const a = unit([world[column] ?? 0, world[column + 1] ?? 0, world[column + 2] ?? 0]);
      const c = cross(a, d);
      if (dot(c, c) < DEGENERATE_LENGTH_SQUARED)
        return void 0;
      const cn = unit(c);
      rows = constraint.lock === "own-x" ? [a, cn, cross(a, cn)] : [cn, cross(a, cn), a];
      break;
    }
    case "free": {
      const e = cross(d, camera.up);
      if (dot(e, e) < DEGENERATE_LENGTH_SQUARED)
        break;
      const en = unit(e);
      rows = [en, d, unit(cross(en, d))];
      break;
    }
  }
  if (rows.some((row) => Math.abs(dot(row, row) - 1) >= ORTHONORMAL_TOLERANCE))
    return void 0;
  let q = normalizeQuat(quaternionFromRotationMatrix([...rows[0], ...rows[1], ...rows[2]]));
  if (root) {
    q = multiplyQuat(q, spin);
    if (constraint.rootCorrection !== void 0)
      q = multiplyQuat(q, rotation(constraint.rootCorrection));
  } else if (constraint.correction !== void 0)
    q = multiplyQuat(q, rotation(constraint.correction));
  return q;
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/billboards.js
var UVM_NODE_BILLBOARD = "UV_node_billboard";
function readUvmBillboards(document, maxBytes, signal) {
  signal?.throwIfAborted();
  const nodes = array2(document, "nodes"), values = [];
  let bytes = 0;
  for (const [index, node] of nodes.entries()) {
    signal?.throwIfAborted();
    const raw = field(field(node, "extensions"), UVM_NODE_BILLBOARD);
    if (raw === void 0)
      continue;
    bytes += 512;
    if (bytes > maxBytes)
      throw new RangeError("UVM billboard constraints exceed byte budget");
    const value = object2(raw, "node billboard");
    if (value["schemaVersion"] === 1 && value["mode"] === "inverse-camera") {
      if (Object.keys(value).some((key) => !["schemaVersion", "mode", "basisRotations"].includes(key)))
        throw new TypeError("unsupported UVM node billboard");
      values.push({
        nodeId: `node-${index}`,
        mode: "inverse-camera",
        basisRotations: value["basisRotations"]
      });
    } else if (value["schemaVersion"] === 1 && value["mode"] === "face-camera") {
      if (Object.keys(value).some((key) => !["schemaVersion", "mode", "rotationAxes", "pivot"].includes(key)))
        throw new TypeError("unsupported UVM node billboard");
      values.push({
        nodeId: `node-${index}`,
        mode: "face-camera",
        rotationAxes: value["rotationAxes"],
        pivot: value["pivot"]
      });
    } else if (value["schemaVersion"] === 1 && value["mode"] === "aim") {
      if (Object.keys(value).some((key) => !["schemaVersion", "mode", "aim", "lock", "correction", "rootCorrection"].includes(key)))
        throw new TypeError("unsupported UVM node billboard");
      values.push({
        nodeId: `node-${index}`,
        mode: "aim",
        aim: value["aim"],
        lock: value["lock"],
        ...value["correction"] === void 0 ? {} : { correction: value["correction"] },
        ...value["rootCorrection"] === void 0 ? {} : { rootCorrection: value["rootCorrection"] }
      });
    } else
      throw new TypeError("unsupported UVM node billboard");
  }
  if (values.length > 0 && !array2(document, "extensionsUsed").includes(UVM_NODE_BILLBOARD))
    throw new TypeError("UVM node billboard declaration absent");
  return snapshotModelBillboards(values, maxBytes, signal);
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/model-states.js
var UVM_GAME_MODEL_STATES = "UV_game_model_states";
function readUvmModelStates(document, maxBytes, signal) {
  signal?.throwIfAborted();
  const raw = field(document["extensions"], UVM_GAME_MODEL_STATES);
  if (raw === void 0)
    return [];
  const extension = object2(raw, "model states");
  if (extension["schemaVersion"] !== 1 || Object.keys(extension).some((key) => !["schemaVersion", "states"].includes(key)) || !array2(document, "extensionsUsed").includes(UVM_GAME_MODEL_STATES))
    throw new TypeError("unsupported UVM model states");
  const states = [];
  const seen = /* @__PURE__ */ new Set();
  let bytes = 0;
  for (const candidate of array2(extension, "states")) {
    signal?.throwIfAborted();
    const value = object2(candidate, "model state"), state = value["state"], model = value["model"];
    if (Object.keys(value).some((key) => !["state", "model"].includes(key)) || typeof state !== "string" || state.length === 0 || state !== state.trim() || state === "base" || typeof model !== "string" || model.length === 0 || model !== model.trim() || seen.has(state))
      throw new TypeError("invalid or duplicate UVM model state");
    bytes += 128 + (state.length + model.length) * 2;
    if (bytes > maxBytes)
      throw new RangeError("UVM model states exceed byte budget");
    seen.add(state);
    states.push({ state, model });
  }
  return states;
}

// ../MODDING/modkit-core/packages/uv/dist/model/accessor-write.js
function appendUvmAccessors(source, inputs, budget = { ...DEFAULT_UVM_CONTAINER_BUDGET, maxScalarBytes: 536870912 }, signal) {
  signal?.throwIfAborted();
  checkUvmContainerBudget(budget);
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError("invalid UVM accessor working budget");
  if (!Array.isArray(inputs) || inputs.length > budget.maxNodes)
    throw new RangeError("UVM accessor input count exceeds maxNodes");
  let appendedBytes = 0;
  const requests = inputs.map((input) => ({
    values: input.values,
    type: input.type,
    target: input.target
  }));
  for (const input of requests) {
    signal?.throwIfAborted();
    const width = uvmAccessorWidth(input.type), values = input.values;
    if (!(values instanceof Float32Array || values instanceof Uint16Array || values instanceof Uint32Array) || width === void 0 || values.length === 0 || values.length % width !== 0 || input.target !== void 0 && input.target !== 34962 && input.target !== 34963)
      throw new TypeError("invalid UVM accessor input shape");
    if (input.target === 34963 && (input.type !== "SCALAR" || values instanceof Float32Array))
      throw new TypeError("index buffer requires an unsigned integer scalar accessor");
    appendedBytes += Math.ceil(values.byteLength / 4) * 4;
  }
  const workingBytes = source.binary.byteLength * 3 + appendedBytes * 4;
  if (!Number.isSafeInteger(workingBytes) || workingBytes > budget.maxScalarBytes)
    throw new RangeError("UVM accessor append exceeds maxScalarBytes");
  if (source.binary.length + appendedBytes > Math.min(budget.maxInputBytes, 2147483644))
    throw new RangeError("UVM accessor append exceeds maxInputBytes");
  for (const input of requests)
    for (let i = 0; i < input.values.length; i++) {
      if (i % 4096 === 0)
        signal?.throwIfAborted();
      if (!Number.isFinite(input.values[i]))
        throw new TypeError("UVM accessor values must be finite");
    }
  for (const key of ["buffers", "bufferViews", "accessors"])
    if (source.document[key] !== void 0 && !Array.isArray(source.document[key]))
      throw new TypeError(`UVM ${key} must be an array`);
  writeUvmContainer(source, budget, signal);
  validateUvmDocument(source.document, {
    binaryByteLength: source.binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  if (inputs.length === 0)
    return { container: source, accessors: [] };
  if (source.format !== "glb")
    throw new TypeError("accessor append requires embedded GLB storage");
  const buffers = array(source.document, "buffers");
  const first = object(buffers[0] ?? {}, "buffer 0");
  const declared = first["byteLength"] ?? 0;
  if (first["uri"] !== void 0 || typeof declared !== "number" || !Number.isSafeInteger(declared) || declared < 0 || declared > source.binary.length || source.binary.length - declared > 3)
    throw new TypeError("buffer 0 does not describe embedded BIN storage");
  const jsonBudget = {
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
    maxBytes: budget.maxJsonBytes
  };
  const document = object(snapshotJson(source.document, jsonBudget, signal), "document");
  const views = [...array(document, "bufferViews")];
  const accessors = [...array(document, "accessors")];
  const buffer = new BufferBuilder();
  buffer.append(source.binary);
  const added = [];
  for (const input of requests) {
    signal?.throwIfAborted();
    const componentType = input.values instanceof Float32Array ? 5126 : input.values instanceof Uint16Array ? 5123 : 5125;
    added.push(addAccessor(buffer, views, accessors, input.values, input.type, componentType, input.target));
  }
  const binary = buffer.finish();
  const next = snapshotJson({
    ...document,
    buffers: [{ ...first, byteLength: binary.length }, ...buffers.slice(1)],
    bufferViews: views,
    accessors
  }, jsonBudget, signal);
  const container = {
    format: source.format,
    document: next,
    binary,
    extraChunks: source.extraChunks.map((chunk) => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes)
    }))
  };
  validateUvmDocument(next, {
    binaryByteLength: binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  writeUvmContainer(container, budget, signal);
  return { container, accessors: Object.freeze(added) };
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/shadow-meshes.js
var UVM_MODEL_SHADOW_MESHES = "UV_model_shadow_meshes";
function readUvmShadowMeshBindings(document) {
  const raw = field(document["extensions"], UVM_MODEL_SHADOW_MESHES);
  if (raw === void 0)
    return [];
  const extension = object2(raw, "shadow meshes");
  if (extension["schemaVersion"] !== 1 || Object.keys(extension).some((key) => !["schemaVersion", "shadows"].includes(key)) || !array2(document, "extensionsUsed").includes(UVM_MODEL_SHADOW_MESHES))
    throw new TypeError("unsupported UVM shadow meshes");
  const nodes = array2(document, "nodes"), meshes = array2(document, "meshes"), seen = /* @__PURE__ */ new Set();
  return Object.freeze(array2(extension, "shadows").map((candidate) => {
    const value = object2(candidate, "shadow mesh");
    if (Object.keys(value).some((key) => !["node", "mesh"].includes(key)))
      throw new TypeError("unsupported UVM shadow mesh binding");
    const node = safeIndex(value["node"], nodes.length, "shadow node");
    if (seen.has(node))
      throw new TypeError("duplicate UVM shadow node");
    seen.add(node);
    return Object.freeze({ node, mesh: safeIndex(value["mesh"], meshes.length, "shadow mesh") });
  }));
}
function addUvmShadowMeshes(source, inputs, budget = {
  ...DEFAULT_UVM_CONTAINER_BUDGET,
  maxScalarBytes: 536870912
}, signal) {
  signal?.throwIfAborted();
  validateUvmDocument(source.document, { binaryByteLength: source.binary.length, ...signal ? { signal } : {} });
  const nodes = array2(source.document, "nodes"), existingMeshes = array2(source.document, "meshes");
  const owned = inputs.map((input, ordinal) => {
    const node = safeIndex(input.node, nodes.length, `shadow ${ordinal} node`);
    if (!(input.positions instanceof Float32Array) || input.positions.length < 9 || input.positions.length % 3)
      throw new TypeError("shadow positions must contain complete triangles");
    if (!(input.indices instanceof Uint16Array || input.indices instanceof Uint32Array) || input.indices.length < 3 || input.indices.length % 3)
      throw new TypeError("shadow indices must contain complete triangles");
    for (const value of input.indices)
      if (value >= input.positions.length / 3)
        throw new RangeError("shadow index exceeds positions");
    return { node, positions: input.positions.slice(), indices: input.indices.slice() };
  });
  if (new Set(owned.map((value) => value.node)).size !== owned.length)
    throw new TypeError("duplicate UVM shadow node");
  if (owned.length === 0)
    return { container: source, bindings: [] };
  const appended = appendUvmAccessors(source, owned.flatMap((value) => [
    { values: value.positions, type: "VEC3", target: 34962 },
    { values: value.indices, type: "SCALAR", target: 34963 }
  ]), budget, signal);
  const bindings = owned.map((value, ordinal) => ({ node: value.node, mesh: existingMeshes.length + ordinal }));
  const extension = field(source.document["extensions"], UVM_MODEL_SHADOW_MESHES);
  const existingBindings = extension === void 0 ? [] : readUvmShadowMeshBindings(source.document);
  const occupiedNodes = new Set(existingBindings.map((binding) => binding.node));
  if (owned.some((value) => occupiedNodes.has(value.node)))
    throw new TypeError("duplicate UVM shadow node");
  const previous = extension === void 0 ? [] : array2(extension, "shadows");
  const document = snapshotJson({
    ...appended.container.document,
    meshes: [
      ...existingMeshes,
      ...owned.map((_value, ordinal) => ({
        name: `Shadow mesh ${ordinal}`,
        primitives: [{
          attributes: { POSITION: appended.accessors[ordinal * 2] },
          indices: appended.accessors[ordinal * 2 + 1],
          mode: 4
        }]
      }))
    ],
    extensionsUsed: [.../* @__PURE__ */ new Set([...array2(source.document, "extensionsUsed"), UVM_MODEL_SHADOW_MESHES])],
    extensions: {
      ...object2(source.document["extensions"], "extensions"),
      [UVM_MODEL_SHADOW_MESHES]: { schemaVersion: 1, shadows: [...previous, ...bindings] }
    }
  }, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
  const container = { ...appended.container, document };
  validateUvmDocument(document, { binaryByteLength: container.binary.length, ...signal ? { signal } : {} });
  writeUvmContainer(container, budget, signal);
  return { container, bindings: Object.freeze(bindings.map(Object.freeze)) };
}

export {
  invertMaterialFrame,
  multiplyMaterialFrames,
  IDENTITY_MATERIAL_FRAME,
  snapshotEnvironment,
  snapshotEyePosition,
  isEnvironmentBinding,
  RENDER_MATERIAL_SHADER,
  MATERIAL_LAYERS_SHADER,
  createRenderMaterialSampler,
  snapshotModelBillboards,
  applyModelFaceCameraBillboard,
  billboardCameraRotation,
  applyModelBillboards,
  UVM_NODE_BILLBOARD,
  readUvmBillboards,
  UVM_GAME_MODEL_STATES,
  readUvmModelStates,
  UVM_MODEL_SHADOW_MESHES,
  readUvmShadowMeshBindings,
  addUvmShadowMeshes
};
