const NONE: readonly string[] = Object.freeze([])

/** Present fields a target does not retain. A target owns its field/value policy; this
 * common enumerator never treats zero, false or an empty collection as absence.
 * Input has already been admitted by its source owner; no values are cloned or normalized.
 */
export function unretainedWorldFields(
  record: object,
  retained: (key: string, value: unknown) => boolean,
): readonly string[] {
  let fields: string[] | undefined
  for (const [key, value] of Object.entries(record))
    if (value !== undefined && !retained(key, value)) (fields ??= []).push(key)
  return fields === undefined ? NONE : Object.freeze(fields)
}
