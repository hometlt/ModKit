import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IDENTITY_MATERIAL_FRAME,
  Line3,
  MATERIAL_LAYERS_SHADER,
  MathUtils,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  RENDER_MATERIAL_SHADER,
  SCENE_RENDERER_CONTRACT,
  SphereGeometry,
  Triangle,
  Vector3,
  applyColorKeyTransparency,
  array,
  billboardCameraRotation,
  createModelAnimationSampler,
  createModelSceneSampler,
  createStandardMaterialPrograms,
  createUvmEffectFrame,
  createUvmProjectorFrame,
  diagnostic,
  encodePng,
  field,
  finiteArray,
  invertMaterialFrame,
  modelPrimitiveByteLength,
  multiplyMaterialFrames,
  object,
  opaqueTexels,
  prepareUvmImages,
  prepareUvmTextureImages,
  readCollisionMesh,
  readPreviewLighting,
  readUvmAnimationClips,
  readUvmContainer,
  readUvmEffectAnimation,
  readUvmModel,
  readUvmPrimitiveVisibility,
  readUvmTextureAlpha,
  readUvmTextureColorKeys,
  required,
  safeIndex,
  sampleEffectSequenceScalar,
  sampleEffectSequenceVector,
  snapshotEnvironment,
  snapshotEyePosition,
  snapshotJson,
  snapshotModelBillboards,
  string,
  uvmImageFilters,
  uvmImageResourceId,
  uvmImageTexels,
  validateUvmDocument,
  vector3,
  vector4
} from "./chunk-C64EV3HL.js";
import "./chunk-QPJEB2TM.js";
import "./chunk-7TLUWFCA.js";
import "./chunk-DJDDRNPC.js";

// packages/scene/dist/uvm/pose-samples.js
function readUvmPoseSamples(value, clips) {
  if (value === void 0)
    return void 0;
  if (!Array.isArray(value) || value.length === 0 || value.length > 32)
    throw new RangeError("poseSamples requires 1..32 entries");
  let active = false;
  const samples = value.map((raw) => {
    const sample = object(raw, "pose sample"), clipId = sample["clipId"], time = sample["time"], weight = sample["weight"], additive = sample["additive"];
    if (Object.keys(sample).some((key) => !["clipId", "time", "weight", "additive"].includes(key)) || typeof clipId !== "string" || typeof time !== "number" || !Number.isFinite(time) || time < 0 || typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || additive !== void 0 && typeof additive !== "boolean")
      throw new TypeError("invalid explicit pose sample");
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (clip === void 0)
      throw new TypeError(`unknown pose sample clip: ${clipId}`);
    if (weight > 0)
      active = true;
    return Object.freeze({ clip, time, weight, ...additive === void 0 ? {} : { additive } });
  });
  if (!active)
    throw new TypeError("poseSamples requires a positive weight");
  return Object.freeze(samples);
}

// packages/scene/dist/uvm/model-particles.js
var multiplyFrames = (a, b) => Float32Array.from(multiplyMaterialFrames(Array.from(a), Array.from(b)));
var multiplyMatrix4 = (a, b) => {
  if (a.length !== 16 || b.length !== 16)
    throw new TypeError("model particle camera matrices must contain 16 components");
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let index = 0; index < 4; index++)
        value += (a[index * 4 + row] ?? Number.NaN) * (b[column * 4 + index] ?? Number.NaN);
      if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
        throw new RangeError("model particle camera matrix exceeds float32");
      output[column * 4 + row] = value;
    }
  return output;
};
function modelParticleMatrix(instance) {
  let local = [
    ...instance.right.map((x) => x * instance.scale[0]),
    0,
    ...instance.up.map((x) => x * instance.scale[1]),
    0,
    ...instance.forward.map((x) => x * instance.scale[2]),
    0,
    ...instance.position,
    1
  ];
  if (instance.swapYZ) {
    const cosine = Math.cos(Math.PI * 0.5);
    local = multiplyMaterialFrames(local, [
      1,
      0,
      0,
      0,
      0,
      cosine,
      1,
      0,
      0,
      -1,
      cosine,
      0,
      0,
      0,
      0,
      1
    ]);
  }
  const matrix = multiplyFrames(instance.transform, local);
  if (!matrix.every(Number.isFinite))
    throw new RangeError("model particle matrix exceeds finite range");
  return matrix;
}
async function composeModelParticles(instances, parent, options, depth, maxBytes, prepare, purpose = { id: "model-particle", label: "Model particles", prefix: "model-particle" }) {
  const primitives = [], materials = [], textures = [], diagnostics = [];
  let composedInstances = 0;
  const warn = (message) => {
    if (diagnostics.length >= options.budget.maxDiagnostics)
      throw new RangeError("nested model diagnostics exceed budget");
    diagnostics.push({
      severity: "warning",
      code: `common.uvm/${purpose.id}-unrendered`,
      message
    });
  };
  if (instances.length === 0)
    return { primitives, materials, textures, diagnostics, composedInstances };
  if (instances.length > Math.min(128, options.budget.maxNodes))
    throw new RangeError("model particle instances exceed budget");
  if (options.modelResources === void 0) {
    warn(`${purpose.label} require a scoped model resource provider; the base scene is retained.`);
    return { primitives, materials, textures, diagnostics, composedInstances };
  }
  if (depth >= 8)
    throw new RangeError("nested model render exceeds depth limit");
  let remaining = maxBytes;
  const leases = /* @__PURE__ */ new Map();
  const cap = Math.floor(remaining / (new Set(instances.map((instance) => instance.path)).size + 1));
  try {
    for (const [ordinal, instance] of instances.entries()) {
      options.signal?.throwIfAborted();
      let lease = leases.get(instance.path);
      if (lease === void 0) {
        lease = await options.modelResources.acquire({
          requirement: {
            id: `${purpose.id}:${instance.path}`,
            logicalId: instance.path,
            role: "sidecar",
            scopes: [
              "sibling-directory",
              "workspace-dependency-layer",
              "current-mount",
              "enclosing-container"
            ]
          },
          maxBytes: Math.min(cap, remaining),
          metersPerSourceUnit: 1
        }, options.signal);
        leases.set(instance.path, lease);
        options.signal?.throwIfAborted();
        const result2 = lease.value.result;
        if (result2.state === "converted") {
          remaining -= result2.bytes.byteLength;
          diagnostics.push(...result2.diagnostics.map((item) => ({
            code: item.code,
            message: item.message,
            severity: item.severity === "hint" ? "information" : item.severity
          })));
          if (diagnostics.length > options.budget.maxDiagnostics)
            throw new RangeError("nested model diagnostics exceed budget");
        } else
          warn(result2.diagnostics.map((item) => item.message).join("; "));
      }
      const result = lease.value.result;
      if (result.state !== "converted")
        continue;
      if (remaining <= 0)
        throw new RangeError("nested model acquisition exceeds byte budget");
      const parsed = readUvmContainer(result.bytes, {
        maxInputBytes: cap,
        maxJsonBytes: cap,
        maxNodes: options.budget.maxNodes,
        maxDepth: options.budget.maxDepth
      });
      const catalog = readUvmAnimationClips(parsed.document);
      const clipId = catalog?.[0]?.id ?? (Array.isArray(parsed.document["animations"]) && parsed.document["animations"].length > 0 ? "animation-0" : void 0);
      const matrix = modelParticleMatrix(instance);
      const camera = {
        viewProjection: Array.from(multiplyMatrix4(parent.camera.viewProjection, matrix)),
        ...parent.camera.viewMatrix === void 0 ? {} : { viewMatrix: Array.from(multiplyFrames(parent.camera.viewMatrix, matrix)) }
      };
      const eye = parent.camera.eyePosition;
      const childEye = eye === void 0 ? void 0 : (() => {
        const inverse = invertMaterialFrame(Array.from(matrix));
        return [0, 1, 2].map((axis) => (inverse[axis] ?? 0) * eye[0] + (inverse[axis + 4] ?? 0) * eye[1] + (inverse[axis + 8] ?? 0) * eye[2] + (inverse[axis + 12] ?? 0));
      })();
      const prepared = await prepare(result.bytes, {
        schemaVersion: 1,
        viewport: { ...parent.viewport },
        camera: { ...camera, ...childEye === void 0 ? {} : { eyePosition: childEye } },
        time: instance.ageSeconds,
        ...parent.scene.materialContext === void 0 ? {} : {
          materialContext: {
            ...parent.scene.materialContext.teamColor === void 0 ? {} : { teamColor: parent.scene.materialContext.teamColor },
            ...parent.scene.materialContext.ambient === void 0 ? {} : { ambient: parent.scene.materialContext.ambient },
            ...parent.scene.materialContext.environment === void 0 ? {} : { environment: parent.scene.materialContext.environment }
          }
        },
        ...clipId === void 0 ? {} : { clipId }
      }, {
        ...options,
        modelResources: lease.value,
        rasterResources: { read: lease.value.readRaster.bind(lease.value) },
        budget: { ...options.budget, maxScalarBytes: remaining }
      }, depth + 1);
      const scene = prepared.request.scene;
      composedInstances++;
      const prefix = `${purpose.prefix}-${ordinal}/`;
      const materialId = (id) => prefix + id;
      const textureId = (id) => prefix + id;
      const cost = scene.primitives.reduce((sum, primitive) => sum + modelPrimitiveByteLength(primitive) + 1024, 0) + (scene.textures ?? []).reduce((sum, texture) => sum + (texture.rgba?.byteLength ?? 0) + 1024, 0) + JSON.stringify(scene.materials ?? []).length * 2;
      if (!Number.isSafeInteger(cost) || cost > remaining)
        throw new RangeError("nested model scene exceeds byte budget");
      remaining -= cost;
      if (primitives.length + scene.primitives.length > options.budget.maxNodes)
        throw new RangeError("nested model primitives exceed budget");
      for (const primitive of scene.primitives)
        primitives.push({
          ...primitive,
          id: prefix + primitive.id,
          ...primitive.materialId === void 0 ? {} : { materialId: materialId(primitive.materialId) },
          transform: multiplyFrames(matrix, primitive.transform ?? IDENTITY_MATERIAL_FRAME),
          tint: instance.color.map((component, axis) => component * (primitive.tint?.[axis] ?? 1))
        });
      for (const material of scene.materials ?? [])
        materials.push({
          ...material,
          id: materialId(material.id),
          ...material.context !== void 0 || scene.materialContext === void 0 ? {} : { context: scene.materialContext },
          ...material.baseColorTexture === void 0 ? {} : { baseColorTexture: textureId(material.baseColorTexture) },
          ...material.textureBindings === void 0 ? {} : {
            textureBindings: material.textureBindings.map((binding) => ({
              ...binding,
              textureId: textureId(binding.textureId)
            }))
          }
        });
      for (const texture of scene.textures ?? [])
        textures.push({ ...texture, id: textureId(texture.id) });
      diagnostics.push(...prepared.diagnostics);
      if (diagnostics.length > options.budget.maxDiagnostics)
        throw new RangeError("nested model diagnostics exceed budget");
    }
    return { primitives, materials, textures, diagnostics, composedInstances };
  } finally {
    const errors = [];
    for (const lease of [...leases.values()].reverse())
      try {
        await lease.release();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length)
      throw errors[0];
  }
}

// packages/scene/dist/uvm/scene-properties.js
function sampleUvmSceneProperties(source, defaults, options) {
  if (!Number.isFinite(options.time))
    throw new TypeError("scene property time must be finite");
  const parsed = readUvmEffectAnimation(source, true, "seconds", options.maxKeys, options.signal);
  for (const key of Object.keys(parsed))
    if (!Object.hasOwn(defaults, key))
      throw new TypeError(`unsupported scene property track ${key}`);
  const tracks = parsed;
  const sequence = options.sequenceIndex ?? null;
  const output = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const entries = tracks[key];
    if (entries !== void 0) {
      const width = Array.isArray(fallback) ? fallback.length : 1;
      for (const raw of entries) {
        const track = object(raw["track"], "scene property track");
        for (const rawKey of array(track, "keys")) {
          const value = object(rawKey, "scene property key");
          for (const component of ["vector", "inTan", "outTan"]) {
            if (value[component] !== void 0 && array(value, component).length !== width)
              throw new TypeError(`scene property ${key} track width differs from its default`);
          }
        }
      }
    }
    output[key] = typeof fallback === "number" ? sampleEffectSequenceScalar(entries, void 0, sequence, options.time, fallback) : Array.from(sampleEffectSequenceVector(entries, sequence, options.time, fallback));
  }
  return Object.freeze(output);
}

