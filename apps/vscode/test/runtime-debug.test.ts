import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeSessionV2, RuntimeSnapshot } from '@modkitx-x3/sdk/runtime'
import {
  createRuntimeDebugController,
  type RuntimeDebugControllerOptions,
} from '../src/runtime-debug.js'

const sessionBudget = { maxWallTimeMs: 1_000, maxTicks: 1_000, maxMemoryBytes: 1_000_000 }
const activationBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const inertServices = {} as RuntimeDebugControllerOptions['services']

function digest(tick: number): string {
  return `sha256:${createHash('sha256').update(String(tick)).digest('hex')}`
}

function fakeSession(sessionId: string, statusFailure = false): RuntimeSessionV2 {
  let tick = 0
  let sequence = 0
  let events: { sequence: number; tick: number; kind: string }[] = []
  const status = () => {
    if (statusFailure) throw new Error('status fixture failed')
    return {
      state: 'ready' as const,
      executions: 0,
      ticks: tick,
      memoryBytes: 0,
    }
  }
  return {
    contract: 'common.runtime/session',
    sessionId,
    providerId: 'org.example/runtime-v2',
    budget: sessionBudget,
    offers: ['step', 'events', 'snapshot', 'restore', 'state-hash'],
    async execute() {
      return {
        state: 'completed',
        usage: { wallTimeMs: 0, ticks: 0, memoryBytes: 0 },
        diagnostics: [],
      }
    },
    async status() {
      return status()
    },
    async identity() {
      return {
        contentDigest: digest(tick),
        schemaId: 'org.example/runtime-state',
        schemaVersion: 1,
      }
    },
    async step(ticks, signal) {
      if (signal?.aborted === true)
        return { outcome: 'refused', reason: 'cancelled', diagnostics: [] }
      for (let offset = 0; offset < ticks; offset += 1) {
        tick += 1
        sequence += 1
        events.push({
          sequence,
          tick,
          kind: tick === 4 ? 'org.example/reached-four' : 'org.example/tick',
        })
      }
      return { outcome: 'stepped', status: status(), diagnostics: [] }
    },
    async *events(afterSequence = 0) {
      for (const event of events) if (event.sequence > afterSequence) yield event
    },
    async snapshot() {
      const bytes = new TextEncoder().encode(JSON.stringify({ tick, sequence, events }))
      return {
        outcome: 'captured',
        snapshot: {
          identity: {
            contentDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
            schemaId: 'org.example/runtime-state',
            schemaVersion: 1,
          },
          bytes,
        },
      }
    },
    async restore(snapshot: RuntimeSnapshot) {
      const restored = JSON.parse(new TextDecoder().decode(snapshot.bytes)) as {
        tick: number
        sequence: number
        events: { sequence: number; tick: number; kind: string }[]
      }
      tick = restored.tick
      sequence = restored.sequence
      events = restored.events
      return { outcome: 'restored', status: status() }
    },
    async stateHash() {
      return { outcome: 'hashed', stateHash: digest(tick) }
    },
  }
}

function controllerWith(openSession: NonNullable<RuntimeDebugControllerOptions['openSession']>) {
  return createRuntimeDebugController({
    services: inertServices,
    grant: { id: 'runtime-debug-test', classes: [] },
    activationBudget,
    sessionBudget,
    openSession,
  })
}

