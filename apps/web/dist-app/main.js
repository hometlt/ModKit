import {
  DEFAULT_SETTINGS,
  EXPLORER_MAXIMUM_BYTES,
  EXTENSION_ROOT_FAILURE_CODES,
  ViewerMountScope,
  WEB_EDITING_NOTICE,
  WEB_EXTENSION_CATALOG,
  WEB_PREVIEW_FALLBACK,
  ZIP_VERBATIM_REASSEMBLY_RECORDS,
  applyDensity,
  applyTheme,
  catalogCoordinates,
  containerCoordinate,
  createBrowserEditingBackend,
  createCodecPreview,
  createDirectoryAccess,
  createEditorArea,
  createEvidenceRegistry,
  createExplorer,
  createIndexedDbExtensionStore,
  createRawWriter,
  createSettingsUi,
  createSingleFileAccess,
  createSubjectEditing,
  createSurface,
  createWebPreviewStages,
  createWebSubjectServices,
  createWebTopology,
  defineViewerModule,
  describeFileCapability,
  diagnostic,
  diagnosticsPanel,
  element,
  isWritableHandle,
  loadUserExtensionRoots,
  mountWebWorkbench,
  normalizeSettings,
  operationToolbar,
  presentationSlotId,
  probeWebFacilities,
  requestUserExtensionPermission,
  revisionId,
  serializeSettings,
  setPart,
  setState,
  setViewerText
} from "./chunks/chunk-IDRNYFTJ.js";

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
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function byteRuns(value) {
  if (!Array.isArray(value) || value.length === 0) return void 0;
  const runs = [];
  for (const item of value) {
    if (!isRecord(item)) return void 0;
    const range = item["range"];
    const payload = item["payload"];
    if (!isRecord(range) || !isRecord(payload)) return void 0;
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
  if (!isRecord(change)) return void 0;
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
var WEB_EDIT_EVIDENCE = ZIP_VERBATIM_REASSEMBLY_RECORDS.reduce(
  (registry, record) => registry.with(record),
  createEvidenceRegistry()
);
function createWebEditingArm(options) {
  const evidence = WEB_EDIT_EVIDENCE;
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
           * looks like either: `WEB_EDIT_EVIDENCE` already names, record by record, which writer
           * proved which claim, and a claim with no record is still refused as `fidelity-unproven`.
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
