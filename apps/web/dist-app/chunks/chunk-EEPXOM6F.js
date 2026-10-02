import {
  createOrbitController
} from "./chunk-O2DY4UGD.js";
import {
  revisionIdFromRef
} from "./chunk-SD54DXIF.js";
import {
  GRAPH_FALLBACK_MESSAGES,
  ViewerMountScope,
  createSurface,
  createViewerMount,
  defineViewerModule,
  safeViewerText,
  setPart,
  setState,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-ID5URMAQ.js";
import {
  ModkitError,
  canonicalJsonStringify,
  compareUtf8,
  deepFreeze,
  diagnostic,
  hasErrors,
  isQualifiedId,
  isSegment,
  isUInt64String,
  parseSemver,
  parseVersionRange,
  uniqueSortedUtf8
} from "./chunk-33VOQNJR.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/ui/dist/graph/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/sdk/dist/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/sdk/dist/schemas/extension-manifest.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/sdk/dist/schemas/patterns.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var DOTTED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
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

// ../MODDING/modkit-core/packages/sdk/dist/schemas/extension-manifest.js
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
    properties: {
      extension: LANGUAGE_TOKEN,
      languageId: LANGUAGE_TOKEN,
      dialect: LANGUAGE_TOKEN,
      // an XML local name, without a prefix
      rootElement: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9._-]{0,127}$" }
    }
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
      replacesApplicationSettings: {
        type: "array",
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["setting"],
          properties: {
            setting: {
              type: "string",
              pattern: "^[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z0-9_-]+)+$",
              maxLength: 128
            },
            scoped: { const: true }
          }
        }
      },
      scopeFormat: { enum: ["hex"] }
    }
  }
};
var workspaceMarkersSchema = {
  type: "array",
  maxItems: 32,
  items: { type: "string", pattern: "^(?!/)(?![A-Za-z]:)[^\\\\\\u0000]+$", maxLength: 128 }
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
    credentials: credentialsSchema,
    workspaceMarkers: workspaceMarkersSchema
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
    credentials: credentialsSchema,
    workspaceMarkers: workspaceMarkersSchema
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

// ../MODDING/modkit-core/packages/sdk/dist/identity.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
function normalizeByRules(value, rules) {
  for (const [from, to, exact] of rules) {
    const next = exact === true ? value === from ? to : void 0 : value.startsWith(from) ? `${to}${value.slice(from.length)}` : void 0;
    if (next !== void 0)
      return Object.freeze({ value: next, changed: next !== value });
  }
  return Object.freeze({ value, changed: false });
}
function normalizeModkitIdentifier(value) {
  return normalizeByRules(value, QUALIFIED_RULES).value;
}

// ../MODDING/modkit-core/packages/sdk/dist/schemas/contribution-manifest.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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

// ../MODDING/modkit-core/packages/sdk/dist/editing.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var WRITER_CONTRACT_ID = "common.edit/writer";
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
function containerEntryRevision(containerRevision, entryId, byteLength) {
  return revisionIdFromRef({
    kind: "provider-token",
    value: `${String(containerRevision)}!${entryId}:${byteLength}`
  });
}

// ../MODDING/modkit-core/packages/sdk/dist/manifest/validate.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var platformValidatorsPromise;
function platformValidators() {
  platformValidatorsPromise ??= import("./validators.generated-UAICBYKB.js").then((module) => module.PRECOMPILED_SCHEMA_VALIDATORS);
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

// ../MODDING/modkit-core/packages/sdk/dist/host-profile.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/sdk/dist/host-facilities.generated.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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

// ../MODDING/modkit-core/packages/sdk/dist/host-profile.js
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
function isStandardHostFacilityId(value) {
  return standardFacilities.has(value);
}
function isHostFacilityId(value) {
  return isStandardHostFacilityId(value) || legacyFacilities.has(value) || isQualifiedId(value);
}
function hostFacilityId(value) {
  if (!isHostFacilityId(value)) {
    throw new ModkitError({
      code: "x3.sdk/unknown-host-facility",
      message: `unknown unqualified host facility \xAB${value}\xBB`,
      context: {
        facility: value,
        expected: "standard facility ID or extension-owned qualified publisher/name ID"
      }
    });
  }
  return value;
}
function invalidProfile(message, context) {
  throw new ModkitError({
    code: "x3.sdk/invalid-host-profile",
    message,
    ...context === void 0 ? {} : { context }
  });
}
function exactKeys(value, allowed, field) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0)
    invalidProfile(`${field} contains unsupported fields`, { field, extra });
}
function nonEmpty(value, field) {
  if (value.trim().length === 0)
    return invalidProfile(`${field} must not be empty`, { field });
  return value;
}
function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    return invalidProfile(`${field} must be a non-negative safe integer`, { field, value });
  }
  return value;
}
function bytes(value, field) {
  if (!isUInt64String(value))
    return invalidProfile(`${field} must be an unsigned 64-bit string`, { field });
  return value;
}
function normalizeStrings(values) {
  return Object.freeze(uniqueSortedUtf8(values.map((value) => nonEmpty(value, "target list value"))));
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
  const facilities = uniqueSortedUtf8(snapshot.facilities.map((value) => hostFacilityId(value)));
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
  const policy = Object.freeze({
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
    policy
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
    if (transports.length === 0 || transports.some((value) => !transportKinds.has(value))) {
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
    const key = `${link.fromRealm}\0${link.toRealm}`;
    if (seenLinks.has(key))
      return invalidProfile("duplicate directed transport link", { key });
    seenLinks.add(key);
  }
  return Object.freeze({
    schemaVersion: 1,
    topologyId: nonEmpty(snapshot.topologyId, "topologyId"),
    realms: Object.freeze(realms),
    links: Object.freeze(links)
  });
}

// ../MODDING/modkit-core/packages/sdk/dist/relation-graph-neighbourhood.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var PAGE_SIZE = 1024;
var MAX_PAGES = 4096;
function limit(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
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
      const key = `${edge.from}\0${edge.to}\0${edge.role ?? ""}\0${edge.dead === true}`;
      if (edgeKeys.has(key))
        continue;
      if (edges.length >= request.maxEdges) {
        capped = true;
        continue;
      }
      edgeKeys.add(key);
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

// ../MODDING/modkit-core/packages/sdk/dist/maps/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var WORLD_SCENE_SOURCE_CONTRACT = "common.view/world-scene-source";
var MAP_LAYERS_OPERATION = "map.layers";
var MAP_LAYER_READ_OPERATION = "map.layer-read";
var MAP_LAYER_WRITE_OPERATION = "map.layer-write";
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
  const number = (value, name, minimum) => {
    if (!Number.isSafeInteger(value) || value < minimum)
      fail(`${name} must be an integer of at least ${minimum}`);
    return value;
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
  for (const [index, value] of values.entries()) {
    if (!Number.isSafeInteger(value) || value < layer.minimum || value > layer.maximum) {
      fail(`value ${index} must be an integer from ${layer.minimum} to ${layer.maximum}`);
    }
  }
  return window;
}
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

// ../MODDING/modkit-core/packages/sdk/dist/runtime-abi.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function contributionSettingsFor(settings, sourceUri) {
  if (settings === void 0)
    return Object.freeze({});
  const override = sourceUri === void 0 ? void 0 : settings.bySource?.[sourceUri];
  return Object.freeze(override === void 0 ? { ...settings.values } : { ...settings.values, ...override });
}

// ../MODDING/modkit-core/packages/sdk/dist/manifest/patterns.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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

// ../MODDING/modkit-core/packages/sdk/dist/manifest/normalize.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    for (const key of Object.keys(descriptors)) {
      if (key !== "packageJson" && key !== "standalone") {
        throw new TypeError(`unknown authored-container field: ${key}`);
      }
      const descriptor = descriptors[key];
      if (descriptor === void 0 || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`authored-container field ${key} must be inert data`);
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

// ../MODDING/modkit-core/packages/sdk/dist/asset-capabilities/uv-projection.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function toPortableProjectionReceipt(receipt, identity) {
  const { form, sourceUri, ...rest } = receipt;
  void form;
  void sourceUri;
  return { ...rest, form: "portable", sourceIdentity: identity };
}

// ../MODDING/modkit-core/packages/sdk/dist/asset-capabilities/presentation.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function bindingId(value) {
  if (!isSegment(value))
    throw new TypeError(`invalid binding id: ${value}`);
  return value;
}
function presentationSlotId(value) {
  if (!isSegment(value))
    throw new TypeError(`invalid presentation slot id: ${value}`);
  return value;
}

