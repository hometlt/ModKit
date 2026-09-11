# Port infrastructure

M1 establishes tools and contracts. It does not accept a codec or start M2.
The frozen legacy inventory contains 206 codec manifests. The 12 SC2 source audits
are in `sc2-audit.json`; the new campaign requirements are separate in `authored.json`.
SC2 family closure also includes MPQ and CASC, whose detailed source audits remain pending.

Run from `modkit-core` after installing the workspace dependencies:

```sh
pnpm m1:check
pnpm port:brief --codec sc2-bank --out /absolute/path/BRIEF_SC2_BANK.md
pnpm port:harness --codec sc2-bank --out /absolute/path/sc2-bank-parity.mjs
```

The brief and harness require explicit adapters and nonempty inputs. For real
corpora the harness requires pinned oracle evidence bound to the executed corpus.
Its `prepareOracle({ operation, corpus })` adapter must call `loadMk2` with that
operation, `corpusManifest: corpus`, and its own filename in `loaderFiles`.
The runner verifies the actual cache bundle, pinned source snapshots, loader,
adapter and dependency bytes before execution. Adapter semantics still require
review; artifact identity alone does not prove that a projection is correct.
An empty corpus, two implementations that both refuse every input, or an invalid
comparison is a failure. Synthetic receipts establish only their declared scope.

The generated runner also accepts one `--config /absolute/path/parity.json` argument:

```json
{
  "schemaVersion": 1,
  "legacy": "legacy.mjs",
  "migrated": "native.mjs",
  "corpus": "corpus.json",
  "operation": "material.project",
  "receipt": "receipt.json",
  "outputs": "outputs.json"
}
```

Paths resolve against that file's directory. `outputs` is optional; when supplied, it retains the
full normalized results of both adapters and the receipt binds its bytes by SHA-256. Config and
inline flags cannot be mixed, and an output cannot overwrite a declared input or another output.
Adapters, corpus and configuration are hashed before execution and checked again afterwards.
The shared runner's implementation is recorded and checked as well.

A native adapter may implement `prepareMigrated({ operation, corpus, corpusPath })`, returning
`{ module, evidence, verify?, release? }`. `module[operation]` performs the actual product route;
`verify` runs after comparison and `release` runs in `finally`. The shared `port-runtime-proof.mjs`
captures explicit implementation roots and resolves dependency trees from the adapter's actual
installed packages, rather than treating a sibling source checkout as the executed runtime.
Its digest detects changed, added and removed files; missing optional dependencies are recorded.
These snapshots supplement semantic comparison and do not turn an unexercised operation into proof.

`migration:check` checks inventory, operation mappings, and evidence integrity.
Pending requirements are visible and permitted during implementation. Explicit
acceptance uses `check-feature-ledger.mjs --closure <codec|family|all>` and fails
while any requirement in that scope is pending. `pnpm port:closure` requests SC2
closure; it is expected to fail before family completion.

`surfaces:check` currently accepts only `--scope m1-fixtures`. It exercises SDK
fields, host operations and permissions, lazy data, and writer commit/reopen
including byte-preserving no-op. It does not claim complete family surfaces.

`mk2-copy:check` explicitly selects `m1-libs`. A full-family copy claim must use
the complete declaration and cannot silently reuse this bootstrap scope.
`algorithms:check` freezes existing duplicate implementations and refuses new or
changed peers. `--ratchet` only removes retired debt; it cannot admit new debt.

Receipts applied through `evidence:apply` must identify the requirements proved.
Operation receipts must also name the executed handler and its published
contribution in a configured repository. Every proof names the exact adapter
operation and successful case IDs; receipts for another codec or unrelated cases
cannot close a requirement. Existing accepted proofs remain immutable; owner-dropped rows
require a dated, hashed owner decision. Feature closure, operation closure,
real-corpus parity and later family surface acceptance are separate obligations.
