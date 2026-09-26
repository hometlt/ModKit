/**
 * Spring's rapid package manifest (`.sdp`, once gunzipped): one record per file — a length-prefixed
 * ASCII path, the MD5 of the file in the pool, its CRC-32 and size. Pure (no `node:*`), so the rapid
 * VFS provider and an extension showing `.sdp` read it the same way.
 */
import { ModkitError } from '@modkit/core'
import { assertVfsPathBudget, normalizeVfsPath, type VfsLimits } from '../../vfs.js'

export interface RapidRecord {
  readonly path: string
  readonly foldedPath: string
  readonly md5: string
  readonly crc32: string
  readonly size: number
}

const RAPID_RECORD_FIXED_BYTES = 24
const ASCII = new TextDecoder('ascii', { fatal: true })

export function rapidError(code: string, message: string, context?: Readonly<Record<string, unknown>>) {
  return new ModkitError({ code: `x3.vfs/rapid-${code}`, message, ...(context ? { context } : {}) })
}

function hex(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0')
  return value
}

/** Parse a gunzipped manifest within the VFS limits: paths confined and canonical, no case-insensitive collision. */
export function parseRapidManifest(bytes: Uint8Array, limits: VfsLimits): readonly RapidRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const records: RapidRecord[] = []
  const seen = new Set<string>()
  let cursor = 0
  while (cursor < bytes.byteLength) {
    if (records.length >= limits.maxEntries) {
      throw rapidError('entry-budget-exceeded', 'rapid manifest exceeds its entry boundary', {
        maxEntries: limits.maxEntries,
      })
    }
    const nameLength = bytes[cursor]
    cursor += 1
    if (nameLength === undefined || nameLength === 0) {
      throw rapidError('manifest-invalid', 'rapid manifest contains an empty path record', {
        cursor,
      })
    }
    if (cursor + nameLength + RAPID_RECORD_FIXED_BYTES > bytes.byteLength) {
      throw rapidError('manifest-truncated', 'rapid manifest record is truncated', { cursor })
    }
    const rawPath = ASCII.decode(bytes.subarray(cursor, cursor + nameLength))
    cursor += nameLength
    const path = normalizeVfsPath(rawPath)
    assertVfsPathBudget(path, limits)
    if (path !== rawPath.replaceAll('\\', '/') || path === '') {
      throw rapidError('path-invalid', 'rapid manifest path is not confined and canonical', {
        path: rawPath,
      })
    }
    const foldedPath = path.toLowerCase()
    if (seen.has(foldedPath)) {
      throw rapidError(
        'path-collision',
        'rapid manifest contains a case-insensitive path collision',
        {
          path,
        },
      )
    }
    seen.add(foldedPath)
    const md5 = hex(bytes.subarray(cursor, cursor + 16))
    cursor += 16
    const crc32 = view.getUint32(cursor, false).toString(16).padStart(8, '0')
    cursor += 4
    const size = view.getUint32(cursor, false)
    cursor += 4
    if (BigInt(size) > limits.maxFileBytes) {
      throw rapidError(
        'file-size-limit-exceeded',
        'rapid record exceeds its logical file boundary',
        {
          path,
          fileBytes: size,
          maxFileBytes: String(limits.maxFileBytes),
        },
      )
    }
    records.push(Object.freeze({ path, foldedPath, md5, crc32, size }))
  }
  return Object.freeze(records)
}
