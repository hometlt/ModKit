/**
 * Machine-readable project validation for the CLI.
 *
 * A project is only a directory boundary here. The CLI walks regular files in deterministic order
 * and submits each one to the shared `subject.validate` command. It never decides which suffix is
 * a script, texture or game asset: the extension inventory and subject resolver own that meaning.
 * Files no loaded contribution claims remain visible as `unclaimed`; they also keep the project
 * red, because a whole-project check must not silently omit an input the caller put in its scope.
 */

import { readdir, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import process from 'node:process'
import {
  COMMAND_SUBJECT_UNRESOLVED,
  commandRequest,
  commandSubjectsFrom,
  createSubjectCommandRuntime,
  executeCommandRequest,
  type CommandReceipt,
} from '@modkit/host'
import { createPathSubjectOpener } from '@modkit/host/node'
import { createModkitCliSubjectServices, loadModkitCliExtensions } from './profile.js'
import { cliExtensionFailure } from './extension-validation.js'
import type { RunOutputFormat } from './commands.js'

export const PROJECT_VALIDATION_SCHEMA_VERSION = 'modkit-project-validation-1' as const

export interface ProjectValidationArguments {
  readonly directory: string
  readonly roots: readonly string[]
  readonly trust: boolean
  readonly format: RunOutputFormat
}

export interface ProjectValidationOptions {
  readonly signal?: AbortSignal
  readonly writeStdout?: (text: string) => void
  readonly writeStderr?: (text: string) => void
}

type ProjectFileState = 'validated' | 'unclaimed' | 'failed'

export interface ProjectValidationFile {
  readonly path: string
  readonly state: ProjectFileState
  readonly receipt: CommandReceipt
}

export interface ProjectValidationReceipt {
  readonly schemaVersion: typeof PROJECT_VALIDATION_SCHEMA_VERSION
  readonly request: {
    readonly command: 'project.validate'
    readonly project: string
  }
  readonly result: {
    readonly state: 'ok' | 'failed'
    readonly summary: {
      readonly discovered: number
      readonly validated: number
      readonly unclaimed: number
      readonly failed: number
    }
    readonly files: readonly ProjectValidationFile[]
    readonly diagnostics?: CommandReceipt['result']['diagnostics']
  }
}

export function parseProjectValidationArguments(
  directory: string | undefined,
  rest: readonly string[],
): ProjectValidationArguments | undefined {
  if (directory === undefined || directory.startsWith('--')) return undefined
  const roots: string[] = []
  let trust = false
  let format: RunOutputFormat = 'text'
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--ext') {
      const value = rest[index + 1]
      if (value === undefined || value.startsWith('--')) return undefined
      roots.push(value)
      index += 1
    } else if (argument === '--format') {
      const value = rest[index + 1]
      if (value !== 'text' && value !== 'json' && value !== 'protocol-json') return undefined
      format = value
      index += 1
    } else if (argument === '--json') format = 'json'
    else if (argument === '--trust') trust = true
    else return undefined
  }
  if (roots.length === 0) return undefined
  return { directory, roots, trust, format }
}

async function regularFiles(root: string): Promise<readonly string[]> {
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) throw new TypeError('project.validate requires a directory')
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(path)
      else throw new TypeError(`project.validate refuses non-regular entry ${path}`)
    }
  }
  await visit(root)
  return Object.freeze(files)
}

const projectPath = (root: string, path: string): string =>
  relative(root, path).replaceAll('\\', '/')

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

function renderProjectValidation(receipt: ProjectValidationReceipt, json: boolean): string {
  if (json) return jsonText(receipt)
  const { summary } = receipt.result
  const lines = [
    `${receipt.result.state === 'ok' ? 'VALID' : 'INVALID'} PROJECT ${receipt.request.project}`,
    `  ${summary.validated} validated, ${summary.unclaimed} unclaimed, ${summary.failed} failed`,
    ...receipt.result.files.map(file => `  ${file.state.toUpperCase()} ${file.path}`),
    ...(receipt.result.diagnostics ?? []).map(
      item => `  ${item.severity} ${item.code} ${item.message}`,
    ),
  ]
  return `${lines.join('\n')}\n`
}

export async function validateProject(
  arguments_: ProjectValidationArguments,
  options: ProjectValidationOptions = {},
): Promise<number> {
  const writeStdout = options.writeStdout ?? (text => void process.stdout.write(text))
  const writeStderr = options.writeStderr ?? (text => void process.stderr.write(text))
  try {
    const project = resolve(arguments_.directory)
    const loaded = await loadModkitCliExtensions(arguments_.roots, arguments_.trust, options.signal)
    const services = await createModkitCliSubjectServices(loaded.inputs)
    const admission = cliExtensionFailure(
      'project.validate',
      { subject: project },
      services.inventory,
      loaded.failures,
    )
    if (admission !== undefined) {
      writeStdout(
        renderProjectValidation(
          {
            schemaVersion: PROJECT_VALIDATION_SCHEMA_VERSION,
            request: { command: 'project.validate', project },
            result: {
              state: 'failed',
              summary: { discovered: 0, validated: 0, unclaimed: 0, failed: 0 },
              files: [],
              diagnostics: admission.result.diagnostics,
            },
          },
          arguments_.format !== 'text',
        ),
      )
      return 1
    }
    const files = await regularFiles(project)
    const opener = createPathSubjectOpener({
      subjects: services,
      roots: [project],
      grant: { id: 'modkit-cli-project', classes: ['read-source'] },
    })
    const runtime = createSubjectCommandRuntime()
    const results: ProjectValidationFile[] = []
    for (const file of files) {
      if (options.signal?.aborted)
        throw new DOMException('project validation cancelled', 'AbortError')
      const path = projectPath(project, file)
      if (arguments_.format === 'text') writeStderr(`… validating ${path}\n`)
      const receipt = await executeCommandRequest(
        runtime,
        commandRequest('subject.validate', { subject: file }),
        {
          openSubject: commandSubjectsFrom(opener),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      )
      const state: ProjectFileState =
        receipt.result.state === 'ok'
          ? 'validated'
          : receipt.result.state === 'failed' && receipt.result.code === COMMAND_SUBJECT_UNRESOLVED
            ? 'unclaimed'
            : 'failed'
      results.push({ path, state, receipt })
    }
    const validated = results.filter(item => item.state === 'validated').length
    const unclaimed = results.filter(item => item.state === 'unclaimed').length
    const failed = results.filter(item => item.state === 'failed').length
    const state = validated > 0 && validated === results.length ? 'ok' : 'failed'
    const receipt: ProjectValidationReceipt = {
      schemaVersion: PROJECT_VALIDATION_SCHEMA_VERSION,
      request: { command: 'project.validate', project },
      result: {
        state,
        summary: { discovered: results.length, validated, unclaimed, failed },
        files: Object.freeze(results),
      },
    }
    writeStdout(renderProjectValidation(receipt, arguments_.format !== 'text'))
    return state === 'ok' ? 0 : 1
  } catch (error) {
    writeStderr(`modkit project.validate: ${(error as Error).message}\n`)
    return 2
  }
}
