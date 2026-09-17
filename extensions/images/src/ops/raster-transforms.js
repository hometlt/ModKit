/**
 * The pixel transforms MK2 shipped, by name, and the raster export every image codec shares.
 *
 * `ops/raster-ops.js` holds six transforms — resize, the SC2 normal-map conversion, the normal and
 * specular combine, rounded alpha, the button-icon preparation and colour-key transparency. MK2
 * reached them (and its DDS/PNG file conversions, `apps/modkit-vscode/src/dds-commands.ts`) from
 * VS Code commands; MK3 puts them behind codec operations instead — `edit.content` for an in-place
 * edit plan, `export.convert` for a new file — so the app, the editor and a script all reach the
 * same code.
 *
 * Each entry states what it needs, because the failures are silent otherwise: `combineNormalSpecular`
 * wants a second image and produces nonsense from one, and `prepareSc2ButtonIcon` assumes a square
 * icon. Checking here means a caller gets told; checking nowhere means a modder gets a wrong texture.
 */

import { ENCODABLE_FORMATS, chooseDdsFormatForImage, encodeDds } from '../dds/encode.js'
import { encodePng } from '../writers/png-encoder.js'
import {
  applyColorKeyTransparency,
  applyRoundedAlpha,
  combineNormalSpecular,
  convertNormalMapToSc2,
  prepareSc2ButtonIcon,
  resizeRgba,
} from './raster-ops.js'

/** MK2 `prepareDdsSc2ButtonIcon`: a square icon no larger than 256 × 256. */
const BUTTON_ICON_MAX = 256

export const TRANSFORMS = Object.freeze({
  /** No pixel change: re-encode only (MK2 "DDS Convert DXT5 Binary Alpha to DXT1"). */
  recompress: {
    label: 'Re-encode',
    apply: image => image,
  },
  resize: {
    label: 'Resize',
    apply: (image, request) => {
      const width = Number(request.width)
      const height = Number(request.height)
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0
      ) {
        throw new TypeError('resize requires a positive integer width and height')
      }
      return resizeRgba(image, width, height)
    },
  },
  'normal-map': {
    label: 'Convert normal map to the SC2 channel layout',
    apply: image => convertNormalMapToSc2(image),
  },
  'combine-normal-specular': {
    label: 'Combine a normal map with a specular map',
    apply: (image, request) => {
      const specular = imageFromRequest(request.specular)
      if (specular === undefined) {
        throw new TypeError('combine-normal-specular requires a specular image')
      }
      if (specular.width !== image.width || specular.height !== image.height) {
        throw new TypeError('combine-normal-specular requires both images at the same size')
      }
      return combineNormalSpecular(image, specular)
    },
  },
  'rounded-alpha': {
    label: 'Round the alpha corners',
    apply: (image, request) => {
      const radius = Number(request.radius ?? 0)
      if (!Number.isFinite(radius) || radius < 0) {
        throw new TypeError('rounded-alpha requires a non-negative radius')
      }
      return applyRoundedAlpha(image, radius)
    },
  },
  'button-icon': {
    label: 'Prepare an SC2 button icon',
    apply: (image, request) => {
      if (image.width !== image.height) {
        throw new TypeError(
          `button-icon requires a square image, got ${image.width} x ${image.height}`,
        )
      }
      if (image.width > BUTTON_ICON_MAX) {
        throw new TypeError(
          `button-icon requires an icon no larger than ${BUTTON_ICON_MAX} x ${BUTTON_ICON_MAX}, got ${image.width} x ${image.height}`,
        )
      }
      return prepareSc2ButtonIcon(image, request.options ?? {})
    },
  },
  /**
   * Whole-image replacement: the pixels a viewer's paint tools produced (crop and resize included),
   * re-encoded by the codec. `image` is `{ width, height, pixels }`, pixels as base64 or numbers.
   */
  replace: {
    label: 'Replace pixels',
    apply: (_image, request) => {
      const image = imageFromRequest(request.image)
      if (image === undefined) throw new TypeError('replace requires an image')
      return image
    },
  },
  'color-key': {
    label: 'Make one colour transparent',
    apply: (image, request) => {
      // The library's own option names, so a caller reads one vocabulary rather than two.
      const target = request.target
      if (target === null || typeof target !== 'object') {
        throw new TypeError('color-key requires a target colour as { r, g, b }')
      }
      for (const channel of ['r', 'g', 'b']) {
        if (!Number.isFinite(Number(target[channel]))) {
          throw new TypeError(`color-key target is missing ${channel}`)
        }
      }
      return applyColorKeyTransparency(image, {
        target,
        ...(request.tolerance === undefined ? {} : { tolerance: Number(request.tolerance) }),
        ...(request.replacement === undefined ? {} : { replacement: request.replacement }),
      })
    },
  },
})

