/**
 * Worker-side bootstrap of the Node worker backend (NXT-114). Runs inside a `worker_threads`
 * Worker the host spawned with the isolation options of THREAT_MODEL_WORKER_BOUNDARY §2 and:
 *
 *  - runs a worker-role capability-RPC endpoint over the transferred `MessagePort`, with the same
 *    surface registry the host built (standard data-source surfaces + runtime-ABI surfaces + the
 *    foreign definition surfaces handed over as data);
 *  - serves exactly one `load`: the module URL must be a `file:` URL whose real path stays inside
 *    the artifact root, the entrypoint bytes are read once, re-hashed against `entrypointDigest`
 *    and evaluated *from those bytes* (a `data:` module) — never a second read from disk, so the
 *    gate's digest check and the evaluation cannot disagree; a module that needs relative imports
 *    is refused with `x3.host/artifact-not-pinned` instead of falling back to a `file:` import
 *    (§8 decision 3: no silent downgrade);
 *  - re-assembles the ABI objects the module expects from what crosses the wire: the
 *    `ContributionContext` (`budgets` copied, `diagnostics` a host capability, `contracts` a port
 *    that refuses — service resolution from a worker is not in v1), an `AssetInput` (fields +
 *    host-executed openers + locally derived `bindingsFor`);
 *  - exits 0 on `terminate`, 2 on a protocol failure (the host has already torn down).
 *
 * The bootstrap is a published entry (`@modkitx-x3/host/node/worker-bootstrap`) so it survives
 * bundling as its own file; the backend resolves it relative to its own module URL.
 */

import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { workerData, type MessagePort } from 'node:worker_threads'
import { ModkitError, type Diagnostic } from '@modkitx-x3/core'
import type { ContributionContext, ResourceBudget } from '@modkitx-x3/sdk'
import {
  ABI_CODEC_MODULE,
  createEndpoint,
  createStandardSurfaceRegistry,
  protocolLimits,
  type DataSourceSurfaceSource,
  type FramePort,
  type LoadRequest,
  type LoadedModule,
  type ProtocolLimits,
} from '../execution/index.js'

interface BootstrapData {
  readonly session: string
  readonly generation: number
  readonly port: MessagePort
  readonly limits: ProtocolLimits
  readonly artifactRoot: string
  readonly foreignSurfaces: readonly DataSourceSurfaceSource[]
}

const data = workerData as BootstrapData

function framePort(port: MessagePort): FramePort {
  return {
    post: (frame, transfer) => port.postMessage(frame, [...transfer]),
    onFrame: handler => {
      const listener = (payload: unknown) => handler(payload)
      port.on('message', listener)
      return () => port.off('message', listener)
    },
  }
}

const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

async function containedRealPath(moduleUrl: string, artifactRoot: string): Promise<string> {
  const url = new URL(moduleUrl)
  if (url.protocol !== 'file:') {
    throw new ModkitError({
      code: 'x3.host/execution-load-rejected',
      message: `worker loads file: modules only, received ${url.protocol}`,
    })
  }
  const rootPath = await realpath(fileURLToPath(new URL(artifactRoot)))
  const modulePath = await realpath(fileURLToPath(url))
  const rootUrl = pathToFileURL(
    rootPath.endsWith('/') || rootPath.endsWith('\\') ? rootPath : `${rootPath}/`,
  ).href
  const moduleHref = pathToFileURL(modulePath).href
  if (!moduleHref.startsWith(rootUrl)) {
    throw new ModkitError({
      code: 'x3.host/execution-load-rejected',
      message: 'module real path escapes the artifact root',
    })
  }
  return modulePath
}

let loads = 0

