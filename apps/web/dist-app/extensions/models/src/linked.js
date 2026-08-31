import { defineLinkedExtension } from '@modkit/host'

import daeManifest from '../contributions/codec-dae.json' with { type: 'json' }
import gltfManifest from '../contributions/codec-gltf.json' with { type: 'json' }
import objManifest from '../contributions/codec-obj.json' with { type: 'json' }
import plyManifest from '../contributions/codec-ply.json' with { type: 'json' }
import stlManifest from '../contributions/codec-stl.json' with { type: 'json' }
import uvmManifest from '../contributions/codec-uvm.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as dae from './dae/codec.js'
import * as gltf from './gltf/codec.js'
import * as obj from './obj/codec.js'
import * as uvm from './uvm/codec.js'
import * as ply from './ply/codec.js'
import * as stl from './stl/codec.js'

export const models = defineLinkedExtension({
  source: 'linked:extensions/models',
  packageJson,
  contributions: [
    { path: 'contributions/codec-dae.json', manifest: daeManifest },
    { path: 'contributions/codec-gltf.json', manifest: gltfManifest },
    { path: 'contributions/codec-obj.json', manifest: objManifest },
    { path: 'contributions/codec-ply.json', manifest: plyManifest },
    { path: 'contributions/codec-stl.json', manifest: stlManifest },
    { path: 'contributions/codec-uvm.json', manifest: uvmManifest },
  ],
  modules: {
    './src/dae/codec.js': dae,
    './src/gltf/codec.js': gltf,
    './src/obj/codec.js': obj,
    './src/uvm/codec.js': uvm,
    './src/ply/codec.js': ply,
    './src/stl/codec.js': stl,
  },
})
