import {
  compareUtf8,
  parseSubjectRef,
  rootSubject,
  serializeSubjectRef
} from "./chunk-CIWTP27X.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/host/dist/subject-projection.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/host/dist/subject-field-projections.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function referencePath(path, segment) {
  return path === "" ? segment : `${path}.${segment}`;
}
function metadataFieldProjections(groups) {
  return Object.freeze(groups.flatMap((group) => group.entries.flatMap((entry) => entry.type === void 0 ? [] : [{ path: referencePath(group.id, entry.key), type: entry.type, value: entry.value }])));
}

// ../MODDING/modkit-core/packages/sdk/dist/subjects/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/sdk/dist/subjects/unknown-root.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/host/dist/subject-projection.js
var DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET = Object.freeze({
  maxDepth: 32,
  maxValues: 16384,
  maxEdges: 4096,
  maxScalarBytes: 1048576,
  pageSize: 256
});
var DEFAULT_GRAPH_MERGE = Object.freeze({
  maxNodes: 16384,
  maxEdges: 65536,
  pageSize: 256
});
var DEFAULT_FACTS_MERGE = Object.freeze({
  maxGroups: 256,
  maxFactsPerGroup: 4096,
  maxRelations: 16384,
  pageSize: 256
});
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${label} must be positive`);
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
  if (typeof value === "object" && value !== null)
    state.valueStack.delete(value);
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
      if (state.capped)
        return;
      await visitField(state, type, item, `${path}[${index}]`, depth + 1);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0)
    await addReference(state, type, value, path);
}
async function visitInstructions(state, type, value, path, depth) {
  if (typeof value !== "string")
    return;
  const instructions = type.listDelimiter === void 0 ? [value] : value.split(type.listDelimiter);
  for (const [instructionIndex, instruction] of instructions.entries()) {
    if (state.capped)
      return;
    const parts = instruction.split(type.delimiter);
    const keyword = parts.shift()?.trim();
    if (keyword === void 0 || keyword === "")
      continue;
    const parameters = type.keywords[keyword];
    if (parameters === void 0)
      continue;
    for (const [parameterIndex, parameter] of parameters.entries()) {
      const scalar = parts[parameterIndex];
      if (scalar === void 0)
        break;
      await visitField(state, parameter, scalar.trim(), `${path}[${instructionIndex}].${keyword}[${parameterIndex}]`, depth + 1);
    }
  }
}
async function visitField(state, type, value, path, depth) {
  if (!enterValue(state, value, depth))
    return;
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
        if (!Array.isArray(value))
          return;
        for (const [index, item] of value.entries()) {
          if (state.capped)
            return;
          await visitField(state, type.item, item, `${path}[${index}]`, depth + 1);
        }
        return;
      case "struct": {
        const record = recordOf(value);
        if (record === void 0)
          return;
        for (const field of type.fields) {
          if (state.capped)
            return;
          const child = record[field.key];
          if (child !== void 0)
            await visitField(state, field.type, child, referencePath(path, field.key), depth + 1);
        }
        return;
      }
      case "record": {
        const record = recordOf(value);
        if (record === void 0)
          return;
        for (const key of Object.keys(record).sort(compareUtf8)) {
          if (state.capped)
            return;
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
  for (const node of nodes)
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  return Object.freeze([...counts.entries()].sort(([left], [right]) => compareUtf8(left, right)).map(([id, count], index) => Object.freeze({ id, label: id, count, tone: index })));
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
    if (state.capped)
      break;
    await visitField(state, field.type, field.value, field.path, 0);
  }
  const nodes = Object.freeze([...state.nodes.values()].sort((a, b) => compareUtf8(a.id, b.id)));
  const edges = Object.freeze([...state.edges.values()].sort((a, b) => compareUtf8(relationKey(a), relationKey(b))));
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
  let cursor;
  const seen = /* @__PURE__ */ new Set();
  while (items.length < maximum) {
    signal?.throwIfAborted();
    const page = await read({
      ...cursor === void 0 ? {} : { cursor },
      limit: Math.min(pageSize, maximum - items.length)
    }, signal);
    items.push(...page.items.slice(0, maximum - items.length));
    if (page.nextCursor === void 0)
      return { items: Object.freeze(items), capped: false };
    if (page.items.length === 0 || seen.has(page.nextCursor)) {
      throw new Error("data source returned an invalid continuation cursor");
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { items: Object.freeze(items), capped: cursor !== void 0 };
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
  if (sources.length === 0)
    throw new TypeError("relation graph composition requires a source");
  const options = {
    maxNodes: positive(input.maxNodes ?? DEFAULT_GRAPH_MERGE.maxNodes, "maxNodes"),
    maxEdges: positive(input.maxEdges ?? DEFAULT_GRAPH_MERGE.maxEdges, "maxEdges"),
    pageSize: positive(input.pageSize ?? DEFAULT_GRAPH_MERGE.pageSize, "pageSize"),
    ...input.signal === void 0 ? {} : { signal: input.signal }
  };
  const snapshot = (async () => {
    const loaded = [];
    for (const source of sources)
      loaded.push(await materializeGraph(source, options));
    const nodeMap = /* @__PURE__ */ new Map();
    const edgeMap = /* @__PURE__ */ new Map();
    const typeInfo = /* @__PURE__ */ new Map();
    for (const graph of loaded) {
      for (const type of graph.summary.types) {
        if (!typeInfo.has(type.id))
          typeInfo.set(type.id, { label: type.label, tone: type.tone });
      }
      for (const node of graph.nodes) {
        const previous = nodeMap.get(node.id);
        nodeMap.set(node.id, previous === void 0 ? node : Object.freeze({
          ...node,
          ...previous,
          ...previous.subject === void 0 && node.subject !== void 0 ? { subject: node.subject } : {},
          ...previous.kind === void 0 && node.kind !== void 0 ? { kind: node.kind } : {}
        }));
      }
      for (const edge of graph.edges) {
        const key = relationKey(edge);
        const previous = edgeMap.get(key);
        if (previous === void 0 || previous.dead === true && edge.dead !== true)
          edgeMap.set(key, edge);
      }
    }
    const nodes = Object.freeze([...nodeMap.values()].sort((a, b) => compareUtf8(a.id, b.id)));
    const edges = Object.freeze([...edgeMap.values()].sort((a, b) => compareUtf8(relationKey(a), relationKey(b))));
    const counts = /* @__PURE__ */ new Map();
    for (const node of nodes)
      counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    const types = Object.freeze([...counts.entries()].sort(([a], [b]) => compareUtf8(a, b)).map(([id, count], index) => {
      const known = typeInfo.get(id);
      return Object.freeze({
        id,
        label: known?.label ?? id,
        count,
        tone: known?.tone ?? index
      });
    }));
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
  if (definition?.card?.preview === "none")
    return void 0;
  const contracts = new Set(descriptor.dataSources.map((item) => item.contract));
  const wanted = definition?.card?.preview;
  const hasRaster = contracts.has("common.view/raster-image-source");
  const hasModel = contracts.has("common.view/model-scene-source");
  const hasMedia = contracts.has("common.view/video-media-source") || contracts.has("common.view/audio-media-source");
  if (wanted === "raster" && !hasRaster || wanted === "model" && !hasModel)
    return void 0;
  if (wanted === void 0 && !hasRaster && !hasModel && !hasMedia)
    return void 0;
  const source = descriptorSources(descriptor)[0];
  if (source === void 0)
    return void 0;
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
    origins: Object.freeze(descriptorSources(descriptor).map((source) => Object.freeze({ label: source.id, source })))
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
    const facts = Object.freeze(descriptor.traits.map((trait) => Object.freeze({
      id: trait.id,
      label: trait.id,
      value: trait.state,
      provenance: Object.freeze([])
    })));
    groups.push({ group: { id: "traits", label: "Traits", factCount: facts.length }, facts });
  }
  if (descriptor.interpretation === "codec") {
    for (const group of [...descriptor.metadata].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || compareUtf8(left.id, right.id))) {
      const facts = Object.freeze(group.entries.map((entry) => Object.freeze({
        id: entry.key,
        label: entry.key,
        value: entry.value,
        provenance: Object.freeze([...entry.provenance ?? []]),
        ...entry.note === void 0 ? {} : { note: entry.note },
        ...entry.knowledgeTarget === void 0 ? {} : { knowledgeTarget: entry.knowledgeTarget }
      })));
      groups.push({
        group: { id: group.id, label: group.label, factCount: facts.length },
        facts
      });
    }
  }
  return Object.freeze(groups.map((item) => Object.freeze({ group: Object.freeze(item.group), facts: item.facts })));
}
async function graphRelations(descriptor, source) {
  if (source === void 0)
    return Object.freeze([]);
  const graph = await materializeGraph(source, DEFAULT_GRAPH_MERGE);
  const descriptorSubject = serializeSubjectRef(descriptorSubjectRef(descriptor));
  const ownerIds = new Set(graph.nodes.filter((node) => node.id === descriptorSubject || node.subject === descriptorSubject || node.id === descriptor.subjectUri || node.subject === descriptor.subjectUri).map((node) => node.id));
  ownerIds.add(descriptorSubject);
  ownerIds.add(descriptor.subjectUri);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const relations = /* @__PURE__ */ new Map();
  for (const edge of graph.edges) {
    const outbound = ownerIds.has(edge.from);
    const inbound = ownerIds.has(edge.to);
    if (!outbound && !inbound)
      continue;
    const target = nodes.get(outbound ? edge.to : edge.from);
    if (target?.subject === void 0)
      continue;
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
  return Object.freeze([...relations.values()].sort((a, b) => compareUtf8(relationFactKey(a), relationFactKey(b))));
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
      return pageOf(groups.map((item) => item.group), page);
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
  const groups = await readAll(source.groups.bind(source), options.maxGroups, options.pageSize, options.signal);
  const facts = /* @__PURE__ */ new Map();
  for (const group of groups.items) {
    const page = await readAll((request, signal) => source.facts(group.id, request, signal), options.maxFactsPerGroup, options.pageSize, options.signal);
    facts.set(group.id, page.items);
  }
  const relations = await readAll(source.relations.bind(source), options.maxRelations, options.pageSize, options.signal);
  return Object.freeze({ summary, groups: groups.items, facts, relations: relations.items });
}
function createCompositeSubjectFactsSource(sources, input = {}) {
  if (sources.length === 0)
    throw new TypeError("subject facts composition requires a source");
  const options = {
    maxGroups: positive(input.maxGroups ?? DEFAULT_FACTS_MERGE.maxGroups, "maxGroups"),
    maxFactsPerGroup: positive(input.maxFactsPerGroup ?? DEFAULT_FACTS_MERGE.maxFactsPerGroup, "maxFactsPerGroup"),
    maxRelations: positive(input.maxRelations ?? DEFAULT_FACTS_MERGE.maxRelations, "maxRelations"),
    pageSize: positive(input.pageSize ?? DEFAULT_FACTS_MERGE.pageSize, "pageSize"),
    ...input.signal === void 0 ? {} : { signal: input.signal }
  };
  const snapshot = (async () => {
    const loaded = [];
    for (const source of sources)
      loaded.push(await materializeFacts(source, options));
    const groupMap = /* @__PURE__ */ new Map();
    const factMaps = /* @__PURE__ */ new Map();
    const relationMap = /* @__PURE__ */ new Map();
    for (const item of loaded) {
      for (const group of item.groups) {
        if (!groupMap.has(group.id))
          groupMap.set(group.id, group);
        const facts2 = factMaps.get(group.id) ?? /* @__PURE__ */ new Map();
        for (const fact of item.facts.get(group.id) ?? []) {
          const key = `${fact.id}\0${fact.locale ?? ""}`;
          if (!facts2.has(key))
            facts2.set(key, fact);
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
    const groups = Object.freeze([...groupMap.values()].map((group) => Object.freeze({ ...group, factCount: factMaps.get(group.id)?.size ?? 0 })));
    const facts = new Map([...factMaps.entries()].map(([groupId, values]) => [
      groupId,
      Object.freeze([...values.values()])
    ]));
    const relations = Object.freeze([...relationMap.values()].sort((a, b) => compareUtf8(relationFactKey(a), relationFactKey(b))));
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

export {
  metadataFieldProjections,
  DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET,
  createFieldRelationGraphSource,
  createCompositeRelationGraphSource,
  createDescriptorFallbackSubjectFactsSource,
  createCompositeSubjectFactsSource,
  descriptorSubjectRef
};
