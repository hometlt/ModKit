import {
  Matrix4,
  PerspectiveCamera,
  OrthographicCamera,
  Quaternion,
  Vector3,
  MathUtils,
} from 'three'
import type { JsonObject, SceneRendererCamera } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { validateUvmSceneCamera } from '@modkit/uv/model/validation'
import { array, field, object, safeIndex } from './values.js'
import { sampleUvmSceneProperties } from './scene-properties.js'
import { snapshotEyePosition } from '../materials/environment.js'

type Vec3 = readonly [number, number, number]
function numbers(value: unknown, count: number, label: string): number[] {
  if (
    (!Array.isArray(value) && !(value instanceof Float32Array)) ||
    value.length !== count ||
    !Array.from(value).every(
      component => typeof component === 'number' && Number.isFinite(component),
    )
  )
    throw new TypeError(`${label} must contain ${count} finite numbers`)
  return Array.from(value)
}
function positive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new TypeError(`${label} must be finite and positive`)
  return value
}
function xyz(value: Vector3): Vec3 {
  return [value.x, value.y, value.z]
}
function ownedMatrix(matrix: Matrix4): Float32Array {
  const output = Float32Array.from(matrix.elements)
  if (!output.every(Number.isFinite)) throw new RangeError('camera matrix exceeds finite float32')
  return output
}
function affine(value: unknown): Matrix4 {
  const values = numbers(value, 16, 'camera frame')
  if (values[3] !== 0 || values[7] !== 0 || values[11] !== 0 || values[15] !== 1)
    throw new TypeError('camera frame must be affine')
  const matrix = new Matrix4().fromArray(values)
  const determinant = matrix.determinant()
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new TypeError('camera frame is singular')
  return matrix
}

/** Neutral rest-frame extraction used by format mappings; no native enum or axis policy. */
export function previewFrameFromInverseBind(value: readonly number[]): {
  position: Vec3
  forward: Vec3
} {
  const matrix = affine(value).invert()
  ownedMatrix(matrix)
  const position = new Vector3().setFromMatrixPosition(matrix)
  const forward = new Vector3().setFromMatrixColumn(matrix, 2).negate()
  if (!(forward.length() > 1e-8)) throw new TypeError('preview bind frame has no forward axis')
  return { position: xyz(position), forward: xyz(forward.normalize()) }
}

/** A static glTF camera node points down local -Z; the caller supplies its source-frame up. */
export function previewCameraNodeMatrix(position: Vec3, target: Vec3, up: Vec3): number[] {
  const eye = new Vector3().fromArray(numbers(position, 3, 'camera position'))
  const aim = new Vector3().fromArray(numbers(target, 3, 'camera target'))
  const vertical = new Vector3().fromArray(numbers(up, 3, 'camera up'))
  if (
    eye.distanceToSquared(aim) === 0 ||
    vertical.lengthSq() === 0 ||
    new Vector3().subVectors(eye, aim).cross(vertical).lengthSq() === 0
  )
    throw new TypeError('camera look-at frame is singular')
  const matrix = new Matrix4().lookAt(eye, aim, vertical).setPosition(eye)
  ownedMatrix(matrix)
  return [...matrix.elements]
}

export interface SpriteCameraOptions {
  /** Round the up axis (+y) from the +z side toward +x: the facing a sprite frame shows. */
  readonly azimuthDegrees: number
  /** Above the ground: 90 looks straight down (StarCraft), 30 is Red Alert 2's view. */
  readonly elevationDegrees: number
  /** Pixels per document unit (a metre under UV_units). */
  readonly pixelsPerUnit: number
  readonly width: number
  readonly height: number
  /** The pixel the target lands on, from the top-left; the frame's centre by default. */
  readonly anchor?: readonly [number, number]
  /** The point looked at; the origin by default. */
  readonly target?: Vec3
  /** Units the frame reaches toward and away from the eye; 1000 by default. */
  readonly depth?: number
}

/**
 * The orthographic camera a sprite encoder draws a UVM's frames with (V7): an ordinary `renderUvm`
 * request camera, so a frame and its coverage (the frame's alpha) come from the scene renderer, and
 * the encoder only quantizes and packs. The screen's up is the view's own, so a camera straight
 * down keeps the facing's direction at the top of the frame.
 */
