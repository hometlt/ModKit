import { bytesToHex, compareBytesUnsigned, hexToBytes, readUintBE, sliceExact } from './binary.js'
export class EncodingTable {
  data
  contentKeyLength
  encodingKeyLength
  pages
  entryCount
  constructor(data, contentKeyLength, encodingKeyLength, pages) {
    this.data = data
    this.contentKeyLength = contentKeyLength
    this.encodingKeyLength = encodingKeyLength
    this.pages = pages
  }
  get(contentKey) {
    const keyBytes = this.parseContentKey(contentKey)
    if (!keyBytes) return undefined
    const located = this.locate(keyBytes)
    if (!located) return undefined
    const encodingKeys = []
    let offset = located.encodingKeysOffset
    for (let i = 0; i < located.keyCount; i++) {
      encodingKeys.push(
        bytesToHex(sliceExact(this.data, offset, this.encodingKeyLength, 'CASC encoding key')),
      )
      offset += this.encodingKeyLength
    }
    return {
      contentKey: bytesToHex(
        sliceExact(this.data, located.contentKeyOffset, this.contentKeyLength, 'CASC content key'),
      ),
      encodingKeys,
      size: located.size,
    }
  }
  getEncodingKey(contentKey) {
    const keyBytes = this.parseContentKey(contentKey)
    if (!keyBytes) return undefined
    const located = this.locate(keyBytes)
    if (!located || located.keyCount === 0) return undefined
    return bytesToHex(
      sliceExact(
        this.data,
        located.encodingKeysOffset,
        this.encodingKeyLength,
        'CASC encoding key',
      ),
    )
  }
  has(contentKey) {
    const keyBytes = this.parseContentKey(contentKey)
    return keyBytes !== undefined && this.locate(keyBytes) !== undefined
  }
  get size() {
    if (this.entryCount === undefined) this.entryCount = this.countEntries()
    return this.entryCount
  }
  parseContentKey(contentKey) {
    const clean = contentKey.trim().toLowerCase()
    if (clean.length !== this.contentKeyLength * 2) return undefined
    return hexToBytes(clean)
  }
  locate(contentKey) {
    const page = this.pageForContentKey(contentKey)
    if (!page) return undefined
    let offset = page.offset
    const end = page.offset + page.length
    while (offset + 2 <= end) {
      const keyCount = this.data[offset] | (this.data[offset + 1] << 8)
      offset += 2
      if (keyCount === 0) return undefined
      if (offset + 4 + this.contentKeyLength + keyCount * this.encodingKeyLength > end) {
        throw new Error('CASC encoding table ended inside a page entry')
      }
      const size = readUintBE(this.data, offset, 4)
      offset += 4
      const contentKeyOffset = offset
      const currentKey = this.data.subarray(offset, offset + this.contentKeyLength)
      offset += this.contentKeyLength
      const encodingKeysOffset = offset
      const cmp = compareBytesUnsigned(currentKey, contentKey)
      if (cmp === 0) return { contentKeyOffset, keyCount, size, encodingKeysOffset }
      if (cmp > 0) return undefined
      offset += keyCount * this.encodingKeyLength
    }
    return undefined
  }
  pageForContentKey(contentKey) {
    if (this.pages.length === 0) return undefined
    let lo = 0
    let hi = this.pages.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (compareBytesUnsigned(this.pages[mid].firstContentKey, contentKey) <= 0) lo = mid + 1
      else hi = mid
    }
    const index = lo - 1
    return index >= 0 ? this.pages[index] : undefined
  }
  countEntries() {
    let count = 0
    for (const page of this.pages) {
      let offset = page.offset
      const end = page.offset + page.length
      while (offset + 2 <= end) {
        const keyCount = this.data[offset] | (this.data[offset + 1] << 8)
        offset += 2
        if (keyCount === 0) break
        const entryLength = 4 + this.contentKeyLength + keyCount * this.encodingKeyLength
        if (offset + entryLength > end)
          throw new Error('CASC encoding table ended inside a page entry')
        offset += entryLength
        count++
      }
    }
    return count
  }
}
export function parseEncodingTable(data) {
  if (data.length < 22 || data[0] !== 0x45 || data[1] !== 0x4e) {
    throw new Error('CASC encoding file is missing EN magic')
  }
  const contentKeyLength = data[3]
  const encodingKeyLength = data[4]
  if (contentKeyLength <= 0 || encodingKeyLength <= 0) {
    throw new Error('CASC encoding file has invalid key lengths')
  }
  const contentKeyPageSizeKb = readUintBE(data, 5, 2)
  const pageSize = contentKeyPageSizeKb * 1024
  if (pageSize <= 0) throw new Error('CASC encoding file has invalid page size')
  const pageCount = readUintBE(data, 9, 4)
  const eSpecBlockSize = readUintBE(data, 18, 4)
  const pageIndexStart = 22 + eSpecBlockSize
  const pageIndexEntrySize = contentKeyLength + 16
  const pagesStart = pageIndexStart + pageCount * pageIndexEntrySize
  if (pagesStart > data.length) throw new Error('CASC encoding page index extends beyond buffer')
  const pages = []
  for (let page = 0; page < pageCount; page++) {
    const indexOffset = pageIndexStart + page * pageIndexEntrySize
    const firstContentKey = sliceExact(
      data,
      indexOffset,
      contentKeyLength,
      'CASC encoding page key',
    )
    const pageOffset = pagesStart + page * pageSize
    if (pageOffset > data.length) throw new Error('CASC encoding page extends beyond buffer')
    pages.push({
      firstContentKey,
      offset: pageOffset,
      length: Math.min(pageSize, data.length - pageOffset),
    })
  }
  return new EncodingTable(data, contentKeyLength, encodingKeyLength, pages)
}
export function contentKeyToBytes(contentKey) {
  return hexToBytes(contentKey)
}
