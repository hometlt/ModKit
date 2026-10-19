/** Portable scene processing; this entrypoint imports no DOM, GPU, host or native codec runtime. */
export {
  createModelSceneSampler,
  type ModelSceneCamera,
  type ModelSceneProjection,
  type ModelRenderJoint,
} from './sampler.js'
export { preserveUnweightedVertices, type GeneratedSkinBinding } from './unweighted.js'
export { expandOrderedEulerNode, type OrderedEulerKey } from './ordered-euler.js'
export { decomposeMatrix4 } from './billboard-math.js'
export { modelMaterialTeamColor } from './team-color.js'
export { applyModelAimConstraints, validateModelAimConstraints, type ModelAimConstraint, type ModelAimPart } from './aim.js'
export {
  createVoxelBindingSurface,
  type VoxelSkinSurfaceMesh,
  type VoxelSkinSurfaceOptions,
} from './voxel-surface.js'
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
