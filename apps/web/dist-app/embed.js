import {
  EXPLORER_MAXIMUM_BYTES,
  WEB_EXTENSION_CATALOG,
  WEB_PREVIEW_FALLBACK,
  createCodecPreview,
  createSingleFileAccess,
  createWebPreviewStages,
  createWebSubjectServices,
  element,
  revisionId,
  setPart,
  setState,
  setViewerText,
  stageIdOf
} from "./chunks/chunk-SICN3ZNF.js";

// apps/web/src/embed.ts
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
function resolveAssetBase(attribute, scriptUrl, documentBase) {
  const resolved = attribute === void 0 || attribute === "" ? new URL("./", scriptUrl) : new URL(attribute, documentBase);
  const href = resolved.href;
  return href.endsWith("/") ? href : `${href}/`;
}
function crossOriginRefusal(assetBase, pageOrigin) {
  let origin;
  try {
    origin = new URL(assetBase).origin;
  } catch {
    return `asset-base \xAB${assetBase}\xBB is not a URL this page can resolve.`;
  }
  if (origin === pageOrigin) return void 0;
  return `The modkit assets at ${origin} are cross-origin to this page (${pageOrigin}). A module worker script is fetched in same-origin mode, so no CORS header can make that work: serve the modkit assets from this origin (copy or reverse-proxy them) and point asset-base there.`;
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
var descriptorKey = (descriptor) => `${descriptor.subjectUri} :: ${descriptor.revision}`;
async function loadStyles(assetBase) {
  const response = await fetch(new URL("modkit-ui.css", assetBase).href);
  if (!response.ok) {
    throw new Error(`modkit-ui.css could not be fetched from ${assetBase} (${response.status})`);
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
async function composeEmbedHost(assetBase) {
  const services = await createWebSubjectServices({
    baseUrl: assetBase,
    catalog: WEB_EXTENSION_CATALOG,
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
    operationsFor: (descriptor) => operations.get(descriptorKey(descriptor))
  });
  const styles = await loadStyles(assetBase);
  return Object.freeze({ assetBase, services, stages, styles, operations });
}
function embedHostFor(assetBase) {
  return shareByAssetBase(embedHosts, assetBase, composeEmbedHost);
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
function bytesSource(name, bytes, token) {
  const uri = `memory://modkit-embed/${encodeURIComponent(name)}`;
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
async function openEmbedSession(host, entry, bytes, signal) {
  openCount += 1;
  const result = await host.services.open({
    source: bytesSource(entry.name, bytes, `provider-token:embed-${openCount}-${bytes.byteLength}`),
    path: entry.name,
    intent: "full",
    grant: { id: `modkit-embed-${openCount}`, classes: ["read-source"] },
    budget: {
      maxInputBytes: BigInt(EMBED_MAXIMUM_BYTES),
      maxDepth: 256,
      maxNodes: 1e6,
      maxScalarBytes: 64 * 1024 * 1024,
      maxDiagnostics: 1e4,
      deadlineMs: 3e4
    },
    ...signal === void 0 ? {} : { signal }
  });
  if (result.state === "unresolved") return void 0;
  const session = result.session;
  const key = descriptorKey(result.descriptor);
  const operations = session.operations();
  host.operations.set(key, operations);
  return {
    descriptor: () => session.descriptor(),
    dataSource: (contract, major) => session.dataSource(contract, major),
    async operations() {
      return operations;
    },
    async dispose() {
      host.operations.delete(key);
      await session.dispose();
    }
  };
}
var RELOADING_ATTRIBUTES = Object.freeze(["src", "name", "asset-base"]);
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
    #abort;
    #blob;
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
      picker.setAttribute("aria-label", "View");
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
      this.#handle = void 0;
      this.#picker.hidden = true;
      this.#picker.replaceChildren();
      if (handle !== void 0) {
        try {
          await handle.unmount();
        } catch (error) {
          console.warn("[modkit-viewer] unmount failed", error);
        }
      }
      this.#stage.replaceChildren();
    }
    async #show(viewId) {
      const handle = this.#handle;
      if (handle === void 0 || viewId === "" || handle.activeView === viewId) return;
      try {
        await handle.show(viewId);
        this.#picker.value = handle.activeView;
      } catch (error) {
        this.#fail(`\xAB${viewId}\xBB could not be shown: ${describe(error)}`);
      }
    }
    /** The bytes to open: the `file` property when the page set one, else `src`. */
    async #read(name, signal) {
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
          `${target.href} could not be fetched (${describe(error)}). A cross-origin file needs CORS headers from its own server and an entry for its origin in this page's content-security-policy connect-src.`
        );
      }
      if (!response.ok) {
        throw new Error(
          `${target.href} could not be fetched (${response.status} ${response.statusText})`
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
      if (this.#blob === void 0 && (this.getAttribute("src") ?? "") === "") {
        this.#say("Waiting for a file: set the src attribute or assign the file property.", "empty");
        return;
      }
      this.#say(`Loading ${name}\u2026`, "loading");
      try {
        const assetBase = resolveAssetBase(
          this.getAttribute("asset-base") ?? void 0,
          defaultAssetBase,
          this.ownerDocument.baseURI
        );
        const refusal = crossOriginRefusal(assetBase, this.ownerDocument.location?.origin ?? "");
        if (refusal !== void 0) {
          this.#fail(refusal);
          return;
        }
        const host = await embedHostFor(assetBase);
        if (!current()) return;
        this.#applyStyles(host.styles);
        const file = await this.#read(name, controller.signal);
        if (!current()) return;
        setViewerText(this.#title, file.name, 300);
        if (file.size > EMBED_MAXIMUM_BYTES) {
          this.#fail(
            `${name} is ${file.size} bytes; this element reads at most ${EMBED_MAXIMUM_BYTES}.`
          );
          return;
        }
        const { access, entry } = createSingleFileAccess(file);
        const bytes = await access.read(entry.id, EMBED_MAXIMUM_BYTES, controller.signal);
        if (!current()) return;
        const previewer = createCodecPreview({
          supported: host.services.supportedExtensions,
          stages: preferStage(host.stages, this.getAttribute("view") ?? void 0),
          fallback: WEB_PREVIEW_FALLBACK,
          openSession: (openedEntry, openedBytes, signal) => openEmbedSession(host, openedEntry, openedBytes, signal)
        });
        const handle = await previewer.open(this.#stage, entry, bytes, controller.signal);
        if (!current()) {
          await handle?.unmount();
          return;
        }
        if (handle === void 0) {
          this.#fail(`${name} could not be shown: no stage matched what the codecs published.`);
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
  EMBED_MAXIMUM_BYTES,
  MODKIT_VIEWER_TAG,
  crossOriginRefusal,
  defineModkitElements,
  displayNameFor,
  embedHostFor,
  fileLikeFrom,
  preferStage,
  resolveAssetBase,
  shareByAssetBase
};
