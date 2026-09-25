import {
  collectEncodedMedia
} from "./chunk-XYGFUUGH.js";
import {
  exportOffer,
  mountFieldEditor,
  operationForms
} from "./chunk-T7WKIGHN.js";
import {
  IMAGE_EDITING_FALLBACK_MESSAGES,
  IMAGE_FALLBACK_MESSAGES,
  ViewerMountScope,
  createMediaShell,
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setPart,
  setState,
  setViewerText,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-EYZUVLIL.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// packages/ui/dist/image/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// packages/ui/dist/image-editing/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var IMAGE_EDIT_UNDO_DEPTH = 100;
var TOOL_ICONS = Object.freeze({
  select: `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="2.5" width="11" height="11" rx=".5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 2"/></svg>`,
  brush: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M12.1 1.9a1.6 1.6 0 0 1 2 2.4L7.8 10.6a2.4 2.4 0 0 1-1.5.7l-2.1.2.2-2.1c.1-.6.4-1.1.7-1.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.2 11.4c.2 1.6-1 2.8-2.6 2.8.6-1 .8-2.2.5-3.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  eraser: `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="3.6" y="6.3" width="9.6" height="5.2" rx="1" transform="rotate(-25 8.4 8.9)" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.6 11.6h6.4" stroke="currentColor" stroke-width="1" transform="rotate(-25 8.4 8.9)"/></svg>`,
  line: `<svg viewBox="0 0 16 16" width="16" height="16"><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="3" cy="13" r="1.2" fill="currentColor"/><circle cx="13" cy="3" r="1.2" fill="currentColor"/></svg>`,
  rect: `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  ellipse: `<svg viewBox="0 0 16 16" width="16" height="16"><ellipse cx="8" cy="8" rx="5.4" ry="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  fill: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 7.6 8.4 2.2l5 5-5.3 5.3a2.7 2.7 0 0 1-3.8 0L3 11.2a2.7 2.7 0 0 1 0-3.6Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.3 8.1h9.4" stroke="currentColor" stroke-width="1"/><circle cx="13" cy="12.2" r="1.4" fill="currentColor"/></svg>`,
  gradient: `<svg viewBox="0 0 16 16" width="16" height="16"><defs><linearGradient id="mk-edit-tool-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="url(#mk-edit-tool-gradient)" stroke="currentColor" stroke-width="1.1"/></svg>`,
  eyedropper: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M11.1 2.3 13.7 4.9 6.3 12.3 3.4 12.9l.6-2.9Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.1 4.3 11.7 6.9" stroke="currentColor" stroke-width="1"/><circle cx="3.7" cy="12.3" r=".7" fill="currentColor"/></svg>`
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
      const template = document.createElement("template");
      template.innerHTML = content;
      button.append(template.content);
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

// packages/ui/dist/image/index.js
var IMAGE_MAXIMUM_BYTES = 64 * 1024 * 1024;
var IMAGE_MAXIMUM_EXPORTED_SUBRESOURCES = 256;
function convertedFileName(baseName, presetId, ext) {
  return presetId === ext ? `${baseName}.${ext}` : `${baseName}.${exportSafeName(presetId)}.${ext}`;
}
var ZERO_SUBRESOURCE = Object.freeze({
  mipLevel: 0,
  layer: 0,
  face: 0,
  slice: 0
});
var axisCount = (info, axis) => {
  if (info === void 0)
    return 1;
  const counts = {
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
function exportSafeName(value) {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/\.{2,}/gu, ".");
  const trimmed = cleaned.replace(/^[^A-Za-z0-9]+/u, "").slice(0, 96);
  return trimmed.length === 0 ? "image" : trimmed;
}
function subresourceLabel(info, subresource) {
  const parts = [`mip${subresource.mipLevel}`];
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
  for (let layer = 0; layer < axisCount(info, "layer"); layer += 1) {
    for (let face = 0; face < axisCount(info, "face"); face += 1) {
      for (let mipLevel = 0; mipLevel < axisCount(info, "mipLevel"); mipLevel += 1) {
        const depth = Math.max(1, axisCount(info, "slice") >>> mipLevel);
        for (let slice = 0; slice < depth; slice += 1) {
          if (all.length >= maximum)
            return Object.freeze(all);
          all.push(Object.freeze({ mipLevel, layer, face, slice }));
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
      frame: 0,
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
  if (subresource.mipLevel !== 0 || subresource.layer !== 0 || subresource.face !== 0 || subresource.slice !== 0) {
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
var ZOOM_CHOICES = [0.25, 0.5, 1, 2, 4, 8];
var CHANNELS = ["rgb", "r", "g", "b", "a"];
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
      let note = "";
      let descriptor = args.descriptor;
      const decoded = /* @__PURE__ */ new Map();
      let working;
      let workingCanvas;
      let editing;
      let placed = { x: 0, y: 0, width: 1, height: 1, scale: 1 };
      const context = canvas.getContext("2d");
      if (context === null)
        throw new TypeError("2d canvas context is unavailable");
      const key = (value) => `${value.mipLevel}/${value.layer}/${value.face}/${value.slice}`;
      const modelFor = async (value) => {
        const cached = decoded.get(key(value));
        if (cached !== void 0)
          return cached;
        if (info === void 0)
          throw new TypeError("image info is unavailable");
        const loaded = await loadSubresource(source, info, value, scope.signal);
        decoded.set(key(value), loaded);
        return loaded;
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
        const bytes = model?.bytes ?? 0;
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
          { id: "bytes", text: `${(bytes / 1024).toFixed(1)} KiB`, align: "start" },
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
              ...ZOOM_CHOICES.map((value) => ({ id: String(value), label: `${value * 100}%` }))
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
        setViewerText(readout, `${compare === "off" ? "" : localizer.text("viewer.imageCompareWith", {
          subresource: subresourceLabel(info, compareWith),
          mode: compare
        })}${note === "" ? "" : `${compare === "off" ? "" : " \xB7 "}${note}`}`);
        readout.hidden = compare === "off" && note === "";
        renderOverlay();
        publishStatus();
        editing?.refresh();
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
      const facts = (parent, rows) => {
        const list = element(parent, "dl", { part: "image.metadata" });
        for (const [label, value] of rows) {
          const row = element(list, "div", { part: "metadata.row" });
          element(row, "dt", { text: label, part: "metadata.label" });
          const cell = element(row, "dd", { part: "metadata.value" });
          setViewerText(cell, value, 512);
        }
      };
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
        note = outcome.state === "saved" ? outcome.message : localizer.text("viewer.imageSaveRefused", { reason: outcome.reason });
        paint();
        if (outcome.state !== "saved")
          throw new Error(outcome.reason);
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
          facts(shell.section("image", localizer.text("viewer.imageSectionImage"), { icon: "info" }).body, [
            [localizer.text("viewer.imageDimensions"), `${extent.width} \xD7 ${extent.height}`],
            [localizer.text("viewer.imageAspect"), (extent.width / extent.height).toFixed(3)],
            [
              localizer.text("viewer.imageHasAlpha"),
              info.alphaMode === "none" || info.channels < 4 ? "no" : "yes"
            ]
          ]);
          facts(shell.section("format", localizer.text("viewer.imageSectionFormat"), { icon: "file" }).body, [
            [localizer.text("viewer.imageFormat"), formatLabel()],
            [localizer.text("viewer.imageMipLevels"), String(axisCount(info, "mipLevel"))],
            [localizer.text("viewer.imageChannels"), `${info.channels} \xD7 ${info.bitDepth}-bit`],
            [localizer.text("viewer.imageColorSpace"), String(info.colorSpace)]
          ]);
          const axes = [
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
              const count = axisCount(current, axis);
              if (count <= 1)
                continue;
              const step = (delta) => {
                const next = Math.min(count - 1, Math.max(0, subresource[axis] + delta));
                subresource = Object.freeze({ ...subresource, [axis]: next });
                reload();
              };
              button(bar, `${name}\u2212`, localizer.text("viewer.imagePreviousSubresource", { axis: name }), () => step(-1));
              element(bar, "span", {
                part: "image.readout",
                text: `${subresource[axis]}/${count - 1}`
              });
              button(bar, `${name}+`, localizer.text("viewer.imageNextSubresource", { axis: name }), () => step(1));
            }
            if (enumerateSubresources(current).length > 1) {
              button(bar, localizer.text("viewer.imageCompare"), localizer.text("viewer.imageCompareTitle"), () => {
                compare = compare === "off" ? "side-by-side" : compare === "side-by-side" ? "diff" : "off";
                if (compare !== "off" && key(compareWith) === key(subresource)) {
                  compareWith = Object.freeze({
                    ...subresource,
                    mipLevel: Math.min(axisCount(current, "mipLevel") - 1, subresource.mipLevel + 1)
                  });
                }
                reload();
              }, compare !== "off");
            }
          }
        }
        if (options.editing !== false) {
          const section = shell.section("edit", localizer.text("viewer.imageSectionEdit"), {
            icon: "tools",
            collapsed: true
          });
          editing?.destroy();
          editing = createImageEditing(section.body, {
            localizer,
            surface: editSurface,
            overlay: stage,
            editable: options.savePixels !== void 0,
            ...options.editableReason === void 0 ? {} : { unavailableReason: options.editableReason },
            ...options.savePixels === void 0 ? {} : { onSave: saveEdits },
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
        for (const contributed of options.sections ?? []) {
          const section = shell.section(contributed.id, contributed.title, {
            ...contributed.icon === void 0 ? {} : { icon: contributed.icon },
            collapsed: contributed.collapsed ?? true
          });
          void contributed.module.mount({ ...args, container: section.body }).then((mounted) => {
            scope.cleanup(() => void mounted.unmount());
          }).catch(() => section.root.remove());
        }
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
            facts(body, group.entries.map((entry) => [entry.key, String(entry.value)]));
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
        model = await modelFor(subresource);
        renderSections();
        setState(stage, []);
        paint();
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
  IMAGE_MAXIMUM_BYTES,
  IMAGE_MAXIMUM_EXPORTED_SUBRESOURCES,
  convertedFileName,
  subresourceExtent,
  exportSafeName,
  subresourceLabel,
  enumerateSubresources,
  differenceOf,
  createImageViewer,
  imageViewer
};
