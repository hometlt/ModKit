/**
 * The broker's application ports without the editor API, so they are testable under Node: the
 * store over a SecretStorage-shaped object, and a prompter that can be told its next answer.
 */
import type { CredentialBroker } from '@modkit/host'
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
