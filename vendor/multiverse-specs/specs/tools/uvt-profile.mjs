/**
 * Reference implementation of the UVT/core 1.0 cross-field rules.
 *
 * Normative text: ../texture/SPEC_UVT.md. The JSON Schema in `../texture/schema/` says what shape a
 * sidecar has; this module says the handful of things a schema cannot: that a premultiplied alpha
 * mode needs the container flag behind it, that a cubemap is square, that mip filtering needs mips,
 * and that an atlas region lies inside the image it cuts up.
 *
 * Each rule is refused rather than repaired. Clamping a region that runs off the edge silently
 * produces a different sprite, and defaulting a contradictory alpha mode silently produces a
 * different picture — both are worse than a diagnostic.
 *
 * Dependency-free by design: Node built-ins only.
 */

/** One violated rule, named by the id the vectors use. */
export class UvtRuleError extends TypeError {
  constructor(rule, message) {
    super(message)
    this.name = 'UvtRuleError'
    this.rule = rule
  }
}

const refuse = (rule, message) => {
  throw new UvtRuleError(rule, message)
}

/**
 * Check every cross-field rule of the profile. Returns the sidecar on success.
 *
 * Ordered deliberately: container consistency first, then UV-level semantics that depend on it. A
 * consumer that hit two problems should hear about the structural one.
 */
export function assertUvtProfile(sidecar) {
  const ktx2 = sidecar?.ktx2
  if (ktx2 === undefined) refuse('sidecar-shape', 'a UVT sidecar must carry its ktx2 block')

  if (ktx2.faceCount === 6 && ktx2.pixelWidth !== ktx2.pixelHeight) {
    refuse(
      'cube-must-be-square',
      `a cubemap face count of 6 requires a square image, found ${ktx2.pixelWidth}x${ktx2.pixelHeight}`,
    )
  }
  if (!Number.isInteger(ktx2.levelCount) || ktx2.levelCount < 1) {
    refuse(
      'level-count-explicit',
      'levelCount must be at least 1: KTX2 encodes «generate mips at load» as 0, which is a loader instruction rather than a description of the file',
    )
  }
  if (sidecar.alphaMode === 'premultiplied' && sidecar.color?.premultipliedAlpha !== true) {
    refuse(
      'premultiplied-needs-flag',
      'alphaMode «premultiplied» contradicts a container whose alpha-premultiplied flag is clear',
    )
  }
  if (sidecar.alphaMode === 'opaque' && sidecar.color?.premultipliedAlpha === true) {
    refuse(
      'opaque-cannot-be-premultiplied',
      'alphaMode «opaque» contradicts a container that declares premultiplied alpha',
    )
  }
  if (sidecar.sampler?.mipFilter !== undefined && sidecar.sampler.mipFilter !== 'none') {
    if (ktx2.levelCount <= 1) {
      refuse(
        'mip-filter-needs-mips',
        `mipFilter «${sidecar.sampler.mipFilter}» asks for filtering across levels a single-level texture does not have`,
      )
    }
  }
  const regions = sidecar.atlas?.regions
  if (regions !== undefined) {
    const seen = new Set()
    for (const region of regions) {
      if (seen.has(region.id)) {
        refuse('atlas-region-id-unique', `atlas region id «${region.id}» is used twice`)
      }
      seen.add(region.id)
      if (
        region.x + region.width > ktx2.pixelWidth ||
        region.y + region.height > ktx2.pixelHeight
      ) {
        refuse(
          'atlas-region-inside-image',
          `atlas region «${region.id}» runs outside the ${ktx2.pixelWidth}x${ktx2.pixelHeight} image; clamping it would silently produce a different sprite`,
        )
      }
    }
  }
  return sidecar
}
