import { defineBuiltinModule } from '@modkit/host'

import browserManifest from '../contributions/provider-browser.json' with { type: 'json' }
import headlessManifest from '../contributions/provider-headless.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }
import * as browser from './render/browser.js'
import * as headless from './render/headless.js'

/**
 * Built-in scene providers for applications that choose to compile visual scene support.
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
  ],
  modules: {
    './dist/render/browser.js': browser,
    './dist/render/headless.js': headless,
  },
})

/** @deprecated Compatibility alias retained for callers of the former extension. */
export const rendering3d = sceneModule
