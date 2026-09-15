/** Linear textures get a full mip chain plus anisotropy; without them minified terrain and props alias. */
const MAX_ANISOTROPY = 8

export function textureAnisotropy(
  gl: WebGL2RenderingContext,
): Readonly<{ parameter: number; value: number }> | undefined {
  const extension = gl.getExtension('EXT_texture_filter_anisotropic')
  if (extension === null) return undefined
  const limit = Number(gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
  return { parameter: extension.TEXTURE_MAX_ANISOTROPY_EXT, value: Math.min(MAX_ANISOTROPY, limit) }
}

/** Call after the base level is uploaded and bound to `target`. */
export function applyTextureFilter(
  gl: WebGL2RenderingContext,
  target: number,
  filter: 'nearest' | 'linear',
): void {
  if (filter === 'nearest') {
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return
  }
  gl.generateMipmap(target)
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  const anisotropy = textureAnisotropy(gl)
  if (anisotropy !== undefined) gl.texParameterf(target, anisotropy.parameter, anisotropy.value)
}
