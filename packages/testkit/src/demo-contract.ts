/**
 * The lab demo contract `x3.demo/greeter@1` — the shared conformance fixture used by
 * internal tests, the CLI examples and the external packed-tarball extension proof.
 * A greeter provider module exports `createGreeter(spec)` → `{ greet(name): string }`.
 */

import { contractId } from '@modkitx-x3/core'
import type { ContributionContractRegistration, JsonValue } from '@modkitx-x3/sdk'
import { PROVIDER_OFFER_INVENTORY_FACT } from '@modkitx-x3/host'

/** Declaration-emission proof: inferred branded literals remain nameable to extension authors. */
export const GREETER_CONTRACT = contractId('x3.demo/greeter')
export const GREETER_CONTRIBUTION_CONTRACT = contractId('x3.demo/greeter-contribution')
export const GREETER_MAJOR = 1

export const greeterSpecSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    greeting: { type: 'string', minLength: 1 },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'definitionVersion', 'representation', 'presence'],
        properties: {
          id: { type: 'string', minLength: 1 },
          definitionVersion: { type: 'string', minLength: 1 },
          representation: { enum: ['source', 'compiled', 'runtime'] },
          presence: { enum: ['may-expose', 'will-expose'] },
        },
      },
    },
  },
} as const

export const greeterSpecEntry: ContributionContractRegistration = {
  contract: { id: GREETER_CONTRIBUTION_CONTRACT, major: GREETER_MAJOR },
  schema: greeterSpecSchema,
  mode: 'executable',
  validateSemantics: () => [],
  project: (manifest, context) => {
    const spec = manifest.spec as {
      readonly outputs?: readonly {
        readonly id: string
        readonly definitionVersion: string
        readonly presence: string
      }[]
    }
    return (manifest.runtimeVariants ?? []).map(variant => ({
      contract: { id: PROVIDER_OFFER_INVENTORY_FACT, major: 1 },
      value: {
        kind: 'primary',
        extensionId: context.ownerExtensionId,
        extensionVersion: context.extensionVersion,
        providerId: manifest.id,
        runtimeVariant: variant.variantId,
        target: variant.target,
        requiredPermissions: variant.requestedPermissionClasses,
        provides: [
          {
            offerId: variant.variantId,
            contract: GREETER_CONTRACT,
            major: GREETER_MAJOR,
            version: '1.0.0',
          },
        ],
        outputs: (spec.outputs ?? [])
          .filter(output => output.presence === 'will-expose')
          .map(output => ({ id: output.id, definitionVersion: output.definitionVersion })),
      } as unknown as JsonValue,
      provenance: context,
    }))
  },
  moduleAbi: { export: 'createGreeter', abiVersion: 1 },
  conformanceProfile: 'x3.demo/greeter-v1',
}

export interface Greeter {
  greet(name: string): string
}

export interface GreeterModule {
  createGreeter(spec: unknown): Greeter
}

export function asGreeterModule(module: Record<string, unknown>): GreeterModule {
  const factory = module['createGreeter']
  if (typeof factory !== 'function') {
    throw new TypeError('module does not export createGreeter(spec)')
  }
  return { createGreeter: factory as GreeterModule['createGreeter'] }
}
