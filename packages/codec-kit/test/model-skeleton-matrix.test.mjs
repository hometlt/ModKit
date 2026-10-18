/** Static affine poses preserve shear through the existing topology and skinning kernels. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createModelSkeletonNodes,
  createModelPoseSampler,
  createModelPoseBlendSampler,
  snapshotModelSkeleton,
} from "../dist/model/skeleton.js";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shear = [1, 0, 0, 0, 2, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
const childWorld = [1, 0, 0, 0, 2, 1, 0, 0, 0, 0, 1, 0, 16, 3, 0, 1];
/** Sparse child-before-parent ordinals intentionally exercise the existing topology owner. */
function fixture() {
  return [
    {
      partId: "mesh",
      hierarchyId: "rig",
      boneIndex: 3,
      boneName: "child",
      nodeId: "child",
      provenance: "direct",
      parentBoneIndex: 9,
      localPose: {
        translation: [0, 3, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      inverseBindMatrix: [1, 0, 0, 0, -2, 1, 0, 0, 0, 0, 1, 0, -10, -3, 0, 1],
    },
    {
      partId: "mesh",
      hierarchyId: "rig",
      boneIndex: 9,
      boneName: "root",
      nodeId: "root",
      provenance: "direct",
      parentBoneIndex: null,
      localMatrix: [...shear],
    },
  ];
}
test("mixed matrix/TRS hierarchy keeps authored nodes, world/skin, static extent and owned output", () => {
  const bindings = fixture(),
    nodes = createModelSkeletonNodes(bindings, "rig");
  assert.deepEqual(nodes[1].transform, shear);
  assert.deepEqual(nodes[1].childIds, ["child"]);
  const sampler = createModelPoseSampler({ bindings, hierarchyId: "rig" });
  bindings[1].localMatrix.fill(0);
  const sample = sampler.sample(0);
  assert.deepEqual(sample.bones[0].worldMatrix, childWorld);
  assert.deepEqual(sample.bones[0].skinningMatrix, identity);
  assert.deepEqual(sample.bones[1].worldMatrix, shear);
  assert.deepEqual(sampler.sampleMatrices(100).pose(), sample.bones);
  assert.deepEqual(Array.from(sampler.extent().center), [
    ...childWorld,
    ...shear,
  ]);
  assert.deepEqual(Array.from(sampler.extent().turn), [0, 0]);
  assert.deepEqual(Array.from(sampler.extent().shift), [0, 0]);
  assert.throws(() => {
    sample.bones[0].worldMatrix[0] = 99;
  }, TypeError);
  assert.throws(() => sampler.sample(NaN), /finite/);
  assert.throws(() => sampler.sample(0, AbortSignal.abort()), {
    name: "AbortError",
  });
});
test("matrix admission rejects ambiguity, holes, perspective, overflow and existing hierarchy faults", () => {
  for (const mutate of [
    (b) => {
      b[1].localPose = b[0].localPose;
    },
    (b) => {
      delete b[1].localMatrix[1];
    },
    (b) => {
      b[1].localMatrix[3] = 0.01;
    },
    (b) => {
      b[1].localMatrix[15] = 0;
    },
    (b) => {
      b[1].localMatrix[0] = NaN;
    },
    (b) => {
      b[1].localMatrix[0] = 1e100;
    },
    (b) => {
      b[1].localMatrix.pop();
    },
    (b) => {
      b[1].parentBoneIndex = 3;
    },
    (b) => {
      b[1].parentBoneIndex = 42;
    },
    (b) => {
      b[1].nodeId = "child";
    },
  ]) {
    const bindings = fixture();
    mutate(bindings);
    assert.throws(() => createModelSkeletonNodes(bindings, "rig"));
  }
  assert.equal(
    snapshotModelSkeleton([
      { partId: "mesh", boneIndex: 0, boneName: null, provenance: "absent" },
    ]).length,
    1,
  );
});
test("all clips and blends explicitly refuse matrix-local bones, including empty clips", () => {
  const bindings = fixture(),
    clip = {
      id: "still",
      name: "Still",
      kind: "animation",
      provenance: "direct",
      frames: 1,
      hierarchyId: "rig",
      channels: [],
    };
  assert.throws(
    () => createModelPoseSampler({ bindings, hierarchyId: "rig", clip }),
    /matrix-local/,
  );
  assert.throws(
    () =>
      createModelPoseBlendSampler({
        bindings,
        hierarchyId: "rig",
        samples: [{ clip, time: 0, weight: 1 }],
      }),
    /matrix-local/,
  );
});
