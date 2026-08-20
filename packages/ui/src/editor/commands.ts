/** A host asks the mounted editor for the save operation it already owns. */
export const EDITOR_SAVE_REQUEST = 'modkit-editor-save-request'

export interface EditorSaveRequestDetail {
  waitUntil(operation: Promise<boolean>): void
}

/** Register one editor's save command and return the matching cleanup. */
export function handleEditorSaveRequest(
  root: HTMLElement,
  save: () => Promise<boolean>,
): () => void {
  const listener = (event: Event): void => {
    const request = event as CustomEvent<EditorSaveRequestDetail>
    request.detail.waitUntil(save())
  }
  root.addEventListener(EDITOR_SAVE_REQUEST, listener)
  return () => root.removeEventListener(EDITOR_SAVE_REQUEST, listener)
}

/**
 * Ask the editor mounted below `host` to save.
 *
 * `undefined` means the current stage has no editor-owned buffer, so the host may fall back to its
 * ordinary editing port. A boolean is the editor's authoritative success/refusal answer.
 */
export async function requestEditorSave(host: HTMLElement): Promise<boolean | undefined> {
  const editor = host.querySelector<HTMLElement>('[data-modkit-editor]')
  if (editor === null) return undefined
  let operation: Promise<boolean> | undefined
  const detail: EditorSaveRequestDetail = {
    waitUntil(next) {
      if (operation !== undefined) throw new Error('an editor answered the save request twice')
      operation = next
    },
  }
  editor.dispatchEvent(new CustomEvent(EDITOR_SAVE_REQUEST, { detail }))
  return operation === undefined ? undefined : operation
}
