/**
 * The command runtime, assembled.
 *
 * An application composes this once and then owns none of it: it supplies a way to open a subject
 * and, if it can write, somewhere to put bytes. What a command *does* is the same object in every
 * one of them, which is what exit-gate line 1 of block 13 asks for and what one set of fixtures
 * across three hosts proves.
 */

import { createCommandRuntime, type CommandRuntime } from './runtime.js'
import { describeCommandContracts, type CommandContractDocument } from './protocol.js'
import { SUBJECT_COMMANDS } from './subject-commands.js'
import { SUBJECT_COMMAND_TARGETS } from './subject-command-targets.js'
import {
  SERVICE_OPERATION_COMMANDS,
  SERVICE_OPERATION_COMMAND_TARGETS,
} from './service-operation-commands.js'

export * from './runtime.js'
export * from './protocol.js'
export * from './endpoint.js'
export { commandSubjectsFrom } from './subject-opener.js'
export { SUBJECT_COMMANDS } from './subject-commands.js'
export { SUBJECT_COMMAND_TARGETS, type SubjectCommandTarget } from './subject-command-targets.js'
export {
  SERVICE_OPERATION_COMMANDS,
  SERVICE_OPERATION_COMMAND_TARGETS,
  SERVICE_OPERATIONS_COMMAND,
  SERVICE_OPERATION_INVOKE_COMMAND,
} from './service-operation-commands.js'

/** The runtime every application in this repository composes. */
export function createSubjectCommandRuntime(): CommandRuntime {
  return createCommandRuntime(SUBJECT_COMMANDS)
}

/** The complete common command runtime; products can add capabilities without adding handlers. */
export function createModkitCommandRuntime(): CommandRuntime {
  return createCommandRuntime([...SUBJECT_COMMANDS, ...SERVICE_OPERATION_COMMANDS])
}

export function describeModkitCommandContracts(): CommandContractDocument {
  return describeCommandContracts(createModkitCommandRuntime(), [
    ...Object.values(SUBJECT_COMMAND_TARGETS),
    ...SERVICE_OPERATION_COMMAND_TARGETS,
  ])
}

/** The versioned data contract exposed by non-interactive command hosts. */
export function describeSubjectCommandContracts(): CommandContractDocument {
  return describeCommandContracts(
    createSubjectCommandRuntime(),
    Object.values(SUBJECT_COMMAND_TARGETS),
  )
}
