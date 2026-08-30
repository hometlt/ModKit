import { defineLinkedExtension } from '@modkitx-x3/host'

import codecManifest from '../contributions/codec-txt.json' with { type: 'json' }
import writerManifest from '../contributions/writer-plain-text.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as codec from './txt/codec.js'
import * as writer from './editing/text-writer.js'

export const plainText = defineLinkedExtension({
  source: 'linked:extensions/common/data/plain-text',
  packageJson,
  contributions: [
    { path: 'contributions/codec-txt.json', manifest: codecManifest },
    { path: 'contributions/writer-plain-text.json', manifest: writerManifest },
  ],
  modules: {
    './src/txt/codec.js': codec,
    './src/editing/text-writer.js': writer,
  },
})
