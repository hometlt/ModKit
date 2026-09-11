/**
 * The runtime's own rules, without a codec in sight.
 *
 * The fixtures in `scripts/test/command-fixtures-hosts.test.ts` prove that real commands agree
 * across hosts. These are the cases a real command cannot reach: an id nobody registered, a subject
 * that never arrives, a cancellation. Each of them used to be an exception that every application
 * would have had to catch and interpret for itself — which is precisely how three products end up
 * reporting the same event three ways — so the assertion is that the runtime answers with a
 * *result* in each one.
 */
import { describe, expect, it } from 'vitest'
import {
  commandOk,
  commandRequest,
  commandUnavailable,
  createCommandRuntime,
  createSubjectCommandEndpoint,
  createSubjectCommandRuntime,
  commandSubjectsFrom,
  describeSubjectCommandContracts,
  executeCommandRequest,
  COMMAND_CANCELLED,
  COMMAND_INPUT_INVALID,
  COMMAND_PROTOCOL_SCHEMA_VERSION,
  COMMAND_UNKNOWN,
  SUBJECT_COMMANDS,
  SUBJECT_COMMAND_TARGETS,
  type CommandDescriptor,
  type CommandRequest,
  type CommandSubject,
} from '../src/index.js'

const nowhere = async (): Promise<CommandSubject> => {
  throw new Error('this test never opens a subject')
}

