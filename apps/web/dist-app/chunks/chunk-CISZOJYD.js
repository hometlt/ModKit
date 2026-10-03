import {
  ARCHITECTURES,
  OPERATING_SYSTEMS,
  RUNTIME_ENVIRONMENTS,
  STANDARD_DATA_SOURCE_CONTRACTS,
  codecContributionSpecV1Schema,
  contractDefinitionSpecV1Schema,
  contributionId,
  contributionManifestSchema,
  editorContributionSpecV1Schema,
  extensionManifestSchema,
  fieldEditorContributionSpecV1Schema,
  isStandardTraitId,
  knowledgePackSpecV1Schema,
  knowledgeTargetKey,
  localizationContributionSpecV1Schema,
  modkitBlockSchema,
  revisionIdFromRef,
  serviceProviderContributionSpecV1Schema,
  snapshotJsonWireData,
  snapshotJsonWireObject,
  subjectKindDefinitionSpecV1Schema,
  traitDefinitionSpecV1Schema,
  validateWithSchema,
  viewerContributionSpecV1Schema
} from "./chunk-U33RYHWC.js";
import {
  ModkitError,
  OPERATION_DOMAINS,
  SHARED_OPERATION_IDS,
  canonicalJsonStringify,
  compareUtf8,
  contractId,
  deepFreeze,
  diagnostic,
  hasErrors,
  isQualifiedId,
  isSegment,
  isUInt64String,
  parseSemver,
  parseVersionRange,
  uniqueSortedUtf8,
  versionRangeTargetsMajor
} from "./chunk-AMCLMQ4O.js";

// ../../MODDING/modkit-core/packages/sdk/dist/identity.js
var QUALIFIED_RULES = [
  ["org.modkitx/starcraft-2", "blizzard/starcraft-2", true],
  ["org.modkitx/warzone-2100", "wz2100project/warzone-2100", true],
  ["org.modkitx.opensource/warzone-2100", "wz2100project/warzone-2100", true],
  ["org.modkitx.opensource/spring", "spring/recoil", true],
  ["org.modkitx.blizzard/", "blizzard/"],
  ["org.modkitx.ea/", "ea/"],
  ["org.modkitx/", "modkit/"],
  ["org.modkitx.", "modkit."],
  ["org.modkitx", "modkit", true]
];
var SOURCE_RULES = [
  ["org.modkitx.blizzard", "blizzard", true],
  ["org.modkitx.ea", "ea", true],
  ["org.modkitx.opensource", "opensource", true],
  ["org.modkitx", "modkit", true]
];
var PACKAGE_RULES = [
  ["@modkitx-x3/", "@modkit/"],
  ["@modkitx/", "@modkit/"]
];
function normalizeByRules(value2, rules) {
  for (const [from, to, exact] of rules) {
    const next = exact === true ? value2 === from ? to : void 0 : value2.startsWith(from) ? `${to}${value2.slice(from.length)}` : void 0;
    if (next !== void 0)
      return Object.freeze({ value: next, changed: next !== value2 });
  }
  return Object.freeze({ value: value2, changed: false });
}
function normalizeModkitIdentifier(value2) {
  return normalizeByRules(value2, QUALIFIED_RULES).value;
}
function normalizeModkitPackageSpecifier(value2) {
  return normalizeByRules(value2, PACKAGE_RULES).value;
}
function normalizeModkitSourceIdentifier(value2) {
  return normalizeByRules(value2, SOURCE_RULES).value;
}

// ../../MODDING/modkit-core/packages/sdk/dist/editing.js
var WRITER_CONTRACT_ID = "common.edit/writer";
var WRITER_FACET_MATCHER_PROFILE = "modkit/writer-facet-matcher";
var writerSurface = {
  fields: ["identity", "offer"],
  methods: {
    validate: { kind: "value", signal: "last", arity: 1 },
    plan: { kind: "value", signal: "last", arity: 1 }
  }
};
var WRITER_SURFACE = deepFreeze(writerSurface);
var STANDARD_EDITING_SURFACES = deepFreeze({ [WRITER_CONTRACT_ID]: WRITER_SURFACE });
var ROUND_TRIP_RANK = Object.freeze({
  "byte-identical": 3,
  semantic: 2,
  lossy: 1,
  none: 0
});
function writerOfferSatisfies(request, offer) {
  return request.formatId === offer.formatId && request.representationId === offer.representationId && (request.mutationMode === "export-only" || offer.mutationMode === "mutate") && ROUND_TRIP_RANK[offer.minimumRoundTrip] >= ROUND_TRIP_RANK[request.minimumRoundTrip];
}
function writerSelectionKey(request) {
  return `writer:${request.formatId}:${request.representationId}:${request.mutationMode}:${request.minimumRoundTrip}`;
}
function containerEntryRevision(containerRevision, entryId, byteLength) {
  return revisionIdFromRef({
    kind: "provider-token",
    value: `${String(containerRevision)}!${entryId}:${byteLength}`
  });
}
function namespaceEntryEditTarget(input) {
  const url = new URL(input.root.uri);
  url.search = "";
  url.hash = "";
  url.searchParams.set("vfs-path", input.entry.path);
  const source = { id: url.href, uri: url.href, parentIds: [input.root.id] };
  const revision = containerEntryRevision(input.namespaceRevision, input.entry.path, input.entry.size);
  return deepFreeze({
    targetId: source.id,
    subjectUri: source.uri,
    ownerSource: source,
    semanticPath: [],
    expectedRevision: {
      bindings: { [source.id]: revision },
      namespaceRevision: input.namespaceRevision,
      compositionFingerprint: canonicalJsonStringify({
        topology: "single",
        bindingId: source.id,
        source: { id: source.id, uri: source.uri },
        revision
      })
    }
  });
}

// ../../MODDING/modkit-core/packages/sdk/dist/subjects/candidates.js
var nonEmptyStrings = (value2) => value2 === void 0 || value2.every((item) => typeof item === "string" && item.length > 0) && new Set(value2).size === value2.length;
function validCandidate(candidate) {
  return typeof candidate === "object" && candidate !== null && typeof candidate.subjectId === "string" && candidate.subjectId.length > 0 && typeof candidate.label === "string" && candidate.label.length > 0 && typeof candidate.kind === "string" && candidate.kind.length > 0 && (candidate.type === void 0 || typeof candidate.type === "string" && candidate.type.length > 0) && nonEmptyStrings(candidate.tags) && (candidate.portrait === void 0 || typeof candidate.portrait === "string" && candidate.portrait.length > 0) && (candidate.asset === void 0 || typeof candidate.asset === "object" && candidate.asset !== null && typeof candidate.asset.formatId === "string" && candidate.asset.formatId.length > 0 && nonEmptyStrings(candidate.asset.traits));
}
function validSummary(summary) {
  return typeof summary === "object" && summary !== null && typeof summary.snapshotId === "string" && summary.snapshotId.length > 0 && Number.isSafeInteger(summary.totalSubjects) && summary.totalSubjects >= 0 && (summary.completeness === "complete" || summary.completeness === "partial" || summary.completeness === "capped") && (summary.reason === void 0 || typeof summary.reason === "string") && (summary.kinds === void 0 || Array.isArray(summary.kinds) && summary.kinds.every((item) => typeof item?.kind === "string" && item.kind.length > 0 && Number.isSafeInteger(item.count) && item.count >= 0));
}
function validateQuery(query) {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1) {
    throw new RangeError("subject candidate limit must be a positive safe integer");
  }
  if (query.text !== void 0 && typeof query.text !== "string") {
    throw new TypeError("subject candidate text must be a string");
  }
  if (query.cursor !== void 0 && (typeof query.cursor !== "string" || query.cursor.length === 0)) {
    throw new TypeError("subject candidate cursor must be a non-empty string");
  }
  if (query.target.kind === "subject-ref" && (typeof query.target.subjectKind !== "string" || query.target.subjectKind.length === 0)) {
    throw new TypeError("subject candidate kind must be a non-empty string");
  }
  if (query.target.kind === "asset-ref" && (!nonEmptyStrings(query.target.accepts.formatIds) || !nonEmptyStrings(query.target.accepts.traits))) {
    throw new TypeError("asset candidate constraints must contain unique non-empty strings");
  }
}
async function loadSubjectCandidatePage(provider, query, signal) {
  signal?.throwIfAborted();
  validateQuery(query);
  const [summary, page] = await Promise.all([
    provider.summary(signal),
    provider.candidates(query, signal)
  ]);
  signal?.throwIfAborted();
  if (!validSummary(summary))
    throw new TypeError("subject candidate summary is malformed");
  if (typeof page !== "object" || page === null || !Array.isArray(page.items) || page.items.length > query.limit || !page.items.every(validCandidate) || new Set(page.items.map((item) => item.subjectId)).size !== page.items.length || page.nextCursor !== void 0 && (typeof page.nextCursor !== "string" || page.nextCursor.length === 0)) {
    throw new TypeError("subject candidate page is malformed or exceeds its requested limit");
  }
  return Object.freeze({ summary, page });
}
function createSubjectCandidateProvider(source) {
  return Object.freeze({
    summary: (signal) => source.summary(signal),
    candidates(query, signal) {
      const page = {
        ...query.cursor === void 0 ? {} : { cursor: query.cursor },
        limit: query.limit,
        ...query.text === void 0 ? {} : { text: query.text },
        ...query.target.kind === "subject-ref" ? {
          kind: query.target.subjectKind,
          ...query.target.filter === void 0 ? {} : { filter: query.target.filter }
        } : { asset: query.target.accepts }
      };
      return source.subjects(page, signal);
    }
  });
}

// ../../MODDING/modkit-core/packages/sdk/dist/manifest/operation-permissions.js
function operationScopedPermissionClasses(operations) {
  const out = /* @__PURE__ */ new Set();
  for (const operation of operations ?? []) {
    for (const item of operation.requiredPermissions ?? [])
      out.add(item);
    if (operation.mutatesSource === true)
      out.add("write-source");
  }
  out.delete("read-source");
  return out;
}
function activationRequiredPermissionClasses(requested, operations) {
  const scoped = operationScopedPermissionClasses(operations);
  return Object.freeze(requested.filter((item) => !scoped.has(item)));
}

// ../../MODDING/modkit-core/packages/sdk/dist/host-facilities.generated.js
var STANDARD_HOST_FACILITY_IDS = Object.freeze([
  "clipboard.write",
  "credential.broker",
  "dialog.file-picker",
  "directory.watch",
  "editor.host-native",
  "extension.catalog.read",
  "extension.install.mutate",
  "extension.install.plan",
  "filesystem.atomic-replace",
  "filesystem.read-random",
  "gpu.webgl2",
  "gpu.webgpu",
  "native-process.rpc",
  "native.load",
  "network.range-fetch",
  "notification.system",
  "process.launch",
  "product.inventory.native-bridge",
  "product.inventory.read",
  "storage.durable-handles",
  "storage.opfs",
  "storage.quota",
  "update.service-worker",
  "wasm.simd",
  "wasm.threads",
  "window.custom-chrome",
  "worker.module",
  "worker.shared"
]);
var LEGACY_HOST_FACILITY_ALIASES = Object.freeze([
  "editor.monaco"
]);

// ../../MODDING/modkit-core/packages/sdk/dist/host-profile.js
var HOST_TRANSPORT_KINDS = Object.freeze([
  "in-process",
  "structured-clone",
  "rpc-handle",
  "stream",
  "transferable-buffer",
  "shared-memory-view",
  "native-process-rpc"
]);
var standardFacilities = new Set(STANDARD_HOST_FACILITY_IDS);
var legacyFacilities = new Set(LEGACY_HOST_FACILITY_ALIASES);
var transportKinds = new Set(HOST_TRANSPORT_KINDS);
function isStandardHostFacilityId(value2) {
  return standardFacilities.has(value2);
}
function isHostFacilityId(value2) {
  return isStandardHostFacilityId(value2) || legacyFacilities.has(value2) || isQualifiedId(value2);
}
function hostFacilityId(value2) {
  if (!isHostFacilityId(value2)) {
    throw new ModkitError({
      code: "x3.sdk/unknown-host-facility",
      message: `unknown unqualified host facility \xAB${value2}\xBB`,
      context: {
        facility: value2,
        expected: "standard facility ID or extension-owned qualified publisher/name ID"
      }
    });
  }
  return value2;
}
function hostFacilityDiagnostics(values, path = []) {
  if (values === void 0)
    return [];
  const diagnostics = [];
  values.forEach((value2, index) => {
    if (!isHostFacilityId(value2)) {
      diagnostics.push(diagnostic("error", "x3.sdk/unknown-host-facility", `unknown unqualified host facility \xAB${value2}\xBB`, [...path, index], { facility: value2 }));
    } else if (legacyFacilities.has(value2)) {
      diagnostics.push(diagnostic("warning", "x3.sdk/legacy-host-facility", `host facility \xAB${value2}\xBB is a transitional compatibility alias`, [...path, index], { facility: value2 }));
    }
  });
  return diagnostics;
}
function invalidProfile(message, context) {
  throw new ModkitError({
    code: "x3.sdk/invalid-host-profile",
    message,
    ...context === void 0 ? {} : { context }
  });
}
function exactKeys(value2, allowed, field) {
  const extra = Object.keys(value2).filter((key2) => !allowed.includes(key2));
  if (extra.length > 0)
    invalidProfile(`${field} contains unsupported fields`, { field, extra });
}
function nonEmpty(value2, field) {
  if (value2.trim().length === 0)
    return invalidProfile(`${field} must not be empty`, { field });
  return value2;
}
function count(value2, field) {
  if (!Number.isSafeInteger(value2) || value2 < 0) {
    return invalidProfile(`${field} must be a non-negative safe integer`, { field, value: value2 });
  }
  return value2;
}
function bytes(value2, field) {
  if (!isUInt64String(value2))
    return invalidProfile(`${field} must be an unsigned 64-bit string`, { field });
  return value2;
}
function normalizeStrings(values) {
  return Object.freeze(uniqueSortedUtf8(values.map((value2) => nonEmpty(value2, "target list value"))));
}
function createHostRealmProfile(profile) {
  const snapshot = snapshotJsonWireData(profile);
  exactKeys(snapshot, ["schemaVersion", "realmId", "revision", "target", "facilities", "budgets", "policy"], "profile");
  if (snapshot.schemaVersion !== 1)
    invalidProfile("host profile schemaVersion must be 1");
  exactKeys(snapshot.target, [
    "environment",
    "operatingSystem",
    "architecture",
    "webApis",
    "externalTools",
    "hostCapabilities",
    "grantedPermissions"
  ], "target");
  exactKeys(snapshot.budgets, [
    "maxConcurrentTasks",
    "maxWorkerCount",
    "maxResidentBytes",
    "maxTransferBytes",
    "defaultDeadlineMs"
  ], "budgets");
  exactKeys(snapshot.policy, ["id", "revision", "digest"], "policy");
  const rawTarget = snapshot.target;
  if ("hostCapabilities" in rawTarget || "grantedPermissions" in rawTarget) {
    return invalidProfile("target.hostCapabilities and target.grantedPermissions are projections and cannot be authored in a host profile");
  }
  if (!RUNTIME_ENVIRONMENTS.includes(rawTarget.environment)) {
    invalidProfile("target.environment is not registered", { environment: rawTarget.environment });
  }
  const operatingSystem = rawTarget.operatingSystem;
  if (operatingSystem === "any" || !OPERATING_SYSTEMS.includes(operatingSystem)) {
    invalidProfile("target.operatingSystem must be concrete", {
      operatingSystem: rawTarget.operatingSystem
    });
  }
  const architecture = rawTarget.architecture;
  if (architecture === "any" || !ARCHITECTURES.includes(architecture)) {
    invalidProfile("target.architecture must be concrete", { architecture: rawTarget.architecture });
  }
  const facilities = uniqueSortedUtf8(snapshot.facilities.map((value2) => hostFacilityId(value2)));
  const target = Object.freeze({
    environment: rawTarget.environment,
    operatingSystem: rawTarget.operatingSystem,
    architecture: rawTarget.architecture,
    ...rawTarget.webApis === void 0 ? {} : { webApis: normalizeStrings(rawTarget.webApis) },
    ...rawTarget.externalTools === void 0 ? {} : { externalTools: normalizeStrings(rawTarget.externalTools) }
  });
  const budgets = Object.freeze({
    maxConcurrentTasks: count(snapshot.budgets.maxConcurrentTasks, "budgets.maxConcurrentTasks"),
    maxWorkerCount: count(snapshot.budgets.maxWorkerCount, "budgets.maxWorkerCount"),
    maxResidentBytes: bytes(snapshot.budgets.maxResidentBytes, "budgets.maxResidentBytes"),
    maxTransferBytes: bytes(snapshot.budgets.maxTransferBytes, "budgets.maxTransferBytes"),
    defaultDeadlineMs: count(snapshot.budgets.defaultDeadlineMs, "budgets.defaultDeadlineMs")
  });
  const policy2 = Object.freeze({
    id: nonEmpty(snapshot.policy.id, "policy.id"),
    revision: nonEmpty(snapshot.policy.revision, "policy.revision"),
    ...snapshot.policy.digest === void 0 ? {} : { digest: nonEmpty(snapshot.policy.digest, "policy.digest") }
  });
  return Object.freeze({
    schemaVersion: 1,
    realmId: nonEmpty(snapshot.realmId, "realmId"),
    revision: nonEmpty(snapshot.revision, "revision"),
    target,
    facilities: Object.freeze(facilities),
    budgets,
    policy: policy2
  });
}
function createHostTopology(topology) {
  const snapshot = snapshotJsonWireData(topology);
  exactKeys(snapshot, ["schemaVersion", "topologyId", "realms", "links"], "topology");
  if (snapshot.schemaVersion !== 1)
    return invalidProfile("host topology schemaVersion must be 1");
  const realms = snapshot.realms.map(createHostRealmProfile);
  realms.sort((left, right) => compareUtf8(left.realmId, right.realmId));
  const realmIds = /* @__PURE__ */ new Set();
  for (const realm of realms) {
    if (realmIds.has(realm.realmId))
      return invalidProfile(`duplicate realmId \xAB${realm.realmId}\xBB`);
    realmIds.add(realm.realmId);
  }
  const links = snapshot.links.map((link) => {
    exactKeys(link, ["fromRealm", "toRealm", "transports"], "transport link");
    if (!realmIds.has(link.fromRealm) || !realmIds.has(link.toRealm)) {
      return invalidProfile("transport link references an unknown realm", {
        fromRealm: link.fromRealm,
        toRealm: link.toRealm
      });
    }
    if (link.fromRealm === link.toRealm)
      return invalidProfile("transport link must cross realms");
    const transports = uniqueSortedUtf8(link.transports);
    if (transports.length === 0 || transports.some((value2) => !transportKinds.has(value2))) {
      return invalidProfile("transport link must declare known transport kinds");
    }
    return Object.freeze({
      fromRealm: link.fromRealm,
      toRealm: link.toRealm,
      transports: Object.freeze(transports)
    });
  });
  links.sort((left, right) => compareUtf8(`${left.fromRealm}\0${left.toRealm}`, `${right.fromRealm}\0${right.toRealm}`));
  const seenLinks = /* @__PURE__ */ new Set();
  for (const link of links) {
    const key2 = `${link.fromRealm}\0${link.toRealm}`;
    if (seenLinks.has(key2))
      return invalidProfile("duplicate directed transport link", { key: key2 });
    seenLinks.add(key2);
  }
  return Object.freeze({
    schemaVersion: 1,
    topologyId: nonEmpty(snapshot.topologyId, "topologyId"),
    realms: Object.freeze(realms),
    links: Object.freeze(links)
  });
}
function runtimeTargetForHostRealm(profile, grantedPermissions) {
  const normalized = createHostRealmProfile(profile);
  return Object.freeze({
    ...normalized.target,
    hostCapabilities: normalized.facilities,
    ...grantedPermissions === void 0 ? {} : { grantedPermissions: Object.freeze([...grantedPermissions]) }
  });
}
function hostRealmCacheKey(profile) {
  return canonicalJsonStringify(createHostRealmProfile(profile));
}