export function spriteCamera(options: SpriteCameraOptions): {
  readonly viewProjection: number[]
  readonly viewMatrix: number[]
  readonly eyePosition: Vec3
} {
  const azimuth = MathUtils.degToRad(numbers([options.azimuthDegrees], 1, 'sprite azimuth')[0]!)
  const elevation = MathUtils.degToRad(
    numbers([options.elevationDegrees], 1, 'sprite elevation')[0]!,
  )
  const scale = positive(options.pixelsPerUnit, 'sprite pixels per unit')
  const width = positive(options.width, 'sprite width')
  const height = positive(options.height, 'sprite height')
  const depth = positive(options.depth ?? 1000, 'sprite depth')
  const [anchorX, anchorY] = numbers(options.anchor ?? [width / 2, height / 2], 2, 'sprite anchor')
  const target = new Vector3().fromArray(numbers(options.target ?? [0, 0, 0], 3, 'sprite target'))
  if (Math.abs(elevation) > Math.PI / 2) throw new RangeError('sprite elevation is -90..90 degrees')
  const toEye = new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  )
  // d(toEye)/d(elevation): the view's up, defined straight down too
  const up = new Vector3(
    -Math.sin(azimuth) * Math.sin(elevation),
    Math.cos(elevation),
    -Math.cos(azimuth) * Math.sin(elevation),
  )
  const camera = new OrthographicCamera(
    -anchorX! / scale,
    (width - anchorX!) / scale,
    anchorY! / scale,
    -(height - anchorY!) / scale,
    0,
    2 * depth,
  )
  camera.position.copy(target).addScaledVector(toEye, depth)
  camera.up.copy(up)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  const view = camera.matrixWorldInverse
  const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, view)
  return {
    viewProjection: [...ownedMatrix(viewProjection)],
    viewMatrix: [...ownedMatrix(view)],
    eyePosition: xyz(camera.position),
  }
}

export interface UvmCameraOptions {
  readonly aspect: number
  /** Already sampled by the existing common scene sampler; this helper evaluates no animation. */
  readonly nodeTransforms: ReadonlyMap<string, Float32Array>
  readonly activeNodes: ReadonlySet<string>
  readonly maxBytes: number
  readonly maxNodes: number
  /** Selected common clip clock for portable camera-property animation. */
  readonly time?: number
  readonly globalTime?: number
  readonly sequenceIndex?: number
  readonly signal?: AbortSignal
}

/** Resolve explicit matrices OR a glTF camera node. No default-camera override is inferred.
 * glTF camera scale is ignored; shear/reflection and infinite-far cameras explicitly refuse. */
