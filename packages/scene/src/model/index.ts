/** Portable scene processing; this entrypoint imports no DOM, GPU, host or native codec runtime. */
export {
  createModelSceneSampler,
  type ModelSceneProjection,
  type ModelRenderJoint,
} from './sampler.js'
export { preserveUnweightedVertices, type GeneratedSkinBinding } from './unweighted.js'
export { expandOrderedEulerNode, type OrderedEulerKey } from './ordered-euler.js'
export {
  applyModelBillboards,
  applyModelFaceCameraBillboard,
  billboardCameraRotation,
  snapshotModelBillboards,
  type BillboardPosition,
  type BillboardRotation,
  type ModelBillboardConstraint,
  type ModelFaceCameraBillboardConstraint,
  type ModelInverseCameraBillboardConstraint,
} from './billboards.js'
