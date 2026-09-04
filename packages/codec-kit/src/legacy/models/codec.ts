import type { ModelParser, RenderModel } from '../../legacy-model-support.js'
import {
  FormatRegistry,
  normalizeFormatExtension,
  type AssetRequest,
  type AssetResolver,
  type CompanionSpec,
  type FormatRegistration,
} from '../../legacy-model-assets-support.js'

export type { AssetRequest, AssetResolver, CompanionSpec, FormatRegistration }
export { FormatRegistry, normalizeFormatExtension }

// P12 codec architecture (PLAN_m3_renderer.md section 5, decision 3).
// Formats are codecs: extension + magic resolution, lazily loaded, read-first,
// capability-reported. The registry is the only integration point — adding a format
// never touches viewer or renderer code.
//
// FormatRegistry/FormatRegistration/AssetResolver/AssetRequest/CompanionSpec live in
// @modkitx/assets — they're domain-neutral and shared by every <domain>-processing
// package (archives, image, audio, video), not model-specific.

export interface ModelCodecCapabilities {
  skeleton: boolean
  animations: boolean
  effects: boolean
  /** Format supports external animation bundles (e.g. `.m3a`). */
  externalAnimations?: boolean
  /**
   * Sidecar file patterns the codec may need next to the model file.
   * Extension form (".mtl", ".uexp") or glob-lite ("*.m3a").
   */
  sidecars?: readonly string[]
  encode?: boolean
}

export interface CodecIssue {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
}

export interface ModelEncodeResult {
  /** Primary encoded model bytes. */
  bytes: Uint8Array
  /** Companion files such as OBJ material libraries and referenced textures. */
  files?: ModelEncodedFile[]
  issues: CodecIssue[]
}

export interface ModelEncodedFile {
  /** Portable path relative to the primary model's output directory. */
  path: string
  bytes: Uint8Array
  role?: 'material' | 'texture' | 'animation' | 'metadata' | 'other'
}

export interface ModelEncodeOptions {
  /** Desired basename of the primary output file. */
  fileName?: string
  /** Uniform scale applied during encode. */
  scale?: number
  /** Optional exported animation names, index-aligned with `RenderModel.animations`. */
  animationNames?: readonly string[]
  /** Source up-axis, converted to the target format's convention by the encoder. */
  upAxis?: 'y' | 'z'
  /** Resolve texture/animation companions when the target can copy them. */
  assetResolver?: AssetResolver
  /** Copy resolved texture companions into `ModelEncodeResult.files`. Defaults to true. */
  includeTextures?: boolean
  [key: string]: unknown
}

export interface ModelExportTarget {
  id: string
  displayName: string
  extension: string
  capabilities: ModelCodecCapabilities
}

export interface TextureRequest {
  /** Texture path exactly as referenced by the model (unnormalized). */
  path: string
  /** Which material slot references it (e.g. "diffuse", "normal"). */
  slot?: string
  materialIndex?: number
}

export interface ModelCodec extends ModelParser {
  readonly id: string
  readonly displayName?: string
  /** Lowercase extensions with the leading dot, e.g. [".m3"]. */
  readonly extensions: readonly string[]
  readonly capabilities: ModelCodecCapabilities
  encode?(
    model: RenderModel,
    options?: ModelEncodeOptions,
  ): Promise<ModelEncodeResult> | ModelEncodeResult
  /** Texture paths the model references; defaults to walking material layers. */
  listTextureRequests?(model: RenderModel): TextureRequest[]
}

export type ModelCodecLoader = () => Promise<ModelCodec> | ModelCodec

export type ModelCodecRegistration = FormatRegistration<ModelCodec>

export class ModelCodecRegistry extends FormatRegistry<ModelCodec> {
  constructor() {
    super('model codec')
  }

  /** Load registered codecs and expose only formats that can encode RenderModel. */
  async listExportTargets(): Promise<ModelExportTarget[]> {
    const targets: ModelExportTarget[] = []
    for (const registration of this.list()) {
      const codec = await this.load(registration.id)
      if (!codec.encode || codec.capabilities.encode !== true) continue
      targets.push({
        id: codec.id,
        displayName: codec.displayName ?? codec.id,
        extension: codec.extensions[0] ?? registration.extensions[0] ?? '',
        capabilities: codec.capabilities,
      })
    }
    return targets
  }

  /** Encode through a target codec id or extension (for example `m3` / `.obj`). */
  async encode(
    target: string,
    model: RenderModel,
    options: ModelEncodeOptions = {},
  ): Promise<ModelEncodeResult> {
    const normalized = normalizeFormatExtension(target)
    const registration = normalized ? this.matchByExtension(normalized)[0] : this.get(target)
    if (!registration) throw new Error(`Unknown model export target "${target}"`)
    const codec = await this.load(registration.id)
    if (!codec.encode || codec.capabilities.encode !== true) {
      throw new Error(`Model codec "${codec.id}" does not support export`)
    }
    return codec.encode(model, options)
  }
}

/** Walk RenderModel material layers — the default listTextureRequests implementation. */
export function listRenderModelTextureRequests(model: RenderModel): TextureRequest[] {
  const requests: TextureRequest[] = []
  const seen = new Set<string>()
  for (let materialIndex = 0; materialIndex < model.materials.length; materialIndex += 1) {
    const material = model.materials[materialIndex]
    if (!material) continue
    for (const layer of material.layers) {
      if (!layer.path) continue
      const key = `${materialIndex}:${layer.label}:${layer.path.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      requests.push({ path: layer.path, slot: layer.label, materialIndex })
    }
    const standard = material.standard
    if (standard) {
      for (const [slot, layer] of Object.entries(standard.layers)) {
        if (!layer?.texturePath) continue
        const key = `${materialIndex}:${slot}:${layer.texturePath.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        requests.push({ path: layer.texturePath, slot, materialIndex })
      }
    }
  }
  return requests
}
