/**
 * `modkit run` — the CLI's argv adapter over the shared command runtime (block 13, works 4–6).
 *
 * There is deliberately no behaviour here. Everything this file does is turn argv into a
 * `CommandInput`, hand it to the runtime that Electron and VS Code call with the same arguments,
 * and turn the one structured answer into text or JSON. If a verb ever needs a decision made, that
 * decision belongs in `@modkitx-x3/host`'s command runtime where all three hosts inherit it —
 * exit-gate line 1 of block 13 is precisely the rule that this file must stay boring.
 *
 * The existing verbs (`validate` a directory, `explain`, `host-profile`, `create codec`) are
 * untouched and stay where they are: they are tooling about extensions, not commands about a
 * subject, and folding them into a subject-shaped runtime would have made both worse. `modkit open`
 * keeps its own output contract for the same reason its tests exist, and `modkit run subject.open`
 * is the same operation reached through the shared surface.
 */

import { dirname, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import {
  commandRequest,
  commandSubjectsFrom,
  createSubjectCommandRuntime,
  executeCommandRequest,
  type CommandInput,
  type CommandReceipt,
  type CommandResult,
  type ExtensionInput,
} from '@modkitx-x3/host'
import { createPathSubjectOpener, loadExtensionDirectory } from '@modkitx-x3/host/node'
import { createModkitCliSubjectServices } from './profile.js'

export const RUN_USAGE =
  'usage: modkit run <command> <file> --ext <dir> [--ext <dir>...] [--entry <path>] ' +
  '[--target <id>] [--out <file>] [--trust] [--format text|json|protocol-json]\n'

export type RunOutputFormat = 'text' | 'json' | 'protocol-json'

export interface RunArguments {
  readonly command: string
  readonly file: string
  readonly roots: readonly string[]
  readonly entry?: string
  readonly target?: string
  readonly out?: string
  readonly trust: boolean
  readonly format: RunOutputFormat
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
  let trust = false
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
    else if (argument === '--json') format = 'json'
    else return undefined
  }
  if (roots.length === 0) return undefined
  return {
    command,
    file: target,
    roots,
    ...(entry === undefined ? {} : { entry }),
    ...(convertTarget === undefined ? {} : { target: convertTarget }),
    ...(out === undefined ? {} : { out }),
    trust,
    format,
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

export async function runCommand(arguments_: RunArguments): Promise<number> {
  const runtime = createSubjectCommandRuntime()
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
      process.stdout.write(renderCommandReceipt(receipt))
      return exitCodeFor(receipt.result)
    }
    process.stderr.write(
      `modkit run: unknown command «${arguments_.command}»; this build has ` +
        `${runtime.descriptors.map(item => item.id).join(', ')}\n`,
    )
    return 2
  }
  try {
    const loaded = await Promise.all(
      arguments_.roots.map(root => loadExtensionDirectory(resolve(root))),
    )
    const extensions: readonly ExtensionInput[] = loaded.map(input => ({
      ...input,
      execution: { origin: 'linked', allowTrustedInProcess: arguments_.trust },
    }))
    const services = await createModkitCliSubjectServices(extensions)
    const file = resolve(arguments_.file)
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
          ? { progress: step => void process.stderr.write(`… ${step.message}\n`) }
          : {}),
      },
    )
    process.stdout.write(
      arguments_.format === 'protocol-json'
        ? renderCommandReceipt(receipt)
        : renderCommandResult(receipt.result, arguments_.format === 'json'),
    )
    return exitCodeFor(receipt.result)
  } catch (error) {
    process.stderr.write(`modkit run: ${(error as Error).message}\n`)
    return 2
  }
}
