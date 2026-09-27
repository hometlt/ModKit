/**
 * One component for signing in and keys (PLAN_UNIFIED_AUTH_2026-09-26). An extension declares what
 * it needs in `package.json#modkit.credentials`; the host's broker (`credential.broker`) asks the
 * application, keeps secrets in the application's `CredentialStore`, refreshes tokens and hands the
 * extension access through `ContributionContext.credentials`. An extension never stores a secret,
 * and an API key or OAuth token never reaches it: the broker sends the request itself, only to the
 * declared `audience`.
 */

/**
 * `api-key` — a key the user types (Roblox Open Cloud); `oauth2-pkce` — OAuth 2.0 authorization
 * code with PKCE through the system browser and a loopback redirect; `provider-session` — the
 * extension signs in on the service's own page and the broker keeps the returned ticket
 * (Battle.net); `symmetric-key` — a key the user types, optionally per `scope` (Unreal pak AES).
 */
export type CredentialKind = 'api-key' | 'oauth2-pkce' | 'provider-session' | 'symmetric-key'

export interface CredentialOAuth2Endpoints {
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly revocationEndpoint?: string
  /** A public client id; or the name of the contribution setting the user puts it in. */
  readonly clientId?: string
  readonly clientIdSetting?: string
  /** A fixed loopback port when the service registers an exact redirect; otherwise a random one. */
  readonly loopbackPort?: number
  /**
   * The redirect host: `127.0.0.1` (default, RFC 8252) or `localhost` for services that accept only
   * https or localhost redirects (Roblox); the host then also listens on ::1.
   */
  readonly loopbackHost?: 'localhost' | '127.0.0.1'
}

/** One declared credential (`package.json#modkit.credentials[]`). */
export interface CredentialRequirement {
  /** `<publisher>/<name>`: `roblox/open-cloud`, `blizzard/battlenet`, `epic-games/unreal-aes`. */
  readonly id: string
  readonly kind: CredentialKind
  readonly label: string
  /** URL prefixes `fetch` may reach with this credential (`api-key`, `oauth2-pkce`). */
  readonly audience?: readonly string[]
  /** `api-key`: the header carrying the key (default `x-api-key`). */
  readonly header?: string
  readonly scopes?: readonly string[]
  readonly oauth?: CredentialOAuth2Endpoints
  /** The credential is kept per scope (a pak key GUID, a Battle.net region). */
  readonly scoped?: boolean
  /** Non-interactive hosts (CLI, MCP) read the secret from this environment variable. */
  readonly environment?: string
}

export type CredentialStatus = 'missing' | 'available' | 'expired'

/** The application's secret storage (VS Code SecretStorage). Values are opaque strings. */
export interface CredentialStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface CredentialPromptRequest {
  readonly id: string
  readonly kind: CredentialKind
  readonly label: string
  readonly reason: string
  readonly scope?: string
}

/** How the broker asks the user; only ever on an explicit user action. */
export interface CredentialPrompter {
  /** A secret typed into a password field; undefined when the user cancels. */
  secret(request: CredentialPromptRequest): Promise<string | undefined>
  /** Open a page in the system browser (an OAuth sign-in page). */
  openExternal(url: string): Promise<boolean>
  confirm(message: string): Promise<boolean>
}

export interface CredentialAcquireOptions {
  /** Why the extension needs it, shown to the user. */
  readonly reason: string
  /** False: answer from the store only, never ask. */
  readonly interactive: boolean
  readonly scope?: string
}

export interface CredentialFetchRequest {
  readonly url: string
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Uint8Array | string
  readonly scope?: string
  /** Upper bound of the response body (default 64 MiB). */
  readonly maxBytes?: number
}

export interface CredentialFetchResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
}

/** `ContributionContext.credentials`: the credentials the extension declared, never others. */
export interface CredentialPort {
  status(id: string, scope?: string, signal?: AbortSignal): Promise<CredentialStatus>
  /** Ask the user when needed and allowed; the resulting status. */
  acquire(
    id: string,
    options: CredentialAcquireOptions,
    signal?: AbortSignal,
  ): Promise<CredentialStatus>
  /** `api-key`, `oauth2-pkce`: the broker sends the request, adding the credential, only to `audience`. */
  fetch(
    id: string,
    request: CredentialFetchRequest,
    signal?: AbortSignal,
  ): Promise<CredentialFetchResponse>
  /** `symmetric-key` (the key bytes), `provider-session` (the kept ticket); held for one operation. */
  secret(id: string, scope?: string, signal?: AbortSignal): Promise<Uint8Array | undefined>
  /** `provider-session`: keep the ticket the service returned. */
  remember(id: string, value: string, scope?: string, signal?: AbortSignal): Promise<void>
  /** Sign out: delete the secret and revoke an OAuth token where the service allows it. */
  forget(id: string, scope?: string, signal?: AbortSignal): Promise<void>
}
