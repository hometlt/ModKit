/** What an installed VSIX carries for its own acceptance: the format smoke corpus. */
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import * as vscode from 'vscode'

import { containerUriPath, CONTAINER_SCHEME } from './container-uri.js'
import {
  FORMAT_SMOKE_WORKSPACE_ROOT_ENV,
  FORMAT_SMOKE_SC2_ROOT_ENV,
  FORMAT_SMOKE_WARZONE_ROOT_ENV,
} from './constants.js'

export const FORMAT_SMOKE_CASE_IDS = Object.freeze([
  'image-dds',
  'image-png',
  'image-tga',
  'image-jpeg',
  'document-odt',
  'data-xml',
  'archive-zip',
  'archive-warzone-wz',
  'archive-mpq',
  'casc-dds',
  'audio-wav',
  'audio-ogg',
  'model-m3',
  'model-warzone-pie',
])

export interface FormatSmokeRouteStep {
  readonly formatId: string
  readonly extensionId: string
  readonly contributionId: string
}

export interface FormatSmokeAuthorityCase {
  readonly id: string
  readonly family: string
  readonly formats: readonly string[]
  readonly route: readonly FormatSmokeRouteStep[]
  readonly stage: 'raster' | 'tree-text' | 'tree' | 'metadata-tree' | 'model-or-wireframe'
  readonly corpus:
    | { readonly kind: 'named-exclusion'; readonly reason: string }
    | {
        readonly kind:
          'workspace-reference' | 'warzone-install-file' | 'sc2-install-file' | 'sc2-casc-entry'
        readonly path: string
        readonly bytes: number
        readonly sha256: string
      }
    | {
        readonly kind: 'warzone-wz-entry'
        readonly container: string
        readonly path: string
        readonly bytes: number
        readonly sha256: string
      }
}

export interface FormatSmokeAuthority {
  readonly kind: 'x3.ga-recovery/format-family-smoke'
  readonly schemaVersion: 1
  readonly cases: readonly FormatSmokeAuthorityCase[]
  readonly namedExclusions: readonly { readonly id: string; readonly reason: string }[]
}

export interface FormatSmokeOpenCase {
  readonly kind: 'open'
  readonly id: string
  readonly family: string
  readonly stage: FormatSmokeAuthorityCase['stage']
  readonly route: readonly FormatSmokeRouteStep[]
  readonly source:
    | {
        readonly kind: 'file'
        readonly path: string
        readonly uri: vscode.Uri
        readonly bytes: number
        readonly sha256: string
      }
    | {
        readonly kind: 'container-entry'
        readonly container: string
        readonly entry: string
        readonly uri: vscode.Uri
        readonly bytes: number
        readonly sha256: string
      }
}

export interface FormatSmokeExcludedCase {
  readonly kind: 'excluded'
  readonly id: string
  readonly family: string
  readonly stage: FormatSmokeAuthorityCase['stage']
  readonly route: readonly FormatSmokeRouteStep[]
  readonly reason: string
}

export type FormatSmokeCase = FormatSmokeOpenCase | FormatSmokeExcludedCase

export const formatSmokeObject = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export interface AttemptedContainerCandidate {
  readonly contributionId: string
  readonly formatIds: readonly string[]
  readonly state: 'rejected' | 'detected' | 'selected'
  readonly diagnostics: readonly {
    readonly severity: string
    readonly code: string
    readonly message: string
  }[]
}

export const isAttemptedContainerCandidate = (
  value: unknown,
): value is AttemptedContainerCandidate => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.contributionId === 'string' &&
    Array.isArray(candidate.formatIds) &&
    candidate.formatIds.every((formatId: unknown) => typeof formatId === 'string') &&
    (candidate.state === 'rejected' ||
      candidate.state === 'detected' ||
      candidate.state === 'selected') &&
    Array.isArray(candidate.diagnostics) &&
    candidate.diagnostics.every(diagnostic => {
      if (diagnostic === null || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) {
        return false
      }
      const item = diagnostic as Record<string, unknown>
      return (
        typeof item.severity === 'string' &&
        typeof item.code === 'string' &&
        typeof item.message === 'string'
      )
    })
  )
}

export const formatSmokeConfinedPath = (root: string, portable: string, label: string): string => {
  if (portable.includes('\0')) throw new TypeError(`${label} contains NUL`)
  const normalized = portable.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized)) {
    throw new TypeError(`${label} escapes its explicit root`)
  }
  const target = resolve(root, ...normalized.split('/'))
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new TypeError(`${label} escapes its explicit root`)
  }
  return target
}

export const formatSmokeEntryPath = (value: string, label: string): string => {
  const normalized = value.replaceAll('\\', '/')
  if (
    normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`${label} is not a confined container entry`)
  }
  return normalized
}

