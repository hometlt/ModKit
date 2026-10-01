import {
  MEDIA_ZOOM_CHOICES,
  canvasPng,
  collectEncodedMedia,
  createMediaShell,
  mediaFacts,
  mountContributedSections
} from "./chunk-GP4R44PF.js";
import {
  IMAGE_EDITING_FALLBACK_MESSAGES,
  IMAGE_FALLBACK_MESSAGES,
  NAMESPACE_FALLBACK_MESSAGES,
  ViewerMountScope,
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  rememberUiPreference,
  setPart,
  setState,
  setViewerText,
  uiPreference,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-ZKA6ERAI.js";
import {
  createSubjectCandidateProvider,
  isKnowledgeTarget,
  loadSubjectCandidatePage
} from "./chunk-IXZGU3XP.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/ui/dist/image/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/ui/dist/image-editing/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var IMAGE_EDIT_UNDO_DEPTH = 100;
var TOOL_ICONS = Object.freeze({
  select: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="2.5" width="11" height="11" rx=".5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 2"/></svg>`,
  brush: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M12.1 1.9a1.6 1.6 0 0 1 2 2.4L7.8 10.6a2.4 2.4 0 0 1-1.5.7l-2.1.2.2-2.1c.1-.6.4-1.1.7-1.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.2 11.4c.2 1.6-1 2.8-2.6 2.8.6-1 .8-2.2.5-3.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  eraser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect x="3.6" y="6.3" width="9.6" height="5.2" rx="1" transform="rotate(-25 8.4 8.9)" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.6 11.6h6.4" stroke="currentColor" stroke-width="1" transform="rotate(-25 8.4 8.9)"/></svg>`,
  line: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="3" cy="13" r="1.2" fill="currentColor"/><circle cx="13" cy="3" r="1.2" fill="currentColor"/></svg>`,
  rect: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  ellipse: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><ellipse cx="8" cy="8" rx="5.4" ry="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  fill: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M3 7.6 8.4 2.2l5 5-5.3 5.3a2.7 2.7 0 0 1-3.8 0L3 11.2a2.7 2.7 0 0 1 0-3.6Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.3 8.1h9.4" stroke="currentColor" stroke-width="1"/><circle cx="13" cy="12.2" r="1.4" fill="currentColor"/></svg>`,
  gradient: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><defs><linearGradient id="mk-edit-tool-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="url(#mk-edit-tool-gradient)" stroke="currentColor" stroke-width="1.1"/></svg>`,
  eyedropper: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M11.1 2.3 13.7 4.9 6.3 12.3 3.4 12.9l.6-2.9Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.1 4.3 11.7 6.9" stroke="currentColor" stroke-width="1"/><circle cx="3.7" cy="12.3" r=".7" fill="currentColor"/></svg>`
});
var TOOLS = [
  ["select", "M"],
  ["brush", "B"],
  ["eraser", "E"],
  ["line", "L"],
  ["rect", "R"],
  ["ellipse", "C"],
  ["fill", "G"],
  ["gradient", ""],
  ["eyedropper", "I"]
];
var TOOL_SHORTCUTS = Object.freeze(Object.fromEntries(TOOLS.filter(([, key]) => key !== "").map(([tool, key]) => [key.toLowerCase(), tool])));
var SIZE_TOOLS = /* @__PURE__ */ new Set([
  "brush",
  "eraser",
  "line",
  "rect",
  "ellipse"
]);
var TOLERANCE_TOOLS = /* @__PURE__ */ new Set(["fill"]);
function clampRect(rect, width, height) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
function unionRect(a, b) {
  if (a === void 0)
    return b;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return {
    x: x0,
    y: y0,
    w: Math.max(a.x + a.w, b.x + b.w) - x0,
    h: Math.max(a.y + a.h, b.y + b.h) - y0
  };
}
function snapshot(image, rect) {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y += 1) {
    const offset = ((rect.y + y) * image.width + rect.x) * 4;
    out.set(image.data.subarray(offset, offset + rect.w * 4), y * rect.w * 4);
  }
  return out;
}
function restore(image, rect, patch) {
  for (let y = 0; y < rect.h; y += 1) {
    image.data.set(patch.subarray(y * rect.w * 4, (y + 1) * rect.w * 4), ((rect.y + y) * image.width + rect.x) * 4);
  }
}
var copyImage = (image) => new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
function blendMask(image, rect, mask, mode, ink, channel) {
  const { data, width } = image;
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      const coverage = mask[(y * rect.w + x) * 4 + 3] / 255;
      if (coverage <= 0)
        continue;
      const o = ((rect.y + y) * width + rect.x + x) * 4;
      if (mode === "erase") {
        data[o + 3] = Math.round(data[o + 3] * (1 - coverage));
        continue;
      }
      const srcA = ink.a / 255 * coverage;
      if (channel === "rgb") {
        const dstA = data[o + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA <= 0) {
          data.fill(0, o, o + 4);
          continue;
        }
        data[o] = Math.round((ink.r * srcA + data[o] * dstA * (1 - srcA)) / outA);
        data[o + 1] = Math.round((ink.g * srcA + data[o + 1] * dstA * (1 - srcA)) / outA);
        data[o + 2] = Math.round((ink.b * srcA + data[o + 2] * dstA * (1 - srcA)) / outA);
        data[o + 3] = Math.round(outA * 255);
      } else {
        const index = o + { r: 0, g: 1, b: 2, a: 3 }[channel];
        data[index] = Math.round(ink.r * srcA + data[index] * (1 - srcA));
      }
    }
  }
}
function floodMask(image, startX, startY, tolerance) {
  const { data, width, height } = image;
  const x0 = Math.floor(startX);
  const y0 = Math.floor(startY);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height)
    return void 0;
  const t = (y0 * width + x0) * 4;
  const target = [data[t], data[t + 1], data[t + 2], data[t + 3]];
  const visited = new Uint8Array(width * height);
  const stack = [x0, y0];
  let minX = x0;
  let minY = y0;
  let maxX = x0;
  let maxY = y0;
  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height)
      continue;
    const index = y * width + x;
    if (visited[index] === 1)
      continue;
    const o = index * 4;
    const delta = Math.abs(data[o] - target[0]) + Math.abs(data[o + 1] - target[1]) + Math.abs(data[o + 2] - target[2]) + Math.abs(data[o + 3] - target[3]);
    if (delta > tolerance)
      continue;
    visited[index] = 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const mask = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      if (visited[(rect.y + y) * width + rect.x + x] === 1)
        mask[(y * rect.w + x) * 4 + 3] = 255;
    }
  }
  return { rect, mask };
}
function resampleImage(image, width, height, algorithm) {
  const out = new ImageData(width, height);
  const sx = image.width / width;
  const sy = image.height / height;
  const src = image.data;
  const at = (x, y, c) => src[(Math.min(image.height - 1, y) * image.width + Math.min(image.width - 1, x)) * 4 + c];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (algorithm === "nearest") {
        const nx = Math.floor((x + 0.5) * sx);
        const ny = Math.floor((y + 0.5) * sy);
        for (let c = 0; c < 4; c += 1)
          out.data[o + c] = at(nx, ny, c);
        continue;
      }
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const fy = Math.max(0, (y + 0.5) * sy - 0.5);
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const dx = fx - ix;
      const dy = fy - iy;
      for (let c = 0; c < 4; c += 1) {
        const top = at(ix, iy, c) * (1 - dx) + at(ix + 1, iy, c) * dx;
        const bottom = at(ix, iy + 1, c) * (1 - dx) + at(ix + 1, iy + 1, c) * dx;
        out.data[o + c] = Math.round(top * (1 - dy) + bottom * dy);
      }
    }
  }
  return out;
}
var nearestPowerOfTwo = (value) => Math.max(1, 2 ** Math.round(Math.log2(Math.max(1, value))));
var hex2 = (value) => value.toString(16).padStart(2, "0");
function createImageEditing(parent, options) {
  const localizer = withEnglishUiFallback(options.localizer, IMAGE_EDITING_FALLBACK_MESSAGES);
  const document = parent.ownerDocument;
  const { surface, overlay } = options;
  const listeners = new AbortController();
  const listen = { signal: listeners.signal };
  const node = (tag, part, host, text) => {
    const created = document.createElement(tag);
    setPart(created, part);
    if (text !== void 0)
      created.textContent = text;
    host.append(created);
    return created;
  };
  const chip = (host, text, onClick) => {
    const button = node("button", "image-editing.chip", host, text);
    button.type = "button";
    button.addEventListener("click", onClick, listen);
    return button;
  };
  const toolButton = (host, title, content, onClick) => {
    const button = node("button", "image-editing.tool", host);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    if (typeof content === "string") {
      const parser = new (document.defaultView ?? globalThis).DOMParser();
      const svg = parser.parseFromString(content, "image/svg+xml").documentElement;
      button.append(document.importNode(svg, true));
    } else
      button.append(content);
    button.addEventListener("click", onClick, listen);
    return button;
  };
  const group = (title) => {
    const box = node("div", "image-editing.group", root);
    if (title !== void 0)
      node("div", "image-editing.group-title", box, title);
    return box;
  };
  const row = (host) => node("div", "image-editing.row", host);
  const range = (host, label, min, max, value, onInput) => {
    const line = row(host);
    node("label", "image-editing.label", line, label);
    const input = node("input", "image-editing.range", line);
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.setAttribute("aria-label", label);
    const readout = node("span", "image-editing.value", line, String(value));
    input.addEventListener("input", () => {
      readout.textContent = input.value;
      onInput(Number(input.value));
    }, listen);
    return { row: line, input };
  };
  const root = document.createElement("div");
  setPart(root, "image-editing");
  parent.append(root);
  let tool = "select";
  let ink = { r: 255, g: 59, b: 48, a: 255 };
  let brushSize = 12;
  let tolerance = 24;
  let recent = [...options.recentColors ?? []];
  let selection;
  let active = false;
  let dirty = false;
  const undoStack = [];
  const redoStack = [];
  const maskCanvas = document.createElement("canvas");
  const mask = maskCanvas.getContext("2d", { willReadFrequently: true });
  let dragStart;
  let dirtyRect;
  const strokePoints = [];
  const markDirty = (value) => {
    if (dirty === value)
      return;
    dirty = value;
    options.onDirty?.(value);
    syncButtons();
  };
  const push = (patch) => {
    undoStack.push(patch);
    if (undoStack.length > IMAGE_EDIT_UNDO_DEPTH)
      undoStack.shift();
    redoStack.length = 0;
    markDirty(true);
    syncButtons();
    options.onEdit?.();
  };
  if (!options.editable) {
    node("p", "image-editing.note", root, options.unavailableReason ?? localizer.text("imageEditing.unavailable"));
  }
  const toolGroup = group(localizer.text("imageEditing.tool"));
  toolGroup.hidden = !options.editable;
  const status = node("output", "image-editing.value", toolGroup);
  const grid = node("div", "image-editing.tools", toolGroup);
  grid.setAttribute("role", "toolbar");
  const toolButtons = /* @__PURE__ */ new Map();
  for (const [id, key] of TOOLS) {
    const title = localizer.text(`imageEditing.tool.${id}`) + (key === "" ? "" : ` (${key})`);
    toolButtons.set(id, toolButton(grid, title, TOOL_ICONS[id], () => selectTool(id)));
  }
  const selectionRow = row(toolGroup);
  const clearButton = chip(selectionRow, localizer.text("imageEditing.clearSelection"), () => clearSelection());
  const cropButton = chip(selectionRow, localizer.text("imageEditing.crop"), () => cropSelection());
  const colourGroup = group(localizer.text("imageEditing.color"));
  colourGroup.hidden = !options.editable;
  const colourRow = row(colourGroup);
  const swatchButton = node("button", "image-editing.swatch-button", colourRow);
  swatchButton.type = "button";
  swatchButton.title = localizer.text("imageEditing.colorAlpha");
  swatchButton.setAttribute("aria-label", swatchButton.title);
  const swatchAlpha = node("span", "image-editing.swatch-alpha", swatchButton);
  const colourText = node("span", "image-editing.value", colourRow);
  const swatches = node("div", "image-editing.swatches", colourGroup);
  const popover = node("div", "image-editing.popover", colourGroup);
  popover.hidden = true;
  const pickerRow = row(popover);
  node("label", "image-editing.label", pickerRow, "RGB");
  const picker = node("input", "image-editing.color", pickerRow);
  picker.type = "color";
  picker.setAttribute("aria-label", localizer.text("imageEditing.color"));
  range(popover, localizer.text("imageEditing.alpha"), 0, 255, 255, (value) => {
    ink = { ...ink, a: value };
    syncColour();
  });
  const popoverActions = node("div", "image-editing.actions", popover);
  chip(popoverActions, localizer.text("imageEditing.done"), () => {
    popover.hidden = true;
  });
  swatchButton.addEventListener("click", () => {
    popover.hidden = !popover.hidden;
  }, listen);
  picker.addEventListener("input", () => setColour(picker.value), listen);
  const brushGroup = group(localizer.text("imageEditing.brushSettings"));
  const size = range(brushGroup, localizer.text("imageEditing.size"), 1, 200, brushSize, (value) => {
    brushSize = value;
  });
  const fill = range(brushGroup, localizer.text("imageEditing.tolerance"), 0, 255, tolerance, (value) => {
    tolerance = value;
  });
  const marquee = document.createElement("div");
  setPart(marquee, "image-editing.marquee");
  marquee.hidden = true;
  overlay.append(marquee);
  const dialog = document.createElement("div");
  setPart(dialog, "image-editing.dialog");
  dialog.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", localizer.text("imageEditing.resize"));
  overlay.append(dialog);
  const sizeRow = row(dialog);
  const widthInput = node("input", "image-editing.number", sizeRow);
  widthInput.type = "number";
  widthInput.min = "1";
  widthInput.setAttribute("aria-label", localizer.text("imageEditing.width"));
  node("span", "image-editing.value", sizeRow, "\xD7");
  const heightInput = node("input", "image-editing.number", sizeRow);
  heightInput.type = "number";
  heightInput.min = "1";
  heightInput.setAttribute("aria-label", localizer.text("imageEditing.height"));
  const potButton = chip(sizeRow, "PoT", () => {
    widthInput.value = String(nearestPowerOfTwo(Number(widthInput.value) || 1));
    heightInput.value = String(nearestPowerOfTwo(Number(heightInput.value) || 1));
  });
  potButton.title = localizer.text("imageEditing.powerOfTwo");
  const optionRow = row(dialog);
  const lockLabel = node("label", "image-editing.check", optionRow);
  const lock = document.createElement("input");
  lock.type = "checkbox";
  lock.checked = true;
  lockLabel.append(lock, ` ${localizer.text("imageEditing.lockAspect")}`);
  const algorithm = node("select", "image-editing.select", optionRow);
  algorithm.setAttribute("aria-label", localizer.text("imageEditing.resample"));
  for (const [value, label] of [
    ["nearest", localizer.text("imageEditing.nearest")],
    ["bilinear", localizer.text("imageEditing.bilinear")]
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    algorithm.append(option);
  }
  algorithm.value = "bilinear";
  const dialogActions = node("div", "image-editing.actions", dialog);
  chip(dialogActions, localizer.text("imageEditing.cancel"), () => {
    dialog.hidden = true;
  });
  chip(dialogActions, localizer.text("imageEditing.apply"), () => applyResize());
  widthInput.addEventListener("input", () => {
    const image = surface.pixels();
    if (!lock.checked || image === void 0)
      return;
    const width = Number(widthInput.value) || image.width;
    heightInput.value = String(Math.max(1, Math.round(width * image.height / image.width)));
  }, listen);
  heightInput.addEventListener("input", () => {
    const image = surface.pixels();
    if (!lock.checked || image === void 0)
      return;
    const height = Number(heightInput.value) || image.height;
    widthInput.value = String(Math.max(1, Math.round(height * image.width / image.height)));
  }, listen);
  function syncButtons() {
    clearButton.disabled = selection === void 0;
    cropButton.disabled = selection === void 0;
    const image = surface.pixels();
    status.textContent = image === void 0 ? "" : `${image.width} \xD7 ${image.height}`;
  }
  function syncColour() {
    const hex = `#${hex2(ink.r)}${hex2(ink.g)}${hex2(ink.b)}`;
    picker.value = hex;
    swatchAlpha.style.backgroundColor = `rgba(${ink.r},${ink.g},${ink.b},${ink.a / 255})`;
    colourText.textContent = `${hex.toUpperCase()} \xB7 ${ink.a}`;
  }
  function renderSwatches() {
    swatches.replaceChildren();
    for (const colour of recent) {
      const swatch = node("button", "image-editing.swatch", swatches);
      swatch.type = "button";
      swatch.title = colour;
      swatch.setAttribute("aria-label", colour);
      swatch.style.backgroundColor = colour;
      swatch.addEventListener("click", () => setColour(colour), listen);
    }
  }
  function setColour(hex) {
    const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
    if (match === null)
      return;
    ink = {
      r: Number.parseInt(match[1], 16),
      g: Number.parseInt(match[2], 16),
      b: Number.parseInt(match[3], 16),
      a: ink.a
    };
    const normal = `#${match[1] + match[2] + match[3]}`.toLowerCase();
    recent = [normal, ...recent.filter((colour) => colour !== normal)].slice(0, 12);
    options.onRecentColors?.(recent);
    renderSwatches();
    syncColour();
  }
  function selectTool(next) {
    tool = next;
    for (const [id, button] of toolButtons) {
      button.setAttribute("aria-pressed", String(id === next));
      setState(button, id === next ? ["active"] : []);
    }
    size.row.hidden = !SIZE_TOOLS.has(next);
    fill.row.hidden = !TOLERANCE_TOOLS.has(next);
    brushGroup.hidden = !options.editable || !SIZE_TOOLS.has(next) && !TOLERANCE_TOOLS.has(next);
  }
  function showMarquee() {
    if (selection === void 0 || selection.w <= 0 || selection.h <= 0 || !active) {
      marquee.hidden = true;
      return;
    }
    const box = surface.toScreen(selection);
    marquee.hidden = false;
    marquee.style.left = `${box.left}px`;
    marquee.style.top = `${box.top}px`;
    marquee.style.width = `${box.width}px`;
    marquee.style.height = `${box.height}px`;
  }
  const maskData = (rect) => rect.w <= 0 || rect.h <= 0 || mask === null ? new Uint8ClampedArray(0) : mask.getImageData(rect.x, rect.y, rect.w, rect.h).data;
  function beginStroke(point, image) {
    strokePoints.length = 0;
    strokePoints.push(point);
    maskCanvas.width = image.width;
    maskCanvas.height = image.height;
    dirtyRect = void 0;
  }
  function rasterize(end, image) {
    if (mask === null)
      return void 0;
    const start = strokePoints[0];
    mask.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    mask.lineCap = "round";
    mask.lineJoin = "round";
    mask.lineWidth = brushSize;
    mask.strokeStyle = "#fff";
    const pad = brushSize;
    if (tool === "brush" || tool === "eraser") {
      mask.beginPath();
      mask.moveTo(start.x, start.y);
      for (const point of strokePoints.slice(1))
        mask.lineTo(point.x, point.y);
      if (strokePoints.length === 1)
        mask.lineTo(start.x + 0.01, start.y + 0.01);
      mask.stroke();
      const xs = strokePoints.map((point) => point.x);
      const ys = strokePoints.map((point) => point.y);
      return clampRect({
        x: Math.min(...xs) - pad,
        y: Math.min(...ys) - pad,
        w: Math.max(...xs) - Math.min(...xs) + pad * 2,
        h: Math.max(...ys) - Math.min(...ys) + pad * 2
      }, image.width, image.height);
    }
    if (tool === "gradient") {
      const rect = clampRect(selection ?? { x: 0, y: 0, w: image.width, h: image.height }, image.width, image.height);
      const gradient = mask.createLinearGradient(start.x, start.y, end.x, end.y);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      mask.fillStyle = gradient;
      mask.fillRect(rect.x, rect.y, rect.w, rect.h);
      return rect;
    }
    mask.beginPath();
    if (tool === "line") {
      mask.moveTo(start.x, start.y);
      mask.lineTo(end.x, end.y);
    } else if (tool === "rect") {
      mask.rect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else if (tool === "ellipse") {
      mask.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2);
    } else
      return void 0;
    mask.stroke();
    return clampRect({
      x: Math.min(start.x, end.x) - pad,
      y: Math.min(start.y, end.y) - pad,
      w: Math.abs(end.x - start.x) + pad * 2,
      h: Math.abs(end.y - start.y) + pad * 2
    }, image.width, image.height);
  }
  function preview(rect, image) {
    dirtyRect = clampRect(unionRect(dirtyRect, rect), image.width, image.height);
    const scratch = copyImage(image);
    blendMask(scratch, dirtyRect, maskData(dirtyRect), tool === "eraser" ? "erase" : "paint", ink, surface.channel());
    surface.show(scratch, dirtyRect);
  }
  function commit(rect, image, coverage = maskData(rect)) {
    if (rect.w <= 0 || rect.h <= 0)
      return;
    const before = snapshot(image, rect);
    blendMask(image, rect, coverage, tool === "eraser" ? "erase" : "paint", ink, surface.channel());
    push({ kind: "rect", rect, before, after: snapshot(image, rect) });
    surface.show();
  }
  function undo() {
    const patch = undoStack.pop();
    const image = surface.pixels();
    if (patch === void 0 || image === void 0)
      return false;
    redoStack.push(patch);
    if (patch.kind === "full")
      surface.replace(copyImage(patch.before));
    else {
      restore(image, patch.rect, patch.before);
      surface.show();
    }
    markDirty(undoStack.length > 0);
    syncButtons();
    return true;
  }
  function redo() {
    const patch = redoStack.pop();
    const image = surface.pixels();
    if (patch === void 0 || image === void 0)
      return false;
    undoStack.push(patch);
    if (patch.kind === "full")
      surface.replace(copyImage(patch.after));
    else {
      restore(image, patch.rect, patch.after);
      surface.show();
    }
    markDirty(true);
    syncButtons();
    return true;
  }
  function clearSelection() {
    const image = surface.pixels();
    if (selection === void 0 || image === void 0)
      return;
    const rect = clampRect(selection, image.width, image.height);
    const before = snapshot(image, rect);
    for (let y = 0; y < rect.h; y += 1) {
      const o = ((rect.y + y) * image.width + rect.x) * 4;
      image.data.fill(0, o, o + rect.w * 4);
    }
    push({ kind: "rect", rect, before, after: snapshot(image, rect) });
    surface.show();
  }
  function replaceAll(next) {
    const image = surface.pixels();
    if (image === void 0)
      return;
    const before = copyImage(image);
    surface.replace(next);
    push({ kind: "full", before, after: copyImage(next) });
  }
  function cropSelection() {
    const image = surface.pixels();
    if (selection === void 0 || image === void 0)
      return;
    const rect = clampRect(selection, image.width, image.height);
    if (rect.w < 1 || rect.h < 1)
      return;
    const cropped = new ImageData(rect.w, rect.h);
    cropped.data.set(snapshot(image, rect));
    selection = void 0;
    showMarquee();
    replaceAll(cropped);
  }
  function applyResize() {
    const image = surface.pixels();
    if (image === void 0)
      return;
    const width = Math.max(1, Math.round(Number(widthInput.value) || 1));
    const height = Math.max(1, Math.round(Number(heightInput.value) || 1));
    dialog.hidden = true;
    if (width === image.width && height === image.height)
      return;
    selection = void 0;
    showMarquee();
    replaceAll(resampleImage(image, width, height, algorithm.value === "nearest" ? "nearest" : "bilinear"));
  }
  async function save() {
    const image = surface.pixels();
    if (image === void 0 || options.onSave === void 0 || !dirty)
      return;
    try {
      await options.onSave(image);
      undoStack.length = 0;
      redoStack.length = 0;
      markDirty(false);
    } finally {
      syncButtons();
    }
  }
  const engaged = () => active && options.editable;
  const editing = {
    root,
    get dirty() {
      return dirty;
    },
    undo,
    redo,
    save,
    get active() {
      return engaged();
    },
    setActive(next) {
      active = next;
      showMarquee();
    },
    pointerDown(event) {
      if (!engaged() || event.button !== 0)
        return false;
      const image = surface.pixels();
      if (image === void 0)
        return false;
      const point = surface.toImage(event);
      if (tool === "eyedropper") {
        const o = (Math.floor(point.y) * image.width + Math.floor(point.x)) * 4;
        setColour(`#${hex2(image.data[o])}${hex2(image.data[o + 1])}${hex2(image.data[o + 2])}`);
        return true;
      }
      if (tool === "fill") {
        const found = floodMask(image, point.x, point.y, tolerance);
        if (found !== void 0)
          commit(found.rect, image, found.mask);
        return true;
      }
      dragStart = point;
      if (tool === "select") {
        selection = { x: point.x, y: point.y, w: 0, h: 0 };
        showMarquee();
        syncButtons();
        return true;
      }
      beginStroke(point, image);
      if (tool === "brush" || tool === "eraser") {
        const rect = rasterize(point, image);
        if (rect !== void 0)
          preview(rect, image);
      }
      return true;
    },
    pointerMove(event) {
      if (!engaged() || dragStart === void 0)
        return false;
      const image = surface.pixels();
      if (image === void 0)
        return false;
      const point = surface.toImage(event);
      if (tool === "select") {
        selection = {
          x: Math.min(dragStart.x, point.x),
          y: Math.min(dragStart.y, point.y),
          w: Math.abs(point.x - dragStart.x),
          h: Math.abs(point.y - dragStart.y)
        };
        showMarquee();
        return true;
      }
      if (tool === "brush" || tool === "eraser")
        strokePoints.push(point);
      const rect = rasterize(point, image);
      if (rect !== void 0)
        preview(rect, image);
      return true;
    },
    pointerUp() {
      if (dragStart === void 0)
        return false;
      dragStart = void 0;
      if (tool === "select") {
        if (selection !== void 0) {
          const image2 = surface.pixels();
          selection = image2 === void 0 ? void 0 : clampRect(selection, image2.width, image2.height);
          if (selection !== void 0 && (selection.w < 1 || selection.h < 1))
            selection = void 0;
        }
        showMarquee();
        syncButtons();
        return true;
      }
      const image = surface.pixels();
      if (image !== void 0 && dirtyRect !== void 0)
        commit(dirtyRect, image);
      dirtyRect = void 0;
      return true;
    },
    keyDown(event) {
      if (!engaged())
        return false;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey || event.altKey)
        return false;
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/u.test(target.tagName)) {
        return false;
      }
      const next = TOOL_SHORTCUTS[key];
      if (next === void 0)
        return false;
      selectTool(next);
      return true;
    },
    openResize() {
      const image = surface.pixels();
      if (image === void 0 || !options.editable)
        return;
      widthInput.value = String(image.width);
      heightInput.value = String(image.height);
      dialog.hidden = false;
      widthInput.focus();
    },
    applyImage(next) {
      selection = void 0;
      showMarquee();
      replaceAll(next);
    },
    refresh() {
      showMarquee();
      syncButtons();
    },
    destroy() {
      listeners.abort();
      marquee.remove();
      dialog.remove();
      root.remove();
    }
  };
  selectTool(tool);
  renderSwatches();
  syncColour();
  syncButtons();
  return editing;
}