async function loader(request: LoadRequest): Promise<LoadedModule> {
  loads += 1
  if (loads > 1) {
    throw new ModkitError({
      code: 'x3.host/execution-load-rejected',
      message: 'a worker serves exactly one load',
    })
  }
  const modulePath = await containedRealPath(request.moduleUrl, data.artifactRoot)
  const bytes = await readFile(modulePath)
  if (request.entrypointDigest !== undefined && sha256(bytes) !== request.entrypointDigest) {
    throw new ModkitError({
      code: 'x3.host/artifact-digest-mismatch',
      message: 'the entrypoint changed after the host verified it and will not be evaluated',
    })
  }
  // evaluate exactly the verified bytes; relative imports cannot resolve from a data: module and
  // are refused rather than re-read from disk
  let module: Record<string, unknown>
  try {
    module = (await import(`data:text/javascript;base64,${bytes.toString('base64')}`)) as Record<
      string,
      unknown
    >
  } catch (error) {
    const code = (error as { code?: string }).code
    if (
      code === 'ERR_UNSUPPORTED_RESOLVE_REQUEST' ||
      code === 'ERR_MODULE_NOT_FOUND' ||
      code === 'ERR_INVALID_URL'
    ) {
      throw new ModkitError({
        code: 'x3.host/artifact-not-pinned',
        message:
          'the entrypoint imports other files; the worker backend evaluates verified bytes only',
        context: { reason: code },
      })
    }
    throw error
  }
  return {
    module: wrapModule(module),
    surface: ABI_CODEC_MODULE,
    release: () => undefined,
  }
}

// ---------------------------------------------------------------------------------------------
// ABI re-assembly

interface WireContext {
  readonly budgets: ResourceBudget
  readonly diagnostics?: { report(diagnostic: Diagnostic): Promise<unknown> }
}

function contributionContext(wire: WireContext): ContributionContext {
  const sink = wire.diagnostics
  return {
    budgets: wire.budgets,
    diagnostics: {
      report(diagnostic) {
        if (sink !== undefined) void sink.report(diagnostic).catch(() => undefined)
      },
    },
    contracts: {
      resolve: () =>
        Promise.reject(
          new ModkitError({
            code: 'x3.host/execution-backend-unavailable',
            message: 'service contract resolution from a worker is not available in v1',
          }),
        ),
      resolveUnknown: () =>
        Promise.reject(
          new ModkitError({
            code: 'x3.host/execution-backend-unavailable',
            message: 'service contract resolution from a worker is not available in v1',
          }),
        ),
    } as ContributionContext['contracts'],
  }
}

interface WireInput extends Record<string, unknown> {
  readonly bindings?: readonly { readonly sourceKind?: string; readonly requirementId?: string }[]
}

/** Derives the sync helpers the ABI declares from the copied fields. */
function assetInput(wire: WireInput): Record<string, unknown> {
  const bindings = wire.bindings ?? []
  return Object.assign(Object.create(null) as Record<string, unknown>, wire, {
    bindingsFor: (requirementId: string) =>
      bindings.filter(
        binding => binding.sourceKind === 'requirement' && binding.requirementId === requirementId,
      ),
  })
}

function wrapModule(module: Record<string, unknown>): Record<string, unknown> {
  const createCodec = module['createCodec']
  return {
    abiVersion: module['abiVersion'],
    createCodec:
      typeof createCodec !== 'function'
        ? undefined
        : (wire: WireContext) => {
            const codec = (
              createCodec as (context: ContributionContext) => Record<string, unknown>
            )(contributionContext(wire))
            const open = codec['open']
            return {
              ...codec,
              ...(typeof open !== 'function'
                ? {}
                : {
                    open: (input: WireInput, ...rest: unknown[]) =>
                      (open as (...args: unknown[]) => unknown).call(
                        codec,
                        assetInput(input),
                        ...rest,
                      ),
                  }),
            }
          },
  }
}

// ---------------------------------------------------------------------------------------------
// run

createEndpoint({
  role: 'worker',
  port: framePort(data.port),
  session: data.session,
  generation: data.generation,
  surfaces: createStandardSurfaceRegistry({ definitions: data.foreignSurfaces }),
  limits: protocolLimits(data.limits),
  loader,
  onTerminate: () => process.exit(0),
  onFailure: () => process.exit(2),
})
