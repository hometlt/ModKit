import {
  configure,
  getLogger as getLogTapeLogger,
  getTextFormatter,
  type Logger,
  type LogLevel,
  type Sink,
  type TextFormatterOptions,
} from '@logtape/logtape'
import { getPrettyFormatter } from '@logtape/pretty'
import { getRotatingFileSink } from '@logtape/file'
import { inspect } from 'node:util'
import { getLogger, installLoggerFactory } from './logger.js'

const ROOT = 'modkit'

installLoggerFactory(category => getLogTapeLogger([ROOT, ...category]))

const LEVEL_ORDER: readonly LogLevel[] = ['trace', 'debug', 'info', 'warning', 'error', 'fatal']

function levelAtLeast(level: LogLevel, min: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(min)
}

/** Longest-matching-prefix lookup over category overrides, mirroring how LogTape itself
 * resolves the nearest ancestor's `lowestLevel` — used so the self-filtering console sink
 * (see `stderrSink`) respects A1 category overrides, not just the global level. */
function makeLevelResolver(
  fallback: LogLevel,
  overrides: ReadonlyArray<{ path: readonly string[]; level: LogLevel }>,
): (category: readonly string[]) => LogLevel {
  return category => {
    let best: LogLevel | undefined
    let bestLen = -1
    for (const o of overrides) {
      if (
        o.path.length > bestLen &&
        o.path.length <= category.length &&
        o.path.every((seg, i) => category[i] === seg)
      ) {
        best = o.level
        bestLen = o.path.length
      }
    }
    return best ?? fallback
  }
}

export { getLogger }

/** Single-line plain formatter shared by stderr's plain mode and the file sink (A5) — no
 * ANSI, structured props inspected inline. `timestamp` is LogTape's own option name
 * ('none' for stderr, where the host channel already timestamps each line; a real format
 * for the file, which has no such surrounding UI). */
function plainTextFormatter(
  timestamp: NonNullable<TextFormatterOptions['timestamp']>,
  includeLevel = true,
) {
  return getTextFormatter({
    timestamp,
    level: 'ABBR',
    category: cat => cat.join('·'),
    format: ({ timestamp: ts, level, category, message, record }) => {
      const props = record.properties as Record<string, unknown> | undefined
      const extra =
        props && Object.keys(props).length > 0
          ? ' ' + inspect(props, { depth: 3, compact: true, breakLength: Infinity, colors: false })
          : ''
      // The LSP console transport carries severity as its own field (the host renders
      // `[debug]`/`[info]`/…), so the `DBG`/`INF` abbreviation would be a redundant second
      // label; stderr and the file sink keep it since they have no surrounding level UI.
      const levelTag = includeLevel ? `${level} ` : ''
      return `${ts ? `${ts} ` : ''}${levelTag}${category} ${message}${extra}`
    },
  })
}

// A plain function sink that writes to process.stderr WITHOUT owning/closing it — unlike a
// stream sink over Writable.toWeb(process.stderr), which LogTape's reset:true would close
// (breaking repeated configure() calls in tests and corrupting stderr). stdout is reserved
// for the LSP protocol and `modkit check` results, so ALL logs go to stderr.
//
// Self-filters against `minLevelFor(category)` rather than relying on the logger's own
// `lowestLevel` gate: when a file sink (A5) is also attached, the root logger's gate opens
// to `debug` so the file sink sees everything regardless of the visible level — so stderr
// has to enforce its own (category-aware) threshold instead of trusting the shared gate.
function stderrSink(minLevelFor: (category: readonly string[]) => LogLevel): Sink {
  // Pretty output (colour + icons + column alignment) ONLY when stderr is an interactive terminal
  // — e.g. a developer running `modkit check` or `modkit lsp --verbose` directly. When stderr is
  // consumed by a log channel (the language server the editor spawns, whose stderr feeds VS Code's
  // LogOutputChannel), emit plain single-line text: that channel does NOT interpret ANSI, so pretty
  // output renders as raw escape codes, and multi-line property dumps produce orphaned continuation
  // lines.
  //
  // `isTTY` is only a fallback autodetect: it asks "is a terminal on the other end", but under a
  // VS Code Development host the spawned server's stderr inherits the host's TTY even though the
  // output still routes to a (non-ANSI) LogOutputChannel — so isTTY misfires there. The spawner
  // knows the truth, so an explicit `SC2MOD_LOG_FORMAT=pretty|plain` wins when set (the VS Code
  // client sets `plain`); otherwise fall back to isTTY.
  const forced = process.env['SC2MOD_LOG_FORMAT']
  const pretty = forced === 'pretty' || (forced !== 'plain' && !!process.stderr.isTTY)
  const format = pretty
    ? getPrettyFormatter({
        // Render structured data — the pretty formatter drops properties by default
        // (`properties: false`), which hid @logIt's `ms`/args/result and any `logger.x(msg, props)`.
        properties: true,
        inspectOptions: { colors: false, depth: 3, compact: true },
      })
    : // No timestamp — the host log channel adds its own. Keep our real level (the channel labels
      // every server-stderr line `[error]` regardless of severity, so this is the only place the
      // true level shows).
      plainTextFormatter('none')
  return record => {
    if (!levelAtLeast(record.level, minLevelFor(record.category))) return
    const line = format(record)
    process.stderr.write(line.endsWith('\n') ? line : line + '\n')
  }
}

