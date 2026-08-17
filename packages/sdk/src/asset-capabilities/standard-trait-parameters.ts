/** Typed parameter profiles for standard media traits. Unknown standard traits stay JsonValue. */

import type { TraitInstanceFor } from './types.js'
import type { JsonValue } from './types.js'
import type { StandardTraitId } from './standard-traits.js'

export interface StandardTraitParameterMap {
  readonly 'image.raster': {
    readonly width: number
    readonly height: number
    readonly depth?: number
    readonly bitDepth?: number
  }
  readonly 'image.channels': {
    readonly count: number
    readonly alpha: boolean
  }
  readonly 'image.mipmaps': { readonly levels: number }
  readonly 'image.subresources': {
    readonly layers: number
    readonly faces: number
    readonly slices?: number
  }
  readonly 'image.compressed-blocks': {
    readonly format: string
    readonly blockWidth?: number
    readonly blockHeight?: number
  }
  readonly 'image.frames': { readonly count: number }
  readonly 'image.palette': { readonly indexed: boolean; readonly entries?: number }
  readonly 'image.color-profile': { readonly name: string }
  readonly 'vector.scene': { readonly nodes: number }
  readonly 'vector.paths': { readonly count: number }
  readonly 'vector.shapes': { readonly count: number }
  readonly 'vector.text': { readonly count: number }
  readonly 'vector.gradients': { readonly count: number }
  readonly 'model.geometry': {
    readonly meshes?: number
    readonly vertices?: number
    readonly triangles?: number
    readonly bounds?: {
      readonly min: readonly [number, number, number]
      readonly max: readonly [number, number, number]
    }
  }
  readonly 'model.materials': {
    readonly count?: number
    readonly named?: number
    readonly libraries?: number
  }
  readonly 'model.textures': { readonly textures: number; readonly images?: number }
  readonly 'model.skeleton': { readonly skins: number }
  readonly 'model.animations': { readonly count: number }
  readonly 'model.lods': { readonly levels: number }
  readonly 'scene.objects': { readonly scenes: number; readonly nodes: number }
  readonly 'audio.streams': {
    readonly count: number
    readonly codec?: string
    readonly codecs?: readonly string[]
    readonly sampleRate?: number
    readonly channels?: number
  }
  readonly 'audio.waveform': { readonly sampleRate: number; readonly channels: number }
  readonly 'audio.loop-points': { readonly startFrame: string; readonly endFrame: string }
  readonly 'video.streams': { readonly count: number }
  readonly 'video.tracks': { readonly tracks: number }
  readonly 'media.duration': { readonly milliseconds: number; readonly estimated?: boolean }
  readonly 'media.frames': { readonly count: number; readonly frameRate?: number }
  readonly 'media.seekable': { readonly value: boolean }
}

export type TypedStandardTraitId = keyof StandardTraitParameterMap

export type StandardTraitParameters<Id extends StandardTraitId> = Id extends TypedStandardTraitId
  ? StandardTraitParameterMap[Id]
  : JsonValue

export type StandardTraitInstance<Id extends StandardTraitId = StandardTraitId> =
  Id extends StandardTraitId ? TraitInstanceFor<Id, StandardTraitParameters<Id> & JsonValue> : never
