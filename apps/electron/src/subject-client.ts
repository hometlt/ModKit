/**
 * The renderer's subject client.
 *
 * This was a fork of `connectSubjectRpc` that existed for exactly one missing method: the renderer
 * needs `operations()` — the operation toolbar, the transport bar and the archive stage's entry
 * preview are all invocations on it — and the shared client's session facade omitted it even though
 * `x3.abi/asset-session@1` declares it and the wire always carried it. `SubjectPreviewSession` now
 * exposes it, so what is left here is the app's identity for the endpoint: the Electron
 * composition root's module URL and contribution id, which is what the serving side loaded.
 *
 * Keeping the names is deliberate — the renderer says "the Electron subject client" and gets the
 * shared one, so a future divergence has a place to live without another fork.
 */
import {
  connectSubjectRpc,
  type SubjectClientOpenResult,
  type SubjectPreviewSession,
  type SubjectRpcClient,
} from '@modkit/host'
import type { MessagePortLike } from '@modkit/host/execution'

import { ELECTRON_SUBJECT_SERVICES_URL } from './subject-rpc.js'

/** The previewer's session: descriptor, data sources, the operation session, dispose. */
export type ElectronSubjectSession = SubjectPreviewSession
export type ElectronSubjectOpenResult = SubjectClientOpenResult
/** `open`, `edit` (the S14 editing arm) and `close`. */
export type ElectronSubjectClient = SubjectRpcClient

export type ElectronSubjectNavigationEvent = Parameters<
  NonNullable<import('@modkit/host').ConnectSubjectRpcOptions['onNavigate']>
>[0]

export interface ElectronSubjectNavigationRoute {
  readonly ownsSource: (sessionId: string) => boolean
  readonly hasTarget: (target: string) => boolean
  readonly stage: (target: string, result: ElectronSubjectOpenResult) => void
  readonly open: (target: string) => Promise<void>
  readonly discard: (target: string) => void
}

/** Renderer-owned handoff from an exact attached RPC child into the existing editor route. */
export async function openElectronNavigatedSubject(
  event: ElectronSubjectNavigationEvent,
  route: ElectronSubjectNavigationRoute,
): Promise<void> {
  if (!route.ownsSource(event.sourceSessionId) || route.hasTarget(event.target)) {
    await event.result.session.dispose()
    throw new Error('subject navigation source or target is unavailable in this window')
  }
  route.stage(event.target, event.result)
  try {
    await route.open(event.target)
  } catch (error) {
    route.discard(event.target)
    await event.result.session.dispose().catch(() => undefined)
    throw error
  }
}

export interface ConnectElectronSubjectClientOptions {
  readonly port: MessagePortLike | MessagePort
  readonly session: string
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
  readonly onNavigate?: NonNullable<import('@modkit/host').ConnectSubjectRpcOptions['onNavigate']>
}

export async function connectElectronSubjectClient(
  options: ConnectElectronSubjectClientOptions,
): Promise<ElectronSubjectClient> {
  return connectSubjectRpc({
    port: options.port as MessagePortLike,
    session: options.session,
    moduleUrl: ELECTRON_SUBJECT_SERVICES_URL,
    contributionId: 'modkit.app.electron/subject-services',
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    ...(options.onNavigate === undefined ? {} : { onNavigate: options.onNavigate }),
  })
}
