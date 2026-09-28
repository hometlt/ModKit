import {
  ModkitError,
  UINT64_DECIMAL_PATTERN,
  canonicalJsonStringify,
  compareUtf8,
  deepFreeze,
  diagnostic,
  hasErrors,
  isQualifiedId,
  operationId,
  parseSemver,
  sourceSpanSchema,
  traitId,
  uint64,
  uniqueSortedUtf8
} from "./chunk-LX6GSJ3D.js";

// packages/sdk/dist/schemas/patterns.js
var DOTTED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var NAMESPACED_DOTTED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var OPERATION_PATTERN = "^(?:[a-z0-9]+(?:-[a-z0-9]+)*\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*|[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\.[a-z0-9]+(?:-[a-z0-9]+)*)$";
var QUALIFIED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var SEGMENT_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
var SEMVER_PATTERN = "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";
var RANGE_NUMBER = "(?:0|[1-9]\\d*)";
var RANGE_NUMERIC = `${RANGE_NUMBER}(?:\\.${RANGE_NUMBER}){0,2}`;
var RANGE_EXACT = `=?${RANGE_NUMBER}\\.${RANGE_NUMBER}\\.${RANGE_NUMBER}`;
var RANGE_WILDCARD = `(?:${RANGE_NUMBER}\\.(?:x|\\*)|${RANGE_NUMBER}\\.${RANGE_NUMBER}\\.(?:x|\\*))`;
var RANGE_CARET = `\\^${RANGE_NUMBER}\\.${RANGE_NUMBER}(?:\\.${RANGE_NUMBER})?`;
var RANGE_COMPARATOR = `[<>]=?${RANGE_NUMERIC}`;
var RANGE_ATOM = `(?:${RANGE_EXACT}|${RANGE_WILDCARD}|${RANGE_CARET}|${RANGE_COMPARATOR})`;
var VERSION_RANGE_PATTERN = `^(?:\\*|x|${RANGE_ATOM}(?: ${RANGE_ATOM})*)$`;
var RELATIVE_ENTRYPOINT_PATTERN = "^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!/)(?!\\\\)(?:(?!\\.\\.(?:/|$))[^\\\\/\\u0000-\\u001f]+/)*(?!\\.\\.$)[^\\\\/\\u0000-\\u001f]+$";
var METHOD_NAME_PATTERN = "^[a-z][a-zA-Z0-9]{0,63}$";

// packages/sdk/dist/schemas/extension-manifest.js
var REQUIREMENT_SCOPE_KINDS = Object.freeze([
  "contribution",
  "offer",
  "operation",
  "intent",
  "variant",
  "profile",
  "projection",
  "slot"
]);
var requirementScopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id"],
  properties: {
    kind: { enum: REQUIREMENT_SCOPE_KINDS },
    id: { type: "string", minLength: 1 }
  }
};
var extensionRequirementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/extension-requirement.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["extension", "mode", "scope"],
  properties: {
    extension: { type: "string", pattern: QUALIFIED_PATTERN },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN },
    mode: { enum: ["required", "default", "suggested", "integrates"] },
    scope: requirementScopeSchema
  }
};
var contributionManifestsSchema = {
  type: "array",
  items: { type: "string", minLength: 1 }
};
var EXTENSION_VFS_PATH_PATTERN = "^(?:\\./)?(?![A-Za-z]:)(?!\\\\)(?!.*\\\\)(?!.*\\u0000)(?!\\.{1,2}(?:/|$))(?!.*\\/\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$";
var extensionVendorDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "displayName"],
  properties: {
    id: { type: "string", pattern: DOTTED_PATTERN },
    displayName: { type: "string", minLength: 1 }
  }
};
var extensionGameDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "displayName"],
  properties: {
    id: { type: "string", pattern: QUALIFIED_PATTERN },
    displayName: { type: "string", minLength: 1 }
  }
};
var extensionAssetReferenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: { type: "string", pattern: EXTENSION_VFS_PATH_PATTERN },
    displayName: { type: "string", minLength: 1 },
    mediaType: { type: "string", minLength: 1 }
  }
};
var extensionSourceDetailsSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "root"],
      properties: {
        kind: { const: "root" },
        root: { type: "string", pattern: EXTENSION_VFS_PATH_PATTERN }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "url"],
      properties: {
        kind: { const: "url" },
        url: { type: "string", pattern: "^https?://[^\\s]+$" }
      }
    }
  ]
};
var extensionPresentationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    displayName: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    vendor: extensionVendorDescriptorSchema,
    games: { type: "array", items: extensionGameDescriptorSchema },
    icon: extensionAssetReferenceSchema,
    source: extensionSourceDetailsSchema,
    licenseFiles: { type: "array", items: extensionAssetReferenceSchema }
  }
};
var LANGUAGE_TOKEN = { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,63}$" };
var languageFilesSchema = {
  type: "array",
  maxItems: 64,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["extension", "languageId"],
    properties: { extension: LANGUAGE_TOKEN, languageId: LANGUAGE_TOKEN, dialect: LANGUAGE_TOKEN }
  }
};
var HTTP_URL = { type: "string", pattern: "^https?://[^\\s]+$", maxLength: 512 };
var credentialsSchema = {
  type: "array",
  maxItems: 32,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "kind", "label"],
    properties: {
      id: { type: "string", pattern: "^[a-z0-9][a-z0-9.-]*/[a-z0-9][a-z0-9._-]*$", maxLength: 128 },
      kind: { enum: ["api-key", "oauth2-pkce", "provider-session", "symmetric-key"] },
      label: { type: "string", minLength: 1, maxLength: 128 },
      audience: { type: "array", maxItems: 16, items: HTTP_URL },
      header: { type: "string", pattern: "^[A-Za-z0-9-]{1,64}$" },
      scopes: {
        type: "array",
        maxItems: 32,
        items: { type: "string", minLength: 1, maxLength: 128 }
      },
      oauth: {
        type: "object",
        additionalProperties: false,
        required: ["authorizationEndpoint", "tokenEndpoint"],
        properties: {
          authorizationEndpoint: HTTP_URL,
          tokenEndpoint: HTTP_URL,
          revocationEndpoint: HTTP_URL,
          clientId: { type: "string", minLength: 1, maxLength: 256 },
          clientIdSetting: { type: "string", pattern: "^[A-Za-z0-9._-]{1,64}$" },
          loopbackPort: { type: "integer", minimum: 1024, maximum: 65535 },
          loopbackHost: { enum: ["localhost", "127.0.0.1"] }
        }
      },
      scoped: { type: "boolean" },
      environment: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,63}$" },
      replacesSettings: {
        type: "array",
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["contribution", "key"],
          properties: {
            contribution: { type: "string", minLength: 1, maxLength: 256 },
            key: { type: "string", pattern: "^[A-Za-z0-9._-]{1,64}$" },
            scoped: { const: true }
          }
        }
      },
      scopeFormat: { enum: ["hex"] }
    }
  }
};
var extensionManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/extension-manifest.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "publisher", "id", "version", "license", "contributionManifests"],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: "string", pattern: DOTTED_PATTERN },
    id: { type: "string", pattern: DOTTED_PATTERN },
    version: { type: "string", pattern: SEMVER_PATTERN },
    license: { type: "string", minLength: 1 },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: "array", items: extensionRequirementSchema },
    presentation: extensionPresentationSchema,
    contentSources: { type: "string", pattern: EXTENSION_VFS_PATH_PATTERN },
    languageFiles: languageFilesSchema,
    credentials: credentialsSchema
  }
};
var modkitBlockSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/extension-manifest-modkit-block.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "publisher", "id", "contributionManifests"],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: "string", pattern: DOTTED_PATTERN },
    id: { type: "string", pattern: DOTTED_PATTERN },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: "array", items: extensionRequirementSchema },
    presentation: extensionPresentationSchema,
    contentSources: { type: "string", pattern: EXTENSION_VFS_PATH_PATTERN },
    languageFiles: languageFilesSchema,
    credentials: credentialsSchema
  }
};
deepFreeze(requirementScopeSchema);
deepFreeze(extensionRequirementSchema);
deepFreeze(extensionVendorDescriptorSchema);
deepFreeze(extensionGameDescriptorSchema);
deepFreeze(extensionAssetReferenceSchema);
deepFreeze(extensionSourceDetailsSchema);
deepFreeze(extensionPresentationSchema);
deepFreeze(extensionManifestSchema);
deepFreeze(modkitBlockSchema);

