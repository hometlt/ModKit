/**
 * `modkit run` — the CLI's argv adapter over the shared command runtime (block 13, works 4–6).
 *
 * There is deliberately no behaviour here. Everything this file does is turn argv into a
 * `CommandInput`, hand it to the runtime that Electron and VS Code call with the same arguments,
 * and turn the one structured answer into text or JSON. If a verb ever needs a decision made, that
 * decision belongs in `@modkit/host`'s command runtime where all three hosts inherit it —
 * exit-gate line 1 of block 13 is precisely the rule that this file must stay boring.
 *
 * The existing verbs (`validate` a directory, `explain`, `host-profile`, `create codec`) are
 * untouched and stay where they are: they are tooling about extensions, not commands about a
 * subject, and folding them into a subject-shaped runtime would have made both worse. `modkit open`
 * keeps its own output contract for the same reason its tests exist, and `modkit run subject.open`
 * is the same operation reached through the shared surface.
 */

import { dirname, resolve } from 'node:path'
import { open, writeFile } from 'node:fs/promises'
import process from 'node:process'
import {
  commandRequest,
  commandSubjectsFrom,
  createCommandRuntime,
  SUBJECT_COMMANDS,
  SUBJECT_EDIT_COMMAND,
  SUBJECT_EDIT_COMMANDS,
  executeCommandRequest,
  type CommandInput,
  type CommandReceipt,
  type CommandResult,
  type ExtensionInput,
} from '@modkit/host'
import {
  createModkit,
  createPathSubjectOpener,
  loadExtensionDirectory,
  workerBackendPolicy,
} from '@modkit/host/node'
import { sceneModule } from '@modkit/scene/module'
import { uvModule } from '@modkit/uv/module'
import { createModkitCliSubjectServices } from './profile.js'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import type { JsonValue } from '@modkit/sdk'

export const RUN_USAGE =
  'usage: modkit run <command> <file> --ext <dir> [--ext <dir>...] [--entry <path>] ' +
  '[--target <id>] [--operation <id>] [--input <json-file>] [--commit] [--out <file>] [--trust] [--format text|json|protocol-json]\n'

export type RunOutputFormat = 'text' | 'json' | 'protocol-json'

export interface RunArguments {
  readonly command: string
  readonly file: string
  readonly roots: readonly string[]
  readonly entry?: string
  readonly target?: string
  readonly out?: string
  readonly operation?: string
  readonly inputFile?: string
  /** `subject.edit` only: apply the plan through the host commit coordinator. */
  readonly commit?: boolean
  readonly trust: boolean
  readonly format: RunOutputFormat
}

/** Process-owned lifecycle and output ports for one `modkit run` invocation. */
export interface RunCommandOptions {
  /** The CLI entrypoint binds this to SIGINT/SIGTERM; embedders may own another cancellation source. */
  readonly signal?: AbortSignal
  readonly writeStdout?: (text: string) => void
  readonly writeStderr?: (text: string) => void
}

/** argv → arguments, or `undefined` for anything the usage line does not describe. */
export function parseRunArguments(
  command: string | undefined,
  target: string | undefined,
  rest: readonly string[],
): RunArguments | undefined {
  if (command === undefined || command.startsWith('--')) return undefined
  if (target === undefined || target.startsWith('--')) return undefined
  const roots: string[] = []
  let entry: string | undefined
  let convertTarget: string | undefined
  let out: string | undefined
  let operation: string | undefined
  let inputFile: string | undefined
  let trust = false
  let commit = false
  let format: RunOutputFormat = 'text'
  const value = (index: number): string | undefined => {
    const found = rest[index]
    return found === undefined || found.startsWith('--') ? undefined : found
  }
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--ext') {
      const next = value(index + 1)
      if (next === undefined) return undefined
      roots.push(next)
      index += 1
    } else if (argument === '--entry') {
      entry = value(index + 1)
      if (entry === undefined) return undefined
      index += 1
    } else if (argument === '--target') {
      convertTarget = value(index + 1)
      if (convertTarget === undefined) return undefined
      index += 1
    } else if (argument === '--operation') {
      operation = value(index + 1)
      if (operation === undefined) return undefined
      index += 1
    } else if (argument === '--input') {
      inputFile = value(index + 1)
      if (inputFile === undefined) return undefined
      index += 1
    } else if (argument === '--out') {
      out = value(index + 1)
      if (out === undefined) return undefined
      index += 1
    } else if (argument === '--format') {
      const next = value(index + 1)
      if (next !== 'text' && next !== 'json' && next !== 'protocol-json') return undefined
      format = next
      index += 1
    } else if (argument === '--trust') trust = true
    else if (argument === '--commit') commit = true
    else if (argument === '--json') format = 'json'
    else return undefined
  }
  if (roots.length === 0) return undefined
  if (
    (operation !== undefined || inputFile !== undefined) &&
    command !== 'subject.convert' &&
    command !== 'subject.preview' &&
    command !== SUBJECT_EDIT_COMMAND
  )
    return undefined
  if (commit && command !== SUBJECT_EDIT_COMMAND) return undefined
  return {
    command,
    file: target,
    roots,
    ...(entry === undefined ? {} : { entry }),
    ...(convertTarget === undefined ? {} : { target: convertTarget }),
    ...(out === undefined ? {} : { out }),
    ...(operation === undefined ? {} : { operation }),
    ...(inputFile === undefined ? {} : { inputFile }),
    ...(commit ? { commit } : {}),
    trust,
    format,
  }
}