// ../MODDING/modkit-core/packages/ui/dist/namespace/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function normalizeNamespacePath(value) {
  if (value.includes("\\") || value.startsWith("/") || value.includes("\0")) {
    throw new TypeError("namespace path is not relative and portable");
  }
  const parts = value.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === ".."))
    throw new TypeError("namespace traversal is forbidden");
  return parts.join("/");
}
var NamespaceModel = class {
  source;
  #identities = /* @__PURE__ */ new Map();
  constructor(source) {
    this.source = source;
  }
  async list(prefix, cursor, signal, includeHidden = false) {
    const normalized = normalizeNamespacePath(prefix);
    const page = await this.source.list(normalized, { limit: 200, ...cursor === void 0 ? {} : { cursor }, includeHidden }, signal);
    for (const entry of page.items) {
      const path = normalizeNamespacePath(entry.path);
      const identity = `${path}\0${entry.revision}`;
      const existing = this.#identities.get(entry.id);
      if (existing !== void 0 && existing !== identity) {
        throw new TypeError(`namespace entry identity changed: ${entry.id}`);
      }
      this.#identities.set(entry.id, identity);
    }
    return page;
  }
};
function createNamespaceViewer(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, NAMESPACE_FALLBACK_MESSAGES);
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("viewer.namespace"));
      root.setAttribute("role", "tree");
      const lease = await unknownSourceLease(args.sources, args.slot, "common.view/namespace-entry-source");
      if (lease === void 0)
        throw new TypeError("namespace binding is unavailable");
      scope.lease(lease);
      const source = lease.value;
      const model = new NamespaceModel(source);
      const list = element(root, "ul", { part: "namespace.list" });
      list.setAttribute("role", "group");
      const renderPrefix = async (prefix, parent) => {
        const page = await model.list(prefix, void 0, scope.signal, options.showHidden?.() === true);
        const seen = /* @__PURE__ */ new Set();
        for (const entry of page.items) {
          if (seen.has(entry.id))
            throw new TypeError(`duplicate namespace entry id: ${entry.id}`);
          seen.add(entry.id);
          const item = element(parent, "li", { part: "namespace.item" });
          item.setAttribute("role", "treeitem");
          item.dataset["entryId"] = entry.id;
          item.dataset["revision"] = entry.revision;
          const button = element(item, "button", {
            text: entry.name,
            part: "namespace.label"
          });
          button.type = "button";
          const detail = describeEntry(entry, localizer);
          if (detail !== "") {
            setViewerText(element(item, "span", { part: "namespace.detail" }), detail);
          }
          const activate = async () => {
            if (entry.kind === "directory") {
              let nested = item.querySelector(":scope > ul");
              if (nested === null) {
                nested = element(item, "ul", { part: "namespace.children" });
                nested.setAttribute("role", "group");
                await renderPrefix(entry.path, nested);
              }
              nested.hidden = !nested.hidden;
              return;
            }
            const opened = await source.openEntry(entry.id, scope.signal);
            try {
              root.dispatchEvent(new CustomEvent("modkit-open-source", {
                bubbles: true,
                detail: { source: opened.value, entryId: entry.id, revision: entry.revision }
              }));
            } finally {
              await opened.release();
            }
          };
          button.addEventListener("click", activate);
          scope.cleanup(() => button.removeEventListener("click", activate));
          setViewerText(button, entry.name);
        }
      };
      await renderPrefix("", list);
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset["revision"] = descriptor.revision;
      });
    }
  });
}
var namespaceViewer = createNamespaceViewer();
function formatEntryBytes(value) {
  if (value < 1024n)
    return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let scaled = Number(value) / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(1)} ${units[unit]}`;
}
function describeEntry(entry, localizer) {
  if (entry.kind === "directory")
    return "";
  const parts = [];
  if (entry.size !== void 0)
    parts.push(formatEntryBytes(entry.size));
  if (entry.compression !== void 0) {
    parts.push(entry.storedSize === void 0 ? entry.compression : `${entry.compression} ${formatEntryBytes(entry.storedSize)}`);
  } else if (entry.storedSize !== void 0) {
    parts.push(localizer.text("viewer.storedSize", { size: formatEntryBytes(entry.storedSize) }));
  }
  if (entry.modifiedAt !== void 0) {
    parts.push(`${new Date(entry.modifiedAt).toISOString().replace("T", " ").slice(0, 19)} UTC`);
  }
  if (entry.checksum !== void 0)
    parts.push(`${entry.checksum.algorithm} ${entry.checksum.value}`);
  return parts.join(" \xB7 ");
}

// ../MODDING/modkit-core/packages/ui/dist/image/frames.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var MAX_GRID_FRAMES = 4096;
function gridFrames(width, height, columns, rows) {
  const across = Math.max(1, Math.floor(columns));
  const down = Math.max(1, Math.floor(rows));
  const cellWidth = Math.floor(width / across);
  const cellHeight = Math.floor(height / down);
  if (cellWidth < 1 || cellHeight < 1 || across * down > MAX_GRID_FRAMES)
    return [];
  const frames = [];
  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      frames.push({
        x: column * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
        name: String(frames.length)
      });
    }
  }
  return frames;
}
function shownRegion(region, base, shownWidth, shownHeight) {
  const kx = shownWidth / Math.max(1, base.width);
  const ky = shownHeight / Math.max(1, base.height);
  const x = Math.min(shownWidth - 1, Math.max(0, Math.floor(region.x * kx)));
  const y = Math.min(shownHeight - 1, Math.max(0, Math.floor(region.y * ky)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(shownWidth - x, Math.round(region.width * kx))),
    height: Math.max(1, Math.min(shownHeight - y, Math.round(region.height * ky))),
    ...region.name === void 0 ? {} : { name: region.name }
  };
}
function frameFileName(base, index, count, name) {
  const number = String(index).padStart(Math.max(3, String(count - 1).length), "0");
  const label = name === void 0 || name === String(index) ? "" : name.replace(/[^\w.-]+/gu, "_");
  return `${base}_frame_${number}${label === "" ? "" : `_${label}`}.png`;
}

// ../MODDING/modkit-core/packages/ui/dist/field-editor/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/ui/dist/selector/index.js
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
  const draw = (snapshot2) => {
    if (destroyed)
      return;
    const selected = select.value || options.initial || snapshot2.candidates[0]?.subjectId || "";
    select.replaceChildren();
    if (selected.length > 0 && !snapshot2.candidates.some((item) => item.subjectId === selected)) {
      const initial = document.createElement("option");
      initial.value = selected;
      initial.textContent = selected;
      select.append(initial);
    }
    for (const candidate of snapshot2.candidates) {
      const option = document.createElement("option");
      option.value = candidate.subjectId;
      option.textContent = candidate.label === candidate.subjectId ? candidate.label : `${candidate.label} (${candidate.subjectId})`;
      select.append(option);
    }
    select.value = selected;
    more.hidden = snapshot2.nextCursor === void 0;
    more.disabled = snapshot2.loading || snapshot2.completeness === "capped";
    const state = snapshot2.completeness ?? "partial";
    status.textContent = `${snapshot2.candidates.length}/${snapshot2.summary?.totalSubjects ?? "?"} \xB7 ${state}`;
  };
  const run = async (operation) => {
    problem = void 0;
    try {
      const snapshot2 = await operation();
      draw(snapshot2);
      return snapshot2;
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

// ../MODDING/modkit-core/packages/ui/dist/field-editor/index.js
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

// ../MODDING/modkit-core/packages/ui/dist/image/index.js
var FRAME_PREVIEW_EDGE = 192;
var IMAGE_MAXIMUM_BYTES = 64 * 1024 * 1024;
var IMAGE_MAXIMUM_EXPORTED_SUBRESOURCES = 256;
function convertedFileName(baseName, presetId, ext) {
  const bare = ext.replace(/^\./u, "");
  return presetId === bare ? `${baseName}.${bare}` : `${baseName}.${exportSafeName(presetId)}.${bare}`;
}
var ZERO_SUBRESOURCE = Object.freeze({
  frame: 0,
  mipLevel: 0,
  layer: 0,
  face: 0,
  slice: 0
});
var DECODED_CACHE_BYTES = 4 * IMAGE_MAXIMUM_BYTES;
var axisCount = (info, axis) => {
  if (info === void 0)
    return 1;
  const counts = {
    frame: info.frames,
    mipLevel: info.mipLevels,
    layer: info.layers,
    face: info.faces,
    slice: info.depth
  };
  const value = counts[axis];
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
};
function subresourceExtent(info, mipLevel) {
  return {
    width: Math.max(1, info.width >>> mipLevel),
    height: Math.max(1, info.height >>> mipLevel)
  };
}
function firstShownMip(info) {
  for (let level = 0; level < axisCount(info, "mipLevel"); level += 1) {
    const { width, height } = subresourceExtent(info, level);
    if (width * height * 4 <= IMAGE_MAXIMUM_BYTES)
      return level;
  }
  return 0;
}
function exportSafeName(value) {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/\.{2,}/gu, ".");
  const trimmed = cleaned.replace(/^[^A-Za-z0-9]+/u, "").slice(0, 96);
  return trimmed.length === 0 ? "image" : trimmed;
}
function subresourceLabel(info, subresource) {
  const parts = [`mip${subresource.mipLevel}`];
  if (axisCount(info, "frame") > 1)
    parts.unshift(`frame${subresource.frame}`);
  if (axisCount(info, "layer") > 1)
    parts.push(`layer${subresource.layer}`);
  if (axisCount(info, "face") > 1)
    parts.push(`face${subresource.face}`);
  if (axisCount(info, "slice") > 1)
    parts.push(`slice${subresource.slice}`);
  return parts.join("-");
}
function enumerateSubresources(info, maximum = IMAGE_MAXIMUM_EXPORTED_SUBRESOURCES) {
  const all = [];
  for (let frame = 0; frame < axisCount(info, "frame"); frame += 1) {
    for (let layer = 0; layer < axisCount(info, "layer"); layer += 1) {
      for (let face = 0; face < axisCount(info, "face"); face += 1) {
        for (let mipLevel = 0; mipLevel < axisCount(info, "mipLevel"); mipLevel += 1) {
          const depth = Math.max(1, axisCount(info, "slice") >>> mipLevel);
          for (let slice = 0; slice < depth; slice += 1) {
            if (all.length >= maximum)
              return Object.freeze(all);
            all.push(Object.freeze({ frame, mipLevel, layer, face, slice }));
          }
        }
      }
    }
  }
  return Object.freeze(all);
}
async function loadSubresource(source, info, subresource, signal) {
  const extent = subresourceExtent(info, subresource.mipLevel);
  const decodedBytes = extent.width * extent.height * 4;
  if (info.decodedAccess && source.readRegion !== void 0 && Number.isSafeInteger(decodedBytes) && decodedBytes <= IMAGE_MAXIMUM_BYTES) {
    const region = await source.readRegion({
      x: 0,
      y: 0,
      width: extent.width,
      height: extent.height,
      frame: subresource.frame,
      mipLevel: subresource.mipLevel,
      layer: subresource.layer,
      face: subresource.face,
      slice: subresource.slice,
      pixelFormat: "rgba8",
      maxBytes: IMAGE_MAXIMUM_BYTES
    }, signal);
    const pixels = new Uint8ClampedArray(region.pixels.byteLength);
    pixels.set(region.pixels);
    const bitmap2 = await createImageBitmap(new ImageData(pixels, region.width, region.height));
    return { bitmap: bitmap2, bytes: region.pixels.byteLength };
  }
  if (subresource.frame !== 0 || subresource.mipLevel !== 0 || subresource.layer !== 0 || subresource.face !== 0 || subresource.slice !== 0) {
    throw new TypeError("this image exposes no decoded subresources; only the base image is shown");
  }
  const encoded = await source.encoded(signal);
  const media = await collectEncodedMedia(encoded, IMAGE_MAXIMUM_BYTES, signal);
  const bitmap = await createImageBitmap(new Blob([media.bytes], { type: media.mediaType }));
  return { bitmap, bytes: media.bytes.byteLength };
}
function drawChecker(context, width, height) {
  const cell = 8;
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const even = (x / cell | 0) % 2 === (y / cell | 0) % 2;
      context.fillStyle = even ? "#808080" : "#a0a0a0";
      context.fillRect(x, y, cell, cell);
    }
  }
}
function isolateChannel(context, width, height, channel) {
  if (channel === "rgb")
    return;
  const frame = context.getImageData(0, 0, width, height);
  const data = frame.data;
  const index = channel === "r" ? 0 : channel === "g" ? 1 : channel === "b" ? 2 : 3;
  for (let at = 0; at < data.length; at += 4) {
    const value = data[at + index];
    data[at] = value;
    data[at + 1] = value;
    data[at + 2] = value;
    data[at + 3] = 255;
  }
  context.putImageData(frame, 0, 0);
}
function differenceOf(left, right) {
  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  const output = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const a = (y * left.width + x) * 4;
      const b = (y * right.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[from + channel] = Math.abs(left.data[a + channel] - right.data[b + channel]);
      }
      output.data[from + 3] = 255;
    }
  }
  return output;
}
function metadataGroups(descriptor) {
  return "identity" in descriptor ? descriptor.metadata ?? [] : [];
}
var CHANNELS = ["rgb", "r", "g", "b", "a"];
var viewStates = /* @__PURE__ */ new Map();
var VIEW_STATES = 64;
var RECENT_COLORS_KEY = "image.recentColors";
function rememberedColors() {
  const value = uiPreference(RECENT_COLORS_KEY);
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function rememberColors(colors) {
  rememberUiPreference(RECENT_COLORS_KEY, colors);
}
var CUBE_FACES = ["+X", "\u2212X", "+Y", "\u2212Y", "+Z", "\u2212Z"];
function axisCountAt(info, axis, mipLevel) {
  const count = axisCount(info, axis);
  return axis === "slice" ? Math.max(1, count >>> mipLevel) : count;
}
function createImageViewer(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, IMAGE_FALLBACK_MESSAGES);
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("viewer.image"));
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...args.gallery === void 0 ? {} : { gallery: args.gallery }
      });
      root.append(shell.root);
      scope.cleanup(() => shell.destroy());
      if (args.gallery !== void 0)
        void shell.refreshGallery(scope.signal).catch(() => void 0);
      const stage = element(shell.stage, "div", { part: "image" });
      const canvas = element(stage, "canvas", { part: "image.canvas" });
      canvas.tabIndex = 0;
      canvas.setAttribute("aria-label", localizer.text("viewer.image"));
      const overlay = args.status === void 0 ? element(stage, "div", { part: "image.toolbar", role: "toolbar" }) : void 0;
      overlay?.setAttribute("aria-label", localizer.text("viewer.imageControls"));
      const readout = element(stage, "output", { part: "image.readout" });
      const lease = await unknownSourceLease(args.sources, args.slot, "common.view/raster-image-source");
      if (lease === void 0)
        throw new TypeError("image binding is unavailable");
      scope.lease(lease);
      const source = lease.value;
      let info;
      let model;
      let comparison;
      let subresource = ZERO_SUBRESOURCE;
      let compareWith = ZERO_SUBRESOURCE;
      let compare = "off";
      let zoom = 1;
      let fit = true;
      let panX = 0;
      let panY = 0;
      const background = "checker";
      let channel = "rgb";
      const kept = viewStates.get(args.descriptor.subjectUri);
      if (kept !== void 0)
        ({ zoom, fit, panX, panY, channel } = kept);
      let note = "";
      let fileBytes;
      let descriptor = args.descriptor;
      const decoded = /* @__PURE__ */ new Map();
      let working;
      let workingCanvas;
      let editing;
      let placed = { x: 0, y: 0, width: 1, height: 1, scale: 1 };
      let frameSource = "atlas";
      let gridColumns = 4;
      let gridRows = 4;
      let frameIndex = 0;
      let outlineFrames = false;
      let framesPerSecond = 10;
      let frameTimer;
      let framePreview;
      let frameLabel;
      const usingAtlas = () => frameSource === "atlas" && (info?.atlasRegions?.length ?? 0) > 0;
      const frames = () => info === void 0 ? [] : usingAtlas() ? info.atlasRegions ?? [] : gridFrames(info.width, info.height, gridColumns, gridRows);
      const stopFrames = () => {
        if (frameTimer !== void 0)
          clearInterval(frameTimer);
        frameTimer = void 0;
      };
      scope.cleanup(stopFrames);
      const context = canvas.getContext("2d");
      if (context === null)
        throw new TypeError("2d canvas context is unavailable");
      const key = (value) => `${value.frame}/${value.mipLevel}/${value.layer}/${value.face}/${value.slice}`;
      let decodedBytes = 0;
      const modelFor = async (value) => {
        const cached = decoded.get(key(value));
        if (cached !== void 0)
          return cached;
        if (info === void 0)
          throw new TypeError("image info is unavailable");
        const loaded = await loadSubresource(source, info, value, scope.signal);
        decoded.set(key(value), loaded);
        decodedBytes += loaded.bytes;
        for (const [old, entry] of decoded) {
          if (decodedBytes <= DECODED_CACHE_BYTES || old === key(value))
            break;
          decoded.delete(old);
          decodedBytes -= entry.bytes;
        }
        return loaded;
      };
      let animation;
      let animationFps = 10;
      let animationLoop = true;
      let frameField;
      const stopAnimation = () => {
        animation?.abort();
        animation = void 0;
      };
      scope.cleanup(stopAnimation);
      const animate = async (signal) => {
        const count = axisCount(info, "frame");
        while (!signal.aborted) {
          const started = performance.now();
          if (subresource.frame + 1 >= count && !animationLoop)
            break;
          const next = Object.freeze({ ...subresource, frame: (subresource.frame + 1) % count });
          const shown2 = await modelFor(next);
          if (signal.aborted)
            return;
          subresource = next;
          model = shown2;
          working = void 0;
          workingCanvas = void 0;
          if (frameField !== void 0)
            frameField.value = String(next.frame);
          paint();
          const wait = Math.max(0, 1e3 / animationFps - (performance.now() - started));
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        if (animation?.signal === signal)
          animation = void 0;
        if (!scope.signal.aborted)
          renderSections();
      };
      const bitmapData = (bitmap) => {
        const scratch = root.ownerDocument.createElement("canvas");
        scratch.width = bitmap.width;
        scratch.height = bitmap.height;
        const scratchContext = scratch.getContext("2d");
        if (scratchContext === null)
          throw new TypeError("2d canvas context is unavailable");
        scratchContext.drawImage(bitmap, 0, 0);
        return scratchContext.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const ensureWorking = () => {
        if (working !== void 0)
          return working;
        if (model === void 0)
          return void 0;
        working = bitmapData(model.bitmap);
        workingCanvas = root.ownerDocument.createElement("canvas");
        workingCanvas.width = working.width;
        workingCanvas.height = working.height;
        workingCanvas.getContext("2d")?.putImageData(working, 0, 0);
        return working;
      };
      const shown = () => {
        if (working !== void 0 && workingCanvas !== void 0) {
          return { width: working.width, height: working.height, image: workingCanvas };
        }
        if (model === void 0)
          return void 0;
        return { width: model.bitmap.width, height: model.bitmap.height, image: model.bitmap };
      };
      const fitScale = () => {
        const current = shown();
        if (current === void 0)
          return 1;
        const box = stage.getBoundingClientRect();
        const wide = compare === "side-by-side" && comparison !== void 0;
        const contentWidth = wide ? current.width * 2 + 8 : current.width;
        return Math.min(Math.max(16, box.width) / contentWidth, Math.max(16, box.height) / current.height, 1);
      };
      const currentScale = () => fit ? fitScale() : zoom;
      const formatLabel = () => {
        const encoding = metadataGroups(descriptor).flatMap((group) => group.entries).find((entry) => /^(encoding|format|pixelformat|compression)$/iu.test(entry.key));
        const base = "identity" in descriptor ? descriptor.identity.formatLabel : localizer.text("viewer.image");
        return encoding === void 0 ? base : `${base} \xB7 ${String(encoding.value)}`;
      };
      const formatChoices = () => {
        if (options.exportBytes === void 0)
          return [];
        const groups = /* @__PURE__ */ new Map();
        for (const preset of conversions()) {
          const [head, ...rest] = preset.form.label.split(" \xB7 ");
          const format = (head ?? preset.form.label).trim();
          const encoding = rest.join(" \xB7 ").trim();
          groups.set(format, [
            ...groups.get(format) ?? [],
            { id: `convert:${preset.form.id}`, label: encoding === "" ? format : encoding }
          ]);
        }
        return [
          ...[...groups].map(([format, encodings]) => encodings.length === 1 && encodings[0] !== void 0 ? { id: encodings[0].id, label: format } : { id: `format:${format}`, label: format, choices: encodings })
        ];
      };
      const publishStatus = () => {
        const current = shown();
        if (current === void 0)
          return;
        const scale = currentScale();
        const items = [
          {
            id: "size",
            icon: "symbol-ruler",
            text: `${current.width} \xD7 ${current.height}`,
            tooltip: localizer.text("viewer.imageResizeTitle"),
            align: "start",
            action: editing !== void 0
          },
          {
            id: "format",
            icon: "file",
            text: formatLabel(),
            tooltip: localizer.text("viewer.imageConvert"),
            align: "start",
            choices: formatChoices()
          },
          ...fileBytes === void 0 ? [] : [{ id: "bytes", text: formatEntryBytes(fileBytes), align: "start" }],
          {
            id: "channel",
            icon: "symbol-color",
            text: channel.toUpperCase(),
            tooltip: localizer.text("viewer.imageChannels"),
            align: "end",
            selected: channel,
            choices: CHANNELS.map((value) => ({ id: value, label: value.toUpperCase() }))
          },
          {
            id: "zoom",
            icon: "zoom-in",
            text: fit ? `${localizer.text("viewer.fit")} (${Math.round(scale * 100)}%)` : `${Math.round(scale * 100)}%`,
            tooltip: localizer.text("viewer.fitTitle"),
            align: "end",
            selected: fit ? "fit" : String(zoom),
            choices: [
              { id: "fit", label: localizer.text("viewer.fit") },
              ...MEDIA_ZOOM_CHOICES.map((value) => ({ id: String(value), label: `${value * 100}%` }))
            ]
          }
        ].filter((item) => item.text !== "");
        args.status?.set(items, (itemId, choiceId) => {
          if (itemId === "channel" && CHANNELS.includes(choiceId)) {
            channel = choiceId;
          } else if (itemId === "size") {
            editing?.openResize();
            return;
          } else if (itemId === "format") {
            if (choiceId.startsWith("convert:"))
              runConversion(choiceId.slice("convert:".length));
            return;
          } else if (itemId === "zoom") {
            if (choiceId === "fit") {
              fit = true;
              panX = 0;
              panY = 0;
            } else {
              const value = Number(choiceId);
              if (Number.isFinite(value) && value > 0) {
                fit = false;
                zoom = value;
              }
            }
          }
          paint();
        });
      };
      const paint = (preview, previewRect) => {
        const current = shown();
        if (current === void 0)
          return;
        if (preview !== void 0 && workingCanvas !== void 0 && previewRect !== void 0) {
          workingCanvas.getContext("2d")?.putImageData(preview, 0, 0, previewRect.x, previewRect.y, previewRect.w, previewRect.h);
        }
        const box = stage.getBoundingClientRect();
        const ratio = globalThis.devicePixelRatio || 1;
        const cssWidth = Math.max(1, Math.round(box.width));
        const cssHeight = Math.max(1, Math.round(box.height));
        canvas.width = Math.round(cssWidth * ratio);
        canvas.height = Math.round(cssHeight * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, cssWidth, cssHeight);
        const scale = currentScale();
        const width = Math.max(1, Math.round(current.width * scale));
        const height = Math.max(1, Math.round(current.height * scale));
        const wide = compare === "side-by-side" && comparison !== void 0;
        const gap = wide ? 8 : 0;
        const total = wide ? width * 2 + gap : width;
        const x = Math.round((cssWidth - total) / 2 + panX);
        const y = Math.round((cssHeight - height) / 2 + panY);
        placed = { x, y, width, height, scale };
        const backdrop = (left) => {
          context.save();
          context.beginPath();
          context.rect(left, y, width, height);
          context.clip();
          if (background === "checker") {
            context.translate(left, y);
            drawChecker(context, width, height);
          } else {
            context.fillStyle = background === "dark" ? "#141414" : "#f4f4f4";
            context.fillRect(left, y, width, height);
          }
          context.restore();
        };
        const draw = (image, left) => {
          backdrop(left);
          context.imageSmoothingEnabled = scale < 1;
          context.drawImage(image, left, y, width, height);
        };
        if (compare === "diff" && comparison !== void 0 && model !== void 0) {
          const scratch = root.ownerDocument.createElement("canvas");
          scratch.width = model.bitmap.width;
          scratch.height = model.bitmap.height;
          scratch.getContext("2d")?.putImageData(differenceOf(bitmapData(model.bitmap), bitmapData(comparison.bitmap)), 0, 0);
          draw(scratch, x);
        } else {
          draw(current.image, x);
          if (wide && comparison !== void 0)
            draw(comparison.bitmap, x + width + gap);
        }
        if (channel !== "rgb") {
          const left = Math.max(0, x);
          const top = Math.max(0, y);
          const right = Math.min(cssWidth, x + total);
          const bottom = Math.min(cssHeight, y + height);
          if (right > left && bottom > top) {
            context.save();
            context.setTransform(1, 0, 0, 1, 0, 0);
            const sx = Math.round(left * ratio);
            const sy = Math.round(top * ratio);
            const frame = context.getImageData(sx, sy, Math.max(1, Math.round((right - left) * ratio)), Math.max(1, Math.round((bottom - top) * ratio)));
            const scratch = root.ownerDocument.createElement("canvas");
            scratch.width = frame.width;
            scratch.height = frame.height;
            const scratchContext = scratch.getContext("2d");
            if (scratchContext !== null) {
              scratchContext.putImageData(frame, 0, 0);
              isolateChannel(scratchContext, frame.width, frame.height, channel);
              context.drawImage(scratch, sx, sy);
            }
            context.restore();
          }
        }
        const regions = outlineFrames && info !== void 0 ? frames() : [];
        if (regions.length > 0 && info !== void 0) {
          const unitX = width / info.width;
          const unitY = height / info.height;
          context.save();
          context.strokeStyle = globalThis.getComputedStyle?.(stage).getPropertyValue("--mk-color-accent").trim() || "#3794ff";
          regions.forEach((region, index) => {
            const strong = index === frameIndex;
            context.globalAlpha = strong ? 1 : 0.55;
            context.lineWidth = strong ? 2 : 1;
            context.strokeRect(x + region.x * unitX + context.lineWidth / 2, y + region.y * unitY + context.lineWidth / 2, Math.max(1, region.width * unitX - context.lineWidth), Math.max(1, region.height * unitY - context.lineWidth));
          });
          context.restore();
        }
        drawFramePreview();
        setViewerText(readout, `${compare === "off" ? "" : localizer.text("viewer.imageCompareWith", {
          subresource: subresourceLabel(info, compareWith),
          mode: compare
        })}${note === "" ? "" : `${compare === "off" ? "" : " \xB7 "}${note}`}`);
        readout.hidden = compare === "off" && note === "";
        renderOverlay();
        publishStatus();
        editing?.refresh();
        viewStates.delete(args.descriptor.subjectUri);
        viewStates.set(args.descriptor.subjectUri, { zoom, fit, panX, panY, channel });
        if (viewStates.size > VIEW_STATES) {
          const oldest = viewStates.keys().next().value;
          if (oldest !== void 0)
            viewStates.delete(oldest);
        }
      };
      const drawFramePreview = () => {
        const current = shown();
        const list = frames();
        const region = list[frameIndex];
        if (framePreview === void 0 || current === void 0 || info === void 0)
          return;
        if (region === void 0) {
          framePreview.hidden = true;
          if (frameLabel !== void 0)
            setViewerText(frameLabel, "");
          return;
        }
        framePreview.hidden = false;
        const crop = shownRegion(region, info, current.width, current.height);
        const fitted = Math.min(FRAME_PREVIEW_EDGE / crop.width, FRAME_PREVIEW_EDGE / crop.height);
        const scale = fitted >= 1 ? Math.floor(fitted) : fitted;
        framePreview.width = Math.max(1, Math.round(crop.width * scale));
        framePreview.height = Math.max(1, Math.round(crop.height * scale));
        const preview = framePreview.getContext("2d");
        if (preview === null)
          return;
        preview.imageSmoothingEnabled = scale < 1;
        preview.drawImage(current.image, crop.x, crop.y, crop.width, crop.height, 0, 0, framePreview.width, framePreview.height);
        if (frameLabel !== void 0) {
          const named = region.name !== void 0 && region.name !== String(frameIndex);
          setViewerText(frameLabel, `${localizer.text("viewer.imageFrameLabel", {
            index: frameIndex + 1,
            count: list.length
          })}${named ? ` \xB7 ${region.name}` : ""}`);
        }
      };
      const resize = new ResizeObserver(() => paint());
      resize.observe(stage);
      scope.cleanup(() => resize.disconnect());
      const reload = () => {
        void (async () => {
          try {
            working = void 0;
            workingCanvas = void 0;
            model = await modelFor(subresource);
            comparison = compare === "off" ? void 0 : await modelFor(compareWith);
            note = "";
          } catch (error) {
            note = error instanceof Error ? error.message : String(error);
          }
          renderSections();
          paint();
        })();
      };
      const button = (parent, label, title, onClick, pressed) => {
        const node = element(parent, "button", {
          text: label,
          part: "operations.button"
        });
        node.type = "button";
        node.title = title;
        if (pressed !== void 0)
          node.setAttribute("aria-pressed", String(pressed));
        node.addEventListener("click", () => {
          onClick();
          paint();
        });
        return node;
      };
      const renderOverlay = () => {
        if (overlay === void 0)
          return;
        overlay.replaceChildren();
        button(overlay, localizer.text("viewer.fit"), localizer.text("viewer.fitTitle"), () => {
          fit = true;
          panX = 0;
          panY = 0;
        }, fit);
        button(overlay, "1:1", localizer.text("viewer.actualPixels"), () => {
          fit = false;
          zoom = 1;
        }, !fit && zoom === 1);
        button(overlay, "\u2212", localizer.text("viewer.zoomOut"), () => {
          zoom = Math.max(0.1, currentScale() / 1.5);
          fit = false;
        });
        button(overlay, "+", localizer.text("viewer.zoomIn"), () => {
          zoom = Math.min(32, currentScale() * 1.5);
          fit = false;
        });
        for (const value of CHANNELS) {
          button(overlay, value.toUpperCase(), localizer.text("viewer.isolateChannel", { channel: value.toUpperCase() }), () => {
            channel = value;
          }, channel === value);
        }
        element(overlay, "span", {
          part: "image.readout",
          text: `${Math.round(currentScale() * 100)}%`
        });
      };
      const onWheel = (event) => {
        if (shown() === void 0)
          return;
        event.preventDefault();
        const before = currentScale();
        const next = Math.min(32, Math.max(0.05, before * (event.deltaY < 0 ? 1.25 : 0.8)));
        const box = stage.getBoundingClientRect();
        const cx = event.clientX - box.left - box.width / 2 - panX;
        const cy = event.clientY - box.top - box.height / 2 - panY;
        panX -= cx * (next / before - 1);
        panY -= cy * (next / before - 1);
        fit = false;
        zoom = next;
        paint();
      };
      let dragging;
      let originX = 0;
      let originY = 0;
      const onPointerDown = (event) => {
        if (editing?.pointerDown(event) === true)
          return;
        dragging = event.pointerId;
        originX = event.clientX - panX;
        originY = event.clientY - panY;
        canvas.setPointerCapture(event.pointerId);
      };
      const onPointerMove = (event) => {
        if (editing?.pointerMove(event) === true)
          return;
        if (dragging !== event.pointerId)
          return;
        panX = event.clientX - originX;
        panY = event.clientY - originY;
        paint();
      };
      const onPointerUp = (event) => {
        if (editing?.pointerUp(event) === true)
          return;
        if (dragging !== event.pointerId)
          return;
        dragging = void 0;
        canvas.releasePointerCapture(event.pointerId);
      };
      const onKeyDown = (event) => {
        if (editing?.keyDown(event) !== true)
          return;
        event.preventDefault();
        event.stopPropagation();
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      root.addEventListener("keydown", onKeyDown);
      canvas.addEventListener("dblclick", () => {
        if (editing?.active === true)
          return;
        fit = true;
        panX = 0;
        panY = 0;
        paint();
      });
      scope.cleanup(() => {
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        root.removeEventListener("keydown", onKeyDown);
      });
      const conversions = () => exportOffer(descriptor).flatMap((form) => {
        if (form.writes === void 0)
          return [];
        let input;
        try {
          input = form.build(/* @__PURE__ */ new Map());
        } catch {
          return [];
        }
        return [{ form, input }];
      });
      const runConversion = (formId) => {
        const preset = conversions().find((item) => item.form.id === formId);
        const write = options.exportBytes;
        if (preset === void 0 || write === void 0)
          return;
        const baseName = exportSafeName(options.exportBaseName === void 0 ? "image" : options.exportBaseName(descriptor));
        note = localizer.text("viewer.imageConverting", { preset: preset.form.label });
        paint();
        void (async () => {
          try {
            const result = await args.operations.invoke(preset.form.handlerId, preset.input, {
              signal: scope.signal
            });
            if (result.state !== "ok")
              throw new Error(result.reason);
            const output = result.output;
            if (output.kind !== "bytes" || !(output.value instanceof Uint8Array)) {
              throw new Error(`the codec answered ${output.kind}, not bytes`);
            }
            const writes = preset.form.writes;
            if (writes === void 0)
              throw new Error(`${preset.form.id} declares no write target`);
            const outcome = await write([
              {
                name: convertedFileName(baseName, preset.form.id, writes.extension),
                mediaType: writes.mediaType,
                bytes: output.value
              }
            ], scope.signal);
            note = outcome.state === "written" ? localizer.text("viewer.imageExported", { count: outcome.names.length }) : localizer.text("viewer.imageExportRefused", { reason: outcome.reason });
          } catch (error) {
            note = localizer.text("viewer.imageExportRefused", {
              reason: error instanceof Error ? error.message : String(error)
            });
          }
          paint();
        })();
      };
      const exportFrames = () => {
        const write = options.exportBytes;
        const current = shown();
        const list = frames();
        if (write === void 0 || current === void 0 || info === void 0)
          return;
        if (list.length === 0)
          return;
        const base = info;
        const baseName = exportSafeName(options.exportBaseName === void 0 ? "image" : options.exportBaseName(descriptor));
        note = localizer.text("viewer.imageFramesExporting", { count: list.length });
        paint();
        void (async () => {
          try {
            const scratch = root.ownerDocument.createElement("canvas");
            const scratchContext = scratch.getContext("2d");
            if (scratchContext === null)
              throw new TypeError("2d canvas context is unavailable");
            const files = [];
            for (const [index, region] of list.entries()) {
              const crop = shownRegion(region, base, current.width, current.height);
              scratch.width = crop.width;
              scratch.height = crop.height;
              scratchContext.clearRect(0, 0, crop.width, crop.height);
              scratchContext.drawImage(current.image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
              files.push({
                name: frameFileName(baseName, index, list.length, region.name),
                mediaType: "image/png",
                bytes: await canvasPng(scratch)
              });
            }
            const outcome = await write(files, scope.signal);
            note = outcome.state === "written" ? localizer.text("viewer.imageExported", { count: outcome.names.length }) : localizer.text("viewer.imageExportRefused", { reason: outcome.reason });
          } catch (error) {
            note = localizer.text("viewer.imageExportRefused", {
              reason: error instanceof Error ? error.message : String(error)
            });
          }
          paint();
        })();
      };
      const renderFramesSection = () => {
        if (info === void 0)
          return;
        const atlas = info.atlasRegions ?? [];
        const section = shell.section("frames", localizer.text("viewer.imageSectionFrames"), {
          icon: "symbol-array",
          collapsed: atlas.length === 0
        });
        const settings = element(section.body, "div", {
          part: "image.subresources",
          role: "toolbar"
        });
        const restart = () => {
          frameIndex = 0;
          renderSections();
          paint();
        };
        if (atlas.length > 0) {
          const select = element(settings, "select");
          select.setAttribute("aria-label", localizer.text("viewer.imageFramesSource"));
          for (const [value, label] of [
            ["atlas", localizer.text("viewer.imageFramesAtlas", { count: atlas.length })],
            ["grid", localizer.text("viewer.imageFramesGrid")]
          ]) {
            const option = element(select, "option", { text: label });
            option.value = value;
          }
          select.value = usingAtlas() ? "atlas" : "grid";
          select.addEventListener("change", () => {
            frameSource = select.value === "grid" ? "grid" : "atlas";
            restart();
          });
        }
        if (!usingAtlas()) {
          for (const [label, value, set] of [
            [
              localizer.text("viewer.imageFramesColumns"),
              gridColumns,
              (next) => {
                gridColumns = next;
              }
            ],
            [
              localizer.text("viewer.imageFramesRows"),
              gridRows,
              (next) => {
                gridRows = next;
              }
            ]
          ]) {
            const field = element(settings, "label");
            field.append(label, " ");
            const input = element(field, "input");
            input.type = "number";
            input.min = "1";
            input.max = "256";
            input.value = String(value);
            input.addEventListener("change", () => {
              const next = Number(input.value);
              if (!Number.isInteger(next) || next < 1 || next > 256)
                return;
              set(next);
              frameIndex = 0;
              paint();
            });
          }
        }
        const outline = element(settings, "label");
        const box = element(outline, "input");
        box.type = "checkbox";
        box.checked = outlineFrames;
        outline.append(" ", localizer.text("viewer.imageFramesOutline"));
        box.addEventListener("change", () => {
          outlineFrames = box.checked;
          paint();
        });
        framePreview = element(section.body, "canvas", {
          part: "image.frame-preview"
        });
        const controls = element(section.body, "div", {
          part: "image.subresources",
          role: "toolbar"
        });
        const go = (delta) => {
          const count = frames().length;
          if (count === 0)
            return;
          frameIndex = ((frameIndex + delta) % count + count) % count;
          paint();
        };
        button(controls, "\u25C0", localizer.text("viewer.imageFramePrevious"), () => go(-1));
        frameLabel = element(controls, "span", { part: "image.readout" });
        button(controls, "\u25B6", localizer.text("viewer.imageFrameNext"), () => go(1));
        const play = button(controls, localizer.text(frameTimer === void 0 ? "viewer.play" : "viewer.pause"), localizer.text("viewer.imageFramesPlayTitle"), () => {
          if (frameTimer !== void 0)
            stopFrames();
          else
            frameTimer = setInterval(() => go(1), 1e3 / framesPerSecond);
          play.textContent = localizer.text(frameTimer === void 0 ? "viewer.play" : "viewer.pause");
          play.setAttribute("aria-pressed", String(frameTimer !== void 0));
        }, frameTimer !== void 0);
        const speed = element(controls, "input");
        speed.type = "number";
        speed.min = "1";
        speed.max = "60";
        speed.value = String(framesPerSecond);
        speed.title = localizer.text("viewer.imageFramesFps");
        speed.setAttribute("aria-label", localizer.text("viewer.imageFramesFps"));
        speed.addEventListener("change", () => {
          const next = Number(speed.value);
          if (!Number.isFinite(next) || next < 1 || next > 60)
            return;
          framesPerSecond = next;
          if (frameTimer !== void 0) {
            stopFrames();
            frameTimer = setInterval(() => go(1), 1e3 / framesPerSecond);
          }
        });
        if (options.exportBytes !== void 0) {
          button(controls, localizer.text("viewer.imageFramesExport"), localizer.text("viewer.imageFramesExportTitle"), exportFrames);
        }
      };
      const editSurface = {
        pixels: () => ensureWorking(),
        replace(next) {
          working = next;
          workingCanvas = root.ownerDocument.createElement("canvas");
          workingCanvas.width = next.width;
          workingCanvas.height = next.height;
          workingCanvas.getContext("2d")?.putImageData(next, 0, 0);
          paint();
        },
        show(preview, rect) {
          if (preview === void 0) {
            const current = working;
            if (current !== void 0)
              workingCanvas?.getContext("2d")?.putImageData(current, 0, 0);
            paint();
            return;
          }
          paint(preview, rect);
        },
        toImage(event) {
          const current = shown();
          const box = stage.getBoundingClientRect();
          const scale = placed.scale;
          const x = (event.clientX - box.left - placed.x) / scale;
          const y = (event.clientY - box.top - placed.y) / scale;
          return {
            x: Math.max(0, Math.min(current?.width ?? 0, x)),
            y: Math.max(0, Math.min(current?.height ?? 0, y))
          };
        },
        toScreen(rect) {
          return {
            left: placed.x + rect.x * placed.scale,
            top: placed.y + rect.y * placed.scale,
            width: rect.w * placed.scale,
            height: rect.h * placed.scale
          };
        },
        channel: () => channel
      };
      const saveEdits = async (pixels) => {
        const save = options.savePixels;
        if (save === void 0)
          return;
        note = localizer.text("viewer.imageSaving");
        paint();
        const outcome = await save({
          descriptor,
          operations: args.operations,
          image: {
            width: pixels.width,
            height: pixels.height,
            rgba: new Uint8Array(pixels.data)
          }
        }, scope.signal);
        note = outcome.state === "saved" ? outcome.message : outcome.state === "refused" ? localizer.text("viewer.imageSaveRefused", { reason: outcome.reason }) : "";
        paint();
        if (outcome.state === "refused")
          throw new Error(outcome.reason);
        if (outcome.state !== "saved")
          throw new Error("the host encoded the pixels instead of saving");
      };
      const encodeEdits = async () => {
        const save = options.savePixels;
        const pixels = editSurface.pixels();
        if (save === void 0 || pixels === void 0)
          throw new Error("this image has no edited pixels to encode");
        const outcome = await save({
          descriptor,
          operations: args.operations,
          image: {
            width: pixels.width,
            height: pixels.height,
            rgba: new Uint8Array(pixels.data)
          },
          mode: "bytes"
        }, scope.signal);
        if (outcome.state === "encoded")
          return outcome.bytes;
        throw new Error(outcome.state === "refused" ? outcome.reason : "the host saved instead of encoding");
      };
      let pixelOperations = [];
      const renderPixelOperations = () => {
        const port = options.pixelOperations;
        if (port === void 0 || pixelOperations.length === 0)
          return;
        const sections = /* @__PURE__ */ new Map();
        for (const operation of pixelOperations) {
          sections.set(operation.sectionId, [
            ...sections.get(operation.sectionId) ?? [],
            operation
          ]);
        }
        for (const [sectionId, operations] of sections) {
          const first = operations[0];
          const body = shell.section(sectionId, first.sectionTitle, {
            ...first.icon === void 0 ? {} : { icon: first.icon },
            collapsed: true
          }).body;
          for (const operation of operations) {
            const forms = operationForms(operation.id, operation.id, operation.inputSchema);
            const form = forms[0];
            const row = element(body, "div", { part: "image.operation" });
            element(row, "h3", { part: "image.metadata-group", text: operation.title });
            const controls = /* @__PURE__ */ new Map();
            if (form !== void 0) {
              for (const field of form.fields) {
                const line = element(row, "div", { part: "form.row" });
                element(line, "label", { part: "form.label", text: field.label });
                const slot = element(line, "div", { part: "form.control" });
                void mountFieldEditor(slot, field, scope.signal).then((control) => {
                  controls.set(field.name, control);
                });
              }
            }
            const run = button(row, operation.title, operation.summary, () => {
              const pixels = ensureWorking();
              if (pixels === void 0)
                return;
              let input = {};
              try {
                const values = /* @__PURE__ */ new Map();
                for (const [name, control] of controls)
                  values.set(name, control.read());
                input = form === void 0 ? {} : form.build(values);
              } catch (error) {
                note = error instanceof Error ? error.message : String(error);
                return;
              }
              note = localizer.text("viewer.imageOperationRunning", { operation: operation.title });
              void (async () => {
                const outcome = await port.run(operation.id, input, {
                  width: pixels.width,
                  height: pixels.height,
                  rgba: new Uint8Array(pixels.data)
                }, scope.signal).catch((error) => ({
                  state: "refused",
                  reason: error instanceof Error ? error.message : String(error)
                }));
                if (outcome.state !== "ok") {
                  note = localizer.text("viewer.imageOperationRefused", {
                    reason: outcome.reason
                  });
                  paint();
                  return;
                }
                const next = new ImageData(outcome.image.width, outcome.image.height);
                next.data.set(outcome.image.rgba.subarray(0, next.data.length));
                editing?.applyImage(next);
                note = "";
                paint();
              })();
            });
            run.textContent = localizer.text("viewer.imageOperationRun");
          }
        }
      };
      const renderSections = () => {
        shell.clearSections();
        if (info !== void 0 && model !== void 0) {
          const extent = subresourceExtent(info, subresource.mipLevel);
          mediaFacts(shell.section("image", localizer.text("viewer.imageSectionImage"), { icon: "info" }).body, [
            [localizer.text("viewer.imageDimensions"), `${extent.width} \xD7 ${extent.height}`],
            [localizer.text("viewer.imageAspect"), (extent.width / extent.height).toFixed(3)],
            [
              localizer.text("viewer.imageHasAlpha"),
              info.alphaMode === "none" || info.channels < 4 ? "no" : "yes"
            ]
          ]);
          mediaFacts(shell.section("format", localizer.text("viewer.imageSectionFormat"), { icon: "file" }).body, [
            [localizer.text("viewer.imageFormat"), formatLabel()],
            [localizer.text("viewer.imageMipLevels"), String(axisCount(info, "mipLevel"))],
            [localizer.text("viewer.imageChannels"), `${info.channels} \xD7 ${info.bitDepth}-bit`],
            [localizer.text("viewer.imageColorSpace"), String(info.colorSpace)]
          ]);
          const axes = [
            ["frame", "frame"],
            ["mipLevel", "mip"],
            ["layer", "layer"],
            ["face", "face"],
            ["slice", "slice"]
          ];
          if (axes.some(([axis]) => axisCount(info, axis) > 1)) {
            const body = shell.section("subresource", localizer.text("viewer.imageSubresources"), {
              icon: "layers"
            }).body;
            const bar = element(body, "div", { part: "image.subresources", role: "toolbar" });
            const current = info;
            for (const [axis, name] of axes) {
              if (axisCount(current, axis) <= 1)
                continue;
              const count = axisCountAt(current, axis, subresource.mipLevel);
              const go = (value) => {
                const next = Math.min(count - 1, Math.max(0, value));
                const moved = Object.freeze({ ...subresource, [axis]: next });
                subresource = Object.freeze({
                  ...moved,
                  slice: Math.min(moved.slice, axisCountAt(current, "slice", moved.mipLevel) - 1)
                });
                reload();
              };
              const step = (delta) => go(subresource[axis] + delta);
              button(bar, `${name}\u2212`, localizer.text("viewer.imagePreviousSubresource", { axis: name }), () => step(-1));
              const label = localizer.text("viewer.imageSubresourceIndex", { axis: name });
              if (axis === "face" && count === CUBE_FACES.length) {
                const faces = element(bar, "select");
                faces.setAttribute("aria-label", label);
                faces.title = label;
                for (const [index, face] of CUBE_FACES.entries()) {
                  const option = element(faces, "option", { text: face });
                  option.value = String(index);
                }
                faces.value = String(subresource.face);
                faces.addEventListener("change", () => go(Number(faces.value)));
              } else {
                const field = element(bar, "input", { part: "image.readout" });
                field.type = "number";
                field.min = "0";
                field.max = String(count - 1);
                field.step = "1";
                field.value = String(subresource[axis]);
                field.setAttribute("aria-label", label);
                field.title = label;
                field.addEventListener("change", () => {
                  const value = Number(field.value);
                  if (Number.isInteger(value))
                    go(value);
                  else
                    field.value = String(subresource[axis]);
                });
                element(bar, "span", { part: "image.readout", text: `/${count - 1}` });
                if (axis === "frame")
                  frameField = field;
              }
              button(bar, `${name}+`, localizer.text("viewer.imageNextSubresource", { axis: name }), () => step(1));
              if (axis === "frame") {
                const play = button(bar, animation === void 0 ? "\u25B6" : "\u25A0", localizer.text("viewer.imageFramesPlayTitle"), () => {
                  if (animation === void 0) {
                    const controller = new AbortController();
                    animation = controller;
                    void animate(controller.signal).catch((error) => {
                      note = error instanceof Error ? error.message : String(error);
                      if (animation === controller)
                        animation = void 0;
                      if (!scope.signal.aborted)
                        renderSections();
                    });
                  } else
                    stopAnimation();
                  play.textContent = animation === void 0 ? "\u25B6" : "\u25A0";
                  play.setAttribute("aria-pressed", String(animation !== void 0));
                }, animation !== void 0);
                const fps = element(bar, "input", { part: "image.readout" });
                fps.type = "number";
                fps.min = "1";
                fps.max = "60";
                fps.value = String(animationFps);
                fps.title = localizer.text("viewer.imageFramesFps");
                fps.setAttribute("aria-label", fps.title);
                fps.addEventListener("change", () => {
                  const value = Number(fps.value);
                  if (Number.isFinite(value))
                    animationFps = Math.min(60, Math.max(1, value));
                  fps.value = String(animationFps);
                });
                const loop = element(bar, "label", {});
                const box = element(loop, "input", {});
                box.type = "checkbox";
                box.checked = animationLoop;
                loop.append(" ", localizer.text("viewer.imageFramesLoop"));
                box.addEventListener("change", () => {
                  animationLoop = box.checked;
                });
              }
            }
            if (enumerateSubresources(current).length > 1) {
              button(bar, localizer.text("viewer.imageCompare"), localizer.text("viewer.imageCompareTitle"), () => {
                compare = compare === "off" ? "side-by-side" : compare === "side-by-side" ? "diff" : "off";
                if (compare !== "off" && key(compareWith) === key(subresource)) {
                  compareWith = Object.freeze(axisCount(current, "mipLevel") > 1 ? {
                    ...subresource,
                    mipLevel: Math.min(axisCount(current, "mipLevel") - 1, subresource.mipLevel + 1)
                  } : {
                    ...subresource,
                    frame: (subresource.frame + 1) % axisCount(current, "frame")
                  });
                }
                reload();
              }, compare !== "off");
            }
          }
        }
        renderFramesSection();
        if (options.editing !== false) {
          const section = shell.section("edit", localizer.text("viewer.imageSectionEdit"), {
            icon: "tools",
            collapsed: true
          });
          editing?.destroy();
          const base = subresource.mipLevel === 0 && subresource.layer === 0 && subresource.face === 0 && subresource.slice === 0;
          const frames2 = axisCount(info, "frame");
          const refusal = options.savePixels === void 0 ? options.editableReason : frames2 > 1 ? localizer.text("viewer.imageEditFrames", { count: frames2 }) : !base ? localizer.text("viewer.imageEditBaseOnly", {
            subresource: subresourceLabel(info, subresource)
          }) : options.saveRefusal?.(descriptor);
          const writable = options.savePixels !== void 0 && refusal === void 0;
          editing = createImageEditing(section.body, {
            localizer,
            surface: editSurface,
            overlay: stage,
            editable: writable,
            recentColors: rememberedColors(),
            onRecentColors: rememberColors,
            ...refusal === void 0 ? {} : { unavailableReason: refusal },
            ...writable ? { onSave: saveEdits } : {},
            onDirty(dirty) {
              options.onEditingChange?.(dirty);
            },
            onEdit() {
              options.onEdit?.();
            }
          });
          const surfaceEditing = editing;
          options.registerEditing?.({
            undo: () => surfaceEditing.undo(),
            redo: () => surfaceEditing.redo(),
            save: () => surfaceEditing.save(),
            encode: () => encodeEdits(),
            get dirty() {
              return surfaceEditing.dirty;
            }
          });
          editing.setActive(!section.collapsed);
          section.onToggle((collapsed) => {
            editing?.setActive(!collapsed);
            paint();
          });
        }
        mountContributedSections(shell, options.sections, args, (unmount) => scope.cleanup(unmount));
        renderPixelOperations();
        const groups = metadataGroups(descriptor).filter((group) => !/^(identity|traits|detection)$/iu.test(group.id));
        if (groups.length > 0) {
          const body = shell.section("metadata", localizer.text("viewer.imageSectionMetadata"), {
            icon: "symbol-misc",
            collapsed: true
          }).body;
          for (const group of groups) {
            if (groups.length > 1) {
              element(body, "h3", { part: "image.metadata-group", text: group.label });
            }
            mediaFacts(body, group.entries.map((entry) => [entry.key, String(entry.value)]));
          }
        }
      };
      setState(stage, ["loading"]);
      try {
        pixelOperations = await options.pixelOperations?.list(scope.signal) ?? [];
      } catch {
        pixelOperations = [];
      }
      try {
        info = await source.info(scope.signal);
        const level = info.decodedAccess && source.readRegion !== void 0 ? firstShownMip(info) : 0;
        if (level > 0) {
          subresource = Object.freeze({ ...subresource, mipLevel: level });
          compareWith = subresource;
          note = localizer.text("viewer.imageMipFit", {
            level,
            width: info.width,
            height: info.height
          });
        }
        model = await modelFor(subresource);
        renderSections();
        setState(stage, []);
        paint();
        void source.encoded(scope.signal).then((media) => media.descriptor()).then((value) => {
          if (scope.signal.aborted)
            return;
          fileBytes = value.bytes;
          publishStatus();
        }, () => void 0);
      } catch (error) {
        setState(stage, ["error"]);
        canvas.remove();
        element(stage, "p", {
          part: "viewer.empty",
          text: localizer.text("viewer.imageDecodeError", {
            reason: error instanceof Error ? error.message : String(error)
          })
        });
      }
      scope.cleanup(() => {
        editing?.destroy();
        options.registerEditing?.(void 0);
        args.status?.clear();
      });
      return createViewerMount(root, scope, args, ({ descriptor: next }) => {
        descriptor = next;
        root.dataset["revision"] = next.revision;
        renderSections();
        paint();
      });
    }
  });
}
var imageViewer = createImageViewer();

export {
  subjectCandidateProviderLease,
  mountFieldEditor,
  editOffer,
  exportOffer,
  declaredMutatingOperations,
  invokeRefusalMessage,
  fidelityNote,
  isRejected,
  createNamespaceViewer,
  IMAGE_MAXIMUM_BYTES,
  IMAGE_MAXIMUM_EXPORTED_SUBRESOURCES,
  convertedFileName,
  subresourceExtent,
  firstShownMip,
  exportSafeName,
  subresourceLabel,
  enumerateSubresources,
  differenceOf,
  createImageViewer,
  imageViewer
};
