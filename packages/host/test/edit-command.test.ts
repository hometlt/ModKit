import { describe, expect, it } from 'vitest'
import {
  createModkitCommandRuntime,
  describeModkitCommandContracts,
  SUBJECT_EDIT_COMMAND,
  type CommandContext,
  type CommandSubject,
} from '@modkit/host'

const plan = {
  planId: 'fixture-plan',
  targets: [],
  edits: [
    {
      operation: 'replace',
      targetId: 'content',
      source: { id: 'fixture', uri: 'fixture://subject' },
      range: { kind: 'bytes', offset: 4n, length: 2n },
      payload: { kind: 'text', text: 'abc' },
    },
  ],
  semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
  fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
  diagnostics: [],
}

function subject(options: { editing?: boolean; prepare?: unknown } = {}) {
  const calls: string[] = []
  const session = {
    async descriptor() {
      return {
        operations: [
          { id: 'edit.field', handlerId: 'set', state: 'available', mutatesSource: true },
          {
            id: 'edit.content',
            handlerId: 'off',
            state: 'unsupported',
            reason: 'no',
            mutatesSource: true,
          },
        ],
      }
    },
    operations: () => ({
      async invoke(handlerId: string) {
        calls.push(`invoke:${handlerId}`)
        return { state: 'ok', output: { kind: 'edit-plan', plan }, diagnostics: [] }
      },
    }),
  }
  const editing = {
    grantSnapshot: {},
    planFromOperation: (output: { plan: unknown }) => output.plan,
    async stagePlan(value: unknown) {
      calls.push('stage')
      return value
    },
    async releasePlan() {
      calls.push('release')
    },
    coordinator: {
      async prepare() {
        calls.push('prepare')
        return options.prepare ?? { state: 'ready', prepared: { preparedId: 'p' } }
      },
      async commit() {
        calls.push('commit')
        return {
          state: 'committed',
          receipt: { transactionId: 'tx-1', status: 'committed', writes: [{ bytes: 3n }] },
        }
      },
    },
  }
  const opened = {
    ref: 'fixture',
    snapshot: { state: 'opened', diagnostics: [] },
    session,
    ...(options.editing === false ? {} : { editing }),
    async dispose() {
      calls.push('dispose')
    },
  } as unknown as CommandSubject
  const context: CommandContext = { openSubject: async () => opened }
  return { calls, context }
}

describe('subject.edit', () => {
  const runtime = createModkitCommandRuntime()
  const input = { subject: 'fixture', operation: 'edit.field', operationInput: { value: 1 } }

  it('is a declared mutating command routed only to standard edit operations', () => {
    expect(runtime.get(SUBJECT_EDIT_COMMAND)?.mutatesSource).toBe(true)
    const contract = describeModkitCommandContracts().commands.find(
      item => item.id === SUBJECT_EDIT_COMMAND,
    )
    expect(contract?.routing.operationIds).toEqual(['edit.field', 'edit.content', 'edit.structure'])
    expect(contract?.effects.mutatesSource).toBe(true)
  })

  it('previews without staging or committing', async () => {
    const { calls, context } = subject()
    const result = await runtime.run(SUBJECT_EDIT_COMMAND, input, context)
    expect(result).toMatchObject({
      state: 'ok',
      data: {
        committed: false,
        plan: {
          planId: 'fixture-plan',
          edits: [{ offset: '4', length: '2', replacementBytes: 3 }],
        },
      },
    })
    expect(calls).toEqual(['invoke:set', 'dispose'])
  })

  it('commits through the host coordinator and keeps the committed payload', async () => {
    const { calls, context } = subject()
    const result = await runtime.run(SUBJECT_EDIT_COMMAND, { ...input, commit: true }, context)
    expect(result).toMatchObject({
      state: 'ok',
      data: { committed: true, receipt: { transactionId: 'tx-1', writes: [{ bytes: '3' }] } },
    })
    expect(calls).toEqual(['invoke:set', 'stage', 'prepare', 'commit', 'dispose'])
  })

  it('refuses commit without an editing surface, and releases a refused plan', async () => {
    const readOnly = subject({ editing: false })
    await expect(
      runtime.run(SUBJECT_EDIT_COMMAND, { ...input, commit: true }, readOnly.context),
    ).resolves.toMatchObject({ state: 'unavailable' })

    const stale = subject({ prepare: { state: 'conflict', conflicts: [{ targetId: 'content' }] } })
    await expect(
      runtime.run(SUBJECT_EDIT_COMMAND, { ...input, commit: true }, stale.context),
    ).resolves.toMatchObject({ state: 'failed', code: 'x3.command/edit-stale-revision' })
    expect(stale.calls).toEqual(['invoke:set', 'stage', 'prepare', 'release', 'dispose'])

    const denied = subject({
      prepare: { state: 'rejected', reason: 'permission-missing', diagnostics: [] },
    })
    await expect(
      runtime.run(SUBJECT_EDIT_COMMAND, { ...input, commit: true }, denied.context),
    ).resolves.toMatchObject({ state: 'failed', code: 'x3.command/edit-permission-missing' })
  })

  it('refuses non-edit, unavailable and malformed requests before invoking anything', async () => {
    const { calls, context } = subject()
    await expect(
      runtime.run(SUBJECT_EDIT_COMMAND, { ...input, operation: 'asset.validate' }, context),
    ).resolves.toMatchObject({ state: 'failed', code: 'x3.command/input-invalid' })
    await expect(
      runtime.run(SUBJECT_EDIT_COMMAND, { ...input, operation: 'edit.content' }, context),
    ).resolves.toMatchObject({ state: 'unavailable' })
    await expect(
      runtime.run(SUBJECT_EDIT_COMMAND, { ...input, commit: 'yes' }, context),
    ).resolves.toMatchObject({ state: 'failed', code: 'x3.command/input-invalid' })
    expect(calls.filter(call => call.startsWith('invoke'))).toEqual([])
  })
})
