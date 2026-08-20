import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource
} from "../../../chunks/chunk-RJ2K63JO.js";
import "../../../chunks/chunk-6CP4BXQC.js";
import {
  revisionId
} from "../../../chunks/chunk-2UUQHBRG.js";
import {
  diagnostic,
  throwIfAborted,
  uint64
} from "../../../chunks/chunk-OTHYGRZO.js";

// extensions/_shared/codec-kit/src/text/codec-runtime.js
var BASE_OPERATIONS = Object.freeze([
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
var DELIMITED_SCAN_OPERATION = Object.freeze({
  id: "data.scan",
  handlerId: "scan",
  mutatesSource: false,
  requiredPermissions: ["read-source"],
  outputKinds: ["json"]
});
function operationsFor(definition) {
  return definition.semantic === "table" ? Object.freeze([...BASE_OPERATIONS, DELIMITED_SCAN_OPERATION]) : BASE_OPERATIONS;
}
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
function createTextCodec(definition, context) {
  const operations = operationsFor(definition);
  return Object.freeze({
    async probe(request, signal) {
      if (request.source.kind !== "bytes" || request.plan.kind !== "bytes") {
        throw new TypeError("text codecs require byte probes");
      }
      const length = Math.min(
        request.plan.maxBytes,
        request.plan.ranges[0]?.length ?? request.plan.maxBytes
      );
      const bytes = await request.source.read(0n, length, signal);
      let text = "";
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return {
          codecId: `org.modkitx/text-${definition.format}`,
          confidence: 0.01,
          evidence: [{ kind: "structure", weight: -1, note: "invalid-utf8" }],
          requiredRanges: [{ byteOffset: "0", byteLength: String(bytes.byteLength) }]
        };
      }
      const result = definition.detect(text, request.source.ref.uri);
      return {
        codecId: `org.modkitx/text-${definition.format}`,
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
      const semanticContract = definition.semantic === "tree" ? "common.view/tree-data-source" : "common.view/table-data-source";
      const semanticTrait = definition.semantic === "tree" ? "structure.hierarchy" : "table.cells";
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
          codecId: `org.modkitx/text-${definition.format}`,
          codecVersion: "1.0.0",
          formatId: definition.format,
          formatLabel: definition.format.toUpperCase(),
          confidence: 1,
          detection: [{ kind: "structure", weight: 1 }]
        },
        traits: [
          {
            id: semanticTrait,
            descriptorVersion: 1,
            state: "available",
            parameters: definition.semantic === "tree" ? { nodeCount: "unknown", lazy: true, hasLocations: true } : { rows: "unknown", columns: "unknown", sparse: false }
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
        operations: operations.map((operation) => ({
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
          { contract: semanticContract, major: 1 },
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
      if (definition.semantic === "table") {
        handlers.set("scan", async (operationInput) => {
          const request = operationInput && typeof operationInput === "object" && operationInput.kind === "cursor" ? { kind: "cursor", cursor: String(operationInput.cursor ?? "0"), count: 100 } : {
            kind: "range",
            from: operationInput && typeof operationInput === "object" && Number.isSafeInteger(operationInput.from) ? Math.max(0, operationInput.from) : 0,
            count: operationInput && typeof operationInput === "object" && Number.isSafeInteger(operationInput.count) ? Math.min(1e3, Math.max(1, operationInput.count)) : 100
          };
          return { kind: "json", value: await dataLease.value.rows(request) };
        });
      }
      const managed = createAssetSession({
        revision: revisionId(input.revisions.revision),
        descriptor,
        operationDeclarations: operations,
        permissionGrant: {
          id: `text-${definition.format}-session`,
          classes: ["read-source"]
        },
        handlers,
        async openDataSource(contract) {
          if (contract === semanticContract) return simpleLease(dataLease.value);
          if (contract === "common.view/text-data-source") return simpleLease(textSource);
          if (contract === "common.view/byte-range-source") return simpleLease(byteSource);
          throw new TypeError(`text-${definition.format} does not publish ${contract}`);
        },
        release: [
          () => dataLease.release(),
          () => providerLease.release(),
          () => sourceLease.release()
        ]
      });
      return managed.session;
    }
  });
}

// extensions/_shared/codec-kit/src/text/text.js
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
function newlineOf(text) {
  const crlf = (text.match(/\r\n/gu) ?? []).length;
  const withoutCrLf = text.replace(/\r\n/gu, "");
  const lf = (withoutCrLf.match(/\n/gu) ?? []).length;
  const cr = (withoutCrLf.match(/\r/gu) ?? []).length;
  const kinds = [crlf, lf, cr].filter((count) => count > 0).length;
  if (kinds > 1) return "mixed";
  if (crlf > 0) return "crlf";
  if (lf > 0) return "lf";
  if (cr > 0) return "cr";
  return "none";
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
function preflight(decoded, budget, signal) {
  throwIfAborted(signal);
  if (BigInt(decoded.bytes.byteLength) > budget.maxInputBytes) {
    return failure(
      "org.modkitx/text-data-input-budget",
      "input exceeds maxInputBytes",
      decoded.text
    );
  }
  if (decoded.text.includes("\0")) {
    return failure("org.modkitx/text-data-nul", "NUL is forbidden in text input", decoded.text);
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

// extensions/_shared/codec-kit/src/text/tree-data-source.js
function treeDataSource(document) {
  const nodes = /* @__PURE__ */ new Map();
  const root = { id: "root", hasChildren: true };
  nodes.set("root", { value: document, children: [] });
  const entries = document.root?.kind === "object" ? document.root.members.map((member) => [member.key, member.value]) : Object.entries(document);
  nodes.get("root").children = entries.map(([key, value], index) => {
    const id = `root/${index}`;
    nodes.set(id, { value, label: String(key), children: [] });
    return { id, hasChildren: false };
  });
  return {
    async root() {
      return root;
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
      return {
        kind: item?.value?.kind ?? "value",
        label: item?.label ?? "root",
        preview: typeof item?.value === "string" ? item.value : void 0
      };
    },
    async *search(query) {
      for (const [id, item] of nodes) {
        if ((item.label ?? "").includes(query.pattern)) {
          yield { id, hasChildren: (item.children?.length ?? 0) > 0 };
        }
      }
    }
  };
}

// extensions/_shared/codec-kit/src/text/provider-runtime.js
function decode(request) {
  try {
    return { decoded: decodeInput(request.input) };
  } catch (error) {
    return {
      failed: failure(
        "org.modkitx/text-data-decode",
        error instanceof Error ? error.message : String(error)
      )
    };
  }
}
function createTextSyntaxProvider(definition) {
  const provider = {
    contract: definition.contract,
    async parse(request) {
      throwIfAborted(request.signal);
      const prepared = decode(request);
      if (prepared.failed) return prepared.failed;
      const rejected = preflight(prepared.decoded, request.budget, request.signal);
      if (rejected) return rejected;
      return definition.parse(prepared.decoded, request);
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
            "org.modkitx/text-data-output-budget",
            "serialized output exceeds maxInputBytes"
          )
        ]
      };
    },
    async dataSource(request) {
      if (definition.dataSource) {
        throwIfAborted(request.signal);
        const prepared = decode(request);
        if (prepared.failed) {
          throw new TypeError(prepared.failed.diagnostics[0]?.message ?? "decode failed");
        }
        const rejected = preflight(prepared.decoded, request.budget, request.signal);
        if (rejected) throw new TypeError(rejected.diagnostics[0]?.message ?? "preflight failed");
        return lease(await definition.dataSource(prepared.decoded, request));
      }
      const parsed = await provider.parse(request);
      if (parsed.state === "failed") {
        throw new TypeError(parsed.diagnostics[0]?.message ?? "parse failed");
      }
      return lease(treeDataSource(parsed.document));
    }
  };
  return Object.freeze(provider);
}
function createSelectedProvider(definition, selection, factory = createTextSyntaxProvider) {
  if (selection?.contract !== definition.contract) {
    throw new TypeError(`provider does not implement ${String(selection?.contract)}`);
  }
  return factory(definition);
}

// extensions/_shared/codec-kit/src/text/scalars.js
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
  if (value instanceof Date)
    return { kind: "date-time", iso: value.toISOString(), raw: raw ?? value.toISOString() };
  return { kind: "string", value: String(value), raw: raw ?? String(value) };
}
function plainNode(value, text, counters, depth = 0) {
  counters.nodes += 1;
  counters.depth = Math.max(counters.depth, depth);
  const range = span(text);
  if (Array.isArray(value)) {
    return {
      kind: "sequence",
      items: value.map((item) => plainNode(item, text, counters, depth + 1)),
      range
    };
  }
  if (value && typeof value === "object") {
    return {
      kind: "mapping",
      pairs: Object.entries(value).map(([key, item]) => ({
        key: { kind: "scalar", value: scalar(key), range },
        value: plainNode(item, text, counters, depth + 1)
      })),
      range
    };
  }
  return { kind: "scalar", value: scalar(value), range };
}
export {
  createSelectedProvider,
  createTextCodec,
  createTextSyntaxProvider,
  decodeInput,
  encodeText,
  failure,
  lease,
  newlineOf,
  plainNode,
  preflight,
  scalar,
  span,
  treeDataSource
};
