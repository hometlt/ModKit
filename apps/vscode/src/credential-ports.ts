/**
 * The broker's application ports without the editor API, so they are testable under Node: the
 * store over a SecretStorage-shaped object, and a prompter that can be told its next answer.
 */
import type { CredentialPromptRequest, CredentialPrompter, CredentialStore } from '@modkit/sdk'

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
