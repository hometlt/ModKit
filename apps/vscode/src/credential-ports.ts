/**
 * The broker's application ports without the editor API, so they are testable under Node: the
 * store over a SecretStorage-shaped object, and a prompter that can be told its next answer.
 */
import type { CredentialBroker, DeclaredCredential } from '@modkit/host'
import type { CredentialPromptRequest, CredentialPrompter, CredentialStore } from '@modkit/sdk'

/**
 * Tickets and keys kept before the broker (under the names `keysFor` gives) move into it without
 * loss: `adopt` keeps a value the broker already holds, and an old entry is deleted only after that
 * answer. A region whose source names no credential stays where it is. Failures are logged by
 * credential id and message, never with the value.
 */
export async function adoptKeptTickets(options: {
  readonly regions: readonly { readonly id: string; readonly credentialId?: string }[]
  readonly secrets: SecretStorageLike
  readonly broker: Pick<CredentialBroker, 'adopt'>
  readonly keysFor: (region: string) => readonly string[]
  readonly log: (line: string) => void
}): Promise<void> {
  for (const region of options.regions) {
    if (region.credentialId === undefined) continue
    for (const key of options.keysFor(region.id)) {
      const kept = await options.secrets.get(key)
      if (kept === undefined) continue
      try {
        await options.broker.adopt(region.credentialId, kept, region.id)
        await options.secrets.delete(key)
      } catch (error) {
        options.log(
          `[accounts] ${region.credentialId}: ${error instanceof Error ? error.message : ''}`,
        )
      }
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export interface ReplacedSettingsResult {
  /** The level's `modkit.contributionSettings` without the moved secrets; unchanged when none moved. */
  readonly next: unknown
  readonly changed: boolean
  readonly adopted: number
  /** Values not taken because the broker already held one for that credential and scope. */
  readonly kept: number
  readonly refused: number
}

/**
 * Secrets an extension used to take from `modkit.contributionSettings`, moved into the broker by
 * the declarations that replace them (`replacesSettings`): each value of one settings level — the
 * contribution's values and each `bySource` override — goes to `adopt`, and only a value `adopt`
 * answered is removed from the returned settings. A refused value stays and is logged by credential
 * id, never with the value. No game is named here: the declarations say which settings to read.
 */
export async function adoptReplacedSettings(options: {
  readonly level: unknown
  readonly declared: readonly DeclaredCredential[]
  readonly broker: Pick<CredentialBroker, 'adopt'>
  readonly log: (line: string) => void
}): Promise<ReplacedSettingsResult> {
  let adopted = 0
  let kept = 0
  let refused = 0
  if (!isRecord(options.level)) {
    return { next: options.level, changed: false, adopted, kept, refused }
  }
  const next: Record<string, unknown> = structuredClone(options.level)
  const adopt = async (id: string, value: unknown, scope?: string): Promise<boolean> => {
    if (typeof value !== 'string' || value.trim() === '') return false
    try {
      const answer = await options.broker.adopt(id, value, scope)
      if (answer === 'adopted') adopted += 1
      else kept += 1
      return true
    } catch (error) {
      refused += 1
      options.log(`[accounts] ${id}: ${error instanceof Error ? error.message : ''}`)
      return false
    }
  }
  /** Moves what one values object holds for one replaced setting; true when anything went. */
  const moveFrom = async (
    values: Record<string, unknown>,
    id: string,
    key: string,
    scoped: boolean,
  ): Promise<boolean> => {
    if (!(key in values)) return false
    const held = values[key]
    if (!scoped) {
      if (!(await adopt(id, held))) return false
      delete values[key]
      return true
    }
    if (!isRecord(held)) return false
    let moved = false
    for (const [scope, value] of Object.entries(held)) {
      if (await adopt(id, value, scope)) {
        delete held[scope]
        moved = true
      }
    }
    if (Object.keys(held).length === 0) delete values[key]
    return moved
  }
  let changed = false
  for (const { requirement } of options.declared) {
    for (const replaced of requirement.replacesSettings ?? []) {
      const entry = next[replaced.contribution]
      if (!isRecord(entry)) continue
      const scoped = replaced.scoped === true
      if (await moveFrom(entry, requirement.id, replaced.key, scoped)) changed = true
      const bySource = entry['bySource']
      if (isRecord(bySource)) {
        for (const [source, override] of Object.entries(bySource)) {
          if (!isRecord(override)) continue
          if (await moveFrom(override, requirement.id, replaced.key, scoped)) changed = true
          if (Object.keys(override).length === 0) delete bySource[source]
        }
        if (Object.keys(bySource).length === 0) delete entry['bySource']
      }
      if (Object.keys(entry).length === 0) delete next[replaced.contribution]
    }
  }
  return { next: changed ? next : options.level, changed, adopted, kept, refused }
}

/** The part of VS Code's `SecretStorage` the store uses. */
export interface SecretStorageLike {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
  delete(key: string): PromiseLike<void>
}

/** Secrets under the broker's own keys, in the editor's encrypted storage. */
export function createSecretCredentialStore(secrets: SecretStorageLike): CredentialStore {
  return Object.freeze({
    get: async (key: string) => secrets.get(key),
    set: async (key: string, value: string) => secrets.store(key, value),
    delete: async (key: string) => secrets.delete(key),
  })
}

export interface PresettablePrompter extends CredentialPrompter {
  /**
   * The next secret prompt is answered with this value instead of a box: «replace» asks for the new
   * key before the old one is dropped, so cancelling keeps what was there.
   */
  answerNext(value: string): void
}

export function presettablePrompter(prompter: CredentialPrompter): PresettablePrompter {
  let preset: string | undefined
  return Object.freeze({
    answerNext(value: string) {
      preset = value
    },
    async secret(request: CredentialPromptRequest) {
      if (preset === undefined) return prompter.secret(request)
      const value = preset
      preset = undefined
      return value
    },
    openExternal: (url: string) => prompter.openExternal(url),
    confirm: (message: string) => prompter.confirm(message),
  })
}