// ../../MODDING/modkit-core/packages/sdk/dist/manifest/spec-registry.js
function invalidRegistration(message, context) {
  throw new ModkitError({
    code: "x3.sdk/invalid-spec-registration",
    message,
    context
  });
}
function safeContextValue(value2) {
  if (value2 === null || typeof value2 === "string" || typeof value2 === "boolean")
    return value2;
  if (typeof value2 === "number")
    return Number.isFinite(value2) ? value2 : String(value2);
  return typeof value2;
}
function validatedCoordinate(contractValue, majorValue) {
  if (typeof contractValue !== "string" || !isQualifiedId(contractValue)) {
    return invalidRegistration("spec registration contract must be a qualified id", {
      contract: typeof contractValue === "string" ? contractValue : typeof contractValue
    });
  }
  if (!Number.isSafeInteger(majorValue) || majorValue < 0) {
    return invalidRegistration("spec registration major must be a safe non-negative integer", {
      contract: contractValue,
      major: safeContextValue(majorValue)
    });
  }
  return Object.freeze({ contract: contractId(contractValue), major: majorValue });
}
function validatedConformanceProfile(value2, contract, major) {
  if (typeof value2 !== "string" || value2.trim().length === 0) {
    return invalidRegistration("spec registration conformance profile must be non-blank", {
      contract,
      major,
      conformanceProfile: typeof value2 === "string" ? value2 : typeof value2
    });
  }
  return value2;
}
function validatedModuleAbi(value2, contract, major) {
  if (typeof value2 !== "object" || value2 === null || Array.isArray(value2)) {
    return invalidRegistration("executable spec registration requires a module ABI object", {
      contract,
      major
    });
  }
  const candidate = value2;
  const exportName = candidate.export;
  const abiVersion = candidate.abiVersion;
  if (typeof exportName !== "string" || exportName.trim().length === 0) {
    return invalidRegistration("module ABI export must be a non-blank string", {
      contract,
      major,
      export: typeof exportName === "string" ? exportName : typeof exportName
    });
  }
  if (!Number.isSafeInteger(abiVersion) || abiVersion < 0) {
    return invalidRegistration("module ABI version must be a safe non-negative integer", {
      contract,
      major,
      abiVersion: safeContextValue(abiVersion)
    });
  }
  return Object.freeze({ export: exportName, abiVersion });
}
function createSpecSchemaRegistry(entries) {
  const map = /* @__PURE__ */ new Map();
  for (const authoredEntry of entries) {
    if (typeof authoredEntry !== "object" || authoredEntry === null || Array.isArray(authoredEntry)) {
      invalidRegistration("spec schema registration must be an object", {});
    }
    const coordinate = validatedCoordinate(authoredEntry.contract, authoredEntry.major);
    const schema = authoredEntry.schema;
    const validator = authoredEntry.validator;
    const validateSemantics = authoredEntry.validateSemantics;
    const authoredRegistration = authoredEntry.registration;
    let registration;
    if (authoredRegistration !== void 0) {
      if (typeof authoredRegistration !== "object" || authoredRegistration === null || Array.isArray(authoredRegistration)) {
        invalidRegistration("spec inventory registration must be an object", coordinate);
      }
      const candidate = authoredRegistration;
      const mode = candidate.mode;
      const project = candidate.project;
      const conformanceProfileValue = candidate.conformanceProfile;
      if (mode !== "data-only" && mode !== "executable") {
        invalidRegistration("spec inventory registration mode is invalid", {
          ...coordinate,
          mode: safeContextValue(mode)
        });
      }
      if (typeof project !== "function") {
        invalidRegistration("spec inventory projector must be a function", coordinate);
      }
      const conformanceProfile = validatedConformanceProfile(conformanceProfileValue, coordinate.contract, coordinate.major);
      registration = mode === "executable" ? Object.freeze({
        mode: "executable",
        project,
        conformanceProfile,
        moduleAbi: validatedModuleAbi(candidate.moduleAbi, coordinate.contract, coordinate.major)
      }) : Object.freeze({
        mode: "data-only",
        project,
        conformanceProfile
      });
    }
    const entry = Object.freeze({
      contract: coordinate.contract,
      major: coordinate.major,
      schema: snapshotJsonWireObject(schema),
      ...validator === void 0 ? {} : typeof validator === "function" ? { validator } : invalidRegistration("precompiled schema validator must be a function", coordinate),
      ...validateSemantics === void 0 ? {} : typeof validateSemantics === "function" ? { validateSemantics } : invalidRegistration("spec semantic validator must be a function", coordinate),
      ...registration === void 0 ? {} : { registration }
    });
    const key2 = `${entry.contract}@${entry.major}`;
    if (map.has(key2)) {
      throw new ModkitError({
        code: "x3.sdk/duplicate-spec-schema",
        message: `duplicate spec schema registration: ${key2}`,
        context: { contract: entry.contract, major: entry.major }
      });
    }
    map.set(key2, entry);
  }
  const list = Object.freeze([...map.values()].sort((left, right) => compareUtf8(left.contract, right.contract) || left.major - right.major));
  return {
    getEntry: (contract, major) => map.get(`${contract}@${major}`),
    get: (contract, major) => map.get(`${contract}@${major}`)?.schema,
    list: () => list
  };
}
function duplicateVariantDiagnostics(manifest) {
  const first = /* @__PURE__ */ new Map();
  const diagnostics = [];
  (manifest.runtimeVariants ?? []).forEach((variant, index) => {
    const previous = first.get(variant.variantId);
    if (previous === void 0)
      first.set(variant.variantId, index);
    else {
      diagnostics.push(diagnostic("error", "x3.sdk/duplicate-runtime-variant", `runtime variant ${variant.variantId} duplicates index ${previous}`, ["runtimeVariants", index, "variantId"]));
    }
  });
  return diagnostics;
}
function envelopeRangeDiagnostics(manifest) {
  const diagnostics = [];
  manifest.dependsOn?.forEach((requirement, index) => {
    const parsed = requirement.range === void 0 ? void 0 : parseVersionRange(requirement.range);
    if (requirement.range !== void 0 && (parsed === void 0 || !versionRangeTargetsMajor(parsed, requirement.major))) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-contract-range", `contract range ${requirement.range} cannot be evaluated safely`, ["dependsOn", index, "range"]));
    }
  });
  return diagnostics;
}
function runtimeFacilityDiagnostics(manifest) {
  return (manifest.runtimeVariants ?? []).flatMap((variant, index) => hostFacilityDiagnostics(variant.target.requiredHostCapabilities, [
    "runtimeVariants",
    index,
    "target",
    "requiredHostCapabilities"
  ]));
}
async function runSemanticValidator(validator, manifest) {
  if (validator === void 0)
    return [];
  try {
    const result = await validator(manifest);
    if (!Array.isArray(result) || !result.every((item) => typeof item === "object" && item !== null && !Array.isArray(item) && typeof item.code === "string" && isQualifiedId(item.code) && ["error", "warning", "information", "hint"].includes(String(item.severity)) && typeof item.message === "string" && (item.path === void 0 || Array.isArray(item.path) && item.path.every((part) => typeof part === "string" || Number.isSafeInteger(part))))) {
      throw new TypeError("semantic validator returned malformed diagnostics");
    }
    return [...result];
  } catch (error) {
    return [
      diagnostic("error", "x3.sdk/semantic-validator-failed", "the host-owned contribution semantic validator threw", ["spec"], { error: error instanceof Error ? error.message : String(error) })
    ];
  }
}
function normalizeContributionManifest(wire) {
  const { contract, dependsOn, id, ...rest } = wire;
  return Object.freeze({
    ...rest,
    id: contributionId(normalizeModkitIdentifier(id)),
    contract: Object.freeze({
      ...contract,
      id: contractId(normalizeModkitIdentifier(contract.id))
    }),
    ...dependsOn === void 0 ? {} : {
      dependsOn: Object.freeze(dependsOn.map((requirement) => Object.freeze({
        ...requirement,
        contract: contractId(normalizeModkitIdentifier(requirement.contract))
      })))
    }
  });
}
async function validateContributionManifest(value2, registry) {
  let candidate;
  try {
    candidate = snapshotJsonWireData(value2);
  } catch (error) {
    return {
      specState: "invalid",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        diagnostic("error", "x3.sdk/non-json-wire-value", "contribution manifest must be inert JSON data", [], { error: error instanceof Error ? error.message : String(error) })
      ]
    };
  }
  const envelopeDiagnostics = await validateWithSchema(contributionManifestSchema, candidate);
  if (hasErrors(envelopeDiagnostics)) {
    return {
      specState: "invalid",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: envelopeDiagnostics
    };
  }
  const manifest = normalizeContributionManifest(candidate);
  const manifestDiagnostics = [
    ...duplicateVariantDiagnostics(manifest),
    ...envelopeRangeDiagnostics(manifest),
    ...runtimeFacilityDiagnostics(manifest)
  ];
  if (hasErrors(manifestDiagnostics)) {
    return {
      manifest,
      specState: "invalid",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [...envelopeDiagnostics, ...manifestDiagnostics]
    };
  }
  const registration = registry.getEntry(manifest.contract.id, manifest.contract.major);
  if (registration === void 0) {
    return {
      manifest,
      specState: "unknown-contract",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        ...manifestDiagnostics,
        diagnostic("warning", "x3.sdk/unknown-contract", `contract \xAB${manifest.contract.id}\xBB major ${manifest.contract.major} has no registered spec schema \u2014 contribution stays inspectable data and is not activatable`, ["contract"])
      ]
    };
  }
  const specDiagnostics = (await validateWithSchema(registration.schema, manifest.spec, "x3.sdk/invalid-spec", registration.validator)).map((d) => ({ ...d, path: ["spec", ...d.path ?? []] }));
  if (hasErrors(specDiagnostics)) {
    return {
      manifest,
      specState: "invalid",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [...envelopeDiagnostics, ...manifestDiagnostics, ...specDiagnostics]
    };
  }
  const semanticDiagnostics = [
    ...manifestDiagnostics,
    ...await runSemanticValidator(registration.validateSemantics, manifest)
  ];
  if (hasErrors(semanticDiagnostics)) {
    return {
      manifest,
      specState: "invalid",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [...envelopeDiagnostics, ...specDiagnostics, ...semanticDiagnostics]
    };
  }
  if (registration.registration === void 0) {
    return {
      manifest,
      specState: "validated",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        ...specDiagnostics,
        diagnostic("warning", "x3.sdk/schema-only-contract", `contract \xAB${manifest.contract.id}\xBB major ${manifest.contract.major} has a schema but no executable registration quartet`, ["contract"])
      ]
    };
  }
  if (registration.registration.mode === "executable" && (manifest.runtimeVariants?.length ?? 0) === 0) {
    const missingVariant = diagnostic("error", "x3.sdk/executable-without-runtime-variant", "an executable contribution requires at least one runtime variant", ["runtimeVariants"]);
    return {
      manifest,
      specState: "invalid",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        ...specDiagnostics,
        ...semanticDiagnostics,
        missingVariant
      ]
    };
  }
  if (registration.registration.mode === "data-only" && (manifest.runtimeVariants?.length ?? 0) > 0) {
    const unexpectedVariant = diagnostic("error", "x3.sdk/data-only-with-runtime-variant", "a data-only contribution cannot declare runtime variants", ["runtimeVariants"]);
    return {
      manifest,
      specState: "invalid",
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        ...specDiagnostics,
        ...semanticDiagnostics,
        unexpectedVariant
      ]
    };
  }
  return {
    manifest,
    specState: "validated",
    inventoryEligible: true,
    activationEligible: registration.registration.mode === "executable",
    diagnostics: [...envelopeDiagnostics, ...specDiagnostics, ...semanticDiagnostics]
  };
}

