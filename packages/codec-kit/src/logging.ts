import type { Logger } from '@logtape/logtape'

type LoggerFactory = (category: string[]) => Logger

let loggerFactory: LoggerFactory | undefined

/** Install the host logging backend. Called by the Node-oriented logging configuration module. */
export function installLoggerFactory(factory: LoggerFactory): void {
  loggerFactory = factory
}

/**
 * Browser-safe category logger that resolves its backend at call time.
 *
 * Workers without a configured logging backend receive a no-op logger and import no logging
 * runtime state from the host.
 */
export function getLogger(category: string[] = []): Logger {
  const invoke = (property: PropertyKey, args: unknown[]): unknown => {
    const target = loggerFactory?.(category)
    if (target === undefined) return undefined
    const member = Reflect.get(target as object, property)
    return typeof member === 'function' ? Reflect.apply(member, target, args) : member
  }
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'isEnabledFor' && loggerFactory === undefined) return () => false
        return (...args: unknown[]) => invoke(property, args)
      },
    },
  ) as Logger
}
