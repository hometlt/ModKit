import {
  PROJECTION_RECEIPT_METADATA_ID
} from "../../../../chunks/chunk-ZC6AMIVY.js";
import {
  pageStart
} from "../../../../chunks/chunk-FUAGPPGY.js";
import "../../../../chunks/chunk-IBG4CEKN.js";
import "../../../../chunks/chunk-I675VFQQ.js";
import "../../../../chunks/chunk-GO3VAZA2.js";
import "../../../../chunks/chunk-D6GLIKYJ.js";
import "../../../../chunks/chunk-IJPXHLGV.js";
import {
  snapshotJson
} from "../../../../chunks/chunk-ZSDVUSRM.js";
import "../../../../chunks/chunk-5SBJANAJ.js";
import "../../../../chunks/chunk-ZQEAQJ3E.js";
import {
  decompressBounded
} from "../../../../chunks/chunk-GDKG5J25.js";
import "../../../../chunks/chunk-BFR65BLC.js";
import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource
} from "../../../../chunks/chunk-6WWYE5QA.js";
import "../../../../chunks/chunk-5GGWVEQJ.js";
import {
  containerEntryRevision,
  contributionSettingsFor
} from "../../../../chunks/chunk-RP2NZG33.js";
import "../../../../chunks/chunk-MT2JUZZJ.js";
import "../../../../chunks/chunk-R2P56FTH.js";
import "../../../../chunks/chunk-P5QJHSUW.js";
import {
  revisionId,
  toPortableProjectionReceipt
} from "../../../../chunks/chunk-3PXCW2IQ.js";
import {
  ModkitError,
  canonicalJsonStringify,
  diagnostic
} from "../../../../chunks/chunk-V3DESLW4.js";
import "../../../../chunks/chunk-NUFRM6SI.js";
import "../../../../chunks/chunk-UDFSUVGJ.js";
import {
  crc32
} from "../../../../chunks/chunk-TWH75SBL.js";
import "../../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/deferred-session.js
function deferAssetSession(revision, initialize, budget, openingSignal) {
  const controller = new AbortController();
  const signal = openingSignal === void 0 ? controller.signal : AbortSignal.any([openingSignal, controller.signal]);
  let pending;
  let resolved;
  let disposed = false;
  let disposal;
  let release;
  const releaseResolved = () => {
    if (release === void 0)
      release = resolved?.dispose() ?? Promise.resolve();
    return release;
  };
  const requireLive = () => {
    if (disposed)
      throw new ModkitError({
        code: "x3.host/session-disposed",
        message: "the deferred asset session has been disposed"
      });
    signal.throwIfAborted();
  };
  const get = async () => {
    requireLive();
    pending ??= Promise.resolve().then(async () => {
      requireLive();
      resolved = await initialize(signal);
      try {
        requireLive();
        if (resolved.revision !== revision)
          throw new ModkitError({
            code: "x3.host/subject-session-identity-mismatch",
            message: "deferred inspection changed the selected source revision"
          });
        return resolved;
      } catch (error) {
        await releaseResolved();
        throw error;
      }
    });
    const session = await pending;
    requireLive();
    return session;
  };
  const waitForSession = (waitSignal) => {
    if (waitSignal.aborted)
      return Promise.resolve(void 0);
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (action) => {
        if (finished)
          return;
        finished = true;
        waitSignal.removeEventListener("abort", onAbort);
        action();
      };
      const onAbort = () => finish(() => resolve(void 0));
      waitSignal.addEventListener("abort", onAbort, { once: true });
      void get().then((session) => finish(() => resolve(session)), (error) => finish(() => reject(error)));
    });
  };
  const dispose = () => {
    if (disposal !== void 0)
      return disposal;
    disposed = true;
    controller.abort();
    disposal = (async () => {
      if (pending === void 0)
        return;
      await pending.catch(() => void 0);
      if (resolved !== void 0)
        await releaseResolved();
    })();
    return disposal;
  };
  const rejected = (reason, message) => ({
    state: "rejected",
    reason,
    diagnostics: [diagnostic("error", `x3.host/${reason}`, message)]
  });
  const operations = Object.freeze({
    async invoke(handlerId, input, options) {
      if (disposed || signal.aborted || options?.signal?.aborted)
        return rejected("cancelled", "the deferred operation was cancelled before dispatch");
      let owned;
      try {
        owned = snapshotJson(input, {
          maxDepth: budget.maxDepth,
          maxNodes: budget.maxNodes,
          maxBytes: budget.maxScalarBytes
        }, options?.signal);
      } catch {
        return rejected("input-not-serializable", "operation input must be bounded JSON data");
      }
      const invokeSignal = options?.signal === void 0 ? signal : AbortSignal.any([signal, options.signal]);
      const invokeOptions = { ...options, signal: invokeSignal };
      try {
        const session = await waitForSession(invokeSignal);
        if (session === void 0 || invokeSignal.aborted)
          return rejected("cancelled", "the deferred operation was cancelled");
        const result = await session.operations().invoke(handlerId, owned, invokeOptions);
        if (disposed || invokeSignal.aborted)
          return rejected("cancelled", "the deferred operation was cancelled");
        return result;
      } catch (error) {
        if (disposed || signal.aborted || invokeOptions?.signal?.aborted)
          return rejected("cancelled", "the deferred operation was cancelled");
        throw error;
      }
    },
    dispose
  });
  return Object.freeze({
    revision,
    state: () => disposed ? "disposed" : resolved?.state() ?? "live",
    async descriptor() {
      const descriptor = await (await get()).descriptor();
      requireLive();
      return descriptor;
    },
    async dataSource(contract, major) {
      const lease = await (await get()).dataSource(contract, major);
      try {
        requireLive();
        return lease;
      } catch (error) {
        await lease.release();
        throw error;
      }
    },
    operations: () => operations,
    async *events(eventSignal) {
      const waitSignal = eventSignal === void 0 ? signal : AbortSignal.any([signal, eventSignal]);
      const session = await waitForSession(waitSignal);
      if (session === void 0 || waitSignal.aborted)
        return;
      yield* session.events(waitSignal);
    },
    dispose
  });
}

