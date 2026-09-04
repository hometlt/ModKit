// mk2-pin:packages/assets/src/cancellation.ts
var NOOP_SUBSCRIPTION = { dispose() {
} };
function createToken(isCancelled, subscribe) {
  return {
    get isCancellationRequested() {
      return isCancelled();
    },
    onCancellationRequested: subscribe
  };
}
var CancellationTokenNone = createToken(
  () => false,
  () => NOOP_SUBSCRIPTION
);
var CancellationTokenCancelled = createToken(
  () => true,
  (listener) => {
    listener();
    return NOOP_SUBSCRIPTION;
  }
);
var CancellationError = class extends Error {
  name = "CancellationError";
  constructor(message = "Operation was cancelled") {
    super(message);
  }
};

// mk2-pin:packages/assets/src/codec-manifest.ts
var CODEC_DEPENDENCY_RELATIONS = [
  "requires",
  "defaults",
  "suggests",
  "integrates",
  "conflicts",
  "replaces",
  "provides"
];
var GAME_CONTRIBUTION_MODES = ["requires", "defaults", "suggests", "integrates"];
var DEPENDENCY_KEYS = new Set(CODEC_DEPENDENCY_RELATIONS);
var GAME_FEATURE_GROUP_KEYS = new Set(GAME_CONTRIBUTION_MODES);

// mk2-pin:packages/assets/src/format-registry.ts
function normalizeFormatExtension(pathOrExtension) {
  const normalized = pathOrExtension.replace(/\\/g, "/").toLowerCase();
  const dot = normalized.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = normalized.slice(dot);
  return /^\.[a-z0-9]+$/.test(ext) ? ext : "";
}

// mk2-pin:packages/assets/src/source.ts
var ASSET_SOURCE_KINDS = [
  /** One addressable byte payload: a loose file, an in-memory buffer, or a remote object. */
  "file",
  /** A directory treated as one artifact (an SC2Mod/SC2Map folder, an asset bundle folder). */
  "directory",
  /** An entry inside an opened container session (MPQ/CASC/ZIP/BIG, possibly nested). */
  "archive-entry",
  /** A mounted virtual filesystem root composed from providers, archives, and overlays. */
  "vfs-root",
  /** A detected game installation root, before any mount ordering is applied. */
  "installation-root"
];
function isKnownAssetSourceKind(value) {
  return ASSET_SOURCE_KINDS.includes(value);
}
var ASSET_SOURCE_ORIGINS = [
  "memory",
  "local-file",
  "browser-handle",
  "http-range",
  "git-blob",
  "archive-session",
  "vfs",
  "unknown"
];
function createAssetSourceDescriptor(init) {
  const path = init.path.replace(/\\/g, "/");
  const name = path.slice(path.lastIndexOf("/") + 1);
  return {
    schemaVersion: 1,
    id: init.id ?? path,
    kind: init.kind ?? "file",
    origin: init.origin ?? "unknown",
    path,
    name: init.name ?? name,
    extension: init.extension ?? normalizeFormatExtension(name),
    readOnly: init.readOnly ?? true,
    randomAccess: init.randomAccess ?? false,
    seekable: init.seekable ?? false,
    ...init.size === void 0 ? {} : { size: init.size },
    ...init.mediaType === void 0 ? {} : { mediaType: init.mediaType },
    ...init.modifiedAt === void 0 ? {} : { modifiedAt: init.modifiedAt },
    ...init.versionToken === void 0 ? {} : { versionToken: init.versionToken },
    ...init.parent === void 0 ? {} : { parent: init.parent },
    ...init.providerId === void 0 ? {} : { providerId: init.providerId },
    ...init.context === void 0 ? {} : { context: init.context }
  };
}
function formatSourceLocation(descriptor) {
  const segments = [];
  let current = descriptor;
  while (current) {
    segments.unshift(current.path);
    current = current.parent;
  }
  return segments.join("!/");
}
function sourceIdentityKey(descriptor) {
  return `${descriptor.id}@${descriptor.versionToken ?? ""}`;
}
function sourceNestingDepth(descriptor) {
  let depth = 0;
  let current = descriptor.parent;
  while (current) {
    depth += 1;
    current = current.parent;
  }
  return depth;
}
function createMemoryAssetSource(bytes, init = { path: "memory" }) {
  const descriptor = createAssetSourceDescriptor({
    ...init,
    origin: "memory",
    size: bytes.byteLength,
    randomAccess: init.randomAccess ?? true,
    seekable: init.seekable ?? true
  });
  const guard = (options, length) => {
    if (options?.cancellation?.isCancellationRequested) {
      throw new CancellationError("Read cancelled");
    }
    if (options?.maxBytes !== void 0 && length > options.maxBytes) {
      throw new RangeError(`Read of ${length} bytes exceeds maxBytes ${options.maxBytes}`);
    }
  };
  return {
    descriptor,
    size: async () => bytes.byteLength,
    read: async (options) => {
      guard(options, bytes.byteLength);
      return bytes.slice();
    },
    readRange: async (range, options) => {
      const offset = Math.max(0, Math.min(range.offset, bytes.byteLength));
      const end = Math.max(offset, Math.min(offset + Math.max(0, range.length), bytes.byteLength));
      guard(options, end - offset);
      return bytes.slice(offset, end);
    }
  };
}
async function readSourceHeader(source, byteCount, cancellation) {
  return source.readRange(
    { offset: 0, length: byteCount },
    cancellation ? { cancellation } : void 0
  );
}
async function readSourceTail(source, byteCount, cancellation) {
  const size = await source.size() ?? 0;
  const offset = Math.max(0, size - byteCount);
  return source.readRange(
    { offset, length: Math.min(byteCount, size) },
    cancellation ? { cancellation } : void 0
  );
}
export {
  ASSET_SOURCE_KINDS,
  ASSET_SOURCE_ORIGINS,
  createAssetSourceDescriptor,
  createMemoryAssetSource,
  formatSourceLocation,
  isKnownAssetSourceKind,
  readSourceHeader,
  readSourceTail,
  sourceIdentityKey,
  sourceNestingDepth
};
