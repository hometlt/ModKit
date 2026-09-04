/**
 * What a game implements so its data becomes browsable cards.
 *
 * Deliberately small. Everything a table can express — section order, labels, formatting — belongs
 * in the descriptor the game emits, not in a method here; these exist only for what a table
 * cannot: assembling a card by walking the game's own structures.
 */

import type { Card, CardIndexEntry, CardIndexKind, SubjectRef } from './model.js'

export interface CardProvider {
  /** Which subject kinds this provider can describe. */
  kinds(): readonly string[]
  /** Assemble the card, or `undefined` when the subject does not exist in the loaded data. */
  card(subject: SubjectRef): Promise<Card | undefined> | Card | undefined
}

export interface CardIndexProvider {
  /** Partitions to show in a browser sidebar, with counts. */
  kinds(): readonly CardIndexKind[]
  /** Entries of one partition. `query` is a plain substring filter when the host offers search. */
  entries(kind: string, query?: string): readonly CardIndexEntry[]
}
