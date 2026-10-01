import { describe, expect, it } from 'vitest'
import {
  announceEditorEdit,
  EDITOR_EDITED_EVENT,
  handleEditorHistoryRequest,
  requestEditorHistory,
} from '../src/editor/commands.js'

describe('an editor history a host drives', () => {
  it('routes undo and redo to the mounted editor, and says when none keeps a history', () => {
    const editor = new EventTarget() as unknown as HTMLElement
    const host = { querySelector: () => editor } as unknown as ParentNode
    const steps: string[] = []
    let left = 1
    const remove = handleEditorHistoryRequest(editor, {
      undo: () => (left > 0 ? (steps.push('undo'), (left -= 1), true) : false),
      redo: () => (steps.push('redo'), (left += 1), true),
    })
    expect(requestEditorHistory(host, 'undo')).toBe(true)
    expect(requestEditorHistory(host, 'undo')).toBe(false)
    expect(requestEditorHistory(host, 'redo')).toBe(true)
    expect(steps).toEqual(['undo', 'redo'])
    remove()
    // an editor that keeps no history, and a page with no editor, leave the host its fallback
    expect(requestEditorHistory(host, 'undo')).toBeUndefined()
    expect(requestEditorHistory({ querySelector: () => null } as never, 'undo')).toBeUndefined()
  })

  it('announces each change as an event its host can count', () => {
    const editor = new EventTarget() as unknown as HTMLElement
    let edits = 0
    editor.addEventListener(EDITOR_EDITED_EVENT, () => {
      edits += 1
    })
    announceEditorEdit(editor)
    announceEditorEdit(editor)
    expect(edits).toBe(2)
  })
})
