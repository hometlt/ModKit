/**
 * NXT-101B: the bounded, data-only signature index. Codec contributions may declare byte
 * signatures (`spec.match.signatures`, schema-bounded: offset ≤ 4096, pattern ≤ 64 bytes, ≤ 8
 * rules); the host reads **one head and one tail window per opened subject** — no larger than the
 * declared needs, never more than `MAX_SIGNATURE_WINDOW_BYTES` each — and admits a candidate
 * whose signature matches even when its name/media/path rules do not (a renamed `.dat` PNG
 * reaches the PNG probe). No extension code runs at this stage: signatures are inert inventory
 * data, matching is a host-side byte comparison, and everything after the shortlist is still the
 * bounded probe under the probe grant.
 */

import type { SignatureRule } from '@modkit/sdk'

/** Hard ceiling per window, matching the schema bounds (offset ≤ 4096 + pattern ≤ 64). */
export const MAX_SIGNATURE_WINDOW_BYTES = 4096 + 64

export interface SignatureWindows {
  /** First `min(size, prefix need)` bytes of the subject. */
  readonly head: Uint8Array
  /** Last `min(size, suffix need)` bytes of the subject. */
  readonly tail: Uint8Array
  readonly size: bigint
}

export interface SignatureNeeds {
  /** Bytes required from the start of the subject to test every `from: 'start'` rule. */
  readonly prefix: number
  /** Bytes required from the end of the subject to test every `from: 'end'` rule. */
  readonly suffix: number
}

const clamp = (value: number) => Math.min(value, MAX_SIGNATURE_WINDOW_BYTES)

/** How many head/tail bytes the given rule sets need; zero needs mean no read happens at all. */
export function signatureNeeds(ruleSets: Iterable<readonly SignatureRule[]>): SignatureNeeds {
  let prefix = 0
  let suffix = 0
  for (const rules of ruleSets) {
    for (const rule of rules) {
      const length = rule.bytesHex.length / 2
      if (rule.from === 'start') prefix = Math.max(prefix, rule.offset + length)
      else suffix = Math.max(suffix, rule.offset)
    }
  }
  return { prefix: clamp(prefix), suffix: clamp(suffix) }
}

function parseHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/**
 * True when one of `rules` matches the read windows. A rule whose pattern does not fit inside the
 * subject (or whose mask length differs) never matches — small files fail closed, they do not
 * wrap around.
 */
export function matchesSignatures(
  rules: readonly SignatureRule[] | undefined,
  windows: SignatureWindows,
): boolean {
  if (rules === undefined || rules.length === 0) return false
  const size = windows.size
  for (const rule of rules) {
    const pattern = parseHex(rule.bytesHex)
    const mask = rule.maskHex === undefined ? undefined : parseHex(rule.maskHex)
    if (mask !== undefined && mask.length !== pattern.length) continue
    if (rule.from === 'end' && rule.offset < pattern.length) continue
    const patternEnd = BigInt(rule.offset) + (rule.from === 'start' ? BigInt(pattern.length) : 0n)
    if (patternEnd > size) continue
    const window = rule.from === 'start' ? windows.head : windows.tail
    // where the pattern starts inside the window we actually read: the tail window covers
    // [size - window.length, size), so an end-anchored pattern begins at window.length - offset
    const start = rule.from === 'start' ? rule.offset : window.length - rule.offset
    if (start < 0 || start + pattern.length > window.length) continue
    let matched = true
    for (let index = 0; index < pattern.length; index += 1) {
      const m = mask?.[index] ?? 0xff
      if (((window[start + index] as number) & m) !== ((pattern[index] as number) & m)) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}
