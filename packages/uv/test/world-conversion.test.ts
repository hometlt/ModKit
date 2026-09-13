import { describe, expect, it } from 'vitest'

import {
  createUvwConversionReceipt,
  preflightUvwConversionProfile,
  UVW_CONVERSION_PROFILE_IDS,
} from '../src/world/index.js'

describe('UVW conversion profiles and receipts', () => {
  it('preflights every named guarantee without silently lowering unsupported requests', () => {
    expect(UVW_CONVERSION_PROFILE_IDS).toEqual([
      'geometry',
      'visual-world',
      'native-authored-map',
      'playable-scenario',
    ])
    expect(preflightUvwConversionProfile(undefined, ['geometry'])).toEqual({
      accepted: true,
      requestedProfile: 'geometry',
    })
    expect(preflightUvwConversionProfile('visual-world', ['geometry'])).toMatchObject({
      accepted: false,
      requestedProfile: 'visual-world',
      refusal: { code: 'conversion-profile-unsupported', path: 'options.profile' },
    })
    expect(preflightUvwConversionProfile('invented', ['geometry'])).toMatchObject({
      accepted: false,
      requestedProfile: undefined,
      refusal: { code: 'conversion-profile-unknown', path: 'options.profile' },
    })
  })

  it('owns a machine-readable receipt and never reports an unmeasured loss as zero error', () => {
    const loss = {
      feature: 'layers.logic',
      reason: 'UVW spatial conversion excludes gameplay logic',
      replacement: 'omitted',
    }
    const verification = { reopened: true, mapping: { scale: 128 } }
    const receipt = createUvwConversionReceipt({
      targetGameId: 'wz2100/wz2100',
      artifactKind: 'wz-archive',
      requestedProfile: 'geometry',
      achievedProfile: 'geometry',
      status: 'converted',
      losses: [loss],
      verification,
    })
    verification.mapping.scale = 1
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      source: { family: 'uvw', format: 'UVW', version: '1.0' },
      target: { gameId: 'wz2100/wz2100', artifactKind: 'wz-archive' },
      requestedProfile: 'geometry',
      achievedProfile: 'geometry',
      status: 'converted',
      losses: [
        {
          ...loss,
          measurement: {
            kind: 'not-measured',
            reason: 'the converter did not provide a numeric error bound',
          },
        },
      ],
      verification: { reopened: true, mapping: { scale: 128 } },
    })
    expect(Object.isFrozen(receipt.verification)).toBe(true)
    expect(() =>
      createUvwConversionReceipt({
        targetGameId: 'blizzard/starcraft-2',
        artifactKind: 'sc2map',
        requestedProfile: 'geometry',
        status: 'converted',
      }),
    ).toThrow(/achieved profile/u)
  })
})
