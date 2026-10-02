// Narrow import seam for the pinned model registry. This only recomposes already accepted
// neutral asset contracts; it does not register or activate a concrete codec.
export type { AssetRequest, AssetResolver, CompanionSpec } from './legacy/assets/companions.js'
export {
  FormatRegistry,
  normalizeFormatExtension,
  type FormatRegistration,
} from './legacy/assets/format-registry.js'
export type { CompressedTextureDescriptorV1 } from '@modkit/sdk'
