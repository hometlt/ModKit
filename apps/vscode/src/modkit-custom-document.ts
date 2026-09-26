/** The custom document VS Code holds for a file Modkit opens. */
import * as vscode from 'vscode'

import { CustomDocumentState } from './custom-document.js'
import { subjectPathOf } from './subject-uris.js'

export const BACKSLASH = String.fromCharCode(92)

export class ModkitCustomDocument implements vscode.CustomDocument {
  readonly state: CustomDocumentState
  /** A remote content source has nothing to save into; a container member saves into its container. */
  readonly readOnly: boolean

  constructor(
    readonly uri: vscode.Uri,
    forceReadOnly = false,
  ) {
    this.state = new CustomDocumentState(subjectPathOf(uri))
    this.readOnly = forceReadOnly || uri.scheme === 'modkit-source'
  }

  dispose(): void {
    // The resolved panel owns the bridge session and detaches it from `state` on disposal.
  }
}
