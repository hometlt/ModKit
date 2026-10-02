import {
  array,
  field,
  object,
  safeIndex,
  validateUvmDocument
} from "./chunk-PRU56TPQ.js";
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  writeUvmContainer
} from "./chunk-NONHW3HK.js";
import {
  invertAffine,
  multiplyAffine
} from "./chunk-YOJ4JJ3G.js";
import {
  snapshotJson
} from "./chunk-ZSDVUSRM.js";

// ../MODDING/modkit-core/packages/uv/dist/model/frame.js
var WORLD_PROJECTION_UV_SOURCES = Object.freeze([5, 13, 14, 17, 18]);
var IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
var UP_AXIS_ROTATION = Object.freeze([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
function renderMaterialFollowsSceneFrame(params) {
  const model = record(record(params)?.["renderModel"]);
  if (model === void 0 || model["version"] !== 1)
    return false;
  if (model["worldToMaterial"] !== void 0)
    return true;
  const composite = record(model["composite"]);
  const materials = composite === void 0 ? [model["standard"]] : array(composite, "passes").map((pass) => record(pass)?.["material"]);
  return materials.some((material) => Object.values(record(record(material)?.["layers"]) ?? {}).some((layer) => {
    const value = record(layer);
    return typeof value?.["texturePath"] === "string" && typeof value["uvSource"] === "number" && WORLD_PROJECTION_UV_SOURCES.includes(value["uvSource"]);
  }));
}
function withMaterialFrame(material, frame) {
  const extensions = record(field(material, "extensions"));
  const game = record(extensions?.["UV_game_material"]);
  const params = record(game?.["params"]);
  if (extensions === void 0 || game === void 0 || params === void 0)
    return material;
  if (!renderMaterialFollowsSceneFrame(params))
    return material;
  const model = object(params["renderModel"], "render model");
  const current = model["worldToMaterial"];
  const worldToMaterial = multiplyAffine(Array.isArray(current) ? current : IDENTITY, frame);
  return {
    ...material,
    extensions: {
      ...extensions,
      UV_game_material: {
        ...game,
        params: { ...params, renderModel: { ...model, worldToMaterial } }
      }
    }
  };
}
function uvmSceneFrameMatrix(frame) {
  const scale = frame.metersPerSourceUnit;
  const units = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1];
  const upAxis = frame.upAxis === "+z" ? [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1] : IDENTITY;
  const mirror = frame.handedness !== "left" ? IDENTITY : frame.upAxis === "+z" ? [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  return multiplyAffine(units, multiplyAffine(upAxis, mirror));
}
function uvmSceneFrameInverse(frame) {
  return invertAffine(uvmSceneFrameMatrix(frame));
}
var sameNumbers = (value, expected) => Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
function removeUvmFrameWrappers(source, budget = DEFAULT_UVM_CONTAINER_BUDGET, signal) {
  signal?.throwIfAborted();
  validateUvmDocument(source.document, {
    binaryByteLength: source.binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  const document = source.document;
  const scenes = array(document, "scenes");
  if (scenes.length !== 1 || document["scene"] !== 0)
    throw new TypeError("UVM frame removal requires one explicit default scene");
  const scene = object(scenes[0], "scene");
  const nodes = array(document, "nodes");
  const roots = array(scene, "nodes").map((root) => safeIndex(root, nodes.length, "scene root"));
  const extensions = record(document["extensions"]) ?? {};
  const unitsRecord = record(extensions["UV_units"]);
  const removed = [];
  let metersPerSourceUnit = 1;
  let upAxis = "+y";
  let handedness = "right";
  const at = roots.findIndex((root) => ["uv:units", "uv:up-axis", "uv:handedness"].includes(String(record(nodes[root])?.["name"])));
  let inner = at === -1 ? [] : [roots[at]];
  for (const [name, property] of [
    ["uv:units", "scale"],
    ["uv:up-axis", "rotation"],
    ["uv:handedness", "scale"]
  ]) {
    const index = inner.length === 1 ? inner[0] : void 0;
    const node = index === void 0 ? void 0 : record(nodes[index]);
    if (node?.["name"] !== name)
      continue;
    if (Object.keys(node).some((key) => !["name", property, "children"].includes(key)))
      throw new TypeError(`${name} carries more than the materializer writes`);
    const value = node[property];
    if (name === "uv:units") {
      const scale = Array.isArray(value) ? value[0] : void 0;
      if (typeof scale !== "number" || !(scale > 0) || !sameNumbers(value, [scale, scale, scale]) || unitsRecord?.["metersPerSourceUnit"] !== scale)
        throw new TypeError("uv:units is not the scale UV_units records");
      metersPerSourceUnit = scale;
    } else if (name === "uv:up-axis") {
      if (!sameNumbers(value, UP_AXIS_ROTATION))
        throw new TypeError("uv:up-axis is not the +z-up turn");
      upAxis = "+z";
    } else {
      if (!sameNumbers(value, upAxis === "+z" ? [1, -1, 1] : [1, 1, -1]))
        throw new TypeError("uv:handedness is not the mirror of its axis");
      handedness = "left";
    }
    removed.push(index);
    inner = array(node, "children").map((child) => safeIndex(child, nodes.length, `${name} child`));
  }
  if (removed.length === 0)
    return { container: source, frame: { metersPerSourceUnit, upAxis, handedness } };
  const first = nodes.length - removed.length;
  if ([...removed].sort((a, b) => a - b).some((index, order) => index !== first + order))
    throw new TypeError("the materializer's frame nodes are not the document's last nodes");
  const outside = (index, label) => {
    if (typeof index === "number" && index >= first)
      throw new TypeError(`${label} names a frame node of the materializer`);
  };
  for (const [index, node] of nodes.entries())
    if (index < first)
      for (const child of array(node, "children"))
        outside(child, "a node child");
  for (const skin of array(document, "skins")) {
    for (const joint of array(skin, "joints"))
      outside(joint, "a skin joint");
    outside(field(skin, "skeleton"), "a skin skeleton");
  }
  for (const animation of array(document, "animations"))
    for (const channel of array(animation, "channels"))
      outside(field(field(channel, "target"), "node"), "an animation target");
  const sourceFrame = removed.at(-1);
  const spaced = ["UV_game_effects", "UV_scene_lights"];
  for (const name of spaced) {
    const space = field(extensions[name], "spaceNode");
    if (space !== sourceFrame)
      outside(space, `${name} spaceNode`);
  }
  const matrix = uvmSceneFrameMatrix({ metersPerSourceUnit, upAxis, handedness });
  const unframed = (value) => withMaterialFrame(value, matrix);
  const unitsRemoved = removed.some((index) => record(nodes[index])?.["name"] === "uv:units");
  const kept = Object.fromEntries(Object.entries(extensions).filter(([name]) => !(unitsRemoved && name === "UV_units")).map(([name, value]) => {
    const extension = record(value);
    if (!spaced.includes(name) || extension === void 0)
      return [name, value];
    if (extension["spaceNode"] !== sourceFrame)
      return [name, value];
    const { spaceNode: _spaceNode, ...rest } = extension;
    return [name, rest];
  }));
  const used = array(document, "extensionsUsed").filter((name) => !(unitsRemoved && name === "UV_units"));
  const result = snapshotJson({
    ...document,
    ...document["materials"] === void 0 ? {} : { materials: array(document, "materials").map(unframed) },
    ...document["extensionsUsed"] === void 0 ? {} : { extensionsUsed: used },
    ...document["extensions"] === void 0 ? {} : { extensions: kept },
    nodes: nodes.slice(0, first),
    scenes: [{ ...scene, nodes: [...roots.slice(0, at), ...inner, ...roots.slice(at + 1)] }]
  }, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
  const container = {
    ...source,
    document: object(result, "unframed UVM document"),
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map((chunk) => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes)
    }))
  };
  validateUvmDocument(container.document, {
    binaryByteLength: container.binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  writeUvmContainer(container, budget, signal);
  return {
    container,
    frame: {
      metersPerSourceUnit,
      upAxis,
      handedness,
      ...unitsRemoved && unitsRecord !== void 0 ? { units: unitsRecord } : {}
    }
  };
}

export {
  WORLD_PROJECTION_UV_SOURCES,
  renderMaterialFollowsSceneFrame,
  withMaterialFrame,
  uvmSceneFrameMatrix,
  uvmSceneFrameInverse,
  removeUvmFrameWrappers
};
