import {
  EXPLORER_MAXIMUM_BYTES,
  EXTENSION_ROOT_FAILURE_CODES,
  ViewerMountScope,
  WEB_EDITING_NOTICE,
  WEB_EXTENSION_CATALOG,
  WEB_PREVIEW_FALLBACK,
  catalogCoordinates,
  codecFidelityEvidenceRecords,
  compareUtf8,
  containerCoordinate,
  createBrowserEditingBackend,
  createCodecPreview,
  createDirectoryAccess,
  createEditorArea,
  createEvidenceRegistry,
  createExplorer,
  createIndexedDbExtensionStore,
  createRawWriter,
  createSingleFileAccess,
  createSubjectEditing,
  createSurface,
  createWebPreviewStages,
  createWebSubjectServices,
  createWebTopology,
  defineViewerModule,
  describeFileCapability,
  diagnostic,
  element,
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS,
  isWritableHandle,
  loadUserExtensionRoots,
  mountWebWorkbench,
  presentationSlotId,
  probeWebFacilities,
  requestUserExtensionPermission,
  revisionId,
  setPart,
  setState,
  setViewerText
} from "./chunks/chunk-QVNY3HUK.js";

// apps/web/src/shell.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// packages/ui/dist/settings/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
var SETTINGS_SCHEMA_VERSION = 1;
var DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  appearance: Object.freeze({ theme: "modkit-dark", density: "compact" }),
  extensions: Object.freeze([]),
  recent: Object.freeze([]),
  disabledContributions: Object.freeze([])
});
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var asText = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
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

// apps/web/src/extensions-ui.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
    serve: async (url) => ({
      ok: false,
      status: 404,
      arrayBuffer: () => Promise.reject(new Error(`404 ${url}`))
    })
  };
  let status = "";
  const loadOptions = () => ({
    subtle: options.subtle,
    claimed: catalogCoordinates(options.catalog),
    ...options.maxFiles === void 0 ? {} : { maxFiles: options.maxFiles },
    ...options.maxTotalBytes === void 0 ? {} : { maxTotalBytes: options.maxTotalBytes }
  });
  const reload = async () => {
    stored = await options.store.list();
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
    element(root, "p", { part: "settings.status", text: status });
  }
  render();
  return {
    root,
    reload,
    current: () => loaded
  };
}

