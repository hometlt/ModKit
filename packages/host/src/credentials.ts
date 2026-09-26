/**
 * `credential.broker`: the one owner of sign-ins and keys (PLAN_UNIFIED_AUTH_2026-09-26). It knows
 * the declarations of the inventory (`package.json#modkit.credentials`), keeps secrets only in the
 * application's `CredentialStore`, asks through the application's `CredentialPrompter`, refreshes
 * OAuth tokens, and gives each extension a `CredentialPort` for the credentials it declared. An API
 * key or token never reaches the extension: `fetch` adds it, only for the declared `audience`; a redirect
 * is followed without it. No message, diagnostic or error carries a secret value.
 */
import { ModkitError } from '@modkit/core'
import type {
  CredentialAcquireOptions,
  CredentialFetchRequest,
  CredentialFetchResponse,
  CredentialPort,
  CredentialPrompter,
  CredentialRequirement,
  CredentialStatus,
  CredentialStore,
} from '@modkit/sdk'
import type { Inventory } from './inventory.js'

export interface OAuth2Tokens {
  readonly accessToken: string
  readonly refreshToken?: string
  /** Epoch milliseconds. */
  readonly expiresAt?: number
}

export interface OAuth2Request {
  readonly requirement: CredentialRequirement
  readonly clientId: string
  readonly signal?: AbortSignal
}

/** The OAuth 2.0 authorization-code-with-PKCE engine (`@modkit/host/node`: loopback + browser). */
export interface OAuth2Engine {
  authorize(
    request: OAuth2Request & { readonly prompter: CredentialPrompter },
  ): Promise<OAuth2Tokens>
  refresh(request: OAuth2Request & { readonly refreshToken: string }): Promise<OAuth2Tokens>
  revoke?(request: OAuth2Request & { readonly token: string }): Promise<void>
}

export interface CredentialBrokerOptions {
  readonly inventory: Inventory
  readonly store: CredentialStore
  /** Absent on a non-interactive host (CLI, MCP): acquire never asks. */
  readonly prompter?: CredentialPrompter
  readonly oauth?: OAuth2Engine
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
  /** A contribution setting by extension coordinate, for `oauth.clientIdSetting`. */
  readonly setting?: (extension: string, name: string) => unknown
  /**
   * Non-interactive hosts (CLI, MCP, automation): the variable a declaration names in
   * `environment` answers when the store has nothing. Read-only — sign-out cannot remove it. A
   * scoped credential takes `scope:value` entries separated by `;` or newlines, or one value for
   * every scope; an OAuth variable holds an access token (no refresh).
   */
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export interface DeclaredCredential {
  readonly extension: string
  readonly requirement: CredentialRequirement
}

export interface CredentialBroker {
  /** Every declared credential of the inventory, for an accounts view. */
  declared(): readonly DeclaredCredential[]
  /** Status only — what an accounts view, MCP or an AI may see. */
  status(id: string, scope?: string): Promise<CredentialStatus>
  /** The port an extension's contributions receive; it reaches only that extension's declarations. */
  portFor(extension: string): CredentialPort
  signOut(id: string, scope?: string): Promise<void>
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const EXPIRY_MARGIN_MS = 30_000

const refused = (code: string, message: string) =>
  new ModkitError({ code: `x3.host/credential-${code}`, message })

/** Hex of a 128/192/256-bit key typed as hex or base64; undefined when it is neither. */
export function symmetricKeyHex(value: string): string | undefined {
  const text = value.trim().replace(/^0x/iu, '')
  if (/^[0-9a-fA-F]+$/u.test(text) && [32, 48, 64].includes(text.length)) return text.toLowerCase()
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(text)) return undefined
  let binary: string
  try {
    binary = atob(text.replace(/-/gu, '+').replace(/_/gu, '/'))
  } catch {
    return undefined
  }
  if (![16, 24, 32].includes(binary.length)) return undefined
  return [...binary].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

const hexBytes = (hex: string) =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  )

/** A URL inside the declared audience: same origin, path under the declared path. */
export function credentialAudienceAllows(url: string, audience: readonly string[]): boolean {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return false
  }
  if (target.username !== '' || target.password !== '') return false
  return audience.some(entry => {
    try {
      const base = new URL(entry)
      return target.origin === base.origin && target.pathname.startsWith(base.pathname)
    } catch {
      return false
    }
  })
}

