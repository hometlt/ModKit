import { expect, it } from 'vitest'
import { SERVICE_OPERATION_PROVIDER_CONTRACT } from '@modkit/sdk'
import { validateServiceOperationProvider } from '../src/service-operations.js'

const provider = (surface: object) => ({
  contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
  providerId: 'modkit.test/textures',
  operations: [
    {
      schemaVersion: 1,
      id: 'modkit.test/button-frame',
      title: 'Button frame',
      summary: 'Frame an icon as a button.',
      requiredPermissions: [],
      effects: 'none',
      inputSchema: { type: 'object' },
      resultSchema: { type: 'object' },
      budget: { maxInputBytes: 1024, maxOutputBytes: 1024, maxWallTimeMs: 100 },
      surface: { target: 'viewer.image', sectionId: 'icons', title: 'Icons', ...surface },
    },
  ],
  async invoke() {
    throw new Error('not invoked')
  },
})

it('lets a pixel operation name the copy a viewer writes after it (7.13, tex.button.dds)', () => {
  expect(validateServiceOperationProvider(provider({ copyPresetId: 'button' })).valid).toBe(true)
  for (const copyPresetId of ['', 'Button', '../x', 'a'.repeat(33), 7])
    expect(validateServiceOperationProvider(provider({ copyPresetId })).valid).toBe(false)
})