// apps/web/src/editing.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var WEB_SOURCE_SCHEME = "file-picker://";
var sourceUriFor = (entryId) => `${WEB_SOURCE_SCHEME}${encodeURIComponent(entryId)}`;
var sourceRevisionToken = (snapshot) => `provider-token:${snapshot.size}-${snapshot.lastModified}`;
var report = (state, editable, sentence) => Object.freeze({ state, editable, sentence });
var describe2 = (error) => error instanceof Error ? error.message : String(error);
async function describeEditability(access, entryId, name = entryId) {
  const handle = access?.handleOf(entryId);
  if (!isWritableHandle(handle)) {
    return report(
      "no-handle",
      false,
      `${name} has no writable handle: it arrived through a file input, a drop or a fetch, so this page can show it but can never save it back. Pick it through "Open file\u2026" or a folder to edit it.`
    );
  }
  const grant = access?.writeGrant ?? handle;
  let state;
  try {
    state = await grant.queryPermission?.({ mode: "readwrite" });
  } catch (error) {
    return report(
      "no-permission-surface",
      true,
      `${name} has a writable handle, but this browser could not report its write permission (${describe2(error)}); the first save is where it is decided.`
    );
  }
  if (state === void 0) {
    return report(
      "no-permission-surface",
      true,
      `${name} has a writable handle, but this browser exposes no permission query, so whether the write is allowed is decided by the first save.`
    );
  }
  if (state === "denied") {
    return report(
      "denied",
      false,
      `Write access was denied for ${name}, so its text and hex editors are dropped. This build will not offer a save it already knows the browser refuses.`
    );
  }
  if (state === "granted") {
    return report("granted", true, `${name} can be saved in place: write access is granted.`);
  }
  return report(
    "prompt",
    true,
    `${name} can be saved in place once you allow write access; the browser asks on the first save, or use "Enable editing" to answer it now.`
  );
}
async function requestWriteAccess(access) {
  const grant = access?.writeGrant;
  if (access === void 0) {
    return { state: "no-handle", sentence: "Open a folder or pick a file before enabling editing." };
  }
  if (grant === void 0) {
    return {
      state: "no-handle",
      sentence: `${access.label} has no writable handle: files opened through a drop, a plain file input or a fetch cannot be written back. Use "Open file\u2026" or a granted folder instead.`
    };
  }
  const ask = grant.requestPermission;
  if (ask === void 0) {
    return {
      state: "no-permission-surface",
      sentence: `${access.label} cannot be asked for write permission in this browser; a save will try directly and report what the browser answers.`
    };
  }
  try {
    const state = await ask.call(grant, { mode: "readwrite" });
    if (state === "granted") {
      return {
        state: "granted",
        sentence: `Write access granted for ${access.label}: the text and hex editors can save.`
      };
    }
    return {
      state: state === "denied" ? "denied" : "prompt",
      sentence: state === "denied" ? `Write access denied for ${access.label}; files opened from now on show no editor.` : `Write access was not granted for ${access.label}; nothing was changed.`
    };
  } catch (error) {
    return {
      state: "no-permission-surface",
      sentence: `Asking for write access to ${access.label} failed: ${describe2(error)}`
    };
  }
}
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function byteRuns(value) {
  if (!Array.isArray(value) || value.length === 0) return void 0;
  const runs = [];
  for (const item of value) {
    if (!isRecord2(item)) return void 0;
    const range = item["range"];
    const payload = item["payload"];
    if (!isRecord2(range) || !isRecord2(payload)) return void 0;
    if (range["kind"] !== "bytes" || typeof range["offset"] !== "bigint") return void 0;
    if (payload["kind"] !== "inline" || !(payload["bytes"] instanceof Uint8Array)) return void 0;
    const offset = Number(range["offset"]);
    if (!Number.isSafeInteger(offset) || offset < 0) return void 0;
    runs.push({ offset, bytes: payload["bytes"] });
  }
  return runs;
}
function mergeByteRuns(runs, original) {
  if (runs.length === 0) return void 0;
  let start = Number.MAX_SAFE_INTEGER;
  let end = 0;
  for (const run of runs) {
    start = Math.min(start, run.offset);
    end = Math.max(end, run.offset + run.bytes.byteLength);
  }
  if (start > end || end > original.byteLength) return void 0;
  const window2 = original.slice(start, end);
  for (const run of runs) window2.set(run.bytes, run.offset - start);
  return { offset: start, bytes: window2 };
}
function normalizeChangeSet(change, targets, original) {
  if (!isRecord2(change)) return void 0;
  const declared = change["targets"];
  if (Array.isArray(declared) && declared.length > 0) return change;
  const target = targets[0];
  if (target === void 0) return void 0;
  const runs = byteRuns(change["edits"]);
  if (runs === void 0) return void 0;
  const merged = mergeByteRuns(runs, original);
  if (merged === void 0) return void 0;
  return {
    targets,
    edits: [
      {
        operation: "replace",
        targetId: target.targetId,
        source: target.ownerSource,
        range: {
          kind: "bytes",
          offset: BigInt(merged.offset),
          length: BigInt(merged.bytes.byteLength)
        },
        payload: { kind: "inline", bytes: merged.bytes },
        label: "Edit bytes"
      }
    ],
    provenance: { actor: "user" }
  };
}
function describeRejection(reason) {
  switch (reason) {
    case "stale-revision":
      return "the file changed on disk after this tab read it";
    case "permission-missing":
      return "the grant this subject was opened under does not carry write permission";
    case "write-scope-mismatch":
      return "the plan names a source outside this subject";
    case "guarantee-unachievable":
      return "this backend cannot promise the guarantee the plan asks for";
    case "fidelity-unproven":
      return "no evidence proves the writer keeps what the plan claims it keeps";
    case "confirmation-required":
      return "a lossy write needs an explicit confirmation this host does not collect";
    case "payload-unavailable":
      return "the edited bytes exceed what this host will hand over inline";
    case "source-read-only":
      return "the backend behind this source is read-only";
    case "cancelled":
      return "the save was cancelled";
    default:
      return "the plan did not describe this subject at its open revision";
  }
}
var firstMessage = (diagnostics) => diagnostics[0]?.message;
function webEditEvidence(inventory, descriptor) {
  if (descriptor.interpretation !== "codec") return createEvidenceRegistry();
  return codecFidelityEvidenceRecords(inventory, {
    codecId: descriptor.identity.codecId,
    formatId: descriptor.identity.formatId
  }).reduce((registry, record) => registry.with(record), createEvidenceRegistry());
}
function createWebEditingArm(options) {
  const writer = createRawWriter();
  const backend = createBrowserEditingBackend({
    handleFor: options.handleFor,
    // The same token the shell pins its sources with, passed explicitly so the two are visibly
    // one function rather than two that happen to agree today.
    revisionOf: (snapshot) => sourceRevisionToken({ size: snapshot.size, lastModified: snapshot.lastModified ?? 0 }),
    ...options.maxPayloadBytes === void 0 ? {} : { maxPayloadBytes: options.maxPayloadBytes }
  });
  const speaking = (base, request) => {
    const targets = base.edit.targets;
    const notice = (line) => options.onNotice(`${request.name}: ${line}`);
    const refused = (line) => {
      notice(line);
      return {
        valid: false,
        diagnostics: [diagnostic("error", "x3.app.web/edit-change-unsupported", line)]
      };
    };
    const edit = {
      revision: base.edit.revision,
      targets,
      state: () => base.edit.state(),
      async propose(change) {
        const normalized = normalizeChangeSet(change, targets, request.bytes);
        if (normalized === void 0) {
          return refused(
            "this editor produced a change this host cannot express as a literal replacement"
          );
        }
        options.onDirty(request.entryId, true);
        const result = await base.edit.propose(normalized);
        if (!result.valid) {
          notice(firstMessage(result.diagnostics) ?? "the writer refused the change");
        }
        return result;
      },
      async plan(change) {
        const normalized = normalizeChangeSet(change, targets, request.bytes);
        if (normalized === void 0) {
          throw new TypeError("this host cannot plan the change set this editor produced");
        }
        return base.edit.plan(normalized);
      },
      dispose: () => base.edit.dispose()
    };
    const announce = (result, what) => {
      if (result.state === "committed") {
        options.onDirty(request.entryId, false);
        notice(
          `${what} \u2014 written to the file this tab opened. Reopen it before editing again: this tab still holds the revision it read.`
        );
      } else if (result.state === "not-applied") {
        notice(
          `${what} refused \u2014 ${describeRejection(result.reason)}${firstMessage(result.diagnostics) === void 0 ? "" : ` (${firstMessage(result.diagnostics) ?? ""})`}.`
        );
      } else if (result.state === "rolled-back") {
        notice(`${what} failed and the file was rolled back to what it held before.`);
      } else {
        notice(`${what} landed only partly; recovery is available in the receipt.`);
      }
      return result;
    };
    const commit = {
      async prepare(plan, prepareOptions) {
        const result = await base.commit.prepare(plan, prepareOptions);
        if (result.state === "conflict") {
          notice(
            "refused \u2014 the file changed on disk after this tab read it, so nothing was overwritten. Reopen it and redo the edit."
          );
        } else if (result.state === "rejected") {
          notice(`refused before writing \u2014 ${describeRejection(result.reason)}.`);
        }
        return result;
      },
      async commit(prepared, commitOptions) {
        return announce(await base.commit.commit(prepared, commitOptions), "Saved");
      },
      async undo(transactionId, undoOptions) {
        return announce(await base.commit.undo(transactionId, undoOptions), "Undo");
      },
      async redo(transactionId, redoOptions) {
        return announce(await base.commit.redo(transactionId, redoOptions), "Redo");
      }
    };
    const authorization = {
      async request(plan, requestOptions) {
        const state = await options.ensureWriteAccess(request.entryId);
        if (state !== "granted") {
          notice(
            state === "denied" ? "not saved \u2014 this browser denied write access to the file." : `not saved \u2014 write access was not granted (${state}).`
          );
          return void 0;
        }
        return base.authorization.request(plan, requestOptions);
      }
    };
    return Object.freeze({ edit, commit, payloads: base.payloads, authorization });
  };
  const applying = (ports, request) => async (plan) => {
    const authorized = await ports.authorization.request(plan);
    if (authorized === void 0) {
      return {
        message: `${request.name} was not written: this browser did not grant write access`,
        failed: true
      };
    }
    const prepared = await ports.commit.prepare(plan, { grant: authorized.grant });
    if (prepared.state === "conflict") {
      return {
        message: `refused before writing: ${describeRejection("stale-revision")} (${prepared.conflicts.length} conflict(s))`,
        failed: true
      };
    }
    if (prepared.state === "rejected") {
      return {
        message: `refused before writing: ${describeRejection(prepared.reason)} (${prepared.reason})`,
        failed: true
      };
    }
    const result = await ports.commit.commit(prepared.prepared, { grant: authorized.grant });
    if (result.state === "committed") {
      return { message: `applied and written to ${request.name}`, failed: false };
    }
    if (result.state === "not-applied") {
      return {
        message: `not applied: ${describeRejection(result.reason)} (${result.reason})`,
        failed: true
      };
    }
    if (result.state === "rolled-back") {
      return {
        message: `not applied: the write failed and ${request.name} was rolled back`,
        failed: true
      };
    }
    return {
      message: `${request.name} was only partly written; recovery is in the receipt`,
      failed: true
    };
  };
  const arm = {
    backend,
    editorFor(request) {
      let editing;
      try {
        const evidence = webEditEvidence(options.inventory, request.opened.descriptor);
        editing = createSubjectEditing({
          opened: request.opened,
          grant: request.grant,
          // One backend, and only for a source this session really holds a handle for: an unknown
          // source must reach `derive` as "no backend", not as a backend that would refuse later.
          backendFor: (sourceId) => options.handleFor(sourceId) === void 0 ? void 0 : backend,
          evidenceFor: (plan) => evidence.evidenceFor(plan),
          writer,
          /*
           * No `expectedWriter`. It pins every committed plan's evidence to *one* writer identity,
           * which was right while the raw writer was the only thing that could produce a plan here
           * — and is wrong the moment this app offers a codec's mutating operations, because those
           * plans are the codec's and their evidence names the codec. The pin is not the check it
           * looks like either: this subject's inventory-derived registry already names, record by
           * record, which writer proved which claim, and an absent record is still refused.
           */
          ...options.maxInlinePayloadBytes === void 0 ? {} : { maxInlinePayloadBytes: options.maxInlinePayloadBytes }
        });
      } catch (error) {
        options.onNotice(`${request.name} cannot be edited here: ${describe2(error)}`);
        return void 0;
      }
      const base = editing.editorPorts;
      if (base === void 0) {
        options.onNotice(`${request.name} cannot be edited here: no writer backs this subject.`);
        return void 0;
      }
      const ports = speaking(base, request);
      return Object.freeze({
        ports,
        // Bound to the `SubjectEditing` that issued the grant snapshot: the plan is checked against
        // *this* subject at *this* revision, which is the check a renderer over an RPC arm has to
        // ask the serving side for and a page holding the host can simply make.
        planFromOperation: (output) => editing.planFromOperation(output),
        applyPlan: applying(ports, request)
      });
    },
    portsFor(request) {
      return arm.editorFor(request)?.ports;
    },
    async dispose() {
      await backend.dispose();
    }
  };
  return Object.freeze(arm);
}

