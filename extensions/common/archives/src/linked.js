import { defineLinkedExtension } from '@modkitx-x3/host'

import zipManifest from '../contributions/codec-zip.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as zip from './formats/zip/codec.js'

export const archives = defineLinkedExtension({
  source: 'linked:extensions/common/archives',
  packageJson,
  contributions: [{ path: 'contributions/codec-zip.json', manifest: zipManifest }],
  modules: { './src/formats/zip/codec.js': zip },
})