/** Look a transform up by name, or refuse with the list of names that exist. */
export function transformNamed(name) {
  const transform = typeof name === 'string' ? TRANSFORMS[name] : undefined
  if (transform === undefined) {
    throw new TypeError(`raster transform must be one of ${Object.keys(TRANSFORMS).join(', ')}`)
  }
  return transform
}

/** An `{ width, height, pixels }` image supplied in a request, with pixels as a number array. */
function imageFromRequest(value) {
  if (value === null || typeof value !== 'object') return undefined
  const width = Number(value.width)
  const height = Number(value.height)
  const pixels = Array.isArray(value.pixels)
    ? Uint8Array.from(value.pixels)
    : typeof value.pixels === 'string'
      ? Uint8Array.from(atob(value.pixels), character => character.charCodeAt(0))
      : undefined
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || pixels === undefined) {
    return undefined
  }
  if (pixels.length !== width * height * 4) {
    throw new TypeError('a supplied image needs width * height * 4 RGBA bytes')
  }
  return { width, height, pixels }
}

export const EXPORT_TARGETS = Object.freeze(['png', 'dds', 'rgba8'])
/** MK2 `convertPngIconToDds`: a square icon strictly smaller than 256 × 256. */
const PNG_ICON_LIMIT = 256

function firstPartialAlpha(pixels) {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0 && pixels[index] < 255) return index
  }
  return -1
}

/**
 * `export.convert` for any decoded raster: optionally one named transform, then one encoding.
 *
 * `request` is `{ target: 'png' | 'dds' | 'rgba8', format?, transform?, transformInput?, icon? }`;
 * `transformInput` is what the `edit.content` transform of the same name reads (e.g. `{ width, height }`).
 * `format` (DDS only) is one of the encodable DDS formats, `auto`, or `keep`; it defaults to DXT5 for an
 * icon or a button icon (what MK2 wrote) and to `defaultDdsFormat` otherwise. DXT1 keeps one bit of
 * alpha, so a source with a partially transparent texel is refused with its coordinates rather
 * than quietly thresholded — the MK2 `convertDxt5DdsToDxt1` rule. `icon: true` is the MK2
 * `convertPngIconToDds` rule: a square image smaller than 256 × 256.
 */
export async function exportRaster(image, request, options = {}) {
  const target = request?.target
  if (!EXPORT_TARGETS.includes(target)) {
    throw new TypeError(`raster export target must be one of ${EXPORT_TARGETS.join(', ')}`)
  }
  const transformName = request.transform
  const result =
    transformName === undefined
      ? image
      : transformNamed(transformName).apply(image, request.transformInput ?? {})
  if (request.icon === true) {
    if (image.width !== image.height) {
      throw new TypeError(`expected a square icon, got ${image.width} x ${image.height}`)
    }
    if (image.width >= PNG_ICON_LIMIT) {
      throw new TypeError(
        `expected an icon smaller than ${PNG_ICON_LIMIT} x ${PNG_ICON_LIMIT}, got ${image.width} x ${image.height}`,
      )
    }
  }
  if (target === 'rgba8') return result.pixels
  if (target === 'png') return encodePng(result.width, result.height, result.pixels, options.signal)
  const iconLike = request.icon === true || transformName === 'button-icon'
  const named = request.format === 'keep' ? undefined : request.format
  const requested = named ?? (iconLike ? 'dxt5' : (options.defaultDdsFormat ?? 'rgba8'))
  const format = requested === 'auto' ? chooseDdsFormatForImage(result) : requested
  if (!ENCODABLE_FORMATS.includes(format)) {
    throw new TypeError(
      `DDS: encoding ${String(format)} is not supported (encodable: ${ENCODABLE_FORMATS.join(', ')}, auto)`,
    )
  }
  if (format === 'dxt1') {
    const partial = firstPartialAlpha(result.pixels)
    if (partial !== -1) {
      const pixel = (partial - 3) / 4
      throw new TypeError(
        `DXT1 conversion requires binary alpha; pixel ${pixel % result.width},${Math.floor(pixel / result.width)} has alpha ${result.pixels[partial]}`,
      )
    }
  }
  return encodeDds(result, { format })
}

const FORMAT_MEMBERS = Object.freeze([
  Object.freeze({ id: 'keep', label: 'Keep the source encoding' }),
  Object.freeze({ id: 'dxt1', label: 'DXT1 / BC1 (binary alpha)' }),
  Object.freeze({ id: 'dxt3', label: 'DXT3 / BC2' }),
  Object.freeze({ id: 'dxt5', label: 'DXT5 / BC3' }),
  Object.freeze({ id: 'rgba8', label: 'Uncompressed RGBA8' }),
  Object.freeze({ id: 'auto', label: 'DXT5 if any texel is partially transparent, else DXT1' }),
])

const formatField = initial =>
  Object.freeze({
    key: 'format',
    label: 'Encoding',
    type: Object.freeze({ kind: 'enum', members: FORMAT_MEMBERS }),
    inputPath: Object.freeze(['format']),
    initial,
  })

