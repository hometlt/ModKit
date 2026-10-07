/**
 * Validation of the semantic context a language provider declares it reads: game knowledge files
 * of the subject's context, or the server of the loaded mod (owner decision 07.10). The host acts
 * only on validated, frozen copies; a declaration of any other kind refuses the provider.
 */
import type { LanguageSemanticContextRequirement } from '@modkit/sdk/language'

const MAX_SEMANTIC_CONTEXT_REQUIREMENTS = 8

const boundedText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 8_192 && !value.includes('\0')

/** Validate and copy provider declarations before the host acts on them. */
export function validatedLanguageSemanticContextRequirements(
  value: unknown,
): readonly LanguageSemanticContextRequirement[] {
  if (!Array.isArray(value) || value.length > MAX_SEMANTIC_CONTEXT_REQUIREMENTS) {
    throw new TypeError('language semantic context requirements are invalid')
  }
  const requirements: LanguageSemanticContextRequirement[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const keys = typeof item === 'object' && item !== null ? Reflect.ownKeys(item) : []
    const declared = typeof item === 'object' && item !== null ? (item as { kind?: unknown }).kind : undefined
    const knowledge = declared === 'language-knowledge'
    const modContext = declared === 'mod-context'
    const allowed = knowledge ? ['kind', 'fileNames'] : ['kind', 'gameId']
    if (
      typeof item !== 'object' ||
      item === null ||
      Array.isArray(item) ||
      (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) ||
      keys.some(key => typeof key !== 'string' || !allowed.includes(key))
    ) {
      throw new TypeError('language semantic context requirement is invalid')
    }
    if (knowledge) {
      const fileNames = Object.getOwnPropertyDescriptor(item, 'fileNames')?.value
      // Plain file names at a layer root: no separators, one requirement per provider.
      if (
        seen.has('\0language-knowledge') ||
        !Array.isArray(fileNames) ||
        fileNames.length === 0 ||
        fileNames.length > 8 ||
        !fileNames.every(
          name =>
            boundedText(name) &&
            name.length <= 255 &&
            !/[\\/:*?"<>|]/u.test(name) &&
            name !== '.' &&
            name !== '..',
        ) ||
        new Set(fileNames.map(name => (name as string).toLowerCase())).size !== fileNames.length
      ) {
        throw new TypeError('language semantic context requirement is invalid')
      }
      seen.add('\0language-knowledge')
      requirements.push(
        Object.freeze({ kind: 'language-knowledge', fileNames: Object.freeze([...fileNames]) }),
      )
      continue
    }
    if (modContext) {
      // One server per game a provider reads; the game's own questions go through the port.
      const gameId = Object.getOwnPropertyDescriptor(item, 'gameId')?.value
      if (!boundedText(gameId) || seen.has(`\0mod-context\0${gameId}`)) {
        throw new TypeError('language semantic context requirement is invalid')
      }
      seen.add(`\0mod-context\0${gameId}`)
      requirements.push(Object.freeze({ kind: 'mod-context', gameId }))
      continue
    }
    throw new TypeError('language semantic context requirement is invalid')
  }
  return Object.freeze(requirements)
}
