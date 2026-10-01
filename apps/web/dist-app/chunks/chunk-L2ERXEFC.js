import {
  FILTER_FALLBACK_MESSAGES,
  MEDIA_SHELL_FALLBACK_MESSAGES,
  setPart,
  setState,
  withEnglishUiFallback
} from "./chunk-J4UN5ND3.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/ui/dist/media-shell/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/ui/dist/icons/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function icon(document, name) {
  const node = document.createElement("span");
  node.className = `codicon codicon-${name}`;
  node.setAttribute("aria-hidden", "true");
  return node;
}
function iconButton(parent, name, title, onClick) {
  const button = parent.ownerDocument.createElement("button");
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.append(icon(parent.ownerDocument, name));
  if (onClick !== void 0)
    button.addEventListener("click", onClick);
  parent.append(button);
  return button;
}

// ../MODDING/modkit-core/packages/ui/dist/filter/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function isWordChar(ch) {
  return ch !== "" && /[A-Za-z0-9_]/u.test(ch);
}
function hasWordBoundary(text, start, end) {
  return !isWordChar(text.charAt(start - 1)) && !isWordChar(text.charAt(end));
}
function compileMatcher(options, onError = () => void 0) {
  onError("");
  const { text, caseSensitive, wholeWord, regex } = options;
  if (text === "")
    return null;
  if (!regex) {
    return {
      kind: "plain",
      needle: caseSensitive ? text : text.toLowerCase(),
      caseSensitive,
      wholeWord
    };
  }
  try {
    const source = wholeWord ? `(?<![A-Za-z0-9_])(?:${text})(?![A-Za-z0-9_])` : text;
    return new RegExp(source, caseSensitive ? "u" : "iu");
  } catch (error) {
    onError(error instanceof Error ? error.message : "Invalid regular expression");
    return false;
  }
}
function compilePattern(options, onError = () => void 0) {
  const text = options.regex ? options.text : options.text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matcher = compileMatcher({ ...options, text, regex: true }, onError);
  if (matcher instanceof RegExp)
    return new RegExp(matcher.source, `${matcher.flags}g`);
  return matcher === false ? false : null;
}
function textMatches(text, matcher) {
  if (matcher === null)
    return true;
  if (matcher === false)
    return false;
  if (matcher instanceof RegExp)
    return matcher.test(text);
  const needle = matcher.needle;
  if (needle === "")
    return true;
  const hay = matcher.caseSensitive ? text : text.toLowerCase();
  let index = hay.indexOf(needle);
  while (index >= 0) {
    if (!matcher.wholeWord || hasWordBoundary(text, index, index + needle.length))
      return true;
    index = hay.indexOf(needle, index + Math.max(1, needle.length));
  }
  return false;
}
function createFilterWidget(parent, widgetOptions) {
  const localizer = withEnglishUiFallback(widgetOptions.localizer, FILTER_FALLBACK_MESSAGES);
  const document = parent.ownerDocument;
  const state = {
    text: "",
    caseSensitive: widgetOptions.initial?.caseSensitive ?? false,
    wholeWord: widgetOptions.initial?.wholeWord ?? false,
    regex: widgetOptions.initial?.regex ?? false
  };
  let error = "";
  const root = document.createElement("div");
  setPart(root, "filter");
  root.title = localizer.text("filter.title");
  parent.append(root);
  const opener = iconButton(root, "filter", localizer.text("filter.title"), () => widget.open());
  setPart(opener, "filter.opener");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = localizer.text("filter.placeholder");
  input.setAttribute("aria-label", localizer.text("filter.title"));
  setPart(input, "filter.input");
  root.append(input);
  const toggles = [
    ["caseSensitive", "case-sensitive", "filter.matchCase"],
    ["wholeWord", "whole-word", "filter.wholeWord"],
    ["regex", "regex", "filter.regex"]
  ].map(([key, name, label]) => {
    const button = iconButton(root, name, localizer.text(label), () => {
      state[key] = !state[key];
      changed();
    });
    setPart(button, "filter.option");
    return [key, button];
  });
  const matcher = () => compileMatcher(state, (message) => {
    error = message;
  });
  const sync = () => {
    matcher();
    const open = root.dataset["open"] === "true";
    setState(root, [
      ...open ? ["active"] : [],
      ...error === "" ? [] : ["invalid"]
    ]);
    root.title = error === "" ? localizer.text("filter.title") : error;
    for (const [key, button] of toggles)
      button.setAttribute("aria-pressed", String(state[key]));
  };
  const changed = () => {
    sync();
    widgetOptions.onChange({ ...state });
  };
  const close = () => {
    root.dataset["open"] = "false";
    sync();
  };
  input.addEventListener("input", () => {
    state.text = input.value;
    changed();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape")
      return;
    event.preventDefault();
    if (state.text === "")
      close();
    else
      widget.clear();
  });
  root.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!root.contains(document.activeElement) && state.text === "")
        close();
    }, 100);
  });
  const widget = {
    root,
    get options() {
      return { ...state };
    },
    matcher,
    open() {
      root.dataset["open"] = "true";
      sync();
      input.focus();
      input.select();
    },
    clear() {
      state.text = "";
      input.value = "";
      changed();
    }
  };
  close();
  return widget;
}

