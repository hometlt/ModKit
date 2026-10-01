import {
  createOrbitController
} from "./chunk-O2DY4UGD.js";
import {
  GRAPH_FALLBACK_MESSAGES,
  ViewerMountScope,
  createSurface,
  createViewerMount,
  defineViewerModule,
  safeViewerText,
  setPart,
  setState,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-BD2JSGWD.js";
import {
  relationGraphNeighbourhood
} from "./chunk-BPQHTKO4.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/ui/dist/graph/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/ui/dist/graph/projection.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var FORCE_LAYOUT_LIMIT = 220;
var FIELD_OF_VIEW = 48 * Math.PI / 180;
var NEAR = 0.1;
function hash(value) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
function sphericalPoint(index, count, seed, radius) {
  const y = 1 - 2 * ((index + 0.5) / Math.max(1, count));
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = Math.PI * 2 * (index * 0.61803398875 + seed);
  return [Math.cos(angle) * radial * radius, y * radius, Math.sin(angle) * radial * radius];
}
var rootIndexOf = (input) => input.root === void 0 ? 0 : input.nodes.findIndex((node) => node.id === input.root);
function layoutGalaxyGraph(input) {
  const groups = /* @__PURE__ */ new Map();
  for (const node of input.nodes) {
    const group = groups.get(node.type);
    if (group)
      group.push(node);
    else
      groups.set(node.type, [node]);
  }
  const entries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const cloudRadius = Math.max(280, Math.cbrt(input.nodes.length) * 65);
  const placed = /* @__PURE__ */ new Map();
  entries.forEach(([type, members], groupIndex) => {
    const seed = hash(type) / 4294967295;
    const shell = cloudRadius * (0.35 + 0.65 * (hash(`${type}:shell`) % 1e3 / 1e3));
    const center = sphericalPoint(groupIndex, entries.length, seed, shell);
    const localRadius = 24 + Math.cbrt(members.length) * 19;
    members.forEach((node, localIndex) => {
      const localSeed = hash(node.id) / 4294967295;
      const local = sphericalPoint(localIndex, members.length, localSeed, localRadius);
      placed.set(node, [center[0] + local[0], center[1] + local[1], center[2] + local[2]]);
    });
  });
  const rootIndex = input.clustered === true ? -1 : rootIndexOf(input);
  return input.nodes.map((node, index) => index === rootIndex ? [0, 0, 0] : placed.get(node) ?? [0, 0, 0]);
}
function depths(input, indexById) {
  const result = input.nodes.map(() => 1);
  const rootIndex = rootIndexOf(input);
  if (rootIndex < 0)
    return result;
  const adjacent = input.nodes.map(() => []);
  for (const edge of input.edges) {
    const from = indexById.get(edge.from);
    const to = indexById.get(edge.to);
    if (from === void 0 || to === void 0)
      continue;
    adjacent[from]?.push(to);
    adjacent[to]?.push(from);
  }
  const seen = /* @__PURE__ */ new Set([rootIndex]);
  result[rootIndex] = 0;
  let frontier = [rootIndex];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next = [];
    for (const index of frontier) {
      for (const neighbour of adjacent[index] ?? []) {
        if (seen.has(neighbour))
          continue;
        seen.add(neighbour);
        result[neighbour] = depth;
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return result;
}
function layoutRelationGraph(input) {
  const count = input.nodes.length;
  if (count === 0)
    return [];
  if (count > FORCE_LAYOUT_LIMIT || input.clustered === true)
    return layoutGalaxyGraph(input);
  const indexById = new Map(input.nodes.map((node, index) => [node.id, index]));
  const depth = depths(input, indexById);
  const rootIndex = rootIndexOf(input);
  const bodies = input.nodes.map((node, index) => {
    const seed = hash(node.id) / 4294967295;
    const p = index === rootIndex ? [0, 0, 0] : sphericalPoint(index, count, seed, 95 + Math.max(1, depth[index] ?? 1) * 115);
    return { p, v: [0, 0, 0] };
  });
  const pairs = input.edges.flatMap((edge) => {
    const from = bodies[indexById.get(edge.from) ?? -1];
    const to = bodies[indexById.get(edge.to) ?? -1];
    return from === void 0 || to === void 0 ? [] : [[from, to]];
  });
  const root = bodies[rootIndex];
  for (let iteration = 0; iteration < 150; iteration++) {
    const cooling = 1 - iteration / 175;
    bodies.forEach((a, i) => {
      for (let j = i + 1; j < count; j++) {
        const b = bodies[j];
        if (b === void 0)
          continue;
        const dx = a.p[0] - b.p[0];
        const dy = a.p[1] - b.p[1];
        const dz = a.p[2] - b.p[2];
        const lengthSq = dx * dx + dy * dy + dz * dz;
        const distanceSq = Math.max(100, lengthSq);
        const length = Math.sqrt(lengthSq);
        const k = 55e3 / distanceSq * cooling;
        const fx = length === 0 ? 0 : dx / length * k;
        const fy = length === 0 ? 0 : dy / length * k;
        const fz = length === 0 ? 0 : dz / length * k;
        a.v[0] += fx;
        a.v[1] += fy;
        a.v[2] += fz;
        b.v[0] -= fx;
        b.v[1] -= fy;
        b.v[2] -= fz;
      }
    });
    for (const [from, to] of pairs) {
      const dx = to.p[0] - from.p[0];
      const dy = to.p[1] - from.p[1];
      const dz = to.p[2] - from.p[2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const k = (Math.max(1, length) - 130) * 35e-4 * cooling;
      const fx = length === 0 ? 0 : dx / length * k;
      const fy = length === 0 ? 0 : dy / length * k;
      const fz = length === 0 ? 0 : dz / length * k;
      from.v[0] += fx;
      from.v[1] += fy;
      from.v[2] += fz;
      to.v[0] -= fx;
      to.v[1] -= fy;
      to.v[2] -= fz;
    }
    const damping = -15e-5 * cooling;
    for (const body of bodies) {
      if (body === root)
        continue;
      const { p, v } = body;
      v[0] = (v[0] + p[0] * damping) * 0.82;
      v[1] = (v[1] + p[1] * damping) * 0.82;
      v[2] = (v[2] + p[2] * damping) * 0.82;
      p[0] += v[0];
      p[1] += v[1];
      p[2] += v[2];
    }
    if (root !== void 0)
      root.p = [0, 0, 0];
  }
  return bodies.map((body) => body.p);
}
function frame(positions) {
  if (positions.length === 0)
    return { center: [0, 0, 0], distance: 360 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of positions) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return { center, distance: Math.max(360, radius * 2.45) };
}
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function project(point, camera) {
  const rel = [point[0] - camera.eye[0], point[1] - camera.eye[1], point[2] - camera.eye[2]];
  const depth = -dot(rel, camera.basis.backward);
  if (depth <= NEAR)
    return void 0;
  const focal = camera.height / 2 / Math.tan(FIELD_OF_VIEW / 2);
  const scale = focal / depth;
  return {
    x: camera.width / 2 + dot(rel, camera.basis.right) * scale,
    y: camera.height / 2 - dot(rel, camera.basis.up) * scale,
    depth,
    scale
  };
}
function unproject(dx, dy, depth, camera) {
  const focal = camera.height / 2 / Math.tan(FIELD_OF_VIEW / 2);
  const perPixel = depth / focal;
  const { right, up } = camera.basis;
  return [
    (right[0] * dx - up[0] * dy) * perPixel,
    (right[1] * dx - up[1] * dy) * perPixel,
    (right[2] * dx - up[2] * dy) * perPixel
  ];
}
function pick(hits, x, y, slop = 3) {
  let best = -1;
  let bestDepth = Infinity;
  hits.forEach((hit, index) => {
    if (hit === void 0)
      return;
    if (Math.hypot(hit.x - x, hit.y - y) > hit.radius + slop)
      return;
    if (hit.depth < bestDepth) {
      best = index;
      bestDepth = hit.depth;
    }
  });
  return best;
}
function depthFade(depth, near, far, floor = 0.25) {
  if (far <= near)
    return 1;
  const t = Math.min(1, Math.max(0, (depth - near) / (far - near)));
  return 1 - t * (1 - floor);
}

// ../MODDING/modkit-core/packages/ui/dist/graph/index.js
function positiveLimit(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${label} must be positive`);
  return value;
}
async function loadPages(read, maximum, pageSize, signal) {
  const items = [];
  let cursor;
  const seen = /* @__PURE__ */ new Set();
  while (items.length < maximum) {
    signal?.throwIfAborted();
    const remaining = maximum - items.length;
    const requested = Math.min(pageSize, remaining);
    const page = await read(cursor, requested);
    signal?.throwIfAborted();
    items.push(...page.items.slice(0, requested));
    if (page.items.length > requested) {
      return { items: Object.freeze(items), completeness: "capped" };
    }
    if (page.nextCursor === void 0) {
      return { items: Object.freeze(items), completeness: "complete" };
    }
    if (page.items.length === 0) {
      throw new Error("relation graph source returned an empty page with a continuation cursor");
    }
    if (seen.has(page.nextCursor))
      throw new Error("relation graph source repeated a page cursor");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { items: Object.freeze(items), completeness: "capped" };
}
function loadedCountReason(nodeCount, totalNodes, edgeCount, totalEdges, localizer) {
  return localizer.text("graph.loadedCounts", {
    nodes: nodeCount.toLocaleString(localizer.locale),
    totalNodes: totalNodes.toLocaleString(localizer.locale),
    edges: edgeCount.toLocaleString(localizer.locale),
    totalEdges: totalEdges.toLocaleString(localizer.locale)
  });
}
async function loadRelationGraphOptions(source, options) {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES);
  const nodeLimit = positiveLimit(options.nodeLimit ?? 500, "nodeLimit");
  const edgeLimit = positiveLimit(options.edgeLimit ?? 5e3, "edgeLimit");
  const pageSize = positiveLimit(options.pageSize ?? 250, "pageSize");
  options.signal?.throwIfAborted();
  const summary = await source.summary(options.signal);
  options.signal?.throwIfAborted();
  const [nodeLoad, edgeLoad] = await Promise.all([
    loadPages((cursor, limit) => source.nodes({ ...cursor === void 0 ? {} : { cursor }, limit }, options.signal), nodeLimit, pageSize, options.signal),
    loadPages((cursor, limit) => source.edges({ ...cursor === void 0 ? {} : { cursor }, limit }, options.signal), edgeLimit, pageSize, options.signal)
  ]);
  options.signal?.throwIfAborted();
  const consumerCapped = nodeLoad.completeness === "capped" || edgeLoad.completeness === "capped" || nodeLoad.items.length >= nodeLimit && nodeLoad.items.length < summary.totalNodes || edgeLoad.items.length >= edgeLimit && edgeLoad.items.length < summary.totalEdges;
  const consumerPartial = !consumerCapped && (nodeLoad.items.length < summary.totalNodes || edgeLoad.items.length < summary.totalEdges);
  const consumerCompleteness = consumerCapped ? "capped" : consumerPartial ? "partial" : "complete";
  return {
    label: options.label,
    localizer,
    nodes: nodeLoad.items,
    edges: edgeLoad.items,
    types: summary.types,
    totalNodes: summary.totalNodes,
    totalEdges: summary.totalEdges,
    sourceCompleteness: summary.completeness,
    ...summary.reason === void 0 ? {} : { sourceReason: summary.reason },
    consumerCompleteness,
    ...consumerCompleteness === "complete" ? {} : {
      consumerReason: loadedCountReason(nodeLoad.items.length, summary.totalNodes, edgeLoad.items.length, summary.totalEdges, localizer)
    },
    cap: nodeLimit
  };
}
var WALK_SCAN_LIMIT = 1e5;
var GRAPH_WALK_DEPTHS = [1, 2, 3, 4];
async function loadRelationNeighbourhoodOptions(source, walk, options) {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES);
  const nodeLimit = positiveLimit(options.nodeLimit ?? 500, "nodeLimit");
  const edgeLimit = positiveLimit(options.edgeLimit ?? 5e3, "edgeLimit");
  const summary = await source.summary(options.signal);
  const found = await relationGraphNeighbourhood(source, {
    roots: [walk.root],
    depth: walk.depth,
    direction: walk.direction,
    maxNodes: nodeLimit,
    maxEdges: edgeLimit,
    scanLimit: WALK_SCAN_LIMIT
  }, options.signal);
  const degree = /* @__PURE__ */ new Map();
  for (const edge of found.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const rank = (node) => node.id === walk.root ? Number.POSITIVE_INFINITY : degree.get(node.id) ?? 0;
  const nodes = [...found.nodes].sort((left, right) => rank(right) - rank(left));
  const counts = /* @__PURE__ */ new Map();
  for (const node of nodes)
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  const stopped = found.capped || !found.scanned.nodes.exhausted || !found.scanned.edges.exhausted;
  return {
    label: options.label,
    localizer,
    nodes,
    edges: found.edges,
    types: summary.types.flatMap((type) => {
      const count = counts.get(type.id) ?? 0;
      return count === 0 ? [] : [{ ...type, count }];
    }),
    totalNodes: nodes.length,
    totalEdges: found.edges.length,
    sourceCompleteness: summary.completeness,
    ...summary.reason === void 0 ? {} : { sourceReason: summary.reason },
    consumerCompleteness: stopped ? "capped" : "complete",
    ...stopped ? {
      consumerReason: localizer.text("graph.walkStopped", {
        nodes: nodes.length.toLocaleString(localizer.locale),
        edges: found.edges.length.toLocaleString(localizer.locale)
      })
    } : {},
    cap: nodeLimit
  };
}
var CATEGORICAL = 6;
var RENDERER_3D = "canvas-3d";
var RENDERER_2D = "canvas-2d";
var LABEL_LIMIT = 100;
var FOCUS_MS = 250;
function createRelationGraph(document, options) {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES);
  const cap = options.cap ?? 500;
  const root = document.createElement("div");
  root.className = "modkit-graph";
  root.setAttribute("aria-label", options.label);
  setPart(root, "graph");
  const sidebar = document.createElement("aside");
  sidebar.className = "modkit-graph__sidebar";
  setPart(sidebar, "graph.sidebar");
  const sidebarHead = document.createElement("div");
  sidebarHead.className = "modkit-graph__sidebar-head";
  setPart(sidebarHead, "graph.sidebar-head");
  const heading = document.createElement("span");
  heading.textContent = localizer.text("graph.nodeTypes");
  sidebarHead.append(heading);
  for (const [label, all] of [
    [localizer.text("graph.all"), true],
    [localizer.text("graph.none"), false]
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      for (const id of hidden.keys())
        hidden.set(id, !all);
      syncTypes();
      relayout();
    });
    sidebarHead.append(button);
  }
  sidebar.append(sidebarHead);
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = localizer.text("graph.filterClasses");
  filter.setAttribute("aria-label", localizer.text("graph.filterNodeTypes"));
  filter.className = "modkit-graph__filter";
  sidebar.append(filter);
  const typeList = document.createElement("div");
  typeList.className = "modkit-graph__types";
  typeList.setAttribute("role", "group");
  setPart(typeList, "graph.types");
  sidebar.append(typeList);
  const hidden = new Map(options.types.map((type) => [type.id, false]));
  const typeRows = /* @__PURE__ */ new Map();
  const typeById = new Map(options.types.map((type) => [type.id, type]));
  for (const type of options.types) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "modkit-graph__type";
    row.dataset["tone"] = String(type.tone % CATEGORICAL);
    setPart(row, "graph.type");
    const swatch = document.createElement("span");
    swatch.setAttribute("aria-hidden", "true");
    setPart(swatch, "graph.type-swatch");
    const label = document.createElement("span");
    label.textContent = safeViewerText(type.label, 64);
    const count = document.createElement("span");
    count.textContent = String(type.count);
    setPart(count, "graph.type-count");
    row.append(swatch, label, count);
    row.addEventListener("click", () => {
      hidden.set(type.id, !(hidden.get(type.id) ?? false));
      syncTypes();
      relayout();
    });
    typeList.append(row);
    typeRows.set(type.id, row);
  }
  filter.addEventListener("input", () => {
    const needle = filter.value.trim().toLowerCase();
    for (const type of options.types) {
      const row = typeRows.get(type.id);
      if (row !== void 0)
        row.hidden = needle !== "" && !type.label.toLowerCase().includes(needle);
    }
  });
  const syncTypes = () => {
    for (const [id, row] of typeRows) {
      const off = hidden.get(id) ?? false;
      row.setAttribute("aria-pressed", String(!off));
      setState(row, off ? ["disabled"] : ["active"]);
    }
  };
  const nodeList = document.createElement("select");
  nodeList.size = 8;
  nodeList.className = "modkit-graph__node-list";
  nodeList.setAttribute("aria-label", localizer.text("graph.nodeList"));
  setPart(nodeList, "graph.node-list");
  sidebar.append(nodeList);
  const main = document.createElement("div");
  main.className = "modkit-graph__main";
  setPart(main, "graph.main");
  const controls = document.createElement("div");
  controls.className = "modkit-graph__controls";
  controls.setAttribute("role", "toolbar");
  controls.setAttribute("aria-label", localizer.text("graph.controls"));
  setPart(controls, "graph.controls");
  const status = document.createElement("output");
  status.className = "modkit-graph__status";
  setPart(status, "graph.status");
  controls.append(status);
  const search = document.createElement("input");
  search.type = "search";
  search.className = "modkit-graph__search";
  search.placeholder = localizer.text("graph.search");
  search.setAttribute("aria-label", localizer.text("graph.searchLabel"));
  setPart(search, "graph.search");
  controls.append(search);
  const control = (labelText, values, value) => {
    const wrapper = document.createElement("label");
    wrapper.className = "modkit-graph__control";
    setPart(wrapper, "graph.control");
    wrapper.append(document.createTextNode(labelText));
    const select = document.createElement("select");
    for (const item of values) {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      select.append(option);
    }
    select.value = value;
    wrapper.append(select);
    controls.append(wrapper);
    return select;
  };
  const labelsWrapper = document.createElement("label");
  labelsWrapper.className = "modkit-graph__control";
  setPart(labelsWrapper, "graph.control");
  const labels = document.createElement("input");
  labels.type = "checkbox";
  labels.checked = true;
  labelsWrapper.append(labels, document.createTextNode(localizer.text("graph.labels")));
  controls.append(labelsWrapper);
  const nodeChoices = [.../* @__PURE__ */ new Set([100, 250, 500, 1e3, cap])].sort((left, right) => left - right).map(String);
  const nodesCap = control(localizer.text("graph.nodes"), nodeChoices, String(cap));
  const roles = [...new Set(options.edges.flatMap((edge) => edge.role ? [edge.role] : []))].sort();
  const roleSelect = roles.length === 0 ? void 0 : control(localizer.text("graph.relations"), [localizer.text("graph.allRelations"), ...roles], localizer.text("graph.allRelations"));
  const roleShown = (edge) => roleSelect === void 0 || roleSelect.selectedIndex <= 0 || edge.role === roles[roleSelect.selectedIndex - 1];
  const rendererIds = [RENDERER_3D, RENDERER_2D, ...(options.renderers ?? []).map((item) => item.id)];
  const rendererSelect = control(localizer.text("graph.renderer"), [
    localizer.text("graph.canvas3d"),
    localizer.text("graph.canvas2d"),
    ...(options.renderers ?? []).map((item) => item.label)
  ], localizer.text("graph.canvas3d"));
  let mode = RENDERER_3D;
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = localizer.text("graph.resetView");
  reset.addEventListener("click", () => {
    if (external !== void 0) {
      external.reset();
      return;
    }
    layout();
    draw();
  });
  controls.append(reset);
  const makeRoot = options.onRoot === void 0 ? void 0 : document.createElement("button");
  if (makeRoot !== void 0) {
    makeRoot.type = "button";
    makeRoot.textContent = localizer.text("graph.makeRoot");
    makeRoot.disabled = true;
    makeRoot.addEventListener("click", () => {
      const node = placed[selected]?.node;
      if (node !== void 0)
        options.onRoot?.(node);
    });
    controls.append(makeRoot);
  }
  const syncMakeRoot = () => {
    if (makeRoot !== void 0) {
      makeRoot.disabled = selected < 0 || placed[selected]?.node.id === rootId;
    }
  };
  const stage = document.createElement("div");
  stage.className = "modkit-graph__stage";
  const canvas = document.createElement("canvas");
  canvas.className = "modkit-graph__canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", options.label);
  canvas.tabIndex = 0;
  setPart(canvas, "graph.canvas");
  const tooltip = document.createElement("div");
  tooltip.className = "modkit-graph__tooltip";
  tooltip.hidden = true;
  setPart(tooltip, "graph.tooltip");
  stage.append(canvas, tooltip);
  const hint = document.createElement("p");
  hint.className = "modkit-graph__hint";
  setPart(hint, "graph.hint");
  const syncHint = () => {
    const open2 = options.onOpen !== void 0;
    hint.textContent = localizer.text(mode === RENDERER_2D ? open2 ? "graph.hintOpen" : "graph.hint" : open2 ? "graph.hint3dOpen" : "graph.hint3d");
  };
  syncHint();
  main.append(controls, stage, hint);
  const footer = document.createElement("div");
  footer.className = "modkit-graph__footer";
  setPart(footer, "graph.footer");
  for (const group of options.footer ?? []) {
    const box = document.createElement("section");
    box.className = "modkit-graph__footer-group";
    setPart(box, "graph.footer-group");
    const title = document.createElement("h4");
    title.textContent = safeViewerText(group.title, 64);
    box.append(title);
    for (const item of group.items) {
      const row = document.createElement("div");
      row.className = "modkit-graph__footer-item";
      setPart(row, "graph.footer-item");
      row.textContent = `${safeViewerText(item.label, 64)} (${item.count})`;
      box.append(row);
    }
    footer.append(box);
  }
  root.append(sidebar, main, footer);
  const context = canvas.getContext("2d");
  const view = document.defaultView;
  const reducedMotion = () => view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let placed = [];
  let zoom = 1;
  let originX = 0;
  let originY = 0;
  let dragging;
  let panning = false;
  let last = { x: 0, y: 0 };
  const orbit = createOrbitController();
  let world = [];
  let worldKey = "";
  let framing = frame([]);
  let target = [0, 0, 0];
  let hits = [];
  let hovered = -1;
  let selected = -1;
  let animation = 0;
  const degree = /* @__PURE__ */ new Map();
  for (const edge of options.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const rootId = options.nodes[0]?.id;
  const visibleNodes = () => {
    const limit = Number(nodesCap.value);
    return options.nodes.filter((node) => !(hidden.get(node.type) ?? false)).slice(0, limit);
  };
  const completenessNotice = (owner, completeness, reason) => {
    if (completeness === void 0 || completeness === "complete" && reason === void 0) {
      return void 0;
    }
    const state = completeness === void 0 || completeness === "complete" ? "" : ` ${completeness}`;
    const explanation = reason === void 0 ? "" : `: ${safeViewerText(reason, 240)}`;
    return localizer.text("graph.completeness", {
      owner: localizer.text(owner === "source" ? "graph.source" : "graph.view"),
      state,
      reason: explanation
    });
  };
  const matches = (node) => {
    const needle = search.value.trim().toLowerCase();
    if (needle === "")
      return void 0;
    return node.label.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle);
  };
  const statusText = (drawnEdges, renderer) => {
    const totalNodes = options.totalNodes ?? options.nodes.length;
    const visibleCandidates = options.nodes.filter((node) => !(hidden.get(node.type) ?? false));
    const notices = [
      completenessNotice("source", options.sourceCompleteness, options.sourceReason),
      completenessNotice("view", options.consumerCompleteness, options.consumerReason),
      ...placed.length < visibleCandidates.length ? [
        localizer.text("graph.visibleCapped", {
          count: placed.length.toLocaleString(localizer.locale)
        })
      ] : []
    ].filter((item) => item !== void 0);
    const matched = search.value.trim() === "" ? void 0 : localizer.text("graph.matches", {
      count: placed.filter((item) => matches(item.node)).length.toLocaleString(localizer.locale)
    });
    return [
      localizer.text("graph.nodeCount", {
        visible: placed.length.toLocaleString(localizer.locale),
        total: totalNodes.toLocaleString(localizer.locale)
      }),
      localizer.text("graph.edgeCount", {
        count: drawnEdges.toLocaleString(localizer.locale)
      }),
      matched,
      renderer,
      ...notices
    ].filter((item) => item !== void 0).join(" \xB7 ");
  };
  const syncNodeList = () => {
    nodeList.replaceChildren(...placed.map((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = safeViewerText(item.node.label, 64);
      return option;
    }));
    nodeList.selectedIndex = selected;
  };
  function layout() {
    const nodes = visibleNodes();
    const radius = Math.min(canvas.width, canvas.height) / 2.6;
    placed = nodes.map((node, index) => {
      const angle = index / Math.max(1, nodes.length) * Math.PI * 2;
      const spread = radius * (0.35 + 0.65 * (index * 0.61803398875 % 1));
      return {
        node,
        x: Math.cos(angle) * spread,
        y: Math.sin(angle) * spread,
        vx: 0,
        vy: 0
      };
    });
    zoom = 1;
    originX = 0;
    originY = 0;
    const key = nodes.map((node) => node.id).join("\n");
    if (key !== worldKey) {
      worldKey = key;
      world = layoutRelationGraph({
        nodes,
        edges: options.edges,
        ...rootId === void 0 ? {} : { root: rootId }
      });
      selected = -1;
    }
    framing = frame(world);
    target = [...framing.center];
    orbit.reset();
    hovered = -1;
    tooltip.hidden = true;
    syncNodeList();
  }
  const relayout = () => {
    layout();
    draw();
  };
  const tokens = () => {
    const styles = getComputedStyle(root);
    return (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  };
  const toneOf = (node) => (typeById.get(node.type)?.tone ?? 0) % CATEGORICAL + 1;
  const edgeColour = (token, edge) => edge.dead === true ? token("--mk-color-graph-edge-dead", "#f14c4c") : edge.role === void 0 ? token("--mk-color-graph-edge", "#5a5a5a") : token(`--mk-chart-categorical-${hash(edge.role) % CATEGORICAL + 1}`, "#5a5a5a");
  const cameraNow = () => ({
    target,
    eye: orbit.position(target, framing.distance),
    basis: orbit.basis(),
    width: canvas.width,
    height: canvas.height
  });
  function draw() {
    syncMakeRoot();
    if (context === null) {
      status.textContent = statusText(0);
      return;
    }
    if (mode === RENDERER_3D)
      draw3d(context);
    else
      draw2d(context);
  }
  function draw2d(context2) {
    const token = tokens();
    const width = canvas.width;
    const height = canvas.height;
    context2.setTransform(1, 0, 0, 1, 0, 0);
    context2.fillStyle = token("--mk-color-canvas-bg", "#141414");
    context2.fillRect(0, 0, width, height);
    context2.translate(width / 2 + originX, height / 2 + originY);
    context2.scale(zoom, zoom);
    const index = new Map(placed.map((item) => [item.node.id, item]));
    let drawnEdges = 0;
    context2.lineWidth = 1 / zoom;
    for (const edge of options.edges) {
      if (!roleShown(edge))
        continue;
      const from = index.get(edge.from);
      const to = index.get(edge.to);
      if (from === void 0 || to === void 0)
        continue;
      context2.strokeStyle = edgeColour(token, edge);
      context2.globalAlpha = edge.dead === true ? 0.9 : 0.45;
      context2.beginPath();
      context2.moveTo(from.x, from.y);
      context2.lineTo(to.x, to.y);
      context2.stroke();
      drawnEdges += 1;
    }
    context2.globalAlpha = 1;
    const showLabels = labels.checked;
    placed.forEach((item, position) => {
      const match = matches(item.node);
      context2.globalAlpha = match === false ? 0.2 : 1;
      context2.fillStyle = token(`--mk-chart-categorical-${toneOf(item.node)}`, "#4daafc");
      context2.beginPath();
      context2.arc(item.x, item.y, 4 / zoom + 1, 0, Math.PI * 2);
      context2.fill();
      if (position === selected || match === true) {
        context2.strokeStyle = token("--mk-color-focus", "#0078d4");
        context2.lineWidth = 2 / zoom;
        context2.stroke();
        context2.lineWidth = 1 / zoom;
      }
      if (showLabels && placed.length <= 120 || position === selected) {
        context2.fillStyle = token("--mk-color-fg-muted", "#9d9d9d");
        context2.font = `${11 / zoom}px ${token("--mk-font-sans", "sans-serif")}`;
        context2.fillText(safeViewerText(item.node.label, 40), item.x + 7 / zoom, item.y + 3 / zoom);
      }
    });
    context2.globalAlpha = 1;
    status.textContent = statusText(drawnEdges);
  }
  function draw3d(context2) {
    const token = tokens();
    const width = canvas.width;
    const height = canvas.height;
    context2.setTransform(1, 0, 0, 1, 0, 0);
    context2.fillStyle = token("--mk-color-canvas-bg", "#141414");
    context2.fillRect(0, 0, width, height);
    const camera = cameraNow();
    const projected = world.map((point) => project(point, camera));
    let near = Infinity;
    let far = -Infinity;
    for (const point of projected) {
      if (point === void 0)
        continue;
      near = Math.min(near, point.depth);
      far = Math.max(far, point.depth);
    }
    const index = new Map(placed.map((item, position) => [item.node.id, position]));
    const selectedId = placed[selected]?.node.id;
    let drawnEdges = 0;
    context2.lineWidth = 1;
    for (const edge of options.edges) {
      if (!roleShown(edge))
        continue;
      const fromIndex = index.get(edge.from);
      const toIndex = index.get(edge.to);
      if (fromIndex === void 0 || toIndex === void 0)
        continue;
      const from = projected[fromIndex];
      const to = projected[toIndex];
      if (from === void 0 || to === void 0)
        continue;
      const incident = selectedId !== void 0 && (edge.from === selectedId || edge.to === selectedId);
      const fade = depthFade((from.depth + to.depth) / 2, near, far);
      context2.strokeStyle = edgeColour(token, edge);
      context2.globalAlpha = (edge.dead === true ? 0.9 : 0.45) * fade * (selectedId === void 0 || incident ? 1 : 0.35);
      context2.lineWidth = incident ? 2 : 1;
      context2.beginPath();
      context2.moveTo(from.x, from.y);
      context2.lineTo(to.x, to.y);
      context2.stroke();
      drawnEdges += 1;
    }
    const order = placed.map((_item, position) => position);
    order.sort((a, b) => (projected[b]?.depth ?? 0) - (projected[a]?.depth ?? 0));
    const showLabels = labels.checked && placed.length <= LABEL_LIMIT;
    const font = token("--mk-font-sans", "sans-serif");
    hits = placed.map(() => void 0);
    for (const position of order) {
      const point = projected[position];
      const item = placed[position];
      if (point === void 0 || item === void 0)
        continue;
      const isRoot = item.node.id === rootId;
      const size = isRoot ? 9 : 4.5 + Math.min(4, Math.log2((degree.get(item.node.id) ?? 0) + 1));
      const radius = Math.max(2.5, Math.min(24, size * point.scale * 1.5));
      const match = matches(item.node);
      const fade = depthFade(point.depth, near, far);
      hits[position] = { x: point.x, y: point.y, radius, depth: point.depth };
      context2.globalAlpha = fade * (match === false ? 0.2 : 1);
      context2.fillStyle = isRoot ? token("--mk-color-graph-node", "#cccccc") : token(`--mk-chart-categorical-${toneOf(item.node)}`, "#4daafc");
      context2.beginPath();
      context2.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context2.fill();
      const emphasised = position === selected || position === hovered || match === true;
      if (emphasised) {
        context2.globalAlpha = 1;
        context2.strokeStyle = token("--mk-color-focus", "#0078d4");
        context2.lineWidth = position === selected ? 2.5 : 1.5;
        context2.stroke();
      }
      if (showLabels || emphasised || isRoot) {
        context2.globalAlpha = emphasised ? 1 : fade;
        context2.fillStyle = token(isRoot || emphasised ? "--mk-color-fg" : "--mk-color-fg-muted", "#9d9d9d");
        context2.font = `${isRoot ? "bold " : ""}11px ${font}`;
        context2.fillText(safeViewerText(item.node.label, 40), point.x + radius + 4, point.y + 4);
      }
    }
    context2.globalAlpha = 1;
    context2.lineWidth = 1;
    status.textContent = statusText(drawnEdges);
  }
  orbit.onChange(() => {
    if (mode === RENDERER_3D)
      draw();
  });
  const pointAt = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const pick2d = (event) => {
    const box = canvas.getBoundingClientRect();
    const x = (event.clientX - box.left - canvas.width / 2 - originX) / zoom;
    const y = (event.clientY - box.top - canvas.height / 2 - originY) / zoom;
    return placed.find((item) => Math.hypot(item.x - x, item.y - y) < 8 / zoom);
  };
  const hitIndex = (event) => {
    if (mode === RENDERER_2D) {
      const hit = pick2d(event);
      return hit === void 0 ? -1 : placed.indexOf(hit);
    }
    const { x, y } = pointAt(event);
    return pick(hits, x, y);
  };
  const open = (position) => {
    const item = placed[position];
    if (item !== void 0)
      options.onOpen?.(item.node);
  };
  const focus = (position) => {
    selected = position;
    if (nodeList.selectedIndex !== position)
      nodeList.selectedIndex = position;
    syncMakeRoot();
    const destination = world[position];
    if (view)
      view.cancelAnimationFrame(animation);
    if (mode !== RENDERER_3D || destination === void 0 || !view || reducedMotion()) {
      if (mode === RENDERER_3D && destination !== void 0)
        target = [...destination];
      draw();
      return;
    }
    const start = [...target];
    const began = view.performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / FOCUS_MS);
      const ease = 1 - (1 - t) ** 3;
      target = [
        start[0] + (destination[0] - start[0]) * ease,
        start[1] + (destination[1] - start[1]) * ease,
        start[2] + (destination[2] - start[2]) * ease
      ];
      draw();
      if (t < 1)
        animation = view.requestAnimationFrame(step);
    };
    animation = view.requestAnimationFrame(step);
  };
  const showTooltip = (position, event) => {
    const item = placed[position];
    if (item === void 0) {
      tooltip.hidden = true;
      return;
    }
    const type = typeById.get(item.node.type)?.label ?? item.node.type;
    tooltip.textContent = [item.node.label, type, item.node.kind].filter((part) => part !== void 0 && part !== "").map((part) => safeViewerText(part, 80)).join(" \xB7 ");
    const { x, y } = pointAt(event);
    tooltip.style.setProperty("left", `${x + 14}px`);
    tooltip.style.setProperty("top", `${y + 14}px`);
    tooltip.hidden = false;
  };
  let press;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
    if (mode === RENDERER_2D) {
      dragging = pick2d(event);
      panning = dragging === void 0;
    }
    press = {
      index: hitIndex(event),
      pan: event.button !== 0 || event.shiftKey,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
  });
  canvas.addEventListener("pointermove", (event) => {
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    if (press !== void 0 && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) {
      press.moved = true;
    }
    if (mode === RENDERER_2D) {
      if (dragging === void 0 && !panning)
        return;
      if (dragging !== void 0) {
        dragging.x += dx / zoom;
        dragging.y += dy / zoom;
      } else {
        originX += dx;
        originY += dy;
      }
      draw();
      return;
    }
    if (press === void 0) {
      const next = hitIndex(event);
      canvas.style.setProperty("cursor", next >= 0 ? "pointer" : "");
      if (next !== hovered) {
        hovered = next;
        draw();
      }
      showTooltip(hovered, event);
      return;
    }
    if (!press.moved)
      return;
    tooltip.hidden = true;
    const camera = cameraNow();
    const node = world[press.index];
    if (node !== void 0) {
      const depth = project(node, camera)?.depth ?? framing.distance;
      const offset = unproject(dx, dy, depth, camera);
      world[press.index] = [node[0] + offset[0], node[1] + offset[1], node[2] + offset[2]];
      draw();
    } else if (press.pan) {
      const offset = unproject(dx, dy, framing.distance * orbit.pose.distanceScale, camera);
      target = [target[0] - offset[0], target[1] - offset[1], target[2] - offset[2]];
      draw();
    } else {
      orbit.orbit(-dx, dy);
    }
  });
  const release = (event) => {
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    const clicked = press !== void 0 && !press.moved && press.index >= 0;
    const index = press?.index ?? -1;
    dragging = void 0;
    panning = false;
    press = void 0;
    if (clicked && event.type === "pointerup")
      focus(index);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    if (hovered >= 0 && press === void 0) {
      hovered = -1;
      draw();
    }
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (mode === RENDERER_3D) {
      orbit.zoom(event.deltaY);
      return;
    }
    zoom = Math.max(0.2, Math.min(6, zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
    draw();
  }, { passive: false });
  canvas.addEventListener("dblclick", (event) => {
    const index = hitIndex(event);
    if (index >= 0)
      open(index);
  });
  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 40 : 12;
    if (event.key === "Enter" && selected >= 0)
      open(selected);
    else if (event.key === "Escape") {
      selected = -1;
      nodeList.selectedIndex = -1;
      draw();
    } else if (mode !== RENDERER_3D)
      return;
    else if (event.key === "ArrowLeft")
      orbit.orbit(-step, 0);
    else if (event.key === "ArrowRight")
      orbit.orbit(step, 0);
    else if (event.key === "ArrowUp")
      orbit.orbit(0, -step);
    else if (event.key === "ArrowDown")
      orbit.orbit(0, step);
    else if (event.key === "+" || event.key === "=")
      orbit.zoom(-1);
    else if (event.key === "-")
      orbit.zoom(1);
    else if (event.key === "0") {
      layout();
      draw();
    } else
      return;
    event.preventDefault();
  });
  nodeList.addEventListener("change", () => focus(nodeList.selectedIndex));
  nodeList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || nodeList.selectedIndex < 0)
      return;
    event.preventDefault();
    open(nodeList.selectedIndex);
  });
  nodeList.addEventListener("dblclick", () => {
    if (nodeList.selectedIndex >= 0)
      open(nodeList.selectedIndex);
  });
  search.addEventListener("input", draw);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter")
      return;
    const first = placed.findIndex((item) => matches(item.node) === true);
    if (first >= 0)
      focus(first);
  });
  nodesCap.addEventListener("change", relayout);
  roleSelect?.addEventListener("change", draw);
  labels.addEventListener("change", draw);
  let external;
  const externalHost = document.createElement("div");
  externalHost.className = "modkit-graph__external";
  externalHost.hidden = true;
  setPart(externalHost, "graph.canvas");
  stage.after(externalHost);
  const paletteSnapshot = () => {
    const styles = getComputedStyle(root);
    const read = (name) => styles.getPropertyValue(name).trim();
    const palette = {
      background: read("--mk-color-canvas-bg") || "#141414",
      edge: read("--mk-color-graph-edge") || "#5a5a5a",
      edgeDead: read("--mk-color-graph-edge-dead") || "#f14c4c",
      label: read("--mk-color-fg-muted") || "#9d9d9d"
    };
    for (let index = 1; index <= CATEGORICAL; index += 1) {
      palette[`categorical-${index}`] = read(`--mk-chart-categorical-${index}`) || "#4daafc";
    }
    return palette;
  };
  const externalState = () => ({
    nodes: placed.map((item) => item.node),
    edges: options.edges.filter(roleShown),
    types: options.types,
    labels: labels.checked,
    palette: paletteSnapshot()
  });
  const selectRenderer = () => {
    const index = rendererSelect.selectedIndex;
    const id = rendererIds[index] ?? RENDERER_3D;
    external?.destroy();
    external = void 0;
    mode = id;
    syncHint();
    tooltip.hidden = true;
    if (id === RENDERER_3D || id === RENDERER_2D) {
      stage.hidden = false;
      externalHost.hidden = true;
      resize();
      return;
    }
    const factory = (options.renderers ?? []).find((item) => item.id === id);
    if (factory === void 0)
      return;
    stage.hidden = true;
    externalHost.hidden = false;
    const hooks = options.onOpen === void 0 ? {} : { onOpen: options.onOpen };
    external = factory.create(externalHost, hooks);
    const box = externalHost.getBoundingClientRect();
    external.resize(Math.max(240, Math.round(box.width)), Math.max(200, Math.round(box.height)));
    external.render(externalState());
    const drawn = external.drawnEdges?.() ?? options.edges.length;
    status.textContent = statusText(drawn, factory.label);
  };
  rendererSelect.addEventListener("change", selectRenderer);
  const resize = () => {
    if (external !== void 0) {
      const box2 = externalHost.getBoundingClientRect();
      external.resize(Math.max(240, Math.round(box2.width)), Math.max(200, Math.round(box2.height)));
      external.render(externalState());
      return;
    }
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.max(240, Math.round(box.width));
    canvas.height = Math.max(200, Math.round(box.height));
    layout();
    draw();
  };
  syncTypes();
  queueMicrotask(resize);
  return {
    root,
    resize,
    destroy() {
      if (view)
        view.cancelAnimationFrame(animation);
      external?.destroy();
      root.remove();
    }
  };
}
function createRelationGraphViewer(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES);
  const firstDepth = Math.min(4, Math.max(1, Math.trunc(options.depth ?? 2)));
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("graph.viewer"));
      const document = root.ownerDocument;
      try {
        const lease = await unknownSourceLease(args.sources, args.slot, "common.view/relation-graph-source");
        if (lease === void 0)
          throw new TypeError("relation graph binding is unavailable");
        scope.lease(lease);
        const source = lease.value;
        const label = localizer.text("graph.relation");
        const first = (await source.nodes({ limit: 1 }, scope.signal)).items[0];
        let walk = first === void 0 ? void 0 : { root: first.id, depth: firstDepth, direction: "both" };
        let rootLabel = first?.label ?? "";
        let whole = walk === void 0;
        const bar = document.createElement("div");
        bar.setAttribute("role", "toolbar");
        bar.setAttribute("aria-label", localizer.text("graph.walk"));
        setPart(bar, "graph.walk");
        const rootLine = document.createElement("output");
        const wholeBox = document.createElement("input");
        wholeBox.type = "checkbox";
        wholeBox.checked = whole;
        const wholeLabel = document.createElement("label");
        wholeLabel.append(wholeBox, document.createTextNode(localizer.text("graph.wholeGraph")));
        const choice = (text, values, value) => {
          const wrapper = document.createElement("label");
          wrapper.append(document.createTextNode(text));
          const select = document.createElement("select");
          for (const [id, caption] of values) {
            const option = document.createElement("option");
            option.value = id;
            option.textContent = caption;
            select.append(option);
          }
          select.value = value;
          wrapper.append(select);
          bar.append(wrapper);
          return select;
        };
        bar.append(wholeLabel);
        const depthSelect = choice(localizer.text("graph.depth"), GRAPH_WALK_DEPTHS.map((depth) => [String(depth), String(depth)]), String(firstDepth));
        const directionSelect = choice(localizer.text("graph.direction"), [
          ["both", localizer.text("graph.directionBoth")],
          ["outgoing", localizer.text("graph.directionOutgoing")],
          ["incoming", localizer.text("graph.directionIncoming")]
        ], "both");
        bar.append(rootLine);
        bar.hidden = walk === void 0;
        root.append(bar);
        const syncBar = () => {
          depthSelect.disabled = whole;
          directionSelect.disabled = whole;
          rootLine.textContent = whole ? "" : localizer.text("graph.root", { label: rootLabel });
        };
        const navigation = args.subjectNavigation;
        let graph;
        let pass = 0;
        const show = async () => {
          const current = ++pass;
          syncBar();
          const loaded = whole || walk === void 0 ? await loadRelationGraphOptions(source, { label, localizer, signal: scope.signal }) : await loadRelationNeighbourhoodOptions(source, walk, {
            label,
            localizer,
            signal: scope.signal
          });
          if (current !== pass || scope.signal.aborted)
            return;
          graph?.destroy();
          graph = createRelationGraph(document, {
            ...loaded,
            ...walk === void 0 ? {} : {
              onRoot(node) {
                if (walk === void 0)
                  return;
                walk = { ...walk, root: node.id };
                rootLabel = node.label;
                whole = false;
                wholeBox.checked = false;
                void show().catch(() => void 0);
              }
            },
            ...navigation === void 0 ? {} : {
              onOpen(node) {
                if (node.subject === void 0)
                  return;
                void navigation.open({ scope: navigation.scope, target: node.subject }, scope.signal).catch(() => void 0);
              }
            }
          });
          root.append(graph.root);
        };
        const rewalk = () => {
          if (walk === void 0)
            return;
          walk = {
            ...walk,
            depth: Number(depthSelect.value),
            direction: directionSelect.value
          };
          void show().catch(() => void 0);
        };
        depthSelect.addEventListener("change", rewalk);
        directionSelect.addEventListener("change", rewalk);
        wholeBox.addEventListener("change", () => {
          whole = wholeBox.checked;
          void show().catch(() => void 0);
        });
        await show();
        scope.cleanup(() => graph?.destroy());
        root.dataset["revision"] = args.descriptor.revision;
        return createViewerMount(root, scope, args, ({ descriptor }) => {
          root.dataset["revision"] = descriptor.revision;
        });
      } catch (error) {
        await scope.close();
        root.remove();
        throw error;
      }
    }
  });
}
var relationGraphViewer = createRelationGraphViewer();
var graph_default = relationGraphViewer;

export {
  loadRelationGraphOptions,
  GRAPH_WALK_DEPTHS,
  loadRelationNeighbourhoodOptions,
  createRelationGraph,
  createRelationGraphViewer,
  relationGraphViewer,
  graph_default
};
