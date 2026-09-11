import type { FieldEditFormField, JsonObject, JsonSchemaRef } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'

/** Shared UVM document form. Native codecs supply only their boundary options and version. */
export function createUvmJsonEditInputSchema(options: {
  readonly reference: string
  readonly baseInput?: JsonObject
  readonly fields?: readonly FieldEditFormField[]
}): JsonSchemaRef {
  return Object.freeze({
    $ref: options.reference,
    document: snapshotJson(
      {
        schemaVersion: 1,
        forms: [
          {
            id: 'uvm-json-edit',
            label: 'Apply model document changes',
            summary:
              'Apply JSON changes to the model working document, save the supported changes, and reopen the result. Undo is available through the host history.',
            ...(options.baseInput === undefined ? {} : { baseInput: options.baseInput }),
            fields: [
              ...(options.fields ?? []),
              {
                key: 'json',
                label: 'Model changes (JSON)',
                type: { kind: 'json' },
                inputPath: ['json'],
                required: true,
                initial: [],
                description:
                  'Enter an array of add, remove, or replace edits. Each edit names a JSON Pointer path in the exported UVM document; add and replace also provide a value. Keep linked copies of the same value consistent. Unsupported changes are refused before saving.',
              },
            ],
          },
        ],
      },
      { maxDepth: 32, maxNodes: 2048, maxBytes: 65536 },
    ),
  })
}
