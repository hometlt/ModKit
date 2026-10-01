/** The parts of an inspected world (`CandidateWorldViewerModel`) a payload is built from. */
export interface WorldPayloadInspection {
  readonly snapshotId?: string
  readonly layers: readonly {
    readonly layer: {
      readonly materials?: readonly unknown[]
      readonly weightRasters?: readonly unknown[]
      readonly waterMaterials?: readonly unknown[]
    }
    readonly page: { readonly items: readonly WorldPayloadItem[] }
  }[]
  readonly models?: ReadonlyMap<string, { readonly state: string; readonly uvmBytes?: Uint8Array }>
  readonly terrainTextures?: ReadonlyMap<string, unknown>
  /** The scene info's player slots (`MapPlayer`): their colours and ramps reach the renderer. */
  readonly info?: {
    readonly players?: readonly {
      readonly id: number
      readonly color?: readonly [number, number, number]
      readonly colorRamp?: readonly (readonly [number, number, number])[]
    }[]
  }
}

export interface WorldPayloadItem {
  readonly facet: string
  readonly derivedFrom?: string
  readonly catalog?: unknown
}

export interface WorldPayloadOptions {
  /** Which scene objects to keep; all by default. */
  readonly objects?: (item: WorldPayloadItem) => boolean
}

export interface WorldPayloadSource {
  readonly items: readonly WorldPayloadItem[]
  readonly models: ReadonlyMap<string, { readonly state: string; readonly uvmBytes?: Uint8Array }>
  readonly terrainMaterials: readonly unknown[]
  readonly terrainWeightRasters: readonly unknown[]
  readonly terrainTextures: ReadonlyMap<string, unknown> | undefined
  readonly waterMaterials: readonly unknown[]
  readonly teamColors: ReadonlyMap<number, readonly [number, number, number]>
  readonly teamRamps: ReadonlyMap<number, readonly (readonly [number, number, number])[]>
}

export function worldRenderSource(
  inspected: WorldPayloadInspection,
  options?: WorldPayloadOptions,
): WorldPayloadSource

export function encodeWorldPayload(value: unknown): {
  readonly json: string
  readonly chunks: readonly Uint8Array[]
  readonly byteLength: number
}

export function writeWorldPayload(
  directory: string,
  inspected: WorldPayloadInspection,
  options?: WorldPayloadOptions & { readonly meta?: Readonly<Record<string, unknown>> },
): { readonly jsonBytes: number; readonly binaryBytes: number }
