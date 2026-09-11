import { describe, expect, it } from 'vitest'
import { contractId } from '@modkit/core'
import {
  NATIVE_MODEL_ENCODER_CONTRACT,
  NATIVE_MODEL_ENCODER_MATCHER_PROFILE,
} from '@modkit/sdk/model-encoding'
import {
  createBundledServiceDefinitionRegistry,
  NATIVE_MODEL_ENCODER_MATCHER,
  registerStandardModelEncodingDefinitions,
  STANDARD_MODEL_ENCODING_OWNER,
} from '@modkit/host'

describe('native model encoder capability', () => {
  const context = {
    contract: contractId(NATIVE_MODEL_ENCODER_CONTRACT),
    major: 1,
    ownerExtensionId: 'org.example/models',
  }

  it('routes an exact target format and refuses malformed or different targets', async () => {
    expect(NATIVE_MODEL_ENCODER_MATCHER.profile).toBe(
      contractId(NATIVE_MODEL_ENCODER_MATCHER_PROFILE),
    )
    expect(
      await NATIVE_MODEL_ENCODER_MATCHER.match(
        {
          ...context,
          offerFacet: { formatIds: ['m3', 'm3a'] },
          requestFacet: { formatId: 'm3a' },
        },
        undefined,
      ),
    ).toEqual({ state: 'match', selectionKey: 'format=m3a' })
    expect(
      await NATIVE_MODEL_ENCODER_MATCHER.match(
        {
          ...context,
          offerFacet: { formatIds: ['m3'] },
          requestFacet: { formatId: 'warzone-pie' },
        },
        undefined,
      ),
    ).toEqual({ state: 'no-match' })
    expect(
      (
        await NATIVE_MODEL_ENCODER_MATCHER.match(
          { ...context, offerFacet: { formatIds: [] }, requestFacet: { formatId: 'm3' } },
          undefined,
        )
      ).state,
    ).toBe('invalid')
  })

  it('registers one standard encoder surface in the bundled registry', async () => {
    const registry = createBundledServiceDefinitionRegistry()
    expect(await registerStandardModelEncodingDefinitions(registry)).toEqual({ state: 'committed' })
    const registered = registry.lookup(contractId(NATIVE_MODEL_ENCODER_CONTRACT), 1)
    expect(registered?.provenance.ownerExtensionId).toBe(STANDARD_MODEL_ENCODING_OWNER)
    expect(registered?.surface?.fields).toEqual([
      'contract',
      'formatId',
      'extension',
      'mediaType',
    ])
    expect(registered?.surface?.methods).toHaveProperty('encode')
  })
})
