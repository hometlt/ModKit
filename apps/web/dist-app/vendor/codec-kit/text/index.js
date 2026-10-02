import {
  createTableDataSource
} from "../../../chunks/chunk-XYU4XXWE.js";
import "../../../chunks/chunk-BFR65BLC.js";
import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource
} from "../../../chunks/chunk-6YZP4SAK.js";
import "../../../chunks/chunk-5GGWVEQJ.js";
import {
  revisionId
} from "../../../chunks/chunk-2LRUXON6.js";
import {
  diagnostic,
  throwIfAborted,
  uint64
} from "../../../chunks/chunk-V3DESLW4.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/src/text/codec-runtime.ts
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
          codecId: `modkit/text-${definition.format}`,
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
          const request = operationInput && typeof operationInput === "object" && operationInput.kind === "cursor" ? {
            kind: "cursor",
            cursor: String(operationInput.cursor ?? "0"),
            count: 100
          } : {
            kind: "range",
            from: operationInput && typeof operationInput === "object" && Number.isSafeInteger(operationInput.from) ? Math.max(0, operationInput.from) : 0,
            count: operationInput && typeof operationInput === "object" && Number.isSafeInteger(operationInput.count) ? Math.min(
              1e3,
              Math.max(1, operationInput.count)
            ) : 100
          };
          return {
            kind: "json",
            value: await dataLease.value.rows(
              request
            )
          };
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
          if (contract === semanticContract)
            return simpleLease(dataLease.value);
          if (contract === "common.view/text-data-source")
            return simpleLease(textSource);
          if (contract === "common.view/byte-range-source")
            return simpleLease(byteSource);
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

