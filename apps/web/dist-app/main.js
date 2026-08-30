import {
  CONTAINER_EXTRACT_OPERATION_ID,
  EXPLORER_MAXIMUM_BYTES,
  EXTENSION_ROOT_FAILURE_CODES,
  ViewerMountScope,
  WEB_EDITING_NOTICE,
  WEB_EXTENSION_CATALOG,
  WEB_PREVIEW_FALLBACK,
  applyDensity,
  applyTheme,
  catalogCoordinates,
  combineLoadedExtensionRoots,
  compareUtf8,
  containerCoordinate,
  coordinateMapPreviewAssetSession,
  createBrowserExtensionManager,
  createCodecPreview,
  createDirectoryAccess,
  createEditorArea,
  createExplorer,
  createIndexedDbExtensionStore,
  createManagedExtensionsController,
  createSingleFileAccess,
  createSurface,
  createViewerMount,
  createWebEditingArm,
  createWebPreviewStages,
  createWebSubjectServices,
  createWebTopology,
  defineViewerModule,
  describeEditability,
  describeFileCapability,
  diagnostic,
  diagnosticsBySeverity,
  element,
  invokeOperation,
  isWritableHandle,
  loadManagedExtensionRoots,
  loadUserExtensionRoots,
  mountWebWorkbench,
  nestedSubjectServices,
  openNestedSubject,
  presentationSlotId,
  probeWebFacilities,
  requestUserExtensionPermission,
  requestWriteAccess,
  resolveCommonPresentationPlan,
  resolveFormatWriter,
  resolveModuleMap,
  revisionId,
  safeViewerText,
  setPart,
  setState,
  setViewerText,
  sourceRevisionToken,
  sourceUriFor,
  stageIdOf
} from "./chunks/chunk-H3L6ZUVX.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunks/chunk-HJULOH5B.js";

// apps/web/src/shell.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// packages/ui/dist/settings/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// packages/ui/dist/settings/model.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
    problems.push(`unknown schemaVersion ${String(version)}; expected ${SETTINGS_SCHEMA_VERSION}. Unrecognised fields were ignored.`);
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
          problems.push(`gameInstallations.${gameId}.configuredPaths[${index}] is not a valid local path; ignored`);
          continue;
        }
        if (seenPaths.has(path))
          continue;
        seenPaths.add(path);
        configuredPaths.push(path);
        if (configuredPaths.length >= GAME_INSTALLATION_PATH_LIMIT) {
          if (index + 1 < item["configuredPaths"].length) {
            problems.push(`gameInstallations.${gameId}.configuredPaths was truncated at ${GAME_INSTALLATION_PATH_LIMIT}`);
          }
          break;
        }
      }
      if (gameInstallations[gameId] !== void 0) {
        problems.push(`gameInstallations key "${rawGameId}" duplicates "${gameId}"; the later entry won`);
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
      if (!isRecord(item))
        continue;
      const path = asText(item["path"]);
      if (path === void 0 || seenPaths.has(path))
        continue;
      seenPaths.add(path);
      recent.push({ path, kind: item["kind"] === "file" ? "file" : "folder" });
      if (recent.length >= RECENT_LIMIT)
        break;
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
      if (seenIds.has(id))
        continue;
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
  return `${JSON.stringify({
    schemaVersion: document2.schemaVersion,
    appearance: { theme: document2.appearance.theme, density: document2.appearance.density },
    // Recency is meaningful order, so this list is written as-is rather than sorted.
    recent: document2.recent.map((entry) => ({ path: entry.path, kind: entry.kind })),
    // A set: sorted, so the same choice made in two hosts produces the same bytes.
    disabledContributions: [...document2.disabledContributions].sort(compareUtf8),
    gameInstallations: Object.fromEntries(Object.entries(document2.gameInstallations).sort(([left], [right]) => compareUtf8(left, right)).map(([gameId, setting]) => [gameId, { configuredPaths: [...setting.configuredPaths] }])),
    extensions: [...document2.extensions].sort((a, b) => compareUtf8(a.id, b.id)).map((entry) => ({
      id: entry.id,
      path: entry.path,
      enabled: entry.enabled,
      ...entry.options === void 0 ? {} : { options: entry.options }
    }))
  }, null, 2)}
`;
}

