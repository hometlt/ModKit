import type { PreviewStage } from '@modkit/ui'
import type { UiLocalizer } from '@modkit/ui/localization'
import type { ViewerModule } from '@modkit/sdk'

export declare const PREVIEW_STAGES: readonly PreviewStage[]
export declare const PREVIEW_STAGES_READONLY: readonly PreviewStage[]
export declare function createPreviewStages(localizer: UiLocalizer): readonly PreviewStage[]
export declare function createPreviewStagesReadonly(localizer: UiLocalizer): readonly PreviewStage[]
export declare const PREVIEW_FALLBACK: {
  readonly text: ViewerModule
  readonly hex: ViewerModule
}
export declare function createPreviewFallback(localizer: UiLocalizer): {
  readonly text: ViewerModule
  readonly hex: ViewerModule
}
