import { defineBuiltinModule } from '@modkit/host'

import browserManifest from '../contributions/provider-browser.json' with { type: 'json' }
import headlessManifest from '../contributions/provider-headless.json' with { type: 'json' }
import uvpCodecManifest from '../contributions/codec-uvp.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as browser from './render/browser.js'
import * as headless from './render/headless.js'
import * as uvpCodec from './uvp/codec.js'

/**
 * Built-in scene providers for applications that choose to compile visual scene support, and the
 * world package codec (`.uvp`), whose object models only the scene's UVM decoder reads.
 *
 * Contributions still pass through the normal host resolver; built-in describes ownership and
 * deployment, not a second provider protocol.
 */
export const sceneModule = defineBuiltinModule({
  coordinate: 'modkit/scene',
  packageJson,
  contributions: [
    { path: 'contributions/provider-browser.json', manifest: browserManifest },
    { path: 'contributions/provider-headless.json', manifest: headlessManifest },
    { path: 'contributions/codec-uvp.json', manifest: uvpCodecManifest },
  ],
  modules: {
    './dist/render/browser.js': browser,
    './dist/render/headless.js': headless,
    './dist/uvp/codec.js': uvpCodec,
  },
})

/** @deprecated Compatibility alias retained for callers of the former extension. */
export const rendering3d = sceneModule
