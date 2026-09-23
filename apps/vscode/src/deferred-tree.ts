/**
 * A native tree view's provider, registered before the extension host has composed anything.
 *
 * Composing reads and validates every extension root and takes seconds, and a view without a
 * provider says "There is no data provider registered that can provide view data" for that whole
 * time. This provider is registered first, shows one row while the host is composed, and then
 * hands every call to the view's real provider.
 */
import * as vscode from 'vscode'

export interface DeferredTreeDataProvider<T> extends vscode.TreeDataProvider<T> {
  /** Hand every call to `provider` from now on; disposing stops forwarding its changes. */
  resolve(provider: vscode.TreeDataProvider<T>): vscode.Disposable
  /** No provider is coming: show `message` instead of the loading row, or nothing at all. */
  settle(message?: string): void
}

export function deferredTreeDataProvider<T>(loadingLabel: string): DeferredTreeDataProvider<T> {
  const changed = new vscode.EventEmitter<T | T[] | undefined | null>()
  /** The loading row's element: an identity the real provider never produces. */
  const placeholder = Object.freeze({}) as T
  const loading = new vscode.TreeItem(loadingLabel)
  loading.iconPath = new vscode.ThemeIcon('loading~spin')
  let row: vscode.TreeItem | undefined = loading
  let real: vscode.TreeDataProvider<T> | undefined
  return {
    onDidChangeTreeData: changed.event,
    getTreeItem: element =>
      element === placeholder || real === undefined
        ? (row ?? new vscode.TreeItem(''))
        : real.getTreeItem(element),
    getChildren: element => {
      if (real !== undefined) return real.getChildren(element)
      return element === undefined && row !== undefined ? [placeholder] : []
    },
    getParent: element =>
      element === placeholder || real?.getParent === undefined ? undefined : real.getParent(element),
    resolveTreeItem: (item, element, token) =>
      element === placeholder || real?.resolveTreeItem === undefined
        ? item
        : real.resolveTreeItem(item, element, token),
    resolve(provider) {
      real = provider
      const forwarded = provider.onDidChangeTreeData?.(event =>
        changed.fire(event === undefined || event === null ? undefined : event),
      )
      changed.fire(undefined)
      return new vscode.Disposable(() => {
        forwarded?.dispose()
        changed.dispose()
      })
    },
    settle(message) {
      if (real !== undefined) return
      if (message === undefined) {
        row = undefined
      } else {
        row = new vscode.TreeItem(message)
        row.iconPath = new vscode.ThemeIcon('error')
      }
      changed.fire(undefined)
    },
  }
}
