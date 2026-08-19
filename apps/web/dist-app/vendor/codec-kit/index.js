import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource
} from "../../chunks/chunk-OK3FIVEI.js";
import {
  revisionId
} from "../../chunks/chunk-2UBMYNBR.js";
import {
  canonicalJsonStringify
} from "../../chunks/chunk-5WZM3EQ3.js";

// extensions/_shared/codec-kit/src/index.js
var INSPECTION_OPERATIONS = Object.freeze([
  Object.freeze({
    id: "view.inspect",
    handlerId: "inspect",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["json"])
  }),
  Object.freeze({
    id: "asset.validate",
    handlerId: "validate",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "export.raw",
    handlerId: "export-raw",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["bytes"])
  })
]);
function simpleLease(value) {
  let released = false;
  return Object.freeze({
    value,
    async release() {
      released = true;
    },
    isReleased: () => released
  });
}
function pageStart(cursor) {
  if (cursor === void 0) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor)) throw new TypeError("invalid page cursor");
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) throw new TypeError("page cursor exceeds safe integer range");
  return value;
}
function createTreeDataSource(rootNode) {
  const nodes = /* @__PURE__ */ new Map();
  const register = (node, id) => {
    const children = Array.isArray(node.children) ? node.children : [];
    nodes.set(id, { node, childIds: children.map((_, index) => `${id}/${index}`) });
    children.forEach((child, index) => register(child, `${id}/${index}`));
  };
  register(rootNode, "root");
  const ref = (id) => {
    const item = nodes.get(id);
    return Object.freeze({ id, hasChildren: (item?.childIds.length ?? 0) > 0 });
  };
  return Object.freeze({
    async root() {
      return ref("root");
    },
    async children(node, page, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError("tree page limit must be a positive safe integer");
      }
      const start = pageStart(page.cursor);
      const childIds = nodes.get(node.id)?.childIds ?? [];
      const items = childIds.slice(start, start + page.limit).map(ref);
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < childIds.length ? { nextCursor: String(start + items.length) } : {}
      });
    },
    async facts(node) {
      const value = nodes.get(node.id)?.node;
      if (value === void 0) throw new TypeError(`unknown tree node ${node.id}`);
      return Object.freeze({
        kind: value.kind,
        label: value.label,
        ...value.preview === void 0 ? {} : { preview: value.preview },
        ...value.semanticPath === void 0 ? {} : { semanticPath: Object.freeze([...value.semanticPath]) }
      });
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase();
      for (const [id, item] of nodes) {
        if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
        const haystack = `${item.node.label}
${item.node.preview ?? ""}`.toLocaleLowerCase();
        if (haystack.includes(needle)) yield ref(id);
      }
    }
  });
}
function createTransportSource(snapshot) {
  let current = {
    ...snapshot,
    tracks: snapshot.tracks.map((track) => ({ ...track })),
    controls: { ...snapshot.controls }
  };
  const listeners = /* @__PURE__ */ new Set();
  const owned = () => Object.freeze({
    ...current,
    tracks: Object.freeze(current.tracks.map((track) => Object.freeze({ ...track }))),
    controls: Object.freeze({ ...current.controls })
  });
  const publish = () => {
    const event = Object.freeze({ kind: "snapshot", snapshot: owned() });
    for (const listener of listeners) listener(event);
  };
  return Object.freeze({
    async snapshot(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return owned();
    },
    async *events(signal) {
      if (signal?.aborted) return;
      const queue = [Object.freeze({ kind: "snapshot", snapshot: owned() })];
      let wake;
      const listener = (event) => {
        queue.push(event);
        wake?.();
      };
      const abort = () => wake?.();
      listeners.add(listener);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        while (!signal?.aborted) {
          if (queue.length === 0) await new Promise((resolve) => wake = resolve);
          wake = void 0;
          const event = queue.shift();
          if (event !== void 0) yield event;
        }
      } finally {
        listeners.delete(listener);
        signal?.removeEventListener("abort", abort);
      }
    },
    control(kind, input = {}) {
      if (kind === "playPause") {
        current = { ...current, state: current.state === "playing" ? "paused" : "playing" };
      } else if (kind === "seek") {
        const positionMs = input?.positionMs;
        if (!Number.isFinite(positionMs) || positionMs < 0)
          throw new RangeError("transport seek requires a non-negative positionMs");
        const maximum = typeof current.durationMs === "number" ? current.durationMs : positionMs;
        current = { ...current, positionMs: Math.min(positionMs, maximum) };
      } else if (kind === "setRate") {
        const rate = input?.rate;
        if (!Number.isFinite(rate) || rate <= 0 || rate > 16)
          throw new RangeError("transport rate must be within (0, 16]");
        current = { ...current, rate };
      } else if (kind === "selectTrack") {
        const trackId = input?.trackId;
        if (typeof trackId !== "string" || !current.tracks.some((track) => track.id === trackId))
          throw new RangeError("transport selectTrack requires a known trackId");
        current = {
          ...current,
          tracks: current.tracks.map((track) => ({ ...track, selected: track.id === trackId }))
        };
      } else {
        throw new RangeError(`unknown transport control: ${kind}`);
      }
      publish();
    }
  });
}
var TRANSPORT_OPERATIONS = Object.freeze([
  Object.freeze({
    id: "media.play-pause",
    handlerId: "transport-play-pause",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.seek",
    handlerId: "transport-seek",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.set-rate",
    handlerId: "transport-set-rate",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.select-track",
    handlerId: "transport-select-track",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  })
]);
function createTransportHandlers(transport) {
  const handler = (kind) => async (input) => {
    transport.control(kind, input);
    return Object.freeze({ kind: "none" });
  };
  return Object.freeze({
    "transport-play-pause": handler("playPause"),
    "transport-seek": handler("seek"),
    "transport-set-rate": handler("setRate"),
    "transport-select-track": handler("selectTrack")
  });
}
function assertBoundedRead(offset, length, size) {
  if (typeof offset !== "bigint" || offset < 0n || offset > BigInt(size)) {
    throw new RangeError("encoded media offset is outside the source");
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError("encoded media length must be a non-negative safe integer");
  }
}
function createEncodedMediaSource(bytes, descriptor) {
  const owned = Object.freeze({
    mediaType: descriptor.mediaType,
    bytes: BigInt(bytes.byteLength),
    ...descriptor.codecs === void 0 ? {} : { codecs: Object.freeze([...descriptor.codecs]) }
  });
  return Object.freeze({
    async descriptor() {
      return owned;
    },
    async read(offset, length, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      assertBoundedRead(offset, length, bytes.byteLength);
      const start = Number(offset);
      return bytes.slice(start, Math.min(bytes.byteLength, start + length));
    }
  });
}
function createRasterImageSource(bytes, mediaType, info, readRegion) {
  const ownedInfo = Object.freeze({ ...info });
  const encoded = createEncodedMediaSource(bytes, { mediaType });
  const source = {
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async encoded(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return encoded;
    }
  };
  if (readRegion !== void 0) source.readRegion = readRegion;
  return Object.freeze(source);
}
function createAudioMediaSource(bytes, mediaType, info) {
  const tracks = Object.freeze(info.tracks.map((track) => Object.freeze({ ...track })));
  const ownedInfo = Object.freeze({ ...info, tracks });
  const encoded = createEncodedMediaSource(bytes, {
    mediaType,
    codecs: tracks.map((track) => track.codec)
  });
  return Object.freeze({
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async encoded(trackId, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (trackId !== void 0 && !tracks.some((track) => track.id === trackId)) {
        throw new RangeError(`unknown audio track ${trackId}`);
      }
      return encoded;
    }
  });
}
function createVideoMediaSource(bytes, mediaType, info) {
  const tracks = Object.freeze(info.tracks.map((track) => Object.freeze({ ...track })));
  const ownedInfo = Object.freeze({ ...info, tracks });
  const encoded = createEncodedMediaSource(bytes, {
    mediaType,
    codecs: tracks.map((track) => track.codec)
  });
  return Object.freeze({
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async encoded(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return encoded;
    }
  });
}
function createVectorSceneSource(info, text) {
  const ownedInfo = Object.freeze({
    ...info,
    ...info.viewBox === void 0 ? {} : { viewBox: Object.freeze([...info.viewBox]) }
  });
  const document = Object.freeze({
    mediaType: "image/svg+xml",
    profile: "uvg.secure-static.v1",
    text
  });
  return Object.freeze({
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async document(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return document;
    }
  });
}
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
    ...primitive.textureCoordinates === void 0 ? {} : { textureCoordinates: primitive.textureCoordinates.slice() }
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
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async nodes(request, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return page(ownedNodes, request);
    },
    async meshes(request, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return page(ownedMeshes, request);
    }
  };
  if (ownedPrimitives.size > 0) {
    source.primitive = async (primitiveId, request, signal) => {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isSafeInteger(request?.maxBytes) || request.maxBytes < 0) {
        throw new TypeError("model primitive maxBytes must be a non-negative safe integer");
      }
      const primitive = ownedPrimitives.get(primitiveId);
      if (primitive === void 0) throw new RangeError(`unknown model primitive ${primitiveId}`);
      const bytes = primitive.positions.byteLength + (primitive.indices?.byteLength ?? 0) + (primitive.normals?.byteLength ?? 0) + (primitive.textureCoordinates?.byteLength ?? 0);
      if (bytes > request.maxBytes) throw new RangeError("model primitive exceeds maxBytes budget");
      return clonePrimitive(primitive);
    };
  }
  return Object.freeze(source);
}
async function readAll(source, budget, signal) {
  if (source.kind !== "bytes" || source.size === void 0) {
    throw new TypeError("inspection codecs require a sized byte source");
  }
  if (source.size > budget.maxInputBytes || source.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("source exceeds the inspection budget");
  }
  const total = Number(source.size);
  const result = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
    const chunk = await source.read(BigInt(offset), Math.min(64 * 1024, total - offset), signal);
    if (chunk.byteLength === 0) throw new RangeError("source ended before its declared size");
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function originFrom(input, primary) {
  const toBinding = (binding) => ({
    id: binding.bindingId,
    role: binding.role,
    source: binding.source,
    required: binding.sourceKind === "candidate",
    ownership: binding.ownership,
    revision: binding.revision
  });
  if (input.originKind === "single") return { kind: "single", binding: toBinding(primary) };
  if (input.originKind === "bundle") {
    return {
      kind: "bundle",
      bindings: input.bindings.map(toBinding),
      primary: input.primaryBindingId
    };
  }
  throw new TypeError("inspection codec requires a physical byte input");
}
function probeLength(plan, size) {
  const first = plan.ranges[0];
  const declared = Math.min(plan.maxBytes, first?.length ?? plan.maxBytes);
  const available = size === void 0 ? declared : Number(size);
  return Math.max(0, Math.min(declared, available));
}
function createInspectionCodec(definition) {
  const customOperations = Object.freeze([...definition.operations ?? []]);
  const operationDeclarations = Object.freeze([...INSPECTION_OPERATIONS, ...customOperations]);
  return Object.freeze({
    async probe(request, signal) {
      if (request.source.kind !== "bytes" || request.plan.kind !== "bytes") {
        throw new TypeError(`${definition.id} requires a byte probe`);
      }
      const bytes = await request.source.read(
        0n,
        probeLength(request.plan, request.source.size),
        signal
      );
      const detected = await definition.detect(bytes, request.source.ref.uri);
      return Object.freeze({
        codecId: definition.id,
        confidence: detected.confidence,
        evidence: Object.freeze([
          Object.freeze({
            kind: detected.kind ?? "magic",
            weight: detected.confidence,
            note: detected.note
          })
        ]),
        requiredRanges: Object.freeze([
          Object.freeze({ byteOffset: "0", byteLength: String(bytes.byteLength) })
        ])
      });
    },
    async planInput() {
      return Object.freeze({
        originKind: "single",
        candidate: Object.freeze({ bindingId: "content", role: "content", ownership: "owned" }),
        requirements: Object.freeze([])
      });
    },
    async open(input, intent, budget, signal) {
      if (input.originKind !== "single" && input.originKind !== "bundle") {
        throw new TypeError(`${definition.id} requires a single or bundle byte input`);
      }
      const primaryId = input.primaryBindingId;
      const primary = input.bindings.find((binding) => binding.bindingId === primaryId);
      if (primary === void 0) throw new TypeError("primary binding is missing");
      const sourceLease = await input.openBinding(primary.bindingId, signal);
      const source = sourceLease.value;
      try {
        const bytes = await readAll(source, budget, signal);
        const detected = await definition.detect(bytes, primary.source.uri);
        const byteSource = Object.freeze({
          size: async () => BigInt(bytes.byteLength),
          async read(offset, length, readSignal) {
            if (readSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
            if (offset < 0n || offset > BigInt(bytes.byteLength) || length < 0) {
              throw new RangeError("byte range is outside the source");
            }
            return bytes.slice(Number(offset), Math.min(bytes.byteLength, Number(offset) + length));
          }
        });
        const inspection = await definition.inspect(bytes, {
          budget,
          signal,
          intent,
          source,
          primary,
          byteSource,
          input
        });
        const dataSources = new Map([
          ["common.view/byte-range-source", byteSource],
          ...Object.entries(inspection.dataSources ?? {})
        ]);
        if (inspection.text === true) {
          dataSources.set("common.view/text-data-source", createUtf8TextDataSource(byteSource));
        }
        const descriptor = await assembleSubjectDescriptor({
          schemaVersion: 2,
          subjectUri: primary.source.uri,
          origin: originFrom(input, primary),
          interpretation: "codec",
          identity: {
            codecId: definition.id,
            codecVersion: definition.version ?? "1.0.0",
            formatId: definition.format.id,
            formatLabel: definition.format.label,
            ...definition.format.mediaType === void 0 ? {} : { mediaType: definition.format.mediaType },
            confidence: detected.confidence,
            detection: [
              {
                kind: detected.kind ?? "magic",
                weight: detected.confidence,
                ...detected.note === void 0 ? {} : { note: detected.note }
              }
            ]
          },
          traits: inspection.traits.map((trait) => ({
            id: trait.id,
            descriptorVersion: 1,
            state: "available",
            ...trait.parameters === void 0 ? {} : { parameters: trait.parameters }
          })),
          operations: operationDeclarations.map((operation) => ({
            id: operation.id,
            handlerId: operation.handlerId,
            mutatesSource: operation.mutatesSource,
            state: "available"
          })),
          constraints: {
            // a codec with a mutating operation is not read-only (ADR-HOST-002 Path A)
            readOnly: !operationDeclarations.some((operation) => operation.mutatesSource === true),
            seekable: true,
            randomAccess: true,
            trusted: false,
            maxDecodedBytes: String(inspection.maxDecodedBytes ?? bytes.byteLength),
            ...inspection.unsupportedFeatures === void 0 ? {} : { unsupportedFeatures: inspection.unsupportedFeatures }
          },
          dataSources: [...dataSources.keys()].map((contract) => ({ contract, major: 1 })),
          diagnostics: inspection.diagnostics ?? [],
          metadata: inspection.metadata,
          revision: input.revisions.revision
        });
        const handlers = new Map([
          ["inspect", async () => ({ kind: "json", value: inspection.summary })],
          ["validate", async () => ({ kind: "none" })],
          ["export-raw", async () => ({ kind: "bytes", value: bytes })],
          ...Object.entries(inspection.handlers ?? {})
        ]);
        return createAssetSession({
          revision: revisionId(input.revisions.revision),
          descriptor,
          operationDeclarations,
          permissionGrant: {
            id: `${definition.format.id}-inspection-session`,
            classes: declaredPermissionClasses(operationDeclarations)
          },
          handlers,
          async openDataSource(contract) {
            const value = dataSources.get(contract);
            if (value === void 0)
              throw new TypeError(`${definition.id} does not publish ${contract}`);
            return simpleLease(value);
          },
          release: [() => sourceLease.release()]
        }).session;
      } catch (error) {
        await sourceLease.release();
        throw error;
      }
    }
  });
}
function declaredPermissionClasses(operations) {
  const classes = /* @__PURE__ */ new Set(["read-source"]);
  for (const operation of operations) {
    for (const item of operation.requiredPermissions ?? []) classes.add(item);
    if (operation.mutatesSource === true) classes.add("write-source");
  }
  return Object.freeze([...classes].sort());
}
function assetRevisionFromInput(input) {
  if (input.originKind !== "single" || input.revisions.topology !== "single") {
    throw new TypeError("assetRevisionFromInput: single-source subjects only");
  }
  const [binding] = input.bindings;
  if (binding === void 0) throw new TypeError("assetRevisionFromInput: no binding");
  const revision = binding.revision;
  return Object.freeze({
    bindings: Object.freeze({ [binding.bindingId]: revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: "single",
      bindingId: binding.bindingId,
      source: { id: binding.source.id, uri: binding.source.uri },
      revision
    })
  });
}
function editPlanFromInput(input, { planId, edits, fidelity, guarantee = "atomic", diagnostics = [] }) {
  const revision = assetRevisionFromInput(input);
  const [binding] = input.bindings;
  const target = Object.freeze({
    targetId: binding.bindingId,
    subjectUri: binding.source.uri,
    ownerSource: Object.freeze({ id: binding.source.id, uri: binding.source.uri }),
    semanticPath: Object.freeze([]),
    expectedRevision: revision
  });
  return Object.freeze({
    planId,
    targets: Object.freeze([target]),
    edits: Object.freeze(
      edits.map(
        (edit) => Object.freeze({
          ...edit,
          targetId: edit.targetId ?? binding.bindingId,
          source: edit.source ?? target.ownerSource
        })
      )
    ),
    semantics: Object.freeze({ mutationMode: "mutate", minimumGuarantee: guarantee }),
    fidelity,
    diagnostics: Object.freeze([...diagnostics])
  });
}
function replaceBytes(offset, length, bytes, label) {
  return Object.freeze({
    operation: "replace",
    range: Object.freeze({ kind: "bytes", offset: BigInt(offset), length: BigInt(length) }),
    payload: Object.freeze({ kind: "inline", bytes }),
    ...label === void 0 ? {} : { label }
  });
}
function defineWriter({
  providerId,
  providerVersion = "1.0.0",
  artifactDigest,
  offerId,
  formatId,
  representationId,
  mutationMode = "mutate",
  minimumRoundTrip,
  fidelityEvidenceId,
  fidelity,
  validate,
  planEdits,
  plan
}) {
  const identity = Object.freeze({
    providerId,
    providerVersion,
    artifactDigest,
    formatId,
    representationId
  });
  const offer = Object.freeze({
    providerId,
    fidelityEvidenceId,
    formatId,
    representationId,
    mutationMode,
    minimumRoundTrip
  });
  const writer = Object.freeze({
    identity,
    offer,
    async validate(change, signal) {
      if (validate !== void 0) return validate(change, signal);
      return { valid: change.targets.length > 0 && change.edits.length > 0, diagnostics: [] };
    },
    async plan(change, signal) {
      if (plan !== void 0) return plan(change, signal);
      const edits = await planEdits(change, signal);
      return Object.freeze({
        planId: `${providerId}:${change.targets.map((target) => target.targetId).join("+")}`,
        targets: change.targets,
        edits,
        semantics: Object.freeze({ mutationMode, minimumGuarantee: "atomic" }),
        fidelity,
        diagnostics: Object.freeze([])
      });
    }
  });
  return Object.freeze({
    abiVersion: 1,
    provides: Object.freeze(["common.edit/writer"]),
    async createProvider(selection) {
      if (selection.offerId !== offerId)
        throw new TypeError(`unknown writer offer ${selection.offerId}`);
      return simpleLease(writer);
    }
  });
}
export {
  INSPECTION_OPERATIONS,
  TRANSPORT_OPERATIONS,
  assetRevisionFromInput,
  createAudioMediaSource,
  createEncodedMediaSource,
  createInspectionCodec,
  createModelSceneSource,
  createRasterImageSource,
  createTransportHandlers,
  createTransportSource,
  createTreeDataSource,
  createVectorSceneSource,
  createVideoMediaSource,
  declaredPermissionClasses,
  defineWriter,
  editPlanFromInput,
  replaceBytes,
  simpleLease
};
