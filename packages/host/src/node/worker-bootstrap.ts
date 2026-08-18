/**
 * Worker-side bootstrap of the Node worker backend (NXT-114). Runs inside a `worker_threads`
 * Worker the host spawned with the isolation options of THREAT_MODEL_WORKER_BOUNDARY §2 and:
 *
 *  - runs a worker-role capability-RPC endpoint over the transferred `MessagePort`, with the same
 *    surface registry the host built (standard data-source surfaces + runtime-ABI surfaces + the
 *    foreign definition surfaces handed over as data);
 *  - serves exactly one `load`: the module URL must be a `file:` URL whose real path stays inside
 *    the artifact root; every module of the graph that lives inside the artifact is loaded through
 *    synchronous module hooks (`module.registerHooks`) that read the file once, verify its bytes
 *    against the per-file digest the inventory recorded (`fileDigests`) and hand *those bytes* to
 *    the evaluator — never a second read from disk, so the gate's digest check and the evaluation
 *    cannot disagree; a file the inventory does not know is refused, a modified one is
 *    `x3.host/artifact-digest-mismatch`. Bare dependencies resolved through the artifact's
 *    `node_modules` and `node:` builtins load normally but unverified (SB-1 honesty: the worker
 *    shares the process anyway; a digest map that covers dependencies is SB-4 territory). Without a
 *    digest map only the entrypoint is verified (`entrypointDigest`) and its imports are refused as
 *    `x3.host/artifact-not-pinned` (§8 decision 3: no silent downgrade);
 *  - re-assembles the ABI objects the module expects from what crosses the wire: the
 *    `ContributionContext` (`budgets` copied, `diagnostics` and `contracts` host capabilities —
 *    a resolved provider arrives as a proxy carrying the surface of its contract definition), an
 *    `AssetInput` (fields + host-executed openers + locally derived `bindingsFor`);
 *  - exits 0 on `terminate`, 2 on a protocol failure (the host has already torn down).
 *
 * The bootstrap is a published entry (`@modkitx-x3/host/node/worker-bootstrap`) so it survives
 * bundling as its own file; the backend resolves it relative to its own module URL.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { registerHooks } from 'node:module'
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
  /** Per-file digests of the artifact as inventoried; absent → entrypoint-only verification. */
  readonly fileDigests?: Readonly<Record<string, string>>
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

// ---------------------------------------------------------------------------------------------
// verified loading

const rootPath = fileURLToPath(new URL(data.artifactRoot))
let rootReal: string | undefined
const rootRealPath = async (): Promise<string> => {
  rootReal ??= await realpath(rootPath)
  return rootReal
}
const rootHref = (real: string) =>
  pathToFileURL(real.endsWith('/') || real.endsWith('\\') ? real : `${real}/`).href

async function containedRealPath(moduleUrl: string): Promise<string> {
  const url = new URL(moduleUrl)
  if (url.protocol !== 'file:') {
    throw new ModkitError({
      code: 'x3.host/execution-load-rejected',
      message: `worker loads file: modules only, received ${url.protocol}`,
    })
  }
  const modulePath = await realpath(fileURLToPath(url))
  if (!pathToFileURL(modulePath).href.startsWith(rootHref(await rootRealPath()))) {
    throw new ModkitError({
      code: 'x3.host/execution-load-rejected',
      message: 'module real path escapes the artifact root',
    })
  }
  return modulePath
}

/** Posix path of a file URL relative to the artifact root, or undefined when outside/node_modules. */
function artifactRelativePath(url: string): string | undefined {
  if (!url.startsWith('file:')) return undefined
  const rootUrl = rootHref(rootPath)
  const realRoot = rootReal === undefined ? undefined : rootHref(rootReal)
  const base = url.startsWith(rootUrl)
    ? rootUrl
    : realRoot !== undefined && url.startsWith(realRoot)
      ? realRoot
      : undefined
  if (base === undefined) return undefined
  const relative = decodeURIComponent(url.slice(base.length))
  if (relative.split('/').includes('node_modules')) return undefined
  return relative
}

/** Relative (`./`, `../`), absolute (`/`, drive letter) or `file:` specifiers — as opposed to bare package names. */
function isPathSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/') ||
    specifier.startsWith('file:') ||
    /^[a-zA-Z]:[\\/]/.test(specifier)
  )
}