// ../../MODDING/modkit-core/packages/sdk/dist/manifest/contribution-contract-registry.js
var SUBJECT_KIND_DEFINITION_CONTRIBUTION_CONTRACT = contractId("modkit/subject-kind-definition");
var SUBJECT_KIND_DEFINITION_FACT = contractId("modkit.inventory/subject-kind-definition");
var CODEC_CONTRIBUTION_CONTRACT = contractId("modkit/codec-contribution");
var SERVICE_PROVIDER_CONTRIBUTION_CONTRACT = contractId("modkit/service-provider-contribution");
var VIEWER_CONTRIBUTION_CONTRACT = contractId("modkit/viewer-contribution");
var EDITOR_CONTRIBUTION_CONTRACT = contractId("modkit/editor-contribution");
var FIELD_EDITOR_CONTRIBUTION_CONTRACT = contractId("modkit/field-editor-contribution");
var TRAIT_DEFINITION_CONTRIBUTION_CONTRACT = contractId("modkit/trait-definition");
var CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT = contractId("modkit/contract-definition");
var KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT = contractId("modkit/knowledge-pack");
var LOCALIZATION_CONTRIBUTION_CONTRACT = contractId("modkit/localization-contribution");
var TRAIT_DEFINITION_FACT = contractId("modkit.inventory/trait-definition");
var CONTRACT_DEFINITION_FACT = contractId("modkit.inventory/contract-definition");
var EDITOR_CONTRIBUTION_FACT = contractId("modkit.inventory/editor-contribution");
var FIELD_EDITOR_CONTRIBUTION_FACT = contractId("modkit.inventory/field-editor-contribution");
var KNOWLEDGE_PACK_FACT = contractId("modkit.inventory/knowledge-pack");
var LOCALIZATION_CONTRIBUTION_FACT = contractId("modkit.inventory/localization-contribution");
function duplicateFieldDiagnostics(values, path, label) {
  const first = /* @__PURE__ */ new Map();
  const diagnostics = [];
  values.forEach((value2, index) => {
    const previous = first.get(value2);
    if (previous === void 0)
      first.set(value2, index);
    else {
      diagnostics.push(diagnostic("error", "x3.sdk/duplicate-semantic-id", `${label} ${value2} duplicates index ${previous}`, [...path, index]));
    }
  });
  return diagnostics;
}
function requirementRangeDiagnostics(requirement, path) {
  const parsed = requirement.range === void 0 ? void 0 : parseVersionRange(requirement.range);
  return requirement.range !== void 0 && (parsed === void 0 || !versionRangeTargetsMajor(parsed, requirement.major)) ? [
    diagnostic("error", "x3.sdk/invalid-contract-range", `contract range ${requirement.range} cannot be evaluated safely`, [...path, "range"])
  ] : [];
}
function traitDefinitionRangeDiagnostics(id, range, path) {
  if (isStandardTraitId(id)) {
    return range === void 0 ? [] : [
      diagnostic("error", "x3.sdk/standard-trait-versioned", `standard trait ${id} does not use an extension definition range`, [...path, "definitionRange"])
    ];
  }
  if (range === void 0 || parseVersionRange(range) === void 0) {
    return [
      diagnostic("error", "x3.sdk/custom-trait-definition-unbound", `custom trait ${id} must declare a safe definition range`, [...path, "definitionRange"])
    ];
  }
  return [];
}
function traitDefinitionOfferDiagnostics(id, version, path) {
  if (isStandardTraitId(id)) {
    return version === void 0 ? [] : [
      diagnostic("error", "x3.sdk/standard-trait-versioned", `standard trait ${id} does not use an extension definition version`, [...path, "definitionVersion"])
    ];
  }
  if (version === void 0 || parseSemver(version) === void 0) {
    return [
      diagnostic("error", "x3.sdk/custom-trait-definition-unbound", `custom trait ${id} must declare one exact safe definition version`, [...path, "definitionVersion"])
    ];
  }
  return [];
}
function normalizedNamespaceProbePath(value2) {
  if (value2.includes("\0") || value2.includes("\\"))
    return void 0;
  const parts = value2.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === ".."))
    return void 0;
  return parts.join("/");
}
function namespaceProbePathDiagnostics(values, field) {
  const diagnostics = [];
  const first = /* @__PURE__ */ new Map();
  values.forEach((value2, index) => {
    const normalized = normalizedNamespaceProbePath(value2);
    if (normalized === void 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/namespace-probe-path-invalid", `namespace probe ${field.slice(0, -1)} \xAB${value2}\xBB is not a confined POSIX path`, ["spec", "probe", field, index]));
      return;
    }
    const previous = first.get(normalized);
    if (previous === void 0)
      first.set(normalized, index);
    else {
      diagnostics.push(diagnostic("error", "x3.sdk/namespace-probe-path-duplicate", `namespace probe ${field.slice(0, -1)} \xAB${value2}\xBB duplicates index ${previous} after normalization`, ["spec", "probe", field, index]));
    }
  });
  return diagnostics;
}
var validateCodecContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const localCodecPrefix = manifest.id;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.formatRefs.map((format) => format.formatId), ["spec", "formatRefs"], "format ID"),
    ...duplicateFieldDiagnostics(spec.representations.map((representation) => representation.id), ["spec", "representations"], "representation ID"),
    ...duplicateFieldDiagnostics(spec.companions?.map((companion) => companion.id) ?? [], ["spec", "companions"], "companion rule ID"),
    ...duplicateFieldDiagnostics(spec.traitDeclarations?.map((declaration) => `${declaration.id}\0${declaration.representation}`) ?? [], ["spec", "traitDeclarations"], "trait declaration coordinate"),
    ...duplicateFieldDiagnostics(spec.operations.map((operation) => operation.id), ["spec", "operations"], "operation ID"),
    ...duplicateFieldDiagnostics(spec.operations.map((operation) => operation.handlerId), ["spec", "operations"], "operation handler ID"),
    ...duplicateFieldDiagnostics(spec.fidelityEvidence?.map((item) => item.evidenceId) ?? [], ["spec", "fidelityEvidence"], "fidelity evidence ID")
  ];
  const formatIds = new Set(spec.formatRefs.map((format) => format.formatId));
  const containerPack = spec.operations.find((operation) => operation.id === "container.pack");
  if (containerPack !== void 0) {
    if (!spec.roles.includes("container") || spec.sourceTopology !== "single" || spec.probe.kind !== "bytes") {
      diagnostics.push(diagnostic("error", "x3.sdk/container-pack-topology-invalid", "container.pack requires a container-role codec with single byte topology", ["spec", "operations", spec.operations.indexOf(containerPack)]));
    }
    const permissions = new Set(containerPack.requiredPermissions ?? []);
    if (containerPack.mutatesSource !== true || permissions.size !== 2 || !permissions.has("read-source") || !permissions.has("write-source") || containerPack.outputKinds?.length !== 1 || containerPack.outputKinds[0] !== "edit-plan") {
      diagnostics.push(diagnostic("error", "x3.sdk/container-pack-operation-invalid", "container.pack must mutate the source, require read-source and write-source, and return only edit-plan", ["spec", "operations", spec.operations.indexOf(containerPack)]));
    }
  }
  const representationIds = new Set(spec.representations.map((representation) => representation.id));
  spec.fidelityEvidence?.forEach((item, index) => {
    if (!formatIds.has(item.formatId)) {
      diagnostics.push(diagnostic("error", "x3.sdk/fidelity-evidence-format-unknown", `fidelity evidence ${item.evidenceId} names undeclared format ${item.formatId}`, ["spec", "fidelityEvidence", index, "formatId"]));
    }
    if (!representationIds.has(item.representationId)) {
      diagnostics.push(diagnostic("error", "x3.sdk/fidelity-evidence-representation-unknown", `fidelity evidence ${item.evidenceId} names undeclared representation ${item.representationId}`, ["spec", "fidelityEvidence", index, "representationId"]));
    }
  });
  const expectedProbeKind = spec.sourceTopology === "namespace" ? "namespace" : spec.sourceTopology === "derived" ? "derived" : "bytes";
  if (spec.probe.kind !== expectedProbeKind) {
    diagnostics.push(diagnostic("error", "x3.sdk/probe-topology-mismatch", `topology ${spec.sourceTopology} requires a ${expectedProbeKind} probe policy`, ["spec", "probe", "kind"]));
  }
  if (spec.probe.kind === "namespace") {
    diagnostics.push(...namespaceProbePathDiagnostics(spec.probe.markers, "markers"), ...namespaceProbePathDiagnostics(spec.probe.prefixes ?? [], "prefixes"));
  }
  if (spec.container !== void 0) {
    if (spec.sourceTopology !== "namespace" || spec.probe.kind !== "namespace") {
      diagnostics.push(diagnostic("error", "x3.sdk/container-alias-topology-invalid", "a container topology alias requires namespace topology and a namespace probe", ["spec", "container"]));
    }
    if (spec.roles.includes("container")) {
      diagnostics.push(diagnostic("error", "x3.sdk/container-alias-role-invalid", "a semantic container alias cannot also claim the container role", ["spec", "roles"]));
    }
    if ((spec.match.signatures?.length ?? 0) > 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/container-alias-signature-forbidden", "a semantic container alias must not copy the carrier container signature", ["spec", "match", "signatures"]));
    }
    if ((spec.match.extensions?.length ?? 0) === 0 && (spec.match.mediaTypes?.length ?? 0) === 0 && (spec.match.pathGlobs?.length ?? 0) === 0 && (spec.container?.markers?.length ?? 0) === 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/container-alias-selector-missing", "a semantic container alias requires an extension, media type, path or marker selector", ["spec", "match"]));
    }
    if (formatIds.has(spec.container.formatId)) {
      diagnostics.push(diagnostic("error", "x3.sdk/container-alias-self-cycle", `container alias ${spec.container.formatId} also appears in the semantic codec formatRefs`, ["spec", "container", "formatId"]));
    }
  }
  spec.requires?.forEach((requirement, index) => {
    diagnostics.push(...requirementRangeDiagnostics(requirement, ["spec", "requires", index]));
  });
  spec.traitDeclarations?.forEach((claim, index) => {
    diagnostics.push(...traitDefinitionOfferDiagnostics(claim.id, claim.definitionVersion, [
      "spec",
      "traitDeclarations",
      index
    ]));
    claim.prerequisites?.forEach((requirement, requirementIndex) => {
      diagnostics.push(...requirementRangeDiagnostics(requirement, [
        "spec",
        "traitDeclarations",
        index,
        "prerequisites",
        requirementIndex
      ]));
    });
  });
  spec.companions?.forEach((companion, companionIndex) => {
    for (const selector of ["all", "any", "none"]) {
      companion.expected?.[selector]?.forEach((requirement, requirementIndex) => {
        diagnostics.push(...traitDefinitionRangeDiagnostics(requirement.id, requirement.definitionRange, [
          "spec",
          "companions",
          companionIndex,
          "expected",
          selector,
          requirementIndex
        ]));
      });
    }
  });
  spec.operations.forEach((operation, index) => {
    if (operation.requiresContract !== void 0) {
      diagnostics.push(...requirementRangeDiagnostics(operation.requiresContract, [
        "spec",
        "operations",
        index,
        "requiresContract"
      ]));
    }
    const shared = SHARED_OPERATION_IDS.includes(operation.id);
    const canonicalDomain = OPERATION_DOMAINS.some((domain) => {
      const prefix = `${domain}.`;
      return operation.id.startsWith(prefix) && isSegment(operation.id.slice(prefix.length));
    });
    const localSuffix = operation.id.startsWith(`${localCodecPrefix}.`) ? operation.id.slice(localCodecPrefix.length + 1) : void 0;
    const codecLocal = localSuffix !== void 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(localSuffix);
    if (!shared && !canonicalDomain && !codecLocal) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-operation-namespace", `operation ${operation.id} is not shared, canonical-domain, or local to ${manifest.id}`, ["spec", "operations", index, "id"]));
    }
  });
  const requiredPermissions = /* @__PURE__ */ new Set(["read-source"]);
  spec.operations.forEach((operation) => {
    if (operation.mutatesSource)
      requiredPermissions.add("write-source");
    operation.requiredPermissions?.forEach((permission) => requiredPermissions.add(permission));
  });
  manifest.runtimeVariants?.forEach((variant, variantIndex) => {
    const requested = new Set(variant.requestedPermissionClasses);
    for (const permission of requiredPermissions) {
      if (!requested.has(permission)) {
        diagnostics.push(diagnostic("error", "x3.sdk/variant-permission-underdeclared", `runtime variant ${variant.variantId} does not request ${permission}`, ["runtimeVariants", variantIndex, "requestedPermissionClasses"]));
      }
    }
  });
  return diagnostics;
};
function isPortableOperationReference(id) {
  if (SHARED_OPERATION_IDS.includes(id))
    return true;
  if (OPERATION_DOMAINS.some((domain) => {
    const prefix = `${domain}.`;
    return id.startsWith(prefix) && isSegment(id.slice(prefix.length));
  })) {
    return true;
  }
  const separator = id.lastIndexOf(".");
  return separator > 0 && isQualifiedId(id.slice(0, separator)) && isSegment(id.slice(separator + 1));
}
var validateViewerContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.requiresTraits?.map((requirement) => requirement.id) ?? [], ["spec", "requiresTraits"], "trait requirement"),
    ...duplicateFieldDiagnostics(spec.requiresOperations ?? [], ["spec", "requiresOperations"], "operation requirement")
  ];
  spec.requiresOperations?.forEach((id, index) => {
    if (!isPortableOperationReference(id)) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-operation-namespace", `viewer operation requirement ${id} is not shared, canonical-domain, or qualified-local`, ["spec", "requiresOperations", index]));
    }
  });
  spec.requiresTraits?.forEach((requirement, index) => {
    diagnostics.push(...traitDefinitionRangeDiagnostics(requirement.id, requirement.definitionRange, [
      "spec",
      "requiresTraits",
      index
    ]));
  });
  return diagnostics;
};
var EDITING_OPERATION_IDS = Object.freeze([
  "edit.content",
  "edit.structure",
  "edit.field",
  "edit.undo-redo",
  "source.save",
  "source.save-as"
]);
var validateEditorContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.requiresOperations, ["spec", "requiresOperations"], "operation"),
    ...duplicateFieldDiagnostics(spec.consumesDataSources.map((source) => `${source.contract}@${source.major}`), ["spec", "consumesDataSources"], "data-source requirement")
  ];
  spec.requiresOperations.forEach((id, index) => {
    if (!EDITING_OPERATION_IDS.includes(id)) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-editor-operation", `editor operation ${id} is not one of the shared editing operations`, ["spec", "requiresOperations", index]));
    }
  });
  if (!spec.requiresOperations.some((id) => id.startsWith("edit."))) {
    diagnostics.push(diagnostic("error", "x3.sdk/editor-edit-operation-missing", "an editor contribution requires an explicit edit operation", ["spec", "requiresOperations"]));
  }
  if (spec.requiresTransactions && !spec.requiresOperations.some((id) => id === "source.save" || id === "source.save-as")) {
    diagnostics.push(diagnostic("error", "x3.sdk/editor-save-operation-missing", "a transactional editor requires source.save or source.save-as", ["spec", "requiresOperations"]));
  }
  if (spec.requiresTransactions && spec.writer.mutationMode !== "mutate") {
    diagnostics.push(diagnostic("error", "x3.sdk/editor-writer-mode-mismatch", "a transactional editor requires a mutating writer", ["spec", "writer", "mutationMode"]));
  }
  return diagnostics;
};
var validateTraitDefinitionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [];
  if (parseSemver(spec.version) === void 0) {
    diagnostics.push(diagnostic("error", "x3.sdk/invalid-definition-version", `trait definition version ${spec.version} cannot be evaluated safely`, ["spec", "version"]));
  }
  const seen = /* @__PURE__ */ new Map();
  spec.imports?.forEach((dependency, index) => {
    if (dependency.id === spec.id) {
      diagnostics.push(diagnostic("error", "x3.sdk/self-definition-import", `trait definition ${spec.id} cannot import itself`, ["spec", "imports", index, "id"]));
    }
    const previous = seen.get(dependency.id);
    if (previous === void 0)
      seen.set(dependency.id, index);
    else {
      diagnostics.push(diagnostic("error", "x3.sdk/duplicate-definition-import", `trait import ${dependency.id} duplicates index ${previous}`, ["spec", "imports", index, "id"]));
    }
    if (parseVersionRange(dependency.range) === void 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-definition-range", `trait import range ${dependency.range} cannot be evaluated safely`, ["spec", "imports", index, "range"]));
    }
  });
  return diagnostics;
};
var validateContractDefinitionSemantics = (manifest) => {
  const spec = manifest.spec;
  if (!Number.isSafeInteger(spec.major) || spec.major < 0) {
    return [
      diagnostic("error", "x3.sdk/invalid-contract-major", `contract definition major ${spec.major} is not a safe non-negative integer`, ["spec", "major"])
    ];
  }
  if (spec.surface !== void 0) {
    return dataSourceSurfaceDiagnostics(spec.surface, ["spec", "surface"]);
  }
  return [];
};
function dataSourceSurfaceDiagnostics(surface, path) {
  const diagnostics = [];
  if (surface.releaseVia !== void 0) {
    const target = surface.methods[surface.releaseVia];
    if (target === void 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/surface-release-via-unknown", `releaseVia \xAB${surface.releaseVia}\xBB does not name a declared method`, [...path, "releaseVia"]));
    } else if (target.kind !== "value") {
      diagnostics.push(diagnostic("error", "x3.sdk/surface-release-via-kind", `releaseVia \xAB${surface.releaseVia}\xBB must name a value method, found ${target.kind}`, [...path, "releaseVia"]));
    }
  }
  for (const field of surface.fields ?? []) {
    if (Object.hasOwn(surface.methods, field)) {
      diagnostics.push(diagnostic("error", "x3.sdk/surface-field-is-method", `\xAB${field}\xBB cannot be both a field and a method`, [...path, "fields"]));
    }
  }
  return diagnostics;
}
var validateServiceProviderContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.provides.map((offer) => offer.offerId), ["spec", "provides"], "offer ID"),
    ...duplicateFieldDiagnostics(spec.outputs?.map((output) => `${output.id}\0${output.representation}`) ?? [], ["spec", "outputs"], "trait declaration coordinate"),
    ...duplicateFieldDiagnostics(spec.fidelityEvidence?.map((evidence) => `${evidence.offerId}\0${evidence.evidenceId}`) ?? [], ["spec", "fidelityEvidence"], "writer fidelity evidence coordinate")
  ];
  spec.requires?.forEach((requirement, index) => {
    diagnostics.push(...requirementRangeDiagnostics(requirement, ["spec", "requires", index]));
  });
  spec.outputs?.forEach((claim, index) => {
    diagnostics.push(...traitDefinitionOfferDiagnostics(claim.id, claim.definitionVersion, [
      "spec",
      "outputs",
      index
    ]));
    claim.prerequisites?.forEach((requirement, requirementIndex) => {
      diagnostics.push(...requirementRangeDiagnostics(requirement, [
        "spec",
        "outputs",
        index,
        "prerequisites",
        requirementIndex
      ]));
    });
  });
  if (spec.replacement !== void 0) {
    diagnostics.push(...requirementRangeDiagnostics(spec.replacement.target, ["spec", "replacement", "target"]));
  }
  const variants = new Set((manifest.runtimeVariants ?? []).map((variant) => variant.variantId));
  spec.provides.forEach((offer, index) => {
    const version = parseSemver(offer.version);
    if (version === void 0 || version.major !== offer.major) {
      diagnostics.push(diagnostic("error", "x3.sdk/offer-major-mismatch", `offer ${offer.offerId} version ${offer.version} does not match major ${offer.major}`, ["spec", "provides", index, "version"]));
    }
  });
  const offersById = new Map(spec.provides.map((offer, index) => [offer.offerId, { offer, index }]));
  spec.fidelityEvidence?.forEach((evidence, index) => {
    const found = offersById.get(evidence.offerId);
    if (found === void 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/writer-evidence-offer-unknown", `writer fidelity evidence references unknown offer ${evidence.offerId}`, ["spec", "fidelityEvidence", index, "offerId"]));
      return;
    }
    if (found.offer.contract !== "common.edit/writer" || found.offer.major !== 1) {
      diagnostics.push(diagnostic("error", "x3.sdk/writer-evidence-offer-contract", `writer fidelity evidence offer ${evidence.offerId} is not common.edit/writer@1`, ["spec", "fidelityEvidence", index, "offerId"]));
      return;
    }
    const facet = found.offer.facet;
    if (typeof facet !== "object" || facet === null || Array.isArray(facet)) {
      diagnostics.push(diagnostic("error", "x3.sdk/writer-evidence-offer-facet", `writer fidelity evidence offer ${evidence.offerId} has no writer facet`, ["spec", "provides", found.index, "facet"]));
      return;
    }
    const writerFacet = facet;
    if (writerFacet.providerId !== manifest.id) {
      diagnostics.push(diagnostic("error", "x3.sdk/writer-evidence-provider-mismatch", `writer offer ${evidence.offerId} providerId must equal contribution id ${manifest.id}`, ["spec", "provides", found.index, "facet", "providerId"]));
    }
    if (writerFacet.fidelityEvidenceId !== evidence.evidenceId) {
      diagnostics.push(diagnostic("error", "x3.sdk/writer-evidence-id-mismatch", `writer evidence ${evidence.evidenceId} does not match offer ${evidence.offerId}`, ["spec", "fidelityEvidence", index, "evidenceId"]));
    }
    if (writerFacet.minimumRoundTrip !== evidence.claim.roundTrip) {
      diagnostics.push(diagnostic("error", "x3.sdk/writer-evidence-claim-mismatch", `writer evidence ${evidence.evidenceId} claims ${evidence.claim.roundTrip}, but offer ${evidence.offerId} declares ${String(writerFacet.minimumRoundTrip)}`, ["spec", "fidelityEvidence", index, "claim", "roundTrip"]));
    }
  });
  spec.applicableVariants?.forEach((variantId, index) => {
    if (!variants.has(variantId)) {
      diagnostics.push(diagnostic("error", "x3.sdk/unknown-applicable-variant", `applicable variant ${variantId} is not declared by the envelope`, ["spec", "applicableVariants", index]));
    }
  });
  return diagnostics;
};
var validateKnowledgePackSemantics = (manifest) => {
  const spec = manifest.spec;
  const entries = spec.entries ?? [];
  const diagnostics = duplicateFieldDiagnostics(entries.map((entry) => `${entry.id}\0${entry.locale.toLowerCase()}`), ["spec", "entries"], "knowledge entry and locale");
  const targetLocales = /* @__PURE__ */ new Set();
  const targetByLogicalId = /* @__PURE__ */ new Map();
  const localesByLogicalId = /* @__PURE__ */ new Map();
  entries.forEach((entry, index) => {
    const targetKey = knowledgeTargetKey(entry.target);
    const coordinate = `${targetKey}\0${entry.locale.toLowerCase()}`;
    if (targetLocales.has(coordinate)) {
      diagnostics.push(diagnostic("warning", "x3.sdk/knowledge-target-locale-overlap", `more than one knowledge entry describes the same target and locale`, ["spec", "entries", index, "target"]));
    }
    targetLocales.add(coordinate);
    const previousTarget = targetByLogicalId.get(entry.id);
    if (previousTarget !== void 0 && previousTarget !== targetKey) {
      diagnostics.push(diagnostic("error", "x3.sdk/knowledge-logical-id-target-mismatch", "translations sharing a logical knowledge entry id must describe the same target", ["spec", "entries", index, "target"]));
    } else {
      targetByLogicalId.set(entry.id, targetKey);
    }
    const logicalLocales = localesByLogicalId.get(entry.id) ?? {
      firstIndex: index,
      values: /* @__PURE__ */ new Set()
    };
    logicalLocales.values.add(entry.locale.toLowerCase());
    localesByLogicalId.set(entry.id, logicalLocales);
    const exactSchemaRevision = entry.target.kind === "field" ? entry.target.schema.revision : void 0;
    const hasExactSchemaSource = entry.sources.some((source) => source.kind === "schema" && source.schema !== void 0 && (entry.target.kind !== "field" || source.schema.contract === entry.target.schema.contract && source.schema.major === entry.target.schema.major && source.schema.revision === exactSchemaRevision));
    if (entry.claimKind === "schema-derived-fact" && !hasExactSchemaSource) {
      diagnostics.push(diagnostic("error", "x3.sdk/knowledge-schema-fact-without-schema-source", "a schema-derived fact must cite the exact active schema revision", ["spec", "entries", index, "sources"]));
    }
  });
  const sourceLocale = spec.sourceLocale.toLowerCase();
  for (const [logicalId, locales] of localesByLogicalId) {
    if (locales.values.has(sourceLocale))
      continue;
    diagnostics.push(diagnostic("error", "x3.sdk/knowledge-source-locale-missing", `knowledge entry ${logicalId} has no ${spec.sourceLocale} source-locale version`, ["spec", "entries", locales.firstIndex, "locale"]));
  }
  return diagnostics;
};
var validateLocalizationContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = duplicateFieldDiagnostics(spec.catalogs.map((catalog) => catalog.path.toLowerCase()), ["spec", "catalogs"], "localization catalog path");
  spec.catalogs.forEach((catalog, index) => {
    try {
      Intl.getCanonicalLocales(catalog.locale);
    } catch {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-localization-locale", `localization catalog locale ${catalog.locale} is not a valid BCP-47 language tag`, ["spec", "catalogs", index, "locale"]));
    }
  });
  return diagnostics;
};
var validateFieldEditorContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  return duplicateFieldDiagnostics(spec.hosts ?? [], ["spec", "hosts"], "field editor host");
};
function key(contract, major) {
  return `${contract}@${major}`;
}
function invalidOpenRegistration(message, context) {
  throw new ModkitError({
    code: "x3.sdk/invalid-contribution-contract-registration",
    message,
    context
  });
}
function safeRegistrationContextValue(value2) {
  if (value2 === null || typeof value2 === "string" || typeof value2 === "boolean")
    return value2;
  if (typeof value2 === "number")
    return Number.isFinite(value2) ? value2 : String(value2);
  return typeof value2;
}
function validatedRegistrationCoordinate(value2) {
  if (typeof value2 !== "object" || value2 === null || Array.isArray(value2)) {
    return invalidOpenRegistration("contribution contract coordinate must be an object", {});
  }
  const candidate = value2;
  const id = candidate.id;
  const major = candidate.major;
  if (typeof id !== "string" || !isQualifiedId(id)) {
    return invalidOpenRegistration("contribution contract id must be a qualified id", {
      contract: typeof id === "string" ? id : typeof id
    });
  }
  if (!Number.isSafeInteger(major) || major < 0) {
    return invalidOpenRegistration("contribution contract major must be a safe non-negative integer", { contract: id, major: safeRegistrationContextValue(major) });
  }
  return Object.freeze({ id: contractId(id), major });
}
function validatedRegistrationProfile(value2, contract, major) {
  if (typeof value2 !== "string" || value2.trim().length === 0) {
    return invalidOpenRegistration("contribution conformance profile must be non-blank", {
      contract,
      major,
      conformanceProfile: typeof value2 === "string" ? value2 : typeof value2
    });
  }
  return value2;
}
function validatedRegistrationModuleAbi(value2, contract, major) {
  if (typeof value2 !== "object" || value2 === null || Array.isArray(value2)) {
    return invalidOpenRegistration("executable contribution registration requires module ABI", {
      contract,
      major
    });
  }
  const candidate = value2;
  const exportName = candidate.export;
  const abiVersion = candidate.abiVersion;
  if (typeof exportName !== "string" || exportName.trim().length === 0) {
    return invalidOpenRegistration("module ABI export must be a non-blank string", {
      contract,
      major,
      export: typeof exportName === "string" ? exportName : typeof exportName
    });
  }
  if (!Number.isSafeInteger(abiVersion) || abiVersion < 0) {
    return invalidOpenRegistration("module ABI version must be a safe non-negative integer", {
      contract,
      major,
      abiVersion: safeRegistrationContextValue(abiVersion)
    });
  }
  return Object.freeze({ export: exportName, abiVersion });
}
function createContributionContractRegistry(entries) {
  const map = /* @__PURE__ */ new Map();
  for (const authoredEntry of entries) {
    if (typeof authoredEntry !== "object" || authoredEntry === null || Array.isArray(authoredEntry)) {
      invalidOpenRegistration("contribution contract registration must be an object", {});
    }
    const coordinate = validatedRegistrationCoordinate(authoredEntry.contract);
    const mode = authoredEntry.mode;
    const conformanceProfileValue = authoredEntry.conformanceProfile;
    const project = authoredEntry.project;
    const validateSemantics = authoredEntry.validateSemantics;
    const validator = authoredEntry.validator;
    if (mode !== "data-only" && mode !== "executable") {
      invalidOpenRegistration("contribution contract registration mode is invalid", {
        contract: coordinate.id,
        major: coordinate.major,
        mode: safeRegistrationContextValue(mode)
      });
    }
    if (typeof project !== "function") {
      invalidOpenRegistration("contribution inventory projector must be a function", {
        contract: coordinate.id,
        major: coordinate.major
      });
    }
    if (typeof validateSemantics !== "function") {
      invalidOpenRegistration("contribution semantic validator must be a function", {
        contract: coordinate.id,
        major: coordinate.major
      });
    }
    if (validator !== void 0 && typeof validator !== "function") {
      invalidOpenRegistration("precompiled schema validator must be a function", {
        contract: coordinate.id,
        major: coordinate.major
      });
    }
    const conformanceProfile = validatedRegistrationProfile(conformanceProfileValue, coordinate.id, coordinate.major);
    const base = {
      contract: coordinate,
      schema: snapshotJsonWireObject(authoredEntry.schema),
      ...validator === void 0 ? {} : { validator },
      project,
      validateSemantics,
      conformanceProfile
    };
    const entry = mode === "executable" ? Object.freeze({
      ...base,
      mode: "executable",
      moduleAbi: validatedRegistrationModuleAbi(authoredEntry.moduleAbi, coordinate.id, coordinate.major)
    }) : Object.freeze({ ...base, mode: "data-only" });
    const registrationKey = key(entry.contract.id, entry.contract.major);
    if (map.has(registrationKey)) {
      throw new ModkitError({
        code: "x3.sdk/duplicate-contribution-contract",
        message: `duplicate contribution contract registration: ${registrationKey}`,
        context: { contract: entry.contract.id, major: entry.contract.major }
      });
    }
    map.set(registrationKey, entry);
  }
  const list = Object.freeze([...map.values()].sort((left, right) => compareUtf8(left.contract.id, right.contract.id) || left.contract.major - right.contract.major));
  const validationRegistry = createSpecSchemaRegistry(list.map((entry) => ({
    contract: entry.contract.id,
    major: entry.contract.major,
    schema: entry.schema,
    ...entry.validator === void 0 ? {} : { validator: entry.validator },
    validateSemantics: entry.validateSemantics,
    registration: entry.mode === "executable" ? {
      mode: "executable",
      project: entry.project,
      moduleAbi: entry.moduleAbi,
      conformanceProfile: entry.conformanceProfile
    } : {
      mode: "data-only",
      project: entry.project,
      conformanceProfile: entry.conformanceProfile
    }
  })));
  return {
    get: (contract, major) => map.get(key(contract, major)),
    list: () => list,
    validationRegistry: () => validationRegistry
  };
}
function dataOnlyProjector(factContract) {
  return (manifest, context) => Object.freeze([
    Object.freeze({
      contract: Object.freeze({ id: factContract, major: 1 }),
      value: manifest.spec,
      provenance: Object.freeze({ ...context })
    })
  ]);
}
var A1_SPEC_SCHEMA_ENTRIES = [
  {
    contract: SUBJECT_KIND_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: subjectKindDefinitionSpecV1Schema,
    validateSemantics: (manifest) => {
      const spec = manifest.spec;
      const diagnostics = [
        ...duplicateFieldDiagnostics(spec.parentKinds ?? [], ["spec", "parentKinds"], "parent kind"),
        ...duplicateFieldDiagnostics(spec.card?.sections ?? [], ["spec", "card", "sections"], "card section"),
        ...duplicateFieldDiagnostics(spec.selector?.facets ?? [], ["spec", "selector", "facets"], "selector facet"),
        ...duplicateFieldDiagnostics(spec.selector?.predicates.map((item) => item.id) ?? [], ["spec", "selector", "predicates"], "selector predicate")
      ];
      if (spec.parentKinds?.includes(spec.kindId))
        diagnostics.push(diagnostic("error", "x3.sdk/subject-kind-self-parent", "a subject kind cannot inherit itself", ["spec", "parentKinds"]));
      return diagnostics;
    },
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(SUBJECT_KIND_DEFINITION_FACT),
      conformanceProfile: "modkit/subject-kind-definition-v1"
    }
  },
  {
    contract: CODEC_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: codecContributionSpecV1Schema,
    validateSemantics: validateCodecContributionSemantics
  },
  {
    contract: SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: serviceProviderContributionSpecV1Schema,
    validateSemantics: validateServiceProviderContributionSemantics
  },
  {
    contract: VIEWER_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: viewerContributionSpecV1Schema,
    validateSemantics: validateViewerContributionSemantics
  },
  {
    contract: EDITOR_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: editorContributionSpecV1Schema,
    validateSemantics: validateEditorContributionSemantics
  },
  {
    contract: FIELD_EDITOR_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: fieldEditorContributionSpecV1Schema,
    validateSemantics: validateFieldEditorContributionSemantics
  },
  {
    contract: TRAIT_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: traitDefinitionSpecV1Schema,
    validateSemantics: validateTraitDefinitionSemantics,
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(TRAIT_DEFINITION_FACT),
      conformanceProfile: "modkit/trait-definition-v1"
    }
  },
  {
    contract: CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: contractDefinitionSpecV1Schema,
    validateSemantics: validateContractDefinitionSemantics,
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(CONTRACT_DEFINITION_FACT),
      conformanceProfile: "modkit/contract-definition-v1"
    }
  },
  {
    contract: KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: knowledgePackSpecV1Schema,
    validateSemantics: validateKnowledgePackSemantics,
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(KNOWLEDGE_PACK_FACT),
      conformanceProfile: "modkit/knowledge-pack-v1"
    }
  },
  {
    contract: LOCALIZATION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: localizationContributionSpecV1Schema,
    validateSemantics: validateLocalizationContributionSemantics,
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(LOCALIZATION_CONTRIBUTION_FACT),
      conformanceProfile: "modkit/localization-contribution-v1"
    }
  }
];