describe('generic VS Code runtime controller', () => {
  it('drives frozen-v2 state through host-selected runtime identity and bounded breakpoints', async () => {
    let releases = 0
    const controller = controllerWith(async request => ({
      state: 'resolved',
      providerId: 'org.example/runtime-v2',
      session: fakeSession(request.sessionId),
      diagnostics: [],
      async release() {
        releases += 1
      },
    }))

    expect(
      await controller.dispatch({
        action: 'start',
        runtimeId: 'org.example/runtime-id',
        sessionId: 'debug-one',
      }),
    ).toMatchObject({
      state: 'ok',
      action: 'start',
      value: { runtimeId: 'org.example/runtime-id', providerId: 'org.example/runtime-v2' },
    })
    expect(controller.sessionIds).toEqual(['debug-one'])

    await expect(
      controller.dispatch({ action: 'step', sessionId: 'debug-one', ticks: 2 }),
    ).resolves.toMatchObject({ state: 'ok', value: { outcome: 'stepped', status: { ticks: 2 } } })
    await expect(
      controller.dispatch({ action: 'snapshot', sessionId: 'debug-one', snapshotId: 'at-two' }),
    ).resolves.toMatchObject({ state: 'ok', value: { outcome: 'captured', snapshotId: 'at-two' } })
    expect(controller.snapshotIds('debug-one')).toEqual(['at-two'])

    await controller.dispatch({ action: 'step', sessionId: 'debug-one', ticks: 1 })
    const changed = await controller.dispatch({ action: 'stateHash', sessionId: 'debug-one' })
    expect(changed).toMatchObject({ state: 'ok', value: { outcome: 'hashed' } })
    await expect(
      controller.dispatch({ action: 'restore', sessionId: 'debug-one', snapshotId: 'at-two' }),
    ).resolves.toMatchObject({ state: 'ok', value: { outcome: 'restored', status: { ticks: 2 } } })

    await expect(
      controller.dispatch({
        action: 'continue',
        sessionId: 'debug-one',
        maxTicks: 10,
        breakpoints: [{ eventKind: 'org.example/reached-four' }],
      }),
    ).resolves.toMatchObject({
      state: 'ok',
      value: { outcome: 'breakpoint', advanced: 2, paused: true, status: { ticks: 4 } },
    })
    await expect(
      controller.dispatch({ action: 'inspect', sessionId: 'debug-one', afterSequence: 0 }),
    ).resolves.toMatchObject({
      state: 'ok',
      value: {
        runtimeId: 'org.example/runtime-id',
        paused: true,
        status: { ticks: 4 },
        stateHash: { outcome: 'hashed' },
      },
    })
    await expect(
      controller.dispatch({ action: 'pause', sessionId: 'debug-one' }),
    ).resolves.toMatchObject({
      state: 'ok',
      value: { ticks: 4 },
    })
    await expect(
      controller.dispatch({ action: 'destroy', sessionId: 'debug-one' } as never),
    ).resolves.toMatchObject({
      state: 'unavailable',
      code: 'x3.vscode/runtime-action-invalid',
    })
    expect(controller.sessionIds).toEqual(['debug-one'])
    await expect(
      controller.dispatch({ action: 'stop', sessionId: 'debug-one' }),
    ).resolves.toMatchObject({
      state: 'ok',
      value: { outcome: 'stopped' },
    })
    expect(releases).toBe(1)
    expect(controller.sessionIds).toEqual([])
  })

  it('releases a selected lease when initial status fails and never exposes a zombie session', async () => {
    let releases = 0
    const controller = controllerWith(async request => ({
      state: 'resolved',
      providerId: 'org.example/runtime-v2',
      session: fakeSession(request.sessionId, true),
      diagnostics: [],
      async release() {
        releases += 1
      },
    }))
    await expect(
      controller.dispatch({
        action: 'start',
        runtimeId: 'org.example/runtime-id',
        sessionId: 'bad',
      }),
    ).resolves.toMatchObject({
      state: 'unavailable',
      code: 'x3.vscode/runtime-operation-failed',
      message: 'status fixture failed',
    })
    expect(releases).toBe(1)
    expect(controller.sessionIds).toEqual([])
  })

  it('reserves a session id while provider resolution is in flight', async () => {
    let finishOpen: (() => void) | undefined
    const openGate = new Promise<void>(resolve => {
      finishOpen = resolve
    })
    let opens = 0
    const controller = controllerWith(async request => {
      opens += 1
      await openGate
      return {
        state: 'resolved',
        providerId: 'org.example/runtime-v2',
        session: fakeSession(request.sessionId),
        diagnostics: [],
        release: async () => undefined,
      }
    })
    const first = controller.dispatch({
      action: 'start',
      runtimeId: 'org.example/runtime-id',
      sessionId: 'opening',
    })
    await Promise.resolve()
    await expect(
      controller.dispatch({
        action: 'start',
        runtimeId: 'org.example/runtime-id',
        sessionId: 'opening',
      }),
    ).resolves.toMatchObject({
      state: 'unavailable',
      code: 'x3.vscode/runtime-session-exists',
    })
    expect(opens).toBe(1)
    finishOpen?.()
    await expect(first).resolves.toMatchObject({ state: 'ok', action: 'start' })
    expect(controller.sessionIds).toEqual(['opening'])
    await controller.dispose()
  })

  it('releases an opening lease instead of publishing it when dispose wins the race', async () => {
    let finishOpen: (() => void) | undefined
    const openGate = new Promise<void>(resolve => {
      finishOpen = resolve
    })
    let releases = 0
    const controller = controllerWith(async request => {
      await openGate
      return {
        state: 'resolved',
        providerId: 'org.example/runtime-v2',
        session: fakeSession(request.sessionId),
        diagnostics: [],
        async release() {
          releases += 1
        },
      }
    })
    const starting = controller.dispatch({
      action: 'start',
      runtimeId: 'org.example/runtime-id',
      sessionId: 'dispose-opening',
    })
    await Promise.resolve()
    const disposing = controller.dispose()
    finishOpen?.()
    await expect(starting).resolves.toMatchObject({
      state: 'unavailable',
      code: 'x3.vscode/runtime-controller-disposed',
    })
    await disposing
    expect(releases).toBe(1)
    expect(controller.sessionIds).toEqual([])
    await expect(
      controller.dispatch({
        action: 'start',
        runtimeId: 'org.example/runtime-id',
        sessionId: 'after-dispose',
      }),
    ).resolves.toMatchObject({
      state: 'unavailable',
      code: 'x3.vscode/runtime-controller-disposed',
    })
  })

  it('pauses a bounded continue loop without adding a provider-specific control method', async () => {
    const controller = controllerWith(async request => ({
      state: 'resolved',
      providerId: 'org.example/runtime-v2',
      session: fakeSession(request.sessionId),
      diagnostics: [],
      release: async () => undefined,
    }))
    await controller.dispatch({
      action: 'start',
      runtimeId: 'org.example/runtime-id',
      sessionId: 'pausable',
    })
    const continuing = controller.dispatch({
      action: 'continue',
      sessionId: 'pausable',
      maxTicks: 10_000,
    })
    await Promise.resolve()
    await expect(
      controller.dispatch({ action: 'pause', sessionId: 'pausable' }),
    ).resolves.toMatchObject({
      state: 'ok',
    })
    await expect(continuing).resolves.toMatchObject({
      state: 'ok',
      value: { outcome: 'paused', paused: true },
    })
    await controller.dispose()
  })

  it('keeps a session tracked when stop release fails so the user can retry', async () => {
    let releases = 0
    const controller = controllerWith(async request => ({
      state: 'resolved',
      providerId: 'org.example/runtime-v2',
      session: fakeSession(request.sessionId),
      diagnostics: [],
      async release() {
        releases += 1
        if (releases === 1) throw new Error('release fixture failed')
      },
    }))
    await controller.dispatch({
      action: 'start',
      runtimeId: 'org.example/runtime-id',
      sessionId: 'retry',
    })
    await expect(
      controller.dispatch({ action: 'stop', sessionId: 'retry' }),
    ).resolves.toMatchObject({
      state: 'unavailable',
      code: 'x3.vscode/runtime-operation-failed',
      message: 'release fixture failed',
    })
    expect(controller.sessionIds).toEqual(['retry'])
    await expect(
      controller.dispatch({ action: 'stop', sessionId: 'retry' }),
    ).resolves.toMatchObject({
      state: 'ok',
    })
    expect(controller.sessionIds).toEqual([])
  })

  it('calls release once when two stop requests overlap', async () => {
    let finishRelease: (() => void) | undefined
    const releaseGate = new Promise<void>(resolve => {
      finishRelease = resolve
    })
    let releases = 0
    const controller = controllerWith(async request => ({
      state: 'resolved',
      providerId: 'org.example/runtime-v2',
      session: fakeSession(request.sessionId),
      diagnostics: [],
      async release() {
        releases += 1
        await releaseGate
      },
    }))
    await controller.dispatch({
      action: 'start',
      runtimeId: 'org.example/runtime-id',
      sessionId: 'closing',
    })
    const first = controller.dispatch({ action: 'stop', sessionId: 'closing' })
    await Promise.resolve()
    await expect(
      controller.dispatch({ action: 'stop', sessionId: 'closing' }),
    ).resolves.toMatchObject({
      state: 'unavailable',
      code: 'x3.vscode/runtime-session-closing',
    })
    expect(releases).toBe(1)
    finishRelease?.()
    await expect(first).resolves.toMatchObject({ state: 'ok', action: 'stop' })
    expect(releases).toBe(1)
    expect(controller.sessionIds).toEqual([])
  })

  it('waits for a pending stop during dispose without releasing its lease twice', async () => {
    let finishRelease: (() => void) | undefined
    const releaseGate = new Promise<void>(resolve => {
      finishRelease = resolve
    })
    let releases = 0
    const controller = controllerWith(async request => ({
      state: 'resolved',
      providerId: 'org.example/runtime-v2',
      session: fakeSession(request.sessionId),
      diagnostics: [],
      async release() {
        releases += 1
        await releaseGate
      },
    }))
    await controller.dispatch({
      action: 'start',
      runtimeId: 'org.example/runtime-id',
      sessionId: 'dispose-closing',
    })
    const stopping = controller.dispatch({ action: 'stop', sessionId: 'dispose-closing' })
    await Promise.resolve()
    const disposing = controller.dispose()
    await Promise.resolve()
    expect(releases).toBe(1)
    finishRelease?.()
    await expect(stopping).resolves.toMatchObject({ state: 'ok', action: 'stop' })
    await disposing
    expect(releases).toBe(1)
    expect(controller.sessionIds).toEqual([])
  })

  it('contains no provider import or game branch and registers one generic command', () => {
    const root = join(import.meta.dirname, '..')
    const adapter = readFileSync(join(root, 'src', 'runtime-debug.ts'), 'utf8')
    const extension = readFileSync(join(root, 'src', 'extension.ts'), 'utf8')
    expect(adapter).toContain("from '@modkitx-x3/host/runtime'")
    expect(adapter).not.toMatch(/extensions[\\/]|publisher-specific/iu)
    expect(extension).toContain("registerCommand('modkit.runtime.control'")
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      readonly activationEvents: readonly string[]
      readonly contributes: { readonly commands: readonly { readonly command: string }[] }
    }
    expect(manifest.activationEvents).toContain('onCommand:modkit.runtime.control')
    expect(
      manifest.contributes.commands.filter(item => item.command.startsWith('modkit.runtime.')),
    ).toEqual([{ command: 'modkit.runtime.control', title: 'Modkit: Control Runtime Session…' }])
  })
})
