import { throwIfAborted } from '@modkitx-x3/core'
import { decodeM3Animations } from './animation.node.js'
import { decodeM3Attachments } from './attachments.node.js'
import { decodeM3Skeleton } from './skeleton.node.js'

const MAX_SIDECARS = 64

function diagnostic(code, message, severity = 'warning') {
  return Object.freeze({
    id: `x3.m3/${code}`,
    code: `x3.m3/${code}`,
    category: 'dependency',
    severity,
    message,
  })
}

function skeletonsCompatible(base, sidecar) {
  if (base.fatal || sidecar.fatal || base.bones.length !== sidecar.bones.length) return false
  return base.bones.every((bone, index) => {
    const other = sidecar.bones[index]
    return other?.parentIndex === bone.parentIndex && other.name === bone.name
  })
}

async function exactBytes(source, budget, totalBytes, signal, logicalId) {
  if (source.kind !== 'bytes') {
    throw new TypeError(`M3A «${logicalId}» did not resolve to a byte source`)
  }
  const size = source.size
  if (size === undefined || size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`M3A «${logicalId}» has no bounded readable size`)
  }
  if (size > budget.maxInputBytes || totalBytes + size > BigInt(budget.maxScalarBytes)) {
    throw new RangeError(`M3A «${logicalId}» exceeds the sidecar byte budget`)
  }
  const bytes = await source.read(0n, Number(size), signal)
  if (BigInt(bytes.byteLength) !== size) {
    throw new TypeError(`M3A «${logicalId}» returned a short read`)
  }
  return bytes
}

/**
 * Resolve exact, caller-supplied M3A logical ids through `ResourceSessionPort` and project their
 * verified clips. This function deliberately has no discovery surface: no stem matching, sibling
 * listing, path construction or ambient URI can occur here. A candidate is admitted only when its
 * declared M3A hash intersects the base model, its complete skeleton matches, and it publishes an
 * executable clip.
 */
export async function resolveM3AnimationSidecars({
  baseBytes,
  candidates,
  resources,
  budget,
  signal,
}) {
  throwIfAborted(signal)
  if (!Array.isArray(candidates) || candidates.length > Math.min(MAX_SIDECARS, budget.maxNodes)) {
    throw new RangeError(`M3A candidates exceed the ${MAX_SIDECARS}-sidecar budget`)
  }
  const baseAttachments = await decodeM3Attachments(baseBytes, budget, signal)
  const baseSkeleton = await decodeM3Skeleton(baseBytes, budget, signal)
  const acceptedHashes = new Set(baseAttachments.animationHashes)
  const clips = []
  const references = []
  const accepted = []
  const diagnostics = [...baseAttachments.issues, ...baseSkeleton.issues]
  let totalBytes = 0n

  if (baseAttachments.fatal || baseSkeleton.fatal) {
    diagnostics.push(
      diagnostic('m3a-base-refused', 'the base M3 attachment hashes or skeleton were refused'),
    )
    return Object.freeze({
      clips: Object.freeze(clips),
      references: Object.freeze(references),
      accepted: Object.freeze(accepted),
      diagnostics: Object.freeze(diagnostics),
      provenance: resources.provenance(),
    })
  }

  for (const [candidateIndex, candidate] of candidates.entries()) {
    throwIfAborted(signal)
    if (typeof candidate?.logicalId !== 'string' || candidate.logicalId.trim() === '') {
      throw new TypeError(`M3A candidate ${candidateIndex} needs an exact logicalId`)
    }
    const result = await resources.resolve(
      {
        id: `m3a-${candidateIndex}`,
        logicalId: candidate.logicalId,
        role: 'sidecar',
        scopes: candidate.scopes ?? ['workspace-dependency-layer'],
      },
      signal,
    )
    if (result.state === 'unresolved') {
      diagnostics.push(
        diagnostic(
          'm3a-sidecar-unavailable',
          `M3A «${candidate.logicalId}» was ${result.reason}`,
          'information',
        ),
      )
      continue
    }
    try {
      if (
        candidate.expectedRevision !== undefined &&
        String(candidate.expectedRevision) !== String(result.revision)
      ) {
        diagnostics.push(
          diagnostic(
            'm3a-sidecar-stale',
            `M3A «${candidate.logicalId}» resolved at ${String(result.revision)}, not the expected revision`,
          ),
        )
        continue
      }
      let bytes
      try {
        bytes = await exactBytes(
          result.lease.value,
          budget,
          totalBytes,
          signal,
          candidate.logicalId,
        )
      } catch (error) {
        diagnostics.push(
          diagnostic(
            error instanceof RangeError ? 'm3a-sidecar-budget-exceeded' : 'm3a-sidecar-read-failed',
            error instanceof Error
              ? error.message
              : `M3A «${candidate.logicalId}» could not be read`,
          ),
        )
        continue
      }
      totalBytes += BigInt(bytes.byteLength)
      const [sidecarAttachments, sidecarSkeleton, animation] = await Promise.all([
        decodeM3Attachments(bytes, budget, signal),
        decodeM3Skeleton(bytes, budget, signal),
        decodeM3Animations(bytes, budget, signal),
      ])
      diagnostics.push(...sidecarAttachments.issues, ...sidecarSkeleton.issues, ...animation.issues)
      if (sidecarAttachments.fatal || sidecarSkeleton.fatal || animation.fatal) {
        diagnostics.push(
          diagnostic('m3a-sidecar-parse-failed', `M3A «${candidate.logicalId}» was refused`),
        )
        continue
      }
      if (
        acceptedHashes.size === 0 ||
        !sidecarAttachments.animationHashes.some(hash => acceptedHashes.has(hash))
      ) {
        diagnostics.push(
          diagnostic(
            'm3a-sidecar-hash-mismatch',
            `M3A «${candidate.logicalId}» does not match an explicit base-model animation hash`,
          ),
        )
        continue
      }
      if (!skeletonsCompatible(baseSkeleton, sidecarSkeleton)) {
        diagnostics.push(
          diagnostic(
            'm3a-sidecar-skeleton-mismatch',
            `M3A «${candidate.logicalId}» uses an incompatible skeleton`,
          ),
        )
        continue
      }
      const executable = animation.clips.filter(clip => clip.channels.length > 0)
      if (executable.length === 0) {
        diagnostics.push(
          diagnostic(
            'm3a-sidecar-no-animations',
            `M3A «${candidate.logicalId}» publishes no executable animation channels`,
          ),
        )
        continue
      }
      clips.push(
        ...executable.map((clip, clipIndex) =>
          Object.freeze({
            ...clip,
            id: `m3a-${candidateIndex}-sequence-${clipIndex}`,
            provenance: 'companion',
          }),
        ),
      )
      references.push(
        Object.freeze({
          id: candidate.logicalId,
          role: 'sidecar',
          provenance: 'companion',
          bytes: bytes.byteLength,
        }),
      )
      accepted.push(
        Object.freeze({
          logicalId: candidate.logicalId,
          revision: result.revision,
          bytes: bytes.byteLength,
          hashes: sidecarAttachments.animationHashes,
          clips: executable.length,
        }),
      )
    } finally {
      await result.lease.release()
    }
  }
  return Object.freeze({
    clips: Object.freeze(clips),
    references: Object.freeze(references),
    accepted: Object.freeze(accepted),
    diagnostics: Object.freeze(diagnostics),
    provenance: resources.provenance(),
  })
}

