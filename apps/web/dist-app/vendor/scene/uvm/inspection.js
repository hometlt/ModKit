import {
  createProjectionReceipt
} from "../../../chunks/chunk-ZC6AMIVY.js";
import {
  readCollisionMesh,
  readUvmModel,
  uvmImageResourceId
} from "../../../chunks/chunk-6MHUSL7M.js";
import {
  createJsonTreeSource
} from "../../../chunks/chunk-KA3J6DLB.js";
import {
  array,
  field,
  nonBlank,
  object,
  required,
  safeIndex,
  string
} from "../../../chunks/chunk-I4Z5J3HX.js";
import "../../../chunks/chunk-OAFBQXD6.js";
import {
  validateUvmDocument
} from "../../../chunks/chunk-OLH77CRA.js";
import "../../../chunks/chunk-3TRK5GFM.js";
import {
  createModelAnimationSource,
  createModelCollisionSource,
  createModelMaterialSource,
  createModelSceneSource,
  createModelSkeletonSource,
  createModelSocketSource
} from "../../../chunks/chunk-FUAGPPGY.js";
import "../../../chunks/chunk-IBG4CEKN.js";
import "../../../chunks/chunk-I675VFQQ.js";
import "../../../chunks/chunk-D6GLIKYJ.js";
import {
  animationSnapshotBudget
} from "../../../chunks/chunk-IJPXHLGV.js";
import "../../../chunks/chunk-ZSDVUSRM.js";
import "../../../chunks/chunk-5SBJANAJ.js";
import "../../../chunks/chunk-TKIPZ6HV.js";
import "../../../chunks/chunk-NUFRM6SI.js";
import "../../../chunks/chunk-W2UBWFML.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/scene/dist/uvm/facets.js
function axis(value) {
  if (value === "+x" || value === "-x" || value === "+y" || value === "-y" || value === "+z" || value === "-z")
    return value;
  throw new TypeError("invalid UVM socket axis");
}
function readUvmFacets(document, binary, budget, signal) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError("invalid UVM scalar budget");
  return Object.freeze({
    collisions: decodeCollisions(document, binary, budget, signal),
    teamColors: decodeTeamColors(document),
    advancedMaterials: decodeAdvancedMaterials(document),
    effects: decodeEffects(document),
    sockets: decodeSockets(document),
    materialRefs: decodeMaterialRefs(document)
  });
}
function decodeSockets(document) {
  const sockets = [];
  for (const [nodeIndex, candidate] of array(document, "nodes").entries()) {
    const node = object(candidate, `node ${nodeIndex}`);
    const extension = field(node["extensions"], "UV_game_socket");
    if (extension === void 0)
      continue;
    const socket = object(extension, `node ${nodeIndex} UV_game_socket`);
    const identity = field(socket["extras"], "modkit");
    sockets.push({
      id: nonBlank(field(identity, "id")) ? string(field(identity, "id"), "socket id") : `uvm-socket-${nodeIndex}`,
      // Publisher ids remain in extras. The live target must join the actual reopened scene,
      // whose node ids are positional; restoring an old native id would orphan the socket.
      nodeId: `node-${nodeIndex}`,
      role: string(socket["role"], "socket role"),
      ...typeof socket["sourceName"] === "string" ? { sourceName: socket["sourceName"] } : {},
      ...socket["forward"] === void 0 || socket["up"] === void 0 ? {} : { orientation: { forward: axis(socket["forward"]), up: axis(socket["up"]) } }
    });
  }
  return Object.freeze(sockets);
}
function decodeCollisions(document, binary, budget, signal) {
  const byKind = /* @__PURE__ */ Object.create(null);
  const volumes = [];
  let total = 0;
  let scalarBytes = 0;
  for (const [nodeIndex, nodeCandidate] of array(document, "nodes").entries()) {
    const node = object(nodeCandidate, `node ${nodeIndex}`);
    const extension = field(node["extensions"], "UV_game_collision");
    if (extension === void 0)
      continue;
    for (const [shapeIndex, shapeCandidate] of array(object(extension, "UV_game_collision"), "shapes").entries()) {
      const shape = object(shapeCandidate, `node ${nodeIndex} collision shape ${shapeIndex}`);
      if (shape["kind"] === "convex-hull" || shape["kind"] === "mesh") {
        const mesh = readCollisionMesh(document, binary, shape, { maxScalarBytes: budget.maxScalarBytes - scalarBytes }, signal);
        scalarBytes += mesh.scalarBytes;
      }
      total += 1;
      const kind = string(shape["kind"], "collision kind");
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      const meshId = collisionNodeMesh(node);
      const role = extensionRole(extension);
      volumes.push(Object.freeze({
        id: `node-${nodeIndex}-collision-${shapeIndex}`,
        kind,
        origin: "declared-volume",
        ...meshId === void 0 ? {} : { meshId },
        ...role !== void 0 ? { types: Object.freeze([role]) } : {}
      }));
    }
  }
  return Object.freeze({ total, byKind: Object.freeze(byKind), volumes: Object.freeze(volumes) });
}
function collisionNodeMesh(node) {
  return typeof node["mesh"] === "number" ? `mesh-${node["mesh"]}` : void 0;
}
function extensionRole(extension) {
  const role = object(extension, "UV_game_collision")["role"];
  return typeof role === "string" ? role : void 0;
}
function materialImageLayers(document, material) {
  const pbr = material["pbrMetallicRoughness"] === void 0 ? {} : object(material["pbrMetallicRoughness"], "PBR material");
  const textures = array(document, "textures"), images = array(document, "images");
  const layers = [];
  for (const [slot, reference] of [
    ["baseColor", pbr["baseColorTexture"]],
    ["metallicRoughness", pbr["metallicRoughnessTexture"]],
    ["normal", material["normalTexture"]],
    ["emissive", material["emissiveTexture"]],
    ["occlusion", material["occlusionTexture"]]
  ]) {
    if (reference === void 0)
      continue;
    const binding = object(reference, `${slot} texture`);
    const texture = object(textures[safeIndex(binding["index"], textures.length, "texture")], "texture");
    const image = safeIndex(texture["source"], images.length, "texture image");
    const uvSource = binding["texCoord"] ?? 0;
    if (typeof uvSource !== "number" || !Number.isSafeInteger(uvSource) || uvSource < 0)
      throw new TypeError("material texture texCoord must be a nonnegative integer");
    layers.push(Object.freeze({ slot, resourceId: uvmImageResourceId(document, image), uvSource }));
  }
  return Object.freeze(layers);
}
function decodeMaterialRefs(document) {
  return array(document, "materials").map((candidate, index) => {
    const material = object(candidate, `material ${index}`);
    const contracts = [];
    const snapshot = field(field(field(material["extensions"], "UV_game_material"), "params"), "renderModel");
    if (field(snapshot, "version") === 1) {
      if (field(snapshot, "standard") !== void 0)
        contracts.push("UV_game_material/standard");
      if (field(snapshot, "composite") !== void 0)
        contracts.push("UV_game_material/composite");
    }
    if (field(material["extensions"], "UV_game_material_team_color") !== void 0) {
      contracts.push("UV_game_material_team_color");
    }
    const stored = field(field(material["extras"], "modkit"), "material");
    let fields = {};
    if (stored !== void 0) {
      const metadata = object(stored, `material ${index} Modkit metadata`);
      if (metadata["version"] !== 1)
        throw new TypeError(`material ${index} has unsupported Modkit metadata version`);
      fields = object(metadata["fields"], `material ${index} Modkit fields`);
      for (const key of ["id", "name", "shader", "contracts", "alphaMode", "alphaCutoff"]) {
        if (Object.hasOwn(fields, key))
          throw new TypeError(`material ${index} metadata shadows ${key}`);
      }
    }
    const storedAlphaMode = material["alphaMode"];
    const alphaMode = storedAlphaMode === void 0 ? void 0 : storedAlphaMode === "MASK" ? "mask" : storedAlphaMode === "BLEND" ? "blend" : "opaque";
    const alphaCutoff = material["alphaCutoff"];
    if (alphaCutoff !== void 0 && (typeof alphaCutoff !== "number" || !Number.isFinite(alphaCutoff) || alphaCutoff < 0)) {
      throw new TypeError(`material ${index} alphaCutoff must be finite and nonnegative`);
    }
    const layers = fields["layers"] === void 0 ? materialImageLayers(document, material) : [];
    return Object.freeze({
      ...fields,
      ...layers.length === 0 ? {} : { layers },
      // the identity the artifact binding fixes, so a primitive and its material can be joined
      id: `material-${index}`,
      ...typeof material["name"] === "string" ? { name: material["name"] } : {},
      ...alphaMode === void 0 ? {} : { alphaMode },
      ...alphaMode !== "mask" ? {} : { alphaCutoff: typeof alphaCutoff === "number" ? alphaCutoff : 0.5 },
      ...contracts.length === 0 ? {} : { contracts: Object.freeze(contracts) },
      ...field(material["extensions"], "UV_game_material") === void 0 ? {} : {
        shader: {
          id: string(field(field(material["extensions"], "UV_game_material"), "shader"), "shader identity"),
          parameters: object(field(field(material["extensions"], "UV_game_material"), "params") ?? {}, "UVM shader parameters")
        }
      }
    });
  });
}
function decodeTeamColors(document) {
  const byOperation = /* @__PURE__ */ Object.create(null);
  let total = 0;
  for (const candidate of array(document, "materials")) {
    const material = object(candidate, "UVM material");
    const extension = field(material["extensions"], "UV_game_material_team_color");
    if (extension === void 0)
      continue;
    const teamColor = object(extension, "UV_game_material_team_color");
    const remap = field(teamColor["extras"], "renderModel");
    const operation = string(field(remap, "operation") ?? (teamColor["blend"] === "replace" ? "replace" : "multiply"), "team color operation");
    total += 1;
    byOperation[operation] = (byOperation[operation] ?? 0) + 1;
  }
  return Object.freeze({ total, byOperation: Object.freeze(byOperation) });
}
function decodeAdvancedMaterials(document) {
  const byContract = { standard: 0, composite: 0 };
  let total = 0;
  for (const candidate of array(document, "materials")) {
    const material = object(candidate, "UVM material");
    const snapshot = field(field(field(material["extensions"], "UV_game_material"), "params"), "renderModel");
    if (field(snapshot, "version") !== 1)
      continue;
    let represented = false;
    if (field(snapshot, "standard") !== void 0) {
      byContract.standard += 1;
      represented = true;
    }
    if (field(snapshot, "composite") !== void 0) {
      byContract.composite += 1;
      represented = true;
    }
    if (represented)
      total += 1;
  }
  return Object.freeze({ total, byContract: Object.freeze(byContract) });
}
function decodeEffects(document) {
  const extension = field(document["extensions"], "UV_game_effects");
  if (extension === void 0) {
    return Object.freeze({ total: 0, profile: void 0, byKind: Object.freeze({}), animated: 0 });
  }
  const effects = object(extension, "UV_game_effects");
  const byKind = /* @__PURE__ */ Object.create(null);
  let total = 0;
  for (const kind of ["particles", "ribbons", "forces", "warps", "projectors"]) {
    const count = array(effects, kind).length;
    byKind[kind] = count;
    total += count;
  }
  let animated = 0;
  for (const candidate of array(document, "animations")) {
    const animation = object(candidate, "UVM animation");
    animated += array(animation, "channels").filter((channel) => {
      const target = field(channel, "target");
      return field(target, "path") === "pointer" && field(field(target, "extensions"), "KHR_animation_pointer") !== void 0;
    }).length;
  }
  return Object.freeze({
    total,
    profile: string(effects["profile"] ?? "common", "effects profile"),
    byKind: Object.freeze(byKind),
    animated
  });
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/inspection.js
var UVM_BASIS = Object.freeze({
  handedness: "right",
  upAxis: "y",
  forwardAxis: "-z",
  unit: "meter",
  metersPerUnit: 1
});
function countJsonNodes(value, budget, signal) {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    signal?.throwIfAborted();
    const current = required(pending.pop(), "JSON node");
    if (++nodes > budget.maxNodes)
      throw new RangeError("UVM JSON exceeds maxNodes budget");
    if (current.depth > budget.maxDepth)
      throw new RangeError("UVM JSON exceeds maxDepth budget");
    if (Array.isArray(current.value)) {
      for (const child of current.value)
        pending.push({ value: child, depth: current.depth + 1 });
    } else if (current.value !== null && typeof current.value === "object") {
      for (const child of Object.values(current.value))
        pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return nodes;
}
function createUvmInspection(container, options) {
  const { budget, signal } = options;
  signal?.throwIfAborted();
  for (const value of [
    budget.maxDepth,
    budget.maxNodes,
    budget.maxScalarBytes,
    budget.maxJsonBytes
  ])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError("invalid UVM inspection budget");
  if (typeof options.bytesRead !== "bigint" || options.bytesRead < 0n)
    throw new TypeError("invalid UVM inspection byte count");
  const document = container.document;
  validateUvmDocument(document, {
    binaryByteLength: container.binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  const jsonNodes = countJsonNodes(document, budget, signal);
  const { scene, rig } = readUvmModel(document, container.binary, budget, signal);
  const clipBudget = animationSnapshotBudget(rig.clips);
  const { collisions, teamColors, advancedMaterials, effects, sockets, materialRefs } = readUvmFacets(document, container.binary, budget, signal);
  const extensions = object(document["extensions"], "UVM extensions");
  const identity = object(extensions["UV_asset"], "UV_asset");
  const provenance = object(extensions["UV_provenance"], "UV_provenance");
  const asset = object(document["asset"], "UVM asset");
  const profile = object(field(asset["extras"], "uv"), "UVM profile");
  const source = object(provenance["source"], "UV_provenance source");
  const importer = object(provenance["importer"], "UV_provenance importer");
  const version = string(profile["version"], "profile version");
  const profileName = string(profile["profile"], "profile name");
  const assetId = string(identity["id"], "asset id");
  const assetClass = string(identity["class"], "asset class");
  const sourceFormat = string(source["format"], "source format");
  const losses = array(provenance, "lost");
  const bounds = (() => {
    if (scene.primitives.length === 0)
      return void 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const primitive of scene.primitives) {
      for (let offset = 0; offset < primitive.positions.length; offset += 3) {
        for (let axis2 = 0; axis2 < 3; axis2 += 1) {
          const value = required(primitive.positions[offset + axis2], "position axis");
          min[axis2] = Math.min(required(min[axis2], "bounds axis"), value);
          max[axis2] = Math.max(required(max[axis2], "bounds axis"), value);
        }
      }
    }
    return { min, max };
  })();
  const model = createModelSceneSource({
    info: {
      scenes: array(document, "scenes").length,
      nodes: scene.nodes.length,
      meshes: scene.meshes.length,
      primitives: scene.primitives.length,
      materials: scene.materials,
      textures: scene.textures,
      animations: rig.clips.length,
      ...bounds === void 0 ? {} : { bounds },
      geometryAccess: "decoded"
    },
    nodes: scene.nodes,
    meshes: scene.meshes,
    primitives: scene.primitives
  });
  return {
    summary: {
      format: "uvm",
      version,
      profile: profileName,
      assetId,
      assetClass,
      sourceFormat,
      importer,
      nodes: scene.nodes.length,
      meshes: scene.meshes.length,
      primitives: scene.primitives.length,
      collisionShapes: collisions.total,
      collisionKinds: collisions.byKind,
      teamColorMaterials: teamColors.total,
      teamColorOperations: teamColors.byOperation,
      advancedMaterialContracts: advancedMaterials.total,
      advancedMaterialKinds: advancedMaterials.byContract,
      effects: effects.total,
      sockets: sockets.length,
      ...effects.profile === void 0 ? {} : { effectProfile: effects.profile },
      effectKinds: effects.byKind,
      animatedEffectProperties: effects.animated,
      losses
    },
    metadata: [
      {
        id: "uvm-document",
        label: "Universal Verse Model",
        entries: [
          { key: "version", value: version },
          { key: "profile", value: profileName },
          { key: "assetId", value: assetId },
          { key: "assetClass", value: assetClass },
          { key: "sourceFormat", value: sourceFormat },
          { key: "meshes", value: scene.meshes.length },
          { key: "primitives", value: scene.primitives.length },
          { key: "collisionShapes", value: collisions.total },
          { key: "teamColorMaterials", value: teamColors.total },
          { key: "advancedMaterialContracts", value: advancedMaterials.total },
          { key: "effects", value: effects.total },
          { key: "sockets", value: sockets.length },
          { key: "animatedEffectProperties", value: effects.animated }
        ]
      }
    ],
    traits: [
      ...scene.primitives.length > 0 ? [{ id: "model.geometry", parameters: { primitives: scene.primitives.length } }] : [],
      ...scene.materials > 0 ? [{ id: "model.materials", parameters: { count: scene.materials } }] : [],
      ...scene.textures > 0 ? [{ id: "model.textures", parameters: { count: scene.textures } }] : [],
      ...rig.clips.length > 0 ? [{ id: "model.animations", parameters: { count: rig.clips.length } }] : [],
      ...rig.bindings.length > 0 ? [{ id: "model.skeleton", parameters: { bindings: rig.bindings.length } }] : [],
      { id: "scene.objects", parameters: { nodes: scene.nodes.length } },
      { id: "structure.hierarchy", parameters: { nodeCount: jsonNodes, lazy: true } }
    ],
    projectionReceipt: createProjectionReceipt({
      adapter: options.adapter,
      subjectRevision: options.subjectRevision,
      companions: [],
      basis: UVM_BASIS,
      planes: [
        {
          planeId: "skeleton",
          state: rig.incompleteBindings === 0 ? "preserved" : "lost",
          note: `${rig.bindings.length} positional skin bindings; ${rig.incompleteBindings} lack a TRS or direct parent join`
        },
        {
          planeId: "animations",
          state: rig.clips.some((clip) => (clip.unsupportedChannels ?? 0) > 0) ? "lost" : "preserved",
          note: `${rig.clips.length} selectable clips retain material sequence identities, STEP/LINEAR TRS and primitive visibility channels, including channel-less catalog entries; unsupported channels are counted explicitly`
        },
        {
          planeId: "geometry",
          state: "preserved",
          // the document already is the UV space; there is nothing to convert
          note: "positions are read in the profile\u2019s own right-handed Y-up metre space"
        },
        {
          planeId: "structure",
          state: "preserved",
          note: "the node graph, positionally identified"
        },
        {
          planeId: "materials",
          state: scene.materials > 0 ? "preserved" : "lost",
          note: `${scene.materials} material(s), ${advancedMaterials.total} carrying a render-model contract`
        },
        {
          planeId: "collision",
          state: collisions.total > 0 ? "preserved" : "lost",
          note: `${collisions.total} declared UV_game_collision shape(s)`
        },
        {
          planeId: "attachments",
          state: sockets.length > 0 ? "preserved" : "lost",
          note: `${sockets.length} UV_game_socket node extension(s) published with stable identity`
        },
        {
          planeId: "resources",
          state: "lost",
          note: `${scene.textures} texture(s) are counted from the document; this reader does not surface their references, so no resource facet is published`
        },
        {
          planeId: "effects",
          state: effects.total > 0 ? "lost" : "preserved",
          note: effects.total > 0 ? `${effects.total} UV_game_effects entry(ies) are counted by kind; per-emitter records have no contract to be published through` : "the document declares no effects"
        }
      ],
      evidence: [
        {
          kind: "observed",
          statement: `UVM ${version}/${profileName}: ${scene.nodes.length} node(s), ${scene.primitives.length} primitive(s), ${sockets.length} socket(s)`,
          bytesRead: options.bytesRead
        },
        {
          kind: "declared",
          statement: `the document declares its source format as \xAB${sourceFormat}\xBB and its importer as ${importer["id"] ?? "unnamed"}`,
          source: "UV_provenance"
        },
        ...losses.length > 0 ? [
          {
            kind: "declared",
            statement: `the producing importer recorded ${losses.length} loss(es) in UV_provenance.lost`,
            source: "UV_provenance"
          }
        ] : []
      ],
      confidence: "exact"
    }),
    dataSources: {
      "common.view/model-scene-source": model,
      ...rig.bindings.length === 0 ? {} : {
        "common.view/model-skeleton-source": createModelSkeletonSource({
          bindings: rig.bindings,
          hierarchies: array(document, "skins").length,
          budget: {
            maxDepth: budget.maxDepth,
            maxNodes: budget.maxNodes,
            maxBytes: budget.maxScalarBytes
          }
        })
      },
      ...rig.clips.length === 0 ? {} : {
        // Sized by the clips already decoded out of the bounded binary: a pose per frame
        // (Grey Goo ALA, Earth 2160) is millions of snapshot nodes, over the host's node budget.
        "common.view/model-animation-source": createModelAnimationSource({
          clips: rig.clips,
          budget: {
            maxDepth: budget.maxDepth,
            maxNodes: Math.max(budget.maxNodes, clipBudget.maxNodes),
            maxBytes: Math.max(budget.maxScalarBytes, clipBudget.maxBytes)
          }
        })
      },
      ...collisions.volumes.length === 0 ? {} : {
        "common.view/model-collision-source": createModelCollisionSource({
          volumes: collisions.volumes
        })
      },
      ...sockets.length === 0 ? {} : {
        "common.view/model-socket-source": createModelSocketSource({ sockets })
      },
      ...materialRefs.length === 0 ? {} : {
        "common.view/model-material-source": createModelMaterialSource({
          // UVM has no material-library concept, so `libraries` is absent rather than zero
          materials: materialRefs,
          budget: {
            maxDepth: budget.maxDepth,
            maxNodes: budget.maxNodes,
            maxBytes: budget.maxScalarBytes
          }
        })
      },
      "common.view/tree-data-source": createJsonTreeSource(document, {
        label: "Universal Verse Model",
        budget: {
          maxDepth: budget.maxDepth,
          maxNodes: budget.maxNodes,
          maxBytes: budget.maxJsonBytes
        },
        ...options.treeWrite === void 0 ? {} : { write: options.treeWrite },
        ...signal === void 0 ? {} : { signal }
      })
    }
  };
}
export {
  createUvmInspection
};
