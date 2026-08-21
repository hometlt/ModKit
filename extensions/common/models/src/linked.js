import { defineLinkedExtension } from '@modkitx-x3/host'

import gltfManifest from '../contributions/codec-gltf.json' with { type: 'json' }
import objManifest from '../contributions/codec-obj.json' with { type: 'json' }
import uvmManifest from '../contributions/codec-uvm.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as gltf from './formats/gltf/codec.js'
import * as obj from './formats/obj/codec.js'
import * as uvm from './formats/uvm/codec.js'

export const models = defineLinkedExtension({
  source: 'linked:extensions/common/models',
  packageJson,
  contributions: [
    { path: 'contributions/codec-gltf.json', manifest: gltfManifest },
    { path: 'contributions/codec-obj.json', manifest: objManifest },
    { path: 'contributions/codec-uvm.json', manifest: uvmManifest },
  ],
  modules: {
    './src/formats/gltf/codec.js': gltf,
    './src/formats/obj/codec.js': obj,
    './src/formats/uvm/codec.js': uvm,
  },
})