// packages/scene/dist/uvm/lights.js
function readUvmSceneLights(document, transforms, activeNodes, options) {
  const source = field(document["extensions"], "UV_scene_lights");
  if (source === void 0)
    return void 0;
  const ext = object(snapshotJson(source, { maxBytes: options.maxBytes, maxNodes: options.maxNodes, maxDepth: 16 }, options.signal), "scene lights");
  if (ext["version"] !== 1 || Object.keys(ext).some((key) => !["version", "spaceNode", "lights", "ambient"].includes(key)))
    throw new TypeError("invalid UV_scene_lights");
  const node = safeIndex(ext["spaceNode"], array(document, "nodes").length, "light space"), id = `node-${node}`;
  const sourceLights = ext["lights"];
  if (!Array.isArray(sourceLights))
    throw new TypeError("scene lights list absent");
  const sampledLights = sourceLights.map((candidate, index) => {
    const light = object(candidate, `scene light ${index}`);
    const animation = light["sequenceAnimation"];
    if (animation === void 0)
      return light;
    const defaults = object(light["animationDefaults"], "scene light animation defaults");
    if (Object.keys(defaults).some((key) => ![
      "color",
      "intensity",
      "attenuationStart",
      "decayExponent",
      "innerConeAngle",
      "outerConeAngle"
    ].includes(key)))
      throw new TypeError("invalid scene light animation defaults");
    const sampled = sampleUvmSceneProperties(animation, defaults, {
      time: options.time ?? 0,
      ...options.sequenceIndex === void 0 ? {} : { sequenceIndex: options.sequenceIndex },
      maxKeys: options.maxNodes,
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    const baseColor = sampled["color"];
    const intensity = sampled["intensity"];
    if (!Array.isArray(baseColor) || baseColor.length !== 3 || baseColor.some((value) => typeof value !== "number" || !Number.isFinite(value)) || typeof intensity !== "number" || !Number.isFinite(intensity) || intensity < 0)
      throw new TypeError("invalid sampled scene light color/intensity");
    const { animationDefaults: _defaults, sequenceAnimation: _animation, ...staticLight } = light;
    return {
      ...staticLight,
      ...sampled,
      color: baseColor.map((value) => value * intensity)
    };
  });
  const rig = readPreviewLighting(sampledLights, ext["ambient"]);
  if (rig === void 0)
    throw new TypeError("scene lights absent");
  if (!activeNodes.has(id))
    return void 0;
  const matrix = transforms.get(id);
  if (matrix === void 0 || matrix.length !== 16 || !matrix.every(Number.isFinite) || matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1)
    throw new TypeError("invalid scene light world frame");
  const column = (offset) => [matrix[offset] ?? 0, matrix[offset + 1] ?? 0, matrix[offset + 2] ?? 0];
  const columns = [column(0), column(4), column(8)];
  const scale = Math.hypot(...columns[0]);
  if (scale <= 1e-8 || columns.some((v) => Math.abs(Math.hypot(...v) - scale) > 1e-5 * scale))
    throw new TypeError("scene light frame requires uniform scale");
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2]
  ]) {
    const first = columns[a], second = columns[b];
    if (Math.abs(first[0] * second[0] + first[1] * second[1] + first[2] * second[2]) > 1e-5 * scale * scale)
      throw new TypeError("scene light frame must be orthogonal");
  }
  const transform = (v, point) => {
    const at = (axis) => (matrix[axis] ?? 0) * v[0] + (matrix[axis + 4] ?? 0) * v[1] + (matrix[axis + 8] ?? 0) * v[2] + (point ? matrix[axis + 12] ?? 0 : 0);
    return [at(0), at(1), at(2)];
  };
  const world = rig.lights.map((light) => ({
    ...light,
    direction: transform(light.direction, false),
    ...light.position === void 0 ? {} : { position: transform(light.position, true) },
    ...light.range === void 0 ? {} : { range: light.range * scale },
    ...light.attenuationStart === void 0 ? {} : { attenuationStart: light.attenuationStart * scale },
    ...light.attenuationEnd === void 0 ? {} : { attenuationEnd: light.attenuationEnd * scale }
  }));
  const result = readPreviewLighting(world, rig.ambient);
  if (result === void 0)
    throw new TypeError("scene light frame absent");
  return { lights: result.lights, ambientLight: result.ambient };
}

// packages/scene/dist/uvm/billboards.js
var UVM_NODE_BILLBOARD = "UV_node_billboard";
function readUvmBillboards(document, maxBytes, signal) {
  signal?.throwIfAborted();
  const nodes = array(document, "nodes"), values = [];
  let bytes = 0;
  for (const [index, node] of nodes.entries()) {
    signal?.throwIfAborted();
    const raw = field(field(node, "extensions"), UVM_NODE_BILLBOARD);
    if (raw === void 0)
      continue;
    bytes += 512;
    if (bytes > maxBytes)
      throw new RangeError("UVM billboard constraints exceed byte budget");
    const value = object(raw, "node billboard");
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
  if (values.length > 0 && !array(document, "extensionsUsed").includes(UVM_NODE_BILLBOARD))
    throw new TypeError("UVM node billboard declaration absent");
  return snapshotModelBillboards(values, maxBytes, signal);
}

// packages/scene/dist/uvm/model-states.js
var UVM_GAME_MODEL_STATES = "UV_game_model_states";
function readUvmModelStates(document, maxBytes, signal) {
  signal?.throwIfAborted();
  const raw = field(document["extensions"], UVM_GAME_MODEL_STATES);
  if (raw === void 0)
    return [];
  const extension = object(raw, "model states");
  if (extension["schemaVersion"] !== 1 || Object.keys(extension).some((key) => !["schemaVersion", "states"].includes(key)) || !array(document, "extensionsUsed").includes(UVM_GAME_MODEL_STATES))
    throw new TypeError("unsupported UVM model states");
  const states = [];
  const seen = /* @__PURE__ */ new Set();
  let bytes = 0;
  for (const candidate of array(extension, "states")) {
    signal?.throwIfAborted();
    const value = object(candidate, "model state"), state = value["state"], model = value["model"];
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

// packages/scene/dist/uvm/shadow-meshes.js
var UVM_MODEL_SHADOW_MESHES = "UV_model_shadow_meshes";
function readUvmShadowMeshBindings(document) {
  const raw = field(document["extensions"], UVM_MODEL_SHADOW_MESHES);
  if (raw === void 0)
    return [];
  const extension = object(raw, "shadow meshes");
  if (extension["schemaVersion"] !== 1 || Object.keys(extension).some((key) => !["schemaVersion", "shadows"].includes(key)) || !array(document, "extensionsUsed").includes(UVM_MODEL_SHADOW_MESHES))
    throw new TypeError("unsupported UVM shadow meshes");
  const nodes = array(document, "nodes"), meshes = array(document, "meshes"), seen = /* @__PURE__ */ new Set();
  return Object.freeze(array(extension, "shadows").map((candidate) => {
    const value = object(candidate, "shadow mesh");
    if (Object.keys(value).some((key) => !["node", "mesh"].includes(key)))
      throw new TypeError("unsupported UVM shadow mesh binding");
    const node = safeIndex(value["node"], nodes.length, "shadow node");
    if (seen.has(node))
      throw new TypeError("duplicate UVM shadow node");
    seen.add(node);
    return Object.freeze({ node, mesh: safeIndex(value["mesh"], meshes.length, "shadow mesh") });
  }));
}

// packages/scene/dist/uvm/cameras.js
function numbers(value, count, label) {
  if (!Array.isArray(value) && !(value instanceof Float32Array) || value.length !== count || !Array.from(value).every((component) => typeof component === "number" && Number.isFinite(component)))
    throw new TypeError(`${label} must contain ${count} finite numbers`);
  return Array.from(value);
}
function positive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new TypeError(`${label} must be finite and positive`);
  return value;
}
function xyz(value) {
  return [value.x, value.y, value.z];
}
function ownedMatrix(matrix) {
  const output = Float32Array.from(matrix.elements);
  if (!output.every(Number.isFinite))
    throw new RangeError("camera matrix exceeds finite float32");
  return output;
}
function affine(value) {
  const values = numbers(value, 16, "camera frame");
  if (values[3] !== 0 || values[7] !== 0 || values[11] !== 0 || values[15] !== 1)
    throw new TypeError("camera frame must be affine");
  const matrix = new Matrix4().fromArray(values);
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new TypeError("camera frame is singular");
  return matrix;
}
function resolveUvmCamera(document, input, options) {
  options.signal?.throwIfAborted();
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 2048 || !Number.isSafeInteger(options.maxNodes) || options.maxNodes < 1)
    throw new RangeError("camera snapshot exceeds budget");
  const snapshotBudget = {
    maxDepth: 16,
    maxNodes: Math.floor(options.maxNodes / 2),
    maxBytes: Math.floor((options.maxBytes - 1024) / 2)
  };
  const request = object(snapshotJson(input, snapshotBudget, options.signal), "camera request");
  if (request["node"] === void 0) {
    if (Object.keys(request).some((key) => !["viewProjection", "viewMatrix", "eyePosition"].includes(key)))
      throw new TypeError("camera matrix request contains an unsupported field");
    const viewProjection = Float32Array.from(numbers(request["viewProjection"], 16, "viewProjection"));
    const view2 = request["viewMatrix"] === void 0 ? void 0 : Float32Array.from(numbers(request["viewMatrix"], 16, "viewMatrix"));
    const eye = snapshotEyePosition(request["eyePosition"]);
    if (view2 !== void 0 && (view2[3] !== 0 || view2[7] !== 0 || view2[11] !== 0 || view2[15] !== 1))
      throw new TypeError("camera viewMatrix must be affine");
    if (!viewProjection.every(Number.isFinite) || view2 !== void 0 && !view2.every(Number.isFinite))
      throw new RangeError("camera request exceeds finite float32");
    return {
      viewProjection,
      ...view2 === void 0 ? {} : { viewMatrix: view2 },
      ...eye === void 0 ? {} : { eyePosition: [eye[0] ?? 0, eye[1] ?? 0, eye[2] ?? 0] }
    };
  }
  if (Object.keys(request).length !== 1)
    throw new TypeError("camera node and explicit matrices are mutually exclusive");
  const nodes = array(document, "nodes"), cameras = array(document, "cameras");
  const nodeIndex = safeIndex(request["node"], nodes.length, "camera node"), id = `node-${nodeIndex}`;
  if (!options.activeNodes.has(id))
    throw new TypeError("camera node is outside the selected scene");
  const node = object(nodes[nodeIndex], "camera node"), cameraIndex = safeIndex(node["camera"], cameras.length, "camera");
  const camera = object(snapshotJson(cameras[cameraIndex], snapshotBudget, options.signal), "camera");
  const world = affine(options.nodeTransforms.get(id));
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  world.decompose(position, rotation, scale);
  const reconstructed = new Matrix4().compose(position, rotation, scale);
  if ([scale.x, scale.y, scale.z].some((value) => !(value > 0)) || world.elements.some((value, index) => Math.abs(value - (reconstructed.elements[index] ?? 0)) > 1e-6 * Math.max(1, Math.abs(value))))
    throw new TypeError("camera frame shear/reflection is unsupported");
  const view = new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)).invert();
  let projection;
  if (camera["type"] === "perspective") {
    let perspective = object(camera["perspective"], "perspective camera");
    const animation = field(field(camera["extensions"], "UV_scene_camera"), "sequenceAnimation");
    if (animation !== void 0) {
      const extension = object(field(camera["extensions"], "UV_scene_camera"), "scene camera");
      if (extension["version"] !== 1 || Object.keys(extension).some((key) => !["version", "sequenceAnimation"].includes(key)))
        throw new TypeError("invalid UV_scene_camera");
      const sampled = sampleUvmSceneProperties(animation, {
        yfov: positive(perspective["yfov"], "camera yfov"),
        znear: positive(perspective["znear"], "camera znear"),
        ...perspective["zfar"] === void 0 ? {} : { zfar: positive(perspective["zfar"], "camera zfar") }
      }, {
        time: options.time ?? 0,
        ...options.sequenceIndex === void 0 ? {} : { sequenceIndex: options.sequenceIndex },
        maxKeys: options.maxNodes,
        ...options.signal === void 0 ? {} : { signal: options.signal }
      });
      perspective = { ...perspective, ...sampled };
    }
    const fov = positive(perspective["yfov"], "camera yfov"), near = positive(perspective["znear"], "camera znear");
    if (!(fov < Math.PI))
      throw new TypeError("camera yfov must be below PI");
    if (perspective["zfar"] === void 0)
      throw new TypeError("infinite-far camera is not supported by the selected projection library");
    const far = positive(perspective["zfar"], "camera zfar");
    if (!(far > near))
      throw new TypeError("camera zfar must exceed znear");
    const aspect = positive(perspective["aspectRatio"] ?? options.aspect, "camera aspect");
    projection = new PerspectiveCamera(MathUtils.radToDeg(fov), aspect, near, far).projectionMatrix;
  } else if (camera["type"] === "orthographic") {
    const orthographic = object(camera["orthographic"], "orthographic camera");
    const x = positive(orthographic["xmag"], "camera xmag"), y = positive(orthographic["ymag"], "camera ymag");
    const near = orthographic["znear"], far = positive(orthographic["zfar"], "camera zfar");
    if (typeof near !== "number" || !Number.isFinite(near) || near < 0 || far <= near)
      throw new TypeError("orthographic camera clip interval is invalid");
    projection = new OrthographicCamera(-x, x, y, -y, near, far).projectionMatrix;
  } else
    throw new TypeError("camera type is unsupported");
  const result = {
    viewProjection: ownedMatrix(new Matrix4().multiplyMatrices(projection, view)),
    viewMatrix: ownedMatrix(view),
    eyePosition: xyz(position)
  };
  options.signal?.throwIfAborted();
  return result;
}

// packages/scene/dist/output/png.js
async function encodeRgbaPng(frame, signal) {
  if (!Number.isSafeInteger(frame.width) || frame.width <= 0 || !Number.isSafeInteger(frame.height) || frame.height <= 0 || !(frame.rgba instanceof Uint8Array) || frame.rgba.byteLength !== frame.width * frame.height * 4) {
    throw new TypeError("PNG input must be a tightly packed positive RGBA8 frame");
  }
  return encodePng(frame.width, frame.height, frame.rgba, signal);
}

