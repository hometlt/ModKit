/**
 * The webview's settings section: extensions and codecs, with switches that write real settings.
 *
 * The page holds no host and no configuration API. Every switch here sends a shell request and the
 * *extension side* performs the write — which is the honest path, because
 * `vscode.workspace.getConfiguration().update` exists only there, and a page that could reach it
 * would have become an extension host.
 *
 * Two things are always stated, never implied:
 *
 *  - **where the write lands** (`workspace` or `user` settings), because that decides who else
 *    sees it, and
 *  - **when it takes effect**. This extension host composes once at activation — the profile
 *    revision keys resolution caches — so a switch changes the *setting* now and the *running
 *    host* on the next window reload. A row whose setting and composition disagree says so.
 *
 * It also names the keys, because VS Code's own Settings UI edits exactly the same two and a user
 * who prefers that should not have to guess what this page is writing.
 */
import { element, safeViewerText, setPart, setState } from '@modkitx-x3/ui/viewer'

import type { ShellRequest, ShellSettingsView } from './bridge.js'

export interface SettingsViewOptions {
  /** Ask the extension side; it answers with a fresh `ShellSettingsView` after every write. */
  request(request: ShellRequest): Promise<unknown>
  /** One line for the page's own status area. */
  onStatus(message: string): void
}

export interface VsCodeSettingsView {
  readonly root: HTMLElement
  /** Draw a view the caller already has (the one that came back from a write, say). */
  setView(view: ShellSettingsView): void
  /** Ask for the current view and draw it. */
  reload(): Promise<void>
}

const CONTRACT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'org.modkitx/codec-contribution': 'codec',
  'org.modkitx/viewer-contribution': 'viewer',
  'org.modkitx/editor-contribution': 'editor',
  'org.modkitx/service-provider-contribution': 'service provider',
  'org.modkitx/contract-definition': 'contract definition',
  'org.modkitx/trait-definition': 'trait definition',
})