// packages/sdk/dist/schemas/contribution-manifest.js
var EXECUTION_PROFILES = Object.freeze([
  "browser-sandbox",
  "worker-brokered",
  "process-brokered",
  "wasm-brokered",
  "trusted-in-process",
  "remote-provider"
]);
var PERMISSION_CLASSES = Object.freeze([
  "read-source",
  "write-source",
  "filesystem-read",
  "filesystem-write",
  "network",
  "process-launch",
  "native-code",
  "credentials",
  "clipboard",
  "persistent-storage"
]);
var RUNTIME_ENVIRONMENTS = Object.freeze([
  "browser-main",
  "browser-worker",
  "node",
  "node-worker",
  "wasm",
  "native",
  "external-tool"
]);
var OPERATING_SYSTEMS = Object.freeze([
  "any",
  "windows",
  "linux",
  "darwin",
  "android",
  "ios"
]);
var ARCHITECTURES = Object.freeze([
  "any",
  "x86",
  "x64",
  "arm32",
  "arm64",
  "wasm32"
]);
var runtimeTargetConstraintSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    environments: { type: "array", items: { enum: RUNTIME_ENVIRONMENTS }, minItems: 1 },
    operatingSystems: { type: "array", items: { enum: OPERATING_SYSTEMS }, minItems: 1 },
    architectures: { type: "array", items: { enum: ARCHITECTURES }, minItems: 1 },
    requiredHostCapabilities: { type: "array", items: { type: "string", minLength: 1 } },
    requiredWebApis: { type: "array", items: { type: "string", minLength: 1 } },
    externalTools: { type: "array", items: { type: "string", minLength: 1 } }
  }
};
var runtimeVariantDeclarationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/runtime-variant-declaration.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["variantId", "entrypoint", "target", "executionProfile", "requestedPermissionClasses"],
  properties: {
    variantId: { type: "string", pattern: SEGMENT_PATTERN },
    // Containment is enforced twice: here (authoring gate) and again by the host before
    // any import (MK3/24 §8) — the host never trusts that someone validated the input.
    entrypoint: { type: "string", pattern: RELATIVE_ENTRYPOINT_PATTERN },
    target: runtimeTargetConstraintSchema,
    executionProfile: { enum: EXECUTION_PROFILES },
    requestedPermissionClasses: { type: "array", items: { enum: PERMISSION_CLASSES } }
  }
};
var scopedContractRequirementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/scoped-contract-requirement.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["contract", "major", "mode", "scope"],
  properties: {
    contract: { type: "string", pattern: QUALIFIED_PATTERN },
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN },
    mode: { enum: ["required", "default", "suggested", "integrates"] },
    scope: requirementScopeSchema
  }
};
var contributionManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/contribution-manifest.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "contract", "id", "displayName", "spec"],
  properties: {
    schemaVersion: { const: 1 },
    contract: {
      type: "object",
      additionalProperties: false,
      required: ["id", "major"],
      properties: {
        id: { type: "string", pattern: QUALIFIED_PATTERN },
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    id: { type: "string", pattern: QUALIFIED_PATTERN },
    displayName: { type: "string", minLength: 1 },
    status: { enum: ["supported", "partial", "unsupported", "experimental"] },
    runtimeVariants: { type: "array", items: runtimeVariantDeclarationSchema },
    dependsOn: { type: "array", items: scopedContractRequirementSchema },
    limitations: { type: "array", items: { type: "string", minLength: 1 } },
    spec: { title: "JsonValue" }
  }
};
deepFreeze(runtimeTargetConstraintSchema);
deepFreeze(runtimeVariantDeclarationSchema);
deepFreeze(scopedContractRequirementSchema);
deepFreeze(contributionManifestSchema);

// packages/sdk/dist/asset-capabilities/data-source-ids.js
var STANDARD_DATA_SOURCE_CONTRACTS = Object.freeze([
  "common.view/text-data-source",
  "common.view/byte-range-source",
  "common.view/tree-data-source",
  "common.view/table-data-source",
  "common.view/transport-source",
  "common.view/namespace-entry-source",
  "common.view/raster-image-source",
  "common.view/vector-scene-source",
  "common.view/audio-media-source",
  "common.view/video-media-source",
  "common.view/model-scene-source",
  "common.view/world-scene-source",
  // optional model facets beside the base scene source (block 11, slice 11C0, plan item 11)
  "common.view/model-resource-refs-source",
  "common.view/model-skeleton-source",
  "common.view/model-animation-source",
  "common.view/model-collision-source",
  "common.view/model-material-source",
  "common.view/model-socket-source",
  "common.view/model-effect-source",
  "common.view/model-light-source",
  "common.view/model-camera-source",
  "common.view/model-physics-source",
  "common.view/model-node-behaviour-source",
  "common.view/model-lod-source",
  "common.view/relation-graph-source",
  "common.view/subject-selector-source",
  "common.view/subject-facts-source",
  "common.view/subject-calculations-source",
  "common.view/slide-deck-source"
]);
var DATA_SOURCE_MATURITY = Object.freeze({
  "common.view/text-data-source": "admitted",
  "common.view/byte-range-source": "admitted",
  "common.view/tree-data-source": "admitted",
  "common.view/table-data-source": "admitted",
  "common.view/transport-source": "admitted",
  "common.view/namespace-entry-source": "admitted",
  "common.view/raster-image-source": "admitted",
  "common.view/vector-scene-source": "admitted",
  "common.view/audio-media-source": "admitted",
  "common.view/video-media-source": "admitted",
  "common.view/model-scene-source": "admitted",
  "common.view/world-scene-source": "publisher-candidate",
  "common.view/model-resource-refs-source": "admitted",
  "common.view/model-skeleton-source": "admitted",
  "common.view/model-animation-source": "admitted",
  "common.view/model-collision-source": "admitted",
  "common.view/model-material-source": "admitted",
  "common.view/model-socket-source": "publisher-candidate",
  "common.view/model-effect-source": "publisher-candidate",
  "common.view/model-light-source": "publisher-candidate",
  "common.view/model-camera-source": "publisher-candidate",
  "common.view/model-physics-source": "publisher-candidate",
  "common.view/model-node-behaviour-source": "publisher-candidate",
  "common.view/model-lod-source": "publisher-candidate",
  "common.view/relation-graph-source": "admitted",
  "common.view/subject-selector-source": "admitted",
  "common.view/subject-facts-source": "admitted",
  "common.view/subject-calculations-source": "admitted",
  "common.view/slide-deck-source": "publisher-candidate"
});
var ADMITTED_DATA_SOURCE_CONTRACTS = Object.freeze(STANDARD_DATA_SOURCE_CONTRACTS.filter((contract) => DATA_SOURCE_MATURITY[contract] === "admitted"));
function dataSourceMaturity(contract) {
  return STANDARD_DATA_SOURCE_CONTRACTS.includes(contract) ? DATA_SOURCE_MATURITY[contract] : void 0;
}

// packages/sdk/dist/knowledge/index.js
var KNOWLEDGE_LOCALE_PATTERN = "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$";
var knowledgeLocalePattern = new RegExp(KNOWLEDGE_LOCALE_PATTERN, "u");
var isKnowledgeLocaleTag = (value) => typeof value === "string" && value.length <= 64 && knowledgeLocalePattern.test(value);
var localeKey = (locale) => locale.toLowerCase();
var isBoundedString = (value, maximum) => typeof value === "string" && value.length > 0 && value.length <= maximum;
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var hasOnlyKeys = (value, allowed) => {
  const accepted = new Set(allowed);
  return Object.keys(value).every((key) => accepted.has(key));
};
var isKnowledgeSchemaCoordinate = (value) => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["contract", "major", "revision"]))
    return false;
  return isBoundedString(value["contract"], 256) && isQualifiedId(value["contract"]) && typeof value["major"] === "number" && Number.isSafeInteger(value["major"]) && value["major"] >= 0 && isBoundedString(value["revision"], 256);
};
function isKnowledgeTarget(value) {
  try {
    if (!isRecord(value) || !isBoundedString(value["ecosystem"], 128))
      return false;
    switch (value["kind"]) {
      case "field":
        return hasOnlyKeys(value, ["kind", "ecosystem", "schema", "typeId", "canonicalPath"]) && isKnowledgeSchemaCoordinate(value["schema"]) && isBoundedString(value["typeId"], 128) && Array.isArray(value["canonicalPath"]) && value["canonicalPath"].length >= 1 && value["canonicalPath"].length <= 32 && value["canonicalPath"].every((item) => isBoundedString(item, 128));
      case "subject":
        return hasOnlyKeys(value, ["kind", "ecosystem", "subjectKind", "subjectId"]) && isBoundedString(value["subjectKind"], 128) && (value["subjectId"] === void 0 || isBoundedString(value["subjectId"], 512));
      case "format":
        return hasOnlyKeys(value, ["kind", "ecosystem", "formatId"]) && isBoundedString(value["formatId"], 128);
      case "diagnostic":
        return hasOnlyKeys(value, ["kind", "ecosystem", "code"]) && isBoundedString(value["code"], 256);
      case "concept":
        return hasOnlyKeys(value, ["kind", "ecosystem", "conceptId"]) && isBoundedString(value["conceptId"], 128);
      default:
        return false;
    }
  } catch {
    return false;
  }
}
function knowledgeLocaleFallbacks(requested, userFallbacks, sourceLocale) {
  const candidates = [];
  const append = (locale) => {
    const trimmed = locale.trim();
    if (trimmed === "")
      return;
    const subtags = trimmed.split("-");
    while (subtags.length > 0) {
      candidates.push(subtags.join("-"));
      subtags.pop();
      if (subtags.length > 1 && subtags[subtags.length - 1]?.length === 1)
        subtags.pop();
    }
  };
  append(requested);
  for (const locale of userFallbacks)
    append(locale);
  append(sourceLocale);
  const seen = /* @__PURE__ */ new Set();
  return Object.freeze(candidates.filter((locale) => {
    const key = localeKey(locale);
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  }));
}
function knowledgeTargetKey(target) {
  if (!isKnowledgeTarget(target))
    throw new TypeError("knowledge target is malformed or unbounded");
  return canonicalJsonStringify(target);
}
var coverageMetric = (covered, total) => ({
  covered,
  total,
  percent: total === 0 ? null : Number((covered / total * 100).toFixed(2))
});
var fieldTargetIdentityWithoutRevision = (target) => {
  if (target.kind !== "field")
    return void 0;
  return canonicalJsonStringify({
    kind: target.kind,
    ecosystem: target.ecosystem,
    schema: { contract: target.schema.contract, major: target.schema.major },
    typeId: target.typeId,
    canonicalPath: target.canonicalPath
  });
};
function evaluateKnowledgeCoverage(authorityTargets, entries, options = {}) {
  const requestedLocales = options.requiredLocales ?? [];
  if (requestedLocales.length > 16 || requestedLocales.some((locale) => !isKnowledgeLocaleTag(locale))) {
    throw new TypeError("required knowledge coverage locales must be at most 16 valid locale tags");
  }
  const authorityByKey = /* @__PURE__ */ new Map();
  const duplicateAuthorityTargetKeys = /* @__PURE__ */ new Set();
  for (const target of authorityTargets) {
    const key = knowledgeTargetKey(target);
    if (authorityByKey.has(key))
      duplicateAuthorityTargetKeys.add(key);
    else
      authorityByKey.set(key, target);
  }
  const entriesByTarget = /* @__PURE__ */ new Map();
  const entryLocales = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const targetKey = knowledgeTargetKey(entry.target);
    const targetEntries = entriesByTarget.get(targetKey) ?? [];
    targetEntries.push(entry);
    entriesByTarget.set(targetKey, targetEntries);
    const locale = entry.locale.toLowerCase();
    const coordinate = `${targetKey}\0${locale}`;
    const group = entryLocales.get(coordinate) ?? { targetKey, locale, entryIds: [] };
    group.entryIds.push(entry.id);
    entryLocales.set(coordinate, group);
  }
  const authorityKeys = [...authorityByKey.keys()].sort(compareUtf8);
  const missingTargetKeys = authorityKeys.filter((key) => !entriesByTarget.has(key));
  const orphanTargetKeys = [...entriesByTarget.keys()].filter((key) => !authorityByKey.has(key)).sort(compareUtf8);
  const coveredBy = (predicate) => authorityKeys.filter((key) => entriesByTarget.get(key)?.some(predicate) === true).length;
  const localeCoverage = [...new Set(requestedLocales.map(localeKey))].sort(compareUtf8).map((locale) => ({
    locale,
    coverage: coverageMetric(coveredBy((entry) => localeKey(entry.locale) === locale), authorityKeys.length)
  }));
  const authorityFieldByIdentity = /* @__PURE__ */ new Map();
  for (const [key, target] of authorityByKey) {
    const identity = fieldTargetIdentityWithoutRevision(target);
    if (identity === void 0)
      continue;
    const current = authorityFieldByIdentity.get(identity);
    if (current === void 0 || compareUtf8(key, current) < 0)
      authorityFieldByIdentity.set(identity, key);
  }
  const staleFieldTargets = orphanTargetKeys.flatMap((knowledgeKey) => {
    const target = entriesByTarget.get(knowledgeKey)?.[0]?.target;
    if (target === void 0)
      return [];
    const identity = fieldTargetIdentityWithoutRevision(target);
    const authorityTargetKey = identity === void 0 ? void 0 : authorityFieldByIdentity.get(identity);
    return authorityTargetKey === void 0 ? [] : [{ authorityTargetKey, knowledgeTargetKey: knowledgeKey }];
  });
  return {
    authorityTargetCount: authorityKeys.length,
    entryCount: entries.length,
    structuralCoverage: coverageMetric(authorityKeys.length - missingTargetKeys.length, authorityKeys.length),
    descriptiveCoverage: coverageMetric(coveredBy((entry) => entry.title.trim() !== "" && entry.summary.trim() !== ""), authorityKeys.length),
    researchedSemanticCoverage: coverageMetric(coveredBy((entry) => entry.claimKind !== "schema-derived-fact" && entry.sources.some((source) => source.kind !== "schema")), authorityKeys.length),
    provenanceCoverage: coverageMetric(coveredBy((entry) => entry.sources.length > 0), authorityKeys.length),
    exampleCoverage: coverageMetric(coveredBy((entry) => entry.examples?.some((example) => example.text.trim() !== "") === true), authorityKeys.length),
    localeCoverage,
    missingTargetKeys,
    orphanTargetKeys,
    duplicateAuthorityTargetKeys: [...duplicateAuthorityTargetKeys].sort(compareUtf8),
    duplicateEntryLocales: [...entryLocales.values()].filter((group) => group.entryIds.length > 1).map((group) => ({ ...group, entryIds: [...group.entryIds].sort(compareUtf8) })).sort((left, right) => compareUtf8(`${left.targetKey}\0${left.locale}`, `${right.targetKey}\0${right.locale}`)),
    staleFieldTargets
  };
}

