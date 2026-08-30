import {
  CONTAINER_EXTRACT_OPERATION_ID,
  DATA_CATALOG_ANALYSIS_CONTRACT,
  DATA_CATALOG_MATCHER_PROFILE,
  EXPLORER_MAXIMUM_BYTES,
  EXTENSION_ROOT_FAILURE_CODES,
  MAP_PREVIEW_PREPARATION_CONTRACT,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  ModkitError,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  ViewerMountScope,
  WEB_EDITING_NOTICE,
  WEB_EXTENSION_CATALOG,
  WEB_PREVIEW_FALLBACK,
  WORLD_SCENE_SOURCE_CONTRACT,
  canonicalJsonStringify,
  catalogCoordinates,
  combineLoadedExtensionRoots,
  compareUtf8,
  containerCoordinate,
  contractId,
  createBrowserExtensionManager,
  createCodecPreview,
  createDirectoryAccess,
  createEditorArea,
  createExplorer,
  createIndexedDbExtensionStore,
  createManagedExtensionsController,
  createSingleFileAccess,
  createSurface,
  createWebEditingArm,
  createWebPreviewStages,
  createWebSubjectServices,
  createWebTopology,
  defineViewerModule,
  describeEditability,
  describeFileCapability,
  diagnostic,
  element,
  errorCode,
  grantValidity,
  isCancellation,
  isModkitError,
  isQualifiedId,
  isStandardTraitId,
  isTraitId,
  isWritableHandle,
  loadManagedExtensionRoots,
  loadUserExtensionRoots,
  mountWebWorkbench,
  narrowGrant,
  nestedSubjectServices,
  openNestedSubject,
  operationScopedPermissionClasses,
  parseSemver,
  parseVersionRange,
  presentationSlotId,
  probeWebFacilities,
  requestUserExtensionPermission,
  requestWriteAccess,
  resolveCommonPresentationPlan,
  resolveFormatWriter,
  resolveModWorkspaceGraph,
  resolveModuleMap,
  revisionId,
  revisionIdFromRef,
  satisfiesRange,
  setPart,
  setState,
  setViewerText,
  sourceRevisionToken,
  sourceUriFor,
  stageIdOf,
  throwIfAborted,
  validateSubjectDescriptorV2
} from "./chunks/chunk-EWFHUSBY.js";
import "./chunks/chunk-HVXSZ42C.js";

