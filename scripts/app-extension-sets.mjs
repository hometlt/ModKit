/**
 * Data-only application test catalog. Keeping the expected extension coordinate and contribution
 * ids beside each directory makes the matrix detect both missing contributions and accidental
 * cross-extension discovery.
 */
export const READY_APP_EXTENSIONS = Object.freeze({
  archives: Object.freeze({
    coordinate: 'org.modkitx/archives',
    contributions: Object.freeze(['org.modkitx/archive-zip']),
  }),
  audio: Object.freeze({
    coordinate: 'org.modkitx/audio',
    contributions: Object.freeze(['org.modkitx/audio-mp3', 'org.modkitx/audio-ogg']),
  }),
  documents: Object.freeze({
    coordinate: 'org.modkitx/documents',
    contributions: Object.freeze(['org.modkitx/document-markdown', 'org.modkitx/document-rtf']),
  }),
  images: Object.freeze({
    coordinate: 'org.modkitx/images',
    contributions: Object.freeze([
      'org.modkitx/image-jpeg',
      'org.modkitx/image-png',
      // ADR-HOST-002 Path B: the PNG encoder writer ships beside the read codecs (A5)
      'org.modkitx/png-encoder-writer',
    ]),
  }),
  models: Object.freeze({
    coordinate: 'org.modkitx/models',
    contributions: Object.freeze([
      'org.modkitx/model-gltf',
      'org.modkitx/model-obj',
      'org.modkitx/model-uvm',
    ]),
  }),
  'rendering-3d': Object.freeze({
    coordinate: 'org.modkitx/rendering-3d',
    contributions: Object.freeze([
      'org.modkitx/browser-webgl-renderer',
      'org.modkitx/headless-renderer',
    ]),
  }),
  'text-delimited': Object.freeze({
    coordinate: 'org.modkitx/text-delimited',
    contributions: Object.freeze([
      'org.modkitx/csv-syntax-contract',
      'org.modkitx/csv-syntax-default',
      'org.modkitx/text-csv',
      // ADR-HOST-002 Path B: the text writer each extension ships (A6)
      'org.modkitx/text-delimited-writer',
      'org.modkitx/text-tsv',
      'org.modkitx/tsv-syntax-contract',
      'org.modkitx/tsv-syntax-default',
    ]),
  }),
  'text-ini': Object.freeze({
    coordinate: 'org.modkitx/text-ini',
    contributions: Object.freeze([
      'org.modkitx/ini-syntax-contract',
      'org.modkitx/ini-syntax-default',
      'org.modkitx/text-ini',
      'org.modkitx/text-ini-writer',
    ]),
  }),
  'text-json': Object.freeze({
    coordinate: 'org.modkitx/text-json',
    contributions: Object.freeze([
      'org.modkitx/json-syntax-contract',
      'org.modkitx/json-syntax-default',
      'org.modkitx/jsonc-syntax-contract',
      'org.modkitx/jsonc-syntax-default',
      'org.modkitx/text-json',
      'org.modkitx/text-json-writer',
      'org.modkitx/text-jsonc',
    ]),
  }),
  'text-toml': Object.freeze({
    coordinate: 'org.modkitx/text-toml',
    contributions: Object.freeze([
      'org.modkitx/text-toml',
      'org.modkitx/text-toml-writer',
      'org.modkitx/toml-syntax-contract',
      'org.modkitx/toml-syntax-default',
    ]),
  }),
  'text-xml': Object.freeze({
    coordinate: 'org.modkitx/text-xml',
    contributions: Object.freeze([
      'org.modkitx/text-xml',
      'org.modkitx/text-xml-writer',
      'org.modkitx/xml-syntax-contract',
      'org.modkitx/xml-syntax-default',
    ]),
  }),
  'text-yaml': Object.freeze({
    coordinate: 'org.modkitx/text-yaml',
    contributions: Object.freeze([
      'org.modkitx/text-yaml',
      'org.modkitx/text-yaml-writer',
      'org.modkitx/yaml-syntax-contract',
      'org.modkitx/yaml-syntax-default',
    ]),
  }),
  vector: Object.freeze({
    coordinate: 'org.modkitx/vector',
    contributions: Object.freeze(['org.modkitx/vector-svg']),
  }),
  video: Object.freeze({
    coordinate: 'org.modkitx/video',
    contributions: Object.freeze(['org.modkitx/video-mp4', 'org.modkitx/video-webm']),
  }),
  'ui-monaco': Object.freeze({
    coordinate: 'org.modkitx/ui-monaco',
    contributions: Object.freeze(['org.modkitx.ui-monaco/code-stage']),
  }),
  'mk2-blizzard-casc': Object.freeze({
    path: Object.freeze(['mk2', 'blizzard-casc']),
    coordinate: 'org.modkitx.blizzard/casc',
    contributions: Object.freeze(['org.modkitx/casc']),
  }),
  'mk2-blizzard-models': Object.freeze({
    path: Object.freeze(['mk2', 'blizzard-models']),
    coordinate: 'org.modkitx.blizzard/models',
    contributions: Object.freeze(['org.modkitx/m3']),
  }),
  'mk2-blizzard-mpq': Object.freeze({
    path: Object.freeze(['mk2', 'blizzard-mpq']),
    coordinate: 'org.modkitx.blizzard/mpq',
    contributions: Object.freeze(['org.modkitx/mpq']),
  }),
  'mk2-blizzard-starcraft2': Object.freeze({
    path: Object.freeze(['mk2', 'blizzard-starcraft2']),
    coordinate: 'org.modkitx.blizzard/starcraft2',
    contributions: Object.freeze([
      'org.modkitx/galaxy',
      'org.modkitx/sc2-bank',
      'org.modkitx/sc2-data',
      'org.modkitx/sc2-document-metadata',
      'org.modkitx/sc2-layout',
      'org.modkitx/sc2-map',
      'org.modkitx/sc2-mod',
      'org.modkitx/sc2-replay',
      'org.modkitx/sc2-runtime',
      'org.modkitx/sc2-strings',
      'org.modkitx/sc2-triggers',
    ]),
  }),
  'mk2-common-archives': Object.freeze({
    path: Object.freeze(['mk2', 'common-archives']),
    coordinate: 'org.modkitx.common/archives',
    contributions: Object.freeze([
      'org.modkitx/7z',
      'org.modkitx/brotli',
      'org.modkitx/bzip2',
      'org.modkitx/cab',
      'org.modkitx/dmg',
      'org.modkitx/gzip',
      'org.modkitx/iso',
      'org.modkitx/lzma',
      'org.modkitx/pe',
      'org.modkitx/ps1-xa',
      'org.modkitx/rar',
      'org.modkitx/tar',
      'org.modkitx/xz',
      'org.modkitx/zip',
      'org.modkitx/zstd',
    ]),
  }),
  'mk2-common-images': Object.freeze({
    path: Object.freeze(['mk2', 'common-images']),
    coordinate: 'org.modkitx.common/images',
    contributions: Object.freeze([
      'org.modkitx/ani',
      'org.modkitx/astc',
      'org.modkitx/avif',
      'org.modkitx/basis',
      'org.modkitx/bmp',
      'org.modkitx/cur',
      'org.modkitx/dds',
      'org.modkitx/exr',
      'org.modkitx/gif',
      'org.modkitx/hdr',
      'org.modkitx/ico',
      'org.modkitx/jpg',
      'org.modkitx/ktx',
      'org.modkitx/ktx2',
      'org.modkitx/pal',
      'org.modkitx/pcx',
      'org.modkitx/pkm',
      'org.modkitx/png',
      'org.modkitx/pvr',
      'org.modkitx/tga',
      'org.modkitx/tiff',
      'org.modkitx/webp',
    ]),
  }),
  'mk2-ea-sage': Object.freeze({
    path: Object.freeze(['mk2', 'ea-sage']),
    coordinate: 'org.modkitx.ea/sage',
    contributions: Object.freeze([
      'org.modkitx/big',
      'org.modkitx/cnc3-data',
      'org.modkitx/cnc3-localization',
      'org.modkitx/cnc3-map',
      'org.modkitx/sage-skudef',
    ]),
  }),
})

