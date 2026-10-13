/** Format-neutral export of a UVM scene into an installed native model format. */

import type { JsonValue } from './asset-capabilities/types.js'
import type { Diagnostic } from '@modkit/core'
import type { ServiceProviderModule } from './runtime-abi.js'

export const NATIVE_MODEL_ENCODER_CONTRACT = 'common.model/native-encoder' as const
export const NATIVE_MODEL_ENCODER_MATCHER_PROFILE = 'modkit/native-model-encoder-matcher' as const

export interface NativeModelEncoderOfferFacet {
  readonly formatIds: readonly string[]
}

export interface NativeModelEncoderRequestFacet {
  readonly formatId: string
}

export interface NativeModelEncodeRequest {
  /** Complete UVM/extended-GLB document. The encoder never receives another native format. */
  readonly uvm: Uint8Array
  readonly options?: JsonValue
  readonly signal?: AbortSignal
}

export interface NativeModelEncodeResult {
  readonly formatId: string
  readonly extension: string
  readonly mediaType?: string
  readonly bytes: Uint8Array
  /** Format conversion losses; the caller reports these with the export operation result. */
  readonly diagnostics?: readonly Diagnostic[]
}

export interface NativeModelEncoder {
  readonly contract: typeof NATIVE_MODEL_ENCODER_CONTRACT
  readonly formatId: string
  readonly extension: string
  readonly mediaType?: string
  encode(request: NativeModelEncodeRequest): Promise<NativeModelEncodeResult>
}

declare module './service-contracts.js' {
  interface ContractMap {
    'common.model/native-encoder': { 1: NativeModelEncoder }
  }

  interface ContractRequestMap {
    'common.model/native-encoder': {
      1: { presence: 'required'; facet: NativeModelEncoderRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.model/native-encoder': {
      1: { presence: 'required'; facet: NativeModelEncoderOfferFacet }
    }
  }
}

export type NativeModelEncoderProviderModule = ServiceProviderModule<
  typeof NATIVE_MODEL_ENCODER_CONTRACT,
  1
>