// packages/sdk/dist/schemas/contribution-specs.js
var nonEmptyString = { type: "string", minLength: 1 };
var qualifiedId = { type: "string", pattern: QUALIFIED_PATTERN };
var namespacedDottedId = { type: "string", pattern: NAMESPACED_DOTTED_PATTERN };
var operationId2 = { type: "string", pattern: OPERATION_PATTERN };
var decimalU64 = { type: "string", pattern: UINT64_DECIMAL_PATTERN };
var jsonSchemaRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["$ref"],
  properties: { $ref: nonEmptyString, document: { title: "JsonValue" } }
};
var resourceBudgetWireSchema = {
  type: "object",
  additionalProperties: false,
  required: ["maxInputBytes", "maxDepth", "maxNodes", "maxScalarBytes", "maxDiagnostics"],
  properties: {
    maxInputBytes: decimalU64,
    maxDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxNodes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxScalarBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxDiagnostics: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    deadlineMs: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var dataSourceRefWireSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["contract", "major"],
      properties: {
        contract: { enum: STANDARD_DATA_SOURCE_CONTRACTS },
        major: { const: 1 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["contract", "major", "opaque"],
      properties: {
        contract: { ...qualifiedId, not: { enum: STANDARD_DATA_SOURCE_CONTRACTS } },
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        opaque: { const: true }
      }
    }
  ]
};
var contractRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contract", "major"],
  properties: {
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN }
  }
};
var formatRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formatId", "label"],
  properties: {
    formatId: nonEmptyString,
    label: nonEmptyString,
    mediaType: nonEmptyString
  }
};
var signatureRuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["from", "offset", "bytesHex"],
  properties: {
    from: { enum: ["start", "end"] },
    offset: { type: "integer", minimum: 0, maximum: 4096 },
    bytesHex: { type: "string", pattern: "^(?:[0-9a-f]{2}){1,64}$" },
    maskHex: { type: "string", pattern: "^(?:[0-9a-f]{2}){1,64}$" }
  }
};
var matchRulesSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    extensions: { type: "array", items: nonEmptyString },
    mediaTypes: { type: "array", items: nonEmptyString },
    pathGlobs: { type: "array", items: nonEmptyString },
    signatures: { type: "array", items: signatureRuleSchema, maxItems: 8 }
  }
};
var probePlanSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "ranges", "maxBytes"],
      properties: {
        kind: { const: "bytes" },
        ranges: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "length"],
            properties: {
              from: { enum: ["start", "end"] },
              length: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
            }
          }
        },
        maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "markers", "maxEntries", "maxBytes", "maxDepth", "maxPathBytes"],
      properties: {
        kind: { const: "namespace" },
        markers: {
          type: "array",
          items: nonEmptyString,
          minItems: 1,
          maxItems: 256,
          uniqueItems: true
        },
        prefixes: {
          type: "array",
          items: nonEmptyString,
          maxItems: 256,
          uniqueItems: true
        },
        maxEntries: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxPathBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "maxSubjects", "maxRelationDepth"],
      properties: {
        kind: { const: "derived" },
        maxSubjects: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxRelationDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    }
  ]
};
var traitDefinitionRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: namespacedDottedId,
    definitionRange: { type: "string", pattern: VERSION_RANGE_PATTERN }
  }
};
var traitQueryRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    ...traitDefinitionRequirementSchema.properties,
    states: {
      type: "array",
      items: { enum: ["available", "partial", "disabled", "dependency-required"] },
      minItems: 1,
      uniqueItems: true
    }
  }
};
var companionRuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "role", "required", "patterns", "searchScopes"],
  properties: {
    id: { type: "string", pattern: SEGMENT_PATTERN },
    role: nonEmptyString,
    required: { type: "boolean" },
    patterns: { type: "array", items: nonEmptyString, minItems: 1 },
    expected: {
      type: "object",
      additionalProperties: false,
      properties: {
        all: { type: "array", items: traitQueryRequirementSchema },
        any: { type: "array", items: traitQueryRequirementSchema },
        none: { type: "array", items: traitQueryRequirementSchema }
      }
    },
    searchScopes: {
      type: "array",
      minItems: 1,
      items: {
        enum: [
          "sibling-directory",
          "current-mount",
          "enclosing-container",
          "workspace-dependency-layer",
          "explicit-user-selection"
        ]
      }
    }
  }
};
var representationDeclSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "contract", "major", "stage", "lossy"],
  properties: {
    id: nonEmptyString,
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    stage: { enum: ["authored", "compiled", "runtime"] },
    lossy: { type: "boolean" }
  }
};
var operationDeclSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "handlerId", "mutatesSource"],
  properties: {
    id: operationId2,
    handlerId: nonEmptyString,
    mutatesSource: { type: "boolean" },
    requiredPermissions: { type: "array", items: { enum: PERMISSION_CLASSES } },
    requiresContract: contractRequirementSchema,
    inputSchema: jsonSchemaRefSchema,
    outputKinds: {
      type: "array",
      items: {
        enum: ["json", "bytes", "stream", "source", "artifact", "none", "edit-plan", "transaction"]
      }
    }
  }
};
var traitDeclarationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "representation", "presence"],
  properties: {
    id: namespacedDottedId,
    definitionVersion: { type: "string", pattern: SEMVER_PATTERN },
    representation: { enum: ["source", "compiled", "runtime"] },
    presence: { enum: ["may-expose", "will-expose"] },
    prerequisites: { type: "array", items: contractRequirementSchema },
    evidenceRefs: { type: "array", items: nonEmptyString, uniqueItems: true }
  }
};
var fidelityNotesSchema = { type: "array", items: nonEmptyString };
var fidelityClaimSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { const: "byte-identical" },
        preservesUnknownData: { const: true },
        notes: fidelityNotesSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { const: "semantic" },
        preservesUnknownData: { type: "boolean" },
        notes: fidelityNotesSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { enum: ["lossy", "none"] },
        preservesUnknownData: { const: false },
        notes: fidelityNotesSchema
      }
    }
  ]
};
var codecFidelityEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "formatId",
    "representationId",
    "claim",
    "evidenceId",
    "corpusId",
    "corpusDigest",
    "conformanceProfile",
    "optionsFingerprint",
    "inputClass",
    "provenAt"
  ],
  properties: {
    formatId: nonEmptyString,
    representationId: nonEmptyString,
    claim: fidelityClaimSchema,
    evidenceId: nonEmptyString,
    corpusId: nonEmptyString,
    corpusDigest: nonEmptyString,
    conformanceProfile: qualifiedId,
    optionsFingerprint: nonEmptyString,
    inputClass: nonEmptyString,
    provenAt: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$"
    }
  }
};
var serviceProviderFidelityEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "offerId",
    "evidenceId",
    "claim",
    "corpusId",
    "corpusDigest",
    "conformanceProfile",
    "optionsFingerprint",
    "inputClass",
    "provenAt"
  ],
  properties: {
    offerId: { type: "string", pattern: SEGMENT_PATTERN },
    evidenceId: nonEmptyString,
    claim: fidelityClaimSchema,
    corpusId: nonEmptyString,
    corpusDigest: nonEmptyString,
    conformanceProfile: qualifiedId,
    optionsFingerprint: nonEmptyString,
    inputClass: nonEmptyString,
    provenAt: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$"
    }
  }
};
var codecContributionRequired = [
  "formatRefs",
  "roles",
  "sourceTopology",
  "artifactStages",
  "openIntents",
  "match",
  "probe",
  "representations",
  "publishesDataSources",
  "operations",
  "implementationTier",
  "budgets"
];
var codecContributionProperties = {
  formatRefs: { type: "array", items: formatRefSchema, minItems: 1 },
  roles: {
    type: "array",
    items: { enum: ["container", "media", "byte-transform", "semantic", "index", "sidecar"] },
    minItems: 1
  },
  artifactStages: {
    type: "array",
    items: { enum: ["authored", "compiled", "runtime"] },
    minItems: 1
  },
  openIntents: {
    type: "array",
    items: { enum: ["probe", "inspect", "thumbnail", "full", "stream", "export"] },
    minItems: 1
  },
  match: matchRulesSchema,
  /*
   * Entries that stand for the whole source, so opening one opens the source.
   *
   * MapInfo names a map and carries little else; a person who opened it came for the map. The
   * names belong to the format, so the codec declares them and no common code learns them.
   */
  anchorDocuments: {
    type: "array",
    items: { type: "string", minLength: 1, maxLength: 256 },
    maxItems: 8
  },
  companions: { type: "array", items: companionRuleSchema },
  representations: { type: "array", items: representationDeclSchema, minItems: 1 },
  publishesDataSources: { type: "array", items: dataSourceRefWireSchema },
  requires: { type: "array", items: contractRequirementSchema },
  operations: { type: "array", items: operationDeclSchema },
  traitDeclarations: { type: "array", items: traitDeclarationSchema },
  fidelityEvidence: { type: "array", items: codecFidelityEvidenceSchema },
  implementationTier: {
    type: "object",
    additionalProperties: false,
    required: ["claimed"],
    properties: { claimed: { enum: [1, 2, 3, 4, 5] } }
  },
  budgets: resourceBudgetWireSchema
};
var codecContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/codec-contribution-spec.v1.schema.json",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { enum: ["single", "bundle"] },
        probe: probePlanSchema.oneOf[0]
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { const: "namespace" },
        container: {
          type: "object",
          additionalProperties: false,
          required: ["formatId"],
          properties: {
            formatId: nonEmptyString,
            assetRoots: { type: "array", maxItems: 16, items: { type: "string", maxLength: 256 } },
            markers: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 256, pattern: "^[^/\\\\]+$" }
            }
          }
        },
        probe: probePlanSchema.oneOf[1]
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { const: "derived" },
        probe: probePlanSchema.oneOf[2]
      }
    }
  ]
};
var serviceContractOfferDeclarationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["offerId", "contract", "major", "version"],
  properties: {
    offerId: { type: "string", pattern: SEGMENT_PATTERN },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    version: { type: "string", pattern: SEMVER_PATTERN },
    facet: { title: "JsonValue" }
  }
};
var serviceProviderContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/service-provider-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["provides", "lifecycleScope"],
  properties: {
    provides: { type: "array", items: serviceContractOfferDeclarationSchema, minItems: 1 },
    fidelityEvidence: { type: "array", items: serviceProviderFidelityEvidenceSchema },
    requires: { type: "array", items: contractRequirementSchema },
    inputs: { type: "array", items: nonEmptyString },
    outputs: { type: "array", items: traitDeclarationSchema },
    protocolOperations: { type: "array", items: nonEmptyString },
    replacement: {
      type: "object",
      additionalProperties: false,
      required: ["target", "compatible"],
      properties: { target: contractRequirementSchema, compatible: { type: "boolean" } }
    },
    lifecycleScope: { enum: ["session", "operation", "process"] },
    applicableVariants: { type: "array", items: { type: "string", pattern: SEGMENT_PATTERN } }
  }
};
var traitRequirementSchema = traitQueryRequirementSchema;
var viewerApplicabilitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    interpretation: { enum: ["none", "codec", "any"] },
    sourceBytes: {
      type: "object",
      additionalProperties: false,
      properties: { maximum: decimalU64 }
    },
    longestLineBytes: {
      type: "object",
      additionalProperties: false,
      required: ["maximum", "whenUnknown"],
      properties: {
        maximum: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        whenUnknown: { enum: ["eligible", "ineligible"] }
      }
    }
  }
};
var viewerContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/viewer-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["kind", "consumesDataSources", "priority"],
  properties: {
    kind: { enum: ["stage", "tree", "panel", "toolbar", "transport", "status", "fallback"] },
    requiresTraits: { type: "array", items: traitRequirementSchema },
    requiresOperations: { type: "array", items: operationId2 },
    consumesDataSources: { type: "array", items: dataSourceRefWireSchema },
    /*
     * Sources a viewer reads when the subject publishes them and does without when it does not.
     *
     * Kept apart from `consumesDataSources` because that list decides eligibility: a facet named
     * there would cost the stage every subject that publishes none of them, which is the opposite
     * of optional. Naming them separately is what lets one generic viewer consume the optional
     * model facets instead of splitting into a contribution per facet combination.
     */
    optionalDataSources: { type: "array", items: dataSourceRefWireSchema },
    /*
     * Service contracts this viewer asks the host for when the host can offer one.
     *
     * Same vocabulary a codec's `requires` uses, and deliberately a separate key from the data
     * sources above: a renderer is not published by the subject's codec and can never appear in a
     * descriptor's `dataSources`, so declaring it there would be a dependency the resolver is
     * structurally unable to bind. Optional because the answer is realm-dependent — the same
     * viewer runs in a page with a GPU and in a bridge realm without one — and a stage that
     * disappeared where no provider was offered would be worse than one that degrades and says so.
     */
    optionalServices: { type: "array", items: contractRequirementSchema },
    applicability: viewerApplicabilitySchema,
    hosts: { type: "array", items: nonEmptyString },
    priority: { type: "number" },
    conflicts: { type: "array", items: nonEmptyString },
    singletonGroup: nonEmptyString
  }
};
var writerRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formatId", "representationId", "mutationMode", "minimumRoundTrip"],
  properties: {
    formatId: nonEmptyString,
    representationId: nonEmptyString,
    mutationMode: { enum: ["export-only", "mutate"] },
    minimumRoundTrip: { enum: ["byte-identical", "semantic", "lossy", "none"] }
  }
};
var writerRequirementV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/writer-requirement.v1.schema.json",
  ...writerRequirementSchema
};
var writerOfferV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/writer-offer.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [...writerRequirementSchema.required, "providerId", "fidelityEvidenceId"],
  properties: {
    ...writerRequirementSchema.properties,
    providerId: nonEmptyString,
    fidelityEvidenceId: nonEmptyString
  }
};
var editorContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/editor-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "sessionModel",
    "selectionKinds",
    "semanticLocationKinds",
    "requiresTransactions",
    "requiresOperations",
    "consumesDataSources",
    "writer",
    "priority"
  ],
  properties: {
    sessionModel: { enum: ["single-subject", "multi-subject", "workspace"] },
    selectionKinds: { type: "array", items: nonEmptyString, uniqueItems: true },
    semanticLocationKinds: { type: "array", items: nonEmptyString, uniqueItems: true },
    requiresTransactions: { type: "boolean" },
    requiresOperations: { type: "array", items: operationId2, uniqueItems: true },
    consumesDataSources: { type: "array", items: dataSourceRefWireSchema, uniqueItems: true },
    writer: writerRequirementSchema,
    hosts: { type: "array", items: nonEmptyString, uniqueItems: true },
    priority: { type: "number" },
    scaleLimits: {
      type: "object",
      additionalProperties: false,
      properties: {
        maximumSubjects: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maximumRows: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maximumSourceBytes: decimalU64
      }
    }
  }
};
var localeTag = {
  type: "string",
  pattern: KNOWLEDGE_LOCALE_PATTERN,
  maxLength: 64
};
var knowledgeShortText = { type: "string", minLength: 1, maxLength: 128 };
var knowledgeTitle = { type: "string", minLength: 1, maxLength: 256 };
var boundedKnowledgeQualifiedId = {
  type: "string",
  pattern: QUALIFIED_PATTERN,
  maxLength: 256
};
var knowledgeSchemaCoordinate = {
  type: "object",
  additionalProperties: false,
  required: ["contract", "major", "revision"],
  properties: {
    contract: boundedKnowledgeQualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    revision: { type: "string", minLength: 1, maxLength: 256 }
  }
};
var knowledgeTargetSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "ecosystem", "schema", "typeId", "canonicalPath"],
      properties: {
        kind: { const: "field" },
        ecosystem: knowledgeShortText,
        schema: knowledgeSchemaCoordinate,
        typeId: knowledgeShortText,
        canonicalPath: {
          type: "array",
          items: knowledgeShortText,
          minItems: 1,
          maxItems: 32
        }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "ecosystem", "subjectKind"],
      properties: {
        kind: { const: "subject" },
        ecosystem: knowledgeShortText,
        subjectKind: knowledgeShortText,
        subjectId: { type: "string", minLength: 1, maxLength: 512 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "ecosystem", "formatId"],
      properties: {
        kind: { const: "format" },
        ecosystem: knowledgeShortText,
        formatId: knowledgeShortText
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "ecosystem", "code"],
      properties: {
        kind: { const: "diagnostic" },
        ecosystem: knowledgeShortText,
        code: { type: "string", minLength: 1, maxLength: 256 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "ecosystem", "conceptId"],
      properties: {
        kind: { const: "concept" },
        ecosystem: knowledgeShortText,
        conceptId: knowledgeShortText
      }
    }
  ]
};
var knowledgeSourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "title", "reviewedAt"],
  properties: {
    kind: {
      enum: [
        "schema",
        "official-documentation",
        "source-code",
        "community-wiki",
        "observed-corpus",
        "external-reference"
      ]
    },
    title: knowledgeTitle,
    url: { type: "string", pattern: "^https://[^\\s]+$", maxLength: 2048 },
    schema: knowledgeSchemaCoordinate,
    revision: { type: "string", minLength: 1, maxLength: 256 },
    license: { type: "string", minLength: 1, maxLength: 256 },
    reviewedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
  }
};
var knowledgeEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "target", "locale", "title", "summary", "claimKind", "confidence", "sources"],
  properties: {
    id: boundedKnowledgeQualifiedId,
    target: knowledgeTargetSchema,
    locale: localeTag,
    title: knowledgeTitle,
    summary: { type: "string", minLength: 1, maxLength: 1024 },
    claimKind: {
      enum: [
        "schema-derived-fact",
        "documented-interpretation",
        "community-note",
        "external-reference"
      ]
    },
    confidence: { enum: ["verified", "high", "medium", "low"] },
    aliases: {
      type: "array",
      items: knowledgeShortText,
      maxItems: 32,
      uniqueItems: true
    },
    keywords: {
      type: "array",
      items: knowledgeShortText,
      maxItems: 32,
      uniqueItems: true
    },
    details: {
      type: "object",
      additionalProperties: false,
      properties: {
        valueType: knowledgeShortText,
        units: knowledgeShortText,
        defaultValue: { title: "JsonValue" },
        allowedValues: { type: "array", items: { title: "JsonValue" }, maxItems: 512 },
        deprecated: { type: "boolean" },
        formulaRole: { type: "string", minLength: 1, maxLength: 512 }
      }
    },
    relations: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "target"],
        properties: { role: knowledgeShortText, target: knowledgeTargetSchema }
      }
    },
    examples: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "text"],
        properties: {
          title: knowledgeTitle,
          text: { type: "string", minLength: 1, maxLength: 2048 }
        }
      }
    },
    sources: { type: "array", items: knowledgeSourceSchema, minItems: 1, maxItems: 16 }
  }
};
var knowledgePackSpecCommonProperties = {
  schemaVersion: { const: 1 },
  sourceLocale: localeTag,
  priority: { type: "number" },
  gameIds: { type: "array", items: knowledgeShortText, maxItems: 32, uniqueItems: true }
};
var knowledgePackSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/knowledge-pack-spec.v1.schema.json",
  // Entries inline, or a file of the artifact the host reads when knowledge is first queried.
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "sourceLocale", "priority", "entries"],
      properties: {
        ...knowledgePackSpecCommonProperties,
        entries: { type: "array", items: knowledgeEntrySchema, minItems: 1, maxItems: 1e4 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "sourceLocale", "priority", "entriesPath"],
      properties: {
        ...knowledgePackSpecCommonProperties,
        entriesPath: {
          type: "string",
          maxLength: 1024,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*\\.json$"
        }
      }
    }
  ]
};
var localizationCatalogResourceV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["locale", "path", "messagePrefixes"],
  properties: {
    locale: localeTag,
    path: {
      type: "string",
      maxLength: 1024,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*\\.json$"
    },
    messagePrefixes: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: {
        type: "string",
        maxLength: 256,
        pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9][A-Za-z0-9_-]*)*\\.$"
      }
    }
  }
};
var localizationContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/localization-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["catalogs"],
  properties: {
    catalogs: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: localizationCatalogResourceV1Schema
    }
  }
};
var traitDefinitionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/trait-definition-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "version", "scope", "parametersSchema", "transport"],
  properties: {
    schemaVersion: { const: 1 },
    id: namespacedDottedId,
    version: { type: "string", pattern: SEMVER_PATTERN },
    scope: {
      anyOf: [
        {
          enum: [
            "source",
            "asset",
            "subject",
            "workspace",
            "service",
            "operation",
            "view-session",
            "representation"
          ]
        },
        { type: "string", pattern: QUALIFIED_PATTERN }
      ]
    },
    parametersSchema: jsonSchemaRefSchema,
    transport: { enum: ["json", "structured-clone"] },
    documentation: nonEmptyString,
    imports: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "range"],
        properties: {
          id: namespacedDottedId,
          range: { type: "string", pattern: VERSION_RANGE_PATTERN }
        }
      }
    }
  }
};
var methodName = { type: "string", pattern: METHOD_NAME_PATTERN };
var dataSourceSurfaceRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contract", "major"],
  properties: {
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var dataSourceMethodLimitsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    maxPageItems: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxStringLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var argKeyRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["arg", "key"],
  properties: {
    arg: { type: "integer", minimum: 0, maximum: 16 },
    key: methodName
  }
};
var dataSourceMethodSurfaceCommon = {
  /**
   * Where the executing side places the `AbortSignal`: appended last, nowhere, or as a key of an
   * object argument (the consumer strips that key before sending, the executor re-creates it).
   */
  signal: { anyOf: [{ enum: ["last", "none"] }, argKeyRefSchema] },
  /** Where a progress callback lives inside an object argument (`invoke(…, { onProgress })`). */
  progress: argKeyRefSchema,
  /**
   * Positional argument count before the signal. The executing side pads omitted trailing
   * arguments with `undefined` up to `arity` before appending the signal, so
   * `encoded(trackId?, signal?)` called as `encoded()` still receives its signal last.
   */
  arity: { type: "integer", minimum: 0, maximum: 16 },
  /** The ABI declares the method with `?`; an implementation may lack it. */
  optional: { type: "boolean" },
  limits: dataSourceMethodLimitsSchema
};
var dataSourceMethodSurfaceV1Schema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "result"],
      properties: {
        kind: { const: "lease" },
        result: dataSourceSurfaceRefSchema,
        /** `'lease'` materializes `{ value, release }`; `'bare'` (default) the capability object itself. */
        wrapper: { enum: ["lease", "bare"] },
        ...dataSourceMethodSurfaceCommon
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { enum: ["value", "leased-value", "iterable", "events"] },
        ...dataSourceMethodSurfaceCommon
      }
    }
  ]
};
var dataSourceSurfaceV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["methods"],
  properties: {
    /** A `value` method whose completion also releases the capability (`dispose`-style ABIs). */
    releaseVia: methodName,
    /**
     * Data properties of the object copied to the consumer with its handle (`TextSyntaxProvider.contract`);
     * exposed as read-only properties next to the proxied methods.
     */
    fields: { type: "array", items: methodName, maxItems: 64, uniqueItems: true },
    methods: {
      type: "object",
      minProperties: 1,
      propertyNames: methodName,
      additionalProperties: dataSourceMethodSurfaceV1Schema
    }
  }
};
var serviceContractDefinitionSpecV1Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "contract",
    "major",
    "offerFacet",
    "requestFacet",
    "matching",
    "conformanceProfile"
  ],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: "service" },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    offerFacet: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["presence"],
          properties: { presence: { const: "forbidden" } }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["presence", "schema"],
          properties: {
            presence: { enum: ["optional", "required"] },
            schema: jsonSchemaRefSchema
          }
        }
      ]
    },
    requestFacet: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["presence"],
          properties: { presence: { const: "forbidden" } }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["presence", "schema"],
          properties: {
            presence: { enum: ["optional", "required"] },
            schema: jsonSchemaRefSchema
          }
        }
      ]
    },
    matching: {
      type: "object",
      additionalProperties: false,
      required: ["profile", "major"],
      properties: {
        profile: qualifiedId,
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        configuration: { title: "JsonValue" }
      }
    },
    conformanceProfile: nonEmptyString,
    surface: dataSourceSurfaceV1Schema
  }
};
var dataSourceContractDefinitionSpecV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "contract", "major", "schema", "conformanceProfile"],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: "data-source" },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    schema: jsonSchemaRefSchema,
    conformanceProfile: nonEmptyString,
    surface: dataSourceSurfaceV1Schema
  }
};
var contractDefinitionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/contract-definition-spec.v1.schema.json",
  oneOf: [serviceContractDefinitionSpecV1Schema, dataSourceContractDefinitionSpecV1Schema]
};
var dataSourceContributionSpecV1Schema = dataSourceContractDefinitionSpecV1Schema;
deepFreeze(jsonSchemaRefSchema);
deepFreeze(resourceBudgetWireSchema);
deepFreeze(dataSourceRefWireSchema);
deepFreeze(codecContributionSpecV1Schema);
deepFreeze(serviceProviderContributionSpecV1Schema);
deepFreeze(viewerContributionSpecV1Schema);
deepFreeze(editorContributionSpecV1Schema);
deepFreeze(knowledgePackSpecV1Schema);
deepFreeze(localizationContributionSpecV1Schema);
deepFreeze(traitDefinitionSpecV1Schema);
deepFreeze(serviceContractDefinitionSpecV1Schema);
deepFreeze(dataSourceMethodSurfaceV1Schema);
deepFreeze(dataSourceSurfaceV1Schema);
deepFreeze(dataSourceContractDefinitionSpecV1Schema);
deepFreeze(contractDefinitionSpecV1Schema);

