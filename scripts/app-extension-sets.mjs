/**
 * Data-only application test catalog. Keeping the expected extension coordinate and contribution
 * ids beside each directory makes the matrix detect both missing contributions and accidental
 * cross-extension discovery.
 */
export const READY_APP_EXTENSIONS = Object.freeze({
  archives: Object.freeze({
    coordinate: 'org.modkitx/archives',
    contributions: Object.freeze([
      'org.modkitx/archive-zip',
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
      'org.modkitx/zstd',
    ]),
  }),
  audio: Object.freeze({
    coordinate: 'org.modkitx/audio',
    contributions: Object.freeze([
      'org.modkitx/audio-mp3',
      'org.modkitx/audio-ogg',
      'org.modkitx/aac',
      'org.modkitx/flac',
      'org.modkitx/m4a',
      'org.modkitx/wav',
    ]),
  }),
  containers: Object.freeze({
    coordinate: 'org.modkitx/containers',
    contributions: Object.freeze(['org.modkitx/ps1-cue-bin']),
  }),
  documents: Object.freeze({
    coordinate: 'org.modkitx/documents',
    contributions: Object.freeze([
      'org.modkitx/document-markdown',
      'org.modkitx/document-rtf',
      'org.modkitx/odg',
      'org.modkitx/odp',
      'org.modkitx/ods',
      'org.modkitx/odt',
    ]),
  }),
  'plain-text': Object.freeze({
    path: Object.freeze(['common', 'data', 'plain-text']),
    coordinate: 'org.modkitx/plain-text',
    contributions: Object.freeze(['org.modkitx/txt', 'org.modkitx/plain-text-writer']),
  }),
  images: Object.freeze({
    coordinate: 'org.modkitx/images',
    contributions: Object.freeze([
      'org.modkitx/image-jpeg',
      'org.modkitx/image-png',
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
      'org.modkitx/ktx',
      'org.modkitx/ktx2',
      'org.modkitx/pal',
      'org.modkitx/pcx',
      'org.modkitx/pkm',
      'org.modkitx/pvr',
      'org.modkitx/tga',
      'org.modkitx/tiff',
      'org.modkitx/webp',
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
      'org.modkitx/dae',
      'org.modkitx/ply',
      'org.modkitx/stl',
    ]),
  }),
  'rendering-3d': Object.freeze({
    path: Object.freeze(['common', 'rendering', 'rendering-3d']),
    coordinate: 'org.modkitx/rendering-3d',
    contributions: Object.freeze([
      'org.modkitx/browser-webgl-renderer',
      'org.modkitx/headless-renderer',
    ]),
  }),
  'text-delimited': Object.freeze({
    path: Object.freeze(['common', 'data', 'text-delimited']),
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
    path: Object.freeze(['common', 'data', 'text-ini']),
    coordinate: 'org.modkitx/text-ini',
    contributions: Object.freeze([
      'org.modkitx/ini-syntax-contract',
      'org.modkitx/ini-syntax-default',
      'org.modkitx/text-ini',
      'org.modkitx/text-ini-writer',
    ]),
  }),
  'text-json': Object.freeze({
    path: Object.freeze(['common', 'data', 'text-json']),
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
    path: Object.freeze(['common', 'data', 'text-toml']),
    coordinate: 'org.modkitx/text-toml',
    contributions: Object.freeze([
      'org.modkitx/text-toml',
      'org.modkitx/text-toml-writer',
      'org.modkitx/toml-syntax-contract',
      'org.modkitx/toml-syntax-default',
    ]),
  }),
  'text-xml': Object.freeze({
    path: Object.freeze(['common', 'data', 'text-xml']),
    coordinate: 'org.modkitx/text-xml',
    contributions: Object.freeze([
      'org.modkitx/text-xml',
      'org.modkitx/text-xml-writer',
      'org.modkitx/xml-syntax-contract',
      'org.modkitx/xml-syntax-default',
    ]),
  }),
  'text-yaml': Object.freeze({
    path: Object.freeze(['common', 'data', 'text-yaml']),
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
    contributions: Object.freeze(['org.modkitx/vector-svg', 'org.modkitx/emf', 'org.modkitx/wmf']),
  }),
  video: Object.freeze({
    coordinate: 'org.modkitx/video',
    contributions: Object.freeze([
      'org.modkitx/video-mp4',
      'org.modkitx/video-webm',
      'org.modkitx/avi',
      'org.modkitx/mpeg',
      'org.modkitx/ogv',
      'org.modkitx/wmv',
    ]),
  }),
  'ui-monaco': Object.freeze({
    path: Object.freeze(['common', 'ui', 'monaco']),
    coordinate: 'org.modkitx/ui-monaco',
    contributions: Object.freeze(['org.modkitx.ui-monaco/code-stage']),
  }),
  /*
   * The UV materializers and writers, which every application has been shipping and this table did
   * not list.
   *
   * Found by slice 13C: the generated VS Code catalog enumerates roots with the product's own
   * predicate, and `uv-materializer` turned up as a real extension root that discovery had been
   * loading all along while `READY_APP_EXTENSIONS` — the table `apps:check` matrixes against — had
   * no entry for it. Owner decision (2026-08-26): the table was behind the fact, and UVM/UVT export
   * is a declared product capability in every application, so it is listed here rather than carried
   * as `declared: false`.
   *
   */
  'uv-materializer': Object.freeze({
    coordinate: 'org.modkitx/uv-materializer',
    contributions: Object.freeze([
      'org.modkitx/uv-model-materializer-contract',
      'org.modkitx/uv-texture-materializer-contract',
      'org.modkitx/uvm-materializer',
      'org.modkitx/uvm-writer',
      'org.modkitx/uvt-materializer',
      'org.modkitx/uvt-writer',
    ]),
  }),
  'blizzard-casc': Object.freeze({
    repository: 'blizzard',
    path: Object.freeze(['casc']),
    coordinate: 'org.modkitx.blizzard/casc',
    contributions: Object.freeze(['org.modkitx/casc']),
  }),
  'blizzard-models': Object.freeze({
    repository: 'blizzard',
    path: Object.freeze(['models']),
    coordinate: 'org.modkitx.blizzard/models',
    contributions: Object.freeze(['org.modkitx/m3', 'org.modkitx.blizzard/m3-preserving-writer']),
  }),
  'blizzard-mpq': Object.freeze({
    repository: 'blizzard',
    path: Object.freeze(['mpq']),
    coordinate: 'org.modkitx.blizzard/mpq',
    contributions: Object.freeze(['org.modkitx/mpq', 'org.modkitx.blizzard/mpq-fresh-writer']),
  }),
  'blizzard-starcraft2': Object.freeze({
    repository: 'blizzard',
    path: Object.freeze(['starcraft2']),
    coordinate: 'org.modkitx.blizzard/starcraft2',
    contributions: Object.freeze([
      'org.modkitx/galaxy',
      'org.modkitx.blizzard/sc2-authored-text-writers',
      'org.modkitx.blizzard/sc2-data-language',
      'org.modkitx.blizzard/sc2-layout-language',
      'org.modkitx.blizzard/sc2-triggers-language',
      'org.modkitx/sc2-bank',
      'org.modkitx/sc2-bank-list',
      'org.modkitx/sc2-campaign',
      'org.modkitx/sc2-campaign-directory',
      'org.modkitx/sc2-data',
      'org.modkitx/sc2-document-metadata',
      'org.modkitx/sc2-layout',
      'org.modkitx/sc2-map',
      'org.modkitx/sc2-map-directory',
      'org.modkitx/sc2-mod',
      'org.modkitx/sc2-mod-directory',
      'org.modkitx/sc2-replay',
      'org.modkitx/sc2-runtime',
      'org.modkitx/sc2-runtime-provider',
      'org.modkitx/sc2-strings',
      'org.modkitx/sc2-triggers',
      'org.modkitx.blizzard/sc2-workspace-copy-writer',
      'org.modkitx.blizzard/sc2-data-knowledge',
      'org.modkitx.blizzard/sc2-data-schema-knowledge',
      'org.modkitx.blizzard/starcraft2-data',
      'org.modkitx.blizzard/starcraft2-installation',
      'org.modkitx.blizzard/starcraft2-map-preview-preparation',
      'org.modkitx.blizzard/starcraft2-map-semantic',
      'org.modkitx.blizzard/starcraft2-native-map-launch',
      'org.modkitx.blizzard/starcraft2-resolved-data',
      'org.modkitx.blizzard/starcraft2-workspace',
    ]),
  }),
  'ea-archives': Object.freeze({
    path: Object.freeze(['ea', 'archives']),
    coordinate: 'org.modkitx.ea/archives',
    contributions: Object.freeze(['org.modkitx/mix']),
  }),
  'ea-emperor': Object.freeze({
    path: Object.freeze(['ea', 'emperor']),
    coordinate: 'org.modkitx.ea/emperor',
    contributions: Object.freeze(['org.modkitx/emperor-rfh-rfd', 'org.modkitx/emperor-xbf']),
  }),
  'ea-westwood': Object.freeze({
    path: Object.freeze(['ea', 'westwood']),
    coordinate: 'org.modkitx.ea/westwood',
    contributions: Object.freeze([
      'org.modkitx/cps',
      'org.modkitx/r16',
      'org.modkitx/r8',
      'org.modkitx/shp',
      'org.modkitx/tmp',
      'org.modkitx/vpl',
      'org.modkitx/wsa',
    ]),
  }),
  'ea-big': Object.freeze({
    path: Object.freeze(['ea', 'big']),
    coordinate: 'org.modkitx.ea/big',
    contributions: Object.freeze(['org.modkitx/big']),
  }),
  'ea-sage': Object.freeze({
    path: Object.freeze(['ea', 'sage']),
    coordinate: 'org.modkitx.ea/sage',
    contributions: Object.freeze([
      'org.modkitx/cnc3-data',
      'org.modkitx/cnc3-localization',
      'org.modkitx/cnc3-map',
      'org.modkitx/sage-skudef',
    ]),
  }),
  'ea-models': Object.freeze({
    path: Object.freeze(['ea', 'models']),
    coordinate: 'org.modkitx.ea/models',
    contributions: Object.freeze(['org.modkitx/sage-w3x', 'org.modkitx/westwood-w3d']),
  }),
  'ea-tiberian-sun': Object.freeze({
    path: Object.freeze(['ea', 'tiberian-sun']),
    coordinate: 'org.modkitx.ea/tiberian-sun',
    contributions: Object.freeze(['org.modkitx/red-alert2-vxl']),
  }),
  'opensource-spring': Object.freeze({
    path: Object.freeze(['opensource', 'spring']),
    coordinate: 'org.modkitx.opensource/spring',
    contributions: Object.freeze(['org.modkitx/spring-s3o', 'org.modkitx/spring-unit-definition']),
  }),
  'opensource-warzone-2100': Object.freeze({
    repository: 'warzone',
    path: Object.freeze([]),
    coordinate: 'org.modkitx.opensource/warzone-2100',
    contributions: Object.freeze([
      'org.modkitx/warzone-img',
      'org.modkitx/warzone-lev',
      'org.modkitx/warzone-wrf',
      'org.modkitx/warzone2100-map',
      'org.modkitx/warzone-pie',
      'org.modkitx/warzone-wz',
      'org.modkitx.opensource/warzone-current-data-knowledge',
      'org.modkitx.opensource/warzone-language',
      'org.modkitx.opensource/warzone-legacy-data-knowledge',
      'org.modkitx.opensource/warzone-pie-editor',
      'org.modkitx.opensource/warzone2100-data',
      'org.modkitx.opensource/warzone2100-installation',
      'org.modkitx.opensource/warzone2100-installation-root',
      'org.modkitx.opensource/warzone2100-map-package-writer',
      'org.modkitx.opensource/warzone2100-map-preview-preparation',
      'org.modkitx.opensource/warzone2100-map-semantic',
      'org.modkitx.opensource/warzone2100-resolved-data',
      'org.modkitx.opensource/warzone2100-wz-writer',
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
const fullCodecs = Object.freeze([
  ...structuredText,
  'documents',
  'plain-text',
  ...media,
  ...modelsAndArchives,
  'containers',
  /*
   * UVM/UVT materializers and writers.
   *
   * Every declared directory must appear in some set — `apps:check` enforces that the table and the
   * matrix cover each other — so listing `uv-materializer` in `READY_APP_EXTENSIONS` and nowhere
   * here is not an option the invariant allows. `full-codecs` is where it belongs: UV export is a
   * declared product capability in every application (owner, 2026-08-26), and a "full codecs"
   * composition that omitted it would be the one making the odd claim.
   */
  'uv-materializer',
])
const mk2Extended = Object.freeze([
  'blizzard-casc',
  'blizzard-models',
  'blizzard-mpq',
  'blizzard-starcraft2',
  'archives',
  'images',
  'ea-archives',
  'ea-emperor',
  'ea-westwood',
  'ea-big',
  'ea-sage',
  'ea-models',
  'ea-tiberian-sun',
  'opensource-spring',
  'opensource-warzone-2100',
])

export const APP_EXTENSION_SETS = Object.freeze({
  'structured-text': structuredText,
  documents: Object.freeze(['documents']),
  media,
  'models-and-archives': modelsAndArchives,
  'full-codecs': fullCodecs,
  'editor-and-documents': Object.freeze(['text-json', 'documents', 'ui-monaco']),
  'blizzard-casc': Object.freeze(['blizzard-casc']),
  'blizzard-models': Object.freeze(['blizzard-models']),
  'blizzard-mpq': Object.freeze(['blizzard-mpq']),
  'blizzard-starcraft2': Object.freeze(['blizzard-starcraft2']),
  'opensource-warzone-2100': Object.freeze(['opensource-warzone-2100']),
  'mk2-extended': mk2Extended,
})

export function extensionDirectory(name) {
  const extension = READY_APP_EXTENSIONS[name]
  if (extension === undefined) throw new Error(`unknown application extension directory: ${name}`)
  if (extension.repository !== undefined) {
    throw new Error(`${name} belongs to external repository ${extension.repository}`)
  }
  return extension.path ?? Object.freeze(['common', name])
}

export function extensionLocation(name) {
  const extension = READY_APP_EXTENSIONS[name]
  if (extension === undefined) throw new Error(`unknown application extension directory: ${name}`)
  return Object.freeze(
    extension.repository === undefined
      ? { kind: 'internal', path: extension.path ?? Object.freeze(['common', name]) }
      : { kind: 'external', repository: extension.repository, path: extension.path },
  )
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