// node_modules/.pnpm/three@0.180.0/node_modules/three/examples/jsm/math/ConvexHull.js
var Visible = 0;
var Deleted = 1;
var _v1 = new Vector3();
var _line3 = new Line3();
var _plane = new Plane();
var _closestPoint = new Vector3();
var _triangle = new Triangle();
var ConvexHull = class {
  /**
   * Constructs a new convex hull.
   */
  constructor() {
    this.tolerance = -1;
    this.faces = [];
    this.newFaces = [];
    this.assigned = new VertexList();
    this.unassigned = new VertexList();
    this.vertices = [];
  }
  /**
   * Computes to convex hull for the given array of points.
   *
   * @param {Array<Vector3>} points - The array of points in 3D space.
   * @return {ConvexHull} A reference to this convex hull.
   */
  setFromPoints(points) {
    if (points.length >= 4) {
      this.makeEmpty();
      for (let i = 0, l = points.length; i < l; i++) {
        this.vertices.push(new VertexNode(points[i]));
      }
      this._compute();
    }
    return this;
  }
  /**
   * Computes the convex hull of the given 3D object (including its descendants),
   * accounting for the world transforms of both the 3D object and its descendants.
   *
   * @param {Object3D} object - The 3D object to compute the convex hull for.
   * @return {ConvexHull} A reference to this convex hull.
   */
  setFromObject(object3) {
    const points = [];
    object3.updateMatrixWorld(true);
    object3.traverse(function(node) {
      const geometry = node.geometry;
      if (geometry !== void 0) {
        const attribute = geometry.attributes.position;
        if (attribute !== void 0) {
          for (let i = 0, l = attribute.count; i < l; i++) {
            const point = new Vector3();
            point.fromBufferAttribute(attribute, i).applyMatrix4(node.matrixWorld);
            points.push(point);
          }
        }
      }
    });
    return this.setFromPoints(points);
  }
  /**
   * Returns `true` if the given point lies in the convex hull.
   *
   * @param {Vector3} point - The point to test.
   * @return {boolean} Whether the given point lies in the convex hull or not.
   */
  containsPoint(point) {
    const faces = this.faces;
    for (let i = 0, l = faces.length; i < l; i++) {
      const face = faces[i];
      if (face.distanceToPoint(point) > this.tolerance) return false;
    }
    return true;
  }
  /**
   * Computes the intersections point of the given ray and this convex hull.
   *
   * @param {Ray} ray - The ray to test.
   * @param {Vector3} target - The target vector that is used to store the method's result.
   * @return {?Vector3} The intersection point. Returns `null` if not intersection was detected.
   */
  intersectRay(ray, target) {
    const faces = this.faces;
    let tNear = -Infinity;
    let tFar = Infinity;
    for (let i = 0, l = faces.length; i < l; i++) {
      const face = faces[i];
      const vN = face.distanceToPoint(ray.origin);
      const vD = face.normal.dot(ray.direction);
      if (vN > 0 && vD >= 0) return null;
      const t = vD !== 0 ? -vN / vD : 0;
      if (t <= 0) continue;
      if (vD > 0) {
        tFar = Math.min(t, tFar);
      } else {
        tNear = Math.max(t, tNear);
      }
      if (tNear > tFar) {
        return null;
      }
    }
    if (tNear !== -Infinity) {
      ray.at(tNear, target);
    } else {
      ray.at(tFar, target);
    }
    return target;
  }
  /**
   * Returns `true` if the given ray intersects with this convex hull.
   *
   * @param {Ray} ray - The ray to test.
   * @return {boolean} Whether the given ray intersects with this convex hull or not.
   */
  intersectsRay(ray) {
    return this.intersectRay(ray, _v1) !== null;
  }
  /**
   * Makes the convex hull empty.
   *
   * @return {ConvexHull} A reference to this convex hull.
   */
  makeEmpty() {
    this.faces = [];
    this.vertices = [];
    return this;
  }
  // private
  /**
   * Adds a vertex to the 'assigned' list of vertices and assigns it to the given face.
   *
   * @private
   * @param {VertexNode} vertex - The vertex to add.
   * @param {Face} face - The target face.
   * @return {ConvexHull} A reference to this convex hull.
   */
  _addVertexToFace(vertex, face) {
    vertex.face = face;
    if (face.outside === null) {
      this.assigned.append(vertex);
    } else {
      this.assigned.insertBefore(face.outside, vertex);
    }
    face.outside = vertex;
    return this;
  }
  /**
   * Removes a vertex from the 'assigned' list of vertices and from the given face.
   * It also makes sure that the link from 'face' to the first vertex it sees in 'assigned'
   * is linked correctly after the removal.
   *
   * @private
   * @param {VertexNode} vertex - The vertex to remove.
   * @param {Face} face - The target face.
   * @return {ConvexHull} A reference to this convex hull.
   */
  _removeVertexFromFace(vertex, face) {
    if (vertex === face.outside) {
      if (vertex.next !== null && vertex.next.face === face) {
        face.outside = vertex.next;
      } else {
        face.outside = null;
      }
    }
    this.assigned.remove(vertex);
    return this;
  }
  /**
   * Removes all the visible vertices that a given face is able to see which are stored in
   * the 'assigned' vertex list.
   *
   * @private
   * @param {Face} face - The target face.
   * @return {VertexNode|undefined} A reference to this convex hull.
   */
  _removeAllVerticesFromFace(face) {
    if (face.outside !== null) {
      const start = face.outside;
      let end = face.outside;
      while (end.next !== null && end.next.face === face) {
        end = end.next;
      }
      this.assigned.removeSubList(start, end);
      start.prev = end.next = null;
      face.outside = null;
      return start;
    }
  }
  /**
   * Removes all the visible vertices that `face` is able to see.
   *
   * - If `absorbingFace` doesn't exist, then all the removed vertices will be added to the 'unassigned' vertex list.
   * - If `absorbingFace` exists, then this method will assign all the vertices of 'face' that can see 'absorbingFace'.
   * - If a vertex cannot see `absorbingFace`, it's added to the 'unassigned' vertex list.
   *
   * @private
   * @param {Face} face - The given face.
   * @param {Face} [absorbingFace] - An optional face that tries to absorb the vertices of the first face.
   * @return {ConvexHull} A reference to this convex hull.
   */
  _deleteFaceVertices(face, absorbingFace) {
    const faceVertices = this._removeAllVerticesFromFace(face);
    if (faceVertices !== void 0) {
      if (absorbingFace === void 0) {
        this.unassigned.appendChain(faceVertices);
      } else {
        let vertex = faceVertices;
        do {
          const nextVertex = vertex.next;
          const distance = absorbingFace.distanceToPoint(vertex.point);
          if (distance > this.tolerance) {
            this._addVertexToFace(vertex, absorbingFace);
          } else {
            this.unassigned.append(vertex);
          }
          vertex = nextVertex;
        } while (vertex !== null);
      }
    }
    return this;
  }
  /**
   * Reassigns as many vertices as possible from the unassigned list to the new faces.
   *
   * @private
   * @param {Array<Face>} newFaces - The new faces.
   * @return {ConvexHull} A reference to this convex hull.
   */
  _resolveUnassignedPoints(newFaces) {
    if (this.unassigned.isEmpty() === false) {
      let vertex = this.unassigned.first();
      do {
        const nextVertex = vertex.next;
        let maxDistance = this.tolerance;
        let maxFace = null;
        for (let i = 0; i < newFaces.length; i++) {
          const face = newFaces[i];
          if (face.mark === Visible) {
            const distance = face.distanceToPoint(vertex.point);
            if (distance > maxDistance) {
              maxDistance = distance;
              maxFace = face;
            }
            if (maxDistance > 1e3 * this.tolerance) break;
          }
        }
        if (maxFace !== null) {
          this._addVertexToFace(vertex, maxFace);
        }
        vertex = nextVertex;
      } while (vertex !== null);
    }
    return this;
  }
  /**
   * Computes the extremes values (min/max vectors) which will be used to
   * compute the initial hull.
   *
   * @private
   * @return {Object} The extremes.
   */
  _computeExtremes() {
    const min = new Vector3();
    const max = new Vector3();
    const minVertices = [];
    const maxVertices = [];
    for (let i = 0; i < 3; i++) {
      minVertices[i] = maxVertices[i] = this.vertices[0];
    }
    min.copy(this.vertices[0].point);
    max.copy(this.vertices[0].point);
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const vertex = this.vertices[i];
      const point = vertex.point;
      for (let j = 0; j < 3; j++) {
        if (point.getComponent(j) < min.getComponent(j)) {
          min.setComponent(j, point.getComponent(j));
          minVertices[j] = vertex;
        }
      }
      for (let j = 0; j < 3; j++) {
        if (point.getComponent(j) > max.getComponent(j)) {
          max.setComponent(j, point.getComponent(j));
          maxVertices[j] = vertex;
        }
      }
    }
    this.tolerance = 3 * Number.EPSILON * (Math.max(Math.abs(min.x), Math.abs(max.x)) + Math.max(Math.abs(min.y), Math.abs(max.y)) + Math.max(Math.abs(min.z), Math.abs(max.z)));
    return { min: minVertices, max: maxVertices };
  }
  /**
   * Computes the initial simplex assigning to its faces all the points that are
   * candidates to form part of the hull.
   *
   * @private
   * @return {ConvexHull} A reference to this convex hull.
   */
  _computeInitialHull() {
    const vertices = this.vertices;
    const extremes = this._computeExtremes();
    const min = extremes.min;
    const max = extremes.max;
    let maxDistance = 0;
    let index = 0;
    for (let i = 0; i < 3; i++) {
      const distance = max[i].point.getComponent(i) - min[i].point.getComponent(i);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    const v0 = min[index];
    const v1 = max[index];
    let v2;
    let v3;
    maxDistance = 0;
    _line3.set(v0.point, v1.point);
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const vertex = vertices[i];
      if (vertex !== v0 && vertex !== v1) {
        _line3.closestPointToPoint(vertex.point, true, _closestPoint);
        const distance = _closestPoint.distanceToSquared(vertex.point);
        if (distance > maxDistance) {
          maxDistance = distance;
          v2 = vertex;
        }
      }
    }
    maxDistance = -1;
    _plane.setFromCoplanarPoints(v0.point, v1.point, v2.point);
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const vertex = vertices[i];
      if (vertex !== v0 && vertex !== v1 && vertex !== v2) {
        const distance = Math.abs(_plane.distanceToPoint(vertex.point));
        if (distance > maxDistance) {
          maxDistance = distance;
          v3 = vertex;
        }
      }
    }
    const faces = [];
    if (_plane.distanceToPoint(v3.point) < 0) {
      faces.push(
        Face.create(v0, v1, v2),
        Face.create(v3, v1, v0),
        Face.create(v3, v2, v1),
        Face.create(v3, v0, v2)
      );
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        faces[i + 1].getEdge(2).setTwin(faces[0].getEdge(j));
        faces[i + 1].getEdge(1).setTwin(faces[j + 1].getEdge(0));
      }
    } else {
      faces.push(
        Face.create(v0, v2, v1),
        Face.create(v3, v0, v1),
        Face.create(v3, v1, v2),
        Face.create(v3, v2, v0)
      );
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        faces[i + 1].getEdge(2).setTwin(faces[0].getEdge((3 - i) % 3));
        faces[i + 1].getEdge(0).setTwin(faces[j + 1].getEdge(1));
      }
    }
    for (let i = 0; i < 4; i++) {
      this.faces.push(faces[i]);
    }
    for (let i = 0, l = vertices.length; i < l; i++) {
      const vertex = vertices[i];
      if (vertex !== v0 && vertex !== v1 && vertex !== v2 && vertex !== v3) {
        maxDistance = this.tolerance;
        let maxFace = null;
        for (let j = 0; j < 4; j++) {
          const distance = this.faces[j].distanceToPoint(vertex.point);
          if (distance > maxDistance) {
            maxDistance = distance;
            maxFace = this.faces[j];
          }
        }
        if (maxFace !== null) {
          this._addVertexToFace(vertex, maxFace);
        }
      }
    }
    return this;
  }
  /**
   * Removes inactive (e.g. deleted) faces from the internal face list.
   *
   * @private
   * @return {ConvexHull} A reference to this convex hull.
   */
  _reindexFaces() {
    const activeFaces = [];
    for (let i = 0; i < this.faces.length; i++) {
      const face = this.faces[i];
      if (face.mark === Visible) {
        activeFaces.push(face);
      }
    }
    this.faces = activeFaces;
    return this;
  }
  /**
   * Finds the next vertex to create faces with the current hull.
   *
   * - Let the initial face be the first face existing in the 'assigned' vertex list.
   * - If a face doesn't exist then return since there're no vertices left.
   * - Otherwise for each vertex that face sees find the one furthest away from it.
   *
   * @private
   * @return {?VertexNode} The next vertex to add.
   */
  _nextVertexToAdd() {
    if (this.assigned.isEmpty() === false) {
      let eyeVertex, maxDistance = 0;
      const eyeFace = this.assigned.first().face;
      let vertex = eyeFace.outside;
      do {
        const distance = eyeFace.distanceToPoint(vertex.point);
        if (distance > maxDistance) {
          maxDistance = distance;
          eyeVertex = vertex;
        }
        vertex = vertex.next;
      } while (vertex !== null && vertex.face === eyeFace);
      return eyeVertex;
    }
  }
  /**
   * Computes a chain of half edges in CCW order called the 'horizon'. For an edge
   * to be part of the horizon it must join a face that can see 'eyePoint' and a face
   * that cannot see 'eyePoint'.
   *
   * @private
   * @param {Vector3} eyePoint - The 3D-coordinates of a point.
   * @param {HalfEdge} crossEdge - The edge used to jump to the current face.
   * @param {Face} face - The current face being tested.
   * @param {Array<HalfEdge>} horizon - The edges that form part of the horizon in CCW order.
   * @return {ConvexHull} A reference to this convex hull.
   */
  _computeHorizon(eyePoint, crossEdge, face, horizon) {
    this._deleteFaceVertices(face);
    face.mark = Deleted;
    let edge;
    if (crossEdge === null) {
      edge = crossEdge = face.getEdge(0);
    } else {
      edge = crossEdge.next;
    }
    do {
      const twinEdge = edge.twin;
      const oppositeFace = twinEdge.face;
      if (oppositeFace.mark === Visible) {
        if (oppositeFace.distanceToPoint(eyePoint) > this.tolerance) {
          this._computeHorizon(eyePoint, twinEdge, oppositeFace, horizon);
        } else {
          horizon.push(edge);
        }
      }
      edge = edge.next;
    } while (edge !== crossEdge);
    return this;
  }
  /**
   * Creates a face with the vertices 'eyeVertex.point', 'horizonEdge.tail' and 'horizonEdge.head'
   * in CCW order. All the half edges are created in CCW order thus the face is always pointing
   * outside the hull.
   *
   * @private
   * @param {VertexNode} eyeVertex - The vertex that is added to the hull.
   * @param {HalfEdge} horizonEdge - A single edge of the horizon.
   * @return {HalfEdge} The half edge whose vertex is the eyeVertex.
   */
  _addAdjoiningFace(eyeVertex, horizonEdge) {
    const face = Face.create(eyeVertex, horizonEdge.tail(), horizonEdge.head());
    this.faces.push(face);
    face.getEdge(-1).setTwin(horizonEdge.twin);
    return face.getEdge(0);
  }
  /**
   * Adds 'horizon.length' faces to the hull, each face will be linked with the horizon
   * opposite face and the face on the left/right.
   *
   * @private
   * @param {VertexNode} eyeVertex - The vertex that is added to the hull.
   * @param {Array<HalfEdge>} horizon - The horizon.
   * @return {ConvexHull} A reference to this convex hull.
   */
  _addNewFaces(eyeVertex, horizon) {
    this.newFaces = [];
    let firstSideEdge = null;
    let previousSideEdge = null;
    for (let i = 0; i < horizon.length; i++) {
      const horizonEdge = horizon[i];
      const sideEdge = this._addAdjoiningFace(eyeVertex, horizonEdge);
      if (firstSideEdge === null) {
        firstSideEdge = sideEdge;
      } else {
        sideEdge.next.setTwin(previousSideEdge);
      }
      this.newFaces.push(sideEdge.face);
      previousSideEdge = sideEdge;
    }
    firstSideEdge.next.setTwin(previousSideEdge);
    return this;
  }
  /**
   * Adds a vertex to the hull with the following algorithm:
   *
   * - Compute the 'horizon' which is a chain of half edges. For an edge to belong to this group
   * it must be the edge connecting a face that can see 'eyeVertex' and a face which cannot see 'eyeVertex'.
   * - All the faces that can see 'eyeVertex' have its visible vertices removed from the assigned vertex list.
   * - A new set of faces is created with each edge of the 'horizon' and 'eyeVertex'. Each face is connected
   * with the opposite horizon face and the face on the left/right.
   * - The vertices removed from all the visible faces are assigned to the new faces if possible.
   *
   * @private
   * @param {VertexNode} eyeVertex - The vertex to add.
   * @return {ConvexHull} A reference to this convex hull.
   */
  _addVertexToHull(eyeVertex) {
    const horizon = [];
    this.unassigned.clear();
    this._removeVertexFromFace(eyeVertex, eyeVertex.face);
    this._computeHorizon(eyeVertex.point, null, eyeVertex.face, horizon);
    this._addNewFaces(eyeVertex, horizon);
    this._resolveUnassignedPoints(this.newFaces);
    return this;
  }
  /**
   * Cleans up internal properties after computing the convex hull.
   *
   * @private
   * @return {ConvexHull} A reference to this convex hull.
   */
  _cleanup() {
    this.assigned.clear();
    this.unassigned.clear();
    this.newFaces = [];
    return this;
  }
  /**
   * Starts the execution of the quick hull algorithm.
   *
   * @private
   * @return {ConvexHull} A reference to this convex hull.
   */
  _compute() {
    let vertex;
    this._computeInitialHull();
    while ((vertex = this._nextVertexToAdd()) !== void 0) {
      this._addVertexToHull(vertex);
    }
    this._reindexFaces();
    this._cleanup();
    return this;
  }
};
var Face = class _Face {
  /**
   * Constructs a new face.
   */
  constructor() {
    this.normal = new Vector3();
    this.midpoint = new Vector3();
    this.area = 0;
    this.constant = 0;
    this.outside = null;
    this.mark = Visible;
    this.edge = null;
  }
  /**
   * Creates a face from the given vertex nodes.
   *
   * @private
   * @param {VertexNode} a - The first vertex node.
   * @param {VertexNode} b - The second vertex node.
   * @param {VertexNode} c - The third vertex node.
   * @return {Face} The created face.
   */
  static create(a, b, c) {
    const face = new _Face();
    const e0 = new HalfEdge(a, face);
    const e1 = new HalfEdge(b, face);
    const e2 = new HalfEdge(c, face);
    e0.next = e2.prev = e1;
    e1.next = e0.prev = e2;
    e2.next = e1.prev = e0;
    face.edge = e0;
    return face.compute();
  }
  /**
   * Returns an edge by the given index.
   *
   * @private
   * @param {number} i - The edge index.
   * @return {HalfEdge} The edge.
   */
  getEdge(i) {
    let edge = this.edge;
    while (i > 0) {
      edge = edge.next;
      i--;
    }
    while (i < 0) {
      edge = edge.prev;
      i++;
    }
    return edge;
  }
  /**
   * Computes all properties of the face.
   *
   * @private
   * @return {Face} A reference to this face.
   */
  compute() {
    const a = this.edge.tail();
    const b = this.edge.head();
    const c = this.edge.next.head();
    _triangle.set(a.point, b.point, c.point);
    _triangle.getNormal(this.normal);
    _triangle.getMidpoint(this.midpoint);
    this.area = _triangle.getArea();
    this.constant = this.normal.dot(this.midpoint);
    return this;
  }
  /**
   * Returns the signed distance from a given point to the plane representation of this face.
   *
   * @private
   * @param {Vector3} point - The point to compute the distance to.
   * @return {number} The distance.
   */
  distanceToPoint(point) {
    return this.normal.dot(point) - this.constant;
  }
};
var HalfEdge = class {
  /**
   * Constructs a new half edge.
   *
   * @param {VertexNode} vertex - A reference to its destination vertex.
   * @param {Face} face - A reference to its face.
   */
  constructor(vertex, face) {
    this.vertex = vertex;
    this.prev = null;
    this.next = null;
    this.twin = null;
    this.face = face;
  }
  /**
   * Returns the destination vertex.
   *
   * @private
   * @return {VertexNode} The destination vertex.
   */
  head() {
    return this.vertex;
  }
  /**
   * Returns the origin vertex.
   *
   * @private
   * @return {?VertexNode} The destination vertex.
   */
  tail() {
    return this.prev ? this.prev.vertex : null;
  }
  /**
   * Returns the Euclidean length (straight-line length) of the edge.
   *
   * @private
   * @return {number} The edge's length.
   */
  length() {
    const head = this.head();
    const tail = this.tail();
    if (tail !== null) {
      return tail.point.distanceTo(head.point);
    }
    return -1;
  }
  /**
   * Returns the square of the Euclidean length (straight-line length) of the edge.
   *
   * @private
   * @return {number} The square of the edge's length.
   */
  lengthSquared() {
    const head = this.head();
    const tail = this.tail();
    if (tail !== null) {
      return tail.point.distanceToSquared(head.point);
    }
    return -1;
  }
  /**
   * Sets the twin edge of this half-edge. It also ensures that the twin reference
   * of the given half-edge is correctly set.
   *
   * @private
   * @param {HalfEdge} edge - The twin edge to set.
   * @return {HalfEdge} A reference to this edge.
   */
  setTwin(edge) {
    this.twin = edge;
    edge.twin = this;
    return this;
  }
};
var VertexNode = class {
  /**
   * Constructs a new vertex node.
   *
   * @param {Vector3} point - A point in 3D space.
   */
  constructor(point) {
    this.point = point;
    this.prev = null;
    this.next = null;
    this.face = null;
  }
};
var VertexList = class {
  /**
   * Constructs a new vertex list.
   */
  constructor() {
    this.head = null;
    this.tail = null;
  }
  /**
   * Returns the head reference.
   *
   * @private
   * @return {VertexNode} The head reference.
   */
  first() {
    return this.head;
  }
  /**
   * Returns the tail reference.
   *
   * @private
   * @return {VertexNode} The tail reference.
   */
  last() {
    return this.tail;
  }
  /**
   * Clears the linked list.
   *
   * @private
   * @return {VertexList} A reference to this vertex list.
   */
  clear() {
    this.head = this.tail = null;
    return this;
  }
  /**
   * Inserts a vertex before a target vertex.
   *
   * @private
   * @param {VertexNode} target - The target.
   * @param {VertexNode} vertex - The vertex to insert.
   * @return {VertexList} A reference to this vertex list.
   */
  insertBefore(target, vertex) {
    vertex.prev = target.prev;
    vertex.next = target;
    if (vertex.prev === null) {
      this.head = vertex;
    } else {
      vertex.prev.next = vertex;
    }
    target.prev = vertex;
    return this;
  }
  /**
   * Inserts a vertex after a target vertex.
   *
   * @private
   * @param {VertexNode} target - The target.
   * @param {VertexNode} vertex - The vertex to insert.
   * @return {VertexList} A reference to this vertex list.
   */
  insertAfter(target, vertex) {
    vertex.prev = target;
    vertex.next = target.next;
    if (vertex.next === null) {
      this.tail = vertex;
    } else {
      vertex.next.prev = vertex;
    }
    target.next = vertex;
    return this;
  }
  /**
   * Appends a vertex to this vertex list.
   *
   * @private
   * @param {VertexNode} vertex - The vertex to append.
   * @return {VertexList} A reference to this vertex list.
   */
  append(vertex) {
    if (this.head === null) {
      this.head = vertex;
    } else {
      this.tail.next = vertex;
    }
    vertex.prev = this.tail;
    vertex.next = null;
    this.tail = vertex;
    return this;
  }
  /**
   * Appends a chain of vertices where the given vertex is the head.
   *
   * @private
   * @param {VertexNode} vertex - The head vertex of a chain of vertices.
   * @return {VertexList} A reference to this vertex list.
   */
  appendChain(vertex) {
    if (this.head === null) {
      this.head = vertex;
    } else {
      this.tail.next = vertex;
    }
    vertex.prev = this.tail;
    while (vertex.next !== null) {
      vertex = vertex.next;
    }
    this.tail = vertex;
    return this;
  }
  /**
   * Removes a vertex from the linked list.
   *
   * @private
   * @param {VertexNode} vertex - The vertex to remove.
   * @return {VertexList} A reference to this vertex list.
   */
  remove(vertex) {
    if (vertex.prev === null) {
      this.head = vertex.next;
    } else {
      vertex.prev.next = vertex.next;
    }
    if (vertex.next === null) {
      this.tail = vertex.prev;
    } else {
      vertex.next.prev = vertex.prev;
    }
    return this;
  }
  /**
   * Removes a sublist of vertices from the linked list.
   *
   * @private
   * @param {VertexNode} a - The head of the sublist.
   * @param {VertexNode} b - The tail of the sublist.
   * @return {VertexList} A reference to this vertex list.
   */
  removeSubList(a, b) {
    if (a.prev === null) {
      this.head = b.next;
    } else {
      a.prev.next = b.next;
    }
    if (b.next === null) {
      this.tail = a.prev;
    } else {
      b.next.prev = a.prev;
    }
    return this;
  }
  /**
   * Returns `true` if the linked list is empty.
   *
   * @private
   * @return {boolean} Whether the linked list is empty or not.
   */
  isEmpty() {
    return this.head === null;
  }
};

