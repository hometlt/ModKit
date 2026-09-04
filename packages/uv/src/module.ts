import { defineBuiltinModule } from '@modkit/host'

import modelContractManifest from '../contributions/contract-model-materializer.json' with { type: 'json' }
import textureContractManifest from '../contributions/contract-texture-materializer.json' with { type: 'json' }
import modelMaterializerManifest from '../contributions/materializer-uvm.json' with { type: 'json' }
import textureMaterializerManifest from '../contributions/materializer-uvt.json' with { type: 'json' }
import modelWriterManifest from '../contributions/writer-uvm.json' with { type: 'json' }
import textureWriterManifest from '../contributions/writer-uvt.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as modelProvider from './model/provider.js'
import * as modelWriter from './model/writer.js'
import * as textureProvider from './texture/provider.js'
import * as textureWriter from './texture/writer.js'

/**
 * Universal visual support compiled into a product composition.
 *
 * It uses the same contribution gate and service resolver as installed extensions, but its
 * explicit built-in kind keeps it out of Extension Manager's install/remove lifecycle.
 */
export const uvModule = defineBuiltinModule({
  coordinate: 'modkit/uv',
  packageJson,
  contributions: [
    { path: 'contributions/contract-model-materializer.json', manifest: modelContractManifest },
    {
      path: 'contributions/contract-texture-materializer.json',
      manifest: textureContractManifest,
    },
    { path: 'contributions/materializer-uvm.json', manifest: modelMaterializerManifest },
    { path: 'contributions/materializer-uvt.json', manifest: textureMaterializerManifest },
    { path: 'contributions/writer-uvm.json', manifest: modelWriterManifest },
    { path: 'contributions/writer-uvt.json', manifest: textureWriterManifest },
  ],
  modules: {
    './dist/model/provider.js': modelProvider,
    './dist/model/writer.js': modelWriter,
    './dist/texture/provider.js': textureProvider,
    './dist/texture/writer.js': textureWriter,
  },
})
