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
} from '@modkitx-x3/host'
import type { MessagePortLike } from '@modkitx-x3/host/execution'

import { ELECTRON_SUBJECT_SERVICES_URL } from './subject-rpc.js'

/** The previewer's session: descriptor, data sources, the operation session, dispose. */
export type ElectronSubjectSession = SubjectPreviewSession
export type ElectronSubjectOpenResult = SubjectClientOpenResult
/** `open`, `edit` (the S14 editing arm) and `close`. */
export type ElectronSubjectClient = SubjectRpcClient

export interface ConnectElectronSubjectClientOptions {
  readonly port: MessagePortLike | MessagePort
  readonly session: string
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

export async function connectElectronSubjectClient(
  options: ConnectElectronSubjectClientOptions,
): Promise<ElectronSubjectClient> {
  return connectSubjectRpc({
    port: options.port as MessagePortLike,
    session: options.session,
    moduleUrl: ELECTRON_SUBJECT_SERVICES_URL,
    contributionId: 'org.modkitx.app.electron/subject-services',
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
}
