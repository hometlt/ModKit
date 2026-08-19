/**
 * The renderer's subject client — `connectSubjectRpc` plus the operation session.
 *
 * `@modkitx-x3/host`'s `SubjectPreviewSession` deliberately exposes the three methods a previewer
 * needs (descriptor, data source, dispose). Electron needs a fourth: `x3.abi/asset-session@1`
 * declares `operations()`, the wire already carries it, and the operation toolbar, the transport
 * bar and the archive stage's entry preview are all invocations on it. Rather than reach around
 * the boundary, this file composes the *same* endpoint, surfaces, module identity and limits the
 * shared client uses and keeps the extra method on the session it returns.
 *
 * It is a temporary fork with one difference. The moment `SubjectPreviewSession` grows an optional
 * `operations()`, this file collapses back to a call into `connectSubjectRpc`; the report to Root
 * carries that request.
 */
import { subjectRpcSurfaces, type SubjectOpenSnapshot } from '@modkitx-x3/host'
import {
  createEndpoint,
  framePortFromMessagePort,
  protocolLimits,
  type MessagePortLike,
} from '@modkitx-x3/host/execution'
import type { OperationSession, PresentationPlan } from '@modkitx-x3/sdk'

import { ELECTRON_SUBJECT_SERVICES_URL } from './subject-rpc.js'

/** The previewer's session shape, plus the operation session the ABI already publishes. */
export interface ElectronSubjectSession {
  readonly presentation?: PresentationPlan
  descriptor(): Promise<Record<string, unknown>>
  dataSource(contract: string, major: number): Promise<{ value: unknown }>
  /** `x3.abi/asset-session@1` `operations()`; a lease over the wire, hence a promise here. */
  operations(): Promise<OperationSession>
  dispose(): Promise<void>
}

export type ElectronSubjectOpenResult =
  | {
      readonly state: 'opened'
      readonly snapshot: Extract<SubjectOpenSnapshot, { state: 'opened' }>
      readonly session: ElectronSubjectSession
    }
  | {
      readonly state: 'unresolved'
      readonly snapshot: Extract<SubjectOpenSnapshot, { state: 'unresolved' }>
    }

export interface ElectronSubjectClient {
  open(path: string): Promise<ElectronSubjectOpenResult>
  close(reason: string): Promise<void>
}

export interface ConnectElectronSubjectClientOptions {
  readonly port: MessagePortLike | MessagePort
  readonly session: string
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

interface ServicesProxy {
  open(path: string): Promise<SubjectOpenSnapshot>
  attach(sessionId: string): Promise<{
    descriptor(): Promise<Record<string, unknown>>
    dataSource(contract: string, major: number): Promise<{ value: unknown }>
    operations(): Promise<OperationSession>
    dispose(): Promise<void>
  }>
}

export async function connectElectronSubjectClient(
  options: ConnectElectronSubjectClientOptions,
): Promise<ElectronSubjectClient> {
  const endpoint = createEndpoint({
    role: 'host',
    port: framePortFromMessagePort(options.port as MessagePortLike),
    session: options.session,
    generation: 1,
    surfaces: subjectRpcSurfaces(),
    limits: protocolLimits({ defaultCallDeadlineMs: 60_000 }),
    ...(options.onDiagnostic === undefined
      ? {}
      : {
          onDiagnostic: (diagnostic: { code: string; message: string }) =>
            options.onDiagnostic?.(diagnostic),
        }),
    onFailure: failure => {
      options.onDiagnostic?.({
        code: 'x3.app/subject-rpc-failed',
        message: `${failure.code}: ${failure.message}`,
      })
    },
  })
  const loaded = await endpoint.load({
    moduleUrl: ELECTRON_SUBJECT_SERVICES_URL,
    contributionId: 'org.modkitx.app.electron/subject-services',
    variantId: 'main',
    artifactDigest: 'sha256:app-composition',
  })
  const services = endpoint.materialize(loaded.root) as unknown as ServicesProxy

  return {
    async open(path: string): Promise<ElectronSubjectOpenResult> {
      const snapshot = await services.open(path)
      if (snapshot.state !== 'opened') return { state: 'unresolved', snapshot }
      const proxy = await services.attach(snapshot.sessionId)
      const session: ElectronSubjectSession = {
        ...(snapshot.presentation === undefined ? {} : { presentation: snapshot.presentation }),
        // the descriptor already crossed inside the snapshot; asking again would re-run the codec
        descriptor: async () => snapshot.descriptor,
        dataSource: (contract, major) => proxy.dataSource(contract, major),
        operations: () => proxy.operations(),
        dispose: () => proxy.dispose(),
      }
      return { state: 'opened', snapshot, session }
    },
    close: (reason: string) => endpoint.close(reason),
  }
}
