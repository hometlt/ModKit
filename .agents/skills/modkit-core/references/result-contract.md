# Inspection result contract

Keep the answer compact, but preserve the distinctions Modkit publishes.

- Identify the opened subject and its pinned snapshot or revision.
- Label direct facts as observed or resolved values and retain their provenance.
- Label calculations with the formula id, version, inputs, units, and warnings.
- Label an invoked read-only operation with the exact descriptor operation id and snapshot, and
  retain its bounded progress, diagnostics, provenance, completeness, and explicit rejection state.
- Label knowledge as a short explanation and include its direct source link when present.
- State whether each page or overall result is complete, capped, partial, invalid, or unsupported.
- Distinguish a missing description from a missing field and both from an unsupported operation.
- Summarize large graphs by node and edge kinds before returning only the relevant paths.
- Never present an unresolved relation as a confirmed target.

Do not copy large external articles or raw asset bodies into the response. Provide a short summary and
the direct link or source coordinate needed to inspect the full evidence.