// ../MODDING/modkit-core/packages/sdk/dist/templates/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var GAME_TEMPLATE_PREVIEW_OPERATION_ID = "view.template";
var GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION = 1;
var GAME_TEMPLATE_WORKSPACE_INPUT = "workspaceDocuments";
var finite = (value) => typeof value === "number" && Number.isFinite(value);
var optionalBoolean = (value) => value === void 0 || typeof value === "boolean";
function isGameTemplateTextRun(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const run = value;
  return typeof run["text"] === "string" && (run["color"] === void 0 || typeof run["color"] === "string") && optionalBoolean(run["bold"]) && optionalBoolean(run["italic"]) && optionalBoolean(run["underline"]) && (run["size"] === void 0 || finite(run["size"]) && run["size"] > 0) && (run["asset"] === void 0 || typeof run["asset"] === "string" && run["text"] === "") && (run["unresolved"] === void 0 || typeof run["unresolved"] === "string");
}
function isGameTemplateDisplayItem(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const item = value;
  const rect = item["rect"];
  const text = item["text"];
  return ["box", "text", "image"].includes(String(item["kind"])) && Array.isArray(item["path"]) && item["path"].every((part) => typeof part === "string") && typeof rect === "object" && rect !== null && finite(rect["x"]) && finite(rect["y"]) && finite(rect["width"]) && finite(rect["height"]) && optionalBoolean(item["visible"]) && (text === void 0 || typeof text === "string" || Array.isArray(text) && text.every(isGameTemplateTextRun)) && (item["asset"] === void 0 || typeof item["asset"] === "string") && (item["frameType"] === void 0 || typeof item["frameType"] === "string");
}
function gameTemplateTextRuns(item) {
  if (item.text === void 0)
    return [];
  return typeof item.text === "string" ? [{ text: item.text }] : item.text;
}
var optionalString = (value) => value === void 0 || typeof value === "string";
function isValueSource(value) {
  if (value === void 0)
    return true;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const source = value;
  return optionalString(source["uri"]) && optionalString(source["origin"]) && optionalString(source["frame"]) && (source["start"] === void 0 || finite(source["start"])) && (source["end"] === void 0 || finite(source["end"]));
}
var recordsOk = (list, check) => list === void 0 || Array.isArray(list) && list.every((item) => typeof item === "object" && item !== null && !Array.isArray(item) && check(item));
function isNodeShallow(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const node = value;
  return typeof node["name"] === "string" && optionalString(node["type"]) && optionalString(node["template"]) && isValueSource(node["source"]) && Array.isArray(node["path"]) && node["path"].every((part) => typeof part === "string") && Array.isArray(node["children"]) && recordsOk(node["properties"], (item) => typeof item["name"] === "string" && optionalString(item["val"]) && optionalString(item["resolved"]) && isValueSource(item["source"])) && recordsOk(node["anchors"], (item) => typeof item["side"] === "string" && optionalString(item["relative"]) && optionalString(item["pos"]) && optionalString(item["offset"]) && isValueSource(item["source"]));
}
function isGameTemplateTreeNode(value, maximumNodes = 1e5) {
  const pending = [value];
  let seen = 0;
  while (pending.length > 0) {
    const node = pending.pop();
    if (!isNodeShallow(node) || ++seen > maximumNodes)
      return false;
    for (const child of node.children)
      pending.push(child);
  }
  return true;
}
var nonEmpty2 = (value) => typeof value === "string" && value.trim().length > 0;
function isGameTemplatePreviewResult(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const result = value;
  const fidelity = result["fidelity"];
  return result["schemaVersion"] === GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION && result["operationId"] === GAME_TEMPLATE_PREVIEW_OPERATION_ID && nonEmpty2(result["templateKind"]) && nonEmpty2(result["entryUri"]) && (result["rootPath"] === void 0 || typeof result["rootPath"] === "string") && (result["roots"] === void 0 || Array.isArray(result["roots"]) && result["roots"].every((root) => typeof root === "string")) && typeof result["resolvedTree"] === "object" && result["resolvedTree"] !== null && Array.isArray(result["displayItems"]) && Array.isArray(result["diagnostics"]) && ["complete", "partial", "capped", "invalid"].includes(String(result["completeness"])) && typeof fidelity === "object" && fidelity !== null && !Array.isArray(fidelity) && fidelity["comparison"] === "semantic" && Array.isArray(fidelity["unsupported"]) && result["provenance"] !== void 0 && result["digest"] !== void 0;
}