// apps/web/src/edit-panel.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// apps/web/src/edit-operations.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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

// apps/web/src/inspector.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// packages/ui/dist/panels/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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

// apps/web/src/settings.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// packages/ui/dist/tokens/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
var WEB_THEMES = Object.freeze([
  { id: "modkit-dark", label: "Modkit Dark" },
  { id: "modkit-light", label: "Modkit Light" },
  { id: "modkit-high-contrast", label: "High contrast" },
  { id: "sc2", label: "StarCraft II" },
  { id: "nexus-forge", label: "Nexus Forge" },
  { id: "nexus-dominion", label: "Nexus Dominion" }
]);
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
var describe3 = (error) => error instanceof Error ? error.message : String(error);
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
  const baseUrl = new URL("./", document.baseURI);
  const capability = describeFileCapability(window);
  const bootDiagnostics = [];
  const extensionStore = createIndexedDbExtensionStore(indexedDB);
  const subtle = {
    digest: (algorithm, data) => crypto.subtle.digest(algorithm, data)
  };
  const host = {};
  const extensionsUi = mountExtensionsUi(document, {
    store: extensionStore,
    catalog: WEB_EXTENSION_CATALOG,
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
  const services = await createWebSubjectServices({
    baseUrl,
    catalog: WEB_EXTENSION_CATALOG,
    userExtensions: extensionsUi.current(),
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
      console.info(`[worker] ${diagnostic2.severity} ${diagnostic2.code}: ${diagnostic2.message}`);
    }
  });
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
    "Modkit MK3"
  );
  const statusLine = document.createElement("output");
  statusLine.className = "web-status";
  workbench.root.querySelector('[data-mk-part="workbench.statusbar"]')?.append(statusLine);
  const say = (message) => setViewerText(statusLine, message, 400);
  const operationSessions = /* @__PURE__ */ new Map();
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
  setViewerText(editingStatus, "No file is open yet, so nothing is editable.");
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
  const stages = createWebPreviewStages({
    operationsFor: (descriptor) => operationSessions.get(descriptorKey(descriptor))
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
      const result = await services.open({
        source: bytesSource(entry.id, bytes, token),
        path: entry.name,
        intent: "full",
        grant,
        budget: {
          maxInputBytes: BigInt(EXPLORER_MAXIMUM_BYTES),
          maxDepth: 256,
          maxNodes: 1e6,
          maxScalarBytes: 64 * 1024 * 1024,
          maxDiagnostics: 1e4,
          deadlineMs: 3e4
        },
        ...signal === void 0 ? {} : { signal }
      });
      if (result.state === "unresolved") {
        say(`${entry.name} \u2014 no codec claimed it (${result.reason}); showing the raw bytes.`);
        return void 0;
      }
      const boundary = result.diagnostics.some(
        (item) => item.code === "x3.host/worker-shared-process"
      ) ? "worker-brokered" : "unknown boundary";
      say(
        `${entry.name} \xB7 ${result.selected.contributionId}/${result.selected.variantId} \xB7 ${Math.round(result.selected.confidence * 100)}% \xB7 ${boundary}`
      );
      const session = result.session;
      const key = descriptorKey(result.descriptor);
      const operations = session.operations();
      operationSessions.set(key, operations);
      openedEntries.set(entry.id, entry);
      entryOfDescriptor.set(key, entry.id);
      if (writable) {
        const editor = editing.editorFor({
          entryId: entry.id,
          name: entry.name,
          opened: result,
          grant,
          bytes
        });
        if (editor !== void 0) subjectEditors.set(entry.id, editor);
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
        descriptor: () => session.descriptor(),
        dataSource: (contract, major) => session.dataSource(contract, major),
        async dispose() {
          operationSessions.delete(key);
          entryOfDescriptor.delete(key);
          inspected.delete(entry.id);
          openedEntries.delete(entry.id);
          subjectEditors.delete(entry.id);
          writableHandles.delete(sourceUriFor(entry.id));
          if (inspecting === entry.id) inspect(void 0);
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
  toolbarAction("Open file\u2026", "Open a single file in a new tab", () => {
    void (async () => {
      try {
        const picked = await pickFile();
        if (picked !== void 0) await openFile(picked.file, picked.handle);
      } catch (error) {
        say(`Could not open the file: ${describe3(error)}`);
      }
    })();
  });
  toolbarAction("Split editor", "Open the next file beside this one", () => editors.split());
  toolbarAction(
    "Enable editing",
    "Ask this browser for permission to write the file or folder you picked",
    () => {
      void (async () => {
        const asked = await requestWriteAccess(access);
        say(asked.sentence);
        noteEditing(asked.sentence);
      })();
    }
  );
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
    void openFile(file).catch((error) => say(`Drop failed: ${describe3(error)}`));
  });
  const store = createWebSettingsStore(window.localStorage);
  const settingsUi = createSettingsUi(document, {
    store,
    themes: WEB_THEMES,
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
    element(section, "h2", { text: "Bundled extensions" });
    element(section, "p", {
      part: "settings.description",
      text: `${WEB_EXTENSION_CATALOG.extensions.length} extensions were attested at build time and are served from this origin under extensions/. They are listed read-only because ${EXTENSIONS_READ_ONLY_REASON}.`
    });
    const list = element(section, "div", { part: "settings.list" });
    for (const entry of WEB_EXTENSION_CATALOG.extensions) {
      const item = element(list, "div", { part: "settings.extension" });
      const text = element(item, "div", { part: "settings.extension-text" });
      element(text, "div", { part: "settings.label", text: entry.name });
      element(text, "div", { part: "settings.description", text: entry.artifactRoot });
    }
    if (WEB_EXTENSION_CATALOG.excluded.length > 0) {
      element(section, "h2", { text: "Bundled but not served here" });
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
  element(sidebar, "h2", { text: "Host" });
  element(sidebar, "p", {
    part: "settings.description",
    text: `${services.main.inventory.extensions.length} extensions \xB7 ${services.supportedExtensions.length} detectable types \xB7 codecs run ${services.executionProfiles.join("/")} in ${services.worker.profile.realmId} \xB7 shared memory ${probe.sharedMemory ? "yes" : "no"}`
  });
  element(sidebar, "p", { part: "settings.description", text: capability.notice });
  element(sidebar, "p", { part: "settings.description", text: WEB_EDITING_NOTICE });
  sidebar.append(editingStatus);
  element(sidebar, "h2", { text: "Facilities" });
  const facilities = element(sidebar, "ul", { part: "settings.list" });
  for (const facility of services.main.profile.facilities) {
    element(facilities, "li", { text: facility });
  }
  element(sidebar, "h2", { text: "Served samples" });
  const sampleList = element(sidebar, "div", { part: "settings.list" });
  for (const sample of SAMPLES) {
    const button2 = element(sampleList, "button", {
      part: "explorer.action",
      text: sample.label
    });
    button2.type = "button";
    button2.addEventListener("click", () => {
      void openServed(sample.path).catch((error) => say(describe3(error)));
    });
  }
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
  activity("Files", "Explorer", () => showView("explorer"), "explorer");
  activity("Host", "Show or hide the host panel", () => {
    workbench.sidebar.hidden = !workbench.sidebar.hidden;
  });
  activity("Info", "Show or hide diagnostics and operations", () => {
    workbench.panel.hidden = !workbench.panel.hidden;
  });
  activity("Settings", "Settings", () => showView("settings"), "settings");
  workbench.panel.hidden = true;
  workbench.sidebar.hidden = false;
  showView("explorer");
  await inspector.show(void 0);
  say(
    `Ready \xB7 ${services.main.inventory.extensions.length} extensions \xB7 ${bootDiagnostics.length} boot notice(s)`
  );
  async function openServed(path) {
    const file = await fetchServed(baseUrl, path);
    if (file === void 0) {
      say(`${path} could not be fetched from this origin.`);
      return;
    }
    if (activeView !== "explorer") showView("explorer");
    await openFile(file);
  }
  const query = new URL(window.location.href).searchParams;
  const requested = query.get("open");
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
  if (query.get("selftest") !== null) {
    await selfTest({ openServed, editors, settingsView, inspector, probeEditing });
  }
}
async function selfTest(parts) {
  const report2 = document.createElement("pre");
  setPart(report2, "viewer.status");
  report2.className = "web-selftest";
  document.body.append(report2);
  const lines = [];
  const log = (line) => {
    console.info(line);
    lines.push(line);
    report2.textContent = lines.join("\n");
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
      log(`selftest: ${name} -> FAILED ${describe3(error)}`);
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
    log(`selftest: editing probe FAILED ${describe3(error)}`);
  }
  for (const theme of WEB_THEMES) {
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
  failure.textContent = `Boot failed: ${describe3(error)}`;
  node.append(failure);
});