// packages/codec-kit/src/text/text.ts
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
function spanner(text) {
  const encoder = new TextEncoder();
  let at = 0;
  let bytes = 0;
  let line = 0;
  let lineStart = 0;
  return (offset, length) => {
    if (offset < at) at = bytes = line = lineStart = 0;
    const between = text.slice(at, offset);
    bytes += encoder.encode(between).byteLength;
    for (let index = between.indexOf("\n"); index !== -1; index = between.indexOf("\n", index + 1)) {
      line += 1;
      lineStart = at + index + 1;
    }
    at = offset;
    return Object.freeze({
      byteOffset: uint64(BigInt(bytes)),
      byteLength: uint64(BigInt(encoder.encode(text.slice(offset, offset + length)).byteLength)),
      utf16Offset: offset,
      utf16Length: length,
      line,
      column: offset - lineStart
    });
  };
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
    return failure("modkit/text-data-input-budget", "input exceeds maxInputBytes", decoded.text);
  }
  if (decoded.text.includes("\0")) {
    return failure("modkit/text-data-nul", "NUL is forbidden in text input", decoded.text);
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

// packages/codec-kit/src/text/tree-data-source.ts
function treeDataSource(document) {
  const nodes = /* @__PURE__ */ new Map();
  const root = { id: "root", hasChildren: true };
  nodes.set("root", { value: document, children: [] });
  const entries = document.root?.kind === "object" ? document.root.members.map((member) => [
    member.key,
    member.value
  ]) : Object.entries(document);
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

// packages/codec-kit/src/text/provider-runtime.ts
function decode(request) {
  try {
    return { decoded: decodeInput(request.input) };
  } catch (error) {
    return {
      failed: failure(
        "modkit/text-data-decode",
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
            "modkit/text-data-output-budget",
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

// packages/codec-kit/src/text/scalars.ts
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

// packages/codec-kit/src/text/ini.ts
function parseIni(decoded, dialect) {
  const text = decoded.text;
  const westwood = dialect === "ini-westwood";
  const emperor = dialect === "ini-emperor";
  const lenient = westwood || emperor || dialect === "ini-war3";
  const span2 = spanner(text);
  const sections = [];
  let current = { name: "", entries: [], range: span2(0, 0) };
  sections.push(current);
  const seen = /* @__PURE__ */ new Set();
  const diagnostics = [];
  const lines = /([^\r\n]*)(\r\n|\r|\n|$)/gu;
  for (let match = lines.exec(text); match !== null; match = lines.exec(text)) {
    const offset = match.index;
    const line = match[1];
    if (match[0] === "") break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#") || lenient && trimmed.startsWith("//"))
      continue;
    const content = westwood ? trimmed.replace(/\s*;.*$/u, "") : emperor ? trimmed.replace(/\s*\/\/.*$/u, "") : trimmed;
    const section = /^\[([^\]]+)\]$/u.exec(content);
    if (section) {
      current = { name: section[1], entries: [], range: span2(offset, line.length) };
      sections.push(current);
      continue;
    }
    const body = emperor ? content : line;
    const equals = body.indexOf("=");
    if (emperor && equals < 0) {
      current.entries.push({ key: content, value: "", range: span2(offset, line.length) });
      continue;
    }
    if (equals <= 0) {
      if (lenient) {
        diagnostics.push(
          diagnostic(
            "warning",
            "modkit/text-data-ini-skipped-line",
            "line without key = value; the engine skips it",
            void 0,
            void 0,
            span2(offset, line.length)
          )
        );
        continue;
      }
      return failure(
        "modkit/text-data-ini-parse",
        "INI entry requires a non-empty key",
        text,
        offset,
        line.length
      );
    }
    const key = body.slice(0, equals).trim();
    const identity = `${current.name}
${key}`;
    if (dialect === "ini-basic" && seen.has(identity))
      return failure(
        "modkit/text-data-ini-duplicate",
        `duplicate key ${key}`,
        text,
        offset,
        line.length
      );
    seen.add(identity);
    const value = body.slice(equals + 1);
    current.entries.push({
      key,
      value: (westwood ? value.replace(/;.*$/u, "") : value).trim(),
      range: span2(offset, line.length)
    });
  }
  return { state: "ok", document: { sections, source: decoded.source }, diagnostics };
}

// packages/codec-kit/src/text/sylk.ts
var MAX_COLUMNS = 16384;
var MAX_ROWS = 1048576;
function fieldsOf(line) {
  const fields = [];
  let field = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character !== ";") field += character;
    else if (line[index + 1] === ";") {
      field += ";";
      index += 1;
    } else {
      fields.push(field);
      field = "";
    }
  }
  fields.push(field);
  return fields;
}
function parseSylk(decoded, limits) {
  const text = decoded.text;
  const span2 = spanner(text);
  const rows = /* @__PURE__ */ new Map();
  const diagnostics = [];
  let started = false;
  let column = 1;
  let row = 1;
  let columns = 0;
  let cells = 0;
  const lines = /([^\r\n]*)(\r\n|\r|\n|$)/gu;
  for (let match = lines.exec(text); match !== null; match = lines.exec(text)) {
    if (match[0] === "") break;
    const offset = match.index;
    const line = match[1];
    if (line.trim() === "") continue;
    const [kind = "", ...fields] = fieldsOf(line);
    if (!started) {
      if (kind !== "ID")
        return failure(
          "modkit/text-data-slk-parse",
          "SYLK starts with an ID record",
          text,
          offset,
          line.length
        );
      started = true;
      continue;
    }
    if (kind === "E") break;
    if (kind !== "C" && kind !== "F") continue;
    let value;
    for (const field of fields) {
      const code = field[0];
      if (code === "X" || code === "Y") {
        const coordinate = /^\d+$/u.test(field.slice(1)) ? Number(field.slice(1)) : 0;
        if (coordinate < 1 || coordinate > (code === "X" ? MAX_COLUMNS : MAX_ROWS))
          return failure(
            "modkit/text-data-slk-parse",
            `SYLK coordinate ${field} is out of range`,
            text,
            offset,
            line.length
          );
        if (code === "X") column = coordinate;
        else row = coordinate;
      } else if (code === "K" && kind === "C") value = field.slice(1);
    }
    if (value === void 0) continue;
    const quoted = value.startsWith('"');
    const cell = {
      column,
      value: quoted ? value.slice(1, value.length > 1 && value.endsWith('"') ? -1 : void 0) : value,
      quoted,
      range: span2(offset, line.length)
    };
    const cellsOfRow = rows.get(row) ?? /* @__PURE__ */ new Map();
    if (cellsOfRow.has(column))
      diagnostics.push(
        diagnostic(
          "warning",
          "modkit/text-data-slk-duplicate-cell",
          `cell X${String(column)};Y${String(row)} is written twice; the later value is kept`,
          void 0,
          void 0,
          cell.range
        )
      );
    else {
      if (limits !== void 0 && cells >= limits.maxNodes)
        return {
          state: "truncated",
          document: documentOf(rows, columns, decoded),
          truncated: { limit: "maxNodes" },
          diagnostics
        };
      cells += 1;
    }
    rows.set(row, cellsOfRow);
    cellsOfRow.set(column, cell);
    columns = Math.max(columns, column);
  }
  if (!started) return failure("modkit/text-data-slk-parse", "SYLK starts with an ID record", text);
  return { state: "ok", document: documentOf(rows, columns, decoded), diagnostics };
}
function documentOf(rows, columns, decoded) {
  const ordered = [...rows].sort(([left], [right]) => left - right).map(([index, cells]) => ({
    index,
    cells: [...cells.values()].sort((left, right) => left.column - right.column)
  }));
  return { columns, rows: ordered, source: decoded.source };
}
function formatSylk(document) {
  const escape = (value) => value.replaceAll(";", ";;");
  const height = document.rows.reduce((most, row) => Math.max(most, row.index), 0);
  const records = ["ID;PWXL;N;E", `B;X${String(document.columns)};Y${String(height)};D0`];
  for (const row of document.rows)
    row.cells.forEach(
      (cell, index) => records.push(
        `C;X${String(cell.column)}${index === 0 ? `;Y${String(row.index)}` : ""};K${cell.quoted ? `"${escape(cell.value)}"` : escape(cell.value)}`
      )
    );
  records.push("E", "");
  return records.join("\n");
}
function sylkTableDataSource(document) {
  const height = document.rows.reduce((most, row) => Math.max(most, row.index), 0);
  const byRow = new Map(document.rows.map((row) => [row.index, row]));
  const dense = (index) => {
    const values = new Array(document.columns).fill("");
    for (const cell of byRow.get(index)?.cells ?? []) values[cell.column - 1] = cell.value;
    return values;
  };
  const cellAt = (row, column) => byRow.get(row)?.cells.find((cell) => cell.column === column);
  return createTableDataSource({
    header: dense(1),
    rows: Array.from({ length: Math.max(0, height - 1) }, (_, offset) => dense(offset + 2)),
    cellFacts: (coord) => {
      const cell = cellAt(coord.row + 2, coord.column + 1);
      return cell === void 0 ? void 0 : { range: cell.range };
    }
  });
}

// packages/codec-kit/src/text/csf.ts
var HEADER_TAG = " FSC";
var LABEL_TAG = " LBL";
var STRING_TAG = " RTS";
var STRING_WITH_NOTE_TAG = "WRTS";
function isCsf(data) {
  return data.length >= 4 && latin1(data, 0, 4) === HEADER_TAG;
}
function parseCsf(data) {
  if (!isCsf(data)) throw new TypeError("not a CSF string table");
  if (data.length < 24) throw new RangeError("CSF header is truncated");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(4, true);
  const declaredLabels = view.getUint32(8, true);
  const declaredStrings = view.getUint32(12, true);
  const language = view.getUint32(20, true);
  if (declaredLabels > (data.length - 24) / 12)
    throw new RangeError(`CSF declares ${declaredLabels} labels in ${data.length} bytes`);
  const u32 = (at) => {
    if (at + 4 > data.length) throw new RangeError(`CSF read out of bounds at ${at}`);
    return view.getUint32(at, true);
  };
  const entries = [];
  let cursor = 24;
  for (let index = 0; index < declaredLabels; index += 1) {
    const labelTag = latin1(data, cursor, 4);
    if (labelTag !== LABEL_TAG)
      throw new TypeError(`CSF label ${index} has tag ${JSON.stringify(labelTag)} at ${cursor}`);
    const pairs = u32(cursor + 4);
    const nameLength = u32(cursor + 8);
    cursor += 12;
    const label = latin1(data, cursor, nameLength);
    cursor += nameLength;
    const values = [];
    let note;
    for (let pair = 0; pair < pairs; pair += 1) {
      const valueTag = latin1(data, cursor, 4);
      if (valueTag !== STRING_TAG && valueTag !== STRING_WITH_NOTE_TAG)
        throw new TypeError(`CSF value tag ${JSON.stringify(valueTag)} at ${cursor}`);
      const units = u32(cursor + 4);
      cursor += 8;
      if (cursor + units * 2 > data.length)
        throw new RangeError(`CSF value of ${units} units runs past the end at ${cursor}`);
      let value = "";
      for (let start = 0; start < units; start += 4096) {
        const chunk = [];
        for (let unit = start; unit < Math.min(units, start + 4096); unit += 1)
          chunk.push(~view.getUint16(cursor + unit * 2, true) & 65535);
        value += String.fromCharCode(...chunk);
      }
      cursor += units * 2;
      values.push(value);
      if (valueTag === STRING_WITH_NOTE_TAG) {
        const noteLength = u32(cursor);
        cursor += 4;
        note ??= latin1(data, cursor, noteLength);
        cursor += noteLength;
      }
    }
    entries.push({
      label,
      value: values[0] ?? "",
      extraValues: values.slice(1),
      ...note === void 0 ? {} : { note }
    });
  }
  if (cursor !== data.length)
    throw new RangeError(`CSF trailing data: consumed ${cursor} of ${data.length}`);
  return { version, declaredLabels, declaredStrings, language, entries };
}
function csfToMap(file) {
  const map = /* @__PURE__ */ new Map();
  for (const entry of file.entries) map.set(entry.label, entry.value);
  return map;
}
function latin1(data, offset, length) {
  if (offset < 0 || length < 0 || offset + length > data.length)
    throw new RangeError(`CSF read out of bounds at ${offset}+${length}`);
  let out = "";
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(data[offset + index]);
  return out;
}
export {
  createSelectedProvider,
  createTextCodec,
  createTextSyntaxProvider,
  csfToMap,
  decodeInput,
  encodeText,
  failure,
  formatSylk,
  isCsf,
  lease,
  newlineOf,
  parseCsf,
  parseIni,
  parseSylk,
  plainNode,
  preflight,
  scalar,
  span,
  sylkTableDataSource,
  treeDataSource
};
