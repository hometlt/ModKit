/**
 * A content index for text search over any source root or container: which files may contain a
 * query. One implementation for every game — CASC, folders, archives — so no source keeps its own.
 *
 * Trigrams over a folded alphabet: ASCII letters fold to lower case, digits and `_` stay, every
 * other byte (punctuation, spaces, UTF-8 continuation bytes) is one class. That keeps the table at
 * 38³ entries whatever the corpus, and the answer is a superset: the caller still reads each
 * candidate and matches the query itself. A query shorter than three characters cannot be pruned.
 *
 * Stored form, little-endian: `MKCI` magic, version u32, file count u32, byte length of the path
 * list u32, the paths as UTF-8 joined by `\n`, then 38³ (offset u32, count u32) pairs addressing
 * u32 file-number postings after the table. A reader only needs the table and the postings of the
 * query's trigrams, so a stored index is searched without loading it whole.
 */

const ALPHABET = 38
const TRIGRAMS = ALPHABET * ALPHABET * ALPHABET
const MAGIC = 0x49434b4d // 'MKCI'
const VERSION = 1
const OTHER = 37

const CLASS = (() => {
  const table = new Uint8Array(256).fill(OTHER)
  for (let code = 48; code <= 57; code++) table[code] = code - 48 // 0-9 → 0..9
  for (let code = 97; code <= 122; code++) table[code] = code - 87 // a-z → 10..35
  for (let code = 65; code <= 90; code++) table[code] = code - 55 // A-Z → 10..35
  table[95] = 36 // _
  return table
})()

/** Trigram numbers of a byte string, each once, in first-seen order. */
function trigramsOf(bytes: Uint8Array, seen: Uint8Array, out: number[]): void {
  out.length = 0
  if (bytes.length < 3) return
  let a = CLASS[bytes[0]!]!
  let b = CLASS[bytes[1]!]!
  for (let index = 2; index < bytes.length; index++) {
    const c = CLASS[bytes[index]!]!
    const trigram = (a * ALPHABET + b) * ALPHABET + c
    if (seen[trigram] === 0) {
      seen[trigram] = 1
      out.push(trigram)
    }
    a = b
    b = c
  }
  for (const trigram of out) seen[trigram] = 0
}

/** A text file: no NUL in its first 8 KiB. Binary files are not indexed. */
const isText = (bytes: Uint8Array) => !bytes.subarray(0, 8192).includes(0)

export interface ContentIndexBuilder {
  /** Add one file; binary files are skipped. Returns whether it was indexed. */
  add(path: string, bytes: Uint8Array): boolean
  /** The stored form (see the module comment). */
  encode(): Uint8Array
}

export function createContentIndexBuilder(): ContentIndexBuilder {
  const paths: string[] = []
  // ponytail: one growable u32 array per trigram, all in memory while building; a corpus whose
  // postings outgrow memory would need per-batch runs merged on disk.
  const postings: Uint32Array[] = new Array(TRIGRAMS)
  const counts = new Uint32Array(TRIGRAMS)
  const seen = new Uint8Array(TRIGRAMS)
  const found: number[] = []
  return {
    add(path, bytes) {
      if (path.includes('\n')) throw new TypeError('a content index path cannot contain a newline')
      if (!isText(bytes)) return false
      const file = paths.push(path) - 1
      trigramsOf(bytes, seen, found)
      for (const trigram of found) {
        let list = postings[trigram]
        const count = counts[trigram]!
        if (list === undefined || count === list.length) {
          const grown = new Uint32Array(Math.max(4, count * 2))
          if (list !== undefined) grown.set(list)
          postings[trigram] = list = grown
        }
        list[count] = file
        counts[trigram] = count + 1
      }
      return true
    },
    encode() {
      const names = new TextEncoder().encode(paths.join('\n'))
      let total = 0
      for (const count of counts) total += count
      const header = 16 + names.length
      const tableStart = header + ((4 - (header % 4)) % 4)
      const postingStart = tableStart + TRIGRAMS * 8
      const bytes = new Uint8Array(postingStart + total * 4)
      const view = new DataView(bytes.buffer)
      view.setUint32(0, MAGIC, true)
      view.setUint32(4, VERSION, true)
      view.setUint32(8, paths.length, true)
      view.setUint32(12, names.length, true)
      bytes.set(names, 16)
      let offset = 0
      for (let trigram = 0; trigram < TRIGRAMS; trigram++) {
        const count = counts[trigram]!
        view.setUint32(tableStart + trigram * 8, offset, true)
        view.setUint32(tableStart + trigram * 8 + 4, count, true)
        if (count > 0) {
          const list = postings[trigram]!
          for (let index = 0; index < count; index++)
            view.setUint32(postingStart + (offset + index) * 4, list[index]!, true)
        }
        offset += count
      }
      return bytes
    },
  }
}

/** Reads a byte range of a stored index (a file handle, a buffer). */
export type ContentIndexReader = (offset: number, length: number) => Promise<Uint8Array>

export interface ContentIndex {
  readonly fileCount: number
  /** Paths that may contain `query` (all indexed paths when it is shorter than three bytes). */
  candidates(query: string): Promise<readonly string[]>
}

export async function openContentIndex(read: ContentIndexReader): Promise<ContentIndex> {
  const head = await read(0, 16)
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== VERSION)
    throw new TypeError('not a content index of this version')
  const fileCount = view.getUint32(8, true)
  const nameLength = view.getUint32(12, true)
  const paths =
    nameLength === 0 ? [] : new TextDecoder().decode(await read(16, nameLength)).split('\n')
  if (paths.length !== fileCount) throw new TypeError('content index path list is damaged')
  const header = 16 + nameLength
  const tableStart = header + ((4 - (header % 4)) % 4)
  const postingStart = tableStart + TRIGRAMS * 8
  const table = await read(tableStart, TRIGRAMS * 8)
  const entries = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const postingsOf = async (trigram: number): Promise<Uint32Array> => {
    const offset = entries.getUint32(trigram * 8, true)
    const count = entries.getUint32(trigram * 8 + 4, true)
    if (count === 0) return new Uint32Array(0)
    const bytes = await read(postingStart + offset * 4, count * 4)
    const list = new Uint32Array(count)
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let index = 0; index < count; index++) list[index] = data.getUint32(index * 4, true)
    return list
  }
  return Object.freeze({
    fileCount,
    async candidates(query: string) {
      const found: number[] = []
      trigramsOf(new TextEncoder().encode(query), new Uint8Array(TRIGRAMS), found)
      if (found.length === 0) return paths
      // the rarest trigram first keeps the intersection small
      const lists = (await Promise.all(found.map(postingsOf))).sort((a, b) => a.length - b.length)
      let result = lists[0]!
      for (const list of lists.slice(1)) {
        if (result.length === 0) break
        const keep = new Set(list)
        result = result.filter(file => keep.has(file))
      }
      return Array.from(result, file => paths[file]!)
    },
  })
}
