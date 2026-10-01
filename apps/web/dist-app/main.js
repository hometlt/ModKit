import {
  EXPLORER_MAXIMUM_BYTES,
  EXTENSION_ROOT_FAILURE_CODES,
  SubjectNavigationHistory,
  WEB_EXTENSION_CATALOG,
  WEB_SOURCE_FACILITY_UNAVAILABLE,
  WEB_SOURCE_FILESYSTEM_READ_RANDOM,
  WEB_SOURCE_OPEN_BOUNDARY,
  applyDensity,
  applyTheme,
  catalogCoordinates,
  combineLoadedExtensionRoots,
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
  createSubjectCard,
  createWebEditingArm,
  createWebExtensionSubjectCatalog,
  createWebLocalizer,
  createWebPreviewFallback,
  createWebPreviewStages,
  createWebSubjectServices,
  createWebTopology,
  describeEditability,
  describeFileCapability,
  isWritableHandle,
  loadManagedExtensionRoots,
  loadSubjectCardSections,
  loadUserExtensionRoots,
  loadWebLocalizationCatalogs,
  mountWebWorkbench,
  nestedSubjectServices,
  openNestedSubject,
  probeWebFacilities,
  requestUserExtensionPermission,
  requestWriteAccess,
  resolveCommonPresentationPlan,
  resolveFormatWriter,
  resolveModuleMap,
  sourceRevisionToken,
  sourceUriFor,
  stageIdOf,
  subjectFactsSourceFromWire,
  webExtensionSubjectCardBundle,
  withoutHiddenEntries
} from "./chunks/chunk-RFTCQXHB.js";
import "./chunks/chunk-ASPZNQTQ.js";
import "./chunks/chunk-34ZFSIL2.js";
import "./chunks/chunk-XPBF7FM6.js";
import {
  resolveModelViewerTextures
} from "./chunks/chunk-IJOJCD2M.js";
import "./chunks/chunk-O2DY4UGD.js";
import "./chunks/chunk-64G7DVXS.js";
import "./chunks/chunk-MVL6AV2G.js";
import "./chunks/chunk-Q27WXNQ4.js";
import "./chunks/chunk-QQJVD7VT.js";
import {
  declaredMutatingOperations,
  editOffer,
  fidelityNote,
  invokeRefusalMessage,
  isRejected,
  mountFieldEditor,
  subjectCandidateProviderLease
} from "./chunks/chunk-R6DLKFH6.js";
import "./chunks/chunk-Z7DHDFGG.js";
import {
  DEFAULT_UI_LOCALIZER,
  PANELS_FALLBACK_MESSAGES,
  SETTINGS_FALLBACK_MESSAGES,
  ViewerMountScope,
  contributionContractLabel,
  createSurface,
  createViewerMount,
  defineViewerModule,
  diagnosticsBySeverity,
  element,
  invokeOperation,
  safeViewerText,
  setPart,
  setState,
  setViewerText,
  withEnglishUiFallback
} from "./chunks/chunk-CL6TKSRK.js";
import {
  CONTAINER_EXTRACT_OPERATION_ID,
  compareUtf8,
  diagnostic,
  isModkitError,
  isQualifiedId,
  normalizeModkitIdentifier,
  presentationSlotId,
  revisionId
} from "./chunks/chunk-BPQHTKO4.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunks/chunk-BLWUC7LO.js";

// apps/web/src/shell.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/ui/dist/settings/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/ui/dist/settings/model.js
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
      if (seenIds.has(id))
        continue;
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
      disabledExtensions: Object.freeze(disabledExtensions),
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
    // `?? []` keeps runtime serialization compatible with schema-v1 documents created before
    // this additive field existed. `normalizeSettings` always returns the complete shape.
    disabledExtensions: [...document2.disabledExtensions ?? []].sort(compareUtf8),
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