// ../../MODDING/modkit-core/packages/sdk/dist/service-contracts.js
function foreignServiceContractId(contract) {
  if (!isQualifiedId(contract))
    throw new TypeError(`invalid foreign service contract: ${contract}`);
  return contract;
}

// ../../MODDING/modkit-core/packages/sdk/dist/oodle.js
var OODLE_DECODER_CONTRACT = "common.compression/oodle-decoder";

// ../../MODDING/modkit-core/packages/sdk/dist/index-caches.js
var INDEX_CACHE_DIRECTORY_SETTING = "indexCacheDirectory";
var INDEX_CACHE_MANIFEST = "cache.json";
function indexCacheEnabled(switches, product, kind) {
  return switches?.[product]?.[kind] !== false;
}

// ../../MODDING/modkit-core/packages/sdk/dist/relation-graph-neighbourhood.js
var PAGE_SIZE = 1024;
var MAX_PAGES = 4096;
function limit(value2, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value2) || value2 < 1 || value2 > maximum)
    throw new RangeError(`relation graph ${name} must be an integer 1..${maximum}`);
}
async function scan(read, scanLimit, signal) {
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  let cursor;
  for (let pages = 0; items.length < scanLimit && pages < MAX_PAGES; pages += 1) {
    signal?.throwIfAborted();
    const page = await read({
      ...cursor === void 0 ? {} : { cursor },
      limit: Math.min(PAGE_SIZE, scanLimit - items.length)
    }, signal);
    items.push(...page.items.slice(0, scanLimit - items.length));
    if (page.nextCursor === void 0)
      return { items, scan: { read: items.length, exhausted: true, invalidCursor: false } };
    if (seen.has(page.nextCursor) || page.nextCursor === cursor)
      return { items, scan: { read: items.length, exhausted: false, invalidCursor: true } };
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { items, scan: { read: items.length, exhausted: false, invalidCursor: false } };
}
async function relationGraphNeighbourhood(source, request, signal) {
  limit(request.roots.length, "root count", 64);
  limit(request.depth, "depth", 8);
  limit(request.maxNodes, "maxNodes");
  limit(request.maxEdges, "maxEdges");
  limit(request.scanLimit, "scanLimit");
  if (!["outgoing", "incoming", "both"].includes(request.direction))
    throw new RangeError(`relation graph direction \xAB${String(request.direction)}\xBB is unknown`);
  const summary = await source.summary(signal);
  const nodeScan = await scan((page, s) => source.nodes(page, s), request.scanLimit, signal);
  const edgeScan = await scan((page, s) => source.edges(page, s), request.scanLimit, signal);
  const byId = new Map(nodeScan.items.map((node) => [node.id, node]));
  const types = request.types === void 0 ? void 0 : new Set(request.types);
  const enters = (id) => {
    const type = byId.get(id)?.type;
    return types === void 0 || type === void 0 || types.has(type);
  };
  const kept = new Set(request.roots);
  const edges = [];
  const edgeKeys = /* @__PURE__ */ new Set();
  let frontier = new Set(request.roots);
  let capped = false;
  for (let level = 0; level < request.depth && frontier.size > 0; level += 1) {
    const next = /* @__PURE__ */ new Set();
    for (const edge of edgeScan.items) {
      const outgoing = request.direction !== "incoming" && frontier.has(edge.from);
      const incoming = request.direction !== "outgoing" && frontier.has(edge.to);
      if (!outgoing && !incoming)
        continue;
      const other = outgoing ? edge.to : edge.from;
      if (!kept.has(other)) {
        if (!enters(other))
          continue;
        if (kept.size >= request.maxNodes) {
          capped = true;
          continue;
        }
        kept.add(other);
        next.add(other);
      }
      const key2 = `${edge.from}\0${edge.to}\0${edge.role ?? ""}\0${edge.dead === true}`;
      if (edgeKeys.has(key2))
        continue;
      if (edges.length >= request.maxEdges) {
        capped = true;
        continue;
      }
      edgeKeys.add(key2);
      edges.push(edge);
    }
    frontier = next;
  }
  const nodes = [...kept].flatMap((id) => {
    const node = byId.get(id);
    return node === void 0 ? [] : [node];
  });
  const partial = summary.completeness === "partial" || nodeScan.scan.invalidCursor || edgeScan.scan.invalidCursor;
  const complete = summary.completeness === "complete" && nodeScan.scan.exhausted && edgeScan.scan.exhausted && !capped;
  return {
    snapshotId: summary.snapshotId,
    nodes,
    edges,
    missingNodeIds: [...kept].filter((id) => !byId.has(id)),
    completeness: complete ? "complete" : partial ? "partial" : "capped",
    capped,
    scanned: { nodes: nodeScan.scan, edges: edgeScan.scan },
    ...summary.reason === void 0 ? {} : { reason: summary.reason }
  };
}

// ../../MODDING/modkit-core/packages/sdk/dist/language/translation.js
var TRANSLATION_CONTRACT = "common.language/translation";
var TRANSLATION_MATCHER_PROFILE = "modkit/translation-matcher";

// ../../MODDING/modkit-core/packages/sdk/dist/language/index.js
var LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT = "common.language/document-analysis";
var LANGUAGE_DOCUMENT_MATCHER_PROFILE = "modkit/language-document-matcher";
var languageWorkspaceIsSemanticallyIncomplete = (request) => request.workspaceContext === void 0 ? request.workspaceIncomplete : !request.workspaceContext.semanticComplete;

// ../../MODDING/modkit-core/packages/sdk/dist/runtime/index.js
var RUNTIME_PROVIDER_CONTRACT = "common.runtime/provider";
var RUNTIME_SESSION_CONTRACT = "common.runtime/session";
var RUNTIME_PROVIDER_MATCHER_PROFILE = "modkit/runtime-provider-matcher";
var RUNTIME_SESSION_V2_MEMBERS = Object.freeze([
  "offers",
  "identity",
  "step",
  "events",
  "snapshot",
  "restore",
  "stateHash"
]);

// ../../MODDING/modkit-core/packages/sdk/dist/service-operations.js
var SERVICE_OPERATION_PROVIDER_CONTRACT = "common.runtime/operation-provider";
var SERVICE_OPERATION_MATCHER_PROFILE = "modkit/service-operation-matcher";

// ../../MODDING/modkit-core/packages/sdk/dist/games/index.js
var GAME_INSTALLATION_DISCOVERY_CONTRACT = "common.game/installation-discovery";
var GAME_LAUNCH_PLAN_CONTRACT = "common.game/launch-plan";
var GAME_INSTALLATION_MATCHER_PROFILE = "modkit/game-installation-matcher";
function gameLaunchOptionsJsonSchema(options) {
  const properties = {};
  for (const [name, option] of Object.entries(options)) {
    properties[name] = {
      type: option.type,
      ...option.description === void 0 ? {} : { description: option.description },
      ...option.default === void 0 ? {} : { default: option.default },
      ...option.enum === void 0 ? {} : { enum: [...option.enum] },
      ...option.minimum === void 0 ? {} : { minimum: option.minimum },
      ...option.maximum === void 0 ? {} : { maximum: option.maximum }
    };
  }
  return { type: "object", additionalProperties: false, properties };
}

// ../../MODDING/modkit-core/packages/sdk/dist/mods/index.js
var MOD_WORKSPACE_COMPOSITION_CONTRACT = "common.mod/workspace-composition";
var MOD_WORKSPACE_MATCHER_PROFILE = "modkit/mod-workspace-matcher";
function positiveLimit(value2, name) {
  if (!Number.isSafeInteger(value2) || value2 <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value2;
}
function immutableDiagnostic(value2) {
  return Object.freeze({
    ...value2,
    ...value2.cycle === void 0 ? {} : { cycle: Object.freeze([...value2.cycle]) }
  });
}
function immutableSource(value2) {
  return Object.freeze({ ...value2 });
}
function immutableRoot(value2) {
  return Object.freeze({
    ...value2,
    dependencies: Object.freeze(value2.dependencies.map((item) => Object.freeze({ ...item })))
  });
}
function resolveModWorkspaceGraph(input) {
  const maxRoots = positiveLimit(input.maxRoots, "maxRoots");
  const maxDepth = positiveLimit(input.maxDepth, "maxDepth");
  if (input.roots.length > maxRoots) {
    throw new TypeError(`roots exceeds maxRoots (${input.roots.length} > ${maxRoots})`);
  }
  const diagnostics = [];
  const sourceIds = /* @__PURE__ */ new Set();
  for (const source of input.sources) {
    if (sourceIds.has(source.sourceId)) {
      diagnostics.push({
        severity: "error",
        code: "common.mod/source-id-duplicate",
        message: `workspace source id is duplicated: ${source.sourceId}`
      });
    } else {
      sourceIds.add(source.sourceId);
    }
  }
  const roots = /* @__PURE__ */ new Map();
  for (const root of input.roots) {
    if (!sourceIds.has(root.sourceId)) {
      diagnostics.push({
        severity: "error",
        code: "common.mod/root-source-unavailable",
        message: `${root.rootId} names unavailable source ${root.sourceId}`,
        rootId: root.rootId
      });
      continue;
    }
    if (roots.has(root.rootId)) {
      diagnostics.push({
        severity: "error",
        code: "common.mod/root-id-duplicate",
        message: `workspace root id is duplicated: ${root.rootId}`,
        rootId: root.rootId
      });
      continue;
    }
    roots.set(root.rootId, immutableRoot(root));
  }
  const order = [];
  const state = /* @__PURE__ */ new Map();
  const missing = /* @__PURE__ */ new Set();
  const cycles = /* @__PURE__ */ new Set();
  let complete = diagnostics.every((item) => item.severity !== "error");
  const visit = (rootId, depth, path) => {
    const currentState = state.get(rootId);
    if (currentState === "visited")
      return;
    if (currentState === "visiting") {
      complete = false;
      const start = path.indexOf(rootId);
      const cycle = [...start === -1 ? path : path.slice(start), rootId];
      const key2 = cycle.join("\0");
      if (!cycles.has(key2)) {
        cycles.add(key2);
        diagnostics.push({
          severity: "error",
          code: "common.mod/dependency-cycle",
          message: `workspace dependency cycle: ${cycle.join(" -> ")}`,
          rootId,
          cycle
        });
      }
      return;
    }
    if (depth > maxDepth) {
      complete = false;
      diagnostics.push({
        severity: "error",
        code: "common.mod/dependency-depth-exceeded",
        message: `${rootId} exceeds workspace dependency depth ${maxDepth}`,
        rootId
      });
      return;
    }
    const root = roots.get(rootId);
    if (root === void 0)
      return;
    state.set(rootId, "visiting");
    const nextPath = [...path, rootId];
    for (const dependency of root.dependencies) {
      const target = roots.get(dependency.targetRootId);
      if (target !== void 0) {
        visit(target.rootId, depth + 1, nextPath);
        continue;
      }
      const key2 = `${rootId}\0${dependency.targetRootId}\0${dependency.ref}`;
      if (missing.has(key2))
        continue;
      missing.add(key2);
      if (dependency.required)
        complete = false;
      diagnostics.push({
        severity: dependency.required ? "error" : "warning",
        code: dependency.required ? "common.mod/dependency-unresolved" : "common.mod/optional-dependency-unresolved",
        message: `${rootId} cannot resolve ${dependency.ref}`,
        rootId,
        dependencyRef: dependency.ref
      });
    }
    state.set(rootId, "visited");
    order.push(root);
  };
  if (!roots.has(input.activeRootId)) {
    complete = false;
    diagnostics.push({
      severity: "error",
      code: "common.mod/active-root-unavailable",
      message: `active workspace root is unavailable: ${input.activeRootId}`,
      rootId: input.activeRootId
    });
  } else {
    visit(input.activeRootId, 0, []);
  }
  const loadOrder = Object.freeze([...order]);
  const dependencyOrder = Object.freeze(order.filter((root) => root.rootId !== input.activeRootId));
  const logicalRoots = Object.freeze([...order].reverse());
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    gameId: input.gameId,
    activeRootId: input.activeRootId,
    sources: Object.freeze(input.sources.map(immutableSource)),
    loadOrder,
    dependencyOrder,
    logicalRoots,
    diagnostics: Object.freeze(diagnostics.map(immutableDiagnostic)),
    complete
  });
}

