// Portable HVA reader for the Red Alert 2 / Tiberian Sun voxel family.
//
// An `.hva` carries one 3x4 matrix per section per frame, and a list of section names. It is the
// only place a VXL's section transforms over time exist — a standalone `.vxl` has none — which is
// why block 8 recorded the VXL animation family as `Условно: требует companion`.
//
// Two rules shape this module, and both are refusals:
//
//  1. **Sections bind by name and by nothing else.** The reference implementation falls back to
//     positional order when a name does not match; this one does not, because two files that
//     disagree about names are not evidence that their Nth sections are the same limb. A mismatch
//     is reported and left unbound.
//  2. **One frame is a pose, not an animation.** An `.hva` with a single frame states where the
//     sections rest. Publishing that as "an animation was read" would be inventing a track from a
//     bind pose, so frame counts are reported as what they are.

const HEADER_BYTES = 24
const SECTION_NAME_BYTES = 16
const MATRIX_BYTES = 48
const MATRIX_COMPONENTS = 12

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes, offset, length) {
  let result = ''
  for (let index = 0; index < length; index += 1) {
    const value = bytes[offset + index] ?? 0
    if (value === 0) break
    result += String.fromCharCode(value)
  }
  return result
}

/**
 * Parses an `.hva` payload. Throws `TypeError`/`RangeError` with a stable message on malformed
 * input; the caller turns that into a companion diagnostic rather than failing the whole subject,
 * because a corrupt sidecar must not make a readable model unreadable.
 */
export function parseHva(bytes, budget) {
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('HVA header is truncated')
  const view = viewOf(bytes)
  const filePath = ascii(bytes, 0, 16)
  const frames = view.getUint32(16, true)
  const sectionCount = view.getUint32(20, true)
  if (frames <= 0) throw new TypeError('HVA frame count is zero')
  if (sectionCount <= 0) throw new TypeError('HVA section count is zero')
  const cells = frames * sectionCount
  if (!Number.isSafeInteger(cells) || cells > budget.maxNodes) {
    throw new RangeError('HVA matrix count exceeds maxNodes')
  }
  const namesOffset = HEADER_BYTES
  const matricesOffset = namesOffset + sectionCount * SECTION_NAME_BYTES
  const expected = matricesOffset + cells * MATRIX_BYTES
  if (!Number.isSafeInteger(expected) || expected > bytes.byteLength) {
    throw new TypeError('HVA matrix track is truncated')
  }
  const sectionNames = Array.from({ length: sectionCount }, (_, index) =>
    ascii(bytes, namesOffset + index * SECTION_NAME_BYTES, SECTION_NAME_BYTES),
  )
  const matrices = Array.from({ length: cells }, (_, index) => {
    const offset = matricesOffset + index * MATRIX_BYTES
    return Object.freeze(
      Array.from({ length: MATRIX_COMPONENTS }, (_, component) =>
        view.getFloat32(offset + component * 4, true),
      ),
    )
  })
  if (!matrices.every(matrix => matrix.every(Number.isFinite))) {
    throw new TypeError('HVA matrix contains non-finite values')
  }
  return Object.freeze({
    filePath,
    frames,
    sectionCount,
    sectionNames: Object.freeze(sectionNames),
    matrices: Object.freeze(matrices),
    /** Bytes the header accounts for; trailing data is reported, never silently consumed. */
    describedBytes: expected,
    trailingBytes: bytes.byteLength - expected,
  })
}

export function hvaMatrix(hva, sectionIndex, frame) {
  if (sectionIndex < 0 || frame < 0 || frame >= hva.frames) return undefined
  return hva.matrices[frame * hva.sectionCount + sectionIndex]
}

/**
 * Binds VXL sections to HVA sections by name, case-insensitively, one to one.
 *
 * Every outcome is named. A VXL section with no HVA counterpart is `unmatched`; a name carried by
 * more than one section on either side is `ambiguous` and binds nothing, because picking the first
 * would be a guess with a plausible-looking result; an HVA section no VXL section claimed is
 * reported as `unclaimed`, since it usually means the two files belong to different models.
 */
export function bindSections(sectionNames, hva) {
  const fold = value => value.trim().toLowerCase()
  const countBy = names => {
    const counts = new Map()
    for (const name of names) counts.set(fold(name), (counts.get(fold(name)) ?? 0) + 1)
    return counts
  }
  const vxlCounts = countBy(sectionNames)
  const hvaCounts = countBy(hva.sectionNames)
  const claimed = new Set()
  const matches = sectionNames.map(name => {
    const key = fold(name)
    if (key === '') return Object.freeze({ state: 'unmatched', reason: 'blank-section-name' })
    if ((vxlCounts.get(key) ?? 0) > 1 || (hvaCounts.get(key) ?? 0) > 1) {
      return Object.freeze({ state: 'ambiguous', reason: 'duplicate-section-name' })
    }
    const index = hva.sectionNames.findIndex(candidate => fold(candidate) === key)
    if (index < 0) return Object.freeze({ state: 'unmatched', reason: 'identifier-mismatch' })
    claimed.add(index)
    return Object.freeze({
      state: 'matched',
      hvaIndex: index,
      hvaSectionName: hva.sectionNames[index],
    })
  })
  const unclaimed = hva.sectionNames.flatMap((name, index) =>
    claimed.has(index) ? [] : [{ index, name }],
  )
  return Object.freeze({ matches: Object.freeze(matches), unclaimed: Object.freeze(unclaimed) })
}
