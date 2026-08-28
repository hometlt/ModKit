export const WEB_WORKER_CRASHED = 'x3.host/worker-crashed'

export type WebSessionRecoveryState = 'healthy' | 'worker-unavailable'

export interface WebSessionDiagnostic {
  readonly code: string
  readonly message: string
}

export interface WebSessionRecoveryOptions {
  readonly hasUnsaved: () => boolean
  readonly confirmDiscard: () => boolean
  readonly restart: () => Promise<void>
  readonly onState: (state: WebSessionRecoveryState, reason?: string) => void
}

export interface WebSessionRecovery {
  readonly state: () => WebSessionRecoveryState
  report(diagnostic: WebSessionDiagnostic): void
  restart(): Promise<boolean>
}

/**
 * Manual recovery policy for the browser worker.
 *
 * A crashed worker may have held subject state that the page cannot reconstruct.  The controller
 * therefore never starts a replacement by itself: it exposes a restart action and lets the shell
 * reload the whole composition only after the user asks for it (and confirms any unsaved work).
 */
export function createWebSessionRecovery(options: WebSessionRecoveryOptions): WebSessionRecovery {
  let current: WebSessionRecoveryState = 'healthy'
  let restarting = false

  return Object.freeze({
    state: () => current,
    report(diagnostic: WebSessionDiagnostic) {
      if (diagnostic.code !== WEB_WORKER_CRASHED) return
      current = 'worker-unavailable'
      options.onState(current, diagnostic.message)
    },
    async restart() {
      if (current !== 'worker-unavailable' || restarting) return false
      if (options.hasUnsaved() && !options.confirmDiscard()) return false
      restarting = true
      try {
        await options.restart()
        return true
      } catch (error) {
        restarting = false
        throw error
      }
    },
  })
}