/**
 * A5: a rotating file sink for the modkit data dir — the file a user attaches to a bug
 * report. Always writes at `debug` and below is filtered upstream by the root logger's gate
 * (see {@link configureLogging}: opening the gate to `debug` whenever a file sink is
 * attached is what makes this "independent of the channel's visible level"). 5 MiB × 5 files
 * by default; timestamped single-line plain text (no ANSI — this file is read by humans and
 * pasted into reports, or walked by an LLM).
 */
export function createFileSink(filePath: string): Sink & Disposable {
  return getRotatingFileSink(filePath, {
    formatter: plainTextFormatter('date-time-tz'),
    maxSize: 5 * 1024 * 1024,
    maxFiles: 5,
  })
}

/**
 * The slice of `vscode-languageserver`'s `connection.console` this sink needs. Declared
 * structurally so `@modkitx/core` keeps no dependency on the LSP packages.
 */
export interface LspConsoleLike {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/**
 * A sink that ships records over the LSP connection (`window/logMessage`) instead of stderr.
 *
 * Why this exists: the language client pipes EVERY stderr line through
 * `outputChannel.error()` (vscode-languageclient `pipeStderrToLogOutputChannel`), so a
 * `DBG`/`INF` line is stamped `[error]` in the host's log view and the whole output reads as
 * a wall of failures. `window/logMessage` carries the severity as a field, so the host
 * renders each line at its true level. The stderr sink stays attached — it is the only
 * transport before the connection exists, and the only one when running headless.
 *
 * `getConsole` is a getter rather than the console itself because logging is configured at
 * process start, before `createConnection()` has produced one; records logged before then
 * fall through to stderr alone.
 */
export function createLspConsoleSink(
  getConsole: () => LspConsoleLike | undefined,
  minLevelFor: (category: readonly string[]) => LogLevel = () => 'trace',
): Sink {
  const format = plainTextFormatter('none', /* includeLevel */ false)
  return record => {
    const target = getConsole()
    if (!target) return
    if (!levelAtLeast(record.level, minLevelFor(record.category))) return
    const line = format(record).replace(/\n$/, '')
    switch (record.level) {
      case 'trace':
      case 'debug':
        target.debug(line)
        break
      case 'info':
        target.info(line)
        break
      case 'warning':
        target.warn(line)
        break
      default:
        target.error(line)
        break
    }
  }
}

/**
 * Map any accepted level name to a LogTape {@link LogLevel}: LogTape's own
 * (`trace|debug|info|warning|error|fatal`) or a legacy winston-ish alias
 * (`warn`→`warning`, `verbose`→`debug`). Returns `undefined` for empty/unknown input so
 * callers can fall back to a default. Used to resolve `SC2MOD_LOG_LEVEL` and the
 * `modkit.trace.service` setting (whose enum may still carry legacy names).
 */
export function resolveLogLevel(name: string | undefined | null): LogLevel | undefined {
  switch (name) {
    case 'trace':
      return 'trace'
    case 'debug':
      return 'debug'
    case 'info':
      return 'info'
    case 'warn':
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'fatal':
      return 'fatal'
    // legacy winston alias — kept so pre-existing `modkit.trace.service: "verbose"` still parses.
    case 'verbose':
      return 'debug'
    default:
      return undefined
  }
}

/**
 * A1: per-category level overrides, keyed by DOTTED path relative to the `modkit` root
 * (e.g. `'vfs.resolve'` for the `modkit·vfs·resolve` category). Values are any level name
 * {@link resolveLogLevel} accepts; unresolvable values are ignored. Powers
 * `modkit.log.categories`.
 */
export type CategoryLevelOverrides = Record<string, string>

/**
 * App-entry helper: configure the root sink(s) at the resolved level, plus optional
 * per-category overrides. Idempotent (safe to call again on a settings change — A1's live
 * reconfiguration). Precedence: explicit `level` (any accepted name) → `verbose` shortcut
 * (→ `debug`) → `warning`. The LSP server passes the child-process `SC2MOD_LOG_LEVEL`; the
 * CLI `--verbose` flag maps to debug.
 */
/**
 * The options the most recent {@link configureLogging} call ran with, so a sink discovered
 * later in startup (the LSP connection) can be added without the caller re-deriving level,
 * category overrides and the file sink from scratch. See {@link attachExtraSink}.
 */
let lastLoggingOptions: Parameters<typeof configureLogging>[0] = {}

/**
 * Add one more sink to the already-configured logger, preserving everything the last
 * {@link configureLogging} call set up. Exists because the LSP connection — the transport
 * that carries a correct severity to the editor — only comes into being after logging has
 * been configured (see {@link createLspConsoleSink}).
 */
export async function attachExtraSink(name: string, sink: Sink): Promise<void> {
  const previous = lastLoggingOptions ?? {}
  await configureLogging({
    ...previous,
    extraSinks: { ...previous.extraSinks, [name]: sink },
    extraRootSinks: [...new Set([...(previous.extraRootSinks ?? []), name])],
  })
}

export async function configureLogging(
  opts: {
    verbose?: boolean
    level?: string | null | undefined
    /** Per-category level overrides (A1), e.g. `{ 'vfs.resolve': 'debug' }`. */
    categories?: CategoryLevelOverrides
    /** Extra named sinks merged with the built-in `console` sink (A4's channel sink, A5's
     * file sink attach here rather than replacing it). */
    extraSinks?: Record<string, Sink>
    /** Extra sink names attached to the root logger (and to category overrides) alongside
     * `console` — the sink names from {@link extraSinks}. */
    extraRootSinks?: string[]
  } = {},
): Promise<void> {
  lastLoggingOptions = opts
  const lowestLevel: LogLevel = resolveLogLevel(opts.level) ?? (opts.verbose ? 'debug' : 'warning')
  const rootSinks = ['console', ...(opts.extraRootSinks ?? [])]
  // A5: when an extra sink (the file sink) is attached, the root GATE must open to `debug`
  // so that sink sees everything — `console` self-filters (category-aware, below) instead of
  // relying on this shared gate.
  const gateLevel: LogLevel = (opts.extraRootSinks?.length ?? 0) > 0 ? 'debug' : lowestLevel
  const overrides = Object.entries(opts.categories ?? {}).flatMap(([dotted, levelName]) => {
    const level = resolveLogLevel(levelName)
    return level ? [{ path: [ROOT, ...dotted.split('.')], level }] : []
  })
  const categoryLoggers = overrides.map(o => ({
    category: o.path,
    lowestLevel: o.level,
    sinks: rootSinks,
  }))
  const consoleMinLevelFor = makeLevelResolver(lowestLevel, overrides)
  await configure({
    reset: true,
    sinks: { console: stderrSink(consoleMinLevelFor), ...opts.extraSinks },
    loggers: [
      { category: [ROOT], lowestLevel: gateLevel, sinks: rootSinks },
      ...categoryLoggers,
      // silence LogTape's own meta logger noise
      { category: ['logtape', 'meta'], lowestLevel: 'error', sinks: ['console'] },
    ],
  })
}

export function isPromise(val: unknown): val is Promise<unknown> {
  return (
    !!val &&
    typeof val === 'object' &&
    typeof (val as { then?: unknown }).then === 'function' &&
    typeof (val as { catch?: unknown }).catch === 'function'
  )
}

// ── winston-compatibility shim ────────────────────────────────────────────────
// The codebase's existing call sites use a winston-style API: a shared `logger`
// singleton with `.info/.debug/.verbose/.warn/.error/.log(level, …)` accepting a
// message plus variadic "splat" args. This adapter forwards those to a LogTape
// logger (splat args packed into a `data` property), so no call site has to change.
// New/idiomatic code should prefer `getLogger([...])` (raw LogTape, template-capable).

type WinstonLevel = 'error' | 'warn' | 'warning' | 'info' | 'verbose' | 'debug'
type LogTapeMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

function toMethod(level: string): LogTapeMethod {
  switch (level) {
    case 'fatal':
      return 'fatal'
    case 'error':
      return 'error'
    case 'warn':
    case 'warning':
      return 'warn'
    case 'info':
      return 'info'
    case 'debug':
      return 'debug'
    // 'verbose' is a legacy winston alias → trace (the lowest, noisiest tier)
    case 'trace':
    case 'verbose':
      return 'trace'
    default:
      return 'info'
  }
}

export interface CompatLogger {
  error(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
  info(message: string, ...rest: unknown[]): void
  verbose(message: string, ...rest: unknown[]): void
  debug(message: string, ...rest: unknown[]): void
  log(level: WinstonLevel, message: string, ...rest: unknown[]): void
}

function makeCompat(lt: Logger): CompatLogger {
  const emit = (level: string, message: string, rest: unknown[]) => {
    const props = rest.length ? { data: rest.length === 1 ? rest[0] : rest } : undefined
    ;(lt as unknown as Record<LogTapeMethod, (m: string, p?: unknown) => void>)[toMethod(level)](
      message,
      props,
    )
  }
  return {
    error: (m, ...r) => emit('error', m, r),
    warn: (m, ...r) => emit('warn', m, r),
    info: (m, ...r) => emit('info', m, r),
    verbose: (m, ...r) => emit('verbose', m, r),
    debug: (m, ...r) => emit('debug', m, r),
    log: (lvl, m, ...r) => emit(lvl, m, r),
  }
}

/** Winston-compatible category logger for legacy call sites. */
export function getCompatLogger(category: string[] = []): CompatLogger {
  return makeCompat(getLogger(category))
}

/** Shared winston-compatible singleton (root category). */
export const logger: CompatLogger = getCompatLogger()

export interface LogItOptions {
  /** LogTape level the entry/exit records are emitted at. Defaults to `'debug'`. */
  level?: LogLevel
  message?: string
  /**
   * When `false`, suppress the `ms` duration measurement on the exit (`←`) record (the record
   * itself — with any `resDump` — is still emitted). Defaults to `true`, so timed methods like
   * `reindex` report their duration without extra opt-in.
   */
  profiling?: boolean
  argsDump?: ((...args: any[]) => any) | boolean
  resDump?: ((res: any) => any) | boolean
  scopeDump?: (scope: any) => any
}

const traceLogger = getLogger(['trace'])

/**
 * Method decorator: logs entry + duration through LogTape. Unlike the old winston version,
 * the level is evaluated lazily per-call (LogTape no-ops when below the configured level),
 * so it works regardless of configure() timing.
 */
export function logIt(opts: LogItOptions = {}) {
  const method: LogTapeMethod = toMethod(opts.level ?? 'debug')
  const profiling = opts.profiling !== false
  return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const fn = descriptor.value as (...a: any[]) => any
    const proxy = function (this: any, ...args: any[]) {
      const label = `${this?.constructor?.name ?? '?'}:${propertyKey}`
      const started = profiling ? process.hrtime.bigint() : undefined
      const entryProps: Record<string, unknown> = opts.message ? { note: opts.message } : {}
      if (opts.argsDump === true) entryProps['args'] = args
      else if (typeof opts.argsDump === 'function') entryProps['args'] = opts.argsDump(...args)
      if (opts.scopeDump) entryProps['scope'] = opts.scopeDump(this)
      traceLogger[method](`→ ${label}`, entryProps)

      const done = (res: unknown) => {
        const doneProps: Record<string, unknown> = {}
        if (started !== undefined)
          doneProps['ms'] = Math.round(Number(process.hrtime.bigint() - started) / 1e6)
        if (opts.resDump === true) doneProps['result'] = res
        else if (typeof opts.resDump === 'function') doneProps['result'] = opts.resDump(res)
        traceLogger[method](`← ${label}`, doneProps)
      }

      let result = fn.apply(this, args)
      if (isPromise(result)) {
        result = result
          .then(r => {
            done(r)
            return r
          })
          .catch(e => {
            done(e)
            throw e
          })
        return result
      }
      done(result)
      return result
    }
    descriptor.value = proxy
  }
}
