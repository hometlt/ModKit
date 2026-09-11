import {
  ModkitError,
  OPERATION_DOMAINS,
  SHARED_OPERATION_IDS,
  UINT64_DECIMAL_PATTERN,
  canonicalJsonStringify,
  compareUtf8,
  contractId,
  deepFreeze,
  diagnostic,
  hasErrors,
  isQualifiedId,
  isSegment,
  isUInt64String,
  operationId,
  parseSemver,
  parseVersionRange,
  sourceSpanSchema,
  traitId,
  uint64,
  uniqueSortedUtf8,
  versionRangeTargetsMajor
} from "./chunk-S5ITZJYV.js";

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
    presentation: extensionPresentationSchema
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
    presentation: extensionPresentationSchema
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

// packages/sdk/dist/identity.js
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
var isKnowledgeLocaleTag = (value2) => typeof value2 === "string" && value2.length <= 64 && knowledgeLocalePattern.test(value2);
var localeKey = (locale) => locale.toLowerCase();
var isBoundedString = (value2, maximum) => typeof value2 === "string" && value2.length > 0 && value2.length <= maximum;
var isRecord = (value2) => typeof value2 === "object" && value2 !== null && !Array.isArray(value2);
var hasOnlyKeys = (value2, allowed) => {
  const accepted = new Set(allowed);
  return Object.keys(value2).every((key2) => accepted.has(key2));
};
var isKnowledgeSchemaCoordinate = (value2) => {
  if (!isRecord(value2) || !hasOnlyKeys(value2, ["contract", "major", "revision"]))
    return false;
  return isBoundedString(value2["contract"], 256) && isQualifiedId(value2["contract"]) && typeof value2["major"] === "number" && Number.isSafeInteger(value2["major"]) && value2["major"] >= 0 && isBoundedString(value2["revision"], 256);
};
function isKnowledgeTarget(value2) {
  try {
    if (!isRecord(value2) || !isBoundedString(value2["ecosystem"], 128))
      return false;
    switch (value2["kind"]) {
      case "field":
        return hasOnlyKeys(value2, ["kind", "ecosystem", "schema", "typeId", "canonicalPath"]) && isKnowledgeSchemaCoordinate(value2["schema"]) && isBoundedString(value2["typeId"], 128) && Array.isArray(value2["canonicalPath"]) && value2["canonicalPath"].length >= 1 && value2["canonicalPath"].length <= 32 && value2["canonicalPath"].every((item) => isBoundedString(item, 128));
      case "subject":
        return hasOnlyKeys(value2, ["kind", "ecosystem", "subjectKind", "subjectId"]) && isBoundedString(value2["subjectKind"], 128) && (value2["subjectId"] === void 0 || isBoundedString(value2["subjectId"], 512));
      case "format":
        return hasOnlyKeys(value2, ["kind", "ecosystem", "formatId"]) && isBoundedString(value2["formatId"], 128);
      case "diagnostic":
        return hasOnlyKeys(value2, ["kind", "ecosystem", "code"]) && isBoundedString(value2["code"], 256);
      case "concept":
        return hasOnlyKeys(value2, ["kind", "ecosystem", "conceptId"]) && isBoundedString(value2["conceptId"], 128);
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
    const key2 = localeKey(locale);
    if (seen.has(key2))
      return false;
    seen.add(key2);
    return true;
  }));
}
function knowledgeTargetKey(target) {
  if (!isKnowledgeTarget(target))
    throw new TypeError("knowledge target is malformed or unbounded");
  return canonicalJsonStringify(target);
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
          properties: { formatId: nonEmptyString }
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
var knowledgePackSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/knowledge-pack-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "sourceLocale", "priority", "entries"],
  properties: {
    schemaVersion: { const: 1 },
    sourceLocale: localeTag,
    priority: { type: "number" },
    gameIds: { type: "array", items: knowledgeShortText, maxItems: 32, uniqueItems: true },
    entries: { type: "array", items: knowledgeEntrySchema, minItems: 1, maxItems: 1e4 }
  }
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

// packages/sdk/dist/editing.js
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

