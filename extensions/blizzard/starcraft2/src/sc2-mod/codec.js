// Hand-ported packed SC2Mod inspection. Dependency overlay resolution and structural editing need
// a mounted workspace contract; this portable codec confines itself to the real MPQ namespace.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import {
  createSc2NamespaceSource,
  mpqMagic,
  parseSc2Mpq,
  sc2ArchiveEntryNames,
} from '../sc2-map/mpq.js'

const ID = 'org.modkitx/sc2-mod'

function classify(paths) {
  const lower = paths.map(path => path.replaceAll('\\', '/').toLocaleLowerCase())
  const componentList = lower.filter(path => path === 'componentlist.sc2components')
  const documentInfo = lower.filter(path => path === 'documentinfo')
  const documentHeader = lower.filter(path => path === 'documentheader')
  const gameData = lower.filter(path => /^(?:base\.sc2data\/)?gamedata\/[^/]+\.xml$/u.test(path))
  const layouts = lower.filter(path => path.endsWith('.sc2layout'))
  const localizedData = lower.filter(path => /^[a-z]{4}\.sc2data\/localizeddata\//u.test(path))
  return Object.freeze({
    componentList,
    documentInfo,
    documentHeader,
    gameData,
    layouts,
    localizedData,
  })
}

function strongMarkers(value) {
  return value.componentList.length + value.gameData.length
}

function sniff(prefix) {
  try {
    return classify(sc2ArchiveEntryNames(parseSc2Mpq(prefix, 4096)))
  } catch {
    return classify([])
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'sc2-mod', label: 'StarCraft II mod' }),
  async detect(prefix, uri) {
    const magic = mpqMagic(prefix)
    if (magic !== 'MPQ\u001a' && magic !== 'MPQ\u001b') {
      return { confidence: 0, kind: 'magic', note: 'sc2-mod-mpq-missing' }
    }
    const markers = sniff(prefix)
    if (strongMarkers(markers) > 0) {
      return { confidence: 0.998, kind: 'structure', note: 'sc2-mod-component-or-gamedata' }
    }
    return /\.sc2mod$/iu.test(uri)
      ? { confidence: 0.995, kind: 'extension', note: 'packed-sc2-mod' }
      : { confidence: 0, kind: 'structure', note: 'sc2-mod-markers-missing' }
  },
  async inspect(bytes, context) {
    const archive = parseSc2Mpq(bytes, context.budget.maxNodes)
    const markers = classify(sc2ArchiveEntryNames(archive))
    if (strongMarkers(markers) === 0) {
      throw new TypeError('SC2Mod archive has no ComponentList or GameData catalog entries')
    }
    return {
      summary: {
        format: 'sc2-mod',
        mpqVersion: archive.header.version,
        entries: archive.entries.length,
        componentLists: markers.componentList.length,
        documentInfo: markers.documentInfo.length,
        documentHeaders: markers.documentHeader.length,
        gameDataEntries: markers.gameData.length,
        layouts: markers.layouts.length,
        localizedData: markers.localizedData.length,
      },
      metadata: [
        {
          id: 'sc2-mod',
          label: 'Packed SC2Mod',
          entries: [
            { key: 'entries', value: archive.entries.length },
            { key: 'componentLists', value: markers.componentList.length },
            { key: 'gameDataEntries', value: markers.gameData.length },
            { key: 'layouts', value: markers.layouts.length },
            { key: 'localizedData', value: markers.localizedData.length },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'structure.hierarchy', parameters: { entries: archive.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        ...(markers.gameData.length === 0
          ? []
          : [{ id: 'game.catalog', parameters: { files: markers.gameData.length } }]),
        ...(markers.layouts.length === 0
          ? []
          : [{ id: 'game.layout', parameters: { files: markers.layouts.length } }]),
        ...(markers.localizedData.length === 0
          ? []
          : [{ id: 'game.localization', parameters: { files: markers.localizedData.length } }]),
      ],
      dataSources: {
        'common.view/namespace-entry-source': createSc2NamespaceSource(archive, context.source),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'mod',
          label: 'StarCraft II mod',
          preview: `${archive.entries.length} archive entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes`,
          })),
        }),
      },
      unsupportedFeatures: [
        'mounted-directory-input',
        'dependency-overlay-resolution',
        'resolved-catalog-comparison',
        'localized-data-creation',
        'cross-codec-entity-rename',
        'entry-extraction',
        'compressed-or-encrypted-listfiles',
        'high-offset-mpq-tables',
        'json-mod-or-components-export',
        'mpq-packing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
