# MK3 Architecture Decision Records

One decision per file. A record is immutable once `Accepted` — supersede it with a new ADR rather
than editing the decision text. Amend only Status and the Superseded-by link.

Naming: `ADR-<AREA>-<NNN>-<kebab-slug>.md`. Areas: `UI`, `EXT`, `VFS`, `HOST`, `WORLD`.
Since 2026-08-18 the records live in `modkitX3/docs/MK3/adr`; evidence paths are relative to the `modkitX3` repository.

Required sections: Status · Context · Decision · Consequences · Alternatives considered · Evidence.

Every factual claim in Evidence cites a path with a line number, or a reproducible command.
A decision that cannot be evidenced is a proposal, not an ADR.

| ID                                                                 | Title                                                                      | Status   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------- |
| [ADR-UI-001](ADR-UI-001-csp-dynamic-style-values.md)               | CSP contract for dynamic style values                                      | Accepted |
| [ADR-UI-002](ADR-UI-002-design-token-registry-ownership.md)        | Design token registry ownership                                            | Accepted |
| [ADR-HOST-001](ADR-HOST-001-capability-rpc-and-method-surfaces.md) | One execution boundary: capability-RPC over contract-owned method surfaces | Accepted |
