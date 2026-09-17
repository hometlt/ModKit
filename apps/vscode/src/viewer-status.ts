/**
 * Native status bar items for a mounted viewer (zoom, channel, dimensions, format, size).
 *
 * The page publishes items through its `ViewerStatusPort`; the extension draws them as VS Code
 * status bar entries while that editor is the active one, the way MK2's texture viewer did. An
 * item with choices becomes a button that opens a quick pick and reports the pick back to the page.
 */
import * as vscode from 'vscode'

export interface ViewerStatusBarItem {
  readonly id: string
  readonly text: string
  readonly tooltip?: string
  readonly align?: 'start' | 'end'
  readonly choices?: readonly { readonly id: string; readonly label: string }[]
  readonly selected?: string
  /** Codicon name; VS Code's own status bar spells it `$(name)`. */
  readonly icon?: string
  /** No choice list: one click runs the viewer's action, reported as an empty choice id. */
  readonly action?: boolean
}

type Choose = (itemId: string, choiceId: string) => void

export const VIEWER_STATUS_CHOOSE_COMMAND = 'modkit.viewerStatusChoose'

export interface ViewerStatusBar extends vscode.Disposable {
  set(key: string, items: readonly ViewerStatusBarItem[], choose: Choose): void
  /** The editor in front; `undefined` when no Modkit editor is. */
  setActive(key: string | undefined): void
  remove(key: string): void
}

/** Right-aligned priorities just left of VS Code's own language/encoding entries. */
const BASE_PRIORITY = 180

export function createViewerStatusBar(): ViewerStatusBar {
  const entries = new Map<string, { items: readonly ViewerStatusBarItem[]; choose: Choose }>()
  let active: string | undefined
  let shown: vscode.StatusBarItem[] = []

  const render = (): void => {
    for (const item of shown) item.dispose()
    shown = []
    const entry = active === undefined ? undefined : entries.get(active)
    if (entry === undefined || active === undefined) return
    // Identity first, controls last, reading left to right.
    const ordered = [
      ...entry.items.filter(item => item.align !== 'end'),
      ...entry.items.filter(item => item.align === 'end'),
    ]
    ordered.forEach((item, index) => {
      const bar = vscode.window.createStatusBarItem(
        `modkit.viewer.${item.id}`,
        vscode.StatusBarAlignment.Right,
        BASE_PRIORITY - index,
      )
      bar.name = item.tooltip ?? item.id
      const glyph = item.icon === undefined ? '' : `$(${item.icon}) `
      const menu = item.choices !== undefined && item.choices.length > 0
      bar.text = `${glyph}${item.text}${menu ? ' $(chevron-down)' : ''}`
      if (item.tooltip !== undefined) bar.tooltip = item.tooltip
      if (menu || item.action === true) {
        bar.command = {
          title: item.tooltip ?? item.id,
          command: VIEWER_STATUS_CHOOSE_COMMAND,
          arguments: [active, item.id],
        }
      }
      bar.show()
      shown.push(bar)
    })
  }

  const command = vscode.commands.registerCommand(
    VIEWER_STATUS_CHOOSE_COMMAND,
    async (key: unknown, itemId: unknown) => {
      if (typeof key !== 'string' || typeof itemId !== 'string') return
      const entry = entries.get(key)
      const item = entry?.items.find(candidate => candidate.id === itemId)
      if (entry === undefined || item === undefined) return
      // An action item has no menu: the click itself is the whole message.
      if (item.choices === undefined || item.choices.length === 0) {
        if (item.action === true) entry.choose(itemId, '')
        return
      }
      const picked = await vscode.window.showQuickPick(
        item.choices.map(choice => ({
          label: choice.label,
          id: choice.id,
          ...(choice.id === item.selected ? { description: '$(check)' } : {}),
        })),
        { placeHolder: item.tooltip ?? item.text },
      )
      if (picked !== undefined) entry.choose(itemId, picked.id)
    },
  )

  return {
    set(key, items, choose) {
      entries.set(key, { items, choose })
      if (key === active) render()
    },
    setActive(key) {
      if (key === active) return
      active = key
      render()
    },
    remove(key) {
      entries.delete(key)
      if (key === active) {
        active = undefined
        render()
      }
    },
    dispose() {
      for (const item of shown) item.dispose()
      shown = []
      entries.clear()
      command.dispose()
    },
  }
}
