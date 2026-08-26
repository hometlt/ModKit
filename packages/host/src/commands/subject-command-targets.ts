/**
 * Machine-readable bindings for the shared subject command runtime.
 *
 * This is deliberately a data-only module. The runtime consumes the same ids that migration
 * tooling reports, so block-14 workflow evidence cannot drift into a second handwritten command
 * catalog. Host callers are limited to callers proved in the current tree; PWA is intentionally
 * absent until it composes this runtime and carries its own wiring evidence. Automation is present
 * because block 14B runs the shared fixtures through its bounded path opener.
 */
import { defineSubjectCommandTargets } from './immutable-command-targets.js'

export const SUBJECT_COMMAND_TARGETS = defineSubjectCommandTargets({
  open: {
    commandId: 'subject.open',
    needsSubject: true,
    mutatesSource: false,
    operationIds: [],
    dataSourceContracts: [],
    hostCallers: ['automation', 'cli', 'electron', 'vscode'],
  },
  inspect: {
    commandId: 'subject.inspect',
    needsSubject: true,
    mutatesSource: false,
    operationIds: [],
    dataSourceContracts: [],
    hostCallers: ['automation', 'cli', 'electron', 'vscode'],
  },
  validate: {
    commandId: 'subject.validate',
    needsSubject: true,
    mutatesSource: false,
    operationIds: ['asset.validate'],
    dataSourceContracts: [],
    hostCallers: ['automation', 'cli', 'electron', 'vscode'],
  },
  extract: {
    commandId: 'subject.extract',
    needsSubject: true,
    mutatesSource: false,
    operationIds: ['container.extract'],
    dataSourceContracts: ['common.view/namespace-entry-source'],
    hostCallers: ['automation', 'cli', 'electron', 'vscode'],
  },
  convert: {
    commandId: 'subject.convert',
    needsSubject: true,
    mutatesSource: false,
    operationIds: ['export.convert', 'export.raw'],
    dataSourceContracts: [],
    hostCallers: ['automation', 'cli', 'electron', 'vscode'],
  },
  preview: {
    commandId: 'subject.preview',
    needsSubject: true,
    mutatesSource: false,
    operationIds: ['view.thumbnail', 'view.render'],
    dataSourceContracts: [],
    hostCallers: ['automation', 'cli', 'electron', 'vscode'],
  },
} as const)

export type SubjectCommandTarget =
  (typeof SUBJECT_COMMAND_TARGETS)[keyof typeof SUBJECT_COMMAND_TARGETS]
