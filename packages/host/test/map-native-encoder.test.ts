import { describe, expect, it } from 'vitest'
import { contractId } from '@modkit/core'
import { NATIVE_MAP_ENCODER_CONTRACT, NATIVE_MAP_ENCODER_MATCHER_PROFILE } from '@modkit/sdk/maps'
import {
  createBundledServiceDefinitionRegistry,
  NATIVE_MAP_ENCODER_MATCHER,
  registerStandardMapDefinitions,
  STANDARD_MAPS_OWNER,
} from '@modkit/host'

describe('native map encoder capability (WT10)', () => {
  const context = {
    contract: contractId(NATIVE_MAP_ENCODER_CONTRACT),
    major: 1,
    ownerExtensionId: 'org.example/maps',
  }

  it('routes an exact target map format and refuses a malformed offer', async () => {
    expect(NATIVE_MAP_ENCODER_MATCHER.profile).toBe(contractId(NATIVE_MAP_ENCODER_MATCHER_PROFILE))
    expect(
      await NATIVE_MAP_ENCODER_MATCHER.match(
        {
          ...context,
          offerFacet: { formatIds: ['ra2-map', 'ts-map'] },
          requestFacet: { formatId: 'ts-map' },
        },
        undefined,
      ),
    ).toEqual({ state: 'match', selectionKey: 'format=ts-map' })
    expect(
      await NATIVE_MAP_ENCODER_MATCHER.match(
        {
          ...context,
          offerFacet: { formatIds: ['ra2-map'] },
          requestFacet: { formatId: 'minecraft-anvil' },
        },
        undefined,
      ),
    ).toEqual({ state: 'no-match' })
    const invalid = await NATIVE_MAP_ENCODER_MATCHER.match(
      {
        ...context,
        offerFacet: { formatIds: ['ra2-map', 'ra2-map'] },
        requestFacet: { formatId: 'ra2-map' },
      },
      undefined,
    )
    expect(invalid).toMatchObject({
      state: 'invalid',
      diagnostics: [{ code: 'x3.host/native-map-encoder-facet-invalid' }],
    })
  })

  it('is one of the platform map definitions', async () => {
    const registry = createBundledServiceDefinitionRegistry()
    expect(await registerStandardMapDefinitions(registry)).toEqual({ state: 'committed' })
    const registered = registry.lookup(contractId(NATIVE_MAP_ENCODER_CONTRACT), 1)
    expect(registered?.provenance.ownerExtensionId).toBe(STANDARD_MAPS_OWNER)
    expect(registered?.surface?.fields).toEqual(['contract', 'formatId', 'extension', 'mediaType'])
    expect(registered?.surface?.methods).toHaveProperty('encode')
  })
})
