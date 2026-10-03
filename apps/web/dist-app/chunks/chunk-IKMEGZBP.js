// packages/sdk/dist/templates/index.js
var GAME_TEMPLATE_PREVIEW_OPERATION_ID = "view.template";
var GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION = 1;
var GAME_TEMPLATE_WORKSPACE_INPUT = "workspaceDocuments";
var finite = (value) => typeof value === "number" && Number.isFinite(value);
var optionalBoolean = (value) => value === void 0 || typeof value === "boolean";
function isGameTemplateTextRun(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const run = value;
  return typeof run["text"] === "string" && (run["color"] === void 0 || typeof run["color"] === "string") && optionalBoolean(run["bold"]) && optionalBoolean(run["italic"]) && optionalBoolean(run["underline"]) && (run["size"] === void 0 || finite(run["size"]) && run["size"] > 0) && (run["asset"] === void 0 || typeof run["asset"] === "string" && run["text"] === "") && (run["unresolved"] === void 0 || typeof run["unresolved"] === "string");
}
function isGameTemplateDisplayItem(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const item = value;
  const rect = item["rect"];
  const text = item["text"];
  return ["box", "text", "image"].includes(String(item["kind"])) && Array.isArray(item["path"]) && item["path"].every((part) => typeof part === "string") && typeof rect === "object" && rect !== null && finite(rect["x"]) && finite(rect["y"]) && finite(rect["width"]) && finite(rect["height"]) && optionalBoolean(item["visible"]) && (text === void 0 || typeof text === "string" || Array.isArray(text) && text.every(isGameTemplateTextRun)) && (item["asset"] === void 0 || typeof item["asset"] === "string") && (item["frameType"] === void 0 || typeof item["frameType"] === "string");
}
function gameTemplateTextRuns(item) {
  if (item.text === void 0)
    return [];
  return typeof item.text === "string" ? [{ text: item.text }] : item.text;
}
var optionalString = (value) => value === void 0 || typeof value === "string";
function isValueSource(value) {
  if (value === void 0)
    return true;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const source = value;
  return optionalString(source["uri"]) && optionalString(source["origin"]) && optionalString(source["frame"]) && (source["start"] === void 0 || finite(source["start"])) && (source["end"] === void 0 || finite(source["end"]));
}
var recordsOk = (list, check) => list === void 0 || Array.isArray(list) && list.every((item) => typeof item === "object" && item !== null && !Array.isArray(item) && check(item));
function isNodeShallow(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const node = value;
  return typeof node["name"] === "string" && optionalString(node["type"]) && optionalString(node["template"]) && isValueSource(node["source"]) && Array.isArray(node["path"]) && node["path"].every((part) => typeof part === "string") && Array.isArray(node["children"]) && recordsOk(node["properties"], (item) => typeof item["name"] === "string" && optionalString(item["val"]) && optionalString(item["resolved"]) && isValueSource(item["source"])) && recordsOk(node["anchors"], (item) => typeof item["side"] === "string" && optionalString(item["relative"]) && optionalString(item["pos"]) && optionalString(item["offset"]) && isValueSource(item["source"]));
}
function isGameTemplateTreeNode(value, maximumNodes = 1e5) {
  const pending = [value];
  let seen = 0;
  while (pending.length > 0) {
    const node = pending.pop();
    if (!isNodeShallow(node) || ++seen > maximumNodes)
      return false;
    for (const child of node.children)
      pending.push(child);
  }
  return true;
}
var nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
function isGameTemplatePreviewResult(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const result = value;
  const fidelity = result["fidelity"];
  return result["schemaVersion"] === GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION && result["operationId"] === GAME_TEMPLATE_PREVIEW_OPERATION_ID && nonEmpty(result["templateKind"]) && nonEmpty(result["entryUri"]) && (result["rootPath"] === void 0 || typeof result["rootPath"] === "string") && (result["roots"] === void 0 || Array.isArray(result["roots"]) && result["roots"].every((root) => typeof root === "string")) && typeof result["resolvedTree"] === "object" && result["resolvedTree"] !== null && Array.isArray(result["displayItems"]) && Array.isArray(result["diagnostics"]) && ["complete", "partial", "capped", "invalid"].includes(String(result["completeness"])) && typeof fidelity === "object" && fidelity !== null && !Array.isArray(fidelity) && fidelity["comparison"] === "semantic" && Array.isArray(fidelity["unsupported"]) && result["provenance"] !== void 0 && result["digest"] !== void 0;
}

export {
  GAME_TEMPLATE_PREVIEW_OPERATION_ID,
  GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION,
  GAME_TEMPLATE_WORKSPACE_INPUT,
  isGameTemplateTextRun,
  isGameTemplateDisplayItem,
  gameTemplateTextRuns,
  isGameTemplateTreeNode,
  isGameTemplatePreviewResult
};
