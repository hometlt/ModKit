// packages/sdk/dist/templates/index.js
var GAME_TEMPLATE_PREVIEW_OPERATION_ID = "view.template";
var GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION = 1;
var nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
function isGameTemplatePreviewResult(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const result = value;
  const fidelity = result["fidelity"];
  return result["schemaVersion"] === GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION && result["operationId"] === GAME_TEMPLATE_PREVIEW_OPERATION_ID && nonEmpty(result["templateKind"]) && nonEmpty(result["entryUri"]) && (result["rootPath"] === void 0 || typeof result["rootPath"] === "string") && typeof result["resolvedTree"] === "object" && result["resolvedTree"] !== null && Array.isArray(result["displayItems"]) && Array.isArray(result["diagnostics"]) && ["complete", "partial", "capped", "invalid"].includes(String(result["completeness"])) && typeof fidelity === "object" && fidelity !== null && !Array.isArray(fidelity) && fidelity["comparison"] === "semantic" && Array.isArray(fidelity["unsupported"]) && result["provenance"] !== void 0 && result["digest"] !== void 0;
}

export {
  GAME_TEMPLATE_PREVIEW_OPERATION_ID,
  GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION,
  isGameTemplatePreviewResult
};
