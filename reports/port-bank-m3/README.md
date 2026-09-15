# SC2 bank parity, M3 re-run (2026-09-16)

Pilot for rebuilding MK2 parity evidence after the gitignored `artifacts/legacy-parity-sc2` receipts
were lost. The kit is the M2 oracle kit (`reports/port-bank-m2/oracle`) re-rooted here and pointed at
the current module layout (`starcraft2/modules/banks`), with feature cases and proofs added.

Run from `modkit-core`, after building the Blizzard extension:

```sh
node reports/port-bank-m3/oracle/build-sc2-bank-corpus.mjs
node reports/port-bank-m3/oracle/compare-legacy-sc2-bank.mjs \
  --legacy reports/port-bank-m3/oracle/sc2-bank-legacy-adapter.mjs \
  --migrated reports/port-bank-m3/oracle/sc2-bank-native-adapter.mjs \
  --corpus reports/port-bank-m3/oracle/corpus/<operation>.json \
  --operation <operation> \
  --receipt reports/port-bank-m3/oracle/receipts/<operation>.json
node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/port-bank-m3/oracle/receipts/<operation>.json --check
```

Results on Core `886bf29b` / Blizzard `a7c12e1a` (pinned MK2 `1a14ba4e`, 38 real player banks + pinned
fixture + synthetic cases, all `mixed` with verified oracle modules):

| Operation | identical | different | both refused |
|---|---|---|---|
| view.inspect | 40 | 0 | 0 |
| asset.validate | 43 | 0 | 0 |
| edit.content | 41 | 0 | 2 |
| source.save-as | 43 | 0 | 0 |
| export.raw | 40 | 0 | 0 |
| save.sign | 39 | 0 | 1 |
| blizzard/sc2-bank.verify | 40 | 0 | 0 |

Receipts prove the six manifest operations and 10 of 21 features: `aeff20fd` view.inspect handler,
`e40365a9` export.raw, `eb369e7a` save.sign, `e808d267` verify, `43798a3c` raw-preserving patch
(type change, single quotes), `76a2e574` serializeBank options, `c82ea2ce` custom nodes, `2c361e68`
parse/read, `dffea872` structural and signature validation. Every proof names only successful cases
whose whole compared output covers the feature.

`evidence:apply --check` accepts every proof in these receipts; applying is blocked by ledger-wide
problems from lost receipts of other codecs (`check-feature-ledger`: 130 problems).

Open features need library-level adapter operations: SC2BankEditor, sortBank, value coercion,
sha1Hex, Node IO, discovery, path signature inference, BankList, CLI, detect, AssetDescriptor, and
the browser-safe core entrypoint.