describe('the command runtime answers rather than throws', () => {
  it('registers the six commands of block 13, sorted, each with a summary', () => {
    const runtime = createSubjectCommandRuntime()
    const expectedIds = [
      'subject.convert',
      'subject.extract',
      'subject.inspect',
      'subject.open',
      'subject.preview',
      'subject.validate',
    ]
    expect(runtime.descriptors.map(item => item.id)).toEqual(expectedIds)
    expect(
      Object.values(SUBJECT_COMMAND_TARGETS)
        .map(target => target.commandId)
        .sort(),
    ).toEqual(expectedIds)
    expect(runtime.descriptors.every(item => item.summary.length > 20)).toBe(true)
    // None of the first six writes; a mutating command would need a write-source grant it is not given
    expect(runtime.descriptors.some(item => item.mutatesSource)).toBe(false)
  })

  it('pins the machine-readable targets to live operations and proved application callers', () => {
    expect(SUBJECT_COMMAND_TARGETS).toMatchObject({
      open: { operationIds: [] },
      inspect: { operationIds: [] },
      validate: { operationIds: ['asset.validate'] },
      extract: {
        operationIds: ['container.extract'],
        dataSourceContracts: ['common.view/namespace-entry-source'],
      },
      convert: {
        operationIds: [
          'export.convert',
          'export.raw',
          'model.export-uvm',
          'model.export-native',
          'model.write',
        ],
      },
      preview: { operationIds: ['view.thumbnail', 'view.render', 'model.render'] },
    })
    for (const target of Object.values(SUBJECT_COMMAND_TARGETS)) {
      expect(target.hostCallers).toEqual([
        'automation',
        'cli',
        'electron',
        'pwa',
        'server',
        'vscode',
      ])
      const descriptor = createSubjectCommandRuntime().descriptors.find(
        item => item.id === target.commandId,
      )
      expect(descriptor).toMatchObject({
        needsSubject: target.needsSubject,
        mutatesSource: target.mutatesSource,
      })
    }
  })

  it('describes one deterministic, deeply frozen JSON contract from the live runtime', () => {
    const first = describeSubjectCommandContracts()
    const second = describeSubjectCommandContracts()
    expect(first.schemaVersion).toBe(COMMAND_PROTOCOL_SCHEMA_VERSION)
    expect(first.commands.map(command => command.id)).toEqual([
      'subject.convert',
      'subject.extract',
      'subject.inspect',
      'subject.open',
      'subject.preview',
      'subject.validate',
    ])
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.commands)).toBe(true)
    for (const command of first.commands) {
      expect(Object.isFrozen(command)).toBe(true)
      expect(Object.isFrozen(command.input)).toBe(true)
      expect(Object.isFrozen(command.routing.operationIds)).toBe(true)
      expect(Object.isFrozen(command.routing.dataSourceContracts)).toBe(true)
      expect(Object.isFrozen(command.callers)).toBe(true)
      expect(command.result.states).toEqual(['ok', 'unavailable', 'failed'])
    }
  })

  it('canonicalizes undefined fields instead of putting non-JSON values in a request', () => {
    const request = commandRequest('subject.open', { subject: 'x', omitted: undefined })
    expect(Object.hasOwn(request.input, 'omitted')).toBe(false)
    expect(JSON.parse(JSON.stringify(request))).toEqual(request)
  })

  it('rejects an unknown protocol version before running a command', async () => {
    const request = {
      ...commandRequest('subject.open', { subject: 'x' }),
      schemaVersion: 'modkit-command-protocol-99',
    } as unknown as CommandRequest
    await expect(
      executeCommandRequest(createSubjectCommandRuntime(), request, { openSubject: nowhere }),
    ).rejects.toThrow(/unsupported command protocol/u)
  })

  it('wraps unknown, cancelled and unavailable outcomes in stable receipts', async () => {
    const runtime = createSubjectCommandRuntime()
    const unknown = await executeCommandRequest(
      runtime,
      commandRequest('subject.teleport', { subject: 'x' }),
      { openSubject: nowhere },
    )
    expect(unknown).toMatchObject({
      schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
      request: { command: 'subject.teleport' },
      result: { state: 'failed', code: COMMAND_UNKNOWN },
    })

    const controller = new AbortController()
    controller.abort()
    const cancelled = await executeCommandRequest(
      runtime,
      commandRequest('subject.open', { subject: 'x' }),
      { openSubject: nowhere, signal: controller.signal },
    )
    expect(cancelled.result).toMatchObject({ state: 'failed', code: COMMAND_CANCELLED })

    const unavailableRuntime = createCommandRuntime([
      {
        id: 'test.unavailable',
        title: 'Unavailable',
        summary: 'A command that proves a structured alternative survives the protocol envelope.',
        needsSubject: false,
        mutatesSource: false,
        run: async () => commandUnavailable('test.unavailable', 'not here', 'run elsewhere'),
      },
    ])
    const unavailable = await executeCommandRequest(
      unavailableRuntime,
      commandRequest('test.unavailable', {}),
      { openSubject: nowhere },
    )
    expect(unavailable.result).toMatchObject({
      state: 'unavailable',
      reason: 'not here',
      alternative: 'run elsewhere',
    })
    expect(JSON.parse(JSON.stringify(unavailable))).toEqual(unavailable)
  })

  it('keeps progress out-of-band while the final receipt stays JSON-stable', async () => {
    const progress: string[] = []
    const runtime = createCommandRuntime([
      {
        id: 'test.progress',
        title: 'Progress',
        summary: 'A command that emits progress without changing its final structured answer.',
        needsSubject: false,
        mutatesSource: false,
        run: async context => {
          context.progress?.({ step: 'one', message: 'working', completed: 1, total: 1 })
          return commandOk('test.progress', { completed: true })
        },
      },
    ])
    const receipt = await executeCommandRequest(runtime, commandRequest('test.progress', {}), {
      openSubject: nowhere,
      progress: step => progress.push(`${step.step}:${step.completed}/${step.total}`),
    })
    expect(progress).toEqual(['one:1/1'])
    expect(receipt.result).toMatchObject({ state: 'ok', data: { completed: true } })
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.result)).toBe(true)
  })

  it('binds catalog, progress and JSON receipts into one bounded application endpoint', async () => {
    const progress: string[] = []
    let disposed = 0
    const endpoint = createSubjectCommandEndpoint({
      openSubject: async ref => ({
        snapshot: {
          state: 'opened',
          sessionId: 'session-1',
          descriptor: { identity: { formatId: 'fixture', formatLabel: 'Fixture' }, operations: [] },
          selected: { contributionId: 'fixture/codec', variantId: 'portable', confidence: 1 },
          candidates: [],
          diagnostics: [],
        },
        session: {
          descriptor: async () => ({
            identity: { formatId: 'fixture', formatLabel: 'Fixture' },
            operations: [],
          }),
          dispose: async () => {
            disposed += 1
          },
        } as never,
        ref,
      }),
      maxConcurrentRuns: 2,
    })
    expect(endpoint.catalog).toEqual(describeSubjectCommandContracts())
    const receipt = await endpoint.execute(
      commandRequest('subject.open', { subject: 'opaque:fixture' }),
      { runId: 'run-1', progress: item => progress.push(item.step) },
    )
    expect(receipt).toMatchObject({
      schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
      request: { command: 'subject.open', input: { subject: 'opaque:fixture' } },
      result: { state: 'ok', data: { formatId: 'fixture' } },
    })
    expect(progress).toEqual(['open'])
    expect(disposed).toBe(1)
    expect(endpoint.activeRuns).toBe(0)
  })

  it('cancels by live handle, refuses duplicate/unbounded runs and cleans up after errors', async () => {
    const endpoint = createSubjectCommandEndpoint({
      maxConcurrentRuns: 1,
      openSubject: async (_ref, signal) =>
        await new Promise((_, reject) => {
          const abort = new Error('stopped')
          abort.name = 'AbortError'
          signal?.addEventListener('abort', () => reject(abort), { once: true })
        }),
    })
    const first = endpoint.execute(commandRequest('subject.open', { subject: 'opaque:slow' }), {
      runId: 'slow',
    })
    expect(endpoint.activeRuns).toBe(1)
    await expect(
      endpoint.execute(commandRequest('subject.open', { subject: 'opaque:second' }), {
        runId: 'second',
      }),
    ).rejects.toThrow(/permitted runs/u)
    expect(endpoint.cancel('slow')).toBe(true)
    expect((await first).result).toMatchObject({ state: 'failed', code: COMMAND_CANCELLED })
    expect(endpoint.cancel('slow')).toBe(false)
    expect(endpoint.activeRuns).toBe(0)

    const duplicate = createSubjectCommandEndpoint({
      maxConcurrentRuns: 2,
      openSubject: async (_ref, signal) =>
        await new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        }),
    })
    const live = duplicate.execute(commandRequest('subject.open', { subject: 'opaque:a' }), {
      runId: 'same',
    })
    await expect(
      duplicate.execute(commandRequest('subject.open', { subject: 'opaque:b' }), {
        runId: 'same',
      }),
    ).rejects.toThrow(/already active/u)
    duplicate.cancel('same')
    await live

    const broken = createSubjectCommandEndpoint({
      openSubject: async () => {
        throw new Error('realm failed')
      },
    })
    const failure = await broken.execute(
      commandRequest('subject.open', { subject: 'opaque:broken' }),
    )
    expect(failure.result).toMatchObject({ state: 'failed', message: 'realm failed' })
    await expect(
      broken.execute({
        ...commandRequest('subject.open', { subject: 'opaque:broken' }),
        schemaVersion: 'modkit-command-protocol-99',
      } as unknown as CommandRequest),
    ).rejects.toThrow(/unsupported command protocol/u)
    expect(broken.activeRuns).toBe(0)
  })

  it('terminal disposal is idempotent, drains live runs and refuses later execution', async () => {
    const endpoint = createSubjectCommandEndpoint({
      openSubject: async (_ref, signal) =>
        await new Promise((_, reject) => {
          const abort = new Error('host closed')
          abort.name = 'AbortError'
          signal?.addEventListener('abort', () => reject(abort), { once: true })
        }),
    })
    const running = endpoint.execute(commandRequest('subject.open', { subject: 'opaque:live' }), {
      runId: 'live',
    })
    expect(endpoint.activeRuns).toBe(1)
    const firstDispose = endpoint.dispose()
    expect(endpoint.closed).toBe(true)
    expect((await running).result).toMatchObject({ state: 'failed', code: COMMAND_CANCELLED })
    await firstDispose
    expect(endpoint.activeRuns).toBe(0)
    await expect(
      endpoint.execute(commandRequest('subject.open', { subject: 'opaque:later' })),
    ).rejects.toThrow(/closed/u)
    await expect(endpoint.dispose()).resolves.toBeUndefined()
  })

  it('keeps the shared target catalogue deeply immutable at runtime', () => {
    expect(Object.isFrozen(SUBJECT_COMMAND_TARGETS)).toBe(true)
    for (const target of Object.values(SUBJECT_COMMAND_TARGETS)) {
      expect(Object.isFrozen(target)).toBe(true)
      expect(Object.isFrozen(target.operationIds)).toBe(true)
      expect(Object.isFrozen(target.dataSourceContracts)).toBe(true)
      expect(Object.isFrozen(target.hostCallers)).toBe(true)
    }

    expect(() =>
      Object.defineProperty(SUBJECT_COMMAND_TARGETS.open, 'commandId', {
        value: 'subject.mutated',
      }),
    ).toThrow(TypeError)
    expect(() =>
      Object.defineProperty(SUBJECT_COMMAND_TARGETS.validate.operationIds, 0, {
        value: 'operation.mutated',
      }),
    ).toThrow(TypeError)
    expect(SUBJECT_COMMAND_TARGETS.open.commandId).toBe('subject.open')
    expect(SUBJECT_COMMAND_TARGETS.validate.operationIds).toEqual(['asset.validate'])
  })

  it('refuses two commands under one id, rather than letting the last registration win', () => {
    const twice = [...SUBJECT_COMMANDS, SUBJECT_COMMANDS[0] as CommandDescriptor]
    expect(() => createCommandRuntime(twice)).toThrow(/one id/u)
  })

  it('names an unknown command instead of throwing at the call site', async () => {
    const runtime = createSubjectCommandRuntime()
    const result = await runtime.run('subject.teleport', { subject: 'x' }, { openSubject: nowhere })
    expect(result).toMatchObject({ state: 'failed', code: COMMAND_UNKNOWN })
  })

  it('reports a missing subject before opening anything', async () => {
    const runtime = createSubjectCommandRuntime()
    const result = await runtime.run('subject.open', {}, { openSubject: nowhere })
    expect(result).toMatchObject({ state: 'failed', code: COMMAND_INPUT_INVALID })
  })

  it('turns an already-aborted signal into a cancelled result, not an exception', async () => {
    const runtime = createSubjectCommandRuntime()
    const controller = new AbortController()
    controller.abort()
    const result = await runtime.run(
      'subject.open',
      { subject: 'x' },
      { openSubject: nowhere, signal: controller.signal },
    )
    expect(result).toMatchObject({ state: 'failed', code: COMMAND_CANCELLED })
  })

  it('turns an abort raised inside a command into the same cancelled result', async () => {
    const controller = new AbortController()
    const slow: CommandDescriptor = {
      id: 'test.slow',
      title: 'Slow',
      summary: 'A command that notices the abort the way a real one does, from deep inside.',
      needsSubject: false,
      mutatesSource: false,
      run: async () => {
        controller.abort()
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      },
    }
    const runtime = createCommandRuntime([slow])
    const result = await runtime.run(
      'test.slow',
      {},
      { openSubject: nowhere, signal: controller.signal },
    )
    expect(result).toMatchObject({ state: 'failed', code: COMMAND_CANCELLED })
  })

  it('carries any other throw out as a failed result with its message', async () => {
    const broken: CommandDescriptor = {
      id: 'test.broken',
      title: 'Broken',
      summary: 'A command that throws something ordinary, as a codec bug eventually will.',
      needsSubject: false,
      mutatesSource: false,
      run: async () => {
        throw new Error('the parser gave up')
      },
    }
    const runtime = createCommandRuntime([broken])
    const result = await runtime.run('test.broken', {}, { openSubject: nowhere })
    expect(result).toMatchObject({ state: 'failed', message: 'the parser gave up' })
  })

  it('reports an unresolved subject by name, and disposes what the opener handed it', async () => {
    let disposed = 0
    const runtime = createSubjectCommandRuntime()
    const result = await runtime.run(
      'subject.inspect',
      { subject: 'nothing.unknown' },
      {
        openSubject: async ref => ({
          ref,
          snapshot: {
            state: 'unresolved',
            reason: 'no-candidate',
            candidates: [],
            diagnostics: [],
          },
          async dispose() {
            disposed += 1
          },
        }),
      },
    )
    expect(result).toMatchObject({ state: 'failed', code: 'x3.command/subject-unresolved' })
    // The opener's own disposal runs even though the subject never became usable: a host that
    // leaked here would leak a worker per refused file in a batch run.
    expect(disposed).toBe(1)
  })

  it('disposes through `commandSubjectsFrom` exactly once, however often a caller asks', async () => {
    let disposed = 0
    const open = commandSubjectsFrom(async () => ({
      snapshot: { state: 'unresolved', reason: 'no-candidate', candidates: [], diagnostics: [] },
      session: {
        dispose: async () => {
          disposed += 1
        },
      } as never,
    }))
    const subject = await open('anything')
    await subject.dispose()
    await subject.dispose()
    expect(disposed).toBe(1)
  })
})
