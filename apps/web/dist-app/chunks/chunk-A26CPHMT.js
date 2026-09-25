import {
  modelPrimitiveByteLength,
  snapshotModelAnimations,
  snapshotModelSkeleton
} from "./chunk-W5HVUYW4.js";
import {
  snapshotModelMaterials
} from "./chunk-4FJ6AE2N.js";

// packages/codec-kit/dist/paging.js
function pageStart(cursor) {
  if (cursor === void 0)
    return 0;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor))
    throw new TypeError("invalid page cursor");
  const value = Number(cursor);
  if (!Number.isSafeInteger(value))
    throw new TypeError("page cursor exceeds safe integer range");
  return value;
}

// packages/codec-kit/dist/model/sources.js
function frozenModelNode(node) {
  return Object.freeze({
    ...node,
    childIds: Object.freeze([...node.childIds]),
    meshIds: Object.freeze([...node.meshIds]),
    transform: Object.freeze([...node.transform])
  });
}
function frozenModelMesh(mesh) {
  return Object.freeze({ ...mesh, primitiveIds: Object.freeze([...mesh.primitiveIds]) });
}
function clonePrimitive(primitive) {
  return Object.freeze({
    ...primitive,
    positions: primitive.positions.slice(),
    ...primitive.indices === void 0 ? {} : { indices: primitive.indices.slice() },
    ...primitive.normals === void 0 ? {} : { normals: primitive.normals.slice() },
    ...primitive.tangents === void 0 ? {} : { tangents: primitive.tangents.slice() },
    ...primitive.colors === void 0 ? {} : { colors: primitive.colors.slice() },
    ...primitive.boneIndices === void 0 ? {} : { boneIndices: primitive.boneIndices.slice() },
    ...primitive.boneWeights === void 0 ? {} : { boneWeights: primitive.boneWeights.slice() },
    ...primitive.textureCoordinates === void 0 ? {} : { textureCoordinates: primitive.textureCoordinates.slice() },
    ...primitive.textureCoordinateSets === void 0 ? {} : {
      textureCoordinateSets: Object.freeze(primitive.textureCoordinateSets.map((channel) => Object.freeze({ set: channel.set, coordinates: channel.coordinates.slice() })))
    }
  });
}
function createModelSceneSource({ info, nodes, meshes, primitives = [] }) {
  const ownedInfo = Object.freeze({ ...info });
  const ownedNodes = Object.freeze(nodes.map(frozenModelNode));
  const ownedMeshes = Object.freeze(meshes.map(frozenModelMesh));
  const ownedPrimitives = new Map(primitives.map((value) => [value.id, clonePrimitive(value)]));
  const page = (items, request) => {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new TypeError("model page limit must be a positive safe integer");
    }
    const start = pageStart(request.cursor);
    const values = items.slice(start, start + request.limit);
    return Object.freeze({
      items: Object.freeze(values),
      ...start + values.length < items.length ? { nextCursor: String(start + values.length) } : {}
    });
  };
  const source = {
    async info(signal) {
      if (signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async nodes(request, signal) {
      if (signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      return page(ownedNodes, request);
    },
    async meshes(request, signal) {
      if (signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      return page(ownedMeshes, request);
    }
  };
  if (ownedPrimitives.size > 0) {
    source.primitive = async (primitiveId, request, signal) => {
      if (signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isSafeInteger(request?.maxBytes) || request.maxBytes < 0) {
        throw new TypeError("model primitive maxBytes must be a non-negative safe integer");
      }
      const primitive = ownedPrimitives.get(primitiveId);
      if (primitive === void 0)
        throw new RangeError(`unknown model primitive ${primitiveId}`);
      const bytes = modelPrimitiveByteLength(primitive);
      if (bytes > request.maxBytes)
        throw new RangeError("model primitive exceeds maxBytes budget");
      return clonePrimitive(primitive);
    };
  }
  return Object.freeze(source);
}
function facetPage(items, request) {
  if (!Number.isSafeInteger(request?.limit) || request.limit <= 0) {
    throw new TypeError("model facet page limit must be a positive safe integer");
  }
  const start = pageStart(request.cursor);
  const values = items.slice(start, start + request.limit);
  return Object.freeze({
    items: Object.freeze(values),
    ...start + values.length < items.length ? { nextCursor: String(start + values.length) } : {}
  });
}
function facetSource(info, key, items) {
  const owned = Object.freeze(items.map((item) => Object.freeze({ ...item })));
  const source = {
    async info(signal) {
      if (signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      return info;
    }
  };
  source[key] = async (request, signal) => {
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    return facetPage(owned, request);
  };
  return Object.freeze(source);
}
function createModelSkeletonSource({ bindings, hierarchies, budget }) {
  const items = snapshotModelSkeleton(bindings, budget);
  const info = Object.freeze({
    bindings: items.length,
    named: items.filter((item) => item.boneName !== null).length,
    companionBound: items.filter((item) => item.provenance === "companion").length,
    // absent, not zero, when the publisher does not enumerate hierarchies
    ...hierarchies === void 0 ? {} : { hierarchies }
  });
  return facetSource(info, "bindings", items);
}
function createModelAnimationSource({ clips, budget }) {
  const items = snapshotModelAnimations(clips, budget);
  const info = Object.freeze({
    clips: items.length,
    channelled: items.filter((clip) => clip.channels.length > 0).length,
    companionBound: items.filter((clip) => clip.provenance === "companion").length
  });
  return facetSource(info, "clips", items);
}
function createModelCollisionSource({ volumes }) {
  const items = volumes.map((volume) => ({
    ...volume,
    ...volume.types === void 0 ? {} : { types: Object.freeze([...volume.types]) }
  }));
  const byKind = {};
  for (const volume of items)
    byKind[volume.kind] = (byKind[volume.kind] ?? 0) + 1;
  const info = Object.freeze({ volumes: items.length, byKind: Object.freeze(byKind) });
  return facetSource(info, "volumes", items);
}
function createModelMaterialSource({ materials, libraries, budget }) {
  const items = snapshotModelMaterials(materials, budget);
  const byContract = {};
  for (const material of items) {
    for (const contract of material.contracts ?? []) {
      byContract[contract] = (byContract[contract] ?? 0) + 1;
    }
  }
  const info = Object.freeze({
    materials: items.length,
    // absent, not zero, when the format has no library concept at all
    ...libraries === void 0 ? {} : { libraries },
    ...Object.keys(byContract).length === 0 ? {} : { byContract: Object.freeze(byContract) }
  });
  return facetSource(info, "materials", items);
}
function createModelSocketSource({ sockets }) {
  const items = sockets.map((socket) => ({
    ...socket,
    ...socket.orientation === void 0 ? {} : { orientation: Object.freeze({ ...socket.orientation }) }
  }));
  const byRole = {};
  for (const socket of items)
    byRole[socket.role] = (byRole[socket.role] ?? 0) + 1;
  return facetSource(Object.freeze({ sockets: items.length, byRole: Object.freeze(byRole) }), "sockets", items);
}

// packages/codec-kit/dist/projection.js
var PROJECTION_RECEIPT_METADATA_ID = "uv-projection-receipt";
var PLANE_STATES = /* @__PURE__ */ new Set(["normalized", "preserved", "inferred", "lost"]);
var CONFIDENCES = /* @__PURE__ */ new Set(["exact", "high", "partial", "heuristic"]);
function createProjectionReceipt(receipt) {
  const planes = [...receipt.planes ?? []];
  if (planes.length === 0)
    throw new TypeError("a projection receipt must record at least one plane");
  for (const plane of planes) {
    if (!PLANE_STATES.has(plane.state)) {
      throw new TypeError(`projection plane \xAB${plane.planeId}\xBB has an unknown state ${plane.state}`);
    }
  }
  if (!CONFIDENCES.has(receipt.confidence)) {
    throw new TypeError(`projection receipt has an unknown confidence ${receipt.confidence}`);
  }
  if ((receipt.evidence ?? []).length === 0) {
    throw new TypeError("a projection receipt made of no evidence is a claim with nothing behind it; state at least one declared or observed fact");
  }
  return Object.freeze({
    form: "local",
    adapter: Object.freeze({ ...receipt.adapter }),
    subjectRevision: receipt.subjectRevision,
    companions: Object.freeze((receipt.companions ?? []).map((item) => Object.freeze({ ...item }))),
    basis: Object.freeze({ ...receipt.basis }),
    planes: Object.freeze(planes.map((plane) => Object.freeze({ ...plane }))),
    evidence: Object.freeze(receipt.evidence.map((item) => Object.freeze({ ...item }))),
    confidence: receipt.confidence,
    ...receipt.semanticHash === void 0 ? {} : { semanticHash: receipt.semanticHash },
    ...receipt.sourceUri === void 0 ? {} : { sourceUri: receipt.sourceUri }
  });
}

export {
  pageStart,
  createModelSceneSource,
  createModelSkeletonSource,
  createModelAnimationSource,
  createModelCollisionSource,
  createModelMaterialSource,
  createModelSocketSource,
  PROJECTION_RECEIPT_METADATA_ID,
  createProjectionReceipt
};