// ../MODDING/modkit-core/packages/ui/dist/graph/projection.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var FORCE_LAYOUT_LIMIT = 220;
var FIELD_OF_VIEW = 48 * Math.PI / 180;
var NEAR = 0.1;
function hash(value) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
function sphericalPoint(index, count2, seed, radius) {
  const y = 1 - 2 * ((index + 0.5) / Math.max(1, count2));
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = Math.PI * 2 * (index * 0.61803398875 + seed);
  return [Math.cos(angle) * radial * radius, y * radius, Math.sin(angle) * radial * radius];
}
var rootIndexOf = (input) => input.root === void 0 ? 0 : input.nodes.findIndex((node) => node.id === input.root);
function layoutGalaxyGraph(input) {
  const groups = /* @__PURE__ */ new Map();
  for (const node of input.nodes) {
    const group = groups.get(node.type);
    if (group)
      group.push(node);
    else
      groups.set(node.type, [node]);
  }
  const entries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const cloudRadius = Math.max(280, Math.cbrt(input.nodes.length) * 65);
  const placed = /* @__PURE__ */ new Map();
  entries.forEach(([type, members], groupIndex) => {
    const seed = hash(type) / 4294967295;
    const shell = cloudRadius * (0.35 + 0.65 * (hash(`${type}:shell`) % 1e3 / 1e3));
    const center = sphericalPoint(groupIndex, entries.length, seed, shell);
    const localRadius = 24 + Math.cbrt(members.length) * 19;
    members.forEach((node, localIndex) => {
      const localSeed = hash(node.id) / 4294967295;
      const local = sphericalPoint(localIndex, members.length, localSeed, localRadius);
      placed.set(node, [center[0] + local[0], center[1] + local[1], center[2] + local[2]]);
    });
  });
  const rootIndex = input.clustered === true ? -1 : rootIndexOf(input);
  return input.nodes.map((node, index) => index === rootIndex ? [0, 0, 0] : placed.get(node) ?? [0, 0, 0]);
}
function depths(input, indexById) {
  const result = input.nodes.map(() => 1);
  const rootIndex = rootIndexOf(input);
  if (rootIndex < 0)
    return result;
  const adjacent = input.nodes.map(() => []);
  for (const edge of input.edges) {
    const from = indexById.get(edge.from);
    const to = indexById.get(edge.to);
    if (from === void 0 || to === void 0)
      continue;
    adjacent[from]?.push(to);
    adjacent[to]?.push(from);
  }
  const seen = /* @__PURE__ */ new Set([rootIndex]);
  result[rootIndex] = 0;
  let frontier = [rootIndex];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next = [];
    for (const index of frontier) {
      for (const neighbour of adjacent[index] ?? []) {
        if (seen.has(neighbour))
          continue;
        seen.add(neighbour);
        result[neighbour] = depth;
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return result;
}
function layoutRelationGraph(input) {
  const count2 = input.nodes.length;
  if (count2 === 0)
    return [];
  if (count2 > FORCE_LAYOUT_LIMIT || input.clustered === true)
    return layoutGalaxyGraph(input);
  const indexById = new Map(input.nodes.map((node, index) => [node.id, index]));
  const depth = depths(input, indexById);
  const rootIndex = rootIndexOf(input);
  const bodies = input.nodes.map((node, index) => {
    const seed = hash(node.id) / 4294967295;
    const p = index === rootIndex ? [0, 0, 0] : sphericalPoint(index, count2, seed, 95 + Math.max(1, depth[index] ?? 1) * 115);
    return { p, v: [0, 0, 0] };
  });
  const pairs = input.edges.flatMap((edge) => {
    const from = bodies[indexById.get(edge.from) ?? -1];
    const to = bodies[indexById.get(edge.to) ?? -1];
    return from === void 0 || to === void 0 ? [] : [[from, to]];
  });
  const root = bodies[rootIndex];
  for (let iteration = 0; iteration < 150; iteration++) {
    const cooling = 1 - iteration / 175;
    bodies.forEach((a, i) => {
      for (let j = i + 1; j < count2; j++) {
        const b = bodies[j];
        if (b === void 0)
          continue;
        const dx = a.p[0] - b.p[0];
        const dy = a.p[1] - b.p[1];
        const dz = a.p[2] - b.p[2];
        const lengthSq = dx * dx + dy * dy + dz * dz;
        const distanceSq = Math.max(100, lengthSq);
        const length = Math.sqrt(lengthSq);
        const k = 55e3 / distanceSq * cooling;
        const fx = length === 0 ? 0 : dx / length * k;
        const fy = length === 0 ? 0 : dy / length * k;
        const fz = length === 0 ? 0 : dz / length * k;
        a.v[0] += fx;
        a.v[1] += fy;
        a.v[2] += fz;
        b.v[0] -= fx;
        b.v[1] -= fy;
        b.v[2] -= fz;
      }
    });
    for (const [from, to] of pairs) {
      const dx = to.p[0] - from.p[0];
      const dy = to.p[1] - from.p[1];
      const dz = to.p[2] - from.p[2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const k = (Math.max(1, length) - 130) * 35e-4 * cooling;
      const fx = length === 0 ? 0 : dx / length * k;
      const fy = length === 0 ? 0 : dy / length * k;
      const fz = length === 0 ? 0 : dz / length * k;
      from.v[0] += fx;
      from.v[1] += fy;
      from.v[2] += fz;
      to.v[0] -= fx;
      to.v[1] -= fy;
      to.v[2] -= fz;
    }
    const damping = -15e-5 * cooling;
    for (const body of bodies) {
      if (body === root)
        continue;
      const { p, v } = body;
      v[0] = (v[0] + p[0] * damping) * 0.82;
      v[1] = (v[1] + p[1] * damping) * 0.82;
      v[2] = (v[2] + p[2] * damping) * 0.82;
      p[0] += v[0];
      p[1] += v[1];
      p[2] += v[2];
    }
    if (root !== void 0)
      root.p = [0, 0, 0];
  }
  return bodies.map((body) => body.p);
}
function frame(positions) {
  if (positions.length === 0)
    return { center: [0, 0, 0], distance: 360 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of positions) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return { center, distance: Math.max(360, radius * 2.45) };
}
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function project(point, camera) {
  const rel = [point[0] - camera.eye[0], point[1] - camera.eye[1], point[2] - camera.eye[2]];
  const depth = -dot(rel, camera.basis.backward);
  if (depth <= NEAR)
    return void 0;
  const focal = camera.height / 2 / Math.tan(FIELD_OF_VIEW / 2);
  const scale = focal / depth;
  return {
    x: camera.width / 2 + dot(rel, camera.basis.right) * scale,
    y: camera.height / 2 - dot(rel, camera.basis.up) * scale,
    depth,
    scale
  };
}
function unproject(dx, dy, depth, camera) {
  const focal = camera.height / 2 / Math.tan(FIELD_OF_VIEW / 2);
  const perPixel = depth / focal;
  const { right, up } = camera.basis;
  return [
    (right[0] * dx - up[0] * dy) * perPixel,
    (right[1] * dx - up[1] * dy) * perPixel,
    (right[2] * dx - up[2] * dy) * perPixel
  ];
}
function pick(hits, x, y, slop = 3) {
  let best = -1;
  let bestDepth = Infinity;
  hits.forEach((hit, index) => {
    if (hit === void 0)
      return;
    if (Math.hypot(hit.x - x, hit.y - y) > hit.radius + slop)
      return;
    if (hit.depth < bestDepth) {
      best = index;
      bestDepth = hit.depth;
    }
  });
  return best;
}
function depthFade(depth, near, far, floor = 0.25) {
  if (far <= near)
    return 1;
  const t = Math.min(1, Math.max(0, (depth - near) / (far - near)));
  return 1 - t * (1 - floor);
}

// ../MODDING/modkit-core/packages/ui/dist/graph/index.js
function positiveLimit(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${label} must be positive`);
  return value;
}
async function loadPages(read, maximum, pageSize, signal) {
  const items = [];
  let cursor;
  const seen = /* @__PURE__ */ new Set();
  while (items.length < maximum) {
    signal?.throwIfAborted();
    const remaining = maximum - items.length;
    const requested = Math.min(pageSize, remaining);
    const page = await read(cursor, requested);
    signal?.throwIfAborted();
    items.push(...page.items.slice(0, requested));
    if (page.items.length > requested) {
      return { items: Object.freeze(items), completeness: "capped" };
    }
    if (page.nextCursor === void 0) {
      return { items: Object.freeze(items), completeness: "complete" };
    }
    if (page.items.length === 0) {
      throw new Error("relation graph source returned an empty page with a continuation cursor");
    }
    if (seen.has(page.nextCursor))
      throw new Error("relation graph source repeated a page cursor");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { items: Object.freeze(items), completeness: "capped" };
}
function loadedCountReason(nodeCount, totalNodes, edgeCount, totalEdges, localizer) {
  return localizer.text("graph.loadedCounts", {
    nodes: nodeCount.toLocaleString(localizer.locale),
    totalNodes: totalNodes.toLocaleString(localizer.locale),
    edges: edgeCount.toLocaleString(localizer.locale),
    totalEdges: totalEdges.toLocaleString(localizer.locale)
  });
}
function arrowhead(context, from, to, inset, size) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= inset + size)
    return;
  const ux = dx / length;
  const uy = dy / length;
  const tipX = to.x - ux * inset;
  const tipY = to.y - uy * inset;
  const baseX = tipX - ux * size;
  const baseY = tipY - uy * size;
  const half = size * 0.45;
  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(baseX - uy * half, baseY + ux * half);
  context.lineTo(baseX + uy * half, baseY - ux * half);
  context.closePath();
  context.fill();
}
async function loadRelationGraphOptions(source, options) {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES);
  const nodeLimit = positiveLimit(options.nodeLimit ?? 500, "nodeLimit");
  const edgeLimit = positiveLimit(options.edgeLimit ?? 5e3, "edgeLimit");
  const pageSize = positiveLimit(options.pageSize ?? 250, "pageSize");
  options.signal?.throwIfAborted();
  const summary = await source.summary(options.signal);
  options.signal?.throwIfAborted();
  const [nodeLoad, edgeLoad] = await Promise.all([
    loadPages((cursor, limit2) => source.nodes({ ...cursor === void 0 ? {} : { cursor }, limit: limit2 }, options.signal), nodeLimit, pageSize, options.signal),
    loadPages((cursor, limit2) => source.edges({ ...cursor === void 0 ? {} : { cursor }, limit: limit2 }, options.signal), edgeLimit, pageSize, options.signal)
  ]);
  options.signal?.throwIfAborted();
  const consumerCapped = nodeLoad.completeness === "capped" || edgeLoad.completeness === "capped" || nodeLoad.items.length >= nodeLimit && nodeLoad.items.length < summary.totalNodes || edgeLoad.items.length >= edgeLimit && edgeLoad.items.length < summary.totalEdges;
  const consumerPartial = !consumerCapped && (nodeLoad.items.length < summary.totalNodes || edgeLoad.items.length < summary.totalEdges);
  const consumerCompleteness = consumerCapped ? "capped" : consumerPartial ? "partial" : "complete";
  return {
    label: options.label,
    localizer,
    nodes: nodeLoad.items,
    edges: edgeLoad.items,
    types: summary.types,
    totalNodes: summary.totalNodes,
    totalEdges: summary.totalEdges,
    sourceCompleteness: summary.completeness,
    ...summary.reason === void 0 ? {} : { sourceReason: summary.reason },
    consumerCompleteness,
    ...consumerCompleteness === "complete" ? {} : {
      consumerReason: loadedCountReason(nodeLoad.items.length, summary.totalNodes, edgeLoad.items.length, summary.totalEdges, localizer)
    },
    cap: nodeLimit
  };
}
var WALK_SCAN_LIMIT = 1e5;
var GRAPH_WALK_DEPTHS = [1, 2, 3, 4];
async function loadRelationNeighbourhoodOptions(source, walk, options) {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES);
  const nodeLimit = positiveLimit(options.nodeLimit ?? 500, "nodeLimit");
  const edgeLimit = positiveLimit(options.edgeLimit ?? 5e3, "edgeLimit");
  const summary = await source.summary(options.signal);
  const found = await relationGraphNeighbourhood(source, {
    roots: [walk.root],
    depth: walk.depth,
    direction: walk.direction,
    maxNodes: nodeLimit,
    maxEdges: edgeLimit,
    scanLimit: WALK_SCAN_LIMIT
  }, options.signal);
  const degree = /* @__PURE__ */ new Map();
  for (const edge of found.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const rank = (node) => node.id === walk.root ? Number.POSITIVE_INFINITY : degree.get(node.id) ?? 0;
  const nodes = [...found.nodes].sort((left, right) => rank(right) - rank(left));
  const counts = /* @__PURE__ */ new Map();
  for (const node of nodes)
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  const stopped = found.capped || !found.scanned.nodes.exhausted || !found.scanned.edges.exhausted;
  return {
    label: options.label,
    localizer,
    nodes,
    edges: found.edges,
    types: summary.types.flatMap((type) => {
      const count2 = counts.get(type.id) ?? 0;
      return count2 === 0 ? [] : [{ ...type, count: count2 }];
    }),
    totalNodes: nodes.length,
    totalEdges: found.edges.length,
    sourceCompleteness: summary.completeness,
    ...summary.reason === void 0 ? {} : { sourceReason: summary.reason },
    consumerCompleteness: stopped ? "capped" : "complete",
    ...stopped ? {
      consumerReason: localizer.text("graph.walkStopped", {
        nodes: nodes.length.toLocaleString(localizer.locale),
        edges: found.edges.length.toLocaleString(localizer.locale)
      })
    } : {},
    cap: nodeLimit
  };
}
var CATEGORICAL = 6;
var RENDERER_3D = "canvas-3d";
var RENDERER_2D = "canvas-2d";
var LABEL_LIMIT = 100;
var FOCUS_MS = 250;
function createRelationGraph(document, options) {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES);
  const cap = options.cap ?? 500;
  const root = document.createElement("div");
  root.className = "modkit-graph";
  root.setAttribute("aria-label", options.label);
  setPart(root, "graph");
  const sidebar = document.createElement("aside");
  sidebar.className = "modkit-graph__sidebar";
  setPart(sidebar, "graph.sidebar");
  const sidebarHead = document.createElement("div");
  sidebarHead.className = "modkit-graph__sidebar-head";
  setPart(sidebarHead, "graph.sidebar-head");
  const heading = document.createElement("span");
  heading.textContent = localizer.text("graph.nodeTypes");
  sidebarHead.append(heading);
  for (const [label, all] of [
    [localizer.text("graph.all"), true],
    [localizer.text("graph.none"), false]
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      for (const id of hidden.keys())
        hidden.set(id, !all);
      syncTypes();
      relayout();
    });
    sidebarHead.append(button);
  }
  sidebar.append(sidebarHead);
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = localizer.text("graph.filterClasses");
  filter.setAttribute("aria-label", localizer.text("graph.filterNodeTypes"));
  filter.className = "modkit-graph__filter";
  sidebar.append(filter);
  const typeList = document.createElement("div");
  typeList.className = "modkit-graph__types";
  typeList.setAttribute("role", "group");
  setPart(typeList, "graph.types");
  sidebar.append(typeList);
  const hidden = new Map(options.types.map((type) => [type.id, false]));
  const typeRows = /* @__PURE__ */ new Map();
  const typeById = new Map(options.types.map((type) => [type.id, type]));
  for (const type of options.types) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "modkit-graph__type";
    row.dataset["tone"] = String(type.tone % CATEGORICAL);
    setPart(row, "graph.type");
    const swatch = document.createElement("span");
    swatch.setAttribute("aria-hidden", "true");
    setPart(swatch, "graph.type-swatch");
    const label = document.createElement("span");
    label.textContent = safeViewerText(type.label, 64);
    const count2 = document.createElement("span");
    count2.textContent = String(type.count);
    setPart(count2, "graph.type-count");
    row.append(swatch, label, count2);
    row.addEventListener("click", () => {
      hidden.set(type.id, !(hidden.get(type.id) ?? false));
      syncTypes();
      relayout();
    });
    typeList.append(row);
    typeRows.set(type.id, row);
  }
  filter.addEventListener("input", () => {
    const needle = filter.value.trim().toLowerCase();
    for (const type of options.types) {
      const row = typeRows.get(type.id);
      if (row !== void 0)
        row.hidden = needle !== "" && !type.label.toLowerCase().includes(needle);
    }
  });
  const syncTypes = () => {
    for (const [id, row] of typeRows) {
      const off = hidden.get(id) ?? false;
      row.setAttribute("aria-pressed", String(!off));
      setState(row, off ? ["disabled"] : ["active"]);
    }
  };
  const nodeList = document.createElement("select");
  nodeList.size = 8;
  nodeList.className = "modkit-graph__node-list";
  nodeList.setAttribute("aria-label", localizer.text("graph.nodeList"));
  setPart(nodeList, "graph.node-list");
  sidebar.append(nodeList);
  const main = document.createElement("div");
  main.className = "modkit-graph__main";
  setPart(main, "graph.main");
  const controls = document.createElement("div");
  controls.className = "modkit-graph__controls";
  controls.setAttribute("role", "toolbar");
  controls.setAttribute("aria-label", localizer.text("graph.controls"));
  setPart(controls, "graph.controls");
  const status = document.createElement("output");
  status.className = "modkit-graph__status";
  setPart(status, "graph.status");
  const legend = document.createElement("span");
  legend.textContent = localizer.text("graph.directionLegend");
  setPart(legend, "graph.legend");
  controls.append(status, legend);
  const search = document.createElement("input");
  search.type = "search";
  search.className = "modkit-graph__search";
  search.placeholder = localizer.text("graph.search");
  search.setAttribute("aria-label", localizer.text("graph.searchLabel"));
  setPart(search, "graph.search");
  controls.append(search);
  const control = (labelText, values, value) => {
    const wrapper = document.createElement("label");
    wrapper.className = "modkit-graph__control";
    setPart(wrapper, "graph.control");
    wrapper.append(document.createTextNode(labelText));
    const select = document.createElement("select");
    for (const item of values) {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      select.append(option);
    }
    select.value = value;
    wrapper.append(select);
    controls.append(wrapper);
    return select;
  };
  const labelsWrapper = document.createElement("label");
  labelsWrapper.className = "modkit-graph__control";
  setPart(labelsWrapper, "graph.control");
  const labels = document.createElement("input");
  labels.type = "checkbox";
  labels.checked = true;
  labelsWrapper.append(labels, document.createTextNode(localizer.text("graph.labels")));
  controls.append(labelsWrapper);
  const nodeChoices = [.../* @__PURE__ */ new Set([100, 250, 500, 1e3, cap])].sort((left, right) => left - right).map(String);
  const nodesCap = control(localizer.text("graph.nodes"), nodeChoices, String(cap));
  const roles = [...new Set(options.edges.flatMap((edge) => edge.role ? [edge.role] : []))].sort();
  const roleSelect = roles.length === 0 ? void 0 : control(localizer.text("graph.relations"), [localizer.text("graph.allRelations"), ...roles], localizer.text("graph.allRelations"));
  const roleShown = (edge) => roleSelect === void 0 || roleSelect.selectedIndex <= 0 || edge.role === roles[roleSelect.selectedIndex - 1];
  const rendererIds = [RENDERER_3D, RENDERER_2D, ...(options.renderers ?? []).map((item) => item.id)];
  const rendererSelect = control(localizer.text("graph.renderer"), [
    localizer.text("graph.canvas3d"),
    localizer.text("graph.canvas2d"),
    ...(options.renderers ?? []).map((item) => item.label)
  ], localizer.text("graph.canvas3d"));
  let mode = RENDERER_3D;
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = localizer.text("graph.resetView");
  reset.addEventListener("click", () => {
    if (external !== void 0) {
      external.reset();
      return;
    }
    layout();
    draw();
  });
  controls.append(reset);
  const makeRoot = options.onRoot === void 0 ? void 0 : document.createElement("button");
  if (makeRoot !== void 0) {
    makeRoot.type = "button";
    makeRoot.textContent = localizer.text("graph.makeRoot");
    makeRoot.disabled = true;
    makeRoot.addEventListener("click", () => {
      const node = placed[selected]?.node;
      if (node !== void 0)
        options.onRoot?.(node);
    });
    controls.append(makeRoot);
  }
  const syncMakeRoot = () => {
    if (makeRoot !== void 0) {
      makeRoot.disabled = selected < 0 || placed[selected]?.node.id === rootId;
    }
  };
  const stage = document.createElement("div");
  stage.className = "modkit-graph__stage";
  const canvas = document.createElement("canvas");
  canvas.className = "modkit-graph__canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", options.label);
  canvas.tabIndex = 0;
  setPart(canvas, "graph.canvas");
  const tooltip = document.createElement("div");
  tooltip.className = "modkit-graph__tooltip";
  tooltip.hidden = true;
  setPart(tooltip, "graph.tooltip");
  stage.append(canvas, tooltip);
  const hint = document.createElement("p");
  hint.className = "modkit-graph__hint";
  setPart(hint, "graph.hint");
  const syncHint = () => {
    const open2 = options.onOpen !== void 0;
    hint.textContent = localizer.text(mode === RENDERER_2D ? open2 ? "graph.hintOpen" : "graph.hint" : open2 ? "graph.hint3dOpen" : "graph.hint3d");
  };
  syncHint();
  main.append(controls, stage, hint);
  const footer = document.createElement("div");
  footer.className = "modkit-graph__footer";
  setPart(footer, "graph.footer");
  for (const group of options.footer ?? []) {
    const box = document.createElement("section");
    box.className = "modkit-graph__footer-group";
    setPart(box, "graph.footer-group");
    const title = document.createElement("h4");
    title.textContent = safeViewerText(group.title, 64);
    box.append(title);
    for (const item of group.items) {
      const row = document.createElement("div");
      row.className = "modkit-graph__footer-item";
      setPart(row, "graph.footer-item");
      row.textContent = `${safeViewerText(item.label, 64)} (${item.count})`;
      box.append(row);
    }
    footer.append(box);
  }
  root.append(sidebar, main, footer);
  const context = canvas.getContext("2d");
  const view = document.defaultView;
  const reducedMotion = () => view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let placed = [];
  let zoom = 1;
  let originX = 0;
  let originY = 0;
  let dragging;
  let panning = false;
  let last = { x: 0, y: 0 };
  const orbit = createOrbitController();
  let world = [];
  let worldKey = "";
  let framing = frame([]);
  let target = [0, 0, 0];
  let hits = [];
  let hovered = -1;
  let selected = -1;
  let animation = 0;
  const degree = /* @__PURE__ */ new Map();
  for (const edge of options.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const rootId = options.nodes[0]?.id;
  const visibleNodes = () => {
    const limit2 = Number(nodesCap.value);
    return options.nodes.filter((node) => !(hidden.get(node.type) ?? false)).slice(0, limit2);
  };
  const completenessNotice = (owner, completeness, reason) => {
    if (completeness === void 0 || completeness === "complete" && reason === void 0) {
      return void 0;
    }
    const state = completeness === void 0 || completeness === "complete" ? "" : ` ${completeness}`;
    const explanation = reason === void 0 ? "" : `: ${safeViewerText(reason, 240)}`;
    return localizer.text("graph.completeness", {
      owner: localizer.text(owner === "source" ? "graph.source" : "graph.view"),
      state,
      reason: explanation
    });
  };
  const matches = (node) => {
    const needle = search.value.trim().toLowerCase();
    if (needle === "")
      return void 0;
    return node.label.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle);
  };
  const statusText = (drawnEdges, renderer) => {
    const totalNodes = options.totalNodes ?? options.nodes.length;
    const visibleCandidates = options.nodes.filter((node) => !(hidden.get(node.type) ?? false));
    const notices = [
      completenessNotice("source", options.sourceCompleteness, options.sourceReason),
      completenessNotice("view", options.consumerCompleteness, options.consumerReason),
      ...placed.length < visibleCandidates.length ? [
        localizer.text("graph.visibleCapped", {
          count: placed.length.toLocaleString(localizer.locale)
        })
      ] : []
    ].filter((item) => item !== void 0);
    const matched = search.value.trim() === "" ? void 0 : localizer.text("graph.matches", {
      count: placed.filter((item) => matches(item.node)).length.toLocaleString(localizer.locale)
    });
    return [
      localizer.text("graph.nodeCount", {
        visible: placed.length.toLocaleString(localizer.locale),
        total: totalNodes.toLocaleString(localizer.locale)
      }),
      localizer.text("graph.edgeCount", {
        count: drawnEdges.toLocaleString(localizer.locale)
      }),
      matched,
      renderer,
      ...notices
    ].filter((item) => item !== void 0).join(" \xB7 ");
  };
  const syncNodeList = () => {
    nodeList.replaceChildren(...placed.map((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = safeViewerText(item.node.label, 64);
      return option;
    }));
    nodeList.selectedIndex = selected;
  };
  function layout() {
    const nodes = visibleNodes();
    const radius = Math.min(canvas.width, canvas.height) / 2.6;
    placed = nodes.map((node, index) => {
      const angle = index / Math.max(1, nodes.length) * Math.PI * 2;
      const spread = radius * (0.35 + 0.65 * (index * 0.61803398875 % 1));
      return {
        node,
        x: Math.cos(angle) * spread,
        y: Math.sin(angle) * spread,
        vx: 0,
        vy: 0
      };
    });
    zoom = 1;
    originX = 0;
    originY = 0;
    const key = nodes.map((node) => node.id).join("\n");
    if (key !== worldKey) {
      worldKey = key;
      world = layoutRelationGraph({
        nodes,
        edges: options.edges,
        ...rootId === void 0 ? {} : { root: rootId }
      });
      selected = -1;
    }
    framing = frame(world);
    target = [...framing.center];
    orbit.reset();
    hovered = -1;
    tooltip.hidden = true;
    syncNodeList();
  }
  const relayout = () => {
    layout();
    draw();
  };
  const tokens = () => {
    const styles = getComputedStyle(root);
    return (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  };
  const toneOf = (node) => (typeById.get(node.type)?.tone ?? 0) % CATEGORICAL + 1;
  const edgeColour = (token, edge) => edge.dead === true ? token("--mk-color-graph-edge-dead", "#f14c4c") : edge.role === void 0 ? token("--mk-color-graph-edge", "#5a5a5a") : token(`--mk-chart-categorical-${hash(edge.role) % CATEGORICAL + 1}`, "#5a5a5a");
  const cameraNow = () => ({
    target,
    eye: orbit.position(target, framing.distance),
    basis: orbit.basis(),
    width: canvas.width,
    height: canvas.height
  });
  function draw() {
    syncMakeRoot();
    if (context === null) {
      status.textContent = statusText(0);
      return;
    }
    if (mode === RENDERER_3D)
      draw3d(context);
    else
      draw2d(context);
  }
  function draw2d(context2) {
    const token = tokens();
    const width = canvas.width;
    const height = canvas.height;
    context2.setTransform(1, 0, 0, 1, 0, 0);
    context2.fillStyle = token("--mk-color-canvas-bg", "#141414");
    context2.fillRect(0, 0, width, height);
    context2.translate(width / 2 + originX, height / 2 + originY);
    context2.scale(zoom, zoom);
    const index = new Map(placed.map((item) => [item.node.id, item]));
    let drawnEdges = 0;
    context2.lineWidth = 1 / zoom;
    for (const edge of options.edges) {
      if (!roleShown(edge))
        continue;
      const from = index.get(edge.from);
      const to = index.get(edge.to);
      if (from === void 0 || to === void 0)
        continue;
      context2.strokeStyle = edgeColour(token, edge);
      context2.fillStyle = context2.strokeStyle;
      context2.globalAlpha = edge.dead === true ? 0.9 : 0.45;
      context2.beginPath();
      context2.moveTo(from.x, from.y);
      context2.lineTo(to.x, to.y);
      context2.stroke();
      arrowhead(context2, from, to, 4 / zoom + 1, 6 / zoom);
      drawnEdges += 1;
    }
    context2.globalAlpha = 1;
    const showLabels = labels.checked;
    placed.forEach((item, position) => {
      const match = matches(item.node);
      context2.globalAlpha = match === false ? 0.2 : 1;
      context2.fillStyle = token(`--mk-chart-categorical-${toneOf(item.node)}`, "#4daafc");
      context2.beginPath();
      context2.arc(item.x, item.y, 4 / zoom + 1, 0, Math.PI * 2);
      context2.fill();
      if (position === selected || match === true) {
        context2.strokeStyle = token("--mk-color-focus", "#0078d4");
        context2.lineWidth = 2 / zoom;
        context2.stroke();
        context2.lineWidth = 1 / zoom;
      }
      if (showLabels && placed.length <= 120 || position === selected) {
        context2.fillStyle = token("--mk-color-fg-muted", "#9d9d9d");
        context2.font = `${11 / zoom}px ${token("--mk-font-sans", "sans-serif")}`;
        context2.fillText(safeViewerText(item.node.label, 40), item.x + 7 / zoom, item.y + 3 / zoom);
      }
    });
    context2.globalAlpha = 1;
    status.textContent = statusText(drawnEdges);
  }
  function draw3d(context2) {
    const token = tokens();
    const width = canvas.width;
    const height = canvas.height;
    context2.setTransform(1, 0, 0, 1, 0, 0);
    context2.fillStyle = token("--mk-color-canvas-bg", "#141414");
    context2.fillRect(0, 0, width, height);
    const camera = cameraNow();
    const projected = world.map((point) => project(point, camera));
    let near = Infinity;
    let far = -Infinity;
    for (const point of projected) {
      if (point === void 0)
        continue;
      near = Math.min(near, point.depth);
      far = Math.max(far, point.depth);
    }
    const index = new Map(placed.map((item, position) => [item.node.id, position]));
    const selectedId = placed[selected]?.node.id;
    const radiusAt = (position) => {
      const point = projected[position];
      const item = placed[position];
      if (point === void 0 || item === void 0)
        return 0;
      const size = item.node.id === rootId ? 9 : 4.5 + Math.min(4, Math.log2((degree.get(item.node.id) ?? 0) + 1));
      return Math.max(2.5, Math.min(24, size * point.scale * 1.5));
    };
    let drawnEdges = 0;
    context2.lineWidth = 1;
    for (const edge of options.edges) {
      if (!roleShown(edge))
        continue;
      const fromIndex = index.get(edge.from);
      const toIndex = index.get(edge.to);
      if (fromIndex === void 0 || toIndex === void 0)
        continue;
      const from = projected[fromIndex];
      const to = projected[toIndex];
      if (from === void 0 || to === void 0)
        continue;
      const incident = selectedId !== void 0 && (edge.from === selectedId || edge.to === selectedId);
      const fade = depthFade((from.depth + to.depth) / 2, near, far);
      context2.strokeStyle = edgeColour(token, edge);
      context2.fillStyle = context2.strokeStyle;
      context2.globalAlpha = (edge.dead === true ? 0.9 : 0.45) * fade * (selectedId === void 0 || incident ? 1 : 0.35);
      context2.lineWidth = incident ? 2 : 1;
      context2.beginPath();
      context2.moveTo(from.x, from.y);
      context2.lineTo(to.x, to.y);
      context2.stroke();
      arrowhead(context2, from, to, radiusAt(toIndex), incident ? 9 : 7);
      drawnEdges += 1;
    }
    const order = placed.map((_item, position) => position);
    order.sort((a, b) => (projected[b]?.depth ?? 0) - (projected[a]?.depth ?? 0));
    const showLabels = labels.checked && placed.length <= LABEL_LIMIT;
    const font = token("--mk-font-sans", "sans-serif");
    hits = placed.map(() => void 0);
    for (const position of order) {
      const point = projected[position];
      const item = placed[position];
      if (point === void 0 || item === void 0)
        continue;
      const isRoot = item.node.id === rootId;
      const radius = radiusAt(position);
      const match = matches(item.node);
      const fade = depthFade(point.depth, near, far);
      hits[position] = { x: point.x, y: point.y, radius, depth: point.depth };
      context2.globalAlpha = fade * (match === false ? 0.2 : 1);
      context2.fillStyle = isRoot ? token("--mk-color-graph-node", "#cccccc") : token(`--mk-chart-categorical-${toneOf(item.node)}`, "#4daafc");
      context2.beginPath();
      context2.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context2.fill();
      const emphasised = position === selected || position === hovered || match === true;
      if (emphasised) {
        context2.globalAlpha = 1;
        context2.strokeStyle = token("--mk-color-focus", "#0078d4");
        context2.lineWidth = position === selected ? 2.5 : 1.5;
        context2.stroke();
      }
      if (showLabels || emphasised || isRoot) {
        context2.globalAlpha = emphasised ? 1 : fade;
        context2.fillStyle = token(isRoot || emphasised ? "--mk-color-fg" : "--mk-color-fg-muted", "#9d9d9d");
        context2.font = `${isRoot ? "bold " : ""}11px ${font}`;
        context2.fillText(safeViewerText(item.node.label, 40), point.x + radius + 4, point.y + 4);
      }
    }
    context2.globalAlpha = 1;
    context2.lineWidth = 1;
    status.textContent = statusText(drawnEdges);
  }
  orbit.onChange(() => {
    if (mode === RENDERER_3D)
      draw();
  });
  const pointAt = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const pick2d = (event) => {
    const box = canvas.getBoundingClientRect();
    const x = (event.clientX - box.left - canvas.width / 2 - originX) / zoom;
    const y = (event.clientY - box.top - canvas.height / 2 - originY) / zoom;
    return placed.find((item) => Math.hypot(item.x - x, item.y - y) < 8 / zoom);
  };
  const hitIndex = (event) => {
    if (mode === RENDERER_2D) {
      const hit = pick2d(event);
      return hit === void 0 ? -1 : placed.indexOf(hit);
    }
    const { x, y } = pointAt(event);
    return pick(hits, x, y);
  };
  const open = (position) => {
    const item = placed[position];
    if (item !== void 0)
      options.onOpen?.(item.node);
  };
  const focus = (position) => {
    selected = position;
    if (nodeList.selectedIndex !== position)
      nodeList.selectedIndex = position;
    syncMakeRoot();
    const destination = world[position];
    if (view)
      view.cancelAnimationFrame(animation);
    if (mode !== RENDERER_3D || destination === void 0 || !view || reducedMotion()) {
      if (mode === RENDERER_3D && destination !== void 0)
        target = [...destination];
      draw();
      return;
    }
    const start = [...target];
    const began = view.performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / FOCUS_MS);
      const ease = 1 - (1 - t) ** 3;
      target = [
        start[0] + (destination[0] - start[0]) * ease,
        start[1] + (destination[1] - start[1]) * ease,
        start[2] + (destination[2] - start[2]) * ease
      ];
      draw();
      if (t < 1)
        animation = view.requestAnimationFrame(step);
    };
    animation = view.requestAnimationFrame(step);
  };
  const showTooltip = (position, event) => {
    const item = placed[position];
    if (item === void 0) {
      tooltip.hidden = true;
      return;
    }
    const type = typeById.get(item.node.type)?.label ?? item.node.type;
    tooltip.textContent = [item.node.label, type, item.node.kind].filter((part) => part !== void 0 && part !== "").map((part) => safeViewerText(part, 80)).join(" \xB7 ");
    const { x, y } = pointAt(event);
    tooltip.style.setProperty("left", `${x + 14}px`);
    tooltip.style.setProperty("top", `${y + 14}px`);
    tooltip.hidden = false;
  };
  let press;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
    if (mode === RENDERER_2D) {
      dragging = pick2d(event);
      panning = dragging === void 0;
    }
    press = {
      index: hitIndex(event),
      pan: event.button !== 0 || event.shiftKey,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
  });
  canvas.addEventListener("pointermove", (event) => {
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    if (press !== void 0 && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) {
      press.moved = true;
    }
    if (mode === RENDERER_2D) {
      if (dragging === void 0 && !panning)
        return;
      if (dragging !== void 0) {
        dragging.x += dx / zoom;
        dragging.y += dy / zoom;
      } else {
        originX += dx;
        originY += dy;
      }
      draw();
      return;
    }
    if (press === void 0) {
      const next = hitIndex(event);
      canvas.style.setProperty("cursor", next >= 0 ? "pointer" : "");
      if (next !== hovered) {
        hovered = next;
        draw();
      }
      showTooltip(hovered, event);
      return;
    }
    if (!press.moved)
      return;
    tooltip.hidden = true;
    const camera = cameraNow();
    const node = world[press.index];
    if (node !== void 0) {
      const depth = project(node, camera)?.depth ?? framing.distance;
      const offset = unproject(dx, dy, depth, camera);
      world[press.index] = [node[0] + offset[0], node[1] + offset[1], node[2] + offset[2]];
      draw();
    } else if (press.pan) {
      const offset = unproject(dx, dy, framing.distance * orbit.pose.distanceScale, camera);
      target = [target[0] - offset[0], target[1] - offset[1], target[2] - offset[2]];
      draw();
    } else {
      orbit.orbit(-dx, dy);
    }
  });
  const release = (event) => {
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    const clicked = press !== void 0 && !press.moved && press.index >= 0;
    const index = press?.index ?? -1;
    dragging = void 0;
    panning = false;
    press = void 0;
    if (clicked && event.type === "pointerup")
      focus(index);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    if (hovered >= 0 && press === void 0) {
      hovered = -1;
      draw();
    }
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (mode === RENDERER_3D) {
      orbit.zoom(event.deltaY);
      return;
    }
    zoom = Math.max(0.2, Math.min(6, zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
    draw();
  }, { passive: false });
  canvas.addEventListener("dblclick", (event) => {
    const index = hitIndex(event);
    if (index >= 0)
      open(index);
  });
  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 40 : 12;
    if (event.key === "Enter" && selected >= 0)
      open(selected);
    else if (event.key === "Escape") {
      selected = -1;
      nodeList.selectedIndex = -1;
      draw();
    } else if (mode !== RENDERER_3D)
      return;
    else if (event.key === "ArrowLeft")
      orbit.orbit(-step, 0);
    else if (event.key === "ArrowRight")
      orbit.orbit(step, 0);
    else if (event.key === "ArrowUp")
      orbit.orbit(0, -step);
    else if (event.key === "ArrowDown")
      orbit.orbit(0, step);
    else if (event.key === "+" || event.key === "=")
      orbit.zoom(-1);
    else if (event.key === "-")
      orbit.zoom(1);
    else if (event.key === "0") {
      layout();
      draw();
    } else
      return;
    event.preventDefault();
  });
  nodeList.addEventListener("change", () => focus(nodeList.selectedIndex));
  nodeList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || nodeList.selectedIndex < 0)
      return;
    event.preventDefault();
    open(nodeList.selectedIndex);
  });
  nodeList.addEventListener("dblclick", () => {
    if (nodeList.selectedIndex >= 0)
      open(nodeList.selectedIndex);
  });
  search.addEventListener("input", draw);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter")
      return;
    const first = placed.findIndex((item) => matches(item.node) === true);
    if (first >= 0)
      focus(first);
  });
  nodesCap.addEventListener("change", relayout);
  roleSelect?.addEventListener("change", draw);
  labels.addEventListener("change", draw);
  let external;
  const externalHost = document.createElement("div");
  externalHost.className = "modkit-graph__external";
  externalHost.hidden = true;
  setPart(externalHost, "graph.canvas");
  stage.after(externalHost);
  const paletteSnapshot = () => {
    const styles = getComputedStyle(root);
    const read = (name) => styles.getPropertyValue(name).trim();
    const palette = {
      background: read("--mk-color-canvas-bg") || "#141414",
      edge: read("--mk-color-graph-edge") || "#5a5a5a",
      edgeDead: read("--mk-color-graph-edge-dead") || "#f14c4c",
      label: read("--mk-color-fg-muted") || "#9d9d9d"
    };
    for (let index = 1; index <= CATEGORICAL; index += 1) {
      palette[`categorical-${index}`] = read(`--mk-chart-categorical-${index}`) || "#4daafc";
    }
    return palette;
  };
  const externalState = () => ({
    nodes: placed.map((item) => item.node),
    edges: options.edges.filter(roleShown),
    types: options.types,
    labels: labels.checked,
    palette: paletteSnapshot()
  });
  const selectRenderer = () => {
    const index = rendererSelect.selectedIndex;
    const id = rendererIds[index] ?? RENDERER_3D;
    external?.destroy();
    external = void 0;
    mode = id;
    syncHint();
    tooltip.hidden = true;
    if (id === RENDERER_3D || id === RENDERER_2D) {
      stage.hidden = false;
      externalHost.hidden = true;
      resize();
      return;
    }
    const factory = (options.renderers ?? []).find((item) => item.id === id);
    if (factory === void 0)
      return;
    stage.hidden = true;
    externalHost.hidden = false;
    const hooks = options.onOpen === void 0 ? {} : { onOpen: options.onOpen };
    external = factory.create(externalHost, hooks);
    const box = externalHost.getBoundingClientRect();
    external.resize(Math.max(240, Math.round(box.width)), Math.max(200, Math.round(box.height)));
    external.render(externalState());
    const drawn = external.drawnEdges?.() ?? options.edges.length;
    status.textContent = statusText(drawn, factory.label);
  };
  rendererSelect.addEventListener("change", selectRenderer);
  const resize = () => {
    if (external !== void 0) {
      const box2 = externalHost.getBoundingClientRect();
      external.resize(Math.max(240, Math.round(box2.width)), Math.max(200, Math.round(box2.height)));
      external.render(externalState());
      return;
    }
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.max(240, Math.round(box.width));
    canvas.height = Math.max(200, Math.round(box.height));
    layout();
    draw();
  };
  syncTypes();
  queueMicrotask(resize);
  return {
    root,
    resize,
    destroy() {
      if (view)
        view.cancelAnimationFrame(animation);
      external?.destroy();
      root.remove();
    }
  };
}
var GRAPH_MORE_FACTOR = 16;
function createRelationGraphViewer(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES);
  const firstDepth = Math.min(4, Math.max(1, Math.trunc(options.depth ?? 2)));
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("graph.viewer"));
      const document = root.ownerDocument;
      try {
        const lease = await unknownSourceLease(args.sources, args.slot, "common.view/relation-graph-source");
        if (lease === void 0)
          throw new TypeError("relation graph binding is unavailable");
        scope.lease(lease);
        const source = lease.value;
        const label = localizer.text("graph.relation");
        const first = (await source.nodes({ limit: 1 }, scope.signal)).items[0];
        let walk = first === void 0 ? void 0 : { root: first.id, depth: firstDepth, direction: "both" };
        let rootLabel = first?.label ?? "";
        let whole = walk === void 0;
        const bar = document.createElement("div");
        bar.setAttribute("role", "toolbar");
        bar.setAttribute("aria-label", localizer.text("graph.walk"));
        setPart(bar, "graph.walk");
        const rootLine = document.createElement("output");
        const wholeBox = document.createElement("input");
        wholeBox.type = "checkbox";
        wholeBox.checked = whole;
        const wholeLabel = document.createElement("label");
        wholeLabel.append(wholeBox, document.createTextNode(localizer.text("graph.wholeGraph")));
        const choice = (text, values, value) => {
          const wrapper = document.createElement("label");
          wrapper.append(document.createTextNode(text));
          const select = document.createElement("select");
          for (const [id, caption] of values) {
            const option = document.createElement("option");
            option.value = id;
            option.textContent = caption;
            select.append(option);
          }
          select.value = value;
          wrapper.append(select);
          bar.append(wrapper);
          return select;
        };
        bar.append(wholeLabel);
        const depthSelect = choice(localizer.text("graph.depth"), GRAPH_WALK_DEPTHS.map((depth) => [String(depth), String(depth)]), String(firstDepth));
        const directionSelect = choice(localizer.text("graph.direction"), [
          ["both", localizer.text("graph.directionBoth")],
          ["outgoing", localizer.text("graph.directionOutgoing")],
          ["incoming", localizer.text("graph.directionIncoming")]
        ], "both");
        bar.append(rootLine);
        bar.hidden = walk === void 0;
        root.append(bar);
        const syncBar = () => {
          depthSelect.disabled = whole;
          directionSelect.disabled = whole;
          rootLine.textContent = whole ? "" : localizer.text("graph.root", { label: rootLabel });
        };
        const firstNodes = positiveLimit(options.nodeLimit ?? 500, "nodeLimit");
        const firstEdges = positiveLimit(options.edgeLimit ?? 5e3, "edgeLimit");
        let factor = 1;
        const more = document.createElement("button");
        more.type = "button";
        more.hidden = true;
        more.addEventListener("click", () => {
          factor *= 2;
          void show().catch(() => void 0);
        });
        bar.append(more);
        const navigation = args.subjectNavigation;
        let graph;
        let pass = 0;
        const show = async () => {
          const current = ++pass;
          syncBar();
          const limits = {
            label,
            localizer,
            nodeLimit: firstNodes * factor,
            edgeLimit: firstEdges * factor,
            signal: scope.signal
          };
          const loaded = whole || walk === void 0 ? await loadRelationGraphOptions(source, limits) : await loadRelationNeighbourhoodOptions(source, walk, limits);
          if (current !== pass || scope.signal.aborted)
            return;
          more.hidden = loaded.consumerCompleteness !== "capped" || factor >= GRAPH_MORE_FACTOR;
          more.textContent = localizer.text("graph.loadMore", {
            nodes: (firstNodes * factor * 2).toLocaleString(localizer.locale)
          });
          graph?.destroy();
          graph = createRelationGraph(document, {
            ...loaded,
            ...walk === void 0 ? {} : {
              onRoot(node) {
                if (walk === void 0)
                  return;
                walk = { ...walk, root: node.id };
                rootLabel = node.label;
                whole = false;
                wholeBox.checked = false;
                void show().catch(() => void 0);
              }
            },
            ...navigation === void 0 ? {} : {
              onOpen(node) {
                if (node.subject === void 0)
                  return;
                void navigation.open({ scope: navigation.scope, target: node.subject }, scope.signal).catch(() => void 0);
              }
            }
          });
          root.append(graph.root);
        };
        const rewalk = () => {
          if (walk === void 0)
            return;
          walk = {
            ...walk,
            depth: Number(depthSelect.value),
            direction: directionSelect.value
          };
          void show().catch(() => void 0);
        };
        depthSelect.addEventListener("change", rewalk);
        directionSelect.addEventListener("change", rewalk);
        wholeBox.addEventListener("change", () => {
          whole = wholeBox.checked;
          void show().catch(() => void 0);
        });
        await show();
        scope.cleanup(() => graph?.destroy());
        root.dataset["revision"] = args.descriptor.revision;
        return createViewerMount(root, scope, args, ({ descriptor }) => {
          root.dataset["revision"] = descriptor.revision;
        });
      } catch (error) {
        await scope.close();
        root.remove();
        throw error;
      }
    }
  });
}
var relationGraphViewer = createRelationGraphViewer();
var graph_default = relationGraphViewer;

export {
  normalizeModkitIdentifier,
  containerEntryRevision,
  createHostTopology,
  WORLD_SCENE_SOURCE_CONTRACT,
  MAP_LAYERS_OPERATION,
  MAP_LAYER_READ_OPERATION,
  MAP_LAYER_WRITE_OPERATION,
  MAP_LAYERS_INPUT_SCHEMA,
  MAP_LAYER_READ_INPUT_SCHEMA,
  MAP_LAYER_WRITE_INPUT_SCHEMA,
  mapLayerWindow,
  transformTerrainUv,
  contributionSettingsFor,
  expandContributionManifests,
  normalizeExtensionManifest,
  toPortableProjectionReceipt,
  bindingId,
  presentationSlotId,
  GAME_TEMPLATE_PREVIEW_OPERATION_ID,
  GAME_TEMPLATE_WORKSPACE_INPUT,
  isGameTemplateTextRun,
  isGameTemplateDisplayItem,
  gameTemplateTextRuns,
  isGameTemplateTreeNode,
  isGameTemplatePreviewResult,
  loadRelationGraphOptions,
  GRAPH_WALK_DEPTHS,
  loadRelationNeighbourhoodOptions,
  createRelationGraph,
  createRelationGraphViewer,
  relationGraphViewer,
  graph_default
};
