import {
  DEFAULT_UI_LOCALIZER,
  EXPLORER_MAXIMUM_BYTES,
  EXTENSION_ROOT_FAILURE_CODES,
  MAP_PREVIEW_COORDINATOR_LIMITS,
  SubjectNavigationHistory,
  ViewerMountScope,
  WEB_EXTENSION_CATALOG,
  WEB_SOURCE_FACILITY_UNAVAILABLE,
  WEB_SOURCE_FILESYSTEM_READ_RANDOM,
  WEB_SOURCE_OPEN_BOUNDARY,
  catalogCoordinates,
  combineLoadedExtensionRoots,
  containerCoordinate,
  contributionContractLabel,
  coordinateMapPreviewAssetSession,
  createBrowserExtensionManager,
  createCodecPreview,
  createDirectoryAccess,
  createEditorArea,
  createExplorer,
  createIndexedDbExtensionStore,
  createManagedExtensionsController,
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
  isKnowledgeTarget,
  isWritableHandle,
  loadManagedExtensionRoots,
  loadSubjectCandidatePage,
  loadSubjectCardSections,
  loadUserExtensionRoots,
  loadWebLocalizationCatalogs,
  mountWebWorkbench,
  nestedSubjectServices,
  normalizeModkitIdentifier,
  openNestedSubject,
  presentationSlotId,
  probeWebFacilities,
  requestUserExtensionPermission,
  requestWriteAccess,
  resolveCommonPresentationPlan,
  resolveFormatWriter,
  resolveModelViewerTextures,
  resolveModuleMap,
  revisionId,
  setPart,
  setState,
  setViewerText,
  sourceRevisionToken,
  sourceUriFor,
  stageIdOf,
  subjectFactsSourceFromWire,
  webExtensionSubjectCardBundle,
  withMapPreviewSources,
  withoutHiddenEntries
} from "./chunks/chunk-JHU4IH6M.js";
import {
  CONTAINER_EXTRACT_OPERATION_ID,
  compareUtf8,
  diagnostic,
  isModkitError,
  isQualifiedId
} from "./chunks/chunk-GIVBAOHY.js";
import "./chunks/chunk-6SH3B5XL.js";
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
    text(key, values = {}) {
      const message = messages[key] ?? key;
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
    text(key, values = {}) {
      const translated = localizer.text(key, values);
      return translated === key ? fallback.text(key, values) : translated;
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
  for (const failure of [...input.loaded.failures, ...input.extraFailures ?? []]) {
    const label = labels.get(failure.rootId) ?? failure.root;
    rows.push({
      kind: "user",
      state: failure.code === EXTENSION_ROOT_FAILURE_CODES.permissionRequired ? "needs-permission" : "failed",
      rootId: failure.rootId,
      label,
      provenance: userProvenance(label, localizer),
      code: failure.code,
      detail: failure.message
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
        const failure = probe.failures[0];
        if (failure !== void 0) {
          status = `${handle.name}: ${failure.message} (${failure.code})`;
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
var positive = (value, label) => {
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
    this.#pageSize = positive(options.pageSize ?? 64, "pageSize");
    this.#maximum = positive(options.maximum ?? 512, "maximum");
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
    const cursor = this.#nextCursor;
    if (cursor === void 0 || this.#items.length >= this.#maximum) return this.snapshot();
    if (this.#seenCursors.has(cursor)) throw new Error("subject selector repeated a page cursor");
    this.#seenCursors.add(cursor);
    return this.#load(this.#generation, cursor);
  }
  async #load(generation, cursor) {
    this.#signal?.throwIfAborted();
    const remaining = this.#maximum - (cursor === void 0 ? 0 : this.#items.length);
    if (remaining < 1) return this.snapshot();
    this.#loading = true;
    try {
      const result = await loadSubjectCandidatePage(
        this.#provider,
        {
          target: this.#target,
          text: this.#text,
          ...cursor === void 0 ? {} : { cursor },
          limit: Math.min(this.#pageSize, remaining)
        },
        this.#signal
      );
      if (generation !== this.#generation) return this.snapshot();
      if (this.#summary !== void 0 && this.#summary.snapshotId !== result.summary.snapshotId) {
        throw new Error("subject selector snapshot changed between pages");
      }
      const prior = cursor === void 0 ? [] : this.#items;
      const ids = new Set(prior.map((item) => item.subjectId));
      if (result.page.items.some((item) => ids.has(item.subjectId))) {
        throw new Error("subject selector repeated a candidate between pages");
      }
      if (result.page.nextCursor !== void 0 && result.page.nextCursor === cursor) {
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
var object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var onlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
var nonEmptyString = (value) => typeof value === "string" && value.length > 0;
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
var validStringArray = (value) => Array.isArray(value) && value.every(nonEmptyString);
function validJsonSchemaRef(value) {
  return object(value) && onlyKeys(value, ["$ref", "document"]) && nonEmptyString(value["$ref"]) && (value["document"] === void 0 || validJson(value["document"]));
}
function validSubjectFilter(value) {
  if (!object(value) || !onlyKeys(value, ["type", "sameTypeAs", "text", "requireTags", "excludeTags", "predicate"]))
    return false;
  if (value["type"] !== void 0 && !nonEmptyString(value["type"])) return false;
  if (value["sameTypeAs"] !== void 0 && !nonEmptyString(value["sameTypeAs"])) return false;
  if (value["text"] !== void 0 && typeof value["text"] !== "string") return false;
  if (value["requireTags"] !== void 0 && !validStringArray(value["requireTags"])) return false;
  if (value["excludeTags"] !== void 0 && !validStringArray(value["excludeTags"])) return false;
  if (value["predicate"] !== void 0) {
    const predicate = value["predicate"];
    if (!object(predicate) || !onlyKeys(predicate, ["id", "params"]) || !nonEmptyString(predicate["id"]) || predicate["params"] !== void 0 && !validJson(predicate["params"]))
      return false;
  }
  return true;
}
function validFieldSchema(value, depth) {
  return object(value) && onlyKeys(value, ["key", "label", "type", "cardinality", "description", "knowledgeTarget"]) && nonEmptyString(value["key"]) && typeof value["label"] === "string" && validFieldType(value["type"], depth + 1) && (value["cardinality"] === void 0 || value["cardinality"] === "scalar" || value["cardinality"] === "append" || value["cardinality"] === "indexed") && (value["description"] === void 0 || typeof value["description"] === "string") && (value["knowledgeTarget"] === void 0 || isKnowledgeTarget(value["knowledgeTarget"]));
}
function validFieldType(type, depth = 0) {
  if (!object(type) || typeof type["kind"] !== "string" || depth > 16) return false;
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
      return onlyKeys(type, ["kind", "catalog"]) && (type["catalog"] === void 0 || nonEmptyString(type["catalog"]));
    case "script":
      return onlyKeys(type, ["kind", "language"]) && nonEmptyString(type["language"]);
    case "json":
      return onlyKeys(type, ["kind", "schema"]) && (type["schema"] === void 0 || validJsonSchemaRef(type["schema"]));
    case "enum":
    case "flags":
      return onlyKeys(
        type,
        type["kind"] === "enum" ? ["kind", "members", "unknown"] : ["kind", "members"]
      ) && Array.isArray(type["members"]) && type["members"].every(
        (member) => object(member) && onlyKeys(member, ["id", "label"]) && nonEmptyString(member["id"]) && (member["label"] === void 0 || typeof member["label"] === "string")
      ) && new Set(type["members"].map((member) => object(member) ? member["id"] : void 0)).size === type["members"].length;
    case "color":
      return onlyKeys(type, ["kind", "model"]) && (type["model"] === "rgb" || type["model"] === "rgba" || type["model"] === "argb");
    case "vector":
      return onlyKeys(type, ["kind", "size", "unit"]) && (type["size"] === 2 || type["size"] === 3 || type["size"] === 4) && (type["unit"] === void 0 || typeof type["unit"] === "string");
    case "subject-ref":
      return onlyKeys(type, ["kind", "subjectKind", "filter"]) && nonEmptyString(type["subjectKind"]) && (type["filter"] === void 0 || validSubjectFilter(type["filter"]));
    case "asset-ref": {
      const accepts = type["accepts"];
      return onlyKeys(type, ["kind", "accepts"]) && object(accepts) && onlyKeys(accepts, ["formatIds", "traits"]) && (accepts["formatIds"] === void 0 || validStringArray(accepts["formatIds"])) && (accepts["traits"] === void 0 || validStringArray(accepts["traits"]));
    }
    case "struct": {
      const fields = type["fields"];
      return onlyKeys(type, ["kind", "fields"]) && Array.isArray(fields) && fields.every((field) => validFieldSchema(field, depth + 1)) && new Set(fields.map((field) => object(field) ? field["key"] : void 0)).size === fields.length;
    }
    case "array":
      return onlyKeys(type, ["kind", "item", "max"]) && validFieldType(type["item"], depth + 1) && (type["max"] === void 0 || Number.isSafeInteger(type["max"]) && Number(type["max"]) >= 0);
    case "record":
      return onlyKeys(type, ["kind", "key", "value"]) && validFieldType(type["key"], depth + 1) && validFieldType(type["value"], depth + 1);
    case "instructions": {
      const keywords = type["keywords"];
      return onlyKeys(type, ["kind", "keywords", "delimiter", "listDelimiter"]) && object(keywords) && typeof type["delimiter"] === "string" && (type["listDelimiter"] === void 0 || typeof type["listDelimiter"] === "string") && Object.values(keywords).every(
        (fields) => Array.isArray(fields) && fields.every((field) => validFieldType(field, depth + 1))
      );
    }
    case "custom":
      return onlyKeys(type, ["kind", "typeId", "params"]) && nonEmptyString(type["typeId"]) && (type["params"] === void 0 || validJson(type["params"]));
    default:
      return false;
  }
}
function validWrites(value) {
  if (!object(value) || !onlyKeys(value, ["format", "encoding", "extension", "mediaType"])) {
    return false;
  }
  const named = (candidate) => object(candidate) && onlyKeys(candidate, ["id", "label"]) && nonEmptyString(candidate["id"]) && nonEmptyString(candidate["label"]);
  return named(value["format"]) && (value["encoding"] === void 0 || named(value["encoding"])) && nonEmptyString(value["extension"]) && nonEmptyString(value["mediaType"]);
}
function parseSchema(value) {
  if (!validJson(value) || !object(value) || !onlyKeys(value, ["schemaVersion", "forms"]) || value["schemaVersion"] !== 1 || !Array.isArray(value["forms"]) || value["forms"].length === 0)
    return void 0;
  const ids = /* @__PURE__ */ new Set();
  for (const form of value["forms"]) {
    if (!object(form) || !onlyKeys(form, ["id", "label", "summary", "binding", "fields", "baseInput", "writes"]) || typeof form["id"] !== "string" || form["id"].length === 0 || ids.has(form["id"]) || typeof form["label"] !== "string" || typeof form["summary"] !== "string" || !Array.isArray(form["fields"]) || // A preset (fixed `baseInput`, nothing to fill in) is the one form without controls.
    form["fields"].length === 0 && form["baseInput"] === void 0) {
      return void 0;
    }
    if (form["baseInput"] !== void 0 && (!object(form["baseInput"]) || Object.keys(form["baseInput"]).some(
      (key) => key === "__proto__" || key === "constructor" || key === "prototype"
    )))
      return void 0;
    if (form["writes"] !== void 0 && !validWrites(form["writes"])) return void 0;
    ids.add(form["id"]);
    if (form["binding"] !== void 0 && (!object(form["binding"]) || !onlyKeys(form["binding"], ["groupId", "entryKey"]) || !nonEmptyString(form["binding"]["groupId"]) || form["binding"]["entryKey"] !== void 0 && !nonEmptyString(form["binding"]["entryKey"]))) {
      return void 0;
    }
    const keys = /* @__PURE__ */ new Set();
    const paths = /* @__PURE__ */ new Set();
    for (const field of form["fields"]) {
      if (!object(field) || !onlyKeys(field, [
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
      if (object(form["baseInput"]) && (typeof firstSegment === "string" || typeof firstSegment === "number") && Object.hasOwn(form["baseInput"], firstSegment))
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
    let rejected;
    for (const spec of schema.forms) {
      const entry = selectedEntry(descriptor, spec, operation.id);
      if (operation.id === "edit.field" && entry === void 0) {
        rejected = "the descriptor has no matching editable field binding";
        break;
      }
      if (entry !== void 0 && entry.type === void 0) {
        rejected = "the editable descriptor field has no field schema type";
        break;
      }
      for (const field of spec.fields) {
        if (field.type.kind === "custom") {
          const editorId = entry?.editable?.editor;
          const problem = options.fieldEditors?.problem(field.type.typeId, editorId);
          if (problem !== void 0 || options.fieldEditors?.resolve(field.type.typeId, editorId) === void 0) {
            rejected = problem ?? `unsupported custom field type \xAB${field.type.typeId}\xBB`;
            break;
          }
        }
      }
      if (rejected !== void 0) break;
      forms.push(resolveForm(operation, spec, entry, descriptor));
    }
    if (rejected !== void 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: rejected
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
    error: Object.freeze(values.filter((item) => item["severity"] === "error")),
    warning: Object.freeze(values.filter((item) => item["severity"] === "warning")),
    information: Object.freeze(values.filter((item) => item["severity"] === "information")),
    hint: Object.freeze(values.filter((item) => item["severity"] === "hint"))
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
    text(key, values = {}) {
      const message = messages[key] ?? key;
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
    text(key, values = {}) {
      const translated = localizer.text(key, values);
      return translated === key ? fallback.text(key, values) : translated;
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
function createWebSettingsStore(storage, key = SETTINGS_STORAGE_KEY) {
  let current = DEFAULT_SETTINGS;
  return {
    location: `localStorage[${key}]`,
    async read() {
      const raw = storage.getItem(key);
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
      storage.setItem(key, serializeSettings(document2));
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
var object2 = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};
var nonBlank = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
};
var sha256 = (value, label) => {
  const text = nonBlank(value, label);
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
      const step = object2(item, `${label}[${index}]`);
      return Object.freeze({
        formatId: nonBlank(step["formatId"], `${label}[${index}].formatId`),
        extensionId: nonBlank(step["extensionId"], `${label}[${index}].extensionId`),
        contributionId: nonBlank(step["contributionId"], `${label}[${index}].contributionId`)
      });
    })
  );
};
function validatePwaFormatSmokeAuthority(value) {
  const input = object2(value, "format smoke authority");
  if (input["kind"] !== "x3.ga-recovery/format-family-smoke" || input["schemaVersion"] !== 1) {
    throw new TypeError("format smoke authority has the wrong kind or schemaVersion");
  }
  if (!Array.isArray(input["cases"]) || input["cases"].length !== FORMAT_SMOKE_CASE_IDS.length) {
    throw new TypeError("format smoke authority must contain exactly 14 cases");
  }
  const cases = input["cases"].map((item, index) => {
    const entry = object2(item, `cases[${index}]`);
    const id = nonBlank(entry["id"], `cases[${index}].id`);
    if (id !== FORMAT_SMOKE_CASE_IDS[index]) {
      throw new TypeError(`cases[${index}].id must be ${FORMAT_SMOKE_CASE_IDS[index]}`);
    }
    const stage = nonBlank(entry["stage"], `${id}.stage`);
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
    const corpus = object2(entry["corpus"], `${id}.corpus`);
    const runtime2 = object2(entry["runtime"], `${id}.runtime`);
    const pwa = object2(runtime2["pwa"], `${id}.runtime.pwa`);
    const pwaKind = nonBlank(pwa["kind"], `${id}.runtime.pwa.kind`);
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
        entry["formats"].map((format, at) => nonBlank(format, `${id}.formats[${at}]`))
      ),
      route: selectedRoute,
      corpus: Object.freeze({
        kind: nonBlank(corpus["kind"], `${id}.corpus.kind`),
        ...typeof corpus["path"] === "string" ? { path: corpus["path"] } : {},
        ...typeof corpus["container"] === "string" ? { container: corpus["container"] } : {},
        ...typeof corpus["bytes"] === "number" ? { bytes: corpus["bytes"] } : {},
        ...typeof corpus["sha256"] === "string" ? { sha256: corpus["sha256"] } : {},
        ...typeof corpus["reason"] === "string" ? { reason: corpus["reason"] } : {}
      }),
      runtime: Object.freeze({
        pwa: pwaKind === "browser-subset" ? Object.freeze({ kind: "browser-subset" }) : Object.freeze({
          kind: "host-facility-refusal",
          code: nonBlank(pwa["code"], `${id}.runtime.pwa.code`),
          facility: nonBlank(pwa["facility"], `${id}.runtime.pwa.facility`)
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
  const generatedFrom = object2(input["generatedFrom"], "generatedFrom");
  const bundledCatalog = object2(generatedFrom["bundledCatalog"], "generatedFrom.bundledCatalog");
  const offlineRelease = object2(generatedFrom["offlineRelease"], "generatedFrom.offlineRelease");
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
            const root = object2(item, `generatedFrom.bundledCatalog.roots[${index}]`);
            return Object.freeze({
              coordinate: nonBlank(
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
            (id, index) => nonBlank(id, `generatedFrom.offlineRelease.packageIds[${index}]`)
          )
        ),
        roots: sorted(
          offlineRelease["roots"].map(
            (id, index) => nonBlank(id, `generatedFrom.offlineRelease.roots[${index}]`)
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
var positive2 = (value) => Number.isFinite(value) && value > 0;
function stagePass(expected, actual) {
  if (expected !== actual.kind) return false;
  if (actual.kind === "raster") {
    return positive2(actual.width) && positive2(actual.height) && positive2(actual.opaquePixels) && positive2(actual.metadataEntries);
  }
  if (actual.kind === "tree-text") {
    return positive2(actual.treeNodes) && positive2(actual.textCharacters);
  }
  if (actual.kind === "tree") return positive2(actual.treeNodes);
  if (actual.kind === "metadata-tree") {
    return positive2(actual.metadataEntries) && positive2(actual.treeNodes);
  }
  return positive2(actual.width) && positive2(actual.height);
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
  for (const failure of managedRoots.failures) {
    bootDiagnostics.push(`${failure.code}: ${failure.message}`);
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
  for (const failure of extensionsUi.current().failures) {
    bootDiagnostics.push(`${failure.code}: ${failure.message}`);
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
    const key = descriptorKey(descriptor);
    const parent = assetSessions.get(key);
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
    const operations = operationSessions.get(key);
    const extract = descriptor.operations.find(
      (operation) => operation.state === "available" && !operation.mutatesSource && operation.id === CONTAINER_EXTRACT_OPERATION_ID
    );
    let bytes = verifiedBytes?.slice() ?? new Uint8Array();
    if (verifiedBytes === void 0 && operations !== void 0 && extract !== void 0) {
      const read = await operations.invoke(extract.handlerId, { entryId }, {});
      if (read.state === "ok" && read.output.kind === "bytes") bytes = read.output.value.slice();
    }
    const id = nestedEntryId(key, entryPath);
    const label = entryPath.slice(entryPath.lastIndexOf("/") + 1);
    const selectedRoute = Object.freeze([
      ...selectedRoutes.get(key) ?? [],
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
      const key = descriptorKey(result.descriptor);
      const actualSelectedRoute = nested?.selectedRoute ?? Object.freeze([selectedStep(result)]);
      selectedRoutes.set(key, actualSelectedRoute);
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
          sessionId: `pwa:${key}`,
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
      operationSessions.set(key, operations);
      assetSessions.set(key, result.session);
      if (result.rasterResources !== void 0) rasterResources.set(key, result.rasterResources);
      openedEntries.set(entry.id, entry);
      entryOfDescriptor.set(key, entry.id);
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
          operationSessions.delete(key);
          assetSessions.delete(key);
          rasterResources.delete(key);
          selectedRoutes.delete(key);
          entryOfDescriptor.delete(key);
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
    const key = descriptorKey(descriptor);
    const parent = assetSessions.get(key);
    const operations = operationSessions.get(key);
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
        let cursor;
        for (let page = 0; page < 100 && found === void 0; page += 1) {
          const answer = await source.search(
            { kind: "basename-any", basenames: [basename], caseSensitive: true },
            { limit: 200, ...cursor === void 0 ? {} : { cursor } }
          );
          found = answer.items.find((item) => item.path.replaceAll("\\", "/") === target);
          cursor = answer.nextCursor;
          if (cursor === void 0) break;
        }
      }
      if (found === void 0) {
        let cursor;
        for (let page = 0; page < 1e3 && found === void 0; page += 1) {
          const answer = await source.list("", {
            limit: 200,
            ...cursor === void 0 ? {} : { cursor }
          });
          found = answer.items.find((item) => item.path.replaceAll("\\", "/") === target);
          cursor = answer.nextCursor;
          if (cursor === void 0) break;
        }
      }
      if (found === void 0) {
        let prefix = "";
        for (const segment of target.split("/")) {
          let cursor;
          let next;
          const wanted = prefix === "" ? segment : `${prefix}/${segment}`;
          for (let page = 0; page < 100 && next === void 0; page += 1) {
            const answer = await source.list(prefix, {
              limit: 200,
              ...cursor === void 0 ? {} : { cursor }
            });
            next = answer.items.find((item) => item.path.replaceAll("\\", "/") === wanted);
            cursor = answer.nextCursor;
            if (cursor === void 0) break;
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
  const failure = document.createElement("p");
  failure.className = "booting";
  failure.textContent = createWebLocalizer(navigator.languages).text("web.status.bootFailed", {
    reason: describe2(error)
  });
  node.append(failure);
});
