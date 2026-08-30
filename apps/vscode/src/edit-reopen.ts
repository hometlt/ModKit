/** Structural seam around `EditorArea.close/open`, kept DOM-free for the webview contract test. */
export interface ReopenEntry {
  readonly id: string
  readonly name: string
  readonly directory: boolean
  readonly size?: number
}

export interface ReopenEditorArea {
  close(entryId: string): Promise<boolean>
  open(entry: ReopenEntry): Promise<void>
}

/** Close the stale revision, then open the same explorer entry on the revision now on disk. */
export async function reopenCommittedEntry(
  editors: ReopenEditorArea,
  entry: ReopenEntry,
): Promise<boolean> {
  if (!(await editors.close(entry.id))) return false
  await editors.open(entry)
  return true
}
