import { defineLinkedExtension } from '@modkitx-x3/host'

import markdownManifest from '../contributions/codec-markdown.json' with { type: 'json' }
import rtfManifest from '../contributions/codec-rtf.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as markdown from './formats/markdown/codec.js'
import * as rtf from './formats/rtf/codec.js'

export const documents = defineLinkedExtension({
  source: 'linked:extensions/common/documents',
  packageJson,
  contributions: [
    { path: 'contributions/codec-markdown.json', manifest: markdownManifest },
    { path: 'contributions/codec-rtf.json', manifest: rtfManifest },
  ],
  modules: {
    './src/formats/markdown/codec.js': markdown,
    './src/formats/rtf/codec.js': rtf,
  },
})
