/**
 * DDS subresource layout.
 *
 * A DDS file is a flat run of surfaces whose order is fixed by the format: for every array element,
 * for every cubemap face, for every mip level, and inside a volume mip level for every depth slice.
 * Nothing in the header points at a surface, so a viewer that wants mip 3 of face 4 has to walk the
 * sizes. This module owns that walk so the decoder never has to guess an offset.
 */

/** Bytes of one 4x4 block, or 0 when the payload is not block-compressed. */
export function blockBytesFor(format) {
  if (format === 'DXT1') return 8
  if (format === 'DXT3' || format === 'DXT5') return 16
  return 0
}

/** Dimensions of one mip level; every axis floors at 1, as D3D specifies. */
export function levelDimensions(info, level) {
  return {
    width: Math.max(1, info.width >>> level),
    height: Math.max(1, info.height >>> level),
    depth: Math.max(1, info.depth >>> level),
  }
}

/** Bytes of a single 2D slice of one mip level (a whole level for non-volume textures). */
export function sliceBytes(info, level) {
  const { width, height } = levelDimensions(info, level)
  const blockBytes = blockBytesFor(info.format)
  if (blockBytes !== 0) return Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes
  return Math.ceil((width * info.rgbBits) / 8) * height
}

/** Bytes of a whole mip level, including every depth slice of a volume texture. */
export function levelBytes(info, level) {
  return sliceBytes(info, level) * levelDimensions(info, level).depth
}

/** Bytes of one array element / cubemap face: the full mip chain. */
export function elementBytes(info) {
  let total = 0
  for (let level = 0; level < info.mipLevels; level += 1) total += levelBytes(info, level)
  return total
}

/** Total payload bytes the header describes, excluding the header itself. */
export function payloadBytes(info) {
  return elementBytes(info) * info.layers * info.faces
}

/**
 * Byte offset of one subresource inside the file, or a named RangeError when the coordinates are
 * outside what the header declares. Refusing by name matters: "face 4 of a 2D texture" and "mip 9
 * of a 6-level chain" are different mistakes and the viewer shows the difference.
 */
export function subresourceOffset(info, coordinates) {
  const { mipLevel = 0, layer = 0, face = 0, slice = 0 } = coordinates
  for (const [name, value, limit] of [
    ['mip level', mipLevel, info.mipLevels],
    ['array layer', layer, info.layers],
    ['cubemap face', face, info.faces],
  ]) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= limit) {
      throw new RangeError(`DDS ${name} ${value} is outside 0..${limit - 1}`)
    }
  }
  const levelDepth = levelDimensions(info, mipLevel).depth
  if (!Number.isSafeInteger(slice) || slice < 0 || slice >= levelDepth) {
    throw new RangeError(`DDS volume slice ${slice} is outside 0..${levelDepth - 1}`)
  }
  let offset = info.dataOffset + (layer * info.faces + face) * elementBytes(info)
  for (let level = 0; level < mipLevel; level += 1) offset += levelBytes(info, level)
  return offset + slice * sliceBytes(info, mipLevel)
}

/** Resolve a subresource to the surface the decoder needs: dimensions plus a validated offset. */
export function resolveSubresource(bytes, info, coordinates) {
  const offset = subresourceOffset(info, coordinates)
  const { width, height } = levelDimensions(info, coordinates.mipLevel ?? 0)
  const length = sliceBytes(info, coordinates.mipLevel ?? 0)
  if (offset + length > bytes.byteLength) {
    throw new RangeError(
      `DDS subresource (mip ${coordinates.mipLevel ?? 0}, layer ${coordinates.layer ?? 0}, ` +
        `face ${coordinates.face ?? 0}, slice ${coordinates.slice ?? 0}) needs bytes ` +
        `${offset}..${offset + length} of a ${bytes.byteLength}-byte file`,
    )
  }
  return Object.freeze({ width, height, offset, length })
}
