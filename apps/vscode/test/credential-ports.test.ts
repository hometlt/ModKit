/**
 * A2: the editor's store and prompter under the host's real broker, over a fixture declaration
 * (no extension declares `modkit.credentials` yet).
 */
import { describe, expect, it } from 'vitest'
import { createCredentialBroker } from '@modkit/host'
import type { CredentialPrompter } from '@modkit/sdk'

import {
  adoptKeptTickets,
  adoptReplacedApplicationSettings,
  adoptReplacedSettings,
  createSecretCredentialStore,
  presettablePrompter,
} from '../src/credential-ports.js'

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

  it('moves tickets kept under both earlier names into the broker without loss', async () => {
    const storage = secrets()
    const sessionInventory = {
      extensions: [
        {
          manifest: {
            publisher: 'fixture',
            id: 'game',
            credentials: [
              { id: 'fixture/session', kind: 'provider-session', label: 'Session', scoped: true },
            ],
          },
        },
      ],
    } as never
    const broker = createCredentialBroker({
      inventory: sessionInventory,
      store: createSecretCredentialStore(storage),
    })
    storage.values.set('old.eu', 'eu-ticket')
    storage.values.set('older.eu', 'stale-eu-ticket')
    storage.values.set('old.kr', 'kr-ticket')
    storage.values.set('old.us', 'us-ticket')
    const log: string[] = []
    await adoptKeptTickets({
      regions: [
        { id: 'eu', credentialId: 'fixture/session' },
        { id: 'kr', credentialId: 'fixture/session' },
        // a region its source has not tied to a credential keeps its ticket where it is
        { id: 'us' },
      ],
      secrets: storage,
      broker,
      keysFor: region => [`old.${region}`, `older.${region}`],
      log: line => log.push(line),
    })
    const port = broker.portFor('fixture/game')
    const text = async (scope: string) =>
      new TextDecoder().decode((await port.secret('fixture/session', scope)) ?? new Uint8Array())
    // the newer name wins; the older one is dropped once the broker holds a value
    expect(await text('eu')).toBe('eu-ticket')
    expect(await text('kr')).toBe('kr-ticket')
    expect(storage.values.has('old.eu')).toBe(false)
    expect(storage.values.has('older.eu')).toBe(false)
    expect(storage.values.get('old.us')).toBe('us-ticket')
    expect(log).toEqual([])
  })

  it('keeps an old ticket where it is when the broker refuses it', async () => {
    const storage = secrets()
    const broker = createCredentialBroker({ inventory, store: createSecretCredentialStore(storage) })
    storage.values.set('old.eu', 'secret-value')
    const log: string[] = []
    await adoptKeptTickets({
      regions: [{ id: 'eu', credentialId: 'fixture/undeclared' }],
      secrets: storage,
      broker,
      keysFor: region => [`old.${region}`],
      log: line => log.push(line),
    })
    expect(storage.values.get('old.eu')).toBe('secret-value')
    expect(log).toHaveLength(1)
    expect(log.join('')).not.toContain('secret-value')
  })

  it('moves keys out of contribution settings by the declaration that replaces them', async () => {
    const storage = secrets()
    const keyInventory = {
      extensions: [
        {
          manifest: {
            publisher: 'fixture',
            id: 'archives',
            credentials: [
              {
                id: 'fixture/archive-key',
                kind: 'symmetric-key',
                label: 'Archive key',
                scoped: true,
                scopeFormat: 'hex',
                replacesSettings: [
                  { contribution: 'fixture/pak', key: 'mainKey' },
                  { contribution: 'fixture/pak', key: 'keys', scoped: true },
                ],
              },
            ],
          },
        },
      ],
    } as never
    const broker = createCredentialBroker({
      inventory: keyInventory,
      store: createSecretCredentialStore(storage),
    })
    const main = '00112233445566778899aabbccddeeff'
    const other = 'ffeeddccbbaa99887766554433221100'
    const level = {
      'fixture/pak': {
        mainKey: main,
        cacheIndex: true,
        bySource: {
          'file:///game': { keys: { '{A0A1A2A3-B0B1-C0C1-D0D1-E0E1E2E3E4E5}': other, bad: 'nope' } },
        },
      },
      'fixture/other': { unrelated: 1 },
    }
    const log: string[] = []
    const result = await adoptReplacedSettings({
      level,
      declared: broker.declared(),
      broker,
      log: line => log.push(line),
    })
    expect(result).toMatchObject({ changed: true, adopted: 2, kept: 0, refused: 1 })
    // moved values leave the settings; what is not a secret, and what was refused, stays
    expect(result.next).toEqual({
      'fixture/pak': { cacheIndex: true, bySource: { 'file:///game': { keys: { bad: 'nope' } } } },
      'fixture/other': { unrelated: 1 },
    })
    // the input level itself is not modified
    expect(level['fixture/pak'].mainKey).toBe(main)
    const port = broker.portFor('fixture/archives')
    const hex = async (scope?: string) =>
      Buffer.from((await port.secret('fixture/archive-key', scope)) ?? []).toString('hex')
    expect(await hex()).toBe(main)
    // the broker normalises the GUID scope; the codec asks with the bare hex form
    expect(await hex('a0a1a2a3b0b1c0c1d0d1e0e1e2e3e4e5')).toBe(other)
    expect(log).toHaveLength(1)
    expect(log.join('')).not.toContain('nope')
  })

  it('leaves settings alone when no declaration replaces them', async () => {
    const storage = secrets()
    const broker = createCredentialBroker({ inventory, store: createSecretCredentialStore(storage) })
    const level = { 'fixture/pak': { mainKey: 'x' } }
    const result = await adoptReplacedSettings({
      level,
      declared: broker.declared(),
      broker,
      log: () => undefined,
    })
    expect(result).toMatchObject({ changed: false, adopted: 0 })
    expect(result.next).toBe(level)
  })

  it('moves a top-level setting by the declaration that replaces it, whole or not at all', async () => {
    const storage = secrets()
    const keyInventory = {
      extensions: [
        {
          manifest: {
            publisher: 'fixture',
            id: 'engine',
            credentials: [
              {
                id: 'fixture/engine-key',
                kind: 'symmetric-key',
                label: 'Engine key',
                scoped: true,
                scopeFormat: 'hex',
                replacesApplicationSettings: [
                  { setting: 'fixture.engine.key' },
                  { setting: 'fixture.engine.keys', scoped: true },
                ],
              },
            ],
          },
        },
      ],
    } as never
    const broker = createCredentialBroker({
      inventory: keyInventory,
      store: createSecretCredentialStore(storage),
    })
    const main = '00112233445566778899aabbccddeeff'
    const other = 'ffeeddccbbaa99887766554433221100'
    const log: string[] = []
    const result = await adoptReplacedApplicationSettings({
      values: {
        'fixture.engine.key': main,
        // one refused scope keeps the whole setting where it is
        'fixture.engine.keys': { a0a1a2a3b0b1c0c1d0d1e0e1e2e3e4e5: other, b1: 'nope' },
        'fixture.unrelated': 'left alone',
      },
      declared: broker.declared(),
      broker,
      log: line => log.push(line),
    })
    expect(result).toEqual({ cleared: ['fixture.engine.key'], adopted: 2, kept: 0, refused: 1 })
    const port = broker.portFor('fixture/engine')
    expect(Buffer.from((await port.secret('fixture/engine-key')) ?? []).toString('hex')).toBe(main)
    expect(log).toHaveLength(1)
    expect(log.join('')).not.toContain('nope')
    // a copy the broker already holds is cleared on the next run too
    const again = await adoptReplacedApplicationSettings({
      values: { 'fixture.engine.key': main },
      declared: broker.declared(),
      broker,
      log: line => log.push(line),
    })
    expect(again).toEqual({ cleared: ['fixture.engine.key'], adopted: 0, kept: 1, refused: 0 })
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
