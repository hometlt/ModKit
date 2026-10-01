/** Portable material programs and playback; scene owns their execution over UVM. */
export {
  MATERIAL_LAYERS_SHADER,
  RENDER_MATERIAL_SHADER,
  createRenderMaterialSampler,
} from './render-model.js'
export type {
  MaterialSampleTime,
  RenderMaterialPass,
  RenderMaterialSampler,
  SceneStandardMaterial,
  MaterialTangentGeneration,
} from './render-model.js'
export type { NormalBlendPolicy, MaterialNormalBasis } from './normal-blending.js'
export { createStandardMaterialPrograms } from './standard-program.js'
export type {
  MaterialLighting,
  MaterialFrameOptions,
  MaterialPixel,
  MaterialTextureBinding,
  StandardMaterialProgram,
} from './standard-program.js'
