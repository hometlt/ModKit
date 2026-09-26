import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CredentialPrompter, CredentialRequirement } from '@modkit/sdk'
import { createNodeOAuth2Engine } from '../src/node/oauth2-pkce.js'

// A fake authorization server: it remembers the PKCE challenge of the sign-in page and checks the
// verifier at the token endpoint, as a real one does.
let server: Server
let base = ''
const challenges = new Map<string, string>()
const forms: URLSearchParams[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      const form = new URLSearchParams(body)
      forms.push(form)
      const json = (status: number, value: unknown) =>
        response
          .writeHead(status, { 'content-type': 'application/json' })
          .end(JSON.stringify(value))
      if (request.url === '/token' && form.get('grant_type') === 'authorization_code') {
        const challenge = challenges.get(form.get('code') ?? '')
        const verifier = form.get('code_verifier') ?? ''
        const expected = createHash('sha256').update(verifier).digest('base64url')
        if (challenge !== expected) return json(400, { error: 'invalid_grant' })
        return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 900 })
      }
      if (request.url === '/token' && form.get('grant_type') === 'refresh_token')
        return form.get('refresh_token') === 'refresh-1'
          ? json(200, { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 900 })
          : json(400, { error: 'invalid_grant' })
      if (request.url === '/revoke') return json(200, {})
      json(404, {})
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

const requirement = (): CredentialRequirement => ({
  id: 'acme/oauth',
  kind: 'oauth2-pkce',
  label: 'Acme',
  scopes: ['openid', 'profile'],
  oauth: {
    authorizationEndpoint: `${base}/authorize`,
    tokenEndpoint: `${base}/token`,
    revocationEndpoint: `${base}/revoke`,
  },
})

/** A browser that signs in: first a forged answer with the wrong state, then the real one. */
function browser(answer: 'approve' | 'deny' | 'ignore'): CredentialPrompter & { pages: URL[] } {
  const pages: URL[] = []
  return {
    pages,
    secret: async () => undefined,
    confirm: async () => true,
    async openExternal(href) {
      const page = new URL(href)
      pages.push(page)
      if (answer === 'ignore') return true
      const redirect = page.searchParams.get('redirect_uri')!
      challenges.set('code-1', page.searchParams.get('code_challenge')!)
      queueMicrotask(async () => {
        const forged = await fetch(`${redirect}?code=stolen&state=forged`)
        expect(forged.status).toBe(400)
        const state = page.searchParams.get('state')!
        const query =
          answer === 'approve' ? `code=code-1&state=${state}` : `error=access_denied&state=${state}`
        await fetch(`${redirect}?${query}`)
      })
      return true
    },
  }
}

describe('OAuth 2.0 PKCE engine (loopback)', () => {
  it('signs in with S256 and state through a loopback redirect, then refreshes and revokes', async () => {
    const engine = createNodeOAuth2Engine({ now: () => 1_000 })
    const prompter = browser('approve')
    const tokens = await engine.authorize({
      requirement: requirement(),
      clientId: 'client-1',
      prompter,
    })
    expect(tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 901_000,
    })

    const page = prompter.pages[0]!
    expect(Object.fromEntries(page.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'client-1',
      code_challenge_method: 'S256',
      scope: 'openid profile',
    })
    const redirect = new URL(page.searchParams.get('redirect_uri')!)
    expect(redirect.hostname).toBe('127.0.0.1')
    expect(redirect.port).not.toBe('')
    const exchange = forms.find(form => form.get('grant_type') === 'authorization_code')!
    expect(exchange.get('client_secret')).toBeNull()
    expect(exchange.get('redirect_uri')).toBe(redirect.href)
    // the loopback server is gone after the answer
    await expect(fetch(redirect.href)).rejects.toThrow()

    const renewed = await engine.refresh({
      requirement: requirement(),
      clientId: 'client-1',
      refreshToken: 'refresh-1',
    })
    expect(renewed.refreshToken).toBe('refresh-2')
    await expect(
      engine.refresh({
        requirement: requirement(),
        clientId: 'client-1',
        refreshToken: 'refresh-1-used',
      }),
    ).rejects.toMatchObject({
      code: 'x3.host/oauth-token',
      message: expect.stringContaining('invalid_grant'),
    })

    await engine.revoke!({ requirement: requirement(), clientId: 'client-1', token: 'refresh-2' })
    expect(forms.at(-1)?.get('token')).toBe('refresh-2')
  })

  it('reports a denied sign-in', async () => {
    const engine = createNodeOAuth2Engine()
    await expect(
      engine.authorize({
        requirement: requirement(),
        clientId: 'client-1',
        prompter: browser('deny'),
      }),
    ).rejects.toMatchObject({ code: 'x3.host/oauth-denied' })
  })

  it('gives up after the timeout and on cancel, closing the loopback server', async () => {
    const engine = createNodeOAuth2Engine({ timeoutMs: 50 })
    const late = browser('ignore')
    await expect(
      engine.authorize({ requirement: requirement(), clientId: 'client-1', prompter: late }),
    ).rejects.toMatchObject({ code: 'x3.host/oauth-timeout' })
    await expect(fetch(late.pages[0]!.searchParams.get('redirect_uri')!)).rejects.toThrow()

    const controller = new AbortController()
    const cancelled = createNodeOAuth2Engine().authorize({
      requirement: requirement(),
      clientId: 'client-1',
      prompter: browser('ignore'),
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)
    await expect(cancelled).rejects.toMatchObject({ code: 'x3.host/oauth-aborted' })
  })
})
