/**
 * Types for the codec registry.
 *
 * The registry itself is plain JavaScript because the codec extensions ship as untyped `.js` and
 * this app is inside `tsc -b`: importing them from a `.ts` file would fail with TS7016 on every
 * entrypoint. Declaring the registry's shape here keeps the boundary typed without pretending the
 * extensions have declarations they do not have.
 */
import type { PreviewFormat, PreviewStage } from '@modkitx-x3/ui'
import type { ViewerModule } from '@modkitx-x3/sdk'

export declare const PREVIEW_FORMATS: readonly PreviewFormat[]
export declare const PREVIEW_STAGES: readonly PreviewStage[]
export declare const PREVIEW_FALLBACK: {
  readonly text: ViewerModule
  readonly hex: ViewerModule
}
