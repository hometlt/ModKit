/**
 * Convert every file of a folder through its codec's own conversion (plan 7.12, MK2's batch convert).
 *
 * Nothing here knows a format: each file opens as a subject, its codec's `export.convert` presets are
 * the ones the Export section offers (`exportConversions`), and the one that writes the extension
 * the reader asked for runs. A file with no such conversion is skipped and said so in the report.
 */
import type { AnyDescriptor, JsonValue, OperationSession } from '@modkit/sdk'

/** Most files one run takes, so a folder of a whole game cannot run for an afternoon unasked. */
export const BATCH_CONVERT_MAX_FILES = 2_000

export interface BatchConversion {
  readonly form: {
    readonly id?: string
    readonly handlerId: string
    readonly label: string
    readonly writes: { readonly extension: string; readonly mediaType: string }
  }
  readonly input: JsonValue
}

/** The preset writing `extension` (no dot, any case), the codec's first when several do. */
export function batchConversionFor<Conversion extends BatchConversion>(
  conversions: readonly Conversion[],
  extension: string,
): Conversion | undefined {
  const wanted = extension.replace(/^\./u, '').toLowerCase()
  return conversions.find(
    item => item.form.writes.extension.replace(/^\./u, '').toLowerCase() === wanted,
  )
}

/** `dir/name.dds` → `dir/name.png`: the source's place in the folder, its stem, the new extension. */
export function batchOutputPath(relative: string, extension: string): string {
  const slash = relative.lastIndexOf('/')
  const name = relative.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  return `${relative.slice(0, slash + 1)}${stem}.${extension.replace(/^\./u, '')}`
}

export type BatchOutcome =
  | { readonly state: 'converted'; readonly file: string; readonly output: string }
  | { readonly state: 'skipped' | 'failed'; readonly file: string; readonly reason: string }

export interface BatchSubject {
  readonly descriptor?: AnyDescriptor
  readonly operations?: OperationSession
  readonly reason?: string
  dispose(): Promise<void>
}

/**
 * Run the conversion over `files` (paths relative to the folder) one at a time: open, pick the
 * preset, invoke, write. Stops between files when `signal` aborts.
 */
export async function runBatchConversion(options: {
  readonly files: readonly string[]
  readonly extension: string
  readonly open: (file: string, signal: AbortSignal) => Promise<BatchSubject>
  readonly conversions: (descriptor: AnyDescriptor) => readonly BatchConversion[]
  readonly write: (output: string, bytes: Uint8Array) => Promise<string>
  readonly progress?: (done: number, file: string) => void
  readonly signal: AbortSignal
  /** The preset to run, by id: one of several writing the extension (a DDS's encodings). */
  readonly formId?: string
  /** Where a file's result goes; by default its own place with the new extension. */
  readonly outputPath?: (file: string, conversion: BatchConversion) => string
}): Promise<readonly BatchOutcome[]> {
  const outcomes: BatchOutcome[] = []
  for (const [index, file] of options.files.entries()) {
    if (options.signal.aborted) break
    options.progress?.(index, file)
    let subject: BatchSubject | undefined
    try {
      subject = await options.open(file, options.signal)
      // cancelled while it opened: this file is not converted either
      if (options.signal.aborted) break
      if (subject.descriptor === undefined || subject.operations === undefined) {
        outcomes.push({ state: 'skipped', file, reason: subject.reason ?? 'no codec opened it' })
        continue
      }
      const conversions = options.conversions(subject.descriptor)
      const conversion =
        options.formId === undefined
          ? batchConversionFor(conversions, options.extension)
          : conversions.find(item => item.form.id === options.formId)
      if (conversion === undefined) {
        outcomes.push({ state: 'skipped', file, reason: `no conversion to .${options.extension}` })
        continue
      }
      const result = await subject.operations.invoke(conversion.form.handlerId, conversion.input, {
        signal: options.signal,
      })
      if (result.state !== 'ok') {
        outcomes.push({ state: 'failed', file, reason: result.reason })
        continue
      }
      const output = result.output as { readonly kind: string; readonly value?: unknown }
      if (output.kind !== 'bytes' || !(output.value instanceof Uint8Array)) {
        outcomes.push({
          state: 'failed',
          file,
          reason: `the codec answered ${output.kind}, not bytes`,
        })
        continue
      }
      const written = await options.write(
        options.outputPath?.(file, conversion) ??
          batchOutputPath(file, conversion.form.writes.extension),
        output.value,
      )
      outcomes.push({ state: 'converted', file, output: written })
    } catch (error) {
      if (options.signal.aborted) break
      outcomes.push({
        state: 'failed',
        file,
        reason: error instanceof Error ? error.message : String(error),
      })
    } finally {
      await subject?.dispose().catch(() => undefined)
    }
  }
  return outcomes
}
