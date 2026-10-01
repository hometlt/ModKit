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

/** An editor tells its host it made one undoable change; the event bubbles from its root. */
export const EDITOR_EDITED_EVENT = 'modkit-editor-edited'

/** A host asks the mounted editor to step its own history back or forward. */
export const EDITOR_HISTORY_REQUEST = 'modkit-editor-history-request'

export interface EditorHistoryRequestDetail {
  readonly direction: 'undo' | 'redo'
  answer(done: boolean): void
}

/** Announce one undoable change, so a host with an undo stack (VS Code) records a step. */
export function announceEditorEdit(root: HTMLElement): void {
  root.dispatchEvent(new CustomEvent(EDITOR_EDITED_EVENT, { bubbles: true }))
}

/** Register one editor's undo and redo and return the matching cleanup. */
export function handleEditorHistoryRequest(
  root: HTMLElement,
  history: { undo(): boolean; redo(): boolean },
): () => void {
  const listener = (event: Event): void => {
    const request = event as CustomEvent<EditorHistoryRequestDetail>
    request.detail.answer(request.detail.direction === 'undo' ? history.undo() : history.redo())
  }
  root.addEventListener(EDITOR_HISTORY_REQUEST, listener)
  return () => root.removeEventListener(EDITOR_HISTORY_REQUEST, listener)
}

/**
 * Ask the editor mounted below `host` to undo or redo. `undefined`: no mounted editor keeps a
 * history, so the host may ask whatever else owns the pending edit.
 */
export function requestEditorHistory(
  host: ParentNode,
  direction: 'undo' | 'redo',
): boolean | undefined {
  const editor = host.querySelector<HTMLElement>('[data-modkit-editor]')
  if (editor === null) return undefined
  let done: boolean | undefined
  const detail: EditorHistoryRequestDetail = {
    direction,
    answer(value) {
      done = value
    },
  }
  editor.dispatchEvent(new CustomEvent(EDITOR_HISTORY_REQUEST, { detail }))
  return done
}
