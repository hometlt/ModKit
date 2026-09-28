import { createHash, randomUUID } from 'node:crypto'
import { revisionId, type ArtifactByteSource } from '@modkit/sdk'
import type { Diagnostic } from '@modkit/core'
import {
  createCompanionInputResolver,
  createContentAssetOrigin,
  subjectOpenSnapshot,
  resolveCommonPresentationPlan,
  type SubjectServices,
  type SubjectOpener,
} from '@modkit/host'
import type { ContentSources } from '@modkit/vfs/content-sources'
import { STAGE_ORDER } from './view-policy.js'

export type ContentSourceReader = (
  uri: string,
  maxBytes: number,
  signal?: AbortSignal,
) => Promise<Uint8Array>
/** The source and path a `modkit-source://<authority>/<source>/<path>` subject names. */
export function contentSourceTarget(
  requested: string,
): { readonly sourceId: string; readonly path: string } | undefined {
  if (!URL.canParse(requested)) return undefined
  const [sourceId, ...parts] = new URL(requested).pathname
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  return sourceId === undefined ? undefined : { sourceId, path: parts.join('/') }
}

/**
 * Read-only source route shared by the native Explorer's custom editor and palette commands. With
 * the window's `contentSources` the file reaches the resources of its mod, as a file on disk does
 * (a model in the game's storage, its texture in another package of the chain).
 */
export function contentSourceOpener(
  services: SubjectServices,
  read: ContentSourceReader,
  contentSources?: () => Promise<ContentSources | undefined>,
): SubjectOpener {
  return async (requested, signal) => {
    signal?.throwIfAborted()
    const bytes = await read(requested, 64 * 1024 * 1024, signal)
    signal?.throwIfAborted()
    const sources = await contentSources?.()
    const target = contentSourceTarget(requested)
    const companionDiagnostics: Diagnostic[] = []
    const source: ArtifactByteSource = {
      kind: 'bytes',
      ref: { id: requested, uri: requested },
      revision: revisionId(
        `content-hash.sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      ),
      size: BigInt(bytes.length),
      async read(offset, length) {
        if (offset < 0n || length < 0 || offset + BigInt(length) > BigInt(bytes.length))
          throw new Error('Source read out of bounds')
        return bytes.slice(Number(offset), Number(offset) + length)
      },
      async *stream() {
        yield bytes
      },
    }
    const result = await services.open({
      source,
      path: requested,
      intent: 'full',
      grant: { id: `content-source:${randomUUID()}`, classes: ['read-source'] },
      ...(sources === undefined || target === undefined
        ? {}
        : {
            resolveInput: createCompanionInputResolver(
              createContentAssetOrigin({
                contentSources: sources,
                target,
                onDiagnostic: item => companionDiagnostics.push(item),
              }),
            ),
          }),
      budget: {
        maxInputBytes: BigInt(bytes.length || 1),
        maxDepth: 256,
        maxNodes: 1_000_000,
        maxScalarBytes: 64 * 1024 * 1024,
        maxDiagnostics: 1000,
        deadlineMs: 30_000,
      },
      ...(signal === undefined ? {} : { signal }),
    })
    const id = randomUUID()
    const snapshot = subjectOpenSnapshot({
      result,
      sessionId: () => id,
      diagnostics: [...result.diagnostics, ...companionDiagnostics].map(item => ({
        code: item.code,
        message: item.message,
        severity: item.severity,
      })),
    })
    if (result.state !== 'opened' || snapshot.state !== 'opened') return { snapshot }
    try {
      const presentation = await resolveCommonPresentationPlan(
        result.descriptor,
        {
          sessionId: id,
          providerId: result.selected.contributionId,
          variantId: result.selected.variantId,
        },
        { availableStageIds: STAGE_ORDER },
      )
      return {
        snapshot: {
          ...snapshot,
          ...(presentation === undefined ? {} : { presentation: presentation.plan }),
        },
        session: result.session,
      }
    } catch (error) {
      await result.session.dispose()
      throw error
    }
  }
}
