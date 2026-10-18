// packages/codec-kit/dist/model/voxel.js
var typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
var typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "length").get;
var typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer").get;
var typedOffset = Object.getOwnPropertyDescriptor(typedPrototype, "byteOffset").get;
var typedKind = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag).get;
var arrayBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
var resizableBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;

// packages/codec-kit/dist/model/geometry.js
function modelPrimitiveByteLength(primitive) {
  return primitive.positions.byteLength + (primitive.indices?.byteLength ?? 0) + (primitive.normals?.byteLength ?? 0) + (primitive.tangents?.byteLength ?? 0) + (primitive.colors?.byteLength ?? 0) + (primitive.boneIndices?.byteLength ?? 0) + (primitive.boneWeights?.byteLength ?? 0) + (primitive.textureCoordinates?.byteLength ?? 0) + (primitive.textureCoordinateSets?.reduce((total, channel) => total + channel.coordinates.byteLength, 0) ?? 0);
}

export {
  modelPrimitiveByteLength
};