// packages/sdk/dist/subjects/refs.js
var REVISION_KINDS = Object.freeze([
  "content-hash",
  "git-object",
  "etag",
  "database-version",
  "provider-token",
  "overlay-generation"
]);
var REVISION_KIND_PATTERN = REVISION_KINDS.join("|");
var REVISION_ALGORITHM_PATTERN = "[a-z0-9]+(?:-[a-z0-9]+)*";
var REVISION_VALUE_PATTERN = "(?:[A-Za-z0-9_.!~*'()\\-]|%[0-9A-F]{2})+";
var REVISION_ID_PATTERN = `^(?:${REVISION_KIND_PATTERN})(?:\\.${REVISION_ALGORITHM_PATTERN})?:${REVISION_VALUE_PATTERN}$`;
var REVISION_ID = new RegExp(REVISION_ID_PATTERN);
function serializeRevisionRef(ref) {
  if (!REVISION_KINDS.includes(ref.kind)) {
    throw new TypeError(`invalid revision kind: ${String(ref.kind)}`);
  }
  if (ref.value.length === 0)
    throw new TypeError("revision value must be non-empty");
  if (ref.algorithm !== void 0 && !new RegExp(`^${REVISION_ALGORITHM_PATTERN}$`).test(ref.algorithm)) {
    throw new TypeError(`invalid revision algorithm: ${ref.algorithm}`);
  }
  return `${ref.kind}${ref.algorithm === void 0 ? "" : `.${ref.algorithm}`}:${encodeURIComponent(ref.value)}`;
}
function parseRevisionRef(value) {
  if (!REVISION_ID.test(value))
    return void 0;
  const colon = value.indexOf(":");
  const coordinate = value.slice(0, colon);
  const dot = coordinate.indexOf(".");
  const kind = dot === -1 ? coordinate : coordinate.slice(0, dot);
  const algorithm = dot === -1 ? void 0 : coordinate.slice(dot + 1);
  const encoded = value.slice(colon + 1);
  try {
    const decoded = decodeURIComponent(encoded);
    if (decoded.length === 0 || encodeURIComponent(decoded) !== encoded)
      return void 0;
    return Object.freeze({
      kind,
      value: decoded,
      ...algorithm === void 0 ? {} : { algorithm }
    });
  } catch {
    return void 0;
  }
}
function assertSourceChain(source) {
  for (let current = source; current !== void 0; current = current.parent) {
    if (typeof current.id !== "string" || current.id.length === 0) {
      throw new TypeError("subject source id must be non-empty");
    }
  }
}
function assertSubjectIdentity(identity) {
  if (typeof identity.kind !== "string" || typeof identity.key !== "string") {
    throw new TypeError("subject identity kind and key must be strings");
  }
  if (identity.kind === "" && identity.key === "")
    return;
  if (!isQualifiedId(identity.kind)) {
    throw new TypeError(`nested subject kind must be a qualified id: ${identity.kind}`);
  }
  if (identity.key.length === 0) {
    throw new TypeError("nested subject key must be non-empty");
  }
}
function rootSubject(source, workspace) {
  assertSourceChain(source);
  return {
    ...workspace === void 0 ? {} : { workspace },
    source,
    identity: { kind: "", key: "" }
  };
}
function nestedSubject(owner, kind, key) {
  assertSourceChain(owner.source);
  assertSubjectIdentity({ kind, key });
  return { ...owner, identity: { kind, key } };
}
function sourceChainEquals(a, b) {
  if (a === void 0 || b === void 0)
    return a === b;
  return a.id === b.id && sourceChainEquals(a.parent, b.parent);
}
function subjectRefEquals(a, b) {
  return a.workspace === b.workspace && sourceChainEquals(a.source, b.source) && a.identity.kind === b.identity.kind && a.identity.key === b.identity.key;
}
var EXTENDED_SUBJECT_PREFIX = "x3-subject:";
function sourceIdChain(source) {
  const chain = [];
  for (let current = source; current !== void 0; current = current.parent) {
    chain.push(current.id);
  }
  return chain.reverse();
}
function sourceFromIdChain(chain) {
  if (chain.length === 0)
    throw new TypeError("subject source chain must be non-empty");
  let source;
  for (const id2 of chain) {
    if (typeof id2 !== "string" || id2.length === 0) {
      throw new TypeError("subject source id must be non-empty");
    }
    source = { id: id2, ...source === void 0 ? {} : { parent: source } };
  }
  return source;
}
function serializeSubjectRef(ref) {
  assertSourceChain(ref.source);
  assertSubjectIdentity(ref.identity);
  if (ref.workspace !== void 0 || ref.source.parent !== void 0 || ref.source.id.includes("#") || ref.source.id.startsWith(EXTENDED_SUBJECT_PREFIX)) {
    const payload = [
      1,
      ref.workspace ?? null,
      sourceIdChain(ref.source),
      ref.identity.kind,
      ref.identity.key
    ];
    return `${EXTENDED_SUBJECT_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
  }
  if (ref.identity.key === "" && ref.identity.kind === "")
    return ref.source.id;
  return `${ref.source.id}#${encodeURIComponent(ref.identity.kind)}/${encodeURIComponent(ref.identity.key)}`;
}
function parseSubjectRef(uri, workspace) {
  if (uri.startsWith(EXTENDED_SUBJECT_PREFIX)) {
    try {
      const payload = JSON.parse(decodeURIComponent(uri.slice(EXTENDED_SUBJECT_PREFIX.length)));
      if (!Array.isArray(payload) || payload.length !== 5 || payload[0] !== 1) {
        throw new TypeError("invalid extended subject reference");
      }
      const encodedWorkspace = payload[1];
      const chain = payload[2];
      const kind = payload[3];
      const key = payload[4];
      if (encodedWorkspace !== null && typeof encodedWorkspace !== "string" || !Array.isArray(chain) || typeof kind !== "string" || typeof key !== "string") {
        throw new TypeError("invalid extended subject reference");
      }
      const identity = { kind, key };
      assertSubjectIdentity(identity);
      return {
        ...encodedWorkspace === null ? {} : { workspace: encodedWorkspace },
        source: sourceFromIdChain(chain),
        identity
      };
    } catch (error) {
      throw new TypeError(`invalid extended subject reference: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const hash = uri.indexOf("#");
  if (hash === -1)
    return rootSubject({ id: uri }, workspace);
  const fragment = uri.slice(hash + 1);
  const slash = fragment.indexOf("/");
  if (slash === -1)
    throw new TypeError("nested subject reference must include a non-empty key");
  try {
    const kind = decodeURIComponent(fragment.slice(0, slash));
    const key = decodeURIComponent(fragment.slice(slash + 1));
    return nestedSubject(rootSubject({ id: uri.slice(0, hash) }, workspace), kind, key);
  } catch (error) {
    throw new TypeError(`invalid nested subject reference: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// packages/sdk/dist/asset-capabilities/types.js
function contributionId(value) {
  if (!isQualifiedId(value))
    throw new TypeError(`invalid contribution id: ${value}`);
  return value;
}
function isRevisionId(value) {
  return parseRevisionRef(value) !== void 0;
}
function revisionId(value) {
  if (!isRevisionId(value))
    throw new TypeError("revision id must be a canonical kind-tagged value");
  return value;
}
function revisionIdFromRef(ref) {
  return revisionId(serializeRevisionRef(ref));
}
function revisionRefFromId(value) {
  const parsed = parseRevisionRef(value);
  if (parsed === void 0)
    throw new TypeError("invalid branded revision id");
  return parsed;
}
function assetSourceRefFromSourceRef(source, uri) {
  const ancestors = [];
  for (let current = source.parent; current !== void 0; current = current.parent) {
    ancestors.push(current.id);
  }
  ancestors.reverse();
  return Object.freeze({
    id: source.id,
    uri,
    ...ancestors.length === 0 ? {} : { parentIds: Object.freeze(ancestors) }
  });
}
function sourceRefFromAssetSourceRef(ref) {
  let parent;
  for (const id2 of ref.parentIds ?? []) {
    parent = Object.freeze({ id: id2, ...parent === void 0 ? {} : { parent } });
  }
  return Object.freeze({ id: ref.id, ...parent === void 0 ? {} : { parent } });
}

// packages/sdk/dist/schemas/fields.js
var text = { type: "string" };
var id = { type: "string", minLength: 1 };
var strings = { type: "array", items: id };
var boolean = { type: "boolean" };
var count = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
var json = { $ref: "#/$defs/jsonValue" };
var field = { $ref: "#/$defs/fieldType" };
var member = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id, label: text }
};
var members = { type: "array", items: member };
var subjectFilterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: id,
    sameTypeAs: id,
    text,
    requireTags: strings,
    excludeTags: strings,
    predicate: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id, params: json }
    }
  }
};
var fieldSchemaValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "label", "type"],
  properties: {
    key: id,
    label: text,
    type: field,
    cardinality: { enum: ["scalar", "append", "indexed"] },
    description: text,
    knowledgeTarget: knowledgeTargetSchema
  }
};
var fieldTypeValueSchema = {
  title: "FieldType",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "text" }, multiline: boolean, pattern: text, maxLength: count }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { const: "number" },
        min: { type: "number" },
        max: { type: "number" },
        integer: boolean,
        unit: text
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "boolean" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "members"],
      properties: { kind: { const: "enum" }, members, unknown: text }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "members"],
      properties: { kind: { const: "flags" }, members }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "model"],
      properties: { kind: { const: "color" }, model: { enum: ["rgb", "rgba", "argb"] } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "size"],
      properties: { kind: { const: "vector" }, size: { enum: [2, 3, 4] }, unit: text }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { enum: ["duration", "date", "bytes", "id", "path"] } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "text-key" }, catalog: id }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "subjectKind"],
      properties: { kind: { const: "subject-ref" }, subjectKind: id, filter: subjectFilterSchema }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "accepts"],
      properties: {
        kind: { const: "asset-ref" },
        accepts: {
          type: "object",
          additionalProperties: false,
          properties: { formatIds: strings, traits: strings }
        }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "language"],
      properties: { kind: { const: "script" }, language: id }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "fields"],
      properties: {
        kind: { const: "struct" },
        fields: { type: "array", items: fieldSchemaValueSchema }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "item"],
      properties: { kind: { const: "array" }, item: field, max: count }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "key", "value"],
      properties: { kind: { const: "record" }, key: field, value: field }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "keywords", "delimiter"],
      properties: {
        kind: { const: "instructions" },
        keywords: { type: "object", additionalProperties: { type: "array", items: field } },
        delimiter: text,
        listDelimiter: text
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "json" }, schema: jsonSchemaRefSchema }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "text-runs" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "typeId"],
      properties: { kind: { const: "custom" }, typeId: id, params: json }
    }
  ]
};
var fieldSchemaDefinitions = {
  jsonValue: {
    title: "JsonValue",
    oneOf: [
      { type: "null" },
      boolean,
      { type: "number" },
      text,
      { type: "array", items: json },
      { type: "object", additionalProperties: json }
    ]
  },
  fieldType: fieldTypeValueSchema
};
var fieldEditableValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["write"],
  properties: {
    editor: id,
    readonlyReason: text,
    write: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["operation"],
          properties: { operation: { type: "string", pattern: OPERATION_PATTERN } }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["writer"],
          properties: { writer: writerRequirementSchema }
        }
      ]
    }
  }
};
var fieldTypeV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/field-type.v1.schema.json",
  $defs: fieldSchemaDefinitions,
  ...field
};
var fieldSchemaV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/field-schema.v1.schema.json",
  $defs: fieldSchemaDefinitions,
  ...fieldSchemaValueSchema
};
var fieldWriteRequestV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/field-write-request.v1.schema.json",
  $defs: fieldSchemaDefinitions,
  type: "object",
  additionalProperties: false,
  required: ["groupId", "key", "value"],
  properties: { groupId: id, key: id, path: { type: "array", items: text }, value: json }
};
var subjectKindDefinitionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/subject-kind-definition-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["kindId", "label"],
  properties: {
    kindId: id,
    label: text,
    icon: extensionAssetReferenceSchema,
    parentKinds: strings,
    card: {
      type: "object",
      additionalProperties: false,
      required: ["sections"],
      properties: { sections: strings, preview: { enum: ["raster", "model", "none"] } }
    },
    selector: {
      type: "object",
      additionalProperties: false,
      required: ["facets", "predicates"],
      properties: {
        facets: strings,
        predicates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label"],
            properties: { id, label: text, params: jsonSchemaRefSchema }
          }
        }
      }
    },
    diff: {
      type: "object",
      additionalProperties: false,
      required: ["profile"],
      properties: { profile: { enum: ["generic", "provider"] } }
    },
    knowledgeEcosystem: id
  }
};
var inputPathSegment = {
  oneOf: [id, count]
};
var fieldEditFormFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "label", "type", "inputPath"],
  properties: {
    ...fieldSchemaValueSchema.properties,
    inputPath: { type: "array", items: inputPathSegment, minItems: 1 },
    required: boolean,
    initial: json,
    source: { enum: ["entry-key", "entry-value"] },
    encoding: { const: "utf8-base64" }
  }
};
var fieldEditInputSchemaV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/field-edit-input-schema.v1.schema.json",
  $defs: fieldSchemaDefinitions,
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "forms"],
  properties: {
    schemaVersion: { const: 1 },
    forms: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "summary", "fields"],
        properties: {
          id,
          label: text,
          summary: text,
          binding: {
            type: "object",
            additionalProperties: false,
            required: ["groupId"],
            properties: { groupId: id, entryKey: id }
          },
          fields: { type: "array", minItems: 1, items: fieldEditFormFieldSchema }
        }
      }
    }
  }
};
var fieldEditorContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/field-editor-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["fieldTypeId", "editorId", "priority"],
  properties: {
    fieldTypeId: id,
    editorId: id,
    priority: { type: "integer", minimum: -1e6, maximum: 1e6 },
    hosts: { type: "array", minItems: 1, uniqueItems: true, items: id }
  }
};
deepFreeze(fieldTypeV1Schema);
deepFreeze(fieldSchemaV1Schema);
deepFreeze(fieldWriteRequestV1Schema);
deepFreeze(subjectKindDefinitionSpecV1Schema);
deepFreeze(fieldEditInputSchemaV1Schema);
deepFreeze(fieldEditorContributionSpecV1Schema);

