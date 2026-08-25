import { defineLinkedExtension } from '@modkitx-x3/host'

import contractManifest from '../contributions/contract-model-materializer.json' with { type: 'json' }
import materializerManifest from '../contributions/materializer-uvm.json' with { type: 'json' }
import writerManifest from '../contributions/writer-uvm.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as provider from './provider.js'
import * as writer from './writer.js'

export const uvMaterializer = defineLinkedExtension({
  source: 'linked:extensions/common/uv-materializer',
  packageJson,
  contributions: [
    { path: 'contributions/contract-model-materializer.json', manifest: contractManifest },
    { path: 'contributions/materializer-uvm.json', manifest: materializerManifest },
    { path: 'contributions/writer-uvm.json', manifest: writerManifest },
  ],
  modules: {
    './src/provider.js': provider,
    './src/writer.js': writer,
  },
})
