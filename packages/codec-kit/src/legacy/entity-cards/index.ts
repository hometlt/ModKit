/**
 * Game-neutral entity cards.
 *
 * This package holds the shape of a card and the arithmetic over a relation graph. It holds no
 * game vocabulary, reads no schema, and parses nothing: a game contributes a `CardProvider` and a
 * `RelationEdgeProvider`, and everything here works the same for a StarCraft II unit, a Tiberium
 * Wars structure, or a UI layout.
 */

export type {
  Card,
  CardField,
  CardGridCell,
  CardGridPage,
  CardIndexEntry,
  CardIndexKind,
  CardLink,
  CardRelationGroup,
  CardResourceAmount,
  CardSection,
  CardSectionKind,
  CardStat,
  DeclarationSite,
  SubjectRef,
} from './model.js'

export { buildRelationGraphView, relationGroupsOf } from './graph.js'
export type {
  RelationDirection,
  RelationEdge,
  RelationEdgeProvider,
  RelationGraphGroups,
  RelationGraphNode,
  RelationGraphOptions,
  RelationGraphView,
} from './graph.js'

export {
  SubjectNavigationHistory,
  subjectKey,
  parseSubjectAddress,
  subjectAddress,
} from './address.js'
export type { CardProvider, CardIndexProvider } from './providers.js'