// packages/sdk/dist/schemas/subject-descriptor.js
var sourceSpanValueSchema = { oneOf: sourceSpanSchema.oneOf };
var nonEmptyString2 = { type: "string", minLength: 1 };
var nonWhitespaceString = { type: "string", pattern: "\\S" };
var revisionString = { type: "string", pattern: REVISION_ID_PATTERN };
var namespacedDottedId2 = { type: "string", pattern: NAMESPACED_DOTTED_PATTERN };
var operationId3 = { type: "string", pattern: OPERATION_PATTERN };
var stringArray = { type: "array", items: { type: "string" } };
var jsonValueRef = { $ref: "#/$defs/jsonValue" };
var jsonValueSchema = {
  title: "JsonValue",
  oneOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number" },
    { type: "string" },
    { type: "array", items: jsonValueRef },
    { type: "object", additionalProperties: jsonValueRef }
  ]
};
var assetSourceRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "uri"],
  properties: {
    id: nonWhitespaceString,
    uri: nonWhitespaceString,
    parentIds: { type: "array", items: nonWhitespaceString, minItems: 1 }
  }
};
var sourceBindingDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "role", "source", "required", "ownership", "revision"],
  properties: {
    id: nonEmptyString2,
    role: nonEmptyString2,
    source: assetSourceRefSchema,
    required: { type: "boolean" },
    ownership: { enum: ["owned", "companion", "external"] },
    revision: revisionString,
    mediaType: nonEmptyString2
  }
};
var subjectSnapshotRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bindingId", "role", "subjectUri", "revision", "compositionFingerprint"],
  properties: {
    bindingId: nonEmptyString2,
    role: nonEmptyString2,
    subjectUri: nonEmptyString2,
    revision: revisionString,
    compositionFingerprint: nonEmptyString2
  }
};
var derivationRecipeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["extensionId", "extensionVersion", "contributionId", "operation"],
  properties: {
    extensionId: { type: "string", pattern: QUALIFIED_PATTERN },
    extensionVersion: { type: "string", pattern: SEMVER_PATTERN },
    contributionId: { type: "string", pattern: QUALIFIED_PATTERN },
    operation: operationId3,
    parameters: jsonValueRef
  }
};
var materializedAssetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "revision"],
  properties: {
    source: assetSourceRefSchema,
    revision: revisionString,
    mediaType: nonEmptyString2
  }
};
var assetOriginDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "binding"],
      properties: {
        kind: { const: "single" },
        binding: sourceBindingDescriptorSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "bindings"],
      properties: {
        kind: { const: "bundle" },
        bindings: { type: "array", items: sourceBindingDescriptorSchema, minItems: 1 },
        primary: nonEmptyString2
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "root", "revision"],
      properties: {
        kind: { const: "namespace" },
        root: assetSourceRefSchema,
        revision: revisionString
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "inputs"],
      properties: {
        kind: { const: "derived" },
        inputs: { type: "array", items: subjectSnapshotRefSchema, minItems: 1 },
        recipe: derivationRecipeSchema,
        materialization: materializedAssetSchema
      }
    }
  ]
};
var diagnosticSourceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    extensionId: { type: "string", pattern: QUALIFIED_PATTERN },
    contributionId: { type: "string", pattern: QUALIFIED_PATTERN }
  }
};
var assetDiagnosticSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "code", "category", "severity", "message"],
  properties: {
    id: nonEmptyString2,
    code: { type: "string", pattern: QUALIFIED_PATTERN },
    category: {
      enum: [
        "syntax",
        "structure",
        "fidelity",
        "dependency",
        "security",
        "performance",
        "operation",
        "io",
        "unknown"
      ]
    },
    severity: { enum: ["error", "warning", "information", "hint"] },
    message: { type: "string" },
    source: diagnosticSourceSchema,
    path: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
        ]
      }
    },
    range: sourceSpanValueSchema,
    data: jsonValueRef,
    relatedIds: stringArray
  }
};
var traitProperties = {
  id: namespacedDottedId2,
  descriptorVersion: { const: 1 },
  definitionVersion: { type: "string", pattern: SEMVER_PATTERN },
  parameters: jsonValueRef
};
var traitInstanceSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "descriptorVersion", "state"],
      properties: { ...traitProperties, state: { const: "available" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "descriptorVersion", "state", "diagnosticIds"],
      properties: {
        ...traitProperties,
        state: { enum: ["partial", "disabled", "dependency-required"] },
        diagnosticIds: { ...stringArray, minItems: 1 }
      }
    }
  ]
};
var jsonSchemaRefSchema2 = {
  type: "object",
  additionalProperties: false,
  required: ["$ref"],
  properties: { $ref: nonEmptyString2, document: jsonValueRef }
};
var operationProperties = {
  id: operationId3,
  handlerId: nonEmptyString2,
  mutatesSource: { type: "boolean" },
  inputSchema: jsonSchemaRefSchema2
};
var assetOperationDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "handlerId", "state", "mutatesSource"],
      properties: { ...operationProperties, state: { const: "available" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "handlerId", "state", "mutatesSource", "reason"],
      properties: {
        ...operationProperties,
        state: { enum: ["disabled", "dependency-required"] },
        reason: nonEmptyString2
      }
    }
  ]
};
var assetConstraintsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["readOnly", "seekable", "randomAccess", "trusted"],
  properties: {
    readOnly: { type: "boolean" },
    seekable: { type: "boolean" },
    randomAccess: { type: "boolean" },
    trusted: { type: "boolean" },
    maxDecodedBytes: { type: "string", pattern: UINT64_DECIMAL_PATTERN },
    unsupportedFeatures: stringArray
  }
};
var metadataEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "value"],
  properties: {
    key: nonEmptyString2,
    value: jsonValueRef,
    // One sentence about what the value is, when the value alone misleads.
    note: { type: "string" },
    type: { $ref: "#/$defs/fieldType" },
    unit: { type: "string" },
    diagnosticIds: stringArray,
    provenance: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: { type: "string" },
          source: assetSourceRefSchema,
          range: sourceSpanValueSchema,
          semanticPath: stringArray
        }
      }
    },
    knowledgeTarget: knowledgeTargetSchema,
    editable: fieldEditableValueSchema
  }
};
var metadataGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "entries"],
  properties: {
    id: nonEmptyString2,
    label: { type: "string" },
    entries: { type: "array", items: metadataEntrySchema },
    order: { type: "number" }
  }
};
var companionBaseProperties = {
  id: nonEmptyString2,
  role: nonEmptyString2,
  required: { type: "boolean" },
  cardinality: { enum: ["one", "zero-or-one", "one-or-more", "many"] },
  state: { enum: ["resolved", "missing", "ambiguous"] }
};
var requiredCompanionProperties = {
  ...companionBaseProperties,
  required: { const: true },
  cardinality: { enum: ["one", "one-or-more"] }
};
var optionalCompanionProperties = {
  ...companionBaseProperties,
  required: { const: false },
  cardinality: { enum: ["zero-or-one", "many"] }
};
var companionCandidateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "revision"],
  properties: { source: assetSourceRefSchema, revision: revisionString }
};
var companionBindingIdsSchema = {
  type: "array",
  items: nonEmptyString2,
  minItems: 1,
  uniqueItems: true
};
var singleCompanionBindingIdSchema = {
  ...companionBindingIdsSchema,
  maxItems: 1
};
var companionDiagnosticIdsSchema = {
  type: "array",
  items: nonEmptyString2,
  minItems: 1,
  uniqueItems: true
};
var companionDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one" },
        state: { const: "resolved" },
        bindingIds: singleCompanionBindingIdSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one-or-more" },
        state: { const: "resolved" },
        bindingIds: companionBindingIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "zero-or-one" },
        state: { const: "resolved" },
        bindingIds: singleCompanionBindingIdSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "many" },
        state: { const: "resolved" },
        bindingIds: companionBindingIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "diagnosticIds"],
      properties: {
        ...requiredCompanionProperties,
        state: { const: "missing" },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state"],
      properties: {
        ...optionalCompanionProperties,
        state: { const: "missing" },
        diagnosticIds: { type: "array", items: nonEmptyString2, uniqueItems: true }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "candidates", "diagnosticIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one" },
        state: { const: "ambiguous" },
        candidates: {
          type: "array",
          items: companionCandidateSchema,
          minItems: 2,
          uniqueItems: true
        },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "candidates", "diagnosticIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "zero-or-one" },
        state: { const: "ambiguous" },
        candidates: {
          type: "array",
          items: companionCandidateSchema,
          minItems: 2,
          uniqueItems: true
        },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    }
  ]
};
var detectionEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "weight"],
  properties: {
    kind: { enum: ["magic", "structure", "companion", "context", "extension", "user-override"] },
    weight: { type: "number" },
    note: { type: "string" }
  }
};
var detectionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["codecId", "confidence", "evidence", "requiredRanges"],
  properties: {
    codecId: { type: "string", pattern: QUALIFIED_PATTERN },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "array", items: detectionEvidenceSchema },
    requiredRanges: { type: "array", items: sourceSpanValueSchema },
    diagnostics: { type: "array", items: assetDiagnosticSchema }
  }
};
var resolvedIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["codecId", "codecVersion", "formatId", "formatLabel", "confidence", "detection"],
  properties: {
    codecId: { type: "string", pattern: QUALIFIED_PATTERN },
    codecVersion: { type: "string", pattern: SEMVER_PATTERN },
    formatId: nonEmptyString2,
    formatLabel: nonEmptyString2,
    mediaType: nonEmptyString2,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    detection: { type: "array", items: detectionEvidenceSchema }
  }
};
var subjectRequired = [
  "schemaVersion",
  "subjectUri",
  "origin",
  "traits",
  "operations",
  "constraints",
  "dataSources",
  "diagnostics",
  "revision"
];
var subjectProperties = {
  schemaVersion: { const: 2 },
  subjectUri: nonWhitespaceString,
  origin: assetOriginDescriptorSchema,
  traits: { type: "array", items: traitInstanceSchema },
  operations: { type: "array", items: assetOperationDescriptorSchema },
  constraints: assetConstraintsSchema,
  dataSources: { type: "array", items: dataSourceRefWireSchema },
  hostDataSources: { type: "array", items: dataSourceRefWireSchema },
  diagnostics: { type: "array", items: assetDiagnosticSchema },
  revision: revisionString
};
var unresolvedSourceDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: [...subjectRequired, "interpretation", "candidates"],
  properties: {
    ...subjectProperties,
    interpretation: { const: "none" },
    candidates: { type: "array", items: detectionResultSchema }
  }
};
var resolvedAssetDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: [...subjectRequired, "interpretation", "identity", "metadata"],
  properties: {
    ...subjectProperties,
    interpretation: { const: "codec" },
    identity: resolvedIdentitySchema,
    metadata: { type: "array", items: metadataGroupSchema },
    companions: { type: "array", items: companionDescriptorSchema }
  }
};
var subjectDescriptorV2Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/subject-descriptor.v2.schema.json",
  $defs: { ...fieldSchemaDefinitions, jsonValue: jsonValueSchema },
  oneOf: [unresolvedSourceDescriptorSchema, resolvedAssetDescriptorSchema]
};
var subjectDescriptorV2InferenceSchema = {
  ...subjectDescriptorV2Schema,
  $defs: {
    ...subjectDescriptorV2Schema.$defs,
    jsonValue: { title: "JsonValue" },
    fieldType: { title: "FieldType" }
  }
};
var anyDescriptorV2Schema = subjectDescriptorV2Schema;
deepFreeze(subjectDescriptorV2Schema);
deepFreeze(subjectDescriptorV2InferenceSchema);

