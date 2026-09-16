/** Linear textures get a full mip chain plus anisotropy; without them minified terrain and props alias. */
const MAX_ANISOTROPY = 8

// getParameter synchronizes with the GPU process; it was called per texture and per sampler.
const anisotropyByContext = new WeakMap<
  WebGL2RenderingContext,
  Readonly<{ parameter: number; value: number }> | null
>()

export function textureAnisotropy(
  gl: WebGL2RenderingContext,
): Readonly<{ parameter: number; value: number }> | undefined {
  let cached = anisotropyByContext.get(gl)
  if (cached === undefined) {
    const extension = gl.getExtension('EXT_texture_filter_anisotropic')
    cached =
      extension === null
        ? null
        : Object.freeze({
            parameter: extension.TEXTURE_MAX_ANISOTROPY_EXT,
            value: Math.min(
              MAX_ANISOTROPY,
              Number(gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT)),
            ),
          })
    anisotropyByContext.set(gl, cached)
  }
  return cached ?? undefined
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
