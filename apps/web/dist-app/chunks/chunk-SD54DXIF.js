import {
  isQualifiedId
} from "./chunk-33VOQNJR.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/sdk/dist/subjects/refs.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
  for (const id of chain) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("subject source id must be non-empty");
    }
    source = { id, ...source === void 0 ? {} : { parent: source } };
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

// ../MODDING/modkit-core/packages/sdk/dist/asset-capabilities/types.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function isJsonValue(value, maxDepth = 64) {
  if (maxDepth < 0)
    return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number")
    return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((item) => isJsonValue(item, maxDepth - 1));
  if (typeof value !== "object")
    return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return false;
  return Object.values(value).every((item) => isJsonValue(item, maxDepth - 1));
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

// ../MODDING/modkit-core/packages/sdk/dist/knowledge/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var KNOWLEDGE_LOCALE_PATTERN = "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$";
var knowledgeLocalePattern = new RegExp(KNOWLEDGE_LOCALE_PATTERN, "u");
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

// ../MODDING/modkit-core/packages/sdk/dist/subjects/candidates.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var nonEmptyStrings = (value) => value === void 0 || value.every((item) => typeof item === "string" && item.length > 0) && new Set(value).size === value.length;
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

export {
  isKnowledgeTarget,
  rootSubject,
  nestedSubject,
  serializeSubjectRef,
  parseSubjectRef,
  isJsonValue,
  revisionId,
  revisionIdFromRef,
  loadSubjectCandidatePage,
  createSubjectCandidateProvider
};
