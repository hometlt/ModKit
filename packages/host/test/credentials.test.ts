import { describe, expect, it, vi } from 'vitest'
import type { CredentialPrompter, CredentialRequirement, CredentialStore } from '@modkit/sdk'
import {
  createCredentialBroker,
  credentialAudienceAllows,
  symmetricKeyHex,
  type OAuth2Engine,
} from '../src/credentials.js'
import type { Inventory } from '../src/inventory.js'

// A value that must never appear in an error, a status or a request outside the audience.
const SECRET = 'SECRET-MARKER-7f3a'

const REQUIREMENTS: readonly CredentialRequirement[] = [
  {
    id: 'acme/cloud',
    kind: 'api-key',
    label: 'Acme Cloud key',
    audience: ['https://api.acme.test/v1/'],
  },
  {
    id: 'acme/oauth',
    kind: 'oauth2-pkce',
    label: 'Acme account',
    audience: ['https://api.acme.test/'],
    oauth: {
      authorizationEndpoint: 'https://auth.acme.test/authorize',
      tokenEndpoint: 'https://auth.acme.test/token',
      revocationEndpoint: 'https://auth.acme.test/revoke',
      clientIdSetting: 'oauthClientId',
    },
  },
  { id: 'acme/aes', kind: 'symmetric-key', label: 'Pak key', scoped: true },
  { id: 'acme/session', kind: 'provider-session', label: 'Acme session' },
]

function inventory(): Inventory {
  const extension = (
    publisher: string,
    id: string,
    credentials?: readonly CredentialRequirement[],
  ) => ({
    source: id,
    origin: 'linked',
    container: 'package-json',
    manifest: { publisher, id, ...(credentials === undefined ? {} : { credentials }) },
    contributions: [],
  })
  return {
    extensions: [extension('acme', 'tool', REQUIREMENTS), extension('other', 'thing')],
    diagnostics: [],
  } as unknown as Inventory
}

function memoryStore() {
  const values = new Map<string, string>()
  const store: CredentialStore = {
    get: async key => values.get(key),
    set: async (key, value) => void values.set(key, value),
    delete: async key => void values.delete(key),
  }
  return { store, values }
}

function prompter(answer: string | undefined) {
  return {
    secret: vi.fn(async () => answer),
    openExternal: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
  } satisfies CredentialPrompter
}

type Sent = { url: string; headers: Record<string, string>; redirect: string | undefined }
function fakeFetch(respond: (sent: Sent) => Response) {
  const sent: Sent[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const request: Sent = {
      url: String(url),
      headers: { ...(init?.headers as Record<string, string>) },
      redirect: init?.redirect,
    }
    sent.push(request)
    return respond(request)
  }) as unknown as typeof globalThis.fetch
  return { fetch, sent }
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    expect(String((error as Error).message)).not.toContain(SECRET)
    expect(JSON.stringify(error)).not.toContain(SECRET)
    return error as Error
  }
  throw new Error('expected a refusal')
}