// ../../MODDING/modkit-core/packages/sdk/dist/data/index.js
var DATA_CATALOG_ANALYSIS_CONTRACT = "common.data/catalog-analysis";
var DATA_CATALOG_MATCHER_PROFILE = "modkit/data-catalog-matcher";
var RESOLVED_DATA_WORKSPACE_CONTRACT = "common.data/resolved-workspace";
var RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE = "modkit/resolved-data-workspace-matcher";
var RESOLVED_DATA_AUTHORING_INDEX_KIND = "resolved-data-authoring-index";
var DATA_CATALOG_QUERIES_OUTPUT = "catalogQueries";
var DATA_CATALOG_ENTITIES_INPUT = "catalogEntities";
function positiveLimit2(value2, name) {
  if (!Number.isSafeInteger(value2) || value2 <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value2;
}
function entityKey(namespace, entityId) {
  return `${namespace}\0${entityId}`;
}
function cloneJson(value2) {
  if (Array.isArray(value2))
    return value2.map(cloneJson);
  if (typeof value2 === "object" && value2 !== null) {
    return Object.fromEntries(Object.entries(value2).map(([key2, item]) => [key2, cloneJson(item)]));
  }
  return value2;
}
function immutableJson(value2) {
  if (Array.isArray(value2))
    return Object.freeze(value2.map(immutableJson));
  if (typeof value2 === "object" && value2 !== null) {
    return Object.freeze(Object.fromEntries(Object.entries(value2).map(([key2, item]) => [key2, immutableJson(item)])));
  }
  return value2;
}
function immutableSource2(value2) {
  return Object.freeze({ ...value2 });
}
function immutableRef(value2) {
  return Object.freeze({ ...value2 });
}
function immutableDiagnostic2(value2) {
  return Object.freeze({
    ...value2,
    ...value2.source === void 0 ? {} : { source: immutableSource2(value2.source) },
    ...value2.chain === void 0 ? {} : { chain: Object.freeze(value2.chain.map(immutableRef)) }
  });
}
function immutableSchema(value2) {
  const immutableField = (field) => Object.freeze({
    ...field,
    ...field.type === void 0 ? {} : { type: immutableJson(field.type) },
    ...field.fields === void 0 ? {} : { fields: Object.freeze(field.fields.map(immutableField)) }
  });
  return Object.freeze({ ...value2, fields: Object.freeze(value2.fields.map(immutableField)) });
}
function recordOf(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function indexedKey(value2, indexKey) {
  const record = recordOf(value2);
  const index = record?.[indexKey];
  return typeof index === "string" || typeof index === "number" ? String(index) : void 0;
}
function isRemoved(value2) {
  const removed = recordOf(value2)?.["removed"];
  return removed === true || removed === 1 || removed === "1";
}
var authoringOriginKey = (path) => JSON.stringify(path);
var authoringPathStartsWith = (path, prefix) => prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
function clearAuthoringOrigins(tracker, path) {
  for (const [key2, origin] of tracker.origins) {
    if (authoringPathStartsWith(origin.path, path))
      tracker.origins.delete(key2);
  }
}
function setAuthoringOrigin(tracker, path) {
  const origin = tracker.originForPath(path);
  const immutablePath = Object.freeze([...path]);
  tracker.origins.set(authoringOriginKey(path), Object.freeze({
    path: immutablePath,
    source: origin.source,
    originEntityId: origin.originEntityId
  }));
}
function visitStructuredOriginPaths(value2, nestedFields, path, visit, ignoredKeys = /* @__PURE__ */ new Set()) {
  const record = recordOf(value2);
  if (record !== void 0) {
    const nested = new Map((nestedFields ?? []).map((field) => [field.fieldId, field]));
    let visited = false;
    for (const [key2, childValue] of Object.entries(record)) {
      if (ignoredKeys.has(key2))
        continue;
      visited = true;
      const child = nested.get(key2);
      if (child === void 0) {
        visitStructuredOriginPaths(childValue, void 0, [...path, key2], visit);
      } else {
        visitFieldOriginPaths(childValue, child, [...path, key2], visit);
      }
    }
    if (!visited)
      visit(path);
    return;
  }
  if (Array.isArray(value2)) {
    if (value2.length === 0)
      visit(path);
    else
      value2.forEach((item, index) => visitStructuredOriginPaths(item, nestedFields, [...path, String(index)], visit));
    return;
  }
  visit(path);
}
function visitFieldOriginPaths(value2, field, path, visit) {
  if (field.cardinality === "indexed") {
    const indexKey = field.indexKey ?? "index";
    let visited = false;
    for (const item of Array.isArray(value2) ? value2 : [value2]) {
      const selector = indexedKey(item, indexKey);
      if (selector === void 0 || isRemoved(item))
        continue;
      visited = true;
      const record = recordOf(item);
      const wrapped = record?.["value"];
      visitStructuredOriginPaths(wrapped === void 0 ? item : wrapped, field.fields, [...path, selector], visit, wrapped === void 0 ? /* @__PURE__ */ new Set([indexKey, "removed"]) : /* @__PURE__ */ new Set());
    }
    if (!visited)
      visit(path);
    return;
  }
  if (field.cardinality === "append") {
    const values = Array.isArray(value2) ? value2 : [value2];
    if (values.length === 0)
      visit(path);
    else
      values.forEach((item, index) => visitStructuredOriginPaths(item, field.fields, [...path, String(index)], visit));
    return;
  }
  visitStructuredOriginPaths(value2, field.fields, path, visit);
}
function replaceStructuredAuthoringOrigins(tracker, value2, nestedFields, path, ignoredKeys = /* @__PURE__ */ new Set()) {
  if (tracker === void 0)
    return;
  clearAuthoringOrigins(tracker, path);
  visitStructuredOriginPaths(value2, nestedFields, path, (item) => setAuthoringOrigin(tracker, item), ignoredKeys);
}
function mergeAppend(previous, incoming, field, tracker, path = []) {
  const left = Array.isArray(previous) ? previous : previous === void 0 ? [] : [previous];
  const right = Array.isArray(incoming) ? incoming : [incoming];
  right.forEach((item, index) => replaceStructuredAuthoringOrigins(tracker, item, field.fields, [
    ...path,
    String(left.length + index)
  ]));
  return [...left.map(cloneJson), ...right.map(cloneJson)];
}
function mergeIndexed(previous, incoming, field, tracker, path = []) {
  const indexKey = field.indexKey ?? "index";
  const result = Array.isArray(previous) ? previous.map(cloneJson) : [];
  const additions = Array.isArray(incoming) ? incoming : [incoming];
  for (const item of additions) {
    const key2 = indexedKey(item, indexKey);
    if (key2 === void 0)
      continue;
    const found = result.findIndex((candidate) => indexedKey(candidate, indexKey) === key2);
    if (isRemoved(item)) {
      if (tracker !== void 0)
        clearAuthoringOrigins(tracker, [...path, key2]);
      if (found !== -1)
        result.splice(found, 1);
    } else if (found === -1) {
      result.push(cloneJson(item));
      const record = recordOf(item);
      const wrapped = record?.["value"];
      replaceStructuredAuthoringOrigins(tracker, wrapped === void 0 ? item : wrapped, field.fields, [...path, key2], wrapped === void 0 ? /* @__PURE__ */ new Set([indexKey, "removed"]) : /* @__PURE__ */ new Set());
    } else {
      const existing = recordOf(result[found]);
      const replacement = recordOf(item);
      result[found] = existing !== void 0 && replacement !== void 0 && "value" in existing && "value" in replacement ? {
        ...mergeStructured(existing, item, void 0),
        value: mergeStructured(existing["value"], replacement["value"], field.fields, tracker, [...path, key2])
      } : mergeStructured(result[found], item, field.fields, tracker, [...path, key2], /* @__PURE__ */ new Set([indexKey, "removed"]));
    }
  }
  return result;
}
function mergeStructured(previous, incoming, nestedFields, tracker, path = [], ignoredOriginKeys = /* @__PURE__ */ new Set()) {
  const left = previous === void 0 ? void 0 : recordOf(previous);
  const right = recordOf(incoming);
  if (left === void 0 || right === void 0) {
    replaceStructuredAuthoringOrigins(tracker, incoming, nestedFields, path, ignoredOriginKeys);
    return cloneJson(incoming);
  }
  const nested = new Map((nestedFields ?? []).map((child) => [child.fieldId, child]));
  const merged = Object.fromEntries(Object.entries(left).map(([key2, value2]) => [key2, cloneJson(value2)]));
  for (const [key2, value2] of Object.entries(right)) {
    const child = nested.get(key2);
    const childTracker = ignoredOriginKeys.has(key2) ? void 0 : tracker;
    merged[key2] = child === void 0 ? mergeStructured(merged[key2], value2, void 0, childTracker, [...path, key2]) : mergeFieldValue(merged[key2], value2, child, childTracker, [...path, key2]);
  }
  return merged;
}
function mergeFieldValue(previous, incoming, field, tracker, path = []) {
  if (field.cardinality === "append")
    return mergeAppend(previous, incoming, field, tracker, path);
  if (field.cardinality === "indexed")
    return mergeIndexed(previous, incoming, field, tracker, path);
  return mergeStructured(previous, incoming, field.fields, tracker, path);
}
function schemaFields(schema, schemas, diagnostics, visiting = /* @__PURE__ */ new Set()) {
  if (visiting.has(schema.typeId)) {
    diagnostics.push({
      severity: "error",
      code: "common.data/schema-inheritance-cycle",
      message: `schema inheritance cycle includes ${schema.typeId}`,
      typeId: schema.typeId
    });
    return /* @__PURE__ */ new Map();
  }
  const fields = /* @__PURE__ */ new Map();
  if (schema.parentTypeId !== void 0) {
    const parent = schemas.get(schema.parentTypeId);
    if (parent === void 0) {
      diagnostics.push({
        severity: "error",
        code: "common.data/schema-parent-unavailable",
        message: `${schema.typeId} names unavailable schema parent ${schema.parentTypeId}`,
        typeId: schema.typeId
      });
    } else {
      const next = new Set(visiting);
      next.add(schema.typeId);
      for (const [fieldId, field] of schemaFields(parent, schemas, diagnostics, next)) {
        fields.set(fieldId, field);
      }
    }
  }
  for (const field of schema.fields)
    fields.set(field.fieldId, field);
  return fields;
}
function mergeFields(base, patch, fields) {
  const merged = Object.fromEntries(Object.entries(base).map(([key2, value2]) => [key2, cloneJson(value2)]));
  for (const [fieldId, incoming] of Object.entries(patch)) {
    const field = fields.get(fieldId);
    if (field === void 0)
      continue;
    merged[fieldId] = mergeFieldValue(merged[fieldId], incoming, field);
  }
  return merged;
}
function knownFields(patch, fields) {
  const known = {};
  for (const [fieldId, value2] of Object.entries(patch))
    if (fields.has(fieldId))
      known[fieldId] = value2;
  return known;
}
function relationScalarValues(value2) {
  if (typeof value2 === "string" || typeof value2 === "number")
    return [String(value2)];
  if (Array.isArray(value2))
    return value2.flatMap(relationScalarValues);
  const record = recordOf(value2);
  if (record === void 0)
    return [];
  return record["value"] === void 0 ? [] : relationScalarValues(record["value"]);
}
function visitRelationField(value2, field, path, visit) {
  if (Array.isArray(value2) && (field.cardinality === "indexed" || field.cardinality === "append")) {
    value2.forEach((item, ordinal) => {
      const record = recordOf(item);
      const indexKey = field.indexKey ?? "index";
      const explicitIndex = field.cardinality === "indexed" ? record?.[indexKey] : void 0;
      const selector = typeof explicitIndex === "string" || typeof explicitIndex === "number" ? String(explicitIndex) : String(ordinal);
      visitRelationField(item, { ...field, cardinality: "scalar" }, `${path}.${selector}`, visit);
    });
    return;
  }
  if (field.linkNamespace !== void 0 && field.linkNamespace !== "") {
    for (const entityId of relationScalarValues(value2)) {
      if (entityId.length > 0)
        visit(field.linkNamespace, entityId, path);
    }
  }
  if (field.fields === void 0)
    return;
  const values = Array.isArray(value2) ? value2 : [value2];
  for (const item of values) {
    const record = recordOf(item);
    if (record === void 0)
      continue;
    const wrapped = record["value"];
    const nested = wrapped === void 0 ? record : recordOf(wrapped) ?? record;
    for (const child of field.fields) {
      const childValue = nested[child.fieldId];
      if (childValue === void 0)
        continue;
      visitRelationField(childValue, child, `${path}.${child.fieldId}`, visit);
    }
  }
}
var immutableToken = (token) => Object.freeze({ ...token });
function resolveDataCatalog(input) {
  const maxEntities = positiveLimit2(input.maxEntities, "maxEntities");
  const maxDepth = positiveLimit2(input.maxDepth, "maxDepth");
  if (input.patches.length > maxEntities) {
    throw new TypeError(`patches exceeds maxEntities (${input.patches.length} > ${maxEntities})`);
  }
  const extended = input.includeWorkspaceFacets === true;
  const diagnostics = [...extended ? input.diagnostics ?? [] : []];
  const schemas = /* @__PURE__ */ new Map();
  for (const schema of input.schemas) {
    if (schemas.has(schema.typeId)) {
      diagnostics.push({
        severity: "error",
        code: "common.data/schema-type-duplicate",
        message: `catalog schema type is duplicated: ${schema.typeId}`,
        typeId: schema.typeId
      });
    } else {
      schemas.set(schema.typeId, schema);
    }
  }
  const fieldsByType = /* @__PURE__ */ new Map();
  for (const schema of schemas.values()) {
    fieldsByType.set(schema.typeId, schemaFields(schema, schemas, diagnostics));
  }
  const entities = /* @__PURE__ */ new Map();
  const unknownFields = /* @__PURE__ */ new Set();
  for (const patch of input.patches) {
    const typeFields = fieldsByType.get(patch.typeId);
    if (typeFields === void 0) {
      diagnostics.push({
        severity: "warning",
        code: "common.data/schema-type-unsupported",
        message: `no catalog schema is available for ${patch.typeId}`,
        namespace: patch.namespace,
        typeId: patch.typeId,
        entityId: patch.entityId,
        source: patch.source
      });
      continue;
    }
    const key2 = entityKey(patch.namespace, patch.entityId);
    let current = entities.get(key2);
    if (current === void 0) {
      current = {
        namespace: patch.namespace,
        entityId: patch.entityId,
        typeId: patch.typeId,
        ...patch.parentEntityId === void 0 ? {} : { parentEntityId: patch.parentEntityId },
        defaultTemplate: false,
        tokens: /* @__PURE__ */ new Map(),
        fields: {},
        fieldSources: {},
        sources: []
      };
      entities.set(key2, current);
    } else if (current.typeId !== patch.typeId) {
      diagnostics.push({
        severity: "error",
        code: "common.data/entity-type-conflict",
        message: `${patch.namespace}/${patch.entityId} changes type from ${current.typeId} to ${patch.typeId}`,
        namespace: patch.namespace,
        typeId: patch.typeId,
        entityId: patch.entityId,
        source: patch.source
      });
      continue;
    }
    if (patch.parentEntityId !== void 0)
      current.parentEntityId = patch.parentEntityId;
    if (patch.defaultTemplate !== void 0)
      current.defaultTemplate = patch.defaultTemplate;
    for (const token of patch.tokens ?? [])
      current.tokens.set(token.id, immutableToken(token));
    current.sources.push(patch.source);
    for (const fieldId of Object.keys(patch.fields)) {
      if (typeFields.has(fieldId)) {
        current.fieldSources[fieldId] = patch.source;
        continue;
      }
      const diagnosticKey = `${patch.typeId}\0${fieldId}`;
      if (unknownFields.has(diagnosticKey))
        continue;
      unknownFields.add(diagnosticKey);
      diagnostics.push({
        severity: "information",
        code: "common.data/schema-field-unsupported",
        message: `${patch.typeId}.${fieldId} is outside the active schema slice`,
        namespace: patch.namespace,
        typeId: patch.typeId,
        entityId: patch.entityId,
        fieldId,
        source: patch.source
      });
    }
    current.fields = input.patchesResolved === true && current.sources.length === 1 ? knownFields(patch.fields, typeFields) : mergeFields(current.fields, patch.fields, typeFields);
  }
  const resolvedCache = /* @__PURE__ */ new Map();
  const resolveEntity = (ref, depth, path) => {
    const key2 = entityKey(ref.namespace, ref.entityId);
    const cached = resolvedCache.get(key2);
    if (cached !== void 0)
      return cached;
    const current = entities.get(key2);
    if (current === void 0)
      return void 0;
    if (depth > maxDepth) {
      diagnostics.push({
        severity: "error",
        code: "common.data/entity-inheritance-depth-exceeded",
        message: `${ref.namespace}/${ref.entityId} exceeds inheritance depth ${maxDepth}`,
        namespace: ref.namespace,
        typeId: current.typeId,
        entityId: ref.entityId,
        chain: [...path, ref]
      });
      return void 0;
    }
    const cycleAt = path.findIndex((item) => entityKey(item.namespace, item.entityId) === key2);
    if (cycleAt !== -1) {
      diagnostics.push({
        severity: "error",
        code: "common.data/entity-inheritance-cycle",
        message: `entity inheritance cycle includes ${ref.namespace}/${ref.entityId}`,
        namespace: ref.namespace,
        typeId: current.typeId,
        entityId: ref.entityId,
        chain: [...path.slice(cycleAt), ref]
      });
      return void 0;
    }
    let complete = true;
    let fields = {};
    let fieldSources = {};
    let inheritanceChain = [];
    let sources = [];
    let tokens = /* @__PURE__ */ new Map();
    if (current.parentEntityId !== void 0) {
      const parentRef = { namespace: current.namespace, entityId: current.parentEntityId };
      const parent = resolveEntity(parentRef, depth + 1, [...path, ref]);
      if (parent === void 0) {
        complete = false;
        diagnostics.push({
          severity: "error",
          code: "common.data/entity-parent-unavailable",
          message: `${current.namespace}/${current.entityId} names unavailable parent ${current.parentEntityId}`,
          namespace: current.namespace,
          typeId: current.typeId,
          entityId: current.entityId,
          chain: [...path, ref, parentRef]
        });
      } else {
        complete = parent.complete;
        fields = Object.fromEntries(Object.entries(parent.fields).map(([fieldId, value2]) => [fieldId, cloneJson(value2)]));
        fieldSources = Object.fromEntries(Object.entries(parent.fieldSources ?? {}).map(([fieldId, source]) => [
          fieldId,
          immutableSource2(source)
        ]));
        inheritanceChain = [...parent.inheritanceChain];
        sources = [...parent.sources];
        for (const token of parent.tokens ?? [])
          tokens.set(token.id, token);
      }
    }
    for (const [id, token] of current.tokens)
      tokens.set(id, token);
    fields = current.parentEntityId === void 0 ? current.fields : mergeFields(fields, current.fields, fieldsByType.get(current.typeId) ?? /* @__PURE__ */ new Map());
    for (const [fieldId, source] of Object.entries(current.fieldSources)) {
      fieldSources[fieldId] = source;
    }
    inheritanceChain.push(ref);
    sources.push(...current.sources);
    const resolved = Object.freeze({
      namespace: current.namespace,
      typeId: current.typeId,
      entityId: current.entityId,
      ...current.parentEntityId === void 0 ? {} : { parentEntityId: current.parentEntityId },
      ...current.defaultTemplate ? { defaultTemplate: true } : {},
      ...tokens.size === 0 ? {} : {
        tokens: Object.freeze([...tokens.values()].sort((left, right) => left.id.localeCompare(right.id)))
      },
      inheritanceChain: Object.freeze(inheritanceChain.map(immutableRef)),
      fields: Object.freeze(Object.fromEntries(Object.entries(fields).map(([fieldId, value2]) => [fieldId, immutableJson(value2)]))),
      ...input.includeFieldSources === true ? {
        fieldSources: Object.freeze(Object.fromEntries(Object.entries(fieldSources).map(([fieldId, source]) => [
          fieldId,
          immutableSource2(source)
        ])))
      } : {},
      sources: Object.freeze(sources.map(immutableSource2)),
      complete
    });
    resolvedCache.set(key2, resolved);
    return resolved;
  };
  const definitions = [];
  if (extended) {
    for (const current of entities.values()) {
      const entity = resolveEntity({ namespace: current.namespace, entityId: current.entityId }, 0, []);
      if (entity !== void 0)
        definitions.push(entity);
    }
    definitions.sort((left, right) => left.namespace.localeCompare(right.namespace) || left.entityId.localeCompare(right.entityId));
  }
  const results = [];
  for (const query of input.queries) {
    const entity = resolveEntity(query, 0, []);
    if (entity === void 0) {
      diagnostics.push({
        severity: "error",
        code: "common.data/entity-query-unresolved",
        message: `catalog query did not resolve ${query.namespace}/${query.entityId}`,
        namespace: query.namespace,
        entityId: query.entityId
      });
    } else {
      results.push(entity);
    }
  }
  const resolvedKeys = new Set(definitions.map((item) => entityKey(item.namespace, item.entityId)));
  const relationKeys = /* @__PURE__ */ new Set();
  const relations = [];
  for (const entity of extended ? definitions : []) {
    const fields = fieldsByType.get(entity.typeId) ?? /* @__PURE__ */ new Map();
    for (const [fieldId, value2] of Object.entries(entity.fields)) {
      const field = fields.get(fieldId);
      if (field === void 0)
        continue;
      visitRelationField(value2, field, fieldId, (namespace, entityId, role) => {
        const key2 = `${entity.namespace}\0${entity.entityId}\0${namespace}\0${entityId}\0${role}`;
        if (relationKeys.has(key2))
          return;
        relationKeys.add(key2);
        const dead = !resolvedKeys.has(entityKey(namespace, entityId));
        const relation = Object.freeze({
          from: immutableRef({ namespace: entity.namespace, entityId: entity.entityId }),
          to: immutableRef({ namespace, entityId }),
          role,
          dead,
          ...entity.sources.at(-1) === void 0 ? {} : { source: immutableSource2(entity.sources.at(-1)) }
        });
        relations.push(relation);
        if (dead) {
          diagnostics.push({
            severity: "warning",
            code: "common.data/relation-target-unavailable",
            message: `${entity.namespace}/${entity.entityId} ${role} names unavailable ${namespace}/${entityId}`,
            namespace: entity.namespace,
            typeId: entity.typeId,
            entityId: entity.entityId,
            fieldId: role,
            ...relation.source === void 0 ? {} : { source: relation.source }
          });
        }
      });
    }
  }
  relations.sort((left, right) => left.from.namespace.localeCompare(right.from.namespace) || left.from.entityId.localeCompare(right.from.entityId) || left.role.localeCompare(right.role) || left.to.namespace.localeCompare(right.to.namespace) || left.to.entityId.localeCompare(right.to.entityId));
  const localizationPatches = extended ? input.localizationPatches ?? [] : [];
  const localePreferences = input.localePreferences ?? [];
  const localizedByLocale = /* @__PURE__ */ new Map();
  for (const patch of localizationPatches) {
    let entries = localizedByLocale.get(patch.locale);
    if (entries === void 0) {
      entries = /* @__PURE__ */ new Map();
      localizedByLocale.set(patch.locale, entries);
    }
    if (!entries.has(patch.key))
      entries.set(patch.key, patch);
  }
  const requestedLocales = localePreferences.length > 0 ? localePreferences : [...localizedByLocale.keys()];
  const localizedStrings = [];
  for (const key2 of [...new Set(extended ? input.localizationKeys ?? [] : [])].sort()) {
    let found;
    let resolvedLocale;
    for (const locale of requestedLocales) {
      const candidate = localizedByLocale.get(locale)?.get(key2);
      if (candidate === void 0)
        continue;
      found = candidate;
      resolvedLocale = locale;
      break;
    }
    if (found === void 0 || resolvedLocale === void 0) {
      diagnostics.push({
        severity: "warning",
        code: "common.data/localization-key-unavailable",
        message: `no requested locale resolves localization key ${key2}`,
        fieldId: key2
      });
      continue;
    }
    const requestedLocale = requestedLocales[0] ?? resolvedLocale;
    localizedStrings.push(Object.freeze({
      key: key2,
      requestedLocale,
      resolvedLocale,
      value: found.value,
      source: immutableSource2(found.source),
      fallback: resolvedLocale !== requestedLocale
    }));
    if (resolvedLocale !== requestedLocale) {
      diagnostics.push({
        severity: "information",
        code: "common.data/localization-fallback",
        message: `${key2} fell back from ${requestedLocale} to ${resolvedLocale}`,
        fieldId: key2,
        source: found.source
      });
    }
  }
  const namespaceCounts = /* @__PURE__ */ new Map();
  for (const entity of entities.values()) {
    namespaceCounts.set(entity.namespace, (namespaceCounts.get(entity.namespace) ?? 0) + 1);
  }
  const immutableDiagnostics = Object.freeze(diagnostics.map(immutableDiagnostic2));
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    gameId: input.gameId,
    analyzerId: input.analyzerId,
    typeIds: Object.freeze([...schemas.keys()].sort()),
    namespaces: Object.freeze([...namespaceCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([namespace, entityCount]) => Object.freeze({ namespace, entityCount }))),
    entityCount: entities.size,
    patchCount: input.patches.length,
    entities: Object.freeze(results),
    diagnostics: immutableDiagnostics,
    ...input.ownerMetadata === void 0 ? {} : { ownerMetadata: immutableJson(input.ownerMetadata) },
    ...extended ? {
      schemas: Object.freeze(input.schemas.map(immutableSchema)),
      definitions: Object.freeze(definitions),
      relations: Object.freeze(relations),
      localizedStrings: Object.freeze(localizedStrings),
      snapshotId: input.snapshotId ?? `${input.gameId}:${input.workspaceId}:${input.patches.length}:${localizationPatches.length}`,
      ...input.projectionPlan === void 0 ? {} : { projectionPlan: input.projectionPlan },
      ...input.projectionReceipt === void 0 ? {} : { projectionReceipt: input.projectionReceipt }
    } : {},
    complete: immutableDiagnostics.every((item) => item.severity !== "error") && results.every((item) => item.complete)
  });
}