export function createVsCodeSettingsView(
  document: Document,
  options: SettingsViewOptions,
): VsCodeSettingsView {
  const root = document.createElement('div')
  root.className = 'vscode-host-panel'
  root.dataset['surface'] = 'settings'

  let view: ShellSettingsView | undefined
  let busy = false

  const say = (message: string): void => {
    options.onStatus(message)
  }

  /** Send one change, then redraw from the view the extension side sent back. */
  const send = (request: ShellRequest, what: string): void => {
    if (busy) return
    busy = true
    draw()
    void (async () => {
      try {
        const answer = (await options.request(request)) as {
          readonly changed?: unknown
          readonly message?: unknown
          readonly view?: ShellSettingsView
        }
        say(typeof answer.message === 'string' ? answer.message : `${what}: done.`)
        if (answer.view !== undefined) view = answer.view
      } catch (error) {
        say(`${what} failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        busy = false
        draw()
      }
    })()
  }

  function draw(): void {
    root.replaceChildren()
    const current = view
    if (current === undefined) {
      element(root, 'p', { part: 'settings.description', text: 'Reading settings…' })
      return
    }

    element(root, 'h2', { text: 'Extensions & codecs' })
    element(root, 'p', {
      part: 'settings.description',
      text:
        `Switches here write modkit.extensions and modkit.disabledContributions into your ` +
        `${current.scope} settings. VS Code’s own Settings UI edits the same two keys.`,
    })
    element(root, 'p', {
      part: 'settings.description',
      text:
        'This extension host composes once when it activates, so a change takes effect when the ' +
        'window reloads. Rows whose setting and running host disagree are marked below.',
    })
    if (!current.writable) {
      const note = element(root, 'p', {
        part: 'settings.description',
        text: 'This window cannot write configuration, so no switches are drawn.',
      })
      setState(note, ['error'])
    }

    // ---------------------------------------------------------------- extensions
    element(root, 'h2', { text: 'Connected folders' })
    if (current.writable) {
      const actions = element(root, 'div', { part: 'settings.adder' })
      const add = element(actions, 'button', {
        part: 'settings.add',
        text: 'Add extension folder…',
      }) as HTMLButtonElement
      add.type = 'button'
      add.dataset['action'] = 'add-folder'
      add.disabled = busy
      add.addEventListener('click', () => {
        send({ op: 'add-extension-folder' }, 'Adding a folder')
      })
    }

    const configured = element(root, 'div', { part: 'settings.list' })
    if (current.configuredExtensions.length === 0) {
      element(configured, 'p', {
        part: 'settings.description',
        text: 'modkit.extensions is empty. Everything loaded ships with this build.',
      })
    }
    for (const entry of current.configuredExtensions) {
      const item = element(configured, 'div', { part: 'settings.extension' })
      if (entry.state === 'failed') setState(item, ['error'])
      if (current.writable) {
        const toggle = element(item, 'input', { part: 'settings.toggle' }) as HTMLInputElement
        toggle.type = 'checkbox'
        toggle.checked = entry.enabled
        toggle.disabled = busy
        toggle.dataset['extensionIndex'] = String(entry.index)
        toggle.setAttribute('aria-label', `Enable ${entry.id ?? entry.path}`)
        toggle.addEventListener('change', () => {
          send(
            { op: 'set-extension', index: entry.index, enabled: toggle.checked },
            `${toggle.checked ? 'Enabling' : 'Disabling'} ${entry.id ?? entry.path}`,
          )
        })
      }
      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', {
        part: 'settings.label',
        text: safeViewerText(entry.id ?? entry.path, 200),
      })
      element(text, 'div', { part: 'settings.description', text: safeViewerText(entry.path, 400) })
      element(text, 'div', {
        part: 'settings.description',
        // The loader's own words for a refusal; a paraphrase would send the user to the wrong bug.
        text:
          entry.state === 'loaded'
            ? 'loaded'
            : entry.state === 'disabled'
              ? 'switched off — this folder is not offered to the loader'
              : entry.state === 'failed'
                ? `not loaded — ${entry.code ?? ''}: ${entry.message ?? ''}`
                : 'enabled, but the running host did not report it under this id',
      })
      if (current.writable) {
        const remove = element(item, 'button', {
          part: 'settings.remove',
          text: 'Remove',
        }) as HTMLButtonElement
        remove.type = 'button'
        remove.disabled = busy
        remove.addEventListener('click', () => {
          send({ op: 'remove-extension', index: entry.index }, `Removing ${entry.path}`)
        })
      }
    }

    if (current.failures.length > 0 || current.problems.length > 0) {
      element(root, 'h2', { text: 'Not loaded' })
      const failed = element(root, 'ul', { part: 'settings.list' })
      for (const failure of current.failures) {
        element(failed, 'li', {
          text: `${failure.root} — ${failure.code}: ${failure.message}`,
        })
      }
      for (const problem of current.problems) element(failed, 'li', { text: problem })
    }

    element(root, 'h2', { text: 'Bundled with this build' })
    const bundled = element(root, 'ul', { part: 'settings.list' })
    for (const coordinate of current.bundled) element(bundled, 'li', { text: coordinate })
    if (current.bundled.length === 0) {
      element(bundled, 'li', { text: 'none — every file opens with the text/hex fallback' })
    }

    // ---------------------------------------------------------------- codecs
    const switchedOff = new Set(current.disabledContributions)
    const pending = current.contributions.filter(
      row => row.id !== undefined && switchedOff.has(row.id) !== row.disabled,
    ).length
    element(root, 'h2', {
      text: `Codecs — ${current.contributions.length} contribution(s), ${switchedOff.size} off`,
    })
    element(root, 'p', {
      part: 'settings.description',
      text:
        'A contribution switched off stays listed and loses activation, so a file only it could ' +
        'read opens as raw bytes with the diagnostic x3.host/contribution-disabled.' +
        (pending === 0 ? '' : ` ${pending} row(s) below are waiting for a window reload.`),
    })

    const owners = [...new Set(current.contributions.map(row => row.extension))]
    for (const owner of owners) {
      const owned = current.contributions.filter(row => row.extension === owner)
      element(root, 'div', { part: 'settings.label', text: owner })
      const list = element(root, 'div', { part: 'settings.list' })
      for (const contribution of owned) {
        const item = element(list, 'div', { part: 'settings.extension' })
        const id = contribution.id
        const off = id !== undefined && switchedOff.has(id)
        if (off) setState(item, ['error'])
        if (id === undefined) {
          // No id means the envelope did not parse: inspectable, never activatable, nothing to name.
          element(item, 'div', { part: 'settings.description', text: 'no id' })
        } else if (current.writable) {
          const toggle = element(item, 'input', { part: 'settings.toggle' }) as HTMLInputElement
          toggle.type = 'checkbox'
          toggle.checked = !off
          toggle.disabled = busy
          toggle.dataset['contribution'] = id
          toggle.setAttribute('aria-label', `Enable ${id}`)
          toggle.addEventListener('change', () => {
            send(
              { op: 'set-contribution', id, enabled: toggle.checked },
              `${toggle.checked ? 'Enabling' : 'Disabling'} ${id}`,
            )
          })
        } else {
          element(item, 'div', { part: 'settings.description', text: off ? 'off' : 'on' })
        }

        const text = element(item, 'div', { part: 'settings.extension-text' })
        element(text, 'div', {
          part: 'settings.label',
          text: safeViewerText(contribution.displayName, 200),
        })
        element(text, 'div', {
          part: 'settings.description',
          text:
            `${safeViewerText(id ?? contribution.path, 200)} · ` +
            (contribution.contract === undefined
              ? 'unreadable manifest'
              : (CONTRACT_LABELS[contribution.contract] ?? contribution.contract)),
        })
        element(text, 'div', {
          part: 'settings.description',
          text:
            id !== undefined && off !== contribution.disabled
              ? off
                ? 'switched off in settings — still running until the window reloads'
                : 'switched on in settings — inactive until the window reloads'
              : contribution.disabled
                ? 'switched off — the host will not activate it'
                : contribution.activationEligible
                  ? `active · ${contribution.origin}`
                  : `inventoried, not activatable · ${contribution.origin}`,
        })
      }
    }
  }

  setPart(root, 'settings.pane')
  draw()

  return {
    root,
    setView(next) {
      view = next
      draw()
    },
    async reload() {
      try {
        view = (await options.request({ op: 'settings' })) as ShellSettingsView
      } catch (error) {
        say(`Could not read settings: ${error instanceof Error ? error.message : String(error)}`)
      }
      draw()
    },
  }
}
