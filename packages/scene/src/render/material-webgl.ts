import { applyWebGlDepthBias } from './depth-bias.js'
import type { SceneRendererCamera, SceneRendererDirectionalLight } from '@modkit/sdk/renderer'
import {
  createWebGlMaterialProgram,
  linkWebGlMaterialProgramsInParallel,
  uniformLocation,
  type WebGlMaterialProgram,
} from '../materials/webgl.js'
import type { StandardMaterialProgram } from '../materials/index.js'
import { materialGeometry, sceneMaterialVertexSource } from './material-geometry.js'
import { materialIsSolid, type MaterialDraw } from './material-draws.js'
import { requiresEnvironmentEye, snapshotEyePosition } from '../materials/environment.js'
import { cubeNearestSamplerSource } from '../materials/cube-maps.js'

/** Per-frame GPU program leases. Scene owns geometry, camera matrices and render state. */
export function materialWebGlDraws(
  gl: WebGL2RenderingContext,
  textures: ReadonlyMap<string, WebGLTexture>,
  /**
   * `mipmaps`: the caller uploaded every linear texture with a full mip chain.
   * `checkEachDraw: false`: the caller checks WebGL errors per pass; `getError` forces a GPU sync,
   * which dominated frame time with tens of thousands of draws.
   */
  options: Readonly<{ mipmaps?: boolean; checkEachDraw?: boolean }> = {},
) {
  const programs = new Map<StandardMaterialProgram, WebGlMaterialProgram>()
  // Leases hold per-material uniforms and samplers; linked GL programs are shared by shader source.
  const linked = new Map<string, WebGLProgram>()
  const pendingPrograms = new Set<WebGLProgram>()
  const usedPrograms = new Set<StandardMaterialProgram>()
  let programCompilations = 0
  // Primitive arrays are immutable for the lifetime of a draw plan; keep their GPU copies across
  // frames instead of re-uploading every attribute on every draw. `sweep()` drops arrays a frame
  // did not touch, `release()` drops everything.
  const retained = new Map<ArrayBufferView, { buffer: WebGLBuffer; used: boolean }>()
  const retainedBuffer = (target: number, data: ArrayBufferView) => {
    let entry = retained.get(data)
    if (entry === undefined) {
      const buffer = gl.createBuffer()
      if (buffer === null) throw new TypeError('could not allocate material geometry')
      gl.bindBuffer(target, buffer)
      gl.bufferData(target, data, gl.STATIC_DRAW)
      entry = { buffer, used: true }
      retained.set(data, entry)
    } else gl.bindBuffer(target, entry.buffer)
    entry.used = true
  }
  return {
    programCompilations: () => programCompilations,
    /** Link every program these draws still need in one parallel batch, before any of them draws. */
    warm(draws: Iterable<MaterialDraw>): number {
      const sources = new Map<string, Readonly<{ vertexSource: string; fragmentSource: string }>>()
      for (const draw of draws) {
        if (draw.program === undefined || draw.material === undefined) continue
        if (programs.has(draw.program)) continue
        const shaders = leaseShaderSources(draw.program, draw.material)
        sources.set(`${shaders.vertexSource}\n//\n${shaders.fragmentSource}`, shaders)
      }
      return linkWebGlMaterialProgramsInParallel(gl, sources.values(), linked, pendingPrograms)
    },
    release() {
      for (const lease of programs.values()) lease.release()
      programs.clear()
      for (const program of linked.values()) gl.deleteProgram(program)
      linked.clear()
      pendingPrograms.clear()
      for (const entry of retained.values()) gl.deleteBuffer(entry.buffer)
      retained.clear()
    },
    sweep() {
      // Per-frame materials (effects, playback-time uniforms) must not accumulate leases.
      for (const [source, lease] of programs)
        if (!usedPrograms.has(source)) {
          lease.release()
          programs.delete(source)
        }
      usedPrograms.clear()
      for (const [data, entry] of retained) {
        if (entry.used) entry.used = false
        else {
          gl.deleteBuffer(entry.buffer)
          retained.delete(data)
        }
      }
    },
    draw(
      draw: MaterialDraw,
      camera: SceneRendererCamera,
      light?: SceneRendererDirectionalLight & {
        /** Scene lighting ambient color; defaults to the scalar `ambient` as gray. */
        readonly ambientColor?: readonly [number, number, number]
        readonly specularColor?: readonly [number, number, number]
        readonly fills?: readonly { readonly direction: readonly [number, number, number]; readonly color: readonly [number, number, number] }[]
      },
    ): number {
      const { program: source, material, primitive } = draw
      if (source === undefined || material === undefined)
        throw new TypeError('missing GPU material')
      const environmentEnabled = source.environment !== undefined
      const worldShading =
        source.normalBlendPolicy !== undefined || source.normalMapSpace === 'object'
      const eyePosition = snapshotEyePosition(camera.eyePosition)
      if (requiresEnvironmentEye(source) && eyePosition === undefined)
        throw new TypeError('explicit reflection environment requires eyePosition')
      const mode =
        primitive.topology === 'triangles'
          ? gl.TRIANGLES
          : primitive.topology === 'triangle-strip'
            ? gl.TRIANGLE_STRIP
            : primitive.topology === 'triangle-fan'
              ? gl.TRIANGLE_FAN
              : undefined
      if (mode === undefined) return 0
      usedPrograms.add(source)
      let lease = programs.get(source)
      if (lease === undefined) {
        const bound = new Map<string, WebGLTexture>()
        for (const [resource, texture] of material.textures) {
          const handle = textures.get(texture.id)
          if (handle === undefined) throw new TypeError(`GPU material texture missing: ${resource}`)
          bound.set(resource, handle)
        }
        const { vertexSource, fragmentSource, filters } = leaseShaderSources(source, material)
        lease = createWebGlMaterialProgram(gl, { ...source, vertexSource, fragmentSource }, bound, {
          filters,
          programCache: linked,
          pendingPrograms,
          ...(options.mipmaps === true ? { mipmaps: true } : {}),
        })
        programCompilations += 1
        programs.set(source, lease)
      }
      const vao = gl.createVertexArray()
      if (vao === null) throw new TypeError('could not allocate material vertex array')
      gl.bindVertexArray(vao)
      try {
        lease.bind()
        gl.uniform4fv(
          uniformLocation(gl, lease.program, 'u_instanceTint'),
          primitiveTint(primitive) as number[],
        )
        const program = lease.program,
          geometry = materialGeometry(
            primitive,
            camera,
            light,
            source.worldToMaterial,
            environmentEnabled,
            worldShading,
          )
        const attribute = (
          name: string,
          data: Float32Array | undefined,
          size: number,
          fallback: readonly number[],
        ) => {
          const location = gl.getAttribLocation(program, name)
          if (location < 0) return
          if (data === undefined) {
            gl.disableVertexAttribArray(location)
            gl.vertexAttrib4fv(
              location,
              new Float32Array([
                fallback[0] ?? 0,
                fallback[1] ?? 0,
                fallback[2] ?? 0,
                fallback[3] ?? 1,
              ]),
            )
            return
          }
          retainedBuffer(gl.ARRAY_BUFFER, data)
          gl.enableVertexAttribArray(location)
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
        }
        attribute('a_position', primitive.positions, 3, [0, 0, 0])
        attribute('a_normal', primitive.normals, 3, [0, 0, 1])
        attribute('a_tangent', primitive.tangents, 4, [1, 0, 0, 1])
        attribute('a_color', primitive.colors, 4, [1, 1, 1, 1])
        for (let set = 0; set < source.defines.uvSetCount; set++)
          attribute(
            `a_uv${set}`,
            primitive.textureCoordinateSets?.find(uv => uv.set === set)?.coordinates ??
              (set === 0 ? primitive.textureCoordinates : undefined),
            2,
            [0, 0],
          )
        const uniform = (name: string) => uniformLocation(gl, program, name)
        gl.uniformMatrix4fv(uniform('u_model'), false, geometry.model)
        gl.uniformMatrix4fv(uniform('u_modelView'), false, geometry.modelView)
        gl.uniformMatrix4fv(uniform('u_materialWorld'), false, geometry.materialWorld)
        gl.uniformMatrix4fv(uniform('u_viewProjection'), false, camera.viewProjection)
        gl.uniformMatrix3fv(uniform('u_worldNormalMatrix'), false, geometry.worldNormal)
        gl.uniformMatrix3fv(uniform('u_viewNormalMatrix'), false, geometry.viewNormal)
        gl.uniform3fv(uniform('u_lightDirection'), geometry.lightDirection)
        gl.uniform1f(uniform('u_orientation'), geometry.orientation)
        gl.uniform1f(uniform('u_orthographic'), geometry.orthographic ? 1 : 0)
        if (source.defines.sceneLighting === true) {
          const color = light?.color ?? [1, 1, 1, 1]
          const ambient = light?.ambient ?? 0.25
          gl.uniform3f(uniform('u_sceneLightColor'), color[0], color[1], color[2])
          gl.uniform3fv(uniform('u_sceneSpecularColor'), light?.specularColor ?? color.slice(0, 3))
          gl.uniform3fv(
            uniform('u_sceneAmbientColor'),
            light?.ambientColor ?? [ambient, ambient, ambient],
          )
          for (let index = 0; index < 2; index++) {
            const fill = light?.fills?.[index]
            const direction = fill?.direction ?? [0, 0, 0]
            const length = Math.hypot(...direction) || 1
            const d = direction.map(value => value / length)
            const view = camera.viewMatrix
            const inView = view === undefined ? d : [
              view[0]! * d[0]! + view[4]! * d[1]! + view[8]! * d[2]!,
              view[1]! * d[0]! + view[5]! * d[1]! + view[9]! * d[2]!,
              view[2]! * d[0]! + view[6]! * d[1]! + view[10]! * d[2]!,
            ]
            gl.uniform3fv(uniform(`u_sceneFillViewDirection${index}`), inView)
            gl.uniform3fv(uniform(`u_sceneFillWorldDirection${index}`), d)
            gl.uniform3fv(uniform(`u_sceneFillColor${index}`), fill?.color ?? [0, 0, 0])
          }
        }
        if (environmentEnabled || worldShading) {
          if (
            geometry.environmentNormalMatrix === undefined ||
            geometry.environmentOrientation === undefined
          )
            throw new TypeError('missing scene world geometry frame')
          gl.uniformMatrix3fv(
            uniform('u_sceneWorldNormalMatrix'),
            false,
            geometry.environmentNormalMatrix,
          )
          gl.uniform1f(uniform('u_sceneWorldOrientation'), geometry.environmentOrientation)
        }
        if (environmentEnabled)
          gl.uniform3fv(uniform('u_sceneEyePosition'), eyePosition ?? [0, 0, 0])
        if (worldShading) {
          const lighting = geometry.worldLighting
          if (lighting === undefined) throw new TypeError('missing scene world lighting inputs')
          gl.uniform3fv(uniform('u_sceneLightDirection'), lighting.lightDirection)
          gl.uniform3fv(uniform('u_sceneLightingEye'), lighting.eyePosition)
          gl.uniform3fv(uniform('u_sceneLightingViewDirection'), lighting.viewDirection)
          gl.uniform1f(uniform('u_sceneLightingOrthographic'), lighting.orthographic ? 1 : 0)
        }
        gl.colorMask(!draw.depthOnly, !draw.depthOnly, !draw.depthOnly, !draw.depthOnly)
        gl.depthMask(draw.depthOnly === true || materialIsSolid(source))
        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LEQUAL)
        applyWebGlDepthBias(gl, primitive.depthBias)
        if (source.twoSided) gl.disable(gl.CULL_FACE)
        else {
          gl.enable(gl.CULL_FACE)
          gl.cullFace(gl.BACK)
          gl.frontFace(gl.CCW)
        }
        if (materialIsSolid(source) || draw.depthOnly) gl.disable(gl.BLEND)
        else {
          gl.enable(gl.BLEND)
          gl.blendEquation(gl.FUNC_ADD)
          switch (source.blend) {
            case 'blend':
              gl.blendFuncSeparate(
                gl.SRC_ALPHA,
                gl.ONE_MINUS_SRC_ALPHA,
                gl.ONE,
                gl.ONE_MINUS_SRC_ALPHA,
              )
              break
            case 'premultiplied':
              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
              break
            case 'additive':
              gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE)
              break
            case 'add-alpha':
              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE)
              break
            case 'modulate':
              gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE)
              break
            case 'modulate2x':
              gl.blendFuncSeparate(gl.DST_COLOR, gl.SRC_COLOR, gl.ZERO, gl.ONE)
              break
          }
        }
        const count = primitive.indices?.length ?? primitive.positions.length / 3
        if (primitive.indices === undefined) gl.drawArrays(mode, 0, count)
        else {
          retainedBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.indices)
          gl.drawElements(mode, count, gl.UNSIGNED_INT, 0)
        }
        if (options.checkEachDraw !== false) {
          const error = gl.getError()
          if (error !== gl.NO_ERROR) throw new TypeError(`material WebGL draw failed (${error})`)
        }
        return primitive.topology === 'triangles' ? Math.floor(count / 3) : Math.max(0, count - 2)
      } finally {
        for (let unit = 0; unit < source.textures.length; unit++) gl.bindSampler(unit, null)
        gl.bindVertexArray(null)
        gl.deleteVertexArray(vao)
        gl.colorMask(true, true, true, true)
        gl.disable(gl.CULL_FACE)
      }
    },
  }
}
import { primitiveTint } from './tint.js'

