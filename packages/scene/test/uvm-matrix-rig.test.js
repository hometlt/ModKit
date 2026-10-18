/** Full-shear static bones use the ordinary UVM writer, reader and scene skin pipeline. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createModelSkeletonNodes,
  createModelPoseSampler,
} from "@modkit/codec-kit/model/skeleton";
import { materializeUvmCore } from "@modkit/uv/model/materializer";
import { readUvmContainer } from "@modkit/uv/model/container";
import { readUvmModel } from "../src/uvm/model.js";
import { createModelSceneSampler } from "../src/model/sampler.js";
import { boundUvmRig, boundUvmRootFrame } from "../src/uvm/rig-bounds.js";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shear = [1, 0, 0, 0, 2, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
/** Distinct child-before-parent indices and nonidentity inverse binds make losses visible. */
function fixture() {
  const skeleton = [
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
      inverseBindMatrix: [1, 0, 0, 0, -2, 1, 0, 0, 0, 0, 1, 0, -10, 0, 0, 1],
    },
  ];
  const nodes = [
    ...createModelSkeletonNodes(skeleton, "rig"),
    { id: "body", childIds: [], meshIds: ["mesh"], transform: identity },
  ];
  const primitive = {
    id: "triangle",
    hierarchyId: "rig",
    topology: "triangles",
    positions: Float32Array.of(16, 3, 0, 17, 3, 0, 16, 4, 0),
    indices: Uint32Array.of(0, 1, 2),
    boneIndices: Uint32Array.of(3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3),
    boneWeights: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0),
  };
  return {
    info: {
      scenes: 1,
      nodes: 3,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: "decoded",
    },
    nodes,
    meshes: [{ id: "mesh", primitiveIds: ["triangle"] }],
    primitives: [primitive],
    skeleton,
  };
}
const request = {
  scope: { scopeId: "model-interchange-v1", version: "1.0.0" },
  profile: "UVM/core@1.0",
  subjectRevision: "provider-token:matrix",
  options: { assetId: "fixture/matrix-rig", sourceFormat: "synthetic" },
};
test("matrix-local skeleton writes and reopens as complete bindings with unchanged static skin", () => {
  const projection = fixture(),
    written = materializeUvmCore(projection, request);
  const container = readUvmContainer(written.bytes);
  const root = container.document.nodes.find((node) => node.name === "root");
  assert.deepEqual(root.matrix, shear);
  assert.equal(root.translation, undefined);
  assert.equal(root.rotation, undefined);
  assert.equal(root.scale, undefined);
  const reopened = readUvmModel(container.document, container.binary, {
    maxScalarBytes: 1 << 24,
  });
  assert.equal(reopened.rig.incompleteBindings, 0);
  const matrixBone = reopened.rig.bindings.find(
    (bone) => bone.boneName === "root",
  );
  assert.deepEqual(matrixBone.localMatrix, shear);
  assert.equal(matrixBone.localPose, undefined);
  const sampled = createModelPoseSampler({
    bindings: reopened.rig.bindings,
    hierarchyId: matrixBone.hierarchyId,
  }).sample(0);
  for (const bone of sampled.bones)
    assert.deepEqual(bone.skinningMatrix, identity);
  const scene = createModelSceneSampler({
    ...reopened.scene,
    skeleton: reopened.rig.bindings,
  });
  assert.deepEqual(
    Array.from(scene.sample(0).primitives[0].positions),
    Array.from(projection.primitives[0].positions),
  );
  const bounds = boundUvmRig(
    reopened.rig.bindings,
    reopened.scene.primitives,
    [],
    { maxNodes: 10000 },
  );
  assert.ok(bounds.radius >= Math.hypot(17, 3, 0));
  assert.throws(
    () => boundUvmRootFrame(matrixBone, [], bounds.radius, { maxNodes: 10000 }),
    /TRS/,
  );
});
test("UVM export refuses clips on matrix-local rigs instead of animating guessed TRS", () => {
  const projection = fixture();
  projection.animations = [
    {
      id: "still",
      name: "Still",
      kind: "animation",
      provenance: "direct",
      frames: 1,
      channels: [],
    },
  ];
  assert.throws(() => materializeUvmCore(projection, request), /matrix-local/);
});

test("UVM reader validates matrix joints before publishing complete bindings", () => {
  const written = materializeUvmCore(fixture(), request);
  for (const [index, value] of [
    [3, 0.01],
    [0, 1e100],
  ]) {
    const container = readUvmContainer(written.bytes);
    const document = structuredClone(container.document);
    document.nodes.find((node) => node.name === "root").matrix[index] = value;
    assert.throws(
      () =>
        readUvmModel(document, container.binary, { maxScalarBytes: 1 << 24 }),
      /affine|finite float range/,
    );
  }
});
