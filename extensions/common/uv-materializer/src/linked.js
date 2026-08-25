import { defineLinkedExtension } from '@modkitx-x3/host'

import contractManifest from '../contributions/contract-model-materializer.json' with { type: 'json' }
import textureContractManifest from '../contributions/contract-texture-materializer.json' with { type: 'json' }
import materializerManifest from '../contributions/materializer-uvm.json' with { type: 'json' }
import textureMaterializerManifest from '../contributions/materializer-uvt.json' with { type: 'json' }
import writerManifest from '../contributions/writer-uvm.json' with { type: 'json' }
import textureWriterManifest from '../contributions/writer-uvt.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as provider from './provider.js'
import * as textureProvider from './texture-provider.js'
import * as textureWriter from './texture-writer.js'
import * as writer from './writer.js'

export const uvMaterializer = defineLinkedExtension({
  source: 'linked:extensions/common/uv-materializer',
  packageJson,
  contributions: [
    { path: 'contributions/contract-model-materializer.json', manifest: contractManifest },
    { path: 'contributions/contract-texture-materializer.json', manifest: textureContractManifest },
    { path: 'contributions/materializer-uvm.json', manifest: materializerManifest },
    { path: 'contributions/materializer-uvt.json', manifest: textureMaterializerManifest },
    { path: 'contributions/writer-uvm.json', manifest: writerManifest },
    { path: 'contributions/writer-uvt.json', manifest: textureWriterManifest },
  ],
  modules: {
    './src/provider.js': provider,
    './src/texture-provider.js': textureProvider,
    './src/texture-writer.js': textureWriter,
    './src/writer.js': writer,
  },
})