const structuredText = Object.freeze([
  'text-json',
  'text-delimited',
  'text-ini',
  'text-xml',
  'text-yaml',
  'text-toml',
])
const media = Object.freeze(['images', 'vector', 'audio', 'video'])
const modelsAndArchives = Object.freeze(['models', 'rendering-3d', 'archives'])
const fullCodecs = Object.freeze([...structuredText, 'documents', ...media, ...modelsAndArchives])
const mk2Extended = Object.freeze([
  'mk2-blizzard-casc',
  'mk2-blizzard-models',
  'mk2-blizzard-mpq',
  'mk2-blizzard-starcraft2',
  'mk2-common-archives',
  'mk2-common-images',
  'mk2-ea-sage',
])

export const APP_EXTENSION_SETS = Object.freeze({
  'structured-text': structuredText,
  documents: Object.freeze(['documents']),
  media,
  'models-and-archives': modelsAndArchives,
  'full-codecs': fullCodecs,
  'editor-and-documents': Object.freeze(['text-json', 'documents', 'ui-monaco']),
  'mk2-casc': Object.freeze(['mk2-blizzard-casc']),
  'mk2-models': Object.freeze(['mk2-blizzard-models']),
  'mk2-mpq': Object.freeze(['mk2-blizzard-mpq']),
  'mk2-starcraft2': Object.freeze(['mk2-blizzard-starcraft2']),
  'mk2-extended': mk2Extended,
})

export function extensionDirectory(name) {
  const extension = READY_APP_EXTENSIONS[name]
  if (extension === undefined) throw new Error(`unknown application extension directory: ${name}`)
  return extension.path ?? Object.freeze(['common', name])
}

export function extensionSet(name) {
  const directories = APP_EXTENSION_SETS[name]
  if (directories === undefined) throw new Error(`unknown application extension set: ${name}`)
  return directories
}

export function expectedExtensionCoordinates(name) {
  return extensionSet(name)
    .map(directory => READY_APP_EXTENSIONS[directory].coordinate)
    .toSorted()
}

export function expectedContributionIds(name) {
  return extensionSet(name)
    .flatMap(directory => READY_APP_EXTENSIONS[directory].contributions)
    .toSorted()
}
