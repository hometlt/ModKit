// packages/ui/dist/workbench/index.js
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
function setPart(element, part) {
  if (!PART_SET.has(part)) throw new TypeError(`unregistered part: ${part}`);
  element.setAttribute(PART_ATTRIBUTE, part);
}
function setState(element, states) {
  for (const state of states) {
    if (!STATE_SET.has(state)) throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0) element.removeAttribute(STATE_ATTRIBUTE);
  else element.setAttribute(STATE_ATTRIBUTE, [...new Set(states)].join(" "));
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
function createWorkbench(document2, options) {
  const root2 = document2.createElement("div");
  root2.className = "modkit-viewer modkit-workbench";
  setPart(root2, "workbench");
  const titlebar = document2.createElement("header");
  titlebar.textContent = safeViewerText(options.title, 256);
  setPart(titlebar, "workbench.titlebar");
  const activitybar = document2.createElement("nav");
  activitybar.setAttribute("aria-label", "Workbench activities");
  setPart(activitybar, "workbench.activitybar");
  const sidebar = document2.createElement("aside");
  setPart(sidebar, "workbench.sidebar");
  const main = document2.createElement("main");
  setPart(main, "workbench.main");
  const panel = document2.createElement("section");
  setPart(panel, "workbench.panel");
  const statusbar = document2.createElement("footer");
  setPart(statusbar, "workbench.statusbar");
  const hostStatus = document2.createElement("span");
  setPart(hostStatus, "workbench.host-status");
  statusbar.append(hostStatus);
  root2.append(titlebar, activitybar, sidebar, main, panel, statusbar);
  const setHostState = (state) => {
    const reasons = state.degradedReasons ?? [];
    hostStatus.textContent = `${safeViewerText(state.label, 128)} \xB7 ${state.facilities.length} facilities`;
    hostStatus.title = reasons.length === 0 ? state.facilities.join(", ") : reasons.join("\n");
    const states = reasons.length === 0 ? [] : ["degraded"];
    setState(hostStatus, states);
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

// apps/modkit-vscode/src/webview.ts
var snapshot = globalThis.__MODKIT_SNAPSHOT__;
var root = document.querySelector("#root");
if (root === null) throw new Error("missing #root");
if (snapshot === void 0) {
  root.textContent = "No host snapshot was provided by the extension host.";
} else {
  const workbench = createWorkbench(document, {
    title: "Modkit host profile",
    host: {
      label: snapshot.webview.realmId,
      facilities: snapshot.webview.facilities
    }
  });
  root.replaceChildren(workbench.root);
  const table = document.createElement("table");
  table.className = "realm-table";
  const header = document.createElement("tr");
  for (const label of ["Realm", "Facilities", "Detail"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    header.append(cell);
  }
  table.append(header);
  for (const [label, realm] of [
    ["extension host", snapshot.extensionHost],
    ["webview (this page)", snapshot.webview]
  ]) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = label;
    const count = document.createElement("td");
    count.textContent = String(realm.facilities.length);
    const detail = document.createElement("td");
    detail.textContent = realm.facilities.join(", ") || "\u2014";
    row.append(name, count, detail);
    table.append(row);
  }
  const summary = document.createElement("p");
  summary.textContent = `${snapshot.topologyId} \xB7 ${snapshot.extensions} extensions \xB7 ${snapshot.diagnostics} diagnostics`;
  const isolated = !snapshot.webview.facilities.includes("editor.host-native");
  const claim = document.createElement("p");
  claim.textContent = isolated ? "\u2713 The webview realm holds no extension-host facility." : "\u2717 The webview realm was granted an extension-host facility.";
  const panel = document.createElement("div");
  panel.append(summary, table, claim);
  workbench.setMain(panel);
}
