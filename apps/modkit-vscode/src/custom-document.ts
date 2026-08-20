/** The webview operations a native VS Code custom document delegates to. */
export interface CustomDocumentSession {
  saveDocument(path: string): Promise<void>
  revertDocument(path: string): Promise<void>
}

export type DirtyTransition = 'became-dirty' | 'became-clean' | 'unchanged'

/**
 * DOM- and vscode-free state machine behind the provider adapter.
 *
 * VS Code owns the title marker and Ctrl+S; the webview still owns the mounted editor buffer. This
 * object is the narrow rendezvous between them and makes the transition rules testable in Node.
 */
export class CustomDocumentState {
  private session: CustomDocumentSession | undefined
  private dirty = false

  constructor(readonly path: string) {}

  get isDirty(): boolean {
    return this.dirty
  }

  attach(session: CustomDocumentSession): void {
    this.session = session
  }

  markDirty(next: boolean): DirtyTransition {
    if (this.dirty === next) return 'unchanged'
    this.dirty = next
    return next ? 'became-dirty' : 'became-clean'
  }

  async save(): Promise<void> {
    const session = this.session
    if (session === undefined) throw new Error('the custom document has no resolved webview')
    await session.saveDocument(this.path)
    this.dirty = false
  }

  async revert(): Promise<void> {
    const session = this.session
    if (session === undefined) throw new Error('the custom document has no resolved webview')
    await session.revertDocument(this.path)
    this.dirty = false
  }

  detach(session: CustomDocumentSession): void {
    if (this.session === session) this.session = undefined
  }
}
