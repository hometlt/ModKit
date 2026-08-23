import { detectCascDataDirectory, readActiveBuildConfig } from './config.js'
import { parseEncodingTable } from './encoding.js'
import { CASC_LIMITS, cascError, throwIfCancelled } from './limits.js'
import { MndxNameDb } from './mndx.js'
import { normalizeCascPath } from './path-map.js'
import { CascStorage } from './storage.js'

export class CascReader {
  constructor(storage, encoding, nameDb, entries, rootContentKey) {
    this.storage = storage
    this.encoding = encoding
    this.nameDb = nameDb
    this.entries = entries
    this.rootContentKey = rootContentKey
  }

  static async open(source, signal) {
    throwIfCancelled(signal)
    const dataDir = await detectCascDataDirectory(source)
    throwIfCancelled(signal)
    const { config, dataRoot } = await readActiveBuildConfig(source, '', dataDir)
    const storage = await CascStorage.open(source, dataRoot, config, {
      signal,
      maxIndexFiles: CASC_LIMITS.maxIndexFiles,
      maxIndexBytes: CASC_LIMITS.maxIndexBytes,
      maxContainerReadBytes: CASC_LIMITS.maxContainerReadBytes,
      maxDecodedBytes: CASC_LIMITS.maxDecodedBytes,
    })
    const encodingPair = config.getKeyPair('encoding')
    if (encodingPair === undefined) {
      throw cascError('x3.casc/build-config-invalid', 'CASC build config has no encoding entry')
    }
    const encodingBytes = await storage.readEncodingKey(encodingPair.encodingKey, signal)
    const encoding = parseEncodingTable(encodingBytes)
    throwIfCancelled(signal)

    const rootPair = config.getKeyPair('root')
    if (rootPair === undefined) {
      throw cascError('x3.casc/root-missing', 'CASC build config has no supported root entry')
    }
    const rootEncodingKey = encoding.getEncodingKey(rootPair.contentKey) ?? rootPair.encodingKey
    const rootBytes = await storage.readEncodingKey(rootEncodingKey, signal)
    throwIfCancelled(signal)
    let nameDb
    try {
      nameDb = MndxNameDb.parse(rootBytes)
    } catch (cause) {
      throw cascError('x3.casc/root-format-unsupported', 'CASC root is not a supported MNDX root', {
        cause: cause instanceof Error ? cause.message : String(cause),
      })
    }
    if (nameDb.size > CASC_LIMITS.maxEntries) {
      throw cascError('x3.casc/entry-budget-exceeded', 'CASC root exceeds its entry budget', {
        entries: nameDb.size,
        maxEntries: CASC_LIMITS.maxEntries,
      })
    }
    const entries = [...nameDb.files()].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
    return new CascReader(storage, encoding, nameDb, Object.freeze(entries), rootPair.contentKey)
  }

  resolveFile(path) {
    return this.nameDb.getByPath(normalizeCascPath(path).replaceAll('\\', '/'))
  }

  contentSizeOf(path) {
    return this.resolveFile(path)?.contentSize
  }

  async readPath(path, signal) {
    throwIfCancelled(signal)
    const file = this.resolveFile(path)
    if (file === undefined) {
      throw cascError('x3.casc/entry-not-found', 'CASC entry does not exist', { path })
    }
    if (file.contentSize > CASC_LIMITS.maxExtractBytes) {
      throw cascError(
        'x3.casc/extract-byte-budget-exceeded',
        'CASC entry exceeds extraction budget',
        {
          path,
          bytes: file.contentSize,
          maxExtractBytes: CASC_LIMITS.maxExtractBytes,
        },
      )
    }
    const encodingKey = this.encoding.getEncodingKey(file.contentKey)
    if (encodingKey === undefined) {
      throw cascError('x3.casc/encoding-key-not-found', 'CASC entry has no encoding key', { path })
    }
    const bytes = await this.storage.readEncodingKey(encodingKey, signal)
    if (bytes.byteLength > CASC_LIMITS.maxExtractBytes) {
      throw cascError(
        'x3.casc/extract-byte-budget-exceeded',
        'CASC extraction exceeded its budget',
        {
          path,
          bytes: bytes.byteLength,
          maxExtractBytes: CASC_LIMITS.maxExtractBytes,
        },
      )
    }
    return bytes
  }
}
