/**
 * OAuth 2.0 authorization code with PKCE for a desktop host (RFC 7636, RFC 8252): the sign-in page
 * opens in the system browser through the prompter, the code comes back to a loopback server on
 * `127.0.0.1` (a random port unless the declaration fixes one), `state` guards against CSRF, and the
 * server closes after the first answer. A public client: no client secret is sent or shipped.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ModkitError } from '@modkit/core'
import type { OAuth2Engine, OAuth2Tokens } from '../credentials.js'

export interface NodeOAuth2EngineOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
  /** How long the sign-in page may take (default 5 minutes). */
  readonly timeoutMs?: number
}

const base64url = (bytes: Buffer) => bytes.toString('base64url')

const refused = (code: string, message: string) =>
  new ModkitError({ code: `x3.host/oauth-${code}`, message })

const PAGE = (text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Modkit</title><p>${text}</p>`

export function createNodeOAuth2Engine(options: NodeOAuth2EngineOptions = {}): OAuth2Engine {
  const send = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now

  const tokenRequest = async (
    endpoint: string,
    form: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<OAuth2Tokens> => {
    const response = await send(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      ...(signal === undefined ? {} : { signal }),
    })
    let body: Record<string, unknown> = {}
    try {
      body = (await response.json()) as Record<string, unknown>
    } catch {
      // described below by status
    }
    if (!response.ok || typeof body['access_token'] !== 'string') {
      // `error` is a registered code (invalid_grant …), never a token
      const code =
        typeof body['error'] === 'string' ? body['error'].slice(0, 64) : `http ${response.status}`
      throw refused('token', `the token endpoint refused: ${code}`)
    }
    const expiresIn = Number(body['expires_in'])
    return {
      accessToken: body['access_token'],
      ...(typeof body['refresh_token'] === 'string' ? { refreshToken: body['refresh_token'] } : {}),
      ...(Number.isFinite(expiresIn) && expiresIn > 0
        ? { expiresAt: now() + expiresIn * 1000 }
        : {}),
    }
  }

  return {
    async authorize({ requirement, clientId, prompter, signal }) {
      const oauth = requirement.oauth
      if (oauth === undefined)
        throw refused('unconfigured', `${requirement.id} declares no OAuth endpoints`)
      const verifier = base64url(randomBytes(32))
      const state = base64url(randomBytes(16))
      if (signal?.aborted === true) throw refused('aborted', 'the sign-in was cancelled')
      const server = createServer()
      // `localhost` (services that accept only https or localhost) may resolve to ::1 in the browser
      const servers = [server]
      let timer: ReturnType<typeof setTimeout> | undefined
      let abort: (() => void) | undefined
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(oauth.loopbackPort ?? 0, '127.0.0.1', () => resolve())
      })
      const host = oauth.loopbackHost ?? '127.0.0.1'
      try {
        const { port } = server.address() as AddressInfo
        if (host === 'localhost') {
          const ipv6 = createServer()
          // no IPv6 on this machine: 127.0.0.1 still answers
          await new Promise<void>(resolve => {
            ipv6.once('error', () => resolve())
            ipv6.listen(port, '::1', () => {
              servers.push(ipv6)
              resolve()
            })
          })
        }
        const redirectUri = `http://${host}:${port}/callback`
        const code = new Promise<string>((resolve, reject) => {
          timer = setTimeout(
            () => reject(refused('timeout', 'the sign-in was not finished in time')),
            options.timeoutMs ?? 300_000,
          )
          abort = () => reject(refused('aborted', 'the sign-in was cancelled'))
          signal?.addEventListener('abort', abort, { once: true })
          const answer = (request: IncomingMessage, response: ServerResponse) => {
            const url = new URL(request.url ?? '/', redirectUri)
            if (url.pathname !== '/callback') {
              response.writeHead(404).end()
              return
            }
            const finish = (status: number, text: string, outcome: () => void) => {
              response
                .writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
                .end(PAGE(text))
              outcome()
            }
            if (url.searchParams.get('state') !== state) {
              // not ours: keep waiting for the real answer
              response
                .writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
                .end(PAGE('Unexpected sign-in answer.'))
              return
            }
            const error = url.searchParams.get('error')
            const value = url.searchParams.get('code')
            if (error !== null || value === null)
              finish(400, 'Sign-in was not completed. You can close this page.', () =>
                reject(
                  refused(
                    'denied',
                    `the service answered ${(error ?? 'without a code').slice(0, 64)}`,
                  ),
                ),
              )
            else
              finish(200, 'Signed in. You can close this page and return to Modkit.', () =>
                resolve(value),
              )
          }
          for (const each of servers) each.on('request', answer)
        })
        code.catch(() => undefined)
        const authorize = new URL(oauth.authorizationEndpoint)
        authorize.searchParams.set('response_type', 'code')
        authorize.searchParams.set('client_id', clientId)
        authorize.searchParams.set('redirect_uri', redirectUri)
        authorize.searchParams.set(
          'code_challenge',
          base64url(createHash('sha256').update(verifier).digest()),
        )
        authorize.searchParams.set('code_challenge_method', 'S256')
        authorize.searchParams.set('state', state)
        const scopes = requirement.scopes ?? []
        if (scopes.length > 0) authorize.searchParams.set('scope', scopes.join(' '))
        if (!(await prompter.openExternal(authorize.href)))
          throw refused('aborted', 'the sign-in page could not be opened')
        const authorizationCode = await code
        return await tokenRequest(
          oauth.tokenEndpoint,
          {
            grant_type: 'authorization_code',
            code: authorizationCode,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
          },
          signal,
        )
      } finally {
        clearTimeout(timer)
        if (abort !== undefined) signal?.removeEventListener('abort', abort)
        for (const each of servers) {
          each.closeAllConnections()
          each.close()
        }
      }
    },

    async refresh({ requirement, clientId, refreshToken, signal }) {
      const oauth = requirement.oauth
      if (oauth === undefined)
        throw refused('unconfigured', `${requirement.id} declares no OAuth endpoints`)
      return tokenRequest(
        oauth.tokenEndpoint,
        { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
        signal,
      )
    },

    async revoke({ requirement, clientId, token, signal }) {
      const endpoint = requirement.oauth?.revocationEndpoint
      if (endpoint === undefined) return
      await send(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, client_id: clientId }).toString(),
        redirect: 'error',
        ...(signal === undefined ? {} : { signal }),
      })
    },
  }
}