/** A store that keeps nothing past the process: CLI and MCP, where secrets come from the environment. */
export function createMemoryCredentialStore(): CredentialStore {
  const values = new Map<string, string>()
  return Object.freeze({
    get: async (key: string) => values.get(key),
    set: async (key: string, value: string) => void values.set(key, value),
    delete: async (key: string) => void values.delete(key),
  })
}

export function createCredentialBroker(options: CredentialBrokerOptions): CredentialBroker {
  const now = options.now ?? Date.now
  const send = options.fetch ?? globalThis.fetch
  const declarations = new Map<string, DeclaredCredential>()
  for (const extension of options.inventory.extensions) {
    const coordinate = `${extension.manifest.publisher}/${extension.manifest.id}`
    for (const requirement of extension.manifest.credentials ?? [])
      if (!declarations.has(requirement.id))
        declarations.set(requirement.id, Object.freeze({ extension: coordinate, requirement }))
  }

  const declaration = (id: string): DeclaredCredential => {
    const found = declarations.get(id)
    if (found === undefined)
      throw refused('undeclared', `no extension declares the credential ${id}`)
    return found
  }
  const keyOf = (requirement: CredentialRequirement, scope: string | undefined) => {
    if (
      scope !== undefined &&
      (scope.length === 0 || scope.length > 128 || /[\u0000-\u001f]/u.test(scope))
    )
      throw refused('invalid', `the scope of ${requirement.id} is not a short printable name`)
    return `modkit.credential/${requirement.id}${requirement.scoped === true && scope !== undefined ? `#${scope}` : ''}`
  }
  /** The value a declaration's environment variable gives for a store key, in stored form. */
  const fromEnvironment = (key: string): string | undefined => {
    const [id = '', scope] = key.slice('modkit.credential/'.length).split(/#(.*)/su)
    const requirement = declarations.get(id)?.requirement
    const raw =
      requirement?.environment === undefined
        ? undefined
        : options.environment?.[requirement.environment]?.trim()
    if (requirement === undefined || raw === undefined || raw === '') return undefined
    let value: string | undefined = raw
    if (requirement.scoped === true) {
      const entries = raw
        .split(/[;\n]/u)
        .map(entry => entry.trim())
        .filter(entry => entry !== '')
      if (entries.every(entry => entry.includes(':'))) {
        const pairs = new Map(
          entries.map(entry => {
            const at = entry.indexOf(':')
            return [entry.slice(0, at).trim(), entry.slice(at + 1).trim()] as const
          }),
        )
        value = scope === undefined ? undefined : pairs.get(scope)
      }
    }
    if (value === undefined || value === '') return undefined
    if (requirement.kind === 'symmetric-key') return symmetricKeyHex(value)
    if (requirement.kind === 'oauth2-pkce') return JSON.stringify({ accessToken: value })
    return value
  }
  const read = async (key: string) => (await options.store.get(key)) ?? fromEnvironment(key)
  const tokensOf = (text: string | undefined): OAuth2Tokens | undefined => {
    if (text === undefined) return undefined
    try {
      const value = JSON.parse(text) as OAuth2Tokens
      return typeof value.accessToken === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }
  const readTokens = async (key: string) => tokensOf(await read(key))
  const expired = (tokens: OAuth2Tokens) =>
    tokens.expiresAt !== undefined && tokens.expiresAt <= now() + EXPIRY_MARGIN_MS
  const clientIdOf = (entry: DeclaredCredential) => {
    const oauth = entry.requirement.oauth
    const fromSetting =
      oauth?.clientIdSetting === undefined
        ? undefined
        : options.setting?.(entry.extension, oauth.clientIdSetting)
    const clientId =
      typeof fromSetting === 'string' && fromSetting !== '' ? fromSetting : oauth?.clientId
    if (oauth === undefined || clientId === undefined)
      throw refused(
        'unconfigured',
        `${entry.requirement.id} has no OAuth client id (setting ${oauth?.clientIdSetting ?? '—'})`,
      )
    return clientId
  }

  const status = async (entry: DeclaredCredential, scope?: string): Promise<CredentialStatus> => {
    const key = keyOf(entry.requirement, scope)
    if (entry.requirement.kind === 'oauth2-pkce') {
      const tokens = await readTokens(key)
      if (tokens === undefined) return 'missing'
      return expired(tokens) && tokens.refreshToken === undefined ? 'expired' : 'available'
    }
    return (await read(key)) === undefined ? 'missing' : 'available'
  }

  // A refresh token may be single-use (Roblox): one refresh per key at a time, and the new token is
  // stored before anyone else reads the key again.
  const refreshing = new Map<string, Promise<string | undefined>>()
  /** A live access token, refreshed when it has run out; undefined when there is none. */
  const accessToken = async (
    entry: DeclaredCredential,
    scope: string | undefined,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<string | undefined> => {
    const key = keyOf(entry.requirement, scope)
    const pending = refreshing.get(key)
    if (pending !== undefined) return pending
    const tokens = await readTokens(key)
    if (tokens === undefined) return undefined
    if (!force && !expired(tokens)) return tokens.accessToken
    const again = refreshing.get(key)
    if (again !== undefined) return again
    const { oauth } = options
    if (tokens.refreshToken === undefined || oauth === undefined) return undefined
    const refreshToken = tokens.refreshToken
    const renewal = (async () => {
      const renewed = await oauth.refresh({
        requirement: entry.requirement,
        clientId: clientIdOf(entry),
        refreshToken,
        ...(signal === undefined ? {} : { signal }),
      })
      const kept = { ...renewed, refreshToken: renewed.refreshToken ?? refreshToken }
      await options.store.set(key, JSON.stringify(kept))
      return kept.accessToken
    })().finally(() => refreshing.delete(key))
    refreshing.set(key, renewal)
    return renewal
  }

  const acquire = async (
    entry: DeclaredCredential,
    acquireOptions: CredentialAcquireOptions,
    signal?: AbortSignal,
  ): Promise<CredentialStatus> => {
    const { requirement } = entry
    const scope = acquireOptions.scope
    const current = await status(entry, scope)
    if (current === 'available' || !acquireOptions.interactive || options.prompter === undefined)
      return current
    const key = keyOf(requirement, scope)
    const prompt = {
      id: requirement.id,
      kind: requirement.kind,
      label: requirement.label,
      reason: acquireOptions.reason,
      ...(scope === undefined ? {} : { scope }),
    }
    if (requirement.kind === 'api-key') {
      const value = (await options.prompter.secret(prompt))?.trim()
      if (value !== undefined && value !== '') await options.store.set(key, value)
    } else if (requirement.kind === 'symmetric-key') {
      const value = await options.prompter.secret(prompt)
      if (value !== undefined) {
        const hex = symmetricKeyHex(value)
        if (hex === undefined)
          throw refused(
            'invalid',
            `${requirement.label}: expected a 128/192/256-bit key in hex or base64`,
          )
        await options.store.set(key, hex)
      }
    } else if (requirement.kind === 'oauth2-pkce') {
      if (options.oauth === undefined) throw refused('unsupported', 'this host has no OAuth engine')
      const tokens = await options.oauth.authorize({
        requirement,
        clientId: clientIdOf(entry),
        prompter: options.prompter,
        ...(signal === undefined ? {} : { signal }),
      })
      await options.store.set(key, JSON.stringify(tokens))
    }
    // provider-session: the extension signs in on the service's page and calls remember()
    return status(entry, scope)
  }

  const fetchWith = async (
    entry: DeclaredCredential,
    request: CredentialFetchRequest,
    signal?: AbortSignal,
  ): Promise<CredentialFetchResponse> => {
    const { requirement } = entry
    if (requirement.kind !== 'api-key' && requirement.kind !== 'oauth2-pkce')
      throw refused(
        'not-exposed',
        `${requirement.id} is a ${requirement.kind}; fetch serves API keys and OAuth`,
      )
    if (!credentialAudienceAllows(request.url, requirement.audience ?? []))
      throw refused(
        'audience',
        `${requirement.id} may not be sent to that address (outside its declared audience)`,
      )
    const header =
      requirement.kind === 'api-key' ? (requirement.header ?? 'x-api-key') : 'authorization'
    const attempt = async (force: boolean) => {
      const value =
        requirement.kind === 'api-key'
          ? await read(keyOf(requirement, request.scope))
          : await accessToken(entry, request.scope, force, signal)
      if (value === undefined)
        throw refused('missing', `${requirement.id} is not available; acquire it first`)
      const headers: Record<string, string> = {}
      for (const [name, text] of Object.entries(request.headers ?? {}))
        if (name.toLowerCase() !== header.toLowerCase() && name.toLowerCase() !== 'authorization')
          headers[name] = text
      headers[header] = requirement.kind === 'api-key' ? value : `Bearer ${value}`
      return send(request.url, {
        method: request.method ?? 'GET',
        headers,
        // a redirect must not carry the credential elsewhere: the extension sees it and asks again
        redirect: 'manual',
        ...(request.body === undefined
          ? {}
          : {
              body: typeof request.body === 'string' ? request.body : Uint8Array.from(request.body),
            }),
        ...(signal === undefined ? {} : { signal }),
      })
    }
    let response = await attempt(false)
    if (response.status === 401 && requirement.kind === 'oauth2-pkce')
      response = await attempt(true)
    // A redirect (a temporary CDN address) is followed without the credential and without the
    // extension's headers: the credential stays inside the audience.
    const followable = (request.method ?? 'GET').toUpperCase() === 'GET'
    for (let hops = 0; followable && REDIRECTS.has(response.status); hops += 1) {
      const location = response.headers.get('location')
      if (location === null) break
      if (hops === MAX_REDIRECTS) throw refused('redirects', `more than ${MAX_REDIRECTS} redirects`)
      const next = new URL(location, response.url || request.url)
      if (next.protocol !== 'https:') throw refused('audience', 'a redirect left https')
      await response.body?.cancel()
      response = await send(next.href, {
        method: 'GET',
        redirect: 'manual',
        ...(signal === undefined ? {} : { signal }),
      })
    }
    const limit = request.maxBytes ?? DEFAULT_MAX_BYTES
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > limit) throw refused('too-large', `the response exceeds ${limit} bytes`)
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > limit) throw refused('too-large', `the response exceeds ${limit} bytes`)
    const headers: Record<string, string> = {}
    response.headers.forEach((text, name) => {
      headers[name.toLowerCase()] = text
    })
    return Object.freeze({ status: response.status, headers: Object.freeze(headers), body })
  }

  const secret = async (
    entry: DeclaredCredential,
    scope?: string,
  ): Promise<Uint8Array | undefined> => {
    const { requirement } = entry
    if (requirement.kind !== 'symmetric-key' && requirement.kind !== 'provider-session')
      throw refused(
        'not-exposed',
        `${requirement.id} is a ${requirement.kind}; its value stays with the host`,
      )
    const value = await read(keyOf(requirement, scope))
    if (value === undefined) return undefined
    return requirement.kind === 'symmetric-key' ? hexBytes(value) : new TextEncoder().encode(value)
  }

  const forget = async (entry: DeclaredCredential, scope?: string, signal?: AbortSignal) => {
    const key = keyOf(entry.requirement, scope)
    if (entry.requirement.kind === 'oauth2-pkce' && options.oauth?.revoke !== undefined) {
      const tokens = tokensOf(await options.store.get(key))
      const token = tokens?.refreshToken ?? tokens?.accessToken
      if (token !== undefined && entry.requirement.oauth?.revocationEndpoint !== undefined) {
        try {
          await options.oauth.revoke({
            requirement: entry.requirement,
            clientId: clientIdOf(entry),
            token,
            ...(signal === undefined ? {} : { signal }),
          })
        } catch {
          // sign-out still removes the local secret when the service cannot be reached
        }
      }
    }
    await options.store.delete(key)
  }

  return Object.freeze<CredentialBroker>({
    declared: () => Object.freeze([...declarations.values()]),
    status: async (id, scope) => status(declaration(id), scope),
    signOut: async (id, scope) => forget(declaration(id), scope),
    portFor(extension) {
      const own = (id: string) => {
        const entry = declaration(id)
        if (entry.extension !== extension)
          throw refused('undeclared', `${extension} did not declare the credential ${id}`)
        return entry
      }
      return Object.freeze<CredentialPort>({
        status: async (id, scope) => status(own(id), scope),
        acquire: async (id, acquireOptions, signal) => acquire(own(id), acquireOptions, signal),
        fetch: async (id, request, signal) => fetchWith(own(id), request, signal),
        secret: async (id, scope) => secret(own(id), scope),
        async remember(id, value, scope) {
          const entry = own(id)
          if (entry.requirement.kind !== 'provider-session')
            throw refused('not-exposed', `${id} is not a provider session; the broker acquires it`)
          if (value === '') throw refused('invalid', `${id}: an empty ticket is not kept`)
          await options.store.set(keyOf(entry.requirement, scope), value)
        },
        forget: async (id, scope, signal) => forget(own(id), scope, signal),
      })
    },
  })
}
