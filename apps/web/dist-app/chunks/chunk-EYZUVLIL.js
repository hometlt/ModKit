import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// packages/ui/dist/parts.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
  "table.columns",
  "table.asset",
  "table.unresolved",
  "table.assist",
  "table.suggestions",
  "table.note",
  "table.panel",
  "table.add",
  "table.compare",
  "table.select",
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
  "playback.bar",
  "playback.seek",
  "playback.time",
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
  "image.convert",
  "image.metadata",
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
  "card.field-note",
  "card.nav",
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
  "graph.search",
  "graph.node-list",
  "graph.tooltip",
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
function setPart(element2, part) {
  if (!PART_SET.has(part))
    throw new TypeError(`unregistered part: ${part}`);
  element2.setAttribute(PART_ATTRIBUTE, part);
}
function setState(element2, states) {
  for (const state of states) {
    if (!STATE_SET.has(state))
      throw new TypeError(`unregistered state: ${state}`);
  }
  if (states.length === 0)
    element2.removeAttribute(STATE_ATTRIBUTE);
  else
    element2.setAttribute(STATE_ATTRIBUTE, [...new Set(states)].join(" "));
}

// packages/ui/dist/viewer/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
var policyText = (policy) => Object.entries(policy).map(([name, value]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)} ${value}`).join("; ");
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
function setViewerText(node, value, maximum) {
  node.textContent = safeViewerText(value, maximum);
}
function requireContainer(value) {
  if (typeof value !== "object" || value === null || !("ownerDocument" in value) || !("replaceChildren" in value) || typeof value.replaceChildren !== "function") {
    throw new TypeError("viewer container must be a DOM element");
  }
  return value;
}
function createSurface(container, label) {
  const host = requireContainer(container);
  const root = host.ownerDocument.createElement("section");
  root.className = "modkit-viewer";
  root.tabIndex = 0;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", label);
  root.dataset["modkitViewer"] = label;
  setPart(root, "viewer");
  host.replaceChildren(root);
  return root;
}
function element(parent, tag, options = {}) {
  const node = parent.ownerDocument.createElement(tag);
  if (options.className !== void 0)
    node.className = options.className;
  if (options.role !== void 0)
    node.setAttribute("role", options.role);
  if (options.text !== void 0)
    setViewerText(node, options.text);
  if (options.part !== void 0)
    setPart(node, options.part);
  if (options.state !== void 0)
    setState(node, options.state);
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
    if (parent?.aborted)
      this.controller.abort(parent.reason);
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
    if (this.#closed)
      return;
    this.#closed = true;
    this.controller.abort("viewer-unmounted");
    for (const callback of this.#cleanup.reverse())
      await callback();
    for (const lease of this.#leases.reverse())
      await lease.release();
  }
};
function createViewerMount(root, scope, initial, render) {
  let state = initial;
  return Object.freeze({
    async update(args) {
      if (scope.signal.aborted)
        return;
      state = args;
      root.setAttribute("aria-label", safeViewerText(args.slot.contributionId, 512));
      await render(state);
    },
    async unmount() {
      await scope.close();
      root.remove();
    }
  });
}
function defineViewerModule(module) {
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
  for (const item of diagnostics)
    unique.set(item.id, item);
  const values = [...unique.values()];
  return Object.freeze({
    error: Object.freeze(values.filter((item) => item.severity === "error")),
    warning: Object.freeze(values.filter((item) => item.severity === "warning")),
    information: Object.freeze(values.filter((item) => item.severity === "information")),
    hint: Object.freeze(values.filter((item) => item.severity === "hint"))
  });
}
function unknownSourceLease(sources, slot, contract) {
  const binding = bindingFor(slot, contract);
  if (binding === void 0 || !("contract" in binding))
    return Promise.resolve(void 0);
  return sources.get(binding);
}

// packages/ui/dist/localization/fallback-catalogs.generated.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var AUDIO_FALLBACK_MESSAGES = {
  "viewer.audio": "Audio viewer",
  "viewer.audioChannels": "Channels",
  "viewer.audioControls": "Audio controls",
  "viewer.audioCycleRate": "Cycle the playback rate",
  "viewer.audioDecodeError": "The platform decoder cannot render this audio: {reason}. A format-specific decoder provider is required.",
  "viewer.audioDecoder": "Decoded by",
  "viewer.audioPause": "Pause",
  "viewer.audioPaused": "paused",
  "viewer.audioPlay": "Play",
  "viewer.audioPlaying": "playing",
  "viewer.audioRestart": "Back to the start",
  "viewer.audioSampleRate": "Sample rate",
  "viewer.audioSize": "Decoded size",
  "viewer.audioSummary": "{position} / {duration} \xB7 {channels} channels \xB7 {rate} kHz \xB7 {size} KiB",
  "viewer.audioTransport": "{state} \xB7 \xD7{speed} \xB7 decoded by {decoder}",
  "viewer.duration": "Duration"
};
var CALCULATIONS_FALLBACK_MESSAGES = {
  "calculations.capped": "capped by the viewer",
  "calculations.empty": "This subject publishes no calculations.",
  "calculations.label": "Subject calculations",
  "calculations.notAvailable": "not available",
  "calculations.progress": "{visible} of {total} calculations \xB7 {state}{reason}",
  "calculations.sources": "Sources: {sources}",
  "calculations.summary": "{count} calculations \xB7 {warnings} warnings"
};
var CARD_FALLBACK_MESSAGES = {
  "card.capped": "{label} (capped)",
  "card.contribution.fact.contractCoordinate": "Contract coordinate",
  "card.contribution.fact.contractId": "Contract",
  "card.contribution.fact.contractMajor": "Contract major",
  "card.contribution.fact.dependencies": "Dependencies",
  "card.contribution.fact.displayName": "Display name",
  "card.contribution.fact.effectiveEnabled": "Effectively enabled",
  "card.contribution.fact.enabled": "Contribution enabled",
  "card.contribution.fact.id": "Contribution ID",
  "card.contribution.fact.limitations": "Limitations",
  "card.contribution.fact.ownerExtension": "Owner extension",
  "card.contribution.fact.runtimeVariants": "Runtime variants",
  "card.contribution.fact.specification": "Specification",
  "card.contribution.fact.status": "Status",
  "card.descriptionUnavailable": "Description is not available yet.",
  "card.extension.fact.contributionCount": "Contributions",
  "card.extension.fact.description": "Description",
  "card.extension.fact.displayName": "Display name",
  "card.extension.fact.enabled": "Extension enabled",
  "card.extension.fact.games": "Games",
  "card.extension.fact.homepage": "Homepage",
  "card.extension.fact.id": "Extension ID",
  "card.extension.fact.license": "License",
  "card.extension.fact.licenseFiles": "License files",
  "card.extension.fact.publisher": "Publisher",
  "card.extension.fact.source": "Source",
  "card.extension.fact.sourceDetails": "Source details",
  "card.extension.fact.trusted": "Trusted",
  "card.extension.fact.vendor": "Vendor",
  "card.extension.fact.version": "Version",
  "card.extension.group.contributions": "Contributions",
  "card.extension.group.declaration": "Declaration",
  "card.extension.group.overview": "Overview",
  "card.extension.group.specification": "Specification",
  "card.extension.group.state": "State",
  "card.factGroupsCapped": "Fact groups are capped.",
  "card.historyBack": "Previous subject",
  "card.historyForward": "Next subject",
  "card.loadingDescription": "Loading description\u2026",
  "card.locale": "Locale",
  "card.namedSubject": "{label} subject card",
  "card.preview": "Preview",
  "card.previewUnavailable": "Preview unavailable: {reason}",
  "card.relatedCapped": "Related subjects are capped.",
  "card.relatedSubjects": "Related subjects",
  "card.repository.fact.displayName": "Display name",
  "card.repository.fact.extensionCount": "Extensions and components",
  "card.repository.fact.gameCount": "Games",
  "card.repository.fact.id": "Identifier",
  "card.repository.fact.vendor": "Vendor",
  "card.repository.group.capabilities": "Capabilities",
  "card.repository.group.extensions": "Extensions",
  "card.repository.group.offerings": "Games and components",
  "card.repository.group.overview": "Overview",
  "card.repository.group.resources": "Resources",
  "card.sections": "{label} sections",
  "card.subject": "Subject card"
};
var CODE_FALLBACK_MESSAGES = {
  "viewer.enterSearch": "Enter a search term",
  "viewer.ready": "Ready",
  "viewer.search": "Search",
  "viewer.searchMatch": "{count} match",
  "viewer.searchMatches": "{count} matches",
  "viewer.searchText": "Search text",
  "viewer.searching": "Searching\u2026",
  "viewer.text": "Bounded text viewer",
  "viewer.textContent": "Text content"
};
var EDITOR_FALLBACK_MESSAGES = {
  "editor.actionCancelled": "{action} cancelled",
  "editor.actionFailed": "{action} failed",
  "editor.actionRejected": "{action} rejected",
  "editor.conflictChanged": "Conflict: source changed",
  "editor.notSaved": "Not saved",
  "editor.partiallySaved": "Partially saved; recovery is available",
  "editor.redone": "Redone",
  "editor.rolledBack": "Write failed; changes rolled back",
  "editor.saving": "Saving\u2026",
  "editor.savingProgress": "Saving\u2026 {progress}",
  "editor.sourceUpdated": "Source updated; review before saving",
  "editor.text": "Text editor",
  "editor.undone": "Undone",
  "editor.validating": "Validating\u2026",
  "editor.validationRejected": "Validation rejected the change",
  "viewer.editableText": "Editable text",
  "viewer.editingActions": "Editing actions",
  "viewer.ready": "Ready",
  "viewer.redo": "Redo",
  "viewer.save": "Save",
  "viewer.saveCancelled": "Save cancelled",
  "viewer.saveRejected": "Save rejected",
  "viewer.saved": "Saved",
  "viewer.undo": "Undo"
};
var EXPLORER_EDITORS_FALLBACK_MESSAGES = {
  "explorer.close": "Close",
  "explorer.closeAll": "Close All",
  "explorer.closeFile": "Close {name}",
  "explorer.closeOthers": "Close Others",
  "explorer.closeRight": "Close to the Right",
  "explorer.filePath": "File path",
  "explorer.noFileOpen": "No file open in this group.",
  "explorer.noRendererShort": "Nothing could render \u201C{name}\u201D.",
  "explorer.noViewer": "no viewer",
  "explorer.openFiles": "Open files",
  "explorer.opening": "Opening {name}\u2026",
  "explorer.previewError": "Could not preview {name}: {reason}",
  "explorer.view": "View"
};
var EXPLORER_FALLBACK_MESSAGES = {
  "explorer.actions": "Explorer actions",
  "explorer.changeViewError": "Could not change view: {reason}",
  "explorer.defaultApp": "Set as default app\u2026",
  "explorer.defaultAppTitle": "Register this app for the file types it can preview",
  "explorer.dropFailed": "Drop failed: {reason}",
  "explorer.dropUnreadable": "The dropped item could not be read.",
  "explorer.empty": "Open a folder, or drop a file here to preview it.",
  "explorer.emptyReadOnly": "Drop a file here to preview it.",
  "explorer.failedStatus": "{name} \u2014 failed",
  "explorer.filter": "Filter",
  "explorer.filterFiles": "Filter files",
  "explorer.folderOpened": "Folder opened. Pick a file in the tree.",
  "explorer.noRenderer": "Nothing could render \u201C{name}\u201D. The host publishes no codec for it and no built-in text or hex viewer was configured.",
  "explorer.noViewerStatus": "{name} \u2014 no viewer",
  "explorer.openFile": "Open file\u2026",
  "explorer.openFileError": "Could not open the file: {reason}",
  "explorer.openFileTitle": "Open a single file for preview",
  "explorer.openFolder": "Open folder\u2026",
  "explorer.openFolderError": "Could not open the folder: {reason}",
  "explorer.openFolderTitle": "Grant access to a folder and browse it",
  "explorer.opening": "Opening {name}\u2026",
  "explorer.previewError": "Could not preview {name}: {reason}",
  "explorer.previewView": "Preview view",
  "explorer.readingDrop": "Reading dropped item\u2026",
  "explorer.registerError": "Could not register file types: {reason}",
  "explorer.tooLarge": "{name} is {size}, over the {limit} preview limit.",
  "explorer.tooLargeStatus": "{name} \u2014 too large",
  "explorer.view": "View",
  "viewer.ready": "Ready"
};
var EXPLORER_PREVIEW_FALLBACK_MESSAGES = {
  "explorer.hex": "Hex",
  "explorer.text": "Text"
};
var FILTER_FALLBACK_MESSAGES = {
  "filter.matchCase": "Match case",
  "filter.placeholder": "Filter",
  "filter.regex": "Use regular expression",
  "filter.title": "Filter",
  "filter.wholeWord": "Match whole word"
};
var GRAPH_FALLBACK_MESSAGES = {
  "graph.all": "All",
  "graph.allRelations": "all",
  "graph.canvas2d": "2D canvas",
  "graph.canvas3d": "3D perspective",
  "graph.completeness": "{owner}{state}{reason}",
  "graph.controls": "Graph controls",
  "graph.edgeCount": "{count} visible edges",
  "graph.filterClasses": "Filter classes\u2026",
  "graph.filterNodeTypes": "Filter node types",
  "graph.hint": "Scroll to zoom \xB7 drag the background to pan \xB7 drag nodes to move them",
  "graph.hint3d": "Drag to orbit \xB7 right- or Shift-drag to pan \xB7 scroll to zoom \xB7 drag a node to move it \xB7 click a node to focus it \xB7 arrow keys orbit",
  "graph.hint3dOpen": "Drag to orbit \xB7 right- or Shift-drag to pan \xB7 scroll to zoom \xB7 drag a node to move it \xB7 click a node to focus it \xB7 double-click or Enter opens its linked subject",
  "graph.hintOpen": "Drag empty space to pan \xB7 drag a node to reposition it \xB7 scroll to zoom \xB7 click a node to select it \xB7 double-click or Enter opens its linked subject",
  "graph.labels": "Labels",
  "graph.loadedCounts": "loaded {nodes} of {totalNodes} nodes and {edges} of {totalEdges} edges",
  "graph.matches": "{count} matches",
  "graph.nodeCount": "{visible} / {total} nodes",
  "graph.nodeList": "Visible nodes",
  "graph.nodeTypes": "Node types",
  "graph.nodes": "Nodes",
  "graph.none": "None",
  "graph.relation": "Relation graph",
  "graph.relations": "Relations",
  "graph.renderer": "Renderer",
  "graph.resetView": "Reset view",
  "graph.search": "Search nodes\u2026",
  "graph.searchLabel": "Highlight matching nodes",
  "graph.source": "source",
  "graph.status": "{nodes} nodes \xB7 {edges} edges",
  "graph.view": "view",
  "graph.viewer": "Relation graph viewer",
  "graph.visibleCapped": "visible selection capped at {count} nodes"
};
var HEX_EDITOR_FALLBACK_MESSAGES = {
  "editor.bytesChanged": "{count} byte(s) changed",
  "editor.committedRanges": "Committed {count} range(s) \u2014 reopen the file before editing it again",
  "editor.conflictChanged": "Conflict: source changed",
  "editor.hex": "Hex editor",
  "editor.notAuthorized": "Not authorised",
  "editor.prepareRejected": "Prepare rejected: {reason}",
  "editor.rejectedReason": "Rejected: {reason}",
  "editor.rejectedValidation": "Rejected by validation",
  "editor.saveFailed": "Save failed: {reason}",
  "editor.saveRejectedReason": "Save rejected: {reason}",
  "editor.saveState": "Save {state}",
  "editor.validating": "Validating\u2026",
  "viewer.byteAt": "byte at {offset}",
  "viewer.byteOffset": "Byte offset",
  "viewer.characterAt": "character at {offset}",
  "viewer.go": "Go",
  "viewer.hexEditing": "Hex editing",
  "viewer.ready": "Ready",
  "viewer.revert": "Revert",
  "viewer.save": "Save"
};
var HEX_FALLBACK_MESSAGES = {
  "viewer.byteOffset": "Byte offset",
  "viewer.go": "Go",
  "viewer.hex": "Hex viewer"
};
var IMAGE_EDITING_FALLBACK_MESSAGES = {
  "imageEditing.alpha": "Alpha",
  "imageEditing.apply": "Apply",
  "imageEditing.bilinear": "Bilinear",
  "imageEditing.brushSettings": "Brush settings",
  "imageEditing.cancel": "Cancel",
  "imageEditing.clearSelection": "Clear",
  "imageEditing.color": "Colour",
  "imageEditing.colorAlpha": "Colour and alpha",
  "imageEditing.crop": "Crop to selection",
  "imageEditing.done": "Done",
  "imageEditing.height": "Height",
  "imageEditing.lockAspect": "Lock aspect",
  "imageEditing.nearest": "Nearest",
  "imageEditing.powerOfTwo": "Snap to the nearest power of two",
  "imageEditing.resample": "Resampling",
  "imageEditing.resize": "Resize",
  "imageEditing.size": "Size",
  "imageEditing.tolerance": "Fill \u0394",
  "imageEditing.tool": "Tool",
  "imageEditing.tool.brush": "Brush \u2014 freehand paint",
  "imageEditing.tool.ellipse": "Ellipse",
  "imageEditing.tool.eraser": "Eraser \u2014 clears to transparent",
  "imageEditing.tool.eyedropper": "Eyedropper \u2014 click to pick a colour",
  "imageEditing.tool.fill": "Bucket fill \u2014 click a region to flood-fill it",
  "imageEditing.tool.gradient": "Gradient \u2014 drag from opaque to transparent",
  "imageEditing.tool.line": "Line",
  "imageEditing.tool.rect": "Rectangle",
  "imageEditing.tool.select": "Select \u2014 drag a region, then Crop or Clear",
  "imageEditing.unavailable": "This format has no encoder \u2014 editing is unavailable; export still works.",
  "imageEditing.width": "Width"
};
var IMAGE_FALLBACK_MESSAGES = {
  "viewer.actualPixels": "Actual pixels",
  "viewer.fit": "Fit",
  "viewer.fitTitle": "Fit to the stage",
  "viewer.image": "Image viewer",
  "viewer.imageAspect": "Aspect",
  "viewer.imageChannels": "Channels",
  "viewer.imageColorSpace": "Colour space",
  "viewer.imageCompare": "Compare",
  "viewer.imageCompareTitle": "Cycle comparison: off, side by side, difference",
  "viewer.imageCompareWith": "compared with {subresource} ({mode})",
  "viewer.imageControls": "Image controls",
  "viewer.imageConvert": "Conversions",
  "viewer.imageConverting": "converting: {preset}\u2026",
  "viewer.imageDecodeError": "The platform decoder cannot render these bytes: {reason}. A format-specific decoder provider is required.",
  "viewer.imageDimensions": "Dimensions",
  "viewer.imageExportRefused": "export refused: {reason}",
  "viewer.imageExported": "exported {count} file(s)",
  "viewer.imageFormat": "Format",
  "viewer.imageHasAlpha": "Has alpha",
  "viewer.imageMipLevels": "Mip levels",
  "viewer.imageNextSubresource": "Next {axis}",
  "viewer.imageOperationRefused": "The operation was refused: {reason}",
  "viewer.imageOperationRun": "Apply",
  "viewer.imageOperationRunning": "Running {operation}\u2026",
  "viewer.imagePreviousSubresource": "Previous {axis}",
  "viewer.imageResizeTitle": "Resize\u2026",
  "viewer.imageSaveRefused": "Could not save: {reason}",
  "viewer.imageSaving": "Saving the edited pixels\u2026",
  "viewer.imageSectionEdit": "Edit",
  "viewer.imageSectionFormat": "Format",
  "viewer.imageSectionImage": "Image",
  "viewer.imageSectionMetadata": "Header / metadata",
  "viewer.imageSubresources": "Subresource, comparison and export",
  "viewer.isolateChannel": "Isolate the {channel} channel",
  "viewer.zoomIn": "Zoom in",
  "viewer.zoomOut": "Zoom out"
};
var MEDIA_SHELL_FALLBACK_MESSAGES = {
  "mediaShell.gallery": "Gallery",
  "mediaShell.galleryBig": "Large icons",
  "mediaShell.galleryEmpty": "No media files found.",
  "mediaShell.galleryList": "List",
  "mediaShell.galleryNoMatch": "No matching media files.",
  "mediaShell.gallerySmall": "Small icons",
  "mediaShell.sidebar": "Details",
  "mediaShell.toggleGallery": "Toggle gallery",
  "mediaShell.toggleSidebar": "Toggle details"
};
var METADATA_FALLBACK_MESSAGES = {
  "metadata.codec": "codec",
  "metadata.confidence": "confidence",
  "metadata.detection": "detection",
  "metadata.empty": "No metadata reported by the codec.",
  "metadata.format": "format",
  "metadata.identity": "identity",
  "metadata.interpretation": "interpretation",
  "metadata.mutatesSource": "mutates source",
  "metadata.observedTraits": "Observed traits",
  "metadata.operation": "operation",
  "metadata.properties": "Properties",
  "metadata.revision": "revision",
  "metadata.subject": "subject",
  "metadata.title": "Metadata",
  "metadata.trait": "trait",
  "metadata.unresolved": "unresolved"
};
var MODEL_FALLBACK_MESSAGES = {
  "viewer.model": "Model viewer",
  "viewer.modelAllPrimitives": "Complete model",
  "viewer.modelAnimation": "Animation",
  "viewer.modelAnimationCount": "Animations",
  "viewer.modelAnimationName": "Animation name",
  "viewer.modelAnimationRename": "Rename sequence",
  "viewer.modelAnimationRenaming": "Renaming\u2026",
  "viewer.modelAnimationTime": "Animation time in seconds",
  "viewer.modelBehaviours": "node behaviours",
  "viewer.modelBlendUnknown": "blend unknown",
  "viewer.modelBones": "bones",
  "viewer.modelBounds": "Bounds",
  "viewer.modelBoundsExtent": "Extent",
  "viewer.modelBoundsMaximum": "Maximum",
  "viewer.modelBoundsMinimum": "Minimum",
  "viewer.modelCameras": "cameras",
  "viewer.modelClipDetail": "{frames} frames \xB7 {channels} channels \xB7 {samples} samples",
  "viewer.modelClips": "clips",
  "viewer.modelCollision": "collision",
  "viewer.modelConvert": "Convert\u2026",
  "viewer.modelConvertUnavailable": "this window cannot write converted files",
  "viewer.modelConverted": "Converted to {preset}",
  "viewer.modelConverting": "Converting to {preset}\u2026",
  "viewer.modelDiagnosticsSection": "Diagnostics",
  "viewer.modelEditing": "Editing",
  "viewer.modelEffectProperties": "{count} settings",
  "viewer.modelEffects": "effects",
  "viewer.modelError": "The model scene cannot be rendered: {reason}",
  "viewer.modelExport": "Export",
  "viewer.modelGeometryAccess": "Geometry",
  "viewer.modelGeometryUnavailable": "Scene metadata is available. A buffer resolver/renderer provider is required for geometry.",
  "viewer.modelLayers": "{count} layers",
  "viewer.modelLights": "lights",
  "viewer.modelMaterial": "material",
  "viewer.modelMaterialCount": "Materials",
  "viewer.modelMaterials": "materials",
  "viewer.modelMeshCount": "Meshes",
  "viewer.modelNoNamedFlags": "no named flags",
  "viewer.modelNodeCount": "Nodes",
  "viewer.modelParent": "parent {parent}",
  "viewer.modelPhysics": "physics bodies",
  "viewer.modelPlayback": "Playback",
  "viewer.modelPrimitive": "Model primitive",
  "viewer.modelPrimitiveCount": "Primitives",
  "viewer.modelProperties": "Properties",
  "viewer.modelRendererLabel": "Renderer",
  "viewer.modelRendering": "Rendering",
  "viewer.modelResources": "resources",
  "viewer.modelRestPose": "Rest pose",
  "viewer.modelSceneCount": "Scenes",
  "viewer.modelSceneCounts": "{meshes} meshes \xB7 {materials} materials \xB7 {animations} animations",
  "viewer.modelSkeletonOverlay": "Show the bone overlay",
  "viewer.modelSockets": "sockets",
  "viewer.modelSummary": "{nodes} nodes \xB7 {meshes} meshes \xB7 {primitives} primitives \xB7 {materials} materials \xB7 {animations} animations{facets}",
  "viewer.modelTeamColor": "Team Color",
  "viewer.modelTeamColorCustom": "Custom team color",
  "viewer.modelTeamColorPresets": "Team color presets",
  "viewer.modelTextureCount": "Textures",
  "viewer.modelTextureStatus": "Textures",
  "viewer.modelUnnamed": "(unnamed)",
  "viewer.modelUpAxis": "Up axis",
  "viewer.modelView": "Model view",
  "viewer.modelView3d": "View",
  "viewer.playPause": "Play or pause",
  "viewer.reset": "Reset",
  "viewer.resetCamera": "Reset the camera to its default pose",
  "viewer.zoomIn": "Zoom in",
  "viewer.zoomOut": "Zoom out"
};
var MODEL_GIZMO_FALLBACK_MESSAGES = {
  "viewer.viewAxis": "View axis",
  "viewer.viewFromAxis": "View from {axis}"
};
var NAMESPACE_FALLBACK_MESSAGES = {
  "viewer.namespace": "Namespace tree",
  "viewer.storedSize": "stored {size}"
};
var PANELS_FALLBACK_MESSAGES = {
  "panels.diagnostics": "Diagnostics",
  "panels.operationComplete": "{operation}: complete",
  "panels.operations": "Operations",
  "panels.ready": "Ready",
  "panels.working": "Working"
};
var PRIMITIVES_FILE_TREE_FALLBACK_MESSAGES = {
  "primitives.nothingToShow": "Nothing to show.",
  "primitives.treeActions": "{label} actions"
};
var PRIMITIVES_SEARCH_FIELD_FALLBACK_MESSAGES = {
  "primitives.filter": "Filter",
  "primitives.filterOptions": "Filter options",
  "primitives.glob": "Use glob pattern",
  "primitives.invalid": "invalid",
  "primitives.invalidRegex": "Invalid regular expression",
  "primitives.matchCase": "Match case",
  "primitives.matchWord": "Match whole word",
  "primitives.matches": "{count} matches",
  "primitives.nextMatch": "Next match",
  "primitives.oneMatch": "1 match",
  "primitives.previousMatch": "Previous match",
  "primitives.regex": "Use regular expression"
};
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
var TABLE_FALLBACK_MESSAGES = {
  "card.descriptionUnavailable": "Description is not available yet.",
  "card.loadingDescription": "Loading description\u2026",
  "table.stale": "Saved. Reopen the file to make further changes.",
  "table.suggestions": "Suggestions",
  "viewer.nextRows": "Next rows",
  "viewer.table": "Table viewer",
  "viewer.tableShape": "{rows} rows, {columns} columns"
};
var TABLE_VARIANTS_FALLBACK_MESSAGES = {
  "table.addKey": "Add key",
  "table.addKeyName": "New key",
  "table.addKeySubmit": "Add",
  "table.addKeyValue": "Value ({variant})",
  "table.columns": "Columns",
  "table.compare": "Compare locales",
  "table.compareEmpty": "Empty",
  "table.compareLine": "{variant}: {translated} of {total} translated from {base}; {missing} missing, {identical} untranslated, {empty} empty, {orphaned} not in {base}.",
  "table.compareOrphaned": "Not in base",
  "table.filterChanged": "Changed",
  "table.filterDuplicate": "Duplicates",
  "table.filterMissing": "Missing",
  "table.filterUntranslated": "Untranslated",
  "table.filters": "Table filters",
  "table.group": "Key group",
  "table.groupAll": "All groups",
  "table.keyExists": "{key} already exists",
  "table.more": "Show more rows",
  "table.refused": "Not saved: {reason}",
  "table.render": "As in game",
  "table.renderRefused": "Values are not drawn: {reason}",
  "table.saved": "Saved.",
  "table.search": "Search keys and values",
  "table.selectRow": "Select row {key}",
  "table.showAll": "Show all rows",
  "table.shown": "{shown} of {total} rows shown",
  "table.translate": "Translate empty cells",
  "table.translateApply": "Apply translations",
  "table.translateNothing": "No empty {variant} cells among the chosen rows.",
  "table.translateReady": "{count} translations into {variant} are ready to review.",
  "table.translateRefused": "{key}: {reason}",
  "table.translateTarget": "Translation target",
  "table.translateUnavailable": "Translation is unavailable: {reason}",
  "table.working": "Working\u2026"
};
var TEMPLATE_FALLBACK_MESSAGES = {
  "viewer.displayCapped": "Display capped at {maximum} of {count} items.",
  "viewer.gameTemplate": "Game template",
  "viewer.loadingTemplate": "Loading template\u2026",
  "viewer.namedRemainder": "{count} named remainder",
  "viewer.noDisplayItems": "No display items.",
  "viewer.resolvedSemanticTree": "Resolved semantic tree",
  "viewer.templateChain": "Inherits: {chain}",
  "viewer.templateNoProperties": "This node sets no properties.",
  "viewer.templateRoot": "Preview root",
  "viewer.templateSelectNode": "Select a node to see its properties.",
  "viewer.templateUnavailable": "Template unavailable: {reason}"
};
var TEXT_VIRTUAL_FALLBACK_MESSAGES = {
  "viewer.loadNextPage": "Load next page",
  "viewer.virtualText": "Virtual text viewer"
};
var TRANSPORT_FALLBACK_MESSAGES = {
  "viewer.loading": "Loading",
  "viewer.normalSpeed": "Normal speed",
  "viewer.operationComplete": "{label}: complete",
  "viewer.playPause": "Play or pause",
  "viewer.seekStart": "Seek to start",
  "viewer.transport": "Transport controls"
};
var TRANSPORT_PLAYBACK_FALLBACK_MESSAGES = {
  "viewer.pause": "Pause",
  "viewer.play": "Play",
  "viewer.playback": "Playback",
  "viewer.playbackCharts": "Values over time",
  "viewer.playbackEvent.structure-done": "Built",
  "viewer.playbackEvent.unit-born": "Born",
  "viewer.playbackEvent.unit-died": "Died",
  "viewer.playbackEvent.upgrade": "Upgrade",
  "viewer.playbackEvents": "Events",
  "viewer.playbackFact.apm": "APM",
  "viewer.playbackMap": "Positions at {time}: {count} units",
  "viewer.playbackMetric.army-value": "Army value",
  "viewer.playbackMetric.units": "Units",
  "viewer.playbackNoTimeline": "This source publishes no participants, series or events.",
  "viewer.playbackNoWorld": "This source publishes no positions.",
  "viewer.playbackOutcome.loss": "Defeat",
  "viewer.playbackOutcome.tie": "Tie",
  "viewer.playbackOutcome.undecided": "Undecided",
  "viewer.playbackOutcome.win": "Victory",
  "viewer.playbackParticipants": "Participants",
  "viewer.playbackRate": "Playback speed",
  "viewer.playbackSampled": "Positions are interpolated between recorded samples (tracker events). This is not a game simulation.",
  "viewer.playbackSeek": "Playback position",
  "viewer.playbackTime": "{position} / {duration}",
  "viewer.playbackTruncated": "Bounded view: some events or samples are not shown."
};
var TREE_FALLBACK_MESSAGES = {
  "tree.loadFailed": "Could not load this page. Try again.",
  "tree.more": "Load more",
  "viewer.tree": "Tree viewer"
};
var VECTOR_FALLBACK_MESSAGES = {
  "viewer.vector": "Vector viewer",
  "viewer.vectorError": "The vector scene cannot be rendered safely: {reason}",
  "viewer.vectorPreview": "Vector scene preview",
  "viewer.vectorSummary": "{nodes} nodes \xB7 {paths} paths \xB7 {shapes} shapes \xB7 {text} text nodes"
};
var VIDEO_FALLBACK_MESSAGES = {
  "viewer.audioTracks": "Audio tracks",
  "viewer.duration": "Duration",
  "viewer.durationUnknown": "duration unknown",
  "viewer.mediaType": "Media type",
  "viewer.video": "Video viewer",
  "viewer.videoPlayError": "The platform cannot play this video representation: {reason}",
  "viewer.videoSummary": "{video} video \xB7 {audio} audio \xB7 {duration}",
  "viewer.videoTrackCount": "{video} video \xB7 {audio} audio",
  "viewer.videoTracks": "Video tracks"
};
var WORKBENCH_FALLBACK_MESSAGES = {
  "workbench.activities": "Workbench activities",
  "workbench.facilities": "{label} \xB7 {count} facilities",
  "workbench.hostUnavailable": "Host unavailable",
  "workbench.noHostProfile": "No host profile"
};
var WORLD_FALLBACK_MESSAGES = {
  "viewer.boundedPreview": " \xB7 bounded preview",
  "viewer.modelResources": "resources",
  "viewer.world": "World viewer",
  "viewer.world3d": "3D preview",
  "viewer.worldEmpty": "World metadata is available; no drawable terrain or objects were published.",
  "viewer.worldError": "The world cannot be rendered: {reason}",
  "viewer.worldLattice": "Lattice 2D",
  "viewer.worldLoaded": "Map loaded",
  "viewer.worldLoadingCliffs": "Loading cliff models",
  "viewer.worldLoadingGeometry": "Loading terrain geometry",
  "viewer.worldLoadingObjects": "Loading object models",
  "viewer.worldLoadingTextures": "Loading terrain textures",
  "viewer.worldPreview": "Top-down world preview",
  "viewer.worldSaveMove": "Save selected move",
  "viewer.worldSummary": "{map} \xB7 {layers} layers \xB7 {items} items{bounded}",
  "viewer.worldView": "Map view"
};

// packages/ui/dist/localization/fallback.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
  if (localizer === void 0)
    return fallback;
  return Object.freeze({
    locale: localizer.locale,
    text(key, values = {}) {
      const translated = localizer.text(key, values);
      return translated === key ? fallback.text(key, values) : translated;
    }
  });
}

// packages/ui/dist/media-shell/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// packages/ui/dist/icons/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function icon(document, name) {
  const node = document.createElement("span");
  node.className = `codicon codicon-${name}`;
  node.setAttribute("aria-hidden", "true");
  return node;
}
function iconButton(parent, name, title, onClick) {
  const button = parent.ownerDocument.createElement("button");
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.append(icon(parent.ownerDocument, name));
  if (onClick !== void 0)
    button.addEventListener("click", onClick);
  parent.append(button);
  return button;
}

// packages/ui/dist/filter/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function isWordChar(ch) {
  return ch !== "" && /[A-Za-z0-9_]/u.test(ch);
}
function hasWordBoundary(text, start, end) {
  return !isWordChar(text.charAt(start - 1)) && !isWordChar(text.charAt(end));
}
function compileMatcher(options, onError = () => void 0) {
  onError("");
  const { text, caseSensitive, wholeWord, regex } = options;
  if (text === "")
    return null;
  if (!regex) {
    return {
      kind: "plain",
      needle: caseSensitive ? text : text.toLowerCase(),
      caseSensitive,
      wholeWord
    };
  }
  try {
    const source = wholeWord ? `(?<![A-Za-z0-9_])(?:${text})(?![A-Za-z0-9_])` : text;
    return new RegExp(source, caseSensitive ? "u" : "iu");
  } catch (error) {
    onError(error instanceof Error ? error.message : "Invalid regular expression");
    return false;
  }
}
function textMatches(text, matcher) {
  if (matcher === null)
    return true;
  if (matcher === false)
    return false;
  if (matcher instanceof RegExp)
    return matcher.test(text);
  const needle = matcher.needle;
  if (needle === "")
    return true;
  const hay = matcher.caseSensitive ? text : text.toLowerCase();
  let index = hay.indexOf(needle);
  while (index >= 0) {
    if (!matcher.wholeWord || hasWordBoundary(text, index, index + needle.length))
      return true;
    index = hay.indexOf(needle, index + Math.max(1, needle.length));
  }
  return false;
}
function createFilterWidget(parent, widgetOptions) {
  const localizer = withEnglishUiFallback(widgetOptions.localizer, FILTER_FALLBACK_MESSAGES);
  const document = parent.ownerDocument;
  const state = {
    text: "",
    caseSensitive: widgetOptions.initial?.caseSensitive ?? false,
    wholeWord: widgetOptions.initial?.wholeWord ?? false,
    regex: widgetOptions.initial?.regex ?? false
  };
  let error = "";
  const root = document.createElement("div");
  setPart(root, "filter");
  root.title = localizer.text("filter.title");
  parent.append(root);
  const opener = iconButton(root, "filter", localizer.text("filter.title"), () => widget.open());
  setPart(opener, "filter.opener");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = localizer.text("filter.placeholder");
  input.setAttribute("aria-label", localizer.text("filter.title"));
  setPart(input, "filter.input");
  root.append(input);
  const toggles = [
    ["caseSensitive", "case-sensitive", "filter.matchCase"],
    ["wholeWord", "whole-word", "filter.wholeWord"],
    ["regex", "regex", "filter.regex"]
  ].map(([key, name, label]) => {
    const button = iconButton(root, name, localizer.text(label), () => {
      state[key] = !state[key];
      changed();
    });
    setPart(button, "filter.option");
    return [key, button];
  });
  const matcher = () => compileMatcher(state, (message) => {
    error = message;
  });
  const sync = () => {
    matcher();
    const open = root.dataset["open"] === "true";
    setState(root, [
      ...open ? ["active"] : [],
      ...error === "" ? [] : ["invalid"]
    ]);
    root.title = error === "" ? localizer.text("filter.title") : error;
    for (const [key, button] of toggles)
      button.setAttribute("aria-pressed", String(state[key]));
  };
  const changed = () => {
    sync();
    widgetOptions.onChange({ ...state });
  };
  const close = () => {
    root.dataset["open"] = "false";
    sync();
  };
  input.addEventListener("input", () => {
    state.text = input.value;
    changed();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape")
      return;
    event.preventDefault();
    if (state.text === "")
      close();
    else
      widget.clear();
  });
  root.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!root.contains(document.activeElement) && state.text === "")
        close();
    }, 100);
  });
  const widget = {
    root,
    get options() {
      return { ...state };
    },
    matcher,
    open() {
      root.dataset["open"] = "true";
      sync();
      input.focus();
      input.select();
    },
    clear() {
      state.text = "";
      input.value = "";
      changed();
    }
  };
  close();
  return widget;
}

// packages/ui/dist/media-shell/index.js
var MIN_PANE = 120;
var MAX_PANE = 640;
var THUMB_EDGE = { small: 76, big: 128 };
var THUMB_CONCURRENCY = 6;
var AUTO_EXPAND_MAX_ITEMS = 200;
function el(document, tag, part, parent) {
  const node = document.createElement(tag);
  setPart(node, part);
  parent?.append(node);
  return node;
}
function createMediaShell(document, options) {
  const localizer = withEnglishUiFallback(options.localizer, MEDIA_SHELL_FALLBACK_MESSAGES);
  const state = {
    leftWidth: 240,
    rightWidth: 280,
    leftCollapsed: false,
    rightCollapsed: false,
    galleryMode: "list",
    collapsedSections: [],
    ...options.state
  };
  if (options.gallery === void 0)
    state.leftCollapsed = true;
  const cleanup = [];
  const root = el(document, "div", "media-shell");
  const toggleLeft = iconButton(root, "layout-sidebar-left", localizer.text("mediaShell.toggleGallery"));
  setPart(toggleLeft, "media-shell.toggle");
  toggleLeft.dataset["side"] = "left";
  toggleLeft.hidden = options.gallery === void 0;
  const toggleRight = iconButton(root, "layout-sidebar-right", localizer.text("mediaShell.toggleSidebar"));
  setPart(toggleRight, "media-shell.toggle");
  toggleRight.dataset["side"] = "right";
  const left = el(document, "aside", "media-shell.gallery", root);
  left.setAttribute("aria-label", localizer.text("mediaShell.gallery"));
  const splitLeft = el(document, "div", "media-shell.splitter", root);
  splitLeft.dataset["side"] = "left";
  splitLeft.setAttribute("role", "separator");
  splitLeft.setAttribute("aria-orientation", "vertical");
  const stage = el(document, "main", "media-shell.stage", root);
  const splitRight = el(document, "div", "media-shell.splitter", root);
  splitRight.dataset["side"] = "right";
  splitRight.setAttribute("role", "separator");
  splitRight.setAttribute("aria-orientation", "vertical");
  const right = el(document, "aside", "media-shell.sidebar", root);
  right.setAttribute("aria-label", localizer.text("mediaShell.sidebar"));
  const emit = () => options.onStateChange?.({ ...state });
  const applyLayout = () => {
    root.style.setProperty("--shell-left", `${state.leftWidth}px`);
    root.style.setProperty("--shell-right", `${state.rightWidth}px`);
    const flags = [];
    if (state.leftCollapsed)
      flags.push("left-collapsed");
    if (state.rightCollapsed)
      flags.push("right-collapsed");
    root.dataset["layout"] = flags.join(" ");
    left.hidden = state.leftCollapsed === true;
    splitLeft.hidden = state.leftCollapsed === true;
    right.hidden = state.rightCollapsed === true;
    splitRight.hidden = state.rightCollapsed === true;
    toggleLeft.setAttribute("aria-pressed", String(!state.leftCollapsed));
    toggleRight.setAttribute("aria-pressed", String(!state.rightCollapsed));
  };
  toggleLeft.addEventListener("click", () => {
    state.leftCollapsed = !state.leftCollapsed;
    applyLayout();
    if (!state.leftCollapsed)
      renderGallery();
    emit();
  });
  toggleRight.addEventListener("click", () => {
    state.rightCollapsed = !state.rightCollapsed;
    applyLayout();
    emit();
  });
  const dragSplitter = (splitter, side) => {
    splitter.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const startWidth = (side === "left" ? state.leftWidth : state.rightWidth) ?? 240;
      splitter.setPointerCapture(down.pointerId);
      root.dataset["resizing"] = "true";
      setState(splitter, ["active"]);
      const move = (event) => {
        const delta = side === "left" ? event.clientX - startX : startX - event.clientX;
        const width = Math.min(MAX_PANE, Math.max(MIN_PANE, startWidth + delta));
        if (side === "left")
          state.leftWidth = width;
        else
          state.rightWidth = width;
        applyLayout();
      };
      const up = () => {
        splitter.removeEventListener("pointermove", move);
        splitter.removeEventListener("pointerup", up);
        splitter.removeEventListener("pointercancel", up);
        delete root.dataset["resizing"];
        setState(splitter, []);
        emit();
      };
      splitter.addEventListener("pointermove", move);
      splitter.addEventListener("pointerup", up);
      splitter.addEventListener("pointercancel", up);
    });
  };
  dragSplitter(splitLeft, "left");
  dragSplitter(splitRight, "right");
  const sections = /* @__PURE__ */ new Map();
  const section = (id, title, sectionOptions = {}) => {
    const existing = sections.get(id);
    if (existing !== void 0)
      return existing;
    const box = el(document, "section", "media-shell.section", right);
    box.dataset["sectionId"] = id;
    const header = el(document, "button", "media-shell.section-header", box);
    header.type = "button";
    const chevron = icon(document, "chevron-down");
    setPart(chevron, "media-shell.section-chevron");
    header.append(chevron);
    if (sectionOptions.icon !== void 0) {
      const glyph = icon(document, sectionOptions.icon);
      setPart(glyph, "media-shell.section-icon");
      header.append(glyph);
    }
    el(document, "span", "media-shell.section-title", header).textContent = title;
    const body = el(document, "div", "media-shell.section-body", box);
    const listeners = [];
    const setCollapsed = (collapsed) => {
      box.dataset["collapsed"] = String(collapsed);
      header.setAttribute("aria-expanded", String(!collapsed));
      body.hidden = collapsed;
    };
    const remembered = state.collapsedSections?.includes(id);
    setCollapsed(remembered === true ? true : sectionOptions.collapsed ?? false);
    header.addEventListener("click", () => {
      const collapsed = box.dataset["collapsed"] !== "true";
      setCollapsed(collapsed);
      const others = (state.collapsedSections ?? []).filter((item) => item !== id);
      state.collapsedSections = collapsed ? [...others, id] : others;
      for (const listener of listeners)
        listener(collapsed);
      emit();
    });
    const created = {
      root: box,
      body,
      get collapsed() {
        return box.dataset["collapsed"] === "true";
      },
      setCollapsed,
      onToggle(listener) {
        listeners.push(listener);
      }
    };
    sections.set(id, created);
    return created;
  };
  const clearSections = (keep = []) => {
    for (const [id, item] of sections) {
      if (keep.includes(id))
        continue;
      item.root.remove();
      sections.delete(id);
    }
  };
  const toolbar = el(document, "div", "media-shell.gallery-toolbar", left);
  const modes = [
    ["list", "list-flat", "mediaShell.galleryList"],
    ["small", "circle-small-filled", "mediaShell.gallerySmall"],
    ["big", "circle-large-filled", "mediaShell.galleryBig"]
  ];
  const modeButtons = modes.map(([mode, glyph, label]) => {
    const button = iconButton(toolbar, glyph, localizer.text(label), () => {
      state.galleryMode = mode;
      renderGallery();
      emit();
    });
    setPart(button, "media-shell.gallery-mode");
    button.dataset["mode"] = mode;
    return button;
  });
  const filter = createFilterWidget(toolbar, {
    localizer,
    initial: {
      caseSensitive: state.filterCase ?? false,
      wholeWord: state.filterWord ?? false,
      regex: state.filterRegex ?? false
    },
    onChange(value) {
      const toggled = value.caseSensitive !== state.filterCase || value.wholeWord !== state.filterWord || value.regex !== state.filterRegex;
      state.filterCase = value.caseSensitive;
      state.filterWord = value.wholeWord;
      state.filterRegex = value.regex;
      renderGallery();
      if (toggled)
        emit();
    }
  });
  const list = el(document, "div", "media-shell.gallery-list", left);
  let items = [];
  const expanded = /* @__PURE__ */ new Set();
  let thumbnails;
  const seenGroups = /* @__PURE__ */ new Set();
  const renderGallery = () => {
    thumbnails?.abort();
    thumbnails = new AbortController();
    const signal = thumbnails.signal;
    const mode = state.galleryMode ?? "list";
    for (const button of modeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset["mode"] === mode));
    }
    list.dataset["mode"] = mode;
    list.replaceChildren();
    const matcher = filter.matcher();
    const filtering = filter.options.text !== "";
    const groups = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (filtering && !textMatches(item.label, matcher))
        continue;
      const key = item.group ?? "";
      groups.set(key, [...groups.get(key) ?? [], item]);
    }
    const pending = [];
    for (const [group, members] of groups) {
      const open = filtering || group === "" || expanded.has(group);
      const groupBox = el(document, "div", "media-shell.gallery-group", list);
      groupBox.dataset["collapsed"] = String(!open);
      if (group !== "") {
        const heading = el(document, "button", "media-shell.gallery-group-header", groupBox);
        heading.type = "button";
        heading.setAttribute("aria-expanded", String(open));
        const chevron = icon(document, "chevron-down");
        setPart(chevron, "media-shell.section-chevron");
        heading.append(chevron);
        const label = el(document, "span", "media-shell.gallery-label", heading);
        label.textContent = group;
        label.title = group;
        el(document, "span", "media-shell.gallery-count", heading).textContent = String(members.length);
        if (!filtering) {
          heading.addEventListener("click", () => {
            if (expanded.has(group))
              expanded.delete(group);
            else
              expanded.add(group);
            renderGallery();
          });
        }
      }
      if (!open)
        continue;
      const cells = el(document, "div", "media-shell.gallery-cells", groupBox);
      for (const item of members) {
        const cell = el(document, "button", "media-shell.gallery-item", cells);
        cell.type = "button";
        cell.title = item.id;
        if (item.active === true) {
          cell.setAttribute("aria-current", "true");
          setState(cell, ["active"]);
        }
        if (mode === "list") {
          cell.append(icon(document, "file-media"));
        } else {
          const wrap = el(document, "span", "media-shell.gallery-thumb-box", cell);
          const thumb = el(document, "canvas", "media-shell.gallery-thumb", wrap);
          thumb.width = 0;
          thumb.height = 0;
          const placeholder = icon(document, "file-media");
          wrap.append(placeholder);
          pending.push(() => drawThumbnail(options.gallery, item.id, thumb, THUMB_EDGE[mode], signal).then((drawn) => {
            if (drawn)
              placeholder.remove();
          }));
        }
        el(document, "span", "media-shell.gallery-label", cell).textContent = item.label;
        cell.addEventListener("click", () => {
          if (item.active === true)
            return;
          void options.gallery?.open(item.id);
        });
      }
    }
    if (groups.size === 0) {
      el(document, "div", "media-shell.gallery-empty", list).textContent = localizer.text(filtering ? "mediaShell.galleryNoMatch" : "mediaShell.galleryEmpty");
    }
    const next = async () => {
      for (let job = pending.shift(); job !== void 0 && !signal.aborted; job = pending.shift()) {
        await job();
      }
    };
    for (let worker = 0; worker < THUMB_CONCURRENCY; worker += 1)
      void next();
  };
  const refreshGallery = async (signal) => {
    if (options.gallery === void 0)
      return;
    items = await options.gallery.list(signal);
    if (items.length === 0) {
      state.leftCollapsed = true;
      applyLayout();
    }
    for (const item of items) {
      if (item.group === void 0 || seenGroups.has(item.group))
        continue;
      seenGroups.add(item.group);
      if (items.length <= AUTO_EXPAND_MAX_ITEMS)
        expanded.add(item.group);
    }
    for (const item of items) {
      if (item.active === true && item.group !== void 0)
        expanded.add(item.group);
    }
    renderGallery();
  };
  applyLayout();
  cleanup.push(() => thumbnails?.abort());
  return {
    root,
    stage,
    section,
    clearSections,
    refreshGallery,
    destroy() {
      for (const callback of cleanup)
        callback();
      root.remove();
    }
  };
}
async function drawThumbnail(gallery, id, canvas, edge, signal) {
  if (gallery?.thumbnail === void 0)
    return false;
  try {
    const thumb = await gallery.thumbnail(id, edge, signal);
    if (thumb === void 0 || signal.aborted)
      return false;
    const context = canvas.getContext("2d");
    if (context === null)
      return false;
    const pixels = new Uint8ClampedArray(thumb.width * thumb.height * 4);
    pixels.set(thumb.rgba.subarray(0, pixels.length));
    const bitmap = await createImageBitmap(new ImageData(pixels, thumb.width, thumb.height));
    const scale = Math.min(edge / bitmap.width, edge / bitmap.height, 1);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.imageSmoothingEnabled = scale < 1;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    canvas.dataset["loaded"] = "true";
    return true;
  } catch {
    return false;
  }
}

export {
  PART_ATTRIBUTE,
  setPart,
  setState,
  safeViewerText,
  setViewerText,
  requireContainer,
  createSurface,
  element,
  bindingFor,
  ViewerMountScope,
  createViewerMount,
  defineViewerModule,
  invokeOperation,
  diagnosticsBySeverity,
  unknownSourceLease,
  AUDIO_FALLBACK_MESSAGES,
  CALCULATIONS_FALLBACK_MESSAGES,
  CARD_FALLBACK_MESSAGES,
  CODE_FALLBACK_MESSAGES,
  EDITOR_FALLBACK_MESSAGES,
  EXPLORER_EDITORS_FALLBACK_MESSAGES,
  EXPLORER_FALLBACK_MESSAGES,
  EXPLORER_PREVIEW_FALLBACK_MESSAGES,
  GRAPH_FALLBACK_MESSAGES,
  HEX_EDITOR_FALLBACK_MESSAGES,
  HEX_FALLBACK_MESSAGES,
  IMAGE_EDITING_FALLBACK_MESSAGES,
  IMAGE_FALLBACK_MESSAGES,
  METADATA_FALLBACK_MESSAGES,
  MODEL_FALLBACK_MESSAGES,
  MODEL_GIZMO_FALLBACK_MESSAGES,
  NAMESPACE_FALLBACK_MESSAGES,
  PANELS_FALLBACK_MESSAGES,
  PRIMITIVES_FILE_TREE_FALLBACK_MESSAGES,
  PRIMITIVES_SEARCH_FIELD_FALLBACK_MESSAGES,
  SETTINGS_FALLBACK_MESSAGES,
  TABLE_FALLBACK_MESSAGES,
  TABLE_VARIANTS_FALLBACK_MESSAGES,
  TEMPLATE_FALLBACK_MESSAGES,
  TEXT_VIRTUAL_FALLBACK_MESSAGES,
  TRANSPORT_FALLBACK_MESSAGES,
  TRANSPORT_PLAYBACK_FALLBACK_MESSAGES,
  TREE_FALLBACK_MESSAGES,
  VECTOR_FALLBACK_MESSAGES,
  VIDEO_FALLBACK_MESSAGES,
  WORKBENCH_FALLBACK_MESSAGES,
  WORLD_FALLBACK_MESSAGES,
  withEnglishUiFallback,
  createMediaShell
};
