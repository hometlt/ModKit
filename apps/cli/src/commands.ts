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
  type SubjectOpener,
} from '@modkit/host'
import {
  coordinateMapPreviewAssetSession,
  MAP_PREVIEW_COORDINATOR_LIMITS,
  withMapPreviewSources,
} from '@modkit/host/maps'
import {
  createModkit,
  createNodeMapPreviewResourcePlanResolver,
  createPathSubjectOpener,
  DEFAULT_SUBJECT_OPEN_BUDGET,
  loadExtensionDirectory,
  type NodeSubjectServices,
} from '@modkit/host/node'
import { sceneModule } from '@modkit/scene/module'
import { uvModule } from '@modkit/uv/module'
import { createModkitCliSubjectServices, modkitCliCredentials } from './profile.js'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import type { JsonValue, ResourceBudget } from '@modkit/sdk'

export const RUN_USAGE =
  'usage: modkit run <command> <file> --ext <dir> [--ext <dir>...] [--entry <path>] ' +
  '[--target <id>] [--operation <id>] [--input <json-file>] [--commit] [--out <file>] ' +
  '[--max-input-bytes <n|nKiB|nMiB|nGiB>] [--trust] [--format text|json|protocol-json]\n'

/**
 * A `--max-input-bytes` value: bytes, or a whole number of KiB, MiB or GiB (`512MiB`, `4GiB`).
 * It bounds what one open materializes in memory — one read, one entry — not the file's size;
 * a codec's own manifest budget still caps it.
 */
export function parseByteSize(text: string | undefined): bigint | undefined {
  const match = /^(\d+)(KiB|MiB|GiB)?$/u.exec(text ?? '')
  if (match === null) return undefined
  const unit = { KiB: 1n << 10n, MiB: 1n << 20n, GiB: 1n << 30n }[match[2] ?? ''] ?? 1n
  const bytes = BigInt(match[1] as string) * unit
  return bytes > 0n ? bytes : undefined
}

// ponytail: fixed limits of a UVW export (4096² terrain cells, 256 MiB); a flag when a map needs more
const WORLD_UVW_LIMITS = Object.freeze({
  maxPageItems: 4096,
  maxTerrainItems: 4096 * 4096,
  maxFacetItems: 4096 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
})

/**
 * Opens a map together with the world its preview builds (MCP opens maps the same way), so that
 * `subject.convert --target uvw` finds it; anything that is no map opens as before. A package of
 * several maps (a campaign, `mp.wz`) needs one named with `--entry`, by candidate id or path.
 */
function withMapWorld(
  opener: SubjectOpener,
  services: NodeSubjectServices,
  budgets: ResourceBudget,
  entry: string | undefined,
): SubjectOpener {
  const resourcePlanResolver = createNodeMapPreviewResourcePlanResolver({ subjects: services })
  return async (path, signal) => {
    const opened = await opener(path, signal)
    const original = opened.session
    if (opened.snapshot.state !== 'opened' || original === undefined) return opened
    const coordinate = (selectionId?: string) =>
      coordinateMapPreviewAssetSession({
        services,
        grant: { id: 'modkit-cli-map-preview', classes: ['read-source', 'filesystem-read'] },
        budgets,
        original,
        resourcePlanResolver,
        ...MAP_PREVIEW_COORDINATOR_LIMITS,
        ...(selectionId === undefined ? {} : { selectionId }),
        ...(signal === undefined ? {} : { signal }),
      })
    let preview = await coordinate()
    if (preview.state === 'selection-required') {
      const { candidates } = preview
      const chosen =
        entry === undefined && candidates.length === 1
          ? candidates[0]
          : candidates.find(item => item.candidateId === entry || item.sourcePath === entry)
      if (chosen === undefined) {
        await original.dispose()
        throw new Error(
          `${path} holds ${candidates.length} maps; name one with --entry: ` +
            candidates.map(item => item.sourcePath ?? item.candidateId).join(', '),
        )
      }
      preview = await coordinate(chosen.candidateId)
    }
    return preview.state === 'opened'
      ? { ...opened, session: withMapPreviewSources(original, preview.session) }
      : opened
  }
}

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
  /** Raises the open budget's `maxInputBytes` above the CLI default (not for `subject.edit`). */
  readonly maxInputBytes?: bigint
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
  let maxInputBytes: bigint | undefined
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
    } else if (argument === '--max-input-bytes') {
      maxInputBytes = parseByteSize(value(index + 1))
      if (maxInputBytes === undefined) return undefined
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
  // `subject.edit` opens through its own editing host; a budget flag there would be silently ignored.
  if (maxInputBytes !== undefined && command === SUBJECT_EDIT_COMMAND) return undefined
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
    ...(maxInputBytes === undefined ? {} : { maxInputBytes }),
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
    const budget =
      arguments_.maxInputBytes === undefined
        ? DEFAULT_SUBJECT_OPEN_BUDGET
        : { ...DEFAULT_SUBJECT_OPEN_BUDGET, maxInputBytes: arguments_.maxInputBytes }
    const pathOpener = createPathSubjectOpener({
      subjects: services,
      // A named file is the CLI's whole grant: it opens what argv points at, and its companions
      // beside it. Nothing is discovered, which is the CLI profile's own limit (§4.1).
      roots: [dirname(file)],
      grant: { id: 'modkit-cli', classes: ['read-source'] },
      budget,
    })
    // A native map publishes its world through the host's map preview, as VS Code and MCP open it.
    const opener =
      arguments_.command === 'subject.convert' && arguments_.target === 'uvw'
        ? withMapWorld(pathOpener, services, budget, arguments_.entry)
        : pathOpener
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
              // A member bigger than memory arrives in chunks and goes to disk as it comes.
              writeOutputStream: async (
                _name: string,
                chunks: AsyncIterable<Uint8Array>,
                signal?: AbortSignal,
              ) => {
                await writeFile(resolve(out), chunks, signal === undefined ? {} : { signal })
                return resolve(out)
              },
            }),
        // Progress goes to stderr so `--format json` on stdout stays a single parseable document.
        ...(arguments_.format === 'text'
          ? { progress: step => writeStderr(`… ${step.message}\n`) }
          : {}),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        // `subject.convert --target uvw` of a map: the world it publishes, as one UVW document
        worldToUvw: async (source, signal) => {
          const { materializeWorldToUvw } = await import('@modkit/uv/world')
          return materializeWorldToUvw(source, {
            ...WORLD_UVW_LIMITS,
            ...(signal === undefined ? {} : { signal }),
          })
        },
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
    credentials: modkitCliCredentials(),
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