// node_modules/.pnpm/three@0.180.0/node_modules/three/examples/jsm/geometries/ConvexGeometry.js
var ConvexGeometry = class extends BufferGeometry {
  /**
   * Constructs a new convex geometry.
   *
   * @param {Array<Vector3>} points - An array of points in 3D space which should be enclosed by the convex hull.
   */
  constructor(points = []) {
    super();
    const vertices = [];
    const normals = [];
    const convexHull = new ConvexHull().setFromPoints(points);
    const faces = convexHull.faces;
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      let edge = face.edge;
      do {
        const point = edge.head().point;
        vertices.push(point.x, point.y, point.z);
        normals.push(face.normal.x, face.normal.y, face.normal.z);
        edge = edge.next;
      } while (edge !== face.edge);
    }
    this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  }
};

// packages/scene/dist/uvm/collision-overlay.js
var IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
var WORKING_BYTES_PER_SHAPE = 65536;
function createUvmCollisionOverlay(document, binary, budget, signal) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError("invalid UVM collision overlay budget");
  const maxShapes = budget.maxShapes ?? 65536;
  const maxHullVertices = budget.maxHullVertices ?? 4096;
  const planeExtent = budget.planeExtent ?? 2;
  if (!Number.isSafeInteger(maxShapes) || maxShapes < 0)
    throw new TypeError("invalid maxShapes");
  if (!Number.isSafeInteger(maxHullVertices) || maxHullVertices < 0)
    throw new TypeError("invalid maxHullVertices");
  if (!Number.isFinite(planeExtent) || planeExtent <= 0)
    throw new TypeError("invalid planeExtent");
  validateUvmDocument(document, {
    binaryByteLength: binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  const records = [];
  for (const [nodeIndex, node] of array(document, "nodes").entries()) {
    signal?.throwIfAborted();
    const collision = field(field(node, "extensions"), "UV_game_collision");
    if (collision === void 0)
      continue;
    for (const [index, value] of array(collision, "shapes").entries()) {
      if (records.length >= maxShapes || (records.length + 1) * WORKING_BYTES_PER_SHAPE > budget.maxScalarBytes)
        throw new RangeError("UVM collision overlay exceeds its working budget");
      records.push({
        nodeId: `node-${nodeIndex}`,
        id: `node-${nodeIndex}-collision-${index}`,
        shape: object(value, "collision shape")
      });
    }
  }
  const diagnostics = [];
  const prepared = [];
  let workingBytes = records.length * WORKING_BYTES_PER_SHAPE;
  for (const { nodeId, id, shape } of records) {
    signal?.throwIfAborted();
    const matrix = shape["matrix"] ?? IDENTITY;
    if (!finiteArray(matrix, 16) || [3, 7, 11].some((i) => matrix[i] !== 0) || matrix[15] !== 1)
      throw new TypeError("collision overlay requires finite affine local matrices");
    let geometry;
    switch (shape["kind"]) {
      case "mesh":
      case "convex-hull": {
        const mesh = readCollisionMesh(document, binary, shape, { maxScalarBytes: Math.floor((budget.maxScalarBytes - workingBytes) / 3) }, signal);
        const points = mesh.positions.length / 3;
        const additionalBytes = mesh.scalarBytes * 3 + (shape["kind"] === "convex-hull" ? points * 1024 : 0);
        workingBytes += additionalBytes;
        if (!Number.isSafeInteger(workingBytes) || workingBytes > budget.maxScalarBytes)
          throw new RangeError("UVM collision overlay exceeds its working budget");
        if (shape["kind"] === "mesh") {
          prepared.push({
            nodeId,
            local: [...matrix],
            primitive: {
              id,
              topology: "triangles",
              positions: mesh.positions,
              indices: required(mesh.indices, "collision mesh indices"),
              materialId: "uvm-collision-overlay"
            }
          });
          continue;
        }
        if (points > maxHullVertices)
          throw new RangeError("collision hull exceeds maxHullVertices");
        if (points < 4)
          throw new TypeError("collision hull needs at least four noncoplanar points");
        const vertices = [];
        for (let i = 0; i < mesh.positions.length; i += 3) {
          if (i % 4096 === 0)
            signal?.throwIfAborted();
          vertices.push(new Vector3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]));
        }
        try {
          geometry = new ConvexGeometry(vertices);
        } catch (cause) {
          throw new TypeError("collision hull could not form a closed convex volume", { cause });
        }
        signal?.throwIfAborted();
        break;
      }
      case "plane": {
        const normal = new Vector3(...vector3(shape["normal"])).normalize();
        geometry = new PlaneGeometry(planeExtent, planeExtent);
        geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal));
        diagnostics.push({
          severity: "information",
          code: "uvm/collision-plane-preview",
          primitiveId: id,
          message: `Infinite collision plane is displayed as a ${planeExtent} by ${planeExtent} local preview.`
        });
        break;
      }
      case "box":
        geometry = new BoxGeometry(...vector3(shape["size"]));
        break;
      case "sphere":
        geometry = new SphereGeometry(Number(shape["radius"]), 12, 8);
        break;
      case "capsule":
        geometry = new CapsuleGeometry(Number(shape["radius"]), Number(shape["height"]), 4, 12);
        break;
      case "cylinder":
        geometry = new CylinderGeometry(Number(shape["radius"]), Number(shape["radius"]), Number(shape["height"]), 12, 1);
        break;
      default:
        throw new TypeError(`unsupported UVM collision kind ${String(shape["kind"])}`);
    }
    try {
      if (shape["kind"] === "capsule" || shape["kind"] === "cylinder") {
        if (shape["axis"] === "x")
          geometry.rotateZ(-Math.PI / 2);
        if (shape["axis"] === "z")
          geometry.rotateX(Math.PI / 2);
      }
      const positions = Float32Array.from(geometry.getAttribute("position").array);
      const index = geometry.getIndex();
      const indices = index === null ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) : Uint32Array.from(index.array);
      if (positions.length === 0 || !positions.every(Number.isFinite))
        throw new RangeError("collision dimensions exceed float32 render range");
      prepared.push({
        nodeId,
        local: [...matrix],
        primitive: {
          id,
          topology: "triangles",
          positions,
          indices,
          materialId: "uvm-collision-overlay"
        }
      });
    } finally {
      geometry.dispose();
    }
  }
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics.map((item) => Object.freeze(item))),
    /** Each call returns owned geometry and matrices. A mutated frame cannot corrupt later frames. */
    sample(nodeTransforms, signal2, visibleNodeIds) {
      signal2?.throwIfAborted();
      const visible = visibleNodeIds === void 0 ? prepared : prepared.filter((item) => visibleNodeIds.has(item.nodeId));
      for (const item of visible) {
        const world = required(nodeTransforms.get(item.nodeId), "collision node world transform");
        if (world.length !== 16 || !world.every(Number.isFinite) || [3, 7, 11].some((i) => world[i] !== 0) || world[15] !== 1)
          throw new TypeError("collision overlay requires finite affine world matrices");
      }
      return visible.map((item) => {
        signal2?.throwIfAborted();
        const world = new Matrix4().fromArray(required(nodeTransforms.get(item.nodeId), "collision node"));
        const transform = Float32Array.from(world.multiply(new Matrix4().fromArray(item.local)).elements);
        if (!transform.every(Number.isFinite))
          throw new RangeError("collision world transform exceeds float32 range");
        return {
          ...item.primitive,
          positions: new Float32Array(item.primitive.positions),
          indices: new Uint32Array(required(item.primitive.indices, "collision indices")),
          transform
        };
      });
    }
  });
}

