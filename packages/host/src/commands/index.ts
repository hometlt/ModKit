/**
 * The command runtime, assembled.
 *
 * An application composes this once and then owns none of it: it supplies a way to open a subject
 * and, if it can write, somewhere to put bytes. What a command *does* is the same object in every
 * one of them, which is what exit-gate line 1 of block 13 asks for and what one set of fixtures
 * across three hosts proves.
 */

import type { SubjectOpener } from '../subject-rpc.js'
import { createCommandRuntime, type CommandRuntime, type CommandSubjectOpener } from './runtime.js'
import { describeCommandContracts, type CommandContractDocument } from './protocol.js'
import { SUBJECT_COMMANDS } from './subject-commands.js'
import { SUBJECT_COMMAND_TARGETS } from './subject-command-targets.js'

export * from './runtime.js'
export * from './protocol.js'
export { SUBJECT_COMMANDS } from './subject-commands.js'
export { SUBJECT_COMMAND_TARGETS, type SubjectCommandTarget } from './subject-command-targets.js'

/** The runtime every application in this repository composes. */
export function createSubjectCommandRuntime(): CommandRuntime {
  return createCommandRuntime(SUBJECT_COMMANDS)
}

/** The versioned data contract exposed by non-interactive command hosts. */
export function describeSubjectCommandContracts(): CommandContractDocument {
  return describeCommandContracts(
    createSubjectCommandRuntime(),
    Object.values(SUBJECT_COMMAND_TARGETS),
  )
}

/**
 * The one adapter between a host's `SubjectOpener` and the runtime's opener.
 *
 * Written once because the interesting half is disposal: the RPC opener hands back a live session
 * and expects its caller to end it, and a command that forgot would leak a worker per invocation in
 * a batch run. Every host gets that right by not implementing it.
 */
export function commandSubjectsFrom(open: SubjectOpener): CommandSubjectOpener {
  return async (ref, signal) => {
    const answer = await open(ref, signal)
    let disposed = false
    return {
      ref,
      snapshot: answer.snapshot,
      ...(answer.session === undefined ? {} : { session: answer.session }),
      async dispose() {
        if (disposed) return
        disposed = true
        await answer.session?.dispose()
      },
    }
  }
}
