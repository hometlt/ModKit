# SOL-05 knowledge completeness and AI receipt

Date: 2026-09-20

This slice adds a denominator-backed knowledge quality audit and replaces the legacy SC2 inspection
workflow with a public MK3 skill. It deliberately does not declare SOL-05 at 100%: the current SC2
repository has a Data field pack, while owner-derived censuses and researched knowledge packs for
Galaxy, Triggers, Layout, Strings, Style, Wizard, and Mod metadata are still absent.

## Reused owners

- Domain schema/grammar providers remain the only structural authorities. They supply
  `KnowledgeTarget[]` to the audit; the audit never derives or stores field/type rules.
- `@modkit/sdk/knowledge` remains the only neutral knowledge contract and exact target identity.
- The Host inventory-backed `KnowledgeCatalog` remains the only catalog. No registry or cache was added.
- `apps/mcp` remains the public discovery/read/language/edit/history route. The skill discovers
  provider-owned IDs and schemas instead of embedding them.
- Existing per-format providers remain responsible for facts, references, language semantics, previews,
  writers, and schema-valid edit inputs.

## Knowledge quality gate

`evaluateKnowledgeCoverage(authorityTargets, entries, options)` reports target-level metrics with the
owner census as denominator:

- structural: an exact target entry exists;
- descriptive: an exact entry has title and summary;
- researched semantics: a non-schema-only interpretation cites non-schema evidence;
- provenance, examples, and exact required locale coverage;
- missing and orphan targets, duplicate authority targets, duplicate target/locale entries, and fields
  pinned to a stale schema revision.

Zero authority targets produce `percent: null`, not 100%. Ordering uses UTF-8 byte order so CI receipts
are independent of process locale and input order. Locale requests are validated and bounded to 16.
Inputs are already validated owner targets and `KnowledgeEntry` values; malformed targets still fail at
the existing `knowledgeTargetKey` boundary.

Owner generators should call the function after walking their authoritative schema/grammar and before
writing a coverage receipt:

```ts
const report = evaluateKnowledgeCoverage(ownerTargets, knowledgePack.entries, {
  requiredLocales: ['en', 'ru'],
})
```

The generated report is evidence. It is not an input to parsing, validation, completion, or editing.

## Baseline observed in the SC2 extension repository

The current Data generator reports 5,066 field targets, 5,066 short descriptions, 352 researched
interpretations, and 4,714 schema-only descriptions. Its `missing: 0` therefore means structural pack
coverage, not semantic completeness. Researched Data semantics are approximately 6.95% of that current
top-level denominator. The current generator does not claim the backlog's full nested-member census.

No knowledge-pack contribution or owner-derived knowledge coverage receipt was found for Galaxy,
Triggers, Layout, Strings, Style, Wizard, or Mod metadata. Their denominator is unknown until each owner
exports a census; reporting zero missing or 100% for those modules would be incorrect.

## Public MK3 skill

The versioned source is `skills/inspect-sc2-resolved-data`; the same revision is installed in the local
Codex skill directory. It covers:

- capability/inventory/operation discovery and exact selected context;
- Data facts, schema-bound knowledge, relations, calculations, field edits, and shared-object isolation;
- Galaxy/Triggers language sessions and advertised conversion with validation/loss reporting;
- Layout/Wizard schema, language, preview, expansion, and owner edit plans;
- Strings/Style locale, markup, fallback, reference, inheritance, font/color, and render checks;
- Mod/package metadata and typed resources through subject facts and advertised package operations;
- cross-format chains using exact typed identities within one snapshot;
- bounded pagination and graph/language budgets, stale-plan recovery, output release, and close/dispose;
- preview → prepare → commit → reopen → history/undo/redo with revision guards.

Knowledge and source text are explicitly untrusted data. The skill does not import compatibility
packages, inspect archives/CASC, call private providers, invent operation IDs, or fall back to raw file
edits.

The evaluation corpus contains 15 cases spanning every requested module plus two-mod identity
isolation, prompt injection, stale plans, partial/capped results, missing capabilities, dependency write
prevention, graph semantics, and edit verification. Metrics include correctness, unsupported claims,
tool calls, returned bytes, pages, elapsed time, completeness/provenance reporting, and private-access
attempts.

## Verification

Run from `modkit-core`:

```powershell
pnpm exec vitest run packages/sdk/test/knowledge.test.ts --config vitest.owner.config.ts
pnpm exec tsc -p packages/sdk/tsconfig.json --noEmit
pnpm skills:check
$env:PYTHONUTF8='1'
py C:\Users\Admin\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\inspect-sc2-resolved-data
```

Observed results:

- SDK knowledge: 1 file, 6 tests passed;
- SDK TypeScript: passed;
- skill contract/evaluation corpus: 2 tests passed;
- the root `check` pipeline now includes `skills:check`, so public tool drift and eval coverage fail CI;
- source and installed skill validation: passed;
- Prettier check for all changed source, test, skill, reference, eval, and agent files: passed.

## Work still required for SOL-05 closure

Each domain owner must emit its full structural denominator, including nested members and grammar
symbols, then publish evidence-backed English/Russian entries and examples. Data still needs review of
4,714 schema-only summaries plus nested coverage. Installed MCP evaluations must run the 15-case corpus
against real loose and packed SC2 contexts and record call/byte/time budgets. Those results, plus
non-Data knowledge packs and client receipts, are required before marking KNOW-01..08 and AI-01..08
complete.
