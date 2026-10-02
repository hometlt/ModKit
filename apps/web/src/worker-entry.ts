/**
 * The web's codec worker: the host's worker entry, and the software texture decoder told where its
 * Wasm is (audit 49). In a browser, codec-kit's Texture2DDecoder runs only after
 * `initializeGpuTextureWasmBrowser`; until a host called it, the images codec kept a vendored copy
 * of the same runtime for BC6H and BC7.
 *
 * The vendor modules a codec imports in this worker (`vendor/codec-kit/texture/…`) are one esbuild
 * graph with this entry (`scripts/build.mjs`, splitting on), so they share the runtime it starts.
 * The build copies the package's `wasm/` beside the app as `vendor/texture2ddecoder-wasm/wasm/`.
 */
import '@modkit/host/browser/worker-entry'

import { initializeGpuTextureWasmBrowser } from '../../../packages/codec-kit/dist/texture/index.js'

// Not awaited: a decode waits for it, and one that fails names the missing assets then.
void initializeGpuTextureWasmBrowser({
  assetBaseUrl: new URL('./vendor/texture2ddecoder-wasm/', import.meta.url),
}).catch(() => undefined)