// packages/ui/dist/settings/index.js
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
    throw new Error(`invalid #${APP_THEME_DOM_ID} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64) {
    throw new Error(`#${APP_THEME_DOM_ID} must contain between 1 and 64 themes`);
  }
  const ids = /* @__PURE__ */ new Set();
  return Object.freeze(parsed.map((value, index) => {
    const entry = value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
    const id = entry?.["id"];
    const label = entry?.["label"];
    const stylesheet = entry?.["stylesheet"];
    if (typeof id !== "string" || !APP_THEME_ID.test(id)) {
      throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid id`);
    }
    if (ids.has(id))
      throw new Error(`#${APP_THEME_DOM_ID} contains duplicate theme id ${id}`);
    ids.add(id);
    if (typeof label !== "string" || label.trim() !== label || label.length === 0 || label.length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) {
      throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid label`);
    }
    if (typeof stylesheet !== "string" || !APP_THEME_STYLESHEET.test(stylesheet)) {
      throw new Error(`#${APP_THEME_DOM_ID} theme ${index} has an invalid stylesheet`);
    }
    return Object.freeze({ id, label, stylesheet });
  }));
}
function createSettingsUi(document2, options) {
  const root = document2.createElement("div");
  root.className = "modkit-viewer modkit-settings";
  setPart(root, "settings");
  const groupList = element(root, "nav", { part: "settings.groups" });
  groupList.setAttribute("aria-label", "Settings groups");
  if (options.onClose !== void 0) {
    const close = element(groupList, "button", {
      part: "settings.close",
      text: "\u2190 Back"
    });
    close.type = "button";
    close.title = "Close settings (Esc)";
    close.addEventListener("click", () => options.onClose?.());
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape")
        options.onClose?.();
    });
    root.tabIndex = -1;
  }
  const pane = element(root, "div", { part: "settings.pane" });
  const status = element(root, "output", { part: "settings.status" });
  let current = DEFAULT_SETTINGS;
  let activeGroup = "appearance";
  const say = (message, bad = false) => {
    status.textContent = message;
    setState(status, bad ? ["error"] : []);
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
    const wrapper = element(host, "div", { part: "settings.row" });
    element(wrapper, "div", { part: "settings.label", text: label });
    element(wrapper, "div", { part: "settings.description", text: description });
    return element(wrapper, "div", { part: "settings.control" });
  };
  const appearanceGroup = {
    id: "appearance",
    label: "Appearance",
    render(host) {
      if (options.themes.length > 0) {
        const control = row(host, "Color theme", "Applies immediately and to every viewer surface.");
        const select = element(control, "select", { part: "settings.select" });
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
      const densityControl = row(host, "Density", "Compact matches VS Code list metrics; comfortable suits touch and larger displays.");
      const density = element(densityControl, "select", {
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
      const intro = element(host, "p", { part: "settings.description" });
      intro.textContent = `Extensions are listed in ${options.store.location}. Each entry is an id, a path the host loads from, and whether it is enabled. The same file is read by the desktop app, the web app and a headless run.`;
      const readOnly = options.extensionsReadOnly;
      if (readOnly !== void 0) {
        element(host, "p", {
          part: "settings.description",
          text: safeViewerText(readOnly, 400)
        });
      }
      const list = element(host, "div", { part: "settings.list" });
      const draw = () => {
        list.replaceChildren();
        if (current.extensions.length === 0) {
          element(list, "p", {
            part: "settings.description",
            text: "No extensions are configured yet."
          });
        }
        for (const entry of current.extensions) {
          const item = element(list, "div", { part: "settings.extension" });
          if (readOnly === void 0) {
            const toggle = element(item, "input", {
              part: "settings.toggle"
            });
            toggle.type = "checkbox";
            toggle.checked = entry.enabled;
            toggle.setAttribute("aria-label", `Enable ${entry.id}`);
            toggle.addEventListener("change", () => {
              void persist({
                ...current,
                extensions: current.extensions.map((other) => other.id === entry.id ? { ...other, enabled: toggle.checked } : other)
              }).then(draw);
            });
          } else {
            element(item, "div", {
              part: "settings.description",
              text: entry.enabled ? "enabled" : "disabled"
            });
          }
          const text = element(item, "div", { part: "settings.extension-text" });
          element(text, "div", { part: "settings.label", text: safeViewerText(entry.id, 200) });
          element(text, "div", {
            part: "settings.description",
            text: safeViewerText(entry.path, 400)
          });
          if (readOnly === void 0) {
            const remove = element(item, "button", {
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
      if (readOnly !== void 0)
        return;
      const adder = element(host, "div", { part: "settings.adder" });
      const id = element(adder, "input", { part: "settings.input" });
      id.placeholder = "publisher/name";
      id.setAttribute("aria-label", "Extension id");
      const path = element(adder, "input", { part: "settings.input" });
      path.placeholder = "path, package or URL";
      path.setAttribute("aria-label", "Extension location");
      const add = (entry) => {
        void persist({
          ...current,
          extensions: [...current.extensions.filter((other) => other.id !== entry.id), entry]
        }).then(draw);
      };
      const addButton = element(adder, "button", {
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
        const browse = element(adder, "button", {
          part: "settings.add",
          text: "Browse\u2026"
        });
        browse.type = "button";
        browse.addEventListener("click", () => {
          void (async () => {
            const picked = await options.browseForExtension?.();
            if (picked !== void 0)
              add({ ...picked, enabled: true });
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
      element(host, "p", {
        part: "settings.description",
        text: "Make this app the default for the formats its codecs can open. Registration is per-user and reversible from the operating system, and nothing is written until you apply it."
      });
      if (types.length === 0) {
        element(host, "p", {
          part: "settings.description",
          text: "No codecs are loaded, so there is nothing to associate."
        });
        return;
      }
      const chosen = new Set(types);
      const list = element(host, "div", { part: "settings.list" });
      for (const type of types) {
        const item = element(list, "div", { part: "settings.extension" });
        const toggle = element(item, "input", { part: "settings.toggle" });
        toggle.type = "checkbox";
        toggle.checked = true;
        toggle.setAttribute("aria-label", `Associate .${type}`);
        toggle.addEventListener("change", () => {
          if (toggle.checked)
            chosen.add(type);
          else
            chosen.delete(type);
        });
        const text = element(item, "div", { part: "settings.extension-text" });
        element(text, "div", { part: "settings.label", text: `.${type}` });
      }
      const actions = element(host, "div", { part: "settings.adder" });
      const all = element(actions, "button", {
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
      const none = element(actions, "button", {
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
      const apply = element(actions, "button", {
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
            say(`Could not register: ${error instanceof Error ? error.message : String(error)}`, true);
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
    if (extraIds.has(group.id))
      throw new Error(`duplicate settings group id: ${group.id}`);
    extraIds.add(group.id);
  }
  const extrasById = new Map(extraGroups.map((group) => [group.id, group]));
  const primaryGroups = [appearanceGroup, extensionsGroup].map((group) => extrasById.get(group.id) ?? group);
  const primaryIds = new Set(primaryGroups.map((group) => group.id));
  const additionalGroups = extraGroups.filter((group) => !primaryIds.has(group.id) && !(options.registerFileTypes !== void 0 && group.id === associationsGroup.id));
  const groups = [
    ...primaryGroups,
    ...additionalGroups,
    ...options.registerFileTypes === void 0 ? [] : [extrasById.get(associationsGroup.id) ?? associationsGroup]
  ];
  function showActiveGroup() {
    const group = groups.find((item) => item.id === activeGroup) ?? groups[0];
    if (group !== void 0)
      showGroup(group);
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
      setState(node, selected ? ["selected"] : []);
    }
    group.render(pane, groupContext);
  };
  for (const group of groups) {
    const button2 = element(groupList, "button", {
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
      say(problems.length === 0 ? `Loaded from ${options.store.location}` : `Loaded with ${problems.length} problem(s): ${problems.join("; ")}`, problems.length > 0);
      for (const group of groups)
        await group.reload?.(groupContext);
      showActiveGroup();
    },
    showGroup(groupId) {
      const group = groups.find((item) => item.id === groupId);
      if (group === void 0)
        return false;
      showGroup(group);
      return true;
    },
    destroy() {
      for (const group of groups)
        group.destroy?.();
      root.remove();
    }
  };
  return ui;
}

// packages/ui/dist/localization/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
    if (language === "ru")
      return "ru";
    if (language === "en")
      return "en";
  }
  return "en";
}
function createUiLocalizer(locale, overrides = {}) {
  const catalog = Object.freeze({ ...UI_MESSAGES[locale], ...overrides });
  const localizer = {
    locale,
    text(key, values = {}) {
      return catalog[key].replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu, (_match, name) => {
        const value = values[name];
        return value === void 0 ? `{${name}}` : String(value);
      });
    }
  };
  return Object.freeze(localizer);
}

// apps/web/src/map-preview.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY = Object.freeze({
  locales: Object.freeze(["enUS"]),
  limits: Object.freeze({
    // A three-root SC2 workspace needs 327 bounded reads for all 108 catalog families plus locale.
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
function renderDiagnostics(root, descriptor) {
  root.replaceChildren();
  const grouped = diagnosticsBySeverity(descriptor.diagnostics);
  for (const severity of ["error", "warning", "information", "hint"]) {
    const section = element(root, "section", { part: "diagnostics.group" });
    section.dataset["severity"] = severity;
    element(section, "h2", {
      text: `${severity} (${grouped[severity].length})`,
      part: "diagnostics.heading"
    });
    const list = element(section, "ul", { part: "diagnostics.list" });
    for (const diagnostic2 of grouped[severity]) {
      const item = element(list, "li", { part: "diagnostics.item" });
      item.dataset["severity"] = severity;
      const button2 = element(item, "button", {
        text: diagnostic2.message,
        part: "diagnostics.message"
      });
      button2.type = "button";
      button2.dataset["diagnosticId"] = diagnostic2.id;
      button2.addEventListener("click", () => {
        root.dispatchEvent(new CustomEvent("modkit-diagnostic-jump", {
          bubbles: true,
          detail: { id: diagnostic2.id, range: diagnostic2.range }
        }));
      });
    }
  }
}
var diagnosticsPanel = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal);
    const root = createSurface(args.container, "Diagnostics");
    renderDiagnostics(root, args.descriptor);
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      renderDiagnostics(root, descriptor);
    });
  }
});
function renderToolbar(root, descriptor, operations, signal) {
  root.replaceChildren();
  const status = element(root, "output", { text: "Ready", part: "operations.status" });
  for (const operation of descriptor.operations) {
    if (operation.mutatesSource === true)
      continue;
    const button2 = element(root, "button", {
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
        onProgress: (completed, total, message) => setViewerText(status, `${message ?? "Working"}: ${completed}/${total ?? "?"}`)
      }).then((result) => setViewerText(status, result.state === "ok" ? `${operation.id}: complete` : result.reason)).catch((error) => setViewerText(status, `${operation.id}: ${error instanceof Error ? error.message : String(error)}`)).finally(() => {
        button2.disabled = false;
      });
    });
  }
}
var operationToolbar = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal);
    const root = createSurface(args.container, "Operations");
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
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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

// apps/web/src/settings.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
  const t = localizer.text;
  document.documentElement.lang = locale;
  document.title = t("app.title");
  const booting = document.querySelector(".booting");
  if (booting !== null) setViewerText(booting, t("app.starting"));
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
    t("app.title")
  );
  const statusLine = document.createElement("output");
  statusLine.className = "web-status";
  const restartSession = document.createElement("button");
  restartSession.className = "web-session-restart";
  restartSession.type = "button";
  restartSession.hidden = true;
  restartSession.textContent = t("action.restartSession");
  restartSession.title = t("action.restartSessionTitle");
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
  setViewerText(editingStatus, t("status.noFileEditable"));
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
    confirmDiscard: () => window.confirm(t("confirm.discardAndRestart")),
    restart: async () => {
      await services.dispose();
      window.location.reload();
    },
    onState: (state) => {
      restartSession.hidden = state !== "worker-unavailable";
      if (state === "worker-unavailable") say(t("status.workerUnavailable"));
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
  toolbarAction(t("action.openFile"), t("action.openFileTitle"), () => {
    void (async () => {
      try {
        const picked = await pickFile();
        if (picked !== void 0) await openFile(picked.file, picked.handle);
      } catch (error) {
        say(t("error.openFile", { reason: describe2(error) }));
      }
    })();
  });
  toolbarAction(t("action.splitEditor"), t("action.splitEditorTitle"), () => editors.split());
  toolbarAction(t("action.enableEditing"), t("action.enableEditingTitle"), () => {
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
    void openFile(file).catch((error) => say(t("error.drop", { reason: describe2(error) })));
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
    element(section, "h2", { text: t("settings.bundled") });
    element(section, "p", {
      part: "settings.description",
      text: t("settings.bundledDescription", {
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
      element(section, "h2", { text: t("settings.bundledExcluded") });
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
  element(sidebar, "h2", { text: t("sidebar.host") });
  element(sidebar, "p", {
    part: "settings.description",
    text: t("sidebar.hostSummary", {
      extensions: services.main.inventory.extensions.length,
      types: services.supportedExtensions.length,
      profiles: services.executionProfiles.join("/"),
      realm: services.worker.profile.realmId,
      sharedMemory: t(probe.sharedMemory ? "common.yes" : "common.no")
    })
  });
  element(sidebar, "p", { part: "settings.description", text: capability.notice });
  element(sidebar, "p", { part: "settings.description", text: WEB_EDITING_NOTICE });
  sidebar.append(editingStatus);
  element(sidebar, "h2", { text: t("sidebar.facilities") });
  const facilities = element(sidebar, "ul", { part: "settings.list" });
  for (const facility of services.main.profile.facilities) {
    element(facilities, "li", { text: facility });
  }
  element(sidebar, "h2", { text: t("sidebar.samples") });
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
  element(sidebar, "h2", { text: t("sidebar.language") });
  const localePicker = element(sidebar, "select", {
    part: "settings.select"
  });
  for (const candidate of ["en", "ru"]) {
    const option = document.createElement("option");
    option.value = candidate;
    setViewerText(option, t(`locale.${candidate}`));
    localePicker.append(option);
  }
  localePicker.value = locale;
  localePicker.setAttribute("aria-label", t("sidebar.language"));
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
  activity(t("activity.files"), t("activity.explorer"), () => showView("explorer"), "explorer");
  activity(t("activity.host"), t("activity.hostTitle"), () => {
    workbench.sidebar.hidden = !workbench.sidebar.hidden;
  });
  activity(t("activity.info"), t("activity.infoTitle"), () => {
    workbench.panel.hidden = !workbench.panel.hidden;
  });
  activity(t("activity.settings"), t("activity.settings"), () => showView("settings"), "settings");
  workbench.panel.hidden = true;
  workbench.sidebar.hidden = false;
  showView("explorer");
  await inspector.show(void 0);
  say(
    t("status.ready", {
      extensions: services.main.inventory.extensions.length,
      notices: bootDiagnostics.length
    })
  );
  async function openServed(path) {
    const file = await fetchServed(baseUrl, path);
    if (file === void 0) {
      say(t("error.fetch", { path }));
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