/** Own a bounded JSON request; the file cannot override the subject or command envelope. */
export async function readOperationInput(path: string, signal?: AbortSignal): Promise<JsonValue> {
  const maxBytes = 16 << 20
  signal?.throwIfAborted()
  const file = await open(resolve(path), 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > maxBytes)
      throw new RangeError('operation input must be a JSON file at most 16 MiB')
    // A bounded read also detects growth after stat without allocating an unbounded readFile buffer.
    const bytes = Buffer.alloc(Math.min(maxBytes + 1, stat.size + 1))
    let length = 0
    while (length < bytes.length) {
      signal?.throwIfAborted()
      const read = await file.read(bytes, length, bytes.length - length, null)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    if (length !== stat.size) throw new Error('operation input changed while reading')
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
    )
    return snapshotJson(value, { maxDepth: 64, maxNodes: 1_000_000, maxBytes }, signal)
  } finally {
    await file.close()
  }
}

/** JSON with bigints as decimal strings — the same convention the rest of the CLI prints with. */
const jsonText = (value: unknown): string =>
  `${JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item), 2)}\n`

/**
 * The one answer, rendered.
 *
 * `unavailable` prints its alternative on its own line because that is the half a person acts on,
 * and a §4.2 refusal that buried the alternative inside a paragraph would be a refusal in name only.
 */
export function renderCommandResult(result: CommandResult, json: boolean): string {
  if (json) return jsonText(result)
  const lines: string[] = []
  if (result.state === 'ok') {
    lines.push(`OK ${result.command}`)
    for (const [key, item] of Object.entries(result.data as Record<string, unknown>)) {
      lines.push(`  ${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`)
    }
  } else if (result.state === 'unavailable') {
    lines.push(`UNAVAILABLE ${result.command}: ${result.reason}`)
    lines.push(`  instead: ${result.alternative}`)
  } else {
    lines.push(`FAILED ${result.command} (${result.code}): ${result.message}`)
  }
  for (const item of result.diagnostics) {
    lines.push(`  ${item.severity ?? 'information'} ${item.code} ${item.message}`)
  }
  return `${lines.join('\n')}\n`
}

/** One parseable protocol document on stdout; progress and usage remain on stderr. */
export const renderCommandReceipt = (receipt: CommandReceipt): string => jsonText(receipt)

/** Exit code from a result: 0 only when the command did what it was asked. */
export const exitCodeFor = (result: CommandResult): number => (result.state === 'ok' ? 0 : 1)

