import * as vscode from 'vscode'
import { isCancellation } from '@modkit/core'
import type { UiLocalizer } from '@modkit/ui/localization'
import type { EditorLanguageDiagnostic, LanguageSessionController } from './language-session.js'

/** Native commands over the shared language diagnostics contract; providers own all format rules. */
export function registerDocumentVerification(
  controller: LanguageSessionController,
  localizer: UiLocalizer,
  /** The same drawing of a provider diagnostic the live Problems entries get. */
  nativeDiagnostic: (item: EditorLanguageDiagnostic) => vscode.Diagnostic,
  log?: (message: string) => void,
): vscode.Disposable {
  /*
   * «Verify Mod»: the files of the mod nobody has open, analyzed once when asked (core 57ce1bfc).
   * They stay apart from the live diagnostics; a file that opens takes its own live ones instead.
   */
  const project = vscode.languages.createDiagnosticCollection('modkit-project')
  const snapshotOf = (document: vscode.TextDocument) => ({
    uri: document.uri.toString(),
    fileName: document.fileName,
    languageId: document.languageId,
    version: document.version,
    text: document.getText(),
  })
  const refresh = (): void => {
    const document = vscode.window.activeTextEditor?.document
    void vscode.commands.executeCommand(
      'setContext',
      'modkit.canVerifyDocument',
      document !== undefined && controller.supports(document),
    )
  }
  refresh()
  return vscode.Disposable.from(
    project,
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidOpenTextDocument(document => project.delete(document.uri)),
    vscode.commands.registerCommand('modkit.verifyMod', async () => {
      const document = vscode.window.activeTextEditor?.document
      if (document === undefined || !controller.supports(document)) {
        void vscode.window.showInformationMessage(localizer.text('vscode.verify.unavailable'))
        return undefined
      }
      const snapshot = snapshotOf(document)
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: localizer.text('vscode.verifyMod.title'),
            cancellable: true,
          },
          async (_progress, token) => {
            const abort = new AbortController()
            if (token.isCancellationRequested) abort.abort()
            const subscription = token.onCancellationRequested(() => abort.abort())
            try {
              return await controller.projectDiagnostics(snapshot, abort.signal)
            } finally {
              subscription.dispose()
            }
          },
        )
        if (result === undefined) {
          void vscode.window.showWarningMessage(localizer.text('vscode.verify.unresolved'))
          return undefined
        }
        project.clear()
        const open = new Set(vscode.workspace.textDocuments.map(item => item.uri.toString()))
        let count = 0
        for (const entry of result.documents) {
          if (open.has(entry.uri)) continue
          project.set(vscode.Uri.parse(entry.uri), entry.diagnostics.map(nativeDiagnostic))
          count += entry.diagnostics.length
        }
        if (count > 0) await vscode.commands.executeCommand('workbench.actions.view.problems')
        const message = localizer.text(
          result.isIncomplete ? 'vscode.verifyMod.incomplete' : 'vscode.verifyMod.complete',
          { documents: result.documents.length, count },
        )
        if (result.isIncomplete) void vscode.window.showWarningMessage(message)
        else void vscode.window.showInformationMessage(message)
        return result
      } catch (error) {
        log?.(
          `[language] Verify Mod ${snapshot.uri} failed: ${error instanceof Error ? error.message : String(error)}${error instanceof Error && error.cause !== undefined ? ` (${String(error.cause)})` : ''}`,
        )
        if (!isCancellation(error)) {
          void vscode.window.showErrorMessage(
            localizer.text('vscode.verify.failed', {
              message: error instanceof Error ? error.message : String(error),
            }),
          )
        }
        return undefined
      }
    }),
    vscode.commands.registerCommand('modkit.verifyDocument', async () => {
      const document = vscode.window.activeTextEditor?.document
      if (document === undefined || !controller.supports(document)) {
        void vscode.window.showInformationMessage(localizer.text('vscode.verify.unavailable'))
        return undefined
      }
      const snapshot = snapshotOf(document)
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: localizer.text('vscode.verify.title'),
            cancellable: true,
          },
          async (_progress, token) => {
            const abort = new AbortController()
            if (token.isCancellationRequested) abort.abort()
            const subscription = token.onCancellationRequested(() => abort.abort())
            try {
              return await controller.verify(snapshot, abort.signal)
            } finally {
              subscription.dispose()
            }
          },
        )
        if (document.isClosed || document.version !== snapshot.version) return undefined
        if (result === undefined) {
          void vscode.window.showWarningMessage(localizer.text('vscode.verify.unresolved'))
          return undefined
        }
        if (result.diagnostics.length > 0) {
          await vscode.commands.executeCommand('workbench.actions.view.problems')
        }
        const message = result.isIncomplete
          ? localizer.text('vscode.verify.incomplete', { count: result.diagnostics.length })
          : localizer.text('vscode.verify.complete', { count: result.diagnostics.length })
        if (result.isIncomplete) void vscode.window.showWarningMessage(message)
        else void vscode.window.showInformationMessage(message)
        return result
      } catch (error) {
        log?.(
          `[language] Verify ${snapshot.uri} failed: ${error instanceof Error ? error.message : String(error)}${error instanceof Error && error.cause !== undefined ? ` (${String(error.cause)})` : ''}`,
        )
        if (!isCancellation(error)) {
          void vscode.window.showErrorMessage(
            localizer.text('vscode.verify.failed', {
              message: error instanceof Error ? error.message : String(error),
            }),
          )
        }
        return undefined
      }
    }),
  )
}
