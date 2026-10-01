import type { ByteRangeSource, ViewerModule } from '@modkit/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import type { UiLocalizer } from '../localization/index.js'
import { FONT_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

/** Largest font file the specimen loads; a larger one keeps its other views. */
export const FONT_MAXIMUM_BYTES = 32 * 1024 * 1024
/** MK2's waterfall, in CSS pixels. */
export const FONT_SPECIMEN_SIZES = Object.freeze([12, 16, 20, 28, 40, 56, 80])
/** The sets under the waterfall, each in the font at one size. */
const FONT_SETS = Object.freeze([
  ['viewer.fontLatin', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz'],
  ['viewer.fontCyrillic', 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ абвгдеёжзийклмнопрстуфхцчшщъыьэюя'],
  ['viewer.fontDigits', '0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?'],
] as const)

/** Each mount names its own face, so two open fonts never stand for each other. */
let faces = 0

export interface FontViewerOptions {
  readonly localizer?: UiLocalizer
}

/**
 * A font as text set in it (plan 7.26), as MK2's font preview had it.
 *
 * The file's own bytes become a `FontFace` of this page, so the browser decodes the font whatever
 * its outlines — TrueType, CFF, WOFF, WOFF2 — where the codec's glyph sheet draws `glyf` outlines
 * only. The reader's text runs down MK2's sizes, and the Latin, Cyrillic and digit sets follow.
 * Nothing is installed: the face lives as long as the view. A font the browser refuses says why.
 */
export function createFontViewer(options: FontViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, FONT_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.font'))
      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/byte-range-source',
      )
      if (lease === undefined) throw new TypeError('font binding is unavailable')
      scope.lease(lease)
      const source = lease.value as ByteRangeSource
      const status = element(root, 'output', { part: 'viewer.status' })
      const mounted = () =>
        createViewerMount(root, scope, args, ({ descriptor }) => {
          root.dataset['revision'] = descriptor.revision
        })

      const size = await source.size()
      if (size > BigInt(FONT_MAXIMUM_BYTES)) {
        setViewerText(
          status,
          localizer.text('viewer.fontTooLarge', { limit: FONT_MAXIMUM_BYTES / 1024 / 1024 }),
        )
        return mounted()
      }
      // a copy the face owns: the bytes a source returns may view a shared or pooled buffer
      const face = new FontFace(
        `modkit-font-${String(++faces)}`,
        new Uint8Array(await source.read(0n, Number(size), scope.signal)),
      )
      try {
        await face.load()
      } catch (error) {
        setViewerText(
          status,
          localizer.text('viewer.fontRefused', {
            reason: error instanceof Error ? error.message : String(error),
          }),
          1024,
        )
        return mounted()
      }
      const fonts = root.ownerDocument.fonts
      fonts.add(face)
      scope.cleanup(() => {
        fonts.delete(face)
      })

      const family = `"${face.family}"`
      const specimen = element(root, 'div', { part: 'font' })
      const toolbar = element(specimen, 'div', { part: 'font.toolbar' })
      const text = element(toolbar, 'input', { part: 'font.text' }) as HTMLInputElement
      text.type = 'text'
      text.value = localizer.text('viewer.fontSample')
      text.setAttribute('aria-label', localizer.text('viewer.fontText'))
      const samples: HTMLElement[] = []
      for (const pixels of FONT_SPECIMEN_SIZES) {
        const row = element(specimen, 'div', { part: 'font.row' })
        element(row, 'span', { part: 'font.size', text: `${String(pixels)}px` })
        const sample = element(row, 'span', { part: 'font.sample', text: text.value })
        sample.style.fontFamily = family
        sample.style.fontSize = `${String(pixels)}px`
        samples.push(sample)
      }
      for (const [label, characters] of FONT_SETS) {
        element(specimen, 'h2', { part: 'font.heading', text: localizer.text(label) })
        element(specimen, 'div', { part: 'font.set', text: characters }).style.fontFamily = family
      }
      const retype = (): void => {
        for (const sample of samples) sample.textContent = text.value
      }
      text.addEventListener('input', retype)
      scope.cleanup(() => text.removeEventListener('input', retype))
      return mounted()
    },
  })
}

export const fontViewer: ViewerModule = createFontViewer()

export default fontViewer