// packages/sdk/dist/subjects/candidates.js
var nonEmptyStrings = (value2) => value2 === void 0 || value2.every((item) => typeof item === "string" && item.length > 0) && new Set(value2).size === value2.length;
function validCandidate(candidate) {
  return typeof candidate === "object" && candidate !== null && typeof candidate.subjectId === "string" && candidate.subjectId.length > 0 && typeof candidate.label === "string" && candidate.label.length > 0 && typeof candidate.kind === "string" && candidate.kind.length > 0 && (candidate.type === void 0 || typeof candidate.type === "string" && candidate.type.length > 0) && nonEmptyStrings(candidate.tags) && (candidate.asset === void 0 || typeof candidate.asset === "object" && candidate.asset !== null && typeof candidate.asset.formatId === "string" && candidate.asset.formatId.length > 0 && nonEmptyStrings(candidate.asset.traits));
}
function validSummary(summary) {
  return typeof summary === "object" && summary !== null && typeof summary.snapshotId === "string" && summary.snapshotId.length > 0 && Number.isSafeInteger(summary.totalSubjects) && summary.totalSubjects >= 0 && (summary.completeness === "complete" || summary.completeness === "partial" || summary.completeness === "capped") && (summary.reason === void 0 || typeof summary.reason === "string");
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

// packages/sdk/dist/manifest/operation-permissions.js
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
function parseRevisionRef(value2) {
  if (!REVISION_ID.test(value2))
    return void 0;
  const colon = value2.indexOf(":");
  const coordinate = value2.slice(0, colon);
  const dot = coordinate.indexOf(".");
  const kind = dot === -1 ? coordinate : coordinate.slice(0, dot);
  const algorithm = dot === -1 ? void 0 : coordinate.slice(dot + 1);
  const encoded = value2.slice(colon + 1);
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
function nestedSubject(owner, kind, key2) {
  assertSourceChain(owner.source);
  assertSubjectIdentity({ kind, key: key2 });
  return { ...owner, identity: { kind, key: key2 } };
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
      const key2 = payload[4];
      if (encodedWorkspace !== null && typeof encodedWorkspace !== "string" || !Array.isArray(chain) || typeof kind !== "string" || typeof key2 !== "string") {
        throw new TypeError("invalid extended subject reference");
      }
      const identity = { kind, key: key2 };
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
    const key2 = decodeURIComponent(fragment.slice(slash + 1));
    return nestedSubject(rootSubject({ id: uri.slice(0, hash) }, workspace), kind, key2);
  } catch (error) {
    throw new TypeError(`invalid nested subject reference: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
  platformValidatorsPromise ??= import("./validators.generated-6ZF5QJXG.js").then((module) => module.PRECOMPILED_SCHEMA_VALIDATORS);
  return platformValidatorsPromise;
}
function toPath(error) {
  return error.instancePath.split("/").filter((part) => part.length > 0).map((part) => /^\d+$/.test(part) ? Number(part) : part.replaceAll("~1", "/").replaceAll("~0", "~"));
}
function schemaDiagnostics(errors, code) {
  return (errors ?? []).map((error) => diagnostic("error", code, `${error.instancePath || "/"} ${error.message ?? "schema violation"}`, toPath(error), { keyword: error.keyword, params: error.params }));
}
function isPromiseLike(value2) {
  return (typeof value2 === "object" || typeof value2 === "function") && value2 !== null && typeof value2.then === "function";
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
function assignJsonValue(parent, key2, value2) {
  Object.defineProperty(parent, key2, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: value2
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
    const { value: value2, path, parent, key: key2 } = current;
    if (parent === void 0 || key2 === void 0)
      continue;
    if (value2 === null || typeof value2 === "string" || typeof value2 === "boolean") {
      assignJsonValue(parent, key2, value2);
      continue;
    }
    if (typeof value2 === "number") {
      if (Number.isFinite(value2)) {
        assignJsonValue(parent, key2, value2);
        continue;
      }
      return { diagnostics: [nonJsonDiagnostic(materializePath(path), "numbers must be finite")] };
    }
    if (typeof value2 !== "object") {
      return {
        diagnostics: [
          nonJsonDiagnostic(materializePath(path), `unsupported JavaScript type ${typeof value2}`)
        ]
      };
    }
    if (active.has(value2)) {
      return { diagnostics: [nonJsonDiagnostic(materializePath(path), "cyclic object graph")] };
    }
    active.add(value2);
    pending.push({ value: value2, path, exit: value2 });
    if (Object.getOwnPropertySymbols(value2).length > 0) {
      return {
        diagnostics: [
          nonJsonDiagnostic(materializePath(path), "symbol-keyed properties are not JSON fields")
        ]
      };
    }
    if (Array.isArray(value2)) {
      const ownNames = Object.getOwnPropertyNames(value2);
      if (ownNames.length !== value2.length + 1 || !ownNames.includes("length")) {
        return {
          diagnostics: [
            nonJsonDiagnostic(materializePath(path), "arrays must be dense and have no extra properties")
          ]
        };
      }
      const clone2 = new Array(value2.length);
      assignJsonValue(parent, key2, clone2);
      for (let index = value2.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value2, index);
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
    const prototype = Object.getPrototypeOf(value2);
    if (prototype !== Object.prototype && prototype !== null) {
      return {
        diagnostics: [
          nonJsonDiagnostic(materializePath(path), "objects must have Object.prototype or a null prototype")
        ]
      };
    }
    const clone = {};
    assignJsonValue(parent, key2, clone);
    for (const [key3, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value2))) {
      const childPath = { parent: path, segment: key3 };
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return {
          diagnostics: [
            nonJsonDiagnostic(materializePath(childPath), "fields must be enumerable data properties")
          ]
        };
      }
      pending.push({ value: descriptor.value, path: childPath, parent: clone, key: key3 });
    }
  }
  return { value: holder.value, diagnostics: [] };
}
function deepFreeze2(value2) {
  if (value2 === null || typeof value2 !== "object")
    return value2;
  const pending = [value2];
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
  return value2;
}
function snapshotJsonWireData(value2) {
  const snapshot = snapshotJsonWireValue(value2);
  if (snapshot.diagnostics.length > 0) {
    throw new ModkitError({
      code: "x3.sdk/non-json-schema-registration",
      message: "registered schema must be inert JSON data",
      context: { diagnostics: snapshot.diagnostics }
    });
  }
  return deepFreeze2(snapshot.value);
}
function snapshotJsonWireObject(value2) {
  return snapshotJsonWireData(value2);
}
async function validateWithSchema(schema, value2, code = "x3.sdk/schema-violation", suppliedValidator) {
  let valueSnapshot;
  try {
    valueSnapshot = snapshotJsonWireValue(value2);
  } catch {
    valueSnapshot = {
      diagnostics: [nonJsonDiagnostic([], "value could not be inspected as inert data")]
    };
  }
  if (valueSnapshot.diagnostics.length > 0)
    return [...valueSnapshot.diagnostics];
  let schemaSnapshot;
  let schemaCacheKey;
  try {
    schemaSnapshot = snapshotJsonWireObject(schema);
    schemaCacheKey = canonicalJsonStringify(schemaSnapshot);
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
  return schemaDiagnostics(validate.errors, code);
}

// packages/sdk/dist/asset-capabilities/types.js
function contributionId(value2) {
  if (!isQualifiedId(value2))
    throw new TypeError(`invalid contribution id: ${value2}`);
  return value2;
}
function isRevisionId(value2) {
  return parseRevisionRef(value2) !== void 0;
}
function revisionId(value2) {
  if (!isRevisionId(value2))
    throw new TypeError("revision id must be a canonical kind-tagged value");
  return value2;
}
function revisionIdFromRef(ref) {
  return revisionId(serializeRevisionRef(ref));
}
function revisionRefFromId(value2) {
  const parsed = parseRevisionRef(value2);
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

// packages/sdk/dist/host-facilities.generated.js
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

// packages/sdk/dist/host-profile.js
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
function exactKeys(value2, allowed, field2) {
  const extra = Object.keys(value2).filter((key2) => !allowed.includes(key2));
  if (extra.length > 0)
    invalidProfile(`${field2} contains unsupported fields`, { field: field2, extra });
}
function nonEmpty(value2, field2) {
  if (value2.trim().length === 0)
    return invalidProfile(`${field2} must not be empty`, { field: field2 });
  return value2;
}
function count2(value2, field2) {
  if (!Number.isSafeInteger(value2) || value2 < 0) {
    return invalidProfile(`${field2} must be a non-negative safe integer`, { field: field2, value: value2 });
  }
  return value2;
}
function bytes(value2, field2) {
  if (!isUInt64String(value2))
    return invalidProfile(`${field2} must be an unsigned 64-bit string`, { field: field2 });
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
    maxConcurrentTasks: count2(snapshot.budgets.maxConcurrentTasks, "budgets.maxConcurrentTasks"),
    maxWorkerCount: count2(snapshot.budgets.maxWorkerCount, "budgets.maxWorkerCount"),
    maxResidentBytes: bytes(snapshot.budgets.maxResidentBytes, "budgets.maxResidentBytes"),
    maxTransferBytes: bytes(snapshot.budgets.maxTransferBytes, "budgets.maxTransferBytes"),
    defaultDeadlineMs: count2(snapshot.budgets.defaultDeadlineMs, "budgets.defaultDeadlineMs")
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

// packages/sdk/dist/manifest/spec-registry.js
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
  const { contract, dependsOn, id: id2, ...rest } = wire;
  return Object.freeze({
    ...rest,
    id: contributionId(normalizeModkitIdentifier(id2)),
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
function isStandardTraitId(value2) {
  return STANDARD_TRAIT_SET.has(value2);
}

// packages/sdk/dist/manifest/contribution-contract-registry.js
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
function traitDefinitionRangeDiagnostics(id2, range, path) {
  if (isStandardTraitId(id2)) {
    return range === void 0 ? [] : [
      diagnostic("error", "x3.sdk/standard-trait-versioned", `standard trait ${id2} does not use an extension definition range`, [...path, "definitionRange"])
    ];
  }
  if (range === void 0 || parseVersionRange(range) === void 0) {
    return [
      diagnostic("error", "x3.sdk/custom-trait-definition-unbound", `custom trait ${id2} must declare a safe definition range`, [...path, "definitionRange"])
    ];
  }
  return [];
}
function traitDefinitionOfferDiagnostics(id2, version, path) {
  if (isStandardTraitId(id2)) {
    return version === void 0 ? [] : [
      diagnostic("error", "x3.sdk/standard-trait-versioned", `standard trait ${id2} does not use an extension definition version`, [...path, "definitionVersion"])
    ];
  }
  if (version === void 0 || parseSemver(version) === void 0) {
    return [
      diagnostic("error", "x3.sdk/custom-trait-definition-unbound", `custom trait ${id2} must declare one exact safe definition version`, [...path, "definitionVersion"])
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
function namespaceProbePathDiagnostics(values, field2) {
  const diagnostics = [];
  const first = /* @__PURE__ */ new Map();
  values.forEach((value2, index) => {
    const normalized = normalizedNamespaceProbePath(value2);
    if (normalized === void 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/namespace-probe-path-invalid", `namespace probe ${field2.slice(0, -1)} \xAB${value2}\xBB is not a confined POSIX path`, ["spec", "probe", field2, index]));
      return;
    }
    const previous = first.get(normalized);
    if (previous === void 0)
      first.set(normalized, index);
    else {
      diagnostics.push(diagnostic("error", "x3.sdk/namespace-probe-path-duplicate", `namespace probe ${field2.slice(0, -1)} \xAB${value2}\xBB duplicates index ${previous} after normalization`, ["spec", "probe", field2, index]));
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
    if ((spec.match.extensions?.length ?? 0) === 0 && (spec.match.mediaTypes?.length ?? 0) === 0 && (spec.match.pathGlobs?.length ?? 0) === 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/container-alias-selector-missing", "a semantic container alias requires an extension, media type, or path selector", ["spec", "match"]));
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
function isPortableOperationReference(id2) {
  if (SHARED_OPERATION_IDS.includes(id2))
    return true;
  if (OPERATION_DOMAINS.some((domain) => {
    const prefix = `${domain}.`;
    return id2.startsWith(prefix) && isSegment(id2.slice(prefix.length));
  })) {
    return true;
  }
  const separator = id2.lastIndexOf(".");
  return separator > 0 && isQualifiedId(id2.slice(0, separator)) && isSegment(id2.slice(separator + 1));
}
var validateViewerContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.requiresTraits?.map((requirement) => requirement.id) ?? [], ["spec", "requiresTraits"], "trait requirement"),
    ...duplicateFieldDiagnostics(spec.requiresOperations ?? [], ["spec", "requiresOperations"], "operation requirement")
  ];
  spec.requiresOperations?.forEach((id2, index) => {
    if (!isPortableOperationReference(id2)) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-operation-namespace", `viewer operation requirement ${id2} is not shared, canonical-domain, or qualified-local`, ["spec", "requiresOperations", index]));
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
  spec.requiresOperations.forEach((id2, index) => {
    if (!EDITING_OPERATION_IDS.includes(id2)) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-editor-operation", `editor operation ${id2} is not one of the shared editing operations`, ["spec", "requiresOperations", index]));
    }
  });
  if (!spec.requiresOperations.some((id2) => id2.startsWith("edit."))) {
    diagnostics.push(diagnostic("error", "x3.sdk/editor-edit-operation-missing", "an editor contribution requires an explicit edit operation", ["spec", "requiresOperations"]));
  }
  if (spec.requiresTransactions && !spec.requiresOperations.some((id2) => id2 === "source.save" || id2 === "source.save-as")) {
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
  for (const field2 of surface.fields ?? []) {
    if (Object.hasOwn(surface.methods, field2)) {
      diagnostics.push(diagnostic("error", "x3.sdk/surface-field-is-method", `\xAB${field2}\xBB cannot be both a field and a method`, [...path, "fields"]));
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
  const diagnostics = duplicateFieldDiagnostics(spec.entries.map((entry) => `${entry.id}\0${entry.locale.toLowerCase()}`), ["spec", "entries"], "knowledge entry and locale");
  const targetLocales = /* @__PURE__ */ new Set();
  const targetByLogicalId = /* @__PURE__ */ new Map();
  const localesByLogicalId = /* @__PURE__ */ new Map();
  spec.entries.forEach((entry, index) => {
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
  const id2 = candidate.id;
  const major = candidate.major;
  if (typeof id2 !== "string" || !isQualifiedId(id2)) {
    return invalidOpenRegistration("contribution contract id must be a qualified id", {
      contract: typeof id2 === "string" ? id2 : typeof id2
    });
  }
  if (!Number.isSafeInteger(major) || major < 0) {
    return invalidOpenRegistration("contribution contract major must be a safe non-negative integer", { contract: id2, major: safeRegistrationContextValue(major) });
  }
  return Object.freeze({ id: contractId(id2), major });
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
    const registrationKey2 = key(entry.contract.id, entry.contract.major);
    if (map.has(registrationKey2)) {
      throw new ModkitError({
        code: "x3.sdk/duplicate-contribution-contract",
        message: `duplicate contribution contract registration: ${registrationKey2}`,
        context: { contract: entry.contract.id, major: entry.contract.major }
      });
    }
    map.set(registrationKey2, entry);
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

// packages/sdk/dist/service-contracts.js
function foreignServiceContractId(contract) {
  if (!isQualifiedId(contract))
    throw new TypeError(`invalid foreign service contract: ${contract}`);
  return contract;
}

// packages/sdk/dist/model-encoding.js
var NATIVE_MODEL_ENCODER_CONTRACT = "common.model/native-encoder";
var NATIVE_MODEL_ENCODER_MATCHER_PROFILE = "modkit/native-model-encoder-matcher";

// packages/sdk/dist/language/index.js
var LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT = "common.language/document-analysis";
var LANGUAGE_DOCUMENT_MATCHER_PROFILE = "modkit/language-document-matcher";

// packages/sdk/dist/language/translation.js
var TRANSLATION_CONTRACT = "common.language/translation";

// packages/sdk/dist/runtime/index.js
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

// packages/sdk/dist/renderer/index.js
var SCENE_RENDERER_CONTRACT = "common.render/scene-3d";
var SCENE_RENDERER_MATCHER_PROFILE = "modkit/scene-renderer-matcher";

// packages/sdk/dist/games/index.js
var GAME_INSTALLATION_DISCOVERY_CONTRACT = "common.game/installation-discovery";
var GAME_LAUNCH_PLAN_CONTRACT = "common.game/launch-plan";
var GAME_INSTALLATION_MATCHER_PROFILE = "modkit/game-installation-matcher";

// packages/sdk/dist/mods/index.js
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

// packages/sdk/dist/data/index.js
var DATA_CATALOG_ANALYSIS_CONTRACT = "common.data/catalog-analysis";
var DATA_CATALOG_MATCHER_PROFILE = "modkit/data-catalog-matcher";
var RESOLVED_DATA_WORKSPACE_CONTRACT = "common.data/resolved-workspace";
var RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE = "modkit/resolved-data-workspace-matcher";
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
  const immutableField = (field2) => Object.freeze({
    ...field2,
    ...field2.type === void 0 ? {} : { type: immutableJson(field2.type) },
    ...field2.fields === void 0 ? {} : { fields: Object.freeze(field2.fields.map(immutableField)) }
  });
  return Object.freeze({ ...value2, fields: Object.freeze(value2.fields.map(immutableField)) });
}
function recordOf(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2) ? value2 : void 0;
}
function mergeAppend(previous, incoming) {
  const left = Array.isArray(previous) ? previous : previous === void 0 ? [] : [previous];
  const right = Array.isArray(incoming) ? incoming : [incoming];
  return [...left.map(cloneJson), ...right.map(cloneJson)];
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
function mergeIndexed(previous, incoming, indexKey) {
  const result = Array.isArray(previous) ? previous.map(cloneJson) : [];
  const additions = Array.isArray(incoming) ? incoming : [incoming];
  for (const item of additions) {
    const key2 = indexedKey(item, indexKey);
    if (key2 === void 0)
      continue;
    const found = result.findIndex((candidate) => indexedKey(candidate, indexKey) === key2);
    if (isRemoved(item)) {
      if (found !== -1)
        result.splice(found, 1);
    } else if (found === -1) {
      result.push(cloneJson(item));
    } else {
      result[found] = cloneJson(item);
    }
  }
  return result;
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
      for (const [fieldId, field2] of schemaFields(parent, schemas, diagnostics, next)) {
        fields.set(fieldId, field2);
      }
    }
  }
  for (const field2 of schema.fields)
    fields.set(field2.fieldId, field2);
  return fields;
}
function mergeFields(base, patch, fields) {
  const merged = Object.fromEntries(Object.entries(base).map(([key2, value2]) => [key2, cloneJson(value2)]));
  for (const [fieldId, incoming] of Object.entries(patch)) {
    const field2 = fields.get(fieldId);
    if (field2 === void 0)
      continue;
    if (field2.cardinality === "append") {
      merged[fieldId] = mergeAppend(merged[fieldId], incoming);
    } else if (field2.cardinality === "indexed") {
      merged[fieldId] = mergeIndexed(merged[fieldId], incoming, field2.indexKey ?? "index");
    } else {
      merged[fieldId] = cloneJson(incoming);
    }
  }
  return merged;
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
function visitRelationField(value2, field2, path, visit) {
  if (field2.linkNamespace !== void 0 && field2.linkNamespace !== "") {
    for (const entityId of relationScalarValues(value2)) {
      if (entityId.length > 0)
        visit(field2.linkNamespace, entityId, path);
    }
  }
  if (field2.fields === void 0)
    return;
  const values = Array.isArray(value2) ? value2 : [value2];
  for (const item of values) {
    const record = recordOf(item);
    if (record === void 0)
      continue;
    const wrapped = record["value"];
    const nested = wrapped === void 0 ? record : recordOf(wrapped) ?? record;
    for (const child of field2.fields) {
      const childValue = nested[child.fieldId];
      if (childValue === void 0)
        continue;
      visitRelationField(childValue, child, `${path}.${child.fieldId}`, visit);
    }
  }
}
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
        fields: {},
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
    current.sources.push(patch.source);
    for (const fieldId of Object.keys(patch.fields)) {
      if (typeFields.has(fieldId))
        continue;
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
    current.fields = mergeFields(current.fields, patch.fields, typeFields);
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
    let inheritanceChain = [];
    let sources = [];
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
        inheritanceChain = [...parent.inheritanceChain];
        sources = [...parent.sources];
      }
    }
    fields = mergeFields(fields, current.fields, fieldsByType.get(current.typeId) ?? /* @__PURE__ */ new Map());
    inheritanceChain.push(ref);
    sources.push(...current.sources);
    const resolved = Object.freeze({
      namespace: current.namespace,
      typeId: current.typeId,
      entityId: current.entityId,
      ...current.parentEntityId === void 0 ? {} : { parentEntityId: current.parentEntityId },
      inheritanceChain: Object.freeze(inheritanceChain.map(immutableRef)),
      fields: Object.freeze(Object.fromEntries(Object.entries(fields).map(([fieldId, value2]) => [fieldId, immutableJson(value2)]))),
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
      const field2 = fields.get(fieldId);
      if (field2 === void 0)
        continue;
      visitRelationField(value2, field2, fieldId, (namespace, entityId, role) => {
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

// packages/sdk/dist/maps/index.js
var MAP_SEMANTIC_ANALYSIS_CONTRACT = "common.map/semantic-analysis";
var RESOLVED_MAP_WORKSPACE_CONTRACT = "common.map/resolved-workspace";
var MAP_PREVIEW_PREPARATION_CONTRACT = "common.map/preview-preparation";
var WORLD_SCENE_SOURCE_CONTRACT = "common.view/world-scene-source";
var MAP_SEMANTIC_MATCHER_PROFILE = "modkit/map-semantic-matcher";
var MAP_PREVIEW_PREPARATION_MATCHER_PROFILE = "modkit/map-preview-preparation-matcher";

// packages/sdk/dist/manifest/patterns.js
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

// packages/sdk/dist/manifest/normalize.js
function isRecord2(value2) {
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
function normalizeExtensionIdentityParts(publisher, id2) {
  return splitExtensionCoordinate(normalizeModkitIdentifier(`${publisher}/${id2}`));
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
async function normalizeExtensionManifest(input) {
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
  const packageJson = isRecord2(packageInput) ? packageInput : void 0;
  const block = packageJson !== void 0 && isRecord2(packageJson["modkit"]) ? packageJson["modkit"] : void 0;
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
  for (const field2 of ["version", "license"]) {
    if (field2 in blockRecord) {
      diagnostics.push(diagnostic("error", "x3.sdk/npm-field-duplicated-in-block", `\xAB${field2}\xBB belongs to the top-level package.json only (Q76 packaging error)`, ["modkit", field2]));
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
    }
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
  const policy2 = request.policy;
  if (policy2?.allowedClasses !== void 0) {
    allowed = intersectClasses(allowed, policy2.allowedClasses);
  }
  if (request.operation !== void 0 && policy2?.operationClasses !== void 0) {
    const ceiling = policy2.operationClasses[request.operation];
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
    contract: "common.view/model-lod-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { levels }",
      "levels(page): { id, nodeIds, order, selection? }"
    ]),
    blockedBy: "no codec publishes discrete LOD levels today: MSFT_lod topology is readable in principle, and nothing reads it"
  }),
  Object.freeze({
    contract: "common.view/model-variant-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { variants }",
      "variants(page): { id, name, kind, targets }"
    ]),
    blockedBy: "no codec publishes named variants today: UV_game_variants exists in the schema and no reader surfaces it"
  }),
  Object.freeze({
    contract: "common.view/model-effect-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { effects, byKind, profile? }",
      "effects(page): { id, kind, nodeId?, materialId? }"
    ]),
    blockedBy: "the UVM reader publishes effect *counts* by kind, which fills info() and nothing else; per-emitter records have no publisher, and a page method no publisher can fill is not a contract"
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
function hasExactStringKeys(value2, keys) {
  if (typeof value2 !== "object" || value2 === null || Array.isArray(value2))
    return false;
  const record = value2;
  const own = Object.keys(record).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  return own.length === expected.length && own.every((key2, index) => key2 === expected[index]) && keys.every((key2) => typeof record[key2] === "string" && record[key2].trim() !== "");
}
function isInventoryEntry(value2) {
  if (typeof value2 !== "object" || value2 === null || Array.isArray(value2))
    return false;
  const record = value2;
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
        const key2 = registrationKey(spec.contract, spec.major);
        counts.set(key2, (counts.get(key2) ?? 0) + 1);
      }
      const results = await Promise.all(ownedEntries.map(async ({ definition: spec, provenance }, index) => {
        const key2 = registrationKey(spec.contract, spec.major);
        if ((counts.get(key2) ?? 0) > 1)
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

// packages/sdk/dist/asset-capabilities/data-source-surfaces.js
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
    events: { kind: "events", ...sig }
  }
};
var namespaceEntrySourceSurface = {
  methods: {
    list: cancellableValue,
    search: { kind: "value", optional: true, ...sig },
    /** `Lease<AssetSourceRef>`: the ref crosses by copy, the lease is a release-only handle. */
    openEntry: { kind: "leased-value", ...sig }
  }
};
var rasterImageSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", ...sig },
    readRegion: { kind: "value", optional: true, ...sig }
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
    page: cancellableValue
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
    relations: cancellableValue
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
    }
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

// packages/sdk/dist/asset-capabilities/uv-projection.js
var QUALIFIED_DIGEST = /^[a-z][a-z0-9-]*:[0-9a-f]{32,128}$/u;
function isAlgorithmQualifiedDigest(value2) {
  return QUALIFIED_DIGEST.test(value2);
}
function algorithmQualifiedDigest(value2) {
  if (!isAlgorithmQualifiedDigest(value2)) {
    throw new TypeError("a UV digest must be algorithm-qualified as \xAB<algorithm>:<lowercase hex>\xBB; a bare hex string is refused");
  }
  return value2;
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
async function validateSubjectDescriptorV2(value2) {
  let snapshot;
  try {
    snapshot = snapshotJsonWireData(value2);
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
        companion.bindingIds.forEach((bindingId2, bindingIndex) => {
          const binding = bundleBindings.get(bindingId2);
          if (binding === void 0 || binding.ownership !== "companion" || binding.role !== companion.role || binding.required !== companion.required || companionBindingIds.has(bindingId2)) {
            semanticDiagnostics.push(diagnostic("error", "x3.sdk/invalid-companion-binding", `resolved companion ${companion.id} does not name a distinct matching companion binding`, ["companions", index, "bindingIds", bindingIndex]));
          }
          companionBindingIds.add(bindingId2);
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
            const key2 = canonicalJsonStringify(candidate);
            if (candidates.has(key2)) {
              semanticDiagnostics.push(diagnostic("error", "x3.sdk/duplicate-companion-candidate", `ambiguous companion ${companion.id} repeats one candidate`, ["companions", index, "candidates", candidateIndex]));
            }
            candidates.add(key2);
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

// packages/sdk/dist/asset-capabilities/presentation.js
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

// packages/sdk/dist/asset-capabilities/visual-composition.js
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

// packages/sdk/dist/asset-capabilities/v1-projection.js
var V1_PROJECTION_UNAVAILABLE_CODE = "modkit/compat-v1-projection-unavailable";

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
  normalizeModkitIdentifier,
  normalizeModkitPackageSpecifier,
  normalizeModkitSourceIdentifier,
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
  WRITER_CONTRACT_ID,
  WRITER_FACET_MATCHER_PROFILE,
  WRITER_SURFACE,
  STANDARD_EDITING_SURFACES,
  ROUND_TRIP_RANK,
  writerOfferSatisfies,
  writerSelectionKey,
  loadSubjectCandidatePage,
  createSubjectCandidateProvider,
  fieldTypeV1Schema,
  fieldSchemaV1Schema,
  fieldWriteRequestV1Schema,
  subjectKindDefinitionSpecV1Schema,
  fieldEditInputSchemaV1Schema,
  fieldEditorContributionSpecV1Schema,
  operationScopedPermissionClasses,
  activationRequiredPermissionClasses,
  rootSubject,
  subjectRefEquals,
  serializeSubjectRef,
  parseSubjectRef,
  subjectDescriptorV2Schema,
  anyDescriptorV2Schema,
  validateWithSchema,
  contributionId,
  isRevisionId,
  revisionId,
  revisionIdFromRef,
  revisionRefFromId,
  assetSourceRefFromSourceRef,
  sourceRefFromAssetSourceRef,
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
  TRAIT_IDS,
  isStandardTraitId,
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
  NATIVE_MODEL_ENCODER_CONTRACT,
  NATIVE_MODEL_ENCODER_MATCHER_PROFILE,
  LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  LANGUAGE_DOCUMENT_MATCHER_PROFILE,
  TRANSLATION_CONTRACT,
  RUNTIME_PROVIDER_CONTRACT,
  RUNTIME_SESSION_CONTRACT,
  RUNTIME_PROVIDER_MATCHER_PROFILE,
  RUNTIME_SESSION_V2_MEMBERS,
  SCENE_RENDERER_CONTRACT,
  SCENE_RENDERER_MATCHER_PROFILE,
  GAME_INSTALLATION_DISCOVERY_CONTRACT,
  GAME_LAUNCH_PLAN_CONTRACT,
  GAME_INSTALLATION_MATCHER_PROFILE,
  MOD_WORKSPACE_COMPOSITION_CONTRACT,
  MOD_WORKSPACE_MATCHER_PROFILE,
  resolveModWorkspaceGraph,
  DATA_CATALOG_ANALYSIS_CONTRACT,
  DATA_CATALOG_MATCHER_PROFILE,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE,
  resolveDataCatalog,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  MAP_PREVIEW_PREPARATION_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  validateContributionPattern,
  expandContributionManifests,
  normalizeExtensionManifest,
  grantValidity,
  narrowGrant,
  assertNotWider,
  RESERVED_MODEL_FACET_SOURCES,
  isReservedModelFacetSource,
  foreignDataSource,
  dataSourceRefFromWire,
  createDataSourceRegistry,
  ENCODED_MEDIA_SURFACE_ID,
  STANDARD_DATA_SOURCE_SURFACES,
  AUXILIARY_DATA_SOURCE_SURFACES,
  standardDataSourceSurfaceFor,
  ENCODED_MEDIA_SURFACE_CONTRACT,
  isAlgorithmQualifiedDigest,
  algorithmQualifiedDigest,
  toPortableProjectionReceipt,
  validateSubjectDescriptorV2,
  bindingId,
  presentationSlotId,
  definePresentationPlan,
  MIXED_VISUAL_STAGE_ID,
  MIXED_VISUAL_WORLD_BINDING_ID,
  MIXED_VISUAL_MODEL_BINDING_ID,
  defineMixedVisualWorkspace,
  isMixedVisualPresentationSlot,
  V1_PROJECTION_UNAVAILABLE_CODE
};
