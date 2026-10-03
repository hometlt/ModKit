import type { KnowledgePackSpecV1 } from '../src/knowledge/index.js'

export const inlineKnowledge = {
  schemaVersion: 1,
  sourceLocale: 'en',
  priority: 0,
  entries: [],
} satisfies KnowledgePackSpecV1
export const externalKnowledge = {
  schemaVersion: 1,
  sourceLocale: 'en',
  priority: 0,
  entriesPath: 'knowledge/entries.json',
} satisfies KnowledgePackSpecV1
// @ts-expect-error The published oneOf requires one source of entries.
export const missingKnowledge: KnowledgePackSpecV1 = {
  schemaVersion: 1,
  sourceLocale: 'en',
  priority: 0,
}
// @ts-expect-error Inline and external sources cannot be combined in one pack.
export const ambiguousKnowledge: KnowledgePackSpecV1 = {
  schemaVersion: 1,
  sourceLocale: 'en',
  priority: 0,
  entries: [],
  entriesPath: 'knowledge/entries.json',
}
