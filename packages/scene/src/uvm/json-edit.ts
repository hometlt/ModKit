import { applyJsonEdit, type JsonEdit } from '@modkit/codec-kit/json-edit'

export type UvmJsonEdit = JsonEdit

/** UVM compatibility name; the immutable JSON Pointer engine is owned by codec-kit. */
export const applyUvmJsonEdit = applyJsonEdit