const numberField = (key, label, inputPath, initial, extra = {}) =>
  Object.freeze({
    key,
    label,
    type: Object.freeze({ kind: 'number', ...extra }),
    inputPath: Object.freeze(inputPath),
    required: true,
    initial,
  })

const form = (id, transform, label, summary, fields) =>
  Object.freeze({
    id,
    label,
    summary,
    baseInput: Object.freeze({ transform }),
    fields: Object.freeze(fields),
  })

/**
 * The `edit.content` input schema a DDS publishes: one generic edit-panel form per transform, so
 * VS Code, Electron and the web app offer the same texture edits without any host code.
 * `combine-normal-specular` needs a second image and stays script/command-only.
 */
export const DDS_EDIT_CONTENT_SCHEMA = Object.freeze({
  $ref: 'modkit://images/dds-edit-content.v1',
  document: Object.freeze({
    schemaVersion: 1,
    forms: Object.freeze([
      form(
        'dds-button-icon',
        'button-icon',
        'Prepare an SC2 button icon',
        'Insets a square icon (at most 256 x 256) in a transparent frame with rounded corners.',
        [
          formatField('dxt5'),
          numberField(
            'framePercent',
            'Frame (fraction of the edge)',
            ['options', 'framePercent'],
            5 / 128,
            {
              min: 0,
              max: 0.45,
            },
          ),
        ],
      ),
      form(
        'dds-recompress',
        'recompress',
        'Change the DDS encoding',
        'Re-encodes the base surface; DXT1 is refused while any texel is partially transparent.',
        [formatField('dxt1')],
      ),
      form('dds-resize', 'resize', 'Resize', 'Bilinear resample of the base surface.', [
        numberField('width', 'Width', ['width'], 64, { integer: true, min: 1 }),
        numberField('height', 'Height', ['height'], 64, { integer: true, min: 1 }),
        formatField('keep'),
      ]),
      form(
        'dds-color-key',
        'color-key',
        'Make one colour transparent',
        'Every texel within the tolerance of the colour becomes fully transparent.',
        [
          numberField('r', 'Red', ['target', 'r'], 255, { integer: true, min: 0, max: 255 }),
          numberField('g', 'Green', ['target', 'g'], 0, { integer: true, min: 0, max: 255 }),
          numberField('b', 'Blue', ['target', 'b'], 255, { integer: true, min: 0, max: 255 }),
          numberField('tolerance', 'Tolerance', ['tolerance'], 0, {
            integer: true,
            min: 0,
            max: 255,
          }),
          formatField('keep'),
        ],
      ),
      form(
        'dds-rounded-alpha',
        'rounded-alpha',
        'Round the alpha corners',
        'Cuts the corners to transparent.',
        [numberField('radius', 'Radius', ['radius'], 8, { min: 0 }), formatField('keep')],
      ),
      form(
        'dds-normal-map',
        'normal-map',
        'Convert a normal map to the SC2 layout',
        'Moves the normal channels into the layout the SC2 shaders read.',
        [formatField('keep')],
      ),
    ]),
  }),
})

const preset = (id, label, summary, baseInput) =>
  Object.freeze({
    id,
    label,
    summary,
    baseInput: Object.freeze(baseInput),
    fields: Object.freeze([]),
  })

/** `export.convert` presets of a DDS: MK2's DDS file commands, offered by every image viewer. */
export const DDS_EXPORT_SCHEMA = Object.freeze({
  $ref: 'modkit://images/dds-export-convert.v1',
  document: Object.freeze({
    schemaVersion: 1,
    forms: Object.freeze([
      preset('png', 'Export PNG', 'Writes the base mip as a PNG file.', { target: 'png' }),
      preset(
        'dxt1',
        'Convert to DXT1',
        'Writes a DXT1 copy; refused while any texel is partially transparent.',
        { target: 'dds', format: 'dxt1' },
      ),
      preset(
        'button',
        'Prepare SC2 button icon',
        'Writes a DXT5 button icon (square source, at most 256 x 256) with a transparent frame.',
        { target: 'dds', transform: 'button-icon' },
      ),
    ]),
  }),
})

/** `export.convert` presets of a PNG: MK2's "Convert PNG Icon to DDS". */
export const PNG_EXPORT_SCHEMA = Object.freeze({
  $ref: 'modkit://images/png-export-convert.v1',
  document: Object.freeze({
    schemaVersion: 1,
    forms: Object.freeze([
      preset(
        'dds',
        'Convert icon to DDS',
        'Writes a DXT5 DDS of a square icon smaller than 256 x 256.',
        { target: 'dds', icon: true },
      ),
      preset(
        'button',
        'Prepare SC2 button icon',
        'Writes a DXT5 button icon (square source, at most 256 x 256) with a transparent frame.',
        { target: 'dds', transform: 'button-icon' },
      ),
    ]),
  }),
})