// packages/sdk/dist/manifest/validate.js
var platformValidatorsPromise;
function platformValidators() {
  platformValidatorsPromise ??= import("./validators.generated-7GZHWJWC.js").then((module) => module.PRECOMPILED_SCHEMA_VALIDATORS);
  return platformValidatorsPromise;
}
function toPath(error) {
  return error.instancePath.split("/").filter((part) => part.length > 0).map((part) => /^\d+$/.test(part) ? Number(part) : part.replaceAll("~1", "/").replaceAll("~0", "~"));
}
function schemaDiagnostics(errors, code) {
  return (errors ?? []).map((error) => diagnostic("error", code, `${error.instancePath || "/"} ${error.message ?? "schema violation"}`, toPath(error), { keyword: error.keyword, params: error.params }));
}
function isPromiseLike(value) {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof value.then === "function";
}
function materializePath(node) {
  const reversed = [];
  for (let current = node; current?.segment !== void 0; ) {
    reversed.push(current.segment);
    current = current.parent;
  }
  return reversed.reverse();
}
function nonJsonDiagnostic(path, reason) {
  return diagnostic("error", "x3.sdk/non-json-wire-value", `${path.length === 0 ? "/" : `/${path.join("/")}`} is not JSON-wire-safe: ${reason}`, path, { reason });
}
function assignJsonValue(parent, key, value) {
  Object.defineProperty(parent, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
}
function snapshotJsonWireValue(root) {
  const holder = {};
  const rootPath = {};
  const pending = [
    { value: root, path: rootPath, parent: holder, key: "value" }
  ];
  const active = /* @__PURE__ */ new WeakSet();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === void 0)
      break;
    if (current.exit !== void 0) {
      active.delete(current.exit);
      continue;
    }
    const { value, path, parent, key } = current;
    if (parent === void 0 || key === void 0)
      continue;
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      assignJsonValue(parent, key, value);
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        assignJsonValue(parent, key, value);
        continue;
      }
      return { diagnostics: [nonJsonDiagnostic(materializePath(path), "numbers must be finite")] };
    }
    if (typeof value !== "object") {
      return {
        diagnostics: [
          nonJsonDiagnostic(materializePath(path), `unsupported JavaScript type ${typeof value}`)
        ]
      };
    }
    if (active.has(value)) {
      return { diagnostics: [nonJsonDiagnostic(materializePath(path), "cyclic object graph")] };
    }
    active.add(value);
    pending.push({ value, path, exit: value });
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return {
        diagnostics: [
          nonJsonDiagnostic(materializePath(path), "symbol-keyed properties are not JSON fields")
        ]
      };
    }
    if (Array.isArray(value)) {
      const ownNames = Object.getOwnPropertyNames(value);
      if (ownNames.length !== value.length + 1 || !ownNames.includes("length")) {
        return {
          diagnostics: [
            nonJsonDiagnostic(materializePath(path), "arrays must be dense and have no extra properties")
          ]
        };
      }
      const clone2 = new Array(value.length);
      assignJsonValue(parent, key, clone2);
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        const childPath = { parent: path, segment: index };
        if (descriptor === void 0) {
          return {
            diagnostics: [nonJsonDiagnostic(materializePath(childPath), "sparse array element")]
          };
        }
        if (!descriptor.enumerable || !("value" in descriptor)) {
          return {
            diagnostics: [
              nonJsonDiagnostic(materializePath(childPath), "elements must be enumerable data values")
            ]
          };
        }
        pending.push({ value: descriptor.value, path: childPath, parent: clone2, key: index });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return {
        diagnostics: [
          nonJsonDiagnostic(materializePath(path), "objects must have Object.prototype or a null prototype")
        ]
      };
    }
    const clone = {};
    assignJsonValue(parent, key, clone);
    for (const [key2, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      const childPath = { parent: path, segment: key2 };
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return {
          diagnostics: [
            nonJsonDiagnostic(materializePath(childPath), "fields must be enumerable data properties")
          ]
        };
      }
      pending.push({ value: descriptor.value, path: childPath, parent: clone, key: key2 });
    }
  }
  return { value: holder.value, diagnostics: [] };
}
function deepFreeze2(value) {
  if (value === null || typeof value !== "object")
    return value;
  const pending = [value];
  const visited = /* @__PURE__ */ new WeakSet();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === void 0 || visited.has(current))
      continue;
    visited.add(current);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object")
        pending.push(child);
    }
    Object.freeze(current);
  }
  return value;
}
function snapshotJsonWireData(value) {
  const snapshot = snapshotJsonWireValue(value);
  if (snapshot.diagnostics.length > 0) {
    throw new ModkitError({
      code: "x3.sdk/non-json-schema-registration",
      message: "registered schema must be inert JSON data",
      context: { diagnostics: snapshot.diagnostics }
    });
  }
  return deepFreeze2(snapshot.value);
}
function snapshotJsonWireObject(value) {
  return snapshotJsonWireData(value);
}
var schemaKeys = /* @__PURE__ */ new WeakMap();
function schemaKeyOf(schema) {
  const known = schemaKeys.get(schema);
  if (known !== void 0)
    return known;
  const key = canonicalJsonStringify(snapshotJsonWireObject(schema));
  schemaKeys.set(schema, key);
  return key;
}
async function validateWithSchema(schema, value, code = "x3.sdk/schema-violation", suppliedValidator) {
  let valueSnapshot;
  try {
    valueSnapshot = snapshotJsonWireValue(value);
  } catch {
    valueSnapshot = {
      diagnostics: [nonJsonDiagnostic([], "value could not be inspected as inert data")]
    };
  }
  if (valueSnapshot.diagnostics.length > 0)
    return [...valueSnapshot.diagnostics];
  let schemaCacheKey;
  try {
    schemaCacheKey = schemaKeyOf(schema);
  } catch (error) {
    return [
      diagnostic("error", "x3.sdk/invalid-schema-authority", "the selected JSON Schema is not inert JSON data", [], { error: error instanceof Error ? error.message : String(error) })
    ];
  }
  const validate = suppliedValidator ?? (await platformValidators()).get(schemaCacheKey);
  if (validate === void 0) {
    return [
      diagnostic("error", "x3.sdk/invalid-schema-authority", "the selected JSON Schema has no CSP-safe precompiled validator", [], { reason: "precompiled-validator-missing" })
    ];
  }
  try {
    const result = validate(valueSnapshot.value);
    if (isPromiseLike(result)) {
      await result;
      return [];
    }
    if (result)
      return [];
  } catch (error) {
    const asyncErrors = error?.errors;
    if (asyncErrors !== void 0 && asyncErrors !== null) {
      return schemaDiagnostics(asyncErrors, code);
    }
    const reason = error instanceof Error ? error.message : String(error);
    return [
      diagnostic("error", "x3.sdk/schema-evaluation-failed", `the selected JSON Schema failed while evaluating inert wire data: ${reason}`, [], { error: reason })
    ];
  }
  const reported = schemaDiagnostics(validate.errors, code);
  if (reported.length > 0)
    return reported;
  return [
    diagnostic("error", code, "the schema validator rejected the value without reporting a reason", [], { reason: "validator-returned-false" })
  ];
}

// packages/sdk/dist/asset-capabilities/standard-traits.js
var TRAIT_IDS = Object.freeze([
  "content.metadata",
  "content.binary",
  "content.text",
  "content.images",
  "content.fonts",
  "content.styles",
  "content.scripts",
  "content.thumbnails",
  "image.raster",
  "image.channels",
  "image.mipmaps",
  "image.subresources",
  "image.compressed-blocks",
  "image.frames",
  "image.palette",
  "image.color-profile",
  "vector.scene",
  "vector.paths",
  "vector.shapes",
  "vector.text",
  "vector.gradients",
  "document.flow",
  "document.pages",
  "document.outline",
  "document.annotations",
  "table.sheets",
  "table.cells",
  "table.formulas",
  "presentation.slides",
  "presentation.masters",
  "design.components",
  "design.constraints",
  "structure.hierarchy",
  "structure.layers",
  "structure.nodes",
  "structure.timeline",
  "project.editable",
  "project.companions",
  "model.geometry",
  "model.materials",
  "model.textures",
  "model.skeleton",
  "model.animations",
  "model.lods",
  "scene.objects",
  "scene.cameras",
  "scene.lights",
  "scene.effects",
  "audio.streams",
  "audio.waveform",
  "audio.loop-points",
  "video.streams",
  "video.tracks",
  "media.duration",
  "media.frames",
  "media.seekable",
  "media.interactive-runtime",
  "container.entries",
  "container.directories",
  "container.nested",
  "container.compression",
  "container.encryption",
  "container.overlay",
  "source.dependencies",
  "font.glyphs",
  "font.metrics",
  "font.character-map",
  "code.source",
  "code.shader",
  "code.node-graph",
  "game.map",
  "game.replay",
  "game.layout",
  "game.localization",
  "game.catalog"
]);
var STANDARD_TRAIT_SET = new Set(TRAIT_IDS);
function isStandardTraitId(value) {
  return STANDARD_TRAIT_SET.has(value);
}

// packages/sdk/dist/security/grant.js
function grantValidity(grant, now = Date.now()) {
  if (grant.expiresAt === void 0)
    return { state: "valid" };
  const parsed = Date.parse(grant.expiresAt);
  if (Number.isNaN(parsed))
    return { state: "malformed", value: grant.expiresAt };
  return parsed > now ? { state: "valid" } : { state: "expired", at: grant.expiresAt };
}
function intersectClasses(a, b) {
  return uniqueSortedUtf8(a.filter((cls) => b.includes(cls)));
}
function intersectStrings(a, b) {
  if (a === void 0)
    return b === void 0 ? void 0 : [...b];
  if (b === void 0)
    return [...a];
  return uniqueSortedUtf8(a.filter((item) => b.includes(item)));
}
function narrowPaths(parent, requestedRoots) {
  if (parent === void 0)
    return void 0;
  if (requestedRoots === void 0)
    return [...parent];
  return parent.filter((scope) => requestedRoots.includes(scope.root));
}
function narrowNetwork(parent, requestedOrigins) {
  if (parent === void 0)
    return void 0;
  if (requestedOrigins === void 0)
    return [...parent];
  return parent.map((scope) => ({
    ...scope,
    origins: scope.origins.filter((origin) => requestedOrigins.includes(origin))
  })).filter((scope) => scope.origins.length > 0);
}
function narrowGrant(parent, request) {
  const validity = grantValidity(parent);
  if (validity.state !== "valid") {
    return {
      child: { id: request.childId, classes: [], parentGrant: parent.id },
      missing: uniqueSortedUtf8(request.requestedClasses)
    };
  }
  let allowed = intersectClasses(request.requestedClasses, parent.classes);
  const policy = request.policy;
  if (policy?.allowedClasses !== void 0) {
    allowed = intersectClasses(allowed, policy.allowedClasses);
  }
  if (request.operation !== void 0 && policy?.operationClasses !== void 0) {
    const ceiling = policy.operationClasses[request.operation];
    if (ceiling !== void 0)
      allowed = intersectClasses(allowed, ceiling);
  }
  const missing = uniqueSortedUtf8(request.requestedClasses.filter((cls) => !allowed.includes(cls)));
  const sourceScope = intersectStrings(parent.sourceScope, request.requestedSourceRoots);
  const filesystem = narrowPaths(parent.filesystem, request.requestedSourceRoots);
  const network = narrowNetwork(parent.network, request.requestedOrigins);
  const child = {
    id: request.childId,
    classes: allowed,
    parentGrant: parent.id,
    ...parent.subjectScope === void 0 ? {} : { subjectScope: [...parent.subjectScope] },
    ...sourceScope === void 0 ? {} : { sourceScope },
    ...filesystem === void 0 ? {} : { filesystem },
    ...network === void 0 ? {} : { network },
    ...parent.credentials === void 0 ? {} : { credentials: [...parent.credentials] },
    ...parent.expiresAt === void 0 ? {} : { expiresAt: parent.expiresAt }
  };
  return { child, missing };
}
function assertNotWider(parent, child) {
  const widened = child.classes.filter((cls) => !parent.classes.includes(cls));
  if (widened.length > 0) {
    throw new ModkitError({
      code: "x3.sdk/grant-widened",
      message: `child grant \xAB${child.id}\xBB adds classes its parent \xAB${parent.id}\xBB does not hold: ${widened.join(", ")}`,
      context: { widened }
    });
  }
}

// packages/sdk/dist/asset-capabilities/model-facet-sources.js
var RESERVED_MODEL_FACET_SOURCES = Object.freeze([
  Object.freeze({
    contract: "common.view/model-variant-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { variants }",
      "variants(page): { id, name, kind, targets }"
    ]),
    blockedBy: "no codec publishes named variants today: UV_game_variants exists in the schema and no reader surfaces it"
  })
]);
function isReservedModelFacetSource(contract) {
  return RESERVED_MODEL_FACET_SOURCES.some((entry) => entry.contract === contract);
}

