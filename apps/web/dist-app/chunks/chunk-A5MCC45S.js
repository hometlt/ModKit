import {
  ABI_ASSET_SESSION,
  createEndpoint,
  createStandardSurfaceRegistry,
  framePortFromMessagePort,
  protocolLimits
} from "./chunk-VKDDSZCI.js";
import {
  A1_SPEC_SCHEMA_ENTRIES,
  CODEC_CONTRIBUTION_CONTRACT,
  CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT,
  CONTRACT_DEFINITION_FACT,
  DATA_CATALOG_ANALYSIS_CONTRACT,
  DATA_CATALOG_MATCHER_PROFILE,
  EDITOR_CONTRIBUTION_CONTRACT,
  EDITOR_CONTRIBUTION_FACT,
  GAME_INSTALLATION_DISCOVERY_CONTRACT,
  GAME_INSTALLATION_MATCHER_PROFILE,
  GAME_LAUNCH_PLAN_CONTRACT,
  KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT,
  KNOWLEDGE_PACK_FACT,
  LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  LANGUAGE_DOCUMENT_MATCHER_PROFILE,
  LOCALIZATION_CONTRIBUTION_CONTRACT,
  MAP_PREVIEW_PREPARATION_CONTRACT,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  MOD_WORKSPACE_COMPOSITION_CONTRACT,
  MOD_WORKSPACE_MATCHER_PROFILE,
  PERMISSION_CLASSES,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  RUNTIME_PROVIDER_CONTRACT,
  RUNTIME_PROVIDER_MATCHER_PROFILE,
  RUNTIME_SESSION_CONTRACT,
  SCENE_RENDERER_CONTRACT,
  SCENE_RENDERER_MATCHER_PROFILE,
  SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
  TRAIT_DEFINITION_CONTRIBUTION_CONTRACT,
  V1_PROJECTION_UNAVAILABLE_CODE,
  VIEWER_CONTRIBUTION_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  WRITER_CONTRACT_ID,
  WRITER_FACET_MATCHER_PROFILE,
  WRITER_SURFACE,
  activationRequiredPermissionClasses,
  algorithmQualifiedDigest,
  contributionId,
  createContributionContractRegistry,
  createHostTopology,
  definePresentationPlan,
  expandContributionManifests,
  grantValidity,
  hostRealmCacheKey,
  isKnowledgeLocaleTag,
  isKnowledgeTarget,
  isStandardTraitId,
  knowledgeLocaleFallbacks,
  knowledgeTargetKey,
  narrowGrant,
  normalizeExtensionManifest,
  normalizeModkitIdentifier,
  operationScopedPermissionClasses,
  resolveModWorkspaceGraph,
  revisionId,
  revisionIdFromRef,
  runtimeTargetForHostRealm,
  validateContributionManifest,
  validateSubjectDescriptorV2,
  writerOfferSatisfies,
  writerSelectionKey
} from "./chunk-F4XKVL72.js";
import {
  CONTAINER_EXTRACT_OPERATION_ID,
  ModkitError,
  OperationCancelledError,
  canonicalJsonStringify,
  compareUtf8,
  contractId,
  diagnostic,
  errorCode,
  hasErrors,
  isCancellation,
  isModkitError,
  isQualifiedId,
  isTraitId,
  parseSemver,
  parseVersionRange,
  satisfiesRange,
  throwIfAborted,
  uint64
} from "./chunk-X2ENULEB.js";
import {
  __export
} from "./chunk-CQ52GEHY.js";

// packages/host/dist/inventory.js
var EXTENSION_DISABLED_CODE = "x3.host/extension-disabled";
var CONTRIBUTION_DISABLED_CODE = "x3.host/contribution-disabled";
var INVENTORY_RECORD = /* @__PURE__ */ Symbol.for("x3.host/inventory-record");
function deepFreezeJson(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value))
    deepFreezeJson(child);
  return Object.freeze(value);
}
function inventoryRecordFor(contribution) {
  const record = contribution[INVENTORY_RECORD];
  return record !== void 0 && Object.isFrozen(record) && record.publicRecord === contribution.record ? record : void 0;
}
function coordinate(manifest) {
  return `${manifest.publisher}/${manifest.id}`;
}
var RESTRICTED_LINKED_EXECUTION = Object.freeze({
  origin: "linked",
  allowTrustedInProcess: false
});
function snapshotExecutionPolicy(value) {
  if (value === void 0)
    return { policy: RESTRICTED_LINKED_EXECUTION, valid: true };
  const origin = value.origin;
  const allowTrustedInProcess = value.allowTrustedInProcess;
  const allowedOrigin = origin === "bundled" || origin === "installed" || origin === "linked";
  if (!allowedOrigin || typeof allowTrustedInProcess !== "boolean") {
    return { policy: RESTRICTED_LINKED_EXECUTION, valid: false };
  }
  return {
    policy: Object.freeze({
      origin,
      allowTrustedInProcess
    }),
    valid: true
  };
}
async function buildInventory(inputs, registry, options = {}) {
  const disabled = new Set((options.disabledContributions ?? []).map(normalizeModkitIdentifier));
  const disabledExtensions = new Set((options.disabledExtensions ?? []).map(normalizeModkitIdentifier));
  const diagnostics = [];
  const extensions = [];
  for (const input of inputs) {
    const execution = snapshotExecutionPolicy(input.execution);
    if (!execution.valid) {
      diagnostics.push(diagnostic("error", "x3.host/invalid-extension-execution-policy", "the host loader supplied malformed extension execution provenance; activation is disabled", [input.source]));
    }
    const normalized = await normalizeExtensionManifest(input.containers);
    diagnostics.push(...normalized.diagnostics.map((d) => ({ ...d, path: [input.source, ...d.path ?? []] })));
    if (!normalized.manifest || !normalized.container)
      continue;
    const extensionCoordinate2 = coordinate(normalized.manifest);
    const extensionDisabled = disabledExtensions.has(extensionCoordinate2);
    const expansion = expandContributionManifests(normalized.manifest.contributionManifests, input.files);
    diagnostics.push(...expansion.diagnostics.map((d) => ({ ...d, path: [input.source, ...d.path ?? []] })));
    const contributions = [];
    for (const entry2 of expansion.entries) {
      const document = input.documents.get(entry2.path);
      if (document === void 0) {
        diagnostics.push(diagnostic("error", "x3.host/unreadable-contribution", `declared contribution \xAB${entry2.path}\xBB was not provided by the loader`, [input.source, entry2.path]));
        continue;
      }
      const validationRegistry = registry.validationRegistry();
      const result = await validateContributionManifest(document, validationRegistry);
      const ownedManifest = result.manifest === void 0 ? void 0 : deepFreezeJson(JSON.parse(canonicalJsonStringify(result.manifest)));
      const manifestDigest = input.documentDigests.get(entry2.path);
      const localDiagnostics = [...result.diagnostics];
      let inventoryEligible = result.inventoryEligible;
      let activationEligible = result.activationEligible && execution.valid;
      const manifestId = result.manifest?.id;
      if (extensionDisabled) {
        activationEligible = false;
        localDiagnostics.push(diagnostic("information", EXTENSION_DISABLED_CODE, `extension \xAB${extensionCoordinate2}\xBB is disabled by host settings; its contributions stay listed`, [input.source, entry2.path]));
      }
      if (manifestId !== void 0 && disabled.has(manifestId)) {
        activationEligible = false;
        localDiagnostics.push(diagnostic("information", CONTRIBUTION_DISABLED_CODE, `\xAB${manifestId}\xBB is disabled by host settings; it stays listed and can be re-enabled`, [input.source, entry2.path]));
      }
      let facts = [];
      let record;
      if (ownedManifest !== void 0 && result.inventoryEligible) {
        if (manifestDigest === void 0 || manifestDigest.trim().length === 0) {
          localDiagnostics.push(diagnostic("error", "x3.host/missing-manifest-digest", "the trusted loader did not attest the contribution manifest bytes", [input.source, entry2.path]));
          inventoryEligible = false;
          activationEligible = false;
        } else {
          const context = Object.freeze({
            ownerExtensionId: extensionCoordinate2,
            extensionVersion: normalized.manifest.version,
            inventoryRecordId: `${input.artifact.inventoryRecordId}:${entry2.path}`,
            manifestDigest,
            artifactDigest: input.artifact.artifactDigest,
            artifactRoot: input.artifact.artifactRoot.href,
            manifestPath: entry2.path
          });
          const registration = registry.get(ownedManifest.contract.id, ownedManifest.contract.major);
          try {
            const projected = registration?.project(ownedManifest, context);
            if (!Array.isArray(projected))
              throw new TypeError("projector must return an array");
            facts = Object.freeze(projected.map((fact2, index) => validateProjectedFact(fact2, context, index)));
            record = Object.freeze({
              inventoryRecordId: context.inventoryRecordId,
              manifestDigest,
              artifactDigest: context.artifactDigest,
              artifactRoot: context.artifactRoot
            });
          } catch (error3) {
            localDiagnostics.push(diagnostic("error", "x3.host/inventory-projection-failed", "the host-trusted contribution projector returned malformed data or threw", [input.source, entry2.path], { error: error3 instanceof Error ? error3.message : String(error3) }));
            inventoryEligible = false;
            activationEligible = false;
            facts = [];
            record = void 0;
          }
        }
      }
      const contribution = {
        path: entry2.path,
        ...ownedManifest === void 0 ? {} : { manifest: ownedManifest },
        specState: result.specState,
        inventoryEligible,
        activationEligible,
        facts,
        ...record === void 0 ? {} : { record },
        diagnostics: Object.freeze(localDiagnostics)
      };
      if (record !== void 0 && ownedManifest !== void 0) {
        const privateRecord = Object.freeze({
          publicRecord: record,
          manifest: ownedManifest,
          verifyArtifactDigest: input.artifact.verifyArtifactDigest,
          ...input.artifact.fileDigests === void 0 ? {} : { fileDigests: Object.freeze({ ...input.artifact.fileDigests }) },
          artifactRoot: new URL(input.artifact.artifactRoot.href),
          execution: execution.policy
        });
        Object.defineProperty(contribution, INVENTORY_RECORD, {
          value: privateRecord,
          enumerable: false,
          writable: false,
          configurable: false
        });
      }
      contributions.push(Object.freeze(contribution));
    }
    extensions.push({
      source: input.source,
      origin: execution.policy.origin,
      container: normalized.container,
      manifest: normalized.manifest,
      contributions
    });
  }
  extensions.sort((a, b) => compareUtf8(coordinate(a.manifest), coordinate(b.manifest)));
  const seenExtensions = /* @__PURE__ */ new Map();
  for (const extension of extensions) {
    const coord = coordinate(extension.manifest);
    const prior = seenExtensions.get(coord);
    if (prior !== void 0) {
      diagnostics.push(diagnostic("error", "x3.host/duplicate-extension-coordinate", `extension coordinate \xAB${coord}\xBB provided by both \xAB${prior}\xBB and \xAB${extension.source}\xBB`, [extension.source]));
    } else {
      seenExtensions.set(coord, extension.source);
    }
  }
  const seenContributions = /* @__PURE__ */ new Map();
  for (const extension of extensions) {
    for (const contribution of extension.contributions) {
      const id = contribution.manifest?.id;
      if (id === void 0)
        continue;
      const where = `${coordinate(extension.manifest)}:${contribution.path}`;
      const prior = seenContributions.get(id);
      if (prior !== void 0) {
        diagnostics.push(diagnostic("error", "x3.host/duplicate-contribution-id", `contribution id \xAB${id}\xBB declared by both \xAB${prior}\xBB and \xAB${where}\xBB`, [id]));
      } else {
        seenContributions.set(id, where);
      }
    }
  }
  const key2 = (d) => `${d.code}${(d.path ?? []).join("/")}${d.message}`;
  diagnostics.sort((a, b) => compareUtf8(key2(a), key2(b)));
  return { extensions, diagnostics };
}
function validateProjectedFact(value, context, index) {
  if (typeof value !== "object" || value === null || !isQualifiedId(value.contract?.id) || !Number.isSafeInteger(value.contract?.major) || value.contract.major < 0 || canonicalJsonStringify(value.provenance) !== canonicalJsonStringify(context)) {
    throw new TypeError(`invalid inventory fact at index ${index}`);
  }
  const ownedValue = deepFreezeJson(JSON.parse(canonicalJsonStringify(value.value)));
  return Object.freeze({
    contract: Object.freeze({ id: value.contract.id, major: value.contract.major }),
    value: ownedValue,
    provenance: Object.freeze({ ...context })
  });
}
function inventoryHasErrors(inventory) {
  return hasErrors(inventory.diagnostics) || inventory.extensions.some((extension) => extension.contributions.some((contribution) => hasErrors(contribution.diagnostics)));
}

// packages/host/dist/contribution-registry.js
var PROVIDER_OFFER_INVENTORY_FACT = contractId("modkit.inventory/provider-offer");
var VIEWER_CONTRIBUTION_INVENTORY_FACT = contractId("modkit.inventory/viewer-contribution");
function fact(contract, value, context) {
  return Object.freeze({
    contract: Object.freeze({ id: contract, major: 1 }),
    value,
    provenance: Object.freeze({ ...context })
  });
}
function executableFacts(manifest, context, valueForVariant, applicableVariants) {
  return Object.freeze((manifest.runtimeVariants ?? []).filter((variant) => applicableVariants === void 0 || applicableVariants.includes(variant.variantId)).map((variant) => fact(PROVIDER_OFFER_INVENTORY_FACT, valueForVariant(variant.variantId), context)));
}
function codecProjector(manifest, context) {
  const spec = manifest.spec;
  return executableFacts(manifest, context, (variantId) => {
    const variant = manifest.runtimeVariants?.find((item) => item.variantId === variantId);
    if (variant === void 0)
      throw new TypeError(`unknown runtime variant ${variantId}`);
    return {
      kind: "primary",
      extensionId: context.ownerExtensionId,
      extensionVersion: context.extensionVersion,
      providerId: manifest.id,
      runtimeVariant: variant.variantId,
      target: variant.target,
      // ADR-HOST-002 §2: operation-scoped classes are capabilities the host may degrade, not
      // preconditions of resolving the codec — the resolver sees only what opening needs
      requiredPermissions: activationRequiredPermissionClasses(variant.requestedPermissionClasses, spec.operations),
      provides: spec.representations.map((representation) => ({
        offerId: representation.id,
        contract: representation.contract,
        major: representation.major,
        version: `${representation.major}.0.0`
      })),
      requires: spec.requires ?? [],
      outputs: (spec.traitDeclarations ?? []).filter((declaration) => declaration.presence === "will-expose").map((declaration) => ({
        id: declaration.id,
        ...declaration.definitionVersion === void 0 ? {} : { definitionVersion: declaration.definitionVersion }
      })),
      operations: spec.operations.map((operation) => operation.id)
    };
  });
}
function serviceProjector(manifest, context) {
  const spec = manifest.spec;
  return executableFacts(manifest, context, (variantId) => {
    const variant = manifest.runtimeVariants?.find((item) => item.variantId === variantId);
    if (variant === void 0)
      throw new TypeError(`unknown runtime variant ${variantId}`);
    return {
      kind: spec.replacement?.compatible === true ? "replacement" : "primary",
      extensionId: context.ownerExtensionId,
      extensionVersion: context.extensionVersion,
      providerId: manifest.id,
      runtimeVariant: variant.variantId,
      target: variant.target,
      requiredPermissions: variant.requestedPermissionClasses,
      provides: spec.provides,
      requires: spec.requires ?? [],
      outputs: (spec.outputs ?? []).filter((declaration) => declaration.presence === "will-expose").map((declaration) => ({
        id: declaration.id,
        ...declaration.definitionVersion === void 0 ? {} : { definitionVersion: declaration.definitionVersion }
      })),
      ...spec.replacement === void 0 ? {} : { replaces: spec.replacement.target }
    };
  }, spec.applicableVariants);
}
function entry(id) {
  const found = A1_SPEC_SCHEMA_ENTRIES.find((item) => item.contract === id && item.major === 1);
  if (found === void 0 || found.validateSemantics === void 0) {
    throw new TypeError(`missing A-1 schema/semantic authority for ${id}@1`);
  }
  return found;
}
function builtins() {
  const codec = entry(CODEC_CONTRIBUTION_CONTRACT);
  const service = entry(SERVICE_PROVIDER_CONTRIBUTION_CONTRACT);
  const viewer = entry(VIEWER_CONTRIBUTION_CONTRACT);
  const editor = entry(EDITOR_CONTRIBUTION_CONTRACT);
  const trait = entry(TRAIT_DEFINITION_CONTRIBUTION_CONTRACT);
  const definition = entry(CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT);
  const knowledge = entry(KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT);
  const localization = entry(LOCALIZATION_CONTRIBUTION_CONTRACT);
  if (trait.registration === void 0 || definition.registration === void 0 || knowledge.registration === void 0 || localization.registration === void 0) {
    throw new TypeError("A-1 definition registrations are missing");
  }
  return [
    {
      contract: { id: codec.contract, major: codec.major },
      schema: codec.schema,
      mode: "executable",
      project: codecProjector,
      validateSemantics: codec.validateSemantics,
      moduleAbi: { export: "createCodec", abiVersion: 1 },
      conformanceProfile: "modkit/codec-contribution-v1"
    },
    {
      contract: { id: service.contract, major: service.major },
      schema: service.schema,
      mode: "executable",
      project: serviceProjector,
      validateSemantics: service.validateSemantics,
      moduleAbi: { export: "createProvider", abiVersion: 1 },
      conformanceProfile: "modkit/service-provider-contribution-v1"
    },
    {
      contract: { id: viewer.contract, major: viewer.major },
      schema: viewer.schema,
      mode: "executable",
      project: (manifest, context) => [
        fact(VIEWER_CONTRIBUTION_INVENTORY_FACT, manifest.spec, context)
      ],
      validateSemantics: viewer.validateSemantics,
      moduleAbi: { export: "default", abiVersion: 1 },
      conformanceProfile: "modkit/viewer-contribution-v1"
    },
    {
      contract: { id: editor.contract, major: editor.major },
      schema: editor.schema,
      mode: "executable",
      project: (manifest, context) => [
        fact(EDITOR_CONTRIBUTION_FACT, manifest.spec, context)
      ],
      validateSemantics: editor.validateSemantics,
      moduleAbi: { export: "default", abiVersion: 1 },
      conformanceProfile: "modkit/editor-contribution-v1"
    },
    {
      contract: { id: trait.contract, major: trait.major },
      schema: trait.schema,
      mode: "data-only",
      project: trait.registration.project,
      validateSemantics: trait.validateSemantics,
      conformanceProfile: trait.registration.conformanceProfile
    },
    {
      contract: { id: definition.contract, major: definition.major },
      schema: definition.schema,
      mode: "data-only",
      project: definition.registration.project,
      validateSemantics: definition.validateSemantics,
      conformanceProfile: definition.registration.conformanceProfile
    },
    {
      contract: { id: knowledge.contract, major: knowledge.major },
      schema: knowledge.schema,
      mode: "data-only",
      project: knowledge.registration.project,
      validateSemantics: knowledge.validateSemantics,
      conformanceProfile: knowledge.registration.conformanceProfile
    },
    {
      contract: { id: localization.contract, major: localization.major },
      schema: localization.schema,
      mode: "data-only",
      project: localization.registration.project,
      validateSemantics: localization.validateSemantics,
      conformanceProfile: localization.registration.conformanceProfile
    }
  ];
}
function createHostContributionContractRegistry(additional = []) {
  return createContributionContractRegistry([...builtins(), ...additional]);
}

// packages/host/dist/offers.js
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
  if (value === void 0)
    return void 0;
  if (!Array.isArray(value))
    throw new TypeError("outputs must be an array");
  return Object.freeze(value.map((raw, index) => {
    const item = object(raw, `outputs[${index}]`);
    const id = string(item.id, `outputs[${index}].id`);
    if (!isTraitId(id))
      throw new TypeError(`outputs[${index}].id is not a trait id`);
    return Object.freeze({
      id,
      ...item.definitionVersion === void 0 ? {} : {
        definitionVersion: string(item.definitionVersion, `outputs[${index}].definitionVersion`)
      }
    });
  }));
}
function parseTarget(value) {
  const target = object(value, "target");
  return JSON.parse(canonicalJsonStringify(target));
}
function parseProviderOffer(value) {
  const item = object(value, "provider offer fact");
  const provides5 = item.provides;
  if (!Array.isArray(provides5) || provides5.length === 0) {
    throw new TypeError("provider offer fact needs at least one logical offer");
  }
  const kind = item.kind;
  if (!["primary", "replacement", "augmentation", "projection", "operation"].includes(String(kind))) {
    throw new TypeError("provider offer kind is invalid");
  }
  const providerId = string(item.providerId, "providerId");
  if (!isQualifiedId(providerId))
    throw new TypeError("providerId must be qualified");
  const parseRequirementArray = (raw, label) => {
    if (raw === void 0)
      return void 0;
    if (!Array.isArray(raw))
      throw new TypeError(`${label} must be an array`);
    return Object.freeze(raw.map((entry2, index) => parseRequirement(entry2, `${label}[${index}]`)));
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
    provides: Object.freeze(provides5.map((entry2, index) => parseContractOffer(entry2, `provides[${index}]`))),
    ...requires === void 0 ? {} : { requires },
    ...outputs === void 0 ? {} : { outputs },
    ...operations === void 0 ? {} : {
      operations: Object.freeze(operations.map((entry2, index) => string(entry2, `operations[${index}]`)))
    },
    ...item.replaces === void 0 ? {} : { replaces: parseRequirement(item.replaces, "replaces") }
  });
}
function offersFromInventory(inventory) {
  const catalog = [];
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (!contribution.activationEligible)
        continue;
      const privateRecord = inventoryRecordFor(contribution);
      if (privateRecord === void 0 || contribution.record === void 0)
        continue;
      for (const fact2 of contribution.facts) {
        if (fact2.contract.id !== PROVIDER_OFFER_INVENTORY_FACT || fact2.contract.major !== 1) {
          continue;
        }
        const offer = parseProviderOffer(fact2.value);
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
  return Object.freeze(catalog.sort((left, right) => compareUtf8(canonicalJsonStringify(left), canonicalJsonStringify(right))));
}

// packages/vfs/dist/vfs.js
var DEFAULT_VFS_LIMITS = Object.freeze({
  // Large installed-game indexes are normal inputs (the pinned BAR rapid package has 18,413
  // records). Providers still count before exposing an entry; this ceiling merely lets a caller
  // grant a bounded installed-game-sized index instead of making that valid input impossible.
  maxEntries: 25e3,
  maxMaterializedBytes: 512n * 1024n * 1024n,
  maxFileBytes: 8n * 1024n * 1024n * 1024n * 1024n,
  maxReadBytes: 512n * 1024n * 1024n,
  maxReadRangeBytes: 16 * 1024 * 1024,
  maxStreamBytes: 512n * 1024n * 1024n,
  maxPathBytes: 4096
});
var PATH_ENCODER = new TextEncoder();
function invalidPath(path, reason) {
  return new ModkitError({
    code: "x3.vfs/path-invalid",
    message: `VFS path \xAB${path}\xBB is invalid: ${reason}`,
    context: { path, reason }
  });
}
function normalizeVfsPath(path) {
  if (path.includes("\0"))
    throw invalidPath(path, "NUL bytes are forbidden");
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".")
      continue;
    if (part === "..") {
      throw new ModkitError({
        code: "x3.vfs/path-escape-refused",
        message: `VFS path \xAB${path}\xBB attempts to escape its mounted root`,
        context: { path }
      });
    }
    parts.push(part);
  }
  return parts.join("/");
}

// packages/host/dist/security/entrypoint.js
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
  if (entrypoint.trim().length === 0)
    throw refuse(entrypoint, "empty");
  if (/[\u0000-\u001f\u007f]/.test(entrypoint)) {
    throw refuse(entrypoint, "contains control characters");
  }
  if (SCHEME.test(entrypoint) && !WINDOWS_DRIVE.test(entrypoint)) {
    throw refuse(entrypoint, "URL schemes are not allowed");
  }
  if (WINDOWS_DRIVE.test(entrypoint))
    throw refuse(entrypoint, "absolute Windows path");
  if (entrypoint.startsWith("/") || entrypoint.startsWith("\\")) {
    throw refuse(entrypoint, "absolute path");
  }
  if (entrypoint.includes("\\"))
    throw refuse(entrypoint, "use forward slashes");
  if (entrypoint.split("/").includes(".."))
    throw refuse(entrypoint, "`..` traversal");
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

// packages/host/dist/localization.js
var LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;
var encoder = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true });
function extensionCoordinate(extension) {
  return `${extension.manifest.publisher}/${extension.manifest.id}`;
}
function catalogPath(candidate) {
  return Object.freeze([
    candidate.extension.source,
    candidate.contribution.path,
    candidate.resource.path
  ]);
}
function catalogDiagnostic(candidate, message, data) {
  return diagnostic("warning", "x3.host/localization-catalog-refused", message, catalogPath(candidate), data);
}
function candidatesFrom(inventory) {
  const candidates = [];
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const disabled = contribution.diagnostics.some((item) => item.code === CONTRIBUTION_DISABLED_CODE || item.code === EXTENSION_DISABLED_CODE);
      if (!contribution.inventoryEligible || disabled)
        continue;
      const manifest = contribution.manifest;
      if (manifest?.contract.id !== LOCALIZATION_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue;
      }
      const spec = manifest.spec;
      for (const resource of spec.catalogs)
        candidates.push({ extension, contribution, resource });
    }
  }
  candidates.sort((left, right) => {
    const leftKey = `${extensionCoordinate(left.extension)}\0${left.contribution.manifest?.id ?? ""}\0${left.resource.path}\0${left.resource.locale}`;
    const rightKey = `${extensionCoordinate(right.extension)}\0${right.contribution.manifest?.id ?? ""}\0${right.resource.path}\0${right.resource.locale}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return Object.freeze(candidates);
}
function confinedResourcePath(candidate, artifactRoot) {
  const authored = candidate.resource.path;
  if (authored.startsWith("/") || authored.startsWith("\\") || authored.includes("\\")) {
    throw new TypeError("localization catalog path must be a portable relative POSIX path");
  }
  const normalized = normalizeVfsPath(authored);
  if (normalized === "" || !normalized.toLowerCase().endsWith(".json")) {
    throw new TypeError("localization catalog path must identify a JSON file");
  }
  resolveContainedEntrypoint(artifactRoot, normalized);
  return normalized;
}
async function sha256(bytes) {
  const copy = Uint8Array.from(bytes);
  const subtle = globalThis.crypto?.subtle;
  if (subtle === void 0)
    throw new TypeError("WebCrypto SHA-256 is unavailable");
  const digest = new Uint8Array(await subtle.digest("SHA-256", copy.buffer));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function maximumJsonBytes(requested) {
  if (requested === void 0)
    return LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES;
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    throw new TypeError("localization maxJsonBytes must be a positive safe integer");
  }
  return Math.min(requested, LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES);
}
function namespaceOwnedMessagePrefix(namespace) {
  const tail = namespace.split(/[./]/u).at(-1) ?? namespace;
  const owner = tail.replace(/-(?:app|ui|localization|messages)$/u, "") || tail;
  return `${owner}.`;
}
function catalogNamespace(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return void 0;
  const descriptor = Object.getOwnPropertyDescriptor(value, "namespace");
  return descriptor !== void 0 && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : void 0;
}
async function authorizedPrefixes(candidate, document, authorizer) {
  const requested = Object.freeze([...candidate.resource.messagePrefixes]);
  const namespace = catalogNamespace(document);
  if (namespace === void 0) {
    throw new TypeError("localization catalog namespace must be a string data property");
  }
  if (authorizer === void 0) {
    const owned = namespaceOwnedMessagePrefix(namespace);
    return Object.freeze(requested.filter((prefix) => prefix === owned));
  }
  const contributionId2 = candidate.contribution.manifest?.id ?? candidate.contribution.path;
  const granted = await authorizer(Object.freeze({
    ownerExtensionId: extensionCoordinate(candidate.extension),
    contributionId: contributionId2,
    catalogPath: candidate.resource.path,
    locale: candidate.resource.locale,
    catalogNamespace: namespace,
    requestedMessagePrefixes: requested
  }));
  if (!Array.isArray(granted))
    throw new TypeError("message-prefix authorizer must return an array");
  const requestedSet = new Set(requested);
  return Object.freeze([...new Set(granted)].filter((prefix) => typeof prefix === "string" && requestedSet.has(prefix)));
}
async function readCatalogBytes(candidate, options, maxBytes) {
  const record = inventoryRecordFor(candidate.contribution);
  if (record === void 0)
    throw new TypeError("localization contribution has no trusted inventory record");
  const path = confinedResourcePath(candidate, record.artifactRoot);
  const expectedDigest = record.fileDigests?.[path];
  if (expectedDigest === void 0) {
    throw new TypeError(`localization catalog ${path} is absent from the attested artifact file map`);
  }
  const mount = await options.vfs.openMount(record.artifactRoot.href, {
    limits: {
      // Opening an artifact mount may account all of its files (a model pack can legitimately be
      // much larger than one catalog), so retain the platform's artifact ceilings here. Exact
      // catalog size and all bytes actually read remain capped to the localization ceiling.
      maxEntries: DEFAULT_VFS_LIMITS.maxEntries,
      maxMaterializedBytes: DEFAULT_VFS_LIMITS.maxMaterializedBytes,
      maxFileBytes: DEFAULT_VFS_LIMITS.maxFileBytes,
      maxReadBytes: BigInt(LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES),
      maxReadRangeBytes: LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES,
      maxStreamBytes: DEFAULT_VFS_LIMITS.maxStreamBytes,
      maxPathBytes: Math.max(256, encoder.encode(path).byteLength)
    },
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  try {
    const node = await mount.stat(path, options.signal);
    if (node?.kind !== "file")
      throw new TypeError(`localization catalog ${path} is not a file`);
    if (node.size !== void 0 && node.size > BigInt(maxBytes)) {
      throw new TypeError(`localization catalog ${path} exceeds the ${maxBytes}-byte raw limit`);
    }
    const source = await mount.open(path, options.signal);
    try {
      const size = await source.size(options.signal);
      if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
        throw new TypeError(`localization catalog ${path} exceeds the ${maxBytes}-byte raw limit`);
      }
      const bytes = await source.readAt(0, size, options.signal);
      const actualDigest = await (options.digest ?? sha256)(bytes);
      if (actualDigest !== expectedDigest) {
        throw new TypeError(`localization catalog ${path} does not match its attested SHA-256`);
      }
      return bytes;
    } finally {
      await source.dispose();
    }
  } finally {
    await mount.dispose();
  }
}
async function loadLocalizationCatalogs(inventory, options) {
  const maxBytes = maximumJsonBytes(options.maxJsonBytes);
  const catalogs = [];
  const diagnostics = [];
  for (const candidate of candidatesFrom(inventory)) {
    try {
      const bytes = await readCatalogBytes(candidate, options, maxBytes);
      let document;
      try {
        document = JSON.parse(decoder.decode(bytes));
      } catch (error3) {
        throw new TypeError(`localization catalog is not valid UTF-8 JSON: ${error3 instanceof Error ? error3.message : String(error3)}`);
      }
      const prefixes = await authorizedPrefixes(candidate, document, options.authorizeMessagePrefixes);
      if (prefixes.length === 0) {
        throw new TypeError("localization catalog was granted no requested message-key prefix");
      }
      const catalog = options.parseCatalog(document, {
        authorizedMessagePrefixes: prefixes,
        ...options.fallbackCatalog === void 0 ? {} : { fallbackCatalog: options.fallbackCatalog }
      });
      if (catalog.locale.toLowerCase() !== candidate.resource.locale.toLowerCase()) {
        throw new TypeError(`catalog locale ${catalog.locale} does not match contribution locale ${candidate.resource.locale}`);
      }
      catalogs.push(catalog);
    } catch (error3) {
      diagnostics.push(catalogDiagnostic(candidate, `localization catalog \xAB${candidate.resource.path}\xBB was refused; built-in fallback remains active`, { reason: error3 instanceof Error ? error3.message : String(error3) }));
    }
  }
  return Object.freeze({
    catalogs: Object.freeze(catalogs),
    diagnostics: Object.freeze(diagnostics)
  });
}

// packages/host/dist/commands/runtime.js
var COMMAND_CANCELLED = "x3.command/cancelled";
var COMMAND_SUBJECT_UNRESOLVED = "x3.command/subject-unresolved";
var COMMAND_INPUT_INVALID = "x3.command/input-invalid";
var COMMAND_UNKNOWN = "x3.command/unknown";
var COMMAND_UNAVAILABLE = "x3.command/unavailable";
var commandDiagnostic = (item) => ({
  code: item.code,
  message: item.message,
  ...item.severity === void 0 ? {} : { severity: item.severity }
});
var ok = (command, data, diagnostics = []) => ({ state: "ok", command, data, diagnostics });
var unavailable = (command, reason, alternative, diagnostics = [], code = COMMAND_UNAVAILABLE) => ({ state: "unavailable", command, code, reason, alternative, diagnostics });
var failed = (command, code, message, diagnostics = []) => ({ state: "failed", command, code, message, diagnostics });
function createCommandRuntime(descriptors) {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  if (byId.size !== descriptors.length) {
    throw new TypeError("two commands share one id; a command id names exactly one behaviour");
  }
  const sorted = Object.freeze([...descriptors].sort((a, b) => a.id < b.id ? -1 : 1));
  return Object.freeze({
    descriptors: sorted,
    get: (id) => byId.get(id),
    async run(id, input, context) {
      const descriptor = byId.get(id);
      if (descriptor === void 0) {
        return failed(id, COMMAND_UNKNOWN, `no command is registered as \xAB${id}\xBB`);
      }
      if (descriptor.needsSubject && (input.subject ?? "") === "") {
        return failed(id, COMMAND_INPUT_INVALID, `\xAB${id}\xBB needs a subject, and the input names none`);
      }
      try {
        if (context.signal?.aborted === true) {
          return failed(id, COMMAND_CANCELLED, "the run was cancelled before it started");
        }
        return await descriptor.run(context, input);
      } catch (error3) {
        if (context.signal?.aborted === true || isAbort(error3)) {
          return failed(id, COMMAND_CANCELLED, "the run was cancelled");
        }
        return failed(id, "x3.command/failed", error3 instanceof Error ? error3.message : String(error3));
      }
    }
  });
}
function isAbort(error3) {
  return error3 instanceof Error && (error3.name === "AbortError" || error3.name === "TimeoutError");
}

// packages/host/dist/commands/protocol.js
var COMMAND_PROTOCOL_SCHEMA_VERSION = "modkit-command-protocol-1";
var RESULT_STATES = Object.freeze(["ok", "unavailable", "failed"]);
var immutableJson = (value) => {
  if (Array.isArray(value))
    return Object.freeze(value.map((item) => immutableJson(item)));
  if (value !== null && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key2, item]) => [key2, immutableJson(item)])));
  }
  return value;
};
var snapshotInput = (input) => Object.freeze(Object.fromEntries(Object.entries(input).flatMap(([key2, value]) => value === void 0 ? [] : [[key2, immutableJson(value)]])));
var snapshotResult = (result) => {
  const diagnostics = Object.freeze(result.diagnostics.map((item) => Object.freeze({ ...item })));
  if (result.state === "ok") {
    return Object.freeze({ ...result, data: immutableJson(result.data), diagnostics });
  }
  return Object.freeze({ ...result, diagnostics });
};
function describeCommandContracts(runtime, targets) {
  const byId = new Map(targets.map((target) => [target.commandId, target]));
  const commands = runtime.descriptors.map((descriptor) => {
    const target = byId.get(descriptor.id);
    if (target === void 0) {
      throw new TypeError(`command contract has no routing target for \xAB${descriptor.id}\xBB`);
    }
    return Object.freeze({
      id: descriptor.id,
      title: descriptor.title,
      summary: descriptor.summary,
      input: Object.freeze({
        subject: descriptor.needsSubject ? "required" : "optional",
        additionalProperties: true
      }),
      effects: Object.freeze({ mutatesSource: descriptor.mutatesSource }),
      routing: Object.freeze({
        operationIds: Object.freeze([...target.operationIds]),
        dataSourceContracts: Object.freeze([...target.dataSourceContracts])
      }),
      callers: Object.freeze([...target.hostCallers]),
      result: Object.freeze({
        states: RESULT_STATES,
        diagnostics: true,
        unavailableAlternativeRequired: true
      })
    });
  });
  if (byId.size !== commands.length) {
    throw new TypeError("command contract targets and live runtime descriptors differ");
  }
  return Object.freeze({
    schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
    commands: Object.freeze(commands)
  });
}
function commandRequest(command, input) {
  if (command === "")
    throw new TypeError("a command request needs a non-empty command id");
  return Object.freeze({
    schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
    command,
    input: snapshotInput(input)
  });
}
async function executeCommandRequest(runtime, request, context) {
  if (request.schemaVersion !== COMMAND_PROTOCOL_SCHEMA_VERSION) {
    throw new TypeError(`unsupported command protocol ${String(request.schemaVersion)}`);
  }
  const stableRequest = commandRequest(request.command, request.input);
  const result = await runtime.run(stableRequest.command, stableRequest.input, context);
  return Object.freeze({
    schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
    request: stableRequest,
    result: snapshotResult(result)
  });
}

// packages/host/dist/commands/immutable-command-targets.js
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value))
      deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
function defineSubjectCommandTargets(targets) {
  return deepFreeze(targets);
}

// packages/host/dist/commands/subject-command-targets.js
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

// packages/host/dist/commands/subject-commands.js
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
  const found = (descriptor.operations ?? []).find((item) => item.id === id && item.state === "available" && item.mutatesSource !== true);
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
      return failed(command, COMMAND_SUBJECT_UNRESOLVED, subject.snapshot.state === "opened" ? "the subject opened without a session" : `no contribution claimed this subject: ${subject.snapshot.reason}`, diagnostics);
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
      result: failed(command, `x3.command/operation-${answer.reason}`, `the subject refused ${handlerId}: ${answer.reason}`, carried)
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
    return withSubject(OPEN_COMMAND, context, String(input.subject), async (subject, _session, descriptor, diagnostics) => {
      const snapshot2 = subject.snapshot;
      if (snapshot2.state !== "opened")
        return failed(OPEN_COMMAND, COMMAND_SUBJECT_UNRESOLVED, "unreachable", diagnostics);
      return ok(OPEN_COMMAND, {
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
      }, diagnostics);
    });
  }
};
var inspectCommand = {
  id: INSPECT_COMMAND,
  title: "Inspect",
  summary: "Report the full descriptor of a subject: identity, traits, operations, data sources.",
  needsSubject: true,
  mutatesSource: false,
  async run(context, input) {
    return withSubject(INSPECT_COMMAND, context, String(input.subject), async (subject, _session, descriptor, diagnostics) => {
      context.progress?.({ step: "describe", message: "reading the descriptor" });
      return ok(INSPECT_COMMAND, {
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
        dataSources: (descriptor.dataSources ?? []).map((item) => `${item.contract}@${item.major}`),
        metadataGroups: (descriptor.metadata ?? []).map((group) => ({
          id: group.id,
          entries: group.entries.length
        }))
      }, diagnostics);
    });
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
    return withSubject(VALIDATE_COMMAND, context, String(input.subject), async (subject, session, descriptor, diagnostics) => {
      const operation = availableOperation(descriptor, VALIDATE);
      if (operation === void 0) {
        return unavailable(VALIDATE_COMMAND, `this subject publishes no available \xAB${VALIDATE}\xBB \u2014 ${publishedOperations(descriptor)}`, "run subject.inspect: it reports every trait and diagnostic the codec did produce, which is what validation would have been reading", diagnostics);
      }
      context.progress?.({ step: "validate", message: "running the codec\u2019s validation" });
      const answer = await invoke(VALIDATE_COMMAND, context, session, operation.handlerId, {}, diagnostics);
      if (answer.state === "failed")
        return answer.result;
      return ok(VALIDATE_COMMAND, {
        ref: subject.ref,
        outputKind: answer.output.kind,
        report: answer.output.value ?? null
      }, diagnostics);
    });
  }
};
async function entryIdFor(session, wanted, signal) {
  const lease2 = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1);
  try {
    const namespace = lease2.value;
    let cursor3;
    do {
      const page = await namespace.list("", cursor3 === void 0 ? { limit: 512 } : { cursor: cursor3, limit: 512 }, signal);
      const found = page.items.find((item) => item.path === wanted || item.id === wanted);
      if (found !== void 0)
        return found.id;
      cursor3 = page.nextCursor;
    } while (cursor3 !== void 0);
    return void 0;
  } finally {
    await lease2.release();
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
    return withSubject(EXTRACT_COMMAND, context, String(input.subject), async (subject, session, descriptor, diagnostics) => {
      const operation = availableOperation(descriptor, CONTAINER_EXTRACT_OPERATION_ID2);
      const listing = (descriptor.dataSources ?? []).some((item) => item.contract === NAMESPACE_ENTRY_SOURCE);
      if (operation === void 0 || !listing) {
        return unavailable(EXTRACT_COMMAND, `this subject is not a container this host can read into \u2014 ${publishedOperations(descriptor)}`, `run subject.inspect to see what it does publish; extraction needs both \xAB${CONTAINER_EXTRACT_OPERATION_ID2}\xBB and \xAB${NAMESPACE_ENTRY_SOURCE}\xBB`, diagnostics);
      }
      context.progress?.({ step: "locate", message: `locating ${entry2}` });
      const entryId = await entryIdFor(session, entry2, context.signal);
      if (entryId === void 0) {
        return failed(EXTRACT_COMMAND, "x3.command/entry-not-found", `this container lists no \xAB${entry2}\xBB`, diagnostics);
      }
      context.progress?.({ step: "extract", message: `extracting ${entry2}` });
      const answer = await invoke(EXTRACT_COMMAND, context, session, operation.handlerId, { entryId }, diagnostics);
      if (answer.state === "failed")
        return answer.result;
      if (answer.output.kind !== "bytes") {
        return failed(EXTRACT_COMMAND, "x3.command/unexpected-output", `the container answered ${answer.output.kind}, not bytes`, diagnostics);
      }
      const bytes = answer.output.value;
      const name = entry2.slice(entry2.lastIndexOf("/") + 1);
      const wroteTo = context.writeOutput === void 0 ? void 0 : await context.writeOutput(name, bytes, context.signal);
      return ok(EXTRACT_COMMAND, {
        ref: subject.ref,
        entry: entry2,
        byteLength: bytes.byteLength,
        ...wroteTo === void 0 ? { wroteTo: null } : { wroteTo }
      }, diagnostics);
    });
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
    return withSubject(CONVERT_COMMAND, context, String(input.subject), async (subject, session, descriptor, diagnostics) => {
      const operation = availableOperation(descriptor, CONVERT) ?? availableOperation(descriptor, RAW_EXPORT);
      if (operation === void 0) {
        return unavailable(CONVERT_COMMAND, `this subject publishes neither \xAB${CONVERT}\xBB nor \xAB${RAW_EXPORT}\xBB \u2014 ${publishedOperations(descriptor)}`, "run subject.inspect to see which data sources it does publish; a universal projection is the route for formats with no native export", diagnostics);
      }
      context.progress?.({ step: "convert", message: "running the codec\u2019s export" });
      const request = typeof input.target === "string" ? { target: input.target } : {};
      const answer = await invoke(CONVERT_COMMAND, context, session, operation.handlerId, request, diagnostics);
      if (answer.state === "failed")
        return answer.result;
      const bytes = answer.output.kind === "bytes" ? answer.output.value : void 0;
      const wroteTo = bytes === void 0 || context.writeOutput === void 0 ? void 0 : await context.writeOutput(`${input.target ?? "export"}`, bytes, context.signal);
      return ok(CONVERT_COMMAND, {
        ref: subject.ref,
        outputKind: answer.output.kind,
        ...bytes === void 0 ? {} : { byteLength: bytes.byteLength },
        ...wroteTo === void 0 ? { wroteTo: null } : { wroteTo }
      }, diagnostics);
    });
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
    return withSubject(PREVIEW_COMMAND, context, String(input.subject), async (subject, session, descriptor, diagnostics) => {
      const thumbnail = availableOperation(descriptor, THUMBNAIL);
      const operation = thumbnail ?? availableOperation(descriptor, RENDER);
      if (operation === void 0) {
        return unavailable(PREVIEW_COMMAND, `this subject publishes no \xAB${THUMBNAIL}\xBB or \xAB${RENDER}\xBB \u2014 ${publishedOperations(descriptor)}`, `mount a viewer over one of its data sources instead: ${(descriptor.dataSources ?? []).map((item) => item.contract).join(", ") || "it publishes none"}`, diagnostics);
      }
      context.progress?.({ step: "preview", message: "rendering the preview" });
      const answer = await invoke(PREVIEW_COMMAND, context, session, operation.handlerId, {}, diagnostics);
      if (answer.state === "failed")
        return answer.result;
      const bytes = answer.output.kind === "bytes" ? answer.output.value : void 0;
      return ok(PREVIEW_COMMAND, {
        ref: subject.ref,
        via: thumbnail === void 0 ? RENDER : THUMBNAIL,
        outputKind: answer.output.kind,
        ...bytes === void 0 ? {} : { byteLength: bytes.byteLength }
      }, diagnostics);
    });
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

// packages/host/dist/commands/subject-opener.js
function commandSubjectsFrom(open) {
  return async (ref, signal) => {
    const answer = await open(ref, signal);
    let disposed = false;
    return {
      ref,
      snapshot: answer.snapshot,
      ...answer.session === void 0 ? {} : { session: answer.session },
      async dispose() {
        if (disposed)
          return;
        disposed = true;
        await answer.session?.dispose();
      }
    };
  };
}

// packages/host/dist/commands/endpoint.js
var DEFAULT_COMMAND_MAX_CONCURRENT_RUNS = 32;
function createSubjectCommandEndpoint(options) {
  const maximum = options.maxConcurrentRuns ?? DEFAULT_COMMAND_MAX_CONCURRENT_RUNS;
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new TypeError("maxConcurrentRuns must be a positive safe integer");
  }
  const runtime = createCommandRuntime(SUBJECT_COMMANDS);
  const opener = commandSubjectsFrom(options.openSubject);
  const active = /* @__PURE__ */ new Set();
  const tasks = /* @__PURE__ */ new Set();
  const byRunId = /* @__PURE__ */ new Map();
  let closed = false;
  let disposing;
  return Object.freeze({
    catalog: describeCommandContracts(runtime, Object.values(SUBJECT_COMMAND_TARGETS)),
    async execute(request, runOptions = {}) {
      if (closed)
        throw new Error("the command endpoint is closed");
      if (active.size >= maximum) {
        throw new RangeError(`the command endpoint already has its ${maximum} permitted runs`);
      }
      const runId = runOptions.runId;
      if (runId !== void 0) {
        if (runId === "")
          throw new TypeError("a command run id must not be empty");
        if (byRunId.has(runId))
          throw new TypeError(`command run \xAB${runId}\xBB is already active`);
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (runOptions.signal?.aborted === true)
        controller.abort();
      else
        runOptions.signal?.addEventListener("abort", abort, { once: true });
      active.add(controller);
      if (runId !== void 0)
        byRunId.set(runId, controller);
      const task = executeCommandRequest(runtime, request, {
        openSubject: opener,
        signal: controller.signal,
        ...runOptions.progress === void 0 ? {} : { progress: runOptions.progress },
        ...runOptions.writeOutput === void 0 ? {} : { writeOutput: runOptions.writeOutput }
      });
      tasks.add(task);
      try {
        return await task;
      } finally {
        tasks.delete(task);
        active.delete(controller);
        if (runId !== void 0)
          byRunId.delete(runId);
        runOptions.signal?.removeEventListener("abort", abort);
      }
    },
    cancel(runId) {
      const controller = byRunId.get(runId);
      controller?.abort();
      return controller !== void 0;
    },
    dispose() {
      if (disposing !== void 0)
        return disposing;
      closed = true;
      for (const controller of active)
        controller.abort();
      disposing = Promise.allSettled([...tasks]).then(() => void 0);
      return disposing;
    },
    get activeRuns() {
      return active.size;
    },
    get closed() {
      return closed;
    }
  });
}

// packages/host/dist/commands/index.js
function createSubjectCommandRuntime() {
  return createCommandRuntime(SUBJECT_COMMANDS);
}
function describeSubjectCommandContracts() {
  return describeCommandContracts(createSubjectCommandRuntime(), Object.values(SUBJECT_COMMAND_TARGETS));
}

// packages/host/dist/detection-selection.js
var EVIDENCE_KINDS = Object.freeze([
  "magic",
  "structure",
  "companion",
  "context",
  "extension",
  "user-override"
]);
function fail(code, message) {
  throw new ModkitError({ code, message });
}
function exactObject(value, required, optional, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("x3.host/invalid-detection-selection", `${label} must be an object`);
  }
  const record = value;
  const allowed2 = /* @__PURE__ */ new Set([...required, ...optional]);
  if (required.some((key2) => !(key2 in record)) || Object.keys(record).some((key2) => !allowed2.has(key2))) {
    return fail("x3.host/invalid-detection-selection", `${label} has missing or unknown fields`);
  }
  return record;
}
function nonBlank(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail("x3.host/invalid-detection-selection", `${label} must be a non-blank string`);
  }
  return value;
}
function evidence(value, label) {
  if (!Array.isArray(value)) {
    return fail("x3.host/invalid-detection-selection", `${label} must be an array`);
  }
  return Object.freeze(value.map((raw, index) => {
    const item = exactObject(raw, ["kind", "weight"], ["note"], `${label}[${index}]`);
    if (!EVIDENCE_KINDS.includes(item.kind)) {
      return fail("x3.host/invalid-detection-selection", `${label}[${index}].kind is invalid`);
    }
    if (typeof item.weight !== "number" || !Number.isFinite(item.weight)) {
      return fail("x3.host/invalid-detection-selection", `${label}[${index}].weight must be finite`);
    }
    if (item.note !== void 0 && typeof item.note !== "string") {
      return fail("x3.host/invalid-detection-selection", `${label}[${index}].note must be a string`);
    }
    return Object.freeze({
      kind: item.kind,
      weight: item.weight,
      ...item.note === void 0 ? {} : { note: item.note }
    });
  }));
}
function normalize(value) {
  const root = exactObject(value, ["schemaVersion", "sourceRevision", "selected"], [], "selection");
  if (root.schemaVersion !== 1) {
    return fail("x3.host/invalid-detection-selection", "selection schemaVersion is unsupported");
  }
  const sourceRevision = revisionId(nonBlank(root.sourceRevision, "selection.sourceRevision"));
  const selected = exactObject(root.selected, [
    "extensionId",
    "contributionId",
    "variantId",
    "offerId",
    "artifactDigest",
    "manifestDigest",
    "sourceTopology",
    "confidence",
    "evidence"
  ], [], "selection.selected");
  const extensionId = nonBlank(selected.extensionId, "selection.selected.extensionId");
  const contributionText = nonBlank(selected.contributionId, "selection.selected.contributionId");
  if (!isQualifiedId(extensionId) || !isQualifiedId(contributionText)) {
    return fail("x3.host/invalid-detection-selection", "selection extension and contribution coordinates must be qualified");
  }
  const topology = selected.sourceTopology;
  if (!["single", "bundle", "namespace", "derived"].includes(String(topology))) {
    return fail("x3.host/invalid-detection-selection", "selection sourceTopology is invalid");
  }
  const confidence = selected.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return fail("x3.host/invalid-detection-selection", "selection confidence is invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    sourceRevision,
    selected: Object.freeze({
      extensionId,
      contributionId: contributionId(contributionText),
      variantId: nonBlank(selected.variantId, "selection.selected.variantId"),
      offerId: nonBlank(selected.offerId, "selection.selected.offerId"),
      artifactDigest: nonBlank(selected.artifactDigest, "selection.selected.artifactDigest"),
      manifestDigest: nonBlank(selected.manifestDigest, "selection.selected.manifestDigest"),
      sourceTopology: topology,
      confidence,
      evidence: evidence(selected.evidence, "selection.selected.evidence")
    })
  });
}
function buildCodecDetectionSelection(input) {
  if (input.detection.codecId !== input.contributionId) {
    return fail("x3.host/detection-selection-mismatch", "detection codecId does not match the selected contribution");
  }
  return normalize({
    schemaVersion: 1,
    sourceRevision: input.sourceRevision,
    selected: {
      extensionId: input.extensionId,
      contributionId: input.contributionId,
      variantId: input.variantId,
      offerId: input.offerId,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      sourceTopology: input.sourceTopology,
      confidence: input.detection.confidence,
      evidence: input.detection.evidence
    }
  });
}
function serializeCodecDetectionSelection(selection) {
  return canonicalJsonStringify(normalize(selection));
}
function parseCodecDetectionSelection(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("x3.host/invalid-detection-selection", "detection selection is not valid JSON");
  }
  const selection = normalize(raw);
  if (canonicalJsonStringify(selection) !== text) {
    return fail("x3.host/invalid-detection-selection", "detection selection bytes are not canonical");
  }
  return selection;
}
function replayCodecDetectionSelection(inventory, sourceRevision, text) {
  const selection = parseCodecDetectionSelection(text);
  if (selection.sourceRevision !== sourceRevision) {
    return fail("x3.host/detection-source-mismatch", "codec detection selection belongs to a different source revision");
  }
  const matches = offersFromInventory(inventory).filter((offer) => {
    if (offer.extensionId !== selection.selected.extensionId || offer.providerId !== selection.selected.contributionId || offer.runtimeVariant !== selection.selected.variantId || !offer.provides.some((logical) => logical.offerId === selection.selected.offerId)) {
      return false;
    }
    const binding = inventoryBindingForOffer(offer);
    if (binding === void 0 || binding.record.artifactDigest !== selection.selected.artifactDigest || binding.record.manifestDigest !== selection.selected.manifestDigest) {
      return false;
    }
    const spec = binding.contribution.manifest?.spec;
    return spec?.sourceTopology === selection.selected.sourceTopology;
  });
  if (matches.length !== 1) {
    return fail("x3.host/detection-selection-unavailable", `current inventory has ${matches.length} exact matches for the codec detection selection`);
  }
  return selection;
}

// packages/host/dist/detection-rules.js
var DETECTION_EVIDENCE_LADDER = Object.freeze([
  "name-only",
  "generic-syntax",
  "carrier-magic",
  "generic-syntax-and-format-marker",
  "carrier-magic-and-format-structure",
  "format-magic",
  "format-magic-and-second-signal"
]);
function compareDetectionEvidence(left, right) {
  const a = DETECTION_EVIDENCE_LADDER.indexOf(left);
  const b = DETECTION_EVIDENCE_LADDER.indexOf(right);
  if (a < 0 || b < 0)
    throw new TypeError(`unknown detection evidence rung: ${left} / ${right}`);
  return a === b ? 0 : a < b ? -1 : 1;
}
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
    enforcedBy: "extensions/documents/src/odf/package.js and its peers"
  }),
  Object.freeze({
    id: "a-declaration-scopes-a-generic",
    rule: "A contribution is put in front of the probe only for bytes its own declaration matches by name or signature, and that \u2014 not confidence \u2014 is what keeps a generic away from another format\u2019s body. `text-ini` scores `Key=Value` lines happily but declares only `.ini`, so it never sees a publisher-specific text file; `text-csv` declares `.csv` and `.tsv`, so it never sees an unrelated atlas index. A generic that widens its declaration to every path gives this protection up and must then win every collision on confidence alone.",
    enforcedBy: "matchesSpec in packages/host/src/subject-open.ts (an empty rule set is not a wildcard); proved in packages/testkit/test/detection-collisions.test.ts"
  }),
  Object.freeze({
    id: "a-signature-shortlists-but-does-not-select",
    rule: "A declared byte signature only puts a contribution in front of the probe \u2014 a renamed `.dat` PNG reaches the PNG probe. Selection is still decided by the probe result, so a signature can never open a subject on its own.",
    enforcedBy: "packages/host/src/detection-index.ts"
  })
]);
function isDetectionUntieRule(id) {
  return DETECTION_UNTIE_RULES.some((rule) => rule.id === id);
}

// packages/host/dist/source-bridge.js
function invalidRange(sourceId, offset, length, size, message) {
  return new ModkitError({
    code: "x3.host/source-range-unrepresentable",
    message,
    context: {
      sourceId,
      offset: offset.toString(),
      length: length.toString(),
      size: size.toString()
    }
  });
}
function checkedRange(sourceId, size, offset, length) {
  if (offset < 0n || length < 0n || offset > size || length > size - offset) {
    throw invalidRange(sourceId, offset, length, size, `read [${offset}, ${offset + length}) exceeds source \xAB${sourceId}\xBB of size ${size}`);
  }
  if (offset > BigInt(Number.MAX_SAFE_INTEGER) || length > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidRange(sourceId, offset, length, size, `read range for source \xAB${sourceId}\xBB cannot be represented exactly by the current VFS`);
  }
  const start = Number(offset);
  const numericLength = Number(length);
  const end = start + numericLength;
  if (!Number.isSafeInteger(end)) {
    throw invalidRange(sourceId, offset, length, size, `read end for source \xAB${sourceId}\xBB cannot be represented exactly by the current VFS`);
  }
  return { start, length: numericLength, end };
}
async function artifactByteSourceFromRandomAccess(source, options) {
  throwIfAborted(options.signal);
  const numericSize = await source.size(options.signal);
  throwIfAborted(options.signal);
  if (!Number.isSafeInteger(numericSize) || numericSize < 0) {
    throw new ModkitError({
      code: "x3.host/source-size-unrepresentable",
      message: `source \xAB${source.id}\xBB reported a size outside the exact JavaScript integer range`,
      context: { sourceId: source.id, size: String(numericSize) }
    });
  }
  const size = BigInt(numericSize);
  const ref = Object.freeze({
    ...options.ref,
    ...options.ref.parentIds === void 0 ? {} : {
      parentIds: Object.freeze([...options.ref.parentIds])
    }
  });
  const bridged = {
    kind: "bytes",
    ref,
    revision: options.revision,
    size,
    async read(offset, length, signal) {
      throwIfAborted(signal);
      if (!Number.isSafeInteger(length) || length < 0) {
        throw invalidRange(source.id, offset, BigInt(Number.isFinite(length) ? Math.trunc(length) : 0), size, `read length for source \xAB${source.id}\xBB must be a non-negative safe integer`);
      }
      const range = checkedRange(source.id, size, offset, BigInt(length));
      const bytes = await source.readAt(range.start, range.length, signal);
      throwIfAborted(signal);
      if (bytes.byteLength !== range.length) {
        throw new ModkitError({
          code: "x3.host/source-short-read",
          message: `source \xAB${source.id}\xBB returned ${bytes.byteLength} bytes for an exact ${range.length}-byte read`,
          context: { sourceId: source.id, expected: range.length, actual: bytes.byteLength }
        });
      }
      return bytes;
    },
    async *stream(range, signal) {
      throwIfAborted(signal);
      const offset = range?.offset ?? 0n;
      const length = range?.length ?? size - offset;
      const checked = checkedRange(source.id, size, offset, length);
      const reader = source.stream(checked.start, checked.end, signal).getReader();
      let seen = 0;
      try {
        for (; ; ) {
          throwIfAborted(signal);
          const next = await reader.read();
          if (next.done)
            break;
          seen += next.value.byteLength;
          if (seen > checked.length) {
            throw new ModkitError({
              code: "x3.host/source-stream-overrun",
              message: `source \xAB${source.id}\xBB streamed beyond its requested range`,
              context: { sourceId: source.id, expected: checked.length, actual: seen }
            });
          }
          yield next.value;
        }
        if (seen !== checked.length) {
          throw new ModkitError({
            code: "x3.host/source-short-stream",
            message: `source \xAB${source.id}\xBB streamed ${seen} bytes for an exact ${checked.length}-byte range`,
            context: { sourceId: source.id, expected: checked.length, actual: seen }
          });
        }
      } finally {
        if (seen < checked.length)
          await reader.cancel().catch(() => void 0);
        reader.releaseLock();
      }
    }
  };
  return Object.freeze(bridged);
}

// packages/host/dist/detection-index.js
var MAX_SIGNATURE_WINDOW_BYTES = 4096 + 64;
var clamp = (value) => Math.min(value, MAX_SIGNATURE_WINDOW_BYTES);
function signatureNeeds(ruleSets) {
  let prefix = 0;
  let suffix = 0;
  for (const rules of ruleSets) {
    for (const rule of rules) {
      const length = rule.bytesHex.length / 2;
      if (rule.from === "start")
        prefix = Math.max(prefix, rule.offset + length);
      else
        suffix = Math.max(suffix, rule.offset);
    }
  }
  return { prefix: clamp(prefix), suffix: clamp(suffix) };
}
function parseHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
function matchesSignatures(rules, windows) {
  if (rules === void 0 || rules.length === 0)
    return false;
  const size = windows.size;
  for (const rule of rules) {
    const pattern = parseHex(rule.bytesHex);
    const mask = rule.maskHex === void 0 ? void 0 : parseHex(rule.maskHex);
    if (mask !== void 0 && mask.length !== pattern.length)
      continue;
    if (rule.from === "end" && rule.offset < pattern.length)
      continue;
    const patternEnd = BigInt(rule.offset) + (rule.from === "start" ? BigInt(pattern.length) : 0n);
    if (patternEnd > size)
      continue;
    const window = rule.from === "start" ? windows.head : windows.tail;
    const start = rule.from === "start" ? rule.offset : window.length - rule.offset;
    if (start < 0 || start + pattern.length > window.length)
      continue;
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const m = mask?.[index] ?? 255;
      if ((window[start + index] & m) !== (pattern[index] & m)) {
        matched = false;
        break;
      }
    }
    if (matched)
      return true;
  }
  return false;
}

// packages/host/dist/resolution/resolver.js
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
  if (requirement.id !== offer.id)
    return false;
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
  return (needed ?? []).every((requirement) => offered.some((offer) => traitOfferMatches(requirement, offer)));
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
  return (values ?? []).every((value) => isStandardTraitId(value.id) ? value.definitionRange === void 0 : value.definitionRange !== void 0 && parseVersionRange(value.definitionRange) !== void 0);
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
      reject(offer, "no-offer", `does not provide ${request.contract.contract}@${request.contract.major}`);
      continue;
    }
    if (offer.kind !== "primary" && offer.kind !== "replacement") {
      reject(offer, "unsupported-kind", `resolver v1 executes only primary/replacement, got ${offer.kind}`);
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
    return remember({ state: "unresolved", reason: "no-offer", rejected: sortRejected(rejected2) }, request);
  }
  const range = parseVersionRange(request.contract.range ?? "*");
  const versionOk = candidates.filter((candidate) => {
    const version = parseSemver(candidate.contractOffer.version);
    if (version === void 0 || range === void 0 || !satisfiesRange(version, range)) {
      reject(candidate.offer, "version-incompatible", `${candidate.contractOffer.version} \u2209 ${request.contract.range ?? "*"}`, candidate.contractOffer.offerId);
      return false;
    }
    return true;
  });
  if (versionOk.length === 0) {
    return remember({
      state: "unresolved",
      reason: "version-incompatible",
      rejected: sortRejected(rejected2)
    }, request);
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
    return remember({
      state: "unresolved",
      reason: onlyToolRejects ? "external-tool-required" : "target-incompatible",
      rejected: sortRejected(rejected2)
    }, request);
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
    return remember({
      state: "unresolved",
      reason: sawPermissionReject ? "permission-required" : "output-missing",
      rejected: sortRejected(rejected2)
    }, request);
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
      return remember({
        state: "unresolved",
        reason: "pin-unsatisfied",
        rejected: sortRejected(rejected2)
      }, request);
    }
  }
  const score = (candidate) => [
    request.operation !== void 0 && (candidate.offer.operations ?? []).includes(request.operation) ? 1 : 0,
    preferredOutputs.filter((requirement) => (candidate.offer.outputs ?? []).some((offer) => traitOfferMatches(requirement, offer))).length
  ];
  const compareTuple = (a, b) => {
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i])
        return a[i] < b[i] ? 1 : -1;
    }
    return 0;
  };
  const ranked = [...pool].sort((a, b) => compareTuple(score(a), score(b)) || compareUtf8(candidateSortKey(a), candidateSortKey(b)));
  const best = ranked[0];
  const tied = ranked.filter((c) => compareTuple(score(c), score(best)) === 0);
  if (tied.length > 1) {
    for (const candidate of tied) {
      reject(candidate.offer, "ambiguous", "preference tuple tie", candidate.contractOffer.offerId);
    }
    return remember({ state: "unresolved", reason: "ambiguous", rejected: sortRejected(rejected2) }, request);
  }
  const toResolved = (candidate) => ({
    offer: candidate.offer,
    resolvedContract: candidate.contractOffer,
    ...candidate.contractSelectionKey === void 0 ? {} : { contractSelectionKey: candidate.contractSelectionKey }
  });
  return remember({
    state: "resolved",
    selected: toResolved(best),
    alternatives: ranked.slice(1).map(toResolved),
    rejected: sortRejected(rejected2)
  }, request);
}
function sortRejected(rejected2) {
  return [...rejected2].sort((a, b) => compareUtf8(canonicalJsonStringify(a), canonicalJsonStringify(b)));
}

// packages/host/dist/resolution/lock.js
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
function lockKeyString(key2) {
  return canonicalJsonStringify(key2);
}
function serializePolicyLock(entries) {
  const seen = /* @__PURE__ */ new Map();
  for (const entry2 of entries) {
    const key2 = lockKeyString(entry2.key);
    const rendered = canonicalJsonStringify(entry2);
    const prior = seen.get(key2);
    if (prior !== void 0 && prior !== rendered) {
      throw new ModkitError({
        code: "x3.host/conflicting-lock-entries",
        message: "two policy-lock entries share one key but select differently \u2014 one request cannot have two answers",
        context: { key: key2 }
      });
    }
    seen.set(key2, rendered);
  }
  const sorted = [...entries].sort((a, b) => {
    const byKey = compareUtf8(lockKeyString(a.key), lockKeyString(b.key));
    return byKey !== 0 ? byKey : compareUtf8(canonicalJsonStringify(a), canonicalJsonStringify(b));
  });
  return canonicalJsonStringify({ schemaVersion: 1, entries: sorted });
}
function failLock(message, context) {
  throw new ModkitError({
    code: "x3.host/invalid-policy-lock",
    message,
    ...context === void 0 ? {} : { context }
  });
}
function exactKeys(value, required, optional, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failLock(`${label} must be an object`);
  }
  const record = value;
  const allowed2 = /* @__PURE__ */ new Set([...required, ...optional]);
  if (required.some((key2) => !(key2 in record)) || Object.keys(record).some((key2) => !allowed2.has(key2))) {
    return failLock(`${label} has missing or unknown fields`);
  }
  return record;
}
function lockString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return failLock(`${label} must be a non-blank string`);
  }
  return value;
}
function lockMajor(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    return failLock(`${label} must be a safe non-negative integer`);
  }
  return value;
}
function parseLockedTrait(value, label) {
  const record = exactKeys(value, ["id"], ["definitionRange"], label);
  const idText = lockString(record.id, `${label}.id`);
  if (!isTraitId(idText))
    return failLock(`${label}.id must be a trait id`);
  if (isStandardTraitId(idText)) {
    if (record.definitionRange !== void 0) {
      return failLock(`${label}: a standard trait cannot carry definitionRange`);
    }
    return Object.freeze({ id: idText });
  }
  const rangeText = lockString(record.definitionRange, `${label}.definitionRange`);
  const range = parseVersionRange(rangeText);
  if (range === void 0 || range.normalized !== rangeText) {
    return failLock(`${label}.definitionRange is not canonical`);
  }
  return Object.freeze({ id: idText, definitionRange: rangeText });
}
function parseLockedTraits(value, label) {
  if (!Array.isArray(value))
    return failLock(`${label} must be an array`);
  const parsed = value.map((item, index) => parseLockedTrait(item, `${label}[${index}]`));
  const normalized = normalizeTraitRequirements(parsed);
  if (canonicalJsonStringify(parsed) !== canonicalJsonStringify(normalized)) {
    return failLock(`${label} must be unique and canonically sorted`);
  }
  return normalized;
}
function parseLockKey(value, label) {
  const record = exactKeys(value, ["contract", "major", "normalizedRange", "requiredOutputs", "preferredOutputs"], ["contractSelectionKey", "operation", "workload"], label);
  const contractText = lockString(record.contract, `${label}.contract`);
  if (!isQualifiedId(contractText))
    return failLock(`${label}.contract must be qualified`);
  const rangeText = lockString(record.normalizedRange, `${label}.normalizedRange`);
  const range = parseVersionRange(rangeText);
  if (range === void 0 || range.normalized !== rangeText) {
    return failLock(`${label}.normalizedRange is not canonical`);
  }
  const workload = record.workload;
  if (workload !== void 0 && !["thumbnail", "interactive", "batch", "lossless-edit", "simulation", "archival"].includes(String(workload))) {
    return failLock(`${label}.workload is invalid`);
  }
  return Object.freeze({
    contract: contractId(contractText),
    major: lockMajor(record.major, `${label}.major`),
    normalizedRange: rangeText,
    ...record.contractSelectionKey === void 0 ? {} : {
      contractSelectionKey: lockString(record.contractSelectionKey, `${label}.contractSelectionKey`)
    },
    ...record.operation === void 0 ? {} : {
      operation: lockString(record.operation, `${label}.operation`)
    },
    requiredOutputs: parseLockedTraits(record.requiredOutputs, `${label}.requiredOutputs`),
    preferredOutputs: parseLockedTraits(record.preferredOutputs, `${label}.preferredOutputs`),
    ...workload === void 0 ? {} : { workload }
  });
}
function parseSelection(value, label) {
  const record = exactKeys(value, ["extension", "contributionId", "contractMajor", "offerId"], ["releaseRange"], label);
  const extension = lockString(record.extension, `${label}.extension`);
  const contributionId2 = lockString(record.contributionId, `${label}.contributionId`);
  if (!isQualifiedId(extension) || !isQualifiedId(contributionId2)) {
    return failLock(`${label} coordinates must be qualified`);
  }
  let releaseRange;
  if (record.releaseRange !== void 0) {
    releaseRange = lockString(record.releaseRange, `${label}.releaseRange`);
    const parsed = parseVersionRange(releaseRange);
    if (parsed === void 0 || parsed.normalized !== releaseRange) {
      return failLock(`${label}.releaseRange is not canonical`);
    }
  }
  return Object.freeze({
    extension,
    ...releaseRange === void 0 ? {} : { releaseRange },
    contributionId: contributionId2,
    contractMajor: lockMajor(record.contractMajor, `${label}.contractMajor`),
    offerId: lockString(record.offerId, `${label}.offerId`)
  });
}
function parsePolicyLock(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return failLock("policy lock is not valid JSON");
  }
  const root = exactKeys(value, ["schemaVersion", "entries"], [], "policy lock");
  if (root.schemaVersion !== 1 || !Array.isArray(root.entries)) {
    return failLock("policy lock schemaVersion/entries are invalid");
  }
  const entries = root.entries.map((raw, index) => {
    const item = exactKeys(raw, ["key", "primary", "resolverVersion"], ["allowedFallbacks"], `entries[${index}]`);
    if (item.resolverVersion !== RESOLVER_VERSION) {
      return failLock(`entries[${index}].resolverVersion is unsupported`);
    }
    if (item.allowedFallbacks !== void 0 && !Array.isArray(item.allowedFallbacks)) {
      return failLock(`entries[${index}].allowedFallbacks must be an array`);
    }
    return Object.freeze({
      key: parseLockKey(item.key, `entries[${index}].key`),
      primary: parseSelection(item.primary, `entries[${index}].primary`),
      ...item.allowedFallbacks === void 0 ? {} : {
        allowedFallbacks: Object.freeze(item.allowedFallbacks.map((entry2, fallbackIndex) => parseSelection(entry2, `entries[${index}].allowedFallbacks[${fallbackIndex}]`)))
      },
      resolverVersion: RESOLVER_VERSION
    });
  });
  const canonical = serializePolicyLock(entries);
  if (canonical !== text)
    return failLock("policy lock bytes are not canonical");
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) });
}
function replayPolicyLock(request, offers, text) {
  const lock = parsePolicyLock(text);
  const requestKey = buildLockKey(request);
  const candidates = lock.entries.filter((entry2) => {
    const portable = Object.fromEntries(Object.entries(entry2.key).filter(([field]) => field !== "contractSelectionKey"));
    return canonicalJsonStringify(portable) === canonicalJsonStringify(requestKey);
  });
  if (candidates.length !== 1) {
    throw new ModkitError({
      code: "x3.host/lock-key-unresolved",
      message: `policy lock contains ${candidates.length} entries for the request key`
    });
  }
  const locked = candidates[0];
  const available = offers.filter((offer) => {
    if (offer.extensionId !== locked.primary.extension || offer.providerId !== locked.primary.contributionId) {
      return false;
    }
    if (locked.primary.releaseRange !== void 0) {
      const version = parseSemver(offer.extensionVersion);
      const range = parseVersionRange(locked.primary.releaseRange);
      if (version === void 0 || range === void 0 || !satisfiesRange(version, range))
        return false;
    }
    return offer.provides.some((provided) => provided.major === locked.primary.contractMajor && provided.offerId === locked.primary.offerId);
  });
  return resolveProvider({
    ...request,
    pin: {
      providerId: locked.primary.contributionId,
      offerId: locked.primary.offerId
    }
  }, available);
}

// packages/host/dist/resolution/service-resolver.js
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
    const result = await resolveServiceProvider(providerRequest, options.offers, options.definitions);
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

// packages/host/dist/execution/backend.js
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
    const profile3 = backend.profile;
    const supports = backend.supports;
    const activate = backend.activate;
    if (!PROFILE_VALUES.includes(profile3)) {
      throw invalid(`execution backend[${index}] has an invalid profile`);
    }
    if (typeof supports !== "function" || typeof activate !== "function") {
      throw invalid(`execution backend ${profile3} must provide supports and activate callbacks`);
    }
    if (bindings.has(profile3)) {
      throw invalid(`execution backend profile ${profile3} is registered more than once`);
    }
    bindings.set(profile3, Object.freeze({ profile: profile3, supports, activate }));
  }
  const profiles = Object.freeze([...bindings.keys()].sort());
  const registry = {
    profiles,
    supports(profile3, target, variant) {
      try {
        const binding = bindings.get(profile3);
        if (binding === void 0 || variant.executionProfile !== profile3)
          return false;
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
  const profile3 = context.variant.executionProfile;
  const binding = bindings.get(profile3);
  if (binding === void 0 || !registry.supports(profile3, context.target, context.variant)) {
    throw new ModkitError({
      code: "x3.host/execution-backend-unavailable",
      message: `no execution backend can honour ${profile3} for ${context.target.environment}`,
      context: { profile: profile3, environment: context.target.environment }
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
    throw invalid(`execution backend ${profile3} returned an invalid module lease`);
  }
  let released = false;
  return Object.freeze({
    module: raw.module,
    async release() {
      if (released)
        return;
      released = true;
      await raw.release();
    }
  });
}
var TRUSTED_IN_PROCESS_EXECUTION_BACKEND = /* @__PURE__ */ Object.freeze({
  profile: "trusted-in-process",
  supports: (_target, variant) => variant.executionProfile === "trusted-in-process",
  async activate(context) {
    throwIfAborted(context.signal);
    const module = await import(context.entrypoint.href);
    return Object.freeze({ module, release: async () => void 0 });
  }
});
function linkedInProcessBackend(linked) {
  return Object.freeze({
    profile: "trusted-in-process",
    supports: (_target, variant) => variant.executionProfile === "trusted-in-process",
    async activate(context) {
      throwIfAborted(context.signal);
      const preLinked = linked.get(context.entrypoint.href);
      if (preLinked !== void 0) {
        return Object.freeze({ module: preLinked, release: async () => void 0 });
      }
      if (context.entrypoint.protocol === "modkit-linked:") {
        throw new ModkitError({
          code: "x3.host/linked-module-missing",
          message: `no linked module was registered for ${context.entrypoint.href}`,
          context: { entrypoint: context.entrypoint.href }
        });
      }
      const module = await import(context.entrypoint.href);
      return Object.freeze({ module, release: async () => void 0 });
    }
  });
}
var DEFAULT_EXECUTION_BACKENDS = /* @__PURE__ */ createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND]);

// packages/host/dist/security/gate.js
var issuedTickets = /* @__PURE__ */ new WeakSet();
var ticketBindings = /* @__PURE__ */ new WeakMap();
function resolveForActivation(request, offers, operation) {
  const result = resolveProvider(request, offers);
  if (result.state !== "resolved")
    return { result };
  const binding = inventoryBindingForOffer(result.selected.offer);
  if (binding === void 0)
    return { result };
  return { result, ticket: issueActivationTicket(result, request.target, operation) };
}
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
  return diagnostic("information", PERMISSION_DEGRADED_DIAGNOSTIC, `\xAB${contributionId2}\xBB runs without ${degraded.join(", ")}: the grant does not cover these classes, so the operations that need them are disabled (ADR-HOST-002 \xA72)`, [contributionId2], { degraded });
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
  const c = variant.target;
  const problems = [];
  const has = (list, value, anyAllowed = false) => list === void 0 || anyAllowed && list.includes("any") || list.includes(value);
  if (!has(c.environments, target.environment))
    problems.push(`environment ${target.environment}`);
  if (!has(c.operatingSystems, target.operatingSystem, true)) {
    problems.push(`operatingSystem ${target.operatingSystem}`);
  }
  if (!has(c.architectures, target.architecture, true)) {
    problems.push(`architecture ${target.architecture}`);
  }
  for (const cap of c.requiredHostCapabilities ?? []) {
    if (!(target.hostCapabilities ?? []).includes(cap))
      problems.push(`hostCapability ${cap}`);
  }
  for (const api of c.requiredWebApis ?? []) {
    if (!(target.webApis ?? []).includes(api))
      problems.push(`webApi ${api}`);
  }
  for (const tool of c.externalTools ?? []) {
    if (!(target.externalTools ?? []).includes(tool))
      problems.push(`externalTool ${tool}`);
  }
  return problems;
}
async function activateContribution(request) {
  throwIfAborted(request.signal);
  const { ticket } = request;
  const ticketBinding = ticketBindings.get(ticket);
  if (!issuedTickets.has(ticket) || ticketBinding === void 0 || ticketBinding.ticketFingerprint !== ticketFingerprint(ticket)) {
    throw deny("x3.host/invalid-ticket", "activation requires a ticket issued by this host from a real resolution");
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
  if (ticket.contributionId !== manifest.id)
    mismatches.push("contribution");
  if (ticket.contributionContract.id !== manifest.contract.id)
    mismatches.push("contract");
  if (ticket.contributionContract.major !== manifest.contract.major)
    mismatches.push("contract major");
  if (mismatches.length > 0) {
    throw deny("x3.host/ticket-manifest-mismatch", `the ticket does not describe this contribution (${mismatches.join(", ")})`, { mismatches, ticketContribution: ticket.contributionId, manifestId: manifest.id });
  }
  if (!await privateRecord.verifyArtifactDigest(ticket.artifactDigest)) {
    throw deny("x3.host/artifact-digest-mismatch", "the selected artifact changed after inventory and will not be imported", { inventoryRecordId: ticket.inventoryRecordId });
  }
  const variant = (manifest.runtimeVariants ?? []).find((v) => v.variantId === ticket.variantId);
  if (!variant) {
    throw deny("x3.host/unknown-variant", `contribution \xAB${manifest.id}\xBB has no runtime variant \xAB${ticket.variantId}\xBB`);
  }
  const targetProblems = targetSatisfies(variant, ticket.target);
  if (targetProblems.length > 0) {
    throw deny("x3.host/target-incompatible", `variant \xAB${variant.variantId}\xBB does not support this target: ${targetProblems.join(", ")}`, { problems: targetProblems });
  }
  const executionBackends = request.executionBackends ?? DEFAULT_EXECUTION_BACKENDS;
  if (!executionBackends.supports(variant.executionProfile, ticket.target, variant)) {
    throw deny("x3.host/execution-backend-unavailable", `profile \xAB${variant.executionProfile}\xBB has no backend for ${ticket.target.environment} \u2014 refusing rather than running under a weaker boundary (24 \xA76.1 rule 1)`, { profile: variant.executionProfile, environment: ticket.target.environment });
  }
  if (variant.executionProfile === "trusted-in-process" && privateRecord.execution.allowTrustedInProcess !== true) {
    throw deny("x3.host/trusted-in-process-not-authorized", `extension \xAB${ticket.extensionId}\xBB came from ${privateRecord.execution.origin} inventory without an explicit host decision allowing full process authority`, { extensionId: ticket.extensionId, origin: privateRecord.execution.origin });
  }
  const validity = grantValidity(request.grant);
  if (validity.state !== "valid") {
    throw deny("x3.host/grant-not-live", validity.state === "malformed" ? `grant \xAB${request.grant.id}\xBB has an unparseable expiresAt (\xAB${validity.value}\xBB) \u2014 treated as expired` : `grant \xAB${request.grant.id}\xBB expired at ${validity.at}`, { grant: request.grant.id, validity: validity.state });
  }
  const probeScoped = ticket.operation === PROBE_OPERATION;
  const requestedClasses = probeScoped ? variant.requestedPermissionClasses.filter((item) => PROBE_PERMISSION_CLASSES.includes(item)) : variant.requestedPermissionClasses;
  const callerProbeCeiling = request.policy?.operationClasses?.[PROBE_OPERATION];
  const policy = probeScoped ? {
    ...request.policy,
    operationClasses: {
      ...request.policy?.operationClasses,
      [PROBE_OPERATION]: callerProbeCeiling === void 0 ? PROBE_PERMISSION_CLASSES : callerProbeCeiling.filter((item) => PROBE_PERMISSION_CLASSES.includes(item))
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
    throw deny("x3.host/permission-denied", `grant \xAB${request.grant.id}\xBB does not cover: ${hardMissing.join(", ")}`, { missing: hardMissing });
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
  if (degraded.length > 0)
    diagnostics.push(permissionDegradedDiagnostic(manifest.id, degraded));
  if (variant.executionProfile === "worker-brokered") {
    diagnostics.push(diagnostic("information", "x3.host/worker-shared-process", `\xAB${manifest.id}\xBB runs worker-brokered: a crash, hang or protocol violation of this code is isolated from the host, but the worker shares the process \u2014 it is not a security sandbox (24 \xA76.1 SB-1).`, [manifest.id], { grant: child.id, classes: child.classes }));
  }
  if (variant.executionProfile === "trusted-in-process") {
    diagnostics.push(diagnostic("warning", "x3.host/full-process-authority", `\xAB${manifest.id}\xBB runs as trusted-in-process: the host checks grants at dispatch and brokers what it owns, but it cannot technically prevent this code from reaching Node.js filesystem/network built-ins or the process itself. This is an audit/policy boundary, not a sandbox (24 \xA75.1).`, [manifest.id], { grant: child.id, classes: child.classes }));
  }
  return {
    module: backendLease.module,
    variant,
    effectiveGrant: child,
    diagnostics,
    release: backendLease.release
  };
}

// packages/host/dist/service-leases.js
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
  const fail2 = async (code, message) => {
    await activation.release();
    throw new ModkitError({ code, message });
  };
  if (activation.module["abiVersion"] !== 1 || typeof activation.module["createProvider"] !== "function") {
    return fail2("x3.host/invalid-service-provider-module", `provider ${providerId} does not implement ServiceProviderModule ABI v1`);
  }
  const createProvider5 = activation.module["createProvider"];
  let lease2;
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
    lease2 = await createProvider5(options.selection, context);
  } catch (error3) {
    await activation.release();
    throw error3;
  }
  if (typeof lease2 !== "object" || lease2 === null || !("value" in lease2) || typeof lease2.release !== "function") {
    return fail2("x3.host/invalid-service-provider-lease", `provider ${providerId} returned an invalid lease`);
  }
  let released = false;
  return Object.freeze({
    lease: lease2,
    effectiveGrant: activation.effectiveGrant,
    executionProfile: activation.variant.executionProfile,
    async release() {
      if (released)
        return;
      released = true;
      try {
        await lease2.release();
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
      const key2 = `${selection.contract}@${selection.major}:${result.selected.offer.providerId}:${selection.offerId}`;
      if (chain.includes(key2)) {
        throw new ModkitError({
          code: "x3.host/service-dependency-cycle",
          message: `service activation cycle detected at ${key2}`
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
          contracts: makePort(effectiveGrant, [...chain, key2]),
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
      activationFacts.push(Object.freeze({
        providerId: result.selected.offer.providerId,
        contract: selection.contract,
        major: selection.major,
        offerId: selection.offerId,
        runtimeVariant: result.selected.offer.runtimeVariant,
        executionProfile: activation.executionProfile
      }));
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
        } catch (error3) {
          firstError ??= error3;
        }
      }
      if (firstError !== void 0)
        throw firstError;
    }
  });
}

// packages/host/dist/session.js
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
  if (value instanceof Uint8Array)
    return value.slice();
  if (Array.isArray(value))
    return Object.freeze(value.map((item) => snapshotStructured(item)));
  if (typeof value === "object" && value !== null) {
    return Object.freeze(Object.fromEntries(Reflect.ownKeys(value).map((key2) => [
      key2,
      snapshotStructured(value[key2])
    ])));
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
    ...diagnostic("error", "x3.host/stale-revision", `asset session revision ${expected} no longer matches source revision ${actual}`)
  });
}
async function assembleSubjectDescriptor(value) {
  const result = await validateSubjectDescriptorV2(value);
  if (result.descriptor !== void 0)
    return result.descriptor;
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
  const declarationByHandler = new Map(options.operationDeclarations.map((item) => [item.handlerId, item]));
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
        return rejected("permission-missing", validity.state === "valid" ? `operation requires permissions: ${missing.join(", ")}` : "the operation permission grant is not valid");
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
      } catch (error3) {
        if (isCancellation(error3) || invokeOptions.signal?.aborted) {
          return rejected("cancelled", "the operation was cancelled");
        }
        if (error3 instanceof ModkitError)
          throw error3;
        const reason = error3 instanceof Error ? error3.message : String(error3);
        throw new ModkitError({
          code: "x3.host/operation-handler-failed",
          message: `operation handler ${handlerId} failed: ${reason}`,
          context: { handlerId },
          cause: error3
        });
      }
    },
    async dispose() {
      await dispose();
    }
  };
  const dispose = async () => {
    if (disposal !== void 0)
      return disposal;
    disposal = (async () => {
      state = "disposed";
      publish({ kind: "state", state });
      const failures = [];
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch (error3) {
          failures.push(error3);
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
      if (signal?.aborted)
        return;
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
            if (event.kind === "state" && event.state === "disposed")
              return;
            continue;
          }
          if (state === "disposed")
            return;
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
      if (state !== "live" || revision === options.revision)
        return;
      state = "stale-revision";
      const item = staleDiagnostic(options.revision, revision);
      publish({ kind: "diagnostic", diagnostic: item });
      publish({ kind: "state", state });
    }
  });
}

// packages/host/dist/subject-open.js
var DEFAULT_MINIMUM_CONFIDENCE = 0.5;
var DEFAULT_MAX_CANDIDATES = 64;
function createReleaseScope() {
  const releases = [];
  let released = false;
  return {
    add(release) {
      if (released) {
        throw new ModkitError({
          code: "x3.host/resource-scope-closed",
          message: "cannot retain a resource after its host scope was released"
        });
      }
      releases.push(release);
    },
    async release() {
      if (released)
        return;
      released = true;
      let firstError;
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch (error3) {
          firstError ??= error3;
        }
      }
      if (firstError !== void 0)
        throw firstError;
    }
  };
}
async function releaseCandidate(candidate, diagnostics) {
  try {
    await candidate.resources.release();
  } catch (error3) {
    diagnostics.push(caughtDiagnostic("cleanup", error3));
  }
}
function gatedOperations(session, spec, grant) {
  const inner = session.operations();
  const required = /* @__PURE__ */ new Map();
  for (const operation of spec.operations) {
    required.set(operation.handlerId, [
      ...operation.requiredPermissions ?? [],
      ...operation.mutatesSource ? ["write-source"] : []
    ]);
  }
  const gated = {
    async invoke(handlerId, input, invokeOptions) {
      const needed = required.get(handlerId) ?? [];
      const validity = grantValidity(grant);
      const missing = needed.filter((item) => !grant.classes.includes(item));
      if (validity.state !== "valid" || missing.length > 0) {
        return {
          state: "rejected",
          reason: "permission-missing",
          diagnostics: [
            diagnostic("error", "x3.host/permission-missing", validity.state === "valid" ? `operation ${handlerId} requires classes the grant does not hold: ${missing.join(", ")}` : "the grant the codec runs under is not valid", [handlerId], { missing })
          ]
        };
      }
      return inner.invoke(handlerId, input, invokeOptions);
    },
    dispose: () => inner.dispose()
  };
  return Object.freeze(gated);
}
function sessionWithResources(session, resources, gating) {
  let disposed = false;
  const operations = gating === void 0 ? void 0 : gatedOperations(session, gating.spec, gating.grant);
  return Object.freeze({
    revision: session.revision,
    state: () => session.state(),
    descriptor: () => session.descriptor(),
    dataSource: session.dataSource.bind(session),
    operations: () => operations ?? session.operations(),
    events: (signal) => session.events(signal),
    async dispose() {
      if (disposed)
        return;
      disposed = true;
      let firstError;
      try {
        await session.dispose();
      } catch (error3) {
        firstError = error3;
      }
      try {
        await resources.release();
      } catch (error3) {
        firstError ??= error3;
      }
      if (firstError !== void 0)
        throw firstError;
    }
  });
}
function errorDiagnostic(code, message, error3) {
  return diagnostic("error", code, message, [], {
    ...error3 === void 0 ? {} : { error: error3 instanceof Error ? error3.message : String(error3) }
  });
}
function caughtDiagnostic(stage, error3) {
  const detail = error3 instanceof Error ? error3.message : String(error3);
  const typed = isModkitError(error3) && error3.code !== "x3.host/rpc-foreign-error";
  return errorDiagnostic(typed ? error3.code : `x3.host/subject-${stage}-failed`, typed ? error3.message : `subject ${stage} failed closed: ${detail}`, error3);
}
function normalizeTarget(target, grant) {
  return JSON.parse(canonicalJsonStringify({
    ...target,
    grantedPermissions: [
      .../* @__PURE__ */ new Set([...target.grantedPermissions ?? [], ...grant.classes])
    ].sort(compareUtf8)
  }));
}
function matchesGlob(path, glob) {
  let pattern = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") {
          pattern += "(?:.*/)?";
          index += 2;
        } else {
          pattern += ".*";
          index += 1;
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (character === "?") {
      pattern += "[^/]";
    } else {
      pattern += character?.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&") ?? "";
    }
  }
  return new RegExp(`${pattern}$`, "u").test(path);
}
function matchesSpec(spec, path, mediaType) {
  const normalizedPath2 = path.replaceAll("\\", "/").split(/[?#]/u, 1)[0]?.toLocaleLowerCase() ?? "";
  const extensionMatch = (spec.match.extensions ?? []).some((extension) => {
    const suffix = extension.toLocaleLowerCase().replace(/^\.+/u, "");
    return normalizedPath2.endsWith(`.${suffix}`) || normalizedPath2 === suffix;
  });
  const mediaMatch = mediaType !== void 0 && (spec.match.mediaTypes ?? []).some((candidate) => candidate === mediaType);
  const pathMatch = (spec.match.pathGlobs ?? []).some((glob) => matchesGlob(normalizedPath2, glob.toLocaleLowerCase()));
  const declaresMatch = (spec.match.extensions?.length ?? 0) > 0 || (spec.match.mediaTypes?.length ?? 0) > 0 || (spec.match.pathGlobs?.length ?? 0) > 0;
  return declaresMatch && (extensionMatch || mediaMatch || pathMatch);
}
function variantRequestsBeyondProbe(requested, callerGrant) {
  return requested.some((item) => !PROBE_PERMISSION_CLASSES.includes(item) && (callerGrant === void 0 || callerGrant.classes.includes(item)));
}
async function readSignatureWindows(options) {
  if (options.source.kind !== "bytes")
    return void 0;
  const ruleSets = [];
  for (const extension of options.inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest;
      if (!contribution.activationEligible || manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue;
      }
      const signatures = manifest.spec.match.signatures;
      if (signatures !== void 0 && signatures.length > 0)
        ruleSets.push(signatures);
    }
  }
  const needs = signatureNeeds(ruleSets);
  if (needs.prefix === 0 && needs.suffix === 0)
    return void 0;
  const size = options.source.size;
  if (size === void 0)
    return void 0;
  const headLength = Number(size < BigInt(needs.prefix) ? size : BigInt(needs.prefix));
  const head = headLength === 0 ? new Uint8Array(0) : await options.source.read(0n, headLength, options.signal);
  const tailLength = Number(size < BigInt(needs.suffix) ? size : BigInt(needs.suffix));
  const tail = tailLength === 0 ? new Uint8Array(0) : await options.source.read(size - BigInt(tailLength), tailLength, options.signal);
  return { head, tail, size };
}
function runtimeBudget(host, spec) {
  const deadline = host.deadlineMs === void 0 ? spec.budgets.deadlineMs : spec.budgets.deadlineMs === void 0 ? host.deadlineMs : Math.min(host.deadlineMs, spec.budgets.deadlineMs);
  return Object.freeze({
    maxInputBytes: host.maxInputBytes < BigInt(spec.budgets.maxInputBytes) ? host.maxInputBytes : BigInt(spec.budgets.maxInputBytes),
    maxDepth: Math.min(host.maxDepth, spec.budgets.maxDepth),
    maxNodes: Math.min(host.maxNodes, spec.budgets.maxNodes),
    maxScalarBytes: Math.min(host.maxScalarBytes, spec.budgets.maxScalarBytes),
    maxDiagnostics: Math.min(host.maxDiagnostics, spec.budgets.maxDiagnostics),
    ...deadline === void 0 ? {} : { deadlineMs: deadline }
  });
}
function boundedProbeSource(source, plan) {
  let consumed = 0n;
  const maximum = BigInt(plan.maxBytes);
  const ranges = plan.ranges.map((range) => {
    const length = BigInt(range.length);
    if (range.from === "start")
      return { start: 0n, end: length };
    if (source.size === void 0) {
      throw new ModkitError({
        code: "x3.host/end-relative-probe-requires-size",
        message: "an end-relative probe range requires a sized source"
      });
    }
    return { start: source.size > length ? source.size - length : 0n, end: source.size };
  });
  const authorize = (offset, length) => {
    if (offset < 0n || length < 0n) {
      throw new ModkitError({
        code: "x3.host/probe-range-violation",
        message: "codec requested a negative probe range"
      });
    }
    const end = offset + length;
    if (!ranges.some((range) => offset >= range.start && end <= range.end)) {
      throw new ModkitError({
        code: "x3.host/probe-range-violation",
        message: "codec read outside its declared probe ranges",
        context: { offset: offset.toString(), length: length.toString() }
      });
    }
    if (consumed + length > maximum) {
      throw new ModkitError({
        code: "x3.host/probe-budget-exceeded",
        message: `codec exceeded its declared ${plan.maxBytes}-byte probe budget`
      });
    }
    consumed += length;
  };
  return Object.freeze({
    ...source,
    async read(offset, length, signal) {
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new ModkitError({
          code: "x3.host/probe-range-violation",
          message: "codec requested a non-safe probe length"
        });
      }
      authorize(offset, BigInt(length));
      return source.read(offset, length, signal);
    },
    async *stream(range, signal) {
      if (range?.length === void 0) {
        throw new ModkitError({
          code: "x3.host/unbounded-probe-stream",
          message: "codec probe streams require an explicit bounded range"
        });
      }
      authorize(range.offset, range.length);
      let received = 0n;
      for await (const chunk of source.stream(range, signal)) {
        received += BigInt(chunk.byteLength);
        if (received > range.length) {
          throw new ModkitError({
            code: "x3.host/probe-stream-overrun",
            message: "probe source returned more bytes than the requested range"
          });
        }
        yield chunk;
      }
    }
  });
}
var NAMESPACE_PATH_ENCODER = new TextEncoder();
function normalizeNamespaceProbePath(path, plan) {
  if (path.includes("\0")) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-path-refused",
      message: "namespace probe paths may not contain NUL bytes",
      context: { path }
    });
  }
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".")
      continue;
    if (part === "..") {
      throw new ModkitError({
        code: "x3.host/namespace-probe-path-refused",
        message: "namespace probe paths may not escape their subject root",
        context: { path }
      });
    }
    parts.push(part);
  }
  const normalized = parts.join("/");
  const pathBytes = NAMESPACE_PATH_ENCODER.encode(normalized).byteLength;
  if (normalized === "" || parts.length > plan.maxDepth || pathBytes > plan.maxPathBytes) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-path-budget-exceeded",
      message: "namespace probe marker exceeds its declared path budget",
      context: {
        path,
        depth: parts.length,
        maxDepth: plan.maxDepth,
        pathBytes,
        maxPathBytes: plan.maxPathBytes
      }
    });
  }
  return normalized;
}
function boundedNamespaceProbeSource(source, plan) {
  if (plan.markers.length > plan.maxEntries) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-entry-budget-exceeded",
      message: "namespace probe declares more markers than its entry budget permits",
      context: { markers: plan.markers.length, maxEntries: plan.maxEntries }
    });
  }
  const markers = new Set(plan.markers.map((path) => normalizeNamespaceProbePath(path, plan)));
  if (markers.size !== plan.markers.length) {
    throw new ModkitError({
      code: "x3.host/namespace-probe-marker-duplicate",
      message: "namespace probe marker paths must be unique after normalization"
    });
  }
  let openedEntries = 0;
  let consumedBytes = 0n;
  const maximumBytes = BigInt(plan.maxBytes);
  const consume = (length) => {
    if (length < 0n || consumedBytes + length > maximumBytes) {
      throw new ModkitError({
        code: "x3.host/namespace-probe-byte-budget-exceeded",
        message: `namespace probe exceeded its declared ${plan.maxBytes}-byte budget`,
        context: { consumedBytes: String(consumedBytes), requestedBytes: String(length) }
      });
    }
    consumedBytes += length;
  };
  const guardMarkerSource = (marker, value) => {
    if (value.kind === "namespace") {
      return Object.freeze({
        ...value,
        async openNamespace() {
          throw new ModkitError({
            code: "x3.host/namespace-probe-traversal-refused",
            message: `namespace probe marker \xAB${marker}\xBB is opaque; traversal is forbidden`,
            context: { marker }
          });
        }
      });
    }
    return Object.freeze({
      ...value,
      async read(offset, length, signal) {
        if (!Number.isSafeInteger(length) || length < 0) {
          throw new ModkitError({
            code: "x3.host/namespace-probe-range-refused",
            message: "namespace probe marker reads require a non-negative safe length",
            context: { marker, offset: String(offset), length }
          });
        }
        consume(BigInt(length));
        return value.read(offset, length, signal);
      },
      async *stream(range, signal) {
        if (range?.length === void 0) {
          throw new ModkitError({
            code: "x3.host/namespace-probe-unbounded-stream-refused",
            message: "namespace probe marker streams require an explicit length",
            context: { marker }
          });
        }
        consume(range.length);
        yield* value.stream(range, signal);
      }
    });
  };
  return Object.freeze({
    ...source,
    async openNamespace(signal) {
      const lease2 = await source.openNamespace(signal);
      const guarded = Object.freeze({
        revision: lease2.value.revision,
        async *list() {
          throw new ModkitError({
            code: "x3.host/namespace-probe-traversal-refused",
            message: "namespace-wide enumeration is forbidden during codec probing"
          });
        },
        async open(path, openSignal) {
          const normalized = normalizeNamespaceProbePath(path, plan);
          if (!markers.has(normalized)) {
            throw new ModkitError({
              code: "x3.host/namespace-probe-path-refused",
              message: `codec attempted to inspect undeclared namespace marker \xAB${normalized}\xBB`,
              context: { path: normalized, markers: [...markers] }
            });
          }
          openedEntries += 1;
          if (openedEntries > plan.maxEntries) {
            throw new ModkitError({
              code: "x3.host/namespace-probe-entry-budget-exceeded",
              message: `namespace probe exceeded its declared ${plan.maxEntries}-entry budget`
            });
          }
          const opened = await lease2.value.open(normalized, openSignal);
          return Object.freeze({
            value: guardMarkerSource(normalized, opened.value),
            release: () => opened.release()
          });
        }
      });
      return Object.freeze({ value: guarded, release: () => lease2.release() });
    }
  });
}
async function probeCodec(codec, source, probe, signal) {
  if (source.kind === "bytes" && probe.kind === "bytes") {
    return codec.probe({ source: boundedProbeSource(source, probe), plan: probe }, signal);
  }
  if (source.kind === "namespace" && probe.kind === "namespace") {
    return codec.probe({ source: boundedNamespaceProbeSource(source, probe), plan: probe }, signal);
  }
  throw new ModkitError({
    code: "x3.host/probe-topology-mismatch",
    message: `codec probe ${probe.kind} cannot inspect a ${source.kind} subject`
  });
}
function snapshotDetection(value, contributionId2) {
  const owned = JSON.parse(canonicalJsonStringify(value));
  if (owned.codecId !== contributionId2 || typeof owned.confidence !== "number" || !Number.isFinite(owned.confidence) || owned.confidence < 0 || owned.confidence > 1 || !Array.isArray(owned.evidence) || !Array.isArray(owned.requiredRanges)) {
    throw new ModkitError({
      code: "x3.host/invalid-detection-result",
      message: `codec ${contributionId2} returned a malformed or mismatched detection result`
    });
  }
  return Object.freeze(owned);
}
function snapshotPlan(value) {
  return Object.freeze(JSON.parse(canonicalJsonStringify(value)));
}
function defaultResolveInput(context) {
  const plan = context.plan;
  if (plan.originKind === "namespace" && plan.requirements.length === 0) {
    if (context.source.kind !== "namespace") {
      throw new ModkitError({
        code: "x3.host/input-topology-mismatch",
        message: "a namespace input plan requires a namespace subject source"
      });
    }
    const source2 = context.source;
    const compositionFingerprint2 = canonicalJsonStringify({
      topology: "namespace",
      root: source2.ref,
      revision: source2.revision
    });
    return Object.freeze({
      originKind: "namespace",
      root: source2.ref,
      bindings: Object.freeze([]),
      revisions: Object.freeze({
        topology: "namespace",
        revision: source2.revision,
        namespaceRevision: source2.revision,
        bindings: Object.freeze([]),
        compositionFingerprint: compositionFingerprint2
      }),
      bindingsFor: () => Object.freeze([]),
      async openBinding(bindingId) {
        throw new ModkitError({
          code: "x3.host/unknown-asset-input-binding",
          message: `namespace asset input has no binding ${bindingId}`
        });
      },
      async openNamespace(signal) {
        throwIfAborted(signal);
        return source2.openNamespace(signal);
      }
    });
  }
  if (plan.originKind !== "single" || plan.requirements.length !== 0) {
    throw new ModkitError({
      code: "x3.host/input-resolver-required",
      message: `the default subject input resolver cannot satisfy ${plan.originKind} topology`
    });
  }
  if (context.source.kind !== "bytes") {
    throw new ModkitError({
      code: "x3.host/input-topology-mismatch",
      message: "a single-file input plan requires a byte subject source"
    });
  }
  const source = context.source;
  const candidate = plan.candidate;
  if (candidate.bindingId.trim().length === 0 || candidate.role.trim().length === 0 || candidate.ownership !== "owned" && candidate.ownership !== "external") {
    throw new ModkitError({
      code: "x3.host/invalid-asset-input-plan",
      message: "codec returned an invalid single-file candidate binding"
    });
  }
  const binding = Object.freeze({
    sourceKind: "candidate",
    bindingId: candidate.bindingId,
    role: candidate.role,
    ownership: candidate.ownership,
    source: source.ref,
    revision: source.revision
  });
  const compositionFingerprint = canonicalJsonStringify({
    topology: "single",
    bindingId: binding.bindingId,
    source: binding.source,
    revision: binding.revision
  });
  return Object.freeze({
    originKind: "single",
    bindings: Object.freeze([binding]),
    primaryBindingId: binding.bindingId,
    revisions: Object.freeze({
      topology: "single",
      revision: source.revision,
      bindings: Object.freeze([
        Object.freeze({ bindingId: binding.bindingId, revision: binding.revision })
      ]),
      compositionFingerprint
    }),
    bindingsFor: () => Object.freeze([]),
    async openBinding(bindingId, signal) {
      throwIfAborted(signal);
      if (bindingId !== binding.bindingId) {
        throw new ModkitError({
          code: "x3.host/unknown-asset-input-binding",
          message: `asset input has no binding ${bindingId}`
        });
      }
      return Object.freeze({ value: source, release: async () => void 0 });
    }
  });
}
function codecModule(module, contributionId2) {
  if (module["abiVersion"] !== 1 || typeof module["createCodec"] !== "function") {
    throw new ModkitError({
      code: "x3.host/invalid-codec-module",
      message: `activated contribution ${contributionId2} does not implement CodecModule ABI v1`
    });
  }
  return module;
}
function assertCodec(value, contributionId2) {
  if (typeof value !== "object" || value === null || typeof value.probe !== "function" || typeof value.open !== "function") {
    throw new ModkitError({
      code: "x3.host/invalid-codec-instance",
      message: `contribution ${contributionId2} returned an invalid codec instance`
    });
  }
  return value;
}
function noServiceResolver() {
  const unavailable3 = (contract, major) => {
    throw new ModkitError({
      code: "x3.host/service-contract-unregistered",
      message: `service contract ${contract}@${major} is unavailable in this composition`
    });
  };
  return {
    async resolve(request) {
      return unavailable3(request.contract, request.major);
    },
    async resolveUnknown(request) {
      return unavailable3(request.contract, request.major);
    }
  };
}
function runnableCandidates(options, offers, signatureWindows, suppressed = []) {
  const candidates = [];
  const path = options.path ?? options.source.ref.uri;
  for (const extension of options.inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest;
      if (manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue;
      }
      if (!contribution.activationEligible) {
        const spec2 = manifest.spec;
        const claimsSource = spec2 !== void 0 && (options.source.kind === "namespace" ? spec2.sourceTopology === "namespace" && spec2.probe.kind === "namespace" : spec2.probe.kind === "bytes" && matchesSpec(spec2, path, options.mediaType));
        if (claimsSource) {
          suppressed.push({
            contributionId: manifest.id,
            extensionId: extension.manifest?.id ?? extension.source,
            reasons: contribution.diagnostics.map((item) => item.code)
          });
        }
        continue;
      }
      const spec = manifest.spec;
      if (!spec.openIntents.includes(options.intent))
        continue;
      let viaSignature = false;
      if (options.source.kind === "namespace") {
        if (spec.sourceTopology !== "namespace" || spec.probe.kind !== "namespace")
          continue;
      } else {
        if (spec.sourceTopology !== "single" && spec.sourceTopology !== "bundle" || spec.probe.kind !== "bytes") {
          continue;
        }
        const byName = matchesSpec(spec, path, options.mediaType);
        viaSignature = !byName && signatureWindows !== void 0 && matchesSignatures(spec.match.signatures, signatureWindows);
        if (!byName && !viaSignature)
          continue;
      }
      for (const offer of offers) {
        if (offer.providerId !== manifest.id)
          continue;
        const logicalOffer = [...offer.provides].sort((left, right) => compareUtf8(canonicalJsonStringify(left), canonicalJsonStringify(right)))[0];
        if (logicalOffer === void 0)
          continue;
        candidates.push({
          contribution,
          extensionId: offer.extensionId,
          contributionId: manifest.id,
          spec,
          offer,
          logicalOffer,
          viaSignature
        });
      }
    }
  }
  return Object.freeze(candidates.sort((left, right) => compareUtf8(left.contributionId, right.contributionId) || compareUtf8(left.offer.runtimeVariant, right.offer.runtimeVariant) || compareUtf8(left.logicalOffer.offerId, right.logicalOffer.offerId)));
}
async function unresolvedDescriptor(options, detections) {
  if (options.source.kind === "namespace") {
    return assembleSubjectDescriptor({
      schemaVersion: 2,
      subjectUri: options.source.ref.uri,
      origin: {
        kind: "namespace",
        root: options.source.ref,
        revision: options.source.revision
      },
      interpretation: "none",
      candidates: detections,
      traits: [{ id: "container.directories", descriptorVersion: 1, state: "available" }],
      operations: [],
      constraints: {
        readOnly: true,
        seekable: false,
        randomAccess: false,
        trusted: false
      },
      dataSources: [],
      diagnostics: [],
      revision: options.source.revision
    });
  }
  return assembleSubjectDescriptor({
    schemaVersion: 2,
    subjectUri: options.source.ref.uri,
    origin: {
      kind: "single",
      binding: {
        id: "content",
        role: "content",
        source: options.source.ref,
        required: true,
        ownership: "owned",
        revision: options.source.revision,
        ...options.mediaType === void 0 ? {} : { mediaType: options.mediaType }
      }
    },
    interpretation: "none",
    candidates: detections,
    traits: [
      {
        id: "content.binary",
        descriptorVersion: 1,
        state: "available",
        ...options.source.size === void 0 ? {} : { parameters: { bytes: options.source.size.toString(10) } }
      }
    ],
    operations: [],
    constraints: {
      readOnly: true,
      seekable: true,
      randomAccess: true,
      trusted: false,
      ...options.source.size === void 0 ? {} : { maxDecodedBytes: options.source.size.toString(10) }
    },
    dataSources: [{ contract: "common.view/byte-range-source", major: 1 }],
    diagnostics: [],
    revision: options.source.revision
  });
}
async function textFallbackAvailable(source, signal) {
  if (source.kind !== "bytes")
    return false;
  if (source.size === void 0)
    return false;
  const length = Number(source.size > 65536n ? 65536n : source.size);
  try {
    const bytes = await source.read(0n, length, signal);
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
async function unresolvedFallback(source, signal) {
  if (source.kind === "namespace") {
    return Object.freeze({ preferred: "none", available: Object.freeze([]) });
  }
  const text = await textFallbackAvailable(source, signal);
  return Object.freeze({
    preferred: text ? "text" : "hex",
    available: Object.freeze(text ? ["text", "hex"] : ["hex"])
  });
}
async function openSubject(options) {
  throwIfAborted(options.signal);
  const minimumConfidence = options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1 || !Number.isSafeInteger(maxCandidates) || maxCandidates <= 0) {
    throw new ModkitError({
      code: "x3.host/invalid-subject-open-policy",
      message: "subject-open confidence and candidate limits are invalid"
    });
  }
  const diagnostics = [];
  const explanations = [];
  const detected = [];
  const offers = offersFromInventory(options.inventory);
  const executionBackends = options.executionBackends ?? DEFAULT_EXECUTION_BACKENDS;
  const signatureWindows = await readSignatureWindows(options);
  const suppressed = [];
  const candidates = runnableCandidates(options, offers, signatureWindows, suppressed);
  for (const item of suppressed) {
    diagnostics.push(diagnostic("information", "x3.host/candidate-suppressed", `\xAB${item.contributionId}\xBB matches this file but cannot run${item.reasons.length === 0 ? "" : `: ${item.reasons.join(", ")}`}`, [item.extensionId, item.contributionId]));
  }
  if (candidates.length > maxCandidates) {
    diagnostics.push(errorDiagnostic("x3.host/subject-candidate-limit", `subject matched ${candidates.length} codecs, exceeding the host limit ${maxCandidates}`));
  } else {
    const target = normalizeTarget(options.target, options.grant);
    for (const candidate of candidates) {
      const local = [];
      const resources = createReleaseScope();
      const privateRecord = inventoryRecordFor(candidate.contribution);
      const variant = candidate.contribution.manifest?.runtimeVariants?.find((item) => item.variantId === candidate.offer.runtimeVariant);
      if (privateRecord === void 0 || variant === void 0 || !executionBackends.supports(variant.executionProfile, target, variant) || variant.executionProfile === "trusted-in-process" && privateRecord.execution.allowTrustedInProcess !== true) {
        local.push(errorDiagnostic("x3.host/codec-execution-unavailable", `codec ${candidate.contributionId}#${candidate.offer.runtimeVariant} has no executable boundary in this host`));
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          offerId: candidate.logicalOffer.offerId,
          state: "rejected",
          diagnostics: Object.freeze(local)
        });
        continue;
      }
      const request = {
        contract: {
          contract: candidate.logicalOffer.contract,
          major: candidate.logicalOffer.major,
          range: "*"
        },
        target,
        pin: {
          providerId: candidate.offer.providerId,
          runtimeVariant: candidate.offer.runtimeVariant,
          offerId: candidate.logicalOffer.offerId
        }
      };
      if (candidate.viaSignature) {
        local.push({
          code: "x3.host/signature-match",
          severity: "information",
          message: `${candidate.contributionId} matched by its declared byte signature; name/media/path rules did not match this subject`
        });
      }
      const resolved = resolveForActivation(request, offers, PROBE_OPERATION);
      if (resolved.result.state !== "resolved" || resolved.ticket === void 0) {
        local.push(errorDiagnostic("x3.host/codec-resolution-unresolved", `codec candidate did not resolve: ${resolved.result.state === "resolved" ? "ticket unavailable" : resolved.result.reason}`));
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          offerId: candidate.logicalOffer.offerId,
          state: "rejected",
          diagnostics: Object.freeze(local)
        });
        continue;
      }
      const record = {
        resources,
        nestedLocks: []
      };
      try {
        const activation = await activateContribution({
          ticket: resolved.ticket,
          grant: options.grant,
          executionBackends,
          ...options.policy === void 0 ? {} : { policy: options.policy },
          ...options.signal === void 0 ? {} : { signal: options.signal }
        });
        record.resources.add(activation.release);
        local.push(...activation.diagnostics);
        {
          const requested = candidate.contribution.manifest?.runtimeVariants?.find((item) => item.variantId === candidate.offer.runtimeVariant)?.requestedPermissionClasses ?? [];
          const degraded = requested.filter((item) => !PROBE_PERMISSION_CLASSES.includes(item) && !options.grant.classes.includes(item));
          if (degraded.length > 0) {
            local.push(permissionDegradedDiagnostic(candidate.contributionId, degraded));
          }
        }
        const effectiveBudget = runtimeBudget(options.budget, candidate.spec);
        const nestedLocks = record.nestedLocks;
        const makeContext = (grant, chain) => {
          const contracts = options.serviceDefinitions === void 0 ? noServiceResolver() : createContractResolverPort({
            offers,
            definitions: options.serviceDefinitions,
            target,
            onResolved(request2, result) {
              nestedLocks.push(buildLockEntry(request2, result));
            },
            async activate(selection, result, signal) {
              const key2 = `${selection.contract}@${selection.major}:${result.selected.offer.providerId}:${selection.offerId}`;
              if (chain.includes(key2)) {
                throw new ModkitError({
                  code: "x3.host/service-dependency-cycle",
                  message: `service activation cycle detected at ${key2}`
                });
              }
              const nested = await activateServiceProvider({
                selection,
                result,
                target,
                grant,
                executionBackends,
                ...options.policy === void 0 ? {} : { policy: options.policy },
                ...signal === void 0 ? {} : { signal },
                diagnostics,
                contextFor: (effectiveGrant) => makeContext(effectiveGrant, [...chain, key2])
              });
              record.resources.add(() => nested.release());
              return Object.freeze({
                value: nested.lease.value,
                release: () => nested.release()
              });
            }
          });
          return Object.freeze({
            contracts,
            budgets: effectiveBudget,
            diagnostics: {
              report(item) {
                diagnostics.push(item);
              }
            },
            ...options.signal === void 0 ? {} : { signal: options.signal }
          });
        };
        const codec = assertCodec(codecModule(activation.module, candidate.contributionId).createCodec(makeContext(activation.effectiveGrant, [candidate.contributionId])), candidate.contributionId);
        const detection = snapshotDetection(await probeCodec(codec, options.source, candidate.spec.probe, options.signal), candidate.contributionId);
        detected.push(Object.assign(record, {
          ...candidate,
          ticket: resolved.ticket,
          codec,
          detection,
          effectiveBudget,
          effectiveGrant: activation.effectiveGrant,
          activationDiagnostics: Object.freeze(local),
          request,
          makeContext,
          probeScoped: variantRequestsBeyondProbe(candidate.contribution.manifest?.runtimeVariants?.find((item) => item.variantId === candidate.offer.runtimeVariant)?.requestedPermissionClasses ?? [], options.grant)
        }));
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          offerId: candidate.logicalOffer.offerId,
          state: "detected",
          confidence: detection.confidence,
          diagnostics: Object.freeze(local)
        });
      } catch (error3) {
        local.push(caughtDiagnostic("probe", error3));
        try {
          await record.resources.release();
        } catch (cleanupError) {
          local.push(caughtDiagnostic("cleanup", cleanupError));
        }
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          offerId: candidate.logicalOffer.offerId,
          state: "rejected",
          diagnostics: Object.freeze(local)
        });
      }
    }
  }
  const eligible = detected.filter((candidate) => candidate.detection.confidence >= minimumConfidence).sort((left, right) => right.detection.confidence - left.detection.confidence || compareUtf8(left.contributionId, right.contributionId) || compareUtf8(left.offer.runtimeVariant, right.offer.runtimeVariant));
  const best = eligible[0];
  const tied = best === void 0 ? [] : eligible.filter((candidate) => candidate.detection.confidence === best.detection.confidence);
  if (best === void 0 || tied.length !== 1) {
    for (const candidate of detected)
      await releaseCandidate(candidate, diagnostics);
    const descriptor = await unresolvedDescriptor(options, detected.map((candidate) => candidate.detection));
    return Object.freeze({
      state: "unresolved",
      reason: candidates.length === 0 ? "no-candidate" : best === void 0 ? "no-match" : "ambiguous",
      descriptor,
      fallback: await unresolvedFallback(options.source, options.signal),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze(diagnostics)
    });
  }
  for (const candidate of detected) {
    if (candidate !== best)
      await releaseCandidate(candidate, diagnostics);
  }
  let openedSession;
  try {
    if (best.probeScoped) {
      const reResolved = resolveForActivation(best.request, offers);
      if (reResolved.result.state !== "resolved" || reResolved.ticket === void 0) {
        throw new ModkitError({
          code: "x3.host/codec-resolution-unresolved",
          message: "the selected codec did not re-resolve for open"
        });
      }
      const openScope = createReleaseScope();
      const probeScope = best.resources;
      try {
        const activation = await activateContribution({
          ticket: reResolved.ticket,
          grant: options.grant,
          executionBackends,
          ...options.policy === void 0 ? {} : { policy: options.policy },
          ...options.signal === void 0 ? {} : { signal: options.signal }
        });
        openScope.add(activation.release);
        best.resources = openScope;
        best.codec = assertCodec(codecModule(activation.module, best.contributionId).createCodec(best.makeContext(activation.effectiveGrant, [best.contributionId])), best.contributionId);
        best.ticket = reResolved.ticket;
        best.effectiveGrant = activation.effectiveGrant;
        best.activationDiagnostics = Object.freeze([
          ...best.activationDiagnostics,
          ...activation.diagnostics
        ]);
      } catch (error3) {
        best.resources = probeScope;
        try {
          await openScope.release();
        } catch (cleanupError) {
          diagnostics.push(caughtDiagnostic("cleanup", cleanupError));
        }
        throw error3;
      }
      try {
        await probeScope.release();
      } catch (cleanupError) {
        diagnostics.push(caughtDiagnostic("cleanup", cleanupError));
      }
    }
    const rawPlan = best.codec.planInput ? await best.codec.planInput(options.source, best.detection, options.signal) : options.source.kind === "namespace" ? { originKind: "namespace", requirements: [] } : {
      originKind: "single",
      candidate: { bindingId: "content", role: "content", ownership: "owned" },
      requirements: []
    };
    const plan = snapshotPlan(rawPlan);
    const input = await (options.resolveInput ?? defaultResolveInput)({
      source: options.source,
      plan,
      detection: best.detection,
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    openedSession = await best.codec.open(input, options.intent, best.effectiveBudget, options.signal);
    const session = openedSession;
    const descriptor = await assembleSubjectDescriptor(await session.descriptor());
    if (descriptor.interpretation !== "codec" || descriptor.identity.codecId !== best.contributionId || descriptor.subjectUri !== options.source.ref.uri || descriptor.revision !== options.source.revision) {
      throw new ModkitError({
        code: "x3.host/subject-session-identity-mismatch",
        message: "opened codec session does not describe the selected source and codec"
      });
    }
    const selectedExplanation = explanations.find((item) => item.contributionId === best.contributionId && item.variantId === best.offer.runtimeVariant && item.offerId === best.logicalOffer.offerId);
    if (selectedExplanation !== void 0) {
      const index = explanations.indexOf(selectedExplanation);
      explanations[index] = Object.freeze({ ...selectedExplanation, state: "selected" });
    }
    const record = inventoryRecordFor(best.contribution)?.publicRecord;
    if (record === void 0) {
      throw new ModkitError({
        code: "x3.host/detection-selection-unattested",
        message: "selected codec has no attested inventory record"
      });
    }
    const detectionSelectionText = serializeCodecDetectionSelection(buildCodecDetectionSelection({
      sourceRevision: options.source.revision,
      extensionId: best.extensionId,
      contributionId: best.contributionId,
      variantId: best.offer.runtimeVariant,
      offerId: best.logicalOffer.offerId,
      artifactDigest: record.artifactDigest,
      manifestDigest: record.manifestDigest,
      sourceTopology: best.spec.sourceTopology,
      detection: best.detection
    }));
    const lockText = serializePolicyLock(best.nestedLocks);
    const managedSession = sessionWithResources(session, best.resources, {
      spec: best.spec,
      grant: best.effectiveGrant
    });
    openedSession = void 0;
    return Object.freeze({
      state: "opened",
      session: managedSession,
      descriptor,
      ticket: best.ticket,
      detectionSelectionText,
      lockText,
      selected: Object.freeze({
        extensionId: best.extensionId,
        contributionId: best.contributionId,
        variantId: best.offer.runtimeVariant,
        offerId: best.logicalOffer.offerId,
        confidence: best.detection.confidence
      }),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze([...diagnostics, ...best.activationDiagnostics])
    });
  } catch (error3) {
    if (openedSession !== void 0) {
      try {
        await openedSession.dispose();
      } catch (disposeError) {
        diagnostics.push(caughtDiagnostic("session-dispose", disposeError));
      }
    }
    await releaseCandidate(best, diagnostics);
    diagnostics.push(caughtDiagnostic("input-open", error3));
    const descriptor = await unresolvedDescriptor(options, detected.map((candidate) => candidate.detection));
    return Object.freeze({
      state: "unresolved",
      reason: "input-unresolved",
      descriptor,
      fallback: await unresolvedFallback(options.source, options.signal),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze(diagnostics)
    });
  }
}

// packages/host/dist/input-resolution.js
var COMPANION_REQUIRED_MISSING = "x3.host/companion-required-missing";
var COMPANION_AMBIGUOUS = "x3.host/companion-ambiguous";
var COMPANION_PATH_REFUSED = "x3.host/companion-path-refused";
var COMPANION_PATTERN_INVALID = "x3.host/companion-pattern-invalid";
var COMPANION_SCOPE_UNSUPPORTED = "x3.host/companion-scope-unsupported";
var COMPANION_BUDGET_EXCEEDED = "x3.host/companion-budget-exceeded";
var COMPANION_PLAN_INVALID = "x3.host/companion-plan-invalid";
var COMPANION_TRAIT_PROBE_UNAVAILABLE = "x3.host/companion-trait-probe-unavailable";
var COMPANION_UNAVAILABLE = "x3.host/companion-unavailable";
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
  if (value.includes("\0"))
    refusePath(value, "it contains a NUL byte", context);
  const slashed = value.replaceAll("\\", "/");
  if (slashed.startsWith("//"))
    refusePath(slashed, "it is a UNC path", context);
  if (slashed.startsWith("/"))
    refusePath(slashed, "it is an absolute path", context);
  if (DRIVE_PREFIX.test(slashed))
    refusePath(slashed, "it carries a drive prefix", context);
  const parts = [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".")
      continue;
    if (part === "..")
      refusePath(slashed, "it escapes the confined origin root", context);
    parts.push(part);
  }
  const normalized = parts.join("/");
  if (normalized === "")
    refusePath(value, "it names nothing", context);
  return normalized;
}
var WILDCARDS = /* @__PURE__ */ new Set(["*", "?"]);
function compilePatterns(requirementId, patterns, caseSensitivity) {
  if (patterns === void 0 || patterns.length === 0) {
    throw new ModkitError({
      code: COMPANION_PATTERN_INVALID,
      message: `requirement \xAB${requirementId}\xBB declares no patterns; an unbounded companion scan is refused`,
      context: { requirementId }
    });
  }
  const expressions = [];
  for (const pattern of patterns) {
    const invalid2 = (why) => {
      throw new ModkitError({
        code: COMPANION_PATTERN_INVALID,
        message: `companion pattern \xAB${pattern}\xBB of requirement \xAB${requirementId}\xBB is refused: ${why}`,
        context: { requirementId, pattern }
      });
    };
    if (pattern.length === 0)
      invalid2("it is empty");
    if (pattern.includes("\0"))
      invalid2("it contains a NUL byte");
    if (pattern.includes("**"))
      invalid2("recursive patterns are not a bounded companion search");
    if (pattern.startsWith("/") || pattern.startsWith("\\"))
      invalid2("it is an absolute path");
    if (DRIVE_PREFIX.test(pattern))
      invalid2("it carries a drive prefix");
    if (pattern.replaceAll("\\", "/").split("/").includes("..")) {
      invalid2("it escapes the confined origin root");
    }
    if (![...pattern].some((character) => !WILDCARDS.has(character))) {
      invalid2("it has no literal part and would match every entry");
    }
    let expression = "^";
    for (const character of pattern.replaceAll("\\", "/")) {
      if (character === "*")
        expression += "[^/]*";
      else if (character === "?")
        expression += "[^/]";
      else
        expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
    }
    expressions.push({
      expression: new RegExp(`${expression}$`, caseSensitivity === "insensitive" ? "iu" : "u"),
      whole: pattern.replaceAll("\\", "/").includes("/")
    });
  }
  return {
    test: (logicalId) => {
      const name = logicalId.split("/").at(-1) ?? logicalId;
      return expressions.some((item) => item.expression.test(item.whole ? logicalId : name));
    },
    prefix: enumerationPrefix(patterns)
  };
}
function enumerationPrefix(patterns) {
  const safe = patterns.map((pattern) => {
    const normalized = pattern.replaceAll("\\", "/");
    if (!normalized.includes("/"))
      return "";
    const wildcard = normalized.search(/[*?]/u);
    if (wildcard === -1)
      return normalized;
    const literal = normalized.slice(0, wildcard);
    const cut2 = literal.lastIndexOf("/");
    return cut2 === -1 ? "" : literal.slice(0, cut2 + 1);
  });
  const first = safe[0];
  if (first === void 0)
    return "";
  if (safe.every((value) => value === first))
    return first;
  let common = first;
  for (const value of safe.slice(1)) {
    let length = 0;
    while (length < common.length && length < value.length && common[length] === value[length]) {
      length += 1;
    }
    common = common.slice(0, length);
  }
  const cut = common.lastIndexOf("/");
  return cut === -1 ? "" : common.slice(0, cut + 1);
}
function validateRequirements(requirements) {
  const seen = /* @__PURE__ */ new Set();
  for (const requirement of requirements) {
    const invalid2 = (why) => {
      throw new ModkitError({
        code: COMPANION_PLAN_INVALID,
        message: `companion requirement \xAB${requirement.id}\xBB is invalid: ${why}`,
        context: { requirementId: requirement.id, role: requirement.role }
      });
    };
    if (typeof requirement.id !== "string" || requirement.id.trim().length === 0) {
      invalid2("its id is blank");
    }
    if (seen.has(requirement.id))
      invalid2("its id is not unique within the plan");
    seen.add(requirement.id);
    if (typeof requirement.role !== "string" || requirement.role.trim().length === 0) {
      invalid2("its role is blank");
    }
    if (!["owned", "companion", "external"].includes(requirement.ownership)) {
      invalid2(`ownership \xAB${String(requirement.ownership)}\xBB is not a declared ownership`);
    }
    const required = requirement.cardinality === "one" || requirement.cardinality === "one-or-more";
    if (requirement.required !== required) {
      invalid2(`cardinality \xAB${requirement.cardinality}\xBB does not agree with required=${String(requirement.required)}`);
    }
    if (!Array.isArray(requirement.scopes) || requirement.scopes.length === 0) {
      invalid2("it declares no search scope");
    }
  }
}
function createCompanionInputResolver(origin, options = {}) {
  const limits = Object.freeze({
    ...DEFAULT_COMPANION_LIMITS,
    ...options.limits
  });
  const now = options.now ?? (() => Date.now());
  const report = options.onDiagnostic;
  const explicit = options.explicitSelections;
  return async (context) => {
    const plan = context.plan;
    if (plan.originKind === "derived" || plan.requirements.length === 0) {
      return defaultResolveInput(context);
    }
    if (plan.originKind === "bundle" && context.source.kind !== "bytes") {
      throw new ModkitError({
        code: "x3.host/input-topology-mismatch",
        message: "a bundle input plan requires a byte subject source"
      });
    }
    if (plan.originKind === "namespace" && context.source.kind !== "namespace") {
      throw new ModkitError({
        code: "x3.host/input-topology-mismatch",
        message: "a namespace input plan requires a namespace subject source"
      });
    }
    const signal = context.signal;
    const deadlineAt = options.deadlineMs === void 0 ? void 0 : now() + options.deadlineMs;
    const budget = { entries: 0, probes: 0, probeBytes: 0, bindings: 0 };
    const checkpoint = (stage) => {
      throwIfAborted(signal);
      if (deadlineAt !== void 0 && now() > deadlineAt) {
        throw new ModkitError({
          code: COMPANION_BUDGET_EXCEEDED,
          message: `companion resolution exceeded its ${String(options.deadlineMs)}ms deadline`,
          context: { limit: "deadline", stage, deadlineMs: options.deadlineMs }
        });
      }
    };
    const exceeded = (limit, value) => {
      throw new ModkitError({
        code: COMPANION_BUDGET_EXCEEDED,
        message: `companion resolution exceeded its ${limit} limit of ${value}`,
        context: { limit, value }
      });
    };
    const refuse3 = (code, message, detail) => {
      report?.(diagnostic("error", code, message, [String(detail["requirementId"])], detail));
      throw new ModkitError({ code, message, context: detail });
    };
    validateRequirements(plan.requirements);
    const enumerated = /* @__PURE__ */ new Map();
    const served = new Set(origin.scopes);
    if (explicit !== void 0)
      served.add("explicit-user-selection");
    const enumerateScope = async (scope, prefix) => {
      const key2 = canonicalJsonStringify([scope, prefix]);
      const cached = enumerated.get(key2);
      if (cached !== void 0)
        return cached;
      const ids = [];
      if (scope === "explicit-user-selection") {
        for (const value of Object.values(explicit ?? {}).flat()) {
          ids.push(normalizeCompanionLogicalId(value, { scope }));
        }
      } else {
        for await (const entry2 of origin.enumerate(scope, { prefix }, signal)) {
          checkpoint(`enumerate:${scope}`);
          budget.entries += 1;
          if (budget.entries > limits.maxEntries)
            exceeded("entries", limits.maxEntries);
          ids.push(normalizeCompanionLogicalId(entry2.logicalId, { scope }));
        }
      }
      const frozen = Object.freeze(ids);
      enumerated.set(key2, frozen);
      return frozen;
    };
    const fold2 = (value) => origin.caseSensitivity === "insensitive" ? value.toLowerCase() : value;
    const primaryKey = fold2(normalizeCompanionLogicalId(origin.primaryLogicalId));
    const selected = [];
    const usedBindingIds = /* @__PURE__ */ new Set();
    const pinned = /* @__PURE__ */ new Map();
    for (const requirement of plan.requirements) {
      checkpoint(`requirement:${requirement.id}`);
      const patterns = compilePatterns(requirement.id, requirement.patterns, origin.caseSensitivity);
      const requested = [...requirement.scopes].sort(compareUtf8);
      const usable = requested.filter((scope) => served.has(scope));
      if (usable.length === 0) {
        const detail2 = {
          requirementId: requirement.id,
          role: requirement.role,
          requestedScopes: requested,
          servedScopes: [...served].sort(compareUtf8),
          reason: requested.includes("explicit-user-selection") ? "no-product-selection" : requested.includes("workspace-dependency-layer") ? "no-provider" : "origin-cannot-serve-scope"
        };
        if (requirement.required) {
          refuse3(COMPANION_SCOPE_UNSUPPORTED, `required companion \xAB${requirement.role}\xBB (requirement \xAB${requirement.id}\xBB) asks only for scopes this origin cannot serve: ${requested.join(", ")}`, detail2);
        }
        report?.(diagnostic("warning", COMPANION_SCOPE_UNSUPPORTED, `optional companion \xAB${requirement.role}\xBB is unavailable: none of its scopes can be served here`, [requirement.id], detail2));
        continue;
      }
      const matched = [];
      for (const scope of usable) {
        for (const logicalId of await enumerateScope(scope, patterns.prefix)) {
          if (scope === "explicit-user-selection" && !(explicit?.[requirement.id] ?? []).some((value) => fold2(normalizeCompanionLogicalId(value)) === fold2(logicalId))) {
            continue;
          }
          if (fold2(logicalId) === primaryKey)
            continue;
          if (!patterns.test(logicalId))
            continue;
          matched.push(logicalId);
        }
      }
      matched.sort(compareUtf8);
      const unique = [];
      const seenKeys = /* @__PURE__ */ new Set();
      for (const logicalId of matched) {
        const key2 = fold2(logicalId);
        if (seenKeys.has(key2))
          continue;
        seenKeys.add(key2);
        unique.push(logicalId);
      }
      const accepted = [];
      const rejected2 = [];
      for (const logicalId of unique) {
        checkpoint(`validate:${requirement.id}`);
        if (requirement.expected === void 0) {
          accepted.push(logicalId);
          continue;
        }
        if (options.traitProbe === void 0) {
          throw new ModkitError({
            code: COMPANION_TRAIT_PROBE_UNAVAILABLE,
            message: `requirement \xAB${requirement.id}\xBB declares expected traits but this host wired no companion trait probe`,
            context: { requirementId: requirement.id, role: requirement.role }
          });
        }
        budget.probes += 1;
        if (budget.probes > limits.maxProbes)
          exceeded("probes", limits.maxProbes);
        const remaining = limits.maxProbeBytes - budget.probeBytes;
        if (remaining <= 0)
          exceeded("probeBytes", limits.maxProbeBytes);
        const lease2 = await origin.open(logicalId, signal);
        let ok2 = false;
        try {
          pinned.set(logicalId, { ref: lease2.value.ref, revision: lease2.value.revision });
          ok2 = await options.traitProbe({
            requirementId: requirement.id,
            logicalId,
            // every byte the probe pulls is counted by the host, not reported by the probe
            source: countingSource(lease2.value, (read) => {
              budget.probeBytes += read;
              if (budget.probeBytes > limits.maxProbeBytes) {
                exceeded("probeBytes", limits.maxProbeBytes);
              }
            }),
            expected: requirement.expected,
            maxBytes: remaining
          }, signal);
        } finally {
          await lease2.release();
        }
        ;
        (ok2 ? accepted : rejected2).push(logicalId);
      }
      const detail = {
        requirementId: requirement.id,
        role: requirement.role,
        cardinality: requirement.cardinality,
        checkedScopes: usable,
        requestedScopes: requested,
        matched: unique.length,
        rejectedByExpectedTraits: rejected2
      };
      const singular = requirement.cardinality === "one" || requirement.cardinality === "zero-or-one";
      if (singular && accepted.length > 1) {
        refuse3(COMPANION_AMBIGUOUS, `companion \xAB${requirement.role}\xBB (requirement \xAB${requirement.id}\xBB) admits at most one candidate but ${accepted.length} matched in ${usable.join(", ")}`, { ...detail, candidates: accepted });
      }
      if (requirement.required && accepted.length === 0) {
        refuse3(COMPANION_REQUIRED_MISSING, `required companion \xAB${requirement.role}\xBB (requirement \xAB${requirement.id}\xBB) was not found in any checked scope: ${usable.join(", ")}`, detail);
      }
      if (accepted.length === 0) {
        report?.(diagnostic("information", COMPANION_UNAVAILABLE, `optional companion \xAB${requirement.role}\xBB is absent; the dependent capability stays unavailable`, [requirement.id], {
          ...detail,
          reason: rejected2.length > 0 ? "expected-traits-rejected" : "no-candidate-matched"
        }));
        continue;
      }
      for (const logicalId of accepted) {
        checkpoint(`bind:${requirement.id}`);
        budget.bindings += 1;
        if (budget.bindings > limits.maxBindings)
          exceeded("bindings", limits.maxBindings);
        const bindingId = `${requirement.id}#${logicalId}`;
        if (usedBindingIds.has(bindingId)) {
          throw new ModkitError({
            code: COMPANION_PLAN_INVALID,
            message: `companion binding id \xAB${bindingId}\xBB is not unique within the resolved input`,
            context: { requirementId: requirement.id, bindingId }
          });
        }
        usedBindingIds.add(bindingId);
        let identity = pinned.get(logicalId);
        if (identity === void 0) {
          const lease2 = await origin.open(logicalId, signal);
          try {
            identity = { ref: lease2.value.ref, revision: lease2.value.revision };
            pinned.set(logicalId, identity);
          } finally {
            await lease2.release();
          }
        }
        selected.push({
          requirement,
          logicalId,
          bindingId,
          ref: identity.ref,
          revision: identity.revision
        });
      }
    }
    return buildAssetInput(context, plan, origin, selected, signal);
  };
}
function countingSource(source, onBytes) {
  if (source.kind !== "bytes")
    return source;
  const inner = source;
  return Object.freeze({
    ...inner,
    async read(offset, length, signal) {
      const bytes = await inner.read(offset, length, signal);
      onBytes(bytes.byteLength);
      return bytes;
    },
    async *stream(range, signal) {
      for await (const chunk of inner.stream(range, signal)) {
        onBytes(chunk.byteLength);
        yield chunk;
      }
    }
  });
}
function buildAssetInput(context, plan, origin, selected, signal) {
  const requirementBindings = selected.map((item) => Object.freeze({
    sourceKind: "requirement",
    bindingId: item.bindingId,
    requirementId: item.requirement.id,
    role: item.requirement.role,
    ownership: item.requirement.ownership,
    source: item.ref,
    revision: item.revision
  }));
  const openRequirement = async (bindingId, openSignal) => {
    throwIfAborted(openSignal ?? signal);
    const item = selected.find((candidate2) => candidate2.bindingId === bindingId);
    if (item === void 0) {
      throw new ModkitError({
        code: "x3.host/unknown-asset-input-binding",
        message: `asset input has no binding ${bindingId}`
      });
    }
    const lease2 = await origin.open(item.logicalId, openSignal ?? signal);
    if (lease2.value.revision !== item.revision) {
      await lease2.release();
      throw new ModkitError({
        code: "x3.host/source-revision-changed",
        message: `companion \xAB${item.logicalId}\xBB changed after it was bound (revision ${item.revision})`,
        context: { bindingId, revision: item.revision, observed: lease2.value.revision }
      });
    }
    return lease2;
  };
  const bindingsFor = (requirementId) => Object.freeze(requirementBindings.filter((item) => item.requirementId === requirementId));
  if (plan.originKind === "namespace") {
    const source2 = context.source;
    const revisions2 = Object.freeze({
      topology: "namespace",
      revision: source2.revision,
      namespaceRevision: source2.revision,
      bindings: Object.freeze(requirementBindings.map((item) => Object.freeze({ bindingId: item.bindingId, revision: item.revision }))),
      compositionFingerprint: canonicalJsonStringify({
        topology: "namespace",
        root: source2.ref,
        revision: source2.revision,
        bindings: requirementBindings.map((item) => ({
          bindingId: item.bindingId,
          source: item.source,
          revision: item.revision
        }))
      })
    });
    return Object.freeze({
      originKind: "namespace",
      root: source2.ref,
      bindings: Object.freeze(requirementBindings),
      revisions: revisions2,
      bindingsFor,
      openBinding: openRequirement,
      async openNamespace(openSignal) {
        throwIfAborted(openSignal ?? signal);
        return source2.openNamespace(openSignal ?? signal);
      }
    });
  }
  const source = context.source;
  const candidatePlan = plan.candidate;
  if (candidatePlan === void 0 || candidatePlan.bindingId.trim().length === 0 || candidatePlan.role.trim().length === 0 || candidatePlan.ownership !== "owned" && candidatePlan.ownership !== "external") {
    throw new ModkitError({
      code: "x3.host/invalid-asset-input-plan",
      message: "codec returned an invalid bundle candidate binding"
    });
  }
  const candidate = Object.freeze({
    sourceKind: "candidate",
    bindingId: candidatePlan.bindingId,
    role: candidatePlan.role,
    ownership: candidatePlan.ownership,
    source: source.ref,
    revision: source.revision
  });
  if (requirementBindings.some((item) => item.bindingId === candidate.bindingId)) {
    throw new ModkitError({
      code: COMPANION_PLAN_INVALID,
      message: `companion binding id \xAB${candidate.bindingId}\xBB collides with the candidate binding`,
      context: { bindingId: candidate.bindingId }
    });
  }
  const bindings = Object.freeze([candidate, ...requirementBindings]);
  const revisions = Object.freeze({
    topology: "bundle",
    revision: source.revision,
    bindings: Object.freeze(bindings.map((item) => Object.freeze({ bindingId: item.bindingId, revision: item.revision }))),
    compositionFingerprint: canonicalJsonStringify({
      topology: "bundle",
      bindings: bindings.map((item) => ({
        bindingId: item.bindingId,
        source: item.source,
        revision: item.revision
      }))
    })
  });
  return Object.freeze({
    originKind: "bundle",
    bindings,
    primaryBindingId: candidate.bindingId,
    revisions,
    bindingsFor,
    async openBinding(bindingId, openSignal) {
      throwIfAborted(openSignal ?? signal);
      if (bindingId === candidate.bindingId) {
        return Object.freeze({ value: source, release: async () => void 0 });
      }
      return openRequirement(bindingId, openSignal);
    }
  });
}

// packages/host/dist/vfs-source.js
function scopedPath(root, path) {
  const normalized = normalizeVfsPath(path);
  return root === "" ? normalized : normalized === "" ? root : `${root}/${normalized}`;
}
function relativePath(root, path) {
  if (root === "")
    return path;
  if (path === root)
    return "";
  if (path.startsWith(`${root}/`))
    return path.slice(root.length + 1);
  throw new ModkitError({
    code: "x3.host/vfs-namespace-provider-escape",
    message: "VFS provider returned an entry outside the bridged namespace root",
    context: { root, path }
  });
}
function nestedRef(root, path) {
  if (path === "")
    return root;
  const separator = root.uri.includes("?") ? "&" : "?";
  return Object.freeze({
    id: `${root.id}?vfs-path=${encodeURIComponent(path)}`,
    // A raw `#vfs-path=...` fragment is not a canonical SubjectRef: fragments are reserved for
    // qualified nested-subject identities. A query remains a restorable root source identity.
    uri: `${root.uri}${separator}vfs-path=${encodeURIComponent(path)}`,
    parentIds: Object.freeze([...root.parentIds ?? [], root.id])
  });
}
function createVfsCompanionOrigin(options) {
  const root = normalizeVfsPath(options.rootPath ?? "");
  const primaryLogicalId = normalizeVfsPath(options.primaryLogicalId);
  const caseSensitivity = options.caseSensitivity ?? "insensitive";
  const maxTraversalEntries = options.maxTraversalEntries ?? 4096;
  if (!Number.isSafeInteger(maxTraversalEntries) || maxTraversalEntries <= 0) {
    throw new ModkitError({
      code: "x3.host/vfs-companion-limit-invalid",
      message: "VFS companion traversal limit must be a positive safe integer",
      context: { maxTraversalEntries }
    });
  }
  const absolute = (logicalId) => scopedPath(root, logicalId);
  const fileSource = async (logicalId, signal) => {
    const normalized = normalizeVfsPath(logicalId);
    const path = absolute(normalized);
    const node = await options.mount.stat(path, signal);
    if (node?.kind !== "file") {
      throw new ModkitError({
        code: "x3.host/vfs-companion-not-found",
        message: `VFS mount has no companion file \xAB${normalized}\xBB`,
        context: { logicalId: normalized }
      });
    }
    const random = await options.mount.open(path, signal);
    try {
      const ref = nestedRef(Object.freeze({ id: options.mount.id, uri: options.mount.rootUri }), relativePath(root, node.path));
      const value = await artifactByteSourceFromRandomAccess(random, {
        ref,
        revision: revisionId(node.revision ?? options.mount.revision),
        ...signal === void 0 ? {} : { signal }
      });
      return Object.freeze({
        value,
        async release() {
          await random.dispose();
        }
      });
    } catch (error3) {
      await random.dispose();
      throw error3;
    }
  };
  return Object.freeze({
    primaryLogicalId,
    caseSensitivity,
    scopes: Object.freeze(["current-mount", "enclosing-container"]),
    async *enumerate(scope, enumeration, signal) {
      throwIfAborted(signal);
      if (scope !== "current-mount" && scope !== "enclosing-container")
        return;
      const prefix = normalizeVfsPath(enumeration.prefix);
      const exact = await options.mount.stat(absolute(prefix), signal);
      if (exact?.kind === "file") {
        yield Object.freeze({
          logicalId: relativePath(root, exact.path),
          ...exact.size === void 0 ? {} : { size: exact.size }
        });
        return;
      }
      const prefixKey = caseSensitivity === "insensitive" ? prefix.toLowerCase() : prefix;
      const prefixParent = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
      const queue = exact?.kind === "directory" ? [exact.path] : [absolute(prefixParent)];
      let traversed = 0;
      while (queue.length > 0) {
        const directory = queue.shift();
        if (directory === void 0)
          break;
        for await (const node of options.mount.list(directory, signal)) {
          throwIfAborted(signal);
          traversed += 1;
          if (traversed > maxTraversalEntries) {
            throw new ModkitError({
              code: "x3.host/vfs-companion-budget-exceeded",
              message: "VFS companion origin exceeded its traversal boundary",
              context: { maxTraversalEntries, prefix }
            });
          }
          const logicalId = relativePath(root, node.path);
          const key2 = caseSensitivity === "insensitive" ? logicalId.toLowerCase() : logicalId;
          if (node.kind === "directory") {
            if (prefixKey === "" || key2.startsWith(prefixKey) || prefixKey.startsWith(`${key2}/`)) {
              queue.push(node.path);
            }
          } else if (prefixKey === "" || key2.startsWith(prefixKey)) {
            yield Object.freeze({
              logicalId,
              ...node.size === void 0 ? {} : { size: node.size }
            });
          }
        }
      }
    },
    open: fileSource
  });
}
function createVfsInputResolver(options, resolverOptions = {}) {
  return createCompanionInputResolver(createVfsCompanionOrigin(options), resolverOptions);
}
function artifactNamespaceSourceFromVfsMount(mount, options = {}) {
  const rootPath = normalizeVfsPath(options.rootPath ?? "");
  const rootRef = Object.freeze(options.ref ?? { id: mount.id, uri: mount.rootUri });
  const sourceAt = (path, ref, revision) => Object.freeze({
    kind: "namespace",
    ref,
    revision: revisionId(revision),
    async openNamespace(signal) {
      throwIfAborted(signal);
      const namespace = Object.freeze({
        revision: revisionId(revision),
        async *list(prefix, listSignal) {
          throwIfAborted(listSignal);
          const absolutePrefix = scopedPath(path, prefix);
          for await (const node of mount.list(absolutePrefix, listSignal)) {
            yield Object.freeze({
              path: relativePath(path, node.path),
              kind: node.kind,
              ...node.size === void 0 ? {} : { size: node.size }
            });
          }
        },
        async open(entryPath, openSignal) {
          throwIfAborted(openSignal);
          const absolute = scopedPath(path, entryPath);
          const node = await mount.stat(absolute, openSignal);
          if (node === void 0) {
            throw new ModkitError({
              code: "x3.host/namespace-entry-not-found",
              message: `namespace entry \xAB${entryPath}\xBB does not exist`,
              context: { path: entryPath, root: path }
            });
          }
          const relative = relativePath(path, node.path);
          const childRef = nestedRef(ref, relative);
          const childRevision = node.revision ?? revision;
          if (node.kind === "directory") {
            return Object.freeze({
              value: sourceAt(absolute, childRef, childRevision),
              release: async () => void 0
            });
          }
          const random = await mount.open(absolute, openSignal);
          try {
            const value = await artifactByteSourceFromRandomAccess(random, {
              ref: childRef,
              revision: revisionId(childRevision),
              ...openSignal === void 0 ? {} : { signal: openSignal }
            });
            return Object.freeze({
              value,
              async release() {
                await random.dispose();
              }
            });
          } catch (error3) {
            await random.dispose();
            throw error3;
          }
        }
      });
      return Object.freeze({ value: namespace, release: async () => void 0 });
    }
  });
  return sourceAt(rootPath, rootRef, mount.revision);
}

// packages/host/dist/namespace-origin.js
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
function createNamespaceCompanionOrigin(options) {
  const pageLimit2 = options.pageLimit ?? 256;
  const caseSensitivity = options.caseSensitivity ?? "insensitive";
  const fold2 = (value) => caseSensitivity === "insensitive" ? value.toLowerCase() : value;
  const index = /* @__PURE__ */ new Map();
  const listing = async (prefix, signal) => {
    const cached = index.get(prefix);
    if (cached !== void 0)
      return cached;
    const built = /* @__PURE__ */ new Map();
    const spellings = [...new Set(prefix === "" ? [""] : [prefix, fold2(prefix)])];
    for (const spelling of spellings) {
      let cursor3;
      do {
        throwIfAborted(signal);
        const page = await options.namespace.list(spelling, cursor3 === void 0 ? { limit: pageLimit2 } : { cursor: cursor3, limit: pageLimit2 }, signal);
        for (const entry2 of page.items) {
          if (entry2.kind !== "file")
            continue;
          const key2 = fold2(entry2.path);
          if (!built.has(key2)) {
            built.set(key2, {
              entryId: entry2.id,
              path: entry2.path,
              ...entry2.size === void 0 ? {} : { size: entry2.size },
              revision: entry2.revision
            });
          }
        }
        cursor3 = page.nextCursor;
      } while (cursor3 !== void 0);
    }
    index.set(prefix, built);
    return built;
  };
  return Object.freeze({
    primaryLogicalId: options.primaryLogicalId,
    caseSensitivity,
    scopes: NAMESPACE_SCOPES,
    async *enumerate(scope, enumeration, signal) {
      throwIfAborted(signal);
      if (scope !== "current-mount" && scope !== "enclosing-container")
        return;
      for (const entry2 of (await listing(enumeration.prefix, signal)).values()) {
        throwIfAborted(signal);
        yield Object.freeze({
          logicalId: entry2.path,
          ...entry2.size === void 0 ? {} : { size: entry2.size }
        });
      }
    },
    async open(logicalId, signal) {
      throwIfAborted(signal);
      const entry2 = (await listing(logicalId, signal)).get(fold2(logicalId));
      if (entry2 === void 0) {
        throw new ModkitError({
          code: NESTED_ENTRY_NOT_FOUND,
          message: `container has no entry \xAB${logicalId}\xBB`,
          context: { logicalId }
        });
      }
      const refLease = await options.namespace.openEntry(entry2.entryId, signal);
      let bytes;
      try {
        bytes = await options.extract(entry2.entryId, signal);
      } catch (error3) {
        await refLease.release();
        throw error3;
      }
      const source = containerEntrySource(refLease.value, containerEntryRevision(options.containerRevision, entry2.entryId, bytes.byteLength), bytes);
      return Object.freeze({ value: source, release: () => refLease.release() });
    }
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
  const pageLimit2 = options.pageLimit ?? 256;
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
  if (roots.length === 0)
    throw new TypeError("workspace namespace origin requires a logical root");
  if (new Set(roots.map((root) => root.rootId)).size !== roots.length) {
    throw new TypeError("workspace namespace origin root ids must differ");
  }
  const byLogicalId = /* @__PURE__ */ new Map();
  const pages = async function* (root, prefix, signal) {
    const spellings = [...new Set(prefix === "" ? [""] : [prefix, fold2(prefix)])];
    for (const spelling of spellings) {
      let cursor3;
      let pageCount = 0;
      const seenCursors = /* @__PURE__ */ new Set();
      do {
        throwIfAborted(signal);
        if (pageCount >= maxPages) {
          throw new RangeError(`workspace namespace prefix exceeds ${maxPages} pages`);
        }
        if (cursor3 !== void 0) {
          if (seenCursors.has(cursor3)) {
            throw new RangeError("workspace namespace paging cursor repeated");
          }
          seenCursors.add(cursor3);
        }
        const page = await root.namespace.list(spelling, cursor3 === void 0 ? { limit: pageLimit2 } : { cursor: cursor3, limit: pageLimit2 }, signal);
        yield* page.items;
        pageCount += 1;
        cursor3 = page.nextCursor;
      } while (cursor3 !== void 0);
    }
  };
  const joinPrefix = (prefix, suffix) => prefix === "" ? suffix : suffix === "" ? prefix : `${prefix}/${suffix}`;
  const relativeRequest = (root, logicalId) => {
    if (logicalId === "")
      return "";
    if (root.logicalPrefix === "")
      return logicalId;
    if (fold2(logicalId) === fold2(root.logicalPrefix))
      return "";
    const prefix = `${root.logicalPrefix}/`;
    return fold2(logicalId).startsWith(fold2(prefix)) ? logicalId.slice(prefix.length) : void 0;
  };
  const remember2 = (root, entry2) => {
    if (entry2.kind !== "file")
      return void 0;
    const prefix = root.pathPrefix === "" ? "" : `${root.pathPrefix}/`;
    if (prefix !== "" && !fold2(entry2.path).startsWith(fold2(prefix)))
      return void 0;
    const relative = prefix === "" ? entry2.path : entry2.path.slice(prefix.length);
    if (relative === "")
      return void 0;
    const logicalId = joinPrefix(root.logicalPrefix, relative);
    const key2 = fold2(logicalId);
    if (!byLogicalId.has(key2)) {
      byLogicalId.set(key2, {
        entryId: entry2.id,
        path: entry2.path,
        ...entry2.size === void 0 ? {} : { size: entry2.size },
        revision: entry2.revision,
        namespace: root.namespace,
        containerRevision: root.containerRevision,
        extract: root.extract
      });
    }
    return logicalId;
  };
  const find = async (logicalId, signal) => {
    const key2 = fold2(logicalId);
    const cached = byLogicalId.get(key2);
    if (cached !== void 0)
      return cached;
    for (const root of roots) {
      const relative = relativeRequest(root, logicalId);
      if (relative === void 0)
        continue;
      for await (const entry2 of pages(root, joinPrefix(root.pathPrefix, relative), signal)) {
        const remembered = remember2(root, entry2);
        if (remembered !== void 0 && fold2(remembered) === key2)
          return byLogicalId.get(key2);
      }
    }
    return void 0;
  };
  return Object.freeze({
    primaryLogicalId: options.primaryLogicalId,
    caseSensitivity,
    scopes: Object.freeze(["workspace-dependency-layer"]),
    async *enumerate(scope, enumeration, signal) {
      if (scope !== "workspace-dependency-layer")
        return;
      const yielded = /* @__PURE__ */ new Set();
      for (const root of roots) {
        const relative = relativeRequest(root, enumeration.prefix);
        if (relative === void 0)
          continue;
        for await (const entry2 of pages(root, joinPrefix(root.pathPrefix, relative), signal)) {
          throwIfAborted(signal);
          const logicalId = remember2(root, entry2);
          if (logicalId === void 0 || yielded.has(fold2(logicalId)))
            continue;
          yielded.add(fold2(logicalId));
          yield Object.freeze({
            logicalId,
            ...entry2.size === void 0 ? {} : { size: entry2.size }
          });
        }
      }
    },
    async open(logicalId, signal) {
      throwIfAborted(signal);
      const entry2 = await find(logicalId, signal);
      if (entry2 === void 0) {
        throw new ModkitError({
          code: NESTED_ENTRY_NOT_FOUND,
          message: `workspace namespace has no entry \xAB${logicalId}\xBB`,
          context: { logicalId }
        });
      }
      const refLease = await entry2.namespace.openEntry(entry2.entryId, signal);
      let bytes;
      try {
        bytes = await entry2.extract(entry2.entryId, signal);
      } catch (error3) {
        await refLease.release();
        throw error3;
      }
      return Object.freeze({
        value: containerEntrySource(refLease.value, containerEntryRevision(entry2.containerRevision, entry2.entryId, bytes.byteLength), bytes),
        release: () => refLease.release()
      });
    }
  });
}
function positiveDiscoveryLimit(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}
function createWorkspaceNamespaceCandidateDiscovery(options) {
  const pageItems2 = positiveDiscoveryLimit(options.limits.pageItems, "pageItems");
  const maxPages = positiveDiscoveryLimit(options.limits.maxPages, "maxPages");
  const maxEntries = positiveDiscoveryLimit(options.limits.maxEntries, "maxEntries");
  const maxCandidates = positiveDiscoveryLimit(options.limits.maxCandidates, "maxCandidates");
  if (typeof options.limits.maxBytes !== "bigint" || options.limits.maxBytes < 0n) {
    throw new TypeError("maxBytes must be a non-negative bigint");
  }
  if (!/^\.[a-z0-9][a-z0-9_-]*$/iu.test(options.extension)) {
    throw new TypeError("candidate extension must be an exact dotted suffix without glob syntax");
  }
  const caseSensitivity = options.caseSensitivity ?? "insensitive";
  const fold2 = (value) => caseSensitivity === "insensitive" ? value.toLowerCase() : value;
  const extension = fold2(options.extension);
  const roots = options.logicalRoots.map((root, index) => {
    if (typeof root.rootId !== "string" || root.rootId.trim() === "") {
      throw new TypeError(`logicalRoots[${index}].rootId must be a non-empty string`);
    }
    const pathPrefix = normalizeCompanionLogicalId(root.pathPrefix).replace(/\/$/u, "");
    return Object.freeze({ rootId: root.rootId, pathPrefix, rank: index });
  });
  if (roots.length === 0)
    throw new TypeError("candidate discovery requires a logical root");
  const rootsById = new Map(roots.map((root) => [root.rootId, root]));
  if (rootsById.size !== roots.length)
    throw new TypeError("candidate discovery root ids must differ");
  if (options.searches.length === 0) {
    throw new TypeError("candidate discovery requires an explicit search root");
  }
  const searches = options.searches.map((search, index) => {
    const root = rootsById.get(search.rootId);
    if (root === void 0) {
      throw new TypeError(`searches[${index}] names unknown logical root \xAB${search.rootId}\xBB`);
    }
    if (typeof search.logicalPrefix !== "string") {
      throw new TypeError(`searches[${index}].logicalPrefix must be a string`);
    }
    const logicalPrefix = search.logicalPrefix.trim() === "" ? "" : normalizeCompanionLogicalId(search.logicalPrefix).replace(/\/$/u, "");
    return Object.freeze({ root, logicalPrefix, rank: index });
  });
  const receiptSearches = Object.freeze(searches.map((search) => Object.freeze({ rootId: search.root.rootId, logicalPrefix: search.logicalPrefix })));
  return Object.freeze({
    async discover(signal) {
      throwIfAborted(signal);
      let pages = 0;
      let entries = 0;
      let bytes = 0n;
      const candidates = /* @__PURE__ */ new Map();
      const receipt = (complete) => Object.freeze({
        complete,
        pages,
        entries,
        candidates: complete ? candidates.size : 0,
        bytes: complete ? bytes : 0n,
        searches: receiptSearches
      });
      const refused = (reason, message) => Object.freeze({
        state: "refused",
        reason,
        message,
        candidates: Object.freeze([]),
        receipt: receipt(false)
      });
      for (const search of searches) {
        const rootPrefix = `${search.root.pathPrefix}/`;
        const namespacePrefix = search.logicalPrefix === "" ? rootPrefix : `${rootPrefix}${search.logicalPrefix.replace(/\/$/u, "")}/`;
        const spellings = [
          ...new Set(caseSensitivity === "insensitive" ? [namespacePrefix, fold2(namespacePrefix)] : [namespacePrefix])
        ];
        for (const spelling of spellings) {
          let cursor3;
          const seenCursors = /* @__PURE__ */ new Set();
          do {
            throwIfAborted(signal);
            if (pages >= maxPages) {
              return refused("budget-exceeded", `candidate discovery exceeded its ${maxPages}-page budget`);
            }
            if (cursor3 !== void 0) {
              if (seenCursors.has(cursor3)) {
                return refused("namespace-invalid", "candidate discovery cursor repeated");
              }
              seenCursors.add(cursor3);
            }
            const page = await options.namespace.list(spelling, cursor3 === void 0 ? { limit: pageItems2 } : { cursor: cursor3, limit: pageItems2 }, signal);
            pages += 1;
            throwIfAborted(signal);
            if (page === null || typeof page !== "object" || !Array.isArray(page.items) || page.nextCursor !== void 0 && (typeof page.nextCursor !== "string" || page.nextCursor === "")) {
              return refused("namespace-invalid", "candidate discovery received a malformed page");
            }
            if (page.items.length > pageItems2) {
              return refused("namespace-invalid", `candidate discovery page exceeded its requested ${pageItems2}-entry limit`);
            }
            for (const entry2 of page.items) {
              throwIfAborted(signal);
              if (entry2 === null || typeof entry2 !== "object" || typeof entry2.id !== "string" || entry2.id === "" || typeof entry2.path !== "string" || entry2.path === "" || typeof entry2.kind !== "string") {
                return refused("namespace-invalid", "candidate discovery received a malformed namespace entry");
              }
              entries += 1;
              if (entries > maxEntries) {
                return refused("budget-exceeded", `candidate discovery exceeded its ${maxEntries}-entry budget`);
              }
              if (entry2.kind !== "file" || !fold2(entry2.path).endsWith(extension))
                continue;
              if (!fold2(entry2.path).startsWith(fold2(rootPrefix))) {
                return refused("namespace-invalid", `namespace entry \xAB${entry2.path}\xBB escaped logical root \xAB${search.root.rootId}\xBB`);
              }
              const logicalId = entry2.path.slice(rootPrefix.length);
              if (logicalId === "")
                continue;
              const key2 = fold2(logicalId);
              if (candidates.has(key2))
                continue;
              if (entry2.size === void 0 || typeof entry2.size !== "bigint" || entry2.size < 0n || entry2.size > BigInt(Number.MAX_SAFE_INTEGER)) {
                return refused("size-unavailable", `candidate \xAB${logicalId}\xBB has no bounded revision-safe size`);
              }
              if (candidates.size >= maxCandidates) {
                return refused("budget-exceeded", `candidate discovery exceeded its ${maxCandidates}-candidate budget`);
              }
              if (bytes + entry2.size > options.limits.maxBytes) {
                return refused("budget-exceeded", `candidate discovery exceeded its ${options.limits.maxBytes}-byte budget`);
              }
              bytes += entry2.size;
              candidates.set(key2, Object.freeze({
                logicalId,
                expectedRevision: containerEntryRevision(options.containerRevision, entry2.id, Number(entry2.size)),
                size: entry2.size,
                rootId: search.root.rootId,
                rootRank: search.root.rank,
                searchRank: search.rank
              }));
            }
            cursor3 = page.nextCursor;
          } while (cursor3 !== void 0);
        }
      }
      const ordered = [...candidates.values()].sort((left, right) => left.rootRank - right.rootRank || left.searchRank - right.searchRank || (left.logicalId < right.logicalId ? -1 : left.logicalId > right.logicalId ? 1 : 0)).map(({ logicalId, expectedRevision, size, rootId }) => Object.freeze({ logicalId, expectedRevision, size, rootId }));
      return Object.freeze({
        state: "complete",
        candidates: Object.freeze(ordered),
        receipt: receipt(true)
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

// packages/host/dist/nested-subject.js
var NESTED_SUBJECT_UNSUPPORTED = "x3.host/nested-subject-unsupported";
var NESTED_ENTRY_UNREADABLE = "x3.host/nested-entry-unreadable";
var CONTAINER_EXTRACT = "container.extract";
var NAMESPACE_ENTRY_SOURCE2 = "common.view/namespace-entry-source";
function nestedSubjectServices(services) {
  return {
    inventory: services.inventory,
    target: services.target,
    executionBackends: services.executionBackends,
    ...services.serviceDefinitions === void 0 ? {} : { serviceDefinitions: services.serviceDefinitions }
  };
}
function extractHandlerOf(descriptor) {
  const operation = descriptor.operations.find((item) => item.id === CONTAINER_EXTRACT);
  if (operation === void 0 || operation.state !== "available") {
    throw new ModkitError({
      code: NESTED_SUBJECT_UNSUPPORTED,
      message: `the parent subject publishes no available ${CONTAINER_EXTRACT} operation`,
      context: {
        operations: descriptor.operations.map((item) => item.id),
        ...operation === void 0 ? {} : { state: operation.state, reason: operation.reason }
      }
    });
  }
  return operation.handlerId;
}
async function findEntry(namespace, entryId, pageLimit2, signal) {
  let cursor3;
  do {
    throwIfAborted(signal);
    const page = await namespace.list("", cursor3 === void 0 ? { limit: pageLimit2 } : { cursor: cursor3, limit: pageLimit2 }, signal);
    const found = page.items.find((item) => item.id === entryId);
    if (found !== void 0)
      return found;
    cursor3 = page.nextCursor;
  } while (cursor3 !== void 0);
  throw new ModkitError({
    code: NESTED_ENTRY_NOT_FOUND,
    message: `the parent container has no entry ${entryId}`,
    context: { entryId }
  });
}
async function openNestedSubject(options) {
  throwIfAborted(options.signal);
  const pageLimit2 = options.pageLimit ?? 256;
  const descriptor = await options.parent.descriptor();
  const handlerId = extractHandlerOf(descriptor);
  if (!descriptor.dataSources.some((item) => item.contract === NAMESPACE_ENTRY_SOURCE2 && item.major === 1)) {
    throw new ModkitError({
      code: NESTED_SUBJECT_UNSUPPORTED,
      message: `the parent subject publishes no ${NAMESPACE_ENTRY_SOURCE2}@1`,
      context: { dataSources: descriptor.dataSources.map((item) => item.contract) }
    });
  }
  const namespaceLease = await options.parent.dataSource(NAMESPACE_ENTRY_SOURCE2, 1);
  let released = false;
  const release = async () => {
    if (released)
      return;
    released = true;
    await namespaceLease.release();
  };
  try {
    const namespace = namespaceLease.value;
    const entry2 = await findEntry(namespace, options.entryId, pageLimit2, options.signal);
    const extract = async (entryId, signal) => {
      throwIfAborted(signal ?? options.signal);
      const invoked = await options.parent.operations().invoke(handlerId, { entryId }, signal === void 0 ? {} : { signal });
      if (invoked.state !== "ok" || invoked.output.kind !== "bytes") {
        throw new ModkitError({
          code: NESTED_ENTRY_UNREADABLE,
          message: `the container refused to extract entry ${entryId}`,
          context: {
            entryId,
            state: invoked.state,
            ...invoked.state === "rejected" ? { reason: invoked.reason } : {},
            ...invoked.state === "ok" ? { outputKind: invoked.output.kind } : {}
          }
        });
      }
      return invoked.output.value;
    };
    const refLease = await namespace.openEntry(entry2.id, options.signal);
    const previousRelease = release;
    let refReleased = false;
    const releaseAll = async () => {
      if (!refReleased) {
        refReleased = true;
        await refLease.release();
      }
      await previousRelease();
    };
    try {
      const bytes = await extract(entry2.id, options.signal);
      const source = containerEntrySource(refLease.value, containerEntryRevision(descriptor.revision, entry2.id, bytes.byteLength), bytes);
      const origin = createNamespaceCompanionOrigin({
        namespace,
        primaryLogicalId: entry2.path,
        containerRevision: descriptor.revision,
        extract,
        ...options.caseSensitivity === void 0 ? {} : { caseSensitivity: options.caseSensitivity },
        pageLimit: pageLimit2
      });
      const result = await openSubject({
        inventory: options.inventory,
        source,
        path: entry2.path,
        intent: options.intent ?? "full",
        target: options.target,
        grant: options.grant,
        budget: options.budget,
        resolveInput: createCompanionInputResolver(origin, {
          ...options.traitProbe === void 0 ? {} : { traitProbe: options.traitProbe },
          ...options.limits === void 0 ? {} : { limits: options.limits },
          ...options.onDiagnostic === void 0 ? {} : { onDiagnostic: options.onDiagnostic },
          ...options.budget.deadlineMs === void 0 ? {} : { deadlineMs: options.budget.deadlineMs }
        }),
        ...options.executionBackends === void 0 ? {} : { executionBackends: options.executionBackends },
        ...options.policy === void 0 ? {} : { policy: options.policy },
        ...options.serviceDefinitions === void 0 ? {} : { serviceDefinitions: options.serviceDefinitions },
        ...options.minimumConfidence === void 0 ? {} : { minimumConfidence: options.minimumConfidence },
        ...options.maxCandidates === void 0 ? {} : { maxCandidates: options.maxCandidates },
        ...options.signal === void 0 ? {} : { signal: options.signal }
      });
      if (result.state !== "opened") {
        await releaseAll();
        return Object.freeze({ result, entry: entry2 });
      }
      return Object.freeze({
        result: Object.freeze({
          ...result,
          session: sessionHoldingContainer(result.session, releaseAll)
        }),
        entry: entry2
      });
    } catch (error3) {
      await releaseAll();
      throw error3;
    }
  } catch (error3) {
    await release();
    throw error3;
  }
}
function sessionHoldingContainer(session, release) {
  let disposed = false;
  return Object.freeze({
    revision: session.revision,
    state: () => session.state(),
    descriptor: () => session.descriptor(),
    dataSource: session.dataSource.bind(session),
    operations: () => session.operations(),
    events: (signal) => session.events(signal),
    async dispose() {
      if (disposed)
        return;
      disposed = true;
      let firstError;
      try {
        await session.dispose();
      } catch (error3) {
        firstError = error3;
      }
      try {
        await release();
      } catch (error3) {
        firstError ??= error3;
      }
      if (firstError !== void 0)
        throw firstError;
    }
  });
}

// packages/host/dist/service-definitions.js
var FACETLESS_SERVICE_MATCHER_PROFILE = contractId("modkit/facetless-matcher");
var facetlessMatcher = Object.freeze({
  profile: FACETLESS_SERVICE_MATCHER_PROFILE,
  major: 1,
  match(context) {
    return context.offerFacet === void 0 && context.requestFacet === void 0 ? { state: "match", selectionKey: "facetless:v1" } : { state: "no-match" };
  }
});
function createServiceFacetMatcherProfileRegistry(additional = []) {
  const profiles = /* @__PURE__ */ new Map();
  for (const profile3 of [facetlessMatcher, ...additional]) {
    if (!Number.isSafeInteger(profile3.major) || profile3.major < 0) {
      throw new TypeError("service facet matcher major must be a safe non-negative integer");
    }
    const profileKey = `${profile3.profile}@${profile3.major}`;
    if (profiles.has(profileKey)) {
      throw new TypeError(`duplicate service facet matcher ${profileKey}`);
    }
    profiles.set(profileKey, Object.freeze({ ...profile3 }));
  }
  const registry = {
    lookup: (profile3, major) => profiles.get(`${profile3}@${major}`),
    list: () => Object.freeze([...profiles.values()].sort((left, right) => compareUtf8(left.profile, right.profile) || left.major - right.major))
  };
  return Object.freeze(registry);
}
function ownedJson(value) {
  if (value === void 0)
    return value;
  return JSON.parse(canonicalJsonStringify(value));
}
function rejection(reason, code, message) {
  return { state: "rejected", reason, diagnostics: [diagnostic("error", code, message)] };
}
function key(contract, major) {
  return `${contract}@${major}`;
}
function validDefinition(value) {
  return typeof value === "object" && value !== null && value.schemaVersion === 1 && value.kind === "service" && typeof value.contract === "string" && isQualifiedId(value.contract) && Number.isSafeInteger(value.major) && value.major >= 0 && typeof value.conformanceProfile === "string" && value.conformanceProfile.trim().length > 0 && typeof value.matching === "object" && value.matching !== null && typeof value.matching.profile === "string" && isQualifiedId(value.matching.profile) && Number.isSafeInteger(value.matching.major) && value.matching.major >= 0;
}
function normalize2(value, provenance) {
  const owned = ownedJson(value);
  return Object.freeze({
    ...owned,
    contract: contractId(owned.contract),
    matching: Object.freeze({
      ...owned.matching,
      profile: contractId(owned.matching.profile)
    }),
    provenance: Object.freeze(ownedJson(provenance))
  });
}
function presenceDiagnostics(definition, context, label) {
  if (definition.presence === "forbidden" && context.facet !== void 0) {
    return [
      diagnostic("error", "x3.host/facet-forbidden", `${label} facet is forbidden for ${context.contract}@${context.major}`)
    ];
  }
  if (definition.presence === "required" && context.facet === void 0) {
    return [
      diagnostic("error", "x3.host/facet-required", `${label} facet is required for ${context.contract}@${context.major}`)
    ];
  }
  return [];
}
function createServiceContractDefinitionRegistry(options) {
  const matcherProfiles = options.matcherProfiles;
  const isNamespaceOwner = options.isNamespaceOwner;
  const validateJsonSchemaRef = options.validateJsonSchemaRef;
  const validateMatcherConfiguration = options.validateMatcherConfiguration;
  let registrations = /* @__PURE__ */ new Map();
  const ownerEpochs = /* @__PURE__ */ new Map();
  const validateFacet = async (side, context) => {
    const registration = registrations.get(key(context.contract, context.major));
    if (registration === void 0) {
      return [
        diagnostic("error", "x3.host/service-contract-unregistered", `service contract ${context.contract}@${context.major} is not registered`)
      ];
    }
    const definition = side === "offer" ? registration.offerFacet : registration.requestFacet;
    const diagnostics = presenceDiagnostics(definition, context, side);
    if (context.facet !== void 0 && definition.presence !== "forbidden" && !hasErrors(diagnostics)) {
      try {
        diagnostics.push(...await validateJsonSchemaRef(definition.schema, ownedJson(context.facet), registration.provenance));
      } catch (error3) {
        diagnostics.push(diagnostic("error", "x3.host/facet-schema-validation-failed", "facet schema validation failed closed", [], { error: error3 instanceof Error ? error3.message : String(error3) }));
      }
    }
    return Object.freeze(diagnostics);
  };
  return {
    async replaceOwnerInventory(ownerExtensionId, definitions) {
      const epoch = (ownerEpochs.get(ownerExtensionId) ?? 0) + 1;
      ownerEpochs.set(ownerExtensionId, epoch);
      const pending = [];
      const seen = /* @__PURE__ */ new Set();
      for (const entry2 of definitions) {
        if (!validDefinition(entry2.definition)) {
          return rejection("invalid-definition", "x3.host/invalid-service-contract-definition", "service contract definition is malformed");
        }
        if (await isNamespaceOwner(ownerExtensionId, entry2.definition.contract) !== true) {
          return rejection("namespace-owner-mismatch", "x3.host/service-contract-owner-mismatch", `${ownerExtensionId} does not own ${entry2.definition.contract}`);
        }
        const definitionKey = key(entry2.definition.contract, entry2.definition.major);
        if (seen.has(definitionKey)) {
          return rejection("duplicate", "x3.host/duplicate-service-contract-definition", `duplicate service contract definition ${definitionKey}`);
        }
        seen.add(definitionKey);
        const profile3 = matcherProfiles.lookup(contractId(entry2.definition.matching.profile), entry2.definition.matching.major);
        if (profile3 === void 0) {
          return rejection("matcher-unavailable", "x3.host/facet-matcher-unavailable", `matcher ${entry2.definition.matching.profile}@${entry2.definition.matching.major} is unavailable`);
        }
        if (profile3.configurationSchema !== void 0 && validateMatcherConfiguration !== void 0) {
          const diagnostics = await validateMatcherConfiguration(profile3.configurationSchema, entry2.definition.matching.configuration);
          if (hasErrors(diagnostics)) {
            return {
              state: "rejected",
              reason: "matcher-configuration-invalid",
              diagnostics
            };
          }
        }
        pending.push(normalize2(entry2.definition, entry2.provenance));
      }
      if (ownerEpochs.get(ownerExtensionId) !== epoch) {
        return rejection("version-conflict", "x3.host/stale-definition-replacement", "a newer owner inventory operation superseded this replacement");
      }
      const next = new Map([...registrations].filter(([, registration]) => registration.provenance.ownerExtensionId !== ownerExtensionId));
      for (const registration of pending) {
        const registrationKey = key(registration.contract, registration.major);
        if (next.has(registrationKey)) {
          return rejection("duplicate", "x3.host/service-contract-conflict", `service contract ${registrationKey} is already owned by another extension`);
        }
        next.set(registrationKey, registration);
      }
      registrations = next;
      return { state: "committed" };
    },
    unregisterOwner(ownerExtensionId) {
      ownerEpochs.set(ownerExtensionId, (ownerEpochs.get(ownerExtensionId) ?? 0) + 1);
      registrations = new Map([...registrations].filter(([, registration]) => registration.provenance.ownerExtensionId !== ownerExtensionId));
    },
    lookup: (contract, major) => registrations.get(key(contract, major)),
    list: () => Object.freeze([...registrations.values()].sort((left, right) => compareUtf8(left.contract, right.contract) || left.major - right.major)),
    validateOfferFacet: (context) => validateFacet("offer", context),
    validateRequestFacet: (context) => validateFacet("request", context),
    async matchFacets(context) {
      const registration = registrations.get(key(context.contract, context.major));
      if (registration === void 0) {
        return {
          state: "invalid",
          diagnostics: [
            diagnostic("error", "x3.host/service-contract-unregistered", `service contract ${context.contract}@${context.major} is not registered`)
          ]
        };
      }
      const offerDiagnostics = await validateFacet("offer", {
        contract: context.contract,
        major: context.major,
        ownerExtensionId: context.ownerExtensionId,
        facet: context.offerFacet
      });
      const requestDiagnostics = await validateFacet("request", {
        contract: context.contract,
        major: context.major,
        ownerExtensionId: context.ownerExtensionId,
        facet: context.requestFacet
      });
      const diagnostics = [...offerDiagnostics, ...requestDiagnostics];
      if (hasErrors(diagnostics))
        return { state: "invalid", diagnostics };
      const profile3 = matcherProfiles.lookup(registration.matching.profile, registration.matching.major);
      if (profile3 === void 0) {
        return {
          state: "invalid",
          diagnostics: [
            diagnostic("error", "x3.host/facet-matcher-unavailable", "the registered facet matcher profile is unavailable")
          ]
        };
      }
      try {
        const result = await profile3.match({
          ...context,
          offerFacet: ownedJson(context.offerFacet),
          requestFacet: ownedJson(context.requestFacet)
        }, registration.matching.configuration);
        if (result.state === "match" && (typeof result.selectionKey !== "string" || result.selectionKey.trim().length === 0)) {
          throw new TypeError("matcher returned a blank selection key");
        }
        return result;
      } catch (error3) {
        return {
          state: "invalid",
          diagnostics: [
            diagnostic("error", "x3.host/facet-matcher-failed", "the host-trusted facet matcher failed closed", [], { error: error3 instanceof Error ? error3.message : String(error3) })
          ]
        };
      }
    }
  };
}
async function registerServiceContractDefinitionsFromInventory(inventory, registry) {
  const byOwner = /* @__PURE__ */ new Map();
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (!contribution.inventoryEligible)
        continue;
      for (const fact2 of contribution.facts) {
        if (fact2.contract.id !== CONTRACT_DEFINITION_FACT || fact2.contract.major !== 1)
          continue;
        if (typeof fact2.value !== "object" || fact2.value === null || Array.isArray(fact2.value)) {
          continue;
        }
        const definitionValue = fact2.value;
        if (definitionValue["kind"] !== "service")
          continue;
        const owner = fact2.provenance.ownerExtensionId;
        const entries = byOwner.get(owner) ?? [];
        entries.push({
          definition: definitionValue,
          provenance: fact2.provenance
        });
        byOwner.set(owner, entries);
      }
    }
  }
  const results = [];
  for (const owner of [...byOwner.keys()].sort(compareUtf8)) {
    results.push(await registry.replaceOwnerInventory(owner, byOwner.get(owner) ?? []));
  }
  return Object.freeze(results);
}

// packages/host/dist/editing-definitions.js
var STANDARD_EDITING_OWNER = "modkit/editing";
var REQUIREMENT_KEYS = ["formatId", "representationId", "mutationMode", "minimumRoundTrip"];
var OFFER_KEYS = [...REQUIREMENT_KEYS, "providerId", "fidelityEvidenceId"];
var MUTATION_MODES = /* @__PURE__ */ new Set(["export-only", "mutate"]);
var ROUND_TRIPS = /* @__PURE__ */ new Set(["byte-identical", "semantic", "lossy", "none"]);
function facetOf(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return void 0;
  const record = value;
  const own = Object.keys(record);
  if (own.length !== keys.length || !keys.every((key2) => own.includes(key2)))
    return void 0;
  for (const key2 of keys) {
    if (typeof record[key2] !== "string" || record[key2].length === 0)
      return void 0;
  }
  if (!MUTATION_MODES.has(record["mutationMode"]))
    return void 0;
  if (!ROUND_TRIPS.has(record["minimumRoundTrip"]))
    return void 0;
  return record;
}
function matchWriterFacets(context) {
  const request = facetOf(context.requestFacet, REQUIREMENT_KEYS);
  const offer = facetOf(context.offerFacet, OFFER_KEYS);
  if (request === void 0 || offer === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic("error", "x3.host/writer-facet-invalid", `${context.contract}@${context.major}: writer request and offer facets must both be complete`)
      ]
    };
  }
  return writerOfferSatisfies(request, offer) ? {
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
    schema: Object.freeze({ $ref: "https://schemas.modkit.org/x3/writer-offer.v1.schema.json" })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/writer-requirement.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: WRITER_FACET_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.edit/writer-v1",
  surface: WRITER_SURFACE
});
var STANDARD_EDITING_DEFINITIONS = Object.freeze([WRITER_CONTRACT_DEFINITION]);
function registerStandardEditingDefinitions(definitions) {
  return definitions.replaceOwnerInventory(STANDARD_EDITING_OWNER, STANDARD_EDITING_DEFINITIONS.map((definition) => ({
    definition,
    // host code, not an inventoried artifact: the provenance names the platform, digests are
    // the contract's own coordinates so a lookalike registration is distinguishable
    provenance: {
      ownerExtensionId: STANDARD_EDITING_OWNER,
      extensionVersion: "1.0.0",
      inventoryRecordId: `host:${definition.contract}@${definition.major}`,
      manifestDigest: `host:${definition.contract}@${definition.major}`,
      artifactDigest: "host:standard-editing-definitions",
      artifactRoot: "host:",
      manifestPath: "host:standard-editing-definitions"
    }
  })));
}

// packages/host/dist/language/workspace.js
var LANGUAGE_WORKSPACE_NOT_INITIALIZED = "x3.host/language-workspace-not-initialized";
var LANGUAGE_WORKSPACE_SHUT_DOWN = "x3.host/language-workspace-shut-down";
var LANGUAGE_DOCUMENT_ALREADY_OPEN = "x3.host/language-document-already-open";
var LANGUAGE_DOCUMENT_NOT_OPEN = "x3.host/language-document-not-open";
var LANGUAGE_DOCUMENT_CHANGE_INVALID = "x3.host/language-document-change-invalid";
var LANGUAGE_PROVIDER_FAILED = "x3.host/language-provider-failed";
var LANGUAGE_ANALYSIS_INVALID = "x3.host/language-analysis-invalid";
var LANGUAGE_FEATURE_INVALID = "x3.host/language-feature-invalid";
var LANGUAGE_DEFAULT_MAX_RESULTS = 256;
var LANGUAGE_MAX_RESULTS = 2048;
var LANGUAGE_DEFAULT_MAX_DOCUMENTS = 32;
var LANGUAGE_MAX_DOCUMENTS = 64;
var LANGUAGE_DEFAULT_MAX_EDITS = 1024;
var LANGUAGE_MAX_EDITS = 4096;
var ROUTE_KEYS = /* @__PURE__ */ new Set(["languageIds", "documentKinds", "extensions"]);
var TOKEN_KINDS = /* @__PURE__ */ new Set([
  "comment",
  "function",
  "keyword",
  "number",
  "operator",
  "parameter",
  "property",
  "string",
  "type",
  "variable"
]);
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
function recordOf(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonBlankStrings(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    return void 0;
  }
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function languageOfferFacet(value) {
  const record = recordOf(value);
  if (record === void 0 || Object.keys(record).some((key2) => !ROUTE_KEYS.has(key2))) {
    throw new TypeError("language provider offer facet must contain only route fields");
  }
  const languageIds = nonBlankStrings(record["languageIds"]);
  const documentKinds = record["documentKinds"] === void 0 ? void 0 : nonBlankStrings(record["documentKinds"]);
  const extensions = record["extensions"] === void 0 ? void 0 : nonBlankStrings(record["extensions"]);
  if (languageIds === void 0 || record["documentKinds"] !== void 0 && documentKinds === void 0 || record["extensions"] !== void 0 && extensions === void 0) {
    throw new TypeError("language provider offer facet contains an invalid route list");
  }
  return {
    languageIds,
    ...documentKinds === void 0 ? {} : { documentKinds },
    ...extensions === void 0 ? {} : { extensions }
  };
}
var normalizedExtension = (value) => value.replace(/^\./u, "").toLowerCase();
function languageProviderRoutes(inventory) {
  const routes = /* @__PURE__ */ new Map();
  for (const provider of offersFromInventory(inventory)) {
    for (const offer of provider.provides) {
      if (offer.contract !== LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT || offer.major !== 1)
        continue;
      const facet = languageOfferFacet(offer.facet);
      const kinds = facet.documentKinds ?? [void 0];
      const extensions = facet.extensions ?? [void 0];
      for (const languageId of facet.languageIds) {
        for (const documentKind of kinds) {
          for (const rawExtension of extensions) {
            const extension = rawExtension === void 0 ? void 0 : normalizedExtension(rawExtension);
            if (extension !== void 0 && extension.length === 0) {
              throw new TypeError("language provider extension route must not be only a dot");
            }
            const route = Object.freeze({
              languageId,
              ...documentKind === void 0 ? {} : { documentKind },
              ...extension === void 0 ? {} : { extension }
            });
            routes.set(canonicalJsonStringify(route), route);
          }
        }
      }
    }
  }
  return Object.freeze([...routes.entries()].sort(([left], [right]) => compareUtf8(left, right)).map(([, route]) => route));
}
var routeOf = (request) => Object.freeze({
  languageId: request.languageId,
  ...request.documentKind === void 0 ? {} : { documentKind: request.documentKind },
  ...request.extension === void 0 ? {} : { extension: normalizedExtension(request.extension) }
});
var routeKey = (route) => canonicalJsonStringify(route);
function workspaceError(code, message, context = {}) {
  return new ModkitError({ code, message, context });
}
function validateRequest(request) {
  if (typeof request.languageId !== "string" || request.languageId.trim().length === 0 || typeof request.document.uri !== "string" || request.document.uri.trim().length === 0 || typeof request.document.languageId !== "string" || request.document.languageId !== request.languageId || !Number.isSafeInteger(request.document.version) || request.document.version < 0 || typeof request.document.text !== "string" || request.documentKind !== void 0 && (typeof request.documentKind !== "string" || request.documentKind.trim().length === 0) || request.extension !== void 0 && (typeof request.extension !== "string" || request.extension.trim().length === 0)) {
    throw workspaceError(LANGUAGE_DOCUMENT_CHANGE_INVALID, "language documents need a non-empty URI, a matching route language and a non-negative safe version", { uri: request.document.uri, languageId: request.languageId });
  }
}
function boundedInteger(value, fallback, maximum, name) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw workspaceError(LANGUAGE_FEATURE_INVALID, `${name} must be a safe integer from 1 through ${maximum}`, { [name]: String(selected) });
  }
  return selected;
}
function validateFeatureRequest(request, positioned) {
  if (typeof request.uri !== "string" || request.uri.trim().length === 0 || !Number.isSafeInteger(request.documentVersion) || request.documentVersion < 0) {
    throw workspaceError(LANGUAGE_FEATURE_INVALID, "language feature requests need a non-empty URI and exact non-negative document version", { uri: request.uri, version: String(request.documentVersion) });
  }
  boundedInteger(request.maxResults, LANGUAGE_DEFAULT_MAX_RESULTS, LANGUAGE_MAX_RESULTS, "maxResults");
  boundedInteger(request.maxDocuments, LANGUAGE_DEFAULT_MAX_DOCUMENTS, LANGUAGE_MAX_DOCUMENTS, "maxDocuments");
  if (positioned) {
    const position = request.position;
    if (position === void 0 || !Number.isSafeInteger(position.line) || position.line < 0 || !Number.isSafeInteger(position.character) || position.character < 0) {
      throw workspaceError(LANGUAGE_FEATURE_INVALID, "language feature position is invalid", {
        uri: request.uri
      });
    }
  }
}
function lineLengths(text) {
  return text.split("\n").map((line) => line.endsWith("\r") ? line.length - 1 : line.length);
}
function validPosition(position, lengths) {
  if (position === void 0)
    return false;
  const length = lengths[position.line];
  return Number.isSafeInteger(position.line) && Number.isSafeInteger(position.character) && position.line >= 0 && position.character >= 0 && length !== void 0 && position.character <= length;
}
function validRange(range, lengths) {
  if (range === void 0)
    return false;
  return validPosition(range.start, lengths) && validPosition(range.end, lengths) && (range.start.line < range.end.line || range.start.line === range.end.line && range.start.character <= range.end.character);
}
function validToken(token, lengths) {
  if (token === void 0)
    return false;
  return validRange(token.range, lengths) && TOKEN_KINDS.has(token.kind) && (token.modifiers === void 0 || token.modifiers.every((item) => typeof item === "string"));
}
function validSymbol(symbol, lengths, depth = 0) {
  if (symbol === void 0)
    return false;
  return depth <= 64 && typeof symbol.name === "string" && symbol.name.length > 0 && SYMBOL_KINDS.has(symbol.kind) && validRange(symbol.range, lengths) && validRange(symbol.selectionRange, lengths) && (symbol.detail === void 0 || typeof symbol.detail === "string") && (symbol.children === void 0 || Array.isArray(symbol.children) && symbol.children.every((child) => validSymbol(child, lengths, depth + 1)));
}
function validLooseRange(range) {
  if (range === void 0)
    return false;
  const positions = [range.start, range.end];
  return positions.every((position) => Number.isSafeInteger(position.line) && position.line >= 0 && Number.isSafeInteger(position.character) && position.character >= 0) && (range.start.line < range.end.line || range.start.line === range.end.line && range.start.character <= range.end.character);
}
function invalidFeature(message, uri) {
  throw workspaceError(LANGUAGE_FEATURE_INVALID, message, { uri });
}
function validateCompletionList(value, request) {
  const list = value;
  if (typeof list !== "object" || list === null || !Array.isArray(list.items) || list.items.length > request.maxResults || typeof list.isIncomplete !== "boolean" || !list.items.every((item) => typeof item === "object" && item !== null && typeof item.label === "string" && item.label.length > 0 && COMPLETION_KINDS.has(item.kind) && (item.detail === void 0 || typeof item.detail === "string") && (item.documentation === void 0 || typeof item.documentation === "string") && (item.insertText === void 0 || typeof item.insertText === "string") && (item.insertTextFormat === void 0 || item.insertTextFormat === "plain-text" || item.insertTextFormat === "snippet") && (item.sortText === void 0 || typeof item.sortText === "string"))) {
    invalidFeature("language provider returned an invalid or unbounded completion list", request.document.uri);
  }
  return list;
}
function validateHover(value, request) {
  if (value === void 0)
    return void 0;
  const hover = value;
  if (typeof hover !== "object" || hover === null || typeof hover.markdown !== "string" || hover.range !== void 0 && !validRange(hover.range, lineLengths(request.document.text)) || hover.provenance !== void 0 && typeof hover.provenance !== "string") {
    invalidFeature("language provider returned invalid hover information", request.document.uri);
  }
  return hover;
}
function validateSignatureHelp(value, request) {
  if (value === void 0)
    return void 0;
  const help = value;
  const parameterCount = typeof help === "object" && help !== null && Array.isArray(help.signatures) ? help.signatures.reduce((count, signature) => count + (Array.isArray(signature.parameters) ? signature.parameters.length : 0), 0) : request.maxResults + 1;
  if (typeof help !== "object" || help === null || !Array.isArray(help.signatures) || help.signatures.length > request.maxResults || help.signatures.length === 0 || parameterCount > request.maxResults || !Number.isSafeInteger(help.activeSignature) || help.activeSignature < 0 || help.activeSignature >= help.signatures.length || !Number.isSafeInteger(help.activeParameter) || help.activeParameter < 0 || help.activeParameter >= Math.max(1, help.signatures[help.activeSignature]?.parameters.length ?? 0) || !help.signatures.every((signature) => typeof signature.label === "string" && (signature.documentation === void 0 || typeof signature.documentation === "string") && Array.isArray(signature.parameters) && signature.parameters.length <= request.maxResults && signature.parameters.every((parameter) => typeof parameter.label === "string" && (parameter.documentation === void 0 || typeof parameter.documentation === "string")))) {
    invalidFeature("language provider returned invalid signature help", request.document.uri);
  }
  return help;
}
function validateLocationList(value, request) {
  const list = value;
  if (typeof list !== "object" || list === null || !Array.isArray(list.locations) || list.locations.length > request.maxResults || typeof list.isIncomplete !== "boolean" || !list.locations.every((location) => typeof location === "object" && location !== null && typeof location.uri === "string" && location.uri.length > 0 && validLooseRange(location.range))) {
    invalidFeature("language provider returned invalid or unbounded locations", request.document.uri);
  }
  return list;
}
function validatePreparation(value, request) {
  if (value === void 0)
    return void 0;
  const preparation = value;
  if (typeof preparation !== "object" || preparation === null || typeof preparation.placeholder !== "string" || preparation.placeholder.length === 0 || !validRange(preparation.range, lineLengths(request.document.text))) {
    invalidFeature("language provider returned invalid rename preparation", request.document.uri);
  }
  return preparation;
}
var comparePosition = (left, right) => left.line - right.line || left.character - right.character;
function validateTextEditList(value, request) {
  const list = value;
  const lengths = lineLengths(request.document.text);
  const edits = typeof list === "object" && list !== null && Array.isArray(list.edits) ? list.edits : [];
  const editShapesValid = edits.every((item) => typeof item === "object" && item !== null && typeof item.newText === "string" && validRange(item.range, lengths));
  const ordered = editShapesValid ? [...edits].sort((left, right) => comparePosition(left.range.start, right.range.start) || comparePosition(left.range.end, right.range.end)) : [];
  const overlaps = ordered.some((item, index) => {
    const previous = ordered[index - 1];
    return previous !== void 0 && comparePosition(previous.range.end, item.range.start) > 0;
  });
  if (typeof list !== "object" || list === null || list.isComplete !== true || !Array.isArray(list.edits) || list.edits.length > request.maxResults || overlaps || !editShapesValid) {
    invalidFeature("language provider returned invalid, overlapping or unbounded formatting edits", request.document.uri);
  }
  return list;
}
function validateDocumentSymbols(value, request) {
  const list = value;
  let count = 0;
  const countSymbol = (symbol) => {
    count += 1;
    for (const child of symbol.children ?? [])
      countSymbol(child);
  };
  if (typeof list === "object" && list !== null && Array.isArray(list.symbols)) {
    for (const symbol of list.symbols)
      countSymbol(symbol);
  }
  if (typeof list !== "object" || list === null || !Array.isArray(list.symbols) || count > request.maxResults || typeof list.isIncomplete !== "boolean" || !list.symbols.every((symbol) => validSymbol(symbol, lineLengths(request.document.text)))) {
    invalidFeature("language provider returned invalid or unbounded document symbols", request.document.uri);
  }
  return list;
}
function validateWorkspaceSymbols(value, request) {
  const list = value;
  if (typeof list !== "object" || list === null || !Array.isArray(list.symbols) || list.symbols.length > request.maxResults || typeof list.isIncomplete !== "boolean" || !list.symbols.every((symbol) => typeof symbol.name === "string" && symbol.name.length > 0 && SYMBOL_KINDS.has(symbol.kind) && typeof symbol.location?.uri === "string" && symbol.location.uri.length > 0 && validLooseRange(symbol.location.range) && (symbol.containerName === void 0 || typeof symbol.containerName === "string") && (symbol.detail === void 0 || typeof symbol.detail === "string"))) {
    invalidFeature("language provider returned invalid or unbounded workspace symbols", request.document.uri);
  }
  return list;
}
function validateDiagnosticList(value, request) {
  const list = value;
  const lengths = lineLengths(request.document.text);
  if (typeof list !== "object" || list === null || !Array.isArray(list.diagnostics) || list.diagnostics.length > request.maxResults || typeof list.isIncomplete !== "boolean" || !list.diagnostics.every((item) => validRange(item.range, lengths) && typeof item.message === "string" && ["error", "warning", "information", "hint"].includes(item.severity) && (item.code === void 0 || typeof item.code === "string") && (item.source === void 0 || typeof item.source === "string"))) {
    invalidFeature("language provider returned invalid or unbounded diagnostics", request.document.uri);
  }
  return list;
}
function validateAnalysis(value, document) {
  const lengths = lineLengths(document.text);
  let valid = false;
  try {
    const analysis = value;
    valid = analysis.documentUri === document.uri && analysis.documentVersion === document.version && Array.isArray(analysis.tokens) && analysis.tokens.every((token) => validToken(token, lengths)) && Array.isArray(analysis.diagnostics) && analysis.diagnostics.every((item) => validRange(item.range, lengths) && typeof item.message === "string" && ["error", "warning", "information", "hint"].includes(item.severity) && (item.code === void 0 || typeof item.code === "string") && (item.source === void 0 || typeof item.source === "string")) && Array.isArray(analysis.symbols) && analysis.symbols.every((symbol) => validSymbol(symbol, lengths));
  } catch {
    valid = false;
  }
  if (!valid) {
    throw workspaceError(LANGUAGE_ANALYSIS_INVALID, `language provider returned an invalid analysis for ${document.uri}@${document.version}`, { uri: document.uri, version: String(document.version) });
  }
  return value;
}
function linkedSignal(controller, signal) {
  if (signal === void 0)
    return () => void 0;
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => void 0;
  }
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}
async function waitWithSignal(promise, signal) {
  throwIfAborted(signal);
  if (signal === void 0)
    return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new OperationCancelledError(signal.reason));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error3) => {
      signal.removeEventListener("abort", abort);
      reject(error3);
    });
  });
}
function createLanguageWorkspace(options) {
  const documents = /* @__PURE__ */ new Map();
  const featureControllers = /* @__PURE__ */ new Set();
  let state = "new";
  let shutdownPromise;
  let workspaceGeneration = 0;
  const invalidateFeatures = (reason) => {
    workspaceGeneration += 1;
    for (const controller of featureControllers)
      controller.abort(reason);
    featureControllers.clear();
  };
  const requireReady = () => {
    if (state === "new") {
      throw workspaceError(LANGUAGE_WORKSPACE_NOT_INITIALIZED, "initialize the language workspace before opening documents");
    }
    if (state === "shut-down") {
      throw workspaceError(LANGUAGE_WORKSPACE_SHUT_DOWN, "the language workspace is shut down");
    }
  };
  const release = async (entry2) => {
    if (entry2.released)
      return;
    entry2.released = true;
    await entry2.resolution.release();
  };
  const requireFeatureEntry = (request, positioned) => {
    requireReady();
    validateFeatureRequest(request, positioned);
    const entry2 = documents.get(request.uri);
    if (entry2 === void 0) {
      throw workspaceError(LANGUAGE_DOCUMENT_NOT_OPEN, `language document ${request.uri} is not open`, { uri: request.uri });
    }
    if (entry2.version !== request.documentVersion) {
      throw new OperationCancelledError("stale language feature request");
    }
    if (positioned && !validPosition(request.position, lineLengths(entry2.document.text))) {
      throw workspaceError(LANGUAGE_FEATURE_INVALID, "language feature position is outside the document", {
        uri: request.uri
      });
    }
    return entry2;
  };
  const invokeFeature = async (workspaceRequest, positioned, call, validate, additions = {}) => {
    const entry2 = requireFeatureEntry(workspaceRequest, positioned);
    throwIfAborted(workspaceRequest.signal);
    const maxResults = boundedInteger(workspaceRequest.maxResults, LANGUAGE_DEFAULT_MAX_RESULTS, LANGUAGE_MAX_RESULTS, "maxResults");
    const maxDocuments = boundedInteger(workspaceRequest.maxDocuments, LANGUAGE_DEFAULT_MAX_DOCUMENTS, LANGUAGE_MAX_DOCUMENTS, "maxDocuments");
    const workspaceLanguageIds = entry2.resolution.provider.workspaceLanguageIds;
    const acceptedLanguageIds = new Set(workspaceLanguageIds === void 0 ? [entry2.route.languageId] : workspaceLanguageIds);
    if (!acceptedLanguageIds.has(entry2.route.languageId)) {
      acceptedLanguageIds.clear();
      acceptedLanguageIds.add(entry2.route.languageId);
    }
    const candidates = [...documents.values()].filter((candidate) => acceptedLanguageIds.has(candidate.route.languageId)).sort((left, right) => compareUtf8(left.uri, right.uri));
    const primary = candidates.findIndex((candidate) => candidate === entry2);
    if (primary > 0)
      candidates.unshift(...candidates.splice(primary, 1));
    const selected = candidates.slice(0, maxDocuments);
    const generation = workspaceGeneration;
    const controller = new AbortController();
    featureControllers.add(controller);
    const unlink = linkedSignal(controller, workspaceRequest.signal);
    const providerRequest = Object.freeze({
      document: entry2.document,
      workspaceDocuments: Object.freeze(selected.map((candidate) => candidate.document)),
      workspaceIncomplete: candidates.length > selected.length,
      maxResults,
      maxDocuments,
      ...additions,
      signal: controller.signal
    });
    try {
      const pending = call(entry2.resolution.provider, providerRequest);
      if (pending === void 0)
        return void 0;
      let candidate;
      try {
        candidate = await pending;
      } catch (error3) {
        if (isCancellation(error3))
          throw error3;
        throwIfAborted(controller.signal);
        throw workspaceError(LANGUAGE_PROVIDER_FAILED, `language provider feature failed for ${entry2.uri}@${entry2.version}`, {
          uri: entry2.uri,
          version: String(entry2.version),
          error: error3 instanceof Error ? error3.message : String(error3)
        });
      }
      throwIfAborted(controller.signal);
      if (generation !== workspaceGeneration || documents.get(entry2.uri) !== entry2 || entry2.version !== workspaceRequest.documentVersion) {
        throw new OperationCancelledError("stale language feature result");
      }
      return validate(candidate, providerRequest);
    } finally {
      unlink();
      featureControllers.delete(controller);
    }
  };
  const validateWorkspaceEdit = (value, request, maxEdits) => {
    if (value === void 0)
      return void 0;
    const edit = value;
    let editCount = 0;
    const seen = /* @__PURE__ */ new Set();
    const valid = typeof edit === "object" && edit !== null && edit.isComplete === true && Array.isArray(edit.documentChanges) && edit.documentChanges.length <= request.maxDocuments && edit.documentChanges.every((change) => {
      const open = documents.get(change.uri);
      editCount += Array.isArray(change.edits) ? change.edits.length : maxEdits + 1;
      if (open === void 0 || seen.has(change.uri) || change.documentVersion !== open.version || !Array.isArray(change.edits) || editCount > maxEdits) {
        return false;
      }
      seen.add(change.uri);
      const lengths = lineLengths(open.document.text);
      return change.edits.every((item) => typeof item.newText === "string" && validRange(item.range, lengths));
    });
    if (!valid) {
      invalidFeature("language provider returned an invalid or unbounded workspace edit", request.document.uri);
    }
    return edit;
  };
  const analyze = (entry2, request) => {
    entry2.analysisController?.abort("superseded by a newer language analysis");
    const controller = new AbortController();
    entry2.analysisController = controller;
    const unlink = linkedSignal(controller, request.signal);
    const pending = (async () => {
      try {
        throwIfAborted(controller.signal);
        let candidate;
        try {
          candidate = await entry2.resolution.provider.analyze({
            document: request.document,
            ...request.include === void 0 ? {} : { include: request.include },
            signal: controller.signal
          });
        } catch (error3) {
          if (isCancellation(error3))
            throw error3;
          throwIfAborted(controller.signal);
          throw workspaceError(LANGUAGE_PROVIDER_FAILED, `language provider failed for ${request.document.uri}@${request.document.version}`, {
            uri: request.document.uri,
            version: String(request.document.version),
            error: error3 instanceof Error ? error3.message : String(error3)
          });
        }
        throwIfAborted(controller.signal);
        const analysis = validateAnalysis(candidate, request.document);
        throwIfAborted(controller.signal);
        const result = Object.freeze({
          state: "resolved",
          analysis,
          hostDiagnostics: entry2.resolution.diagnostics
        });
        if (documents.get(entry2.uri) !== entry2 || entry2.version !== request.document.version) {
          throw new OperationCancelledError("stale language analysis");
        }
        entry2.current = result;
        return result;
      } finally {
        unlink();
        if (entry2.analysisController === controller)
          delete entry2.analysisController;
      }
    })();
    entry2.pending = pending;
    return pending;
  };
  const closeEntry = async (entry2) => {
    if (documents.get(entry2.uri) === entry2)
      documents.delete(entry2.uri);
    entry2.analysisController?.abort("language document closed");
    try {
      await entry2.pending;
    } catch (error3) {
      if (!isCancellation(error3)) {
      }
    }
    await release(entry2);
  };
  return Object.freeze({
    async initialize() {
      if (state === "shut-down") {
        throw workspaceError(LANGUAGE_WORKSPACE_SHUT_DOWN, "the language workspace is shut down");
      }
      state = "ready";
    },
    async open(request) {
      requireReady();
      validateRequest(request);
      throwIfAborted(request.signal);
      if (documents.has(request.document.uri)) {
        throw workspaceError(LANGUAGE_DOCUMENT_ALREADY_OPEN, `language document ${request.document.uri} is already open`, { uri: request.document.uri });
      }
      const route = routeOf(request);
      const resolution = await resolveLanguageProvider({
        services: options.services,
        ...route,
        grant: options.grant,
        budgets: options.budgets,
        ...request.signal === void 0 ? {} : { signal: request.signal }
      });
      if (resolution.state === "unresolved") {
        throwIfAborted(request.signal);
        return Object.freeze({
          state: "unresolved",
          hostDiagnostics: resolution.diagnostics
        });
      }
      try {
        throwIfAborted(request.signal);
      } catch (error3) {
        await resolution.release();
        throw error3;
      }
      const entry2 = {
        uri: request.document.uri,
        route,
        resolution,
        version: request.document.version,
        document: request.document,
        released: false
      };
      invalidateFeatures("language document opened");
      documents.set(entry2.uri, entry2);
      try {
        return await analyze(entry2, request);
      } catch (error3) {
        if (documents.get(entry2.uri) === entry2)
          await closeEntry(entry2);
        throw error3;
      }
    },
    async change(request) {
      requireReady();
      validateRequest(request);
      const entry2 = documents.get(request.document.uri);
      if (entry2 === void 0) {
        throw workspaceError(LANGUAGE_DOCUMENT_NOT_OPEN, `language document ${request.document.uri} is not open`, { uri: request.document.uri });
      }
      const nextRoute = routeOf(request);
      if (routeKey(entry2.route) !== routeKey(nextRoute) || request.document.version <= entry2.version) {
        throw workspaceError(LANGUAGE_DOCUMENT_CHANGE_INVALID, "a language document change must preserve its route and strictly increase its version", {
          uri: request.document.uri,
          currentVersion: String(entry2.version),
          nextVersion: String(request.document.version)
        });
      }
      invalidateFeatures("language document changed");
      entry2.version = request.document.version;
      entry2.document = request.document;
      delete entry2.current;
      return analyze(entry2, request);
    },
    async current(uri, signal) {
      requireReady();
      const entry2 = documents.get(uri);
      if (entry2 === void 0)
        return void 0;
      if (entry2.pending !== void 0)
        return waitWithSignal(entry2.pending, signal);
      return entry2.current;
    },
    completion(request) {
      return invokeFeature(request, true, (provider, feature) => provider.completion?.({
        ...feature,
        position: request.position
      }), validateCompletionList, { position: request.position });
    },
    hover(request) {
      return invokeFeature(request, true, (provider, feature) => provider.hover?.({ ...feature, position: request.position }), validateHover, { position: request.position });
    },
    signatureHelp(request) {
      return invokeFeature(request, true, (provider, feature) => provider.signatureHelp?.({ ...feature, position: request.position }), validateSignatureHelp, { position: request.position });
    },
    definition(request) {
      return invokeFeature(request, true, (provider, feature) => provider.definition?.({ ...feature, position: request.position }), validateLocationList, { position: request.position });
    },
    references(request) {
      return invokeFeature(request, true, (provider, feature) => provider.references?.({
        ...feature,
        position: request.position,
        ...request.includeDeclaration === void 0 ? {} : { includeDeclaration: request.includeDeclaration }
      }), validateLocationList, {
        position: request.position,
        ...request.includeDeclaration === void 0 ? {} : { includeDeclaration: request.includeDeclaration }
      });
    },
    prepareRename(request) {
      return invokeFeature(request, true, (provider, feature) => provider.prepareRename?.({ ...feature, position: request.position }), validatePreparation, { position: request.position });
    },
    rename(request) {
      if (typeof request.newName !== "string" || request.newName.length > 256 || !/^[A-Za-z_]\w*$/u.test(request.newName)) {
        return Promise.reject(workspaceError(LANGUAGE_FEATURE_INVALID, "rename needs a valid language identifier", {
          uri: request.uri
        }));
      }
      const maxEdits = boundedInteger(request.maxEdits, LANGUAGE_DEFAULT_MAX_EDITS, LANGUAGE_MAX_EDITS, "maxEdits");
      return invokeFeature(request, true, (provider, feature) => provider.rename?.({
        ...feature,
        position: request.position,
        newName: request.newName,
        maxEdits
      }), (value, feature) => validateWorkspaceEdit(value, feature, maxEdits), { position: request.position, newName: request.newName, maxEdits });
    },
    formatting(request) {
      const formatting = request.options;
      if (typeof formatting !== "object" || formatting === null || !Number.isSafeInteger(formatting.tabSize) || formatting.tabSize < 1 || formatting.tabSize > 8 || typeof formatting.insertSpaces !== "boolean" || formatting.finalNewline !== void 0 && typeof formatting.finalNewline !== "boolean") {
        return Promise.reject(workspaceError(LANGUAGE_FEATURE_INVALID, "formatting options need tabSize 1 through 8 and boolean indentation settings", { uri: request.uri }));
      }
      const providerOptions = Object.freeze({
        tabSize: formatting.tabSize,
        insertSpaces: formatting.insertSpaces,
        ...formatting.finalNewline === void 0 ? {} : { finalNewline: formatting.finalNewline }
      });
      return invokeFeature(request, false, (provider, feature) => provider.formatting?.({ ...feature, options: providerOptions }), validateTextEditList, { options: providerOptions });
    },
    documentSymbols(request) {
      return invokeFeature(request, false, (provider, feature) => provider.documentSymbols?.(feature), validateDocumentSymbols);
    },
    workspaceSymbols(request) {
      if (typeof request.query !== "string") {
        return Promise.reject(workspaceError(LANGUAGE_FEATURE_INVALID, "workspace symbol query must be a string", {
          uri: request.uri
        }));
      }
      return invokeFeature(request, false, (provider, feature) => provider.workspaceSymbols?.({ ...feature, query: request.query }), validateWorkspaceSymbols, { query: request.query });
    },
    diagnostics(request) {
      return invokeFeature(request, false, (provider, feature) => provider.diagnostics?.(feature), validateDiagnosticList);
    },
    async close(uri) {
      requireReady();
      const entry2 = documents.get(uri);
      if (entry2 !== void 0) {
        invalidateFeatures("language document closed");
        await closeEntry(entry2);
      }
    },
    shutdown() {
      if (shutdownPromise !== void 0)
        return shutdownPromise;
      state = "shut-down";
      shutdownPromise = (async () => {
        invalidateFeatures("language workspace shut down");
        const open = [...documents.values()];
        documents.clear();
        for (const entry2 of open)
          entry2.analysisController?.abort("language workspace shut down");
        const failures = [];
        for (const entry2 of open) {
          try {
            await closeEntry(entry2);
          } catch (error3) {
            failures.push(error3);
          }
        }
        if (failures.length > 0)
          throw failures[0];
      })();
      return shutdownPromise;
    }
  });
}

// packages/host/dist/language/index.js
var STANDARD_LANGUAGE_OWNER = "modkit/language";
var OFFER_KEYS2 = /* @__PURE__ */ new Set(["languageIds", "documentKinds", "extensions"]);
var REQUEST_KEYS = /* @__PURE__ */ new Set(["languageId", "documentKind", "extension"]);
function recordOf2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function stringList(value) {
  if (!Array.isArray(value) || value.length === 0)
    return void 0;
  if (!value.every((item) => typeof item === "string" && item.trim().length > 0))
    return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer(value) {
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS2.has(key2)))
    return void 0;
  const languageIds = stringList(record["languageIds"]);
  if (languageIds === void 0)
    return void 0;
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
  if (typeof languageId !== "string" || languageId.trim().length === 0)
    return void 0;
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
        diagnostic("error", "x3.host/language-facet-invalid", `${context.contract}@${context.major}: language request and offer routes must be well formed`)
      ]
    };
  }
  if (!offer.languageIds.includes(request.languageId))
    return { state: "no-match" };
  if (request.documentKind !== void 0 && !offer.documentKinds?.includes(request.documentKind)) {
    return { state: "no-match" };
  }
  const requestExtension = request.extension;
  if (requestExtension !== void 0 && !offer.extensions?.some((value) => normalizedExtension2(value) === normalizedExtension2(requestExtension))) {
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
      $ref: "https://schemas.modkit.org/x3/language-provider-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/language-provider-request.v1.schema.json"
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
function registerStandardLanguageDefinitions(definitions) {
  const definition = LANGUAGE_DOCUMENT_CONTRACT_DEFINITION;
  return definitions.replaceOwnerInventory(STANDARD_LANGUAGE_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_LANGUAGE_OWNER,
        extensionVersion: "1.0.0",
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: "host:standard-language-definitions",
        artifactRoot: "host:",
        manifestPath: "host:standard-language-definitions"
      }
    }
  ]);
}
function isLanguageProvider(value) {
  const record = recordOf2(value);
  const workspaceLanguageIds = record?.["workspaceLanguageIds"];
  return record?.["contract"] === LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT && Array.isArray(record["languageIds"]) && record["languageIds"].every((item) => typeof item === "string") && (workspaceLanguageIds === void 0 || Array.isArray(workspaceLanguageIds) && workspaceLanguageIds.length > 0 && workspaceLanguageIds.length <= 16 && workspaceLanguageIds.every((item) => typeof item === "string" && item.trim().length > 0) && new Set(workspaceLanguageIds).size === workspaceLanguageIds.length) && typeof record["analyze"] === "function";
}
async function resolveLanguageProvider(request) {
  throwIfAborted(request.signal);
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/language-provider-unavailable", "this host registered no service-contract definitions, so language providers cannot be resolved")
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
  let released = false;
  const releaseResolver = async () => {
    if (released)
      return;
    released = true;
    await resolver.release();
  };
  const facet = {
    languageId: request.languageId,
    ...request.documentKind === void 0 ? {} : { documentKind: request.documentKind },
    ...request.extension === void 0 ? {} : { extension: request.extension }
  };
  try {
    const lease2 = await resolver.port.resolve({
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      major: 1,
      facet,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isLanguageProvider(lease2.value) || !lease2.value.languageIds.includes(request.languageId)) {
      await releaseResolver();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/language-provider-invalid", `the selected provider does not implement ${LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT}@1 for ${request.languageId}`)
        ]
      };
    }
    throwIfAborted(request.signal);
    return Object.freeze({
      state: "resolved",
      provider: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/language-provider-selected", `selected a language provider for ${request.languageId}`)
      ]),
      release: releaseResolver
    });
  } catch (error3) {
    let releaseError;
    try {
      await releaseResolver();
    } catch (failure2) {
      releaseError = failure2;
    }
    if (isCancellation(error3))
      throw error3;
    throwIfAborted(request.signal);
    if (releaseError !== void 0)
      throw releaseError;
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/language-provider-unresolved", `no language provider resolved for ${request.languageId} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}

// packages/host/dist/runtime/index.js
var STANDARD_RUNTIME_OWNER = "modkit/runtime";
var OFFER_KEYS3 = /* @__PURE__ */ new Set(["runtimeIds"]);
var REQUEST_KEYS2 = /* @__PURE__ */ new Set(["runtimeId"]);
var BUDGET_KEYS = /* @__PURE__ */ new Set(["maxWallTimeMs", "maxTicks", "maxMemoryBytes"]);
function recordOf3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function nonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function stringList2(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString))
    return void 0;
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
        diagnostic("error", "x3.host/runtime-facet-invalid", `${context.contract}@${context.major}: runtime request and offer routes must be well formed`)
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
      $ref: "https://schemas.modkit.org/x3/runtime-provider-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/runtime-provider-request.v1.schema.json"
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
function registerStandardRuntimeDefinitions(definitions) {
  return definitions.replaceOwnerInventory(STANDARD_RUNTIME_OWNER, STANDARD_RUNTIME_DEFINITIONS.map((definition) => ({
    definition,
    provenance: {
      ownerExtensionId: STANDARD_RUNTIME_OWNER,
      extensionVersion: "1.0.0",
      inventoryRecordId: `host:${definition.contract}@${definition.major}`,
      manifestDigest: `host:${definition.contract}@${definition.major}`,
      artifactDigest: "host:standard-runtime-definitions",
      artifactRoot: "host:",
      manifestPath: "host:standard-runtime-definitions"
    }
  })));
}
function isRuntimeBudget(value) {
  const record = recordOf3(value);
  return record !== void 0 && Object.keys(record).length === BUDGET_KEYS.size && Object.keys(record).every((key2) => BUDGET_KEYS.has(key2)) && nonNegativeSafeInteger(record["maxWallTimeMs"]) && nonNegativeSafeInteger(record["maxTicks"]) && nonNegativeSafeInteger(record["maxMemoryBytes"]);
}
function sameBudget(left, right) {
  return left.maxWallTimeMs === right.maxWallTimeMs && left.maxTicks === right.maxTicks && left.maxMemoryBytes === right.maxMemoryBytes;
}
function isRuntimeProvider(value) {
  const record = recordOf3(value);
  return record?.["contract"] === RUNTIME_PROVIDER_CONTRACT && nonEmptyString(record["providerId"]) && stringList2(record["runtimeIds"]) !== void 0 && typeof record["createSession"] === "function";
}
function isRuntimeSession(value) {
  const record = recordOf3(value);
  return record?.["contract"] === RUNTIME_SESSION_CONTRACT && nonEmptyString(record["sessionId"]) && nonEmptyString(record["providerId"]) && isRuntimeBudget(record["budget"]) && typeof record["execute"] === "function" && typeof record["status"] === "function";
}
function isRuntimeSessionLease(value) {
  const record = recordOf3(value);
  return isRuntimeSession(record?.["value"]) && typeof record?.["release"] === "function";
}
async function releaseUnknownLease(value) {
  const release = recordOf3(value)?.["release"];
  if (typeof release === "function")
    await release.call(value);
}
async function unresolvedAfterRelease(resolver, diagnostics) {
  await resolver.release();
  return { state: "unresolved", diagnostics };
}
async function openRuntimeSession(request) {
  if (!nonEmptyString(request.runtimeId) || !nonEmptyString(request.sessionId)) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("error", "x3.host/runtime-session-request-invalid", "runtimeId and sessionId must both be non-empty strings")
      ]
    };
  }
  if (!isRuntimeBudget(request.budget)) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("error", "x3.host/runtime-budget-invalid", "runtime budgets must be non-negative safe integers")
      ]
    };
  }
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/runtime-provider-unavailable", "this host registered no service-contract definitions, so runtimes cannot be resolved")
      ]
    };
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.activationBudget,
    ...request.signal === void 0 ? {} : { signal: request.signal }
  });
  try {
    const providerLease = await resolver.port.resolve({
      contract: RUNTIME_PROVIDER_CONTRACT,
      major: 1,
      facet: { runtimeId: request.runtimeId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    const provider = providerLease.value;
    if (!isRuntimeProvider(provider) || !provider.runtimeIds.includes(request.runtimeId)) {
      return unresolvedAfterRelease(resolver, [
        ...resolver.diagnostics,
        diagnostic("error", "x3.host/runtime-provider-invalid", `the selected provider does not implement ${RUNTIME_PROVIDER_CONTRACT}@1 for ${request.runtimeId}`)
      ]);
    }
    const providerActivation = resolver.activationFacts.findLast((fact2) => fact2.providerId === provider.providerId && fact2.contract === RUNTIME_PROVIDER_CONTRACT && fact2.major === 1);
    if (request.providerInvocation !== void 0 && providerActivation?.executionProfile !== "trusted-in-process") {
      return unresolvedAfterRelease(resolver, [
        ...resolver.diagnostics,
        diagnostic("error", "x3.host/runtime-provider-invocation-boundary", `runtime provider ${provider.providerId} runs as ${providerActivation?.executionProfile ?? "an unknown execution profile"}; non-serializable ResourceSession invocation context is restricted to gate-admitted trusted-in-process providers`, [provider.providerId], {
          executionProfile: providerActivation?.executionProfile ?? "unknown",
          runtimeVariant: providerActivation?.runtimeVariant ?? "unknown"
        })
      ]);
    }
    const createRequest = {
      sessionId: request.sessionId,
      budget: request.budget,
      ...request.providerInvocation === void 0 ? {} : { providerInvocation: request.providerInvocation },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    };
    const candidate = await provider.createSession(createRequest);
    if (!isRuntimeSessionLease(candidate) || candidate.value.sessionId !== request.sessionId || candidate.value.providerId !== provider.providerId || !sameBudget(candidate.value.budget, request.budget)) {
      await releaseUnknownLease(candidate);
      return unresolvedAfterRelease(resolver, [
        ...resolver.diagnostics,
        diagnostic("error", "x3.host/runtime-session-invalid", `runtime provider ${provider.providerId} returned an invalid session lease`)
      ]);
    }
    let released = false;
    return Object.freeze({
      state: "resolved",
      providerId: provider.providerId,
      session: candidate.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/runtime-provider-selected", `selected ${provider.providerId} for runtime ${request.runtimeId}`)
      ]),
      async release() {
        if (released)
          return;
        released = true;
        let sessionError;
        try {
          await candidate.release();
        } catch (error3) {
          sessionError = error3;
        }
        try {
          await resolver.release();
        } catch (error3) {
          sessionError ??= error3;
        }
        if (sessionError !== void 0)
          throw sessionError;
      }
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/runtime-provider-unresolved", `no runtime provider resolved for ${request.runtimeId} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}

// packages/host/dist/renderer/index.js
var STANDARD_RENDERER_OWNER = "modkit/renderer";
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
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString2))
    return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function outputKind(value) {
  return typeof value === "string" && OUTPUT_KINDS.has(value) ? value : void 0;
}
function outputKindList(value) {
  if (!Array.isArray(value) || value.length === 0)
    return void 0;
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
        diagnostic("error", "x3.host/renderer-facet-invalid", `${context.contract}@${context.major}: renderer request and offer routes must be well formed`)
      ]
    };
  }
  if (!offer.outputKinds.includes(request.outputKind))
    return { state: "no-match" };
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
      $ref: "https://schemas.modkit.org/x3/scene-renderer-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/scene-renderer-request.v1.schema.json"
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
function registerStandardRendererDefinitions(definitions) {
  const definition = SCENE_RENDERER_CONTRACT_DEFINITION;
  return definitions.replaceOwnerInventory(STANDARD_RENDERER_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_RENDERER_OWNER,
        extensionVersion: "1.0.0",
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: "host:standard-renderer-definitions",
        artifactRoot: "host:",
        manifestPath: "host:standard-renderer-definitions"
      }
    }
  ]);
}
function isSceneRenderer(value) {
  const record = recordOf4(value);
  return record?.["contract"] === SCENE_RENDERER_CONTRACT && nonEmptyString2(record["rendererId"]) && outputKindList(record["outputKinds"]) !== void 0 && typeof record["render"] === "function";
}
async function resolveSceneRenderer(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/renderer-unavailable", "this host registered no service-contract definitions, so renderers cannot be resolved")
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
  const facet = {
    outputKind: request.outputKind,
    ...request.rendererId === void 0 ? {} : { rendererId: request.rendererId }
  };
  try {
    const lease2 = await resolver.port.resolve({
      contract: SCENE_RENDERER_CONTRACT,
      major: 1,
      facet,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isSceneRenderer(lease2.value) || !lease2.value.outputKinds.includes(request.outputKind) || request.rendererId !== void 0 && lease2.value.rendererId !== request.rendererId) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/renderer-invalid", `the selected provider does not implement ${SCENE_RENDERER_CONTRACT}@1 for ${request.outputKind}`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      renderer: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/renderer-selected", `selected ${lease2.value.rendererId} for ${request.outputKind}`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/renderer-unresolved", `no scene renderer resolved for ${request.outputKind} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}

// packages/host/dist/games/index.js
var STANDARD_GAMES_OWNER = "modkit/games";
var OFFER_KEYS5 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS4 = /* @__PURE__ */ new Set(["gameId"]);
var ORIGINS = /* @__PURE__ */ new Set([
  "configured-path",
  "default-directory",
  "registry",
  "steam",
  "epic"
]);
function recordOf5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString3(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList4(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString3))
    return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function originList(value) {
  if (!Array.isArray(value) || value.length === 0)
    return void 0;
  const origins = value.flatMap((item) => typeof item === "string" && ORIGINS.has(item) ? [item] : []);
  return origins.length === value.length && new Set(origins).size === origins.length ? origins : void 0;
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
        diagnostic("error", "x3.host/game-installation-facet-invalid", `${context.contract}@${context.major}: game installation routes must be well formed`)
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
      $ref: "https://schemas.modkit.org/x3/game-installation-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/game-installation-request.v1.schema.json"
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
      $ref: "https://schemas.modkit.org/x3/game-launch-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/game-launch-request.v1.schema.json"
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
function registerStandardGameDefinitions(definitions) {
  return definitions.replaceOwnerInventory(STANDARD_GAMES_OWNER, [GAME_INSTALLATION_CONTRACT_DEFINITION, GAME_LAUNCH_PLAN_CONTRACT_DEFINITION].map((definition) => ({
    definition,
    provenance: {
      ownerExtensionId: STANDARD_GAMES_OWNER,
      extensionVersion: "1.0.0",
      inventoryRecordId: `host:${definition.contract}@${definition.major}`,
      manifestDigest: `host:${definition.contract}@${definition.major}`,
      artifactDigest: "host:standard-game-definitions",
      artifactRoot: "host:",
      manifestPath: "host:standard-game-definitions"
    }
  })));
}
function isGameInstallationDiscovery(value) {
  const record = recordOf5(value);
  return record?.["contract"] === GAME_INSTALLATION_DISCOVERY_CONTRACT && nonEmptyString3(record["discoveryId"]) && stringList4(record["gameIds"]) !== void 0 && originList(record["origins"]) !== void 0 && typeof record["discover"] === "function";
}
function validEvidence(value) {
  const record = recordOf5(value);
  return record !== void 0 && nonEmptyString3(record["kind"]) && nonEmptyString3(record["path"]) && typeof record["found"] === "boolean" && (record["detail"] === void 0 || typeof record["detail"] === "string");
}
function validProbe(value) {
  const record = recordOf5(value);
  const candidate = recordOf5(record?.["candidate"]);
  return record !== void 0 && candidate !== void 0 && typeof candidate["origin"] === "string" && ORIGINS.has(candidate["origin"]) && nonEmptyString3(candidate["displayName"]) && nonEmptyString3(candidate["path"]) && typeof record["confirmed"] === "boolean" && nonEmptyString3(record["normalizedPath"]) && Array.isArray(record["evidence"]) && record["evidence"].every(validEvidence);
}
function validInstallation(value, gameId) {
  const record = recordOf5(value);
  return record !== void 0 && record["gameId"] === gameId && nonEmptyString3(record["displayName"]) && nonEmptyString3(record["installPath"]) && nonEmptyString3(record["normalizedPath"]) && originList(record["origins"]) !== void 0 && Array.isArray(record["evidence"]) && record["evidence"].every(validEvidence);
}
function validDiscoveryDiagnostic(value) {
  const record = recordOf5(value);
  return record !== void 0 && ["error", "warning", "information"].includes(String(record["severity"])) && nonEmptyString3(record["code"]) && nonEmptyString3(record["message"]);
}
function isGameInstallationDiscoveryResult(value, gameId) {
  const record = recordOf5(value);
  const probes = record?.["probes"];
  const installations = record?.["installations"];
  return record !== void 0 && record["gameId"] === gameId && typeof record["complete"] === "boolean" && Array.isArray(probes) && probes.every(validProbe) && Array.isArray(installations) && installations.every((item) => validInstallation(item, gameId)) && new Set(installations.map((item) => String(recordOf5(item)?.["normalizedPath"] ?? ""))).size === installations.length && installations.every((item) => {
    const installation = recordOf5(item);
    return probes.some((probe) => {
      const candidate = recordOf5(recordOf5(probe)?.["candidate"]);
      return recordOf5(probe)?.["confirmed"] === true && recordOf5(probe)?.["normalizedPath"] === installation?.["normalizedPath"] && candidate?.["path"] === installation?.["installPath"];
    });
  }) && Array.isArray(record["diagnostics"]) && record["diagnostics"].every(validDiscoveryDiagnostic);
}
async function resolveGameInstallationDiscovery(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/game-installation-unavailable", "this host registered no service-contract definitions, so installations cannot be discovered")
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
    const lease2 = await resolver.port.resolve({
      contract: GAME_INSTALLATION_DISCOVERY_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isGameInstallationDiscovery(lease2.value) || !lease2.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/game-installation-invalid", `the selected provider does not implement ${GAME_INSTALLATION_DISCOVERY_CONTRACT}@1 for ${request.gameId}`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      discovery: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/game-installation-selected", `selected ${lease2.value.discoveryId} for ${request.gameId}`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/game-installation-unresolved", `no installation discovery provider resolved for ${request.gameId} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}
async function discoverGameInstallations(request) {
  const resolution = await resolveGameInstallationDiscovery(request);
  if (resolution.state === "unresolved")
    return resolution;
  try {
    const result = await resolution.discovery.discover({
      gameId: request.gameId,
      ...request.configuredPaths === void 0 ? {} : { configuredPaths: request.configuredPaths },
      maxCandidates: request.maxCandidates,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isGameInstallationDiscoveryResult(result, request.gameId)) {
      return Object.freeze({
        state: "unresolved",
        diagnostics: Object.freeze([
          ...resolution.diagnostics,
          diagnostic("error", "x3.host/game-installation-result-invalid", `installation discovery returned an invalid or unversioned completeness result for ${request.gameId}`)
        ])
      });
    }
    return Object.freeze({
      state: "discovered",
      result,
      diagnostics: resolution.diagnostics
    });
  } finally {
    await resolution.release();
  }
}
function isGameLaunchPlanner(value) {
  const record = recordOf5(value);
  return record?.["contract"] === GAME_LAUNCH_PLAN_CONTRACT && nonEmptyString3(record["plannerId"]) && stringList4(record["gameIds"]) !== void 0 && typeof record["plan"] === "function";
}
function validRelativeProcessPath(value, allowDot) {
  if (!nonEmptyString3(value) || value.includes("\0"))
    return false;
  const normalized = value.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[a-z]:/iu.test(normalized))
    return false;
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment.length === 0))
    return false;
  return allowDot || segments.some((segment) => segment !== ".");
}
function validConfirmedInstallation(value, gameId) {
  const installPath = value.installPath.trim().replace(/\\/gu, "/").replace(/\/+$/gu, "");
  const normalizedPath2 = value.normalizedPath.trim().replace(/\\/gu, "/").replace(/\/+$/gu, "");
  return validInstallation(value, gameId) && installPath === normalizedPath2 && value.evidence.length > 0 && value.evidence.every((item) => item.found);
}
function validGameLaunchPlan(value, request) {
  const record = recordOf5(value);
  const resource = recordOf5(record?.["resource"]);
  const argumentsValue = record?.["arguments"];
  const argumentIndex = record?.["resourceArgumentIndex"];
  return record !== void 0 && record["schemaVersion"] === 1 && nonEmptyString3(record["planId"]) && record["gameId"] === request.gameId && record["installationRoot"] === request.installation.normalizedPath && resource?.["kind"] === request.resource.kind && resource["path"] === request.resource.path.trim() && validRelativeProcessPath(record["executableRelativePath"], false) && validRelativeProcessPath(record["workingDirectoryRelativePath"], true) && Array.isArray(argumentsValue) && argumentsValue.length > 0 && argumentsValue.length <= 64 && argumentsValue.every((argument) => typeof argument === "string" && argument.length <= 32767 && !argument.includes("\0")) && Number.isSafeInteger(argumentIndex) && argumentIndex >= 0 && argumentIndex < argumentsValue.length && argumentsValue[argumentIndex] === resource["path"] && record["mode"] === "detached" && record["stdio"] === "ignore";
}
async function resolveGameLaunchPlanner(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/game-launch-unavailable", "this host registered no service-contract definitions, so game launch cannot be planned")
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
    const lease2 = await resolver.port.resolve({
      contract: GAME_LAUNCH_PLAN_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isGameLaunchPlanner(lease2.value) || !lease2.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/game-launch-planner-invalid", `the selected provider does not implement ${GAME_LAUNCH_PLAN_CONTRACT}@1 for ${request.gameId}`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      planner: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/game-launch-planner-selected", `selected ${lease2.value.plannerId} for ${request.gameId}`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    if (request.signal?.aborted === true)
      throw error3;
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/game-launch-planner-unresolved", `no launch planner resolved for ${request.gameId} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}
async function planGameLaunch(request) {
  if (!validConfirmedInstallation(request.installation, request.gameId) || request.resource.kind !== "map" || !nonEmptyString3(request.resource.path) || request.resource.path.includes("\0")) {
    return Object.freeze({
      state: "unresolved",
      diagnostics: Object.freeze([
        diagnostic("error", "x3.host/game-launch-request-invalid", "game launch requires one confirmed installation and one non-empty map path")
      ])
    });
  }
  const resource = Object.freeze({ ...request.resource, path: request.resource.path.trim() });
  const resolution = await resolveGameLaunchPlanner(request);
  if (resolution.state === "unresolved")
    return resolution;
  try {
    const plan = await resolution.planner.plan({
      gameId: request.gameId,
      installation: request.installation,
      resource,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!validGameLaunchPlan(plan, { ...request, resource })) {
      return Object.freeze({
        state: "unresolved",
        diagnostics: Object.freeze([
          ...resolution.diagnostics,
          diagnostic("error", "x3.host/game-launch-plan-invalid", `the selected provider returned an unsafe or malformed ${GAME_LAUNCH_PLAN_CONTRACT}@1 plan`)
        ])
      });
    }
    return Object.freeze({
      state: "planned",
      plan,
      diagnostics: resolution.diagnostics
    });
  } finally {
    await resolution.release();
  }
}

// packages/host/dist/mods/index.js
var STANDARD_MODS_OWNER = "modkit/mods";
var OFFER_KEYS6 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS5 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString4(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList5(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString4))
    return void 0;
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
        diagnostic("error", "x3.host/mod-workspace-facet-invalid", `${context.contract}@${context.major}: mod workspace routes must be well formed`)
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
var MOD_WORKSPACE_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: MOD_WORKSPACE_COMPOSITION_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/mod-workspace-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/mod-workspace-request.v1.schema.json"
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
});
function registerStandardModDefinitions(definitions) {
  const definition = MOD_WORKSPACE_CONTRACT_DEFINITION;
  return definitions.replaceOwnerInventory(STANDARD_MODS_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_MODS_OWNER,
        extensionVersion: "1.0.0",
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: "host:standard-mod-definitions",
        artifactRoot: "host:",
        manifestPath: "host:standard-mod-definitions"
      }
    }
  ]);
}
function isModWorkspaceComposition(value) {
  const record = recordOf6(value);
  return record?.["contract"] === MOD_WORKSPACE_COMPOSITION_CONTRACT && nonEmptyString4(record["compositionId"]) && stringList5(record["gameIds"]) !== void 0 && typeof record["compose"] === "function";
}
async function resolveModWorkspaceComposition(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/mod-workspace-unavailable", "this host registered no service-contract definitions, so workspaces cannot be composed")
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
    const lease2 = await resolver.port.resolve({
      contract: MOD_WORKSPACE_COMPOSITION_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isModWorkspaceComposition(lease2.value) || !lease2.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/mod-workspace-invalid", `the selected provider does not implement ${MOD_WORKSPACE_COMPOSITION_CONTRACT}@1 for ${request.gameId}`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      composition: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/mod-workspace-selected", `selected ${lease2.value.compositionId} for ${request.gameId}`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/mod-workspace-unresolved", `no mod workspace provider resolved for ${request.gameId} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}

// packages/host/dist/data/index.js
var STANDARD_DATA_OWNER = "modkit/data";
var OFFER_KEYS7 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS6 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString5(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList6(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString5))
    return void 0;
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
        diagnostic("error", "x3.host/data-catalog-facet-invalid", `${context.contract}@${context.major}: data catalog routes must be well formed`)
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
      $ref: "https://schemas.modkit.org/x3/data-catalog-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/data-catalog-request.v1.schema.json"
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
      $ref: "https://schemas.modkit.org/x3/data-catalog-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/data-catalog-request.v1.schema.json"
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
function registerStandardDataDefinitions(definitions) {
  const registered = [DATA_CATALOG_CONTRACT_DEFINITION, RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION];
  return definitions.replaceOwnerInventory(STANDARD_DATA_OWNER, registered.map((definition) => ({
    definition,
    provenance: {
      ownerExtensionId: STANDARD_DATA_OWNER,
      extensionVersion: "1.0.0",
      inventoryRecordId: `host:${definition.contract}@${definition.major}`,
      manifestDigest: `host:${definition.contract}@${definition.major}`,
      artifactDigest: "host:standard-data-definitions",
      artifactRoot: "host:",
      manifestPath: "host:standard-data-definitions"
    }
  })));
}
function isDataCatalogAnalysis(value) {
  const record = recordOf7(value);
  return record?.["contract"] === DATA_CATALOG_ANALYSIS_CONTRACT && nonEmptyString5(record["analyzerId"]) && stringList6(record["gameIds"]) !== void 0 && typeof record["analyze"] === "function";
}
async function resolveDataCatalogAnalysis(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/data-catalog-unavailable", "this host registered no service-contract definitions, so catalogs cannot be analyzed")
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
    const lease2 = await resolver.port.resolve({
      contract: DATA_CATALOG_ANALYSIS_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isDataCatalogAnalysis(lease2.value) || !lease2.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/data-catalog-invalid", `the selected provider does not implement ${DATA_CATALOG_ANALYSIS_CONTRACT}@1 for ${request.gameId}`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      analysis: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/data-catalog-selected", `selected ${lease2.value.analyzerId} for ${request.gameId}`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/data-catalog-unresolved", `no data catalog provider resolved for ${request.gameId} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}
function isResolvedDataWorkspace(value) {
  const record = recordOf7(value);
  return record?.["contract"] === RESOLVED_DATA_WORKSPACE_CONTRACT && nonEmptyString5(record["providerId"]) && stringList6(record["gameIds"]) !== void 0 && typeof record["plan"] === "function" && typeof record["analyze"] === "function" && typeof record["openSchemaTree"] === "function" && typeof record["openDefinitionTable"] === "function" && typeof record["openLocalizationTable"] === "function" && typeof record["openRelations"] === "function";
}
async function resolveResolvedDataWorkspace(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/resolved-data-workspace-unavailable", "this host registered no service-contract definitions, so workspace data cannot resolve")
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
    const lease2 = await resolver.port.resolve({
      contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isResolvedDataWorkspace(lease2.value) || !lease2.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/resolved-data-workspace-invalid", `the selected provider does not implement ${RESOLVED_DATA_WORKSPACE_CONTRACT}@1 for ${request.gameId}`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      workspace: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/resolved-data-workspace-selected", `selected ${lease2.value.providerId} for ${request.gameId}`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/resolved-data-workspace-unresolved", `no resolved data workspace provider resolved for ${request.gameId} (${error3 instanceof Error ? error3.message : String(error3)})`)
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
  const snapshot2 = analyzed.snapshot;
  const localized = new Map(snapshot2.localizedStrings.map((item) => [item.key, item.value]));
  const subjects = Object.freeze(snapshot2.definitions.map((entity) => {
    const authoredName = entity.fields["Name"];
    const label = typeof authoredName === "string" ? localized.get(authoredName) ?? entity.entityId : entity.entityId;
    return Object.freeze({
      subjectId: `${entity.namespace}/${entity.entityId}`,
      label,
      kind: entity.namespace,
      type: entity.typeId
    });
  }).sort((left, right) => left.subjectId.localeCompare(right.subjectId)));
  const byId = new Map(subjects.map((item) => [item.subjectId, item]));
  let live = true;
  const assertLive = (signal) => {
    signal?.throwIfAborted();
    if (!live)
      throw new Error("resolved data subject selector lease has been released");
  };
  const page = (request, signal) => {
    assertLive(signal);
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > limits.maxPageSize) {
      throw new RangeError(`subject selector limit must be between 1 and ${limits.maxPageSize}`);
    }
    const text = request.text?.trim().toLocaleLowerCase("en-US");
    const filtered = subjects.filter((subject) => (request.kind === void 0 || subject.kind === request.kind) && (request.type === void 0 || subject.type === request.type) && (text === void 0 || text.length === 0 || subject.subjectId.toLocaleLowerCase("en-US").includes(text) || subject.label.toLocaleLowerCase("en-US").includes(text)));
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
    if (subject === void 0)
      throw new RangeError(`resolved data subject not found: ${subjectId}`);
    return subject;
  };
  const source = Object.freeze({
    async summary(signal) {
      assertLive(signal);
      return Object.freeze({
        snapshotId: snapshot2.snapshotId,
        totalSubjects: subjects.length,
        completeness: snapshot2.complete ? "complete" : "partial",
        ...snapshot2.complete ? {} : { reason: "the resolved data workspace is incomplete" }
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
    if (part === "" || part === ".")
      continue;
    if (part === "..")
      throw new TypeError(`${label} must not escape its workspace root`);
    parts.push(part);
  }
  if (parts.length === 0)
    throw new TypeError(`${label} must name a logical path`);
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
  const logical = new Map((workspace.logicalRoots ?? [...workspace.loadOrder].reverse()).map((root, index) => [
    root.rootId,
    index
  ]));
  const localeRanks = new Map(locales.map((locale, index) => [comparableLocale(locale), index]));
  const requirementIds = /* @__PURE__ */ new Set();
  let catalogRank = -1;
  let localizationRank = -1;
  let localizationStarted = false;
  for (const requirement of plan.requirements) {
    if (requirement.required !== void 0 && typeof requirement.required !== "boolean") {
      throw new TypeError(`workspace data requirement ${requirement.requirementId} has invalid required flag`);
    }
    if (requirementIds.has(requirement.requirementId)) {
      throw new TypeError(`workspace data requirement ${requirement.requirementId} is duplicated`);
    }
    requirementIds.add(requirement.requirementId);
    const root = roots.get(requirement.rootId);
    if (root === void 0) {
      throw new TypeError(`workspace data requirement ${requirement.requirementId} names unknown root`);
    }
    const rootPath = confinedPath(root.root.sourcePath, `${requirement.requirementId}.root`);
    const path = confinedPath(requirement.path, `${requirement.requirementId}.path`);
    const foldedRoot = rootPath.toLocaleLowerCase();
    const foldedPath = path.toLocaleLowerCase();
    if (foldedPath !== foldedRoot && !foldedPath.startsWith(`${foldedRoot}/`)) {
      throw new TypeError(`workspace data requirement ${requirement.requirementId} escapes its root`);
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
      throw new TypeError(`workspace data requirement ${requirement.requirementId} has invalid kind`);
    }
    localizationStarted = true;
    const localeRank = localeRanks.get(comparableLocale(requirement.locale));
    const rootRank = logical.get(requirement.rootId);
    if (localeRank === void 0 || rootRank === void 0) {
      throw new TypeError(`workspace localization requirement ${requirement.requirementId} is invalid`);
    }
    const rank = localeRank * workspace.loadOrder.length + rootRank;
    if (rank < localizationRank) {
      throw new TypeError("localization requirements are not locale-first and winner-first");
    }
    localizationRank = rank;
  }
}
async function readResourceText(resources, requirement, maxDocumentBytes, signal) {
  const resolved = await resources.resolve({
    id: requirement.requirementId,
    logicalId: requirement.path,
    role: "buffer",
    scopes: ["current-mount", "enclosing-container", "workspace-dependency-layer"]
  }, signal);
  if (resolved.state === "unresolved") {
    return { state: "unresolved", diagnostic: resolved.diagnostic };
  }
  try {
    const source = resolved.lease.value;
    if (source.kind !== "bytes") {
      return {
        state: "unresolved",
        diagnostic: diagnostic("warning", "x3.host/resolved-data-resource-not-bytes", `${requirement.path} resolved to a namespace instead of bytes`)
      };
    }
    if (source.size !== void 0 && source.size > BigInt(maxDocumentBytes)) {
      return {
        state: "unresolved",
        diagnostic: diagnostic("warning", "x3.host/resolved-data-document-budget-exceeded", `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`)
      };
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of source.stream(void 0, signal)) {
      bytes += chunk.byteLength;
      if (bytes > maxDocumentBytes) {
        return {
          state: "unresolved",
          diagnostic: diagnostic("warning", "x3.host/resolved-data-document-budget-exceeded", `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`)
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
        diagnostic("warning", "x3.host/resolved-data-resource-session-disposed", "workspace data requires a live revision-pinned ResourceSessionPort")
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
  if (resolution.state === "unresolved")
    return resolution;
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
    diagnostics.push(...plan.diagnostics.map((item) => diagnostic(item.severity, item.code, item.message, void 0, {
      analyzerId: plan.analyzerId
    })));
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
      const loaded = await readResourceText(request.resources, requirement, limits.maxDocumentBytes, request.signal);
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
      const document = {
        rootId: requirement.rootId,
        path: requirement.path,
        text: loaded.text,
        revision: loaded.revision
      };
      if (requirement.kind === "catalog")
        documents.push(document);
      else
        localizationDocuments.push({ ...document, locale: requirement.locale });
    }
    if (documents.length === 0) {
      await resolution.release();
      return {
        state: "unresolved",
        diagnostics: Object.freeze([
          ...diagnostics,
          diagnostic("warning", "x3.host/resolved-data-catalog-unavailable", "no planned catalog document resolved through the resource session")
        ])
      };
    }
    if (request.resources.state() !== "live") {
      throw new Error("resource session was disposed while workspace data was loading");
    }
    const snapshot2 = await resolution.workspace.analyze({
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
      snapshotId: snapshot2.snapshotId,
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
      snapshot: snapshot2,
      plan,
      facets: Object.freeze({ schemaTree, definitions, localization, relations }),
      ...openSubjectFacts === void 0 ? {} : {
        async openSubjectFacts(request2) {
          if (released)
            throw new Error("resolved data workspace analysis is released");
          const lease2 = await openSubjectFacts.call(resolution.workspace, {
            ...request2,
            snapshotId: snapshot2.snapshotId
          });
          if (released) {
            await lease2.release();
            throw new Error("resolved data workspace analysis was released while opening facts");
          }
          opened.push(lease2);
          return lease2;
        }
      },
      ...openSubjectCalculations === void 0 ? {} : {
        async openSubjectCalculations(request2) {
          if (released)
            throw new Error("resolved data workspace analysis is released");
          const lease2 = await openSubjectCalculations.call(resolution.workspace, {
            ...request2,
            snapshotId: snapshot2.snapshotId
          });
          if (released) {
            await lease2.release();
            throw new Error("resolved data workspace analysis was released while opening calculations");
          }
          opened.push(lease2);
          return lease2;
        }
      },
      diagnostics: Object.freeze(diagnostics),
      async release() {
        if (released)
          return;
        released = true;
        const results = await Promise.allSettled([
          ...[...opened].reverse().map((lease2) => lease2.release()),
          resolution.release()
        ]);
        const failure2 = results.find((result) => result.status === "rejected");
        if (failure2?.status === "rejected")
          throw failure2.reason;
      }
    });
  } catch (error3) {
    await Promise.allSettled([...opened].reverse().map((lease2) => lease2.release()));
    await resolution.release();
    if (request.signal?.aborted)
      throw error3;
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...diagnostics,
        diagnostic("warning", "x3.host/resolved-data-workspace-failed", error3 instanceof Error ? error3.message : String(error3))
      ])
    };
  }
}

// packages/host/dist/resource-session.js
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
  if (allowlist === void 0)
    return true;
  return allowlist.some((entry2) => {
    if (entry2 === "")
      return true;
    const normalized = entry2.endsWith("/") ? entry2 : `${entry2}/`;
    return logicalId === entry2 || logicalId.startsWith(normalized);
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
  const record = (requirement, entry2) => {
    const value = Object.freeze({
      requirementId: requirement.id,
      logicalId: requirement.logicalId,
      role: requirement.role,
      scopes: Object.freeze([...requirement.scopes]),
      ...entry2
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
    let cursor3 = requirement.parentResourceId;
    while (cursor3 !== void 0) {
      if (chain.length >= limits.maxDepth)
        return void 0;
      if (seen.has(cursor3))
        break;
      seen.add(cursor3);
      const parent = byRequirementId.get(cursor3);
      if (parent === void 0)
        break;
      chain.push(parent.logicalId);
      cursor3 = parents.get(cursor3);
    }
    return chain;
  };
  const locate = async (normalized, scopes, signal) => {
    const wanted = fold(normalized, origin.caseSensitivity);
    const byName = !normalized.includes("/");
    let entries = 0;
    for (const scope of scopes) {
      throwIfAborted(signal);
      for await (const entry2 of origin.enumerate(scope, { prefix: prefixOf(normalized) }, signal)) {
        entries += 1;
        if (entries > limits.maxEntries)
          return { found: void 0, overBudget: true };
        const candidate = byName ? entry2.logicalId.split("/").at(-1) ?? entry2.logicalId : entry2.logicalId;
        if (fold(candidate, origin.caseSensitivity) === wanted) {
          return { found: entry2.logicalId, overBudget: false };
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
        return unresolved(requirement, "session-disposed", `resource session ${sessionId} is disposed and resolves nothing further`);
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
      } catch (error3) {
        if (isModkitError(error3) && error3.code === COMPANION_PATH_REFUSED) {
          return unresolved(requirement, "path-refused", error3.message);
        }
        throw error3;
      }
      const chain = chainOf(requirement);
      if (chain === void 0) {
        return unresolved(requirement, "budget-exceeded", `resource chain for \xAB${requirement.logicalId}\xBB is deeper than the session depth budget of ${limits.maxDepth}`);
      }
      if (chain.some((item) => fold(item, origin.caseSensitivity) === fold(normalized, origin.caseSensitivity))) {
        return unresolved(requirement, "cycle-detected", `resource \xAB${requirement.logicalId}\xBB is already in its own reference chain: ${[...chain, requirement.logicalId].join(" -> ")}`);
      }
      if (!allowed(normalized, options.allowlist)) {
        return unresolved(requirement, "not-allowlisted", `resource \xAB${requirement.logicalId}\xBB is outside every allowlisted prefix of this session`);
      }
      const servedScopes = requirement.scopes.filter((scope) => origin.scopes.includes(scope));
      if (servedScopes.length === 0) {
        return unresolved(requirement, "scope-unsupported", `this origin serves ${origin.scopes.join(", ")}; the requirement asked only for ${requirement.scopes.join(", ")}`);
      }
      const key2 = fold(normalized, origin.caseSensitivity);
      const cached = index.get(key2);
      let found;
      if (cached !== void 0) {
        found = cached.found;
        if (found === void 0) {
          return unresolved(requirement, "not-found", `resource \xAB${requirement.logicalId}\xBB is not in any scope this session serves`, true);
        }
      } else {
        const located = await locate(normalized, servedScopes, signal);
        if (located.overBudget) {
          return unresolved(requirement, "budget-exceeded", `locating \xAB${requirement.logicalId}\xBB exceeded the session entry budget of ${limits.maxEntries}`);
        }
        index.set(key2, { found: located.found });
        found = located.found;
        if (found === void 0) {
          return unresolved(requirement, "not-found", `resource \xAB${requirement.logicalId}\xBB is not in any scope this session serves`);
        }
      }
      if (resources >= limits.maxResources) {
        return unresolved(requirement, "budget-exceeded", `this session already holds ${resources} resources, its limit`);
      }
      throwIfAborted(signal);
      const originLease = await origin.open(found, signal);
      if (disposed()) {
        await originLease.release();
        return unresolved(requirement, "session-disposed", `resource session ${sessionId} was disposed while \xAB${requirement.logicalId}\xBB was being opened`);
      }
      const size = originLease.value.kind === "bytes" ? originLease.value.size ?? 0n : 0n;
      if (bytes + size > limits.maxBytes) {
        await originLease.release();
        return unresolved(requirement, "budget-exceeded", `resolving \xAB${requirement.logicalId}\xBB would exceed the session byte budget of ${limits.maxBytes}`);
      }
      let released = false;
      const lease2 = {
        value: originLease.value,
        async release() {
          if (released)
            return;
          released = true;
          held.delete(lease2);
          resources -= 1;
          bytes -= size;
          await originLease.release();
        }
      };
      held.add(lease2);
      resources += 1;
      bytes += size;
      return {
        state: "resolved",
        lease: lease2,
        revision: lease2.value.revision,
        provenance: record(requirement, {
          state: "resolved",
          revision: lease2.value.revision,
          bytes: size,
          cached: cached !== void 0
        })
      };
    },
    provenance: () => Object.freeze([...provenance]),
    async dispose() {
      if (state === "disposed")
        return;
      state = "disposed";
      const outstanding = [...held];
      held.clear();
      const results = await Promise.allSettled(outstanding.map((lease2) => lease2.release()));
      const failure2 = results.find((result) => result.status === "rejected");
      if (failure2 !== void 0 && failure2.status === "rejected")
        throw failure2.reason;
    }
  };
}

// packages/host/dist/maps/world-source.js
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
  if (value === void 0)
    return 0;
  const parts = value.split("|");
  if (parts.length !== 3)
    throw new TypeError("world cursor is malformed");
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
  if (value === void 0)
    return void 0;
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
  if (offset > items.length)
    throw new TypeError("world cursor offset is outside this facet");
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
  if (terrain === void 0 || terrain.samples.length !== terrain.cellCount)
    return false;
  const expectedCellCount = terrain.width * terrain.height;
  if (!Number.isSafeInteger(expectedCellCount) || expectedCellCount <= 0 || expectedCellCount !== terrain.cellCount) {
    return false;
  }
  return terrain.samples.every((sample, index) => sample.x === index % terrain.width && sample.y === Math.floor(index / terrain.width));
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
function admittedTerrainTransform(snapshot2, terrain, exact) {
  const transform = snapshot2.terrainTransform;
  if (transform === void 0 || terrain === void 0 || !exact)
    return void 0;
  const finite = (value) => Number.isFinite(value);
  const positive = (value) => finite(value) && value > 0;
  const verticalMappingValid = (value) => {
    if ("vertData" in value) {
      return finite(value.vertData.quantizeBias) && positive(value.vertData.quantizeScale) && finite(value.vertData.standardHeight) && value.mapping.vertical === "dequantized-base-times-scale-plus-offset-plus-dequantized-adjustment";
    }
    return value.mapping.vertical === "direct-base-times-scale-plus-offset" && value.source.format.length > 0 && value.source.heightEncoding.length > 0 && terrain.samples.every((sample) => sample.heightAdjustment === 0);
  };
  if (transform.schemaVersion !== 1 || !Number.isSafeInteger(transform.descriptorVersion) || transform.descriptorVersion <= 0 || transform.snapshotId !== snapshot2.snapshotId || transform.heightMap.dim.length !== 2 || transform.heightMap.dim[0] !== terrain.width || transform.heightMap.dim[1] !== terrain.height || !Object.values(transform.heightMap.offset).every(finite) || !Object.values(transform.heightMap.scale).every(positive) || transform.mapping.horizontal !== "offset-plus-grid-index-times-scale" || !verticalMappingValid(transform) || transform.bounds.coordinateSpaceId !== "map-native") {
    return void 0;
  }
  let minimum = { x: Infinity, y: Infinity, z: Infinity };
  let maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const sample of terrain.samples) {
    const position = terrainMapNativePosition(sample, transform);
    if (!Object.values(position).every(finite))
      return void 0;
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
  return ["x", "y", "z"].every((axis) => transform.bounds.minimum[axis] === minimum[axis] && transform.bounds.maximum[axis] === maximum[axis]) ? transform : void 0;
}
function admittedWorldCanonicalTransform(snapshot2, terrainTransform) {
  const transform = snapshot2.uvwTransform;
  if (transform === void 0 || terrainTransform === void 0)
    return void 0;
  const finite = (value) => Number.isFinite(value);
  const positive = (value) => finite(value) && value > 0;
  const basis = transform.basis;
  const axes = Object.values(transform.axes);
  const sourceAxes = axes.map((item) => item.sourceAxis);
  if (transform.schemaVersion !== 1 || transform.snapshotId !== snapshot2.snapshotId || transform.sourceCoordinateSpaceId !== "map-native" || transform.targetCoordinateSpaceId !== "uvw-canonical" || basis.handedness !== "right" || basis.upAxis !== "y" || basis.forwardAxis !== "+z" || basis.unit !== "meter" && basis.unit !== "source-unit" || basis.unit === "source-unit" && (basis.sourceUnit === void 0 || basis.sourceUnit.length === 0 || basis.metersPerUnit !== void 0) || basis.unitsPerCell !== void 0 && !positive(basis.unitsPerCell) || axes.some((item) => !finite(item.scale) || item.scale === 0 || !finite(item.offset)) || new Set(sourceAxes).size !== 3 || !Number.isSafeInteger(transform.heightfield.columns) || !Number.isSafeInteger(transform.heightfield.rows) || transform.heightfield.columns !== terrainTransform.heightMap.dim[0] || transform.heightfield.rows !== terrainTransform.heightMap.dim[1] || !positive(transform.heightfield.cellSize) || basis.unitsPerCell !== void 0 && basis.unitsPerCell !== transform.heightfield.cellSize || transform.heightfield.origin.length !== 3 || !transform.heightfield.origin.every(finite) || transform.heightfield.sourceRowOrder !== "reverse" || transform.bounds.coordinateSpaceId !== "uvw-canonical" || !Object.values(transform.bounds.minimum).every(finite) || !Object.values(transform.bounds.maximum).every(finite) || !["x", "y", "z"].every((axis) => transform.bounds.minimum[axis] <= transform.bounds.maximum[axis]) || !Number.isSafeInteger(transform.proof.tupleCount) || transform.proof.tupleCount <= 0 || transform.proof.kind !== "adapter-qualification" || transform.proof.oracle.length === 0 || transform.proof.corpus.length === 0 || Object.keys(transform.proof.sourceDigests).length === 0 || !Object.values(transform.proof.sourceDigests).every((value) => /^sha256:[0-9a-f]{64}$/u.test(value)) || !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.nativeTupleDigest) || transform.proof.presentationTupleDigest !== void 0 && !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.presentationTupleDigest) || !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.canonicalTupleDigest) || transform.proof.comparison !== "ieee-754-binary64-exact") {
    return void 0;
  }
  const nativeBounds = terrainTransform.bounds;
  const corners = [nativeBounds.minimum.x, nativeBounds.maximum.x].flatMap((x) => [nativeBounds.minimum.y, nativeBounds.maximum.y].flatMap((y) => [nativeBounds.minimum.z, nativeBounds.maximum.z].map((z) => ({ x, y, z }))));
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
  return ["x", "y", "z"].every((axis) => transform.bounds.minimum[axis] === minimum[axis] && transform.bounds.maximum[axis] === maximum[axis]) ? transform : void 0;
}
function createCandidateWorldSceneLease(snapshot2, provenance, maxPageSize) {
  positiveLimit(maxPageSize, Number.MAX_SAFE_INTEGER);
  const semantic = snapshot2.semantic;
  const terrainLayerId = layerId(snapshot2.snapshotId, "terrain");
  const objectLayerId = layerId(snapshot2.snapshotId, "objects");
  const regionLayerId = layerId(snapshot2.snapshotId, "regions");
  const resourceLayerId = layerId(snapshot2.snapshotId, "resources");
  const navigationLayerId = layerId(snapshot2.snapshotId, "navigation");
  const terrainSummary = semantic.terrain;
  const terrainExact = hasExactTerrainGrid(terrainSummary);
  const terrainTransform = admittedTerrainTransform(snapshot2, terrainSummary, terrainExact);
  const uvwTransform = admittedWorldCanonicalTransform(snapshot2, terrainTransform);
  const terrainLod = terrainExact ? "exact" : "sampled";
  const objectIdentities = /* @__PURE__ */ new Set();
  const semanticObjects = semantic.objects.filter((item) => {
    if (objectIdentities.has(item.objectId))
      return false;
    objectIdentities.add(item.objectId);
    return true;
  });
  const regionIdentities = /* @__PURE__ */ new Set();
  const semanticRegions = semantic.regions.filter((item) => {
    if (regionIdentities.has(item.regionId))
      return false;
    regionIdentities.add(item.regionId);
    return true;
  });
  const duplicateObjectCount = semantic.objects.length - semanticObjects.length;
  const duplicateRegionCount = semantic.regions.length - semanticRegions.length;
  const incompleteObjectPositionCount = semanticObjects.filter((item) => item.sourcePositionDimensions === 2).length;
  const terrain = Object.freeze((semantic.terrain?.samples ?? []).map((item) => {
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
  }));
  const objects = Object.freeze(semanticObjects.map((item) => {
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
  }));
  const regions = Object.freeze(semanticRegions.map((item) => Object.freeze({
    facet: "regions",
    id: `${regionLayerId}:region:${String(item.regionId)}`,
    layerId: regionLayerId,
    coordinateSpaceId: "map-native",
    regionId: item.regionId,
    name: item.name,
    ...item.color === void 0 ? {} : { color: item.color },
    shapes: Object.freeze(item.shapes.map(regionShape))
  })));
  const resourceJoins = /* @__PURE__ */ new Map();
  for (const item of objects) {
    if (item.facet !== "objects" || item.catalog === void 0)
      continue;
    const key2 = resourceId(item.catalog.ref.namespace, item.catalog.ref.entityId);
    const current = resourceJoins.get(key2) ?? {
      namespace: item.catalog.ref.namespace,
      entityId: item.catalog.ref.entityId,
      resolved: item.catalog.entity !== void 0,
      objectIds: []
    };
    current.resolved ||= item.catalog.entity !== void 0;
    current.objectIds.push(item.id);
    resourceJoins.set(key2, current);
  }
  const resources = Object.freeze([...resourceJoins.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, item]) => Object.freeze({
    facet: "resources",
    id,
    layerId: resourceLayerId,
    namespace: item.namespace,
    entityId: item.entityId,
    resolved: item.resolved,
    objectIds: Object.freeze([...item.objectIds])
  })));
  const navigation = Object.freeze((snapshot2.navigation?.samples ?? []).map((item) => Object.freeze({
    facet: "navigation",
    id: `${navigationLayerId}:sample:${String(item.x)}:${String(item.y)}`,
    layerId: navigationLayerId,
    coordinateSpaceId: "navigation-grid",
    lod: "sampled",
    ...item
  })));
  const facets = Object.freeze([
    Object.freeze({
      facet: "terrain",
      layerId: terrainLayerId,
      state: terrainSummary === void 0 ? "unavailable" : terrainExact ? "available" : "partial",
      itemCount: semantic.terrain?.cellCount ?? 0,
      lods: Object.freeze(terrainSummary === void 0 ? [] : terrainExact ? ["exact"] : ["summary", "sampled"]),
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
      state: snapshot2.navigation === void 0 ? "unavailable" : "partial",
      itemCount: snapshot2.navigation?.cellCount ?? 0,
      lods: Object.freeze(snapshot2.navigation === void 0 ? [] : ["summary", "sampled"]),
      ...snapshot2.navigation === void 0 ? { reason: "publisher reported navigation unavailable" } : { reason: "native flags are sampled and their bit semantics remain publisher-defined" }
    })
  ]);
  const layers = Object.freeze(facets.map((item) => Object.freeze({
    facet: "layers",
    id: item.layerId,
    layerId: item.layerId,
    kind: item.facet,
    state: item.state,
    itemCount: item.itemCount,
    lods: item.lods
  })));
  const byFacet = /* @__PURE__ */ new Map([
    ["layers", layers],
    ["terrain", terrain],
    ["objects", objects],
    ["regions", regions],
    ["resources", resources],
    ["navigation", navigation]
  ]);
  const info = Object.freeze({
    contract: snapshot2.worldCandidate.contract,
    major: snapshot2.worldCandidate.major,
    maturity: snapshot2.worldCandidate.maturity,
    snapshotId: snapshot2.snapshotId,
    mapId: snapshot2.mapId,
    coordinateSpaces: snapshot2.worldCandidate.coordinateSpaces,
    crossSpaceTransforms: Object.freeze(snapshot2.worldCandidate.crossSpaceTransforms.map((item) => {
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
    })),
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
        x: snapshot2.navigation === void 0 ? Object.freeze({ state: "unknown", reason: "navigation bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: 0,
          maximum: snapshot2.navigation.width - 1
        }),
        y: snapshot2.navigation === void 0 ? Object.freeze({ state: "unknown", reason: "navigation bounds unavailable" }) : Object.freeze({
          state: "known",
          minimum: 0,
          maximum: snapshot2.navigation.height - 1
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
    unknownFacets: snapshot2.worldCandidate.unknownFacets,
    lossPolicy: "explicit-partial",
    complete: snapshot2.complete && duplicateObjectCount === 0 && duplicateRegionCount === 0 && incompleteObjectPositionCount === 0
  });
  let live = true;
  const assertLive = (signal) => {
    signal?.throwIfAborted();
    if (!live)
      throw new TypeError("world scene source lease is released or stale");
  };
  const source = Object.freeze({
    contract: snapshot2.worldCandidate.contract,
    major: snapshot2.worldCandidate.major,
    snapshotId: snapshot2.snapshotId,
    async info(signal) {
      assertLive(signal);
      return Promise.resolve(info);
    },
    async page(request, signal) {
      assertLive(signal);
      positiveLimit(request.limit, maxPageSize);
      cursorOffset(request.cursor, snapshot2.snapshotId, canonicalQuery(request));
      const items = byFacet.get(request.facet);
      if (items === void 0) {
        return Promise.resolve(Object.freeze({
          snapshotId: snapshot2.snapshotId,
          facet: request.facet,
          state: "unsupported",
          items: Object.freeze([]),
          reason: `publisher candidate does not expose facet ${request.facet}`
        }));
      }
      const facetState = facets.find((item) => item.facet === request.facet);
      if (request.facet !== "layers") {
        if (request.layerId !== facetState?.layerId) {
          throw new TypeError(`world facet ${request.facet} requires its exact layerId`);
        }
        const expectedLod = request.facet === "terrain" ? terrainLod : request.facet === "navigation" ? "sampled" : void 0;
        if (expectedLod !== void 0 && request.lod !== expectedLod) {
          return Promise.resolve(Object.freeze({
            snapshotId: snapshot2.snapshotId,
            facet: request.facet,
            state: "unsupported",
            items: Object.freeze([]),
            reason: `facet ${request.facet} only pages ${expectedLod} LOD items`
          }));
        }
      }
      if (request.bounds !== void 0 && (request.facet === "layers" || request.facet === "regions" || request.facet === "resources")) {
        return Promise.resolve(Object.freeze({
          snapshotId: snapshot2.snapshotId,
          facet: request.facet,
          state: "unsupported",
          items: Object.freeze([]),
          reason: `facet ${request.facet} does not support spatial bounds`
        }));
      }
      if (request.facet !== "layers" && facetState?.state === "unavailable") {
        return Promise.resolve(Object.freeze({
          snapshotId: snapshot2.snapshotId,
          facet: request.facet,
          state: "unavailable",
          items: Object.freeze([]),
          reason: facetState.reason ?? "facet unavailable"
        }));
      }
      const bounds = request.bounds;
      const bounded = bounds === void 0 ? items : items.filter((item) => {
        if (item.facet === "objects") {
          return item.position.x >= bounds.minimumX && item.position.x <= bounds.maximumX && item.position.y >= bounds.minimumY && item.position.y <= bounds.maximumY;
        }
        if (item.facet !== "terrain" && item.facet !== "navigation")
          return false;
        if (item.facet === "terrain" && item.mapNativePosition !== void 0) {
          return item.mapNativePosition.x >= bounds.minimumX && item.mapNativePosition.x <= bounds.maximumX && item.mapNativePosition.y >= bounds.minimumY && item.mapNativePosition.y <= bounds.maximumY;
        }
        return item.x >= bounds.minimumX && item.x <= bounds.maximumX && item.y >= bounds.minimumY && item.y <= bounds.maximumY;
      });
      return Promise.resolve(pageItems(bounded, request, snapshot2.snapshotId, maxPageSize));
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

// packages/host/dist/maps/index.js
var STANDARD_MAPS_OWNER = "modkit/maps";
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
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString6))
    return void 0;
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
        diagnostic("error", "x3.host/map-semantic-facet-invalid", `${context.contract}@${context.major}: semantic map routes must be well formed`)
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
        diagnostic("error", "x3.host/map-preview-preparation-facet-invalid", `${context.contract}@${context.major}: map preview preparation routes must be well formed`)
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
      $ref: "https://schemas.modkit.org/x3/map-semantic-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-semantic-request.v1.schema.json"
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
      $ref: "https://schemas.modkit.org/x3/map-semantic-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-semantic-request.v1.schema.json"
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
      $ref: "https://schemas.modkit.org/x3/map-preview-preparation-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkit.org/x3/map-preview-preparation-request.v1.schema.json"
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
function registerStandardMapDefinitions(definitions) {
  const registered = [
    MAP_SEMANTIC_CONTRACT_DEFINITION,
    RESOLVED_MAP_WORKSPACE_CONTRACT_DEFINITION,
    MAP_PREVIEW_PREPARATION_CONTRACT_DEFINITION
  ];
  return definitions.replaceOwnerInventory(STANDARD_MAPS_OWNER, registered.map((definition) => ({
    definition,
    provenance: {
      ownerExtensionId: STANDARD_MAPS_OWNER,
      extensionVersion: "1.0.0",
      inventoryRecordId: `host:${definition.contract}@${definition.major}`,
      manifestDigest: `host:${definition.contract}@${definition.major}`,
      artifactDigest: "host:standard-map-definitions",
      artifactRoot: "host:",
      manifestPath: "host:standard-map-definitions"
    }
  })));
}
function isMapSemanticAnalysis(value) {
  const record = recordOf8(value);
  return record?.["contract"] === MAP_SEMANTIC_ANALYSIS_CONTRACT && nonEmptyString6(record["analyzerId"]) && stringList7(record["gameIds"]) !== void 0 && typeof record["open"] === "function";
}
async function resolveMapSemanticAnalysis(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/map-semantic-unavailable", "this host registered no service-contract definitions, so maps cannot be opened semantically")
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
    const lease2 = await resolver.port.resolve({
      contract: MAP_SEMANTIC_ANALYSIS_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isMapSemanticAnalysis(lease2.value) || !lease2.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/map-semantic-invalid", `the selected provider does not implement ${MAP_SEMANTIC_ANALYSIS_CONTRACT}@1 for ${request.gameId}`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      analysis: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/map-semantic-selected", `selected ${lease2.value.analyzerId} for ${request.gameId}`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/map-semantic-unresolved", `no semantic map provider resolved for ${request.gameId} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}
function isResolvedMapWorkspace(value) {
  const record = recordOf8(value);
  return record?.["contract"] === RESOLVED_MAP_WORKSPACE_CONTRACT && nonEmptyString6(record["analyzerId"]) && stringList7(record["gameIds"]) !== void 0 && typeof record["plan"] === "function" && typeof record["analyze"] === "function";
}
async function resolveResolvedMapWorkspace(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/resolved-map-workspace-unavailable", "this host registered no service-contract definitions for workspace maps")
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
    const lease2 = await resolver.port.resolve({
      contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isResolvedMapWorkspace(lease2.value) || !lease2.value.gameIds.includes(request.gameId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/resolved-map-workspace-invalid", `selected provider does not implement ${RESOLVED_MAP_WORKSPACE_CONTRACT}@1`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      workspace: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/resolved-map-workspace-selected", `selected ${lease2.value.analyzerId} for ${request.gameId}`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/resolved-map-workspace-unresolved", `no workspace map provider resolved for ${request.gameId} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}
function isMapPreviewPreparation(value) {
  const record = recordOf8(value);
  return record?.["contract"] === MAP_PREVIEW_PREPARATION_CONTRACT && nonEmptyString6(record["preparationId"]) && stringList7(record["subjectFormatIds"]) !== void 0 && typeof record["prepare"] === "function";
}
async function resolveMapPreviewPreparation(request) {
  const definitions = request.services.serviceDefinitions;
  if (definitions === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("information", "x3.host/map-preview-preparation-unavailable", "this host registered no service-contract definitions for map preview preparation")
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
    const lease2 = await resolver.port.resolve({
      contract: MAP_PREVIEW_PREPARATION_CONTRACT,
      major: 1,
      facet: { subjectFormatId: request.subjectFormatId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    if (!isMapPreviewPreparation(lease2.value) || !lease2.value.subjectFormatIds.includes(request.subjectFormatId)) {
      await resolver.release();
      return {
        state: "unresolved",
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic("error", "x3.host/map-preview-preparation-invalid", `selected provider does not implement ${MAP_PREVIEW_PREPARATION_CONTRACT}@1`)
        ]
      };
    }
    return Object.freeze({
      state: "resolved",
      preparation: lease2.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/map-preview-preparation-selected", `selected ${lease2.value.preparationId} for the subject format`)
      ]),
      release: () => resolver.release()
    });
  } catch (error3) {
    await resolver.release();
    return {
      state: "unresolved",
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic("information", "x3.host/map-preview-preparation-unresolved", `no map preview preparation provider resolved (${error3 instanceof Error ? error3.message : String(error3)})`)
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
    if (value > budgets.maxNodes)
      throw new TypeError(`${label} exceeds ResourceBudget.maxNodes`);
  }
  if (limits.maxDepth > budgets.maxDepth) {
    throw new TypeError("maxDepth exceeds ResourceBudget.maxDepth");
  }
  if (limits.maxDiagnostics > budgets.maxDiagnostics) {
    throw new TypeError("maxDiagnostics exceeds ResourceBudget.maxDiagnostics");
  }
}
function boundedDiagnostics(items, maximum) {
  if (items.length <= maximum)
    return Object.freeze([...items]);
  const marker = diagnostic("warning", "x3.host/resolved-map-diagnostics-truncated", `workspace map diagnostics were truncated to maxDiagnostics ${maximum}`);
  return Object.freeze(maximum === 1 ? [marker] : [...items.slice(0, maximum - 1), marker]);
}
function validateWorkspacePlan2(plan, workspace, maxRequirements) {
  if (plan.schemaVersion !== 1 || plan.workspaceId !== workspace.workspaceId || plan.gameId !== workspace.gameId || !nonEmptyString6(plan.analyzerId) || !Array.isArray(plan.requirements) || plan.requirements.length > maxRequirements) {
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
    if (!nonEmptyString6(requirement.requirementId) || !nonEmptyString6(requirement.kind) || typeof requirement.required !== "boolean" || path !== requirement.path || !path.startsWith(prefix) || path.slice(prefix.length).includes("/") || path.split("/").some((segment) => segment === "." || segment === "..") || ids.has(requirement.requirementId) || paths.has(path.toLowerCase())) {
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
      diagnostic: diagnostic("warning", "x3.host/resolved-map-total-budget-exceeded", `${requirement.path} cannot be read because maxTotalBytes is exhausted`),
      consumedBytes: 0
    };
  }
  const resolved = await resources.resolve({
    id: requirement.requirementId,
    logicalId: requirement.path,
    role: "buffer",
    scopes: ["current-mount", "enclosing-container", "workspace-dependency-layer"]
  }, signal);
  if (resolved.state === "unresolved") {
    return { state: "unresolved", diagnostic: resolved.diagnostic, consumedBytes: 0 };
  }
  try {
    const source = resolved.lease.value;
    if (source.kind !== "bytes") {
      return {
        state: "unresolved",
        diagnostic: diagnostic("warning", "x3.host/resolved-map-resource-not-bytes", `${requirement.path} resolved to a namespace instead of bytes`),
        consumedBytes: 0
      };
    }
    if (source.size !== void 0 && (source.size > BigInt(maxDocumentBytes) || source.size > BigInt(remainingTotalBytes))) {
      const totalExceeded = source.size > BigInt(remainingTotalBytes);
      return {
        state: "unresolved",
        diagnostic: diagnostic("warning", totalExceeded ? "x3.host/resolved-map-total-budget-exceeded" : "x3.host/resolved-map-document-budget-exceeded", totalExceeded ? `${requirement.path} exceeds remaining maxTotalBytes ${remainingTotalBytes}` : `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`),
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
          diagnostic: diagnostic("warning", byteLength > remainingTotalBytes ? "x3.host/resolved-map-total-budget-exceeded" : "x3.host/resolved-map-document-budget-exceeded", byteLength > remainingTotalBytes ? `${requirement.path} exceeds remaining maxTotalBytes ${remainingTotalBytes}` : `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`),
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
        diagnostic("warning", "x3.host/resolved-map-resource-session-disposed", "workspace map analysis requires a live revision-pinned ResourceSessionPort")
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
  if (resolution.state === "unresolved")
    return resolution;
  const diagnostics = [...resolution.diagnostics];
  try {
    const plan = await resolution.workspace.plan({
      workspace: request.workspace,
      maxRequirements: limits.maxRequirements,
      ...request.signal === void 0 ? {} : { signal: request.signal }
    });
    validateWorkspacePlan2(plan, request.workspace, limits.maxRequirements);
    diagnostics.push(...plan.diagnostics.map((item) => diagnostic(item.severity, item.code, item.message, void 0, {
      analyzerId: plan.analyzerId
    })));
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
      const loaded = await readResourceBytes(request.resources, requirement, limits.maxDocumentBytes, limits.maxTotalBytes - totalBytes, request.signal);
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
      revisions.push(`${requirement.requirementId}:${requirement.path}@${String(loaded.revision)}#${loaded.contentFingerprint}`);
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
    const snapshot2 = await resolution.workspace.analyze({
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
    const world = createCandidateWorldSceneLease(snapshot2, request.resources.provenance().slice(provenanceOffset), limits.maxPageSize);
    let released = false;
    return Object.freeze({
      state: "resolved",
      snapshot: snapshot2,
      plan,
      world,
      diagnostics: boundedDiagnostics(diagnostics, limits.maxDiagnostics),
      async release() {
        if (released)
          return;
        released = true;
        const results = await Promise.allSettled([world.release(), resolution.release()]);
        const failure2 = results.find((result) => result.status === "rejected");
        if (failure2?.status === "rejected")
          throw failure2.reason;
      }
    });
  } catch (error3) {
    await resolution.release();
    if (request.signal?.aborted)
      throw error3;
    return {
      state: "unresolved",
      diagnostics: boundedDiagnostics([
        ...diagnostics,
        diagnostic("warning", "x3.host/resolved-map-workspace-failed", error3 instanceof Error ? error3.message : String(error3))
      ], limits.maxDiagnostics)
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
    if (!live)
      throw new TypeError("world scene data-source lease has been released");
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
      if (typeof member !== "function")
        return member;
      return (...args) => {
        if (!live)
          throw new TypeError("map preview data-source lease has been released");
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
  } catch (error3) {
    await Promise.allSettled([request.resources.dispose(), request.catalogSources?.release()]);
    throw error3;
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
  } catch (error3) {
    await Promise.allSettled([
      analyzed.release(),
      request.catalogSources?.release(),
      request.resources.dispose()
    ]);
    throw error3;
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
  if (admitted > maximum)
    throw new TypeError(`${label} must be no greater than ${maximum}`);
  return admitted;
}
function validPreparationDiagnostic(value) {
  const record = recordOf8(value);
  return record !== void 0 && Object.keys(record).every((key2) => ["code", "severity", "message", "path", "data"].includes(key2)) && nonEmptyString6(record["code"]) && PREVIEW_DIAGNOSTIC_SEVERITIES.has(String(record["severity"])) && nonEmptyString6(record["message"]) && (!Object.hasOwn(record, "path") || Array.isArray(record["path"]) && record["path"].every((item) => typeof item === "string" || Number.isSafeInteger(item))) && (!Object.hasOwn(record, "data") || jsonSafeValue(record["data"]));
}
function validNamespaceSearchQuery(value) {
  const query = recordOf8(value);
  if (query === void 0 || !Object.keys(query).every((key2) => key2 === "kind" || key2 === "basenames" || key2 === "caseSensitive") || query["kind"] !== "basename-any" || !Array.isArray(query["basenames"]) || query["basenames"].length === 0 || query["basenames"].length > MAX_PREVIEW_NAMESPACE_SEARCH_BASENAMES || typeof query["caseSensitive"] !== "boolean") {
    return false;
  }
  const basenames = query["basenames"];
  const validBasenames = basenames.every((item) => nonEmptyString6(item) && item.length <= MAX_PREVIEW_NAMESPACE_SEARCH_BASENAME_CHARS && !item.includes("/") && !item.includes("\\") && !item.includes("\0") && item !== "." && item !== "..");
  if (!validBasenames)
    return false;
  const identityBasenames = query["caseSensitive"] ? basenames : basenames.map((item) => item.toLowerCase());
  return new Set(identityBasenames).size === basenames.length;
}
function validateNamespaceSearchRequests(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PREVIEW_NAMESPACE_SEARCHES || !value.every((item) => {
    const search = recordOf8(item);
    return search !== void 0 && Object.keys(search).every((key2) => key2 === "searchId" || key2 === "query") && nonEmptyString6(search["searchId"]) && search["searchId"].length <= MAX_PREVIEW_NAMESPACE_SEARCH_ID_CHARS && !search["searchId"].includes("\0") && validNamespaceSearchQuery(search["query"]);
  }) || new Set(value.map((item) => String(recordOf8(item)?.["searchId"] ?? ""))).size !== value.length) {
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
    const document = recordOf8(item);
    if (document === void 0 || !Object.keys(document).every((key2) => key2 === "documentId" || key2 === "path" || key2 === "maxBytes") || !nonEmptyString6(document["documentId"]) || document["documentId"].length > 256 || document["documentId"].includes("\0") || !nonEmptyString6(document["path"]) || document["path"].length > MAX_PREVIEW_NAMESPACE_PATH_CHARS || document["path"].includes("\0") || document["path"].startsWith("/") || /^[a-z]:/iu.test(document["path"]) || document["path"].replace(/\\/gu, "/").split("/").some((part) => part === "..") || !Number.isSafeInteger(document["maxBytes"]) || Number(document["maxBytes"]) <= 0 || Number(document["maxBytes"]) > MAX_PREVIEW_DOCUMENT_READ_BYTES) {
      throw new TypeError(`map preview document read ${index} is malformed`);
    }
    if (identities.has(document["documentId"])) {
      throw new TypeError("map preview document reads contain duplicate document ids");
    }
    identities.add(document["documentId"]);
    totalBytes += Number(document["maxBytes"]);
  }
  if (totalBytes > MAX_PREVIEW_DOCUMENT_TOTAL_BYTES) {
    throw new TypeError("map preview document reads exceed the total byte budget");
  }
  return value;
}
function jsonSafeValue(value, depth = 0) {
  if (depth > 64)
    return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number")
    return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((item) => jsonSafeValue(item, depth + 1));
  const record = recordOf8(value);
  return record !== void 0 && Object.values(record).every((item) => jsonSafeValue(item, depth + 1));
}
function validHostResourceRoot(value) {
  const record = recordOf8(value);
  return record !== void 0 && Object.keys(record).every((key2) => key2 === "rootId" || key2 === "locator") && nonEmptyString6(record["rootId"]) && Object.hasOwn(record, "locator") && jsonSafeValue(record["locator"]);
}
function validSubjectNamespaceRoot(value) {
  const record = recordOf8(value);
  return record !== void 0 && Object.keys(record).every((key2) => key2 === "rootId" || key2 === "namespacePrefix") && nonEmptyString6(record["rootId"]) && typeof record["namespacePrefix"] === "string";
}
function validateResourcePlan(value, maxRoots) {
  const plan = recordOf8(value);
  if (plan?.["schemaVersion"] !== 1) {
    throw new TypeError("map preview preparation returned no versioned resource plan");
  }
  if (plan["strategy"] === "subject-namespace") {
    const roots = plan["roots"];
    if (!Object.keys(plan).every((key2) => key2 === "schemaVersion" || key2 === "strategy" || key2 === "roots") || !Array.isArray(roots) || roots.length === 0 || roots.length > maxRoots || !roots.every(validSubjectNamespaceRoot) || new Set(roots.map((item) => String(recordOf8(item)?.["rootId"] ?? ""))).size !== roots.length) {
      throw new TypeError("map preview preparation returned invalid subject namespace roots");
    }
    return value;
  }
  if (plan["strategy"] === "host-resolved") {
    const roots = plan["roots"];
    const subjectRoots = plan["subjectNamespaceRoots"];
    if (!Object.keys(plan).every((key2) => ["schemaVersion", "strategy", "resolverId", "subjectNamespaceRoots", "roots"].includes(key2)) || !nonEmptyString6(plan["resolverId"]) || !Array.isArray(subjectRoots) || !subjectRoots.every(validSubjectNamespaceRoot) || !Array.isArray(roots) || roots.length === 0 || roots.length + subjectRoots.length > maxRoots || !roots.every(validHostResourceRoot) || new Set([...subjectRoots, ...roots].map((item) => String(recordOf8(item)?.["rootId"] ?? ""))).size !== roots.length + subjectRoots.length) {
      throw new TypeError("map preview preparation returned invalid host resource roots");
    }
    return value;
  }
  throw new TypeError("map preview preparation returned an unknown resource strategy");
}
function validatePreparationResult(value, maxCandidates, maxRoots) {
  const record = recordOf8(value);
  if (record === void 0 || !Array.isArray(record["diagnostics"]) || !record["diagnostics"].every(validPreparationDiagnostic)) {
    throw new TypeError("map preview preparation returned malformed diagnostics");
  }
  if (record["state"] === "not-applicable" || record["state"] === "unresolved") {
    if (!Object.keys(record).every((key2) => key2 === "state" || key2 === "diagnostics")) {
      throw new TypeError("map preview preparation result contains unknown fields");
    }
    return value;
  }
  if (record["state"] === "selection-required") {
    const candidates = record["candidates"];
    if (!Object.keys(record).every((key2) => key2 === "state" || key2 === "candidates" || key2 === "diagnostics") || !Array.isArray(candidates) || candidates.length === 0 || candidates.length > maxCandidates || !candidates.every((candidate) => {
      const item = recordOf8(candidate);
      return item !== void 0 && Object.keys(item).every((key2) => key2 === "candidateId" || key2 === "displayName" || key2 === "sourcePath") && nonEmptyString6(item["candidateId"]) && nonEmptyString6(item["displayName"]) && (!Object.hasOwn(item, "sourcePath") || nonEmptyString6(item["sourcePath"]));
    }) || new Set(candidates.map((candidate) => String(recordOf8(candidate)?.["candidateId"] ?? ""))).size !== candidates.length) {
      throw new TypeError("map preview preparation returned invalid selection candidates");
    }
    return value;
  }
  if (record["state"] === "namespace-search-required") {
    if (!Object.keys(record).every((key2) => key2 === "state" || key2 === "searches" || key2 === "diagnostics")) {
      throw new TypeError("map preview preparation search result contains unknown fields");
    }
    validateNamespaceSearchRequests(record["searches"]);
    return value;
  }
  if (record["state"] === "document-read-required") {
    if (!Object.keys(record).every((key2) => key2 === "state" || key2 === "documents" || key2 === "diagnostics")) {
      throw new TypeError("map preview preparation document-read result contains unknown fields");
    }
    validateDocumentReadRequests(record["documents"]);
    return value;
  }
  if (record["state"] === "prepared") {
    const plan = recordOf8(record["plan"]);
    if (!Object.keys(record).every((key2) => key2 === "state" || key2 === "plan" || key2 === "diagnostics") || plan?.["schemaVersion"] !== 1 || recordOf8(plan["workspace"]) === void 0 || !jsonSafeValue(plan["workspace"]) || !Object.keys(plan).every((key2) => key2 === "schemaVersion" || key2 === "workspace" || key2 === "resources")) {
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
  if (!nonEmptyString6(formatId)) {
    throw new TypeError("the ordinary codec descriptor has no format id");
  }
  return Object.freeze({
    schemaVersion: 1,
    subjectUri: descriptor.subjectUri,
    revision: descriptor.revision,
    formatId,
    traits: Object.freeze(descriptor.traits.map((item) => item.id)),
    dataSources: Object.freeze(descriptor.dataSources.map((item) => Object.freeze({ contract: item.contract, major: item.major }))),
    operations: Object.freeze(descriptor.operations.map((item) => Object.freeze({ id: item.id, state: item.state }))),
    namespace,
    namespaceSearches: Object.freeze(namespaceSearches.map((item) => Object.freeze(item))),
    documentReads: Object.freeze(documentReads.map((item) => Object.freeze(item)))
  });
}
async function boundedPreparationNamespace(original, descriptor, maxEntries, maxPages, signal) {
  if (!descriptor.dataSources.some((item) => item.contract === "common.view/namespace-entry-source" && item.major === 1)) {
    return Object.freeze({ state: "unavailable", entries: Object.freeze([]) });
  }
  const lease2 = await original.dataSource("common.view/namespace-entry-source", 1);
  const release = releaseOnce(() => lease2.release());
  try {
    const entries = [];
    const seenCursors = /* @__PURE__ */ new Set();
    let cursor3;
    let pages = 0;
    let truncated = false;
    do {
      signal?.throwIfAborted();
      if (pages >= maxPages) {
        truncated = true;
        break;
      }
      if (cursor3 !== void 0) {
        if (seenCursors.has(cursor3)) {
          throw new TypeError("subject namespace repeated a paging cursor");
        }
        seenCursors.add(cursor3);
      }
      const remaining = maxEntries - entries.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const page = await lease2.value.list("", cursor3 === void 0 ? { limit: Math.min(remaining, 256) } : { cursor: cursor3, limit: Math.min(remaining, 256) }, signal);
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
      cursor3 = page.nextCursor;
    } while (cursor3 !== void 0);
    entries.sort((left, right) => left.path === right.path ? left.kind.localeCompare(right.kind) : left.path.localeCompare(right.path));
    return Object.freeze({
      state: truncated ? "truncated" : "complete",
      entries: Object.freeze(entries.map((item) => Object.freeze(item)))
    });
  } finally {
    await release();
  }
}
async function boundedPreparationNamespaceSearches(original, descriptor, searches, maxEntries, maxPages, signal) {
  if (!descriptor.dataSources.some((item) => item.contract === "common.view/namespace-entry-source" && item.major === 1)) {
    return Object.freeze(searches.map((search) => Object.freeze({
      searchId: search.searchId,
      state: "unsupported",
      entries: Object.freeze([])
    })));
  }
  const lease2 = await original.dataSource("common.view/namespace-entry-source", 1);
  const release = releaseOnce(() => lease2.release());
  try {
    const source = lease2.value;
    const searchNamespace = source.search?.bind(source);
    if (searchNamespace === void 0) {
      return Object.freeze(searches.map((search) => Object.freeze({
        searchId: search.searchId,
        state: "unsupported",
        entries: Object.freeze([])
      })));
    }
    let remainingEntries = maxEntries;
    let remainingPages = maxPages;
    const results = [];
    for (const search of searches) {
      signal?.throwIfAborted();
      const entries = [];
      const seenCursors = /* @__PURE__ */ new Set();
      let cursor3;
      let truncated = remainingEntries === 0 || remainingPages === 0;
      while (!truncated) {
        if (cursor3 !== void 0) {
          if (seenCursors.has(cursor3)) {
            throw new TypeError("subject namespace search repeated a paging cursor");
          }
          seenCursors.add(cursor3);
        }
        const pageLimit2 = Math.min(remainingEntries, 256);
        const page = await searchNamespace(search.query, cursor3 === void 0 ? { limit: pageLimit2 } : { cursor: cursor3, limit: pageLimit2 }, signal);
        remainingPages -= 1;
        if (!Array.isArray(page.items) || page.items.length > pageLimit2 || page.nextCursor !== void 0 && (typeof page.nextCursor !== "string" || page.nextCursor.length === 0 || page.nextCursor.length > MAX_PREVIEW_NAMESPACE_CURSOR_CHARS)) {
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
        cursor3 = page.nextCursor;
        if (cursor3 === void 0)
          break;
        if (remainingEntries === 0 || remainingPages === 0)
          truncated = true;
      }
      entries.sort((left, right) => left.path === right.path ? left.kind.localeCompare(right.kind) : left.path.localeCompare(right.path));
      results.push(Object.freeze({
        searchId: search.searchId,
        state: truncated ? "truncated" : "complete",
        entries: Object.freeze(entries.map((item) => Object.freeze(item)))
      }));
    }
    return Object.freeze(results);
  } finally {
    await release();
  }
}
async function boundedPreparationDocumentReads(original, descriptor, requests, signal) {
  const extraction = descriptor.operations.find((item) => item.id === CONTAINER_EXTRACT_OPERATION_ID && item.state === "available");
  if (extraction === void 0 || !descriptor.dataSources.some((item) => item.contract === "common.view/namespace-entry-source" && item.major === 1)) {
    return Object.freeze(requests.map((request) => Object.freeze({
      documentId: request.documentId,
      path: request.path,
      state: "unsupported"
    })));
  }
  const lease2 = await original.dataSource("common.view/namespace-entry-source", 1);
  const release = releaseOnce(() => lease2.release());
  try {
    const source = lease2.value;
    const decoder2 = new TextDecoder("utf-8", { fatal: false });
    const results = [];
    for (const request of requests) {
      signal?.throwIfAborted();
      let page;
      try {
        page = await source.list(request.path, { limit: 16 }, signal);
      } catch (error3) {
        if (signal?.aborted)
          throw error3;
        results.push(Object.freeze({
          documentId: request.documentId,
          path: request.path,
          state: "unreadable"
        }));
        continue;
      }
      const normalizedPath2 = request.path.replace(/\\/gu, "/");
      const entry2 = page.items.find((item) => item.kind === "file" && item.path.replace(/\\/gu, "/") === normalizedPath2);
      if (entry2 === void 0) {
        results.push(Object.freeze({
          documentId: request.documentId,
          path: request.path,
          state: "missing"
        }));
        continue;
      }
      if (entry2.size !== void 0 && entry2.size > BigInt(request.maxBytes)) {
        results.push(Object.freeze({
          documentId: request.documentId,
          path: request.path,
          state: "too-large"
        }));
        continue;
      }
      try {
        const invoked = await original.operations().invoke(extraction.handlerId, { entryId: entry2.id }, signal === void 0 ? {} : { signal });
        if (invoked.state !== "ok" || invoked.output.kind !== "bytes" || invoked.output.value.byteLength > request.maxBytes) {
          results.push(Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: invoked.state === "ok" && invoked.output.kind === "bytes" && invoked.output.value.byteLength > request.maxBytes ? "too-large" : "unreadable"
          }));
          continue;
        }
        results.push(Object.freeze({
          documentId: request.documentId,
          path: request.path,
          state: "read",
          text: decoder2.decode(invoked.output.value)
        }));
      } catch (error3) {
        if (signal?.aborted)
          throw error3;
        results.push(Object.freeze({
          documentId: request.documentId,
          path: request.path,
          state: "unreadable"
        }));
      }
    }
    return Object.freeze(results);
  } finally {
    await release();
  }
}
function workspaceDiagnostics(workspace) {
  return workspace.diagnostics.map((item) => diagnostic(item.severity, "x3.host/map-preview-workspace-diagnostic", `${item.code}: ${item.message}`, void 0, {
    ...item.rootId === void 0 ? {} : { rootId: item.rootId },
    ...item.dependencyRef === void 0 ? {} : { dependencyRef: item.dependencyRef },
    ...item.cycle === void 0 ? {} : { cycle: item.cycle }
  }));
}
function sessionHoldingMapPreviewPrerequisites(preview2, releasePreparedResources, original) {
  let disposed = false;
  return Object.freeze({
    revision: preview2.revision,
    state: () => preview2.state(),
    descriptor: () => preview2.descriptor(),
    dataSource: preview2.dataSource.bind(preview2),
    operations: () => preview2.operations(),
    events: (signal) => preview2.events(signal),
    async dispose() {
      if (disposed)
        return;
      disposed = true;
      let firstError;
      for (const release of [
        () => preview2.dispose(),
        releasePreparedResources,
        () => original.dispose()
      ]) {
        try {
          await release();
        } catch (error3) {
          firstError ??= error3;
        }
      }
      if (firstError !== void 0)
        throw firstError;
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
    if (released)
      return;
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
  } catch (error3) {
    if (request.signal?.aborted)
      throw error3;
    return Object.freeze({
      diagnostics: boundedDiagnostics([
        diagnostic("warning", "x3.host/map-preview-catalog-enrichment-failed", `map preview catalog enrichment failed (${error3 instanceof Error ? error3.message : String(error3)})`)
      ], request.limits.maxDiagnostics)
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
        if (released)
          return;
        released = true;
        const results = await Promise.allSettled([
          ...selector === void 0 ? [] : [selector.release()],
          analyzed.release()
        ]);
        const failed2 = results.find((result) => result.status === "rejected");
        if (failed2?.status === "rejected")
          throw failed2.reason;
      }
    }),
    diagnostics: boundedDiagnostics(analyzed.diagnostics, request.limits.maxDiagnostics)
  });
}
async function resolveSubjectNamespacePreviewResources(request) {
  if (!request.descriptor.dataSources.some((item) => item.contract === "common.view/namespace-entry-source" && item.major === 1)) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("error", "x3.host/map-preview-namespace-unavailable", "the subject-namespace resource plan requires an ordinary namespace entry source")
      ]
    };
  }
  const extractOperation = request.descriptor.operations.find((item) => item.id === CONTAINER_EXTRACT_OPERATION_ID && item.state === "available");
  if (extractOperation === void 0) {
    return {
      state: "unresolved",
      diagnostics: [
        diagnostic("error", "x3.host/map-preview-extract-unavailable", `the subject-namespace resource plan requires ${CONTAINER_EXTRACT_OPERATION_ID}`)
      ]
    };
  }
  const namespaceLease = await request.original.dataSource("common.view/namespace-entry-source", 1);
  const release = releaseOnce(() => namespaceLease.release());
  try {
    const operations = request.original.operations();
    const extract = async (entryId, signal) => {
      signal?.throwIfAborted();
      const result = await operations.invoke(extractOperation.handlerId, { entryId }, signal === void 0 ? {} : { signal });
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
    const namespacePrefixes = new Map(request.plan.roots.map((root) => [root.rootId, root.namespacePrefix]));
    const logicalRoots = (request.workspace.logicalRoots ?? [...request.workspace.loadOrder].reverse()).map((root) => Object.freeze({
      rootId: root.rootId,
      pathPrefix: namespacePrefixes.get(root.rootId) ?? "",
      logicalPrefix: root.sourcePath
    }));
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
        diagnostic("information", "x3.host/map-preview-subject-resources-selected", "map preview resources are confined to the opened subject namespace")
      ]),
      release
    });
  } catch (error3) {
    await release();
    throw error3;
  }
}
async function coordinateMapPreviewAssetSession(request) {
  const maxCandidates = positiveCoordinatorLimit(request.maxCandidates, "maxCandidates");
  const maxSubjectEntries = boundedCoordinatorLimit(request.maxSubjectEntries, "maxSubjectEntries", MAX_PREVIEW_NAMESPACE_FACT_ENTRIES);
  const maxSubjectPages = boundedCoordinatorLimit(request.maxSubjectPages, "maxSubjectPages", MAX_PREVIEW_NAMESPACE_FACT_PAGES);
  const maxRoots = positiveCoordinatorLimit(request.maxRoots, "maxRoots");
  const maxDepth = positiveCoordinatorLimit(request.maxDepth, "maxDepth");
  request.signal?.throwIfAborted();
  const descriptor = await request.original.descriptor();
  let subject;
  try {
    subject = mapPreviewPreparationSubject(descriptor, Object.freeze({ state: "unavailable", entries: Object.freeze([]) }));
  } catch (error3) {
    return {
      state: "not-applicable",
      diagnostics: [
        diagnostic("information", "x3.host/map-preview-subject-not-applicable", error3 instanceof Error ? error3.message : String(error3))
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
    return coordinatorFailure("x3.host/map-preview-preparation-invalid", "the supplied map preview preparation port does not accept the subject format");
  }
  let prepared;
  let searchRoundDiagnostics = Object.freeze([]);
  const documentRoundDiagnostics = [];
  try {
    const namespace = await boundedPreparationNamespace(request.original, descriptor, maxSubjectEntries, maxSubjectPages, request.signal);
    let namespaceSearches = Object.freeze([]);
    subject = mapPreviewPreparationSubject(descriptor, namespace);
    prepared = validatePreparationResult(await preparation.prepare({
      subject,
      maxCandidates,
      maxRoots,
      maxDepth,
      ...request.selectionId === void 0 ? {} : { selectionId: request.selectionId },
      ...request.signal === void 0 ? {} : { signal: request.signal }
    }), maxCandidates, maxRoots);
    if (prepared.state === "namespace-search-required") {
      searchRoundDiagnostics = prepared.diagnostics;
      namespaceSearches = await boundedPreparationNamespaceSearches(request.original, descriptor, prepared.searches, maxSubjectEntries, maxSubjectPages, request.signal);
      subject = mapPreviewPreparationSubject(descriptor, namespace, namespaceSearches);
      prepared = validatePreparationResult(await preparation.prepare({
        subject,
        maxCandidates,
        maxRoots,
        maxDepth,
        ...request.selectionId === void 0 ? {} : { selectionId: request.selectionId },
        ...request.signal === void 0 ? {} : { signal: request.signal }
      }), maxCandidates, maxRoots);
      if (prepared.state === "namespace-search-required") {
        throw new TypeError("map preview preparation requested more than one namespace search round");
      }
    }
    const accumulatedDocumentReads = /* @__PURE__ */ new Map();
    let documentRounds = 0;
    while (prepared.state === "document-read-required") {
      if (documentRounds >= MAX_PREVIEW_DOCUMENT_ROUNDS) {
        throw new TypeError(`map preview preparation exceeded ${MAX_PREVIEW_DOCUMENT_ROUNDS} document-read rounds`);
      }
      documentRounds += 1;
      documentRoundDiagnostics.push(...prepared.diagnostics);
      const documents = validateDocumentReadRequests(prepared.documents);
      const documentReads = await boundedPreparationDocumentReads(request.original, descriptor, documents, request.signal);
      for (const document of documentReads) {
        accumulatedDocumentReads.set(document.documentId, document);
      }
      subject = mapPreviewPreparationSubject(descriptor, namespace, namespaceSearches, Object.freeze([...accumulatedDocumentReads.values()]));
      prepared = validatePreparationResult(await preparation.prepare({
        subject,
        maxCandidates,
        maxRoots,
        maxDepth,
        ...request.selectionId === void 0 ? {} : { selectionId: request.selectionId },
        ...request.signal === void 0 ? {} : { signal: request.signal }
      }), maxCandidates, maxRoots);
      if (prepared.state === "namespace-search-required") {
        throw new TypeError("map preview preparation requested a namespace search after documents");
      }
    }
  } catch (error3) {
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...resolutionDiagnostics,
        ...preparationDiagnostics(searchRoundDiagnostics),
        ...preparationDiagnostics(documentRoundDiagnostics),
        diagnostic("error", "x3.host/map-preview-preparation-invalid", `map preview preparation failed (${error3 instanceof Error ? error3.message : String(error3)})`)
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
  } catch (error3) {
    return coordinatorFailure("x3.host/map-preview-preparation-invalid", `map preview preparation returned an invalid diagnostic (${error3 instanceof Error ? error3.message : String(error3)})`);
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
    return coordinatorFailure("x3.host/map-preview-preparation-budget-exceeded", "map preview preparation exceeded the host workspace limits");
  }
  let workspace;
  try {
    workspace = resolveModWorkspaceGraph(graph);
  } catch (error3) {
    return coordinatorFailure("x3.host/map-preview-workspace-invalid", `map preview preparation returned an invalid workspace graph (${error3 instanceof Error ? error3.message : String(error3)})`);
  }
  const active = workspace.loadOrder.find((item) => item.rootId === workspace.activeRootId);
  if (active === void 0) {
    return coordinatorFailure("x3.host/map-preview-workspace-invalid", "map preview workspace does not contain its active root");
  }
  const plannedRootIds = new Set(prepared.plan.resources.strategy === "subject-namespace" ? prepared.plan.resources.roots.map((root) => root.rootId) : [
    ...prepared.plan.resources.subjectNamespaceRoots.map((root) => root.rootId),
    ...prepared.plan.resources.roots.map((root) => root.rootId)
  ]);
  const workspaceRootIds = new Set(workspace.loadOrder.map((root) => root.rootId));
  if (plannedRootIds.size !== workspaceRootIds.size || [...plannedRootIds].some((rootId) => !workspaceRootIds.has(rootId))) {
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        diagnostic("error", "x3.host/map-preview-resource-root-mismatch", "the resource plan must map every resolved workspace root exactly once")
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
          diagnostic("warning", "x3.host/map-preview-resource-resolver-required", `resource plan ${prepared.plan.resources.resolverId} names installation/dependency roots but this host wired no resolver`)
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
  } catch (error3) {
    return {
      state: "unresolved",
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        diagnostic("error", "x3.host/map-preview-resource-resolution-failed", `map preview resources could not be resolved (${error3 instanceof Error ? error3.message : String(error3)})`)
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
      session: sessionHoldingMapPreviewPrerequisites(opened.session, releasePreparedResources, request.original),
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        ...resourceResolution.diagnostics,
        ...enrichment.diagnostics,
        ...opened.diagnostics
      ])
    });
  } catch (error3) {
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
        diagnostic("error", "x3.host/map-preview-open-failed", `map preview could not be opened (${error3 instanceof Error ? error3.message : String(error3)})`)
      ])
    };
  }
}

// packages/host/dist/subject-services.js
function describeInventoryContributions(inventory) {
  const rows = inventory.extensions.flatMap((extension) => {
    const owner = `${extension.manifest.publisher}/${extension.manifest.id}`;
    return extension.contributions.map((contribution) => {
      const manifest = contribution.manifest;
      return {
        ...manifest === void 0 ? {} : { id: manifest.id },
        displayName: manifest?.displayName ?? contribution.path,
        ...manifest === void 0 ? {} : { contract: manifest.contract.id, contractMajor: manifest.contract.major },
        extension: owner,
        origin: extension.origin,
        activationEligible: contribution.activationEligible,
        disabled: contribution.diagnostics.some((item) => item.code === CONTRIBUTION_DISABLED_CODE),
        extensionDisabled: contribution.diagnostics.some((item) => item.code === EXTENSION_DISABLED_CODE),
        path: contribution.path
      };
    });
  });
  return Object.freeze(rows.sort((left, right) => {
    const owner = compareUtf8(left.extension, right.extension);
    return owner === 0 ? compareUtf8(left.id ?? left.path, right.id ?? right.path) : owner;
  }));
}
function supportedExtensionHints(inventory) {
  return Object.freeze([
    ...new Set(inventory.extensions.flatMap((extension) => extension.contributions.flatMap((contribution) => {
      const manifest = contribution.manifest;
      if (manifest?.contract.id !== "modkit/codec-contribution")
        return [];
      const spec = manifest.spec;
      return Array.isArray(spec.match?.extensions) ? spec.match.extensions.flatMap((value) => typeof value === "string" && value.length > 0 ? [value.toLowerCase()] : []) : [];
    })))
  ].sort());
}
function createSubjectServices(options) {
  const fixed = {
    inventory: options.inventory,
    target: options.target,
    executionBackends: options.executionBackends,
    ...options.serviceDefinitions === void 0 ? {} : { serviceDefinitions: options.serviceDefinitions },
    ...options.policy === void 0 ? {} : { policy: options.policy },
    ...options.minimumConfidence === void 0 ? {} : { minimumConfidence: options.minimumConfidence },
    ...options.maxCandidates === void 0 ? {} : { maxCandidates: options.maxCandidates }
  };
  const services = {
    inventory: options.inventory,
    target: options.target,
    executionBackends: options.executionBackends,
    executionProfiles: options.executionBackends.profiles,
    supportedExtensions: supportedExtensionHints(options.inventory),
    ...options.serviceDefinitions === void 0 ? {} : { serviceDefinitions: options.serviceDefinitions },
    open: (request) => openSubject({ ...fixed, ...request })
  };
  return Object.freeze(services);
}
function createBundledServiceDefinitionRegistry(options = {}) {
  return createServiceContractDefinitionRegistry({
    matcherProfiles: createServiceFacetMatcherProfileRegistry([
      WRITER_FACET_MATCHER,
      LANGUAGE_DOCUMENT_MATCHER,
      RUNTIME_PROVIDER_MATCHER,
      SCENE_RENDERER_MATCHER,
      GAME_INSTALLATION_MATCHER,
      MOD_WORKSPACE_MATCHER,
      DATA_CATALOG_MATCHER,
      RESOLVED_DATA_WORKSPACE_MATCHER,
      MAP_SEMANTIC_MATCHER,
      MAP_PREVIEW_PREPARATION_MATCHER,
      ...options.matcherProfiles ?? []
    ]),
    isNamespaceOwner: () => true,
    validateJsonSchemaRef: () => []
  });
}
async function registerServiceDefinitionsOrThrow(inventory, definitions) {
  const editing = await registerStandardEditingDefinitions(definitions);
  const language = await registerStandardLanguageDefinitions(definitions);
  const runtime = await registerStandardRuntimeDefinitions(definitions);
  const renderer = await registerStandardRendererDefinitions(definitions);
  const games = await registerStandardGameDefinitions(definitions);
  const mods = await registerStandardModDefinitions(definitions);
  const data = await registerStandardDataDefinitions(definitions);
  const maps = await registerStandardMapDefinitions(definitions);
  const registrations = [
    editing,
    language,
    runtime,
    renderer,
    games,
    mods,
    data,
    maps,
    ...await registerServiceContractDefinitionsFromInventory(inventory, definitions)
  ];
  const rejected2 = registrations.filter((result) => result.state === "rejected");
  if (rejected2.length > 0) {
    const diagnostics = rejected2.flatMap((result) => result.diagnostics);
    throw new ModkitError({
      code: "x3.host/service-definition-rejected",
      message: `${rejected2.length} service contract definition owner(s) failed closed`,
      context: { diagnostics }
    });
  }
  return registrations;
}
function serviceDefinitionSurfaces(definitions) {
  return definitions.list().flatMap((registration) => registration.surface === void 0 ? [] : [
    {
      contract: registration.contract,
      major: registration.major,
      surface: registration.surface
    }
  ]);
}

// packages/host/dist/subject-rpc.js
var SUBJECT_SERVICES = Object.freeze({ contract: "x3.app/subject-services", major: 1 });
var SUBJECT_EDITING = Object.freeze({ contract: "x3.app/subject-editing", major: 1 });
var SUBJECT_SERVICES_URL = "x3-app://subject-services";
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
function subjectRpcSurfaces() {
  return createStandardSurfaceRegistry({
    surfaces: [subjectServicesSurface, subjectEditingSurface]
  });
}
var SUBJECT_RPC_LIMITS = protocolLimits({ defaultCallDeadlineMs: 6e4 });
function resolveFramePort(options) {
  if (options.framePort !== void 0)
    return options.framePort;
  if (options.port === void 0) {
    throw new TypeError("subject RPC needs either a port or a framePort");
  }
  return framePortFromMessagePort(options.port, options.listener === void 0 ? {} : { listener: options.listener });
}
function subjectOpenSnapshot(options) {
  const { result, diagnostics } = options;
  if (result.state === "unresolved") {
    return {
      state: "unresolved",
      reason: result.reason,
      candidates: result.candidates,
      diagnostics
    };
  }
  const descriptor = result.descriptor;
  const identity = descriptor["identity"];
  const formatId = typeof identity === "object" && identity !== null && typeof identity["formatId"] === "string" ? identity["formatId"] : void 0;
  const extensionId = result.selected.extensionId;
  const selectedRoute = extensionId === void 0 || extensionId.length === 0 || formatId === void 0 || formatId.length === 0 ? void 0 : [
    {
      formatId,
      extensionId,
      contributionId: result.selected.contributionId
    }
  ];
  return {
    state: "opened",
    sessionId: options.sessionId(),
    descriptor,
    selected: {
      ...extensionId === void 0 ? {} : { extensionId },
      contributionId: result.selected.contributionId,
      variantId: result.selected.variantId,
      confidence: result.selected.confidence
    },
    ...selectedRoute === void 0 ? {} : { selectedRoute },
    candidates: result.candidates,
    diagnostics
  };
}
function exposeSubjectRpc(options) {
  const moduleUrl = options.moduleUrl ?? SUBJECT_SERVICES_URL;
  const pending = /* @__PURE__ */ new Map();
  const services = {
    open: async (path, signal) => {
      if (typeof path !== "string" || path.length === 0 || path.length > 4096) {
        throw new TypeError("open(path) expects a non-empty path string");
      }
      const result = await options.open(path, signal);
      if (result.snapshot.state === "opened") {
        if (result.session === void 0) {
          throw new TypeError("an opened snapshot must carry its session");
        }
        pending.set(result.snapshot.sessionId, result.session);
      }
      return result.snapshot;
    },
    attach: async (sessionId) => {
      const session = typeof sessionId === "string" ? pending.get(sessionId) : void 0;
      if (session === void 0) {
        throw new TypeError("subject session is unavailable (already attached or never opened)");
      }
      pending.delete(sessionId);
      let disposed = false;
      return {
        value: session,
        release: async () => {
          if (disposed)
            return;
          disposed = true;
          await session.dispose();
        }
      };
    },
    edit: async (sessionId) => {
      const editing = typeof sessionId === "string" ? options.editing?.(sessionId) : void 0;
      if (editing === void 0) {
        throw new TypeError("this subject is not editable in this host");
      }
      const prepared = /* @__PURE__ */ new Map();
      let sequence = 0;
      const arm = {
        state: () => ({
          revision: editing.revision,
          targets: editing.targets
        }),
        propose: async (change, signal) => {
          if (editing.session === void 0) {
            throw new TypeError("this subject has no writer, so a change cannot be validated");
          }
          void signal;
          return editing.session.propose(change);
        },
        plan: async (change, signal) => {
          if (editing.session === void 0) {
            throw new TypeError("this subject has no writer, so a change cannot be planned");
          }
          void signal;
          return editing.session.plan(change);
        },
        prepare: async (plan, signal) => {
          const validated = editing.planFromOperation({
            kind: "edit-plan",
            plan
          });
          const result = await editing.coordinator.prepare(validated, {
            grant: editing.grantSnapshot,
            ...signal === void 0 ? {} : { signal }
          });
          if (result.state === "ready") {
            sequence += 1;
            const preparedId = `prepared-${sequence}`;
            prepared.set(preparedId, result.prepared);
            return { state: "ready", preparedId };
          }
          if (result.state === "conflict")
            return { state: "conflict", conflicts: result.conflicts };
          return { state: "rejected", reason: result.reason, diagnostics: result.diagnostics };
        },
        commit: async (preparedId, signal) => {
          const found = typeof preparedId === "string" ? prepared.get(preparedId) : void 0;
          if (found === void 0) {
            throw new TypeError("unknown prepared commit (already committed, or never prepared)");
          }
          prepared.delete(preparedId);
          const result = await editing.coordinator.commit(found, {
            grant: editing.grantSnapshot,
            ...signal === void 0 ? {} : { signal }
          });
          if (result.state === "not-applied") {
            return { state: "not-applied", reason: result.reason, diagnostics: result.diagnostics };
          }
          return { state: result.state, receipt: result.receipt };
        },
        dispose: async () => {
          prepared.clear();
          await editing.session?.dispose();
        }
      };
      let released = false;
      return {
        value: arm,
        release: async () => {
          if (released)
            return;
          released = true;
          await arm.dispose();
        }
      };
    }
  };
  const endpoint = createEndpoint({
    role: "worker",
    port: resolveFramePort(options),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectRpcSurfaces(),
    limits: SUBJECT_RPC_LIMITS,
    loader: async (request) => {
      if (request.moduleUrl !== moduleUrl) {
        throw new TypeError("the subject-services endpoint serves exactly one module");
      }
      return { module: services, surface: SUBJECT_SERVICES, release: () => void 0 };
    },
    ...options.onDiagnostic === void 0 ? {} : {
      onDiagnostic: (diagnostic3) => options.onDiagnostic?.(diagnostic3)
    },
    onFailure: (failure2) => {
      options.onDiagnostic?.({
        code: "x3.app/subject-rpc-failed",
        message: `${failure2.code}: ${failure2.message}`
      });
    }
  });
  let closed = false;
  return {
    endpoint,
    async close(reason) {
      if (closed)
        return;
      closed = true;
      await endpoint.close(reason);
      const orphans = [...pending.values()];
      pending.clear();
      await Promise.allSettled(orphans.map((session) => session.dispose()));
    }
  };
}
async function connectSubjectRpc(options) {
  const endpoint = createEndpoint({
    role: "host",
    port: resolveFramePort(options),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectRpcSurfaces(),
    limits: SUBJECT_RPC_LIMITS,
    ...options.onDiagnostic === void 0 ? {} : {
      onDiagnostic: (diagnostic3) => options.onDiagnostic?.(diagnostic3)
    },
    onFailure: (failure2) => {
      options.onDiagnostic?.({
        code: "x3.app/subject-rpc-failed",
        message: `${failure2.code}: ${failure2.message}`
      });
    }
  });
  const loaded = await endpoint.load({
    moduleUrl: options.moduleUrl ?? SUBJECT_SERVICES_URL,
    contributionId: options.contributionId ?? "modkit.app/subject-services",
    variantId: "main",
    artifactDigest: "sha256:app-composition"
  });
  const services = endpoint.materialize(loaded.root);
  return {
    async open(path) {
      const snapshot2 = await services.open(path);
      if (snapshot2.state !== "opened")
        return { state: "unresolved", snapshot: snapshot2 };
      const proxy = await services.attach(snapshot2.sessionId);
      const session = {
        ...snapshot2.presentation === void 0 ? {} : { presentation: snapshot2.presentation },
        // the descriptor already crossed inside the snapshot; asking again would re-run the codec
        descriptor: async () => snapshot2.descriptor,
        dataSource: (contract, major) => proxy.dataSource(contract, major),
        operations: () => proxy.operations(),
        dispose: () => proxy.dispose()
      };
      return { state: "opened", snapshot: snapshot2, session };
    },
    edit: (sessionId) => services.edit(sessionId),
    close: (reason) => endpoint.close(reason)
  };
}

// packages/host/dist/editing-evidence.js
var HOST_RAW_WRITER_IDENTITY = Object.freeze({
  providerId: "modkit.host/raw-writer",
  providerVersion: "1.0.0",
  artifactDigest: "host:raw-writer",
  formatId: "*",
  representationId: "source"
});
var RAW_CLAIM = Object.freeze({
  roundTrip: "byte-identical",
  preservesUnknownData: true
});
function isRangeReplace(edit) {
  return edit.operation === "replace" && edit.range !== void 0;
}
function createRawWriter(options = {}) {
  const allowWholeSource = options.allowWholeSource ?? true;
  const identity = Object.freeze({
    ...HOST_RAW_WRITER_IDENTITY,
    ...options.formatId === void 0 ? {} : { formatId: options.formatId },
    ...options.representationId === void 0 ? {} : { representationId: options.representationId }
  });
  const offer = Object.freeze({
    providerId: identity.providerId,
    fidelityEvidenceId: HOST_RAW_WRITER_EVIDENCE_ID,
    formatId: identity.formatId,
    representationId: identity.representationId,
    mutationMode: "mutate",
    minimumRoundTrip: "byte-identical"
  });
  const check = (change) => {
    const targets = new Set(change.targets.map((target) => target.targetId));
    const problems = [];
    if (change.targets.length === 0 || change.edits.length === 0) {
      problems.push(diagnostic("error", "x3.host/raw-writer-empty", "a change set needs a target and an edit"));
    }
    for (const edit of change.edits) {
      if (edit.operation !== "replace") {
        problems.push(diagnostic("error", "x3.host/raw-writer-operation-unsupported", `the raw writer plans replacements only; \xAB${edit.operation}\xBB needs a format writer`));
        continue;
      }
      if (!targets.has(edit.targetId)) {
        problems.push(diagnostic("error", "x3.host/raw-writer-unknown-target", `edit names target \xAB${edit.targetId}\xBB, which this change set does not declare`));
      }
      if (!allowWholeSource && !isRangeReplace(edit)) {
        problems.push(diagnostic("error", "x3.host/raw-writer-whole-source-refused", "this host allows range edits only: a whole-source replace from a bounded editor can drop what it never loaded"));
      }
    }
    return { valid: problems.length === 0, diagnostics: Object.freeze(problems) };
  };
  return Object.freeze({
    identity,
    offer,
    async validate(change) {
      return check(change);
    },
    async plan(change) {
      const validation = check(change);
      if (!validation.valid) {
        return Object.freeze({
          planId: "raw-writer:refused",
          targets: Object.freeze([]),
          edits: Object.freeze([]),
          semantics: Object.freeze({ mutationMode: "mutate", minimumGuarantee: "atomic" }),
          fidelity: RAW_CLAIM,
          diagnostics: validation.diagnostics
        });
      }
      return Object.freeze({
        planId: options.planId?.(change) ?? `raw-writer:${change.targets.map((target) => target.targetId).join("+")}`,
        targets: change.targets,
        edits: change.edits,
        semantics: Object.freeze({ mutationMode: "mutate", minimumGuarantee: "atomic" }),
        fidelity: RAW_CLAIM,
        diagnostics: Object.freeze([])
      });
    }
  });
}
var HOST_RAW_WRITER_EVIDENCE_ID = "host:raw-writer/by-construction";
function codecFidelityEvidenceRecords(inventory, selection) {
  const accepted = new Set(selection.acceptedOrigins ?? ["bundled"]);
  const records = [];
  for (const extension of inventory.extensions) {
    if (!accepted.has(extension.origin))
      continue;
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest;
      const inventoryRecord = contribution.record;
      if (!contribution.activationEligible || manifest === void 0 || inventoryRecord === void 0 || manifest.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1 || manifest.id !== selection.codecId) {
        continue;
      }
      const spec = manifest.spec;
      for (const declaration of spec.fidelityEvidence ?? []) {
        if (declaration.formatId !== selection.formatId)
          continue;
        records.push(Object.freeze({
          writer: Object.freeze({
            providerId: manifest.id,
            providerVersion: extension.manifest.version,
            artifactDigest: inventoryRecord.artifactDigest,
            formatId: declaration.formatId,
            representationId: declaration.representationId
          }),
          claim: Object.freeze({
            ...declaration.claim,
            ...declaration.claim.notes === void 0 ? {} : { notes: Object.freeze([...declaration.claim.notes]) }
          }),
          evidenceId: declaration.evidenceId,
          corpusId: declaration.corpusId,
          corpusDigest: declaration.corpusDigest,
          conformanceProfile: declaration.conformanceProfile,
          optionsFingerprint: declaration.optionsFingerprint,
          inputClass: declaration.inputClass,
          provenAt: declaration.provenAt
        }));
      }
    }
  }
  return Object.freeze(records);
}
function writerFacet(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function sameWriterIdentity(left, right) {
  return left.providerId === right.providerId && left.providerVersion === right.providerVersion && left.artifactDigest === right.artifactDigest && left.formatId === right.formatId && left.representationId === right.representationId;
}
function serviceProviderFidelityEvidenceRecord(inventory, selection) {
  const accepted = new Set(selection.acceptedOrigins ?? ["bundled"]);
  const { identity, offer: selectedOffer } = selection.writer;
  if (identity.providerId !== selectedOffer.providerId || identity.formatId !== selectedOffer.formatId || identity.representationId !== selectedOffer.representationId) {
    return void 0;
  }
  const matches = [];
  for (const extension of inventory.extensions) {
    if (!accepted.has(extension.origin) || extension.manifest.version !== identity.providerVersion) {
      continue;
    }
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest;
      const publicRecord = contribution.record;
      const privateRecord = inventoryRecordFor(contribution);
      if (!contribution.activationEligible || manifest === void 0 || publicRecord === void 0 || privateRecord === void 0 || privateRecord.publicRecord !== publicRecord || publicRecord.artifactDigest !== identity.artifactDigest || manifest.contract.id !== SERVICE_PROVIDER_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1 || manifest.id !== identity.providerId) {
        continue;
      }
      const spec = manifest.spec;
      const offers = spec.provides.filter((candidate) => {
        if (candidate.contract !== "common.edit/writer" || candidate.major !== 1 || selection.offerId !== void 0 && candidate.offerId !== selection.offerId) {
          return false;
        }
        const facet = writerFacet(candidate.facet);
        return facet?.providerId === identity.providerId && facet.fidelityEvidenceId === selectedOffer.fidelityEvidenceId && facet.formatId === identity.formatId && facet.representationId === identity.representationId && facet.mutationMode === selectedOffer.mutationMode && facet.minimumRoundTrip === selectedOffer.minimumRoundTrip;
      });
      if (offers.length !== 1)
        continue;
      const logicalOffer = offers[0];
      if (logicalOffer === void 0)
        continue;
      const declarations = (spec.fidelityEvidence ?? []).filter((declaration2) => declaration2.offerId === logicalOffer.offerId && declaration2.evidenceId === selectedOffer.fidelityEvidenceId && declaration2.claim.roundTrip === selectedOffer.minimumRoundTrip);
      if (declarations.length !== 1)
        continue;
      const declaration = declarations[0];
      if (declaration === void 0)
        continue;
      matches.push(Object.freeze({
        writer: Object.freeze({ ...identity }),
        claim: Object.freeze({
          ...declaration.claim,
          ...declaration.claim.notes === void 0 ? {} : { notes: Object.freeze([...declaration.claim.notes]) }
        }),
        evidenceId: declaration.evidenceId,
        corpusId: declaration.corpusId,
        corpusDigest: declaration.corpusDigest,
        conformanceProfile: declaration.conformanceProfile,
        optionsFingerprint: declaration.optionsFingerprint,
        inputClass: declaration.inputClass,
        provenAt: declaration.provenAt
      }));
    }
  }
  return matches.length === 1 ? matches[0] : void 0;
}
var HOST_RAW_WRITER_EVIDENCE_RECORD = Object.freeze({
  writer: HOST_RAW_WRITER_IDENTITY,
  claim: RAW_CLAIM,
  evidenceId: HOST_RAW_WRITER_EVIDENCE_ID,
  corpusId: "by-construction: literal replacement, no re-encoding",
  corpusDigest: "none:by-construction",
  conformanceProfile: "modkit/raw-writer-v1",
  optionsFingerprint: "options:none",
  inputClass: "any",
  provenAt: "2026-08-19T00:00:00Z"
});
function evidenceOf(record) {
  return Object.freeze({
    ...record.claim,
    evidenceId: record.evidenceId,
    corpusId: record.corpusId,
    corpusDigest: record.corpusDigest,
    conformanceProfile: record.conformanceProfile,
    writer: record.writer,
    optionsFingerprint: record.optionsFingerprint,
    inputClass: record.inputClass,
    provenAt: record.provenAt
  });
}
var sameClaim = (left, right) => left.roundTrip === right.roundTrip && left.preservesUnknownData === right.preservesUnknownData;
function createEvidenceRegistry(records = [HOST_RAW_WRITER_EVIDENCE_RECORD]) {
  const own = Object.freeze([...records]);
  const registry = {
    evidenceFor(plan, expectedWriter) {
      const record = own.find((item) => sameClaim(item.claim, plan.fidelity) && (expectedWriter === void 0 || sameWriterIdentity(item.writer, expectedWriter)));
      return record === void 0 ? void 0 : evidenceOf(record);
    },
    list: () => own,
    with: (record) => createEvidenceRegistry([record, ...own])
  };
  return Object.freeze(registry);
}

// packages/host/dist/editing.js
var GUARANTEE_STRENGTH = Object.freeze({
  "best-effort": 0,
  recoverable: 1,
  transactional: 2,
  atomic: 3
});
var issuedGrantSnapshots = /* @__PURE__ */ new WeakSet();
function snapshot(value, ancestors = /* @__PURE__ */ new WeakSet()) {
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("editing inputs cannot contain executable or symbol values");
  }
  if (value instanceof Uint8Array)
    return value.slice();
  if (Array.isArray(value)) {
    if (ancestors.has(value))
      throw new TypeError("editing inputs must be acyclic owned data");
    ancestors.add(value);
    const copy = Object.freeze(value.map((item) => snapshot(item, ancestors)));
    ancestors.delete(value);
    return copy;
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value))
      throw new TypeError("editing inputs must be acyclic owned data");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("editing inputs must contain only plain owned data");
    }
    ancestors.add(value);
    const copy = {};
    for (const key2 of Reflect.ownKeys(value)) {
      copy[key2] = snapshot(value[key2], ancestors);
    }
    ancestors.delete(value);
    return Object.freeze(copy);
  }
  return value;
}
function snapshotGrant(grant) {
  if (!issuedGrantSnapshots.has(grant))
    throw new TypeError("grant snapshot is not host-issued");
  return Object.freeze({
    snapshotId: String(grant.snapshotId),
    permissions: Object.freeze([...grant.permissions]),
    sourceIds: Object.freeze([...grant.sourceIds])
  });
}
function grantIsValid(options, grant) {
  try {
    return options.isGrantValid(grant) === true;
  } catch {
    return false;
  }
}
function createGrantSnapshot(value) {
  if (!isNonBlank(value.snapshotId) || !Array.isArray(value.permissions) || !value.permissions.every((permission) => PERMISSION_CLASSES.includes(permission)) || !Array.isArray(value.sourceIds) || !value.sourceIds.every(isNonBlank)) {
    throw new TypeError("grant snapshot is malformed");
  }
  const snapshot2 = Object.freeze({
    snapshotId: value.snapshotId,
    permissions: Object.freeze([...new Set(value.permissions)].sort(compareUtf8)),
    sourceIds: Object.freeze([...new Set(value.sourceIds)].sort(compareUtf8))
  });
  issuedGrantSnapshots.add(snapshot2);
  return snapshot2;
}
function revisionValue(revision) {
  return {
    bindings: Object.fromEntries(Object.entries(revision.bindings).sort(([left], [right]) => compareUtf8(left, right)).map(([key2, value]) => [key2, String(value)])),
    ...revision.namespaceRevision === void 0 ? {} : { namespaceRevision: String(revision.namespaceRevision) },
    compositionFingerprint: revision.compositionFingerprint
  };
}
function sameRevision(left, right) {
  return JSON.stringify(revisionValue(left)) === JSON.stringify(revisionValue(right));
}
function revisionFingerprint(targets, digest) {
  return digest(targets.map((target) => ({
    targetId: target.targetId,
    revision: revisionValue(target.expectedRevision)
  })).sort((left, right) => compareUtf8(left.targetId, right.targetId)));
}
function normalizedPath(value) {
  if (value.trim() === "" || value.includes("\\") || value.startsWith("/"))
    return void 0;
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    return void 0;
  return parts.join("/");
}
function modeOf(edit) {
  if (edit.operation === "replace")
    return "in-place";
  return edit.operation;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value, allowed2) {
  const keys = Object.keys(value);
  return keys.length === new Set(keys).size && keys.every((key2) => allowed2.includes(key2));
}
function isNonBlank(value) {
  return typeof value === "string" && value.trim() !== "";
}
function isAssetSource(value) {
  return isRecord(value) && hasExactKeys(value, ["id", "uri", "parentIds"]) && isNonBlank(value["id"]) && isNonBlank(value["uri"]) && (value["parentIds"] === void 0 || Array.isArray(value["parentIds"]) && value["parentIds"].every(isNonBlank));
}
function isRevision(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["bindings", "namespaceRevision", "compositionFingerprint"]) || !isRecord(value["bindings"]) || Object.keys(value["bindings"]).length === 0 || !Object.values(value["bindings"]).every(isNonBlank) || !isNonBlank(value["compositionFingerprint"])) {
    return false;
  }
  return value["namespaceRevision"] === void 0 || isNonBlank(value["namespaceRevision"]);
}
function isRecoveryRef(value) {
  return isRecord(value) && hasExactKeys(value, ["kind", "ref", "digest"]) && (value["kind"] === "journal" || value["kind"] === "staging") && isNonBlank(value["ref"]) && isNonBlank(value["digest"]);
}
function isFidelityEvidence(value) {
  if (!isRecord(value) || !hasExactKeys(value, [
    "roundTrip",
    "preservesUnknownData",
    "notes",
    "evidenceId",
    "corpusId",
    "corpusDigest",
    "conformanceProfile",
    "writer",
    "optionsFingerprint",
    "inputClass",
    "provenAt"
  ]) || !["byte-identical", "semantic", "lossy", "none"].includes(value["roundTrip"]) || typeof value["preservesUnknownData"] !== "boolean" || value["notes"] !== void 0 && (!Array.isArray(value["notes"]) || !value["notes"].every(isNonBlank)) || ![
    value["evidenceId"],
    value["corpusId"],
    value["corpusDigest"],
    value["conformanceProfile"],
    value["optionsFingerprint"],
    value["inputClass"],
    value["provenAt"]
  ].every(isNonBlank) || !isRecord(value["writer"]) || !hasExactKeys(value["writer"], [
    "providerId",
    "providerVersion",
    "artifactDigest",
    "formatId",
    "representationId"
  ]) || !Object.values(value["writer"]).every(isNonBlank)) {
    return false;
  }
  if (value["roundTrip"] === "byte-identical")
    return value["preservesUnknownData"] === true;
  if (value["roundTrip"] === "lossy" || value["roundTrip"] === "none") {
    return value["preservesUnknownData"] === false;
  }
  return true;
}
function isEditPayload(value) {
  if (!isRecord(value) || !isNonBlank(value["kind"]))
    return false;
  if (value["kind"] === "text") {
    return hasExactKeys(value, ["kind", "text"]) && typeof value["text"] === "string";
  }
  if (value["kind"] === "inline") {
    return hasExactKeys(value, ["kind", "bytes"]) && value["bytes"] instanceof Uint8Array;
  }
  if (value["kind"] !== "staged" || !hasExactKeys(value, ["kind", "ref"]))
    return false;
  const ref = value["ref"];
  return isRecord(ref) && hasExactKeys(ref, ["storeId", "handleId", "digest", "bytes", "replayable", "expiresAt"]) && isNonBlank(ref["storeId"]) && isNonBlank(ref["handleId"]) && isNonBlank(ref["digest"]) && typeof ref["bytes"] === "bigint" && ref["bytes"] >= 0n && ref["replayable"] === true && (ref["expiresAt"] === void 0 || isNonBlank(ref["expiresAt"]));
}
function isEditRange(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "offset", "length"]))
    return false;
  if (value["kind"] === "bytes") {
    return typeof value["offset"] === "bigint" && value["offset"] >= 0n && typeof value["length"] === "bigint" && value["length"] >= 0n;
  }
  return value["kind"] === "utf16" && Number.isSafeInteger(value["offset"]) && Number.isSafeInteger(value["length"]) && value["offset"] >= 0 && value["length"] >= 0;
}
function isSourceEdit(value) {
  if (!isRecord(value) || !isNonBlank(value["operation"]))
    return false;
  const common = isNonBlank(value["targetId"]) && isAssetSource(value["source"]) && (value["label"] === void 0 || typeof value["label"] === "string");
  if (!common)
    return false;
  if (value["operation"] === "replace") {
    return hasExactKeys(value, ["operation", "targetId", "source", "range", "payload", "label"]) && (value["range"] === void 0 || isEditRange(value["range"])) && isEditPayload(value["payload"]);
  }
  if (value["operation"] === "create") {
    return hasExactKeys(value, ["operation", "targetId", "source", "newPath", "payload", "label"]) && isNonBlank(value["newPath"]) && isEditPayload(value["payload"]);
  }
  if (value["operation"] === "delete") {
    return hasExactKeys(value, ["operation", "targetId", "source", "label"]);
  }
  return value["operation"] === "rename" && hasExactKeys(value, ["operation", "targetId", "source", "newPath", "label"]) && isNonBlank(value["newPath"]);
}
function planDigestValue(plan) {
  const payload = (edit) => {
    if (!("payload" in edit))
      return void 0;
    if (edit.payload.kind === "inline") {
      return { kind: "inline", bytes: [...edit.payload.bytes] };
    }
    if (edit.payload.kind === "staged") {
      return {
        kind: "staged",
        ref: { ...edit.payload.ref, bytes: edit.payload.ref.bytes.toString(10) }
      };
    }
    return edit.payload;
  };
  return {
    planId: plan.planId,
    targets: plan.targets.map((target) => ({
      ...target,
      expectedRevision: revisionValue(target.expectedRevision)
    })),
    edits: plan.edits.map((edit) => ({
      ...edit,
      ...edit.operation === "replace" && edit.range?.kind === "bytes" ? {
        range: {
          kind: "bytes",
          offset: edit.range.offset.toString(10),
          length: edit.range.length.toString(10)
        }
      } : {},
      ...payload(edit) === void 0 ? {} : { payload: payload(edit) }
    })),
    semantics: plan.semantics,
    fidelity: plan.fidelity,
    diagnostics: plan.diagnostics
  };
}
function fidelityMatches(plan, evidence2, expectedWriter, expectedContext) {
  if (!isFidelityEvidence(evidence2) || evidence2.roundTrip !== plan.fidelity.roundTrip)
    return false;
  if (evidence2.preservesUnknownData !== plan.fidelity.preservesUnknownData)
    return false;
  if (expectedContext !== void 0 && (evidence2.optionsFingerprint !== expectedContext.optionsFingerprint || evidence2.inputClass !== expectedContext.inputClass)) {
    return false;
  }
  if (expectedWriter === void 0)
    return true;
  return evidence2.writer.providerId === expectedWriter.providerId && evidence2.writer.providerVersion === expectedWriter.providerVersion && evidence2.writer.artifactDigest === expectedWriter.artifactDigest && evidence2.writer.formatId === expectedWriter.formatId && evidence2.writer.representationId === expectedWriter.representationId;
}
function strongestGuarantee(backends) {
  const unique = new Set(backends);
  const single = [...unique][0];
  if (unique.size === 1 && single !== void 0 && single.profile.guarantees.includes("atomic") && single.applyBatch !== void 0) {
    return "atomic";
  }
  if (backends.every((backend) => backend.profile.supportsPrepare && backend.profile.supportsRollback)) {
    return "transactional";
  }
  if (backends.every((backend) => backend.profile.supportsJournal))
    return "recoverable";
  return "best-effort";
}
function derive(plan, targets, grant, options) {
  const entries = [];
  const backends = /* @__PURE__ */ new Map();
  for (const edit of plan.edits) {
    const target = targets.get(edit.targetId);
    const backend = options.backendFor(edit.source.id);
    if (target === void 0 || backend === void 0 || target.ownerSource.id !== edit.source.id) {
      return { rejection: "plan-invalid" };
    }
    if (!backend.writable && plan.semantics.mutationMode === "mutate") {
      return { rejection: "source-read-only" };
    }
    if (edit.operation === "rename" && !backend.profile.supportsRename) {
      return { rejection: "plan-invalid" };
    }
    const path = edit.operation === "create" || edit.operation === "rename" ? normalizedPath(edit.newPath) : void 0;
    if ((edit.operation === "create" || edit.operation === "rename") && path === void 0) {
      return { rejection: "plan-invalid" };
    }
    entries.push(Object.freeze({
      targetId: edit.targetId,
      source: snapshot(edit.source),
      backendId: backend.profile.backendId,
      mode: modeOf(edit),
      ...path === void 0 ? {} : { normalizedPath: path }
    }));
    backends.set(edit.targetId, backend);
  }
  entries.sort((left, right) => compareUtf8(left.targetId, right.targetId) || compareUtf8(left.source.id, right.source.id) || compareUtf8(left.mode, right.mode));
  const requiredPermissions = plan.semantics.mutationMode === "mutate" ? ["write-source"] : [];
  const missing = requiredPermissions.filter((permission) => !grant.permissions.includes(permission));
  const scopeSatisfied = entries.every((entry2) => grant.sourceIds.includes(entry2.source.id));
  const achievableGuarantee = strongestGuarantee([...backends.values()]);
  const writeSet = Object.freeze({
    entries: Object.freeze(entries),
    digest: options.digest(entries.map((entry2) => ({
      targetId: entry2.targetId,
      sourceId: entry2.source.id,
      backendId: entry2.backendId,
      mode: entry2.mode,
      ...entry2.normalizedPath === void 0 ? {} : { normalizedPath: entry2.normalizedPath }
    })))
  });
  return {
    writeSet,
    backends,
    authorization: Object.freeze({
      requiredPermissions: Object.freeze(requiredPermissions),
      granted: missing.length === 0 && scopeSatisfied,
      achievableGuarantee,
      missing: Object.freeze(missing),
      scopeSatisfied
    })
  };
}
async function conflictsFor(targets, backends, signal) {
  const conflicts = [];
  for (const [targetId, target] of targets) {
    const backend = backends.get(targetId);
    if (backend === void 0)
      continue;
    const actual = snapshot(await backend.currentRevision(target, signal));
    if (!sameRevision(target.expectedRevision, actual)) {
      conflicts.push(Object.freeze({
        targetId,
        expected: snapshot(target.expectedRevision),
        actual: snapshot(actual)
      }));
    }
  }
  return Object.freeze(conflicts.sort((left, right) => compareUtf8(left.targetId, right.targetId)));
}
async function payloadsAvailable(plan, options, signal) {
  const maximum = options.maxInlinePayloadBytes ?? 1024 * 1024;
  for (const edit of plan.edits) {
    if (!("payload" in edit))
      continue;
    if (edit.payload.kind === "inline" && edit.payload.bytes.byteLength > maximum)
      return false;
    if (edit.payload.kind === "text" && new TextEncoder().encode(edit.payload.text).byteLength > maximum)
      return false;
    if (edit.payload.kind !== "staged")
      continue;
    if (!edit.payload.ref.replayable || edit.payload.ref.bytes < 0n)
      return false;
    if (edit.payload.ref.expiresAt !== void 0 && Date.parse(edit.payload.ref.expiresAt) <= Date.parse(options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString())) {
      return false;
    }
    if (options.verifyStagedPayload === void 0)
      return false;
    try {
      if (await options.verifyStagedPayload(edit.payload.ref, signal) !== true)
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
function invalidPlan(plan) {
  if (!isRecord(plan) || !hasExactKeys(plan, ["planId", "targets", "edits", "semantics", "fidelity", "diagnostics"]) || !isNonBlank(plan.planId) || !Array.isArray(plan.targets) || plan.targets.length === 0 || !Array.isArray(plan.edits) || plan.edits.length === 0 || !Array.isArray(plan.diagnostics) || !isRecord(plan.semantics) || !hasExactKeys(plan.semantics, ["mutationMode", "minimumGuarantee"]) || !["export-only", "mutate"].includes(plan.semantics.mutationMode) || !["atomic", "transactional", "recoverable", "best-effort"].includes(plan.semantics.minimumGuarantee) || !isRecord(plan.fidelity) || !hasExactKeys(plan.fidelity, ["roundTrip", "preservesUnknownData", "notes"]) || !["byte-identical", "semantic", "lossy", "none"].includes(plan.fidelity.roundTrip) || typeof plan.fidelity.preservesUnknownData !== "boolean" || plan.fidelity.notes !== void 0 && (!Array.isArray(plan.fidelity.notes) || !plan.fidelity.notes.every(isNonBlank)) || plan.fidelity.roundTrip === "byte-identical" && plan.fidelity.preservesUnknownData !== true || (plan.fidelity.roundTrip === "lossy" || plan.fidelity.roundTrip === "none") && plan.fidelity.preservesUnknownData !== false) {
    return true;
  }
  const ids = /* @__PURE__ */ new Set();
  for (const target of plan.targets) {
    if (!isRecord(target) || !hasExactKeys(target, [
      "targetId",
      "subjectUri",
      "ownerSource",
      "semanticPath",
      "expectedRevision"
    ]) || !isNonBlank(target.targetId) || ids.has(target.targetId) || !isNonBlank(target.subjectUri) || !isAssetSource(target.ownerSource) || !Array.isArray(target.semanticPath) || !target.semanticPath.every(isNonBlank) || !isRevision(target.expectedRevision)) {
      return true;
    }
    ids.add(target.targetId);
  }
  const editedIds = /* @__PURE__ */ new Set();
  for (const edit of plan.edits) {
    if (!isSourceEdit(edit) || !ids.has(edit.targetId))
      return true;
    editedIds.add(edit.targetId);
    if ((edit.operation === "create" || edit.operation === "delete" || edit.operation === "rename") && plan.targets.find((target) => target.targetId === edit.targetId)?.expectedRevision.namespaceRevision === void 0) {
      return true;
    }
  }
  return editedIds.size !== ids.size || [...ids].some((id) => !editedIds.has(id));
}
function createCommitCoordinator(options) {
  options = Object.freeze({
    ...options,
    payloads: Object.freeze({ open: options.payloads.open.bind(options.payloads) }),
    ...options.expectedWriter === void 0 ? {} : { expectedWriter: snapshot(options.expectedWriter) },
    ...options.expectedEvidenceContext === void 0 ? {} : { expectedEvidenceContext: snapshot(options.expectedEvidenceContext) }
  });
  let serial = 0;
  const nextId = (kind) => options.nextId?.(kind) ?? `${kind}-${String(++serial).padStart(6, "0")}`;
  const preparedInputs = /* @__PURE__ */ new WeakMap();
  const history = /* @__PURE__ */ new Map();
  const prepare = async (authoredPlan, prepareOptions) => {
    if (prepareOptions.signal?.aborted) {
      return { state: "rejected", reason: "cancelled", diagnostics: [] };
    }
    let grant;
    let plan;
    try {
      grant = snapshotGrant(prepareOptions.grant);
      plan = snapshot(authoredPlan);
    } catch {
      return { state: "rejected", reason: "plan-invalid", diagnostics: [] };
    }
    if (!grantIsValid(options, grant) || invalidPlan(plan)) {
      return { state: "rejected", reason: "plan-invalid", diagnostics: [] };
    }
    const targetMap = new Map(plan.targets.map((target) => [target.targetId, target]));
    let derived;
    try {
      derived = derive(plan, targetMap, grant, options);
    } catch {
      return { state: "rejected", reason: "plan-invalid", diagnostics: [] };
    }
    if ("rejection" in derived) {
      return { state: "rejected", reason: derived.rejection, diagnostics: [] };
    }
    if (!derived.authorization.scopeSatisfied) {
      return { state: "rejected", reason: "write-scope-mismatch", diagnostics: [] };
    }
    if (derived.authorization.missing.length > 0) {
      return { state: "rejected", reason: "permission-missing", diagnostics: [] };
    }
    if (GUARANTEE_STRENGTH[derived.authorization.achievableGuarantee] < GUARANTEE_STRENGTH[plan.semantics.minimumGuarantee]) {
      return { state: "rejected", reason: "guarantee-unachievable", diagnostics: [] };
    }
    const canPartiallyApply = plan.edits.length > 1 && derived.authorization.achievableGuarantee !== "atomic";
    if (canPartiallyApply && options.createRecovery === void 0) {
      return { state: "rejected", reason: "guarantee-unachievable", diagnostics: [] };
    }
    let fidelity;
    try {
      fidelity = options.evidenceFor(plan);
    } catch {
      fidelity = void 0;
    }
    let proven = false;
    try {
      proven = fidelityMatches(plan, fidelity, options.expectedWriter, options.expectedEvidenceContext);
    } catch {
      proven = false;
    }
    if (!proven) {
      const pinned = options.expectedWriter !== void 0 && fidelity !== void 0 && fidelity.writer.providerId !== options.expectedWriter.providerId;
      return {
        state: "rejected",
        reason: "fidelity-unproven",
        diagnostics: [
          {
            severity: "error",
            code: pinned ? "x3.host/fidelity-writer-pinned" : "x3.host/fidelity-evidence-missing",
            message: pinned ? `this host pinned writes to \xAB${options.expectedWriter?.providerId}\xBB, and this plan came from \xAB${fidelity?.writer.providerId}\xBB` : `no fidelity evidence covers ${plan.fidelity.roundTrip}/preservesUnknownData=${String(plan.fidelity.preservesUnknownData)} for this plan`,
            path: []
          }
        ]
      };
    }
    if ((plan.fidelity.roundTrip === "lossy" || plan.fidelity.roundTrip === "none") && (prepareOptions.confirmationToken === void 0 || !(options.confirmationMatches?.(prepareOptions.confirmationToken, plan) ?? false))) {
      return { state: "rejected", reason: "confirmation-required", diagnostics: [] };
    }
    if (!await payloadsAvailable(plan, options, prepareOptions.signal)) {
      return { state: "rejected", reason: "payload-unavailable", diagnostics: [] };
    }
    let conflicts;
    try {
      conflicts = await conflictsFor(targetMap, derived.backends, prepareOptions.signal);
    } catch {
      return { state: "rejected", reason: "plan-invalid", diagnostics: [] };
    }
    if (conflicts.length > 0)
      return { state: "conflict", conflicts };
    let prepared;
    try {
      const planDigest = options.digest(planDigestValue(plan));
      prepared = Object.freeze({
        preparedId: nextId("prepared"),
        plan: snapshot(plan),
        planDigest,
        writeSet: derived.writeSet,
        authorization: derived.authorization,
        preparedRevisionFingerprint: revisionFingerprint(plan.targets, options.digest),
        fidelity: snapshot(fidelity)
      });
    } catch {
      return { state: "rejected", reason: "plan-invalid", diagnostics: [] };
    }
    const internal = Object.freeze({
      plan,
      targets: targetMap,
      backends: derived.backends,
      prepared,
      ...prepareOptions.confirmationToken === void 0 ? {} : { confirmationToken: prepareOptions.confirmationToken }
    });
    preparedInputs.set(prepared, internal);
    return { state: "ready", prepared };
  };
  const commit = async (publicPrepared, commitOptions) => {
    const internal = preparedInputs.get(publicPrepared);
    if (internal === void 0) {
      return { state: "not-applied", reason: "plan-invalid", diagnostics: [] };
    }
    if (commitOptions.signal?.aborted) {
      return { state: "not-applied", reason: "cancelled", diagnostics: [] };
    }
    let grant;
    try {
      grant = snapshotGrant(commitOptions.grant);
    } catch {
      return { state: "not-applied", reason: "permission-missing", diagnostics: [] };
    }
    if (!grantIsValid(options, grant)) {
      return { state: "not-applied", reason: "permission-missing", diagnostics: [] };
    }
    let fresh;
    try {
      fresh = derive(internal.plan, internal.targets, grant, options);
    } catch {
      return { state: "not-applied", reason: "plan-invalid", diagnostics: [] };
    }
    if ("rejection" in fresh) {
      return { state: "not-applied", reason: fresh.rejection, diagnostics: [] };
    }
    if (!fresh.authorization.scopeSatisfied) {
      return { state: "not-applied", reason: "write-scope-mismatch", diagnostics: [] };
    }
    if (fresh.authorization.missing.length > 0) {
      return { state: "not-applied", reason: "permission-missing", diagnostics: [] };
    }
    if (fresh.writeSet.digest !== internal.prepared.writeSet.digest || GUARANTEE_STRENGTH[fresh.authorization.achievableGuarantee] < GUARANTEE_STRENGTH[internal.plan.semantics.minimumGuarantee]) {
      return { state: "not-applied", reason: "guarantee-unachievable", diagnostics: [] };
    }
    if (!await payloadsAvailable(internal.plan, options, commitOptions.signal)) {
      return { state: "not-applied", reason: "payload-unavailable", diagnostics: [] };
    }
    let conflicts;
    try {
      conflicts = await conflictsFor(internal.targets, fresh.backends, commitOptions.signal);
    } catch {
      return { state: "not-applied", reason: "plan-invalid", diagnostics: [] };
    }
    if (conflicts.length > 0) {
      return {
        state: "not-applied",
        reason: "stale-revision",
        conflicts,
        diagnostics: []
      };
    }
    const transactionId = nextId("transaction");
    const before = internal.plan.targets.map((target) => snapshot(target.expectedRevision));
    const writes = [];
    const latestRevisions = new Map(internal.plan.targets.map((target) => [target.targetId, target.expectedRevision]));
    const finalRevisions = () => internal.plan.targets.map((target) => snapshot(latestRevisions.get(target.targetId) ?? target.expectedRevision));
    const applied = [];
    if (fresh.authorization.achievableGuarantee === "atomic") {
      const backend = [...new Set(fresh.backends.values())][0];
      if (backend?.applyBatch === void 0) {
        return { state: "not-applied", reason: "guarantee-unachievable", diagnostics: [] };
      }
      preparedInputs.delete(publicPrepared);
      try {
        const results = await backend.applyBatch(internal.plan.edits.map((edit) => ({
          edit,
          expectedRevision: latestRevisions.get(edit.targetId) ?? internal.targets.get(edit.targetId).expectedRevision
        })), {
          transactionId,
          payloads: options.payloads,
          ...commitOptions.signal === void 0 ? {} : { signal: commitOptions.signal }
        });
        if (results.length !== internal.plan.edits.length || results.some((result, index) => result.targetId !== internal.plan.edits[index]?.targetId)) {
          throw new TypeError("atomic backend returned a malformed write result");
        }
        results.forEach((result, index) => {
          const edit = internal.plan.edits[index];
          const stepBefore = latestRevisions.get(edit.targetId);
          latestRevisions.set(edit.targetId, snapshot(result.after));
          applied.push({ edit, backend, before: stepBefore });
          writes.push(Object.freeze({
            targetId: edit.targetId,
            source: snapshot(edit.source),
            state: "applied",
            diagnosticIds: Object.freeze([...result.diagnosticIds ?? []])
          }));
          commitOptions.onProgress?.(index + 1);
        });
      } catch (error3) {
        return {
          state: "not-applied",
          reason: commitOptions.signal?.aborted ? "cancelled" : "plan-invalid",
          diagnostics: [
            diagnostic("error", "x3.host/edit-write-failed", error3 instanceof Error ? error3.message : String(error3))
          ]
        };
      }
      const receipt2 = Object.freeze({
        transactionId,
        committedAt: options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
        mutationMode: internal.plan.semantics.mutationMode,
        commitGuarantee: "atomic",
        status: "committed",
        undo: backend.profile.supportsRollback && backend.rollback !== void 0 ? "snapshot" : "none",
        before: Object.freeze(before),
        after: Object.freeze(finalRevisions()),
        writes: Object.freeze(writes),
        fidelity: internal.prepared.fidelity
      });
      history.set(transactionId, {
        plan: internal.plan,
        prepared: internal,
        receipt: receipt2,
        steps: Object.freeze([...applied])
      });
      return {
        state: "committed",
        receipt: receipt2
      };
    }
    const needsRecovery = internal.plan.edits.length > 1;
    let recovery;
    try {
      recovery = needsRecovery ? await options.createRecovery?.(internal.prepared.preparedId, internal.prepared.planDigest) : void 0;
    } catch {
      return { state: "not-applied", reason: "guarantee-unachievable", diagnostics: [] };
    }
    if (needsRecovery && !isRecoveryRef(recovery)) {
      return { state: "not-applied", reason: "guarantee-unachievable", diagnostics: [] };
    }
    if (recovery !== void 0)
      recovery = snapshot(recovery);
    preparedInputs.delete(publicPrepared);
    for (let index = 0; index < internal.plan.edits.length; index += 1) {
      const edit = internal.plan.edits[index];
      const backend = fresh.backends.get(edit.targetId);
      const target = internal.targets.get(edit.targetId);
      const expectedRevision = latestRevisions.get(edit.targetId) ?? target.expectedRevision;
      try {
        const result = await backend.apply(edit, {
          transactionId,
          payloads: options.payloads,
          expectedRevision,
          ...commitOptions.signal === void 0 ? {} : { signal: commitOptions.signal }
        });
        latestRevisions.set(edit.targetId, snapshot(result.after));
        applied.push({ edit, backend, before: expectedRevision });
        writes.push(Object.freeze({
          targetId: edit.targetId,
          source: snapshot(edit.source),
          state: "applied",
          diagnosticIds: Object.freeze([...result.diagnosticIds ?? []])
        }));
        commitOptions.onProgress?.(index + 1);
      } catch (error3) {
        writes.push(Object.freeze({
          targetId: edit.targetId,
          source: snapshot(edit.source),
          state: "failed",
          diagnosticIds: Object.freeze(["x3.host/edit-write-failed"])
        }));
        const diagnostics = [
          diagnostic("error", "x3.host/edit-write-failed", error3 instanceof Error ? error3.message : String(error3))
        ];
        if (applied.length === 0) {
          return {
            state: "not-applied",
            reason: commitOptions.signal?.aborted ? "cancelled" : "plan-invalid",
            diagnostics
          };
        }
        if (applied.every((item) => item.backend.profile.supportsRollback && item.backend.rollback !== void 0)) {
          const rolledBackTargets = /* @__PURE__ */ new Set();
          try {
            for (const item of [...applied].reverse()) {
              latestRevisions.set(item.edit.targetId, await item.backend.rollback(transactionId, item.edit, item.before, commitOptions.signal));
              rolledBackTargets.add(item.edit.targetId);
            }
          } catch (rollbackError) {
            if (recovery === void 0) {
              return {
                state: "not-applied",
                reason: "guarantee-unachievable",
                diagnostics: [
                  ...diagnostics,
                  diagnostic("error", "x3.host/edit-rollback-failed", rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
                ]
              };
            }
            return {
              state: "partially-applied",
              receipt: Object.freeze({
                transactionId,
                committedAt: options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
                mutationMode: internal.plan.semantics.mutationMode,
                commitGuarantee: fresh.authorization.achievableGuarantee,
                status: "partially-applied",
                undo: "none",
                before: Object.freeze(before),
                after: Object.freeze(finalRevisions()),
                writes: Object.freeze(writes.map((write) => write.state === "applied" && rolledBackTargets.has(write.targetId) ? Object.freeze({ ...write, state: "rolled-back" }) : write)),
                recovery,
                fidelity: internal.prepared.fidelity
              })
            };
          }
          const rolledWrites = writes.map((write) => write.state === "applied" ? Object.freeze({ ...write, state: "rolled-back" }) : write);
          return {
            state: "rolled-back",
            receipt: Object.freeze({
              transactionId,
              committedAt: options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
              mutationMode: internal.plan.semantics.mutationMode,
              commitGuarantee: fresh.authorization.achievableGuarantee,
              status: "rolled-back",
              undo: "none",
              before: Object.freeze(before),
              after: Object.freeze(finalRevisions()),
              writes: Object.freeze(rolledWrites),
              fidelity: internal.prepared.fidelity
            })
          };
        }
        if (recovery === void 0) {
          throw new TypeError("partial commit requires a durable recovery reference");
        }
        return {
          state: "partially-applied",
          receipt: Object.freeze({
            transactionId,
            committedAt: options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
            mutationMode: internal.plan.semantics.mutationMode,
            commitGuarantee: fresh.authorization.achievableGuarantee,
            status: "partially-applied",
            undo: "none",
            before: Object.freeze(before),
            after: Object.freeze(finalRevisions()),
            writes: Object.freeze(writes),
            recovery,
            fidelity: internal.prepared.fidelity
          })
        };
      }
    }
    const receipt = Object.freeze({
      transactionId,
      committedAt: options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
      mutationMode: internal.plan.semantics.mutationMode,
      commitGuarantee: fresh.authorization.achievableGuarantee,
      status: "committed",
      undo: applied.every((item) => item.backend.profile.supportsRollback && item.backend.rollback !== void 0) ? "snapshot" : "none",
      before: Object.freeze(before),
      after: Object.freeze(finalRevisions()),
      writes: Object.freeze(writes),
      ...recovery === void 0 ? {} : { recovery },
      fidelity: internal.prepared.fidelity
    });
    history.set(transactionId, {
      plan: internal.plan,
      prepared: internal,
      receipt,
      steps: Object.freeze([...applied])
    });
    return {
      state: "committed",
      receipt
    };
  };
  const undo = async (transactionId, undoOptions) => {
    const item = history.get(transactionId);
    if (item === void 0) {
      return { state: "not-applied", reason: "plan-invalid", diagnostics: [] };
    }
    let grant;
    try {
      grant = snapshotGrant(undoOptions.grant);
    } catch {
      return { state: "not-applied", reason: "permission-missing", diagnostics: [] };
    }
    if (!grantIsValid(options, grant)) {
      return { state: "not-applied", reason: "permission-missing", diagnostics: [] };
    }
    let fresh;
    try {
      fresh = derive(item.plan, item.prepared.targets, grant, options);
    } catch {
      return { state: "not-applied", reason: "plan-invalid", diagnostics: [] };
    }
    if ("rejection" in fresh || fresh.authorization.missing.length > 0) {
      return { state: "not-applied", reason: "permission-missing", diagnostics: [] };
    }
    if (!fresh.authorization.scopeSatisfied) {
      return { state: "not-applied", reason: "write-scope-mismatch", diagnostics: [] };
    }
    const currentTargets = new Map(item.plan.targets.map((target, index) => [
      target.targetId,
      Object.freeze({ ...target, expectedRevision: item.receipt.after[index] })
    ]));
    let conflicts;
    try {
      conflicts = await conflictsFor(currentTargets, fresh.backends, undoOptions.signal);
    } catch {
      return { state: "not-applied", reason: "plan-invalid", diagnostics: [] };
    }
    if (conflicts.length > 0) {
      return { state: "not-applied", reason: "stale-revision", conflicts, diagnostics: [] };
    }
    const latestRevisions = new Map(item.plan.targets.map((target, index) => [
      target.targetId,
      item.receipt.after[index]
    ]));
    for (const step of [...item.steps].reverse()) {
      const backend = fresh.backends.get(step.edit.targetId);
      if (backend?.rollback === void 0) {
        return { state: "not-applied", reason: "guarantee-unachievable", diagnostics: [] };
      }
      latestRevisions.set(step.edit.targetId, await backend.rollback(transactionId, step.edit, step.before, undoOptions.signal));
    }
    const after = item.plan.targets.map((target) => snapshot(latestRevisions.get(target.targetId) ?? target.expectedRevision));
    const receipt = Object.freeze({
      transactionId: nextId("transaction"),
      committedAt: options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
      mutationMode: item.plan.semantics.mutationMode,
      commitGuarantee: item.receipt.commitGuarantee,
      status: "committed",
      undo: "none",
      before: item.receipt.after,
      after: Object.freeze(after),
      writes: Object.freeze(item.receipt.writes.map((write) => Object.freeze({ ...write, state: "rolled-back" }))),
      fidelity: item.receipt.fidelity
    });
    return {
      state: "committed",
      receipt
    };
  };
  const redo = async (transactionId, redoOptions) => {
    const item = history.get(transactionId);
    if (item === void 0) {
      return { state: "not-applied", reason: "plan-invalid", diagnostics: [] };
    }
    const prepared = await prepare(item.plan, {
      grant: redoOptions.grant,
      confirmationToken: item.prepared.confirmationToken ?? "explicit-redo",
      ...redoOptions.signal === void 0 ? {} : { signal: redoOptions.signal }
    });
    if (prepared.state === "conflict") {
      return {
        state: "not-applied",
        reason: "stale-revision",
        conflicts: prepared.conflicts,
        diagnostics: []
      };
    }
    if (prepared.state === "rejected") {
      return { state: "not-applied", reason: prepared.reason, diagnostics: prepared.diagnostics };
    }
    return commit(prepared.prepared, redoOptions);
  };
  return Object.freeze({ prepare, commit, undo, redo });
}
function createEditSession(options) {
  let state = "live";
  const targets = snapshot(options.targets);
  const revision = snapshot(options.revision);
  const validate = options.writer.validate.bind(options.writer);
  const plan = options.writer.plan.bind(options.writer);
  const ensureLive = () => {
    if (state !== "live")
      throw new TypeError(`edit session is ${state}`);
  };
  return Object.freeze({
    revision,
    targets,
    state: () => state,
    async propose(change) {
      ensureLive();
      const result = snapshot(await validate(snapshot(change)));
      if (!isRecord(result) || !hasExactKeys(result, ["valid", "diagnostics"]) || typeof result["valid"] !== "boolean" || !Array.isArray(result["diagnostics"])) {
        return {
          valid: false,
          diagnostics: [
            diagnostic("error", "x3.host/edit-validation-result-invalid", "writer returned a malformed validation result")
          ]
        };
      }
      return result;
    },
    async plan(change) {
      ensureLive();
      return snapshot(await plan(snapshot(change)));
    },
    markStale() {
      if (state !== "disposed")
        state = "stale-revision";
    },
    markCommitting(committing) {
      if (state === "disposed")
        return;
      state = committing ? "committing" : "live";
    },
    async dispose() {
      state = "disposed";
    }
  });
}

// packages/host/dist/subject-editing.js
function unsupported(kind) {
  return new ModkitError({
    code: "x3.host/edit-topology-unsupported",
    message: `editing a \xAB${kind}\xBB subject is not supported yet (single-source and namespace subjects only)`,
    context: { kind }
  });
}
function assetRevisionFromDescriptor(descriptor) {
  const origin = descriptor.origin;
  if (origin.kind === "namespace") {
    return Object.freeze({
      bindings: Object.freeze({ [origin.root.id]: origin.revision }),
      namespaceRevision: origin.revision,
      compositionFingerprint: canonicalJsonStringify({
        topology: "namespace",
        root: { id: origin.root.id, uri: origin.root.uri },
        revision: origin.revision
      })
    });
  }
  if (origin.kind !== "single")
    throw unsupported(origin.kind);
  const binding = origin.binding;
  return Object.freeze({
    bindings: Object.freeze({ [binding.id]: binding.revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: "single",
      bindingId: binding.id,
      source: { id: binding.source.id, uri: binding.source.uri },
      revision: binding.revision
    })
  });
}
function subjectEditTargetsFromDescriptor(descriptor) {
  const origin = descriptor.origin;
  const revision = assetRevisionFromDescriptor(descriptor);
  if (origin.kind === "namespace") {
    return Object.freeze([
      Object.freeze({
        targetId: origin.root.id,
        subjectUri: descriptor.subjectUri,
        ownerSource: Object.freeze({ id: origin.root.id, uri: origin.root.uri }),
        semanticPath: Object.freeze([]),
        expectedRevision: revision
      })
    ]);
  }
  if (origin.kind !== "single")
    throw unsupported(origin.kind);
  return Object.freeze([
    Object.freeze({
      targetId: origin.binding.id,
      subjectUri: descriptor.subjectUri,
      ownerSource: Object.freeze({ id: origin.binding.source.id, uri: origin.binding.source.uri }),
      semanticPath: Object.freeze([]),
      expectedRevision: revision
    })
  ]);
}
var NO_STAGED_PAYLOADS = Object.freeze({
  async open(ref) {
    throw new ModkitError({
      code: "x3.host/edit-payload-unavailable",
      message: `no payload store can open staged payload \xAB${ref.handleId}\xBB`
    });
  }
});
var DEFAULT_INLINE_PAYLOAD_BYTES = 16 * 1024 * 1024;
var defaultDigest = (value) => canonicalJsonStringify(JSON.parse(JSON.stringify(value)));
function createSubjectEditing(options) {
  const descriptor = options.opened.descriptor;
  const revision = assetRevisionFromDescriptor(descriptor);
  const targets = subjectEditTargetsFromDescriptor(descriptor);
  const grantSnapshot = createGrantSnapshot({
    snapshotId: options.snapshotId ?? `${options.grant.id}#edit`,
    permissions: options.grant.classes,
    sourceIds: targets.map((target) => target.ownerSource.id)
  });
  const issued = /* @__PURE__ */ new Set([grantSnapshot.snapshotId]);
  const coordinator = createCommitCoordinator({
    payloads: options.payloads ?? NO_STAGED_PAYLOADS,
    backendFor: options.backendFor,
    evidenceFor: options.evidenceFor,
    ...options.expectedWriter === void 0 ? {} : { expectedWriter: options.expectedWriter },
    ...options.expectedEvidenceContext === void 0 ? {} : { expectedEvidenceContext: options.expectedEvidenceContext },
    isGrantValid: options.isGrantValid ?? ((grant) => issued.has(grant.snapshotId)),
    digest: options.digest ?? defaultDigest,
    ...options.verifyStagedPayload === void 0 ? {} : { verifyStagedPayload: options.verifyStagedPayload },
    ...options.createRecovery === void 0 ? {} : { createRecovery: options.createRecovery },
    ...options.confirmationMatches === void 0 ? {} : { confirmationMatches: options.confirmationMatches },
    ...options.now === void 0 ? {} : { now: options.now },
    ...options.nextId === void 0 ? {} : { nextId: options.nextId },
    maxInlinePayloadBytes: options.maxInlinePayloadBytes ?? DEFAULT_INLINE_PAYLOAD_BYTES
  });
  const session = options.writer === void 0 ? void 0 : createEditSession({ revision, targets, writer: options.writer });
  const authorization = Object.freeze({
    async request() {
      return { grant: grantSnapshot };
    }
  });
  const editorPorts = session === void 0 ? void 0 : Object.freeze({
    edit: session,
    commit: coordinator,
    payloads: options.payloads ?? NO_STAGED_PAYLOADS,
    authorization
  });
  const targetIds = new Set(targets.map((target) => target.targetId));
  const sourceIds = new Set(targets.map((target) => target.ownerSource.id));
  const expected = canonicalJsonStringify(revision);
  const editing = {
    revision,
    targets,
    grantSnapshot,
    coordinator,
    ...session === void 0 ? {} : { session },
    ...editorPorts === void 0 ? {} : { editorPorts },
    planFromOperation(output) {
      if (output.kind !== "edit-plan") {
        throw new ModkitError({
          code: "x3.host/edit-plan-expected",
          message: `operation returned \xAB${output.kind}\xBB, not an edit plan`
        });
      }
      const plan = output.plan;
      for (const target of plan.targets) {
        if (!targetIds.has(target.targetId) || !sourceIds.has(target.ownerSource.id) || canonicalJsonStringify(target.expectedRevision) !== expected) {
          throw new ModkitError({
            code: "x3.host/edit-plan-subject-mismatch",
            message: `edit plan target \xAB${target.targetId}\xBB is not this subject at its open revision`,
            context: { targetId: target.targetId }
          });
        }
      }
      for (const edit of plan.edits) {
        if (!targetIds.has(edit.targetId) || !sourceIds.has(edit.source.id)) {
          throw new ModkitError({
            code: "x3.host/edit-plan-subject-mismatch",
            message: `edit \xAB${edit.operation}\xBB on \xAB${edit.source.id}\xBB is not this subject`,
            context: { targetId: edit.targetId, sourceId: edit.source.id }
          });
        }
      }
      return plan;
    }
  };
  return Object.freeze(editing);
}

// packages/host/dist/knowledge/index.js
var DEFAULT_PAGE_LIMIT = 20;
var MAXIMUM_PAGE_LIMIT = 100;
var MAXIMUM_SEARCH_TEXT_LENGTH = 1024;
var MAXIMUM_QUERY_LOCALES = 16;
var MAXIMUM_LOCALE_LENGTH = 64;
var MAXIMUM_TARGET_KEY_LENGTH = 8192;
var MAXIMUM_CURSOR_LENGTH = 65536;
var DEFAULT_MAXIMUM_INDEXED_ENTRIES = 5e4;
var HARD_MAXIMUM_INDEXED_ENTRIES = 1e5;
var DEFAULT_MAXIMUM_SEARCHABLE_CHARACTERS = 64 * 1024 * 1024;
var HARD_MAXIMUM_SEARCHABLE_CHARACTERS = 128 * 1024 * 1024;
var DEFAULT_SCAN_CHUNK_SIZE = 512;
var MAXIMUM_SCAN_CHUNK_SIZE = 4096;
var KNOWLEDGE_CLAIM_KINDS = /* @__PURE__ */ new Set([
  "schema-derived-fact",
  "documented-interpretation",
  "community-note",
  "external-reference"
]);
var UINT64_MASK = (1n << 64n) - 1n;
var FNV64_PRIME = 0x100000001b3n;
var fnv64 = (value, seed, reverse) => {
  let hash = seed;
  for (let step = 0; step < value.length; step += 1) {
    const index = reverse ? value.length - step - 1 : step;
    const code = value.charCodeAt(index);
    hash ^= BigInt(code & 255);
    hash = hash * FNV64_PRIME & UINT64_MASK;
    hash ^= BigInt(code >>> 8);
    hash = hash * FNV64_PRIME & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
};
var opaqueFingerprint = (value) => `${fnv64(value, 0xcbf29ce484222325n, false)}${fnv64(value, 0x84222325cbf29ce4n, true)}`;
var positiveLimit2 = (value, fallback, maximum, label) => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`);
  }
  return resolved;
};
var resolveCatalogLimits = (limits) => Object.freeze({
  maxIndexedEntries: positiveLimit2(limits.maxIndexedEntries, DEFAULT_MAXIMUM_INDEXED_ENTRIES, HARD_MAXIMUM_INDEXED_ENTRIES, "maxIndexedEntries"),
  maxSearchableCharacters: positiveLimit2(limits.maxSearchableCharacters, DEFAULT_MAXIMUM_SEARCHABLE_CHARACTERS, HARD_MAXIMUM_SEARCHABLE_CHARACTERS, "maxSearchableCharacters"),
  scanChunkSize: positiveLimit2(limits.scanChunkSize, DEFAULT_SCAN_CHUNK_SIZE, MAXIMUM_SCAN_CHUNK_SIZE, "scanChunkSize")
});
var comparePriority = (left, right) => left === right ? 0 : left > right ? -1 : 1;
var compareCandidate = (left, right) => comparePriority(left.priority, right.priority) || compareUtf8(left.provenance.ownerExtensionId, right.provenance.ownerExtensionId) || compareUtf8(left.packId, right.packId) || compareUtf8(left.entry.id, right.entry.id) || compareUtf8(lower(left.entry.locale), lower(right.entry.locale)) || compareUtf8(knowledgeTargetKey(left.entry.target), knowledgeTargetKey(right.entry.target));
var retainCandidate = (heap, candidate, maximum) => {
  const siftDown = () => {
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      if (left >= heap.length)
        return;
      const right = left + 1;
      const leftCandidate = heap[left];
      const parentCandidate = heap[parent];
      if (leftCandidate === void 0 || parentCandidate === void 0) {
        throw new Error("knowledge candidate heap invariant failed");
      }
      const rightCandidate = heap[right];
      const worseChild = rightCandidate !== void 0 && compareCandidate(rightCandidate, leftCandidate) > 0 ? right : left;
      const childCandidate = heap[worseChild];
      if (childCandidate === void 0)
        throw new Error("knowledge candidate heap child is missing");
      if (compareCandidate(childCandidate, parentCandidate) <= 0)
        return;
      heap[parent] = childCandidate;
      heap[worseChild] = parentCandidate;
      parent = worseChild;
    }
  };
  if (heap.length >= maximum) {
    const worst = heap[0];
    if (worst === void 0)
      throw new Error("knowledge candidate heap root is missing");
    if (compareCandidate(candidate, worst) >= 0)
      return;
    heap[0] = candidate;
    siftDown();
    return;
  }
  heap.push(candidate);
  let child = heap.length - 1;
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2);
    const childCandidate = heap[child];
    const parentCandidate = heap[parent];
    if (childCandidate === void 0 || parentCandidate === void 0) {
      throw new Error("knowledge candidate heap invariant failed");
    }
    if (compareCandidate(childCandidate, parentCandidate) <= 0)
      return;
    heap[parent] = childCandidate;
    heap[child] = parentCandidate;
    child = parent;
  }
};
var lower = (value) => value.toLocaleLowerCase("en-US");
var searchableTarget = (target) => {
  switch (target.kind) {
    case "field":
      return `${target.ecosystem} ${target.schema.contract} ${target.typeId} ${target.canonicalPath.join(" ")}`;
    case "subject":
      return `${target.ecosystem} ${target.subjectKind} ${target.subjectId ?? ""}`;
    case "format":
      return `${target.ecosystem} ${target.formatId}`;
    case "diagnostic":
      return `${target.ecosystem} ${target.code}`;
    case "concept":
      return `${target.ecosystem} ${target.conceptId}`;
  }
};
var targetRank = (entry2, requested) => {
  if (knowledgeTargetKey(entry2) === knowledgeTargetKey(requested))
    return 0;
  if (entry2.kind === "subject" && requested.kind === "subject" && entry2.ecosystem === requested.ecosystem && entry2.subjectKind === requested.subjectKind && entry2.subjectId === void 0) {
    return 1;
  }
  return void 0;
};
var pageLimit = (requested) => {
  if (requested === void 0)
    return { value: DEFAULT_PAGE_LIMIT, diagnostics: [] };
  if (!Number.isSafeInteger(requested) || requested < 1) {
    return {
      value: DEFAULT_PAGE_LIMIT,
      diagnostics: [
        {
          code: "x3.knowledge/invalid-page-limit",
          message: `page limit must be a positive safe integer; using ${DEFAULT_PAGE_LIMIT}`,
          severity: "warning"
        }
      ]
    };
  }
  if (requested > MAXIMUM_PAGE_LIMIT) {
    return {
      value: MAXIMUM_PAGE_LIMIT,
      diagnostics: [
        {
          code: "x3.knowledge/page-limit-capped",
          message: `page limit was capped at ${MAXIMUM_PAGE_LIMIT}`,
          severity: "information"
        }
      ]
    };
  }
  return { value: requested, diagnostics: [] };
};
var queryCursor = (snapshotId, queryKey, offset) => `${encodeURIComponent(snapshotId)}:${encodeURIComponent(queryKey)}:${offset}`;
var decoded = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return void 0;
  }
};
var cursorOffset2 = (cursor3, snapshotId, queryKey) => {
  if (cursor3 === void 0)
    return 0;
  const parts = cursor3.split(":");
  if (parts.length !== 3)
    return void 0;
  const [encodedSnapshot, encodedQuery, rawOffset] = parts;
  if (encodedSnapshot === void 0 || encodedQuery === void 0 || rawOffset === void 0 || decoded(encodedSnapshot) !== snapshotId || decoded(encodedQuery) !== queryKey || !/^(?:0|[1-9][0-9]*)$/u.test(rawOffset)) {
    return void 0;
  }
  const parsed = Number(rawOffset);
  return Number.isSafeInteger(parsed) ? parsed : void 0;
};
var collect = (inventory, limits) => {
  const retained = [];
  const snapshotComponents = /* @__PURE__ */ new Set();
  let candidateCount = 0;
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest;
      if (manifest?.contract.id !== KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1 || !contribution.inventoryEligible) {
        continue;
      }
      const fact2 = contribution.facts.find((candidate) => candidate.contract.id === KNOWLEDGE_PACK_FACT && candidate.contract.major === 1);
      if (fact2 === void 0)
        continue;
      const spec = fact2.value;
      snapshotComponents.add(canonicalJsonStringify([
        fact2.provenance.ownerExtensionId,
        fact2.provenance.extensionVersion,
        fact2.provenance.inventoryRecordId,
        manifest.id,
        fact2.provenance.manifestPath,
        fact2.provenance.manifestDigest,
        fact2.provenance.artifactDigest
      ]));
      for (const entry2 of spec.entries) {
        candidateCount += 1;
        retainCandidate(retained, Object.freeze({
          entry: entry2,
          packId: manifest.id,
          sourceLocale: spec.sourceLocale,
          priority: spec.priority,
          provenance: Object.freeze({
            packId: manifest.id,
            ownerExtensionId: fact2.provenance.ownerExtensionId,
            extensionVersion: fact2.provenance.extensionVersion,
            manifestPath: fact2.provenance.manifestPath,
            manifestDigest: fact2.provenance.manifestDigest,
            artifactDigest: fact2.provenance.artifactDigest
          })
        }), limits.maxIndexedEntries);
      }
    }
  }
  const items = [];
  let searchableCharacters = 0;
  let characterCapped = false;
  for (const candidate of retained.sort(compareCandidate)) {
    const { entry: entry2 } = candidate;
    const searchable = lower([
      entry2.id,
      entry2.title,
      entry2.summary,
      ...entry2.aliases ?? [],
      ...entry2.keywords ?? [],
      searchableTarget(entry2.target)
    ].join(" "));
    if (searchableCharacters + searchable.length > limits.maxSearchableCharacters) {
      characterCapped = true;
      continue;
    }
    searchableCharacters += searchable.length;
    items.push(Object.freeze({
      ...candidate,
      searchable
    }));
  }
  const capped = candidateCount > retained.length || characterCapped;
  return Object.freeze({
    entries: Object.freeze(items),
    snapshotComponents: Object.freeze([...snapshotComponents].sort(compareUtf8)),
    diagnostics: Object.freeze(capped ? [
      {
        code: "x3.knowledge/catalog-index-capped",
        message: `knowledge indexing retained ${items.length} of ${candidateCount} entries and ${searchableCharacters} searchable characters by deterministic priority`,
        severity: "warning"
      }
    ] : []),
    completeness: capped ? "capped" : "complete"
  });
};
var yieldToEventLoop = () => new Promise((resolve) => {
  setTimeout(resolve, 0);
});
var resolvedHits = async (indexed, locales, scanChunkSize, signal, target, text, claimKinds) => {
  const terms = (text ?? "").trim().split(/\s+/u).map(lower).filter(Boolean);
  const selected = /* @__PURE__ */ new Map();
  for (let index = 0; index < indexed.length; index += 1) {
    if (index % scanChunkSize === 0) {
      signal?.throwIfAborted();
      if (index > 0)
        await yieldToEventLoop();
      signal?.throwIfAborted();
    }
    const item = indexed[index];
    if (item === void 0)
      continue;
    const rank = target === void 0 ? 0 : targetRank(item.entry.target, target);
    if (rank === void 0)
      continue;
    if (claimKinds !== void 0 && !claimKinds.includes(item.entry.claimKind))
      continue;
    if (!terms.every((term) => item.searchable.includes(term)))
      continue;
    const requested = locales[0] ?? item.sourceLocale;
    const fallback = knowledgeLocaleFallbacks(requested, locales.slice(1), item.sourceLocale);
    const localeRank = fallback.findIndex((locale) => lower(locale) === lower(item.entry.locale));
    if (localeRank < 0)
      continue;
    const hit = Object.freeze({
      entry: item.entry,
      provenance: item.provenance,
      localeRank
    });
    const ranked = Object.freeze({ hit, priority: item.priority, targetRank: rank });
    const logicalKey = `${item.provenance.ownerExtensionId}\0${item.packId}\0${item.entry.id}\0${knowledgeTargetKey(item.entry.target)}`;
    const previous = selected.get(logicalKey);
    if (previous === void 0 || localeRank < previous.hit.localeRank)
      selected.set(logicalKey, ranked);
  }
  signal?.throwIfAborted();
  return Object.freeze([...selected.values()].sort((left, right) => left.targetRank - right.targetRank || left.hit.localeRank - right.hit.localeRank || right.priority - left.priority || compareUtf8(left.hit.provenance.ownerExtensionId, right.hit.provenance.ownerExtensionId) || compareUtf8(left.hit.provenance.packId, right.hit.provenance.packId) || compareUtf8(left.hit.entry.id, right.hit.entry.id)));
};
var paginate = (snapshotId, ranked, queryKey, cursor3, requestedLimit, catalogDiagnostics, catalogCompleteness) => {
  const limit = pageLimit(requestedLimit);
  const offset = cursorOffset2(cursor3, snapshotId, queryKey);
  if (offset === void 0 || offset > ranked.length) {
    return Object.freeze({
      snapshotId,
      total: ranked.length,
      items: Object.freeze([]),
      completeness: "invalid",
      diagnostics: Object.freeze([
        ...catalogDiagnostics,
        ...limit.diagnostics,
        {
          code: "x3.knowledge/invalid-cursor",
          message: "knowledge cursor is not a valid offset in this snapshot",
          severity: "error"
        }
      ])
    });
  }
  const end = Math.min(ranked.length, offset + limit.value);
  return Object.freeze({
    snapshotId,
    total: ranked.length,
    items: Object.freeze(ranked.slice(offset, end).map((item) => item.hit)),
    ...end < ranked.length ? { nextCursor: queryCursor(snapshotId, queryKey, end) } : {},
    completeness: catalogCompleteness,
    diagnostics: Object.freeze([...catalogDiagnostics, ...limit.diagnostics])
  });
};
var rejectedQuery = (snapshotId, code, message, catalogDiagnostics) => Object.freeze({
  snapshotId,
  total: 0,
  items: Object.freeze([]),
  completeness: "invalid",
  diagnostics: Object.freeze([
    ...catalogDiagnostics,
    { code, message, severity: "error" }
  ])
});
var queryProblem = (text, locales, target, claimKinds, cursor3) => {
  if (text !== void 0 && (typeof text !== "string" || text.length > MAXIMUM_SEARCH_TEXT_LENGTH)) {
    return {
      code: "x3.knowledge/query-text-too-long",
      message: `knowledge search text exceeds ${MAXIMUM_SEARCH_TEXT_LENGTH} characters`
    };
  }
  if (!Array.isArray(locales) || locales.length > MAXIMUM_QUERY_LOCALES || locales.some((locale) => !isKnowledgeLocaleTag(locale))) {
    return {
      code: "x3.knowledge/query-locales-invalid",
      message: `knowledge query accepts at most ${MAXIMUM_QUERY_LOCALES} valid locale tags of ${MAXIMUM_LOCALE_LENGTH} characters`
    };
  }
  if (target !== void 0 && !isKnowledgeTarget(target)) {
    return {
      code: "x3.knowledge/query-target-invalid",
      message: "knowledge target is malformed or exceeds its runtime bounds"
    };
  }
  if (claimKinds !== void 0 && (!Array.isArray(claimKinds) || claimKinds.length > KNOWLEDGE_CLAIM_KINDS.size || new Set(claimKinds).size !== claimKinds.length || claimKinds.some((kind) => !KNOWLEDGE_CLAIM_KINDS.has(kind)))) {
    return {
      code: "x3.knowledge/query-claim-kinds-invalid",
      message: "knowledge claim kinds must be a unique subset of the registered claim kinds"
    };
  }
  if (cursor3 !== void 0 && (typeof cursor3 !== "string" || cursor3.length > MAXIMUM_CURSOR_LENGTH)) {
    return {
      code: "x3.knowledge/query-cursor-too-large",
      message: `knowledge cursor exceeds ${MAXIMUM_CURSOR_LENGTH} characters`
    };
  }
  if (target !== void 0 && knowledgeTargetKey(target).length > MAXIMUM_TARGET_KEY_LENGTH) {
    return {
      code: "x3.knowledge/query-target-too-large",
      message: `knowledge target exceeds ${MAXIMUM_TARGET_KEY_LENGTH} canonical characters`
    };
  }
  return void 0;
};
function createKnowledgeCatalog(inventory, requestedLimits = {}) {
  const limits = resolveCatalogLimits(requestedLimits);
  const collected = collect(inventory, limits);
  const snapshotId = `knowledge-v1:${opaqueFingerprint(canonicalJsonStringify([
    collected.snapshotComponents,
    limits.maxIndexedEntries,
    limits.maxSearchableCharacters,
    collected.entries.length,
    collected.completeness
  ]))}`;
  return Object.freeze({
    snapshotId,
    async search(query, signal) {
      signal?.throwIfAborted();
      const problem = queryProblem(query.text, query.locales, query.target, query.claimKinds, query.cursor);
      if (problem !== void 0) {
        return rejectedQuery(snapshotId, problem.code, problem.message, collected.diagnostics);
      }
      const ranked = await resolvedHits(collected.entries, query.locales, limits.scanChunkSize, signal, query.target, query.text, query.claimKinds);
      signal?.throwIfAborted();
      const queryKey = opaqueFingerprint(canonicalJsonStringify([
        "search",
        lower(query.text ?? ""),
        query.target === void 0 ? null : knowledgeTargetKey(query.target),
        query.locales.map(lower),
        [...query.claimKinds ?? []].sort(compareUtf8)
      ]));
      return paginate(snapshotId, ranked, queryKey, query.cursor, query.limit, collected.diagnostics, collected.completeness);
    },
    async resolve(query, signal) {
      signal?.throwIfAborted();
      const problem = queryProblem(void 0, query.locales, query.target, void 0, query.cursor);
      if (problem !== void 0) {
        return rejectedQuery(snapshotId, problem.code, problem.message, collected.diagnostics);
      }
      const ranked = await resolvedHits(collected.entries, query.locales, limits.scanChunkSize, signal, query.target);
      signal?.throwIfAborted();
      const queryKey = opaqueFingerprint(canonicalJsonStringify([
        "resolve",
        knowledgeTargetKey(query.target),
        query.locales.map(lower)
      ]));
      const page = paginate(snapshotId, ranked, queryKey, query.cursor, query.limit, collected.diagnostics, collected.completeness);
      if (ranked.length < 2)
        return page;
      return Object.freeze({
        ...page,
        diagnostics: Object.freeze([
          ...page.diagnostics,
          {
            code: "x3.knowledge/multiple-target-entries",
            message: "multiple entries describe this target; deterministic order is not schema authority",
            severity: "information"
          }
        ])
      });
    }
  });
}

// packages/host/dist/resolution/explain.js
function sameCandidate(item, offer, contractOffer) {
  return item.providerId === offer.providerId && item.runtimeVariant === offer.runtimeVariant && (item.offerId === void 0 || item.offerId === contractOffer.offerId);
}
function candidateKey(item) {
  return `${item.providerId}\0${item.runtimeVariant}\0${item.offerId ?? ""}`;
}
function explainProviderResolution(request, offers) {
  const result = resolveProvider(request, offers);
  const candidates = offers.flatMap((offer) => offer.provides.map((contractOffer) => {
    const selected = result.state === "resolved" && result.selected.offer.providerId === offer.providerId && result.selected.offer.runtimeVariant === offer.runtimeVariant && result.selected.resolvedContract.offerId === contractOffer.offerId;
    const alternative = result.state === "resolved" && result.alternatives.some((item) => item.offer.providerId === offer.providerId && item.offer.runtimeVariant === offer.runtimeVariant && item.resolvedContract.offerId === contractOffer.offerId);
    const rejected2 = result.rejected.find((item) => sameCandidate(item, offer, contractOffer));
    return {
      providerId: offer.providerId,
      runtimeVariant: offer.runtimeVariant,
      offerId: contractOffer.offerId,
      contract: contractOffer.contract,
      major: contractOffer.major,
      version: contractOffer.version,
      outcome: selected ? "selected" : alternative ? "alternative" : rejected2 === void 0 ? "not-applicable" : "rejected",
      ...rejected2 === void 0 ? {} : { reason: rejected2.reason },
      ...rejected2?.detail === void 0 ? {} : { detail: rejected2.detail }
    };
  })).sort((left, right) => compareUtf8(candidateKey(left), candidateKey(right)));
  return Object.freeze({
    request,
    candidates: Object.freeze(candidates.map((item) => Object.freeze(item))),
    result
  });
}
function renderProviderResolutionExplanation(explanation, json = false) {
  if (json)
    return `${JSON.stringify(explanation, null, 2)}
`;
  const lines = [
    `REQUEST ${explanation.request.contract.contract}@${explanation.request.contract.major} ${explanation.request.contract.range ?? "*"}`,
    ...explanation.candidates.map((item) => `CANDIDATE ${item.providerId}#${item.offerId ?? "-"} ${item.version}: ${item.outcome}${item.reason === void 0 ? "" : ` (${item.reason})`}`)
  ];
  if (explanation.result.state === "resolved") {
    lines.push(`SELECTED ${explanation.result.selected.offer.providerId}#${explanation.result.selected.resolvedContract.offerId}`);
  } else {
    lines.push(`UNRESOLVED ${explanation.result.reason}`);
  }
  return `${lines.join("\n")}
`;
}

// packages/host/dist/v1-projection.js
function unavailable2(message) {
  const item = Object.freeze({
    id: "v1-projection-unavailable",
    category: "dependency",
    code: V1_PROJECTION_UNAVAILABLE_CODE,
    severity: "error",
    message
  });
  return { state: "unavailable", diagnostics: [item] };
}
function snapshotContribution(item) {
  return Object.freeze({
    ...item,
    ...item.requiresTraits === void 0 ? {} : {
      requiresTraits: Object.freeze(item.requiresTraits.map((requirement) => Object.freeze({
        ...requirement,
        ...requirement.states === void 0 ? {} : { states: Object.freeze([...requirement.states]) }
      })))
    },
    ...item.requiresOperations === void 0 ? {} : { requiresOperations: Object.freeze([...item.requiresOperations]) },
    ...item.hosts === void 0 ? {} : { hosts: Object.freeze([...item.hosts]) },
    ...item.conflicts === void 0 ? {} : { conflicts: Object.freeze([...item.conflicts]) }
  });
}
function createV1DescriptorProjectionPort() {
  return Object.freeze({
    async project(descriptor, catalog, signal) {
      throwIfAborted(signal);
      if (catalog === void 0) {
        return unavailable2("viewer catalog evaluation is required for a v1 projection");
      }
      if (catalog.subjectUri !== descriptor.subjectUri || catalog.revision !== descriptor.revision) {
        return unavailable2("viewer catalog evaluation belongs to another subject revision");
      }
      const contributions = Object.freeze(catalog.compatibleContributions.map(snapshotContribution));
      throwIfAborted(signal);
      return {
        state: "projected",
        projection: Object.freeze({
          schemaVersion: 1,
          contributions,
          catalogRevision: catalog.catalogRevision,
          persistable: false
        })
      };
    }
  });
}

// packages/host/dist/data-sources.js
var DEFAULT_CHUNK_BYTES = 64 * 1024;
function createByteRangeSource(bytes) {
  const owned = bytes.slice();
  return Object.freeze({
    async size() {
      return BigInt(owned.byteLength);
    },
    async read(offset, length, signal) {
      throwIfAborted(signal);
      if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
        throw new ModkitError({
          code: "x3.host/invalid-byte-range",
          message: `invalid byte range ${offset}+${length}`
        });
      }
      if (offset > BigInt(owned.byteLength)) {
        throw new ModkitError({
          code: "x3.host/byte-range-out-of-bounds",
          message: `byte offset ${offset} exceeds source size ${owned.byteLength}`
        });
      }
      const start = Number(offset);
      const end = Math.min(owned.byteLength, start + length);
      throwIfAborted(signal);
      return owned.slice(start, end);
    }
  });
}
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
    const next = await source.read(offset + BigInt(written), Math.min(chunkBytes, total - written), signal);
    if (next.byteLength === 0)
      break;
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
      const bytes = await source.read(offset, Math.min(chunkBytes, safeLength(size - offset)), signal);
      if (bytes.byteLength === 0)
        break;
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
        if (byte === 13)
          pendingCr = absolute;
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
    const end = [facts.size, requestedEnd, pageEnd].reduce((left, right) => left < right ? left : right);
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
          if (match[0] === "")
            expression.lastIndex += 1;
        }
      }
    }
  });
}
function tableCursor(index) {
  return `v1:${index}`;
}
function parseTableCursor(value) {
  const match = /^v1:(0|[1-9][0-9]*)$/.exec(value);
  const parsed = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(parsed)) {
    throw new ModkitError({
      code: "x3.host/invalid-table-cursor",
      message: "table cursor is malformed or outside the exact JavaScript range"
    });
  }
  return parsed;
}
function createLazyTableDataSource(options) {
  if (!Number.isSafeInteger(options.columns) || options.columns < 0) {
    throw new TypeError("table columns must be a non-negative safe integer");
  }
  const header = options.header === void 0 ? void 0 : Object.freeze([...options.header]);
  const page = async (request, signal) => {
    throwIfAborted(signal);
    const from = request.kind === "range" ? request.from : parseTableCursor(request.cursor);
    if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(request.count) || request.count <= 0) {
      throw new ModkitError({
        code: "x3.host/invalid-table-page",
        message: "table page coordinates must be safe non-negative integers"
      });
    }
    const items = [];
    let hasMore = false;
    for await (const row of options.iterate(signal)) {
      throwIfAborted(signal);
      if (row.index < from)
        continue;
      if (items.length === request.count) {
        hasMore = true;
        break;
      }
      items.push(Object.freeze({ ...row, cells: Object.freeze([...row.cells]) }));
    }
    return Object.freeze({
      items: Object.freeze(items),
      ...hasMore ? { nextCursor: tableCursor(from + items.length) } : {}
    });
  };
  return Object.freeze({
    async shape() {
      return {
        rows: options.rows ?? "unknown",
        columns: options.columns,
        ...header === void 0 ? {} : { header }
      };
    },
    rows: page,
    async cell(coord, signal) {
      throwIfAborted(signal);
      if (coord.row < 0 || coord.column < 0 || coord.column >= options.columns) {
        throw new ModkitError({
          code: "x3.host/table-cell-out-of-bounds",
          message: `table cell ${coord.row}:${coord.column} is outside the declared shape`
        });
      }
      for await (const row of options.iterate(signal)) {
        throwIfAborted(signal);
        if (row.index === coord.row)
          return { value: row.cells[coord.column] ?? "" };
      }
      throw new ModkitError({
        code: "x3.host/table-cell-out-of-bounds",
        message: `table row ${coord.row} does not exist`
      });
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase();
      for await (const row of options.iterate(signal)) {
        throwIfAborted(signal);
        for (let column = 0; column < row.cells.length; column += 1) {
          if ((row.cells[column] ?? "").toLocaleLowerCase().includes(needle)) {
            yield Object.freeze({ row: row.index, column });
          }
        }
      }
    }
  });
}

// packages/host/dist/presentation-catalog.generated.js
var COMMON_PRESENTATION_CATALOG = Object.freeze([
  Object.freeze({
    slot: Object.freeze({
      slotId: "code",
      kind: "stage",
      contributionId: "modkit.ui-monaco/code-stage",
      extensionId: "modkit/code",
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
      contributionId: "modkit.ui/video-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/image-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/audio-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/world-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/model-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/vector-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/table-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/subject-card-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/subject-calculations-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/relation-graph-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/game-template-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/tree-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/bounded-text-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/virtual-text-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/hex-stage",
      extensionId: "modkit/ui",
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
      contributionId: "modkit.ui/archive-stage",
      extensionId: "modkit/ui",
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

// packages/host/dist/presentation.js
function evaluateViewerApplicability(rule, facts) {
  const missing = [];
  if (rule?.interpretation !== void 0 && rule.interpretation !== "any" && rule.interpretation !== facts.interpretation) {
    missing.push(`interpretation:${rule.interpretation}`);
  }
  if (rule?.sourceBytes?.maximum !== void 0) {
    const maximum = BigInt(rule.sourceBytes.maximum);
    if (facts.sourceBytes === void 0 || facts.sourceBytes > maximum) {
      missing.push(`source-bytes<=${maximum}`);
    }
  }
  if (rule?.longestLineBytes !== void 0) {
    const value = facts.longestLineBytes;
    if (value === void 0 || value === "unknown" && rule.longestLineBytes.whenUnknown === "ineligible" || value !== "unknown" && value > rule.longestLineBytes.maximum) {
      missing.push(`longest-line<=${rule.longestLineBytes.maximum}`);
    }
  }
  return Object.freeze({ eligible: missing.length === 0, missing: Object.freeze(missing) });
}
function evaluateViewerContribution(spec, descriptor, facts) {
  const missing = [...evaluateViewerApplicability(spec.applicability, facts).missing];
  for (const requirement of spec.requiresTraits ?? []) {
    const match = descriptor.traits.some((instance) => {
      if (instance.id !== requirement.id)
        return false;
      if (!(requirement.states ?? ["available"]).includes(instance.state))
        return false;
      if (isStandardTraitId(instance.id)) {
        return requirement.definitionRange === void 0 && instance.definitionVersion === void 0;
      }
      const range = requirement.definitionRange === void 0 ? void 0 : parseVersionRange(requirement.definitionRange);
      const version = instance.definitionVersion === void 0 ? void 0 : parseSemver(instance.definitionVersion);
      return range !== void 0 && version !== void 0 && satisfiesRange(version, range);
    });
    if (!match)
      missing.push(`trait:${requirement.id}`);
  }
  for (const operation of spec.requiresOperations ?? []) {
    if (!descriptor.operations.some((item) => item.id === operation && item.state === "available")) {
      missing.push(`operation:${operation}`);
    }
  }
  for (const dataSource of spec.consumesDataSources) {
    if (!descriptor.dataSources.some((item) => item.contract === dataSource.contract && item.major === dataSource.major)) {
      missing.push(`data-source:${dataSource.contract}@${dataSource.major}`);
    }
  }
  const ordered = Object.freeze([...new Set(missing)].sort(compareUtf8));
  const optionalBound = Object.freeze([
    ...new Set((spec.optionalDataSources ?? []).filter((optional) => descriptor.dataSources.some((item) => item.contract === optional.contract && item.major === optional.major)).map((optional) => optional.contract))
  ].sort(compareUtf8));
  return Object.freeze({ eligible: ordered.length === 0, missing: ordered, optionalBound });
}
function publishedBinding(descriptor, binding) {
  const contract = "dataSource" in binding ? binding.dataSource : binding;
  return descriptor.dataSources.some((source) => source.contract === contract.contract && source.major === contract.major);
}
async function resolveSessionPresentationPlan(descriptor, candidates, selection) {
  const digest = (plan) => `canonical:${canonicalJsonStringify(plan)}`;
  return resolvePresentationPlan({
    descriptor,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      eligible: candidate.bindings.every((binding) => publishedBinding(descriptor, binding))
    })),
    digest,
    ticketMatches: (binding) => binding.ticket.bindingId === binding.bindingId && binding.ticket.sessionId === selection.sessionId,
    async resolveBinding(binding) {
      return {
        ...binding,
        offerId: `session:${binding.bindingId}`,
        providerId: selection.providerId,
        variantId: selection.variantId,
        ticket: { bindingId: binding.bindingId, sessionId: selection.sessionId }
      };
    }
  });
}
async function resolveCommonPresentationPlan(descriptor, selection, options = {}) {
  const available = options.availableStageIds === void 0 ? void 0 : new Set(options.availableStageIds);
  const facts = {
    interpretation: descriptor.interpretation,
    ...options.sourceBytes === void 0 ? {} : { sourceBytes: options.sourceBytes },
    ...options.longestLineBytes === void 0 ? {} : { longestLineBytes: options.longestLineBytes }
  };
  const registrations = COMMON_PRESENTATION_CATALOG;
  const candidates = registrations.filter((entry2) => available === void 0 || available.has(entry2.slot.slotId)).map((entry2) => {
    const eligibility = evaluateViewerContribution(entry2.spec, descriptor, facts);
    const optional = (entry2.optionalBindings ?? []).filter((binding) => eligibility.optionalBound.includes(("dataSource" in binding ? binding.dataSource : binding).contract));
    return {
      ...entry2.slot,
      bindings: Object.freeze([...entry2.slot.bindings, ...optional]),
      eligible: eligibility.eligible,
      missing: eligibility.missing
    };
  });
  if (!candidates.some((candidate) => candidate.eligible && candidate.missing.length === 0)) {
    return void 0;
  }
  const digest = (plan) => `canonical:${canonicalJsonStringify(plan)}`;
  return resolvePresentationPlan({
    descriptor,
    candidates,
    digest,
    ticketMatches: (binding) => binding.ticket.bindingId === binding.bindingId && binding.ticket.sessionId === selection.sessionId,
    async resolveBinding(binding) {
      return {
        ...binding,
        offerId: `session:${binding.bindingId}`,
        providerId: selection.providerId,
        variantId: selection.variantId,
        ticket: { bindingId: binding.bindingId, sessionId: selection.sessionId }
      };
    }
  });
}
function resolveModelWorldPresentationPlan(descriptor, selection) {
  return resolveCommonPresentationPlan(descriptor, selection, {
    availableStageIds: ["world", "model"]
  });
}
function slotKey(slot) {
  return `${String(999999999 - slot.priority).padStart(9, "0")}\0${slot.extensionId}\0${slot.contributionId}\0${slot.slotId}`;
}
function sortedSlots(slots) {
  return [...slots].sort((left, right) => compareUtf8(slotKey(left), slotKey(right)));
}
function bindingKey(binding) {
  return binding.bindingId;
}
function sameBinding(left, right) {
  if (left.bindingId !== right.bindingId)
    return false;
  if ("dataSource" in left || "dataSource" in right) {
    return "dataSource" in left && "dataSource" in right && left.dataSource.contract === right.dataSource.contract && left.dataSource.major === right.dataSource.major;
  }
  return left.contract === right.contract && left.major === right.major;
}
function planBindings(plan) {
  return [
    ...plan.slots.flatMap((slot) => slot.bindings),
    ...plan.fallback === void 0 ? [] : plan.fallback.bindings
  ];
}
function createPresentationPlanValidator(options) {
  return Object.freeze({
    validate(resolved) {
      const issues = /* @__PURE__ */ new Set();
      const slotIds = /* @__PURE__ */ new Set();
      const stageIds = /* @__PURE__ */ new Set();
      const singletonGroups = /* @__PURE__ */ new Set();
      for (const slot of resolved.plan.slots) {
        if (slotIds.has(slot.slotId))
          issues.add("duplicate-slot-id");
        slotIds.add(slot.slotId);
        if (slot.kind === "stage") {
          stageIds.add(slot.slotId);
          if (slot.singletonGroup !== void 0) {
            if (singletonGroups.has(slot.singletonGroup))
              issues.add("duplicate-singleton-group");
            singletonGroups.add(slot.singletonGroup);
          }
        }
      }
      if (resolved.plan.activeStage === void 0) {
        if (resolved.plan.fallback === void 0 || resolved.plan.fallback.kind !== "fallback" || resolved.plan.alternateStages.length !== 0) {
          issues.add("invalid-fallback");
        }
      } else {
        if (!stageIds.has(resolved.plan.activeStage))
          issues.add("missing-active-stage");
        for (const alternate of resolved.plan.alternateStages) {
          if (!stageIds.has(alternate))
            issues.add("missing-alternate-stage");
        }
      }
      if (resolved.plan.fallback !== void 0 && resolved.plan.fallback.kind !== "fallback") {
        issues.add("invalid-fallback");
      }
      const expected = /* @__PURE__ */ new Map();
      for (const binding of planBindings(resolved.plan)) {
        const key2 = bindingKey(binding);
        if (expected.has(key2))
          issues.add("duplicate-binding-id");
        else
          expected.set(key2, binding);
      }
      const actual = /* @__PURE__ */ new Map();
      for (const binding of resolved.bindings) {
        const key2 = bindingKey(binding);
        if (actual.has(key2))
          issues.add("duplicate-binding-id");
        else
          actual.set(key2, binding);
      }
      for (const [key2, binding] of expected) {
        const selected = actual.get(key2);
        if (selected === void 0)
          issues.add("unresolved-binding");
        else if (!sameBinding(binding, selected) || !options.ticketMatches(selected)) {
          issues.add("ticket-binding-mismatch");
        }
      }
      for (const key2 of actual.keys()) {
        if (!expected.has(key2))
          issues.add("unexpected-binding");
      }
      if (options.digest(resolved.plan) !== resolved.planDigest) {
        issues.add("invalid-plan-digest");
      }
      return issues.size === 0 ? { valid: true } : { valid: false, issues: Object.freeze([...issues].sort(compareUtf8)) };
    }
  });
}
async function resolvePresentationPlan(options) {
  const eligible = sortedSlots(options.candidates.filter((item) => item.eligible && (item.missing?.length ?? 0) === 0));
  const unsatisfied = options.candidates.filter((item) => !item.eligible || (item.missing?.length ?? 0) > 0).map((item) => ({ contributionId: item.contributionId, missing: [...item.missing ?? []] })).sort((left, right) => compareUtf8(left.contributionId, right.contributionId) || compareUtf8(left.missing.join("\0"), right.missing.join("\0")));
  const selectedStages = [];
  const seenGroups = /* @__PURE__ */ new Set();
  for (const stage of eligible.filter((item) => item.kind === "stage")) {
    const group = stage.singletonGroup ?? `slot:${stage.slotId}`;
    if (seenGroups.has(group))
      continue;
    seenGroups.add(group);
    selectedStages.push(stage);
  }
  const active = selectedStages[0];
  const fallback = eligible.find((item) => item.kind === "fallback");
  if (active === void 0 && fallback === void 0) {
    throw new ModkitError({
      code: "x3.host/presentation-fallback-missing",
      message: "no eligible stage and no eligible fallback contribution"
    });
  }
  const supporting = eligible.filter((item) => item.kind !== "stage" && item.kind !== "fallback");
  const slots = Object.freeze([...selectedStages, ...supporting]);
  const fallbackSlot = fallback;
  const common = {
    subjectUri: options.descriptor.subjectUri,
    revision: options.descriptor.revision,
    slots,
    unsatisfied: Object.freeze(unsatisfied.map((item) => Object.freeze({ ...item, missing: Object.freeze(item.missing) })))
  };
  const plan = active === void 0 ? definePresentationPlan({
    ...common,
    alternateStages: [],
    fallback: fallbackSlot
  }) : definePresentationPlan({
    ...common,
    activeStage: active.slotId,
    alternateStages: Object.freeze(selectedStages.slice(1).map((item) => item.slotId)),
    ...fallbackSlot === void 0 ? {} : { fallback: fallbackSlot }
  });
  const selectedBindings = [];
  const seenBindings = /* @__PURE__ */ new Set();
  for (const slot of [...slots, ...fallbackSlot === void 0 ? [] : [fallbackSlot]]) {
    for (const binding of slot.bindings) {
      if (seenBindings.has(binding.bindingId)) {
        throw new ModkitError({
          code: "x3.host/duplicate-presentation-binding",
          message: `presentation binding ${binding.bindingId} is declared more than once`
        });
      }
      seenBindings.add(binding.bindingId);
      const resolved = await options.resolveBinding(binding, slot);
      if (resolved === void 0) {
        throw new ModkitError({
          code: "x3.host/unresolved-presentation-binding",
          message: `presentation binding ${binding.bindingId} could not be resolved`
        });
      }
      selectedBindings.push(Object.freeze({ ...resolved }));
    }
  }
  const result = Object.freeze({
    plan,
    bindings: Object.freeze(selectedBindings),
    planDigest: options.digest(plan)
  });
  const validation = createPresentationPlanValidator(options).validate(result);
  if (!validation.valid) {
    throw new ModkitError({
      code: "x3.host/invalid-presentation-plan",
      message: `resolved presentation plan failed validation: ${validation.issues.join(", ")}`,
      context: { issues: validation.issues }
    });
  }
  return result;
}
function switchPresentationStage(resolved, activeStage, digest) {
  const stages = resolved.plan.slots.filter((slot) => slot.kind === "stage");
  if (!stages.some((slot) => slot.slotId === activeStage)) {
    throw new ModkitError({
      code: "x3.host/presentation-stage-missing",
      message: `presentation stage ${activeStage} is not in this session plan`
    });
  }
  const plan = definePresentationPlan({
    ...resolved.plan,
    activeStage,
    alternateStages: stages.filter((slot) => slot.slotId !== activeStage).map((slot) => slot.slotId)
  });
  return Object.freeze({ ...resolved, plan, planDigest: digest(plan) });
}
function createViewerSources(resolved, open) {
  const bindings = new Map(resolved.bindings.map((binding) => [binding.bindingId, binding]));
  const find = async (binding) => {
    const selected = bindings.get(binding.bindingId);
    if (selected === void 0 || !sameBinding(binding, selected))
      return void 0;
    return open(selected);
  };
  return Object.freeze({
    get: find,
    getUnknown: find
  });
}

// packages/host/dist/presentation-semantic.js
function jsonValue(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(`${path} contains a non-finite number`);
    return value === 0 ? 0 : value;
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
    }
    return Array.from(value, (item) => jsonValue(item, `${path}[]`));
  }
  if (value instanceof ArrayBuffer)
    return [...new Uint8Array(value)];
  if (Array.isArray(value))
    return value.map((item, index) => jsonValue(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} contains a non-record object`);
    }
    const record = {};
    for (const [key2, item] of Object.entries(value)) {
      if (item !== void 0)
        record[key2] = jsonValue(item, `${path}.${key2}`);
    }
    return record;
  }
  throw new TypeError(`${path} contains a non-JSON value`);
}
function selectedSlot(plan) {
  const slot = plan.activeStage === void 0 ? plan.fallback : plan.slots.find((candidate) => candidate.slotId === plan.activeStage);
  if (slot === void 0)
    throw new TypeError("presentation plan has no selected slot");
  return slot;
}
async function presentationSemanticHash(request) {
  const slot = selectedSlot(request.plan);
  const bindings = [...slot.bindings].sort((left, right) => compareUtf8(left.bindingId, right.bindingId)).map((binding) => {
    const source = "dataSource" in binding ? binding.dataSource : binding;
    return {
      bindingId: binding.bindingId,
      contract: source.contract,
      major: source.major
    };
  });
  const canonical = canonicalJsonStringify({
    schemaVersion: 1,
    scope: request.scope,
    presentation: {
      slotId: slot.slotId,
      contributionId: slot.contributionId,
      bindings
    },
    semantic: jsonValue(request.semantic)
  });
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  return Object.freeze({
    scope: Object.freeze({ ...request.scope }),
    hash: algorithmQualifiedDigest(`sha256:${hex}`)
  });
}

// packages/host/native-text/contributions/codec-json.json
var codec_json_default = {
  schemaVersion: 1,
  contract: {
    id: "modkit/codec-contribution",
    major: 1
  },
  id: "modkit/text-json",
  displayName: "JSON text data",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./json/families/json/entrypoints/json-codec.js",
      target: {
        environments: ["node"]
      },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: ["read-source"]
    },
    {
      variantId: "portable",
      entrypoint: "./json/families/json/entrypoints/json-codec.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: ["read-source"]
    }
  ],
  spec: {
    formatRefs: [
      {
        formatId: "json",
        label: "JSON",
        mediaType: "application/json"
      }
    ],
    roles: ["semantic"],
    sourceTopology: "single",
    artifactStages: ["authored"],
    openIntents: ["probe", "inspect", "full", "stream", "export"],
    match: {
      extensions: ["json"],
      mediaTypes: ["application/json"]
    },
    probe: {
      kind: "bytes",
      ranges: [
        {
          from: "start",
          length: 8192
        }
      ],
      maxBytes: 8192
    },
    requires: [
      {
        contract: "common.text-data/json-syntax",
        major: 1,
        range: "^1.0.0"
      }
    ],
    representations: [
      {
        id: "syntax-document",
        contract: "common.text-data/json-document",
        major: 1,
        stage: "authored",
        lossy: false
      }
    ],
    publishesDataSources: [
      {
        contract: "common.view/tree-data-source",
        major: 1
      },
      {
        contract: "common.view/text-data-source",
        major: 1
      },
      {
        contract: "common.view/byte-range-source",
        major: 1
      }
    ],
    operations: [
      {
        id: "view.inspect",
        handlerId: "inspect",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "asset.validate",
        handlerId: "validate",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["none"]
      },
      {
        id: "asset.search",
        handlerId: "search",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "export.raw",
        handlerId: "export-raw",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      },
      {
        id: "data.parse",
        handlerId: "parse",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "data.serialize",
        handlerId: "serialize",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      }
    ],
    traitDeclarations: [
      {
        id: "structure.hierarchy",
        representation: "source",
        presence: "will-expose"
      },
      {
        id: "content.text",
        representation: "source",
        presence: "will-expose"
      },
      {
        id: "content.binary",
        representation: "source",
        presence: "will-expose"
      }
    ],
    implementationTier: {
      claimed: 1
    },
    budgets: {
      maxInputBytes: "1073741824",
      maxDepth: 256,
      maxNodes: 1e6,
      maxScalarBytes: 104857600,
      maxDiagnostics: 1e4
    }
  }
};

// packages/host/native-text/contributions/codec-jsonc.json
var codec_jsonc_default = {
  schemaVersion: 1,
  contract: {
    id: "modkit/codec-contribution",
    major: 1
  },
  id: "modkit/text-jsonc",
  displayName: "JSONC text data",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./json/families/json/entrypoints/jsonc-codec.js",
      target: {
        environments: ["node"]
      },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: ["read-source"]
    },
    {
      variantId: "portable",
      entrypoint: "./json/families/json/entrypoints/jsonc-codec.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: ["read-source"]
    }
  ],
  spec: {
    formatRefs: [
      {
        formatId: "jsonc",
        label: "JSONC",
        mediaType: "application/jsonc"
      }
    ],
    roles: ["semantic"],
    sourceTopology: "single",
    artifactStages: ["authored"],
    openIntents: ["probe", "inspect", "full", "stream", "export"],
    match: {
      extensions: ["jsonc"],
      mediaTypes: ["application/jsonc"]
    },
    probe: {
      kind: "bytes",
      ranges: [
        {
          from: "start",
          length: 8192
        }
      ],
      maxBytes: 8192
    },
    requires: [
      {
        contract: "common.text-data/jsonc-syntax",
        major: 1,
        range: "^1.0.0"
      }
    ],
    representations: [
      {
        id: "syntax-document",
        contract: "common.text-data/jsonc-document",
        major: 1,
        stage: "authored",
        lossy: false
      }
    ],
    publishesDataSources: [
      {
        contract: "common.view/tree-data-source",
        major: 1
      },
      {
        contract: "common.view/text-data-source",
        major: 1
      },
      {
        contract: "common.view/byte-range-source",
        major: 1
      }
    ],
    operations: [
      {
        id: "view.inspect",
        handlerId: "inspect",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "asset.validate",
        handlerId: "validate",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["none"]
      },
      {
        id: "asset.search",
        handlerId: "search",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "export.raw",
        handlerId: "export-raw",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      },
      {
        id: "data.parse",
        handlerId: "parse",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "data.serialize",
        handlerId: "serialize",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      }
    ],
    traitDeclarations: [
      {
        id: "structure.hierarchy",
        representation: "source",
        presence: "will-expose"
      },
      {
        id: "content.text",
        representation: "source",
        presence: "will-expose"
      },
      {
        id: "content.binary",
        representation: "source",
        presence: "will-expose"
      }
    ],
    implementationTier: {
      claimed: 1
    },
    budgets: {
      maxInputBytes: "1073741824",
      maxDepth: 256,
      maxNodes: 1e6,
      maxScalarBytes: 104857600,
      maxDiagnostics: 1e4
    }
  }
};

// packages/host/native-text/contributions/codec-txt.json
var codec_txt_default = {
  schemaVersion: 1,
  contract: { id: "modkit/codec-contribution", major: 1 },
  id: "modkit/txt",
  displayName: "Plain Text Document",
  status: "supported",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./plain/txt/codec.js",
      target: { environments: ["node"] },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: ["read-source"]
    },
    {
      variantId: "portable",
      entrypoint: "./plain/txt/codec.js",
      target: { environments: ["browser-worker", "node-worker"] },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: ["read-source"]
    }
  ],
  limitations: [
    "The codec is read-only: editing plain text is the separate modkit/plain-text-writer contribution, and no operation here mutates a source.",
    "UTF-16 is accepted only with a byte-order mark, and a UTF-16 document publishes the paragraph outline and the raw bytes but not the lazy text source, whose line index is only true for UTF-8."
  ],
  spec: {
    formatRefs: [
      { formatId: "txt", label: "Plain Text Document", mediaType: "text/plain" }
    ],
    roles: ["semantic"],
    sourceTopology: "single",
    artifactStages: ["authored"],
    openIntents: ["probe", "inspect", "full", "export"],
    match: { extensions: ["txt"], mediaTypes: ["text/plain"] },
    probe: { kind: "bytes", ranges: [{ from: "start", length: 8192 }], maxBytes: 8192 },
    representations: [
      {
        id: "flow-metadata",
        contract: "common.document/flow-metadata",
        major: 1,
        stage: "authored",
        lossy: false
      }
    ],
    publishesDataSources: [
      { contract: "common.view/tree-data-source", major: 1 },
      { contract: "common.view/text-data-source", major: 1 },
      { contract: "common.view/byte-range-source", major: 1 }
    ],
    operations: [
      {
        id: "view.inspect",
        handlerId: "inspect",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "asset.validate",
        handlerId: "validate",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["none"]
      },
      {
        id: "asset.search",
        handlerId: "search",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "export.raw",
        handlerId: "export-raw",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      }
    ],
    traitDeclarations: [
      { id: "document.flow", representation: "source", presence: "will-expose" },
      { id: "structure.hierarchy", representation: "source", presence: "will-expose" },
      { id: "content.text", representation: "source", presence: "will-expose" },
      { id: "content.binary", representation: "source", presence: "will-expose" }
    ],
    implementationTier: { claimed: 1 },
    budgets: {
      maxInputBytes: "1073741824",
      maxDepth: 64,
      maxNodes: 1e5,
      maxScalarBytes: 104857600,
      maxDiagnostics: 1e3
    }
  }
};

// packages/host/native-text/contributions/contract-json-syntax.json
var contract_json_syntax_default = {
  schemaVersion: 1,
  contract: {
    id: "modkit/contract-definition",
    major: 1
  },
  id: "modkit/json-syntax-contract",
  displayName: "JSON syntax service contract",
  spec: {
    schemaVersion: 1,
    kind: "service",
    contract: "common.text-data/json-syntax",
    major: 1,
    offerFacet: {
      presence: "forbidden"
    },
    requestFacet: {
      presence: "forbidden"
    },
    matching: {
      profile: "modkit/facetless-matcher",
      major: 1
    },
    conformanceProfile: "common.text-data/json-syntax-v1",
    surface: {
      fields: ["contract"],
      methods: {
        parse: {
          kind: "value",
          signal: {
            arg: 0,
            key: "signal"
          }
        },
        serialize: {
          kind: "value",
          signal: {
            arg: 0,
            key: "signal"
          }
        },
        dataSource: {
          kind: "lease",
          wrapper: "lease",
          result: {
            contract: "common.view/tree-data-source",
            major: 1
          },
          signal: {
            arg: 0,
            key: "signal"
          }
        }
      }
    }
  }
};

// packages/host/native-text/contributions/contract-jsonc-syntax.json
var contract_jsonc_syntax_default = {
  schemaVersion: 1,
  contract: {
    id: "modkit/contract-definition",
    major: 1
  },
  id: "modkit/jsonc-syntax-contract",
  displayName: "JSONC syntax service contract",
  spec: {
    schemaVersion: 1,
    kind: "service",
    contract: "common.text-data/jsonc-syntax",
    major: 1,
    offerFacet: {
      presence: "forbidden"
    },
    requestFacet: {
      presence: "forbidden"
    },
    matching: {
      profile: "modkit/facetless-matcher",
      major: 1
    },
    conformanceProfile: "common.text-data/jsonc-syntax-v1",
    surface: {
      fields: ["contract"],
      methods: {
        parse: {
          kind: "value",
          signal: {
            arg: 0,
            key: "signal"
          }
        },
        serialize: {
          kind: "value",
          signal: {
            arg: 0,
            key: "signal"
          }
        },
        dataSource: {
          kind: "lease",
          wrapper: "lease",
          result: {
            contract: "common.view/tree-data-source",
            major: 1
          },
          signal: {
            arg: 0,
            key: "signal"
          }
        }
      }
    }
  }
};

// packages/host/native-text/contributions/provider-json-default.json
var provider_json_default_default = {
  schemaVersion: 1,
  contract: {
    id: "modkit/service-provider-contribution",
    major: 1
  },
  id: "modkit/json-syntax-default",
  displayName: "json syntax provider",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./json/families/json/entrypoints/json-provider.js",
      target: {
        environments: ["node"]
      },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: []
    },
    {
      variantId: "portable",
      entrypoint: "./json/families/json/entrypoints/json-provider.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: []
    }
  ],
  spec: {
    provides: [
      {
        offerId: "json-syntax-default-v1",
        contract: "common.text-data/json-syntax",
        major: 1,
        version: "1.0.0"
      }
    ],
    lifecycleScope: "session",
    outputs: [
      {
        id: "structure.hierarchy",
        representation: "runtime",
        presence: "will-expose"
      }
    ]
  }
};

// packages/host/native-text/contributions/provider-jsonc-default.json
var provider_jsonc_default_default = {
  schemaVersion: 1,
  contract: {
    id: "modkit/service-provider-contribution",
    major: 1
  },
  id: "modkit/jsonc-syntax-default",
  displayName: "jsonc syntax provider",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./json/families/json/entrypoints/jsonc-provider.js",
      target: {
        environments: ["node"]
      },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: []
    },
    {
      variantId: "portable",
      entrypoint: "./json/families/json/entrypoints/jsonc-provider.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: []
    }
  ],
  spec: {
    provides: [
      {
        offerId: "jsonc-syntax-default-v1",
        contract: "common.text-data/jsonc-syntax",
        major: 1,
        version: "1.0.0"
      }
    ],
    lifecycleScope: "session",
    outputs: [
      {
        id: "structure.hierarchy",
        representation: "runtime",
        presence: "will-expose"
      }
    ]
  }
};

// packages/host/native-text/contributions/writer-json.json
var writer_json_default = {
  schemaVersion: 1,
  contract: {
    id: "modkit/service-provider-contribution",
    major: 1
  },
  id: "modkit/text-json-writer",
  displayName: "JSON and JSONC text writer",
  runtimeVariants: [
    {
      variantId: "portable",
      entrypoint: "./json/editing/text-writer.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: []
    }
  ],
  spec: {
    lifecycleScope: "session",
    provides: [
      {
        offerId: "json-source",
        contract: "common.edit/writer",
        major: 1,
        version: "1.0.0",
        facet: {
          providerId: "modkit/text-json-writer",
          fidelityEvidenceId: "text-json-text-writer-v1",
          formatId: "json",
          representationId: "source",
          mutationMode: "mutate",
          minimumRoundTrip: "byte-identical"
        }
      },
      {
        offerId: "jsonc-source",
        contract: "common.edit/writer",
        major: 1,
        version: "1.0.0",
        facet: {
          providerId: "modkit/text-json-writer",
          fidelityEvidenceId: "text-json-text-writer-v1",
          formatId: "jsonc",
          representationId: "source",
          mutationMode: "mutate",
          minimumRoundTrip: "byte-identical"
        }
      }
    ]
  }
};

// packages/host/native-text/contributions/writer-plain-text.json
var writer_plain_text_default = {
  schemaVersion: 1,
  contract: {
    id: "modkit/service-provider-contribution",
    major: 1
  },
  id: "modkit/plain-text-writer",
  displayName: "Plain text writer",
  runtimeVariants: [
    {
      variantId: "portable",
      entrypoint: "./plain/editing/text-writer.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: []
    }
  ],
  spec: {
    lifecycleScope: "session",
    provides: [
      {
        offerId: "plain-text-source",
        contract: "common.edit/writer",
        major: 1,
        version: "1.0.0",
        facet: {
          providerId: "modkit/plain-text-writer",
          fidelityEvidenceId: "plain-text-writer-v1",
          formatId: "txt",
          representationId: "source",
          mutationMode: "mutate",
          minimumRoundTrip: "byte-identical"
        }
      }
    ]
  }
};

// packages/host/native-text/json/families/json/entrypoints/json-codec.js
var json_codec_exports = {};
__export(json_codec_exports, {
  abiVersion: () => abiVersion,
  createCodec: () => createCodec
});

// packages/host/native-text/runtime/basic.js
function lease(value) {
  let released = false;
  return Object.freeze({
    value,
    async release() {
      released = true;
    },
    isReleased: () => released
  });
}
function pageStart(cursor3) {
  if (cursor3 === void 0) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor3)) throw new TypeError("invalid page cursor");
  const value = Number(cursor3);
  if (!Number.isSafeInteger(value)) throw new TypeError("page cursor exceeds safe integer range");
  return value;
}
function createTreeDataSource(rootNode) {
  const nodes = /* @__PURE__ */ new Map();
  const register = (node, id) => {
    const children = Array.isArray(node.children) ? node.children : [];
    nodes.set(id, { node, childIds: children.map((_, index) => `${id}/${index}`) });
    children.forEach((child, index) => register(child, `${id}/${index}`));
  };
  register(rootNode, "root");
  const ref = (id) => {
    const item = nodes.get(id);
    return Object.freeze({ id, hasChildren: (item?.childIds.length ?? 0) > 0 });
  };
  return Object.freeze({
    async root() {
      return ref("root");
    },
    async children(node, page, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError("tree page limit must be a positive safe integer");
      }
      const start = pageStart(page.cursor);
      const childIds = nodes.get(node.id)?.childIds ?? [];
      const items = childIds.slice(start, start + page.limit).map(ref);
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < childIds.length ? { nextCursor: String(start + items.length) } : {}
      });
    },
    async facts(node) {
      const value = nodes.get(node.id)?.node;
      if (value === void 0) throw new TypeError(`unknown tree node ${node.id}`);
      return Object.freeze({
        kind: value.kind,
        label: value.label,
        ...value.preview === void 0 ? {} : { preview: value.preview }
      });
    },
    async *search(query) {
      for (const [id, item] of nodes) {
        const label = item.node.label ?? "";
        const preview2 = item.node.preview ?? "";
        if (label.includes(query.pattern) || preview2.includes(query.pattern)) yield ref(id);
      }
    }
  });
}
function newlineOf(text) {
  const crlf = (text.match(/\r\n/gu) ?? []).length;
  const withoutCrLf = text.replace(/\r\n/gu, "");
  const lf = (withoutCrLf.match(/\n/gu) ?? []).length;
  const cr = (withoutCrLf.match(/\r/gu) ?? []).length;
  if ([crlf, lf, cr].filter((count) => count > 0).length > 1) return "mixed";
  if (crlf > 0) return "crlf";
  if (lf > 0) return "lf";
  if (cr > 0) return "cr";
  return "none";
}
function defineWriter({
  providerId,
  providerVersion = "1.0.0",
  artifactDigest,
  offerId,
  formatId,
  representationId,
  mutationMode = "mutate",
  minimumRoundTrip,
  fidelityEvidenceId,
  fidelity,
  validate,
  planEdits
}) {
  const identity = Object.freeze({
    providerId,
    providerVersion,
    artifactDigest,
    formatId,
    representationId
  });
  const offer = Object.freeze({
    providerId,
    fidelityEvidenceId,
    formatId,
    representationId,
    mutationMode,
    minimumRoundTrip
  });
  const writer = Object.freeze({
    identity,
    offer,
    async validate(change, signal) {
      return validate(change, signal);
    },
    async plan(change, signal) {
      const edits = await planEdits(change, signal);
      return Object.freeze({
        planId: `${providerId}:${change.targets.map((target) => target.targetId).join("+")}`,
        targets: change.targets,
        edits,
        semantics: Object.freeze({ mutationMode, minimumGuarantee: "atomic" }),
        fidelity,
        diagnostics: Object.freeze([])
      });
    }
  });
  return Object.freeze({
    abiVersion: 1,
    provides: Object.freeze(["common.edit/writer"]),
    async createProvider(selection) {
      if (selection.offerId !== offerId)
        throw new TypeError(`unknown writer offer ${selection.offerId}`);
      return lease(writer);
    }
  });
}

// packages/host/native-text/runtime/text.js
function decodeInput(input) {
  if (typeof input.text === "string") {
    return {
      text: input.text,
      bytes: new TextEncoder().encode(input.text),
      source: { encoding: "utf-8", bom: false, newline: newlineOf(input.text) }
    };
  }
  const bytes = input.bytes;
  let encoding = input.encoding;
  let bom = false;
  let offset = 0;
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    encoding = encoding ?? "utf-8";
    bom = true;
    offset = 3;
  } else if (bytes[0] === 255 && bytes[1] === 254) {
    encoding = encoding ?? "utf-16le";
    bom = true;
    offset = 2;
  } else if (bytes[0] === 254 && bytes[1] === 255) {
    encoding = encoding ?? "utf-16be";
    bom = true;
    offset = 2;
  }
  encoding ??= "utf-8";
  const content = bytes.subarray(offset);
  let text;
  if (encoding === "utf-16be") {
    const swapped = new Uint8Array(content.length);
    for (let index = 0; index + 1 < content.length; index += 2) {
      swapped[index] = content[index + 1];
      swapped[index + 1] = content[index];
    }
    text = new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
  } else {
    text = new TextDecoder(encoding, { fatal: true }).decode(content);
  }
  return { text, bytes, source: { encoding, bom, newline: newlineOf(text) } };
}
function span(text, offset = 0, length = text.length) {
  const prefix = text.slice(0, offset);
  const lastLf = prefix.lastIndexOf("\n");
  return Object.freeze({
    byteOffset: uint64(BigInt(new TextEncoder().encode(prefix).byteLength)),
    byteLength: uint64(
      BigInt(new TextEncoder().encode(text.slice(offset, offset + length)).byteLength)
    ),
    utf16Offset: offset,
    utf16Length: length,
    line: (prefix.match(/\n/gu) ?? []).length,
    column: offset - (lastLf === -1 ? 0 : lastLf + 1)
  });
}
function failure(code, message, text = "", offset = 0, length = 0) {
  return {
    state: "failed",
    diagnostics: [
      diagnostic("error", code, message, void 0, void 0, span(text, offset, length))
    ]
  };
}
function preflight(decoded2, budget, signal) {
  throwIfAborted(signal);
  if (BigInt(decoded2.bytes.byteLength) > budget.maxInputBytes) {
    return failure("modkit/text-data-input-budget", "input exceeds maxInputBytes", decoded2.text);
  }
  if (decoded2.text.includes("\0")) {
    return failure("modkit/text-data-nul", "NUL is forbidden in text input", decoded2.text);
  }
  return void 0;
}
function encodeText(text, source, target = {}) {
  const facts = { ...source, ...target };
  const newline = facts.newline === "none" ? source.newline : facts.newline;
  const separator = newline === "crlf" ? "\r\n" : newline === "cr" ? "\r" : "\n";
  const normalized = newline === "mixed" || newline === "none" ? text : text.replace(/\r\n|\r|\n/gu, separator);
  let bytes;
  if (facts.encoding === "utf-8") bytes = new TextEncoder().encode(normalized);
  else {
    const little = new Uint8Array(normalized.length * 2);
    const view = new DataView(little.buffer);
    for (let index = 0; index < normalized.length; index += 1) {
      view.setUint16(index * 2, normalized.charCodeAt(index), facts.encoding === "utf-16le");
    }
    bytes = little;
  }
  if (facts.bom) {
    const marker = facts.encoding === "utf-8" ? new Uint8Array([239, 187, 191]) : facts.encoding === "utf-16le" ? new Uint8Array([255, 254]) : new Uint8Array([254, 255]);
    const joined = new Uint8Array(marker.length + bytes.length);
    joined.set(marker);
    joined.set(bytes, marker.length);
    bytes = joined;
  }
  return {
    bytes,
    encoding: facts.encoding,
    bom: facts.bom,
    newline: facts.newline,
    diagnostics: []
  };
}
function scalar(value, raw = JSON.stringify(value)) {
  if (value === null) return { kind: "null", raw: "null" };
  if (typeof value === "boolean") return { kind: "boolean", value, raw: String(value) };
  if (typeof value === "string") return { kind: "string", value, raw: raw ?? JSON.stringify(value) };
  if (typeof value === "bigint")
    return { kind: "integer", decimal: String(value), raw: String(value) };
  if (typeof value === "number" && Number.isInteger(value)) {
    return { kind: "integer", decimal: String(value), raw: raw ?? String(value) };
  }
  if (typeof value === "number")
    return { kind: "number", raw: raw ?? String(value), finiteValue: value };
  return { kind: "string", value: String(value), raw: raw ?? String(value) };
}
function treeDataSource(document) {
  const nodes = /* @__PURE__ */ new Map([["root", { value: document, children: [] }]]);
  const entries = document.root?.kind === "object" ? document.root.members.map((member) => [member.key, member.value]) : Object.entries(document);
  nodes.get("root").children = entries.map(([key2, value], index) => {
    const id = `root/${index}`;
    nodes.set(id, { value, label: String(key2), children: [] });
    return { id, hasChildren: false };
  });
  return Object.freeze({
    async root() {
      return { id: "root", hasChildren: true };
    },
    async children(node, page) {
      const all = nodes.get(node.id)?.children ?? [];
      const start = page.cursor ? Number(page.cursor) : 0;
      const items = all.slice(start, start + page.limit);
      return {
        items,
        ...start + items.length < all.length ? { nextCursor: String(start + items.length) } : {}
      };
    },
    async facts(node) {
      const item = nodes.get(node.id);
      return { kind: item?.value?.kind ?? "value", label: item?.label ?? "root" };
    },
    async *search(query) {
      for (const [id, item] of nodes) {
        if ((item.label ?? "").includes(query.pattern)) yield { id, hasChildren: false };
      }
    }
  });
}
function createTextSyntaxProvider(definition) {
  const provider = Object.freeze({
    contract: definition.contract,
    async parse(request) {
      throwIfAborted(request.signal);
      let decoded2;
      try {
        decoded2 = decodeInput(request.input);
      } catch (cause) {
        return failure(
          "modkit/text-data-decode",
          cause instanceof Error ? cause.message : String(cause)
        );
      }
      const rejected2 = preflight(decoded2, request.budget, request.signal);
      return rejected2 ?? definition.parse(decoded2, request);
    },
    async serialize(request) {
      throwIfAborted(request.signal);
      const result = await definition.serialize(request);
      if (BigInt(result.bytes.byteLength) <= request.budget.maxInputBytes) return result;
      return {
        ...result,
        bytes: new Uint8Array(),
        diagnostics: [
          diagnostic(
            "error",
            "modkit/text-data-output-budget",
            "serialized output exceeds maxInputBytes"
          )
        ]
      };
    },
    async dataSource(request) {
      const parsed = await provider.parse(request);
      if (parsed.state === "failed")
        throw new TypeError(parsed.diagnostics[0]?.message ?? "parse failed");
      return lease(treeDataSource(parsed.document));
    }
  });
  return provider;
}
function createSelectedProvider(definition, selection, factory = createTextSyntaxProvider) {
  if (selection?.contract !== definition.contract) {
    throw new TypeError(`provider does not implement ${String(selection?.contract)}`);
  }
  return factory(definition);
}
var OPERATIONS = Object.freeze([
  {
    id: "view.inspect",
    handlerId: "inspect",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "asset.validate",
    handlerId: "validate",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["none"]
  },
  {
    id: "asset.search",
    handlerId: "search",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "export.raw",
    handlerId: "export-raw",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["bytes"]
  },
  {
    id: "data.parse",
    handlerId: "parse",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "data.serialize",
    handlerId: "serialize",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["bytes"]
  }
]);
function createTextCodec(definition, context) {
  return Object.freeze({
    async probe(request, signal) {
      if (request.source.kind !== "bytes" || request.plan.kind !== "bytes")
        throw new TypeError("text codecs require byte probes");
      const declared = Math.min(
        request.plan.maxBytes,
        request.plan.ranges[0]?.length ?? request.plan.maxBytes
      );
      const available = request.source.size === void 0 ? declared : Number(request.source.size);
      const bytes = await request.source.read(
        0n,
        Math.max(0, Math.min(declared, available)),
        signal
      );
      let text = "";
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return {
          codecId: `modkit/text-${definition.format}`,
          confidence: 0.01,
          evidence: [{ kind: "structure", weight: -1, note: "invalid-utf8" }],
          requiredRanges: [{ byteOffset: "0", byteLength: String(bytes.byteLength) }]
        };
      }
      const result = definition.detect(text, request.source.ref.uri);
      return {
        codecId: `modkit/text-${definition.format}`,
        confidence: result.confidence,
        evidence: [{ kind: "structure", weight: result.confidence, note: result.note }],
        requiredRanges: [{ byteOffset: "0", byteLength: String(bytes.byteLength) }]
      };
    },
    async planInput() {
      return {
        originKind: "single",
        candidate: { bindingId: "content", role: "content", ownership: "owned" },
        requirements: []
      };
    },
    async open(input, _intent, budget, signal) {
      if (input.originKind !== "single") throw new TypeError("text codec requires a single source");
      const binding = input.bindings[0];
      const sourceLease = await input.openBinding(binding.bindingId, signal);
      const source = sourceLease.value;
      if (source.kind !== "bytes" || source.size === void 0 || source.size > budget.maxInputBytes) {
        await sourceLease.release();
        throw new RangeError("text codec requires a sized source inside budget");
      }
      const bytes = await source.read(0n, Number(source.size), signal);
      const providerLease = await context.contracts.resolve({
        contract: definition.contract,
        major: 1,
        signal
      });
      const provider = providerLease.value;
      const parsed = await provider.parse({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal
      });
      if (parsed.state === "failed") {
        await providerLease.release();
        await sourceLease.release();
        throw new TypeError(parsed.diagnostics[0]?.message ?? "parse failed");
      }
      const dataLease = await provider.dataSource({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal
      });
      const byteSource = {
        size: async () => source.size,
        read: (offset, length, readSignal) => source.read(offset, length, readSignal)
      };
      const textSource = createUtf8TextDataSource(byteSource);
      const textInfo = await textSource.info();
      const descriptor = await assembleSubjectDescriptor({
        schemaVersion: 2,
        subjectUri: binding.source.uri,
        origin: {
          kind: "single",
          binding: {
            id: binding.bindingId,
            role: binding.role,
            source: binding.source,
            required: true,
            ownership: binding.ownership,
            revision: binding.revision
          }
        },
        interpretation: "codec",
        identity: {
          codecId: `modkit/text-${definition.format}`,
          codecVersion: "1.0.0",
          formatId: definition.format,
          formatLabel: definition.format.toUpperCase(),
          mediaType: definition.mediaType,
          confidence: 1,
          detection: [{ kind: "structure", weight: 1 }]
        },
        traits: [
          {
            id: "structure.hierarchy",
            descriptorVersion: 1,
            state: "available",
            parameters: { nodeCount: "unknown", lazy: true, hasLocations: true }
          },
          {
            id: "content.text",
            descriptorVersion: 1,
            state: "available",
            parameters: {
              encoding: textInfo.encoding,
              lineCount: textInfo.lines,
              bom: textInfo.bom,
              newline: textInfo.newline
            }
          },
          {
            id: "content.binary",
            descriptorVersion: 1,
            state: "available",
            parameters: { bytes: source.size.toString(10) }
          }
        ],
        operations: OPERATIONS.map((operation) => ({
          id: operation.id,
          handlerId: operation.handlerId,
          mutatesSource: false,
          state: "available"
        })),
        constraints: {
          readOnly: true,
          seekable: true,
          randomAccess: true,
          trusted: false,
          maxDecodedBytes: source.size.toString(10)
        },
        dataSources: [
          { contract: "common.view/tree-data-source", major: 1 },
          { contract: "common.view/text-data-source", major: 1 },
          { contract: "common.view/byte-range-source", major: 1 }
        ],
        diagnostics: [],
        metadata: [],
        revision: input.revisions.revision
      });
      const handlers = /* @__PURE__ */ new Map([
        [
          "inspect",
          async () => ({
            kind: "json",
            value: { format: definition.format, parseState: parsed.state }
          })
        ],
        ["validate", async () => ({ kind: "none" })],
        ["search", async () => ({ kind: "json", value: [] })],
        ["export-raw", async () => ({ kind: "bytes", value: bytes })],
        ["parse", async () => ({ kind: "json", value: { state: parsed.state } })],
        [
          "serialize",
          async () => ({
            kind: "bytes",
            value: (await provider.serialize({
              document: parsed.document,
              dialect: definition.dialect,
              budget,
              signal
            })).bytes
          })
        ]
      ]);
      return createAssetSession({
        revision: revisionId(input.revisions.revision),
        descriptor,
        operationDeclarations: OPERATIONS,
        permissionGrant: { id: `text-${definition.format}-session`, classes: ["read-source"] },
        handlers,
        async openDataSource(contract) {
          if (contract === "common.view/tree-data-source") return lease(dataLease.value);
          if (contract === "common.view/text-data-source") return lease(textSource);
          if (contract === "common.view/byte-range-source") return lease(byteSource);
          throw new TypeError(`text-${definition.format} does not publish ${contract}`);
        },
        release: [
          () => dataLease.release(),
          () => providerLease.release(),
          () => sourceLease.release()
        ]
      }).session;
    }
  });
}

// packages/host/native-text/json/families/json/detect.js
function markerOutsideString(text, marker) {
  let quote = false;
  let escaped = false;
  for (let index = 0; index <= text.length - marker.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') quote = true;
    else if (text.startsWith(marker, index)) return true;
  }
  return false;
}
function detectJson(dialect, text, uri) {
  if (text.includes("\0")) return { confidence: 0.01, note: "nul-byte" };
  const trimmed = text.trimStart();
  const structure = trimmed.startsWith("{") || trimmed.startsWith("[");
  const comment = markerOutsideString(text, "//") || markerOutsideString(text, "/*");
  if (!structure) return { confidence: 0.05, note: "no-json-root" };
  if (dialect === "jsonc" && comment) return { confidence: 0.98, note: "jsonc-marker" };
  if (dialect === "json" && comment) return { confidence: 0.1, note: "jsonc-marker" };
  const extension = uri.split(/[?#]/u, 1)[0]?.split(".").at(-1)?.toLowerCase();
  return {
    confidence: extension === dialect ? 0.78 : 0.72,
    note: "json-jsonc-ambiguous"
  };
}

// packages/host/native-text/json/families/json/codec.js
function createJsonCodec(profile3, context) {
  return createTextCodec(
    {
      ...profile3,
      detect: (text, uri) => detectJson(profile3.dialect, text, uri)
    },
    context
  );
}

// packages/host/native-text/json/families/json/profiles/json.js
var profile = Object.freeze({
  format: "json",
  extensions: Object.freeze(["json"]),
  mediaType: "application/json",
  contract: "common.text-data/json-syntax",
  dialect: "json",
  semantic: "tree",
  implementationTier: 1
});

// packages/host/native-text/json/families/json/entrypoints/json-codec.js
var abiVersion = 1;
var createCodec = (context) => createJsonCodec(profile, context);

// packages/host/native-text/json/families/json/entrypoints/json-provider.js
var json_provider_exports = {};
__export(json_provider_exports, {
  abiVersion: () => abiVersion2,
  createProvider: () => createProvider,
  createTextSyntaxProvider: () => createTextSyntaxProvider2,
  provides: () => provides
});

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += "\n";
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "	";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      // tokens: []{}:,
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      // strings
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      // comments
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength2 = len - 1;
          let commentClosed = false;
          while (pos < safeLength2) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      // numbers
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      // found a minus, followed by a number so
      // we fall through to proceed with scanning
      // numbers
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      // literals and unknown symbols
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + " ".repeat(index);
    })
  },
  "	": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + "	".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "	".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + "	".repeat(index);
    })
  }
};

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parseTree(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: void 0 };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep, offset, length) => {
      if (currentParent.type === "property") {
        if (sep === ":") {
          currentParent.colonOffset = offset;
        } else if (sep === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error3, offset, length) => {
      errors.push({ error: error3, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(
            14
            /* ParseErrorCode.InvalidUnicode */
          );
          break;
        case 5:
          handleError(
            15
            /* ParseErrorCode.InvalidEscapeCharacter */
          );
          break;
        case 3:
          handleError(
            13
            /* ParseErrorCode.UnexpectedEndOfNumber */
          );
          break;
        case 1:
          if (!disallowComments) {
            handleError(
              11
              /* ParseErrorCode.UnexpectedEndOfComment */
            );
          }
          break;
        case 2:
          handleError(
            12
            /* ParseErrorCode.UnexpectedEndOfString */
          );
          break;
        case 6:
          handleError(
            16
            /* ParseErrorCode.InvalidCharacter */
          );
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(
              10
              /* ParseErrorCode.InvalidCommentToken */
            );
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(
            1
            /* ParseErrorCode.InvalidSymbol */
          );
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error3, skipUntilAfter = [], skipUntil = []) {
    onError(error3);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(
            2
            /* ParseErrorCode.InvalidNumberFormat */
          );
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
    } else {
      handleError(5, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [
        2
        /* SyntaxKind.CloseBraceToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [
          4,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [
        4
        /* SyntaxKind.CloseBracketToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parseTree2 = parseTree;
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}

// packages/host/native-text/json/families/json/provider.js
function jsonNode(node, text, counters, depth = 0) {
  counters.nodes += 1;
  counters.depth = Math.max(counters.depth, depth);
  const range = span(text, node.offset, node.length);
  if (node.type === "object") {
    return {
      kind: "object",
      members: (node.children ?? []).map((property) => ({
        key: String(property.children?.[0]?.value ?? ""),
        keyRange: span(
          text,
          property.children?.[0]?.offset ?? property.offset,
          property.children?.[0]?.length ?? 0
        ),
        value: jsonNode(property.children?.[1], text, counters, depth + 1)
      })),
      range
    };
  }
  if (node.type === "array") {
    return {
      kind: "array",
      items: (node.children ?? []).map((item) => jsonNode(item, text, counters, depth + 1)),
      range
    };
  }
  return {
    kind: "scalar",
    value: scalar(node.value, text.slice(node.offset, node.offset + node.length)),
    range
  };
}
function parseJson(decoded2, dialect, budget) {
  const errors = [];
  const root = parseTree2(decoded2.text, errors, {
    allowTrailingComma: dialect === "jsonc",
    disallowComments: dialect === "json"
  });
  if (!root || errors.length > 0) {
    const first = errors[0] ?? { error: 0, offset: 0, length: 0 };
    return failure(
      "modkit/text-data-json-parse",
      printParseErrorCode(first.error),
      decoded2.text,
      first.offset,
      first.length
    );
  }
  const counters = { nodes: 0, depth: 0 };
  const converted = jsonNode(root, decoded2.text, counters);
  if (counters.nodes > budget.maxNodes || counters.depth > budget.maxDepth) {
    return {
      state: "truncated",
      document: { dialect, root: converted, trivia: [], source: decoded2.source },
      truncated: { limit: counters.nodes > budget.maxNodes ? "maxNodes" : "maxDepth" },
      diagnostics: []
    };
  }
  return {
    state: "ok",
    document: { dialect, root: converted, trivia: [], source: decoded2.source },
    diagnostics: []
  };
}
function valueFromJsonNode(node) {
  if (node.kind === "scalar") {
    if (node.value.kind === "null") return null;
    if ("value" in node.value) return node.value.value;
    if (node.value.kind === "integer") return Number(node.value.decimal);
    return Number(node.value.raw);
  }
  if (node.kind === "array") return node.items.map(valueFromJsonNode);
  return Object.fromEntries(
    node.members.map((member) => [member.key, valueFromJsonNode(member.value)])
  );
}
function createJsonSyntaxProvider(definition) {
  return createTextSyntaxProvider({
    contract: definition.contract,
    parse: (decoded2, request) => parseJson(decoded2, definition.dialect, request.budget),
    serialize(request) {
      const text = `${JSON.stringify(valueFromJsonNode(request.document.root), null, 2)}
`;
      return encodeText(text, request.document.source, request.target);
    }
  });
}

// packages/host/native-text/json/families/json/entrypoints/json-provider.js
var abiVersion2 = 1;
var provides = Object.freeze([profile.contract]);
var createTextSyntaxProvider2 = () => createJsonSyntaxProvider(profile);
var createProvider = (selection) => lease(createSelectedProvider(profile, selection, createJsonSyntaxProvider));

// packages/host/native-text/json/families/json/entrypoints/jsonc-codec.js
var jsonc_codec_exports = {};
__export(jsonc_codec_exports, {
  abiVersion: () => abiVersion3,
  createCodec: () => createCodec2
});

// packages/host/native-text/json/families/json/profiles/jsonc.js
var profile2 = Object.freeze({
  format: "jsonc",
  extensions: Object.freeze(["jsonc"]),
  mediaType: "application/jsonc",
  contract: "common.text-data/jsonc-syntax",
  dialect: "jsonc",
  semantic: "tree",
  implementationTier: 1
});

// packages/host/native-text/json/families/json/entrypoints/jsonc-codec.js
var abiVersion3 = 1;
var createCodec2 = (context) => createJsonCodec(profile2, context);

// packages/host/native-text/json/families/json/entrypoints/jsonc-provider.js
var jsonc_provider_exports = {};
__export(jsonc_provider_exports, {
  abiVersion: () => abiVersion4,
  createProvider: () => createProvider2,
  createTextSyntaxProvider: () => createTextSyntaxProvider3,
  provides: () => provides2
});
var abiVersion4 = 1;
var provides2 = Object.freeze([profile2.contract]);
var createTextSyntaxProvider3 = () => createJsonSyntaxProvider(profile2);
var createProvider2 = (selection) => lease(createSelectedProvider(profile2, selection, createJsonSyntaxProvider));

// packages/host/native-text/json/editing/text-writer.js
var text_writer_exports = {};
__export(text_writer_exports, {
  abiVersion: () => abiVersion5,
  createProvider: () => createProvider3,
  provides: () => provides3
});
var PROVIDER_ID = "modkit/text-json-writer";
var EVIDENCE_ID = "text-json-text-writer-v1";
var ARTIFACT_DIGEST = "x3:modkit/text-json-writer@1.0.0";
var RANGE_KINDS = Object.freeze(["utf16", "bytes"]);
var PAYLOAD_KINDS = Object.freeze(["text", "inline"]);
var error = (code, message) => Object.freeze({ severity: "error", code, message });
function validateTextChange(change) {
  const diagnostics = [];
  if (change.targets.length === 0 || change.edits.length === 0) {
    diagnostics.push(
      error(
        "modkit/text-writer-change-empty",
        "a change set must carry at least one target and one edit"
      )
    );
  }
  const targetIds = new Set(change.targets.map((target) => target.targetId));
  const sourceIds = new Set(change.targets.map((target) => target.ownerSource.id));
  for (const edit of change.edits) {
    if (edit.operation !== "replace") {
      diagnostics.push(
        error(
          "modkit/text-writer-operation-unsupported",
          `a text writer rewrites its own source: \xAB${edit.operation}\xBB is not a text edit`
        )
      );
      continue;
    }
    if (!targetIds.has(edit.targetId) || !sourceIds.has(edit.source.id)) {
      diagnostics.push(
        error(
          "modkit/text-writer-target-foreign",
          `edit target \xAB${edit.targetId}\xBB is not a target of this change set`
        )
      );
      continue;
    }
    if (edit.range !== void 0 && !RANGE_KINDS.includes(edit.range.kind)) {
      diagnostics.push(
        error(
          "modkit/text-writer-range-unsupported",
          `\xAB${edit.range.kind}\xBB is not a text range (utf16 or bytes)`
        )
      );
      continue;
    }
    if (!PAYLOAD_KINDS.includes(edit.payload.kind)) {
      diagnostics.push(
        error(
          "modkit/text-writer-payload-unsupported",
          `\xAB${edit.payload.kind}\xBB payloads are not readable inline (text or inline)`
        )
      );
    }
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}
async function planTextEdits(change) {
  const result = validateTextChange(change);
  if (!result.valid) {
    throw new TypeError(result.diagnostics.map((item) => item.message).join("; "));
  }
  return change.edits;
}
function jsonSyntaxDiagnostics(change) {
  for (const edit of change.edits) {
    if (edit.operation !== "replace" || edit.range !== void 0) continue;
    if (edit.payload.kind !== "text") continue;
    try {
      JSON.parse(edit.payload.text);
    } catch (cause) {
      return [
        error(
          "modkit/text-writer-syntax-invalid",
          `the replacement is not valid JSON, and saving it would corrupt the file: ${cause instanceof Error ? cause.message : String(cause)}`
        )
      ];
    }
  }
  return [];
}
var textWriter = (formatId, syntaxDiagnostics) => defineWriter({
  providerId: PROVIDER_ID,
  providerVersion: "1.0.0",
  artifactDigest: ARTIFACT_DIGEST,
  offerId: `${formatId}-source`,
  formatId,
  representationId: "source",
  mutationMode: "mutate",
  minimumRoundTrip: "byte-identical",
  fidelityEvidenceId: EVIDENCE_ID,
  fidelity: Object.freeze({ roundTrip: "byte-identical", preservesUnknownData: true }),
  validate: async (change) => {
    const carried = validateTextChange(change);
    if (!carried.valid || syntaxDiagnostics === void 0) return carried;
    const syntax = syntaxDiagnostics(change);
    return syntax.length === 0 ? carried : Object.freeze({ valid: false, diagnostics: Object.freeze(syntax) });
  },
  planEdits: async (change) => {
    const syntax = syntaxDiagnostics === void 0 ? [] : syntaxDiagnostics(change);
    if (syntax.length > 0) {
      throw new TypeError(syntax.map((item) => item.message).join("; "));
    }
    return planTextEdits(change);
  }
});
var OFFERS = Object.freeze({
  "json-source": textWriter("json", jsonSyntaxDiagnostics),
  "jsonc-source": textWriter("jsonc")
});
var abiVersion5 = 1;
var provides3 = Object.freeze(["common.edit/writer"]);
async function createProvider3(selection) {
  const offered = OFFERS[selection.offerId];
  if (offered === void 0) throw new TypeError(`unknown writer offer ${selection.offerId}`);
  return offered.createProvider(selection);
}

// packages/host/native-text/plain/txt/codec.js
var codec_exports = {};
__export(codec_exports, {
  abiVersion: () => abiVersion6,
  createCodec: () => createCodec3
});
var CODEC_ID = "modkit/txt";
var TEXT_CONTROLS = /* @__PURE__ */ new Set([9, 10, 12, 13]);
var CONTROL_RATIO_LIMIT = 0.02;
var OPERATION_DECLARATIONS = Object.freeze([
  {
    id: "view.inspect",
    handlerId: "inspect",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "asset.validate",
    handlerId: "validate",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["none"]
  },
  {
    id: "asset.search",
    handlerId: "search",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "export.raw",
    handlerId: "export-raw",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["bytes"]
  }
]);
function extensionOf(uri) {
  const clean = uri.split(/[?#]/u, 1)[0] ?? "";
  const name = clean.slice(clean.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}
function decodeSample(bytes) {
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    return decodeWith(bytes.subarray(3), "utf-8", true);
  }
  if (bytes[0] === 255 && bytes[1] === 254) return decodeWith(bytes.subarray(2), "utf-16le", true);
  if (bytes[0] === 254 && bytes[1] === 255) return decodeWith(bytes.subarray(2), "utf-16be", true);
  return decodeWith(bytes, "utf-8", false);
}
function decodeWith(content, encoding, bom) {
  if (encoding === "utf-8" && content.includes(0)) {
    return { ok: false, encoding, bom, reason: "nul-byte" };
  }
  let text;
  try {
    if (encoding === "utf-16be") {
      const swapped = new Uint8Array(content.length - content.length % 2);
      for (let index = 0; index + 1 < swapped.length; index += 2) {
        swapped[index] = content[index + 1];
        swapped[index + 1] = content[index];
      }
      text = new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
    } else if (encoding === "utf-16le") {
      text = new TextDecoder("utf-16le", { fatal: true }).decode(
        content.subarray(0, content.length - content.length % 2)
      );
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    }
  } catch {
    return { ok: false, encoding, bom, reason: "undecodable" };
  }
  if (text.includes("\0")) return { ok: false, encoding, bom, reason: "nul-byte" };
  let controls = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 32 && !TEXT_CONTROLS.has(code)) controls += 1;
  }
  const ratio = text.length === 0 ? 0 : controls / text.length;
  if (ratio > CONTROL_RATIO_LIMIT) return { ok: false, encoding, bom, reason: "control-ratio" };
  return { ok: true, encoding, bom, text, reason: "bounded-text" };
}
function outline(text, maxNodes) {
  const lines = text.split(/\r\n|\n|\r/u);
  const paragraphs = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    paragraphs.push(current.join("\n"));
    current = [];
    if (paragraphs.length > maxNodes) throw new RangeError("text paragraphs exceed maxNodes budget");
  };
  for (const line of lines) {
    if (line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  const trimmed = text.trim();
  return {
    lines: lines.length,
    words: trimmed === "" ? 0 : trimmed.split(/\s+/u).length,
    characters: text.length,
    paragraphs
  };
}
function preview(value) {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}
function treeFor(shape) {
  return {
    kind: "document",
    label: "Plain text",
    preview: `${shape.lines} line(s), ${shape.words} word(s)`,
    children: shape.paragraphs.map((value, index) => ({
      kind: "paragraph",
      label: `Paragraph ${index + 1}`,
      preview: preview(value)
    }))
  };
}
var abiVersion6 = 1;
var createCodec3 = () => Object.freeze({
  async probe(request, signal) {
    if (request.source.kind !== "bytes" || request.plan.kind !== "bytes") {
      throw new TypeError("plain text accepts only byte candidates and byte probe plans");
    }
    const declared = Math.min(
      request.plan.maxBytes,
      request.plan.ranges[0]?.length ?? request.plan.maxBytes
    );
    const available = request.source.size === void 0 ? declared : Number(request.source.size);
    const length = Math.max(0, Math.min(declared, available));
    const bytes = await request.source.read(0n, length, signal);
    const uri = request.source.ref.uri;
    const required = [{ byteOffset: "0", byteLength: String(bytes.byteLength) }];
    const decoded2 = decodeSample(bytes);
    if (!decoded2.ok) {
      return {
        codecId: CODEC_ID,
        confidence: 0.02,
        evidence: [{ kind: "structure", weight: -1, note: decoded2.reason }],
        requiredRanges: required
      };
    }
    const known = extensionOf(uri) === "txt";
    return {
      codecId: CODEC_ID,
      confidence: known ? 0.9 : 0.6,
      evidence: [
        {
          kind: "structure",
          weight: 0.6,
          note: `${decoded2.encoding}${decoded2.bom ? "-bom" : ""}`
        },
        ...known ? [{ kind: "extension", weight: 0.3, note: "txt" }] : []
      ],
      requiredRanges: required
    };
  },
  async planInput(source) {
    if (source.kind === "derived") throw new TypeError("plain text requires a byte candidate");
    return {
      originKind: "single",
      candidate: { bindingId: "content", role: "content", ownership: "owned" },
      requirements: []
    };
  },
  async open(input, _intent, budget, signal) {
    if (input.originKind !== "single") throw new TypeError("plain text requires a single source");
    const binding = input.bindings[0];
    const sourceLease = await input.openBinding(binding.bindingId, signal);
    const source = sourceLease.value;
    if (source.kind !== "bytes" || source.size === void 0) {
      await sourceLease.release();
      throw new TypeError("plain text requires a sized byte source");
    }
    if (source.size > budget.maxInputBytes) {
      await sourceLease.release();
      throw new RangeError("plain text input exceeds the session budget");
    }
    const raw = await source.read(0n, Number(source.size), signal);
    const decoded2 = decodeSample(raw);
    if (!decoded2.ok) {
      await sourceLease.release();
      throw new TypeError(`plain text rejected a binary source (${decoded2.reason})`);
    }
    if (decoded2.text.length * 2 > budget.maxScalarBytes) {
      await sourceLease.release();
      throw new RangeError("decoded text exceeds the maxScalarBytes budget");
    }
    const shape = outline(decoded2.text, budget.maxNodes);
    const bytes = Object.freeze({
      size: async () => source.size,
      read: (offset, length, readSignal) => source.read(offset, length, readSignal)
    });
    const tree = createTreeDataSource(treeFor(shape));
    const utf8 = decoded2.encoding === "utf-8";
    const text = utf8 ? createUtf8TextDataSource(bytes) : void 0;
    const dataSources = [
      { contract: "common.view/tree-data-source", major: 1 },
      ...utf8 ? [{ contract: "common.view/text-data-source", major: 1 }] : [],
      { contract: "common.view/byte-range-source", major: 1 }
    ];
    const summary = {
      format: "txt",
      encoding: decoded2.encoding,
      bom: decoded2.bom,
      newline: newlineOf(decoded2.text),
      characters: shape.characters,
      lines: shape.lines,
      words: shape.words,
      paragraphs: shape.paragraphs.length
    };
    const descriptor = await assembleSubjectDescriptor({
      schemaVersion: 2,
      subjectUri: binding.source.uri,
      origin: {
        kind: "single",
        binding: {
          id: binding.bindingId,
          role: binding.role,
          source: binding.source,
          required: true,
          ownership: binding.ownership,
          revision: binding.revision,
          mediaType: "text/plain"
        }
      },
      interpretation: "codec",
      identity: {
        codecId: CODEC_ID,
        codecVersion: "1.0.0",
        formatId: "txt",
        formatLabel: "Plain Text Document",
        mediaType: "text/plain",
        confidence: 1,
        detection: [{ kind: "structure", weight: 0.9, note: decoded2.encoding }]
      },
      traits: [
        {
          id: "document.flow",
          descriptorVersion: 1,
          state: "available",
          parameters: { paragraphs: shape.paragraphs.length, lines: shape.lines }
        },
        {
          id: "structure.hierarchy",
          descriptorVersion: 1,
          state: "available",
          parameters: { nodeCount: shape.paragraphs.length, lazy: true, hasLocations: false }
        },
        {
          id: "content.text",
          descriptorVersion: 1,
          state: "available",
          parameters: {
            encoding: decoded2.encoding,
            bom: decoded2.bom,
            newline: summary.newline,
            lineCount: shape.lines,
            characters: shape.characters
          }
        },
        {
          id: "content.binary",
          descriptorVersion: 1,
          state: "available",
          parameters: { bytes: source.size.toString(10) }
        }
      ],
      operations: OPERATION_DECLARATIONS.map((operation) => ({
        id: operation.id,
        handlerId: operation.handlerId,
        mutatesSource: false,
        state: "available"
      })),
      constraints: {
        readOnly: true,
        seekable: true,
        randomAccess: true,
        trusted: false,
        maxDecodedBytes: source.size.toString(10)
      },
      dataSources,
      diagnostics: [],
      metadata: [
        {
          id: "plain-text",
          label: "Plain text",
          entries: Object.entries(summary).map(([key2, value]) => ({ key: key2, value }))
        }
      ],
      revision: input.revisions.revision
    });
    const handlers = /* @__PURE__ */ new Map([
      ["inspect", async () => ({ kind: "json", value: summary })],
      ["validate", async () => ({ kind: "none" })],
      [
        "search",
        async (operationInput) => {
          const pattern = operationInput !== null && typeof operationInput === "object" && typeof operationInput.pattern === "string" ? operationInput.pattern : "";
          if (pattern === "") return { kind: "json", value: [] };
          const matches = [];
          let index = decoded2.text.indexOf(pattern);
          while (index !== -1 && matches.length < budget.maxDiagnostics) {
            matches.push({ utf16Offset: index, utf16Length: pattern.length });
            index = decoded2.text.indexOf(pattern, index + Math.max(1, pattern.length));
          }
          return { kind: "json", value: matches };
        }
      ],
      ["export-raw", async () => ({ kind: "bytes", value: raw })]
    ]);
    const managed = createAssetSession({
      revision: revisionId(input.revisions.revision),
      descriptor,
      operationDeclarations: OPERATION_DECLARATIONS,
      permissionGrant: { id: "plain-text-session", classes: ["read-source"] },
      handlers,
      async openDataSource(contract) {
        if (contract === "common.view/tree-data-source") return lease(tree);
        if (contract === "common.view/byte-range-source") return lease(bytes);
        if (contract === "common.view/text-data-source" && text !== void 0) {
          return lease(text);
        }
        throw new TypeError(`modkit/txt does not publish ${contract}`);
      },
      release: [() => sourceLease.release()]
    });
    return managed.session;
  }
});

// packages/host/native-text/plain/editing/text-writer.js
var text_writer_exports2 = {};
__export(text_writer_exports2, {
  abiVersion: () => abiVersion7,
  createProvider: () => createProvider4,
  provides: () => provides4
});
var PROVIDER_ID2 = "modkit/plain-text-writer";
var RANGE_KINDS2 = Object.freeze(["utf16", "bytes"]);
var PAYLOAD_KINDS2 = Object.freeze(["text", "inline"]);
var error2 = (code, message) => Object.freeze({ severity: "error", code, message });
function validateTextChange2(change) {
  const diagnostics = [];
  if (change.targets.length === 0 || change.edits.length === 0) {
    diagnostics.push(
      error2(
        "modkit/text-writer-change-empty",
        "a change set must carry at least one target and one edit"
      )
    );
  }
  const targetIds = new Set(change.targets.map((target) => target.targetId));
  const sourceIds = new Set(change.targets.map((target) => target.ownerSource.id));
  for (const edit of change.edits) {
    if (edit.operation !== "replace") {
      diagnostics.push(
        error2(
          "modkit/text-writer-operation-unsupported",
          `a text writer rewrites its own source: \xAB${edit.operation}\xBB is not a text edit`
        )
      );
      continue;
    }
    if (!targetIds.has(edit.targetId) || !sourceIds.has(edit.source.id)) {
      diagnostics.push(
        error2(
          "modkit/text-writer-target-foreign",
          `edit target \xAB${edit.targetId}\xBB is not a target of this change set`
        )
      );
      continue;
    }
    if (edit.range !== void 0 && !RANGE_KINDS2.includes(edit.range.kind)) {
      diagnostics.push(
        error2(
          "modkit/text-writer-range-unsupported",
          `\xAB${edit.range.kind}\xBB is not a text range (utf16 or bytes)`
        )
      );
      continue;
    }
    if (!PAYLOAD_KINDS2.includes(edit.payload.kind)) {
      diagnostics.push(
        error2(
          "modkit/text-writer-payload-unsupported",
          `\xAB${edit.payload.kind}\xBB payloads are not readable inline (text or inline)`
        )
      );
    }
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}
var { abiVersion: abiVersion7, provides: provides4, createProvider: createProvider4 } = defineWriter({
  providerId: PROVIDER_ID2,
  providerVersion: "1.0.0",
  /** A module cannot see its own artifact digest; the host inventory carries the attested one. */
  artifactDigest: "x3:modkit/plain-text-writer@1.0.0",
  offerId: "plain-text-source",
  formatId: "txt",
  representationId: "source",
  mutationMode: "mutate",
  minimumRoundTrip: "byte-identical",
  fidelityEvidenceId: "plain-text-writer-v1",
  fidelity: Object.freeze({ roundTrip: "byte-identical", preservesUnknownData: true }),
  validate: async (change) => validateTextChange2(change),
  /** Pass-through: the editor authored the edits; the writer only refuses what it cannot carry. */
  planEdits: async (change) => {
    const result = validateTextChange2(change);
    if (!result.valid) throw new TypeError(result.diagnostics.map((item) => item.message).join("; "));
    return change.edits;
  }
});

// packages/host/dist/linked.js
var variantsOf = (manifest) => {
  const list = manifest.runtimeVariants;
  return Array.isArray(list) ? list : [];
};
var refuse2 = (message, context) => {
  throw new ModkitError({ code: "x3.host/linked-extension-invalid", message, context });
};
function defineLinkedExtension(init) {
  const modkit = init.packageJson.modkit;
  const publisher = typeof modkit?.publisher === "string" ? modkit.publisher : void 0;
  const id = typeof modkit?.id === "string" ? modkit.id : void 0;
  if (publisher === void 0 || id === void 0) {
    refuse2("linked extension package.json carries no modkit publisher/id", {
      source: init.source
    });
  }
  const coordinate2 = `${publisher}/${id}`;
  const automaticExcluded = [];
  const contributions = init.contributions.flatMap((contribution) => {
    const variants = variantsOf(contribution.manifest);
    if (variants.length === 0)
      return [contribution];
    const trusted = variants.filter((variant) => variant.executionProfile === "trusted-in-process");
    if (trusted.length === 0) {
      const manifestId = contribution.manifest.id;
      automaticExcluded.push({
        path: contribution.path,
        reason: `${typeof manifestId === "string" ? manifestId : contribution.path} declares no trusted-in-process variant, and linked code runs in-process by definition`
      });
      return [];
    }
    const manifest = contribution.manifest;
    return [{ ...contribution, manifest: { ...manifest, runtimeVariants: trusted } }];
  });
  const files = init.files ?? Object.freeze([
    "package.json",
    ...contributions.map((item) => item.path),
    ...Object.keys(init.modules).map((path) => path.replace(/^\.\//u, ""))
  ]);
  const artifactDigest = init.artifactDigest ?? `linked:${coordinate2}`;
  const artifactRoot = new URL(`modkit-linked://${publisher}.${id}/`.toLowerCase());
  const moduleEntries = [];
  for (const contribution of contributions) {
    for (const variant of variantsOf(contribution.manifest)) {
      if (variant.executionProfile !== "trusted-in-process") {
        refuse2("a linked contribution may declare only trusted-in-process variants", {
          source: init.source,
          path: contribution.path
        });
      }
      const entrypoint = typeof variant.entrypoint === "string" ? variant.entrypoint : "";
      const module = init.modules[entrypoint];
      if (module === void 0) {
        refuse2(`linked variant entrypoint \xAB${entrypoint}\xBB has no imported module`, {
          source: init.source,
          path: contribution.path
        });
        continue;
      }
      moduleEntries.push([resolveContainedEntrypoint(artifactRoot, entrypoint).href, module]);
    }
  }
  const input = Object.freeze({
    source: init.source,
    containers: Object.freeze({ packageJson: init.packageJson }),
    files: Object.freeze([...files]),
    documents: new Map(contributions.map((item) => [item.path, item.manifest])),
    documentDigests: new Map(contributions.map((item) => [item.path, item.digest ?? `linked:${coordinate2}:${item.path}`])),
    artifact: Object.freeze({
      inventoryRecordId: `linked:${coordinate2}`,
      artifactDigest,
      artifactRoot,
      // the bytes cannot change under a linked artifact: they are the caller's own bundle
      verifyArtifactDigest: (expected) => expected === artifactDigest
    }),
    /*
     * `allowTrustedInProcess: true` is the point, not an oversight: linking is the artifact-level
     * trust decision (see the module header). The gate still refuses any variant that is not
     * declared `trusted-in-process`, and still emits its audit notice on every activation.
     */
    execution: Object.freeze({ origin: "bundled", allowTrustedInProcess: true })
  });
  return Object.freeze({
    coordinate: coordinate2,
    input,
    moduleEntries: Object.freeze(moduleEntries),
    excluded: Object.freeze([...automaticExcluded, ...init.excluded ?? []])
  });
}
function defineBuiltinModule(init) {
  const parts = init.coordinate.split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    refuse2("built-in module coordinate must be publisher/id", { coordinate: init.coordinate });
  }
  const [publisher = "", id = ""] = parts;
  const packageJson = init.packageJson ?? {};
  const existingModkit = packageJson.modkit;
  const modkit = typeof existingModkit === "object" && existingModkit !== null ? existingModkit : {};
  const linked = defineLinkedExtension({
    source: init.source ?? `builtin:${init.coordinate}`,
    packageJson: {
      ...packageJson,
      modkit: {
        ...modkit,
        schemaVersion: modkit.schemaVersion ?? 1,
        publisher,
        id,
        contributionManifests: modkit.contributionManifests ?? init.contributions.map((item) => `./${item.path.replace(/^\.\//u, "")}`)
      }
    },
    ...init.files === void 0 ? {} : { files: init.files },
    contributions: init.contributions,
    ...init.excluded === void 0 ? {} : { excluded: init.excluded },
    artifactDigest: init.artifactDigest ?? `builtin:${init.coordinate}`,
    modules: init.modules
  });
  return Object.freeze({ ...linked, kind: "builtin" });
}
function linkedExtensionInputs(linked) {
  const modules = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  const inputs = [];
  const coordinates = [];
  const excluded = [];
  for (const extension of linked) {
    if (seen.has(extension.coordinate)) {
      continue;
    }
    seen.add(extension.coordinate);
    inputs.push(extension.input);
    coordinates.push(extension.coordinate);
    for (const [href, module] of extension.moduleEntries)
      modules.set(href, module);
    for (const item of extension.excluded)
      excluded.push({ ...item, coordinate: extension.coordinate });
  }
  return Object.freeze({
    inputs: Object.freeze(inputs),
    modules,
    coordinates: Object.freeze(coordinates),
    excluded: Object.freeze(excluded)
  });
}

// packages/host/dist/native-text.js
var NATIVE_ENVIRONMENTS = Object.freeze(["node", "node-worker", "browser-main", "browser-worker"]);
var nativeExecutable = (manifest, entrypoint) => {
  const document = manifest;
  const variants = Array.isArray(document.runtimeVariants) ? document.runtimeVariants : [];
  if (variants.length === 0)
    return manifest;
  const selected = variants.find((variant) => typeof variant === "object" && variant !== null && variant.executionProfile === "trusted-in-process") ?? variants[0];
  if (typeof selected !== "object" || selected === null)
    return manifest;
  return {
    ...document,
    runtimeVariants: [
      {
        ...selected,
        variantId: "core-native",
        ...entrypoint === void 0 ? {} : { entrypoint },
        executionProfile: "trusted-in-process",
        target: { environments: NATIVE_ENVIRONMENTS }
      }
    ]
  };
};
var nativeText = defineLinkedExtension({
  source: "native:core/text",
  packageJson: {
    name: "@modkit/core-native-text",
    version: "1.0.0",
    license: "MIT",
    modkit: {
      schemaVersion: 1,
      publisher: "modkit",
      id: "core-native-text",
      contributionManifests: ["./contributions/*.json"]
    }
  },
  contributions: [
    { path: "contributions/codec-txt.json", manifest: nativeExecutable(codec_txt_default) },
    {
      path: "contributions/writer-plain-text.json",
      manifest: nativeExecutable(writer_plain_text_default)
    },
    { path: "contributions/codec-json.json", manifest: nativeExecutable(codec_json_default) },
    { path: "contributions/codec-jsonc.json", manifest: nativeExecutable(codec_jsonc_default) },
    { path: "contributions/contract-json-syntax.json", manifest: contract_json_syntax_default },
    { path: "contributions/contract-jsonc-syntax.json", manifest: contract_jsonc_syntax_default },
    { path: "contributions/provider-json-default.json", manifest: nativeExecutable(provider_json_default_default) },
    {
      path: "contributions/provider-jsonc-default.json",
      manifest: nativeExecutable(provider_jsonc_default_default)
    },
    {
      path: "contributions/writer-json.json",
      manifest: nativeExecutable(writer_json_default)
    }
  ],
  modules: {
    "./plain/txt/codec.js": codec_exports,
    "./plain/editing/text-writer.js": text_writer_exports2,
    "./json/editing/text-writer.js": text_writer_exports,
    "./json/families/json/entrypoints/json-codec.js": json_codec_exports,
    "./json/families/json/entrypoints/json-provider.js": json_provider_exports,
    "./json/families/json/entrypoints/jsonc-codec.js": jsonc_codec_exports,
    "./json/families/json/entrypoints/jsonc-provider.js": jsonc_provider_exports
  }
});
var NATIVE_TEXT_INPUT = nativeText.input;
var NATIVE_TEXT_MODULES = new Map(nativeText.moduleEntries);
function withNativeTextModules(linked = /* @__PURE__ */ new Map()) {
  return new Map([...NATIVE_TEXT_MODULES, ...linked]);
}

// packages/host/dist/composition.js
async function createHostComposition(options) {
  const topology = createHostTopology(options.topology);
  const profile3 = topology.realms.find((candidate) => candidate.realmId === options.realmId);
  if (profile3 === void 0) {
    throw new ModkitError({
      code: "x3.host/unknown-composition-realm",
      message: `host topology \xAB${topology.topologyId}\xBB has no realm \xAB${options.realmId}\xBB`,
      context: { topologyId: topology.topologyId, realmId: options.realmId }
    });
  }
  const inventory = await buildInventory([NATIVE_TEXT_INPUT, ...options.extensions ?? []], options.contributionContracts ?? createHostContributionContractRegistry(), {
    ...options.disabledExtensions === void 0 ? {} : { disabledExtensions: options.disabledExtensions },
    ...options.disabledContributions === void 0 ? {} : { disabledContributions: options.disabledContributions }
  });
  return Object.freeze({
    topology,
    profile: profile3,
    target: runtimeTargetForHostRealm(profile3),
    profileCacheKey: hostRealmCacheKey(profile3),
    inventory,
    executionBackends: options.executionBackends ?? DEFAULT_EXECUTION_BACKENDS
  });
}

// packages/host/dist/format-writer.js
var diagnostic2 = (severity, code, message) => ({ severity, code, message, path: [] });
async function resolveFormatWriter(request) {
  const identity = request.opened.descriptor.identity;
  const formatId = typeof identity?.formatId === "string" ? identity.formatId : void 0;
  if (formatId === void 0) {
    return {
      diagnostics: [
        diagnostic2("information", "x3.host/format-writer-unavailable", "the subject names no format (unresolved or built-in), so no format writer can be asked for")
      ]
    };
  }
  if (request.services.serviceDefinitions === void 0) {
    return {
      diagnostics: [
        diagnostic2("information", "x3.host/format-writer-unavailable", "this host registered no service-contract definitions, so writers cannot be resolved")
      ]
    };
  }
  const facet = {
    formatId,
    representationId: request.representationId ?? "source",
    mutationMode: request.mutationMode ?? "mutate",
    minimumRoundTrip: request.minimumRoundTrip ?? "byte-identical"
  };
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions: request.services.serviceDefinitions,
    grant: request.grant,
    budgets: request.budgets
  });
  try {
    const lease2 = await resolver.port.resolve({
      contract: "common.edit/writer",
      major: 1,
      facet
    });
    const writer = lease2.value;
    return {
      writer,
      release: () => lease2.release(),
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic2("information", "x3.host/format-writer-selected", `\xAB${writer.offer.providerId}\xBB writes ${facet.formatId}/${facet.representationId} at ${writer.offer.minimumRoundTrip}`)
      ]
    };
  } catch (error3) {
    return {
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic2("information", "x3.host/format-writer-unresolved", `no writer offers ${facet.formatId}/${facet.representationId} at ${facet.minimumRoundTrip} (${error3 instanceof Error ? error3.message : String(error3)})`)
      ]
    };
  }
}

export {
  EXTENSION_DISABLED_CODE,
  CONTRIBUTION_DISABLED_CODE,
  buildInventory,
  inventoryHasErrors,
  PROVIDER_OFFER_INVENTORY_FACT,
  VIEWER_CONTRIBUTION_INVENTORY_FACT,
  createHostContributionContractRegistry,
  offersFromInventory,
  assertRelativeEntrypoint,
  resolveContainedEntrypoint,
  LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES,
  loadLocalizationCatalogs,
  COMMAND_CANCELLED,
  COMMAND_SUBJECT_UNRESOLVED,
  COMMAND_INPUT_INVALID,
  COMMAND_UNKNOWN,
  COMMAND_UNAVAILABLE,
  commandDiagnostic,
  ok,
  unavailable,
  failed,
  createCommandRuntime,
  COMMAND_PROTOCOL_SCHEMA_VERSION,
  describeCommandContracts,
  commandRequest,
  executeCommandRequest,
  SUBJECT_COMMAND_TARGETS,
  SUBJECT_COMMANDS,
  commandSubjectsFrom,
  DEFAULT_COMMAND_MAX_CONCURRENT_RUNS,
  createSubjectCommandEndpoint,
  createSubjectCommandRuntime,
  describeSubjectCommandContracts,
  buildCodecDetectionSelection,
  serializeCodecDetectionSelection,
  parseCodecDetectionSelection,
  replayCodecDetectionSelection,
  DETECTION_EVIDENCE_LADDER,
  compareDetectionEvidence,
  DETECTION_UNTIE_RULES,
  isDetectionUntieRule,
  artifactByteSourceFromRandomAccess,
  RESOLVER_VERSION,
  resolveProvider,
  buildLockKey,
  buildLockEntry,
  serializePolicyLock,
  parsePolicyLock,
  replayPolicyLock,
  resolveServiceProvider,
  createContractResolverPort,
  createExecutionBackendRegistry,
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  linkedInProcessBackend,
  DEFAULT_EXECUTION_BACKENDS,
  resolveForActivation,
  activateContribution,
  activateServiceProvider,
  createHostServiceResolver,
  assembleSubjectDescriptor,
  createAssetSession,
  openSubject,
  createVfsCompanionOrigin,
  createVfsInputResolver,
  artifactNamespaceSourceFromVfsMount,
  createWorkspaceNamespaceCandidateDiscovery,
  NESTED_SUBJECT_UNSUPPORTED,
  NESTED_ENTRY_UNREADABLE,
  nestedSubjectServices,
  openNestedSubject,
  FACETLESS_SERVICE_MATCHER_PROFILE,
  createServiceFacetMatcherProfileRegistry,
  createServiceContractDefinitionRegistry,
  registerServiceContractDefinitionsFromInventory,
  STANDARD_EDITING_OWNER,
  WRITER_FACET_MATCHER,
  WRITER_CONTRACT_DEFINITION,
  STANDARD_EDITING_DEFINITIONS,
  registerStandardEditingDefinitions,
  LANGUAGE_WORKSPACE_NOT_INITIALIZED,
  LANGUAGE_WORKSPACE_SHUT_DOWN,
  LANGUAGE_DOCUMENT_ALREADY_OPEN,
  LANGUAGE_DOCUMENT_NOT_OPEN,
  LANGUAGE_DOCUMENT_CHANGE_INVALID,
  LANGUAGE_PROVIDER_FAILED,
  LANGUAGE_ANALYSIS_INVALID,
  LANGUAGE_FEATURE_INVALID,
  LANGUAGE_DEFAULT_MAX_RESULTS,
  LANGUAGE_MAX_RESULTS,
  LANGUAGE_DEFAULT_MAX_DOCUMENTS,
  LANGUAGE_MAX_DOCUMENTS,
  LANGUAGE_DEFAULT_MAX_EDITS,
  LANGUAGE_MAX_EDITS,
  languageProviderRoutes,
  createLanguageWorkspace,
  STANDARD_LANGUAGE_OWNER,
  LANGUAGE_DOCUMENT_MATCHER,
  LANGUAGE_DOCUMENT_CONTRACT_DEFINITION,
  registerStandardLanguageDefinitions,
  resolveLanguageProvider,
  STANDARD_RUNTIME_OWNER,
  RUNTIME_PROVIDER_MATCHER,
  RUNTIME_PROVIDER_CONTRACT_DEFINITION,
  RUNTIME_SESSION_CONTRACT_DEFINITION,
  STANDARD_RUNTIME_DEFINITIONS,
  registerStandardRuntimeDefinitions,
  openRuntimeSession,
  STANDARD_RENDERER_OWNER,
  SCENE_RENDERER_MATCHER,
  SCENE_RENDERER_CONTRACT_DEFINITION,
  registerStandardRendererDefinitions,
  resolveSceneRenderer,
  STANDARD_GAMES_OWNER,
  GAME_INSTALLATION_MATCHER,
  GAME_INSTALLATION_CONTRACT_DEFINITION,
  GAME_LAUNCH_PLAN_CONTRACT_DEFINITION,
  registerStandardGameDefinitions,
  resolveGameInstallationDiscovery,
  discoverGameInstallations,
  resolveGameLaunchPlanner,
  planGameLaunch,
  STANDARD_MODS_OWNER,
  MOD_WORKSPACE_MATCHER,
  MOD_WORKSPACE_CONTRACT_DEFINITION,
  registerStandardModDefinitions,
  resolveModWorkspaceComposition,
  STANDARD_DATA_OWNER,
  DATA_CATALOG_MATCHER,
  RESOLVED_DATA_WORKSPACE_MATCHER,
  DATA_CATALOG_CONTRACT_DEFINITION,
  RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION,
  registerStandardDataDefinitions,
  resolveDataCatalogAnalysis,
  resolveResolvedDataWorkspace,
  createResolvedDataSubjectSelectorLease,
  analyzeResolvedDataWorkspace,
  createCandidateWorldSceneLease,
  STANDARD_MAPS_OWNER,
  MAP_SEMANTIC_MATCHER,
  MAP_PREVIEW_PREPARATION_MATCHER,
  MAP_SEMANTIC_CONTRACT_DEFINITION,
  RESOLVED_MAP_WORKSPACE_CONTRACT_DEFINITION,
  MAP_PREVIEW_PREPARATION_CONTRACT_DEFINITION,
  registerStandardMapDefinitions,
  resolveMapSemanticAnalysis,
  resolveResolvedMapWorkspace,
  resolveMapPreviewPreparation,
  analyzeResolvedMapWorkspace,
  openMapPreviewAssetSession,
  coordinateMapPreviewAssetSession,
  describeInventoryContributions,
  supportedExtensionHints,
  createSubjectServices,
  createBundledServiceDefinitionRegistry,
  registerServiceDefinitionsOrThrow,
  serviceDefinitionSurfaces,
  SUBJECT_SERVICES,
  SUBJECT_EDITING,
  SUBJECT_SERVICES_URL,
  subjectRpcSurfaces,
  subjectOpenSnapshot,
  exposeSubjectRpc,
  connectSubjectRpc,
  HOST_RAW_WRITER_IDENTITY,
  createRawWriter,
  HOST_RAW_WRITER_EVIDENCE_ID,
  codecFidelityEvidenceRecords,
  serviceProviderFidelityEvidenceRecord,
  HOST_RAW_WRITER_EVIDENCE_RECORD,
  createEvidenceRegistry,
  createGrantSnapshot,
  createCommitCoordinator,
  createEditSession,
  assetRevisionFromDescriptor,
  subjectEditTargetsFromDescriptor,
  NO_STAGED_PAYLOADS,
  createSubjectEditing,
  createKnowledgeCatalog,
  explainProviderResolution,
  renderProviderResolutionExplanation,
  createV1DescriptorProjectionPort,
  createByteRangeSource,
  createUtf8TextDataSource,
  createLazyTableDataSource,
  COMMON_PRESENTATION_CATALOG,
  evaluateViewerApplicability,
  evaluateViewerContribution,
  resolveSessionPresentationPlan,
  resolveCommonPresentationPlan,
  resolveModelWorldPresentationPlan,
  createPresentationPlanValidator,
  resolvePresentationPlan,
  switchPresentationStage,
  createViewerSources,
  presentationSemanticHash,
  defineLinkedExtension,
  defineBuiltinModule,
  linkedExtensionInputs,
  NATIVE_TEXT_INPUT,
  NATIVE_TEXT_MODULES,
  withNativeTextModules,
  createHostComposition,
  resolveFormatWriter
};
