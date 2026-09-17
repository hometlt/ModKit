// Declared SC2 document-metadata comparison projection, applied identically to both arms.
export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) =>
  typeof item === 'bigint' ? `${item}n` : ArrayBuffer.isView(item) ? Buffer.from(item.buffer, item.byteOffset, item.byteLength).toString('hex') : item)))
export const hex = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex')

// Which structural check fired. MK2 and MK3 word the messages differently and MK2 rates an unknown
// artifact type as info where MK3 warns; the finding itself is what is compared.
const MK2_CHECKS = {
  'sc2-document-metadata.unexpected-header-format': 'marker',
  'sc2-document-metadata.unexpected-game-signature': 'signature',
  'sc2-document-metadata.unknown-artifact-type': 'artifact-type',
}
const MK3_CHECKS = {
  'blizzard.sc2-document-metadata/header-marker': 'marker',
  'blizzard.sc2-document-metadata/header-signature': 'signature',
  'blizzard.sc2-document-metadata/header-artifact-type': 'artifact-type',
}

export function project(probe, { legacy, native, value }) {
  switch (probe) {
    case 'view.inspect': {
      if (legacy !== undefined) return plain(legacy)
      if (native.format === 'document-header')
        return plain({
          format: native.format, buildNumber: native.timestamp1, flags: native.flags,
          artifactType: native.artifactType, dependencies: native.dependencies,
          documentInfo: native.documentInfo, mapInfo: native.mapInfo,
          loadingScreen: native.loadingScreen, entryCount: native.entryCount,
        })
      if (native.format === 'version-file') {
        if (native.empty === true) return { format: native.format, empty: true }
        return plain({
          format: native.format,
          componentType: native.componentType === 'unknown' ? undefined : native.componentType,
          rawTypeTag: native.typeTag, formatVersion: native.formatVersion, buildNumber: native.buildNumber,
          version: { major: native.majorVersion, minor: native.minorVersion, patch: native.patchVersion },
          entryCount: native.entryCount, timestamp: native.timestamp,
        })
      }
      return plain({
        format: native.format, root: native.root.name,
        sections: native.root.children.map(child => child.name),
        dependencies: native.dependencies, preloads: native.preloads,
      })
    }
    case 'asset.validate':
      return legacy !== undefined
        ? legacy.map(item => MK2_CHECKS[item.code] ?? item.code)
        : native.map(item => MK3_CHECKS[item.code] ?? item.code)
    case 'export.raw':
    case 'export.convert':
    case 'edit.content':
      return { hex: value }
    case 'detect':
      return value
  }
  throw new Error(`unknown sc2-document-metadata probe: ${probe}`)
}
