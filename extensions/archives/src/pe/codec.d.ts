/**
 * Types of the core PE codec (plain JavaScript beside this file), for extensions that map an
 * executable's sections — Diablo III reads its type registry out of the client's image.
 */

export interface PeSection {
  /** `section-<index>` in table order. */
  readonly id: string
  readonly path: string
  readonly name: string
  readonly virtualSize: number
  readonly virtualAddress: number
  readonly rawSize: number
  readonly rawOffset: number
  /** IMAGE_SCN_* flags (0x20000000: executable). */
  readonly characteristics: number
}

export interface PeImage {
  readonly signatureOffset: number
  readonly machine: number
  readonly timestamp: number
  readonly characteristics: number
  readonly pe32Plus: boolean
  readonly entryPoint: number
  readonly imageBase: bigint
  readonly sectionAlignment: number
  readonly fileAlignment: number
  readonly sizeOfImage: number
  readonly sizeOfHeaders: number
  readonly subsystem: number
  readonly dllCharacteristics: number
  readonly declaredDirectoryCount: number
  readonly dataDirectories: readonly {
    readonly index: number
    readonly virtualAddress: number
    readonly size: number
  }[]
  readonly sections: readonly PeSection[]
}

/** Parse a whole PE32/PE32+ image; refuses a malformed or overlapping section table. */
export function parsePeImage(bytes: Uint8Array, maxSections?: number): PeImage

export const abiVersion: 1
