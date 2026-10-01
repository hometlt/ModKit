import {
  metadataFieldProjections
} from "./chunk-5GGWVEQJ.js";
import {
  grantValidity,
  validateSubjectDescriptorV2
} from "./chunk-VI4QBV4T.js";
import {
  ModkitError,
  canonicalJsonStringify,
  diagnostic,
  isCancellation,
  throwIfAborted,
  uint64
} from "./chunk-V3DESLW4.js";

// ../MODDING/modkit-core/packages/host/dist/session.js
var projection = () => import("./subject-projection-V3DNLVBY.js");
function rejected(reason, message) {
  return {
    state: "rejected",
    reason,
    diagnostics: [diagnostic("error", `x3.host/${reason}`, message)]
  };
}
function snapshotInput(input) {
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
    return Object.freeze(Object.fromEntries(Reflect.ownKeys(value).map((key) => [
      key,
      snapshotStructured(value[key])
    ])));
  }
  return value;
}
function snapshotOutput(output) {
  switch (output.kind) {
    case "json": {
      const value = snapshotInput(output.value);
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
  const maxOperationDiagnostics = options.maxOperationDiagnostics ?? 100;
  if (!Number.isSafeInteger(maxOperationDiagnostics) || maxOperationDiagnostics < 0)
    throw new TypeError("invalid maxOperationDiagnostics");
  const originalDescriptor = options.descriptor;
  const originalOffers = new Set(originalDescriptor.dataSources.map((item) => `${item.contract}@${item.major}`));
  const metadataFields = originalDescriptor.interpretation === "codec" ? metadataFieldProjections(originalDescriptor.metadata) : Object.freeze([]);
  const projectsRelations = options.subjectProjection !== void 0 && metadataFields.length > 0;
  const added = [];
  if (!originalOffers.has("common.view/subject-facts-source@1")) {
    added.push({ contract: "common.view/subject-facts-source", major: 1 });
  }
  if (projectsRelations && !originalOffers.has("common.view/relation-graph-source@1")) {
    added.push({ contract: "common.view/relation-graph-source", major: 1 });
  }
  const descriptor = Object.freeze({
    ...originalDescriptor,
    dataSources: Object.freeze([...originalDescriptor.dataSources, ...added]),
    ...added.length === 0 ? {} : { hostDataSources: Object.freeze(added) }
  });
  const operationByHandler = new Map(descriptor.operations.map((item) => [item.handlerId, item]));
  const declarationByHandler = new Map(options.operationDeclarations.map((item) => [item.handlerId, item]));
  const handlers = new Map(options.handlers);
  const releases = [...options.release ?? []];
  const subscribers = /* @__PURE__ */ new Set();
  let state = "live";
  let disposal;
  let genericGraph;
  const projectedGraph = () => {
    if (options.subjectProjection === void 0) {
      throw new TypeError("subject relation projection is unavailable");
    }
    const relations = options.subjectProjection;
    genericGraph ??= (async () => {
      const built = await projection();
      return built.createFieldRelationGraphSource({
        owner: built.descriptorSubjectRef(originalDescriptor),
        ownerLabel: originalDescriptor.interpretation === "codec" ? originalDescriptor.identity.formatLabel : originalDescriptor.subjectUri,
        ownerKind: originalDescriptor.interpretation === "codec" ? `format:${originalDescriptor.identity.formatId}` : "format:unknown",
        fields: metadataFields,
        resolver: relations.references,
        ...relations.budget === void 0 ? {} : { budget: relations.budget }
      });
    })();
    return genericGraph;
  };
  const releaseTogether = (value, callbacks) => {
    let released = false;
    return Object.freeze({
      value,
      async release() {
        if (released)
          return;
        released = true;
        const results = await Promise.allSettled([...callbacks].reverse().map((callback) => callback()));
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected")
          throw failure.reason;
      }
    });
  };
  const openGraph = async () => {
    const authoritative = originalOffers.has("common.view/relation-graph-source@1") ? await options.openDataSource("common.view/relation-graph-source", 1) : void 0;
    try {
      const generic = projectsRelations ? await projectedGraph() : void 0;
      if (authoritative !== void 0 && generic !== void 0) {
        const built = await projection();
        return releaseTogether(built.createCompositeRelationGraphSource([authoritative.value, generic]), [authoritative.release]);
      }
      if (authoritative !== void 0)
        return authoritative;
      if (generic !== void 0)
        return releaseTogether(generic, []);
      throw new TypeError("relation graph source is unavailable");
    } catch (error) {
      await authoritative?.release();
      throw error;
    }
  };
  const openFacts = async () => {
    const graph = originalOffers.has("common.view/relation-graph-source@1") || projectsRelations ? await openGraph() : void 0;
    let authoritative;
    try {
      authoritative = originalOffers.has("common.view/subject-facts-source@1") ? await options.openDataSource("common.view/subject-facts-source", 1) : void 0;
      const built = await projection();
      const fallback = built.createDescriptorFallbackSubjectFactsSource({
        descriptor: originalDescriptor,
        ...graph === void 0 ? {} : { relations: graph.value },
        ...options.subjectProjection?.kindDefinition === void 0 ? {} : { kindDefinition: options.subjectProjection.kindDefinition }
      });
      return releaseTogether(authoritative === void 0 ? fallback : built.createCompositeSubjectFactsSource([authoritative.value, fallback]), [
        ...authoritative === void 0 ? [] : [authoritative.release],
        ...graph === void 0 ? [] : [graph.release]
      ]);
    } catch (error) {
      await Promise.allSettled([
        ...authoritative === void 0 ? [] : [authoritative.release()],
        ...graph === void 0 ? [] : [graph.release()]
      ]);
      throw error;
    }
  };
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
      const ownedInput = snapshotInput(input);
      if (ownedInput === void 0) {
        return rejected("input-not-serializable", "operation input must be inert JSON data");
      }
      const handler = handlers.get(handlerId);
      if (handler === void 0) {
        return rejected("handler-unregistered", `handler ${handlerId} is not registered`);
      }
      try {
        throwIfAborted(invokeOptions.signal);
        const diagnostics = [];
        let reporting = true;
        const reportDiagnostic = (value) => {
          if (!reporting || maxOperationDiagnostics === 0)
            return;
          if (diagnostics.length >= maxOperationDiagnostics) {
            diagnostics[maxOperationDiagnostics - 1] = diagnostic("information", "x3.host/operation-diagnostics-truncated", "Further operation diagnostics were omitted by the session budget.");
            return;
          }
          try {
            const encoded = canonicalJsonStringify(value);
            if (encoded.length > 65536)
              throw new TypeError("oversized diagnostic");
            const owned = JSON.parse(encoded);
            if (!["error", "warning", "information", "hint"].includes(owned.severity) || typeof owned.message !== "string" || typeof owned.code !== "string")
              throw new TypeError("invalid diagnostic");
            diagnostic(owned.severity, owned.code, owned.message);
            diagnostics.push(snapshotStructured(owned));
          } catch {
            diagnostics.push(diagnostic("warning", "x3.host/invalid-operation-diagnostic", "An operation diagnostic was not bounded, serializable diagnostic data."));
          }
        };
        let output;
        try {
          output = snapshotOutput(await handler(ownedInput, { ...invokeOptions, reportDiagnostic }));
        } finally {
          reporting = false;
        }
        throwIfAborted(invokeOptions.signal);
        if (declaration.outputKinds !== void 0 && !declaration.outputKinds.includes(output.kind)) {
          throw new ModkitError({
            code: "x3.host/undeclared-operation-output",
            message: `handler ${handlerId} returned undeclared output kind ${output.kind}`,
            context: { handlerId, outputKind: output.kind }
          });
        }
        return { state: "ok", output, diagnostics: Object.freeze(diagnostics) };
      } catch (error) {
        if (isCancellation(error) || invokeOptions.signal?.aborted) {
          return rejected("cancelled", "the operation was cancelled");
        }
        if (error instanceof ModkitError)
          throw error;
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
    if (disposal !== void 0)
      return disposal;
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
      if (contract === "common.view/relation-graph-source" && major === 1) {
        return openGraph();
      }
      if (contract === "common.view/subject-facts-source" && major === 1) {
        return openFacts();
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

// ../MODDING/modkit-core/packages/host/dist/data-sources.js
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
function cursor(offset, line) {
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
      nextCursor: cursor(actualEnd, nextLine)
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

export {
  assembleSubjectDescriptor,
  createAssetSession,
  createByteRangeSource,
  createUtf8TextDataSource,
  createLazyTableDataSource
};
