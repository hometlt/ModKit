import {
  CODEC_CONTRIBUTION_CONTRACT,
  DATA_CATALOG_ANALYSIS_CONTRACT,
  DATA_CATALOG_ENTITIES_INPUT,
  DATA_CATALOG_MATCHER_PROFILE,
  DATA_CATALOG_QUERIES_OUTPUT,
  DEFAULT_UI_LOCALIZER,
  EXPLORER_MAXIMUM_BYTES,
  EXTENSION_ROOT_FAILURE_CODES,
  HOST_LAYER_SOURCE_ID,
  MAP_PREVIEW_PREPARATION_CONTRACT,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  MOD_CONTEXT_MAX_QUERY_REFS,
  NATIVE_MAP_ENCODER_CONTRACT,
  NATIVE_MAP_ENCODER_MATCHER_PROFILE,
  NATIVE_MODEL_ENCODER_CONTRACT,
  NATIVE_MODEL_ENCODER_MATCHER_PROFILE,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  SubjectNavigationHistory,
  ViewerMountScope,
  WEB_EXTENSION_CATALOG,
  WEB_SOURCE_FACILITY_UNAVAILABLE,
  WEB_SOURCE_FILESYSTEM_READ_RANDOM,
  WEB_SOURCE_OPEN_BOUNDARY,
  WORLD_SCENE_SOURCE_CONTRACT,
  catalogCoordinates,
  combineLoadedExtensionRoots,
  containerCoordinate,
  containerEntryRevision,
  contributionContractLabel,
  contributionId,
  createBrowserExtensionManager,
  createCodecPreview,
  createDirectoryAccess,
  createEditorArea,
  createExplorer,
  createIndexedDbExtensionStore,
  createManagedExtensionsController,
  createMemorySource,
  createSingleFileAccess,
  createSubjectCandidateProvider,
  createSubjectCard,
  createSurface,
  createWebEditingArm,
  createWebExtensionSubjectCatalog,
  createWebLocalizer,
  createWebPreviewFallback,
  createWebPreviewStages,
  createWebSubjectServices,
  createWebTopology,
  defineViewerModule,
  describeEditability,
  describeFileCapability,
  element,
  grantValidity,
  grantValidity2,
  isJsonValue,
  isKnowledgeTarget,
  isRevisionId,
  isStandardTraitId,
  isWritableHandle,
  loadManagedExtensionRoots,
  loadSubjectCandidatePage,
  loadSubjectCardSections,
  loadUserExtensionRoots,
  loadWebLocalizationCatalogs,
  mapQualificationTupleBytes,
  mountWebWorkbench,
  narrowGrant,
  nestedSubjectServices,
  normalizeModkitIdentifier,
  openNestedSubject,
  operationScopedPermissionClasses,
  parseSubjectRef,
  presentationSlotId,
  probeWebFacilities,
  requestUserExtensionPermission,
  requestWriteAccess,
  resolveCommonPresentationPlan,
  resolveFormatWriter,
  resolveModWorkspaceGraph,
  resolveModelViewerTextures,
  resolveModuleMap,
  revisionId,
  revisionIdFromRef,
  rootSubject,
  serializeSubjectRef,
  setPart,
  setState,
  setViewerText,
  sourceRevisionToken,
  sourceUriFor,
  stageIdOf,
  subjectFactsSourceFromWire,
  validateSubjectDescriptorV2,
  webExtensionSubjectCardBundle,
  withoutHiddenEntries
} from "./chunks/chunk-CHVWX4J2.js";
import {
  CONTAINER_EXTRACT_OPERATION_ID,
  ModkitError,
  canonicalJsonStringify,
  compareUtf8,
  contractId,
  diagnostic,
  errorCode,
  isCancellation,
  isModkitError,
  isQualifiedId,
  isTraitId,
  parseSemver,
  parseVersionRange,
  satisfiesRange,
  throwIfAborted
} from "./chunks/chunk-RSKTTXN3.js";
import "./chunks/chunk-QPJEB2TM.js";
import "./chunks/chunk-7TLUWFCA.js";
import "./chunks/chunk-DJDDRNPC.js";

// packages/ui/dist/settings/index.js
var PARTS = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  /*
   * Toolbar items, shared by every viewer that has a toolbar.
   *
   * They are one vocabulary rather than one per viewer because a theme styles "a toggle in a
   * toolbar" once: a tree, a table and a strings editor that each invented their own part names
   * would make the same button three different things to style.
   */
  "toolbar.group",
  "toolbar.toggle",
  "toolbar.chip",
  "toolbar.action",
  "toolbar.search",
  "toolbar.search-input",
  "toolbar.separator",
  "toolbar.spacer",
  "toolbar.label",
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
  "tree.row",
  "tree.key",
  "tree.twisty",
  "tree.label",
  "tree.value",
  "tree.children",
  // one displayed value, drawn with its syntax runs
  "value.token",
  // inline, schema-driven field editing shared by the tree, the table and the metadata panel
  "field",
  "field.control",
  "field.status",
  "field.target",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // variant (localization) tables
  "table.head",
  "table.controls",
  "table.group",
  "table.context",
  "table.columns",
  /** The grip on a header's edge that sizes its column. */
  "table.resize",
  "table.asset",
  "table.unresolved",
  "table.assist",
  "table.suggestions",
  "table.note",
  "table.panel",
  "table.add",
  "table.compare",
  "table.select",
  /** The find bar (Ctrl+F) and its replace row (Ctrl+H). */
  "table.find",
  /** One occurrence of the find text inside a drawn cell. */
  "table.match",
  /** A value's trailing white space, shown where it is drawn. */
  "table.trailing",
  /** A row's status in its status cell (missing, untranslated, duplicate, error…). */
  "table.badge",
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
  // playback stage: a transport with its world positions, participants, series and events
  "playback",
  "playback.title",
  "playback.bar",
  "playback.seek",
  "playback.time",
  "playback.units",
  "playback.rate",
  "playback.body",
  "playback.map",
  "playback.note",
  "playback.side",
  "playback.participants",
  "playback.participant",
  "playback.swatch",
  "playback.charts",
  "playback.chart",
  "playback.playhead",
  "playback.kinds",
  "playback.kind",
  "playback.events",
  "playback.event",
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
  "metadata.note",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // game template stage: the resolved tree, the drawn template and the element view side by side
  "template.body",
  "template.canvas",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  "image.subresources",
  "image.frame-preview",
  "image.convert",
  "image.metadata",
  // map layers: the chosen layer drawn large, a thumbnail per layer, what its colours mean
  "map-layers.view",
  "map-layers.image",
  "map-layers.thumbnail",
  "map-layers.legend",
  "map-layers.swatch",
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
  "audio.notice",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // font stage
  "font",
  "font.toolbar",
  "font.text",
  "font.row",
  "font.size",
  "font.sample",
  "font.heading",
  "font.set",
  // archive stage
  "archive.members",
  "archive.member-list",
  "archive.item",
  "archive.row",
  "archive.name",
  "archive.detail",
  "archive.children",
  // video stage
  "video",
  "video.player",
  "video.options",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  "model.primitive-selector",
  "model.animation-selector",
  "model.animation-seek",
  "model.animation-name",
  "model.convert-selector",
  "model.convert-status",
  "model.animation-name-status",
  "model.playback-status",
  "model.controls",
  "model.control-row",
  "model.control-label",
  "model.control-field",
  "model.control-note",
  "model.scale",
  "model.team-color",
  "model.facets",
  "model.facet",
  "model.facet-summary",
  "model.facet-list",
  "model.facet-item",
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
  "filetree.action",
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
  "explorer.opening",
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
  // the subject picker a reference field opens (a unit, a model)
  "selector",
  "selector.search",
  "selector.candidates",
  "selector.more",
  "selector.status",
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
  "workbench.auxbar",
  "workbench.statusbar",
  "workbench.status-slot",
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
  "card.sources",
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
  "card.grid-pages",
  "card.grid-page",
  "card.grid-cell",
  "card.grid-face",
  "card.grid-image",
  "card.grid-cycle",
  "card.grid-opens",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.field-note",
  /** An inline icon in a styled value (`text-runs`): its slot, its pixels, an unresolved run. */
  "card.asset",
  "card.asset-image",
  "card.unresolved",
  "card.nav",
  "card.breadcrumbs",
  "card.knowledge",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  "image.metadata-group",
  "image.operation",
  "media-shell",
  "media-shell.toggle",
  "media-shell.gallery",
  "media-shell.splitter",
  "media-shell.stage",
  "media-shell.sidebar",
  "media-shell.section",
  "media-shell.section-header",
  "media-shell.section-chevron",
  "media-shell.section-icon",
  "media-shell.section-title",
  "media-shell.section-body",
  "media-shell.gallery-toolbar",
  "media-shell.gallery-mode",
  "media-shell.gallery-list",
  "media-shell.gallery-group",
  "media-shell.gallery-group-header",
  "media-shell.gallery-count",
  "media-shell.gallery-cells",
  "media-shell.gallery-item",
  "media-shell.gallery-thumb-box",
  "media-shell.gallery-thumb",
  "media-shell.gallery-label",
  "media-shell.gallery-empty",
  /** Quick filter (case / whole word / regular expression), shared by every list. */
  "filter",
  "filter.opener",
  "filter.input",
  "filter.option",
  /** Image editing tools, in a sidebar section of whichever viewer shows the pixels. */
  "image-editing",
  "image-editing.group",
  "image-editing.group-title",
  "image-editing.row",
  "image-editing.tools",
  "image-editing.tool",
  "image-editing.chip",
  "image-editing.label",
  "image-editing.range",
  "image-editing.value",
  "image-editing.swatch-button",
  "image-editing.swatch-alpha",
  "image-editing.swatches",
  "image-editing.swatch",
  "image-editing.popover",
  "image-editing.color",
  "image-editing.actions",
  "image-editing.note",
  "image-editing.marquee",
  "image-editing.dialog",
  "image-editing.number",
  "image-editing.select",
  "image-editing.check",
  "card.preview",
  // the wiki of a mod's entities (plan 5.25)
  "wiki",
  "wiki.kinds",
  "wiki.kind",
  "wiki.pane",
  "wiki.toolbar",
  "wiki.search",
  "wiki.status",
  "wiki.subjects",
  "wiki.subject",
  "wiki.icon",
  "wiki.id",
  "wiki.card",
  "card.preview-open",
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
  "graph.legend",
  "graph.hint",
  "graph.search",
  "graph.node-list",
  "graph.tooltip",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  /** The walk's own controls above the graph: whole graph, depth, direction, root (plan 5.19). */
  "graph.walk",
  // auditable subject calculations
  "calculations",
  "calculations.summary",
  "calculations.list",
  "calculations.item",
  "calculations.heading",
  "calculations.result",
  "calculations.formula",
  "calculations.inputs",
  "calculations.input",
  "calculations.warnings",
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
function setPart2(element22, part) {
  if (!PART_SET.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE, part);
}
function setState2(element22, states) {
  for (const state of states) {
    if (!STATE_SET.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE);
  else element22.setAttribute(STATE_ATTRIBUTE, [...new Set(states)].join(" "));
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
  ([name, value]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value}`
).join("; ");
var VIEWER_CSP_TEXT = policyText(VIEWER_CSP);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT = policyText(VIEWER_CSP_TRUSTED_EDITOR);
var HOSTILE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText(value, maximum = 1e6) {
  const text = String(value);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText2(node, value, maximum) {
  node.textContent = safeViewerText(value, maximum);
}
function element2(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText2(node, options.text);
  if (options.part !== void 0) setPart2(node, options.part);
  if (options.state !== void 0) setState2(node, options.state);
  parent.append(node);
  return node;
}
var RECENT_LIMIT = 10;
var GAME_INSTALLATION_PATH_LIMIT = 16;
var GAME_INSTALLATION_PATH_LENGTH_LIMIT = 4096;
var SETTINGS_SCHEMA_VERSION = 1;
var DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  appearance: Object.freeze({ theme: "modkit-dark", density: "compact" }),
  extensions: Object.freeze([]),
  gameInstallations: Object.freeze({}),
  recent: Object.freeze([]),
  disabledExtensions: Object.freeze([]),
  disabledContributions: Object.freeze([])
});
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var asText = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
var isAbsoluteLocalPath = (value) => /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+|\/)/iu.test(value);
function normalizeSettings(value) {
  const problems = [];
  if (!isRecord(value)) {
    return {
      document: DEFAULT_SETTINGS,
      problems: value === void 0 ? [] : ["settings root is not an object; defaults were used"]
    };
  }
  const version = value["schemaVersion"];
  if (version !== void 0 && version !== SETTINGS_SCHEMA_VERSION) {
    problems.push(
      `unknown schemaVersion ${String(version)}; expected ${SETTINGS_SCHEMA_VERSION}. Unrecognised fields were ignored.`
    );
  }
  const appearanceInput = isRecord(value["appearance"]) ? value["appearance"] : {};
  const theme = asText(appearanceInput["theme"]) ?? DEFAULT_SETTINGS.appearance.theme;
  const densityInput = appearanceInput["density"];
  const density = densityInput === "compact" || densityInput === "comfortable" ? densityInput : DEFAULT_SETTINGS.appearance.density;
  if (densityInput !== void 0 && densityInput !== density) {
    problems.push(`appearance.density "${String(densityInput)}" is not valid; used "${density}"`);
  }
  const extensions = [];
  const seen = /* @__PURE__ */ new Map();
  const listInput = value["extensions"];
  if (listInput !== void 0 && !Array.isArray(listInput)) {
    problems.push("extensions must be an array; it was ignored");
  } else {
    for (const [index, item] of (listInput ?? []).entries()) {
      if (!isRecord(item)) {
        problems.push(`extensions[${index}] is not an object; ignored`);
        continue;
      }
      const rawId = asText(item["id"]);
      const path = asText(item["path"]);
      if (rawId === void 0 || path === void 0) {
        problems.push(`extensions[${index}] needs both "id" and "path"; ignored`);
        continue;
      }
      const id = normalizeModkitIdentifier(rawId);
      const entry = {
        id,
        path,
        // Absent means enabled: adding a path to the file is how a user asks for an extension.
        enabled: item["enabled"] !== false,
        ...isRecord(item["options"]) ? { options: Object.freeze({ ...item["options"] }) } : {}
      };
      const existing = seen.get(id);
      if (existing === void 0) {
        seen.set(id, extensions.length);
        extensions.push(entry);
      } else {
        problems.push(`extensions[${index}] duplicates id "${id}"; the later entry won`);
        extensions[existing] = entry;
      }
    }
  }
  const gameInstallations = {};
  const gameInstallationsInput = value["gameInstallations"];
  if (gameInstallationsInput !== void 0 && !isRecord(gameInstallationsInput)) {
    problems.push("gameInstallations must be an object; it was ignored");
  } else {
    for (const [rawGameId, item] of Object.entries(gameInstallationsInput ?? {})) {
      const gameId = normalizeModkitIdentifier(rawGameId.trim().toLowerCase());
      if (!/^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/u.test(gameId)) {
        problems.push(`gameInstallations key "${rawGameId}" is not a qualified game id; ignored`);
        continue;
      }
      if (!isRecord(item) || !Array.isArray(item["configuredPaths"])) {
        problems.push(`gameInstallations.${gameId}.configuredPaths must be an array; ignored`);
        continue;
      }
      const configuredPaths = [];
      const seenPaths = /* @__PURE__ */ new Set();
      for (const [index, pathInput] of item["configuredPaths"].entries()) {
        const path = asText(pathInput);
        if (path === void 0 || path.includes("\0") || path.length > GAME_INSTALLATION_PATH_LENGTH_LIMIT || !isAbsoluteLocalPath(path) || /^(?:[a-z][a-z0-9+.-]*:\/\/|file:)/iu.test(path)) {
          problems.push(
            `gameInstallations.${gameId}.configuredPaths[${index}] is not a valid local path; ignored`
          );
          continue;
        }
        if (seenPaths.has(path)) continue;
        seenPaths.add(path);
        configuredPaths.push(path);
        if (configuredPaths.length >= GAME_INSTALLATION_PATH_LIMIT) {
          if (index + 1 < item["configuredPaths"].length) {
            problems.push(
              `gameInstallations.${gameId}.configuredPaths was truncated at ${GAME_INSTALLATION_PATH_LIMIT}`
            );
          }
          break;
        }
      }
      if (gameInstallations[gameId] !== void 0) {
        problems.push(
          `gameInstallations key "${rawGameId}" duplicates "${gameId}"; the later entry won`
        );
      }
      gameInstallations[gameId] = Object.freeze({
        configuredPaths: Object.freeze(configuredPaths)
      });
    }
  }
  const recent = [];
  const recentInput = value["recent"];
  if (recentInput !== void 0 && !Array.isArray(recentInput)) {
    problems.push("recent must be an array; it was ignored");
  } else {
    const seenPaths = /* @__PURE__ */ new Set();
    for (const item of recentInput ?? []) {
      if (!isRecord(item)) continue;
      const path = asText(item["path"]);
      if (path === void 0 || seenPaths.has(path)) continue;
      seenPaths.add(path);
      recent.push({ path, kind: item["kind"] === "file" ? "file" : "folder" });
      if (recent.length >= RECENT_LIMIT) break;
    }
  }
  const disabledExtensions = [];
  const disabledExtensionsInput = value["disabledExtensions"];
  if (disabledExtensionsInput !== void 0 && !Array.isArray(disabledExtensionsInput)) {
    problems.push("disabledExtensions must be an array; it was ignored");
  } else {
    const seenIds = /* @__PURE__ */ new Set();
    for (const [index, item] of (disabledExtensionsInput ?? []).entries()) {
      const rawId = asText(item);
      const id = rawId === void 0 ? void 0 : normalizeModkitIdentifier(rawId);
      if (id === void 0 || !isQualifiedId(id)) {
        problems.push(`disabledExtensions[${index}] is not an extension coordinate; ignored`);
        continue;
      }
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      disabledExtensions.push(id);
    }
    disabledExtensions.sort(compareUtf8);
  }
  const disabled = [];
  const disabledInput = value["disabledContributions"];
  if (disabledInput !== void 0 && !Array.isArray(disabledInput)) {
    problems.push("disabledContributions must be an array; it was ignored");
  } else {
    const seenIds = /* @__PURE__ */ new Set();
    for (const [index, item] of (disabledInput ?? []).entries()) {
      const rawId = asText(item);
      const id = rawId === void 0 ? void 0 : normalizeModkitIdentifier(rawId);
      if (id === void 0) {
        problems.push(`disabledContributions[${index}] is not a contribution id; ignored`);
        continue;
      }
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      disabled.push(id);
    }
    disabled.sort(compareUtf8);
  }
  return {
    document: Object.freeze({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      appearance: Object.freeze({ theme, density }),
      extensions: Object.freeze(extensions),
      gameInstallations: Object.freeze(gameInstallations),
      recent: Object.freeze(recent),
      disabledExtensions: Object.freeze(disabledExtensions),
      disabledContributions: Object.freeze(disabled)
    }),
    problems: Object.freeze(problems)
  };
}
function serializeSettings(document2) {
  return `${JSON.stringify(
    {
      schemaVersion: document2.schemaVersion,
      appearance: { theme: document2.appearance.theme, density: document2.appearance.density },
      // Recency is meaningful order, so this list is written as-is rather than sorted.
      recent: document2.recent.map((entry) => ({ path: entry.path, kind: entry.kind })),
      // A set: sorted, so the same choice made in two hosts produces the same bytes.
      // `?? []` keeps runtime serialization compatible with schema-v1 documents created before
      // this additive field existed. `normalizeSettings` always returns the complete shape.
      disabledExtensions: [...document2.disabledExtensions ?? []].sort(compareUtf8),
      disabledContributions: [...document2.disabledContributions].sort(compareUtf8),
      gameInstallations: Object.fromEntries(
        Object.entries(document2.gameInstallations).sort(([left], [right]) => compareUtf8(left, right)).map(([gameId, setting]) => [gameId, { configuredPaths: [...setting.configuredPaths] }])
      ),
      extensions: [...document2.extensions].sort((a, b) => compareUtf8(a.id, b.id)).map((entry) => ({
        id: entry.id,
        path: entry.path,
        enabled: entry.enabled,
        ...entry.options === void 0 ? {} : { options: entry.options }
      }))
    },
    null,
    2
  )}
`;
}
var SETTINGS_FALLBACK_MESSAGES = {
  "common.disabled": "Disabled",
  "common.enabled": "Enabled",
  "common.remove": "Remove",
  "settings.add": "Add",
  "settings.appearance": "Appearance",
  "settings.associate": "Associate .{type}",
  "settings.associationsDescription": "Make this app the default for the formats its codecs can open. Registration is per-user and reversible from the operating system, and nothing is written until you apply it.",
  "settings.back": "\u2190 Back",
  "settings.browse": "Browse\u2026",
  "settings.close": "Close settings (Esc)",
  "settings.colorTheme": "Color theme",
  "settings.comfortable": "Comfortable",
  "settings.compact": "Compact",
  "settings.defaultApp": "Set as default app",
  "settings.density": "Density",
  "settings.densityDescription": "Compact matches VS Code list metrics; comfortable suits touch and larger displays.",
  "settings.enableExtension": "Enable {id}",
  "settings.extensionId": "Extension id",
  "settings.extensionLocation": "Extension location",
  "settings.extensionPathPlaceholder": "path, package or URL",
  "settings.extensionRequired": "An extension needs both an id and a location.",
  "settings.extensions": "Extensions",
  "settings.extensionsLocationIntro": "Extensions are listed in {location}. Each entry has an id, a location the host loads from, and an enabled state. The same settings are used by desktop, web and headless hosts.",
  "settings.fileAssociations": "File associations",
  "settings.groups": "Settings groups",
  "settings.loadedFrom": "Loaded from {location}",
  "settings.loadedProblems": "Loaded with {count} problem(s): {problems}",
  "settings.noCodecs": "No codecs are loaded, so there is nothing to associate.",
  "settings.noExtensions": "No extensions are configured yet.",
  "settings.nothingToRegister": "Nothing to register.",
  "settings.pickFileType": "Pick at least one file type first.",
  "settings.registerError": "Could not register: {reason}",
  "settings.saveError": "Could not save: {reason}",
  "settings.savedTo": "Saved to {location}",
  "settings.selectAll": "Select all",
  "settings.selectNone": "Select none",
  "settings.themeDescription": "Applies immediately and to every viewer surface."
};
function createEnglishUiLocalizer(messages) {
  return Object.freeze({
    locale: "en",
    text(key2, values = {}) {
      const message = messages[key2] ?? key2;
      return message.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu, (_match, name) => {
        const value = values[name];
        return value === void 0 ? `{${name}}` : String(value);
      });
    }
  });
}
function withEnglishUiFallback(localizer, messages) {
  const fallback = createEnglishUiLocalizer(messages);
  if (localizer === void 0) return fallback;
  return Object.freeze({
    locale: localizer.locale,
    text(key2, values = {}) {
      const translated = localizer.text(key2, values);
      return translated === key2 ? fallback.text(key2, values) : translated;
    }
  });
}
var APP_THEME_DOM_ID = "modkit-app-themes";
var APP_THEME_ID = /^[a-z][a-z0-9-]{0,63}$/u;
var APP_THEME_STYLESHEET = /^\.\/(?:modkit-ui|theme-[a-z][a-z0-9-]{0,63})\.css$/u;
function readAppThemeChoices(document2) {
  const node = document2.getElementById(APP_THEME_DOM_ID);
  if (node?.textContent === null || node?.textContent === void 0) {
    throw new Error(`missing #${APP_THEME_DOM_ID} build data`);
  }
  let parsed;
  try {
    parsed = JSON.parse(node.textContent);
  } catch (error) {
    throw new Error(
      `invalid #${APP_THEME_DOM_ID} JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64) {
    throw new Error(`#${APP_THEME_DOM_ID} must contain between 1 and 64 themes`);
  }
  const ids = /* @__PURE__ */ new Set();
  return Object.freeze(
    parsed.map((value, index) => {
      const entry = value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
      const id = entry?.["id"];
      const label = entry?.["label"];
      const stylesheet = entry?.["stylesheet"];
      if (typeof id !== "string" || !APP_THEME_ID.test(id)) {
        throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid id`);
      }
      if (ids.has(id)) throw new Error(`#${APP_THEME_DOM_ID} contains duplicate theme id ${id}`);
      ids.add(id);
      if (typeof label !== "string" || label.trim() !== label || label.length === 0 || label.length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) {
        throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid label`);
      }
      if (typeof stylesheet !== "string" || !APP_THEME_STYLESHEET.test(stylesheet)) {
        throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid stylesheet`);
      }
      return Object.freeze({ id, label, stylesheet });
    })
  );
}
function createSettingsUi(document2, options) {
  const localizer = withEnglishUiFallback(options.localizer, SETTINGS_FALLBACK_MESSAGES);
  const root = document2.createElement("div");
  root.className = "modkit-viewer modkit-settings";
  setPart2(root, "settings");
  const groupList = element2(root, "nav", { part: "settings.groups" });
  groupList.setAttribute("aria-label", localizer.text("settings.groups"));
  if (options.onClose !== void 0) {
    const close = element2(groupList, "button", {
      part: "settings.close",
      text: localizer.text("settings.back")
    });
    close.type = "button";
    close.title = localizer.text("settings.close");
    close.addEventListener("click", () => options.onClose?.());
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") options.onClose?.();
    });
    root.tabIndex = -1;
  }
  const pane = element2(root, "div", { part: "settings.pane" });
  const status = element2(root, "output", { part: "settings.status" });
  let current = DEFAULT_SETTINGS;
  let activeGroup = "appearance";
  const say = (message, bad = false) => {
    status.textContent = message;
    setState2(status, bad ? ["error"] : []);
  };
  const persist = async (next) => {
    try {
      await options.store.write(next);
      current = next;
      options.onChange?.(next);
      say(localizer.text("settings.savedTo", { location: options.store.location }));
    } catch (error) {
      say(
        localizer.text("settings.saveError", {
          reason: error instanceof Error ? error.message : String(error)
        }),
        true
      );
    }
  };
  const row = (host, label, description) => {
    const wrapper = element2(host, "div", { part: "settings.row" });
    element2(wrapper, "div", { part: "settings.label", text: label });
    element2(wrapper, "div", { part: "settings.description", text: description });
    return element2(wrapper, "div", { part: "settings.control" });
  };
  const appearanceGroup = {
    id: "appearance",
    label: localizer.text("settings.appearance"),
    render(host) {
      if (options.themes.length > 0) {
        const control = row(
          host,
          localizer.text("settings.colorTheme"),
          localizer.text("settings.themeDescription")
        );
        const select = element2(control, "select", { part: "settings.select" });
        select.setAttribute("aria-label", localizer.text("settings.colorTheme"));
        for (const theme of options.themes) {
          const option = document2.createElement("option");
          option.value = theme.id;
          option.textContent = theme.label;
          select.append(option);
        }
        select.value = current.appearance.theme;
        select.addEventListener("change", () => {
          const appearance = { ...current.appearance, theme: select.value };
          options.onAppearance?.(appearance);
          void persist({ ...current, appearance });
        });
      }
      const densityControl = row(
        host,
        localizer.text("settings.density"),
        localizer.text("settings.densityDescription")
      );
      const density = element2(densityControl, "select", {
        part: "settings.select"
      });
      density.setAttribute("aria-label", localizer.text("settings.density"));
      for (const value of ["compact", "comfortable"]) {
        const option = document2.createElement("option");
        option.value = value;
        option.textContent = localizer.text(
          value === "compact" ? "settings.compact" : "settings.comfortable"
        );
        density.append(option);
      }
      density.value = current.appearance.density;
      density.addEventListener("change", () => {
        const appearance = {
          ...current.appearance,
          density: density.value
        };
        options.onAppearance?.(appearance);
        void persist({ ...current, appearance });
      });
    }
  };
  const extensionsGroup = {
    id: "extensions",
    label: localizer.text("settings.extensions"),
    render(host) {
      const intro = element2(host, "p", { part: "settings.description" });
      intro.textContent = localizer.text("settings.extensionsLocationIntro", {
        location: options.store.location
      });
      const readOnly = options.extensionsReadOnly;
      if (readOnly !== void 0) {
        element2(host, "p", {
          part: "settings.description",
          text: safeViewerText(readOnly, 400)
        });
      }
      const list = element2(host, "div", { part: "settings.list" });
      const draw = () => {
        list.replaceChildren();
        if (current.extensions.length === 0) {
          element2(list, "p", {
            part: "settings.description",
            text: localizer.text("settings.noExtensions")
          });
        }
        for (const entry of current.extensions) {
          const item = element2(list, "div", { part: "settings.extension" });
          if (readOnly === void 0) {
            const toggle = element2(item, "input", {
              part: "settings.toggle"
            });
            toggle.type = "checkbox";
            toggle.checked = entry.enabled;
            toggle.setAttribute(
              "aria-label",
              localizer.text("settings.enableExtension", { id: entry.id })
            );
            toggle.addEventListener("change", () => {
              void persist({
                ...current,
                extensions: current.extensions.map(
                  (other) => other.id === entry.id ? { ...other, enabled: toggle.checked } : other
                )
              }).then(draw);
            });
          } else {
            element2(item, "div", {
              part: "settings.description",
              text: localizer.text(entry.enabled ? "common.enabled" : "common.disabled")
            });
          }
          const text = element2(item, "div", { part: "settings.extension-text" });
          element2(text, "div", { part: "settings.label", text: safeViewerText(entry.id, 200) });
          element2(text, "div", {
            part: "settings.description",
            text: safeViewerText(entry.path, 400)
          });
          if (readOnly === void 0) {
            const remove = element2(item, "button", {
              part: "settings.remove",
              text: localizer.text("common.remove")
            });
            remove.type = "button";
            remove.addEventListener("click", () => {
              void persist({
                ...current,
                extensions: current.extensions.filter((other) => other.id !== entry.id)
              }).then(draw);
            });
          }
        }
      };
      draw();
      if (readOnly !== void 0) return;
      const adder = element2(host, "div", { part: "settings.adder" });
      const id = element2(adder, "input", { part: "settings.input" });
      id.placeholder = "publisher/name";
      id.setAttribute("aria-label", localizer.text("settings.extensionId"));
      const path = element2(adder, "input", { part: "settings.input" });
      path.placeholder = localizer.text("settings.extensionPathPlaceholder");
      path.setAttribute("aria-label", localizer.text("settings.extensionLocation"));
      const add = (entry) => {
        void persist({
          ...current,
          extensions: [...current.extensions.filter((other) => other.id !== entry.id), entry]
        }).then(draw);
      };
      const addButton = element2(adder, "button", {
        part: "settings.add",
        text: localizer.text("settings.add")
      });
      addButton.type = "button";
      addButton.addEventListener("click", () => {
        const entryId = id.value.trim();
        const entryPath = path.value.trim();
        if (entryId === "" || entryPath === "") {
          say(localizer.text("settings.extensionRequired"), true);
          return;
        }
        add({ id: entryId, path: entryPath, enabled: true });
        id.value = "";
        path.value = "";
      });
      if (options.browseForExtension !== void 0) {
        const browse = element2(adder, "button", {
          part: "settings.add",
          text: localizer.text("settings.browse")
        });
        browse.type = "button";
        browse.addEventListener("click", () => {
          void (async () => {
            const picked = await options.browseForExtension?.();
            if (picked !== void 0) add({ ...picked, enabled: true });
          })();
        });
      }
    }
  };
  const registerFileTypes = options.registerFileTypes;
  const associationsGroup = {
    id: "associations",
    label: localizer.text("settings.fileAssociations"),
    render(host) {
      const types = [...options.associableTypes ?? []].sort();
      element2(host, "p", {
        part: "settings.description",
        text: localizer.text("settings.associationsDescription")
      });
      if (types.length === 0) {
        element2(host, "p", {
          part: "settings.description",
          text: localizer.text("settings.noCodecs")
        });
        return;
      }
      const chosen = new Set(types);
      const list = element2(host, "div", { part: "settings.list" });
      for (const type of types) {
        const item = element2(list, "div", { part: "settings.extension" });
        const toggle = element2(item, "input", { part: "settings.toggle" });
        toggle.type = "checkbox";
        toggle.checked = true;
        toggle.setAttribute("aria-label", localizer.text("settings.associate", { type }));
        toggle.addEventListener("change", () => {
          if (toggle.checked) chosen.add(type);
          else chosen.delete(type);
        });
        const text = element2(item, "div", { part: "settings.extension-text" });
        element2(text, "div", { part: "settings.label", text: `.${type}` });
      }
      const actions = element2(host, "div", { part: "settings.adder" });
      const all = element2(actions, "button", {
        part: "settings.add",
        text: localizer.text("settings.selectAll")
      });
      all.type = "button";
      all.addEventListener("click", () => {
        for (const node of list.querySelectorAll("input")) {
          node.checked = true;
          node.dispatchEvent(new Event("change"));
        }
      });
      const none = element2(actions, "button", {
        part: "settings.add",
        text: localizer.text("settings.selectNone")
      });
      none.type = "button";
      none.addEventListener("click", () => {
        for (const node of list.querySelectorAll("input")) {
          node.checked = false;
          node.dispatchEvent(new Event("change"));
        }
      });
      const apply = element2(actions, "button", {
        part: "settings.add",
        text: localizer.text("settings.defaultApp")
      });
      apply.type = "button";
      apply.addEventListener("click", () => {
        void (async () => {
          if (chosen.size === 0) {
            say(localizer.text("settings.pickFileType"), true);
            return;
          }
          try {
            apply.disabled = true;
            say(
              await registerFileTypes?.([...chosen]) ?? localizer.text("settings.nothingToRegister")
            );
          } catch (error) {
            say(
              localizer.text("settings.registerError", {
                reason: error instanceof Error ? error.message : String(error)
              }),
              true
            );
          } finally {
            apply.disabled = false;
          }
        })();
      });
    }
  };
  const extraGroups = options.extraGroups ?? [];
  const extraIds = /* @__PURE__ */ new Set();
  for (const group of extraGroups) {
    if (group.id.trim() === "" || group.label.trim() === "") {
      throw new Error("settings extra groups require a non-empty id and label");
    }
    if (extraIds.has(group.id)) throw new Error(`duplicate settings group id: ${group.id}`);
    extraIds.add(group.id);
  }
  const extrasById = new Map(extraGroups.map((group) => [group.id, group]));
  const primaryGroups = [appearanceGroup, extensionsGroup].map(
    (group) => extrasById.get(group.id) ?? group
  );
  const primaryIds = new Set(primaryGroups.map((group) => group.id));
  const additionalGroups = extraGroups.filter(
    (group) => !primaryIds.has(group.id) && !(options.registerFileTypes !== void 0 && group.id === associationsGroup.id)
  );
  const groups = [
    ...primaryGroups,
    ...additionalGroups,
    ...options.registerFileTypes === void 0 ? [] : [extrasById.get(associationsGroup.id) ?? associationsGroup]
  ];
  function showActiveGroup() {
    const group = groups.find((item) => item.id === activeGroup) ?? groups[0];
    if (group !== void 0) showGroup(group);
  }
  const groupContext = {
    get settings() {
      return current;
    },
    report: say,
    refresh() {
      showActiveGroup();
    }
  };
  const showGroup = (group) => {
    activeGroup = group.id;
    pane.replaceChildren();
    for (const node of groupList.querySelectorAll('[data-mk-part="settings.group"]')) {
      const selected = node.getAttribute("data-group") === group.id;
      node.setAttribute("aria-selected", String(selected));
      setState2(node, selected ? ["selected"] : []);
    }
    group.render(pane, groupContext);
  };
  for (const group of groups) {
    const button2 = element2(groupList, "button", {
      part: "settings.group",
      text: group.label
    });
    button2.type = "button";
    button2.dataset["group"] = group.id;
    button2.setAttribute("role", "tab");
    button2.addEventListener("click", () => {
      showGroup(group);
    });
  }
  const ui = {
    root,
    async reload() {
      const { document: loaded, problems } = await options.store.read();
      current = loaded;
      options.onAppearance?.(loaded.appearance);
      say(
        problems.length === 0 ? localizer.text("settings.loadedFrom", { location: options.store.location }) : localizer.text("settings.loadedProblems", {
          count: problems.length,
          problems: problems.join("; ")
        }),
        problems.length > 0
      );
      for (const group of groups) await group.reload?.(groupContext);
      showActiveGroup();
    },
    showGroup(groupId) {
      const group = groups.find((item) => item.id === groupId);
      if (group === void 0) return false;
      showGroup(group);
      return true;
    },
    destroy() {
      for (const group of groups) group.destroy?.();
      root.remove();
    }
  };
  return ui;
}

// packages/host/dist/maps/index.js
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
  const key2 = relationKey(edge);
  const previous = state.edges.get(key2);
  if (previous === void 0 || previous.dead === true && edge.dead !== true)
    state.edges.set(key2, edge);
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
        for (const key2 of Object.keys(record).sort(compareUtf8)) {
          if (state.capped) return;
          const itemPath = `${path}[${JSON.stringify(key2)}]`;
          await visitField(state, type.key, key2, `${itemPath}.$key`, depth + 1);
          await visitField(state, type.value, record[key2], itemPath, depth + 1);
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
        const key2 = relationKey(edge);
        const previous = edgeMap.get(key2);
        if (previous === void 0 || previous.dead === true && edge.dead !== true)
          edgeMap.set(key2, edge);
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
    const key2 = relationFactKey(relation);
    const previous = relations.get(key2);
    if (previous === void 0 || previous.dead === true && relation.dead !== true) {
      relations.set(key2, relation);
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
          const key2 = `${fact.id}\0${fact.locale ?? ""}`;
          if (!facts2.has(key2)) facts2.set(key2, fact);
        }
        factMaps.set(group.id, facts2);
      }
      for (const relation of item.relations) {
        const key2 = relationFactKey(relation);
        const previous = relationMap.get(key2);
        if (previous === void 0 || previous.dead === true && relation.dead !== true) {
          relationMap.set(key2, relation);
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
function invalidRange(sourceId, offset, length, size, message) {
  return new ModkitError({
    code: "x3.host/source-range-unrepresentable",
    message,
    context: {
      sourceId,
      offset: offset.toString(),
      length: length.toString(),
      size: size.toString()
    }
  });
}
function checkedRange(sourceId, size, offset, length) {
  if (offset < 0n || length < 0n || offset > size || length > size - offset) {
    throw invalidRange(
      sourceId,
      offset,
      length,
      size,
      `read [${offset}, ${offset + length}) exceeds source \xAB${sourceId}\xBB of size ${size}`
    );
  }
  if (offset > BigInt(Number.MAX_SAFE_INTEGER) || length > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidRange(
      sourceId,
      offset,
      length,
      size,
      `read range for source \xAB${sourceId}\xBB cannot be represented exactly by the current VFS`
    );
  }
  const start = Number(offset);
  const numericLength = Number(length);
  const end = start + numericLength;
  if (!Number.isSafeInteger(end)) {
    throw invalidRange(
      sourceId,
      offset,
      length,
      size,
      `read end for source \xAB${sourceId}\xBB cannot be represented exactly by the current VFS`
    );
  }
  return { start, length: numericLength, end };
}
async function artifactByteSourceFromRandomAccess(source, options) {
  throwIfAborted(options.signal);
  const numericSize = await source.size(options.signal);
  throwIfAborted(options.signal);
  if (!Number.isSafeInteger(numericSize) || numericSize < 0) {
    throw new ModkitError({
      code: "x3.host/source-size-unrepresentable",
      message: `source \xAB${source.id}\xBB reported a size outside the exact JavaScript integer range`,
      context: { sourceId: source.id, size: String(numericSize) }
    });
  }
  const size = BigInt(numericSize);
  const ref = Object.freeze({
    ...options.ref,
    ...options.ref.parentIds === void 0 ? {} : {
      parentIds: Object.freeze([...options.ref.parentIds])
    }
  });
  const bridged = {
    kind: "bytes",
    ref,
    revision: options.revision,
    size,
    async read(offset, length, signal) {
      throwIfAborted(signal);
      if (!Number.isSafeInteger(length) || length < 0) {
        throw invalidRange(
          source.id,
          offset,
          BigInt(Number.isFinite(length) ? Math.trunc(length) : 0),
          size,
          `read length for source \xAB${source.id}\xBB must be a non-negative safe integer`
        );
      }
      const range = checkedRange(source.id, size, offset, BigInt(length));
      const bytes = await source.readAt(range.start, range.length, signal);
      throwIfAborted(signal);
      if (bytes.byteLength !== range.length) {
        throw new ModkitError({
          code: "x3.host/source-short-read",
          message: `source \xAB${source.id}\xBB returned ${bytes.byteLength} bytes for an exact ${range.length}-byte read`,
          context: { sourceId: source.id, expected: range.length, actual: bytes.byteLength }
        });
      }
      return bytes;
    },
    async *stream(range, signal) {
      throwIfAborted(signal);
      const offset = range?.offset ?? 0n;
      const length = range?.length ?? size - offset;
      const checked = checkedRange(source.id, size, offset, length);
      const reader = source.stream(checked.start, checked.end, signal).getReader();
      let seen = 0;
      try {
        for (; ; ) {
          throwIfAborted(signal);
          const next = await reader.read();
          if (next.done) break;
          seen += next.value.byteLength;
          if (seen > checked.length) {
            throw new ModkitError({
              code: "x3.host/source-stream-overrun",
              message: `source \xAB${source.id}\xBB streamed beyond its requested range`,
              context: { sourceId: source.id, expected: checked.length, actual: seen }
            });
          }
          yield next.value;
        }
        if (seen !== checked.length) {
          throw new ModkitError({
            code: "x3.host/source-short-stream",
            message: `source \xAB${source.id}\xBB streamed ${seen} bytes for an exact ${checked.length}-byte range`,
            context: { sourceId: source.id, expected: checked.length, actual: seen }
          });
        }
      } finally {
        if (seen < checked.length) await reader.cancel().catch(() => void 0);
        reader.releaseLock();
      }
    }
  };
  return Object.freeze(bridged);
}
function artifactByteSourceFromBytes(ref, revision, bytes) {
  return Object.freeze({
    kind: "bytes",
    ref,
    revision,
    size: BigInt(bytes.byteLength),
    async read(offset, length, readSignal) {
      throwIfAborted(readSignal);
      if (offset < 0n || offset > BigInt(bytes.byteLength) || !Number.isSafeInteger(length) || length < 0) {
        throw new RangeError("invalid byte range");
      }
      const start = Number(offset);
      return bytes.slice(start, Math.min(bytes.byteLength, start + length));
    },
    async *stream(range, streamSignal) {
      throwIfAborted(streamSignal);
      const start = range === void 0 ? 0 : Number(range.offset);
      const end = range?.length === void 0 ? bytes.byteLength : Math.min(bytes.byteLength, start + Number(range.length));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        throw new RangeError("invalid stream range");
      }
      for (let offset = start; offset < end; offset += 64 * 1024) {
        throwIfAborted(streamSignal);
        yield bytes.slice(offset, Math.min(end, offset + 64 * 1024));
      }
    }
  });
}
var MAX_SIGNATURE_WINDOW_BYTES = 4096 + 64;
var clamp = (value) => Math.min(value, MAX_SIGNATURE_WINDOW_BYTES);
function signatureNeeds(ruleSets) {
  let prefix = 0;
  let suffix = 0;
  for (const rules of ruleSets) {
    for (const rule of rules) {
      const length = rule.bytesHex.length / 2;
      if (rule.from === "start") prefix = Math.max(prefix, rule.offset + length);
      else suffix = Math.max(suffix, rule.offset);
    }
  }
  return { prefix: clamp(prefix), suffix: clamp(suffix) };
}
function parseHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
function matchesSignatures(rules, windows) {
  if (rules === void 0 || rules.length === 0) return false;
  const size = windows.size;
  for (const rule of rules) {
    const pattern = parseHex(rule.bytesHex);
    const mask = rule.maskHex === void 0 ? void 0 : parseHex(rule.maskHex);
    if (mask !== void 0 && mask.length !== pattern.length) continue;
    if (rule.from === "end" && rule.offset < pattern.length) continue;
    const patternEnd = BigInt(rule.offset) + (rule.from === "start" ? BigInt(pattern.length) : 0n);
    if (patternEnd > size) continue;
    const window2 = rule.from === "start" ? windows.head : windows.tail;
    const start = rule.from === "start" ? rule.offset : window2.length - rule.offset;
    if (start < 0 || start + pattern.length > window2.length) continue;
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const m = mask?.[index] ?? 255;
      if ((window2[start + index] & m) !== (pattern[index] & m)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
var RESOURCE_NOT_FOUND = "x3.host/resource-not-found";
var RESOURCE_NOT_ALLOWLISTED = "x3.host/resource-not-allowlisted";
var RESOURCE_PATH_REFUSED = "x3.host/resource-path-refused";
var RESOURCE_SCOPE_UNSUPPORTED = "x3.host/resource-scope-unsupported";
var RESOURCE_BUDGET_EXCEEDED = "x3.host/resource-budget-exceeded";
var RESOURCE_CYCLE_DETECTED = "x3.host/resource-cycle-detected";
var RESOURCE_SESSION_DISPOSED = "x3.host/resource-session-disposed";
var RESOURCE_REVISION_CHANGED = "x3.host/resource-revision-changed";
var RESOURCE_PERMISSION_MISSING = "x3.host/resource-permission-missing";
var REASON_CODES = Object.freeze({
  "not-found": RESOURCE_NOT_FOUND,
  "not-allowlisted": RESOURCE_NOT_ALLOWLISTED,
  "path-refused": RESOURCE_PATH_REFUSED,
  "scope-unsupported": RESOURCE_SCOPE_UNSUPPORTED,
  "budget-exceeded": RESOURCE_BUDGET_EXCEEDED,
  "cycle-detected": RESOURCE_CYCLE_DETECTED,
  "session-disposed": RESOURCE_SESSION_DISPOSED,
  "source-revision-changed": RESOURCE_REVISION_CHANGED,
  "permission-missing": RESOURCE_PERMISSION_MISSING
});
function resourceDiagnosticCode(reason) {
  return REASON_CODES[reason] ?? RESOURCE_NOT_FOUND;
}
var DEFAULT_RESOURCE_SESSION_LIMITS = Object.freeze({
  maxResources: 256,
  maxBytes: 256n * 1024n * 1024n,
  maxDepth: 8,
  // One scope of a game archive: a bare texture name is looked for in every folder (Emperor's
  // 3DDATA0001.RFH holds 3 749 entries, Diablo III's anim/ 15 258); see DEFAULT_COMPANION_LIMITS.
  maxEntries: 65536
});
function fold(value, caseSensitivity) {
  return caseSensitivity === "insensitive" ? value.toLowerCase() : value;
}
function allowed(logicalId, allowlist) {
  if (allowlist === void 0) return true;
  return allowlist.some((entry) => {
    if (entry === "") return true;
    const normalized = entry.endsWith("/") ? entry : `${entry}/`;
    return logicalId === entry || logicalId.startsWith(normalized);
  });
}
function createResourceSession(options) {
  const limits = { ...DEFAULT_RESOURCE_SESSION_LIMITS, ...options.limits };
  for (const key2 of ["maxResources", "maxDepth", "maxEntries"])
    if (!Number.isSafeInteger(limits[key2]) || limits[key2] < 0)
      throw new TypeError(`invalid resource session ${key2}`);
  if (typeof limits.maxBytes !== "bigint" || limits.maxBytes < 0n)
    throw new TypeError("invalid resource session maxBytes");
  const sessionId = options.sessionId ?? `resource-session-${String(options.revision)}`;
  const origin = options.origin;
  const provenance = [];
  const byRequirementId = /* @__PURE__ */ new Map();
  const index = /* @__PURE__ */ new Map();
  const held = /* @__PURE__ */ new Set();
  const pinnedRevisions = /* @__PURE__ */ new Map();
  let opening = 0;
  let resources = 0;
  let bytes = 0n;
  let state = "live";
  const disposed = () => state === "disposed";
  const record = (requirement, entry) => {
    const value = Object.freeze({
      requirementId: requirement.id,
      logicalId: requirement.logicalId,
      role: requirement.role,
      scopes: Object.freeze([...requirement.scopes]),
      ...entry
    });
    provenance.push(value);
    byRequirementId.set(requirement.id, value);
    return value;
  };
  const unresolved2 = (requirement, reason, message, cached = false) => {
    const item = diagnostic(
      // an unreachable cross-archive texture is a fact about the corpus, not a defect in the model
      reason === "not-found" ? "information" : "warning",
      resourceDiagnosticCode(reason),
      message,
      [requirement.id],
      {
        sessionId,
        logicalId: requirement.logicalId,
        role: requirement.role,
        scopes: [...requirement.scopes]
      }
    );
    options.onDiagnostic?.(item);
    return {
      state: "unresolved",
      reason,
      diagnostic: item,
      provenance: record(requirement, { state: "unresolved", reason, cached })
    };
  };
  const parents = /* @__PURE__ */ new Map();
  const chainOf = (requirement) => {
    const chain = [];
    const seen = /* @__PURE__ */ new Set();
    let cursor2 = requirement.parentResourceId;
    while (cursor2 !== void 0) {
      if (chain.length >= limits.maxDepth) return void 0;
      if (seen.has(cursor2)) break;
      seen.add(cursor2);
      const parent = byRequirementId.get(cursor2);
      if (parent === void 0) break;
      chain.push(parent.logicalId);
      cursor2 = parents.get(cursor2);
    }
    return chain;
  };
  const locate = async (normalized, scopes, signal) => {
    const wanted = fold(normalized, origin.caseSensitivity);
    const byName = !normalized.includes("/");
    for (const scope of scopes) {
      throwIfAborted(signal);
      let entries = 0;
      for await (const entry of origin.enumerate(
        scope,
        { prefix: byName ? "" : normalized },
        signal
      )) {
        entries += 1;
        if (entries > limits.maxEntries) return { found: void 0, overBudget: true };
        const candidate = byName ? entry.logicalId.split("/").at(-1) ?? entry.logicalId : entry.logicalId;
        if (fold(candidate, origin.caseSensitivity) === wanted) {
          return {
            found: entry.logicalId,
            ...entry.rootId === void 0 ? {} : { rootId: entry.rootId },
            overBudget: false
          };
        }
      }
    }
    return { found: void 0, overBudget: false };
  };
  const port = {
    sessionId,
    revision: options.revision,
    primaryLogicalId: options.origin.primaryLogicalId,
    state: () => state,
    async resolve(requirement, signal) {
      requirement = Object.freeze({
        ...requirement,
        scopes: Object.freeze([...requirement.scopes])
      });
      if (state === "disposed") {
        return unresolved2(
          requirement,
          "session-disposed",
          `resource session ${sessionId} is disposed and resolves nothing further`
        );
      }
      throwIfAborted(signal);
      if (options.isAuthorized?.() === false)
        return unresolved2(
          requirement,
          "permission-missing",
          "the current host grant does not admit reading resources"
        );
      if (requirement.parentResourceId !== void 0) {
        parents.set(requirement.id, requirement.parentResourceId);
      }
      let normalized;
      try {
        normalized = normalizeCompanionLogicalId(requirement.logicalId, {
          sessionId,
          requirementId: requirement.id
        });
      } catch (error) {
        if (isModkitError(error) && error.code === COMPANION_PATH_REFUSED) {
          return unresolved2(requirement, "path-refused", error.message);
        }
        throw error;
      }
      const chain = chainOf(requirement);
      if (chain === void 0) {
        return unresolved2(
          requirement,
          "budget-exceeded",
          `resource chain for \xAB${requirement.logicalId}\xBB is deeper than the session depth budget of ${limits.maxDepth}`
        );
      }
      if (chain.some(
        (item) => fold(item, origin.caseSensitivity) === fold(normalized, origin.caseSensitivity)
      )) {
        return unresolved2(
          requirement,
          "cycle-detected",
          `resource \xAB${requirement.logicalId}\xBB is already in its own reference chain: ${[...chain, requirement.logicalId].join(" -> ")}`
        );
      }
      if (!allowed(normalized, options.allowlist)) {
        return unresolved2(
          requirement,
          "not-allowlisted",
          `resource \xAB${requirement.logicalId}\xBB is outside every allowlisted prefix of this session`
        );
      }
      const servedScopes = requirement.scopes.filter((scope) => origin.scopes.includes(scope));
      if (servedScopes.length === 0) {
        return unresolved2(
          requirement,
          "scope-unsupported",
          `this origin serves ${origin.scopes.join(", ")}; the requirement asked only for ${requirement.scopes.join(", ")}`
        );
      }
      const key2 = JSON.stringify([fold(normalized, origin.caseSensitivity), servedScopes]);
      const cached = index.get(key2);
      let found;
      let rootId;
      if (cached !== void 0) {
        found = cached.found;
        rootId = cached.rootId;
        if (found === void 0) {
          return unresolved2(
            requirement,
            "not-found",
            `resource \xAB${requirement.logicalId}\xBB is not in any scope this session serves`,
            true
          );
        }
      } else {
        let located;
        try {
          located = await locate(normalized, servedScopes, signal);
        } catch (error) {
          if (isModkitError(error) && error.code === COMPANION_BUDGET_EXCEEDED)
            return unresolved2(requirement, "budget-exceeded", error.message);
          if (isModkitError(error) && error.code === COMPANION_PATH_REFUSED)
            return unresolved2(requirement, "path-refused", error.message);
          throw error;
        }
        if (located.overBudget) {
          return unresolved2(
            requirement,
            "budget-exceeded",
            `locating \xAB${requirement.logicalId}\xBB exceeded the session entry budget of ${limits.maxEntries}`
          );
        }
        index.set(key2, {
          found: located.found,
          ...located.rootId === void 0 ? {} : { rootId: located.rootId }
        });
        found = located.found;
        rootId = located.rootId;
        if (found === void 0) {
          return unresolved2(
            requirement,
            "not-found",
            `resource \xAB${requirement.logicalId}\xBB is not in any scope this session serves`
          );
        }
      }
      if (disposed()) {
        return unresolved2(
          requirement,
          "session-disposed",
          `resource session ${sessionId} is disposed`
        );
      }
      if (resources + opening >= limits.maxResources) {
        return unresolved2(
          requirement,
          "budget-exceeded",
          `this session already holds ${resources} resources, its limit`
        );
      }
      throwIfAborted(signal);
      if (options.isAuthorized?.() === false)
        return unresolved2(
          requirement,
          "permission-missing",
          "the current host grant does not admit reading resources"
        );
      opening += 1;
      let originLease;
      try {
        originLease = await origin.open(found, signal);
      } catch (error) {
        if (isModkitError(error) && error.code === COMPANION_BUDGET_EXCEEDED)
          return unresolved2(requirement, "budget-exceeded", error.message);
        if (isModkitError(error) && error.code === COMPANION_PATH_REFUSED)
          return unresolved2(requirement, "path-refused", error.message);
        throw error;
      } finally {
        opening -= 1;
      }
      if (signal?.aborted) {
        await originLease.release();
        throwIfAborted(signal);
      }
      if (options.isAuthorized?.() === false) {
        await originLease.release();
        return unresolved2(
          requirement,
          "permission-missing",
          "the host grant changed while the resource was opening"
        );
      }
      if (disposed()) {
        await originLease.release();
        return unresolved2(
          requirement,
          "session-disposed",
          `resource session ${sessionId} was disposed while \xAB${requirement.logicalId}\xBB was being opened`
        );
      }
      const pinnedRevision = pinnedRevisions.get(originLease.value.ref.id);
      if (options.revisionPolicy === "pin" && pinnedRevision !== void 0 && pinnedRevision !== originLease.value.revision) {
        await originLease.release();
        return unresolved2(
          requirement,
          "source-revision-changed",
          `resource \xAB${requirement.logicalId}\xBB changed after its first observed revision`
        );
      }
      const size = originLease.value.kind === "bytes" ? originLease.value.size ?? 0n : 0n;
      if (bytes + size > limits.maxBytes) {
        await originLease.release();
        return unresolved2(
          requirement,
          "budget-exceeded",
          `resolving \xAB${requirement.logicalId}\xBB would exceed the session byte budget of ${limits.maxBytes}`
        );
      }
      let released = false;
      const lease = {
        value: originLease.value,
        async release() {
          if (released) return;
          released = true;
          held.delete(lease);
          resources -= 1;
          bytes -= size;
          await originLease.release();
        }
      };
      held.add(lease);
      resources += 1;
      bytes += size;
      if (options.revisionPolicy === "pin")
        pinnedRevisions.set(lease.value.ref.id, lease.value.revision);
      return {
        state: "resolved",
        lease,
        revision: lease.value.revision,
        provenance: record(requirement, {
          state: "resolved",
          revision: lease.value.revision,
          bytes: size,
          cached: cached !== void 0,
          ...rootId === void 0 ? {} : { rootId }
        })
      };
    },
    provenance: () => Object.freeze([...provenance]),
    async dispose() {
      if (state === "disposed") return;
      state = "disposed";
      const outstanding = [...held];
      held.clear();
      const results = await Promise.allSettled(outstanding.map((lease) => lease.release()));
      const failure2 = results.find((result) => result.status === "rejected");
      if (failure2 !== void 0 && failure2.status === "rejected") throw failure2.reason;
    }
  };
  return {
    ...port,
    // The logical id, then each alternative while the last one was not found: the game's fallback.
    async resolve(requirement, signal) {
      let result = await port.resolve(requirement, signal);
      for (const logicalId of requirement.alternatives ?? []) {
        if (result.state === "resolved" || result.reason !== "not-found") break;
        result = await port.resolve({ ...requirement, logicalId }, signal);
      }
      return result;
    }
  };
}
var INVENTORY_RECORD = /* @__PURE__ */ Symbol.for("x3.host/inventory-record");
function inventoryRecordFor(contribution) {
  const record = contribution[INVENTORY_RECORD];
  return record !== void 0 && Object.isFrozen(record) && record.publicRecord === contribution.record ? record : void 0;
}
var RESTRICTED_LINKED_EXECUTION = Object.freeze({
  origin: "linked",
  allowTrustedInProcess: false
});
var PROVIDER_OFFER_INVENTORY_FACT = contractId(
  "modkit.inventory/provider-offer"
);
var VIEWER_CONTRIBUTION_INVENTORY_FACT = contractId(
  "modkit.inventory/viewer-contribution"
);
var offerBindings = /* @__PURE__ */ new WeakMap();
function inventoryBindingForOffer(offer) {
  return offerBindings.get(offer);
}
function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}
function string(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-blank string`);
  }
  return value;
}
function safeMajor(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a safe non-negative integer`);
  }
  return value;
}
function parseRequirement(value, label) {
  const item = object(value, label);
  return Object.freeze({
    contract: contractId(string(item["contract"], `${label}.contract`)),
    major: safeMajor(item["major"], `${label}.major`),
    ...item["range"] === void 0 ? {} : { range: string(item["range"], `${label}.range`) }
  });
}
function parseContractOffer(value, label) {
  const item = object(value, label);
  const version = string(item["version"], `${label}.version`);
  const major = safeMajor(item["major"], `${label}.major`);
  const parsed = parseSemver(version);
  if (parsed === void 0 || parsed.major !== major) {
    throw new TypeError(`${label}.version must be exact SemVer in declared major`);
  }
  return Object.freeze({
    offerId: string(item["offerId"], `${label}.offerId`),
    contract: contractId(string(item["contract"], `${label}.contract`)),
    major,
    version,
    ...item["facet"] === void 0 ? {} : { facet: item["facet"] }
  });
}
function parseOutputs(value) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new TypeError("outputs must be an array");
  return Object.freeze(
    value.map((raw, index) => {
      const item = object(raw, `outputs[${index}]`);
      const id = string(item["id"], `outputs[${index}].id`);
      if (!isTraitId(id)) throw new TypeError(`outputs[${index}].id is not a trait id`);
      return Object.freeze({
        id,
        ...item["definitionVersion"] === void 0 ? {} : {
          definitionVersion: string(
            item["definitionVersion"],
            `outputs[${index}].definitionVersion`
          )
        }
      });
    })
  );
}
function parseTarget(value) {
  const target = object(value, "target");
  return JSON.parse(canonicalJsonStringify(target));
}
function parseProviderOffer(value) {
  const item = object(value, "provider offer fact");
  const provides = item["provides"];
  if (!Array.isArray(provides) || provides.length === 0) {
    throw new TypeError("provider offer fact needs at least one logical offer");
  }
  const kind = item["kind"];
  if (!["primary", "replacement", "augmentation", "projection", "operation"].includes(String(kind))) {
    throw new TypeError("provider offer kind is invalid");
  }
  const providerId = string(item["providerId"], "providerId");
  if (!isQualifiedId(providerId)) throw new TypeError("providerId must be qualified");
  const parseRequirementArray = (raw, label) => {
    if (raw === void 0) return void 0;
    if (!Array.isArray(raw)) throw new TypeError(`${label} must be an array`);
    return Object.freeze(raw.map((entry, index) => parseRequirement(entry, `${label}[${index}]`)));
  };
  const operations = item["operations"];
  if (operations !== void 0 && !Array.isArray(operations)) {
    throw new TypeError("operations must be an array");
  }
  const requires = parseRequirementArray(item["requires"], "requires");
  const outputs = parseOutputs(item["outputs"]);
  const requiredPermissions = item["requiredPermissions"];
  if (requiredPermissions !== void 0 && !Array.isArray(requiredPermissions)) {
    throw new TypeError("requiredPermissions must be an array");
  }
  return Object.freeze({
    kind,
    extensionId: string(item["extensionId"], "extensionId"),
    extensionVersion: string(item["extensionVersion"], "extensionVersion"),
    providerId,
    runtimeVariant: string(item["runtimeVariant"], "runtimeVariant"),
    target: parseTarget(item["target"]),
    ...requiredPermissions === void 0 ? {} : {
      requiredPermissions
    },
    provides: Object.freeze(
      provides.map((entry, index) => parseContractOffer(entry, `provides[${index}]`))
    ),
    ...requires === void 0 ? {} : { requires },
    ...outputs === void 0 ? {} : { outputs },
    ...operations === void 0 ? {} : {
      operations: Object.freeze(
        operations.map((entry, index) => string(entry, `operations[${index}]`))
      )
    },
    ...item["replaces"] === void 0 ? {} : { replaces: parseRequirement(item["replaces"], "replaces") }
  });
}
var catalogs = /* @__PURE__ */ new WeakMap();
function offersFromInventory(inventory) {
  const cached = catalogs.get(inventory);
  if (cached !== void 0) return cached;
  const catalog = [];
  const fingerprints = /* @__PURE__ */ new Map();
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (!contribution.activationEligible) continue;
      const privateRecord = inventoryRecordFor(contribution);
      if (privateRecord === void 0 || contribution.record === void 0) continue;
      for (const fact of contribution.facts) {
        if (fact.contract.id !== PROVIDER_OFFER_INVENTORY_FACT || fact.contract.major !== 1) {
          continue;
        }
        const offer = parseProviderOffer(fact.value);
        const offerFingerprint = canonicalJsonStringify(offer);
        offerBindings.set(offer, {
          contribution,
          record: privateRecord.publicRecord,
          offerFingerprint
        });
        fingerprints.set(offer, offerFingerprint);
        catalog.push(offer);
      }
    }
  }
  const sorted2 = Object.freeze(
    catalog.sort(
      (left, right) => compareUtf8(fingerprints.get(left) ?? "", fingerprints.get(right) ?? "")
    )
  );
  catalogs.set(inventory, sorted2);
  return sorted2;
}
var RESOLVER_VERSION = 1;
var resolverProducts = /* @__PURE__ */ new WeakMap();
function requestProvenanceKey(request) {
  return canonicalJsonStringify(request);
}
function isResolverProduct(result) {
  const provenance = resolverProducts.get(result);
  return provenance !== void 0 && provenance.resultKey === canonicalJsonStringify(result);
}
function isResolutionForRequest(result, request) {
  const provenance = resolverProducts.get(result);
  return provenance !== void 0 && provenance.requestKey === requestProvenanceKey(request) && provenance.resultKey === canonicalJsonStringify(result);
}
function remember(result, request) {
  resolverProducts.set(result, {
    requestKey: requestProvenanceKey(request),
    resultKey: canonicalJsonStringify(result)
  });
  return result;
}
function candidateSortKey(candidate) {
  return canonicalJsonStringify({
    providerId: candidate.offer.providerId,
    runtimeVariant: candidate.offer.runtimeVariant,
    offerId: candidate.contractOffer.offerId,
    version: candidate.contractOffer.version
  });
}
function isSubset(needed, have) {
  return (needed ?? []).every((item) => have.includes(item));
}
function traitOfferMatches(requirement, offer) {
  if (requirement.id !== offer.id) return false;
  if (isStandardTraitId(requirement.id)) {
    return requirement.definitionRange === void 0 && offer.definitionVersion === void 0;
  }
  if (requirement.definitionRange === void 0 || offer.definitionVersion === void 0)
    return false;
  const range = parseVersionRange(requirement.definitionRange);
  const version = parseSemver(offer.definitionVersion);
  return range !== void 0 && version !== void 0 && satisfiesRange(version, range);
}
function hasTraitOutputs(needed, offered) {
  return (needed ?? []).every(
    (requirement) => offered.some((offer) => traitOfferMatches(requirement, offer))
  );
}
function uniqueTraitRequirements(values) {
  const unique = /* @__PURE__ */ new Map();
  for (const value of values ?? []) {
    const range = value.definitionRange === void 0 ? void 0 : parseVersionRange(value.definitionRange);
    const normalized = {
      id: value.id,
      ...value.definitionRange === void 0 ? {} : { definitionRange: range?.normalized ?? value.definitionRange }
    };
    unique.set(canonicalJsonStringify(normalized), normalized);
  }
  return [...unique.values()];
}
function traitRequirementsAreValid(values) {
  return (values ?? []).every(
    (value) => isStandardTraitId(value.id) ? value.definitionRange === void 0 : value.definitionRange !== void 0 && parseVersionRange(value.definitionRange) !== void 0
  );
}
function resolveProvider(request, offers, preparation) {
  if (!traitRequirementsAreValid(request.requiredOutputs) || !traitRequirementsAreValid(request.preferredOutputs)) {
    return remember({ state: "unresolved", reason: "output-missing", rejected: [] }, request);
  }
  const requiredOutputs = uniqueTraitRequirements(request.requiredOutputs);
  const preferredOutputs = uniqueTraitRequirements(request.preferredOutputs);
  const rejected2 = [];
  const reject = (offer, reason, detail, offerId) => rejected2.push({
    providerId: offer.providerId,
    runtimeVariant: offer.runtimeVariant,
    ...offerId === void 0 ? {} : { offerId },
    reason,
    ...detail === void 0 ? {} : { detail }
  });
  const candidates = [];
  for (const offer of offers) {
    const contractMatches = offer.provides.filter((p) => {
      if (p.contract !== request.contract.contract || p.major !== request.contract.major) {
        return false;
      }
      const version = parseSemver(p.version);
      return version !== void 0 && version.major === p.major && (preparation?.accepts?.(offer, p) ?? true);
    });
    if (contractMatches.length === 0) {
      reject(
        offer,
        "no-offer",
        `does not provide ${request.contract.contract}@${request.contract.major}`
      );
      continue;
    }
    if (offer.kind !== "primary" && offer.kind !== "replacement") {
      reject(
        offer,
        "unsupported-kind",
        `resolver v1 executes only primary/replacement, got ${offer.kind}`
      );
      continue;
    }
    for (const match of contractMatches) {
      const selectionKey = preparation?.selectionKey?.(offer, match);
      candidates.push({
        offer,
        contractOffer: match,
        ...selectionKey === void 0 ? {} : { contractSelectionKey: selectionKey }
      });
    }
  }
  if (candidates.length === 0) {
    return remember(
      { state: "unresolved", reason: "no-offer", rejected: sortRejected(rejected2) },
      request
    );
  }
  const range = parseVersionRange(request.contract.range ?? "*");
  const versionOk = candidates.filter((candidate) => {
    const version = parseSemver(candidate.contractOffer.version);
    if (version === void 0 || range === void 0 || !satisfiesRange(version, range)) {
      reject(
        candidate.offer,
        "version-incompatible",
        `${candidate.contractOffer.version} \u2209 ${request.contract.range ?? "*"}`,
        candidate.contractOffer.offerId
      );
      return false;
    }
    return true;
  });
  if (versionOk.length === 0) {
    return remember(
      {
        state: "unresolved",
        reason: "version-incompatible",
        rejected: sortRejected(rejected2)
      },
      request
    );
  }
  let sawToolReject = false;
  const targetOf = (offer) => preparation?.targetFor?.(offer) ?? request.target;
  const targetOk = versionOk.filter((candidate) => {
    const constraint = candidate.offer.target;
    const target = targetOf(candidate.offer);
    const envOk = constraint.environments === void 0 || constraint.environments.includes(target.environment);
    const osOk = constraint.operatingSystems === void 0 || constraint.operatingSystems.includes("any") || constraint.operatingSystems.includes(target.operatingSystem);
    const archOk = constraint.architectures === void 0 || constraint.architectures.includes("any") || constraint.architectures.includes(target.architecture);
    const capsOk = isSubset(constraint.requiredHostCapabilities, [
      ...target.hostCapabilities ?? []
    ]);
    const apisOk = isSubset(constraint.requiredWebApis, [...target.webApis ?? []]);
    if (!envOk || !osOk || !archOk || !capsOk || !apisOk) {
      reject(candidate.offer, "target-incompatible", void 0, candidate.contractOffer.offerId);
      return false;
    }
    if (!isSubset(constraint.externalTools, [...target.externalTools ?? []])) {
      reject(candidate.offer, "external-tool-required", void 0, candidate.contractOffer.offerId);
      sawToolReject = true;
      return false;
    }
    return true;
  });
  if (targetOk.length === 0) {
    const onlyToolRejects = sawToolReject && !rejected2.some((r) => r.reason === "target-incompatible");
    return remember(
      {
        state: "unresolved",
        reason: onlyToolRejects ? "external-tool-required" : "target-incompatible",
        rejected: sortRejected(rejected2)
      },
      request
    );
  }
  let sawPermissionReject = false;
  const permitted = targetOk.filter((candidate) => {
    const granted = targetOf(candidate.offer).grantedPermissions ?? [];
    if (!isSubset(candidate.offer.requiredPermissions, [...granted])) {
      reject(candidate.offer, "permission-required", void 0, candidate.contractOffer.offerId);
      sawPermissionReject = true;
      return false;
    }
    if (!hasTraitOutputs(requiredOutputs, candidate.offer.outputs ?? [])) {
      reject(candidate.offer, "output-missing", void 0, candidate.contractOffer.offerId);
      return false;
    }
    return true;
  });
  if (permitted.length === 0) {
    return remember(
      {
        state: "unresolved",
        reason: sawPermissionReject ? "permission-required" : "output-missing",
        rejected: sortRejected(rejected2)
      },
      request
    );
  }
  let pool = permitted;
  if (request.pin) {
    const pin = request.pin;
    pool = permitted.filter((candidate) => {
      const hit = candidate.offer.providerId === pin.providerId && (pin.runtimeVariant === void 0 || candidate.offer.runtimeVariant === pin.runtimeVariant) && (pin.offerId === void 0 || candidate.contractOffer.offerId === pin.offerId);
      if (!hit) {
        reject(candidate.offer, "pin-unsatisfied", void 0, candidate.contractOffer.offerId);
      }
      return hit;
    });
    if (pool.length === 0) {
      return remember(
        {
          state: "unresolved",
          reason: "pin-unsatisfied",
          rejected: sortRejected(rejected2)
        },
        request
      );
    }
  }
  const score = (candidate) => [
    request.operation !== void 0 && (candidate.offer.operations ?? []).includes(request.operation) ? 1 : 0,
    preferredOutputs.filter(
      (requirement) => (candidate.offer.outputs ?? []).some((offer) => traitOfferMatches(requirement, offer))
    ).length,
    targetOf(candidate.offer) === request.target ? 1 : 0
  ];
  const compareTuple = (a, b) => {
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return a[i] < b[i] ? 1 : -1;
    }
    return 0;
  };
  const ranked = [...pool].sort(
    (a, b) => compareTuple(score(a), score(b)) || compareUtf8(candidateSortKey(a), candidateSortKey(b))
  );
  const best = ranked[0];
  const tied = ranked.filter((c2) => compareTuple(score(c2), score(best)) === 0);
  if (tied.length > 1) {
    for (const candidate of tied) {
      reject(candidate.offer, "ambiguous", "preference tuple tie", candidate.contractOffer.offerId);
    }
    return remember(
      { state: "unresolved", reason: "ambiguous", rejected: sortRejected(rejected2) },
      request
    );
  }
  const toResolved = (candidate) => ({
    offer: candidate.offer,
    resolvedContract: candidate.contractOffer,
    ...candidate.contractSelectionKey === void 0 ? {} : { contractSelectionKey: candidate.contractSelectionKey }
  });
  return remember(
    {
      state: "resolved",
      selected: toResolved(best),
      alternatives: ranked.slice(1).map(toResolved),
      rejected: sortRejected(rejected2)
    },
    request
  );
}
function sortRejected(rejected2) {
  const keyed = rejected2.map((candidate) => ({ candidate, key: canonicalJsonStringify(candidate) }));
  keyed.sort((a, b) => compareUtf8(a.key, b.key));
  return keyed.map((entry) => entry.candidate);
}
function normalizeTraitRequirements(values) {
  const normalized = /* @__PURE__ */ new Map();
  for (const value of values ?? []) {
    let item;
    if (isStandardTraitId(value.id)) {
      if (value.definitionRange !== void 0) {
        throw new ModkitError({
          code: "x3.host/invalid-trait-range",
          message: `standard trait ${value.id} must not declare a definition range`
        });
      }
      item = { id: value.id };
    } else {
      const range = value.definitionRange === void 0 ? void 0 : parseVersionRange(value.definitionRange);
      if (range === void 0) {
        throw new ModkitError({
          code: "x3.host/invalid-trait-range",
          message: `custom trait ${value.id} requires a parseable definition range`
        });
      }
      item = { id: value.id, definitionRange: range.normalized };
    }
    normalized.set(canonicalJsonStringify(item), item);
  }
  return [...normalized.entries()].sort(([left], [right]) => compareUtf8(left, right)).map(([, item]) => item);
}
function buildLockKey(request) {
  const range = parseVersionRange(request.contract.range ?? "*");
  if (range === void 0) {
    throw new ModkitError({
      code: "x3.host/invalid-range",
      message: `unparseable range \xAB${request.contract.range ?? ""}\xBB`
    });
  }
  return {
    contract: request.contract.contract,
    major: request.contract.major,
    normalizedRange: range.normalized,
    ...request.operation === void 0 ? {} : { operation: request.operation },
    requiredOutputs: normalizeTraitRequirements(request.requiredOutputs),
    preferredOutputs: normalizeTraitRequirements(request.preferredOutputs),
    ...request.workload === void 0 ? {} : { workload: request.workload }
  };
}
function buildLockEntry(request, result) {
  if (result.state !== "resolved") {
    throw new ModkitError({
      code: "x3.host/lock-of-unresolved",
      message: `cannot lock an unresolved result (${result.reason})`
    });
  }
  if (!isResolutionForRequest(result, request)) {
    throw new ModkitError({
      code: "x3.host/lock-request-mismatch",
      message: "resolution result was not produced for this exact request"
    });
  }
  const offer = result.selected.offer;
  return {
    key: {
      ...buildLockKey(request),
      ...result.selected.contractSelectionKey === void 0 ? {} : { contractSelectionKey: result.selected.contractSelectionKey }
    },
    primary: {
      extension: offer.extensionId,
      contributionId: offer.providerId,
      contractMajor: result.selected.resolvedContract.major,
      offerId: result.selected.resolvedContract.offerId
    },
    resolverVersion: RESOLVER_VERSION
  };
}
function lockKeyString(key2) {
  return canonicalJsonStringify(key2);
}
function serializePolicyLock(entries) {
  const seen = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const key2 = lockKeyString(entry.key);
    const rendered = canonicalJsonStringify(entry);
    const prior = seen.get(key2);
    if (prior !== void 0 && prior !== rendered) {
      throw new ModkitError({
        code: "x3.host/conflicting-lock-entries",
        message: "two policy-lock entries share one key but select differently \u2014 one request cannot have two answers",
        context: { key: key2 }
      });
    }
    seen.set(key2, rendered);
  }
  const sorted2 = [...entries].sort((a, b) => {
    const byKey = compareUtf8(lockKeyString(a.key), lockKeyString(b.key));
    return byKey !== 0 ? byKey : compareUtf8(canonicalJsonStringify(a), canonicalJsonStringify(b));
  });
  return canonicalJsonStringify({ schemaVersion: 1, entries: sorted2 });
}
function failLock(message, context) {
  throw new ModkitError({
    code: "x3.host/invalid-policy-lock",
    message,
    ...context === void 0 ? {} : { context }
  });
}
function exactKeys(value, required, optional, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failLock(`${label} must be an object`);
  }
  const record = value;
  const allowed2 = /* @__PURE__ */ new Set([...required, ...optional]);
  if (required.some((key2) => !(key2 in record)) || Object.keys(record).some((key2) => !allowed2.has(key2))) {
    return failLock(`${label} has missing or unknown fields`);
  }
  return record;
}
function lockString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return failLock(`${label} must be a non-blank string`);
  }
  return value;
}
function lockMajor(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    return failLock(`${label} must be a safe non-negative integer`);
  }
  return value;
}
function parseLockedTrait(value, label) {
  const record = exactKeys(value, ["id"], ["definitionRange"], label);
  const idText = lockString(record["id"], `${label}.id`);
  if (!isTraitId(idText)) return failLock(`${label}.id must be a trait id`);
  if (isStandardTraitId(idText)) {
    if (record["definitionRange"] !== void 0) {
      return failLock(`${label}: a standard trait cannot carry definitionRange`);
    }
    return Object.freeze({ id: idText });
  }
  const rangeText = lockString(record["definitionRange"], `${label}.definitionRange`);
  const range = parseVersionRange(rangeText);
  if (range === void 0 || range.normalized !== rangeText) {
    return failLock(`${label}.definitionRange is not canonical`);
  }
  return Object.freeze({ id: idText, definitionRange: rangeText });
}
function parseLockedTraits(value, label) {
  if (!Array.isArray(value)) return failLock(`${label} must be an array`);
  const parsed = value.map((item, index) => parseLockedTrait(item, `${label}[${index}]`));
  const normalized = normalizeTraitRequirements(parsed);
  if (canonicalJsonStringify(parsed) !== canonicalJsonStringify(normalized)) {
    return failLock(`${label} must be unique and canonically sorted`);
  }
  return normalized;
}
function parseLockKey(value, label) {
  const record = exactKeys(
    value,
    ["contract", "major", "normalizedRange", "requiredOutputs", "preferredOutputs"],
    ["contractSelectionKey", "operation", "workload"],
    label
  );
  const contractText = lockString(record["contract"], `${label}.contract`);
  if (!isQualifiedId(contractText)) return failLock(`${label}.contract must be qualified`);
  const rangeText = lockString(record["normalizedRange"], `${label}.normalizedRange`);
  const range = parseVersionRange(rangeText);
  if (range === void 0 || range.normalized !== rangeText) {
    return failLock(`${label}.normalizedRange is not canonical`);
  }
  const workload = record["workload"];
  if (workload !== void 0 && !["thumbnail", "interactive", "batch", "lossless-edit", "simulation", "archival"].includes(
    String(workload)
  )) {
    return failLock(`${label}.workload is invalid`);
  }
  return Object.freeze({
    contract: contractId(contractText),
    major: lockMajor(record["major"], `${label}.major`),
    normalizedRange: rangeText,
    ...record["contractSelectionKey"] === void 0 ? {} : {
      contractSelectionKey: lockString(
        record["contractSelectionKey"],
        `${label}.contractSelectionKey`
      )
    },
    ...record["operation"] === void 0 ? {} : {
      operation: lockString(record["operation"], `${label}.operation`)
    },
    requiredOutputs: parseLockedTraits(record["requiredOutputs"], `${label}.requiredOutputs`),
    preferredOutputs: parseLockedTraits(record["preferredOutputs"], `${label}.preferredOutputs`),
    ...workload === void 0 ? {} : { workload }
  });
}
function parseSelection(value, label) {
  const record = exactKeys(
    value,
    ["extension", "contributionId", "contractMajor", "offerId"],
    ["releaseRange"],
    label
  );
  const extension = lockString(record["extension"], `${label}.extension`);
  const contributionId2 = lockString(record["contributionId"], `${label}.contributionId`);
  if (!isQualifiedId(extension) || !isQualifiedId(contributionId2)) {
    return failLock(`${label} coordinates must be qualified`);
  }
  let releaseRange;
  if (record["releaseRange"] !== void 0) {
    releaseRange = lockString(record["releaseRange"], `${label}.releaseRange`);
    const parsed = parseVersionRange(releaseRange);
    if (parsed === void 0 || parsed.normalized !== releaseRange) {
      return failLock(`${label}.releaseRange is not canonical`);
    }
  }
  return Object.freeze({
    extension,
    ...releaseRange === void 0 ? {} : { releaseRange },
    contributionId: contributionId2,
    contractMajor: lockMajor(record["contractMajor"], `${label}.contractMajor`),
    offerId: lockString(record["offerId"], `${label}.offerId`)
  });
}
function parsePolicyLock(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return failLock("policy lock is not valid JSON");
  }
  const root = exactKeys(value, ["schemaVersion", "entries"], [], "policy lock");
  if (root["schemaVersion"] !== 1 || !Array.isArray(root["entries"])) {
    return failLock("policy lock schemaVersion/entries are invalid");
  }
  const entries = root["entries"].map((raw, index) => {
    const item = exactKeys(
      raw,
      ["key", "primary", "resolverVersion"],
      ["allowedFallbacks"],
      `entries[${index}]`
    );
    if (item["resolverVersion"] !== RESOLVER_VERSION) {
      return failLock(`entries[${index}].resolverVersion is unsupported`);
    }
    if (item["allowedFallbacks"] !== void 0 && !Array.isArray(item["allowedFallbacks"])) {
      return failLock(`entries[${index}].allowedFallbacks must be an array`);
    }
    return Object.freeze({
      key: parseLockKey(item["key"], `entries[${index}].key`),
      primary: parseSelection(item["primary"], `entries[${index}].primary`),
      ...item["allowedFallbacks"] === void 0 ? {} : {
        allowedFallbacks: Object.freeze(
          item["allowedFallbacks"].map(
            (entry, fallbackIndex) => parseSelection(entry, `entries[${index}].allowedFallbacks[${fallbackIndex}]`)
          )
        )
      },
      resolverVersion: RESOLVER_VERSION
    });
  });
  const canonical = serializePolicyLock(entries);
  if (canonical !== text) return failLock("policy lock bytes are not canonical");
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) });
}
async function resolveServiceProvider(request, offers, definitions, targetFor) {
  const accepted = /* @__PURE__ */ new Set();
  const selectionKeys = /* @__PURE__ */ new Map();
  for (const offer of offers) {
    for (const logical of offer.provides) {
      if (logical.contract !== request.contract.contract || logical.major !== request.contract.major) {
        continue;
      }
      const result = await definitions.matchFacets({
        contract: logical.contract,
        major: logical.major,
        ownerExtensionId: offer.extensionId,
        offerFacet: logical.facet,
        requestFacet: request.requestFacet
      });
      if (result.state === "match") {
        accepted.add(logical);
        selectionKeys.set(logical, result.selectionKey);
      }
    }
  }
  return resolveProvider(request, offers, {
    accepts: (_offer, logical) => accepted.has(logical),
    selectionKey: (_offer, logical) => selectionKeys.get(logical),
    ...targetFor === void 0 ? {} : { targetFor }
  });
}
function createContractResolverPort(options) {
  const resolve = async (request) => {
    const contract = contractId(request.contract);
    if (options.definitions.lookup(contract, request.major) === void 0) {
      throw new ModkitError({
        code: "x3.host/service-contract-unregistered",
        message: `service contract ${request.contract}@${request.major} is not registered`
      });
    }
    const providerRequest = {
      contract: { contract, major: request.major },
      target: options.target,
      ...request.facet === void 0 ? {} : { requestFacet: request.facet },
      ...request.requiredOutputs === void 0 ? {} : { requiredOutputs: request.requiredOutputs },
      ...request.operation === void 0 ? {} : { operation: request.operation }
    };
    const result = await resolveServiceProvider(
      providerRequest,
      options.offers,
      options.definitions,
      options.targetFor
    );
    if (result.state !== "resolved") {
      throw new ModkitError({
        code: "x3.host/service-contract-unresolved",
        message: `service contract resolution failed: ${result.reason}`,
        context: { reason: result.reason }
      });
    }
    const selection = {
      offerId: result.selected.resolvedContract.offerId,
      contract: result.selected.resolvedContract.contract,
      major: result.selected.resolvedContract.major,
      ...result.selected.contractSelectionKey === void 0 ? {} : { contractSelectionKey: result.selected.contractSelectionKey }
    };
    await options.onResolved?.(providerRequest, result);
    return options.activate(selection, result, request.signal);
  };
  return {
    async resolve(request) {
      return await resolve(request);
    },
    async resolveUnknown(request) {
      return resolve(request);
    }
  };
}
var SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
var WINDOWS_DRIVE = /^[a-zA-Z]:/;
function refuse(entrypoint, why) {
  return new ModkitError({
    code: "x3.host/entrypoint-not-contained",
    message: `entry point \xAB${entrypoint}\xBB is not a relative path inside the artifact: ${why}`,
    context: { entrypoint, why }
  });
}
function assertRelativeEntrypoint(entrypoint) {
  if (entrypoint.trim().length === 0) throw refuse(entrypoint, "empty");
  if (/[\u0000-\u001f\u007f]/.test(entrypoint)) {
    throw refuse(entrypoint, "contains control characters");
  }
  if (SCHEME.test(entrypoint) && !WINDOWS_DRIVE.test(entrypoint)) {
    throw refuse(entrypoint, "URL schemes are not allowed");
  }
  if (WINDOWS_DRIVE.test(entrypoint)) throw refuse(entrypoint, "absolute Windows path");
  if (entrypoint.startsWith("/") || entrypoint.startsWith("\\")) {
    throw refuse(entrypoint, "absolute path");
  }
  if (entrypoint.includes("\\")) throw refuse(entrypoint, "use forward slashes");
  if (entrypoint.split("/").includes("..")) throw refuse(entrypoint, "`..` traversal");
}
function resolveContainedEntrypoint(baseUrl, entrypoint) {
  assertRelativeEntrypoint(entrypoint);
  const root = baseUrl.href.endsWith("/") ? baseUrl : new URL(`${baseUrl.href}/`);
  const resolved = new URL(entrypoint, root);
  if (resolved.protocol !== root.protocol) {
    throw refuse(entrypoint, `resolved to a different protocol (${resolved.protocol})`);
  }
  if (!resolved.href.startsWith(root.href)) {
    throw refuse(entrypoint, `resolved outside the artifact root (${root.href})`);
  }
  return resolved;
}
var PROFILE_VALUES = Object.freeze([
  "browser-sandbox",
  "worker-brokered",
  "process-brokered",
  "wasm-brokered",
  "trusted-in-process",
  "remote-provider"
]);
var REGISTRY_BINDINGS = /* @__PURE__ */ Symbol.for("x3.host/execution-backend-registry-bindings");
function bindingsOf(registry) {
  const value = registry[REGISTRY_BINDINGS];
  return value instanceof Map ? value : void 0;
}
function invalid(message) {
  return new ModkitError({ code: "x3.host/invalid-execution-backend", message });
}
function createExecutionBackendRegistry(backends, options = {}) {
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
    ...options.inProcessTarget === void 0 ? {} : { inProcessTarget: options.inProcessTarget },
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
async function activateExecutionBackend(registry, context) {
  throwIfAborted(context.signal);
  const bindings = bindingsOf(registry);
  if (bindings === void 0) {
    throw invalid("execution backend registry was not created by this host");
  }
  const profile = context.variant.executionProfile;
  const binding = bindings.get(profile);
  if (binding === void 0 || !registry.supports(profile, context.target, context.variant)) {
    throw new ModkitError({
      code: "x3.host/execution-backend-unavailable",
      message: `no execution backend can honour ${profile} for ${context.target.environment}`,
      context: { profile, environment: context.target.environment }
    });
  }
  const raw = await binding.activate({
    ...context,
    entrypoint: new URL(context.entrypoint.href),
    artifactRoot: new URL(context.artifactRoot.href)
  });
  if (typeof raw !== "object" || raw === null || typeof raw.module !== "object" || raw.module === null || Array.isArray(raw.module) || typeof raw.release !== "function") {
    if (typeof raw === "object" && raw !== null && typeof raw.release === "function") {
      try {
        await raw.release();
      } catch {
      }
    }
    throw invalid(`execution backend ${profile} returned an invalid module lease`);
  }
  let released = false;
  return Object.freeze({
    module: raw.module,
    async release() {
      if (released) return;
      released = true;
      await raw.release();
    }
  });
}
var TRUSTED_IN_PROCESS_EXECUTION_BACKEND = /* @__PURE__ */ Object.freeze(
  {
    profile: "trusted-in-process",
    supports: (_target, variant) => variant.executionProfile === "trusted-in-process",
    async activate(context) {
      throwIfAborted(context.signal);
      const module = await import(context.entrypoint.href);
      return Object.freeze({ module, release: async () => void 0 });
    }
  }
);
var DEFAULT_EXECUTION_BACKENDS = /* @__PURE__ */ createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND]);
var issuedTickets = /* @__PURE__ */ new WeakSet();
var ticketBindings = /* @__PURE__ */ new WeakMap();
function resolveForActivation(request, offers, operation) {
  const result = resolveProvider(request, offers);
  if (result.state !== "resolved") return { result };
  const binding = inventoryBindingForOffer(result.selected.offer);
  if (binding === void 0) return { result };
  return { result, ticket: issueActivationTicket(result, request.target, operation) };
}
function issueActivationTicket(result, target, operation) {
  if (!isResolverProduct(result)) {
    throw new ModkitError({
      code: "x3.host/foreign-resolution-result",
      message: "this object was not produced by the host resolver \u2014 a ticket can only be issued for a real resolution"
    });
  }
  if (result.state !== "resolved") {
    throw new ModkitError({
      code: "x3.host/no-ticket-for-unresolved",
      message: `cannot issue an activation ticket for an unresolved result (${result.reason})`,
      context: { reason: result.reason }
    });
  }
  const offer = result.selected.offer;
  const inventoryBinding = inventoryBindingForOffer(offer);
  if (inventoryBinding === void 0) {
    throw new ModkitError({
      code: "x3.host/offer-not-in-inventory",
      message: "activation tickets can only be issued for production inventory offers"
    });
  }
  const privateRecord = inventoryRecordFor(inventoryBinding.contribution);
  if (privateRecord === void 0 || inventoryBinding.contribution.manifest === void 0) {
    throw new ModkitError({
      code: "x3.host/inventory-record-unavailable",
      message: "the selected provider no longer has an attested inventory record"
    });
  }
  const manifest = inventoryBinding.contribution.manifest;
  const ticket = Object.freeze({
    contributionContract: Object.freeze({
      id: manifest.contract.id,
      major: manifest.contract.major
    }),
    offeredContract: Object.freeze({
      id: result.selected.resolvedContract.contract,
      version: result.selected.resolvedContract.version
    }),
    inventoryRecordId: privateRecord.publicRecord.inventoryRecordId,
    manifestDigest: privateRecord.publicRecord.manifestDigest,
    artifactDigest: privateRecord.publicRecord.artifactDigest,
    artifactRoot: new URL(privateRecord.publicRecord.artifactRoot),
    extensionId: offer.extensionId,
    contributionId: offer.providerId,
    offerId: result.selected.resolvedContract.offerId,
    offerFingerprint: inventoryBinding.offerFingerprint,
    ...result.selected.contractSelectionKey === void 0 ? {} : { contractSelectionKey: result.selected.contractSelectionKey },
    variantId: offer.runtimeVariant,
    target: JSON.parse(canonicalJsonStringify(target)),
    ...operation === void 0 ? {} : { operation }
  });
  issuedTickets.add(ticket);
  ticketBindings.set(ticket, {
    contribution: inventoryBinding.contribution,
    ticketFingerprint: ticketFingerprint(ticket)
  });
  return ticket;
}
function ticketFingerprint(ticket) {
  return canonicalJsonStringify({
    contributionContract: ticket.contributionContract,
    offeredContract: ticket.offeredContract,
    inventoryRecordId: ticket.inventoryRecordId,
    manifestDigest: ticket.manifestDigest,
    artifactDigest: ticket.artifactDigest,
    artifactRoot: ticket.artifactRoot.href,
    extensionId: ticket.extensionId,
    contributionId: ticket.contributionId,
    offerId: ticket.offerId,
    offerFingerprint: ticket.offerFingerprint,
    ...ticket.contractSelectionKey === void 0 ? {} : { contractSelectionKey: ticket.contractSelectionKey },
    variantId: ticket.variantId,
    target: ticket.target,
    ...ticket.operation === void 0 ? {} : { operation: ticket.operation }
  });
}
var PERMISSION_DEGRADED_DIAGNOSTIC = "x3.host/permission-degraded";
function permissionDegradedDiagnostic(contributionId2, degraded) {
  return diagnostic(
    "information",
    PERMISSION_DEGRADED_DIAGNOSTIC,
    `\xAB${contributionId2}\xBB runs without ${degraded.join(", ")}: the grant does not cover these classes, so the operations that need them are disabled (ADR-HOST-002 \xA72)`,
    [contributionId2],
    { degraded }
  );
}
function operationScopedClasses(manifest) {
  const spec = manifest.spec;
  return operationScopedPermissionClasses(spec?.operations);
}
var PROBE_OPERATION = "probe";
var PROBE_PERMISSION_CLASSES = Object.freeze(["read-source"]);
function deny(code, message, context) {
  return new ModkitError({
    code,
    message,
    ...context === void 0 ? {} : { context }
  });
}
function targetSatisfies(variant, target) {
  const c2 = variant.target;
  const problems = [];
  const has = (list, value, anyAllowed = false) => list === void 0 || anyAllowed && list.includes("any") || list.includes(value);
  if (!has(c2.environments, target.environment)) problems.push(`environment ${target.environment}`);
  if (!has(c2.operatingSystems, target.operatingSystem, true)) {
    problems.push(`operatingSystem ${target.operatingSystem}`);
  }
  if (!has(c2.architectures, target.architecture, true)) {
    problems.push(`architecture ${target.architecture}`);
  }
  for (const cap2 of c2.requiredHostCapabilities ?? []) {
    if (!(target.hostCapabilities ?? []).includes(cap2)) problems.push(`hostCapability ${cap2}`);
  }
  for (const api of c2.requiredWebApis ?? []) {
    if (!(target.webApis ?? []).includes(api)) problems.push(`webApi ${api}`);
  }
  for (const tool of c2.externalTools ?? []) {
    if (!(target.externalTools ?? []).includes(tool)) problems.push(`externalTool ${tool}`);
  }
  return problems;
}
async function activateContribution(request) {
  throwIfAborted(request.signal);
  const { ticket } = request;
  const ticketBinding = ticketBindings.get(ticket);
  if (!issuedTickets.has(ticket) || ticketBinding === void 0 || ticketBinding.ticketFingerprint !== ticketFingerprint(ticket)) {
    throw deny(
      "x3.host/invalid-ticket",
      "activation requires a ticket issued by this host from a real resolution"
    );
  }
  const privateRecord = inventoryRecordFor(ticketBinding.contribution);
  const manifest = ticketBinding.contribution.manifest;
  if (privateRecord === void 0 || manifest === void 0) {
    throw deny("x3.host/inventory-record-unavailable", "the ticket inventory record is unavailable");
  }
  const mismatches = [];
  if (ticket.inventoryRecordId !== privateRecord.publicRecord.inventoryRecordId)
    mismatches.push("inventory record");
  if (ticket.manifestDigest !== privateRecord.publicRecord.manifestDigest)
    mismatches.push("manifest digest");
  if (ticket.artifactDigest !== privateRecord.publicRecord.artifactDigest)
    mismatches.push("artifact digest");
  if (ticket.artifactRoot.href !== privateRecord.publicRecord.artifactRoot)
    mismatches.push("artifact root");
  if (ticket.contributionId !== manifest.id) mismatches.push("contribution");
  if (ticket.contributionContract.id !== manifest.contract.id) mismatches.push("contract");
  if (ticket.contributionContract.major !== manifest.contract.major)
    mismatches.push("contract major");
  if (mismatches.length > 0) {
    throw deny(
      "x3.host/ticket-manifest-mismatch",
      `the ticket does not describe this contribution (${mismatches.join(", ")})`,
      { mismatches, ticketContribution: ticket.contributionId, manifestId: manifest.id }
    );
  }
  if (!await privateRecord.verifyArtifactDigest(ticket.artifactDigest)) {
    throw deny(
      "x3.host/artifact-digest-mismatch",
      "the selected artifact changed after inventory and will not be imported",
      { inventoryRecordId: ticket.inventoryRecordId }
    );
  }
  const variant = (manifest.runtimeVariants ?? []).find((v) => v.variantId === ticket.variantId);
  if (!variant) {
    throw deny(
      "x3.host/unknown-variant",
      `contribution \xAB${manifest.id}\xBB has no runtime variant \xAB${ticket.variantId}\xBB`
    );
  }
  const targetProblems = targetSatisfies(variant, ticket.target);
  if (targetProblems.length > 0) {
    throw deny(
      "x3.host/target-incompatible",
      `variant \xAB${variant.variantId}\xBB does not support this target: ${targetProblems.join(", ")}`,
      { problems: targetProblems }
    );
  }
  const executionBackends = request.executionBackends ?? DEFAULT_EXECUTION_BACKENDS;
  if (!executionBackends.supports(variant.executionProfile, ticket.target, variant)) {
    throw deny(
      "x3.host/execution-backend-unavailable",
      `profile \xAB${variant.executionProfile}\xBB has no backend for ${ticket.target.environment} \u2014 refusing rather than running under a weaker boundary (24 \xA76.1 rule 1)`,
      { profile: variant.executionProfile, environment: ticket.target.environment }
    );
  }
  if (variant.executionProfile === "trusted-in-process" && privateRecord.execution.allowTrustedInProcess !== true) {
    throw deny(
      "x3.host/trusted-in-process-not-authorized",
      `extension \xAB${ticket.extensionId}\xBB came from ${privateRecord.execution.origin} inventory without an explicit host decision allowing full process authority`,
      { extensionId: ticket.extensionId, origin: privateRecord.execution.origin }
    );
  }
  const validity = grantValidity(request.grant);
  if (validity.state !== "valid") {
    throw deny(
      "x3.host/grant-not-live",
      validity.state === "malformed" ? `grant \xAB${request.grant.id}\xBB has an unparseable expiresAt (\xAB${validity.value}\xBB) \u2014 treated as expired` : `grant \xAB${request.grant.id}\xBB expired at ${validity.at}`,
      { grant: request.grant.id, validity: validity.state }
    );
  }
  const probeScoped = ticket.operation === PROBE_OPERATION;
  const requestedClasses = probeScoped ? variant.requestedPermissionClasses.filter(
    (item) => PROBE_PERMISSION_CLASSES.includes(item)
  ) : variant.requestedPermissionClasses;
  const callerProbeCeiling = request.policy?.operationClasses?.[PROBE_OPERATION];
  const policy = probeScoped ? {
    ...request.policy,
    operationClasses: {
      ...request.policy?.operationClasses,
      [PROBE_OPERATION]: callerProbeCeiling === void 0 ? PROBE_PERMISSION_CLASSES : callerProbeCeiling.filter(
        (item) => PROBE_PERMISSION_CLASSES.includes(item)
      )
    }
  } : request.policy;
  const { child, missing } = narrowGrant(request.grant, {
    requestedClasses,
    childId: `${request.grant.id}/${manifest.id}#${variant.variantId}${probeScoped ? "#probe" : ""}`,
    ...ticket.operation === void 0 ? {} : { operation: ticket.operation },
    ...policy === void 0 ? {} : { policy }
  });
  const operationScoped = operationScopedClasses(manifest);
  const hardMissing = missing.filter((item) => !operationScoped.has(item));
  if (hardMissing.length > 0) {
    throw deny(
      "x3.host/permission-denied",
      `grant \xAB${request.grant.id}\xBB does not cover: ${hardMissing.join(", ")}`,
      { missing: hardMissing }
    );
  }
  const degraded = missing.filter((item) => operationScoped.has(item));
  const entryUrl = resolveContainedEntrypoint(privateRecord.artifactRoot, variant.entrypoint);
  throwIfAborted(request.signal);
  const backendLease = await activateExecutionBackend(executionBackends, {
    ticket,
    entrypoint: entryUrl,
    artifactRoot: privateRecord.artifactRoot,
    ...privateRecord.fileDigests === void 0 ? {} : { fileDigests: privateRecord.fileDigests },
    variant,
    target: ticket.target,
    grant: child,
    ...request.signal === void 0 ? {} : { signal: request.signal }
  });
  const diagnostics = [];
  if (degraded.length > 0) diagnostics.push(permissionDegradedDiagnostic(manifest.id, degraded));
  if (variant.executionProfile === "worker-brokered") {
    diagnostics.push(
      diagnostic(
        "information",
        "x3.host/worker-shared-process",
        `\xAB${manifest.id}\xBB runs worker-brokered: a crash, hang or protocol violation of this code is isolated from the host, but the worker shares the process \u2014 it is not a security sandbox (24 \xA76.1 SB-1).`,
        [manifest.id],
        { grant: child.id, classes: child.classes }
      )
    );
  }
  if (variant.executionProfile === "trusted-in-process") {
    diagnostics.push(
      diagnostic(
        "warning",
        "x3.host/full-process-authority",
        `\xAB${manifest.id}\xBB runs as trusted-in-process: the host checks grants at dispatch and brokers what it owns, but it cannot technically prevent this code from reaching Node.js filesystem/network built-ins or the process itself. This is an audit/policy boundary, not a sandbox (24 \xA75.1).`,
        [manifest.id],
        { grant: child.id, classes: child.classes }
      )
    );
  }
  return {
    module: backendLease.module,
    variant,
    effectiveGrant: child,
    diagnostics,
    release: backendLease.release
  };
}
function serviceTargetFor(executionBackends, offer, target) {
  const inProcess = executionBackends.inProcessTarget;
  if (inProcess === void 0) return target;
  const contribution = inventoryBindingForOffer(offer)?.contribution;
  const variant = contribution?.manifest?.runtimeVariants?.find(
    (item) => item.variantId === offer.runtimeVariant
  );
  if (contribution === void 0 || variant?.executionProfile !== "trusted-in-process" || inventoryRecordFor(contribution)?.execution.allowTrustedInProcess !== true) {
    return target;
  }
  return Object.freeze({
    ...inProcess,
    ...target.grantedPermissions === void 0 ? {} : { grantedPermissions: target.grantedPermissions }
  });
}
async function activateServiceProvider(options) {
  const ticket = issueActivationTicket(
    options.result,
    serviceTargetFor(options.executionBackends, options.result.selected.offer, options.target)
  );
  const activation = await activateContribution({
    ticket,
    grant: options.grant,
    executionBackends: options.executionBackends,
    ...options.policy === void 0 ? {} : { policy: options.policy },
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  options.diagnostics?.push(...activation.diagnostics);
  const providerId = options.result.selected.offer.providerId;
  const fail2 = async (code, message) => {
    await activation.release();
    throw new ModkitError({ code, message });
  };
  if (activation.module["abiVersion"] !== 1 || typeof activation.module["createProvider"] !== "function") {
    return fail2(
      "x3.host/invalid-service-provider-module",
      `provider ${providerId} does not implement ServiceProviderModule ABI v1`
    );
  }
  const createProvider = activation.module["createProvider"];
  let lease;
  try {
    const baseContext = options.contextFor(activation.effectiveGrant);
    const context = Object.freeze({
      ...baseContext,
      providerIdentity: Object.freeze({
        providerId,
        providerVersion: options.result.selected.offer.extensionVersion,
        artifactDigest: ticket.artifactDigest
      })
    });
    lease = await createProvider(options.selection, context);
  } catch (error) {
    await activation.release();
    throw error;
  }
  if (typeof lease !== "object" || lease === null || !("value" in lease) || typeof lease.release !== "function") {
    return fail2(
      "x3.host/invalid-service-provider-lease",
      `provider ${providerId} returned an invalid lease`
    );
  }
  let released = false;
  return Object.freeze({
    lease,
    effectiveGrant: activation.effectiveGrant,
    executionProfile: activation.variant.executionProfile,
    attestation: Object.freeze({
      manifestDigest: ticket.manifestDigest,
      artifactDigest: ticket.artifactDigest,
      offerFingerprint: ticket.offerFingerprint
    }),
    async release() {
      if (released) return;
      released = true;
      try {
        await lease.release();
      } finally {
        await activation.release();
      }
    }
  });
}
function createHostServiceResolver(options) {
  const offers = options.offers ?? offersFromInventory(options.inventory);
  const target = Object.freeze({
    ...options.target,
    grantedPermissions: [
      .../* @__PURE__ */ new Set([...options.target.grantedPermissions ?? [], ...options.grant.classes])
    ].sort()
  });
  const activations = [];
  const locks = [];
  const diagnostics = [];
  const activationFacts = [];
  const makePort = (grant, chain) => createContractResolverPort({
    offers,
    definitions: options.definitions,
    target,
    targetFor: (offer) => serviceTargetFor(options.executionBackends, offer, target),
    onResolved(request, result) {
      locks.push(buildLockEntry(request, result));
    },
    async activate(selection, result, signal) {
      const key2 = `${selection.contract}@${selection.major}:${result.selected.offer.providerId}:${selection.offerId}`;
      if (chain.includes(key2)) {
        throw new ModkitError({
          code: "x3.host/service-dependency-cycle",
          message: `service activation cycle detected at ${key2}`
        });
      }
      const activation = await activateServiceProvider({
        selection,
        result,
        target,
        grant,
        executionBackends: options.executionBackends,
        ...options.policy === void 0 ? {} : { policy: options.policy },
        ...signal === void 0 ? {} : { signal },
        diagnostics,
        contextFor: (effectiveGrant) => {
          const settings = options.contributionSettings?.(result.selected.offer.providerId);
          return Object.freeze({
            contracts: makePort(effectiveGrant, [...chain, key2]),
            budgets: options.budgets,
            ...chain.length !== 0 || options.logicalResourcesFor === void 0 ? {} : { logicalResources: options.logicalResourcesFor(effectiveGrant) },
            ...chain.length !== 0 || options.installationProbes === void 0 ? {} : { installationProbes: options.installationProbes },
            diagnostics: {
              report(item) {
                diagnostics.push(item);
              }
            },
            ...settings === void 0 ? {} : { settings },
            ...options.signal === void 0 ? {} : { signal: options.signal }
          });
        }
      });
      activations.push(activation);
      activationFacts.push(
        Object.freeze({
          providerId: result.selected.offer.providerId,
          contract: selection.contract,
          major: selection.major,
          offerId: selection.offerId,
          runtimeVariant: result.selected.offer.runtimeVariant,
          executionProfile: activation.executionProfile,
          manifestDigest: activation.attestation.manifestDigest,
          artifactDigest: activation.attestation.artifactDigest,
          offerFingerprint: activation.attestation.offerFingerprint,
          effectiveGrant: activation.effectiveGrant
        })
      );
      return Object.freeze({ value: activation.lease.value, release: () => activation.release() });
    }
  });
  const port = makePort(options.grant, []);
  return Object.freeze({
    port,
    locks,
    diagnostics,
    get activationFacts() {
      return Object.freeze([...activationFacts]);
    },
    async release() {
      let firstError;
      for (const activation of activations.splice(0).reverse()) {
        try {
          await activation.release();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== void 0) throw firstError;
    }
  });
}
var EVIDENCE_KINDS = Object.freeze([
  "magic",
  "structure",
  "companion",
  "context",
  "extension",
  "user-override"
]);
function fail(code, message) {
  throw new ModkitError({ code, message });
}
function exactObject(value, required, optional, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("x3.host/invalid-detection-selection", `${label} must be an object`);
  }
  const record = value;
  const allowed2 = /* @__PURE__ */ new Set([...required, ...optional]);
  if (required.some((key2) => !(key2 in record)) || Object.keys(record).some((key2) => !allowed2.has(key2))) {
    return fail("x3.host/invalid-detection-selection", `${label} has missing or unknown fields`);
  }
  return record;
}
function nonBlank(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail("x3.host/invalid-detection-selection", `${label} must be a non-blank string`);
  }
  return value;
}
function evidence(value, label) {
  if (!Array.isArray(value)) {
    return fail("x3.host/invalid-detection-selection", `${label} must be an array`);
  }
  return Object.freeze(
    value.map((raw, index) => {
      const item = exactObject(raw, ["kind", "weight"], ["note"], `${label}[${index}]`);
      if (!EVIDENCE_KINDS.includes(item["kind"])) {
        return fail("x3.host/invalid-detection-selection", `${label}[${index}].kind is invalid`);
      }
      if (typeof item["weight"] !== "number" || !Number.isFinite(item["weight"])) {
        return fail(
          "x3.host/invalid-detection-selection",
          `${label}[${index}].weight must be finite`
        );
      }
      if (item["note"] !== void 0 && typeof item["note"] !== "string") {
        return fail(
          "x3.host/invalid-detection-selection",
          `${label}[${index}].note must be a string`
        );
      }
      return Object.freeze({
        kind: item["kind"],
        weight: item["weight"],
        ...item["note"] === void 0 ? {} : { note: item["note"] }
      });
    })
  );
}
function normalize(value) {
  const root = exactObject(value, ["schemaVersion", "sourceRevision", "selected"], [], "selection");
  if (root["schemaVersion"] !== 1) {
    return fail("x3.host/invalid-detection-selection", "selection schemaVersion is unsupported");
  }
  const sourceRevision = revisionId(nonBlank(root["sourceRevision"], "selection.sourceRevision"));
  const selected = exactObject(
    root["selected"],
    [
      "extensionId",
      "contributionId",
      "variantId",
      "offerId",
      "artifactDigest",
      "manifestDigest",
      "sourceTopology",
      "confidence",
      "evidence"
    ],
    [],
    "selection.selected"
  );
  const extensionId = nonBlank(selected["extensionId"], "selection.selected.extensionId");
  const contributionText = nonBlank(selected["contributionId"], "selection.selected.contributionId");
  if (!isQualifiedId(extensionId) || !isQualifiedId(contributionText)) {
    return fail(
      "x3.host/invalid-detection-selection",
      "selection extension and contribution coordinates must be qualified"
    );
  }
  const topology = selected["sourceTopology"];
  if (!["single", "bundle", "namespace", "derived"].includes(String(topology))) {
    return fail("x3.host/invalid-detection-selection", "selection sourceTopology is invalid");
  }
  const confidence = selected["confidence"];
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return fail("x3.host/invalid-detection-selection", "selection confidence is invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    sourceRevision,
    selected: Object.freeze({
      extensionId,
      contributionId: contributionId(contributionText),
      variantId: nonBlank(selected["variantId"], "selection.selected.variantId"),
      offerId: nonBlank(selected["offerId"], "selection.selected.offerId"),
      artifactDigest: nonBlank(selected["artifactDigest"], "selection.selected.artifactDigest"),
      manifestDigest: nonBlank(selected["manifestDigest"], "selection.selected.manifestDigest"),
      sourceTopology: topology,
      confidence,
      evidence: evidence(selected["evidence"], "selection.selected.evidence")
    })
  });
}
function buildCodecDetectionSelection(input) {
  if (input.detection.codecId !== input.contributionId) {
    return fail(
      "x3.host/detection-selection-mismatch",
      "detection codecId does not match the selected contribution"
    );
  }
  return normalize({
    schemaVersion: 1,
    sourceRevision: input.sourceRevision,
    selected: {
      extensionId: input.extensionId,
      contributionId: input.contributionId,
      variantId: input.variantId,
      offerId: input.offerId,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      sourceTopology: input.sourceTopology,
      confidence: input.detection.confidence,
      evidence: input.detection.evidence
    }
  });
}
function serializeCodecDetectionSelection(selection) {
  return canonicalJsonStringify(normalize(selection));
}
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
var ABI_RASTER_RESOURCES = { contract: "x3.abi/raster-resources", major: 1 };
var ABI_MODEL_RESOURCES = { contract: "x3.abi/model-resources", major: 1 };
var ABI_INSTALLATION_PROBES = { contract: "x3.abi/installation-probes", major: 1 };
var ABI_VIDEO_FRAMES = { contract: "x3.abi/video-frames", major: 1 };
var ABI_INSTALLATION_FILES = { contract: "x3.abi/installation-files", major: 1 };
var ABI_SUBJECT_CATALOG = { contract: "x3.abi/subject-catalog", major: 1 };
var ABI_CREDENTIALS = { contract: "x3.abi/credentials", major: 1 };
var ABI_MODEL_RESOURCE_ASSET = {
  contract: "x3.abi/model-resource-asset",
  major: 1
};
var ABI_LOGICAL_RESOURCES = { contract: "x3.abi/logical-resources", major: 1 };
var ABI_LOGICAL_RESOURCE_RESOLUTION = {
  contract: "x3.abi/logical-resource-resolution",
  major: 1
};
var sig = { signal: "last" };
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
    probe: { kind: "value", ...sig },
    planInput: { kind: "value", optional: true, ...sig },
    open: { kind: "lease", result: ABI_ASSET_SESSION, wrapper: "bare", ...sig }
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
    events: { kind: "events", ...sig },
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
    read: { kind: "value", optional: true, ...sig },
    stream: { kind: "iterable", optional: true, ...sig },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE,
      wrapper: "lease",
      optional: true,
      ...sig
    }
  }
};
var assetNamespaceSurface = {
  ...ABI_ASSET_NAMESPACE,
  methods: {
    list: { kind: "iterable", batchItems: 512, ...sig },
    readPreamble: { kind: "value", optional: true, ...sig },
    open: { kind: "lease", result: ABI_ARTIFACT_SOURCE, wrapper: "lease", ...sig }
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
      ...sig
    },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE,
      wrapper: "lease",
      optional: true,
      ...sig
    },
    // derived inputs: open one input subject as a session, or the optional materialized artifact
    openSubject: {
      kind: "lease",
      result: ABI_ASSET_SESSION,
      wrapper: "lease",
      optional: true,
      ...sig
    },
    openMaterialized: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE,
      wrapper: "lease",
      optional: true,
      ...sig
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
var rasterResourcesSurface = {
  ...ABI_RASTER_RESOURCES,
  methods: { read: { kind: "value", ...sig } }
};
var installationProbesSurface = {
  ...ABI_INSTALLATION_PROBES,
  methods: {
    registryValues: { kind: "value", ...sig },
    steamAppDir: { kind: "value", ...sig },
    epicInstallLocation: { kind: "value", ...sig },
    gogInstallPath: { kind: "value", ...sig },
    storePackageLocation: { kind: "value", ...sig },
    knownFolder: { kind: "value", ...sig }
  }
};
var videoFramesSurface = {
  ...ABI_VIDEO_FRAMES,
  methods: { decodeFrame: { kind: "value", signal: { arg: 0, key: "signal" } } }
};
var installationFilesSurface = {
  ...ABI_INSTALLATION_FILES,
  methods: {
    size: { kind: "value", signal: { arg: 0, key: "signal" } },
    read: { kind: "value", signal: { arg: 0, key: "signal" } }
  }
};
var subjectCatalogSurface = {
  ...ABI_SUBJECT_CATALOG,
  methods: {
    entities: { kind: "value", arity: 2, ...sig },
    strings: { kind: "value", arity: 3, optional: true, ...sig }
  }
};
var credentialsSurface = {
  ...ABI_CREDENTIALS,
  methods: {
    status: { kind: "value", arity: 2, ...sig },
    acquire: { kind: "value", arity: 2, ...sig },
    fetch: { kind: "value", arity: 2, ...sig },
    secret: { kind: "value", arity: 2, ...sig },
    remember: { kind: "value", arity: 3, ...sig },
    forget: { kind: "value", arity: 2, ...sig }
  }
};
var modelAcquire = {
  kind: "lease",
  result: ABI_MODEL_RESOURCE_ASSET,
  wrapper: "lease",
  ...sig
};
var modelResourcesSurface = {
  ...ABI_MODEL_RESOURCES,
  methods: { acquire: modelAcquire }
};
var modelResourceAssetSurface = {
  ...ABI_MODEL_RESOURCE_ASSET,
  fields: ["result"],
  methods: {
    acquire: modelAcquire,
    readRaster: { kind: "value", ...sig },
    sceneInfo: { kind: "value", optional: true, ...sig },
    nodes: { kind: "value", optional: true, ...sig },
    meshes: { kind: "value", optional: true, ...sig },
    primitive: { kind: "value", optional: true, ...sig },
    skeletonBindings: { kind: "value", optional: true, ...sig },
    animationClips: { kind: "value", optional: true, ...sig },
    materials: { kind: "value", optional: true, ...sig },
    resourceReferences: { kind: "value", optional: true, ...sig },
    sockets: { kind: "value", optional: true, ...sig }
  }
};
var logicalResourcesSurface = {
  ...ABI_LOGICAL_RESOURCES,
  methods: {
    discover: { kind: "value", ...sig },
    readBatch: { kind: "value", ...sig },
    resolve: { kind: "lease", result: ABI_LOGICAL_RESOURCE_RESOLUTION, wrapper: "lease", ...sig },
    provenance: { kind: "value", ...sig },
    identity: { kind: "value", ...sig }
  }
};
var logicalResourceResolutionSurface = {
  ...ABI_LOGICAL_RESOURCE_RESOLUTION,
  fields: ["result"],
  methods: { openSource: { kind: "lease", result: ABI_ARTIFACT_SOURCE, wrapper: "lease", ...sig } }
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
  contractResolverSurface,
  rasterResourcesSurface,
  installationProbesSurface,
  videoFramesSurface,
  installationFilesSurface,
  subjectCatalogSurface,
  credentialsSurface,
  modelResourcesSurface,
  modelResourceAssetSurface,
  logicalResourcesSurface,
  logicalResourceResolutionSurface
]);
var codecReleases = /* @__PURE__ */ new WeakMap();
async function releaseCodec(codec) {
  const release = codecReleases.get(codec);
  codecReleases.delete(codec);
  await release?.();
}
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
        Reflect.ownKeys(value).map((key2) => [
          key2,
          snapshotStructured(value[key2])
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
        value: output.value.slice(),
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
        const failure2 = results.find((result) => result.status === "rejected");
        if (failure2?.status === "rejected") throw failure2.reason;
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
      const validity = grantValidity2(options.permissionGrant);
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
function resourceIdParameters(logicalId) {
  const none = Object.freeze({ name: logicalId, parameters: Object.freeze({}) });
  const hash = logicalId.lastIndexOf("#");
  if (hash < 0) return none;
  const parameters = {};
  for (const part of logicalId.slice(hash + 1).split("&")) {
    const equals = part.indexOf("=");
    const key2 = part.slice(0, Math.max(equals, 0));
    if (equals <= 0 || !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(key2) || Object.hasOwn(parameters, key2))
      return none;
    try {
      parameters[key2] = decodeURIComponent(part.slice(equals + 1));
    } catch {
      return none;
    }
  }
  return Object.freeze({ name: logicalId.slice(0, hash), parameters: Object.freeze(parameters) });
}
var coordinates = ["frame", "mipLevel", "layer", "face", "slice"];
function captureRasterSelection(value) {
  if (value === void 0) return Object.freeze({});
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key2) => !coordinates.some((coordinate) => coordinate === key2)))
    throw new TypeError("invalid raster subresource selection");
  const owned = {};
  for (const key2 of coordinates) {
    const item = value[key2];
    if (item === void 0) continue;
    if (key2 === "face" && item === "all") {
      owned[key2] = item;
      continue;
    }
    if (key2 === "mipLevel" && item === "fit") {
      owned[key2] = item;
      continue;
    }
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0)
      throw new TypeError(`raster ${key2} must be a nonnegative safe integer`);
    owned[key2] = item;
  }
  return Object.freeze(owned);
}
function captureCompressedFormats(value) {
  if (value === void 0) return /* @__PURE__ */ new Set();
  if (!Array.isArray(value) || value.length > 64 || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 64))
    throw new TypeError("invalid compressed texture formats");
  return new Set(value);
}
function blockBytes(compression) {
  if (compression === "bc1" || compression === "bc4") return 8;
  if (compression === "bc2" || compression === "bc3" || compression === "bc5") return 16;
  if (compression === "bc6h" || compression === "bc7") return 16;
  return void 0;
}
function compressedSelectionPlan(info, selection, maxBytes) {
  const block = blockBytes(info.compression);
  if (block === void 0 || selection.face === "all" || info.depth !== 1) return void 0;
  const stored = info.storedMipLevels ?? info.mipLevels;
  const chain = (level) => {
    let bytes2 = 0;
    for (let index = level; index < stored; index++)
      bytes2 += Math.ceil(Math.max(1, Math.floor(info.width / 2 ** index)) / 4) * Math.ceil(Math.max(1, Math.floor(info.height / 2 ** index)) / 4) * block;
    return bytes2;
  };
  const selected = selection.mipLevel ?? 0;
  const mipLevel = selected === "fit" ? Array.from({ length: stored }, (_, index) => index).find((level) => chain(level) <= maxBytes) : selected;
  if (mipLevel === void 0 || mipLevel >= stored) return void 0;
  const bytes = chain(mipLevel);
  return bytes <= maxBytes ? Object.freeze({ mipLevel, bytes }) : void 0;
}
function rasterSelectionPlan(info, selection, maxBytes) {
  for (const key2 of ["width", "height", "depth", "layers", "faces", "mipLevels", "frames"])
    if (!Number.isSafeInteger(info[key2]) || info[key2] <= 0)
      throw new TypeError(`invalid raster ${key2}`);
  const face = selection.face ?? 0;
  if (face !== "all" && face >= info.faces) throw new RangeError("raster face is out of range");
  const count = face === "all" ? info.faces : 1;
  const selectedMipLevel = selection.mipLevel ?? 0;
  const mipLevel = selectedMipLevel === "fit" ? Array.from({ length: info.mipLevels }, (_, index) => index).find((level) => {
    const width2 = Math.max(1, Math.floor(info.width / 2 ** level));
    const height2 = Math.max(1, Math.floor(info.height / 2 ** level));
    const bytes2 = width2 * height2 * 4 * count;
    return Number.isSafeInteger(bytes2) && bytes2 <= maxBytes;
  }) : selectedMipLevel;
  if (mipLevel === void 0)
    throw new ModkitError({
      code: "x3.host/resource-budget-exceeded",
      message: "no raster mip fits the decoded byte budget"
    });
  if (mipLevel >= info.mipLevels) throw new RangeError("raster mip level is out of range");
  const width = Math.max(1, Math.floor(info.width / 2 ** mipLevel));
  const height = Math.max(1, Math.floor(info.height / 2 ** mipLevel));
  const depth = Math.max(1, Math.floor(info.depth / 2 ** mipLevel));
  const base = {
    frame: selection.frame ?? 0,
    mipLevel,
    layer: selection.layer ?? 0,
    slice: selection.slice ?? 0
  };
  if (base.frame >= info.frames || base.layer >= info.layers || base.slice >= depth)
    throw new RangeError("raster frame, layer or slice is out of range");
  const bytes = width * height * 4 * count;
  if (!Number.isSafeInteger(bytes) || bytes > maxBytes)
    throw new ModkitError({
      code: "x3.host/resource-budget-exceeded",
      message: "selected raster surfaces exceed the decoded byte budget"
    });
  const subresources = Object.freeze(
    Array.from(
      { length: count },
      (_, index) => Object.freeze({ ...base, face: face === "all" ? index : face })
    )
  );
  return { width, height, subresources };
}
function rasterSpellings(logicalId, rule) {
  const spellings = [logicalId];
  if (rule === void 0) return spellings;
  const name = logicalId.replaceAll("\\", "/").split("/").at(-1) ?? logicalId;
  const stem = name.replace(/\.[^.]*$/u, "");
  const names = [
    name,
    ...(rule.extensions ?? []).map((extension) => `${stem}${extension}`).filter((other) => other.toLowerCase() !== name.toLowerCase())
  ];
  for (const candidate of names)
    for (const directory of rule.directories) {
      const spelling = directory === "" ? candidate : `${directory}/${candidate}`;
      if (!spellings.includes(spelling)) spellings.push(spelling);
    }
  return spellings;
}
function ownedCompressedTexture(texture, info, plan, maxBytes) {
  const levels = texture?.subresources;
  const block = texture?.block;
  if (!Array.isArray(levels) || levels.length === 0 || typeof texture.format !== "string" || block === null || typeof block !== "object" || block.width !== 4 || block.height !== 4 || block.depth !== 1 || block.bytes !== 8 && block.bytes !== 16)
    return void 0;
  let total = 0;
  const owned = [];
  for (const [index, level] of levels.entries()) {
    const width = Math.max(1, Math.floor(info.width / 2 ** (plan.mipLevel + index)));
    const height = Math.max(1, Math.floor(info.height / 2 ** (plan.mipLevel + index)));
    const bytes = Math.ceil(width / 4) * Math.ceil(height / 4) * block.bytes;
    if (level === null || typeof level !== "object" || level.mipLevel !== index || level.layer !== 0 || level.face !== 0 || level.width !== width || level.height !== height || !(level.data instanceof Uint8Array) || level.data.byteLength !== bytes)
      return void 0;
    total += bytes;
    if (total > maxBytes) return void 0;
    owned.push(
      Object.freeze({
        mipLevel: index,
        layer: 0,
        face: 0,
        depthSlice: 0,
        width,
        height,
        depth: 1,
        data: level.data.slice()
      })
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    format: texture.format,
    dimensions: Object.freeze({ width: owned[0].width, height: owned[0].height, depth: 1 }),
    mipLevelCount: owned.length,
    layerCount: 1,
    faceCount: 1,
    colorSpace: texture.colorSpace,
    alphaMode: texture.alphaMode,
    block: Object.freeze({ width: 4, height: 4, depth: 1, bytes: block.bytes }),
    subresources: Object.freeze(owned),
    source: Object.freeze({ ...texture.source })
  });
}
function rasterIdParameters(logicalId) {
  const { name, parameters } = resourceIdParameters(logicalId);
  const keys = Object.keys(parameters);
  if (keys.length === 0 || keys.some((key2) => key2 !== "region" && key2 !== "frame" && key2 !== "plane"))
    return { name: logicalId };
  const { region, frame, plane } = parameters;
  if (plane !== void 0 && plane !== "indices")
    throw new TypeError("raster id plane must be indices");
  if (region !== void 0 && region.length === 0)
    throw new TypeError("raster id region must name an area");
  if (frame !== void 0 && !(/^(?:0|[1-9][0-9]*)$/u.test(frame) && Number.isSafeInteger(Number(frame))))
    throw new TypeError("raster id frame must be a nonnegative integer");
  return {
    name,
    ...region === void 0 ? {} : { region },
    ...frame === void 0 ? {} : { frame: Number(frame) },
    ...plane === void 0 ? {} : { plane: "indices" }
  };
}
function indexPlaneRgba(region, width, height) {
  if (region.width !== width || region.height !== height || region.pixelFormat !== "gray8" || !Number.isSafeInteger(region.rowStride) || region.rowStride < width || !(region.pixels instanceof Uint8Array) || region.rowStride * (height - 1) + width > region.pixels.length)
    return void 0;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const index = region.pixels[y * region.rowStride + x];
      rgba.set([index, index, index, 255], (y * width + x) * 4);
    }
  return Object.freeze({ width, height, rowStride: width * 4, pixelFormat: "rgba8", pixels: rgba });
}
function createSubjectRasterResources(options) {
  const refusal = (code, message, provenance) => ({
    state: "unresolved",
    diagnostics: [diagnostic("warning", code, message)],
    ...provenance === void 0 ? {} : { provenance }
  });
  return Object.freeze({
    async read(request, signal) {
      signal?.throwIfAborted();
      if (!options.state.live)
        return refusal(
          "x3.host/raster-context-unavailable",
          "Raster resources require a live opened subject."
        );
      if (!options.isAuthorized())
        return refusal(
          "x3.host/resource-permission-missing",
          "The subject grant does not permit raster resource reads."
        );
      if (request === null || typeof request !== "object")
        return refusal("x3.host/raster-request-invalid", "A raster resource request is required.");
      const requestedBytes = request.maxBytes;
      let selection;
      let compressedFormats;
      const explicitSelection = request.selection !== void 0;
      try {
        selection = captureRasterSelection(request.selection);
        compressedFormats = captureCompressedFormats(request.compressedFormats);
      } catch (error) {
        return refusal(
          "x3.host/raster-request-invalid",
          error instanceof Error ? error.message : "Invalid raster selection"
        );
      }
      const available = options.budget.maxScalarBytes - options.state.reservedBytes;
      const maxBytes = selection.mipLevel === "fit" && Number.isSafeInteger(requestedBytes) && requestedBytes > available ? available : requestedBytes;
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || options.state.reservedBytes + maxBytes > options.budget.maxScalarBytes)
        return refusal(
          "x3.host/resource-budget-exceeded",
          "Raster reads exceed the subject decoded byte budget."
        );
      options.state.reservedBytes += maxBytes;
      const releases = [];
      let provenance;
      let atlasRegion;
      let frameOnly;
      let indices = false;
      try {
        let source;
        let hint = {};
        if (request.kind === "logical") {
          const resources = options.state.resources;
          if (resources === void 0)
            return refusal(
              "x3.host/raster-origin-unavailable",
              "The subject has no resource origin."
            );
          const rule = options.companionRule?.(request.requirement.role);
          let parameters;
          try {
            parameters = rasterIdParameters(request.requirement.logicalId);
          } catch (error) {
            return refusal(
              "x3.host/raster-request-invalid",
              error instanceof Error ? error.message : "Invalid raster id parameters."
            );
          }
          atlasRegion = parameters.region;
          frameOnly = parameters.frame;
          indices = parameters.plane === "indices";
          if (indices) selection = { ...selection, mipLevel: 0 };
          if (frameOnly !== void 0 && (selection.frame ?? 0) !== 0)
            return refusal(
              "x3.host/raster-selection-invalid",
              "The resource names one frame of its image: it has no other frame to select."
            );
          const asked = parameters.name === request.requirement.logicalId ? request.requirement : { ...request.requirement, logicalId: parameters.name };
          const requirement = rule === void 0 ? asked : { ...asked, scopes: rule.scopes };
          const spellings = rasterSpellings(requirement.logicalId, rule);
          let resolution = await resources.resolve(requirement, signal);
          for (const spelling of spellings.slice(1)) {
            if (resolution.state === "resolved") break;
            signal?.throwIfAborted();
            resolution = await resources.resolve({ ...requirement, logicalId: spelling }, signal);
          }
          provenance = resolution.provenance;
          if (resolution.state === "unresolved")
            return { state: "unresolved", diagnostics: [resolution.diagnostic], provenance };
          releases.push(() => resolution.lease.release());
          if (resolution.lease.value.kind !== "bytes")
            return refusal(
              "x3.host/raster-source-unsupported",
              "The resource is not a byte source.",
              provenance
            );
          source = resolution.lease.value;
          hint = { path: provenance.logicalId };
        } else if (request.kind === "embedded") {
          if (!(request.bytes instanceof Uint8Array) || BigInt(request.bytes.length) > options.budget.maxInputBytes)
            return refusal(
              "x3.host/resource-budget-exceeded",
              "Embedded raster bytes exceed the subject input budget."
            );
          if (request.mediaType !== void 0 && (typeof request.mediaType !== "string" || request.mediaType.length > 256))
            return refusal("x3.host/raster-request-invalid", "Invalid embedded raster media type.");
          const id = `modkit-inline://raster/${globalThis.crypto.randomUUID()}`;
          const owned = createMemorySource(id, request.bytes.slice());
          hint = request.mediaType === void 0 ? {} : { mediaType: request.mediaType };
          releases.push(() => owned.dispose());
          source = await artifactByteSourceFromRandomAccess(owned, {
            ref: { id, uri: id },
            revision: revisionId(`provider-token:${encodeURIComponent(id)}`),
            ...signal === void 0 ? {} : { signal }
          });
        } else return refusal("x3.host/raster-request-invalid", "Unknown raster resource request.");
        signal?.throwIfAborted();
        if (!options.state.live || !options.isAuthorized())
          return refusal(
            "x3.host/raster-context-unavailable",
            "The raster context is no longer readable.",
            provenance
          );
        const opened = await options.open(source, hint, signal);
        if (opened.state !== "opened")
          return {
            state: "unresolved",
            diagnostics: [
              ...opened.diagnostics,
              diagnostic(
                "warning",
                "x3.host/raster-codec-unavailable",
                "No image codec could open the resource."
              )
            ],
            ...provenance === void 0 ? {} : { provenance }
          };
        releases.push(() => opened.session.dispose());
        if (!opened.descriptor.dataSources.some(
          (ref) => ref.contract === "common.view/raster-image-source" && ref.major === 1
        ))
          return refusal(
            "x3.host/raster-source-unsupported",
            "The selected codec does not publish raster pixels.",
            provenance
          );
        const raster = await opened.session.dataSource(
          "common.view/raster-image-source",
          1
        );
        releases.push(() => raster.release());
        const info = Object.freeze({ ...await raster.value.info(signal) });
        if (indices && info.indexed !== true)
          return refusal(
            "x3.host/raster-plane-missing",
            "The image stores no palette indices to read.",
            provenance
          );
        const compressedPlan = compressedFormats.size === 0 || indices || atlasRegion !== void 0 || frameOnly !== void 0 || raster.value.readCompressed === void 0 || ![...compressedFormats].some((format) => format.startsWith(`${info.compression}-`)) ? void 0 : compressedSelectionPlan(info, selection, maxBytes);
        if (compressedPlan !== void 0) {
          const subresource = Object.freeze({
            frame: selection.frame ?? 0,
            mipLevel: compressedPlan.mipLevel,
            layer: selection.layer ?? 0,
            face: typeof selection.face === "number" ? selection.face : 0,
            slice: 0
          });
          let texture;
          try {
            texture = await raster.value.readCompressed(
              {
                mipLevel: subresource.mipLevel,
                layer: subresource.layer,
                face: subresource.face,
                maxBytes
              },
              signal
            );
          } catch (error) {
            if (signal?.aborted) throw error;
          }
          const owned = texture === void 0 ? void 0 : ownedCompressedTexture(texture, info, compressedPlan, maxBytes);
          if (owned !== void 0 && compressedFormats.has(owned.format))
            return {
              state: "compressed",
              info,
              texture: owned,
              subresource,
              diagnostics: Object.freeze([...opened.diagnostics]),
              ...provenance === void 0 ? {} : { provenance }
            };
        }
        if (!info.decodedAccess || raster.value.readRegion === void 0)
          return refusal(
            "x3.host/raster-decode-unavailable",
            "The selected image codec does not decode pixel regions.",
            provenance
          );
        if (frameOnly !== void 0 && frameOnly >= info.frames)
          return refusal(
            "x3.host/raster-frame-missing",
            `The image has no frame ${String(frameOnly)}; it has ${String(info.frames)}.`,
            provenance
          );
        if (atlasRegion !== void 0) {
          const area = info.atlasRegions?.find((item) => item.name === atlasRegion);
          if (area === void 0)
            return refusal(
              "x3.host/raster-atlas-region-missing",
              `The image has no atlas region named ${atlasRegion}.`,
              provenance
            );
          const read = await raster.value.readRegion(
            {
              x: area.x,
              y: area.y,
              width: area.width,
              height: area.height,
              ...frameOnly === void 0 ? {} : { frame: frameOnly },
              ...indices ? { pixelFormat: "gray8", plane: "indices" } : { pixelFormat: "rgba8" },
              maxBytes
            },
            signal
          );
          const region = indices ? indexPlaneRgba(read, area.width, area.height) ?? read : read;
          if (region.width !== area.width || region.height !== area.height || region.pixelFormat !== "rgba8" || !(region.pixels instanceof Uint8Array) || region.pixels.length > maxBytes)
            return refusal(
              "x3.host/raster-region-invalid",
              "The image codec returned an invalid bounded RGBA region.",
              provenance
            );
          const { atlasRegions: _atlas, ...rest } = info;
          return {
            info: Object.freeze({
              ...rest,
              width: area.width,
              height: area.height,
              mipLevels: 1,
              ...frameOnly === void 0 ? {} : { frames: 1 }
            }),
            diagnostics: Object.freeze([...opened.diagnostics]),
            ...provenance === void 0 ? {} : { provenance },
            state: "decoded",
            region: Object.freeze({ ...region, pixels: region.pixels.slice() })
          };
        }
        let plan;
        try {
          plan = rasterSelectionPlan(
            info,
            frameOnly === void 0 ? selection : { ...selection, frame: frameOnly },
            maxBytes
          );
        } catch (error) {
          return refusal(
            isModkitError(error) ? error.code : "x3.host/raster-selection-invalid",
            error instanceof Error ? error.message : "Invalid raster selection",
            provenance
          );
        }
        const surfaces = [];
        let remaining = maxBytes;
        for (const subresource of plan.subresources) {
          signal?.throwIfAborted();
          if (!options.state.live || !options.isAuthorized())
            return refusal(
              "x3.host/raster-context-unavailable",
              "The raster context is no longer readable.",
              provenance
            );
          const read = await raster.value.readRegion(
            {
              x: 0,
              y: 0,
              width: plan.width,
              height: plan.height,
              ...subresource,
              ...indices ? { pixelFormat: "gray8", plane: "indices" } : { pixelFormat: "rgba8" },
              maxBytes: remaining
            },
            signal
          );
          const region = indices ? indexPlaneRgba(read, plan.width, plan.height) ?? read : read;
          signal?.throwIfAborted();
          if (!options.state.live || !options.isAuthorized())
            return refusal(
              "x3.host/raster-context-unavailable",
              "The raster context is no longer readable.",
              provenance
            );
          if (region.width !== plan.width || region.height !== plan.height || region.pixelFormat !== "rgba8" || !Number.isSafeInteger(region.rowStride) || region.rowStride < plan.width * 4 || !(region.pixels instanceof Uint8Array) || region.pixels.length > remaining || region.rowStride * (plan.height - 1) + plan.width * 4 > region.pixels.length)
            return refusal(
              "x3.host/raster-region-invalid",
              "The image codec returned an invalid bounded RGBA region.",
              provenance
            );
          remaining -= region.pixels.length;
          surfaces.push(
            Object.freeze({
              // a named frame is frame 0 of the one-frame image the resource is
              subresource: frameOnly === void 0 ? subresource : Object.freeze({ ...subresource, frame: 0 }),
              region: Object.freeze({ ...region, pixels: region.pixels.slice() })
            })
          );
        }
        const common = {
          info: Object.freeze(frameOnly === void 0 ? { ...info } : { ...info, frames: 1 }),
          diagnostics: Object.freeze([...opened.diagnostics]),
          ...provenance === void 0 ? {} : { provenance }
        };
        if (selection.face === "all")
          return { ...common, state: "decoded-surfaces", surfaces: Object.freeze(surfaces) };
        const first = surfaces[0];
        if (first === void 0) throw new TypeError("raster selection produced no surfaces");
        return {
          ...common,
          state: "decoded",
          region: first.region,
          ...explicitSelection ? { subresource: first.subresource } : {}
        };
      } catch (error) {
        if (signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
        return refusal(
          "x3.host/raster-resource-failed",
          error instanceof Error ? error.message : "Raster resource read failed.",
          provenance
        );
      } finally {
        try {
          const failures = [];
          for (const release of releases.reverse()) {
            try {
              await release();
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length > 0) throw failures[0];
        } finally {
          options.state.reservedBytes -= maxBytes;
        }
      }
    }
  });
}
function logicalResourceDeadline(task, timeoutMs, parent) {
  parent?.throwIfAborted();
  if (timeoutMs <= 0) return Promise.resolve({ state: "deadline-exceeded" });
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const clear = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (!clear()) return;
      controller.abort(parent?.reason);
      reject(parent?.reason);
    };
    const timer = setTimeout(() => {
      if (!clear()) return;
      controller.abort(new DOMException("Logical resource deadline exceeded.", "TimeoutError"));
      resolve({ state: "deadline-exceeded" });
    }, timeoutMs);
    parent?.addEventListener("abort", abort, { once: true });
    if (parent?.aborted) abort();
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return task(controller.signal);
    }).then(
      (value) => {
        if (clear()) resolve({ state: "complete", value });
      },
      (error) => {
        if (clear()) reject(error);
      }
    );
  });
}
function refused(reason, message) {
  return Object.freeze({
    state: "refused",
    reason,
    message,
    items: Object.freeze([]),
    bytes: 0n
  });
}
function deadlineOutcome(message) {
  return Object.freeze({ state: "unresolved", reason: "deadline-exceeded", message });
}
function capture(request, context) {
  if (request === null || typeof request !== "object")
    throw new TypeError("A read batch is required.");
  const { items, concurrency, readTimeoutMs, totalTimeoutMs, maxBytes } = request;
  if (Object.keys(request).some(
    (key2) => !["items", "concurrency", "readTimeoutMs", "totalTimeoutMs", "maxBytes"].includes(key2)
  ) || !Array.isArray(items) || items.length > context.budget.maxNodes || ![concurrency, readTimeoutMs, totalTimeoutMs].every(
    (value) => Number.isSafeInteger(value) && value > 0
  ) || typeof maxBytes !== "bigint" || maxBytes < 0n)
    throw new TypeError("Invalid bounded read batch.");
  const length = items.length;
  const selected = [];
  let textBytes = 0;
  for (let index = 0; index < length; index += 1) {
    const item = items[index];
    if (item === null || typeof item !== "object" || Object.keys(item).some((key2) => !["requirement", "expectedRevision", "size"].includes(key2)))
      throw new TypeError("Invalid batch item.");
    const { requirement: raw, expectedRevision, size } = item;
    if (expectedRevision !== void 0 && !isRevisionId(expectedRevision) || size !== void 0 && (typeof size !== "bigint" || size < 0n))
      throw new TypeError("Invalid batch revision or extent.");
    const requirement = context.captureRequirement(raw);
    textBytes += new TextEncoder().encode(
      requirement.id + requirement.logicalId + (requirement.parentResourceId ?? "") + (requirement.alternatives ?? []).join("") + (expectedRevision ?? "") + requirement.scopes.join("")
    ).length;
    if (textBytes > context.budget.maxScalarBytes)
      throw new TypeError("Batch metadata exceeds the subject budget.");
    selected.push(
      Object.freeze({
        requirement,
        ...expectedRevision === void 0 ? {} : { expectedRevision },
        ...size === void 0 ? {} : { size }
      })
    );
  }
  const ceiling = context.budget.maxInputBytes < BigInt(context.budget.maxScalarBytes) ? context.budget.maxInputBytes : BigInt(context.budget.maxScalarBytes);
  return Object.freeze({
    items: Object.freeze(selected),
    concurrency: Math.min(concurrency, 4, context.budget.maxNodes),
    readTimeoutMs: Math.min(readTimeoutMs, 8e3, context.budget.deadlineMs ?? Infinity),
    totalTimeoutMs: Math.min(totalTimeoutMs, 1e4, context.budget.deadlineMs ?? Infinity),
    maxBytes: maxBytes < ceiling ? maxBytes : ceiling
  });
}
async function readLogicalResourceBatch(request, context, signal) {
  signal?.throwIfAborted();
  const unavailable = context.unavailable();
  if (unavailable !== void 0) return refused(unavailable, "A live readable subject is required.");
  let captured;
  try {
    captured = capture(request, context);
  } catch (error) {
    return refused(
      "request-invalid",
      error instanceof Error ? error.message : "Invalid read batch."
    );
  }
  const declaredBytes = captured.items.reduce((total, item) => total + (item.size ?? 0n), 0n);
  if (declaredBytes > captured.maxBytes)
    return refused("budget-exceeded", "Batch extents exceed the combined byte budget.");
  if (captured.items.length === 0)
    return Object.freeze({ state: "complete", items: Object.freeze([]), bytes: 0n });
  const results = Array.from({
    length: captured.items.length
  });
  const controller = new AbortController();
  let fatal;
  let reservedBytes = 0n;
  const hostByteCeiling = context.budget.maxInputBytes < BigInt(context.budget.maxScalarBytes) ? context.budget.maxInputBytes : BigInt(context.budget.maxScalarBytes);
  const reservations = /* @__PURE__ */ new Set();
  let closed = false;
  const releaseReservation = (reservation) => {
    if (!reservations.delete(reservation)) return;
    context.state.reservedBytes -= reservation.bytes;
  };
  let cursor2 = 0;
  const fail2 = (reason, message) => {
    if (fatal !== void 0) return;
    fatal = refused(reason, message);
    controller.abort(new DOMException(message, "AbortError"));
  };
  const readResolved = async (item, itemSignal, reservation) => {
    const resolution = await context.resolve(item.requirement, itemSignal);
    if (resolution.state === "unresolved") {
      itemSignal.throwIfAborted();
      if ([
        "budget-exceeded",
        "source-revision-changed",
        "permission-missing",
        "session-disposed"
      ].includes(resolution.reason))
        fail2(resolution.reason, resolution.diagnostic.message);
      return Object.freeze({
        state: "unresolved",
        reason: resolution.reason,
        message: resolution.diagnostic.message,
        provenance: resolution.provenance
      });
    }
    try {
      itemSignal.throwIfAborted();
      const source = resolution.lease.value;
      if (item.expectedRevision !== void 0 && resolution.revision !== item.expectedRevision) {
        fail2("source-revision-changed", "A resource changed after candidate discovery.");
        itemSignal.throwIfAborted();
      }
      if (source.kind !== "bytes" || source.size === void 0)
        return Object.freeze({
          state: "unresolved",
          reason: "size-mismatch",
          message: "A bounded byte source is required.",
          provenance: resolution.provenance
        });
      const size = source.size;
      if (item.size !== void 0 && item.size !== size) {
        fail2("source-revision-changed", "A resource extent changed after candidate discovery.");
        itemSignal.throwIfAborted();
      }
      if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER) || reservedBytes + size > captured.maxBytes || context.state.reservedBytes + size > hostByteCeiling) {
        fail2("budget-exceeded", "Resolved extents exceed the combined batch byte budget.");
        itemSignal.throwIfAborted();
      }
      reservedBytes += size;
      reservation.bytes = size;
      context.state.reservedBytes += size;
      const bytes = await source.read(0n, Number(size), itemSignal);
      itemSignal.throwIfAborted();
      const after = context.unavailable();
      if (after !== void 0) {
        fail2(after, "The read context is no longer authorized.");
        itemSignal.throwIfAborted();
      }
      if (bytes.length !== Number(size))
        return Object.freeze({
          state: "unresolved",
          reason: "size-mismatch",
          message: "The resource ended before its declared extent.",
          provenance: resolution.provenance
        });
      return Object.freeze({
        state: "read",
        bytes,
        revision: resolution.revision,
        provenance: resolution.provenance
      });
    } finally {
      await resolution.lease.release();
    }
  };
  const read = async (item, itemSignal) => {
    if (context.state.activeReads >= 4) {
      fail2("budget-exceeded", "The subject has no free resource read slots.");
      itemSignal.throwIfAborted();
    }
    context.state.activeReads += 1;
    const reservation = { bytes: 0n, settled: false };
    reservations.add(reservation);
    try {
      return await readResolved(item, itemSignal, reservation);
    } finally {
      context.state.activeReads -= 1;
      reservation.settled = true;
      if (closed) releaseReservation(reservation);
    }
  };
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    const completion = await logicalResourceDeadline(
      async (batchSignal) => {
        const worker = async () => {
          while (cursor2 < captured.items.length) {
            batchSignal.throwIfAborted();
            const index = cursor2++;
            const item = captured.items[index];
            if (item === void 0) throw new TypeError("Captured batch item is absent.");
            try {
              const result = await logicalResourceDeadline(
                (itemSignal) => read(item, itemSignal),
                captured.readTimeoutMs,
                batchSignal
              );
              if (result.state === "deadline-exceeded") {
                results[index] = deadlineOutcome("The resource read exceeded its duration ceiling.");
                return;
              }
              results[index] = result.value;
            } catch (error) {
              batchSignal.throwIfAborted();
              const after2 = context.unavailable();
              if (after2 !== void 0) {
                fail2(after2, "The read context is no longer authorized.");
                return;
              }
              const code = error !== null && typeof error === "object" && "code" in error ? error.code : void 0;
              if (typeof code === "string" && (code.includes("budget-exceeded") || code.includes("revision-changed"))) {
                fail2(
                  code.includes("revision-changed") ? "source-revision-changed" : "budget-exceeded",
                  "The host refused a staged resource read."
                );
                return;
              }
              results[index] = Object.freeze({
                state: "unresolved",
                reason: "read-failed",
                message: "The resource could not be read."
              });
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(captured.concurrency, captured.items.length) }, worker)
        );
      },
      captured.totalTimeoutMs,
      controller.signal
    );
    signal?.throwIfAborted();
    if (fatal !== void 0) return fatal;
    if (completion.state === "deadline-exceeded")
      return refused("deadline-exceeded", "The complete batch exceeded its duration ceiling.");
    const after = context.unavailable();
    if (after !== void 0) return refused(after, "The read context is no longer authorized.");
    const items = Object.freeze(
      results.map(
        (item) => item ?? deadlineOutcome("No read slot remained after timed-out backend calls.")
      )
    );
    return Object.freeze({
      state: "complete",
      items,
      bytes: items.reduce(
        (sum, item) => sum + (item.state === "read" ? BigInt(item.bytes.length) : 0n),
        0n
      )
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (fatal !== void 0) return fatal;
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    closed = true;
    for (const reservation of reservations) {
      if (reservation.settled) releaseReservation(reservation);
    }
  }
}
var ROLES = ["texture", "sidecar", "buffer"];
var MAXIMUM_ALTERNATIVES = 8;
var SCOPES = [
  "sibling-directory",
  "current-mount",
  "enclosing-container",
  "workspace-dependency-layer",
  "explicit-user-selection"
];
var REASONS = [
  "budget-exceeded",
  "namespace-invalid",
  "size-unavailable",
  "request-invalid",
  "request-unsupported",
  "context-unavailable",
  "permission-missing",
  "deadline-exceeded"
];
var EMPTY_RECEIPT = Object.freeze({
  complete: false,
  pages: 0,
  entries: 0,
  candidates: 0,
  bytes: 0n
});
function refuseDiscovery(reason, message, receipt = EMPTY_RECEIPT) {
  return Object.freeze({
    state: "refused",
    reason,
    message,
    candidates: Object.freeze([]),
    receipt
  });
}
function captureRequest(request) {
  if (request === null || typeof request !== "object" || Object.keys(request).some((key2) => !["role", "extension", "timeoutMs"].includes(key2)))
    throw new TypeError("Discovery accepts only role, extension and timeoutMs.");
  const { role, extension, timeoutMs } = request;
  if (!ROLES.includes(role) || typeof extension !== "string" || !/^\.[a-z0-9][a-z0-9_-]{0,31}$/i.test(extension) || timeoutMs !== void 0 && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0))
    throw new TypeError("Discovery requires a known resource role and literal extension.");
  return Object.freeze({
    role,
    extension: extension.toLowerCase(),
    ...timeoutMs === void 0 ? {} : { timeoutMs }
  });
}
function snapshotLogicalResourceDiscoveryPolicies(policies) {
  const seen = /* @__PURE__ */ new Set();
  return Object.freeze(
    Array.from(policies, (policy) => {
      const { role, extension, timeoutMs, discover } = policy;
      const request = captureRequest({
        role,
        extension,
        ...timeoutMs === void 0 ? {} : { timeoutMs }
      });
      const key2 = `${request.role}:${request.extension}`;
      if (seen.has(key2) || typeof discover !== "function")
        throw new TypeError(
          "Logical resource policies require unique role/extension pairs and a discover callback."
        );
      seen.add(key2);
      return Object.freeze({ ...request, discover: discover.bind(policy) });
    })
  );
}
function captureRequirement(request, maxLength) {
  if (request === null || typeof request !== "object")
    throw new TypeError("A logical requirement is required.");
  const { id, logicalId, role, scopes, parentResourceId, alternatives } = request;
  const scopeCount = Array.isArray(scopes) ? scopes.length : -1;
  if (Object.keys(request).some(
    (key2) => !["id", "logicalId", "role", "scopes", "parentResourceId", "alternatives"].includes(key2)
  ) || alternatives !== void 0 && (!Array.isArray(alternatives) || alternatives.length > MAXIMUM_ALTERNATIVES || !alternatives.every(
    (value) => typeof value === "string" && value.length > 0 && value.length <= maxLength
  )) || ![id, logicalId].every(
    (value) => typeof value === "string" && value.length > 0 && value.length <= maxLength
  ) || !ROLES.includes(role) || !Array.isArray(scopes) || !Number.isSafeInteger(scopeCount) || scopeCount < 0 || scopeCount > SCOPES.length || parentResourceId !== void 0 && (typeof parentResourceId !== "string" || parentResourceId.length === 0 || parentResourceId.length > maxLength))
    throw new TypeError("Invalid bounded logical requirement.");
  const capturedScopes = [];
  for (let index = 0; index < scopeCount; index += 1) {
    const scope = scopes[index];
    if (scope === void 0 || !SCOPES.includes(scope))
      throw new TypeError("Unknown resource scope.");
    capturedScopes.push(scope);
  }
  return Object.freeze({
    id,
    logicalId,
    role,
    scopes: Object.freeze(capturedScopes),
    ...parentResourceId === void 0 ? {} : { parentResourceId },
    ...alternatives === void 0 ? {} : { alternatives: Object.freeze([...alternatives]) }
  });
}
function copyProvenance(record) {
  return Object.freeze({ ...record, scopes: Object.freeze([...record.scopes]) });
}
function captureCandidateScopes(scopes) {
  if (scopes === void 0) return void 0;
  if (!Array.isArray(scopes)) throw new TypeError("Invalid discovery candidate scopes.");
  const length = scopes.length;
  if (!Number.isSafeInteger(length) || length < 1 || length > SCOPES.length)
    throw new TypeError("Discovery candidate scopes require one to five entries.");
  const selected = Array.from({ length }, (_, index) => scopes[index]);
  const captured = [];
  const seen = /* @__PURE__ */ new Set();
  for (const scope of selected) {
    if (scope === void 0 || !SCOPES.includes(scope) || seen.has(scope))
      throw new TypeError("Discovery candidate scopes must be known and unique.");
    seen.add(scope);
    captured.push(scope);
  }
  return Object.freeze(captured);
}
function unresolved(requirement, reason, message) {
  return Object.freeze({
    state: "unresolved",
    reason,
    diagnostic: diagnostic("warning", resourceDiagnosticCode(reason), message),
    provenance: Object.freeze({
      requirementId: requirement.id,
      logicalId: requirement.logicalId,
      role: requirement.role,
      state: "unresolved",
      reason,
      cached: false,
      scopes: Object.freeze([...requirement.scopes])
    })
  });
}
function createSubjectLogicalResources(options) {
  const budget = Object.freeze({ ...options.budget });
  const batchState = { activeReads: 0, reservedBytes: 0n };
  const maxBytes = budget.maxInputBytes < BigInt(budget.maxScalarBytes) ? budget.maxInputBytes : BigInt(budget.maxScalarBytes);
  const policies = /* @__PURE__ */ new Map();
  for (const policy of snapshotLogicalResourceDiscoveryPolicies(options.policies ?? [])) {
    policies.set(`${policy.role}:${policy.extension}`, policy);
  }
  const unavailable = () => !options.state.live || options.state.resources?.state() !== "live" ? "context-unavailable" : !options.isAuthorized() ? "permission-missing" : void 0;
  const assertLive = (signal) => {
    signal?.throwIfAborted();
    const reason = unavailable();
    if (reason !== void 0)
      throw new ModkitError({
        code: `x3.host/logical-resource-${reason}`,
        message: "Logical resources require a live readable subject."
      });
  };
  const captureDiscovery = (value) => {
    if (value === null || typeof value !== "object")
      throw new TypeError("Invalid discovery result.");
    const { state, candidates, receipt: raw } = value;
    if (raw === null || typeof raw !== "object") throw new TypeError("Invalid discovery receipt.");
    const { complete, pages, entries, candidates: count, bytes } = raw;
    if (typeof complete !== "boolean" || ![pages, entries, count].every((n) => Number.isSafeInteger(n) && n >= 0) || typeof bytes !== "bigint" || bytes < 0n || count > entries || !Array.isArray(candidates))
      throw new TypeError("Invalid discovery receipt counts.");
    if (pages > budget.maxNodes || entries > budget.maxNodes || count > budget.maxNodes || candidates.length > budget.maxNodes || bytes > maxBytes)
      return refuseDiscovery("budget-exceeded", "Discovery exceeds the subject budget.");
    const receipt = Object.freeze({ complete, pages, entries, candidates: count, bytes });
    if (state === "refused") {
      const { reason, message } = value;
      if (complete || candidates.length !== 0 || !REASONS.includes(reason) || typeof message !== "string" || message.length > budget.maxScalarBytes)
        throw new TypeError("Invalid discovery refusal.");
      return refuseDiscovery(reason, message, receipt);
    }
    if (state !== "complete" || !complete || count !== candidates.length)
      throw new TypeError("Discovery did not publish a complete consistent receipt.");
    let context;
    let contextBytes = 0;
    const rawContext = value.context;
    if (rawContext !== void 0) {
      if (rawContext === null || typeof rawContext !== "object" || Object.keys(rawContext).some((key2) => key2 !== "primaryLogicalId" && key2 !== "rootId"))
        throw new TypeError("Invalid discovery naming context.");
      const { primaryLogicalId, rootId } = rawContext;
      if (typeof primaryLogicalId !== "string" || primaryLogicalId.length === 0 || primaryLogicalId.length > budget.maxScalarBytes || rootId !== void 0 && (typeof rootId !== "string" || rootId.length === 0 || rootId.length > budget.maxScalarBytes))
        throw new TypeError("Invalid bounded discovery identity.");
      normalizeCompanionLogicalId(primaryLogicalId);
      contextBytes = new TextEncoder().encode(primaryLogicalId + (rootId ?? "")).length;
      context = Object.freeze({ primaryLogicalId, ...rootId === void 0 ? {} : { rootId } });
    }
    const copied = [];
    const seen = /* @__PURE__ */ new Set();
    let total = 0n;
    let textBytes = contextBytes;
    if (textBytes > budget.maxScalarBytes)
      return refuseDiscovery("budget-exceeded", "Discovery context exceeds the subject budget.");
    const selected = Array.from({ length: count }, (_, index) => candidates[index]);
    for (const candidate of selected) {
      if (candidate === null || typeof candidate !== "object")
        throw new TypeError("Invalid discovery candidate.");
      const { logicalId, expectedRevision, size, rootId, scopes: rawScopes } = candidate;
      if (![logicalId, expectedRevision, rootId].every(
        (s) => typeof s === "string" && s.length > 0 && s.length <= budget.maxScalarBytes
      ) || !isRevisionId(expectedRevision) || typeof size !== "bigint" || size < 0n || seen.has(logicalId))
        throw new TypeError("Invalid or duplicate discovery candidate.");
      const scopes = captureCandidateScopes(rawScopes);
      normalizeCompanionLogicalId(logicalId);
      seen.add(logicalId);
      total += size;
      textBytes += new TextEncoder().encode(logicalId + expectedRevision + rootId).length;
      if (scopes !== void 0) textBytes += new TextEncoder().encode(scopes.join("")).length;
      if (total > maxBytes || textBytes > budget.maxScalarBytes)
        return refuseDiscovery("budget-exceeded", "Discovery candidates exceed the subject budget.");
      copied.push(
        Object.freeze({
          logicalId,
          expectedRevision,
          size,
          rootId,
          ...scopes === void 0 ? {} : { scopes }
        })
      );
    }
    if (total !== bytes) throw new TypeError("Discovery candidate bytes disagree with the receipt.");
    return Object.freeze({
      state: "complete",
      candidates: Object.freeze(copied),
      receipt,
      ...context === void 0 ? {} : { context }
    });
  };
  const port = {
    readBatch(request, signal) {
      return readLogicalResourceBatch(
        request,
        {
          budget,
          state: batchState,
          resolve: port.resolve,
          captureRequirement: (requirement) => captureRequirement(requirement, budget.maxScalarBytes),
          unavailable
        },
        signal
      );
    },
    async discover(request, signal) {
      signal?.throwIfAborted();
      const reason = unavailable();
      if (reason !== void 0)
        return refuseDiscovery(reason, "Logical discovery requires a live readable subject.");
      let captured;
      try {
        captured = captureRequest(request);
      } catch (error) {
        return refuseDiscovery(
          "request-invalid",
          error instanceof Error ? error.message : "Invalid discovery request."
        );
      }
      if (options.state.discoveryCalls >= budget.maxNodes)
        return refuseDiscovery(
          "budget-exceeded",
          "Logical discovery request count exceeds the subject budget."
        );
      options.state.discoveryCalls += 1;
      const policy = policies.get(`${captured.role}:${captured.extension}`);
      if (policy === void 0)
        return refuseDiscovery(
          "request-unsupported",
          "The host has no registered policy for this request."
        );
      try {
        const timeoutMs = Math.min(
          captured.timeoutMs ?? 5e3,
          policy.timeoutMs ?? 5e3,
          budget.deadlineMs ?? Infinity
        );
        const result = await logicalResourceDeadline(
          (discoverySignal) => policy.discover({ budget, signal: discoverySignal }),
          timeoutMs,
          signal
        );
        signal?.throwIfAborted();
        const after = unavailable();
        if (after !== void 0)
          return refuseDiscovery(after, "The discovery context is no longer readable.");
        if (result.state === "deadline-exceeded")
          return refuseDiscovery(
            "deadline-exceeded",
            "Logical discovery exceeded its duration ceiling."
          );
        return captureDiscovery(result.value);
      } catch (error) {
        if (signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
        return refuseDiscovery(
          "namespace-invalid",
          "The host discovery policy returned an invalid or unavailable result."
        );
      }
    },
    async resolve(request, signal) {
      signal?.throwIfAborted();
      let requirement;
      try {
        requirement = captureRequirement(request, budget.maxScalarBytes);
      } catch {
        return unresolved(
          { id: "invalid", logicalId: "invalid", role: "buffer", scopes: [] },
          "path-refused",
          "Invalid bounded logical requirement."
        );
      }
      const reason = unavailable();
      if (reason !== void 0)
        return unresolved(
          requirement,
          reason === "permission-missing" ? reason : "session-disposed",
          "Logical resolution requires a live readable subject."
        );
      const resources = options.state.resources;
      if (resources === void 0)
        return unresolved(requirement, "session-disposed", "The subject has no resource origin.");
      if (options.state.resolveCalls >= budget.maxNodes)
        return unresolved(
          requirement,
          "budget-exceeded",
          "Logical resolution request count exceeds the subject budget."
        );
      options.state.resolveCalls += 1;
      const resolution = await resources.resolve(requirement, signal);
      if (resolution.state === "unresolved") {
        assertLive(signal);
        return Object.freeze({ ...resolution, provenance: copyProvenance(resolution.provenance) });
      }
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        await resolution.lease.release();
      };
      try {
        assertLive(signal);
        const source = resolution.lease.value;
        if (source.kind !== "bytes") {
          await release();
          return unresolved(
            requirement,
            "scope-unsupported",
            "Logical consumer resources expose byte sources only."
          );
        }
        const { size, revision } = source;
        if (typeof size !== "bigint" || size < 0n || size > budget.maxInputBytes || !isRevisionId(revision) || revision !== resolution.revision) {
          await release();
          return unresolved(
            requirement,
            "budget-exceeded",
            "The resource has no valid bounded pinned byte extent."
          );
        }
        const live = (readSignal) => {
          assertLive(readSignal);
          if (released)
            throw new ModkitError({
              code: "x3.host/resource-session-disposed",
              message: "The logical resource lease was released."
            });
        };
        const read = async (offset, length, readSignal) => {
          live(readSignal);
          if (typeof offset !== "bigint" || offset < 0n || !Number.isSafeInteger(length) || length < 0 || offset + BigInt(length) > size || options.state.reservedBytes + length > budget.maxScalarBytes)
            throw new ModkitError({
              code: "x3.host/resource-budget-exceeded",
              message: "The logical byte read exceeds its bounded extent or byte budget."
            });
          options.state.reservedBytes += length;
          try {
            const bytes = await source.read(offset, length, readSignal);
            live(readSignal);
            if (!(bytes instanceof Uint8Array) || bytes.length > length)
              throw new ModkitError({
                code: "x3.host/resource-budget-exceeded",
                message: "The resource returned more bytes than requested."
              });
            return Uint8Array.from(bytes);
          } finally {
            options.state.reservedBytes -= length;
          }
        };
        const bounded = Object.freeze({
          kind: "bytes",
          ref: Object.freeze({ ...source.ref }),
          revision,
          size,
          read,
          async *stream(range, readSignal) {
            live(readSignal);
            const offset = range?.offset ?? 0n;
            const length = range?.length ?? size - offset;
            if (typeof offset !== "bigint" || typeof length !== "bigint" || offset < 0n || length < 0n || offset + length > size)
              throw new TypeError("Invalid logical resource stream range.");
            const chunkSize = Math.min(65536, budget.maxScalarBytes);
            if (length > 0n && chunkSize < 1)
              throw new TypeError("The subject has no byte-read budget.");
            let cursor2 = offset;
            const end = offset + length;
            while (cursor2 < end) {
              const remaining = end - cursor2;
              const bytes = await read(
                cursor2,
                Number(remaining < BigInt(chunkSize) ? remaining : BigInt(chunkSize)),
                readSignal
              );
              if (bytes.length === 0)
                throw new TypeError("The logical resource ended before its declared extent.");
              cursor2 += BigInt(bytes.length);
              yield bytes;
            }
          }
        });
        return Object.freeze({
          state: "resolved",
          revision,
          provenance: copyProvenance(resolution.provenance),
          lease: Object.freeze({ value: bounded, release })
        });
      } catch (error) {
        await release();
        throw error;
      }
    },
    async identity(signal) {
      signal?.throwIfAborted();
      if (unavailable() !== void 0) return void 0;
      const primaryLogicalId = options.state.resources?.primaryLogicalId;
      return primaryLogicalId === void 0 || primaryLogicalId.length === 0 ? void 0 : Object.freeze({ primaryLogicalId });
    },
    async provenance(signal) {
      assertLive(signal);
      const records = options.state.resources?.provenance() ?? [];
      if (records.length > budget.maxNodes)
        throw new ModkitError({
          code: "x3.host/resource-budget-exceeded",
          message: "Logical provenance exceeds the subject record budget."
        });
      return Object.freeze(records.map(copyProvenance));
    }
  };
  return Object.freeze(port);
}
var NAMESPACE_SCOPES = Object.freeze([
  "current-mount",
  "enclosing-container"
]);
var NESTED_ENTRY_NOT_FOUND = "x3.host/nested-entry-not-found";
var BYTE_RANGE_SOURCE = "common.view/byte-range-source";
function storedEntrySource(session, descriptor) {
  return descriptor.dataSources.some(
    (item) => item.contract === BYTE_RANGE_SOURCE && item.major === 1
  ) ? () => session.dataSource(BYTE_RANGE_SOURCE, 1) : void 0;
}
function createNamespaceCompanionOrigin(options) {
  const pageLimit = options.pageLimit ?? 256;
  const caseSensitivity = options.caseSensitivity ?? "insensitive";
  const fold2 = (value) => caseSensitivity === "insensitive" ? value.toLowerCase() : value;
  const index = /* @__PURE__ */ new Map();
  const observed = /* @__PURE__ */ new Map();
  const listing = async function* (prefix, signal) {
    const cached = index.get(prefix);
    if (cached !== void 0) {
      yield* cached.values();
      return;
    }
    const built = /* @__PURE__ */ new Map();
    const spellings = [...new Set(prefix === "" ? [""] : [prefix, fold2(prefix)])];
    let pages = 0;
    for (const spelling of spellings) {
      let cursor2;
      const cursors = /* @__PURE__ */ new Set();
      do {
        throwIfAborted(signal);
        if (++pages > (options.maxPages ?? 4096) || cursor2 !== void 0 && cursors.has(cursor2))
          throw new ModkitError({
            code: COMPANION_BUDGET_EXCEEDED,
            message: "namespace listing did not terminate within its page budget"
          });
        if (cursor2 !== void 0) cursors.add(cursor2);
        const page = await options.namespace.list(
          spelling,
          cursor2 === void 0 ? { limit: pageLimit } : { cursor: cursor2, limit: pageLimit },
          signal
        );
        for (const entry of page.items) {
          if (entry.kind !== "file") continue;
          const key2 = fold2(entry.path);
          if (!built.has(key2)) {
            const value = {
              entryId: entry.id,
              path: entry.path,
              ...entry.size === void 0 ? {} : { size: entry.size },
              ...entry.rangeAccess === true ? { rangeAccess: true } : {},
              ...entry.storedRange === void 0 ? {} : { storedRange: entry.storedRange },
              revision: entry.revision
            };
            built.set(key2, value);
            if (!observed.has(key2)) observed.set(key2, value);
            yield value;
          }
        }
        cursor2 = page.nextCursor;
      } while (cursor2 !== void 0);
    }
    index.set(prefix, built);
  };
  return Object.freeze({
    primaryLogicalId: options.primaryLogicalId,
    caseSensitivity,
    scopes: NAMESPACE_SCOPES,
    async *enumerate(scope, enumeration, signal) {
      throwIfAborted(signal);
      if (scope !== "current-mount" && scope !== "enclosing-container") return;
      const namePrefix = enumeration.namePrefix === void 0 ? "" : fold2(enumeration.prefix + enumeration.namePrefix);
      for await (const entry of listing(enumeration.prefix, signal)) {
        throwIfAborted(signal);
        if (namePrefix !== "" && !fold2(entry.path).startsWith(namePrefix)) continue;
        yield Object.freeze({
          logicalId: entry.path,
          ...entry.size === void 0 ? {} : { size: entry.size }
        });
      }
    },
    async open(logicalId, signal) {
      throwIfAborted(signal);
      let entry = observed.get(fold2(logicalId));
      if (entry === void 0) {
        for await (const candidate of listing(logicalId, signal)) {
          if (fold2(candidate.path) === fold2(logicalId)) {
            entry = candidate;
            break;
          }
        }
      }
      if (entry === void 0) {
        throw new ModkitError({
          code: NESTED_ENTRY_NOT_FOUND,
          message: `container has no entry \xAB${logicalId}\xBB`,
          context: { logicalId }
        });
      }
      const ranged = rangeEntryLease(
        options.namespace,
        entry,
        options.containerRevision,
        options.openStoredSource,
        signal
      );
      if (ranged !== void 0) return ranged;
      if (options.maxSourceBytes !== void 0 && entry.size !== void 0 && entry.size > options.maxSourceBytes)
        throw new ModkitError({
          code: COMPANION_BUDGET_EXCEEDED,
          message: `resource \xAB${logicalId}\xBB exceeds the extraction byte budget`
        });
      const refLease = await options.namespace.openEntry(entry.entryId, signal);
      let bytes;
      try {
        bytes = await options.extract(entry.entryId, signal);
        if (options.maxSourceBytes !== void 0 && BigInt(bytes.byteLength) > options.maxSourceBytes)
          throw new ModkitError({
            code: COMPANION_BUDGET_EXCEEDED,
            message: `resource \xAB${logicalId}\xBB exceeds the extraction byte budget`
          });
      } catch (error) {
        await refLease.release();
        throw error;
      }
      const source = containerEntrySource(
        refLease.value,
        containerEntryRevision(options.containerRevision, entry.entryId, bytes.byteLength),
        bytes
      );
      return Object.freeze({ value: source, release: () => refLease.release() });
    }
  });
}
function createWorkspaceNamespaceCompanionOrigin(options) {
  return createCompositeWorkspaceNamespaceCompanionOrigin({
    primaryLogicalId: options.primaryLogicalId,
    roots: options.logicalRoots.map((root) => ({
      ...root,
      namespace: options.namespace,
      containerRevision: options.containerRevision,
      extract: options.extract,
      ...options.openStoredSource === void 0 ? {} : { openStoredSource: options.openStoredSource }
    })),
    ...options.caseSensitivity === void 0 ? {} : { caseSensitivity: options.caseSensitivity },
    ...options.pageLimit === void 0 ? {} : { pageLimit: options.pageLimit },
    ...options.maxPages === void 0 ? {} : { maxPages: options.maxPages }
  });
}
var WORKSPACE_SCOPES = Object.freeze([
  "workspace-dependency-layer",
  "current-mount",
  "enclosing-container"
]);
function createCompositeWorkspaceNamespaceCompanionOrigin(options) {
  const pageLimit = options.pageLimit ?? 256;
  const maxPages = options.maxPages ?? 4096;
  const caseSensitivity = options.caseSensitivity ?? "insensitive";
  const fold2 = (value) => caseSensitivity === "insensitive" ? value.toLowerCase() : value;
  const roots = options.roots.map((root) => {
    const pathPrefix = root.pathPrefix === "" ? "" : normalizeCompanionLogicalId(root.pathPrefix).replace(/\/$/u, "");
    const logicalPrefix = root.logicalPrefix === void 0 || root.logicalPrefix === "" ? "" : normalizeCompanionLogicalId(root.logicalPrefix).replace(/\/$/u, "");
    return Object.freeze({
      rootId: root.rootId,
      pathPrefix,
      logicalPrefix,
      namespace: root.namespace,
      containerRevision: root.containerRevision,
      extract: root.extract,
      ...root.openStoredSource === void 0 ? {} : { openStoredSource: root.openStoredSource },
      ...root.assetRoots === void 0 ? {} : {
        assetRoots: Object.freeze(
          root.assetRoots.map(
            (pattern) => pattern === "" ? "" : normalizeCompanionLogicalId(pattern).replace(/\/$/u, "")
          )
        )
      }
    });
  });
  if (roots.length === 0) throw new TypeError("workspace namespace origin requires a logical root");
  if (new Set(roots.map((root) => root.rootId)).size !== roots.length) {
    throw new TypeError("workspace namespace origin root ids must differ");
  }
  const byLogicalId = /* @__PURE__ */ new Map();
  const pages = async function* (root, prefix, signal) {
    const spellings = [...new Set(prefix === "" ? [""] : [prefix, fold2(prefix)])];
    for (const spelling of spellings) {
      let cursor2;
      let pageCount = 0;
      const seenCursors = /* @__PURE__ */ new Set();
      do {
        throwIfAborted(signal);
        if (pageCount >= maxPages) {
          throw new RangeError(`workspace namespace prefix exceeds ${maxPages} pages`);
        }
        if (cursor2 !== void 0) {
          if (seenCursors.has(cursor2)) {
            throw new RangeError("workspace namespace paging cursor repeated");
          }
          seenCursors.add(cursor2);
        }
        const page = await root.namespace.list(
          spelling,
          cursor2 === void 0 ? { limit: pageLimit } : { cursor: cursor2, limit: pageLimit },
          signal
        );
        yield* page.items;
        pageCount += 1;
        cursor2 = page.nextCursor;
      } while (cursor2 !== void 0);
    }
  };
  const joinPrefix = (prefix, suffix) => prefix === "" ? suffix : suffix === "" ? prefix : `${prefix}/${suffix}`;
  const isQualifiedRequest = (logicalId) => roots.some((root) => {
    if (root.logicalPrefix === "") return false;
    return fold2(logicalId) === fold2(root.logicalPrefix) || fold2(logicalId).startsWith(fold2(`${root.logicalPrefix}/`));
  });
  const relativeRequest = (root, logicalId) => {
    if (logicalId === "") return "";
    if (root.logicalPrefix === "") return logicalId;
    if (!isQualifiedRequest(logicalId)) return logicalId;
    if (fold2(logicalId) === fold2(root.logicalPrefix)) return "";
    const prefix = `${root.logicalPrefix}/`;
    return fold2(logicalId).startsWith(fold2(prefix)) ? logicalId.slice(prefix.length) : void 0;
  };
  const assetSpellings = (root, relative) => {
    const slash = relative.indexOf("/");
    if (root.assetRoots === void 0 || slash <= 0) return [relative];
    const first = fold2(relative.slice(0, slash));
    const rest = relative.slice(slash + 1);
    const named = root.assetRoots.some(
      (pattern) => pattern.startsWith("*") ? first.endsWith(fold2(pattern.slice(1))) : pattern !== "" && first === fold2(pattern)
    );
    if (!named) return [relative];
    const spellings = [relative];
    for (const pattern of root.assetRoots) {
      if (pattern.startsWith("*")) continue;
      const spelling = pattern === "" ? rest : `${pattern}/${rest}`;
      if (!spellings.some((known) => fold2(known) === fold2(spelling))) spellings.push(spelling);
    }
    return spellings;
  };
  const remember2 = (root, entry) => {
    if (entry.kind !== "file") return void 0;
    const prefix = root.pathPrefix === "" ? "" : `${root.pathPrefix}/`;
    if (prefix !== "" && !fold2(entry.path).startsWith(fold2(prefix))) return void 0;
    const relative = prefix === "" ? entry.path : entry.path.slice(prefix.length);
    if (relative === "") return void 0;
    const logicalId = joinPrefix(root.logicalPrefix, relative);
    const key2 = fold2(logicalId);
    if (!byLogicalId.has(key2)) {
      byLogicalId.set(key2, {
        entryId: entry.id,
        path: entry.path,
        ...entry.size === void 0 ? {} : { size: entry.size },
        ...entry.rangeAccess === true ? { rangeAccess: true } : {},
        ...entry.storedRange === void 0 ? {} : { storedRange: entry.storedRange },
        revision: entry.revision,
        namespace: root.namespace,
        containerRevision: root.containerRevision,
        extract: root.extract,
        ...root.openStoredSource === void 0 ? {} : { openStoredSource: root.openStoredSource }
      });
    }
    return logicalId;
  };
  const relativeEntryPath = (root, entry) => {
    if (entry.kind !== "file") return void 0;
    const prefix = root.pathPrefix === "" ? "" : `${root.pathPrefix}/`;
    if (prefix !== "" && !fold2(entry.path).startsWith(fold2(prefix))) return void 0;
    const relative = prefix === "" ? entry.path : entry.path.slice(prefix.length);
    return relative === "" ? void 0 : relative;
  };
  const find = async (logicalId, signal) => {
    const key2 = fold2(logicalId);
    const cached = byLogicalId.get(key2);
    if (cached !== void 0) return cached;
    const qualified = isQualifiedRequest(logicalId);
    for (const root of roots) {
      const relative = relativeRequest(root, logicalId);
      if (relative === void 0) continue;
      for (const spelling of qualified ? [relative] : assetSpellings(root, relative)) {
        const wanted = qualified ? key2 : fold2(spelling);
        for await (const entry of pages(root, joinPrefix(root.pathPrefix, spelling), signal)) {
          const remembered = remember2(root, entry);
          if (remembered === void 0) continue;
          const exposed = qualified ? remembered : relativeEntryPath(root, entry);
          if (exposed !== void 0 && fold2(exposed) === wanted) {
            const bound = byLogicalId.get(fold2(remembered));
            if (bound !== void 0) byLogicalId.set(key2, bound);
            return bound;
          }
        }
      }
    }
    return void 0;
  };
  async function* containerEntries(prefix, signal) {
    const qualified = isQualifiedRequest(prefix);
    const entriesSeen = /* @__PURE__ */ new Map();
    const yielded = /* @__PURE__ */ new Set();
    for (const root of roots) {
      const relative = relativeRequest(root, prefix);
      if (relative === void 0) continue;
      let seen = entriesSeen.get(root.namespace);
      if (seen === void 0) entriesSeen.set(root.namespace, seen = /* @__PURE__ */ new Set());
      for await (const entry of pages(root, joinPrefix(root.pathPrefix, relative), signal)) {
        throwIfAborted(signal);
        const remembered = remember2(root, entry);
        if (remembered === void 0) continue;
        const logicalId = qualified ? remembered : relativeEntryPath(root, entry);
        if (logicalId === void 0 || seen.has(entry.id) || yielded.has(fold2(logicalId))) continue;
        seen.add(entry.id);
        yielded.add(fold2(logicalId));
        const bound = byLogicalId.get(fold2(remembered));
        if (bound !== void 0) byLogicalId.set(fold2(logicalId), bound);
        yield Object.freeze({
          logicalId,
          rootId: root.rootId,
          ...entry.size === void 0 ? {} : { size: entry.size }
        });
      }
    }
  }
  return Object.freeze({
    primaryLogicalId: options.primaryLogicalId,
    caseSensitivity,
    // a resource opened out of the workspace (a map's terrain raster) finds its own companions in
    // the mount it lives in: the workspace's containers are that mount
    scopes: WORKSPACE_SCOPES,
    async *enumerate(scope, enumeration, signal) {
      if (!WORKSPACE_SCOPES.includes(scope)) return;
      if (scope !== "workspace-dependency-layer") {
        yield* containerEntries(enumeration.prefix, signal);
        return;
      }
      const yielded = /* @__PURE__ */ new Set();
      const qualified = isQualifiedRequest(enumeration.prefix);
      for (const root of roots) {
        const relative = relativeRequest(root, enumeration.prefix);
        if (relative === void 0) continue;
        for (const spelling of qualified ? [relative] : assetSpellings(root, relative)) {
          for await (const entry of pages(root, joinPrefix(root.pathPrefix, spelling), signal)) {
            throwIfAborted(signal);
            const remembered = remember2(root, entry);
            if (remembered === void 0) continue;
            const exposed = qualified ? remembered : relativeEntryPath(root, entry);
            const logicalId = exposed === void 0 || qualified || spelling === relative ? exposed : fold2(exposed).startsWith(fold2(spelling)) ? `${relative}${exposed.slice(spelling.length)}` : void 0;
            if (logicalId === void 0 || yielded.has(fold2(logicalId))) continue;
            const bound = byLogicalId.get(fold2(remembered));
            if (bound !== void 0) byLogicalId.set(fold2(logicalId), bound);
            yielded.add(fold2(logicalId));
            yield Object.freeze({
              logicalId,
              rootId: root.rootId,
              ...entry.size === void 0 ? {} : { size: entry.size }
            });
          }
        }
      }
    },
    async open(logicalId, signal) {
      throwIfAborted(signal);
      const entry = await find(logicalId, signal);
      if (entry === void 0) {
        throw new ModkitError({
          code: NESTED_ENTRY_NOT_FOUND,
          message: `workspace namespace has no entry \xAB${logicalId}\xBB`,
          context: { logicalId }
        });
      }
      const ranged = rangeEntryLease(
        entry.namespace,
        entry,
        entry.containerRevision,
        entry.openStoredSource,
        signal
      );
      if (ranged !== void 0) return ranged;
      const refLease = await entry.namespace.openEntry(entry.entryId, signal);
      let bytes;
      try {
        bytes = await entry.extract(entry.entryId, signal);
      } catch (error) {
        await refLease.release();
        throw error;
      }
      return Object.freeze({
        value: containerEntrySource(
          refLease.value,
          containerEntryRevision(entry.containerRevision, entry.entryId, bytes.byteLength),
          bytes
        ),
        release: () => refLease.release()
      });
    }
  });
}
function containerEntryRangeSource(ref, revision, parent, range) {
  const invalid2 = (message, context) => new ModkitError({ code: "x3.host/invalid-source-range", message, context: { uri: ref.uri, ...context } });
  if (range.offset < 0n || range.length < 0n) throw invalid2(`entry range of \xAB${ref.uri}\xBB is negative`, {});
  const read = async (offset, length, signal) => {
    throwIfAborted(signal);
    if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
      throw invalid2(`container entry read of \xAB${ref.uri}\xBB must use a non-negative exact range`, {
        offset: String(offset),
        length
      });
    }
    if (offset > range.length) {
      throw invalid2(`container entry read of \xAB${ref.uri}\xBB starts beyond the entry size`, {
        offset: String(offset),
        size: String(range.length)
      });
    }
    const available = range.length - offset;
    const wanted = BigInt(length) < available ? length : Number(available);
    return wanted === 0 ? new Uint8Array() : parent.read(range.offset + offset, wanted, signal);
  };
  return Object.freeze({
    kind: "bytes",
    ref,
    revision,
    size: range.length,
    read,
    async *stream(window2, signal) {
      const start = window2?.offset ?? 0n;
      const end = window2?.length === void 0 ? range.length : start + window2.length;
      for (let at = start; at < end && at < range.length; ) {
        const chunk = await read(at, Number(end - at < 1048576n ? end - at : 1048576n), signal);
        if (chunk.byteLength === 0) return;
        at += BigInt(chunk.byteLength);
        yield chunk;
      }
    }
  });
}
function rangeEntryLease(namespace, entry, containerRevision, openStoredSource, signal) {
  const { entryId, storedRange } = entry;
  if (entry.rangeAccess === true && namespace.openEntrySource !== void 0)
    return entryRangeLease(
      namespace,
      entryId,
      containerRevision,
      signal,
      () => namespace.openEntrySource(entryId, signal)
    );
  if (storedRange !== void 0 && openStoredSource !== void 0)
    return entryRangeLease(
      namespace,
      entryId,
      containerRevision,
      signal,
      openStoredSource,
      storedRange
    );
  return void 0;
}
async function entryRangeLease(namespace, entryId, containerRevision, signal, openSource, storedRange) {
  const refLease = await namespace.openEntry(entryId, signal);
  let sourceLease;
  try {
    throwIfAborted(signal);
    sourceLease = await openSource();
  } catch (error) {
    await refLease.release();
    throw error;
  }
  try {
    const range = storedRange ?? { offset: 0n, length: await sourceLease.value.size() };
    return Object.freeze({
      value: containerEntryRangeSource(
        refLease.value,
        containerEntryRevision(containerRevision, entryId, range.length),
        sourceLease.value,
        range
      ),
      release: async () => {
        await sourceLease.release();
        await refLease.release();
      }
    });
  } catch (error) {
    await sourceLease.release();
    await refLease.release();
    throw error;
  }
}
function containerEntrySource(ref, revision, bytes) {
  return Object.freeze({
    kind: "bytes",
    ref,
    revision,
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      throwIfAborted(signal);
      if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
        throw new ModkitError({
          code: "x3.host/invalid-source-range",
          message: `container entry read of \xAB${ref.uri}\xBB must use a non-negative exact range`,
          context: { uri: ref.uri, offset: String(offset), length }
        });
      }
      if (offset > BigInt(bytes.byteLength)) {
        throw new ModkitError({
          code: "x3.host/invalid-source-range",
          message: `container entry read of \xAB${ref.uri}\xBB starts beyond the entry size`,
          context: { uri: ref.uri, offset: String(offset), size: bytes.byteLength }
        });
      }
      const start = Number(offset);
      return bytes.slice(start, Math.min(bytes.byteLength, start + length));
    },
    async *stream(range, signal) {
      throwIfAborted(signal);
      const start = Number(range?.offset ?? 0n);
      const end = range?.length === void 0 ? bytes.byteLength : start + Number(range.length);
      yield bytes.slice(start, Math.min(bytes.byteLength, end));
    }
  });
}
var NAMESPACE_ENTRY_SOURCE = "common.view/namespace-entry-source";
var CONTAINER_EXTRACT = "container.extract";
var CONTAINER_PACK = "container.pack";
var EXPORT_RAW = "export.raw";
var VIEW_INSPECT = "view.inspect";
var CARRIER_EXTRACT_HANDLER = "x3.host/carrier-container-extract";
var ENTRY_NOT_FOUND = "x3.host/namespace-entry-not-found";
var PAGE_LIMIT = 256;
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function operationHandler(descriptor, id) {
  const operation = descriptor.operations.find((item) => item.id === id && item.state === "available");
  return operation?.handlerId;
}
function normalizePath(path, allowEmpty) {
  if (path.includes("\0") || path.includes("\\") || path.startsWith("/")) {
    throw new ModkitError({
      code: "x3.host/namespace-path-refused",
      message: `container namespace path \xAB${path}\xBB is not a confined POSIX path`,
      context: { path }
    });
  }
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..") || !allowEmpty && parts.length === 0) {
    throw new ModkitError({
      code: "x3.host/namespace-path-refused",
      message: `container namespace path \xAB${path}\xBB escapes or does not name an entry`,
      context: { path }
    });
  }
  return parts.join("/");
}
var sameNamespacePath = (left, right) => left === right || left.toLowerCase() === right.toLowerCase();
var insideNamespacePath = (path, prefix) => sameNamespacePath(path, prefix) || path.toLowerCase().startsWith(`${prefix.toLowerCase()}/`);
function childRef(root, path) {
  const parentIds = Object.freeze([...root.parentIds ?? [], root.id]);
  return Object.freeze({
    id: `${root.id}!/${path}`,
    uri: `container-entry:${encodeURIComponent(root.uri)}!/${path.split("/").map(encodeURIComponent).join("/")}`,
    parentIds
  });
}
function encodeBase64(bytes) {
  let encoded = "";
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = first << 16 | second << 8 | third;
    encoded += BASE64[value >>> 18 & 63];
    encoded += BASE64[value >>> 12 & 63];
    encoded += index + 1 < bytes.byteLength ? BASE64[value >>> 6 & 63] : "=";
    encoded += index + 2 < bytes.byteLength ? BASE64[value & 63] : "=";
  }
  return encoded;
}
function sameRef(left, right) {
  return left.id === right.id && left.uri === right.uri && JSON.stringify(left.parentIds ?? []) === JSON.stringify(right.parentIds ?? []);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mergeInspectionResults(carrier, semantic) {
  if (carrier.state !== "ok" || carrier.output.kind !== "json" || semantic.state !== "ok" || semantic.output.kind !== "json" || !isRecord2(carrier.output.value) || !isRecord2(semantic.output.value)) {
    return semantic;
  }
  return Object.freeze({
    ...semantic,
    output: Object.freeze({
      kind: "json",
      // Carrier facts fill fields the semantic summary does not own. The semantic interpretation
      // remains authoritative on collisions, and the semantic realm never receives carrier data.
      value: Object.freeze({ ...carrier.output.value, ...semantic.output.value })
    }),
    diagnostics: Object.freeze([...carrier.diagnostics, ...semantic.diagnostics])
  });
}
function isNonBlank(value) {
  return typeof value === "string" && value.trim() !== "";
}
function isSourceRef(value) {
  return isRecord2(value) && isNonBlank(value["id"]) && isNonBlank(value["uri"]) && (value["parentIds"] === void 0 || Array.isArray(value["parentIds"]) && value["parentIds"].every(isNonBlank));
}
function isEntryTarget(value) {
  if (!isRecord2(value) || !isSourceRef(value["ownerSource"])) return false;
  const revision = value["expectedRevision"];
  return isNonBlank(value["targetId"]) && isNonBlank(value["subjectUri"]) && value["subjectUri"] === value["ownerSource"].uri && Array.isArray(value["semanticPath"]) && value["semanticPath"].every(isNonBlank) && isRecord2(revision) && isNonBlank(revision["compositionFingerprint"]) && isRecord2(revision["bindings"]) && Object.keys(revision["bindings"]).length > 0 && Object.entries(revision["bindings"]).every(
    ([bindingId, bindingRevision]) => isNonBlank(bindingId) && isNonBlank(bindingRevision)
  ) && (revision["namespaceRevision"] === void 0 || isNonBlank(revision["namespaceRevision"]));
}
function revisionMatches(target, binding) {
  return Object.values(target.expectedRevision.bindings).some(
    (revision) => revision === binding.sourceRevision
  );
}
function invalidEntryPlan(message, context) {
  throw new ModkitError({
    code: "x3.host/container-entry-edit-plan-invalid",
    message,
    ...context === void 0 ? {} : { context }
  });
}
function replacementsFromPlan(plan, bindings, budget) {
  if (!isRecord2(plan) || !Array.isArray(plan.targets) || plan.targets.length === 0 || plan.targets.length > budget.maxNodes || !Array.isArray(plan.edits) || plan.edits.length === 0 || plan.edits.length > budget.maxNodes) {
    return invalidEntryPlan(
      "a composed container edit plan must contain a bounded non-empty edit set"
    );
  }
  const targets = /* @__PURE__ */ new Map();
  for (const target of plan.targets) {
    if (!isEntryTarget(target) || targets.has(target.targetId)) {
      return invalidEntryPlan("container entry edit plan contains a malformed or duplicate target");
    }
    targets.set(target.targetId, target);
  }
  const usedEntries = /* @__PURE__ */ new Set();
  const usedTargets = /* @__PURE__ */ new Set();
  let total = 0n;
  const replacements = Object.freeze(
    plan.edits.map((edit) => {
      if (!isRecord2(edit) || edit.operation !== "replace" || edit.range !== void 0 || !isSourceRef(edit.source) || !isRecord2(edit.payload) || edit.payload.kind !== "inline" || !(edit.payload.bytes instanceof Uint8Array)) {
        return invalidEntryPlan(
          "M4 container composition accepts only full-file inline replacements of issued entries"
        );
      }
      const target = targets.get(edit.targetId);
      const binding = bindings.get(edit.source.id);
      if (target === void 0 || binding === void 0 || !sameRef(edit.source, binding.ref) || !sameRef(target.ownerSource, binding.ref) || !revisionMatches(target, binding)) {
        return invalidEntryPlan(
          "container entry edit does not match an adapter-issued ref/revision",
          {
            targetId: edit.targetId,
            sourceId: edit.source.id
          }
        );
      }
      usedTargets.add(edit.targetId);
      if (usedEntries.has(binding.entryId)) {
        return invalidEntryPlan(`container entry ${binding.entryId} is replaced more than once`);
      }
      usedEntries.add(binding.entryId);
      const length = BigInt(edit.payload.bytes.byteLength);
      if (edit.payload.bytes.byteLength > budget.maxScalarBytes) {
        return invalidEntryPlan("a container entry replacement exceeds maxScalarBytes");
      }
      total += length;
      if (total > budget.maxInputBytes) {
        return invalidEntryPlan("container entry replacements exceed maxInputBytes");
      }
      return Object.freeze({
        entryId: binding.entryId,
        expectedRevision: binding.providerRevision,
        bytesBase64: encodeBase64(edit.payload.bytes)
      });
    })
  );
  if (usedTargets.size !== targets.size) {
    return invalidEntryPlan("container entry edit plan contains an unreferenced target");
  }
  return replacements;
}
function composedOperations(options) {
  const operationByHandler = new Map(
    options.semanticSpec.operations.map((operation) => [operation.handlerId, operation])
  );
  let disposed = false;
  return Object.freeze({
    async invoke(handlerId, input, invokeOptions) {
      if (disposed) {
        return Object.freeze({
          state: "rejected",
          reason: "cancelled",
          diagnostics: Object.freeze([
            Object.freeze({
              code: "x3.host/container-operation-session-disposed",
              severity: "error",
              message: "the composed container operation session has been disposed"
            })
          ])
        });
      }
      throwIfAborted(invokeOptions?.signal);
      if (handlerId === CARRIER_EXTRACT_HANDLER && options.carrierExtractHandlerId !== void 0)
        return options.parent.invoke(options.carrierExtractHandlerId, input, invokeOptions);
      const declaration = operationByHandler.get(handlerId);
      if (declaration?.id === EXPORT_RAW) {
        if (options.exportRawHandlerId === void 0) {
          throw new ModkitError({
            code: "x3.host/container-export-raw-unavailable",
            message: "the retained container session publishes no available export.raw operation"
          });
        }
        return options.parent.invoke(options.exportRawHandlerId, input, invokeOptions);
      }
      const result = await options.semantic.invoke(handlerId, input, invokeOptions);
      throwIfAborted(invokeOptions?.signal);
      if (handlerId === options.semanticInspectHandlerId && options.parentInspectHandlerId !== void 0 && result.state === "ok") {
        const carrier = await options.parent.invoke(
          options.parentInspectHandlerId,
          input,
          invokeOptions
        );
        throwIfAborted(invokeOptions?.signal);
        if (carrier.state !== "ok") return carrier;
        return mergeInspectionResults(carrier, result);
      }
      if (result.state !== "ok" || result.output.kind !== "edit-plan") return result;
      if (declaration === void 0 || !declaration.mutatesSource || !declaration.outputKinds?.includes("edit-plan")) {
        return invalidEntryPlan(
          `handler ${handlerId} returned an edit plan without a declared mutating edit-plan operation`
        );
      }
      if (options.packHandlerId === void 0) {
        throw new ModkitError({
          code: "x3.host/container-pack-unavailable",
          message: "the retained container session publishes no available container.pack operation"
        });
      }
      const replacements = replacementsFromPlan(
        result.output.plan,
        options.bindings,
        options.budget
      );
      const request = Object.freeze({
        schemaVersion: 1,
        expectedContainerRevision: options.parentRevision,
        replacements,
        intent: Object.freeze({
          operation: declaration?.id ?? handlerId,
          input,
          semanticPlanId: result.output.plan.planId
        })
      });
      throwIfAborted(invokeOptions?.signal);
      const packed = await options.parent.invoke(
        options.packHandlerId,
        request,
        invokeOptions
      );
      throwIfAborted(invokeOptions?.signal);
      if (packed.state === "ok" && packed.output.kind !== "edit-plan") {
        throw new ModkitError({
          code: "x3.host/container-pack-result-invalid",
          message: "container.pack must return the outer container as an edit-plan"
        });
      }
      return packed;
    },
    async dispose() {
      disposed = true;
    }
  });
}
async function createContainerNamespaceComposition(options) {
  throwIfAborted(options.signal);
  const descriptor = await options.parent.descriptor();
  throwIfAborted(options.signal);
  const extractHandlerId = operationHandler(descriptor, CONTAINER_EXTRACT);
  if (extractHandlerId === void 0) {
    throw new ModkitError({
      code: "x3.host/container-extract-unavailable",
      message: "a composed container must publish an available container.extract operation"
    });
  }
  if (!descriptor.dataSources.some(
    (item) => item.contract === NAMESPACE_ENTRY_SOURCE && item.major === 1
  )) {
    throw new ModkitError({
      code: "x3.host/container-namespace-unavailable",
      message: `a composed container must publish ${NAMESPACE_ENTRY_SOURCE}@1`
    });
  }
  const namespaceLease = await options.parent.dataSource(NAMESPACE_ENTRY_SOURCE, 1);
  try {
    throwIfAborted(options.signal);
  } catch (error) {
    await namespaceLease.release();
    throw error;
  }
  const namespace = namespaceLease.value;
  const openStoredSource = storedEntrySource(options.parent, descriptor);
  const parentOperations = options.parent.operations();
  const bindings = /* @__PURE__ */ new Map();
  const outstanding = /* @__PURE__ */ new Set();
  let disposed = false;
  let exposedEntries = 0;
  let extractedBytes = 0n;
  const ensureLive = (signal) => {
    throwIfAborted(signal);
    if (disposed) {
      throw new ModkitError({
        code: "x3.host/container-composition-disposed",
        message: "container namespace composition is disposed"
      });
    }
  };
  const validateEntry = (entry) => {
    if (entry === null || typeof entry !== "object" || typeof entry.id !== "string" || entry.id === "" || typeof entry.path !== "string" || typeof entry.name !== "string" || entry.name === "" || typeof entry.revision !== "string" || entry.revision === "" || entry.size !== void 0 && (typeof entry.size !== "bigint" || entry.size < 0n) || entry.kind !== "file" && entry.kind !== "directory") {
      throw new ModkitError({
        code: "x3.host/container-namespace-invalid",
        message: "container namespace returned a malformed entry"
      });
    }
    const normalized = normalizePath(entry.path, false);
    exposedEntries += 1;
    if (exposedEntries > options.budget.maxNodes) {
      throw new ModkitError({
        code: "x3.host/container-namespace-entry-budget-exceeded",
        message: `container namespace exceeded its ${options.budget.maxNodes}-entry budget`
      });
    }
    return normalized === entry.path ? entry : Object.freeze({ ...entry, path: normalized });
  };
  const pages = async function* (prefix, signal) {
    let cursor2;
    const seenCursors = /* @__PURE__ */ new Set();
    do {
      ensureLive(signal);
      if (cursor2 !== void 0) {
        if (seenCursors.has(cursor2)) {
          throw new ModkitError({
            code: "x3.host/container-namespace-cursor-repeated",
            message: "container namespace repeated a paging cursor"
          });
        }
        seenCursors.add(cursor2);
      }
      const page = await namespace.list(
        prefix,
        cursor2 === void 0 ? { limit: PAGE_LIMIT } : { cursor: cursor2, limit: PAGE_LIMIT },
        signal
      );
      ensureLive(signal);
      if (page === null || typeof page !== "object" || !Array.isArray(page.items) || page.items.length > PAGE_LIMIT || page.nextCursor !== void 0 && (typeof page.nextCursor !== "string" || page.nextCursor === "")) {
        throw new ModkitError({
          code: "x3.host/container-namespace-page-invalid",
          message: "container namespace returned a malformed or over-limit page"
        });
      }
      for (const entry of page.items) {
        ensureLive(signal);
        const validated = validateEntry(entry);
        if (prefix !== "" && !insideNamespacePath(validated.path, prefix)) continue;
        yield validated;
      }
      cursor2 = page.nextCursor;
    } while (cursor2 !== void 0);
  };
  const lookup = async (path, signal) => {
    ensureLive(signal);
    for await (const entry of pages(path, signal)) {
      if (sameNamespacePath(entry.path, path)) {
        return entry.kind === "file" ? { kind: "file", entry } : { kind: "directory" };
      }
      return { kind: "directory" };
    }
    const found = await namespace.lookup?.(path, signal);
    ensureLive(signal);
    if (found !== void 0 && found !== null) {
      const validated = validateEntry(found);
      if (sameNamespacePath(validated.path, path) && validated.kind === "file")
        return { kind: "file", entry: validated };
    }
    throw new ModkitError({
      code: ENTRY_NOT_FOUND,
      message: `namespace entry \xAB${path}\xBB does not exist`,
      context: { path }
    });
  };
  const sourceAt = (prefix, ref, revision) => Object.freeze({
    kind: "namespace",
    ref,
    revision,
    async openNamespace(signal) {
      ensureLive(signal);
      const assetNamespace = Object.freeze({
        revision,
        ...prefix === "" && namespace.readPreamble !== void 0 ? {
          async readPreamble(maxBytes, preambleSignal) {
            ensureLive(preambleSignal);
            if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
              throw new ModkitError({
                code: "x3.host/container-preamble-bound-invalid",
                message: "container preamble maxBytes must be a non-negative safe integer"
              });
            }
            const limit = Math.min(maxBytes, options.budget.maxScalarBytes);
            const value = await namespace.readPreamble(limit, preambleSignal);
            ensureLive(preambleSignal);
            if (!(value instanceof Uint8Array) || value.byteLength > limit) {
              throw new ModkitError({
                code: "x3.host/container-preamble-invalid",
                message: "container returned an invalid or over-budget preamble"
              });
            }
            return value;
          }
        } : {},
        async *list(requestedPrefix, listSignal) {
          ensureLive(listSignal);
          const relativePrefix = normalizePath(requestedPrefix, true);
          const absolutePrefix = prefix === "" ? relativePrefix : relativePrefix === "" ? prefix : `${prefix}/${relativePrefix}`;
          const children = /* @__PURE__ */ new Map();
          for await (const entry of pages(absolutePrefix, listSignal)) {
            const suffix = absolutePrefix === "" ? entry.path : sameNamespacePath(entry.path, absolutePrefix) ? "" : entry.path.slice(absolutePrefix.length + 1);
            if (suffix === "") continue;
            const [name] = suffix.split("/");
            if (name === void 0 || name === "") continue;
            const childPath = relativePrefix === "" ? name : `${relativePrefix}/${name}`;
            const nested = suffix.includes("/");
            const value = Object.freeze({
              path: childPath,
              kind: nested ? "directory" : entry.kind,
              ...!nested && entry.kind === "file" && entry.size !== void 0 ? { size: entry.size } : {}
            });
            const prior = children.get(childPath);
            if (prior !== void 0 && prior.kind !== value.kind) {
              throw new ModkitError({
                code: "x3.host/container-namespace-invalid",
                message: `container namespace path \xAB${childPath}\xBB is both a file and a directory`
              });
            }
            children.set(childPath, value);
          }
          for (const child of [...children.values()].sort(
            (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0
          )) {
            ensureLive(listSignal);
            yield child;
          }
        },
        async open(requestedPath, openSignal) {
          ensureLive(openSignal);
          const relativePath = normalizePath(requestedPath, false);
          const absolutePath = prefix === "" ? relativePath : `${prefix}/${relativePath}`;
          const found = await lookup(absolutePath, openSignal);
          const refForEntry = childRef(options.root, absolutePath);
          if (found.kind === "directory") {
            return Object.freeze({
              value: sourceAt(
                absolutePath,
                refForEntry,
                revisionIdFromRef({
                  kind: "provider-token",
                  value: `${String(options.revision)}!directory:${absolutePath}`
                })
              ),
              release: async () => void 0
            });
          }
          const refLease = await namespace.openEntry(found.entry.id, openSignal);
          let released = false;
          const release = async () => {
            if (released) return;
            released = true;
            outstanding.delete(release);
            await refLease.release();
          };
          outstanding.add(release);
          try {
            ensureLive(openSignal);
            if (!sameRef(refLease.value, refForEntry)) {
              if (refLease.value.parentIds === void 0 || !refLease.value.parentIds.includes(options.root.id)) {
                throw new ModkitError({
                  code: "x3.host/container-entry-ref-invalid",
                  message: `container entry \xAB${absolutePath}\xBB is not parented by the outer source`
                });
              }
            }
            const sourceRevision = containerEntryRevision(
              options.revision,
              found.entry.id,
              found.entry.size ?? 0n
            );
            const ref2 = refLease.value;
            const prior = bindings.get(ref2.id);
            if (prior !== void 0 && (prior.entryId !== found.entry.id || prior.providerRevision !== found.entry.revision || prior.sourceRevision !== sourceRevision)) {
              throw new ModkitError({
                code: "x3.host/container-entry-ref-collision",
                message: `container reused entry ref ${ref2.id} for different content`
              });
            }
            bindings.set(
              ref2.id,
              Object.freeze({
                entryId: found.entry.id,
                path: absolutePath,
                ref: ref2,
                providerRevision: found.entry.revision,
                sourceRevision
              })
            );
            let extracted;
            let extraction;
            const ensureEntryLive = (signal2) => {
              ensureLive(signal2);
              if (released) {
                throw new ModkitError({
                  code: "x3.host/container-entry-source-released",
                  message: `container entry source \xAB${absolutePath}\xBB has been released`
                });
              }
            };
            const loadBytes = async (signal2) => {
              ensureEntryLive(signal2);
              if (extracted !== void 0) return extracted;
              if (found.entry.size !== void 0 && found.entry.size > BigInt(options.budget.maxScalarBytes)) {
                throw new ModkitError({
                  code: "x3.host/container-entry-scalar-budget-exceeded",
                  message: `container entry \xAB${absolutePath}\xBB exceeds maxScalarBytes`
                });
              }
              extraction ??= (async () => {
                const invoked = await parentOperations.invoke(
                  extractHandlerId,
                  { entryId: found.entry.id },
                  signal2 === void 0 ? {} : { signal: signal2 }
                );
                if (invoked.state !== "ok" || invoked.output.kind !== "bytes") {
                  throwIfAborted(signal2);
                  throw new ModkitError({
                    code: "x3.host/container-entry-unreadable",
                    message: `container refused to extract entry \xAB${absolutePath}\xBB`
                  });
                }
                const bytes = invoked.output.value;
                if (bytes.byteLength > options.budget.maxScalarBytes) {
                  throw new ModkitError({
                    code: "x3.host/container-entry-scalar-budget-exceeded",
                    message: `container entry \xAB${absolutePath}\xBB exceeds maxScalarBytes`
                  });
                }
                if (found.entry.size !== void 0 && found.entry.size !== BigInt(bytes.byteLength)) {
                  throw new ModkitError({
                    code: "x3.host/container-entry-size-mismatch",
                    message: `container extracted ${bytes.byteLength} bytes for entry \xAB${absolutePath}\xBB, expected ${found.entry.size}`
                  });
                }
                const total = extractedBytes + BigInt(bytes.byteLength);
                if (total > options.budget.maxInputBytes) {
                  throw new ModkitError({
                    code: "x3.host/container-entry-byte-budget-exceeded",
                    message: "container composition exceeded maxInputBytes while extracting entries"
                  });
                }
                extractedBytes = total;
                extracted = bytes.slice();
                return extracted;
              })();
              try {
                const bytes = await extraction;
                ensureEntryLive(signal2);
                return bytes;
              } catch (error) {
                if (extracted === void 0) extraction = void 0;
                throw error;
              }
            };
            const byteSource = Object.freeze({
              kind: "bytes",
              ref: ref2,
              revision: sourceRevision,
              ...found.entry.size === void 0 ? {} : { size: found.entry.size },
              async read(offset, length, signal2) {
                const bytes = await loadBytes(signal2);
                return containerEntrySource(ref2, sourceRevision, bytes).read(
                  offset,
                  length,
                  signal2
                );
              },
              async *stream(range, signal2) {
                const bytes = await loadBytes(signal2);
                yield* containerEntrySource(ref2, sourceRevision, bytes).stream(range, signal2);
              }
            });
            return Object.freeze({
              value: byteSource,
              release
            });
          } catch (error) {
            await release();
            throw error;
          }
        }
      });
      return Object.freeze({ value: assetNamespace, release: async () => void 0 });
    }
  });
  const source = sourceAt("", options.root, options.revision);
  const packHandlerId = operationHandler(descriptor, CONTAINER_PACK);
  const exportRawHandlerId = operationHandler(descriptor, EXPORT_RAW);
  const composition = Object.freeze({
    source,
    descriptor,
    openResources(request) {
      const requestedBytes = request.limits?.maxBytes ?? options.budget.maxInputBytes;
      const maxSourceBytes = requestedBytes < BigInt(options.budget.maxScalarBytes) ? requestedBytes : BigInt(options.budget.maxScalarBytes);
      return createResourceSession({
        ...request,
        origin: createNamespaceCompanionOrigin({
          namespace,
          primaryLogicalId: "",
          containerRevision: options.revision,
          maxPages: options.budget.maxNodes,
          maxSourceBytes,
          ...openStoredSource === void 0 ? {} : { openStoredSource },
          async extract(entryId, signal) {
            ensureLive(signal);
            const result = await parentOperations.invoke(
              extractHandlerId,
              { entryId },
              signal === void 0 ? {} : { signal }
            );
            ensureLive(signal);
            if (result.state !== "ok" || result.output.kind !== "bytes")
              throw new ModkitError({
                code: "x3.host/container-entry-unreadable",
                message: `container refused to extract entry \xAB${entryId}\xBB`
              });
            return result.output.value;
          }
        })
      });
    },
    ...packHandlerId === void 0 ? {} : { packHandlerId },
    ...exportRawHandlerId === void 0 ? {} : { exportRawHandlerId },
    wrapSession(semantic, semanticDescriptor, semanticSpec, parent) {
      let sessionDisposed = false;
      const dispose = async () => {
        if (sessionDisposed) return;
        sessionDisposed = true;
        let firstError;
        try {
          await semantic.dispose();
        } catch (error) {
          firstError = error;
        }
        try {
          await composition.dispose();
        } catch (error) {
          firstError ??= error;
        }
        try {
          await parent.dispose();
        } catch (error) {
          firstError ??= error;
        }
        if (firstError !== void 0) throw firstError;
      };
      const parentInspectHandlerId = operationHandler(descriptor, VIEW_INSPECT);
      const semanticInspectHandlerId = operationHandler(semanticDescriptor, VIEW_INSPECT);
      const namespaceOf = (item) => item.dataSources.some(
        (entry) => entry.contract === NAMESPACE_ENTRY_SOURCE && entry.major === 1
      );
      const carrierExtract = descriptor.operations.find(
        (item) => item.id === CONTAINER_EXTRACT && item.state === "available"
      );
      const lendsNamespace = !namespaceOf(semanticDescriptor) && namespaceOf(descriptor) && carrierExtract !== void 0;
      const lend = (item) => !lendsNamespace || namespaceOf(item) ? item : Object.freeze({
        ...item,
        dataSources: Object.freeze([
          ...item.dataSources,
          Object.freeze({ contract: NAMESPACE_ENTRY_SOURCE, major: 1 })
        ]),
        operations: Object.freeze([
          ...item.operations.filter((operation) => operation.id !== CONTAINER_EXTRACT),
          Object.freeze({ ...carrierExtract, handlerId: CARRIER_EXTRACT_HANDLER })
        ])
      });
      const operations = composedOperations({
        semantic: semantic.operations(),
        semanticSpec,
        parent: parent.operations(),
        parentRevision: parent.revision,
        bindings,
        budget: options.budget,
        ...packHandlerId === void 0 ? {} : { packHandlerId },
        ...exportRawHandlerId === void 0 ? {} : { exportRawHandlerId },
        ...parentInspectHandlerId === void 0 ? {} : { parentInspectHandlerId },
        ...semanticInspectHandlerId === void 0 ? {} : { semanticInspectHandlerId },
        ...lendsNamespace ? { carrierExtractHandlerId: carrierExtract.handlerId } : {}
      });
      return Object.freeze({
        revision: semantic.revision,
        state: () => semantic.state(),
        descriptor: async () => lend(await semantic.descriptor()),
        dataSource: ((contract, major) => lendsNamespace && contract === NAMESPACE_ENTRY_SOURCE && major === 1 ? parent.dataSource(NAMESPACE_ENTRY_SOURCE, 1) : semantic.dataSource(contract, major)),
        operations: () => operations,
        events: (signal) => semantic.events(signal),
        dispose
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      let firstError;
      for (const release of [...outstanding].reverse()) {
        try {
          await release();
        } catch (error) {
          firstError ??= error;
        }
      }
      try {
        await namespaceLease.release();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError !== void 0) throw firstError;
    }
  });
  return composition;
}
function modelProjectionKey(opened, source, sourceKey, logicalId) {
  const descriptor = opened.descriptor;
  if (descriptor.interpretation !== "codec") return void 0;
  const bindings = descriptor.origin.kind === "bundle" ? descriptor.origin.bindings : descriptor.origin.kind === "single" ? [descriptor.origin.binding] : [];
  const receipt = descriptor.metadata.find((group) => group.id === "uv-projection-receipt")?.entries.find((entry) => entry.key === "receipt")?.value;
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt) || !("confidence" in receipt) || !["partial", "high", "exact"].includes(String(receipt["confidence"])) || receipt["subjectRevision"] !== descriptor.revision || !Array.isArray(receipt["companions"]) || receipt["companions"].some(
    (companion) => companion === null || typeof companion !== "object" || Array.isArray(companion) || companion["state"] === "bound" && typeof companion["revision"] !== "string" && !bindings.some(
      (binding) => binding.id === companion["bindingId"] && typeof binding.revision === "string"
    ) || companion["state"] === "refused"
  ) || !Array.isArray(receipt["evidence"]) || !opened.detectionSelectionText || !opened.lockText)
    return void 0;
  return canonicalJsonStringify([
    sourceKey,
    source.ref,
    source.revision,
    logicalId,
    descriptor.origin,
    receipt,
    opened.detectionSelectionText,
    opened.lockText
  ]);
}
function waitForProjection(done, signal) {
  signal?.throwIfAborted();
  if (signal === void 0) return done;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void done.then(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
  });
}
function createModelProjectionCache(state, maxScalarBytes) {
  const maxBytes = Math.min(64 * 1024 * 1024, Math.floor(maxScalarBytes / 8));
  const entries = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Map();
  let retainedBytes = 0;
  let pendingBytes = 0;
  let generation = 0;
  const cost = (key2, bytes) => key2.length * 2 + bytes.byteLength;
  const evictOne = () => {
    const first = entries.entries().next().value;
    if (first === void 0) return false;
    entries.delete(first[0]);
    const bytes = cost(first[0], first[1]);
    retainedBytes -= bytes;
    state.reservedBytes -= bytes;
    return true;
  };
  return {
    get retainedBytes() {
      return retainedBytes;
    },
    trimForReservation(bytes) {
      while (state.reservedBytes + bytes > maxScalarBytes && evictOne()) {
      }
    },
    clear() {
      generation++;
      state.reservedBytes -= pendingBytes;
      pendingBytes = 0;
      for (const flight of pending.values()) flight.wake();
      pending.clear();
      while (evictOne()) {
      }
    },
    async claim(key2, signal) {
      let waited = false;
      const claimGeneration = generation;
      while (key2 !== void 0) {
        signal?.throwIfAborted();
        if (generation !== claimGeneration) break;
        const bytes = entries.get(key2);
        if (bytes !== void 0) {
          entries.delete(key2);
          entries.set(key2, bytes);
          return { state: waited ? "shared-hit" : "hit", bytes };
        }
        const flight = pending.get(key2);
        if (flight !== void 0) {
          waited = true;
          await waitForProjection(flight.done, signal);
          continue;
        }
        const keyBytes = key2.length * 2;
        if (keyBytes >= maxBytes || pending.size >= 256 || pendingBytes + keyBytes > maxBytes) break;
        while ((state.reservedBytes + keyBytes > maxScalarBytes || retainedBytes + pendingBytes + keyBytes > maxBytes || entries.size + pending.size >= 256) && evictOne()) {
        }
        if (state.reservedBytes + keyBytes > maxScalarBytes) break;
        const epoch = generation;
        let wake;
        const done = new Promise((resolve) => {
          wake = resolve;
        });
        pending.set(key2, { done, wake });
        pendingBytes += keyBytes;
        state.reservedBytes += keyBytes;
        let finished = false;
        return {
          state: "miss",
          finish(bytes2) {
            if (finished) return;
            finished = true;
            if (epoch === generation) {
              pending.delete(key2);
              pendingBytes -= keyBytes;
              state.reservedBytes -= keyBytes;
              if (bytes2 !== void 0 && cost(key2, bytes2) <= maxBytes) {
                const charge = cost(key2, bytes2);
                while ((retainedBytes + pendingBytes + charge > maxBytes || entries.size + pending.size >= 256 || state.reservedBytes + charge > maxScalarBytes) && evictOne()) {
                }
                if (state.reservedBytes + charge <= maxScalarBytes && retainedBytes + pendingBytes + charge <= maxBytes) {
                  entries.set(key2, bytes2);
                  retainedBytes += charge;
                  state.reservedBytes += charge;
                }
              }
            }
            wake();
          }
        };
      }
      return { state: "bypass" };
    }
  };
}
function uvmArtifactSource(source, bytes, conversionKey) {
  const owned = bytes;
  const size = BigInt(owned.byteLength);
  const range = (offset, length) => {
    if (offset < 0n || length < 0n || offset > size) {
      throw new RangeError("UVM artifact reads require a non-negative range inside the source");
    }
    const end = offset + length;
    return owned.slice(Number(offset), Number(end > size ? size : end));
  };
  return Object.freeze({
    kind: "bytes",
    ref: Object.freeze({
      id: `${source.ref.id}#model.export-uvm`,
      uri: `memory+uvm:${encodeURIComponent(source.ref.uri)}`
    }),
    revision: revisionIdFromRef({
      kind: "provider-token",
      value: conversionKey
    }),
    size,
    async read(offset, length, signal) {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new RangeError("UVM artifact read length must be a non-negative safe integer");
      }
      return range(offset, BigInt(length));
    },
    async *stream(requested, signal) {
      signal?.throwIfAborted();
      const offset = requested?.offset ?? 0n;
      const length = requested?.length ?? size - offset;
      yield range(offset, length);
    }
  });
}
function createSubjectModelResources(options) {
  const projections = createModelProjectionCache(options.state, options.budget.maxScalarBytes);
  let projectionResources = options.state.resources;
  let closed = false;
  const outstanding = /* @__PURE__ */ new Set();
  const reservationWaiters = /* @__PURE__ */ new Set();
  let reservedByModels = 0;
  const wakeReservationWaiters = () => {
    for (const wake of [...reservationWaiters]) wake();
  };
  const reserve = async (maxBytes, signal) => {
    if (maxBytes > options.budget.maxScalarBytes) return false;
    projections.trimForReservation(maxBytes);
    while (options.state.reservedBytes + maxBytes > options.budget.maxScalarBytes) {
      signal?.throwIfAborted();
      if (!available() || reservedByModels === 0) return false;
      await new Promise((resolve) => {
        const wake = () => {
          reservationWaiters.delete(wake);
          signal?.removeEventListener("abort", wake);
          resolve();
        };
        reservationWaiters.add(wake);
        signal?.addEventListener("abort", wake, { once: true });
      });
      projections.trimForReservation(maxBytes);
    }
    signal?.throwIfAborted();
    if (!available()) return false;
    options.state.reservedBytes += maxBytes;
    reservedByModels += maxBytes;
    return true;
  };
  options.own(async () => {
    closed = true;
    projections.clear();
    wakeReservationWaiters();
    const results = await Promise.allSettled([...outstanding].map((release) => release()));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  });
  const available = () => !closed && options.state.live && options.isAuthorized();
  const refuse2 = (message, code = "x3.host/model-resource-unavailable", data) => ({
    value: {
      result: {
        state: "unresolved",
        diagnostics: [diagnostic("warning", code, message, void 0, data)]
      },
      async acquire() {
        throw new TypeError("model resource is unavailable");
      },
      async readRaster() {
        throw new TypeError("model resource is unavailable");
      }
    },
    async release() {
      return void 0;
    }
  });
  return {
    async acquire(request, signal) {
      signal?.throwIfAborted();
      const started = performance.now();
      if (!available()) return refuse2("Model resources require a live read-source subject.");
      if (options.ancestors.length >= Math.min(8, options.budget.maxDepth))
        return refuse2("Nested models exceed the depth limit.");
      const maxBytes = request?.maxBytes, units = request?.metersPerSourceUnit;
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
        return refuse2("Model conversion maxBytes must be a positive safe integer.");
      if (maxBytes > options.budget.maxScalarBytes)
        return refuse2(
          `Model conversion requires ${String(maxBytes)} bytes, exceeding the ${String(options.budget.maxScalarBytes)} byte subject limit.`
        );
      if (units !== void 0 && (!Number.isFinite(units) || units <= 0))
        return refuse2("Model conversion metersPerSourceUnit must be positive and finite.");
      const resources = options.state.resources;
      if (resources === void 0) return refuse2("The subject has no model resource origin.");
      if (resources !== projectionResources) {
        projections.clear();
        projectionResources = resources;
      }
      const reservationStarted = performance.now();
      if (!await reserve(maxBytes, signal))
        return refuse2(
          `Model conversion requires ${String(maxBytes)} bytes with ${String(options.state.reservedBytes)} bytes already reserved, exceeding the ${String(options.budget.maxScalarBytes)} byte subject limit.`
        );
      const releases = [];
      let released = false;
      const profile = {
        state: "unresolved",
        cache: "bypass",
        reserveMs: performance.now() - reservationStarted,
        resolveMs: 0,
        nativeOpenMs: 0,
        projectionWaitMs: 0,
        exportUvmMs: 0,
        reopenUvmMs: 0,
        acquireFacetsMs: 0,
        exportInvocations: 0,
        uvmBytes: 0
      };
      let rootId;
      const timed = async (phase, work) => {
        const start = performance.now();
        try {
          return await work();
        } finally {
          profile[phase] += performance.now() - start;
        }
      };
      let projection2;
      const release = async () => {
        if (released) return;
        released = true;
        outstanding.delete(release);
        let failure2;
        try {
          for (const dispose of releases.reverse()) {
            try {
              await dispose();
            } catch (error) {
              failure2 ??= error;
            }
          }
        } finally {
          options.state.reservedBytes -= maxBytes;
          reservedByModels -= maxBytes;
          wakeReservationWaiters();
        }
        if (failure2 !== void 0) throw failure2;
      };
      try {
        const { name, parameters } = resourceIdParameters(request.requirement.logicalId);
        const parameterised = Object.keys(parameters).length > 0;
        const requirement = parameterised ? { ...request.requirement, logicalId: name } : request.requirement;
        const resolution = await timed("resolveMs", () => resources.resolve(requirement, signal));
        if (resolution.state !== "resolved") {
          await release();
          return refuse2(resolution.diagnostic.message);
        }
        rootId = resolution.provenance.rootId;
        releases.push(() => resolution.lease.release());
        const source = resolution.lease.value;
        if (source.kind !== "bytes") throw new TypeError("model resource needs a byte source");
        const sourceIdentityKey = `${source.ref.id}@${source.revision}`;
        if (options.ancestors.includes(sourceIdentityKey))
          throw new TypeError("model resource cycle");
        if (!available()) throw new TypeError("model resource authority expired");
        const opened = await timed(
          "nativeOpenMs",
          () => options.open(source, resolution.provenance.logicalId, signal)
        );
        if (opened.state !== "opened") {
          const details = [
            ...opened.diagnostics,
            ...opened.candidates.flatMap((candidate) => candidate.diagnostics)
          ].map((item) => `${item.code}: ${item.message}`).join("; ");
          throw new TypeError(
            details.length === 0 ? "no model codec opened the resource" : `no model codec opened the resource (${details})`
          );
        }
        releases.push(() => opened.session.dispose());
        const operation = opened.descriptor.operations.find(
          (item) => item.id === "model.export-uvm" && item.state === "available" && !item.mutatesSource
        );
        if (operation === void 0)
          throw new TypeError("the resource does not publish model.export-uvm");
        const sourceKey = [
          source.ref.id,
          opened.descriptor.revision,
          operation.id,
          operation.handlerId,
          "schemaVersion=1",
          `metersPerSourceUnit=${units === void 0 ? "source-unit" : String(units)}`,
          // each parameter set is a model of its own
          ...parameterised ? [`parameters=${canonicalJsonStringify(parameters)}`] : []
        ].join("|");
        projection2 = await timed(
          "projectionWaitMs",
          () => projections.claim(
            resources === options.state.resources ? modelProjectionKey(opened, source, sourceKey, resolution.provenance.logicalId) : void 0,
            signal
          )
        );
        profile.cache = projection2.state;
        signal?.throwIfAborted();
        if (!available()) throw new TypeError("model resource authority expired");
        let conversionDiagnostics = [];
        let uvmBytes;
        if ("bytes" in projection2) {
          uvmBytes = projection2.bytes;
        } else {
          profile.exportInvocations++;
          const converted = await timed(
            "exportUvmMs",
            () => opened.session.operations().invoke(
              operation.handlerId,
              {
                schemaVersion: 1,
                ...units === void 0 ? {} : { metersPerSourceUnit: units },
                ...parameterised ? { parameters } : {}
              },
              signal === void 0 ? {} : { signal }
            )
          );
          if (converted.state !== "ok" || converted.output.kind !== "bytes" || !(converted.output.value instanceof Uint8Array))
            throw new RangeError("model resource conversion did not return UVM bytes");
          uvmBytes = converted.output.value.slice();
          conversionDiagnostics = converted.diagnostics;
        }
        signal?.throwIfAborted();
        if (!available()) throw new TypeError("model resource authority expired");
        if (uvmBytes.length > maxBytes) {
          await release();
          return refuse2(
            `Model conversion needs ${String(uvmBytes.length)} bytes; ${String(maxBytes)} were requested.`,
            "x3.host/model-resource-too-large",
            { maxBytes, requiredBytes: uvmBytes.length }
          );
        }
        profile.uvmBytes = uvmBytes.byteLength;
        let scene;
        let skeleton;
        let animations;
        let materials;
        let resourceReferences;
        let sockets;
        let sceneDiagnostic;
        let sceneResources = opened.resources;
        try {
          const uvmPath = resolution.provenance.logicalId.replace(/(?:\.[^./]+)?$/u, ".uvm");
          const uvmOpened = await timed(
            "reopenUvmMs",
            () => options.open(uvmArtifactSource(source, uvmBytes, sourceKey), uvmPath, signal)
          );
          if (uvmOpened.state !== "opened") {
            const details = [
              ...uvmOpened.diagnostics,
              ...uvmOpened.candidates.flatMap((candidate) => candidate.diagnostics)
            ].map((item) => `${item.code}: ${item.message}`).join("; ");
            throw new TypeError(
              details.length === 0 ? "the exported UVM could not be reopened by a UVM codec" : `the exported UVM could not be reopened by a UVM codec (${details})`
            );
          }
          releases.push(() => uvmOpened.session.dispose());
          sceneResources = sceneResources ?? uvmOpened.resources;
          const facetsStarted = performance.now();
          try {
            const acquiredScene = await uvmOpened.session.dataSource(
              "common.view/model-scene-source",
              1
            );
            scene = acquiredScene;
            releases.push(() => acquiredScene.release());
            const advertised = new Set(
              (uvmOpened.descriptor.dataSources ?? []).filter((item) => item.major === 1).map((item) => item.contract)
            );
            if (advertised.has("common.view/model-skeleton-source")) {
              skeleton = await uvmOpened.session.dataSource("common.view/model-skeleton-source", 1);
              releases.push(() => skeleton.release());
            }
            if (advertised.has("common.view/model-animation-source")) {
              animations = await uvmOpened.session.dataSource(
                "common.view/model-animation-source",
                1
              );
              releases.push(() => animations.release());
            }
            if (advertised.has("common.view/model-material-source")) {
              materials = await uvmOpened.session.dataSource("common.view/model-material-source", 1);
              releases.push(() => materials.release());
            }
            if (advertised.has("common.view/model-resource-refs-source")) {
              resourceReferences = await uvmOpened.session.dataSource(
                "common.view/model-resource-refs-source",
                1
              );
              releases.push(() => resourceReferences.release());
            }
            if (advertised.has("common.view/model-socket-source")) {
              sockets = await uvmOpened.session.dataSource("common.view/model-socket-source", 1);
              releases.push(() => sockets.release());
            }
          } finally {
            profile.acquireFacetsMs += performance.now() - facetsStarted;
          }
        } catch (error) {
          sceneDiagnostic = diagnostic(
            "warning",
            "x3.host/model-resource-uvm-scene-unavailable",
            error instanceof Error ? `The exported UVM has no renderable scene: ${error.message}` : "The exported UVM has no renderable scene."
          );
        }
        signal?.throwIfAborted();
        if (!available()) throw new TypeError("model resource authority expired");
        const result = {
          state: "converted",
          bytes: uvmBytes.slice(),
          sourceKey,
          diagnostics: [
            ...opened.diagnostics,
            ...conversionDiagnostics,
            ...sceneDiagnostic === void 0 ? [] : [sceneDiagnostic]
          ]
        };
        const childState = {
          live: true,
          reservedBytes: result.bytes.byteLength,
          ...sceneResources === void 0 ? {} : { resources: sceneResources }
        };
        releases.push(async () => {
          childState.live = false;
        });
        const childOptions = {
          ...options,
          state: childState,
          budget: { ...options.budget, maxScalarBytes: maxBytes },
          isAuthorized: () => !released && available(),
          ancestors: [...options.ancestors, sourceIdentityKey],
          own: (dispose) => {
            releases.push(dispose);
          }
        };
        const models = createSubjectModelResources(childOptions);
        const rasters = createSubjectRasterResources({
          ...childOptions,
          open: (bytes, hint, abort) => options.open(bytes, hint.path ?? "", abort)
        });
        outstanding.add(release);
        if (projection2.state === "miss" && sceneDiagnostic === void 0 && conversionDiagnostics.length === 0)
          projection2.finish(uvmBytes);
        profile.state = "converted";
        return {
          value: {
            result,
            acquire: models.acquire,
            readRaster: rasters.read,
            ...scene === void 0 ? {} : {
              sceneInfo: scene.value.info.bind(scene.value),
              nodes: scene.value.nodes.bind(scene.value),
              meshes: scene.value.meshes.bind(scene.value),
              ...scene.value.primitive === void 0 ? {} : { primitive: scene.value.primitive.bind(scene.value) },
              ...skeleton === void 0 ? {} : { skeletonBindings: skeleton.value.bindings.bind(skeleton.value) },
              ...animations === void 0 ? {} : { animationClips: animations.value.clips.bind(animations.value) },
              ...materials === void 0 ? {} : { materials: materials.value.materials.bind(materials.value) },
              ...resourceReferences === void 0 ? {} : {
                resourceReferences: resourceReferences.value.references.bind(
                  resourceReferences.value
                )
              },
              ...sockets === void 0 ? {} : { sockets: sockets.value.sockets.bind(sockets.value) }
            }
          },
          release
        };
      } catch (error) {
        await release();
        if (signal?.aborted) throw error;
        return refuse2(error instanceof Error ? error.message : "Model acquisition failed.");
      } finally {
        if (projection2?.state === "miss") projection2.finish();
        if (signal?.aborted) profile.state = "aborted";
        try {
          options.onProfile?.(
            Object.freeze({
              ...profile,
              totalMs: performance.now() - started,
              cacheRetainedBytes: projections.retainedBytes,
              ...rootId === void 0 ? {} : { rootId }
            })
          );
        } catch {
        }
      }
    }
  };
}
var FACTS = "common.view/subject-facts-source";
var SELECTOR = "common.view/subject-selector-source";
var MODEL_PREVIEW_BYTES = 64 * 1024 * 1024;
var FACET_RECORDS = 4096;
function withModel(facts, port) {
  let shared;
  const acquire = async (signal) => {
    const { model: logicalId, modelMetersPerSourceUnit } = (await facts.summary(signal)).identity;
    if (logicalId === void 0 || logicalId.length === 0) {
      throw new TypeError("this subject names no model");
    }
    const entry = shared ??= {
      users: 0,
      lease: port.acquire({
        requirement: {
          id: "subject-model",
          logicalId,
          role: "sidecar",
          scopes: [
            "sibling-directory",
            "current-mount",
            "enclosing-container",
            "workspace-dependency-layer"
          ]
        },
        maxBytes: MODEL_PREVIEW_BYTES,
        ...modelMetersPerSourceUnit === void 0 ? {} : { metersPerSourceUnit: modelMetersPerSourceUnit }
      })
    };
    entry.users += 1;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      entry.users -= 1;
      if (entry.users > 0) return;
      if (shared === entry) shared = void 0;
      await (await entry.lease).release();
    };
    try {
      const { value: asset } = await entry.lease;
      if (asset.result.state !== "converted") {
        throw new TypeError(
          asset.result.diagnostics.map((item) => item.message).join("; ") || `model ${logicalId} did not resolve`
        );
      }
      return { asset, release };
    } catch (error) {
      if (shared === entry) shared = void 0;
      await release().catch(() => void 0);
      throw error;
    }
  };
  const facet = async (signal, build) => {
    const { asset, release } = await acquire(signal);
    const value = build(asset);
    if (value === void 0) {
      await release();
      throw new TypeError("the converted model does not publish this facet");
    }
    return Object.freeze({ value, release });
  };
  const count = async (read, signal) => {
    let items = 0;
    let cursor2;
    do {
      const page = await read({ limit: 256, ...cursor2 === void 0 ? {} : { cursor: cursor2 } }, signal);
      items += page.items.length;
      cursor2 = page.nextCursor;
    } while (cursor2 !== void 0 && items < FACET_RECORDS);
    return { items, truncated: cursor2 !== void 0 };
  };
  return Object.freeze({
    summary: (signal) => facts.summary(signal),
    groups: (page, signal) => facts.groups(page, signal),
    facts: (groupId, page, signal) => facts.facts(groupId, page, signal),
    relations: (page, signal) => facts.relations(page, signal),
    openModel: (signal) => facet(signal, (asset) => {
      const { sceneInfo, nodes, meshes, primitive } = asset;
      if (sceneInfo === void 0 || nodes === void 0 || meshes === void 0) return void 0;
      return Object.freeze({
        info: sceneInfo,
        nodes,
        meshes,
        ...primitive === void 0 ? {} : { primitive }
      });
    }),
    openModelMaterials: (signal) => facet(signal, (asset) => {
      const materials = asset.materials;
      if (materials === void 0) return void 0;
      return Object.freeze({
        materials,
        info: async (abort) => ({
          materials: (await count(materials, abort)).items
        })
      });
    }),
    openModelResources: (signal) => facet(signal, (asset) => {
      const references = asset.resourceReferences;
      if (references === void 0) return void 0;
      return Object.freeze({
        references,
        info: async (abort) => {
          const counted = await count(references, abort);
          return { references: counted.items, bound: 0, truncated: counted.truncated };
        }
      });
    })
  });
}
function withModelSelector(selector, port) {
  return Object.freeze({
    summary: (signal) => selector.summary(signal),
    subjects: (query, signal) => selector.subjects(query, signal),
    openFacts: async (subjectId, signal) => {
      const lease = await selector.openFacts(subjectId, signal);
      return Object.freeze({ value: withModel(lease.value, port), release: () => lease.release() });
    },
    openCalculations: (subjectId, signal) => selector.openCalculations(subjectId, signal),
    ...selector.editTarget === void 0 ? {} : { editTarget: selector.editTarget.bind(selector) },
    ...selector.isolation === void 0 ? {} : { isolation: selector.isolation.bind(selector) },
    ...selector.isolationPlan === void 0 ? {} : { isolationPlan: selector.isolationPlan.bind(selector) }
  });
}
function subjectModelDataSources(dataSource, port) {
  return (async (contract, major) => {
    const lease = await dataSource(contract, major);
    if (major !== 1 || contract !== FACTS && contract !== SELECTOR) return lease;
    const value = contract === FACTS ? withModel(lease.value, port) : withModelSelector(lease.value, port);
    return Object.freeze({ value, release: () => lease.release() });
  });
}
var DEFAULT_MINIMUM_CONFIDENCE = 0.5;
var DEFAULT_MAX_CANDIDATES = 64;
var WORKER_REFUSAL_CODES = /* @__PURE__ */ new Set([
  "x3.host/artifact-digest-mismatch",
  "x3.host/rpc-deadline-exceeded",
  "x3.host/rpc-peer-exited",
  "x3.host/worker-crashed",
  "x3.host/worker-restart-limit"
]);
function workerRefusals(explanations) {
  return explanations.flatMap(
    (explanation) => explanation.state !== "rejected" ? [] : explanation.diagnostics.filter((item) => WORKER_REFUSAL_CODES.has(item.code)).map((item) => ({
      code: "x3.host/subject-open-worker-refused",
      severity: "error",
      message: `${explanation.contributionId} could not examine this subject in its worker: ${item.message}`,
      data: { contributionId: explanation.contributionId, cause: item.code }
    }))
  );
}
function createReleaseScope() {
  const releases = [];
  let released = false;
  return {
    add(release) {
      if (released) {
        throw new ModkitError({
          code: "x3.host/resource-scope-closed",
          message: "cannot retain a resource after its host scope was released"
        });
      }
      releases.push(release);
    },
    async release() {
      if (released) return;
      released = true;
      let firstError;
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== void 0) throw firstError;
    }
  };
}
async function releaseCandidate(candidate, diagnostics) {
  try {
    await candidate.resources.release();
  } catch (error) {
    diagnostics.push(caughtDiagnostic("cleanup", error));
  }
}
function gatedOperations(session, spec, grant, catalog) {
  const inner = session.operations();
  const required = /* @__PURE__ */ new Map();
  for (const operation of spec.operations) {
    required.set(operation.handlerId, [
      ...operation.requiredPermissions ?? [],
      ...operation.mutatesSource ? ["write-source"] : []
    ]);
  }
  const gated = {
    async invoke(handlerId, input, invokeOptions) {
      const needed = required.get(handlerId) ?? [];
      const validity = grantValidity(grant);
      const missing = needed.filter((item) => !grant.classes.includes(item));
      if (validity.state !== "valid" || missing.length > 0) {
        return {
          state: "rejected",
          reason: "permission-missing",
          diagnostics: [
            diagnostic(
              "error",
              "x3.host/permission-missing",
              validity.state === "valid" ? `operation ${handlerId} requires classes the grant does not hold: ${missing.join(", ")}` : "the grant the codec runs under is not valid",
              [handlerId],
              { missing }
            )
          ]
        };
      }
      const first = await inner.invoke(handlerId, input, invokeOptions);
      const options = input === null || input === void 0 ? {} : input;
      if (catalog === void 0 || typeof options !== "object" || Array.isArray(options) || operationCatalogQueries(first).length === 0) {
        return first;
      }
      try {
        return await answerCatalogQueries({
          run: (entities, round) => round === 0 || entities === void 0 ? Promise.resolve(first) : inner.invoke(
            handlerId,
            { ...options, [DATA_CATALOG_ENTITIES_INPUT]: entities },
            invokeOptions
          ),
          queriesOf: operationCatalogQueries,
          catalogEntities: catalog,
          rounds: OPERATION_CATALOG_ROUNDS,
          ...invokeOptions?.signal === void 0 ? {} : { signal: invokeOptions.signal }
        });
      } catch (error) {
        invokeOptions?.signal?.throwIfAborted();
        return {
          ...first,
          diagnostics: [
            ...first.diagnostics,
            diagnostic(
              "warning",
              "x3.host/subject-catalog-unavailable",
              `the subject's catalog could not answer ${handlerId}: ${error instanceof Error ? error.message : String(error)}`,
              [handlerId]
            )
          ]
        };
      }
    },
    dispose: () => inner.dispose()
  };
  return Object.freeze(gated);
}
var OPERATION_CATALOG_ROUNDS = 4;
function sessionWithResources(session, resources, gating, beforeDispose, models) {
  let disposed = false;
  const operations = gating === void 0 ? void 0 : gatedOperations(session, gating.spec, gating.grant, gating.catalog);
  return Object.freeze({
    revision: session.revision,
    state: () => session.state(),
    descriptor: () => session.descriptor(),
    dataSource: models === void 0 ? session.dataSource.bind(session) : subjectModelDataSources(session.dataSource.bind(session), models),
    operations: () => operations ?? session.operations(),
    events: (signal) => session.events(signal),
    async dispose() {
      if (disposed) return;
      disposed = true;
      beforeDispose?.();
      let firstError;
      try {
        await session.dispose();
      } catch (error) {
        firstError = error;
      }
      try {
        await resources.release();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError !== void 0) throw firstError;
    }
  });
}
function errorDiagnostic(code, message, error) {
  return diagnostic("error", code, message, [], {
    ...error === void 0 ? {} : { error: error instanceof Error ? error.message : String(error) },
    // Typed errors carry JSON context (e.g. descriptor validation findings); dropping it hides the cause.
    ...isModkitError(error) && error.context !== void 0 ? { context: error.context } : {}
  });
}
function caughtDiagnostic(stage, error) {
  const detail = error instanceof Error ? error.message : String(error);
  const typed = isModkitError(error) && error.code !== "x3.host/rpc-foreign-error";
  return errorDiagnostic(
    typed ? error.code : `x3.host/subject-${stage}-failed`,
    typed ? error.message : `subject ${stage} failed closed: ${detail}`,
    error
  );
}
function normalizeTarget(target, grant) {
  return JSON.parse(
    canonicalJsonStringify({
      ...target,
      grantedPermissions: [
        .../* @__PURE__ */ new Set([...target.grantedPermissions ?? [], ...grant.classes])
      ].sort(compareUtf8)
    })
  );
}
function matchesGlob(path, glob) {
  let pattern = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") {
          pattern += "(?:.*/)?";
          index += 2;
        } else {
          pattern += ".*";
          index += 1;
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (character === "?") {
      pattern += "[^/]";
    } else {
      pattern += character?.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&") ?? "";
    }
  }
  return new RegExp(`${pattern}$`, "u").test(path);
}
function matchesSpec(spec, path, mediaType) {
  const uri = /^[a-z][a-z0-9+.-]+:/iu.test(path);
  const normalizedPath = (uri ? path.split(/[?#]/u, 1)[0] ?? "" : path).replaceAll("\\", "/").toLocaleLowerCase();
  const extensionMatch = (spec.match.extensions ?? []).some((extension) => {
    const suffix = extension.toLocaleLowerCase().replace(/^\.+/u, "");
    return normalizedPath.endsWith(`.${suffix}`) || normalizedPath === suffix;
  });
  const mediaMatch = mediaType !== void 0 && (spec.match.mediaTypes ?? []).some((candidate) => candidate === mediaType);
  const pathMatch = (spec.match.pathGlobs ?? []).some(
    (glob) => matchesGlob(normalizedPath, glob.toLocaleLowerCase())
  );
  const declaresMatch = (spec.match.extensions?.length ?? 0) > 0 || (spec.match.mediaTypes?.length ?? 0) > 0 || (spec.match.pathGlobs?.length ?? 0) > 0;
  return declaresMatch && (extensionMatch || mediaMatch || pathMatch);
}
function variantRequestsBeyondProbe(requested, callerGrant) {
  return requested.some(
    (item) => !PROBE_PERMISSION_CLASSES.includes(item) && (callerGrant === void 0 || callerGrant.classes.includes(item))
  );
}
async function readSignatureWindows(options) {
  if (options.source.kind !== "bytes") return void 0;
  const ruleSets = [];
  for (const extension of options.inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest;
      if (!contribution.activationEligible || manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue;
      }
      const signatures = manifest.spec.match.signatures;
      if (signatures !== void 0 && signatures.length > 0) ruleSets.push(signatures);
    }
  }
  const needs = signatureNeeds(ruleSets);
  if (needs.prefix === 0 && needs.suffix === 0) return void 0;
  const size = options.source.size;
  if (size === void 0) return void 0;
  const headLength = Number(size < BigInt(needs.prefix) ? size : BigInt(needs.prefix));
  const head = headLength === 0 ? new Uint8Array(0) : await options.source.read(0n, headLength, options.signal);
  const tailLength = Number(size < BigInt(needs.suffix) ? size : BigInt(needs.suffix));
  const tail = tailLength === 0 ? new Uint8Array(0) : await options.source.read(size - BigInt(tailLength), tailLength, options.signal);
  return { head, tail, size };
}
function runtimeBudget(host, spec) {
  const deadline = host.deadlineMs === void 0 ? spec.budgets.deadlineMs : spec.budgets.deadlineMs === void 0 ? host.deadlineMs : Math.min(host.deadlineMs, spec.budgets.deadlineMs);
  return Object.freeze({
    maxInputBytes: host.maxInputBytes < BigInt(spec.budgets.maxInputBytes) ? host.maxInputBytes : BigInt(spec.budgets.maxInputBytes),
    maxDepth: Math.min(host.maxDepth, spec.budgets.maxDepth),
    maxNodes: Math.min(host.maxNodes, spec.budgets.maxNodes),
    maxScalarBytes: Math.min(host.maxScalarBytes, spec.budgets.maxScalarBytes),
    maxDiagnostics: Math.min(host.maxDiagnostics, spec.budgets.maxDiagnostics),
    ...deadline === void 0 ? {} : { deadlineMs: deadline }
  });
}
function boundedProbeSource(source, plan) {
  let consumed = 0n;
  const maximum = BigInt(plan.maxBytes);
  const ranges = plan.ranges.map((range) => {
    const length = BigInt(range.length);
    if (range.from === "start") return { start: 0n, end: length };
    if (source.size === void 0) {
      throw new ModkitError({
        code: "x3.host/end-relative-probe-requires-size",
        message: "an end-relative probe range requires a sized source"
      });
    }
    return { start: source.size > length ? source.size - length : 0n, end: source.size };
  });
  const authorize = (offset, length) => {
    if (offset < 0n || length < 0n) {
      throw new ModkitError({
        code: "x3.host/probe-range-violation",
        message: "codec requested a negative probe range"
      });
    }
    const end = offset + length;
    if (!ranges.some((range) => offset >= range.start && end <= range.end)) {
      throw new ModkitError({
        code: "x3.host/probe-range-violation",
        message: "codec read outside its declared probe ranges",
        context: { offset: offset.toString(), length: length.toString() }
      });
    }
    if (consumed + length > maximum) {
      throw new ModkitError({
        code: "x3.host/probe-budget-exceeded",
        message: `codec exceeded its declared ${plan.maxBytes}-byte probe budget`
      });
    }
    consumed += length;
  };
  return Object.freeze({
    ...source,
    async read(offset, length, signal) {
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new ModkitError({
          code: "x3.host/probe-range-violation",
          message: "codec requested a non-safe probe length"
        });
      }
      authorize(offset, BigInt(length));
      return source.read(offset, length, signal);
    },
    async *stream(range, signal) {
      if (range?.length === void 0) {
        throw new ModkitError({
          code: "x3.host/unbounded-probe-stream",
          message: "codec probe streams require an explicit bounded range"
        });
      }
      authorize(range.offset, range.length);
      let received = 0n;
      for await (const chunk of source.stream(range, signal)) {
        received += BigInt(chunk.byteLength);
        if (received > range.length) {
          throw new ModkitError({
            code: "x3.host/probe-stream-overrun",
            message: "probe source returned more bytes than the requested range"
          });
        }
        yield chunk;
      }
    }
  });
}
var NAMESPACE_PATH_ENCODER = new TextEncoder();
function normalizeNamespaceProbePath(path, plan) {
  if (path.includes("\0")) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-path-refused",
      message: "namespace probe paths may not contain NUL bytes",
      context: { path }
    });
  }
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      throw new ModkitError({
        code: "x3.host/namespace-probe-path-refused",
        message: "namespace probe paths may not escape their subject root",
        context: { path }
      });
    }
    parts.push(part);
  }
  const normalized = parts.join("/");
  const pathBytes = NAMESPACE_PATH_ENCODER.encode(normalized).byteLength;
  if (normalized === "" || parts.length > plan.maxDepth || pathBytes > plan.maxPathBytes) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-path-budget-exceeded",
      message: "namespace probe marker exceeds its declared path budget",
      context: {
        path,
        depth: parts.length,
        maxDepth: plan.maxDepth,
        pathBytes,
        maxPathBytes: plan.maxPathBytes
      }
    });
  }
  return normalized;
}
function boundedNamespaceProbeSource(source, plan) {
  if (plan.markers.length > plan.maxEntries) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-entry-budget-exceeded",
      message: "namespace probe declares more markers than its entry budget permits",
      context: { markers: plan.markers.length, maxEntries: plan.maxEntries }
    });
  }
  const markers = new Set(plan.markers.map((path) => normalizeNamespaceProbePath(path, plan)));
  if (markers.size !== plan.markers.length) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-marker-duplicate",
      message: "namespace probe marker paths must be unique after normalization"
    });
  }
  const prefixes = new Set(
    (plan.prefixes ?? []).map((path) => normalizeNamespaceProbePath(path, plan))
  );
  if (prefixes.size !== (plan.prefixes?.length ?? 0)) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-prefix-duplicate",
      message: "namespace probe prefixes must be unique after normalization"
    });
  }
  let consumedEntries = 0;
  let consumedBytes = 0n;
  const maximumBytes = BigInt(plan.maxBytes);
  const consume = (length) => {
    if (length < 0n || consumedBytes + length > maximumBytes) {
      throw new ModkitError({
        code: "x3.host/namespace-probe-byte-budget-exceeded",
        message: `namespace probe exceeded its declared ${plan.maxBytes}-byte budget`,
        context: { consumedBytes: String(consumedBytes), requestedBytes: String(length) }
      });
    }
    consumedBytes += length;
  };
  const guardMarkerSource = (marker, value) => {
    if (value.kind === "namespace") {
      return Object.freeze({
        ...value,
        async openNamespace() {
          throw new ModkitError({
            code: "x3.host/namespace-probe-traversal-refused",
            message: `namespace probe marker \xAB${marker}\xBB is opaque; traversal is forbidden`,
            context: { marker }
          });
        }
      });
    }
    return Object.freeze({
      ...value,
      async read(offset, length, signal) {
        if (!Number.isSafeInteger(length) || length < 0) {
          throw new ModkitError({
            code: "x3.host/namespace-probe-range-refused",
            message: "namespace probe marker reads require a non-negative safe length",
            context: { marker, offset: String(offset), length }
          });
        }
        consume(BigInt(length));
        return value.read(offset, length, signal);
      },
      async *stream(range, signal) {
        if (range?.length === void 0) {
          throw new ModkitError({
            code: "x3.host/namespace-probe-unbounded-stream-refused",
            message: "namespace probe marker streams require an explicit length",
            context: { marker }
          });
        }
        consume(range.length);
        yield* value.stream(range, signal);
      }
    });
  };
  return Object.freeze({
    ...source,
    async openNamespace(signal) {
      const lease = await source.openNamespace(signal);
      const guarded = Object.freeze({
        revision: lease.value.revision,
        async *list(prefix, listSignal) {
          throwIfAborted(listSignal);
          if (prefixes.size === 0) {
            throw new ModkitError({
              code: "x3.host/namespace-probe-traversal-refused",
              message: "namespace enumeration is forbidden unless the codec declares probe prefixes"
            });
          }
          const normalized = normalizeNamespaceProbePath(prefix, plan);
          if (!prefixes.has(normalized)) {
            throw new ModkitError({
              code: "x3.host/namespace-probe-prefix-refused",
              message: `codec attempted to enumerate undeclared namespace prefix \xAB${normalized}\xBB`,
              context: { prefix: normalized, prefixes: [...prefixes] }
            });
          }
          for await (const entry of lease.value.list(normalized, listSignal)) {
            throwIfAborted(listSignal);
            const entryPath = normalizeNamespaceProbePath(entry.path, plan);
            if (entryPath !== normalized && !entryPath.startsWith(`${normalized}/`)) {
              throw new ModkitError({
                code: "x3.host/namespace-probe-prefix-escape",
                message: `namespace probe entry \xAB${entryPath}\xBB escaped prefix \xAB${normalized}\xBB`,
                context: { prefix: normalized, path: entryPath }
              });
            }
            consumedEntries += 1;
            if (consumedEntries > plan.maxEntries) {
              throw new ModkitError({
                code: "x3.host/namespace-probe-entry-budget-exceeded",
                message: `namespace probe exceeded its declared ${plan.maxEntries}-entry budget`
              });
            }
            yield Object.freeze({ ...entry, path: entryPath });
          }
        },
        async open(path, openSignal) {
          const normalized = normalizeNamespaceProbePath(path, plan);
          if (!markers.has(normalized)) {
            throw new ModkitError({
              code: "x3.host/namespace-probe-path-refused",
              message: `codec attempted to inspect undeclared namespace marker \xAB${normalized}\xBB`,
              context: { path: normalized, markers: [...markers] }
            });
          }
          consumedEntries += 1;
          if (consumedEntries > plan.maxEntries) {
            throw new ModkitError({
              code: "x3.host/namespace-probe-entry-budget-exceeded",
              message: `namespace probe exceeded its declared ${plan.maxEntries}-entry budget`
            });
          }
          const opened = await lease.value.open(normalized, openSignal);
          return Object.freeze({
            value: guardMarkerSource(normalized, opened.value),
            release: () => opened.release()
          });
        }
      });
      return Object.freeze({ value: guarded, release: () => lease.release() });
    }
  });
}
async function probeCodec(codec, source, probe, signal) {
  if (source.kind === "bytes" && probe.kind === "bytes") {
    return codec.probe({ source: boundedProbeSource(source, probe), plan: probe }, signal);
  }
  if (source.kind === "namespace" && probe.kind === "namespace") {
    return codec.probe({ source: boundedNamespaceProbeSource(source, probe), plan: probe }, signal);
  }
  throw new ModkitError({
    code: "x3.host/probe-topology-mismatch",
    message: `codec probe ${probe.kind} cannot inspect a ${source.kind} subject`
  });
}
function snapshotDetection(value, contributionId2) {
  const owned = JSON.parse(canonicalJsonStringify(value));
  if (owned.codecId !== contributionId2 || typeof owned.confidence !== "number" || !Number.isFinite(owned.confidence) || owned.confidence < 0 || owned.confidence > 1 || !Array.isArray(owned.evidence) || !Array.isArray(owned.requiredRanges)) {
    throw new ModkitError({
      code: "x3.host/invalid-detection-result",
      message: `codec ${contributionId2} returned a malformed or mismatched detection result`
    });
  }
  return Object.freeze(owned);
}
function snapshotPlan(value) {
  return Object.freeze(JSON.parse(canonicalJsonStringify(value)));
}
function defaultResolveInput(context) {
  const plan = context.plan;
  if (plan.originKind === "namespace" && plan.requirements.length === 0) {
    if (context.source.kind !== "namespace") {
      throw new ModkitError({
        code: "x3.host/input-topology-mismatch",
        message: "a namespace input plan requires a namespace subject source"
      });
    }
    const source2 = context.source;
    const compositionFingerprint2 = canonicalJsonStringify({
      topology: "namespace",
      root: source2.ref,
      revision: source2.revision
    });
    return Object.freeze({
      originKind: "namespace",
      root: source2.ref,
      bindings: Object.freeze([]),
      revisions: Object.freeze({
        topology: "namespace",
        revision: source2.revision,
        namespaceRevision: source2.revision,
        bindings: Object.freeze([]),
        compositionFingerprint: compositionFingerprint2
      }),
      bindingsFor: () => Object.freeze([]),
      async openBinding(bindingId) {
        throw new ModkitError({
          code: "x3.host/unknown-asset-input-binding",
          message: `namespace asset input has no binding ${bindingId}`
        });
      },
      async openNamespace(signal) {
        throwIfAborted(signal);
        return source2.openNamespace(signal);
      }
    });
  }
  const loneBundle = plan.originKind === "bundle" && plan.requirements.every((requirement) => !requirement.required);
  if (!loneBundle && (plan.originKind !== "single" || plan.requirements.length !== 0)) {
    throw new ModkitError({
      code: "x3.host/input-resolver-required",
      message: `the default subject input resolver cannot satisfy ${plan.originKind} topology`
    });
  }
  if (context.source.kind !== "bytes") {
    throw new ModkitError({
      code: "x3.host/input-topology-mismatch",
      message: "a single-file input plan requires a byte subject source"
    });
  }
  const source = context.source;
  const candidate = plan.candidate;
  if (candidate.bindingId.trim().length === 0 || candidate.role.trim().length === 0 || candidate.ownership !== "owned" && candidate.ownership !== "external") {
    throw new ModkitError({
      code: "x3.host/invalid-asset-input-plan",
      message: "codec returned an invalid single-file candidate binding"
    });
  }
  const binding = Object.freeze({
    sourceKind: "candidate",
    bindingId: candidate.bindingId,
    role: candidate.role,
    ownership: candidate.ownership,
    source: source.ref,
    revision: source.revision
  });
  const compositionFingerprint = canonicalJsonStringify({
    topology: "single",
    bindingId: binding.bindingId,
    source: binding.source,
    revision: binding.revision
  });
  return Object.freeze({
    originKind: "single",
    bindings: Object.freeze([binding]),
    primaryBindingId: binding.bindingId,
    revisions: Object.freeze({
      topology: "single",
      revision: source.revision,
      bindings: Object.freeze([
        Object.freeze({ bindingId: binding.bindingId, revision: binding.revision })
      ]),
      compositionFingerprint
    }),
    bindingsFor: () => Object.freeze([]),
    async openBinding(bindingId, signal) {
      throwIfAborted(signal);
      if (bindingId !== binding.bindingId) {
        throw new ModkitError({
          code: "x3.host/unknown-asset-input-binding",
          message: `asset input has no binding ${bindingId}`
        });
      }
      return Object.freeze({ value: source, release: async () => void 0 });
    }
  });
}
function codecModule(module, contributionId2) {
  if (module["abiVersion"] !== 1 || typeof module["createCodec"] !== "function") {
    throw new ModkitError({
      code: "x3.host/invalid-codec-module",
      message: `activated contribution ${contributionId2} does not implement CodecModule ABI v1`
    });
  }
  return module;
}
function assertCodec(value, contributionId2) {
  if (typeof value !== "object" || value === null || typeof value.probe !== "function" || typeof value.open !== "function") {
    throw new ModkitError({
      code: "x3.host/invalid-codec-instance",
      message: `contribution ${contributionId2} returned an invalid codec instance`
    });
  }
  return value;
}
function noServiceResolver() {
  const unavailable = (contract, major) => {
    throw new ModkitError({
      code: "x3.host/service-contract-unregistered",
      message: `service contract ${contract}@${major} is unavailable in this composition`
    });
  };
  return {
    async resolve(request) {
      return unavailable(request.contract, request.major);
    },
    async resolveUnknown(request) {
      return unavailable(request.contract, request.major);
    }
  };
}
function runnableCandidates(options, offers, signatureWindows, suppressed = [], route2 = {}) {
  const candidates = [];
  const path = options.path ?? options.source.ref.uri;
  for (const extension of options.inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest;
      if (manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue;
      }
      if (!contribution.activationEligible) {
        const spec2 = manifest.spec;
        const claimsSource = spec2 !== void 0 && spec2.match !== void 0 && (options.source.kind === "namespace" ? spec2.sourceTopology === "namespace" && spec2.probe?.kind === "namespace" : (
          // a packed file a semantic container alias would have claimed (e.g. an .SC2Map
          // whose codec failed validation) must not open as the bare carrier silently
          (spec2.probe?.kind === "bytes" || spec2.container !== void 0) && matchesSpec(spec2, path, options.mediaType)
        ));
        if (claimsSource) {
          suppressed.push({
            contributionId: manifest.id,
            extensionId: extension.manifest?.id ?? extension.source,
            reasons: contribution.diagnostics.map((item) => item.code)
          });
        }
        continue;
      }
      const spec = manifest.spec;
      if (!spec.openIntents.includes(options.intent)) continue;
      let viaSignature = false;
      if (options.source.kind === "namespace") {
        if (spec.sourceTopology !== "namespace" || spec.probe.kind !== "namespace") continue;
        if (route2.containerAliasFormatId === void 0) {
          if (spec.container !== void 0 && (spec.container.markers?.length ?? 0) === 0) continue;
        } else if (spec.container?.formatId !== route2.containerAliasFormatId || !route2.containerAliasContributionIds?.has(manifest.id)) {
          continue;
        }
      } else {
        if (route2.containerAliasFormatId !== void 0) continue;
        if (route2.containerProviderFormatId !== void 0 && (!spec.roles.includes("container") || !spec.formatRefs.some((item) => item.formatId === route2.containerProviderFormatId) || spec.container !== void 0)) {
          continue;
        }
        if (spec.sourceTopology !== "single" && spec.sourceTopology !== "bundle" || spec.probe.kind !== "bytes") {
          continue;
        }
        const byName = matchesSpec(spec, path, options.mediaType);
        viaSignature = !byName && signatureWindows !== void 0 && matchesSignatures(spec.match.signatures, signatureWindows);
        if (!byName && !viaSignature) continue;
      }
      for (const offer of offers) {
        if (offer.providerId !== manifest.id) continue;
        const logicalOffer = [...offer.provides].sort(
          (left, right) => compareUtf8(canonicalJsonStringify(left), canonicalJsonStringify(right))
        )[0];
        if (logicalOffer === void 0) continue;
        candidates.push({
          contribution,
          extensionId: offer.extensionId,
          contributionId: manifest.id,
          spec,
          offer,
          logicalOffer,
          viaSignature
        });
      }
    }
  }
  return Object.freeze(
    candidates.sort(
      (left, right) => compareUtf8(left.contributionId, right.contributionId) || compareUtf8(left.offer.runtimeVariant, right.offer.runtimeVariant) || compareUtf8(left.logicalOffer.offerId, right.logicalOffer.offerId)
    )
  );
}
async function unresolvedDescriptor(options, detections) {
  if (options.source.kind === "namespace") {
    return assembleSubjectDescriptor({
      schemaVersion: 2,
      subjectUri: options.source.ref.uri,
      origin: {
        kind: "namespace",
        root: options.source.ref,
        revision: options.source.revision
      },
      interpretation: "none",
      candidates: detections,
      traits: [{ id: "container.directories", descriptorVersion: 1, state: "available" }],
      operations: [],
      constraints: {
        readOnly: true,
        seekable: false,
        randomAccess: false,
        trusted: false
      },
      dataSources: [],
      diagnostics: [],
      revision: options.source.revision
    });
  }
  return assembleSubjectDescriptor({
    schemaVersion: 2,
    subjectUri: options.source.ref.uri,
    origin: {
      kind: "single",
      binding: {
        id: "content",
        role: "content",
        source: options.source.ref,
        required: true,
        ownership: "owned",
        revision: options.source.revision,
        ...options.mediaType === void 0 ? {} : { mediaType: options.mediaType }
      }
    },
    interpretation: "none",
    candidates: detections,
    traits: [
      {
        id: "content.binary",
        descriptorVersion: 1,
        state: "available",
        ...options.source.size === void 0 ? {} : { parameters: { bytes: options.source.size.toString(10) } }
      }
    ],
    operations: [],
    constraints: {
      readOnly: true,
      seekable: true,
      randomAccess: true,
      trusted: false,
      ...options.source.size === void 0 ? {} : { maxDecodedBytes: options.source.size.toString(10) }
    },
    dataSources: [{ contract: "common.view/byte-range-source", major: 1 }],
    diagnostics: [],
    revision: options.source.revision
  });
}
async function textFallbackAvailable(source, signal) {
  if (source.kind !== "bytes") return false;
  if (source.size === void 0) return false;
  const length = Number(source.size > 65536n ? 65536n : source.size);
  try {
    const bytes = await source.read(0n, length, signal);
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
async function unresolvedFallback(source, signal) {
  if (source.kind === "namespace") {
    return Object.freeze({ preferred: "none", available: Object.freeze([]) });
  }
  const text = await textFallbackAvailable(source, signal);
  return Object.freeze({
    preferred: text ? "text" : "hex",
    available: Object.freeze(text ? ["text", "hex"] : ["hex"])
  });
}
async function openSubjectDirect(options, route2 = {}) {
  const catalog = options.subjectCatalog === void 0 ? void 0 : subjectCatalogEntities(options.subjectCatalog, async () => options.source.ref.uri);
  try {
    const result = await openSubjectDirectWith(options, route2, catalog);
    if (result.state !== "opened") await catalog?.release();
    return result;
  } catch (error) {
    await catalog?.release();
    throw error;
  }
}
async function openSubjectDirectWith(options, route2, catalog) {
  throwIfAborted(options.signal);
  const minimumConfidence = options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1 || !Number.isSafeInteger(maxCandidates) || maxCandidates <= 0) {
    throw new ModkitError({
      code: "x3.host/invalid-subject-open-policy",
      message: "subject-open confidence and candidate limits are invalid"
    });
  }
  const diagnostics = [];
  const explanations = [];
  const detected = [];
  const offers = offersFromInventory(options.inventory);
  const executionBackends = options.executionBackends ?? DEFAULT_EXECUTION_BACKENDS;
  const signatureWindows = await readSignatureWindows(options);
  const suppressed = [];
  const candidates = runnableCandidates(options, offers, signatureWindows, suppressed, route2);
  for (const item of suppressed) {
    const switchedOff = item.reasons.every(
      (code) => code === "x3.host/contribution-disabled" || code === "x3.host/extension-disabled"
    );
    diagnostics.push(
      diagnostic(
        switchedOff ? "information" : "warning",
        "x3.host/candidate-suppressed",
        `\xAB${item.contributionId}\xBB matches this file but cannot run${item.reasons.length === 0 ? "" : `: ${[...new Set(item.reasons)].join(", ")}`}`,
        [item.extensionId, item.contributionId]
      )
    );
  }
  if (candidates.length > maxCandidates) {
    diagnostics.push(
      errorDiagnostic(
        "x3.host/subject-candidate-limit",
        `subject matched ${candidates.length} codecs, exceeding the host limit ${maxCandidates}`
      )
    );
  } else {
    const target = normalizeTarget(options.target, options.grant);
    for (const candidate of candidates) {
      const local = [];
      const resources = createReleaseScope();
      const privateRecord = inventoryRecordFor(candidate.contribution);
      const variant = candidate.contribution.manifest?.runtimeVariants?.find(
        (item) => item.variantId === candidate.offer.runtimeVariant
      );
      if (privateRecord === void 0 || variant === void 0 || !executionBackends.supports(variant.executionProfile, target, variant) || variant.executionProfile === "trusted-in-process" && privateRecord.execution.allowTrustedInProcess !== true) {
        local.push(
          errorDiagnostic(
            "x3.host/codec-execution-unavailable",
            `codec ${candidate.contributionId}#${candidate.offer.runtimeVariant} has no executable boundary in this host`
          )
        );
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          formatIds: Object.freeze(candidate.spec.formatRefs.map((item) => item.formatId)),
          offerId: candidate.logicalOffer.offerId,
          state: "rejected",
          diagnostics: Object.freeze(local)
        });
        continue;
      }
      const runsInTarget = (candidate.contribution.manifest?.runtimeVariants ?? []).some(
        (item) => item.target.environments === void 0 || item.target.environments.includes(target.environment)
      );
      const request = {
        contract: {
          contract: candidate.logicalOffer.contract,
          major: candidate.logicalOffer.major,
          range: "*"
        },
        target: runsInTarget ? target : serviceTargetFor(executionBackends, candidate.offer, target),
        pin: {
          providerId: candidate.offer.providerId,
          runtimeVariant: candidate.offer.runtimeVariant,
          offerId: candidate.logicalOffer.offerId
        }
      };
      if (candidate.viaSignature) {
        local.push({
          code: "x3.host/signature-match",
          severity: "information",
          message: `${candidate.contributionId} matched by its declared byte signature; name/media/path rules did not match this subject`
        });
      }
      const resolved = resolveForActivation(request, offers, PROBE_OPERATION);
      if (resolved.result.state !== "resolved" || resolved.ticket === void 0) {
        local.push(
          errorDiagnostic(
            "x3.host/codec-resolution-unresolved",
            `codec candidate did not resolve: ${resolved.result.state === "resolved" ? "ticket unavailable" : resolved.result.reason}`
          )
        );
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          formatIds: Object.freeze(candidate.spec.formatRefs.map((item) => item.formatId)),
          offerId: candidate.logicalOffer.offerId,
          state: "rejected",
          diagnostics: Object.freeze(local)
        });
        continue;
      }
      const record = {
        resources,
        rasterState: { live: false, reservedBytes: 0 },
        logicalState: {
          live: false,
          reservedBytes: 0,
          resolveCalls: 0,
          discoveryCalls: 0
        },
        nestedLocks: [],
        ...route2.includeSelectionLock ? { selectionLock: buildLockEntry(request, resolved.result) } : {}
      };
      try {
        const activation = await activateContribution({
          ticket: resolved.ticket,
          grant: options.grant,
          executionBackends,
          ...options.policy === void 0 ? {} : { policy: options.policy },
          ...options.signal === void 0 ? {} : { signal: options.signal }
        });
        record.resources.add(activation.release);
        local.push(...activation.diagnostics);
        {
          const requested = candidate.contribution.manifest?.runtimeVariants?.find(
            (item) => item.variantId === candidate.offer.runtimeVariant
          )?.requestedPermissionClasses ?? [];
          const degraded = requested.filter(
            (item) => !PROBE_PERMISSION_CLASSES.includes(item) && !options.grant.classes.includes(item)
          );
          if (degraded.length > 0) {
            local.push(permissionDegradedDiagnostic(candidate.contributionId, degraded));
          }
        }
        const effectiveBudget = runtimeBudget(options.budget, candidate.spec);
        const nestedLocks = record.nestedLocks;
        const makeContext = (grant, chain, contributionId2) => {
          const settings = contributionId2 === void 0 ? void 0 : options.contributionSettings?.(contributionId2);
          const owner = contributionId2 === void 0 ? void 0 : offers.find((offer) => offer.providerId === contributionId2)?.extensionId;
          const credentials = owner === void 0 ? void 0 : options.credentials?.portFor(owner);
          const contracts = options.serviceDefinitions === void 0 ? noServiceResolver() : createContractResolverPort({
            offers,
            definitions: options.serviceDefinitions,
            target,
            targetFor: (offer) => serviceTargetFor(executionBackends, offer, target),
            onResolved(request2, result) {
              nestedLocks.push(buildLockEntry(request2, result));
            },
            async activate(selection, result, signal) {
              const key2 = `${selection.contract}@${selection.major}:${result.selected.offer.providerId}:${selection.offerId}`;
              if (chain.includes(key2)) {
                throw new ModkitError({
                  code: "x3.host/service-dependency-cycle",
                  message: `service activation cycle detected at ${key2}`
                });
              }
              const nested = await activateServiceProvider({
                selection,
                result,
                target,
                grant,
                executionBackends,
                ...options.policy === void 0 ? {} : { policy: options.policy },
                ...signal === void 0 ? {} : { signal },
                diagnostics,
                contextFor: (effectiveGrant) => makeContext(
                  effectiveGrant,
                  [...chain, key2],
                  result.selected.offer.providerId
                )
              });
              record.resources.add(() => nested.release());
              return Object.freeze({
                value: nested.lease.value,
                release: () => nested.release()
              });
            }
          });
          return Object.freeze({
            contracts,
            ...settings === void 0 ? {} : { settings },
            ...options.videoFrames === void 0 ? {} : { videoFrames: options.videoFrames },
            ...options.installationFiles === void 0 ? {} : { installationFiles: options.installationFiles },
            ...catalog === void 0 ? {} : {
              catalog: Object.freeze({ entities: catalog.entities, strings: catalog.strings })
            },
            ...credentials === void 0 ? {} : { credentials },
            ...options.containerContext === void 0 ? {} : { containerContext: options.containerContext },
            logicalResources: createSubjectLogicalResources({
              state: record.logicalState,
              budget: effectiveBudget,
              ...options.logicalResourceDiscovery === void 0 ? {} : { policies: options.logicalResourceDiscovery },
              isAuthorized: () => grantValidity(grant).state === "valid" && grant.classes.includes("read-source")
            }),
            modelResources: createSubjectModelResources({
              state: record.rasterState,
              budget: effectiveBudget,
              isAuthorized: () => grantValidity(grant).state === "valid" && grant.classes.includes("read-source"),
              ancestors: [`${options.source.ref.id}@${options.source.revision}`],
              own: (release) => record.resources.add(release),
              open: (source, path, signal) => openSubject({
                inventory: options.inventory,
                source,
                path,
                target,
                intent: "full",
                grant: { ...grant, classes: ["read-source"] },
                budget: effectiveBudget,
                executionBackends,
                ...record.rasterState.resources === void 0 ? {} : { resourceSession: record.rasterState.resources },
                ...options.videoFrames === void 0 ? {} : { videoFrames: options.videoFrames },
                ...options.credentials === void 0 ? {} : { credentials: options.credentials },
                ...options.resolveInput === void 0 ? {} : { resolveInput: options.resolveInput },
                ...options.serviceDefinitions === void 0 ? {} : { serviceDefinitions: options.serviceDefinitions },
                ...options.policy === void 0 ? {} : { policy: options.policy },
                ...signal === void 0 ? {} : { signal }
              })
            }),
            ...options.provideRasterResources === false ? {} : {
              rasterResources: createSubjectRasterResources({
                state: record.rasterState,
                budget: effectiveBudget,
                isAuthorized: () => grantValidity(grant).state === "valid" && grant.classes.includes("read-source"),
                open: (source, hint, signal) => openSubject({
                  inventory: options.inventory,
                  source,
                  ...hint,
                  ...resourceInputFor(options.resolveInput, hint.path),
                  target,
                  intent: "full",
                  grant: { ...grant, classes: ["read-source"] },
                  budget: effectiveBudget,
                  executionBackends,
                  provideRasterResources: false,
                  ...options.serviceDefinitions === void 0 ? {} : { serviceDefinitions: options.serviceDefinitions },
                  ...options.policy === void 0 ? {} : { policy: options.policy },
                  ...signal === void 0 ? {} : { signal }
                })
              })
            },
            budgets: effectiveBudget,
            diagnostics: {
              report(item) {
                diagnostics.push(item);
              }
            },
            ...options.signal === void 0 ? {} : { signal: options.signal }
          });
        };
        const codec = assertCodec(
          codecModule(activation.module, candidate.contributionId).createCodec(
            makeContext(
              activation.effectiveGrant,
              [candidate.contributionId],
              candidate.contributionId
            )
          ),
          candidate.contributionId
        );
        record.resources.add(() => releaseCodec(codec));
        const detection = snapshotDetection(
          await probeCodec(codec, options.source, candidate.spec.probe, options.signal),
          candidate.contributionId
        );
        detected.push(
          Object.assign(record, {
            ...candidate,
            ticket: resolved.ticket,
            codec,
            detection,
            effectiveBudget,
            effectiveGrant: activation.effectiveGrant,
            activationDiagnostics: Object.freeze(local),
            request,
            makeContext,
            ...record.selectionLock === void 0 ? {} : { selectionLock: record.selectionLock },
            probeScoped: variantRequestsBeyondProbe(
              candidate.contribution.manifest?.runtimeVariants?.find(
                (item) => item.variantId === candidate.offer.runtimeVariant
              )?.requestedPermissionClasses ?? [],
              options.grant
            )
          })
        );
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          formatIds: Object.freeze(candidate.spec.formatRefs.map((item) => item.formatId)),
          offerId: candidate.logicalOffer.offerId,
          state: "detected",
          confidence: detection.confidence,
          diagnostics: Object.freeze(local)
        });
      } catch (error) {
        local.push(caughtDiagnostic("probe", error));
        try {
          await record.resources.release();
        } catch (cleanupError) {
          local.push(caughtDiagnostic("cleanup", cleanupError));
        }
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          formatIds: Object.freeze(candidate.spec.formatRefs.map((item) => item.formatId)),
          offerId: candidate.logicalOffer.offerId,
          state: "rejected",
          diagnostics: Object.freeze(local)
        });
      }
    }
  }
  const eligible = detected.filter((candidate) => candidate.detection.confidence >= minimumConfidence).sort(
    (left, right) => right.detection.confidence - left.detection.confidence || compareUtf8(left.contributionId, right.contributionId) || compareUtf8(left.offer.runtimeVariant, right.offer.runtimeVariant)
  );
  const best = eligible[0];
  const tied = best === void 0 ? [] : eligible.filter((candidate) => candidate.detection.confidence === best.detection.confidence);
  if (best === void 0 || tied.length !== 1) {
    for (const candidate of detected) await releaseCandidate(candidate, diagnostics);
    const descriptor = await unresolvedDescriptor(
      options,
      detected.map((candidate) => candidate.detection)
    );
    return Object.freeze({
      state: "unresolved",
      reason: candidates.length === 0 ? "no-candidate" : best === void 0 ? "no-match" : "ambiguous",
      descriptor,
      fallback: await unresolvedFallback(options.source, options.signal),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze([...diagnostics, ...workerRefusals(explanations)])
    });
  }
  for (const candidate of detected) {
    if (candidate !== best) await releaseCandidate(candidate, diagnostics);
  }
  let openedSession;
  try {
    if (best.probeScoped) {
      const reResolved = resolveForActivation(best.request, offers);
      if (reResolved.result.state !== "resolved" || reResolved.ticket === void 0) {
        throw new ModkitError({
          code: "x3.host/codec-resolution-unresolved",
          message: "the selected codec did not re-resolve for open"
        });
      }
      const openScope = createReleaseScope();
      const probeScope = best.resources;
      try {
        const activation = await activateContribution({
          ticket: reResolved.ticket,
          grant: options.grant,
          executionBackends,
          ...options.policy === void 0 ? {} : { policy: options.policy },
          ...options.signal === void 0 ? {} : { signal: options.signal }
        });
        openScope.add(activation.release);
        best.resources = openScope;
        const reopened = assertCodec(
          codecModule(activation.module, best.contributionId).createCodec(
            best.makeContext(activation.effectiveGrant, [best.contributionId], best.contributionId)
          ),
          best.contributionId
        );
        openScope.add(() => releaseCodec(reopened));
        best.codec = reopened;
        best.ticket = reResolved.ticket;
        best.effectiveGrant = activation.effectiveGrant;
        best.activationDiagnostics = Object.freeze([
          ...best.activationDiagnostics,
          ...activation.diagnostics
        ]);
      } catch (error) {
        best.resources = probeScope;
        try {
          await openScope.release();
        } catch (cleanupError) {
          diagnostics.push(caughtDiagnostic("cleanup", cleanupError));
        }
        throw error;
      }
      try {
        await probeScope.release();
      } catch (cleanupError) {
        diagnostics.push(caughtDiagnostic("cleanup", cleanupError));
      }
    }
    const rawPlan = best.codec.planInput ? await best.codec.planInput(options.source, best.detection, options.signal) : options.source.kind === "namespace" ? { originKind: "namespace", requirements: [] } : {
      originKind: "single",
      candidate: { bindingId: "content", role: "content", ownership: "owned" },
      requirements: []
    };
    const plan = snapshotPlan(rawPlan);
    const companionRule = (role) => {
      const requirement = ("requirements" in plan ? plan.requirements : []).find(
        (item) => item.role === role
      );
      if (requirement === void 0) return void 0;
      const directories = [""];
      const extensions = [];
      for (const pattern of requirement.patterns ?? []) {
        const cut = pattern.replaceAll("\\", "/").lastIndexOf("/");
        const directory = cut <= 0 ? "" : pattern.slice(0, cut);
        if (!directories.includes(directory)) directories.push(directory);
        const extension = /(\.[^.*?/]+)$/u.exec(pattern.slice(cut + 1))?.[1]?.toLowerCase();
        if (extension !== void 0 && !extensions.includes(extension)) extensions.push(extension);
      }
      return Object.freeze({
        scopes: requirement.scopes,
        directories: Object.freeze(directories),
        ...extensions.length === 0 ? {} : { extensions: Object.freeze(extensions) }
      });
    };
    const input = await (options.resolveInput ?? defaultResolveInput)({
      source: options.source,
      plan,
      detection: best.detection,
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    openedSession = await best.codec.open(
      input,
      options.intent,
      best.effectiveBudget,
      options.signal
    );
    const session = openedSession;
    throwIfAborted(options.signal);
    if (session.revision !== options.source.revision) {
      throw new ModkitError({
        code: "x3.host/subject-session-identity-mismatch",
        message: "opened codec session revision does not match the selected source"
      });
    }
    if (session.state() === "disposed" || grantValidity(best.effectiveGrant).state !== "valid") {
      throw new ModkitError({
        code: "x3.host/subject-context-unavailable",
        message: "The opened subject context is no longer live."
      });
    }
    let postOpenResources = best.effectiveGrant.classes.includes(
      "read-source"
    ) ? options.resourceSession : void 0;
    const openResources = route2.openResources ?? options.resolveInput?.openResources;
    if (openResources !== void 0 && best.effectiveGrant.classes.includes("read-source")) {
      const requested = { ...DEFAULT_RESOURCE_SESSION_LIMITS, ...options.resourceLimits };
      const openedResources = openResources({
        revision: session.revision,
        revisionPolicy: "pin",
        isAuthorized: () => grantValidity(best.effectiveGrant).state === "valid" && best.effectiveGrant.classes.includes("read-source"),
        limits: {
          maxResources: Math.min(requested.maxResources, best.effectiveBudget.maxNodes),
          maxBytes: requested.maxBytes < best.effectiveBudget.maxInputBytes ? requested.maxBytes : best.effectiveBudget.maxInputBytes,
          maxDepth: Math.min(requested.maxDepth, best.effectiveBudget.maxDepth),
          maxEntries: Math.min(requested.maxEntries, best.effectiveBudget.maxNodes)
        }
      });
      postOpenResources = openedResources;
      best.resources.add(() => openedResources.dispose());
      best.logicalState.resources = openedResources;
    }
    if (postOpenResources !== void 0) best.logicalState.resources = postOpenResources;
    best.logicalState.live = true;
    best.resources.add(() => {
      best.logicalState.live = false;
    });
    const descriptor = await assembleSubjectDescriptor(
      await session.descriptor()
    );
    throwIfAborted(options.signal);
    if (session.state() === "disposed" || grantValidity(best.effectiveGrant).state !== "valid") {
      throw new ModkitError({
        code: "x3.host/subject-context-unavailable",
        message: "The subject context stopped being live while its descriptor was initialized."
      });
    }
    if (descriptor.interpretation !== "codec" || descriptor.identity.codecId !== best.contributionId || descriptor.subjectUri !== options.source.ref.uri || descriptor.revision !== options.source.revision) {
      throw new ModkitError({
        code: "x3.host/subject-session-identity-mismatch",
        message: "opened codec session does not describe the selected source and codec"
      });
    }
    const selectedExplanation = explanations.find(
      (item) => item.contributionId === best.contributionId && item.variantId === best.offer.runtimeVariant && item.offerId === best.logicalOffer.offerId
    );
    if (selectedExplanation !== void 0) {
      const index = explanations.indexOf(selectedExplanation);
      explanations[index] = Object.freeze({ ...selectedExplanation, state: "selected" });
    }
    const record = inventoryRecordFor(best.contribution)?.publicRecord;
    if (record === void 0) {
      throw new ModkitError({
        code: "x3.host/detection-selection-unattested",
        message: "selected codec has no attested inventory record"
      });
    }
    const detectionSelectionText = serializeCodecDetectionSelection(
      buildCodecDetectionSelection({
        sourceRevision: options.source.revision,
        extensionId: best.extensionId,
        contributionId: best.contributionId,
        variantId: best.offer.runtimeVariant,
        offerId: best.logicalOffer.offerId,
        artifactDigest: record.artifactDigest,
        manifestDigest: record.manifestDigest,
        sourceTopology: best.spec.sourceTopology,
        detection: best.detection
      })
    );
    const lockText = serializePolicyLock([
      ...best.nestedLocks,
      ...best.selectionLock === void 0 ? [] : [best.selectionLock]
    ]);
    const isReadAuthorized = () => grantValidity(best.effectiveGrant).state === "valid" && best.effectiveGrant.classes.includes("read-source");
    const models = options.provideRasterResources === false ? void 0 : createSubjectModelResources({
      state: best.rasterState,
      budget: best.effectiveBudget,
      isAuthorized: isReadAuthorized,
      ancestors: [`${options.source.ref.id}@${options.source.revision}`],
      own: (release) => best.resources.add(release),
      open: (source, path, signal) => openSubject({
        inventory: options.inventory,
        source,
        path,
        target: options.target,
        intent: "full",
        grant: { ...best.effectiveGrant, classes: ["read-source"] },
        budget: best.effectiveBudget,
        executionBackends,
        ...best.rasterState.resources === void 0 ? {} : { resourceSession: best.rasterState.resources },
        ...options.resolveInput === void 0 ? {} : { resolveInput: options.resolveInput },
        ...options.serviceDefinitions === void 0 ? {} : { serviceDefinitions: options.serviceDefinitions },
        ...options.policy === void 0 ? {} : { policy: options.policy },
        ...signal === void 0 ? {} : { signal }
      })
    });
    if (catalog !== void 0) best.resources.add(() => catalog.release());
    const managedSession = sessionWithResources(
      session,
      best.resources,
      {
        spec: best.spec,
        grant: best.effectiveGrant,
        ...catalog === void 0 ? {} : { catalog: catalog.entities }
      },
      () => {
        best.logicalState.live = false;
      },
      models
    );
    if (postOpenResources !== void 0) best.rasterState.resources = postOpenResources;
    best.rasterState.live = true;
    best.resources.add(() => {
      best.rasterState.live = false;
    });
    openedSession = void 0;
    const rasterResources = options.provideRasterResources === false ? void 0 : createSubjectRasterResources({
      state: best.rasterState,
      budget: best.effectiveBudget,
      companionRule,
      isAuthorized: () => grantValidity(best.effectiveGrant).state === "valid" && best.effectiveGrant.classes.includes("read-source"),
      open: (source, hint, signal) => openSubject({
        inventory: options.inventory,
        source,
        ...hint,
        ...resourceInputFor(options.resolveInput, hint.path),
        target: options.target,
        intent: "full",
        grant: { ...best.effectiveGrant, classes: ["read-source"] },
        budget: best.effectiveBudget,
        executionBackends,
        provideRasterResources: false,
        ...options.serviceDefinitions === void 0 ? {} : { serviceDefinitions: options.serviceDefinitions },
        ...options.policy === void 0 ? {} : { policy: options.policy },
        ...signal === void 0 ? {} : { signal }
      })
    });
    return Object.freeze({
      state: "opened",
      session: managedSession,
      ...postOpenResources === void 0 ? {} : { resources: postOpenResources },
      ...rasterResources === void 0 ? {} : { rasterResources },
      descriptor,
      ticket: best.ticket,
      detectionSelectionText,
      lockText,
      selected: Object.freeze({
        extensionId: best.extensionId,
        contributionId: best.contributionId,
        variantId: best.offer.runtimeVariant,
        offerId: best.logicalOffer.offerId,
        confidence: best.detection.confidence
      }),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze([...diagnostics, ...best.activationDiagnostics])
    });
  } catch (error) {
    best.logicalState.live = false;
    if (openedSession !== void 0) {
      try {
        await openedSession.dispose();
      } catch (disposeError) {
        diagnostics.push(caughtDiagnostic("session-dispose", disposeError));
      }
    }
    await releaseCandidate(best, diagnostics);
    diagnostics.push(caughtDiagnostic("input-open", error));
    const descriptor = await unresolvedDescriptor(
      options,
      detected.map((candidate) => candidate.detection)
    );
    return Object.freeze({
      state: "unresolved",
      reason: "input-unresolved",
      descriptor,
      fallback: await unresolvedFallback(options.source, options.signal),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze(diagnostics)
    });
  }
}
function scanContainerAliases(options) {
  const empty = { aliases: Object.freeze([]), skipped: Object.freeze([]) };
  if (options.source.kind !== "bytes") {
    return Object.freeze({ ...empty, aliasShaped: 0, codecs: 0 });
  }
  const path = options.path ?? options.source.ref.uri;
  const aliases = [];
  const skipped = [];
  let aliasShaped = 0;
  let codecs = 0;
  for (const extension of options.inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest;
      if (manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue;
      }
      codecs += 1;
      const spec = manifest.spec;
      if (spec?.container === void 0 || spec.sourceTopology !== "namespace") continue;
      aliasShaped += 1;
      if (!matchesSpec(spec, path, options.mediaType)) continue;
      const entry = {
        contributionId: manifest.id,
        extensionId: extension.manifest?.id ?? extension.source
      };
      if (!contribution.activationEligible) continue;
      if (!spec.openIntents.includes(options.intent)) {
        skipped.push(
          Object.freeze({
            ...entry,
            reason: `open intent \xAB${options.intent}\xBB is not declared (${spec.openIntents.join(", ")})`
          })
        );
        continue;
      }
      aliases.push(Object.freeze({ contributionId: manifest.id, spec }));
    }
  }
  return Object.freeze({
    aliases: Object.freeze(aliases),
    aliasShaped,
    codecs,
    skipped: Object.freeze(skipped)
  });
}
function containerAliasAbsence(scan, options) {
  const path = (options.path ?? options.source.ref.uri).split(/[\\/]/u).at(-1) ?? "";
  const explained = scan.skipped.map(
    (item) => diagnostic(
      "warning",
      "x3.host/container-alias-skipped",
      `\xAB${item.contributionId}\xBB claims \xAB${path}\xBB but did not enter detection: ${item.reason}`,
      [item.extensionId, item.contributionId]
    )
  );
  if (scan.aliasShaped === 0 && options.source.kind === "bytes") {
    explained.push(
      diagnostic(
        "information",
        "x3.host/container-alias-none",
        `no container-alias codec was in the inventory when \xAB${path}\xBB was opened`,
        [path],
        { codecContributions: scan.codecs, extensions: options.inventory.extensions.length }
      )
    );
  }
  return Object.freeze(explained);
}
function carrierShaped(result) {
  if (result.state !== "opened") return true;
  const descriptor = result.descriptor;
  return (descriptor.traits ?? []).some(
    (trait) => typeof trait.id === "string" && trait.id.startsWith("container.")
  ) || (descriptor.dataSources ?? []).some(
    (source) => source.contract === "common.view/namespace-entry-source"
  );
}
function withDiagnostics(result, extra) {
  if (extra.length === 0) return result;
  const diagnostics = Object.freeze([...result.diagnostics, ...extra]);
  if (result.state === "opened") return Object.freeze({ ...result, diagnostics });
  return Object.freeze({ ...result, diagnostics });
}
async function disposeOpened(result) {
  if (result.state === "opened") await result.session.dispose();
}
function resourceInputFor(resolveInput, logicalId) {
  const nested = logicalId === void 0 ? void 0 : resolveInput?.forResource?.(logicalId);
  return nested === void 0 ? {} : { resolveInput: nested };
}
async function openSubject(request) {
  const policies = request.logicalResourceDiscovery;
  const options = {
    ...request,
    ...policies === void 0 ? {} : { logicalResourceDiscovery: snapshotLogicalResourceDiscoveryPolicies(policies) }
  };
  const compositionStartedAt = Date.now();
  const scan = scanContainerAliases(options);
  const aliases = scan.aliases;
  if (aliases.length === 0) {
    const direct = await openSubjectDirect(options);
    return withDiagnostics(
      direct,
      carrierShaped(direct) ? containerAliasAbsence(scan, options) : []
    );
  }
  const formats = [
    ...new Set(aliases.map((alias) => alias.spec.container?.formatId).filter(Boolean))
  ];
  if (formats.length !== 1) {
    throw new ModkitError({
      code: "x3.host/container-alias-ambiguous",
      message: `subject selectors name ${formats.length} different container formats`,
      context: { formats: formats.sort(compareUtf8) }
    });
  }
  if (options.budget.maxDepth < 1) {
    throw new ModkitError({
      code: "x3.host/container-composition-depth-exceeded",
      message: "container composition requires one remaining subject depth"
    });
  }
  const formatId = formats[0];
  const parent = await openSubjectDirect(options, {
    containerProviderFormatId: formatId,
    includeSelectionLock: true
  });
  if (parent.state !== "opened") {
    if (parent.reason === "no-match") {
      return withDiagnostics(await openSubjectDirect(options), parent.diagnostics);
    }
    return Object.freeze({
      ...parent,
      reason: "input-unresolved",
      diagnostics: Object.freeze([
        ...parent.diagnostics,
        diagnostic(
          "error",
          "x3.host/container-provider-unavailable",
          `no unique runnable container provider opened format ${formatId}`,
          [formatId]
        )
      ])
    });
  }
  let composition;
  let semanticSession;
  try {
    throwIfAborted(options.signal);
    composition = await createContainerNamespaceComposition({
      parent: parent.session,
      root: options.source.ref,
      revision: options.source.revision,
      budget: options.budget,
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    throwIfAborted(options.signal);
    const elapsed = Date.now() - compositionStartedAt;
    const remainingDeadline = options.budget.deadlineMs === void 0 ? void 0 : options.budget.deadlineMs - elapsed;
    if (remainingDeadline !== void 0 && remainingDeadline <= 0) {
      throw new ModkitError({
        code: "x3.host/container-composition-deadline-exceeded",
        message: "container composition exhausted the subject-open deadline before semantic probing"
      });
    }
    const semanticBudget = Object.freeze({
      ...options.budget,
      maxDepth: options.budget.maxDepth - 1,
      ...remainingDeadline === void 0 ? {} : { deadlineMs: remainingDeadline }
    });
    const semantic = await openSubjectDirect(
      { ...options, source: composition.source, budget: semanticBudget },
      {
        containerAliasFormatId: formatId,
        openResources: composition.openResources,
        containerAliasContributionIds: new Set(aliases.map((alias) => alias.contributionId))
      }
    );
    if (semantic.state !== "opened") {
      await composition.dispose();
      composition = void 0;
      if (semantic.reason === "no-candidate" || semantic.reason === "no-match") {
        return withDiagnostics(parent, [
          ...semantic.diagnostics,
          diagnostic(
            "warning",
            "x3.host/container-semantic-unclaimed",
            `no semantic alias claimed the ${formatId} namespace (${semantic.reason}); the carrier view wins`,
            aliases.map((alias) => alias.contributionId),
            {
              reason: semantic.reason,
              candidates: semantic.candidates.map((item) => ({
                contributionId: item.contributionId,
                state: item.state,
                confidence: item.confidence,
                diagnostics: item.diagnostics.map((entry) => entry.code)
              }))
            }
          )
        ]);
      }
      await parent.session.dispose();
      return semantic;
    }
    semanticSession = semantic.session;
    const selectedAlias = aliases.find(
      (alias) => alias.contributionId === semantic.selected.contributionId
    );
    if (selectedAlias === void 0) {
      throw new ModkitError({
        code: "x3.host/container-semantic-selection-invalid",
        message: "selected semantic codec is not one of the matched container aliases"
      });
    }
    const selectedSpec = selectedAlias.spec;
    const needsPack = selectedSpec.operations.some(
      (operation) => operation.mutatesSource && operation.outputKinds?.includes("edit-plan")
    );
    if (needsPack && composition.packHandlerId === void 0) {
      throw new ModkitError({
        code: "x3.host/container-pack-unavailable",
        message: `container provider for ${formatId} must publish container.pack for mutating semantic aliases`
      });
    }
    if (selectedSpec.operations.some((operation) => operation.id === "export.raw") && composition.exportRawHandlerId === void 0) {
      throw new ModkitError({
        code: "x3.host/container-export-raw-unavailable",
        message: `container provider for ${formatId} must publish export.raw for semantic raw export`
      });
    }
    const session = composition.wrapSession(
      semanticSession,
      semantic.descriptor,
      selectedSpec,
      parent.session
    );
    semanticSession = void 0;
    composition = void 0;
    const lockText = serializePolicyLock([
      ...parsePolicyLock(parent.lockText).entries,
      ...parsePolicyLock(semantic.lockText).entries
    ]);
    return Object.freeze({
      ...semantic,
      session,
      lockText,
      carrier: Object.freeze({ descriptor: parent.descriptor, selected: parent.selected }),
      candidates: Object.freeze([...parent.candidates, ...semantic.candidates]),
      diagnostics: Object.freeze([...parent.diagnostics, ...semantic.diagnostics])
    });
  } catch (error) {
    if (semanticSession !== void 0) {
      try {
        await semanticSession.dispose();
      } catch {
      }
    }
    if (composition !== void 0) {
      try {
        await composition.dispose();
      } catch {
      }
    }
    try {
      await disposeOpened(parent);
    } catch {
    }
    throw error;
  }
}
var COMPANION_REQUIRED_MISSING = "x3.host/companion-required-missing";
var COMPANION_AMBIGUOUS = "x3.host/companion-ambiguous";
var COMPANION_PATH_REFUSED = "x3.host/companion-path-refused";
var COMPANION_PATTERN_INVALID = "x3.host/companion-pattern-invalid";
var COMPANION_SCOPE_UNSUPPORTED = "x3.host/companion-scope-unsupported";
var COMPANION_BUDGET_EXCEEDED = "x3.host/companion-budget-exceeded";
var COMPANION_PLAN_INVALID = "x3.host/companion-plan-invalid";
var COMPANION_TRAIT_PROBE_UNAVAILABLE = "x3.host/companion-trait-probe-unavailable";
var COMPANION_UNAVAILABLE = "x3.host/companion-unavailable";
var DEFAULT_COMPANION_LIMITS = Object.freeze({
  // One scope of a game archive: a model's bare texture name is looked for in every folder of the
  // enclosing container, and Emperor's 3DDATA0001.RFH holds 3 749 entries, Diablo III's anim/ 15 258.
  maxEntries: 65536,
  maxProbes: 64,
  maxProbeBytes: 256 * 1024,
  // A binding is a reference into a scope already bounded by maxEntries. Kane's Wrath's compiled
  // containers bind their meshes and clips one by one: the MARV names 164 parts, the Eradicator
  // Hexapod 175 plus 19 clips, and at 64 they did not open.
  maxBindings: 1024
});
var DRIVE_PREFIX = /^[A-Za-z]:/u;
function refusePath(value, why, context) {
  throw new ModkitError({
    code: COMPANION_PATH_REFUSED,
    message: `companion logical id \xAB${value}\xBB is refused: ${why}`,
    context: { ...context, logicalId: value }
  });
}
function normalizeCompanionLogicalId(value, context = {}) {
  if (value.includes("\0")) refusePath(value, "it contains a NUL byte", context);
  const slashed = value.replaceAll("\\", "/");
  if (slashed.startsWith("//")) refusePath(slashed, "it is a UNC path", context);
  if (slashed.startsWith("/")) refusePath(slashed, "it is an absolute path", context);
  if (DRIVE_PREFIX.test(slashed)) refusePath(slashed, "it carries a drive prefix", context);
  if (slashed !== "" && !/(?:^|\/)\.{0,2}(?:\/|$)/u.test(slashed)) return slashed;
  const parts = [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") refusePath(slashed, "it escapes the confined origin root", context);
    parts.push(part);
  }
  const normalized = parts.join("/");
  if (normalized === "") refusePath(value, "it names nothing", context);
  return normalized;
}
var WILDCARDS = /* @__PURE__ */ new Set(["*", "?"]);
function compilePatterns(requirementId, patterns, caseSensitivity) {
  if (patterns === void 0 || patterns.length === 0) {
    throw new ModkitError({
      code: COMPANION_PATTERN_INVALID,
      message: `requirement \xAB${requirementId}\xBB declares no patterns; an unbounded companion scan is refused`,
      context: { requirementId }
    });
  }
  const bodies = patterns.map((pattern) => pattern.replace(/^\.[\\/]/u, ""));
  const expressions = [];
  for (const pattern of patterns) {
    const invalid2 = (why) => {
      throw new ModkitError({
        code: COMPANION_PATTERN_INVALID,
        message: `companion pattern \xAB${pattern}\xBB of requirement \xAB${requirementId}\xBB is refused: ${why}`,
        context: { requirementId, pattern }
      });
    };
    if (pattern.length === 0) invalid2("it is empty");
    if (pattern.includes("\0")) invalid2("it contains a NUL byte");
    if (pattern.includes("**")) invalid2("recursive patterns are not a bounded companion search");
    if (pattern.startsWith("/") || pattern.startsWith("\\")) invalid2("it is an absolute path");
    if (DRIVE_PREFIX.test(pattern)) invalid2("it carries a drive prefix");
    if (pattern.replaceAll("\\", "/").split("/").includes("..")) {
      invalid2("it escapes the confined origin root");
    }
    if (![...pattern].some((character) => !WILDCARDS.has(character))) {
      invalid2("it has no literal part and would match every entry");
    }
    const slashed = pattern.replaceAll("\\", "/");
    const rooted = slashed.startsWith("./");
    const body = rooted ? slashed.slice(2) : slashed;
    if (body.length === 0) invalid2("it is empty");
    let expression = "^";
    for (const character of body) {
      if (character === "*") expression += "[^/]*";
      else if (character === "?") expression += "[^/]";
      else expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
    }
    expressions.push({
      expression: new RegExp(`${expression}$`, caseSensitivity === "insensitive" ? "iu" : "u"),
      whole: rooted || body.includes("/")
    });
  }
  return {
    test: (logicalId) => {
      const name = logicalId.split("/").at(-1) ?? logicalId;
      return expressions.some((item) => item.expression.test(item.whole ? logicalId : name));
    },
    prefixes: enumerationPrefixes(bodies, caseSensitivity),
    namePrefix: enumerationNamePrefix(bodies, caseSensitivity)
  };
}
function enumerationPrefixes(patterns, caseSensitivity) {
  const paths = patterns.map((pattern) => pattern.replaceAll("\\", "/"));
  if (paths.some((path) => !path.includes("/") || /[*?]/u.test(path)))
    return [enumerationPrefix(patterns)];
  const unique = /* @__PURE__ */ new Map();
  for (const path of paths) {
    const key2 = caseSensitivity === "insensitive" ? path.toLowerCase() : path;
    if (!unique.has(key2)) unique.set(key2, path);
  }
  return [...unique.values()];
}
function enumerationNamePrefix(patterns, caseSensitivity) {
  const directory = enumerationPrefix(patterns);
  if (directory === "") return "";
  const fold2 = (value) => caseSensitivity === "insensitive" ? value.toLowerCase() : value;
  const starts = patterns.map((pattern) => {
    const normalized = pattern.replaceAll("\\", "/");
    const wildcard = normalized.search(/[*?]/u);
    if (wildcard === -1 || !fold2(normalized).startsWith(fold2(directory))) return void 0;
    const literal = normalized.slice(directory.length, wildcard);
    return literal.includes("/") ? void 0 : literal;
  });
  if (starts.some((start) => start === void 0)) return "";
  let common = starts[0];
  for (const start of starts.slice(1)) {
    let length = 0;
    while (length < common.length && length < start.length && fold2(common[length]) === fold2(start[length]))
      length += 1;
    common = common.slice(0, length);
  }
  return common;
}
function enumerationPrefix(patterns) {
  const safe = patterns.map((pattern) => {
    const normalized = pattern.replaceAll("\\", "/");
    if (!normalized.includes("/")) return "";
    const wildcard = normalized.search(/[*?]/u);
    if (wildcard === -1) return normalized;
    const literal = normalized.slice(0, wildcard);
    const cut2 = literal.lastIndexOf("/");
    return cut2 === -1 ? "" : literal.slice(0, cut2 + 1);
  });
  const first = safe[0];
  if (first === void 0) return "";
  if (safe.every((value) => value === first)) return first;
  let common = first;
  for (const value of safe.slice(1)) {
    let length = 0;
    while (length < common.length && length < value.length && common[length] === value[length]) {
      length += 1;
    }
    common = common.slice(0, length);
  }
  const cut = common.lastIndexOf("/");
  return cut === -1 ? "" : common.slice(0, cut + 1);
}
function validateRequirements(requirements) {
  const seen = /* @__PURE__ */ new Set();
  for (const requirement of requirements) {
    const invalid2 = (why) => {
      throw new ModkitError({
        code: COMPANION_PLAN_INVALID,
        message: `companion requirement \xAB${requirement.id}\xBB is invalid: ${why}`,
        context: { requirementId: requirement.id, role: requirement.role }
      });
    };
    if (typeof requirement.id !== "string" || requirement.id.trim().length === 0) {
      invalid2("its id is blank");
    }
    if (seen.has(requirement.id)) invalid2("its id is not unique within the plan");
    seen.add(requirement.id);
    if (typeof requirement.role !== "string" || requirement.role.trim().length === 0) {
      invalid2("its role is blank");
    }
    if (!["owned", "companion", "external"].includes(requirement.ownership)) {
      invalid2(`ownership \xAB${String(requirement.ownership)}\xBB is not a declared ownership`);
    }
    const required = requirement.cardinality === "one" || requirement.cardinality === "one-or-more";
    if (requirement.required !== required) {
      invalid2(
        `cardinality \xAB${requirement.cardinality}\xBB does not agree with required=${String(requirement.required)}`
      );
    }
    if (!Array.isArray(requirement.scopes) || requirement.scopes.length === 0) {
      invalid2("it declares no search scope");
    }
  }
}
function createLayeredCompanionOrigin(origins) {
  const first = origins[0];
  if (first === void 0) throw new TypeError("a layered companion origin needs a backend");
  const fold2 = (value) => first.caseSensitivity === "insensitive" ? value.toLowerCase() : value;
  const producedBy = /* @__PURE__ */ new Map();
  return Object.freeze({
    primaryLogicalId: first.primaryLogicalId,
    caseSensitivity: first.caseSensitivity,
    scopes: Object.freeze([...new Set(origins.flatMap((origin) => [...origin.scopes]))]),
    async *enumerate(scope, options, signal) {
      const seen = /* @__PURE__ */ new Set();
      for (const origin of origins) {
        if (!origin.scopes.includes(scope)) continue;
        for await (const entry of origin.enumerate(scope, options, signal)) {
          const key2 = fold2(entry.logicalId);
          if (seen.has(key2)) continue;
          seen.add(key2);
          producedBy.set(key2, origin);
          yield entry;
        }
      }
    },
    async open(logicalId, signal) {
      const remembered = producedBy.get(fold2(logicalId));
      if (remembered !== void 0) return remembered.open(logicalId, signal);
      let failure2;
      for (const origin of origins) {
        try {
          return await origin.open(logicalId, signal);
        } catch (error) {
          failure2 ??= error;
        }
      }
      throw failure2 ?? new TypeError(`no layered origin holds \xAB${logicalId}\xBB`);
    }
  });
}
function createCompanionInputResolver(origin, options = {}) {
  const limits = Object.freeze({
    ...DEFAULT_COMPANION_LIMITS,
    ...options.limits
  });
  const now = options.now ?? (() => Date.now());
  const report = options.onDiagnostic;
  const explicit = options.explicitSelections;
  const resolver = async (context) => {
    const plan = context.plan;
    if (plan.originKind === "derived" || plan.requirements.length === 0) {
      return defaultResolveInput(context);
    }
    if (plan.originKind === "bundle" && context.source.kind !== "bytes") {
      throw new ModkitError({
        code: "x3.host/input-topology-mismatch",
        message: "a bundle input plan requires a byte subject source"
      });
    }
    if (plan.originKind === "namespace" && context.source.kind !== "namespace") {
      throw new ModkitError({
        code: "x3.host/input-topology-mismatch",
        message: "a namespace input plan requires a namespace subject source"
      });
    }
    const signal = context.signal;
    const deadlineAt = options.deadlineMs === void 0 ? void 0 : now() + options.deadlineMs;
    const budget = { entries: 0, probes: 0, probeBytes: 0, bindings: 0 };
    const checkpoint = (stage) => {
      throwIfAborted(signal);
      if (deadlineAt !== void 0 && now() > deadlineAt) {
        throw new ModkitError({
          code: COMPANION_BUDGET_EXCEEDED,
          message: `companion resolution exceeded its ${String(options.deadlineMs)}ms deadline`,
          context: { limit: "deadline", stage, deadlineMs: options.deadlineMs }
        });
      }
    };
    const exceeded = (limit, value) => {
      throw new ModkitError({
        code: COMPANION_BUDGET_EXCEEDED,
        message: `companion resolution exceeded its ${limit} limit of ${value}`,
        context: { limit, value }
      });
    };
    const refuse2 = (code, message, detail) => {
      report?.(diagnostic("error", code, message, [String(detail["requirementId"])], detail));
      throw new ModkitError({ code, message, context: detail });
    };
    validateRequirements(plan.requirements);
    const enumerated = /* @__PURE__ */ new Map();
    const served = new Set(origin.scopes);
    if (explicit !== void 0) served.add("explicit-user-selection");
    const enumerateScope = async (scope, prefix, namePrefix = "") => {
      const key2 = canonicalJsonStringify([scope, prefix, namePrefix]);
      const cached = enumerated.get(key2);
      if (cached !== void 0) return cached;
      const ids = [];
      if (scope === "explicit-user-selection") {
        for (const value of Object.values(explicit ?? {}).flat()) {
          ids.push(normalizeCompanionLogicalId(value, { scope }));
        }
      } else {
        let taken = 0;
        for await (const entry of origin.enumerate(
          scope,
          namePrefix === "" ? { prefix } : { prefix, namePrefix },
          signal
        )) {
          checkpoint(`enumerate:${scope}`);
          budget.entries += 1;
          taken += 1;
          if (taken > limits.maxEntries) exceeded("entries", limits.maxEntries);
          ids.push(normalizeCompanionLogicalId(entry.logicalId, { scope }));
        }
      }
      const frozen = Object.freeze(ids);
      enumerated.set(key2, frozen);
      return frozen;
    };
    const fold2 = (value) => origin.caseSensitivity === "insensitive" ? value.toLowerCase() : value;
    const primaryKey = fold2(normalizeCompanionLogicalId(origin.primaryLogicalId));
    const selected = [];
    const usedBindingIds = /* @__PURE__ */ new Set();
    const pinned = /* @__PURE__ */ new Map();
    for (const requirement of plan.requirements) {
      checkpoint(`requirement:${requirement.id}`);
      const patterns = compilePatterns(requirement.id, requirement.patterns, origin.caseSensitivity);
      const requested = [...new Set(requirement.scopes)];
      const usable = requested.filter((scope) => served.has(scope));
      if (usable.length === 0) {
        const detail2 = {
          requirementId: requirement.id,
          role: requirement.role,
          requestedScopes: requested,
          servedScopes: [...served].sort(compareUtf8),
          reason: requested.includes("explicit-user-selection") ? "no-product-selection" : requested.includes("workspace-dependency-layer") ? "no-provider" : "origin-cannot-serve-scope"
        };
        if (requirement.required) {
          refuse2(
            COMPANION_SCOPE_UNSUPPORTED,
            `required companion \xAB${requirement.role}\xBB (requirement \xAB${requirement.id}\xBB) asks only for scopes this origin cannot serve: ${requested.join(", ")}`,
            detail2
          );
        }
        report?.(
          diagnostic(
            "warning",
            COMPANION_SCOPE_UNSUPPORTED,
            `optional companion \xAB${requirement.role}\xBB is unavailable: none of its scopes can be served here`,
            [requirement.id],
            detail2
          )
        );
        continue;
      }
      const matched = [];
      for (const [rank, scope] of usable.entries()) {
        for (const prefix of patterns.prefixes) {
          const namePrefix = patterns.prefixes.length === 1 ? patterns.namePrefix : "";
          for (const logicalId of await enumerateScope(scope, prefix, namePrefix)) {
            if (scope === "explicit-user-selection" && !(explicit?.[requirement.id] ?? []).some(
              (value) => fold2(normalizeCompanionLogicalId(value)) === fold2(logicalId)
            )) {
              continue;
            }
            if (fold2(logicalId) === primaryKey) continue;
            if (!patterns.test(logicalId)) continue;
            matched.push({ rank, logicalId });
          }
        }
      }
      matched.sort(
        (left, right) => left.rank === right.rank ? compareUtf8(left.logicalId, right.logicalId) : left.rank - right.rank
      );
      const unique = [];
      const seenKeys = /* @__PURE__ */ new Set();
      for (const { logicalId } of matched) {
        const key2 = fold2(logicalId);
        if (seenKeys.has(key2)) continue;
        seenKeys.add(key2);
        unique.push(logicalId);
      }
      const accepted = [];
      const rejected2 = [];
      for (const logicalId of unique) {
        checkpoint(`validate:${requirement.id}`);
        if (requirement.expected === void 0) {
          accepted.push(logicalId);
          continue;
        }
        if (options.traitProbe === void 0) {
          throw new ModkitError({
            code: COMPANION_TRAIT_PROBE_UNAVAILABLE,
            message: `requirement \xAB${requirement.id}\xBB declares expected traits but this host wired no companion trait probe`,
            context: { requirementId: requirement.id, role: requirement.role }
          });
        }
        budget.probes += 1;
        if (budget.probes > limits.maxProbes) exceeded("probes", limits.maxProbes);
        const remaining = limits.maxProbeBytes - budget.probeBytes;
        if (remaining <= 0) exceeded("probeBytes", limits.maxProbeBytes);
        const lease = await origin.open(logicalId, signal);
        let ok = false;
        try {
          pinned.set(logicalId, { ref: lease.value.ref, revision: lease.value.revision });
          ok = await options.traitProbe(
            {
              requirementId: requirement.id,
              logicalId,
              // every byte the probe pulls is counted by the host, not reported by the probe
              source: countingSource(lease.value, (read) => {
                budget.probeBytes += read;
                if (budget.probeBytes > limits.maxProbeBytes) {
                  exceeded("probeBytes", limits.maxProbeBytes);
                }
              }),
              expected: requirement.expected,
              maxBytes: remaining
            },
            signal
          );
        } finally {
          await lease.release();
        }
        ;
        (ok ? accepted : rejected2).push(logicalId);
      }
      const detail = {
        requirementId: requirement.id,
        role: requirement.role,
        cardinality: requirement.cardinality,
        checkedScopes: usable,
        requestedScopes: requested,
        matched: unique.length,
        rejectedByExpectedTraits: rejected2
      };
      const singular = requirement.cardinality === "one" || requirement.cardinality === "zero-or-one";
      if (singular && accepted.length > 1) {
        refuse2(
          COMPANION_AMBIGUOUS,
          `companion \xAB${requirement.role}\xBB (requirement \xAB${requirement.id}\xBB) admits at most one candidate but ${accepted.length} matched in ${usable.join(", ")}`,
          { ...detail, candidates: accepted }
        );
      }
      if (requirement.required && accepted.length === 0) {
        refuse2(
          COMPANION_REQUIRED_MISSING,
          `required companion \xAB${requirement.role}\xBB (requirement \xAB${requirement.id}\xBB) was not found in any checked scope: ${usable.join(", ")}`,
          detail
        );
      }
      if (accepted.length === 0) {
        report?.(
          diagnostic(
            "information",
            COMPANION_UNAVAILABLE,
            `optional companion \xAB${requirement.role}\xBB is absent; the dependent capability stays unavailable`,
            [requirement.id],
            {
              ...detail,
              reason: rejected2.length > 0 ? "expected-traits-rejected" : "no-candidate-matched"
            }
          )
        );
        continue;
      }
      for (const logicalId of accepted) {
        checkpoint(`bind:${requirement.id}`);
        budget.bindings += 1;
        if (budget.bindings > limits.maxBindings) exceeded("bindings", limits.maxBindings);
        const bindingId = `${requirement.id}#${logicalId}`;
        if (usedBindingIds.has(bindingId)) {
          throw new ModkitError({
            code: COMPANION_PLAN_INVALID,
            message: `companion binding id \xAB${bindingId}\xBB is not unique within the resolved input`,
            context: { requirementId: requirement.id, bindingId }
          });
        }
        usedBindingIds.add(bindingId);
        let identity2 = pinned.get(logicalId);
        if (identity2 === void 0) {
          let lease;
          try {
            lease = await origin.open(logicalId, signal);
          } catch (error) {
            throwIfAborted(signal);
            if (requirement.required) throw error;
            report?.(
              diagnostic(
                "information",
                COMPANION_UNAVAILABLE,
                `optional companion \xAB${requirement.role}\xBB (${logicalId}) could not be opened; the dependent capability stays unavailable`,
                [requirement.id],
                {
                  ...detail,
                  reason: "open-failed",
                  error: error instanceof Error ? error.message : String(error)
                }
              )
            );
            usedBindingIds.delete(bindingId);
            budget.bindings -= 1;
            continue;
          }
          try {
            identity2 = { ref: lease.value.ref, revision: lease.value.revision };
            pinned.set(logicalId, identity2);
          } finally {
            await lease.release();
          }
        }
        selected.push({
          requirement,
          logicalId,
          bindingId,
          ref: identity2.ref,
          revision: identity2.revision
        });
      }
    }
    return buildAssetInput(context, plan, origin, selected, signal);
  };
  return Object.assign(resolver, {
    openResources: (request) => createResourceSession({ ...request, origin }),
    // a resource of this origin opened as a subject (a map's texture): its own companions are
    // found in the same origin, with the resource as the primary
    forResource: (logicalId) => createCompanionInputResolver(
      Object.freeze({
        ...origin,
        primaryLogicalId: logicalId,
        enumerate: origin.enumerate.bind(origin),
        open: origin.open.bind(origin)
      }),
      options
    )
  });
}
function countingSource(source, onBytes) {
  if (source.kind !== "bytes") return source;
  const inner = source;
  return Object.freeze({
    ...inner,
    async read(offset, length, signal) {
      const bytes = await inner.read(offset, length, signal);
      onBytes(bytes.byteLength);
      return bytes;
    },
    async *stream(range, signal) {
      for await (const chunk of inner.stream(range, signal)) {
        onBytes(chunk.byteLength);
        yield chunk;
      }
    }
  });
}
function buildAssetInput(context, plan, origin, selected, signal) {
  const requirementBindings = selected.map(
    (item) => Object.freeze({
      sourceKind: "requirement",
      bindingId: item.bindingId,
      requirementId: item.requirement.id,
      role: item.requirement.role,
      ownership: item.requirement.ownership,
      source: item.ref,
      revision: item.revision
    })
  );
  const openRequirement = async (bindingId, openSignal) => {
    throwIfAborted(openSignal ?? signal);
    const item = selected.find((candidate2) => candidate2.bindingId === bindingId);
    if (item === void 0) {
      throw new ModkitError({
        code: "x3.host/unknown-asset-input-binding",
        message: `asset input has no binding ${bindingId}`
      });
    }
    const lease = await origin.open(item.logicalId, openSignal ?? signal);
    if (lease.value.revision !== item.revision) {
      await lease.release();
      throw new ModkitError({
        code: "x3.host/source-revision-changed",
        message: `companion \xAB${item.logicalId}\xBB changed after it was bound (revision ${item.revision})`,
        context: { bindingId, revision: item.revision, observed: lease.value.revision }
      });
    }
    return lease;
  };
  const bindingsFor = (requirementId) => Object.freeze(requirementBindings.filter((item) => item.requirementId === requirementId));
  if (plan.originKind === "namespace") {
    const source2 = context.source;
    const revisions2 = Object.freeze({
      topology: "namespace",
      revision: source2.revision,
      namespaceRevision: source2.revision,
      bindings: Object.freeze(
        requirementBindings.map(
          (item) => Object.freeze({ bindingId: item.bindingId, revision: item.revision })
        )
      ),
      compositionFingerprint: canonicalJsonStringify({
        topology: "namespace",
        root: source2.ref,
        revision: source2.revision,
        bindings: requirementBindings.map((item) => ({
          bindingId: item.bindingId,
          source: item.source,
          revision: item.revision
        }))
      })
    });
    return Object.freeze({
      originKind: "namespace",
      root: source2.ref,
      bindings: Object.freeze(requirementBindings),
      revisions: revisions2,
      bindingsFor,
      openBinding: openRequirement,
      async openNamespace(openSignal) {
        throwIfAborted(openSignal ?? signal);
        return source2.openNamespace(openSignal ?? signal);
      }
    });
  }
  const source = context.source;
  const candidatePlan = plan.candidate;
  if (candidatePlan === void 0 || candidatePlan.bindingId.trim().length === 0 || candidatePlan.role.trim().length === 0 || candidatePlan.ownership !== "owned" && candidatePlan.ownership !== "external") {
    throw new ModkitError({
      code: "x3.host/invalid-asset-input-plan",
      message: "codec returned an invalid bundle candidate binding"
    });
  }
  const candidate = Object.freeze({
    sourceKind: "candidate",
    bindingId: candidatePlan.bindingId,
    role: candidatePlan.role,
    ownership: candidatePlan.ownership,
    source: source.ref,
    revision: source.revision
  });
  if (requirementBindings.some((item) => item.bindingId === candidate.bindingId)) {
    throw new ModkitError({
      code: COMPANION_PLAN_INVALID,
      message: `companion binding id \xAB${candidate.bindingId}\xBB collides with the candidate binding`,
      context: { bindingId: candidate.bindingId }
    });
  }
  const bindings = Object.freeze([candidate, ...requirementBindings]);
  const revisions = Object.freeze({
    topology: "bundle",
    revision: source.revision,
    bindings: Object.freeze(
      bindings.map((item) => Object.freeze({ bindingId: item.bindingId, revision: item.revision }))
    ),
    compositionFingerprint: canonicalJsonStringify({
      topology: "bundle",
      bindings: bindings.map((item) => ({
        bindingId: item.bindingId,
        source: item.source,
        revision: item.revision
      }))
    })
  });
  return Object.freeze({
    originKind: "bundle",
    bindings,
    primaryBindingId: candidate.bindingId,
    revisions,
    bindingsFor,
    async openBinding(bindingId, openSignal) {
      throwIfAborted(openSignal ?? signal);
      if (bindingId === candidate.bindingId) {
        return Object.freeze({ value: source, release: async () => void 0 });
      }
      return openRequirement(bindingId, openSignal);
    }
  });
}
var DEPENDENCY_SCOPE = Object.freeze(["workspace-dependency-layer"]);
var KNOWLEDGE_FILE_MAX_BYTES = 8 * 1024 * 1024;
var KNOWLEDGE_TOTAL_MAX_BYTES = 32 * 1024 * 1024;
var FILES_PAGE = 4096;
function nonEmpty(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0")) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}
function normalizeOpaquePath(value) {
  return value === "" ? "" : normalizeCompanionLogicalId(value);
}
function joinPath(prefix, path) {
  return prefix === "" ? path : path === "" ? prefix : `${prefix}/${path}`;
}
function relativeEntry(mount, entry) {
  const path = normalizeOpaquePath(entry.path);
  if (mount.sourcePath === "") return path;
  const prefix = `${mount.sourcePath}/`;
  return path.toLowerCase().startsWith(prefix.toLowerCase()) ? path.slice(prefix.length) : void 0;
}
function contentSourceUri(sourceId, path) {
  return `content-source://${encodeURIComponent(sourceId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function entryRevision(mount) {
  return mount.fingerprint !== void 0 && isRevisionId(mount.fingerprint) ? revisionId(mount.fingerprint) : revisionIdFromRef({
    kind: "provider-token",
    value: `${mount.sourceId}\0${mount.sourcePath}\0${mount.dependencyId}`
  });
}
function validateMounts(resolution) {
  if (resolution.schemaVersion !== 1 || !nonEmpty(resolution.gameId, "gameId")) {
    throw new TypeError("invalid content dependency resolution");
  }
  if (!Array.isArray(resolution.mounts) || resolution.mounts.length === 0 || resolution.mounts.length > 256) {
    throw new TypeError("content dependency workspace requires 1..256 resolved mounts");
  }
  const ids = /* @__PURE__ */ new Set();
  const roots = resolution.mounts.map((mount, index) => {
    const dependencyId = nonEmpty(mount.dependencyId, `mount ${index} dependencyId`);
    if (ids.has(dependencyId) || !Number.isSafeInteger(mount.order) || mount.order < 0) {
      throw new TypeError(`invalid content dependency mount ${index}`);
    }
    ids.add(dependencyId);
    return Object.freeze({
      ...mount,
      dependencyId,
      sourceId: nonEmpty(mount.sourceId, `mount ${index} sourceId`),
      sourcePath: normalizeOpaquePath(mount.sourcePath),
      displayName: nonEmpty(mount.displayName, `mount ${index} displayName`),
      kind: nonEmpty(mount.kind, `mount ${index} kind`),
      rootId: `content-dependency:${dependencyId}`,
      logicalPrefix: "",
      revision: entryRevision(mount)
    });
  });
  roots.sort((left, right) => left.order - right.order);
  return Object.freeze(
    roots.map(
      (root, index) => Object.freeze({
        ...root,
        logicalPrefix: `content-dependencies/${index}`
      })
    )
  );
}
function workspaceDiagnostic(value) {
  const item = value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
  const severity = item?.["severity"];
  return Object.freeze({
    severity: severity === "error" || severity === "warning" || severity === "information" ? severity : "warning",
    code: typeof item?.["code"] === "string" && item["code"] ? item["code"] : "x3.host/content-dependency-diagnostic",
    message: typeof item?.["message"] === "string" && item["message"] ? item["message"] : "content dependency provider returned an unstructured diagnostic"
  });
}
function contentDependencyDiagnostics(values) {
  return Object.freeze(
    values.map((value) => {
      const item = workspaceDiagnostic(value);
      return diagnostic(item.severity, item.code, item.message);
    })
  );
}
function createContentDependencyOrigin(contentSources, mounts, maximumEntryBytes) {
  const overlay = Object.freeze([...mounts].reverse());
  const locations = /* @__PURE__ */ new Map();
  const fold2 = (value) => value.toLowerCase();
  const relativeRequest = (mount, logicalId) => {
    if (logicalId === "") return "";
    if (fold2(logicalId) === fold2(mount.logicalPrefix)) return "";
    const prefix = `${mount.logicalPrefix}/`;
    return fold2(logicalId).startsWith(fold2(prefix)) ? logicalId.slice(prefix.length) : void 0;
  };
  const findEntries = async (mount, logicalPrefix, signal) => {
    throwIfAborted(signal);
    const relativePrefix = relativeRequest(mount, logicalPrefix);
    if (relativePrefix === void 0) return Object.freeze([]);
    const parent = relativePrefix.slice(0, relativePrefix.lastIndexOf("/") + 1).replace(/\/$/u, "");
    let entries;
    if (relativePrefix === "" && contentSources.files !== void 0) {
      const files = [];
      const cursors = /* @__PURE__ */ new Set();
      let cursor2;
      do {
        throwIfAborted(signal);
        const page = await contentSources.files(mount.sourceId, mount.sourcePath, {
          limit: FILES_PAGE,
          ...cursor2 === void 0 ? {} : { cursor: cursor2 }
        });
        if (page === void 0) {
          if (cursor2 !== void 0)
            throw new TypeError("content files paging stopped before completion");
          files.push(...await contentSources.list(mount.sourceId, mount.sourcePath));
          break;
        }
        if (files.length + page.items.length > 1048576)
          throw new RangeError("content companion namespace exceeds 1048576 files");
        for (const file of page.items)
          files.push({
            ...file,
            name: file.path.slice(file.path.lastIndexOf("/") + 1),
            directory: false
          });
        cursor2 = page.nextCursor;
        if (cursor2 !== void 0) {
          if (cursors.has(cursor2)) throw new TypeError("content files paging repeated a cursor");
          cursors.add(cursor2);
        }
      } while (cursor2 !== void 0);
      entries = files;
    } else
      try {
        entries = await contentSources.list(mount.sourceId, joinPath(mount.sourcePath, parent));
      } catch {
        return Object.freeze([]);
      }
    const output = [];
    for (const entry of entries) {
      throwIfAborted(signal);
      if (entry.directory) continue;
      const relative = relativeEntry(mount, entry);
      if (relative === void 0 || !fold2(relative).startsWith(fold2(relativePrefix))) continue;
      const logicalId = joinPath(mount.logicalPrefix, relative);
      locations.set(fold2(logicalId), mount);
      output.push(
        Object.freeze({
          logicalId,
          ...entry.size === void 0 ? {} : { size: BigInt(entry.size) }
        })
      );
    }
    return Object.freeze(output);
  };
  return Object.freeze({
    primaryLogicalId: "__content_dependency_workspace__",
    caseSensitivity: "insensitive",
    scopes: DEPENDENCY_SCOPE,
    async *enumerate(scope, enumeration, signal) {
      if (scope !== "workspace-dependency-layer") return;
      const prefix = enumeration.prefix === "" ? "" : `${normalizeCompanionLogicalId(enumeration.prefix)}${enumeration.prefix.endsWith("/") ? "/" : ""}`;
      const emitted = /* @__PURE__ */ new Set();
      for (const mount of overlay) {
        const rootScoped = relativeRequest(mount, prefix) !== void 0;
        const query = rootScoped ? prefix : joinPath(mount.logicalPrefix, prefix);
        for (const found of await findEntries(mount, query, signal)) {
          const entry = rootScoped ? found : Object.freeze({
            ...found,
            logicalId: found.logicalId.slice(mount.logicalPrefix.length + 1)
          });
          const key2 = fold2(entry.logicalId);
          if (emitted.has(key2)) continue;
          emitted.add(key2);
          if (!rootScoped) locations.set(key2, mount);
          yield entry;
        }
      }
    },
    async open(logicalId, signal) {
      throwIfAborted(signal);
      const normalized = normalizeCompanionLogicalId(logicalId);
      const qualifiedIn = (candidate) => relativeRequest(candidate, normalized) === void 0 ? joinPath(candidate.logicalPrefix, normalized) : normalized;
      let mount = locations.get(fold2(normalized));
      if (mount === void 0 && contentSources.lookup !== void 0) {
        for (const candidate of overlay) {
          const relative2 = relativeRequest(candidate, qualifiedIn(candidate));
          if (relative2 === void 0 || relative2 === "") continue;
          const entry = await contentSources.lookup(candidate.sourceId, joinPath(candidate.sourcePath, relative2)).catch(() => void 0);
          throwIfAborted(signal);
          if (entry !== void 0 && !entry.directory) {
            mount = candidate;
            break;
          }
        }
      }
      if (mount === void 0) {
        for (const candidate of overlay) {
          const qualified = qualifiedIn(candidate);
          const found = await findEntries(candidate, qualified, signal);
          if (found.some((entry) => fold2(entry.logicalId) === fold2(qualified))) {
            mount = candidate;
            break;
          }
        }
      }
      if (mount === void 0) throw new RangeError(`content dependency has no entry ${normalized}`);
      const relative = relativeRequest(mount, qualifiedIn(mount));
      if (relative === void 0 || relative === "")
        throw new RangeError(`content dependency has no file ${normalized}`);
      const bytes = await contentSources.read(
        mount.sourceId,
        joinPath(mount.sourcePath, relative),
        maximumEntryBytes
      );
      const uri = contentSourceUri(mount.sourceId, joinPath(mount.sourcePath, relative));
      const source = artifactByteSourceFromBytes(
        Object.freeze({ id: `${mount.rootId}:${normalized}`, uri }),
        mount.revision,
        bytes
      );
      return Object.freeze({ value: source, release: async () => void 0 });
    }
  });
}
function createContentDependencyAssetOrigin(options) {
  const maximumEntryBytes = options.maximumEntryBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumEntryBytes) || maximumEntryBytes <= 0) {
    throw new TypeError("maximumEntryBytes must be a positive safe integer");
  }
  const mounts = validateMounts(options.resolution);
  if (mounts.length === 0) return void 0;
  return createContentDependencyOrigin(options.contentSources, mounts, maximumEntryBytes);
}
var foldHostPath = (value) => value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
function baseModsFor(target, setting) {
  if (setting === void 0) return void 0;
  const wanted = foldHostPath(target);
  let best;
  for (const [key2, mods] of Object.entries(setting)) {
    const folded = key2 === "*" ? "" : foldHostPath(key2);
    const holds = folded === "" || wanted === folded || wanted.startsWith(`${folded}/`);
    if (holds && (best === void 0 || folded.length > best.length)) {
      best = { length: folded.length, mods };
    }
  }
  return best?.mods;
}
function subjectTarget(uri) {
  if (uri === void 0) return void 0;
  let url;
  try {
    url = new URL(uri);
  } catch {
    return void 0;
  }
  if (url.protocol === "content-source:") {
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const sourceId = decodeURIComponent(url.host);
    return sourceId === "" ? void 0 : Object.freeze({ sourceId, path: segments.join("/") });
  }
  if (url.protocol !== "file:") return void 0;
  const path = decodeURIComponent(url.pathname);
  if (url.host !== "") return `//${url.host}${path}`;
  return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path;
}
function modContextResolution(context) {
  return Object.freeze({
    schemaVersion: 1,
    gameId: context.gameId,
    complete: context.unresolved.length === 0,
    mounts: Object.freeze(
      context.layers.flatMap(
        (layer, order) => layer.sourceId === HOST_LAYER_SOURCE_ID ? [] : [
          Object.freeze({
            dependencyId: `${layer.sourceId}:${layer.sourcePath}`,
            order,
            sourceId: layer.sourceId,
            sourcePath: layer.sourcePath,
            displayName: layer.displayName,
            kind: layer.role,
            ...layer.fingerprint === void 0 ? {} : { fingerprint: layer.fingerprint }
          })
        ]
      )
    ),
    dependencies: Object.freeze([]),
    diagnostics: context.diagnostics
  });
}
var failure = (code, error) => diagnostic("warning", code, error instanceof Error ? error.message : String(error));
async function resolveSubjectClosure(request) {
  const { contentSources, subject, signal } = request;
  const target = subject.target ?? subjectTarget(subject.descriptor.subjectUri);
  if (target === void 0) {
    return Object.freeze({
      diagnostics: Object.freeze([
        diagnostic(
          "information",
          "x3.host/mod-context-target-unavailable",
          `${subject.descriptor.subjectUri ?? "the subject"} is neither a host path nor a content-source path`
        )
      ])
    });
  }
  if (contentSources.openModContext === void 0) {
    return Object.freeze({
      diagnostics: Object.freeze([
        diagnostic(
          "information",
          "x3.host/mod-context-unavailable",
          "the configured content sources do not open mod contexts"
        )
      ])
    });
  }
  try {
    const baseMods = baseModsFor(typeof target === "string" ? target : "", request.baseMods);
    const context = await contentSources.openModContext({
      schemaVersion: 1,
      target,
      ...baseMods === void 0 ? {} : { baseMods }
    });
    let kept = false;
    try {
      signal?.throwIfAborted();
      const resolution = modContextResolution(context);
      kept = request.keepContext === true;
      return Object.freeze({
        resolution,
        ...kept ? { context } : {},
        diagnostics: contentDependencyDiagnostics(resolution.diagnostics)
      });
    } finally {
      if (!kept) await context.dispose();
    }
  } catch (error) {
    signal?.throwIfAborted();
    return Object.freeze({
      diagnostics: Object.freeze([failure("x3.host/mod-context-failed", error)])
    });
  }
}
async function subjectClosures(request) {
  const { contentSources, signal } = request;
  const resolutions = [];
  const diagnostics = [];
  let complete = request.subjects.length > 0;
  for (const subject of request.subjects) {
    const closure = await resolveSubjectClosure({
      contentSources,
      subject,
      ...request.baseMods === void 0 ? {} : { baseMods: request.baseMods },
      ...signal === void 0 ? {} : { signal }
    });
    diagnostics.push(...closure.diagnostics);
    if (closure.resolution === void 0) complete = false;
    else {
      complete &&= closure.resolution.complete;
      resolutions.push(closure.resolution);
    }
  }
  return Object.freeze({
    resolutions: Object.freeze(resolutions.filter((resolution) => resolution.mounts.length > 0)),
    diagnostics: Object.freeze(diagnostics),
    complete
  });
}
async function resolveContentAssetOrigins(request) {
  const closures = await subjectClosures(request);
  return Object.freeze({
    origins: Object.freeze(
      closures.resolutions.flatMap((resolution) => {
        const origin = createContentDependencyAssetOrigin({
          contentSources: request.contentSources,
          resolution,
          ...request.maximumEntryBytes === void 0 ? {} : { maximumEntryBytes: request.maximumEntryBytes }
        });
        return origin === void 0 ? [] : [origin];
      })
    ),
    diagnostics: closures.diagnostics,
    dependenciesComplete: closures.complete
  });
}
var key = (ref) => JSON.stringify([ref.namespace, ref.entityId]);
async function answerCatalogQueries(options) {
  const asked = /* @__PURE__ */ new Set();
  const entities = /* @__PURE__ */ new Map();
  let result = options.initial ?? await options.run(void 0, 0);
  for (let round = 1; round <= options.rounds; round += 1) {
    const refs = options.queriesOf(result).filter((ref) => !asked.has(key(ref)));
    if (refs.length === 0) break;
    for (const ref of refs) asked.add(key(ref));
    for (const entity of await options.catalogEntities(refs, options.signal)) {
      entities.set(key(entity), entity);
    }
    options.signal?.throwIfAborted();
    result = await options.run(Object.freeze([...entities.values()]), round);
  }
  return result;
}
function modContextCatalogEntities(context) {
  const query = context.query?.bind(context);
  if (query === void 0) return void 0;
  return async (refs, signal) => {
    const entities = [];
    for (let start = 0; start < refs.length; start += MOD_CONTEXT_MAX_QUERY_REFS) {
      const answer = await query(
        { kind: "data.entities", refs: refs.slice(start, start + MOD_CONTEXT_MAX_QUERY_REFS) },
        signal
      );
      if (!Array.isArray(answer?.entities)) throw new TypeError("data.entities answered no entity list");
      for (const entity of answer.entities) {
        if (typeof entity?.namespace === "string" && typeof entity.entityId === "string") {
          entities.push(entity);
        }
      }
    }
    return entities;
  };
}
function modContextCatalogStrings(context) {
  const query = context.query?.bind(context);
  if (query === void 0) return void 0;
  return async (keys, locales, signal) => {
    const strings = [];
    for (let start = 0; start < keys.length; start += MOD_CONTEXT_MAX_QUERY_REFS) {
      const answer = await query(
        {
          kind: "data.strings",
          keys: keys.slice(start, start + MOD_CONTEXT_MAX_QUERY_REFS),
          ...locales === void 0 ? {} : { locales }
        },
        signal
      );
      if (!Array.isArray(answer?.strings))
        throw new TypeError("data.strings answered no string list");
      for (const item of answer.strings)
        if (typeof item?.key === "string" && typeof item.value === "string")
          strings.push(item);
    }
    return strings;
  };
}
function subjectCatalogEntities(options, subjectUri) {
  let opened;
  const open = () => opened ??= (async () => {
    const [sources, uri] = await Promise.all([options.contentSources(), subjectUri()]);
    const target = subjectTarget(uri);
    if (sources?.openModContext === void 0 || target === void 0) return {};
    const baseMods = options.baseMods?.(target);
    const context = await sources.openModContext({
      schemaVersion: 1,
      target,
      ...baseMods === void 0 ? {} : { baseMods }
    });
    return { context };
  })();
  return Object.freeze({
    async entities(refs, signal) {
      const { context } = await open();
      const entities = context === void 0 ? void 0 : modContextCatalogEntities(context);
      return entities === void 0 ? [] : entities(refs, signal);
    },
    async strings(keys, locales, signal) {
      const { context } = await open();
      const strings = context === void 0 ? void 0 : modContextCatalogStrings(context);
      return strings === void 0 ? [] : strings(keys, locales, signal);
    },
    async release() {
      if (opened === void 0) return;
      const { context } = await opened.catch(() => ({}));
      await context?.dispose();
    }
  });
}
function operationCatalogQueries(result) {
  if (result.state !== "ok" || result.output.kind !== "json") return [];
  const value = result.output.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const queries = value[DATA_CATALOG_QUERIES_OUTPUT];
  if (!Array.isArray(queries)) return [];
  return queries.filter(
    (ref) => typeof ref?.namespace === "string" && ref.namespace !== "" && typeof ref.entityId === "string" && ref.entityId !== ""
  );
}
var recordOf2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
var nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
function parseOffer(value) {
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key2) => key2 !== "formatIds")) return void 0;
  const values = record["formatIds"];
  if (!Array.isArray(values) || values.length === 0 || !values.every(nonEmptyString) || new Set(values).size !== values.length)
    return void 0;
  return { formatIds: values };
}
function parseRequest(value) {
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key2) => key2 !== "formatId") || !nonEmptyString(record["formatId"]))
    return void 0;
  return { formatId: record["formatId"] };
}
function createFormatRouteMatcher(profile, invalidCode, route2) {
  return Object.freeze({
    profile: contractId(profile),
    major: 1,
    match(context) {
      const offer = parseOffer(context.offerFacet);
      const request = parseRequest(context.requestFacet);
      if (offer === void 0 || request === void 0) {
        return {
          state: "invalid",
          diagnostics: [
            diagnostic(
              "error",
              invalidCode,
              `${context.contract}@${context.major}: ${route2} route is malformed`
            )
          ]
        };
      }
      return offer.formatIds.includes(request.formatId) ? { state: "match", selectionKey: `format=${request.formatId}` } : { state: "no-match" };
    }
  });
}
var NATIVE_MODEL_ENCODER_MATCHER = createFormatRouteMatcher(
  NATIVE_MODEL_ENCODER_MATCHER_PROFILE,
  "x3.host/native-model-encoder-facet-invalid",
  "native model encoder"
);
var NATIVE_MODEL_ENCODER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: NATIVE_MODEL_ENCODER_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/native-model-encoder-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/native-model-encoder-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: NATIVE_MODEL_ENCODER_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.model/native-encoder-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "formatId", "extension", "mediaType"]),
    methods: Object.freeze({
      encode: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS = /* @__PURE__ */ new Set(["gameId"]);
function recordOf3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString2(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString2)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer2(value) {
  const record = recordOf3(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS.has(key2))) {
    return void 0;
  }
  const gameIds = stringList(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest2(value) {
  const record = recordOf3(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS.has(key2))) {
    return void 0;
  }
  return nonEmptyString2(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchDataCatalogFacets(context) {
  const offer = parseOffer2(context.offerFacet);
  const request = parseRequest2(context.requestFacet);
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
var RESOLVED_DATA_WORKSPACE_MATCHER = Object.freeze({
  profile: contractId(RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE),
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
      $ref: "https://schemas.modkit.org/x3/data-catalog-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/data-catalog-request.v1.schema.json"
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
var RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/data-catalog-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/data-catalog-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.data/resolved-workspace-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "providerId", "gameIds"]),
    methods: Object.freeze({
      plan: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 1048576 })
      }),
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 16777216, maxStringLength: 4194304 })
      }),
      analyzeAuthoringIndex: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 50331648, maxStringLength: 50331648 })
      }),
      openSchemaTree: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/tree-data-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openDefinitionTable: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/table-data-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openLocalizationTable: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/table-data-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openRelations: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/relation-graph-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openSubjectFacts: Object.freeze({
        kind: "lease",
        optional: true,
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/subject-facts-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openSubjectCalculations: Object.freeze({
        kind: "lease",
        optional: true,
        wrapper: "lease",
        result: Object.freeze({
          contract: "common.view/subject-calculations-source",
          major: 1
        }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      // Editing preview is optional and value-shaped: bytes are planned, never written here.
      resolveEditTarget: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 4194304 })
      }),
      // Editing preview is optional and value-shaped: bytes are planned, never written here.
      planEdit: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 16777216, maxStringLength: 16777216 })
      }),
      // Editing preview is optional and value-shaped: bytes are planned, never written here.
      analyzeIsolation: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 4194304 })
      }),
      // Editing preview is optional and value-shaped: bytes are planned, never written here.
      planIsolation: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 16777216, maxStringLength: 16777216 })
      })
    })
  })
});
function isResolvedDataWorkspace(value) {
  const record = recordOf3(value);
  return record?.["contract"] === RESOLVED_DATA_WORKSPACE_CONTRACT && nonEmptyString2(record["providerId"]) && stringList(record["gameIds"]) !== void 0 && typeof record["plan"] === "function" && typeof record["analyze"] === "function" && (record["analyzeAuthoringIndex"] === void 0 || typeof record["analyzeAuthoringIndex"] === "function") && typeof record["openSchemaTree"] === "function" && typeof record["openDefinitionTable"] === "function" && typeof record["openLocalizationTable"] === "function" && typeof record["openRelations"] === "function" && (record["resolveEditTarget"] === void 0 || typeof record["resolveEditTarget"] === "function") && (record["planEdit"] === void 0 || typeof record["planEdit"] === "function") && (record["analyzeIsolation"] === void 0 || typeof record["analyzeIsolation"] === "function") && (record["planIsolation"] === void 0 || typeof record["planIsolation"] === "function");
}
async function resolveResolvedDataWorkspace(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic(
          "information",
          "x3.host/resolved-data-workspace-unavailable",
          "this host registered no service-contract definitions, so workspace data cannot resolve"
        )
      ]
    };
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.budgets,
    ...request.signal === void 0 ? {} : { signal: request.signal }
  });
  try {
    const lease = await resolver.port.resolve({
      contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isResolvedDataWorkspace(lease.value) || !lease.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            "error",
            "x3.host/resolved-data-workspace-invalid",
            `the selected provider does not implement ${RESOLVED_DATA_WORKSPACE_CONTRACT}@1 for ${request.gameId}`
          )
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      workspace: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          "information",
          "x3.host/resolved-data-workspace-selected",
          `selected ${lease.value.providerId} for ${request.gameId}`
        )
      ]),
      release: () => resolver.release()
    });
  } catch (error) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          "information",
          "x3.host/resolved-data-workspace-unresolved",
          `no resolved data workspace provider resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`
        )
      ]
    };
  }
}
var DATA_WORKSPACE_LISTING_LIMITS = Object.freeze({ maxQueries: 64, maxPaths: 16384 });
async function planDataWorkspace(planner, request, listFiles) {
  const first = await planner.plan(request);
  const queries = first.listingQueries;
  if (listFiles === void 0 || !Array.isArray(queries) || queries.length === 0) return first;
  if (queries.length > DATA_WORKSPACE_LISTING_LIMITS.maxQueries) {
    throw new TypeError("resolved data provider asked for too many directory listings");
  }
  const roots = new Set(request.workspace.loadOrder.map((root) => root.rootId));
  const listings = [];
  for (const query of queries) {
    if (!roots.has(query.rootId)) {
      throw new TypeError(`resolved data provider asked to list unknown root ${query.rootId}`);
    }
    const prefix = query.prefix === "" ? "" : normalizeCompanionLogicalId(query.prefix);
    const listed = await listFiles(
      query.rootId,
      prefix,
      DATA_WORKSPACE_LISTING_LIMITS.maxPaths,
      request.signal
    );
    listings.push(
      Object.freeze({
        rootId: query.rootId,
        prefix,
        paths: Object.freeze(listed.paths.slice(0, DATA_WORKSPACE_LISTING_LIMITS.maxPaths)),
        complete: listed.complete && listed.paths.length <= DATA_WORKSPACE_LISTING_LIMITS.maxPaths
      })
    );
  }
  return planner.plan({ ...request, listings: Object.freeze(listings) });
}
function createResolvedDataSubjectSelectorLease(analyzed, inputLimits) {
  if (analyzed.openSubjectFacts === void 0 || analyzed.openSubjectCalculations === void 0) {
    return void 0;
  }
  const openSubjectFacts = analyzed.openSubjectFacts;
  const openSubjectCalculations = analyzed.openSubjectCalculations;
  const resolveSubjectEditTarget = analyzed.resolveEditTarget;
  const analyzeSubjectIsolation = analyzed.analyzeIsolation;
  const planSubjectIsolation = analyzed.planIsolation;
  const limits = Object.freeze({
    maxPageSize: positiveBound(inputLimits.maxPageSize, "maxPageSize"),
    maxEntities: positiveBound(inputLimits.maxEntities, "maxEntities"),
    maxRelations: positiveBound(inputLimits.maxRelations, "maxRelations"),
    maxCalculations: positiveBound(inputLimits.maxCalculations, "maxCalculations")
  });
  const snapshot = analyzed.snapshot;
  const localized = new Map(snapshot.localizedStrings.map((item) => [item.key, item.value]));
  const entitiesById = new Map(
    snapshot.definitions.map((entity) => [`${entity.namespace}/${entity.entityId}`, entity])
  );
  const subjects = Object.freeze(
    snapshot.definitions.map((entity) => {
      const authoredName = entity.fields["Name"];
      const label = typeof authoredName === "string" ? localized.get(authoredName) ?? entity.entityId : entity.entityId;
      const metadata = inputLimits.candidateMetadata?.(entity);
      if (metadata?.tags !== void 0 && (!Array.isArray(metadata.tags) || metadata.tags.some((tag) => typeof tag !== "string" || tag.length === 0) || new Set(metadata.tags).size !== metadata.tags.length)) {
        throw new TypeError("subject selector metadata contains invalid tags");
      }
      if (metadata?.asset !== void 0 && (typeof metadata.asset !== "object" || metadata.asset === null || typeof metadata.asset.formatId !== "string" || metadata.asset.formatId.length === 0 || !Array.isArray(metadata.asset.traits) || metadata.asset.traits.some((trait) => typeof trait !== "string" || trait.length === 0) || new Set(metadata.asset.traits).size !== metadata.asset.traits.length)) {
        throw new TypeError("subject selector metadata contains an invalid asset description");
      }
      return Object.freeze({
        subjectId: `${entity.namespace}/${entity.entityId}`,
        label,
        kind: entity.namespace,
        type: entity.typeId,
        ...metadata?.tags === void 0 ? {} : { tags: Object.freeze([...metadata.tags]) },
        ...metadata?.asset === void 0 ? {} : {
          asset: Object.freeze({
            formatId: metadata.asset.formatId,
            traits: Object.freeze([...metadata.asset.traits])
          })
        }
      });
    }).sort((left, right) => left.subjectId.localeCompare(right.subjectId))
  );
  const byId = new Map(subjects.map((item) => [item.subjectId, item]));
  let live = true;
  const assertLive = (signal) => {
    signal?.throwIfAborted();
    if (!live) throw new Error("resolved data subject selector lease has been released");
  };
  const page = (request, signal) => {
    assertLive(signal);
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > limits.maxPageSize) {
      throw new RangeError(`subject selector limit must be between 1 and ${limits.maxPageSize}`);
    }
    const text = request.text?.trim().toLocaleLowerCase("en-US");
    const filterText = request.filter?.text?.trim().toLocaleLowerCase("en-US");
    const sameTypeAs = request.filter?.sameTypeAs === void 0 ? void 0 : byId.get(request.filter.sameTypeAs);
    if (request.filter?.sameTypeAs !== void 0 && sameTypeAs === void 0) {
      throw new RangeError(
        `subject selector sameTypeAs anchor not found: ${request.filter.sameTypeAs}`
      );
    }
    const predicateId = request.filter?.predicate?.id;
    const predicate = predicateId === void 0 ? void 0 : inputLimits.predicates?.[predicateId];
    if (predicateId !== void 0 && predicate === void 0) {
      throw new RangeError(`subject selector predicate is unavailable: ${predicateId}`);
    }
    const matchesText = (subject, needle) => needle === void 0 || needle.length === 0 || subject.subjectId.toLocaleLowerCase("en-US").includes(needle) || subject.label.toLocaleLowerCase("en-US").includes(needle);
    const acceptsAsset = (subject) => {
      if (request.asset === void 0) return subject.asset === void 0;
      const asset = subject.asset;
      if (asset === void 0) return false;
      return (request.asset.formatIds === void 0 || request.asset.formatIds.includes(asset.formatId)) && (request.asset.traits === void 0 || request.asset.traits.every((trait) => asset.traits.includes(trait)));
    };
    const filtered = subjects.filter((subject) => {
      const tags = subject.tags ?? [];
      const entity = entitiesById.get(subject.subjectId);
      return acceptsAsset(subject) && (request.kind === void 0 || subject.kind === request.kind) && (request.type === void 0 || subject.type === request.type) && (request.filter?.type === void 0 || subject.type === request.filter.type) && (sameTypeAs === void 0 || subject.type === sameTypeAs.type) && matchesText(subject, text) && matchesText(subject, filterText) && (request.filter?.requireTags === void 0 || request.filter.requireTags.every((tag) => tags.includes(tag))) && (request.filter?.excludeTags === void 0 || request.filter.excludeTags.every((tag) => !tags.includes(tag))) && (predicate === void 0 || entity !== void 0 && predicate({
        subject,
        entity,
        ...sameTypeAs === void 0 ? {} : { sameTypeAs },
        ...request.filter?.predicate?.params === void 0 ? {} : { params: request.filter.predicate.params }
      }) === true);
    });
    const offset = request.cursor === void 0 ? 0 : Number(request.cursor.replace(/^subject:/u, ""));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > filtered.length || request.cursor !== void 0 && request.cursor !== `subject:${offset}`) {
      throw new RangeError("subject selector cursor is invalid or stale");
    }
    const end = Math.min(filtered.length, offset + request.limit);
    return Object.freeze({
      items: Object.freeze(filtered.slice(offset, end)),
      ...end < filtered.length ? { nextCursor: `subject:${end}` } : {}
    });
  };
  const selected = (subjectId, signal) => {
    assertLive(signal);
    const subject = byId.get(subjectId);
    if (subject === void 0) throw new RangeError(`resolved data subject not found: ${subjectId}`);
    return subject;
  };
  const documentRef = (value) => Object.freeze({
    rootId: value.rootId,
    path: value.path,
    ...value.revision === void 0 ? {} : { revision: value.revision }
  });
  const resolveTarget = resolveSubjectEditTarget === void 0 ? void 0 : async (request, signal) => {
    const subject = selected(request.subjectId, signal);
    try {
      const result = await resolveSubjectEditTarget({
        subject: {
          namespace: subject.kind,
          entityId: subject.subjectId.slice(subject.kind.length + 1)
        },
        fieldPath: request.fieldPath,
        ...request.targetDocument === void 0 ? {} : { targetDocument: request.targetDocument },
        ...signal === void 0 ? {} : { signal }
      });
      if (result.state === "selection-required") {
        return Object.freeze({
          state: "selection-required",
          snapshotId: result.snapshotId,
          workspaceId: result.workspaceId,
          selectedRootId: result.selectedRootId,
          subjectId: request.subjectId,
          fieldPath: Object.freeze([...result.fieldPath]),
          candidates: Object.freeze(result.candidates.map(documentRef)),
          reason: result.reason
        });
      }
      return Object.freeze({
        state: "resolved",
        snapshotId: result.snapshotId,
        workspaceId: result.workspaceId,
        selectedRootId: result.selectedRootId,
        subjectId: request.subjectId,
        fieldPath: Object.freeze([...result.fieldPath]),
        action: result.action,
        destination: Object.freeze({
          ...documentRef(result.target),
          ...result.writeTarget
        }),
        candidates: Object.freeze(result.candidates.map(documentRef)),
        ...result.lastDeclaration === void 0 ? {} : { lastDeclaration: documentRef(result.lastDeclaration) },
        ...result.effectiveFieldSource === void 0 ? {} : { effectiveFieldSource: documentRef(result.effectiveFieldSource) },
        selectionReason: result.selectionReason,
        guards: Object.freeze(result.guards.map(documentRef))
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      return Object.freeze({
        state: "unavailable",
        snapshotId: snapshot.snapshotId,
        subjectId: request.subjectId,
        fieldPath: Object.freeze([...request.fieldPath]),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  };
  const resolveIsolation = analyzeSubjectIsolation === void 0 ? void 0 : async (request, signal) => {
    const owner = selected(request.ownerSubjectId, signal);
    const target = selected(request.targetSubjectId, signal);
    const subjectId = (subject) => ({
      namespace: subject.kind,
      entityId: subject.subjectId.slice(subject.kind.length + 1)
    });
    const result = await analyzeSubjectIsolation({
      schemaVersion: 1,
      owner: subjectId(owner),
      target: subjectId(target),
      ownerFieldPath: request.ownerFieldPath,
      maxEdges: request.maxEdges,
      ...request.always === void 0 ? {} : { always: request.always },
      ...signal === void 0 ? {} : { signal }
    });
    const toSubjectId = (value) => `${value.namespace}/${value.entityId}`;
    if (result.state === "unavailable") {
      return Object.freeze({
        schemaVersion: 1,
        state: "unavailable",
        snapshotId: snapshot.snapshotId,
        ownerSubjectId: request.ownerSubjectId,
        targetSubjectId: request.targetSubjectId,
        ownerFieldPath: Object.freeze([...result.ownerFieldPath]),
        cloneRequired: false,
        reason: result.reason
      });
    }
    return Object.freeze({
      schemaVersion: 1,
      state: "ready",
      snapshotId: snapshot.snapshotId,
      ownerSubjectId: request.ownerSubjectId,
      targetSubjectId: request.targetSubjectId,
      ownerFieldPath: Object.freeze([...result.ownerFieldPath]),
      shared: result.shared,
      cloneRequired: result.cloneRequired,
      referrers: Object.freeze(
        result.referrers.map(
          (referrer) => Object.freeze({
            subjectId: toSubjectId(referrer.subject),
            fieldPaths: Object.freeze(
              referrer.fieldPaths.map((path) => Object.freeze([...path]))
            )
          })
        )
      ),
      otherReferrerIds: Object.freeze(result.otherReferrers.map(toSubjectId)),
      rewireFieldPaths: Object.freeze(
        result.rewireFieldPaths.map((path) => Object.freeze([...path]))
      )
    });
  };
  const resolveIsolationPlan = planSubjectIsolation === void 0 ? void 0 : async (request, signal) => {
    const owner = selected(request.ownerSubjectId, signal);
    const target = selected(request.targetSubjectId, signal);
    const clonePrefix = `${target.kind}/`;
    if (!request.cloneSubjectId.startsWith(clonePrefix) || request.cloneSubjectId.length === clonePrefix.length) {
      throw new TypeError(`cloneSubjectId must use namespace ${target.kind}`);
    }
    const entityRef = (subject) => ({
      namespace: subject.kind,
      entityId: subject.subjectId.slice(subject.kind.length + 1)
    });
    const result = await planSubjectIsolation({
      schemaVersion: 1,
      owner: entityRef(owner),
      target: entityRef(target),
      ownerFieldPath: request.ownerFieldPath,
      maxEdges: request.maxEdges,
      ...request.always === void 0 ? {} : { always: request.always },
      cloneEntityId: request.cloneSubjectId.slice(clonePrefix.length),
      ...request.ownerTargetDocument === void 0 ? {} : { ownerTargetDocument: request.ownerTargetDocument },
      ...request.cloneTargetDocument === void 0 ? {} : { cloneTargetDocument: request.cloneTargetDocument },
      ...signal === void 0 ? {} : { signal }
    });
    if (result.state === "unavailable") {
      return Object.freeze({
        schemaVersion: 1,
        state: "unavailable",
        snapshotId: snapshot.snapshotId,
        ownerSubjectId: request.ownerSubjectId,
        targetSubjectId: request.targetSubjectId,
        ownerFieldPath: Object.freeze([...result.ownerFieldPath]),
        cloneRequired: false,
        reason: result.reason
      });
    }
    if (result.state === "selection-required") {
      return Object.freeze({
        schemaVersion: 1,
        state: "selection-required",
        snapshotId: result.snapshotId,
        ownerSubjectId: request.ownerSubjectId,
        targetSubjectId: request.targetSubjectId,
        cloneSubjectId: request.cloneSubjectId,
        purpose: result.purpose,
        candidates: Object.freeze(result.candidates.map(documentRef)),
        reason: result.reason
      });
    }
    const toSubjectId = (value) => `${value.namespace}/${value.entityId}`;
    const analysis = Object.freeze({
      schemaVersion: 1,
      state: "ready",
      snapshotId: result.snapshotId,
      ownerSubjectId: request.ownerSubjectId,
      targetSubjectId: request.targetSubjectId,
      ownerFieldPath: Object.freeze([...result.analysis.ownerFieldPath]),
      shared: result.analysis.shared,
      cloneRequired: result.analysis.cloneRequired,
      referrers: Object.freeze(
        result.analysis.referrers.map(
          (referrer) => Object.freeze({
            subjectId: toSubjectId(referrer.subject),
            fieldPaths: Object.freeze(
              referrer.fieldPaths.map((path) => Object.freeze([...path]))
            )
          })
        )
      ),
      otherReferrerIds: Object.freeze(result.analysis.otherReferrers.map(toSubjectId)),
      rewireFieldPaths: Object.freeze(
        result.analysis.rewireFieldPaths.map((path) => Object.freeze([...path]))
      )
    });
    return Object.freeze({
      schemaVersion: 1,
      state: "planned",
      snapshotId: result.snapshotId,
      previewSnapshotId: result.previewSnapshotId,
      ownerSubjectId: request.ownerSubjectId,
      targetSubjectId: request.targetSubjectId,
      cloneSubjectId: request.cloneSubjectId,
      analysis,
      replacements: Object.freeze(
        result.replacements.map(
          (replacement) => Object.freeze({
            purpose: replacement.purpose,
            destination: Object.freeze({
              ...documentRef(replacement.target),
              ...replacement.writeTarget
            }),
            replacementBytes: new TextEncoder().encode(replacement.replacementText).byteLength
          })
        )
      ),
      diagnostics: Object.freeze(
        result.diagnostics.map(
          (item) => Object.freeze({
            severity: item.severity,
            code: item.code,
            message: item.message
          })
        )
      )
    });
  };
  const source = Object.freeze({
    async summary(signal) {
      assertLive(signal);
      return Object.freeze({
        snapshotId: snapshot.snapshotId,
        totalSubjects: subjects.length,
        completeness: snapshot.complete ? "complete" : "partial",
        ...snapshot.complete ? {} : { reason: "the resolved data workspace is incomplete" }
      });
    },
    subjects: async (request, signal) => page(request, signal),
    ...resolveIsolation === void 0 ? {} : { isolation: resolveIsolation },
    ...resolveIsolationPlan === void 0 ? {} : { isolationPlan: resolveIsolationPlan },
    async openFacts(subjectId, signal) {
      const subject = selected(subjectId, signal);
      const lease = await openSubjectFacts({
        subject: {
          namespace: subject.kind,
          entityId: subject.subjectId.slice(subject.kind.length + 1)
        },
        ...limits,
        ...signal === void 0 ? {} : { signal }
      });
      if (resolveTarget === void 0) return lease;
      const facts = lease.value;
      const entityId = subject.subjectId.slice(subject.kind.length + 1);
      const fieldPathOf = (fact) => fact.provenance.map((item) => item.semanticPath).find(
        (path) => path !== void 0 && path.length > 2 && path[0] === subject.kind && path[1] === entityId
      )?.slice(2);
      const projected = Object.freeze({
        summary: (nestedSignal) => facts.summary(nestedSignal),
        groups: (pageRequest, nestedSignal) => facts.groups(pageRequest, nestedSignal),
        async facts(groupId, pageRequest, nestedSignal) {
          const result = await facts.facts(groupId, pageRequest, nestedSignal);
          const items = await Promise.all(
            result.items.map(async (fact) => {
              const fieldPath = fieldPathOf(fact);
              if (fieldPath === void 0 || fieldPath.length === 0) return fact;
              const editTarget = await resolveTarget(
                { subjectId: subject.subjectId, fieldPath },
                nestedSignal
              );
              return Object.freeze({ ...fact, editTarget });
            })
          );
          return Object.freeze({
            ...result,
            items: Object.freeze(items)
          });
        },
        relations: (pageRequest, nestedSignal) => facts.relations(pageRequest, nestedSignal)
      });
      return Object.freeze({
        value: projected,
        release: () => lease.release()
      });
    },
    async openCalculations(subjectId, signal) {
      const subject = selected(subjectId, signal);
      return openSubjectCalculations({
        subject: {
          namespace: subject.kind,
          entityId: subject.subjectId.slice(subject.kind.length + 1)
        },
        maxPageSize: limits.maxPageSize,
        maxEntities: limits.maxEntities,
        maxCalculations: limits.maxCalculations,
        ...signal === void 0 ? {} : { signal }
      });
    },
    ...resolveTarget === void 0 ? {} : {
      editTarget: resolveTarget
    }
  });
  return Object.freeze({
    value: source,
    release() {
      live = false;
      return Promise.resolve();
    }
  });
}
function positiveBound(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}
function confinedPath(value, label) {
  if (value.includes("\0") || /^[a-z]:[\\/]/iu.test(value) || /^[\\/]/u.test(value) || /^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    throw new TypeError(`${label} must be a confined logical path`);
  }
  const parts = [];
  for (const part of value.replace(/\\/gu, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new TypeError(`${label} must not escape its workspace root`);
    parts.push(part);
  }
  if (parts.length === 0) throw new TypeError(`${label} must name a logical path`);
  return parts.join("/");
}
function comparableLocale(value) {
  return value.replace(/[-_]/gu, "").toLocaleLowerCase();
}
function validateWorkspacePlan(plan, workspace, locales, maximum) {
  if (plan.schemaVersion !== 1 || plan.workspaceId !== workspace.workspaceId || plan.gameId !== workspace.gameId || !Array.isArray(plan.requirements) || plan.requirements.length > maximum) {
    throw new TypeError("resolved data provider returned an invalid or mismatched workspace plan");
  }
  const roots = new Map(workspace.loadOrder.map((root, index) => [root.rootId, { root, index }]));
  const logical = new Map(
    (workspace.logicalRoots ?? [...workspace.loadOrder].reverse()).map((root, index) => [
      root.rootId,
      index
    ])
  );
  const localeRanks = new Map(
    locales.map((locale, index) => [comparableLocale(locale), index])
  );
  const requirementIds = /* @__PURE__ */ new Set();
  let catalogRank = -1;
  let localizationRank = -1;
  let localizationStarted = false;
  for (const requirement of plan.requirements) {
    if (requirement.required !== void 0 && typeof requirement.required !== "boolean") {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} has invalid required flag`
      );
    }
    if (requirement.encoding !== void 0 && requirement.encoding !== "text" && requirement.encoding !== "binary") {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} has invalid encoding`
      );
    }
    if (requirementIds.has(requirement.requirementId)) {
      throw new TypeError(`workspace data requirement ${requirement.requirementId} is duplicated`);
    }
    requirementIds.add(requirement.requirementId);
    const root = roots.get(requirement.rootId);
    if (root === void 0) {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} names unknown root`
      );
    }
    const rootPath = root.root.sourcePath === "" ? "" : confinedPath(root.root.sourcePath, `${requirement.requirementId}.root`);
    const path = confinedPath(requirement.path, `${requirement.requirementId}.path`);
    const foldedRoot = rootPath.toLocaleLowerCase();
    const foldedPath = path.toLocaleLowerCase();
    if (rootPath !== "" && foldedPath !== foldedRoot && !foldedPath.startsWith(`${foldedRoot}/`)) {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} escapes its root`
      );
    }
    if (requirement.kind === "usage") continue;
    if (requirement.kind === "catalog") {
      if (localizationStarted) {
        throw new TypeError("catalog requirements must precede localization requirements");
      }
      if (root.index < catalogRank) {
        throw new TypeError("catalog requirements are not in dependency-first loadOrder");
      }
      catalogRank = root.index;
      continue;
    }
    if (requirement.kind !== "localization" || requirement.locale === void 0) {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} has invalid kind`
      );
    }
    localizationStarted = true;
    const localeRank = localeRanks.get(comparableLocale(requirement.locale));
    const rootRank = logical.get(requirement.rootId);
    if (localeRank === void 0 || rootRank === void 0) {
      throw new TypeError(
        `workspace localization requirement ${requirement.requirementId} is invalid`
      );
    }
    const rank = localeRank * workspace.loadOrder.length + rootRank;
    if (rank < localizationRank) {
      throw new TypeError("localization requirements are not locale-first and winner-first");
    }
    localizationRank = rank;
  }
}
async function readResourceText(resources, requirement, maxDocumentBytes, signal) {
  let resolved;
  try {
    resolved = await resources.resolve(
      {
        id: requirement.requirementId,
        logicalId: requirement.path,
        role: "buffer",
        scopes: ["current-mount", "enclosing-container", "workspace-dependency-layer"]
      },
      signal
    );
  } catch (error) {
    signal?.throwIfAborted();
    return {
      state: "unresolved",
      diagnostic: diagnostic(
        "warning",
        "x3.host/resolved-data-resource-open-failed",
        `${requirement.path}: ${error instanceof Error ? error.message : String(error)}`
      )
    };
  }
  if (resolved.state === "unresolved") {
    return { state: "unresolved", diagnostic: resolved.diagnostic };
  }
  try {
    const source = resolved.lease.value;
    if (source.kind !== "bytes") {
      return {
        state: "unresolved",
        diagnostic: diagnostic(
          "warning",
          "x3.host/resolved-data-resource-not-bytes",
          `${requirement.path} resolved to a namespace instead of bytes`
        )
      };
    }
    if (source.size !== void 0 && source.size > BigInt(maxDocumentBytes)) {
      return {
        state: "unresolved",
        diagnostic: diagnostic(
          "warning",
          "x3.host/resolved-data-document-budget-exceeded",
          `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`
        )
      };
    }
    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of source.stream(void 0, signal)) {
        bytes += chunk.byteLength;
        if (bytes > maxDocumentBytes) {
          return {
            state: "unresolved",
            diagnostic: diagnostic(
              "warning",
              "x3.host/resolved-data-document-budget-exceeded",
              `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`
            )
          };
        }
        chunks.push(chunk);
      }
    } catch (error) {
      signal?.throwIfAborted();
      return {
        state: "unresolved",
        diagnostic: diagnostic(
          "warning",
          "x3.host/resolved-data-resource-read-failed",
          `${requirement.path}: ${error instanceof Error ? error.message : String(error)}`
        )
      };
    }
    const content = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      state: "resolved",
      ...requirement.encoding === "binary" ? { text: "", bytes: content } : { text: new TextDecoder("utf-8", { fatal: false }).decode(content) },
      revision: resolved.revision,
      source: Object.freeze({ ...source.ref })
    };
  } finally {
    await resolved.lease.release();
  }
}
function directDataDocumentTarget(rootId, path, source, revision) {
  const expectedRevision = Object.freeze({
    bindings: Object.freeze({ [source.id]: revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: "single",
      bindingId: source.id,
      source: { id: source.id, uri: source.uri },
      revision
    })
  });
  return Object.freeze({
    rootId,
    path,
    target: Object.freeze({
      targetId: source.id,
      subjectUri: source.uri,
      ownerSource: source,
      semanticPath: Object.freeze([]),
      expectedRevision
    })
  });
}
function sameLogicalDocument(left, right) {
  const key2 = (value) => value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "").toLowerCase();
  return left.rootId === right.rootId && key2(left.path) === key2(right.path);
}
function pathInsideWritableRoot(path, root) {
  const normalize2 = (value) => value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "").split("/");
  const pathParts = normalize2(path);
  const rootParts = normalize2(root.sourcePath);
  if (rootParts.length === 0 || pathParts.length <= rootParts.length || rootParts.some((part, index) => part.toLowerCase() !== pathParts[index]?.toLowerCase())) {
    throw new TypeError(`edit path ${path} is outside writable root ${root.sourcePath}`);
  }
  const relative = pathParts.slice(rootParts.length);
  if (relative.some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError(`edit path ${path} is not confined inside ${root.sourcePath}`);
  }
  return relative.join("/");
}
function storedSpelling(path, subjectUri) {
  const parts = path.replace(/\\/gu, "/").split("/").filter((part) => part !== "");
  let stored;
  try {
    stored = decodeURIComponent(new URL(subjectUri).pathname).split("/").filter((part) => part !== "");
  } catch {
    return path;
  }
  const tail = stored.slice(-parts.length);
  return tail.length === parts.length && tail.every((part, index) => part.toLowerCase() === parts[index]?.toLowerCase()) ? tail.join("/") : path;
}
function bindResolvedDataEditDestination(resolved, documents, writableRoots) {
  const binding = resolved.target.mode === "replace" ? documents.find((document2) => sameLogicalDocument(document2, resolved.target))?.target : writableRoots.find((root) => root.rootId === resolved.selectedRootId)?.target;
  if (binding === void 0) {
    throw new TypeError(
      resolved.target.mode === "replace" ? "resolved edit target has no host document binding" : `active mod ${resolved.selectedRootId} has no writable namespace binding`
    );
  }
  const path = resolved.target.mode === "replace" ? storedSpelling(resolved.target.path, binding.subjectUri) : resolved.target.path;
  return Object.freeze({
    rootId: resolved.target.rootId,
    path,
    mode: resolved.target.mode,
    label: `Write: ${resolved.target.rootId} \u2192 ${path}`,
    targetId: binding.targetId,
    subjectUri: binding.subjectUri
  });
}
function bindDataDocumentDestination(target, selectedRootId, documents, writableRoots) {
  const binding = target.mode === "replace" ? documents.find((document2) => sameLogicalDocument(document2, target))?.target : writableRoots.find((root) => root.rootId === selectedRootId)?.target;
  if (binding === void 0) {
    throw new TypeError(
      target.mode === "replace" ? "resolved isolation target has no host document binding" : `active mod ${selectedRootId} has no writable namespace binding`
    );
  }
  const path = target.mode === "replace" ? storedSpelling(target.path, binding.subjectUri) : target.path;
  return Object.freeze({
    rootId: target.rootId,
    path,
    mode: target.mode,
    label: `Write: ${target.rootId} \u2192 ${path}`,
    targetId: binding.targetId,
    subjectUri: binding.subjectUri
  });
}
var DATA_EDIT_SELECTION_REQUIRED = "x3.host/resolved-data-edit-selection-required";
function dataEditSelectionRequired(result) {
  return new ModkitError({
    code: DATA_EDIT_SELECTION_REQUIRED,
    message: `choose a destination document: ${result.reason}`,
    context: {
      reason: result.reason,
      candidates: result.candidates.map((item) => ({ rootId: item.rootId, path: item.path }))
    }
  });
}
function editChangeFromDataEditProposal(proposal, documentTargets, writableRoots) {
  const resolved = proposal.target;
  const guarded = [];
  const targetIds = /* @__PURE__ */ new Set();
  for (const guard of resolved.guards) {
    const binding = documentTargets.find((candidate) => sameLogicalDocument(candidate, guard));
    if (binding === void 0 || guard.revision === void 0) {
      throw new TypeError(
        `no host document binding exists for guarded ${guard.rootId}/${guard.path}`
      );
    }
    const revisions = Object.values(binding.target.expectedRevision.bindings);
    if (revisions.length !== 1 || revisions[0] !== guard.revision) {
      throw new TypeError(
        `host document binding revision changed for ${guard.rootId}/${guard.path}`
      );
    }
    if (!targetIds.has(binding.target.targetId)) {
      targetIds.add(binding.target.targetId);
      guarded.push(binding.target);
    }
  }
  let editTarget;
  let edit;
  if (resolved.target.mode === "replace") {
    const binding = documentTargets.find(
      (candidate) => sameLogicalDocument(candidate, resolved.target)
    );
    if (binding === void 0 || !targetIds.has(binding.target.targetId)) {
      throw new TypeError("resolved replacement target is not one of the guarded host documents");
    }
    editTarget = binding.target;
    edit = Object.freeze({
      operation: "replace",
      targetId: editTarget.targetId,
      source: editTarget.ownerSource,
      payload: Object.freeze({ kind: "text", text: proposal.replacementText }),
      label: `edit SC2 data ${resolved.subject.namespace}/${resolved.subject.entityId}`
    });
  } else {
    const root = writableRoots.find((candidate) => candidate.rootId === resolved.selectedRootId);
    if (root === void 0 || root.target.expectedRevision.namespaceRevision === void 0) {
      throw new TypeError(`active mod ${resolved.selectedRootId} has no writable namespace binding`);
    }
    editTarget = root.target;
    if (!targetIds.has(editTarget.targetId)) {
      targetIds.add(editTarget.targetId);
      guarded.push(editTarget);
    }
    edit = Object.freeze({
      operation: "create",
      targetId: editTarget.targetId,
      source: editTarget.ownerSource,
      newPath: pathInsideWritableRoot(resolved.target.path, root),
      payload: Object.freeze({ kind: "text", text: proposal.replacementText }),
      label: `declare SC2 data ${resolved.subject.namespace}/${resolved.subject.entityId}`
    });
  }
  return Object.freeze({
    targets: Object.freeze(guarded),
    edits: Object.freeze([edit]),
    semanticIntent: Object.freeze({
      kind: "sc2-authored-text-save-v1",
      formatId: "sc2-data",
      sourceComplete: true,
      unknownDataPolicy: "preserve-from-complete-snapshot",
      workspaceId: resolved.workspaceId,
      snapshotId: resolved.snapshotId,
      selectedRootId: resolved.selectedRootId,
      targetPath: resolved.target.path,
      editIntent: proposal.intent,
      previewSnapshotId: proposal.previewSnapshotId
    }),
    provenance: Object.freeze({ actor: "user", note: "resolved SC2 data field edit" })
  });
}
function isolationChangeFromDataGraphProposal(proposal, documentTargets, writableRoots) {
  const guarded = [];
  const guardedIds = /* @__PURE__ */ new Set();
  for (const guard of proposal.guards) {
    const binding = documentTargets.find((candidate) => sameLogicalDocument(candidate, guard));
    if (binding === void 0 || guard.revision === void 0) {
      throw new TypeError(`no host document binding exists for guarded ${guard.rootId}/${guard.path}`);
    }
    const revisions = Object.values(binding.target.expectedRevision.bindings);
    if (revisions.length !== 1 || revisions[0] !== guard.revision) {
      throw new TypeError(`host document binding revision changed for ${guard.rootId}/${guard.path}`);
    }
    if (!guardedIds.has(binding.target.targetId)) {
      guardedIds.add(binding.target.targetId);
      guarded.push(binding.target);
    }
  }
  const paths = /* @__PURE__ */ new Set();
  const edits = [];
  for (const replacement of proposal.replacements) {
    if (replacement.target.rootId !== proposal.selectedRootId) {
      throw new TypeError("isolation replacement escaped the selected writable mod");
    }
    const pathIdentity = `${replacement.target.rootId}\0${replacement.target.path.toLowerCase()}`;
    if (paths.has(pathIdentity)) throw new TypeError("isolation proposal contains duplicate targets");
    paths.add(pathIdentity);
    if (replacement.target.mode === "replace") {
      const binding = documentTargets.find(
        (candidate) => sameLogicalDocument(candidate, replacement.target)
      );
      if (binding === void 0 || !guardedIds.has(binding.target.targetId)) {
        throw new TypeError("isolation replacement target is not a guarded host document");
      }
      edits.push(
        Object.freeze({
          operation: "replace",
          targetId: binding.target.targetId,
          source: binding.target.ownerSource,
          payload: Object.freeze({ kind: "text", text: replacement.replacementText }),
          label: `${replacement.purpose} SC2 data object`
        })
      );
      continue;
    }
    const root = writableRoots.find((candidate) => candidate.rootId === proposal.selectedRootId);
    if (root === void 0 || root.target.expectedRevision.namespaceRevision === void 0) {
      throw new TypeError(`active mod ${proposal.selectedRootId} has no writable namespace binding`);
    }
    if (!guardedIds.has(root.target.targetId)) {
      guardedIds.add(root.target.targetId);
      guarded.push(root.target);
    }
    edits.push(
      Object.freeze({
        operation: "create",
        targetId: root.target.targetId,
        source: root.target.ownerSource,
        newPath: pathInsideWritableRoot(replacement.target.path, root),
        payload: Object.freeze({ kind: "text", text: replacement.replacementText }),
        label: `${replacement.purpose} SC2 data object`
      })
    );
  }
  if (edits.length === 0) throw new TypeError("isolation proposal contains no replacements");
  return Object.freeze({
    targets: Object.freeze(guarded),
    edits: Object.freeze(edits),
    semanticIntent: Object.freeze({
      // The authored-text writer accepts exactly one save contract; the isolation rides in editIntent.
      kind: "sc2-authored-text-save-v1",
      formatId: "sc2-data",
      sourceComplete: true,
      unknownDataPolicy: "preserve-from-complete-snapshot",
      workspaceId: proposal.workspaceId,
      snapshotId: proposal.snapshotId,
      selectedRootId: proposal.selectedRootId,
      editIntent: Object.freeze({
        kind: "isolate-shared-object",
        clone: Object.freeze({ ...proposal.clone }),
        owner: Object.freeze({ ...proposal.analysis.owner }),
        target: Object.freeze({ ...proposal.analysis.target }),
        ownerFieldPath: Object.freeze([...proposal.analysis.ownerFieldPath])
      }),
      previewSnapshotId: proposal.previewSnapshotId
    }),
    provenance: Object.freeze({ actor: "user", note: "resolved SC2 data clone and rewire" })
  });
}
async function analyzeResolvedDataWorkspace(request) {
  const limits = {
    maxRequirements: positiveBound(request.limits.maxRequirements, "maxRequirements"),
    maxDocumentBytes: positiveBound(request.limits.maxDocumentBytes, "maxDocumentBytes"),
    maxTextBytes: positiveBound(request.limits.maxTextBytes, "maxTextBytes"),
    maxEntities: positiveBound(request.limits.maxEntities, "maxEntities"),
    maxDepth: positiveBound(request.limits.maxDepth, "maxDepth"),
    maxPageSize: positiveBound(request.limits.maxPageSize, "maxPageSize")
  };
  if (request.resources.state() !== "live") {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic(
          "warning",
          "x3.host/resolved-data-resource-session-disposed",
          "workspace data requires a live revision-pinned ResourceSessionPort"
        )
      ]
    };
  }
  const resolution = await resolveResolvedDataWorkspace({
    services: request.services,
    gameId: request.workspace.gameId,
    grant: request.grant,
    budgets: request.budgets,
    ...request.signal === void 0 ? {} : { signal: request.signal }
  });
  if (resolution.state === "unresolved") return resolution;
  const diagnostics = [...resolution.diagnostics];
  const opened = [];
  try {
    const plan = await planDataWorkspace(
      resolution.workspace,
      {
        workspace: request.workspace,
        locales: request.locales,
        maxRequirements: limits.maxRequirements,
        ...request.signal === void 0 ? {} : { signal: request.signal }
      },
      request.listFiles
    );
    validateWorkspacePlan(plan, request.workspace, request.locales, limits.maxRequirements);
    const writableRoots = Object.freeze([...request.writableRoots ?? []]);
    const writableRootIds = /* @__PURE__ */ new Set();
    for (const writable of writableRoots) {
      const workspaceRoot = request.workspace.loadOrder.find(
        (root) => root.rootId === writable.rootId
      );
      if (workspaceRoot === void 0 || writableRootIds.has(writable.rootId) || !sameLogicalDocument(
        { rootId: writable.rootId, path: writable.sourcePath },
        { rootId: workspaceRoot.rootId, path: workspaceRoot.sourcePath }
      ) || writable.target.expectedRevision.namespaceRevision === void 0) {
        throw new TypeError(`writable root ${writable.rootId} is not this workspace namespace`);
      }
      writableRootIds.add(writable.rootId);
    }
    diagnostics.push(
      ...plan.diagnostics.map(
        (item) => diagnostic(item.severity, item.code, item.message, void 0, {
          analyzerId: plan.analyzerId
        })
      )
    );
    if (!plan.complete) {
      await resolution.release();
      return {
        state: "unresolved",
        diagnostics: Object.freeze(diagnostics)
      };
    }
    let textBytes = 0;
    const documents = [];
    const localizationDocuments = [];
    const usageDocuments = [];
    const documentTargets = [];
    const unresolvedRequirementIds = [];
    const revisions = [];
    for (const requirement of plan.requirements) {
      request.signal?.throwIfAborted();
      const loaded = await readResourceText(
        request.resources,
        requirement,
        limits.maxDocumentBytes,
        request.signal
      );
      if (loaded.state === "unresolved") {
        if (requirement.required !== false) {
          diagnostics.push(loaded.diagnostic);
          unresolvedRequirementIds.push(requirement.requirementId);
        }
        continue;
      }
      textBytes += loaded.bytes?.byteLength ?? new TextEncoder().encode(loaded.text).byteLength;
      if (textBytes > limits.maxTextBytes) {
        throw new TypeError(`workspace data exceeds maxTextBytes ${limits.maxTextBytes}`);
      }
      revisions.push(`${requirement.requirementId}@${String(loaded.revision)}`);
      const document2 = {
        rootId: requirement.rootId,
        path: requirement.path,
        text: loaded.text,
        ...loaded.bytes === void 0 ? {} : { bytes: loaded.bytes },
        revision: loaded.revision
      };
      if (requirement.kind === "catalog") {
        documents.push(document2);
        documentTargets.push(
          directDataDocumentTarget(
            requirement.rootId,
            requirement.path,
            loaded.source,
            loaded.revision
          )
        );
      } else if (requirement.kind === "usage") usageDocuments.push(document2);
      else localizationDocuments.push({ ...document2, locale: requirement.locale });
    }
    if (documents.length === 0) {
      await resolution.release();
      return {
        state: "unresolved",
        diagnostics: Object.freeze([
          ...diagnostics,
          diagnostic(
            "warning",
            "x3.host/resolved-data-catalog-unavailable",
            "no planned catalog document resolved through the resource session"
          )
        ])
      };
    }
    if (request.resources.state() !== "live") {
      throw new Error("resource session was disposed while workspace data was loading");
    }
    const snapshot = await resolution.workspace.analyze({
      workspaceId: request.workspace.workspaceId,
      gameId: request.workspace.gameId,
      documents,
      localizationDocuments,
      ...usageDocuments.length === 0 ? {} : { usageDocuments },
      locales: request.locales,
      localizationKeys: request.localizationKeys ?? [],
      queries: request.queries,
      plannedDocumentCount: documents.length + localizationDocuments.length + usageDocuments.length + unresolvedRequirementIds.length,
      unresolvedRequirementIds,
      snapshotId: `${String(request.resources.revision)}:${revisions.join("|")}`,
      maxDocuments: limits.maxRequirements,
      maxTextBytes: limits.maxTextBytes,
      maxEntities: limits.maxEntities,
      maxDepth: limits.maxDepth,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (request.resources.state() !== "live") {
      throw new Error("resource session was disposed while workspace data was analyzed");
    }
    const facetRequest = {
      snapshotId: snapshot.snapshotId,
      maxPageSize: limits.maxPageSize,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    };
    const schemaTree = await resolution.workspace.openSchemaTree(facetRequest);
    opened.push(schemaTree);
    const definitions = await resolution.workspace.openDefinitionTable(facetRequest);
    opened.push(definitions);
    const localization = await resolution.workspace.openLocalizationTable(facetRequest);
    opened.push(localization);
    const relations = await resolution.workspace.openRelations(facetRequest);
    opened.push(relations);
    let released = false;
    const openSubjectFacts = resolution.workspace.openSubjectFacts;
    const openSubjectCalculations = resolution.workspace.openSubjectCalculations;
    const resolveEditTarget = resolution.workspace.resolveEditTarget;
    const planEdit = resolution.workspace.planEdit;
    const analyzeIsolation = resolution.workspace.analyzeIsolation;
    const planIsolation = resolution.workspace.planIsolation;
    const activeRootId = request.workspace.activeRootId;
    const writableRootIdList = Object.freeze([...writableRootIds]);
    return Object.freeze({
      state: "resolved",
      snapshot,
      plan,
      facets: Object.freeze({ schemaTree, definitions, localization, relations }),
      ...openSubjectFacts === void 0 ? {} : {
        async openSubjectFacts(request2) {
          if (released) throw new Error("resolved data workspace analysis is released");
          const lease = await openSubjectFacts.call(resolution.workspace, {
            ...request2,
            snapshotId: snapshot.snapshotId
          });
          if (released) {
            await lease.release();
            throw new Error("resolved data workspace analysis was released while opening facts");
          }
          opened.push(lease);
          return lease;
        }
      },
      ...openSubjectCalculations === void 0 ? {} : {
        async openSubjectCalculations(request2) {
          if (released) throw new Error("resolved data workspace analysis is released");
          const lease = await openSubjectCalculations.call(resolution.workspace, {
            ...request2,
            snapshotId: snapshot.snapshotId
          });
          if (released) {
            await lease.release();
            throw new Error(
              "resolved data workspace analysis was released while opening calculations"
            );
          }
          opened.push(lease);
          return lease;
        }
      },
      ...resolveEditTarget === void 0 ? {} : {
        async resolveEditTarget(request2) {
          if (released) throw new Error("resolved data workspace analysis is released");
          const result = await resolveEditTarget.call(resolution.workspace, {
            ...request2,
            snapshotId: snapshot.snapshotId,
            selectedRootId: activeRootId,
            writableRootIds: writableRootIdList
          });
          if (released) {
            throw new Error(
              "resolved data workspace analysis was released while resolving an edit target"
            );
          }
          return result.state === "resolved" ? Object.freeze({
            ...result,
            writeTarget: bindResolvedDataEditDestination(
              result,
              documentTargets,
              writableRoots
            )
          }) : result;
        }
      },
      ...planEdit === void 0 ? {} : {
        async planEdit(request2) {
          if (released) throw new Error("resolved data workspace analysis is released");
          const result = await planEdit.call(resolution.workspace, {
            ...request2,
            snapshotId: snapshot.snapshotId,
            selectedRootId: activeRootId,
            writableRootIds: writableRootIdList
          });
          if (released) {
            throw new Error(
              "resolved data workspace analysis was released while planning an edit"
            );
          }
          return result;
        }
      },
      ...planEdit === void 0 ? {} : {
        async buildEditChange(request2) {
          if (released) throw new Error("resolved data workspace analysis is released");
          const result = await planEdit.call(resolution.workspace, {
            ...request2,
            snapshotId: snapshot.snapshotId,
            selectedRootId: activeRootId,
            writableRootIds: writableRootIdList
          });
          if (released) {
            throw new Error(
              "resolved data workspace analysis was released while planning an asset edit"
            );
          }
          if ("state" in result) throw dataEditSelectionRequired(result);
          return editChangeFromDataEditProposal(result, documentTargets, writableRoots);
        }
      },
      ...analyzeIsolation === void 0 ? {} : {
        async analyzeIsolation(request2) {
          if (released) throw new Error("resolved data workspace analysis is released");
          const result = await analyzeIsolation.call(resolution.workspace, {
            ...request2,
            snapshotId: snapshot.snapshotId
          });
          if (released) {
            throw new Error(
              "resolved data workspace analysis was released while analyzing isolation"
            );
          }
          return result;
        }
      },
      ...planIsolation === void 0 ? {} : {
        async planIsolation(request2) {
          if (released) throw new Error("resolved data workspace analysis is released");
          const result = await planIsolation.call(resolution.workspace, {
            ...request2,
            schemaVersion: 1,
            snapshotId: snapshot.snapshotId,
            selectedRootId: activeRootId,
            writableRootIds: writableRootIdList
          });
          if (released) throw new Error("resolved data workspace analysis was released while planning isolation");
          return result.state === "planned" ? Object.freeze({
            ...result,
            replacements: Object.freeze(
              result.replacements.map(
                (replacement) => Object.freeze({
                  ...replacement,
                  writeTarget: bindDataDocumentDestination(
                    replacement.target,
                    result.selectedRootId,
                    documentTargets,
                    writableRoots
                  )
                })
              )
            )
          }) : result;
        },
        async buildIsolationChange(request2) {
          if (released) throw new Error("resolved data workspace analysis is released");
          const result = await planIsolation.call(resolution.workspace, {
            ...request2,
            schemaVersion: 1,
            snapshotId: snapshot.snapshotId,
            selectedRootId: activeRootId,
            writableRootIds: writableRootIdList
          });
          if (released) throw new Error("resolved data workspace analysis was released while planning isolation");
          if (result.state === "selection-required") throw dataEditSelectionRequired(result);
          if (result.state !== "planned") throw new TypeError(result.reason);
          return isolationChangeFromDataGraphProposal(result, documentTargets, writableRoots);
        }
      },
      diagnostics: Object.freeze(diagnostics),
      async release() {
        if (released) return;
        released = true;
        const results = await Promise.allSettled([
          ...[...opened].reverse().map((lease) => lease.release()),
          resolution.release()
        ]);
        const failure2 = results.find((result) => result.status === "rejected");
        if (failure2?.status === "rejected") throw failure2.reason;
      }
    });
  } catch (error) {
    await Promise.allSettled([...opened].reverse().map((lease) => lease.release()));
    await resolution.release();
    if (request.signal?.aborted) throw error;
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...diagnostics,
        diagnostic(
          "warning",
          "x3.host/resolved-data-workspace-failed",
          error instanceof Error ? error.message : String(error)
        )
      ])
    };
  }
}
var NAMESPACE = "common.view/namespace-entry-source";
var BYTE_RANGE = "common.view/byte-range-source";
var EXTRACT_HANDLER = "x3.host/single-file-extract";
var ENTRY_ID = "subject";
function fileNameOf(subjectUri) {
  const path = subjectUri.replace(/[?#].*$/u, "");
  const last = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last) || "subject";
  } catch {
    return last || "subject";
  }
}
async function singleFileAsContainer(session, maxBytes) {
  const descriptor = await session.descriptor();
  const has = (contract) => descriptor.dataSources.some((item) => item.contract === contract && item.major === 1);
  if (descriptor.interpretation === "none" || has(NAMESPACE) || !has(BYTE_RANGE)) return session;
  const name = fileNameOf(descriptor.subjectUri);
  const entry = Object.freeze({
    id: ENTRY_ID,
    path: name,
    name,
    kind: "file",
    revision: descriptor.revision
  });
  const namespace = Object.freeze({
    async list(prefix) {
      const items = name.toLowerCase().startsWith(prefix.toLowerCase()) ? [entry] : [];
      return Object.freeze({ items: Object.freeze(items) });
    },
    async lookup(path) {
      return path.toLowerCase() === name.toLowerCase() ? entry : void 0;
    },
    // the map's documents are read through container.extract; the reference names the file itself
    async openEntry(entryId) {
      if (entryId !== ENTRY_ID) throw new RangeError(`the map file has no entry ${entryId}`);
      return {
        value: Object.freeze({
          id: `${descriptor.subjectUri}:${ENTRY_ID}`,
          uri: descriptor.subjectUri
        }),
        release: async () => void 0
      };
    }
  });
  const extract = async (signal) => {
    const lease = await session.dataSource(BYTE_RANGE, 1);
    try {
      const source = lease.value;
      const size = await source.size();
      if (size > maxBytes || size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ModkitError({
          code: "x3.host/map-preview-subject-too-large",
          message: `the map file (${size} bytes) exceeds the preview input budget`,
          context: { size: String(size), maxBytes: String(maxBytes) }
        });
      }
      return await source.read(0n, Number(size), signal);
    } finally {
      await lease.release();
    }
  };
  const extended = Object.freeze({
    ...descriptor,
    dataSources: Object.freeze([
      ...descriptor.dataSources,
      Object.freeze({ contract: NAMESPACE, major: 1 })
    ]),
    operations: Object.freeze([
      ...descriptor.operations,
      Object.freeze({
        id: "container.extract",
        handlerId: EXTRACT_HANDLER,
        mutatesSource: false,
        state: "available"
      })
    ])
  });
  const operations = () => {
    const inner = session.operations();
    return Object.freeze({
      async invoke(handlerId, input, options) {
        if (handlerId !== EXTRACT_HANDLER) return inner.invoke(handlerId, input, options);
        const entryId = input?.entryId;
        if (entryId !== ENTRY_ID)
          throw new RangeError(`the map file has no entry ${String(entryId)}`);
        return {
          state: "ok",
          output: { kind: "bytes", value: await extract(options?.signal) },
          diagnostics: []
        };
      },
      dispose: () => inner.dispose()
    });
  };
  return Object.freeze({
    get revision() {
      return session.revision;
    },
    state: () => session.state(),
    descriptor: async () => extended,
    async dataSource(contract, major) {
      if (contract === NAMESPACE && major === 1)
        return { value: namespace, release: async () => void 0 };
      return session.dataSource(contract, major);
    },
    operations,
    events: (signal) => session.events(signal),
    dispose: () => session.dispose()
  });
}
function positiveLimit(value, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`world page limit must be between 1 and ${maximum}`);
  }
  return value;
}
function textureVariantLogicalId(logicalId, variant) {
  if (variant === void 0 || variant.suffix.length === 0) return void 0;
  const slash = logicalId.lastIndexOf("/");
  const file = logicalId.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot <= 0 ? file : file.slice(0, dot);
  const name = stem.toLowerCase();
  const matches = variant.names.some(
    (entry) => name.startsWith(entry.prefix.toLowerCase()) && name.includes(entry.contains.toLowerCase())
  );
  if (!matches) return void 0;
  return `${logicalId.slice(0, slash + 1)}${stem}${variant.suffix}${dot <= 0 ? "" : file.slice(dot)}`;
}
function childResourceLogicalId(parentLogicalId, childLogicalId) {
  const childRoot = childLogicalId.split("/")[0];
  if (childRoot === void 0 || childRoot.length === 0) return childLogicalId;
  const parent = parentLogicalId.split("/");
  const sharedRoot = parent.findIndex((segment) => segment.toLowerCase() === childRoot.toLowerCase());
  if (sharedRoot <= 0) return childLogicalId;
  return [...parent.slice(0, sharedRoot), childLogicalId].join("/");
}
function worldTexture(id, result) {
  if (result.info.orientation === "unknown") return void 0;
  if (result.state === "compressed") {
    if (result.info.orientation !== "top-left") return void 0;
    return Object.freeze({
      id,
      width: result.texture.dimensions.width,
      height: result.texture.dimensions.height,
      rgba: new Uint8Array(0),
      compressed: result.texture,
      ...result.info.channelLayout === void 0 ? {} : { channelLayout: result.info.channelLayout },
      ...result.info.compression === void 0 ? {} : { compression: result.info.compression },
      wrapU: "repeat",
      wrapV: "repeat"
    });
  }
  const { region } = result;
  const rowBytes = region.width * 4;
  const rgba = new Uint8Array(rowBytes * region.height);
  for (let y = 0; y < region.height; y += 1) {
    const sourceY = result.info.orientation === "bottom-left" ? region.height - 1 - y : y;
    rgba.set(
      region.pixels.subarray(sourceY * region.rowStride, sourceY * region.rowStride + rowBytes),
      y * rowBytes
    );
  }
  return Object.freeze({
    id,
    width: region.width,
    height: region.height,
    rgba,
    ...result.info.channelLayout === void 0 ? {} : { channelLayout: result.info.channelLayout },
    ...result.info.compression === void 0 ? {} : { compression: result.info.compression },
    wrapU: "repeat",
    wrapV: "repeat"
  });
}
function worldTextureBytes(texture) {
  if (texture.compressed === void 0) return texture.rgba.byteLength;
  let bytes = 0;
  for (const level of texture.compressed.subresources) bytes += level.data.byteLength;
  return bytes;
}
async function readAllPages(read, pageLimit, cap2) {
  const items = [];
  let cursor2;
  do {
    const page = await read({
      limit: Math.min(pageLimit, cap2 - items.length),
      ...cursor2 === void 0 ? {} : { cursor: cursor2 }
    });
    items.push(...page.items);
    cursor2 = page.nextCursor;
  } while (cursor2 !== void 0 && items.length < cap2);
  return { items, complete: cursor2 === void 0 };
}
var MODEL_FACET_ITEM_CAP = 65536;
function primitiveByteLength(primitive) {
  let total = 0;
  const visit = (value, depth) => {
    if (ArrayBuffer.isView(value)) total += value.byteLength;
    else if (depth < 3 && typeof value === "object" && value !== null)
      for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(primitive, 0);
  return total;
}
function consistentNodes(nodes, meshIds) {
  const present = new Set(nodes.map((node) => node.id));
  let pruned = false;
  const out = nodes.map((node) => {
    const childIds = node.childIds.filter((id) => present.has(id));
    const meshes = node.meshIds?.filter((id) => meshIds.has(id));
    if (childIds.length === node.childIds.length && meshes?.length === node.meshIds?.length)
      return node;
    pruned = true;
    return Object.freeze({
      ...node,
      childIds,
      ...meshes === void 0 ? {} : { meshIds: meshes }
    });
  });
  return { nodes: out, pruned };
}
function yawRootNodes(nodes, yaw) {
  if (yaw === 0) return [...nodes];
  const children = new Set(nodes.flatMap((node) => node.childIds));
  const c2 = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rotate = (m) => {
    const out = [...m];
    for (let column = 0; column < 4; column += 1) {
      const x = m[column * 4];
      const z = m[column * 4 + 2];
      out[column * 4] = c2 * x + s * z;
      out[column * 4 + 2] = -s * x + c2 * z;
    }
    return Object.freeze(out);
  };
  return nodes.map(
    (node) => children.has(node.id) ? node : Object.freeze({ ...node, transform: rotate(node.transform) })
  );
}
function worldSceneModelLimits(request, maxPageSize) {
  const maxNodes = request.maxNodes ?? request.maxMeshes;
  const maxResources = request.maxResources ?? maxNodes;
  const maxTextureBytes = request.maxTextureBytes ?? Math.min(16 * 1024 * 1024, request.maxBytes);
  const maxTextureTotalBytes = request.maxTextureTotalBytes ?? Math.min(32 * 1024 * 1024, request.maxBytes);
  positiveLimit(maxNodes, maxPageSize);
  positiveLimit(request.maxMeshes, maxPageSize);
  positiveLimit(request.maxPrimitives, maxPageSize);
  positiveLimit(request.maxPrimitiveBytes, request.maxBytes);
  positiveLimit(maxResources, maxPageSize);
  positiveLimit(maxTextureBytes, request.maxBytes);
  positiveLimit(maxTextureTotalBytes, request.maxBytes);
  return Object.freeze({ maxNodes, maxResources, maxTextureBytes, maxTextureTotalBytes });
}
async function worldSceneModel(asset, request, options, signal) {
  const { maxNodes, maxResources, maxTextureBytes, maxTextureTotalBytes } = worldSceneModelLimits(
    request,
    options.maxPageSize ?? Number.MAX_SAFE_INTEGER
  );
  const modelRequirement = options.requirement;
  const textureCache = options.textureCache ?? /* @__PURE__ */ new Map();
  const result = asset.result;
  if (result.state === "unresolved") {
    return Object.freeze({
      ...result,
      diagnostics: Object.freeze([...result.diagnostics])
    });
  }
  if (asset.meshes === void 0) {
    return Object.freeze({
      state: "converted",
      sourceKey: result.sourceKey,
      uvmBytes: result.bytes.slice(),
      meshes: Object.freeze([]),
      primitives: Object.freeze([]),
      diagnostics: Object.freeze([
        ...result.diagnostics,
        diagnostic(
          "information",
          "x3.host/world-model-render-facets-unavailable",
          `model ${modelRequirement.logicalId} converted successfully but publishes no common geometry; optional effects, lights or decals require their own admitted world facets`
        )
      ]),
      complete: false
    });
  }
  const facet = (read, pageLimit) => read === void 0 ? void 0 : readAllPages((page) => read(page, signal), pageLimit, MODEL_FACET_ITEM_CAP);
  const meshPage = await facet(asset.meshes.bind(asset), request.maxMeshes);
  const [nodePage, skeletonPage, animationPage, materialPage, resourcePage, socketPage] = await Promise.all([
    facet(asset.nodes?.bind(asset), maxNodes),
    facet(asset.skeletonBindings?.bind(asset), maxNodes),
    facet(asset.animationClips?.bind(asset), maxNodes),
    facet(asset.materials?.bind(asset), maxNodes),
    facet(asset.resourceReferences?.bind(asset), maxResources),
    facet(asset.sockets?.bind(asset), maxNodes)
  ]);
  let materials = materialPage?.items;
  let resourceItems = resourcePage?.items ?? [];
  const skinDiagnostics = [];
  if (options.skin !== void 0 && materials !== void 0) {
    const skinned = await options.skin(materials);
    skinDiagnostics.push(...skinned.diagnostics);
    if (skinned.materials !== void 0) {
      materials = skinned.materials;
      resourceItems = [];
    }
  }
  const allPrimitiveIds = meshPage.items.flatMap((mesh) => mesh.primitiveIds);
  if (allPrimitiveIds.length > 0 && asset.primitive === void 0)
    throw new TypeError("model publishes primitive ids without a primitive reader");
  const primitives = [];
  let primitiveBytes = 0;
  for (let start = 0; start < allPrimitiveIds.length && primitiveBytes < request.maxBytes; start += request.maxPrimitives) {
    const batch = await Promise.all(
      allPrimitiveIds.slice(start, start + request.maxPrimitives).map(
        (primitiveId) => asset.primitive(primitiveId, { maxBytes: request.maxPrimitiveBytes }, signal)
      )
    );
    for (const primitive of batch) {
      const bytes = primitiveByteLength(primitive);
      if (primitiveBytes + bytes > request.maxBytes) break;
      primitiveBytes += bytes;
      primitives.push(primitive);
    }
    if (primitives.length < Math.min(start + request.maxPrimitives, allPrimitiveIds.length)) break;
  }
  const loadedPrimitives = new Set(primitives.map((primitive) => primitive.id));
  const meshes = meshPage.items.filter(
    (mesh) => mesh.primitiveIds.every((id) => loadedPrimitives.has(id))
  );
  const graph = nodePage === void 0 ? void 0 : consistentNodes(nodePage.items, new Set(meshes.map((mesh) => mesh.id)));
  const textureDiagnostics = [];
  const textures = [];
  const publishedResources = [...resourceItems];
  const resourceIds = new Set(publishedResources.map((reference) => reference.id));
  for (const material of materials ?? []) {
    for (const layer of material.layers ?? []) {
      if (layer.resourceId === void 0 || resourceIds.has(layer.resourceId)) continue;
      resourceIds.add(layer.resourceId);
      publishedResources.push(
        Object.freeze({
          id: layer.resourceId,
          role: "texture",
          provenance: "reference-only"
        })
      );
    }
  }
  const textureReferences = publishedResources.filter((reference) => reference.role === "texture");
  const sharedTextureBytes = Math.max(
    1,
    Math.floor(maxTextureTotalBytes / Math.max(1, textureReferences.length))
  );
  let textureBytes = 0;
  for (const reference of textureReferences) {
    const remaining = maxTextureTotalBytes - textureBytes;
    if (remaining <= 0) {
      textureDiagnostics.push(
        diagnostic(
          "warning",
          "x3.host/world-model-texture-budget-exhausted",
          `model texture budget omitted ${reference.id}`
        )
      );
      continue;
    }
    const namedLogicalId = childResourceLogicalId(modelRequirement.logicalId, reference.id);
    const variantLogicalId = textureVariantLogicalId(namedLogicalId, options.textureVariant);
    const logicalId = variantLogicalId ?? namedLogicalId;
    const previewTextureBytes = Math.max(
      1,
      Math.min(maxTextureBytes, remaining, sharedTextureBytes)
    );
    const compressedFormats = request.compressedTextureFormats;
    const cacheKey = `${logicalId}\0${String(previewTextureBytes)}\0${compressedFormats?.join(",") ?? ""}`;
    let pending = textureCache.get(cacheKey);
    if (pending === void 0) {
      pending = (async () => {
        const raster = await asset.readRaster(
          {
            kind: "logical",
            requirement: {
              id: `world-texture:${encodeURIComponent(logicalId)}`,
              logicalId,
              ...variantLogicalId === void 0 ? {} : { alternatives: [namedLogicalId] },
              role: reference.role,
              scopes: modelRequirement.scopes,
              parentResourceId: modelRequirement.id
            },
            maxBytes: previewTextureBytes,
            selection: { mipLevel: "fit" },
            ...compressedFormats === void 0 ? {} : { compressedFormats }
          },
          signal
        );
        if (raster.state !== "decoded" && raster.state !== "compressed")
          return Object.freeze({
            diagnostics: Object.freeze([...raster.diagnostics])
          });
        const texture2 = worldTexture(reference.id, raster);
        const mipLevel = raster.subresource?.mipLevel ?? 0;
        return Object.freeze({
          ...texture2 === void 0 ? {} : { texture: texture2 },
          diagnostics: Object.freeze([
            ...raster.diagnostics,
            ...mipLevel === 0 ? [] : [
              diagnostic(
                "information",
                "x3.host/world-model-texture-preview-mip-selected",
                `model texture ${reference.id} uses preview mip ${String(mipLevel)} to stay within its decoded byte budget`
              )
            ],
            ...texture2 === void 0 ? [
              diagnostic(
                "warning",
                "x3.host/world-model-texture-orientation-unknown",
                `model texture ${reference.id} has no proven top/bottom row orientation`
              )
            ] : []
          ])
        });
      })();
      textureCache.set(cacheKey, pending);
    }
    const loaded = await pending;
    textureDiagnostics.push(...loaded.diagnostics);
    const texture = loaded.texture;
    if (texture === void 0) {
      if (textureCache.get(cacheKey) === pending) textureCache.delete(cacheKey);
      continue;
    }
    const bytes = worldTextureBytes(texture);
    if (bytes > remaining) {
      textureDiagnostics.push(
        diagnostic(
          "warning",
          "x3.host/world-model-texture-budget-exhausted",
          `decoded model texture ${reference.id} exceeds the aggregate texture budget`
        )
      );
      continue;
    }
    textureBytes += bytes;
    textures.push(texture);
  }
  return Object.freeze({
    state: "converted",
    sourceKey: result.sourceKey,
    uvmBytes: result.bytes.slice(),
    ...graph === void 0 ? {} : { nodes: Object.freeze(yawRootNodes(graph.nodes, options.yaw ?? 0)) },
    ...skeletonPage === void 0 ? {} : { skeleton: Object.freeze([...skeletonPage.items]) },
    ...animationPage === void 0 ? {} : { animations: Object.freeze([...animationPage.items]) },
    ...materials === void 0 ? {} : { materials: Object.freeze([...materials]) },
    ...publishedResources.length === 0 ? {} : { resources: Object.freeze(publishedResources) },
    ...socketPage === void 0 ? {} : { sockets: Object.freeze([...socketPage.items]) },
    ...publishedResources.length === 0 ? {} : { textures: Object.freeze(textures) },
    meshes: Object.freeze(meshes),
    primitives: Object.freeze(primitives),
    diagnostics: Object.freeze([
      ...result.diagnostics,
      ...skinDiagnostics,
      ...textureDiagnostics,
      ...graph?.pruned === true ? [
        diagnostic(
          "warning",
          "x3.host/world-model-graph-truncated",
          `model ${modelRequirement.logicalId} was cut (${MODEL_FACET_ITEM_CAP} items per facet, ${request.maxBytes} primitive bytes); nodes and meshes left out are dropped from their parents`
        )
      ] : []
    ]),
    complete: meshPage.complete && nodePage?.complete !== false && skeletonPage?.complete !== false && animationPage?.complete !== false && materialPage?.complete !== false && resourcePage?.complete !== false && socketPage?.complete !== false && textureReferences.length === textures.length && primitives.length === allPrimitiveIds.length
  });
}
var PROOF_METHODS = /* @__PURE__ */ new Set([
  "sealed-legacy-differential",
  "official-reference-differential",
  "third-party-reference-differential",
  "game-data-reference-differential"
]);
function worldCamera(camera) {
  if (camera === void 0) return void 0;
  const within = (value, low, high) => value === void 0 || Number.isFinite(value) && value >= low && value <= high;
  return (camera.projection === "orthographic" || camera.projection === "perspective") && within(camera.azimuthDegrees, -360, 360) && within(camera.elevationDegrees, 0, 90) && within(camera.fieldOfViewDegrees, 1, 170) && within(camera.drawDistance, Number.MIN_VALUE, Number.MAX_VALUE) ? Object.freeze({ ...camera }) : void 0;
}
function resourceId(namespace, entityId) {
  return `resource:${encodeURIComponent(namespace)}/${encodeURIComponent(entityId)}`;
}
function modelResourceId(requirementId) {
  return `model-resource:${encodeURIComponent(requirementId)}`;
}
function layerId(kind) {
  return `main/${kind}`;
}
function layerContentRevision(items) {
  const text = JSON.stringify(
    items,
    (key2, value) => key2 === "id" || key2 === "layerId" ? void 0 : value
  );
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}:${items.length}`;
}
function terrainMaterialContentRevision(items, rasters) {
  const text = JSON.stringify(
    [items, rasters.map(({ rgba: _rgba, ...metadata }) => metadata)],
    (key2, value) => key2 === "id" || key2 === "layerId" ? void 0 : value
  );
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  for (const raster of rasters) {
    for (const value of raster.rgba ?? []) {
      hash ^= value;
      hash = Math.imul(hash, 16777619);
    }
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}:${items.length}:${rasters.length}`;
}
function canonicalQuery(request) {
  const bounds = request.bounds;
  if (bounds !== void 0 && (!Number.isFinite(bounds.minimumX) || !Number.isFinite(bounds.minimumY) || !Number.isFinite(bounds.maximumX) || !Number.isFinite(bounds.maximumY) || bounds.minimumX > bounds.maximumX || bounds.minimumY > bounds.maximumY)) {
    throw new TypeError("world bounds must be finite ordered minimum/maximum coordinates");
  }
  return JSON.stringify([
    request.facet,
    request.layerId ?? null,
    request.lod ?? null,
    bounds === void 0 ? null : [bounds.minimumX, bounds.minimumY, bounds.maximumX, bounds.maximumY]
  ]);
}
function cursor(snapshotId, query, offset) {
  return `${encodeURIComponent(snapshotId)}|${encodeURIComponent(query)}|${String(offset)}`;
}
function cursorOffset(value, snapshotId, query) {
  if (value === void 0) return 0;
  const parts = value.split("|");
  if (parts.length !== 3) throw new TypeError("world cursor is malformed");
  let cursorSnapshot;
  let cursorQuery;
  try {
    cursorSnapshot = decodeURIComponent(parts[0] ?? "");
    cursorQuery = decodeURIComponent(parts[1] ?? "");
  } catch {
    throw new TypeError("world cursor is malformed");
  }
  const offset = Number(parts[2]);
  if (cursorSnapshot !== snapshotId) {
    throw new TypeError("world cursor belongs to another or stale source snapshot");
  }
  if (cursorQuery !== query || !Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError("world cursor does not match the requested layer, LOD or spatial query");
  }
  return offset;
}
function numericPair(value) {
  if (value === void 0) return void 0;
  const parts = value.split(",").map((item) => Number(item.trim()));
  return parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) ? Object.freeze({ x: parts[0], y: parts[1] }) : void 0;
}
function regionShape(shape) {
  const { parameters } = shape;
  const type = shape.type.toLowerCase();
  const center = numericPair(parameters["center"]);
  const radiusValue = parameters["radius"];
  const radius = radiusValue === void 0 ? void 0 : Number(radiusValue);
  const corner = (short, long) => numericPair(parameters[short] ?? parameters[long]);
  const first = corner("min", "minimum");
  const second = corner("max", "maximum");
  const box = first === void 0 || second === void 0 ? void 0 : {
    minimum: Object.freeze({ x: Math.min(first.x, second.x), y: Math.min(first.y, second.y) }),
    maximum: Object.freeze({ x: Math.max(first.x, second.x), y: Math.max(first.y, second.y) })
  };
  if ((type === "rect" || type === "rectangle") && box !== void 0)
    return Object.freeze({ kind: "rectangle", ...box, rawParameters: parameters });
  if (type === "diamond" && box !== void 0) {
    const middle = { x: (box.minimum.x + box.maximum.x) / 2, y: (box.minimum.y + box.maximum.y) / 2 };
    return Object.freeze({
      kind: "polygon",
      points: Object.freeze([
        Object.freeze({ x: middle.x, y: box.minimum.y }),
        Object.freeze({ x: box.maximum.x, y: middle.y }),
        Object.freeze({ x: middle.x, y: box.maximum.y }),
        Object.freeze({ x: box.minimum.x, y: middle.y })
      ]),
      rawParameters: parameters
    });
  }
  const points = parameters["points"]?.split(/[\s;]+/u).filter((item) => item !== "").map(numericPair);
  if (type === "polygon" && points !== void 0 && points.length >= 3 && points.every(Boolean))
    return Object.freeze({
      kind: "polygon",
      points: Object.freeze(points),
      rawParameters: parameters
    });
  return Object.freeze({
    kind: shape.type,
    ...center === void 0 ? {} : { center },
    ...radius !== void 0 && Number.isFinite(radius) ? { radius } : {},
    rawParameters: parameters
  });
}
function pageItems(items, request, snapshotId, maximum) {
  const limit = positiveLimit(request.limit, maximum);
  const query = canonicalQuery(request);
  const offset = cursorOffset(request.cursor, snapshotId, query);
  if (offset > items.length) throw new TypeError("world cursor offset is outside this facet");
  const selected = Object.freeze(items.slice(offset, offset + limit));
  const nextOffset = offset + selected.length;
  return Object.freeze({
    snapshotId,
    facet: request.facet,
    state: "available",
    items: selected,
    ...nextOffset < items.length ? { nextCursor: cursor(snapshotId, query, nextOffset) } : {}
  });
}
function hasExactTerrainGrid(terrain) {
  if (terrain === void 0 || terrain.samples.length !== terrain.cellCount) return false;
  const expectedCellCount = terrain.width * terrain.height;
  if (!Number.isSafeInteger(expectedCellCount) || expectedCellCount <= 0 || expectedCellCount !== terrain.cellCount) {
    return false;
  }
  return terrain.samples.every(
    (sample, index) => sample.x === index % terrain.width && sample.y === Math.floor(index / terrain.width)
  );
}
function terrainMapNativePosition(sample, transform) {
  const vertical = "vertData" in transform ? (sample.heightBase * transform.vertData.quantizeScale - transform.vertData.quantizeBias) * transform.heightMap.scale.z + transform.heightMap.offset.z + ((sample.presentationHeightAdjustment ?? sample.heightAdjustment) * transform.vertData.quantizeScale - transform.vertData.quantizeBias) : sample.heightBase * transform.heightMap.scale.z + transform.heightMap.offset.z;
  return Object.freeze({
    x: transform.heightMap.offset.x + sample.x * transform.heightMap.scale.x,
    y: transform.heightMap.offset.y + sample.y * transform.heightMap.scale.y,
    z: vertical
  });
}
function terrainHeightAt(position, terrain, transform) {
  if (transform === void 0 || terrain === void 0 || !hasExactTerrainGrid(terrain))
    return void 0;
  const gridX = (position.x - transform.heightMap.offset.x) / transform.heightMap.scale.x;
  const gridY = (position.y - transform.heightMap.offset.y) / transform.heightMap.scale.y;
  if (!Number.isFinite(gridX) || !Number.isFinite(gridY) || gridX < 0 || gridY < 0 || gridX > terrain.width - 1 || gridY > terrain.height - 1) {
    return void 0;
  }
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const x1 = Math.min(x0 + 1, terrain.width - 1);
  const y1 = Math.min(y0 + 1, terrain.height - 1);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const height = (x, y) => terrainMapNativePosition(terrain.samples[y * terrain.width + x], transform).z;
  const lower = height(x0, y0) * (1 - tx) + height(x1, y0) * tx;
  const upper = height(x0, y1) * (1 - tx) + height(x1, y1) * tx;
  return lower * (1 - ty) + upper * ty;
}
function nativeWorldWindow(view, transform) {
  const corners = [view.minimumX, view.minimumZ, view.maximumX, view.maximumZ];
  if (!corners.every(Number.isFinite) || view.minimumX > view.maximumX || view.minimumZ > view.maximumZ)
    throw new TypeError("a world view window has finite ordered minimum/maximum x and z");
  if (transform === void 0)
    return Object.freeze({
      minimumX: view.minimumX,
      minimumY: view.minimumZ,
      maximumX: view.maximumX,
      maximumY: view.maximumZ
    });
  const native = {};
  for (const [axis, low, high] of [
    ["x", view.minimumX, view.maximumX],
    ["z", view.minimumZ, view.maximumZ]
  ]) {
    const { sourceAxis, scale, offset } = transform.axes[axis];
    const a = (low - offset) / scale;
    const b = (high - offset) / scale;
    native[sourceAxis] = [Math.min(a, b), Math.max(a, b)];
  }
  const { x, y } = native;
  if (x === void 0 || y === void 0 || ![...x, ...y].every(Number.isFinite)) return void 0;
  return Object.freeze({ minimumX: x[0], minimumY: y[0], maximumX: x[1], maximumY: y[1] });
}
function canonicalPosition(position, transform) {
  const axis = (output) => {
    const mapping = transform.axes[output];
    const value = position[mapping.sourceAxis] * mapping.scale + mapping.offset;
    return value === 0 ? 0 : value;
  };
  return Object.freeze({ x: axis("x"), y: axis("y"), z: axis("z") });
}
function canonicalObjectRotation(rotation, nativeUnit, sense) {
  let radians;
  if (rotation === void 0) radians = 0;
  else if (nativeUnit === "radians") radians = rotation;
  else if (nativeUnit === "degrees") radians = rotation * Math.PI / 180;
  else if (nativeUnit === "uint16-turn") radians = rotation * Math.PI * 2 / 65536;
  else return void 0;
  if (!Number.isFinite(radians)) return void 0;
  if (sense === "clockwise") radians = -radians;
  const half = radians / 2;
  const y = Math.sin(half);
  const w = Math.cos(half);
  return Object.freeze([0, y === 0 ? 0 : y, 0, w === 0 ? 0 : w]);
}
function canonicalObjectScale(scale, transform) {
  const source = scale ?? { x: 1, y: 1, z: 1 };
  return Object.freeze({
    x: source[transform.axes.x.sourceAxis],
    y: source[transform.axes.y.sourceAxis],
    z: source[transform.axes.z.sourceAxis]
  });
}
function canonicalRegionShape(shape, transform) {
  const point = (value) => {
    const canonical = canonicalPosition({ x: value.x, y: value.y, z: 0 }, transform);
    return Object.freeze({ x: canonical.x, y: canonical.z });
  };
  const horizontalScaleX = Math.abs(transform.axes.x.scale);
  const horizontalScaleZ = Math.abs(transform.axes.z.scale);
  if (shape.center !== void 0 && shape.radius !== void 0) {
    if (horizontalScaleX !== horizontalScaleZ) return void 0;
    return Object.freeze({
      ...shape,
      center: point(shape.center),
      radius: shape.radius * horizontalScaleX
    });
  }
  if (shape.minimum !== void 0 && shape.maximum !== void 0) {
    const corners = [
      point(shape.minimum),
      point({ x: shape.minimum.x, y: shape.maximum.y }),
      point(shape.maximum),
      point({ x: shape.maximum.x, y: shape.minimum.y })
    ];
    return Object.freeze({
      ...shape,
      minimum: Object.freeze({
        x: Math.min(...corners.map((corner) => corner.x)),
        y: Math.min(...corners.map((corner) => corner.y))
      }),
      maximum: Object.freeze({
        x: Math.max(...corners.map((corner) => corner.x)),
        y: Math.max(...corners.map((corner) => corner.y))
      })
    });
  }
  if (shape.points !== void 0) {
    return Object.freeze({ ...shape, points: Object.freeze(shape.points.map(point)) });
  }
  return void 0;
}
function admittedTerrainTransform(snapshot, terrain, exact) {
  const transform = snapshot.terrainTransform;
  if (transform === void 0 || terrain === void 0 || !exact) return void 0;
  const finite = (value) => Number.isFinite(value);
  const positive22 = (value) => finite(value) && value > 0;
  const verticalMappingValid = (value) => {
    if ("vertData" in value) {
      return finite(value.vertData.quantizeBias) && positive22(value.vertData.quantizeScale) && finite(value.vertData.standardHeight) && value.mapping.vertical === "dequantized-base-times-scale-plus-offset-plus-dequantized-adjustment";
    }
    return value.mapping.vertical === "direct-base-times-scale-plus-offset" && value.source.format.length > 0 && value.source.heightEncoding.length > 0 && terrain.samples.every((sample) => sample.heightAdjustment === 0);
  };
  if (transform.schemaVersion !== 1 || !Number.isSafeInteger(transform.descriptorVersion) || transform.descriptorVersion <= 0 || transform.snapshotId !== snapshot.snapshotId || transform.heightMap.dim.length !== 2 || transform.heightMap.dim[0] !== terrain.width || transform.heightMap.dim[1] !== terrain.height || !Object.values(transform.heightMap.offset).every(finite) || !Object.values(transform.heightMap.scale).every(positive22) || transform.mapping.horizontal !== "offset-plus-grid-index-times-scale" || !verticalMappingValid(transform) || transform.bounds.coordinateSpaceId !== "map-native") {
    return void 0;
  }
  let minimum = { x: Infinity, y: Infinity, z: Infinity };
  let maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const sample of terrain.samples) {
    const position = terrainMapNativePosition(sample, transform);
    if (!Object.values(position).every(finite)) return void 0;
    const ground = sample.noGround !== true;
    minimum = {
      x: Math.min(minimum.x, position.x),
      y: Math.min(minimum.y, position.y),
      z: ground ? Math.min(minimum.z, position.z) : minimum.z
    };
    maximum = {
      x: Math.max(maximum.x, position.x),
      y: Math.max(maximum.y, position.y),
      z: ground ? Math.max(maximum.z, position.z) : maximum.z
    };
  }
  return ["x", "y", "z"].every(
    (axis) => transform.bounds.minimum[axis] === minimum[axis] && transform.bounds.maximum[axis] === maximum[axis]
  ) ? transform : void 0;
}
function admittedWorldCanonicalTransform(snapshot, terrainTransform, hasTerrain) {
  const transform = snapshot.uvwTransform;
  if (transform === void 0) return {};
  if (terrainTransform === void 0 && hasTerrain) {
    return { refusal: "the terrain has no admitted exact native transform to qualify it against" };
  }
  const finite = (value) => Number.isFinite(value);
  const positive22 = (value) => finite(value) && value > 0;
  const sha2562 = (value) => /^sha256:[0-9a-f]{64}$/u.test(value);
  const { basis, heightfield, bounds, proof } = transform;
  const axes = Object.values(transform.axes);
  const [columns, rows] = terrainTransform?.heightMap.dim ?? [0, 0];
  const checks = [
    ["its schemaVersion is not 1", () => transform.schemaVersion !== 1],
    ["it belongs to another snapshot", () => transform.snapshotId !== snapshot.snapshotId],
    [
      "it does not map map-native to uvw-canonical",
      () => transform.sourceCoordinateSpaceId !== "map-native" || transform.targetCoordinateSpaceId !== "uvw-canonical"
    ],
    [
      "its basis is not right-handed with y up and +z forward",
      () => basis.handedness !== "right" || basis.upAxis !== "y" || basis.forwardAxis !== "+z"
    ],
    [
      "its unit is neither meter nor a named source unit without metersPerUnit",
      () => basis.unit !== "meter" && basis.unit !== "source-unit" || basis.unit === "source-unit" && (basis.sourceUnit === void 0 || basis.sourceUnit.length === 0 || basis.metersPerUnit !== void 0)
    ],
    [
      "an axis scale is zero or not finite, or an offset is not finite",
      () => axes.some((item) => !finite(item.scale) || item.scale === 0 || !finite(item.offset))
    ],
    [
      "its axes do not take three distinct source axes",
      () => new Set(axes.map((item) => item.sourceAxis)).size !== 3
    ],
    [
      terrainTransform === void 0 ? `its heightfield ${String(heightfield.columns)}x${String(heightfield.rows)} is not a grid of positive size` : `its heightfield ${String(heightfield.columns)}x${String(heightfield.rows)} is not the terrain grid ${String(columns)}x${String(rows)}`,
      () => !Number.isSafeInteger(heightfield.columns) || !Number.isSafeInteger(heightfield.rows) || (terrainTransform === void 0 ? heightfield.columns <= 0 || heightfield.rows <= 0 : heightfield.columns !== columns || heightfield.rows !== rows)
    ],
    [
      "its cellSize is not positive or unitsPerCell differs from it",
      () => !positive22(heightfield.cellSize) || basis.unitsPerCell !== void 0 && basis.unitsPerCell !== heightfield.cellSize
    ],
    [
      "its heightfield origin is not three finite numbers",
      () => heightfield.origin.length !== 3 || !heightfield.origin.every(finite)
    ],
    [
      `its sourceRowOrder ${String(heightfield.sourceRowOrder)} is neither forward nor reverse`,
      () => heightfield.sourceRowOrder !== "forward" && heightfield.sourceRowOrder !== "reverse"
    ],
    [
      "its bounds are not finite uvw-canonical bounds with minimum <= maximum",
      () => bounds.coordinateSpaceId !== "uvw-canonical" || !["x", "y", "z"].every(
        (axis) => finite(bounds.minimum[axis]) && finite(bounds.maximum[axis]) && bounds.minimum[axis] <= bounds.maximum[axis]
      )
    ],
    [
      "its proof is not an adapter qualification over a positive tuple count",
      () => proof.kind !== "adapter-qualification" || !Number.isSafeInteger(proof.tupleCount) || proof.tupleCount <= 0
    ],
    [
      `its proof method ${String(proof.method)} is none sdk names`,
      () => !PROOF_METHODS.has(proof.method)
    ],
    [
      "its proof names no oracle, corpus or sha256 source digests",
      () => proof.oracle.length === 0 || proof.corpus.length === 0 || Object.keys(proof.sourceDigests).length === 0 || !Object.values(proof.sourceDigests).every(sha2562)
    ],
    [
      "a tuple digest of its proof is not sha256",
      () => !sha2562(proof.nativeTupleDigest) || proof.presentationTupleDigest !== void 0 && !sha2562(proof.presentationTupleDigest) || !sha2562(proof.canonicalTupleDigest)
    ],
    [
      "its proof comparison is not ieee-754-binary64-exact",
      () => proof.comparison !== "ieee-754-binary64-exact"
    ]
  ];
  const failed = checks.find(([, fails]) => fails());
  if (failed !== void 0) return { refusal: failed[0] };
  if (terrainTransform === void 0) return { transform };
  const nativeBounds = terrainTransform.bounds;
  const corners = [nativeBounds.minimum.x, nativeBounds.maximum.x].flatMap(
    (x) => [nativeBounds.minimum.y, nativeBounds.maximum.y].flatMap(
      (y) => [nativeBounds.minimum.z, nativeBounds.maximum.z].map((z) => ({ x, y, z }))
    )
  );
  let minimum = { x: Infinity, y: Infinity, z: Infinity };
  let maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const corner of corners) {
    const value = canonicalPosition(corner, transform);
    minimum = {
      x: Math.min(minimum.x, value.x),
      y: Math.min(minimum.y, value.y),
      z: Math.min(minimum.z, value.z)
    };
    maximum = {
      x: Math.max(maximum.x, value.x),
      y: Math.max(maximum.y, value.y),
      z: Math.max(maximum.z, value.z)
    };
  }
  return ["x", "y", "z"].every(
    (axis) => transform.bounds.minimum[axis] === minimum[axis] && transform.bounds.maximum[axis] === maximum[axis]
  ) ? { transform } : { refusal: "its bounds are not the canonical image of the terrain bounds" };
}
async function worldTransformCorpusRefusal(snapshot, readDigests) {
  const transform = snapshot.uvwTransform;
  const terrain = snapshot.semantic.terrain;
  const native = terrain === void 0 ? void 0 : admittedTerrainTransform(snapshot, terrain, hasExactTerrainGrid(terrain));
  if (transform === void 0 || terrain === void 0 || native === void 0) return void 0;
  const { proof } = transform;
  const named = Object.entries(proof.sourceDigests).flatMap(([name, digest2]) => {
    const read = readDigests.get(name.toLowerCase());
    return read === void 0 ? [] : [{ digest: digest2, read }];
  });
  if (named.length === 0 || named.some((item) => item.digest !== item.read)) return void 0;
  if (terrain.samples.length !== proof.tupleCount)
    return `its proof counts ${String(proof.tupleCount)} tuples; its corpus terrain has ${String(terrain.samples.length)}`;
  const positions = terrain.samples.map((sample) => terrainMapNativePosition(sample, native));
  const { columns, rows, sourceRowOrder } = transform.heightfield;
  const canonical = [];
  for (let row = 0; row < rows; row += 1) {
    const sourceRow = sourceRowOrder === "reverse" ? rows - 1 - row : row;
    for (let column = 0; column < columns; column += 1) {
      const value = canonicalPosition(positions[sourceRow * columns + column], transform);
      canonical.push([value.x, value.y, value.z]);
    }
  }
  const digest = async (bytes) => {
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes.slice()));
    return `sha256:${[...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  };
  if (await digest(mapQualificationTupleBytes(positions.map((item) => [item.x, item.y, item.z]))) !== proof.nativeTupleDigest)
    return "its native tuple digest is not that of its corpus terrain";
  if (await digest(mapQualificationTupleBytes(canonical)) !== proof.canonicalTupleDigest)
    return "its canonical tuple digest is not that of its corpus terrain";
  return void 0;
}
function createCandidateWorldSceneLease(snapshot, provenance, maxPageSize, modelResources, releaseModelResources, rasterResources, corpusRefusal) {
  positiveLimit(maxPageSize, Number.MAX_SAFE_INTEGER);
  const materialModelCache = /* @__PURE__ */ new Map();
  const modelTextureCache = /* @__PURE__ */ new Map();
  const semantic = snapshot.semantic;
  const terrainLayerId = layerId("terrain");
  const terrainMaterialLayerId = layerId("terrain-materials");
  const waterLayerId = layerId("water");
  const cliffLayerId = layerId("cliffs");
  const objectLayerId = layerId("objects");
  const regionLayerId = layerId("regions");
  const resourceLayerId = layerId("resources");
  const navigationLayerId = layerId("navigation");
  const gatewayLayerId = layerId("gateways");
  const lightingLayerId = layerId("lighting");
  const terrainSummary = semantic.terrain;
  const terrainExact = hasExactTerrainGrid(terrainSummary);
  const terrainTransform = admittedTerrainTransform(snapshot, terrainSummary, terrainExact);
  const admitted = admittedWorldCanonicalTransform(
    snapshot,
    terrainTransform,
    terrainSummary !== void 0
  );
  const { transform: uvwTransform, refusal: uvwTransformRefusal } = admitted.transform !== void 0 && corpusRefusal !== void 0 ? { transform: void 0, refusal: corpusRefusal } : admitted;
  const terrainLod = terrainExact ? "exact" : "sampled";
  const terrainMaterialExact = snapshot.terrainMaterials?.exact === true && (uvwTransform === void 0 || snapshot.terrainMaterials.width === uvwTransform.heightfield.columns && snapshot.terrainMaterials.height === uvwTransform.heightfield.rows);
  const terrainWeightRasterExact = (snapshot.terrainMaterials?.weightRasters?.length ?? 0) > 0 && snapshot.terrainMaterials.weightRasters.every(
    (raster) => Number.isSafeInteger(raster.width) && raster.width > 0 && Number.isSafeInteger(raster.height) && raster.height > 0 && raster.materialIds.length > 0 && raster.materialIds.length <= 4 && raster.rgba?.byteLength === raster.width * raster.height * 4
  );
  const terrainMaterialLod = terrainMaterialExact ? "exact" : "sampled";
  const cliffExact = snapshot.cliffs?.exact === true && (uvwTransform === void 0 || snapshot.cliffs.width <= uvwTransform.heightfield.columns && snapshot.cliffs.height <= uvwTransform.heightfield.rows);
  const cliffLod = cliffExact ? "exact" : "sampled";
  const objectIdentities = /* @__PURE__ */ new Set();
  const semanticObjects = semantic.objects.filter((item) => {
    if (objectIdentities.has(item.objectId)) return false;
    objectIdentities.add(item.objectId);
    return true;
  });
  const regionIdentities = /* @__PURE__ */ new Set();
  const semanticRegions = semantic.regions.filter((item) => {
    if (regionIdentities.has(item.regionId)) return false;
    regionIdentities.add(item.regionId);
    return true;
  });
  const catalogModelRequirements = /* @__PURE__ */ new Map();
  for (const item of semanticObjects) {
    if (item.catalog === void 0 || item.modelResource === void 0) continue;
    const key2 = resourceId(item.catalog.ref.namespace, item.catalog.ref.entityId);
    catalogModelRequirements.set(
      key2,
      (catalogModelRequirements.get(key2) ?? /* @__PURE__ */ new Set()).add(item.modelResource.id)
    );
  }
  const objectResourceId = (ref, modelResource) => {
    const base = resourceId(ref.namespace, ref.entityId);
    return modelResource !== void 0 && (catalogModelRequirements.get(base)?.size ?? 0) > 1 ? `${base}~${encodeURIComponent(modelResource.id)}` : base;
  };
  const duplicateObjectCount = semantic.objects.length - semanticObjects.length;
  const duplicateRegionCount = semantic.regions.length - semanticRegions.length;
  const incompleteObjectPositionCount = semanticObjects.filter(
    (item) => item.sourcePositionDimensions === 2
  ).length;
  const allTerrain = Object.freeze(
    (semantic.terrain?.samples ?? []).map((item) => {
      const mapNativePosition = terrainTransform === void 0 ? void 0 : terrainMapNativePosition(item, terrainTransform);
      const baseOffset = terrainTransform !== void 0 && "vertData" in terrainTransform ? (item.heightBase * terrainTransform.vertData.quantizeScale - terrainTransform.vertData.quantizeBias - terrainTransform.vertData.standardHeight) * terrainTransform.heightMap.scale.z : void 0;
      const presentationAdjustment = terrainTransform !== void 0 && !("vertData" in terrainTransform) && item.presentationHeightAdjustment !== void 0 && Number.isFinite(item.presentationHeightAdjustment) && item.presentationHeightAdjustment !== 0 ? item.presentationHeightAdjustment * terrainTransform.heightMap.scale.z : void 0;
      const presentationUvwPosition = presentationAdjustment === void 0 || mapNativePosition === void 0 || uvwTransform === void 0 ? void 0 : canonicalPosition(
        { ...mapNativePosition, z: mapNativePosition.z + presentationAdjustment },
        uvwTransform
      );
      return Object.freeze({
        facet: "terrain",
        id: `${terrainLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: terrainLayerId,
        coordinateSpaceId: "height-grid",
        lod: terrainLod,
        ...item,
        ...mapNativePosition === void 0 ? {} : { mapNativePosition },
        ...mapNativePosition === void 0 || uvwTransform === void 0 ? {} : { uvwPosition: canonicalPosition(mapNativePosition, uvwTransform) },
        ...presentationUvwPosition === void 0 ? {} : { presentationUvwPosition },
        ...baseOffset === void 0 ? {} : { baseOffset }
      });
    })
  );
  const terrain = Object.freeze(
    allTerrain.filter((item) => item.noGround !== true)
  );
  const noGroundSamples = allTerrain.length - terrain.length;
  const terrainNoDataValue = noGroundSamples === 0 || uvwTransform === void 0 ? void 0 : Math.min(
    -9999,
    Math.floor(
      terrain.reduce(
        (lowest, item) => item.facet === "terrain" && item.uvwPosition !== void 0 ? Math.min(lowest, item.uvwPosition.y) : lowest,
        0
      )
    ) - 1
  );
  const terrainByGrid = new Map(
    allTerrain.map((item) => [`${String(item.x)}:${String(item.y)}`, item])
  );
  const terrainMaterials = Object.freeze(
    (snapshot.terrainMaterials?.samples ?? []).map((item) => {
      const terrainItem = terrainByGrid.get(`${String(item.x)}:${String(item.y)}`);
      const materialId = snapshot.terrainMaterials?.materials?.find(
        (material) => material.sourceIndex === item.textureIndex
      )?.materialId ?? `material-${String(item.textureIndex)}`;
      return Object.freeze({
        facet: "terrain-materials",
        id: `${terrainMaterialLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: terrainMaterialLayerId,
        coordinateSpaceId: "height-grid",
        lod: terrainMaterialLod,
        ...item,
        weights: item.weights ?? Object.freeze([Object.freeze({ materialId, weight: 1 })]),
        ...terrainItem?.facet === "terrain" && terrainItem.uvwPosition !== void 0 ? { uvwPosition: terrainItem.uvwPosition } : {}
      });
    })
  );
  const water = Object.freeze(
    (snapshot.water?.zones ?? []).map((item) => {
      const canonicalCorners = item.elevation === void 0 || uvwTransform === void 0 ? void 0 : [item.minimum.x, item.maximum.x].flatMap(
        (x) => [item.minimum.y, item.maximum.y].map(
          (y) => canonicalPosition({ x, y, z: item.elevation }, uvwTransform)
        )
      );
      return Object.freeze({
        facet: "water",
        id: `${waterLayerId}:zone:${String(item.zoneId)}`,
        layerId: waterLayerId,
        coordinateSpaceId: "map-native",
        ...item,
        ...canonicalCorners === void 0 ? {} : {
          uvwMinimum: Object.freeze({
            x: Math.min(...canonicalCorners.map((corner) => corner.x)),
            z: Math.min(...canonicalCorners.map((corner) => corner.z))
          }),
          uvwMaximum: Object.freeze({
            x: Math.max(...canonicalCorners.map((corner) => corner.x)),
            z: Math.max(...canonicalCorners.map((corner) => corner.z))
          }),
          uvwElevation: canonicalCorners[0].y
        }
      });
    })
  );
  const unresolvedWaterElevationCount = water.filter(
    (item) => item.facet === "water" && item.elevation === void 0
  ).length;
  const cliffs = Object.freeze(
    (snapshot.cliffs?.samples ?? []).map((item) => {
      const terrainItem = terrainByGrid.get(`${String(item.x)}:${String(item.y)}`);
      return Object.freeze({
        facet: "cliffs",
        id: `${cliffLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: cliffLayerId,
        coordinateSpaceId: "height-grid",
        lod: cliffLod,
        ...item,
        ...terrainItem?.facet === "terrain" && terrainItem.uvwPosition !== void 0 ? { uvwPosition: terrainItem.uvwPosition } : {}
      });
    })
  );
  const semanticObjectItems = Object.freeze(
    semanticObjects.map((item) => {
      const id = `${objectLayerId}:object:${String(item.objectId)}`;
      const ref = item.catalog?.ref;
      const uvwRotation = canonicalObjectRotation(
        item.presentationRotation ?? item.rotation,
        item.nativeRotationUnit,
        item.nativeRotationSense
      );
      const groundHeight = terrainHeightAt(item.position, semantic.terrain, terrainTransform);
      const mapNativePresentationPosition = groundHeight === void 0 || item.heightReference === void 0 || item.heightReference === "absolute" ? item.position : Object.freeze({
        ...item.position,
        z: item.heightReference === "terrain-relative" ? groundHeight + item.position.z : groundHeight
      });
      const compoundResourceIds = (item.modelResources ?? []).map(
        (requirement) => modelResourceId(requirement.id)
      );
      const modelComponents = item.modelComponents?.map(
        (component) => Object.freeze({
          ...component,
          resourceId: modelResourceId(component.resourceId)
        })
      );
      return Object.freeze({
        facet: "objects",
        id,
        layerId: objectLayerId,
        coordinateSpaceId: "map-native",
        ...item,
        ...mapNativePresentationPosition === item.position ? {} : { mapNativePresentationPosition },
        ...uvwTransform === void 0 || item.sourcePositionDimensions === 2 ? {} : {
          uvwPosition: canonicalPosition(mapNativePresentationPosition, uvwTransform),
          ...uvwRotation === void 0 ? {} : { uvwRotation },
          uvwScale: canonicalObjectScale(item.scale, uvwTransform)
        },
        ...ref === void 0 ? {} : { resourceId: objectResourceId(ref, item.modelResource) },
        ...compoundResourceIds.length === 0 ? {} : { resourceIds: Object.freeze(compoundResourceIds) },
        ...modelComponents === void 0 ? {} : { modelComponents: Object.freeze(modelComponents) }
      });
    })
  );
  const cliffPieceModels = new Map(
    (snapshot.cliffs?.pieceModels ?? []).map((model) => [model.id, model])
  );
  const cliffModelResourceId = (modelId) => `cliff-model:${encodeURIComponent(modelId)}`;
  const cliffPieceObjects = Object.freeze(
    (snapshot.cliffs?.pieces ?? []).flatMap(
      (piece, index) => cliffPieceModels.get(piece.modelId)?.candidates.length ? [
        Object.freeze({
          facet: "objects",
          id: `${objectLayerId}:cliff:${piece.id}`,
          layerId: objectLayerId,
          coordinateSpaceId: "map-native",
          kind: "doodad",
          objectId: -(index + 1),
          typeId: piece.modelId,
          position: piece.position,
          heightReference: "absolute",
          derivedFrom: "cliffs",
          // Terrain is never player-owned: no team colour in its materials.
          presentationTeamColor: Object.freeze([1, 1, 1]),
          presentationTeamColorIntensity: 0,
          ...uvwTransform === void 0 ? {} : {
            uvwPosition: canonicalPosition(piece.position, uvwTransform),
            uvwRotation: Object.freeze([0, 0, 0, 1]),
            uvwScale: canonicalObjectScale(void 0, uvwTransform)
          },
          resourceId: cliffModelResourceId(piece.modelId)
        })
      ] : []
    )
  );
  const objects = Object.freeze([
    ...semanticObjectItems,
    ...cliffPieceObjects
  ]);
  const regions = Object.freeze(
    semanticRegions.map((item) => {
      const shapes = Object.freeze(item.shapes.map(regionShape));
      const uvwShapes = uvwTransform === void 0 ? void 0 : shapes.map((shape) => canonicalRegionShape(shape, uvwTransform));
      return Object.freeze({
        facet: "regions",
        id: `${regionLayerId}:region:${String(item.regionId)}`,
        layerId: regionLayerId,
        coordinateSpaceId: "map-native",
        regionId: item.regionId,
        name: item.name,
        ...item.color === void 0 ? {} : { color: item.color },
        shapes,
        ...uvwShapes === void 0 || uvwShapes.some((shape) => shape === void 0) ? {} : { uvwShapes: Object.freeze(uvwShapes) }
      });
    })
  );
  const incompleteRegionGeometryCount = regions.filter(
    (item) => item.facet === "regions" && item.uvwShapes === void 0
  ).length;
  const resourceJoins = /* @__PURE__ */ new Map();
  const cliffPieceObjectIds = /* @__PURE__ */ new Map();
  for (const item of cliffPieceObjects)
    cliffPieceObjectIds.set(item.typeId, [...cliffPieceObjectIds.get(item.typeId) ?? [], item.id]);
  for (const [modelId, objectIds] of cliffPieceObjectIds) {
    const model = cliffPieceModels.get(modelId);
    resourceJoins.set(cliffModelResourceId(modelId), {
      resolved: true,
      objectIds,
      modelResource: model.candidates[0].requirement,
      modelCandidates: model.candidates,
      ...model.materialModel === void 0 ? {} : { materialModel: model.materialModel }
    });
  }
  for (const item of objects) {
    if (item.facet !== "objects") continue;
    if (item.catalog !== void 0) {
      const key2 = objectResourceId(item.catalog.ref, item.modelResource);
      const current = resourceJoins.get(key2) ?? {
        namespace: item.catalog.ref.namespace,
        entityId: item.catalog.ref.entityId,
        resolved: item.catalog.entity !== void 0,
        objectIds: [],
        ...item.modelResource === void 0 ? {} : { modelResource: item.modelResource },
        ...item.modelTextureVariant === void 0 ? {} : { modelTextureVariant: item.modelTextureVariant }
      };
      current.resolved ||= item.catalog.entity !== void 0;
      if (current.modelResource === void 0 && item.modelResource !== void 0) {
        current.modelResource = item.modelResource;
        if (item.modelTextureVariant !== void 0)
          current.modelTextureVariant = item.modelTextureVariant;
      }
      current.objectIds.push(item.id);
      resourceJoins.set(key2, current);
    }
    for (const modelResource of item.modelResources ?? []) {
      const key2 = modelResourceId(modelResource.id);
      const current = resourceJoins.get(key2) ?? {
        resolved: true,
        objectIds: [],
        modelResource
      };
      current.objectIds.push(item.id);
      resourceJoins.set(key2, current);
    }
  }
  const resources = Object.freeze(
    [...resourceJoins.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
      ([id, item]) => Object.freeze({
        facet: "resources",
        id,
        layerId: resourceLayerId,
        ...item.namespace === void 0 ? {} : { namespace: item.namespace },
        ...item.entityId === void 0 ? {} : { entityId: item.entityId },
        resolved: item.resolved,
        ...item.modelResource === void 0 ? {} : { modelResource: item.modelResource },
        ...item.modelTextureVariant === void 0 ? {} : { modelTextureVariant: item.modelTextureVariant },
        ...item.modelCandidates === void 0 ? {} : { modelCandidates: item.modelCandidates },
        ...item.materialModel === void 0 ? {} : { materialModel: item.materialModel },
        objectIds: Object.freeze([...item.objectIds])
      })
    )
  );
  const navigation = Object.freeze(
    (snapshot.navigation?.samples ?? []).map(
      (item) => Object.freeze({
        facet: "navigation",
        id: `${navigationLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: navigationLayerId,
        coordinateSpaceId: "navigation-grid",
        lod: "sampled",
        ...item
      })
    )
  );
  const gateways = Object.freeze(
    (snapshot.gateways?.segments ?? []).map((item) => {
      const uvwStart = uvwTransform === void 0 ? void 0 : canonicalPosition({ x: item.x1, y: item.y1, z: 0 }, uvwTransform);
      const uvwEnd = uvwTransform === void 0 ? void 0 : canonicalPosition({ x: item.x2, y: item.y2, z: 0 }, uvwTransform);
      return Object.freeze({
        facet: "gateways",
        ...item,
        id: `${gatewayLayerId}:${item.id}`,
        layerId: gatewayLayerId,
        coordinateSpaceId: "map-native",
        ...uvwStart === void 0 || uvwEnd === void 0 ? {} : { uvwStart, uvwEnd }
      });
    })
  );
  const lighting = Object.freeze(
    snapshot.lighting === void 0 ? [] : [
      Object.freeze({
        facet: "lighting",
        id: `${lightingLayerId}:environment`,
        layerId: lightingLayerId,
        coordinateSpaceId: snapshot.lighting.coordinateSpaceId,
        ...snapshot.lighting.model === void 0 ? {} : { model: snapshot.lighting.model },
        ...snapshot.lighting.unlitColor === void 0 ? {} : { unlitColor: snapshot.lighting.unlitColor },
        ambientColor: snapshot.lighting.ambientColor,
        ambientIntensity: snapshot.lighting.ambientIntensity,
        directional: snapshot.lighting.directional,
        ...snapshot.lighting.terrain === void 0 ? {} : { terrain: snapshot.lighting.terrain },
        ...snapshot.lighting.toneMapping === void 0 ? {} : { toneMapping: snapshot.lighting.toneMapping },
        ...snapshot.lighting.shadowRange === void 0 ? {} : { shadowRange: snapshot.lighting.shadowRange },
        ...snapshot.lighting.fog === void 0 ? {} : { fog: snapshot.lighting.fog }
      })
    ]
  );
  const contentRevisions = Object.freeze({
    terrain: layerContentRevision(terrain),
    "terrain-materials": terrainMaterialContentRevision(
      terrainMaterials,
      snapshot.terrainMaterials?.weightRasters ?? []
    ),
    water: layerContentRevision(water),
    cliffs: layerContentRevision(cliffs),
    objects: layerContentRevision(objects),
    regions: layerContentRevision(regions),
    resources: layerContentRevision(resources),
    navigation: layerContentRevision(navigation),
    gateways: layerContentRevision(gateways),
    lighting: layerContentRevision(lighting)
  });
  const commonTerrainMaterials = Object.freeze(
    snapshot.terrainMaterials?.materials ?? (snapshot.terrainMaterials?.textureNames ?? []).map(
      (label, sourceIndex) => Object.freeze({ materialId: `material-${String(sourceIndex)}`, label, sourceIndex })
    )
  );
  const commonWaterMaterials = Object.freeze(snapshot.water?.materials ?? []);
  const commonTerrainWeightRasters = Object.freeze(
    (snapshot.terrainMaterials?.weightRasters ?? []).map(
      (raster) => Object.freeze({
        resourceId: raster.resourceId,
        width: raster.width,
        height: raster.height,
        materialIds: raster.materialIds,
        encoding: raster.encoding,
        normalization: raster.normalization,
        ...raster.derivation === void 0 ? {} : { derivation: raster.derivation }
      })
    )
  );
  const terrainWeightTextures = new Map(
    (snapshot.terrainMaterials?.weightRasters ?? []).flatMap(
      (raster) => raster.rgba === void 0 ? [] : [
        [
          raster.resourceId,
          Object.freeze({
            id: raster.resourceId,
            width: raster.width,
            height: raster.height,
            rgba: raster.rgba.slice(),
            wrapU: "clamp",
            wrapV: "clamp",
            filter: "linear"
          })
        ]
      ]
    )
  );
  const facets = Object.freeze([
    Object.freeze({
      facet: "terrain",
      layerId: terrainLayerId,
      state: terrainSummary === void 0 ? "unavailable" : terrainExact ? "available" : "partial",
      itemCount: (semantic.terrain?.cellCount ?? 0) - noGroundSamples,
      lods: Object.freeze(
        terrainSummary === void 0 ? [] : terrainExact ? ["exact"] : ["summary", "sampled"]
      ),
      contentRevision: contentRevisions.terrain,
      ...terrainSummary === void 0 ? { reason: "authoritative semantic snapshot contains no terrain height grid" } : terrainExact ? {} : {
        reason: "candidate exposes bounded deterministic samples, not the full native grid"
      }
    }),
    Object.freeze({
      facet: "terrain-materials",
      layerId: terrainMaterialLayerId,
      state: snapshot.terrainMaterials === void 0 ? "unavailable" : terrainMaterialExact || terrainWeightRasterExact ? "available" : "partial",
      itemCount: snapshot.terrainMaterials?.cellCount ?? 0,
      lods: Object.freeze(
        snapshot.terrainMaterials === void 0 ? [] : terrainMaterialExact ? ["exact"] : terrainWeightRasterExact ? ["raster-exact", "sampled"] : ["summary", "sampled"]
      ),
      contentRevision: contentRevisions["terrain-materials"],
      ...snapshot.terrainMaterials === void 0 ? { reason: "publisher reported terrain materials unavailable" } : terrainMaterialExact || terrainWeightRasterExact ? {} : {
        reason: "publisher exposes bounded material samples without a grid matching the admitted UVW heightfield"
      }
    }),
    Object.freeze({
      facet: "water",
      layerId: waterLayerId,
      state: snapshot.water === void 0 ? "unavailable" : unresolvedWaterElevationCount === 0 && snapshot.water.exact !== false ? "available" : "partial",
      itemCount: snapshot.water?.zones.length ?? 0,
      lods: Object.freeze(snapshot.water === void 0 ? [] : ["exact"]),
      contentRevision: contentRevisions.water,
      ...snapshot.water === void 0 ? { reason: "publisher reported water unavailable" } : unresolvedWaterElevationCount > 0 ? {
        reason: `${String(unresolvedWaterElevationCount)} native water zone elevations remain unresolved`
      } : snapshot.water.exact === false ? { reason: "native water geometry exceeds the common constant-elevation zone profile" } : {}
    }),
    Object.freeze({
      facet: "cliffs",
      layerId: cliffLayerId,
      state: snapshot.cliffs === void 0 ? "unavailable" : cliffExact ? "available" : "partial",
      itemCount: snapshot.cliffs?.cellCount ?? 0,
      lods: Object.freeze(
        snapshot.cliffs === void 0 ? [] : cliffExact ? ["exact"] : ["sampled"]
      ),
      contentRevision: contentRevisions.cliffs,
      ...snapshot.cliffs === void 0 ? { reason: "publisher reported synchronized cliff levels unavailable" } : cliffExact ? {} : {
        reason: "publisher cliff grid is sampled or does not match the admitted UVW heightfield grid"
      }
    }),
    Object.freeze({
      facet: "objects",
      layerId: objectLayerId,
      state: semanticObjects.length === 0 ? "unavailable" : duplicateObjectCount > 0 || incompleteObjectPositionCount > 0 ? "partial" : "available",
      itemCount: semanticObjects.length,
      lods: Object.freeze(["exact"]),
      contentRevision: contentRevisions.objects,
      ...semanticObjects.length === 0 ? { reason: "semantic snapshot contains no objects" } : duplicateObjectCount > 0 || incompleteObjectPositionCount > 0 || uvwTransform === void 0 ? {
        reason: [
          ...duplicateObjectCount > 0 ? [`${duplicateObjectCount} duplicate object identities were omitted`] : [],
          ...incompleteObjectPositionCount > 0 ? [
            `${incompleteObjectPositionCount} objects publish two-dimensional source positions; elevation remains unknown`
          ] : [],
          // a viewer then places them by their native axes as (x, z, y)
          ...uvwTransform === void 0 ? [
            `objects have no canonical UVW placement: ${uvwTransformRefusal === void 0 ? "no map-native to UVW transform is published" : `the UVW transform was refused (${uvwTransformRefusal})`}`
          ] : []
        ].join("; ")
      } : {}
    }),
    Object.freeze({
      facet: "regions",
      layerId: regionLayerId,
      state: semanticRegions.length === 0 ? "unavailable" : duplicateRegionCount > 0 || incompleteRegionGeometryCount > 0 ? "partial" : "available",
      itemCount: semanticRegions.length,
      lods: Object.freeze(["exact"]),
      contentRevision: contentRevisions.regions,
      ...semanticRegions.length === 0 ? { reason: "semantic snapshot contains no regions" } : duplicateRegionCount > 0 || incompleteRegionGeometryCount > 0 ? {
        reason: [
          ...duplicateRegionCount > 0 ? [`${duplicateRegionCount} duplicate region identities were omitted`] : [],
          ...incompleteRegionGeometryCount > 0 ? [
            `${incompleteRegionGeometryCount} regions contain shapes without canonical UVW geometry`
          ] : []
        ].join("; ")
      } : {}
    }),
    Object.freeze({
      facet: "resources",
      layerId: resourceLayerId,
      state: resources.length === 0 ? "unavailable" : "available",
      itemCount: resources.length,
      lods: Object.freeze(["exact"]),
      contentRevision: contentRevisions.resources,
      ...resources.length === 0 ? { reason: "no placed object publishes a catalog resource reference" } : {}
    }),
    Object.freeze({
      facet: "navigation",
      layerId: navigationLayerId,
      state: snapshot.navigation === void 0 ? "unavailable" : "partial",
      itemCount: snapshot.navigation?.cellCount ?? 0,
      lods: Object.freeze(snapshot.navigation === void 0 ? [] : ["summary", "sampled"]),
      contentRevision: contentRevisions.navigation,
      ...snapshot.navigation === void 0 ? { reason: "publisher reported navigation unavailable" } : { reason: "native flags are sampled and their bit semantics remain publisher-defined" }
    }),
    Object.freeze({
      facet: "gateways",
      layerId: gatewayLayerId,
      state: snapshot.gateways === void 0 ? "unavailable" : snapshot.gateways.exact && uvwTransform !== void 0 ? "available" : "partial",
      itemCount: snapshot.gateways?.segments.length ?? 0,
      lods: Object.freeze(snapshot.gateways === void 0 ? [] : ["exact"]),
      contentRevision: contentRevisions.gateways,
      ...snapshot.gateways === void 0 ? { reason: "publisher reported gateways unavailable" } : snapshot.gateways.exact && uvwTransform !== void 0 ? {} : { reason: "gateway endpoints lack an exact canonical transform" }
    }),
    Object.freeze({
      facet: "lighting",
      layerId: lightingLayerId,
      state: snapshot.lighting === void 0 ? "unavailable" : "available",
      itemCount: lighting.length,
      lods: Object.freeze(snapshot.lighting === void 0 ? [] : ["exact"]),
      contentRevision: contentRevisions.lighting,
      ...snapshot.lighting === void 0 ? { reason: "publisher reported world lighting unavailable" } : {}
    })
  ]);
  const layers = Object.freeze(
    facets.map(
      (item) => Object.freeze({
        facet: "layers",
        id: item.layerId,
        layerId: item.layerId,
        kind: item.facet,
        state: item.state,
        itemCount: item.itemCount,
        lods: item.lods,
        ...item.contentRevision === void 0 ? {} : { contentRevision: item.contentRevision },
        ...uvwTransform !== void 0 && (item.facet === "terrain" || item.facet === "terrain-materials" || item.facet === "cliffs") && item.state === "available" && (item.lods.includes("exact") || item.facet === "terrain-materials" && item.lods.includes("raster-exact")) ? {
          grid: Object.freeze({
            columns: item.facet === "cliffs" ? snapshot.cliffs.width : uvwTransform.heightfield.columns,
            rows: item.facet === "cliffs" ? snapshot.cliffs.height : uvwTransform.heightfield.rows,
            cellSize: uvwTransform.heightfield.cellSize,
            origin: item.facet === "cliffs" && uvwTransform.heightfield.sourceRowOrder === "reverse" && snapshot.cliffs.height < uvwTransform.heightfield.rows ? Object.freeze([
              uvwTransform.heightfield.origin[0],
              uvwTransform.heightfield.origin[1],
              uvwTransform.heightfield.origin[2] + uvwTransform.heightfield.cellSize
            ]) : uvwTransform.heightfield.origin,
            coordinateSpaceId: "uvw-canonical",
            ...item.facet === "terrain" && terrainNoDataValue !== void 0 ? { noDataValue: terrainNoDataValue } : {}
          })
        } : {},
        ...item.facet === "terrain-materials" && commonTerrainMaterials.length > 0 ? {
          materials: commonTerrainMaterials,
          ...commonTerrainWeightRasters.length === 0 ? {} : { weightRasters: commonTerrainWeightRasters }
        } : {},
        ...item.facet === "water" && commonWaterMaterials.length > 0 ? { waterMaterials: commonWaterMaterials } : {}
      })
    )
  );
  const byFacet = /* @__PURE__ */ new Map([
    ["layers", layers],
    ["terrain", terrain],
    ["terrain-materials", terrainMaterials],
    ["water", water],
    ["cliffs", cliffs],
    ["objects", objects],
    ["regions", regions],
    ["resources", resources],
    ["navigation", navigation],
    ["gateways", gateways],
    ["lighting", lighting]
  ]);
  const info = Object.freeze({
    contract: snapshot.worldCandidate.contract,
    major: snapshot.worldCandidate.major,
    maturity: snapshot.worldCandidate.maturity,
    snapshotId: snapshot.snapshotId,
    mapId: snapshot.mapId,
    coordinateSpaces: snapshot.worldCandidate.coordinateSpaces,
    crossSpaceTransforms: Object.freeze(
      snapshot.worldCandidate.crossSpaceTransforms.map((item) => {
        if (item.from === "height-grid" && item.to === "map-native" && terrainTransform === void 0) {
          return Object.freeze({
            ...item,
            state: "unknown",
            reason: "host rejected or did not receive an exact native terrain transform"
          });
        }
        if (item.from === "map-native" && item.to === "uvw-canonical" && uvwTransform === void 0) {
          return Object.freeze({
            ...item,
            state: "unknown",
            reason: "host rejected or did not receive a measured canonical world transform"
          });
        }
        return item;
      })
    ),
    bounds: Object.freeze([
      Object.freeze({
        facet: "terrain",
        coordinateSpaceId: terrainTransform === void 0 ? "height-grid" : "map-native",
        x: terrainTransform !== void 0 ? Object.freeze({
          state: "known",
          minimum: terrainTransform.bounds.minimum.x,
          maximum: terrainTransform.bounds.maximum.x
        }) : terrainSummary === void 0 ? Object.freeze({ state: "unknown", reason: "terrain bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: 0,
          maximum: terrainSummary.width - 1
        }),
        y: terrainTransform !== void 0 ? Object.freeze({
          state: "known",
          minimum: terrainTransform.bounds.minimum.y,
          maximum: terrainTransform.bounds.maximum.y
        }) : terrainSummary === void 0 ? Object.freeze({ state: "unknown", reason: "terrain bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: 0,
          maximum: terrainSummary.height - 1
        }),
        z: terrainTransform === void 0 ? Object.freeze({
          state: "unknown",
          reason: "publisher-native height quantization has no validated exact map-native conversion"
        }) : Object.freeze({
          state: "known",
          minimum: terrainTransform.bounds.minimum.z,
          maximum: terrainTransform.bounds.maximum.z
        })
      }),
      Object.freeze({
        facet: "objects",
        coordinateSpaceId: "map-native",
        x: semanticObjects.length === 0 ? Object.freeze({ state: "unknown", reason: "object bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: Math.min(...semanticObjects.map((item) => item.position.x)),
          maximum: Math.max(...semanticObjects.map((item) => item.position.x))
        }),
        y: semanticObjects.length === 0 ? Object.freeze({ state: "unknown", reason: "object bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: Math.min(...semanticObjects.map((item) => item.position.y)),
          maximum: Math.max(...semanticObjects.map((item) => item.position.y))
        }),
        z: semanticObjects.length === 0 ? Object.freeze({ state: "unknown", reason: "object bounds unavailable" }) : incompleteObjectPositionCount > 0 ? Object.freeze({
          state: "unknown",
          reason: "one or more objects have no publisher-defined elevation"
        }) : Object.freeze({
          state: "known",
          minimum: Math.min(...semanticObjects.map((item) => item.position.z)),
          maximum: Math.max(...semanticObjects.map((item) => item.position.z))
        })
      }),
      Object.freeze({
        facet: "regions",
        coordinateSpaceId: "map-native",
        x: Object.freeze({
          state: "unknown",
          reason: "region geometry is not normalized"
        }),
        y: Object.freeze({
          state: "unknown",
          reason: "region geometry is not normalized"
        }),
        z: Object.freeze({
          state: "unknown",
          reason: "region geometry is not normalized"
        })
      }),
      Object.freeze({
        facet: "navigation",
        coordinateSpaceId: "navigation-grid",
        x: snapshot.navigation === void 0 ? Object.freeze({ state: "unknown", reason: "navigation bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: 0,
          maximum: snapshot.navigation.width - 1
        }),
        y: snapshot.navigation === void 0 ? Object.freeze({ state: "unknown", reason: "navigation bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: 0,
          maximum: snapshot.navigation.height - 1
        }),
        z: Object.freeze({
          state: "unknown",
          reason: "navigation grid has no vertical axis"
        })
      }),
      Object.freeze({
        facet: "gateways",
        coordinateSpaceId: uvwTransform === void 0 ? "map-native" : "uvw-canonical",
        x: gateways.length === 0 ? Object.freeze({ state: "unknown", reason: "gateway bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: Math.min(
            ...gateways.flatMap(
              (item) => item.facet === "gateways" ? [item.uvwStart?.x ?? item.x1, item.uvwEnd?.x ?? item.x2] : []
            )
          ),
          maximum: Math.max(
            ...gateways.flatMap(
              (item) => item.facet === "gateways" ? [item.uvwStart?.x ?? item.x1, item.uvwEnd?.x ?? item.x2] : []
            )
          )
        }),
        y: Object.freeze({ state: "unknown", reason: "gateways have no vertical extent" }),
        z: gateways.length === 0 ? Object.freeze({ state: "unknown", reason: "gateway bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: Math.min(
            ...gateways.flatMap(
              (item) => item.facet === "gateways" ? [item.uvwStart?.z ?? item.y1, item.uvwEnd?.z ?? item.y2] : []
            )
          ),
          maximum: Math.max(
            ...gateways.flatMap(
              (item) => item.facet === "gateways" ? [item.uvwStart?.z ?? item.y1, item.uvwEnd?.z ?? item.y2] : []
            )
          )
        })
      })
    ]),
    ...terrainTransform === void 0 ? {} : { terrainTransform },
    ...uvwTransform === void 0 ? {} : { uvwTransform },
    ...uvwTransformRefusal === void 0 ? {} : { uvwTransformRefusal },
    ...semantic.players === void 0 ? {} : { players: Object.freeze(semantic.players.map((player) => Object.freeze({ ...player }))) },
    ...worldCamera(snapshot.camera) === void 0 ? {} : { camera: worldCamera(snapshot.camera) },
    facets,
    provenance: Object.freeze(provenance.map((item) => Object.freeze({ ...item }))),
    unknownFacets: snapshot.worldCandidate.unknownFacets,
    ...snapshot.worldCandidate.edit === void 0 ? {} : { edit: snapshot.worldCandidate.edit },
    lossPolicy: "explicit-partial",
    complete: snapshot.complete && duplicateObjectCount === 0 && duplicateRegionCount === 0 && incompleteRegionGeometryCount === 0 && incompleteObjectPositionCount === 0
  });
  let live = true;
  const assertLive = (signal) => {
    signal?.throwIfAborted();
    if (!live) throw new TypeError("world scene source lease is released or stale");
  };
  const source = Object.freeze({
    contract: snapshot.worldCandidate.contract,
    major: snapshot.worldCandidate.major,
    snapshotId: snapshot.snapshotId,
    async info(signal) {
      assertLive(signal);
      return Promise.resolve(info);
    },
    async page(request, signal) {
      assertLive(signal);
      positiveLimit(request.limit, maxPageSize);
      cursorOffset(request.cursor, snapshot.snapshotId, canonicalQuery(request));
      const items = byFacet.get(request.facet);
      if (items === void 0) {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: "unsupported",
            items: Object.freeze([]),
            reason: `publisher candidate does not expose facet ${request.facet}`
          })
        );
      }
      const facetState = facets.find((item) => item.facet === request.facet);
      if (request.facet !== "layers") {
        if (request.layerId !== facetState?.layerId) {
          throw new TypeError(`world facet ${request.facet} requires its exact layerId`);
        }
        const expectedLod = request.facet === "terrain" ? terrainLod : request.facet === "terrain-materials" ? terrainMaterialLod : request.facet === "cliffs" ? cliffLod : request.facet === "navigation" ? "sampled" : void 0;
        if (expectedLod !== void 0 && request.lod !== expectedLod) {
          return Promise.resolve(
            Object.freeze({
              snapshotId: snapshot.snapshotId,
              facet: request.facet,
              state: "unsupported",
              items: Object.freeze([]),
              reason: `facet ${request.facet} only pages ${expectedLod} LOD items`
            })
          );
        }
      }
      if (request.bounds !== void 0 && (request.facet === "layers" || request.facet === "regions" || request.facet === "resources" || request.facet === "lighting")) {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: "unsupported",
            items: Object.freeze([]),
            reason: `facet ${request.facet} does not support spatial bounds`
          })
        );
      }
      if (request.facet !== "layers" && facetState?.state === "unavailable") {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: "unavailable",
            items: Object.freeze([]),
            reason: facetState.reason ?? "facet unavailable"
          })
        );
      }
      const bounds = request.bounds;
      const bounded = bounds === void 0 ? items : items.filter((item) => {
        if (item.facet === "objects") {
          return item.position.x >= bounds.minimumX && item.position.x <= bounds.maximumX && item.position.y >= bounds.minimumY && item.position.y <= bounds.maximumY;
        }
        if (item.facet === "water") {
          return !(item.maximum.x < bounds.minimumX || item.minimum.x > bounds.maximumX || item.maximum.y < bounds.minimumY || item.minimum.y > bounds.maximumY);
        }
        if (item.facet === "gateways") {
          const startX = item.uvwStart?.x ?? item.x1;
          const startY = item.uvwStart?.z ?? item.y1;
          const endX = item.uvwEnd?.x ?? item.x2;
          const endY = item.uvwEnd?.z ?? item.y2;
          return !(Math.max(startX, endX) < bounds.minimumX || Math.min(startX, endX) > bounds.maximumX || Math.max(startY, endY) < bounds.minimumY || Math.min(startY, endY) > bounds.maximumY);
        }
        if (item.facet !== "terrain" && item.facet !== "terrain-materials" && item.facet !== "cliffs" && item.facet !== "navigation")
          return false;
        if (item.facet === "terrain" && item.mapNativePosition !== void 0) {
          return item.mapNativePosition.x >= bounds.minimumX && item.mapNativePosition.x <= bounds.maximumX && item.mapNativePosition.y >= bounds.minimumY && item.mapNativePosition.y <= bounds.maximumY;
        }
        return item.x >= bounds.minimumX && item.x <= bounds.maximumX && item.y >= bounds.minimumY && item.y <= bounds.maximumY;
      });
      return Promise.resolve(pageItems(bounded, request, snapshot.snapshotId, maxPageSize));
    },
    ...modelResources === void 0 ? {} : {
      async model(requestedResourceId, request, signal) {
        assertLive(signal);
        const { maxNodes } = worldSceneModelLimits(request, maxPageSize);
        const item = resources.find(
          (candidate) => candidate.facet === "resources" && candidate.id === requestedResourceId
        );
        if (item?.facet !== "resources" || item.modelResource === void 0) {
          return Object.freeze({
            state: "unresolved",
            diagnostics: Object.freeze([
              diagnostic(
                "warning",
                "x3.host/world-model-resource-unavailable",
                `world resource ${requestedResourceId} has no resolved logical model requirement`
              )
            ])
          });
        }
        const metersPerSourceUnit = request.metersPerSourceUnit ?? snapshot.semantic.modelMetersPerSourceUnit;
        const candidates = item.modelCandidates ?? [
          Object.freeze({ requirement: item.modelResource, yaw: 0 })
        ];
        let lease;
        let chosen = candidates[0];
        for (const candidate of candidates) {
          const attempt = await modelResources.acquire(
            {
              maxBytes: request.maxBytes,
              ...metersPerSourceUnit === void 0 ? {} : { metersPerSourceUnit },
              requirement: candidate.requirement
            },
            signal
          );
          chosen = candidate;
          lease = attempt;
          if (attempt.value.result.state !== "unresolved" || candidate === candidates.at(-1))
            break;
          await attempt.release();
        }
        const modelRequirement = chosen.requirement;
        if (lease === void 0) throw new TypeError("world model candidates are empty");
        const materialModel = item.materialModel;
        const skinItemsOf = async (model) => {
          let pendingSkin = materialModelCache.get(model.logicalId);
          if (pendingSkin === void 0) {
            pendingSkin = (async () => {
              const skinned = await modelResources.acquire(
                {
                  maxBytes: request.maxBytes,
                  ...metersPerSourceUnit === void 0 ? {} : { metersPerSourceUnit },
                  requirement: model
                },
                signal
              );
              try {
                if (skinned.value.result.state === "unresolved") return void 0;
                const read = skinned.value.materials;
                return read === void 0 ? void 0 : (await readAllPages(
                  (page) => read.call(skinned.value, page, signal),
                  maxNodes,
                  MODEL_FACET_ITEM_CAP
                )).items;
              } finally {
                await skinned.release();
              }
            })();
            materialModelCache.set(model.logicalId, pendingSkin);
          }
          return pendingSkin;
        };
        try {
          return await worldSceneModel(
            lease.value,
            request,
            {
              requirement: modelRequirement,
              yaw: chosen.yaw,
              maxPageSize,
              textureCache: modelTextureCache,
              ...item.modelTextureVariant === void 0 ? {} : { textureVariant: item.modelTextureVariant },
              ...materialModel === void 0 ? {} : {
                async skin(materials) {
                  const skinItems = await skinItemsOf(materialModel);
                  if (skinItems === void 0 || skinItems.length === 0)
                    return Object.freeze({
                      diagnostics: Object.freeze([
                        diagnostic(
                          "warning",
                          "x3.host/world-model-material-model-unavailable",
                          `material model ${materialModel.logicalId} published no materials; ${modelRequirement.logicalId} keeps its own`
                        )
                      ])
                    });
                  return Object.freeze({
                    materials: materials.map((material, index) => {
                      const replacement = skinItems[Math.min(index, skinItems.length - 1)];
                      return Object.freeze({ ...replacement, id: material.id });
                    }),
                    diagnostics: Object.freeze([])
                  });
                }
              }
            },
            signal
          );
        } finally {
          await lease.release();
        }
      }
    },
    ...rasterResources === void 0 && terrainWeightTextures.size === 0 ? {} : {
      async texture(requestedResourceId, request, signal) {
        assertLive(signal);
        positiveLimit(request.maxBytes, Number.MAX_SAFE_INTEGER);
        const weightTexture = terrainWeightTextures.get(requestedResourceId);
        if (weightTexture !== void 0) {
          if (weightTexture.rgba.byteLength > request.maxBytes) {
            return Object.freeze({
              state: "unresolved",
              diagnostics: Object.freeze([
                diagnostic(
                  "warning",
                  "x3.host/world-terrain-weight-raster-budget-exceeded",
                  `terrain weight raster ${requestedResourceId} exceeds maxBytes`
                )
              ])
            });
          }
          return Object.freeze({
            state: "decoded",
            texture: weightTexture,
            diagnostics: Object.freeze([])
          });
        }
        if (rasterResources === void 0) {
          return Object.freeze({
            state: "unresolved",
            diagnostics: Object.freeze([
              diagnostic(
                "warning",
                "x3.host/world-terrain-raster-port-unavailable",
                `terrain resource ${requestedResourceId} requires a raster resource port`
              )
            ])
          });
        }
        const requirement = [
          ...commonTerrainMaterials.flatMap((candidate) => [
            ...candidate.baseColorResourceId === requestedResourceId && candidate.baseColorResource !== void 0 ? [candidate.baseColorResource] : [],
            ...candidate.normalResourceId === requestedResourceId && candidate.normalResource !== void 0 ? [candidate.normalResource] : [],
            ...candidate.specularResourceId === requestedResourceId && candidate.specularResource !== void 0 ? [candidate.specularResource] : []
          ]),
          ...commonWaterMaterials.flatMap((candidate) => [
            ...candidate.baseColorResourceId === requestedResourceId && candidate.baseColorResource !== void 0 ? [candidate.baseColorResource] : [],
            ...candidate.secondaryColorResourceId === requestedResourceId && candidate.secondaryColorResource !== void 0 ? [candidate.secondaryColorResource] : [],
            ...candidate.causticsResourceId === requestedResourceId && candidate.causticsResource !== void 0 ? [candidate.causticsResource] : [],
            ...candidate.normalResourceId === requestedResourceId && candidate.normalResource !== void 0 ? [candidate.normalResource] : [],
            ...(candidate.causticsFrameResourceIds ?? []).flatMap((resourceId2, index) => {
              const frame = candidate.causticsFrameResources?.[index];
              return resourceId2 === requestedResourceId && frame !== void 0 ? [frame] : [];
            }),
            ...[
              ...(candidate.detailWaves?.normalResourceIds ?? []).map(
                (resourceId2, index) => [resourceId2, candidate.detailWaves?.normalResources[index]]
              ),
              ...(candidate.detailWaves?.foamResourceIds ?? []).map(
                (resourceId2, index) => [resourceId2, candidate.detailWaves?.foamResources?.[index]]
              )
            ].flatMap(
              ([resourceId2, resource]) => resourceId2 === requestedResourceId && resource !== void 0 ? [resource] : []
            )
          ])
        ][0];
        if (requirement === void 0) {
          return Object.freeze({
            state: "unresolved",
            diagnostics: Object.freeze([
              diagnostic(
                "warning",
                "x3.host/world-texture-resource-unavailable",
                `world resource ${requestedResourceId} has no scoped logical requirement`
              )
            ])
          });
        }
        const raster = await rasterResources.read(
          {
            kind: "logical",
            requirement,
            maxBytes: request.maxBytes,
            // a texture bigger than the budget comes at the largest level that fits, not refused
            selection: { mipLevel: "fit" },
            ...request.compressedFormats === void 0 ? {} : { compressedFormats: request.compressedFormats }
          },
          signal
        );
        if (raster.state !== "decoded" && raster.state !== "compressed") {
          return Object.freeze({
            state: "unresolved",
            diagnostics: Object.freeze([...raster.diagnostics])
          });
        }
        const texture = worldTexture(requestedResourceId, raster);
        if (texture === void 0) {
          return Object.freeze({
            state: "unresolved",
            diagnostics: Object.freeze([
              ...raster.diagnostics,
              diagnostic(
                "warning",
                "x3.host/world-terrain-texture-orientation-unknown",
                `terrain texture ${requestedResourceId} has no proven row orientation`
              )
            ])
          });
        }
        return Object.freeze({
          state: "decoded",
          texture,
          diagnostics: Object.freeze([...raster.diagnostics])
        });
      }
    }
  });
  return Object.freeze({
    value: source,
    async release() {
      live = false;
      await releaseModelResources?.();
    }
  });
}
var OFFER_KEYS2 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS2 = /* @__PURE__ */ new Set(["gameId"]);
var PREVIEW_OFFER_KEYS = /* @__PURE__ */ new Set(["subjectFormatIds"]);
var PREVIEW_REQUEST_KEYS = /* @__PURE__ */ new Set(["subjectFormatId"]);
function recordOf4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString3(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList2(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString3)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer3(value) {
  const record = recordOf4(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS2.has(key2))) {
    return void 0;
  }
  const gameIds = stringList2(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest3(value) {
  const record = recordOf4(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS2.has(key2))) {
    return void 0;
  }
  return nonEmptyString3(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchMapSemanticFacets(context) {
  const offer = parseOffer3(context.offerFacet);
  const request = parseRequest3(context.requestFacet);
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
function parsePreviewOffer(value) {
  const record = recordOf4(value);
  if (record === void 0 || Object.keys(record).some((key2) => !PREVIEW_OFFER_KEYS.has(key2))) {
    return void 0;
  }
  const subjectFormatIds = stringList2(record["subjectFormatIds"]);
  return subjectFormatIds === void 0 ? void 0 : { subjectFormatIds };
}
function parsePreviewRequest(value) {
  const record = recordOf4(value);
  if (record === void 0 || Object.keys(record).some((key2) => !PREVIEW_REQUEST_KEYS.has(key2))) {
    return void 0;
  }
  return nonEmptyString3(record["subjectFormatId"]) ? { subjectFormatId: record["subjectFormatId"] } : void 0;
}
function matchMapPreviewPreparationFacets(context) {
  const offer = parsePreviewOffer(context.offerFacet);
  const request = parsePreviewRequest(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/map-preview-preparation-facet-invalid",
          `${context.contract}@${context.major}: map preview preparation routes must be well formed`
        )
      ]
    };
  }
  return offer.subjectFormatIds.includes(request.subjectFormatId) ? { state: "match", selectionKey: `subject-format=${request.subjectFormatId}` } : { state: "no-match" };
}
var MAP_PREVIEW_PREPARATION_MATCHER = Object.freeze({
  profile: contractId(MAP_PREVIEW_PREPARATION_MATCHER_PROFILE),
  major: 1,
  match: matchMapPreviewPreparationFacets
});
var MAP_SEMANTIC_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: MAP_SEMANTIC_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-semantic-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-semantic-request.v1.schema.json"
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
var RESOLVED_MAP_WORKSPACE_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-semantic-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-semantic-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: MAP_SEMANTIC_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.map/resolved-workspace-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "analyzerId", "gameIds"]),
    methods: Object.freeze({
      plan: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 1048576 })
      }),
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 33554432, maxStringLength: 4194304 })
      })
    })
  })
});
var MAP_PREVIEW_PREPARATION_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: MAP_PREVIEW_PREPARATION_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-preview-preparation-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-preview-preparation-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({
    profile: MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
    major: 1
  }),
  conformanceProfile: "common.map/preview-preparation-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "preparationId", "subjectFormatIds"]),
    methods: Object.freeze({
      prepare: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 1048576 })
      })
    })
  })
});
var NATIVE_MAP_ENCODER_MATCHER = createFormatRouteMatcher(
  NATIVE_MAP_ENCODER_MATCHER_PROFILE,
  "x3.host/native-map-encoder-facet-invalid",
  "native map encoder"
);
var NATIVE_MAP_ENCODER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: NATIVE_MAP_ENCODER_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/native-map-encoder-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/native-map-encoder-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: NATIVE_MAP_ENCODER_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.map/native-encoder-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "formatId", "extension", "mediaType"]),
    methods: Object.freeze({
      encode: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
function isResolvedMapWorkspace(value) {
  const record = recordOf4(value);
  return record?.["contract"] === RESOLVED_MAP_WORKSPACE_CONTRACT && nonEmptyString3(record["analyzerId"]) && stringList2(record["gameIds"]) !== void 0 && typeof record["plan"] === "function" && typeof record["analyze"] === "function";
}
async function resolveResolvedMapWorkspace(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic(
          "information",
          "x3.host/resolved-map-workspace-unavailable",
          "this host registered no service-contract definitions for workspace maps"
        )
      ]
    };
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.budgets,
    ...request.signal === void 0 ? {} : { signal: request.signal }
  });
  try {
    const lease = await resolver.port.resolve({
      contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isResolvedMapWorkspace(lease.value) || !lease.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            "error",
            "x3.host/resolved-map-workspace-invalid",
            `selected provider does not implement ${RESOLVED_MAP_WORKSPACE_CONTRACT}@1`
          )
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      workspace: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          "information",
          "x3.host/resolved-map-workspace-selected",
          `selected ${lease.value.analyzerId} for ${request.gameId}`
        )
      ]),
      release: () => resolver.release()
    });
  } catch (error) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          "information",
          "x3.host/resolved-map-workspace-unresolved",
          `no workspace map provider resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`
        )
      ]
    };
  }
}
function isMapPreviewPreparation(value) {
  const record = recordOf4(value);
  return record?.["contract"] === MAP_PREVIEW_PREPARATION_CONTRACT && nonEmptyString3(record["preparationId"]) && stringList2(record["subjectFormatIds"]) !== void 0 && typeof record["prepare"] === "function";
}
async function resolveMapPreviewPreparation(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic(
          "information",
          "x3.host/map-preview-preparation-unavailable",
          "this host registered no service-contract definitions for map preview preparation"
        )
      ]
    };
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.budgets,
    ...request.signal === void 0 ? {} : { signal: request.signal }
  });
  try {
    const lease = await resolver.port.resolve({
      contract: MAP_PREVIEW_PREPARATION_CONTRACT,
      major: 1,
      facet: { subjectFormatId: request.subjectFormatId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isMapPreviewPreparation(lease.value) || !lease.value.subjectFormatIds.includes(request.subjectFormatId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            "error",
            "x3.host/map-preview-preparation-invalid",
            `selected provider does not implement ${MAP_PREVIEW_PREPARATION_CONTRACT}@1`
          )
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      preparation: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          "information",
          "x3.host/map-preview-preparation-selected",
          `selected ${lease.value.preparationId} for the subject format`
        )
      ]),
      release: () => resolver.release()
    });
  } catch (error) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          "information",
          "x3.host/map-preview-preparation-unresolved",
          `no map preview preparation provider resolved (${error instanceof Error ? error.message : String(error)})`
        )
      ]
    };
  }
}
var MAP_CATALOG_ROUNDS = 6;
async function analyzeWithCatalogEntities(options) {
  return answerCatalogQueries({
    ...options.initial === void 0 ? {} : { initial: options.initial },
    run: (answered, round) => options.analyze(
      answered === void 0 ? void 0 : Object.freeze({
        schemaVersion: 1,
        workspaceId: options.workspace.workspaceId,
        gameId: options.workspace.gameId,
        analyzerId: "x3.host/map-catalog-slice",
        typeIds: Object.freeze([]),
        namespaces: Object.freeze([]),
        entityCount: answered.length,
        patchCount: 0,
        definitions: answered,
        entities: answered,
        diagnostics: Object.freeze([]),
        complete: false
      }),
      round
    ),
    queriesOf: (snapshot) => snapshot.semantic.catalogQueries,
    catalogEntities: options.catalogEntities,
    rounds: MAP_CATALOG_ROUNDS,
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
}
function positiveBound2(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}
function withinOperationBudgets(limits, budgets) {
  if (BigInt(limits.maxTotalBytes) > budgets.maxInputBytes) {
    throw new TypeError("maxTotalBytes exceeds ResourceBudget.maxInputBytes");
  }
  if (limits.maxDocumentBytes > budgets.maxScalarBytes || limits.maxDocumentBytes > limits.maxTotalBytes) {
    throw new TypeError("maxDocumentBytes exceeds scalar or total byte budget");
  }
  for (const [label, value] of [
    ["maxRequirements", limits.maxRequirements],
    ["maxObjects", limits.maxObjects],
    ["maxRegions", limits.maxRegions],
    ["maxTerrainCells", limits.maxTerrainCells],
    ["maxTerrainSamples", limits.maxTerrainSamples],
    ["maxPageSize", limits.maxPageSize]
  ]) {
    if (value > budgets.maxNodes) throw new TypeError(`${label} exceeds ResourceBudget.maxNodes`);
  }
  if (limits.maxDepth > budgets.maxDepth) {
    throw new TypeError("maxDepth exceeds ResourceBudget.maxDepth");
  }
  if (limits.maxDiagnostics > budgets.maxDiagnostics) {
    throw new TypeError("maxDiagnostics exceeds ResourceBudget.maxDiagnostics");
  }
}
function boundedDiagnostics(items, maximum) {
  if (items.length <= maximum) return Object.freeze([...items]);
  const marker = diagnostic(
    "warning",
    "x3.host/resolved-map-diagnostics-truncated",
    `workspace map diagnostics were truncated to maxDiagnostics ${maximum}`
  );
  return Object.freeze(maximum === 1 ? [marker] : [...items.slice(0, maximum - 1), marker]);
}
function validateWorkspacePlan2(plan, workspace, maxRequirements) {
  if (plan.schemaVersion !== 1 || plan.workspaceId !== workspace.workspaceId || plan.gameId !== workspace.gameId || !nonEmptyString3(plan.analyzerId) || !Array.isArray(plan.requirements) || plan.requirements.length > maxRequirements) {
    throw new TypeError("workspace map provider returned an invalid or foreign plan");
  }
  const active = workspace.loadOrder.find((item) => item.rootId === workspace.activeRootId);
  if (active === void 0 || plan.mapId !== active.sourcePath) {
    throw new TypeError("workspace map plan does not name the active root exactly");
  }
  const root = active.sourcePath.replaceAll("\\", "/");
  const prefix = `${root}/`;
  const ids = /* @__PURE__ */ new Set();
  const paths = /* @__PURE__ */ new Set();
  for (const requirement of plan.requirements) {
    const path = requirement.path.replaceAll("\\", "/");
    const segments = path.split("/");
    const mapRootScoped = requirement.scope === void 0 || requirement.scope === "map-root";
    if (!nonEmptyString3(requirement.requirementId) || !nonEmptyString3(requirement.kind) || typeof requirement.required !== "boolean" || requirement.scope !== void 0 && requirement.scope !== "map-root" && requirement.scope !== "workspace" || path !== requirement.path || path.startsWith("/") || /^[A-Za-z]:/u.test(path) || segments.some((segment) => segment === "" || segment === "." || segment === "..") || mapRootScoped && (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) || ids.has(requirement.requirementId) || paths.has(path.toLowerCase())) {
      throw new TypeError("workspace map plan contains a duplicate, non-confined or invalid read");
    }
    ids.add(requirement.requirementId);
    paths.add(path.toLowerCase());
  }
  const window2 = plan.window;
  if (window2 !== void 0 && !([window2.minimumX, window2.minimumY, window2.maximumX, window2.maximumY].every(Number.isFinite) && window2.minimumX <= window2.maximumX && window2.minimumY <= window2.maximumY))
    throw new TypeError("workspace map plan names a window that is not finite and ordered");
}
function windowCovers(outer, inner) {
  return outer.minimumX <= inner.minimumX && outer.minimumY <= inner.minimumY && outer.maximumX >= inner.maximumX && outer.maximumY >= inner.maximumY;
}
async function readResourceBytes(resources, requirement, maxDocumentBytes, remainingTotalBytes, signal) {
  if (remainingTotalBytes <= 0) {
    return {
      state: "unresolved",
      diagnostic: diagnostic(
        "warning",
        "x3.host/resolved-map-total-budget-exceeded",
        `${requirement.path} cannot be read because maxTotalBytes is exhausted`
      ),
      consumedBytes: 0
    };
  }
  const resolved = await resources.resolve(
    {
      id: requirement.requirementId,
      logicalId: requirement.path,
      role: "buffer",
      scopes: ["current-mount", "enclosing-container", "workspace-dependency-layer"]
    },
    signal
  );
  if (resolved.state === "unresolved") {
    return { state: "unresolved", diagnostic: resolved.diagnostic, consumedBytes: 0 };
  }
  try {
    const source = resolved.lease.value;
    if (source.kind !== "bytes") {
      return {
        state: "unresolved",
        diagnostic: diagnostic(
          "warning",
          "x3.host/resolved-map-resource-not-bytes",
          `${requirement.path} resolved to a namespace instead of bytes`
        ),
        consumedBytes: 0
      };
    }
    if (source.size !== void 0 && (source.size > BigInt(maxDocumentBytes) || source.size > BigInt(remainingTotalBytes))) {
      const totalExceeded = source.size > BigInt(remainingTotalBytes);
      return {
        state: "unresolved",
        diagnostic: diagnostic(
          "warning",
          totalExceeded ? "x3.host/resolved-map-total-budget-exceeded" : "x3.host/resolved-map-document-budget-exceeded",
          totalExceeded ? `${requirement.path} exceeds remaining maxTotalBytes ${remainingTotalBytes}` : `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`
        ),
        consumedBytes: 0
      };
    }
    const chunks = [];
    let byteLength = 0;
    try {
      for await (const chunk of source.stream(void 0, signal)) {
        byteLength += chunk.byteLength;
        if (byteLength > maxDocumentBytes || byteLength > remainingTotalBytes) {
          return {
            state: "unresolved",
            diagnostic: diagnostic(
              "warning",
              byteLength > remainingTotalBytes ? "x3.host/resolved-map-total-budget-exceeded" : "x3.host/resolved-map-document-budget-exceeded",
              byteLength > remainingTotalBytes ? `${requirement.path} exceeds remaining maxTotalBytes ${remainingTotalBytes}` : `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`
            ),
            consumedBytes: byteLength
          };
        }
        chunks.push(chunk);
      }
    } catch (error) {
      signal?.throwIfAborted();
      return {
        state: "unresolved",
        diagnostic: diagnostic(
          "warning",
          "x3.host/resolved-map-document-read-failed",
          `${requirement.path}: ${error instanceof Error ? error.message : String(error)}`
        ),
        consumedBytes: byteLength
      };
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      state: "resolved",
      document: Object.freeze({ path: requirement.path, bytes }),
      revision: resolved.revision,
      contentFingerprint: await fingerprintBytes(bytes),
      consumedBytes: byteLength
    };
  } finally {
    await resolved.lease.release();
  }
}
async function fingerprintBytes(bytes) {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", copy.buffer));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
async function analyzeResolvedMapWorkspace(request) {
  const limits = {
    maxRequirements: positiveBound2(request.limits.maxRequirements, "maxRequirements"),
    maxDocumentBytes: positiveBound2(request.limits.maxDocumentBytes, "maxDocumentBytes"),
    maxTotalBytes: positiveBound2(request.limits.maxTotalBytes, "maxTotalBytes"),
    maxObjects: positiveBound2(request.limits.maxObjects, "maxObjects"),
    maxRegions: positiveBound2(request.limits.maxRegions, "maxRegions"),
    maxTerrainCells: positiveBound2(request.limits.maxTerrainCells, "maxTerrainCells"),
    maxTerrainSamples: positiveBound2(request.limits.maxTerrainSamples, "maxTerrainSamples"),
    maxDepth: positiveBound2(request.limits.maxDepth, "maxDepth"),
    maxPageSize: positiveBound2(request.limits.maxPageSize, "maxPageSize"),
    maxDiagnostics: positiveBound2(request.limits.maxDiagnostics, "maxDiagnostics")
  };
  withinOperationBudgets(limits, request.budgets);
  if (request.resources.state() !== "live") {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic(
          "warning",
          "x3.host/resolved-map-resource-session-disposed",
          "workspace map analysis requires a live revision-pinned ResourceSessionPort"
        )
      ]
    };
  }
  const resolution = await resolveResolvedMapWorkspace({
    services: request.services,
    gameId: request.workspace.gameId,
    grant: request.grant,
    budgets: request.budgets,
    ...request.signal === void 0 ? {} : { signal: request.signal }
  });
  if (resolution.state === "unresolved") return resolution;
  const diagnostics = [...resolution.diagnostics];
  try {
    const provenanceOffset = request.resources.provenance().length;
    const readWindow = async (window2, signal, holds) => {
      const plan2 = await resolution.workspace.plan({
        workspace: request.workspace,
        maxRequirements: limits.maxRequirements,
        ...window2 === void 0 ? {} : { window: window2 },
        ...signal === void 0 ? {} : { signal }
      });
      validateWorkspacePlan2(plan2, request.workspace, limits.maxRequirements);
      const found = plan2.diagnostics.map(
        (item) => diagnostic(item.severity, item.code, item.message, void 0, {
          analyzerId: plan2.analyzerId
        })
      );
      if (!plan2.complete || holds !== void 0 && plan2.window !== void 0 && windowCovers(holds, plan2.window))
        return { complete: false, diagnostics: found };
      const documents = [];
      const revisions = [];
      const readDigests2 = /* @__PURE__ */ new Map();
      const unresolvedRequirementIds = [];
      let totalBytes = 0;
      for (const requirement of plan2.requirements) {
        signal?.throwIfAborted();
        const loaded = await readResourceBytes(
          request.resources,
          requirement,
          limits.maxDocumentBytes,
          limits.maxTotalBytes - totalBytes,
          signal
        );
        totalBytes += loaded.consumedBytes;
        if (loaded.state === "unresolved") {
          found.push(loaded.diagnostic);
          unresolvedRequirementIds.push(requirement.requirementId);
          continue;
        }
        if (totalBytes > limits.maxTotalBytes) {
          throw new TypeError(
            `workspace map documents exceed maxTotalBytes ${limits.maxTotalBytes}`
          );
        }
        documents.push(loaded.document);
        readDigests2.set(
          requirement.path.slice(requirement.path.lastIndexOf("/") + 1).toLowerCase(),
          loaded.contentFingerprint
        );
        revisions.push(
          `${requirement.requirementId}:${requirement.path}@${String(loaded.revision)}#${loaded.contentFingerprint}`
        );
      }
      if (request.resources.state() !== "live") {
        throw new Error("resource session was disposed while workspace map documents were loading");
      }
      const snapshotId = [
        `session=${String(request.resources.revision)}`,
        `workspace=${encodeURIComponent(request.workspace.workspaceId)}`,
        `map=${encodeURIComponent(plan2.mapId)}`,
        ...revisions
      ].join("|");
      const analyze2 = (catalog, round) => resolution.workspace.analyze({
        workspaceId: request.workspace.workspaceId,
        gameId: request.workspace.gameId,
        mapId: plan2.mapId,
        documents,
        ...catalog === void 0 ? {} : { catalog },
        ...request.subjectOperationIds === void 0 ? {} : { subjectOperationIds: request.subjectOperationIds },
        ...plan2.window === void 0 ? {} : { window: plan2.window },
        // the documents this request carries, not the caller's budget: a provider's own ceiling
        // (SC2 maps take 16) never refuses a map because an application allows more (32, Warzone)
        maxDocuments: Math.max(1, documents.length),
        maxDocumentBytes: limits.maxDocumentBytes,
        maxTotalBytes: limits.maxTotalBytes,
        maxObjects: limits.maxObjects,
        maxRegions: limits.maxRegions,
        maxTerrainCells: limits.maxTerrainCells,
        maxTerrainSamples: limits.maxTerrainSamples,
        maxDepth: limits.maxDepth,
        maxDiagnostics: limits.maxDiagnostics,
        snapshotId: round === 0 ? snapshotId : `${snapshotId}|catalog-round=${round}`,
        unresolvedRequirementIds,
        requiredRequirementIds: plan2.requirements.filter((item) => item.required).map((item) => item.requirementId),
        ...signal === void 0 ? {} : { signal }
      });
      return { complete: true, plan: plan2, readDigests: readDigests2, analyze: analyze2, diagnostics: found };
    };
    const first = await readWindow(void 0, request.signal);
    diagnostics.push(...first.diagnostics);
    if (!first.complete) {
      await resolution.release();
      return {
        state: "unresolved",
        diagnostics: boundedDiagnostics(diagnostics, limits.maxDiagnostics)
      };
    }
    const { plan, readDigests, analyze } = first;
    const asking = request.catalog === void 0 ? request.catalogEntities : void 0;
    const progressive = asking !== void 0 && request.progressiveCatalog === true;
    const background = new AbortController();
    const backgroundSignal = request.signal === void 0 ? background.signal : AbortSignal.any([request.signal, background.signal]);
    const snapshot = asking === void 0 ? await analyze(request.catalog, 0) : progressive ? await analyze(void 0, 0) : await analyzeWithCatalogEntities({
      workspace: request.workspace,
      analyze,
      catalogEntities: asking,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (request.resources.state() !== "live") {
      throw new Error("resource session was disposed while workspace map was analyzed");
    }
    const modelState = {
      live: true,
      reservedBytes: 0,
      resources: request.resources
    };
    const resourceInput = (path) => {
      const resolver = path === void 0 || path === "" ? request.inputResolver : request.inputResolver?.forResource?.(path) ?? request.inputResolver;
      return resolver === void 0 ? {} : { resolveInput: resolver };
    };
    const modelReleases = [];
    const modelResources = createSubjectModelResources({
      state: modelState,
      budget: request.budgets,
      isAuthorized: () => modelState.live && request.grant.classes.includes("read-source"),
      ancestors: [`map:${request.workspace.workspaceId}@${request.resources.revision}`],
      own: (release) => modelReleases.push(release),
      ...request.onModelResourceProfile === void 0 ? {} : { onProfile: request.onModelResourceProfile },
      open: (source, path, signal) => openSubject({
        inventory: request.services.inventory,
        source,
        path,
        target: request.services.target,
        intent: "full",
        grant: { ...request.grant, classes: ["read-source"] },
        budget: request.budgets,
        executionBackends: request.services.executionBackends,
        ...request.services.serviceDefinitions === void 0 ? {} : { serviceDefinitions: request.services.serviceDefinitions },
        ...request.services.contributionSettings === void 0 ? {} : { contributionSettings: request.services.contributionSettings },
        resourceSession: request.resources,
        ...resourceInput(path),
        ...signal === void 0 ? {} : { signal }
      })
    });
    const releaseModelResources = async () => {
      if (!modelState.live) return;
      modelState.live = false;
      const outcomes = await Promise.allSettled(modelReleases.map((release) => release()));
      const failure2 = outcomes.find((outcome) => outcome.status === "rejected");
      if (failure2?.status === "rejected") throw failure2.reason;
    };
    const rasterResources = createSubjectRasterResources({
      state: modelState,
      budget: request.budgets,
      isAuthorized: () => modelState.live && request.grant.classes.includes("read-source"),
      open: (source, hint, signal) => openSubject({
        inventory: request.services.inventory,
        source,
        path: hint.path ?? "",
        target: request.services.target,
        intent: "full",
        grant: { ...request.grant, classes: ["read-source"] },
        budget: request.budgets,
        executionBackends: request.services.executionBackends,
        ...request.services.serviceDefinitions === void 0 ? {} : { serviceDefinitions: request.services.serviceDefinitions },
        ...request.services.contributionSettings === void 0 ? {} : { contributionSettings: request.services.contributionSettings },
        resourceSession: request.resources,
        ...resourceInput(hint.path),
        ...signal === void 0 ? {} : { signal }
      })
    });
    const worldOf = (analyzed, corpusRefusal2, release) => createCandidateWorldSceneLease(
      analyzed,
      request.resources.provenance().slice(provenanceOffset),
      limits.maxPageSize,
      modelResources,
      release,
      rasterResources,
      corpusRefusal2
    );
    const corpusRefusal = await worldTransformCorpusRefusal(snapshot, readDigests);
    const covered = plan.window;
    const shownWorld = !progressive ? worldOf(snapshot, corpusRefusal, covered === void 0 ? releaseModelResources : void 0) : refinableWorldLease(
      worldOf(snapshot, corpusRefusal),
      analyzeWithCatalogEntities({
        workspace: request.workspace,
        analyze: (catalog, round) => analyze(catalog, round).then((result) => {
          backgroundSignal.throwIfAborted();
          return result;
        }),
        catalogEntities: asking,
        initial: snapshot,
        signal: backgroundSignal
      }).then(
        async (answered) => answered === snapshot ? void 0 : worldOf(answered, await worldTransformCorpusRefusal(answered, readDigests)),
        () => void 0
      ),
      () => background.abort(),
      covered === void 0 ? releaseModelResources : async () => void 0
    );
    const lifetime = new AbortController();
    const world = covered === void 0 ? shownWorld : growingWorldLease(
      shownWorld,
      covered,
      async (window2, holds, signal) => {
        const scoped = signal === void 0 ? lifetime.signal : AbortSignal.any([signal, lifetime.signal]);
        const read = await readWindow(window2, scoped, holds);
        if (!read.complete || read.plan.window === void 0) return void 0;
        const grown = asking === void 0 ? await read.analyze(request.catalog, 0) : await analyzeWithCatalogEntities({
          workspace: request.workspace,
          analyze: read.analyze,
          catalogEntities: asking,
          signal: scoped
        });
        return {
          lease: worldOf(grown, await worldTransformCorpusRefusal(grown, read.readDigests)),
          covered: read.plan.window
        };
      },
      () => lifetime.abort(),
      releaseModelResources
    );
    let released = false;
    return Object.freeze({
      state: "resolved",
      snapshot,
      plan,
      world,
      diagnostics: boundedDiagnostics(diagnostics, limits.maxDiagnostics),
      async release() {
        if (released) return;
        released = true;
        const results = await Promise.allSettled([world.release(), resolution.release()]);
        const failure2 = results.find((result) => result.status === "rejected");
        if (failure2?.status === "rejected") throw failure2.reason;
      }
    });
  } catch (error) {
    await resolution.release();
    if (request.signal?.aborted) throw error;
    return {
      state: "unresolved",
      diagnostics: boundedDiagnostics(
        [
          ...diagnostics,
          diagnostic(
            "warning",
            "x3.host/resolved-map-workspace-failed",
            error instanceof Error ? error.message : String(error)
          )
        ],
        limits.maxDiagnostics
      )
    };
  }
}
function previewDiagnostic(item, index) {
  return Object.freeze({
    id: `map-preview-${String(index)}`,
    category: "unknown",
    code: item.code,
    severity: item.severity,
    message: item.message,
    ...item.path === void 0 ? {} : { path: item.path },
    ...item.range === void 0 ? {} : { range: item.range }
  });
}
function borrowCommonWorldScene(candidate) {
  let live = true;
  const assertLive = (signal) => {
    signal?.throwIfAborted();
    if (!live) throw new TypeError("world scene data-source lease has been released");
  };
  const source = Object.freeze({
    contract: WORLD_SCENE_SOURCE_CONTRACT,
    major: 1,
    // a refinable world names a new snapshot once refined
    get snapshotId() {
      return candidate.snapshotId;
    },
    ...candidate.refined === void 0 ? {} : {
      async refined(signal) {
        assertLive(signal);
        return candidate.refined(signal);
      }
    },
    ...candidate.focus === void 0 ? {} : {
      async focus(window2, signal) {
        assertLive(signal);
        return candidate.focus(window2, signal);
      }
    },
    async info(signal) {
      assertLive(signal);
      const info = await candidate.info(signal);
      assertLive(signal);
      return Object.freeze({ ...info, contract: WORLD_SCENE_SOURCE_CONTRACT });
    },
    async page(request, signal) {
      assertLive(signal);
      const page = await candidate.page(request, signal);
      assertLive(signal);
      return page;
    },
    ...candidate.model === void 0 ? {} : {
      async model(resourceId2, request, signal) {
        assertLive(signal);
        const result = await candidate.model(resourceId2, request, signal);
        assertLive(signal);
        return result;
      }
    },
    ...candidate.texture === void 0 ? {} : {
      async texture(resourceId2, request, signal) {
        assertLive(signal);
        const result = await candidate.texture(resourceId2, request, signal);
        assertLive(signal);
        return result;
      }
    }
  });
  return Object.freeze({
    value: source,
    release() {
      live = false;
      return Promise.resolve();
    }
  });
}
function borrowDataSource(source) {
  let live = true;
  const target = /* @__PURE__ */ Object.create(null);
  const value = new Proxy(target, {
    get(_target, property) {
      const member = Reflect.get(source, property, source);
      if (typeof member !== "function") return member;
      return (...args) => {
        if (!live) throw new TypeError("map preview data-source lease has been released");
        return Reflect.apply(member, source, args);
      };
    }
  });
  return Object.freeze({
    value,
    release() {
      live = false;
      return Promise.resolve();
    }
  });
}
async function openMapPreviewAssetSession(request) {
  let analyzed;
  try {
    analyzed = await analyzeResolvedMapWorkspace(request);
  } catch (error) {
    await Promise.allSettled([request.resources.dispose(), request.catalogSources?.release()]);
    throw error;
  }
  if (analyzed.state === "unresolved") {
    await Promise.allSettled([request.resources.dispose(), request.catalogSources?.release()]);
    return analyzed;
  }
  try {
    const catalogSources = request.catalogSources;
    const descriptor = await assembleSubjectDescriptor({
      schemaVersion: 2,
      subjectUri: request.subjectUri,
      origin: {
        kind: "namespace",
        root: { id: request.workspace.activeRootId, uri: request.subjectUri },
        revision: request.resources.revision
      },
      interpretation: "none",
      candidates: [],
      traits: [],
      operations: [],
      constraints: {
        readOnly: true,
        seekable: false,
        randomAccess: true,
        trusted: false
      },
      dataSources: [
        { contract: WORLD_SCENE_SOURCE_CONTRACT, major: 1 },
        ...catalogSources === void 0 ? [] : [{ contract: contractId("common.view/relation-graph-source"), major: 1 }],
        ...catalogSources?.selector === void 0 ? [] : [{ contract: contractId("common.view/subject-selector-source"), major: 1 }]
      ],
      diagnostics: analyzed.diagnostics.map(previewDiagnostic),
      revision: request.resources.revision
    });
    const managed = createAssetSession({
      revision: request.resources.revision,
      descriptor,
      operationDeclarations: [],
      permissionGrant: request.grant,
      handlers: /* @__PURE__ */ new Map(),
      async openDataSource(contract, major) {
        if (major === 1) {
          if (contract === WORLD_SCENE_SOURCE_CONTRACT) {
            return borrowCommonWorldScene(analyzed.world.value);
          }
          if (contract === "common.view/relation-graph-source" && catalogSources !== void 0) {
            return borrowDataSource(catalogSources.relations);
          }
          if (contract === "common.view/subject-selector-source" && catalogSources?.selector !== void 0) {
            return borrowDataSource(catalogSources.selector);
          }
        }
        throw new ModkitError({
          code: "x3.host/map-preview-data-source-unavailable",
          message: `map preview does not publish ${contract}@${String(major)}`
        });
      },
      // createAssetSession releases in reverse order: analysis first, then its ResourceSession.
      release: [
        () => request.resources.dispose(),
        ...catalogSources === void 0 ? [] : [() => catalogSources.release()],
        () => analyzed.release()
      ]
    });
    return Object.freeze({
      state: "opened",
      session: managed.session,
      descriptor,
      snapshot: analyzed.snapshot,
      plan: analyzed.plan,
      diagnostics: analyzed.diagnostics
    });
  } catch (error) {
    await Promise.allSettled([
      analyzed.release(),
      request.catalogSources?.release(),
      request.resources.dispose()
    ]);
    throw error;
  }
}
var MAP_PREVIEW_COORDINATOR_LIMITS = Object.freeze({
  // Pinned mp.wz publishes 39 map candidates; 64 is the bounded product ceiling above that corpus.
  maxCandidates: 64,
  maxSubjectEntries: 4096,
  maxSubjectPages: 64,
  maxRoots: 64,
  maxDepth: 16,
  catalogEnrichment: Object.freeze({
    locales: Object.freeze(["enUS"]),
    limits: Object.freeze({
      // Full catalog planning over the installed StarCraft II stock chain asks for 555 reads.
      maxRequirements: 512,
      maxDocumentBytes: 16777216,
      maxTextBytes: 268435456,
      maxEntities: 1e5,
      maxDepth: 128,
      maxPageSize: 1e3
    })
  }),
  limits: Object.freeze({
    // Warzone 2100 reads 22 map documents (level.json and each tileset's ground and decal files).
    maxRequirements: 32,
    maxDocumentBytes: 33554432,
    maxTotalBytes: 67108864,
    maxObjects: 1e5,
    maxRegions: 1e4,
    maxTerrainCells: 1e5,
    maxTerrainSamples: 1e5,
    maxDepth: 64,
    maxPageSize: 4096,
    maxDiagnostics: 100
  })
});
function withMapPreviewSources(codec, preview) {
  const key2 = (offer) => `${offer.contract}@${offer.major}`;
  const descriptor = async () => {
    const [own, previewed] = await Promise.all([codec.descriptor(), preview.descriptor()]);
    const owned = new Set(own.dataSources.map(key2));
    const added = previewed.dataSources.filter((offer) => !owned.has(key2(offer)));
    const ownTraits = new Set(own.traits.map((trait) => trait.id));
    const traits = previewed.traits.filter((trait) => !ownTraits.has(trait.id));
    const cited = new Set(traits.flatMap((trait) => trait.diagnosticIds ?? []));
    const ownDiagnostics = new Set(own.diagnostics.map((item) => item.id));
    const diagnostics = previewed.diagnostics.filter(
      (item) => cited.has(item.id) && !ownDiagnostics.has(item.id)
    );
    return {
      added,
      merged: Object.freeze({
        ...own,
        traits: Object.freeze([...own.traits, ...traits]),
        dataSources: Object.freeze([...own.dataSources, ...added]),
        diagnostics: Object.freeze([...own.diagnostics, ...diagnostics])
      })
    };
  };
  return Object.freeze({
    revision: codec.revision,
    state: () => codec.state(),
    descriptor: async () => (await descriptor()).merged,
    dataSource: (async (contract, major, ...rest) => {
      const { added } = await descriptor();
      const from = added.some((offer) => offer.contract === contract && offer.major === major) ? preview : codec;
      return from.dataSource(contract, major, ...rest);
    }),
    operations: () => codec.operations(),
    events: (signal) => codec.events(signal),
    dispose: () => preview.dispose()
  });
}
var PREVIEW_DIAGNOSTIC_SEVERITIES = /* @__PURE__ */ new Set(["error", "warning", "information", "hint"]);
var MAX_PREVIEW_NAMESPACE_SEARCHES = 8;
var MAX_PREVIEW_NAMESPACE_SEARCH_BASENAMES = 16;
var MAX_PREVIEW_NAMESPACE_SEARCH_BASENAME_CHARS = 512;
var MAX_PREVIEW_NAMESPACE_SEARCH_ID_CHARS = 512;
var MAX_PREVIEW_NAMESPACE_FACT_ENTRIES = 2e4;
var MAX_PREVIEW_NAMESPACE_FACT_PAGES = 256;
var MAX_PREVIEW_NAMESPACE_PATH_CHARS = 4096;
var MAX_PREVIEW_NAMESPACE_CURSOR_CHARS = 4096;
var MAX_PREVIEW_DOCUMENT_READS = 8;
var MAX_PREVIEW_DOCUMENT_READ_BYTES = 1048576;
var MAX_PREVIEW_DOCUMENT_TOTAL_BYTES = 4194304;
var MAX_PREVIEW_DOCUMENT_ROUNDS = 8;
function positiveCoordinatorLimit(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}
function boundedCoordinatorLimit(value, label, maximum) {
  const admitted = positiveCoordinatorLimit(value, label);
  if (admitted > maximum) throw new TypeError(`${label} must be no greater than ${maximum}`);
  return admitted;
}
function validPreparationDiagnostic(value) {
  const record = recordOf4(value);
  return record !== void 0 && Object.keys(record).every(
    (key2) => ["code", "severity", "message", "path", "data"].includes(key2)
  ) && nonEmptyString3(record["code"]) && PREVIEW_DIAGNOSTIC_SEVERITIES.has(String(record["severity"])) && nonEmptyString3(record["message"]) && (!Object.hasOwn(record, "path") || Array.isArray(record["path"]) && record["path"].every((item) => typeof item === "string" || Number.isSafeInteger(item))) && (!Object.hasOwn(record, "data") || isJsonValue(record["data"]));
}
function validNamespaceSearchQuery(value) {
  const query = recordOf4(value);
  if (query === void 0 || !Object.keys(query).every(
    (key2) => key2 === "kind" || key2 === "basenames" || key2 === "caseSensitive"
  ) || query["kind"] !== "basename-any" || !Array.isArray(query["basenames"]) || query["basenames"].length === 0 || query["basenames"].length > MAX_PREVIEW_NAMESPACE_SEARCH_BASENAMES || typeof query["caseSensitive"] !== "boolean") {
    return false;
  }
  const basenames = query["basenames"];
  const validBasenames = basenames.every(
    (item) => nonEmptyString3(item) && item.length <= MAX_PREVIEW_NAMESPACE_SEARCH_BASENAME_CHARS && !item.includes("/") && !item.includes("\\") && !item.includes("\0") && item !== "." && item !== ".."
  );
  if (!validBasenames) return false;
  const identityBasenames = query["caseSensitive"] ? basenames : basenames.map((item) => item.toLowerCase());
  return new Set(identityBasenames).size === basenames.length;
}
function validateNamespaceSearchRequests(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PREVIEW_NAMESPACE_SEARCHES || !value.every((item) => {
    const search = recordOf4(item);
    return search !== void 0 && Object.keys(search).every((key2) => key2 === "searchId" || key2 === "query") && nonEmptyString3(search["searchId"]) && search["searchId"].length <= MAX_PREVIEW_NAMESPACE_SEARCH_ID_CHARS && !search["searchId"].includes("\0") && validNamespaceSearchQuery(search["query"]);
  }) || new Set(value.map((item) => String(recordOf4(item)?.["searchId"] ?? ""))).size !== value.length) {
    throw new TypeError("map preview preparation returned invalid namespace searches");
  }
  return value;
}
function validateDocumentReadRequests(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PREVIEW_DOCUMENT_READS) {
    throw new TypeError("map preview preparation returned invalid document reads");
  }
  let totalBytes = 0;
  const identities = /* @__PURE__ */ new Set();
  for (const [index, item] of value.entries()) {
    const document2 = recordOf4(item);
    if (document2 === void 0 || !Object.keys(document2).every(
      (key2) => key2 === "documentId" || key2 === "path" || key2 === "maxBytes"
    ) || !nonEmptyString3(document2["documentId"]) || document2["documentId"].length > 256 || document2["documentId"].includes("\0") || !nonEmptyString3(document2["path"]) || document2["path"].length > MAX_PREVIEW_NAMESPACE_PATH_CHARS || document2["path"].includes("\0") || document2["path"].startsWith("/") || /^[a-z]:/iu.test(document2["path"]) || document2["path"].replace(/\\/gu, "/").split("/").some((part) => part === "..") || !Number.isSafeInteger(document2["maxBytes"]) || Number(document2["maxBytes"]) <= 0 || Number(document2["maxBytes"]) > MAX_PREVIEW_DOCUMENT_READ_BYTES) {
      throw new TypeError(`map preview document read ${index} is malformed`);
    }
    if (identities.has(document2["documentId"])) {
      throw new TypeError("map preview document reads contain duplicate document ids");
    }
    identities.add(document2["documentId"]);
    totalBytes += Number(document2["maxBytes"]);
  }
  if (totalBytes > MAX_PREVIEW_DOCUMENT_TOTAL_BYTES) {
    throw new TypeError("map preview document reads exceed the total byte budget");
  }
  return value;
}
function validHostResourceRoot(value) {
  const record = recordOf4(value);
  return record !== void 0 && Object.keys(record).every((key2) => key2 === "rootId" || key2 === "locator" || key2 === "optional") && nonEmptyString3(record["rootId"]) && Object.hasOwn(record, "locator") && isJsonValue(record["locator"]) && (record["optional"] === void 0 || typeof record["optional"] === "boolean");
}
function validSubjectNamespaceRoot(value) {
  const record = recordOf4(value);
  return record !== void 0 && Object.keys(record).every(
    (key2) => key2 === "rootId" || key2 === "namespacePrefix" || key2 === "assetRoots"
  ) && nonEmptyString3(record["rootId"]) && typeof record["namespacePrefix"] === "string" && (record["assetRoots"] === void 0 || Array.isArray(record["assetRoots"]) && record["assetRoots"].length <= 16 && record["assetRoots"].every(
    (root) => typeof root === "string" && root.length <= 128
  ));
}
function validateResourcePlan(value, maxRoots) {
  const plan = recordOf4(value);
  if (plan?.["schemaVersion"] !== 1) {
    throw new TypeError("map preview preparation returned no versioned resource plan");
  }
  if (plan["strategy"] === "subject-namespace") {
    const roots = plan["roots"];
    if (!Object.keys(plan).every(
      (key2) => key2 === "schemaVersion" || key2 === "strategy" || key2 === "roots"
    ) || !Array.isArray(roots) || roots.length === 0 || roots.length > maxRoots || !roots.every(validSubjectNamespaceRoot) || new Set(roots.map((item) => String(recordOf4(item)?.["rootId"] ?? ""))).size !== roots.length) {
      throw new TypeError("map preview preparation returned invalid subject namespace roots");
    }
    return value;
  }
  if (plan["strategy"] === "host-resolved") {
    const roots = plan["roots"];
    const subjectRoots = plan["subjectNamespaceRoots"];
    if (!Object.keys(plan).every(
      (key2) => ["schemaVersion", "strategy", "resolverId", "subjectNamespaceRoots", "roots"].includes(key2)
    ) || !nonEmptyString3(plan["resolverId"]) || !Array.isArray(subjectRoots) || !subjectRoots.every(validSubjectNamespaceRoot) || !Array.isArray(roots) || roots.length === 0 || roots.length + subjectRoots.length > maxRoots || !roots.every(validHostResourceRoot) || new Set([...subjectRoots, ...roots].map((item) => String(recordOf4(item)?.["rootId"] ?? ""))).size !== roots.length + subjectRoots.length) {
      throw new TypeError("map preview preparation returned invalid host resource roots");
    }
    return value;
  }
  throw new TypeError("map preview preparation returned an unknown resource strategy");
}
function validatePreparationResult(value, maxCandidates, maxRoots) {
  const record = recordOf4(value);
  if (record === void 0 || !Array.isArray(record["diagnostics"]) || !record["diagnostics"].every(validPreparationDiagnostic)) {
    throw new TypeError("map preview preparation returned malformed diagnostics");
  }
  if (record["state"] === "not-applicable" || record["state"] === "unresolved") {
    if (!Object.keys(record).every((key2) => key2 === "state" || key2 === "diagnostics")) {
      throw new TypeError("map preview preparation result contains unknown fields");
    }
    return value;
  }
  if (record["state"] === "selection-required") {
    const candidates = record["candidates"];
    if (!Object.keys(record).every(
      (key2) => key2 === "state" || key2 === "candidates" || key2 === "diagnostics"
    ) || !Array.isArray(candidates) || candidates.length === 0 || candidates.length > maxCandidates || !candidates.every((candidate) => {
      const item = recordOf4(candidate);
      return item !== void 0 && Object.keys(item).every(
        (key2) => key2 === "candidateId" || key2 === "displayName" || key2 === "sourcePath"
      ) && nonEmptyString3(item["candidateId"]) && nonEmptyString3(item["displayName"]) && (!Object.hasOwn(item, "sourcePath") || nonEmptyString3(item["sourcePath"]));
    }) || new Set(candidates.map((candidate) => String(recordOf4(candidate)?.["candidateId"] ?? ""))).size !== candidates.length) {
      throw new TypeError("map preview preparation returned invalid selection candidates");
    }
    return value;
  }
  if (record["state"] === "namespace-search-required") {
    if (!Object.keys(record).every(
      (key2) => key2 === "state" || key2 === "searches" || key2 === "diagnostics"
    )) {
      throw new TypeError("map preview preparation search result contains unknown fields");
    }
    validateNamespaceSearchRequests(record["searches"]);
    return value;
  }
  if (record["state"] === "document-read-required") {
    if (!Object.keys(record).every(
      (key2) => key2 === "state" || key2 === "documents" || key2 === "diagnostics"
    )) {
      throw new TypeError("map preview preparation document-read result contains unknown fields");
    }
    validateDocumentReadRequests(record["documents"]);
    return value;
  }
  if (record["state"] === "prepared") {
    const plan = recordOf4(record["plan"]);
    if (!Object.keys(record).every(
      (key2) => key2 === "state" || key2 === "plan" || key2 === "diagnostics"
    ) || plan?.["schemaVersion"] !== 1 || recordOf4(plan["workspace"]) === void 0 || !isJsonValue(plan["workspace"]) || !Object.keys(plan).every(
      (key2) => key2 === "schemaVersion" || key2 === "workspace" || key2 === "resources"
    )) {
      throw new TypeError("map preview preparation returned an invalid prepared plan");
    }
    validateResourcePlan(plan["resources"], maxRoots);
    return value;
  }
  throw new TypeError("map preview preparation returned an unknown state");
}
function preparationDiagnostics(items) {
  return items.map((item) => ({
    code: errorCode(item.code),
    severity: item.severity,
    message: item.message,
    ...item.path === void 0 ? {} : { path: item.path },
    ...item.data === void 0 ? {} : { data: item.data }
  }));
}
function mapPreviewPreparationSubject(descriptor, namespace, namespaceSearches = Object.freeze([]), documentReads = Object.freeze([])) {
  const formatId = "identity" in descriptor ? descriptor.identity.formatId : void 0;
  if (!nonEmptyString3(formatId)) {
    throw new TypeError("the ordinary codec descriptor has no format id");
  }
  return Object.freeze({
    schemaVersion: 1,
    subjectUri: descriptor.subjectUri,
    revision: descriptor.revision,
    formatId,
    traits: Object.freeze(descriptor.traits.map((item) => item.id)),
    dataSources: Object.freeze(
      descriptor.dataSources.map(
        (item) => Object.freeze({ contract: item.contract, major: item.major })
      )
    ),
    operations: Object.freeze(
      descriptor.operations.map((item) => Object.freeze({ id: item.id, state: item.state }))
    ),
    namespace,
    namespaceSearches: Object.freeze(namespaceSearches.map((item) => Object.freeze(item))),
    documentReads: Object.freeze(documentReads.map((item) => Object.freeze(item)))
  });
}
async function boundedPreparationNamespace(original, descriptor, maxEntries, maxPages, signal) {
  if (!descriptor.dataSources.some(
    (item) => item.contract === "common.view/namespace-entry-source" && item.major === 1
  )) {
    return Object.freeze({ state: "unavailable", entries: Object.freeze([]) });
  }
  const lease = await original.dataSource("common.view/namespace-entry-source", 1);
  const release = releaseOnce(() => lease.release());
  try {
    const entries = [];
    const seenCursors = /* @__PURE__ */ new Set();
    let cursor2;
    let pages = 0;
    let truncated = false;
    do {
      signal?.throwIfAborted();
      if (pages >= maxPages) {
        truncated = true;
        break;
      }
      if (cursor2 !== void 0) {
        if (seenCursors.has(cursor2)) {
          throw new TypeError("subject namespace repeated a paging cursor");
        }
        seenCursors.add(cursor2);
      }
      const remaining = maxEntries - entries.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const page = await lease.value.list(
        "",
        cursor2 === void 0 ? { limit: Math.min(remaining, 256) } : { cursor: cursor2, limit: Math.min(remaining, 256) },
        signal
      );
      pages += 1;
      for (const item of page.items.slice(0, remaining)) {
        entries.push({
          path: item.path,
          kind: item.kind,
          ...item.size === void 0 ? {} : { size: item.size.toString(10) }
        });
      }
      if (page.items.length > remaining) {
        truncated = true;
        break;
      }
      cursor2 = page.nextCursor;
    } while (cursor2 !== void 0);
    entries.sort(
      (left, right) => left.path === right.path ? left.kind.localeCompare(right.kind) : left.path.localeCompare(right.path)
    );
    return Object.freeze({
      state: truncated ? "truncated" : "complete",
      entries: Object.freeze(entries.map((item) => Object.freeze(item)))
    });
  } finally {
    await release();
  }
}
async function boundedPreparationNamespaceSearches(original, descriptor, searches, maxEntries, maxPages, signal) {
  if (!descriptor.dataSources.some(
    (item) => item.contract === "common.view/namespace-entry-source" && item.major === 1
  )) {
    return Object.freeze(
      searches.map(
        (search) => Object.freeze({
          searchId: search.searchId,
          state: "unsupported",
          entries: Object.freeze([])
        })
      )
    );
  }
  const lease = await original.dataSource("common.view/namespace-entry-source", 1);
  const release = releaseOnce(() => lease.release());
  try {
    const source = lease.value;
    const searchNamespace = source.search?.bind(source);
    if (searchNamespace === void 0) {
      return Object.freeze(
        searches.map(
          (search) => Object.freeze({
            searchId: search.searchId,
            state: "unsupported",
            entries: Object.freeze([])
          })
        )
      );
    }
    let remainingEntries = maxEntries;
    let remainingPages = maxPages;
    const results = [];
    for (const search of searches) {
      signal?.throwIfAborted();
      const entries = [];
      const seenCursors = /* @__PURE__ */ new Set();
      let cursor2;
      let truncated = remainingEntries === 0 || remainingPages === 0;
      while (!truncated) {
        if (cursor2 !== void 0) {
          if (seenCursors.has(cursor2)) {
            throw new TypeError("subject namespace search repeated a paging cursor");
          }
          seenCursors.add(cursor2);
        }
        const pageLimit = Math.min(remainingEntries, 256);
        const page = await searchNamespace(
          search.query,
          cursor2 === void 0 ? { limit: pageLimit } : { cursor: cursor2, limit: pageLimit },
          signal
        );
        remainingPages -= 1;
        if (!Array.isArray(page.items) || page.items.length > pageLimit || page.nextCursor !== void 0 && (typeof page.nextCursor !== "string" || page.nextCursor.length === 0 || page.nextCursor.length > MAX_PREVIEW_NAMESPACE_CURSOR_CHARS)) {
          throw new TypeError("subject namespace search returned a malformed page");
        }
        const admitted = page.items;
        for (const item of admitted) {
          if (typeof item.path !== "string" || item.path.length > MAX_PREVIEW_NAMESPACE_PATH_CHARS || item.kind !== "file" && item.kind !== "directory" || item.size !== void 0 && typeof item.size !== "bigint") {
            throw new TypeError("subject namespace search returned a malformed entry");
          }
          entries.push({
            path: item.path,
            kind: item.kind,
            ...item.size === void 0 ? {} : { size: item.size.toString(10) }
          });
        }
        remainingEntries -= admitted.length;
        cursor2 = page.nextCursor;
        if (cursor2 === void 0) break;
        if (remainingEntries === 0 || remainingPages === 0) truncated = true;
      }
      entries.sort(
        (left, right) => left.path === right.path ? left.kind.localeCompare(right.kind) : left.path.localeCompare(right.path)
      );
      results.push(
        Object.freeze({
          searchId: search.searchId,
          state: truncated ? "truncated" : "complete",
          entries: Object.freeze(entries.map((item) => Object.freeze(item)))
        })
      );
    }
    return Object.freeze(results);
  } finally {
    await release();
  }
}
async function boundedPreparationDocumentReads(original, descriptor, requests, signal) {
  const extraction = descriptor.operations.find(
    (item) => item.id === CONTAINER_EXTRACT_OPERATION_ID && item.state === "available"
  );
  if (extraction === void 0 || !descriptor.dataSources.some(
    (item) => item.contract === "common.view/namespace-entry-source" && item.major === 1
  )) {
    return Object.freeze(
      requests.map(
        (request) => Object.freeze({
          documentId: request.documentId,
          path: request.path,
          state: "unsupported"
        })
      )
    );
  }
  const lease = await original.dataSource("common.view/namespace-entry-source", 1);
  const release = releaseOnce(() => lease.release());
  try {
    const source = lease.value;
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const results = [];
    for (const request of requests) {
      signal?.throwIfAborted();
      let page;
      try {
        page = await source.list(request.path, { limit: 16 }, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: "unreadable"
          })
        );
        continue;
      }
      const normalizedPath = request.path.replace(/\\/gu, "/");
      const entry = page.items.find(
        (item) => item.kind === "file" && item.path.replace(/\\/gu, "/") === normalizedPath
      );
      if (entry === void 0) {
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: "missing"
          })
        );
        continue;
      }
      if (entry.size !== void 0 && entry.size > BigInt(request.maxBytes)) {
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: "too-large"
          })
        );
        continue;
      }
      try {
        const invoked = await original.operations().invoke(
          extraction.handlerId,
          { entryId: entry.id },
          signal === void 0 ? {} : { signal }
        );
        if (invoked.state !== "ok" || invoked.output.kind !== "bytes" || invoked.output.value.byteLength > request.maxBytes) {
          results.push(
            Object.freeze({
              documentId: request.documentId,
              path: request.path,
              state: invoked.state === "ok" && invoked.output.kind === "bytes" && invoked.output.value.byteLength > request.maxBytes ? "too-large" : "unreadable"
            })
          );
          continue;
        }
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: "read",
            text: decoder.decode(invoked.output.value)
          })
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: "unreadable"
          })
        );
      }
    }
    return Object.freeze(results);
  } finally {
    await release();
  }
}
function workspaceDiagnostics(workspace) {
  return workspace.diagnostics.map(
    (item) => diagnostic(
      item.severity,
      "x3.host/map-preview-workspace-diagnostic",
      `${item.code}: ${item.message}`,
      void 0,
      {
        ...item.rootId === void 0 ? {} : { rootId: item.rootId },
        ...item.dependencyRef === void 0 ? {} : { dependencyRef: item.dependencyRef },
        ...item.cycle === void 0 ? {} : { cycle: item.cycle }
      }
    )
  );
}
function sessionHoldingMapPreviewPrerequisites(preview, releasePreparedResources, original) {
  let disposed = false;
  return Object.freeze({
    revision: preview.revision,
    state: () => preview.state(),
    descriptor: () => preview.descriptor(),
    dataSource: preview.dataSource.bind(preview),
    operations: () => preview.operations(),
    events: (signal) => preview.events(signal),
    async dispose() {
      if (disposed) return;
      disposed = true;
      let firstError;
      for (const release of [
        () => preview.dispose(),
        releasePreparedResources,
        () => original.dispose()
      ]) {
        try {
          await release();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== void 0) throw firstError;
    }
  });
}
function coordinatorFailure(code, message) {
  return {
    state: "unresolved",
    diagnostics: [diagnostic("error", errorCode(code), message)]
  };
}
function releaseOnce(release) {
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await release();
  };
}
async function enrichMapPreviewCatalog(request, workspace, resources) {
  if (request.catalog !== void 0 || request.catalogEnrichment === void 0) {
    return Object.freeze({
      ...request.catalog === void 0 ? {} : { catalog: request.catalog },
      diagnostics: Object.freeze([])
    });
  }
  let analyzed;
  try {
    analyzed = await analyzeResolvedDataWorkspace({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      workspace,
      resources,
      locales: request.catalogEnrichment.locales,
      queries: Object.freeze([]),
      limits: request.catalogEnrichment.limits,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    return Object.freeze({
      diagnostics: boundedDiagnostics(
        [
          diagnostic(
            "warning",
            "x3.host/map-preview-catalog-enrichment-failed",
            `map preview catalog enrichment failed (${error instanceof Error ? error.message : String(error)})`
          )
        ],
        request.limits.maxDiagnostics
      )
    });
  }
  if (analyzed.state === "unresolved") {
    return Object.freeze({
      diagnostics: boundedDiagnostics(analyzed.diagnostics, request.limits.maxDiagnostics)
    });
  }
  const selector = createResolvedDataSubjectSelectorLease(analyzed, {
    maxPageSize: request.catalogEnrichment.limits.maxPageSize,
    maxEntities: request.catalogEnrichment.limits.maxEntities,
    maxRelations: request.catalogEnrichment.limits.maxEntities,
    // The selector request crosses a game-provider boundary. Keep the shared Product-GA ceiling
    // within the strictest bundled semantic provider instead of making every opened card fail.
    maxCalculations: Math.min(request.catalogEnrichment.limits.maxEntities, 256)
  });
  let released = false;
  return Object.freeze({
    catalog: analyzed.snapshot,
    sources: Object.freeze({
      ...selector === void 0 ? {} : { selector: selector.value },
      relations: analyzed.facets.relations.value,
      async release() {
        if (released) return;
        released = true;
        const results = await Promise.allSettled([
          ...selector === void 0 ? [] : [selector.release()],
          analyzed.release()
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      }
    }),
    diagnostics: boundedDiagnostics(analyzed.diagnostics, request.limits.maxDiagnostics)
  });
}
async function resolveSubjectNamespacePreviewResources(request) {
  if (!request.descriptor.dataSources.some(
    (item) => item.contract === "common.view/namespace-entry-source" && item.major === 1
  )) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/map-preview-namespace-unavailable",
          "the subject-namespace resource plan requires an ordinary namespace entry source"
        )
      ]
    };
  }
  const extractOperation = request.descriptor.operations.find(
    (item) => item.id === CONTAINER_EXTRACT_OPERATION_ID && item.state === "available"
  );
  if (extractOperation === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/map-preview-extract-unavailable",
          `the subject-namespace resource plan requires ${CONTAINER_EXTRACT_OPERATION_ID}`
        )
      ]
    };
  }
  const namespaceLease = await request.original.dataSource("common.view/namespace-entry-source", 1);
  const release = releaseOnce(() => namespaceLease.release());
  try {
    const operations = request.original.operations();
    const extract = async (entryId, signal) => {
      signal?.throwIfAborted();
      const result = await operations.invoke(
        extractOperation.handlerId,
        { entryId },
        signal === void 0 ? {} : { signal }
      );
      if (result.state !== "ok" || result.output.kind !== "bytes") {
        throw new ModkitError({
          code: "x3.host/map-preview-entry-unreadable",
          message: `the source container refused to extract entry ${entryId}`,
          context: {
            entryId,
            state: result.state,
            ...result.state === "rejected" ? { reason: result.reason } : {},
            ...result.state === "ok" ? { outputKind: result.output.kind } : {}
          }
        });
      }
      return result.output.value;
    };
    const namespacePrefixes = new Map(
      request.plan.roots.map((root) => [root.rootId, root.namespacePrefix])
    );
    const logicalRoots = (request.workspace.logicalRoots ?? [...request.workspace.loadOrder].reverse()).map(
      (root) => Object.freeze({
        rootId: root.rootId,
        pathPrefix: namespacePrefixes.get(root.rootId) ?? "",
        logicalPrefix: root.sourcePath
      })
    );
    const openStoredSource = storedEntrySource(request.original, request.descriptor);
    return Object.freeze({
      state: "resolved",
      origin: createWorkspaceNamespaceCompanionOrigin({
        namespace: namespaceLease.value,
        primaryLogicalId: request.activeSourcePath,
        logicalRoots,
        containerRevision: request.descriptor.revision,
        extract,
        ...openStoredSource === void 0 ? {} : { openStoredSource }
      }),
      revision: request.descriptor.revision,
      diagnostics: Object.freeze([
        diagnostic(
          "information",
          "x3.host/map-preview-subject-resources-selected",
          "map preview resources are confined to the opened subject namespace"
        )
      ]),
      release
    });
  } catch (error) {
    await release();
    throw error;
  }
}
function refinableWorldLease(initial, refinement, abort, releaseShared) {
  let current = initial;
  let swapped = false;
  let released = false;
  const value = Object.freeze({
    contract: initial.value.contract,
    major: 1,
    get snapshotId() {
      return current.value.snapshotId;
    },
    info: (signal) => current.value.info(signal),
    page: (request, signal) => current.value.page(request, signal),
    ...initial.value.model === void 0 ? {} : {
      model: (resourceId2, request, signal) => current.value.model(resourceId2, request, signal)
    },
    ...initial.value.texture === void 0 ? {} : {
      texture: (resourceId2, request, signal) => current.value.texture(resourceId2, request, signal)
    },
    async refined(signal) {
      const next = await Promise.race([
        refinement,
        new Promise((_, reject) => {
          signal?.throwIfAborted();
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
      ]);
      if (next === void 0 || released) return false;
      if (!swapped) {
        const old = current;
        current = next;
        swapped = true;
        await old.release();
      }
      return true;
    }
  });
  return Object.freeze({
    value,
    async release() {
      if (released) return;
      released = true;
      abort();
      await current.release();
      if (!swapped) await (await refinement)?.release();
      await releaseShared();
    }
  });
}
function growingWorldLease(initial, covered, grow, abort, releaseShared) {
  let current = initial;
  let holds = covered;
  let released = false;
  let queue = Promise.resolve();
  const value = Object.freeze({
    contract: initial.value.contract,
    major: 1,
    get snapshotId() {
      return current.value.snapshotId;
    },
    info: (signal) => current.value.info(signal),
    page: (request, signal) => current.value.page(request, signal),
    ...initial.value.model === void 0 ? {} : {
      model: (resourceId2, request, signal) => current.value.model(resourceId2, request, signal)
    },
    ...initial.value.texture === void 0 ? {} : {
      texture: (resourceId2, request, signal) => current.value.texture(resourceId2, request, signal)
    },
    ...initial.value.refined === void 0 ? {} : {
      refined: async (signal) => current === initial ? initial.value.refined(signal) : false
    },
    focus(window2, signal) {
      const asked = queue.then(async () => {
        signal?.throwIfAborted();
        if (released) return false;
        const info = await current.value.info(signal);
        const wanted = nativeWorldWindow(window2, info.uvwTransform);
        if (wanted === void 0 || windowCovers(holds, wanted)) return false;
        const grown = await grow(wanted, holds, signal);
        if (grown === void 0) return false;
        if (released) {
          await grown.lease.release();
          return false;
        }
        const replaced = current;
        current = grown.lease;
        holds = grown.covered;
        await replaced.release();
        return true;
      });
      queue = asked.catch(() => void 0);
      return asked;
    }
  });
  return Object.freeze({
    value,
    async release() {
      if (released) return;
      released = true;
      abort();
      await queue;
      await current.release();
      await releaseShared();
    }
  });
}
async function coordinateMapPreviewAssetSession(request) {
  const maxCandidates = positiveCoordinatorLimit(request.maxCandidates, "maxCandidates");
  const maxSubjectEntries = boundedCoordinatorLimit(
    request.maxSubjectEntries,
    "maxSubjectEntries",
    MAX_PREVIEW_NAMESPACE_FACT_ENTRIES
  );
  const maxSubjectPages = boundedCoordinatorLimit(
    request.maxSubjectPages,
    "maxSubjectPages",
    MAX_PREVIEW_NAMESPACE_FACT_PAGES
  );
  const maxRoots = positiveCoordinatorLimit(request.maxRoots, "maxRoots");
  const maxDepth = positiveCoordinatorLimit(request.maxDepth, "maxDepth");
  request.signal?.throwIfAborted();
  request = {
    ...request,
    original: await singleFileAsContainer(request.original, request.budgets.maxInputBytes)
  };
  const descriptor = await request.original.descriptor();
  let subject;
  try {
    subject = mapPreviewPreparationSubject(
      descriptor,
      Object.freeze({ state: "unavailable", entries: Object.freeze([]) })
    );
  } catch (error) {
    return {
      state: "not-applicable",
      diagnostics: [
        diagnostic(
          "information",
          "x3.host/map-preview-subject-not-applicable",
          error instanceof Error ? error.message : String(error)
        )
      ]
    };
  }
  let preparation = request.preparation;
  let preparationRelease;
  const resolutionDiagnostics = [];
  if (preparation === void 0) {
    const resolution = await resolveMapPreviewPreparation({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      subjectFormatId: subject.formatId,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    resolutionDiagnostics.push(...resolution.diagnostics);
    if (resolution.state === "unresolved") {
      return { state: "not-applicable", diagnostics: resolutionDiagnostics };
    }
    preparation = resolution.preparation;
    preparationRelease = resolution.release;
  } else if (preparation.contract !== MAP_PREVIEW_PREPARATION_CONTRACT || !preparation.subjectFormatIds.includes(subject.formatId)) {
    return coordinatorFailure(
      "x3.host/map-preview-preparation-invalid",
      "the supplied map preview preparation port does not accept the subject format"
    );
  }
  let prepared;
  let searchRoundDiagnostics = Object.freeze([]);
  const documentRoundDiagnostics = [];
  try {
    const namespace = await boundedPreparationNamespace(
      request.original,
      descriptor,
      maxSubjectEntries,
      maxSubjectPages,
      request.signal
    );
    let namespaceSearches = Object.freeze([]);
    subject = mapPreviewPreparationSubject(descriptor, namespace);
    prepared = validatePreparationResult(
      await preparation.prepare({
        subject,
        maxCandidates,
        maxRoots,
        maxDepth,
        ...request.selectionId === void 0 ? {} : { selectionId: request.selectionId },
        ...request.signal === void 0 ? {} : { signal: request.signal }
      }),
      maxCandidates,
      maxRoots
    );
    if (prepared.state === "namespace-search-required") {
      searchRoundDiagnostics = prepared.diagnostics;
      namespaceSearches = await boundedPreparationNamespaceSearches(
        request.original,
        descriptor,
        prepared.searches,
        maxSubjectEntries,
        maxSubjectPages,
        request.signal
      );
      subject = mapPreviewPreparationSubject(descriptor, namespace, namespaceSearches);
      prepared = validatePreparationResult(
        await preparation.prepare({
          subject,
          maxCandidates,
          maxRoots,
          maxDepth,
          ...request.selectionId === void 0 ? {} : { selectionId: request.selectionId },
          ...request.signal === void 0 ? {} : { signal: request.signal }
        }),
        maxCandidates,
        maxRoots
      );
      if (prepared.state === "namespace-search-required") {
        throw new TypeError(
          "map preview preparation requested more than one namespace search round"
        );
      }
    }
    const accumulatedDocumentReads = /* @__PURE__ */ new Map();
    let documentRounds = 0;
    while (prepared.state === "document-read-required") {
      if (documentRounds >= MAX_PREVIEW_DOCUMENT_ROUNDS) {
        throw new TypeError(
          `map preview preparation exceeded ${MAX_PREVIEW_DOCUMENT_ROUNDS} document-read rounds`
        );
      }
      documentRounds += 1;
      documentRoundDiagnostics.push(...prepared.diagnostics);
      const documents = validateDocumentReadRequests(prepared.documents);
      const documentReads = await boundedPreparationDocumentReads(
        request.original,
        descriptor,
        documents,
        request.signal
      );
      for (const document2 of documentReads) {
        accumulatedDocumentReads.set(document2.documentId, document2);
      }
      subject = mapPreviewPreparationSubject(
        descriptor,
        namespace,
        namespaceSearches,
        Object.freeze([...accumulatedDocumentReads.values()])
      );
      prepared = validatePreparationResult(
        await preparation.prepare({
          subject,
          maxCandidates,
          maxRoots,
          maxDepth,
          ...request.selectionId === void 0 ? {} : { selectionId: request.selectionId },
          ...request.signal === void 0 ? {} : { signal: request.signal }
        }),
        maxCandidates,
        maxRoots
      );
      if (prepared.state === "namespace-search-required") {
        throw new TypeError("map preview preparation requested a namespace search after documents");
      }
    }
  } catch (error) {
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...resolutionDiagnostics,
        ...preparationDiagnostics(searchRoundDiagnostics),
        ...preparationDiagnostics(documentRoundDiagnostics),
        diagnostic(
          "error",
          "x3.host/map-preview-preparation-invalid",
          `map preview preparation failed (${error instanceof Error ? error.message : String(error)})`
        )
      ])
    };
  } finally {
    try {
      await preparationRelease?.();
    } catch {
    }
  }
  let providerDiagnostics;
  try {
    providerDiagnostics = preparationDiagnostics([
      ...searchRoundDiagnostics,
      ...documentRoundDiagnostics,
      ...prepared.diagnostics
    ]);
  } catch (error) {
    return coordinatorFailure(
      "x3.host/map-preview-preparation-invalid",
      `map preview preparation returned an invalid diagnostic (${error instanceof Error ? error.message : String(error)})`
    );
  }
  const preparationFindings = Object.freeze([...resolutionDiagnostics, ...providerDiagnostics]);
  if (prepared.state === "not-applicable") {
    return { state: "not-applicable", diagnostics: preparationFindings };
  }
  if (prepared.state === "selection-required") {
    return {
      state: "selection-required",
      candidates: Object.freeze(prepared.candidates.map((item) => Object.freeze({ ...item }))),
      diagnostics: preparationFindings
    };
  }
  if (prepared.state === "unresolved") {
    return { state: "unresolved", diagnostics: preparationFindings };
  }
  const graph = prepared.plan.workspace;
  if (graph.roots.length > maxRoots || graph.maxRoots > maxRoots || graph.maxDepth > maxDepth) {
    return coordinatorFailure(
      "x3.host/map-preview-preparation-budget-exceeded",
      "map preview preparation exceeded the host workspace limits"
    );
  }
  let workspace;
  try {
    workspace = resolveModWorkspaceGraph(graph);
  } catch (error) {
    return coordinatorFailure(
      "x3.host/map-preview-workspace-invalid",
      `map preview preparation returned an invalid workspace graph (${error instanceof Error ? error.message : String(error)})`
    );
  }
  const active = workspace.loadOrder.find((item) => item.rootId === workspace.activeRootId);
  if (active === void 0) {
    return coordinatorFailure(
      "x3.host/map-preview-workspace-invalid",
      "map preview workspace does not contain its active root"
    );
  }
  const plannedRootIds = new Set(
    prepared.plan.resources.strategy === "subject-namespace" ? prepared.plan.resources.roots.map((root) => root.rootId) : [
      ...prepared.plan.resources.subjectNamespaceRoots.map((root) => root.rootId),
      ...prepared.plan.resources.roots.map((root) => root.rootId)
    ]
  );
  const workspaceRootIds = new Set(workspace.loadOrder.map((root) => root.rootId));
  if (plannedRootIds.size !== workspaceRootIds.size || [...plannedRootIds].some((rootId) => !workspaceRootIds.has(rootId))) {
    const unreached = [...plannedRootIds].filter((rootId) => !workspaceRootIds.has(rootId));
    const unplanned = [...workspaceRootIds].filter((rootId) => !plannedRootIds.has(rootId));
    const named = (rootIds) => rootIds.map((rootId) => {
      const root = prepared.plan.workspace.roots.find((item) => item.rootId === rootId);
      return root === void 0 ? rootId : `${rootId} (${root.sourcePath})`;
    });
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        diagnostic(
          "error",
          "x3.host/map-preview-resource-root-mismatch",
          `the resource plan must map every resolved workspace root exactly once${unreached.length === 0 ? "" : `; not reached from the map: ${named(unreached).join(", ")}`}${unplanned.length === 0 ? "" : `; without resources: ${named(unplanned).join(", ")}`}`,
          void 0,
          { unreached, unplanned }
        )
      ])
    };
  }
  const timings = [];
  const timed = (label, since) => {
    timings.push(
      diagnostic(
        "information",
        "x3.host/map-preview-resource-timing",
        `${label}: ${String(Date.now() - since)} ms`
      )
    );
  };
  const resolvingAt = Date.now();
  let resourceResolution;
  try {
    if (prepared.plan.resources.strategy === "subject-namespace") {
      resourceResolution = await resolveSubjectNamespacePreviewResources({
        plan: prepared.plan.resources,
        descriptor,
        original: request.original,
        workspace,
        activeSourcePath: active.sourcePath
      });
    } else if (request.resourcePlanResolver === void 0) {
      resourceResolution = {
        state: "unresolved",
        diagnostics: [
          diagnostic(
            "warning",
            "x3.host/map-preview-resource-resolver-required",
            `resource plan ${prepared.plan.resources.resolverId} names installation/dependency roots but this host wired no resolver`
          )
        ]
      };
    } else {
      resourceResolution = await request.resourcePlanResolver.resolve({
        plan: prepared.plan.resources,
        subject,
        workspace,
        original: request.original,
        services: request.services,
        grant: request.grant,
        budgets: request.budgets,
        ...request.signal === void 0 ? {} : { signal: request.signal }
      });
    }
  } catch (error) {
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        diagnostic(
          "error",
          "x3.host/map-preview-resource-resolution-failed",
          `map preview resources could not be resolved (${error instanceof Error ? error.message : String(error)})`
        )
      ])
    };
  }
  if (resourceResolution.state === "unresolved") {
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        ...resourceResolution.diagnostics
      ])
    };
  }
  timed("resources resolved", resolvingAt);
  const releasePreparedResources = releaseOnce(resourceResolution.release);
  let resources;
  try {
    const dependencies = request.contentSources === void 0 ? void 0 : await resolveContentAssetOrigins({
      contentSources: request.contentSources,
      subjects: [{ descriptor }],
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    const origin = dependencies === void 0 || dependencies.origins.length === 0 ? resourceResolution.origin : createLayeredCompanionOrigin([resourceResolution.origin, ...dependencies.origins]);
    resources = createResourceSession({
      origin,
      revision: resourceResolution.revision
    });
    const inputResolver = createCompanionInputResolver(origin);
    const resolvedCatalog = request.catalog === void 0 ? resourceResolution.catalogEntities : void 0;
    let catalogQuestions = 0;
    let catalogMilliseconds = 0;
    const catalogEntities = resolvedCatalog === void 0 ? void 0 : async (refs, signal) => {
      const askedAt = Date.now();
      try {
        return await resolvedCatalog(refs, signal);
      } finally {
        catalogQuestions += 1;
        catalogMilliseconds += Date.now() - askedAt;
      }
    };
    const enrichedAt = Date.now();
    const enrichment = catalogEntities === void 0 ? await enrichMapPreviewCatalog(request, workspace, resources) : Object.freeze({ diagnostics: Object.freeze([]) });
    if (catalogEntities === void 0) timed("catalog enrichment", enrichedAt);
    const analyzedAt = Date.now();
    const opened = await openMapPreviewAssetSession({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      workspace,
      resources,
      inputResolver,
      subjectUri: descriptor.subjectUri,
      subjectOperationIds: Object.freeze(descriptor.operations.map((operation) => operation.id)),
      ...request.onModelResourceProfile === void 0 ? {} : { onModelResourceProfile: request.onModelResourceProfile },
      ...enrichment.catalog === void 0 ? {} : { catalog: enrichment.catalog },
      ...catalogEntities === void 0 ? {} : { catalogEntities },
      ...request.progressiveCatalog === true ? { progressiveCatalog: true } : {},
      ...enrichment.sources === void 0 ? {} : { catalogSources: enrichment.sources },
      limits: request.limits,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    timed("map analysis and world", analyzedAt);
    if (catalogQuestions > 0)
      timings.push(
        diagnostic(
          "information",
          "x3.host/map-preview-resource-timing",
          `catalog questions (${String(catalogQuestions)}): ${String(catalogMilliseconds)} ms`
        )
      );
    if (opened.state === "unresolved") {
      await releasePreparedResources();
      return {
        state: "unresolved",
        diagnostics: Object.freeze([
          ...preparationFindings,
          ...workspaceDiagnostics(workspace),
          ...resourceResolution.diagnostics,
          ...enrichment.diagnostics,
          ...opened.diagnostics,
          ...timings
        ])
      };
    }
    return Object.freeze({
      ...opened,
      ...enrichment.catalog === void 0 ? {} : { catalog: enrichment.catalog },
      session: sessionHoldingMapPreviewPrerequisites(
        opened.session,
        releasePreparedResources,
        request.original
      ),
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        ...resourceResolution.diagnostics,
        ...enrichment.diagnostics,
        ...opened.diagnostics,
        ...timings
      ])
    });
  } catch (error) {
    if (resources !== void 0 && resources.state() !== "disposed") {
      await resources.dispose();
    }
    await releasePreparedResources();
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        ...resourceResolution.diagnostics,
        diagnostic(
          "error",
          "x3.host/map-preview-open-failed",
          `map preview could not be opened (${error instanceof Error ? error.message : String(error)})`
        )
      ])
    };
  }
}

// apps/web/src/map-preview.ts
var selectionDiagnostic = (localizer) => diagnostic(
  "information",
  "x3.app/map-preview-selection-required",
  localizer.text("web.map.diagnostic.selectionRequired")
);
var permissionDiagnostic = (localizer) => diagnostic(
  "information",
  "x3.app/web-map-preview-permission-required",
  localizer.text("web.map.diagnostic.permissionRequired")
);
async function prepareWebMapPreview(request) {
  const localizer = request.localizer ?? createWebLocalizer("en");
  let result;
  try {
    result = await (request.coordinate ?? coordinateMapPreviewAssetSession)({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      original: request.opened.session,
      // a viewer: the world shows before the catalog answers, and its answered form redraws it
      progressiveCatalog: true,
      ...request.selectionId === void 0 ? {} : { selectionId: request.selectionId },
      ...MAP_PREVIEW_COORDINATOR_LIMITS,
      ...request.catalog === void 0 ? {} : { catalog: request.catalog },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
  } catch (error) {
    await request.opened.session.dispose();
    throw error;
  }
  const permissionRequired = result.state === "unresolved" && result.diagnostics.some((item) => item.code === "x3.host/map-preview-resource-resolver-required");
  const diagnostics = Object.freeze([
    ...request.opened.diagnostics,
    ...result.diagnostics,
    ...result.state === "selection-required" ? [selectionDiagnostic(localizer)] : [],
    ...permissionRequired ? [permissionDiagnostic(localizer)] : []
  ]);
  const candidates = result.state === "selection-required" ? Object.freeze(
    result.candidates.map(
      (candidate) => Object.freeze({ kind: "map-preview-selection", ...candidate })
    )
  ) : Object.freeze([]);
  const joined = result.state === "opened" ? await joinWorld(request.opened, result.session) : {};
  const opened = Object.freeze({ ...request.opened, ...joined, diagnostics });
  return Object.freeze({
    state: permissionRequired ? "permission-required" : result.state,
    opened,
    candidates
  });
}
async function joinWorld(opened, preview) {
  const session = withMapPreviewSources(opened.session, preview);
  try {
    return { descriptor: await session.descriptor(), session };
  } catch (error) {
    await session.dispose();
    throw error;
  }
}

// apps/web/src/extensions-ui.ts
function extensionCopy(localizer) {
  return {
    title: localizer.text("extensions.title"),
    subjects: localizer.text("extensions.subjects"),
    subjectsDescription: localizer.text("web.extensions.subjectsDescription"),
    emptySubjects: localizer.text("extensions.emptySubjects"),
    downloadable: localizer.text("extensions.downloadable"),
    downloadableDescription: localizer.text("web.extensions.downloadableDescription"),
    checkAvailable: localizer.text("extensions.checkCatalog"),
    addFolder: localizer.text("extensions.addFolder"),
    grantAccess: localizer.text("extensions.grantAccess"),
    enable: localizer.text("common.enable"),
    disable: localizer.text("common.disable"),
    enableContribution: localizer.text("extensions.action.enableContribution"),
    disableContribution: localizer.text("extensions.action.disableContribution"),
    enableExtension: localizer.text("extensions.action.enableExtension"),
    disableExtension: localizer.text("extensions.action.disableExtension"),
    install: localizer.text("common.install"),
    update: localizer.text("common.update"),
    remove: localizer.text("common.remove"),
    enabled: localizer.text("common.enabled"),
    disabled: localizer.text("common.disabled"),
    notInstalled: localizer.text("common.notInstalled"),
    notInCatalog: localizer.text("web.extensions.notInCatalog"),
    updateAvailable: localizer.text("web.extensions.updateAvailable"),
    trusted: localizer.text("web.extensions.trusted"),
    notTrusted: localizer.text("web.extensions.notTrusted"),
    emptyFolders: localizer.text("extensions.emptyFolders"),
    catalogEmpty: localizer.text("web.extensions.catalogEmpty"),
    noDownloaded: localizer.text("web.extensions.noDownloaded"),
    packageDisabled: localizer.text("web.extensions.packageDisabled"),
    reloadPending: localizer.text("web.extensions.reloadPending"),
    removedPending: localizer.text("web.extensions.removedPending"),
    trustSentence: localizer.text("web.extensions.trustSentence"),
    provenanceNote: localizer.text("web.extensions.provenanceNote"),
    remembered: (location) => localizer.text("web.extensions.remembered", { location }),
    added: (name, coordinate) => localizer.text("web.extensions.added", {
      name,
      coordinate: coordinate === void 0 ? "" : ` (${coordinate})`
    }),
    actionFailed: (reason) => localizer.text("web.extensions.actionFailed", { reason }),
    addFailed: (reason) => localizer.text("web.extensions.addFailed", { reason }),
    removeFailed: (reason) => localizer.text("web.extensions.removeFailed", { reason }),
    accessFailed: (reason) => localizer.text("web.extensions.accessFailed", { reason }),
    accessGranted: (name) => localizer.text("web.extensions.accessGranted", { name }),
    accessDenied: (name, state) => localizer.text("web.extensions.accessDenied", { name, state }),
    catalogChecked: (location) => localizer.text("web.extensions.catalogChecked", { location }),
    catalogLoaded: (location) => localizer.text("web.extensions.catalogLoaded", { location }),
    catalogNotContacted: (location) => localizer.text("web.extensions.catalogNotContacted", { location }),
    installedStatus: (name) => localizer.text("web.extensions.installedStatus", { name }),
    updatedStatus: (name) => localizer.text("web.extensions.updatedStatus", { name }),
    removedStatus: (name) => localizer.text("web.extensions.removedStatus", { name }),
    cardFailed: (reason) => localizer.text("web.extensions.cardFailed", { reason })
  };
}
var bundledProvenance = (root, localizer) => localizer.text("web.extensions.bundledProvenance", { root });
var userProvenance = (label, localizer) => localizer.text("web.extensions.userProvenance", { label });
function describeExtensionList(input, localizer = createWebLocalizer("en")) {
  const rows = [];
  for (const entry of input.catalog.extensions) {
    const coordinate = containerCoordinate(entry.containers);
    rows.push({
      kind: "bundled",
      state: "loaded",
      label: entry.name,
      ...coordinate === void 0 ? {} : { coordinate },
      provenance: bundledProvenance(entry.artifactRoot, localizer)
    });
  }
  const labels = new Map((input.stored ?? []).map((record) => [record.id, record.label]));
  for (const [index, extension] of input.loaded.inputs.entries()) {
    const rootId = input.loaded.rootIds[index];
    const coordinate = input.loaded.coordinates[index];
    const label = (rootId === void 0 ? void 0 : labels.get(rootId)) ?? extension.source;
    rows.push({
      kind: "user",
      state: "loaded",
      ...rootId === void 0 ? {} : { rootId },
      label,
      ...coordinate === void 0 ? {} : { coordinate },
      provenance: userProvenance(label, localizer)
    });
  }
  for (const failure2 of [...input.loaded.failures, ...input.extraFailures ?? []]) {
    const label = labels.get(failure2.rootId) ?? failure2.root;
    rows.push({
      kind: "user",
      state: failure2.code === EXTENSION_ROOT_FAILURE_CODES.permissionRequired ? "needs-permission" : "failed",
      rootId: failure2.rootId,
      label,
      provenance: userProvenance(label, localizer),
      code: failure2.code,
      detail: failure2.message
    });
  }
  return Object.freeze(rows);
}
var describe = (error) => error instanceof Error ? error.message : String(error);
function defaultId() {
  const source = globalThis.crypto;
  const uuid = source?.randomUUID?.();
  return uuid ?? `root-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function button(parent, part, label, onClick) {
  const node = element(parent, "button", { part, text: label });
  node.setAttribute("type", "button");
  node.addEventListener("click", onClick);
  return node;
}
function mountExtensionsUi(documentRef, options) {
  const root = documentRef.createElement("section");
  root.className = "web-extensions-view";
  const newId = options.newId ?? defaultId;
  let localizer = options.localizer ?? createWebLocalizer(globalThis.navigator?.languages);
  let copy = extensionCopy(localizer);
  let stored = [];
  let loaded = {
    inputs: [],
    failures: [],
    coordinates: [],
    rootIds: [],
    moduleMap: {},
    moduleMapOwners: {},
    verifiedModuleRoots: [],
    serve: async (url) => ({
      ok: false,
      status: 404,
      arrayBuffer: () => Promise.reject(new Error(`404 ${url}`))
    })
  };
  let status = "";
  let activeExtensionId;
  let activeSubjectId;
  let activeCard;
  let cardRevision = 0;
  const subjectHistory = new SubjectNavigationHistory();
  const loadOptions = () => ({
    subtle: options.subtle,
    claimed: [
      ...catalogCoordinates(options.catalog),
      ...options.additionalClaimedCoordinates ?? []
    ],
    ...options.maxFiles === void 0 ? {} : { maxFiles: options.maxFiles },
    ...options.maxTotalBytes === void 0 ? {} : { maxTotalBytes: options.maxTotalBytes }
  });
  const reload = async () => {
    const [nextStored] = await Promise.all([
      options.store.list(),
      // IndexedDB only: this never contacts the injected catalog port.
      options.managedExtensions?.refreshInstalled()
    ]);
    stored = nextStored;
    loaded = await loadUserExtensionRoots(
      stored.map((record) => ({
        id: record.id,
        handle: record.handle,
        ...record.coordinate === void 0 ? {} : { expectedId: record.coordinate }
      })),
      loadOptions()
    );
    render();
  };
  const changed = async () => {
    await reload();
    await options.onChanged?.(loaded);
    render();
  };
  const add = () => {
    void (async () => {
      try {
        const handle = await options.pickDirectory();
        if (handle === void 0) return;
        const id = newId();
        const probe = await loadUserExtensionRoots([{ id, handle }], {
          ...loadOptions(),
          claimed: [...catalogCoordinates(options.catalog), ...loaded.coordinates]
        });
        const failure2 = probe.failures[0];
        if (failure2 !== void 0) {
          status = `${handle.name}: ${failure2.message} (${failure2.code})`;
          render();
          return;
        }
        const coordinate = probe.coordinates[0];
        await options.store.add({
          id,
          label: handle.name,
          addedAt: Date.now(),
          ...coordinate === void 0 ? {} : { coordinate },
          handle
        });
        status = copy.added(handle.name, coordinate);
        await changed();
      } catch (error) {
        status = copy.addFailed(describe(error));
        render();
      }
    })();
  };
  const remove = (rootId) => {
    void (async () => {
      try {
        await options.store.remove(rootId);
        status = copy.removedPending;
        await changed();
      } catch (error) {
        status = copy.removeFailed(describe(error));
        render();
      }
    })();
  };
  const grant = (rootId) => {
    void (async () => {
      const record = stored.find((entry) => entry.id === rootId);
      if (record === void 0) return;
      try {
        const state = await requestUserExtensionPermission(record.handle);
        status = state === "granted" ? copy.accessGranted(record.label) : copy.accessDenied(record.label, state);
        await changed();
      } catch (error) {
        status = copy.accessFailed(describe(error));
        render();
      }
    })();
  };
  const managedAction = (action, success) => {
    void (async () => {
      try {
        await action();
        status = success;
      } catch (error) {
        status = copy.actionFailed(describe(error));
      }
      render();
    })();
  };
  const subjectAction = (action, success) => {
    void (async () => {
      try {
        await action();
        status = `${success} ${copy.reloadPending}`;
      } catch (error) {
        status = copy.actionFailed(describe(error));
      }
      render();
    })();
  };
  const selectSubject = (entry, subjectId) => {
    activeExtensionId = entry.id;
    activeSubjectId = subjectId;
    subjectHistory.reset(subjectId);
    render();
  };
  const renderExtensionSubjectTree = () => {
    const catalog = options.extensionSubjects?.();
    if (catalog === void 0) return void 0;
    element(root, "h3", { text: copy.subjects });
    element(root, "p", {
      part: "settings.description",
      text: copy.subjectsDescription
    });
    const list = element(root, "div", { part: "settings.list" });
    for (const entry of catalog.entries) {
      const extension = entry.projection.extension;
      const item = element(list, "details", { part: "settings.extension" });
      item.open = entry.id === activeExtensionId;
      const summary = documentRef.createElement("summary");
      const state = documentRef.createElement("span");
      state.textContent = extension.enabled ? "\u25CF" : "\u25CB";
      state.setAttribute("aria-label", extension.enabled ? copy.enabled : copy.disabled);
      const label = documentRef.createElement("span");
      label.dataset["mkPart"] = "settings.label";
      label.textContent = extension.displayName;
      summary.addEventListener("click", () => {
        selectSubject(entry, extension.subjectId);
      });
      summary.append(state, documentRef.createTextNode(" "), label);
      item.append(summary);
      if (options.setExtensionEnabled !== void 0) {
        button(
          item,
          "settings.add",
          entry.configuredEnabled ? copy.disable : copy.enable,
          () => subjectAction(
            () => options.setExtensionEnabled?.(entry.id, !entry.configuredEnabled),
            `${entry.configuredEnabled ? copy.disabled : copy.enabled} ${extension.displayName}.`
          )
        );
      }
      if (entry.configuredEnabled && !extension.enabled) {
        element(item, "span", {
          part: "settings.description",
          text: copy.packageDisabled
        });
      }
      for (const group of entry.projection.contractGroups) {
        const contract = documentRef.createElement("details");
        contract.open = true;
        contract.dataset["mkPart"] = "settings.row";
        const contractSummary = documentRef.createElement("summary");
        contractSummary.textContent = contributionContractLabel(localizer, group.key);
        contractSummary.title = localizer.text("extensions.tooltip.exactContract", {
          contract: group.key
        });
        contract.append(contractSummary);
        for (const contribution of group.contributions) {
          const row = element(contract, "div", { part: "settings.extension" });
          const openContribution = documentRef.createElement("button");
          openContribution.type = "button";
          openContribution.dataset["mkPart"] = "settings.label";
          openContribution.textContent = `${contribution.effectiveEnabled ? "\u25CF" : "\u25CB"} ${contribution.displayName}`;
          openContribution.setAttribute(
            "aria-label",
            `${contribution.displayName}, ${contribution.effectiveEnabled ? copy.enabled : copy.disabled}`
          );
          openContribution.addEventListener(
            "click",
            () => selectSubject(entry, contribution.subjectId)
          );
          row.append(openContribution);
          if (options.setContributionEnabled !== void 0) {
            button(
              row,
              "settings.add",
              contribution.enabled ? copy.disable : copy.enable,
              () => subjectAction(
                () => options.setContributionEnabled?.(contribution.id, !contribution.enabled),
                `${contribution.enabled ? copy.disabled : copy.enabled} ${contribution.displayName}.`
              )
            );
          }
        }
        item.append(contract);
      }
      list.append(item);
    }
    if (catalog.entries.length === 0) {
      element(list, "p", {
        part: "settings.description",
        text: copy.emptySubjects
      });
    }
    const cardHost = documentRef.createElement("div");
    cardHost.className = "web-extension-subject-card";
    root.append(cardHost);
    return cardHost;
  };
  const renderActiveSubjectCard = (host) => {
    const catalog = options.extensionSubjects?.();
    const entry = activeExtensionId === void 0 ? void 0 : catalog?.extension(activeExtensionId);
    if (entry === void 0 || activeSubjectId === void 0) return;
    const requestedSubjectId = activeSubjectId;
    const revision = ++cardRevision;
    void (async () => {
      try {
        const bundle = await webExtensionSubjectCardBundle(entry, requestedSubjectId);
        if (revision !== cardRevision || !host.isConnected) return;
        const documents = new Map(
          bundle.documents.map((document2) => [document2.subject.subjectId, document2])
        );
        const active = documents.get(requestedSubjectId);
        if (active === void 0) throw new Error(`unknown extension subject ${requestedSubjectId}`);
        const sections = await loadSubjectCardSections(subjectFactsSourceFromWire(active), {
          localizer
        });
        if (revision !== cardRevision || !host.isConnected) return;
        const toolbar = documentRef.createElement("div");
        toolbar.dataset["mkPart"] = "settings.adder";
        const historyBack = button(toolbar, "settings.add", "\u2190", () => {
          const subjectId = subjectHistory.back();
          if (subjectId === void 0 || !documents.has(subjectId)) return;
          activeSubjectId = subjectId;
          render();
        });
        historyBack.disabled = !subjectHistory.canBack;
        historyBack.setAttribute("aria-label", localizer.text("card.historyBack"));
        const historyForward = button(toolbar, "settings.add", "\u2192", () => {
          const subjectId = subjectHistory.forward();
          if (subjectId === void 0 || !documents.has(subjectId)) return;
          activeSubjectId = subjectId;
          render();
        });
        historyForward.disabled = !subjectHistory.canForward;
        historyForward.setAttribute("aria-label", localizer.text("card.historyForward"));
        const subject = active.subject;
        if (subject.kind === "modkit/contribution" && options.setContributionEnabled !== void 0) {
          button(
            toolbar,
            "settings.add",
            subject.enabled ? copy.disableContribution : copy.enableContribution,
            () => subjectAction(
              () => options.setContributionEnabled?.(subject.id, !subject.enabled),
              `${subject.enabled ? copy.disabled : copy.enabled} ${subject.displayName}.`
            )
          );
        } else if (subject.kind === "modkit/extension" && options.setExtensionEnabled !== void 0) {
          button(
            toolbar,
            "settings.add",
            entry.configuredEnabled ? copy.disableExtension : copy.enableExtension,
            () => subjectAction(
              () => options.setExtensionEnabled?.(entry.id, !entry.configuredEnabled),
              `${entry.configuredEnabled ? copy.disabled : copy.enabled} ${subject.displayName}.`
            )
          );
        }
        activeCard?.destroy();
        const navigate = (ref) => {
          if (ref.href !== void 0 && documents.has(ref.href)) {
            subjectHistory.open(ref.href);
            activeSubjectId = ref.href;
            render();
          }
        };
        activeCard = createSubjectCard(documentRef, {
          localizer,
          label: active.subject.displayName,
          sections,
          onNavigate: navigate
        });
        host.replaceChildren(toolbar, activeCard.root);
      } catch (error) {
        if (revision !== cardRevision || !host.isConnected) return;
        element(host, "p", {
          part: "settings.status",
          text: copy.cardFailed(describe(error))
        });
      }
    })();
  };
  const renderManagedExtensions = () => {
    const controller = options.managedExtensions;
    if (controller === void 0) return;
    const model = controller.snapshot();
    element(root, "h3", { text: copy.downloadable });
    element(root, "p", {
      part: "settings.description",
      text: copy.downloadableDescription
    });
    const catalogActions = element(root, "div", { part: "settings.adder" });
    button(
      catalogActions,
      "settings.add",
      copy.checkAvailable,
      () => managedAction(() => controller.refreshCatalog(), copy.catalogChecked(model.catalogLocation))
    );
    element(catalogActions, "span", {
      part: "settings.description",
      text: model.catalogLoaded ? copy.catalogLoaded(model.catalogLocation) : copy.catalogNotContacted(model.catalogLocation)
    });
    const list = element(root, "div", { part: "settings.list" });
    for (const row of model.rows) {
      const item = element(list, "div", { part: "settings.extension" });
      const text = element(item, "div", { part: "settings.extension-text" });
      element(text, "div", { part: "settings.label", text: row.name });
      const states = [
        row.available ? `${localizer.text("extensions.group.available")} ${row.availableVersion ?? ""}`.trim() : copy.notInCatalog,
        row.installed ? `${localizer.text("extensions.group.installed")} ${row.installedVersion ?? ""}`.trim() : copy.notInstalled,
        row.installed ? row.enabled ? copy.enabled : copy.disabled : void 0,
        row.updateAvailable ? copy.updateAvailable : void 0
      ].filter((value) => value !== void 0);
      element(text, "div", { part: "settings.description", text: states.join(" \xB7 ") });
      if (row.description !== void 0) {
        element(text, "div", { part: "settings.description", text: row.description });
      }
      element(text, "div", {
        part: "settings.description",
        text: `${row.trusted ? copy.trusted : copy.notTrusted}: ${row.trustReason}`
      });
      if (!row.installed && row.available) {
        const install = button(
          item,
          "settings.add",
          copy.install,
          () => managedAction(() => controller.install(row.id), copy.installedStatus(row.name))
        );
        if (!row.trusted) {
          install.setAttribute("disabled", "");
          install.setAttribute("title", row.trustReason);
        }
      }
      if (row.installed && row.updateAvailable) {
        const update = button(
          item,
          "settings.add",
          copy.update,
          () => managedAction(() => controller.update(row.id), copy.updatedStatus(row.name))
        );
        if (!row.trusted) {
          update.setAttribute("disabled", "");
          update.setAttribute("title", row.trustReason);
        }
      }
      if (row.installed) {
        button(
          item,
          "settings.add",
          row.enabled ? copy.disable : copy.enable,
          () => managedAction(
            () => controller.enable(row.id, !row.enabled),
            `${row.enabled ? copy.disabled : copy.enabled} ${row.name}. ${copy.reloadPending}`
          )
        );
        button(
          item,
          "settings.remove",
          copy.remove,
          () => managedAction(() => controller.remove(row.id), copy.removedStatus(row.name))
        );
      }
    }
    if (model.rows.length === 0) {
      element(root, "p", {
        part: "settings.description",
        text: model.catalogLoaded ? copy.catalogEmpty : copy.noDownloaded
      });
    }
  };
  function render() {
    cardRevision += 1;
    activeCard?.destroy();
    activeCard = void 0;
    root.replaceChildren();
    element(root, "h2", { text: copy.title });
    element(root, "p", { part: "settings.description", text: copy.trustSentence });
    element(root, "p", { part: "settings.description", text: copy.provenanceNote });
    const adder = element(root, "div", { part: "settings.adder" });
    button(adder, "settings.add", copy.addFolder, add);
    element(adder, "span", {
      part: "settings.description",
      text: copy.remembered(options.store.location)
    });
    const subjectCardHost = renderExtensionSubjectTree();
    const rows = describeExtensionList(
      {
        catalog: options.catalog,
        loaded,
        stored,
        ...options.conflicts === void 0 ? {} : { extraFailures: options.conflicts() }
      },
      localizer
    );
    const list = element(root, "div", { part: "settings.list" });
    for (const row of rows) {
      const item = element(list, "div", { part: "settings.extension" });
      const text = element(item, "div", { part: "settings.extension-text" });
      element(text, "div", {
        part: "settings.label",
        text: row.coordinate ?? row.label
      });
      element(text, "div", { part: "settings.description", text: row.provenance });
      if (row.code !== void 0) {
        element(text, "div", {
          part: "settings.description",
          text: `${row.code}: ${row.detail ?? ""}`
        });
      }
      if (row.kind === "user" && row.rootId !== void 0) {
        const rootId = row.rootId;
        if (row.state === "needs-permission") {
          button(item, "settings.add", copy.grantAccess, () => grant(rootId));
        }
        button(item, "settings.remove", copy.remove, () => remove(rootId));
      }
    }
    if (rows.every((row) => row.kind === "bundled")) {
      element(root, "p", {
        part: "settings.description",
        text: copy.emptyFolders
      });
    }
    renderManagedExtensions();
    element(root, "p", { part: "settings.status", text: status });
    if (subjectCardHost !== void 0) renderActiveSubjectCard(subjectCardHost);
  }
  render();
  return {
    root,
    setLocalizer(nextLocalizer) {
      localizer = nextLocalizer;
      copy = extensionCopy(nextLocalizer);
      render();
    },
    reload,
    current: () => loaded
  };
}

// apps/web/generated/offline-release.js
var WEB_OFFLINE_RELEASE = Object.freeze({
  catalogPath: "./managed-packages/catalog.v1.json",
  catalogSha256: "sha256:b339333e695f7405193752fd1a1901c4a95a14a618bdcb7c8adbffc871ebe089",
  catalogBytes: 2734,
  keyId: "modkit.ga-wave1b-2026-09-01",
  publicJwk: { crv: "Ed25519", x: "V5EtylGXaruEyvfj7TUL2qdNcNdljKcSU60-tIFJbMo", kty: "OKP" },
  packageIds: ["blizzard/starcraft2-suite", "wz2100project/warzone-2100"],
  roots: [
    "blizzard/casc",
    "blizzard/common-formats",
    "blizzard/diablo",
    "blizzard/galaxy-language",
    "blizzard/models",
    "blizzard/mpq",
    "blizzard/starcraft2",
    "blizzard/warcraft-3",
    "wz2100project/warzone-2100"
  ],
  maxArtifactBytes: 268435456
});

// packages/ui/dist/field-editor/index.js
var PARTS2 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  /*
   * Toolbar items, shared by every viewer that has a toolbar.
   *
   * They are one vocabulary rather than one per viewer because a theme styles "a toggle in a
   * toolbar" once: a tree, a table and a strings editor that each invented their own part names
   * would make the same button three different things to style.
   */
  "toolbar.group",
  "toolbar.toggle",
  "toolbar.chip",
  "toolbar.action",
  "toolbar.search",
  "toolbar.search-input",
  "toolbar.separator",
  "toolbar.spacer",
  "toolbar.label",
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
  "tree.row",
  "tree.key",
  "tree.twisty",
  "tree.label",
  "tree.value",
  "tree.children",
  // one displayed value, drawn with its syntax runs
  "value.token",
  // inline, schema-driven field editing shared by the tree, the table and the metadata panel
  "field",
  "field.control",
  "field.status",
  "field.target",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // variant (localization) tables
  "table.head",
  "table.controls",
  "table.group",
  "table.context",
  "table.columns",
  /** The grip on a header's edge that sizes its column. */
  "table.resize",
  "table.asset",
  "table.unresolved",
  "table.assist",
  "table.suggestions",
  "table.note",
  "table.panel",
  "table.add",
  "table.compare",
  "table.select",
  /** The find bar (Ctrl+F) and its replace row (Ctrl+H). */
  "table.find",
  /** One occurrence of the find text inside a drawn cell. */
  "table.match",
  /** A value's trailing white space, shown where it is drawn. */
  "table.trailing",
  /** A row's status in its status cell (missing, untranslated, duplicate, error…). */
  "table.badge",
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
  // playback stage: a transport with its world positions, participants, series and events
  "playback",
  "playback.title",
  "playback.bar",
  "playback.seek",
  "playback.time",
  "playback.units",
  "playback.rate",
  "playback.body",
  "playback.map",
  "playback.note",
  "playback.side",
  "playback.participants",
  "playback.participant",
  "playback.swatch",
  "playback.charts",
  "playback.chart",
  "playback.playhead",
  "playback.kinds",
  "playback.kind",
  "playback.events",
  "playback.event",
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
  "metadata.note",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // game template stage: the resolved tree, the drawn template and the element view side by side
  "template.body",
  "template.canvas",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  "image.subresources",
  "image.frame-preview",
  "image.convert",
  "image.metadata",
  // map layers: the chosen layer drawn large, a thumbnail per layer, what its colours mean
  "map-layers.view",
  "map-layers.image",
  "map-layers.thumbnail",
  "map-layers.legend",
  "map-layers.swatch",
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
  "audio.notice",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // font stage
  "font",
  "font.toolbar",
  "font.text",
  "font.row",
  "font.size",
  "font.sample",
  "font.heading",
  "font.set",
  // archive stage
  "archive.members",
  "archive.member-list",
  "archive.item",
  "archive.row",
  "archive.name",
  "archive.detail",
  "archive.children",
  // video stage
  "video",
  "video.player",
  "video.options",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  "model.primitive-selector",
  "model.animation-selector",
  "model.animation-seek",
  "model.animation-name",
  "model.convert-selector",
  "model.convert-status",
  "model.animation-name-status",
  "model.playback-status",
  "model.controls",
  "model.control-row",
  "model.control-label",
  "model.control-field",
  "model.control-note",
  "model.scale",
  "model.team-color",
  "model.facets",
  "model.facet",
  "model.facet-summary",
  "model.facet-list",
  "model.facet-item",
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
  "filetree.action",
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
  "explorer.opening",
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
  // the subject picker a reference field opens (a unit, a model)
  "selector",
  "selector.search",
  "selector.candidates",
  "selector.more",
  "selector.status",
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
  "workbench.auxbar",
  "workbench.statusbar",
  "workbench.status-slot",
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
  "card.sources",
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
  "card.grid-pages",
  "card.grid-page",
  "card.grid-cell",
  "card.grid-face",
  "card.grid-image",
  "card.grid-cycle",
  "card.grid-opens",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.field-note",
  /** An inline icon in a styled value (`text-runs`): its slot, its pixels, an unresolved run. */
  "card.asset",
  "card.asset-image",
  "card.unresolved",
  "card.nav",
  "card.breadcrumbs",
  "card.knowledge",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  "image.metadata-group",
  "image.operation",
  "media-shell",
  "media-shell.toggle",
  "media-shell.gallery",
  "media-shell.splitter",
  "media-shell.stage",
  "media-shell.sidebar",
  "media-shell.section",
  "media-shell.section-header",
  "media-shell.section-chevron",
  "media-shell.section-icon",
  "media-shell.section-title",
  "media-shell.section-body",
  "media-shell.gallery-toolbar",
  "media-shell.gallery-mode",
  "media-shell.gallery-list",
  "media-shell.gallery-group",
  "media-shell.gallery-group-header",
  "media-shell.gallery-count",
  "media-shell.gallery-cells",
  "media-shell.gallery-item",
  "media-shell.gallery-thumb-box",
  "media-shell.gallery-thumb",
  "media-shell.gallery-label",
  "media-shell.gallery-empty",
  /** Quick filter (case / whole word / regular expression), shared by every list. */
  "filter",
  "filter.opener",
  "filter.input",
  "filter.option",
  /** Image editing tools, in a sidebar section of whichever viewer shows the pixels. */
  "image-editing",
  "image-editing.group",
  "image-editing.group-title",
  "image-editing.row",
  "image-editing.tools",
  "image-editing.tool",
  "image-editing.chip",
  "image-editing.label",
  "image-editing.range",
  "image-editing.value",
  "image-editing.swatch-button",
  "image-editing.swatch-alpha",
  "image-editing.swatches",
  "image-editing.swatch",
  "image-editing.popover",
  "image-editing.color",
  "image-editing.actions",
  "image-editing.note",
  "image-editing.marquee",
  "image-editing.dialog",
  "image-editing.number",
  "image-editing.select",
  "image-editing.check",
  "card.preview",
  // the wiki of a mod's entities (plan 5.25)
  "wiki",
  "wiki.kinds",
  "wiki.kind",
  "wiki.pane",
  "wiki.toolbar",
  "wiki.search",
  "wiki.status",
  "wiki.subjects",
  "wiki.subject",
  "wiki.icon",
  "wiki.id",
  "wiki.card",
  "card.preview-open",
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
  "graph.legend",
  "graph.hint",
  "graph.search",
  "graph.node-list",
  "graph.tooltip",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  /** The walk's own controls above the graph: whole graph, depth, direction, root (plan 5.19). */
  "graph.walk",
  // auditable subject calculations
  "calculations",
  "calculations.summary",
  "calculations.list",
  "calculations.item",
  "calculations.heading",
  "calculations.result",
  "calculations.formula",
  "calculations.inputs",
  "calculations.input",
  "calculations.warnings",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET2 = new Set(PARTS2);
var PART_ATTRIBUTE2 = "data-mk-part";
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
function setPart3(element4, part) {
  if (!PART_SET2.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element4.setAttribute(PART_ATTRIBUTE2, part);
}
function candidateTargetForField(type) {
  if (type.kind === "subject-ref") {
    return Object.freeze({
      kind: "subject-ref",
      subjectKind: type.subjectKind,
      ...type.filter === void 0 ? {} : { filter: type.filter }
    });
  }
  if (type.kind === "asset-ref") {
    return Object.freeze({ kind: "asset-ref", accepts: type.accepts });
  }
  return void 0;
}
var positive2 = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
};
var SubjectSelectorModel = class {
  #provider;
  #target;
  #pageSize;
  #maximum;
  #signal;
  #generation = 0;
  #summary;
  #items = Object.freeze([]);
  #text = "";
  #nextCursor;
  #loading = false;
  #seenCursors = /* @__PURE__ */ new Set();
  constructor(options) {
    this.#provider = options.candidates;
    this.#target = options.target;
    this.#pageSize = positive2(options.pageSize ?? 64, "pageSize");
    this.#maximum = positive2(options.maximum ?? 512, "maximum");
    this.#signal = options.signal;
  }
  snapshot() {
    const locallyCapped = this.#items.length >= this.#maximum && this.#nextCursor !== void 0;
    return Object.freeze({
      ...this.#summary === void 0 ? {} : { summary: this.#summary },
      candidates: this.#items,
      text: this.#text,
      ...this.#nextCursor === void 0 ? {} : { nextCursor: this.#nextCursor },
      ...this.#summary === void 0 ? {} : {
        completeness: locallyCapped ? "capped" : this.#summary.completeness
      },
      loading: this.#loading
    });
  }
  async search(text) {
    if (typeof text !== "string") throw new TypeError("selector search text must be a string");
    this.#generation += 1;
    this.#text = text;
    this.#summary = void 0;
    this.#items = Object.freeze([]);
    this.#nextCursor = void 0;
    this.#seenCursors.clear();
    return this.#load(this.#generation, void 0);
  }
  async loadMore() {
    const cursor2 = this.#nextCursor;
    if (cursor2 === void 0 || this.#items.length >= this.#maximum) return this.snapshot();
    if (this.#seenCursors.has(cursor2)) throw new Error("subject selector repeated a page cursor");
    this.#seenCursors.add(cursor2);
    return this.#load(this.#generation, cursor2);
  }
  async #load(generation, cursor2) {
    this.#signal?.throwIfAborted();
    const remaining = this.#maximum - (cursor2 === void 0 ? 0 : this.#items.length);
    if (remaining < 1) return this.snapshot();
    this.#loading = true;
    try {
      const result = await loadSubjectCandidatePage(
        this.#provider,
        {
          target: this.#target,
          text: this.#text,
          ...cursor2 === void 0 ? {} : { cursor: cursor2 },
          limit: Math.min(this.#pageSize, remaining)
        },
        this.#signal
      );
      if (generation !== this.#generation) return this.snapshot();
      if (this.#summary !== void 0 && this.#summary.snapshotId !== result.summary.snapshotId) {
        throw new Error("subject selector snapshot changed between pages");
      }
      const prior = cursor2 === void 0 ? [] : this.#items;
      const ids = new Set(prior.map((item) => item.subjectId));
      if (result.page.items.some((item) => ids.has(item.subjectId))) {
        throw new Error("subject selector repeated a candidate between pages");
      }
      if (result.page.nextCursor !== void 0 && result.page.nextCursor === cursor2) {
        throw new Error("subject selector repeated a page cursor");
      }
      this.#summary = result.summary;
      this.#items = Object.freeze([...prior, ...result.page.items]);
      this.#nextCursor = result.page.nextCursor;
      this.#loading = false;
      return this.snapshot();
    } finally {
      if (generation === this.#generation) this.#loading = false;
    }
  }
};
async function mountSubjectSelector(container, options) {
  const document2 = container.ownerDocument;
  const root = document2.createElement("div");
  setPart3(root, "selector");
  const search = document2.createElement("input");
  search.type = "search";
  setPart3(search, "selector.search");
  search.setAttribute("aria-label", options.labels?.search ?? "Search candidates");
  const select = document2.createElement("select");
  setPart3(select, "selector.candidates");
  select.setAttribute("aria-label", options.labels?.candidates ?? "Candidates");
  const more = document2.createElement("button");
  more.type = "button";
  setPart3(more, "selector.more");
  more.textContent = options.labels?.loadMore ?? "Load more";
  const status = document2.createElement("output");
  setPart3(status, "selector.status");
  root.append(search, select, more, status);
  container.append(root);
  const model = new SubjectSelectorModel(options);
  let problem;
  let destroyed = false;
  const draw = (snapshot) => {
    if (destroyed) return;
    const selected = select.value || options.initial || snapshot.candidates[0]?.subjectId || "";
    select.replaceChildren();
    if (selected.length > 0 && !snapshot.candidates.some((item) => item.subjectId === selected)) {
      const initial = document2.createElement("option");
      initial.value = selected;
      initial.textContent = selected;
      select.append(initial);
    }
    for (const candidate of snapshot.candidates) {
      const option = document2.createElement("option");
      option.value = candidate.subjectId;
      option.textContent = candidate.label === candidate.subjectId ? candidate.label : `${candidate.label} (${candidate.subjectId})`;
      select.append(option);
    }
    select.value = selected;
    more.hidden = snapshot.nextCursor === void 0;
    more.disabled = snapshot.loading || snapshot.completeness === "capped";
    const state = snapshot.completeness ?? "partial";
    status.textContent = `${snapshot.candidates.length}/${snapshot.summary?.totalSubjects ?? "?"} \xB7 ${state}`;
  };
  const run = async (operation) => {
    problem = void 0;
    try {
      const snapshot = await operation();
      draw(snapshot);
      return snapshot;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
      status.textContent = problem;
      throw error;
    }
  };
  const searchCandidates = () => run(() => model.search(search.value));
  const loadMore = () => run(() => model.loadMore());
  const changed = () => {
    options.onSelect?.(model.snapshot().candidates.find((item) => item.subjectId === select.value));
  };
  const searched = () => void searchCandidates().catch(() => void 0);
  const moreRequested = () => void loadMore().catch(() => void 0);
  search.addEventListener("input", searched);
  select.addEventListener("change", changed);
  more.addEventListener("click", moreRequested);
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    options.signal?.removeEventListener("abort", aborted);
    search.removeEventListener("input", searched);
    select.removeEventListener("change", changed);
    more.removeEventListener("click", moreRequested);
    root.remove();
  };
  const aborted = () => destroy();
  options.signal?.addEventListener("abort", aborted, { once: true });
  await searchCandidates();
  const control = Object.freeze({
    root,
    model,
    read: () => select.value,
    validate: () => problem,
    search: (text) => {
      search.value = text;
      return searchCandidates();
    },
    loadMore,
    destroy
  });
  return control;
}
function parseJsonValue(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${label} must be valid JSON`);
  }
}
function fieldValue(field, value) {
  const { type } = field;
  if (type.kind === "text" || type.kind === "text-key" || type.kind === "script") {
    const text = String(value ?? "");
    if (type.kind === "text") {
      if (type.maxLength !== void 0 && text.length > type.maxLength) {
        throw new TypeError(`${field.label} must contain at most ${type.maxLength} characters`);
      }
      if (type.pattern !== void 0 && !new RegExp(type.pattern, "u").test(text)) {
        throw new TypeError(`${field.label} does not match its required pattern`);
      }
    }
    return text;
  }
  if (type.kind === "duration" || type.kind === "date" || type.kind === "bytes" || type.kind === "id" || type.kind === "path" || type.kind === "subject-ref" || type.kind === "asset-ref") {
    return String(value ?? "");
  }
  if (type.kind === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${field.label} must be a number`);
    if (type.integer === true && !Number.isInteger(number)) {
      throw new TypeError(`${field.label} must be an integer`);
    }
    if (type.min !== void 0 && number < type.min) {
      throw new TypeError(`${field.label} must be at least ${type.min}`);
    }
    if (type.max !== void 0 && number > type.max) {
      throw new TypeError(`${field.label} must be at most ${type.max}`);
    }
    return number;
  }
  if (type.kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new TypeError(`${field.label} must be true or false`);
  }
  if (type.kind === "enum") {
    const id = String(value);
    if (!type.members.some((member) => member.id === id) && type.unknown === void 0) {
      throw new TypeError(`${field.label} must be one of its published values`);
    }
    return id;
  }
  if (type.kind === "color") return String(value);
  if (type.kind === "flags") {
    const ids = Array.isArray(value) ? value.map(String) : String(value).split(",").map((item) => item.trim()).filter(Boolean);
    if (ids.some((id) => !type.members.some((member) => member.id === id))) {
      throw new TypeError(`${field.label} contains an unpublished flag`);
    }
    return ids;
  }
  if (type.kind === "vector") {
    const vector = Array.isArray(value) ? value : parseJsonValue(String(value), field.label);
    if (!Array.isArray(vector) || vector.length !== type.size || vector.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      throw new TypeError(`${field.label} must contain ${type.size} finite numbers`);
    }
    return vector;
  }
  if (type.kind === "struct" || type.kind === "array" || type.kind === "record" || type.kind === "instructions" || type.kind === "json") {
    return typeof value === "string" ? parseJsonValue(value, field.label) : value;
  }
  return value;
}
async function mountFieldEditor(container, field, signal, registry, editorId, candidates) {
  if (field.type.kind === "custom") {
    const module = registry?.resolve(field.type.typeId, editorId);
    if (module === void 0) {
      throw new TypeError(
        registry?.problem(field.type.typeId, editorId) ?? `unsupported custom field type \xAB${field.type.typeId}\xBB`
      );
    }
    const control = await module.mount({
      container,
      field,
      initial: field.initial ?? "",
      signal
    });
    if (typeof control !== "object" || control === null || typeof control.read !== "function" || typeof control.validate !== "function") {
      throw new TypeError(`custom field editor for \xAB${field.type.typeId}\xBB returned no control`);
    }
    return control;
  }
  if (field.type.kind === "subject-ref" || field.type.kind === "asset-ref") {
    if (candidates !== void 0) {
      const target = candidateTargetForField(field.type);
      if (target === void 0) throw new TypeError("reference field has no selector target");
      const selector = await mountSubjectSelector(container, {
        candidates,
        target,
        initial: field.initialText,
        signal
      });
      return Object.freeze({
        read: () => fieldValue(field, selector.read()),
        validate: () => selector.validate(),
        unmount: () => selector.destroy()
      });
    }
    const unavailable = container.ownerDocument.createElement("input");
    unavailable.type = "text";
    unavailable.value = field.initialText;
    unavailable.disabled = true;
    unavailable.setAttribute("name", field.key);
    unavailable.setAttribute("aria-label", field.label);
    setPart3(unavailable, "form.input");
    container.append(unavailable);
    return Object.freeze({
      read: () => fieldValue(field, unavailable.value),
      validate: () => "subject candidate source is unavailable",
      unmount: () => unavailable.remove()
    });
  }
  const document2 = container.ownerDocument;
  const input = field.type.kind === "enum" ? document2.createElement("select") : field.type.kind === "script" || field.type.kind === "struct" || field.type.kind === "array" || field.type.kind === "record" || field.type.kind === "instructions" || field.type.kind === "json" ? document2.createElement("textarea") : document2.createElement("input");
  input.setAttribute("name", field.key);
  input.setAttribute("aria-label", field.label);
  setPart3(input, "form.input");
  if (input instanceof HTMLSelectElement && field.type.kind === "enum") {
    for (const member of field.type.members) {
      const option = document2.createElement("option");
      option.value = member.id;
      option.textContent = member.label ?? member.id;
      input.append(option);
    }
    input.value = field.initialText;
  } else if (input instanceof HTMLInputElement) {
    input.type = field.type.kind === "boolean" ? "checkbox" : field.type.kind === "number" ? "number" : "text";
    if (field.type.kind === "boolean") input.checked = field.initialText === "true";
    else input.value = field.initialText;
  } else {
    input.value = field.initialText;
  }
  container.append(input);
  return Object.freeze({
    read() {
      if (input instanceof HTMLInputElement && input.type === "checkbox") return input.checked;
      return fieldValue(field, input.value);
    },
    validate() {
      try {
        fieldValue(
          field,
          input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value
        );
        return void 0;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    unmount() {
      input.remove();
    }
  });
}
var object2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var onlyKeys = (value, allowed2) => Object.keys(value).every((key2) => allowed2.includes(key2));
var nonEmptyString4 = (value) => typeof value === "string" && value.length > 0;
function validJson(value, ancestors = /* @__PURE__ */ new Set(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 64 || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    if (Object.getOwnPropertyNames(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === void 0 || descriptor.enumerable !== true || !("value" in descriptor) || !validJson(descriptor.value, next, depth + 1))
        return false;
    }
    return true;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.entries(descriptors).every(
    ([, descriptor]) => descriptor.enumerable === true && "value" in descriptor && validJson(descriptor.value, next, depth + 1)
  );
}
var validStringArray = (value) => Array.isArray(value) && value.every(nonEmptyString4);
function validJsonSchemaRef(value) {
  return object2(value) && onlyKeys(value, ["$ref", "document"]) && nonEmptyString4(value["$ref"]) && (value["document"] === void 0 || validJson(value["document"]));
}
function validSubjectFilter(value) {
  if (!object2(value) || !onlyKeys(value, ["type", "sameTypeAs", "text", "requireTags", "excludeTags", "predicate"]))
    return false;
  if (value["type"] !== void 0 && !nonEmptyString4(value["type"])) return false;
  if (value["sameTypeAs"] !== void 0 && !nonEmptyString4(value["sameTypeAs"])) return false;
  if (value["text"] !== void 0 && typeof value["text"] !== "string") return false;
  if (value["requireTags"] !== void 0 && !validStringArray(value["requireTags"])) return false;
  if (value["excludeTags"] !== void 0 && !validStringArray(value["excludeTags"])) return false;
  if (value["predicate"] !== void 0) {
    const predicate = value["predicate"];
    if (!object2(predicate) || !onlyKeys(predicate, ["id", "params"]) || !nonEmptyString4(predicate["id"]) || predicate["params"] !== void 0 && !validJson(predicate["params"]))
      return false;
  }
  return true;
}
function validFieldSchema(value, depth) {
  return object2(value) && onlyKeys(value, ["key", "label", "type", "cardinality", "description", "knowledgeTarget"]) && nonEmptyString4(value["key"]) && typeof value["label"] === "string" && validFieldType(value["type"], depth + 1) && (value["cardinality"] === void 0 || value["cardinality"] === "scalar" || value["cardinality"] === "append" || value["cardinality"] === "indexed") && (value["description"] === void 0 || typeof value["description"] === "string") && (value["knowledgeTarget"] === void 0 || isKnowledgeTarget(value["knowledgeTarget"]));
}
function validFieldType(type, depth = 0) {
  if (!object2(type) || typeof type["kind"] !== "string" || depth > 16) return false;
  switch (type["kind"]) {
    case "text":
      return onlyKeys(type, ["kind", "multiline", "pattern", "maxLength"]) && (type["multiline"] === void 0 || typeof type["multiline"] === "boolean") && (type["pattern"] === void 0 || typeof type["pattern"] === "string") && (type["maxLength"] === void 0 || Number.isSafeInteger(type["maxLength"]) && Number(type["maxLength"]) >= 0);
    case "number":
      return onlyKeys(type, ["kind", "min", "max", "integer", "unit"]) && (type["min"] === void 0 || typeof type["min"] === "number" && Number.isFinite(type["min"])) && (type["max"] === void 0 || typeof type["max"] === "number" && Number.isFinite(type["max"])) && (type["integer"] === void 0 || typeof type["integer"] === "boolean") && (type["unit"] === void 0 || typeof type["unit"] === "string");
    case "boolean":
      return onlyKeys(type, ["kind"]);
    case "duration":
    case "date":
    case "bytes":
    case "id":
    case "path":
      return onlyKeys(type, ["kind"]);
    case "text-key":
      return onlyKeys(type, ["kind", "catalog"]) && (type["catalog"] === void 0 || nonEmptyString4(type["catalog"]));
    case "script":
      return onlyKeys(type, ["kind", "language"]) && nonEmptyString4(type["language"]);
    case "json":
      return onlyKeys(type, ["kind", "schema"]) && (type["schema"] === void 0 || validJsonSchemaRef(type["schema"]));
    case "enum":
    case "flags":
      return onlyKeys(
        type,
        type["kind"] === "enum" ? ["kind", "members", "unknown"] : ["kind", "members"]
      ) && Array.isArray(type["members"]) && type["members"].every(
        (member) => object2(member) && onlyKeys(member, ["id", "label"]) && nonEmptyString4(member["id"]) && (member["label"] === void 0 || typeof member["label"] === "string")
      ) && new Set(type["members"].map((member) => object2(member) ? member["id"] : void 0)).size === type["members"].length;
    case "color":
      return onlyKeys(type, ["kind", "model"]) && (type["model"] === "rgb" || type["model"] === "rgba" || type["model"] === "argb");
    case "vector":
      return onlyKeys(type, ["kind", "size", "unit"]) && (type["size"] === 2 || type["size"] === 3 || type["size"] === 4) && (type["unit"] === void 0 || typeof type["unit"] === "string");
    case "subject-ref":
      return onlyKeys(type, ["kind", "subjectKind", "filter"]) && nonEmptyString4(type["subjectKind"]) && (type["filter"] === void 0 || validSubjectFilter(type["filter"]));
    case "asset-ref": {
      const accepts = type["accepts"];
      return onlyKeys(type, ["kind", "accepts"]) && object2(accepts) && onlyKeys(accepts, ["formatIds", "traits"]) && (accepts["formatIds"] === void 0 || validStringArray(accepts["formatIds"])) && (accepts["traits"] === void 0 || validStringArray(accepts["traits"]));
    }
    case "struct": {
      const fields = type["fields"];
      return onlyKeys(type, ["kind", "fields"]) && Array.isArray(fields) && fields.every((field) => validFieldSchema(field, depth + 1)) && new Set(fields.map((field) => object2(field) ? field["key"] : void 0)).size === fields.length;
    }
    case "array":
      return onlyKeys(type, ["kind", "item", "max"]) && validFieldType(type["item"], depth + 1) && (type["max"] === void 0 || Number.isSafeInteger(type["max"]) && Number(type["max"]) >= 0);
    case "record":
      return onlyKeys(type, ["kind", "key", "value"]) && validFieldType(type["key"], depth + 1) && validFieldType(type["value"], depth + 1);
    case "instructions": {
      const keywords = type["keywords"];
      return onlyKeys(type, ["kind", "keywords", "delimiter", "listDelimiter"]) && object2(keywords) && typeof type["delimiter"] === "string" && (type["listDelimiter"] === void 0 || typeof type["listDelimiter"] === "string") && Object.values(keywords).every(
        (fields) => Array.isArray(fields) && fields.every((field) => validFieldType(field, depth + 1))
      );
    }
    case "custom":
      return onlyKeys(type, ["kind", "typeId", "params"]) && nonEmptyString4(type["typeId"]) && (type["params"] === void 0 || validJson(type["params"]));
    default:
      return false;
  }
}
function validWrites(value) {
  if (!object2(value) || !onlyKeys(value, ["format", "encoding", "extension", "mediaType"])) {
    return false;
  }
  const named = (candidate) => object2(candidate) && onlyKeys(candidate, ["id", "label"]) && nonEmptyString4(candidate["id"]) && nonEmptyString4(candidate["label"]);
  return named(value["format"]) && (value["encoding"] === void 0 || named(value["encoding"])) && nonEmptyString4(value["extension"]) && nonEmptyString4(value["mediaType"]);
}
function parseSchema(value) {
  if (!validJson(value) || !object2(value) || !onlyKeys(value, ["schemaVersion", "forms"]) || value["schemaVersion"] !== 1 || !Array.isArray(value["forms"]) || value["forms"].length === 0)
    return void 0;
  const ids = /* @__PURE__ */ new Set();
  for (const form of value["forms"]) {
    if (!object2(form) || !onlyKeys(form, ["id", "label", "summary", "binding", "fields", "baseInput", "writes"]) || typeof form["id"] !== "string" || form["id"].length === 0 || ids.has(form["id"]) || typeof form["label"] !== "string" || typeof form["summary"] !== "string" || !Array.isArray(form["fields"]) || // A preset (fixed `baseInput`, nothing to fill in) is the one form without controls.
    form["fields"].length === 0 && form["baseInput"] === void 0) {
      return void 0;
    }
    if (form["baseInput"] !== void 0 && (!object2(form["baseInput"]) || Object.keys(form["baseInput"]).some(
      (key2) => key2 === "__proto__" || key2 === "constructor" || key2 === "prototype"
    )))
      return void 0;
    if (form["writes"] !== void 0 && !validWrites(form["writes"])) return void 0;
    ids.add(form["id"]);
    if (form["binding"] !== void 0 && (!object2(form["binding"]) || !onlyKeys(form["binding"], ["groupId", "entryKey"]) || !nonEmptyString4(form["binding"]["groupId"]) || form["binding"]["entryKey"] !== void 0 && !nonEmptyString4(form["binding"]["entryKey"]))) {
      return void 0;
    }
    const keys = /* @__PURE__ */ new Set();
    const paths = /* @__PURE__ */ new Set();
    for (const field of form["fields"]) {
      if (!object2(field) || !onlyKeys(field, [
        "key",
        "label",
        "type",
        "cardinality",
        "description",
        "knowledgeTarget",
        "inputPath",
        "required",
        "initial",
        "source",
        "encoding"
      ]) || typeof field["key"] !== "string" || field["key"].length === 0 || keys.has(field["key"]) || typeof field["label"] !== "string" || !validFieldType(field["type"]) || field["cardinality"] !== void 0 && field["cardinality"] !== "scalar" && field["cardinality"] !== "append" && field["cardinality"] !== "indexed" || field["description"] !== void 0 && typeof field["description"] !== "string" || field["knowledgeTarget"] !== void 0 && !isKnowledgeTarget(field["knowledgeTarget"]) || !Array.isArray(field["inputPath"]) || field["inputPath"].length === 0 || field["inputPath"].some(
        (segment) => !(typeof segment === "string" && segment.length > 0 || Number.isSafeInteger(segment) && Number(segment) >= 0)
      ) || field["required"] !== void 0 && typeof field["required"] !== "boolean" || field["initial"] !== void 0 && !validJson(field["initial"]) || field["source"] !== void 0 && field["source"] !== "entry-key" && field["source"] !== "entry-value" || field["encoding"] !== void 0 && field["encoding"] !== "utf8-base64") {
        return void 0;
      }
      const firstSegment = field["inputPath"][0];
      if (object2(form["baseInput"]) && (typeof firstSegment === "string" || typeof firstSegment === "number") && Object.hasOwn(form["baseInput"], firstSegment))
        return void 0;
      const path = JSON.stringify(field["inputPath"]);
      const segments = field["inputPath"];
      if (segments.some(
        (segment) => typeof segment === "string" && (segment === "__proto__" || segment === "prototype" || segment === "constructor")
      ) || paths.has(path) || [...paths].some((existing) => {
        const other = JSON.parse(existing);
        const common = Math.min(other.length, segments.length);
        return other.slice(0, common).every((segment, index) => segment === segments[index]) && other.length !== segments.length;
      }))
        return void 0;
      keys.add(field["key"]);
      paths.add(path);
    }
  }
  return value;
}
function metadataEntries(descriptor, groupId) {
  if (!("metadata" in descriptor)) return [];
  return descriptor.metadata.find((group) => group.id === groupId)?.entries ?? [];
}
function selectedEntry(descriptor, form, operationId) {
  if (form.binding === void 0) return void 0;
  const entries = metadataEntries(descriptor, form.binding.groupId);
  const matches = (entry) => {
    const editable = entry.editable;
    return editable !== void 0 && "operation" in editable.write && editable.write.operation === operationId;
  };
  if (form.binding.entryKey !== void 0) {
    const entry = entries.find((item) => item.key === form.binding?.entryKey);
    return entry !== void 0 && matches(entry) ? entry : void 0;
  }
  return entries.find(matches);
}
function scalarText(value) {
  if (value === void 0 || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
var BASE642 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64OfUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at] ?? 0;
    const second = bytes[at + 1];
    const third = bytes[at + 2];
    const triple = first << 16 | (second ?? 0) << 8 | (third ?? 0);
    out += BASE642[triple >> 18 & 63] ?? "";
    out += BASE642[triple >> 12 & 63] ?? "";
    out += second === void 0 ? "=" : BASE642[triple >> 6 & 63] ?? "";
    out += third === void 0 ? "=" : BASE642[triple & 63] ?? "";
  }
  return out;
}
function setAtPath(root, path, value) {
  let current = root;
  path.forEach((segment, index) => {
    const last = index === path.length - 1;
    if (last) {
      ;
      current[segment] = value;
      return;
    }
    const next = path[index + 1];
    const child = typeof next === "number" ? [] : {};
    const existing = current[segment];
    if (existing === void 0) current[segment] = child;
    current = existing ?? child;
  });
}
function resolveForm(operation, spec, entry, descriptor) {
  const carried = spec.binding === void 0 || descriptor === void 0 ? [] : metadataEntries(descriptor, spec.binding.groupId).map((item) => item.key);
  const fields = Object.freeze(
    spec.fields.map((field) => {
      const sourced = field.source === "entry-key" ? entry?.key : field.source === "entry-value" ? entry?.value : field.initial;
      const initialText = scalarText(
        sourced === null || sourced === void 0 ? field.initial : sourced
      );
      return Object.freeze({
        ...field,
        name: field.key,
        kind: field.encoding === "utf8-base64" ? "content" : "text",
        initial: initialText,
        ...field.description === void 0 ? {} : { hint: field.description },
        ...entry?.editable?.editor === void 0 ? {} : { editorId: entry.editable.editor },
        ...field.source === "entry-key" && carried.length > 0 ? { carried: Object.freeze([...carried]) } : {},
        initialText
      });
    })
  );
  return Object.freeze({
    id: spec.id,
    label: spec.label,
    operationId: operation.id,
    handlerId: operation.handlerId,
    summary: spec.summary,
    fields,
    ...spec.writes === void 0 ? {} : { writes: spec.writes },
    build(values) {
      const input = spec.baseInput === void 0 ? {} : JSON.parse(JSON.stringify(spec.baseInput));
      for (const field of fields) {
        let value = values.get(field.key);
        if (value === void 0) value = field.initial ?? "";
        if (field.required === true && (value === "" || value === null)) {
          throw new TypeError(`${field.label} is required`);
        }
        value = fieldValue(field, value);
        if (field.encoding === "utf8-base64") value = base64OfUtf8(String(value ?? ""));
        setAtPath(input, field.inputPath, value);
      }
      if (operation.id === "edit.field") {
        if (spec.binding === void 0)
          throw new TypeError("field edit form has no editable binding");
        input["groupId"] = spec.binding.groupId;
        if (input["key"] === void 0) input["key"] = entry?.key ?? spec.binding.entryKey ?? "";
      }
      return input;
    }
  });
}
function editOffer(descriptor, options) {
  if (!options.editable) return Object.freeze({ forms: [], unsupported: [] });
  const forms = [];
  const unsupported = [];
  for (const operation of descriptor.operations) {
    if (!operation.mutatesSource || operation.state !== "available") continue;
    const schema = parseSchema(operation.inputSchema?.document);
    if (schema === void 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: operation.inputSchema === void 0 ? "the operation did not publish an input schema" : "the published input schema is missing or malformed"
      });
      continue;
    }
    let rejected2;
    for (const spec of schema.forms) {
      const entry = selectedEntry(descriptor, spec, operation.id);
      if (operation.id === "edit.field" && entry === void 0) {
        rejected2 = "the descriptor has no matching editable field binding";
        break;
      }
      if (entry !== void 0 && entry.type === void 0) {
        rejected2 = "the editable descriptor field has no field schema type";
        break;
      }
      for (const field of spec.fields) {
        if (field.type.kind === "custom") {
          const editorId = entry?.editable?.editor;
          const problem = options.fieldEditors?.problem(field.type.typeId, editorId);
          if (problem !== void 0 || options.fieldEditors?.resolve(field.type.typeId, editorId) === void 0) {
            rejected2 = problem ?? `unsupported custom field type \xAB${field.type.typeId}\xBB`;
            break;
          }
        }
      }
      if (rejected2 !== void 0) break;
      forms.push(resolveForm(operation, spec, entry, descriptor));
    }
    if (rejected2 !== void 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: rejected2
      });
    }
  }
  return Object.freeze({ forms: Object.freeze(forms), unsupported: Object.freeze(unsupported) });
}
function declaredMutatingOperations(descriptor) {
  return descriptor.operations.filter((operation) => operation.mutatesSource);
}
var INVOKE_REASONS = Object.freeze({
  "not-declared": "this codec does not declare that operation",
  disabled: "the codec disabled this operation for this file",
  "dependency-required": "the operation needs a dependency this host has not resolved",
  "permission-missing": "this subject was opened without permission to write the file",
  "input-not-serializable": "the values could not be sent to the codec",
  "handler-unregistered": "the codec registered no handler for that operation",
  cancelled: "the operation was cancelled",
  "stale-revision": "the file changed after this tab opened it"
});
function invokeRefusalMessage(result) {
  const plain = INVOKE_REASONS[result.reason];
  const detail = result.diagnostics?.[0]?.message;
  const head = plain === void 0 ? result.reason : `${plain} (${result.reason})`;
  return detail === void 0 ? `refused: ${head}` : `refused: ${head} \u2014 ${detail}`;
}
function fidelityNote(plan) {
  if (plan.fidelity.preservesUnknownData) return "";
  const notes = plan.fidelity.notes ?? [];
  return notes.length === 0 ? " (this rewrite does not keep bytes the format does not account for)" : ` (${notes.join("; ")})`;
}
var isRejected = (result) => result.state === "rejected";

// packages/ui/dist/selector/index.js
var PARTS3 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  /*
   * Toolbar items, shared by every viewer that has a toolbar.
   *
   * They are one vocabulary rather than one per viewer because a theme styles "a toggle in a
   * toolbar" once: a tree, a table and a strings editor that each invented their own part names
   * would make the same button three different things to style.
   */
  "toolbar.group",
  "toolbar.toggle",
  "toolbar.chip",
  "toolbar.action",
  "toolbar.search",
  "toolbar.search-input",
  "toolbar.separator",
  "toolbar.spacer",
  "toolbar.label",
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
  "tree.row",
  "tree.key",
  "tree.twisty",
  "tree.label",
  "tree.value",
  "tree.children",
  // one displayed value, drawn with its syntax runs
  "value.token",
  // inline, schema-driven field editing shared by the tree, the table and the metadata panel
  "field",
  "field.control",
  "field.status",
  "field.target",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // variant (localization) tables
  "table.head",
  "table.controls",
  "table.group",
  "table.context",
  "table.columns",
  /** The grip on a header's edge that sizes its column. */
  "table.resize",
  "table.asset",
  "table.unresolved",
  "table.assist",
  "table.suggestions",
  "table.note",
  "table.panel",
  "table.add",
  "table.compare",
  "table.select",
  /** The find bar (Ctrl+F) and its replace row (Ctrl+H). */
  "table.find",
  /** One occurrence of the find text inside a drawn cell. */
  "table.match",
  /** A value's trailing white space, shown where it is drawn. */
  "table.trailing",
  /** A row's status in its status cell (missing, untranslated, duplicate, error…). */
  "table.badge",
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
  // playback stage: a transport with its world positions, participants, series and events
  "playback",
  "playback.title",
  "playback.bar",
  "playback.seek",
  "playback.time",
  "playback.units",
  "playback.rate",
  "playback.body",
  "playback.map",
  "playback.note",
  "playback.side",
  "playback.participants",
  "playback.participant",
  "playback.swatch",
  "playback.charts",
  "playback.chart",
  "playback.playhead",
  "playback.kinds",
  "playback.kind",
  "playback.events",
  "playback.event",
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
  "metadata.note",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // game template stage: the resolved tree, the drawn template and the element view side by side
  "template.body",
  "template.canvas",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  "image.subresources",
  "image.frame-preview",
  "image.convert",
  "image.metadata",
  // map layers: the chosen layer drawn large, a thumbnail per layer, what its colours mean
  "map-layers.view",
  "map-layers.image",
  "map-layers.thumbnail",
  "map-layers.legend",
  "map-layers.swatch",
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
  "audio.notice",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // font stage
  "font",
  "font.toolbar",
  "font.text",
  "font.row",
  "font.size",
  "font.sample",
  "font.heading",
  "font.set",
  // archive stage
  "archive.members",
  "archive.member-list",
  "archive.item",
  "archive.row",
  "archive.name",
  "archive.detail",
  "archive.children",
  // video stage
  "video",
  "video.player",
  "video.options",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  "model.primitive-selector",
  "model.animation-selector",
  "model.animation-seek",
  "model.animation-name",
  "model.convert-selector",
  "model.convert-status",
  "model.animation-name-status",
  "model.playback-status",
  "model.controls",
  "model.control-row",
  "model.control-label",
  "model.control-field",
  "model.control-note",
  "model.scale",
  "model.team-color",
  "model.facets",
  "model.facet",
  "model.facet-summary",
  "model.facet-list",
  "model.facet-item",
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
  "filetree.action",
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
  "explorer.opening",
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
  // the subject picker a reference field opens (a unit, a model)
  "selector",
  "selector.search",
  "selector.candidates",
  "selector.more",
  "selector.status",
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
  "workbench.auxbar",
  "workbench.statusbar",
  "workbench.status-slot",
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
  "card.sources",
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
  "card.grid-pages",
  "card.grid-page",
  "card.grid-cell",
  "card.grid-face",
  "card.grid-image",
  "card.grid-cycle",
  "card.grid-opens",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.field-note",
  /** An inline icon in a styled value (`text-runs`): its slot, its pixels, an unresolved run. */
  "card.asset",
  "card.asset-image",
  "card.unresolved",
  "card.nav",
  "card.breadcrumbs",
  "card.knowledge",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  "image.metadata-group",
  "image.operation",
  "media-shell",
  "media-shell.toggle",
  "media-shell.gallery",
  "media-shell.splitter",
  "media-shell.stage",
  "media-shell.sidebar",
  "media-shell.section",
  "media-shell.section-header",
  "media-shell.section-chevron",
  "media-shell.section-icon",
  "media-shell.section-title",
  "media-shell.section-body",
  "media-shell.gallery-toolbar",
  "media-shell.gallery-mode",
  "media-shell.gallery-list",
  "media-shell.gallery-group",
  "media-shell.gallery-group-header",
  "media-shell.gallery-count",
  "media-shell.gallery-cells",
  "media-shell.gallery-item",
  "media-shell.gallery-thumb-box",
  "media-shell.gallery-thumb",
  "media-shell.gallery-label",
  "media-shell.gallery-empty",
  /** Quick filter (case / whole word / regular expression), shared by every list. */
  "filter",
  "filter.opener",
  "filter.input",
  "filter.option",
  /** Image editing tools, in a sidebar section of whichever viewer shows the pixels. */
  "image-editing",
  "image-editing.group",
  "image-editing.group-title",
  "image-editing.row",
  "image-editing.tools",
  "image-editing.tool",
  "image-editing.chip",
  "image-editing.label",
  "image-editing.range",
  "image-editing.value",
  "image-editing.swatch-button",
  "image-editing.swatch-alpha",
  "image-editing.swatches",
  "image-editing.swatch",
  "image-editing.popover",
  "image-editing.color",
  "image-editing.actions",
  "image-editing.note",
  "image-editing.marquee",
  "image-editing.dialog",
  "image-editing.number",
  "image-editing.select",
  "image-editing.check",
  "card.preview",
  // the wiki of a mod's entities (plan 5.25)
  "wiki",
  "wiki.kinds",
  "wiki.kind",
  "wiki.pane",
  "wiki.toolbar",
  "wiki.search",
  "wiki.status",
  "wiki.subjects",
  "wiki.subject",
  "wiki.icon",
  "wiki.id",
  "wiki.card",
  "card.preview-open",
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
  "graph.legend",
  "graph.hint",
  "graph.search",
  "graph.node-list",
  "graph.tooltip",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  /** The walk's own controls above the graph: whole graph, depth, direction, root (plan 5.19). */
  "graph.walk",
  // auditable subject calculations
  "calculations",
  "calculations.summary",
  "calculations.list",
  "calculations.item",
  "calculations.heading",
  "calculations.result",
  "calculations.formula",
  "calculations.inputs",
  "calculations.input",
  "calculations.warnings",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET3 = new Set(PARTS3);
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
  ([name, value]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value}`
).join("; ");
var VIEWER_CSP_TEXT2 = policyText2(VIEWER_CSP2);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT2 = policyText2(VIEWER_CSP_TRUSTED_EDITOR2);
function bindingFor(slot, contract) {
  return slot.bindings.find((binding) => "contract" in binding && binding.contract === contract);
}
function unknownSourceLease(sources, slot, contract) {
  const binding = bindingFor(slot, contract);
  if (binding === void 0 || !("contract" in binding)) return Promise.resolve(void 0);
  return sources.get(binding);
}
async function subjectCandidateProviderLease(sources, slot) {
  const lease = await unknownSourceLease(sources, slot, "common.view/subject-selector-source");
  if (lease === void 0) return void 0;
  return Object.freeze({
    value: createSubjectCandidateProvider(lease.value),
    release: () => lease.release()
  });
}

// apps/web/src/edit-panel.ts
var REOPENED_NOTE = "the tab was reopened, so this view is not stale";
var NOT_REOPENED_NOTE = "the tab could not be reopened, so a view of it may be stale";
function createEditPanel(options) {
  const localizer = options.localizer ?? DEFAULT_UI_LOCALIZER;
  const text = localizer.text;
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, text("web.inspector.edit"));
      const candidateLease = await subjectCandidateProviderLease(args.sources, args.slot);
      if (candidateLease !== void 0) scope.lease(candidateLease);
      const descriptor = args.descriptor;
      const ports = options.portsFor(descriptor);
      const offer = editOffer(descriptor, {
        editable: ports !== void 0,
        ...options.fieldEditors === void 0 ? {} : { fieldEditors: options.fieldEditors }
      });
      const form = element(root, "div", { part: "form" });
      const chooser = element(form, "div", { part: "form.row" });
      element(chooser, "label", { part: "form.label", text: text("edit.operation") });
      const picker = element(chooser, "select", { part: "form.select" });
      if (!(picker instanceof HTMLSelectElement)) throw new TypeError("no select element");
      picker.setAttribute("aria-label", text("edit.mutatingOperation"));
      const summary = element(form, "p", { part: "form.description" });
      const pane = element(form, "div", { part: "form.control" });
      const actions = element(form, "div", { part: "form.actions" });
      const apply = element(actions, "button", { part: "form.button", text: text("edit.apply") });
      apply.setAttribute("type", "button");
      const status = element(form, "output", { part: "form.status" });
      const notes = element(form, "div");
      const say = (message, failed) => {
        setViewerText(status, message);
        setState(status, failed ? ["error"] : []);
        options.onStatus?.({ message, failed });
      };
      const drawNotes = () => {
        notes.replaceChildren();
        const previous = options.lastOutcome(descriptor);
        if (previous !== void 0) {
          element(notes, "div", {
            part: "form.description",
            text: text("edit.lastChange", { change: previous })
          });
        }
        for (const item of offer.unsupported) {
          element(notes, "div", {
            part: "form.description",
            text: text("web.edit.unsupported", {
              operation: item.operationId,
              reason: item.reason
            })
          });
        }
      };
      const inputs = /* @__PURE__ */ new Map();
      const selectedForm = () => offer.forms.find((item) => item.id === picker.value) ?? offer.forms[0];
      const drawFields = async () => {
        await Promise.all([...inputs.values()].map((input) => input.unmount?.()));
        inputs.clear();
        pane.replaceChildren();
        const chosen = selectedForm();
        if (chosen === void 0) {
          setViewerText(summary, text("edit.status.noneDrivable"));
          apply.setAttribute("disabled", "");
          return;
        }
        apply.removeAttribute("disabled");
        setViewerText(summary, `${chosen.summary} (${chosen.operationId} \u2192 ${chosen.handlerId})`);
        for (const item of chosen.fields) {
          const row = element(pane, "div", { part: "form.row" });
          const fieldLabel = item.label;
          element(row, "label", { part: "form.label", text: fieldLabel });
          const control = element(row, "div", { part: "form.control" });
          inputs.set(
            item.name,
            await mountFieldEditor(
              control,
              item,
              scope.signal,
              options.fieldEditors,
              item.editorId,
              candidateLease?.value
            )
          );
          if (item.hint !== void 0) {
            element(row, "span", { part: "form.description", text: item.hint });
          }
          if (item.carried !== void 0) {
            control.querySelector('[data-mk-part="form.input"]')?.setAttribute("title", text("web.edit.carried", { keys: item.carried.join(", ") }));
          }
        }
      };
      const run = async () => {
        const chosen = selectedForm();
        if (chosen === void 0 || ports === void 0) {
          say(text("edit.sessionUnavailable"), true);
          return;
        }
        const values = /* @__PURE__ */ new Map();
        for (const [name, input2] of inputs) {
          const problem = input2.validate();
          if (problem !== void 0) throw new TypeError(problem);
          values.set(name, input2.read());
        }
        let input;
        try {
          input = chosen.build(values);
        } catch (error) {
          say(
            text("edit.applyFailed", {
              reason: error instanceof Error ? error.message : String(error)
            }),
            true
          );
          return;
        }
        const formLabel = chosen.label;
        say(text("web.edit.invoking", { operation: formLabel, handler: chosen.handlerId }), false);
        let result;
        try {
          result = await args.operations.invoke(chosen.handlerId, input, { signal: scope.signal });
        } catch (error) {
          say(
            text("web.edit.codecRefused", {
              reason: error instanceof Error ? error.message : String(error)
            }),
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
          plan = ports.planFromOperation(result.output);
        } catch (error) {
          say(
            text("web.edit.hostRefused", {
              reason: error instanceof Error ? error.message : String(error)
            }),
            true
          );
          return;
        }
        const applied = await ports.applyPlan(plan);
        if (applied.failed) {
          say(applied.message, true);
          return;
        }
        const outcome = `${formLabel} \u2014 ${applied.message}${fidelityNote(plan)}`;
        options.recordOutcome(descriptor, `${outcome}; ${REOPENED_NOTE}`);
        say(text("web.edit.appliedReopening", { outcome }), false);
        if (scope.signal.aborted) return;
        const reopened = await options.reopen(descriptor);
        if (!reopened) {
          options.recordOutcome(descriptor, `${outcome}; ${NOT_REOPENED_NOTE}`);
          if (!scope.signal.aborted) {
            say(text("web.edit.appliedReopenFailed", { outcome }), true);
          }
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
        const option = element(picker, "option", {
          text: item.label
        });
        option.setAttribute("value", item.id);
      }
      picker.addEventListener("change", () => void drawFields());
      await drawFields();
      drawNotes();
      const declared = declaredMutatingOperations(descriptor).length;
      if (offer.forms.length === 0) {
        setState(root, ["degraded"]);
        say(
          offer.unsupported.length === 0 ? text("edit.status.noneDrivable") : text("web.edit.noneDrivableCount", {
            unsupported: offer.unsupported.length,
            declared
          }),
          false
        );
      } else {
        say(text("web.edit.formsAvailable", { forms: offer.forms.length, declared }), false);
      }
      return {
        async update() {
        },
        async unmount() {
          await scope.close();
          root.remove();
        }
      };
    }
  });
}

// packages/ui/dist/panels/index.js
var PARTS4 = Object.freeze([
  // shared surface
  "viewer",
  "viewer.toolbar",
  "viewer.status",
  "viewer.empty",
  /*
   * Toolbar items, shared by every viewer that has a toolbar.
   *
   * They are one vocabulary rather than one per viewer because a theme styles "a toggle in a
   * toolbar" once: a tree, a table and a strings editor that each invented their own part names
   * would make the same button three different things to style.
   */
  "toolbar.group",
  "toolbar.toggle",
  "toolbar.chip",
  "toolbar.action",
  "toolbar.search",
  "toolbar.search-input",
  "toolbar.separator",
  "toolbar.spacer",
  "toolbar.label",
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
  "tree.row",
  "tree.key",
  "tree.twisty",
  "tree.label",
  "tree.value",
  "tree.children",
  // one displayed value, drawn with its syntax runs
  "value.token",
  // inline, schema-driven field editing shared by the tree, the table and the metadata panel
  "field",
  "field.control",
  "field.status",
  "field.target",
  // table
  "table",
  "table.caption",
  "table.body",
  "table.row",
  "table.cell",
  "table.next",
  // variant (localization) tables
  "table.head",
  "table.controls",
  "table.group",
  "table.context",
  "table.columns",
  /** The grip on a header's edge that sizes its column. */
  "table.resize",
  "table.asset",
  "table.unresolved",
  "table.assist",
  "table.suggestions",
  "table.note",
  "table.panel",
  "table.add",
  "table.compare",
  "table.select",
  /** The find bar (Ctrl+F) and its replace row (Ctrl+H). */
  "table.find",
  /** One occurrence of the find text inside a drawn cell. */
  "table.match",
  /** A value's trailing white space, shown where it is drawn. */
  "table.trailing",
  /** A row's status in its status cell (missing, untranslated, duplicate, error…). */
  "table.badge",
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
  // playback stage: a transport with its world positions, participants, series and events
  "playback",
  "playback.title",
  "playback.bar",
  "playback.seek",
  "playback.time",
  "playback.units",
  "playback.rate",
  "playback.body",
  "playback.map",
  "playback.note",
  "playback.side",
  "playback.participants",
  "playback.participant",
  "playback.swatch",
  "playback.charts",
  "playback.chart",
  "playback.playhead",
  "playback.kinds",
  "playback.kind",
  "playback.events",
  "playback.event",
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
  "metadata.note",
  "properties",
  "properties.row",
  "properties.name",
  "properties.value",
  "properties.origin",
  // game template stage: the resolved tree, the drawn template and the element view side by side
  "template.body",
  "template.canvas",
  // image stage
  "image",
  "image.canvas",
  "image.toolbar",
  "image.readout",
  "image.subresources",
  "image.frame-preview",
  "image.convert",
  "image.metadata",
  // map layers: the chosen layer drawn large, a thumbnail per layer, what its colours mean
  "map-layers.view",
  "map-layers.image",
  "map-layers.thumbnail",
  "map-layers.legend",
  "map-layers.swatch",
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
  "audio.notice",
  // vector stage
  "vector",
  "vector.image",
  "vector.readout",
  // font stage
  "font",
  "font.toolbar",
  "font.text",
  "font.row",
  "font.size",
  "font.sample",
  "font.heading",
  "font.set",
  // archive stage
  "archive.members",
  "archive.member-list",
  "archive.item",
  "archive.row",
  "archive.name",
  "archive.detail",
  "archive.children",
  // video stage
  "video",
  "video.player",
  "video.options",
  "video.readout",
  // model stage
  "model",
  "model.canvas",
  "model.readout",
  "model.toolbar",
  "model.primitive-selector",
  "model.animation-selector",
  "model.animation-seek",
  "model.animation-name",
  "model.convert-selector",
  "model.convert-status",
  "model.animation-name-status",
  "model.playback-status",
  "model.controls",
  "model.control-row",
  "model.control-label",
  "model.control-field",
  "model.control-note",
  "model.scale",
  "model.team-color",
  "model.facets",
  "model.facet",
  "model.facet-summary",
  "model.facet-list",
  "model.facet-item",
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
  "filetree.action",
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
  "explorer.opening",
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
  // the subject picker a reference field opens (a unit, a model)
  "selector",
  "selector.search",
  "selector.candidates",
  "selector.more",
  "selector.status",
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
  "workbench.auxbar",
  "workbench.statusbar",
  "workbench.status-slot",
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
  "card.sources",
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
  "card.grid-pages",
  "card.grid-page",
  "card.grid-cell",
  "card.grid-face",
  "card.grid-image",
  "card.grid-cycle",
  "card.grid-opens",
  "card.grid-hotkey",
  "card.grid-icon",
  "card.fields",
  "card.field",
  "card.field-name",
  "card.field-value",
  "card.field-note",
  /** An inline icon in a styled value (`text-runs`): its slot, its pixels, an unresolved run. */
  "card.asset",
  "card.asset-image",
  "card.unresolved",
  "card.nav",
  "card.breadcrumbs",
  "card.knowledge",
  "card.links",
  "card.link-item",
  "card.subcards",
  "card.subcard",
  "card.subcard-head",
  "card.subcard-body",
  "card.custom",
  "image.metadata-group",
  "image.operation",
  "media-shell",
  "media-shell.toggle",
  "media-shell.gallery",
  "media-shell.splitter",
  "media-shell.stage",
  "media-shell.sidebar",
  "media-shell.section",
  "media-shell.section-header",
  "media-shell.section-chevron",
  "media-shell.section-icon",
  "media-shell.section-title",
  "media-shell.section-body",
  "media-shell.gallery-toolbar",
  "media-shell.gallery-mode",
  "media-shell.gallery-list",
  "media-shell.gallery-group",
  "media-shell.gallery-group-header",
  "media-shell.gallery-count",
  "media-shell.gallery-cells",
  "media-shell.gallery-item",
  "media-shell.gallery-thumb-box",
  "media-shell.gallery-thumb",
  "media-shell.gallery-label",
  "media-shell.gallery-empty",
  /** Quick filter (case / whole word / regular expression), shared by every list. */
  "filter",
  "filter.opener",
  "filter.input",
  "filter.option",
  /** Image editing tools, in a sidebar section of whichever viewer shows the pixels. */
  "image-editing",
  "image-editing.group",
  "image-editing.group-title",
  "image-editing.row",
  "image-editing.tools",
  "image-editing.tool",
  "image-editing.chip",
  "image-editing.label",
  "image-editing.range",
  "image-editing.value",
  "image-editing.swatch-button",
  "image-editing.swatch-alpha",
  "image-editing.swatches",
  "image-editing.swatch",
  "image-editing.popover",
  "image-editing.color",
  "image-editing.actions",
  "image-editing.note",
  "image-editing.marquee",
  "image-editing.dialog",
  "image-editing.number",
  "image-editing.select",
  "image-editing.check",
  "card.preview",
  // the wiki of a mod's entities (plan 5.25)
  "wiki",
  "wiki.kinds",
  "wiki.kind",
  "wiki.pane",
  "wiki.toolbar",
  "wiki.search",
  "wiki.status",
  "wiki.subjects",
  "wiki.subject",
  "wiki.icon",
  "wiki.id",
  "wiki.card",
  "card.preview-open",
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
  "graph.legend",
  "graph.hint",
  "graph.search",
  "graph.node-list",
  "graph.tooltip",
  "graph.footer",
  "graph.footer-group",
  "graph.footer-item",
  /** The walk's own controls above the graph: whole graph, depth, direction, root (plan 5.19). */
  "graph.walk",
  // auditable subject calculations
  "calculations",
  "calculations.summary",
  "calculations.list",
  "calculations.item",
  "calculations.heading",
  "calculations.result",
  "calculations.formula",
  "calculations.inputs",
  "calculations.input",
  "calculations.warnings",
  // editor
  "editor",
  "editor.toolbar",
  "editor.text"
]);
var PART_SET4 = new Set(PARTS4);
var PART_ATTRIBUTE3 = "data-mk-part";
var STATE_ATTRIBUTE2 = "data-mk-state";
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
  element22.setAttribute(PART_ATTRIBUTE3, part);
}
function setState3(element22, states) {
  for (const state of states) {
    if (!STATE_SET4.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE2);
  else element22.setAttribute(STATE_ATTRIBUTE2, [...new Set(states)].join(" "));
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
  ([name, value]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value}`
).join("; ");
var VIEWER_CSP_TEXT3 = policyText3(VIEWER_CSP3);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT3 = policyText3(VIEWER_CSP_TRUSTED_EDITOR3);
var HOSTILE_TEXT2 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
function safeViewerText2(value, maximum = 1e6) {
  const text = String(value);
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}\u2026` : text;
  return bounded.replace(HOSTILE_TEXT2, (character) => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "0000";
    return `\\u{${code}}`;
  });
}
function setViewerText3(node, value, maximum) {
  node.textContent = safeViewerText2(value, maximum);
}
function requireContainer(value) {
  if (typeof value !== "object" || value === null || !("ownerDocument" in value) || !("replaceChildren" in value) || typeof value.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value;
}
function createSurface2(container, label) {
  const host = requireContainer(container);
  const root = host.ownerDocument.createElement("section");
  root.className = "modkit-viewer";
  root.tabIndex = 0;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", label);
  root.dataset["modkitViewer"] = label;
  setPart4(root, "viewer");
  host.replaceChildren(root);
  return root;
}
function element3(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText3(node, options.text);
  if (options.part !== void 0) setPart4(node, options.part);
  if (options.state !== void 0) setState3(node, options.state);
  parent.append(node);
  return node;
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
function createViewerMount(root, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted) return;
      state = args;
      root.setAttribute("aria-label", safeViewerText2(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root.remove();
    }
  });
}
function defineViewerModule2(module) {
  return Object.freeze(module);
}
function operationById(descriptor, operationId) {
  return descriptor.operations.find((operation) => operation.id === operationId);
}
async function invokeOperation(descriptor, operations, operationId, input, options) {
  const declaration = operationById(descriptor, operationId);
  if (declaration === void 0) {
    return {
      state: "rejected",
      reason: "not-declared",
      diagnostics: []
    };
  }
  if (declaration.state !== "available") {
    return {
      state: "rejected",
      reason: declaration.state === "dependency-required" ? "dependency-required" : "disabled",
      diagnostics: []
    };
  }
  return operations.invoke(declaration.handlerId, input, {
    ...options?.signal === void 0 ? {} : { signal: options.signal },
    ...options?.onProgress === void 0 ? {} : {
      onProgress: (progress) => options.onProgress?.(progress.completed, progress.total, progress.message)
    }
  });
}
function diagnosticsBySeverity(diagnostics) {
  const unique = /* @__PURE__ */ new Map();
  for (const item of diagnostics) unique.set(item.id, item);
  const values = [...unique.values()];
  return Object.freeze({
    error: Object.freeze(values.filter((item) => item.severity === "error")),
    warning: Object.freeze(values.filter((item) => item.severity === "warning")),
    information: Object.freeze(values.filter((item) => item.severity === "information")),
    hint: Object.freeze(values.filter((item) => item.severity === "hint"))
  });
}
var PANELS_FALLBACK_MESSAGES = {
  "panels.diagnostics": "Diagnostics",
  "panels.operationComplete": "{operation}: complete",
  "panels.operations": "Operations",
  "panels.ready": "Ready",
  "panels.working": "Working"
};
function createEnglishUiLocalizer2(messages) {
  return Object.freeze({
    locale: "en",
    text(key2, values = {}) {
      const message = messages[key2] ?? key2;
      return message.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu, (_match, name) => {
        const value = values[name];
        return value === void 0 ? `{${name}}` : String(value);
      });
    }
  });
}
function withEnglishUiFallback2(localizer, messages) {
  const fallback = createEnglishUiLocalizer2(messages);
  if (localizer === void 0) return fallback;
  return Object.freeze({
    locale: localizer.locale,
    text(key2, values = {}) {
      const translated = localizer.text(key2, values);
      return translated === key2 ? fallback.text(key2, values) : translated;
    }
  });
}
function renderDiagnostics(root, descriptor) {
  root.replaceChildren();
  const grouped = diagnosticsBySeverity(descriptor.diagnostics);
  for (const severity of ["error", "warning", "information", "hint"]) {
    const section = element3(root, "section", { part: "diagnostics.group" });
    section.dataset["severity"] = severity;
    element3(section, "h2", {
      text: `${severity} (${grouped[severity].length})`,
      part: "diagnostics.heading"
    });
    const list = element3(section, "ul", { part: "diagnostics.list" });
    for (const diagnostic2 of grouped[severity]) {
      const item = element3(list, "li", { part: "diagnostics.item" });
      item.dataset["severity"] = severity;
      const button2 = element3(item, "button", {
        text: diagnostic2.message,
        part: "diagnostics.message"
      });
      button2.type = "button";
      button2.dataset["diagnosticId"] = diagnostic2.id;
      button2.addEventListener("click", () => {
        root.dispatchEvent(
          new CustomEvent("modkit-diagnostic-jump", {
            bubbles: true,
            detail: { id: diagnostic2.id, range: diagnostic2.range }
          })
        );
      });
    }
  }
}
function createDiagnosticsPanel(options = {}) {
  const localizer = withEnglishUiFallback2(options.localizer, PANELS_FALLBACK_MESSAGES);
  return defineViewerModule2({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope2(args.signal);
      const root = createSurface2(args.container, localizer.text("panels.diagnostics"));
      renderDiagnostics(root, args.descriptor);
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        renderDiagnostics(root, descriptor);
      });
    }
  });
}
var diagnosticsPanel = createDiagnosticsPanel();
function renderToolbar(root, descriptor, operations, signal, localizer) {
  root.replaceChildren();
  const status = element3(root, "output", {
    text: localizer.text("panels.ready"),
    part: "operations.status"
  });
  for (const operation of descriptor.operations) {
    if (operation.mutatesSource === true) continue;
    const button2 = element3(root, "button", {
      text: operation.id,
      part: "operations.button"
    });
    button2.type = "button";
    button2.disabled = operation.state !== "available";
    if (operation.state !== "available") {
      button2.title = operation.reason;
      continue;
    }
    button2.addEventListener("click", () => {
      button2.disabled = true;
      invokeOperation(descriptor, operations, operation.id, null, {
        signal,
        onProgress: (completed, total, message) => setViewerText3(
          status,
          `${message ?? localizer.text("panels.working")}: ${completed}/${total ?? "?"}`
        )
      }).then(
        (result) => setViewerText3(
          status,
          result.state === "ok" ? localizer.text("panels.operationComplete", { operation: operation.id }) : result.reason
        )
      ).catch(
        (error) => setViewerText3(
          status,
          `${operation.id}: ${error instanceof Error ? error.message : String(error)}`
        )
      ).finally(() => {
        button2.disabled = false;
      });
    });
  }
}
function createOperationToolbar(options = {}) {
  const localizer = withEnglishUiFallback2(options.localizer, PANELS_FALLBACK_MESSAGES);
  return defineViewerModule2({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope2(args.signal);
      const root = createSurface2(args.container, localizer.text("panels.operations"));
      renderToolbar(root, args.descriptor, args.operations, scope.signal, localizer);
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        renderToolbar(root, descriptor, args.operations, scope.signal, localizer);
      });
    }
  });
}
var operationToolbar = createOperationToolbar();

// apps/web/src/inspector.ts
var NON_MUTATING_OPERATION_IDS = Object.freeze([
  "view.inspect",
  "asset.validate",
  "export.raw"
]);
var drivableWithNullInput = (operation) => !operation.mutatesSource && NON_MUTATING_OPERATION_IDS.includes(operation.id);
function nonMutatingDescriptor(descriptor) {
  const operations = descriptor.operations.filter(drivableWithNullInput);
  return { ...descriptor, operations };
}
function declinedNonMutatingOperations(descriptor) {
  return descriptor.operations.filter(
    (operation) => !operation.mutatesSource && !drivableWithNullInput(operation)
  );
}
var noSources = {
  async get() {
    throw new TypeError("the inspector panels consume no data source");
  },
  async getUnknown() {
    throw new TypeError("the inspector panels consume no data source");
  }
};
function panelSlot(slotId, kind) {
  return {
    slotId: presentationSlotId(slotId),
    kind,
    contributionId: "modkit.app.web/inspector",
    extensionId: "modkit.app.web",
    priority: 100,
    bindings: []
  };
}
function createInspector(document2, options = {}) {
  const text = (options.localizer ?? DEFAULT_UI_LOCALIZER).text;
  const root = document2.createElement("div");
  root.className = "web-inspector";
  root.setAttribute("aria-label", text("web.inspector.label"));
  const heading = element(root, "div", { part: "viewer.status" });
  const declined = element(root, "div");
  const toolbarHost = element(root, "div", { part: "viewer.toolbar" });
  const editHost = document2.createElement("div");
  editHost.className = "web-inspector-edit";
  const diagnosticsHost = document2.createElement("div");
  diagnosticsHost.className = "web-inspector-diagnostics";
  root.append(editHost, diagnosticsHost);
  let mounted = [];
  const unmountAll = async () => {
    for (const mount2 of mounted.reverse()) await mount2.unmount();
    mounted = [];
    toolbarHost.replaceChildren();
    editHost.replaceChildren();
    diagnosticsHost.replaceChildren();
    declined.replaceChildren();
  };
  const mount = async (module, container, slot, target, descriptor) => {
    mounted.push(
      await module.mount({
        container,
        descriptor,
        slot,
        sources: noSources,
        operations: target.operations
      })
    );
  };
  const drawDeclined = (target) => {
    const lines = [];
    const needInput = declinedNonMutatingOperations(target.descriptor);
    if (needInput.length > 0) {
      lines.push(
        text("web.inspector.needInput", {
          operations: needInput.map((operation) => operation.id).join(", ")
        })
      );
    }
    const mutating = declaredMutatingOperations(target.descriptor);
    if (mutating.length > 0 && !target.editable) {
      lines.push(
        text("web.inspector.noEdit", {
          operations: mutating.map((operation) => operation.id).join(", "),
          reason: target.editNote ?? text("web.inspector.noWritableHandle")
        })
      );
    }
    const offer = editOffer(target.descriptor, { editable: target.editable });
    if (offer.forms.length === 0) {
      for (const item of offer.unsupported) {
        lines.push(
          text("web.inspector.noForm", { operation: item.operationId, reason: item.reason })
        );
      }
    }
    for (const line of lines) element(declined, "p", { part: "form.description", text: line });
  };
  return {
    root,
    async show(target) {
      await unmountAll();
      if (target === void 0) {
        setViewerText(heading, text("web.inspector.noFile"));
        return;
      }
      const offered = nonMutatingDescriptor(target.descriptor);
      const offer = editOffer(target.descriptor, { editable: target.editable });
      setViewerText(
        heading,
        text("web.inspector.summary", {
          label: target.label,
          read: offered.operations.length,
          forms: offer.forms.length,
          write: declaredMutatingOperations(target.descriptor).length,
          diagnostics: target.descriptor.diagnostics.length
        })
      );
      drawDeclined(target);
      await mount(
        operationToolbar,
        toolbarHost,
        panelSlot("operations", "toolbar"),
        target,
        offered
      );
      if (options.editPanel !== void 0 && offer.forms.length > 0) {
        await mount(
          options.editPanel,
          editHost,
          panelSlot("edit", "panel"),
          target,
          target.descriptor
        );
      }
      await mount(
        diagnosticsPanel,
        diagnosticsHost,
        panelSlot("diagnostics", "panel"),
        target,
        target.descriptor
      );
    },
    async destroy() {
      await unmountAll();
      root.remove();
    }
  };
}

// apps/web/src/session-recovery.ts
var WEB_WORKER_CRASHED = "x3.host/worker-crashed";
function createWebSessionRecovery(options) {
  let current = "healthy";
  let restarting = false;
  return Object.freeze({
    state: () => current,
    report(diagnostic2) {
      if (diagnostic2.code !== WEB_WORKER_CRASHED) return;
      current = "worker-unavailable";
      options.onState(current, diagnostic2.message);
    },
    async restart() {
      if (current !== "worker-unavailable" || restarting) return false;
      if (options.hasUnsaved() && !options.confirmDiscard()) return false;
      restarting = true;
      try {
        await options.restart();
        return true;
      } catch (error) {
        restarting = false;
        throw error;
      }
    }
  });
}

// packages/ui/dist/tokens/index.js
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
var TOKEN_NAMES = Object.freeze([
  "palette.neutral.050",
  "palette.neutral.100",
  "palette.neutral.200",
  "palette.neutral.300",
  "palette.neutral.400",
  "palette.neutral.500",
  "palette.neutral.600",
  "palette.neutral.700",
  "palette.neutral.800",
  "palette.neutral.900",
  "palette.accent.050",
  "palette.accent.100",
  "palette.accent.200",
  "palette.accent.300",
  "palette.accent.400",
  "palette.accent.500",
  "palette.accent.600",
  "palette.accent.700",
  "palette.accent.800",
  "palette.accent.900",
  "palette.ok.050",
  "palette.ok.100",
  "palette.ok.200",
  "palette.ok.300",
  "palette.ok.400",
  "palette.ok.500",
  "palette.ok.600",
  "palette.ok.700",
  "palette.ok.800",
  "palette.ok.900",
  "palette.warn.050",
  "palette.warn.100",
  "palette.warn.200",
  "palette.warn.300",
  "palette.warn.400",
  "palette.warn.500",
  "palette.warn.600",
  "palette.warn.700",
  "palette.warn.800",
  "palette.warn.900",
  "palette.error.050",
  "palette.error.100",
  "palette.error.200",
  "palette.error.300",
  "palette.error.400",
  "palette.error.500",
  "palette.error.600",
  "palette.error.700",
  "palette.error.800",
  "palette.error.900",
  "palette.info.050",
  "palette.info.100",
  "palette.info.200",
  "palette.info.300",
  "palette.info.400",
  "palette.info.500",
  "palette.info.600",
  "palette.info.700",
  "palette.info.800",
  "palette.info.900",
  "color.bg",
  "color.surface",
  "color.raised",
  "color.sunken",
  "color.overlay",
  "color.scrim",
  "color.fg",
  "color.fg-muted",
  "color.fg-subtle",
  "color.fg-inverse",
  "color.fg-disabled",
  "color.fg-link",
  "color.fg-destructive",
  "color.border",
  "color.border-strong",
  "color.separator",
  "color.accent",
  "color.accent-fg",
  "color.accent-muted",
  "color.accent-muted-fg",
  "color.focus",
  "color.hover",
  "color.active",
  "color.selection",
  "color.selection-inactive",
  "color.selection-fg",
  "color.match-highlight",
  "color.drop-target",
  "color.readonly",
  "status.ok",
  "status.ok-fg",
  "status.ok-bg",
  "status.ok-border",
  "status.warn",
  "status.warn-fg",
  "status.warn-bg",
  "status.warn-border",
  "status.error",
  "status.error-fg",
  "status.error-bg",
  "status.error-border",
  "status.info",
  "status.info-fg",
  "status.info-bg",
  "status.info-border",
  "color.scrollbar-track",
  "color.scrollbar-thumb",
  "color.scrollbar-thumb-hover",
  "color.scrollbar-thumb-active",
  "color.scrollbar-shadow",
  "color.canvas-bg",
  "color.canvas-grid",
  "color.canvas-gizmo",
  "color.axis-x",
  "color.axis-y",
  "color.axis-z",
  "color.canvas-selection",
  "chart.categorical-1",
  "chart.categorical-2",
  "chart.categorical-3",
  "chart.categorical-4",
  "chart.categorical-5",
  "chart.categorical-6",
  "color.graph-node",
  "color.graph-edge",
  "color.graph-edge-dead",
  "color.diff-added",
  "color.diff-removed",
  "color.diff-changed",
  "space.0",
  "space.1",
  "space.2",
  "space.3",
  "space.4",
  "space.5",
  "space.6",
  "space.7",
  "space.8",
  "radius.none",
  "radius.sm",
  "radius.md",
  "radius.lg",
  "radius.pill",
  "font.sans",
  "font.mono",
  "font.size-xs",
  "font.size-sm",
  "font.size-md",
  "font.size-lg",
  "font.size-xl",
  "font.weight-normal",
  "font.weight-medium",
  "font.weight-bold",
  "line.tight",
  "line.normal",
  "line.loose",
  "size.row",
  "size.control",
  "size.icon",
  "size.touch",
  "size.scrollbar",
  "size.scrollbar-thin",
  "z.base",
  "z.sticky",
  "z.dropdown",
  "z.overlay",
  "z.modal",
  "z.toast",
  "motion.fast",
  "motion.normal",
  "motion.slow",
  "motion.ease",
  "elevation.1",
  "elevation.2",
  "elevation.3",
  "shadow.focus-ring",
  "tree.indent-level",
  "card.grid-columns",
  "explorer.menu-x",
  "explorer.menu-y",
  "table.row-height",
  "table.header-bg",
  "table.cell-padding-x",
  "tree.indent",
  "tree.row-height",
  "hex.byte-gap",
  "hex.gutter-fg",
  "text.line-height",
  "shell.rail-width",
  "shell.splitter-size",
  "toolbar.height",
  "panel.padding",
  "transport.track-height"
]);
var RAMPS = {
  neutral: [
    "#fafafa",
    "#f0f0f0",
    "#e0e0e0",
    "#c6c6c6",
    "#9a9a9a",
    "#6e6e6e",
    "#4a4a4a",
    "#333333",
    "#232323",
    "#141414"
  ],
  accent: [
    "#e8f2fc",
    "#c7e0f7",
    "#9ccaf0",
    "#6bafe6",
    "#3b93db",
    "#0078d4",
    "#005fb8",
    "#004a93",
    "#00376e",
    "#002649"
  ],
  ok: [
    "#e6f5e9",
    "#c3e7cb",
    "#97d5a5",
    "#6bc27f",
    "#4fb265",
    "#2ea043",
    "#238636",
    "#1a6b2a",
    "#13501f",
    "#0c3514"
  ],
  warn: [
    "#fcf3d8",
    "#f7e3a6",
    "#f0cf6e",
    "#e5ba3c",
    "#d9a520",
    "#bf8700",
    "#9a6d00",
    "#7a5600",
    "#5a3f00",
    "#3b2900"
  ],
  error: [
    "#fde8e8",
    "#fac7c7",
    "#f49b9b",
    "#ec6f6f",
    "#e14b4b",
    "#cf2222",
    "#a81b1b",
    "#851515",
    "#620f0f",
    "#400a0a"
  ],
  info: [
    "#e6f4fb",
    "#c0e3f5",
    "#8ecdec",
    "#5cb6e2",
    "#33a2d8",
    "#0f8bc7",
    "#0b6e9e",
    "#085576",
    "#063d54",
    "#042634"
  ]
};
var STEPS = ["050", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
function rampValues(overrides = {}) {
  const out = {};
  for (const [hue, ramp] of Object.entries({ ...RAMPS, ...overrides })) {
    ramp.forEach((value, index) => {
      out[`palette.${hue}.${STEPS[index]}`] = value;
    });
  }
  return out;
}
var STRUCTURE = {
  "space.0": "0",
  "space.1": "2px",
  "space.2": "4px",
  "space.3": "8px",
  "space.4": "12px",
  "space.5": "16px",
  "space.6": "24px",
  "space.7": "32px",
  "space.8": "48px",
  "radius.none": "0",
  "radius.sm": "2px",
  "radius.md": "4px",
  "radius.lg": "8px",
  "radius.pill": "9999px",
  "font.sans": "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  "font.mono": "ui-monospace, 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  "font.size-xs": "11px",
  "font.size-sm": "12px",
  "font.size-md": "13px",
  "font.size-lg": "15px",
  "font.size-xl": "19px",
  "font.weight-normal": "400",
  "font.weight-medium": "600",
  "font.weight-bold": "700",
  "line.tight": "1.2",
  "line.normal": "1.45",
  "line.loose": "1.7",
  "size.row": "22px",
  "size.control": "26px",
  "size.icon": "16px",
  "size.touch": "44px",
  "size.scrollbar": "10px",
  "size.scrollbar-thin": "6px",
  "z.base": "0",
  "z.sticky": "10",
  "z.dropdown": "20",
  "z.overlay": "30",
  "z.modal": "40",
  "z.toast": "50",
  "motion.fast": "80ms",
  "motion.normal": "140ms",
  "motion.slow": "240ms",
  "motion.ease": "cubic-bezier(0.2, 0, 0.13, 1)"
};
var CHART_DARK = {
  "chart.categorical-1": "#4daafc",
  "chart.categorical-2": "#89d185",
  "chart.categorical-3": "#e5ba3c",
  "chart.categorical-4": "#f49b9b",
  "chart.categorical-5": "#c58af9",
  "chart.categorical-6": "#4ec9b0"
};
var CHART_LIGHT = {
  "chart.categorical-1": "#005fb8",
  "chart.categorical-2": "#238636",
  "chart.categorical-3": "#9a6d00",
  "chart.categorical-4": "#a81b1b",
  "chart.categorical-5": "#7a3fb5",
  "chart.categorical-6": "#0b6e9e"
};
var PALETTES = Object.freeze([
  {
    id: "modkit-dark",
    displayName: "Modkit Dark",
    appearance: "dark",
    isDefaultFor: "dark",
    values: Object.freeze({
      ...rampValues(),
      ...STRUCTURE,
      ...CHART_DARK,
      "color.bg": "#1f1f1f",
      "color.surface": "#1f1f1f",
      "color.raised": "#252526",
      "color.sunken": "#181818",
      "color.overlay": "#2c2c2d",
      "color.scrim": "rgba(0, 0, 0, 0.55)",
      "color.fg": "#cccccc",
      "color.fg-muted": "#9d9d9d",
      "color.fg-subtle": "#7a7a7a",
      "color.fg-inverse": "#ffffff",
      "color.fg-disabled": "#5a5a5a",
      "color.fg-link": "#4daafc",
      "color.fg-destructive": "#f14c4c",
      "color.border": "#2b2b2b",
      "color.border-strong": "#3c3c3c",
      "color.separator": "#2b2b2b",
      "color.accent": "#0078d4",
      "color.accent-fg": "#ffffff",
      "color.accent-muted": "#04395e",
      "color.accent-muted-fg": "#ffffff",
      "color.focus": "#0078d4",
      "color.hover": "#2a2d2e",
      "color.active": "#37373d",
      "color.selection": "#04395e",
      "color.selection-inactive": "#2e2e2e",
      "color.selection-fg": "#ffffff",
      "color.match-highlight": "#623315",
      "color.drop-target": "#0078d4",
      "color.readonly": "#262626",
      "status.ok": "#89d185",
      "status.ok-fg": "#0c3514",
      "status.ok-bg": "#143620",
      "status.ok-border": "#2ea043",
      "status.warn": "#cca700",
      "status.warn-fg": "#3b2900",
      "status.warn-bg": "#3a2f00",
      "status.warn-border": "#bf8700",
      "status.error": "#f14c4c",
      "status.error-fg": "#400a0a",
      "status.error-bg": "#3a1414",
      "status.error-border": "#cf2222",
      "status.info": "#3794ff",
      "status.info-fg": "#042634",
      "status.info-bg": "#10293d",
      "status.info-border": "#0f8bc7",
      "color.scrollbar-track": "rgba(0, 0, 0, 0.16)",
      "color.scrollbar-thumb": "rgba(121, 121, 121, 0.4)",
      "color.scrollbar-thumb-hover": "rgba(150, 150, 150, 0.7)",
      "color.scrollbar-thumb-active": "rgba(180, 180, 180, 0.9)",
      "color.scrollbar-shadow": "rgba(0, 0, 0, 0.36)",
      "color.canvas-bg": "#141414",
      "color.canvas-grid": "#2b2b2b",
      "color.canvas-gizmo": "#9d9d9d",
      "color.axis-x": "#ff3366",
      "color.axis-y": "#33ff88",
      "color.axis-z": "#3388ff",
      "color.canvas-selection": "#f5a623",
      "color.graph-node": "#3c3c3c",
      "color.graph-edge": "#5a5a5a",
      "color.graph-edge-dead": "#f14c4c",
      "color.diff-added": "#1b3a24",
      "color.diff-removed": "#3a1d1d",
      "color.diff-changed": "#2e2a17",
      "elevation.1": "0 1px 2px rgba(0, 0, 0, 0.4)",
      "elevation.2": "0 2px 8px rgba(0, 0, 0, 0.5)",
      "elevation.3": "0 8px 24px rgba(0, 0, 0, 0.6)",
      "shadow.focus-ring": "0 0 0 1px #0078d4"
    })
  },
  {
    id: "modkit-light",
    displayName: "Modkit Light",
    appearance: "light",
    isDefaultFor: "light",
    values: Object.freeze({
      ...rampValues(),
      ...STRUCTURE,
      ...CHART_LIGHT,
      "color.bg": "#ffffff",
      "color.surface": "#ffffff",
      "color.raised": "#f8f8f8",
      "color.sunken": "#f0f0f0",
      "color.overlay": "#ffffff",
      "color.scrim": "rgba(0, 0, 0, 0.3)",
      "color.fg": "#3b3b3b",
      "color.fg-muted": "#616161",
      "color.fg-subtle": "#8b8b8b",
      "color.fg-inverse": "#ffffff",
      "color.fg-disabled": "#a6a6a6",
      "color.fg-link": "#005fb8",
      "color.fg-destructive": "#cf2222",
      "color.border": "#e0e0e0",
      "color.border-strong": "#c6c6c6",
      "color.separator": "#ececec",
      "color.accent": "#005fb8",
      "color.accent-fg": "#ffffff",
      "color.accent-muted": "#cfe4fa",
      "color.accent-muted-fg": "#0a3d63",
      "color.focus": "#005fb8",
      "color.hover": "#e8e8e8",
      "color.active": "#dcdcdc",
      "color.selection": "#cfe4fa",
      "color.selection-inactive": "#e4e6f1",
      "color.selection-fg": "#1a1a1a",
      "color.match-highlight": "#fdea9b",
      "color.drop-target": "#005fb8",
      "color.readonly": "#f5f5f5",
      "status.ok": "#238636",
      "status.ok-fg": "#0c3514",
      "status.ok-bg": "#e6f5e9",
      "status.ok-border": "#97d5a5",
      "status.warn": "#9a6d00",
      "status.warn-fg": "#3b2900",
      "status.warn-bg": "#fcf3d8",
      "status.warn-border": "#f0cf6e",
      "status.error": "#cf2222",
      "status.error-fg": "#400a0a",
      "status.error-bg": "#fde8e8",
      "status.error-border": "#f49b9b",
      "status.info": "#0b6e9e",
      "status.info-fg": "#042634",
      "status.info-bg": "#e6f4fb",
      "status.info-border": "#8ecdec",
      "color.scrollbar-track": "rgba(0, 0, 0, 0.05)",
      "color.scrollbar-thumb": "rgba(100, 100, 100, 0.4)",
      "color.scrollbar-thumb-hover": "rgba(80, 80, 80, 0.6)",
      "color.scrollbar-thumb-active": "rgba(60, 60, 60, 0.8)",
      "color.scrollbar-shadow": "rgba(0, 0, 0, 0.12)",
      "color.canvas-bg": "#f4f4f4",
      "color.canvas-grid": "#e0e0e0",
      "color.canvas-gizmo": "#616161",
      "color.axis-x": "#c02047",
      "color.axis-y": "#1f8f4d",
      "color.axis-z": "#1f6fd0",
      "color.canvas-selection": "#c96a00",
      "color.graph-node": "#e0e0e0",
      "color.graph-edge": "#9a9a9a",
      "color.graph-edge-dead": "#cf2222",
      "color.diff-added": "#e2f6e7",
      "color.diff-removed": "#fbe6e6",
      "color.diff-changed": "#fbf3d6",
      "elevation.1": "0 1px 2px rgba(0, 0, 0, 0.12)",
      "elevation.2": "0 2px 8px rgba(0, 0, 0, 0.16)",
      "elevation.3": "0 8px 24px rgba(0, 0, 0, 0.2)",
      "shadow.focus-ring": "0 0 0 1px #005fb8"
    })
  },
  {
    id: "modkit-high-contrast",
    displayName: "Modkit High Contrast",
    appearance: "dark",
    values: Object.freeze({
      ...rampValues({
        neutral: [
          "#ffffff",
          "#ffffff",
          "#e0e0e0",
          "#c6c6c6",
          "#9a9a9a",
          "#6e6e6e",
          "#4a4a4a",
          "#333333",
          "#1a1a1a",
          "#000000"
        ]
      }),
      ...STRUCTURE,
      ...CHART_DARK,
      "color.bg": "#000000",
      "color.surface": "#000000",
      "color.raised": "#0d0d0d",
      "color.sunken": "#000000",
      "color.overlay": "#000000",
      "color.scrim": "rgba(0, 0, 0, 0.8)",
      "color.fg": "#ffffff",
      "color.fg-muted": "#ffffff",
      "color.fg-subtle": "#d6d6d6",
      "color.fg-inverse": "#000000",
      "color.fg-disabled": "#a6a6a6",
      "color.fg-link": "#3794ff",
      "color.fg-destructive": "#f48771",
      "color.border": "#6fc3df",
      "color.border-strong": "#ffffff",
      "color.separator": "#6fc3df",
      "color.accent": "#0078d4",
      "color.accent-fg": "#ffffff",
      "color.accent-muted": "#000000",
      "color.accent-muted-fg": "#ffffff",
      "color.focus": "#f38518",
      "color.hover": "#0d0d0d",
      "color.active": "#1a1a1a",
      "color.selection": "#000000",
      "color.selection-inactive": "#000000",
      "color.selection-fg": "#ffffff",
      "color.match-highlight": "#000000",
      "color.drop-target": "#f38518",
      "color.readonly": "#0d0d0d",
      "status.ok": "#89d185",
      "status.ok-fg": "#000000",
      "status.ok-bg": "#000000",
      "status.ok-border": "#89d185",
      "status.warn": "#ffd700",
      "status.warn-fg": "#000000",
      "status.warn-bg": "#000000",
      "status.warn-border": "#ffd700",
      "status.error": "#f48771",
      "status.error-fg": "#000000",
      "status.error-bg": "#000000",
      "status.error-border": "#f48771",
      "status.info": "#3794ff",
      "status.info-fg": "#000000",
      "status.info-bg": "#000000",
      "status.info-border": "#3794ff",
      "color.scrollbar-track": "#000000",
      "color.scrollbar-thumb": "#6fc3df",
      "color.scrollbar-thumb-hover": "#ffffff",
      "color.scrollbar-thumb-active": "#f38518",
      "color.scrollbar-shadow": "#6fc3df",
      "color.canvas-bg": "#000000",
      "color.canvas-grid": "#6fc3df",
      "color.canvas-gizmo": "#ffffff",
      "color.axis-x": "#ff6b8a",
      "color.axis-y": "#4dff9e",
      "color.axis-z": "#6bb6ff",
      "color.canvas-selection": "#f38518",
      "color.graph-node": "#000000",
      "color.graph-edge": "#6fc3df",
      "color.graph-edge-dead": "#f48771",
      "color.diff-added": "#000000",
      "color.diff-removed": "#000000",
      "color.diff-changed": "#000000",
      "elevation.1": "0 0 0 1px #6fc3df",
      "elevation.2": "0 0 0 1px #6fc3df",
      "elevation.3": "0 0 0 1px #ffffff",
      "shadow.focus-ring": "0 0 0 2px #f38518"
    })
  }
]);
var PALETTES_BY_ID = new Map(
  PALETTES.map((palette) => [palette.id, palette])
);
var THEME_ATTRIBUTE = "data-mk-theme";
var DENSITY_ATTRIBUTE = "data-mk-density";
function requireElement(value) {
  if (typeof value !== "object" || value === null || !("style" in value) || typeof value.style !== "object") {
    throw new TypeError("token target must be a DOM element");
  }
  return value;
}
function applyTheme(root, theme) {
  const target = requireElement(root);
  if (theme === void 0) target.removeAttribute(THEME_ATTRIBUTE);
  else target.setAttribute(THEME_ATTRIBUTE, theme);
}
function applyDensity(root, density) {
  requireElement(root).setAttribute(DENSITY_ATTRIBUTE, density);
}

// apps/web/src/settings.ts
var SETTINGS_STORAGE_KEY = "modkit.app.web/settings";
var EXTENSIONS_READ_ONLY_REASON = "browser extension locations are managed through granted folders and downloaded packages, so the portable locator list cannot be written here; use the Extensions panel to add sources or enable and disable inventoried extensions";
var sameExtensions = (left, right) => left.length === right.length && left.every((entry, index) => {
  const other = right[index];
  return other !== void 0 && other.id === entry.id && other.enabled === entry.enabled;
});
function createWebSettingsStore(storage, key2 = SETTINGS_STORAGE_KEY) {
  let current = DEFAULT_SETTINGS;
  return {
    location: `localStorage[${key2}]`,
    async read() {
      const raw = storage.getItem(key2);
      if (raw === null) {
        current = DEFAULT_SETTINGS;
        return { document: DEFAULT_SETTINGS, problems: [] };
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        current = DEFAULT_SETTINGS;
        return {
          document: DEFAULT_SETTINGS,
          problems: [
            `stored settings are not valid JSON (${error instanceof Error ? error.message : String(error)}); defaults were used`
          ]
        };
      }
      const normalized = normalizeSettings(parsed);
      current = normalized.document;
      return normalized;
    },
    async write(document2) {
      if (!sameExtensions(document2.extensions, current.extensions)) {
        throw new Error(EXTENSIONS_READ_ONLY_REASON);
      }
      storage.setItem(key2, serializeSettings(document2));
      current = document2;
    }
  };
}
function applyAppearance(root, appearance) {
  applyTheme(root, appearance.theme);
  applyDensity(root, appearance.density);
}

// apps/web/src/format-smoke.ts
var PWA_FORMAT_SMOKE_KIND = "x3.modkit/pwa-installed-format-smoke";
var PWA_HOST_FACILITY_UNAVAILABLE = WEB_SOURCE_FACILITY_UNAVAILABLE;
var PWA_FILESYSTEM_READ_RANDOM = WEB_SOURCE_FILESYSTEM_READ_RANDOM;
var FORMAT_SMOKE_CASE_IDS = Object.freeze([
  "image-dds",
  "image-png",
  "image-tga",
  "image-jpeg",
  "document-odt",
  "data-xml",
  "archive-zip",
  "archive-warzone-wz",
  "archive-mpq",
  "casc-dds",
  "audio-wav",
  "audio-ogg",
  "model-m3",
  "model-warzone-pie"
]);
var compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var sorted = (values) => Object.freeze([...values].sort(compareText));
var object3 = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};
var nonBlank2 = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
};
var sha256 = (value, label) => {
  const text = nonBlank2(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(text)) {
    throw new TypeError(`${label} must be a qualified lower-case SHA-256`);
  }
  return text;
};
var same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
var route = (value, label) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  return Object.freeze(
    value.map((item, index) => {
      const step = object3(item, `${label}[${index}]`);
      return Object.freeze({
        formatId: nonBlank2(step["formatId"], `${label}[${index}].formatId`),
        extensionId: nonBlank2(step["extensionId"], `${label}[${index}].extensionId`),
        contributionId: nonBlank2(step["contributionId"], `${label}[${index}].contributionId`)
      });
    })
  );
};
function validatePwaFormatSmokeAuthority(value) {
  const input = object3(value, "format smoke authority");
  if (input["kind"] !== "x3.ga-recovery/format-family-smoke" || input["schemaVersion"] !== 1) {
    throw new TypeError("format smoke authority has the wrong kind or schemaVersion");
  }
  if (!Array.isArray(input["cases"]) || input["cases"].length !== FORMAT_SMOKE_CASE_IDS.length) {
    throw new TypeError("format smoke authority must contain exactly 14 cases");
  }
  const cases = input["cases"].map((item, index) => {
    const entry = object3(item, `cases[${index}]`);
    const id = nonBlank2(entry["id"], `cases[${index}].id`);
    if (id !== FORMAT_SMOKE_CASE_IDS[index]) {
      throw new TypeError(`cases[${index}].id must be ${FORMAT_SMOKE_CASE_IDS[index]}`);
    }
    const stage = nonBlank2(entry["stage"], `${id}.stage`);
    if (!["raster", "tree-text", "tree", "metadata-tree", "model-or-wireframe"].includes(stage)) {
      throw new TypeError(`${id}.stage is unsupported`);
    }
    if (!Array.isArray(entry["formats"]) || entry["formats"].length === 0) {
      throw new TypeError(`${id}.formats must be non-empty`);
    }
    const selectedRoute = route(entry["route"], `${id}.route`);
    if (!same(
      entry["formats"],
      selectedRoute.map((step) => step.formatId)
    )) {
      throw new TypeError(`${id}.route does not follow its format list`);
    }
    const corpus = object3(entry["corpus"], `${id}.corpus`);
    const runtime2 = object3(entry["runtime"], `${id}.runtime`);
    const pwa = object3(runtime2["pwa"], `${id}.runtime.pwa`);
    const pwaKind = nonBlank2(pwa["kind"], `${id}.runtime.pwa.kind`);
    if (pwaKind !== "browser-subset" && pwaKind !== "host-facility-refusal") {
      throw new TypeError(`${id}.runtime.pwa.kind is unsupported`);
    }
    if (pwaKind === "host-facility-refusal" && corpus["kind"] !== "sc2-casc-entry") {
      throw new TypeError(`${id} is refused without a filesystem-backed SC2 corpus`);
    }
    return Object.freeze({
      id,
      stage,
      formats: Object.freeze(
        entry["formats"].map((format, at) => nonBlank2(format, `${id}.formats[${at}]`))
      ),
      route: selectedRoute,
      corpus: Object.freeze({
        kind: nonBlank2(corpus["kind"], `${id}.corpus.kind`),
        ...typeof corpus["path"] === "string" ? { path: corpus["path"] } : {},
        ...typeof corpus["container"] === "string" ? { container: corpus["container"] } : {},
        ...typeof corpus["bytes"] === "number" ? { bytes: corpus["bytes"] } : {},
        ...typeof corpus["sha256"] === "string" ? { sha256: corpus["sha256"] } : {},
        ...typeof corpus["reason"] === "string" ? { reason: corpus["reason"] } : {}
      }),
      runtime: Object.freeze({
        pwa: pwaKind === "browser-subset" ? Object.freeze({ kind: "browser-subset" }) : Object.freeze({
          kind: "host-facility-refusal",
          code: nonBlank2(pwa["code"], `${id}.runtime.pwa.code`),
          facility: nonBlank2(pwa["facility"], `${id}.runtime.pwa.facility`)
        })
      })
    });
  });
  const browserCases = cases.filter(
    (entry) => entry.runtime.pwa.kind === "browser-subset" && entry.corpus.kind !== "named-exclusion"
  );
  const refusedCases = cases.filter((entry) => entry.runtime.pwa.kind === "host-facility-refusal");
  const excludedCases = cases.filter((entry) => entry.corpus.kind === "named-exclusion");
  if (browserCases.length !== 10 || refusedCases.length !== 4 || excludedCases.length !== 0) {
    throw new TypeError(
      "format smoke authority must contain 10 browser cases, 4 refusals and no exclusions"
    );
  }
  if (!Array.isArray(input["namedExclusions"]) || input["namedExclusions"].length !== 0) {
    throw new TypeError("format smoke authority must contain no named exclusions");
  }
  const generatedFrom = object3(input["generatedFrom"], "generatedFrom");
  const bundledCatalog = object3(generatedFrom["bundledCatalog"], "generatedFrom.bundledCatalog");
  const offlineRelease = object3(generatedFrom["offlineRelease"], "generatedFrom.offlineRelease");
  if (!Array.isArray(bundledCatalog["roots"]) || !Array.isArray(offlineRelease["roots"])) {
    throw new TypeError("generated catalog roots must be arrays");
  }
  if (!Array.isArray(offlineRelease["packageIds"])) {
    throw new TypeError("generated package ids must be an array");
  }
  const contributionCount = generatedFrom["codecContributionCount"];
  if (!Number.isSafeInteger(contributionCount) || Number(contributionCount) <= 0) {
    throw new TypeError("generated codec contribution count must be positive");
  }
  return Object.freeze({
    kind: "x3.ga-recovery/format-family-smoke",
    schemaVersion: 1,
    generatedFrom: Object.freeze({
      bundledCatalog: Object.freeze({
        sha256: sha256(bundledCatalog["sha256"], "generatedFrom.bundledCatalog.sha256"),
        roots: Object.freeze(
          bundledCatalog["roots"].map((item, index) => {
            const root = object3(item, `generatedFrom.bundledCatalog.roots[${index}]`);
            return Object.freeze({
              coordinate: nonBlank2(
                root["coordinate"],
                `generatedFrom.bundledCatalog.roots[${index}].coordinate`
              )
            });
          })
        )
      }),
      offlineRelease: Object.freeze({
        descriptorSha256: sha256(
          offlineRelease["descriptorSha256"],
          "generatedFrom.offlineRelease.descriptorSha256"
        ),
        catalogSha256: sha256(
          offlineRelease["catalogSha256"],
          "generatedFrom.offlineRelease.catalogSha256"
        ),
        packageIds: sorted(
          offlineRelease["packageIds"].map(
            (id, index) => nonBlank2(id, `generatedFrom.offlineRelease.packageIds[${index}]`)
          )
        ),
        roots: sorted(
          offlineRelease["roots"].map(
            (id, index) => nonBlank2(id, `generatedFrom.offlineRelease.roots[${index}]`)
          )
        )
      }),
      codecContributionCount: Number(contributionCount)
    }),
    cases: Object.freeze(cases),
    namedExclusions: Object.freeze([])
  });
}
var toHex = (bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
async function loadPwaFormatSmokeAuthority(uri, expectedSha256, fetcher = fetch) {
  const response = await fetcher(uri, { cache: "no-store" });
  if (!response.ok)
    throw new TypeError(`format smoke authority request failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = `sha256:${toHex(await crypto.subtle.digest("SHA-256", bytes))}`;
  if (actual !== expectedSha256) {
    throw new TypeError("served format smoke authority does not match this build");
  }
  const authority = validatePwaFormatSmokeAuthority(
    JSON.parse(new TextDecoder().decode(bytes))
  );
  return Object.freeze({ authority, sha256: actual });
}
var positive3 = (value) => Number.isFinite(value) && value > 0;
function stagePass(expected, actual) {
  if (expected !== actual.kind) return false;
  if (actual.kind === "raster") {
    return positive3(actual.width) && positive3(actual.height) && positive3(actual.opaquePixels) && positive3(actual.metadataEntries);
  }
  if (actual.kind === "tree-text") {
    return positive3(actual.treeNodes) && positive3(actual.textCharacters);
  }
  if (actual.kind === "tree") return positive3(actual.treeNodes);
  if (actual.kind === "metadata-tree") {
    return positive3(actual.metadataEntries) && positive3(actual.treeNodes);
  }
  return positive3(actual.width) && positive3(actual.height);
}
var safeFailure = (id, code) => Object.freeze({
  id,
  outcome: "failed",
  code,
  // Never copy an exception message here: browser/file errors may contain the corpus URL.
  message: "the installed PWA case did not complete",
  verdict: "fail"
});
function freezeReceipt(receipt) {
  return Object.freeze(receipt);
}
function createPwaFormatSmokeAcceptance(options) {
  const authority = options.authority;
  const expectedPackages = authority.generatedFrom.offlineRelease.packageIds;
  let receipt = freezeReceipt({
    kind: PWA_FORMAT_SMOKE_KIND,
    schemaVersion: 1,
    authority: Object.freeze({
      sha256: options.authoritySha256,
      caseCount: 14,
      namedExclusionCount: 1
    }),
    catalog: Object.freeze({
      expectedBundledCatalogSha256: authority.generatedFrom.bundledCatalog.sha256,
      expectedOfflineCatalogSha256: authority.generatedFrom.offlineRelease.catalogSha256,
      actualOfflineCatalogSha256: "",
      expectedManagedRoots: authority.generatedFrom.offlineRelease.roots,
      loadedManagedRoots: Object.freeze([]),
      expectedCodecContributionCount: authority.generatedFrom.codecContributionCount,
      loadedCodecContributionCount: 0
    }),
    packages: Object.freeze({ expectedIds: expectedPackages, installed: Object.freeze([]) }),
    cases: Object.freeze([]),
    verdict: "pending"
  });
  return Object.freeze({
    prepare: () => options.bridge.preparePackages(expectedPackages),
    receipt: () => receipt,
    async run(corpusUrls) {
      const runtime2 = await options.bridge.runtimeIdentity();
      const observations = [];
      for (const testCase of authority.cases) {
        if (testCase.corpus.kind === "named-exclusion") {
          observations.push(
            Object.freeze({
              id: testCase.id,
              outcome: "excluded",
              reason: testCase.corpus.reason ?? authority.namedExclusions[0]?.reason ?? "No real ODT corpus is available.",
              verdict: "pass"
            })
          );
          continue;
        }
        if (testCase.runtime.pwa.kind === "host-facility-refusal") {
          try {
            await options.bridge.openHostOnlySource(testCase);
            observations.push(safeFailure(testCase.id, "x3.acceptance/facility-was-available"));
          } catch (error) {
            const terminal = testCase.route.at(-1);
            const actual = isModkitError(error) && error.code === PWA_HOST_FACILITY_UNAVAILABLE ? {
              code: error.code,
              boundary: error.context?.["boundary"],
              facility: error.context?.["facility"],
              requestId: error.context?.["requestId"],
              sourceKind: error.context?.["sourceKind"],
              contentSha256: error.context?.["contentSha256"],
              bytes: error.context?.["bytes"],
              requestedFormatId: error.context?.["requestedFormatId"]
            } : void 0;
            const matchesExpected = actual !== void 0 && actual.code === testCase.runtime.pwa.code && actual.boundary === WEB_SOURCE_OPEN_BOUNDARY && actual.facility === testCase.runtime.pwa.facility && actual.requestId === testCase.id && actual.sourceKind === testCase.corpus.kind && actual.contentSha256 === testCase.corpus.sha256 && actual.bytes === testCase.corpus.bytes && actual.requestedFormatId === terminal?.formatId;
            observations.push(
              matchesExpected ? Object.freeze({
                id: testCase.id,
                outcome: "refused",
                code: PWA_HOST_FACILITY_UNAVAILABLE,
                facility: PWA_FILESYSTEM_READ_RANDOM,
                source: Object.freeze({
                  boundary: WEB_SOURCE_OPEN_BOUNDARY,
                  kind: "sc2-casc-entry",
                  contentSha256: actual.contentSha256,
                  bytes: actual.bytes,
                  requestedFormatId: actual.requestedFormatId
                }),
                verdict: "pass"
              }) : safeFailure(testCase.id, "x3.acceptance/wrong-facility-refusal")
            );
          }
          continue;
        }
        const corpusUrl = corpusUrls[testCase.id];
        if (typeof corpusUrl !== "string" || corpusUrl === "") {
          observations.push(safeFailure(testCase.id, "x3.acceptance/missing-corpus-url"));
          continue;
        }
        try {
          const opened = await options.bridge.open(testCase, corpusUrl);
          const pass2 = same(opened.selectedRoute, testCase.route) && stagePass(testCase.stage, opened.stage);
          observations.push(
            Object.freeze({
              id: testCase.id,
              outcome: "opened",
              selectedRoute: Object.freeze(
                opened.selectedRoute.map((step) => Object.freeze({ ...step }))
              ),
              corpus: Object.freeze({ ...opened.corpus }),
              stage: Object.freeze({ ...opened.stage }),
              verdict: pass2 ? "pass" : "fail"
            })
          );
        } catch (error) {
          options.bridge.reportFailure?.(testCase.id, error);
          observations.push(safeFailure(testCase.id, "x3.acceptance/open-failed"));
        }
      }
      const installedPackages = Object.freeze(
        [...runtime2.packages].map((item) => Object.freeze({ ...item })).sort((left, right) => compareText(left.id, right.id))
      );
      const identityPass = runtime2.offlineCatalogSha256 === authority.generatedFrom.offlineRelease.catalogSha256 && same(sorted(runtime2.loadedManagedRoots), authority.generatedFrom.offlineRelease.roots) && runtime2.codecContributionCount === authority.generatedFrom.codecContributionCount && same(
        installedPackages.filter((item) => item.enabled).map((item) => item.id),
        expectedPackages
      );
      const pass = identityPass && observations.every((item) => item.verdict === "pass");
      receipt = freezeReceipt({
        kind: PWA_FORMAT_SMOKE_KIND,
        schemaVersion: 1,
        authority: receipt.authority,
        catalog: Object.freeze({
          expectedBundledCatalogSha256: authority.generatedFrom.bundledCatalog.sha256,
          expectedOfflineCatalogSha256: authority.generatedFrom.offlineRelease.catalogSha256,
          actualOfflineCatalogSha256: runtime2.offlineCatalogSha256,
          expectedManagedRoots: authority.generatedFrom.offlineRelease.roots,
          loadedManagedRoots: sorted(runtime2.loadedManagedRoots),
          expectedCodecContributionCount: authority.generatedFrom.codecContributionCount,
          loadedCodecContributionCount: runtime2.codecContributionCount
        }),
        packages: Object.freeze({ expectedIds: expectedPackages, installed: installedPackages }),
        cases: Object.freeze(observations),
        verdict: pass ? "pass" : "fail"
      });
      return receipt;
    }
  });
}

// apps/web/src/shell.ts
var SAMPLES = Object.freeze([
  { path: "./favicon-32.png", labelKey: "web.sample.png" },
  { path: "./samples/sample.csv", labelKey: "web.sample.csv" },
  { path: "./samples/sample.ini", labelKey: "web.sample.ini" },
  { path: "./samples/sample.svg", labelKey: "web.sample.svg" },
  { path: "./samples/sample.md", labelKey: "web.sample.md" },
  { path: "./samples/sample.mp3", labelKey: "web.sample.mp3" },
  { path: "./samples/sample.zip", labelKey: "web.sample.zip" }
]);
var describe2 = (error) => error instanceof Error ? error.message : String(error);
function requireRoot() {
  const node = document.querySelector("#root");
  if (node === null) throw new Error("missing #root");
  return node;
}
function identity() {
  const agent = navigator.userAgent;
  const operatingSystem = agent.includes("Windows") ? "windows" : agent.includes("Mac") ? "darwin" : "linux";
  return { operatingSystem, architecture: "x64" };
}
function bytesSource(entryId, bytes, token) {
  const uri = sourceUriFor(entryId);
  return {
    kind: "bytes",
    ref: { id: uri, uri },
    revision: revisionId(token),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      const start = Number(offset);
      return bytes.slice(start, Math.min(bytes.byteLength, start + length));
    },
    async *stream(range) {
      const start = Number(range?.offset ?? 0n);
      const end = range?.length === void 0 ? bytes.byteLength : start + Number(range.length);
      yield bytes.slice(start, Math.min(bytes.byteLength, end));
    }
  };
}
var descriptorKey = (descriptor) => `${descriptor.subjectUri} :: ${descriptor.revision}`;
async function pickFile() {
  const picker = window.showOpenFilePicker;
  if (picker !== void 0) {
    const [handle] = await picker.call(window);
    if (handle === void 0) return void 0;
    return { file: await handle.getFile(), handle };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.addEventListener(
      "change",
      () => {
        const chosen = input.files?.[0];
        resolve(chosen === void 0 ? void 0 : { file: chosen });
      },
      { once: true }
    );
    input.click();
  });
}
async function pickDirectory() {
  const picker = window.showDirectoryPicker;
  if (picker === void 0) return void 0;
  return picker.call(window);
}
async function fetchServed(baseUrl, path) {
  const target = new URL(path, baseUrl);
  if (target.origin !== baseUrl.origin) return void 0;
  const response = await fetch(target.href);
  if (!response.ok) return void 0;
  const blob = await response.blob();
  const name = target.pathname.split("/").pop() ?? "resource";
  return new File([blob], name, { lastModified: Date.now() });
}
async function boot() {
  const probe = probeWebFacilities();
  const appThemes = readAppThemeChoices(document);
  const settingsStore = createWebSettingsStore(window.localStorage);
  let settingsDocument = (await settingsStore.read()).document;
  const baseUrl = new URL("./", document.baseURI);
  const pageUrl = new URL(window.location.href);
  const requestedLocale = pageUrl.searchParams.get("lang") ?? navigator.languages;
  let localizer = createWebLocalizer(requestedLocale);
  let locale = localizer.locale;
  let t2 = localizer.text;
  document.documentElement.lang = locale;
  document.title = t2("app.title");
  const booting = document.querySelector(".booting");
  if (booting !== null) setViewerText(booting, t2("app.starting"));
  const capability = describeFileCapability(window);
  let capabilityNotice = t2(
    capability.directories ? "web.capability.folder" : capability.filePicker ? "web.capability.file" : "web.capability.input"
  );
  const bootDiagnostics = [];
  const bootSessionDiagnostics = [];
  const recoveryHost = {};
  const extensionStore = createIndexedDbExtensionStore(indexedDB);
  const managedRuntime = createBrowserExtensionManager({
    indexedDB,
    ...typeof caches === "undefined" ? {} : { cacheStorage: caches },
    registry: {
      catalogUri: new URL(WEB_OFFLINE_RELEASE.catalogPath, document.baseURI).href,
      trustedPublicKeys: { [WEB_OFFLINE_RELEASE.keyId]: WEB_OFFLINE_RELEASE.publicJwk },
      cacheKey: `modkit.app.web/offline-release/${WEB_OFFLINE_RELEASE.catalogSha256}`
    },
    allowedOrigins: [window.location.origin],
    maxArtifactBytes: WEB_OFFLINE_RELEASE.maxArtifactBytes
  });
  const managedStorage = managedRuntime.storage;
  const managedExtensions = createManagedExtensionsController({
    client: managedRuntime.client,
    catalogLocation: managedRuntime.catalogLocation
  });
  const subtle = {
    digest: (algorithm, data) => crypto.subtle.digest(algorithm, data)
  };
  const managedRoots = await loadManagedExtensionRoots(managedStorage, {
    subtle,
    claimed: catalogCoordinates(WEB_EXTENSION_CATALOG)
  });
  for (const failure2 of managedRoots.failures) {
    bootDiagnostics.push(`${failure2.code}: ${failure2.message}`);
  }
  const composedDisabledExtensions = () => Object.freeze(
    [
      .../* @__PURE__ */ new Set([
        ...settingsDocument.disabledExtensions,
        ...managedRoots.disabledExtensionCoordinates
      ])
    ].sort()
  );
  const host = {};
  const extensionsUi = mountExtensionsUi(document, {
    localizer,
    store: extensionStore,
    catalog: WEB_EXTENSION_CATALOG,
    managedExtensions,
    additionalClaimedCoordinates: managedRoots.coordinates,
    subtle,
    pickDirectory: async () => {
      const picker = window.showDirectoryPicker;
      if (picker === void 0) throw new Error("this browser has no folder picker");
      return await picker.call(window);
    },
    conflicts: () => host.services?.userExtensionConflicts ?? [],
    extensionSubjects: () => {
      const inventory = host.services?.main.inventory;
      if (inventory === void 0) return void 0;
      const packageEnablement = Object.fromEntries(
        managedExtensions.snapshot().rows.filter((row) => row.installed).map((row) => [row.id, row.enabled])
      );
      return createWebExtensionSubjectCatalog(inventory, {
        disabledExtensions: settingsDocument.disabledExtensions,
        disabledContributions: settingsDocument.disabledContributions,
        managedPackageByExtension: managedRoots.packageByCoordinate,
        managedPackageEnablement: packageEnablement
      });
    },
    setContributionEnabled: async (id, enabled) => {
      const disabled = new Set(settingsDocument.disabledContributions);
      if (enabled) disabled.delete(id);
      else disabled.add(id);
      settingsDocument = {
        ...settingsDocument,
        disabledContributions: Object.freeze([...disabled].sort())
      };
      await settingsStore.write(settingsDocument);
    },
    setExtensionEnabled: async (id, enabled) => {
      const disabled = new Set(settingsDocument.disabledExtensions);
      if (enabled) disabled.delete(id);
      else disabled.add(id);
      settingsDocument = {
        ...settingsDocument,
        disabledExtensions: Object.freeze([...disabled].sort())
      };
      await settingsStore.write(settingsDocument);
    },
    onChanged: (loaded) => {
      console.info(
        `[extensions] ${loaded.inputs.length} user extension(s) loaded. Reload the page to compose a host with a changed list: this app builds its inventory once, at startup.`
      );
    }
  });
  await extensionsUi.reload();
  for (const failure2 of extensionsUi.current().failures) {
    bootDiagnostics.push(`${failure2.code}: ${failure2.message}`);
  }
  const loadedExtensionRoots = combineLoadedExtensionRoots(managedRoots, extensionsUi.current());
  const services = await createWebSubjectServices({
    baseUrl,
    catalog: WEB_EXTENSION_CATALOG,
    // Downloaded packages precede user-picked folders. Both already passed the same root loader,
    // and the combined serve function is the one synthetic fetch used by the worker verifier.
    userExtensions: loadedExtensionRoots,
    moduleMap: Object.freeze({
      ...resolveModuleMap(baseUrl),
      ...loadedExtensionRoots.moduleMap
    }),
    identity: identity(),
    disabledExtensions: composedDisabledExtensions(),
    disabledContributions: settingsDocument.disabledContributions,
    probe,
    dom: {
      fetch: (url, init) => fetch(url, init),
      subtle: {
        digest: (algorithm, data) => crypto.subtle.digest(algorithm, data)
      },
      // the structural DOM shapes take readonly parts / any blob; the platform types are wider
      Blob,
      objectUrls: URL,
      Worker,
      MessageChannel
    },
    onDiagnostic: (diagnostic2) => {
      bootDiagnostics.push(`${diagnostic2.code}: ${diagnostic2.message}`);
      bootSessionDiagnostics.push({ code: diagnostic2.code, message: diagnostic2.message });
      recoveryHost.current?.report(diagnostic2);
      console.info(`[worker] ${diagnostic2.severity} ${diagnostic2.code}: ${diagnostic2.message}`);
    }
  });
  const loadedLocalization = await loadWebLocalizationCatalogs({
    inventory: services.main.inventory,
    baseUrl,
    loadedExtensionRoots,
    fetch: (url, init) => fetch(url, init)
  });
  for (const diagnostic2 of loadedLocalization.diagnostics) {
    bootDiagnostics.push(`${diagnostic2.code}: ${diagnostic2.message}`);
  }
  localizer = createWebLocalizer(requestedLocale, loadedLocalization.catalogs);
  locale = localizer.locale;
  t2 = localizer.text;
  capabilityNotice = t2(
    capability.directories ? "web.capability.folder" : capability.filePicker ? "web.capability.file" : "web.capability.input"
  );
  document.documentElement.lang = locale;
  document.title = t2("app.title");
  if (booting !== null) setViewerText(booting, t2("app.starting"));
  extensionsUi.setLocalizer(localizer);
  window.addEventListener(
    "pagehide",
    () => void Promise.all([services.dispose(), managedRuntime.dispose()]),
    { once: true }
  );
  host.services = services;
  await extensionsUi.reload();
  const workbench = mountWebWorkbench(
    document,
    requireRoot(),
    {
      topology: createWebTopology(identity(), probe),
      main: services.main,
      worker: services.worker
    },
    t2("app.title"),
    localizer
  );
  const statusLine = document.createElement("output");
  statusLine.className = "web-status";
  const restartSession = document.createElement("button");
  restartSession.className = "web-session-restart";
  restartSession.type = "button";
  restartSession.hidden = true;
  restartSession.textContent = t2("action.restartSession");
  restartSession.title = t2("action.restartSessionTitle");
  workbench.root.querySelector('[data-mk-part="workbench.statusbar"]')?.append(statusLine, restartSession);
  const say = (message) => setViewerText(statusLine, message, 400);
  const operationSessions = /* @__PURE__ */ new Map();
  const assetSessions = /* @__PURE__ */ new Map();
  const rasterResources = /* @__PURE__ */ new Map();
  const pendingNested = /* @__PURE__ */ new Map();
  const selectedRoutes = /* @__PURE__ */ new Map();
  let activeFormatSmokeCase;
  let activeFormatSmokeStage;
  let lastFormatSmokeOpen;
  let lastFormatSmokeHostFailure;
  let lastFormatSmokeCandidates;
  const summarizeFormatSmokeCandidates = (result) => JSON.stringify({
    candidates: result.candidates.map((candidate) => ({
      extensionId: candidate.extensionId,
      contributionId: candidate.contributionId,
      variantId: candidate.variantId,
      state: candidate.state,
      ...candidate.confidence === void 0 ? {} : { confidence: candidate.confidence },
      diagnostics: candidate.diagnostics.map((diagnostic2) => ({
        code: diagnostic2.code,
        message: diagnostic2.message
      }))
    })),
    diagnostics: result.diagnostics.map((diagnostic2) => ({
      code: diagnostic2.code,
      message: diagnostic2.message
    }))
  });
  const inspected = /* @__PURE__ */ new Map();
  const entryOfDescriptor = /* @__PURE__ */ new Map();
  const openedEntries = /* @__PURE__ */ new Map();
  const editOutcomes = /* @__PURE__ */ new Map();
  const subjectEditors = /* @__PURE__ */ new Map();
  const entryIdOf = (descriptor) => entryOfDescriptor.get(descriptorKey(descriptor));
  const tabsOn = (entryId) => [...editors.root.querySelectorAll('[data-mk-part="explorer.filetab"]')].filter(
    (node) => node instanceof HTMLElement && node.title === entryId
  );
  const reopenEntry = async (entryId) => {
    const entry = openedEntries.get(entryId);
    if (entry === void 0) return false;
    for (const tab of tabsOn(entryId)) {
      const close = tab.querySelector('[data-mk-part="explorer.filetab-close"]');
      if (close instanceof HTMLElement) close.click();
    }
    for (let attempt = 0; attempt < 100 && tabsOn(entryId).length > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (tabsOn(entryId).length > 0) return false;
    await editors.open(entry);
    return true;
  };
  const editPanel = createEditPanel({
    localizer,
    portsFor: (descriptor) => {
      const entryId = entryIdOf(descriptor);
      return entryId === void 0 ? void 0 : subjectEditors.get(entryId);
    },
    reopen: async (descriptor) => {
      const entryId = entryIdOf(descriptor);
      return entryId === void 0 ? false : reopenEntry(entryId);
    },
    lastOutcome: (descriptor) => editOutcomes.get(descriptor.subjectUri),
    recordOutcome: (descriptor, outcome) => {
      editOutcomes.set(descriptor.subjectUri, outcome);
    },
    // The panel is chrome beside the tab, so its result belongs on the same status line and in the
    // same host-rail sentence every other editing surface in this app reports to.
    onStatus: (status) => {
      say(status.message);
      noteEditing(status.message);
    }
  });
  const inspector = createInspector(document, { editPanel, localizer });
  workbench.setPanel(inspector.root);
  let inspecting;
  const inspect = (entryId) => {
    if (inspecting === entryId) return;
    inspecting = entryId;
    void inspector.show(entryId === void 0 ? void 0 : inspected.get(entryId)).catch((error) => console.warn("inspector failed", error));
  };
  let access;
  const pinnedRevisions = /* @__PURE__ */ new Map();
  const writableHandles = /* @__PURE__ */ new Map();
  const editability = /* @__PURE__ */ new Map();
  const editingStatus = document.createElement("p");
  setPart(editingStatus, "settings.status");
  setViewerText(editingStatus, t2("status.noFileEditable"));
  const noteEditing = (message) => setViewerText(editingStatus, message, 400);
  let markDirty = () => void 0;
  let focused;
  const editing = createWebEditingArm({
    localizer,
    inventory: services.main.inventory,
    handleFor: (sourceId) => writableHandles.get(sourceId),
    onNotice(message) {
      say(message);
      noteEditing(message);
    },
    onDirty: (entryId, dirty) => markDirty(entryId, dirty),
    /*
     * Reached from an editor's Save click, which is the only place the browser will honour
     * `requestPermission`. Asking on load is both refused by the browser and rude.
     */
    async ensureWriteAccess(entryId) {
      const current = await describeEditability(access, entryId, entryId, localizer);
      if (current.state === "granted" || current.state === "no-permission-surface") return "granted";
      if (current.state !== "prompt") {
        noteEditing(current.sentence);
        return "denied";
      }
      const asked = await requestWriteAccess(access, localizer);
      noteEditing(asked.sentence);
      return asked.state === "granted" ? "granted" : asked.state === "denied" ? "denied" : "prompt";
    }
  });
  let openCount = 0;
  const nestedEntryId = (containerKey, entryPath) => `x3-nested:${containerKey}#${entryPath}`;
  const selectedStep = (result) => {
    if (!("identity" in result.descriptor)) {
      throw new TypeError("an opened subject has no resolved descriptor identity");
    }
    return Object.freeze({
      formatId: result.descriptor.identity.formatId,
      extensionId: result.selected.extensionId,
      contributionId: result.selected.contributionId
    });
  };
  const openNestedEntry = async (descriptor, entryId, entryPath, verifiedBytes) => {
    const key2 = descriptorKey(descriptor);
    const parent = assetSessions.get(key2);
    if (parent === void 0) return t2("web.archive.sessionGone");
    const nested = await openNestedSubject({
      parent,
      entryId,
      ...nestedSubjectServices(services),
      grant: { id: `pwa-nested-${openCount}`, classes: ["read-source"] },
      budget: {
        maxInputBytes: BigInt(
          activeFormatSmokeCase === void 0 ? EXPLORER_MAXIMUM_BYTES : WEB_OFFLINE_RELEASE.maxArtifactBytes
        ),
        maxDepth: 256,
        maxNodes: 1e6,
        maxScalarBytes: 64 * 1024 * 1024,
        maxDiagnostics: 1e4,
        deadlineMs: 3e4
      }
    });
    if (nested.result.state !== "opened") {
      return t2("web.status.noNestedCodec", { name: entryPath, reason: nested.result.reason });
    }
    const operations = operationSessions.get(key2);
    const extract = descriptor.operations.find(
      (operation) => operation.state === "available" && !operation.mutatesSource && operation.id === CONTAINER_EXTRACT_OPERATION_ID
    );
    let bytes = verifiedBytes?.slice() ?? new Uint8Array();
    if (verifiedBytes === void 0 && operations !== void 0 && extract !== void 0) {
      const read = await operations.invoke(extract.handlerId, { entryId }, {});
      if (read.state === "ok" && read.output.kind === "bytes") bytes = read.output.value.slice();
    }
    const id = nestedEntryId(key2, entryPath);
    const label = entryPath.slice(entryPath.lastIndexOf("/") + 1);
    const selectedRoute = Object.freeze([
      ...selectedRoutes.get(key2) ?? [],
      selectedStep(nested.result)
    ]);
    pendingNested.set(id, { result: nested.result, bytes, label, selectedRoute });
    await editors.open({ id, name: label, directory: false });
    return void 0;
  };
  const stages = createWebPreviewStages({
    localizer,
    renderer: services.renderer,
    operationsFor: (descriptor) => operationSessions.get(descriptorKey(descriptor)),
    textures: (descriptor, references, signal, report) => {
      const raster = rasterResources.get(descriptorKey(descriptor));
      return raster === void 0 ? Promise.resolve(/* @__PURE__ */ new Map()) : resolveModelViewerTextures(raster, references, signal, report);
    },
    rasterResources: (descriptor) => rasterResources.get(descriptorKey(descriptor)),
    /*
     * The web half of `block9/archive-entry-as-subject` (block 13 slice B).
     *
     * Electron reached this route from its composition and VS Code reached it from its Explorer;
     * this page reached it from nowhere, and its archive stage settled for a hex pane. The route is
     * the host's, unchanged: the parent container stays open and leased for as long as the child
     * lives, so a model inside an archive finds its texture inside that same archive rather than
     * through a file this browser could not open anyway.
     */
    openNestedEntry
  });
  const previewBase = {
    supported: services.supportedExtensions,
    stages,
    fallback: createWebPreviewFallback(localizer),
    async openSession(entry, bytes, signal) {
      openCount += 1;
      const writable = editability.get(entry.id)?.editable === true;
      const token = pinnedRevisions.get(entry.id) ?? `provider-token:${bytes.byteLength}-${openCount}`;
      const grant = {
        id: `pwa-${openCount}`,
        classes: writable ? ["read-source", "write-source"] : ["read-source"]
      };
      const budget = {
        maxInputBytes: BigInt(
          activeFormatSmokeCase === void 0 ? EXPLORER_MAXIMUM_BYTES : WEB_OFFLINE_RELEASE.maxArtifactBytes
        ),
        maxDepth: 256,
        maxNodes: 1e6,
        maxScalarBytes: 64 * 1024 * 1024,
        maxDiagnostics: 1e4,
        deadlineMs: 3e4
      };
      const nested = pendingNested.get(entry.id);
      if (nested !== void 0) pendingNested.delete(entry.id);
      const ordinary = nested?.result ?? await services.open({
        source: bytesSource(entry.id, bytes, token),
        path: entry.name,
        intent: "full",
        grant,
        budget,
        ...signal === void 0 ? {} : { signal }
      });
      if (activeFormatSmokeCase !== void 0) {
        lastFormatSmokeCandidates = summarizeFormatSmokeCandidates(ordinary);
      }
      if (ordinary.state === "unresolved") {
        if (activeFormatSmokeCase !== void 0) {
          lastFormatSmokeHostFailure = `${ordinary.reason}; candidates=${lastFormatSmokeCandidates}`;
        }
        say(t2("web.status.noCodec", { name: entry.name, reason: ordinary.reason }));
        return void 0;
      }
      let mapPreview = await prepareWebMapPreview({
        services,
        opened: ordinary,
        grant,
        budgets: budget,
        localizer,
        ...signal === void 0 ? {} : { signal }
      });
      if (mapPreview.state === "selection-required") {
        const choice = window.prompt(
          t2("web.map.choose", {
            candidates: mapPreview.candidates.map(
              (candidate) => `${candidate.candidateId} \u2014 ${candidate.displayName}${candidate.sourcePath === void 0 ? "" : ` (${candidate.sourcePath})`}`
            ).join("\n")
          }),
          ""
        );
        const selected = mapPreview.candidates.find(
          (candidate) => candidate.candidateId === choice?.trim()
        );
        if (selected !== void 0) {
          mapPreview = await prepareWebMapPreview({
            services,
            opened: ordinary,
            grant,
            budgets: budget,
            selectionId: selected.candidateId,
            localizer,
            ...signal === void 0 ? {} : { signal }
          });
        }
      }
      const result = mapPreview.opened;
      if (mapPreview.state === "permission-required") {
        say(t2("web.map.permissionRequired", { name: entry.name }));
      } else if (mapPreview.state === "selection-required") {
        say(
          t2("web.map.selectionRequired", {
            name: entry.name,
            candidates: mapPreview.candidates.map((candidate) => candidate.displayName).join(", ")
          })
        );
      }
      const boundary = result.diagnostics.some(
        (item) => item.code === "x3.host/worker-shared-process"
      ) ? "worker-brokered" : "unknown boundary";
      say(
        `${entry.name} \xB7 ${result.selected.contributionId}/${result.selected.variantId} \xB7 ${Math.round(result.selected.confidence * 100)}% \xB7 ${boundary}`
      );
      const session = result.session;
      const key2 = descriptorKey(result.descriptor);
      const actualSelectedRoute = nested?.selectedRoute ?? Object.freeze([selectedStep(result)]);
      selectedRoutes.set(key2, actualSelectedRoute);
      if (activeFormatSmokeCase !== void 0) {
        lastFormatSmokeOpen = Object.freeze({
          caseId: activeFormatSmokeCase,
          descriptor: result.descriptor,
          selectedRoute: actualSelectedRoute
        });
      }
      const presentation = await resolveCommonPresentationPlan(
        result.descriptor,
        {
          sessionId: `pwa:${key2}`,
          providerId: result.selected.contributionId,
          variantId: result.selected.variantId
        },
        { availableStageIds: stages.map(stageIdOf) }
      );
      const previewPresentation = (() => {
        const plan = presentation?.plan;
        if (activeFormatSmokeStage !== "tree" || !result.descriptor.dataSources.some(
          (source) => source.contract === "common.view/namespace-entry-source"
        ) || plan === void 0 || plan.activeStage === void 0 || plan.slots.some((slot) => slot.slotId === "archive")) {
          return plan;
        }
        return Object.freeze({
          ...plan,
          slots: Object.freeze([
            ...plan.slots,
            Object.freeze({
              slotId: "archive",
              kind: "stage",
              contributionId: result.selected.contributionId,
              extensionId: result.selected.extensionId,
              priority: 0,
              bindings: Object.freeze([
                Object.freeze({
                  bindingId: "content",
                  contract: "common.view/namespace-entry-source",
                  major: 1
                })
              ])
            })
          ]),
          alternateStages: Object.freeze([...plan.alternateStages, "archive"])
        });
      })();
      const operations = session.operations();
      let commandAuthority;
      if (nested === void 0 && access?.handleOf(entry.id) !== void 0) {
        try {
          commandAuthority = services.commands.authorize({
            access,
            entry,
            request: { intent: "full", grant, budget }
          });
        } catch (error) {
          say(
            t2("web.status.sharedCommandsUnavailable", { name: entry.name, reason: String(error) })
          );
        }
      }
      operationSessions.set(key2, operations);
      assetSessions.set(key2, result.session);
      if (result.rasterResources !== void 0) rasterResources.set(key2, result.rasterResources);
      openedEntries.set(entry.id, entry);
      entryOfDescriptor.set(key2, entry.id);
      let releaseWriter;
      if (writable) {
        const writerResolution = await resolveFormatWriter({
          services: services.main,
          opened: result,
          grant,
          budgets: budget
        });
        writerResolution.diagnostics.forEach((item) => say(`${entry.name} \u2014 ${item.message}`));
        releaseWriter = writerResolution.release;
        const editor = editing.editorFor({
          entryId: entry.id,
          name: entry.name,
          opened: result,
          grant,
          bytes,
          ...writerResolution.writer === void 0 ? {} : { writer: writerResolution.writer }
        });
        if (editor !== void 0) subjectEditors.set(entry.id, editor);
        else {
          await releaseWriter?.();
          releaseWriter = void 0;
        }
      }
      const decision = editability.get(entry.id);
      inspected.set(entry.id, {
        label: entry.name,
        descriptor: result.descriptor,
        operations,
        editable: subjectEditors.has(entry.id),
        ...decision === void 0 ? {} : { editNote: decision.sentence }
      });
      inspecting = void 0;
      inspect(entry.id);
      return {
        ...previewPresentation === void 0 ? {} : { presentation: previewPresentation },
        descriptor: () => session.descriptor(),
        /*
         * What a view lists of a container leaves hidden members out unless it asks
         * (`includeHidden`) — the one filter, as the host applies to a page it serves over subject
         * RPC. The app's own readers (extract, nested opens) use the session and see everything.
         */
        dataSource: async (contract, major) => {
          const lease = await session.dataSource(contract, major);
          return contract === "common.view/namespace-entry-source" ? {
            value: withoutHiddenEntries(lease.value),
            release: () => lease.release()
          } : lease;
        },
        async dispose() {
          operationSessions.delete(key2);
          assetSessions.delete(key2);
          rasterResources.delete(key2);
          selectedRoutes.delete(key2);
          entryOfDescriptor.delete(key2);
          inspected.delete(entry.id);
          openedEntries.delete(entry.id);
          subjectEditors.delete(entry.id);
          writableHandles.delete(sourceUriFor(entry.id));
          commandAuthority?.revoke();
          if (inspecting === entry.id) inspect(void 0);
          await releaseWriter?.();
          await session.dispose();
        }
      };
    }
  };
  const codecPreview = createCodecPreview({
    ...previewBase,
    /*
     * `openSession` above ran first and composed the subject's editing surface (or refused to);
     * this only hands out the half a stage needs. Asking the arm again here would compose a second
     * coordinator over the same file, and the tab's two edit paths would hold two grant snapshots.
     */
    editorPorts: (entry) => subjectEditors.get(entry.id)?.ports
  });
  const preview = {
    supported: codecPreview.supported,
    async open(container, entry, bytes, signal) {
      const decision = await describeEditability(access, entry.id, entry.name, localizer);
      const source = sourceUriFor(entry.id);
      const handle = access?.handleOf(entry.id);
      const editable = decision.editable && pinnedRevisions.has(entry.id);
      if (editable && isWritableHandle(handle)) writableHandles.set(source, handle);
      else writableHandles.delete(source);
      editability.set(entry.id, editable ? decision : { ...decision, editable: false });
      noteEditing(decision.sentence);
      return codecPreview.open(container, entry, bytes, signal);
    }
  };
  const editors = createEditorArea(document, {
    localizer,
    preview,
    async confirmClose(entry) {
      return window.confirm(t2("web.status.unsavedClose", { name: entry.name })) ? "discard" : "cancel";
    },
    async read(entry, signal) {
      const nested = pendingNested.get(entry.id);
      if (nested !== void 0) return nested.bytes;
      if (access === void 0) throw new Error("no folder or file is open");
      const snapshot = await access.snapshotOf(entry.id, signal);
      if (snapshot === void 0) pinnedRevisions.delete(entry.id);
      else pinnedRevisions.set(entry.id, sourceRevisionToken(snapshot));
      const size = access.sizeOf(entry.id) ?? entry.size;
      const maximumBytes = activeFormatSmokeCase === void 0 ? EXPLORER_MAXIMUM_BYTES : WEB_OFFLINE_RELEASE.maxArtifactBytes;
      if (size !== void 0 && size > maximumBytes) {
        throw new Error(
          `${entry.name} is ${(size / (1024 * 1024)).toFixed(1)} MiB, over the ${maximumBytes / (1024 * 1024)} MiB this host will read into memory`
        );
      }
      return access.read(entry.id, maximumBytes, signal);
    },
    onStatus(status) {
      say([status.path, status.view, status.detail].filter(Boolean).join(" \xB7 "));
      inspect(status.path);
      focused = status.path;
    }
  });
  markDirty = (entryId, dirty) => editors.markDirty(entryId, dirty);
  const recovery = createWebSessionRecovery({
    hasUnsaved: () => editors.hasUnsaved(),
    confirmDiscard: () => window.confirm(t2("confirm.discardAndRestart")),
    restart: async () => {
      await services.dispose();
      window.location.reload();
    },
    onState: (state) => {
      restartSession.hidden = state !== "worker-unavailable";
      if (state === "worker-unavailable") say(t2("status.workerUnavailable"));
    }
  });
  recoveryHost.current = recovery;
  for (const diagnostic2 of bootSessionDiagnostics) recovery.report(diagnostic2);
  restartSession.addEventListener("click", () => void recovery.restart());
  editors.root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset["mkPart"] !== "editor.text") return;
    if (focused !== void 0) editors.markDirty(focused, true);
  });
  const explorer = createExplorer(document, {
    localizer,
    preview,
    // The tree browses; the editor area owns what is open, so opening is delegated to it.
    onOpen(entry) {
      void editors.open(entry);
    },
    async openFolder() {
      const handle = await pickDirectory();
      if (handle === void 0) {
        say(capabilityNotice);
        return void 0;
      }
      access = createDirectoryAccess(handle, { onNotice: say });
      return access;
    }
  });
  const singlePane = explorer.root.querySelector('[data-mk-part="explorer.preview"]');
  if (singlePane === null) throw new Error("explorer has no preview pane to replace");
  singlePane.replaceWith(editors.root);
  const toolbar = explorer.root.querySelector('[data-mk-part="explorer.toolbar"]');
  const toolbarAction = (label, title, run) => {
    if (!(toolbar instanceof HTMLElement)) return;
    const button2 = element(toolbar, "button", {
      part: "explorer.action",
      text: label
    });
    button2.type = "button";
    button2.title = title;
    button2.addEventListener("click", run);
  };
  async function openFile(file, handle) {
    const picked = createSingleFileAccess(file, handle);
    access = picked.access;
    await explorer.setAccess(picked.access);
    await editors.open(picked.entry);
  }
  toolbarAction(t2("action.openFile"), t2("action.openFileTitle"), () => {
    void (async () => {
      try {
        const picked = await pickFile();
        if (picked !== void 0) await openFile(picked.file, picked.handle);
      } catch (error) {
        say(t2("error.openFile", { reason: describe2(error) }));
      }
    })();
  });
  toolbarAction(t2("action.splitEditor"), t2("action.splitEditorTitle"), () => editors.split());
  toolbarAction(t2("action.enableEditing"), t2("action.enableEditingTitle"), () => {
    void (async () => {
      const asked = await requestWriteAccess(access, localizer);
      say(asked.sentence);
      noteEditing(asked.sentence);
    })();
  });
  const stopEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  editors.root.addEventListener("dragover", (event) => {
    stopEvent(event);
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    setState(editors.root, ["drop-target"]);
  });
  editors.root.addEventListener("dragleave", (event) => {
    stopEvent(event);
    setState(editors.root, []);
  });
  editors.root.addEventListener("drop", (event) => {
    stopEvent(event);
    setState(editors.root, []);
    const file = event.dataTransfer?.files[0];
    if (file === void 0) return;
    void openFile(file).catch((error) => say(t2("error.drop", { reason: describe2(error) })));
  });
  const settingsUi = createSettingsUi(document, {
    localizer,
    store: settingsStore,
    themes: appThemes,
    onAppearance(appearance) {
      applyAppearance(document.documentElement, appearance);
    },
    onChange(document2) {
      settingsDocument = document2;
    },
    onClose() {
      showView("explorer");
    }
  });
  function bundledExtensionsSection() {
    const section = document.createElement("section");
    section.className = "web-extensions";
    element(section, "h2", { text: t2("settings.bundled") });
    element(section, "p", {
      part: "settings.description",
      text: t2("settings.bundledDescription", {
        count: WEB_EXTENSION_CATALOG.extensions.length,
        reason: EXTENSIONS_READ_ONLY_REASON
      })
    });
    const list = element(section, "div", { part: "settings.list" });
    for (const entry of WEB_EXTENSION_CATALOG.extensions) {
      const item = element(list, "div", { part: "settings.extension" });
      const text = element(item, "div", { part: "settings.extension-text" });
      element(text, "div", { part: "settings.label", text: entry.name });
      element(text, "div", { part: "settings.description", text: entry.artifactRoot });
    }
    if (WEB_EXTENSION_CATALOG.excluded.length > 0) {
      element(section, "h2", { text: t2("settings.bundledExcluded") });
      const excluded = element(section, "div", { part: "settings.list" });
      for (const entry of WEB_EXTENSION_CATALOG.excluded) {
        const item = element(excluded, "div", { part: "settings.extension" });
        const text = element(item, "div", { part: "settings.extension-text" });
        element(text, "div", { part: "settings.label", text: entry.name });
        element(text, "div", { part: "settings.description", text: entry.reason });
      }
    }
    return section;
  }
  const settingsView = document.createElement("div");
  settingsView.className = "web-settings-view";
  settingsView.append(settingsUi.root, extensionsUi.root, bundledExtensionsSection());
  await settingsUi.reload();
  const sidebar = document.createElement("div");
  sidebar.className = "web-host-panel";
  element(sidebar, "h2", { text: t2("sidebar.host") });
  element(sidebar, "p", {
    part: "settings.description",
    text: t2("sidebar.hostSummary", {
      extensions: services.main.inventory.extensions.length,
      types: services.supportedExtensions.length,
      profiles: services.executionProfiles.join("/"),
      realm: services.worker.profile.realmId,
      sharedMemory: t2(probe.sharedMemory ? "common.yes" : "common.no")
    })
  });
  element(sidebar, "p", { part: "settings.description", text: capabilityNotice });
  element(sidebar, "p", { part: "settings.description", text: t2("web.editing.notice") });
  sidebar.append(editingStatus);
  element(sidebar, "h2", { text: t2("sidebar.facilities") });
  const facilities = element(sidebar, "ul", { part: "settings.list" });
  for (const facility of services.main.profile.facilities) {
    element(facilities, "li", { text: facility });
  }
  element(sidebar, "h2", { text: t2("sidebar.samples") });
  const sampleList = element(sidebar, "div", { part: "settings.list" });
  for (const sample of SAMPLES) {
    const button2 = element(sampleList, "button", {
      part: "explorer.action",
      text: t2(sample.labelKey)
    });
    button2.type = "button";
    button2.addEventListener("click", () => {
      void openServed(sample.path).catch((error) => say(describe2(error)));
    });
  }
  element(sidebar, "h2", { text: t2("sidebar.language") });
  const localePicker = element(sidebar, "select", {
    part: "settings.select"
  });
  for (const candidate of ["en", "ru"]) {
    const option = document.createElement("option");
    option.value = candidate;
    setViewerText(option, t2(`locale.${candidate}`));
    localePicker.append(option);
  }
  localePicker.value = locale;
  localePicker.setAttribute("aria-label", t2("sidebar.language"));
  localePicker.addEventListener("change", () => {
    const target = new URL(window.location.href);
    target.searchParams.set("lang", localePicker.value);
    window.location.assign(target.href);
  });
  workbench.setSidebar(sidebar);
  let activeView = "explorer";
  function showView(name) {
    activeView = name;
    workbench.setMain(name === "explorer" ? explorer.root : settingsView);
    if (name === "settings") void settingsUi.reload();
    for (const node of workbench.activitybar.querySelectorAll("button")) {
      node.setAttribute("aria-pressed", String(node.dataset["view"] === name));
    }
  }
  const activity = (label, title, run, view) => {
    const button2 = document.createElement("button");
    button2.type = "button";
    button2.textContent = label;
    button2.title = title;
    button2.setAttribute("aria-label", title);
    if (view !== void 0) button2.dataset["view"] = view;
    button2.addEventListener("click", run);
    workbench.activitybar.append(button2);
  };
  activity(t2("activity.files"), t2("activity.explorer"), () => showView("explorer"), "explorer");
  activity(t2("activity.host"), t2("activity.hostTitle"), () => {
    workbench.sidebar.hidden = !workbench.sidebar.hidden;
  });
  activity(t2("activity.info"), t2("activity.infoTitle"), () => {
    workbench.panel.hidden = !workbench.panel.hidden;
  });
  activity(t2("activity.settings"), t2("activity.settings"), () => showView("settings"), "settings");
  workbench.panel.hidden = true;
  workbench.sidebar.hidden = false;
  showView("explorer");
  await inspector.show(void 0);
  say(
    t2("status.ready", {
      extensions: services.main.inventory.extensions.length,
      notices: bootDiagnostics.length
    })
  );
  async function openServed(path) {
    const file = await fetchServed(baseUrl, path);
    if (file === void 0) {
      say(t2("error.fetch", { path }));
      return;
    }
    if (activeView !== "explorer") showView("explorer");
    await openFile(file);
  }
  const digestBytes = async (bytes) => {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  };
  const verifiedCorpus = async (testCase, bytes) => {
    const expectedBytes = testCase.corpus.bytes;
    const expectedSha256 = testCase.corpus.sha256;
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes === void 0 || expectedBytes < 0 || typeof expectedSha256 !== "string") {
      throw new TypeError(`${testCase.id} has no generated corpus identity`);
    }
    const sha2562 = await digestBytes(bytes);
    if (bytes.byteLength !== expectedBytes || sha2562 !== expectedSha256) {
      throw new TypeError(`${testCase.id} corpus does not match the generated identity`);
    }
    return Object.freeze({ bytes: bytes.byteLength, sha256: sha2562, verifiedBeforeOpen: true });
  };
  const namespaceEntry = async (descriptor, entryPath) => {
    const key2 = descriptorKey(descriptor);
    const parent = assetSessions.get(key2);
    const operations = operationSessions.get(key2);
    if (parent === void 0 || operations === void 0) {
      throw new TypeError("the opened container session is unavailable");
    }
    const extract = descriptor.operations.find(
      (operation) => operation.state === "available" && !operation.mutatesSource && operation.id === CONTAINER_EXTRACT_OPERATION_ID
    );
    if (extract === void 0) throw new TypeError("the opened container has no extract operation");
    const lease = await parent.dataSource("common.view/namespace-entry-source", 1);
    const source = lease.value;
    const target = entryPath.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
    try {
      let found;
      const basename = target.slice(target.lastIndexOf("/") + 1);
      if (source.search !== void 0) {
        let cursor2;
        for (let page = 0; page < 100 && found === void 0; page += 1) {
          const answer = await source.search(
            { kind: "basename-any", basenames: [basename], caseSensitive: true },
            { limit: 200, ...cursor2 === void 0 ? {} : { cursor: cursor2 } }
          );
          found = answer.items.find((item) => item.path.replaceAll("\\", "/") === target);
          cursor2 = answer.nextCursor;
          if (cursor2 === void 0) break;
        }
      }
      if (found === void 0) {
        let cursor2;
        for (let page = 0; page < 1e3 && found === void 0; page += 1) {
          const answer = await source.list("", {
            limit: 200,
            ...cursor2 === void 0 ? {} : { cursor: cursor2 }
          });
          found = answer.items.find((item) => item.path.replaceAll("\\", "/") === target);
          cursor2 = answer.nextCursor;
          if (cursor2 === void 0) break;
        }
      }
      if (found === void 0) {
        let prefix = "";
        for (const segment of target.split("/")) {
          let cursor2;
          let next;
          const wanted = prefix === "" ? segment : `${prefix}/${segment}`;
          for (let page = 0; page < 100 && next === void 0; page += 1) {
            const answer = await source.list(prefix, {
              limit: 200,
              ...cursor2 === void 0 ? {} : { cursor: cursor2 }
            });
            next = answer.items.find((item) => item.path.replaceAll("\\", "/") === wanted);
            cursor2 = answer.nextCursor;
            if (cursor2 === void 0) break;
          }
          if (next === void 0) break;
          prefix = wanted;
          if (wanted === target) found = next;
        }
      }
      if (found === void 0) throw new TypeError("the generated container member is absent");
      const read = await operations.invoke(extract.handlerId, { entryId: found.id }, {});
      if (read.state !== "ok" || read.output.kind !== "bytes") {
        throw new TypeError("the container refused to extract the generated member");
      }
      return Object.freeze({ id: found.id, bytes: read.output.value.slice() });
    } finally {
      await lease.release();
    }
  };
  const activeEditorGroup = () => {
    const active = editors.root.querySelector(
      '[data-mk-part="explorer.group"][data-mk-state~="active"]'
    );
    return active instanceof HTMLElement ? active : editors.root;
  };
  const visibleInGroup = (group, selector) => [...group.querySelectorAll(selector)].find(
    (node) => node.closest('[data-mk-part="explorer.tabcontent"]')?.hasAttribute("hidden") !== true
  );
  const visibleCount = (group, selector) => [...group.querySelectorAll(selector)].filter(
    (node) => node.closest('[data-mk-part="explorer.tabcontent"]')?.hasAttribute("hidden") !== true
  ).length;
  const waitForStage = async (test) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      if (test()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!test())
      throw new TypeError("the selected preview stage did not reach a terminal DOM state");
  };
  const selectFormatSmokeStage = async (id, ready) => {
    const group = activeEditorGroup();
    const picker = group.querySelector('[data-mk-part="explorer.viewpicker"]');
    if (!(picker instanceof HTMLSelectElement))
      throw new TypeError("the active tab has no stage picker");
    if (![...picker.options].some((option) => option.value === id)) {
      throw new TypeError(
        `the actual descriptor did not offer stage ${id}; available=${[...picker.options].map((option) => option.value).join(",")}`
      );
    }
    picker.value = id;
    picker.dispatchEvent(new Event("change"));
    await waitForStage(() => picker.value === id && ready());
    return group;
  };
  const hasFormatSmokeStage = (id) => {
    const picker = activeEditorGroup().querySelector('[data-mk-part="explorer.viewpicker"]');
    return picker instanceof HTMLSelectElement && [...picker.options].some((option) => option.value === id);
  };
  const metadataEntryCount = async () => {
    const group = await selectFormatSmokeStage(
      "metadata",
      () => visibleInGroup(activeEditorGroup(), '[data-mk-part="metadata.row"]') !== void 0
    );
    return visibleCount(group, '[data-mk-part="metadata.row"]');
  };
  const observeFormatSmokeStage = async (expected) => {
    if (expected === "raster") {
      const group2 = await selectFormatSmokeStage("image", () => {
        const node = visibleInGroup(activeEditorGroup(), '[data-mk-part="image.canvas"]');
        return node instanceof HTMLCanvasElement && node.width > 0 && node.height > 0;
      });
      const canvas2 = visibleInGroup(group2, '[data-mk-part="image.canvas"]');
      const readout = visibleInGroup(group2, '[data-mk-part="image.readout"]');
      const metadataEntries2 = (readout?.textContent ?? "").trim() === "" ? 0 : 1;
      const sample = document.createElement("canvas");
      sample.width = Math.min(canvas2.width, 64);
      sample.height = Math.min(canvas2.height, 64);
      const context = sample.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new TypeError("the browser has no readable raster canvas");
      context.drawImage(canvas2, 0, 0, sample.width, sample.height);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      let opaquePixels = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if ((pixels[index] ?? 0) > 0) opaquePixels += 1;
      }
      return Object.freeze({
        kind: "raster",
        width: canvas2.width,
        height: canvas2.height,
        opaquePixels,
        // The image stage's actual codec-backed dimension/byte readout is raster metadata. Some
        // image descriptors intentionally publish no separate descriptor metadata groups.
        metadataEntries: metadataEntries2
      });
    }
    if (expected === "tree-text") {
      const treeGroup = await selectFormatSmokeStage(
        "tree",
        () => visibleInGroup(activeEditorGroup(), '[data-mk-part="tree.item"]') !== void 0
      );
      const treeNodes = visibleCount(treeGroup, '[data-mk-part="tree.item"]');
      const textCharacters = (visibleInGroup(treeGroup, '[data-mk-part="tree.list"]')?.textContent ?? "").trim().length;
      return Object.freeze({ kind: "tree-text", treeNodes, textCharacters });
    }
    if (expected === "tree") {
      if (!hasFormatSmokeStage("archive")) {
        const group3 = await selectFormatSmokeStage(
          "tree",
          () => visibleInGroup(activeEditorGroup(), '[data-mk-part="tree.item"]') !== void 0
        );
        return Object.freeze({
          kind: "tree",
          treeNodes: visibleCount(group3, '[data-mk-part="tree.item"]')
        });
      }
      const group2 = await selectFormatSmokeStage(
        "archive",
        () => visibleInGroup(activeEditorGroup(), '[data-mk-part="namespace.item"]') !== void 0
      );
      return Object.freeze({
        kind: "tree",
        treeNodes: visibleCount(group2, '[data-mk-part="namespace.item"]')
      });
    }
    if (expected === "metadata-tree") {
      const metadataEntries2 = await metadataEntryCount();
      const group2 = await selectFormatSmokeStage(
        "tree",
        () => visibleInGroup(activeEditorGroup(), '[data-mk-part="tree.item"]') !== void 0
      );
      return Object.freeze({
        kind: "metadata-tree",
        metadataEntries: metadataEntries2,
        treeNodes: visibleCount(group2, '[data-mk-part="tree.item"]')
      });
    }
    const modelCanvas = (root) => {
      const node = visibleInGroup(root, '[data-mk-part="model.canvas"][data-model-renderer]');
      return node instanceof HTMLCanvasElement && node.width > 0 && node.height > 0 ? node : void 0;
    };
    const group = await selectFormatSmokeStage(
      "model",
      () => modelCanvas(activeEditorGroup()) !== void 0
    );
    const canvas = modelCanvas(group);
    return Object.freeze({
      kind: "model-or-wireframe",
      renderer: canvas.getAttribute("data-model-renderer") ?? "wireframe",
      rendererStatus: canvas.getAttribute("data-model-renderer-status") ?? "unavailable",
      ...canvas.getAttribute("data-model-renderer-id") === null ? {} : { rendererId: canvas.getAttribute("data-model-renderer-id") },
      width: canvas.width,
      height: canvas.height
    });
  };
  const openFormatSmokeCase = async (testCase, corpusUrl) => {
    const url = new URL(corpusUrl, window.location.href);
    if (url.origin !== window.location.origin) {
      throw new TypeError("format smoke corpus must be served from this PWA origin");
    }
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new TypeError("format smoke corpus request failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const name = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
    if (name === "") throw new TypeError("format smoke corpus URL has no filename");
    const currentFormatSmokeOpen = () => lastFormatSmokeOpen;
    activeFormatSmokeCase = testCase.id;
    activeFormatSmokeStage = testCase.stage;
    lastFormatSmokeOpen = void 0;
    lastFormatSmokeHostFailure = void 0;
    lastFormatSmokeCandidates = void 0;
    try {
      if (testCase.corpus.kind === "warzone-wz-entry") {
        await openFile(
          new File([bytes], name, { type: response.headers.get("content-type") ?? "" })
        );
        const parent = currentFormatSmokeOpen();
        if (parent === void 0 || parent.caseId !== testCase.id) {
          throw new TypeError("the generated container did not open");
        }
        if (JSON.stringify(parent.selectedRoute) !== JSON.stringify(testCase.route.slice(0, 1))) {
          console.warn(
            `[format-smoke] ${testCase.id} parent route candidates=${lastFormatSmokeCandidates ?? "unavailable"}`
          );
        }
        const entryPath = testCase.corpus.path;
        if (typeof entryPath !== "string") throw new TypeError("the generated entry path is absent");
        const entry = await namespaceEntry(parent.descriptor, entryPath);
        const corpus2 = await verifiedCorpus(testCase, entry.bytes);
        const problem = await openNestedEntry(parent.descriptor, entry.id, entryPath, entry.bytes);
        if (problem !== void 0) throw new TypeError("the nested subject did not open");
        const child = currentFormatSmokeOpen();
        if (child === void 0 || child.caseId !== testCase.id) {
          throw new TypeError("the generated nested subject did not become active");
        }
        return Object.freeze({
          selectedRoute: child.selectedRoute,
          corpus: corpus2,
          stage: await observeFormatSmokeStage(testCase.stage)
        });
      }
      const corpus = await verifiedCorpus(testCase, bytes);
      await openFile(new File([bytes], name, { type: response.headers.get("content-type") ?? "" }));
      const opened = currentFormatSmokeOpen();
      if (opened === void 0 || opened.caseId !== testCase.id) {
        throw new TypeError(
          `the real browser host did not open the generated corpus: ${lastFormatSmokeHostFailure ?? "no opened result"}`
        );
      }
      if (JSON.stringify(opened.selectedRoute) !== JSON.stringify(testCase.route)) {
        console.warn(
          `[format-smoke] ${testCase.id} route candidates=${lastFormatSmokeCandidates ?? "unavailable"}`
        );
      }
      return Object.freeze({
        selectedRoute: opened.selectedRoute,
        corpus,
        stage: await observeFormatSmokeStage(testCase.stage)
      });
    } finally {
      activeFormatSmokeCase = void 0;
      activeFormatSmokeStage = void 0;
    }
  };
  const openFormatSmokeHostOnlySource = async (testCase) => {
    const terminal = testCase.route.at(-1);
    if (testCase.runtime.pwa.kind !== "host-facility-refusal" || testCase.corpus.kind !== "sc2-casc-entry" || typeof testCase.corpus.path !== "string" || typeof testCase.corpus.sha256 !== "string" || typeof testCase.corpus.bytes !== "number" || testCase.route[0]?.formatId !== "casc" || terminal === void 0) {
      throw new TypeError("the generated case is not an SC2/CASC source-open request");
    }
    return services.sourceOpen.openSc2CascEntry({
      requestId: testCase.id,
      source: {
        kind: testCase.corpus.kind,
        entryPath: testCase.corpus.path,
        contentSha256: testCase.corpus.sha256,
        bytes: testCase.corpus.bytes
      },
      requestedFormatId: terminal.formatId
    });
  };
  if (pageUrl.searchParams.has("format-smoke")) {
    const loaded = await loadPwaFormatSmokeAuthority(
      new URL("./format-smoke.v1.json", document.baseURI).href,
      "sha256:12566f83c72c8cebbce17f42c8e6b554d0790a683d0dba750ac24f896c1c06ac"
    );
    const control = createPwaFormatSmokeAcceptance({
      authority: loaded.authority,
      authoritySha256: loaded.sha256,
      bridge: {
        async preparePackages(ids) {
          let changed = false;
          let model = await managedExtensions.refreshCatalog();
          for (const id of ids) {
            const row = model.rows.find((candidate) => candidate.id === id);
            if (row === void 0)
              throw new TypeError("the signed catalog lacks an expected package");
            if (!row.installed) {
              model = await managedExtensions.install(id);
              changed = true;
            } else if (row.updateAvailable) {
              model = await managedExtensions.update(id);
              changed = true;
            } else if (!row.enabled) {
              model = await managedExtensions.enable(id, true);
              changed = true;
            }
          }
          return Object.freeze({ reloadRequired: changed });
        },
        async runtimeIdentity() {
          const packages = await managedStorage.list();
          const countedCoordinates = /* @__PURE__ */ new Set([
            ...catalogCoordinates(WEB_EXTENSION_CATALOG),
            ...managedRoots.coordinates
          ]);
          return Object.freeze({
            offlineCatalogSha256: WEB_OFFLINE_RELEASE.catalogSha256,
            loadedManagedRoots: Object.freeze([...managedRoots.coordinates]),
            codecContributionCount: services.main.inventory.extensions.reduce(
              (count, extension) => count + (countedCoordinates.has(`${extension.manifest.publisher}/${extension.manifest.id}`) ? extension.contributions.filter(
                (contribution) => contribution.manifest?.contract.id === "modkit/codec-contribution"
              ).length : 0),
              0
            ),
            packages: Object.freeze(
              packages.map(
                (item) => Object.freeze({
                  id: item.id,
                  version: item.version,
                  digest: item.digest,
                  enabled: item.enabled
                })
              )
            )
          });
        },
        open: openFormatSmokeCase,
        openHostOnlySource: openFormatSmokeHostOnlySource,
        reportFailure: (caseId, error) => console.warn(`[format-smoke] ${caseId}`, error)
      }
    });
    Object.defineProperty(globalThis, "__MODKIT_FORMAT_SMOKE__", {
      configurable: true,
      enumerable: false,
      value: control
    });
    Object.defineProperty(globalThis, "__MODKIT_ACCEPTANCE__", {
      configurable: true,
      enumerable: false,
      get: () => control.receipt()
    });
  }
  const requested = pageUrl.searchParams.get("open");
  if (requested !== null) await openServed(requested);
  async function probeEditing(log) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
    const until = async (test) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (test()) return true;
        await settle();
      }
      return test();
    };
    const memoryFile = (name, text) => {
      let content = encoder.encode(text);
      let modified = 1e3;
      const handle = {
        kind: "file",
        name,
        async getFile() {
          const held = content;
          return {
            name,
            size: held.byteLength,
            lastModified: modified,
            slice: (start, end) => ({
              async arrayBuffer() {
                const part = held.slice(start, end);
                const copy = new ArrayBuffer(part.byteLength);
                new Uint8Array(copy).set(part);
                return copy;
              }
            })
          };
        },
        async createWritable() {
          const chunks = [];
          return {
            async write(data) {
              chunks.push(data.slice());
            },
            async close() {
              const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
              const next = new Uint8Array(total);
              let at = 0;
              for (const chunk of chunks) {
                next.set(chunk, at);
                at += chunk.byteLength;
              }
              content = next;
              modified += 1;
            }
          };
        },
        async queryPermission() {
          return "granted";
        },
        async requestPermission() {
          return "granted";
        }
      };
      return {
        handle,
        entry: { id: name, name, directory: false, size: content.byteLength },
        text: () => decoder.decode(content),
        size: () => content.byteLength,
        modified: () => modified
      };
    };
    const first = memoryFile("selftest-text.csv", "a,b\n1,2\n");
    const second = memoryFile("selftest-hex.csv", "a,b\n3,4\n");
    const files = [first, second];
    const byId = new Map(files.map((file) => [file.entry.id, file]));
    const memory = {
      label: "in-memory grant",
      writeGrant: first.handle,
      async list(entryId) {
        return entryId === void 0 ? files.map((file) => file.entry) : [];
      },
      sizeOf: (entryId) => byId.get(entryId)?.size(),
      handleOf: (entryId) => byId.get(entryId)?.handle,
      async snapshotOf(entryId) {
        const file = byId.get(entryId);
        return file === void 0 ? void 0 : { size: file.size(), lastModified: file.modified() };
      },
      async read(entryId) {
        const file = byId.get(entryId);
        if (file === void 0) throw new TypeError(`${entryId} is not in the memory grant`);
        return encoder.encode(file.text());
      }
    };
    const group = () => {
      const active = editors.root.querySelector(
        '[data-mk-part="explorer.group"][data-mk-state~="active"]'
      );
      return active instanceof HTMLElement ? active : editors.root;
    };
    const picker = () => {
      const node = group().querySelector('[data-mk-part="explorer.viewpicker"]');
      return node instanceof HTMLSelectElement ? node : void 0;
    };
    const visible = (node) => node.closest('[data-mk-part="explorer.tabcontent"]')?.hasAttribute("hidden") !== true;
    const saveButton = () => [...group().querySelectorAll("button")].find(
      (button2) => button2.textContent === "Save" && visible(button2)
    );
    const inStage = (part) => [...group().querySelectorAll(`[data-mk-part="${part}"]`)].find(visible);
    const showView2 = async (id) => {
      const select = picker();
      if (select === void 0 || ![...select.options].some((option) => option.value === id)) {
        log(`selftest: ${id} was not offered for the focused tab`);
        return false;
      }
      select.value = id;
      select.dispatchEvent(new Event("change"));
      await settle();
      return true;
    };
    access = memory;
    await explorer.setAccess(memory);
    await editors.open(first.entry);
    await settle();
    const views = [...picker()?.options ?? []].map((option) => option.value);
    log(`selftest: writable file offers [${views.join(", ")}]`);
    log(`selftest: editing line says "${editingStatus.textContent ?? ""}"`);
    if (await showView2("text-editor")) {
      const area = inStage("editor.text");
      if (area instanceof HTMLTextAreaElement) {
        area.value = "a,b\n9,9\n";
        area.dispatchEvent(new Event("input", { bubbles: true }));
        const tab = [...group().querySelectorAll('[data-mk-part="explorer.filetab"]')].find(
          (node) => node.getAttribute("title") === first.entry.id
        );
        log(`selftest: tab state after typing = ${tab?.getAttribute("data-mk-state") ?? "none"}`);
        saveButton()?.click();
        await until(() => first.text() === "a,b\n9,9\n");
        log(`selftest: text save wrote ${JSON.stringify(first.text())}`);
        log(`selftest: after text save "${editingStatus.textContent ?? ""}"`);
      } else {
        log("selftest: the text editor mounted no textarea");
      }
    }
    await editors.open(second.entry);
    await settle();
    if (await showView2("hex-editor")) {
      const cell = inStage("hex.cell");
      if (cell instanceof HTMLElement) {
        cell.textContent = "5a";
        cell.dispatchEvent(new Event("blur"));
        await settle();
        saveButton()?.click();
        await until(() => second.text().startsWith("Z"));
        log(`selftest: hex save wrote ${JSON.stringify(second.text())}`);
      } else {
        log("selftest: the hex editor mounted no cells");
      }
      const again = [...group().querySelectorAll('[data-mk-part="hex.cell"]')].filter(visible)[1];
      if (again instanceof HTMLElement) {
        again.textContent = "59";
        again.dispatchEvent(new Event("blur"));
        await settle();
        saveButton()?.click();
        await until(() => (editingStatus.textContent ?? "").includes("changed on disk"));
        log(`selftest: second save from a stale tab -> "${editingStatus.textContent ?? ""}"`);
        log(`selftest: file is still ${JSON.stringify(second.text())}`);
      }
    }
  }
  if (pageUrl.searchParams.get("selftest") !== null) {
    await selfTest({ openServed, editors, settingsView, inspector, probeEditing });
  }
}
async function selfTest(parts) {
  const report = document.createElement("pre");
  setPart(report, "viewer.status");
  report.className = "web-selftest";
  document.body.append(report);
  const lines = [];
  const log = (line) => {
    console.info(line);
    lines.push(line);
    report.textContent = lines.join("\n");
  };
  const picker = () => {
    const node = parts.editors.root.querySelector('[data-mk-part="explorer.viewpicker"]');
    return node instanceof HTMLSelectElement ? node : void 0;
  };
  const mountedPart = () => parts.editors.root.querySelector('[data-mk-part="explorer.tabcontent"] [data-mk-part]') !== null;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  for (const sample of SAMPLES) {
    const name = sample.path.split("/").pop() ?? sample.path;
    try {
      await parts.openServed(sample.path);
      await settle();
      const select = picker();
      const options = select === void 0 ? [] : [...select.options];
      const views = options.map((option) => option.textContent ?? option.value);
      let mounted = mountedPart();
      for (const option of options) {
        if (select === void 0) break;
        select.value = option.value;
        select.dispatchEvent(new Event("change"));
        await settle();
        const ok = mountedPart();
        mounted = mounted && ok;
        log(`selftest: ${name} view ${option.value} mounted=${ok}`);
      }
      log(`selftest: ${name} -> views [${views.join(", ")}] mounted=${mounted}`);
    } catch (error) {
      log(`selftest: ${name} -> FAILED ${describe2(error)}`);
    }
  }
  const tabs = parts.editors.root.querySelectorAll('[data-mk-part="explorer.filetab"]').length;
  parts.editors.split();
  log(`selftest: ${tabs} tab(s) open, groups=${parts.editors.groupCount}`);
  const groups = parts.settingsView.querySelectorAll('[data-mk-part="settings.group"]').length;
  const themes = parts.settingsView.querySelectorAll('[data-mk-part="settings.select"] option');
  log(`selftest: settings groups=${groups} appearance options=${themes.length}`);
  const operations = parts.inspector.root.querySelectorAll(
    '[data-mk-part="operations.button"]'
  ).length;
  const diagnostics = parts.inspector.root.querySelectorAll(
    '[data-mk-part="diagnostics.group"]'
  ).length;
  log(`selftest: inspector operations=${operations} diagnosticGroups=${diagnostics}`);
  const editable = [...picker()?.options ?? []].some((option) => option.value.endsWith("-editor"));
  log(`selftest: editable stages for a fetched sample=${editable} (expected false: no handle)`);
  try {
    await parts.probeEditing(log);
  } catch (error) {
    log(`selftest: editing probe FAILED ${describe2(error)}`);
  }
  for (const theme of readAppThemeChoices(document)) {
    document.documentElement.setAttribute("data-mk-theme", theme.id);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--mk-color-accent").trim();
    log(`selftest: theme ${theme.id} accent ${accent}`);
  }
  document.documentElement.setAttribute("data-mk-theme", "modkit-dark");
  log("selftest: done");
}
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch (error) {
    console.warn("service worker registration failed", error);
  }
}
boot().then(registerServiceWorker).catch((error) => {
  const node = requireRoot();
  node.replaceChildren();
  const failure2 = document.createElement("p");
  failure2.className = "booting";
  failure2.textContent = createWebLocalizer(navigator.languages).text("web.status.bootFailed", {
    reason: describe2(error)
  });
  node.append(failure2);
});
