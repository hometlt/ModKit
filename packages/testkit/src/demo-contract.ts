/**
 * The lab demo contract `x3.demo/greeter@1` — the shared conformance fixture used by
 * internal tests, the CLI examples and the external packed-tarball extension proof.
 * A greeter provider module exports `createGreeter(spec)` → `{ greet(name): string }`.
 */

import type { SpecSchemaEntry } from '@modkitx-x3/sdk'

export const GREETER_CONTRACT = 'x3.demo/greeter'
export const GREETER_MAJOR = 1

export const greeterSpecSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    greeting: { type: 'string', minLength: 1 },
    outputs: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const

export const greeterSpecEntry: SpecSchemaEntry = {
  contract: GREETER_CONTRACT,
  major: GREETER_MAJOR,
  schema: greeterSpecSchema,
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
