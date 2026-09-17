/** Portable field and subject-kind contracts (`common.field/schema@1`). */
import type { OperationId } from '@modkit/core'
import type { JsonSchemaRef, JsonValue } from '../asset-capabilities/types.js'
import type { WriterRequirement } from '../editing.js'
import type { KnowledgeTarget } from '../knowledge/index.js'
import type { ExtensionAssetReference } from '../manifest/types.js'

export interface FieldMember {
  readonly id: string
  readonly label?: string
}

/** Portable constraints for selecting a root asset as a field value. */
export interface AssetReferenceFilter {
  readonly formatIds?: readonly string[]
  readonly traits?: readonly string[]
}

export type FieldType =
  | {
      readonly kind: 'text'
      readonly multiline?: boolean
      readonly pattern?: string
      readonly maxLength?: number
    }
  | {
      readonly kind: 'number'
      readonly min?: number
      readonly max?: number
      readonly integer?: boolean
      readonly unit?: string
    }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'enum'; readonly members: readonly FieldMember[]; readonly unknown?: string }
  | { readonly kind: 'flags'; readonly members: readonly FieldMember[] }
  | { readonly kind: 'color'; readonly model: 'rgb' | 'rgba' | 'argb' }
  | { readonly kind: 'vector'; readonly size: 2 | 3 | 4; readonly unit?: string }
  | { readonly kind: 'duration' | 'date' | 'bytes' | 'id' | 'path' }
  | { readonly kind: 'text-key'; readonly catalog?: string }
  | { readonly kind: 'subject-ref'; readonly subjectKind: string; readonly filter?: SubjectFilter }
  | {
      readonly kind: 'asset-ref'
      readonly accepts: AssetReferenceFilter
    }
  | { readonly kind: 'script'; readonly language: string }
  | { readonly kind: 'struct'; readonly fields: readonly FieldSchema[] }
  | { readonly kind: 'array'; readonly item: FieldType; readonly max?: number }
  | { readonly kind: 'record'; readonly key: FieldType; readonly value: FieldType }
  | {
      readonly kind: 'instructions'
      readonly keywords: Readonly<Record<string, readonly FieldType[]>>
      readonly delimiter: string
      readonly listDelimiter?: string
    }
  | { readonly kind: 'json'; readonly schema?: JsonSchemaRef }
  | { readonly kind: 'custom'; readonly typeId: string; readonly params?: JsonValue }

export interface FieldSchema {
  readonly key: string
  readonly label: string
  readonly type: FieldType
  readonly cardinality?: 'scalar' | 'append' | 'indexed'
  readonly description?: string
  readonly knowledgeTarget?: KnowledgeTarget
}

export interface SubjectFilter {
  readonly type?: string
  readonly sameTypeAs?: string
  readonly text?: string
  readonly requireTags?: readonly string[]
  readonly excludeTags?: readonly string[]
  /** Named provider predicate declared by the subject-kind contribution. */
  readonly predicate?: { readonly id: string; readonly params?: JsonValue }
}

export interface FieldEditableFor<Operation extends string> {
  readonly write: { readonly operation: Operation } | { readonly writer: WriterRequirement }
  readonly editor?: string
  readonly readonlyReason?: string
}
export type FieldEditable = FieldEditableFor<OperationId>
export type FieldEditableWire = FieldEditableFor<string>

export interface FieldWriteRequest {
  readonly groupId: string
  readonly key: string
  readonly path?: readonly string[]
  readonly value: JsonValue
}

/** One control in an operation-owned, schema-driven edit form. */
export interface FieldEditFormField extends FieldSchema {
  /** Path in the operation input. Numeric segments create array positions. */
  readonly inputPath: readonly (string | number)[]
  readonly required?: boolean
  readonly initial?: JsonValue
  /** Read an initial value from the metadata entry selected by the form binding. */
  readonly source?: 'entry-key' | 'entry-value'
  /** Presentation input is UTF-8 text; the operation receives a base64 string. */
  readonly encoding?: 'utf8-base64'
}

/** A form published by one operation input schema. */
export interface FieldEditFormSpecV1 {
  /** Fixed operation input, copied per submission. Controls cannot overwrite its top-level keys. */
  readonly baseInput?: Readonly<Record<string, JsonValue>>
  readonly id: string
  readonly label: string
  readonly summary: string
  /** Required for field edits; selects a descriptor field carrying `editable.write`. */
  readonly binding?: {
    readonly groupId: string
    readonly entryKey?: string
  }
  readonly fields: readonly FieldEditFormField[]
  /**
   * What this form writes, when it writes a file in a format of its own.
   *
   * This is how a codec extends a host's conversion menu: it declares the format and the encoding
   * it can produce, and a surface groups by `format.id` and names the entry by `encoding` — no
   * host knows which formats exist, and no label is parsed to find out. A codec that gains an
   * encoder gains a menu entry by publishing one more form.
   */
  readonly writes?: {
    readonly format: { readonly id: string; readonly label: string }
    /** Distinguishes several encodings of one format (DXT1, DXT5, RGBA8…). */
    readonly encoding?: { readonly id: string; readonly label: string }
    /** Extension for the written file, including the dot. */
    readonly extension: string
    readonly mediaType: string
  }
}

/**
 * Closed schema document consumed by every app's generic field-edit surface.
 * The containing operation descriptor supplies the operation and handler identities.
 */
export interface FieldEditInputSchemaV1 {
  readonly schemaVersion: 1
  readonly forms: readonly FieldEditFormSpecV1[]
}

/** Executable contribution selecting a renderer for one custom field type. */
export interface FieldEditorContributionSpecV1Wire {
  readonly fieldTypeId: string
  readonly editorId: string
  readonly priority: number
  readonly hosts?: readonly string[]
}

/** Data-only declaration. Icon paths are confined to the declaring extension's VFS. */
export interface SubjectKindDefinitionSpecV1 {
  readonly kindId: string
  readonly label: string
  readonly icon?: ExtensionAssetReference
  readonly parentKinds?: readonly string[]
  readonly card?: {
    readonly sections: readonly string[]
    readonly preview?: 'raster' | 'model' | 'none'
  }
  readonly selector?: {
    readonly facets: readonly string[]
    readonly predicates: readonly {
      readonly id: string
      readonly label: string
      readonly params?: JsonSchemaRef
    }[]
  }
  readonly diff?: { readonly profile: 'generic' | 'provider' }
  readonly knowledgeEcosystem?: string
}
