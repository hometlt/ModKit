/** Windows-native execution of a previously validated, game-owned launch plan. */

import { spawn as spawnChildProcess } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { diagnostic, type Diagnostic } from '@modkit/core'
import { grantValidity, type PermissionGrant, type ResourceBudget } from '@modkit/sdk'
import type { GameInstallation, GameLaunchPlan, GameLaunchResource } from '@modkit/sdk/games'
import { planGameLaunch, type GamesHostServices, type GameLaunchPlanning } from '../games/index.js'

export type NodeGameLaunchPathKind = 'file' | 'directory' | 'missing'

export interface NodeGameLaunchFilesystem {
  kind(path: string): Promise<NodeGameLaunchPathKind>
  realpath(path: string): Promise<string>
}

export interface NodeGameProcessSpawnRequest {
  readonly executablePath: string
  readonly arguments: readonly string[]
  readonly workingDirectory: string
  readonly signal?: AbortSignal
}

export interface NodeGameProcessLease {
  readonly pid?: number
  release(): Promise<void>
}

export type NodeGameProcessSpawner = (
  request: NodeGameProcessSpawnRequest,
) => Promise<NodeGameProcessLease>

export interface LaunchNodeGameResourceRequest {
  readonly services: GamesHostServices
  readonly gameId: string
  readonly installation: GameInstallation
  readonly resource: GameLaunchResource
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
  readonly filesystem?: NodeGameLaunchFilesystem
  readonly spawner?: NodeGameProcessSpawner
}

export interface NodeGameLaunchReceipt {
  readonly schemaVersion: 1
  readonly planId: string
  readonly gameId: string
  readonly executablePath: string
  readonly workingDirectory: string
  readonly resource: GameLaunchResource
  readonly arguments: readonly string[]
  readonly pid?: number
}

export type NodeGameLaunchResult =
  | Readonly<{
      state: 'launched'
      receipt: NodeGameLaunchReceipt
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'denied' | 'unresolved' | 'invalid' | 'failed'
      diagnostics: readonly Diagnostic[]
    }>

const defaultFilesystem: NodeGameLaunchFilesystem = Object.freeze({
  async kind(path: string): Promise<NodeGameLaunchPathKind> {
    try {
      const value = await stat(path)
      if (value.isFile()) return 'file'
      if (value.isDirectory()) return 'directory'
      return 'missing'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
      throw error
    }
  },
  realpath,
})

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

