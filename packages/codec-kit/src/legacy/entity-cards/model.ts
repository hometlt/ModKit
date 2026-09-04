/**
 * The card model, with no game in it.
 *
 * What used to be `@modkitx/wiki`'s card types carried StarCraft II in their shape: costs were
 * `{ minerals, vespene }`, the context was an `SC2Mod`, and the ability grid was a 3x5 command
 * card. None of that is wrong for StarCraft II and all of it is wrong for anything else, so the
 * vocabulary moves to the game and only the structure stays here.
 *
 * A game contributes a descriptor (which sections, in what order, with what labels) plus resolver
 * hooks for what a table cannot express — finding an icon by walking an actor graph, assembling an
 * ability grid from a layout. See
 * `docs/tasks-active/entity-cards-strings/PLAN_wiki_subject_model.md` (W6).
 */

import type { JsonValue } from '../assets/index.js'

/**
 * Address of anything a card can be about, and anything a card can link to.
 *
 * `kind` is the game's own partition of its data — a catalog namespace in StarCraft II, whatever
 * the equivalent is elsewhere. This package never interprets it.
 */
export interface SubjectRef {
  readonly kind: string
  readonly id: string
}

/** A link to another subject, with the label to show for it. */
export interface CardLink extends SubjectRef {
  readonly label: string
  /** Where the target is declared, when the game can say. */
  readonly declaredAt?: DeclarationSite
}

/** Where a value or entity is declared, for provenance and "go to source". */
export interface DeclarationSite {
  /** The owning layer — a mod in a dependency chain, a package, an archive. */
  readonly container: string
  readonly file: string
  readonly line?: number
}

/** One labelled value in a `fields` section. */
export interface CardField {
  readonly id: string
  readonly label: string
  readonly value: JsonValue
  /** Present when the value points at another subject. */
  readonly ref?: CardLink
  /** Subject kind this field's value must belong to, when the game's schema types it as a link. */
  readonly linkKind?: string
  readonly declaredAt?: DeclarationSite
}

/**
 * A quantity of a named resource.
 *
 * StarCraft II's minerals and vespene, Command & Conquer's credits and power, and anything else
 * are the same shape; the resource ids and their order come from the game.
 */
export interface CardResourceAmount {
  readonly resource: string
  readonly label: string
  readonly amount: number
}

/** A named statistic with optional derived parts, e.g. a health pool with armor and regeneration. */
export interface CardStat {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly parts?: readonly {
    readonly id: string
    readonly label: string
    readonly value: number
  }[]
}

/** One cell of an ability grid. Position is the game's; this package only lays it out. */
export interface CardGridCell {
  readonly id: string
  readonly row: number
  readonly column: number
  readonly label: string
  readonly iconAsset?: string
  readonly tooltipHtml?: string
  /** What activating the cell produces or opens, when it leads somewhere. */
  readonly target?: CardLink
}

/** A page of an ability grid; a game with no such concept simply contributes no `grid` section. */
export interface CardGridPage {
  readonly id: string
  readonly label?: string
  readonly rows: number
  readonly columns: number
  readonly cells: readonly CardGridCell[]
}

/** Links of one kind, in one direction, with the total before any display cap. */
export interface CardRelationGroup {
  readonly kind: string
  readonly total: number
  readonly links: readonly CardLink[]
}

export type CardSectionKind =
  'fields' | 'stats' | 'cost' | 'grid' | 'relations' | 'preview' | 'children' | 'source'

interface CardSectionBase {
  readonly id: string
  readonly label: string
  /** Ascending; ties fall back to declaration order. */
  readonly order?: number
}

export type CardSection =
  | (CardSectionBase & { readonly kind: 'fields'; readonly fields: readonly CardField[] })
  | (CardSectionBase & { readonly kind: 'stats'; readonly stats: readonly CardStat[] })
  | (CardSectionBase & { readonly kind: 'cost'; readonly amounts: readonly CardResourceAmount[] })
  | (CardSectionBase & { readonly kind: 'grid'; readonly pages: readonly CardGridPage[] })
  | (CardSectionBase & {
      readonly kind: 'relations'
      readonly outgoing: readonly CardRelationGroup[]
      readonly incoming: readonly CardRelationGroup[]
    })
  | (CardSectionBase & {
      readonly kind: 'preview'
      /** Asset the stage should show — a model, an image, a sound. */
      readonly asset: string
      readonly assetKind?: string
    })
  | (CardSectionBase & { readonly kind: 'children'; readonly children: readonly CardLink[] })
  | (CardSectionBase & { readonly kind: 'source'; readonly sites: readonly DeclarationSite[] })

/** One assembled card: what it is about, and the sections to show. */
export interface Card {
  readonly subject: SubjectRef
  readonly title: string
  readonly subtitle?: string
  readonly descriptionHtml?: string
  readonly iconAsset?: string
  readonly sections: readonly CardSection[]
}

/** One entry in a browsable index of subjects. */
export interface CardIndexEntry extends SubjectRef {
  readonly title: string
  readonly iconAsset?: string
}

/** One partition of the index, with how many subjects it holds. */
export interface CardIndexKind {
  readonly kind: string
  readonly label: string
  readonly count: number
}
