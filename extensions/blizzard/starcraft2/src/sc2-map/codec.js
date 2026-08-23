// Hand-ported packed SC2Map inspection. Mounted-directory semantics, rendering, editing, packing,
// and launch remain separate host/runtime concerns and are explicitly reported as unsupported.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import { createSc2NamespaceSource, mpqMagic, parseSc2Mpq, sc2ArchiveEntryNames } from './mpq.js'

const ID = 'org.modkitx/sc2-map'
const MAP_MARKERS = new Set([
  'mapinfo',
  't3heightmap',
  'mapheightmap',
  'objects',
  'mapobjects',
  'regions',
  'mapregions',
  'terrain',
  't3terrain.xml',
  'preload',
])

function basename(path) {
  return path.replaceAll('\\', '/').split('/').at(-1)?.toLocaleLowerCase() ?? ''
}

function mapMarkers(paths) {
  return Object.freeze(paths.filter(path => MAP_MARKERS.has(basename(path))))
}

function sniffMarkers(prefix) {
  try {
    return mapMarkers(sc2ArchiveEntryNames(parseSc2Mpq(prefix, 4096)))
  } catch {
    return Object.freeze([])
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'sc2-map', label: 'StarCraft II map' }),
  async detect(prefix, uri) {
    const magic = mpqMagic(prefix)
    if (magic !== 'MPQ\u001a' && magic !== 'MPQ\u001b') {
      return { confidence: 0, kind: 'magic', note: 'sc2-map-mpq-missing' }
    }
    const markers = sniffMarkers(prefix)
    if (markers.length > 0) {
      return { confidence: 0.998, kind: 'structure', note: `sc2-map:${markers.join(',')}` }
    }
    return /\.sc2map$/iu.test(uri)
      ? { confidence: 0.995, kind: 'extension', note: 'packed-sc2-map' }
      : { confidence: 0, kind: 'structure', note: 'sc2-map-markers-missing' }
  },
  async inspect(bytes, context) {
    const archive = parseSc2Mpq(bytes, context.budget.maxNodes)
    const paths = sc2ArchiveEntryNames(archive)
    const markers = mapMarkers(paths)
    if (markers.length === 0) throw new TypeError('SC2Map archive has no recognized map documents')
    const lower = paths.map(path => path.toLocaleLowerCase())
    const localizedData = lower.filter(path =>
      /^[a-z]{4}\.sc2data\/localizeddata\//u.test(path),
    ).length
    const scripts = lower.filter(
      path => path.endsWith('.galaxy') || basename(path) === 'triggers',
    ).length
    return {
      summary: {
        format: 'sc2-map',
        mpqVersion: archive.header.version,
        entries: archive.entries.length,
        mapDocuments: markers,
        localizedData,
        scripts,
      },
      metadata: [
        {
          id: 'sc2-map',
          label: 'Packed SC2Map',
          entries: [
            { key: 'mpqVersion', value: archive.header.version },
            { key: 'entries', value: archive.entries.length },
            { key: 'mapDocuments', value: markers },
            { key: 'localizedData', value: localizedData },
            { key: 'scripts', value: scripts },
          ],
        },
      ],
      traits: [
        { id: 'game.map', parameters: { packed: true, documents: markers.length } },
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'structure.hierarchy', parameters: { entries: archive.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        ...(localizedData === 0
          ? []
          : [{ id: 'game.localization', parameters: { files: localizedData } }]),
        ...(scripts === 0 ? [] : [{ id: 'content.scripts', parameters: { files: scripts } }]),
      ],
      dataSources: {
        'common.view/namespace-entry-source': createSc2NamespaceSource(archive, context.source),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'map',
          label: 'StarCraft II map',
          preview: `${archive.entries.length} archive entries`,
          children: archive.entries.map(entry => ({
            kind: markers.includes(entry.path) ? 'map-document' : 'file',
            label: entry.path,
            preview: `${entry.size} bytes`,
          })),
        }),
      },
      unsupportedFeatures: [
        'mounted-directory-input',
        'semantic-map-document-decoding',
        'terrain-and-minimap-rendering',
        'catalog-coordinated-reference-editing',
        'entry-extraction',
        'compressed-or-encrypted-listfiles',
        'high-offset-mpq-tables',
        'mpq-packing',
        'map-launch',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
