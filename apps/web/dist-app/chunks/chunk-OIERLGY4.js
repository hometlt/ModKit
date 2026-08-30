import {
  WRITER_CONTRACT_ID,
  WRITER_FACET_MATCHER_PROFILE,
  WRITER_SURFACE,
  grantValidity,
  validateSubjectDescriptorV2,
  writerOfferSatisfies,
  writerSelectionKey
} from "./chunk-ODEN2UNX.js";
import {
  ModkitError,
  canonicalJsonStringify,
  contractId,
  diagnostic,
  isCancellation,
  throwIfAborted,
  uint64
} from "./chunk-GZ3IOGQJ.js";

// packages/sdk/dist/language/index.js
var LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT = "common.language/document-analysis";
var LANGUAGE_DOCUMENT_MATCHER_PROFILE = "org.modkitx/language-document-matcher";

// packages/sdk/dist/runtime/index.js
var RUNTIME_PROVIDER_CONTRACT = "common.runtime/provider";
var RUNTIME_SESSION_CONTRACT = "common.runtime/session";
var RUNTIME_PROVIDER_MATCHER_PROFILE = "org.modkitx/runtime-provider-matcher";
var RUNTIME_SESSION_V2_MEMBERS = Object.freeze([
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
var GAME_LAUNCH_PLAN_CONTRACT = "common.game/launch-plan";
var GAME_INSTALLATION_MATCHER_PROFILE = "org.modkitx/game-installation-matcher";

// packages/sdk/dist/mods/index.js
var MOD_WORKSPACE_COMPOSITION_CONTRACT = "common.mod/workspace-composition";
var MOD_WORKSPACE_MATCHER_PROFILE = "org.modkitx/mod-workspace-matcher";

// packages/sdk/dist/data/index.js
var DATA_CATALOG_ANALYSIS_CONTRACT = "common.data/catalog-analysis";
var DATA_CATALOG_MATCHER_PROFILE = "org.modkitx/data-catalog-matcher";
var RESOLVED_DATA_WORKSPACE_CONTRACT = "common.data/resolved-workspace";
var RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE = "org.modkitx/resolved-data-workspace-matcher";

// packages/sdk/dist/maps/index.js
var MAP_SEMANTIC_ANALYSIS_CONTRACT = "common.map/semantic-analysis";
var RESOLVED_MAP_WORKSPACE_CONTRACT = "common.map/resolved-workspace";
var MAP_PREVIEW_PREPARATION_CONTRACT = "common.map/preview-preparation";
var MAP_SEMANTIC_MATCHER_PROFILE = "org.modkitx/map-semantic-matcher";
var MAP_PREVIEW_PREPARATION_MATCHER_PROFILE = "org.modkitx/map-preview-preparation-matcher";

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
var COMMAND_SUBJECT_UNRESOLVED = "x3.command/subject-unresolved";
var COMMAND_UNAVAILABLE = "x3.command/unavailable";
var commandDiagnostic = (item) => ({
  code: item.code,
  message: item.message,
  ...item.severity === void 0 ? {} : { severity: item.severity }
});
var ok = (command, data, diagnostics = []) => ({ state: "ok", command, data, diagnostics });
var unavailable = (command, reason, alternative, diagnostics = [], code = COMMAND_UNAVAILABLE) => ({ state: "unavailable", command, code, reason, alternative, diagnostics });
var failed = (command, code, message, diagnostics = []) => ({ state: "failed", command, code, message, diagnostics });
var RESULT_STATES = Object.freeze(["ok", "unavailable", "failed"]);
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
function defineSubjectCommandTargets(targets) {
  return deepFreeze(targets);
}
var SUBJECT_COMMAND_TARGETS = defineSubjectCommandTargets({
  open: {
    commandId: "subject.open",
    needsSubject: true,
    mutatesSource: false,
    operationIds: [],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  inspect: {
    commandId: "subject.inspect",
    needsSubject: true,
    mutatesSource: false,
    operationIds: [],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  validate: {
    commandId: "subject.validate",
    needsSubject: true,
    mutatesSource: false,
    operationIds: ["asset.validate"],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  extract: {
    commandId: "subject.extract",
    needsSubject: true,
    mutatesSource: false,
    operationIds: ["container.extract"],
    dataSourceContracts: ["common.view/namespace-entry-source"],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  convert: {
    commandId: "subject.convert",
    needsSubject: true,
    mutatesSource: false,
    operationIds: ["export.convert", "export.raw"],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  preview: {
    commandId: "subject.preview",
    needsSubject: true,
    mutatesSource: false,
    operationIds: ["view.thumbnail", "view.render"],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  }
});
var OPEN_COMMAND = SUBJECT_COMMAND_TARGETS.open.commandId;
var INSPECT_COMMAND = SUBJECT_COMMAND_TARGETS.inspect.commandId;
var VALIDATE_COMMAND = SUBJECT_COMMAND_TARGETS.validate.commandId;
var VALIDATE = SUBJECT_COMMAND_TARGETS.validate.operationIds[0];
var EXTRACT_COMMAND = SUBJECT_COMMAND_TARGETS.extract.commandId;
var CONTAINER_EXTRACT_OPERATION_ID2 = SUBJECT_COMMAND_TARGETS.extract.operationIds[0];
var NAMESPACE_ENTRY_SOURCE = SUBJECT_COMMAND_TARGETS.extract.dataSourceContracts[0];
var CONVERT_COMMAND = SUBJECT_COMMAND_TARGETS.convert.commandId;
var CONVERT = SUBJECT_COMMAND_TARGETS.convert.operationIds[0];
var RAW_EXPORT = SUBJECT_COMMAND_TARGETS.convert.operationIds[1];
var PREVIEW_COMMAND = SUBJECT_COMMAND_TARGETS.preview.commandId;
var THUMBNAIL = SUBJECT_COMMAND_TARGETS.preview.operationIds[0];
var RENDER = SUBJECT_COMMAND_TARGETS.preview.operationIds[1];
function availableOperation(descriptor, id) {
  const found = (descriptor.operations ?? []).find(
    (item) => item.id === id && item.state === "available" && item.mutatesSource !== true
  );
  return found === void 0 ? void 0 : { handlerId: found.handlerId };
}
var publishedOperations = (descriptor) => (descriptor.operations ?? []).length === 0 ? "it publishes no operations at all" : `it publishes ${(descriptor.operations ?? []).map((item) => item.id).join(", ")}`;
async function withSubject(command, context, ref, body) {
  context.progress?.({ step: "open", message: `opening ${ref}` });
  const subject = await context.openSubject(ref, context.signal);
  const diagnostics = subject.snapshot.diagnostics.map((item) => ({
    code: item.code,
    message: item.message,
    ...item.severity === void 0 ? {} : { severity: item.severity }
  }));
  try {
    if (subject.snapshot.state !== "opened" || subject.session === void 0) {
      return failed(
        command,
        COMMAND_SUBJECT_UNRESOLVED,
        subject.snapshot.state === "opened" ? "the subject opened without a session" : `no contribution claimed this subject: ${subject.snapshot.reason}`,
        diagnostics
      );
    }
    const descriptor = await subject.session.descriptor();
    return await body(subject, subject.session, descriptor, diagnostics);
  } finally {
    await subject.dispose();
  }
}
async function invoke(command, context, session, handlerId, input, diagnostics) {
  const answer = await session.operations().invoke(handlerId, input, context.signal === void 0 ? {} : { signal: context.signal });
  const carried = [...diagnostics, ...answer.diagnostics.map(commandDiagnostic)];
  if (answer.state !== "ok") {
    return {
      state: "failed",
      result: failed(
        command,
        `x3.command/operation-${answer.reason}`,
        `the subject refused ${handlerId}: ${answer.reason}`,
        carried
      )
    };
  }
  return { state: "ok", output: answer.output };
}
var openCommand = {
  id: OPEN_COMMAND,
  title: "Open",
  summary: "Open a subject and report which contribution claimed it, and under which boundary.",
  needsSubject: true,
  mutatesSource: false,
  async run(context, input) {
    return withSubject(
      OPEN_COMMAND,
      context,
      String(input.subject),
      async (subject, _session, descriptor, diagnostics) => {
        const snapshot2 = subject.snapshot;
        if (snapshot2.state !== "opened")
          return failed(OPEN_COMMAND, COMMAND_SUBJECT_UNRESOLVED, "unreachable", diagnostics);
        return ok(
          OPEN_COMMAND,
          {
            ref: subject.ref,
            state: "opened",
            selected: {
              contributionId: snapshot2.selected.contributionId,
              variantId: snapshot2.selected.variantId,
              confidence: snapshot2.selected.confidence
            },
            formatId: descriptor.identity?.formatId ?? null,
            formatLabel: descriptor.identity?.formatLabel ?? null,
            candidates: snapshot2.candidates.length,
            operations: (descriptor.operations ?? []).map((item) => item.id)
          },
          diagnostics
        );
      }
    );
  }
};
var inspectCommand = {
  id: INSPECT_COMMAND,
  title: "Inspect",
  summary: "Report the full descriptor of a subject: identity, traits, operations, data sources.",
  needsSubject: true,
  mutatesSource: false,
  async run(context, input) {
    return withSubject(
      INSPECT_COMMAND,
      context,
      String(input.subject),
      async (subject, _session, descriptor, diagnostics) => {
        context.progress?.({ step: "describe", message: "reading the descriptor" });
        return ok(
          INSPECT_COMMAND,
          {
            ref: subject.ref,
            identity: {
              formatId: descriptor.identity?.formatId ?? null,
              formatLabel: descriptor.identity?.formatLabel ?? null
            },
            traits: (descriptor.traits ?? []).map((item) => ({ id: item.id, state: item.state })),
            operations: (descriptor.operations ?? []).map((item) => ({
              id: item.id,
              state: item.state,
              ...item.reason === void 0 ? {} : { reason: item.reason }
            })),
            dataSources: (descriptor.dataSources ?? []).map(
              (item) => `${item.contract}@${item.major}`
            ),
            metadataGroups: (descriptor.metadata ?? []).map((group) => ({
              id: group.id,
              entries: group.entries.length
            }))
          },
          diagnostics
        );
      }
    );
  }
};
var validateCommand = {
  id: VALIDATE_COMMAND,
  title: "Validate",
  summary: "Run the subject\u2019s own validation, when the codec publishes one.",
  needsSubject: true,
  mutatesSource: false,
  operationId: VALIDATE,
  async run(context, input) {
    return withSubject(
      VALIDATE_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = availableOperation(descriptor, VALIDATE);
        if (operation === void 0) {
          return unavailable(
            VALIDATE_COMMAND,
            `this subject publishes no available \xAB${VALIDATE}\xBB \u2014 ${publishedOperations(descriptor)}`,
            "run subject.inspect: it reports every trait and diagnostic the codec did produce, which is what validation would have been reading",
            diagnostics
          );
        }
        context.progress?.({ step: "validate", message: "running the codec\u2019s validation" });
        const answer = await invoke(
          VALIDATE_COMMAND,
          context,
          session,
          operation.handlerId,
          {},
          diagnostics
        );
        if (answer.state === "failed") return answer.result;
        return ok(
          VALIDATE_COMMAND,
          {
            ref: subject.ref,
            outputKind: answer.output.kind,
            report: answer.output.value ?? null
          },
          diagnostics
        );
      }
    );
  }
};
async function entryIdFor(session, wanted, signal) {
  const lease = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1);
  try {
    const namespace = lease.value;
    let cursor3;
    do {
      const page = await namespace.list(
        "",
        cursor3 === void 0 ? { limit: 512 } : { cursor: cursor3, limit: 512 },
        signal
      );
      const found = page.items.find((item) => item.path === wanted || item.id === wanted);
      if (found !== void 0) return found.id;
      cursor3 = page.nextCursor;
    } while (cursor3 !== void 0);
    return void 0;
  } finally {
    await lease.release();
  }
}
var extractCommand = {
  id: EXTRACT_COMMAND,
  title: "Extract",
  summary: "Read one member out of a container, through the container\u2019s own bounded extraction.",
  needsSubject: true,
  mutatesSource: false,
  operationId: CONTAINER_EXTRACT_OPERATION_ID2,
  async run(context, input) {
    const entry2 = typeof input.entry === "string" ? input.entry : "";
    if (entry2 === "") {
      return failed(EXTRACT_COMMAND, "x3.command/input-invalid", "subject.extract needs an \xABentry\xBB");
    }
    return withSubject(
      EXTRACT_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = availableOperation(descriptor, CONTAINER_EXTRACT_OPERATION_ID2);
        const listing = (descriptor.dataSources ?? []).some(
          (item) => item.contract === NAMESPACE_ENTRY_SOURCE
        );
        if (operation === void 0 || !listing) {
          return unavailable(
            EXTRACT_COMMAND,
            `this subject is not a container this host can read into \u2014 ${publishedOperations(descriptor)}`,
            `run subject.inspect to see what it does publish; extraction needs both \xAB${CONTAINER_EXTRACT_OPERATION_ID2}\xBB and \xAB${NAMESPACE_ENTRY_SOURCE}\xBB`,
            diagnostics
          );
        }
        context.progress?.({ step: "locate", message: `locating ${entry2}` });
        const entryId = await entryIdFor(session, entry2, context.signal);
        if (entryId === void 0) {
          return failed(
            EXTRACT_COMMAND,
            "x3.command/entry-not-found",
            `this container lists no \xAB${entry2}\xBB`,
            diagnostics
          );
        }
        context.progress?.({ step: "extract", message: `extracting ${entry2}` });
        const answer = await invoke(
          EXTRACT_COMMAND,
          context,
          session,
          operation.handlerId,
          { entryId },
          diagnostics
        );
        if (answer.state === "failed") return answer.result;
        if (answer.output.kind !== "bytes") {
          return failed(
            EXTRACT_COMMAND,
            "x3.command/unexpected-output",
            `the container answered ${answer.output.kind}, not bytes`,
            diagnostics
          );
        }
        const bytes = answer.output.value;
        const name = entry2.slice(entry2.lastIndexOf("/") + 1);
        const wroteTo = context.writeOutput === void 0 ? void 0 : await context.writeOutput(name, bytes, context.signal);
        return ok(
          EXTRACT_COMMAND,
          {
            ref: subject.ref,
            entry: entry2,
            byteLength: bytes.byteLength,
            ...wroteTo === void 0 ? { wroteTo: null } : { wroteTo }
          },
          diagnostics
        );
      }
    );
  }
};
var convertCommand = {
  id: CONVERT_COMMAND,
  title: "Convert",
  summary: "Export a subject through the codec\u2019s own conversion, when it publishes one.",
  needsSubject: true,
  mutatesSource: false,
  operationId: CONVERT,
  async run(context, input) {
    return withSubject(
      CONVERT_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = availableOperation(descriptor, CONVERT) ?? availableOperation(descriptor, RAW_EXPORT);
        if (operation === void 0) {
          return unavailable(
            CONVERT_COMMAND,
            `this subject publishes neither \xAB${CONVERT}\xBB nor \xAB${RAW_EXPORT}\xBB \u2014 ${publishedOperations(descriptor)}`,
            "run subject.inspect to see which data sources it does publish; a universal projection is the route for formats with no native export",
            diagnostics
          );
        }
        context.progress?.({ step: "convert", message: "running the codec\u2019s export" });
        const request = typeof input.target === "string" ? { target: input.target } : {};
        const answer = await invoke(
          CONVERT_COMMAND,
          context,
          session,
          operation.handlerId,
          request,
          diagnostics
        );
        if (answer.state === "failed") return answer.result;
        const bytes = answer.output.kind === "bytes" ? answer.output.value : void 0;
        const wroteTo = bytes === void 0 || context.writeOutput === void 0 ? void 0 : await context.writeOutput(
          `${input.target ?? "export"}`,
          bytes,
          context.signal
        );
        return ok(
          CONVERT_COMMAND,
          {
            ref: subject.ref,
            outputKind: answer.output.kind,
            ...bytes === void 0 ? {} : { byteLength: bytes.byteLength },
            ...wroteTo === void 0 ? { wroteTo: null } : { wroteTo }
          },
          diagnostics
        );
      }
    );
  }
};
var previewCommand = {
  id: PREVIEW_COMMAND,
  title: "Preview",
  summary: "Produce the subject\u2019s own preview \u2014 a thumbnail if it has one, a render otherwise.",
  needsSubject: true,
  mutatesSource: false,
  operationId: THUMBNAIL,
  async run(context, input) {
    return withSubject(
      PREVIEW_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const thumbnail = availableOperation(descriptor, THUMBNAIL);
        const operation = thumbnail ?? availableOperation(descriptor, RENDER);
        if (operation === void 0) {
          return unavailable(
            PREVIEW_COMMAND,
            `this subject publishes no \xAB${THUMBNAIL}\xBB or \xAB${RENDER}\xBB \u2014 ${publishedOperations(descriptor)}`,
            `mount a viewer over one of its data sources instead: ${(descriptor.dataSources ?? []).map((item) => item.contract).join(", ") || "it publishes none"}`,
            diagnostics
          );
        }
        context.progress?.({ step: "preview", message: "rendering the preview" });
        const answer = await invoke(
          PREVIEW_COMMAND,
          context,
          session,
          operation.handlerId,
          {},
          diagnostics
        );
        if (answer.state === "failed") return answer.result;
        const bytes = answer.output.kind === "bytes" ? answer.output.value : void 0;
        return ok(
          PREVIEW_COMMAND,
          {
            ref: subject.ref,
            via: thumbnail === void 0 ? RENDER : THUMBNAIL,
            outputKind: answer.output.kind,
            ...bytes === void 0 ? {} : { byteLength: bytes.byteLength }
          },
          diagnostics
        );
      }
    );
  }
};
var SUBJECT_COMMANDS = Object.freeze([
  openCommand,
  inspectCommand,
  validateCommand,
  extractCommand,
  convertCommand,
  previewCommand
]);
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
var MAX_SIGNATURE_WINDOW_BYTES = 4096 + 64;
var PROFILE_VALUES = Object.freeze([
  "browser-sandbox",
  "worker-brokered",
  "process-brokered",
  "wasm-brokered",
  "trusted-in-process",
  "remote-provider"
]);
var PROBE_PERMISSION_CLASSES = Object.freeze(["read-source"]);
function rejected(reason, message) {
  return {
    state: "rejected",
    reason,
    diagnostics: [diagnostic("error", `x3.host/${reason}`, message)]
  };
}
function snapshotInput2(input) {
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
      const value = snapshotInput2(output.value);
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
      const required = declaration.requiredPermissions ?? [];
      const validity = grantValidity(options.permissionGrant);
      const missing = required.filter((item) => !options.permissionGrant.classes.includes(item));
      if (validity.state !== "valid" || missing.length > 0) {
        return rejected(
          "permission-missing",
          validity.state === "valid" ? `operation requires permissions: ${missing.join(", ")}` : "the operation permission grant is not valid"
        );
      }
      const ownedInput = snapshotInput2(input);
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
function facetOf(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record = value;
  const own = Object.keys(record);
  if (own.length !== keys.length || !keys.every((key2) => own.includes(key2))) return void 0;
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
var SYMBOL_KINDS = /* @__PURE__ */ new Set([
  "class",
  "constant",
  "enum",
  "field",
  "function",
  "interface",
  "module",
  "namespace",
  "property",
  "struct",
  "variable"
]);
var COMPLETION_KINDS = /* @__PURE__ */ new Set([
  ...SYMBOL_KINDS,
  "keyword",
  "parameter",
  "snippet",
  "text",
  "type"
]);
var OFFER_KEYS2 = /* @__PURE__ */ new Set(["languageIds", "documentKinds", "extensions"]);
var REQUEST_KEYS = /* @__PURE__ */ new Set(["languageId", "documentKind", "extension"]);
function recordOf2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function stringList(value) {
  if (!Array.isArray(value) || value.length === 0) return void 0;
  if (!value.every((item) => typeof item === "string" && item.trim().length > 0)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer(value) {
  const record = recordOf2(value);
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
function parseRequest(value) {
  const record = recordOf2(value);
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
var normalizedExtension2 = (value) => value.replace(/^\./u, "").toLowerCase();
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
    (value) => normalizedExtension2(value) === normalizedExtension2(requestExtension)
  )) {
    return { state: "no-match" };
  }
  return {
    state: "match",
    selectionKey: [
      `language=${request.languageId}`,
      `document=${request.documentKind ?? "*"}`,
      `extension=${request.extension === void 0 ? "*" : normalizedExtension2(request.extension)}`
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
    fields: Object.freeze(["contract", "languageIds", "workspaceLanguageIds"]),
    methods: Object.freeze({
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      completion: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      hover: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      signatureHelp: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      definition: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      references: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      prepareRename: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      rename: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      formatting: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      documentSymbols: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      workspaceSymbols: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      diagnostics: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS3 = /* @__PURE__ */ new Set(["runtimeIds"]);
var REQUEST_KEYS2 = /* @__PURE__ */ new Set(["runtimeId"]);
function recordOf3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList2(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer2(value) {
  const record = recordOf3(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS3.has(key2)))
    return void 0;
  const runtimeIds = stringList2(record["runtimeIds"]);
  return runtimeIds === void 0 ? void 0 : { runtimeIds };
}
function parseRequest2(value) {
  const record = recordOf3(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS2.has(key2)))
    return void 0;
  const runtimeId = record["runtimeId"];
  return nonEmptyString(runtimeId) ? { runtimeId } : void 0;
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
function recordOf4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString2(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList3(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString2)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function outputKind(value) {
  return typeof value === "string" && OUTPUT_KINDS.has(value) ? value : void 0;
}
function outputKindList(value) {
  if (!Array.isArray(value) || value.length === 0) return void 0;
  const outputKinds = value.flatMap((item) => {
    const parsed = outputKind(item);
    return parsed === void 0 ? [] : [parsed];
  });
  return outputKinds.length === value.length && new Set(outputKinds).size === outputKinds.length ? outputKinds : void 0;
}
function parseOffer3(value) {
  const record = recordOf4(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS4.has(key2)))
    return void 0;
  const rendererIds = stringList3(record["rendererIds"]);
  const outputKinds = outputKindList(record["outputKinds"]);
  return rendererIds === void 0 || outputKinds === void 0 ? void 0 : { rendererIds, outputKinds };
}
function parseRequest3(value) {
  const record = recordOf4(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS3.has(key2)))
    return void 0;
  const rendererId = record["rendererId"];
  const parsedOutput = outputKind(record["outputKind"]);
  if (parsedOutput === void 0 || rendererId !== void 0 && !nonEmptyString2(rendererId)) {
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
function recordOf5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString3(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList4(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString3)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer4(value) {
  const record = recordOf5(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS5.has(key2)))
    return void 0;
  const gameIds = stringList4(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest4(value) {
  const record = recordOf5(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS4.has(key2))) {
    return void 0;
  }
  return nonEmptyString3(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
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
var GAME_LAUNCH_PLAN_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: GAME_LAUNCH_PLAN_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/game-launch-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/game-launch-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: GAME_INSTALLATION_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.game/launch-plan-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "plannerId", "gameIds"]),
    methods: Object.freeze({
      plan: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS6 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS5 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString4(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList5(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString4)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer5(value) {
  const record = recordOf6(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS6.has(key2))) {
    return void 0;
  }
  const gameIds = stringList5(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest5(value) {
  const record = recordOf6(value);
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
function recordOf7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString5(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList6(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString5)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer6(value) {
  const record = recordOf7(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS7.has(key2))) {
    return void 0;
  }
  const gameIds = stringList6(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest6(value) {
  const record = recordOf7(value);
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
var DEFAULT_RESOURCE_SESSION_LIMITS = Object.freeze({
  maxResources: 256,
  maxBytes: 256n * 1024n * 1024n,
  maxDepth: 8,
  maxEntries: 4096
});
var OFFER_KEYS8 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS7 = /* @__PURE__ */ new Set(["gameId"]);
var PREVIEW_OFFER_KEYS = /* @__PURE__ */ new Set(["subjectFormatIds"]);
var PREVIEW_REQUEST_KEYS = /* @__PURE__ */ new Set(["subjectFormatId"]);
function recordOf8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString6(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList7(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString6)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer7(value) {
  const record = recordOf8(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS8.has(key2))) {
    return void 0;
  }
  const gameIds = stringList7(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest7(value) {
  const record = recordOf8(value);
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
function parsePreviewOffer(value) {
  const record = recordOf8(value);
  if (record === void 0 || Object.keys(record).some((key2) => !PREVIEW_OFFER_KEYS.has(key2))) {
    return void 0;
  }
  const subjectFormatIds = stringList7(record["subjectFormatIds"]);
  return subjectFormatIds === void 0 ? void 0 : { subjectFormatIds };
}
function parsePreviewRequest(value) {
  const record = recordOf8(value);
  if (record === void 0 || Object.keys(record).some((key2) => !PREVIEW_REQUEST_KEYS.has(key2))) {
    return void 0;
  }
  return nonEmptyString6(record["subjectFormatId"]) ? { subjectFormatId: record["subjectFormatId"] } : void 0;
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
    list: { kind: "iterable", ...sig },
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
var DEFAULT_PROTOCOL_LIMITS = Object.freeze({
  maxDepth: 32,
  // Resolved game catalogs legitimately carry tens of thousands of definitions and field nodes
  // in one pinned snapshot. The byte, array, object-key, deadline and worker-memory ceilings still
  // bound the frame; this node ceiling prevents valid schemas from being rejected first.
  maxNodes: 4e6,
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
  for (const [key2, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 0) {
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
var MAX_ERROR_MESSAGE = 8 * 1024;
var SUBJECT_SERVICES = Object.freeze({ contract: "x3.app/subject-services", major: 1 });
var SUBJECT_EDITING = Object.freeze({ contract: "x3.app/subject-editing", major: 1 });
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
var SUBJECT_RPC_LIMITS = protocolLimits({ defaultCallDeadlineMs: 6e4 });
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
var DEFAULT_MAXIMUM_SEARCHABLE_CHARACTERS = 64 * 1024 * 1024;
var HARD_MAXIMUM_SEARCHABLE_CHARACTERS = 128 * 1024 * 1024;
var UINT64_MASK = (1n << 64n) - 1n;
var DEFAULT_CHUNK_BYTES = 64 * 1024;
function safeLength(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ModkitError({
      code: "x3.host/text-source-too-large",
      message: "text source exceeds the exact JavaScript indexing range"
    });
  }
  return Number(value);
}
async function readBounded(source, offset, length, chunkBytes, signal) {
  const total = safeLength(length);
  const result = new Uint8Array(total);
  let written = 0;
  while (written < total) {
    throwIfAborted(signal);
    const next = await source.read(
      offset + BigInt(written),
      Math.min(chunkBytes, total - written),
      signal
    );
    if (next.byteLength === 0) break;
    result.set(next, written);
    written += next.byteLength;
  }
  return written === total ? result : result.slice(0, written);
}
function cursor2(offset, line) {
  return `v1:${offset}:${line}`;
}
function parseCursor(value) {
  const match = /^v1:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(value);
  if (match === null) {
    throw new ModkitError({
      code: "x3.host/invalid-text-cursor",
      message: "text cursor is malformed or belongs to another implementation version"
    });
  }
  const line = Number(match[2]);
  if (!Number.isSafeInteger(line)) {
    throw new ModkitError({
      code: "x3.host/invalid-text-cursor",
      message: "text cursor line is outside the exact JavaScript range"
    });
  }
  return { offset: BigInt(match[1]), line };
}
function createUtf8TextDataSource(source, options = {}) {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new TypeError("text source chunkBytes must be a positive safe integer");
  }
  let indexPromise;
  const buildIndex = async (signal) => {
    const size = await source.size();
    const first = await source.read(0n, 3, signal);
    const bom = first[0] === 239 && first[1] === 187 && first[2] === 191;
    const lineStarts = [bom ? 3n : 0n];
    const newlineKinds = /* @__PURE__ */ new Set();
    let lineStart = lineStarts[0];
    let longest = 0n;
    let offset = 0n;
    let pendingCr;
    while (offset < size) {
      throwIfAborted(signal);
      const bytes = await source.read(
        offset,
        Math.min(chunkBytes, safeLength(size - offset)),
        signal
      );
      if (bytes.byteLength === 0) break;
      for (let index2 = 0; index2 < bytes.byteLength; index2 += 1) {
        const absolute = offset + BigInt(index2);
        const byte = bytes[index2];
        if (pendingCr !== void 0) {
          if (byte === 10) {
            newlineKinds.add("crlf");
            longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
            lineStart = absolute + 1n;
            lineStarts.push(lineStart);
            pendingCr = void 0;
            continue;
          }
          newlineKinds.add("cr");
          longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
          lineStart = pendingCr + 1n;
          lineStarts.push(lineStart);
          pendingCr = void 0;
        }
        if (byte === 13) pendingCr = absolute;
        else if (byte === 10) {
          newlineKinds.add("lf");
          longest = longest > absolute - lineStart ? longest : absolute - lineStart;
          lineStart = absolute + 1n;
          lineStarts.push(lineStart);
        }
      }
      offset += BigInt(bytes.byteLength);
    }
    if (pendingCr !== void 0) {
      newlineKinds.add("cr");
      longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
      lineStart = pendingCr + 1n;
      lineStarts.push(lineStart);
    }
    longest = longest > size - lineStart ? longest : size - lineStart;
    const kinds = [...newlineKinds];
    return Object.freeze({
      size,
      bom,
      lineStarts: Object.freeze(lineStarts),
      newline: kinds.length > 1 ? "mixed" : kinds[0] ?? "lf",
      longestLineBytes: longest > BigInt(Number.MAX_SAFE_INTEGER) ? "unknown" : Number(longest)
    });
  };
  const index = (signal) => {
    indexPromise ??= buildIndex(signal);
    return indexPromise;
  };
  const slice = async (request, signal) => {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new ModkitError({
        code: "x3.host/invalid-text-page",
        message: "text page maxBytes must be a positive safe integer"
      });
    }
    const facts = await index(signal);
    let fromLine;
    let start;
    let requestedEnd;
    if (request.kind === "from-line") {
      if (!Number.isSafeInteger(request.line) || request.line < 0 || !Number.isSafeInteger(request.lineCount) || request.lineCount <= 0) {
        throw new ModkitError({
          code: "x3.host/invalid-text-page",
          message: "text line and lineCount must be safe non-negative page coordinates"
        });
      }
      fromLine = request.line;
      start = facts.lineStarts[fromLine] ?? facts.size;
      requestedEnd = facts.lineStarts[fromLine + request.lineCount] ?? facts.size;
    } else {
      const parsed = parseCursor(request.cursor);
      fromLine = parsed.line;
      start = parsed.offset;
      requestedEnd = facts.size;
    }
    if (start > facts.size) {
      throw new ModkitError({
        code: "x3.host/invalid-text-cursor",
        message: "text cursor points beyond the current source revision"
      });
    }
    const pageEnd = start + BigInt(request.maxBytes);
    const end = [facts.size, requestedEnd, pageEnd].reduce(
      (left, right) => left < right ? left : right
    );
    const bytes = await readBounded(source, start, end - start, chunkBytes, signal);
    throwIfAborted(signal);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const actualEnd = start + BigInt(bytes.byteLength);
    let nextLine = fromLine;
    while (nextLine + 1 < facts.lineStarts.length && facts.lineStarts[nextLine + 1] <= actualEnd) {
      nextLine += 1;
    }
    const complete = actualEnd >= facts.size;
    return complete ? { complete: true, text, fromLine, lineCount: nextLine - fromLine + (text === "" ? 0 : 1) } : {
      complete: false,
      text,
      fromLine,
      lineCount: nextLine - fromLine + (text === "" ? 0 : 1),
      nextCursor: cursor2(actualEnd, nextLine)
    };
  };
  return Object.freeze({
    async info() {
      const facts = await index();
      return {
        bytes: facts.size,
        encoding: "utf-8",
        bom: facts.bom,
        newline: facts.newline,
        lines: facts.lineStarts.length,
        longestLineBytes: facts.longestLineBytes
      };
    },
    slice,
    async *search(query, signal) {
      const facts = await index(signal);
      const flags = query.caseSensitive ? "gu" : "giu";
      const expression = query.regex ? new RegExp(query.pattern, flags) : new RegExp(query.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      for (let line = 0; line < facts.lineStarts.length; line += 1) {
        throwIfAborted(signal);
        const start = facts.lineStarts[line];
        const end = facts.lineStarts[line + 1] ?? facts.size;
        const bytes = await readBounded(source, start, end - start, chunkBytes, signal);
        const text = new TextDecoder().decode(bytes);
        for (const match of text.matchAll(expression)) {
          const prefixBytes = new TextEncoder().encode(text.slice(0, match.index)).byteLength;
          const matchBytes = new TextEncoder().encode(match[0]).byteLength;
          yield Object.freeze({
            byteOffset: uint64(start + BigInt(prefixBytes)),
            byteLength: uint64(BigInt(matchBytes))
          });
          if (match[0] === "") expression.lastIndex += 1;
        }
      }
    }
  });
}
var COMMON_PRESENTATION_CATALOG = Object.freeze([
  Object.freeze({
    slot: Object.freeze({
      slotId: "code",
      kind: "stage",
      contributionId: "org.modkitx.ui-monaco/code-stage",
      extensionId: "org.modkitx/ui-monaco",
      priority: 400,
      singletonGroup: "stage.code",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "code-content",
          contract: "common.view/text-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "content.text", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/text-data-source", major: 1 }],
      applicability: { interpretation: "any", sourceBytes: { maximum: "8388608" } },
      priority: 400,
      singletonGroup: "stage.code"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "video",
      kind: "stage",
      contributionId: "org.modkitx.ui/video-stage",
      extensionId: "org.modkitx/ui",
      priority: 370,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "video-content",
          contract: "common.view/video-media-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "video.streams", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/video-media-source", major: 1 }],
      priority: 370,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "image",
      kind: "stage",
      contributionId: "org.modkitx.ui/image-stage",
      extensionId: "org.modkitx/ui",
      priority: 360,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "image-content",
          contract: "common.view/raster-image-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "image.raster", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/raster-image-source", major: 1 }],
      priority: 360,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "audio",
      kind: "stage",
      contributionId: "org.modkitx.ui/audio-stage",
      extensionId: "org.modkitx/ui",
      priority: 360,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "audio-content",
          contract: "common.view/audio-media-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "audio.streams", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/audio-media-source", major: 1 }],
      priority: 360,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "world",
      kind: "stage",
      contributionId: "org.modkitx.ui/world-stage",
      extensionId: "org.modkitx/ui",
      priority: 380,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "world-content",
          contract: "common.view/world-scene-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/world-scene-source", major: 1 }],
      priority: 380,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "model",
      kind: "stage",
      contributionId: "org.modkitx.ui/model-stage",
      extensionId: "org.modkitx/ui",
      priority: 350,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "model-content",
          contract: "common.view/model-scene-source",
          major: 1
        })
      ])
    }),
    optionalBindings: Object.freeze([
      Object.freeze({
        bindingId: "model-optional-1",
        contract: "common.view/model-resource-refs-source",
        major: 1
      }),
      Object.freeze({
        bindingId: "model-optional-2",
        contract: "common.view/model-skeleton-source",
        major: 1
      }),
      Object.freeze({
        bindingId: "model-optional-3",
        contract: "common.view/model-animation-source",
        major: 1
      }),
      Object.freeze({
        bindingId: "model-optional-4",
        contract: "common.view/model-collision-source",
        major: 1
      }),
      Object.freeze({
        bindingId: "model-optional-5",
        contract: "common.view/model-material-source",
        major: 1
      })
    ]),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "model.geometry", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/model-scene-source", major: 1 }],
      optionalDataSources: [
        { contract: "common.view/model-resource-refs-source", major: 1 },
        { contract: "common.view/model-skeleton-source", major: 1 },
        { contract: "common.view/model-animation-source", major: 1 },
        { contract: "common.view/model-collision-source", major: 1 },
        { contract: "common.view/model-material-source", major: 1 }
      ],
      priority: 350,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "vector",
      kind: "stage",
      contributionId: "org.modkitx.ui/vector-stage",
      extensionId: "org.modkitx/ui",
      priority: 350,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "vector-content",
          contract: "common.view/vector-scene-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "vector.scene", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/vector-scene-source", major: 1 }],
      priority: 350,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "table",
      kind: "stage",
      contributionId: "org.modkitx.ui/table-stage",
      extensionId: "org.modkitx/ui",
      priority: 320,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "table-content",
          contract: "common.view/table-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "table.cells", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/table-data-source", major: 1 }],
      priority: 320,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "card",
      kind: "stage",
      contributionId: "org.modkitx.ui/subject-card-stage",
      extensionId: "org.modkitx/ui",
      priority: 390,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "card-content",
          contract: "common.view/subject-facts-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/subject-facts-source", major: 1 }],
      priority: 390,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "calculations",
      kind: "stage",
      contributionId: "org.modkitx.ui/subject-calculations-stage",
      extensionId: "org.modkitx/ui",
      priority: 380,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "calculations-content",
          contract: "common.view/subject-calculations-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/subject-calculations-source", major: 1 }],
      priority: 380,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "relations",
      kind: "stage",
      contributionId: "org.modkitx.ui/relation-graph-stage",
      extensionId: "org.modkitx/ui",
      priority: 370,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "relations-content",
          contract: "common.view/relation-graph-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/relation-graph-source", major: 1 }],
      priority: 370,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "template",
      kind: "stage",
      contributionId: "org.modkitx.ui/game-template-stage",
      extensionId: "org.modkitx/ui",
      priority: 365,
      singletonGroup: "center-stage",
      bindings: Object.freeze([])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresOperations: ["view.template"],
      consumesDataSources: [],
      priority: 365,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "tree",
      kind: "stage",
      contributionId: "org.modkitx.ui/tree-stage",
      extensionId: "org.modkitx/ui",
      priority: 300,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "tree-content",
          contract: "common.view/tree-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "structure.hierarchy", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/tree-data-source", major: 1 }],
      priority: 300,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "text",
      kind: "stage",
      contributionId: "org.modkitx.ui/bounded-text-stage",
      extensionId: "org.modkitx/ui",
      priority: 220,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "text-content",
          contract: "common.view/text-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "content.text", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/text-data-source", major: 1 }],
      applicability: {
        interpretation: "any",
        sourceBytes: { maximum: "16777216" },
        longestLineBytes: { maximum: 1048576, whenUnknown: "ineligible" }
      },
      priority: 220,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "virtual-text",
      kind: "stage",
      contributionId: "org.modkitx.ui/virtual-text-stage",
      extensionId: "org.modkitx/ui",
      priority: 120,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "virtual-text-content",
          contract: "common.view/text-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "content.text", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/text-data-source", major: 1 }],
      applicability: { interpretation: "any" },
      priority: 120,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "hex",
      kind: "stage",
      contributionId: "org.modkitx.ui/hex-stage",
      extensionId: "org.modkitx/ui",
      priority: 40,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "hex-content",
          contract: "common.view/byte-range-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/byte-range-source", major: 1 }],
      priority: 40,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "archive",
      kind: "stage",
      contributionId: "org.modkitx.ui/archive-stage",
      extensionId: "org.modkitx/ui",
      priority: 340,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "archive-content",
          contract: "common.view/namespace-entry-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/namespace-entry-source", major: 1 }],
      priority: 340,
      singletonGroup: "center-stage"
    })
  })
]);

export {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource
};
