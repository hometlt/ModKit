// ../../MODDING/modkit-core/packages/codec-kit/dist/projection.js
var PROJECTION_RECEIPT_METADATA_ID = "uv-projection-receipt";
var PLANE_STATES = /* @__PURE__ */ new Set(["normalized", "preserved", "inferred", "lost"]);
var CONFIDENCES = /* @__PURE__ */ new Set(["exact", "high", "partial", "heuristic"]);
function createProjectionReceipt(receipt) {
  const planes = [...receipt.planes ?? []];
  if (planes.length === 0)
    throw new TypeError("a projection receipt must record at least one plane");
  for (const plane of planes) {
    if (!PLANE_STATES.has(plane.state)) {
      throw new TypeError(`projection plane \xAB${plane.planeId}\xBB has an unknown state ${plane.state}`);
    }
  }
  if (!CONFIDENCES.has(receipt.confidence)) {
    throw new TypeError(`projection receipt has an unknown confidence ${receipt.confidence}`);
  }
  if ((receipt.evidence ?? []).length === 0) {
    throw new TypeError("a projection receipt made of no evidence is a claim with nothing behind it; state at least one declared or observed fact");
  }
  return Object.freeze({
    form: "local",
    adapter: Object.freeze({ ...receipt.adapter }),
    subjectRevision: receipt.subjectRevision,
    companions: Object.freeze((receipt.companions ?? []).map((item) => Object.freeze({ ...item }))),
    basis: Object.freeze({ ...receipt.basis }),
    planes: Object.freeze(planes.map((plane) => Object.freeze({ ...plane }))),
    evidence: Object.freeze(receipt.evidence.map((item) => Object.freeze({ ...item }))),
    confidence: receipt.confidence,
    ...receipt.semanticHash === void 0 ? {} : { semanticHash: receipt.semanticHash },
    ...receipt.sourceUri === void 0 ? {} : { sourceUri: receipt.sourceUri }
  });
}

export {
  PROJECTION_RECEIPT_METADATA_ID,
  createProjectionReceipt
};
