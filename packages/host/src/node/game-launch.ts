/** Windows-native execution of a previously validated, game-owned launch plan. */

import { execFile, spawn as spawnChildProcess } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { diagnostic, type Diagnostic } from '@modkit/core'
import {
  grantValidity,
  type JsonValue,
  type PermissionGrant,
  type ResourceBudget,
} from '@modkit/sdk'
import type {
  GameInstallation,
  GameLaunchLogReport,
  GameLaunchPlan,
  GameLaunchResource,
} from '@modkit/sdk/games'
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
  /** The user's launch options, passed to the game's planner. */
  readonly options?: Readonly<Record<string, JsonValue>>
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
  /** The validated plan, for what follows a launch (its log location, its process names). */
  readonly plan: GameLaunchPlan
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
      plan: planning.plan,
    }),
    diagnostics: planning.diagnostics,
    async release() {
      if (released) return
      released = true
      await processLease.release()
    },
  })
}

const execFileAsync = promisify(execFile)

/** Which of these process image names are running now (Windows `tasklist`; none elsewhere). */
export async function runningGameProcesses(names: readonly string[]): Promise<readonly string[]> {
  if (process.platform !== 'win32' || names.length === 0) return []
  const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH']).catch(() => ({ stdout: '' }))
  const running = new Set(
    stdout
      .split(/\r?\n/u)
      .map(line => /^"([^"]+)"/u.exec(line)?.[1]?.toLowerCase())
      .filter((name): name is string => name !== undefined),
  )
  return names.filter(name => running.has(name.toLowerCase()))
}

/**
 * Close a running game before a relaunch. Process authority is the same explicit, live
 * `process-launch` grant a launch needs; names come from the game's own plan.
 */
export async function stopGameProcesses(
  names: readonly string[],
  grant: PermissionGrant,
): Promise<readonly Diagnostic[]> {
  if (grantValidity(grant).state !== 'valid' || !grant.classes.includes('process-launch')) {
    return [
      diagnostic(
        'error',
        'x3.host/game-launch-permission-required',
        'closing a running game requires an explicit, live process-launch PermissionGrant',
      ),
    ]
  }
  if (process.platform !== 'win32') return []
  for (const name of names) {
    await execFileAsync('taskkill', ['/IM', name, '/F']).catch(() => undefined)
  }
  // The game releases its files a moment after its process is gone.
  await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000))
  return []
}

export interface WatchGameLaunchLogsRequest {
  readonly plan: GameLaunchPlan
  /** The user's documents folder; `~/Documents` when absent. */
  readonly documentsDirectory?: string
  /** Read one new log file (the game's planner, through `interpretGameLaunchLog`). */
  readonly interpret: (fileName: string, text: string) => Promise<GameLaunchLogReport>
  readonly onReport: (fileName: string, report: GameLaunchLogReport) => void | Promise<void>
  readonly onLog?: (message: string) => void
  readonly onError?: (error: unknown) => void
  /** Stop after this long without a final report. */
  readonly timeoutMs?: number
  /** Let the game finish writing a file before it is read. */
  readonly writeDelayMs?: number
}

export interface GameLaunchLogWatch {
  readonly directory: string
  dispose(): void
}

/** A file-name pattern where `*` matches anything, case-insensitive like every Windows name. */
const patternExpression = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^$(){}|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*')
  return new RegExp('^' + escaped + '$', 'iu')
}

/**
 * Watch the folder a launched game logs to and hand each new matching file to the game's reader.
 * Files already there are old runs and are ignored. Stops at the first final report, on
 * `dispose`, or after the timeout. Undefined when the plan logs nowhere or the folder is missing.
 */
export async function watchGameLaunchLogs(
  request: WatchGameLaunchLogsRequest,
): Promise<GameLaunchLogWatch | undefined> {
  const logs = request.plan.logs
  if (logs === undefined) return undefined
  const base = request.documentsDirectory?.trim() || join(homedir(), 'Documents')
  const directory = resolve(base, logs.relativePath)
  if (!containedBy(resolve(base), directory)) return undefined
  const expressions = logs.patterns.map(patternExpression)
  const matches = (name: string): boolean => expressions.some(expression => expression.test(name))
  let existing: string[]
  try {
    existing = await readdir(directory)
  } catch {
    return undefined
  }
  const seen = new Set(existing.filter(matches).map(name => name.toLowerCase()))
  let watcher: FSWatcher | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let finished = false
  const dispose = (): void => {
    finished = true
    watcher?.close()
    watcher = undefined
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const handle = async (name: string): Promise<void> => {
    if (finished) return
    const text = await readFile(join(directory, name), 'utf8')
    const report = await request.interpret(name, text)
    if (finished) return
    if (report.final) dispose()
    await request.onReport(name, report)
  }
  request.onLog?.(`watching ${directory} (${seen.size} earlier log files ignored)`)
  watcher = watch(directory, (_event, fileName) => {
    const name = fileName?.toString()
    if (name === undefined || finished || !matches(name) || seen.has(name.toLowerCase())) return
    seen.add(name.toLowerCase())
    setTimeout(() => {
      void handle(name).catch(error => request.onError?.(error))
    }, request.writeDelayMs ?? 300)
  })
  timer = setTimeout(() => {
    request.onLog?.('no new game log arrived; stopped watching')
    dispose()
  }, request.timeoutMs ?? 90_000)
  return Object.freeze({ directory, dispose })
}