describe('credential broker', () => {
  it('keeps an API key in the store and sends it only inside the audience', async () => {
    const { store, values } = memoryStore()
    const { fetch, sent } = fakeFetch(() => new Response('ok'))
    const ask = prompter(`  ${SECRET}  `)
    const broker = createCredentialBroker({ inventory: inventory(), store, prompter: ask, fetch })
    const port = broker.portFor('acme/tool')

    expect(await port.status('acme/cloud')).toBe('missing')
    expect(await port.acquire('acme/cloud', { reason: 'upload', interactive: false })).toBe(
      'missing',
    )
    expect(ask.secret).not.toHaveBeenCalled()
    expect(await port.acquire('acme/cloud', { reason: 'upload', interactive: true })).toBe(
      'available',
    )
    expect(values.get('modkit.credential/acme/cloud')).toBe(SECRET)
    expect(await broker.status('acme/cloud')).toBe('available')

    const response = await port.fetch('acme/cloud', {
      url: 'https://api.acme.test/v1/assets/1',
      headers: { 'X-API-Key': 'forged', accept: 'application/json' },
    })
    expect(new TextDecoder().decode(response.body)).toBe('ok')
    expect(sent[0]).toEqual({
      url: 'https://api.acme.test/v1/assets/1',
      headers: { accept: 'application/json', 'x-api-key': SECRET },
      redirect: 'manual',
    })

    for (const url of [
      'https://api.acme.test/v2/assets',
      'https://evil.test/v1/',
      'http://api.acme.test/v1/assets',
      'https://user:pw@api.acme.test/v1/assets',
    ]) {
      const error = await refusal(port.fetch('acme/cloud', { url }))
      expect((error as { code?: string }).code).toBe('x3.host/credential-audience')
    }
    expect(sent).toHaveLength(1)
    // the key itself never reaches the extension
    await refusal(port.secret('acme/cloud'))
  })

  it('follows a redirect without the credential and without the extension headers', async () => {
    const { store } = memoryStore()
    await store.set('modkit.credential/acme/cloud', SECRET)
    const { fetch, sent } = fakeFetch(request =>
      request.url.startsWith('https://api.acme.test/')
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://cdn.acme-cdn.test/blob?sig=1' },
          })
        : new Response('blob'),
    )
    const port = createCredentialBroker({ inventory: inventory(), store, fetch }).portFor(
      'acme/tool',
    )
    const response = await port.fetch('acme/cloud', {
      url: 'https://api.acme.test/v1/assets/1',
      headers: { accept: '*/*' },
    })
    expect(response.status).toBe(200)
    expect(new TextDecoder().decode(response.body)).toBe('blob')
    expect(sent[1]).toEqual({
      url: 'https://cdn.acme-cdn.test/blob?sig=1',
      headers: {},
      redirect: 'manual',
    })
    expect(JSON.stringify(sent.slice(1))).not.toContain(SECRET)
  })

  it('reaches only the credentials the extension declared', async () => {
    const { store } = memoryStore()
    const broker = createCredentialBroker({ inventory: inventory(), store })
    const foreign = broker.portFor('other/thing')
    expect(((await refusal(foreign.status('acme/cloud'))) as { code?: string }).code).toBe(
      'x3.host/credential-undeclared',
    )
    await refusal(broker.portFor('acme/tool').status('acme/unknown'))
    expect(broker.declared().map(item => `${item.extension}:${item.requirement.id}`)).toEqual([
      'acme/tool:acme/cloud',
      'acme/tool:acme/oauth',
      'acme/tool:acme/aes',
      'acme/tool:acme/session',
    ])
  })

  it('refreshes a single-use OAuth refresh token once and stores the new one', async () => {
    const { store, values } = memoryStore()
    let clock = 1_000_000
    let issued = 0
    const oauth: OAuth2Engine = {
      authorize: vi.fn(async () => ({
        accessToken: 'access-0',
        refreshToken: 'refresh-0',
        expiresAt: clock + 900_000,
      })),
      refresh: vi.fn(async ({ refreshToken }) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        issued += 1
        expect(refreshToken).toBe(`refresh-${issued - 1}`)
        return {
          accessToken: `access-${issued}`,
          refreshToken: `refresh-${issued}`,
          expiresAt: clock + 900_000,
        }
      }),
      revoke: vi.fn(async () => undefined),
    }
    const { fetch, sent } = fakeFetch(
      request =>
        new Response(null, {
          status: request.headers['authorization'] === 'Bearer access-2' ? 200 : 401,
        }),
    )
    const broker = createCredentialBroker({
      inventory: inventory(),
      store,
      prompter: prompter(undefined),
      oauth,
      fetch,
      now: () => clock,
      setting: (extension, name) =>
        extension === 'acme/tool' && name === 'oauthClientId' ? 'client-1' : undefined,
    })
    const port = broker.portFor('acme/tool')
    expect(await port.acquire('acme/oauth', { reason: 'sign in', interactive: true })).toBe(
      'available',
    )
    expect(oauth.authorize).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-1' }))

    clock += 900_000 // the access token ran out
    const [first, second] = await Promise.all([
      port.fetch('acme/oauth', { url: 'https://api.acme.test/me' }),
      port.fetch('acme/oauth', { url: 'https://api.acme.test/me' }),
    ])
    // one refresh for both, then the 401 forces the second (rotated) refresh
    expect(oauth.refresh).toHaveBeenCalledTimes(2)
    expect([first.status, second.status]).toEqual([200, 200])
    expect(JSON.parse(values.get('modkit.credential/acme/oauth')!)).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    })
    expect(sent.every(request => request.redirect === 'manual')).toBe(true)

    await port.forget('acme/oauth')
    expect(oauth.revoke).toHaveBeenCalledWith(expect.objectContaining({ token: 'refresh-2' }))
    expect(values.has('modkit.credential/acme/oauth')).toBe(false)
  })

  it('signs out locally when the service cannot revoke', async () => {
    const { store, values } = memoryStore()
    await store.set('modkit.credential/acme/oauth', JSON.stringify({ accessToken: SECRET }))
    const oauth: OAuth2Engine = {
      authorize: vi.fn(),
      refresh: vi.fn(),
      revoke: vi.fn(async () => Promise.reject(new Error('offline'))),
    }
    const broker = createCredentialBroker({
      inventory: inventory(),
      store,
      oauth,
      setting: () => 'client-1',
    })
    await broker.signOut('acme/oauth')
    expect(values.size).toBe(0)
  })

  it('normalizes a symmetric key per scope and hands out its bytes', async () => {
    const { store, values } = memoryStore()
    const hex = '0123456789abcdef'.repeat(4)
    const base64 = Buffer.from(hex, 'hex').toString('base64')
    const ask = prompter(base64)
    const port = createCredentialBroker({ inventory: inventory(), store, prompter: ask }).portFor(
      'acme/tool',
    )
    expect(
      await port.acquire('acme/aes', { reason: 'pak', interactive: true, scope: 'guid-1' }),
    ).toBe('available')
    expect(values.get('modkit.credential/acme/aes#guid-1')).toBe(hex)
    expect(await port.status('acme/aes', 'guid-2')).toBe('missing')
    expect(Buffer.from((await port.secret('acme/aes', 'guid-1'))!).toString('hex')).toBe(hex)

    ask.secret.mockResolvedValueOnce(SECRET)
    const error = await refusal(
      port.acquire('acme/aes', { reason: 'pak', interactive: true, scope: 'guid-3' }),
    )
    expect((error as { code?: string }).code).toBe('x3.host/credential-invalid')
    expect(symmetricKeyHex(`0x${hex.toUpperCase()}`)).toBe(hex)
    expect(symmetricKeyHex('abc')).toBeUndefined()
  })

  it('keeps a provider-session ticket the extension received', async () => {
    const { store } = memoryStore()
    const port = createCredentialBroker({ inventory: inventory(), store }).portFor('acme/tool')
    await port.remember('acme/session', SECRET, 'eu')
    expect(new TextDecoder().decode((await port.secret('acme/session', undefined))!)).toBe(SECRET)
    await refusal(port.remember('acme/cloud', SECRET))
    await refusal(port.fetch('acme/session', { url: 'https://api.acme.test/' }))
    await port.forget('acme/session')
    expect(await port.status('acme/session')).toBe('missing')
  })

  it('matches the audience by origin and path prefix', () => {
    const audience = ['https://apis.example.test/assets/']
    expect(credentialAudienceAllows('https://apis.example.test/assets/v1/1', audience)).toBe(true)
    expect(credentialAudienceAllows('https://apis.example.test/assetsx', audience)).toBe(false)
    expect(credentialAudienceAllows('https://apis.example.test.evil/assets/', audience)).toBe(false)
    expect(credentialAudienceAllows('not a url', audience)).toBe(false)
  })
})
