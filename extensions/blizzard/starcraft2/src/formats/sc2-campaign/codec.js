// Hand-ported packed SC2Campaign inspection. This codec exposes only campaign archive structure;
// dependency overlays, contained-map decoding, editing, packing, signing, and launch stay explicit.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import {
  createSc2NamespaceSource,
  mpqMagic,
  parseSc2Mpq,
  sc2ArchiveEntryNames,
} from '../../sc2-map/mpq.js'

const ID = 'org.modkitx/sc2-campaign'

function normalize(path) {
  return path.replaceAll('\\', '/')
}

function classify(paths) {
  const entries = paths.map(path => ({
    path: normalize(path),
    lower: normalize(path).toLowerCase(),
  }))
  const componentList = entries.filter(({ lower }) => lower === 'componentlist.sc2components')
  const documentInfo = entries.filter(({ lower }) => lower === 'documentinfo')
  const documentHeader = entries.filter(({ lower }) => lower === 'documentheader')
  const campaignData = entries.filter(({ lower }) => lower.startsWith('campaigndata/'))
  const gameData = entries.filter(({ lower }) =>
    /^(?:base\.sc2data\/)?gamedata\/[^/]+\.xml$/u.test(lower),
  )
  const layouts = entries.filter(({ lower }) => lower.endsWith('.sc2layout'))
  const localizedData = entries.filter(({ lower }) =>
    /^[a-z]{4}\.sc2data\/localizeddata\//u.test(lower),
  )
  const containedMapRoots = [
    ...new Set(
      entries.flatMap(({ path, lower }) => {
        const segments = path.split('/')
        const lowerSegments = lower.split('/')
        const containerIndex = lowerSegments.findIndex(segment => segment.endsWith('.sc2maps'))
        const mapIndex = lowerSegments.findIndex(
          (segment, index) =>
            segment.endsWith('.sc2map') &&
            containerIndex >= 0 &&
            lowerSegments[containerIndex + 1] === 'maps' &&
            index > containerIndex + 1,
        )
        return mapIndex < 0 ? [] : [segments.slice(0, mapIndex + 1).join('/')]
      }),
    ),
  ].sort((left, right) => left.localeCompare(right, 'en'))
  return Object.freeze({
    componentList: Object.freeze(componentList.map(({ path }) => path)),
    documentInfo: Object.freeze(documentInfo.map(({ path }) => path)),
    documentHeader: Object.freeze(documentHeader.map(({ path }) => path)),
    campaignData: Object.freeze(campaignData.map(({ path }) => path)),
    gameData: Object.freeze(gameData.map(({ path }) => path)),
    layouts: Object.freeze(layouts.map(({ path }) => path)),
    localizedData: Object.freeze(localizedData.map(({ path }) => path)),
    containedMapRoots: Object.freeze(containedMapRoots),
  })
}

function strongMarkers(value) {
  return value.campaignData.length + value.containedMapRoots.length
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
  format: Object.freeze({ id: 'sc2-campaign', label: 'StarCraft II campaign' }),
  async detect(prefix, uri) {
    const magic = mpqMagic(prefix)
    if (magic !== 'MPQ\u001a' && magic !== 'MPQ\u001b') {
      return { confidence: 0, kind: 'magic', note: 'sc2-campaign-mpq-missing' }
    }
    const markers = sniff(prefix)
    if (strongMarkers(markers) > 0) {
      return {
        confidence: 0.999,
        kind: 'structure',
        note: `sc2-campaign:campaign-data=${markers.campaignData.length},map-roots=${markers.containedMapRoots.length}`,
      }
    }
    return /\.sc2campaign$/iu.test(uri)
      ? { confidence: 0.995, kind: 'extension', note: 'packed-sc2-campaign' }
      : { confidence: 0, kind: 'structure', note: 'sc2-campaign-markers-missing' }
  },
  async inspect(bytes, context) {
    const archive = parseSc2Mpq(bytes, context.budget.maxNodes)
    const markers = classify(sc2ArchiveEntryNames(archive))
    const containedMapRoots = markers.containedMapRoots.map(root => root.toLowerCase())
    if (strongMarkers(markers) === 0) {
      throw new TypeError('SC2Campaign archive has no CampaignData or contained SC2Map roots')
    }
    return {
      summary: {
        format: 'sc2-campaign',
        mpqVersion: archive.header.version,
        entries: archive.entries.length,
        campaignDataEntries: markers.campaignData.length,
        containedMapRoots: markers.containedMapRoots,
        componentLists: markers.componentList.length,
        documentInfo: markers.documentInfo.length,
        documentHeaders: markers.documentHeader.length,
        gameDataEntries: markers.gameData.length,
        layouts: markers.layouts.length,
        localizedData: markers.localizedData.length,
      },
      metadata: [
        {
          id: 'sc2-campaign',
          label: 'Packed SC2Campaign',
          entries: [
            { key: 'entries', value: archive.entries.length },
            { key: 'campaignDataEntries', value: markers.campaignData.length },
            { key: 'containedMapRoots', value: markers.containedMapRoots },
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
          kind: 'campaign',
          label: 'StarCraft II campaign',
          preview: `${archive.entries.length} archive entries`,
          children: archive.entries.map(entry => ({
            kind: containedMapRoots.some(root =>
              normalize(entry.path).toLowerCase().startsWith(`${root}/`),
            )
              ? 'contained-map-file'
              : 'file',
            label: entry.path,
            preview: `${entry.size} bytes`,
          })),
        }),
      },
      unsupportedFeatures: [
        'mounted-or-casc-campaign-root-input',
        'dependency-overlay-resolution',
        'engine-injected-data-mod-provenance',
        'semantic-contained-map-decoding',
        'campaign-playback',
        'entry-extraction',
        'compressed-or-encrypted-listfiles',
        'high-offset-mpq-tables',
        'native-preserving-mpq-repack',
        'native-signing-and-launch',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
