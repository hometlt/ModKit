/**
 * Unknown source-root subject + interpretations (owner: MK3/25 §20 + MK3/30 §5,
 * candidate PR-16). The invariant this file exists to prove: a source without a
 * compatible codec is a full persistent subject; installing a codec ADDS an
 * interpretation to the same root, removing one degrades it — identity and existing
 * refs never change, and reclassification is a selection change, not an identity change.
 */

import { ModkitError } from '@modkit/core'
import type { SubjectRef } from './refs.js'

export interface InterpretationRef {
  /** Qualified contribution/provider coordinate that supplied the interpretation. */
  readonly id: string
  readonly displayName?: string
}

export interface RootSubjectState {
  readonly ref: SubjectRef
  /** Sorted by id for determinism; empty = opaque `content.binary`-only subject. */
  readonly interpretations: readonly InterpretationRef[]
  /** Selected interpretation id; undefined = unknown/opaque presentation. */
  readonly selected?: string
}

export function createRootSubjectState(ref: SubjectRef): RootSubjectState {
  return { ref, interpretations: [] }
}

function sortById(list: readonly InterpretationRef[]): InterpretationRef[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function addInterpretation(
  state: RootSubjectState,
  interpretation: InterpretationRef,
): RootSubjectState {
  if (state.interpretations.some(i => i.id === interpretation.id)) return state
  return {
    ...state, // ref (identity) is carried over untouched — the PR-16 invariant
    interpretations: sortById([...state.interpretations, interpretation]),
  }
}

export function removeInterpretation(state: RootSubjectState, id: string): RootSubjectState {
  const interpretations = state.interpretations.filter(i => i.id !== id)
  const { selected, ...rest } = state
  return {
    ...rest,
    interpretations,
    // Removing the selected interpretation degrades back to unknown, never re-guesses.
    ...(selected !== undefined && selected !== id ? { selected } : {}),
  }
}

/** Reclassification = selection change, never identity change (MK3/25 §20.3). */
export function selectInterpretation(state: RootSubjectState, id: string): RootSubjectState {
  if (!state.interpretations.some(i => i.id === id)) {
    throw new ModkitError({
      code: 'x3.sdk/unknown-interpretation',
      message: `interpretation «${id}» is not attached to this subject`,
      context: { id },
    })
  }
  return { ...state, selected: id }
}
