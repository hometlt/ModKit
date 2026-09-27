/**
 * The editor's side of the credential broker (PLAN_UNIFIED_AUTH_2026-09-26, A2).
 *
 * The broker lives in the host (`services.credentials`); this module gives it the two ports only an
 * application has — a store over VS Code's SecretStorage and prompts in the editor's own password
 * box and browser — and shows the declared credentials in the «Accounts and keys» view. No secret
 * passes through here on its way to an extension: the broker reads the store itself.
 */
import * as vscode from 'vscode'
import type { CredentialBroker, DeclaredCredential } from '@modkit/host'
import type { CredentialPromptRequest, CredentialStatus } from '@modkit/sdk'
import { type UiLocalizer } from '@modkit/ui/localization'
import { presettablePrompter, type PresettablePrompter } from './credential-ports.js'

export { createSecretCredentialStore } from './credential-ports.js'

/** How long a sign-in page may wait for the editor's "open this website?" answer. */
const OPEN_EXTERNAL_WAIT_MS = 120_000

/** `localizer` is read per prompt: the window swaps in its full catalogs after activation starts. */
export function createEditorCredentialPrompter(localizer: () => UiLocalizer): PresettablePrompter {
  return presettablePrompter({
    secret: request => askSecret(localizer(), request),
    /*
     * Always answers: VS Code may hold `openExternal` behind its "open this website?" prompt for as
     * long as nobody answers it, and the OAuth engine keeps its loopback port until this returns.
     * A refusal, a failure or no answer within the bound is `false`, and the engine then cancels
     * the sign-in and closes the port.
     */
    async openExternal(url: string) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const unanswered = new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), OPEN_EXTERNAL_WAIT_MS)
      })
      try {
        return await Promise.race([
          Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))).then(
            opened => opened === true,
            () => false,
          ),
          unanswered,
        ])
      } finally {
        clearTimeout(timer)
      }
    },
    async confirm(message: string) {
      const yes = localizer().text('vscode.accounts.continue')
      return (await vscode.window.showWarningMessage(message, { modal: true }, yes)) === yes
    },
  })
}
async function askSecret(
  localizer: UiLocalizer,
  request: Pick<CredentialPromptRequest, 'label' | 'reason' | 'scope'>,
): Promise<string | undefined> {
  const typed = await vscode.window.showInputBox({
    title: request.scope === undefined ? request.label : `${request.label} · ${request.scope}`,
    prompt: localizer.text('vscode.accounts.secretPrompt', { reason: request.reason }),
    password: true,
    ignoreFocusOut: true,
  })
  return typed === undefined || typed.trim() === '' ? undefined : typed
}

/** `modkit.contributionSettings[<extension>][<name>]`: where an OAuth client id is configured. */
export function credentialSetting(extension: string, name: string): unknown {
  const all = vscode.workspace.getConfiguration('modkit').get<unknown>('contributionSettings')
  const entry =
    typeof all === 'object' && all !== null ? (all as Record<string, unknown>)[extension] : undefined
  return typeof entry === 'object' && entry !== null
    ? (entry as Record<string, unknown>)[name]
    : undefined
}

interface CredentialRow {
  readonly declared: DeclaredCredential
  readonly status: CredentialStatus
}

/** «Accounts and keys»: every credential the installed extensions declare, with its status only. */
export class AccountsView implements vscode.TreeDataProvider<CredentialRow>, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<CredentialRow | undefined>()
  readonly onDidChangeTreeData = this.changes.event

  constructor(
    private readonly broker: CredentialBroker,
    private readonly localizer: UiLocalizer,
  ) {}

  refresh(): void {
    this.changes.fire(undefined)
  }

  async getChildren(element?: CredentialRow): Promise<CredentialRow[]> {
    if (element !== undefined) return []
    return Promise.all(
      this.broker.declared().map(async declared => ({
        declared,
        status: await this.broker.status(declared.requirement.id).catch(() => 'missing' as const),
      })),
    )
  }

  getTreeItem(row: CredentialRow): vscode.TreeItem {
    const { requirement, extension } = row.declared
    const item = new vscode.TreeItem(requirement.label, vscode.TreeItemCollapsibleState.None)
    item.id = `credential:${requirement.id}`
    item.description = `${this.localizer.text(`vscode.accounts.status.${row.status}`)} · ${extension}`
    item.tooltip = `${requirement.id} (${requirement.kind})`
    item.iconPath = new vscode.ThemeIcon(
      requirement.kind === 'oauth2-pkce' || requirement.kind === 'provider-session'
        ? 'account'
        : 'key',
    )
    // `credential.<kind>.<status>` selects the row's inline actions in the manifest.
    item.contextValue = `credential.${requirement.kind}.${row.status}`
    return item
  }

  dispose(): void {
    this.changes.dispose()
  }
}