// packages/scene/dist/uvm/materials.js
function layerList(material) {
  const extras = field(material["extras"], "modkit");
  const native = extras === void 0 ? void 0 : field(extras, "material");
  const fields = native === void 0 ? void 0 : field(native, "fields");
  const layers = fields === void 0 ? void 0 : field(fields, "layers");
  if (!Array.isArray(layers))
    return [];
  const out = [];
  for (const entry of layers) {
    if (typeof entry !== "object" || entry === null)
      continue;
    const record = entry;
    const path = record["resourceId"];
    const slot = record["slot"];
    if (typeof path !== "string" || path === "")
      continue;
    out.push({ label: typeof slot === "string" && slot !== "" ? slot : "diffuse", path });
  }
  return out;
}
function uvmMaterialBlendEffect(material, wrap) {
  const extension = field(material["extensions"], "UV_game_material");
  if (extension === void 0)
    return void 0;
  const data = object(extension, "game material");
  const mode = data["blendMode"];
  const blend = mode === "additive" || mode === "add-alpha" || mode === "modulate" || mode === "modulate2x" ? mode : void 0;
  if (blend === void 0)
    return void 0;
  const renderModel = field(object(data["params"] ?? {}, "game material parameters"), "renderModel");
  if (renderModel !== void 0 && (field(renderModel, "standard") !== void 0 || field(renderModel, "composite") !== void 0))
    return void 0;
  return {
    blend,
    depthTest: data["depthTest"] !== false,
    depthWrite: data["depthWrite"] === true,
    doubleSided: material["doubleSided"] === true || data["cull"] === "none",
    alphaCutoff: 0,
    ...wrap()
  };
}
function uvmMaterialDrawOrder(material) {
  const game = field(material["extensions"], "UV_game_material");
  const fields = field(field(field(material["extras"], "modkit"), "material"), "fields");
  const depthWrite = field(game, "depthWrite") ?? field(fields, "depthWrite");
  const priority = field(game, "sortPriority") ?? field(fields, "priority");
  return {
    ...typeof depthWrite === "boolean" ? { depthWrite } : {},
    ...typeof priority === "number" && Number.isFinite(priority) ? { priority } : {}
  };
}
function uvmMaterialPbr(material, baseTexCoord) {
  const pbr = object(material["pbrMetallicRoughness"] ?? {}, "PBR material");
  const unrendered = [];
  const unit = (value, fallback, label) => {
    const result = value ?? fallback;
    if (typeof result !== "number" || !Number.isFinite(result) || result < 0 || result > 1)
      throw new TypeError(`material ${label} must be in 0..1`);
    return result;
  };
  const texture = (reference, label) => {
    if (reference === void 0)
      return void 0;
    const binding = object(reference, `${label} texture`);
    const index = binding["index"];
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)
      throw new TypeError(`material ${label} texture index is invalid`);
    if ((binding["texCoord"] ?? 0) !== baseTexCoord) {
      unrendered.push(`reads its ${label} texture from other UVs than its base colour`);
      return void 0;
    }
    return `uvm-texture-${String(index)}`;
  };
  const emissive = material["emissiveFactor"];
  if (emissive !== void 0 && (!Array.isArray(emissive) || emissive.length !== 3 || !emissive.every((item) => typeof item === "number" && item >= 0 && item <= 1)))
    throw new TypeError("material emissiveFactor must be three components in 0..1");
  const occlusion = material["occlusionTexture"];
  const metallicRoughnessTexture = texture(pbr["metallicRoughnessTexture"], "metallic-roughness");
  const occlusionTexture = texture(occlusion, "occlusion");
  const emissiveTexture = texture(material["emissiveTexture"], "emissive");
  const normal = material["normalTexture"];
  const normalTexture = texture(normal, "normal");
  const normalScale = field(normal, "scale") ?? 1;
  if (typeof normalScale !== "number" || !Number.isFinite(normalScale))
    throw new TypeError("material normal texture scale must be finite");
  return {
    pbr: {
      metallic: unit(pbr["metallicFactor"], 1, "metallicFactor"),
      roughness: unit(pbr["roughnessFactor"], 1, "roughnessFactor"),
      ...metallicRoughnessTexture === void 0 ? {} : { metallicRoughnessTexture },
      ...occlusionTexture === void 0 ? {} : {
        occlusionTexture,
        occlusionStrength: unit(field(occlusion, "strength"), 1, "occlusion strength")
      },
      ...emissive === void 0 ? {} : { emissive: [emissive[0], emissive[1], emissive[2]] },
      ...emissiveTexture === void 0 ? {} : { emissiveTexture },
      ...normalTexture === void 0 ? {} : { normalTexture, ...normalScale === 1 ? {} : { normalScale } }
    },
    unrendered
  };
}
var TEAM_BLENDS = /* @__PURE__ */ new Set(["multiply", "add", "replace", "overlay", "lerp"]);
var TEAM_CHANNELS = /* @__PURE__ */ new Set(["r", "g", "b", "a", "rgb"]);
function uvmMaterialTeamColor(material, baseTexCoord) {
  const extension = field(material["extensions"], "UV_game_material_team_color");
  if (extension === void 0)
    return {};
  const team = object(extension, "team colour");
  const blend = team["blend"] ?? "multiply";
  const strength = team["strength"] ?? 1;
  if (typeof blend !== "string" || !TEAM_BLENDS.has(blend))
    return { unrendered: `blend ${String(blend)} is not one the extension names` };
  if (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0)
    return { unrendered: "its strength is not a nonnegative number" };
  const defaults = team["defaultColor"];
  const defaultColor = Array.isArray(defaults) && defaults.length >= 3 && defaults.slice(0, 3).every((item) => typeof item === "number" && item >= 0 && item <= 1) ? [defaults[0], defaults[1], defaults[2]] : void 0;
  const common = {
    blend,
    ...strength === 1 ? {} : { strength },
    ...defaultColor === void 0 ? {} : { defaultColor }
  };
  const source = team["maskSource"];
  if (source === "whole")
    return { teamColor: { mask: "whole", ...common } };
  if (source !== "texture")
    return { unrendered: `its ${String(source)} mask is not drawn yet` };
  const mask = object(team["maskTexture"] ?? {}, "team colour mask texture");
  const index = mask["index"];
  const texCoord = mask["texCoord"] ?? 0;
  const channel = mask["channel"] ?? "rgb";
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)
    return { unrendered: "its mask names no texture" };
  if (texCoord !== baseTexCoord)
    return {
      unrendered: `its mask reads TEXCOORD_${String(texCoord)}, the base colour another set`
    };
  if (typeof channel !== "string" || !TEAM_CHANNELS.has(channel))
    return { unrendered: `its mask channel ${String(channel)} is unknown` };
  return {
    teamColor: {
      mask: {
        texture: `uvm-texture-${String(index)}`,
        channel
      },
      ...common
    },
    maskTexture: index
  };
}
function uvmMaterialShader(material) {
  const extension = field(material["extensions"], "UV_game_material");
  if (extension === void 0) {
    const layers = layerList(material);
    return layers.length === 0 ? void 0 : { id: MATERIAL_LAYERS_SHADER, parameters: { renderModel: { layers } } };
  }
  const data = object(extension, "game material");
  const parameters = object(data["params"] ?? {}, "game material parameters");
  return {
    id: string(data["shader"], "game material shader"),
    parameters: withLayerList(parameters, material)
  };
}
function withLayerList(parameters, material) {
  const renderModel = field(parameters, "renderModel");
  if (renderModel !== void 0 && field(renderModel, "layers") !== void 0)
    return parameters;
  const layers = layerList(material);
  if (layers.length === 0)
    return parameters;
  return {
    ...parameters,
    renderModel: {
      ...renderModel === void 0 ? {} : object(renderModel, "render model parameters"),
      layers
    }
  };
}
function materialLayerResources(shader) {
  const params = shader.parameters;
  const seen = /* @__PURE__ */ new Set();
  for (const layer of params?.renderModel?.layers ?? [])
    if (typeof layer.path === "string" && layer.path !== "")
      seen.add(layer.path);
  return [...seen];
}
function uvmMaterialResources(materials, maxBytes, signal) {
  const result = /* @__PURE__ */ new Map();
  for (const material of materials)
    if (material.simpleEffect !== void 0)
      result.set(material.id, material.simpleEffect.textureResource === void 0 ? [] : [material.simpleEffect.textureResource]);
    else if (material.shader?.id === RENDER_MATERIAL_SHADER)
      result.set(material.id, createStandardMaterialPrograms(material.shader.parameters, {
        budget: { maxDepth: 128, maxNodes: 1e6, maxBytes },
        ...signal === void 0 ? {} : { signal }
      }).resources);
    else if (material.shader?.id === MATERIAL_LAYERS_SHADER)
      result.set(material.id, materialLayerResources(material.shader));
  return result;
}
async function acquireUvmMaterialTextures(resources, port, maxBytes, diagnostics, signal, filters = /* @__PURE__ */ new Map(), sources = /* @__PURE__ */ new Map(), supplied = /* @__PURE__ */ new Map()) {
  const textures = [], textureIds = /* @__PURE__ */ new Map();
  let remaining = maxBytes;
  let resourceIndex = 0;
  const paths = new Set([...resources.values()].flat());
  const share = Math.max(4 * 1024 * 1024, Math.floor(maxBytes / Math.max(1, paths.size)));
  for (const path of paths) {
    signal?.throwIfAborted();
    const owned = supplied.get(path);
    if (owned !== void 0) {
      textureIds.set(path, owned.id);
      continue;
    }
    if (port === void 0)
      continue;
    const id = `uvm-material-resource-${resourceIndex++}`;
    const result = await port.read({
      ...sources.get(path) ?? {
        kind: "logical",
        requirement: {
          id,
          logicalId: path,
          role: "texture",
          scopes: [
            "sibling-directory",
            "workspace-dependency-layer",
            "current-mount",
            "enclosing-container"
          ]
        }
      },
      maxBytes: Math.min(remaining, share),
      selection: { face: "all", mipLevel: "fit" }
    }, signal);
    signal?.throwIfAborted();
    for (const item of result.diagnostics)
      diagnostics.push({
        severity: item.severity === "hint" ? "information" : item.severity,
        code: item.code,
        message: item.message
      });
    if (result.state === "unresolved" || result.state === "compressed")
      continue;
    if ([result.info.layers, result.info.depth, result.info.frames].some((count) => (count ?? 1) > 1))
      diagnostics.push({
        severity: "warning",
        code: "common.uvm/material-image-first-surface",
        message: `${path}: the material currently samples frame 0, layer 0 and slice 0; array, volume and animated image selection is not implemented.`
      });
    try {
      const cube = result.info.faces === 6;
      if (result.info.faces !== 1 && !cube)
        throw new TypeError("material image must contain one plane or six complete cube faces");
      if (cube && result.info.width !== result.info.height)
        throw new TypeError("cube faces must be square");
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
      if (surfaces.length !== result.info.faces)
        throw new TypeError("raster port did not return every requested face");
      const chosen = surfaces[0];
      const mipLevel = chosen.subresource.mipLevel;
      const { width, height } = chosen.region;
      const faceBytes = width * height * 4;
      if (faceBytes * surfaces.length > remaining)
        throw new RangeError("decoded material textures exceed budget");
      const rgba = new Uint8Array(faceBytes * surfaces.length);
      for (const [face, surface] of surfaces.entries()) {
        const selected = surface.subresource;
        if (selected.face !== face || selected.mipLevel !== mipLevel || selected.frame !== 0 || selected.layer !== 0 || selected.slice !== 0 || surface.region.width !== width || surface.region.height !== height)
          throw new TypeError("raster port returned a different subresource selection");
        rgba.set(uvmImageTexels(
          // the chosen level's size, not the image's
          {
            ...result,
            state: "decoded",
            info: { ...result.info, width, height },
            region: surface.region
          },
          { channels: "data" }
        ), face * faceBytes);
      }
      remaining -= rgba.length;
      if (mipLevel > 0)
        diagnostics.push({
          severity: "information",
          code: "common.uvm/material-image-reduced",
          message: `${path}: drawn at mip ${mipLevel} (${width}\xD7${height}) of ${result.info.width}\xD7${result.info.height} to fit the texture budget`
        });
      textureIds.set(path, id);
      const filter = filters.get(path);
      textures.push({
        id,
        width,
        height,
        rgba,
        ...filter === void 0 ? {} : { filter },
        ...cube ? { dimension: "cube" } : {},
        ...result.info.channelLayout === void 0 ? {} : { channelLayout: result.info.channelLayout },
        ...result.info.compression === void 0 ? {} : { compression: result.info.compression }
      });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "common.uvm/material-image-unrendered",
        message: `${path}: ${error instanceof Error ? error.message : "Invalid decoded image"}`
      });
    }
  }
  return {
    textures,
    bindings: (materialId) => (resources.get(materialId) ?? []).flatMap((resourceId) => {
      const textureId = textureIds.get(resourceId);
      return textureId === void 0 ? [] : [{ resourceId, textureId }];
    })
  };
}

