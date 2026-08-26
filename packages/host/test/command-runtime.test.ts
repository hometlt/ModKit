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
  createCommandRuntime,
  createSubjectCommandRuntime,
  commandSubjectsFrom,
  COMMAND_CANCELLED,
  COMMAND_INPUT_INVALID,
  COMMAND_UNKNOWN,
  SUBJECT_COMMANDS,
  type CommandDescriptor,
  type CommandSubject,
} from '../src/index.js'

const nowhere = async (): Promise<CommandSubject> => {
  throw new Error('this test never opens a subject')
}

describe('the command runtime answers rather than throws', () => {
  it('registers the six commands of block 13, sorted, each with a summary', () => {
    const runtime = createSubjectCommandRuntime()
    expect(runtime.descriptors.map(item => item.id)).toEqual([
      'subject.convert',
      'subject.extract',
      'subject.inspect',
      'subject.open',
      'subject.preview',
      'subject.validate',
    ])
    expect(runtime.descriptors.every(item => item.summary.length > 20)).toBe(true)
    // None of the first six writes; a mutating command would need a write-source grant it is not given
    expect(runtime.descriptors.some(item => item.mutatesSource)).toBe(false)
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
