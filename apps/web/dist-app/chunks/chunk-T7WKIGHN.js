import {
  unknownSourceLease
} from "./chunk-EYZUVLIL.js";
import {
  createSubjectCandidateProvider,
  isKnowledgeTarget,
  loadSubjectCandidatePage
} from "./chunk-BPQKZDVH.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// packages/ui/dist/field-editor/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// packages/ui/dist/selector/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function candidateTargetForField(type) {
  if (type.kind === "subject-ref") {
    return Object.freeze({
      kind: "subject-ref",
      subjectKind: type.subjectKind,
      ...type.filter === void 0 ? {} : { filter: type.filter }
    });
  }
  if (type.kind === "asset-ref") {
    return Object.freeze({ kind: "asset-ref", accepts: type.accepts });
  }
  return void 0;
}
var positive = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
};
var SubjectSelectorModel = class {
  #provider;
  #target;
  #pageSize;
  #maximum;
  #signal;
  #generation = 0;
  #summary;
  #items = Object.freeze([]);
  #text = "";
  #nextCursor;
  #loading = false;
  #seenCursors = /* @__PURE__ */ new Set();
  constructor(options) {
    this.#provider = options.candidates;
    this.#target = options.target;
    this.#pageSize = positive(options.pageSize ?? 64, "pageSize");
    this.#maximum = positive(options.maximum ?? 512, "maximum");
    this.#signal = options.signal;
  }
  snapshot() {
    const locallyCapped = this.#items.length >= this.#maximum && this.#nextCursor !== void 0;
    return Object.freeze({
      ...this.#summary === void 0 ? {} : { summary: this.#summary },
      candidates: this.#items,
      text: this.#text,
      ...this.#nextCursor === void 0 ? {} : { nextCursor: this.#nextCursor },
      ...this.#summary === void 0 ? {} : {
        completeness: locallyCapped ? "capped" : this.#summary.completeness
      },
      loading: this.#loading
    });
  }
  async search(text) {
    if (typeof text !== "string")
      throw new TypeError("selector search text must be a string");
    this.#generation += 1;
    this.#text = text;
    this.#summary = void 0;
    this.#items = Object.freeze([]);
    this.#nextCursor = void 0;
    this.#seenCursors.clear();
    return this.#load(this.#generation, void 0);
  }
  async loadMore() {
    const cursor = this.#nextCursor;
    if (cursor === void 0 || this.#items.length >= this.#maximum)
      return this.snapshot();
    if (this.#seenCursors.has(cursor))
      throw new Error("subject selector repeated a page cursor");
    this.#seenCursors.add(cursor);
    return this.#load(this.#generation, cursor);
  }
  async #load(generation, cursor) {
    this.#signal?.throwIfAborted();
    const remaining = this.#maximum - (cursor === void 0 ? 0 : this.#items.length);
    if (remaining < 1)
      return this.snapshot();
    this.#loading = true;
    try {
      const result = await loadSubjectCandidatePage(this.#provider, {
        target: this.#target,
        text: this.#text,
        ...cursor === void 0 ? {} : { cursor },
        limit: Math.min(this.#pageSize, remaining)
      }, this.#signal);
      if (generation !== this.#generation)
        return this.snapshot();
      if (this.#summary !== void 0 && this.#summary.snapshotId !== result.summary.snapshotId) {
        throw new Error("subject selector snapshot changed between pages");
      }
      const prior = cursor === void 0 ? [] : this.#items;
      const ids = new Set(prior.map((item) => item.subjectId));
      if (result.page.items.some((item) => ids.has(item.subjectId))) {
        throw new Error("subject selector repeated a candidate between pages");
      }
      if (result.page.nextCursor !== void 0 && result.page.nextCursor === cursor) {
        throw new Error("subject selector repeated a page cursor");
      }
      this.#summary = result.summary;
      this.#items = Object.freeze([...prior, ...result.page.items]);
      this.#nextCursor = result.page.nextCursor;
      this.#loading = false;
      return this.snapshot();
    } finally {
      if (generation === this.#generation)
        this.#loading = false;
    }
  }
};
async function subjectCandidateProviderLease(sources, slot) {
  const lease = await unknownSourceLease(sources, slot, "common.view/subject-selector-source");
  if (lease === void 0)
    return void 0;
  return Object.freeze({
    value: createSubjectCandidateProvider(lease.value),
    release: () => lease.release()
  });
}
async function mountSubjectSelector(container, options) {
  const document = container.ownerDocument;
  const root = document.createElement("div");
  root.setAttribute("part", "selector");
  const search = document.createElement("input");
  search.type = "search";
  search.setAttribute("part", "selector.search");
  search.setAttribute("aria-label", options.labels?.search ?? "Search candidates");
  const select = document.createElement("select");
  select.setAttribute("part", "selector.candidates");
  select.setAttribute("aria-label", options.labels?.candidates ?? "Candidates");
  const more = document.createElement("button");
  more.type = "button";
  more.setAttribute("part", "selector.more");
  more.textContent = options.labels?.loadMore ?? "Load more";
  const status = document.createElement("output");
  status.setAttribute("part", "selector.status");
  root.append(search, select, more, status);
  container.append(root);
  const model = new SubjectSelectorModel(options);
  let problem;
  let destroyed = false;
  const draw = (snapshot) => {
    if (destroyed)
      return;
    const selected = select.value || options.initial || snapshot.candidates[0]?.subjectId || "";
    select.replaceChildren();
    if (selected.length > 0 && !snapshot.candidates.some((item) => item.subjectId === selected)) {
      const initial = document.createElement("option");
      initial.value = selected;
      initial.textContent = selected;
      select.append(initial);
    }
    for (const candidate of snapshot.candidates) {
      const option = document.createElement("option");
      option.value = candidate.subjectId;
      option.textContent = candidate.label === candidate.subjectId ? candidate.label : `${candidate.label} (${candidate.subjectId})`;
      select.append(option);
    }
    select.value = selected;
    more.hidden = snapshot.nextCursor === void 0;
    more.disabled = snapshot.loading || snapshot.completeness === "capped";
    const state = snapshot.completeness ?? "partial";
    status.textContent = `${snapshot.candidates.length}/${snapshot.summary?.totalSubjects ?? "?"} \xB7 ${state}`;
  };
  const run = async (operation) => {
    problem = void 0;
    try {
      const snapshot = await operation();
      draw(snapshot);
      return snapshot;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
      status.textContent = problem;
      throw error;
    }
  };
  const searchCandidates = () => run(() => model.search(search.value));
  const loadMore = () => run(() => model.loadMore());
  const changed = () => {
    options.onSelect?.(model.snapshot().candidates.find((item) => item.subjectId === select.value));
  };
  const searched = () => void searchCandidates().catch(() => void 0);
  const moreRequested = () => void loadMore().catch(() => void 0);
  search.addEventListener("input", searched);
  select.addEventListener("change", changed);
  more.addEventListener("click", moreRequested);
  const destroy = () => {
    if (destroyed)
      return;
    destroyed = true;
    options.signal?.removeEventListener("abort", aborted);
    search.removeEventListener("input", searched);
    select.removeEventListener("change", changed);
    more.removeEventListener("click", moreRequested);
    root.remove();
  };
  const aborted = () => destroy();
  options.signal?.addEventListener("abort", aborted, { once: true });
  await searchCandidates();
  const control = Object.freeze({
    root,
    model,
    read: () => select.value,
    validate: () => problem,
    search: (text) => {
      search.value = text;
      return searchCandidates();
    },
    loadMore,
    destroy
  });
  return control;
}

// packages/ui/dist/field-editor/index.js
function parseJsonValue(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${label} must be valid JSON`);
  }
}
function fieldValue(field, value) {
  const { type } = field;
  if (type.kind === "text" || type.kind === "text-key" || type.kind === "script") {
    const text = String(value ?? "");
    if (type.kind === "text") {
      if (type.maxLength !== void 0 && text.length > type.maxLength) {
        throw new TypeError(`${field.label} must contain at most ${type.maxLength} characters`);
      }
      if (type.pattern !== void 0 && !new RegExp(type.pattern, "u").test(text)) {
        throw new TypeError(`${field.label} does not match its required pattern`);
      }
    }
    return text;
  }
  if (type.kind === "duration" || type.kind === "date" || type.kind === "bytes" || type.kind === "id" || type.kind === "path" || type.kind === "subject-ref" || type.kind === "asset-ref") {
    return String(value ?? "");
  }
  if (type.kind === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number))
      throw new TypeError(`${field.label} must be a number`);
    if (type.integer === true && !Number.isInteger(number)) {
      throw new TypeError(`${field.label} must be an integer`);
    }
    if (type.min !== void 0 && number < type.min) {
      throw new TypeError(`${field.label} must be at least ${type.min}`);
    }
    if (type.max !== void 0 && number > type.max) {
      throw new TypeError(`${field.label} must be at most ${type.max}`);
    }
    return number;
  }
  if (type.kind === "boolean") {
    if (typeof value === "boolean")
      return value;
    if (value === "true")
      return true;
    if (value === "false")
      return false;
    throw new TypeError(`${field.label} must be true or false`);
  }
  if (type.kind === "enum") {
    const id = String(value);
    if (!type.members.some((member) => member.id === id) && type.unknown === void 0) {
      throw new TypeError(`${field.label} must be one of its published values`);
    }
    return id;
  }
  if (type.kind === "color")
    return String(value);
  if (type.kind === "flags") {
    const ids = Array.isArray(value) ? value.map(String) : String(value).split(",").map((item) => item.trim()).filter(Boolean);
    if (ids.some((id) => !type.members.some((member) => member.id === id))) {
      throw new TypeError(`${field.label} contains an unpublished flag`);
    }
    return ids;
  }
  if (type.kind === "vector") {
    const vector = Array.isArray(value) ? value : parseJsonValue(String(value), field.label);
    if (!Array.isArray(vector) || vector.length !== type.size || vector.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      throw new TypeError(`${field.label} must contain ${type.size} finite numbers`);
    }
    return vector;
  }
  if (type.kind === "struct" || type.kind === "array" || type.kind === "record" || type.kind === "instructions" || type.kind === "json") {
    return typeof value === "string" ? parseJsonValue(value, field.label) : value;
  }
  return value;
}
async function mountFieldEditor(container, field, signal, registry, editorId, candidates) {
  if (field.type.kind === "custom") {
    const module = registry?.resolve(field.type.typeId, editorId);
    if (module === void 0) {
      throw new TypeError(registry?.problem(field.type.typeId, editorId) ?? `unsupported custom field type \xAB${field.type.typeId}\xBB`);
    }
    const control = await module.mount({
      container,
      field,
      initial: field.initial ?? "",
      signal
    });
    if (typeof control !== "object" || control === null || typeof control.read !== "function" || typeof control.validate !== "function") {
      throw new TypeError(`custom field editor for \xAB${field.type.typeId}\xBB returned no control`);
    }
    return control;
  }
  if (field.type.kind === "subject-ref" || field.type.kind === "asset-ref") {
    if (candidates !== void 0) {
      const target = candidateTargetForField(field.type);
      if (target === void 0)
        throw new TypeError("reference field has no selector target");
      const selector = await mountSubjectSelector(container, {
        candidates,
        target,
        initial: field.initialText,
        signal
      });
      return Object.freeze({
        read: () => fieldValue(field, selector.read()),
        validate: () => selector.validate(),
        unmount: () => selector.destroy()
      });
    }
    const unavailable = container.ownerDocument.createElement("input");
    unavailable.type = "text";
    unavailable.value = field.initialText;
    unavailable.disabled = true;
    unavailable.setAttribute("name", field.key);
    unavailable.setAttribute("aria-label", field.label);
    unavailable.setAttribute("part", "form.input");
    container.append(unavailable);
    return Object.freeze({
      read: () => fieldValue(field, unavailable.value),
      validate: () => "subject candidate source is unavailable",
      unmount: () => unavailable.remove()
    });
  }
  const document = container.ownerDocument;
  const input = field.type.kind === "enum" ? document.createElement("select") : field.type.kind === "script" || field.type.kind === "struct" || field.type.kind === "array" || field.type.kind === "record" || field.type.kind === "instructions" || field.type.kind === "json" ? document.createElement("textarea") : document.createElement("input");
  input.setAttribute("name", field.key);
  input.setAttribute("aria-label", field.label);
  input.setAttribute("part", "form.input");
  if (input instanceof HTMLSelectElement && field.type.kind === "enum") {
    for (const member of field.type.members) {
      const option = document.createElement("option");
      option.value = member.id;
      option.textContent = member.label ?? member.id;
      input.append(option);
    }
    input.value = field.initialText;
  } else if (input instanceof HTMLInputElement) {
    input.type = field.type.kind === "boolean" ? "checkbox" : field.type.kind === "number" ? "number" : "text";
    if (field.type.kind === "boolean")
      input.checked = field.initialText === "true";
    else
      input.value = field.initialText;
  } else {
    input.value = field.initialText;
  }
  container.append(input);
  return Object.freeze({
    read() {
      if (input instanceof HTMLInputElement && input.type === "checkbox")
        return input.checked;
      return fieldValue(field, input.value);
    },
    validate() {
      try {
        fieldValue(field, input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value);
        return void 0;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    unmount() {
      input.remove();
    }
  });
}
var object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var onlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
var nonEmptyString = (value) => typeof value === "string" && value.length > 0;
function validJson(value, ancestors = /* @__PURE__ */ new Set(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number")
    return Number.isFinite(value);
  if (typeof value !== "object" || depth > 64 || ancestors.has(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length > 0)
    return false;
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    if (Object.getOwnPropertyNames(value).length !== value.length + 1)
      return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === void 0 || descriptor.enumerable !== true || !("value" in descriptor) || !validJson(descriptor.value, next, depth + 1))
        return false;
    }
    return true;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.entries(descriptors).every(([, descriptor]) => descriptor.enumerable === true && "value" in descriptor && validJson(descriptor.value, next, depth + 1));
}
var validStringArray = (value) => Array.isArray(value) && value.every(nonEmptyString);
function validJsonSchemaRef(value) {
  return object(value) && onlyKeys(value, ["$ref", "document"]) && nonEmptyString(value["$ref"]) && (value["document"] === void 0 || validJson(value["document"]));
}
function validSubjectFilter(value) {
  if (!object(value) || !onlyKeys(value, ["type", "sameTypeAs", "text", "requireTags", "excludeTags", "predicate"]))
    return false;
  if (value["type"] !== void 0 && !nonEmptyString(value["type"]))
    return false;
  if (value["sameTypeAs"] !== void 0 && !nonEmptyString(value["sameTypeAs"]))
    return false;
  if (value["text"] !== void 0 && typeof value["text"] !== "string")
    return false;
  if (value["requireTags"] !== void 0 && !validStringArray(value["requireTags"]))
    return false;
  if (value["excludeTags"] !== void 0 && !validStringArray(value["excludeTags"]))
    return false;
  if (value["predicate"] !== void 0) {
    const predicate = value["predicate"];
    if (!object(predicate) || !onlyKeys(predicate, ["id", "params"]) || !nonEmptyString(predicate["id"]) || predicate["params"] !== void 0 && !validJson(predicate["params"]))
      return false;
  }
  return true;
}
function validFieldSchema(value, depth) {
  return object(value) && onlyKeys(value, ["key", "label", "type", "cardinality", "description", "knowledgeTarget"]) && nonEmptyString(value["key"]) && typeof value["label"] === "string" && validFieldType(value["type"], depth + 1) && (value["cardinality"] === void 0 || value["cardinality"] === "scalar" || value["cardinality"] === "append" || value["cardinality"] === "indexed") && (value["description"] === void 0 || typeof value["description"] === "string") && (value["knowledgeTarget"] === void 0 || isKnowledgeTarget(value["knowledgeTarget"]));
}
function validFieldType(type, depth = 0) {
  if (!object(type) || typeof type["kind"] !== "string" || depth > 16)
    return false;
  switch (type["kind"]) {
    case "text":
      return onlyKeys(type, ["kind", "multiline", "pattern", "maxLength"]) && (type["multiline"] === void 0 || typeof type["multiline"] === "boolean") && (type["pattern"] === void 0 || typeof type["pattern"] === "string") && (type["maxLength"] === void 0 || Number.isSafeInteger(type["maxLength"]) && Number(type["maxLength"]) >= 0);
    case "number":
      return onlyKeys(type, ["kind", "min", "max", "integer", "unit"]) && (type["min"] === void 0 || typeof type["min"] === "number" && Number.isFinite(type["min"])) && (type["max"] === void 0 || typeof type["max"] === "number" && Number.isFinite(type["max"])) && (type["integer"] === void 0 || typeof type["integer"] === "boolean") && (type["unit"] === void 0 || typeof type["unit"] === "string");
    case "boolean":
      return onlyKeys(type, ["kind"]);
    case "duration":
    case "date":
    case "bytes":
    case "id":
    case "path":
      return onlyKeys(type, ["kind"]);
    case "text-key":
      return onlyKeys(type, ["kind", "catalog"]) && (type["catalog"] === void 0 || nonEmptyString(type["catalog"]));
    case "script":
      return onlyKeys(type, ["kind", "language"]) && nonEmptyString(type["language"]);
    case "json":
      return onlyKeys(type, ["kind", "schema"]) && (type["schema"] === void 0 || validJsonSchemaRef(type["schema"]));
    case "enum":
    case "flags":
      return onlyKeys(type, type["kind"] === "enum" ? ["kind", "members", "unknown"] : ["kind", "members"]) && Array.isArray(type["members"]) && type["members"].every((member) => object(member) && onlyKeys(member, ["id", "label"]) && nonEmptyString(member["id"]) && (member["label"] === void 0 || typeof member["label"] === "string")) && new Set(type["members"].map((member) => object(member) ? member["id"] : void 0)).size === type["members"].length;
    case "color":
      return onlyKeys(type, ["kind", "model"]) && (type["model"] === "rgb" || type["model"] === "rgba" || type["model"] === "argb");
    case "vector":
      return onlyKeys(type, ["kind", "size", "unit"]) && (type["size"] === 2 || type["size"] === 3 || type["size"] === 4) && (type["unit"] === void 0 || typeof type["unit"] === "string");
    case "subject-ref":
      return onlyKeys(type, ["kind", "subjectKind", "filter"]) && nonEmptyString(type["subjectKind"]) && (type["filter"] === void 0 || validSubjectFilter(type["filter"]));
    case "asset-ref": {
      const accepts = type["accepts"];
      return onlyKeys(type, ["kind", "accepts"]) && object(accepts) && onlyKeys(accepts, ["formatIds", "traits"]) && (accepts["formatIds"] === void 0 || validStringArray(accepts["formatIds"])) && (accepts["traits"] === void 0 || validStringArray(accepts["traits"]));
    }
    case "struct": {
      const fields = type["fields"];
      return onlyKeys(type, ["kind", "fields"]) && Array.isArray(fields) && fields.every((field) => validFieldSchema(field, depth + 1)) && new Set(fields.map((field) => object(field) ? field["key"] : void 0)).size === fields.length;
    }
    case "array":
      return onlyKeys(type, ["kind", "item", "max"]) && validFieldType(type["item"], depth + 1) && (type["max"] === void 0 || Number.isSafeInteger(type["max"]) && Number(type["max"]) >= 0);
    case "record":
      return onlyKeys(type, ["kind", "key", "value"]) && validFieldType(type["key"], depth + 1) && validFieldType(type["value"], depth + 1);
    case "instructions": {
      const keywords = type["keywords"];
      return onlyKeys(type, ["kind", "keywords", "delimiter", "listDelimiter"]) && object(keywords) && typeof type["delimiter"] === "string" && (type["listDelimiter"] === void 0 || typeof type["listDelimiter"] === "string") && Object.values(keywords).every((fields) => Array.isArray(fields) && fields.every((field) => validFieldType(field, depth + 1)));
    }
    case "custom":
      return onlyKeys(type, ["kind", "typeId", "params"]) && nonEmptyString(type["typeId"]) && (type["params"] === void 0 || validJson(type["params"]));
    default:
      return false;
  }
}
function validWrites(value) {
  if (!object(value) || !onlyKeys(value, ["format", "encoding", "extension", "mediaType"])) {
    return false;
  }
  const named = (candidate) => object(candidate) && onlyKeys(candidate, ["id", "label"]) && nonEmptyString(candidate["id"]) && nonEmptyString(candidate["label"]);
  return named(value["format"]) && (value["encoding"] === void 0 || named(value["encoding"])) && nonEmptyString(value["extension"]) && nonEmptyString(value["mediaType"]);
}
function parseSchema(value) {
  if (!validJson(value) || !object(value) || !onlyKeys(value, ["schemaVersion", "forms"]) || value["schemaVersion"] !== 1 || !Array.isArray(value["forms"]) || value["forms"].length === 0)
    return void 0;
  const ids = /* @__PURE__ */ new Set();
  for (const form of value["forms"]) {
    if (!object(form) || !onlyKeys(form, ["id", "label", "summary", "binding", "fields", "baseInput", "writes"]) || typeof form["id"] !== "string" || form["id"].length === 0 || ids.has(form["id"]) || typeof form["label"] !== "string" || typeof form["summary"] !== "string" || !Array.isArray(form["fields"]) || // A preset (fixed `baseInput`, nothing to fill in) is the one form without controls.
    form["fields"].length === 0 && form["baseInput"] === void 0) {
      return void 0;
    }
    if (form["baseInput"] !== void 0 && (!object(form["baseInput"]) || Object.keys(form["baseInput"]).some((key) => key === "__proto__" || key === "constructor" || key === "prototype")))
      return void 0;
    if (form["writes"] !== void 0 && !validWrites(form["writes"]))
      return void 0;
    ids.add(form["id"]);
    if (form["binding"] !== void 0 && (!object(form["binding"]) || !onlyKeys(form["binding"], ["groupId", "entryKey"]) || !nonEmptyString(form["binding"]["groupId"]) || form["binding"]["entryKey"] !== void 0 && !nonEmptyString(form["binding"]["entryKey"]))) {
      return void 0;
    }
    const keys = /* @__PURE__ */ new Set();
    const paths = /* @__PURE__ */ new Set();
    for (const field of form["fields"]) {
      if (!object(field) || !onlyKeys(field, [
        "key",
        "label",
        "type",
        "cardinality",
        "description",
        "knowledgeTarget",
        "inputPath",
        "required",
        "initial",
        "source",
        "encoding"
      ]) || typeof field["key"] !== "string" || field["key"].length === 0 || keys.has(field["key"]) || typeof field["label"] !== "string" || !validFieldType(field["type"]) || field["cardinality"] !== void 0 && field["cardinality"] !== "scalar" && field["cardinality"] !== "append" && field["cardinality"] !== "indexed" || field["description"] !== void 0 && typeof field["description"] !== "string" || field["knowledgeTarget"] !== void 0 && !isKnowledgeTarget(field["knowledgeTarget"]) || !Array.isArray(field["inputPath"]) || field["inputPath"].length === 0 || field["inputPath"].some((segment) => !(typeof segment === "string" && segment.length > 0 || Number.isSafeInteger(segment) && Number(segment) >= 0)) || field["required"] !== void 0 && typeof field["required"] !== "boolean" || field["initial"] !== void 0 && !validJson(field["initial"]) || field["source"] !== void 0 && field["source"] !== "entry-key" && field["source"] !== "entry-value" || field["encoding"] !== void 0 && field["encoding"] !== "utf8-base64") {
        return void 0;
      }
      const firstSegment = field["inputPath"][0];
      if (object(form["baseInput"]) && (typeof firstSegment === "string" || typeof firstSegment === "number") && Object.hasOwn(form["baseInput"], firstSegment))
        return void 0;
      const path = JSON.stringify(field["inputPath"]);
      const segments = field["inputPath"];
      if (segments.some((segment) => typeof segment === "string" && (segment === "__proto__" || segment === "prototype" || segment === "constructor")) || paths.has(path) || [...paths].some((existing) => {
        const other = JSON.parse(existing);
        const common = Math.min(other.length, segments.length);
        return other.slice(0, common).every((segment, index) => segment === segments[index]) && other.length !== segments.length;
      }))
        return void 0;
      keys.add(field["key"]);
      paths.add(path);
    }
  }
  return value;
}
function metadataEntries(descriptor, groupId) {
  if (!("metadata" in descriptor))
    return [];
  return descriptor.metadata.find((group) => group.id === groupId)?.entries ?? [];
}
function selectedEntry(descriptor, form, operationId) {
  if (form.binding === void 0)
    return void 0;
  const entries = metadataEntries(descriptor, form.binding.groupId);
  const matches = (entry) => {
    const editable = entry.editable;
    return editable !== void 0 && "operation" in editable.write && editable.write.operation === operationId;
  };
  if (form.binding.entryKey !== void 0) {
    const entry = entries.find((item) => item.key === form.binding?.entryKey);
    return entry !== void 0 && matches(entry) ? entry : void 0;
  }
  return entries.find(matches);
}
function scalarText(value) {
  if (value === void 0 || value === null)
    return "";
  if (typeof value === "string")
    return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64OfUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at] ?? 0;
    const second = bytes[at + 1];
    const third = bytes[at + 2];
    const triple = first << 16 | (second ?? 0) << 8 | (third ?? 0);
    out += BASE64[triple >> 18 & 63] ?? "";
    out += BASE64[triple >> 12 & 63] ?? "";
    out += second === void 0 ? "=" : BASE64[triple >> 6 & 63] ?? "";
    out += third === void 0 ? "=" : BASE64[triple & 63] ?? "";
  }
  return out;
}
function setAtPath(root, path, value) {
  let current = root;
  path.forEach((segment, index) => {
    const last = index === path.length - 1;
    if (last) {
      ;
      current[segment] = value;
      return;
    }
    const next = path[index + 1];
    const child = typeof next === "number" ? [] : {};
    const existing = current[segment];
    if (existing === void 0)
      current[segment] = child;
    current = existing ?? child;
  });
}
function resolveForm(operation, spec, entry) {
  const fields = Object.freeze(spec.fields.map((field) => {
    const sourced = field.source === "entry-key" ? entry?.key : field.source === "entry-value" ? entry?.value : field.initial;
    const initialText = scalarText(sourced === null || sourced === void 0 ? field.initial : sourced);
    return Object.freeze({
      ...field,
      name: field.key,
      kind: field.encoding === "utf8-base64" ? "content" : "text",
      initial: initialText,
      ...field.description === void 0 ? {} : { hint: field.description },
      ...entry?.editable?.editor === void 0 ? {} : { editorId: entry.editable.editor },
      initialText
    });
  }));
  return Object.freeze({
    id: spec.id,
    label: spec.label,
    operationId: operation.id,
    handlerId: operation.handlerId,
    summary: spec.summary,
    fields,
    ...spec.writes === void 0 ? {} : { writes: spec.writes },
    build(values) {
      const input = spec.baseInput === void 0 ? {} : JSON.parse(JSON.stringify(spec.baseInput));
      for (const field of fields) {
        let value = values.get(field.key);
        if (value === void 0)
          value = field.initial ?? "";
        if (field.required === true && (value === "" || value === null)) {
          throw new TypeError(`${field.label} is required`);
        }
        value = fieldValue(field, value);
        if (field.encoding === "utf8-base64")
          value = base64OfUtf8(String(value ?? ""));
        setAtPath(input, field.inputPath, value);
      }
      if (operation.id === "edit.field") {
        if (spec.binding === void 0)
          throw new TypeError("field edit form has no editable binding");
        input["groupId"] = spec.binding.groupId;
        if (input["key"] === void 0)
          input["key"] = entry?.key ?? spec.binding.entryKey ?? "";
      }
      return input;
    }
  });
}
function operationForms(operationId, handlerId, inputSchemaDocument) {
  const schema = parseSchema(inputSchemaDocument);
  if (schema === void 0)
    return Object.freeze([]);
  const operation = { id: operationId, handlerId };
  return Object.freeze(schema.forms.map((spec) => resolveForm(operation, spec, void 0)));
}
function editOffer(descriptor, options) {
  if (!options.editable)
    return Object.freeze({ forms: [], unsupported: [] });
  const forms = [];
  const unsupported = [];
  for (const operation of descriptor.operations) {
    if (!operation.mutatesSource || operation.state !== "available")
      continue;
    const schema = parseSchema(operation.inputSchema?.document);
    if (schema === void 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: operation.inputSchema === void 0 ? "the operation did not publish an input schema" : "the published input schema is missing or malformed"
      });
      continue;
    }
    let rejected;
    for (const spec of schema.forms) {
      const entry = selectedEntry(descriptor, spec, operation.id);
      if (operation.id === "edit.field" && entry === void 0) {
        rejected = "the descriptor has no matching editable field binding";
        break;
      }
      if (entry !== void 0 && entry.type === void 0) {
        rejected = "the editable descriptor field has no field schema type";
        break;
      }
      for (const field of spec.fields) {
        if (field.type.kind === "custom") {
          const editorId = entry?.editable?.editor;
          const problem = options.fieldEditors?.problem(field.type.typeId, editorId);
          if (problem !== void 0 || options.fieldEditors?.resolve(field.type.typeId, editorId) === void 0) {
            rejected = problem ?? `unsupported custom field type \xAB${field.type.typeId}\xBB`;
            break;
          }
        }
      }
      if (rejected !== void 0)
        break;
      forms.push(resolveForm(operation, spec, entry));
    }
    if (rejected !== void 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: rejected
      });
    }
  }
  return Object.freeze({ forms: Object.freeze(forms), unsupported: Object.freeze(unsupported) });
}
function exportOffer(descriptor, operationId = "export.convert") {
  const forms = [];
  for (const operation of descriptor.operations) {
    if (operation.id !== operationId || operation.mutatesSource || operation.state !== "available")
      continue;
    const schema = parseSchema(operation.inputSchema?.document);
    for (const spec of schema?.forms ?? []) {
      if (spec.binding !== void 0 || spec.fields.some((field) => field.type.kind === "custom"))
        continue;
      forms.push(resolveForm(operation, spec, void 0));
    }
  }
  return Object.freeze(forms);
}
function declaredMutatingOperations(descriptor) {
  return descriptor.operations.filter((operation) => operation.mutatesSource);
}
var INVOKE_REASONS = Object.freeze({
  "not-declared": "this codec does not declare that operation",
  disabled: "the codec disabled this operation for this file",
  "dependency-required": "the operation needs a dependency this host has not resolved",
  "permission-missing": "this subject was opened without permission to write the file",
  "input-not-serializable": "the values could not be sent to the codec",
  "handler-unregistered": "the codec registered no handler for that operation",
  cancelled: "the operation was cancelled",
  "stale-revision": "the file changed after this tab opened it"
});
function invokeRefusalMessage(result) {
  const plain = INVOKE_REASONS[result.reason];
  const detail = result.diagnostics?.[0]?.message;
  const head = plain === void 0 ? result.reason : `${plain} (${result.reason})`;
  return detail === void 0 ? `refused: ${head}` : `refused: ${head} \u2014 ${detail}`;
}
function fidelityNote(plan) {
  if (plan.fidelity.preservesUnknownData)
    return "";
  const notes = plan.fidelity.notes ?? [];
  return notes.length === 0 ? " (this rewrite does not keep bytes the format does not account for)" : ` (${notes.join("; ")})`;
}
var isRejected = (result) => result.state === "rejected";

export {
  subjectCandidateProviderLease,
  mountFieldEditor,
  operationForms,
  editOffer,
  exportOffer,
  declaredMutatingOperations,
  invokeRefusalMessage,
  fidelityNote,
  isRejected
};