// ../../MODDING/modkit-core/packages/sdk/dist/maps/index.js
var MAP_SEMANTIC_ANALYSIS_CONTRACT = "common.map/semantic-analysis";
var RESOLVED_MAP_WORKSPACE_CONTRACT = "common.map/resolved-workspace";
var MAP_PREVIEW_PREPARATION_CONTRACT = "common.map/preview-preparation";
var NATIVE_MAP_ENCODER_CONTRACT = "common.map/native-encoder";
var WORLD_SCENE_SOURCE_CONTRACT = "common.view/world-scene-source";
var MAP_LAYERS_OPERATION = "map.layers";
var MAP_LAYER_READ_OPERATION = "map.layer-read";
var MAP_LAYER_WRITE_OPERATION = "map.layer-write";
var MAP_LAYERS_REPRESENTATION = /* @__PURE__ */ Object.freeze({
  id: "map-layers",
  contract: "common.map/layers",
  major: 1
});
var sampleX = {
  type: "integer",
  minimum: 0,
  description: "Column of the first sample, counted from the west edge."
};
var sampleY = {
  type: "integer",
  minimum: 0,
  description: "Row of the first sample, counted from the north edge (row 0)."
};
var windowWidth = {
  type: "integer",
  minimum: 1,
  description: "Columns in the window; x + width stays within the layer."
};
var windowHeight = {
  type: "integer",
  minimum: 1,
  description: "Rows in the window; y + height stays within the layer."
};
var layerId = {
  type: "string",
  minLength: 1,
  description: "A layer id from map.layers of the same subject revision."
};
var anyNamed = (...names) => ({ anyOf: names.map((name) => ({ required: [name] })) });
var MAP_LAYERS_INPUT_SCHEMA = /* @__PURE__ */ Object.freeze({
  $ref: "modkit://map/layers.v1",
  document: {
    $id: "modkit://map/layers.v1",
    description: "Lists the grid layers of a map. Each layer names its size, integer sample bounds, whether it is editable, and optionally what a sample means in the world: world value = valueOffset + sample * valueScale, in unit, sampled at grid vertices or in cells; a layer of classes may carry a legend (categories: value, label, colour). pictures lists images the codec draws itself, rendered by view.render with { layer: id }.",
    anyOf: [{ type: "null" }, { type: "object", properties: {}, additionalProperties: false }]
  }
});
var MAP_LAYER_READ_INPUT_SCHEMA = /* @__PURE__ */ Object.freeze({
  $ref: "modkit://map/layer-read.v1",
  document: {
    $id: "modkit://map/layer-read.v1",
    description: "Reads a layer as row-major integer samples, row 0 at the north edge. Without x, y, width and height the whole layer is read; a window names all four. World value = valueOffset + sample * valueScale from map.layers.",
    type: "object",
    required: ["layer"],
    additionalProperties: false,
    properties: {
      layer: layerId,
      x: sampleX,
      y: sampleY,
      width: windowWidth,
      height: windowHeight
    },
    anyOf: [
      { not: /* @__PURE__ */ anyNamed("x", "y", "width", "height") },
      { required: ["x", "y", "width", "height"] }
    ]
  }
});
var MAP_LAYER_WRITE_INPUT_SCHEMA = /* @__PURE__ */ Object.freeze({
  $ref: "modkit://map/layer-write.v1",
  document: {
    $id: "modkit://map/layer-write.v1",
    description: "Plans writing width x height integer samples, row-major, row 0 at the north edge, into an editable layer. x and y place the window and go together; without them the grid is the whole layer. Every value stays within the layer's minimum and maximum; world value = valueOffset + sample * valueScale. expectedSourceRevision, when given, must be the subject revision the samples were read from.",
    type: "object",
    required: ["layer", "width", "height", "values"],
    additionalProperties: false,
    properties: {
      layer: layerId,
      x: sampleX,
      y: sampleY,
      width: windowWidth,
      height: windowHeight,
      values: {
        type: "array",
        minItems: 1,
        items: { type: "integer", minimum: 0, maximum: 65535 },
        description: "width * height samples, row-major, within the layer's minimum and maximum."
      },
      expectedSourceRevision: { type: "string", minLength: 1, description: "Revision the window was read from." }
    },
    anyOf: [{ required: ["x", "y"] }, { not: /* @__PURE__ */ anyNamed("x", "y") }]
  }
});
function mapLayerWindow(layer, input) {
  const fail = (message) => {
    throw new RangeError(`map layer ${layer.id}: ${message}`);
  };
  if (input.layer !== layer.id)
    fail(`request names layer ${String(input.layer)}`);
  const grid = "values" in input;
  const given = ["x", "y", "width", "height"].filter((name) => input[name] !== void 0);
  if (grid ? input.x === void 0 !== (input.y === void 0) : given.length !== 0 && given.length !== 4) {
    fail(grid ? "x and y go together" : "a window needs all of x, y, width and height");
  }
  const number = (value2, name, minimum) => {
    if (!Number.isSafeInteger(value2) || value2 < minimum)
      fail(`${name} must be an integer of at least ${minimum}`);
    return value2;
  };
  const whole = !grid && given.length === 0;
  const window = Object.freeze({
    x: whole ? 0 : number(input.x ?? 0, "x", 0),
    y: whole ? 0 : number(input.y ?? 0, "y", 0),
    width: whole ? layer.width : number(input.width, "width", 1),
    height: whole ? layer.height : number(input.height, "height", 1)
  });
  if (window.x + window.width > layer.width || window.y + window.height > layer.height) {
    fail(`window ${window.x},${window.y} ${window.width}x${window.height} leaves the ${layer.width}x${layer.height} layer`);
  }
  if (!grid)
    return window;
  if (!layer.editable)
    fail("the layer is read-only");
  const values = input.values;
  if (!Array.isArray(values) || values.length !== window.width * window.height) {
    fail(`a ${window.width}x${window.height} grid needs ${window.width * window.height} values`);
  }
  for (const [index, value2] of values.entries()) {
    if (!Number.isSafeInteger(value2) || value2 < layer.minimum || value2 > layer.maximum) {
      fail(`value ${index} must be an integer from ${layer.minimum} to ${layer.maximum}`);
    }
  }
  return window;
}
var MAP_SEMANTIC_MATCHER_PROFILE = "modkit/map-semantic-matcher";
var MAP_PREVIEW_PREPARATION_MATCHER_PROFILE = "modkit/map-preview-preparation-matcher";
var NATIVE_MAP_ENCODER_MATCHER_PROFILE = "modkit/native-map-encoder-matcher";
function transformTerrainUv(uv, transform) {
  const x = (uv[0] - 0.5) * transform.scale[0];
  const y = (uv[1] - 0.5) * transform.scale[1];
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return [
    0.5 + x * cosine - y * sine + transform.offset[0],
    0.5 + x * sine + y * cosine + transform.offset[1]
  ];
}
function terrainUvTransformFromOrigin(transform) {
  const x = 0.5 * transform.scale[0];
  const y = 0.5 * transform.scale[1];
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return Object.freeze({
    offset: Object.freeze([
      transform.offset[0] - 0.5 + x * cosine - y * sine,
      transform.offset[1] - 0.5 + x * sine + y * cosine
    ]),
    scale: Object.freeze([transform.scale[0], transform.scale[1]]),
    rotation: transform.rotation
  });
}
function mapQualificationTupleBytes(tuples) {
  const view = new DataView(new ArrayBuffer(tuples.length * 24));
  tuples.forEach((tuple, index) => {
    for (let axis = 0; axis < 3; axis += 1)
      view.setFloat64(index * 24 + axis * 8, tuple[axis] ?? Number.NaN, true);
  });
  return new Uint8Array(view.buffer);
}
function worldModelRequiredBytes(result) {
  let required;
  for (const item of result.diagnostics) {
    const named = item.data?.requiredBytes;
    if (item.code === "x3.host/model-resource-too-large" && typeof named === "number")
      required = named;
    else if (item.code === "x3.host/resource-budget-exceeded" && result.state === "converted")
      required = result.uvmBytes?.byteLength ?? required;
  }
  return required !== void 0 && Number.isSafeInteger(required) && required > 0 ? required : void 0;
}

// ../../MODDING/modkit-core/packages/sdk/dist/runtime-abi.js
function contributionSettingsFor(settings, sourceUri) {
  if (settings === void 0)
    return Object.freeze({});
  const override = sourceUri === void 0 ? void 0 : settings.bySource?.[sourceUri];
  return Object.freeze(override === void 0 ? { ...settings.values } : { ...settings.values, ...override });
}

