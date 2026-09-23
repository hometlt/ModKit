import * as vscode from 'vscode'
import { isCancellation } from '@modkit/core'
import type { UiLocalizer } from '@modkit/ui/localization'
import type { LanguageSessionController } from './language-session.js'

/** Native command over the shared language diagnostics contract; providers own all format rules. */
export function registerDocumentVerification(
  controller: LanguageSessionController,
  localizer: UiLocalizer,
): vscode.Disposable {
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
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.commands.registerCommand('modkit.verifyDocument', async () => {
      const document = vscode.window.activeTextEditor?.document
      if (document === undefined || !controller.supports(document)) {
        void vscode.window.showInformationMessage(localizer.text('vscode.verify.unavailable'))
        return undefined
      }
      const snapshot = {
        uri: document.uri.toString(),
        fileName: document.fileName,
        languageId: document.languageId,
        version: document.version,
        text: document.getText(),
      }
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
