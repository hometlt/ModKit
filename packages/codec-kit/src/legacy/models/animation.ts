import type { RenderAnimation, RenderScalarAnimationTrack } from '../../legacy-model-support.js'

// P5 track model (docs/tasks-active/model-renderer/subtasks/OPUS_TASK_P5_M3_ANIMATION.md, D5).
// Every bone of a sequence gets a track set; bones the sequence does not drive carry a
// constant single-key track at the bind pose (D2) so the bind-pose reset is structural.
export interface RenderNodeTrackSet {
  boneIndex: number
  /** vec3 keys */
  translation?: RenderScalarAnimationTrack
  /** quat keys, neighborhood-corrected at extraction (D7) */
  rotation?: RenderScalarAnimationTrack
  /** vec3 keys */
  scale?: RenderScalarAnimationTrack
  /** Track originates from a concurrent STC and wraps independently (D4). */
  concurrent?: boolean
  wrapSeconds?: number
}

export interface RenderHumanoidMuscleTrack {
  /** Serialized Animator muscle/property binding identifier. */
  bindingId: number
  /** Resolved HumanTrait muscle index when the source format provides one. */
  muscleIndex?: number
  track: RenderScalarAnimationTrack
}

export interface RenderSequence extends RenderAnimation {
  looping: boolean
  movementSpeed?: number
  boundsSphere?: { center: [number, number, number]; radius: number }
  nodeTracks: RenderNodeTrackSet[]
  /** Avatar-normalized Mecanim muscle curves, independent of transform tracks. */
  humanoidMuscleTracks?: RenderHumanoidMuscleTrack[]
  /** Mesh visibility from `batching` flag animation on batch1/batch2 bones (P5 1.6). */
  meshVisibility?: { meshIndex: number; track: RenderScalarAnimationTrack }[]
}

export interface SequenceValidationIssue {
  code: string
  message: string
}

export function validateRenderSequence(
  sequence: RenderSequence,
  boneCount: number,
): SequenceValidationIssue[] {
  const issues: SequenceValidationIssue[] = []
  if (!(sequence.durationSeconds >= 0)) {
    issues.push({
      code: 'sequence-duration-invalid',
      message: `sequence "${sequence.name}" duration must be >= 0, got ${sequence.durationSeconds}`,
    })
  }
  const seen = new Set<number>()
  for (const trackSet of sequence.nodeTracks) {
    if (trackSet.boneIndex < 0 || trackSet.boneIndex >= boneCount) {
      issues.push({
        code: 'track-bone-out-of-range',
        message: `sequence "${sequence.name}" references bone ${trackSet.boneIndex} outside [0, ${boneCount})`,
      })
    }
    if (seen.has(trackSet.boneIndex)) {
      issues.push({
        code: 'track-bone-duplicate',
        message: `sequence "${sequence.name}" has multiple track sets for bone ${trackSet.boneIndex}`,
      })
    }
    seen.add(trackSet.boneIndex)
    if (trackSet.concurrent && !(trackSet.wrapSeconds && trackSet.wrapSeconds > 0)) {
      issues.push({
        code: 'concurrent-track-missing-wrap',
        message: `sequence "${sequence.name}" bone ${trackSet.boneIndex} concurrent track needs wrapSeconds > 0`,
      })
    }
  }
  return issues
}
