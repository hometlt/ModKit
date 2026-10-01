import {
  EXPLORER_MAXIMUM_BYTES,
  WEB_EXTENSION_CATALOG,
  createCodecPreview,
  createScopedViewerSubjectNavigation,
  createSingleFileAccess,
  createWebEditingArm,
  createWebLocalizer,
  createWebPreviewFallback,
  createWebPreviewStages,
  createWebSubjectServices,
  describeEditability,
  isWritableHandle,
  nestedSubjectServices,
  openNestedSubjectRef,
  requestWriteAccess,
  resolveCommonPresentationPlan,
  resolveFormatWriter,
  sourceRevisionToken,
  sourceUriFor,
  stageIdOf
} from "./chunks/chunk-JZT64SHK.js";
import "./chunks/chunk-WQ4DVHS5.js";
import "./chunks/chunk-MXXWJZBP.js";
import "./chunks/chunk-6TP5P6JB.js";
import "./chunks/chunk-JPDEWO4S.js";
import "./chunks/chunk-O2DY4UGD.js";
import "./chunks/chunk-64G7DVXS.js";
import "./chunks/chunk-MVL6AV2G.js";
import "./chunks/chunk-Q27WXNQ4.js";
import "./chunks/chunk-QQJVD7VT.js";
import "./chunks/chunk-PAU2QRE2.js";
import "./chunks/chunk-RNSUXHQ3.js";
import {
  element,
  setPart,
  setState,
  setViewerText
} from "./chunks/chunk-N263OVTM.js";
import {
  parseSubjectRef,
  revisionId,
  serializeSubjectRef
} from "./chunks/chunk-BPQHTKO4.js";
import {
  define_MODKIT_EMBED_EXTENSION_ORIGINS_default,
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunks/chunk-BLWUC7LO.js";

// apps/web/src/embed.ts
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var MODKIT_VIEWER_TAG = "modkit-viewer";
var EMBED_MAXIMUM_BYTES = EXPLORER_MAXIMUM_BYTES;
var EMBED_CHROME_CSS = `
:host {
  display: block;
  box-sizing: border-box;
  min-block-size: 12rem;
  color: initial;
  font: initial;
  letter-spacing: initial;
  word-spacing: initial;
  text-align: initial;
  text-indent: initial;
  text-transform: initial;
  text-shadow: initial;
  white-space: initial;
  list-style: initial;
  tab-size: initial;
}
:host([hidden]) {
  display: none;
}
.modkit-embed {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-2);
  box-sizing: border-box;
  block-size: 100%;
  min-block-size: inherit;
  padding: var(--mk-space-2);
  color: var(--mk-color-fg);
  background: var(--mk-color-surface);
  border: 1px solid var(--mk-color-border);
  border-radius: var(--mk-radius-md);
  font-family: var(--mk-font-sans);
  font-size: var(--mk-font-size-md);
  line-height: var(--mk-line-normal);
}
.modkit-embed__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-2);
}
.modkit-embed__title {
  overflow: hidden;
  color: var(--mk-color-fg-muted);
  font-size: var(--mk-font-size-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.modkit-embed__stage {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow: auto;
}
.modkit-embed__status {
  color: var(--mk-color-fg-muted);
  font-size: var(--mk-font-size-sm);
}
.modkit-embed__status[data-mk-state~='error'] {
  padding: var(--mk-space-2);
  color: var(--mk-status-error-fg);
  border: 1px solid var(--mk-status-error-border);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-status-error-bg);
}
.modkit-embed__status[hidden] {
  display: none;
}
`;
var describe = (error) => error instanceof Error ? error.message : String(error);
var compiledExtensionOrigins = typeof define_MODKIT_EMBED_EXTENSION_ORIGINS_default === "undefined" ? [] : define_MODKIT_EMBED_EXTENSION_ORIGINS_default;
var EMBED_EXTENSION_ORIGINS = Object.freeze(
  Array.isArray(compiledExtensionOrigins) ? compiledExtensionOrigins.flatMap((value) => {
    if (typeof value !== "string") return [];
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? [url.origin] : [];
    } catch {
      return [];
    }
  }) : []
);
function resolveExtensionCatalogUrl(attribute, documentBase) {
  return new URL(attribute, documentBase).href;
}
function extensionCatalogRefusal(catalogUrl, allowedOrigins = EMBED_EXTENSION_ORIGINS, localizer = createWebLocalizer("en")) {
  let url;
  try {
    url = new URL(catalogUrl);
  } catch {
    return localizer.text("web.embed.catalog.invalidUrl", { url: catalogUrl });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return localizer.text("web.embed.catalog.protocol", { protocol: url.protocol });
  }
  const allowed = new Set(
    allowedOrigins.flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    })
  );
  if (allowed.has(url.origin)) return void 0;
  return localizer.text("web.embed.catalog.origin", { origin: url.origin });
}
var record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
var digest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
var pairs = (value, check) => Array.isArray(value) && value.every(
  (item) => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && check(item[1])
);
function parseWebExtensionCatalog(value, localizer = createWebLocalizer("en")) {
  if (!record(value) || value["schemaVersion"] !== 1 || !Array.isArray(value["extensions"]) || !Array.isArray(value["excluded"])) {
    throw new TypeError(localizer.text("web.embed.catalog.schema"));
  }
  for (const excluded of value["excluded"]) {
    if (!record(excluded) || typeof excluded["name"] !== "string" || typeof excluded["reason"] !== "string") {
      throw new TypeError(localizer.text("web.embed.catalog.exclusion"));
    }
  }
  for (const entry of value["extensions"]) {
    if (!record(entry) || typeof entry["name"] !== "string" || typeof entry["source"] !== "string" || typeof entry["artifactRoot"] !== "string" || !record(entry["containers"]) || !strings(entry["files"]) || !pairs(entry["documents"], () => true) || !pairs(entry["documentDigests"], digest) || !record(entry["artifact"]) || typeof entry["artifact"]["inventoryRecordId"] !== "string" || !digest(entry["artifact"]["artifactDigest"]) || !record(entry["artifact"]["fileDigests"]) || !Object.values(entry["artifact"]["fileDigests"]).every(digest)) {
      throw new TypeError(localizer.text("web.embed.catalog.malformed"));
    }
  }
  return value;
}
function resolveAssetBase(attribute, scriptUrl, documentBase) {
  const resolved = attribute === void 0 || attribute === "" ? new URL("./", scriptUrl) : new URL(attribute, documentBase);
  const href = resolved.href;
  return href.endsWith("/") ? href : `${href}/`;
}
function crossOriginRefusal(assetBase, pageOrigin, localizer = createWebLocalizer("en")) {
  let origin;
  try {
    origin = new URL(assetBase).origin;
  } catch {
    return localizer.text("web.embed.asset.invalidUrl", { base: assetBase });
  }
  if (origin === pageOrigin) return void 0;
  return localizer.text("web.embed.asset.crossOrigin", { origin, pageOrigin });
}
function displayNameFor(src, name, documentBase) {
  if (name !== void 0 && name !== "") return name;
  if (src === void 0 || src === "") return "file";
  try {
    const last = new URL(src, documentBase).pathname.split("/").pop();
    return last === void 0 || last === "" ? "file" : decodeURIComponent(last);
  } catch {
    return "file";
  }
}
function preferStage(stages, preferred) {
  if (preferred === void 0 || preferred === "") return stages;
  const chosen = stages.filter((stage) => stageIdOf(stage) === preferred);
  if (chosen.length === 0) return stages;
  return Object.freeze([...chosen, ...stages.filter((stage) => stageIdOf(stage) !== preferred)]);
}
function shareByAssetBase(cache, assetBase, create) {
  const known = cache.get(assetBase);
  if (known !== void 0) return known;
  const created = create(assetBase);
  cache.set(assetBase, created);
  created.catch(() => cache.delete(assetBase));
  return created;
}
var embedHosts = /* @__PURE__ */ new Map();
var embedLifecycleScopes = /* @__PURE__ */ new WeakSet();
async function disposeEmbedHosts() {
  const pending = [...embedHosts.values()];
  embedHosts.clear();
  const settled = await Promise.allSettled(pending);
  await Promise.allSettled(
    settled.flatMap((item) => item.status === "fulfilled" ? [item.value.services.dispose()] : [])
  );
}
function installEmbedHostLifecycle(scope = globalThis) {
  if (embedLifecycleScopes.has(scope) || scope.addEventListener === void 0) return false;
  embedLifecycleScopes.add(scope);
  scope.addEventListener("pagehide", () => void disposeEmbedHosts(), { once: true });
  return true;
}
var descriptorKey = (descriptor) => `${descriptor.subjectUri} :: ${descriptor.revision}`;
async function loadStyles(assetBase, localizer) {
  const response = await fetch(new URL("modkit-ui.css", assetBase).href);
  if (!response.ok) {
    throw new Error(
      localizer.text("web.embed.stylesFetch", { base: assetBase, status: response.status })
    );
  }
  const text = `${await response.text()}
${EMBED_CHROME_CSS}`;
  if (typeof CSSStyleSheet !== "function") return { text };
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return { sheets: Object.freeze([sheet]), text };
  } catch {
    return { text };
  }
}
async function fetchExtensionCatalog(catalogUrl, localizer) {
  let response;
  try {
    response = await fetch(catalogUrl, { credentials: "omit" });
  } catch (error) {
    throw new Error(
      localizer.text("web.embed.catalogFetch", { url: catalogUrl, reason: describe(error) })
    );
  }
  if (!response.ok) {
    throw new Error(
      localizer.text("web.embed.catalogHttp", {
        url: catalogUrl,
        status: response.status,
        statusText: response.statusText
      })
    );
  }
  try {
    return parseWebExtensionCatalog(await response.json(), localizer);
  } catch (error) {
    throw new Error(
      localizer.text("web.embed.catalogInvalid", { url: catalogUrl, reason: describe(error) })
    );
  }
}
async function composeEmbedHost(assetBase, extensionCatalogUrl) {
  const localizer = createWebLocalizer(
    globalThis.document?.documentElement.lang || globalThis.navigator?.languages
  );
  const additionalCatalogs = extensionCatalogUrl === void 0 ? [] : [
    {
      catalog: await fetchExtensionCatalog(extensionCatalogUrl, localizer),
      baseUrl: extensionCatalogUrl
    }
  ];
  const services = await createWebSubjectServices({
    baseUrl: assetBase,
    catalog: WEB_EXTENSION_CATALOG,
    additionalCatalogs,
    identity: embedIdentity(),
    dom: {
      fetch: (url, init) => fetch(url, init),
      subtle: {
        digest: (algorithm, data) => crypto.subtle.digest(algorithm, data)
      },
      // the structural DOM shapes take readonly parts / any blob; the platform types are wider
      Blob,
      objectUrls: URL,
      Worker,
      MessageChannel
    }
  });
  const operations = /* @__PURE__ */ new Map();
  const stages = createWebPreviewStages({
    localizer,
    renderer: services.renderer,
    operationsFor: (descriptor) => operations.get(descriptorKey(descriptor))
  });
  const styles = await loadStyles(assetBase, localizer);
  return Object.freeze({
    assetBase,
    services,
    stages,
    fallback: createWebPreviewFallback(localizer),
    localizer,
    styles,
    operations
  });
}
function embedHostFor(assetBase, extensionCatalogUrl) {
  installEmbedHostLifecycle();
  const key = JSON.stringify([assetBase, extensionCatalogUrl ?? null]);
  return shareByAssetBase(embedHosts, key, () => composeEmbedHost(assetBase, extensionCatalogUrl));
}
function embedIdentity() {
  const agent = navigator.userAgent;
  const operatingSystem = agent.includes("Windows") ? "windows" : agent.includes("Mac") ? "darwin" : "linux";
  return { operatingSystem, architecture: "x64" };
}
function fileLikeFrom(blob, fallbackName) {
  const name = blob.name === void 0 || blob.name === "" ? fallbackName : blob.name;
  return {
    name,
    size: blob.size,
    lastModified: blob.lastModified ?? 0,
    slice: (start, end) => blob.slice(start, end)
  };
}
function bytesSource(name, bytes, token, sourceUri) {
  const uri = sourceUri ?? `memory://modkit-embed/${encodeURIComponent(name)}`;
  return {
    kind: "bytes",
    ref: { id: uri, uri },
    revision: revisionId(token),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      const start = Number(offset);
      return bytes.slice(start, Math.min(bytes.byteLength, start + length));
    },
    async *stream(range) {
      const start = Number(range?.offset ?? 0n);
      const end = range?.length === void 0 ? bytes.byteLength : start + Number(range.length);
      yield bytes.slice(start, Math.min(bytes.byteLength, end));
    }
  };
}
var openCount = 0;
async function embedPreviewSession(host, opened, grant, budget, sessionId, onNavigate, preferred) {
  const session = opened.session;
  const key = descriptorKey(opened.descriptor);
  const operations = session.operations();
  host.operations.set(key, operations);
  const currentSubject = parseSubjectRef(opened.descriptor.subjectUri);
  const managed = onNavigate === void 0 ? void 0 : createScopedViewerSubjectNavigation({
    scope: {
      sessionId,
      subject: opened.descriptor.subjectUri,
      ...currentSubject.workspace === void 0 ? {} : { workspace: currentSubject.workspace }
    },
    async open(target, signal) {
      const nested = await openNestedSubjectRef({
        parent: opened.session,
        targetSubject: target,
        ...nestedSubjectServices(host.services),
        grant,
        budget,
        signal
      });
      if (nested?.result.state !== "opened")
        return { state: "rejected", reason: "target-unavailable" };
      openCount += 1;
      const child = await embedPreviewSession(
        host,
        nested.result,
        grant,
        budget,
        `modkit-embed-${openCount}`,
        onNavigate
      );
      try {
        await onNavigate(serializeSubjectRef(target), child);
        return { state: "opened" };
      } catch (error) {
        await child.dispose().catch(() => void 0);
        throw error;
      }
    }
  });
  const plannedDefault = (await resolveCommonPresentationPlan(
    await session.descriptor(),
    {
      sessionId,
      providerId: opened.selected.contributionId,
      variantId: opened.selected.variantId
    },
    { availableStageIds: host.stages.map(stageIdOf) }
  ))?.plan.activeStage;
  const defaultStages = [
    ...preferred === void 0 ? [] : [preferred],
    ...plannedDefault === void 0 ? [] : [plannedDefault]
  ];
  let disposed = false;
  return {
    opened,
    grant,
    budget,
    defaultStages,
    ...managed === void 0 ? {} : { subjectNavigation: managed.port },
    descriptor: () => session.descriptor(),
    dataSource: (contract, major) => session.dataSource(contract, major),
    async operations() {
      return operations;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      managed?.dispose();
      host.operations.delete(key);
      await session.dispose();
    }
  };
}
async function openEmbedSession(host, entry, bytes, options, signal) {
  openCount += 1;
  const grant = {
    id: `modkit-embed-${openCount}`,
    classes: options.writable ? ["read-source", "write-source"] : ["read-source"]
  };
  const budget = {
    maxInputBytes: BigInt(EMBED_MAXIMUM_BYTES),
    maxDepth: 256,
    maxNodes: 1e6,
    maxScalarBytes: 64 * 1024 * 1024,
    maxDiagnostics: 1e4,
    deadlineMs: 3e4
  };
  const result = await host.services.open({
    source: bytesSource(entry.name, bytes, options.token, options.sourceUri),
    path: entry.name,
    intent: "full",
    grant,
    budget,
    ...signal === void 0 ? {} : { signal }
  });
  if (result.state === "unresolved") return void 0;
  return embedPreviewSession(
    host,
    result,
    grant,
    budget,
    `modkit-embed-${openCount}`,
    options.onNavigate,
    options.preferred
  );
}
var RELOADING_ATTRIBUTES = Object.freeze(["src", "name", "asset-base", "extension-catalog"]);
var OBSERVED_ATTRIBUTES = Object.freeze([
  ...RELOADING_ATTRIBUTES,
  "view",
  "data-mk-theme",
  "data-mk-density"
]);
function defineModkitElements(options = {}) {
  const tagName = options.tagName ?? MODKIT_VIEWER_TAG;
  const registry = options.registry ?? globalThis.customElements;
  const base = globalThis.HTMLElement;
  if (registry === void 0 || typeof base !== "function") {
    throw new TypeError("modkit elements need a DOM with customElements and HTMLElement");
  }
  if (registry.get(tagName) !== void 0) return tagName;
  const defaultAssetBase = options.assetBase ?? import.meta.url;
  const localizer = createWebLocalizer(
    globalThis.document?.documentElement.lang || globalThis.navigator?.languages
  );
  class ModkitViewerElement extends base {
    static get observedAttributes() {
      return OBSERVED_ATTRIBUTES;
    }
    #shadow;
    #frame;
    #title;
    #picker;
    #stage;
    #status;
    #handle;
    #retainedHandles = [];
    #abort;
    #blob;
    #fileHandle;
    #editing;
    #styled = false;
    /** Bumped by every load; a load whose token is stale mounts nothing. */
    #generation = 0;
    constructor() {
      super();
      this.#shadow = this.attachShadow({ mode: "open" });
      const document = this.ownerDocument;
      const frame = document.createElement("div");
      frame.className = "modkit-embed";
      const header = document.createElement("div");
      header.className = "modkit-embed__header";
      setPart(header, "explorer.header");
      const title = element(header, "span", { part: "explorer.breadcrumb" });
      title.className = "modkit-embed__title";
      const picker = document.createElement("select");
      picker.className = "modkit-embed__picker";
      picker.hidden = true;
      picker.setAttribute("aria-label", localizer.text("web.embed.view"));
      setPart(picker, "viewpicker.select");
      header.append(picker);
      const stage = document.createElement("div");
      stage.className = "modkit-embed__stage";
      setPart(stage, "explorer.stage");
      const status = document.createElement("output");
      status.className = "modkit-embed__status";
      setPart(status, "explorer.status");
      frame.append(header, stage, status);
      this.#shadow.append(frame);
      this.#frame = frame;
      this.#title = title;
      this.#picker = picker;
      this.#stage = stage;
      this.#status = status;
      picker.addEventListener("change", () => {
        void this.#show(picker.value);
      });
    }
    /**
     * Bytes supplied by the page instead of `src` — a `File` from its own picker, a `Blob` it
     * built. Setting it reloads; `src` is ignored while it is set, because a page that handed us
     * bytes meant those bytes.
     */
    get file() {
      return this.#blob;
    }
    set file(value) {
      this.#blob = value;
      if (value !== void 0) this.#fileHandle = void 0;
      if (this.isConnected) void this.#load();
    }
    /**
     * A File System Access handle explicitly delegated by the embedding page. Unlike `file`, this
     * may carry write authority; editable stages are offered only when `createWritable` exists.
     */
    get fileHandle() {
      return this.#fileHandle;
    }
    set fileHandle(value) {
      this.#fileHandle = value;
      if (value !== void 0) this.#blob = void 0;
      if (this.isConnected) void this.#load();
    }
    /** The preferred stage id, reflected to the `view` attribute. */
    get view() {
      return this.getAttribute("view") ?? "";
    }
    set view(value) {
      if (value === "") this.removeAttribute("view");
      else this.setAttribute("view", value);
    }
    /** The stage on screen right now, or `''` before anything mounted. */
    get activeView() {
      return this.#handle?.activeView ?? "";
    }
    /** Stages this subject can be shown as, in the order the picker offers them. */
    get views() {
      return this.#handle?.views ?? [];
    }
    connectedCallback() {
      this.#mirrorAppearance();
      void this.#load();
    }
    disconnectedCallback() {
      this.#generation += 1;
      this.#abort?.abort();
      this.#abort = void 0;
      void this.#unmount();
    }
    attributeChangedCallback(name, previous, next) {
      if (previous === next) return;
      if (name === "data-mk-theme" || name === "data-mk-density") {
        this.#mirrorAppearance();
        return;
      }
      if (!this.isConnected) return;
      if (name === "view") {
        const wanted = next ?? "";
        if (this.#handle?.views.some((view) => view.id === wanted) === true) {
          void this.#show(wanted);
          return;
        }
      }
      if (name !== "view" && !RELOADING_ATTRIBUTES.includes(name)) return;
      void this.#load();
    }
    /**
     * Theme and density, copied from the element onto the frame.
     *
     * `data-mk-theme` is answered by `:host([data-mk-theme='…'])` in the rewritten sheet, so the
     * element alone would do — but `data-mk-density` is authored as a bare attribute selector
     * (`[data-mk-density='compact']`), which cannot match a shadow host from inside the tree. The
     * frame carries both so one attribute on the element reaches every viewer under it.
     */
    #mirrorAppearance() {
      for (const name of ["data-mk-theme", "data-mk-density"]) {
        const value = this.getAttribute(name);
        if (value === null) this.#frame.removeAttribute(name);
        else this.#frame.setAttribute(name, value);
      }
    }
    #say(message, state) {
      setViewerText(this.#status, message, 2e3);
      this.#status.hidden = message === "";
      setState(this.#status, state === "error" ? ["error"] : []);
      this.setAttribute("data-mk-state", state);
    }
    #fail(reason) {
      this.#say(reason, "error");
      this.dispatchEvent(
        new CustomEvent("modkit-viewer-error", { detail: { reason }, bubbles: false })
      );
    }
    async #unmount() {
      const handle = this.#handle;
      const retained = this.#retainedHandles.splice(0);
      const editing = this.#editing;
      this.#handle = void 0;
      this.#editing = void 0;
      this.removeAttribute("data-mk-dirty");
      this.#picker.hidden = true;
      this.#picker.replaceChildren();
      if (handle !== void 0) {
        try {
          await handle.unmount();
        } catch (error) {
          console.warn("[modkit-viewer] unmount failed", error);
        }
      }
      for (const previous of retained) {
        try {
          await previous.unmount();
        } catch (error) {
          console.warn("[modkit-viewer] retained subject unmount failed", error);
        }
      }
      await editing?.dispose();
      this.#stage.replaceChildren();
    }
    async #show(viewId) {
      const handle = this.#handle;
      if (handle === void 0 || viewId === "" || handle.activeView === viewId) return;
      try {
        await handle.show(viewId);
        this.#picker.value = handle.activeView;
      } catch (error) {
        this.#fail(
          localizer.text("web.embed.stageFailed", { view: viewId, reason: describe(error) })
        );
      }
    }
    /** The bytes to open: the `file` property when the page set one, else `src`. */
    async #read(name, signal) {
      const fileHandle = this.#fileHandle;
      if (fileHandle !== void 0) return fileHandle.getFile();
      const blob = this.#blob;
      if (blob !== void 0) return fileLikeFrom(blob, name);
      const src = this.getAttribute("src") ?? "";
      const target = new URL(src, this.ownerDocument.baseURI);
      let response;
      try {
        response = await fetch(target.href, { signal });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(
          localizer.text("web.embed.fileFetch", {
            url: target.href,
            reason: describe(error)
          })
        );
      }
      if (!response.ok) {
        throw new Error(
          localizer.text("web.embed.fileHttp", {
            url: target.href,
            status: response.status,
            statusText: response.statusText
          })
        );
      }
      return fileLikeFrom(await response.blob(), name);
    }
    async #load() {
      const generation = this.#generation += 1;
      this.#abort?.abort();
      const controller = new AbortController();
      this.#abort = controller;
      const current = () => generation === this.#generation && !controller.signal.aborted;
      await this.#unmount();
      const name = displayNameFor(
        this.getAttribute("src") ?? void 0,
        this.getAttribute("name") ?? void 0,
        this.ownerDocument.baseURI
      );
      setViewerText(this.#title, name, 300);
      if (this.#fileHandle === void 0 && this.#blob === void 0 && (this.getAttribute("src") ?? "") === "") {
        this.#say(localizer.text("web.embed.waiting"), "empty");
        return;
      }
      this.#say(localizer.text("web.embed.loading", { name }), "loading");
      try {
        const assetBase = resolveAssetBase(
          this.getAttribute("asset-base") ?? void 0,
          defaultAssetBase,
          this.ownerDocument.baseURI
        );
        const refusal = crossOriginRefusal(
          assetBase,
          this.ownerDocument.location?.origin ?? "",
          localizer
        );
        if (refusal !== void 0) {
          this.#fail(refusal);
          return;
        }
        const catalogAttribute = this.getAttribute("extension-catalog") ?? "";
        let extensionCatalogUrl;
        if (catalogAttribute !== "") {
          try {
            extensionCatalogUrl = resolveExtensionCatalogUrl(
              catalogAttribute,
              this.ownerDocument.baseURI
            );
          } catch {
            this.#fail(
              localizer.text("web.embed.catalogAttributeInvalid", { url: catalogAttribute })
            );
            return;
          }
          const catalogRefusal = extensionCatalogRefusal(
            extensionCatalogUrl,
            EMBED_EXTENSION_ORIGINS,
            localizer
          );
          if (catalogRefusal !== void 0) {
            this.#fail(catalogRefusal);
            return;
          }
        }
        const host = await embedHostFor(assetBase, extensionCatalogUrl);
        if (!current()) return;
        this.#applyStyles(host.styles);
        const file = await this.#read(name, controller.signal);
        if (!current()) return;
        setViewerText(this.#title, file.name, 300);
        if (file.size > EMBED_MAXIMUM_BYTES) {
          this.#fail(
            localizer.text("web.embed.tooLarge", {
              name,
              size: file.size,
              limit: EMBED_MAXIMUM_BYTES
            })
          );
          return;
        }
        const fileHandle = this.#fileHandle;
        const { access, entry } = createSingleFileAccess(file, fileHandle);
        const snapshot = await access.snapshotOf(entry.id, controller.signal);
        const bytes = await access.read(entry.id, EMBED_MAXIMUM_BYTES, controller.signal);
        if (!current()) return;
        const editability = await describeEditability(access, entry.id, entry.name, localizer);
        const writable = editability.editable && snapshot !== void 0 && isWritableHandle(fileHandle);
        const token = snapshot === void 0 ? `provider-token:embed-${generation}-${bytes.byteLength}` : sourceRevisionToken(snapshot);
        const writableHandles = /* @__PURE__ */ new Map();
        const sourceUri = writable ? sourceUriFor(entry.id) : void 0;
        if (writable && sourceUri !== void 0) writableHandles.set(sourceUri, fileHandle);
        let editorPorts;
        if (writable) {
          const editing = createWebEditingArm({
            localizer,
            inventory: host.services.main.inventory,
            handleFor: (sourceId) => writableHandles.get(sourceId),
            onNotice: (message) => {
              if (!current()) return;
              this.#say(message, "ready");
              this.dispatchEvent(
                new CustomEvent("modkit-viewer-edit-status", {
                  detail: { message },
                  bubbles: false
                })
              );
            },
            onDirty: (_entryId, dirty) => {
              if (!current()) return;
              if (dirty) this.setAttribute("data-mk-dirty", "");
              else this.removeAttribute("data-mk-dirty");
            },
            async ensureWriteAccess() {
              const currentAccess = await describeEditability(
                access,
                entry.id,
                entry.name,
                localizer
              );
              if (currentAccess.state === "granted" || currentAccess.state === "no-permission-surface")
                return "granted";
              if (currentAccess.state !== "prompt") return "denied";
              const asked = await requestWriteAccess(access, localizer);
              return asked.state === "granted" ? "granted" : asked.state === "denied" ? "denied" : "prompt";
            }
          });
          this.#editing = editing;
        }
        let preopened;
        let previewer;
        const openNavigatedSubject = async (target, session) => {
          if (!current() || preopened !== void 0) {
            await session.dispose();
            throw new Error("subject navigation target is unavailable in this viewer");
          }
          preopened = { target, session };
          const previous = this.#handle;
          try {
            const handle2 = await previewer.open(
              this.#stage,
              { id: target, name: target, directory: false },
              new Uint8Array(),
              controller.signal
            );
            if (handle2 === void 0) throw new Error("subject navigation target has no viewer");
            if (previous !== void 0) this.#retainedHandles.push(previous);
            this.#handle = handle2;
            setViewerText(this.#title, target, 300);
            this.#drawPicker(handle2);
          } finally {
            if (preopened?.session === session) preopened = void 0;
          }
        };
        const preferredView = this.getAttribute("view");
        previewer = createCodecPreview({
          supported: host.services.supportedExtensions,
          stages: preferStage(host.stages, preferredView ?? void 0),
          fallback: host.fallback,
          editorPorts: () => editorPorts,
          openSession: async (openedEntry, openedBytes, signal) => {
            const navigated = preopened?.target === openedEntry.id ? preopened.session : void 0;
            if (navigated !== void 0) preopened = void 0;
            const session = navigated ?? await openEmbedSession(
              host,
              openedEntry,
              openedBytes,
              {
                token,
                writable,
                onNavigate: openNavigatedSubject,
                ...preferredView === null ? {} : { preferred: preferredView },
                ...sourceUri === void 0 ? {} : { sourceUri }
              },
              signal
            );
            if (session !== void 0 && writable) {
              const writerResolution = await resolveFormatWriter({
                services: host.services.main,
                opened: session.opened,
                grant: session.grant,
                budgets: session.budget
              });
              editorPorts = this.#editing?.editorFor({
                entryId: entry.id,
                name: entry.name,
                opened: session.opened,
                grant: session.grant,
                bytes,
                ...writerResolution.writer === void 0 ? {} : { writer: writerResolution.writer }
              })?.ports;
              if (editorPorts === void 0) await writerResolution.release?.();
              else if (writerResolution.release !== void 0) {
                const dispose = session.dispose.bind(session);
                return {
                  ...session,
                  async dispose() {
                    await writerResolution.release?.();
                    await dispose();
                  }
                };
              }
            }
            return session;
          }
        });
        const handle = await previewer.open(this.#stage, entry, bytes, controller.signal);
        if (!current()) {
          await handle?.unmount();
          return;
        }
        if (handle === void 0) {
          this.#fail(localizer.text("web.embed.noStage", { name }));
          return;
        }
        this.#handle = handle;
        this.#drawPicker(handle);
        this.#say("", "ready");
        this.dispatchEvent(
          new CustomEvent("modkit-viewer-ready", {
            detail: { name, view: handle.activeView, views: handle.views.map((view) => view.id) },
            bubbles: false
          })
        );
      } catch (error) {
        if (!current()) return;
        this.#fail(`${name}: ${describe(error)}`);
      }
    }
    #drawPicker(handle) {
      this.#picker.replaceChildren();
      for (const view of handle.views) {
        const option = this.ownerDocument.createElement("option");
        option.value = view.id;
        setViewerText(option, view.label, 128);
        this.#picker.append(option);
      }
      this.#picker.value = handle.activeView;
      this.#picker.hidden = handle.views.length < 2;
    }
    #applyStyles(styles) {
      if (this.#styled) return;
      this.#styled = true;
      const sheets = styles.sheets;
      if (sheets !== void 0) {
        this.#shadow.adoptedStyleSheets = [...sheets];
        return;
      }
      const style = this.ownerDocument.createElement("style");
      style.textContent = styles.text;
      this.#shadow.prepend(style);
    }
  }
  registry.define(tagName, ModkitViewerElement);
  return tagName;
}
if (typeof globalThis.customElements !== "undefined" && typeof globalThis.HTMLElement === "function")
  defineModkitElements();
export {
  EMBED_CHROME_CSS,
  EMBED_EXTENSION_ORIGINS,
  EMBED_MAXIMUM_BYTES,
  MODKIT_VIEWER_TAG,
  crossOriginRefusal,
  defineModkitElements,
  displayNameFor,
  disposeEmbedHosts,
  embedHostFor,
  extensionCatalogRefusal,
  fileLikeFrom,
  installEmbedHostLifecycle,
  openEmbedSession,
  parseWebExtensionCatalog,
  preferStage,
  resolveAssetBase,
  resolveExtensionCatalogUrl,
  shareByAssetBase
};
