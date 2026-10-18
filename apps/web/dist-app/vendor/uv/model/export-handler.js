import {
  diagnostic
} from "../../../chunks/chunk-22GOWHCF.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/uv/dist/model/export-handler.js
function createUvmExportHandler(projection, context, options) {
  return async (input, invocation) => {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      throw new TypeError("model.export-uvm requires { schemaVersion: 1 }");
    const request = input;
    if (request["schemaVersion"] !== 1 || Object.keys(request).some((key) => key !== "schemaVersion" && !(options.allowUnitOverride === true && key === "metersPerSourceUnit")))
      throw new TypeError("model.export-uvm has an unsupported schema or option");
    const metersPerSourceUnit = options.allowUnitOverride === true ? request["metersPerSourceUnit"] === void 0 ? options.metersPerSourceUnit : request["metersPerSourceUnit"] : options.metersPerSourceUnit;
    if (typeof metersPerSourceUnit !== "number" || !Number.isFinite(metersPerSourceUnit) || metersPerSourceUnit <= 0)
      throw new TypeError("metersPerSourceUnit must be positive and finite");
    const signal = invocation.signal ?? context.signal;
    signal?.throwIfAborted();
    const { materializeUvmCore } = await import("./materializer.js");
    signal?.throwIfAborted();
    const result = materializeUvmCore(projection, {
      scope: { scopeId: "model-interchange-v1", version: "1.0.0" },
      profile: "UVM/core@1.0",
      subjectRevision: context.source.revision,
      options: {
        assetId: context.source.ref.id,
        sourceFormat: options.sourceFormat,
        units: { metersPerSourceUnit, sourceUnit: options.sourceUnit }
      }
    }, {
      materialBudget: {
        maxBytes: context.budget.maxScalarBytes,
        maxNodes: context.budget.maxNodes,
        maxDepth: context.budget.maxDepth
      },
      ...options.animationBudget === void 0 ? {} : { animationBudget: options.animationBudget },
      ...signal === void 0 ? {} : { signal }
    });
    invocation.reportDiagnostic?.(diagnostic("information", "common.uvm/export-projection-receipt", "Canonical UVM projection receipt for this export.", void 0, result.receipt));
    return { kind: "bytes", value: result.bytes.slice() };
  };
}
export {
  createUvmExportHandler
};