/** Default detached spawner. It never invokes a shell and reports asynchronous spawn errors. */
export const spawnDetachedGameProcess: NodeGameProcessSpawner = request => {
  request.signal?.throwIfAborted()
  return new Promise((resolveLease, reject) => {
    const child = spawnChildProcess(request.executablePath, [...request.arguments], {
      cwd: request.workingDirectory,
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    let settled = false
    const cleanup = () => {
      child.off('spawn', onSpawn)
      child.off('error', onError)
      request.signal?.removeEventListener('abort', onAbort)
    }
    const onError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      child.kill()
      reject(
        request.signal === undefined
          ? new DOMException('The operation was aborted', 'AbortError')
          : abortReason(request.signal),
      )
    }
    const onSpawn = () => {
      if (settled) return
      settled = true
      cleanup()
      child.unref()
      const pid = child.pid
      resolveLease(
        Object.freeze({
          ...(pid === undefined ? {} : { pid }),
          release: async () => undefined,
        }),
      )
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
    request.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function containedBy(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate)
  return suffix === '' || (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !isAbsolute(suffix))
}

interface ValidatedNodeGameLaunchPaths {
  readonly executablePath: string
  readonly workingDirectory: string
}

function isPathDiagnostics(
  value: ValidatedNodeGameLaunchPaths | readonly Diagnostic[],
): value is readonly Diagnostic[] {
  return Array.isArray(value)
}

async function validateNodeGameLaunchPaths(
  plan: GameLaunchPlan,
  filesystem: NodeGameLaunchFilesystem,
  signal?: AbortSignal,
): Promise<ValidatedNodeGameLaunchPaths | readonly Diagnostic[]> {
  signal?.throwIfAborted()
  if (!isAbsolute(plan.installationRoot) || !isAbsolute(plan.resource.path)) {
    return [
      diagnostic(
        'error',
        'x3.host/game-launch-path-not-absolute',
        'the confirmed installation root and map path must both be absolute local paths',
      ),
    ]
  }
  const installationRoot = resolve(plan.installationRoot)
  const executablePath = resolve(installationRoot, plan.executableRelativePath)
  const workingDirectory = resolve(installationRoot, plan.workingDirectoryRelativePath)
  if (
    !containedBy(installationRoot, executablePath) ||
    !containedBy(installationRoot, workingDirectory)
  ) {
    return [
      diagnostic(
        'error',
        'x3.host/game-launch-path-escaped',
        'the game launch executable or working directory escaped the confirmed installation root',
      ),
    ]
  }

  const [rootKind, executableKind, workingKind, resourceKind] = await Promise.all([
    filesystem.kind(installationRoot),
    filesystem.kind(executablePath),
    filesystem.kind(workingDirectory),
    filesystem.kind(plan.resource.path),
  ])
  signal?.throwIfAborted()
  if (
    rootKind !== 'directory' ||
    executableKind !== 'file' ||
    workingKind !== 'directory' ||
    (resourceKind !== 'file' && resourceKind !== 'directory')
  ) {
    return [
      diagnostic(
        'error',
        'x3.host/game-launch-path-missing',
        'the confirmed installation, game launcher executable, working directory or map path is missing',
      ),
    ]
  }

  const [realRoot, realExecutable, realWorkingDirectory] = await Promise.all([
    filesystem.realpath(installationRoot),
    filesystem.realpath(executablePath),
    filesystem.realpath(workingDirectory),
  ])
  signal?.throwIfAborted()
  if (!containedBy(realRoot, realExecutable) || !containedBy(realRoot, realWorkingDirectory)) {
    return [
      diagnostic(
        'error',
        'x3.host/game-launch-realpath-escaped',
        'the game launch executable or working directory resolves outside the confirmed installation root',
      ),
    ]
  }
  return Object.freeze({ executablePath: realExecutable, workingDirectory: realWorkingDirectory })
}

function isPlanningFailure(
  planning: GameLaunchPlanning,
): planning is Extract<GameLaunchPlanning, { readonly state: 'unresolved' }> {
  return planning.state === 'unresolved'
}

/**
 * Thin application entry: require explicit process authority, plan through the game provider,
 * validate local paths, then execute through a host-owned injected spawner.
 */
export async function launchNodeGameResource(
  request: LaunchNodeGameResourceRequest,
): Promise<NodeGameLaunchResult> {
  const validity = grantValidity(request.grant)
  if (validity.state !== 'valid' || !request.grant.classes.includes('process-launch')) {
    return Object.freeze({
      state: 'denied' as const,
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'x3.host/game-launch-permission-required',
          'native game launch requires an explicit, live process-launch PermissionGrant',
        ),
      ]),
    })
  }
  if (process.platform !== 'win32') {
    return Object.freeze({
      state: 'unresolved' as const,
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'x3.host/game-launch-platform-unsupported',
          'this native game launch executor is available only from a Windows Node host',
        ),
      ]),
    })
  }
  request.signal?.throwIfAborted()
  const planning = await planGameLaunch(request)
  if (isPlanningFailure(planning)) {
    return Object.freeze({ state: 'unresolved' as const, diagnostics: planning.diagnostics })
  }

  let paths: ValidatedNodeGameLaunchPaths | readonly Diagnostic[]
  try {
    paths = await validateNodeGameLaunchPaths(
      planning.plan,
      request.filesystem ?? defaultFilesystem,
      request.signal,
    )
  } catch (error) {
    if (request.signal?.aborted === true) throw error
    return Object.freeze({
      state: 'invalid' as const,
      diagnostics: Object.freeze([
        ...planning.diagnostics,
        diagnostic(
          'error',
          'x3.host/game-launch-path-check-failed',
          `the host could not validate native game paths (${error instanceof Error ? error.message : String(error)})`,
        ),
      ]),
    })
  }
  if (isPathDiagnostics(paths)) {
    return Object.freeze({
      state: 'invalid' as const,
      diagnostics: Object.freeze([...planning.diagnostics, ...paths]),
    })
  }

  let processLease: NodeGameProcessLease
  try {
    processLease = await (request.spawner ?? spawnDetachedGameProcess)({
      executablePath: paths.executablePath,
      arguments: planning.plan.arguments,
      workingDirectory: paths.workingDirectory,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (request.signal?.aborted === true) await processLease.release()
    request.signal?.throwIfAborted()
  } catch (error) {
    if (request.signal?.aborted === true) throw error
    return Object.freeze({
      state: 'failed' as const,
      diagnostics: Object.freeze([
        ...planning.diagnostics,
        diagnostic(
          'error',
          'x3.host/game-launch-spawn-failed',
          `the host could not start the game process (${error instanceof Error ? error.message : String(error)})`,
        ),
      ]),
    })
  }

  let released = false
  return Object.freeze({
    state: 'launched',
    receipt: Object.freeze({
      schemaVersion: 1,
      planId: planning.plan.planId,
      gameId: planning.plan.gameId,
      executablePath: paths.executablePath,
      workingDirectory: paths.workingDirectory,
      resource: planning.plan.resource,
      arguments: planning.plan.arguments,
      ...(processLease.pid === undefined ? {} : { pid: processLease.pid }),
    }),
    diagnostics: planning.diagnostics,
    async release() {
      if (released) return
      released = true
      await processLease.release()
    },
  })
}
