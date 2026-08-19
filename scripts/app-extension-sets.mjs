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
  'text-delimited': Object.freeze({
    coordinate: 'org.modkitx/text-delimited',
    contributions: Object.freeze([
      'org.modkitx/csv-syntax-contract',
      'org.modkitx/csv-syntax-default',
      'org.modkitx/text-csv',
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
      'org.modkitx/text-jsonc',
    ]),
  }),
  'text-toml': Object.freeze({
    coordinate: 'org.modkitx/text-toml',
    contributions: Object.freeze([
      'org.modkitx/text-toml',
      'org.modkitx/toml-syntax-contract',
      'org.modkitx/toml-syntax-default',
    ]),
  }),
  'text-xml': Object.freeze({
    coordinate: 'org.modkitx/text-xml',
    contributions: Object.freeze([
      'org.modkitx/text-xml',
      'org.modkitx/xml-syntax-contract',
      'org.modkitx/xml-syntax-default',
    ]),
  }),
  'text-yaml': Object.freeze({
    coordinate: 'org.modkitx/text-yaml',
    contributions: Object.freeze([
      'org.modkitx/text-yaml',
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
const modelsAndArchives = Object.freeze(['models', 'archives'])
const fullCodecs = Object.freeze([...structuredText, 'documents', ...media, ...modelsAndArchives])

export const APP_EXTENSION_SETS = Object.freeze({
  'structured-text': structuredText,
  documents: Object.freeze(['documents']),
  media,
  'models-and-archives': modelsAndArchives,
  'full-codecs': fullCodecs,
  'editor-and-documents': Object.freeze(['text-json', 'documents', 'ui-monaco']),
})

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