// ../MODDING/modkit-core/packages/ui/dist/media-shell/index.js
function mountContributedSections(shell, sections, args, onMounted) {
  for (const contributed of sections ?? []) {
    const section = shell.section(contributed.id, contributed.title, {
      ...contributed.icon === void 0 ? {} : { icon: contributed.icon },
      collapsed: contributed.collapsed ?? true
    });
    void contributed.module.mount({ ...args, container: section.body }).then((mounted) => onMounted(() => void mounted.unmount())).catch(() => section.root.remove());
  }
}
var MIN_PANE = 120;
var MAX_PANE = 640;
var THUMB_EDGE = { small: 76, big: 128 };
var THUMB_CONCURRENCY = 6;
var AUTO_EXPAND_MAX_ITEMS = 200;
function el(document, tag, part, parent) {
  const node = document.createElement(tag);
  setPart(node, part);
  parent?.append(node);
  return node;
}
function createMediaShell(document, options) {
  const localizer = withEnglishUiFallback(options.localizer, MEDIA_SHELL_FALLBACK_MESSAGES);
  const state = {
    leftWidth: 240,
    rightWidth: 280,
    leftCollapsed: false,
    rightCollapsed: false,
    galleryMode: "list",
    collapsedSections: [],
    ...options.state
  };
  if (options.gallery === void 0)
    state.leftCollapsed = true;
  const cleanup = [];
  const root = el(document, "div", "media-shell");
  const toggleLeft = iconButton(root, "layout-sidebar-left", localizer.text("mediaShell.toggleGallery"));
  setPart(toggleLeft, "media-shell.toggle");
  toggleLeft.dataset["side"] = "left";
  toggleLeft.hidden = options.gallery === void 0;
  const toggleRight = iconButton(root, "layout-sidebar-right", localizer.text("mediaShell.toggleSidebar"));
  setPart(toggleRight, "media-shell.toggle");
  toggleRight.dataset["side"] = "right";
  const left = el(document, "aside", "media-shell.gallery", root);
  left.setAttribute("aria-label", localizer.text("mediaShell.gallery"));
  const splitLeft = el(document, "div", "media-shell.splitter", root);
  splitLeft.dataset["side"] = "left";
  splitLeft.setAttribute("role", "separator");
  splitLeft.setAttribute("aria-orientation", "vertical");
  const stage = el(document, "main", "media-shell.stage", root);
  const splitRight = el(document, "div", "media-shell.splitter", root);
  splitRight.dataset["side"] = "right";
  splitRight.setAttribute("role", "separator");
  splitRight.setAttribute("aria-orientation", "vertical");
  const right = el(document, "aside", "media-shell.sidebar", root);
  right.setAttribute("aria-label", localizer.text("mediaShell.sidebar"));
  const emit = () => options.onStateChange?.({ ...state });
  const applyLayout = () => {
    root.style.setProperty("--shell-left", `${state.leftWidth}px`);
    root.style.setProperty("--shell-right", `${state.rightWidth}px`);
    const flags = [];
    if (state.leftCollapsed)
      flags.push("left-collapsed");
    if (state.rightCollapsed)
      flags.push("right-collapsed");
    root.dataset["layout"] = flags.join(" ");
    left.hidden = state.leftCollapsed === true;
    splitLeft.hidden = state.leftCollapsed === true;
    right.hidden = state.rightCollapsed === true;
    splitRight.hidden = state.rightCollapsed === true;
    toggleLeft.setAttribute("aria-pressed", String(!state.leftCollapsed));
    toggleRight.setAttribute("aria-pressed", String(!state.rightCollapsed));
  };
  toggleLeft.addEventListener("click", () => {
    state.leftCollapsed = !state.leftCollapsed;
    applyLayout();
    if (!state.leftCollapsed)
      renderGallery();
    emit();
  });
  toggleRight.addEventListener("click", () => {
    state.rightCollapsed = !state.rightCollapsed;
    applyLayout();
    emit();
  });
  const dragSplitter = (splitter, side) => {
    splitter.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const startWidth = (side === "left" ? state.leftWidth : state.rightWidth) ?? 240;
      splitter.setPointerCapture(down.pointerId);
      root.dataset["resizing"] = "true";
      setState(splitter, ["active"]);
      const move = (event) => {
        const delta = side === "left" ? event.clientX - startX : startX - event.clientX;
        const width = Math.min(MAX_PANE, Math.max(MIN_PANE, startWidth + delta));
        if (side === "left")
          state.leftWidth = width;
        else
          state.rightWidth = width;
        applyLayout();
      };
      const up = () => {
        splitter.removeEventListener("pointermove", move);
        splitter.removeEventListener("pointerup", up);
        splitter.removeEventListener("pointercancel", up);
        delete root.dataset["resizing"];
        setState(splitter, []);
        emit();
      };
      splitter.addEventListener("pointermove", move);
      splitter.addEventListener("pointerup", up);
      splitter.addEventListener("pointercancel", up);
    });
  };
  dragSplitter(splitLeft, "left");
  dragSplitter(splitRight, "right");
  const sections = /* @__PURE__ */ new Map();
  const section = (id, title, sectionOptions = {}) => {
    const existing = sections.get(id);
    if (existing !== void 0)
      return existing;
    const box = el(document, "section", "media-shell.section", right);
    box.dataset["sectionId"] = id;
    const header = el(document, "button", "media-shell.section-header", box);
    header.type = "button";
    const chevron = icon(document, "chevron-down");
    setPart(chevron, "media-shell.section-chevron");
    header.append(chevron);
    if (sectionOptions.icon !== void 0) {
      const glyph = icon(document, sectionOptions.icon);
      setPart(glyph, "media-shell.section-icon");
      header.append(glyph);
    }
    el(document, "span", "media-shell.section-title", header).textContent = title;
    const body = el(document, "div", "media-shell.section-body", box);
    const listeners = [];
    const setCollapsed = (collapsed) => {
      box.dataset["collapsed"] = String(collapsed);
      header.setAttribute("aria-expanded", String(!collapsed));
      body.hidden = collapsed;
    };
    const remembered = state.collapsedSections?.includes(id);
    setCollapsed(remembered === true ? true : sectionOptions.collapsed ?? false);
    header.addEventListener("click", () => {
      const collapsed = box.dataset["collapsed"] !== "true";
      setCollapsed(collapsed);
      const others = (state.collapsedSections ?? []).filter((item) => item !== id);
      state.collapsedSections = collapsed ? [...others, id] : others;
      for (const listener of listeners)
        listener(collapsed);
      emit();
    });
    const created = {
      root: box,
      body,
      get collapsed() {
        return box.dataset["collapsed"] === "true";
      },
      setCollapsed,
      onToggle(listener) {
        listeners.push(listener);
      }
    };
    sections.set(id, created);
    return created;
  };
  const clearSections = (keep = []) => {
    for (const [id, item] of sections) {
      if (keep.includes(id))
        continue;
      item.root.remove();
      sections.delete(id);
    }
  };
  const toolbar = el(document, "div", "media-shell.gallery-toolbar", left);
  const modes = [
    ["list", "list-flat", "mediaShell.galleryList"],
    ["small", "circle-small-filled", "mediaShell.gallerySmall"],
    ["big", "circle-large-filled", "mediaShell.galleryBig"]
  ];
  const modeButtons = modes.map(([mode, glyph, label]) => {
    const button = iconButton(toolbar, glyph, localizer.text(label), () => {
      state.galleryMode = mode;
      renderGallery();
      emit();
    });
    setPart(button, "media-shell.gallery-mode");
    button.dataset["mode"] = mode;
    return button;
  });
  const filter = createFilterWidget(toolbar, {
    localizer,
    initial: {
      caseSensitive: state.filterCase ?? false,
      wholeWord: state.filterWord ?? false,
      regex: state.filterRegex ?? false
    },
    onChange(value) {
      const toggled = value.caseSensitive !== state.filterCase || value.wholeWord !== state.filterWord || value.regex !== state.filterRegex;
      state.filterCase = value.caseSensitive;
      state.filterWord = value.wholeWord;
      state.filterRegex = value.regex;
      renderGallery();
      if (toggled)
        emit();
    }
  });
  const list = el(document, "div", "media-shell.gallery-list", left);
  let items = [];
  const expanded = /* @__PURE__ */ new Set();
  let thumbnails;
  const seenGroups = /* @__PURE__ */ new Set();
  const renderGallery = () => {
    thumbnails?.abort();
    thumbnails = new AbortController();
    const signal = thumbnails.signal;
    const mode = state.galleryMode ?? "list";
    for (const button of modeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset["mode"] === mode));
    }
    list.dataset["mode"] = mode;
    list.replaceChildren();
    const matcher = filter.matcher();
    const filtering = filter.options.text !== "";
    const groups = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (filtering && !textMatches(item.label, matcher))
        continue;
      const key = item.group ?? "";
      groups.set(key, [...groups.get(key) ?? [], item]);
    }
    const pending = [];
    for (const [group, members] of groups) {
      const open = filtering || group === "" || expanded.has(group);
      const groupBox = el(document, "div", "media-shell.gallery-group", list);
      groupBox.dataset["collapsed"] = String(!open);
      if (group !== "") {
        const heading = el(document, "button", "media-shell.gallery-group-header", groupBox);
        heading.type = "button";
        heading.setAttribute("aria-expanded", String(open));
        const chevron = icon(document, "chevron-down");
        setPart(chevron, "media-shell.section-chevron");
        heading.append(chevron);
        const label = el(document, "span", "media-shell.gallery-label", heading);
        label.textContent = group;
        label.title = group;
        el(document, "span", "media-shell.gallery-count", heading).textContent = String(members.length);
        if (!filtering) {
          heading.addEventListener("click", () => {
            if (expanded.has(group))
              expanded.delete(group);
            else
              expanded.add(group);
            renderGallery();
          });
        }
      }
      if (!open)
        continue;
      const cells = el(document, "div", "media-shell.gallery-cells", groupBox);
      for (const item of members) {
        const cell = el(document, "button", "media-shell.gallery-item", cells);
        cell.type = "button";
        cell.title = item.id;
        if (item.active === true) {
          cell.setAttribute("aria-current", "true");
          setState(cell, ["active"]);
        }
        if (mode === "list") {
          cell.append(icon(document, "file-media"));
        } else {
          const wrap = el(document, "span", "media-shell.gallery-thumb-box", cell);
          const thumb = el(document, "canvas", "media-shell.gallery-thumb", wrap);
          thumb.width = 0;
          thumb.height = 0;
          const placeholder = icon(document, "file-media");
          wrap.append(placeholder);
          pending.push(() => drawThumbnail(options.gallery, item.id, thumb, THUMB_EDGE[mode], signal).then((drawn) => {
            if (drawn)
              placeholder.remove();
          }));
        }
        el(document, "span", "media-shell.gallery-label", cell).textContent = item.label;
        cell.addEventListener("click", () => {
          if (item.active === true)
            return;
          void options.gallery?.open(item.id);
        });
      }
    }
    if (groups.size === 0) {
      el(document, "div", "media-shell.gallery-empty", list).textContent = localizer.text(filtering ? "mediaShell.galleryNoMatch" : "mediaShell.galleryEmpty");
    }
    const next = async () => {
      for (let job = pending.shift(); job !== void 0 && !signal.aborted; job = pending.shift()) {
        await job();
      }
    };
    for (let worker = 0; worker < THUMB_CONCURRENCY; worker += 1)
      void next();
  };
  const refreshGallery = async (signal) => {
    if (options.gallery === void 0)
      return;
    items = await options.gallery.list(signal);
    if (items.length === 0) {
      state.leftCollapsed = true;
      applyLayout();
    }
    for (const item of items) {
      if (item.group === void 0 || seenGroups.has(item.group))
        continue;
      seenGroups.add(item.group);
      if (items.length <= AUTO_EXPAND_MAX_ITEMS)
        expanded.add(item.group);
    }
    for (const item of items) {
      if (item.active === true && item.group !== void 0)
        expanded.add(item.group);
    }
    renderGallery();
  };
  applyLayout();
  cleanup.push(() => thumbnails?.abort());
  return {
    root,
    stage,
    section,
    clearSections,
    refreshGallery,
    destroy() {
      for (const callback of cleanup)
        callback();
      root.remove();
    }
  };
}
async function drawThumbnail(gallery, id, canvas, edge, signal) {
  if (gallery?.thumbnail === void 0)
    return false;
  try {
    const thumb = await gallery.thumbnail(id, edge, signal);
    if (thumb === void 0 || signal.aborted)
      return false;
    const context = canvas.getContext("2d");
    if (context === null)
      return false;
    const pixels = new Uint8ClampedArray(thumb.width * thumb.height * 4);
    pixels.set(thumb.rgba.subarray(0, pixels.length));
    const bitmap = await createImageBitmap(new ImageData(pixels, thumb.width, thumb.height));
    const scale = Math.min(edge / bitmap.width, edge / bitmap.height, 1);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.imageSmoothingEnabled = scale < 1;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    canvas.dataset["loaded"] = "true";
    return true;
  } catch {
    return false;
  }
}

// ../MODDING/modkit-core/packages/ui/dist/media/encoded.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
async function collectEncodedMedia(source, maximumBytes, signal) {
  const descriptor = await source.descriptor();
  if (descriptor.bytes > BigInt(maximumBytes) || descriptor.bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`encoded media exceeds the stage budget: ${descriptor.bytes} bytes`);
  }
  const total = Number(descriptor.bytes);
  const bytes = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    const chunk = await source.read(BigInt(offset), Math.min(1024 * 1024, total - offset), signal);
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError("encoded media ended outside its declared size");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { mediaType: descriptor.mediaType, bytes };
}

export {
  compileMatcher,
  compilePattern,
  textMatches,
  mountContributedSections,
  createMediaShell,
  collectEncodedMedia
};
