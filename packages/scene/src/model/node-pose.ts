import type { ModelAnimationClip, ModelBoneBinding } from '@modkit/sdk'
import {
  createModelPoseSampler,
  createModelPoseBlendSampler,
  type ModelPoseBlendSample,
} from '@modkit/codec-kit/model/skeleton'
import type { JsonSnapshotBudget } from '@modkit/codec-kit/json-snapshot'

/** Authored local TRS, independent of skin membership. Matrix nodes stay in the scene graph. */
export interface ModelNodePose {
  readonly nodeId: string
  readonly localPose: NonNullable<ModelBoneBinding['localPose']>
}

/** Reuse the common channel/blend math, then let the scene graph compose local matrices.
 * These private root bindings do not create skin joints or inverse bind matrices.
 */
export function createNodePoseSampler(
  nodes: readonly ModelNodePose[],
  options: {
    clip?: ModelAnimationClip
    poseSamples?: readonly ModelPoseBlendSample[]
    poseTime: number
    budget: JsonSnapshotBudget
    signal?: AbortSignal
  },
) {
  const hierarchyId = 'scene-local-pose'
  const targets = new Set(nodes.map(node => node.nodeId))
  if (targets.size !== nodes.length) throw new TypeError('duplicate scene node pose')
  const bindings: ModelBoneBinding[] = nodes.map((node, boneIndex) => ({
    ...node,
    boneIndex,
    partId: hierarchyId,
    hierarchyId,
    boneName: null,
    parentBoneIndex: null,
    provenance: 'direct',
  }))
  const select = (clip: ModelAnimationClip): ModelAnimationClip => ({
    ...clip,
    hierarchyId,
    channels: clip.channels.filter(
      channel =>
        targets.has(channel.target) && ['translation', 'rotation', 'scale'].includes(channel.kind),
    ),
  })
  const shared = {
    bindings,
    hierarchyId,
    budget: options.budget,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const sampler =
    options.poseSamples === undefined
      ? createModelPoseSampler({
          ...shared,
          ...(options.clip === undefined ? {} : { clip: select(options.clip) }),
        })
      : createModelPoseBlendSampler({
          ...shared,
          samples: options.poseSamples.map(sample => ({ ...sample, clip: select(sample.clip) })),
        })
  return {
    sample(time: number, signal?: AbortSignal, globalTimeSeconds?: number) {
      return new Map(
        sampler
          .sample(
            options.poseSamples === undefined ? time : time - options.poseTime,
            signal,
            globalTimeSeconds,
          )
          .bones.map(node => [node.nodeId, node.worldMatrix]),
      )
    },
  }
}