export async function runCommand(
  arguments_: RunArguments,
  options: RunCommandOptions = {},
): Promise<number> {
  const writeStdout = options.writeStdout ?? (text => void process.stdout.write(text))
  const writeStderr = options.writeStderr ?? (text => void process.stderr.write(text))
  const runtime = createCommandRuntime([...SUBJECT_COMMANDS, ...SUBJECT_EDIT_COMMANDS])
  if (runtime.get(arguments_.command) === undefined) {
    if (arguments_.format === 'protocol-json') {
      const receipt = await executeCommandRequest(
        runtime,
        commandRequest(arguments_.command, { subject: resolve(arguments_.file) }),
        {
          openSubject: async () => {
            throw new Error('an unknown command must not try to open a subject')
          },
        },
      )
      writeStdout(renderCommandReceipt(receipt))
      return exitCodeFor(receipt.result)
    }
    writeStderr(
      `modkit run: unknown command «${arguments_.command}»; this build has ` +
        `${runtime.descriptors.map(item => item.id).join(', ')}\n`,
    )
    return 2
  }
  try {
    const operationInput =
      arguments_.inputFile === undefined
        ? undefined
        : await readOperationInput(arguments_.inputFile, options.signal)
    const file = resolve(arguments_.file)
    if (arguments_.command === SUBJECT_EDIT_COMMAND) {
      return await runEditCommand(
        arguments_,
        file,
        operationInput,
        runtime,
        writeStdout,
        writeStderr,
        options,
      )
    }
    const loaded = await Promise.all(
      arguments_.roots.map(root => loadExtensionDirectory(resolve(root))),
    )
    const extensions: readonly ExtensionInput[] = loaded.map(input => ({
      ...input,
      execution: { origin: 'linked', allowTrustedInProcess: arguments_.trust },
    }))
    const services = await createModkitCliSubjectServices(extensions)
    const opener = createPathSubjectOpener({
      subjects: services,
      // A named file is the CLI's whole grant: it opens what argv points at, and its companions
      // beside it. Nothing is discovered, which is the CLI profile's own limit (§4.1).
      roots: [dirname(file)],
      grant: { id: 'modkit-cli', classes: ['read-source'] },
    })
    const input: CommandInput = {
      subject: file,
      ...(arguments_.entry === undefined ? {} : { entry: arguments_.entry }),
      ...(arguments_.target === undefined ? {} : { target: arguments_.target }),
      ...(arguments_.operation === undefined ? {} : { operation: arguments_.operation }),
      ...(operationInput === undefined ? {} : { operationInput }),
    }
    const out = arguments_.out
    const receipt = await executeCommandRequest(
      runtime,
      commandRequest(arguments_.command, input),
      {
        openSubject: commandSubjectsFrom(opener),
        ...(out === undefined
          ? {}
          : {
              writeOutput: async (_name: string, bytes: Uint8Array) => {
                await writeFile(resolve(out), bytes)
                return resolve(out)
              },
            }),
        // Progress goes to stderr so `--format json` on stdout stays a single parseable document.
        ...(arguments_.format === 'text'
          ? { progress: step => writeStderr(`… ${step.message}\n`) }
          : {}),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    )
    writeStdout(
      arguments_.format === 'protocol-json'
        ? renderCommandReceipt(receipt)
        : renderCommandResult(receipt.result, arguments_.format === 'json'),
    )
    return exitCodeFor(receipt.result)
  } catch (error) {
    writeStderr(`modkit run: ${(error as Error).message}\n`)
    return 2
  }
}

/**
 * `subject.edit` opens through the library facade, the one Node composition that owns an editing
 * surface: the named file's directory is the only writable root, and only with `--commit`. The
 * command itself is the shared host handler every other application runs.
 */
async function runEditCommand(
  arguments_: RunArguments,
  file: string,
  operationInput: JsonValue | undefined,
  runtime: ReturnType<typeof createCommandRuntime>,
  writeStdout: (text: string) => void,
  writeStderr: (text: string) => void,
  options: RunCommandOptions,
): Promise<number> {
  const roots = arguments_.roots.map(root => resolve(root))
  const directory = dirname(file)
  const modkit = await createModkit({
    modules: [sceneModule, uvModule],
    extensions: [],
    ...(arguments_.trust ? { trustedExtensions: roots } : { userExtensions: roots }),
    roots: [directory],
    // Mutating operations need write-source in the open grant even to be planned.
    writableRoots: [directory],
    intent: 'inspect',
    // The facade's lab default is too small for large game extensions, which then claim nothing.
    policy: workerBackendPolicy({
      resourceLimits: { maxOldGenerationSizeMb: 2_048, maxYoungGenerationSizeMb: 256 },
      loadDeadlineMs: 120_000,
      defaultCallDeadlineMs: 120_000,
    }),
  })
  try {
    if (modkit.extensionFailures.length > 0) {
      writeStderr(
        `modkit run: ${modkit.extensionFailures.length} extension root(s) failed to load\n`,
      )
      return 2
    }
    const receipt = await executeCommandRequest(
      runtime,
      commandRequest(arguments_.command, {
        subject: file,
        ...(arguments_.operation === undefined ? {} : { operation: arguments_.operation }),
        ...(operationInput === undefined ? {} : { operationInput }),
        commit: arguments_.commit === true,
      }),
      {
        openSubject: async (ref, signal) => {
          const opened = await modkit.open(ref, signal)
          return {
            ref,
            snapshot: opened.snapshot,
            ...(opened.session === undefined ? {} : { session: opened.session }),
            ...(opened.editing === undefined ? {} : { editing: opened.editing }),
            dispose: () => opened.close(),
          }
        },
        ...(arguments_.format === 'text'
          ? { progress: step => writeStderr(`… ${step.message}\n`) }
          : {}),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    )
    writeStdout(
      arguments_.format === 'protocol-json'
        ? renderCommandReceipt(receipt)
        : renderCommandResult(receipt.result, arguments_.format === 'json'),
    )
    return exitCodeFor(receipt.result)
  } finally {
    await modkit.close()
  }
}