function refusedDiscovery(resources, receipt, code, message, severity = 'warning') {
  return Object.freeze({
    clips: Object.freeze([]),
    references: Object.freeze([]),
    accepted: Object.freeze([]),
    diagnostics: Object.freeze([diagnostic(code, message, severity)]),
    provenance: resources.provenance(),
    discovery: receipt,
  })
}

/**
 * Discover M3A candidates inside caller-owned logical roots and admit them through the exact same
 * hash + skeleton + executable-channel gate as explicit candidates.
 *
 * `candidateDiscovery` is a host-owned namespace adapter. The codec never sees a filesystem path,
 * never derives a sibling/stem prefix and never broadens the roots selected by the game provider.
 * Discovery must finish completely before any candidate is opened; a truncated namespace result
 * therefore cannot attach an arbitrary prefix of the available sidecars.
 */
export async function discoverM3AnimationSidecars({
  baseBytes,
  candidateDiscovery,
  resources,
  budget,
  signal,
}) {
  throwIfAborted(signal)
  if (typeof candidateDiscovery?.discover !== 'function') {
    throw new TypeError('M3A discovery requires a candidate discovery port')
  }
  const discovered = await candidateDiscovery.discover(signal)
  throwIfAborted(signal)
  if (discovered?.state === 'refused') {
    return refusedDiscovery(
      resources,
      discovered.receipt,
      `m3a-discovery-${discovered.reason}`,
      discovered.message,
    )
  }
  if (discovered?.state !== 'complete' || !Array.isArray(discovered.candidates)) {
    throw new TypeError('M3A candidate discovery returned an invalid result')
  }
  if (
    discovered.receipt?.complete !== true ||
    discovered.receipt.candidates !== discovered.candidates.length ||
    typeof discovered.receipt.bytes !== 'bigint'
  ) {
    return refusedDiscovery(
      resources,
      discovered.receipt,
      'm3a-discovery-namespace-invalid',
      'M3A candidate discovery returned an incomplete or inconsistent receipt',
    )
  }
  if (discovered.candidates.length === 0) {
    return refusedDiscovery(
      resources,
      discovered.receipt,
      'm3a-discovery-empty',
      'the caller-owned logical roots contain no M3A candidates',
      'information',
    )
  }
  const maxCandidates = Math.min(MAX_SIDECARS, budget.maxNodes)
  if (discovered.candidates.length > maxCandidates) {
    return refusedDiscovery(
      resources,
      discovered.receipt,
      'm3a-discovery-budget-exceeded',
      `M3A discovery returned more than ${maxCandidates} candidates`,
    )
  }
  let totalBytes = 0n
  for (const [index, candidate] of discovered.candidates.entries()) {
    throwIfAborted(signal)
    if (
      typeof candidate?.logicalId !== 'string' ||
      candidate.logicalId.trim() === '' ||
      typeof candidate.expectedRevision !== 'string' ||
      candidate.expectedRevision.trim() === '' ||
      typeof candidate.size !== 'bigint' ||
      candidate.size < 0n
    ) {
      throw new TypeError(`M3A discovered candidate ${index} is invalid`)
    }
    totalBytes += candidate.size
    if (candidate.size > budget.maxInputBytes || totalBytes > BigInt(budget.maxScalarBytes)) {
      return refusedDiscovery(
        resources,
        discovered.receipt,
        'm3a-discovery-budget-exceeded',
        'M3A discovery exceeds the codec byte budget',
      )
    }
  }
  if (totalBytes !== discovered.receipt.bytes) {
    return refusedDiscovery(
      resources,
      discovered.receipt,
      'm3a-discovery-namespace-invalid',
      'M3A candidate discovery byte receipt did not match its candidates',
    )
  }
  const resolved = await resolveM3AnimationSidecars({
    baseBytes,
    candidates: discovered.candidates.map(candidate => ({
      logicalId: candidate.logicalId,
      expectedRevision: candidate.expectedRevision,
      scopes: ['workspace-dependency-layer'],
    })),
    resources,
    budget,
    signal,
  })
  return Object.freeze({ ...resolved, discovery: discovered.receipt })
}
