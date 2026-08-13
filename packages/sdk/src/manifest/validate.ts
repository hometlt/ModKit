/**
 * Runtime validation: the same schema consts compiled with Ajv (2020-12 dialect).
 * Justification for the single external dependency: PORTED.md (a hand-written JSON
 * Schema validator would itself be a second, drifting authority).
 *
 * Ajv's ~250-file CJS graph loads lazily through a browser-safe dynamic import on the
 * first validation, which is why the validation API is async: importing the sdk stays
 * cheap (the static import cost ~700 ms on the reference machine, bench C3), and pure
 * schema/type consumers never pay for the validator.
 */

import { diagnostic, type Diagnostic } from '@modkitx-x3/core'
import type { ErrorObject } from 'ajv/dist/2020.js'

interface ValidateFn {
  (value: unknown): boolean
  errors?: ErrorObject[] | null
}
interface AjvLike {
  compile(schema: object): ValidateFn
}

let ajvPromise: Promise<AjvLike> | undefined
const cache = new WeakMap<object, ValidateFn>()

async function instance(): Promise<AjvLike> {
  ajvPromise ??= import('ajv/dist/2020.js').then(
    mod => new mod.Ajv2020({ allErrors: true, strict: true }) as unknown as AjvLike,
  )
  return ajvPromise
}

async function compiled(schema: object): Promise<ValidateFn> {
  const cached = cache.get(schema)
  if (cached) return cached
  const validate = (await instance()).compile(schema)
  cache.set(schema, validate)
  return validate
}

function toPath(error: ErrorObject): (string | number)[] {
  return error.instancePath
    .split('/')
    .filter(part => part.length > 0)
    .map(part =>
      /^\d+$/.test(part) ? Number(part) : part.replaceAll('~1', '/').replaceAll('~0', '~'),
    )
}

/** Validates `value` against a schema const; returns diagnostics, never throws. */
export async function validateWithSchema(
  schema: object,
  value: unknown,
  code = 'x3.sdk/schema-violation',
): Promise<Diagnostic[]> {
  const validate = await compiled(schema)
  if (validate(value)) return []
  return (validate.errors ?? []).map(error =>
    diagnostic(
      'error',
      code,
      `${error.instancePath || '/'} ${error.message ?? 'schema violation'}`,
      toPath(error),
      { keyword: error.keyword, params: error.params },
    ),
  )
}