export function resolveUvmCamera(
  document: JsonObject,
  input: unknown,
  options: UvmCameraOptions,
): SceneRendererCamera {
  options.signal?.throwIfAborted()
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 2048 ||
    !Number.isSafeInteger(options.maxNodes) ||
    options.maxNodes < 1
  )
    throw new RangeError('camera snapshot exceeds budget')
  const snapshotBudget = {
    maxDepth: 16,
    maxNodes: Math.floor(options.maxNodes / 2),
    maxBytes: Math.floor((options.maxBytes - 1024) / 2),
  }
  const request = object(snapshotJson(input, snapshotBudget, options.signal), 'camera request')
  if (request['node'] === undefined) {
    if (
      Object.keys(request).some(
        key => !['viewProjection', 'viewMatrix', 'eyePosition'].includes(key),
      )
    )
      throw new TypeError('camera matrix request contains an unsupported field')
    const viewProjection = Float32Array.from(
      numbers(request['viewProjection'], 16, 'viewProjection'),
    )
    const view =
      request['viewMatrix'] === undefined
        ? undefined
        : Float32Array.from(numbers(request['viewMatrix'], 16, 'viewMatrix'))
    // Float32 overflow refuses here, before any raster acquisition.
    const eye = snapshotEyePosition(request['eyePosition'])
    if (view !== undefined && (view[3] !== 0 || view[7] !== 0 || view[11] !== 0 || view[15] !== 1))
      throw new TypeError('camera viewMatrix must be affine')
    if (
      !viewProjection.every(Number.isFinite) ||
      (view !== undefined && !view.every(Number.isFinite))
    )
      throw new RangeError('camera request exceeds finite float32')
    return {
      viewProjection,
      ...(view === undefined ? {} : { viewMatrix: view }),
      ...(eye === undefined
        ? {}
        : { eyePosition: [eye[0] ?? 0, eye[1] ?? 0, eye[2] ?? 0] as Vec3 }),
    }
  }
  if (Object.keys(request).length !== 1)
    throw new TypeError('camera node and explicit matrices are mutually exclusive')
  const nodes = array(document, 'nodes'),
    cameras = array(document, 'cameras')
  const nodeIndex = safeIndex(request['node'], nodes.length, 'camera node'),
    id = `node-${nodeIndex}`
  if (!options.activeNodes.has(id)) throw new TypeError('camera node is outside the selected scene')
  const node = object(nodes[nodeIndex], 'camera node'),
    cameraIndex = safeIndex(node['camera'], cameras.length, 'camera')
  const camera = object(
    snapshotJson(cameras[cameraIndex], snapshotBudget, options.signal),
    'camera',
  )
  validateUvmSceneCamera(camera, array(document, 'extensionsUsed'), options.maxNodes, options.signal)
  const world = affine(options.nodeTransforms.get(id))
  const position = new Vector3(),
    rotation = new Quaternion(),
    scale = new Vector3()
  world.decompose(position, rotation, scale)
  const reconstructed = new Matrix4().compose(position, rotation, scale)
  if (
    [scale.x, scale.y, scale.z].some(value => !(value > 0)) ||
    world.elements.some(
      (value, index) =>
        Math.abs(value - (reconstructed.elements[index] ?? 0)) >
        1e-6 * Math.max(1, Math.abs(value)),
    )
  )
    throw new TypeError('camera frame shear/reflection is unsupported')
  const view = new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)).invert()
  let projection: Matrix4
  if (camera['type'] === 'perspective') {
    let perspective = object(camera['perspective'], 'perspective camera')
    const animation = field(field(camera['extensions'], 'UV_scene_camera'), 'sequenceAnimation')
    if (animation !== undefined) {
      const sampled = sampleUvmSceneProperties(
        animation,
        {
          yfov: positive(perspective['yfov'], 'camera yfov'),
          znear: positive(perspective['znear'], 'camera znear'),
          ...(perspective['zfar'] === undefined
            ? {}
            : { zfar: positive(perspective['zfar'], 'camera zfar') }),
        },
        {
          time: options.time ?? 0,
          ...(options.globalTime === undefined ? {} : { globalTime: options.globalTime }),
          ...(options.sequenceIndex === undefined ? {} : { sequenceIndex: options.sequenceIndex }),
          maxKeys: options.maxNodes,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      )
      perspective = { ...perspective, ...sampled }
    }
    const fov = positive(perspective['yfov'], 'camera yfov'),
      near = positive(perspective['znear'], 'camera znear')
    if (!(fov < Math.PI)) throw new TypeError('camera yfov must be below PI')
    if (perspective['zfar'] === undefined)
      throw new TypeError('infinite-far camera is not supported by the selected projection library')
    const far = positive(perspective['zfar'], 'camera zfar')
    if (!(far > near)) throw new TypeError('camera zfar must exceed znear')
    const aspect = positive(perspective['aspectRatio'] ?? options.aspect, 'camera aspect')
    projection = new PerspectiveCamera(MathUtils.radToDeg(fov), aspect, near, far).projectionMatrix
  } else if (camera['type'] === 'orthographic') {
    const orthographic = object(camera['orthographic'], 'orthographic camera')
    const x = positive(orthographic['xmag'], 'camera xmag'),
      y = positive(orthographic['ymag'], 'camera ymag')
    const near = orthographic['znear'],
      far = positive(orthographic['zfar'], 'camera zfar')
    if (typeof near !== 'number' || !Number.isFinite(near) || near < 0 || far <= near)
      throw new TypeError('orthographic camera clip interval is invalid')
    projection = new OrthographicCamera(-x, x, y, -y, near, far).projectionMatrix
  } else throw new TypeError('camera type is unsupported')
  const result = {
    viewProjection: ownedMatrix(new Matrix4().multiplyMatrices(projection, view)),
    viewMatrix: ownedMatrix(view),
    eyePosition: xyz(position),
  }
  options.signal?.throwIfAborted()
  return result
}
