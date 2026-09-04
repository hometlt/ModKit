import { Emitter, type Disposable, type Event } from './legacy/support/events.js'
import { getLogger } from './legacy/core/logger.js'

export { Emitter, type Disposable, type Event }

export interface LegacyVirtualFileSystem {
  list(path: string): Promise<string[]>
  get(path: string): Promise<Uint8Array>
  getText(path: string): Promise<string>
  exists(path: string): Promise<boolean>
}

export type VirtualFileSystem = LegacyVirtualFileSystem

export function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function' &&
    typeof (value as { catch?: unknown }).catch === 'function'
  )
}

interface CompatLogger {
  debug(message: string, ...values: unknown[]): void
  error(message: string, ...values: unknown[]): void
  info(message: string, ...values: unknown[]): void
  warn(message: string, ...values: unknown[]): void
  verbose(message: string, ...values: unknown[]): void
}

const rootLogger = getLogger(['legacy', 'sc2-support'])

function emit(
  method: 'debug' | 'error' | 'info' | 'trace' | 'warn',
  message: string,
  values: readonly unknown[],
): void {
  const properties = values.length === 0 ? {} : { values }
  if (method === 'debug') rootLogger.debug(message, properties)
  else if (method === 'error') rootLogger.error(message, properties)
  else if (method === 'info') rootLogger.info(message, properties)
  else if (method === 'trace') rootLogger.trace(message, properties)
  else rootLogger.warn(message, properties)
}

export const logger: CompatLogger = {
  debug: (message, ...values) => emit('debug', String(message), values),
  error: (message, ...values) => emit('error', String(message), values),
  info: (message, ...values) => emit('info', String(message), values),
  warn: (message, ...values) => emit('warn', String(message), values),
  verbose: (message, ...values) => emit('trace', message, values),
}

export interface LogItOptions {
  readonly message?: string
  readonly profiling?: boolean
  readonly argsDump?: ((...args: unknown[]) => unknown) | boolean
  readonly resDump?: ((result: unknown) => unknown) | boolean
  readonly scopeDump?: (scope: unknown) => unknown
}

export function logIt(options: LogItOptions = {}) {
  return function (_target: unknown, propertyKey: string, descriptor: PropertyDescriptor): void {
    const fn = descriptor.value as (...args: unknown[]) => unknown
    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const started = options.profiling === false ? undefined : performance.now()
      logger.debug(options.message ?? `→ ${propertyKey}`, ...(options.argsDump ? [args] : []))
      const done = (result: unknown) => {
        const elapsed = started === undefined ? '' : ` (${Math.round(performance.now() - started)}ms)`
        logger.debug(`← ${propertyKey}${elapsed}`, ...(options.resDump ? [result] : []))
        return result
      }
      const result = fn.apply(this, args)
      return isPromise(result) ? result.then(done) : done(result)
    }
  }
}
