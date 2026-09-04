/**
 * `sc2-bank` bounded structural detection.
 *
 * `packages/bank`'s own structural check lives inside `parseBank` (`bank.ts`'s `findBankRoot`,
 * which requires a `<Bank>` root or throws). Detection must stay abortable and never fully
 * decode the asset (canonical architecture, section 5, pipeline rule 2), so this only looks for
 * a `<Bank` root tag inside a bounded header window — the same requirement `findBankRoot`
 * enforces, approximated cheaply. Full validation happens in `open()` via the real `parseBank`.
 */

import { readSourceHeader } from '@modkitx/assets'
import type {
  ArtifactContext,
  AssetSource,
  AssetSourceKind,
  DetectionEvidence,
  DetectionResult,
} from '@modkitx/assets'
import { SC2_BANK_CODEC_ID, SC2_BANK_EXTENSION, SC2_GAME_ID } from './identity.js'

/** A bank file is always one addressable byte payload — never a directory or archive tree. */
export const SC2_BANK_SOURCE_KINDS: readonly AssetSourceKind[] = ['file', 'archive-entry']

/** Bounded header window used for the cheap structural sniff. */
const HEADER_SNIFF_BYTES = 4096

const BANK_ROOT_TAG_RE = /<Bank[\s>]/

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))))
}

/**
 * Bounded structural detection of an SC2 bank file.
 *
 * Confidence composition:
 *
 * - a validated `<Bank ...>` root within the header window: `structure` evidence, confidence 1
 *   ("A negative structural check must outweigh extension" — `ASSET_CAPABILITIES.md` section 7);
 * - `.SC2Bank` extension alone (no structural root found in the window): weak `extension`
 *   evidence only, confidence well below a validated match;
 * - declared SC2 game context: `context` evidence, contributing a small amount on top of a
 *   structural match, never sufficient alone.
 */
export async function detectSc2Bank(
  source: AssetSource,
  context: ArtifactContext = {},
): Promise<DetectionResult> {
  const descriptor = source.descriptor
  const evidence: DetectionEvidence[] = []

  const hasExtension = descriptor.extension.toLowerCase() === SC2_BANK_EXTENSION
  const header = await readSourceHeader(source, HEADER_SNIFF_BYTES, context.cancellation)
  const headerText = new TextDecoder('utf-8').decode(header)
  const hasStructuralRoot = BANK_ROOT_TAG_RE.test(headerText)

  if (hasStructuralRoot) {
    evidence.push({ kind: 'structure', detail: 'header window contains a <Bank ...> root tag' })
  }
  if (hasExtension) {
    evidence.push({ kind: 'extension', detail: `root name ${descriptor.name}` })
  }
  if (context.gameId === SC2_GAME_ID || descriptor.context?.gameId === SC2_GAME_ID) {
    evidence.push({ kind: 'context', detail: `declared game ${SC2_GAME_ID}` })
  }

  if (hasStructuralRoot) {
    let confidence = 0.9
    if (hasExtension) confidence += 0.05
    if (context.gameId === SC2_GAME_ID || descriptor.context?.gameId === SC2_GAME_ID)
      confidence += 0.05
    return {
      pluginId: SC2_BANK_CODEC_ID,
      confidence: clamp(confidence),
      evidence,
      requiredRanges: [{ offset: 0, length: HEADER_SNIFF_BYTES }],
    }
  }

  if (hasExtension) {
    return {
      pluginId: SC2_BANK_CODEC_ID,
      confidence: 0.3,
      evidence,
      requiredRanges: [{ offset: 0, length: HEADER_SNIFF_BYTES }],
      diagnostics: [
        {
          id: 'sc2-bank.detect.extension-only',
          severity: 'warning',
          category: 'ambiguous-detection',
          code: 'sc2-bank.extension-only',
          message:
            'Matched the .SC2Bank extension but no <Bank> root was found in the header window.',
          source: SC2_BANK_CODEC_ID,
        },
      ],
    }
  }

  return { pluginId: SC2_BANK_CODEC_ID, confidence: 0, evidence: [], requiredRanges: [] }
}
