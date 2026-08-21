import { defineLinkedExtension } from '@modkitx-x3/host'

import codecManifest from '../contributions/codec-xml.json' with { type: 'json' }
import contractManifest from '../contributions/contract-xml-syntax.json' with { type: 'json' }
import providerManifest from '../contributions/provider-xml-default.json' with { type: 'json' }
import writerManifest from '../contributions/writer-xml.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as codec from './formats/xml/codec.js'
import * as provider from './formats/xml/provider.js'

export const textXml = defineLinkedExtension({
  source: 'linked:extensions/common/text-xml',
  packageJson,
  contributions: [
    { path: 'contributions/codec-xml.json', manifest: codecManifest },
    { path: 'contributions/contract-xml-syntax.json', manifest: contractManifest },
    { path: 'contributions/provider-xml-default.json', manifest: providerManifest },
    { path: 'contributions/writer-xml.json', manifest: writerManifest },
  ],
  modules: {
    './src/formats/xml/codec.js': codec,
    './src/formats/xml/provider.js': provider,
  },
})