// ../MODDING/modkit-core/packages/ui/dist/settings/index.js
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
  const localizer = withEnglishUiFallback(options.localizer, SETTINGS_FALLBACK_MESSAGES);
  const root = document2.createElement("div");
  root.className = "modkit-viewer modkit-settings";
  setPart(root, "settings");
  const groupList = element(root, "nav", { part: "settings.groups" });
  groupList.setAttribute("aria-label", localizer.text("settings.groups"));
  if (options.onClose !== void 0) {
    const close = element(groupList, "button", {
      part: "settings.close",
      text: localizer.text("settings.back")
    });
    close.type = "button";
    close.title = localizer.text("settings.close");
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
      say(localizer.text("settings.savedTo", { location: options.store.location }));
    } catch (error) {
      say(localizer.text("settings.saveError", {
        reason: error instanceof Error ? error.message : String(error)
      }), true);
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
    label: localizer.text("settings.appearance"),
    render(host) {
      if (options.themes.length > 0) {
        const control = row(host, localizer.text("settings.colorTheme"), localizer.text("settings.themeDescription"));
        const select = element(control, "select", { part: "settings.select" });
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
      const densityControl = row(host, localizer.text("settings.density"), localizer.text("settings.densityDescription"));
      const density = element(densityControl, "select", {
        part: "settings.select"
      });
      density.setAttribute("aria-label", localizer.text("settings.density"));
      for (const value of ["compact", "comfortable"]) {
        const option = document2.createElement("option");
        option.value = value;
        option.textContent = localizer.text(value === "compact" ? "settings.compact" : "settings.comfortable");
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
      const intro = element(host, "p", { part: "settings.description" });
      intro.textContent = localizer.text("settings.extensionsLocationIntro", {
        location: options.store.location
      });
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
            text: localizer.text("settings.noExtensions")
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
            toggle.setAttribute("aria-label", localizer.text("settings.enableExtension", { id: entry.id }));
            toggle.addEventListener("change", () => {
              void persist({
                ...current,
                extensions: current.extensions.map((other) => other.id === entry.id ? { ...other, enabled: toggle.checked } : other)
              }).then(draw);
            });
          } else {
            element(item, "div", {
              part: "settings.description",
              text: localizer.text(entry.enabled ? "common.enabled" : "common.disabled")
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
      if (readOnly !== void 0)
        return;
      const adder = element(host, "div", { part: "settings.adder" });
      const id = element(adder, "input", { part: "settings.input" });
      id.placeholder = "publisher/name";
      id.setAttribute("aria-label", localizer.text("settings.extensionId"));
      const path = element(adder, "input", { part: "settings.input" });
      path.placeholder = localizer.text("settings.extensionPathPlaceholder");
      path.setAttribute("aria-label", localizer.text("settings.extensionLocation"));
      const add = (entry) => {
        void persist({
          ...current,
          extensions: [...current.extensions.filter((other) => other.id !== entry.id), entry]
        }).then(draw);
      };
      const addButton = element(adder, "button", {
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
        const browse = element(adder, "button", {
          part: "settings.add",
          text: localizer.text("settings.browse")
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
    label: localizer.text("settings.fileAssociations"),
    render(host) {
      const types = [...options.associableTypes ?? []].sort();
      element(host, "p", {
        part: "settings.description",
        text: localizer.text("settings.associationsDescription")
      });
      if (types.length === 0) {
        element(host, "p", {
          part: "settings.description",
          text: localizer.text("settings.noCodecs")
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
        toggle.setAttribute("aria-label", localizer.text("settings.associate", { type }));
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
        text: localizer.text("settings.selectAll")
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
        text: localizer.text("settings.selectNone")
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
            say(await registerFileTypes?.([...chosen]) ?? localizer.text("settings.nothingToRegister"));
          } catch (error) {
            say(localizer.text("settings.registerError", {
              reason: error instanceof Error ? error.message : String(error)
            }), true);
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
      say(problems.length === 0 ? localizer.text("settings.loadedFrom", { location: options.store.location }) : localizer.text("settings.loadedProblems", {
        count: problems.length,
        problems: problems.join("; ")
      }), problems.length > 0);
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

// apps/web/src/map-preview.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
    ...result.state === "selection-required" ? [selectionDiagnostic(localizer)] : [],
    ...permissionRequired ? [permissionDiagnostic(localizer)] : []
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
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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

// apps/web/src/edit-panel.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// apps/web/src/edit-operations.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

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

// apps/web/src/inspector.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/ui/dist/panels/index.js
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
function createDiagnosticsPanel(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, PANELS_FALLBACK_MESSAGES);
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("panels.diagnostics"));
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
  const status = element(root, "output", {
    text: localizer.text("panels.ready"),
    part: "operations.status"
  });
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
        onProgress: (completed, total, message) => setViewerText(status, `${message ?? localizer.text("panels.working")}: ${completed}/${total ?? "?"}`)
      }).then((result) => setViewerText(status, result.state === "ok" ? localizer.text("panels.operationComplete", { operation: operation.id }) : result.reason)).catch((error) => setViewerText(status, `${operation.id}: ${error instanceof Error ? error.message : String(error)}`)).finally(() => {
        button2.disabled = false;
      });
    });
  }
}
function createOperationToolbar(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, PANELS_FALLBACK_MESSAGES);
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("panels.operations"));
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
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
var object = (value, label) => {
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
      const step = object(item, `${label}[${index}]`);
      return Object.freeze({
        formatId: nonBlank(step["formatId"], `${label}[${index}].formatId`),
        extensionId: nonBlank(step["extensionId"], `${label}[${index}].extensionId`),
        contributionId: nonBlank(step["contributionId"], `${label}[${index}].contributionId`)
      });
    })
  );
};
function validatePwaFormatSmokeAuthority(value) {
  const input = object(value, "format smoke authority");
  if (input["kind"] !== "x3.ga-recovery/format-family-smoke" || input["schemaVersion"] !== 1) {
    throw new TypeError("format smoke authority has the wrong kind or schemaVersion");
  }
  if (!Array.isArray(input["cases"]) || input["cases"].length !== FORMAT_SMOKE_CASE_IDS.length) {
    throw new TypeError("format smoke authority must contain exactly 14 cases");
  }
  const cases = input["cases"].map((item, index) => {
    const entry = object(item, `cases[${index}]`);
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
    const corpus = object(entry["corpus"], `${id}.corpus`);
    const runtime = object(entry["runtime"], `${id}.runtime`);
    const pwa = object(runtime["pwa"], `${id}.runtime.pwa`);
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
  const generatedFrom = object(input["generatedFrom"], "generatedFrom");
  const bundledCatalog = object(generatedFrom["bundledCatalog"], "generatedFrom.bundledCatalog");
  const offlineRelease = object(generatedFrom["offlineRelease"], "generatedFrom.offlineRelease");
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
            const root = object(item, `generatedFrom.bundledCatalog.roots[${index}]`);
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
var positive = (value) => Number.isFinite(value) && value > 0;
function stagePass(expected, actual) {
  if (expected !== actual.kind) return false;
  if (actual.kind === "raster") {
    return positive(actual.width) && positive(actual.height) && positive(actual.opaquePixels) && positive(actual.metadataEntries);
  }
  if (actual.kind === "tree-text") {
    return positive(actual.treeNodes) && positive(actual.textCharacters);
  }
  if (actual.kind === "tree") return positive(actual.treeNodes);
  if (actual.kind === "metadata-tree") {
    return positive(actual.metadataEntries) && positive(actual.treeNodes);
  }
  return positive(actual.width) && positive(actual.height);
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
      const runtime = await options.bridge.runtimeIdentity();
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
        [...runtime.packages].map((item) => Object.freeze({ ...item })).sort((left, right) => compareText(left.id, right.id))
      );
      const identityPass = runtime.offlineCatalogSha256 === authority.generatedFrom.offlineRelease.catalogSha256 && same(sorted(runtime.loadedManagedRoots), authority.generatedFrom.offlineRelease.roots) && runtime.codecContributionCount === authority.generatedFrom.codecContributionCount && same(
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
          actualOfflineCatalogSha256: runtime.offlineCatalogSha256,
          expectedManagedRoots: authority.generatedFrom.offlineRelease.roots,
          loadedManagedRoots: sorted(runtime.loadedManagedRoots),
          expectedCodecContributionCount: authority.generatedFrom.codecContributionCount,
          loadedCodecContributionCount: runtime.codecContributionCount
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
  let t = localizer.text;
  document.documentElement.lang = locale;
  document.title = t("app.title");
  const booting = document.querySelector(".booting");
  if (booting !== null) setViewerText(booting, t("app.starting"));
  const capability = describeFileCapability(window);
  let capabilityNotice = t(
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
  t = localizer.text;
  capabilityNotice = t(
    capability.directories ? "web.capability.folder" : capability.filePicker ? "web.capability.file" : "web.capability.input"
  );
  document.documentElement.lang = locale;
  document.title = t("app.title");
  if (booting !== null) setViewerText(booting, t("app.starting"));
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
    t("app.title"),
    localizer
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
  setViewerText(editingStatus, t("status.noFileEditable"));
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
    if (parent === void 0) return t("web.archive.sessionGone");
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
      return t("web.status.noNestedCodec", { name: entryPath, reason: nested.result.reason });
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
    textures: (descriptor, references, signal) => {
      const raster = rasterResources.get(descriptorKey(descriptor));
      return raster === void 0 ? Promise.resolve(/* @__PURE__ */ new Map()) : resolveModelViewerTextures(raster, references, signal);
    },
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
        say(t("web.status.noCodec", { name: entry.name, reason: ordinary.reason }));
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
          t("web.map.choose", {
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
        say(t("web.map.permissionRequired", { name: entry.name }));
      } else if (mapPreview.state === "selection-required") {
        say(
          t("web.map.selectionRequired", {
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
            t("web.status.sharedCommandsUnavailable", { name: entry.name, reason: String(error) })
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
      return window.confirm(t("web.status.unsavedClose", { name: entry.name })) ? "discard" : "cancel";
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
    void openFile(file).catch((error) => say(t("error.drop", { reason: describe2(error) })));
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
  element(sidebar, "p", { part: "settings.description", text: capabilityNotice });
  element(sidebar, "p", { part: "settings.description", text: t("web.editing.notice") });
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
      text: t(sample.labelKey)
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
      const metadataEntries = (readout?.textContent ?? "").trim() === "" ? 0 : 1;
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
        metadataEntries
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
      const metadataEntries = await metadataEntryCount();
      const group2 = await selectFormatSmokeStage(
        "tree",
        () => visibleInGroup(activeEditorGroup(), '[data-mk-part="tree.item"]') !== void 0
      );
      return Object.freeze({
        kind: "metadata-tree",
        metadataEntries,
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
      "sha256:095ff06d89547feb4555fe6b0b6194218256da046931ccd7ee805128e5bb1fdd"
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
