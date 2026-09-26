/**
 * A2: the editor's store and prompter under the host's real broker, over a fixture declaration
 * (no extension declares `modkit.credentials` yet).
 */
import { describe, expect, it } from 'vitest'
import { createCredentialBroker } from '@modkit/host'
import type { CredentialPrompter } from '@modkit/sdk'

import { createSecretCredentialStore, presettablePrompter } from '../src/credential-ports.js'

const secrets = () => {
  const values = new Map<string, string>()
  return {
    values,
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => void values.set(key, value),
    delete: async (key: string) => void values.delete(key),
  }
}

const inventory = {
  extensions: [
    {
      manifest: {
        publisher: 'fixture',
        id: 'game',
        credentials: [
          {
            id: 'fixture/open-cloud',
            kind: 'api-key',
            label: 'Fixture key',
            audience: ['https://api.example.test/'],
          },
        ],
      },
    },
  ],
} as never

const typing = (answers: (string | undefined)[]): CredentialPrompter => ({
  secret: async () => answers.shift(),
  openExternal: async () => false,
  confirm: async () => false,
})

describe('the editor ports of the credential broker', () => {
  it('keeps an entered key in secret storage and reports it available', async () => {
    const storage = secrets()
    const broker = createCredentialBroker({
      inventory,
      store: createSecretCredentialStore(storage),
      prompter: presettablePrompter(typing(['first-key'])),
    })
    expect(broker.declared().map(entry => entry.requirement.id)).toEqual(['fixture/open-cloud'])
    expect(await broker.status('fixture/open-cloud')).toBe('missing')
    await broker
      .portFor('fixture/game')
      .acquire('fixture/open-cloud', { reason: 'test', interactive: true })
    expect(await broker.status('fixture/open-cloud')).toBe('available')
    expect([...storage.values.values()]).toEqual(['first-key'])
  })

  it('replaces a key with the one typed before the old one was dropped', async () => {
    const storage = secrets()
    const prompter = presettablePrompter(typing(['first-key']))
    const broker = createCredentialBroker({
      inventory,
      store: createSecretCredentialStore(storage),
      prompter,
    })
    const port = broker.portFor('fixture/game')
    await port.acquire('fixture/open-cloud', { reason: 'test', interactive: true })
    await broker.signOut('fixture/open-cloud')
    prompter.answerNext('second-key')
    await port.acquire('fixture/open-cloud', { reason: 'test', interactive: true })
    expect([...storage.values.values()]).toEqual(['second-key'])
  })

  it('deletes the key on sign-out', async () => {
    const storage = secrets()
    const broker = createCredentialBroker({
      inventory,
      store: createSecretCredentialStore(storage),
      prompter: presettablePrompter(typing(['first-key'])),
    })
    await broker
      .portFor('fixture/game')
      .acquire('fixture/open-cloud', { reason: 'test', interactive: true })
    await broker.signOut('fixture/open-cloud')
    expect(storage.values.size).toBe(0)
    expect(await broker.status('fixture/open-cloud')).toBe('missing')
  })
})