export function readPackagedFormatSmoke(extensionRoot: string): {
  readonly authority: FormatSmokeAuthority
  readonly sha256: string
} {
  const path = join(extensionRoot, 'dist-app', 'format-smoke.v1.json')
  const bytes = readFileSync(path)
  const parsed = formatSmokeObject(JSON.parse(bytes.toString('utf8')), 'format smoke authority')
  if (parsed.kind !== 'x3.ga-recovery/format-family-smoke' || parsed.schemaVersion !== 1) {
    throw new TypeError('format smoke authority has the wrong kind or schemaVersion')
  }
  const cases = parsed.cases
  if (!Array.isArray(cases) || cases.length !== FORMAT_SMOKE_CASE_IDS.length) {
    throw new TypeError('format smoke authority must contain exactly 14 cases')
  }
  const ids = cases.map(item => formatSmokeObject(item, 'format smoke case').id)
  if (JSON.stringify(ids) !== JSON.stringify(FORMAT_SMOKE_CASE_IDS)) {
    throw new TypeError(`format smoke authority case order is ${JSON.stringify(ids)}`)
  }
  const exclusions = parsed.namedExclusions
  if (!Array.isArray(exclusions) || exclusions.length !== 0) {
    throw new TypeError('format smoke authority must contain no exclusions')
  }
  return Object.freeze({
    authority: parsed as unknown as FormatSmokeAuthority,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  })
}

export const requiredFormatSmokeRoot = (environment: string): string => {
  const value = process.env[environment]
  if (value === undefined || value.trim() === '' || !isAbsolute(value)) {
    throw new TypeError(`${environment} must name an absolute root`)
  }
  return resolve(value)
}

export function resolvePackagedFormatSmokeCases(
  authority: FormatSmokeAuthority,
): readonly FormatSmokeCase[] {
  const workspaceRoot = requiredFormatSmokeRoot(FORMAT_SMOKE_WORKSPACE_ROOT_ENV)
  const sc2Root = requiredFormatSmokeRoot(FORMAT_SMOKE_SC2_ROOT_ENV)
  const warzoneRoot = requiredFormatSmokeRoot(FORMAT_SMOKE_WARZONE_ROOT_ENV)
  return Object.freeze(
    authority.cases.map(entry => {
      const common = {
        id: entry.id,
        family: entry.family,
        stage: entry.stage,
        route: Object.freeze(
          entry.route.map(step =>
            Object.freeze({
              formatId: step.formatId,
              extensionId: step.extensionId,
              contributionId: step.contributionId,
            }),
          ),
        ),
      }
      if (entry.corpus.kind === 'named-exclusion') {
        return Object.freeze({
          ...common,
          kind: 'excluded' as const,
          reason: entry.corpus.reason,
        })
      }
      const corpus = entry.corpus
      if (corpus.kind === 'sc2-casc-entry') {
        const member = formatSmokeEntryPath(corpus.path, `${entry.id}.corpus.path`)
        return Object.freeze({
          ...common,
          kind: 'open' as const,
          source: Object.freeze({
            kind: 'container-entry' as const,
            container: sc2Root,
            entry: member,
            uri: vscode.Uri.from({
              scheme: CONTAINER_SCHEME,
              path: containerUriPath(sc2Root, member),
            }),
            bytes: corpus.bytes,
            sha256: corpus.sha256,
          }),
        })
      }
      if (corpus.kind === 'warzone-wz-entry') {
        const container = formatSmokeConfinedPath(
          warzoneRoot,
          corpus.container,
          `${entry.id}.corpus.container`,
        )
        const member = formatSmokeEntryPath(corpus.path, `${entry.id}.corpus.path`)
        return Object.freeze({
          ...common,
          kind: 'open' as const,
          source: Object.freeze({
            kind: 'container-entry' as const,
            container,
            entry: member,
            uri: vscode.Uri.from({
              scheme: CONTAINER_SCHEME,
              path: containerUriPath(container, member),
            }),
            bytes: corpus.bytes,
            sha256: corpus.sha256,
          }),
        })
      }
      const root =
        corpus.kind === 'workspace-reference'
          ? workspaceRoot
          : corpus.kind === 'sc2-install-file'
            ? sc2Root
            : warzoneRoot
      const path = formatSmokeConfinedPath(root, corpus.path, `${entry.id}.corpus.path`)
      return Object.freeze({
        ...common,
        kind: 'open' as const,
        source: Object.freeze({
          kind: 'file' as const,
          path,
          uri: vscode.Uri.file(path),
          bytes: corpus.bytes,
          sha256: corpus.sha256,
        }),
      })
    }),
  )
}

export async function formatSmokeFileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