// packages/sdk/dist/asset-capabilities/data-sources.js
function foreignDataSource(contract, major) {
  if (!isQualifiedId(contract))
    throw new TypeError(`invalid foreign data-source id: ${contract}`);
  if (STANDARD_DATA_SOURCE_CONTRACTS.includes(contract)) {
    throw new TypeError(`known data-source contract must use its typed reference: ${contract}`);
  }
  if (!Number.isSafeInteger(major) || major < 0) {
    throw new TypeError(`invalid foreign data-source major: ${major}`);
  }
  return Object.freeze({ contract, major, opaque: true });
}
function dataSourceRefFromWire(ref) {
  if (!isQualifiedId(ref.contract) || !Number.isSafeInteger(ref.major) || ref.major < 0) {
    throw new TypeError(`invalid data-source reference: ${ref.contract}@${ref.major}`);
  }
  if ("opaque" in ref && ref.opaque === true) {
    if (STANDARD_DATA_SOURCE_CONTRACTS.includes(ref.contract)) {
      throw new TypeError(`standard data-source contract cannot be opaque: ${ref.contract}`);
    }
    return Object.freeze({ ...ref });
  }
  if (!STANDARD_DATA_SOURCE_CONTRACTS.includes(ref.contract) || ref.major !== 1) {
    throw new TypeError(`unknown data-source reference must be explicitly opaque: ${ref.contract}@${ref.major}`);
  }
  return Object.freeze({ ...ref });
}
function registrationKey(contract, major) {
  return `${contract}@${major}`;
}
function contractNamespace(contract) {
  const slash = contract.indexOf("/");
  return slash === -1 ? contract : contract.slice(0, slash);
}
function compareRegistration(a, b) {
  return compareUtf8(a.contract, b.contract) || a.major - b.major || compareUtf8(a.ownerExtensionId, b.ownerExtensionId);
}
function rejection(reason, spec, index) {
  const diagnostic2 = {
    id: `data-source-registration-${index}`,
    code: `x3.sdk/data-source-${reason}`,
    category: reason === "reserved-namespace" ? "security" : "structure",
    severity: "error",
    message: `data-source contract ${spec.contract}@${spec.major} rejected: ${reason}`
  };
  return { state: "rejected", reason, diagnostics: [diagnostic2] };
}
function malformedBatchDiagnostic(message) {
  return {
    id: "data-source-registration-batch",
    code: "x3.sdk/data-source-schema-invalid",
    category: "structure",
    severity: "error",
    message
  };
}
var PROVENANCE_KEYS = [
  "ownerExtensionId",
  "extensionVersion",
  "inventoryRecordId",
  "manifestDigest",
  "artifactDigest",
  "artifactRoot",
  "manifestPath"
];
function hasExactStringKeys(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value;
  const own = Object.keys(record).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  return own.length === expected.length && own.every((key, index) => key === expected[index]) && keys.every((key) => typeof record[key] === "string" && record[key].trim() !== "");
}
function isInventoryEntry(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value;
  const keys = Object.keys(record).sort(compareUtf8);
  return keys.length === 2 && keys[0] === "definition" && keys[1] === "provenance" && hasExactStringKeys(record["provenance"], PROVENANCE_KEYS);
}
function createDataSourceRegistry(options) {
  if (typeof options !== "object" || options === null || typeof options.isNamespaceOwner !== "function" || typeof options.validateDefinition !== "function") {
    throw new TypeError("data-source registry requires namespace and definition validators");
  }
  const isNamespaceOwner = options.isNamespaceOwner;
  const validateDefinition = options.validateDefinition;
  let registrations = /* @__PURE__ */ new Map();
  const ownerGenerations = /* @__PURE__ */ new Map();
  const beginOwnerUpdate = (ownerExtensionId) => {
    const generation = (ownerGenerations.get(ownerExtensionId) ?? 0) + 1;
    ownerGenerations.set(ownerExtensionId, generation);
    return generation;
  };
  const list = () => Object.freeze([...registrations.values()].sort(compareRegistration));
  return {
    async replaceOwnerInventory(ownerExtensionId, entries) {
      const generation = beginOwnerUpdate(ownerExtensionId);
      let ownedEntries;
      try {
        const snapshot = snapshotJsonWireData(entries);
        if (!Array.isArray(snapshot))
          throw new TypeError("data-source inventory must be an array");
        const checks = await Promise.all(snapshot.map((entry) => {
          if (!isInventoryEntry(entry)) {
            return Promise.resolve([
              malformedBatchDiagnostic("data-source inventory entry must bind definition and provenance")
            ]);
          }
          return validateWithSchema(dataSourceContractDefinitionSpecV1Schema, entry.definition);
        }));
        const invalid = checks.findIndex((diagnostics2) => diagnostics2.length > 0);
        if (invalid !== -1) {
          throw new TypeError(`data-source inventory item ${invalid} violates its schema authority`);
        }
        ownedEntries = snapshot;
      } catch (error) {
        const diagnostic2 = malformedBatchDiagnostic(`data-source inventory rejected before policy evaluation: ${error instanceof Error ? error.message : String(error)}`);
        return {
          state: "rejected",
          results: [
            {
              state: "rejected",
              reason: "schema-invalid",
              diagnostics: [diagnostic2]
            }
          ],
          diagnostics: [diagnostic2]
        };
      }
      const counts = /* @__PURE__ */ new Map();
      for (const { definition: spec } of ownedEntries) {
        const key = registrationKey(spec.contract, spec.major);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const results = await Promise.all(ownedEntries.map(async ({ definition: spec, provenance }, index) => {
        const key = registrationKey(spec.contract, spec.major);
        if ((counts.get(key) ?? 0) > 1)
          return rejection("duplicate", spec, index);
        if (!isQualifiedId(spec.contract) || !Number.isSafeInteger(spec.major) || spec.major < 0 || spec.schema.$ref.trim() === "") {
          return rejection("schema-invalid", spec, index);
        }
        try {
          if (isNamespaceOwner(contractNamespace(spec.contract), ownerExtensionId) !== true) {
            return rejection("reserved-namespace", spec, index);
          }
        } catch {
          return rejection("reserved-namespace", spec, index);
        }
        if (spec.conformanceProfile.trim() === "") {
          return rejection("conformance-missing", spec, index);
        }
        if (provenance.ownerExtensionId !== ownerExtensionId || provenance.artifactRoot.trim() === "" || provenance.manifestPath.trim() === "" || provenance.manifestDigest.trim() === "" || provenance.artifactDigest.trim() === "") {
          return rejection("schema-invalid", spec, index);
        }
        const definition = Object.freeze({ ...spec, ownerExtensionId, provenance });
        let validation;
        try {
          validation = await validateDefinition(definition);
        } catch {
          return rejection("schema-invalid", spec, index);
        }
        if (validation?.state !== "valid") {
          const reason = validation?.state === "invalid" && (validation.reason === "schema-invalid" || validation.reason === "conformance-missing") ? validation.reason : "schema-invalid";
          return rejection(reason, spec, index);
        }
        return { state: "registered" };
      }));
      const diagnostics = results.flatMap((result) => result.state === "rejected" ? result.diagnostics : []);
      if (diagnostics.length > 0)
        return { state: "rejected", results, diagnostics };
      if (ownerGenerations.get(ownerExtensionId) !== generation) {
        const staleResults = ownedEntries.map(({ definition }, index) => rejection("stale-update", definition, index));
        const staleDiagnostics = staleResults.flatMap((result) => result.state === "rejected" ? result.diagnostics : []);
        const diagnostics2 = staleDiagnostics.length > 0 ? staleDiagnostics : [malformedBatchDiagnostic("data-source inventory update was superseded")];
        return { state: "rejected", results: staleResults, diagnostics: diagnostics2 };
      }
      const retained = new Map([...registrations].filter(([, registration]) => registration.ownerExtensionId !== ownerExtensionId));
      const conflictResults = ownedEntries.map(({ definition }, index) => retained.has(registrationKey(definition.contract, definition.major)) ? rejection("major-conflict", definition, index) : { state: "registered" });
      const conflictDiagnostics = conflictResults.flatMap((result) => result.state === "rejected" ? result.diagnostics : []);
      if (conflictDiagnostics.length > 0) {
        return {
          state: "rejected",
          results: conflictResults,
          diagnostics: conflictDiagnostics
        };
      }
      const committed = ownedEntries.map(({ definition: spec, provenance }) => Object.freeze({
        ...spec,
        schema: Object.freeze({ ...spec.schema }),
        ownerExtensionId,
        provenance: Object.freeze({ ...provenance })
      }));
      registrations = retained;
      for (const registration of committed) {
        registrations.set(registrationKey(registration.contract, registration.major), registration);
      }
      return {
        state: "committed",
        registrations: Object.freeze([...committed].sort(compareRegistration))
      };
    },
    unregisterOwner(ownerExtensionId) {
      beginOwnerUpdate(ownerExtensionId);
      registrations = new Map([...registrations].filter(([, registration]) => registration.ownerExtensionId !== ownerExtensionId));
    },
    lookup(contract, major) {
      return registrations.get(registrationKey(contract, major));
    },
    majors(contract) {
      return list().filter((registration) => registration.contract === contract).map((registration) => registration.major);
    },
    list,
    resolveRef(ref) {
      if (!isQualifiedId(ref.contract) || !Number.isSafeInteger(ref.major) || ref.major < 0) {
        return void 0;
      }
      const isStandard = STANDARD_DATA_SOURCE_CONTRACTS.includes(ref.contract);
      if (isStandard && (ref.major !== 1 || "opaque" in ref && ref.opaque === true)) {
        return void 0;
      }
      return registrations.get(registrationKey(ref.contract, ref.major));
    }
  };
}

// packages/sdk/dist/asset-capabilities/uv-projection.js
var QUALIFIED_DIGEST = /^[a-z][a-z0-9-]*:[0-9a-f]{32,128}$/u;
function isAlgorithmQualifiedDigest(value) {
  return QUALIFIED_DIGEST.test(value);
}
function algorithmQualifiedDigest(value) {
  if (!isAlgorithmQualifiedDigest(value)) {
    throw new TypeError("a UV digest must be algorithm-qualified as \xAB<algorithm>:<lowercase hex>\xBB; a bare hex string is refused");
  }
  return value;
}
function toPortableProjectionReceipt(receipt, identity) {
  const { form, sourceUri, ...rest } = receipt;
  void form;
  void sourceUri;
  return { ...rest, form: "portable", sourceIdentity: identity };
}

// packages/sdk/dist/asset-capabilities/validate-descriptor.js
function normalizeSourceSpan(span) {
  if (typeof span.byteOffset === "string" && typeof span.byteLength === "string") {
    return Object.freeze({
      ...span,
      byteOffset: uint64(span.byteOffset),
      byteLength: uint64(span.byteLength)
    });
  }
  return span;
}
function normalizeDiagnostic(item) {
  return Object.freeze({
    ...item,
    ...item.range === void 0 ? {} : { range: normalizeSourceSpan(item.range) }
  });
}
function normalizeDetection(item) {
  const { diagnostics, ...facts } = item;
  return Object.freeze({
    ...facts,
    requiredRanges: Object.freeze(item.requiredRanges.map(normalizeSourceSpan)),
    ...diagnostics === void 0 ? {} : { diagnostics: Object.freeze(diagnostics.map(normalizeDiagnostic)) }
  });
}
function freezeSource(source) {
  return Object.freeze({
    ...source,
    ...source.parentIds === void 0 ? {} : {
      parentIds: Object.freeze([...source.parentIds])
    }
  });
}
function normalizeBinding(item) {
  return Object.freeze({
    ...item,
    source: freezeSource(item.source),
    revision: revisionId(item.revision)
  });
}
function normalizeCompanion(item) {
  if (item.state === "resolved") {
    return Object.freeze({
      ...item,
      bindingIds: Object.freeze([...item.bindingIds])
    });
  }
  if (item.state === "ambiguous") {
    return Object.freeze({
      ...item,
      candidates: Object.freeze(item.candidates.map((candidate) => Object.freeze({
        source: freezeSource(candidate.source),
        revision: revisionId(candidate.revision)
      }))),
      diagnosticIds: Object.freeze([...item.diagnosticIds])
    });
  }
  return Object.freeze({
    ...item,
    ...item.diagnosticIds === void 0 ? {} : { diagnosticIds: Object.freeze([...item.diagnosticIds]) }
  });
}
function operationOwnerId(wire) {
  return wire.interpretation === "none" ? "modkit/host" : wire.identity.codecId;
}
function normalizeOrigin(origin) {
  switch (origin.kind) {
    case "single":
      return Object.freeze({ kind: "single", binding: normalizeBinding(origin.binding) });
    case "bundle":
      return Object.freeze({
        kind: "bundle",
        bindings: Object.freeze(origin.bindings.map(normalizeBinding)),
        ...origin.primary === void 0 ? {} : { primary: origin.primary }
      });
    case "namespace":
      return Object.freeze({
        kind: "namespace",
        root: freezeSource(origin.root),
        revision: revisionId(origin.revision)
      });
    case "derived":
      return Object.freeze({
        kind: "derived",
        inputs: Object.freeze(origin.inputs.map((input) => Object.freeze({ ...input, revision: revisionId(input.revision) }))),
        ...origin.recipe === void 0 ? {} : {
          recipe: Object.freeze({
            ...origin.recipe,
            contributionId: contributionId(origin.recipe.contributionId),
            operation: operationId(origin.recipe.operation, {
              contributionId: origin.recipe.contributionId
            })
          })
        },
        ...origin.materialization === void 0 ? {} : {
          materialization: Object.freeze({
            ...origin.materialization,
            source: freezeSource(origin.materialization.source),
            revision: revisionId(origin.materialization.revision)
          })
        }
      });
  }
}
async function validateSubjectDescriptorV2(value) {
  let snapshot;
  try {
    snapshot = snapshotJsonWireData(value);
  } catch (error) {
    return {
      diagnostics: [
        diagnostic("error", "x3.sdk/non-json-subject-descriptor", "subject descriptor must be inert JSON data", [], { error: error instanceof Error ? error.message : String(error) })
      ]
    };
  }
  const schemaDiagnostics2 = await validateWithSchema(subjectDescriptorV2Schema, snapshot);
  if (hasErrors(schemaDiagnostics2))
    return { diagnostics: schemaDiagnostics2 };
  const wire = snapshot;
  const semanticDiagnostics = [];
  const validateSubjectUri = (uri, path) => {
    try {
      if (serializeSubjectRef(parseSubjectRef(uri)) !== uri) {
        throw new TypeError("subject reference is not in canonical form");
      }
    } catch (error) {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-subject-reference", `subject reference ${uri} is not a canonical restorable identity`, path, { error: error instanceof Error ? error.message : String(error) }));
    }
  };
  validateSubjectUri(wire.subjectUri, ["subjectUri"]);
  if (wire.origin.kind === "derived") {
    wire.origin.inputs.forEach((input, index) => validateSubjectUri(input.subjectUri, ["origin", "inputs", index, "subjectUri"]));
  }
  const validateDiagnosticCode = (item, path) => {
    if (!isQualifiedId(item.code)) {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-persistent-diagnostic-code", `persistent diagnostic code ${item.code} is not a qualified id`, [...path, "code"]));
    }
  };
  wire.diagnostics.forEach((item, index) => validateDiagnosticCode(item, ["diagnostics", index]));
  if (wire.interpretation === "none") {
    wire.candidates.forEach((candidate, candidateIndex) => candidate.diagnostics?.forEach((item, diagnosticIndex) => validateDiagnosticCode(item, [
      "candidates",
      candidateIndex,
      "diagnostics",
      diagnosticIndex
    ])));
  }
  if (wire.interpretation === "codec" && parseSemver(wire.identity.codecVersion) === void 0) {
    semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-codec-version", `codec version ${wire.identity.codecVersion} cannot be evaluated safely`, ["identity", "codecVersion"]));
  }
  const knownDiagnostics = /* @__PURE__ */ new Set();
  wire.diagnostics.forEach((item, index) => {
    if (knownDiagnostics.has(item.id)) {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-descriptor-diagnostic", `diagnostic id ${item.id} is declared more than once`, ["diagnostics", index, "id"]));
    }
    knownDiagnostics.add(item.id);
  });
  const traitIds = /* @__PURE__ */ new Set();
  wire.traits.forEach((trait, index) => {
    if (traitIds.has(trait.id)) {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-descriptor-trait", `trait ${trait.id} is declared more than once`, ["traits", index, "id"]));
    }
    traitIds.add(trait.id);
    if (isStandardTraitId(trait.id)) {
      if (trait.definitionVersion !== void 0) {
        semanticDiagnostics.push(diagnostic("error", "x3.sdk/standard-trait-versioned", `standard trait ${trait.id} cannot bind an extension definition version`, ["traits", index, "definitionVersion"]));
      }
    } else {
      if (trait.definitionVersion === void 0 || parseSemver(trait.definitionVersion) === void 0) {
        semanticDiagnostics.push(diagnostic("error", "x3.sdk/custom-trait-definition-unbound", `custom trait ${trait.id} must bind an exact installed definition version`, ["traits", index, "definitionVersion"]));
      }
    }
    if (trait.state !== "available") {
      const diagnosticIds = /* @__PURE__ */ new Set();
      for (const id2 of trait.diagnosticIds) {
        if (diagnosticIds.has(id2)) {
          semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-trait-diagnostic", `trait diagnostic ${id2} is referenced more than once`, ["traits", index, "diagnosticIds"]));
        }
        diagnosticIds.add(id2);
        if (!knownDiagnostics.has(id2)) {
          semanticDiagnostics.push(diagnostic("error", "x3.sdk/unknown-trait-diagnostic", `trait diagnostic ${id2} is not present in descriptor diagnostics`, ["traits", index, "diagnosticIds"]));
        }
      }
    }
  });
  const operationOwner = operationOwnerId(wire);
  const operationIds = /* @__PURE__ */ new Set();
  const handlerIds = /* @__PURE__ */ new Set();
  wire.operations.forEach((operation, index) => {
    if (operationIds.has(operation.id)) {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-descriptor-operation", `operation ${operation.id} is declared more than once`, ["operations", index, "id"]));
    }
    operationIds.add(operation.id);
    if (handlerIds.has(operation.handlerId)) {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-descriptor-handler", `handler ${operation.handlerId} is bound to more than one operation`, ["operations", index, "handlerId"]));
    }
    handlerIds.add(operation.handlerId);
    try {
      operationId(operation.id, { contributionId: operationOwner });
    } catch {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-descriptor-operation", `operation ${operation.id} is not owned by ${operationOwner}`, ["operations", index, "id"]));
    }
  });
  if (wire.interpretation !== "none") {
    wire.metadata.forEach((group, groupIndex) => group.entries.forEach((entry, entryIndex) => {
      const write = entry.editable?.write;
      if (write !== void 0 && "operation" in write) {
        try {
          operationId(write.operation, { contributionId: operationOwner });
          if (!wire.operations.some((operation) => operation.id === write.operation && operation.mutatesSource)) {
            throw new TypeError("field write must name a published mutating operation");
          }
        } catch {
          semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-field-write-operation", `field write ${write.operation} is not a declared owned mutation`, ["metadata", groupIndex, "entries", entryIndex, "editable", "write", "operation"]));
        }
      }
    }));
  }
  if (wire.origin.kind === "bundle") {
    const bindingIds = /* @__PURE__ */ new Set();
    wire.origin.bindings.forEach((binding, index) => {
      if (bindingIds.has(binding.id)) {
        semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-origin-binding", `origin binding id ${binding.id} is duplicated`, ["origin", "bindings", index, "id"]));
      }
      bindingIds.add(binding.id);
    });
    if (wire.origin.primary !== void 0 && !bindingIds.has(wire.origin.primary)) {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/unknown-origin-primary", `origin primary ${wire.origin.primary} does not name a bundle binding`, ["origin", "primary"]));
    }
  }
  if (wire.interpretation === "codec") {
    const companionIds = /* @__PURE__ */ new Set();
    const companionBindingIds = /* @__PURE__ */ new Set();
    const bundleBindings = wire.origin.kind === "bundle" ? new Map(wire.origin.bindings.map((binding) => [binding.id, binding])) : /* @__PURE__ */ new Map();
    (wire.companions ?? []).forEach((companion, index) => {
      if (companionIds.has(companion.id)) {
        semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-companion-state", `companion requirement ${companion.id} is declared more than once`, ["companions", index, "id"]));
      }
      companionIds.add(companion.id);
      if (companion.state === "resolved") {
        if ((companion.cardinality === "one" || companion.cardinality === "zero-or-one") && companion.bindingIds.length !== 1) {
          semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-companion-cardinality", `resolved companion ${companion.id} must name exactly one binding for ${companion.cardinality}`, ["companions", index, "bindingIds"]));
        }
        companion.bindingIds.forEach((bindingId, bindingIndex) => {
          const binding = bundleBindings.get(bindingId);
          if (binding === void 0 || binding.ownership !== "companion" || binding.role !== companion.role || binding.required !== companion.required || companionBindingIds.has(bindingId)) {
            semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-companion-binding", `resolved companion ${companion.id} does not name a distinct matching companion binding`, ["companions", index, "bindingIds", bindingIndex]));
          }
          companionBindingIds.add(bindingId);
        });
      } else {
        for (const id2 of companion.diagnosticIds ?? []) {
          if (!knownDiagnostics.has(id2)) {
            semanticDiagnostics.push(diagnostic("error", "x3.sdk/unknown-companion-diagnostic", `companion diagnostic ${id2} is not present in descriptor diagnostics`, ["companions", index, "diagnosticIds"]));
          }
        }
        if (companion.state === "ambiguous") {
          const candidates = /* @__PURE__ */ new Set();
          companion.candidates.forEach((candidate, candidateIndex) => {
            const key = canonicalJsonStringify(candidate);
            if (candidates.has(key)) {
              semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-companion-candidate", `ambiguous companion ${companion.id} repeats one candidate`, ["companions", index, "candidates", candidateIndex]));
            }
            candidates.add(key);
          });
        }
      }
    });
    if (wire.origin.kind === "bundle") {
      wire.origin.bindings.forEach((binding, index) => {
        if (binding.ownership === "companion" && !companionBindingIds.has(binding.id)) {
          semanticDiagnostics.push(diagnostic("error", "x3.sdk/untracked-companion-binding", `companion binding ${binding.id} has no resolved requirement state`, ["origin", "bindings", index, "id"]));
        }
      });
    }
  }
  if (wire.origin.kind === "derived") {
    const inputIds = /* @__PURE__ */ new Set();
    wire.origin.inputs.forEach((input, index) => {
      if (inputIds.has(input.bindingId)) {
        semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-derived-input", `derived input binding ${input.bindingId} is duplicated`, ["origin", "inputs", index, "bindingId"]));
      }
      inputIds.add(input.bindingId);
    });
  }
  if (wire.origin.kind === "derived" && wire.origin.recipe !== void 0) {
    try {
      contributionId(wire.origin.recipe.contributionId);
      if (!isQualifiedId(wire.origin.recipe.extensionId) || parseSemver(wire.origin.recipe.extensionVersion) === void 0) {
        throw new TypeError("invalid extension coordinate");
      }
      operationId(wire.origin.recipe.operation, {
        contributionId: wire.origin.recipe.contributionId
      });
    } catch {
      semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-derivation-operation", `derivation recipe ${wire.origin.recipe.extensionId}@${wire.origin.recipe.extensionVersion}#${wire.origin.recipe.contributionId} cannot own ${wire.origin.recipe.operation}`, ["origin", "recipe"]));
    }
  }
  if (hasErrors(semanticDiagnostics)) {
    return { diagnostics: [...schemaDiagnostics2, ...semanticDiagnostics] };
  }
  const base = {
    ...wire,
    revision: revisionId(wire.revision),
    origin: normalizeOrigin(wire.origin),
    constraints: Object.freeze({
      ...wire.constraints,
      ...wire.constraints.maxDecodedBytes === void 0 ? {} : { maxDecodedBytes: uint64(wire.constraints.maxDecodedBytes) }
    }),
    diagnostics: Object.freeze(wire.diagnostics.map(normalizeDiagnostic)),
    dataSources: Object.freeze(wire.dataSources.map(dataSourceRefFromWire)),
    traits: Object.freeze(wire.traits.map((item) => Object.freeze({ ...item, id: traitId(item.id) }))),
    operations: Object.freeze(wire.operations.map((item) => Object.freeze({
      ...item,
      id: operationId(item.id, { contributionId: operationOwner })
    })))
  };
  const descriptor = Object.freeze(wire.interpretation === "none" ? { ...base, candidates: Object.freeze(wire.candidates.map(normalizeDetection)) } : {
    ...base,
    metadata: Object.freeze(wire.metadata.map((group) => Object.freeze({
      ...group,
      entries: Object.freeze(group.entries.map((entry) => Object.freeze({
        ...entry,
        ...entry.provenance === void 0 ? {} : {
          provenance: Object.freeze(entry.provenance.map((origin) => Object.freeze({
            ...origin,
            ...origin.range === void 0 ? {} : { range: normalizeSourceSpan(origin.range) }
          })))
        },
        ...entry.editable === void 0 ? {} : {
          editable: Object.freeze({
            ...entry.editable,
            write: "operation" in entry.editable.write ? Object.freeze({
              operation: operationId(entry.editable.write.operation, {
                contributionId: operationOwner
              })
            }) : entry.editable.write
          })
        }
      })))
    }))),
    ...wire.companions === void 0 ? {} : { companions: Object.freeze(wire.companions.map(normalizeCompanion)) }
  });
  return { descriptor, diagnostics: [...schemaDiagnostics2, ...semanticDiagnostics] };
}

export {
  DOTTED_PATTERN,
  QUALIFIED_PATTERN,
  SEGMENT_PATTERN,
  SEMVER_PATTERN,
  REQUIREMENT_SCOPE_KINDS,
  requirementScopeSchema,
  extensionRequirementSchema,
  EXTENSION_VFS_PATH_PATTERN,
  extensionVendorDescriptorSchema,
  extensionGameDescriptorSchema,
  extensionAssetReferenceSchema,
  extensionSourceDetailsSchema,
  extensionPresentationSchema,
  extensionManifestSchema,
  modkitBlockSchema,
  EXECUTION_PROFILES,
  PERMISSION_CLASSES,
  RUNTIME_ENVIRONMENTS,
  OPERATING_SYSTEMS,
  ARCHITECTURES,
  runtimeTargetConstraintSchema,
  runtimeVariantDeclarationSchema,
  scopedContractRequirementSchema,
  contributionManifestSchema,
  STANDARD_DATA_SOURCE_CONTRACTS,
  DATA_SOURCE_MATURITY,
  ADMITTED_DATA_SOURCE_CONTRACTS,
  dataSourceMaturity,
  KNOWLEDGE_LOCALE_PATTERN,
  isKnowledgeLocaleTag,
  isKnowledgeTarget,
  knowledgeLocaleFallbacks,
  knowledgeTargetKey,
  evaluateKnowledgeCoverage,
  jsonSchemaRefSchema,
  resourceBudgetWireSchema,
  dataSourceRefWireSchema,
  codecContributionSpecV1Schema,
  serviceProviderContributionSpecV1Schema,
  viewerContributionSpecV1Schema,
  writerRequirementV1Schema,
  writerOfferV1Schema,
  editorContributionSpecV1Schema,
  knowledgePackSpecV1Schema,
  localizationContributionSpecV1Schema,
  traitDefinitionSpecV1Schema,
  dataSourceMethodSurfaceV1Schema,
  dataSourceSurfaceV1Schema,
  serviceContractDefinitionSpecV1Schema,
  dataSourceContractDefinitionSpecV1Schema,
  contractDefinitionSpecV1Schema,
  dataSourceContributionSpecV1Schema,
  rootSubject,
  subjectRefEquals,
  serializeSubjectRef,
  parseSubjectRef,
  contributionId,
  isRevisionId,
  revisionId,
  revisionIdFromRef,
  revisionRefFromId,
  assetSourceRefFromSourceRef,
  sourceRefFromAssetSourceRef,
  fieldTypeV1Schema,
  fieldSchemaV1Schema,
  fieldWriteRequestV1Schema,
  subjectKindDefinitionSpecV1Schema,
  fieldEditInputSchemaV1Schema,
  fieldEditorContributionSpecV1Schema,
  subjectDescriptorV2Schema,
  anyDescriptorV2Schema,
  snapshotJsonWireData,
  snapshotJsonWireObject,
  validateWithSchema,
  TRAIT_IDS,
  isStandardTraitId,
  grantValidity,
  narrowGrant,
  assertNotWider,
  RESERVED_MODEL_FACET_SOURCES,
  isReservedModelFacetSource,
  foreignDataSource,
  dataSourceRefFromWire,
  createDataSourceRegistry,
  isAlgorithmQualifiedDigest,
  algorithmQualifiedDigest,
  toPortableProjectionReceipt,
  validateSubjectDescriptorV2
};
