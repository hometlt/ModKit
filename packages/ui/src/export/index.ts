/**
 * The codec's conversions of the subject on show, as a sidebar section any media view can carry.
 *
 * Each `export.convert` preset that names what it writes becomes a button: the codec answers with
 * the bytes and the host writes the file. Image and model views draw their own conversions; this is
 * the same offer for audio, video and anything else, so a WEM exports to WAV the way a DDS exports
 * to PNG. Nothing here knows a format.
 */
import type { AnyDescriptor, JsonValue, ViewerModule } from '@modkit/sdk'
import { exportOffer, type EditOperationForm } from '../field-editor/index.js'
import {
  convertedFileName,
  exportSafeName,
  type ImageExportFile,
  type ImageExportOutcome,
} from '../image/index.js'
import { EXPORT_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import type { UiLocalizer } from '../localization/index.js'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  ViewerMountScope,
} from '../viewer/index.js'

export interface ExportSectionOptions {
  readonly localizer?: UiLocalizer
  /** How this host writes the converted files; absent leaves the buttons off with the reason. */
  readonly exportBytes?: (
    files: readonly ImageExportFile[],
    signal?: AbortSignal,
  ) => Promise<ImageExportOutcome>
  /** Base name of the written files; the host usually supplies the subject's name. */
  readonly exportBaseName?: (descriptor: AnyDescriptor) => string
}

interface Conversion {
  readonly form: EditOperationForm & { readonly writes: NonNullable<EditOperationForm['writes']> }
  readonly input: JsonValue
}

/** The presets that name a file to write; a form without a target is not a conversion. */
export function exportConversions(descriptor: AnyDescriptor): readonly Conversion[] {
  return exportOffer(descriptor).flatMap(form => {
    const writes = form.writes
    if (writes === undefined) return []
    try {
      return [{ form: { ...form, writes }, input: form.build(new Map()) }]
    } catch {
      return []
    }
  })
}

export function createExportSection(options: ExportSectionOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, EXPORT_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      // A subject with nothing to convert has no section: the shell removes one that cannot mount.
      if (exportConversions(args.descriptor).length === 0) {
        throw new TypeError('the codec publishes no conversions for this subject')
      }
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.export'))
      const render = ({ descriptor }: { readonly descriptor: AnyDescriptor }): void => {
        root.replaceChildren()
        const actions = element(root, 'div', { part: 'form.actions' })
        const status = element(root, 'p', { part: 'form.status', role: 'status' })
        const write = options.exportBytes
        for (const conversion of exportConversions(descriptor)) {
          const button = element(actions, 'button', {
            part: 'form.button',
            text: conversion.form.label,
          }) as HTMLButtonElement
          button.title =
            write === undefined ? localizer.text('viewer.exportNoWriter') : conversion.form.summary
          button.disabled = write === undefined
          button.addEventListener('click', () => {
            if (write === undefined) return
            button.disabled = true
            setViewerText(
              status,
              localizer.text('viewer.exportRunning', { format: conversion.form.label }),
            )
            void convert(descriptor, conversion, write)
              .then(
                name => setViewerText(status, localizer.text('viewer.exportDone', { name })),
                error =>
                  setViewerText(
                    status,
                    localizer.text('viewer.exportRefused', {
                      reason: error instanceof Error ? error.message : String(error),
                    }),
                  ),
              )
              .finally(() => {
                button.disabled = false
              })
          })
        }
      }

      const convert = async (
        descriptor: AnyDescriptor,
        conversion: Conversion,
        write: NonNullable<ExportSectionOptions['exportBytes']>,
      ): Promise<string> => {
        const result = await args.operations.invoke(conversion.form.handlerId, conversion.input, {
          signal: scope.signal,
        })
        if (result.state !== 'ok') throw new Error(result.reason)
        const output = result.output as { readonly kind: string; readonly value?: unknown }
        if (output.kind !== 'bytes' || !(output.value instanceof Uint8Array)) {
          throw new Error(`the codec answered ${output.kind}, not bytes`)
        }
        const baseName = exportSafeName(options.exportBaseName?.(descriptor) ?? 'export')
        const { writes } = conversion.form
        const name = convertedFileName(baseName, conversion.form.id, writes.extension)
        const outcome = await write(
          [{ name, mediaType: writes.mediaType, bytes: output.value }],
          scope.signal,
        )
        if (outcome.state !== 'written') throw new Error(outcome.reason)
        return outcome.names[0] ?? name
      }

      render(args)
      return createViewerMount(root, scope, args, render)
    },
  })
}
