/** Pure policy and rendering helpers for the composite archive-entry stage. */

export const ARCHIVE_ENTRY_PREVIEW_BYTES = 64 * 1024
export const ARCHIVE_LISTING_PAGES = 25
export const ENTRY_EXTRACT_SUFFIX = '.extract-entry'

export interface ArchiveOperationFacts {
  readonly id: string
  readonly handlerId: string
  readonly mutatesSource: boolean
  readonly state: string
}

/** The extraction convention is read-only by construction; mutating lookalikes never qualify. */
export function findArchiveExtractOperation(
  operations: readonly ArchiveOperationFacts[],
): ArchiveOperationFacts | undefined {
  return operations.find(
    operation =>
      operation.state === 'available' &&
      !operation.mutatesSource &&
      operation.id.endsWith(ENTRY_EXTRACT_SUFFIX),
  )
}

export function previewText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

export function hexDump(bytes: Uint8Array): string {
  const lines: string[] = []
  for (let index = 0; index < bytes.length; index += 16) {
    const chunk = bytes.slice(index, index + 16)
    const address = index.toString(16).padStart(8, '0')
    const hex = [...chunk].map(value => value.toString(16).padStart(2, '0')).join(' ')
    const ascii = [...chunk]
      .map(value => (value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.'))
      .join('')
    lines.push(`${address}  ${hex.padEnd(47)}  ${ascii}`)
  }
  return lines.join('\n')
}
