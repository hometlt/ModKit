import { describe, expect, it, vi } from 'vitest'
import { createScopedViewerSubjectNavigation } from '@modkit/host'
import {
  nestedSubject,
  rootSubject,
  serializeSubjectRef,
  type SubjectRef,
} from '@modkit/sdk/subjects'

const sessionSubject = (workspace: string, key: string): string =>
  serializeSubjectRef(
    nestedSubject(
      rootSubject({ id: 'memory://fixture/catalog.xml' }, workspace),
      'fixture/unit',
      key,
    ),
  )

describe('scoped viewer subject navigation', () => {
  it('opens only canonical targets from its exact session and workspace scope', async () => {
    const current = sessionSubject('workspace-a', 'Marine')
    const target = sessionSubject('workspace-a', 'Marauder')
    const open = vi.fn(async (subject: SubjectRef, signal: AbortSignal) => {
      void subject
      void signal
    })
    const managed = createScopedViewerSubjectNavigation({
      scope: { sessionId: 'session-a', subject: current, workspace: 'workspace-a' },
      open,
    })

    await expect(managed.port.open({ scope: managed.port.scope, target })).resolves.toEqual({
      state: 'opened',
    })
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0]?.[0].identity).toEqual({ kind: 'fixture/unit', key: 'Marauder' })

    await expect(
      managed.port.open({
        scope: { ...managed.port.scope, sessionId: 'session-b' },
        target,
      }),
    ).resolves.toEqual({ state: 'rejected', reason: 'scope-mismatch' })
    await expect(
      managed.port.open({
        scope: managed.port.scope,
        target: sessionSubject('workspace-b', 'Marauder'),
      }),
    ).resolves.toEqual({ state: 'rejected', reason: 'workspace-mismatch' })
    await expect(
      managed.port.open({ scope: managed.port.scope, target: 'x3-subject:%' }),
    ).resolves.toEqual({ state: 'rejected', reason: 'invalid-subject' })
    expect(open).toHaveBeenCalledOnce()
  })

  it('aborts an in-flight open on teardown and rejects later use', async () => {
    const current = sessionSubject('workspace-a', 'Marine')
    const target = sessionSubject('workspace-a', 'Marauder')
    let finish: (() => void) | undefined
    let observedSignal: AbortSignal | undefined
    const managed = createScopedViewerSubjectNavigation({
      scope: { sessionId: 'session-a', subject: current, workspace: 'workspace-a' },
      async open(_subject, signal) {
        observedSignal = signal
        await new Promise<void>(resolve => {
          finish = resolve
        })
      },
    })
    const pending = managed.port.open({ scope: managed.port.scope, target })
    await vi.waitFor(() => expect(observedSignal).toBeDefined())
    managed.dispose('fixture-teardown')
    finish?.()

    await expect(pending).resolves.toEqual({ state: 'rejected', reason: 'cancelled' })
    expect(observedSignal?.aborted).toBe(true)
    expect(observedSignal?.reason).toBe('fixture-teardown')
    await expect(managed.port.open({ scope: managed.port.scope, target })).resolves.toEqual({
      state: 'rejected',
      reason: 'disposed',
    })
  })

  it('rejects a non-canonical or internally inconsistent scope before minting a port', () => {
    expect(() =>
      createScopedViewerSubjectNavigation({
        scope: { sessionId: 'session-a', subject: 'x3-subject:%' },
        open: async () => undefined,
      }),
    ).toThrow(/scope is not canonical/u)
    expect(() =>
      createScopedViewerSubjectNavigation({
        scope: {
          sessionId: 'session-a',
          subject: sessionSubject('workspace-a', 'Marine'),
          workspace: 'workspace-b',
        },
        open: async () => undefined,
      }),
    ).toThrow(/workspace does not match/u)
  })
})