// packages/scene/dist/uvm/render.js
function prepareUvmRender(bytes, value, options) {
  return prepareNestedUvmRender(bytes, value, options, 0);
}
function createUvmFramePreparer(bytes, options) {
  const owned = bytes.slice();
  let cache = {};
  return Object.freeze({
    prepare(request, signal) {
      if (cache === void 0)
        return Promise.reject(new TypeError("the frame preparer is disposed"));
      return prepareNestedUvmRender(owned, request, signal === void 0 ? options : { ...options, signal }, 0, cache);
    },
    dispose() {
      cache = void 0;
    }
  });
}
async function prepareNestedUvmRender(bytes, value, options, depth, cache) {
  const { budget, signal, rasterResources } = options;
  signal?.throwIfAborted();
  for (const limit of [
    budget.maxDepth,
    budget.maxNodes,
    budget.maxScalarBytes,
    budget.maxDiagnostics
  ])
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new TypeError("invalid UVM render budget");
  const input = object(snapshotJson(value, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxScalarBytes }, signal), "render request");
  if (input["schemaVersion"] !== 1 || Object.keys(input).some((key) => ![
    "schemaVersion",
    "viewport",
    "camera",
    "clipId",
    "poseSamples",
    "time",
    "collisions",
    "shadows",
    "clearColor",
    "rendererId",
    "sceneIndex",
    "modelState",
    "materialContext",
    "lighting"
  ].includes(key)))
    throw new TypeError("unsupported UVM render request");
  const viewport = object(input["viewport"], "render viewport");
  const camera = object(input["camera"], "render camera");
  const width = viewport["width"], height = viewport["height"];
  if (Object.keys(viewport).some((key) => !["width", "height"].includes(key)) || typeof width !== "number" || typeof height !== "number" || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 4096 || height > 4096)
    throw new TypeError("UVM render dimensions must be integers in 1..4096");
  const lighting = input["lighting"] ?? "unlit";
  if (lighting !== "unlit" && lighting !== "material")
    throw new TypeError("UVM render lighting must be unlit or material");
  const materialInput = object(input["materialContext"] ?? {}, "material context");
  const environment = snapshotEnvironment(materialInput["environment"]);
  if (Object.keys(materialInput).some((key) => !["teamColor", "teamColorIntensity", "ambient", "environment"].includes(key)))
    throw new TypeError("invalid material context field");
  const team = materialInput["teamColor"], teamIntensity = materialInput["teamColorIntensity"], ambient = materialInput["ambient"];
  if (teamIntensity !== void 0 && teamIntensity !== 0 && teamIntensity !== 1)
    throw new TypeError("team color intensity must be 0 or 1");
  if (team !== void 0 && (!finiteArray(team, 3) || team.some((value2) => value2 < 0 || value2 > 1)))
    throw new TypeError("team color must contain three components in 0..1");
  if (ambient !== void 0 && (!finiteArray(ambient, 4) || ambient.some((value2) => value2 < 0 || value2 > 1)))
    throw new TypeError("material ambient must contain four components in 0..1");
  const time = input["time"] ?? 0, clipId = input["clipId"], rendererId = input["rendererId"], modelState = input["modelState"] ?? "base";
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || clipId !== void 0 && (typeof clipId !== "string" || !clipId) || rendererId !== void 0 && (typeof rendererId !== "string" || !rendererId) || typeof modelState !== "string" || modelState.length === 0 || input["collisions"] !== void 0 && typeof input["collisions"] !== "boolean" || input["shadows"] !== void 0 && typeof input["shadows"] !== "boolean")
    throw new TypeError("invalid render time, clip, renderer or collision option");
  const clearColor = input["clearColor"] === void 0 ? void 0 : vector4(input["clearColor"]);
  if (clearColor?.some((component) => component < 0 || component > 1))
    throw new RangeError("render clearColor must be in 0..1");
  const frameBytes = width * height * 12;
  let textureBytes = 0;
  const textures = /* @__PURE__ */ new Map();
  for (const [index, texture] of options.textures ?? []) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(texture.width) || !Number.isSafeInteger(texture.height) || texture.width <= 0 || texture.height <= 0 || !(texture.rgba instanceof Uint8Array) || texture.rgba.length !== texture.width * texture.height * 4)
      throw new TypeError("invalid decoded UVM render texture");
    textureBytes += texture.rgba.length;
    if (frameBytes + textureBytes > budget.maxScalarBytes)
      throw new RangeError("render textures exceed budget");
    textures.set(index, { ...texture, id: `uvm-texture-${index}`, rgba: texture.rgba.slice() });
  }
  const available = budget.maxScalarBytes - frameBytes - textureBytes;
  if (available < 0)
    throw new RangeError("render frame exceeds maxScalarBytes");
  const parsed = cache?.container ?? (() => {
    const container = readUvmContainer(bytes, {
      maxInputBytes: Number(budget.maxInputBytes > 0xffffffffn ? 0xffffffffn : budget.maxInputBytes),
      maxJsonBytes: budget.maxScalarBytes,
      maxDepth: budget.maxDepth,
      maxNodes: budget.maxNodes
    }, signal);
    validateUvmDocument(container.document, {
      binaryByteLength: container.binary.length,
      ...signal === void 0 ? {} : { signal }
    });
    const read = { document: container.document, binary: container.binary };
    if (cache !== void 0)
      cache.container = read;
    return read;
  })();
  const { document, binary } = parsed;
  const units = field(document["extensions"], "UV_units");
  const metersPerSourceUnit = units === void 0 ? 1 : field(units, "metersPerSourceUnit");
  if (typeof metersPerSourceUnit !== "number" || !Number.isFinite(metersPerSourceUnit) || metersPerSourceUnit <= 0)
    throw new TypeError("UV_units.metersPerSourceUnit must be a positive finite number");
  const effectPrimitiveIds = [];
  const modelStates = readUvmModelStates(document, budget.maxScalarBytes, signal);
  const selectedModelState = modelState === "base" ? void 0 : modelStates.find((candidate) => candidate.state === modelState);
  const textureDeclarations = array(document, "textures");
  const effectDeclarations = field(document["extensions"], "UV_game_effects");
  const hasEffectTextures = ["particles", "ribbons"].some((kind) => array(effectDeclarations, kind).some((emitter) => typeof field(emitter, "texturePath") === "string"));
  const hasNestedModels = selectedModelState !== void 0 || array(field(document["extensions"], "UV_game_effects"), "particles").some((emitter) => Array.isArray(field(emitter, "modelPaths")) && field(emitter, "modelPaths").length > 0);
  const nestedBudget = options.modelResources !== void 0 && hasNestedModels ? Math.floor(available / 4) : 0;
  const sceneAvailable = available - nestedBudget;
  const rasterBudget = rasterResources === void 0 || textureDeclarations.length === 0 && !hasEffectTextures && // A material states its textures either as a game material or as the neutral layer list
  // every model facet writes; both need the raster budget, and neither is a glTF texture.
  !array(document, "materials").some((material) => uvmMaterialShader(object(material, "material")) !== void 0) ? 0 : Math.floor(sceneAvailable / 3);
  const stageBytes = Math.floor((sceneAvailable - rasterBudget) / 4);
  const samplers = array(document, "samplers");
  const samplerDiagnostics = [];
  const samplerByIndex = /* @__PURE__ */ new Map();
  const textureSampler = (index) => {
    const existing = samplerByIndex.get(index);
    if (existing !== void 0)
      return existing;
    const texture = object(textureDeclarations[safeIndex(index, textureDeclarations.length, "decoded texture")], "texture");
    const sampler = texture["sampler"] === void 0 ? {} : object(samplers[safeIndex(texture["sampler"], samplers.length, "sampler")], "sampler");
    const wrap = (axis) => {
      const mode = sampler[axis] ?? 10497;
      if (mode === 10497)
        return "repeat";
      if (mode === 33071)
        return "clamp";
      throw new TypeError(`texture ${index} ${axis} mode ${String(mode)} is not supported by the scene renderer`);
    };
    const magnified = sampler["magFilter"];
    const filter = magnified === 9728 ? "nearest" : magnified === 9729 ? "linear" : void 0;
    const settings = {
      wrapU: wrap("wrapS"),
      wrapV: wrap("wrapT"),
      ...filter === void 0 ? {} : { filter }
    };
    if (magnified !== void 0 && filter === void 0)
      samplerDiagnostics.push({
        severity: "warning",
        code: "common.uvm/texture-filter-unrendered",
        message: `Texture ${index} requests an explicit filter; the current scene contract leaves filtering to the renderer provider.`
      });
    samplerByIndex.set(index, settings);
    return settings;
  };
  const colorKeys = readUvmTextureColorKeys(document, signal);
  const alphaPolicies = readUvmTextureAlpha(document, signal);
  const keyed = (index, stored) => {
    const texels = alphaPolicies.get(index) === true ? { ...stored, rgba: opaqueTexels(stored.rgba) } : stored;
    const key = colorKeys.get(index);
    if (key === void 0)
      return texels;
    const [r, g, b] = key.color;
    return {
      ...texels,
      rgba: applyColorKeyTransparency({ width: texels.width, height: texels.height, pixels: texels.rgba }, { target: { r, g, b }, tolerance: key.tolerance }).pixels
    };
  };
  for (const [index, texels] of textures)
    textures.set(index, { ...keyed(index, texels), ...textureSampler(index) });
  const decoded = cache?.model?.stageBytes === stageBytes ? cache.model.decoded : readUvmModel(document, binary, { maxScalarBytes: stageBytes }, signal);
  if (cache !== void 0)
    cache.model = { stageBytes, decoded };
  const { scene, rig } = decoded;
  const scenes = array(document, "scenes");
  const selected = scenes.length === 0 && input["sceneIndex"] === void 0 ? void 0 : object(scenes[safeIndex(input["sceneIndex"] ?? document["scene"] ?? 0, scenes.length, "scene")], "scene");
  const activeNodes = /* @__PURE__ */ new Set();
  const allNodes = array(document, "nodes");
  const pending = [...array(selected, "nodes")];
  while (pending.length > 0) {
    signal?.throwIfAborted();
    const index = safeIndex(pending.pop(), allNodes.length, "scene node");
    const id = `node-${index}`;
    if (activeNodes.has(id))
      continue;
    activeNodes.add(id);
    pending.push(...array(allNodes[index], "children"));
  }
  const activeMeshes = new Set(scene.nodes.filter((node) => activeNodes.has(node.id)).flatMap((node) => node.meshIds));
  const meshes = scene.meshes.filter((mesh) => activeMeshes.has(mesh.id));
  const activePrimitives = new Set(meshes.flatMap((mesh) => mesh.primitiveIds));
  const catalogIds = new Map((readUvmAnimationClips(document, signal) ?? []).flatMap((entry) => entry.sourceId === void 0 ? [] : [[entry.sourceId, entry.id]]));
  const clipOf = (id) => rig.clips.find((candidate) => candidate.id === id) ?? rig.clips.find((candidate) => candidate.id === catalogIds.get(id));
  const clip = clipId === void 0 ? void 0 : clipOf(clipId);
  if (clipId !== void 0 && clip === void 0)
    throw new TypeError(`unknown UVM animation clip: ${clipId}`);
  const requestedPoses = input["poseSamples"];
  const poseSamples = readUvmPoseSamples(Array.isArray(requestedPoses) ? requestedPoses.map((sample2) => {
    const id = field(sample2, "clipId");
    const canonical = typeof id === "string" ? clipOf(id)?.id : void 0;
    return canonical === void 0 || canonical === id ? sample2 : { ...object(sample2, "pose sample"), clipId: canonical };
  }) : requestedPoses, rig.clips);
  const visible = new Map(readUvmPrimitiveVisibility(document, signal).map((item) => [
    "node" in item ? `node-${item.node}` : `mesh-${item.mesh}-primitive-${item.primitive}`,
    item.value > 0
  ]));
  const visibilityChannels = clip?.channels.filter((channel) => channel.kind === "visibility") ?? [];
  if (clip !== void 0 && visibilityChannels.length > 0) {
    const visibilitySampler = createModelAnimationSampler({ ...clip, channels: visibilityChannels }, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: stageBytes }, signal);
    for (const sampled of visibilitySampler.sample(time, signal))
      visible.set(sampled.target, (sampled.value[0] ?? 0) > 0);
  }
  const sequence = clip?.sequenceIndex;
  if (sequence !== void 0 && (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0))
    throw new TypeError("invalid material source sequence index");
  const materialContext = {
    sceneLighting: true,
    time,
    sequenceTime: time,
    ...sequence === void 0 ? {} : { sequenceIndex: sequence },
    ...team === void 0 ? {} : { teamColor: [team[0] ?? 0, team[1] ?? 0, team[2] ?? 0] },
    ...teamIntensity === void 0 ? {} : { teamColorIntensity: teamIntensity },
    ...ambient === void 0 ? {} : { ambient: vector4(ambient) },
    ...environment === void 0 ? {} : { environment }
  };
  const cameraPose = camera["node"] === void 0 ? /* @__PURE__ */ new Map() : createModelSceneSampler({
    nodes: scene.nodes.map((node) => ({ ...node, meshIds: [] })),
    meshes: [],
    primitives: [],
    skeleton: rig.bindings,
    nodePoses: rig.nodePoses
  }, {
    maxBytes: stageBytes,
    ...poseSamples === void 0 ? {} : { poseSamples, poseTime: time },
    ...clip === void 0 ? {} : {
      clip: {
        ...clip,
        channels: clip.channels.filter((channel) => channel.kind !== "visibility")
      }
    },
    ...signal === void 0 ? {} : { signal }
  }).sample(time, signal).nodeTransforms;
  const { viewProjection, viewMatrix, eyePosition } = resolveUvmCamera(document, camera, {
    aspect: width / height,
    nodeTransforms: cameraPose,
    activeNodes,
    maxBytes: stageBytes,
    maxNodes: budget.maxNodes,
    time,
    ...clip?.sequenceIndex === void 0 ? {} : { sequenceIndex: clip.sequenceIndex },
    ...signal === void 0 ? {} : { signal }
  });
  const billboards = readUvmBillboards(document, stageBytes, signal);
  const billboardOptions = {
    billboards,
    ...eyePosition === void 0 ? {} : { billboardCameraPosition: eyePosition },
    ...viewMatrix === void 0 ? {} : { billboardCameraRotation: billboardCameraRotation(Array.from(viewMatrix)) }
  };
  const sample = createModelSceneSampler({
    nodes: scene.nodes.map((node) => activeNodes.has(node.id) ? node : { ...node, meshIds: [] }),
    meshes,
    // visibility is decided above, from the stored values and this clip: what passes is drawn
    primitives: scene.primitives.filter((primitive) => activePrimitives.has(primitive.id) && visible.get(primitive.id) !== false).map(({ hidden: _hidden, ...primitive }) => primitive),
    skeleton: rig.bindings,
    nodePoses: rig.nodePoses
  }, {
    maxBytes: stageBytes * 2,
    ...poseSamples === void 0 ? {} : { poseSamples, poseTime: time },
    ...billboardOptions,
    ...clip === void 0 ? {} : {
      clip: visibilityChannels.length === 0 ? clip : {
        ...clip,
        channels: clip.channels.filter((channel) => channel.kind !== "visibility")
      }
    },
    ...signal === void 0 ? {} : { signal }
  }).sample(time, signal);
  const sceneLights = readUvmSceneLights(document, sample.nodeTransforms, activeNodes, {
    maxBytes: stageBytes,
    maxNodes: budget.maxNodes,
    time,
    ...clip?.sequenceIndex === void 0 ? {} : { sequenceIndex: clip.sequenceIndex },
    ...signal === void 0 ? {} : { signal }
  });
  const diagnostics = [...sample.diagnostics];
  const warn = (code, message) => diagnostics.push({ severity: "warning", code, message });
  if (modelState !== "base" && selectedModelState === void 0)
    warn("common.uvm/model-state-unrendered", `Model state ${modelState} is not declared; the base scene is retained.`);
  const provenance = field(document["extensions"], "UV_provenance");
  let importNotes = 0;
  for (const key of ["warnings", "lost"]) {
    const notes = field(provenance, key);
    if (notes === void 0)
      continue;
    if (!Array.isArray(notes))
      throw new TypeError(`UV_provenance.${key} must be an array`);
    importNotes += notes.length;
    if (importNotes > budget.maxDiagnostics)
      throw new RangeError("UVM import diagnostics exceed maxDiagnostics");
    for (const note of notes) {
      signal?.throwIfAborted();
      if ((typeof note !== "string" || !note.trim()) && (note === null || typeof note !== "object" || Array.isArray(note)))
        throw new TypeError(`UV_provenance.${key} requires text or a diagnostic object`);
      const severity = field(note, "severity");
      diagnostics.push({
        severity: severity === "error" ? "error" : severity === "info" ? "information" : "warning",
        code: key === "lost" ? "common.uvm/import-loss" : "common.uvm/import-warning",
        message: typeof note === "string" ? note : JSON.stringify(note)
      });
    }
  }
  const materialUv = /* @__PURE__ */ new Map();
  const materialTextures = /* @__PURE__ */ new Map();
  const materials = array(document, "materials").map((candidate, index) => {
    const material = object(candidate, "render material");
    if (material["doubleSided"] !== void 0 && typeof material["doubleSided"] !== "boolean")
      throw new TypeError("material doubleSided must be boolean");
    const pbr = object(material["pbrMetallicRoughness"] ?? {}, "PBR material");
    const baseColor = pbr["baseColorFactor"] === void 0 ? [1, 1, 1, 1] : vector4(pbr["baseColorFactor"]);
    if (baseColor.some((component) => component < 0 || component > 1))
      throw new RangeError("material baseColorFactor must be in 0..1");
    const texture = pbr["baseColorTexture"] === void 0 ? void 0 : object(pbr["baseColorTexture"], "base color texture");
    const textureIndex = texture === void 0 ? void 0 : safeIndex(texture["index"], array(document, "textures").length, "texture");
    const alphaMode = material["alphaMode"] ?? "OPAQUE";
    if (alphaMode !== "OPAQUE" && alphaMode !== "MASK" && alphaMode !== "BLEND")
      throw new TypeError(`Material ${index} alphaMode is invalid`);
    const alphaCutoff = material["alphaCutoff"] ?? 0.5;
    if (typeof alphaCutoff !== "number" || !Number.isFinite(alphaCutoff) || alphaCutoff < 0)
      throw new TypeError(`Material ${index} alphaCutoff must be finite and nonnegative`);
    const texCoord = texture?.["texCoord"] ?? 0;
    if (typeof texCoord !== "number" || !Number.isInteger(texCoord) || texCoord < 0 || texCoord > 4)
      throw new TypeError("render texture coordinate must be in 0..4");
    if (textureIndex !== void 0) {
      materialUv.set(`material-${index}`, texCoord);
      materialTextures.set(`material-${index}`, textureIndex);
    }
    if (texture !== void 0 && field(texture["extensions"], "KHR_texture_transform") !== void 0)
      warn("common.uvm/texture-transform-unrendered", `Material ${index} texture transform is preserved but not rendered.`);
    const shader = uvmMaterialShader(material);
    const unlit = field(material["extensions"], "KHR_materials_unlit") !== void 0;
    const lit = lighting === "material" && !unlit ? uvmMaterialPbr(material, texCoord) : void 0;
    if (lit === void 0 && shader === void 0 && !unlit)
      warn("common.uvm/pbr-lighting-unrendered", `Material ${index} is rendered without PBR lighting by the current base-color scene route.`);
    if (lit !== void 0)
      for (const reason of lit.unrendered)
        warn("common.uvm/material-features-unrendered", `Material ${index} ${reason}.`);
    else if (material["normalTexture"] !== void 0 || material["emissiveTexture"] !== void 0 || pbr["metallicRoughnessTexture"] !== void 0)
      warn("common.uvm/material-features-unrendered", `Material ${index} uses shading features beyond the current base-color scene contract.`);
    const team2 = uvmMaterialTeamColor(material, texCoord);
    if (team2.unrendered !== void 0)
      warn("common.uvm/team-color-unrendered", `Material ${index} team colour is not drawn: ${team2.unrendered}.`);
    const simpleEffect = uvmMaterialBlendEffect(material, () => {
      const { wrapU, wrapV } = textureIndex === void 0 ? { wrapU: "repeat", wrapV: "repeat" } : textureSampler(textureIndex);
      return { wrapU: wrapU ?? "repeat", wrapV: wrapV ?? "repeat" };
    });
    return {
      id: `material-${index}`,
      baseColor,
      alphaMode: alphaMode === "OPAQUE" ? "opaque" : alphaMode === "MASK" ? "mask" : "blend",
      alphaCutoff,
      shading: lit !== void 0 && simpleEffect === void 0 ? "pbr" : "unlit",
      ...lit === void 0 || simpleEffect !== void 0 ? {} : { pbr: lit.pbr },
      ...textureIndex === void 0 ? {} : { baseColorTexture: `uvm-texture-${textureIndex}` },
      doubleSided: material["doubleSided"] === true,
      ...uvmMaterialDrawOrder(material),
      ...team2.teamColor === void 0 ? {} : { teamColor: team2.teamColor },
      ...shader === void 0 ? {} : { shader },
      ...simpleEffect === void 0 ? {} : { simpleEffect }
    };
  });
  materials.push({
    id: "uvm-default",
    baseColor: [1, 1, 1, 1],
    shading: "unlit",
    doubleSided: false
  });
  const primitives = sample.primitives.map((source) => {
    const primitive = source.materialId === void 0 ? { ...source, materialId: "uvm-default" } : source;
    const channel = materialUv.get(primitive.materialId ?? "") ?? 0;
    const uv = primitive.textureCoordinateSets?.find((set) => set.set === channel)?.coordinates ?? (channel === 0 ? primitive.textureCoordinates : void 0);
    if (materialUv.has(primitive.materialId ?? "") && uv === void 0)
      throw new TypeError(`primitive ${primitive.id} lacks TEXCOORD_${channel}`);
    return uv === void 0 ? primitive : { ...primitive, textureCoordinates: uv };
  });
  let modelParticles = [];
  if (field(document["extensions"], "UV_game_effects") !== void 0) {
    const projectorReceivers = primitives.slice();
    const effectPose = createModelSceneSampler({
      nodes: scene.nodes.map((node) => ({ ...node, meshIds: [] })),
      meshes: [],
      primitives: [],
      skeleton: rig.bindings,
      nodePoses: rig.nodePoses
    }, {
      maxBytes: stageBytes,
      ...billboardOptions,
      ...poseSamples === void 0 ? {} : { poseSamples, poseTime: time },
      ...clip === void 0 ? {} : {
        clip: {
          ...clip,
          channels: clip.channels.filter((channel) => channel.kind !== "visibility")
        }
      },
      ...signal === void 0 ? {} : { signal }
    });
    const effects = createUvmEffectFrame(document, {
      projectorsHandled: true,
      ...options.effectCollisionProvider === void 0 ? {} : { collisionProvider: options.effectCollisionProvider },
      binary,
      time,
      ...sequence === void 0 ? {} : { sequenceIndex: sequence },
      materials,
      activeNodes,
      maxBytes: stageBytes,
      maxNodes: budget.maxNodes,
      maxDiagnostics: budget.maxDiagnostics,
      nodeTransformsAt: (time2) => effectPose.sample(time2, signal).nodeTransforms,
      ...viewMatrix === void 0 ? {} : { viewMatrix },
      ...signal === void 0 ? {} : { signal }
    });
    primitives.push(...effects.primitives);
    effectPrimitiveIds.push(...effects.primitives.map((primitive) => primitive.id));
    modelParticles = effects.modelParticles;
    materials.push(...effects.materials);
    diagnostics.push(...effects.diagnostics);
    const projected = createUvmProjectorFrame(document, {
      receivers: projectorReceivers,
      collisionSplats: effects.collisionSplats,
      nodeTransforms: sample.nodeTransforms,
      activeNodes,
      materials,
      time,
      ...sequence === void 0 ? {} : { sequenceIndex: sequence },
      maxBytes: stageBytes - effects.collisionSplats.length * 256 - effects.primitives.reduce((sum, primitive) => sum + primitive.positions.byteLength + (primitive.indices?.byteLength ?? 0) + (primitive.textureCoordinates?.byteLength ?? 0) + (primitive.colors?.byteLength ?? 0), 0),
      maxNodes: budget.maxNodes - effects.primitives.length - effects.collisionSplats.length,
      warn: (message) => warn("common.uvm/projector-preview-limitation", message),
      ...signal === void 0 ? {} : { signal }
    });
    primitives.push(...projected.primitives);
    effectPrimitiveIds.push(...projected.primitives.map((primitive) => primitive.id));
    materials.push(...projected.materials);
  }
  if (input["collisions"] === true) {
    const overlay = createUvmCollisionOverlay(document, binary, { maxScalarBytes: stageBytes }, signal);
    primitives.push(...overlay.sample(sample.nodeTransforms, signal, activeNodes));
    diagnostics.push(...overlay.diagnostics);
    materials.push({
      id: "uvm-collision-overlay",
      baseColor: [0.9, 0.65, 0.15, 1],
      doubleSided: true
    });
  }
  if (input["shadows"] === true) {
    const shadowBindings = readUvmShadowMeshBindings(document);
    const meshesById = new Map(scene.meshes.map((mesh) => [mesh.id, mesh]));
    const primitivesById = new Map(scene.primitives.map((primitive) => [primitive.id, primitive]));
    for (const [ordinal, binding] of shadowBindings.entries()) {
      const mesh = meshesById.get(`mesh-${binding.mesh}`);
      const transform = sample.nodeTransforms.get(`node-${binding.node}`);
      if (mesh === void 0)
        throw new TypeError("UVM shadow mesh binding is not renderable");
      if (transform === void 0)
        continue;
      for (const primitiveId of mesh.primitiveIds) {
        const primitive = primitivesById.get(primitiveId);
        if (primitive === void 0 || primitive.topology !== "triangles")
          throw new TypeError("UVM shadow mesh requires triangle primitives");
        primitives.push({
          id: `uvm-shadow-${ordinal}-${primitive.id}`,
          topology: "triangles",
          positions: primitive.positions,
          ...primitive.indices === void 0 ? {} : { indices: primitive.indices },
          transform,
          materialId: "uvm-shadow-overlay"
        });
      }
    }
    if (shadowBindings.length > 0)
      materials.push({
        id: "uvm-shadow-overlay",
        baseColor: [0.65, 0.12, 0.8, 0.45],
        alphaMode: "blend",
        doubleSided: true,
        shading: "unlit"
      });
  }
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const drawnTextures = (materialId) => {
    const material = materialById.get(materialId ?? "");
    const mask = material?.teamColor?.mask;
    return [
      materialTextures.get(materialId ?? "") ?? documentTextureIndex(material?.baseColorTexture),
      mask === void 0 || mask === "whole" ? void 0 : documentTextureIndex(mask.texture),
      documentTextureIndex(material?.pbr?.metallicRoughnessTexture),
      documentTextureIndex(material?.pbr?.occlusionTexture),
      documentTextureIndex(material?.pbr?.emissiveTexture),
      documentTextureIndex(material?.pbr?.normalTexture)
    ].filter((index) => index !== void 0);
  };
  const usedTextures = new Set(primitives.flatMap((primitive) => drawnTextures(primitive.materialId)));
  const images = rasterResources === void 0 ? [] : prepareUvmTextureImages(document, binary, [...usedTextures].filter((index) => !textures.has(index)), Math.floor(rasterBudget / 2), signal);
  for (const image of images)
    textureSampler(image.texture);
  const activeMaterials = new Set(primitives.map((primitive) => primitive.materialId));
  const materialResources = uvmMaterialResources(materials.filter((material) => activeMaterials.has(material.id)), stageBytes, signal);
  const requestedResources = new Set([...materialResources.values()].flat());
  const resourceImages = /* @__PURE__ */ new Map();
  for (const [index] of array(document, "images").entries()) {
    const id = uvmImageResourceId(document, index);
    if (!requestedResources.has(id))
      continue;
    if (resourceImages.has(id))
      throw new TypeError(`ambiguous UVM material image identity: ${id}`);
    resourceImages.set(id, index);
  }
  const suppliedResources = /* @__PURE__ */ new Map();
  for (const [index, texture] of textures) {
    const source = object(array(document, "textures")[index], "texture")["source"];
    if (typeof source === "number") {
      const id = uvmImageResourceId(document, source);
      if (requestedResources.has(id) && suppliedResources.has(id))
        throw new TypeError(`ambiguous supplied UVM material texture identity: ${id}`);
      suppliedResources.set(id, texture);
    }
  }
  const capturedImages = new Map(images.map((image) => [image.image, image]));
  const materialImageIndices = [...resourceImages].flatMap(([id, index]) => !suppliedResources.has(id) && !capturedImages.has(index) ? [index] : []);
  const capturedBytes = [...capturedImages.values()].reduce((sum, image) => sum + (image.source.kind === "embedded" ? image.source.bytes.length : 0), 0);
  const materialImages = rasterResources === void 0 ? [] : prepareUvmImages(document, binary, materialImageIndices, Math.floor(rasterBudget / 2) - capturedBytes, signal);
  for (const image of materialImages)
    capturedImages.set(image.image, image);
  const materialImageSources = new Map([...resourceImages].flatMap(([id, index]) => {
    const image = capturedImages.get(index);
    return image === void 0 ? [] : [[id, image.source]];
  }));
  diagnostics.push(...samplerDiagnostics);
  let remainingDecodedBytes = Math.floor(rasterBudget / 2);
  const acquiredMaterials = await acquireUvmMaterialTextures(materialResources, rasterResources, remainingDecodedBytes, diagnostics, signal, uvmImageFilters(document), materialImageSources, suppliedResources);
  for (const texture of acquiredMaterials.textures)
    remainingDecodedBytes -= texture.rgba.length;
  const drawnByShader = new Set(materials.filter((material) => material.shader?.id === RENDER_MATERIAL_SHADER && (materialResources.get(material.id) ?? []).length === acquiredMaterials.bindings(material.id).length).map((material) => material.id));
  const fallbackTextures = new Set(primitives.flatMap((primitive) => drawnByShader.has(primitive.materialId ?? "") ? [] : drawnTextures(primitive.materialId)));
  const decodedImages = /* @__PURE__ */ new Map();
  const failedImages = /* @__PURE__ */ new Set();
  for (const image of images) {
    signal?.throwIfAborted();
    if (!fallbackTextures.has(image.texture) || failedImages.has(image.image))
      continue;
    let decoded2 = decodedImages.get(image.image);
    if (decoded2 === void 0 && rasterResources !== void 0) {
      const result = await rasterResources.read({ ...image.source, maxBytes: remainingDecodedBytes }, signal);
      signal?.throwIfAborted();
      for (const item of result.diagnostics)
        diagnostics.push({
          severity: item.severity === "hint" ? "information" : item.severity,
          code: item.code,
          message: item.message
        });
      if (result.state === "decoded") {
        try {
          if (result.info.width * result.info.height * 4 > remainingDecodedBytes)
            throw new RangeError("decoded UVM images exceed budget");
          const rgba = uvmImageTexels(result);
          remainingDecodedBytes -= rgba.length;
          decoded2 = { width: result.info.width, height: result.info.height, rgba };
          decodedImages.set(image.image, decoded2);
        } catch (error) {
          warn("common.uvm/image-unrendered", error instanceof Error ? error.message : "Invalid decoded image");
        }
      }
    }
    if (decoded2 === void 0) {
      failedImages.add(image.image);
      continue;
    }
    textures.set(image.texture, {
      ...keyed(image.texture, decoded2),
      id: `uvm-texture-${image.texture}`,
      ...textureSampler(image.texture)
    });
  }
  for (const index of fallbackTextures)
    if (!textures.has(index))
      warn("common.uvm/texture-unresolved", `Texture ${index} has no decoded texels available from the resource host.`);
  const request = {
    outputKind: "rgba8",
    viewport: { width, height },
    camera: {
      viewProjection,
      ...viewMatrix === void 0 ? {} : { viewMatrix },
      ...eyePosition === void 0 ? {} : { eyePosition }
    },
    scene: {
      ...sceneLights ?? {},
      light: previewKeyLight(viewMatrix),
      primitives,
      materials: materials.filter((material) => activeMaterials.has(material.id)).map((material) => ({
        ...material,
        textureBindings: acquiredMaterials.bindings(material.id)
      })),
      textures: [...textures.values(), ...acquiredMaterials.textures],
      materialContext
    },
    ...clearColor === void 0 ? {} : { clearColor },
    ...signal === void 0 ? {} : { signal }
  };
  const modelStateNested = await composeModelParticles(selectedModelState === void 0 ? [] : [
    {
      path: selectedModelState.model,
      emitterIndex: 0,
      slot: 0,
      ageSeconds: time,
      position: [0, 0, 0],
      right: [1, 0, 0],
      up: [0, 1, 0],
      forward: [0, 0, 1],
      scale: [1, 1, 1],
      color: [1, 1, 1, 1],
      swapYZ: false,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    }
  ], request, options, depth, nestedBudget, prepareNestedUvmRender, { id: "model-state", label: "Model states", prefix: "model-state" });
  const stateApplied = modelStateNested.composedInstances > 0;
  const nested = await composeModelParticles(stateApplied ? [] : modelParticles, request, options, depth, nestedBudget, prepareNestedUvmRender);
  if (diagnostics.length + modelStateNested.diagnostics.length + nested.diagnostics.length > budget.maxDiagnostics)
    throw new RangeError("UVM render diagnostics exceed maxDiagnostics");
  const basePrimitives = stateApplied ? modelStateNested.primitives : request.scene.primitives;
  const baseMaterials = stateApplied ? modelStateNested.materials : request.scene.materials ?? [];
  const baseTextures = stateApplied ? modelStateNested.textures : request.scene.textures ?? [];
  return {
    request: {
      ...request,
      scene: {
        ...request.scene,
        primitives: [...basePrimitives, ...nested.primitives],
        materials: [...baseMaterials, ...nested.materials],
        textures: [...baseTextures, ...nested.textures]
      }
    },
    diagnostics: [...diagnostics, ...modelStateNested.diagnostics, ...nested.diagnostics],
    ...rendererId === void 0 ? {} : { rendererId },
    metersPerSourceUnit,
    effectPrimitiveIds: [
      ...effectPrimitiveIds,
      ...nested.primitives.map((primitive) => primitive.id)
    ]
  };
}
function previewKeyLight(viewMatrix) {
  const local = [-0.35, 0.75, 0.55];
  const direction = viewMatrix === void 0 ? [0.35, 0.85, 0.4] : (
    // Inverse of the view rotation is its transpose (column-major rows become columns).
    [0, 1, 2].map((axis) => local.reduce((sum, value, row) => sum + value * (viewMatrix[axis * 4 + row] ?? 0), 0))
  );
  return {
    direction,
    ambient: 0.55,
    color: [0.8, 0.8, 0.8, 1]
  };
}
async function renderUvm(bytes, value, options) {
  const { request, diagnostics, rendererId } = await prepareUvmRender(bytes, value, options);
  const { signal } = options;
  const { width, height } = request.viewport;
  const lease = await options.contracts.resolve({
    contract: SCENE_RENDERER_CONTRACT,
    major: 1,
    facet: { outputKind: "rgba8", ...rendererId === void 0 ? {} : { rendererId } },
    ...signal === void 0 ? {} : { signal }
  });
  try {
    signal?.throwIfAborted();
    const frame = await lease.value.render(request);
    signal?.throwIfAborted();
    if (frame.outputKind !== "rgba8" || frame.width !== width || frame.height !== height || !(frame.rgba instanceof Uint8Array) || frame.rgba.length !== width * height * 4)
      throw new TypeError("scene renderer returned an invalid frame");
    return {
      ...frame,
      rgba: frame.rgba.slice(),
      statistics: { ...frame.statistics },
      diagnostics: Object.freeze([...diagnostics, ...frame.diagnostics].map((item) => Object.freeze({ ...item })))
    };
  } finally {
    await lease.release();
  }
}
async function renderUvmPng(bytes, request, options) {
  const frame = await renderUvm(bytes, request, options);
  for (const item of frame.diagnostics)
    options.reportDiagnostic?.(diagnostic(item.severity, item.code, item.message, void 0, item.primitiveId === void 0 ? void 0 : { primitiveId: item.primitiveId }));
  return { kind: "bytes", value: await encodeRgbaPng(frame, options.signal) };
}
function documentTextureIndex(id) {
  const match = id === void 0 ? null : /^uvm-texture-(0|[1-9]\d*)$/u.exec(id);
  return match === null ? void 0 : Number(match[1]);
}
export {
  createUvmFramePreparer,
  prepareUvmRender,
  renderUvm,
  renderUvmPng
};