const verified = new Set<string>()
let hooksInstalled = false
let entrypointRelative: string | undefined

/**
 * Module hooks: everything under the artifact root (except `node_modules`) is served from bytes
 * that were verified against the inventory's per-file digests; a file the map does not list is
 * refused. Other URLs (`node:`, dependencies under `node_modules`) take the default path.
 */
function installHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      const url = resolved.url
      if (url.startsWith('node:') || url.startsWith('data:')) return resolved
      if (!url.startsWith('file:')) {
        throw new ModkitError({
          code: 'x3.host/execution-load-rejected',
          message: `worker refuses ${url.split(':')[0] ?? '?'}: imports`,
        })
      }
      const relative = artifactRelativePath(url)
      if (relative === undefined) {
        // outside the artifact. Allowed when it is a dependency: a bare specifier resolved by
        // Node's algorithm from inside the artifact (its node_modules, workspace links included),
        // or anything imported by a module that itself lives outside the artifact (a dependency's
        // own files). A relative/absolute import from inside the artifact that lands outside it is
        // an escape and is refused.
        const bare = !isPathSpecifier(specifier)
        const parentInside =
          context.parentURL !== undefined && artifactRelativePath(context.parentURL) !== undefined
        if (parentInside && !bare) {
          throw new ModkitError({
            code: 'x3.host/execution-load-rejected',
            message: 'import escapes the artifact root and is not a declared dependency',
            context: { specifier },
          })
        }
        return resolved
      }
      if (data.fileDigests === undefined && relative !== entrypointRelative) {
        throw new ModkitError({
          code: 'x3.host/artifact-not-pinned',
          message:
            'the entrypoint imports other artifact files but the inventory recorded no per-file digests',
          context: { specifier },
        })
      }
      return resolved
    },
    load(url, context, nextLoad) {
      const relative = artifactRelativePath(url)
      if (relative === undefined) return nextLoad(url, context)
      const bytes = readFileSync(fileURLToPath(url))
      const expected = data.fileDigests?.[relative]
      if (data.fileDigests !== undefined) {
        if (expected === undefined) {
          throw new ModkitError({
            code: 'x3.host/execution-load-rejected',
            message: `${relative} is not part of the inventoried artifact`,
          })
        }
        if (sha256(bytes) !== expected) {
          throw new ModkitError({
            code: 'x3.host/artifact-digest-mismatch',
            message: `${relative} changed after the inventory recorded it and will not be evaluated`,
          })
        }
      }
      verified.add(relative)
      // hand the verified bytes to the evaluator: no second read, no window
      return { format: 'module', shortCircuit: true, source: bytes }
    },
  })
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
  const modulePath = await containedRealPath(request.moduleUrl)
  const moduleUrl = pathToFileURL(modulePath).href
  entrypointRelative = artifactRelativePath(moduleUrl)
  // the entrypoint's own bytes are verified against the digest the host took (or the inventory
  // map, whichever the hooks see first); read once here for the explicit entrypoint check
  const bytes = await readFile(modulePath)
  if (request.entrypointDigest !== undefined && sha256(bytes) !== request.entrypointDigest) {
    throw new ModkitError({
      code: 'x3.host/artifact-digest-mismatch',
      message: 'the entrypoint changed after the host verified it and will not be evaluated',
    })
  }
  installHooks()
  const module = (await import(moduleUrl)) as Record<string, unknown>
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
  /** Host-executed contract resolver (materialized proxy of `x3.abi/contract-resolver@1`). */
  readonly contracts?: ContributionContext['contracts']
}

const unavailableResolver = {
  resolve: () =>
    Promise.reject(
      new ModkitError({
        code: 'x3.host/execution-backend-unavailable',
        message: 'the host did not hand this worker a contract resolver',
      }),
    ),
  resolveUnknown: () =>
    Promise.reject(
      new ModkitError({
        code: 'x3.host/execution-backend-unavailable',
        message: 'the host did not hand this worker a contract resolver',
      }),
    ),
} as ContributionContext['contracts']

function contributionContext(wire: WireContext): ContributionContext {
  const sink = wire.diagnostics
  return {
    budgets: wire.budgets,
    diagnostics: {
      report(diagnostic) {
        if (sink !== undefined) void sink.report(diagnostic).catch(() => undefined)
      },
    },
    contracts: wire.contracts ?? unavailableResolver,
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
