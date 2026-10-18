import type { InspectionContext, InspectionResult } from '@modkit/codec-kit'
import type { ContributionContext } from '@modkit/sdk'
/** Shared RIFF/WAVE inspector, including PCM/IMA/MS ADPCM; no additional asset session. */
export function inspectWav(bytes: Uint8Array, context: InspectionContext): Promise<InspectionResult>
export const abiVersion: 1
export function createCodec(context?: ContributionContext): unknown
