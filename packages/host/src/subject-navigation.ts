import type {
  ViewerSubjectNavigation,
  ViewerSubjectNavigationRequest,
  ViewerSubjectNavigationResult,
  ViewerSubjectNavigationScope,
} from '@modkit/sdk'
import { parseSubjectRef, serializeSubjectRef, type SubjectRef } from '@modkit/sdk/subjects'

export interface ScopedViewerSubjectNavigationOptions {
  readonly scope: ViewerSubjectNavigationScope
  readonly signal?: AbortSignal
  open(subject: SubjectRef, signal: AbortSignal): Promise<void>
}

export interface ManagedViewerSubjectNavigation {
  readonly port: ViewerSubjectNavigation
  dispose(reason?: string): void
}

const OPENED: ViewerSubjectNavigationResult = Object.freeze({ state: 'opened' })

function rejected(
  reason: Extract<ViewerSubjectNavigationResult, { readonly state: 'rejected' }>['reason'],
): ViewerSubjectNavigationResult {
  return Object.freeze({ state: 'rejected', reason })
}

function canonicalSubject(value: string): SubjectRef | undefined {
  if (value.length === 0) return undefined
  try {
    const subject = parseSubjectRef(value)
    return serializeSubjectRef(subject) === value ? subject : undefined
  } catch {
    return undefined
  }
}

function sameScope(
  expected: ViewerSubjectNavigationScope,
  actual: ViewerSubjectNavigationRequest['scope'],
): boolean {
  return (
    expected.sessionId === actual.sessionId &&
    expected.subject === actual.subject &&
    expected.workspace === actual.workspace
  )
}

function linkedSignal(signals: readonly (AbortSignal | undefined)[]): {
  readonly signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  const listeners = new Map<AbortSignal, () => void>()
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    const listener = () => controller.abort(signal.reason)
    listeners.set(signal, listener)
    signal.addEventListener('abort', listener, { once: true })
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener)
      listeners.clear()
    },
  }
}

/**
 * Mint a navigation capability for one live subject session.
 *
 * The caller owns target resolution. This adapter only admits canonical SubjectRefs from the
 * port's exact session/workspace scope and carries cancellation across the host boundary.
 */
export function createScopedViewerSubjectNavigation(
  options: ScopedViewerSubjectNavigationOptions,
): ManagedViewerSubjectNavigation {
  if (options.scope.sessionId.length === 0) {
    throw new TypeError('subject navigation sessionId must be non-empty')
  }
  const current = canonicalSubject(options.scope.subject)
  if (current === undefined) throw new TypeError('subject navigation scope is not canonical')
  if (current.workspace !== options.scope.workspace) {
    throw new TypeError('subject navigation scope workspace does not match its subject')
  }
  const scope: ViewerSubjectNavigationScope = Object.freeze({
    sessionId: options.scope.sessionId,
    subject: options.scope.subject,
    ...(options.scope.workspace === undefined ? {} : { workspace: options.scope.workspace }),
  })
  const lifecycle = new AbortController()
  let disposed = false
  const port: ViewerSubjectNavigation = Object.freeze({
    scope,
    async open(
      request: ViewerSubjectNavigationRequest,
      signal?: AbortSignal,
    ): Promise<ViewerSubjectNavigationResult> {
      if (disposed || lifecycle.signal.aborted) return rejected('disposed')
      if (!sameScope(scope, request.scope)) return rejected('scope-mismatch')
      const target = canonicalSubject(request.target)
      if (target === undefined) return rejected('invalid-subject')
      if (target.workspace !== current.workspace) return rejected('workspace-mismatch')
      const linked = linkedSignal([lifecycle.signal, options.signal, signal])
      try {
        if (linked.signal.aborted) return rejected('cancelled')
        await options.open(target, linked.signal)
        return linked.signal.aborted ? rejected('cancelled') : OPENED
      } catch (error) {
        if (linked.signal.aborted) return rejected('cancelled')
        throw error
      } finally {
        linked.dispose()
      }
    },
  })
  return Object.freeze({
    port,
    dispose(reason = 'subject-navigation-disposed') {
      if (disposed) return
      disposed = true
      lifecycle.abort(reason)
    },
  })
}
