export { openUvmDocument } from './document.js'
export { createUvmConversionCache } from './conversion-cache.js'
export type { UvmConversionCache } from './conversion-cache.js'
export { prepareUvmAnimationAttachmentRequest } from './animation-operation.js'
export { composeUvmAnimationBundle, attachUvmAnimationBundle } from './animation-attachment.js'
export type {
  UvmAnimationAttachmentRequest,
  UvmAnimationAttachmentOptions,
  UvmAnimationAttachmentResult,
  UvmAnimationTargetMap,
  UvmAnimationMaterialTargetMap,
  UvmAnimationPrimitiveTarget,
} from './animation-attachment.js'
export { prepareUvmFieldWrite, prepareUvmJsonEdits, prepareUvmEditRequest } from './operations.js'
export type {
  UvmDocument,
  UvmDocumentOptions,
  UvmDocumentEdit,
  UvmDocumentReplacement,
  UvmDocumentStatus,
  UvmBinaryEdit,
  UvmJsonEdit,
} from './document.js'
export { createUvmJsonEditInputSchema } from './edit-input-schema.js'
export { readUvmBillboards, UVM_NODE_BILLBOARD } from './billboards.js'
export { readUvmModelStates, UVM_GAME_MODEL_STATES } from './model-states.js'
export type { UvmModelState } from './model-states.js'
export {
  addUvmShadowMeshes,
  readUvmShadowMeshBindings,
  UVM_MODEL_SHADOW_MESHES,
} from './shadow-meshes.js'
export type { UvmShadowMeshInput, UvmShadowMeshBinding } from './shadow-meshes.js'
export {
  addUvmOrderedEulerChains,
  readUvmOrderedEulerChains,
  UVM_ORDERED_EULER_CHAINS,
} from './ordered-euler-chains.js'
export type { UvmOrderedEulerChain } from './ordered-euler-chains.js'
