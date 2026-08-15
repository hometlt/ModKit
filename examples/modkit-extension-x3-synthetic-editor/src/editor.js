import { createTextEditorModule } from '@modkitx-x3/ui/editor'

export const syntheticEditor = createTextEditorModule({ maximumSourceBytes: 16 * 1024 * 1024 })

export default syntheticEditor