// ../../MODDING/modkit-core/packages/sdk/dist/manifest/patterns.js
function normalize(path) {
  return path.startsWith("./") ? path.slice(2) : path;
}
function validateContributionPattern(pattern) {
  const diagnostics = [];
  const bad = (message) => diagnostics.push(diagnostic("error", "x3.sdk/invalid-contribution-pattern", message, [pattern]));
  if (pattern.trim().length === 0)
    bad("empty pattern");
  if (/^([/\\]|[A-Za-z]:)/.test(pattern))
    bad("absolute paths are forbidden");
  if (pattern.includes("\\"))
    bad("use forward slashes");
  if (pattern.split("/").includes(".."))
    bad("`..` segments are forbidden");
  if (pattern.includes("**"))
    bad("recursive `**` is forbidden");
  const stars = pattern.split("*").length - 1;
  if (stars > 1)
    bad("at most one shallow `*` is allowed");
  return diagnostics;
}
function toRegExp(pattern) {
  const escaped = normalize(pattern).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${escaped}$`);
}
function expandContributionManifests(patterns, files) {
  const diagnostics = [];
  for (const pattern of patterns)
    diagnostics.push(...validateContributionPattern(pattern));
  if (diagnostics.length > 0)
    return { entries: [], diagnostics };
  const normalizedFiles = files.map(normalize);
  const regexes = patterns.map(toRegExp);
  const entries = [];
  for (const file of normalizedFiles) {
    const matched = [];
    for (let i = 0; i < patterns.length; i += 1) {
      if (regexes[i].test(file))
        matched.push(patterns[i]);
    }
    if (matched.length > 1) {
      diagnostics.push(diagnostic("error", "x3.sdk/duplicate-pattern-match", `\xAB${file}\xBB matches ${matched.length} declarations`, [file], { patterns: matched }));
    } else if (matched.length === 1) {
      entries.push({ pattern: matched[0], path: file });
    } else if (file.endsWith("/contribution.manifest.json")) {
      diagnostics.push(diagnostic("error", "x3.sdk/orphan-contribution-manifest", `\xAB${file}\xBB is not covered by any contributionManifests declaration`, [file]));
    }
  }
  for (const pattern of patterns) {
    if (!entries.some((entry) => entry.pattern === pattern)) {
      diagnostics.push(diagnostic("error", "x3.sdk/pattern-without-matches", `\xAB${pattern}\xBB matched no files (optional groups do not exist in v1)`, [pattern]));
    }
  }
  entries.sort((a, b) => compareUtf8(a.path, b.path));
  return { entries, diagnostics };
}

// ../../MODDING/modkit-core/packages/sdk/dist/manifest/normalize.js
function isRecord(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2);
}
function patternDiagnostics(manifest) {
  return manifest.contributionManifests.flatMap(validateContributionPattern);
}
function rangeDiagnostics(manifest) {
  const out = [];
  manifest.dependsOn?.forEach((requirement, index) => {
    if (requirement.range === void 0)
      return;
    if (parseVersionRange(requirement.range) === void 0) {
      out.push(diagnostic("error", "x3.sdk/invalid-version-range", `\xAB${requirement.range}\xBB is not a range this resolver can evaluate (MK3/23 \xA74 subset)`, ["dependsOn", index, "range"]));
    }
  });
  return out;
}
function exactVersionDiagnostics(manifest) {
  return parseSemver(manifest.version) === void 0 ? [
    diagnostic("error", "x3.sdk/invalid-extension-version", "extension version must be an exactly evaluable SemVer with safe numeric components", ["version"])
  ] : [];
}
function splitExtensionCoordinate(coordinate) {
  const separator = coordinate.indexOf("/");
  return {
    publisher: coordinate.slice(0, separator),
    id: coordinate.slice(separator + 1)
  };
}
function normalizeExtensionIdentityParts(publisher, id) {
  return splitExtensionCoordinate(normalizeModkitIdentifier(`${publisher}/${id}`));
}
function normalizeExtensionManifestIdentities(manifest) {
  const identity = normalizeExtensionIdentityParts(manifest.publisher, manifest.id);
  return snapshotJsonWireObject({
    ...manifest,
    publisher: identity.publisher,
    id: identity.id,
    ...manifest.presentation === void 0 ? {} : {
      presentation: {
        ...manifest.presentation,
        ...manifest.presentation.games === void 0 ? {} : {
          games: manifest.presentation.games.map((game) => ({
            ...game,
            id: normalizeModkitIdentifier(game.id)
          }))
        }
      }
    },
    ...manifest.dependsOn === void 0 ? {} : {
      dependsOn: manifest.dependsOn.map((requirement) => ({
        ...requirement,
        extension: normalizeModkitIdentifier(requirement.extension)
      }))
    }
  });
}
var normalizedManifests = /* @__PURE__ */ new Map();
var NORMALIZED_MANIFEST_CACHE_LIMIT = 256;
async function normalizeExtensionManifest(input) {
  let cacheKey;
  try {
    cacheKey = JSON.stringify(input);
  } catch {
    cacheKey = void 0;
  }
  if (cacheKey !== void 0) {
    const cached = normalizedManifests.get(cacheKey);
    if (cached !== void 0)
      return cached;
  }
  const result = await normalizeExtensionManifestUncached(input);
  if (cacheKey !== void 0) {
    if (normalizedManifests.size >= NORMALIZED_MANIFEST_CACHE_LIMIT) {
      const oldest = normalizedManifests.keys().next();
      if (!oldest.done)
        normalizedManifests.delete(oldest.value);
    }
    normalizedManifests.set(cacheKey, result);
  }
  return result;
}
async function normalizeExtensionManifestUncached(input) {
  let packageInput;
  let standaloneInput;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const key2 of Object.keys(descriptors)) {
      if (key2 !== "packageJson" && key2 !== "standalone") {
        throw new TypeError(`unknown authored-container field: ${key2}`);
      }
      const descriptor = descriptors[key2];
      if (descriptor === void 0 || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`authored-container field ${key2} must be inert data`);
      }
    }
    const packageValue = descriptors["packageJson"]?.value;
    const standaloneValue = descriptors["standalone"]?.value;
    packageInput = packageValue === void 0 ? void 0 : snapshotJsonWireData(packageValue);
    standaloneInput = standaloneValue === void 0 ? void 0 : snapshotJsonWireData(standaloneValue);
  } catch (error) {
    return {
      diagnostics: [
        diagnostic("error", "x3.sdk/non-json-authored-container", `authored container must be inert JSON data: ${error instanceof Error ? error.message : String(error)}`)
      ]
    };
  }
  const packageJson = isRecord(packageInput) ? packageInput : void 0;
  const block = packageJson !== void 0 && isRecord(packageJson["modkit"]) ? packageJson["modkit"] : void 0;
  const hasBlock = block !== void 0;
  const hasStandalone = standaloneInput !== void 0;
  if (hasBlock && hasStandalone) {
    return {
      diagnostics: [
        diagnostic("error", "x3.sdk/two-authored-containers", "both package.json#modkit and modkit.extension.json exist \u2014 exactly one authored container per artifact (packaging error)")
      ]
    };
  }
  if (!hasBlock && !hasStandalone) {
    return {
      diagnostics: [
        diagnostic("error", "x3.sdk/no-authored-container", "neither package.json#modkit nor modkit.extension.json found")
      ]
    };
  }
  if (hasStandalone) {
    const diagnostics2 = await validateWithSchema(extensionManifestSchema, standaloneInput);
    if (hasErrors(diagnostics2))
      return { container: "standalone", diagnostics: diagnostics2 };
    const manifest2 = normalizeExtensionManifestIdentities(standaloneInput);
    const all2 = [
      ...diagnostics2,
      ...await validateWithSchema(extensionManifestSchema, manifest2),
      ...exactVersionDiagnostics(manifest2),
      ...patternDiagnostics(manifest2),
      ...rangeDiagnostics(manifest2)
    ];
    return hasErrors(all2) ? { container: "standalone", diagnostics: all2 } : { container: "standalone", manifest: manifest2, diagnostics: all2 };
  }
  const diagnostics = [];
  const blockRecord = block;
  for (const field of ["version", "license"]) {
    if (field in blockRecord) {
      diagnostics.push(diagnostic("error", "x3.sdk/npm-field-duplicated-in-block", `\xAB${field}\xBB belongs to the top-level package.json only (Q76 packaging error)`, ["modkit", field]));
    }
  }
  diagnostics.push(...await validateWithSchema(modkitBlockSchema, blockRecord));
  const version = packageJson["version"];
  if (typeof version !== "string" || parseSemver(version) === void 0) {
    diagnostics.push(diagnostic("error", "x3.sdk/invalid-npm-version", "package.json must carry a valid SemVer `version` (inherited into the normalized manifest)", ["version"]));
  }
  const license = packageJson["license"];
  if (typeof license !== "string" || license.length === 0) {
    diagnostics.push(diagnostic("error", "x3.sdk/invalid-npm-license", "package.json must carry a non-empty `license` (inherited into the normalized manifest)", ["license"]));
  }
  if (hasErrors(diagnostics))
    return { container: "package-json", diagnostics };
  const identity = normalizeExtensionIdentityParts(blockRecord["publisher"], blockRecord["id"]);
  const manifest = normalizeExtensionManifestIdentities(snapshotJsonWireObject({
    schemaVersion: 1,
    publisher: identity.publisher,
    id: identity.id,
    version,
    license,
    contributionManifests: blockRecord["contributionManifests"],
    ...blockRecord["dependsOn"] === void 0 ? {} : {
      dependsOn: blockRecord["dependsOn"]
    },
    ...blockRecord["presentation"] === void 0 ? {} : {
      presentation: blockRecord["presentation"]
    },
    ...blockRecord["contentSources"] === void 0 ? {} : { contentSources: blockRecord["contentSources"] },
    ...blockRecord["languageFiles"] === void 0 ? {} : {
      languageFiles: blockRecord["languageFiles"]
    },
    ...blockRecord["credentials"] === void 0 ? {} : {
      credentials: blockRecord["credentials"]
    },
    ...blockRecord["workspaceMarkers"] === void 0 ? {} : { workspaceMarkers: blockRecord["workspaceMarkers"] }
  }));
  const all = [
    ...diagnostics,
    ...await validateWithSchema(extensionManifestSchema, manifest),
    ...exactVersionDiagnostics(manifest),
    ...patternDiagnostics(manifest),
    ...rangeDiagnostics(manifest)
  ];
  return hasErrors(all) ? { container: "package-json", diagnostics: all } : { container: "package-json", manifest, diagnostics: all };
}

// ../../MODDING/modkit-core/packages/sdk/dist/asset-capabilities/data-source-surfaces.js
var ENCODED_MEDIA_SURFACE_ID = "common.view/encoded-media";
var ENCODED_MEDIA = Object.freeze({
  contract: contractId(ENCODED_MEDIA_SURFACE_ID),
  major: 1
});
var sig = { signal: "last" };
var value = { kind: "value" };
var cancellableValue = { kind: "value", ...sig };
var iterable = { kind: "iterable", ...sig };
var encodedMediaSurface = {
  methods: {
    descriptor: value,
    read: cancellableValue
  }
};
var textDataSourceSurface = {
  methods: {
    info: value,
    slice: cancellableValue,
    search: iterable
  }
};
var byteRangeSourceSurface = {
  methods: {
    size: value,
    read: cancellableValue
  }
};
var treeDataSourceSurface = {
  methods: {
    root: value,
    children: cancellableValue,
    facts: value,
    search: iterable
  }
};
var tableDataSourceSurface = {
  methods: {
    shape: value,
    rows: cancellableValue,
    cell: cancellableValue,
    search: iterable
  }
};
var transportSourceSurface = {
  methods: {
    snapshot: cancellableValue,
    /** A live stream, not a finite listing: `subscribe` → `event…` → `done`. */
    events: { kind: "events", ...sig },
    timeline: { kind: "value", optional: true, ...sig }
  }
};
var namespaceEntrySourceSurface = {
  methods: {
    list: cancellableValue,
    children: { kind: "value", optional: true, ...sig },
    readPreamble: { kind: "value", optional: true, ...sig },
    search: { kind: "value", optional: true, ...sig },
    lookup: { kind: "value", optional: true, ...sig },
    nestedContext: { kind: "value", optional: true, ...sig },
    /** `Lease<AssetSourceRef>`: the ref crosses by copy, the lease is a release-only handle. */
    openEntry: { kind: "leased-value", ...sig },
    openEntrySource: {
      kind: "lease",
      result: { contract: contractId("common.view/byte-range-source"), major: 1 },
      wrapper: "lease",
      optional: true,
      ...sig
    }
  }
};
var rasterImageSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", ...sig },
    readRegion: { kind: "value", optional: true, ...sig },
    readCompressed: { kind: "value", optional: true, ...sig }
  }
};
var vectorSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    document: cancellableValue
  }
};
var audioMediaSourceSurface = {
  methods: {
    info: cancellableValue,
    /** `encoded(trackId?, signal?)`: `arity: 1` keeps the signal last when the track is omitted. */
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", arity: 1, ...sig },
    readPcm: { kind: "value", optional: true, ...sig }
  }
};
var videoMediaSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", ...sig },
    readFrame: { kind: "value", optional: true, ...sig }
  }
};
var modelSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    nodes: cancellableValue,
    meshes: cancellableValue,
    primitive: { kind: "value", optional: true, ...sig }
  }
};
var worldSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    page: cancellableValue,
    model: { kind: "value", optional: true, ...sig },
    texture: { kind: "value", optional: true, ...sig },
    refined: { kind: "value", optional: true, ...sig },
    focus: { kind: "value", optional: true, ...sig }
  }
};
var modelResourceRefsSourceSurface = {
  methods: {
    info: cancellableValue,
    references: cancellableValue
  }
};
var modelSkeletonSourceSurface = {
  methods: {
    info: cancellableValue,
    bindings: cancellableValue
  }
};
var modelAnimationSourceSurface = {
  methods: {
    info: cancellableValue,
    clips: cancellableValue
  }
};
var modelCollisionSourceSurface = {
  methods: {
    info: cancellableValue,
    volumes: cancellableValue
  }
};
var modelMaterialSourceSurface = {
  methods: {
    info: cancellableValue,
    materials: cancellableValue
  }
};
var modelSocketSourceSurface = {
  methods: {
    info: cancellableValue,
    sockets: cancellableValue
  }
};
var modelEffectSourceSurface = {
  methods: {
    info: cancellableValue,
    effects: cancellableValue
  }
};
var modelLightSourceSurface = {
  methods: {
    info: cancellableValue,
    lights: cancellableValue
  }
};
var modelCameraSourceSurface = {
  methods: {
    info: cancellableValue,
    cameras: cancellableValue
  }
};
var modelPhysicsSourceSurface = {
  methods: {
    info: cancellableValue,
    bodies: cancellableValue
  }
};
var modelNodeBehaviourSourceSurface = {
  methods: {
    info: cancellableValue,
    behaviours: cancellableValue
  }
};
var modelLodSourceSurface = {
  methods: {
    info: cancellableValue,
    levels: cancellableValue
  }
};
var relationGraphSourceSurface = {
  methods: {
    summary: cancellableValue,
    nodes: cancellableValue,
    edges: cancellableValue
  }
};
var slideDeckSourceSurface = {
  methods: {
    info: cancellableValue,
    slides: cancellableValue
  }
};
var subjectFactsSourceSurface = {
  methods: {
    summary: cancellableValue,
    groups: cancellableValue,
    facts: cancellableValue,
    relations: cancellableValue,
    openModel: {
      kind: "lease",
      result: { contract: contractId("common.view/model-scene-source"), major: 1 },
      wrapper: "lease",
      optional: true,
      ...sig
    },
    openModelMaterials: {
      kind: "lease",
      result: { contract: contractId("common.view/model-material-source"), major: 1 },
      wrapper: "lease",
      optional: true,
      ...sig
    },
    openModelResources: {
      kind: "lease",
      result: { contract: contractId("common.view/model-resource-refs-source"), major: 1 },
      wrapper: "lease",
      optional: true,
      ...sig
    }
  }
};
var subjectCalculationsSourceSurface = {
  methods: {
    summary: cancellableValue,
    calculations: cancellableValue
  }
};
var subjectSelectorSourceSurface = {
  methods: {
    summary: cancellableValue,
    subjects: cancellableValue,
    openFacts: {
      kind: "lease",
      result: { contract: contractId("common.view/subject-facts-source"), major: 1 },
      wrapper: "lease",
      ...sig
    },
    openCalculations: {
      kind: "lease",
      result: { contract: contractId("common.view/subject-calculations-source"), major: 1 },
      wrapper: "lease",
      ...sig
    },
    editTarget: { ...cancellableValue, optional: true },
    isolation: { ...cancellableValue, optional: true },
    isolationPlan: { ...cancellableValue, optional: true }
  }
};
var STANDARD_DATA_SOURCE_SURFACES = deepFreeze({
  "common.view/text-data-source": textDataSourceSurface,
  "common.view/byte-range-source": byteRangeSourceSurface,
  "common.view/tree-data-source": treeDataSourceSurface,
  "common.view/table-data-source": tableDataSourceSurface,
  "common.view/transport-source": transportSourceSurface,
  "common.view/namespace-entry-source": namespaceEntrySourceSurface,
  "common.view/raster-image-source": rasterImageSourceSurface,
  "common.view/vector-scene-source": vectorSceneSourceSurface,
  "common.view/audio-media-source": audioMediaSourceSurface,
  "common.view/video-media-source": videoMediaSourceSurface,
  "common.view/model-scene-source": modelSceneSourceSurface,
  "common.view/world-scene-source": worldSceneSourceSurface,
  "common.view/model-resource-refs-source": modelResourceRefsSourceSurface,
  "common.view/model-skeleton-source": modelSkeletonSourceSurface,
  "common.view/model-animation-source": modelAnimationSourceSurface,
  "common.view/model-collision-source": modelCollisionSourceSurface,
  "common.view/model-material-source": modelMaterialSourceSurface,
  "common.view/model-effect-source": modelEffectSourceSurface,
  "common.view/model-light-source": modelLightSourceSurface,
  "common.view/model-camera-source": modelCameraSourceSurface,
  "common.view/model-physics-source": modelPhysicsSourceSurface,
  "common.view/model-node-behaviour-source": modelNodeBehaviourSourceSurface,
  "common.view/model-lod-source": modelLodSourceSurface,
  "common.view/model-socket-source": modelSocketSourceSurface,
  "common.view/relation-graph-source": relationGraphSourceSurface,
  "common.view/subject-selector-source": subjectSelectorSourceSurface,
  "common.view/subject-facts-source": subjectFactsSourceSurface,
  "common.view/subject-calculations-source": subjectCalculationsSourceSurface,
  "common.view/slide-deck-source": slideDeckSourceSurface
});
var AUXILIARY_DATA_SOURCE_SURFACES = deepFreeze({
  [ENCODED_MEDIA_SURFACE_ID]: encodedMediaSurface
});
function standardDataSourceSurfaceFor(contract, major) {
  if (major !== 1)
    return void 0;
  if (STANDARD_DATA_SOURCE_CONTRACTS.includes(contract)) {
    return STANDARD_DATA_SOURCE_SURFACES[contract];
  }
  if (contract === ENCODED_MEDIA_SURFACE_ID)
    return AUXILIARY_DATA_SOURCE_SURFACES[contract];
  return void 0;
}
var ENCODED_MEDIA_SURFACE_CONTRACT = contractId(ENCODED_MEDIA_SURFACE_ID);

// ../../MODDING/modkit-core/packages/sdk/dist/asset-capabilities/presentation.js
function bindingId(value2) {
  if (!isSegment(value2))
    throw new TypeError(`invalid binding id: ${value2}`);
  return value2;
}
function presentationSlotId(value2) {
  if (!isSegment(value2))
    throw new TypeError(`invalid presentation slot id: ${value2}`);
  return value2;
}
function definePresentationPlan(plan) {
  const stageIds = new Set(plan.slots.filter((slot) => slot.kind === "stage").map((slot) => slot.slotId));
  if (plan.activeStage === void 0) {
    if (plan.fallback === void 0 || plan.fallback.kind !== "fallback" || plan.alternateStages.length !== 0) {
      throw new TypeError("a fallback-only presentation plan cannot declare stage alternates");
    }
    return snapshotJsonWireData(plan);
  }
  if (!stageIds.has(plan.activeStage)) {
    throw new TypeError(`active presentation stage is not declared: ${plan.activeStage}`);
  }
  for (const slotId of plan.alternateStages) {
    if (!stageIds.has(slotId)) {
      throw new TypeError(`alternate presentation stage is not declared: ${slotId}`);
    }
  }
  return snapshotJsonWireData(plan);
}

// ../../MODDING/modkit-core/packages/sdk/dist/asset-capabilities/visual-composition.js
var MIXED_VISUAL_STAGE_ID = presentationSlotId("mixed-visual");
var MIXED_VISUAL_WORLD_BINDING_ID = bindingId("mixed-world");
var MIXED_VISUAL_MODEL_BINDING_ID = bindingId("mixed-model");
function nonEmpty2(value2, label) {
  if (value2.trim().length === 0)
    throw new TypeError(`${label} must not be empty`);
}
function finiteTuple(value2, label, positive = false) {
  if (value2.length !== 3 || value2.some((item) => !Number.isFinite(item) || positive && item <= 0)) {
    throw new TypeError(`${label} must contain three ${positive ? "positive " : ""}finite numbers`);
  }
}
function basis(value2, label) {
  if (value2.unit === "meter") {
    if (value2.sourceUnit !== void 0) {
      throw new TypeError(`${label}.sourceUnit is only valid for source-unit coordinates`);
    }
  } else {
    nonEmpty2(value2.sourceUnit ?? "", `${label}.sourceUnit`);
  }
  if (value2.metersPerUnit !== void 0 && (!Number.isFinite(value2.metersPerUnit) || value2.metersPerUnit <= 0)) {
    throw new TypeError(`${label}.metersPerUnit must be positive and finite`);
  }
  if (value2.unitsPerCell !== void 0 && (!Number.isFinite(value2.unitsPerCell) || value2.unitsPerCell <= 0)) {
    throw new TypeError(`${label}.unitsPerCell must be positive and finite`);
  }
}
function frame(value2, label) {
  nonEmpty2(value2.coordinateSpaceId, `${label}.coordinateSpaceId`);
  basis(value2.basis, `${label}.basis`);
  finiteTuple(value2.origin, `${label}.origin`);
}
function subject(value2, label) {
  nonEmpty2(value2.subjectUri, `${label}.subjectUri`);
  nonEmpty2(value2.revision, `${label}.revision`);
}
function digest(value2, label) {
  if (value2 !== void 0 && !/^sha256:[0-9a-f]{64}$/u.test(value2)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
}
function policy(value2, label) {
  nonEmpty2(value2.provenance.sourceIdentity, `${label}.provenance.sourceIdentity`);
  subject(value2.provenance.subject, `${label}.provenance.subject`);
  nonEmpty2(value2.provenance.originUri, `${label}.provenance.originUri`);
  digest(value2.provenance.contentDigest, `${label}.provenance.contentDigest`);
  if (value2.license.state === "declared")
    nonEmpty2(value2.license.expression, `${label}.license.expression`);
  else
    nonEmpty2(value2.license.reason, `${label}.license.reason`);
  if (value2.redistribution.state === "allowed")
    nonEmpty2(value2.redistribution.basis, `${label}.redistribution.basis`);
  else
    nonEmpty2(value2.redistribution.reason, `${label}.redistribution.reason`);
}
function sameSubject(left, right) {
  return left.subjectUri === right.subjectUri && left.revision === right.revision;
}
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function sameFrame(left, right) {
  return sameJson(left, right);
}
function validateTransform(value2, worldFrame) {
  if (value2.schemaVersion !== 1)
    throw new TypeError("overlay transform schemaVersion must be 1");
  frame(value2.source, "overlay transform source");
  frame(value2.target, "overlay transform target");
  if (!sameFrame(value2.target, worldFrame)) {
    throw new TypeError("overlay transform target must exactly match the workspace world frame");
  }
  const sourceAxes = Object.values(value2.axes).map((item) => item.sourceAxis);
  if (new Set(sourceAxes).size !== 3) {
    throw new TypeError("overlay transform must map each source axis exactly once");
  }
  const indices = sourceAxes.map((axis) => axis === "x" ? 0 : axis === "y" ? 1 : 2);
  let inversions = 0;
  for (let left = 0; left < indices.length; left += 1) {
    for (let right = left + 1; right < indices.length; right += 1) {
      if (indices[left] > indices[right])
        inversions += 1;
    }
  }
  const permutationDirection = inversions % 2 === 0 ? 1 : -1;
  const mappedDirection = permutationDirection * value2.axes.x.direction * value2.axes.y.direction * value2.axes.z.direction;
  const expectedDirection = value2.source.basis.handedness === value2.target.basis.handedness ? 1 : -1;
  if (mappedDirection !== expectedDirection) {
    throw new TypeError("overlay transform axis directions do not preserve the declared handedness");
  }
  finiteTuple(value2.scale, "overlay transform scale", true);
  finiteTuple(value2.translation, "overlay transform translation");
  nonEmpty2(value2.evidence.reference, "overlay transform evidence reference");
  digest(value2.evidence.receiptDigest, "overlay transform evidence receiptDigest");
}
function validateDocument(document) {
  if (document.schemaVersion !== 1)
    throw new TypeError("mixed visual schemaVersion must be 1");
  nonEmpty2(document.workspaceId, "workspaceId");
  frame(document.worldFrame, "worldFrame");
  if (document.sources.length !== 2)
    throw new TypeError("mixed visual workspace needs two sources");
  const world = document.sources.find((source) => source.role === "world-base");
  const model = document.sources.find((source) => source.role === "model-overlay");
  if (world === void 0 || model === void 0) {
    throw new TypeError("mixed visual workspace needs one world source and one model source");
  }
  if (world.originGroup === model.originGroup) {
    throw new TypeError("mixed visual sources must declare different origin groups");
  }
  if (sameSubject(world.subject, model.subject)) {
    throw new TypeError("mixed visual sources must retain two distinct subject snapshots");
  }
  for (const source of document.sources) {
    if (!isSegment(source.sourceId))
      throw new TypeError(`invalid mixed visual source id: ${source.sourceId}`);
    nonEmpty2(source.originGroup, `source ${source.sourceId} originGroup`);
    subject(source.subject, `source ${source.sourceId} subject`);
  }
  if (world.binding.contract !== "common.view/world-scene-source" || world.binding.major !== 1) {
    throw new TypeError("world source must use common.view/world-scene-source@1");
  }
  if (model.binding.contract !== "common.view/model-scene-source" || model.binding.major !== 1) {
    throw new TypeError("model source must use common.view/model-scene-source@1");
  }
  if (!isSegment(world.binding.bindingId) || !isSegment(model.binding.bindingId)) {
    throw new TypeError("mixed visual binding ids must be portable segments");
  }
  if (world.binding.bindingId === model.binding.bindingId) {
    throw new TypeError("mixed visual world/model binding ids must be distinct");
  }
  const sourceIds = new Set(document.sources.map((source) => source.sourceId));
  if (sourceIds.size !== document.sources.length)
    throw new TypeError("mixed visual source ids must be unique");
  const resources = /* @__PURE__ */ new Map();
  for (const resource of document.resources) {
    if (!isSegment(resource.resourceId))
      throw new TypeError(`invalid mixed visual resource id: ${resource.resourceId}`);
    if (resources.has(resource.resourceId))
      throw new TypeError(`duplicate mixed visual resource id: ${resource.resourceId}`);
    const source = document.sources.find((candidate) => candidate.sourceId === resource.sourceId);
    if (source === void 0)
      throw new TypeError(`unknown resource source: ${resource.sourceId}`);
    nonEmpty2(resource.logicalId, `resource ${resource.resourceId} logicalId`);
    if (!sameSubject(resource.provenance.subject, source.subject)) {
      throw new TypeError(`resource ${resource.resourceId} provenance does not match its source snapshot`);
    }
    policy(resource, `resource ${resource.resourceId}`);
    resources.set(resource.resourceId, resource);
  }
  const objects = /* @__PURE__ */ new Map();
  for (const object of document.objects) {
    if (!isSegment(object.objectId))
      throw new TypeError(`invalid mixed visual object id: ${object.objectId}`);
    if (objects.has(object.objectId))
      throw new TypeError(`duplicate mixed visual object id: ${object.objectId}`);
    const source = document.sources.find((candidate) => candidate.sourceId === object.sourceId);
    if (source === void 0)
      throw new TypeError(`unknown object source: ${object.sourceId}`);
    if (source.role !== object.role)
      throw new TypeError(`object ${object.objectId} role does not match its source`);
    if (!sameSubject(object.provenance.subject, source.subject)) {
      throw new TypeError(`object ${object.objectId} provenance does not match its source snapshot`);
    }
    if (new Set(object.resourceIds).size !== object.resourceIds.length) {
      throw new TypeError(`object ${object.objectId} resource ids must be unique`);
    }
    for (const resourceId of object.resourceIds) {
      const resource = resources.get(resourceId);
      if (resource === void 0)
        throw new TypeError(`object ${object.objectId} references unknown resource ${resourceId}`);
      if (resource.sourceId !== object.sourceId) {
        throw new TypeError(`object ${object.objectId} cannot claim a resource from another source`);
      }
    }
    policy(object, `object ${object.objectId}`);
    objects.set(object.objectId, object);
  }
  if (![...objects.values()].some((object) => object.role === "world-base")) {
    throw new TypeError("mixed visual workspace needs a world-base object");
  }
  if (![...objects.values()].some((object) => object.role === "model-overlay")) {
    throw new TypeError("mixed visual workspace needs a model-overlay object");
  }
  const placementIds = /* @__PURE__ */ new Set();
  for (const placement of document.overlayPlacements) {
    if (!isSegment(placement.placementId))
      throw new TypeError(`invalid overlay placement id: ${placement.placementId}`);
    if (placementIds.has(placement.placementId))
      throw new TypeError(`duplicate overlay placement id: ${placement.placementId}`);
    const object = objects.get(placement.objectId);
    if (object?.role !== "model-overlay") {
      throw new TypeError(`overlay placement ${placement.placementId} must reference a model-overlay object`);
    }
    validateTransform(placement.transform, document.worldFrame);
    placementIds.add(placement.placementId);
  }
  const placedObjects = new Set(document.overlayPlacements.map((placement) => placement.objectId));
  for (const object of objects.values()) {
    if (object.role === "model-overlay" && !placedObjects.has(object.objectId)) {
      throw new TypeError(`model-overlay object ${object.objectId} has no separate placement`);
    }
  }
  if (document.compatibility.mode !== "visual-only" || document.compatibility.definitionCompatible !== false || document.compatibility.runtimeCompatible !== false || document.compatibility.nativeExportable !== false) {
    throw new TypeError("mixed visual compatibility must remain visual-only");
  }
  if (document.compatibility.reasons.length < 3 || document.compatibility.reasons.some((reason) => reason.trim().length === 0) || !sameJson(document.compatibility.requiredEvidence, [
    "definition-mapping",
    "runtime-conformance",
    "native-export"
  ])) {
    throw new TypeError("mixed visual compatibility must name every missing promotion evidence");
  }
}
function defineMixedVisualWorkspace(input) {
  const world = {
    ...input.world,
    binding: input.world.binding ?? {
      bindingId: MIXED_VISUAL_WORLD_BINDING_ID,
      contract: "common.view/world-scene-source",
      major: 1
    }
  };
  const model = {
    ...input.model,
    binding: input.model.binding ?? {
      bindingId: MIXED_VISUAL_MODEL_BINDING_ID,
      contract: "common.view/model-scene-source",
      major: 1
    }
  };
  const document = {
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    worldFrame: input.worldFrame,
    sources: [world, model],
    objects: input.objects,
    resources: input.resources,
    overlayPlacements: input.overlayPlacements,
    compatibility: {
      mode: "visual-only",
      definitionCompatible: false,
      runtimeCompatible: false,
      nativeExportable: false,
      reasons: [
        "visual placement does not prove definition compatibility",
        "no runtime conformance evidence is attached",
        "no native writer or export fidelity evidence is attached"
      ],
      requiredEvidence: ["definition-mapping", "runtime-conformance", "native-export"]
    }
  };
  validateDocument(document);
  const frozenDocument = snapshotJsonWireData(document);
  const slot = {
    slotId: MIXED_VISUAL_STAGE_ID,
    kind: "stage",
    contributionId: "modkit.ui/mixed-visual-stage",
    extensionId: "modkit/ui",
    priority: 390,
    singletonGroup: "center-stage",
    bindings: [world.binding, model.binding],
    composition: frozenDocument
  };
  const presentation = definePresentationPlan({
    subjectUri: input.workspaceUri,
    revision: input.workspaceRevision,
    slots: [slot],
    unsatisfied: [],
    activeStage: MIXED_VISUAL_STAGE_ID,
    alternateStages: []
  });
  return Object.freeze({ document: frozenDocument, presentation });
}
function isMixedVisualPresentationSlot(slot) {
  const candidate = slot;
  if (slot.slotId !== MIXED_VISUAL_STAGE_ID || candidate.composition === void 0)
    return false;
  try {
    validateDocument(candidate.composition);
    const expectedBindings = candidate.composition.sources.map((source) => source.binding);
    return slot.kind === "stage" && slot.bindings.length === expectedBindings.length && slot.bindings.every((binding, index) => {
      const expected = expectedBindings[index];
      return expected !== void 0 && "contract" in binding && binding.bindingId === expected.bindingId && binding.contract === expected.contract && binding.major === expected.major;
    });
  } catch {
    return false;
  }
}

// ../../MODDING/modkit-core/packages/sdk/dist/asset-capabilities/v1-projection.js
var V1_PROJECTION_UNAVAILABLE_CODE = "modkit/compat-v1-projection-unavailable";

// ../../MODDING/modkit-core/packages/sdk/dist/references.js
var bounded = (value2, label) => {
  if (typeof value2 !== "string" || value2.length === 0 || value2.length > 8192 || value2.includes("\0")) {
    throw new TypeError(`${label} must be a bounded non-empty string`);
  }
  return value2;
};
function referenceTargetKey(target) {
  if (!isQualifiedId(target.owner))
    throw new TypeError("reference target owner must be qualified");
  bounded(target.kind, "reference target kind");
  bounded(target.id, "reference target id");
  for (const [name, value2] of Object.entries({
    namespace: target.namespace,
    typeId: target.typeId,
    locale: target.locale,
    workspace: target.workspace
  })) {
    if (value2 !== void 0)
      bounded(value2, `reference target ${name}`);
  }
  return canonicalJsonStringify({
    owner: target.owner,
    kind: target.kind,
    id: target.id,
    ...target.namespace === void 0 ? {} : { namespace: target.namespace },
    ...target.typeId === void 0 ? {} : { typeId: target.typeId },
    ...target.locale === void 0 ? {} : { locale: target.locale },
    ...target.workspace === void 0 ? {} : { workspace: target.workspace }
  });
}

export {
  normalizeModkitIdentifier,
  normalizeModkitPackageSpecifier,
  normalizeModkitSourceIdentifier,
  WRITER_CONTRACT_ID,
  WRITER_FACET_MATCHER_PROFILE,
  WRITER_SURFACE,
  STANDARD_EDITING_SURFACES,
  ROUND_TRIP_RANK,
  writerOfferSatisfies,
  writerSelectionKey,
  containerEntryRevision,
  namespaceEntryEditTarget,
  loadSubjectCandidatePage,
  createSubjectCandidateProvider,
  operationScopedPermissionClasses,
  activationRequiredPermissionClasses,
  STANDARD_HOST_FACILITY_IDS,
  LEGACY_HOST_FACILITY_ALIASES,
  HOST_TRANSPORT_KINDS,
  isStandardHostFacilityId,
  isHostFacilityId,
  hostFacilityId,
  hostFacilityDiagnostics,
  createHostRealmProfile,
  createHostTopology,
  runtimeTargetForHostRealm,
  hostRealmCacheKey,
  createSpecSchemaRegistry,
  validateContributionManifest,
  SUBJECT_KIND_DEFINITION_CONTRIBUTION_CONTRACT,
  SUBJECT_KIND_DEFINITION_FACT,
  CODEC_CONTRIBUTION_CONTRACT,
  SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
  VIEWER_CONTRIBUTION_CONTRACT,
  EDITOR_CONTRIBUTION_CONTRACT,
  FIELD_EDITOR_CONTRIBUTION_CONTRACT,
  TRAIT_DEFINITION_CONTRIBUTION_CONTRACT,
  CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT,
  KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT,
  LOCALIZATION_CONTRIBUTION_CONTRACT,
  TRAIT_DEFINITION_FACT,
  CONTRACT_DEFINITION_FACT,
  EDITOR_CONTRIBUTION_FACT,
  FIELD_EDITOR_CONTRIBUTION_FACT,
  KNOWLEDGE_PACK_FACT,
  LOCALIZATION_CONTRIBUTION_FACT,
  validateEditorContributionSemantics,
  validateKnowledgePackSemantics,
  validateLocalizationContributionSemantics,
  validateFieldEditorContributionSemantics,
  createContributionContractRegistry,
  A1_SPEC_SCHEMA_ENTRIES,
  foreignServiceContractId,
  OODLE_DECODER_CONTRACT,
  INDEX_CACHE_DIRECTORY_SETTING,
  INDEX_CACHE_MANIFEST,
  indexCacheEnabled,
  relationGraphNeighbourhood,
  TRANSLATION_CONTRACT,
  TRANSLATION_MATCHER_PROFILE,
  LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  LANGUAGE_DOCUMENT_MATCHER_PROFILE,
  languageWorkspaceIsSemanticallyIncomplete,
  RUNTIME_PROVIDER_CONTRACT,
  RUNTIME_SESSION_CONTRACT,
  RUNTIME_PROVIDER_MATCHER_PROFILE,
  RUNTIME_SESSION_V2_MEMBERS,
  SERVICE_OPERATION_PROVIDER_CONTRACT,
  SERVICE_OPERATION_MATCHER_PROFILE,
  GAME_INSTALLATION_DISCOVERY_CONTRACT,
  GAME_LAUNCH_PLAN_CONTRACT,
  GAME_INSTALLATION_MATCHER_PROFILE,
  gameLaunchOptionsJsonSchema,
  MOD_WORKSPACE_COMPOSITION_CONTRACT,
  MOD_WORKSPACE_MATCHER_PROFILE,
  resolveModWorkspaceGraph,
  DATA_CATALOG_ANALYSIS_CONTRACT,
  DATA_CATALOG_MATCHER_PROFILE,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE,
  RESOLVED_DATA_AUTHORING_INDEX_KIND,
  DATA_CATALOG_QUERIES_OUTPUT,
  DATA_CATALOG_ENTITIES_INPUT,
  resolveDataCatalog,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  MAP_PREVIEW_PREPARATION_CONTRACT,
  NATIVE_MAP_ENCODER_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  MAP_LAYERS_OPERATION,
  MAP_LAYER_READ_OPERATION,
  MAP_LAYER_WRITE_OPERATION,
  MAP_LAYERS_REPRESENTATION,
  MAP_LAYERS_INPUT_SCHEMA,
  MAP_LAYER_READ_INPUT_SCHEMA,
  MAP_LAYER_WRITE_INPUT_SCHEMA,
  mapLayerWindow,
  MAP_SEMANTIC_MATCHER_PROFILE,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  NATIVE_MAP_ENCODER_MATCHER_PROFILE,
  transformTerrainUv,
  terrainUvTransformFromOrigin,
  mapQualificationTupleBytes,
  worldModelRequiredBytes,
  contributionSettingsFor,
  validateContributionPattern,
  expandContributionManifests,
  normalizeExtensionManifest,
  ENCODED_MEDIA_SURFACE_ID,
  STANDARD_DATA_SOURCE_SURFACES,
  AUXILIARY_DATA_SOURCE_SURFACES,
  standardDataSourceSurfaceFor,
  ENCODED_MEDIA_SURFACE_CONTRACT,
  bindingId,
  presentationSlotId,
  definePresentationPlan,
  MIXED_VISUAL_STAGE_ID,
  MIXED_VISUAL_WORLD_BINDING_ID,
  MIXED_VISUAL_MODEL_BINDING_ID,
  defineMixedVisualWorkspace,
  isMixedVisualPresentationSlot,
  V1_PROJECTION_UNAVAILABLE_CODE,
  referenceTargetKey
};
