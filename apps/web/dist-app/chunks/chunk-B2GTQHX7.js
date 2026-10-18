import {
  grantValidity,
  parseSubjectRef,
  rootSubject,
  serializeSubjectRef,
  validateSubjectDescriptorV2
} from "./chunk-AVWJKQQU.js";
import {
  ModkitError,
  canonicalJsonStringify,
  compareUtf8,
  diagnostic,
  isCancellation,
  throwIfAborted,
  uint64
} from "./chunk-22GOWHCF.js";

// packages/host/dist/codec.js
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
function referencePath(path, segment) {
  return path === "" ? segment : `${path}.${segment}`;
}
function metadataFieldProjections(groups) {
  return Object.freeze(
    groups.flatMap(
      (group) => group.entries.flatMap(
        (entry) => entry.type === void 0 ? [] : [{ path: referencePath(group.id, entry.key), type: entry.type, value: entry.value }]
      )
    )
  );
}
var init_subject_field_projections = __esm({
  "packages/host/src/subject-field-projections.ts"() {
    "use strict";
  }
});
var subject_projection_exports = {};
__export(subject_projection_exports, {
  DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET: () => DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET,
  createCompositeRelationGraphSource: () => createCompositeRelationGraphSource,
  createCompositeSubjectFactsSource: () => createCompositeSubjectFactsSource,
  createDescriptorFallbackSubjectFactsSource: () => createDescriptorFallbackSubjectFactsSource,
  createFieldRelationGraphSource: () => createFieldRelationGraphSource,
  descriptorSubjectRef: () => descriptorSubjectRef,
  metadataFieldProjections: () => metadataFieldProjections
});
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be positive`);
  return value;
}
function pageOf(items, request) {
  const limit = positive(request.limit, "page limit");
  const offset = request.cursor === void 0 ? 0 : Number(request.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || request.cursor !== void 0 && String(offset) !== request.cursor) {
    throw new RangeError(`invalid projection page cursor: ${String(request.cursor)}`);
  }
  const next = Math.min(offset + limit, items.length);
  return Object.freeze({
    items: Object.freeze(items.slice(offset, next)),
    ...next < items.length ? { nextCursor: String(next) } : {}
  });
}
function recordOf(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function relationKey(edge) {
  return `${edge.from}\0${edge.to}\0${edge.role ?? ""}`;
}
function relationFactKey(relation) {
  return `${relation.subjectId}\0${relation.role}\0${relation.kind}`;
}
function scalarBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}
function cap(state, reason) {
  state.capped = true;
  state.reason ??= reason;
}
function enterValue(state, value, depth) {
  state.options.signal?.throwIfAborted();
  if (depth > state.budget.maxDepth) {
    cap(state, `field traversal exceeded maxDepth ${state.budget.maxDepth}`);
    return false;
  }
  state.values += 1;
  if (state.values > state.budget.maxValues) {
    cap(state, `field traversal exceeded maxValues ${state.budget.maxValues}`);
    return false;
  }
  if (typeof value === "object" && value !== null) {
    if (state.valueStack.has(value)) {
      cap(state, "field traversal stopped at a cyclic value");
      return false;
    }
    state.valueStack.add(value);
  }
  return true;
}
function leaveValue(state, value) {
  if (typeof value === "object" && value !== null) state.valueStack.delete(value);
}
async function addReference(state, type, value, role) {
  if (state.edges.size >= state.budget.maxEdges) {
    cap(state, `relation projection exceeded maxEdges ${state.budget.maxEdges}`);
    return;
  }
  state.bytes += scalarBytes(value);
  if (state.bytes > state.budget.maxScalarBytes) {
    cap(state, `relation projection exceeded maxScalarBytes ${state.budget.maxScalarBytes}`);
    return;
  }
  const request = Object.freeze({ owner: state.options.owner, role, type, value });
  const resolved = await state.options.resolver.resolve(request, state.options.signal);
  const target = resolved ?? state.options.resolver.createUnresolved(request);
  const subject = type.kind === "asset-ref" ? rootSubject(target.subject.source, target.subject.workspace) : target.subject;
  const id = serializeSubjectRef(subject);
  state.nodes.set(id, {
    id,
    label: target.label,
    type: target.kind,
    subject: id,
    kind: target.kind
  });
  const edge = {
    from: serializeSubjectRef(state.options.owner),
    to: id,
    role,
    ...resolved === void 0 ? { dead: true } : {}
  };
  const key = relationKey(edge);
  const previous = state.edges.get(key);
  if (previous === void 0 || previous.dead === true && edge.dead !== true)
    state.edges.set(key, edge);
}
async function visitLeaf(state, type, value, path, depth) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      if (state.capped) return;
      await visitField(state, type, item, `${path}[${index}]`, depth + 1);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0) await addReference(state, type, value, path);
}
async function visitInstructions(state, type, value, path, depth) {
  if (typeof value !== "string") return;
  const instructions = type.listDelimiter === void 0 ? [value] : value.split(type.listDelimiter);
  for (const [instructionIndex, instruction] of instructions.entries()) {
    if (state.capped) return;
    const parts = instruction.split(type.delimiter);
    const keyword = parts.shift()?.trim();
    if (keyword === void 0 || keyword === "") continue;
    const parameters = type.keywords[keyword];
    if (parameters === void 0) continue;
    for (const [parameterIndex, parameter] of parameters.entries()) {
      const scalar = parts[parameterIndex];
      if (scalar === void 0) break;
      await visitField(
        state,
        parameter,
        scalar.trim(),
        `${path}[${instructionIndex}].${keyword}[${parameterIndex}]`,
        depth + 1
      );
    }
  }
}
async function visitField(state, type, value, path, depth) {
  if (!enterValue(state, value, depth)) return;
  const typeObject = type;
  if (state.typeStack.has(typeObject)) {
    cap(state, "field traversal stopped at a cyclic field type");
    leaveValue(state, value);
    return;
  }
  state.typeStack.add(typeObject);
  try {
    switch (type.kind) {
      case "subject-ref":
      case "asset-ref":
      case "text-key":
        await visitLeaf(state, type, value, path, depth);
        return;
      case "array":
        if (!Array.isArray(value)) return;
        for (const [index, item] of value.entries()) {
          if (state.capped) return;
          await visitField(state, type.item, item, `${path}[${index}]`, depth + 1);
        }
        return;
      case "struct": {
        const record = recordOf(value);
        if (record === void 0) return;
        for (const field of type.fields) {
          if (state.capped) return;
          const child = record[field.key];
          if (child !== void 0)
            await visitField(state, field.type, child, referencePath(path, field.key), depth + 1);
        }
        return;
      }
      case "record": {
        const record = recordOf(value);
        if (record === void 0) return;
        for (const key of Object.keys(record).sort(compareUtf8)) {
          if (state.capped) return;
          const itemPath = `${path}[${JSON.stringify(key)}]`;
          await visitField(state, type.key, key, `${itemPath}.$key`, depth + 1);
          await visitField(state, type.value, record[key], itemPath, depth + 1);
        }
        return;
      }
      case "instructions":
        await visitInstructions(state, type, value, path, depth);
        return;
      default:
        return;
    }
  } finally {
    state.typeStack.delete(typeObject);
    leaveValue(state, value);
  }
}
function graphTypeBuckets(nodes) {
  const counts = /* @__PURE__ */ new Map();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  return Object.freeze(
    [...counts.entries()].sort(([left], [right]) => compareUtf8(left, right)).map(([id, count], index) => Object.freeze({ id, label: id, count, tone: index }))
  );
}
function materializedGraphSource(summary, nodes, edges) {
  return Object.freeze({
    async summary(signal) {
      signal?.throwIfAborted();
      return summary;
    },
    async nodes(page, signal) {
      signal?.throwIfAborted();
      return pageOf(nodes, page);
    },
    async edges(page, signal) {
      signal?.throwIfAborted();
      return pageOf(edges, page);
    }
  });
}
async function createFieldRelationGraphSource(options) {
  const budget = options.budget ?? DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET;
  positive(budget.maxDepth, "maxDepth");
  positive(budget.maxValues, "maxValues");
  positive(budget.maxEdges, "maxEdges");
  positive(budget.maxScalarBytes, "maxScalarBytes");
  positive(budget.pageSize, "pageSize");
  const ownerId = serializeSubjectRef(options.owner);
  const state = {
    options,
    budget,
    nodes: /* @__PURE__ */ new Map([
      [
        ownerId,
        {
          id: ownerId,
          label: options.ownerLabel,
          type: options.ownerKind,
          subject: ownerId,
          kind: options.ownerKind
        }
      ]
    ]),
    edges: /* @__PURE__ */ new Map(),
    typeStack: /* @__PURE__ */ new WeakSet(),
    valueStack: /* @__PURE__ */ new WeakSet(),
    values: 0,
    bytes: 0,
    capped: false,
    reason: void 0
  };
  for (const field of options.fields) {
    if (state.capped) break;
    await visitField(state, field.type, field.value, field.path, 0);
  }
  const nodes = Object.freeze([...state.nodes.values()].sort((a, b) => compareUtf8(a.id, b.id)));
  const edges = Object.freeze(
    [...state.edges.values()].sort((a, b) => compareUtf8(relationKey(a), relationKey(b)))
  );
  const completeness = state.capped ? "capped" : "complete";
  const summary = Object.freeze({
    snapshotId: `field-projection:${ownerId}`,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    types: graphTypeBuckets(nodes),
    completeness,
    ...state.reason === void 0 ? {} : { reason: state.reason }
  });
  return materializedGraphSource(summary, nodes, edges);
}
async function readAll(read, maximum, pageSize, signal) {
  const items = [];
  let cursor2;
  const seen = /* @__PURE__ */ new Set();
  while (items.length < maximum) {
    signal?.throwIfAborted();
    const page = await read(
      {
        ...cursor2 === void 0 ? {} : { cursor: cursor2 },
        limit: Math.min(pageSize, maximum - items.length)
      },
      signal
    );
    items.push(...page.items.slice(0, maximum - items.length));
    if (page.nextCursor === void 0) return { items: Object.freeze(items), capped: false };
    if (page.items.length === 0 || seen.has(page.nextCursor)) {
      throw new Error("data source returned an invalid continuation cursor");
    }
    seen.add(page.nextCursor);
    cursor2 = page.nextCursor;
  }
  return { items: Object.freeze(items), capped: cursor2 !== void 0 };
}
async function materializeGraph(source, options) {
  const summary = await source.summary(options.signal);
  const [nodes, edges] = await Promise.all([
    readAll(source.nodes.bind(source), options.maxNodes, options.pageSize, options.signal),
    readAll(source.edges.bind(source), options.maxEdges, options.pageSize, options.signal)
  ]);
  return Object.freeze({
    summary,
    nodes: nodes.items,
    edges: edges.items,
    capped: nodes.capped || edges.capped || nodes.items.length < summary.totalNodes || edges.items.length < summary.totalEdges
  });
}
function createCompositeRelationGraphSource(sources, input = {}) {
  if (sources.length === 0) throw new TypeError("relation graph composition requires a source");
  const options = {
    maxNodes: positive(input.maxNodes ?? DEFAULT_GRAPH_MERGE.maxNodes, "maxNodes"),
    maxEdges: positive(input.maxEdges ?? DEFAULT_GRAPH_MERGE.maxEdges, "maxEdges"),
    pageSize: positive(input.pageSize ?? DEFAULT_GRAPH_MERGE.pageSize, "pageSize"),
    ...input.signal === void 0 ? {} : { signal: input.signal }
  };
  const snapshot = (async () => {
    const loaded = [];
    for (const source of sources) loaded.push(await materializeGraph(source, options));
    const nodeMap = /* @__PURE__ */ new Map();
    const edgeMap = /* @__PURE__ */ new Map();
    const typeInfo = /* @__PURE__ */ new Map();
    for (const graph of loaded) {
      for (const type of graph.summary.types) {
        if (!typeInfo.has(type.id)) typeInfo.set(type.id, { label: type.label, tone: type.tone });
      }
      for (const node of graph.nodes) {
        const previous = nodeMap.get(node.id);
        nodeMap.set(
          node.id,
          previous === void 0 ? node : Object.freeze({
            ...node,
            ...previous,
            ...previous.subject === void 0 && node.subject !== void 0 ? { subject: node.subject } : {},
            ...previous.kind === void 0 && node.kind !== void 0 ? { kind: node.kind } : {}
          })
        );
      }
      for (const edge of graph.edges) {
        const key = relationKey(edge);
        const previous = edgeMap.get(key);
        if (previous === void 0 || previous.dead === true && edge.dead !== true)
          edgeMap.set(key, edge);
      }
    }
    const nodes = Object.freeze([...nodeMap.values()].sort((a, b) => compareUtf8(a.id, b.id)));
    const edges = Object.freeze(
      [...edgeMap.values()].sort((a, b) => compareUtf8(relationKey(a), relationKey(b)))
    );
    const counts = /* @__PURE__ */ new Map();
    for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    const types = Object.freeze(
      [...counts.entries()].sort(([a], [b]) => compareUtf8(a, b)).map(([id, count], index) => {
        const known = typeInfo.get(id);
        return Object.freeze({
          id,
          label: known?.label ?? id,
          count,
          tone: known?.tone ?? index
        });
      })
    );
    const capped = loaded.some((item) => item.capped);
    const partial = loaded.some((item) => item.summary.completeness !== "complete");
    const completeness = capped ? "capped" : partial ? "partial" : "complete";
    const reasons = loaded.map((item) => item.summary.reason).filter((item) => item !== void 0);
    const summary = Object.freeze({
      snapshotId: `composite:${loaded.map((item) => item.summary.snapshotId).join("|")}`,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      types,
      completeness,
      ...reasons.length === 0 ? {} : { reason: reasons.join(" \xB7 ") }
    });
    return { summary, nodes, edges };
  })();
  return Object.freeze({
    async summary(signal) {
      signal?.throwIfAborted();
      return (await snapshot).summary;
    },
    async nodes(page, signal) {
      signal?.throwIfAborted();
      return pageOf((await snapshot).nodes, page);
    },
    async edges(page, signal) {
      signal?.throwIfAborted();
      return pageOf((await snapshot).edges, page);
    }
  });
}
function descriptorSources(descriptor) {
  switch (descriptor.origin.kind) {
    case "single":
      return [descriptor.origin.binding.source];
    case "bundle":
      return descriptor.origin.bindings.map((item) => item.source);
    case "namespace":
      return [descriptor.origin.root];
    case "derived":
      return descriptor.origin.materialization === void 0 ? [] : [descriptor.origin.materialization.source];
  }
}
function descriptorPreview(descriptor, definition) {
  if (definition?.card?.preview === "none") return void 0;
  const contracts = new Set(descriptor.dataSources.map((item) => item.contract));
  const wanted = definition?.card?.preview;
  const hasRaster = contracts.has("common.view/raster-image-source");
  const hasModel = contracts.has("common.view/model-scene-source");
  const hasMedia = contracts.has("common.view/video-media-source") || contracts.has("common.view/audio-media-source");
  if (wanted === "raster" && !hasRaster || wanted === "model" && !hasModel) return void 0;
  if (wanted === void 0 && !hasRaster && !hasModel && !hasMedia) return void 0;
  const source = descriptorSources(descriptor)[0];
  if (source === void 0) return void 0;
  return Object.freeze({
    source,
    ...descriptor.interpretation === "codec" && descriptor.identity.mediaType !== void 0 ? { mediaType: descriptor.identity.mediaType } : {},
    label: wanted === "model" || !hasRaster && hasModel ? "model preview" : hasRaster || wanted === "raster" ? "raster preview" : "media preview"
  });
}
function descriptorIdentity(descriptor) {
  const resolved = descriptor.interpretation === "codec";
  const label = resolved ? descriptor.identity.formatLabel : descriptor.subjectUri;
  const kind = resolved ? `format:${descriptor.identity.formatId}` : "format:unknown";
  return Object.freeze({
    subjectId: serializeSubjectRef(descriptorSubjectRef(descriptor)),
    label,
    kind,
    ...resolved && descriptor.identity.mediaType !== void 0 ? { type: descriptor.identity.mediaType } : {},
    origins: Object.freeze(
      descriptorSources(descriptor).map((source) => Object.freeze({ label: source.id, source }))
    )
  });
}
function descriptorFactGroups(descriptor) {
  const identityFacts = descriptor.interpretation === "codec" ? [
    { id: "format", label: "Format", value: descriptor.identity.formatId, provenance: [] },
    { id: "codec", label: "Codec", value: descriptor.identity.codecId, provenance: [] },
    {
      id: "version",
      label: "Codec version",
      value: descriptor.identity.codecVersion,
      provenance: []
    },
    {
      id: "confidence",
      label: "Confidence",
      value: descriptor.identity.confidence,
      provenance: []
    }
  ] : [{ id: "interpretation", label: "Interpretation", value: "none", provenance: [] }];
  const groups = [
    {
      group: { id: "identity", label: "Identity", factCount: identityFacts.length },
      facts: Object.freeze(identityFacts.map((item) => Object.freeze(item)))
    }
  ];
  if (descriptor.traits.length > 0) {
    const facts = Object.freeze(
      descriptor.traits.map(
        (trait) => Object.freeze({
          id: trait.id,
          label: trait.id,
          value: trait.state,
          provenance: Object.freeze([])
        })
      )
    );
    groups.push({ group: { id: "traits", label: "Traits", factCount: facts.length }, facts });
  }
  if (descriptor.interpretation === "codec") {
    for (const group of [...descriptor.metadata].sort(
      (left, right) => (left.order ?? 0) - (right.order ?? 0) || compareUtf8(left.id, right.id)
    )) {
      const facts = Object.freeze(
        group.entries.map(
          (entry) => Object.freeze({
            id: entry.key,
            label: entry.key,
            value: entry.value,
            provenance: Object.freeze([...entry.provenance ?? []]),
            ...entry.note === void 0 ? {} : { note: entry.note },
            ...entry.knowledgeTarget === void 0 ? {} : { knowledgeTarget: entry.knowledgeTarget }
          })
        )
      );
      groups.push({
        group: { id: group.id, label: group.label, factCount: facts.length },
        facts
      });
    }
  }
  return Object.freeze(
    groups.map((item) => Object.freeze({ group: Object.freeze(item.group), facts: item.facts }))
  );
}
async function graphRelations(descriptor, source) {
  if (source === void 0) return Object.freeze([]);
  const graph = await materializeGraph(source, DEFAULT_GRAPH_MERGE);
  const descriptorSubject = serializeSubjectRef(descriptorSubjectRef(descriptor));
  const ownerIds = new Set(
    graph.nodes.filter(
      (node) => node.id === descriptorSubject || node.subject === descriptorSubject || node.id === descriptor.subjectUri || node.subject === descriptor.subjectUri
    ).map((node) => node.id)
  );
  ownerIds.add(descriptorSubject);
  ownerIds.add(descriptor.subjectUri);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const relations = /* @__PURE__ */ new Map();
  for (const edge of graph.edges) {
    const outbound = ownerIds.has(edge.from);
    const inbound = ownerIds.has(edge.to);
    if (!outbound && !inbound) continue;
    const target = nodes.get(outbound ? edge.to : edge.from);
    if (target?.subject === void 0) continue;
    const relation = Object.freeze({
      role: edge.role ?? (outbound ? "outbound" : "inbound"),
      subjectId: target.subject,
      label: target.label,
      kind: target.kind ?? target.type,
      ...edge.dead === true ? { dead: true } : {}
    });
    const key = relationFactKey(relation);
    const previous = relations.get(key);
    if (previous === void 0 || previous.dead === true && relation.dead !== true) {
      relations.set(key, relation);
    }
  }
  return Object.freeze(
    [...relations.values()].sort((a, b) => compareUtf8(relationFactKey(a), relationFactKey(b)))
  );
}
function createDescriptorFallbackSubjectFactsSource(options) {
  const groups = descriptorFactGroups(options.descriptor);
  const factsByGroup = new Map(groups.map((item) => [item.group.id, item.facts]));
  const relations = graphRelations(options.descriptor, options.relations);
  const summary = async () => {
    const related = await relations;
    const preview = descriptorPreview(options.descriptor, options.kindDefinition);
    return Object.freeze({
      snapshotId: `fallback-card:${options.descriptor.subjectUri}@${options.descriptor.revision}`,
      identity: descriptorIdentity(options.descriptor),
      groupCount: groups.length,
      relationCount: related.length,
      ...preview === void 0 ? {} : { preview },
      ...options.kindDefinition?.card === void 0 ? {} : { card: Object.freeze({ ...options.kindDefinition.card }) }
    });
  };
  return Object.freeze({
    async summary(signal) {
      signal?.throwIfAborted();
      return summary();
    },
    async groups(page, signal) {
      signal?.throwIfAborted();
      return pageOf(
        groups.map((item) => item.group),
        page
      );
    },
    async facts(groupId, page, signal) {
      signal?.throwIfAborted();
      return pageOf(factsByGroup.get(groupId) ?? [], page);
    },
    async relations(page, signal) {
      signal?.throwIfAborted();
      return pageOf(await relations, page);
    }
  });
}
async function materializeFacts(source, options) {
  const summary = await source.summary(options.signal);
  const groups = await readAll(
    source.groups.bind(source),
    options.maxGroups,
    options.pageSize,
    options.signal
  );
  const facts = /* @__PURE__ */ new Map();
  for (const group of groups.items) {
    const page = await readAll(
      (request, signal) => source.facts(group.id, request, signal),
      options.maxFactsPerGroup,
      options.pageSize,
      options.signal
    );
    facts.set(group.id, page.items);
  }
  const relations = await readAll(
    source.relations.bind(source),
    options.maxRelations,
    options.pageSize,
    options.signal
  );
  return Object.freeze({ summary, groups: groups.items, facts, relations: relations.items });
}
function createCompositeSubjectFactsSource(sources, input = {}) {
  if (sources.length === 0) throw new TypeError("subject facts composition requires a source");
  const options = {
    maxGroups: positive(input.maxGroups ?? DEFAULT_FACTS_MERGE.maxGroups, "maxGroups"),
    maxFactsPerGroup: positive(
      input.maxFactsPerGroup ?? DEFAULT_FACTS_MERGE.maxFactsPerGroup,
      "maxFactsPerGroup"
    ),
    maxRelations: positive(input.maxRelations ?? DEFAULT_FACTS_MERGE.maxRelations, "maxRelations"),
    pageSize: positive(input.pageSize ?? DEFAULT_FACTS_MERGE.pageSize, "pageSize"),
    ...input.signal === void 0 ? {} : { signal: input.signal }
  };
  const snapshot = (async () => {
    const loaded = [];
    for (const source of sources) loaded.push(await materializeFacts(source, options));
    const groupMap = /* @__PURE__ */ new Map();
    const factMaps = /* @__PURE__ */ new Map();
    const relationMap = /* @__PURE__ */ new Map();
    for (const item of loaded) {
      for (const group of item.groups) {
        if (!groupMap.has(group.id)) groupMap.set(group.id, group);
        const facts2 = factMaps.get(group.id) ?? /* @__PURE__ */ new Map();
        for (const fact of item.facts.get(group.id) ?? []) {
          const key = `${fact.id}\0${fact.locale ?? ""}`;
          if (!facts2.has(key)) facts2.set(key, fact);
        }
        factMaps.set(group.id, facts2);
      }
      for (const relation of item.relations) {
        const key = relationFactKey(relation);
        const previous = relationMap.get(key);
        if (previous === void 0 || previous.dead === true && relation.dead !== true) {
          relationMap.set(key, relation);
        }
      }
    }
    const groups = Object.freeze(
      [...groupMap.values()].map(
        (group) => Object.freeze({ ...group, factCount: factMaps.get(group.id)?.size ?? 0 })
      )
    );
    const facts = new Map(
      [...factMaps.entries()].map(([groupId, values]) => [
        groupId,
        Object.freeze([...values.values()])
      ])
    );
    const relations = Object.freeze(
      [...relationMap.values()].sort((a, b) => compareUtf8(relationFactKey(a), relationFactKey(b)))
    );
    const primary = loaded[0];
    const preview = loaded.find((item) => item.summary.preview !== void 0)?.summary.preview;
    const card = loaded.find((item) => item.summary.card !== void 0)?.summary.card;
    const summary = Object.freeze({
      snapshotId: `composite:${loaded.map((item) => item.summary.snapshotId).join("|")}`,
      identity: primary.summary.identity,
      groupCount: groups.length,
      relationCount: relations.length,
      ...preview === void 0 ? {} : { preview },
      ...card === void 0 ? {} : { card }
    });
    return { summary, groups, facts, relations };
  })();
  return Object.freeze({
    async summary(signal) {
      signal?.throwIfAborted();
      return (await snapshot).summary;
    },
    async groups(page, signal) {
      signal?.throwIfAborted();
      return pageOf((await snapshot).groups, page);
    },
    async facts(groupId, page, signal) {
      signal?.throwIfAborted();
      return pageOf((await snapshot).facts.get(groupId) ?? [], page);
    },
    async relations(page, signal) {
      signal?.throwIfAborted();
      return pageOf((await snapshot).relations, page);
    }
  });
}
function descriptorSubjectRef(descriptor) {
  return parseSubjectRef(descriptor.subjectUri);
}
var DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET;
var DEFAULT_GRAPH_MERGE;
var DEFAULT_FACTS_MERGE;
var init_subject_projection = __esm({
  "packages/host/src/subject-projection.ts"() {
    "use strict";
    init_subject_field_projections();
    DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET = Object.freeze({
      maxDepth: 32,
      maxValues: 16384,
      maxEdges: 4096,
      maxScalarBytes: 1048576,
      pageSize: 256
    });
    DEFAULT_GRAPH_MERGE = Object.freeze({
      maxNodes: 16384,
      maxEdges: 65536,
      pageSize: 256
    });
    DEFAULT_FACTS_MERGE = Object.freeze({
      maxGroups: 256,
      maxFactsPerGroup: 4096,
      maxRelations: 16384,
      pageSize: 256
    });
  }
});
init_subject_field_projections();
var projection = () => Promise.resolve().then(() => (init_subject_projection(), subject_projection_exports));
function rejected(reason, message) {
  return {
    state: "rejected",
    reason,
    diagnostics: [diagnostic("error", `x3.host/${reason}`, message)]
  };
}
function snapshotInput(input) {
  try {
    return JSON.parse(canonicalJsonStringify(input));
  } catch {
    return void 0;
  }
}
function snapshotStructured(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value))
    return Object.freeze(value.map((item) => snapshotStructured(item)));
  if (typeof value === "object" && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Reflect.ownKeys(value).map((key) => [
          key,
          snapshotStructured(value[key])
        ])
      )
    );
  }
  return value;
}
function snapshotOutput(output) {
  switch (output.kind) {
    case "json": {
      const value = snapshotInput(output.value);
      if (value === void 0) {
        throw new ModkitError({
          code: "x3.host/non-json-operation-output",
          message: "operation JSON output must be inert JSON data"
        });
      }
      return Object.freeze({ kind: "json", value });
    }
    case "bytes":
      return Object.freeze({
        kind: "bytes",
        value: Uint8Array.from(output.value),
        ...typeof output.extension === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u.test(output.extension) ? { extension: output.extension } : {},
        ...typeof output.mediaType === "string" && /^[\w.+-]+\/[\w.+-]+(?:;.{0,200})?$/u.test(output.mediaType) ? { mediaType: output.mediaType } : {}
      });
    case "source":
      return Object.freeze({
        kind: "source",
        source: Object.freeze({
          ...output.source,
          ...output.source.parentIds === void 0 ? {} : {
            parentIds: Object.freeze([...output.source.parentIds])
          }
        })
      });
    case "artifact":
      return Object.freeze({ ...output });
    case "none":
      return Object.freeze({ kind: "none" });
    case "stream":
      return Object.freeze({ kind: "stream", stream: output.stream });
    case "edit-plan":
      return Object.freeze({ kind: "edit-plan", plan: snapshotStructured(output.plan) });
    case "transaction":
      return Object.freeze({ kind: "transaction", receipt: snapshotStructured(output.receipt) });
  }
}
function staleDiagnostic(expected, actual) {
  return Object.freeze({
    id: "session-stale-revision",
    category: "operation",
    ...diagnostic(
      "error",
      "x3.host/stale-revision",
      `asset session revision ${expected} no longer matches source revision ${actual}`
    )
  });
}
async function assembleSubjectDescriptor(value) {
  const result = await validateSubjectDescriptorV2(value);
  if (result.descriptor !== void 0) return result.descriptor;
  throw new ModkitError({
    code: "x3.host/invalid-subject-descriptor",
    message: "subject descriptor assembly failed validation",
    context: {
      diagnostics: result.diagnostics.map((item) => ({
        code: item.code,
        severity: item.severity,
        message: item.message,
        ...item.path === void 0 ? {} : { path: item.path }
      }))
    }
  });
}
function createAssetSession(options) {
  const maxOperationDiagnostics = options.maxOperationDiagnostics ?? 100;
  if (!Number.isSafeInteger(maxOperationDiagnostics) || maxOperationDiagnostics < 0)
    throw new TypeError("invalid maxOperationDiagnostics");
  const originalDescriptor = options.descriptor;
  const originalOffers = new Set(
    originalDescriptor.dataSources.map((item) => `${item.contract}@${item.major}`)
  );
  const metadataFields = originalDescriptor.interpretation === "codec" ? metadataFieldProjections(originalDescriptor.metadata) : Object.freeze([]);
  const projectsRelations = options.subjectProjection !== void 0 && metadataFields.length > 0;
  const added = [];
  if (!originalOffers.has("common.view/subject-facts-source@1")) {
    added.push({ contract: "common.view/subject-facts-source", major: 1 });
  }
  if (projectsRelations && !originalOffers.has("common.view/relation-graph-source@1")) {
    added.push({ contract: "common.view/relation-graph-source", major: 1 });
  }
  const descriptor = Object.freeze({
    ...originalDescriptor,
    dataSources: Object.freeze([...originalDescriptor.dataSources, ...added]),
    ...added.length === 0 ? {} : { hostDataSources: Object.freeze(added) }
  });
  const operationByHandler = new Map(descriptor.operations.map((item) => [item.handlerId, item]));
  const declarationByHandler = new Map(
    options.operationDeclarations.map((item) => [item.handlerId, item])
  );
  const handlers = new Map(options.handlers);
  const releases = [...options.release ?? []];
  const subscribers = /* @__PURE__ */ new Set();
  let state = "live";
  let disposal;
  let genericGraph;
  const projectedGraph = () => {
    if (options.subjectProjection === void 0) {
      throw new TypeError("subject relation projection is unavailable");
    }
    const relations = options.subjectProjection;
    genericGraph ??= (async () => {
      const built = await projection();
      return built.createFieldRelationGraphSource({
        owner: built.descriptorSubjectRef(originalDescriptor),
        ownerLabel: originalDescriptor.interpretation === "codec" ? originalDescriptor.identity.formatLabel : originalDescriptor.subjectUri,
        ownerKind: originalDescriptor.interpretation === "codec" ? `format:${originalDescriptor.identity.formatId}` : "format:unknown",
        fields: metadataFields,
        resolver: relations.references,
        ...relations.budget === void 0 ? {} : { budget: relations.budget }
      });
    })();
    return genericGraph;
  };
  const releaseTogether = (value, callbacks) => {
    let released = false;
    return Object.freeze({
      value,
      async release() {
        if (released) return;
        released = true;
        const results = await Promise.allSettled(
          [...callbacks].reverse().map((callback) => callback())
        );
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      }
    });
  };
  const openGraph = async () => {
    const authoritative = originalOffers.has("common.view/relation-graph-source@1") ? await options.openDataSource("common.view/relation-graph-source", 1) : void 0;
    try {
      const generic = projectsRelations ? await projectedGraph() : void 0;
      if (authoritative !== void 0 && generic !== void 0) {
        const built = await projection();
        return releaseTogether(
          built.createCompositeRelationGraphSource([authoritative.value, generic]),
          [authoritative.release]
        );
      }
      if (authoritative !== void 0) return authoritative;
      if (generic !== void 0) return releaseTogether(generic, []);
      throw new TypeError("relation graph source is unavailable");
    } catch (error) {
      await authoritative?.release();
      throw error;
    }
  };
  const openFacts = async () => {
    const graph = originalOffers.has("common.view/relation-graph-source@1") || projectsRelations ? await openGraph() : void 0;
    let authoritative;
    try {
      authoritative = originalOffers.has("common.view/subject-facts-source@1") ? await options.openDataSource("common.view/subject-facts-source", 1) : void 0;
      const built = await projection();
      const fallback = built.createDescriptorFallbackSubjectFactsSource({
        descriptor: originalDescriptor,
        ...graph === void 0 ? {} : { relations: graph.value },
        ...options.subjectProjection?.kindDefinition === void 0 ? {} : { kindDefinition: options.subjectProjection.kindDefinition }
      });
      return releaseTogether(
        authoritative === void 0 ? fallback : built.createCompositeSubjectFactsSource([authoritative.value, fallback]),
        [
          ...authoritative === void 0 ? [] : [authoritative.release],
          ...graph === void 0 ? [] : [graph.release]
        ]
      );
    } catch (error) {
      await Promise.allSettled([
        ...authoritative === void 0 ? [] : [authoritative.release()],
        ...graph === void 0 ? [] : [graph.release()]
      ]);
      throw error;
    }
  };
  const publish = (event) => {
    for (const subscriber of subscribers) {
      subscriber.queue.push(event);
      subscriber.wake?.();
      subscriber.wake = void 0;
    }
  };
  const operations = {
    async invoke(handlerId, input, invokeOptions = {}) {
      const operation = operationByHandler.get(handlerId);
      const declaration = declarationByHandler.get(handlerId);
      if (operation === void 0 || declaration === void 0 || declaration.id !== operation.id) {
        return rejected("not-declared", `handler ${handlerId} is not declared by this asset`);
      }
      if (operation.state === "disabled") {
        return rejected("disabled", operation.reason);
      }
      if (operation.state === "dependency-required") {
        return rejected("dependency-required", operation.reason);
      }
      if (state === "stale-revision") {
        return rejected("stale-revision", "the source changed; reopen the asset explicitly");
      }
      if (state === "disposed") {
        return rejected("cancelled", "the asset session has been disposed");
      }
      if (invokeOptions.signal?.aborted) {
        return rejected("cancelled", "the operation was cancelled before dispatch");
      }
      const required = declaration.requiredPermissions ?? [];
      const validity = grantValidity(options.permissionGrant);
      const missing = required.filter((item) => !options.permissionGrant.classes.includes(item));
      if (validity.state !== "valid" || missing.length > 0) {
        return rejected(
          "permission-missing",
          validity.state === "valid" ? `operation requires permissions: ${missing.join(", ")}` : "the operation permission grant is not valid"
        );
      }
      const ownedInput = snapshotInput(input);
      if (ownedInput === void 0) {
        return rejected("input-not-serializable", "operation input must be inert JSON data");
      }
      const handler = handlers.get(handlerId);
      if (handler === void 0) {
        return rejected("handler-unregistered", `handler ${handlerId} is not registered`);
      }
      try {
        throwIfAborted(invokeOptions.signal);
        const diagnostics = [];
        let reporting = true;
        const reportDiagnostic = (value) => {
          if (!reporting || maxOperationDiagnostics === 0) return;
          if (diagnostics.length >= maxOperationDiagnostics) {
            diagnostics[maxOperationDiagnostics - 1] = diagnostic(
              "information",
              "x3.host/operation-diagnostics-truncated",
              "Further operation diagnostics were omitted by the session budget."
            );
            return;
          }
          try {
            const encoded = canonicalJsonStringify(value);
            if (encoded.length > 65536) throw new TypeError("oversized diagnostic");
            const owned = JSON.parse(encoded);
            if (!["error", "warning", "information", "hint"].includes(owned.severity) || typeof owned.message !== "string" || typeof owned.code !== "string")
              throw new TypeError("invalid diagnostic");
            diagnostic(owned.severity, owned.code, owned.message);
            diagnostics.push(snapshotStructured(owned));
          } catch {
            diagnostics.push(
              diagnostic(
                "warning",
                "x3.host/invalid-operation-diagnostic",
                "An operation diagnostic was not bounded, serializable diagnostic data."
              )
            );
          }
        };
        let output;
        try {
          output = snapshotOutput(await handler(ownedInput, { ...invokeOptions, reportDiagnostic }));
        } finally {
          reporting = false;
        }
        throwIfAborted(invokeOptions.signal);
        if (declaration.outputKinds !== void 0 && !declaration.outputKinds.includes(output.kind)) {
          throw new ModkitError({
            code: "x3.host/undeclared-operation-output",
            message: `handler ${handlerId} returned undeclared output kind ${output.kind}`,
            context: { handlerId, outputKind: output.kind }
          });
        }
        return { state: "ok", output, diagnostics: Object.freeze(diagnostics) };
      } catch (error) {
        if (isCancellation(error) || invokeOptions.signal?.aborted) {
          return rejected("cancelled", "the operation was cancelled");
        }
        if (error instanceof ModkitError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new ModkitError({
          code: "x3.host/operation-handler-failed",
          message: `operation handler ${handlerId} failed: ${reason}`,
          context: { handlerId },
          cause: error
        });
      }
    },
    async dispose() {
      await dispose();
    }
  };
  const dispose = async () => {
    if (disposal !== void 0) return disposal;
    disposal = (async () => {
      state = "disposed";
      publish({ kind: "state", state });
      const failures = [];
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
      for (const subscriber of subscribers) {
        subscriber.wake?.();
        subscriber.wake = void 0;
      }
      if (failures.length > 0) {
        throw new ModkitError({
          code: "x3.host/session-dispose-failed",
          message: `${failures.length} asset session resource release(s) failed`,
          context: { failureCount: failures.length },
          cause: failures[0]
        });
      }
    })();
    return disposal;
  };
  const session = Object.freeze({
    revision: options.revision,
    state: () => state,
    descriptor: async () => descriptor,
    async dataSource(contract, major) {
      if (state !== "live") {
        throw new ModkitError({
          code: state === "stale-revision" ? "x3.host/stale-revision" : "x3.host/session-disposed",
          message: state === "stale-revision" ? "the source changed; reopen the asset before accessing data sources" : "the asset session has been disposed"
        });
      }
      if (contract === "common.view/relation-graph-source" && major === 1) {
        return openGraph();
      }
      if (contract === "common.view/subject-facts-source" && major === 1) {
        return openFacts();
      }
      return options.openDataSource(contract, major);
    },
    operations: () => operations,
    async *events(signal) {
      if (signal?.aborted) return;
      yield { kind: "descriptor", descriptor };
      if (state !== "live") {
        yield { kind: "state", state };
        return;
      }
      const subscriber = { queue: [], wake: void 0 };
      subscribers.add(subscriber);
      const onAbort = () => subscriber.wake?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (!signal?.aborted) {
          const event = subscriber.queue.shift();
          if (event !== void 0) {
            yield event;
            if (event.kind === "state" && event.state === "disposed") return;
            continue;
          }
          if (state === "disposed") return;
          await new Promise((resolve) => {
            subscriber.wake = resolve;
          });
        }
      } finally {
        subscribers.delete(subscriber);
        signal?.removeEventListener("abort", onAbort);
      }
    },
    dispose
  });
  return Object.freeze({
    session,
    updateSourceRevision(revision) {
      if (state !== "live" || revision === options.revision) return;
      state = "stale-revision";
      const item = staleDiagnostic(options.revision, revision);
      publish({ kind: "diagnostic", diagnostic: item });
      publish({ kind: "state", state });
    }
  });
}
var DEFAULT_CHUNK_BYTES = 64 * 1024;
function safeLength(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ModkitError({
      code: "x3.host/text-source-too-large",
      message: "text source exceeds the exact JavaScript indexing range"
    });
  }
  return Number(value);
}
async function readBounded(source, offset, length, chunkBytes, signal) {
  const total = safeLength(length);
  const result = new Uint8Array(total);
  let written = 0;
  while (written < total) {
    throwIfAborted(signal);
    const next = await source.read(
      offset + BigInt(written),
      Math.min(chunkBytes, total - written),
      signal
    );
    if (next.byteLength === 0) break;
    result.set(next, written);
    written += next.byteLength;
  }
  return written === total ? result : result.slice(0, written);
}
function cursor(offset, line) {
  return `v1:${offset}:${line}`;
}
function parseCursor(value) {
  const match = /^v1:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(value);
  if (match === null) {
    throw new ModkitError({
      code: "x3.host/invalid-text-cursor",
      message: "text cursor is malformed or belongs to another implementation version"
    });
  }
  const line = Number(match[2]);
  if (!Number.isSafeInteger(line)) {
    throw new ModkitError({
      code: "x3.host/invalid-text-cursor",
      message: "text cursor line is outside the exact JavaScript range"
    });
  }
  return { offset: BigInt(match[1]), line };
}
function createUtf8TextDataSource(source, options = {}) {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new TypeError("text source chunkBytes must be a positive safe integer");
  }
  let indexPromise;
  const buildIndex = async (signal) => {
    const size = await source.size();
    const first = await source.read(0n, 3, signal);
    const bom = first[0] === 239 && first[1] === 187 && first[2] === 191;
    const lineStarts = [bom ? 3n : 0n];
    const newlineKinds = /* @__PURE__ */ new Set();
    let lineStart = lineStarts[0];
    let longest = 0n;
    let offset = 0n;
    let pendingCr;
    while (offset < size) {
      throwIfAborted(signal);
      const bytes = await source.read(
        offset,
        Math.min(chunkBytes, safeLength(size - offset)),
        signal
      );
      if (bytes.byteLength === 0) break;
      for (let index2 = 0; index2 < bytes.byteLength; index2 += 1) {
        const absolute = offset + BigInt(index2);
        const byte = bytes[index2];
        if (pendingCr !== void 0) {
          if (byte === 10) {
            newlineKinds.add("crlf");
            longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
            lineStart = absolute + 1n;
            lineStarts.push(lineStart);
            pendingCr = void 0;
            continue;
          }
          newlineKinds.add("cr");
          longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
          lineStart = pendingCr + 1n;
          lineStarts.push(lineStart);
          pendingCr = void 0;
        }
        if (byte === 13) pendingCr = absolute;
        else if (byte === 10) {
          newlineKinds.add("lf");
          longest = longest > absolute - lineStart ? longest : absolute - lineStart;
          lineStart = absolute + 1n;
          lineStarts.push(lineStart);
        }
      }
      offset += BigInt(bytes.byteLength);
    }
    if (pendingCr !== void 0) {
      newlineKinds.add("cr");
      longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
      lineStart = pendingCr + 1n;
      lineStarts.push(lineStart);
    }
    longest = longest > size - lineStart ? longest : size - lineStart;
    const kinds = [...newlineKinds];
    return Object.freeze({
      size,
      bom,
      lineStarts: Object.freeze(lineStarts),
      newline: kinds.length > 1 ? "mixed" : kinds[0] ?? "lf",
      longestLineBytes: longest > BigInt(Number.MAX_SAFE_INTEGER) ? "unknown" : Number(longest)
    });
  };
  const index = (signal) => {
    indexPromise ??= buildIndex(signal);
    return indexPromise;
  };
  const slice = async (request, signal) => {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new ModkitError({
        code: "x3.host/invalid-text-page",
        message: "text page maxBytes must be a positive safe integer"
      });
    }
    const facts = await index(signal);
    let fromLine;
    let start;
    let requestedEnd;
    if (request.kind === "from-line") {
      if (!Number.isSafeInteger(request.line) || request.line < 0 || !Number.isSafeInteger(request.lineCount) || request.lineCount <= 0) {
        throw new ModkitError({
          code: "x3.host/invalid-text-page",
          message: "text line and lineCount must be safe non-negative page coordinates"
        });
      }
      fromLine = request.line;
      start = facts.lineStarts[fromLine] ?? facts.size;
      requestedEnd = facts.lineStarts[fromLine + request.lineCount] ?? facts.size;
    } else {
      const parsed = parseCursor(request.cursor);
      fromLine = parsed.line;
      start = parsed.offset;
      requestedEnd = facts.size;
    }
    if (start > facts.size) {
      throw new ModkitError({
        code: "x3.host/invalid-text-cursor",
        message: "text cursor points beyond the current source revision"
      });
    }
    const pageEnd = start + BigInt(request.maxBytes);
    const end = [facts.size, requestedEnd, pageEnd].reduce(
      (left, right) => left < right ? left : right
    );
    const bytes = await readBounded(source, start, end - start, chunkBytes, signal);
    throwIfAborted(signal);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const actualEnd = start + BigInt(bytes.byteLength);
    let nextLine = fromLine;
    while (nextLine + 1 < facts.lineStarts.length && facts.lineStarts[nextLine + 1] <= actualEnd) {
      nextLine += 1;
    }
    const complete = actualEnd >= facts.size;
    return complete ? { complete: true, text, fromLine, lineCount: nextLine - fromLine + (text === "" ? 0 : 1) } : {
      complete: false,
      text,
      fromLine,
      lineCount: nextLine - fromLine + (text === "" ? 0 : 1),
      nextCursor: cursor(actualEnd, nextLine)
    };
  };
  return Object.freeze({
    async info() {
      const facts = await index();
      return {
        bytes: facts.size,
        encoding: "utf-8",
        bom: facts.bom,
        newline: facts.newline,
        lines: facts.lineStarts.length,
        longestLineBytes: facts.longestLineBytes
      };
    },
    slice,
    async *search(query, signal) {
      const facts = await index(signal);
      const flags = query.caseSensitive ? "gu" : "giu";
      const expression = query.regex ? new RegExp(query.pattern, flags) : new RegExp(query.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      for (let line = 0; line < facts.lineStarts.length; line += 1) {
        throwIfAborted(signal);
        const start = facts.lineStarts[line];
        const end = facts.lineStarts[line + 1] ?? facts.size;
        const bytes = await readBounded(source, start, end - start, chunkBytes, signal);
        const text = new TextDecoder().decode(bytes);
        for (const match of text.matchAll(expression)) {
          const prefixBytes = new TextEncoder().encode(text.slice(0, match.index)).byteLength;
          const matchBytes = new TextEncoder().encode(match[0]).byteLength;
          yield Object.freeze({
            byteOffset: uint64(start + BigInt(prefixBytes)),
            byteLength: uint64(BigInt(matchBytes))
          });
          if (match[0] === "") expression.lastIndex += 1;
        }
      }
    }
  });
}

// packages/sdk/dist/codec.js
var REVISION_KINDS = Object.freeze([
  "content-hash",
  "git-object",
  "etag",
  "database-version",
  "provider-token",
  "overlay-generation"
]);
var REVISION_KIND_PATTERN = REVISION_KINDS.join("|");
var REVISION_ALGORITHM_PATTERN = "[a-z0-9]+(?:-[a-z0-9]+)*";
var REVISION_VALUE_PATTERN = "(?:[A-Za-z0-9_.!~*'()\\-]|%[0-9A-F]{2})+";
var REVISION_ID_PATTERN = `^(?:${REVISION_KIND_PATTERN})(?:\\.${REVISION_ALGORITHM_PATTERN})?:${REVISION_VALUE_PATTERN}$`;
var REVISION_ID = new RegExp(REVISION_ID_PATTERN);
function parseRevisionRef(value) {
  if (!REVISION_ID.test(value)) return void 0;
  const colon = value.indexOf(":");
  const coordinate = value.slice(0, colon);
  const dot = coordinate.indexOf(".");
  const kind = dot === -1 ? coordinate : coordinate.slice(0, dot);
  const algorithm = dot === -1 ? void 0 : coordinate.slice(dot + 1);
  const encoded = value.slice(colon + 1);
  try {
    const decoded = decodeURIComponent(encoded);
    if (decoded.length === 0 || encodeURIComponent(decoded) !== encoded) return void 0;
    return Object.freeze({
      kind,
      value: decoded,
      ...algorithm === void 0 ? {} : { algorithm }
    });
  } catch {
    return void 0;
  }
}
function isRevisionId(value) {
  return parseRevisionRef(value) !== void 0;
}
function revisionId(value) {
  if (!isRevisionId(value)) throw new TypeError("revision id must be a canonical kind-tagged value");
  return value;
}
function toPortableProjectionReceipt(receipt, identity) {
  const { form, sourceUri, ...rest } = receipt;
  void form;
  void sourceUri;
  return { ...rest, form: "portable", sourceIdentity: identity };
}

export {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
  revisionId,
  toPortableProjectionReceipt
};
