import {
  isQualifiedId
} from "./chunk-V3DESLW4.js";

// ../MODDING/modkit-core/packages/sdk/dist/subjects/refs.js
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
  for (const id of ref.parentIds ?? []) {
    parent = Object.freeze({ id, ...parent === void 0 ? {} : { parent } });
  }
  return Object.freeze({ id: ref.id, ...parent === void 0 ? {} : { parent } });
}

// ../MODDING/modkit-core/packages/sdk/dist/asset-capabilities/uv-projection.js
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

export {
  REVISION_ID_PATTERN,
  serializeSubjectRef,
  parseSubjectRef,
  isJsonValue,
  contributionId,
  isRevisionId,
  revisionId,
  revisionIdFromRef,
  revisionRefFromId,
  assetSourceRefFromSourceRef,
  sourceRefFromAssetSourceRef,
  isAlgorithmQualifiedDigest,
  algorithmQualifiedDigest,
  toPortableProjectionReceipt
};