// packages/ui/dist/settings/index.js
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
  "model.primitive-selector",
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
  "card.knowledge",
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
      const id = asText(item["id"]);
      const path = asText(item["path"]);
      if (id === void 0 || path === void 0) {
        problems.push(`extensions[${index}] needs both "id" and "path"; ignored`);
        continue;
      }
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
      const gameId = rawGameId.trim().toLowerCase();
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
  const disabled = [];
  const disabledInput = value["disabledContributions"];
  if (disabledInput !== void 0 && !Array.isArray(disabledInput)) {
    problems.push("disabledContributions must be an array; it was ignored");
  } else {
    const seenIds = /* @__PURE__ */ new Set();
    for (const [index, item] of (disabledInput ?? []).entries()) {
      const id = asText(item);
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
  const root = document2.createElement("div");
  root.className = "modkit-viewer modkit-settings";
  setPart2(root, "settings");
  const groupList = element2(root, "nav", { part: "settings.groups" });
  groupList.setAttribute("aria-label", "Settings groups");
  if (options.onClose !== void 0) {
    const close = element2(groupList, "button", {
      part: "settings.close",
      text: "\u2190 Back"
    });
    close.type = "button";
    close.title = "Close settings (Esc)";
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
      say(`Saved to ${options.store.location}`);
    } catch (error) {
      say(`Could not save: ${error instanceof Error ? error.message : String(error)}`, true);
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
    label: "Appearance",
    render(host) {
      if (options.themes.length > 0) {
        const control = row(host, "Color theme", "Applies immediately and to every viewer surface.");
        const select = element2(control, "select", { part: "settings.select" });
        select.setAttribute("aria-label", "Color theme");
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
        "Density",
        "Compact matches VS Code list metrics; comfortable suits touch and larger displays."
      );
      const density = element2(densityControl, "select", {
        part: "settings.select"
      });
      density.setAttribute("aria-label", "Density");
      for (const value of ["compact", "comfortable"]) {
        const option = document2.createElement("option");
        option.value = value;
        option.textContent = value[0]?.toUpperCase() + value.slice(1);
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
    label: "Extensions",
    render(host) {
      const intro = element2(host, "p", { part: "settings.description" });
      intro.textContent = `Extensions are listed in ${options.store.location}. Each entry is an id, a path the host loads from, and whether it is enabled. The same file is read by the desktop app, the web app and a headless run.`;
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
            text: "No extensions are configured yet."
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
            toggle.setAttribute("aria-label", `Enable ${entry.id}`);
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
              text: entry.enabled ? "enabled" : "disabled"
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
              text: "Remove"
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
      id.setAttribute("aria-label", "Extension id");
      const path = element2(adder, "input", { part: "settings.input" });
      path.placeholder = "path, package or URL";
      path.setAttribute("aria-label", "Extension location");
      const add = (entry) => {
        void persist({
          ...current,
          extensions: [...current.extensions.filter((other) => other.id !== entry.id), entry]
        }).then(draw);
      };
      const addButton = element2(adder, "button", {
        part: "settings.add",
        text: "Add"
      });
      addButton.type = "button";
      addButton.addEventListener("click", () => {
        const entryId = id.value.trim();
        const entryPath = path.value.trim();
        if (entryId === "" || entryPath === "") {
          say("An extension needs both an id and a location.", true);
          return;
        }
        add({ id: entryId, path: entryPath, enabled: true });
        id.value = "";
        path.value = "";
      });
      if (options.browseForExtension !== void 0) {
        const browse = element2(adder, "button", {
          part: "settings.add",
          text: "Browse\u2026"
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
    label: "File associations",
    render(host) {
      const types = [...options.associableTypes ?? []].sort();
      element2(host, "p", {
        part: "settings.description",
        text: "Make this app the default for the formats its codecs can open. Registration is per-user and reversible from the operating system, and nothing is written until you apply it."
      });
      if (types.length === 0) {
        element2(host, "p", {
          part: "settings.description",
          text: "No codecs are loaded, so there is nothing to associate."
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
        toggle.setAttribute("aria-label", `Associate .${type}`);
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
        text: "Select all"
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
        text: "Select none"
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
        text: "Set as default app"
      });
      apply.type = "button";
      apply.addEventListener("click", () => {
        void (async () => {
          if (chosen.size === 0) {
            say("Pick at least one file type first.", true);
            return;
          }
          try {
            apply.disabled = true;
            say(await registerFileTypes?.([...chosen]) ?? "Nothing to register.");
          } catch (error) {
            say(
              `Could not register: ${error instanceof Error ? error.message : String(error)}`,
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
        problems.length === 0 ? `Loaded from ${options.store.location}` : `Loaded with ${problems.length} problem(s): ${problems.join("; ")}`,
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

// packages/ui/dist/localization/index.js
var EN_MESSAGES = Object.freeze({
  "app.title": "Modkit MK3",
  "app.starting": "Starting Modkit MK3\u2026",
  "action.openFile": "Open file\u2026",
  "action.openFileTitle": "Open a single file in a new tab",
  "action.splitEditor": "Split editor",
  "action.splitEditorTitle": "Open the next file beside this one",
  "action.enableEditing": "Enable editing",
  "action.enableEditingTitle": "Ask this browser for permission to write the file or folder you picked",
  "action.restartSession": "Restart session",
  "action.restartSessionTitle": "Reload Modkit after the codec worker stopped",
  "settings.bundled": "Bundled extensions",
  "settings.bundledExcluded": "Bundled but not served here",
  "settings.bundledDescription": "{count} extensions were attested at build time and are served from this origin under extensions/. They are listed read-only because {reason}.",
  "sidebar.host": "Host",
  "sidebar.facilities": "Facilities",
  "sidebar.samples": "Served samples",
  "sidebar.language": "Language",
  "sidebar.hostSummary": "{extensions} extensions \xB7 {types} detectable types \xB7 codecs run {profiles} in {realm} \xB7 shared memory {sharedMemory}",
  "locale.en": "English",
  "locale.ru": "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
  "common.yes": "yes",
  "common.no": "no",
  "activity.files": "Files",
  "activity.explorer": "Explorer",
  "activity.host": "Host",
  "activity.hostTitle": "Show or hide the host panel",
  "activity.info": "Info",
  "activity.infoTitle": "Show or hide diagnostics and operations",
  "activity.settings": "Settings",
  "status.noFileEditable": "No file is open yet, so nothing is editable.",
  "status.workerUnavailable": "Codec worker stopped \xB7 restart the session to continue",
  "status.ready": "Ready \xB7 {extensions} extensions \xB7 {notices} boot notice(s)",
  "confirm.discardAndRestart": "Some tabs have unsaved changes. Restart the session and discard them?",
  "error.openFile": "Could not open the file: {reason}",
  "error.drop": "Drop failed: {reason}",
  "error.fetch": "{path} could not be fetched from this origin."
});
var RU_MESSAGES = Object.freeze({
  "app.title": "Modkit MK3",
  "app.starting": "\u0417\u0430\u043F\u0443\u0441\u043A Modkit MK3\u2026",
  "action.openFile": "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0444\u0430\u0439\u043B\u2026",
  "action.openFileTitle": "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043E\u0434\u0438\u043D \u0444\u0430\u0439\u043B \u0432 \u043D\u043E\u0432\u043E\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u0435",
  "action.splitEditor": "\u0420\u0430\u0437\u0434\u0435\u043B\u0438\u0442\u044C \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440",
  "action.splitEditorTitle": "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0444\u0430\u0439\u043B \u0440\u044F\u0434\u043E\u043C \u0441 \u0442\u0435\u043A\u0443\u0449\u0438\u043C",
  "action.enableEditing": "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435",
  "action.enableEditingTitle": "\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u044C \u0443 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430 \u043F\u0440\u0430\u0432\u043E \u0437\u0430\u043F\u0438\u0441\u0438 \u0432 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u0438\u043B\u0438 \u043F\u0430\u043F\u043A\u0443",
  "action.restartSession": "\u041F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0441\u0435\u0430\u043D\u0441",
  "action.restartSessionTitle": "\u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C Modkit \u043F\u043E\u0441\u043B\u0435 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438 \u0440\u0430\u0431\u043E\u0447\u0435\u0433\u043E \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430 \u043A\u043E\u0434\u0435\u043A\u043E\u0432",
  "settings.bundled": "\u0412\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F",
  "settings.bundledExcluded": "\u0412\u0441\u0442\u0440\u043E\u0435\u043D\u044B, \u043D\u043E \u0437\u0434\u0435\u0441\u044C \u043D\u0435 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u044B",
  "settings.bundledDescription": "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0439 \u0430\u0442\u0442\u0435\u0441\u0442\u043E\u0432\u0430\u043D\u043E \u043F\u0440\u0438 \u0441\u0431\u043E\u0440\u043A\u0435: {count}. \u041E\u043D\u0438 \u043F\u0443\u0431\u043B\u0438\u043A\u0443\u044E\u0442\u0441\u044F \u0441 \u044D\u0442\u043E\u0433\u043E origin \u0432 extensions/ \u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0447\u0442\u0435\u043D\u0438\u044F: {reason}.",
  "sidebar.host": "\u0425\u043E\u0441\u0442",
  "sidebar.facilities": "\u0412\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u0438",
  "sidebar.samples": "\u041F\u0440\u0438\u043C\u0435\u0440\u044B \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430",
  "sidebar.language": "\u042F\u0437\u044B\u043A",
  "sidebar.hostSummary": "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0439: {extensions} \xB7 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0432\u0430\u0435\u043C\u044B\u0445 \u0442\u0438\u043F\u043E\u0432: {types} \xB7 \u043A\u043E\u0434\u0435\u043A\u0438 \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442 \u043A\u0430\u043A {profiles} \u0432 {realm} \xB7 \u043E\u0431\u0449\u0430\u044F \u043F\u0430\u043C\u044F\u0442\u044C: {sharedMemory}",
  "locale.en": "English",
  "locale.ru": "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
  "common.yes": "\u0434\u0430",
  "common.no": "\u043D\u0435\u0442",
  "activity.files": "\u0424\u0430\u0439\u043B\u044B",
  "activity.explorer": "\u041F\u0440\u043E\u0432\u043E\u0434\u043D\u0438\u043A",
  "activity.host": "\u0425\u043E\u0441\u0442",
  "activity.hostTitle": "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0438\u043B\u0438 \u0441\u043A\u0440\u044B\u0442\u044C \u043F\u0430\u043D\u0435\u043B\u044C \u0445\u043E\u0441\u0442\u0430",
  "activity.info": "\u0418\u043D\u0444\u043E",
  "activity.infoTitle": "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0438\u043B\u0438 \u0441\u043A\u0440\u044B\u0442\u044C \u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0443 \u0438 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438",
  "activity.settings": "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
  "status.noFileEditable": "\u0424\u0430\u0439\u043B \u0435\u0449\u0451 \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0442 \u2014 \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u043E\u043A\u0430 \u043D\u0435\u0447\u0435\u0433\u043E.",
  "status.workerUnavailable": "\u0420\u0430\u0431\u043E\u0447\u0438\u0439 \u043F\u0440\u043E\u0446\u0435\u0441\u0441 \u043A\u043E\u0434\u0435\u043A\u043E\u0432 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D \xB7 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u0441\u0435\u0430\u043D\u0441, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C",
  "status.ready": "\u0413\u043E\u0442\u043E\u0432\u043E \xB7 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0439: {extensions} \xB7 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0437\u0430\u043F\u0443\u0441\u043A\u0430: {notices}",
  "confirm.discardAndRestart": "\u0412 \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0445 \u0432\u043A\u043B\u0430\u0434\u043A\u0430\u0445 \u0435\u0441\u0442\u044C \u043D\u0435\u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F. \u041F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0441\u0435\u0430\u043D\u0441 \u0438 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0445?",
  "error.openFile": "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0444\u0430\u0439\u043B: {reason}",
  "error.drop": "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u0438\u043D\u044F\u0442\u044C \u0444\u0430\u0439\u043B: {reason}",
  "error.fetch": "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C {path} \u0441 \u044D\u0442\u043E\u0433\u043E origin."
});
var UI_MESSAGES = Object.freeze({
  en: EN_MESSAGES,
  ru: RU_MESSAGES
});
function resolveUiLocale(requested) {
  const candidates = requested === void 0 ? [] : typeof requested === "string" ? [requested] : requested;
  for (const candidate of candidates) {
    const language = candidate.trim().toLowerCase().split("-")[0];
    if (language === "ru") return "ru";
    if (language === "en") return "en";
  }
  return "en";
}
function createUiLocalizer(locale, overrides = {}) {
  const catalog = Object.freeze({ ...UI_MESSAGES[locale], ...overrides });
  const localizer = {
    locale,
    text(key, values = {}) {
      return catalog[key].replace(
        /\{([a-zA-Z][a-zA-Z0-9]*)\}/gu,
        (_match, name) => {
          const value = values[name];
          return value === void 0 ? `{${name}}` : String(value);
        }
      );
    }
  };
  return Object.freeze(localizer);
}

// packages/host/dist/maps/index.js
var MAX_SIGNATURE_WINDOW_BYTES = 4096 + 64;
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
  "org.modkitx.inventory/provider-offer"
);
var VIEWER_CONTRIBUTION_INVENTORY_FACT = contractId(
  "org.modkitx.inventory/viewer-contribution"
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
    contract: contractId(string(item.contract, `${label}.contract`)),
    major: safeMajor(item.major, `${label}.major`),
    ...item.range === void 0 ? {} : { range: string(item.range, `${label}.range`) }
  });
}
function parseContractOffer(value, label) {
  const item = object(value, label);
  const version = string(item.version, `${label}.version`);
  const major = safeMajor(item.major, `${label}.major`);
  const parsed = parseSemver(version);
  if (parsed === void 0 || parsed.major !== major) {
    throw new TypeError(`${label}.version must be exact SemVer in declared major`);
  }
  return Object.freeze({
    offerId: string(item.offerId, `${label}.offerId`),
    contract: contractId(string(item.contract, `${label}.contract`)),
    major,
    version,
    ...item.facet === void 0 ? {} : { facet: item.facet }
  });
}
function parseOutputs(value) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new TypeError("outputs must be an array");
  return Object.freeze(
    value.map((raw, index) => {
      const item = object(raw, `outputs[${index}]`);
      const id = string(item.id, `outputs[${index}].id`);
      if (!isTraitId(id)) throw new TypeError(`outputs[${index}].id is not a trait id`);
      return Object.freeze({
        id,
        ...item.definitionVersion === void 0 ? {} : {
          definitionVersion: string(
            item.definitionVersion,
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
  const provides = item.provides;
  if (!Array.isArray(provides) || provides.length === 0) {
    throw new TypeError("provider offer fact needs at least one logical offer");
  }
  const kind = item.kind;
  if (!["primary", "replacement", "augmentation", "projection", "operation"].includes(String(kind))) {
    throw new TypeError("provider offer kind is invalid");
  }
  const providerId = string(item.providerId, "providerId");
  if (!isQualifiedId(providerId)) throw new TypeError("providerId must be qualified");
  const parseRequirementArray = (raw, label) => {
    if (raw === void 0) return void 0;
    if (!Array.isArray(raw)) throw new TypeError(`${label} must be an array`);
    return Object.freeze(raw.map((entry, index) => parseRequirement(entry, `${label}[${index}]`)));
  };
  const operations = item.operations;
  if (operations !== void 0 && !Array.isArray(operations)) {
    throw new TypeError("operations must be an array");
  }
  const requires = parseRequirementArray(item.requires, "requires");
  const outputs = parseOutputs(item.outputs);
  const requiredPermissions = item.requiredPermissions;
  if (requiredPermissions !== void 0 && !Array.isArray(requiredPermissions)) {
    throw new TypeError("requiredPermissions must be an array");
  }
  return Object.freeze({
    kind,
    extensionId: string(item.extensionId, "extensionId"),
    extensionVersion: string(item.extensionVersion, "extensionVersion"),
    providerId,
    runtimeVariant: string(item.runtimeVariant, "runtimeVariant"),
    target: parseTarget(item.target),
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
    ...item.replaces === void 0 ? {} : { replaces: parseRequirement(item.replaces, "replaces") }
  });
}
function offersFromInventory(inventory) {
  const catalog = [];
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
        catalog.push(offer);
      }
    }
  }
  return Object.freeze(
    catalog.sort(
      (left, right) => compareUtf8(canonicalJsonStringify(left), canonicalJsonStringify(right))
    )
  );
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
  const target = request.target;
  let sawToolReject = false;
  const targetOk = versionOk.filter((candidate) => {
    const constraint = candidate.offer.target;
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
    if (!isSubset(candidate.offer.requiredPermissions, [...target.grantedPermissions ?? []])) {
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
    ).length
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
  return [...rejected2].sort(
    (a, b) => compareUtf8(canonicalJsonStringify(a), canonicalJsonStringify(b))
  );
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
async function resolveServiceProvider(request, offers, definitions) {
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
    selectionKey: (_offer, logical) => selectionKeys.get(logical)
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
      options.definitions
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
  for (const cap of c2.requiredHostCapabilities ?? []) {
    if (!(target.hostCapabilities ?? []).includes(cap)) problems.push(`hostCapability ${cap}`);
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
        `\xAB${manifest.id}\xBB runs as trusted-in-process: the host checks grants at dispatch and brokers what it owns, but it cannot technically prevent this code from reaching node:fs/node:net or the process itself. This is an audit/policy boundary, not a sandbox (24 \xA75.1).`,
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
async function activateServiceProvider(options) {
  const ticket = issueActivationTicket(options.result, options.target);
  const activation = await activateContribution({
    ticket,
    grant: options.grant,
    executionBackends: options.executionBackends,
    ...options.policy === void 0 ? {} : { policy: options.policy },
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  options.diagnostics?.push(...activation.diagnostics);
  const providerId = options.result.selected.offer.providerId;
  const fail = async (code, message) => {
    await activation.release();
    throw new ModkitError({ code, message });
  };
  if (activation.module["abiVersion"] !== 1 || typeof activation.module["createProvider"] !== "function") {
    return fail(
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
    return fail(
      "x3.host/invalid-service-provider-lease",
      `provider ${providerId} returned an invalid lease`
    );
  }
  let released = false;
  return Object.freeze({
    lease,
    effectiveGrant: activation.effectiveGrant,
    executionProfile: activation.variant.executionProfile,
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
    onResolved(request, result) {
      locks.push(buildLockEntry(request, result));
    },
    async activate(selection, result, signal) {
      const key = `${selection.contract}@${selection.major}:${result.selected.offer.providerId}:${selection.offerId}`;
      if (chain.includes(key)) {
        throw new ModkitError({
          code: "x3.host/service-dependency-cycle",
          message: `service activation cycle detected at ${key}`
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
        contextFor: (effectiveGrant) => Object.freeze({
          contracts: makePort(effectiveGrant, [...chain, key]),
          budgets: options.budgets,
          diagnostics: {
            report(item) {
              diagnostics.push(item);
            }
          },
          ...options.signal === void 0 ? {} : { signal: options.signal }
        })
      });
      activations.push(activation);
      activationFacts.push(
        Object.freeze({
          providerId: result.selected.offer.providerId,
          contract: selection.contract,
          major: selection.major,
          offerId: selection.offerId,
          runtimeVariant: result.selected.offer.runtimeVariant,
          executionProfile: activation.executionProfile
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
      return Object.freeze({ kind: "bytes", value: output.value.slice() });
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
  const descriptor = options.descriptor;
  const operationByHandler = new Map(descriptor.operations.map((item) => [item.handlerId, item]));
  const declarationByHandler = new Map(
    options.operationDeclarations.map((item) => [item.handlerId, item])
  );
  const handlers = new Map(options.handlers);
  const releases = [...options.release ?? []];
  const subscribers = /* @__PURE__ */ new Set();
  let state = "live";
  let disposal;
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
      const required2 = declaration.requiredPermissions ?? [];
      const validity = grantValidity(options.permissionGrant);
      const missing = required2.filter((item) => !options.permissionGrant.classes.includes(item));
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
        const output = snapshotOutput(await handler(ownedInput, invokeOptions));
        throwIfAborted(invokeOptions.signal);
        if (declaration.outputKinds !== void 0 && !declaration.outputKinds.includes(output.kind)) {
          throw new ModkitError({
            code: "x3.host/undeclared-operation-output",
            message: `handler ${handlerId} returned undeclared output kind ${output.kind}`,
            context: { handlerId, outputKind: output.kind }
          });
        }
        return { state: "ok", output, diagnostics: [] };
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
var NAMESPACE_PATH_ENCODER = new TextEncoder();
var COMPANION_PATH_REFUSED = "x3.host/companion-path-refused";
var DEFAULT_COMPANION_LIMITS = Object.freeze({
  maxEntries: 4096,
  maxProbes: 64,
  maxProbeBytes: 256 * 1024,
  maxBindings: 64
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
var NAMESPACE_SCOPES = Object.freeze([
  "current-mount",
  "enclosing-container"
]);
var NESTED_ENTRY_NOT_FOUND = "x3.host/nested-entry-not-found";
function containerEntryRevision(containerRevision, entryId, byteLength) {
  return revisionIdFromRef({
    kind: "provider-token",
    value: `${String(containerRevision)}!${entryId}:${byteLength}`
  });
}
function createWorkspaceNamespaceCompanionOrigin(options) {
  return createCompositeWorkspaceNamespaceCompanionOrigin({
    primaryLogicalId: options.primaryLogicalId,
    roots: options.logicalRoots.map((root) => ({
      ...root,
      namespace: options.namespace,
      containerRevision: options.containerRevision,
      extract: options.extract
    })),
    ...options.caseSensitivity === void 0 ? {} : { caseSensitivity: options.caseSensitivity },
    ...options.pageLimit === void 0 ? {} : { pageLimit: options.pageLimit },
    ...options.maxPages === void 0 ? {} : { maxPages: options.maxPages }
  });
}
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
      extract: root.extract
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
  const relativeRequest = (root, logicalId) => {
    if (logicalId === "") return "";
    if (root.logicalPrefix === "") return logicalId;
    if (fold2(logicalId) === fold2(root.logicalPrefix)) return "";
    const prefix = `${root.logicalPrefix}/`;
    return fold2(logicalId).startsWith(fold2(prefix)) ? logicalId.slice(prefix.length) : void 0;
  };
  const remember2 = (root, entry) => {
    if (entry.kind !== "file") return void 0;
    const prefix = root.pathPrefix === "" ? "" : `${root.pathPrefix}/`;
    if (prefix !== "" && !fold2(entry.path).startsWith(fold2(prefix))) return void 0;
    const relative = prefix === "" ? entry.path : entry.path.slice(prefix.length);
    if (relative === "") return void 0;
    const logicalId = joinPrefix(root.logicalPrefix, relative);
    const key = fold2(logicalId);
    if (!byLogicalId.has(key)) {
      byLogicalId.set(key, {
        entryId: entry.id,
        path: entry.path,
        ...entry.size === void 0 ? {} : { size: entry.size },
        revision: entry.revision,
        namespace: root.namespace,
        containerRevision: root.containerRevision,
        extract: root.extract
      });
    }
    return logicalId;
  };
  const find = async (logicalId, signal) => {
    const key = fold2(logicalId);
    const cached = byLogicalId.get(key);
    if (cached !== void 0) return cached;
    for (const root of roots) {
      const relative = relativeRequest(root, logicalId);
      if (relative === void 0) continue;
      for await (const entry of pages(root, joinPrefix(root.pathPrefix, relative), signal)) {
        const remembered = remember2(root, entry);
        if (remembered !== void 0 && fold2(remembered) === key) return byLogicalId.get(key);
      }
    }
    return void 0;
  };
  return Object.freeze({
    primaryLogicalId: options.primaryLogicalId,
    caseSensitivity,
    scopes: Object.freeze(["workspace-dependency-layer"]),
    async *enumerate(scope, enumeration, signal) {
      if (scope !== "workspace-dependency-layer") return;
      const yielded = /* @__PURE__ */ new Set();
      for (const root of roots) {
        const relative = relativeRequest(root, enumeration.prefix);
        if (relative === void 0) continue;
        for await (const entry of pages(root, joinPrefix(root.pathPrefix, relative), signal)) {
          throwIfAborted(signal);
          const logicalId = remember2(root, entry);
          if (logicalId === void 0 || yielded.has(fold2(logicalId))) continue;
          yielded.add(fold2(logicalId));
          yield Object.freeze({
            logicalId,
            ...entry.size === void 0 ? {} : { size: entry.size }
          });
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
var RESOURCE_NOT_FOUND = "x3.host/resource-not-found";
var RESOURCE_NOT_ALLOWLISTED = "x3.host/resource-not-allowlisted";
var RESOURCE_PATH_REFUSED = "x3.host/resource-path-refused";
var RESOURCE_SCOPE_UNSUPPORTED = "x3.host/resource-scope-unsupported";
var RESOURCE_BUDGET_EXCEEDED = "x3.host/resource-budget-exceeded";
var RESOURCE_CYCLE_DETECTED = "x3.host/resource-cycle-detected";
var RESOURCE_SESSION_DISPOSED = "x3.host/resource-session-disposed";
var REASON_CODES = Object.freeze({
  "not-found": RESOURCE_NOT_FOUND,
  "not-allowlisted": RESOURCE_NOT_ALLOWLISTED,
  "path-refused": RESOURCE_PATH_REFUSED,
  "scope-unsupported": RESOURCE_SCOPE_UNSUPPORTED,
  "budget-exceeded": RESOURCE_BUDGET_EXCEEDED,
  "cycle-detected": RESOURCE_CYCLE_DETECTED,
  "session-disposed": RESOURCE_SESSION_DISPOSED
});
function resourceDiagnosticCode(reason) {
  return REASON_CODES[reason] ?? RESOURCE_NOT_FOUND;
}
var DEFAULT_RESOURCE_SESSION_LIMITS = Object.freeze({
  maxResources: 256,
  maxBytes: 256n * 1024n * 1024n,
  maxDepth: 8,
  maxEntries: 4096
});
function fold(value, caseSensitivity) {
  return caseSensitivity === "insensitive" ? value.toLowerCase() : value;
}
function prefixOf(logicalId) {
  const cut = logicalId.lastIndexOf("/");
  return cut < 0 ? "" : logicalId.slice(0, cut + 1);
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
  const sessionId = options.sessionId ?? `resource-session-${String(options.revision)}`;
  const origin = options.origin;
  const provenance = [];
  const byRequirementId = /* @__PURE__ */ new Map();
  const index = /* @__PURE__ */ new Map();
  const held = /* @__PURE__ */ new Set();
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
  const unresolved = (requirement, reason, message, cached = false) => {
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
    let entries = 0;
    for (const scope of scopes) {
      throwIfAborted(signal);
      for await (const entry of origin.enumerate(scope, { prefix: prefixOf(normalized) }, signal)) {
        entries += 1;
        if (entries > limits.maxEntries) return { found: void 0, overBudget: true };
        const candidate = byName ? entry.logicalId.split("/").at(-1) ?? entry.logicalId : entry.logicalId;
        if (fold(candidate, origin.caseSensitivity) === wanted) {
          return { found: entry.logicalId, overBudget: false };
        }
      }
    }
    return { found: void 0, overBudget: false };
  };
  return {
    sessionId,
    revision: options.revision,
    state: () => state,
    async resolve(requirement, signal) {
      if (state === "disposed") {
        return unresolved(
          requirement,
          "session-disposed",
          `resource session ${sessionId} is disposed and resolves nothing further`
        );
      }
      throwIfAborted(signal);
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
          return unresolved(requirement, "path-refused", error.message);
        }
        throw error;
      }
      const chain = chainOf(requirement);
      if (chain === void 0) {
        return unresolved(
          requirement,
          "budget-exceeded",
          `resource chain for \xAB${requirement.logicalId}\xBB is deeper than the session depth budget of ${limits.maxDepth}`
        );
      }
      if (chain.some(
        (item) => fold(item, origin.caseSensitivity) === fold(normalized, origin.caseSensitivity)
      )) {
        return unresolved(
          requirement,
          "cycle-detected",
          `resource \xAB${requirement.logicalId}\xBB is already in its own reference chain: ${[...chain, requirement.logicalId].join(" -> ")}`
        );
      }
      if (!allowed(normalized, options.allowlist)) {
        return unresolved(
          requirement,
          "not-allowlisted",
          `resource \xAB${requirement.logicalId}\xBB is outside every allowlisted prefix of this session`
        );
      }
      const servedScopes = requirement.scopes.filter((scope) => origin.scopes.includes(scope));
      if (servedScopes.length === 0) {
        return unresolved(
          requirement,
          "scope-unsupported",
          `this origin serves ${origin.scopes.join(", ")}; the requirement asked only for ${requirement.scopes.join(", ")}`
        );
      }
      const key = fold(normalized, origin.caseSensitivity);
      const cached = index.get(key);
      let found;
      if (cached !== void 0) {
        found = cached.found;
        if (found === void 0) {
          return unresolved(
            requirement,
            "not-found",
            `resource \xAB${requirement.logicalId}\xBB is not in any scope this session serves`,
            true
          );
        }
      } else {
        const located = await locate(normalized, servedScopes, signal);
        if (located.overBudget) {
          return unresolved(
            requirement,
            "budget-exceeded",
            `locating \xAB${requirement.logicalId}\xBB exceeded the session entry budget of ${limits.maxEntries}`
          );
        }
        index.set(key, { found: located.found });
        found = located.found;
        if (found === void 0) {
          return unresolved(
            requirement,
            "not-found",
            `resource \xAB${requirement.logicalId}\xBB is not in any scope this session serves`
          );
        }
      }
      if (resources >= limits.maxResources) {
        return unresolved(
          requirement,
          "budget-exceeded",
          `this session already holds ${resources} resources, its limit`
        );
      }
      throwIfAborted(signal);
      const originLease = await origin.open(found, signal);
      if (disposed()) {
        await originLease.release();
        return unresolved(
          requirement,
          "session-disposed",
          `resource session ${sessionId} was disposed while \xAB${requirement.logicalId}\xBB was being opened`
        );
      }
      const size = originLease.value.kind === "bytes" ? originLease.value.size ?? 0n : 0n;
      if (bytes + size > limits.maxBytes) {
        await originLease.release();
        return unresolved(
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
      return {
        state: "resolved",
        lease,
        revision: lease.value.revision,
        provenance: record(requirement, {
          state: "resolved",
          revision: lease.value.revision,
          bytes: size,
          cached: cached !== void 0
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
      const failure = results.find((result) => result.status === "rejected");
      if (failure !== void 0 && failure.status === "rejected") throw failure.reason;
    }
  };
}
var OFFER_KEYS = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS = /* @__PURE__ */ new Set(["gameId"]);
function recordOf(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer(value) {
  const record = recordOf(value);
  if (record === void 0 || Object.keys(record).some((key) => !OFFER_KEYS.has(key))) {
    return void 0;
  }
  const gameIds = stringList(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest(value) {
  const record = recordOf(value);
  if (record === void 0 || Object.keys(record).some((key) => !REQUEST_KEYS.has(key))) {
    return void 0;
  }
  return nonEmptyString(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchDataCatalogFacets(context) {
  const offer = parseOffer(context.offerFacet);
  const request = parseRequest(context.requestFacet);
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
var RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
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
      })
    })
  })
});
function isResolvedDataWorkspace(value) {
  const record = recordOf(value);
  return record?.["contract"] === RESOLVED_DATA_WORKSPACE_CONTRACT && nonEmptyString(record["providerId"]) && stringList(record["gameIds"]) !== void 0 && typeof record["plan"] === "function" && typeof record["analyze"] === "function" && typeof record["openSchemaTree"] === "function" && typeof record["openDefinitionTable"] === "function" && typeof record["openLocalizationTable"] === "function" && typeof record["openRelations"] === "function";
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
function createResolvedDataSubjectSelectorLease(analyzed, inputLimits) {
  if (analyzed.openSubjectFacts === void 0 || analyzed.openSubjectCalculations === void 0) {
    return void 0;
  }
  const openSubjectFacts = analyzed.openSubjectFacts;
  const openSubjectCalculations = analyzed.openSubjectCalculations;
  const limits = Object.freeze({
    maxPageSize: positiveBound(inputLimits.maxPageSize, "maxPageSize"),
    maxEntities: positiveBound(inputLimits.maxEntities, "maxEntities"),
    maxRelations: positiveBound(inputLimits.maxRelations, "maxRelations"),
    maxCalculations: positiveBound(inputLimits.maxCalculations, "maxCalculations")
  });
  const snapshot = analyzed.snapshot;
  const localized = new Map(snapshot.localizedStrings.map((item) => [item.key, item.value]));
  const subjects = Object.freeze(
    snapshot.definitions.map((entity) => {
      const authoredName = entity.fields["Name"];
      const label = typeof authoredName === "string" ? localized.get(authoredName) ?? entity.entityId : entity.entityId;
      return Object.freeze({
        subjectId: `${entity.namespace}/${entity.entityId}`,
        label,
        kind: entity.namespace,
        type: entity.typeId
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
    const filtered = subjects.filter(
      (subject) => (request.kind === void 0 || subject.kind === request.kind) && (request.type === void 0 || subject.type === request.type) && (text === void 0 || text.length === 0 || subject.subjectId.toLocaleLowerCase("en-US").includes(text) || subject.label.toLocaleLowerCase("en-US").includes(text))
    );
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
    async openFacts(subjectId, signal) {
      const subject = selected(subjectId, signal);
      return openSubjectFacts({
        subject: {
          namespace: subject.kind,
          entityId: subject.subjectId.slice(subject.kind.length + 1)
        },
        ...limits,
        ...signal === void 0 ? {} : { signal }
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
    const rootPath = confinedPath(root.root.sourcePath, `${requirement.requirementId}.root`);
    const path = confinedPath(requirement.path, `${requirement.requirementId}.path`);
    const foldedRoot = rootPath.toLocaleLowerCase();
    const foldedPath = path.toLocaleLowerCase();
    if (foldedPath !== foldedRoot && !foldedPath.startsWith(`${foldedRoot}/`)) {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} escapes its root`
      );
    }
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
    const content = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      state: "resolved",
      text: new TextDecoder("utf-8", { fatal: false }).decode(content),
      revision: resolved.revision
    };
  } finally {
    await resolved.lease.release();
  }
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
    const plan = await resolution.workspace.plan({
      workspace: request.workspace,
      locales: request.locales,
      maxRequirements: limits.maxRequirements,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    validateWorkspacePlan(plan, request.workspace, request.locales, limits.maxRequirements);
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
      textBytes += new TextEncoder().encode(loaded.text).byteLength;
      if (textBytes > limits.maxTextBytes) {
        throw new TypeError(`workspace data exceeds maxTextBytes ${limits.maxTextBytes}`);
      }
      revisions.push(`${requirement.requirementId}@${String(loaded.revision)}`);
      const document2 = {
        rootId: requirement.rootId,
        path: requirement.path,
        text: loaded.text,
        revision: loaded.revision
      };
      if (requirement.kind === "catalog") documents.push(document2);
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
      locales: request.locales,
      localizationKeys: request.localizationKeys ?? [],
      queries: request.queries,
      plannedDocumentCount: documents.length + localizationDocuments.length + unresolvedRequirementIds.length,
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
      diagnostics: Object.freeze(diagnostics),
      async release() {
        if (released) return;
        released = true;
        const results = await Promise.allSettled([
          ...[...opened].reverse().map((lease) => lease.release()),
          resolution.release()
        ]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
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
function positiveLimit(value, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`world page limit must be between 1 and ${maximum}`);
  }
  return value;
}
function resourceId(namespace, entityId) {
  return `resource:${encodeURIComponent(namespace)}/${encodeURIComponent(entityId)}`;
}
function layerId(snapshotId, kind) {
  return `${snapshotId}:layer:${kind}`;
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
  const center = numericPair(shape.parameters["center"]);
  const radiusValue = shape.parameters["radius"];
  const radius = radiusValue === void 0 ? void 0 : Number(radiusValue);
  return Object.freeze({
    kind: shape.type,
    ...center === void 0 ? {} : { center },
    ...radius !== void 0 && Number.isFinite(radius) ? { radius } : {},
    rawParameters: shape.parameters
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
  const vertical = "vertData" in transform ? (sample.heightBase * transform.vertData.quantizeScale - transform.vertData.quantizeBias) * transform.heightMap.scale.z + transform.heightMap.offset.z + (sample.heightAdjustment * transform.vertData.quantizeScale - transform.vertData.quantizeBias) : sample.heightBase * transform.heightMap.scale.z + transform.heightMap.offset.z;
  return Object.freeze({
    x: transform.heightMap.offset.x + sample.x * transform.heightMap.scale.x,
    y: transform.heightMap.offset.y + sample.y * transform.heightMap.scale.y,
    z: vertical
  });
}
function canonicalPosition(position, transform) {
  const axis = (output) => {
    const mapping = transform.axes[output];
    const value = position[mapping.sourceAxis] * mapping.scale + mapping.offset;
    return value === 0 ? 0 : value;
  };
  return Object.freeze({ x: axis("x"), y: axis("y"), z: axis("z") });
}
function admittedTerrainTransform(snapshot, terrain, exact) {
  const transform = snapshot.terrainTransform;
  if (transform === void 0 || terrain === void 0 || !exact) return void 0;
  const finite = (value) => Number.isFinite(value);
  const positive = (value) => finite(value) && value > 0;
  const verticalMappingValid = (value) => {
    if ("vertData" in value) {
      return finite(value.vertData.quantizeBias) && positive(value.vertData.quantizeScale) && finite(value.vertData.standardHeight) && value.mapping.vertical === "dequantized-base-times-scale-plus-offset-plus-dequantized-adjustment";
    }
    return value.mapping.vertical === "direct-base-times-scale-plus-offset" && value.source.format.length > 0 && value.source.heightEncoding.length > 0 && terrain.samples.every((sample) => sample.heightAdjustment === 0);
  };
  if (transform.schemaVersion !== 1 || !Number.isSafeInteger(transform.descriptorVersion) || transform.descriptorVersion <= 0 || transform.snapshotId !== snapshot.snapshotId || transform.heightMap.dim.length !== 2 || transform.heightMap.dim[0] !== terrain.width || transform.heightMap.dim[1] !== terrain.height || !Object.values(transform.heightMap.offset).every(finite) || !Object.values(transform.heightMap.scale).every(positive) || transform.mapping.horizontal !== "offset-plus-grid-index-times-scale" || !verticalMappingValid(transform) || transform.bounds.coordinateSpaceId !== "map-native") {
    return void 0;
  }
  let minimum = { x: Infinity, y: Infinity, z: Infinity };
  let maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const sample of terrain.samples) {
    const position = terrainMapNativePosition(sample, transform);
    if (!Object.values(position).every(finite)) return void 0;
    minimum = {
      x: Math.min(minimum.x, position.x),
      y: Math.min(minimum.y, position.y),
      z: Math.min(minimum.z, position.z)
    };
    maximum = {
      x: Math.max(maximum.x, position.x),
      y: Math.max(maximum.y, position.y),
      z: Math.max(maximum.z, position.z)
    };
  }
  return ["x", "y", "z"].every(
    (axis) => transform.bounds.minimum[axis] === minimum[axis] && transform.bounds.maximum[axis] === maximum[axis]
  ) ? transform : void 0;
}
function admittedWorldCanonicalTransform(snapshot, terrainTransform) {
  const transform = snapshot.uvwTransform;
  if (transform === void 0 || terrainTransform === void 0) return void 0;
  const finite = (value) => Number.isFinite(value);
  const positive = (value) => finite(value) && value > 0;
  const basis = transform.basis;
  const axes = Object.values(transform.axes);
  const sourceAxes = axes.map((item) => item.sourceAxis);
  if (transform.schemaVersion !== 1 || transform.snapshotId !== snapshot.snapshotId || transform.sourceCoordinateSpaceId !== "map-native" || transform.targetCoordinateSpaceId !== "uvw-canonical" || basis.handedness !== "right" || basis.upAxis !== "y" || basis.forwardAxis !== "+z" || basis.unit !== "meter" && basis.unit !== "source-unit" || basis.unit === "source-unit" && (basis.sourceUnit === void 0 || basis.sourceUnit.length === 0 || basis.metersPerUnit !== void 0) || basis.unitsPerCell !== void 0 && !positive(basis.unitsPerCell) || axes.some((item) => !finite(item.scale) || item.scale === 0 || !finite(item.offset)) || new Set(sourceAxes).size !== 3 || !Number.isSafeInteger(transform.heightfield.columns) || !Number.isSafeInteger(transform.heightfield.rows) || transform.heightfield.columns !== terrainTransform.heightMap.dim[0] || transform.heightfield.rows !== terrainTransform.heightMap.dim[1] || !positive(transform.heightfield.cellSize) || basis.unitsPerCell !== void 0 && basis.unitsPerCell !== transform.heightfield.cellSize || transform.heightfield.origin.length !== 3 || !transform.heightfield.origin.every(finite) || transform.heightfield.sourceRowOrder !== "reverse" || transform.bounds.coordinateSpaceId !== "uvw-canonical" || !Object.values(transform.bounds.minimum).every(finite) || !Object.values(transform.bounds.maximum).every(finite) || !["x", "y", "z"].every(
    (axis) => transform.bounds.minimum[axis] <= transform.bounds.maximum[axis]
  ) || !Number.isSafeInteger(transform.proof.tupleCount) || transform.proof.tupleCount <= 0 || transform.proof.kind !== "adapter-qualification" || transform.proof.oracle.length === 0 || transform.proof.corpus.length === 0 || Object.keys(transform.proof.sourceDigests).length === 0 || !Object.values(transform.proof.sourceDigests).every(
    (value) => /^sha256:[0-9a-f]{64}$/u.test(value)
  ) || !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.nativeTupleDigest) || transform.proof.presentationTupleDigest !== void 0 && !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.presentationTupleDigest) || !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.canonicalTupleDigest) || transform.proof.comparison !== "ieee-754-binary64-exact") {
    return void 0;
  }
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
  ) ? transform : void 0;
}
function createCandidateWorldSceneLease(snapshot, provenance, maxPageSize) {
  positiveLimit(maxPageSize, Number.MAX_SAFE_INTEGER);
  const semantic = snapshot.semantic;
  const terrainLayerId = layerId(snapshot.snapshotId, "terrain");
  const objectLayerId = layerId(snapshot.snapshotId, "objects");
  const regionLayerId = layerId(snapshot.snapshotId, "regions");
  const resourceLayerId = layerId(snapshot.snapshotId, "resources");
  const navigationLayerId = layerId(snapshot.snapshotId, "navigation");
  const terrainSummary = semantic.terrain;
  const terrainExact = hasExactTerrainGrid(terrainSummary);
  const terrainTransform = admittedTerrainTransform(snapshot, terrainSummary, terrainExact);
  const uvwTransform = admittedWorldCanonicalTransform(snapshot, terrainTransform);
  const terrainLod = terrainExact ? "exact" : "sampled";
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
  const duplicateObjectCount = semantic.objects.length - semanticObjects.length;
  const duplicateRegionCount = semantic.regions.length - semanticRegions.length;
  const incompleteObjectPositionCount = semanticObjects.filter(
    (item) => item.sourcePositionDimensions === 2
  ).length;
  const terrain = Object.freeze(
    (semantic.terrain?.samples ?? []).map((item) => {
      const mapNativePosition = terrainTransform === void 0 ? void 0 : terrainMapNativePosition(item, terrainTransform);
      return Object.freeze({
        facet: "terrain",
        id: `${terrainLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: terrainLayerId,
        coordinateSpaceId: "height-grid",
        lod: terrainLod,
        ...item,
        ...mapNativePosition === void 0 ? {} : { mapNativePosition },
        ...mapNativePosition === void 0 || uvwTransform === void 0 ? {} : { uvwPosition: canonicalPosition(mapNativePosition, uvwTransform) }
      });
    })
  );
  const objects = Object.freeze(
    semanticObjects.map((item) => {
      const id = `${objectLayerId}:object:${String(item.objectId)}`;
      const ref = item.catalog?.ref;
      return Object.freeze({
        facet: "objects",
        id,
        layerId: objectLayerId,
        coordinateSpaceId: "map-native",
        ...item,
        ...ref === void 0 ? {} : { resourceId: resourceId(ref.namespace, ref.entityId) }
      });
    })
  );
  const regions = Object.freeze(
    semanticRegions.map(
      (item) => Object.freeze({
        facet: "regions",
        id: `${regionLayerId}:region:${String(item.regionId)}`,
        layerId: regionLayerId,
        coordinateSpaceId: "map-native",
        regionId: item.regionId,
        name: item.name,
        ...item.color === void 0 ? {} : { color: item.color },
        shapes: Object.freeze(item.shapes.map(regionShape))
      })
    )
  );
  const resourceJoins = /* @__PURE__ */ new Map();
  for (const item of objects) {
    if (item.facet !== "objects" || item.catalog === void 0) continue;
    const key = resourceId(item.catalog.ref.namespace, item.catalog.ref.entityId);
    const current = resourceJoins.get(key) ?? {
      namespace: item.catalog.ref.namespace,
      entityId: item.catalog.ref.entityId,
      resolved: item.catalog.entity !== void 0,
      objectIds: []
    };
    current.resolved ||= item.catalog.entity !== void 0;
    current.objectIds.push(item.id);
    resourceJoins.set(key, current);
  }
  const resources = Object.freeze(
    [...resourceJoins.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
      ([id, item]) => Object.freeze({
        facet: "resources",
        id,
        layerId: resourceLayerId,
        namespace: item.namespace,
        entityId: item.entityId,
        resolved: item.resolved,
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
  const facets = Object.freeze([
    Object.freeze({
      facet: "terrain",
      layerId: terrainLayerId,
      state: terrainSummary === void 0 ? "unavailable" : terrainExact ? "available" : "partial",
      itemCount: semantic.terrain?.cellCount ?? 0,
      lods: Object.freeze(
        terrainSummary === void 0 ? [] : terrainExact ? ["exact"] : ["summary", "sampled"]
      ),
      ...terrainSummary === void 0 ? { reason: "authoritative semantic snapshot contains no terrain height grid" } : terrainExact ? {} : {
        reason: "candidate exposes bounded deterministic samples, not the full native grid"
      }
    }),
    Object.freeze({
      facet: "objects",
      layerId: objectLayerId,
      state: semanticObjects.length === 0 ? "unavailable" : duplicateObjectCount > 0 || incompleteObjectPositionCount > 0 ? "partial" : "available",
      itemCount: semanticObjects.length,
      lods: Object.freeze(["exact"]),
      ...semanticObjects.length === 0 ? { reason: "semantic snapshot contains no objects" } : duplicateObjectCount > 0 || incompleteObjectPositionCount > 0 ? {
        reason: [
          ...duplicateObjectCount > 0 ? [`${duplicateObjectCount} duplicate object identities were omitted`] : [],
          ...incompleteObjectPositionCount > 0 ? [
            `${incompleteObjectPositionCount} objects publish two-dimensional source positions; elevation remains unknown`
          ] : []
        ].join("; ")
      } : {}
    }),
    Object.freeze({
      facet: "regions",
      layerId: regionLayerId,
      state: semanticRegions.length === 0 ? "unavailable" : duplicateRegionCount > 0 ? "partial" : "available",
      itemCount: semanticRegions.length,
      lods: Object.freeze(["exact"]),
      ...semanticRegions.length === 0 ? { reason: "semantic snapshot contains no regions" } : duplicateRegionCount > 0 ? { reason: `${duplicateRegionCount} duplicate region identities were omitted` } : {}
    }),
    Object.freeze({
      facet: "resources",
      layerId: resourceLayerId,
      state: resources.length === 0 ? "unavailable" : "available",
      itemCount: resources.length,
      lods: Object.freeze(["exact"]),
      ...resources.length === 0 ? { reason: "no placed object publishes a catalog resource reference" } : {}
    }),
    Object.freeze({
      facet: "navigation",
      layerId: navigationLayerId,
      state: snapshot.navigation === void 0 ? "unavailable" : "partial",
      itemCount: snapshot.navigation?.cellCount ?? 0,
      lods: Object.freeze(snapshot.navigation === void 0 ? [] : ["summary", "sampled"]),
      ...snapshot.navigation === void 0 ? { reason: "publisher reported navigation unavailable" } : { reason: "native flags are sampled and their bit semantics remain publisher-defined" }
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
        lods: item.lods
      })
    )
  );
  const byFacet = /* @__PURE__ */ new Map([
    ["layers", layers],
    ["terrain", terrain],
    ["objects", objects],
    ["regions", regions],
    ["resources", resources],
    ["navigation", navigation]
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
      })
    ]),
    ...terrainTransform === void 0 ? {} : { terrainTransform },
    ...uvwTransform === void 0 ? {} : { uvwTransform },
    facets,
    provenance: Object.freeze(provenance.map((item) => Object.freeze({ ...item }))),
    unknownFacets: snapshot.worldCandidate.unknownFacets,
    lossPolicy: "explicit-partial",
    complete: snapshot.complete && duplicateObjectCount === 0 && duplicateRegionCount === 0 && incompleteObjectPositionCount === 0
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
        const expectedLod = request.facet === "terrain" ? terrainLod : request.facet === "navigation" ? "sampled" : void 0;
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
      if (request.bounds !== void 0 && (request.facet === "layers" || request.facet === "regions" || request.facet === "resources")) {
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
        if (item.facet !== "terrain" && item.facet !== "navigation") return false;
        if (item.facet === "terrain" && item.mapNativePosition !== void 0) {
          return item.mapNativePosition.x >= bounds.minimumX && item.mapNativePosition.x <= bounds.maximumX && item.mapNativePosition.y >= bounds.minimumY && item.mapNativePosition.y <= bounds.maximumY;
        }
        return item.x >= bounds.minimumX && item.x <= bounds.maximumX && item.y >= bounds.minimumY && item.y <= bounds.maximumY;
      });
      return Promise.resolve(pageItems(bounded, request, snapshot.snapshotId, maxPageSize));
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
var OFFER_KEYS2 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS2 = /* @__PURE__ */ new Set(["gameId"]);
var PREVIEW_OFFER_KEYS = /* @__PURE__ */ new Set(["subjectFormatIds"]);
var PREVIEW_REQUEST_KEYS = /* @__PURE__ */ new Set(["subjectFormatId"]);
function recordOf2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString2(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList2(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString2)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer2(value) {
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key) => !OFFER_KEYS2.has(key))) {
    return void 0;
  }
  const gameIds = stringList2(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest2(value) {
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key) => !REQUEST_KEYS2.has(key))) {
    return void 0;
  }
  return nonEmptyString2(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchMapSemanticFacets(context) {
  const offer = parseOffer2(context.offerFacet);
  const request = parseRequest2(context.requestFacet);
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
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key) => !PREVIEW_OFFER_KEYS.has(key))) {
    return void 0;
  }
  const subjectFormatIds = stringList2(record["subjectFormatIds"]);
  return subjectFormatIds === void 0 ? void 0 : { subjectFormatIds };
}
function parsePreviewRequest(value) {
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key) => !PREVIEW_REQUEST_KEYS.has(key))) {
    return void 0;
  }
  return nonEmptyString2(record["subjectFormatId"]) ? { subjectFormatId: record["subjectFormatId"] } : void 0;
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
var RESOLVED_MAP_WORKSPACE_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
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
      $ref: "https://schemas.modkitx.org/x3/map-preview-preparation-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-preview-preparation-request.v1.schema.json"
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
function isResolvedMapWorkspace(value) {
  const record = recordOf2(value);
  return record?.["contract"] === RESOLVED_MAP_WORKSPACE_CONTRACT && nonEmptyString2(record["analyzerId"]) && stringList2(record["gameIds"]) !== void 0 && typeof record["plan"] === "function" && typeof record["analyze"] === "function";
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
  const record = recordOf2(value);
  return record?.["contract"] === MAP_PREVIEW_PREPARATION_CONTRACT && nonEmptyString2(record["preparationId"]) && stringList2(record["subjectFormatIds"]) !== void 0 && typeof record["prepare"] === "function";
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
  if (plan.schemaVersion !== 1 || plan.workspaceId !== workspace.workspaceId || plan.gameId !== workspace.gameId || !nonEmptyString2(plan.analyzerId) || !Array.isArray(plan.requirements) || plan.requirements.length > maxRequirements) {
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
    if (!nonEmptyString2(requirement.requirementId) || !nonEmptyString2(requirement.kind) || typeof requirement.required !== "boolean" || path !== requirement.path || !path.startsWith(prefix) || path.slice(prefix.length).includes("/") || path.split("/").some((segment) => segment === "." || segment === "..") || ids.has(requirement.requirementId) || paths.has(path.toLowerCase())) {
      throw new TypeError("workspace map plan contains a duplicate, non-confined or invalid read");
    }
    ids.add(requirement.requirementId);
    paths.add(path.toLowerCase());
  }
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
    const plan = await resolution.workspace.plan({
      workspace: request.workspace,
      maxRequirements: limits.maxRequirements,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    validateWorkspacePlan2(plan, request.workspace, limits.maxRequirements);
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
        diagnostics: boundedDiagnostics(diagnostics, limits.maxDiagnostics)
      };
    }
    const provenanceOffset = request.resources.provenance().length;
    const documents = [];
    const revisions = [];
    const unresolvedRequirementIds = [];
    let totalBytes = 0;
    for (const requirement of plan.requirements) {
      request.signal?.throwIfAborted();
      const loaded = await readResourceBytes(
        request.resources,
        requirement,
        limits.maxDocumentBytes,
        limits.maxTotalBytes - totalBytes,
        request.signal
      );
      totalBytes += loaded.consumedBytes;
      if (loaded.state === "unresolved") {
        diagnostics.push(loaded.diagnostic);
        unresolvedRequirementIds.push(requirement.requirementId);
        continue;
      }
      if (totalBytes > limits.maxTotalBytes) {
        throw new TypeError(`workspace map documents exceed maxTotalBytes ${limits.maxTotalBytes}`);
      }
      documents.push(loaded.document);
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
      `map=${encodeURIComponent(plan.mapId)}`,
      ...revisions
    ].join("|");
    const snapshot = await resolution.workspace.analyze({
      workspaceId: request.workspace.workspaceId,
      gameId: request.workspace.gameId,
      mapId: plan.mapId,
      documents,
      ...request.catalog === void 0 ? {} : { catalog: request.catalog },
      maxDocuments: limits.maxRequirements,
      maxDocumentBytes: limits.maxDocumentBytes,
      maxTotalBytes: limits.maxTotalBytes,
      maxObjects: limits.maxObjects,
      maxRegions: limits.maxRegions,
      maxTerrainCells: limits.maxTerrainCells,
      maxTerrainSamples: limits.maxTerrainSamples,
      maxDepth: limits.maxDepth,
      maxDiagnostics: limits.maxDiagnostics,
      snapshotId,
      unresolvedRequirementIds,
      requiredRequirementIds: plan.requirements.filter((item) => item.required).map((item) => item.requirementId),
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (request.resources.state() !== "live") {
      throw new Error("resource session was disposed while workspace map was analyzed");
    }
    const world = createCandidateWorldSceneLease(
      snapshot,
      request.resources.provenance().slice(provenanceOffset),
      limits.maxPageSize
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
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
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
    snapshotId: candidate.snapshotId,
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
  const record = recordOf2(value);
  return record !== void 0 && Object.keys(record).every(
    (key) => ["code", "severity", "message", "path", "data"].includes(key)
  ) && nonEmptyString2(record["code"]) && PREVIEW_DIAGNOSTIC_SEVERITIES.has(String(record["severity"])) && nonEmptyString2(record["message"]) && (!Object.hasOwn(record, "path") || Array.isArray(record["path"]) && record["path"].every((item) => typeof item === "string" || Number.isSafeInteger(item))) && (!Object.hasOwn(record, "data") || jsonSafeValue(record["data"]));
}
function validNamespaceSearchQuery(value) {
  const query = recordOf2(value);
  if (query === void 0 || !Object.keys(query).every(
    (key) => key === "kind" || key === "basenames" || key === "caseSensitive"
  ) || query["kind"] !== "basename-any" || !Array.isArray(query["basenames"]) || query["basenames"].length === 0 || query["basenames"].length > MAX_PREVIEW_NAMESPACE_SEARCH_BASENAMES || typeof query["caseSensitive"] !== "boolean") {
    return false;
  }
  const basenames = query["basenames"];
  const validBasenames = basenames.every(
    (item) => nonEmptyString2(item) && item.length <= MAX_PREVIEW_NAMESPACE_SEARCH_BASENAME_CHARS && !item.includes("/") && !item.includes("\\") && !item.includes("\0") && item !== "." && item !== ".."
  );
  if (!validBasenames) return false;
  const identityBasenames = query["caseSensitive"] ? basenames : basenames.map((item) => item.toLowerCase());
  return new Set(identityBasenames).size === basenames.length;
}
function validateNamespaceSearchRequests(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PREVIEW_NAMESPACE_SEARCHES || !value.every((item) => {
    const search = recordOf2(item);
    return search !== void 0 && Object.keys(search).every((key) => key === "searchId" || key === "query") && nonEmptyString2(search["searchId"]) && search["searchId"].length <= MAX_PREVIEW_NAMESPACE_SEARCH_ID_CHARS && !search["searchId"].includes("\0") && validNamespaceSearchQuery(search["query"]);
  }) || new Set(value.map((item) => String(recordOf2(item)?.["searchId"] ?? ""))).size !== value.length) {
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
    const document2 = recordOf2(item);
    if (document2 === void 0 || !Object.keys(document2).every(
      (key) => key === "documentId" || key === "path" || key === "maxBytes"
    ) || !nonEmptyString2(document2["documentId"]) || document2["documentId"].length > 256 || document2["documentId"].includes("\0") || !nonEmptyString2(document2["path"]) || document2["path"].length > MAX_PREVIEW_NAMESPACE_PATH_CHARS || document2["path"].includes("\0") || document2["path"].startsWith("/") || /^[a-z]:/iu.test(document2["path"]) || document2["path"].replace(/\\/gu, "/").split("/").some((part) => part === "..") || !Number.isSafeInteger(document2["maxBytes"]) || Number(document2["maxBytes"]) <= 0 || Number(document2["maxBytes"]) > MAX_PREVIEW_DOCUMENT_READ_BYTES) {
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
function jsonSafeValue(value, depth = 0) {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => jsonSafeValue(item, depth + 1));
  const record = recordOf2(value);
  return record !== void 0 && Object.values(record).every((item) => jsonSafeValue(item, depth + 1));
}
function validHostResourceRoot(value) {
  const record = recordOf2(value);
  return record !== void 0 && Object.keys(record).every((key) => key === "rootId" || key === "locator") && nonEmptyString2(record["rootId"]) && Object.hasOwn(record, "locator") && jsonSafeValue(record["locator"]);
}
function validSubjectNamespaceRoot(value) {
  const record = recordOf2(value);
  return record !== void 0 && Object.keys(record).every((key) => key === "rootId" || key === "namespacePrefix") && nonEmptyString2(record["rootId"]) && typeof record["namespacePrefix"] === "string";
}
function validateResourcePlan(value, maxRoots) {
  const plan = recordOf2(value);
  if (plan?.["schemaVersion"] !== 1) {
    throw new TypeError("map preview preparation returned no versioned resource plan");
  }
  if (plan["strategy"] === "subject-namespace") {
    const roots = plan["roots"];
    if (!Object.keys(plan).every(
      (key) => key === "schemaVersion" || key === "strategy" || key === "roots"
    ) || !Array.isArray(roots) || roots.length === 0 || roots.length > maxRoots || !roots.every(validSubjectNamespaceRoot) || new Set(roots.map((item) => String(recordOf2(item)?.["rootId"] ?? ""))).size !== roots.length) {
      throw new TypeError("map preview preparation returned invalid subject namespace roots");
    }
    return value;
  }
  if (plan["strategy"] === "host-resolved") {
    const roots = plan["roots"];
    const subjectRoots = plan["subjectNamespaceRoots"];
    if (!Object.keys(plan).every(
      (key) => ["schemaVersion", "strategy", "resolverId", "subjectNamespaceRoots", "roots"].includes(key)
    ) || !nonEmptyString2(plan["resolverId"]) || !Array.isArray(subjectRoots) || !subjectRoots.every(validSubjectNamespaceRoot) || !Array.isArray(roots) || roots.length === 0 || roots.length + subjectRoots.length > maxRoots || !roots.every(validHostResourceRoot) || new Set([...subjectRoots, ...roots].map((item) => String(recordOf2(item)?.["rootId"] ?? ""))).size !== roots.length + subjectRoots.length) {
      throw new TypeError("map preview preparation returned invalid host resource roots");
    }
    return value;
  }
  throw new TypeError("map preview preparation returned an unknown resource strategy");
}
function validatePreparationResult(value, maxCandidates, maxRoots) {
  const record = recordOf2(value);
  if (record === void 0 || !Array.isArray(record["diagnostics"]) || !record["diagnostics"].every(validPreparationDiagnostic)) {
    throw new TypeError("map preview preparation returned malformed diagnostics");
  }
  if (record["state"] === "not-applicable" || record["state"] === "unresolved") {
    if (!Object.keys(record).every((key) => key === "state" || key === "diagnostics")) {
      throw new TypeError("map preview preparation result contains unknown fields");
    }
    return value;
  }
  if (record["state"] === "selection-required") {
    const candidates = record["candidates"];
    if (!Object.keys(record).every(
      (key) => key === "state" || key === "candidates" || key === "diagnostics"
    ) || !Array.isArray(candidates) || candidates.length === 0 || candidates.length > maxCandidates || !candidates.every((candidate) => {
      const item = recordOf2(candidate);
      return item !== void 0 && Object.keys(item).every(
        (key) => key === "candidateId" || key === "displayName" || key === "sourcePath"
      ) && nonEmptyString2(item["candidateId"]) && nonEmptyString2(item["displayName"]) && (!Object.hasOwn(item, "sourcePath") || nonEmptyString2(item["sourcePath"]));
    }) || new Set(candidates.map((candidate) => String(recordOf2(candidate)?.["candidateId"] ?? ""))).size !== candidates.length) {
      throw new TypeError("map preview preparation returned invalid selection candidates");
    }
    return value;
  }
  if (record["state"] === "namespace-search-required") {
    if (!Object.keys(record).every(
      (key) => key === "state" || key === "searches" || key === "diagnostics"
    )) {
      throw new TypeError("map preview preparation search result contains unknown fields");
    }
    validateNamespaceSearchRequests(record["searches"]);
    return value;
  }
  if (record["state"] === "document-read-required") {
    if (!Object.keys(record).every(
      (key) => key === "state" || key === "documents" || key === "diagnostics"
    )) {
      throw new TypeError("map preview preparation document-read result contains unknown fields");
    }
    validateDocumentReadRequests(record["documents"]);
    return value;
  }
  if (record["state"] === "prepared") {
    const plan = recordOf2(record["plan"]);
    if (!Object.keys(record).every(
      (key) => key === "state" || key === "plan" || key === "diagnostics"
    ) || plan?.["schemaVersion"] !== 1 || recordOf2(plan["workspace"]) === void 0 || !jsonSafeValue(plan["workspace"]) || !Object.keys(plan).every(
      (key) => key === "schemaVersion" || key === "workspace" || key === "resources"
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
  if (!nonEmptyString2(formatId)) {
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
    return Object.freeze({
      state: "resolved",
      origin: createWorkspaceNamespaceCompanionOrigin({
        namespace: namespaceLease.value,
        primaryLogicalId: request.activeSourcePath,
        logicalRoots,
        containerRevision: request.descriptor.revision,
        extract
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
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        diagnostic(
          "error",
          "x3.host/map-preview-resource-root-mismatch",
          "the resource plan must map every resolved workspace root exactly once"
        )
      ])
    };
  }
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
  const releasePreparedResources = releaseOnce(resourceResolution.release);
  let resources;
  try {
    resources = createResourceSession({
      origin: resourceResolution.origin,
      revision: resourceResolution.revision
    });
    const enrichment = await enrichMapPreviewCatalog(request, workspace, resources);
    const opened = await openMapPreviewAssetSession({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      workspace,
      resources,
      subjectUri: descriptor.subjectUri,
      ...enrichment.catalog === void 0 ? {} : { catalog: enrichment.catalog },
      ...enrichment.sources === void 0 ? {} : { catalogSources: enrichment.sources },
      limits: request.limits,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (opened.state === "unresolved") {
      await releasePreparedResources();
      return {
        state: "unresolved",
        diagnostics: Object.freeze([
          ...preparationFindings,
          ...workspaceDiagnostics(workspace),
          ...resourceResolution.diagnostics,
          ...enrichment.diagnostics,
          ...opened.diagnostics
        ])
      };
    }
    return Object.freeze({
      ...opened,
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
        ...opened.diagnostics
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
var MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY = Object.freeze({
  locales: Object.freeze(["enUS"]),
  limits: Object.freeze({
    // A multi-root workspace may need hundreds of bounded reads across catalog families and locale.
    maxRequirements: 512,
    maxDocumentBytes: 16777216,
    maxTextBytes: 268435456,
    maxEntities: 1e5,
    maxDepth: 128,
    maxPageSize: 1e3
  })
});
var COORDINATOR_LIMITS = Object.freeze({
  // Pinned mp.wz publishes 39 map candidates; 64 is the bounded product ceiling above that corpus.
  maxCandidates: 64,
  maxSubjectEntries: 4096,
  maxSubjectPages: 64,
  maxRoots: 64,
  maxDepth: 16,
  catalogEnrichment: MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY,
  limits: Object.freeze({
    maxRequirements: 8,
    maxDocumentBytes: 1e6,
    maxTotalBytes: 4e6,
    maxObjects: 1e5,
    maxRegions: 1e4,
    maxTerrainCells: 1e5,
    maxTerrainSamples: 1e5,
    maxDepth: 64,
    maxPageSize: 4096,
    maxDiagnostics: 100
  })
});
var selectionDiagnostic = () => diagnostic(
  "information",
  "x3.app/map-preview-selection-required",
  "Map preview needs an explicit selection; choose one of the returned map-preview candidates to continue."
);
var permissionDiagnostic = () => diagnostic(
  "information",
  "x3.app/web-map-preview-permission-required",
  "This map needs installation resources that the browser cannot search for automatically; grant or select them in a desktop host."
);
async function prepareWebMapPreview(request) {
  let result;
  try {
    result = await (request.coordinate ?? coordinateMapPreviewAssetSession)({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      original: request.opened.session,
      ...request.selectionId === void 0 ? {} : { selectionId: request.selectionId },
      ...COORDINATOR_LIMITS,
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
    ...result.state === "selection-required" ? [selectionDiagnostic()] : [],
    ...permissionRequired ? [permissionDiagnostic()] : []
  ]);
  const candidates = result.state === "selection-required" ? Object.freeze(
    result.candidates.map(
      (candidate) => Object.freeze({ kind: "map-preview-selection", ...candidate })
    )
  ) : Object.freeze([]);
  const opened = Object.freeze({
    ...request.opened,
    ...result.state === "opened" ? { descriptor: result.descriptor, session: result.session } : {},
    diagnostics
  });
  return Object.freeze({
    state: permissionRequired ? "permission-required" : result.state,
    opened,
    candidates
  });
}

// apps/web/src/extensions-ui.ts
var USER_EXTENSION_TRUST_SENTENCE = "A folder you add here is trusted because you picked it and for no other reason \u2014 nothing is signed and nobody has reviewed it; this page hashes every file as it reads them so that a file changed afterwards is refused instead of run, and user extensions always run in a worker, never on the page.";
var USER_EXTENSION_PROVENANCE_NOTE = "Bundled extensions carry digests this app recorded when it was built. Folders you added carry digests this page computed itself just now \u2014 a measurement of the bytes it read, not a claim about who wrote them.";
var bundledProvenance = (root) => `Bundled with this build, served from ${root}; its digests were recorded when the app was built.`;
var userProvenance = (label) => `Folder you granted (\xAB${label}\xBB); its digests were computed by this page from the bytes it just read.`;
function describeExtensionList(input) {
  const rows = [];
  for (const entry of input.catalog.extensions) {
    const coordinate = containerCoordinate(entry.containers);
    rows.push({
      kind: "bundled",
      state: "loaded",
      label: entry.name,
      ...coordinate === void 0 ? {} : { coordinate },
      provenance: bundledProvenance(entry.artifactRoot)
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
      provenance: userProvenance(label)
    });
  }
  for (const failure of [...input.loaded.failures, ...input.extraFailures ?? []]) {
    const label = labels.get(failure.rootId) ?? failure.root;
    rows.push({
      kind: "user",
      state: failure.code === EXTENSION_ROOT_FAILURE_CODES.permissionRequired ? "needs-permission" : "failed",
      rootId: failure.rootId,
      label,
      provenance: userProvenance(label),
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
        status = `Added \xAB${handle.name}\xBB${coordinate === void 0 ? "" : ` (${coordinate})`}.`;
        await changed();
      } catch (error) {
        status = `Could not add that folder: ${describe(error)}`;
        render();
      }
    })();
  };
  const remove = (rootId) => {
    void (async () => {
      try {
        await options.store.remove(rootId);
        status = "Removed. The extension is gone from the list; reload to rebuild the host.";
        await changed();
      } catch (error) {
        status = `Could not remove it: ${describe(error)}`;
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
        status = state === "granted" ? `Access to \xAB${record.label}\xBB granted again.` : `Access to \xAB${record.label}\xBB was not granted (${state}).`;
        await changed();
      } catch (error) {
        status = `Could not ask for access: ${describe(error)}`;
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
        status = `Extension action failed: ${describe(error)}`;
      }
      render();
    })();
  };
  const renderManagedExtensions = () => {
    const controller = options.managedExtensions;
    if (controller === void 0) return;
    const model = controller.snapshot();
    element(root, "h3", { text: "Downloadable extensions" });
    element(root, "p", {
      part: "settings.description",
      text: "The catalog is checked only when you ask. Installing stores verified package bytes; nothing on this page imports or runs them."
    });
    const catalogActions = element(root, "div", { part: "settings.adder" });
    button(
      catalogActions,
      "settings.add",
      "Check available extensions",
      () => managedAction(
        () => controller.refreshCatalog(),
        `Extension catalog checked at ${model.catalogLocation}.`
      )
    );
    element(catalogActions, "span", {
      part: "settings.description",
      text: model.catalogLoaded ? `Catalog loaded from ${model.catalogLocation}.` : `Catalog ${model.catalogLocation} has not been contacted in this session.`
    });
    const list = element(root, "div", { part: "settings.list" });
    for (const row of model.rows) {
      const item = element(list, "div", { part: "settings.extension" });
      const text = element(item, "div", { part: "settings.extension-text" });
      element(text, "div", { part: "settings.label", text: row.name });
      const states = [
        row.available ? `Available ${row.availableVersion ?? ""}`.trim() : "Not in catalog",
        row.installed ? `Installed ${row.installedVersion ?? ""}`.trim() : "Not installed",
        row.installed ? row.enabled ? "Enabled" : "Disabled" : void 0,
        row.updateAvailable ? "Update available" : void 0
      ].filter((value) => value !== void 0);
      element(text, "div", { part: "settings.description", text: states.join(" \xB7 ") });
      if (row.description !== void 0) {
        element(text, "div", { part: "settings.description", text: row.description });
      }
      element(text, "div", {
        part: "settings.description",
        text: `${row.trusted ? "Trusted" : "Not trusted"}: ${row.trustReason}`
      });
      if (!row.installed && row.available) {
        const install = button(
          item,
          "settings.add",
          "Install",
          () => managedAction(
            () => controller.install(row.id),
            `Installed ${row.name}. Reload the page to load the changed extension set.`
          )
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
          "Update",
          () => managedAction(
            () => controller.update(row.id),
            `Updated ${row.name}. Reload the page to load the changed extension set.`
          )
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
          row.enabled ? "Disable" : "Enable",
          () => managedAction(
            () => controller.enable(row.id, !row.enabled),
            `${row.enabled ? "Disabled" : "Enabled"} ${row.name}. Reload the page to load the changed extension set.`
          )
        );
        button(
          item,
          "settings.remove",
          "Remove",
          () => managedAction(
            () => controller.remove(row.id),
            `Removed ${row.name}. Reload the page to load the changed extension set.`
          )
        );
      }
    }
    if (model.rows.length === 0) {
      element(root, "p", {
        part: "settings.description",
        text: model.catalogLoaded ? "The catalog contains no extensions." : "No downloaded extensions are installed. Check the catalog to see what is available."
      });
    }
  };
  function render() {
    root.replaceChildren();
    element(root, "h2", { text: "Extensions" });
    element(root, "p", { part: "settings.description", text: USER_EXTENSION_TRUST_SENTENCE });
    element(root, "p", { part: "settings.description", text: USER_EXTENSION_PROVENANCE_NOTE });
    const adder = element(root, "div", { part: "settings.adder" });
    button(adder, "settings.add", "Add a folder\u2026", add);
    element(adder, "span", {
      part: "settings.description",
      text: `Added folders are remembered in ${options.store.location}.`
    });
    const rows = describeExtensionList({
      catalog: options.catalog,
      loaded,
      stored,
      ...options.conflicts === void 0 ? {} : { extraFailures: options.conflicts() }
    });
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
          button(item, "settings.add", "Grant access", () => grant(rootId));
        }
        button(item, "settings.remove", "Remove", () => remove(rootId));
      }
    }
    if (rows.every((row) => row.kind === "bundled")) {
      element(root, "p", {
        part: "settings.description",
        text: "No folders added yet."
      });
    }
    renderManagedExtensions();
    element(root, "p", { part: "settings.status", text: status });
  }
  render();
  return {
    root,
    reload,
    current: () => loaded
  };
}

// apps/web/src/edit-operations.ts
function metadataEntries(descriptor, groupId) {
  if (!("metadata" in descriptor)) return [];
  return descriptor.metadata.find((group) => group.id === groupId)?.entries ?? [];
}
var scalarText = (value) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return void 0;
};
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
  const value = values.get(name) ?? "";
  if (value === "") throw new TypeError(`${label} is required`);
  return value;
};
var field = (name, label, initial, options = {}) => Object.freeze({
  name,
  label,
  kind: options.kind ?? "text",
  initial,
  required: true,
  ...options.hint === void 0 ? {} : { hint: options.hint }
});
var template = (definition) => Object.freeze(definition);
var NO_PREFILL = /* @__PURE__ */ new Map();
function resolveForm(item, descriptor) {
  const prefilled = item.prefill?.(descriptor) ?? NO_PREFILL;
  if (prefilled.size === 0) {
    return Object.freeze({
      id: item.id,
      label: item.label,
      operationId: item.operationId,
      handlerId: item.handlerId,
      summary: item.summary,
      fields: item.fields,
      build: item.build
    });
  }
  return Object.freeze({
    id: item.id,
    label: item.label,
    operationId: item.operationId,
    handlerId: item.handlerId,
    summary: item.summary,
    fields: Object.freeze(
      item.fields.map((entry) => {
        const known = prefilled.get(entry.name);
        if (known === void 0) return entry;
        const hint = known.hint ?? entry.hint;
        return Object.freeze({
          ...entry,
          initial: known.value,
          ...hint === void 0 ? {} : { hint }
        });
      })
    ),
    build: item.build
  });
}
var ID3_TEXT_FRAME = /^T[A-Z0-9]{3}$/u;
var FORMS_BY_HANDLER = /* @__PURE__ */ new Map([
  [
    "set-text",
    Object.freeze([
      template({
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
        prefill: (descriptor) => {
          const entries = metadataEntries(descriptor, "png-text");
          const first = entries[0];
          const value = first === void 0 ? void 0 : scalarText(first.value);
          if (first === void 0 || value === void 0) return NO_PREFILL;
          return /* @__PURE__ */ new Map([
            [
              "keyword",
              {
                value: first.key,
                hint: `this file already carries: ${entries.map((entry) => entry.key).join(", ")}`
              }
            ],
            ["text", { value }]
          ]);
        },
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
      template({
        id: "mp3-set-text-frame",
        label: "Set an ID3v2 text frame",
        operationId: "edit.field",
        handlerId: "set-text-frame",
        summary: "Sets or replaces one ID3v2 text frame, creating the tag when the file has none; the audio is never moved.",
        fields: Object.freeze([
          field("keyword", "Frame", "TIT2", {
            hint: "a four-character text frame id: TIT2, TPE1, TALB, \u2026 (TXXX has another shape)"
          }),
          field("text", "Text", "set from the Modkit inspector")
        ]),
        prefill: (descriptor) => {
          const frames = metadataEntries(descriptor, "id3").filter(
            (entry) => ID3_TEXT_FRAME.test(entry.key)
          );
          const first = frames[0];
          const value = first === void 0 ? void 0 : scalarText(first.value);
          if (first === void 0 || value === void 0) return NO_PREFILL;
          return /* @__PURE__ */ new Map([
            [
              "keyword",
              {
                value: first.key,
                hint: `this tag already carries: ${frames.map((entry) => entry.key).join(", ")}`
              }
            ],
            ["text", { value }]
          ]);
        },
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
      template({
        id: "jpeg-set-comment",
        label: "Set the JPEG comment",
        operationId: "edit.field",
        handlerId: "set-comment",
        summary: "Writes the COM segment after the APP block, replacing it in place if it exists.",
        fields: Object.freeze([field("text", "Comment", "set from the Modkit inspector")]),
        build: (values) => ({ text: values.get("text") ?? "" })
      })
    ])
  ],
  [
    "remove-segment",
    Object.freeze([
      template({
        id: "jpeg-remove-segment",
        label: "Remove a JPEG metadata segment",
        operationId: "edit.structure",
        handlerId: "remove-segment",
        summary: "Drops one metadata segment. A marker that carries the image is refused by the codec.",
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
      template({
        id: "zip-add-entry",
        label: "Add an entry to the archive",
        operationId: "edit.structure",
        handlerId: "edit-structure",
        summary: "Adds one stored entry and repacks the archive; every kept entry is copied byte for byte.",
        fields: Object.freeze([
          field("path", "Entry path", "added/hello.txt", { hint: "a path inside the archive" }),
          field("content", "Contents", "added from the Modkit inspector", {
            kind: "content",
            hint: "one line of text; this host sends it as UTF-8 bytes"
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
      template({
        id: "zip-remove-entry",
        label: "Remove an entry from the archive",
        operationId: "edit.structure",
        handlerId: "edit-structure",
        summary: "Removes one entry and repacks; the other entries keep their exact bytes.",
        fields: Object.freeze([
          field("path", "Entry path", "readme.txt", {
            hint: "the path of an entry the archive already holds"
          })
        ]),
        build: (values) => ({ remove: [required(values, "path", "Entry path")] })
      }),
      template({
        id: "zip-rename-entry",
        label: "Rename an entry in the archive",
        operationId: "edit.structure",
        handlerId: "edit-structure",
        summary: "Renames one entry without touching its data or its compression.",
        fields: Object.freeze([
          field("from", "From", "readme.txt"),
          field("to", "To", "docs/readme.txt", {
            hint: "a file cannot be renamed into a directory marker, or the other way round"
          })
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
      template({
        id: "zip-replace-entry",
        label: "Replace an entry's contents",
        operationId: "edit.content",
        handlerId: "edit-content",
        summary: "Replaces one file entry's payload (stored, fresh CRC); nothing else moves.",
        fields: Object.freeze([
          field("path", "Entry path", "readme.txt"),
          field("content", "Contents", "replaced from the Modkit inspector", {
            kind: "content",
            hint: "one line of text; this host sends it as UTF-8 bytes"
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
  for (const operation of descriptor.operations) {
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
    for (const item of known) forms.push(resolveForm(item, descriptor));
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

// apps/web/src/edit-panel.ts
var REOPENED_NOTE = "the tab was reopened, so this view is not stale";
var NOT_REOPENED_NOTE = "the tab could not be reopened, so a view of it may be stale";
function createEditPanel(options) {
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, "Edit");
      const descriptor = args.descriptor;
      const ports = options.portsFor(descriptor);
      const offer = editOffer(descriptor, { editable: ports !== void 0 });
      const form = element(root, "div", { part: "form" });
      const chooser = element(form, "div", { part: "form.row" });
      element(chooser, "label", { part: "form.label", text: "Operation" });
      const picker = element(chooser, "select", { part: "form.select" });
      if (!(picker instanceof HTMLSelectElement)) throw new TypeError("no select element");
      picker.setAttribute("aria-label", "Mutating operation");
      const summary = element(form, "p", { part: "form.description" });
      const pane = element(form, "div", { part: "form.control" });
      const actions = element(form, "div", { part: "form.actions" });
      const apply = element(actions, "button", { part: "form.button", text: "Apply" });
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
          element(notes, "div", { part: "form.description", text: `Last change: ${previous}` });
        }
        for (const item of offer.unsupported) {
          element(notes, "div", {
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
          setViewerText(summary, "This subject declares no mutating operation this host can drive.");
          apply.setAttribute("disabled", "");
          return;
        }
        apply.removeAttribute("disabled");
        setViewerText(summary, `${chosen.summary} (${chosen.operationId} \u2192 ${chosen.handlerId})`);
        for (const item of chosen.fields) {
          const row = element(pane, "div", { part: "form.row" });
          element(row, "label", { part: "form.label", text: item.label });
          const input = element(row, "input", { part: "form.input" });
          if (!(input instanceof HTMLInputElement)) continue;
          input.type = "text";
          input.name = item.name;
          input.value = item.initial;
          input.setAttribute("aria-label", item.label);
          if (item.hint !== void 0) input.title = item.hint;
          inputs.set(item.name, input);
          if (item.hint !== void 0) {
            element(row, "span", { part: "form.description", text: item.hint });
          }
        }
      };
      const run = async () => {
        const chosen = selectedForm();
        if (chosen === void 0 || ports === void 0) {
          say("this page holds no editing surface for the file, so nothing can be applied", true);
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
          plan = ports.planFromOperation(result.output);
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
        options.recordOutcome(descriptor, `${outcome}; ${REOPENED_NOTE}`);
        say(`${outcome}; reopening the file to show it as it now is`, false);
        if (scope.signal.aborted) return;
        const reopened = await options.reopen(descriptor);
        if (!reopened) {
          options.recordOutcome(descriptor, `${outcome}; ${NOT_REOPENED_NOTE}`);
          if (!scope.signal.aborted) {
            say(`${outcome}; the tab could not be reopened, so this view is stale`, true);
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
        const option = element(picker, "option", { text: item.label });
        option.setAttribute("value", item.id);
      }
      picker.addEventListener("change", drawFields);
      drawFields();
      drawNotes();
      const declared = declaredMutatingOperations(descriptor).length;
      if (offer.forms.length === 0) {
        setState(root, ["degraded"]);
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
          root.remove();
        }
      };
    }
  });
}

// packages/ui/dist/panels/index.js
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
  "model.primitive-selector",
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
  "card.knowledge",
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
function setPart3(element22, part) {
  if (!PART_SET2.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element22.setAttribute(PART_ATTRIBUTE2, part);
}
function setState3(element22, states) {
  for (const state of states) {
    if (!STATE_SET2.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element22.removeAttribute(STATE_ATTRIBUTE2);
  else element22.setAttribute(STATE_ATTRIBUTE2, [...new Set(states)].join(" "));
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
  ([name, value]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value}`
).join("; ");
var VIEWER_CSP_TEXT2 = policyText2(VIEWER_CSP2);
var VIEWER_CSP_TRUSTED_EDITOR_TEXT2 = policyText2(VIEWER_CSP_TRUSTED_EDITOR2);
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
  setPart3(root, "viewer");
  host.replaceChildren(root);
  return root;
}
function element3(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0) node.className = options.className;
  if (options.role !== void 0) node.setAttribute("role", options.role);
  if (options.text !== void 0) setViewerText3(node, options.text);
  if (options.part !== void 0) setPart3(node, options.part);
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
var diagnosticsPanel = defineViewerModule2({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope2(args.signal);
    const root = createSurface2(args.container, "Diagnostics");
    renderDiagnostics(root, args.descriptor);
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      renderDiagnostics(root, descriptor);
    });
  }
});
function renderToolbar(root, descriptor, operations, signal) {
  root.replaceChildren();
  const status = element3(root, "output", { text: "Ready", part: "operations.status" });
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
        onProgress: (completed, total, message) => setViewerText3(status, `${message ?? "Working"}: ${completed}/${total ?? "?"}`)
      }).then(
        (result) => setViewerText3(
          status,
          result.state === "ok" ? `${operation.id}: complete` : result.reason
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
var operationToolbar = defineViewerModule2({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope2(args.signal);
    const root = createSurface2(args.container, "Operations");
    renderToolbar(root, args.descriptor, args.operations, scope.signal);
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      renderToolbar(root, descriptor, args.operations, scope.signal);
    });
  }
});

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
    contributionId: "org.modkitx.app.web/inspector",
    extensionId: "org.modkitx.app.web",
    priority: 100,
    bindings: []
  };
}
function createInspector(document2, options = {}) {
  const root = document2.createElement("div");
  root.className = "web-inspector";
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
        `${needInput.map((operation) => operation.id).join(", ")}: not in the toolbar \u2014 they take an input it does not collect, so a stage or a panel drives them instead.`
      );
    }
    const mutating = declaredMutatingOperations(target.descriptor);
    if (mutating.length > 0 && !target.editable) {
      lines.push(
        `${mutating.map((operation) => operation.id).join(", ")}: no Edit panel \u2014 ` + (target.editNote ?? "this page holds no writable handle for the file.")
      );
    }
    const offer = editOffer(target.descriptor, { editable: target.editable });
    if (offer.forms.length === 0) {
      for (const item of offer.unsupported) {
        lines.push(`${item.operationId}: no form here \u2014 ${item.reason}.`);
      }
    }
    for (const line of lines) element(declined, "p", { part: "form.description", text: line });
  };
  return {
    root,
    async show(target) {
      await unmountAll();
      if (target === void 0) {
        setViewerText(heading, "No file is open.");
        return;
      }
      const offered = nonMutatingDescriptor(target.descriptor);
      const offer = editOffer(target.descriptor, { editable: target.editable });
      setViewerText(
        heading,
        `${target.label} \xB7 ${offered.operations.length} non-mutating operation(s) \xB7 ${offer.forms.length} edit form(s) over ${declaredMutatingOperations(target.descriptor).length} mutating operation(s) \xB7 ${target.descriptor.diagnostics.length} diagnostic(s)`
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
var SETTINGS_STORAGE_KEY = "org.modkitx.app.web/settings";
var EXTENSIONS_READ_ONLY_REASON = "this host has no enable/disable switch for an inventoried extension yet, so the settings extension list cannot be written here; add or remove your own extension folders in the Extensions panel instead";
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

// apps/web/src/shell.ts
var SAMPLES = Object.freeze([
  { path: "./favicon-32.png", label: "favicon-32.png \u2014 PNG image" },
  { path: "./samples/sample.csv", label: "sample.csv \u2014 delimited table" },
  { path: "./samples/sample.ini", label: "sample.ini \u2014 INI tree" },
  { path: "./samples/sample.svg", label: "sample.svg \u2014 vector scene" },
  { path: "./samples/sample.md", label: "sample.md \u2014 markdown document" },
  { path: "./samples/sample.mp3", label: "sample.mp3 \u2014 one second of MP3 silence" },
  { path: "./samples/sample.zip", label: "sample.zip \u2014 container namespace" }
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
  const baseUrl = new URL("./", document.baseURI);
  const pageUrl = new URL(window.location.href);
  const locale = resolveUiLocale(pageUrl.searchParams.get("lang") ?? navigator.languages);
  const localizer = createUiLocalizer(locale);
  const t2 = localizer.text;
  document.documentElement.lang = locale;
  document.title = t2("app.title");
  const booting = document.querySelector(".booting");
  if (booting !== null) setViewerText(booting, t2("app.starting"));
  const capability = describeFileCapability(window);
  const bootDiagnostics = [];
  const bootSessionDiagnostics = [];
  const recoveryHost = {};
  const extensionStore = createIndexedDbExtensionStore(indexedDB);
  const managedRuntime = createBrowserExtensionManager({
    indexedDB,
    ...typeof caches === "undefined" ? {} : { cacheStorage: caches }
    // No registry is configured in the generic PWA build. Product builds inject registry config
    // through the exported factory; this offline default performs no network at boot or refresh.
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
  const host = {};
  const extensionsUi = mountExtensionsUi(document, {
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
    t2("app.title")
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
  const pendingNested = /* @__PURE__ */ new Map();
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
  const inspector = createInspector(document, { editPanel });
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
      const current = await describeEditability(access, entryId);
      if (current.state === "granted" || current.state === "no-permission-surface") return "granted";
      if (current.state !== "prompt") {
        noteEditing(current.sentence);
        return "denied";
      }
      const asked = await requestWriteAccess(access);
      noteEditing(asked.sentence);
      return asked.state === "granted" ? "granted" : asked.state === "denied" ? "denied" : "prompt";
    }
  });
  let openCount = 0;
  const nestedEntryId = (containerKey, entryPath) => `x3-nested:${containerKey}#${entryPath}`;
  const stages = createWebPreviewStages({
    operationsFor: (descriptor) => operationSessions.get(descriptorKey(descriptor)),
    /*
     * The web half of `block9/archive-entry-as-subject` (block 13 slice B).
     *
     * Electron reached this route from its composition and VS Code reached it from its Explorer;
     * this page reached it from nowhere, and its archive stage settled for a hex pane. The route is
     * the host's, unchanged: the parent container stays open and leased for as long as the child
     * lives, so a model inside an archive finds its texture inside that same archive rather than
     * through a file this browser could not open anyway.
     */
    async openNestedEntry(descriptor, entryId, entryPath) {
      const key = descriptorKey(descriptor);
      const parent = assetSessions.get(key);
      if (parent === void 0) return "The session that opened this container is no longer held.";
      const nested = await openNestedSubject({
        parent,
        entryId,
        ...nestedSubjectServices(services),
        grant: { id: `pwa-nested-${openCount}`, classes: ["read-source"] },
        budget: {
          maxInputBytes: BigInt(EXPLORER_MAXIMUM_BYTES),
          maxDepth: 256,
          maxNodes: 1e6,
          maxScalarBytes: 64 * 1024 * 1024,
          maxDiagnostics: 1e4,
          deadlineMs: 3e4
        }
      });
      if (nested.result.state !== "opened") {
        return `${entryPath} \u2014 no codec claimed it inside this container (${nested.result.reason}).`;
      }
      const operations = operationSessions.get(key);
      const extract = descriptor.operations.find(
        (operation) => operation.state === "available" && !operation.mutatesSource && operation.id === CONTAINER_EXTRACT_OPERATION_ID
      );
      let bytes = new Uint8Array();
      if (operations !== void 0 && extract !== void 0) {
        const read = await operations.invoke(extract.handlerId, { entryId }, {});
        if (read.state === "ok" && read.output.kind === "bytes") bytes = read.output.value.slice();
      }
      const id = nestedEntryId(key, entryPath);
      const label = entryPath.slice(entryPath.lastIndexOf("/") + 1);
      pendingNested.set(id, { result: nested.result, bytes, label });
      await editors.open({ id, name: label, directory: false });
      return void 0;
    }
  });
  const previewBase = {
    supported: services.supportedExtensions,
    stages,
    fallback: WEB_PREVIEW_FALLBACK,
    async openSession(entry, bytes, signal) {
      openCount += 1;
      const writable = editability.get(entry.id)?.editable === true;
      const token = pinnedRevisions.get(entry.id) ?? `provider-token:${bytes.byteLength}-${openCount}`;
      const grant = {
        id: `pwa-${openCount}`,
        classes: writable ? ["read-source", "write-source"] : ["read-source"]
      };
      const budget = {
        maxInputBytes: BigInt(EXPLORER_MAXIMUM_BYTES),
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
      if (ordinary.state === "unresolved") {
        say(`${entry.name} \u2014 no codec claimed it (${ordinary.reason}); showing the raw bytes.`);
        return void 0;
      }
      let mapPreview = await prepareWebMapPreview({
        services,
        opened: ordinary,
        grant,
        budgets: budget,
        ...signal === void 0 ? {} : { signal }
      });
      if (mapPreview.state === "selection-required") {
        const choice = window.prompt(
          `Choose a map for the World view by entering its id:

${mapPreview.candidates.map(
            (candidate) => `${candidate.candidateId} \u2014 ${candidate.displayName}${candidate.sourcePath === void 0 ? "" : ` (${candidate.sourcePath})`}`
          ).join("\n")}`,
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
            ...signal === void 0 ? {} : { signal }
          });
        }
      }
      const result = mapPreview.opened;
      if (mapPreview.state === "permission-required") {
        say(
          `${entry.name} \u2014 map preview needs installation resources the browser cannot search; the ordinary archive view remains open.`
        );
      } else if (mapPreview.state === "selection-required") {
        say(
          `${entry.name} \u2014 map preview needs a choice (${mapPreview.candidates.map((candidate) => candidate.displayName).join(", ")}); the ordinary archive view remains open.`
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
      const presentation = await resolveCommonPresentationPlan(
        result.descriptor,
        {
          sessionId: `pwa:${key}`,
          providerId: result.selected.contributionId,
          variantId: result.selected.variantId
        },
        { availableStageIds: stages.map(stageIdOf) }
      );
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
          say(`${entry.name} \u2014 shared commands unavailable: ${String(error)}`);
        }
      }
      operationSessions.set(key, operations);
      assetSessions.set(key, result.session);
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
        ...presentation === void 0 ? {} : { presentation: presentation.plan },
        descriptor: () => session.descriptor(),
        dataSource: (contract, major) => session.dataSource(contract, major),
        async dispose() {
          operationSessions.delete(key);
          assetSessions.delete(key);
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
      const decision = await describeEditability(access, entry.id, entry.name);
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
    preview,
    async confirmClose(entry) {
      return window.confirm(`${entry.name} has unsaved changes. Close the tab and discard them?`) ? "discard" : "cancel";
    },
    async read(entry, signal) {
      const nested = pendingNested.get(entry.id);
      if (nested !== void 0) return nested.bytes;
      if (access === void 0) throw new Error("no folder or file is open");
      const snapshot = await access.snapshotOf(entry.id, signal);
      if (snapshot === void 0) pinnedRevisions.delete(entry.id);
      else pinnedRevisions.set(entry.id, sourceRevisionToken(snapshot));
      const size = access.sizeOf(entry.id) ?? entry.size;
      if (size !== void 0 && size > EXPLORER_MAXIMUM_BYTES) {
        throw new Error(
          `${entry.name} is ${(size / (1024 * 1024)).toFixed(1)} MiB, over the ${EXPLORER_MAXIMUM_BYTES / (1024 * 1024)} MiB this host will read into memory`
        );
      }
      return access.read(entry.id, EXPLORER_MAXIMUM_BYTES, signal);
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
    preview,
    // The tree browses; the editor area owns what is open, so opening is delegated to it.
    onOpen(entry) {
      void editors.open(entry);
    },
    async openFolder() {
      const handle = await pickDirectory();
      if (handle === void 0) {
        say(capability.notice);
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
      const asked = await requestWriteAccess(access);
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
  const store = createWebSettingsStore(window.localStorage);
  const settingsUi = createSettingsUi(document, {
    store,
    themes: appThemes,
    onAppearance(appearance) {
      applyAppearance(document.documentElement, appearance);
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
  element(sidebar, "p", { part: "settings.description", text: capability.notice });
  element(sidebar, "p", { part: "settings.description", text: WEB_EDITING_NOTICE });
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
      text: sample.label
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
  failure.textContent = `Boot failed: ${describe2(error)}`;
  node.append(failure);
});