/** The row an action was invoked on, or a pick among the declared credentials. */
async function chooseCredential(
  broker: CredentialBroker,
  localizer: UiLocalizer,
  argument: unknown,
): Promise<DeclaredCredential | undefined> {
  const row = argument as Partial<CredentialRow> | undefined
  if (row?.declared !== undefined) return row.declared
  const declared = broker.declared()
  if (declared.length <= 1) return declared[0]
  return (
    await vscode.window.showQuickPick(
      declared.map(entry => ({
        label: entry.requirement.label,
        description: entry.extension,
        entry,
      })),
      { title: localizer.text('vscode.accounts.choose') },
    )
  )?.entry
}

/** A scoped credential (a pak key GUID, a region) names its scope; others have none. */
async function scopeFor(
  entry: DeclaredCredential,
  localizer: UiLocalizer,
): Promise<string | undefined | false> {
  if (entry.requirement.scoped !== true) return undefined
  const scope = (
    await vscode.window.showInputBox({
      title: entry.requirement.label,
      prompt: localizer.text('vscode.accounts.scopePrompt'),
      ignoreFocusOut: true,
    })
  )?.trim()
  return scope === undefined || scope === '' ? false : scope
}

export function registerAccountsCommands(options: {
  readonly broker: CredentialBroker
  readonly prompter: PresettablePrompter
  readonly view: AccountsView
  readonly localizer: UiLocalizer
  readonly log: (line: string) => void
}): vscode.Disposable[] {
  const { broker, prompter, view, localizer } = options
  const reason = localizer.text('vscode.accounts.reason')
  const failed = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    options.log(`[accounts] ${message}`)
    void vscode.window.showErrorMessage(`Modkit: ${message}`)
  }
  const acquire = async (entry: DeclaredCredential, scope: string | undefined) => {
    const status = await broker.portFor(entry.extension).acquire(entry.requirement.id, {
      reason,
      interactive: true,
      ...(scope === undefined ? {} : { scope }),
    })
    view.refresh()
    return status
  }
  return [
    vscode.commands.registerCommand('modkit.accounts.refresh', () => view.refresh()),
    /*
     * Enter a key or sign in. A provider session signs in on the service's own page, which its
     * content source drives, so that goes through the Sources sign-in.
     */
    vscode.commands.registerCommand('modkit.accounts.acquire', async (argument: unknown) => {
      const entry = await chooseCredential(broker, localizer, argument)
      if (entry === undefined) return false
      if (entry.requirement.kind === 'provider-session') {
        await vscode.commands.executeCommand('modkit.sources.signIn')
        view.refresh()
        return true
      }
      const scope = await scopeFor(entry, localizer)
      if (scope === false) return false
      try {
        return (await acquire(entry, scope)) === 'available'
      } catch (error) {
        failed(error)
        return false
      }
    }),
    /*
     * Replace: the new key is asked for first and the old one is dropped only once there is one,
     * so cancelling keeps the working key. A sign-in is replaced by signing in again.
     */
    vscode.commands.registerCommand('modkit.accounts.replace', async (argument: unknown) => {
      const entry = await chooseCredential(broker, localizer, argument)
      if (entry === undefined || entry.requirement.kind === 'provider-session') return false
      const scope = await scopeFor(entry, localizer)
      if (scope === false) return false
      const typed =
        entry.requirement.kind === 'oauth2-pkce'
          ? undefined
          : await askSecret(localizer, {
              label: entry.requirement.label,
              reason,
              ...(scope === undefined ? {} : { scope }),
            })
      if (entry.requirement.kind !== 'oauth2-pkce' && typed === undefined) return false
      try {
        await broker.signOut(entry.requirement.id, scope)
        if (typed !== undefined) prompter.answerNext(typed)
        return (await acquire(entry, scope)) === 'available'
      } catch (error) {
        failed(error)
        view.refresh()
        return false
      }
    }),
    vscode.commands.registerCommand('modkit.accounts.signOut', async (argument: unknown) => {
      const entry = await chooseCredential(broker, localizer, argument)
      if (entry === undefined) return false
      const scope = await scopeFor(entry, localizer)
      if (scope === false) return false
      const yes = localizer.text('vscode.accounts.signOut')
      const confirmed = await vscode.window.showWarningMessage(
        localizer.text('vscode.accounts.confirmSignOut', { label: entry.requirement.label }),
        { modal: true },
        yes,
      )
      if (confirmed !== yes) return false
      try {
        await broker.signOut(entry.requirement.id, scope)
      } catch (error) {
        failed(error)
      }
      view.refresh()
      return true
    }),
  ]
}
