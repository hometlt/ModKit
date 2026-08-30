/** S14 Path A stays prepare/commit-only and does not become a writer proposal. */
import { describe, expect, it } from 'vitest'
import type { SubjectEditingArm } from '@modkitx-x3/host'
import type { AssetEditPlan } from '@modkitx-x3/sdk'

import { createWebviewEditorPorts } from '../src/editor-ports.js'

const PLAN = { planId: 'codec-operation-plan' } as unknown as AssetEditPlan

describe('VS Code webview editor ports', () => {
  it('commits an operation plan through prepare/commit without propose or plan', async () => {
    const calls: string[] = []
    let prepared: AssetEditPlan | undefined
    const arm = {
      async state() {
        calls.push('state')
        return { revision: 'content-hash.sha256:open', targets: [] }
      },
      async propose() {
        calls.push('propose')
        return { valid: true, diagnostics: [] }
      },
      async plan() {
        calls.push('plan')
        return PLAN
      },
      async prepare(value: AssetEditPlan) {
        calls.push('prepare')
        prepared = value
        return { state: 'ready', preparedId: 'prepared-1' }
      },
      async commit() {
        calls.push('commit')
        return { state: 'committed', receipt: {} }
      },
      async dispose() {
        calls.push('dispose')
      },
    } as unknown as SubjectEditingArm

    const ports = await createWebviewEditorPorts({ arm })
    expect(await ports.applyPlan(PLAN)).toEqual({ message: 'saved', failed: false })
    expect(prepared).toBe(PLAN)
    expect(calls).toEqual(['state', 'prepare', 'commit'])
  })

  it('keeps coordinator diagnostics and host validation errors in their exact words', async () => {
    const rejected = {
      state: async () => ({ revision: 'open', targets: [] }),
      propose: async () => ({ valid: true, diagnostics: [] }),
      plan: async () => PLAN,
      prepare: async () => ({
        state: 'rejected',
        reason: 'fidelity-unproven',
        diagnostics: [{ message: 'writer corpus does not cover this input class' }],
      }),
      commit: async () => ({ state: 'not-applied', reason: 'never' }),
      dispose: async () => undefined,
    } as unknown as SubjectEditingArm
    const rejectedPorts = await createWebviewEditorPorts({ arm: rejected })
    const status = await rejectedPorts.applyPlan(PLAN)
    expect(status.failed).toBe(true)
    expect(status.message).toContain('fidelity-unproven')
    expect(status.message).toContain('writer corpus does not cover this input class')

    const refused = {
      ...rejected,
      prepare: async () => {
        throw new TypeError('x3.host/edit-plan-subject-mismatch: exact host reason')
      },
    } as unknown as SubjectEditingArm
    const refusedPorts = await createWebviewEditorPorts({ arm: refused })
    expect((await refusedPorts.applyPlan(PLAN)).message).toContain(
      'x3.host/edit-plan-subject-mismatch: exact host reason',
    )
  })
})
