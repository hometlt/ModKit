/** Check each recursive field arm; only recursive edges use the already checked public type. */
import type { FromSchema } from 'json-schema-to-ts'
import type { JsonValue } from '../src/asset-capabilities/types.js'
import type {
  FieldType,
  FieldSchema,
  FieldWriteRequest,
  FieldEditInputSchemaV1,
  FieldEditorContributionSpecV1Wire,
  SubjectFilter,
  SubjectKindDefinitionSpecV1,
} from '../src/fields/index.js'
import {
  fieldTypeValueSchema,
  fieldSchemaValueSchema,
  fieldWriteRequestV1Schema,
  fieldEditInputSchemaV1Schema,
  fieldEditorContributionSpecV1Schema,
  subjectFilterSchema,
  subjectKindDefinitionSpecV1Schema,
} from '../src/schemas/fields.js'

const definitions = {
  jsonValue: { title: 'JsonValue' },
  fieldType: { title: 'FieldType' },
} as const
export const field = { ...fieldTypeValueSchema, $defs: definitions } as const
export const schema = { ...fieldSchemaValueSchema, $defs: definitions } as const
export const request = { ...fieldWriteRequestV1Schema, $defs: definitions } as const
export const editInput = { ...fieldEditInputSchemaV1Schema, $defs: definitions } as const
export const filter = { ...subjectFilterSchema, $defs: definitions } as const
interface Options {
  deserialize: [
    { pattern: { title: 'JsonValue' }; output: JsonValue },
    // Match only the marker (the oneOf root has the same title and must remain structural).
    { pattern: { title: 'FieldType'; oneOf?: never }; output: FieldType },
  ]
}
type ReadonlyWire<T> = T extends readonly (infer U)[]
  ? readonly ReadonlyWire<U>[]
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyWire<T[K]> }
    : T
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T
export type FieldTypeDrift = Expect<
  Same<FieldType, ReadonlyWire<FromSchema<typeof field, Options>>>
>
export type FieldSchemaDrift = Expect<
  Same<FieldSchema, ReadonlyWire<FromSchema<typeof schema, Options>>>
>
export type FieldWriteDrift = Expect<
  Same<FieldWriteRequest, ReadonlyWire<FromSchema<typeof request, Options>>>
>
export type FieldEditInputDrift = Expect<
  Same<FieldEditInputSchemaV1, ReadonlyWire<FromSchema<typeof editInput, Options>>>
>
export type FieldEditorContributionDrift = Expect<
  Same<
    FieldEditorContributionSpecV1Wire,
    ReadonlyWire<FromSchema<typeof fieldEditorContributionSpecV1Schema>>
  >
>
export type SubjectFilterDrift = Expect<
  Same<SubjectFilter, ReadonlyWire<FromSchema<typeof filter, Options>>>
>
export type SubjectKindDrift = Expect<
  Same<
    SubjectKindDefinitionSpecV1,
    ReadonlyWire<FromSchema<typeof subjectKindDefinitionSpecV1Schema, Options>>
  >
>
