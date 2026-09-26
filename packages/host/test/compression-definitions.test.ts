import { describe, expect, it } from 'vitest'
import {
  OODLE_DECODER_CONTRACT_DEFINITION,
  registerStandardCompressionDefinitions,
} from '../src/compression-definitions.js'
import { createBundledServiceDefinitionRegistry } from '../src/subject-services.js'

describe('standard compression definitions', () => {
  it('registers the facetless Oodle decoder contract with its batch method', async () => {
    const registry = createBundledServiceDefinitionRegistry()
    expect(await registerStandardCompressionDefinitions(registry)).toEqual({ state: 'committed' })
    expect(OODLE_DECODER_CONTRACT_DEFINITION.contract).toBe('common.compression/oodle-decoder')
    expect(Object.keys(OODLE_DECODER_CONTRACT_DEFINITION.surface?.methods ?? {})).toEqual([
      'decompressBlocks',
    ])
  })
})