// ../MODDING/modkit-core/packages/codec-kit/dist/container-entries.js
var CONTAINER_EXTRACT_HANDLER_ID = "extract-entry";
function throwIfCancelled(signal) {
  if (signal?.aborted)
    throw new DOMException("operation cancelled", "AbortError");
}
var offsetOf = (storage, signal) => storage.locate === void 0 ? Promise.resolve(storage.offset) : storage.locate(signal);
function validPath(path) {
  return path !== "" && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function containerEntryAccess(table, context) {
  const fold = (path) => table.caseSensitivity === "insensitive" ? path.toLowerCase() : path;
  const byPath = /* @__PURE__ */ new Map();
  for (const entry of table.entries) {
    if (!validPath(entry.path))
      throw new TypeError(`container entry path \xAB${entry.path}\xBB is invalid`);
    if (typeof entry.size !== "bigint" || entry.size < 0n)
      throw new TypeError(`container entry ${entry.path} has an invalid size`);
    const key = fold(entry.path);
    if (byPath.has(key))
      throw new TypeError(`container entry path \xAB${entry.path}\xBB is not unique`);
    byPath.set(key, entry);
  }
  const entries = [...byPath.values()];
  const containerRevision = revisionId(String(context.source.revision));
  const directories = (table.directories ?? []).map(({ path, hidden }) => {
    if (!validPath(path))
      throw new TypeError(`container folder path \xAB${path}\xBB is invalid`);
    return Object.freeze({
      id: `${path}/`,
      path: `${path}/`,
      name: path.slice(path.lastIndexOf("/") + 1),
      kind: "directory",
      ...hidden === true ? { hidden: true } : {},
      // a plain string: a branded RevisionId would leak an unexported brand into the declarations
      revision: String(context.source.revision)
    });
  });
  const maximum = Number(context.budget.maxInputBytes);
  const storedSize = (entry) => entry.storage.kind === "stored" ? entry.storage.length : entry.storage.kind === "custom" ? void 0 : entry.storage.compressedLength;
  const toItem = (entry) => {
    const stored = storedSize(entry);
    return Object.freeze({
      id: entry.path,
      path: entry.path,
      name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
      kind: "file",
      size: entry.size,
      ...stored === void 0 || stored === entry.size ? {} : { storedSize: stored },
      ...entry.storage.kind !== "custom" ? { compression: entry.storage.kind } : entry.storage.compression === void 0 ? {} : { compression: entry.storage.compression },
      ...entry.modifiedAt === void 0 ? {} : { modifiedAt: entry.modifiedAt },
      ...entry.checksum === void 0 ? {} : { checksum: entry.checksum },
      ...entry.hidden === true ? { hidden: true } : {},
      ...entry.mediaType === void 0 ? {} : { mediaType: entry.mediaType },
      // In place only within the container's own source; a companion's entry is extracted.
      ...entry.storage.kind === "stored" && entry.storage.source === void 0 && entry.storage.locate === void 0 ? {
        storedRange: Object.freeze({
          offset: entry.storage.offset,
          length: entry.storage.length
        })
      } : {},
      // Readable by range without extraction: stored data in a companion, a RefPack stream (decoded
      // from checkpoints), or a custom entry whose storage promises a range source.
      ...entry.storage.kind === "stored" && (entry.storage.source !== void 0 || entry.storage.locate !== void 0) || entry.storage.kind === "refpack" || entry.storage.kind === "custom" && entry.storage.rangeAccess === true ? { rangeAccess: true } : {},
      revision: containerEntryRevision(containerRevision, entry.path, entry.size)
    });
  };
  const found = /* @__PURE__ */ new Map();
  const entryAt = async (path, signal) => {
    const key = fold(path);
    const known = byPath.get(key) ?? found.get(key);
    if (known !== void 0 || table.find === void 0 || !validPath(path))
      return known;
    const entry = await table.find(path, signal);
    if (entry === void 0)
      return void 0;
    if (fold(entry.path) !== key || typeof entry.size !== "bigint" || entry.size < 0n) {
      throw new TypeError(`container lookup of \xAB${path}\xBB answered another or an invalid entry`);
    }
    found.set(key, entry);
    return entry;
  };
  const namespace = Object.freeze({
    async list(prefix, page, signal) {
      throwIfCancelled(signal);
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0)
        throw new TypeError("page limit must be a positive safe integer");
      const start = page.cursor === void 0 ? 0 : Number(page.cursor);
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError("invalid container entry cursor");
      const wanted = fold(prefix);
      const under = wanted.endsWith("/") ? wanted : `${wanted}/`;
      const matching = prefix === "" ? entries : entries.filter((entry) => {
        const path = fold(entry.path);
        return path === wanted || path.startsWith(under);
      });
      const folders = directories.filter((folder) => {
        const path = fold(folder.path);
        return prefix === "" || path === `${wanted}/` || path.startsWith(under);
      });
      const all = [...matching.map(toItem), ...folders];
      const items = all.slice(start, start + page.limit);
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < all.length ? { nextCursor: String(start + items.length) } : {}
      });
    },
    ...table.nestedContext === void 0 ? {} : {
      async nestedContext(signal) {
        throwIfCancelled(signal);
        return table.nestedContext;
      }
    },
    ...table.preamble === void 0 ? {} : {
      async readPreamble(maxBytes, signal) {
        throwIfCancelled(signal);
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
          throw new TypeError("preamble maxBytes must be a non-negative safe integer");
        const bytes = await table.preamble(maxBytes, signal);
        if (bytes.byteLength > maxBytes)
          throw new RangeError("container preamble exceeds the requested bound");
        return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
      }
    },
    async lookup(path, signal) {
      throwIfCancelled(signal);
      const entry = await entryAt(path, signal);
      return entry === void 0 ? void 0 : toItem(entry);
    },
    async openEntrySource(entryId, signal) {
      throwIfCancelled(signal);
      const entry = await entryAt(entryId, signal);
      if (entry === void 0)
        throw new TypeError(`unknown container entry ${entryId}`);
      const storage = entry.storage;
      if (storage.kind === "stored" || storage.kind === "refpack") {
        let holder;
        if (storage.source === void 0) {
          holder = { source: context.byteSource, release: async () => void 0 };
        } else {
          if (context.companionSource === void 0)
            throw new TypeError(`container entry data lives in companion \xAB${storage.source}\xBB, which this open does not carry`);
          holder = await context.companionSource(storage.source, signal);
        }
        try {
          const start = await offsetOf(storage, signal);
          const extent = storage.kind === "stored" ? storage.length : storage.compressedLength;
          const window = Object.freeze({
            size: async () => extent,
            async read(offset, length, readSignal) {
              if (offset < 0n || offset + BigInt(length) > extent)
                throw new RangeError("container entry read is outside the entry");
              return holder.source.read(start + offset, length, readSignal);
            }
          });
          if (storage.kind === "stored")
            return Object.freeze({ value: window, release: () => holder.release() });
          const { refPackRangeSource } = await import("../../../codec-kit/compression/refpack.js");
          const decoded = await refPackRangeSource(window, { compressedLength: extent });
          return Object.freeze({ value: decoded, release: () => holder.release() });
        } catch (error) {
          await holder.release();
          throw error;
        }
      }
      if (storage.kind === "custom" && storage.rangeAccess === true) {
        const opened = await storage.open(signal);
        if (Symbol.asyncIterator in opened)
          throw new TypeError(`container entry ${entry.path} promised a range source, not a stream`);
        return Object.freeze({ value: opened, release: async () => void 0 });
      }
      throw new TypeError(`container entry ${entry.path} is not readable by range; extract it`);
    },
    async openEntry(entryId, signal) {
      throwIfCancelled(signal);
      const entry = await entryAt(entryId, signal);
      if (entry === void 0)
        throw new TypeError(`unknown container entry ${entryId}`);
      return simpleLease(Object.freeze({
        id: `${context.source.ref.id}!/${entry.path}`,
        // segments encoded: a `#` or `?` in a name (Emperor `#M61 …/test.xbf`) is not a fragment
        uri: `${context.scheme}:${encodeURIComponent(context.source.ref.uri)}!/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
        parentIds: Object.freeze([context.source.ref.id])
      }));
    }
  });
  const readRange = async (offset, length, signal, bindingId) => {
    if (length > BigInt(maximum))
      throw new RangeError(`container entry range of ${length} bytes exceeds the read budget of ${maximum}`);
    let bytes;
    if (bindingId === void 0) {
      bytes = await context.byteSource.read(offset, Number(length), signal);
    } else {
      if (context.companionSource === void 0) {
        throw new TypeError(`container entry data lives in companion \xAB${bindingId}\xBB, which this open does not carry`);
      }
      const companion = await context.companionSource(bindingId, signal);
      try {
        bytes = await companion.source.read(offset, Number(length), signal);
      } finally {
        await companion.release();
      }
    }
    if (BigInt(bytes.byteLength) !== length)
      throw new RangeError("container entry is truncated");
    return bytes;
  };
  const extractEntry = (entry, signal) => decodeContainerEntry(entry, maximum, readRange, signal);
  const extract = async (input, operation) => {
    const entryId = input !== null && typeof input === "object" && !Array.isArray(input) ? input.entryId : void 0;
    const entry = typeof entryId === "string" ? await entryAt(entryId, operation.signal) : void 0;
    if (entry === void 0)
      throw new TypeError("container.extract requires a known {entryId}");
    return { kind: "bytes", value: await extractEntry(entry, operation.signal) };
  };
  const decodedTotal = entries.reduce((total, entry) => total + entry.size, 0n);
  return Object.freeze({ namespace, extract, extractEntry, decodedTotal });
}
async function decodeContainerEntry(entry, maximum, readRange, signal) {
  if (entry.size > BigInt(maximum)) {
    throw new RangeError(`container entry ${entry.path} (${entry.size} bytes) exceeds the extraction budget of ${maximum}`);
  }
  const size = Number(entry.size);
  const storage = entry.storage;
  let bytes;
  switch (storage.kind) {
    case "stored":
      bytes = await readRange(await offsetOf(storage, signal), storage.length, signal, storage.source);
      break;
    case "deflate":
    case "zlib":
    case "gzip": {
      const { decompressBounded: decompressBounded2 } = await import("../../../codec-kit/compression/bounded.js");
      const format = storage.kind === "deflate" ? "deflate-raw" : storage.kind === "zlib" ? "deflate" : "gzip";
      bytes = await decompressBounded2(await readRange(await offsetOf(storage, signal), storage.compressedLength, signal, storage.source), format, {
        maxOutputBytes: size,
        ...signal === void 0 ? {} : { signal }
      });
      break;
    }
    case "zstd": {
      const { decodeZstd } = await import("../../../codec-kit/compression/zstd.js");
      bytes = decodeZstd(await readRange(await offsetOf(storage, signal), storage.compressedLength, signal, storage.source), {
        expectedLength: size,
        maxOutputBytes: size
      });
      break;
    }
    case "lz4-block": {
      const { decodeLz4Block } = await import("../../../codec-kit/compression/lz4.js");
      bytes = decodeLz4Block(await readRange(await offsetOf(storage, signal), storage.compressedLength, signal, storage.source), size);
      break;
    }
    case "refpack": {
      const { decodeRefPack } = await import("../../../codec-kit/compression/refpack.js");
      bytes = decodeRefPack(await readRange(await offsetOf(storage, signal), storage.compressedLength, signal, storage.source), size);
      break;
    }
    case "custom": {
      const opened = await storage.open(signal);
      if (Symbol.asyncIterator in opened) {
        const chunks = [];
        let total = 0;
        for await (const chunk of opened) {
          throwIfCancelled(signal);
          total += chunk.byteLength;
          if (total > size)
            throw new RangeError(`container entry ${entry.path} decodes past its size`);
          chunks.push(chunk);
        }
        bytes = new Uint8Array(total);
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.byteLength;
        }
      } else {
        bytes = await opened.read(0n, size, signal);
      }
      break;
    }
  }
  if (bytes.byteLength !== size) {
    throw new RangeError(`container entry ${entry.path} decoded to ${bytes.byteLength} bytes, not ${size}`);
  }
  if (entry.checksum?.algorithm === "crc-32") {
    const { crc32: crc322 } = await import("../../../codec-kit/checksum/index.js");
    const actual = (crc322(bytes) >>> 0).toString(16).padStart(8, "0");
    if (actual !== entry.checksum.value.toLowerCase().padStart(8, "0"))
      throw new RangeError(`container entry ${entry.path} fails its CRC-32 (${actual}, the container says ${entry.checksum.value})`);
  }
  return bytes;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/editing.js
function assetRevisionFromInput(input) {
  if (input.originKind !== "single" || input.revisions.topology !== "single") {
    throw new TypeError("assetRevisionFromInput: single-source subjects only");
  }
  const [binding] = input.bindings;
  if (binding === void 0)
    throw new TypeError("assetRevisionFromInput: no binding");
  const revision = binding.revision;
  return Object.freeze({
    bindings: Object.freeze({ [binding.bindingId]: revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: "single",
      bindingId: binding.bindingId,
      source: { id: binding.source.id, uri: binding.source.uri },
      revision
    })
  });
}
function editPlanFromInput(input, { planId, edits, fidelity, guarantee = "atomic", diagnostics = [] }) {
  const revision = assetRevisionFromInput(input);
  const [binding] = input.bindings;
  const target = Object.freeze({
    targetId: binding.bindingId,
    subjectUri: binding.source.uri,
    ownerSource: Object.freeze({ ...binding.source }),
    semanticPath: Object.freeze([]),
    expectedRevision: revision
  });
  return Object.freeze({
    planId,
    targets: Object.freeze([target]),
    edits: Object.freeze(edits.map((edit) => Object.freeze({
      ...edit,
      targetId: edit.targetId ?? binding.bindingId,
      source: edit.source ?? target.ownerSource
    }))),
    semantics: Object.freeze({ mutationMode: "mutate", minimumGuarantee: guarantee }),
    fidelity,
    diagnostics: Object.freeze([...diagnostics])
  });
}

// ../MODDING/modkit-core/packages/codec-kit/dist/audio/pcm-audio.js
function convertToWav(summary = "Writes the decoded sound as a 16-bit PCM WAV file.") {
  return Object.freeze({
    id: "export.convert",
    handlerId: "convert-audio",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    inputSchema: Object.freeze({
      $ref: "modkit://codec-kit/audio-export-convert.v1",
      document: Object.freeze({
        schemaVersion: 1,
        forms: Object.freeze([
          Object.freeze({
            id: "wav",
            label: "WAV",
            summary,
            baseInput: Object.freeze({ target: "wav" }),
            fields: Object.freeze([]),
            writes: Object.freeze({
              format: Object.freeze({ id: "wav", label: "WAV" }),
              extension: ".wav",
              mediaType: "audio/wav"
            })
          })
        ])
      })
    }),
    outputKinds: Object.freeze(["bytes"])
  });
}
var CONVERT_TO_WAV = convertToWav();

// ../MODDING/modkit-core/packages/codec-kit/dist/xml-scan.js
var NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"'
});

// ../MODDING/modkit-core/packages/codec-kit/dist/index.js
var INSPECTION_OPERATIONS = Object.freeze([
  Object.freeze({
    id: "view.inspect",
    handlerId: "inspect",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["json"])
  }),
  Object.freeze({
    id: "asset.validate",
    handlerId: "validate",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "export.raw",
    handlerId: "export-raw",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["bytes"])
  })
]);
function simpleLease(value) {
  let released = false;
  return Object.freeze({
    value,
    async release() {
      released = true;
    },
    isReleased: () => released
  });
}
function createTreeDataSource(rootNode) {
  const nodes = /* @__PURE__ */ new Map();
  nodes.set("root", { node: rootNode });
  const childIdsOf = (id) => {
    const item = nodes.get(id);
    if (item === void 0)
      return [];
    if (item.childIds === void 0) {
      const source = item.node.children;
      const children = typeof source === "function" ? source() : source ?? [];
      item.childIds = children.map((child, index) => {
        const childId = `${id}/${index}`;
        nodes.set(childId, { node: child });
        return childId;
      });
    }
    return item.childIds;
  };
  const ref = (id) => {
    const item = nodes.get(id);
    const source = item?.node.children;
    const hasChildren = item?.childIds !== void 0 ? item.childIds.length > 0 : typeof source === "function" ? item?.node.hasChildren ?? true : (source?.length ?? 0) > 0;
    return Object.freeze({ id, hasChildren });
  };
  return Object.freeze({
    async root() {
      return ref("root");
    },
    async children(node, page, signal) {
      if (signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError("tree page limit must be a positive safe integer");
      }
      const start = pageStart(page.cursor);
      const childIds = childIdsOf(node.id);
      const items = childIds.slice(start, start + page.limit).map(ref);
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < childIds.length ? { nextCursor: String(start + items.length) } : {}
      });
    },
    async facts(node) {
      const value = nodes.get(node.id)?.node;
      if (value === void 0)
        throw new TypeError(`unknown tree node ${node.id}`);
      return Object.freeze({
        kind: value.kind,
        label: value.label,
        ...value.preview === void 0 ? {} : { preview: value.preview },
        ...value.subjectId === void 0 ? {} : { subjectId: value.subjectId },
        ...value.semanticPath === void 0 ? {} : { semanticPath: Object.freeze([...value.semanticPath]) },
        ...value.value === void 0 ? {} : { value: value.value },
        ...value.type === void 0 ? {} : { type: value.type },
        ...value.unit === void 0 ? {} : { unit: value.unit },
        ...value.editable === void 0 ? {} : { editable: value.editable },
        ...value.spans === void 0 ? {} : { spans: value.spans }
      });
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase();
      const pending = ["root"];
      while (pending.length > 0) {
        if (signal?.aborted)
          throw new DOMException("operation cancelled", "AbortError");
        const id = pending.pop();
        const item = nodes.get(id);
        const haystack = `${item.node.label}
${item.node.preview ?? ""}`.toLocaleLowerCase();
        if (haystack.includes(needle))
          yield ref(id);
        pending.push(...childIdsOf(id).toReversed());
      }
    }
  });
}
var TRANSPORT_OPERATIONS = Object.freeze([
  Object.freeze({
    id: "media.play-pause",
    handlerId: "transport-play-pause",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.seek",
    handlerId: "transport-seek",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.set-rate",
    handlerId: "transport-set-rate",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.select-track",
    handlerId: "transport-select-track",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  })
]);
var COMPUTED_MIP_SOURCE_MAX_BYTES = 512 * 1024 * 1024;
function jsonSafe(value) {
  if (typeof value === "bigint")
    return value.toString();
  if (Array.isArray(value))
    return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
function projectionReceiptMetadataGroup(receipt, identity) {
  const portable = toPortableProjectionReceipt(receipt, identity);
  return Object.freeze({
    id: PROJECTION_RECEIPT_METADATA_ID,
    label: "UV projection receipt",
    entries: Object.freeze([Object.freeze({ key: "receipt", value: jsonSafe(portable) })])
  });
}
var CODEC_SOURCE_IDENTITY = Object.freeze({
  kind: "redacted",
  reason: "a codec projects a subject the host already opened; its portable identity is the subject revision this receipt carries, and an ambient URI would leak the producing machine into every copy"
});
function descriptorMetadata(inspection) {
  const groups = inspection.metadata ?? [];
  if (inspection.projectionReceipt === void 0)
    return groups;
  return [
    ...groups,
    projectionReceiptMetadataGroup(inspection.projectionReceipt, CODEC_SOURCE_IDENTITY)
  ];
}
function inspectionOperations(declarations, states = []) {
  const declaredIds = new Set(declarations.map((operation) => operation.id));
  const byId = /* @__PURE__ */ new Map();
  for (const operation of states) {
    const id = operation.id;
    if (!declaredIds.has(operation.id)) {
      throw new TypeError(`operation state references undeclared operation ${operation.id}`);
    }
    if (byId.has(operation.id)) {
      throw new TypeError(`duplicate operation state for ${operation.id}`);
    }
    if (operation.state === "available") {
      if (operation.reason !== void 0) {
        throw new TypeError(`available operation ${id} cannot have a reason`);
      }
    } else if (operation.state !== "disabled" && operation.state !== "dependency-required" || typeof operation.reason !== "string" || operation.reason.length === 0) {
      throw new TypeError(`invalid operation state or reason for ${operation.id}`);
    }
    byId.set(operation.id, operation);
  }
  return Object.freeze(declarations.map((operation) => {
    const override = byId.get(operation.id);
    const identity = {
      id: operation.id,
      handlerId: operation.handlerId,
      mutatesSource: operation.mutatesSource,
      ...operation.inputSchema === void 0 ? {} : { inputSchema: operation.inputSchema }
    };
    return Object.freeze(override === void 0 || override.state === "available" ? { ...identity, state: "available" } : { ...identity, state: override.state, reason: override.reason });
  }));
}
var READ_ALL_CHUNK_BYTES = 4 * 1024 * 1024;
async function readAll(source, budget, signal) {
  if (source.kind !== "bytes" || source.size === void 0) {
    throw new TypeError("inspection codecs require a sized byte source");
  }
  if (source.size > budget.maxInputBytes || source.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("source exceeds the inspection budget");
  }
  const total = Number(source.size);
  const result = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    const chunk = await source.read(BigInt(offset), Math.min(READ_ALL_CHUNK_BYTES, total - offset), signal);
    if (chunk.byteLength === 0)
      throw new RangeError("source ended before its declared size");
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function memoryByteSource(bytes) {
  return Object.freeze({
    size: async () => BigInt(bytes.byteLength),
    async read(offset, length, readSignal) {
      if (readSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      if (offset < 0n || offset > BigInt(bytes.byteLength) || length < 0) {
        throw new RangeError("byte range is outside the source");
      }
      return bytes.slice(Number(offset), Math.min(bytes.byteLength, Number(offset) + length));
    }
  });
}
var RANGE_DETECT_PREFIX_BYTES = 64 * 1024;
var RANGE_READ_CHUNK_BYTES = 8 * 1024 * 1024;
function rangeByteSource(source, budget) {
  if (source.kind !== "bytes" || source.size === void 0) {
    throw new TypeError("range inspection codecs require a sized byte source");
  }
  const size = source.size;
  const maximum = BigInt(budget.maxInputBytes);
  return Object.freeze({
    size: async () => size,
    async read(offset, length, readSignal) {
      if (readSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      if (typeof offset !== "bigint" || offset < 0n || offset > size || !Number.isSafeInteger(length) || length < 0) {
        throw new RangeError("byte range is outside the source");
      }
      if (BigInt(length) > maximum) {
        throw new RangeError("byte range exceeds the inspection budget");
      }
      const end = offset + BigInt(length) < size ? offset + BigInt(length) : size;
      const result = new Uint8Array(Number(end - offset));
      let filled = 0;
      while (filled < result.byteLength) {
        if (readSignal?.aborted)
          throw new DOMException("operation cancelled", "AbortError");
        const wanted = Math.min(RANGE_READ_CHUNK_BYTES, result.byteLength - filled);
        const chunk = await source.read(offset + BigInt(filled), wanted, readSignal);
        if (chunk.byteLength === 0)
          throw new RangeError("source ended before its declared size");
        const taken = Math.min(chunk.byteLength, wanted);
        result.set(chunk.subarray(0, taken), filled);
        filled += taken;
      }
      return result;
    }
  });
}
function originFrom(input, primary, companions = []) {
  const requiredCompanionBindings = new Set(companions.flatMap((companion) => companion.required === true && companion.state === "resolved" ? companion.bindingIds : []));
  const toBinding = (binding) => ({
    id: binding.bindingId,
    role: binding.role,
    source: binding.source,
    required: binding.sourceKind === "candidate" || requiredCompanionBindings.has(binding.bindingId),
    ownership: binding.ownership,
    revision: binding.revision
  });
  if (input.originKind === "single")
    return { kind: "single", binding: toBinding(primary) };
  if (input.originKind === "bundle") {
    return {
      kind: "bundle",
      bindings: input.bindings.map(toBinding),
      primary: input.primaryBindingId
    };
  }
  if (input.originKind === "namespace") {
    return { kind: "namespace", root: input.root, revision: input.revisions.namespaceRevision };
  }
  throw new TypeError("inspection codec requires a physical byte input");
}
function probeLength(plan, size) {
  const first = plan.ranges.find((range) => range.from === "start") ?? plan.ranges[0];
  const declared = Math.min(plan.maxBytes, first?.length ?? plan.maxBytes);
  const available = size === void 0 ? declared : Number(size);
  return Math.max(0, Math.min(declared, available));
}
function createInspectionCodec(definition2, contributionContext) {
  if (definition2.deferInspection === true) {
    const codec = createInspectionCodec({ ...definition2, deferInspection: false }, contributionContext);
    return Object.freeze({
      ...codec,
      async open(input, intent, budget, signal) {
        signal?.throwIfAborted();
        const ownedBudget = Object.freeze({ ...budget });
        return deferAssetSession(revisionId(input.revisions.revision), (initializeSignal) => codec.open(input, intent, ownedBudget, initializeSignal), ownedBudget, signal);
      }
    });
  }
  const namespaceDefinition = definition2.namespace;
  const rangeDefinition = definition2.access === "ranges" ? definition2 : void 0;
  let endWindow;
  const customOperations = Object.freeze([...definition2.operations ?? []]);
  const sharedOperations = namespaceDefinition === void 0 && rangeDefinition === void 0 ? INSPECTION_OPERATIONS : INSPECTION_OPERATIONS.filter((operation) => operation.handlerId !== "export-raw");
  const customIds = /* @__PURE__ */ new Set();
  for (const operation of customOperations) {
    if (customIds.has(operation.id))
      throw new TypeError(`Duplicate custom operation: ${operation.id}`);
    customIds.add(operation.id);
  }
  const operationDeclarations = Object.freeze([
    ...sharedOperations.filter((operation) => !customIds.has(operation.id)),
    ...customOperations
  ]);
  const handlerIds = /* @__PURE__ */ new Set();
  for (const operation of operationDeclarations) {
    if (handlerIds.has(operation.handlerId))
      throw new TypeError(`Duplicate operation handler: ${operation.handlerId}`);
    handlerIds.add(operation.handlerId);
  }
  return Object.freeze({
    async probe(request, signal) {
      if (namespaceDefinition !== void 0) {
        if (request.source.kind !== "namespace" || request.plan.kind !== "namespace") {
          throw new TypeError(`${definition2.id} requires a namespace probe`);
        }
        const namespaceLease = await request.source.openNamespace(signal);
        try {
          const markers = [];
          for (const path of request.plan.markers) {
            let entryLease;
            try {
              entryLease = await namespaceLease.value.open(path, signal);
            } catch (error) {
              const code = error?.code;
              if (code === "x3.host/namespace-entry-not-found")
                continue;
              throw error;
            }
            try {
              markers.push(Object.freeze({
                path,
                kind: entryLease.value.kind === "namespace" ? "directory" : "file",
                ...entryLease.value.kind === "bytes" && entryLease.value.size !== void 0 ? { size: entryLease.value.size } : {}
              }));
            } finally {
              await entryLease.release();
            }
          }
          const detected2 = await namespaceDefinition.detect(Object.freeze(markers), request.source.ref.uri);
          return Object.freeze({
            codecId: definition2.id,
            confidence: detected2.confidence,
            evidence: Object.freeze([
              Object.freeze({
                kind: detected2.kind ?? "structure",
                weight: detected2.confidence,
                note: detected2.note
              })
            ]),
            requiredRanges: Object.freeze([])
          });
        } finally {
          await namespaceLease.release();
        }
      }
      if (request.source.kind !== "bytes" || request.plan.kind !== "bytes") {
        throw new TypeError(`${definition2.id} requires a byte probe`);
      }
      const bytes = await request.source.read(0n, probeLength(request.plan, request.source.size), signal);
      const tail = request.plan.ranges.find((range) => range.from === "end");
      const size = request.source.size;
      const tailLength = tail === void 0 || size === void 0 ? 0 : (
        // the host counts every probe byte against maxBytes: the tail gets what the prefix left
        Math.max(0, Math.min(tail.length, request.plan.maxBytes - bytes.byteLength, Number(size)))
      );
      if (tail !== void 0)
        endWindow = Math.max(0, Math.min(tail.length, request.plan.maxBytes - probeLength(request.plan)));
      const suffix = tail === void 0 || size === void 0 ? void 0 : tailLength === 0 ? new Uint8Array() : await request.source.read(size - BigInt(tailLength), tailLength, signal);
      const detected = await definition2.detect(bytes, request.source.ref.uri, suffix);
      return Object.freeze({
        codecId: definition2.id,
        confidence: detected.confidence,
        evidence: Object.freeze([
          Object.freeze({
            kind: detected.kind ?? "magic",
            weight: detected.confidence,
            note: detected.note
          })
        ]),
        requiredRanges: Object.freeze([
          Object.freeze({ byteOffset: "0", byteLength: String(bytes.byteLength) }),
          ...suffix === void 0 || size === void 0 || suffix.byteLength === 0 ? [] : [
            Object.freeze({
              byteOffset: String(size - BigInt(suffix.byteLength)),
              byteLength: String(suffix.byteLength)
            })
          ]
        ])
      });
    },
    async planInput(source, evidence, signal) {
      if (definition2.planInput !== void 0) {
        return definition2.planInput(source, evidence, signal, contributionContext);
      }
      if (namespaceDefinition !== void 0) {
        if (source.kind !== "namespace") {
          throw new TypeError(`${definition2.id} requires a namespace input`);
        }
        return Object.freeze({ originKind: "namespace", requirements: Object.freeze([]) });
      }
      return Object.freeze({
        originKind: "single",
        candidate: Object.freeze({ bindingId: "content", role: "content", ownership: "owned" }),
        requirements: Object.freeze([])
      });
    },
    async open(input, intent, budget, signal) {
      if (namespaceDefinition !== void 0) {
        if (input.originKind !== "namespace") {
          throw new TypeError(`${definition2.id} requires a namespace input`);
        }
        const namespaceLease = await input.openNamespace(signal);
        try {
          const inspection = await namespaceDefinition.inspect(namespaceLease.value, {
            ...contributionContext === void 0 ? {} : {
              contracts: contributionContext.contracts,
              ...contributionContext.modelResources === void 0 ? {} : { modelResources: contributionContext.modelResources },
              ...contributionContext.rasterResources === void 0 ? {} : { rasterResources: contributionContext.rasterResources },
              ...contributionContext.videoFrames === void 0 ? {} : { videoFrames: contributionContext.videoFrames },
              ...contributionContext.credentials === void 0 ? {} : { credentials: contributionContext.credentials },
              ...contributionContext.containerContext === void 0 ? {} : { containerContext: contributionContext.containerContext },
              ...contributionContext.logicalResources === void 0 ? {} : { logicalResources: contributionContext.logicalResources }
            },
            budget,
            signal,
            intent,
            settings: contributionSettingsFor(contributionContext?.settings, input.root.uri),
            namespace: namespaceLease.value,
            input
          });
          const dataSources = new Map(Object.entries(inspection.dataSources ?? {}));
          const descriptor = await assembleSubjectDescriptor({
            schemaVersion: 2,
            subjectUri: input.root.uri,
            origin: originFrom(input),
            interpretation: "codec",
            identity: {
              codecId: definition2.id,
              codecVersion: definition2.version ?? "1.0.0",
              formatId: definition2.format.id,
              formatLabel: definition2.format.label,
              ...definition2.format.mediaType === void 0 ? {} : { mediaType: definition2.format.mediaType },
              confidence: inspection.detection.confidence,
              detection: [
                {
                  kind: inspection.detection.kind ?? "structure",
                  weight: inspection.detection.confidence,
                  ...inspection.detection.note === void 0 ? {} : { note: inspection.detection.note }
                }
              ]
            },
            traits: inspection.traits.map((trait) => ({
              id: trait.id,
              descriptorVersion: 1,
              state: "available",
              ...trait.parameters === void 0 ? {} : { parameters: trait.parameters }
            })),
            operations: inspectionOperations(operationDeclarations, inspection.operationStates),
            constraints: {
              readOnly: !operationDeclarations.some((operation) => operation.mutatesSource === true),
              seekable: false,
              randomAccess: false,
              trusted: false,
              ...inspection.maxDecodedBytes === void 0 ? {} : { maxDecodedBytes: String(inspection.maxDecodedBytes) },
              ...inspection.unsupportedFeatures === void 0 ? {} : { unsupportedFeatures: inspection.unsupportedFeatures }
            },
            dataSources: [...dataSources.keys()].map((contract) => ({ contract, major: 1 })),
            diagnostics: inspection.diagnostics ?? [],
            metadata: descriptorMetadata(inspection),
            revision: input.revisions.revision
          });
          const handlers = new Map([
            ["inspect", async () => ({ kind: "json", value: inspection.summary })],
            ["validate", async () => ({ kind: "none" })],
            ...Object.entries(inspection.handlers ?? {})
          ]);
          return createAssetSession({
            maxOperationDiagnostics: budget.maxDiagnostics,
            revision: revisionId(input.revisions.revision),
            descriptor,
            operationDeclarations,
            permissionGrant: {
              id: `${definition2.format.id}-inspection-session`,
              classes: declaredPermissionClasses(operationDeclarations)
            },
            handlers,
            async openDataSource(contract) {
              const value = dataSources.get(contract);
              if (value === void 0)
                throw new TypeError(`${definition2.id} does not publish ${contract}`);
              return simpleLease(value);
            },
            release: [
              () => namespaceLease.release(),
              // released first: the host releases in reverse order
              ...inspection.release === void 0 ? [] : [inspection.release]
            ]
          }).session;
        } catch (error) {
          await namespaceLease.release();
          throw error;
        }
      }
      if (input.originKind !== "single" && input.originKind !== "bundle") {
        throw new TypeError(`${definition2.id} requires a single or bundle byte input`);
      }
      const primaryId = input.primaryBindingId;
      const primary = input.bindings.find((binding) => binding.bindingId === primaryId);
      if (primary === void 0)
        throw new TypeError("primary binding is missing");
      const sourceLease = await input.openBinding(primary.bindingId, signal);
      const source = sourceLease.value;
      try {
        const bytes = rangeDefinition === void 0 ? await readAll(source, budget, signal) : void 0;
        const byteSource = bytes === void 0 ? rangeByteSource(source, budget) : memoryByteSource(bytes);
        const sourceSize = await byteSource.size();
        const readable = BigInt(budget.maxInputBytes) < sourceSize ? BigInt(budget.maxInputBytes) : sourceSize;
        const prefix = bytes ?? await byteSource.read(0n, Math.min(rangeDefinition?.detectBytes ?? RANGE_DETECT_PREFIX_BYTES, Number(readable)), signal);
        const suffixLength = endWindow === void 0 ? 0 : Math.min(endWindow, Number(sourceSize), Number(readable));
        const suffix = endWindow === void 0 ? void 0 : bytes !== void 0 ? bytes.subarray(bytes.byteLength - suffixLength) : suffixLength === 0 ? new Uint8Array() : await byteSource.read(sourceSize - BigInt(suffixLength), suffixLength, signal);
        const detected = await definition2.detect(prefix, primary.source.uri, suffix);
        const inspectionContext = {
          ...contributionContext === void 0 ? {} : {
            contracts: contributionContext.contracts,
            ...contributionContext.modelResources === void 0 ? {} : { modelResources: contributionContext.modelResources },
            ...contributionContext.rasterResources === void 0 ? {} : { rasterResources: contributionContext.rasterResources },
            ...contributionContext.videoFrames === void 0 ? {} : { videoFrames: contributionContext.videoFrames },
            ...contributionContext.credentials === void 0 ? {} : { credentials: contributionContext.credentials },
            ...contributionContext.containerContext === void 0 ? {} : { containerContext: contributionContext.containerContext },
            ...contributionContext.logicalResources === void 0 ? {} : { logicalResources: contributionContext.logicalResources }
          },
          budget,
          signal,
          intent,
          settings: contributionSettingsFor(contributionContext?.settings, primary.source.uri),
          source,
          primary,
          byteSource,
          input
        };
        const inspection = rangeDefinition !== void 0 ? await rangeDefinition.inspect(inspectionContext) : await definition2.inspect(bytes, inspectionContext);
        const entryAccess = inspection.containerEntries === void 0 ? void 0 : containerEntryAccess(inspection.containerEntries, {
          scheme: definition2.format.id,
          source,
          byteSource,
          budget,
          // A companion the input carries (`.rfd` beside `.rfh`), read by range under the same budget.
          async companionSource(bindingId, companionSignal) {
            const lease = await input.openBinding(bindingId, companionSignal);
            try {
              return {
                source: rangeByteSource(lease.value, budget),
                release: () => lease.release()
              };
            } catch (error) {
              await lease.release();
              throw error;
            }
          }
        });
        const dataSources = new Map([
          ["common.view/byte-range-source", byteSource],
          ...entryAccess === void 0 ? [] : [["common.view/namespace-entry-source", entryAccess.namespace]],
          ...Object.entries(inspection.dataSources ?? {})
        ]);
        if (inspection.text === true) {
          dataSources.set("common.view/text-data-source", createUtf8TextDataSource(byteSource));
        } else if (typeof inspection.text === "string") {
          const textBytes = new TextEncoder().encode(inspection.text);
          const textByteSource = Object.freeze({
            async size() {
              return BigInt(textBytes.byteLength);
            },
            async read(offset, length, readSignal) {
              if (readSignal?.aborted)
                throw new DOMException("operation cancelled", "AbortError");
              if (offset < 0n || offset > BigInt(textBytes.byteLength) || length < 0)
                throw new RangeError("text byte range is outside the source");
              return textBytes.slice(Number(offset), Math.min(textBytes.byteLength, Number(offset) + length));
            }
          });
          dataSources.set("common.view/text-data-source", createUtf8TextDataSource(textByteSource));
        }
        const descriptor = await assembleSubjectDescriptor({
          schemaVersion: 2,
          subjectUri: primary.source.uri,
          origin: originFrom(input, primary, inspection.companions),
          interpretation: "codec",
          identity: {
            codecId: definition2.id,
            codecVersion: definition2.version ?? "1.0.0",
            formatId: definition2.format.id,
            formatLabel: definition2.format.label,
            ...definition2.format.mediaType === void 0 ? {} : { mediaType: definition2.format.mediaType },
            confidence: detected.confidence,
            detection: [
              {
                kind: detected.kind ?? "magic",
                weight: detected.confidence,
                ...detected.note === void 0 ? {} : { note: detected.note }
              }
            ]
          },
          traits: inspection.traits.map((trait) => ({
            id: trait.id,
            descriptorVersion: 1,
            state: "available",
            ...trait.parameters === void 0 ? {} : { parameters: trait.parameters }
          })),
          operations: inspectionOperations(operationDeclarations, inspection.operationStates),
          constraints: {
            // a codec with a mutating operation is not read-only (ADR-HOST-002 Path A)
            readOnly: !operationDeclarations.some((operation) => operation.mutatesSource === true),
            seekable: true,
            randomAccess: true,
            trusted: false,
            maxDecodedBytes: String(inspection.maxDecodedBytes ?? entryAccess?.decodedTotal ?? sourceSize),
            ...inspection.unsupportedFeatures === void 0 ? {} : { unsupportedFeatures: inspection.unsupportedFeatures }
          },
          dataSources: [...dataSources.keys()].map((contract) => ({ contract, major: 1 })),
          diagnostics: inspection.diagnostics ?? [],
          metadata: descriptorMetadata(inspection),
          ...inspection.companions === void 0 ? {} : { companions: inspection.companions },
          revision: input.revisions.revision
        });
        const handlers = new Map([
          ["inspect", async () => ({ kind: "json", value: inspection.summary })],
          ["validate", async () => ({ kind: "none" })],
          ...bytes === void 0 ? [] : [
            ["export-raw", async () => ({ kind: "bytes", value: bytes })]
          ],
          ...entryAccess === void 0 ? [] : [
            [
              CONTAINER_EXTRACT_HANDLER_ID,
              entryAccess.extract
            ]
          ],
          ...Object.entries(inspection.handlers ?? {})
        ]);
        return createAssetSession({
          maxOperationDiagnostics: budget.maxDiagnostics,
          revision: revisionId(input.revisions.revision),
          descriptor,
          operationDeclarations,
          permissionGrant: {
            id: `${definition2.format.id}-inspection-session`,
            classes: declaredPermissionClasses(operationDeclarations)
          },
          handlers,
          async openDataSource(contract) {
            const value = dataSources.get(contract);
            if (value === void 0)
              throw new TypeError(`${definition2.id} does not publish ${contract}`);
            return simpleLease(value);
          },
          release: [
            () => sourceLease.release(),
            // released first: the host releases in reverse order
            ...inspection.release === void 0 ? [] : [inspection.release]
          ]
        }).session;
      } catch (error) {
        await sourceLease.release();
        throw error;
      }
    }
  });
}
function declaredPermissionClasses(operations) {
  const classes = /* @__PURE__ */ new Set(["read-source"]);
  for (const operation of operations) {
    for (const item of operation.requiredPermissions ?? [])
      classes.add(item);
    if (operation.mutatesSource === true)
      classes.add("write-source");
  }
  return Object.freeze([...classes].sort());
}

// extensions/archives/src/zip/codec.js
var ZIP_LOCAL = 67324752;
var ZIP_CENTRAL = 33639248;
var ZIP_EOCD = 101010256;
var ZIP_DESCRIPTOR = 134695760;
var ZIP64_LOCATOR = 117853008;
var ZIP64_EOCD = 101075792;
var FLAG_ENCRYPTED = 1;
var FLAG_COMPRESSION_OPTIONS = 6;
var FLAG_DESCRIPTOR = 8;
var FLAG_STRONG_ENCRYPTION = 64;
var FLAG_UTF8_NAMES = 2048;
var EXTRA_ZIP64 = 1;
var EXTRA_UNICODE_PATH = 28789;
var MAX_U16 = 65535;
var MAX_U32 = 4294967295;
var DOS_EPOCH_DATE = 33;
var STORED = 0;
var VERSION_STORED = 10;
var VERSION_MADE_BY = 20;
var EMPTY = new Uint8Array(0);
var utf8 = new TextDecoder("utf-8", { fatal: true });
var legacy = new TextDecoder("latin1");
var encoder = new TextEncoder();
function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError("truncated ZIP u16");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}
function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError("truncated ZIP u32");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}
function compressionName(method) {
  if (method === 0) return "stored";
  if (method === 8) return "deflate";
  if (method === 9) return "deflate64";
  if (method === 12) return "bzip2";
  if (method === 14) return "lzma";
  if (method === 93) return "zstd";
  if (method === 95) return "xz";
  return `method ${method}`;
}
function dosTimestamp(dosDate, dosTime) {
  if (dosDate === 0) return void 0;
  const year = 1980 + (dosDate >> 9 & 127);
  const month = dosDate >> 5 & 15;
  const day = dosDate & 31;
  const hour = dosTime >> 11 & 31;
  const minute = dosTime >> 5 & 63;
  const second = (dosTime & 31) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) return void 0;
  if (hour > 23 || minute > 59 || second > 59) return void 0;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}
function findEocd(bytes) {
  const first = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
    if (u32(bytes, offset) === ZIP_EOCD) return offset;
  }
  return -1;
}
function u64(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.byteLength) throw new RangeError("truncated ZIP u64");
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("ZIP64 value is too large");
  return Number(value);
}
function eocdOf(tail, tailStart) {
  const eocd = findEocd(tail);
  if (eocd < 0) throw new TypeError("ZIP end-of-central-directory record is missing");
  if (u16(tail, eocd + 4) !== 0 || u16(tail, eocd + 6) !== 0) {
    throw new TypeError("multi-disk ZIP archives are unsupported");
  }
  const count = u16(tail, eocd + 10);
  const centralSize = u32(tail, eocd + 12);
  const centralOffset = u32(tail, eocd + 16);
  const saturated = count === MAX_U16 || centralSize === MAX_U32 || centralOffset === MAX_U32;
  const locator = eocd >= 20 && u32(tail, eocd - 20) === ZIP64_LOCATOR;
  if (saturated && !locator)
    throw new TypeError("ZIP64 end-of-central-directory locator is missing");
  return Object.freeze({
    eocd: tailStart + eocd,
    count,
    centralSize,
    centralOffset,
    ...locator ? { zip64RecordOffset: u64(tail, eocd - 20 + 8) } : {}
  });
}
function zip64DirectoryOf(record) {
  if (u32(record, 0) !== ZIP64_EOCD)
    throw new TypeError("ZIP64 end-of-central-directory record is invalid");
  if (u32(record, 16) !== 0 || u32(record, 20) !== 0) {
    throw new TypeError("multi-disk ZIP archives are unsupported");
  }
  return { count: u64(record, 32), centralSize: u64(record, 40), centralOffset: u64(record, 48) };
}
function withZip64Extra(extra, fields) {
  for (let at = 0; at + 4 <= extra.byteLength; ) {
    const id = u16(extra, at);
    const length = u16(extra, at + 2);
    if (id === EXTRA_ZIP64) {
      const field = extra.subarray(at + 4, at + 4 + length);
      let read = 0;
      const next = () => {
        const value = u64(field, read);
        read += 8;
        return value;
      };
      return {
        size: fields.size === MAX_U32 ? next() : fields.size,
        compressedSize: fields.compressedSize === MAX_U32 ? next() : fields.compressedSize,
        localOffset: fields.localOffset === MAX_U32 ? next() : fields.localOffset
      };
    }
    at += 4 + length;
  }
  if (fields.size === MAX_U32 || fields.compressedSize === MAX_U32 || fields.localOffset === MAX_U32)
    throw new TypeError("ZIP entry saturates a size or offset without a ZIP64 field");
  return fields;
}
function parseCentralDirectory(central, centralOffset, count, maxEntries) {
  if (count > maxEntries) throw new RangeError("ZIP entry count exceeds maxNodes budget");
  const entries = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > central.byteLength || u32(central, offset) !== ZIP_CENTRAL) {
      throw new TypeError(`invalid ZIP central-directory entry ${index}`);
    }
    const flags = u16(central, offset + 8);
    const method = u16(central, offset + 10);
    const dosTime = u16(central, offset + 12);
    const dosDate = u16(central, offset + 14);
    const crc = u32(central, offset + 16);
    const nameLength = u16(central, offset + 28);
    const extraLength = u16(central, offset + 30);
    const commentLength = u16(central, offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > central.byteLength) throw new TypeError("ZIP central-directory name is truncated");
    const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength);
    const name = safePath(
      (flags & FLAG_UTF8_NAMES) !== 0 ? utf8.decode(nameBytes) : legacy.decode(nameBytes)
    );
    if (name === "") throw new TypeError("ZIP entries must have non-empty paths");
    const { size, compressedSize, localOffset } = withZip64Extra(
      central.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength),
      {
        compressedSize: u32(central, offset + 20),
        size: u32(central, offset + 24),
        localOffset: u32(central, offset + 42)
      }
    );
    entries.push(
      Object.freeze({
        id: `entry-${index}`,
        name,
        kind: name.endsWith("/") ? "directory" : "file",
        flags,
        method,
        dosTime,
        dosDate,
        crc,
        compressedSize,
        size,
        localOffset,
        centralOffset: centralOffset + offset,
        centralLength: next - offset
      })
    );
    offset = next;
  }
  if (offset !== central.byteLength) {
    throw new TypeError("ZIP central-directory size does not match its entries");
  }
  return Object.freeze(entries);
}
function safePath(value) {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (value.includes("\0") || normalized.startsWith("/") || /^[a-z]:/iu.test(normalized) || parts.some((part) => part === "." || part === "..")) {
    throw new TypeError(`unsafe ZIP entry path: ${value}`);
  }
  return `${parts.join("/")}${normalized.endsWith("/") && parts.length > 0 ? "/" : ""}`;
}
function parseZipArchive(bytes, maxEntries) {
  const tail = eocdOf(bytes, 0);
  const directory = tail.zip64RecordOffset === void 0 ? tail : zip64DirectoryOf(bytes.subarray(tail.zip64RecordOffset, tail.zip64RecordOffset + 56));
  if (directory.centralOffset + directory.centralSize > bytes.byteLength) {
    throw new TypeError("ZIP central directory is truncated");
  }
  return parseCentralDirectory(
    bytes.subarray(directory.centralOffset, directory.centralOffset + directory.centralSize),
    directory.centralOffset,
    directory.count,
    maxEntries
  );
}
async function readZipDirectory(read, size, maxEntries, maxRead) {
  const tailStart = Math.max(0, size - Math.min(65557, maxRead));
  const tailBytes = await read(tailStart, size - tailStart);
  const tail = eocdOf(tailBytes, tailStart);
  const directory = tail.zip64RecordOffset === void 0 ? tail : zip64DirectoryOf(await read(tail.zip64RecordOffset, 56));
  if (directory.count > maxEntries) throw new RangeError("ZIP entry count exceeds maxNodes budget");
  if (directory.centralSize > maxRead)
    throw new RangeError(
      `ZIP central directory (${directory.centralSize} bytes) exceeds the read budget of ${maxRead}`
    );
  if (directory.centralOffset + directory.centralSize > size) {
    throw new TypeError("ZIP central directory is truncated");
  }
  const central = directory.centralOffset >= tailStart ? tailBytes.subarray(
    directory.centralOffset - tailStart,
    directory.centralOffset - tailStart + directory.centralSize
  ) : await read(directory.centralOffset, directory.centralSize);
  return parseCentralDirectory(central, directory.centralOffset, directory.count, maxEntries);
}
function localDataLocator(entry, read, size) {
  let located;
  return () => located ??= (async () => {
    if (entry.localOffset + 30 > size)
      throw new TypeError(`the local header of \xAB${entry.name}\xBB is truncated`);
    const header = await read(entry.localOffset, 30);
    if (u32(header, 0) !== ZIP_LOCAL)
      throw new TypeError(`the local header of \xAB${entry.name}\xBB is invalid`);
    const dataOffset = entry.localOffset + 30 + u16(header, 26) + u16(header, 28);
    if (dataOffset + entry.compressedSize > size)
      throw new TypeError(`the data of \xAB${entry.name}\xBB is truncated`);
    return BigInt(dataOffset);
  })();
}
async function readZipByRanges(byteSource, budget, signal) {
  const size = Number(await byteSource.size());
  const maxRead = Number(budget.maxInputBytes);
  const read = async (offset, length) => {
    const bytes = await byteSource.read(BigInt(offset), length, signal);
    if (bytes.byteLength !== length) throw new TypeError("ZIP archive is truncated");
    return bytes;
  };
  const entries = await readZipDirectory(read, size, budget.maxNodes, maxRead);
  return { entries, containerEntries: await zipEntryTable(entries, read, size) };
}
async function zipEntryTable(entries, read, size) {
  const files = entries.filter((entry) => entry.kind === "file");
  const byPath = /* @__PURE__ */ new Map();
  for (const entry of files) {
    const offset = BigInt(entry.localOffset);
    const locate = localDataLocator(entry, read, size);
    const compressedLength = BigInt(entry.compressedSize);
    const unreadable = (entry.flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0 ? "encrypted ZIP entries are unsupported" : ![STORED, 8, 93].includes(entry.method) ? `unsupported ZIP compression method ${entry.method}` : void 0;
    const modifiedAt = dosTimestamp(entry.dosDate, entry.dosTime);
    byPath.set(entry.name, {
      path: entry.name,
      size: BigInt(entry.size),
      storage: unreadable !== void 0 ? {
        kind: "custom",
        compression: compressionName(entry.method),
        async open() {
          throw new TypeError(unreadable);
        }
      } : entry.method === STORED ? { kind: "stored", offset, locate, length: compressedLength } : { kind: entry.method === 8 ? "deflate" : "zstd", offset, locate, compressedLength },
      ...modifiedAt === void 0 ? {} : { modifiedAt },
      // the container's own CRC-32, not a digest this codec computed
      checksum: { algorithm: "crc-32", value: entry.crc.toString(16).padStart(8, "0") },
      ...hiddenZipPath(entry.name) ? { hidden: true } : {}
    });
  }
  return {
    entries: [...byPath.values()],
    directories: entries.filter((entry) => entry.kind === "directory").map((entry) => ({
      path: entry.name.slice(0, -1),
      ...hiddenZipPath(entry.name) ? { hidden: true } : {}
    })),
    caseSensitivity: "sensitive",
    complete: true
  };
}
async function extractZipArchiveEntry(bytes, entry) {
  if (entry.kind !== "file") throw new TypeError("directories have no byte payload");
  if ((entry.flags & FLAG_ENCRYPTED) !== 0)
    throw new TypeError("encrypted ZIP entries are unsupported");
  const offset = entry.localOffset;
  if (offset + 30 > bytes.byteLength || u32(bytes, offset) !== ZIP_LOCAL) {
    throw new TypeError("ZIP local entry header is invalid");
  }
  const dataOffset = offset + 30 + u16(bytes, offset + 26) + u16(bytes, offset + 28);
  const end = dataOffset + entry.compressedSize;
  if (end > bytes.byteLength) throw new TypeError("ZIP entry data is truncated");
  const compressed = bytes.slice(dataOffset, end);
  const result = entry.method === 0 ? compressed : entry.method === 8 ? await decompressBounded(compressed, "deflate-raw", { maxOutputBytes: entry.size }) : (() => {
    throw new TypeError(`unsupported ZIP compression method ${entry.method}`);
  })();
  if (result.byteLength !== entry.size)
    throw new TypeError("ZIP entry size does not match metadata");
  return result;
}
function localBlockRange(bytes, entry) {
  const start = entry.localOffset;
  if (start + 30 > bytes.byteLength || u32(bytes, start) !== ZIP_LOCAL) {
    throw new TypeError(`the local header of \xAB${entry.name}\xBB is invalid`);
  }
  const nameLength = u16(bytes, start + 26);
  const extraLength = u16(bytes, start + 28);
  const dataOffset = start + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > bytes.byteLength) throw new TypeError(`the data of \xAB${entry.name}\xBB is truncated`);
  return Object.freeze({
    start,
    nameLength,
    extraLength,
    dataOffset,
    dataEnd,
    end: dataEnd + descriptorLength(bytes, entry, dataEnd)
  });
}
function descriptorLength(bytes, entry, dataEnd) {
  if ((entry.flags & FLAG_DESCRIPTOR) === 0) return 0;
  const signed = dataEnd + 4 <= bytes.byteLength && u32(bytes, dataEnd) === ZIP_DESCRIPTOR;
  const at = signed ? dataEnd + 4 : dataEnd;
  if (at + 12 > bytes.byteLength)
    throw new TypeError(`the data descriptor of \xAB${entry.name}\xBB is truncated`);
  if (u32(bytes, at) !== entry.crc || u32(bytes, at + 4) !== entry.compressedSize || u32(bytes, at + 8) !== entry.size) {
    throw new TypeError(
      `the data descriptor of \xAB${entry.name}\xBB disagrees with the central directory`
    );
  }
  return (signed ? 4 : 0) + 12;
}
function centralFieldsOf(bytes, entry) {
  const at = entry.centralOffset;
  const nameAt = at + 46;
  const extraAt = nameAt + u16(bytes, at + 28);
  const commentAt = extraAt + u16(bytes, at + 30);
  return Object.freeze({
    versionMadeBy: u16(bytes, at + 4),
    versionNeeded: u16(bytes, at + 6),
    flags: u16(bytes, at + 8),
    method: u16(bytes, at + 10),
    dosTime: u16(bytes, at + 12),
    dosDate: u16(bytes, at + 14),
    crc: u32(bytes, at + 16),
    compressedSize: u32(bytes, at + 20),
    size: u32(bytes, at + 24),
    diskStart: u16(bytes, at + 34),
    internalAttributes: u16(bytes, at + 36),
    externalAttributes: u32(bytes, at + 38),
    nameBytes: bytes.subarray(nameAt, extraAt),
    extraBytes: bytes.subarray(extraAt, commentAt),
    commentBytes: bytes.subarray(commentAt, at + entry.centralLength)
  });
}
function extraFieldIds(extra) {
  const ids = [];
  let cursor = 0;
  while (cursor + 4 <= extra.byteLength) {
    ids.push(u16(extra, cursor));
    cursor += 4 + u16(extra, cursor + 2);
  }
  if (cursor !== extra.byteLength) throw new TypeError("a ZIP extra field is malformed");
  return ids;
}
function localHeaderFor(fields) {
  const header = new Uint8Array(30 + fields.nameBytes.byteLength + fields.extraBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, ZIP_LOCAL, true);
  view.setUint16(4, fields.versionNeeded, true);
  view.setUint16(6, fields.flags, true);
  view.setUint16(8, fields.method, true);
  view.setUint16(10, fields.dosTime, true);
  view.setUint16(12, fields.dosDate, true);
  view.setUint32(14, fields.crc, true);
  view.setUint32(18, fields.compressedSize, true);
  view.setUint32(22, fields.size, true);
  view.setUint16(26, fields.nameBytes.byteLength, true);
  view.setUint16(28, fields.extraBytes.byteLength, true);
  header.set(fields.nameBytes, 30);
  header.set(fields.extraBytes, 30 + fields.nameBytes.byteLength);
  return header;
}
function centralRecordFor(fields) {
  const nameLength = fields.nameBytes.byteLength;
  const extraLength = fields.extraBytes.byteLength;
  const commentLength = fields.commentBytes.byteLength;
  const record = new Uint8Array(46 + nameLength + extraLength + commentLength);
  const view = new DataView(record.buffer);
  view.setUint32(0, ZIP_CENTRAL, true);
  view.setUint16(4, fields.versionMadeBy, true);
  view.setUint16(6, fields.versionNeeded, true);
  view.setUint16(8, fields.flags, true);
  view.setUint16(10, fields.method, true);
  view.setUint16(12, fields.dosTime, true);
  view.setUint16(14, fields.dosDate, true);
  view.setUint32(16, fields.crc, true);
  view.setUint32(20, fields.compressedSize, true);
  view.setUint32(24, fields.size, true);
  view.setUint16(28, nameLength, true);
  view.setUint16(30, extraLength, true);
  view.setUint16(32, commentLength, true);
  view.setUint16(34, fields.diskStart, true);
  view.setUint16(36, fields.internalAttributes, true);
  view.setUint32(38, fields.externalAttributes, true);
  record.set(fields.nameBytes, 46);
  record.set(fields.extraBytes, 46 + nameLength);
  record.set(fields.commentBytes, 46 + nameLength + extraLength);
  return record;
}
function encodedName(name) {
  const nameBytes = encoder.encode(name);
  if (nameBytes.byteLength === 0) throw new TypeError("a ZIP entry path cannot be empty");
  if (nameBytes.byteLength > MAX_U16)
    throw new RangeError(`the ZIP entry path \xAB${name}\xBB is too long`);
  return nameBytes;
}
var needsUtf8Flag = (nameBytes) => nameBytes.some((byte) => byte >= 128);
function verbatimEntry(bytes, entry, range) {
  return Object.freeze({
    name: entry.name,
    local: Object.freeze([bytes.subarray(range.start, range.end)]),
    central: bytes.slice(entry.centralOffset, entry.centralOffset + entry.centralLength)
  });
}
function renamedEntry(bytes, entry, range, newName) {
  const nameBytes = encodedName(newName);
  const fields = centralFieldsOf(bytes, entry);
  const localExtra = bytes.subarray(range.start + 30 + range.nameLength, range.dataOffset);
  if (extraFieldIds(fields.extraBytes).includes(EXTRA_UNICODE_PATH) || extraFieldIds(localExtra).includes(EXTRA_UNICODE_PATH)) {
    throw new TypeError(
      `\xAB${entry.name}\xBB carries an Info-ZIP Unicode Path extra field; renaming it would leave stale metadata behind`
    );
  }
  const utf8Needed = needsUtf8Flag(nameBytes);
  if (utf8Needed && (entry.flags & FLAG_UTF8_NAMES) === 0 && fields.commentBytes.byteLength > 0) {
    throw new TypeError(
      `renaming \xAB${entry.name}\xBB to a non-ASCII path would reinterpret its entry comment as UTF-8`
    );
  }
  const flags = utf8Needed ? entry.flags | FLAG_UTF8_NAMES : entry.flags;
  const header = localHeaderFor({
    versionNeeded: u16(bytes, range.start + 4),
    flags,
    method: u16(bytes, range.start + 8),
    dosTime: u16(bytes, range.start + 10),
    dosDate: u16(bytes, range.start + 12),
    crc: u32(bytes, range.start + 14),
    compressedSize: u32(bytes, range.start + 18),
    size: u32(bytes, range.start + 22),
    nameBytes,
    extraBytes: localExtra
  });
  return Object.freeze({
    name: newName,
    local: Object.freeze([header, bytes.subarray(range.dataOffset, range.end)]),
    central: centralRecordFor({ ...fields, flags, nameBytes })
  });
}
function restoredEntry(bytes, entry, range, data) {
  const fields = centralFieldsOf(bytes, entry);
  const flags = entry.flags & ~(FLAG_DESCRIPTOR | FLAG_COMPRESSION_OPTIONS);
  const crc = crc32(data);
  const header = localHeaderFor({
    versionNeeded: u16(bytes, range.start + 4),
    flags,
    method: STORED,
    dosTime: u16(bytes, range.start + 10),
    dosDate: u16(bytes, range.start + 12),
    crc,
    compressedSize: data.byteLength,
    size: data.byteLength,
    nameBytes: bytes.subarray(range.start + 30, range.start + 30 + range.nameLength),
    extraBytes: bytes.subarray(range.start + 30 + range.nameLength, range.dataOffset)
  });
  return Object.freeze({
    name: entry.name,
    local: Object.freeze([header, data]),
    central: centralRecordFor({
      ...fields,
      flags,
      method: STORED,
      crc,
      compressedSize: data.byteLength,
      size: data.byteLength
    })
  });
}
function storedEntry(name, data) {
  const directory = name.endsWith("/");
  if (directory && data.byteLength > 0)
    throw new TypeError(`\xAB${name}\xBB is a directory entry and carries no bytes`);
  const nameBytes = encodedName(name);
  const shared = {
    versionNeeded: VERSION_STORED,
    flags: needsUtf8Flag(nameBytes) ? FLAG_UTF8_NAMES : 0,
    method: STORED,
    dosTime: 0,
    dosDate: DOS_EPOCH_DATE,
    crc: directory ? 0 : crc32(data),
    compressedSize: data.byteLength,
    size: data.byteLength,
    nameBytes,
    extraBytes: EMPTY
  };
  return Object.freeze({
    name,
    local: Object.freeze([localHeaderFor(shared), data]),
    central: centralRecordFor({
      ...shared,
      versionMadeBy: VERSION_MADE_BY,
      diskStart: 0,
      internalAttributes: 0,
      externalAttributes: directory ? 16 : 0,
      commentBytes: EMPTY
    })
  });
}
function assembleArchive(planned, comment, budget) {
  if (planned.length > MAX_U16) {
    throw new RangeError("the edited archive would need ZIP64: more than 65535 entries");
  }
  if (planned.length > budget.maxNodes) {
    throw new RangeError("the edited archive exceeds the maxNodes budget");
  }
  let localTotal = 0;
  let centralTotal = 0;
  for (const item of planned) {
    for (const part of item.local) localTotal += part.byteLength;
    centralTotal += item.central.byteLength;
  }
  const total = localTotal + centralTotal + 22 + comment.byteLength;
  if (total > MAX_U32) {
    throw new RangeError("the edited archive would need ZIP64: more than 4 GiB of output");
  }
  if (BigInt(total) > budget.maxInputBytes) {
    throw new RangeError("the edited archive exceeds the maxInputBytes budget");
  }
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const item of planned) {
    new DataView(item.central.buffer, item.central.byteOffset, item.central.byteLength).setUint32(
      42,
      cursor,
      true
    );
    for (const part of item.local) {
      out.set(part, cursor);
      cursor += part.byteLength;
    }
  }
  const centralStart = cursor;
  for (const item of planned) {
    out.set(item.central, cursor);
    cursor += item.central.byteLength;
  }
  const view = new DataView(out.buffer);
  view.setUint32(cursor, ZIP_EOCD, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, planned.length, true);
  view.setUint16(cursor + 10, planned.length, true);
  view.setUint32(cursor + 12, centralTotal, true);
  view.setUint32(cursor + 16, centralStart, true);
  view.setUint16(cursor + 20, comment.byteLength, true);
  out.set(comment, cursor + 22);
  return out;
}
var refusal = (code, message) => Object.freeze({ code, message });
var messageOf = (error) => error instanceof Error ? error.message : String(error);
function archiveEditModel(bytes, entries) {
  try {
    const eocd = findEocd(bytes);
    if (eocd < 0) throw new TypeError("the end-of-central-directory record is missing");
    const commentLength = u16(bytes, eocd + 20);
    if (eocd + 22 + commentLength > bytes.byteLength) {
      throw new TypeError("the archive comment is truncated");
    }
    if (eocd >= 20 && u32(bytes, eocd - 20) === ZIP64_LOCATOR) {
      return refusal(
        "x3.codec/zip-edit-zip64",
        "this archive carries a ZIP64 end-of-central-directory locator; editing it needs a dedicated ZIP64 codec profile"
      );
    }
    const ranges = /* @__PURE__ */ new Map();
    const names = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      if ((entry.flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) {
        return refusal(
          "x3.codec/zip-edit-encrypted",
          `\xAB${entry.name}\xBB is encrypted; this codec never re-assembles an archive it cannot read`
        );
      }
      if (entry.compressedSize === MAX_U32 || entry.size === MAX_U32 || entry.localOffset === MAX_U32) {
        return refusal(
          "x3.codec/zip-edit-zip64",
          `\xAB${entry.name}\xBB stores its size or offset in a ZIP64 extended-information field; editing it needs a dedicated ZIP64 codec profile`
        );
      }
      if (names.has(entry.name)) {
        return refusal(
          "x3.codec/zip-edit-layout",
          `\xAB${entry.name}\xBB appears twice in the central directory; editing by path would be ambiguous`
        );
      }
      names.add(entry.name);
      const range = localBlockRange(bytes, entry);
      const fields = centralFieldsOf(bytes, entry);
      const localExtra = bytes.subarray(range.start + 30 + range.nameLength, range.dataOffset);
      if (extraFieldIds(fields.extraBytes).includes(EXTRA_ZIP64) || extraFieldIds(localExtra).includes(EXTRA_ZIP64)) {
        return refusal(
          "x3.codec/zip-edit-zip64",
          `\xAB${entry.name}\xBB carries a ZIP64 extended-information extra field; editing it needs a dedicated ZIP64 codec profile`
        );
      }
      ranges.set(entry.id, range);
    }
    const centralOffset = u32(bytes, eocd + 16);
    const centralSize = u32(bytes, eocd + 12);
    let prefix = centralOffset;
    for (const entry of entries) prefix = Math.min(prefix, ranges.get(entry.id)?.start ?? 0);
    if (prefix !== 0) {
      return refusal(
        "x3.codec/zip-edit-layout",
        "this archive has data before its first entry (a self-extracting stub); re-assembling it would invalidate the offsets embedded in that prefix"
      );
    }
    let cursor = 0;
    let contiguous = true;
    for (const entry of entries) {
      const range = ranges.get(entry.id);
      if (range === void 0) continue;
      if (range.start !== cursor) contiguous = false;
      cursor = range.end;
    }
    const canonical = contiguous && cursor === centralOffset && centralOffset + centralSize === eocd && eocd + 22 + commentLength === bytes.byteLength;
    return Object.freeze({
      ranges,
      canonical,
      comment: bytes.slice(eocd + 22, eocd + 22 + commentLength)
    });
  } catch (error) {
    return refusal(
      "x3.codec/zip-edit-layout",
      `this archive cannot be re-assembled safely: ${messageOf(error)}`
    );
  }
}
var PRESERVED_NOTES = Object.freeze([
  "untouched entries keep their local header, compressed data and central-directory record byte for byte; only the local-header offset inside the central record is rewritten",
  "compression method, CRC-32, sizes, timestamps, extra fields, entry comments and the archive comment are preserved; nothing is recompressed",
  "added and replaced entries are stored (method 0) with a freshly computed CRC-32 and the DOS-epoch timestamp"
]);
var NON_CANONICAL_NOTE = "this archive is not a canonical ZIP layout (gaps between entries, reordered entries or trailing bytes): re-assembly keeps only what the central directory references";
function fidelityFor(canonical) {
  return {
    roundTrip: "semantic",
    preservesUnknownData: canonical,
    notes: canonical ? [...PRESERVED_NOTES] : [...PRESERVED_NOTES, NON_CANONICAL_NOTE]
  };
}
var BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
function decodeBase64(value, limit, label) {
  if (typeof value !== "string" || !BASE64.test(value)) {
    throw new TypeError(`${label} must be standard base64 without padding errors or whitespace`);
  }
  if (value.length / 4 * 3 > limit) {
    throw new RangeError(`${label} exceeds the maxScalarBytes budget`);
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.byteLength > limit) throw new RangeError(`${label} exceeds the maxScalarBytes budget`);
  return bytes;
}
function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} expects an object`);
  }
  return value;
}
function requireList(value, label) {
  if (value === void 0) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}
function usable(model) {
  if ("code" in model) throw new TypeError(model.message);
  return model;
}
var EDIT_STRUCTURE_OPERATION = Object.freeze({
  id: "edit.structure",
  handlerId: "edit-structure",
  mutatesSource: true,
  requiredPermissions: Object.freeze(["read-source", "write-source"]),
  inputSchema: Object.freeze({
    $ref: "modkit://archive-zip/edit-structure.v1",
    document: Object.freeze({
      schemaVersion: 1,
      forms: Object.freeze([
        Object.freeze({
          id: "zip-add-entry",
          label: "Add an entry to the archive",
          summary: "Adds one stored entry and repacks; kept entries retain their bytes.",
          fields: Object.freeze([
            Object.freeze({
              key: "path",
              label: "Entry path",
              type: Object.freeze({ kind: "path" }),
              inputPath: Object.freeze(["add", 0, "path"]),
              required: true,
              initial: "added/hello.txt"
            }),
            Object.freeze({
              key: "content",
              label: "Contents",
              type: Object.freeze({ kind: "text" }),
              inputPath: Object.freeze(["add", 0, "bytes"]),
              initial: "added from the Modkit inspector",
              encoding: "utf8-base64"
            })
          ])
        }),
        Object.freeze({
          id: "zip-remove-entry",
          label: "Remove an entry from the archive",
          summary: "Removes one entry and repacks; other entries retain their bytes.",
          fields: Object.freeze([
            Object.freeze({
              key: "path",
              label: "Entry path",
              type: Object.freeze({ kind: "path" }),
              inputPath: Object.freeze(["remove", 0]),
              required: true,
              initial: "readme.txt"
            })
          ])
        }),
        Object.freeze({
          id: "zip-rename-entry",
          label: "Rename an entry in the archive",
          summary: "Renames one entry without touching its payload or compression.",
          fields: Object.freeze([
            Object.freeze({
              key: "from",
              label: "From",
              type: Object.freeze({ kind: "path" }),
              inputPath: Object.freeze(["rename", 0, "from"]),
              required: true,
              initial: "readme.txt"
            }),
            Object.freeze({
              key: "to",
              label: "To",
              type: Object.freeze({ kind: "path" }),
              inputPath: Object.freeze(["rename", 0, "to"]),
              required: true,
              initial: "docs/readme.txt"
            })
          ])
        })
      ])
    })
  }),
  outputKinds: Object.freeze(["edit-plan"])
});
var EDIT_CONTENT_OPERATION = Object.freeze({
  id: "edit.content",
  handlerId: "edit-content",
  mutatesSource: true,
  requiredPermissions: Object.freeze(["read-source", "write-source"]),
  inputSchema: Object.freeze({
    $ref: "modkit://archive-zip/edit-content.v1",
    document: Object.freeze({
      schemaVersion: 1,
      forms: Object.freeze([
        Object.freeze({
          id: "zip-replace-entry",
          label: "Replace an entry's contents",
          summary: "Replaces one file entry's payload; nothing else moves.",
          fields: Object.freeze([
            Object.freeze({
              key: "path",
              label: "Entry path",
              type: Object.freeze({ kind: "path" }),
              inputPath: Object.freeze(["path"]),
              required: true,
              initial: "readme.txt"
            }),
            Object.freeze({
              key: "content",
              label: "Contents",
              type: Object.freeze({ kind: "text" }),
              inputPath: Object.freeze(["bytes"]),
              initial: "replaced from the Modkit inspector",
              encoding: "utf8-base64"
            })
          ])
        })
      ])
    })
  }),
  outputKinds: Object.freeze(["edit-plan"])
});
function editPlanOutput(input, assembled, model, planId, label) {
  return {
    kind: "edit-plan",
    plan: editPlanFromInput(input, {
      planId,
      edits: [{ operation: "replace", payload: { kind: "inline", bytes: assembled }, label }],
      fidelity: fidelityFor(model.canonical)
    })
  };
}
function editStructureHandler(bytes, entries, model, budget, input) {
  return async (value) => {
    const usableModel = usable(model);
    const request = requireRecord(value, "edit.structure");
    const additions = requireList(request.add, "edit.structure add");
    const removals = requireList(request.remove, "edit.structure remove");
    const renames = requireList(request.rename, "edit.structure rename");
    if (additions.length + removals.length + renames.length === 0) {
      throw new TypeError("edit.structure needs at least one of add, remove or rename");
    }
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const removed = /* @__PURE__ */ new Set();
    for (const item of removals) {
      const path = safePath(String(item));
      if (!byName.has(path)) throw new TypeError(`ZIP entry \xAB${path}\xBB was not found`);
      if (removed.has(path)) throw new TypeError(`\xAB${path}\xBB is removed twice`);
      removed.add(path);
    }
    const renamed = /* @__PURE__ */ new Map();
    for (const item of renames) {
      const change = requireRecord(item, "edit.structure rename");
      const from = safePath(String(change.from ?? ""));
      const to = safePath(String(change.to ?? ""));
      const entry = byName.get(from);
      if (entry === void 0) throw new TypeError(`ZIP entry \xAB${from}\xBB was not found`);
      if (removed.has(from)) throw new TypeError(`\xAB${from}\xBB is both removed and renamed`);
      if (renamed.has(from)) throw new TypeError(`\xAB${from}\xBB is renamed twice`);
      if (to === "") throw new TypeError("a rename target cannot be empty");
      if (entry.name.endsWith("/") !== to.endsWith("/")) {
        throw new TypeError(
          `renaming \xAB${from}\xBB to \xAB${to}\xBB would change it between file and directory`
        );
      }
      renamed.set(from, to);
    }
    const added = [];
    for (const item of additions) {
      const change = requireRecord(item, "edit.structure add");
      const path = safePath(String(change.path ?? ""));
      if (path === "") throw new TypeError("an added entry needs a path");
      added.push({
        path,
        bytes: decodeBase64(change.bytes, budget.maxScalarBytes, `add \xAB${path}\xBB`)
      });
    }
    const planned = [];
    const finalNames = /* @__PURE__ */ new Set();
    const claim = (name) => {
      if (finalNames.has(name)) throw new TypeError(`\xAB${name}\xBB would appear twice in the archive`);
      finalNames.add(name);
    };
    for (const entry of entries) {
      if (removed.has(entry.name)) continue;
      const range = usableModel.ranges.get(entry.id);
      if (range === void 0) throw new TypeError(`\xAB${entry.name}\xBB has no readable local block`);
      const to = renamed.get(entry.name);
      claim(to ?? entry.name);
      planned.push(
        to === void 0 ? verbatimEntry(bytes, entry, range) : renamedEntry(bytes, entry, range, to)
      );
    }
    for (const item of added) {
      claim(item.path);
      planned.push(storedEntry(item.path, item.bytes));
    }
    if (planned.length === 0) throw new TypeError("edit.structure would leave an empty archive");
    const assembled = assembleArchive(planned, usableModel.comment, budget);
    return editPlanOutput(
      input,
      assembled,
      usableModel,
      `zip-edit-structure:+${added.length}-${removed.size}~${renamed.size}`,
      `add ${added.length}, remove ${removed.size}, rename ${renamed.size}`
    );
  };
}
function editContentHandler(bytes, entries, model, budget, input) {
  return async (value) => {
    const usableModel = usable(model);
    const request = requireRecord(value, "edit.content");
    const path = safePath(String(request.path ?? ""));
    const target = entries.find((entry) => entry.name === path);
    if (target === void 0) throw new TypeError(`ZIP entry \xAB${path}\xBB was not found`);
    if (target.kind !== "file") throw new TypeError(`\xAB${path}\xBB is a directory entry, not content`);
    const data = decodeBase64(
      request.bytes,
      budget.maxScalarBytes,
      `edit.content bytes for \xAB${path}\xBB`
    );
    const planned = entries.map((entry) => {
      const range = usableModel.ranges.get(entry.id);
      if (range === void 0) throw new TypeError(`\xAB${entry.name}\xBB has no readable local block`);
      return entry.id === target.id ? restoredEntry(bytes, entry, range, data) : verbatimEntry(bytes, entry, range);
    });
    const assembled = assembleArchive(planned, usableModel.comment, budget);
    return editPlanOutput(
      input,
      assembled,
      usableModel,
      `zip-edit-content:${path}`,
      `replace ${path} (${data.byteLength} bytes, stored)`
    );
  };
}
var CONTAINER_PACK_OPERATION = Object.freeze({
  id: "container.pack",
  handlerId: "container-pack",
  mutatesSource: true,
  requiredPermissions: Object.freeze(["read-source", "write-source"]),
  outputKinds: Object.freeze(["edit-plan"])
});
function containerPackHandler(bytes, entries, model, budget, input, source) {
  return async (value) => {
    const usableModel = usable(model);
    const request = requireRecord(value, "container.pack");
    if (request.mode === "create") {
      throw new TypeError("container.pack creates no ZIP archive here; it edits an existing one");
    }
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const touched = /* @__PURE__ */ new Set();
    const member = (item, label) => {
      const change = requireRecord(item, label);
      const entry = byId.get(change.entryId) ?? entries.find((item2) => item2.name === change.entryId);
      if (entry === void 0) {
        throw new TypeError(`ZIP entry id \xAB${String(change.entryId)}\xBB was not found`);
      }
      const current = entry.kind === "file" ? containerEntryRevision(
        revisionId(String(source.revision)),
        entry.name,
        BigInt(entry.size)
      ) : source.revision;
      if (change.expectedRevision !== current && change.expectedRevision !== source.revision) {
        throw new TypeError(`\xAB${entry.name}\xBB changed since it was read`);
      }
      if (touched.has(entry.id)) throw new TypeError(`\xAB${entry.name}\xBB is changed twice`);
      touched.add(entry.id);
      return { change, entry };
    };
    const replaced = /* @__PURE__ */ new Map();
    for (const item of requireList(request.replacements, "container.pack replacements")) {
      const { change, entry } = member(item, "container.pack replacement");
      if (entry.kind !== "file") throw new TypeError(`\xAB${entry.name}\xBB is a folder, not content`);
      replaced.set(
        entry.id,
        decodeBase64(change.bytesBase64, budget.maxScalarBytes, `bytes for \xAB${entry.name}\xBB`)
      );
    }
    const removed = /* @__PURE__ */ new Set();
    for (const item of requireList(request.remove, "container.pack remove")) {
      removed.add(member(item, "container.pack remove").entry.id);
    }
    const renamed = /* @__PURE__ */ new Map();
    for (const item of requireList(request.rename, "container.pack rename")) {
      const { change, entry } = member(item, "container.pack rename");
      const name = safePath(String(change.name ?? ""));
      if (name === "") throw new TypeError("a rename target cannot be empty");
      if (entry.name.endsWith("/") !== name.endsWith("/")) {
        throw new TypeError(`renaming \xAB${entry.name}\xBB to \xAB${name}\xBB would change its kind`);
      }
      renamed.set(entry.id, name);
    }
    const added = requireList(request.add, "container.pack add").map((item) => {
      const change = requireRecord(item, "container.pack add");
      const name = safePath(String(change.name ?? ""));
      if (name === "") throw new TypeError("an added member needs a name");
      return {
        name,
        bytes: decodeBase64(change.bytesBase64, budget.maxScalarBytes, `bytes for \xAB${name}\xBB`)
      };
    });
    if (touched.size + added.length === 0) throw new TypeError("container.pack names no change");
    const names = /* @__PURE__ */ new Set();
    const claim = (name) => {
      if (names.has(name)) throw new TypeError(`\xAB${name}\xBB would appear twice in the archive`);
      names.add(name);
    };
    const planned = [];
    for (const entry of entries) {
      if (removed.has(entry.id)) continue;
      const range = usableModel.ranges.get(entry.id);
      if (range === void 0) throw new TypeError(`\xAB${entry.name}\xBB has no readable local block`);
      const data = replaced.get(entry.id);
      const to = renamed.get(entry.id);
      claim(to ?? entry.name);
      planned.push(
        data !== void 0 ? restoredEntry(bytes, entry, range, data) : to !== void 0 ? renamedEntry(bytes, entry, range, to) : verbatimEntry(bytes, entry, range)
      );
    }
    for (const item of added) {
      claim(item.name);
      planned.push(storedEntry(item.name, item.bytes));
    }
    if (planned.length === 0) throw new TypeError("container.pack would leave an empty archive");
    const summary = [
      ...[...replaced.keys()].map((id) => `replace ${byId.get(id).name}`),
      ...added.map((item) => `add ${item.name}`),
      ...[...removed].map((id) => `remove ${byId.get(id).name}`),
      ...[...renamed].map(([id, name]) => `rename ${byId.get(id).name} \u2192 ${name}`)
    ];
    return editPlanOutput(
      input,
      assembleArchive(planned, usableModel.comment, budget),
      usableModel,
      `zip-container-pack:${summary.join(";")}`,
      summary.join(", ")
    );
  };
}
function hiddenZipPath(name) {
  return name.replace(/\/$/u, "").split("/").some((part) => part === "__MACOSX" || part.startsWith(".") || part.toLowerCase() === "thumbs.db");
}
var definition = Object.freeze({
  id: "modkit/archive-zip",
  format: Object.freeze({ id: "zip", label: "ZIP archive", mediaType: "application/zip" }),
  // any size: the directory is read by ranges; an archive within the budget is also editable
  access: "ranges",
  // the four magic bytes are all detect reads
  detectBytes: 4,
  operations: Object.freeze([
    Object.freeze({
      id: "container.extract",
      handlerId: CONTAINER_EXTRACT_HANDLER_ID,
      mutatesSource: false,
      requiredPermissions: Object.freeze(["read-source"]),
      outputKinds: Object.freeze(["bytes"])
    }),
    EDIT_STRUCTURE_OPERATION,
    EDIT_CONTENT_OPERATION,
    CONTAINER_PACK_OPERATION
  ]),
  async detect(bytes) {
    const signature = bytes.byteLength >= 4 ? u32(bytes, 0) : 0;
    const match = signature === ZIP_LOCAL || signature === ZIP_EOCD;
    return { confidence: match ? 0.95 : 0.01, note: match ? "zip-signature" : "signature-mismatch" };
  },
  async inspect(context) {
    const size = Number(await context.byteSource.size());
    const maxRead = Number(context.budget.maxInputBytes);
    const read = async (offset, length) => {
      const bytes2 = await context.byteSource.read(BigInt(offset), length, context.signal);
      if (bytes2.byteLength !== length) throw new TypeError("ZIP archive is truncated");
      return bytes2;
    };
    const whole = size <= maxRead ? await read(0, size) : void 0;
    const bytes = whole ?? EMPTY;
    const entries = whole === void 0 ? await readZipDirectory(read, size, context.budget.maxNodes, maxRead) : parseZipArchive(whole, context.budget.maxNodes);
    const containerEntries = await zipEntryTable(
      entries,
      whole === void 0 ? read : async (offset, length) => whole.subarray(offset, offset + length),
      size
    );
    const files = entries.filter((entry) => entry.kind === "file");
    const directories = entries.length - files.length;
    const uncompressedBytes = files.reduce((total, entry) => total + BigInt(entry.size), 0n);
    const model = whole === void 0 ? refusal(
      "x3.codec/zip-edit-too-large",
      `the archive (${size} bytes) is larger than the edit budget of ${maxRead} bytes`
    ) : archiveEditModel(whole, entries);
    const editable = !("code" in model);
    const tree = createTreeDataSource({
      kind: "archive",
      label: "ZIP",
      preview: `${files.length} files`,
      children: entries.map((entry) => ({
        kind: entry.kind,
        label: entry.name,
        preview: entry.kind === "file" ? `${entry.size} bytes, method ${entry.method}` : "directory"
      }))
    });
    return {
      containerEntries,
      summary: {
        format: "zip",
        entries: entries.length,
        files: files.length,
        directories,
        uncompressedBytes: uncompressedBytes.toString(10),
        editable,
        preservesUnknownData: editable && model.canonical
      },
      metadata: [
        {
          id: "zip-directory",
          label: "ZIP directory",
          entries: [
            { key: "entries", value: entries.length },
            { key: "files", value: files.length },
            { key: "directories", value: directories },
            { key: "uncompressedBytes", value: uncompressedBytes.toString(10) },
            { key: "editable", value: editable }
          ]
        }
      ],
      traits: [
        { id: "container.entries", parameters: { count: entries.length } },
        { id: "container.directories", parameters: { count: directories } },
        {
          id: "container.compression",
          parameters: { methods: [...new Set(files.map((item) => item.method))] }
        },
        { id: "content.binary", parameters: { bytes: String(size) } }
      ],
      diagnostics: editable ? [] : [
        {
          id: "zip-not-editable",
          category: "fidelity",
          severity: "warning",
          code: model.code,
          message: `this archive cannot be edited: ${model.message}`
        }
      ],
      dataSources: {
        "common.view/tree-data-source": tree
      },
      handlers: {
        "edit-structure": editStructureHandler(
          bytes,
          entries,
          model,
          context.budget,
          context.input
        ),
        "edit-content": editContentHandler(bytes, entries, model, context.budget, context.input),
        "container-pack": containerPackHandler(
          bytes,
          entries,
          model,
          context.budget,
          context.input,
          context.source
        )
      }
    };
  }
});
var abiVersion = 1;
var createCodec = (context) => createInspectionCodec(definition, context);
export {
  abiVersion,
  createCodec,
  extractZipArchiveEntry,
  parseZipArchive,
  readZipByRanges
};
