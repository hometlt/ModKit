/**
 * Building a mod context the first time can take seconds — a campaign's chain read from CASC — and
 * MK2 said so in the status bar (plan 0.8). A context that takes longer than `delayMs` reports that
 * it is being built and, once ready, how many layers it has; one already built answers at once and
 * reports nothing. Every other member of the sources is the original's.
 */
import type { ContentSources, ModContext, ModContextRequest } from '@modkit/vfs/content-sources'

export function announceModContexts(
  sources: ContentSources,
  options: {
    readonly delayMs: number
    /** A context is still building after the delay; `opening` settles when it is done. */
    building(opening: Promise<unknown>): void
    /** A slow context is ready. */
    ready(layers: number): void
  },
): ContentSources {
  const open = sources.openModContext?.bind(sources)
  if (open === undefined) return sources
  const openModContext = async (request: ModContextRequest): Promise<ModContext> => {
    const opening = open(request)
    let slow = false
    const timer = setTimeout(() => {
      slow = true
      options.building(opening.catch(() => undefined))
    }, options.delayMs)
    try {
      const context = await opening
      if (slow) options.ready(context.layers.length)
      return context
    } finally {
      clearTimeout(timer)
    }
  }
  return new Proxy(sources, {
    get: (target, property) => {
      if (property === 'openModContext') return openModContext
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
