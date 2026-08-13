/**
 * Runtime validation: the same schema consts compiled with Ajv (2020-12 dialect).
 * Justification for the single external dependency: PORTED.md (a hand-written JSON
 * Schema validator would itself be a second, drifting authority).
 */

import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js'
import { diagnostic, type Diagnostic } from '@modkitx-x3/core'

const ajv = new Ajv2020({ allErrors: true, strict: true })
const cache = new WeakMap<object, ValidateFunction>()

function compiled(schema: object): ValidateFunction {
  let validate = cache.get(schema)
  if (!validate) {
    validate = ajv.compile(schema)
    cache.set(schema, validate)
  }
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
export function validateWithSchema(
  schema: object,
  value: unknown,
  code = 'x3.sdk/schema-violation',
): Diagnostic[] {
  const validate = compiled(schema)
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
