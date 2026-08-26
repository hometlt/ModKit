// packages/core/dist/index.js
var SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var QUALIFIED = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
function isSegment(value2) {
  return SEGMENT.test(value2);
}
function isQualifiedId(value2) {
  return QUALIFIED.test(value2);
}
function isErrorCode(value2) {
  return isQualifiedId(value2);
}
function contractId(value2) {
  if (!isQualifiedId(value2)) throw new TypeError(`invalid contract id: ${value2}`);
  return value2;
}
function errorCode(value2) {
  if (!isErrorCode(value2)) throw new TypeError(`invalid diagnostic/error code: ${value2}`);
  return value2;
}
var OPERATION_DOMAINS = Object.freeze([
  "archive",
  "model",
  "image",
  "audio",
  "video",
  "vector",
  "document",
  "game",
  "map",
  "mod",
  "data",
  "script",
  "layout",
  "localization",
  "replay",
  "save",
  "runtime"
]);
var CONTAINER_EXTRACT_OPERATION_ID = "container.extract";
var SHARED_OPERATION_IDS = Object.freeze([
  "view.render",
  "view.inspect",
  "view.thumbnail",
  "view.hex",
  "media.play",
  "media.play-pause",
  "media.seek",
  "media.set-rate",
  "media.select-track",
  "edit.content",
  "edit.structure",
  "edit.field",
  "edit.undo-redo",
  "source.save",
  "source.save-as",
  "export.raw",
  "export.convert",
  CONTAINER_EXTRACT_OPERATION_ID,
  "container.pack",
  "asset.search",
  "asset.validate",
  "asset.compare",
  "content.resolve-dependencies",
  "content.mount"
]);
var SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
function parseSafeInteger(value2) {
  const parsed = Number(value2);
  return Number.isSafeInteger(parsed) ? parsed : void 0;
}
function parseSemver(value2) {
  const m = SEMVER.exec(value2);
  if (!m) return void 0;
  const major = parseSafeInteger(m[1] ?? "");
  const minor = parseSafeInteger(m[2] ?? "");
  const patch = parseSafeInteger(m[3] ?? "");
  if (major === void 0 || minor === void 0 || patch === void 0) return void 0;
  const prerelease = (m[4] ?? "").split(".").filter((part) => part.length > 0).map((part) => /^\d+$/.test(part) ? parseSafeInteger(part) : part);
  if (prerelease.some((part) => part === void 0)) return void 0;
  const build = (m[5] ?? "").split(".").filter((part) => part.length > 0);
  return {
    major,
    minor,
    patch,
    prerelease,
    build
  };
}
function comparePrerelease(a, b) {
  const ap = a.prerelease;
  const bp = b.prerelease;
  if (ap.length === 0 && bp.length === 0) return 0;
  if (ap.length === 0) return 1;
  if (bp.length === 0) return -1;
  const length = Math.min(ap.length, bp.length);
  for (let i = 0; i < length; i += 1) {
    const x = ap[i];
    const y = bp[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return ap.length === bp.length ? 0 : ap.length < bp.length ? -1 : 1;
}
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a, b);
}
function formatSemver(version) {
  const prerelease = version.prerelease.length === 0 ? "" : `-${version.prerelease.map(String).join(".")}`;
  const build = version.build.length === 0 ? "" : `+${version.build.join(".")}`;
  return `${version.major}.${version.minor}.${version.patch}${prerelease}${build}`;
}
function canonicalComparatorConjunction(comparators) {
  const unique = /* @__PURE__ */ new Map();
  for (const comparator of comparators) {
    const rendered = `${comparator.op}${formatSemver(comparator.version)}`;
    unique.set(rendered, comparator);
  }
  const operatorOrder = {
    ">": 0,
    ">=": 1,
    "=": 2,
    "<=": 3,
    "<": 4
  };
  return [...unique.entries()].sort(([, a], [, b]) => {
    const byVersion = compareSemver(a.version, b.version);
    return byVersion === 0 ? operatorOrder[a.op] - operatorOrder[b.op] : byVersion;
  }).map(([rendered]) => rendered).join(" ");
}
function caretUpperBound(v) {
  if (v.major > 0) {
    return Number.isSafeInteger(v.major + 1) ? { major: v.major + 1, minor: 0, patch: 0, prerelease: [], build: [] } : void 0;
  }
  if (v.minor > 0) {
    return Number.isSafeInteger(v.minor + 1) ? { major: 0, minor: v.minor + 1, patch: 0, prerelease: [], build: [] } : void 0;
  }
  return Number.isSafeInteger(v.patch + 1) ? { major: 0, minor: 0, patch: v.patch + 1, prerelease: [], build: [] } : void 0;
}
function parsePartial(value2) {
  const m = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*|x|\*))?(?:\.(0|[1-9]\d*|x|\*))?$/.exec(value2);
  if (!m) return void 0;
  const major = parseSafeInteger(m[1] ?? "");
  if (major === void 0) return void 0;
  const minorRaw = m[2];
  const patchRaw = m[3];
  const wild = (s) => s === "x" || s === "*";
  if (minorRaw === void 0 || wild(minorRaw)) {
    if (wild(minorRaw) && patchRaw !== void 0) return void 0;
    return { v: { major, minor: 0, patch: 0, prerelease: [], build: [] }, precision: 1 };
  }
  if (patchRaw === void 0 || wild(patchRaw)) {
    const minor2 = parseSafeInteger(minorRaw);
    if (minor2 === void 0) return void 0;
    return {
      v: { major, minor: minor2, patch: 0, prerelease: [], build: [] },
      precision: 2
    };
  }
  const minor = parseSafeInteger(minorRaw);
  const patch = parseSafeInteger(patchRaw);
  if (minor === void 0 || patch === void 0) return void 0;
  return {
    v: { major, minor, patch, prerelease: [], build: [] },
    precision: 3
  };
}
function parseSingle(token) {
  const opMatch = /^(>=|<=|>|<|=|\^)?(.+)$/.exec(token);
  if (!opMatch) return void 0;
  const op = opMatch[1];
  const rest = (opMatch[2] ?? "").trim();
  const hasWildcard = /(?:^|\.)(?:x|\*)(?:\.|$)/.test(rest);
  if (op === "^") {
    if (hasWildcard) return void 0;
    const partial2 = parsePartial(rest);
    if (!partial2 || partial2.precision === 1) return void 0;
    const upper = caretUpperBound(partial2.v);
    if (upper === void 0) return void 0;
    return [
      { op: ">=", version: partial2.v },
      { op: "<", version: upper }
    ];
  }
  const partial = parsePartial(rest);
  if (!partial) return void 0;
  if (hasWildcard && op !== void 0) return void 0;
  if (op === void 0 || op === "=") {
    if (!hasWildcard && partial.precision !== 3) return void 0;
    if (partial.precision === 3) return [{ op: "=", version: partial.v }];
    const next = partial.precision === 1 ? partial.v.major + 1 : partial.v.minor + 1;
    if (!Number.isSafeInteger(next)) return void 0;
    const upper = partial.precision === 1 ? { major: partial.v.major + 1, minor: 0, patch: 0, prerelease: [], build: [] } : {
      major: partial.v.major,
      minor: partial.v.minor + 1,
      patch: 0,
      prerelease: [],
      build: []
    };
    return [
      { op: ">=", version: partial.v },
      { op: "<", version: upper }
    ];
  }
  return [{ op, version: partial.v }];
}
function parseVersionRange(raw) {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "x") {
    return { raw, normalized: "*", comparators: [[]] };
  }
  const tokens = trimmed.split(/\s+/);
  const comparators = [];
  for (const token of tokens) {
    const parsed = parseSingle(token);
    if (!parsed) return void 0;
    comparators.push(...parsed);
  }
  return {
    raw,
    normalized: canonicalComparatorConjunction(comparators),
    comparators: [comparators]
  };
}
function versionRangeTargetsMajor(range, major) {
  if (!Number.isSafeInteger(major) || major < 0) return false;
  const start = { major, minor: 0, patch: 0, prerelease: [], build: [] };
  return range.comparators.every((conjunction) => {
    if (conjunction.length === 0) return true;
    const exact = conjunction.find((comparator) => comparator.op === "=");
    if (exact !== void 0) {
      return exact.version.major === major && conjunction.every((comparator) => matches(exact.version, comparator));
    }
    const nextMajor = major + 1;
    if (!Number.isSafeInteger(nextMajor)) return false;
    const end = { major: nextMajor, minor: 0, patch: 0, prerelease: [], build: [] };
    const crossesUpperBoundary = conjunction.some((comparator) => {
      if (comparator.op !== "<" && comparator.op !== "<=") return false;
      const boundary = compareSemver(comparator.version, end);
      return boundary > 0 || boundary === 0 && comparator.op === "<=";
    });
    if (crossesUpperBoundary) return false;
    const lowers = [
      { op: ">=", version: start },
      ...conjunction.filter((comparator) => comparator.op === ">" || comparator.op === ">=")
    ];
    const uppers = [
      { op: "<", version: end },
      ...conjunction.filter((comparator) => comparator.op === "<" || comparator.op === "<=")
    ];
    const lower = lowers.reduce((best, candidate) => {
      const comparison = compareSemver(candidate.version, best.version);
      if (comparison > 0 || comparison === 0 && candidate.op === ">") return candidate;
      return best;
    });
    const upper = uppers.reduce((best, candidate) => {
      const comparison = compareSemver(candidate.version, best.version);
      if (comparison < 0 || comparison === 0 && candidate.op === "<") return candidate;
      return best;
    });
    const lowerInside = compareSemver(lower.version, start) >= 0;
    const upperVsEnd = compareSemver(upper.version, end);
    const upperInside = upperVsEnd < 0 || upperVsEnd === 0 && upper.op === "<";
    const boundsOrder = compareSemver(lower.version, upper.version);
    const nonEmpty = boundsOrder < 0 || boundsOrder === 0 && lower.op === ">=" && upper.op === "<=";
    return lowerInside && upperInside && nonEmpty;
  });
}
function matches(version, comparator) {
  const cmp = compareSemver(version, comparator.version);
  switch (comparator.op) {
    case "=":
      return cmp === 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
  }
}
var ModkitError = class extends Error {
  code;
  context;
  retryability;
  constructor(options) {
    super(options.message, options.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = "ModkitError";
    if (!isQualifiedId(options.code)) {
      throw new TypeError(`ModkitError code must be a qualified id, got \xAB${options.code}\xBB`);
    }
    this.code = options.code;
    if (options.context !== void 0) this.context = options.context;
    this.retryability = options.retryability ?? "never";
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryability: this.retryability,
      ...this.context === void 0 ? {} : { context: this.context }
    };
  }
};
function isModkitError(value2) {
  return value2 instanceof ModkitError;
}
function diagnostic(severity, code, message, path, data, range) {
  return {
    code: errorCode(code),
    severity,
    message,
    ...path === void 0 ? {} : { path },
    ...range === void 0 ? {} : { range },
    ...data === void 0 ? {} : { data }
  };
}
function deepFreeze(value2) {
  const seen = /* @__PURE__ */ new WeakSet();
  const visit = (candidate) => {
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate)) return;
    seen.add(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      visit(candidate[key]);
    }
    Object.freeze(candidate);
  };
  visit(value2);
  return value2;
}
var UINT64_MAX_DECIMAL = "18446744073709551615";
function fixedWidthDecimalAtMost(maximum) {
  const alternatives = [maximum];
  for (let index = 1; index < maximum.length; index += 1) {
    const maximumDigit = Number(maximum[index]);
    if (maximumDigit === 0) continue;
    const prefix = maximum.slice(0, index);
    const lowerDigit = maximumDigit === 1 ? "0" : `[0-${maximumDigit - 1}]`;
    const remaining = maximum.length - index - 1;
    const suffix = remaining === 0 ? "" : `[0-9]{${remaining}}`;
    alternatives.push(`${prefix}${lowerDigit}${suffix}`);
  }
  return `(?:${alternatives.join("|")})`;
}
var UINT64_DECIMAL_PATTERN = `^(?:0|[1-9][0-9]{0,18}|${fixedWidthDecimalAtMost(UINT64_MAX_DECIMAL)})$`;
var byteCoordinateProperties = {
  byteOffset: { type: "string", pattern: UINT64_DECIMAL_PATTERN },
  byteLength: { type: "string", pattern: UINT64_DECIMAL_PATTERN }
};
var textCoordinateProperties = {
  utf16Offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  utf16Length: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  line: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  column: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
};
var sourceSpanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/source-span.v1.schema.json",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["byteOffset", "byteLength"],
      properties: byteCoordinateProperties
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["utf16Offset", "utf16Length", "line", "column"],
      properties: textCoordinateProperties
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["byteOffset", "byteLength", "utf16Offset", "utf16Length", "line", "column"],
      properties: {
        ...byteCoordinateProperties,
        ...textCoordinateProperties
      }
    }
  ]
};
deepFreeze(sourceSpanSchema);
var uint64DecimalPattern = new RegExp(UINT64_DECIMAL_PATTERN);
function isUInt64String(value2) {
  return typeof value2 === "string" && uint64DecimalPattern.test(value2);
}
function uint64(value2) {
  const decimal = typeof value2 === "bigint" ? value2.toString(10) : value2;
  if (!isUInt64String(decimal)) {
    throw new RangeError(`expected canonical decimal u64, received: ${decimal}`);
  }
  return decimal;
}
var encoder = new TextEncoder();
var CANCELLED_CODE = "x3.core/operation-cancelled";
var OperationCancelledError = class extends ModkitError {
  constructor(reason) {
    super({
      code: CANCELLED_CODE,
      message: "operation cancelled",
      retryability: "safe",
      ...reason === void 0 ? {} : { cause: reason }
    });
    this.name = "OperationCancelledError";
  }
};
function throwIfAborted(signal) {
  if (signal?.aborted) throw new OperationCancelledError(signal.reason);
}

// packages/ui/dist/explorer/index.js
var PARTS = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET = new Set(PARTS);
var PART_ATTRIBUTE = "data-mk-part";
var STATE_ATTRIBUTE = "data-mk-state";
var STATES = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET = new Set(STATES);
function setPart(element22, part) {
  if (!PART_SET.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE, part);
}
function setState(element22, states) {
  for (const state of states) {
    if (!STATE_SET.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE);
  else element22.setAttribute(STATE_ATTRIBUTE, [...new Set(states)].join(" "));
}
var t = (name, tier, type, description, extra = {}) => ({ name, tier, type, isPublic: true, description, ...extra });
var PALETTE_STEPS = [
  "050",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900"
];
var PALETTE_HUES = ["neutral", "accent", "ok", "warn", "error", "info"];
var tier1 = PALETTE_HUES.flatMap(
  (hue) => PALETTE_STEPS.map((step) => t(`palette.${hue}.${step}`, 1, "color", `${hue} ramp step ${step}`))
);
var tier2 = [
  // surfaces
  t("color.bg", 2, "color", "window ground behind everything"),
  t("color.surface", 2, "color", "default component surface"),
  t("color.raised", 2, "color", "surface above the default plane"),
  t("color.sunken", 2, "color", "inset surface such as an input well"),
  t("color.overlay", 2, "color", "floating surface: menu, popover, dialog"),
  t("color.scrim", 2, "color", "dimming layer behind a modal"),
  // text
  t("color.fg", 2, "color", "primary text"),
  t("color.fg-muted", 2, "color", "secondary text"),
  t("color.fg-subtle", 2, "color", "tertiary text and placeholders"),
  t("color.fg-inverse", 2, "color", "text on an accent fill"),
  t("color.fg-disabled", 2, "color", "disabled text"),
  t("color.fg-link", 2, "color", "hyperlink text"),
  t("color.fg-destructive", 2, "color", "destructive action text"),
  // lines
  t("color.border", 2, "color", "default separator and component border"),
  t("color.border-strong", 2, "color", "emphasised border"),
  t("color.separator", 2, "color", "hairline between list sections"),
  // interaction
  t("color.accent", 2, "color", "primary action fill"),
  t("color.accent-fg", 2, "color", "text on the accent fill"),
  t("color.accent-muted", 2, "color", "low-emphasis accent wash"),
  t("color.accent-muted-fg", 2, "color", "text on the accent wash"),
  t("color.focus", 2, "color", "focus ring"),
  t("color.hover", 2, "color", "hover wash"),
  t("color.active", 2, "color", "pressed wash"),
  t("color.selection", 2, "color", "active selection fill"),
  t("color.selection-inactive", 2, "color", "selection fill when the surface is unfocused"),
  t("color.selection-fg", 2, "color", "text on a selection fill"),
  t("color.match-highlight", 2, "color", "search match highlight"),
  t("color.drop-target", 2, "color", "drag-and-drop target indicator"),
  t("color.readonly", 2, "color", "read-only field wash"),
  // status
  ...["ok", "warn", "error", "info"].flatMap((s) => [
    t(`status.${s}`, 2, "color", `${s} indicator colour`),
    t(`status.${s}-fg`, 2, "color", `text on a ${s} fill`),
    t(`status.${s}-bg`, 2, "color", `${s} background wash`),
    t(`status.${s}-border`, 2, "color", `${s} border`)
  ]),
  // scrollbars
  t("color.scrollbar-track", 2, "color", "scrollbar trough"),
  t("color.scrollbar-thumb", 2, "color", "scrollbar thumb"),
  t("color.scrollbar-thumb-hover", 2, "color", "scrollbar thumb, hovered"),
  t("color.scrollbar-thumb-active", 2, "color", "scrollbar thumb while dragging"),
  t("color.scrollbar-shadow", 2, "color", "hairline separating a scrolled pane from its content"),
  // canvas / GPU surfaces — these are not UI chrome and need their own roles
  t("color.canvas-bg", 2, "color", "canvas or WebGL scene ground"),
  t("color.canvas-grid", 2, "color", "scene grid lines"),
  t("color.canvas-gizmo", 2, "color", "scene gizmo and axis handles"),
  // Axis identity is a convention users read at a glance (X red, Y green, Z blue), so the three
  // get their own roles rather than borrowing from the categorical ramp, which a theme may reorder.
  t("color.axis-x", 2, "color", "X axis handle and line"),
  t("color.axis-y", 2, "color", "Y axis handle and line"),
  t("color.axis-z", 2, "color", "Z axis handle and line"),
  t("color.canvas-selection", 2, "color", "selected geometry outline"),
  // graph / chart categorical ramp
  ...["1", "2", "3", "4", "5", "6"].map(
    (n) => t(`chart.categorical-${n}`, 2, "color", `categorical series ${n}`)
  ),
  t("color.graph-node", 2, "color", "relation-graph node fill"),
  t("color.graph-edge", 2, "color", "relation-graph edge stroke"),
  t("color.graph-edge-dead", 2, "color", "unresolved reference edge"),
  // diff
  t("color.diff-added", 2, "color", "added line or cell wash"),
  t("color.diff-removed", 2, "color", "removed line or cell wash"),
  t("color.diff-changed", 2, "color", "changed line or cell wash"),
  // space
  ...["0", "1", "2", "3", "4", "5", "6", "7", "8"].map(
    (n) => t(`space.${n}`, 2, "length", `spacing step ${n}`)
  ),
  // radius
  ...["none", "sm", "md", "lg", "pill"].map(
    (r) => t(`radius.${r}`, 2, "length", `corner radius ${r}`)
  ),
  // type
  t("font.sans", 2, "font-family", "UI typeface stack"),
  t("font.mono", 2, "font-family", "monospace stack for IDs, code, offsets"),
  ...["xs", "sm", "md", "lg", "xl"].map((s) => t(`font.size-${s}`, 2, "length", `font size ${s}`)),
  ...["normal", "medium", "bold"].map((w) => t(`font.weight-${w}`, 2, "number", `font weight ${w}`)),
  ...["tight", "normal", "loose"].map((l) => t(`line.${l}`, 2, "number", `line height ${l}`)),
  // metrics
  t("size.row", 2, "length", "list and table row height"),
  t("size.control", 2, "length", "default control height"),
  t("size.icon", 2, "length", "default icon box"),
  t("size.touch", 2, "length", "minimum touch target"),
  t("size.scrollbar", 2, "length", "scrollbar thickness"),
  t("size.scrollbar-thin", 2, "length", "scrollbar thickness inside dense panes"),
  // layering
  ...["base", "sticky", "dropdown", "overlay", "modal", "toast"].map(
    (z) => t(`z.${z}`, 2, "z-index", `stacking band: ${z}`)
  ),
  // motion
  ...["fast", "normal", "slow"].map(
    (d) => t(`motion.${d}`, 2, "duration", `transition duration ${d}`)
  ),
  t("motion.ease", 2, "easing", "default easing curve"),
  // elevation
  ...["1", "2", "3"].map((e) => t(`elevation.${e}`, 2, "shadow", `elevation level ${e}`)),
  t("shadow.focus-ring", 2, "shadow", "focus ring shadow")
];
var c = (name, component, type, derivesFrom, description) => t(name, 3, type, description, { component, derivesFrom });
var runtime = (name, component, type, runtimeDefault, description) => t(name, 3, type, description, { component, runtimeDefault });
var tier3 = [
  runtime("tree.indent-level", "tree", "number", "0", "nesting depth of the current tree row"),
  runtime("card.grid-columns", "card", "number", "5", "column count of the current card grid"),
  // Context-menu placement is per-instance pixel geometry, which C3 routes through tokens.
  runtime("explorer.menu-x", "explorer", "length", "0px", "context menu left offset"),
  runtime("explorer.menu-y", "explorer", "length", "0px", "context menu top offset"),
  c("table.row-height", "table", "length", "size.row", "table row height"),
  c("table.header-bg", "table", "color", "color.raised", "table header background"),
  c("table.cell-padding-x", "table", "length", "space.2", "table cell horizontal padding"),
  c("tree.indent", "tree", "length", "space.4", "tree nesting indent per level"),
  c("tree.row-height", "tree", "length", "size.row", "tree row height"),
  c("hex.byte-gap", "hex", "length", "space.1", "gap between hex byte columns"),
  c("hex.gutter-fg", "hex", "color", "color.fg-subtle", "hex offset gutter text"),
  c("text.line-height", "text", "number", "line.normal", "text stage line height"),
  c("shell.rail-width", "shell", "length", "space.8", "default side rail width"),
  c("shell.splitter-size", "shell", "length", "space.1", "splitter hit area thickness"),
  c("toolbar.height", "toolbar", "length", "size.control", "toolbar height"),
  c("panel.padding", "panel", "length", "space.3", "panel content padding"),
  c("transport.track-height", "transport", "length", "space.2", "transport scrub track height")
];
var TOKENS = Object.freeze([...tier1, ...tier2, ...tier3]);
var TOKENS_BY_NAME = new Map(
  TOKENS.map((token) => [token.name, token])
);
function cssVariableName(tokenName) {
  return `--mk-${tokenName.replace(/\./gu, "-")}`;
}
var HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
var FUNCTIONAL_COLOR = /^(?:rgb|rgba|hsl|hsla|color-mix|oklch|lab|lch)\([^;{}]*\)$/iu;
var LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ch|%|vh|vw|vmin|vmax)$|^0$/u;
var DURATION = /^(?:\d+\.?\d*|\.\d+)m?s$/u;
var NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/u;
var EASING = /^(?:linear|ease|ease-in|ease-out|ease-in-out|steps\([^;{}]*\)|cubic-bezier\([^;{}]*\))$/u;
var SHADOW = /^(?:none|[-\w\s.,()#%/]+)$/u;
var FONT_FAMILY = /^[-\w\s.,'"()]+$/u;
var FORBIDDEN = /url\(|expression\(|javascript:|@import|[;{}]|<|>/iu;
function validateTokenValue(tokenName, value2) {
  const token = TOKENS_BY_NAME.get(tokenName);
  if (token === void 0) return { valid: false, reason: `unknown token: ${tokenName}` };
  if (typeof value2 !== "string" || value2.length === 0) {
    return { valid: false, reason: "value must be a non-empty string" };
  }
  if (value2.length > 256) return { valid: false, reason: "value exceeds 256 characters" };
  if (FORBIDDEN.test(value2)) {
    return { valid: false, reason: "value contains a resource load or declaration escape" };
  }
  const ok = (() => {
    switch (token.type) {
      case "color":
        return HEX.test(value2) || FUNCTIONAL_COLOR.test(value2) || /^[a-z-]+$/iu.test(value2);
      case "length":
        return LENGTH.test(value2);
      case "number":
        return NUMBER.test(value2);
      case "duration":
        return DURATION.test(value2);
      case "easing":
        return EASING.test(value2);
      case "font-family":
        return FONT_FAMILY.test(value2);
      case "shadow":
        return SHADOW.test(value2);
      case "z-index":
        return NUMBER.test(value2);
      default:
        return false;
    }
  })();
  return ok ? { valid: true } : { valid: false, reason: `value is not a valid ${token.type}` };
}
function requireElement(value2) {
  if (typeof value2 !== "object" || value2 === null || !("style" in value2) || typeof value2.style !== "object") {
    throw new TypeError("token target must be a DOM element");
  }
  return value2;
}
function setToken(element22, name, value2) {
  const target = requireElement(element22);
  const result = validateTokenValue(name, value2);
  if (!result.valid) {
    throw new TypeError(`invalid value for token ${name}: ${result.reason ?? "unknown reason"}`);
  }
  target.style.setProperty(cssVariableName(name), value2);
}
var VIEWER_CSP = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR = Object.freeze({
  ...VIEWER_CSP,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT = policyText(VIEWER_CSP);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT = policyText(VIEWER_CSP_TRUSTED_EDITOR);
var HOSTILE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText(node, value2, maximum) {
  node.textContent = safeViewerText(value2, maximum);
}
function element(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText(node, options.text);
  if (options.part !== void 0) setPart(node, options.part);
  if (options.state !== void 0) setState(node, options.state);
  parent.append(node);
  return node;
}
var encoder2 = new TextEncoder();
function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return void 0;
  }
}
function looksTextual(bytes) {
  return !bytes.includes(0) && decodeUtf8(bytes) !== void 0;
}
function indexText(text) {
  const lineStarts = [0];
  const kinds = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/\r\n|\r|\n/gu)) {
    const value2 = match[0];
    kinds.add(value2 === "\r\n" ? "crlf" : value2 === "\r" ? "cr" : "lf");
    lineStarts.push((match.index ?? 0) + value2.length);
  }
  let longestLineBytes = 0;
  for (let line = 0; line < lineStarts.length; line += 1) {
    const start = lineStarts[line] ?? text.length;
    const next = lineStarts[line + 1] ?? text.length;
    const withoutNewline = text.slice(start, next).replace(/\r\n$|\r$|\n$/u, "");
    longestLineBytes = Math.max(longestLineBytes, encoder2.encode(withoutNewline).byteLength);
  }
  const values = [...kinds];
  return Object.freeze({
    lineStarts: Object.freeze(lineStarts),
    newline: values.length > 1 ? "mixed" : values[0] ?? "lf",
    longestLineBytes
  });
}
function ensurePositivePage(value2, name) {
  if (!Number.isSafeInteger(value2) || value2 <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}
function ensureLine(value2) {
  if (!Number.isSafeInteger(value2) || value2 < 0) {
    throw new RangeError("text line must be a non-negative safe integer");
  }
}
var cursor = (character, line) => `c${character}-l${line}`;
function parseCursor(value2) {
  const match = /^c(0|[1-9][0-9]*)-l(0|[1-9][0-9]*)$/u.exec(value2);
  const character = Number(match?.[1]);
  const line = Number(match?.[2]);
  if (match === null || !Number.isSafeInteger(character) || !Number.isSafeInteger(line)) {
    throw new RangeError("invalid built-in text cursor");
  }
  return { character, line };
}
function truncateUtf8(value2, maximumBytes) {
  if (encoder2.encode(value2).byteLength <= maximumBytes) return value2;
  let result = "";
  let used = 0;
  for (const character of value2) {
    const size = encoder2.encode(character).byteLength;
    if (used + size > maximumBytes) {
      if (result === "") throw new RangeError("text page maxBytes cannot fit the next code point");
      break;
    }
    result += character;
    used += size;
  }
  return result;
}
function cursorLine(index, character) {
  let result = 0;
  for (let line = 1; line < index.lineStarts.length; line += 1) {
    if ((index.lineStarts[line] ?? Number.MAX_SAFE_INTEGER) > character) break;
    result = line;
  }
  return result;
}
function linesInRange(index, fromLine, endCharacter) {
  let last = fromLine;
  for (let line = fromLine + 1; line < index.lineStarts.length; line += 1) {
    if ((index.lineStarts[line] ?? Number.MAX_SAFE_INTEGER) >= endCharacter) break;
    last = line;
  }
  return last - fromLine + 1;
}
function builtinTextSource(bytes) {
  const text = decodeUtf8(bytes);
  if (text === void 0 || bytes.includes(0)) {
    throw new TypeError("built-in text source requires complete NUL-free UTF-8 input");
  }
  const index = indexText(text);
  const slice = async (request, signal) => {
    signal?.throwIfAborted();
    ensurePositivePage(request.maxBytes, "text page maxBytes");
    let fromLine;
    let start;
    let requestedEnd;
    if (request.kind === "from-line") {
      ensureLine(request.line);
      ensurePositivePage(request.lineCount, "text page lineCount");
      fromLine = request.line;
      start = index.lineStarts[fromLine] ?? text.length;
      requestedEnd = index.lineStarts[fromLine + request.lineCount] ?? text.length;
    } else {
      const parsed = parseCursor(request.cursor);
      if (parsed.character > text.length || parsed.line >= index.lineStarts.length) {
        throw new RangeError("built-in text cursor points beyond the source");
      }
      fromLine = parsed.line;
      start = parsed.character;
      requestedEnd = text.length;
    }
    const page = truncateUtf8(text.slice(start, requestedEnd), request.maxBytes);
    const actualEnd = start + page.length;
    const nextLine = cursorLine(index, actualEnd);
    const lineCount = page === "" ? 0 : linesInRange(index, fromLine, actualEnd);
    if (actualEnd >= text.length) {
      return { complete: true, text: page, fromLine, lineCount };
    }
    return {
      complete: false,
      text: page,
      fromLine,
      lineCount,
      nextCursor: cursor(actualEnd, nextLine)
    };
  };
  return Object.freeze({
    async info() {
      return {
        bytes: BigInt(bytes.byteLength),
        encoding: "utf-8",
        bom: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191,
        newline: index.newline,
        lines: index.lineStarts.length,
        longestLineBytes: index.longestLineBytes
      };
    },
    slice,
    async *search(query, signal) {
      signal?.throwIfAborted();
      const flags = query.caseSensitive === true ? "gu" : "giu";
      const pattern = query.regex === true ? query.pattern : query.pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const expression = new RegExp(pattern, flags);
      for (const match of text.matchAll(expression)) {
        signal?.throwIfAborted();
        const character = match.index ?? 0;
        const byteOffset = encoder2.encode(text.slice(0, character)).byteLength;
        const byteLength = encoder2.encode(match[0]).byteLength;
        yield Object.freeze({
          byteOffset: uint64(BigInt(byteOffset)),
          byteLength: uint64(BigInt(byteLength))
        });
        if (match[0] === "") expression.lastIndex += 1;
      }
    }
  });
}
function builtinByteRangeSource(bytes) {
  return Object.freeze({
    async size() {
      return BigInt(bytes.byteLength);
    },
    async read(offset, length, signal) {
      signal?.throwIfAborted();
      if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
        throw new RangeError("byte range must use a non-negative offset and safe length");
      }
      if (offset >= BigInt(bytes.byteLength)) return new Uint8Array();
      const start = Number(offset);
      return bytes.slice(start, Math.min(start + length, bytes.byteLength));
    }
  });
}
var traitsOf = (descriptor) => {
  const traits = descriptor["traits"];
  if (!Array.isArray(traits)) return [];
  return traits.map((item) => String(item.id ?? ""));
};
var publishedContracts = (descriptor) => {
  const sources = descriptor["dataSources"];
  if (!Array.isArray(sources)) return [];
  return sources.map((item) => String(item.contract ?? ""));
};
var stageId = (stage) => stage.id ?? stage.contract;
function createCodecPreview(options) {
  const supported = [
    ...new Set(
      (options.supported ?? []).map((extension) => extension.replace(/^\./u, "").toLowerCase())
    )
  ];
  return {
    supported,
    async open(container, entry, bytes, signal) {
      const externallyOpened = await options.openSession?.(entry, bytes, signal);
      const resolved2 = externallyOpened !== void 0;
      const session = externallyOpened ?? builtinSession(bytes, options.fallback);
      const descriptor = await session.descriptor();
      const operations = await session.operations?.().catch(() => void 0);
      const ports = await options.editorPorts?.(entry, bytes);
      const traits = new Set(traitsOf(descriptor));
      const published = new Set(publishedContracts(descriptor));
      const candidates = resolved2 ? options.stages : fallbackStages(options.fallback);
      const planned = session.presentation === void 0 ? candidates : session.presentation.slots.flatMap((slot) => {
        if (slot.kind !== "stage") return [];
        const stage = candidates.find((candidate) => stageId(candidate) === slot.slotId);
        return stage === void 0 ? [] : [stage];
      });
      const usable = planned.filter(
        (stage) => published.has(stage.contract) && (stage.trait === void 0 || traits.has(stage.trait)) && // An editable stage without ports could never save; offering it would be a lie.
        (stage.editable !== true || ports !== void 0)
      );
      if (usable.length === 0) {
        await session.dispose();
        return void 0;
      }
      let active;
      const plannedActive = session.presentation?.activeStage;
      let activeId = plannedActive !== void 0 && usable.some((stage) => stageId(stage) === plannedActive) ? plannedActive : usable[0] === void 0 ? "" : stageId(usable[0]);
      const show = async (viewId) => {
        const stage = usable.find((item) => stageId(item) === viewId);
        if (stage === void 0) throw new Error(`unknown view: ${viewId}`);
        await active?.unmount();
        active = void 0;
        container.replaceChildren();
        activeId = viewId;
        const slot = {
          slotId: `explorer:${stageId(stage)}`,
          kind: "primary",
          contributionId: "org.modkitx.ui/explorer",
          extensionId: "org.modkitx.ui",
          priority: 100,
          bindings: [
            { bindingId: "content", contract: stage.contract, major: 1 },
            // optional sources: bound when this descriptor actually publishes them, absent when it
            // does not, so the viewer's own `bindingFor` lookup is the whole availability check
            ...(stage.optionalContracts ?? []).filter((contract) => published.has(contract) && contract !== stage.contract).map((contract) => ({ bindingId: `facet:${contract}`, contract, major: 1 }))
          ]
        };
        const stagePorts = stage.editable === true ? ports : void 0;
        const mounted = await stage.module.mount({
          container,
          descriptor,
          slot,
          ...stagePorts === void 0 ? {} : {
            edit: stagePorts.edit,
            commit: stagePorts.commit,
            payloads: stagePorts.payloads,
            authorization: stagePorts.authorization
          },
          sources: {
            async get(binding) {
              const lease = await session.dataSource(binding.contract, binding.major ?? 1);
              return {
                value: lease.value,
                async release() {
                }
              };
            },
            async getUnknown(binding) {
              const lease = await session.dataSource(binding.contract, binding.major ?? 1);
              return {
                value: lease.value,
                async release() {
                }
              };
            }
          },
          operations,
          ...signal === void 0 ? {} : { signal }
        });
        active = mounted;
        activeId = viewId;
      };
      await show(activeId);
      return {
        views: usable.map((stage) => ({ id: stageId(stage), label: stage.label })),
        get activeView() {
          return activeId;
        },
        show,
        async unmount() {
          await active?.unmount();
          await session.dispose();
          container.replaceChildren();
        }
      };
    }
  };
}
function fallbackStages(fallback) {
  const stages = [];
  if (fallback?.text !== void 0) {
    stages.push({
      id: "text",
      label: "Text",
      contract: "common.view/text-data-source",
      module: fallback.text
    });
  }
  if (fallback?.hex !== void 0) {
    stages.push({
      id: "hex",
      label: "Hex",
      contract: "common.view/byte-range-source",
      module: fallback.hex
    });
  }
  return stages;
}
function builtinSession(bytes, fallback) {
  const textual = fallback?.text !== void 0 && looksTextual(bytes);
  const sources = {};
  if (textual) sources["common.view/text-data-source"] = builtinTextSource(bytes);
  if (fallback?.hex !== void 0) {
    sources["common.view/byte-range-source"] = builtinByteRangeSource(bytes);
  }
  return {
    async descriptor() {
      return {
        subjectUri: "memory://explorer/builtin",
        revision: `content-hash.sha256:builtin-${bytes.length}`,
        operations: [],
        diagnostics: [],
        // `content.text` only when the bytes really decode: a binary must not claim to be text.
        traits: textual ? [{ id: "content.text" }] : [],
        dataSources: Object.keys(sources).map((contract) => ({ contract }))
      };
    },
    async dataSource(contract) {
      const value2 = sources[contract];
      if (value2 === void 0) throw new Error(`built-in preview has no ${contract}`);
      return { value: value2 };
    },
    async dispose() {
    }
  };
}
var EDITOR_SAVE_REQUEST = "modkit-editor-save-request";
async function requestEditorSave(host) {
  const editor = host.querySelector("[data-modkit-editor]");
  if (editor === null) return void 0;
  let operation;
  const detail = {
    waitUntil(next) {
      if (operation !== void 0) throw new Error("an editor answered the save request twice");
      operation = next;
    }
  };
  editor.dispatchEvent(new CustomEvent(EDITOR_SAVE_REQUEST, { detail }));
  return operation === void 0 ? void 0 : operation;
}
function fileKindOf(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "file";
  const kind = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9_-]{1,16}$/u.test(kind) ? kind : "file";
}
var describe2 = (error) => error instanceof Error ? error.message : String(error);
var formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};
function createEditorArea(document2, options) {
  const root2 = document2.createElement("div");
  setPart(root2, "explorer.editors");
  const groups = [];
  let focused;
  let destroyed = false;
  let openMenu;
  const report = (status) => {
    options.onStatus?.(status);
  };
  function drawBreadcrumb(group, entry) {
    group.breadcrumb.replaceChildren();
    if (entry === void 0) return;
    const parts = entry.id.split(/[\\/]/u).filter(Boolean);
    for (const [index, part] of parts.slice(-4).entries()) {
      if (index > 0) element(group.breadcrumb, "span", { part: "explorer.crumb", text: "\u203A" });
      element(group.breadcrumb, "span", {
        part: "explorer.crumb",
        text: safeViewerText(part, 120)
      });
    }
  }
  function syncPicker(group) {
    const handle = group.active?.handle;
    group.picker.replaceChildren();
    if (handle === void 0 || handle.views.length === 0) {
      group.picker.disabled = true;
      return;
    }
    for (const view of handle.views) {
      const option = document2.createElement("option");
      option.value = view.id;
      option.textContent = view.label;
      group.picker.append(option);
    }
    group.picker.value = handle.activeView;
    group.picker.disabled = handle.views.length < 2;
  }
  function placeholder(group, message) {
    group.stage.replaceChildren();
    element(group.stage, "p", { part: "explorer.placeholder", text: message });
  }
  async function activate(group, tab) {
    for (const other of group.tabs) {
      const selected = other === tab;
      other.button.setAttribute("aria-selected", String(selected));
      setState(other.button, selected ? ["selected"] : []);
      other.content.hidden = !selected;
    }
    group.active = tab;
    drawBreadcrumb(group, tab.entry);
    if (tab.handle === void 0) {
      await load(group, tab);
      return;
    }
    syncPicker(group);
    report({
      path: tab.entry.id,
      view: group.picker.selectedOptions[0]?.textContent ?? "",
      detail: tab.entry.name,
      severity: "info"
    });
  }
  async function load(group, tab) {
    tab.run?.abort();
    const run = new AbortController();
    tab.run = run;
    tab.content.replaceChildren();
    report({ path: tab.entry.id, detail: `Opening ${tab.entry.name}\u2026`, severity: "busy" });
    try {
      const bytes = await options.read(tab.entry, run.signal);
      if (run.signal.aborted) return;
      const handle = await options.preview.open(tab.content, tab.entry, bytes, run.signal);
      if (run.signal.aborted) {
        await handle?.unmount();
        return;
      }
      if (handle === void 0) {
        placeholder({ ...group, stage: tab.content }, `Nothing could render \u201C${tab.entry.name}\u201D.`);
        report({ path: tab.entry.id, detail: "no viewer", severity: "error" });
        return;
      }
      tab.handle = handle;
      syncPicker(group);
      report({
        path: tab.entry.id,
        view: handle.views.find((view) => view.id === handle.activeView)?.label ?? "",
        detail: formatBytes(bytes.length),
        severity: "info"
      });
    } catch (error) {
      if (run.signal.aborted) return;
      placeholder(
        { ...group, stage: tab.content },
        `Could not preview ${tab.entry.name}: ${describe2(error)}`
      );
      report({ path: tab.entry.id, detail: describe2(error), severity: "error" });
    }
  }
  async function closeTab(group, tab) {
    if (tab.dirty === true && options.confirmClose !== void 0) {
      const answer = await options.confirmClose(tab.entry);
      if (answer === "cancel") return;
      if (answer === "save" && !await saveTab(tab)) return;
    }
    tab.run?.abort();
    await tab.handle?.unmount();
    const index = group.tabs.indexOf(tab);
    if (index !== -1) group.tabs.splice(index, 1);
    tab.button.remove();
    tab.content.remove();
    if (group.active === tab) {
      group.active = void 0;
      const next = group.tabs[Math.max(0, index - 1)];
      if (next !== void 0) {
        await activate(group, next);
      } else {
        drawBreadcrumb(group, void 0);
        syncPicker(group);
        placeholder(group, "No file open in this group.");
      }
    }
    if (group.tabs.length === 0 && groups.length > 1 && group !== groups[0]) {
      groups.splice(groups.indexOf(group), 1);
      group.root.remove();
      const first = groups[0];
      if (first !== void 0) focus(first);
    }
  }
  async function saveTab(tab) {
    const editorAnswer = await requestEditorSave(tab.content);
    if (editorAnswer !== void 0) return editorAnswer;
    if (options.save === void 0) return false;
    await options.save(tab.entry);
    return true;
  }
  function openTabMenu(group, tab, x, y) {
    closeTabMenu();
    const menu = element(root2, "div", { part: "explorer.tabmenu" });
    menu.setAttribute("role", "menu");
    setToken(menu, "explorer.menu-x", `${Math.round(x)}px`);
    setToken(menu, "explorer.menu-y", `${Math.round(y)}px`);
    const item = (label, enabled, run) => {
      const node = element(menu, "button", { part: "explorer.tabmenu-item", text: label });
      node.setAttribute("type", "button");
      node.setAttribute("role", "menuitem");
      if (!enabled) {
        node.setAttribute("disabled", "");
        setState(node, ["disabled"]);
        return;
      }
      node.addEventListener("click", () => {
        closeTabMenu();
        run();
      });
    };
    const index = group.tabs.indexOf(tab);
    const others = group.tabs.filter((other) => other !== tab);
    const toRight = group.tabs.slice(index + 1);
    item("Close", true, () => void closeTab(group, tab));
    item("Close Others", others.length > 0, () => {
      void (async () => {
        for (const other of [...others]) await closeTab(group, other);
      })();
    });
    item("Close to the Right", toRight.length > 0, () => {
      void (async () => {
        for (const other of [...toRight]) await closeTab(group, other);
      })();
    });
    item("Close All", group.tabs.length > 0, () => {
      void (async () => {
        for (const other of [...group.tabs]) await closeTab(group, other);
      })();
    });
    const dismiss = (event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      closeTabMenu();
    };
    root2.ownerDocument.addEventListener("pointerdown", dismiss, { capture: true });
    root2.ownerDocument.addEventListener("keydown", escapeMenu, true);
    openMenu = { element: menu, dismiss };
  }
  function escapeMenu(event) {
    if (event.key === "Escape") closeTabMenu();
  }
  function closeTabMenu() {
    if (openMenu === void 0) return;
    root2.ownerDocument.removeEventListener("pointerdown", openMenu.dismiss, { capture: true });
    root2.ownerDocument.removeEventListener("keydown", escapeMenu, true);
    openMenu.element.remove();
    openMenu = void 0;
  }
  function focus(group) {
    focused = group;
    for (const item of groups) setState(item.root, item === group ? ["active"] : []);
  }
  function createGroup() {
    const groupRoot = element(root2, "div", { part: "explorer.group" });
    const strip = element(groupRoot, "div", { part: "explorer.tabstrip", role: "tablist" });
    strip.setAttribute("aria-label", "Open files");
    if (options.chrome?.tabs === false) strip.remove();
    const header = element(groupRoot, "div", { part: "explorer.header" });
    const breadcrumb = element(header, "nav", { part: "explorer.breadcrumb" });
    breadcrumb.setAttribute("aria-label", "File path");
    if (options.chrome?.breadcrumb === false) breadcrumb.remove();
    const picker = element(header, "select", { part: "explorer.viewpicker" });
    picker.setAttribute("aria-label", "View");
    picker.disabled = true;
    const stage = element(groupRoot, "div", { part: "explorer.stage" });
    const group = { root: groupRoot, strip, breadcrumb, picker, stage, tabs: [] };
    groupRoot.addEventListener("pointerdown", () => {
      focus(group);
    });
    picker.addEventListener("change", () => {
      const handle = group.active?.handle;
      if (handle === void 0) return;
      void handle.show(picker.value).then(() => {
        report({
          ...group.active === void 0 ? {} : { path: group.active.entry.id },
          view: picker.selectedOptions[0]?.textContent ?? picker.value,
          detail: group.active?.entry.name ?? "",
          severity: "info"
        });
      });
    });
    groups.push(group);
    placeholder(group, "No file open in this group.");
    return group;
  }
  focused = createGroup();
  focus(focused);
  const area = {
    root: root2,
    get groupCount() {
      return groups.length;
    },
    async close(entryId) {
      for (const group of groups) {
        const tab = group.tabs.find((item) => item.entry.id === entryId);
        if (tab === void 0) continue;
        await closeTab(group, tab);
        return !group.tabs.includes(tab);
      }
      return false;
    },
    async save(entryId) {
      for (const group of groups) {
        const tab = group.tabs.find((item) => item.entry.id === entryId);
        if (tab !== void 0) return saveTab(tab);
      }
      return false;
    },
    async open(entry) {
      const group = focused;
      const existing = group.tabs.find((tab2) => tab2.entry.id === entry.id);
      if (existing !== void 0) {
        await activate(group, existing);
        return;
      }
      const button = element(group.strip, "div", { part: "explorer.filetab" });
      button.setAttribute("role", "tab");
      button.title = entry.id;
      button.setAttribute("data-mk-kind", fileKindOf(entry.name));
      if (group.tabs.length === 0) group.stage.replaceChildren();
      const content = element(group.stage, "div", { part: "explorer.tabcontent" });
      const tab = { entry, button, content };
      const label = element(button, "span", { text: safeViewerText(entry.name, 120) });
      label.addEventListener("click", () => {
        focus(group);
        void activate(group, tab);
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        focus(group);
        openTabMenu(group, tab, event.clientX, event.clientY);
      });
      const close = element(button, "button", { part: "explorer.filetab-close", text: "\xD7" });
      close.setAttribute("type", "button");
      close.setAttribute("aria-label", `Close ${entry.name}`);
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        void closeTab(group, tab);
      });
      group.tabs.push(tab);
      await activate(group, tab);
    },
    markDirty(entryId, dirty) {
      for (const group of groups) {
        for (const tab of group.tabs) {
          if (tab.entry.id !== entryId) continue;
          tab.dirty = dirty;
          setState(tab.button, dirty ? ["mutating"] : tab === group.active ? ["selected"] : []);
          if (dirty && tab === group.active) setState(tab.button, ["selected", "mutating"]);
        }
      }
    },
    hasUnsaved() {
      return groups.some((group) => group.tabs.some((tab) => tab.dirty === true));
    },
    split() {
      focus(createGroup());
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeTabMenu();
      for (const group of groups) {
        for (const tab of group.tabs) {
          tab.run?.abort();
          void tab.handle?.unmount();
        }
      }
      root2.remove();
    }
  };
  return area;
}
var EXPLORER_MAXIMUM_BYTES = 64 * 1024 * 1024;

// packages/ui/dist/workbench/index.js
var PARTS2 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET2 = new Set(PARTS2);
var PART_ATTRIBUTE2 = "data-mk-part";
var STATE_ATTRIBUTE2 = "data-mk-state";
var STATES2 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET2 = new Set(STATES2);
function setPart2(element17, part) {
  if (!PART_SET2.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element17.setAttribute(PART_ATTRIBUTE2, part);
}
function setState2(element17, states) {
  for (const state of states) {
    if (!STATE_SET2.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element17.removeAttribute(STATE_ATTRIBUTE2);
  else element17.setAttribute(STATE_ATTRIBUTE2, [...new Set(states)].join(" "));
}
var VIEWER_CSP2 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR2 = Object.freeze({
  ...VIEWER_CSP2,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText2 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT2 = policyText2(VIEWER_CSP2);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT2 = policyText2(VIEWER_CSP_TRUSTED_EDITOR2);
var HOSTILE_TEXT2 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText2(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT2, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function createWorkbench(document2, options) {
  const root2 = document2.createElement("div");
  root2.className = "modkit-viewer modkit-workbench";
  setPart2(root2, "workbench");
  const titlebar = document2.createElement("header");
  titlebar.textContent = safeViewerText2(options.title, 256);
  setPart2(titlebar, "workbench.titlebar");
  const activitybar = document2.createElement("nav");
  activitybar.setAttribute("aria-label", "Workbench activities");
  setPart2(activitybar, "workbench.activitybar");
  const sidebar = document2.createElement("aside");
  setPart2(sidebar, "workbench.sidebar");
  const main = document2.createElement("main");
  setPart2(main, "workbench.main");
  const panel = document2.createElement("section");
  setPart2(panel, "workbench.panel");
  const statusbar = document2.createElement("footer");
  setPart2(statusbar, "workbench.statusbar");
  const hostStatus = document2.createElement("span");
  setPart2(hostStatus, "workbench.host-status");
  statusbar.append(hostStatus);
  root2.append(titlebar, activitybar, sidebar, main, panel, statusbar);
  const setHostState = (state) => {
    const reasons = state.degradedReasons ?? [];
    hostStatus.textContent = `${safeViewerText2(state.label, 128)} \xB7 ${state.facilities.length} facilities`;
    hostStatus.title = reasons.length === 0 ? state.facilities.join(", ") : reasons.join("\n");
    const states = reasons.length === 0 ? [] : ["degraded"];
    setState2(hostStatus, states);
  };
  const replace = (target, content) => {
    target.replaceChildren(...content === void 0 ? [] : [content]);
  };
  setHostState(
    options.host ?? {
      label: "Host unavailable",
      facilities: [],
      degradedReasons: ["No host profile"]
    }
  );
  return Object.freeze({
    root: root2,
    activitybar,
    sidebar,
    main,
    panel,
    setHostState,
    setSidebar: (content) => replace(sidebar, content),
    setMain: (content) => replace(main, content),
    setPanel: (content) => replace(panel, content),
    dispose: () => root2.remove()
  });
}

// packages/sdk/dist/index.js
var DOTTED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var NAMESPACED_DOTTED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var OPERATION_PATTERN = "^(?:[a-z0-9]+(?:-[a-z0-9]+)*\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*|[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\.[a-z0-9]+(?:-[a-z0-9]+)*)$";
var QUALIFIED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var SEGMENT_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
var SEMVER_PATTERN = "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";
var RANGE_NUMBER = "(?:0|[1-9]\\d*)";
var RANGE_NUMERIC = `${RANGE_NUMBER}(?:\\.${RANGE_NUMBER}){0,2}`;
var RANGE_EXACT = `=?${RANGE_NUMBER}\\.${RANGE_NUMBER}\\.${RANGE_NUMBER}`;
var RANGE_WILDCARD = `(?:${RANGE_NUMBER}\\.(?:x|\\*)|${RANGE_NUMBER}\\.${RANGE_NUMBER}\\.(?:x|\\*))`;
var RANGE_CARET = `\\^${RANGE_NUMBER}\\.${RANGE_NUMBER}(?:\\.${RANGE_NUMBER})?`;
var RANGE_COMPARATOR = `[<>]=?${RANGE_NUMERIC}`;
var RANGE_ATOM = `(?:${RANGE_EXACT}|${RANGE_WILDCARD}|${RANGE_CARET}|${RANGE_COMPARATOR})`;
var VERSION_RANGE_PATTERN = `^(?:\\*|x|${RANGE_ATOM}(?: ${RANGE_ATOM})*)$`;
var RELATIVE_ENTRYPOINT_PATTERN = "^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!/)(?!\\\\)(?:(?!\\.\\.(?:/|$))[^\\\\/\\u0000-\\u001f]+/)*(?!\\.\\.$)[^\\\\/\\u0000-\\u001f]+$";
var METHOD_NAME_PATTERN = "^[a-z][a-zA-Z0-9]{0,63}$";
var REQUIREMENT_SCOPE_KINDS = Object.freeze([
  "contribution",
  "offer",
  "operation",
  "intent",
  "variant",
  "profile",
  "projection",
  "slot"
]);
var requirementScopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id"],
  properties: {
    kind: { enum: REQUIREMENT_SCOPE_KINDS },
    id: { type: "string", minLength: 1 }
  }
};
var extensionRequirementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/extension-requirement.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["extension", "mode", "scope"],
  properties: {
    extension: { type: "string", pattern: QUALIFIED_PATTERN },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN },
    mode: { enum: ["required", "default", "suggested", "integrates"] },
    scope: requirementScopeSchema
  }
};
var contributionManifestsSchema = {
  type: "array",
  items: { type: "string", minLength: 1 }
};
var extensionManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/extension-manifest.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "publisher", "id", "version", "license", "contributionManifests"],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: "string", pattern: DOTTED_PATTERN },
    id: { type: "string", pattern: DOTTED_PATTERN },
    version: { type: "string", pattern: SEMVER_PATTERN },
    license: { type: "string", minLength: 1 },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: "array", items: extensionRequirementSchema }
  }
};
var modkitBlockSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/extension-manifest-modkit-block.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "publisher", "id", "contributionManifests"],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: "string", pattern: DOTTED_PATTERN },
    id: { type: "string", pattern: DOTTED_PATTERN },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: "array", items: extensionRequirementSchema }
  }
};
deepFreeze(requirementScopeSchema);
deepFreeze(extensionRequirementSchema);
deepFreeze(extensionManifestSchema);
deepFreeze(modkitBlockSchema);
var EXECUTION_PROFILES = Object.freeze([
  "browser-sandbox",
  "worker-brokered",
  "process-brokered",
  "wasm-brokered",
  "trusted-in-process",
  "remote-provider"
]);
var PERMISSION_CLASSES = Object.freeze([
  "read-source",
  "write-source",
  "filesystem-read",
  "filesystem-write",
  "network",
  "process-launch",
  "native-code",
  "credentials",
  "clipboard",
  "persistent-storage"
]);
var RUNTIME_ENVIRONMENTS = Object.freeze([
  "browser-main",
  "browser-worker",
  "node",
  "node-worker",
  "wasm",
  "native",
  "external-tool"
]);
var OPERATING_SYSTEMS = Object.freeze([
  "any",
  "windows",
  "linux",
  "darwin",
  "android",
  "ios"
]);
var ARCHITECTURES = Object.freeze([
  "any",
  "x86",
  "x64",
  "arm32",
  "arm64",
  "wasm32"
]);
var runtimeTargetConstraintSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    environments: { type: "array", items: { enum: RUNTIME_ENVIRONMENTS }, minItems: 1 },
    operatingSystems: { type: "array", items: { enum: OPERATING_SYSTEMS }, minItems: 1 },
    architectures: { type: "array", items: { enum: ARCHITECTURES }, minItems: 1 },
    requiredHostCapabilities: { type: "array", items: { type: "string", minLength: 1 } },
    requiredWebApis: { type: "array", items: { type: "string", minLength: 1 } },
    externalTools: { type: "array", items: { type: "string", minLength: 1 } }
  }
};
var runtimeVariantDeclarationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/runtime-variant-declaration.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["variantId", "entrypoint", "target", "executionProfile", "requestedPermissionClasses"],
  properties: {
    variantId: { type: "string", pattern: SEGMENT_PATTERN },
    // Containment is enforced twice: here (authoring gate) and again by the host before
    // any import (MK3/24 §8) — the host never trusts that someone validated the input.
    entrypoint: { type: "string", pattern: RELATIVE_ENTRYPOINT_PATTERN },
    target: runtimeTargetConstraintSchema,
    executionProfile: { enum: EXECUTION_PROFILES },
    requestedPermissionClasses: { type: "array", items: { enum: PERMISSION_CLASSES } }
  }
};
var scopedContractRequirementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/scoped-contract-requirement.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["contract", "major", "mode", "scope"],
  properties: {
    contract: { type: "string", pattern: QUALIFIED_PATTERN },
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN },
    mode: { enum: ["required", "default", "suggested", "integrates"] },
    scope: requirementScopeSchema
  }
};
var contributionManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/contribution-manifest.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "contract", "id", "displayName", "spec"],
  properties: {
    schemaVersion: { const: 1 },
    contract: {
      type: "object",
      additionalProperties: false,
      required: ["id", "major"],
      properties: {
        id: { type: "string", pattern: QUALIFIED_PATTERN },
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    id: { type: "string", pattern: QUALIFIED_PATTERN },
    displayName: { type: "string", minLength: 1 },
    status: { enum: ["supported", "partial", "unsupported", "experimental"] },
    runtimeVariants: { type: "array", items: runtimeVariantDeclarationSchema },
    dependsOn: { type: "array", items: scopedContractRequirementSchema },
    limitations: { type: "array", items: { type: "string", minLength: 1 } },
    spec: { title: "JsonValue" }
  }
};
deepFreeze(runtimeTargetConstraintSchema);
deepFreeze(runtimeVariantDeclarationSchema);
deepFreeze(scopedContractRequirementSchema);
deepFreeze(contributionManifestSchema);
var STANDARD_DATA_SOURCE_CONTRACTS = Object.freeze([
  "common.view/text-data-source",
  "common.view/byte-range-source",
  "common.view/tree-data-source",
  "common.view/table-data-source",
  "common.view/transport-source",
  "common.view/namespace-entry-source",
  "common.view/raster-image-source",
  "common.view/vector-scene-source",
  "common.view/audio-media-source",
  "common.view/video-media-source",
  "common.view/model-scene-source",
  // optional model facets beside the base scene source (block 11, slice 11C0, plan item 11)
  "common.view/model-resource-refs-source",
  "common.view/model-skeleton-source",
  "common.view/model-animation-source",
  "common.view/model-collision-source",
  "common.view/model-material-source",
  "common.view/relation-graph-source",
  "common.view/subject-facts-source",
  "common.view/slide-deck-source"
]);
var DATA_SOURCE_MATURITY = Object.freeze({
  "common.view/text-data-source": "admitted",
  "common.view/byte-range-source": "admitted",
  "common.view/tree-data-source": "admitted",
  "common.view/table-data-source": "admitted",
  "common.view/transport-source": "admitted",
  "common.view/namespace-entry-source": "admitted",
  "common.view/raster-image-source": "admitted",
  "common.view/vector-scene-source": "admitted",
  "common.view/audio-media-source": "admitted",
  "common.view/video-media-source": "admitted",
  "common.view/model-scene-source": "admitted",
  "common.view/model-resource-refs-source": "admitted",
  "common.view/model-skeleton-source": "publisher-candidate",
  "common.view/model-animation-source": "admitted",
  "common.view/model-collision-source": "admitted",
  "common.view/model-material-source": "admitted",
  "common.view/relation-graph-source": "admitted",
  "common.view/subject-facts-source": "admitted",
  "common.view/slide-deck-source": "publisher-candidate"
});
var ADMITTED_DATA_SOURCE_CONTRACTS = Object.freeze(
  STANDARD_DATA_SOURCE_CONTRACTS.filter(
    (contract) => DATA_SOURCE_MATURITY[contract] === "admitted"
  )
);
var nonEmptyString = { type: "string", minLength: 1 };
var qualifiedId = { type: "string", pattern: QUALIFIED_PATTERN };
var namespacedDottedId = { type: "string", pattern: NAMESPACED_DOTTED_PATTERN };
var operationId2 = { type: "string", pattern: OPERATION_PATTERN };
var decimalU64 = { type: "string", pattern: UINT64_DECIMAL_PATTERN };
var jsonSchemaRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["$ref"],
  properties: { $ref: nonEmptyString }
};
var resourceBudgetWireSchema = {
  type: "object",
  additionalProperties: false,
  required: ["maxInputBytes", "maxDepth", "maxNodes", "maxScalarBytes", "maxDiagnostics"],
  properties: {
    maxInputBytes: decimalU64,
    maxDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxNodes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxScalarBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxDiagnostics: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    deadlineMs: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var dataSourceRefWireSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["contract", "major"],
      properties: {
        contract: { enum: STANDARD_DATA_SOURCE_CONTRACTS },
        major: { const: 1 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["contract", "major", "opaque"],
      properties: {
        contract: { ...qualifiedId, not: { enum: STANDARD_DATA_SOURCE_CONTRACTS } },
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        opaque: { const: true }
      }
    }
  ]
};
var contractRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contract", "major"],
  properties: {
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN }
  }
};
var formatRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formatId", "label"],
  properties: {
    formatId: nonEmptyString,
    label: nonEmptyString,
    mediaType: nonEmptyString
  }
};
var signatureRuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["from", "offset", "bytesHex"],
  properties: {
    from: { enum: ["start", "end"] },
    offset: { type: "integer", minimum: 0, maximum: 4096 },
    bytesHex: { type: "string", pattern: "^(?:[0-9a-f]{2}){1,64}$" },
    maskHex: { type: "string", pattern: "^(?:[0-9a-f]{2}){1,64}$" }
  }
};
var matchRulesSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    extensions: { type: "array", items: nonEmptyString },
    mediaTypes: { type: "array", items: nonEmptyString },
    pathGlobs: { type: "array", items: nonEmptyString },
    signatures: { type: "array", items: signatureRuleSchema, maxItems: 8 }
  }
};
var probePlanSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "ranges", "maxBytes"],
      properties: {
        kind: { const: "bytes" },
        ranges: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "length"],
            properties: {
              from: { enum: ["start", "end"] },
              length: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
            }
          }
        },
        maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "markers", "maxEntries", "maxBytes", "maxDepth", "maxPathBytes"],
      properties: {
        kind: { const: "namespace" },
        markers: {
          type: "array",
          items: nonEmptyString,
          minItems: 1,
          maxItems: 256,
          uniqueItems: true
        },
        prefixes: { type: "array", items: nonEmptyString },
        maxEntries: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxPathBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "maxSubjects", "maxRelationDepth"],
      properties: {
        kind: { const: "derived" },
        maxSubjects: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxRelationDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    }
  ]
};
var traitDefinitionRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: namespacedDottedId,
    definitionRange: { type: "string", pattern: VERSION_RANGE_PATTERN }
  }
};
var traitQueryRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    ...traitDefinitionRequirementSchema.properties,
    states: {
      type: "array",
      items: { enum: ["available", "partial", "disabled", "dependency-required"] },
      minItems: 1,
      uniqueItems: true
    }
  }
};
var companionRuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "role", "required", "patterns", "searchScopes"],
  properties: {
    id: { type: "string", pattern: SEGMENT_PATTERN },
    role: nonEmptyString,
    required: { type: "boolean" },
    patterns: { type: "array", items: nonEmptyString, minItems: 1 },
    expected: {
      type: "object",
      additionalProperties: false,
      properties: {
        all: { type: "array", items: traitQueryRequirementSchema },
        any: { type: "array", items: traitQueryRequirementSchema },
        none: { type: "array", items: traitQueryRequirementSchema }
      }
    },
    searchScopes: {
      type: "array",
      minItems: 1,
      items: {
        enum: [
          "sibling-directory",
          "current-mount",
          "enclosing-container",
          "workspace-dependency-layer",
          "explicit-user-selection"
        ]
      }
    }
  }
};
var representationDeclSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "contract", "major", "stage", "lossy"],
  properties: {
    id: nonEmptyString,
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    stage: { enum: ["authored", "compiled", "runtime"] },
    lossy: { type: "boolean" }
  }
};
var operationDeclSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "handlerId", "mutatesSource"],
  properties: {
    id: operationId2,
    handlerId: nonEmptyString,
    mutatesSource: { type: "boolean" },
    requiredPermissions: { type: "array", items: { enum: PERMISSION_CLASSES } },
    requiresContract: contractRequirementSchema,
    inputSchema: jsonSchemaRefSchema,
    outputKinds: {
      type: "array",
      items: {
        enum: ["json", "bytes", "stream", "source", "artifact", "none", "edit-plan", "transaction"]
      }
    }
  }
};
var traitDeclarationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "representation", "presence"],
  properties: {
    id: namespacedDottedId,
    definitionVersion: { type: "string", pattern: SEMVER_PATTERN },
    representation: { enum: ["source", "compiled", "runtime"] },
    presence: { enum: ["may-expose", "will-expose"] },
    prerequisites: { type: "array", items: contractRequirementSchema },
    evidenceRefs: { type: "array", items: nonEmptyString, uniqueItems: true }
  }
};
var fidelityNotesSchema = { type: "array", items: nonEmptyString };
var fidelityClaimSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { const: "byte-identical" },
        preservesUnknownData: { const: true },
        notes: fidelityNotesSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { const: "semantic" },
        preservesUnknownData: { type: "boolean" },
        notes: fidelityNotesSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { enum: ["lossy", "none"] },
        preservesUnknownData: { const: false },
        notes: fidelityNotesSchema
      }
    }
  ]
};
var codecFidelityEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "formatId",
    "representationId",
    "claim",
    "evidenceId",
    "corpusId",
    "corpusDigest",
    "conformanceProfile",
    "optionsFingerprint",
    "inputClass",
    "provenAt"
  ],
  properties: {
    formatId: nonEmptyString,
    representationId: nonEmptyString,
    claim: fidelityClaimSchema,
    evidenceId: nonEmptyString,
    corpusId: nonEmptyString,
    corpusDigest: nonEmptyString,
    conformanceProfile: qualifiedId,
    optionsFingerprint: nonEmptyString,
    inputClass: nonEmptyString,
    provenAt: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$"
    }
  }
};
var codecContributionRequired = [
  "formatRefs",
  "roles",
  "sourceTopology",
  "artifactStages",
  "openIntents",
  "match",
  "probe",
  "representations",
  "publishesDataSources",
  "operations",
  "implementationTier",
  "budgets"
];
var codecContributionProperties = {
  formatRefs: { type: "array", items: formatRefSchema, minItems: 1 },
  roles: {
    type: "array",
    items: { enum: ["container", "media", "byte-transform", "semantic", "index", "sidecar"] },
    minItems: 1
  },
  artifactStages: {
    type: "array",
    items: { enum: ["authored", "compiled", "runtime"] },
    minItems: 1
  },
  openIntents: {
    type: "array",
    items: { enum: ["probe", "inspect", "thumbnail", "full", "stream", "export"] },
    minItems: 1
  },
  match: matchRulesSchema,
  companions: { type: "array", items: companionRuleSchema },
  representations: { type: "array", items: representationDeclSchema, minItems: 1 },
  publishesDataSources: { type: "array", items: dataSourceRefWireSchema },
  requires: { type: "array", items: contractRequirementSchema },
  operations: { type: "array", items: operationDeclSchema },
  traitDeclarations: { type: "array", items: traitDeclarationSchema },
  fidelityEvidence: { type: "array", items: codecFidelityEvidenceSchema },
  implementationTier: {
    type: "object",
    additionalProperties: false,
    required: ["claimed"],
    properties: { claimed: { enum: [1, 2, 3, 4, 5] } }
  },
  budgets: resourceBudgetWireSchema
};
var codecContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/codec-contribution-spec.v1.schema.json",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { enum: ["single", "bundle"] },
        probe: probePlanSchema.oneOf[0]
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { const: "namespace" },
        probe: probePlanSchema.oneOf[1]
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { const: "derived" },
        probe: probePlanSchema.oneOf[2]
      }
    }
  ]
};
var serviceContractOfferDeclarationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["offerId", "contract", "major", "version"],
  properties: {
    offerId: { type: "string", pattern: SEGMENT_PATTERN },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    version: { type: "string", pattern: SEMVER_PATTERN },
    facet: { title: "JsonValue" }
  }
};
var serviceProviderContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/service-provider-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["provides", "lifecycleScope"],
  properties: {
    provides: { type: "array", items: serviceContractOfferDeclarationSchema, minItems: 1 },
    requires: { type: "array", items: contractRequirementSchema },
    inputs: { type: "array", items: nonEmptyString },
    outputs: { type: "array", items: traitDeclarationSchema },
    protocolOperations: { type: "array", items: nonEmptyString },
    replacement: {
      type: "object",
      additionalProperties: false,
      required: ["target", "compatible"],
      properties: { target: contractRequirementSchema, compatible: { type: "boolean" } }
    },
    lifecycleScope: { enum: ["session", "operation", "process"] },
    applicableVariants: { type: "array", items: { type: "string", pattern: SEGMENT_PATTERN } }
  }
};
var traitRequirementSchema = traitQueryRequirementSchema;
var viewerApplicabilitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    interpretation: { enum: ["none", "codec", "any"] },
    sourceBytes: {
      type: "object",
      additionalProperties: false,
      properties: { maximum: decimalU64 }
    },
    longestLineBytes: {
      type: "object",
      additionalProperties: false,
      required: ["maximum", "whenUnknown"],
      properties: {
        maximum: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        whenUnknown: { enum: ["eligible", "ineligible"] }
      }
    }
  }
};
var viewerContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/viewer-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["kind", "consumesDataSources", "priority"],
  properties: {
    kind: { enum: ["stage", "tree", "panel", "toolbar", "transport", "status", "fallback"] },
    requiresTraits: { type: "array", items: traitRequirementSchema },
    requiresOperations: { type: "array", items: operationId2 },
    consumesDataSources: { type: "array", items: dataSourceRefWireSchema },
    /*
     * Sources a viewer reads when the subject publishes them and does without when it does not.
     *
     * Kept apart from `consumesDataSources` because that list decides eligibility: a facet named
     * there would cost the stage every subject that publishes none of them, which is the opposite
     * of optional. Naming them separately is what lets one generic viewer consume the optional
     * model facets instead of splitting into a contribution per facet combination.
     */
    optionalDataSources: { type: "array", items: dataSourceRefWireSchema },
    applicability: viewerApplicabilitySchema,
    hosts: { type: "array", items: nonEmptyString },
    priority: { type: "number" },
    conflicts: { type: "array", items: nonEmptyString },
    singletonGroup: nonEmptyString
  }
};
var writerRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formatId", "representationId", "mutationMode", "minimumRoundTrip"],
  properties: {
    formatId: nonEmptyString,
    representationId: nonEmptyString,
    mutationMode: { enum: ["export-only", "mutate"] },
    minimumRoundTrip: { enum: ["byte-identical", "semantic", "lossy", "none"] }
  }
};
var writerRequirementV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/writer-requirement.v1.schema.json",
  ...writerRequirementSchema
};
var writerOfferV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/writer-offer.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [...writerRequirementSchema.required, "providerId", "fidelityEvidenceId"],
  properties: {
    ...writerRequirementSchema.properties,
    providerId: nonEmptyString,
    fidelityEvidenceId: nonEmptyString
  }
};
var editorContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/editor-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "sessionModel",
    "selectionKinds",
    "semanticLocationKinds",
    "requiresTransactions",
    "requiresOperations",
    "consumesDataSources",
    "writer",
    "priority"
  ],
  properties: {
    sessionModel: { enum: ["single-subject", "multi-subject", "workspace"] },
    selectionKinds: { type: "array", items: nonEmptyString, uniqueItems: true },
    semanticLocationKinds: { type: "array", items: nonEmptyString, uniqueItems: true },
    requiresTransactions: { type: "boolean" },
    requiresOperations: { type: "array", items: operationId2, uniqueItems: true },
    consumesDataSources: { type: "array", items: dataSourceRefWireSchema, uniqueItems: true },
    writer: writerRequirementSchema,
    hosts: { type: "array", items: nonEmptyString, uniqueItems: true },
    priority: { type: "number" },
    scaleLimits: {
      type: "object",
      additionalProperties: false,
      properties: {
        maximumSubjects: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maximumRows: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maximumSourceBytes: decimalU64
      }
    }
  }
};
var traitDefinitionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/trait-definition-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "version", "scope", "parametersSchema", "transport"],
  properties: {
    schemaVersion: { const: 1 },
    id: namespacedDottedId,
    version: { type: "string", pattern: SEMVER_PATTERN },
    scope: {
      anyOf: [
        {
          enum: [
            "source",
            "asset",
            "subject",
            "workspace",
            "service",
            "operation",
            "view-session",
            "representation"
          ]
        },
        { type: "string", pattern: QUALIFIED_PATTERN }
      ]
    },
    parametersSchema: jsonSchemaRefSchema,
    transport: { enum: ["json", "structured-clone"] },
    documentation: nonEmptyString,
    imports: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "range"],
        properties: {
          id: namespacedDottedId,
          range: { type: "string", pattern: VERSION_RANGE_PATTERN }
        }
      }
    }
  }
};
var methodName = { type: "string", pattern: METHOD_NAME_PATTERN };
var dataSourceSurfaceRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contract", "major"],
  properties: {
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var dataSourceMethodLimitsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    maxPageItems: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxStringLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var argKeyRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["arg", "key"],
  properties: {
    arg: { type: "integer", minimum: 0, maximum: 16 },
    key: methodName
  }
};
var dataSourceMethodSurfaceCommon = {
  /**
   * Where the executing side places the `AbortSignal`: appended last, nowhere, or as a key of an
   * object argument (the consumer strips that key before sending, the executor re-creates it).
   */
  signal: { anyOf: [{ enum: ["last", "none"] }, argKeyRefSchema] },
  /** Where a progress callback lives inside an object argument (`invoke(…, { onProgress })`). */
  progress: argKeyRefSchema,
  /**
   * Positional argument count before the signal. The executing side pads omitted trailing
   * arguments with `undefined` up to `arity` before appending the signal, so
   * `encoded(trackId?, signal?)` called as `encoded()` still receives its signal last.
   */
  arity: { type: "integer", minimum: 0, maximum: 16 },
  /** The ABI declares the method with `?`; an implementation may lack it. */
  optional: { type: "boolean" },
  limits: dataSourceMethodLimitsSchema
};
var dataSourceMethodSurfaceV1Schema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "result"],
      properties: {
        kind: { const: "lease" },
        result: dataSourceSurfaceRefSchema,
        /** `'lease'` materializes `{ value, release }`; `'bare'` (default) the capability object itself. */
        wrapper: { enum: ["lease", "bare"] },
        ...dataSourceMethodSurfaceCommon
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { enum: ["value", "leased-value", "iterable", "events"] },
        ...dataSourceMethodSurfaceCommon
      }
    }
  ]
};
var dataSourceSurfaceV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["methods"],
  properties: {
    /** A `value` method whose completion also releases the capability (`dispose`-style ABIs). */
    releaseVia: methodName,
    /**
     * Data properties of the object copied to the consumer with its handle (`TextSyntaxProvider.contract`);
     * exposed as read-only properties next to the proxied methods.
     */
    fields: { type: "array", items: methodName, maxItems: 64, uniqueItems: true },
    methods: {
      type: "object",
      minProperties: 1,
      propertyNames: methodName,
      additionalProperties: dataSourceMethodSurfaceV1Schema
    }
  }
};
var serviceContractDefinitionSpecV1Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "contract",
    "major",
    "offerFacet",
    "requestFacet",
    "matching",
    "conformanceProfile"
  ],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: "service" },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    offerFacet: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["presence"],
          properties: { presence: { const: "forbidden" } }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["presence", "schema"],
          properties: {
            presence: { enum: ["optional", "required"] },
            schema: jsonSchemaRefSchema
          }
        }
      ]
    },
    requestFacet: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["presence"],
          properties: { presence: { const: "forbidden" } }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["presence", "schema"],
          properties: {
            presence: { enum: ["optional", "required"] },
            schema: jsonSchemaRefSchema
          }
        }
      ]
    },
    matching: {
      type: "object",
      additionalProperties: false,
      required: ["profile", "major"],
      properties: {
        profile: qualifiedId,
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        configuration: { title: "JsonValue" }
      }
    },
    conformanceProfile: nonEmptyString,
    surface: dataSourceSurfaceV1Schema
  }
};
var dataSourceContractDefinitionSpecV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "contract", "major", "schema", "conformanceProfile"],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: "data-source" },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    schema: jsonSchemaRefSchema,
    conformanceProfile: nonEmptyString,
    surface: dataSourceSurfaceV1Schema
  }
};
var contractDefinitionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/contract-definition-spec.v1.schema.json",
  oneOf: [serviceContractDefinitionSpecV1Schema, dataSourceContractDefinitionSpecV1Schema]
};
deepFreeze(jsonSchemaRefSchema);
deepFreeze(resourceBudgetWireSchema);
deepFreeze(dataSourceRefWireSchema);
deepFreeze(codecContributionSpecV1Schema);
deepFreeze(serviceProviderContributionSpecV1Schema);
deepFreeze(viewerContributionSpecV1Schema);
deepFreeze(editorContributionSpecV1Schema);
deepFreeze(traitDefinitionSpecV1Schema);
deepFreeze(serviceContractDefinitionSpecV1Schema);
deepFreeze(dataSourceMethodSurfaceV1Schema);
deepFreeze(dataSourceSurfaceV1Schema);
deepFreeze(dataSourceContractDefinitionSpecV1Schema);
deepFreeze(contractDefinitionSpecV1Schema);
var WRITER_CONTRACT_ID = "common.edit/writer";
var WRITER_FACET_MATCHER_PROFILE = "org.modkitx/writer-facet-matcher";
var writerSurface = {
  fields: ["identity", "offer"],
  methods: {
    validate: { kind: "value", signal: "last", arity: 1 },
    plan: { kind: "value", signal: "last", arity: 1 }
  }
};
var WRITER_SURFACE = deepFreeze(writerSurface);
var STANDARD_EDITING_SURFACES = deepFreeze({ [WRITER_CONTRACT_ID]: WRITER_SURFACE });
var ROUND_TRIP_RANK = Object.freeze({
  "byte-identical": 3,
  semantic: 2,
  lossy: 1,
  none: 0
});
function writerOfferSatisfies(request, offer) {
  return request.formatId === offer.formatId && request.representationId === offer.representationId && (request.mutationMode === "export-only" || offer.mutationMode === "mutate") && ROUND_TRIP_RANK[offer.minimumRoundTrip] >= ROUND_TRIP_RANK[request.minimumRoundTrip];
}
function writerSelectionKey(request) {
  return `writer:${request.formatId}:${request.representationId}:${request.mutationMode}:${request.minimumRoundTrip}`;
}
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
var sourceSpanValueSchema = { oneOf: sourceSpanSchema.oneOf };
var nonEmptyString2 = { type: "string", minLength: 1 };
var nonWhitespaceString = { type: "string", pattern: "\\S" };
var revisionString = { type: "string", pattern: REVISION_ID_PATTERN };
var namespacedDottedId2 = { type: "string", pattern: NAMESPACED_DOTTED_PATTERN };
var operationId22 = { type: "string", pattern: OPERATION_PATTERN };
var stringArray = { type: "array", items: { type: "string" } };
var jsonValueRef = { $ref: "#/$defs/jsonValue" };
var jsonValueSchema = {
  title: "JsonValue",
  oneOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number" },
    { type: "string" },
    { type: "array", items: jsonValueRef },
    { type: "object", additionalProperties: jsonValueRef }
  ]
};
var assetSourceRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "uri"],
  properties: {
    id: nonWhitespaceString,
    uri: nonWhitespaceString,
    parentIds: { type: "array", items: nonWhitespaceString, minItems: 1 }
  }
};
var sourceBindingDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "role", "source", "required", "ownership", "revision"],
  properties: {
    id: nonEmptyString2,
    role: nonEmptyString2,
    source: assetSourceRefSchema,
    required: { type: "boolean" },
    ownership: { enum: ["owned", "companion", "external"] },
    revision: revisionString,
    mediaType: nonEmptyString2
  }
};
var subjectSnapshotRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bindingId", "role", "subjectUri", "revision", "compositionFingerprint"],
  properties: {
    bindingId: nonEmptyString2,
    role: nonEmptyString2,
    subjectUri: nonEmptyString2,
    revision: revisionString,
    compositionFingerprint: nonEmptyString2
  }
};
var derivationRecipeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["extensionId", "extensionVersion", "contributionId", "operation"],
  properties: {
    extensionId: { type: "string", pattern: QUALIFIED_PATTERN },
    extensionVersion: { type: "string", pattern: SEMVER_PATTERN },
    contributionId: { type: "string", pattern: QUALIFIED_PATTERN },
    operation: operationId22,
    parameters: jsonValueRef
  }
};
var materializedAssetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "revision"],
  properties: {
    source: assetSourceRefSchema,
    revision: revisionString,
    mediaType: nonEmptyString2
  }
};
var assetOriginDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "binding"],
      properties: {
        kind: { const: "single" },
        binding: sourceBindingDescriptorSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "bindings"],
      properties: {
        kind: { const: "bundle" },
        bindings: { type: "array", items: sourceBindingDescriptorSchema, minItems: 1 },
        primary: nonEmptyString2
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "root", "revision"],
      properties: {
        kind: { const: "namespace" },
        root: assetSourceRefSchema,
        revision: revisionString
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "inputs"],
      properties: {
        kind: { const: "derived" },
        inputs: { type: "array", items: subjectSnapshotRefSchema, minItems: 1 },
        recipe: derivationRecipeSchema,
        materialization: materializedAssetSchema
      }
    }
  ]
};
var diagnosticSourceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    extensionId: { type: "string", pattern: QUALIFIED_PATTERN },
    contributionId: { type: "string", pattern: QUALIFIED_PATTERN }
  }
};
var assetDiagnosticSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "code", "category", "severity", "message"],
  properties: {
    id: nonEmptyString2,
    code: { type: "string", pattern: QUALIFIED_PATTERN },
    category: {
      enum: [
        "syntax",
        "structure",
        "fidelity",
        "dependency",
        "security",
        "performance",
        "operation",
        "io",
        "unknown"
      ]
    },
    severity: { enum: ["error", "warning", "information", "hint"] },
    message: { type: "string" },
    source: diagnosticSourceSchema,
    path: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
        ]
      }
    },
    range: sourceSpanValueSchema,
    data: jsonValueRef,
    relatedIds: stringArray
  }
};
var traitProperties = {
  id: namespacedDottedId2,
  descriptorVersion: { const: 1 },
  definitionVersion: { type: "string", pattern: SEMVER_PATTERN },
  parameters: jsonValueRef
};
var traitInstanceSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "descriptorVersion", "state"],
      properties: { ...traitProperties, state: { const: "available" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "descriptorVersion", "state", "diagnosticIds"],
      properties: {
        ...traitProperties,
        state: { enum: ["partial", "disabled", "dependency-required"] },
        diagnosticIds: { ...stringArray, minItems: 1 }
      }
    }
  ]
};
var jsonSchemaRefSchema2 = {
  type: "object",
  additionalProperties: false,
  required: ["$ref"],
  properties: { $ref: nonEmptyString2 }
};
var operationProperties = {
  id: operationId22,
  handlerId: nonEmptyString2,
  mutatesSource: { type: "boolean" },
  inputSchema: jsonSchemaRefSchema2
};
var assetOperationDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "handlerId", "state", "mutatesSource"],
      properties: { ...operationProperties, state: { const: "available" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "handlerId", "state", "mutatesSource", "reason"],
      properties: {
        ...operationProperties,
        state: { enum: ["disabled", "dependency-required"] },
        reason: nonEmptyString2
      }
    }
  ]
};
var assetConstraintsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["readOnly", "seekable", "randomAccess", "trusted"],
  properties: {
    readOnly: { type: "boolean" },
    seekable: { type: "boolean" },
    randomAccess: { type: "boolean" },
    trusted: { type: "boolean" },
    maxDecodedBytes: { type: "string", pattern: UINT64_DECIMAL_PATTERN },
    unsupportedFeatures: stringArray
  }
};
var metadataEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "value"],
  properties: {
    key: nonEmptyString2,
    value: jsonValueRef
  }
};
var metadataGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "entries"],
  properties: {
    id: nonEmptyString2,
    label: { type: "string" },
    entries: { type: "array", items: metadataEntrySchema }
  }
};
var companionBaseProperties = {
  id: nonEmptyString2,
  role: nonEmptyString2,
  required: { type: "boolean" },
  cardinality: { enum: ["one", "zero-or-one", "one-or-more", "many"] },
  state: { enum: ["resolved", "missing", "ambiguous"] }
};
var requiredCompanionProperties = {
  ...companionBaseProperties,
  required: { const: true },
  cardinality: { enum: ["one", "one-or-more"] }
};
var optionalCompanionProperties = {
  ...companionBaseProperties,
  required: { const: false },
  cardinality: { enum: ["zero-or-one", "many"] }
};
var companionCandidateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "revision"],
  properties: { source: assetSourceRefSchema, revision: revisionString }
};
var companionBindingIdsSchema = {
  type: "array",
  items: nonEmptyString2,
  minItems: 1,
  uniqueItems: true
};
var singleCompanionBindingIdSchema = {
  ...companionBindingIdsSchema,
  maxItems: 1
};
var companionDiagnosticIdsSchema = {
  type: "array",
  items: nonEmptyString2,
  minItems: 1,
  uniqueItems: true
};
var companionDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one" },
        state: { const: "resolved" },
        bindingIds: singleCompanionBindingIdSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one-or-more" },
        state: { const: "resolved" },
        bindingIds: companionBindingIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "zero-or-one" },
        state: { const: "resolved" },
        bindingIds: singleCompanionBindingIdSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "many" },
        state: { const: "resolved" },
        bindingIds: companionBindingIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "diagnosticIds"],
      properties: {
        ...requiredCompanionProperties,
        state: { const: "missing" },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state"],
      properties: {
        ...optionalCompanionProperties,
        state: { const: "missing" },
        diagnosticIds: { type: "array", items: nonEmptyString2, uniqueItems: true }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "candidates", "diagnosticIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one" },
        state: { const: "ambiguous" },
        candidates: {
          type: "array",
          items: companionCandidateSchema,
          minItems: 2,
          uniqueItems: true
        },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "candidates", "diagnosticIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "zero-or-one" },
        state: { const: "ambiguous" },
        candidates: {
          type: "array",
          items: companionCandidateSchema,
          minItems: 2,
          uniqueItems: true
        },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    }
  ]
};
var detectionEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "weight"],
  properties: {
    kind: { enum: ["magic", "structure", "companion", "context", "extension", "user-override"] },
    weight: { type: "number" },
    note: { type: "string" }
  }
};
var detectionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["codecId", "confidence", "evidence", "requiredRanges"],
  properties: {
    codecId: { type: "string", pattern: QUALIFIED_PATTERN },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "array", items: detectionEvidenceSchema },
    requiredRanges: { type: "array", items: sourceSpanValueSchema },
    diagnostics: { type: "array", items: assetDiagnosticSchema }
  }
};
var resolvedIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["codecId", "codecVersion", "formatId", "formatLabel", "confidence", "detection"],
  properties: {
    codecId: { type: "string", pattern: QUALIFIED_PATTERN },
    codecVersion: { type: "string", pattern: SEMVER_PATTERN },
    formatId: nonEmptyString2,
    formatLabel: nonEmptyString2,
    mediaType: nonEmptyString2,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    detection: { type: "array", items: detectionEvidenceSchema }
  }
};
var subjectRequired = [
  "schemaVersion",
  "subjectUri",
  "origin",
  "traits",
  "operations",
  "constraints",
  "dataSources",
  "diagnostics",
  "revision"
];
var subjectProperties = {
  schemaVersion: { const: 2 },
  subjectUri: nonWhitespaceString,
  origin: assetOriginDescriptorSchema,
  traits: { type: "array", items: traitInstanceSchema },
  operations: { type: "array", items: assetOperationDescriptorSchema },
  constraints: assetConstraintsSchema,
  dataSources: { type: "array", items: dataSourceRefWireSchema },
  diagnostics: { type: "array", items: assetDiagnosticSchema },
  revision: revisionString
};
var unresolvedSourceDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: [...subjectRequired, "interpretation", "candidates"],
  properties: {
    ...subjectProperties,
    interpretation: { const: "none" },
    candidates: { type: "array", items: detectionResultSchema }
  }
};
var resolvedAssetDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: [...subjectRequired, "interpretation", "identity", "metadata"],
  properties: {
    ...subjectProperties,
    interpretation: { const: "codec" },
    identity: resolvedIdentitySchema,
    metadata: { type: "array", items: metadataGroupSchema },
    companions: { type: "array", items: companionDescriptorSchema }
  }
};
var subjectDescriptorV2Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/subject-descriptor.v2.schema.json",
  $defs: { jsonValue: jsonValueSchema },
  oneOf: [unresolvedSourceDescriptorSchema, resolvedAssetDescriptorSchema]
};
var subjectDescriptorV2InferenceSchema = {
  ...subjectDescriptorV2Schema,
  $defs: {
    ...subjectDescriptorV2Schema.$defs,
    jsonValue: { title: "JsonValue" }
  }
};
deepFreeze(subjectDescriptorV2Schema);
deepFreeze(subjectDescriptorV2InferenceSchema);
var STANDARD_HOST_FACILITY_IDS = Object.freeze([
  "clipboard.write",
  "credential.broker",
  "dialog.file-picker",
  "directory.watch",
  "editor.host-native",
  "extension.catalog.read",
  "extension.install.mutate",
  "extension.install.plan",
  "filesystem.atomic-replace",
  "filesystem.read-random",
  "gpu.webgl2",
  "gpu.webgpu",
  "native-process.rpc",
  "native.load",
  "network.range-fetch",
  "notification.system",
  "process.launch",
  "product.inventory.native-bridge",
  "product.inventory.read",
  "storage.durable-handles",
  "storage.opfs",
  "storage.quota",
  "update.service-worker",
  "wasm.simd",
  "wasm.threads",
  "window.custom-chrome",
  "worker.module",
  "worker.shared"
]);
var LEGACY_HOST_FACILITY_ALIASES = Object.freeze([
  "editor.monaco"
]);
var HOST_TRANSPORT_KINDS = Object.freeze([
  "in-process",
  "structured-clone",
  "rpc-handle",
  "stream",
  "transferable-buffer",
  "shared-memory-view",
  "native-process-rpc"
]);
var standardFacilities = new Set(STANDARD_HOST_FACILITY_IDS);
var legacyFacilities = new Set(LEGACY_HOST_FACILITY_ALIASES);
var transportKinds = new Set(HOST_TRANSPORT_KINDS);
var TRAIT_IDS = Object.freeze([
  "content.metadata",
  "content.binary",
  "content.text",
  "content.images",
  "content.fonts",
  "content.styles",
  "content.scripts",
  "content.thumbnails",
  "image.raster",
  "image.channels",
  "image.mipmaps",
  "image.subresources",
  "image.compressed-blocks",
  "image.frames",
  "image.palette",
  "image.color-profile",
  "vector.scene",
  "vector.paths",
  "vector.shapes",
  "vector.text",
  "vector.gradients",
  "document.flow",
  "document.pages",
  "document.outline",
  "document.annotations",
  "table.sheets",
  "table.cells",
  "table.formulas",
  "presentation.slides",
  "presentation.masters",
  "design.components",
  "design.constraints",
  "structure.hierarchy",
  "structure.layers",
  "structure.nodes",
  "structure.timeline",
  "project.editable",
  "project.companions",
  "model.geometry",
  "model.materials",
  "model.textures",
  "model.skeleton",
  "model.animations",
  "model.lods",
  "scene.objects",
  "scene.cameras",
  "scene.lights",
  "scene.effects",
  "audio.streams",
  "audio.waveform",
  "audio.loop-points",
  "video.streams",
  "video.tracks",
  "media.duration",
  "media.frames",
  "media.seekable",
  "media.interactive-runtime",
  "container.entries",
  "container.directories",
  "container.nested",
  "container.compression",
  "container.encryption",
  "container.overlay",
  "source.dependencies",
  "font.glyphs",
  "font.metrics",
  "font.character-map",
  "code.source",
  "code.shader",
  "code.node-graph",
  "game.map",
  "game.replay",
  "game.layout",
  "game.localization",
  "game.catalog"
]);
var STANDARD_TRAIT_SET = new Set(TRAIT_IDS);
function isStandardTraitId(value2) {
  return STANDARD_TRAIT_SET.has(value2);
}
var CODEC_CONTRIBUTION_CONTRACT = contractId("org.modkitx/codec-contribution");
var SERVICE_PROVIDER_CONTRIBUTION_CONTRACT = contractId(
  "org.modkitx/service-provider-contribution"
);
var VIEWER_CONTRIBUTION_CONTRACT = contractId(
  "org.modkitx/viewer-contribution"
);
var EDITOR_CONTRIBUTION_CONTRACT = contractId(
  "org.modkitx/editor-contribution"
);
var TRAIT_DEFINITION_CONTRIBUTION_CONTRACT = contractId(
  "org.modkitx/trait-definition"
);
var CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT = contractId(
  "org.modkitx/contract-definition"
);
var TRAIT_DEFINITION_FACT = contractId(
  "org.modkitx.inventory/trait-definition"
);
var CONTRACT_DEFINITION_FACT = contractId(
  "org.modkitx.inventory/contract-definition"
);
var EDITOR_CONTRIBUTION_FACT = contractId(
  "org.modkitx.inventory/editor-contribution"
);
function duplicateFieldDiagnostics(values, path, label) {
  const first = /* @__PURE__ */ new Map();
  const diagnostics = [];
  values.forEach((value2, index) => {
    const previous = first.get(value2);
    if (previous === void 0) first.set(value2, index);
    else {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/duplicate-semantic-id",
          `${label} ${value2} duplicates index ${previous}`,
          [...path, index]
        )
      );
    }
  });
  return diagnostics;
}
function requirementRangeDiagnostics(requirement, path) {
  const parsed = requirement.range === void 0 ? void 0 : parseVersionRange(requirement.range);
  return requirement.range !== void 0 && (parsed === void 0 || !versionRangeTargetsMajor(parsed, requirement.major)) ? [
    diagnostic(
      "error",
      "x3.sdk/invalid-contract-range",
      `contract range ${requirement.range} cannot be evaluated safely`,
      [...path, "range"]
    )
  ] : [];
}
function traitDefinitionRangeDiagnostics(id, range, path) {
  if (isStandardTraitId(id)) {
    return range === void 0 ? [] : [
      diagnostic(
        "error",
        "x3.sdk/standard-trait-versioned",
        `standard trait ${id} does not use an extension definition range`,
        [...path, "definitionRange"]
      )
    ];
  }
  if (range === void 0 || parseVersionRange(range) === void 0) {
    return [
      diagnostic(
        "error",
        "x3.sdk/custom-trait-definition-unbound",
        `custom trait ${id} must declare a safe definition range`,
        [...path, "definitionRange"]
      )
    ];
  }
  return [];
}
function traitDefinitionOfferDiagnostics(id, version, path) {
  if (isStandardTraitId(id)) {
    return version === void 0 ? [] : [
      diagnostic(
        "error",
        "x3.sdk/standard-trait-versioned",
        `standard trait ${id} does not use an extension definition version`,
        [...path, "definitionVersion"]
      )
    ];
  }
  if (version === void 0 || parseSemver(version) === void 0) {
    return [
      diagnostic(
        "error",
        "x3.sdk/custom-trait-definition-unbound",
        `custom trait ${id} must declare one exact safe definition version`,
        [...path, "definitionVersion"]
      )
    ];
  }
  return [];
}
var validateCodecContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const localCodecPrefix = manifest.id;
  const diagnostics = [
    ...duplicateFieldDiagnostics(
      spec.formatRefs.map((format) => format.formatId),
      ["spec", "formatRefs"],
      "format ID"
    ),
    ...duplicateFieldDiagnostics(
      spec.representations.map((representation) => representation.id),
      ["spec", "representations"],
      "representation ID"
    ),
    ...duplicateFieldDiagnostics(
      spec.companions?.map((companion) => companion.id) ?? [],
      ["spec", "companions"],
      "companion rule ID"
    ),
    ...duplicateFieldDiagnostics(
      spec.traitDeclarations?.map(
        (declaration) => `${declaration.id}\0${declaration.representation}`
      ) ?? [],
      ["spec", "traitDeclarations"],
      "trait declaration coordinate"
    ),
    ...duplicateFieldDiagnostics(
      spec.operations.map((operation) => operation.id),
      ["spec", "operations"],
      "operation ID"
    ),
    ...duplicateFieldDiagnostics(
      spec.operations.map((operation) => operation.handlerId),
      ["spec", "operations"],
      "operation handler ID"
    ),
    ...duplicateFieldDiagnostics(
      spec.fidelityEvidence?.map((item) => item.evidenceId) ?? [],
      ["spec", "fidelityEvidence"],
      "fidelity evidence ID"
    )
  ];
  const formatIds = new Set(spec.formatRefs.map((format) => format.formatId));
  const representationIds = new Set(
    spec.representations.map((representation) => representation.id)
  );
  spec.fidelityEvidence?.forEach((item, index) => {
    if (!formatIds.has(item.formatId)) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/fidelity-evidence-format-unknown",
          `fidelity evidence ${item.evidenceId} names undeclared format ${item.formatId}`,
          ["spec", "fidelityEvidence", index, "formatId"]
        )
      );
    }
    if (!representationIds.has(item.representationId)) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/fidelity-evidence-representation-unknown",
          `fidelity evidence ${item.evidenceId} names undeclared representation ${item.representationId}`,
          ["spec", "fidelityEvidence", index, "representationId"]
        )
      );
    }
  });
  const expectedProbeKind = spec.sourceTopology === "namespace" ? "namespace" : spec.sourceTopology === "derived" ? "derived" : "bytes";
  if (spec.probe.kind !== expectedProbeKind) {
    diagnostics.push(
      diagnostic(
        "error",
        "x3.sdk/probe-topology-mismatch",
        `topology ${spec.sourceTopology} requires a ${expectedProbeKind} probe policy`,
        ["spec", "probe", "kind"]
      )
    );
  }
  spec.requires?.forEach((requirement, index) => {
    diagnostics.push(...requirementRangeDiagnostics(requirement, ["spec", "requires", index]));
  });
  spec.traitDeclarations?.forEach((claim, index) => {
    diagnostics.push(
      ...traitDefinitionOfferDiagnostics(claim.id, claim.definitionVersion, [
        "spec",
        "traitDeclarations",
        index
      ])
    );
    claim.prerequisites?.forEach((requirement, requirementIndex) => {
      diagnostics.push(
        ...requirementRangeDiagnostics(requirement, [
          "spec",
          "traitDeclarations",
          index,
          "prerequisites",
          requirementIndex
        ])
      );
    });
  });
  spec.companions?.forEach((companion, companionIndex) => {
    for (const selector of ["all", "any", "none"]) {
      companion.expected?.[selector]?.forEach((requirement, requirementIndex) => {
        diagnostics.push(
          ...traitDefinitionRangeDiagnostics(requirement.id, requirement.definitionRange, [
            "spec",
            "companions",
            companionIndex,
            "expected",
            selector,
            requirementIndex
          ])
        );
      });
    }
  });
  spec.operations.forEach((operation, index) => {
    if (operation.requiresContract !== void 0) {
      diagnostics.push(
        ...requirementRangeDiagnostics(operation.requiresContract, [
          "spec",
          "operations",
          index,
          "requiresContract"
        ])
      );
    }
    const shared = SHARED_OPERATION_IDS.includes(operation.id);
    const canonicalDomain = OPERATION_DOMAINS.some((domain) => {
      const prefix = `${domain}.`;
      return operation.id.startsWith(prefix) && isSegment(operation.id.slice(prefix.length));
    });
    const localSuffix = operation.id.startsWith(`${localCodecPrefix}.`) ? operation.id.slice(localCodecPrefix.length + 1) : void 0;
    const codecLocal = localSuffix !== void 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(localSuffix);
    if (!shared && !canonicalDomain && !codecLocal) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/invalid-operation-namespace",
          `operation ${operation.id} is not shared, canonical-domain, or local to ${manifest.id}`,
          ["spec", "operations", index, "id"]
        )
      );
    }
  });
  const requiredPermissions = /* @__PURE__ */ new Set(["read-source"]);
  spec.operations.forEach((operation) => {
    if (operation.mutatesSource) requiredPermissions.add("write-source");
    operation.requiredPermissions?.forEach((permission) => requiredPermissions.add(permission));
  });
  manifest.runtimeVariants?.forEach((variant, variantIndex) => {
    const requested = new Set(variant.requestedPermissionClasses);
    for (const permission of requiredPermissions) {
      if (!requested.has(permission)) {
        diagnostics.push(
          diagnostic(
            "error",
            "x3.sdk/variant-permission-underdeclared",
            `runtime variant ${variant.variantId} does not request ${permission}`,
            ["runtimeVariants", variantIndex, "requestedPermissionClasses"]
          )
        );
      }
    }
  });
  return diagnostics;
};
function isPortableOperationReference(id) {
  if (SHARED_OPERATION_IDS.includes(id)) return true;
  if (OPERATION_DOMAINS.some((domain) => {
    const prefix = `${domain}.`;
    return id.startsWith(prefix) && isSegment(id.slice(prefix.length));
  })) {
    return true;
  }
  const separator = id.lastIndexOf(".");
  return separator > 0 && isQualifiedId(id.slice(0, separator)) && isSegment(id.slice(separator + 1));
}
var validateViewerContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(
      spec.requiresTraits?.map((requirement) => requirement.id) ?? [],
      ["spec", "requiresTraits"],
      "trait requirement"
    ),
    ...duplicateFieldDiagnostics(
      spec.requiresOperations ?? [],
      ["spec", "requiresOperations"],
      "operation requirement"
    )
  ];
  spec.requiresOperations?.forEach((id, index) => {
    if (!isPortableOperationReference(id)) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/invalid-operation-namespace",
          `viewer operation requirement ${id} is not shared, canonical-domain, or qualified-local`,
          ["spec", "requiresOperations", index]
        )
      );
    }
  });
  spec.requiresTraits?.forEach((requirement, index) => {
    diagnostics.push(
      ...traitDefinitionRangeDiagnostics(requirement.id, requirement.definitionRange, [
        "spec",
        "requiresTraits",
        index
      ])
    );
  });
  return diagnostics;
};
var EDITING_OPERATION_IDS = Object.freeze([
  "edit.content",
  "edit.structure",
  "edit.field",
  "edit.undo-redo",
  "source.save",
  "source.save-as"
]);
var validateEditorContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(
      spec.requiresOperations,
      ["spec", "requiresOperations"],
      "operation"
    ),
    ...duplicateFieldDiagnostics(
      spec.consumesDataSources.map((source) => `${source.contract}@${source.major}`),
      ["spec", "consumesDataSources"],
      "data-source requirement"
    )
  ];
  spec.requiresOperations.forEach((id, index) => {
    if (!EDITING_OPERATION_IDS.includes(id)) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/invalid-editor-operation",
          `editor operation ${id} is not one of the shared editing operations`,
          ["spec", "requiresOperations", index]
        )
      );
    }
  });
  if (!spec.requiresOperations.some((id) => id.startsWith("edit."))) {
    diagnostics.push(
      diagnostic(
        "error",
        "x3.sdk/editor-edit-operation-missing",
        "an editor contribution requires an explicit edit operation",
        ["spec", "requiresOperations"]
      )
    );
  }
  if (spec.requiresTransactions && !spec.requiresOperations.some((id) => id === "source.save" || id === "source.save-as")) {
    diagnostics.push(
      diagnostic(
        "error",
        "x3.sdk/editor-save-operation-missing",
        "a transactional editor requires source.save or source.save-as",
        ["spec", "requiresOperations"]
      )
    );
  }
  if (spec.requiresTransactions && spec.writer.mutationMode !== "mutate") {
    diagnostics.push(
      diagnostic(
        "error",
        "x3.sdk/editor-writer-mode-mismatch",
        "a transactional editor requires a mutating writer",
        ["spec", "writer", "mutationMode"]
      )
    );
  }
  return diagnostics;
};
var validateTraitDefinitionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [];
  if (parseSemver(spec.version) === void 0) {
    diagnostics.push(
      diagnostic(
        "error",
        "x3.sdk/invalid-definition-version",
        `trait definition version ${spec.version} cannot be evaluated safely`,
        ["spec", "version"]
      )
    );
  }
  const seen = /* @__PURE__ */ new Map();
  spec.imports?.forEach((dependency, index) => {
    if (dependency.id === spec.id) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/self-definition-import",
          `trait definition ${spec.id} cannot import itself`,
          ["spec", "imports", index, "id"]
        )
      );
    }
    const previous = seen.get(dependency.id);
    if (previous === void 0) seen.set(dependency.id, index);
    else {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/duplicate-definition-import",
          `trait import ${dependency.id} duplicates index ${previous}`,
          ["spec", "imports", index, "id"]
        )
      );
    }
    if (parseVersionRange(dependency.range) === void 0) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/invalid-definition-range",
          `trait import range ${dependency.range} cannot be evaluated safely`,
          ["spec", "imports", index, "range"]
        )
      );
    }
  });
  return diagnostics;
};
var validateContractDefinitionSemantics = (manifest) => {
  const spec = manifest.spec;
  if (!Number.isSafeInteger(spec.major) || spec.major < 0) {
    return [
      diagnostic(
        "error",
        "x3.sdk/invalid-contract-major",
        `contract definition major ${spec.major} is not a safe non-negative integer`,
        ["spec", "major"]
      )
    ];
  }
  if (spec.surface !== void 0) {
    return dataSourceSurfaceDiagnostics(spec.surface, ["spec", "surface"]);
  }
  return [];
};
function dataSourceSurfaceDiagnostics(surface, path) {
  const diagnostics = [];
  if (surface.releaseVia !== void 0) {
    const target = surface.methods[surface.releaseVia];
    if (target === void 0) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/surface-release-via-unknown",
          `releaseVia \xAB${surface.releaseVia}\xBB does not name a declared method`,
          [...path, "releaseVia"]
        )
      );
    } else if (target.kind !== "value") {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/surface-release-via-kind",
          `releaseVia \xAB${surface.releaseVia}\xBB must name a value method, found ${target.kind}`,
          [...path, "releaseVia"]
        )
      );
    }
  }
  for (const field2 of surface.fields ?? []) {
    if (Object.hasOwn(surface.methods, field2)) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/surface-field-is-method",
          `\xAB${field2}\xBB cannot be both a field and a method`,
          [...path, "fields"]
        )
      );
    }
  }
  return diagnostics;
}
var validateServiceProviderContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(
      spec.provides.map((offer) => offer.offerId),
      ["spec", "provides"],
      "offer ID"
    ),
    ...duplicateFieldDiagnostics(
      spec.outputs?.map((output) => `${output.id}\0${output.representation}`) ?? [],
      ["spec", "outputs"],
      "trait declaration coordinate"
    )
  ];
  spec.requires?.forEach((requirement, index) => {
    diagnostics.push(...requirementRangeDiagnostics(requirement, ["spec", "requires", index]));
  });
  spec.outputs?.forEach((claim, index) => {
    diagnostics.push(
      ...traitDefinitionOfferDiagnostics(claim.id, claim.definitionVersion, [
        "spec",
        "outputs",
        index
      ])
    );
    claim.prerequisites?.forEach((requirement, requirementIndex) => {
      diagnostics.push(
        ...requirementRangeDiagnostics(requirement, [
          "spec",
          "outputs",
          index,
          "prerequisites",
          requirementIndex
        ])
      );
    });
  });
  if (spec.replacement !== void 0) {
    diagnostics.push(
      ...requirementRangeDiagnostics(spec.replacement.target, ["spec", "replacement", "target"])
    );
  }
  const variants = new Set((manifest.runtimeVariants ?? []).map((variant) => variant.variantId));
  spec.provides.forEach((offer, index) => {
    const version = parseSemver(offer.version);
    if (version === void 0 || version.major !== offer.major) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/offer-major-mismatch",
          `offer ${offer.offerId} version ${offer.version} does not match major ${offer.major}`,
          ["spec", "provides", index, "version"]
        )
      );
    }
  });
  spec.applicableVariants?.forEach((variantId, index) => {
    if (!variants.has(variantId)) {
      diagnostics.push(
        diagnostic(
          "error",
          "x3.sdk/unknown-applicable-variant",
          `applicable variant ${variantId} is not declared by the envelope`,
          ["spec", "applicableVariants", index]
        )
      );
    }
  });
  return diagnostics;
};
function dataOnlyProjector(factContract) {
  return (manifest, context) => Object.freeze([
    Object.freeze({
      contract: Object.freeze({ id: factContract, major: 1 }),
      value: manifest.spec,
      provenance: Object.freeze({ ...context })
    })
  ]);
}
var A1_SPEC_SCHEMA_ENTRIES = [
  {
    contract: CODEC_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: codecContributionSpecV1Schema,
    validateSemantics: validateCodecContributionSemantics
  },
  {
    contract: SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: serviceProviderContributionSpecV1Schema,
    validateSemantics: validateServiceProviderContributionSemantics
  },
  {
    contract: VIEWER_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: viewerContributionSpecV1Schema,
    validateSemantics: validateViewerContributionSemantics
  },
  {
    contract: EDITOR_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: editorContributionSpecV1Schema,
    validateSemantics: validateEditorContributionSemantics
  },
  {
    contract: TRAIT_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: traitDefinitionSpecV1Schema,
    validateSemantics: validateTraitDefinitionSemantics,
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(TRAIT_DEFINITION_FACT),
      conformanceProfile: "org.modkitx/trait-definition-v1"
    }
  },
  {
    contract: CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: contractDefinitionSpecV1Schema,
    validateSemantics: validateContractDefinitionSemantics,
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(CONTRACT_DEFINITION_FACT),
      conformanceProfile: "org.modkitx/contract-definition-v1"
    }
  }
];
var RUNTIME_SESSION_V2_MEMBERS = Object.freeze([
  "offers",
  "identity",
  "step",
  "events",
  "snapshot",
  "restore",
  "stateHash"
]);
var RESERVED_MODEL_FACET_SOURCES = Object.freeze([
  Object.freeze({
    contract: "common.view/model-socket-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { sockets }",
      "sockets(page): { id, nodeId, role, orientation? }"
    ]),
    blockedBy: "no codec publishes attachment points today: the UVM schema defines UV_game_socket, but the X3 UVM reader does not surface them and no native model codec extracts them"
  }),
  Object.freeze({
    contract: "common.view/model-lod-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { levels }",
      "levels(page): { id, nodeIds, order, selection? }"
    ]),
    blockedBy: "no codec publishes discrete LOD levels today: MSFT_lod topology is readable in principle, and nothing reads it"
  }),
  Object.freeze({
    contract: "common.view/model-variant-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { variants }",
      "variants(page): { id, name, kind, targets }"
    ]),
    blockedBy: "no codec publishes named variants today: UV_game_variants exists in the schema and no reader surfaces it"
  }),
  Object.freeze({
    contract: "common.view/model-effect-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { effects, byKind, profile? }",
      "effects(page): { id, kind, nodeId?, materialId? }"
    ]),
    blockedBy: "the UVM reader publishes effect *counts* by kind, which fills info() and nothing else; per-emitter records have no publisher, and a page method no publisher can fill is not a contract"
  })
]);
var ENCODED_MEDIA_SURFACE_ID = "common.view/encoded-media";
var ENCODED_MEDIA = Object.freeze({
  contract: contractId(ENCODED_MEDIA_SURFACE_ID),
  major: 1
});
var sig = { signal: "last" };
var value = { kind: "value" };
var cancellableValue = { kind: "value", ...sig };
var iterable = { kind: "iterable", ...sig };
var encodedMediaSurface = {
  methods: {
    descriptor: value,
    read: cancellableValue
  }
};
var textDataSourceSurface = {
  methods: {
    info: value,
    slice: cancellableValue,
    search: iterable
  }
};
var byteRangeSourceSurface = {
  methods: {
    size: value,
    read: cancellableValue
  }
};
var treeDataSourceSurface = {
  methods: {
    root: value,
    children: cancellableValue,
    facts: value,
    search: iterable
  }
};
var tableDataSourceSurface = {
  methods: {
    shape: value,
    rows: cancellableValue,
    cell: value,
    search: iterable
  }
};
var transportSourceSurface = {
  methods: {
    snapshot: cancellableValue,
    /** A live stream, not a finite listing: `subscribe` → `event…` → `done`. */
    events: { kind: "events", ...sig }
  }
};
var namespaceEntrySourceSurface = {
  methods: {
    list: cancellableValue,
    /** `Lease<AssetSourceRef>`: the ref crosses by copy, the lease is a release-only handle. */
    openEntry: { kind: "leased-value", ...sig }
  }
};
var rasterImageSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", ...sig },
    readRegion: { kind: "value", optional: true, ...sig }
  }
};
var vectorSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    document: cancellableValue
  }
};
var audioMediaSourceSurface = {
  methods: {
    info: cancellableValue,
    /** `encoded(trackId?, signal?)`: `arity: 1` keeps the signal last when the track is omitted. */
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", arity: 1, ...sig },
    readPcm: { kind: "value", optional: true, ...sig }
  }
};
var videoMediaSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", ...sig },
    readFrame: { kind: "value", optional: true, ...sig }
  }
};
var modelSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    nodes: cancellableValue,
    meshes: cancellableValue,
    primitive: { kind: "value", optional: true, ...sig }
  }
};
var modelResourceRefsSourceSurface = {
  methods: {
    info: cancellableValue,
    references: cancellableValue
  }
};
var modelSkeletonSourceSurface = {
  methods: {
    info: cancellableValue,
    bindings: cancellableValue
  }
};
var modelAnimationSourceSurface = {
  methods: {
    info: cancellableValue,
    clips: cancellableValue
  }
};
var modelCollisionSourceSurface = {
  methods: {
    info: cancellableValue,
    volumes: cancellableValue
  }
};
var modelMaterialSourceSurface = {
  methods: {
    info: cancellableValue,
    materials: cancellableValue
  }
};
var relationGraphSourceSurface = {
  methods: {
    summary: cancellableValue,
    nodes: cancellableValue,
    edges: cancellableValue
  }
};
var slideDeckSourceSurface = {
  methods: {
    info: cancellableValue,
    slides: cancellableValue
  }
};
var subjectFactsSourceSurface = {
  methods: {
    summary: cancellableValue,
    groups: cancellableValue,
    facts: cancellableValue,
    relations: cancellableValue
  }
};
var STANDARD_DATA_SOURCE_SURFACES = deepFreeze({
  "common.view/text-data-source": textDataSourceSurface,
  "common.view/byte-range-source": byteRangeSourceSurface,
  "common.view/tree-data-source": treeDataSourceSurface,
  "common.view/table-data-source": tableDataSourceSurface,
  "common.view/transport-source": transportSourceSurface,
  "common.view/namespace-entry-source": namespaceEntrySourceSurface,
  "common.view/raster-image-source": rasterImageSourceSurface,
  "common.view/vector-scene-source": vectorSceneSourceSurface,
  "common.view/audio-media-source": audioMediaSourceSurface,
  "common.view/video-media-source": videoMediaSourceSurface,
  "common.view/model-scene-source": modelSceneSourceSurface,
  "common.view/model-resource-refs-source": modelResourceRefsSourceSurface,
  "common.view/model-skeleton-source": modelSkeletonSourceSurface,
  "common.view/model-animation-source": modelAnimationSourceSurface,
  "common.view/model-collision-source": modelCollisionSourceSurface,
  "common.view/model-material-source": modelMaterialSourceSurface,
  "common.view/relation-graph-source": relationGraphSourceSurface,
  "common.view/subject-facts-source": subjectFactsSourceSurface,
  "common.view/slide-deck-source": slideDeckSourceSurface
});
var AUXILIARY_DATA_SOURCE_SURFACES = deepFreeze({
  [ENCODED_MEDIA_SURFACE_ID]: encodedMediaSurface
});
var ENCODED_MEDIA_SURFACE_CONTRACT = contractId(ENCODED_MEDIA_SURFACE_ID);
function bindingId(value2) {
  if (!isSegment(value2)) throw new TypeError(`invalid binding id: ${value2}`);
  return value2;
}

// packages/sdk/dist/language/index.js
var LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT = "common.language/document-analysis";
var LANGUAGE_DOCUMENT_MATCHER_PROFILE = "org.modkitx/language-document-matcher";

// packages/sdk/dist/runtime/index.js
var RUNTIME_PROVIDER_CONTRACT = "common.runtime/provider";
var RUNTIME_SESSION_CONTRACT = "common.runtime/session";
var RUNTIME_PROVIDER_MATCHER_PROFILE = "org.modkitx/runtime-provider-matcher";
var RUNTIME_SESSION_V2_MEMBERS2 = Object.freeze([
  "offers",
  "identity",
  "step",
  "events",
  "snapshot",
  "restore",
  "stateHash"
]);

// packages/sdk/dist/renderer/index.js
var SCENE_RENDERER_CONTRACT = "common.render/scene-3d";
var SCENE_RENDERER_MATCHER_PROFILE = "org.modkitx/scene-renderer-matcher";

// packages/sdk/dist/games/index.js
var GAME_INSTALLATION_DISCOVERY_CONTRACT = "common.game/installation-discovery";
var GAME_INSTALLATION_MATCHER_PROFILE = "org.modkitx/game-installation-matcher";

// packages/sdk/dist/mods/index.js
var MOD_WORKSPACE_COMPOSITION_CONTRACT = "common.mod/workspace-composition";
var MOD_WORKSPACE_MATCHER_PROFILE = "org.modkitx/mod-workspace-matcher";

// packages/sdk/dist/data/index.js
var DATA_CATALOG_ANALYSIS_CONTRACT = "common.data/catalog-analysis";
var DATA_CATALOG_MATCHER_PROFILE = "org.modkitx/data-catalog-matcher";

// packages/sdk/dist/maps/index.js
var MAP_SEMANTIC_ANALYSIS_CONTRACT = "common.map/semantic-analysis";
var MAP_SEMANTIC_MATCHER_PROFILE = "org.modkitx/map-semantic-matcher";

// packages/host/dist/index.js
var RESTRICTED_LINKED_EXECUTION = Object.freeze({
  origin: "linked",
  allowTrustedInProcess: false
});
var PROVIDER_OFFER_INVENTORY_FACT = contractId(
  "org.modkitx.inventory/provider-offer"
);
var VIEWER_CONTRIBUTION_INVENTORY_FACT = contractId(
  "org.modkitx.inventory/viewer-contribution"
);
var EVIDENCE_KINDS = Object.freeze([
  "magic",
  "structure",
  "companion",
  "context",
  "extension",
  "user-override"
]);
var DETECTION_EVIDENCE_LADDER = Object.freeze([
  "name-only",
  "generic-syntax",
  "carrier-magic",
  "generic-syntax-and-format-marker",
  "carrier-magic-and-format-structure",
  "format-magic",
  "format-magic-and-second-signal"
]);
var DETECTION_UNTIE_RULES = Object.freeze([
  Object.freeze({
    id: "strictly-highest-confidence-wins",
    rule: "Among candidates at or above the host confidence floor, the one with the strictly highest confidence is selected. There is no secondary ranking by extension id, contribution status, implementation tier or load order.",
    enforcedBy: "packages/host/src/subject-open.ts"
  }),
  Object.freeze({
    id: "an-exact-tie-is-ambiguous",
    rule: "Two or more candidates sharing the top confidence resolve to `unresolved` with reason `ambiguous`. The host never breaks a tie by sort order: a stable sort would make the winner depend on which extension happened to load first, which is a coin toss wearing a rule.",
    enforcedBy: "packages/host/src/subject-open.ts"
  }),
  Object.freeze({
    id: "below-the-floor-is-no-match",
    rule: "A candidate under the host confidence floor is not eligible at all, so a lone weak guess produces `no-match` rather than an open nobody can justify.",
    enforcedBy: "packages/host/src/subject-open.ts"
  }),
  Object.freeze({
    id: "a-carrier-ranks-below-its-passengers",
    rule: "A codec that matched only a carrier magic (ZIP, RIFF) or only a general syntax (UTF-8 text, XML, JSON) must score below a codec that matched the same bytes *and* a structure specific to its own format. The generic route is the fallback for bytes nobody claimed, never the winner over a format that read more.",
    enforcedBy: "the detecting codecs; the ordering is proved in packages/testkit/test/detection-collisions.test.ts"
  }),
  Object.freeze({
    id: "a-second-signal-breaks-a-would-be-tie",
    rule: "Where two routes read the same evidence, the one that also reads an independent second signal \u2014 typically the declared extension \u2014 ranks above it. This is how a relocated port beats the staging route it replaces without either of them inventing evidence.",
    enforcedBy: "the detecting codecs; proved in packages/testkit/test/common-documents-rtf.test.ts"
  }),
  Object.freeze({
    id: "an-extension-alone-never-decides",
    rule: "The file name may add margin to a candidate that already read the bytes; it may never carry one over the confidence floor by itself. A renamed file is decided by its content, and a correctly named file whose content disagrees is refused.",
    enforcedBy: "the detecting codecs; proved in packages/testkit/test/detection-collisions.test.ts"
  }),
  Object.freeze({
    id: "a-foreign-format-scores-zero-not-low",
    rule: "Bytes that positively declare a *different* format are a refusal, not a weak match: an ODP renamed to `.odt` scores zero rather than a hedged number, so it can never win by being the only candidate left.",
    enforcedBy: "extensions/common/documents/src/odf/package.js and its peers"
  }),
  Object.freeze({
    id: "a-declaration-scopes-a-generic",
    rule: "A contribution is put in front of the probe only for bytes its own declaration matches by name or signature, and that \u2014 not confidence \u2014 is what keeps a generic away from another format\u2019s body. `text-ini` scores `Key=Value` lines happily but declares only `.ini`, so it never sees an SC2 `GameStrings.txt`; `text-csv` declares `.csv` and `.tsv`, so it never sees a Warzone `.img` atlas index. A generic that widens its declaration to every path gives this protection up and must then win every collision on confidence alone.",
    enforcedBy: "matchesSpec in packages/host/src/subject-open.ts (an empty rule set is not a wildcard); proved in packages/testkit/test/detection-collisions.test.ts"
  }),
  Object.freeze({
    id: "a-signature-shortlists-but-does-not-select",
    rule: "A declared byte signature only puts a contribution in front of the probe \u2014 a renamed `.dat` PNG reaches the PNG probe. Selection is still decided by the probe result, so a signature can never open a subject on its own.",
    enforcedBy: "packages/host/src/detection-index.ts"
  })
]);
var PROFILE_VALUES = Object.freeze([
  "browser-sandbox",
  "worker-brokered",
  "process-brokered",
  "wasm-brokered",
  "trusted-in-process",
  "remote-provider"
]);
var REGISTRY_BINDINGS = /* @__PURE__ */ Symbol.for("x3.host/execution-backend-registry-bindings");
function invalid(message) {
  return new ModkitError({ code: "x3.host/invalid-execution-backend", message });
}
function createExecutionBackendRegistry(backends) {
  const bindings = /* @__PURE__ */ new Map();
  for (const [index, backend] of backends.entries()) {
    if (typeof backend !== "object" || backend === null) {
      throw invalid(`execution backend[${index}] must be an object`);
    }
    const profile = backend.profile;
    const supports = backend.supports;
    const activate = backend.activate;
    if (!PROFILE_VALUES.includes(profile)) {
      throw invalid(`execution backend[${index}] has an invalid profile`);
    }
    if (typeof supports !== "function" || typeof activate !== "function") {
      throw invalid(`execution backend ${profile} must provide supports and activate callbacks`);
    }
    if (bindings.has(profile)) {
      throw invalid(`execution backend profile ${profile} is registered more than once`);
    }
    bindings.set(profile, Object.freeze({ profile, supports, activate }));
  }
  const profiles = Object.freeze([...bindings.keys()].sort());
  const registry = {
    profiles,
    supports(profile, target, variant) {
      try {
        const binding = bindings.get(profile);
        if (binding === void 0 || variant.executionProfile !== profile) return false;
        return binding.supports(target, variant) === true;
      } catch {
        return false;
      }
    }
  };
  Object.defineProperty(registry, REGISTRY_BINDINGS, {
    value: bindings,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return Object.freeze(registry);
}
var TRUSTED_IN_PROCESS_EXECUTION_BACKEND = Object.freeze({
  profile: "trusted-in-process",
  supports: (_target, variant) => variant.executionProfile === "trusted-in-process",
  async activate(context) {
    throwIfAborted(context.signal);
    const module = await import(context.entrypoint.href);
    return Object.freeze({ module, release: async () => void 0 });
  }
});
var DEFAULT_EXECUTION_BACKENDS = createExecutionBackendRegistry([
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND
]);
var PROBE_PERMISSION_CLASSES = Object.freeze(["read-source"]);
var MAX_SIGNATURE_WINDOW_BYTES = 4096 + 64;
var NAMESPACE_PATH_ENCODER = new TextEncoder();
var DEFAULT_COMPANION_LIMITS = Object.freeze({
  maxEntries: 4096,
  maxProbes: 64,
  maxProbeBytes: 256 * 1024,
  maxBindings: 64
});
var NAMESPACE_SCOPES = Object.freeze([
  "current-mount",
  "enclosing-container"
]);
var FACETLESS_SERVICE_MATCHER_PROFILE = contractId("org.modkitx/facetless-matcher");
var facetlessMatcher = Object.freeze({
  profile: FACETLESS_SERVICE_MATCHER_PROFILE,
  major: 1,
  match(context) {
    return context.offerFacet === void 0 && context.requestFacet === void 0 ? { state: "match", selectionKey: "facetless:v1" } : { state: "no-match" };
  }
});
var REQUIREMENT_KEYS = ["formatId", "representationId", "mutationMode", "minimumRoundTrip"];
var OFFER_KEYS = [...REQUIREMENT_KEYS, "providerId", "fidelityEvidenceId"];
var MUTATION_MODES = /* @__PURE__ */ new Set(["export-only", "mutate"]);
var ROUND_TRIPS = /* @__PURE__ */ new Set(["byte-identical", "semantic", "lossy", "none"]);
function facetOf(value2, keys) {
  if (typeof value2 !== "object" || value2 === null || Array.isArray(value2)) return void 0;
  const record = value2;
  const own2 = Object.keys(record);
  if (own2.length !== keys.length || !keys.every((key2) => own2.includes(key2))) return void 0;
  for (const key2 of keys) {
    if (typeof record[key2] !== "string" || record[key2].length === 0) return void 0;
  }
  if (!MUTATION_MODES.has(record["mutationMode"])) return void 0;
  if (!ROUND_TRIPS.has(record["minimumRoundTrip"])) return void 0;
  return record;
}
function matchWriterFacets(context) {
  const request = facetOf(context.requestFacet, REQUIREMENT_KEYS);
  const offer = facetOf(context.offerFacet, OFFER_KEYS);
  if (request === void 0 || offer === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/writer-facet-invalid",
          `${context.contract}@${context.major}: writer request and offer facets must both be complete`
        )
      ]
    };
  }
  return writerOfferSatisfies(
    request,
    offer
  ) ? {
    state: "match",
    selectionKey: writerSelectionKey(request)
  } : { state: "no-match" };
}
var WRITER_FACET_MATCHER = Object.freeze({
  profile: contractId(WRITER_FACET_MATCHER_PROFILE),
  major: 1,
  match: matchWriterFacets
});
var WRITER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: WRITER_CONTRACT_ID,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({ $ref: "https://schemas.modkitx.org/x3/writer-offer.v1.schema.json" })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/writer-requirement.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: WRITER_FACET_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.edit/writer-v1",
  surface: WRITER_SURFACE
});
var STANDARD_EDITING_DEFINITIONS = Object.freeze([WRITER_CONTRACT_DEFINITION]);
var OFFER_KEYS2 = /* @__PURE__ */ new Set(["languageIds", "documentKinds", "extensions"]);
var REQUEST_KEYS = /* @__PURE__ */ new Set(["languageId", "documentKind", "extension"]);
function recordOf(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function stringList(value2) {
  if (!Array.isArray(value2) || value2.length === 0) return void 0;
  if (!value2.every((item) => typeof item === "string" && item.trim().length > 0)) return void 0;
  const strings = value2;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer(value2) {
  const record = recordOf(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS2.has(key2)))
    return void 0;
  const languageIds = stringList(record["languageIds"]);
  if (languageIds === void 0) return void 0;
  const rawKinds = record["documentKinds"];
  const rawExtensions = record["extensions"];
  const documentKinds = rawKinds === void 0 ? void 0 : stringList(rawKinds);
  const extensions = rawExtensions === void 0 ? void 0 : stringList(rawExtensions);
  if (rawKinds !== void 0 && documentKinds === void 0 || rawExtensions !== void 0 && extensions === void 0) {
    return void 0;
  }
  return {
    languageIds,
    ...documentKinds === void 0 ? {} : { documentKinds },
    ...extensions === void 0 ? {} : { extensions }
  };
}
function parseRequest(value2) {
  const record = recordOf(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS.has(key2)))
    return void 0;
  const languageId = record["languageId"];
  const documentKind = record["documentKind"];
  const extension = record["extension"];
  if (typeof languageId !== "string" || languageId.trim().length === 0) return void 0;
  if (documentKind !== void 0 && (typeof documentKind !== "string" || documentKind.length === 0)) {
    return void 0;
  }
  if (extension !== void 0 && (typeof extension !== "string" || extension.length === 0)) {
    return void 0;
  }
  return {
    languageId,
    ...documentKind === void 0 ? {} : { documentKind },
    ...extension === void 0 ? {} : { extension }
  };
}
var normalizedExtension = (value2) => value2.replace(/^\./u, "").toLowerCase();
function matchLanguageFacets(context) {
  const offer = parseOffer(context.offerFacet);
  const request = parseRequest(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/language-facet-invalid",
          `${context.contract}@${context.major}: language request and offer routes must be well formed`
        )
      ]
    };
  }
  if (!offer.languageIds.includes(request.languageId)) return { state: "no-match" };
  if (request.documentKind !== void 0 && !offer.documentKinds?.includes(request.documentKind)) {
    return { state: "no-match" };
  }
  const requestExtension = request.extension;
  if (requestExtension !== void 0 && !offer.extensions?.some(
    (value2) => normalizedExtension(value2) === normalizedExtension(requestExtension)
  )) {
    return { state: "no-match" };
  }
  return {
    state: "match",
    selectionKey: [
      `language=${request.languageId}`,
      `document=${request.documentKind ?? "*"}`,
      `extension=${request.extension === void 0 ? "*" : normalizedExtension(request.extension)}`
    ].join(";")
  };
}
var LANGUAGE_DOCUMENT_MATCHER = Object.freeze({
  profile: contractId(LANGUAGE_DOCUMENT_MATCHER_PROFILE),
  major: 1,
  match: matchLanguageFacets
});
var LANGUAGE_DOCUMENT_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/language-provider-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/language-provider-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: LANGUAGE_DOCUMENT_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.language/document-analysis-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "languageIds"]),
    methods: Object.freeze({
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS3 = /* @__PURE__ */ new Set(["runtimeIds"]);
var REQUEST_KEYS2 = /* @__PURE__ */ new Set(["runtimeId"]);
function recordOf2(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function nonEmptyString3(value2) {
  return typeof value2 === "string" && value2.trim().length > 0;
}
function stringList2(value2) {
  if (!Array.isArray(value2) || value2.length === 0 || !value2.every(nonEmptyString3)) return void 0;
  const strings = value2;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer2(value2) {
  const record = recordOf2(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS3.has(key2)))
    return void 0;
  const runtimeIds = stringList2(record["runtimeIds"]);
  return runtimeIds === void 0 ? void 0 : { runtimeIds };
}
function parseRequest2(value2) {
  const record = recordOf2(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS2.has(key2)))
    return void 0;
  const runtimeId = record["runtimeId"];
  return nonEmptyString3(runtimeId) ? { runtimeId } : void 0;
}
function matchRuntimeFacets(context) {
  const offer = parseOffer2(context.offerFacet);
  const request = parseRequest2(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/runtime-facet-invalid",
          `${context.contract}@${context.major}: runtime request and offer routes must be well formed`
        )
      ]
    };
  }
  return offer.runtimeIds.includes(request.runtimeId) ? { state: "match", selectionKey: `runtime=${request.runtimeId}` } : { state: "no-match" };
}
var RUNTIME_PROVIDER_MATCHER = Object.freeze({
  profile: contractId(RUNTIME_PROVIDER_MATCHER_PROFILE),
  major: 1,
  match: matchRuntimeFacets
});
var RUNTIME_PROVIDER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RUNTIME_PROVIDER_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/runtime-provider-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/runtime-provider-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: RUNTIME_PROVIDER_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.runtime/provider-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "providerId", "runtimeIds"]),
    methods: Object.freeze({
      createSession: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: RUNTIME_SESSION_CONTRACT, major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var RUNTIME_SESSION_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RUNTIME_SESSION_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({ presence: "forbidden" }),
  requestFacet: Object.freeze({ presence: "forbidden" }),
  matching: Object.freeze({ profile: FACETLESS_SERVICE_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.runtime/session-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "sessionId", "providerId", "budget"]),
    methods: Object.freeze({
      execute: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      status: Object.freeze({ kind: "value" })
    })
  })
});
var STANDARD_RUNTIME_DEFINITIONS = Object.freeze([RUNTIME_PROVIDER_CONTRACT_DEFINITION, RUNTIME_SESSION_CONTRACT_DEFINITION]);
var OFFER_KEYS4 = /* @__PURE__ */ new Set(["rendererIds", "outputKinds"]);
var REQUEST_KEYS3 = /* @__PURE__ */ new Set(["rendererId", "outputKind"]);
var OUTPUT_KINDS = /* @__PURE__ */ new Set(["rgba8"]);
function recordOf3(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function nonEmptyString22(value2) {
  return typeof value2 === "string" && value2.trim().length > 0;
}
function stringList3(value2) {
  if (!Array.isArray(value2) || value2.length === 0 || !value2.every(nonEmptyString22)) return void 0;
  const strings = value2;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function outputKind(value2) {
  return typeof value2 === "string" && OUTPUT_KINDS.has(value2) ? value2 : void 0;
}
function outputKindList(value2) {
  if (!Array.isArray(value2) || value2.length === 0) return void 0;
  const outputKinds = value2.flatMap((item) => {
    const parsed = outputKind(item);
    return parsed === void 0 ? [] : [parsed];
  });
  return outputKinds.length === value2.length && new Set(outputKinds).size === outputKinds.length ? outputKinds : void 0;
}
function parseOffer3(value2) {
  const record = recordOf3(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS4.has(key2)))
    return void 0;
  const rendererIds = stringList3(record["rendererIds"]);
  const outputKinds = outputKindList(record["outputKinds"]);
  return rendererIds === void 0 || outputKinds === void 0 ? void 0 : { rendererIds, outputKinds };
}
function parseRequest3(value2) {
  const record = recordOf3(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS3.has(key2)))
    return void 0;
  const rendererId = record["rendererId"];
  const parsedOutput = outputKind(record["outputKind"]);
  if (parsedOutput === void 0 || rendererId !== void 0 && !nonEmptyString22(rendererId)) {
    return void 0;
  }
  return {
    outputKind: parsedOutput,
    ...rendererId === void 0 ? {} : { rendererId }
  };
}
function matchRendererFacets(context) {
  const offer = parseOffer3(context.offerFacet);
  const request = parseRequest3(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/renderer-facet-invalid",
          `${context.contract}@${context.major}: renderer request and offer routes must be well formed`
        )
      ]
    };
  }
  if (!offer.outputKinds.includes(request.outputKind)) return { state: "no-match" };
  if (request.rendererId !== void 0 && !offer.rendererIds.includes(request.rendererId)) {
    return { state: "no-match" };
  }
  return {
    state: "match",
    selectionKey: `renderer=${request.rendererId ?? "*"};output=${request.outputKind}`
  };
}
var SCENE_RENDERER_MATCHER = Object.freeze({
  profile: contractId(SCENE_RENDERER_MATCHER_PROFILE),
  major: 1,
  match: matchRendererFacets
});
var SCENE_RENDERER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: SCENE_RENDERER_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/scene-renderer-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/scene-renderer-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: SCENE_RENDERER_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.render/scene-3d-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "rendererId", "outputKinds"]),
    methods: Object.freeze({
      render: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS5 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS4 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf4(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function nonEmptyString32(value2) {
  return typeof value2 === "string" && value2.trim().length > 0;
}
function stringList4(value2) {
  if (!Array.isArray(value2) || value2.length === 0 || !value2.every(nonEmptyString32)) return void 0;
  const strings = value2;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer4(value2) {
  const record = recordOf4(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS5.has(key2)))
    return void 0;
  const gameIds = stringList4(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest4(value2) {
  const record = recordOf4(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS4.has(key2))) {
    return void 0;
  }
  return nonEmptyString32(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchGameInstallationFacets(context) {
  const offer = parseOffer4(context.offerFacet);
  const request = parseRequest4(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/game-installation-facet-invalid",
          `${context.contract}@${context.major}: game installation routes must be well formed`
        )
      ]
    };
  }
  return offer.gameIds.includes(request.gameId) ? { state: "match", selectionKey: `game=${request.gameId}` } : { state: "no-match" };
}
var GAME_INSTALLATION_MATCHER = Object.freeze({
  profile: contractId(GAME_INSTALLATION_MATCHER_PROFILE),
  major: 1,
  match: matchGameInstallationFacets
});
var GAME_INSTALLATION_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: GAME_INSTALLATION_DISCOVERY_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/game-installation-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/game-installation-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: GAME_INSTALLATION_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.game/installation-discovery-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "discoveryId", "gameIds", "origins"]),
    methods: Object.freeze({
      discover: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS6 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS5 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf5(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function nonEmptyString4(value2) {
  return typeof value2 === "string" && value2.trim().length > 0;
}
function stringList5(value2) {
  if (!Array.isArray(value2) || value2.length === 0 || !value2.every(nonEmptyString4)) return void 0;
  const strings = value2;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer5(value2) {
  const record = recordOf5(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS6.has(key2))) {
    return void 0;
  }
  const gameIds = stringList5(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest5(value2) {
  const record = recordOf5(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS5.has(key2))) {
    return void 0;
  }
  return nonEmptyString4(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchModWorkspaceFacets(context) {
  const offer = parseOffer5(context.offerFacet);
  const request = parseRequest5(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/mod-workspace-facet-invalid",
          `${context.contract}@${context.major}: mod workspace routes must be well formed`
        )
      ]
    };
  }
  return offer.gameIds.includes(request.gameId) ? { state: "match", selectionKey: `game=${request.gameId}` } : { state: "no-match" };
}
var MOD_WORKSPACE_MATCHER = Object.freeze({
  profile: contractId(MOD_WORKSPACE_MATCHER_PROFILE),
  major: 1,
  match: matchModWorkspaceFacets
});
var MOD_WORKSPACE_CONTRACT_DEFINITION = Object.freeze(
  {
    schemaVersion: 1,
    kind: "service",
    contract: MOD_WORKSPACE_COMPOSITION_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: "required",
      schema: Object.freeze({
        $ref: "https://schemas.modkitx.org/x3/mod-workspace-offer.v1.schema.json"
      })
    }),
    requestFacet: Object.freeze({
      presence: "required",
      schema: Object.freeze({
        $ref: "https://schemas.modkitx.org/x3/mod-workspace-request.v1.schema.json"
      })
    }),
    matching: Object.freeze({ profile: MOD_WORKSPACE_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: "common.mod/workspace-composition-v1",
    surface: Object.freeze({
      fields: Object.freeze(["contract", "compositionId", "gameIds"]),
      methods: Object.freeze({
        compose: Object.freeze({
          kind: "value",
          signal: Object.freeze({ arg: 0, key: "signal" }),
          limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 32768 })
        })
      })
    })
  }
);
var OFFER_KEYS7 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS6 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf6(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function nonEmptyString5(value2) {
  return typeof value2 === "string" && value2.trim().length > 0;
}
function stringList6(value2) {
  if (!Array.isArray(value2) || value2.length === 0 || !value2.every(nonEmptyString5)) return void 0;
  const strings = value2;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer6(value2) {
  const record = recordOf6(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS7.has(key2))) {
    return void 0;
  }
  const gameIds = stringList6(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest6(value2) {
  const record = recordOf6(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS6.has(key2))) {
    return void 0;
  }
  return nonEmptyString5(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchDataCatalogFacets(context) {
  const offer = parseOffer6(context.offerFacet);
  const request = parseRequest6(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/data-catalog-facet-invalid",
          `${context.contract}@${context.major}: data catalog routes must be well formed`
        )
      ]
    };
  }
  return offer.gameIds.includes(request.gameId) ? { state: "match", selectionKey: `game=${request.gameId}` } : { state: "no-match" };
}
var DATA_CATALOG_MATCHER = Object.freeze({
  profile: contractId(DATA_CATALOG_MATCHER_PROFILE),
  major: 1,
  match: matchDataCatalogFacets
});
var DATA_CATALOG_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: DATA_CATALOG_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/data-catalog-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/data-catalog-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: DATA_CATALOG_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.data/catalog-analysis-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "analyzerId", "gameIds"]),
    methods: Object.freeze({
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 16777216, maxStringLength: 4194304 })
      })
    })
  })
});
var OFFER_KEYS8 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS7 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf7(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function nonEmptyString6(value2) {
  return typeof value2 === "string" && value2.trim().length > 0;
}
function stringList7(value2) {
  if (!Array.isArray(value2) || value2.length === 0 || !value2.every(nonEmptyString6)) return void 0;
  const strings = value2;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer7(value2) {
  const record = recordOf7(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS8.has(key2))) {
    return void 0;
  }
  const gameIds = stringList7(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest7(value2) {
  const record = recordOf7(value2);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS7.has(key2))) {
    return void 0;
  }
  return nonEmptyString6(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchMapSemanticFacets(context) {
  const offer = parseOffer7(context.offerFacet);
  const request = parseRequest7(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/map-semantic-facet-invalid",
          `${context.contract}@${context.major}: semantic map routes must be well formed`
        )
      ]
    };
  }
  return offer.gameIds.includes(request.gameId) ? { state: "match", selectionKey: `game=${request.gameId}` } : { state: "no-match" };
}
var MAP_SEMANTIC_MATCHER = Object.freeze({
  profile: contractId(MAP_SEMANTIC_MATCHER_PROFILE),
  major: 1,
  match: matchMapSemanticFacets
});
var MAP_SEMANTIC_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: MAP_SEMANTIC_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-semantic-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-semantic-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: MAP_SEMANTIC_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.map/semantic-analysis-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "analyzerId", "gameIds"]),
    methods: Object.freeze({
      open: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 33554432, maxStringLength: 4194304 })
      })
    })
  })
});
var ABI_CODEC_MODULE = { contract: "x3.abi/codec-module", major: 1 };
var ABI_SERVICE_PROVIDER_MODULE = {
  contract: "x3.abi/service-provider-module",
  major: 1
};
var ABI_CODEC = { contract: "x3.abi/codec", major: 1 };
var ABI_ASSET_SESSION = { contract: "x3.abi/asset-session", major: 1 };
var ABI_OPERATION_SESSION = { contract: "x3.abi/operation-session", major: 1 };
var ABI_ARTIFACT_SOURCE = { contract: "x3.abi/artifact-source", major: 1 };
var ABI_ASSET_NAMESPACE = { contract: "x3.abi/asset-namespace", major: 1 };
var ABI_ASSET_INPUT = { contract: "x3.abi/asset-input", major: 1 };
var ABI_DIAGNOSTIC_SINK = { contract: "x3.abi/diagnostic-sink", major: 1 };
var ABI_CONTRACT_RESOLVER = { contract: "x3.abi/contract-resolver", major: 1 };
var sig2 = { signal: "last" };
var codecModuleSurface = {
  ...ABI_CODEC_MODULE,
  fields: ["abiVersion"],
  methods: {
    /** `createCodec(context)` — the backend marshals `context` (budgets copied, ports as refs). */
    createCodec: { kind: "lease", result: ABI_CODEC, wrapper: "bare" }
  }
};
var serviceProviderModuleSurface = {
  ...ABI_SERVICE_PROVIDER_MODULE,
  fields: ["abiVersion", "provides"],
  methods: {
    /**
     * `createProvider(selection, context)` — the leased provider's surface is the one the
     * selection names (its contract definition's `surface`); `context` is marshalled like
     * `createCodec`'s. Returns a `Lease`: releasing the handle releases the provider.
     */
    createProvider: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } }
    }
  }
};
var codecSurface = {
  ...ABI_CODEC,
  methods: {
    probe: { kind: "value", ...sig2 },
    planInput: { kind: "value", optional: true, ...sig2 },
    open: { kind: "lease", result: ABI_ASSET_SESSION, wrapper: "bare", ...sig2 }
  }
};
var assetSessionSurface = {
  ...ABI_ASSET_SESSION,
  fields: ["revision"],
  releaseVia: "dispose",
  methods: {
    state: { kind: "value" },
    descriptor: { kind: "value" },
    /** `dataSource(contract, major)` — the leased surface is named by the arguments. */
    dataSource: {
      kind: "lease",
      resultFromArgs: { contract: 0, major: 1 },
      wrapper: "lease"
    },
    operations: { kind: "lease", result: ABI_OPERATION_SESSION, wrapper: "bare" },
    events: { kind: "events", ...sig2 },
    dispose: { kind: "value" }
  }
};
var operationSessionSurface = {
  ...ABI_OPERATION_SESSION,
  releaseVia: "dispose",
  methods: {
    invoke: {
      kind: "value",
      signal: { arg: 2, key: "signal" },
      progress: { arg: 2, key: "onProgress" }
    },
    dispose: { kind: "value" }
  }
};
var artifactSourceSurface = {
  ...ABI_ARTIFACT_SOURCE,
  fields: ["ref", "revision", "kind", "size"],
  methods: {
    read: { kind: "value", optional: true, ...sig2 },
    stream: { kind: "iterable", optional: true, ...sig2 },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE,
      wrapper: "lease",
      optional: true,
      ...sig2
    }
  }
};
var assetNamespaceSurface = {
  ...ABI_ASSET_NAMESPACE,
  methods: {
    list: { kind: "iterable", ...sig2 },
    open: { kind: "lease", result: ABI_ARTIFACT_SOURCE, wrapper: "lease", ...sig2 }
  }
};
var assetInputSurface = {
  ...ABI_ASSET_INPUT,
  // topology data as fields: physical bindings, the namespace/derived discriminants, the derived
  // subject list and its optional materialized requirement/recipe
  fields: [
    "originKind",
    "root",
    "bindings",
    "revisions",
    "primaryBindingId",
    "subjects",
    "recipe",
    "materialized"
  ],
  methods: {
    openBinding: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE,
      wrapper: "lease",
      optional: true,
      ...sig2
    },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE,
      wrapper: "lease",
      optional: true,
      ...sig2
    },
    // derived inputs: open one input subject as a session, or the optional materialized artifact
    openSubject: {
      kind: "lease",
      result: ABI_ASSET_SESSION,
      wrapper: "lease",
      optional: true,
      ...sig2
    },
    openMaterialized: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE,
      wrapper: "lease",
      optional: true,
      ...sig2
    }
  }
};
var contractResolverSurface = {
  ...ABI_CONTRACT_RESOLVER,
  methods: {
    resolve: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } },
      signal: { arg: 0, key: "signal" }
    },
    resolveUnknown: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } },
      signal: { arg: 0, key: "signal" }
    }
  }
};
var diagnosticSinkSurface = {
  ...ABI_DIAGNOSTIC_SINK,
  methods: {
    report: { kind: "value" }
  }
};
var RUNTIME_ABI_SURFACES = Object.freeze([
  codecModuleSurface,
  serviceProviderModuleSurface,
  codecSurface,
  assetSessionSurface,
  operationSessionSurface,
  artifactSourceSurface,
  assetNamespaceSurface,
  assetInputSurface,
  diagnosticSinkSurface,
  contractResolverSurface
]);
var HandleTable = class {
  constructor(owner, generation, limits) {
    this.owner = owner;
    this.generation = generation;
    this.limits = limits;
  }
  owner;
  generation;
  limits;
  records = /* @__PURE__ */ new Map();
  sequence = 0;
  releasedTotal = 0;
  invalidated = false;
  get isInvalidated() {
    return this.invalidated;
  }
  counts() {
    let leases = 0;
    let iterators = 0;
    let events = 0;
    for (const record of this.records.values()) {
      if (record.kind === "lease") leases += 1;
      else if (record.kind === "iterator") iterators += 1;
      else events += 1;
    }
    return Object.freeze({
      live: this.records.size,
      leases,
      iterators,
      events,
      allocated: this.sequence,
      releasedTotal: this.releasedTotal
    });
  }
  assertLimit(kind) {
    const counts = this.counts();
    const limit = (code, current, max) => {
      if (current >= max) {
        throw new ModkitError({
          code: "x3.host/rpc-limit-exceeded",
          message: `${code} limit ${max} reached for generation ${this.generation}`,
          context: { limit: code, max },
          retryability: "conditional"
        });
      }
    };
    limit("handles", counts.live, this.limits.maxHandles);
    if (kind === "iterator") limit("iterators", counts.iterators, this.limits.maxIterators);
    if (kind === "events") limit("events", counts.events, this.limits.maxSubscriptions);
  }
  allocate(input) {
    if (this.invalidated) {
      throw new ModkitError({
        code: "x3.host/rpc-generation-invalidated",
        message: `generation ${this.generation} is invalidated; no new handles`
      });
    }
    this.assertLimit(input.kind);
    if (input.parent !== void 0) {
      const parent = this.records.get(input.parent);
      if (parent === void 0) {
        throw new ModkitError({
          code: "x3.host/rpc-unknown-handle",
          message: `parent handle ${input.parent} is not live`
        });
      }
    }
    this.sequence += 1;
    const id = `${this.owner}${this.generation}-${this.sequence}`;
    const record = {
      id,
      kind: input.kind,
      ...input.contract === void 0 ? {} : { contract: input.contract },
      ...input.major === void 0 ? {} : { major: input.major },
      target: input.target,
      ...input.parent === void 0 ? {} : { parent: input.parent },
      children: /* @__PURE__ */ new Set(),
      release: input.release,
      released: false
    };
    this.records.set(id, record);
    if (input.parent !== void 0) this.records.get(input.parent)?.children.add(id);
    return record;
  }
  parseId(id) {
    const match = /^([hw])(\d+)-(\d+)$/u.exec(id);
    if (match === null) return void 0;
    return { owner: match[1], generation: Number(match[2]), sequence: Number(match[3]) };
  }
  /** True when the id was allocated by this side (owner prefix), whatever its generation. */
  owns(id) {
    return this.parseId(id)?.owner === this.owner;
  }
  lookup(id) {
    const live = this.records.get(id);
    if (live !== void 0) return { state: "live", record: live };
    const parsed = this.parseId(id);
    if (parsed === void 0 || parsed.owner !== this.owner || parsed.generation !== this.generation) {
      return { state: "foreign-generation" };
    }
    return parsed.sequence >= 1 && parsed.sequence <= this.sequence ? { state: "released" } : { state: "unknown" };
  }
  /**
   * Releases a handle and everything created through it (children first, reverse allocation
   * order). Idempotent: an already released or unknown-but-plausible id reports `false`.
   * Release failures are collected, never swallowed.
   */
  async release(id) {
    const record = this.records.get(id);
    if (record === void 0) return { released: false, failures: [] };
    const failures = [];
    await this.releaseRecord(record, failures);
    return { released: true, failures };
  }
  async releaseRecord(record, failures) {
    if (record.released) return;
    record.released = true;
    const children = [...record.children].reverse();
    for (const childId of children) {
      const child = this.records.get(childId);
      if (child !== void 0) await this.releaseRecord(child, failures);
    }
    this.records.delete(record.id);
    if (record.parent !== void 0) this.records.get(record.parent)?.children.delete(record.id);
    this.releasedTotal += 1;
    try {
      await record.release();
    } catch (error) {
      failures.push(error);
    }
  }
  /** Releases every live handle (reverse allocation order) and refuses future allocations. */
  async invalidate() {
    this.invalidated = true;
    const failures = [];
    const released = [];
    const ids = [...this.records.keys()].reverse();
    for (const id of ids) {
      const record = this.records.get(id);
      if (record === void 0) continue;
      released.push(id);
      await this.releaseRecord(record, failures);
    }
    return { released, failures };
  }
  liveIds() {
    return [...this.records.keys()];
  }
};
var PendingCalls = class {
  constructor(limits) {
    this.limits = limits;
  }
  limits;
  calls = /* @__PURE__ */ new Map();
  lateAfterCancel = 0;
  /** Highest id ever opened; a reply above it never had a call, a reply at or below it did. */
  highestOpened = 0;
  get size() {
    return this.calls.size;
  }
  get droppedLateReplies() {
    return this.lateAfterCancel;
  }
  open(call) {
    if (this.calls.size >= this.limits.maxPendingCalls) {
      throw new ModkitError({
        code: "x3.host/rpc-limit-exceeded",
        message: `pending call limit ${this.limits.maxPendingCalls} reached`,
        context: { limit: "pendingCalls", max: this.limits.maxPendingCalls },
        retryability: "conditional"
      });
    }
    const entry2 = { ...call, cancelled: false, settled: false };
    this.calls.set(call.id, entry2);
    if (call.id > this.highestOpened) this.highestOpened = call.id;
    return entry2;
  }
  peek(id) {
    return this.calls.get(id);
  }
  /** Forgets a call that was never sent (send failure); the caller rejects it locally. */
  drop(id) {
    this.calls.delete(id);
  }
  /** Marks the call cancelled locally; the caller has already been rejected with cancellation. */
  cancel(id) {
    const entry2 = this.calls.get(id);
    if (entry2 === void 0 || entry2.settled) return void 0;
    entry2.cancelled = true;
    return entry2;
  }
  progress(id, progress) {
    const entry2 = this.calls.get(id);
    if (entry2 === void 0) return id <= this.highestOpened ? "duplicate" : "unknown";
    if (entry2.cancelled) return "late-after-cancel";
    entry2.onProgress?.(progress);
    return "settled";
  }
  settle(id, outcome) {
    const entry2 = this.calls.get(id);
    if (entry2 === void 0) return id <= this.highestOpened ? "duplicate" : "unknown";
    this.calls.delete(id);
    if (entry2.cancelled) {
      this.lateAfterCancel += 1;
      return "late-after-cancel";
    }
    if (entry2.settled) return "duplicate";
    entry2.settled = true;
    entry2.resolve(outcome);
    return "settled";
  }
  /** Rejects every non-cancelled pending call (endpoint failure / peer exit). */
  failAll(error) {
    let rejected2 = 0;
    for (const entry2 of [...this.calls.values()]) {
      this.calls.delete(entry2.id);
      if (entry2.cancelled || entry2.settled) continue;
      entry2.settled = true;
      entry2.reject(error);
      rejected2 += 1;
    }
    return rejected2;
  }
};
var ActiveCalls = class {
  calls = /* @__PURE__ */ new Map();
  get size() {
    return this.calls.size;
  }
  begin(id) {
    const entry2 = { id, controller: new AbortController(), cancelled: false };
    this.calls.set(id, entry2);
    return entry2;
  }
  end(id) {
    this.calls.delete(id);
  }
  cancel(id) {
    const entry2 = this.calls.get(id);
    if (entry2 === void 0) return false;
    entry2.cancelled = true;
    entry2.controller.abort(new OperationCancelledError("cancelled by peer"));
    return true;
  }
  cancelAll() {
    for (const entry2 of this.calls.values()) {
      entry2.cancelled = true;
      entry2.controller.abort(new OperationCancelledError("endpoint closed"));
    }
    this.calls.clear();
  }
};
var Subscriptions = class {
  constructor(limits) {
    this.limits = limits;
  }
  limits;
  records = /* @__PURE__ */ new Map();
  /** Live (not yet closed) subscriptions. */
  get size() {
    let live = 0;
    for (const record of this.records.values()) if (!record.closed) live += 1;
    return live;
  }
  register(id, handle) {
    if (this.records.has(id)) {
      throw new ModkitError({
        code: "x3.host/rpc-duplicate-subscription",
        message: `subscription ${id} is already registered`
      });
    }
    if (this.size >= this.limits.maxSubscriptions) {
      throw new ModkitError({
        code: "x3.host/rpc-limit-exceeded",
        message: `subscription limit ${this.limits.maxSubscriptions} reached`,
        context: { limit: "subscriptions", max: this.limits.maxSubscriptions },
        retryability: "conditional"
      });
    }
    const record = {
      id,
      handle,
      queue: [],
      wake: void 0,
      closed: false,
      error: void 0
    };
    this.records.set(id, record);
    return record;
  }
  get(id) {
    return this.records.get(id);
  }
  entries() {
    return [...this.records.entries()];
  }
  /** Enqueues an event; `overflow` when the consumer is too slow (bounded queue). */
  push(id, value2) {
    const record = this.records.get(id);
    if (record === void 0 || record.closed) return "unknown";
    if (record.queue.length >= this.limits.maxQueuedEvents) return "overflow";
    record.queue.push(value2);
    record.wake?.();
    return "queued";
  }
  /** Marks the stream ended (optionally by failure) and wakes the consumer; keeps the queue. */
  close(id, error) {
    const record = this.records.get(id);
    if (record === void 0) return;
    record.closed = true;
    if (error !== void 0) record.error = error;
    record.wake?.();
  }
  /** The consumer is done with the record (drained or abandoned). */
  drop(id) {
    this.records.delete(id);
  }
  closeAll(error) {
    for (const id of [...this.records.keys()]) this.close(id, error);
  }
};
var CAPABILITY_RPC_DOMAIN = "x3.host/rpc";
var CAPABILITY_RPC_VERSION = 1;
var HANDLE_MARKER = "@x3.handle";
var HANDLE_ID = /^[hw](?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/u;
var SUBSCRIPTION_ID = /^[hw]s(?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/u;
var METHOD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/u;
var FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var FRAME_TYPES = [
  "load",
  "ready",
  "call",
  "return",
  "throw",
  "cancel",
  "next",
  "done",
  "subscribe",
  "event",
  "unsubscribe",
  "progress",
  "release",
  "terminate"
];
var HANDLE_KINDS = ["lease", "iterator", "events"];
function isHandleId(value2) {
  return HANDLE_ID.test(value2);
}
function isSubscriptionId(value2) {
  return SUBSCRIPTION_ID.test(value2);
}
function isMethodName(value2) {
  return METHOD_NAME.test(value2);
}
var WIRE_TYPED_ARRAYS = Object.freeze({
  bytes: Uint8Array,
  i8: Int8Array,
  u8c: Uint8ClampedArray,
  i16: Int16Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  i64: BigInt64Array,
  u64: BigUint64Array
});
function wireTypedArrayCode(view) {
  for (const [code, constructor] of Object.entries(WIRE_TYPED_ARRAYS)) {
    if (view.constructor === constructor) return code;
  }
  return void 0;
}
var MAX_OPTIONAL_METHODS = 64;
function handleRef(id, kind, contract, data, has) {
  return Object.freeze({
    [HANDLE_MARKER]: Object.freeze({
      id,
      kind,
      ...contract === void 0 ? {} : { contract: contract.contract, major: contract.major },
      ...data === void 0 ? {} : { data },
      ...has === void 0 ? {} : { has: Object.freeze([...has]) }
    })
  });
}
function isPresentList(value2) {
  return Array.isArray(value2) && value2.length <= MAX_OPTIONAL_METHODS && value2.every((item) => typeof item === "string" && isMethodName(item)) && new Set(value2).size === value2.length;
}
function isHandleRef(value2) {
  if (!isPlainObject(value2)) return false;
  const keys = Object.keys(value2);
  if (keys.length !== 1 || keys[0] !== HANDLE_MARKER) return false;
  const inner = value2[HANDLE_MARKER];
  if (!isPlainObject(inner)) return false;
  const record = inner;
  const innerKeys = Object.keys(inner).filter((key2) => key2 !== "data" && key2 !== "has").sort();
  const base = ["id", "kind"];
  const withContract = ["contract", "id", "kind", "major"];
  const shape = innerKeys.join(",") === base.join(",") || innerKeys.join(",") === withContract.join(",");
  if (!shape) return false;
  if (record["data"] !== void 0 && !isPlainObject(record["data"])) return false;
  if (record["has"] !== void 0 && !isPresentList(record["has"])) return false;
  if (typeof record["id"] !== "string" || !isHandleId(record["id"])) return false;
  if (typeof record["kind"] !== "string" || !HANDLE_KINDS.includes(record["kind"]))
    return false;
  if (innerKeys.length === 4) {
    if (typeof record["contract"] !== "string" || !isQualifiedId(record["contract"])) return false;
    if (!Number.isSafeInteger(record["major"]) || record["major"] < 0) return false;
  }
  return true;
}
function isPlainObject(value2) {
  if (typeof value2 !== "object" || value2 === null || Array.isArray(value2)) return false;
  const proto = Object.getPrototypeOf(value2);
  return proto === Object.prototype || proto === null;
}
var DEFAULT_PROTOCOL_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 2e5,
  maxStringLength: 4 * 1024 * 1024,
  maxArrayLength: 1e5,
  maxObjectKeys: 1e4,
  maxTransferBytes: 64 * 1024 * 1024,
  maxArgs: 16,
  maxPendingCalls: 256,
  maxHandles: 4096,
  maxIterators: 256,
  maxSubscriptions: 64,
  maxQueuedEvents: 1024,
  defaultCallDeadlineMs: 3e4,
  iteratorBatchItems: 1
});
function protocolLimits(overrides = {}) {
  const merged = { ...DEFAULT_PROTOCOL_LIMITS, ...overrides };
  for (const [key2, value2] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value2) || value2 < 0) {
      throw new ModkitError({
        code: "x3.host/rpc-invalid-limits",
        message: `protocol limit ${key2} must be a non-negative safe integer`,
        context: { key: key2 }
      });
    }
  }
  if (merged.iteratorBatchItems < 1 || merged.iteratorBatchItems > merged.maxArrayLength) {
    throw new ModkitError({
      code: "x3.host/rpc-invalid-limits",
      message: "protocol limit iteratorBatchItems must be between 1 and maxArrayLength",
      context: { key: "iteratorBatchItems" }
    });
  }
  return Object.freeze(merged);
}
function violation(code, message, path) {
  return {
    ok: false,
    violation: Object.freeze({ code, message, ...path === void 0 ? {} : { path } })
  };
}
function protocolViolationError(item) {
  return new ModkitError({
    code: "x3.host/rpc-protocol-violation",
    message: `capability-rpc protocol violation: ${item.message}`,
    context: {
      violation: item.code,
      ...item.path === void 0 ? {} : { path: [...item.path] }
    }
  });
}
var SHARED = typeof SharedArrayBuffer === "function" ? SharedArrayBuffer : void 0;
function validateInner(value2, limits, measure, depth, path, handles) {
  measure.nodes += 1;
  if (measure.nodes > limits.maxNodes) {
    return { code: "nodes-exceeded", message: `value has more than ${limits.maxNodes} nodes` };
  }
  if (depth > limits.maxDepth) {
    return { code: "depth-exceeded", message: `value nests deeper than ${limits.maxDepth}`, path };
  }
  switch (typeof value2) {
    case "boolean":
    case "bigint":
      return void 0;
    case "undefined":
      return depth === 0 ? { code: "bad-value", message: "undefined is not a wire value", path } : void 0;
    case "number":
      return Number.isFinite(value2) ? void 0 : { code: "bad-value", message: "non-finite number", path };
    case "string":
      return value2.length <= limits.maxStringLength ? void 0 : { code: "string-too-long", message: `string longer than ${limits.maxStringLength}`, path };
    case "object":
      break;
    default:
      return { code: "bad-value", message: `${typeof value2} is not a wire value`, path };
  }
  if (value2 === null) return void 0;
  if (ArrayBuffer.isView(value2) && !(value2 instanceof DataView)) {
    const kind = value2.constructor.name;
    if (wireTypedArrayCode(value2) === void 0) {
      return { code: "bad-value", message: `${kind} is not a wire value`, path };
    }
    if (SHARED !== void 0 && value2.buffer instanceof SHARED) {
      return {
        code: "shared-buffer",
        message: "SharedArrayBuffer-backed bytes are not transferable",
        path
      };
    }
    if (value2.buffer.detached === true) {
      return {
        code: "bad-value",
        message: `a ${kind} over a detached buffer cannot cross (it was transferred already)`,
        path
      };
    }
    if (value2.byteOffset !== 0 || value2.byteLength !== value2.buffer.byteLength) {
      return {
        code: "partial-typed-array",
        message: `a ${kind} must own its whole buffer (slice() before sending)`,
        path
      };
    }
    measure.bytes += value2.byteLength;
    if (measure.bytes > limits.maxTransferBytes) {
      return {
        code: "transfer-too-large",
        message: `frame carries more than ${limits.maxTransferBytes} bytes`,
        path
      };
    }
    measure.buffers.push(value2.buffer);
    return void 0;
  }
  if (value2 instanceof DataView || value2 instanceof ArrayBuffer) {
    return {
      code: "bad-value",
      message: "binary payloads must be a typed array that names its element type",
      path
    };
  }
  if (Array.isArray(value2)) {
    if (value2.length > limits.maxArrayLength) {
      return { code: "array-too-long", message: `array longer than ${limits.maxArrayLength}`, path };
    }
    for (let index = 0; index < value2.length; index += 1) {
      const found = validateInner(
        value2[index],
        limits,
        measure,
        depth + 1,
        [...path, index],
        handles
      );
      if (found !== void 0) return found;
    }
    return void 0;
  }
  if (!isPlainObject(value2)) {
    return { code: "bad-value", message: "only plain data objects may cross the boundary", path };
  }
  if (Object.hasOwn(value2, HANDLE_MARKER)) {
    if (handles === "forbid") {
      return {
        code: "handle-not-allowed",
        message: "a handle ref is not allowed at this position",
        path
      };
    }
    if (!isHandleRef(value2)) return { code: "bad-handle", message: "malformed handle ref", path };
    const data = value2[HANDLE_MARKER].data;
    return data === void 0 ? void 0 : validateInner(data, limits, measure, depth + 1, [...path, HANDLE_MARKER, "data"], "forbid");
  }
  const keys = Object.keys(value2);
  if (keys.length > limits.maxObjectKeys) {
    return {
      code: "too-many-keys",
      message: `object has more than ${limits.maxObjectKeys} keys`,
      path
    };
  }
  for (const key2 of keys) {
    if (FORBIDDEN_KEYS.has(key2)) {
      return { code: "forbidden-key", message: `key \xAB${key2}\xBB is forbidden`, path: [...path, key2] };
    }
    if (key2.length > limits.maxStringLength) {
      return { code: "string-too-long", message: "object key too long", path: [...path, key2] };
    }
    const found = validateInner(value2[key2], limits, measure, depth + 1, [...path, key2], handles);
    if (found !== void 0) return found;
  }
  return void 0;
}
function validateWireValue(value2, limits, handles = "forbid", path = []) {
  const measure = { nodes: 0, bytes: 0, buffers: [] };
  if (handles === "top" && isHandleRef(value2)) {
    const data = value2[HANDLE_MARKER].data;
    const found2 = data === void 0 ? void 0 : validateInner(data, limits, measure, 1, [...path, HANDLE_MARKER, "data"], "forbid");
    if (found2 !== void 0) return { ok: false, violation: Object.freeze(found2) };
    return {
      ok: true,
      value: Object.freeze({
        nodes: measure.nodes + 1,
        transferBytes: measure.bytes,
        transferables: Object.freeze(measure.buffers)
      })
    };
  }
  const found = validateInner(
    value2,
    limits,
    measure,
    0,
    [...path],
    handles === "nested" ? "allow" : "forbid"
  );
  if (found !== void 0) return { ok: false, violation: Object.freeze(found) };
  return {
    ok: true,
    value: Object.freeze({
      nodes: measure.nodes,
      transferBytes: measure.bytes,
      transferables: Object.freeze(measure.buffers)
    })
  };
}
var RETRYABILITIES = ["never", "safe", "conditional"];
var MAX_ERROR_MESSAGE = 8 * 1024;
function toErrorDto(error, limits) {
  const clip = (text) => text.length > MAX_ERROR_MESSAGE ? `${text.slice(0, MAX_ERROR_MESSAGE)}\u2026` : text;
  if (error instanceof OperationCancelledError) {
    return Object.freeze({
      code: error.code,
      message: clip(error.message),
      retryability: error.retryability,
      cancelled: true
    });
  }
  if (isModkitError(error)) {
    let context;
    let dropped = false;
    if (error.context !== void 0) {
      const checked = validateWireValue(error.context, limits, "forbid");
      if (checked.ok && isPlainObject(error.context)) {
        context = error.context;
      } else {
        dropped = true;
      }
    }
    return Object.freeze({
      code: error.code,
      message: clip(error.message),
      retryability: error.retryability,
      ...context === void 0 ? {} : { context },
      ...dropped ? { contextDropped: true } : {}
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    code: "x3.host/rpc-foreign-error",
    message: clip(message.length === 0 ? "unknown error" : message),
    retryability: "never"
  });
}
function fromErrorDto(dto) {
  if (dto.cancelled === true) return new OperationCancelledError(dto.message);
  return new ModkitError({
    code: dto.code,
    message: dto.message,
    retryability: dto.retryability,
    ...dto.context === void 0 ? {} : { context: dto.context }
  });
}
function validateErrorDto(value2, limits, path = []) {
  if (!isPlainObject(value2)) return violation("bad-error", "error must be an object", path);
  const record = value2;
  const keys = Object.keys(record);
  const allowed = /* @__PURE__ */ new Set([
    "code",
    "message",
    "retryability",
    "context",
    "cancelled",
    "contextDropped"
  ]);
  for (const key2 of keys) {
    if (!allowed.has(key2))
      return violation("bad-error", `unknown error key \xAB${key2}\xBB`, [...path, key2]);
  }
  const code = record["code"];
  if (typeof code !== "string" || !isQualifiedId(code)) {
    return violation("bad-error", "error code must be a qualified id", [...path, "code"]);
  }
  const message = record["message"];
  if (typeof message !== "string" || message.length > MAX_ERROR_MESSAGE + 1) {
    return violation("bad-error", "error message must be a bounded string", [...path, "message"]);
  }
  const retryability = record["retryability"];
  if (typeof retryability !== "string" || !RETRYABILITIES.includes(retryability)) {
    return violation("bad-error", "error retryability is invalid", [...path, "retryability"]);
  }
  for (const flag of ["cancelled", "contextDropped"]) {
    if (record[flag] !== void 0 && record[flag] !== true) {
      return violation("bad-error", `error ${flag} must be true or absent`, [...path, flag]);
    }
  }
  if (record["context"] !== void 0) {
    if (!isPlainObject(record["context"])) {
      return violation("bad-error", "error context must be an object", [...path, "context"]);
    }
    const checked = validateWireValue(record["context"], limits, "forbid", [...path, "context"]);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: Object.freeze({ ...record }) };
}
var ENVELOPE_KEYS = ["domain", "version", "session", "generation", "id", "t"];
var FRAME_KEYS = {
  load: {
    required: ["moduleUrl", "contributionId", "variantId", "artifactDigest"],
    optional: ["entrypointDigest"]
  },
  ready: { required: ["inReplyTo", "abiVersion", "exports", "root"], optional: [] },
  call: { required: ["handle", "method", "args"], optional: ["deadlineMs"] },
  return: { required: ["inReplyTo"], optional: ["value", "lease"] },
  throw: { required: ["inReplyTo", "error"], optional: [] },
  cancel: { required: ["target"], optional: [] },
  next: { required: ["handle"], optional: ["max"] },
  done: { required: ["handle"], optional: ["inReplyTo", "error"] },
  subscribe: { required: ["handle"], optional: [] },
  event: { required: ["subscription", "value"], optional: [] },
  unsubscribe: { required: ["subscription"], optional: [] },
  progress: { required: ["inReplyTo", "progress"], optional: [] },
  release: { required: ["handle"], optional: [] },
  terminate: { required: ["reason"], optional: [] }
};
function isMessageId(value2) {
  return Number.isSafeInteger(value2) && value2 >= 1;
}
function checkExactKeys(record, required2, optional) {
  for (const key2 of required2) {
    if (!Object.hasOwn(record, key2))
      return { code: "missing-key", message: `missing key \xAB${key2}\xBB`, path: [key2] };
  }
  const allowed = /* @__PURE__ */ new Set([...ENVELOPE_KEYS, ...required2, ...optional]);
  for (const key2 of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key2))
      return { code: "forbidden-key", message: `key \xAB${key2}\xBB is forbidden`, path: [key2] };
    if (!allowed.has(key2))
      return { code: "unknown-key", message: `unknown key \xAB${key2}\xBB`, path: [key2] };
  }
  return void 0;
}
function validateFrame(input, limits, expect) {
  if (!isPlainObject(input)) return violation("not-an-object", "frame must be a plain object");
  const record = input;
  if (record["domain"] !== CAPABILITY_RPC_DOMAIN || record["version"] !== CAPABILITY_RPC_VERSION) {
    return violation("bad-envelope", "frame domain/version mismatch");
  }
  if (record["session"] !== expect.session)
    return violation("bad-envelope", "frame session mismatch", ["session"]);
  if (record["generation"] !== expect.generation) {
    return violation("stale-generation", "frame generation does not match the live generation", [
      "generation"
    ]);
  }
  if (!isMessageId(record["id"]))
    return violation("bad-id", "frame id must be a positive safe integer", ["id"]);
  const type = record["t"];
  if (typeof type !== "string" || !FRAME_TYPES.includes(type)) {
    return violation("bad-type", "unknown frame type", ["t"]);
  }
  const t3 = type;
  const keys = FRAME_KEYS[t3];
  const keyViolation = checkExactKeys(record, keys.required, keys.optional);
  if (keyViolation !== void 0) return { ok: false, violation: keyViolation };
  const str = (key2, test, code = "bad-value") => typeof record[key2] === "string" && record[key2].length > 0 && (test?.(record[key2]) ?? true) ? void 0 : violation(code, `\xAB${key2}\xBB is malformed`, [key2]);
  const replyId = (key2) => isMessageId(record[key2]) ? void 0 : violation("bad-id", `\xAB${key2}\xBB must be a positive safe integer`, [key2]);
  switch (t3) {
    case "load": {
      for (const key2 of ["moduleUrl", "artifactDigest"]) {
        const bad2 = str(key2, (value2) => value2.length <= limits.maxStringLength);
        if (bad2) return bad2;
      }
      if (record["entrypointDigest"] !== void 0) {
        const bad2 = str("entrypointDigest", (value2) => value2.length <= 256);
        if (bad2) return bad2;
      }
      const bad = str("contributionId", isQualifiedId) ?? str("variantId", isSegment);
      if (bad) return bad;
      break;
    }
    case "ready": {
      const bad = replyId("inReplyTo");
      if (bad) return bad;
      if (record["abiVersion"] !== 1)
        return violation("bad-value", "abiVersion must be 1", ["abiVersion"]);
      const exports = record["exports"];
      if (!Array.isArray(exports) || exports.length > limits.maxArrayLength || !exports.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256)) {
        return violation("bad-value", "exports must be an array of short strings", ["exports"]);
      }
      if (!isHandleRef(record["root"]))
        return violation("bad-handle", "root must be a handle ref", ["root"]);
      {
        const checked = validateWireValue(record["root"], limits, "top", ["root"]);
        if (!checked.ok) return checked;
      }
      break;
    }
    case "call": {
      const bad = str("handle", isHandleId, "bad-handle") ?? str("method", isMethodName, "bad-method");
      if (bad) return bad;
      const args = record["args"];
      if (!Array.isArray(args)) return violation("bad-value", "args must be an array", ["args"]);
      if (args.length > limits.maxArgs)
        return violation("too-many-args", `more than ${limits.maxArgs} args`, ["args"]);
      const checked = validateWireValue(args, limits, "nested", ["args"]);
      if (!checked.ok) return checked;
      if (record["deadlineMs"] !== void 0 && (!Number.isSafeInteger(record["deadlineMs"]) || record["deadlineMs"] < 0)) {
        return violation("bad-value", "deadlineMs must be a non-negative safe integer", [
          "deadlineMs"
        ]);
      }
      break;
    }
    case "return": {
      const bad = replyId("inReplyTo");
      if (bad) return bad;
      if (record["value"] !== void 0) {
        const checked = validateWireValue(record["value"], limits, "top", ["value"]);
        if (!checked.ok) return checked;
      }
      if (record["lease"] !== void 0) {
        const lease = record["lease"];
        if (!isHandleRef(lease) || lease[HANDLE_MARKER].kind !== "lease") {
          return violation("bad-handle", "lease must be a lease handle ref", ["lease"]);
        }
        if (record["value"] !== void 0 && isHandleRef(record["value"])) {
          return violation("bad-value", "a leased value cannot itself be a handle", ["value"]);
        }
        const checked = validateWireValue(lease, limits, "top", ["lease"]);
        if (!checked.ok) return checked;
      }
      break;
    }
    case "throw": {
      const bad = replyId("inReplyTo");
      if (bad) return bad;
      const checked = validateErrorDto(record["error"], limits, ["error"]);
      if (!checked.ok) return checked;
      break;
    }
    case "cancel":
      {
        const bad = replyId("target");
        if (bad) return bad;
      }
      break;
    case "next": {
      const bad = str("handle", isHandleId, "bad-handle");
      if (bad) return bad;
      const max = record["max"];
      if (max !== void 0 && (!Number.isSafeInteger(max) || max < 1 || max > limits.maxArrayLength)) {
        return violation(
          "bad-value",
          `next.max must be an integer in 1..${limits.maxArrayLength}`,
          ["max"]
        );
      }
      break;
    }
    case "subscribe":
    case "release": {
      const bad = str("handle", isHandleId, "bad-handle");
      if (bad) return bad;
      break;
    }
    case "done": {
      const bad = str("handle", isHandleId, "bad-handle");
      if (bad) return bad;
      if (record["inReplyTo"] !== void 0) {
        const badReply = replyId("inReplyTo");
        if (badReply) return badReply;
      }
      if (record["error"] !== void 0) {
        const checked = validateErrorDto(record["error"], limits, ["error"]);
        if (!checked.ok) return checked;
      }
      break;
    }
    case "event": {
      const bad = str("subscription", isSubscriptionId, "bad-subscription");
      if (bad) return bad;
      const checked = validateWireValue(record["value"], limits, "forbid", ["value"]);
      if (!checked.ok) return checked;
      break;
    }
    case "unsubscribe": {
      const bad = str("subscription", isSubscriptionId, "bad-subscription");
      if (bad) return bad;
      break;
    }
    case "progress": {
      const bad = replyId("inReplyTo");
      if (bad) return bad;
      const progress = record["progress"];
      if (!isPlainObject(progress))
        return violation("bad-progress", "progress must be an object", ["progress"]);
      const progressKeys = Object.keys(progress);
      if (progressKeys.some((key2) => !["completed", "total", "message"].includes(key2))) {
        return violation("bad-progress", "progress has unknown keys", ["progress"]);
      }
      if (typeof progress["completed"] !== "number" || !Number.isFinite(progress["completed"]) || progress["completed"] < 0) {
        return violation("bad-progress", "progress.completed must be a non-negative number", [
          "progress",
          "completed"
        ]);
      }
      if (progress["total"] !== void 0 && (typeof progress["total"] !== "number" || !Number.isFinite(progress["total"]) || progress["total"] < 0)) {
        return violation("bad-progress", "progress.total must be a non-negative number", [
          "progress",
          "total"
        ]);
      }
      if (progress["message"] !== void 0 && (typeof progress["message"] !== "string" || progress["message"].length > 1024)) {
        return violation("bad-progress", "progress.message must be a short string", [
          "progress",
          "message"
        ]);
      }
      break;
    }
    case "terminate": {
      const bad = str("reason", (value2) => value2.length <= 1024);
      if (bad) return bad;
      break;
    }
  }
  return { ok: true, value: record };
}
function surfaceKey(contract, major) {
  return `${contract}@${major}`;
}
function isKeyRef(value2) {
  return typeof value2 === "object" && value2 !== null && Number.isSafeInteger(value2.arg) && value2.arg >= 0 && typeof value2.key === "string" && isMethodName(value2.key);
}
function isArgRef(value2) {
  return typeof value2 === "number" && Number.isSafeInteger(value2) && value2 >= 0 || isKeyRef(value2);
}
var argRefKey = (ref) => typeof ref === "number" ? `${ref}` : `${ref.arg}.${ref.key}`;
var freezeArgRef = (ref) => typeof ref === "number" ? ref : Object.freeze({ ...ref });
function readArgRef(args, ref) {
  if (typeof ref === "number") return args[ref];
  const holder = args[ref.arg];
  return typeof holder === "object" && holder !== null ? holder[ref.key] : void 0;
}
function invalidSurface(message, context) {
  throw new ModkitError({
    code: "x3.host/rpc-invalid-surface",
    message,
    ...context === void 0 ? {} : { context }
  });
}
function snapshotMethod(name, raw, surface) {
  if (raw === void 0 || typeof raw !== "object") {
    return invalidSurface(`method \xAB${name}\xBB has no declaration`, { surface });
  }
  const kind = raw.kind;
  const result = raw.result;
  const resultFromArgs = raw.resultFromArgs;
  const wrapper = raw.wrapper;
  const signal = raw.signal;
  const progress = raw.progress;
  const arity = raw.arity;
  const optional = raw.optional;
  const validateArgs = raw.validateArgs;
  const validateReturn = raw.validateReturn;
  if (kind !== "value" && kind !== "lease" && kind !== "leased-value" && kind !== "iterable" && kind !== "events") {
    return invalidSurface(`method \xAB${name}\xBB has an invalid kind`, { surface });
  }
  if (arity !== void 0 && (!Number.isSafeInteger(arity) || arity < 0 || arity > 16)) {
    return invalidSurface(`method \xAB${name}\xBB has an invalid arity`, { surface });
  }
  if (optional !== void 0 && typeof optional !== "boolean") {
    return invalidSurface(`method \xAB${name}\xBB has a non-boolean optional flag`, { surface });
  }
  if (resultFromArgs !== void 0 && (typeof resultFromArgs !== "object" || resultFromArgs === null || !isArgRef(resultFromArgs.contract) || !isArgRef(resultFromArgs.major) || argRefKey(resultFromArgs.contract) === argRefKey(resultFromArgs.major))) {
    return invalidSurface(`method \xAB${name}\xBB has invalid resultFromArgs positions`, { surface });
  }
  if (wrapper !== void 0 && wrapper !== "lease" && wrapper !== "bare") {
    return invalidSurface(`method \xAB${name}\xBB has an invalid wrapper`, { surface });
  }
  if (wrapper !== void 0 && kind !== "lease") {
    return invalidSurface(`only lease method \xAB${name}\xBB may declare a wrapper`, { surface });
  }
  if (signal !== void 0 && signal !== "last" && signal !== "none" && !isKeyRef(signal)) {
    return invalidSurface(`method \xAB${name}\xBB has an invalid signal placement`, { surface });
  }
  if (progress !== void 0 && !isKeyRef(progress)) {
    return invalidSurface(`method \xAB${name}\xBB has an invalid progress placement`, { surface });
  }
  if (isKeyRef(signal) && progress !== void 0 && signal.arg === progress.arg && signal.key === progress.key) {
    return invalidSurface(`method \xAB${name}\xBB places signal and progress on the same key`, {
      surface
    });
  }
  if (validateArgs !== void 0 && typeof validateArgs !== "function") {
    return invalidSurface(`method \xAB${name}\xBB has a non-function argument validator`, { surface });
  }
  if (validateReturn !== void 0 && typeof validateReturn !== "function") {
    return invalidSurface(`method \xAB${name}\xBB has a non-function return validator`, { surface });
  }
  if (kind === "lease") {
    if (result === void 0 === (resultFromArgs === void 0)) {
      return invalidSurface(
        `lease method \xAB${name}\xBB must name the surface of its result (result or resultFromArgs)`,
        { surface }
      );
    }
    if (result !== void 0 && (!isQualifiedId(result.contract) || !Number.isSafeInteger(result.major) || result.major < 0)) {
      return invalidSurface(`lease method \xAB${name}\xBB must name the surface of its result`, {
        surface
      });
    }
  } else if (result !== void 0 || resultFromArgs !== void 0) {
    return invalidSurface(`${kind} method \xAB${name}\xBB must not declare a result surface`, {
      surface
    });
  }
  return Object.freeze({
    kind,
    ...result === void 0 ? {} : { result: Object.freeze({ contract: result.contract, major: result.major }) },
    ...resultFromArgs === void 0 ? {} : {
      resultFromArgs: Object.freeze({
        contract: freezeArgRef(resultFromArgs.contract),
        major: freezeArgRef(resultFromArgs.major)
      })
    },
    ...wrapper === void 0 ? {} : { wrapper },
    ...signal === void 0 ? {} : { signal: typeof signal === "string" ? signal : Object.freeze({ ...signal }) },
    ...progress === void 0 ? {} : { progress: Object.freeze({ ...progress }) },
    ...arity === void 0 ? {} : { arity },
    ...optional === void 0 ? {} : { optional },
    ...validateArgs === void 0 ? {} : { validateArgs },
    ...validateReturn === void 0 ? {} : { validateReturn }
  });
}
function assertSurface(surface) {
  if (!isQualifiedId(surface.contract) || !Number.isSafeInteger(surface.major) || surface.major < 0) {
    return invalidSurface(
      `surface contract must be a qualified id with a non-negative major: ${surface.contract}@${String(surface.major)}`
    );
  }
  const names = Object.keys(surface.methods);
  if (surface.releaseVia !== void 0 && surface.methods[surface.releaseVia]?.kind !== "value") {
    return invalidSurface(`releaseVia \xAB${surface.releaseVia}\xBB must name a declared value method`, {
      surface: surfaceKey(surface.contract, surface.major)
    });
  }
  if (names.length === 0) {
    return invalidSurface(
      `surface ${surfaceKey(surface.contract, surface.major)} declares no methods`
    );
  }
  for (const name of names) {
    const method = surface.methods[name];
    if (!isMethodName(name) || method === void 0) {
      return invalidSurface(`method name \xAB${name}\xBB is not lowerCamel or has no declaration`, {
        surface: surfaceKey(surface.contract, surface.major)
      });
    }
  }
  if (surface.fields !== void 0) {
    if (!Array.isArray(surface.fields) || surface.fields.length > 64) {
      return invalidSurface("fields must be an array of at most 64 names", {
        surface: surfaceKey(surface.contract, surface.major)
      });
    }
    const seen = /* @__PURE__ */ new Set();
    for (const field2 of surface.fields) {
      if (typeof field2 !== "string" || !isMethodName(field2) || seen.has(field2)) {
        return invalidSurface(`field name \xAB${String(field2)}\xBB is not lowerCamel or repeats`, {
          surface: surfaceKey(surface.contract, surface.major)
        });
      }
      if (Object.hasOwn(surface.methods, field2)) {
        return invalidSurface(`\xAB${field2}\xBB cannot be both a field and a method`, {
          surface: surfaceKey(surface.contract, surface.major)
        });
      }
      seen.add(field2);
    }
  }
}
function createSurfaceRegistry(surfaces) {
  const byKey = /* @__PURE__ */ new Map();
  for (const surface of surfaces) {
    assertSurface(surface);
    const key2 = surfaceKey(surface.contract, surface.major);
    if (byKey.has(key2)) {
      throw new ModkitError({
        code: "x3.host/rpc-duplicate-surface",
        message: `surface ${key2} is registered twice`
      });
    }
    const methods = {};
    for (const [name, method] of Object.entries(surface.methods)) {
      methods[name] = snapshotMethod(name, method, key2);
    }
    const snapshot2 = Object.freeze({
      contract: surface.contract,
      major: surface.major,
      methods: Object.freeze(methods),
      ...surface.releaseVia === void 0 ? {} : { releaseVia: surface.releaseVia },
      ...surface.fields === void 0 ? {} : { fields: Object.freeze([...surface.fields]) }
    });
    byKey.set(key2, snapshot2);
  }
  for (const surface of byKey.values()) {
    for (const [name, method] of Object.entries(surface.methods)) {
      if (method.kind === "lease" && method.result !== void 0 && !byKey.has(surfaceKey(method.result.contract, method.result.major))) {
        throw new ModkitError({
          code: "x3.host/rpc-unknown-result-surface",
          message: `lease method \xAB${name}\xBB of ${surfaceKey(surface.contract, surface.major)} names unregistered surface ${surfaceKey(method.result.contract, method.result.major)}`
        });
      }
    }
  }
  return Object.freeze({
    surfaceFor(contract, major) {
      return byKey.get(surfaceKey(contract, major));
    }
  });
}
var CAPABILITY_OF = /* @__PURE__ */ Symbol.for("x3.host/rpc/proxied-remote");
var RemoteCapabilityImpl = class {
  constructor(endpoint, ref, contract, major, data = Object.freeze({})) {
    this.endpoint = endpoint;
    this.ref = ref;
    this.contract = contract;
    this.major = major;
    this.data = data;
  }
  endpoint;
  ref;
  contract;
  major;
  data;
  get id() {
    return this.ref[HANDLE_MARKER].id;
  }
  get has() {
    return this.ref[HANDLE_MARKER].has;
  }
  get isReleased() {
    return this.endpoint.remoteReleased(this.id);
  }
  call(method, args = [], options = {}) {
    return this.endpoint.callRemote(this, method, args, options);
  }
  release() {
    return this.endpoint.releaseRemote(this.id);
  }
};
var LocalCapabilityImpl = class {
  constructor(endpoint, ref, contract, major) {
    this.endpoint = endpoint;
    this.ref = ref;
    this.contract = contract;
    this.major = major;
  }
  endpoint;
  ref;
  contract;
  major;
  get isReleased() {
    return this.endpoint.localReleased(this.ref[HANDLE_MARKER].id);
  }
  async release() {
    await this.endpoint.releaseLocal(this.ref[HANDLE_MARKER].id);
  }
};
var noopRelease = () => void 0;
function normalizeProgress(value2) {
  if (typeof value2 !== "object" || value2 === null) return void 0;
  const record = value2;
  const completed = record["completed"];
  if (typeof completed !== "number" || !Number.isFinite(completed) || completed < 0)
    return void 0;
  const total = record["total"];
  const message = record["message"];
  return {
    completed,
    ...typeof total === "number" && Number.isFinite(total) && total >= 0 ? { total } : {},
    ...typeof message === "string" ? { message: message.slice(0, 1024) } : {}
  };
}
function lazyStream(start) {
  return {
    [Symbol.asyncIterator]() {
      let iterator;
      const open = async () => {
        if (iterator === void 0) {
          const stream = await start();
          iterator = stream[Symbol.asyncIterator]();
        }
        return iterator;
      };
      return {
        async next(...args) {
          return (await open()).next(...args);
        },
        async return(value2) {
          if (iterator === void 0) return { done: true, value: value2 };
          return await iterator.return?.(value2) ?? { done: true, value: value2 };
        },
        async throw(error) {
          if (iterator === void 0) throw error;
          const thrown = await iterator.throw?.(error);
          if (thrown === void 0) throw error;
          return thrown;
        }
      };
    }
  };
}
function isAbortSignal(value2) {
  return typeof AbortSignal !== "undefined" && value2 instanceof AbortSignal;
}
function isAsyncIterable(value2) {
  return typeof value2 === "object" && value2 !== null && typeof value2[Symbol.asyncIterator] === "function";
}
function isLeaseLike(value2) {
  return typeof value2 === "object" && value2 !== null && "value" in value2 && typeof value2.release === "function";
}
var EndpointImpl = class {
  role;
  session;
  generation;
  limits;
  state = "open";
  port;
  surfaces;
  loader;
  scheduler;
  onFailure;
  onDiagnostic;
  onTerminate;
  unsubscribePort;
  ownerPrefix;
  table;
  pending;
  active = new ActiveCalls();
  subscriptions;
  remote = /* @__PURE__ */ new Map();
  remoteProxies = /* @__PURE__ */ new Map();
  pumps = /* @__PURE__ */ new Map();
  pumpSequence = 0;
  outboundId = 0;
  lastInboundId = 0;
  droppedEvents = 0;
  violations = 0;
  inboundCount = 0;
  constructor(options) {
    this.role = options.role;
    this.session = options.session;
    this.generation = options.generation;
    this.limits = options.limits ?? DEFAULT_PROTOCOL_LIMITS;
    this.port = options.port;
    this.surfaces = options.surfaces;
    this.loader = options.loader;
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle)
    };
    this.onFailure = options.onFailure;
    this.onDiagnostic = options.onDiagnostic;
    this.onTerminate = options.onTerminate;
    this.ownerPrefix = options.role === "host" ? "h" : "w";
    this.table = new HandleTable(this.ownerPrefix, options.generation, this.limits);
    this.pending = new PendingCalls(this.limits);
    this.subscriptions = new Subscriptions(this.limits);
    this.unsubscribePort = options.port.onFrame((raw) => this.receive(raw));
  }
  // ------------------------------------------------------------------ public surface
  counters() {
    return Object.freeze({
      state: this.state,
      outbound: this.outboundId,
      inbound: this.inboundCount,
      pendingCalls: this.pending.size,
      activeCalls: this.active.size,
      localHandles: this.table.counts().live,
      remoteHandles: [...this.remote.values()].filter((item) => !item.released).length,
      subscriptions: this.subscriptions.size,
      droppedLateReplies: this.pending.droppedLateReplies,
      droppedEvents: this.droppedEvents,
      violations: this.violations
    });
  }
  expose(target, surface, release = noopRelease) {
    this.assertOpen();
    if (this.surfaces.surfaceFor(surface.contract, surface.major) === void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-unknown-surface",
        message: `cannot expose a capability with unregistered surface ${surface.contract}@${surface.major}`
      });
    }
    const data = this.fieldData(target, surface);
    const has = this.presentOptional(target, surface);
    const record = this.table.allocate({
      kind: "lease",
      target,
      release,
      contract: surface.contract,
      major: surface.major
    });
    return new LocalCapabilityImpl(
      this,
      handleRef(record.id, "lease", surface, data, has),
      surface.contract,
      surface.major
    );
  }
  async load(request, options = {}) {
    this.assertOpen();
    if (this.role !== "host") {
      throw new ModkitError({
        code: "x3.host/rpc-role-violation",
        message: "only the host endpoint loads modules"
      });
    }
    const outcome = await this.request({ t: "load", ...request }, "load", options);
    if (outcome.kind === "throw") throw fromErrorDto(outcome.error);
    if (outcome.kind !== "handle") {
      throw this.failWith({ code: "unexpected-frame", message: "load must be answered by ready" });
    }
    const ready = outcome.value;
    return Object.freeze({ abiVersion: 1, exports: ready.exports, root: this.proxy(ready.root) });
  }
  proxy(ref) {
    const inner = ref[HANDLE_MARKER];
    if (this.table.owns(inner.id)) {
      throw new ModkitError({
        code: "x3.host/rpc-not-remote",
        message: `handle ${inner.id} is local to this endpoint`
      });
    }
    if (inner.kind !== "lease" || inner.contract === void 0 || inner.major === void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-bad-handle",
        message: `handle ${inner.id} is not a lease capability`
      });
    }
    if (this.surfaces.surfaceFor(inner.contract, inner.major) === void 0) {
      throw this.failWith({
        code: "unknown-surface",
        message: `peer offered unregistered surface ${inner.contract}@${inner.major}`
      });
    }
    const existing = this.remoteProxies.get(inner.id);
    if (existing !== void 0) return existing;
    if (!this.remote.has(inner.id))
      this.remote.set(inner.id, { ref, released: false, children: /* @__PURE__ */ new Set() });
    const capability = new RemoteCapabilityImpl(
      this,
      ref,
      inner.contract,
      inner.major,
      Object.freeze({ ...inner.data ?? {} })
    );
    this.remoteProxies.set(inner.id, capability);
    return capability;
  }
  materialize(remote) {
    const surface = this.requireSurface(remote.contract, remote.major);
    const object2 = {};
    for (const field2 of surface.fields ?? []) {
      if (Object.hasOwn(remote.data, field2)) {
        Object.defineProperty(object2, field2, {
          value: remote.data[field2],
          enumerable: true,
          writable: false
        });
      }
    }
    const present = remote.has;
    for (const [name, method] of Object.entries(surface.methods)) {
      if (method.optional === true && present !== void 0 && !present.includes(name)) continue;
      const invoke = async (...rawArgs) => {
        const args = [...rawArgs];
        let signal;
        let onProgress;
        const last = args[args.length - 1];
        if (isAbortSignal(last)) {
          signal = last;
          args.pop();
        }
        const lift = (ref, expect) => {
          const holder = args[ref.arg];
          if (typeof holder !== "object" || holder === null || !Object.hasOwn(holder, ref.key))
            return void 0;
          const value2 = holder[ref.key];
          const matches2 = expect === "signal" ? isAbortSignal(value2) : typeof value2 === "function";
          if (!matches2 && value2 !== void 0) return void 0;
          args[ref.arg] = Object.fromEntries(
            Object.entries(holder).filter(([key2]) => key2 !== ref.key)
          );
          return value2;
        };
        if (typeof method.signal === "object") {
          const lifted = lift(method.signal, "signal");
          if (isAbortSignal(lifted)) signal = lifted;
        }
        if (method.progress !== void 0) {
          const lifted = lift(method.progress, "function");
          if (typeof lifted === "function") onProgress = lifted;
        }
        const outcome = await remote.call(name, args, {
          ...signal === void 0 ? {} : { signal },
          ...onProgress === void 0 ? {} : { onProgress }
        });
        switch (outcome.kind) {
          case "value":
            return outcome.value;
          case "lease": {
            const materialized = this.materialize(outcome.remote);
            return method.wrapper === "lease" ? { value: materialized, release: () => outcome.remote.release() } : materialized;
          }
          case "leased-value":
            return { value: outcome.value, release: outcome.release };
          case "iterable":
            return outcome.iterable;
          case "events":
            return outcome.events;
        }
      };
      object2[name] = method.kind === "iterable" || method.kind === "events" ? (...rawArgs) => lazyStream(() => invoke(...rawArgs)) : invoke;
    }
    if (surface.releaseVia !== void 0) {
      const inner = object2[surface.releaseVia];
      object2[surface.releaseVia] = async (...args) => {
        try {
          return await inner(...args);
        } finally {
          await remote.release();
        }
      };
    }
    Object.defineProperty(object2, CAPABILITY_OF, { value: remote, enumerable: false });
    return object2;
  }
  receive(raw) {
    if (this.state !== "open") return;
    const validated = validateFrame(raw, this.limits, {
      session: this.session,
      generation: this.generation
    });
    if (!validated.ok) {
      this.fail(validated.violation);
      return;
    }
    const frame = validated.value;
    if (frame.id <= this.lastInboundId) {
      this.fail({
        code: "non-monotonic-id",
        message: `frame id ${frame.id} is not greater than ${this.lastInboundId}`
      });
      return;
    }
    this.lastInboundId = frame.id;
    this.inboundCount += 1;
    void this.dispatch(frame).catch((error) => {
      this.fail({
        code: "unexpected-frame",
        message: `frame handler failed: ${error instanceof Error ? error.message : String(error)}`
      });
    });
  }
  async close(reason) {
    if (this.state !== "open") return;
    this.state = "closed";
    this.trySend({ t: "terminate", reason });
    await this.teardown(
      new ModkitError({
        code: "x3.host/rpc-endpoint-closed",
        message: `endpoint closed: ${reason}`,
        retryability: "conditional"
      })
    );
  }
  async peerClosed(reason) {
    if (this.state !== "open") return;
    this.state = "closed";
    await this.teardown(
      new ModkitError({
        code: "x3.host/rpc-peer-exited",
        message: `peer exited: ${reason}`,
        retryability: "conditional"
      })
    );
  }
  // ------------------------------------------------------------------ internal: lifecycle
  assertOpen() {
    if (this.state !== "open") {
      throw new ModkitError({
        code: "x3.host/rpc-endpoint-closed",
        message: `endpoint is ${this.state}`
      });
    }
  }
  failWith(item) {
    this.fail(item);
    return protocolViolationError(item);
  }
  fail(item) {
    if (this.state !== "open") return;
    this.violations += 1;
    this.state = "failed";
    this.trySend({ t: "terminate", reason: `protocol violation: ${item.code}` });
    void this.teardown(protocolViolationError(item));
    this.onFailure?.(item);
  }
  async teardown(error) {
    this.unsubscribePort();
    this.pending.failAll(error);
    this.active.cancelAll();
    this.subscriptions.closeAll(error);
    for (const pump of this.pumps.values()) {
      pump.stopped = true;
      void pump.iterator?.return?.();
    }
    this.pumps.clear();
    for (const state of this.remote.values()) state.released = true;
    const { failures } = await this.table.invalidate();
    for (const failure of failures)
      this.report(
        "x3.host/rpc-release-failed",
        `release failed during teardown: ${failure instanceof Error ? failure.message : String(failure)}`
      );
  }
  report(code, message) {
    this.onDiagnostic?.({ code, severity: "warning", message });
  }
  // ------------------------------------------------------------------ internal: sending
  nextId() {
    this.outboundId += 1;
    return this.outboundId;
  }
  buildFrame(body) {
    return {
      domain: CAPABILITY_RPC_DOMAIN,
      version: CAPABILITY_RPC_VERSION,
      session: this.session,
      generation: this.generation,
      id: this.nextId(),
      ...body
    };
  }
  /**
   * Sends a frame; outbound values are validated with our own limits before they leave.
   *
   * Transfer policy: **arguments are copied, results and events are transferred.** ABI code is
   * written for in-process calls and freely reuses a buffer it passed as an argument (a codec hands
   * the same `bytes` to `parse` and then to `dataSource`); transferring would detach it under the
   * caller's feet. Results are one-shot values the executor produced for this reply, so moving them
   * is safe and keeps large reads cheap.
   */
  send(body) {
    const frame = this.buildFrame(body);
    const transfer = [];
    const measure = (value2, handles, move) => {
      const checked = validateWireValue(value2, this.limits, handles);
      if (!checked.ok) {
        throw new ModkitError({
          code: "x3.host/rpc-outbound-value-invalid",
          message: `outbound value rejected: ${checked.violation.message}`,
          context: { violation: checked.violation.code }
        });
      }
      if (move) transfer.push(...checked.value.transferables);
    };
    if (frame.t === "call") measure(frame.args, "nested", false);
    else if (frame.t === "return" && frame.value !== void 0) measure(frame.value, "top", true);
    else if (frame.t === "event") measure(frame.value, "forbid", true);
    this.port.post(frame, transfer);
    return frame;
  }
  trySend(body) {
    try {
      this.port.post(this.buildFrame(body), []);
    } catch {
    }
  }
  request(body, kind, options) {
    this.assertOpen();
    if (options.signal?.aborted) {
      return Promise.reject(new OperationCancelledError(options.signal.reason));
    }
    return new Promise((resolve, reject) => {
      const id = this.outboundId + 1;
      let timer;
      let abortListener;
      const cleanup = () => {
        if (timer !== void 0) this.scheduler.clearTimeout(timer);
        if (abortListener !== void 0) options.signal?.removeEventListener("abort", abortListener);
      };
      const entry2 = this.pending.open({
        id,
        kind,
        resolve: (outcome) => {
          cleanup();
          resolve(outcome);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        ...options.onProgress === void 0 ? {} : { onProgress: options.onProgress }
      });
      const cancelWith = (error) => {
        if (entry2.settled || entry2.cancelled) return;
        this.pending.cancel(id);
        cleanup();
        this.trySend({ t: "cancel", target: id });
        reject(error);
      };
      const deadline = options.deadlineMs ?? this.limits.defaultCallDeadlineMs;
      if (deadline > 0 && kind !== "subscribe") {
        timer = this.scheduler.setTimeout(
          () => cancelWith(
            new ModkitError({
              code: "x3.host/rpc-deadline-exceeded",
              message: `${kind} #${id} exceeded its ${deadline} ms deadline`,
              context: { id, deadlineMs: deadline },
              retryability: "conditional"
            })
          ),
          deadline
        );
      }
      if (options.signal !== void 0) {
        abortListener = () => cancelWith(new OperationCancelledError(options.signal?.reason));
        options.signal.addEventListener("abort", abortListener, { once: true });
      }
      try {
        const frame = this.send(body);
        if (frame.id !== id) {
          throw new ModkitError({
            code: "x3.host/rpc-internal",
            message: "frame id allocation raced"
          });
        }
      } catch (error) {
        this.pending.drop(id);
        cleanup();
        reject(
          isModkitError(error) ? error : new ModkitError({ code: "x3.host/rpc-send-failed", message: String(error) })
        );
      }
    });
  }
  // ------------------------------------------------------------------ internal: remote side
  remoteReleased(id) {
    return this.remote.get(id)?.released ?? true;
  }
  localReleased(id) {
    return this.table.lookup(id).state !== "live";
  }
  requireSurface(contract, major) {
    const surface = this.surfaces.surfaceFor(contract, major);
    if (surface === void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-unknown-surface",
        message: `no surface registered for ${contract}@${major}`
      });
    }
    return surface;
  }
  encodeArgs(args) {
    const encode = (value2, path) => {
      if (value2 instanceof RemoteCapabilityImpl || value2 instanceof LocalCapabilityImpl) {
        if (value2.isReleased) {
          throw new ModkitError({
            code: "x3.host/rpc-released-handle",
            message: `argument ${path} is a released capability`
          });
        }
        return value2.ref;
      }
      if (typeof value2 === "object" && value2 !== null && CAPABILITY_OF in value2) {
        return encode(value2[CAPABILITY_OF], path);
      }
      if (isHandleRef(value2)) return value2;
      if (Array.isArray(value2)) return value2.map((item, index) => encode(item, `${path}[${index}]`));
      if (isPlainObject(value2)) {
        const out = {};
        for (const [key2, item] of Object.entries(value2)) out[key2] = encode(item, `${path}.${key2}`);
        return out;
      }
      return value2;
    };
    return args.map((arg, index) => encode(arg, `args[${index}]`));
  }
  async callRemote(remote, method, args, options) {
    this.assertOpen();
    if (remote.isReleased) {
      throw new ModkitError({
        code: "x3.host/rpc-released-handle",
        message: `remote ${remote.id} was released`
      });
    }
    const surface = this.requireSurface(remote.contract, remote.major);
    const decl = surface.methods[method];
    if (decl === void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-unknown-method",
        message: `surface ${remote.contract}@${remote.major} has no method \xAB${method}\xBB`
      });
    }
    if (args.length > this.limits.maxArgs) {
      throw new ModkitError({
        code: "x3.host/rpc-limit-exceeded",
        message: `more than ${this.limits.maxArgs} arguments`
      });
    }
    const encoded = this.encodeArgs(args);
    const argProblem = decl.validateArgs?.(encoded);
    if (argProblem !== void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-bad-argument",
        message: `${method}: ${argProblem}`
      });
    }
    const outcome = await this.request(
      {
        t: "call",
        handle: remote.id,
        method,
        args: encoded,
        ...options.deadlineMs === void 0 ? {} : { deadlineMs: options.deadlineMs }
      },
      "call",
      options
    );
    if (outcome.kind === "throw") throw fromErrorDto(outcome.error);
    if (outcome.kind === "done")
      throw this.failWith({ code: "unexpected-frame", message: "call answered with done" });
    if (surface.releaseVia === method) this.markRemoteReleased(remote.id);
    if (decl.kind === "value") {
      if (outcome.kind !== "return")
        throw this.failWith({
          code: "bad-return",
          message: `value method \xAB${method}\xBB returned a handle`
        });
      const problem = decl.validateReturn?.(outcome.value);
      if (problem !== void 0)
        throw this.failWith({ code: "bad-return", message: `${method}: ${problem}` });
      return { kind: "value", value: outcome.value };
    }
    if (decl.kind === "leased-value") {
      if (outcome.kind !== "return" || outcome.lease === void 0) {
        throw this.failWith({
          code: "bad-return",
          message: `leased-value method \xAB${method}\xBB did not return a value with its lease`
        });
      }
      const problem = decl.validateReturn?.(outcome.value);
      if (problem !== void 0)
        throw this.failWith({ code: "bad-return", message: `${method}: ${problem}` });
      const leaseId = this.adoptRemoteHandle(outcome.lease, remote.id, "lease");
      return {
        kind: "leased-value",
        value: outcome.value,
        release: () => this.releaseRemote(leaseId)
      };
    }
    if (outcome.kind !== "handle") {
      throw this.failWith({
        code: "bad-return",
        message: `${decl.kind} method \xAB${method}\xBB returned a plain value`
      });
    }
    const ref = outcome.value;
    const inner = ref[HANDLE_MARKER];
    this.adoptRemoteHandle(ref, remote.id);
    switch (decl.kind) {
      case "lease": {
        const expected = decl.result;
        const dynamic = decl.resultFromArgs !== void 0;
        if (inner.kind !== "lease" || inner.contract === void 0 || inner.major === void 0 || !dynamic && (expected === void 0 || inner.contract !== expected.contract || inner.major !== expected.major)) {
          throw this.failWith({
            code: "bad-handle",
            message: `lease method \xAB${method}\xBB returned a handle of another kind/surface`
          });
        }
        if (dynamic && this.surfaces.surfaceFor(inner.contract, inner.major) === void 0) {
          throw this.failWith({
            code: "unknown-surface",
            message: `lease method \xAB${method}\xBB returned unregistered surface ${inner.contract}@${inner.major}`
          });
        }
        return { kind: "lease", remote: this.proxy(ref) };
      }
      case "iterable": {
        if (inner.kind !== "iterator")
          throw this.failWith({
            code: "bad-handle",
            message: `iterable method \xAB${method}\xBB did not return an iterator handle`
          });
        return { kind: "iterable", iterable: this.remoteIterable(inner.id, decl) };
      }
      case "events": {
        if (inner.kind !== "events")
          throw this.failWith({
            code: "bad-handle",
            message: `events method \xAB${method}\xBB did not return an events handle`
          });
        return { kind: "events", events: this.remoteEvents(inner.id, decl) };
      }
      default:
        throw this.failWith({ code: "bad-return", message: "unknown method kind" });
    }
  }
  /** Registers a handle the peer produced for us; refuses our own, reused or over-limit ids. */
  adoptRemoteHandle(ref, parent, expectKind) {
    const inner = ref[HANDLE_MARKER];
    if (this.table.owns(inner.id))
      throw this.failWith({ code: "bad-handle", message: "peer returned a handle this side owns" });
    if (this.remote.has(inner.id))
      throw this.failWith({ code: "bad-handle", message: `peer reused handle ${inner.id}` });
    if (expectKind !== void 0 && inner.kind !== expectKind)
      throw this.failWith({ code: "bad-handle", message: `expected a ${expectKind} handle` });
    if (this.remote.size >= this.limits.maxHandles) {
      throw new ModkitError({
        code: "x3.host/rpc-limit-exceeded",
        message: `remote handle limit ${this.limits.maxHandles} reached`
      });
    }
    this.remote.set(inner.id, { ref, released: false, children: /* @__PURE__ */ new Set(), parent });
    this.remote.get(parent)?.children.add(inner.id);
    return inner.id;
  }
  markRemoteReleased(id) {
    const state = this.remote.get(id);
    if (state === void 0 || state.released) return;
    state.released = true;
    for (const child of [...state.children].reverse()) this.markRemoteReleased(child);
    if (state.parent !== void 0) this.remote.get(state.parent)?.children.delete(id);
  }
  async releaseRemote(id) {
    const state = this.remote.get(id);
    if (state === void 0 || state.released) return;
    this.markRemoteReleased(id);
    if (this.state !== "open") return;
    const outcome = await this.request({ t: "release", handle: id }, "release", {
      deadlineMs: this.limits.defaultCallDeadlineMs
    });
    if (outcome.kind === "throw") throw fromErrorDto(outcome.error);
  }
  remoteIterable(id, decl) {
    const batch = this.limits.iteratorBatchItems;
    return {
      [Symbol.asyncIterator]: () => {
        let finished = false;
        const buffered = [];
        return {
          next: async () => {
            if (buffered.length > 0) return { done: false, value: buffered.shift() };
            if (finished || this.remoteReleased(id)) return { done: true, value: void 0 };
            const outcome = await this.request(
              batch > 1 ? { t: "next", handle: id, max: batch } : { t: "next", handle: id },
              "next",
              {}
            );
            if (outcome.kind === "done") {
              finished = true;
              this.markRemoteReleased(id);
              return { done: true, value: void 0 };
            }
            if (outcome.kind === "throw") {
              finished = true;
              this.markRemoteReleased(id);
              throw fromErrorDto(outcome.error);
            }
            if (outcome.kind !== "return") {
              throw this.failWith({
                code: "bad-return",
                message: "iterator item must be a plain value"
              });
            }
            if (batch > 1) {
              const items = outcome.value;
              if (!Array.isArray(items) || items.length === 0 || items.length > batch) {
                throw this.failWith({
                  code: "bad-return",
                  message: `iterator batch must be a non-empty array of at most ${batch} items`
                });
              }
              for (const item of items) {
                const problem2 = decl.validateReturn?.(item);
                if (problem2 !== void 0)
                  throw this.failWith({ code: "bad-return", message: problem2 });
              }
              buffered.push(...items);
              return { done: false, value: buffered.shift() };
            }
            const problem = decl.validateReturn?.(outcome.value);
            if (problem !== void 0) throw this.failWith({ code: "bad-return", message: problem });
            return { done: false, value: outcome.value };
          },
          return: async () => {
            if (!finished) {
              finished = true;
              await this.releaseRemote(id);
            }
            return { done: true, value: void 0 };
          }
        };
      }
    };
  }
  remoteEvents(id, decl) {
    return {
      [Symbol.asyncIterator]: () => {
        let subscription;
        let finished = false;
        const stop = async () => {
          if (finished) return;
          finished = true;
          if (subscription !== void 0) {
            this.subscriptions.close(subscription);
            this.subscriptions.drop(subscription);
            if (this.state === "open") this.trySend({ t: "unsubscribe", subscription });
          }
          await this.releaseRemote(id);
        };
        return {
          next: async () => {
            if (finished) return { done: true, value: void 0 };
            if (subscription === void 0) {
              const outcome = await this.request({ t: "subscribe", handle: id }, "subscribe", {});
              if (outcome.kind === "throw") {
                finished = true;
                throw fromErrorDto(outcome.error);
              }
              if (outcome.kind !== "return" || typeof outcome.value !== "string") {
                throw this.failWith({
                  code: "bad-return",
                  message: "subscribe must return a subscription id"
                });
              }
              subscription = outcome.value;
              this.subscriptions.register(subscription, id);
            }
            for (; ; ) {
              const record = this.subscriptions.get(subscription);
              if (record === void 0) {
                finished = true;
                return { done: true, value: void 0 };
              }
              const item = record.queue.shift();
              if (item !== void 0) {
                const problem = decl.validateReturn?.(item);
                if (problem !== void 0)
                  throw this.failWith({ code: "bad-return", message: problem });
                return { done: false, value: item };
              }
              if (record.closed) {
                finished = true;
                this.subscriptions.drop(subscription);
                if (record.error !== void 0) throw record.error;
                return { done: true, value: void 0 };
              }
              await new Promise((resolve) => {
                record.wake = resolve;
              });
              record.wake = void 0;
            }
          },
          return: async () => {
            await stop();
            return { done: true, value: void 0 };
          }
        };
      }
    };
  }
  closeSubscription(id, error) {
    this.subscriptions.close(id, error);
  }
  // ------------------------------------------------------------------ internal: local side
  async releaseLocal(id) {
    const result = await this.table.release(id);
    for (const failure of result.failures) {
      this.report(
        "x3.host/rpc-release-failed",
        `release of ${id} failed: ${failure instanceof Error ? failure.message : String(failure)}`
      );
    }
  }
  decodeArgs(args) {
    const decode = (value2) => {
      if (isHandleRef(value2)) {
        const inner = value2[HANDLE_MARKER];
        if (this.table.owns(inner.id)) {
          const lookup = this.table.lookup(inner.id);
          if (lookup.state !== "live") {
            throw new ModkitError({
              code: "x3.host/rpc-released-handle",
              message: `argument references released local handle ${inner.id}`
            });
          }
          return lookup.record.target;
        }
        if (inner.kind !== "lease") {
          throw new ModkitError({
            code: "x3.host/rpc-bad-argument",
            message: "only lease capabilities may be passed as arguments"
          });
        }
        return this.materialize(this.proxy(value2));
      }
      if (Array.isArray(value2)) return value2.map((item) => decode(item));
      if (isPlainObject(value2)) {
        const out = {};
        for (const [key2, item] of Object.entries(value2)) out[key2] = decode(item);
        return out;
      }
      return value2;
    };
    return args.map((arg) => decode(arg));
  }
  reply(inReplyTo, outcome) {
    if (this.state !== "open") return;
    try {
      switch (outcome.kind) {
        case "return":
          this.send({
            t: "return",
            inReplyTo,
            ...outcome.value === void 0 ? {} : { value: outcome.value },
            ...outcome.lease === void 0 ? {} : { lease: outcome.lease }
          });
          break;
        case "handle":
          this.send({ t: "return", inReplyTo, value: outcome.value });
          break;
        case "throw":
          this.send({ t: "throw", inReplyTo, error: outcome.error });
          break;
        case "ready":
          this.send({
            t: "ready",
            inReplyTo,
            abiVersion: 1,
            exports: outcome.value.exports,
            root: outcome.value.root
          });
          break;
        case "done":
          break;
      }
    } catch (error) {
      this.trySend({ t: "throw", inReplyTo, error: toErrorDto(error, this.limits) });
    }
  }
  async dispatch(frame) {
    switch (frame.t) {
      case "load":
        return this.handleLoad(frame);
      case "ready":
        return this.handleReady(frame);
      case "call":
        return this.handleCall(frame);
      case "return":
        return this.handleSettle(
          frame.inReplyTo,
          isHandleRef(frame.value) ? { kind: "handle", value: frame.value } : {
            kind: "return",
            value: frame.value,
            ...frame.lease === void 0 ? {} : { lease: frame.lease }
          }
        );
      case "throw":
        return this.handleSettle(frame.inReplyTo, { kind: "throw", error: frame.error });
      case "progress": {
        const result = this.pending.progress(frame.inReplyTo, frame.progress);
        if (result === "unknown")
          this.fail({
            code: "unknown-reply-target",
            message: `progress for unknown call ${frame.inReplyTo}`
          });
        return;
      }
      case "cancel":
        this.active.cancel(frame.target);
        return;
      case "next":
        return this.handleNext(frame);
      case "done":
        return this.handleDone(frame);
      case "subscribe":
        return this.handleSubscribe(frame);
      case "event":
        return this.handleEvent(frame);
      case "unsubscribe": {
        const pump = this.pumps.get(frame.subscription);
        if (pump !== void 0) {
          pump.stopped = true;
          this.pumps.delete(frame.subscription);
          await pump.iterator?.return?.();
        }
        return;
      }
      case "release":
        return this.handleRelease(frame);
      case "terminate":
        if (this.state !== "open") return;
        this.state = "closed";
        await this.teardown(
          new ModkitError({
            code: "x3.host/rpc-terminated",
            message: `peer terminated: ${frame.reason}`,
            retryability: "conditional"
          })
        );
        this.onTerminate?.(frame.reason);
        return;
    }
  }
  handleSettle(inReplyTo, outcome) {
    const result = this.pending.settle(inReplyTo, outcome);
    if (result === "unknown")
      this.fail({ code: "unknown-reply-target", message: `reply for unknown call ${inReplyTo}` });
    else if (result === "duplicate")
      this.fail({ code: "duplicate-reply", message: `duplicate reply for call ${inReplyTo}` });
    else if (result === "late-after-cancel")
      this.report(
        "x3.host/rpc-late-reply-dropped",
        `dropped late reply for cancelled call ${inReplyTo}`
      );
    if (result === "late-after-cancel" && outcome.kind === "handle") {
      const ref = outcome.value;
      this.discardHandle(ref[HANDLE_MARKER].id);
    } else if (result === "late-after-cancel" && outcome.kind === "return" && outcome.lease) {
      this.discardHandle(outcome.lease[HANDLE_MARKER].id);
    }
  }
  /**
   * Releases a handle the peer produced for a request this side had already cancelled. The peer
   * answers every `release`, so this must be a real request with a pending entry — a
   * fire-and-forget frame would turn the peer's acknowledgement into an `unknown-reply-target`
   * violation (found by the transport conformance kit on real event-loop hops).
   */
  discardHandle(id) {
    if (this.state !== "open") return;
    const failed = (reason) => this.report("x3.host/rpc-release-failed", `discard of late handle ${id} failed: ${reason}`);
    void this.request({ t: "release", handle: id }, "release", {
      deadlineMs: this.limits.defaultCallDeadlineMs
    }).then(
      (outcome) => {
        if (outcome.kind === "throw") failed(outcome.error.message);
      },
      (error) => failed(error instanceof Error ? error.message : String(error))
    );
  }
  async handleLoad(frame) {
    if (this.role !== "worker") {
      this.fail({ code: "unexpected-frame", message: "load received by a host endpoint" });
      return;
    }
    if (this.loader === void 0) {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(
          new ModkitError({
            code: "x3.host/rpc-no-loader",
            message: "this endpoint cannot load modules"
          }),
          this.limits
        )
      });
      return;
    }
    const active = this.active.begin(frame.id);
    try {
      const loaded = await this.loader(
        {
          moduleUrl: frame.moduleUrl,
          contributionId: frame.contributionId,
          variantId: frame.variantId,
          artifactDigest: frame.artifactDigest,
          ...frame.entrypointDigest === void 0 ? {} : { entrypointDigest: frame.entrypointDigest }
        },
        active.controller.signal
      );
      const capability = this.expose(loaded.module, loaded.surface, loaded.release ?? noopRelease);
      const exports = Object.keys(loaded.module).filter((key2) => key2.length <= 256).sort();
      this.reply(frame.id, {
        kind: "ready",
        value: { abiVersion: 1, exports, root: capability.ref }
      });
    } catch (error) {
      this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
    } finally {
      this.active.end(frame.id);
    }
  }
  handleReady(frame) {
    const entry2 = this.pending.peek(frame.inReplyTo);
    if (entry2 !== void 0 && entry2.kind !== "load" && !entry2.cancelled) {
      this.fail({ code: "unexpected-frame", message: "ready received for a non-load call" });
      return;
    }
    const result = this.pending.settle(frame.inReplyTo, {
      kind: "handle",
      value: { abiVersion: 1, exports: frame.exports, root: frame.root }
    });
    if (result === "unknown") {
      this.fail({
        code: "unknown-reply-target",
        message: `ready for unknown load ${frame.inReplyTo}`
      });
    } else if (result === "duplicate") {
      this.fail({ code: "duplicate-reply", message: `duplicate ready for load ${frame.inReplyTo}` });
    } else if (result === "late-after-cancel") {
      this.report(
        "x3.host/rpc-late-reply-dropped",
        `dropped late ready for cancelled load ${frame.inReplyTo}`
      );
      this.discardHandle(frame.root[HANDLE_MARKER].id);
    }
  }
  async handleCall(frame) {
    if (!this.table.owns(frame.handle)) {
      this.fail({
        code: "unknown-handle",
        message: `call on handle ${frame.handle} this side does not own`
      });
      return;
    }
    const lookup = this.table.lookup(frame.handle);
    if (lookup.state === "unknown" || lookup.state === "foreign-generation") {
      this.fail({
        code: lookup.state === "unknown" ? "unknown-handle" : "stale-generation",
        message: `call on ${lookup.state} handle ${frame.handle}`
      });
      return;
    }
    if (lookup.state === "released") {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(
          new ModkitError({
            code: "x3.host/rpc-released-handle",
            message: `handle ${frame.handle} was released`
          }),
          this.limits
        )
      });
      return;
    }
    const record = lookup.record;
    if (record.kind !== "lease" || record.contract === void 0 || record.major === void 0) {
      this.fail({
        code: "wrong-handle-kind",
        message: `call on ${record.kind} handle ${frame.handle}`
      });
      return;
    }
    const surface = this.surfaces.surfaceFor(record.contract, record.major);
    const decl = surface?.methods[frame.method];
    if (surface === void 0 || decl === void 0) {
      this.fail({
        code: "unknown-method",
        message: `no method \xAB${frame.method}\xBB on ${record.contract}@${record.major}`
      });
      return;
    }
    let args;
    try {
      args = this.decodeArgs(frame.args);
      const problem = decl.validateArgs?.(frame.args);
      if (problem !== void 0)
        throw new ModkitError({
          code: "x3.host/rpc-bad-argument",
          message: `${frame.method}: ${problem}`
        });
    } catch (error) {
      this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
      return;
    }
    const target = record.target;
    const fn = target[frame.method];
    if (typeof fn !== "function") {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(
          new ModkitError({
            code: "x3.host/rpc-method-unavailable",
            message: `target has no method \xAB${frame.method}\xBB`
          }),
          this.limits
        )
      });
      return;
    }
    let dynamicResult;
    if (decl.kind === "lease" && decl.resultFromArgs !== void 0) {
      const contract = readArgRef(args, decl.resultFromArgs.contract);
      const major = readArgRef(args, decl.resultFromArgs.major);
      if (typeof contract !== "string" || typeof major !== "number" || this.surfaces.surfaceFor(contract, major) === void 0) {
        this.reply(frame.id, {
          kind: "throw",
          error: toErrorDto(
            new ModkitError({
              code: "x3.host/rpc-bad-argument",
              message: `${frame.method}: arguments do not name a registered surface`
            }),
            this.limits
          )
        });
        return;
      }
      dynamicResult = { contract, major };
    }
    const active = this.active.begin(frame.id);
    if (decl.arity !== void 0) while (args.length < decl.arity) args.push(void 0);
    if (decl.signal === "last") args.push(active.controller.signal);
    else if (typeof decl.signal === "object") {
      this.placeInArg(args, decl.signal, active.controller.signal);
    }
    if (decl.progress !== void 0) {
      const callId = frame.id;
      this.placeInArg(args, decl.progress, (progress) => {
        const dto = normalizeProgress(progress);
        if (dto !== void 0 && this.state === "open")
          this.trySend({ t: "progress", inReplyTo: callId, progress: dto });
      });
    }
    let result;
    try {
      result = await Reflect.apply(fn, target, args);
    } catch (error) {
      this.active.end(frame.id);
      this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
      return;
    }
    this.active.end(frame.id);
    if (active.cancelled) {
      if (isLeaseLike(result)) await result.release();
      else if (decl.kind !== "value" && isAsyncIterable(result)) {
        await result[Symbol.asyncIterator]().return?.();
      }
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(new OperationCancelledError("cancelled by peer"), this.limits)
      });
      return;
    }
    switch (decl.kind) {
      case "value": {
        const checked = result === void 0 ? { ok: true } : validateWireValue(result, this.limits, "forbid");
        const problem = checked.ok ? decl.validateReturn?.(result) : checked.violation.message;
        if (problem !== void 0) {
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(
              new ModkitError({
                code: "x3.host/rpc-bad-return",
                message: `${frame.method}: ${problem}`
              }),
              this.limits
            )
          });
          return;
        }
        this.reply(frame.id, { kind: "return", value: result });
        if (surface.releaseVia === frame.method) await this.releaseLocal(record.id);
        return;
      }
      case "leased-value": {
        const lease = isLeaseLike(result) ? result : void 0;
        const checked = lease === void 0 ? void 0 : lease.value === void 0 ? { ok: true } : validateWireValue(lease.value, this.limits, "forbid");
        const problem = lease === void 0 ? "did not return a lease" : checked !== void 0 && !checked.ok ? checked.violation.message : decl.validateReturn?.(lease.value);
        if (lease === void 0 || problem !== void 0) {
          if (lease !== void 0) await lease.release();
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(
              new ModkitError({
                code: "x3.host/rpc-bad-return",
                message: `${frame.method}: ${problem ?? "did not return a lease"}`
              }),
              this.limits
            )
          });
          return;
        }
        try {
          const child = this.table.allocate({
            kind: "lease",
            target: {},
            release: () => lease.release(),
            parent: record.id
          });
          this.reply(frame.id, {
            kind: "return",
            value: lease.value,
            lease: handleRef(child.id, "lease")
          });
        } catch (error) {
          await lease.release();
          this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
        }
        return;
      }
      case "lease": {
        const lease = isLeaseLike(result) ? result : void 0;
        const value2 = lease === void 0 ? result : lease.value;
        const resultSurface = dynamicResult ?? decl.result;
        if (typeof value2 !== "object" || value2 === null || resultSurface === void 0) {
          if (lease !== void 0) await lease.release();
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(
              new ModkitError({
                code: "x3.host/rpc-bad-return",
                message: `${frame.method} did not return a capability`
              }),
              this.limits
            )
          });
          return;
        }
        try {
          const data = this.fieldData(value2, resultSurface);
          const has = this.presentOptional(value2, resultSurface);
          const child = this.table.allocate({
            kind: "lease",
            target: value2,
            release: lease === void 0 ? noopRelease : () => lease.release(),
            contract: resultSurface.contract,
            major: resultSurface.major,
            parent: record.id
          });
          this.reply(frame.id, {
            kind: "handle",
            value: handleRef(child.id, "lease", resultSurface, data, has)
          });
        } catch (error) {
          if (lease !== void 0) await lease.release();
          this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
        }
        return;
      }
      case "iterable":
      case "events": {
        if (!isAsyncIterable(result)) {
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(
              new ModkitError({
                code: "x3.host/rpc-bad-return",
                message: `${frame.method} did not return an async iterable`
              }),
              this.limits
            )
          });
          return;
        }
        try {
          if (decl.kind === "iterable") {
            const iteratorTarget = {
              iterator: result[Symbol.asyncIterator](),
              busy: false
            };
            const child = this.table.allocate({
              kind: "iterator",
              target: iteratorTarget,
              release: () => iteratorTarget.iterator.return?.().then(() => void 0),
              parent: record.id
            });
            this.reply(frame.id, { kind: "handle", value: handleRef(child.id, "iterator") });
          } else {
            const eventsTarget = { iterable: result, stopped: false };
            const child = this.table.allocate({
              kind: "events",
              target: eventsTarget,
              release: () => {
                eventsTarget.stopped = true;
                if (eventsTarget.subscription !== void 0) {
                  const pump = this.pumps.get(eventsTarget.subscription);
                  this.pumps.delete(eventsTarget.subscription);
                  if (pump !== void 0) {
                    pump.stopped = true;
                    return pump.iterator?.return?.().then(() => void 0);
                  }
                }
                return void 0;
              },
              parent: record.id
            });
            this.reply(frame.id, { kind: "handle", value: handleRef(child.id, "events") });
          }
        } catch (error) {
          await result[Symbol.asyncIterator]().return?.();
          this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
        }
        return;
      }
    }
  }
  async handleNext(frame) {
    const lookup = this.lookupOwned(frame.handle, "iterator");
    if (lookup === void 0) return;
    if (lookup.state === "released") {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(
          new ModkitError({
            code: "x3.host/rpc-released-handle",
            message: `iterator ${frame.handle} was released`
          }),
          this.limits
        )
      });
      return;
    }
    const target = lookup.record.target;
    if (target.busy) {
      this.fail({ code: "iterator-busy", message: `concurrent next on iterator ${frame.handle}` });
      return;
    }
    if (target.exhausted === true) {
      this.send({ t: "done", inReplyTo: frame.id, handle: frame.handle });
      await this.releaseLocal(frame.handle);
      return;
    }
    target.busy = true;
    const active = this.active.begin(frame.id);
    active.controller.signal.addEventListener("abort", () => void target.iterator.return?.(), {
      once: true
    });
    const max = frame.max ?? 1;
    try {
      const items = [];
      let ended = false;
      while (items.length < max) {
        const step = await target.iterator.next();
        if (active.cancelled) {
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(new OperationCancelledError("cancelled by peer"), this.limits)
          });
          await this.releaseLocal(frame.handle);
          return;
        }
        if (step.done === true) {
          ended = true;
          break;
        }
        const checked = validateWireValue(step.value, this.limits, "forbid");
        if (!checked.ok) {
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(
              new ModkitError({
                code: "x3.host/rpc-bad-return",
                message: `iterator item rejected: ${checked.violation.message}`
              }),
              this.limits
            )
          });
          await this.releaseLocal(frame.handle);
          return;
        }
        items.push(step.value);
      }
      if (items.length === 0) {
        this.send({ t: "done", inReplyTo: frame.id, handle: frame.handle });
        await this.releaseLocal(frame.handle);
        return;
      }
      if (ended) target.exhausted = true;
      this.reply(frame.id, {
        kind: "return",
        value: frame.max === void 0 ? items[0] : items
      });
    } catch (error) {
      this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
      await this.releaseLocal(frame.handle);
    } finally {
      target.busy = false;
      this.active.end(frame.id);
    }
  }
  lookupOwned(handle, kind) {
    if (!this.table.owns(handle)) {
      this.fail({
        code: "unknown-handle",
        message: `${kind} handle ${handle} is not owned by this side`
      });
      return void 0;
    }
    const lookup = this.table.lookup(handle);
    if (lookup.state === "unknown" || lookup.state === "foreign-generation") {
      this.fail({
        code: lookup.state === "unknown" ? "unknown-handle" : "stale-generation",
        message: `${kind} handle ${handle} is ${lookup.state}`
      });
      return void 0;
    }
    if (lookup.state === "released") return { state: "released" };
    if (lookup.record.kind !== kind) {
      this.fail({
        code: "wrong-handle-kind",
        message: `handle ${handle} is a ${lookup.record.kind}, expected ${kind}`
      });
      return void 0;
    }
    return { state: "live", record: lookup.record };
  }
  async handleSubscribe(frame) {
    const lookup = this.lookupOwned(frame.handle, "events");
    if (lookup === void 0) return;
    if (lookup.state === "released") {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(
          new ModkitError({
            code: "x3.host/rpc-released-handle",
            message: `events ${frame.handle} was released`
          }),
          this.limits
        )
      });
      return;
    }
    const target = lookup.record.target;
    if (target.subscription !== void 0) {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(
          new ModkitError({
            code: "x3.host/rpc-already-subscribed",
            message: `events ${frame.handle} already has a subscriber`
          }),
          this.limits
        )
      });
      return;
    }
    this.pumpSequence += 1;
    const subscription = `${this.ownerPrefix}s${this.generation}-${this.pumpSequence}`;
    target.subscription = subscription;
    const pump = { handle: frame.handle, stopped: false };
    this.pumps.set(subscription, pump);
    this.reply(frame.id, { kind: "return", value: subscription });
    void (async () => {
      try {
        pump.iterator = target.iterable[Symbol.asyncIterator]();
        for (; ; ) {
          const step = await pump.iterator.next();
          if (pump.stopped || this.state !== "open") return;
          if (step.done === true) break;
          const checked = validateWireValue(step.value, this.limits, "forbid");
          if (!checked.ok) {
            throw new ModkitError({
              code: "x3.host/rpc-bad-return",
              message: `event rejected: ${checked.violation.message}`
            });
          }
          this.send({ t: "event", subscription, value: step.value });
        }
        if (this.state === "open") this.send({ t: "done", handle: frame.handle });
      } catch (error) {
        if (!pump.stopped && this.state === "open") {
          this.trySend({ t: "done", handle: frame.handle, error: toErrorDto(error, this.limits) });
        }
      } finally {
        this.pumps.delete(subscription);
        await this.releaseLocal(frame.handle);
      }
    })();
  }
  handleEvent(frame) {
    const result = this.subscriptions.push(frame.subscription, frame.value);
    if (result === "queued") return;
    if (result === "unknown") {
      this.droppedEvents += 1;
      return;
    }
    this.trySend({ t: "unsubscribe", subscription: frame.subscription });
    this.closeSubscription(
      frame.subscription,
      new ModkitError({
        code: "x3.host/rpc-events-overflow",
        message: `event queue for ${frame.subscription} exceeded ${this.limits.maxQueuedEvents}`,
        retryability: "conditional"
      })
    );
  }
  handleDone(frame) {
    if (frame.inReplyTo !== void 0) {
      const entry2 = this.pending.peek(frame.inReplyTo);
      if (entry2 !== void 0 && entry2.kind !== "next" && !entry2.cancelled) {
        this.fail({ code: "unexpected-frame", message: "done received for a non-iterator call" });
        return;
      }
      this.handleSettle(frame.inReplyTo, { kind: "done" });
      this.markRemoteReleased(frame.handle);
      return;
    }
    const error = frame.error === void 0 ? void 0 : fromErrorDto(frame.error);
    for (const [id, record] of this.subscriptions.entries()) {
      if (record.handle === frame.handle) this.closeSubscription(id, error);
    }
    this.markRemoteReleased(frame.handle);
  }
  /** Puts a host-created value (signal, progress emitter) at a declared key of an object argument. */
  placeInArg(args, ref, value2) {
    while (args.length <= ref.arg) args.push(void 0);
    const holder = args[ref.arg];
    const base = typeof holder === "object" && holder !== null ? holder : {};
    args[ref.arg] = { ...base, [ref.key]: value2 };
  }
  /**
   * Copies the data properties a surface declares (`fields`) off a capability object; each must
   * be a bounded wire value without handles. Absent properties are skipped; an invalid one is a
   * bad return on the executing side (thrown as `x3.host/rpc-bad-return`).
   */
  /**
   * Protocol 1.1 `has`: which of the surface's optional methods the object implements. Undefined
   * when the surface declares none (nothing to say), so refs of such surfaces stay byte-identical
   * to protocol 1.0.
   */
  presentOptional(target, surface) {
    const methods = this.surfaces.surfaceFor(surface.contract, surface.major)?.methods;
    if (methods === void 0) return void 0;
    const optional = Object.entries(methods).filter(([, method]) => method.optional === true).map(([name]) => name);
    if (optional.length === 0) return void 0;
    if (typeof target !== "object" || target === null) return Object.freeze([]);
    return Object.freeze(
      optional.filter((name) => typeof target[name] === "function")
    );
  }
  fieldData(target, surface) {
    const fields = this.surfaces.surfaceFor(surface.contract, surface.major)?.fields;
    if (fields === void 0 || fields.length === 0) return void 0;
    if (typeof target !== "object" || target === null) return void 0;
    const data = {};
    for (const field2 of fields) {
      const value2 = target[field2];
      if (value2 === void 0) continue;
      const checked = validateWireValue(value2, this.limits, "forbid");
      if (!checked.ok) {
        throw new ModkitError({
          code: "x3.host/rpc-bad-return",
          message: `field \xAB${field2}\xBB of ${surface.contract}@${surface.major} is not a wire value: ${checked.violation.message}`
        });
      }
      data[field2] = value2;
    }
    return Object.keys(data).length === 0 ? void 0 : Object.freeze(data);
  }
  async handleRelease(frame) {
    if (!this.table.owns(frame.handle)) {
      this.fail({
        code: "unknown-handle",
        message: `release of handle ${frame.handle} this side does not own`
      });
      return;
    }
    const lookup = this.table.lookup(frame.handle);
    if (lookup.state === "unknown" || lookup.state === "foreign-generation") {
      this.fail({
        code: lookup.state === "unknown" ? "unknown-handle" : "stale-generation",
        message: `release of ${lookup.state} handle ${frame.handle}`
      });
      return;
    }
    const result = await this.table.release(frame.handle);
    for (const failure of result.failures) {
      this.report(
        "x3.host/rpc-release-failed",
        `release of ${frame.handle} failed: ${failure instanceof Error ? failure.message : String(failure)}`
      );
    }
    this.reply(frame.id, { kind: "return", value: { released: result.released } });
  }
};
function createEndpoint(options) {
  return new EndpointImpl(options);
}
function framePortFromMessagePort(port, options = {}) {
  const style = options.listener ?? (typeof port.addEventListener === "function" ? "event-target" : "emitter-value");
  const moves = (options.transfer ?? (style === "emitter-event" ? "copy" : "move")) === "move";
  return {
    post(frame, transfer) {
      if (moves) port.postMessage(frame, [...transfer]);
      else port.postMessage(frame);
    },
    onFrame(handler) {
      if (style === "event-target") {
        const listener2 = (event) => handler("data" in event ? event.data : void 0);
        port.addEventListener?.("message", listener2);
        port.start?.();
        return () => port.removeEventListener?.("message", listener2);
      }
      const listener = style === "emitter-value" ? (payload) => handler(payload) : (payload) => handler(
        typeof payload === "object" && payload !== null && "data" in payload ? payload.data : payload
      );
      port.on?.("message", listener);
      port.start?.();
      return () => port.off?.("message", listener);
    }
  };
}
function walkStrings(value2, max) {
  if (typeof value2 === "string") {
    return value2.length > max ? `a string is longer than ${max}` : void 0;
  }
  if (Array.isArray(value2)) {
    for (const item of value2) {
      const problem = walkStrings(item, max);
      if (problem !== void 0) return problem;
    }
    return void 0;
  }
  if (typeof value2 === "object" && value2 !== null && !(value2 instanceof Uint8Array)) {
    for (const [key2, item] of Object.entries(value2)) {
      if (key2.length > max) return `a key is longer than ${max}`;
      const problem = walkStrings(item, max);
      if (problem !== void 0) return problem;
    }
  }
  return void 0;
}
function countBytes(value2) {
  if (value2 instanceof Uint8Array) return value2.byteLength;
  if (Array.isArray(value2)) return value2.reduce((sum, item) => sum + countBytes(item), 0);
  if (typeof value2 === "object" && value2 !== null) {
    return Object.values(value2).reduce((sum, item) => sum + countBytes(item), 0);
  }
  return 0;
}
function limitValidators(limits) {
  const { maxStringLength, maxBytes, maxPageItems } = limits;
  const validateArgs = maxStringLength === void 0 ? void 0 : (args) => walkStrings(args, maxStringLength);
  const validateReturn = maxStringLength === void 0 && maxBytes === void 0 && maxPageItems === void 0 ? void 0 : (value2) => {
    if (maxStringLength !== void 0) {
      const problem = walkStrings(value2, maxStringLength);
      if (problem !== void 0) return problem;
    }
    if (maxBytes !== void 0 && countBytes(value2) > maxBytes) {
      return `result carries more than ${maxBytes} bytes`;
    }
    if (maxPageItems !== void 0 && typeof value2 === "object" && value2 !== null && !Array.isArray(value2) && Array.isArray(value2.items) && value2.items.length > maxPageItems) {
      return `page carries more than ${maxPageItems} items`;
    }
    return void 0;
  };
  return {
    ...validateArgs === void 0 ? {} : { validateArgs },
    ...validateReturn === void 0 ? {} : { validateReturn }
  };
}
function methodSurfaceFrom(method) {
  return {
    kind: method.kind,
    ...method.kind === "lease" ? {
      result: { contract: method.result.contract, major: method.result.major },
      ...method.wrapper === void 0 ? {} : { wrapper: method.wrapper }
    } : {},
    ...method.signal === void 0 ? {} : { signal: method.signal },
    ...method.progress === void 0 ? {} : { progress: method.progress },
    ...method.arity === void 0 ? {} : { arity: method.arity },
    ...method.optional === void 0 ? {} : { optional: method.optional },
    ...method.limits === void 0 ? {} : limitValidators(method.limits)
  };
}
function capabilitySurfaceFromDataSource(contract, major, surface) {
  const methods = {};
  for (const [name, method] of Object.entries(surface.methods)) {
    methods[name] = methodSurfaceFrom(method);
  }
  return {
    contract,
    major,
    methods,
    ...surface.releaseVia === void 0 ? {} : { releaseVia: surface.releaseVia },
    ...surface.fields === void 0 ? {} : { fields: [...surface.fields] }
  };
}
function standardDataSourceCapabilitySurfaces() {
  const out = [];
  for (const table of [
    STANDARD_DATA_SOURCE_SURFACES,
    AUXILIARY_DATA_SOURCE_SURFACES,
    STANDARD_EDITING_SURFACES
  ]) {
    for (const [contract, surface] of Object.entries(table)) {
      out.push(capabilitySurfaceFromDataSource(contract, 1, surface));
    }
  }
  return out;
}
function createStandardSurfaceRegistry(options = {}) {
  const byKey = /* @__PURE__ */ new Map();
  const add = (surface, override) => {
    const key2 = `${surface.contract}@${surface.major}`;
    if (!override && byKey.has(key2)) return;
    byKey.set(key2, surface);
  };
  for (const surface of standardDataSourceCapabilitySurfaces()) add(surface, true);
  for (const surface of RUNTIME_ABI_SURFACES) add(surface, true);
  for (const definition of options.definitions ?? []) {
    if (definition.surface === void 0) continue;
    add(
      capabilitySurfaceFromDataSource(definition.contract, definition.major, definition.surface),
      false
    );
  }
  for (const surface of options.surfaces ?? []) add(surface, false);
  return createSurfaceRegistry([...byKey.values()]);
}
var SUBJECT_SERVICES = Object.freeze({ contract: "x3.app/subject-services", major: 1 });
var SUBJECT_EDITING = Object.freeze({ contract: "x3.app/subject-editing", major: 1 });
var SUBJECT_SERVICES_URL = "x3-app://subject-services";
var subjectServicesSurface = {
  ...SUBJECT_SERVICES,
  methods: {
    /** `open(path)` → an inert snapshot (opened carries a `sessionId` to attach). */
    open: { kind: "value", signal: "last" },
    /** `attach(sessionId)` → the live session under `x3.abi/asset-session@1`. */
    attach: { kind: "lease", result: ABI_ASSET_SESSION, wrapper: "bare" },
    /** `edit(sessionId)` → the editing arm, when this host can write this subject. */
    edit: { kind: "lease", result: SUBJECT_EDITING, wrapper: "bare" }
  }
};
var subjectEditingSurface = {
  ...SUBJECT_EDITING,
  releaseVia: "dispose",
  methods: {
    state: { kind: "value" },
    propose: { kind: "value", signal: "last", arity: 1 },
    plan: { kind: "value", signal: "last", arity: 1 },
    prepare: { kind: "value", signal: "last", arity: 1 },
    commit: { kind: "value", signal: "last", arity: 1 },
    dispose: { kind: "value" }
  }
};
function subjectRpcSurfaces() {
  return createStandardSurfaceRegistry({
    surfaces: [subjectServicesSurface, subjectEditingSurface]
  });
}
var SUBJECT_RPC_LIMITS = protocolLimits({ defaultCallDeadlineMs: 6e4 });
function resolveFramePort(options) {
  if (options.framePort !== void 0) return options.framePort;
  if (options.port === void 0) {
    throw new TypeError("subject RPC needs either a port or a framePort");
  }
  return framePortFromMessagePort(
    options.port,
    options.listener === void 0 ? {} : { listener: options.listener }
  );
}
async function connectSubjectRpc(options) {
  const endpoint = createEndpoint({
    role: "host",
    port: resolveFramePort(options),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectRpcSurfaces(),
    limits: SUBJECT_RPC_LIMITS,
    ...options.onDiagnostic === void 0 ? {} : {
      onDiagnostic: (diagnostic18) => options.onDiagnostic?.(diagnostic18)
    },
    onFailure: (failure) => {
      options.onDiagnostic?.({
        code: "x3.app/subject-rpc-failed",
        message: `${failure.code}: ${failure.message}`
      });
    }
  });
  const loaded = await endpoint.load({
    moduleUrl: options.moduleUrl ?? SUBJECT_SERVICES_URL,
    contributionId: options.contributionId ?? "org.modkitx.app/subject-services",
    variantId: "main",
    artifactDigest: "sha256:app-composition"
  });
  const services = endpoint.materialize(loaded.root);
  return {
    async open(path) {
      const snapshot2 = await services.open(path);
      if (snapshot2.state !== "opened") return { state: "unresolved", snapshot: snapshot2 };
      const proxy = await services.attach(snapshot2.sessionId);
      const session = {
        ...snapshot2.presentation === void 0 ? {} : { presentation: snapshot2.presentation },
        // the descriptor already crossed inside the snapshot; asking again would re-run the codec
        descriptor: async () => snapshot2.descriptor,
        dataSource: (contract, major) => proxy.dataSource(contract, major),
        operations: () => proxy.operations(),
        dispose: () => proxy.dispose()
      };
      return { state: "opened", snapshot: snapshot2, session };
    },
    edit: (sessionId) => services.edit(sessionId),
    close: (reason) => endpoint.close(reason)
  };
}
var HOST_RAW_WRITER_IDENTITY = Object.freeze({
  providerId: "org.modkitx.host/raw-writer",
  providerVersion: "1.0.0",
  artifactDigest: "host:raw-writer",
  formatId: "*",
  representationId: "source"
});
var RAW_CLAIM = Object.freeze({
  roundTrip: "byte-identical",
  preservesUnknownData: true
});
var HOST_RAW_WRITER_EVIDENCE_ID = "host:raw-writer/by-construction";
var HOST_RAW_WRITER_EVIDENCE_RECORD = Object.freeze({
  writer: HOST_RAW_WRITER_IDENTITY,
  claim: RAW_CLAIM,
  evidenceId: HOST_RAW_WRITER_EVIDENCE_ID,
  corpusId: "by-construction: literal replacement, no re-encoding",
  corpusDigest: "none:by-construction",
  conformanceProfile: "org.modkitx/raw-writer-v1",
  optionsFingerprint: "options:none",
  inputClass: "any",
  provenAt: "2026-08-19T00:00:00Z"
});
var GUARANTEE_STRENGTH = Object.freeze({
  "best-effort": 0,
  recoverable: 1,
  transactional: 2,
  atomic: 3
});
var NO_STAGED_PAYLOADS = Object.freeze({
  async open(ref) {
    throw new ModkitError({
      code: "x3.host/edit-payload-unavailable",
      message: `no payload store can open staged payload \xAB${ref.handleId}\xBB`
    });
  }
});
var DEFAULT_INLINE_PAYLOAD_BYTES = 16 * 1024 * 1024;
var DEFAULT_CHUNK_BYTES = 64 * 1024;

// packages/host/dist/execution/index.js
var WIRE_TYPED_ARRAYS2 = Object.freeze({
  bytes: Uint8Array,
  i8: Int8Array,
  u8c: Uint8ClampedArray,
  i16: Int16Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  i64: BigInt64Array,
  u64: BigUint64Array
});
function wireTypedArrayCode2(view) {
  for (const [code, constructor] of Object.entries(WIRE_TYPED_ARRAYS2)) {
    if (view.constructor === constructor) return code;
  }
  return void 0;
}
var DEFAULT_PROTOCOL_LIMITS2 = Object.freeze({
  maxDepth: 32,
  maxNodes: 2e5,
  maxStringLength: 4 * 1024 * 1024,
  maxArrayLength: 1e5,
  maxObjectKeys: 1e4,
  maxTransferBytes: 64 * 1024 * 1024,
  maxArgs: 16,
  maxPendingCalls: 256,
  maxHandles: 4096,
  maxIterators: 256,
  maxSubscriptions: 64,
  maxQueuedEvents: 1024,
  defaultCallDeadlineMs: 3e4,
  iteratorBatchItems: 1
});
var MAX_ERROR_MESSAGE2 = 8 * 1024;
var TAG = "$x3";
function base64Of(bytes) {
  if (typeof Buffer === "function") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}
function bytesOf(base64) {
  if (typeof Buffer === "function") return new Uint8Array(Buffer.from(base64, "base64"));
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}
var SHARED2 = typeof SharedArrayBuffer === "function" ? SharedArrayBuffer : void 0;
function own(target, key, value2) {
  Object.defineProperty(target, key, {
    value: value2,
    enumerable: true,
    writable: true,
    configurable: true
  });
}
var LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function toLittleEndian(bytes, elementSize) {
  if (LITTLE_ENDIAN || elementSize < 2) return bytes;
  const out = new Uint8Array(bytes.byteLength);
  for (let start = 0; start < bytes.byteLength; start += elementSize) {
    for (let index = 0; index < elementSize; index += 1) {
      out[start + index] = bytes[start + elementSize - 1 - index] ?? 0;
    }
  }
  return out;
}
function bytesView(view) {
  if (SHARED2 !== void 0 && view.buffer instanceof SHARED2) {
    throw new TypeError("json transport: cannot carry a typed array over a shared buffer");
  }
  if (view.byteOffset !== 0 || view.byteLength !== view.buffer.byteLength) {
    throw new TypeError("json transport: cannot carry a partial typed-array view");
  }
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
function encodeJsonValue(value2) {
  if (typeof value2 === "bigint") return { [TAG]: "bigint", value: value2.toString(10) };
  if (typeof value2 === "number") {
    if (Object.is(value2, -0)) return { [TAG]: "number", value: "-0" };
    if (Number.isNaN(value2)) return { [TAG]: "number", value: "NaN" };
    if (value2 === Number.POSITIVE_INFINITY) return { [TAG]: "number", value: "Infinity" };
    if (value2 === Number.NEGATIVE_INFINITY) return { [TAG]: "number", value: "-Infinity" };
    return value2;
  }
  if (ArrayBuffer.isView(value2)) {
    const code = wireTypedArrayCode2(value2);
    if (code === void 0) {
      throw new TypeError(`json transport: ${value2.constructor.name} is not a wire value`);
    }
    const bytes = toLittleEndian(bytesView(value2), WIRE_TYPED_ARRAYS2[code].BYTES_PER_ELEMENT);
    return { [TAG]: code, base64: base64Of(bytes) };
  }
  if (value2 instanceof ArrayBuffer) {
    return { [TAG]: "bytes", base64: base64Of(new Uint8Array(value2)) };
  }
  if (Array.isArray(value2)) {
    return value2.map((item) => item === void 0 ? null : encodeJsonValue(item));
  }
  if (typeof value2 === "object" && value2 !== null) {
    const out = {};
    for (const [key, item] of Object.entries(value2)) {
      if (item === void 0) continue;
      own(out, key, encodeJsonValue(item));
    }
    return Object.prototype.hasOwnProperty.call(value2, TAG) ? { [TAG]: "object", value: out } : out;
  }
  return value2;
}
var isWireTypedArrayCode = (tag) => Object.prototype.hasOwnProperty.call(WIRE_TYPED_ARRAYS2, tag);
function decodeTypedArray(code, base64) {
  const constructor = WIRE_TYPED_ARRAYS2[code];
  const bytes = bytesOf(base64);
  const elementSize = constructor.BYTES_PER_ELEMENT;
  if (bytes.byteLength % elementSize !== 0) return void 0;
  const ordered = toLittleEndian(bytes, elementSize);
  return new constructor(ordered.buffer);
}
function decodeJsonValue(value2) {
  if (Array.isArray(value2)) return value2.map(decodeJsonValue);
  if (typeof value2 === "object" && value2 !== null) {
    const record = value2;
    const tag = record[TAG];
    if (typeof tag === "string" && Object.keys(record).length === 2) {
      if (tag === "bigint" && typeof record["value"] === "string" && /^-?\d+$/u.test(record["value"])) {
        return BigInt(record["value"]);
      }
      if (isWireTypedArrayCode(tag) && typeof record["base64"] === "string") {
        const decoded = decodeTypedArray(tag, record["base64"]);
        if (decoded !== void 0) return decoded;
      }
      if (tag === "number" && typeof record["value"] === "string") {
        switch (record["value"]) {
          case "-0":
            return -0;
          case "NaN":
            return Number.NaN;
          case "Infinity":
            return Number.POSITIVE_INFINITY;
          case "-Infinity":
            return Number.NEGATIVE_INFINITY;
          default:
            break;
        }
      }
      if (tag === "object" && typeof record["value"] === "object" && record["value"] !== null) {
        return decodeJsonValue(record["value"]);
      }
    }
    const out = {};
    for (const [key, item] of Object.entries(record)) own(out, key, decodeJsonValue(item));
    return out;
  }
  return value2;
}
function encodeFrameJson(frame) {
  return JSON.stringify(encodeJsonValue(frame));
}
function decodeFrameJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  return decodeJsonValue(parsed);
}
function framePortFromJsonPort(port) {
  return {
    post(frame) {
      port.send(encodeFrameJson(frame));
    },
    onFrame(handler) {
      return port.onMessage((text) => handler(decodeFrameJson(text)));
    }
  };
}
var ABI_CODEC_MODULE2 = { contract: "x3.abi/codec-module", major: 1 };
var ABI_SERVICE_PROVIDER_MODULE2 = {
  contract: "x3.abi/service-provider-module",
  major: 1
};
var ABI_CODEC2 = { contract: "x3.abi/codec", major: 1 };
var ABI_ASSET_SESSION2 = { contract: "x3.abi/asset-session", major: 1 };
var ABI_OPERATION_SESSION2 = { contract: "x3.abi/operation-session", major: 1 };
var ABI_ARTIFACT_SOURCE2 = { contract: "x3.abi/artifact-source", major: 1 };
var ABI_ASSET_NAMESPACE2 = { contract: "x3.abi/asset-namespace", major: 1 };
var ABI_ASSET_INPUT2 = { contract: "x3.abi/asset-input", major: 1 };
var ABI_DIAGNOSTIC_SINK2 = { contract: "x3.abi/diagnostic-sink", major: 1 };
var ABI_CONTRACT_RESOLVER2 = { contract: "x3.abi/contract-resolver", major: 1 };
var sig3 = { signal: "last" };
var codecModuleSurface2 = {
  ...ABI_CODEC_MODULE2,
  fields: ["abiVersion"],
  methods: {
    /** `createCodec(context)` — the backend marshals `context` (budgets copied, ports as refs). */
    createCodec: { kind: "lease", result: ABI_CODEC2, wrapper: "bare" }
  }
};
var serviceProviderModuleSurface2 = {
  ...ABI_SERVICE_PROVIDER_MODULE2,
  fields: ["abiVersion", "provides"],
  methods: {
    /**
     * `createProvider(selection, context)` — the leased provider's surface is the one the
     * selection names (its contract definition's `surface`); `context` is marshalled like
     * `createCodec`'s. Returns a `Lease`: releasing the handle releases the provider.
     */
    createProvider: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } }
    }
  }
};
var codecSurface2 = {
  ...ABI_CODEC2,
  methods: {
    probe: { kind: "value", ...sig3 },
    planInput: { kind: "value", optional: true, ...sig3 },
    open: { kind: "lease", result: ABI_ASSET_SESSION2, wrapper: "bare", ...sig3 }
  }
};
var assetSessionSurface2 = {
  ...ABI_ASSET_SESSION2,
  fields: ["revision"],
  releaseVia: "dispose",
  methods: {
    state: { kind: "value" },
    descriptor: { kind: "value" },
    /** `dataSource(contract, major)` — the leased surface is named by the arguments. */
    dataSource: {
      kind: "lease",
      resultFromArgs: { contract: 0, major: 1 },
      wrapper: "lease"
    },
    operations: { kind: "lease", result: ABI_OPERATION_SESSION2, wrapper: "bare" },
    events: { kind: "events", ...sig3 },
    dispose: { kind: "value" }
  }
};
var operationSessionSurface2 = {
  ...ABI_OPERATION_SESSION2,
  releaseVia: "dispose",
  methods: {
    invoke: {
      kind: "value",
      signal: { arg: 2, key: "signal" },
      progress: { arg: 2, key: "onProgress" }
    },
    dispose: { kind: "value" }
  }
};
var artifactSourceSurface2 = {
  ...ABI_ARTIFACT_SOURCE2,
  fields: ["ref", "revision", "kind", "size"],
  methods: {
    read: { kind: "value", optional: true, ...sig3 },
    stream: { kind: "iterable", optional: true, ...sig3 },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE2,
      wrapper: "lease",
      optional: true,
      ...sig3
    }
  }
};
var assetNamespaceSurface2 = {
  ...ABI_ASSET_NAMESPACE2,
  methods: {
    list: { kind: "iterable", ...sig3 },
    open: { kind: "lease", result: ABI_ARTIFACT_SOURCE2, wrapper: "lease", ...sig3 }
  }
};
var assetInputSurface2 = {
  ...ABI_ASSET_INPUT2,
  // topology data as fields: physical bindings, the namespace/derived discriminants, the derived
  // subject list and its optional materialized requirement/recipe
  fields: [
    "originKind",
    "root",
    "bindings",
    "revisions",
    "primaryBindingId",
    "subjects",
    "recipe",
    "materialized"
  ],
  methods: {
    openBinding: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE2,
      wrapper: "lease",
      optional: true,
      ...sig3
    },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE2,
      wrapper: "lease",
      optional: true,
      ...sig3
    },
    // derived inputs: open one input subject as a session, or the optional materialized artifact
    openSubject: {
      kind: "lease",
      result: ABI_ASSET_SESSION2,
      wrapper: "lease",
      optional: true,
      ...sig3
    },
    openMaterialized: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE2,
      wrapper: "lease",
      optional: true,
      ...sig3
    }
  }
};
var contractResolverSurface2 = {
  ...ABI_CONTRACT_RESOLVER2,
  methods: {
    resolve: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } },
      signal: { arg: 0, key: "signal" }
    },
    resolveUnknown: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } },
      signal: { arg: 0, key: "signal" }
    }
  }
};
var diagnosticSinkSurface2 = {
  ...ABI_DIAGNOSTIC_SINK2,
  methods: {
    report: { kind: "value" }
  }
};
var RUNTIME_ABI_SURFACES2 = Object.freeze([
  codecModuleSurface2,
  serviceProviderModuleSurface2,
  codecSurface2,
  assetSessionSurface2,
  operationSessionSurface2,
  artifactSourceSurface2,
  assetNamespaceSurface2,
  assetInputSurface2,
  diagnosticSinkSurface2,
  contractResolverSurface2
]);

// apps/modkit-vscode/src/bridge.ts
var isRecord = (value2) => typeof value2 === "object" && value2 !== null && !Array.isArray(value2);
function asEnvelope(value2) {
  if (!isRecord(value2) || value2["modkit"] !== 1) return void 0;
  const kind = value2["kind"];
  if (kind === "request" && typeof value2["requestId"] === "string" && isRecord(value2["request"])) {
    return value2;
  }
  if (kind === "response" && typeof value2["requestId"] === "string") {
    return value2;
  }
  if (kind === "event" && isRecord(value2["event"])) return value2;
  return void 0;
}
function createBridge(options) {
  const { channel } = options;
  const prefix = options.idPrefix ?? "shell";
  const frameSinks = /* @__PURE__ */ new Set();
  const eventSinks = /* @__PURE__ */ new Set();
  const pending = /* @__PURE__ */ new Map();
  let serving;
  let sequence = 0;
  let disposed = false;
  const send = (envelope) => {
    channel.post(encodeJsonValue(envelope));
  };
  const handleEnvelope = (envelope) => {
    if (envelope.kind === "event") {
      for (const sink of [...eventSinks]) sink(envelope.event);
      return;
    }
    if (envelope.kind === "response") {
      const waiter = pending.get(envelope.requestId);
      if (waiter === void 0) return;
      pending.delete(envelope.requestId);
      if (envelope.ok) waiter.resolve(envelope.value);
      else waiter.reject(new Error(envelope.message ?? "the other side refused without a reason"));
      return;
    }
    const handler = serving;
    if (handler === void 0) {
      send({
        modkit: 1,
        kind: "response",
        requestId: envelope.requestId,
        ok: false,
        message: "this side serves no shell requests"
      });
      return;
    }
    void handler(envelope.request).then(
      (value2) => {
        send({ modkit: 1, kind: "response", requestId: envelope.requestId, ok: true, value: value2 });
      },
      (error) => {
        send({
          modkit: 1,
          kind: "response",
          requestId: envelope.requestId,
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    );
  };
  const unsubscribe = channel.onMessage((message) => {
    if (typeof message === "string") {
      for (const sink of [...frameSinks]) sink(message);
      return;
    }
    const envelope = asEnvelope(decodeJsonValue(message));
    if (envelope === void 0) {
      options.onDiagnostic?.({
        code: "x3.app/vscode-bridge-unknown-message",
        message: "a message on the webview channel was neither an RPC frame nor a shell envelope"
      });
      return;
    }
    handleEnvelope(envelope);
  });
  const jsonPort = {
    send: (text) => {
      channel.post(text);
    },
    onMessage: (handler) => {
      frameSinks.add(handler);
      return () => frameSinks.delete(handler);
    }
  };
  const framePort = framePortFromJsonPort(jsonPort);
  return {
    framePort,
    async request(request) {
      if (disposed) throw new Error("the webview bridge is closed");
      sequence += 1;
      const requestId = `${prefix}-${sequence}`;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        send({ modkit: 1, kind: "request", requestId, request });
      });
    },
    serve(handler) {
      serving = handler;
    },
    emit(event) {
      send({ modkit: 1, kind: "event", event });
    },
    onEvent(handler) {
      eventSinks.add(handler);
      return () => eventSinks.delete(handler);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      frameSinks.clear();
      eventSinks.clear();
      for (const waiter of pending.values()) waiter.reject(new Error("the webview bridge closed"));
      pending.clear();
    }
  };
}

// apps/modkit-vscode/src/editor-ports.ts
var WEBVIEW_GRANT = Object.freeze({ snapshotId: "webview", permissions: [], sourceIds: [] });
var REFUSAL_REASONS = Object.freeze({
  "plan-invalid": "the change did not describe a valid edit of this file",
  "permission-missing": "this session may not write the file",
  "write-scope-mismatch": "the edit named a file outside what this session may write",
  "guarantee-unachievable": "the host cannot promise this write safely enough",
  "fidelity-unproven": "no evidence backs the writer fidelity claim for this change",
  "confirmation-required": "a lossy write needs a confirmation this host does not ask for",
  "payload-unavailable": "the edited bytes never reached the writer",
  "stale-revision": "the file changed on disk after the change was prepared",
  cancelled: "the save was cancelled"
});
function refusalMessage(reason) {
  const plain = REFUSAL_REASONS[reason];
  return plain === void 0 ? `save refused: ${reason}` : `save refused: ${plain} (${reason})`;
}
var diagnosticDetail = (diagnostics) => {
  const first = diagnostics?.[0]?.message;
  return first === void 0 ? "" : ` \u2014 ${first}`;
};
function prepareStatus(result) {
  if (result.state === "ready") return void 0;
  if (result.state === "conflict") {
    return {
      message: `save refused: the file changed on disk while it was open (${result.conflicts.length} conflict(s))`,
      failed: true
    };
  }
  return {
    message: `${refusalMessage(result.reason)}${diagnosticDetail(result.diagnostics)}`,
    failed: true
  };
}
function commitStatus(result) {
  switch (result.state) {
    case "committed":
      return { message: "saved", failed: false };
    case "not-applied":
      return {
        message: `${refusalMessage(result.reason ?? "unknown")}${diagnosticDetail(result.diagnostics)}`,
        failed: true
      };
    case "rolled-back":
      return {
        message: "save failed: the write was rolled back and the file is unchanged",
        failed: true
      };
    case "partially-applied":
      return { message: "save partially applied: recovery is available", failed: true };
    default:
      return { message: `save ${result.state}`, failed: true };
  }
}
async function createWebviewEditorPorts(options) {
  const { arm } = options;
  const state = await arm.state();
  const targets = state.targets;
  const preparedIds = /* @__PURE__ */ new WeakMap();
  let pending;
  const report = (status) => {
    options.onStatus?.(status.message);
  };
  const preparePlan = async (plan) => {
    const result = await arm.prepare(plan);
    const refusal = prepareStatus(result);
    if (refusal !== void 0) report(refusal);
    return result;
  };
  const commitPrepared = async (preparedId) => {
    const result = await arm.commit(preparedId);
    const status = commitStatus(result);
    report(status);
    if (result.state === "committed") {
      pending = void 0;
      options.onDirty?.(false);
    }
    return result.state === "not-applied" ? { state: result.state, status } : { state: result.state, receipt: result.receipt, status };
  };
  const session = {
    revision: state.revision,
    targets,
    state: () => pending === void 0 ? "live" : "dirty",
    propose: async (change) => {
      options.onDirty?.(true);
      return arm.propose(change);
    },
    plan: async (change) => {
      const plan = await arm.plan(change);
      pending = plan;
      options.onDirty?.(true);
      return plan;
    },
    dispose: async () => void 0
  };
  const commit = {
    async prepare(plan) {
      const result = await preparePlan(plan);
      if (result.state !== "ready") return result;
      const handle = Object.freeze({ preparedId: result.preparedId });
      preparedIds.set(handle, result.preparedId);
      return { state: "ready", prepared: handle };
    },
    async commit(prepared) {
      const preparedId = preparedIds.get(prepared) ?? prepared.preparedId;
      if (preparedId === void 0) {
        options.onStatus?.("nothing prepared to save");
        return { state: "not-applied" };
      }
      const result = await commitPrepared(preparedId);
      return result.receipt === void 0 ? { state: result.state } : { state: result.state, receipt: result.receipt };
    },
    async undo() {
      options.onStatus?.("undo is not available in this host yet");
      return { state: "not-applied" };
    },
    async redo() {
      options.onStatus?.("redo is not available in this host yet");
      return { state: "not-applied" };
    }
  };
  const payloads = {
    async open() {
      throw new Error("this host does not stage payloads: edits travel inline");
    }
  };
  const authorization = {
    async request() {
      return { grant: WEBVIEW_GRANT };
    }
  };
  return {
    edit: session,
    commit,
    payloads,
    authorization,
    async save() {
      if (pending === void 0) return true;
      const prepared = await commit.prepare(pending);
      const ready = prepared;
      if (ready.state !== "ready" || ready.prepared === void 0) return false;
      return (await commit.commit(ready.prepared)).state === "committed";
    },
    async applyPlan(plan) {
      try {
        const prepared = await preparePlan(plan);
        if (prepared.state !== "ready") {
          return prepareStatus(prepared) ?? { message: "save refused", failed: true };
        }
        return (await commitPrepared(prepared.preparedId)).status;
      } catch (error) {
        const status = {
          message: `the host refused the plan: ${error instanceof Error ? error.message : String(error)}`,
          failed: true
        };
        report(status);
        return status;
      }
    },
    dispose: () => arm.dispose()
  };
}

// apps/modkit-vscode/src/edit-reopen.ts
async function reopenCommittedEntry(editors, entry) {
  if (!await editors.close(entry.id)) return false;
  await editors.open(entry);
  return true;
}

// packages/ui/dist/audio/index.js
var PARTS3 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET3 = new Set(PARTS3);
var PART_ATTRIBUTE3 = "data-mk-part";
var STATE_ATTRIBUTE3 = "data-mk-state";
var STATES3 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET3 = new Set(STATES3);
function setPart3(element22, part) {
  if (!PART_SET3.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE3, part);
}
function setState3(element22, states) {
  for (const state of states) {
    if (!STATE_SET3.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE3);
  else element22.setAttribute(STATE_ATTRIBUTE3, [...new Set(states)].join(" "));
}
var VIEWER_CSP3 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR3 = Object.freeze({
  ...VIEWER_CSP3,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText3 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT3 = policyText3(VIEWER_CSP3);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT3 = policyText3(VIEWER_CSP_TRUSTED_EDITOR3);
var HOSTILE_TEXT3 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText3(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT3, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText2(node, value2, maximum) {
  node.textContent = safeViewerText3(value2, maximum);
}
function requireContainer(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface(container, label) {
  const host = requireContainer(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart3(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element2(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText2(node, options.text);
  if (options.part !== void 0) setPart3(node, options.part);
  if (options.state !== void 0) setState3(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText3(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule(module) {
  return Object.freeze(module);
}
function unknownSourceLease(sources, slot, contract) {
  const binding = bindingFor(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
async function collectEncodedMedia(source, maximumBytes, signal) {
  const descriptor = await source.descriptor();
  if (descriptor.bytes > BigInt(maximumBytes) || descriptor.bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`encoded media exceeds the stage budget: ${descriptor.bytes} bytes`);
  }
  const total = Number(descriptor.bytes);
  const bytes = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
    const chunk = await source.read(BigInt(offset), Math.min(1024 * 1024, total - offset), signal);
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError("encoded media ended outside its declared size");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { mediaType: descriptor.mediaType, bytes };
}
var AUDIO_MAXIMUM_BYTES = 96 * 1024 * 1024;
var WAVEFORM_BUCKETS = 900;
function computePeaks(channelData, buckets) {
  const frames = channelData[0]?.length ?? 0;
  const peaks = new Float32Array(buckets * 2);
  if (frames === 0) return peaks;
  const step = Math.max(1, Math.floor(frames / buckets));
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = bucket * step;
    const to = Math.min(frames, from + step);
    let minimum = 0;
    let maximum = 0;
    for (const channel of channelData) {
      for (let at = from; at < to; at += 1) {
        const value2 = channel[at];
        if (value2 < minimum) minimum = value2;
        if (value2 > maximum) maximum = value2;
      }
    }
    peaks[bucket * 2] = minimum;
    peaks[bucket * 2 + 1] = maximum;
  }
  return peaks;
}
async function loadWaveform(source, signal) {
  const encoded = await source.encoded(void 0, signal);
  const media = await collectEncodedMedia(encoded, AUDIO_MAXIMUM_BYTES, signal);
  const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (AudioContextCtor === void 0) throw new TypeError("no platform audio decoder is available");
  const context = new AudioContextCtor();
  try {
    const copy = media.bytes.slice().buffer;
    const buffer = await context.decodeAudioData(copy);
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, index) => buffer.getChannelData(index)
    );
    return {
      model: {
        peaks: computePeaks(channels, WAVEFORM_BUCKETS),
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
        bytes: media.bytes.byteLength
      },
      mediaType: media.mediaType,
      bytes: media.bytes
    };
  } finally {
    await context.close();
  }
}
var clock = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};
var audioViewer = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal);
    const root2 = createSurface(args.container, "Audio viewer");
    const stage = element2(root2, "div", { part: "audio" });
    const toolbar = element2(stage, "div", { part: "audio.toolbar", role: "toolbar" });
    toolbar.setAttribute("aria-label", "Audio controls");
    const readout = element2(stage, "output", { part: "audio.readout" });
    const canvas = element2(stage, "canvas", { part: "audio.waveform" });
    canvas.setAttribute("role", "img");
    const player = element2(stage, "audio", { part: "audio.player" });
    player.controls = true;
    const lease = await unknownSourceLease(
      args.sources,
      args.slot,
      "common.view/audio-media-source"
    );
    if (lease === void 0) throw new TypeError("audio binding is unavailable");
    scope.lease(lease);
    let model;
    let cursor2 = 0;
    const context = canvas.getContext("2d");
    if (context === null) throw new TypeError("2d canvas context is unavailable");
    const paint = () => {
      if (model === void 0) return;
      const box = stage.getBoundingClientRect();
      const width = Math.max(160, Math.round(box.width - 16));
      const height = 120;
      canvas.width = width;
      canvas.height = height;
      const styles = getComputedStyle(root2);
      const ink = styles.getPropertyValue("--mk-chart-categorical-1").trim() || "#4daafc";
      const ground = styles.getPropertyValue("--mk-color-sunken").trim() || "#181818";
      const guide = styles.getPropertyValue("--mk-color-border").trim() || "#2b2b2b";
      context.fillStyle = ground;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = guide;
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
      context.fillStyle = ink;
      const buckets = model.peaks.length / 2;
      for (let x = 0; x < width; x += 1) {
        const bucket = Math.min(buckets - 1, Math.floor(x / width * buckets));
        const minimum = model.peaks[bucket * 2];
        const maximum = model.peaks[bucket * 2 + 1];
        const top = (1 - maximum) * (height / 2);
        const bottom = (1 - minimum) * (height / 2);
        context.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
      if (cursor2 > 0 && model.duration > 0) {
        context.fillStyle = styles.getPropertyValue("--mk-color-accent").trim() || "#0078d4";
        context.fillRect(Math.round(cursor2 / model.duration * width), 0, 2, height);
      }
      setViewerText2(
        readout,
        `${clock(cursor2)} / ${clock(model.duration)} \xB7 ${model.channels}ch \xB7 ${(model.sampleRate / 1e3).toFixed(1)} kHz \xB7 ${(model.bytes / 1024).toFixed(0)} KiB`
      );
    };
    canvas.addEventListener("click", (event) => {
      if (model === void 0) return;
      const box = canvas.getBoundingClientRect();
      cursor2 = (event.clientX - box.left) / box.width * model.duration;
      paint();
    });
    setState3(stage, ["loading"]);
    try {
      const loaded = await loadWaveform(lease.value, scope.signal);
      model = loaded.model;
      const objectUrl = URL.createObjectURL(
        new Blob([loaded.bytes], { type: loaded.mediaType })
      );
      player.src = objectUrl;
      scope.cleanup(() => URL.revokeObjectURL(objectUrl));
      setState3(stage, []);
      paint();
    } catch (error) {
      setState3(stage, ["error"]);
      canvas.remove();
      player.remove();
      element2(stage, "p", {
        part: "viewer.empty",
        text: `The platform decoder cannot render this audio: ${error instanceof Error ? error.message : String(error)}. A format-specific decoder provider is required.`
      });
    }
    return createViewerMount(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
      paint();
    });
  }
});

// packages/ui/dist/code/index.js
var PARTS4 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET4 = new Set(PARTS4);
var PART_ATTRIBUTE4 = "data-mk-part";
var STATE_ATTRIBUTE4 = "data-mk-state";
var STATES4 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET4 = new Set(STATES4);
function setPart4(element22, part) {
  if (!PART_SET4.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE4, part);
}
function setState4(element22, states) {
  for (const state of states) {
    if (!STATE_SET4.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE4);
  else element22.setAttribute(STATE_ATTRIBUTE4, [...new Set(states)].join(" "));
}
var VIEWER_CSP4 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR4 = Object.freeze({
  ...VIEWER_CSP4,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText4 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT4 = policyText4(VIEWER_CSP4);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT4 = policyText4(VIEWER_CSP_TRUSTED_EDITOR4);
var HOSTILE_TEXT4 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText4(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT4, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText3(node, value2, maximum) {
  node.textContent = safeViewerText4(value2, maximum);
}
function requireContainer2(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface2(container, label) {
  const host = requireContainer2(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart4(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element3(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText3(node, options.text);
  if (options.part !== void 0) setPart4(node, options.part);
  if (options.state !== void 0) setState4(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor2(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope2 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount2(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText4(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule2(module) {
  return Object.freeze(module);
}
function unknownSourceLease2(sources, slot, contract) {
  const binding = bindingFor2(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var MAX_MATERIALIZED_BYTES = 16 * 1024 * 1024;
var MAX_MATERIALIZED_LINE_BYTES = 1024 * 1024;
var BoundedTextModel = class {
  constructor(source) {
    this.source = source;
  }
  source;
  async load(signal) {
    const info = await this.source.info();
    if (info.bytes > BigInt(MAX_MATERIALIZED_BYTES) || info.longestLineBytes === "unknown" || info.longestLineBytes > MAX_MATERIALIZED_LINE_BYTES) {
      throw new RangeError("bounded text policy rejected this source");
    }
    const slice = await this.source.slice(
      {
        kind: "from-line",
        line: 0,
        lineCount: info.lines === "unknown" ? Number.MAX_SAFE_INTEGER : Math.max(1, info.lines),
        maxBytes: MAX_MATERIALIZED_BYTES
      },
      signal
    );
    if (!slice.complete) throw new RangeError("bounded text source exceeded materialization limit");
    return slice.text;
  }
  async search(pattern, signal) {
    let matches2 = 0;
    for await (const range of this.source.search({ pattern }, signal)) {
      void range;
      matches2 += 1;
    }
    return matches2;
  }
};
var boundedTextViewer = defineViewerModule2({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope2(args.signal);
    const root2 = createSurface2(args.container, "Bounded text viewer");
    const lease = await unknownSourceLease2(args.sources, args.slot, "common.view/text-data-source");
    if (lease === void 0) throw new TypeError("bounded text binding is unavailable");
    scope.lease(lease);
    const model = new BoundedTextModel(lease.value);
    const toolbar = element3(root2, "div", {
      className: "modkit-viewer__toolbar",
      role: "search",
      part: "viewer.toolbar"
    });
    const search = element3(toolbar, "input");
    search.type = "search";
    search.setAttribute("aria-label", "Search text");
    const searchButton = element3(toolbar, "button", { text: "Search" });
    searchButton.type = "button";
    const status = element3(toolbar, "output", { text: "Ready", part: "viewer.status" });
    const content = element3(root2, "pre", { className: "modkit-viewer__code", part: "text" });
    content.tabIndex = 0;
    content.setAttribute("aria-label", "Text content");
    setViewerText3(content, await model.load(scope.signal), MAX_MATERIALIZED_BYTES);
    const runSearch = async () => {
      const pattern = safeViewerText4(search.value, 4096);
      setViewerText3(status, pattern === "" ? "Enter a search term" : "Searching\u2026");
      if (pattern === "") return;
      const matches2 = await model.search(pattern, scope.signal);
      setViewerText3(status, `${matches2} match${matches2 === 1 ? "" : "es"}`);
    };
    searchButton.addEventListener("click", runSearch);
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void runSearch();
    });
    scope.cleanup(() => searchButton.removeEventListener("click", runSearch));
    return createViewerMount2(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});

// packages/ui/dist/editor/index.js
var PARTS5 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET5 = new Set(PARTS5);
var PART_ATTRIBUTE5 = "data-mk-part";
var STATE_ATTRIBUTE5 = "data-mk-state";
var STATES5 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET5 = new Set(STATES5);
function setPart5(element22, part) {
  if (!PART_SET5.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE5, part);
}
function setState5(element22, states) {
  for (const state of states) {
    if (!STATE_SET5.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE5);
  else element22.setAttribute(STATE_ATTRIBUTE5, [...new Set(states)].join(" "));
}
var VIEWER_CSP5 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR5 = Object.freeze({
  ...VIEWER_CSP5,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText5 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT5 = policyText5(VIEWER_CSP5);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT5 = policyText5(VIEWER_CSP_TRUSTED_EDITOR5);
var HOSTILE_TEXT5 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText5(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT5, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText4(node, value2, maximum) {
  node.textContent = safeViewerText5(value2, maximum);
}
function requireContainer3(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface3(container, label) {
  const host = requireContainer3(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart5(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element4(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText4(node, options.text);
  if (options.part !== void 0) setPart5(node, options.part);
  if (options.state !== void 0) setState5(node, options.state);
  parent.append(node);
  return node;
}
var ViewerMountScope3 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
var EDITOR_SAVE_REQUEST2 = "modkit-editor-save-request";
function handleEditorSaveRequest(root2, save) {
  const listener = (event) => {
    const request = event;
    request.detail.waitUntil(save());
  };
  root2.addEventListener(EDITOR_SAVE_REQUEST2, listener);
  return () => root2.removeEventListener(EDITOR_SAVE_REQUEST2, listener);
}
var TEXT_DATA_SOURCE = Object.freeze({
  bindingId: bindingId("editor-text"),
  contract: "common.view/text-data-source",
  major: 1
});
function defineEditorModule(module) {
  return Object.freeze(module);
}
async function loadText(source, maximum, signal) {
  const info = await source.info();
  if (info.bytes > BigInt(maximum))
    throw new RangeError("editor source exceeds bounded text budget");
  const slice = await source.slice(
    {
      kind: "from-line",
      line: 0,
      lineCount: info.lines === "unknown" ? Number.MAX_SAFE_INTEGER : Math.max(1, info.lines),
      maxBytes: maximum
    },
    signal
  );
  if (!slice.complete) throw new RangeError("editor source requires a streaming editor");
  return slice.text;
}
function defaultChangeSet(text, targets) {
  return {
    targets,
    edits: targets.map((target) => ({
      operation: "replace",
      targetId: target.targetId,
      source: target.ownerSource,
      payload: { kind: "text", text },
      label: "Edit text"
    })),
    provenance: { actor: "user" }
  };
}
function rejectionText(state, reason) {
  return safeViewerText5(reason === void 0 ? state : `${state}: ${reason}`, 1024);
}
function createTextEditorModule(options = {}) {
  const maximum = options.maximumSourceBytes ?? 16 * 1024 * 1024;
  return defineEditorModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope3(args.signal);
      const root2 = createSurface3(args.container, "Text editor");
      root2.dataset["modkitEditor"] = "text";
      root2.dataset["revision"] = args.descriptor.revision;
      const lease = await args.sources.get(TEXT_DATA_SOURCE);
      if (lease === void 0) throw new TypeError("text editor data-source binding is unavailable");
      scope.lease(lease);
      const toolbar = element4(root2, "div", {
        className: "modkit-editor__toolbar",
        role: "toolbar",
        part: "editor.toolbar"
      });
      toolbar.setAttribute("aria-label", "Editing actions");
      const save = element4(toolbar, "button", { text: "Save" });
      save.dataset["modkitAction"] = "save";
      const undo = element4(toolbar, "button", { text: "Undo" });
      const redo = element4(toolbar, "button", { text: "Redo" });
      const status = element4(toolbar, "output", { text: "Ready", part: "viewer.status" });
      save.type = undo.type = redo.type = "button";
      undo.disabled = true;
      redo.disabled = true;
      const input = element4(root2, "textarea", {
        className: "modkit-editor__text",
        part: "editor.text"
      });
      input.setAttribute("aria-label", "Editable text");
      input.spellcheck = false;
      input.value = await loadText(lease.value, maximum, scope.signal);
      let busy = false;
      let lastPlan;
      let lastReceipt;
      const request = async (plan) => args.authorization.request(plan, { signal: scope.signal });
      const saveChange = async () => {
        if (busy || scope.signal.aborted) return false;
        busy = true;
        save.disabled = true;
        setViewerText4(status, "Validating\u2026");
        try {
          const change = options.createChangeSet?.({ text: input.value, targets: args.edit.targets }) ?? defaultChangeSet(input.value, args.edit.targets);
          const validation = await args.edit.propose(change);
          if (!validation.valid) {
            setViewerText4(status, "Validation rejected the change");
            return false;
          }
          const plan = await args.edit.plan(change);
          const authorization = await request(plan);
          if (authorization === void 0) {
            setViewerText4(status, "Save cancelled");
            return false;
          }
          const prepared = await args.commit.prepare(plan, {
            grant: authorization.grant,
            ...authorization.confirmationToken === void 0 ? {} : { confirmationToken: authorization.confirmationToken },
            signal: scope.signal
          });
          if (prepared.state !== "ready") {
            setViewerText4(
              status,
              prepared.state === "conflict" ? "Conflict: source changed" : rejectionText("Save rejected", prepared.reason)
            );
            return false;
          }
          setViewerText4(status, "Saving\u2026");
          const result = await args.commit.commit(prepared.prepared, {
            grant: authorization.grant,
            signal: scope.signal,
            onProgress: (done) => setViewerText4(status, `Saving\u2026 ${done}`)
          });
          if (result.state === "committed") {
            lastPlan = plan;
            lastReceipt = result.receipt;
            undo.disabled = result.receipt.undo === "none";
            redo.disabled = true;
            setViewerText4(status, "Saved");
            return true;
          } else {
            setViewerText4(
              status,
              result.state === "not-applied" ? rejectionText("Not saved", result.reason) : result.state === "rolled-back" ? "Write failed; changes rolled back" : "Partially saved; recovery is available"
            );
            return false;
          }
        } catch (error) {
          setViewerText4(status, error instanceof Error ? error.message : String(error));
          return false;
        } finally {
          busy = false;
          save.disabled = false;
        }
      };
      const replay = async (kind) => {
        if (busy || lastPlan === void 0 || lastReceipt === void 0) return;
        busy = true;
        const authorization = await request(lastPlan);
        if (authorization === void 0) {
          setViewerText4(status, `${kind === "undo" ? "Undo" : "Redo"} cancelled`);
          busy = false;
          return;
        }
        const result = await args.commit[kind](lastReceipt.transactionId, {
          grant: authorization.grant,
          signal: scope.signal
        });
        if (result.state === "committed") {
          undo.disabled = kind === "undo";
          redo.disabled = kind === "redo";
          setViewerText4(status, kind === "undo" ? "Undone" : "Redone");
        } else {
          setViewerText4(
            status,
            result.state === "not-applied" ? rejectionText(`${kind === "undo" ? "Undo" : "Redo"} rejected`, result.reason) : `${kind === "undo" ? "Undo" : "Redo"} failed`
          );
        }
        busy = false;
      };
      save.addEventListener("click", saveChange);
      const removeSaveRequest = handleEditorSaveRequest(root2, saveChange);
      undo.addEventListener("click", () => void replay("undo"));
      redo.addEventListener("click", () => void replay("redo"));
      scope.cleanup(() => {
        save.removeEventListener("click", saveChange);
        removeSaveRequest();
      });
      return Object.freeze({
        async update(update) {
          root2.dataset["revision"] = update.descriptor.revision;
          setViewerText4(status, "Source updated; review before saving");
        },
        async unmount() {
          await scope.close();
          await args.edit.dispose();
          root2.remove();
        }
      });
    }
  });
}
var textEditor = createTextEditorModule();

// packages/ui/dist/hex/index.js
var PARTS6 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET6 = new Set(PARTS6);
var PART_ATTRIBUTE6 = "data-mk-part";
var STATE_ATTRIBUTE6 = "data-mk-state";
var STATES6 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET6 = new Set(STATES6);
function setPart6(element22, part) {
  if (!PART_SET6.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE6, part);
}
function setState6(element22, states) {
  for (const state of states) {
    if (!STATE_SET6.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE6);
  else element22.setAttribute(STATE_ATTRIBUTE6, [...new Set(states)].join(" "));
}
var VIEWER_CSP6 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR6 = Object.freeze({
  ...VIEWER_CSP6,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText6 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT6 = policyText6(VIEWER_CSP6);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT6 = policyText6(VIEWER_CSP_TRUSTED_EDITOR6);
var HOSTILE_TEXT6 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText6(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT6, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText5(node, value2, maximum) {
  node.textContent = safeViewerText6(value2, maximum);
}
function requireContainer4(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface4(container, label) {
  const host = requireContainer4(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart6(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element5(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText5(node, options.text);
  if (options.part !== void 0) setPart6(node, options.part);
  if (options.state !== void 0) setState6(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor3(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope4 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount3(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText6(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule3(module) {
  return Object.freeze(module);
}
function unknownSourceLease3(sources, slot, contract) {
  const binding = bindingFor3(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var HEX_WINDOW_BYTES = 4096;
var HexWindowModel = class {
  constructor(source) {
    this.source = source;
  }
  source;
  async read(offset, signal) {
    if (offset < 0n) throw new RangeError("hex offset must be non-negative");
    const size = await this.source.size();
    if (offset > size) throw new RangeError("hex offset exceeds source size");
    const length = Number(
      size - offset > BigInt(HEX_WINDOW_BYTES) ? HEX_WINDOW_BYTES : size - offset
    );
    const bytes = await this.source.read(offset, length, signal);
    const lines = [];
    for (let index = 0; index < bytes.length; index += 16) {
      const chunk = bytes.slice(index, index + 16);
      const address = (offset + BigInt(index)).toString(16).padStart(16, "0");
      const hex = [...chunk].map((value2) => value2.toString(16).padStart(2, "0")).join(" ");
      const ascii = [...chunk].map((value2) => value2 >= 32 && value2 <= 126 ? String.fromCharCode(value2) : ".").join("");
      lines.push(`${address}  ${hex.padEnd(47)}  ${ascii}`);
    }
    return { offset, bytes, text: lines.join("\n") };
  }
};
var hexViewer = defineViewerModule3({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope4(args.signal);
    const root2 = createSurface4(args.container, "Hex viewer");
    const lease = await unknownSourceLease3(args.sources, args.slot, "common.view/byte-range-source");
    if (lease === void 0) throw new TypeError("hex binding is unavailable");
    scope.lease(lease);
    const model = new HexWindowModel(lease.value);
    const controls = element5(root2, "div", {
      className: "modkit-viewer__toolbar",
      part: "hex.toolbar"
    });
    const offset = element5(controls, "input", { part: "hex.offset-input" });
    offset.type = "text";
    offset.inputMode = "numeric";
    offset.value = "0";
    offset.setAttribute("aria-label", "Byte offset");
    const go = element5(controls, "button", { text: "Go", part: "hex.go" });
    go.type = "button";
    const content = element5(root2, "pre", { className: "modkit-viewer__hex", part: "hex.content" });
    content.tabIndex = 0;
    const render = async () => {
      const value2 = /^(?:0x)?[0-9a-f]+$/iu.test(offset.value.trim()) ? BigInt(offset.value.trim()) : -1n;
      const window2 = await model.read(value2, scope.signal);
      setViewerText5(content, window2.text);
      content.dataset["offset"] = window2.offset.toString(10);
    };
    await render();
    go.addEventListener("click", render);
    scope.cleanup(() => go.removeEventListener("click", render));
    return createViewerMount3(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});

// packages/ui/dist/hex-editor/index.js
var PARTS7 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET7 = new Set(PARTS7);
var PART_ATTRIBUTE7 = "data-mk-part";
var STATE_ATTRIBUTE7 = "data-mk-state";
var STATES7 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET7 = new Set(STATES7);
function setPart7(element22, part) {
  if (!PART_SET7.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE7, part);
}
function setState7(element22, states) {
  for (const state of states) {
    if (!STATE_SET7.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE7);
  else element22.setAttribute(STATE_ATTRIBUTE7, [...new Set(states)].join(" "));
}
var VIEWER_CSP7 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR7 = Object.freeze({
  ...VIEWER_CSP7,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText7 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT7 = policyText7(VIEWER_CSP7);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT7 = policyText7(VIEWER_CSP_TRUSTED_EDITOR7);
var HOSTILE_TEXT7 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText7(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT7, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText6(node, value2, maximum) {
  node.textContent = safeViewerText7(value2, maximum);
}
function requireContainer5(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface5(container, label) {
  const host = requireContainer5(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart7(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element6(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText6(node, options.text);
  if (options.part !== void 0) setPart7(node, options.part);
  if (options.state !== void 0) setState7(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor4(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope5 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount4(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText7(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule4(module) {
  return Object.freeze(module);
}
function unknownSourceLease4(sources, slot, contract) {
  const binding = bindingFor4(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var HEX_WINDOW_BYTES2 = 4096;
var HexWindowModel2 = class {
  constructor(source) {
    this.source = source;
  }
  source;
  async read(offset, signal) {
    if (offset < 0n) throw new RangeError("hex offset must be non-negative");
    const size = await this.source.size();
    if (offset > size) throw new RangeError("hex offset exceeds source size");
    const length = Number(
      size - offset > BigInt(HEX_WINDOW_BYTES2) ? HEX_WINDOW_BYTES2 : size - offset
    );
    const bytes = await this.source.read(offset, length, signal);
    const lines = [];
    for (let index = 0; index < bytes.length; index += 16) {
      const chunk = bytes.slice(index, index + 16);
      const address = (offset + BigInt(index)).toString(16).padStart(16, "0");
      const hex = [...chunk].map((value2) => value2.toString(16).padStart(2, "0")).join(" ");
      const ascii = [...chunk].map((value2) => value2 >= 32 && value2 <= 126 ? String.fromCharCode(value2) : ".").join("");
      lines.push(`${address}  ${hex.padEnd(47)}  ${ascii}`);
    }
    return { offset, bytes, text: lines.join("\n") };
  }
};
var hexViewer2 = defineViewerModule4({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope5(args.signal);
    const root2 = createSurface5(args.container, "Hex viewer");
    const lease = await unknownSourceLease4(args.sources, args.slot, "common.view/byte-range-source");
    if (lease === void 0) throw new TypeError("hex binding is unavailable");
    scope.lease(lease);
    const model = new HexWindowModel2(lease.value);
    const controls = element6(root2, "div", {
      className: "modkit-viewer__toolbar",
      part: "hex.toolbar"
    });
    const offset = element6(controls, "input", { part: "hex.offset-input" });
    offset.type = "text";
    offset.inputMode = "numeric";
    offset.value = "0";
    offset.setAttribute("aria-label", "Byte offset");
    const go = element6(controls, "button", { text: "Go", part: "hex.go" });
    go.type = "button";
    const content = element6(root2, "pre", { className: "modkit-viewer__hex", part: "hex.content" });
    content.tabIndex = 0;
    const render = async () => {
      const value2 = /^(?:0x)?[0-9a-f]+$/iu.test(offset.value.trim()) ? BigInt(offset.value.trim()) : -1n;
      const window2 = await model.read(value2, scope.signal);
      setViewerText6(content, window2.text);
      content.dataset["offset"] = window2.offset.toString(10);
    };
    await render();
    go.addEventListener("click", render);
    scope.cleanup(() => go.removeEventListener("click", render));
    return createViewerMount4(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});
var EDITOR_SAVE_REQUEST3 = "modkit-editor-save-request";
function handleEditorSaveRequest2(root2, save) {
  const listener = (event) => {
    const request = event;
    request.detail.waitUntil(save());
  };
  root2.addEventListener(EDITOR_SAVE_REQUEST3, listener);
  return () => root2.removeEventListener(EDITOR_SAVE_REQUEST3, listener);
}
var BYTE_RANGE_SOURCE = Object.freeze({
  bindingId: bindingId("editor-hex"),
  contract: "common.view/byte-range-source",
  major: 1
});
var HEX_BYTE = /^[0-9a-f]{1,2}$/iu;
function hexChangeSet(runs, targets) {
  const target = targets[0];
  if (target === void 0) throw new TypeError("the edit session carries no target to write to");
  return {
    targets,
    edits: runs.map((run) => ({
      operation: "replace",
      targetId: target.targetId,
      source: target.ownerSource,
      range: { kind: "bytes", offset: run.offset, length: BigInt(run.bytes.length) },
      payload: { kind: "inline", bytes: run.bytes },
      label: "Edit bytes"
    })),
    provenance: { actor: "user" }
  };
}
function coalesceHexEdits(edits) {
  const sorted = [...edits].sort((left, right) => left.offset < right.offset ? -1 : 1);
  const runs = [];
  for (const edit of sorted) {
    const last = runs[runs.length - 1];
    if (last !== void 0 && last.offset + BigInt(last.values.length) === edit.offset) {
      last.values.push(edit.after);
      continue;
    }
    runs.push({ offset: edit.offset, values: [edit.after] });
  }
  return runs.map((run) => ({ offset: run.offset, bytes: new Uint8Array(run.values) }));
}
var hexEditor = {
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope5(args.signal);
    const root2 = createSurface5(args.container, "Hex editor");
    root2.dataset["modkitEditor"] = "hex";
    const lease = await args.sources.get(BYTE_RANGE_SOURCE);
    if (lease === void 0) throw new TypeError("hex editor binding is unavailable");
    scope.lease(lease);
    const source = lease.value;
    const model = new HexWindowModel2(source);
    const toolbar = element6(root2, "div", { part: "hex.toolbar", role: "toolbar" });
    toolbar.setAttribute("aria-label", "Hex editing");
    const offsetInput = element6(toolbar, "input", { part: "hex.offset-input" });
    offsetInput.type = "text";
    offsetInput.value = "0";
    offsetInput.setAttribute("aria-label", "Byte offset");
    const go = element6(toolbar, "button", { text: "Go", part: "hex.go" });
    go.type = "button";
    const save = element6(toolbar, "button", {
      text: "Save",
      part: "operations.button"
    });
    save.type = "button";
    save.dataset["modkitAction"] = "save";
    save.disabled = true;
    const revert = element6(toolbar, "button", {
      text: "Revert",
      part: "operations.button"
    });
    revert.type = "button";
    revert.disabled = true;
    const status = element6(toolbar, "output", { text: "Ready", part: "viewer.status" });
    const grid = element6(root2, "div", { part: "hex.content" });
    grid.setAttribute("role", "grid");
    let windowOffset = 0n;
    let original = new Uint8Array();
    const pending = /* @__PURE__ */ new Map();
    const hexCells = /* @__PURE__ */ new Map();
    const asciiCells = /* @__PURE__ */ new Map();
    const printable = (value2) => value2 >= 32 && value2 <= 126 ? String.fromCharCode(value2) : ".";
    const announce = () => {
      if (pending.size === 0) return;
      const runs = coalesceHexEdits([...pending.values()]);
      void args.edit.propose(hexChangeSet(runs, args.edit.targets));
    };
    const setByte = (absolute, base, next) => {
      const key = absolute.toString(10);
      if (next === base) pending.delete(key);
      else pending.set(key, { offset: absolute, before: base, after: next });
      const hex = hexCells.get(key);
      if (hex !== void 0) {
        hex.textContent = next.toString(16).padStart(2, "0");
        setState7(hex, next === base ? [] : ["mutating"]);
      }
      const ascii = asciiCells.get(key);
      if (ascii !== void 0) {
        ascii.textContent = printable(next);
        setState7(ascii, next === base ? [] : ["mutating"]);
      }
      syncDirty();
      announce();
    };
    const syncDirty = () => {
      const dirty = pending.size > 0;
      save.disabled = !dirty;
      revert.disabled = !dirty;
      setState7(root2, dirty ? ["mutating"] : []);
      setViewerText6(status, dirty ? `${pending.size} byte(s) changed` : "Ready");
    };
    const renderWindow = async () => {
      const raw = offsetInput.value.trim();
      const parsed = /^(?:0x)?[0-9a-f]+$/iu.test(raw) ? BigInt(raw) : 0n;
      const view = await model.read(parsed, scope.signal);
      windowOffset = view.offset;
      original = view.bytes;
      pending.clear();
      drawWindow();
    };
    const drawWindow = () => {
      grid.replaceChildren();
      for (let row = 0; row < original.length; row += 16) {
        const line = element6(grid, "div", { part: "hex.row" });
        line.setAttribute("role", "row");
        const address = (windowOffset + BigInt(row)).toString(16).padStart(16, "0");
        element6(line, "span", { text: address, part: "hex.gutter" });
        const chunk = original.slice(row, row + 16);
        for (const [column, value2] of [...chunk].entries()) {
          const absolute = windowOffset + BigInt(row + column);
          const cell = element6(line, "span", { part: "hex.cell" });
          cell.setAttribute("role", "gridcell");
          cell.contentEditable = "true";
          cell.spellcheck = false;
          cell.dataset["offset"] = absolute.toString(10);
          cell.textContent = value2.toString(16).padStart(2, "0");
          cell.setAttribute("aria-label", `byte at ${absolute}`);
          hexCells.set(absolute.toString(10), cell);
          cell.addEventListener("beforeinput", (event) => {
            const data = event.data;
            if (data === null) return;
            const current = (cell.textContent ?? "").replace(/\s/gu, "");
            if (!/^[0-9a-f]$/iu.test(data) || current.length >= 2) event.preventDefault();
          });
          cell.addEventListener("blur", () => {
            const text = (cell.textContent ?? "").trim();
            if (!HEX_BYTE.test(text)) {
              const key = absolute.toString(10);
              const known = pending.get(key)?.after ?? value2;
              setByte(absolute, value2, known);
              return;
            }
            setByte(absolute, value2, Number.parseInt(text, 16));
          });
        }
        const ascii = element6(line, "span", { part: "hex.ascii" });
        for (const [column, value2] of [...chunk].entries()) {
          const absolute = windowOffset + BigInt(row + column);
          const glyph = element6(ascii, "span");
          glyph.contentEditable = "true";
          glyph.spellcheck = false;
          glyph.textContent = printable(value2);
          glyph.setAttribute("aria-label", `character at ${absolute}`);
          asciiCells.set(absolute.toString(10), glyph);
          glyph.addEventListener("beforeinput", (event) => {
            const data = event.data;
            if (data === null) return;
            if (data.length !== 1 || data.charCodeAt(0) < 32 || data.charCodeAt(0) > 126) {
              event.preventDefault();
            }
          });
          glyph.addEventListener("blur", () => {
            const text = glyph.textContent ?? "";
            const code = text.length === 1 ? text.charCodeAt(0) : Number.NaN;
            if (Number.isNaN(code) || code < 32 || code > 126) {
              const known = pending.get(absolute.toString(10))?.after ?? value2;
              setByte(absolute, value2, known);
              return;
            }
            setByte(absolute, value2, code);
          });
        }
      }
      syncDirty();
    };
    const commit = async () => {
      if (pending.size === 0) return true;
      const runs = coalesceHexEdits([...pending.values()]);
      const change = hexChangeSet(runs, args.edit.targets);
      setViewerText6(status, "Validating\u2026");
      const validation = await args.edit.propose(change);
      if (!validation.valid) {
        setState7(root2, ["error"]);
        const first = validation.diagnostics[0];
        setViewerText6(
          status,
          first === void 0 ? "Rejected by validation" : `Rejected: ${first.message}`
        );
        return false;
      }
      const plan = await args.edit.plan(change);
      const authorization = await args.authorization.request(plan);
      if (authorization === void 0) {
        setViewerText6(status, "Not authorised");
        return false;
      }
      const prepared = await args.commit.prepare(plan, { grant: authorization.grant });
      if (prepared.state !== "ready") {
        setState7(root2, ["error"]);
        setViewerText6(
          status,
          prepared.state === "conflict" ? "Conflict: the source changed" : `Prepare rejected: ${prepared.reason}`
        );
        return false;
      }
      const receipt = await args.commit.commit(prepared.prepared, {
        grant: authorization.grant
      });
      if (receipt.state !== "committed") {
        setState7(root2, ["error"]);
        setViewerText6(
          status,
          receipt.state === "not-applied" ? `Save rejected: ${receipt.reason}` : `Save ${receipt.state}`
        );
        return false;
      }
      const updated = new Uint8Array(original);
      for (const run of runs) {
        const start = Number(run.offset - windowOffset);
        if (start >= 0 && start + run.bytes.length <= updated.length) updated.set(run.bytes, start);
      }
      original = updated;
      pending.clear();
      drawWindow();
      setState7(root2, []);
      setViewerText6(
        status,
        `Committed ${runs.length} range(s) \u2014 reopen the file before editing it again`
      );
      return true;
    };
    go.addEventListener("click", () => void renderWindow());
    revert.addEventListener("click", () => void renderWindow());
    save.addEventListener("click", () => {
      commit().catch((error) => {
        setState7(root2, ["error"]);
        setViewerText6(
          status,
          `Save failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    });
    const removeSaveRequest = handleEditorSaveRequest2(root2, commit);
    await renderWindow();
    return {
      async update(next) {
        root2.dataset["revision"] = String(next.revision);
        await renderWindow();
      },
      async unmount() {
        removeSaveRequest();
        await scope.close();
        root2.remove();
      }
    };
  }
};

// packages/ui/dist/image/index.js
var PARTS8 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET8 = new Set(PARTS8);
var PART_ATTRIBUTE8 = "data-mk-part";
var STATE_ATTRIBUTE8 = "data-mk-state";
var STATES8 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET8 = new Set(STATES8);
function setPart8(element22, part) {
  if (!PART_SET8.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE8, part);
}
function setState8(element22, states) {
  for (const state of states) {
    if (!STATE_SET8.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE8);
  else element22.setAttribute(STATE_ATTRIBUTE8, [...new Set(states)].join(" "));
}
var VIEWER_CSP8 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR8 = Object.freeze({
  ...VIEWER_CSP8,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText8 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT8 = policyText8(VIEWER_CSP8);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT8 = policyText8(VIEWER_CSP_TRUSTED_EDITOR8);
var HOSTILE_TEXT8 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText8(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT8, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText7(node, value2, maximum) {
  node.textContent = safeViewerText8(value2, maximum);
}
function requireContainer6(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface6(container, label) {
  const host = requireContainer6(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart8(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element7(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText7(node, options.text);
  if (options.part !== void 0) setPart8(node, options.part);
  if (options.state !== void 0) setState8(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor5(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope6 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount5(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText8(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule5(module) {
  return Object.freeze(module);
}
function unknownSourceLease5(sources, slot, contract) {
  const binding = bindingFor5(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var t2 = (name, tier, type, description, extra = {}) => ({ name, tier, type, isPublic: true, description, ...extra });
var PALETTE_STEPS2 = [
  "050",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900"
];
var PALETTE_HUES2 = ["neutral", "accent", "ok", "warn", "error", "info"];
var tier12 = PALETTE_HUES2.flatMap(
  (hue) => PALETTE_STEPS2.map((step) => t2(`palette.${hue}.${step}`, 1, "color", `${hue} ramp step ${step}`))
);
var tier22 = [
  // surfaces
  t2("color.bg", 2, "color", "window ground behind everything"),
  t2("color.surface", 2, "color", "default component surface"),
  t2("color.raised", 2, "color", "surface above the default plane"),
  t2("color.sunken", 2, "color", "inset surface such as an input well"),
  t2("color.overlay", 2, "color", "floating surface: menu, popover, dialog"),
  t2("color.scrim", 2, "color", "dimming layer behind a modal"),
  // text
  t2("color.fg", 2, "color", "primary text"),
  t2("color.fg-muted", 2, "color", "secondary text"),
  t2("color.fg-subtle", 2, "color", "tertiary text and placeholders"),
  t2("color.fg-inverse", 2, "color", "text on an accent fill"),
  t2("color.fg-disabled", 2, "color", "disabled text"),
  t2("color.fg-link", 2, "color", "hyperlink text"),
  t2("color.fg-destructive", 2, "color", "destructive action text"),
  // lines
  t2("color.border", 2, "color", "default separator and component border"),
  t2("color.border-strong", 2, "color", "emphasised border"),
  t2("color.separator", 2, "color", "hairline between list sections"),
  // interaction
  t2("color.accent", 2, "color", "primary action fill"),
  t2("color.accent-fg", 2, "color", "text on the accent fill"),
  t2("color.accent-muted", 2, "color", "low-emphasis accent wash"),
  t2("color.accent-muted-fg", 2, "color", "text on the accent wash"),
  t2("color.focus", 2, "color", "focus ring"),
  t2("color.hover", 2, "color", "hover wash"),
  t2("color.active", 2, "color", "pressed wash"),
  t2("color.selection", 2, "color", "active selection fill"),
  t2("color.selection-inactive", 2, "color", "selection fill when the surface is unfocused"),
  t2("color.selection-fg", 2, "color", "text on a selection fill"),
  t2("color.match-highlight", 2, "color", "search match highlight"),
  t2("color.drop-target", 2, "color", "drag-and-drop target indicator"),
  t2("color.readonly", 2, "color", "read-only field wash"),
  // status
  ...["ok", "warn", "error", "info"].flatMap((s) => [
    t2(`status.${s}`, 2, "color", `${s} indicator colour`),
    t2(`status.${s}-fg`, 2, "color", `text on a ${s} fill`),
    t2(`status.${s}-bg`, 2, "color", `${s} background wash`),
    t2(`status.${s}-border`, 2, "color", `${s} border`)
  ]),
  // scrollbars
  t2("color.scrollbar-track", 2, "color", "scrollbar trough"),
  t2("color.scrollbar-thumb", 2, "color", "scrollbar thumb"),
  t2("color.scrollbar-thumb-hover", 2, "color", "scrollbar thumb, hovered"),
  t2("color.scrollbar-thumb-active", 2, "color", "scrollbar thumb while dragging"),
  t2("color.scrollbar-shadow", 2, "color", "hairline separating a scrolled pane from its content"),
  // canvas / GPU surfaces — these are not UI chrome and need their own roles
  t2("color.canvas-bg", 2, "color", "canvas or WebGL scene ground"),
  t2("color.canvas-grid", 2, "color", "scene grid lines"),
  t2("color.canvas-gizmo", 2, "color", "scene gizmo and axis handles"),
  // Axis identity is a convention users read at a glance (X red, Y green, Z blue), so the three
  // get their own roles rather than borrowing from the categorical ramp, which a theme may reorder.
  t2("color.axis-x", 2, "color", "X axis handle and line"),
  t2("color.axis-y", 2, "color", "Y axis handle and line"),
  t2("color.axis-z", 2, "color", "Z axis handle and line"),
  t2("color.canvas-selection", 2, "color", "selected geometry outline"),
  // graph / chart categorical ramp
  ...["1", "2", "3", "4", "5", "6"].map(
    (n) => t2(`chart.categorical-${n}`, 2, "color", `categorical series ${n}`)
  ),
  t2("color.graph-node", 2, "color", "relation-graph node fill"),
  t2("color.graph-edge", 2, "color", "relation-graph edge stroke"),
  t2("color.graph-edge-dead", 2, "color", "unresolved reference edge"),
  // diff
  t2("color.diff-added", 2, "color", "added line or cell wash"),
  t2("color.diff-removed", 2, "color", "removed line or cell wash"),
  t2("color.diff-changed", 2, "color", "changed line or cell wash"),
  // space
  ...["0", "1", "2", "3", "4", "5", "6", "7", "8"].map(
    (n) => t2(`space.${n}`, 2, "length", `spacing step ${n}`)
  ),
  // radius
  ...["none", "sm", "md", "lg", "pill"].map(
    (r) => t2(`radius.${r}`, 2, "length", `corner radius ${r}`)
  ),
  // type
  t2("font.sans", 2, "font-family", "UI typeface stack"),
  t2("font.mono", 2, "font-family", "monospace stack for IDs, code, offsets"),
  ...["xs", "sm", "md", "lg", "xl"].map((s) => t2(`font.size-${s}`, 2, "length", `font size ${s}`)),
  ...["normal", "medium", "bold"].map((w) => t2(`font.weight-${w}`, 2, "number", `font weight ${w}`)),
  ...["tight", "normal", "loose"].map((l) => t2(`line.${l}`, 2, "number", `line height ${l}`)),
  // metrics
  t2("size.row", 2, "length", "list and table row height"),
  t2("size.control", 2, "length", "default control height"),
  t2("size.icon", 2, "length", "default icon box"),
  t2("size.touch", 2, "length", "minimum touch target"),
  t2("size.scrollbar", 2, "length", "scrollbar thickness"),
  t2("size.scrollbar-thin", 2, "length", "scrollbar thickness inside dense panes"),
  // layering
  ...["base", "sticky", "dropdown", "overlay", "modal", "toast"].map(
    (z) => t2(`z.${z}`, 2, "z-index", `stacking band: ${z}`)
  ),
  // motion
  ...["fast", "normal", "slow"].map(
    (d) => t2(`motion.${d}`, 2, "duration", `transition duration ${d}`)
  ),
  t2("motion.ease", 2, "easing", "default easing curve"),
  // elevation
  ...["1", "2", "3"].map((e) => t2(`elevation.${e}`, 2, "shadow", `elevation level ${e}`)),
  t2("shadow.focus-ring", 2, "shadow", "focus ring shadow")
];
var c2 = (name, component, type, derivesFrom, description) => t2(name, 3, type, description, { component, derivesFrom });
var runtime2 = (name, component, type, runtimeDefault, description) => t2(name, 3, type, description, { component, runtimeDefault });
var tier32 = [
  runtime2("tree.indent-level", "tree", "number", "0", "nesting depth of the current tree row"),
  runtime2("card.grid-columns", "card", "number", "5", "column count of the current card grid"),
  // Context-menu placement is per-instance pixel geometry, which C3 routes through tokens.
  runtime2("explorer.menu-x", "explorer", "length", "0px", "context menu left offset"),
  runtime2("explorer.menu-y", "explorer", "length", "0px", "context menu top offset"),
  c2("table.row-height", "table", "length", "size.row", "table row height"),
  c2("table.header-bg", "table", "color", "color.raised", "table header background"),
  c2("table.cell-padding-x", "table", "length", "space.2", "table cell horizontal padding"),
  c2("tree.indent", "tree", "length", "space.4", "tree nesting indent per level"),
  c2("tree.row-height", "tree", "length", "size.row", "tree row height"),
  c2("hex.byte-gap", "hex", "length", "space.1", "gap between hex byte columns"),
  c2("hex.gutter-fg", "hex", "color", "color.fg-subtle", "hex offset gutter text"),
  c2("text.line-height", "text", "number", "line.normal", "text stage line height"),
  c2("shell.rail-width", "shell", "length", "space.8", "default side rail width"),
  c2("shell.splitter-size", "shell", "length", "space.1", "splitter hit area thickness"),
  c2("toolbar.height", "toolbar", "length", "size.control", "toolbar height"),
  c2("panel.padding", "panel", "length", "space.3", "panel content padding"),
  c2("transport.track-height", "transport", "length", "space.2", "transport scrub track height")
];
var TOKENS2 = Object.freeze([...tier12, ...tier22, ...tier32]);
var TOKENS_BY_NAME2 = new Map(
  TOKENS2.map((token) => [token.name, token])
);
function cssVariableName2(tokenName) {
  return `--mk-${tokenName.replace(/\./gu, "-")}`;
}
var HEX2 = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
var FUNCTIONAL_COLOR2 = /^(?:rgb|rgba|hsl|hsla|color-mix|oklch|lab|lch)\([^;{}]*\)$/iu;
var LENGTH2 = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ch|%|vh|vw|vmin|vmax)$|^0$/u;
var DURATION2 = /^(?:\d+\.?\d*|\.\d+)m?s$/u;
var NUMBER2 = /^-?(?:\d+\.?\d*|\.\d+)$/u;
var EASING2 = /^(?:linear|ease|ease-in|ease-out|ease-in-out|steps\([^;{}]*\)|cubic-bezier\([^;{}]*\))$/u;
var SHADOW2 = /^(?:none|[-\w\s.,()#%/]+)$/u;
var FONT_FAMILY2 = /^[-\w\s.,'"()]+$/u;
var FORBIDDEN2 = /url\(|expression\(|javascript:|@import|[;{}]|<|>/iu;
function validateTokenValue2(tokenName, value2) {
  const token = TOKENS_BY_NAME2.get(tokenName);
  if (token === void 0) return { valid: false, reason: `unknown token: ${tokenName}` };
  if (typeof value2 !== "string" || value2.length === 0) {
    return { valid: false, reason: "value must be a non-empty string" };
  }
  if (value2.length > 256) return { valid: false, reason: "value exceeds 256 characters" };
  if (FORBIDDEN2.test(value2)) {
    return { valid: false, reason: "value contains a resource load or declaration escape" };
  }
  const ok = (() => {
    switch (token.type) {
      case "color":
        return HEX2.test(value2) || FUNCTIONAL_COLOR2.test(value2) || /^[a-z-]+$/iu.test(value2);
      case "length":
        return LENGTH2.test(value2);
      case "number":
        return NUMBER2.test(value2);
      case "duration":
        return DURATION2.test(value2);
      case "easing":
        return EASING2.test(value2);
      case "font-family":
        return FONT_FAMILY2.test(value2);
      case "shadow":
        return SHADOW2.test(value2);
      case "z-index":
        return NUMBER2.test(value2);
      default:
        return false;
    }
  })();
  return ok ? { valid: true } : { valid: false, reason: `value is not a valid ${token.type}` };
}
function requireElement2(value2) {
  if (typeof value2 !== "object" || value2 === null || !("style" in value2) || typeof value2.style !== "object") {
    throw new TypeError("token target must be a DOM element");
  }
  return value2;
}
function setToken2(element22, name, value2) {
  const target = requireElement2(element22);
  const result = validateTokenValue2(name, value2);
  if (!result.valid) {
    throw new TypeError(`invalid value for token ${name}: ${result.reason ?? "unknown reason"}`);
  }
  target.style.setProperty(cssVariableName2(name), value2);
}
async function collectEncodedMedia2(source, maximumBytes, signal) {
  const descriptor = await source.descriptor();
  if (descriptor.bytes > BigInt(maximumBytes) || descriptor.bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`encoded media exceeds the stage budget: ${descriptor.bytes} bytes`);
  }
  const total = Number(descriptor.bytes);
  const bytes = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
    const chunk = await source.read(BigInt(offset), Math.min(1024 * 1024, total - offset), signal);
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError("encoded media ended outside its declared size");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { mediaType: descriptor.mediaType, bytes };
}
var IMAGE_MAXIMUM_BYTES = 64 * 1024 * 1024;
async function loadBitmap(source, signal) {
  const info = await source.info(signal);
  const decodedBytes = info.width * info.height * 4;
  if (info.decodedAccess && source.readRegion !== void 0 && Number.isSafeInteger(decodedBytes) && decodedBytes <= IMAGE_MAXIMUM_BYTES) {
    const region = await source.readRegion(
      {
        x: 0,
        y: 0,
        width: info.width,
        height: info.height,
        frame: 0,
        mipLevel: 0,
        layer: 0,
        face: 0,
        slice: 0,
        pixelFormat: "rgba8",
        maxBytes: IMAGE_MAXIMUM_BYTES
      },
      signal
    );
    const pixels = new Uint8ClampedArray(region.pixels.byteLength);
    pixels.set(region.pixels);
    const bitmap2 = await createImageBitmap(new ImageData(pixels, region.width, region.height));
    return { bitmap: bitmap2, bytes: region.pixels.byteLength };
  }
  const encoded = await source.encoded(signal);
  const media = await collectEncodedMedia2(encoded, IMAGE_MAXIMUM_BYTES, signal);
  const bitmap = await createImageBitmap(
    new Blob([media.bytes], { type: media.mediaType })
  );
  return { bitmap, bytes: media.bytes.byteLength };
}
function drawChecker(context, width, height) {
  const cell = 8;
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const even = (x / cell | 0) % 2 === (y / cell | 0) % 2;
      context.fillStyle = even ? "#808080" : "#a0a0a0";
      context.fillRect(x, y, cell, cell);
    }
  }
}
function isolateChannel(context, width, height, channel) {
  if (channel === "rgb") return;
  const frame = context.getImageData(0, 0, width, height);
  const data = frame.data;
  const index = channel === "r" ? 0 : channel === "g" ? 1 : channel === "b" ? 2 : 3;
  for (let at = 0; at < data.length; at += 4) {
    const value2 = data[at + index];
    data[at] = value2;
    data[at + 1] = value2;
    data[at + 2] = value2;
    data[at + 3] = 255;
  }
  context.putImageData(frame, 0, 0);
}
var imageViewer = defineViewerModule5({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope6(args.signal);
    const root2 = createSurface6(args.container, "Image viewer");
    const stage = element7(root2, "div", { part: "image" });
    const toolbar = element7(stage, "div", { part: "image.toolbar", role: "toolbar" });
    toolbar.setAttribute("aria-label", "Image controls");
    const readout = element7(stage, "output", { part: "image.readout" });
    const canvas = element7(stage, "canvas", { part: "image.canvas" });
    canvas.tabIndex = 0;
    const lease = await unknownSourceLease5(
      args.sources,
      args.slot,
      "common.view/raster-image-source"
    );
    if (lease === void 0) throw new TypeError("image binding is unavailable");
    scope.lease(lease);
    let model;
    let zoom = 1;
    let fit = true;
    let background = "checker";
    let channel = "rgb";
    const context = canvas.getContext("2d");
    if (context === null) throw new TypeError("2d canvas context is unavailable");
    const paint = () => {
      if (model === void 0) return;
      const { bitmap } = model;
      const box = stage.getBoundingClientRect();
      const available = {
        width: Math.max(64, box.width - 8),
        height: Math.max(64, box.height - 96)
      };
      const scale = fit ? Math.min(available.width / bitmap.width, available.height / bitmap.height, 1) : zoom;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = width;
      canvas.height = height;
      setToken2(canvas, "size.icon", `${Math.min(width, 4096)}px`);
      context.imageSmoothingEnabled = scale < 1;
      if (background === "checker") drawChecker(context, width, height);
      else {
        context.fillStyle = background === "dark" ? "#141414" : "#f4f4f4";
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(bitmap, 0, 0, width, height);
      isolateChannel(context, width, height, channel);
      setViewerText7(
        readout,
        `${bitmap.width}\xD7${bitmap.height} \xB7 ${(model.bytes / 1024).toFixed(1)} KiB \xB7 ${Math.round(scale * 100)}%${channel === "rgb" ? "" : ` \xB7 channel ${channel.toUpperCase()}`}`
      );
    };
    const button = (label, title, onClick) => {
      const node = element7(toolbar, "button", {
        text: label,
        part: "operations.button"
      });
      node.type = "button";
      node.title = title;
      node.addEventListener("click", () => {
        onClick();
        paint();
      });
      scope.cleanup(() => node.replaceWith(node.cloneNode(true)));
    };
    button("Fit", "Fit to the stage", () => {
      fit = true;
    });
    button("1:1", "Actual pixels", () => {
      fit = false;
      zoom = 1;
    });
    button("\u2212", "Zoom out", () => {
      fit = false;
      zoom = Math.max(0.1, zoom / 1.5);
    });
    button("+", "Zoom in", () => {
      fit = false;
      zoom = Math.min(32, zoom * 1.5);
    });
    button("BG", "Cycle the backdrop", () => {
      background = background === "checker" ? "dark" : background === "dark" ? "light" : "checker";
    });
    for (const value2 of ["rgb", "r", "g", "b", "a"]) {
      button(value2.toUpperCase(), `Isolate the ${value2.toUpperCase()} channel`, () => {
        channel = value2;
      });
    }
    setState8(stage, ["loading"]);
    try {
      model = await loadBitmap(lease.value, scope.signal);
      setState8(stage, []);
      paint();
    } catch (error) {
      setState8(stage, ["error"]);
      canvas.remove();
      element7(stage, "p", {
        part: "viewer.empty",
        text: `The platform decoder cannot render these bytes: ${error instanceof Error ? error.message : String(error)}. A format-specific decoder provider is required.`
      });
    }
    return createViewerMount5(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
      paint();
    });
  }
});

// packages/ui/dist/metadata/index.js
var PARTS9 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET9 = new Set(PARTS9);
var PART_ATTRIBUTE9 = "data-mk-part";
var STATE_ATTRIBUTE9 = "data-mk-state";
var STATES9 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET9 = new Set(STATES9);
function setPart9(element22, part) {
  if (!PART_SET9.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE9, part);
}
function setState9(element22, states) {
  for (const state of states) {
    if (!STATE_SET9.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE9);
  else element22.setAttribute(STATE_ATTRIBUTE9, [...new Set(states)].join(" "));
}
var VIEWER_CSP9 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR9 = Object.freeze({
  ...VIEWER_CSP9,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText9 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT9 = policyText9(VIEWER_CSP9);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT9 = policyText9(VIEWER_CSP_TRUSTED_EDITOR9);
var HOSTILE_TEXT9 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText9(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT9, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText8(node, value2, maximum) {
  node.textContent = safeViewerText9(value2, maximum);
}
function requireContainer7(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface7(container, label) {
  const host = requireContainer7(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart9(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element8(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText8(node, options.text);
  if (options.part !== void 0) setPart9(node, options.part);
  if (options.state !== void 0) setState9(node, options.state);
  parent.append(node);
  return node;
}
var ViewerMountScope7 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount6(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText9(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule6(module) {
  return Object.freeze(module);
}
function resolved(descriptor) {
  return "identity" in descriptor ? descriptor : void 0;
}
function traitValue(trait) {
  const parameters = Object.entries(trait.parameters ?? {});
  if (parameters.length === 0) return trait.state;
  const stated = parameters.map(([key, item]) => `${key}=${String(item)}`).join(", ");
  return `${trait.state} \xB7 ${stated}`;
}
function renderMetadata(root2, descriptor) {
  root2.replaceChildren();
  const groups = resolved(descriptor)?.metadata ?? [];
  const traits = descriptor.traits;
  if (groups.length === 0 && traits.length === 0) {
    element8(root2, "p", { text: "No metadata reported by the codec.", part: "viewer.empty" });
    return;
  }
  for (const group of groups) {
    const section2 = element8(root2, "section", { part: "metadata.group" });
    element8(section2, "h3", { text: group.label, part: "metadata.heading" });
    const list2 = element8(section2, "dl");
    for (const entry of group.entries) {
      const row = element8(list2, "div", { part: "metadata.row" });
      element8(row, "dt", { text: entry.key, part: "metadata.label" });
      const value2 = element8(row, "dd", { part: "metadata.value" });
      setViewerText8(value2, entry.value, 4096);
      value2.title = String(entry.value);
    }
  }
  if (traits.length === 0) return;
  const section = element8(root2, "section", { part: "metadata.group" });
  element8(section, "h3", { text: "Observed traits", part: "metadata.heading" });
  const list = element8(section, "dl");
  for (const trait of traits) {
    const row = element8(list, "div", { part: "metadata.row" });
    element8(row, "dt", { text: trait.id, part: "metadata.label" });
    const value2 = element8(row, "dd", { part: "metadata.value" });
    const text = traitValue(trait);
    setViewerText8(value2, text, 4096);
    value2.title = text;
  }
}
var metadataPanel = defineViewerModule6({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope7(args.signal);
    const root2 = createSurface7(args.container, "Metadata");
    const body = element8(root2, "div", { part: "metadata" });
    renderMetadata(body, args.descriptor);
    return createViewerMount6(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
      renderMetadata(body, descriptor);
    });
  }
});
function renderProperties(root2, descriptor) {
  root2.replaceChildren();
  const rows = [
    { name: "subject", value: descriptor.subjectUri, origin: "identity" },
    { name: "revision", value: descriptor.revision, origin: "identity" },
    {
      name: "interpretation",
      value: String(resolved(descriptor)?.interpretation ?? "unresolved"),
      origin: "identity"
    }
  ];
  const identity = resolved(descriptor)?.identity;
  if (identity !== void 0) {
    if (identity.formatId !== void 0)
      rows.push({ name: "format", value: identity.formatId, origin: "identity" });
    if (identity.codecId !== void 0)
      rows.push({ name: "codec", value: identity.codecId, origin: "identity" });
    if (identity.confidence !== void 0)
      rows.push({ name: "confidence", value: identity.confidence.toFixed(2), origin: "detection" });
  }
  for (const trait of descriptor.traits) {
    const parameters = Object.entries(trait.parameters ?? {});
    rows.push({
      name: trait.id,
      value: parameters.length === 0 ? trait.state : `${trait.state} \xB7 ${parameters.map(([key, item]) => `${key}=${String(item)}`).join(", ")}`,
      origin: "trait"
    });
  }
  for (const operation of descriptor.operations) {
    rows.push({
      name: operation.id,
      value: `${operation.state}${operation.mutatesSource ? " \xB7 mutates source" : ""}`,
      origin: "operation"
    });
  }
  for (const row of rows) {
    const line = element8(root2, "div", { part: "properties.row" });
    element8(line, "span", { text: row.name, part: "properties.name" });
    element8(line, "span", { text: row.value, part: "properties.value" });
    element8(line, "span", { text: row.origin, part: "properties.origin" });
  }
}
var propertiesTable = defineViewerModule6({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope7(args.signal);
    const root2 = createSurface7(args.container, "Properties");
    const body = element8(root2, "div", { part: "properties" });
    body.setAttribute("role", "table");
    renderProperties(body, args.descriptor);
    return createViewerMount6(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
      renderProperties(body, descriptor);
    });
  }
});

// packages/ui/dist/model/index.js
var PARTS10 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET10 = new Set(PARTS10);
var PART_ATTRIBUTE10 = "data-mk-part";
var STATE_ATTRIBUTE10 = "data-mk-state";
var STATES10 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET10 = new Set(STATES10);
function setPart10(element22, part) {
  if (!PART_SET10.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE10, part);
}
function setState10(element22, states) {
  for (const state of states) {
    if (!STATE_SET10.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE10);
  else element22.setAttribute(STATE_ATTRIBUTE10, [...new Set(states)].join(" "));
}
var VIEWER_CSP10 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR10 = Object.freeze({
  ...VIEWER_CSP10,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText10 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT10 = policyText10(VIEWER_CSP10);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT10 = policyText10(VIEWER_CSP_TRUSTED_EDITOR10);
var HOSTILE_TEXT10 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText10(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT10, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText9(node, value2, maximum) {
  node.textContent = safeViewerText10(value2, maximum);
}
function requireContainer8(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface8(container, label) {
  const host = requireContainer8(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart10(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element9(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText9(node, options.text);
  if (options.part !== void 0) setPart10(node, options.part);
  if (options.state !== void 0) setState10(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor6(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope8 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount7(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText10(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule7(module) {
  return Object.freeze(module);
}
function unknownSourceLease6(sources, slot, contract) {
  const binding = bindingFor6(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var PITCH_MINIMUM = -1.4;
var PITCH_MAXIMUM = 1.5;
var DRAG_RADIANS_PER_PIXEL = 8e-3;
var WHEEL_IN = 0.9;
var WHEEL_OUT = 1.1;
var DISTANCE_MINIMUM = 0.15;
var DISTANCE_MAXIMUM = 8;
var RESET_YAW = 0.7;
var RESET_PITCH = 0.45;
var clamp = (value2, low, high) => Math.min(Math.max(value2, low), high);
var POLE = Math.PI / 2 - 1e-3;
var AXIS_POSE = Object.freeze({
  "+x": [Math.PI / 2, 0],
  "-x": [-Math.PI / 2, 0],
  "+y": [0, POLE],
  "-y": [0, -POLE],
  "+z": [0, 0],
  "-z": [Math.PI, 0]
});
function createOrbitController(initial = {}) {
  let yaw = initial.yaw ?? RESET_YAW;
  let pitch = clamp(initial.pitch ?? RESET_PITCH, PITCH_MINIMUM, PITCH_MAXIMUM);
  let distanceScale = clamp(initial.distanceScale ?? 1, DISTANCE_MINIMUM, DISTANCE_MAXIMUM);
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => {
    const pose = { yaw, pitch, distanceScale };
    for (const listener of listeners) listener(pose);
  };
  const controller = {
    get pose() {
      return { yaw, pitch, distanceScale };
    },
    position(target, radius) {
      const scaled = radius * distanceScale;
      return [
        target[0] + Math.sin(yaw) * Math.cos(pitch) * scaled,
        target[1] + Math.sin(pitch) * scaled,
        target[2] + Math.cos(yaw) * Math.cos(pitch) * scaled
      ];
    },
    basis() {
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
      return { backward, right, up };
    },
    orbit(deltaX, deltaY) {
      yaw += deltaX * DRAG_RADIANS_PER_PIXEL;
      pitch = clamp(pitch + deltaY * DRAG_RADIANS_PER_PIXEL, PITCH_MINIMUM, PITCH_MAXIMUM);
      emit();
    },
    zoom(wheelDelta) {
      distanceScale = clamp(
        distanceScale * (wheelDelta > 0 ? WHEEL_OUT : WHEEL_IN),
        DISTANCE_MINIMUM,
        DISTANCE_MAXIMUM
      );
      emit();
    },
    snapTo(axis) {
      const pose = AXIS_POSE[axis];
      if (pose === void 0) throw new TypeError(`unknown view axis: ${String(axis)}`);
      yaw = pose[0];
      pitch = pose[1];
      emit();
    },
    reset() {
      yaw = RESET_YAW;
      pitch = RESET_PITCH;
      distanceScale = 1;
      emit();
    },
    set(pose) {
      if (pose.yaw !== void 0) yaw = pose.yaw;
      if (pose.pitch !== void 0) pitch = clamp(pose.pitch, PITCH_MINIMUM, PITCH_MAXIMUM);
      if (pose.distanceScale !== void 0) {
        distanceScale = clamp(pose.distanceScale, DISTANCE_MINIMUM, DISTANCE_MAXIMUM);
      }
      emit();
    },
    attach(host, signal) {
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const options = signal === void 0 ? {} : { signal };
      host.addEventListener(
        "pointerdown",
        (event) => {
          dragging = true;
          lastX = event.clientX;
          lastY = event.clientY;
          host.setPointerCapture(event.pointerId);
        },
        options
      );
      host.addEventListener(
        "pointermove",
        (event) => {
          if (!dragging) return;
          controller.orbit(event.clientX - lastX, event.clientY - lastY);
          lastX = event.clientX;
          lastY = event.clientY;
        },
        options
      );
      const stop = () => {
        dragging = false;
      };
      host.addEventListener("pointerup", stop, options);
      host.addEventListener("pointercancel", stop, options);
      host.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          controller.zoom(event.deltaY);
        },
        { passive: false, ...options }
      );
      host.addEventListener(
        "keydown",
        (event) => {
          const step = event.shiftKey ? 40 : 12;
          if (event.key === "ArrowLeft") controller.orbit(-step, 0);
          else if (event.key === "ArrowRight") controller.orbit(step, 0);
          else if (event.key === "ArrowUp") controller.orbit(0, -step);
          else if (event.key === "ArrowDown") controller.orbit(0, step);
          else if (event.key === "+" || event.key === "=") controller.zoom(-1);
          else if (event.key === "-") controller.zoom(1);
          else if (event.key === "0") controller.reset();
          else return;
          event.preventDefault();
        },
        options
      );
      return stop;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  return controller;
}
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
  const document2 = host.ownerDocument;
  const root2 = element9(host, "div", { part: "gizmo" });
  root2.setAttribute("aria-label", "View axis");
  root2.setAttribute("role", "group");
  const svg = document2.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(GIZMO_SIZE));
  svg.setAttribute("height", String(GIZMO_SIZE));
  svg.setAttribute("viewBox", `0 0 ${GIZMO_SIZE} ${GIZMO_SIZE}`);
  setPart10(svg, "gizmo.svg");
  root2.append(svg);
  const pivot = document2.createElementNS(SVG_NS, "circle");
  pivot.setAttribute("cx", String(CENTER));
  pivot.setAttribute("cy", String(CENTER));
  pivot.setAttribute("r", "3");
  pivot.setAttribute("fill", "var(--mk-color-canvas-gizmo)");
  svg.append(pivot);
  const nodes = [];
  for (const spec of AXES) {
    const line = document2.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(CENTER));
    line.setAttribute("y1", String(CENTER));
    line.setAttribute("stroke", `var(${spec.token})`);
    line.setAttribute("stroke-linecap", "round");
    setPart10(line, "gizmo.axis");
    svg.append(line);
    const hit = document2.createElementNS(SVG_NS, "g");
    hit.setAttribute("role", "button");
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("aria-label", `View from ${spec.key.toUpperCase()}`);
    setPart10(hit, "gizmo.handle");
    const handle = document2.createElementNS(SVG_NS, "circle");
    handle.setAttribute("fill", `var(${spec.token})`);
    hit.append(handle);
    const label = document2.createElementNS(SVG_NS, "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.setAttribute("fill", "var(--mk-color-fg-inverse)");
    label.textContent = spec.label;
    setPart10(label, "gizmo.label");
    hit.append(label);
    const activate = () => options.onAxis?.(spec.key);
    hit.addEventListener("click", activate);
    hit.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
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
    root: root2,
    update,
    destroy() {
      root2.remove();
    }
  };
}
var MODEL_MAXIMUM_PRIMITIVE_BYTES = 64 * 1024 * 1024;
var MODEL_FACET_CONTRACTS = Object.freeze([
  "common.view/model-resource-refs-source",
  "common.view/model-skeleton-source",
  "common.view/model-animation-source",
  "common.view/model-collision-source",
  "common.view/model-material-source"
]);
var FACET_READOUT = Object.freeze({
  "common.view/model-resource-refs-source": { label: "resources", key: "references" },
  "common.view/model-skeleton-source": { label: "bones", key: "bindings" },
  "common.view/model-animation-source": { label: "clips", key: "clips" },
  "common.view/model-collision-source": { label: "collision", key: "volumes" },
  "common.view/model-material-source": { label: "materials", key: "materials" }
});
async function readModelFacets(sources, slot, scope, signal) {
  const parts = [];
  for (const contract of MODEL_FACET_CONTRACTS) {
    const lease = await unknownSourceLease6(sources, slot, contract);
    if (lease === void 0) continue;
    scope.lease(lease);
    const readout = FACET_READOUT[contract];
    const source = lease.value;
    const info = await source.info(signal);
    const value2 = info[readout?.key ?? ""];
    if (typeof value2 === "number") parts.push(`${value2} ${readout?.label ?? contract}`);
  }
  return parts;
}
async function loadModelStage(source, signal) {
  const [info, meshes] = await Promise.all([
    source.info(signal),
    source.meshes({ limit: 1 }, signal)
  ]);
  const primitiveId = meshes.items[0]?.primitiveIds[0];
  const primitive = primitiveId === void 0 || source.primitive === void 0 ? void 0 : await source.primitive(primitiveId, { maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES }, signal);
  return { info, ...primitive === void 0 ? {} : { primitive } };
}
function drawPrimitive(canvas, primitive, basis, distanceScale) {
  const context = canvas.getContext("2d");
  if (context === null) throw new TypeError("2d canvas context is unavailable");
  const width = 720;
  const height = 480;
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  const positions = primitive.positions;
  if (positions.length < 3) return;
  if (positions.length % 3 !== 0 || !positions.every(Number.isFinite)) {
    throw new TypeError("model primitive positions are malformed");
  }
  const { right, up } = basis;
  const flat = new Float64Array(positions.length / 3 * 2);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0, vertex = 0; index + 2 < positions.length; index += 3, vertex += 1) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    const screenX = x * right[0] + y * right[1] + z * right[2];
    const screenY = x * up[0] + y * up[1] + z * up[2];
    flat[vertex * 2] = screenX;
    flat[vertex * 2 + 1] = screenY;
    minX = Math.min(minX, screenX);
    maxX = Math.max(maxX, screenX);
    minY = Math.min(minY, screenY);
    maxY = Math.max(maxY, screenY);
  }
  const extentX = Math.max(1e-9, maxX - minX);
  const extentY = Math.max(1e-9, maxY - minY);
  const margin = 16;
  const fit = Math.min((width - margin * 2) / extentX, (height - margin * 2) / extentY);
  const scale = fit / Math.max(0.15, distanceScale);
  const offsetX = width / 2 - (minX + maxX) / 2 * scale;
  const offsetY = height / 2 + (minY + maxY) / 2 * scale;
  const point = (vertex) => [
    offsetX + flat[vertex * 2] * scale,
    offsetY - flat[vertex * 2 + 1] * scale
  ];
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
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
  };
  const triangle = (first, second, third) => {
    const a = point(first);
    const b = point(second);
    const c3 = point(third);
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.lineTo(c3[0], c3[1]);
    context.closePath();
    context.stroke();
  };
  if (primitive.topology === "points") {
    for (const vertex of indices) {
      const value2 = point(vertex);
      context.fillRect(value2[0] - 1, value2[1] - 1, 3, 3);
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
var modelViewer = defineViewerModule7({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope8(args.signal);
    const root2 = createSurface8(args.container, "Model viewer");
    const stage = element9(root2, "div", { part: "model" });
    const readout = element9(stage, "output", { part: "model.readout" });
    const toolbar = element9(stage, "div", { part: "model.toolbar", role: "toolbar" });
    toolbar.setAttribute("aria-label", "Model view");
    const canvas = element9(stage, "canvas", { part: "model.canvas" });
    canvas.setAttribute("role", "img");
    canvas.tabIndex = 0;
    const camera = createOrbitController();
    const gizmo = createViewGizmo(stage, { onAxis: (axis) => camera.snapTo(axis) });
    const lease = await unknownSourceLease6(
      args.sources,
      args.slot,
      "common.view/model-scene-source"
    );
    if (lease === void 0) throw new TypeError("model binding is unavailable");
    scope.lease(lease);
    setState10(stage, ["loading"]);
    try {
      const model = await loadModelStage(lease.value, scope.signal);
      const facets = await readModelFacets(args.sources, args.slot, scope, scope.signal);
      setViewerText9(
        readout,
        `${model.info.nodes} nodes \xB7 ${model.info.meshes} meshes \xB7 ${model.info.primitives} primitives \xB7 ${model.info.materials} materials \xB7 ${model.info.animations} animations` + (facets.length === 0 ? "" : ` \xB7 ${facets.join(" \xB7 ")}`)
      );
      if (model.primitive === void 0) {
        canvas.remove();
        gizmo.destroy();
        toolbar.remove();
        element9(stage, "p", {
          part: "viewer.empty",
          text: "Scene metadata is available. A buffer resolver/renderer provider is required for geometry."
        });
      } else {
        const primitive = model.primitive;
        const redraw = () => {
          const pose = camera.pose;
          drawPrimitive(canvas, primitive, camera.basis(), pose.distanceScale);
          gizmo.update(pose.yaw, pose.pitch);
        };
        scope.cleanup(camera.onChange(redraw));
        camera.attach(canvas, scope.signal);
        const button = (label, title, run) => {
          const node = element9(toolbar, "button", { part: "operations.button", text: label });
          node.setAttribute("type", "button");
          node.title = title;
          node.addEventListener("click", run, { signal: scope.signal });
        };
        button("Reset", "Reset the camera to its default pose", () => camera.reset());
        button("\u2212", "Zoom out", () => camera.zoom(1));
        button("+", "Zoom in", () => camera.zoom(-1));
        scope.cleanup(() => gizmo.destroy());
        redraw();
      }
      setState10(stage, []);
    } catch (error) {
      setState10(stage, ["error"]);
      canvas.remove();
      element9(stage, "p", {
        part: "viewer.empty",
        text: `The model scene cannot be rendered: ${error instanceof Error ? error.message : String(error)}`
      });
    }
    return createViewerMount7(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});

// packages/ui/dist/table/index.js
var PARTS11 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET11 = new Set(PARTS11);
var PART_ATTRIBUTE11 = "data-mk-part";
var STATE_ATTRIBUTE11 = "data-mk-state";
var STATES11 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET11 = new Set(STATES11);
function setPart11(element22, part) {
  if (!PART_SET11.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE11, part);
}
function setState11(element22, states) {
  for (const state of states) {
    if (!STATE_SET11.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE11);
  else element22.setAttribute(STATE_ATTRIBUTE11, [...new Set(states)].join(" "));
}
var VIEWER_CSP11 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR11 = Object.freeze({
  ...VIEWER_CSP11,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText11 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT11 = policyText11(VIEWER_CSP11);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT11 = policyText11(VIEWER_CSP_TRUSTED_EDITOR11);
var HOSTILE_TEXT11 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText11(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT11, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText10(node, value2, maximum) {
  node.textContent = safeViewerText11(value2, maximum);
}
function requireContainer9(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface9(container, label) {
  const host = requireContainer9(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart11(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element10(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText10(node, options.text);
  if (options.part !== void 0) setPart11(node, options.part);
  if (options.state !== void 0) setState11(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor7(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope9 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount8(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText11(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule8(module) {
  return Object.freeze(module);
}
function unknownSourceLease7(sources, slot, contract) {
  const binding = bindingFor7(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var TABLE_PAGE_ROWS = 200;
var LazyTableModel = class {
  constructor(source) {
    this.source = source;
  }
  source;
  #cursor;
  shape() {
    return this.source.shape();
  }
  async first(from = 0, signal) {
    const page = await this.source.rows({ kind: "range", from, count: TABLE_PAGE_ROWS }, signal);
    this.#cursor = page.nextCursor;
    return page;
  }
  async next(signal) {
    if (this.#cursor === void 0) return void 0;
    const page = await this.source.rows(
      { kind: "cursor", cursor: this.#cursor, count: TABLE_PAGE_ROWS },
      signal
    );
    this.#cursor = page.nextCursor;
    return page;
  }
};
var tableViewer = defineViewerModule8({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope9(args.signal);
    const root2 = createSurface9(args.container, "Table viewer");
    const lease = await unknownSourceLease7(args.sources, args.slot, "common.view/table-data-source");
    if (lease === void 0) throw new TypeError("table binding is unavailable");
    scope.lease(lease);
    const model = new LazyTableModel(lease.value);
    const table = element10(root2, "table", {
      className: "modkit-viewer__table",
      part: "table"
    });
    const caption = table.createCaption();
    setPart11(caption, "table.caption");
    const shape = await model.shape();
    setViewerText10(caption, `${shape.rows} rows, ${shape.columns} columns`);
    const body = table.createTBody();
    setPart11(body, "table.body");
    const render = (rows) => {
      body.replaceChildren();
      for (const row of rows) {
        const tr = body.insertRow();
        setPart11(tr, "table.row");
        tr.dataset["row"] = String(row.index);
        for (const value2 of row.cells) {
          const cell = tr.insertCell();
          setPart11(cell, "table.cell");
          setViewerText10(cell, value2);
        }
      }
    };
    const first = await model.first(0, scope.signal);
    render(first.items);
    const next = element10(root2, "button", {
      text: "Next rows",
      part: "table.next"
    });
    next.type = "button";
    next.disabled = first.nextCursor === void 0;
    const advance = async () => {
      const page = await model.next(scope.signal);
      if (page === void 0) {
        next.disabled = true;
        return;
      }
      render(page.items);
      next.disabled = page.nextCursor === void 0;
    };
    next.addEventListener("click", advance);
    scope.cleanup(() => next.removeEventListener("click", advance));
    return createViewerMount8(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});

// packages/ui/dist/text-virtual/index.js
var PARTS12 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET12 = new Set(PARTS12);
var PART_ATTRIBUTE12 = "data-mk-part";
var STATE_ATTRIBUTE12 = "data-mk-state";
var STATES12 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET12 = new Set(STATES12);
function setPart12(element22, part) {
  if (!PART_SET12.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE12, part);
}
function setState12(element22, states) {
  for (const state of states) {
    if (!STATE_SET12.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE12);
  else element22.setAttribute(STATE_ATTRIBUTE12, [...new Set(states)].join(" "));
}
var VIEWER_CSP12 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR12 = Object.freeze({
  ...VIEWER_CSP12,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText12 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT12 = policyText12(VIEWER_CSP12);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT12 = policyText12(VIEWER_CSP_TRUSTED_EDITOR12);
var HOSTILE_TEXT12 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText12(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT12, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText11(node, value2, maximum) {
  node.textContent = safeViewerText12(value2, maximum);
}
function requireContainer10(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface10(container, label) {
  const host = requireContainer10(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart12(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element11(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText11(node, options.text);
  if (options.part !== void 0) setPart12(node, options.part);
  if (options.state !== void 0) setState12(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor8(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope10 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount9(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText12(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule9(module) {
  return Object.freeze(module);
}
function unknownSourceLease8(sources, slot, contract) {
  const binding = bindingFor8(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var VIRTUAL_TEXT_PAGE_BYTES = 64 * 1024;
var VirtualTextModel = class {
  constructor(source) {
    this.source = source;
  }
  source;
  #cursor;
  async first(line = 0, signal) {
    const page = await this.source.slice(
      { kind: "from-line", line, lineCount: 200, maxBytes: VIRTUAL_TEXT_PAGE_BYTES },
      signal
    );
    this.#cursor = page.complete ? void 0 : page.nextCursor;
    return page;
  }
  async next(signal) {
    if (this.#cursor === void 0) return void 0;
    const page = await this.source.slice(
      { kind: "from-cursor", cursor: this.#cursor, maxBytes: VIRTUAL_TEXT_PAGE_BYTES },
      signal
    );
    this.#cursor = page.complete ? void 0 : page.nextCursor;
    return page;
  }
};
var virtualTextViewer = defineViewerModule9({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope10(args.signal);
    const root2 = createSurface10(args.container, "Virtual text viewer");
    const lease = await unknownSourceLease8(args.sources, args.slot, "common.view/text-data-source");
    if (lease === void 0) throw new TypeError("virtual text binding is unavailable");
    scope.lease(lease);
    const model = new VirtualTextModel(lease.value);
    const viewport = element11(root2, "pre", {
      className: "modkit-viewer__virtual-text",
      part: "virtual-text"
    });
    viewport.tabIndex = 0;
    viewport.setAttribute("aria-live", "polite");
    const more = element11(root2, "button", { text: "Load next page" });
    more.type = "button";
    const renderPage = (page, append) => {
      if (page === void 0) {
        more.disabled = true;
        return;
      }
      const text = append ? `${viewport.textContent ?? ""}${page.text}` : page.text;
      setViewerText11(viewport, text, 2 * VIRTUAL_TEXT_PAGE_BYTES);
      more.disabled = page.complete;
      viewport.dataset["fromLine"] = String(page.fromLine);
    };
    renderPage(await model.first(0, scope.signal), false);
    const next = async () => renderPage(await model.next(scope.signal), true);
    more.addEventListener("click", next);
    scope.cleanup(() => more.removeEventListener("click", next));
    return createViewerMount9(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});

// packages/ui/dist/tree/index.js
var PARTS13 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET13 = new Set(PARTS13);
var PART_ATTRIBUTE13 = "data-mk-part";
var STATE_ATTRIBUTE13 = "data-mk-state";
var STATES13 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET13 = new Set(STATES13);
function setPart13(element22, part) {
  if (!PART_SET13.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE13, part);
}
function setState13(element22, states) {
  for (const state of states) {
    if (!STATE_SET13.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE13);
  else element22.setAttribute(STATE_ATTRIBUTE13, [...new Set(states)].join(" "));
}
var VIEWER_CSP13 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR13 = Object.freeze({
  ...VIEWER_CSP13,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText13 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT13 = policyText13(VIEWER_CSP13);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT13 = policyText13(VIEWER_CSP_TRUSTED_EDITOR13);
var HOSTILE_TEXT13 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText13(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT13, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText12(node, value2, maximum) {
  node.textContent = safeViewerText13(value2, maximum);
}
function requireContainer11(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface11(container, label) {
  const host = requireContainer11(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart13(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element12(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText12(node, options.text);
  if (options.part !== void 0) setPart13(node, options.part);
  if (options.state !== void 0) setState13(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor9(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope11 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount10(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText13(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule10(module) {
  return Object.freeze(module);
}
function unknownSourceLease9(sources, slot, contract) {
  const binding = bindingFor9(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var LazyTreeModel = class {
  constructor(source) {
    this.source = source;
  }
  source;
  #facts = /* @__PURE__ */ new Map();
  root() {
    return this.source.root();
  }
  async facts(node) {
    const existing = this.#facts.get(node.id);
    if (existing !== void 0) return existing;
    const value2 = await this.source.facts(node);
    this.#facts.set(node.id, value2);
    return value2;
  }
  children(node, cursor2, signal) {
    return this.source.children(
      node,
      { limit: 200, ...cursor2 === void 0 ? {} : { cursor: cursor2 } },
      signal
    );
  }
};
var treeViewer = defineViewerModule10({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope11(args.signal);
    const root2 = createSurface11(args.container, "Tree viewer");
    root2.setAttribute("role", "tree");
    const lease = await unknownSourceLease9(args.sources, args.slot, "common.view/tree-data-source");
    if (lease === void 0) throw new TypeError("tree binding is unavailable");
    scope.lease(lease);
    const model = new LazyTreeModel(lease.value);
    const list = element12(root2, "ul", { className: "modkit-viewer__tree", part: "tree.list" });
    list.setAttribute("role", "group");
    const renderNode = async (node, parent) => {
      const facts = await model.facts(node);
      const item = element12(parent, "li", { part: "tree.item" });
      item.setAttribute("role", "treeitem");
      item.dataset["nodeId"] = node.id;
      item.setAttribute("aria-expanded", node.hasChildren ? "false" : "undefined");
      const label = element12(item, "button", {
        text: facts.label,
        part: "tree.label"
      });
      label.type = "button";
      label.disabled = !node.hasChildren;
      if (facts.preview !== void 0) label.title = facts.preview;
      const children = element12(item, "ul", { part: "tree.children" });
      children.hidden = true;
      children.setAttribute("role", "group");
      let loaded = false;
      const expand = async () => {
        if (!loaded) {
          const page = await model.children(node, void 0, scope.signal);
          for (const child of page.items) await renderNode(child, children);
          loaded = true;
        }
        children.hidden = !children.hidden;
        item.setAttribute("aria-expanded", String(!children.hidden));
      };
      label.addEventListener("click", expand);
      scope.cleanup(() => label.removeEventListener("click", expand));
      setViewerText12(label, facts.label);
    };
    await renderNode(await model.root(), list);
    return createViewerMount10(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});

// packages/ui/dist/vector/index.js
var PARTS14 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET14 = new Set(PARTS14);
var PART_ATTRIBUTE14 = "data-mk-part";
var STATE_ATTRIBUTE14 = "data-mk-state";
var STATES14 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET14 = new Set(STATES14);
function setPart14(element22, part) {
  if (!PART_SET14.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE14, part);
}
function setState14(element22, states) {
  for (const state of states) {
    if (!STATE_SET14.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE14);
  else element22.setAttribute(STATE_ATTRIBUTE14, [...new Set(states)].join(" "));
}
var VIEWER_CSP14 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR14 = Object.freeze({
  ...VIEWER_CSP14,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText14 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT14 = policyText14(VIEWER_CSP14);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT14 = policyText14(VIEWER_CSP_TRUSTED_EDITOR14);
var HOSTILE_TEXT14 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText14(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT14, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText13(node, value2, maximum) {
  node.textContent = safeViewerText14(value2, maximum);
}
function requireContainer12(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface12(container, label) {
  const host = requireContainer12(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart14(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element13(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText13(node, options.text);
  if (options.part !== void 0) setPart14(node, options.part);
  if (options.state !== void 0) setState14(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor10(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope12 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount11(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText14(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule11(module) {
  return Object.freeze(module);
}
function unknownSourceLease10(sources, slot, contract) {
  const binding = bindingFor10(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var VECTOR_MAXIMUM_TEXT_BYTES = 32 * 1024 * 1024;
var vectorViewer = defineViewerModule11({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope12(args.signal);
    const root2 = createSurface12(args.container, "Vector viewer");
    const stage = element13(root2, "div", { part: "vector" });
    const readout = element13(stage, "output", { part: "vector.readout" });
    const image = element13(stage, "img", { part: "vector.image" });
    image.alt = "Vector scene preview";
    const lease = await unknownSourceLease10(
      args.sources,
      args.slot,
      "common.view/vector-scene-source"
    );
    if (lease === void 0) throw new TypeError("vector binding is unavailable");
    scope.lease(lease);
    setState14(stage, ["loading"]);
    try {
      const source = lease.value;
      const [info, document2] = await Promise.all([
        source.info(scope.signal),
        source.document(scope.signal)
      ]);
      if (document2.profile !== "uvg.secure-static.v1") {
        throw new TypeError(`unsupported vector security profile ${document2.profile}`);
      }
      const textBytes = new TextEncoder().encode(document2.text).byteLength;
      if (textBytes > VECTOR_MAXIMUM_TEXT_BYTES) {
        throw new RangeError(`vector document exceeds the stage budget: ${textBytes} bytes`);
      }
      const objectUrl = URL.createObjectURL(
        new Blob([document2.text], { type: `${document2.mediaType};charset=utf-8` })
      );
      image.src = objectUrl;
      scope.cleanup(() => URL.revokeObjectURL(objectUrl));
      setViewerText13(
        readout,
        `${info.nodes} nodes \xB7 ${info.paths} paths \xB7 ${info.shapes} shapes \xB7 ${info.textNodes} text nodes`
      );
      setState14(stage, []);
    } catch (error) {
      setState14(stage, ["error"]);
      image.remove();
      element13(stage, "p", {
        part: "viewer.empty",
        text: `The vector scene cannot be rendered safely: ${error instanceof Error ? error.message : String(error)}`
      });
    }
    return createViewerMount11(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});

// packages/ui/dist/video/index.js
async function collectEncodedMedia3(source, maximumBytes, signal) {
  const descriptor = await source.descriptor();
  if (descriptor.bytes > BigInt(maximumBytes) || descriptor.bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`encoded media exceeds the stage budget: ${descriptor.bytes} bytes`);
  }
  const total = Number(descriptor.bytes);
  const bytes = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
    const chunk = await source.read(BigInt(offset), Math.min(1024 * 1024, total - offset), signal);
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError("encoded media ended outside its declared size");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { mediaType: descriptor.mediaType, bytes };
}
var PARTS15 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET15 = new Set(PARTS15);
var PART_ATTRIBUTE15 = "data-mk-part";
var STATE_ATTRIBUTE15 = "data-mk-state";
var STATES15 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET15 = new Set(STATES15);
function setPart15(element22, part) {
  if (!PART_SET15.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE15, part);
}
function setState15(element22, states) {
  for (const state of states) {
    if (!STATE_SET15.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE15);
  else element22.setAttribute(STATE_ATTRIBUTE15, [...new Set(states)].join(" "));
}
var VIEWER_CSP15 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR15 = Object.freeze({
  ...VIEWER_CSP15,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText15 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT15 = policyText15(VIEWER_CSP15);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT15 = policyText15(VIEWER_CSP_TRUSTED_EDITOR15);
var HOSTILE_TEXT15 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText15(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT15, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText14(node, value2, maximum) {
  node.textContent = safeViewerText15(value2, maximum);
}
function requireContainer13(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface13(container, label) {
  const host = requireContainer13(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart15(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element14(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText14(node, options.text);
  if (options.part !== void 0) setPart15(node, options.part);
  if (options.state !== void 0) setState15(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor11(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope13 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount12(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText15(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule12(module) {
  return Object.freeze(module);
}
function unknownSourceLease11(sources, slot, contract) {
  const binding = bindingFor11(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
var VIDEO_MAXIMUM_BYTES = 256 * 1024 * 1024;
var videoViewer = defineViewerModule12({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope13(args.signal);
    const root2 = createSurface13(args.container, "Video viewer");
    const stage = element14(root2, "div", { part: "video" });
    const readout = element14(stage, "output", { part: "video.readout" });
    const player = element14(stage, "video", { part: "video.player" });
    player.controls = true;
    player.preload = "metadata";
    const lease = await unknownSourceLease11(
      args.sources,
      args.slot,
      "common.view/video-media-source"
    );
    if (lease === void 0) throw new TypeError("video binding is unavailable");
    scope.lease(lease);
    setState15(stage, ["loading"]);
    try {
      const source = lease.value;
      const [info, encoded] = await Promise.all([
        source.info(scope.signal),
        source.encoded(scope.signal)
      ]);
      const media = await collectEncodedMedia3(encoded, VIDEO_MAXIMUM_BYTES, scope.signal);
      const objectUrl = URL.createObjectURL(
        new Blob([media.bytes], { type: media.mediaType })
      );
      player.src = objectUrl;
      scope.cleanup(() => URL.revokeObjectURL(objectUrl));
      setViewerText14(
        readout,
        `${info.tracks.filter((track) => track.kind === "video").length} video \xB7 ${info.tracks.filter((track) => track.kind === "audio").length} audio \xB7 ${info.durationMs === "unknown" ? "duration unknown" : `${info.durationMs} ms`}`
      );
      setState15(stage, []);
    } catch (error) {
      setState15(stage, ["error"]);
      player.remove();
      element14(stage, "p", {
        part: "viewer.empty",
        text: `The platform cannot play this video representation: ${error instanceof Error ? error.message : String(error)}`
      });
    }
    return createViewerMount12(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});

// apps/modkit-vscode/src/view-policy.ts
var STAGE_ORDER = Object.freeze([
  "image",
  "vector",
  "model",
  "audio",
  "video",
  "entries",
  "table",
  "tree",
  "text",
  "text-virtual",
  "text-editor",
  "edit",
  "metadata",
  "hex",
  "hex-editor"
]);
var EDITABLE_STAGE_IDS = Object.freeze([
  "text-editor",
  "edit",
  "hex-editor"
]);
var stageIdOf = (stage) => stage.id ?? stage.contract;
function descriptorOperations(descriptor) {
  const operations = descriptor["operations"];
  if (!Array.isArray(operations)) return [];
  return operations.map((item) => {
    const value2 = item;
    return {
      id: String(value2["id"] ?? ""),
      handlerId: String(value2["handlerId"] ?? ""),
      mutatesSource: value2["mutatesSource"] === true,
      state: String(value2["state"] ?? "")
    };
  });
}
function orderStages(stages) {
  const seen = /* @__PURE__ */ new Set();
  for (const stage of stages) {
    const id = stageIdOf(stage);
    if (!STAGE_ORDER.includes(id)) throw new TypeError(`stage ${id} is not ranked in STAGE_ORDER`);
    if (seen.has(id)) throw new TypeError(`duplicate stage id: ${id}`);
    seen.add(id);
  }
  return Object.freeze(
    [...stages].sort(
      (left, right) => STAGE_ORDER.indexOf(stageIdOf(left)) - STAGE_ORDER.indexOf(stageIdOf(right))
    )
  );
}
function preferredStage(applicable, planActive) {
  if (planActive !== void 0 && applicable.includes(planActive)) return planActive;
  return applicable[0];
}

// packages/ui/dist/viewer/index.js
var PARTS16 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET16 = new Set(PARTS16);
var PART_ATTRIBUTE16 = "data-mk-part";
var STATE_ATTRIBUTE16 = "data-mk-state";
var STATES16 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET16 = new Set(STATES16);
function setPart16(element22, part) {
  if (!PART_SET16.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE16, part);
}
function setState16(element22, states) {
  for (const state of states) {
    if (!STATE_SET16.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE16);
  else element22.setAttribute(STATE_ATTRIBUTE16, [...new Set(states)].join(" "));
}
var VIEWER_CSP16 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR16 = Object.freeze({
  ...VIEWER_CSP16,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText16 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT16 = policyText16(VIEWER_CSP16);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT16 = policyText16(VIEWER_CSP_TRUSTED_EDITOR16);
var HOSTILE_TEXT16 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText16(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT16, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText15(node, value2, maximum) {
  node.textContent = safeViewerText16(value2, maximum);
}
function requireContainer14(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface14(container, label) {
  const host = requireContainer14(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart16(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element15(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText15(node, options.text);
  if (options.part !== void 0) setPart16(node, options.part);
  if (options.state !== void 0) setState16(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor12(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope14 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function defineViewerModule13(module) {
  return Object.freeze(module);
}
function unknownSourceLease12(sources, slot, contract) {
  const binding = bindingFor12(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}

// packages/ui/dist/namespace/index.js
var PARTS17 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  // bounded + virtual text
  "text",
  "text.line",
  "virtual-text",
  "virtual-text.line",
  // hex
  "hex",
  "hex.toolbar",
  "hex.offset-input",
  "hex.go",
  "hex.content",
  "hex.row",
  "hex.gutter",
  "hex.cell",
  "hex.ascii",
  // tree
  "tree",
  "tree.list",
  "tree.item",
  "tree.label",
  "tree.children",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // namespace
  "namespace",
  "namespace.list",
  "namespace.item",
  "namespace.label",
  "namespace.detail",
  "namespace.children",
  // transport
  "transport",
  "transport.status",
  "transport.controls",
  "transport.button",
  "transport.track",
  // diagnostics panel
  "diagnostics",
  "diagnostics.group",
  "diagnostics.heading",
  "diagnostics.list",
  "diagnostics.item",
  "diagnostics.message",
  // operation toolbar
  "operations",
  "operations.status",
  "operations.button",
  // search field (PR3 member) and filter chrome
  "search",
  "search.input",
  "search.toggles",
  "search.toggle",
  "search.status",
  "search.nav",
  "search.message",
  "filter-bar",
  "filter-bar.facets",
  "filter-bar.facet",
  // format inspector
  "format",
  "format.header",
  "format.badge",
  "format.body",
  // metadata and properties (MK2 assets-viewer parity)
  "metadata",
  "metadata.group",
  "metadata.heading",
  "metadata.row",
  "metadata.label",
  "metadata.value",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  // image editing surface (MK2 assetsTextureViewer parity)
  "imageedit",
  "imageedit.tools",
  "imageedit.tool",
  "imageedit.options",
  "imageedit.swatch",
  "imageedit.size",
  "imageedit.actions",
  "imageedit.action",
  "imageedit.marquee",
  "imageedit.status",
  "imageedit.warning",
  // audio stage
  "audio",
  "audio.waveform",
  "audio.toolbar",
  "audio.readout",
  "audio.player",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // video stage
  "video",
  "video.player",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  // view gizmo — its own component, usable by any 3D stage
  "gizmo",
  "gizmo.svg",
  "gizmo.axis",
  "gizmo.handle",
  "gizmo.label",
  // archive explorer composite
  "archive",
  "archive.tree",
  "archive.entries",
  "archive.preview",
  // file tree (MK2 archive explorer chrome)
  "filetree",
  "filetree.toolbar",
  "filetree.list",
  "filetree.node",
  "filetree.row",
  "filetree.twisty",
  "filetree.icon",
  "filetree.label",
  "filetree.badge",
  "filetree.children",
  "filetree.empty",
  // explorer: tree + preview shell shared by every host that browses real files
  "explorer",
  "explorer.toolbar",
  "explorer.action",
  "explorer.sidebar",
  "explorer.preview",
  "explorer.dropzone",
  "explorer.status",
  "explorer.tabs",
  "explorer.tab",
  "explorer.stage",
  "explorer.placeholder",
  // preview header and view picker
  "explorer.header",
  "explorer.breadcrumb",
  "explorer.crumb",
  "explorer.viewpicker",
  // editor area: one or more groups, each with its own tab strip
  "explorer.editors",
  "explorer.group",
  "explorer.tabstrip",
  "explorer.filetab",
  "explorer.filetab-close",
  "explorer.tabcontent",
  "explorer.split",
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  "explorer.tabmenu",
  "explorer.tabmenu-item",
  // custom window chrome, drawn by the app when the native frame is hidden
  "titlebar",
  "titlebar.drag",
  "titlebar.title",
  "titlebar.controls",
  "titlebar.button",
  "titlebar.menu",
  "titlebar.menu-item",
  "titlebar.menu-panel",
  "titlebar.menu-entry",
  "titlebar.menu-separator",
  // settings surface
  "settings",
  "settings.groups",
  "settings.group",
  "settings.pane",
  "settings.row",
  "settings.label",
  "settings.description",
  "settings.control",
  "settings.select",
  "settings.input",
  "settings.list",
  "settings.extension",
  "settings.extension-text",
  "settings.toggle",
  "settings.remove",
  "settings.adder",
  "settings.add",
  "settings.close",
  "settings.status",
  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  "form",
  "form.row",
  "form.label",
  "form.description",
  "form.control",
  "form.input",
  "form.select",
  "form.actions",
  "form.button",
  "form.status",
  // collapsible property sections
  "accordion",
  "accordion.section",
  "accordion.header",
  "accordion.twisty",
  "accordion.title",
  "accordion.hint",
  "accordion.body",
  "accordion.field",
  "accordion.field-name",
  "accordion.field-value",
  // shell chrome
  "shell",
  "shell.header",
  "shell.breadcrumb",
  "shell.crumb",
  "shell.crumb-icon",
  "shell.crumb-more",
  "shell.footer",
  "shell.footer-start",
  "shell.footer-end",
  "shell.status-item",
  // application workbench
  "workbench",
  "workbench.titlebar",
  "workbench.activitybar",
  "workbench.sidebar",
  "workbench.main",
  "workbench.panel",
  "workbench.statusbar",
  "workbench.host-status",
  // view picker
  "viewpicker",
  "viewpicker.modes",
  "viewpicker.mode",
  "viewpicker.select",
  // subject card composition
  "card",
  "card.section",
  "card.header",
  "card.portrait",
  "card.identity",
  "card.title",
  "card.subtitle",
  "card.ref",
  "card.locale",
  "card.chips",
  "card.chip",
  "card.description",
  "card.note",
  "card.statrow",
  "card.stat",
  "card.stat-icon",
  "card.stat-value",
  "card.stat-delta",
  "card.grid",
  "card.grid-cell",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  // relation graph
  "graph",
  "graph.sidebar",
  "graph.sidebar-head",
  "graph.types",
  "graph.type",
  "graph.type-swatch",
  "graph.type-count",
  "graph.main",
  "graph.controls",
  "graph.control",
  "graph.canvas",
  "graph.status",
  "graph.hint",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET17 = new Set(PARTS17);
var PART_ATTRIBUTE17 = "data-mk-part";
var STATE_ATTRIBUTE17 = "data-mk-state";
var STATES17 = Object.freeze([
  "loading",
  "empty",
  "error",
  "disabled",
  "readonly",
  "truncated",
  "over-budget",
  "degraded",
  "active",
  "stale",
  "mutating",
  "invalid",
  "no-match",
  "selected",
  /** A drop is hovering over this surface and would be accepted. */
  "drop-target"
]);
var STATE_SET17 = new Set(STATES17);
function setPart17(element22, part) {
  if (!PART_SET17.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE17, part);
}
function setState17(element22, states) {
  for (const state of states) {
    if (!STATE_SET17.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE17);
  else element22.setAttribute(STATE_ATTRIBUTE17, [...new Set(states)].join(" "));
}
var VIEWER_CSP17 = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'"
});
var VIEWER_CSP_TRUSTED_EDITOR17 = Object.freeze({
  ...VIEWER_CSP17,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:"
});
var policyText17 = (policy) => Object.entries(policy).map(
  ([name, value2]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value2}`
).join("; ");
var VIEWER_CSP_TEXT17 = policyText17(VIEWER_CSP17);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT17 = policyText17(VIEWER_CSP_TRUSTED_EDITOR17);
var HOSTILE_TEXT17 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText17(value2, maximum = 1e6) {
  const text = String(value2);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT17, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText16(node, value2, maximum) {
  node.textContent = safeViewerText17(value2, maximum);
}
function requireContainer15(value2) {
  if (typeof value2 !== "object" || value2 === null || !("ownerDocument" in value2) || !("replaceChildren" in value2) || typeof value2.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value2;
}
function createSurface15(container, label) {
  const host = requireContainer15(container);
  const root2 = host.ownerDocument.createElement("section");
  root2.className = "modkit-viewer";
  root2.tabIndex = 0;
  root2.setAttribute("role", "region");
  root2.setAttribute("aria-label", label);
  root2.dataset["modkitViewer"] = label;
  setPart17(root2, "viewer");
  host.replaceChildren(root2);
  return root2;
}
function element16(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText16(node, options.text);
  if (options.part !== void 0) setPart17(node, options.part);
  if (options.state !== void 0) setState17(node, options.state);
  parent.append(node);
  return node;
}
function bindingFor13(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
var ViewerMountScope15 = class {
  controller = new AbortController();
  signal = this.controller.signal;
  #leases = [];
  #cleanup = [];
  #closed = false;
  constructor(parent) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent !== void 0) {
      const abort = () => this.controller.abort(parent.reason);
      parent.addEventListener("abort", abort, { once: true });
      this.#cleanup.push(() => parent.removeEventListener("abort", abort));
    }
  }
  lease(lease) {
    this.#leases.push(lease);
    return lease;
  }
  cleanup(callback) {
    this.#cleanup.push(callback);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse()) await callback();
    for (const lease of this.#leases.reverse()) await lease.release();
  }
};
function createViewerMount13(root2, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root2.setAttribute("aria-label", safeViewerText17(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root2.remove();
    }
  });
}
function defineViewerModule14(module) {
  return Object.freeze(module);
}
function unknownSourceLease13(sources, slot, contract) {
  const binding = bindingFor13(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
function normalizeNamespacePath(value2) {
  if (value2.includes("\\") || value2.startsWith("/") || value2.includes("\0")) {
    throw new TypeError("namespace path is not relative and portable");
  }
  const parts = value2.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) throw new TypeError("namespace traversal is forbidden");
  return parts.join("/");
}
var NamespaceModel = class {
  constructor(source) {
    this.source = source;
  }
  source;
  #identities = /* @__PURE__ */ new Map();
  async list(prefix, cursor2, signal) {
    const normalized = normalizeNamespacePath(prefix);
    const page = await this.source.list(
      normalized,
      { limit: 200, ...cursor2 === void 0 ? {} : { cursor: cursor2 } },
      signal
    );
    for (const entry of page.items) {
      const path = normalizeNamespacePath(entry.path);
      const identity = `${path}\0${entry.revision}`;
      const existing = this.#identities.get(entry.id);
      if (existing !== void 0 && existing !== identity) {
        throw new TypeError(`namespace entry identity changed: ${entry.id}`);
      }
      this.#identities.set(entry.id, identity);
    }
    return page;
  }
};
var namespaceViewer = defineViewerModule14({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope15(args.signal);
    const root2 = createSurface15(args.container, "Namespace tree");
    root2.setAttribute("role", "tree");
    const lease = await unknownSourceLease13(
      args.sources,
      args.slot,
      "common.view/namespace-entry-source"
    );
    if (lease === void 0) throw new TypeError("namespace binding is unavailable");
    scope.lease(lease);
    const source = lease.value;
    const model = new NamespaceModel(source);
    const list = element16(root2, "ul", { part: "namespace.list" });
    list.setAttribute("role", "group");
    const renderPrefix = async (prefix, parent) => {
      const page = await model.list(prefix, void 0, scope.signal);
      const seen = /* @__PURE__ */ new Set();
      for (const entry of page.items) {
        if (seen.has(entry.id)) throw new TypeError(`duplicate namespace entry id: ${entry.id}`);
        seen.add(entry.id);
        const item = element16(parent, "li", { part: "namespace.item" });
        item.setAttribute("role", "treeitem");
        item.dataset["entryId"] = entry.id;
        item.dataset["revision"] = entry.revision;
        const button = element16(item, "button", {
          text: entry.name,
          part: "namespace.label"
        });
        button.type = "button";
        const detail = describeEntry(entry);
        if (detail !== "") {
          setViewerText16(element16(item, "span", { part: "namespace.detail" }), detail);
        }
        const activate = async () => {
          if (entry.kind === "directory") {
            let nested = item.querySelector(":scope > ul");
            if (nested === null) {
              nested = element16(item, "ul", { part: "namespace.children" });
              nested.setAttribute("role", "group");
              await renderPrefix(entry.path, nested);
            }
            nested.hidden = !nested.hidden;
            return;
          }
          const opened = await source.openEntry(entry.id, scope.signal);
          try {
            root2.dispatchEvent(
              new CustomEvent("modkit-open-source", {
                bubbles: true,
                detail: { source: opened.value, entryId: entry.id, revision: entry.revision }
              })
            );
          } finally {
            await opened.release();
          }
        };
        button.addEventListener("click", activate);
        scope.cleanup(() => button.removeEventListener("click", activate));
        setViewerText16(button, entry.name);
      }
    };
    await renderPrefix("", list);
    return createViewerMount13(root2, scope, args, ({ descriptor }) => {
      root2.dataset["revision"] = descriptor.revision;
    });
  }
});
function formatEntryBytes(value2) {
  if (value2 < 1024n) return `${value2} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let scaled = Number(value2) / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(1)} ${units[unit]}`;
}
function describeEntry(entry) {
  if (entry.kind === "directory") return "";
  const parts = [];
  if (entry.size !== void 0) parts.push(formatEntryBytes(entry.size));
  if (entry.compression !== void 0) {
    parts.push(
      entry.storedSize === void 0 ? entry.compression : `${entry.compression} ${formatEntryBytes(entry.storedSize)}`
    );
  } else if (entry.storedSize !== void 0) {
    parts.push(`stored ${formatEntryBytes(entry.storedSize)}`);
  }
  if (entry.modifiedAt !== void 0) {
    parts.push(`${new Date(entry.modifiedAt).toISOString().replace("T", " ").slice(0, 19)} UTC`);
  }
  if (entry.checksum !== void 0)
    parts.push(`${entry.checksum.algorithm} ${entry.checksum.value}`);
  return parts.join(" \xB7 ");
}

// apps/modkit-vscode/src/archive-entry.ts
var ARCHIVE_ENTRY_PREVIEW_BYTES = 64 * 1024;
var ARCHIVE_LISTING_PAGES = 25;
function findArchiveExtractOperation(operations) {
  return operations.find(
    (operation) => operation.state === "available" && !operation.mutatesSource && operation.id === CONTAINER_EXTRACT_OPERATION_ID
  );
}
function previewText(bytes) {
  if (bytes.includes(0)) return void 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return void 0;
  }
}
function hexDump(bytes) {
  const lines = [];
  for (let index = 0; index < bytes.length; index += 16) {
    const chunk = bytes.slice(index, index + 16);
    const address = index.toString(16).padStart(8, "0");
    const hex = [...chunk].map((value2) => value2.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...chunk].map((value2) => value2 >= 32 && value2 <= 126 ? String.fromCharCode(value2) : ".").join("");
    lines.push(`${address}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join("\n");
}

// apps/modkit-vscode/src/archive-stage.ts
var vscodeArchiveStage = defineViewerModule13({
  abiVersion: 1,
  async mount(args) {
    const container = requireContainer14(args.container);
    container.replaceChildren();
    const treeHost = container.ownerDocument.createElement("div");
    treeHost.className = "vscode-stage-part";
    const entryHost = container.ownerDocument.createElement("div");
    entryHost.className = "vscode-stage-part vscode-archive-entry";
    container.append(treeHost, entryHost);
    const tree = await namespaceViewer.mount({ ...args, container: treeHost });
    const status = element15(entryHost, "output", { part: "viewer.status" });
    const body = element15(entryHost, "pre", { part: "hex.content" });
    setViewerText15(status, "Pick an entry in the tree to inspect it.");
    const lease = await unknownSourceLease12(
      args.sources,
      args.slot,
      "common.view/namespace-entry-source"
    );
    const source = lease?.value;
    const paths = /* @__PURE__ */ new Map();
    const pathFor = async (entryId) => {
      const known = paths.get(entryId);
      if (known !== void 0 || source === void 0) return known;
      let cursor2;
      for (let page = 0; page < ARCHIVE_LISTING_PAGES; page += 1) {
        const listed = await source.list(
          "",
          { limit: 200, ...cursor2 === void 0 ? {} : { cursor: cursor2 } },
          args.signal
        );
        for (const item of listed.items) paths.set(item.id, item.path);
        const found = paths.get(entryId);
        if (found !== void 0) return found;
        cursor2 = listed.nextCursor;
        if (cursor2 === void 0) break;
      }
      return void 0;
    };
    const extract = findArchiveExtractOperation(args.descriptor.operations);
    const show = (detail) => {
      const reference = detail.source;
      const entryId = String(detail.entryId ?? "");
      setViewerText15(
        status,
        `${entryId} \u2192 ${reference?.uri ?? "no source reference"}${extract === void 0 ? " \xB7 this subject declares no available container.extract operation, so bytes are unavailable" : ""}`
      );
      if (extract === void 0) {
        setViewerText15(body, "");
        return;
      }
      void (async () => {
        try {
          const path = await pathFor(entryId);
          if (path === void 0) {
            setViewerText15(body, `the namespace does not list an entry with id ${entryId}`);
            return;
          }
          const input = { entryId };
          const result = await args.operations.invoke(extract.handlerId, input, {
            ...args.signal === void 0 ? {} : { signal: args.signal }
          });
          if (result.state !== "ok" || result.output.kind !== "bytes") {
            setViewerText15(
              body,
              result.state === "ok" ? `the operation answered ${result.output.kind}, not bytes` : `rejected: ${result.reason}`
            );
            return;
          }
          const bytes = result.output.value.slice(0, ARCHIVE_ENTRY_PREVIEW_BYTES);
          const text = previewText(bytes);
          setViewerText15(body, text ?? hexDump(bytes), ARCHIVE_ENTRY_PREVIEW_BYTES * 4);
          setViewerText15(
            status,
            `${path} \xB7 ${result.output.value.length} bytes \xB7 shown as ${text === void 0 ? "hex" : "text"}`
          );
        } catch (error) {
          setViewerText15(
            body,
            `entry read failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })();
    };
    const listener = (event) => {
      const detail = event.detail;
      if (detail !== void 0) show(detail);
    };
    treeHost.addEventListener("modkit-open-source", listener);
    return {
      async update(next) {
        await tree.update(next);
      },
      async unmount() {
        treeHost.removeEventListener("modkit-open-source", listener);
        await tree.unmount();
        container.replaceChildren();
      }
    };
  }
});

// apps/modkit-vscode/src/edit-operations.ts
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64OfUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at] ?? 0;
    const second = bytes[at + 1];
    const third = bytes[at + 2];
    const triple = first << 16 | (second ?? 0) << 8 | (third ?? 0);
    out += BASE64[triple >> 18 & 63] ?? "";
    out += BASE64[triple >> 12 & 63] ?? "";
    out += second === void 0 ? "=" : BASE64[triple >> 6 & 63] ?? "";
    out += third === void 0 ? "=" : BASE64[triple & 63] ?? "";
  }
  return out;
}
var required = (values, name, label) => {
  const value2 = values.get(name) ?? "";
  if (value2 === "") throw new TypeError(`${label} is required`);
  return value2;
};
var field = (name, label, initial, options = {}) => Object.freeze({
  name,
  label,
  kind: options.kind ?? "text",
  initial,
  required: true,
  ...options.hint === void 0 ? {} : { hint: options.hint }
});
var form = (definition) => Object.freeze(definition);
var FORMS_BY_HANDLER = /* @__PURE__ */ new Map([
  [
    "set-text",
    Object.freeze([
      form({
        id: "png-set-text",
        label: "Set a PNG text field",
        operationId: "edit.field",
        handlerId: "set-text",
        summary: "Sets or replaces one tEXt chunk; every other byte of the file is kept.",
        fields: Object.freeze([
          field("keyword", "Keyword", "Description", {
            hint: "1\u201379 Latin-1 characters, no NUL (Title, Author, Description, \u2026)"
          }),
          field("text", "Text", "set from the Modkit inspector", { hint: "Latin-1, no NUL" })
        ]),
        build: (values) => ({
          keyword: required(values, "keyword", "Keyword"),
          text: values.get("text") ?? ""
        })
      })
    ])
  ],
  [
    "set-text-frame",
    Object.freeze([
      form({
        id: "mp3-set-text-frame",
        label: "Set an ID3v2 text frame",
        operationId: "edit.field",
        handlerId: "set-text-frame",
        summary: "Sets or replaces one ID3v2 text frame, creating the tag when absent; audio bytes stay in place.",
        fields: Object.freeze([
          field("keyword", "Frame", "TIT2", {
            hint: "a four-character text frame id: TIT2, TPE1, TALB, \u2026"
          }),
          field("text", "Text", "set from the Modkit inspector")
        ]),
        build: (values) => ({
          keyword: required(values, "keyword", "Frame"),
          text: values.get("text") ?? ""
        })
      })
    ])
  ],
  [
    "set-comment",
    Object.freeze([
      form({
        id: "jpeg-set-comment",
        label: "Set the JPEG comment",
        operationId: "edit.field",
        handlerId: "set-comment",
        summary: "Writes the COM segment after the APP block, replacing it when it exists.",
        fields: Object.freeze([field("text", "Comment", "set from the Modkit inspector")]),
        build: (values) => ({ text: values.get("text") ?? "" })
      })
    ])
  ],
  [
    "remove-segment",
    Object.freeze([
      form({
        id: "jpeg-remove-segment",
        label: "Remove a JPEG metadata segment",
        operationId: "edit.structure",
        handlerId: "remove-segment",
        summary: "Drops one metadata segment; image-bearing markers are refused by the codec.",
        fields: Object.freeze([
          field("marker", "Marker", "APP0", {
            hint: "a metadata marker name, e.g. APP0, APP1, COM"
          })
        ]),
        build: (values) => ({ marker: required(values, "marker", "Marker") })
      })
    ])
  ],
  [
    "edit-structure",
    Object.freeze([
      form({
        id: "zip-add-entry",
        label: "Add an entry to the archive",
        operationId: "edit.structure",
        handlerId: "edit-structure",
        summary: "Adds one stored entry and repacks; kept entries retain their bytes.",
        fields: Object.freeze([
          field("path", "Entry path", "added/hello.txt", { hint: "a path inside the archive" }),
          field("content", "Contents", "added from the Modkit inspector", {
            kind: "content",
            hint: "text sent to the codec as UTF-8 bytes"
          })
        ]),
        build: (values) => ({
          add: [
            {
              path: required(values, "path", "Entry path"),
              bytes: base64OfUtf8(values.get("content") ?? "")
            }
          ]
        })
      }),
      form({
        id: "zip-remove-entry",
        label: "Remove an entry from the archive",
        operationId: "edit.structure",
        handlerId: "edit-structure",
        summary: "Removes one entry and repacks; other entries retain their bytes.",
        fields: Object.freeze([field("path", "Entry path", "readme.txt")]),
        build: (values) => ({ remove: [required(values, "path", "Entry path")] })
      }),
      form({
        id: "zip-rename-entry",
        label: "Rename an entry in the archive",
        operationId: "edit.structure",
        handlerId: "edit-structure",
        summary: "Renames one entry without touching its payload or compression.",
        fields: Object.freeze([
          field("from", "From", "readme.txt"),
          field("to", "To", "docs/readme.txt")
        ]),
        build: (values) => ({
          rename: [{ from: required(values, "from", "From"), to: required(values, "to", "To") }]
        })
      })
    ])
  ],
  [
    "edit-content",
    Object.freeze([
      form({
        id: "zip-replace-entry",
        label: "Replace an entry's contents",
        operationId: "edit.content",
        handlerId: "edit-content",
        summary: "Replaces one file entry's payload; nothing else moves.",
        fields: Object.freeze([
          field("path", "Entry path", "readme.txt"),
          field("content", "Contents", "replaced from the Modkit inspector", {
            kind: "content",
            hint: "text sent to the codec as UTF-8 bytes"
          })
        ]),
        build: (values) => ({
          path: required(values, "path", "Entry path"),
          bytes: base64OfUtf8(values.get("content") ?? "")
        })
      })
    ])
  ]
]);
var EDIT_FORM_IDS = Object.freeze(
  [...FORMS_BY_HANDLER.values()].flatMap((forms) => forms.map((item) => item.id))
);
function editOffer(descriptor, options) {
  if (!options.editable) return Object.freeze({ forms: [], unsupported: [] });
  const forms = [];
  const unsupported = [];
  for (const operation of descriptorOperations(descriptor)) {
    if (!operation.mutatesSource || operation.state !== "available") continue;
    const known = FORMS_BY_HANDLER.get(operation.handlerId)?.filter(
      (item) => item.operationId === operation.id
    );
    if (known === void 0 || known.length === 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: `this host cannot construct the input for \xAB${operation.handlerId}\xBB yet`
      });
      continue;
    }
    forms.push(...known);
  }
  return Object.freeze({ forms: Object.freeze(forms), unsupported: Object.freeze(unsupported) });
}
var INVOKE_REASONS = Object.freeze({
  "not-declared": "this codec does not declare that operation",
  disabled: "the codec disabled this operation for this file",
  "dependency-required": "the operation needs a dependency this host has not resolved",
  "permission-missing": "this session was not opened with permission to write the file",
  "input-not-serializable": "the values could not be sent to the codec",
  "handler-unregistered": "the codec registered no handler for that operation",
  cancelled: "the operation was cancelled",
  "stale-revision": "the file changed on disk after it was opened"
});
function invokeRefusalMessage(result) {
  const plain = INVOKE_REASONS[result.reason];
  const detail = result.diagnostics?.[0]?.message;
  const head = plain === void 0 ? result.reason : `${plain} (${result.reason})`;
  return detail === void 0 ? `refused: ${head}` : `refused: ${head} \u2014 ${detail}`;
}
function editPlanFromOperationOutput(output) {
  const value2 = output;
  if (value2?.kind !== "edit-plan" || typeof value2.plan !== "object" || value2.plan === null) {
    throw new TypeError(
      `the operation returned \xAB${String(value2?.kind ?? "nothing")}\xBB, not an edit plan`
    );
  }
  return value2.plan;
}
var isRejected = (result) => result.state === "rejected";

// apps/modkit-vscode/src/edit-panel.ts
var asRecord = (descriptor) => descriptor;
function fidelityNote(plan) {
  if (plan.fidelity.preservesUnknownData) return "";
  const notes = plan.fidelity.notes ?? [];
  return notes.length === 0 ? " (this rewrite does not keep bytes the format does not account for)" : ` (${notes.join("; ")})`;
}
function createVsCodeEditPanel(options) {
  return defineViewerModule13({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope14(args.signal);
      const root2 = createSurface14(args.container, "Edit");
      const descriptor = asRecord(args.descriptor);
      const ports = options.portsFor(descriptor);
      const offer = editOffer(descriptor, { editable: ports !== void 0 });
      const chooser = element15(root2, "div", { part: "form.row" });
      element15(chooser, "label", { part: "form.label", text: "Operation" });
      const picker = element15(chooser, "select", { part: "form.select" });
      if (!(picker instanceof HTMLSelectElement)) throw new TypeError("no select element");
      picker.setAttribute("aria-label", "Mutating operation");
      const summary = element15(root2, "p", { part: "form.description" });
      const pane = element15(root2, "div", { part: "settings.pane" });
      const actions = element15(root2, "div", { part: "form.actions" });
      const apply = element15(actions, "button", { part: "form.button", text: "Apply" });
      apply.setAttribute("type", "button");
      const status = element15(root2, "output", { part: "form.status" });
      const notes = element15(root2, "div");
      const say = (message, failed) => {
        setViewerText15(status, message);
        setState16(status, failed ? ["error"] : []);
        options.onStatus?.({ message, failed });
      };
      const drawNotes = () => {
        notes.replaceChildren();
        const previous = options.lastOutcome(descriptor);
        if (previous !== void 0) {
          element15(notes, "div", { part: "form.description", text: `Last change: ${previous}` });
        }
        for (const item of offer.unsupported) {
          element15(notes, "div", {
            part: "form.description",
            text: `${item.operationId}: not available in this host yet \u2014 ${item.reason}`
          });
        }
      };
      const inputs = /* @__PURE__ */ new Map();
      const selectedForm = () => offer.forms.find((item) => item.id === picker.value) ?? offer.forms[0];
      const drawFields = () => {
        inputs.clear();
        pane.replaceChildren();
        const chosen = selectedForm();
        if (chosen === void 0) {
          setViewerText15(summary, "This subject declares no mutating operation this host can drive.");
          apply.setAttribute("disabled", "");
          return;
        }
        apply.removeAttribute("disabled");
        setViewerText15(summary, `${chosen.summary} (${chosen.operationId} \u2192 ${chosen.handlerId})`);
        for (const item of chosen.fields) {
          const row = element15(pane, "div", { part: "form.row" });
          element15(row, "label", { part: "form.label", text: item.label });
          const input = element15(row, "input", { part: "form.input" });
          if (!(input instanceof HTMLInputElement)) continue;
          input.type = "text";
          input.name = item.name;
          input.value = item.initial;
          input.setAttribute("aria-label", item.label);
          if (item.hint !== void 0) input.title = item.hint;
          inputs.set(item.name, input);
          if (item.hint !== void 0) {
            element15(row, "span", { part: "form.description", text: item.hint });
          }
        }
      };
      const run = async () => {
        const chosen = selectedForm();
        if (chosen === void 0 || ports === void 0) {
          say("this host holds no editing arm for the file, so nothing can be applied", true);
          return;
        }
        const values = /* @__PURE__ */ new Map();
        for (const [name, input2] of inputs) values.set(name, input2.value);
        let input;
        try {
          input = chosen.build(values);
        } catch (error) {
          say(`cannot apply: ${error instanceof Error ? error.message : String(error)}`, true);
          return;
        }
        say(`${chosen.label}: invoking ${chosen.handlerId}\u2026`, false);
        let result;
        try {
          result = await args.operations.invoke(chosen.handlerId, input, { signal: scope.signal });
        } catch (error) {
          say(
            `refused by the codec: ${error instanceof Error ? error.message : String(error)}`,
            true
          );
          return;
        }
        if (isRejected(result)) {
          say(invokeRefusalMessage(result), true);
          return;
        }
        let plan;
        try {
          plan = editPlanFromOperationOutput(result.output);
        } catch (error) {
          say(
            `the host refused the plan: ${error instanceof Error ? error.message : String(error)}`,
            true
          );
          return;
        }
        const applied = await ports.applyPlan(plan);
        if (applied.failed) {
          say(applied.message, true);
          return;
        }
        const outcome = `${chosen.label} \u2014 ${applied.message}${fidelityNote(plan)}`;
        options.recordOutcome(descriptor, outcome);
        say(`${outcome}; reopening the file to show it as it now is`, false);
        if (scope.signal.aborted) return;
        const reopened = await options.reopen(descriptor);
        if (!reopened && !scope.signal.aborted) {
          say(`${outcome}; the tab could not be reopened, so this view is stale`, true);
        }
      };
      apply.addEventListener("click", () => {
        apply.setAttribute("disabled", "");
        void run().catch((error) => {
          say(error instanceof Error ? error.message : String(error), true);
        }).finally(() => {
          if (!scope.signal.aborted) apply.removeAttribute("disabled");
        });
      });
      for (const item of offer.forms) {
        const option = element15(picker, "option", { text: item.label });
        option.setAttribute("value", item.id);
      }
      picker.addEventListener("change", drawFields);
      drawFields();
      drawNotes();
      const declared = descriptorOperations(descriptor).filter((item) => item.mutatesSource).length;
      if (offer.forms.length === 0) {
        setState16(root2, ["degraded"]);
        say(
          offer.unsupported.length === 0 ? "nothing here can change this file" : `${offer.unsupported.length} of ${declared} mutating operation(s) declared, none drivable here`,
          false
        );
      } else {
        say(`${offer.forms.length} form(s) over ${declared} mutating operation(s)`, false);
      }
      return {
        async update() {
        },
        async unmount() {
          await scope.close();
          root2.remove();
        }
      };
    }
  });
}

// apps/modkit-vscode/src/stages.ts
function createVsCodePreviewStages(context) {
  return orderStages([
    {
      id: "image",
      label: "Image",
      contract: "common.view/raster-image-source",
      module: imageViewer
    },
    {
      id: "vector",
      label: "Vector",
      contract: "common.view/vector-scene-source",
      module: vectorViewer
    },
    {
      id: "model",
      label: "Model",
      contract: "common.view/model-scene-source",
      module: modelViewer
    },
    {
      id: "audio",
      label: "Audio",
      contract: "common.view/audio-media-source",
      module: audioViewer
    },
    {
      id: "video",
      label: "Video",
      contract: "common.view/video-media-source",
      module: videoViewer
    },
    {
      id: "entries",
      label: "Entries",
      contract: "common.view/namespace-entry-source",
      module: vscodeArchiveStage
    },
    { id: "table", label: "Table", contract: "common.view/table-data-source", module: tableViewer },
    { id: "tree", label: "Tree", contract: "common.view/tree-data-source", module: treeViewer },
    {
      id: "text",
      label: "Text",
      contract: "common.view/text-data-source",
      module: boundedTextViewer,
      trait: "content.text"
    },
    {
      id: "text-virtual",
      label: "Text (streaming)",
      contract: "common.view/text-data-source",
      module: virtualTextViewer,
      trait: "content.text"
    },
    /*
     * Mounted only for a subject the extension host handed editing ports for. The ports come from
     * the subject RPC's editing arm, and the arm is refused for anything this host cannot write —
     * so the editors follow what the *host* can save, not what the file looks like.
     */
    {
      id: "text-editor",
      label: "Text (editor)",
      contract: "common.view/text-data-source",
      module: textEditor,
      trait: "content.text",
      editable: true
    },
    {
      id: "edit",
      label: "Edit",
      contract: "common.view/byte-range-source",
      module: createVsCodeEditPanel(context),
      editable: true
    },
    /*
     * The metadata panel consumes no data source of its own — it renders the descriptor's metadata
     * groups — so it is bound to the byte-range source, which is the host's floor for an opened
     * subject. That makes "the subject opened" the condition, stated rather than implied.
     */
    {
      id: "metadata",
      label: "Metadata",
      contract: "common.view/byte-range-source",
      module: metadataPanel
    },
    { id: "hex", label: "Hex", contract: "common.view/byte-range-source", module: hexViewer },
    {
      id: "hex-editor",
      label: "Hex (editor)",
      contract: "common.view/byte-range-source",
      module: hexEditor,
      editable: true
    }
  ]);
}
var VSCODE_PREVIEW_FALLBACK = Object.freeze({
  text: boundedTextViewer,
  hex: hexViewer
});

// apps/modkit-vscode/src/webview.ts
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
function baseName(path) {
  const parts = path.split(/[\\/]/u).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
var bootstrap = globalThis.__MODKIT_BOOTSTRAP__;
var acquire = globalThis.acquireVsCodeApi;
var root = document.querySelector("#root");
if (root === null) throw new Error("missing #root");
if (bootstrap === void 0 || acquire === void 0) {
  const message = document.createElement("p");
  message.textContent = bootstrap === void 0 ? "No host snapshot was provided by the extension host." : "This page is not running inside a VS Code webview.";
  root.replaceChildren(message);
} else {
  void mount(root, bootstrap, acquire()).catch((error) => {
    const message = document.createElement("p");
    message.textContent = `The Modkit workbench failed to start: ${describe(error)}`;
    root.replaceChildren(message);
  });
}
async function mount(mountPoint, snapshot, api) {
  const channel = {
    post: (message) => {
      api.postMessage(message);
    },
    onMessage: (handler) => {
      const listener = (event) => handler(event.data);
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    }
  };
  const bridge = createBridge({ channel, idPrefix: "view" });
  const workbench = createWorkbench(document, {
    title: "Modkit",
    host: { label: snapshot.webview.realmId, facilities: snapshot.webview.facilities }
  });
  mountPoint.replaceChildren(workbench.root);
  const say = (message) => {
    bridge.emit({ op: "status", text: message });
  };
  const client = await connectSubjectRpc({
    framePort: bridge.framePort,
    // This port is emitter-shaped (`on`), and its payload is the frame itself.
    session: snapshot.session,
    moduleUrl: snapshot.moduleUrl,
    contributionId: snapshot.contributionId,
    /*
     * Said on the page, where it used to be silent. `say` also mirrors into the output channel,
     * so this one call covers both of the page's own channels.
     *
     * The editor's Problems panel is fed from the extension host instead, not from here: this
     * channel narrows a diagnostic to `{code, message}`, and a severity guessed from a code string
     * would be a worse answer than the one the host already has.
     */
    onDiagnostic: (diagnostic2) => {
      say(`${diagnostic2.code}: ${diagnostic2.message}`);
    }
  });
  const access = {
    label: "Workspace",
    async list(entryId) {
      const answer = await bridge.request({
        op: "list",
        ...entryId === void 0 ? {} : { path: entryId }
      });
      return answer.map((entry) => ({
        id: entry.id,
        name: entry.name,
        directory: entry.directory,
        ...entry.size === void 0 ? {} : { size: entry.size }
      }));
    },
    async read(entryId, maxBytes) {
      const answer = await bridge.request({ op: "read", path: entryId, maxBytes });
      if (!(answer instanceof Uint8Array)) throw new Error("the extension host returned no bytes");
      return answer;
    }
  };
  const subjects = /* @__PURE__ */ new Map();
  const openPorts = /* @__PURE__ */ new Map();
  const editOutcomes = /* @__PURE__ */ new Map();
  let focused;
  const markDirty = (entryId, dirty) => {
    editors.markDirty(entryId, dirty);
    if (entryId === snapshot.openPath) bridge.emit({ op: "document-dirty", path: entryId, dirty });
  };
  const recordForDescriptor = (descriptor) => [...subjects.values()].find((record) => record.descriptor === descriptor);
  const codecPreview = createCodecPreview({
    supported: snapshot.supportedExtensions,
    stages: createVsCodePreviewStages({
      portsFor(descriptor) {
        const record = recordForDescriptor(descriptor);
        return record === void 0 ? void 0 : openPorts.get(record.entry.id);
      },
      async reopen(descriptor) {
        const record = recordForDescriptor(descriptor);
        return record === void 0 ? false : reopenCommittedEntry(editors, record.entry);
      },
      lastOutcome(descriptor) {
        const record = recordForDescriptor(descriptor);
        return record === void 0 ? void 0 : editOutcomes.get(record.entry.id);
      },
      recordOutcome(descriptor, outcome) {
        const record = recordForDescriptor(descriptor);
        if (record !== void 0) editOutcomes.set(record.entry.id, outcome);
      },
      onStatus(status) {
        say(status.message);
      }
    }),
    fallback: VSCODE_PREVIEW_FALLBACK,
    async openSession(entry) {
      const result = await client.open(entry.id);
      if (result.state === "unresolved") {
        say(
          `${entry.name} \u2014 no codec claimed it (${result.snapshot.reason}); showing the raw bytes.`
        );
        subjects.delete(entry.id);
        return void 0;
      }
      const opened = result.snapshot;
      say(
        `${entry.name} \xB7 ${opened.selected.contributionId}/${opened.selected.variantId} \xB7 ${Math.round(opened.selected.confidence * 100)}%`
      );
      subjects.set(entry.id, {
        entry,
        sessionId: opened.sessionId,
        session: result.session,
        descriptor: opened.descriptor,
        planActive: result.session.presentation?.activeStage
      });
      return {
        descriptor: async () => opened.descriptor,
        dataSource: (contract, major) => result.session.dataSource(contract, major),
        operations: () => result.session.operations(),
        async dispose() {
          subjects.delete(entry.id);
          const ports = openPorts.get(entry.id);
          openPorts.delete(entry.id);
          if (ports !== void 0) await ports.dispose().catch(() => void 0);
          await result.session.dispose();
        }
      };
    },
    /*
     * Asked once per opened subject, before any stage mounts. `undefined` drops the editable
     * stages for *that subject alone*, which is exactly how this host says "I cannot write this
     * one": the extension host refuses `edit(sessionId)` for a subject it has no writer or no
     * backend for, and a save button that fails at the end would be worse than none.
     */
    async editorPorts(entry) {
      const record = subjects.get(entry.id);
      if (record === void 0) return void 0;
      try {
        const arm = await client.edit(record.sessionId);
        const ports = await createWebviewEditorPorts({
          arm,
          onStatus: (message) => say(`${entry.name} \xB7 ${message}`),
          onDirty: (dirty) => markDirty(entry.id, dirty)
        });
        openPorts.set(entry.id, ports);
        return ports;
      } catch (error) {
        say(`${entry.name} is open read-only: ${describe(error)}`);
        return void 0;
      }
    }
  });
  const preview = {
    supported: codecPreview.supported,
    async open(container, entry, bytes, signal) {
      const handle = await codecPreview.open(container, entry, bytes, signal);
      if (handle === void 0) return void 0;
      const wanted = preferredStage(
        handle.views.map((view) => view.id),
        subjects.get(entry.id)?.planActive
      );
      if (wanted !== void 0 && wanted !== handle.activeView) await handle.show(wanted);
      return handle;
    }
  };
  const editors = createEditorArea(document, {
    preview,
    /*
     * In the custom editor the file already has a tab and a breadcrumb — VS Code drew them, above
     * this webview, for this very file. A second row of tabs showing the same one file, and a
     * second breadcrumb spelling out its absolute location, are this component not knowing where
     * it was mounted. Switched off, what is left is the working area: the view picker and the
     * stage. The standalone panel keeps both, because there it is the only thing that has them.
     */
    ...snapshot.openPath === void 0 ? {} : { chrome: { tabs: false, breadcrumb: false } },
    read: (entry, signal) => access.read(entry.id, EXPLORER_MAXIMUM_BYTES, signal),
    async confirmClose(entry) {
      const answer = String(
        await bridge.request({
          op: "confirm",
          message: `${entry.name} has unsaved changes.`,
          savable: openPorts.has(entry.id)
        })
      );
      return answer === "save" || answer === "discard" ? answer : "cancel";
    },
    async save(entry) {
      const ports = openPorts.get(entry.id);
      if (ports === void 0 || !await ports.save()) {
        throw new Error(`${entry.name} could not be saved by its editing arm`);
      }
    },
    onStatus(status) {
      say([status.path, status.view, status.detail].filter(Boolean).join(" \xB7 "));
      focused = status.path;
    }
  });
  editors.root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset["mkPart"] !== "editor.text") return;
    if (focused !== void 0) markDirty(focused, true);
  });
  editors.root.addEventListener(
    "click",
    (event) => {
      if (snapshot.openPath === void 0 || focused !== snapshot.openPath) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const save = target.closest('[data-modkit-action="save"]');
      if (save === null) return;
      event.preventDefault();
      event.stopPropagation();
      bridge.emit({ op: "document-save-requested", path: snapshot.openPath });
    },
    true
  );
  bridge.serve(async (request) => {
    if (request.op !== "document-save" && request.op !== "document-revert") {
      throw new Error("the webview only serves custom-document lifecycle requests");
    }
    if (snapshot.openPath === void 0 || request.path !== snapshot.openPath) {
      throw new Error("the custom-document request does not name this webview document");
    }
    if (request.op === "document-save") {
      const record2 = subjects.get(request.path);
      if (record2 === void 0) throw new Error("the custom document is not open");
      const entry2 = record2.entry;
      if (!await editors.save(request.path)) throw new Error("the mounted editor refused to save");
      markDirty(request.path, false);
      if (!await editors.close(request.path)) {
        throw new Error("the saved custom document could not close its stale revision");
      }
      await editors.open(entry2);
      return true;
    }
    const record = subjects.get(request.path);
    if (record === void 0) throw new Error("the custom document is not open");
    const entry = record.entry;
    markDirty(request.path, false);
    if (!await editors.close(request.path)) throw new Error("the custom document could not close");
    await editors.open(entry);
    return true;
  });
  workbench.setMain(editors.root);
  const openPath = async (path, name) => {
    const entry = { id: path, name, directory: false };
    await editors.open(entry);
  };
  bridge.onEvent((event) => {
    switch (event.op) {
      case "open":
        void openPath(event.path, event.name).catch((error) => say(describe(error)));
        break;
      case "notice":
        say(event.text);
        break;
      default:
        break;
    }
  });
  if (snapshot.openPath !== void 0) {
    await openPath(snapshot.openPath, baseName(snapshot.openPath));
  }
}
