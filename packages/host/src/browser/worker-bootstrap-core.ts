/**
 * The executor half of the browser worker backend, runtime-agnostic: a real DOM worker script is
 * a three-line wrapper that receives the init message and calls this with
 * `framePortFromMessagePort(port)`. Unlike the Node bootstrap there is no verify-at-evaluation
 * step here — the module URL it imports *is* the verified snapshot the loader minted
 * (`loadVerifiedModuleGraph`), so there is no window for a tamper to fit into.
 */

import { ModkitError } from '@modkitx-x3/core'
import {
  createEndpoint,
  createStandardSurfaceRegistry,
  protocolLimits,
  type DataSourceSurfaceSource,
  type Endpoint,
  type FramePort,
  type ProtocolLimits,
} from '../execution/index.js'
import { wrapLoadedModule } from '../execution/module-reassembly.js'

export interface BrowserBootstrapInit {
  readonly port: FramePort
  readonly session: string
  readonly generation: number
  readonly limits: ProtocolLimits
  readonly foreignSurfaces: readonly DataSourceSurfaceSource[]
  /** The only module this endpoint will ever import (the loader's verified graph URL). */
  readonly moduleUrl: string
  /** The peer asked this side to terminate (a DOM worker calls `self.close()`). */
  readonly onTerminate?: (reason: string) => void
  readonly onFailure?: () => void
}

export function runBrowserWorkerBootstrap(init: BrowserBootstrapInit): Endpoint {
  let loads = 0
  return createEndpoint({
    role: 'worker',
    port: init.port,
    session: init.session,
    generation: init.generation,
    surfaces: createStandardSurfaceRegistry({ definitions: init.foreignSurfaces }),
    limits: protocolLimits(init.limits),
    loader: async request => {
      loads += 1
      if (loads > 1) {
        throw new ModkitError({
          code: 'x3.host/execution-load-rejected',
          message: 'a worker serves exactly one load',
        })
      }
      if (request.moduleUrl !== init.moduleUrl) {
        throw new ModkitError({
          code: 'x3.host/execution-load-rejected',
          message: 'this worker evaluates exactly the verified module snapshot it was spawned with',
        })
      }
      const module = (await import(/* @vite-ignore */ init.moduleUrl)) as Record<string, unknown>
      return { ...wrapLoadedModule(module), release: () => undefined }
    },
    ...(init.onTerminate === undefined ? {} : { onTerminate: init.onTerminate }),
    ...(init.onFailure === undefined ? {} : { onFailure: init.onFailure }),
  })
}
