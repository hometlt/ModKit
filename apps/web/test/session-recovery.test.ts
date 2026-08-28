import { describe, expect, it, vi } from 'vitest'

import { createWebSessionRecovery } from '../src/session-recovery.js'

function harness(unsaved = false, confirmed = true) {
  const states: { state: string; reason?: string }[] = []
  const restart = vi.fn(async () => undefined)
  const confirmDiscard = vi.fn(() => confirmed)
  const recovery = createWebSessionRecovery({
    hasUnsaved: () => unsaved,
    confirmDiscard,
    restart,
    onState: (state, reason) => states.push({ state, ...(reason === undefined ? {} : { reason }) }),
  })
  return { recovery, states, restart, confirmDiscard }
}

describe('web session recovery', () => {
  it('ignores normal worker release and unrelated diagnostics', async () => {
    const { recovery, states, restart } = harness()
    recovery.report({ code: 'x3.host/worker-terminated', message: 'released normally' })
    recovery.report({ code: 'x3.host/shared-origin-unavailable', message: 'no isolation' })

    expect(recovery.state()).toBe('healthy')
    expect(states).toEqual([])
    expect(await recovery.restart()).toBe(false)
    expect(restart).not.toHaveBeenCalled()
  })

  it('offers recovery after a crash but never starts it automatically', async () => {
    const { recovery, states, restart } = harness()
    recovery.report({ code: 'x3.host/worker-crashed', message: 'worker stopped' })

    expect(recovery.state()).toBe('worker-unavailable')
    expect(states).toEqual([{ state: 'worker-unavailable', reason: 'worker stopped' }])
    expect(restart).not.toHaveBeenCalled()
    expect(await recovery.restart()).toBe(true)
    expect(restart).toHaveBeenCalledOnce()
  })

  it('requires confirmation before discarding unsaved work', async () => {
    const { recovery, restart, confirmDiscard } = harness(true, false)
    recovery.report({ code: 'x3.host/worker-crashed', message: 'worker stopped' })

    expect(await recovery.restart()).toBe(false)
    expect(confirmDiscard).toHaveBeenCalledOnce()
    expect(restart).not.toHaveBeenCalled()
  })

  it('accepts only one restart while a restart is in progress', async () => {
    let finish: (() => void) | undefined
    const restart = vi.fn(() => new Promise<void>(resolve => (finish = resolve)))
    const recovery = createWebSessionRecovery({
      hasUnsaved: () => false,
      confirmDiscard: () => true,
      restart,
      onState: () => undefined,
    })
    recovery.report({ code: 'x3.host/worker-crashed', message: 'worker stopped' })

    const first = recovery.restart()
    expect(await recovery.restart()).toBe(false)
    finish?.()
    expect(await first).toBe(true)
    expect(restart).toHaveBeenCalledOnce()
  })
})