/** Final GPU shader sources of a material lease: nearest-filtered samplers and the instance tint. */
function leaseShaderSources(
  source: StandardMaterialProgram,
  material: NonNullable<MaterialDraw['material']>,
) {
  const filters = new Map<string, 'nearest' | 'linear'>()
  for (const [resource, texture] of material.textures)
    filters.set(resource, texture.filter ?? 'linear')
  // Opaque passes replace the target but the public framebuffer still stores premultiplied RGB.
  let fragment = source.fragmentSource
  const worldShading = source.normalBlendPolicy !== undefined || source.normalMapSpace === 'object'
  if (source.defines.sceneLighting) {
    fragment = fragment.replace('uniform vec3 u_sceneLightColor;', 'uniform vec3 u_sceneLightColor;\nuniform vec3 u_sceneSpecularColor;')
      .replace('spec * u_sceneLightColor * lambert', 'spec * u_sceneSpecularColor * lambert')
    const lambert = (direction: string) => source.defines.doubleLambert
      ? `clamp(-1.0 + 2.0 * dot(normal, ${direction}), 0.0, 1.0)`
      : `max(dot(normal, ${direction}), 0.0)`
    fragment = fragment.replace('precision highp float;', `precision highp float;
      uniform vec3 u_sceneFillColor0, u_sceneFillColor1;
      ${worldShading ? 'uniform vec3 u_sceneFillWorldDirection0, u_sceneFillWorldDirection1;' : 'in vec3 v_sceneFillDir0, v_sceneFillDir1;'}
    `).replace('u_sceneAmbientColor + u_sceneLightColor * lambert',
      `u_sceneAmbientColor + u_sceneLightColor * lambert +
       u_sceneFillColor0 * ${lambert(worldShading ? 'u_sceneFillWorldDirection0' : 'v_sceneFillDir0')} +
       u_sceneFillColor1 * ${lambert(worldShading ? 'u_sceneFillWorldDirection1' : 'v_sceneFillDir1')}`)
  }
  const samplers: string[] = []
  const declarations: string[] = []
  for (const binding of source.textures)
    if (filters.get(binding.resourceId) === 'nearest') {
      const name = `sceneSample_${binding.slot}`
      const cube = binding.dimension === 'cube'
      declarations.push(`vec4 ${name}(${cube ? 'vec3 direction' : 'vec2 uv'});`)
      fragment = fragment.replaceAll(`texture(${binding.uniform},`, `${name}(`)
      if (cube) samplers.push(cubeNearestSamplerSource(name, binding.uniform))
      else
        samplers.push(`vec4 ${name}(vec2 uv){
            ivec2 size=textureSize(${binding.uniform},0);
            vec2 addressed=vec2(${binding.wrapU === 'clamp' ? 'clamp(uv.x,0.0,1.0)' : 'fract(uv.x)'},${binding.wrapV === 'clamp' ? 'clamp(uv.y,0.0,1.0)' : 'fract(uv.y)'});
            ivec2 pixel=clamp(ivec2(floor(addressed*vec2(size))),ivec2(0),size-1);
            return texelFetch(${binding.uniform},pixel,0);
          }`)
    }
  fragment = fragment.replace(/void main\s*\(\s*\)/, `${samplers.join('\n')}\nvoid main()`)
  fragment = fragment.replace(
    'precision highp float;',
    `precision highp float;\n${declarations.join('\n')}`,
  )
  const fragmentSource =
    fragment.replace(/void main\s*\(\s*\)/, 'void materialMain()') +
    '\nuniform vec4 u_instanceTint;\nvoid main(){materialMain();materialColor*=u_instanceTint;' +
    (materialIsSolid(source)
      ? (source.defines.sceneLighting ? 'materialColor.a=clamp(materialColor.a,0.0,1.0);' : 'materialColor=clamp(materialColor,0.0,1.0);') + 'materialColor.rgb*=materialColor.a;'
      : '') +
    '}\n'
  const vertexSource = sceneMaterialVertexSource(
    source.defines,
    source.environment !== undefined,
    worldShading,
  )
  return { vertexSource, fragmentSource, filters }
}
