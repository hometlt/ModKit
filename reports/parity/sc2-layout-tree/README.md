# SC2 Layout tree parity

This proof closes only the MK2 `descTreeData` requirement
`legacy/codec-manifest/modkit/sc2-layout/feature/b1388f61ccf518e2`.
It compares the pinned MK2 DescIndex and SchemaRegistry with the public MK3 Host
worker's common TreeDataSource, using three synthetic documents.

The comparison includes Frame, Animation and StateGroup nesting, UTF-16 source
ranges, frame types, hookups, description fields, class properties and their
documentation. Schema properties remain metadata; this proof does not claim
native field editing, language capability coverage or visual acceptance.

The oracle runs unmodified pinned algorithms. Its generated Markdown keys are
normalized with `node:path` to match MK2's OS-dependent `path.join` lookup.
The receipt records this adaptation and pins source and runtime dependency hashes.

Run from the Core repository with the oracle dependencies available through
`NODE_PATH`:

```powershell
node reports/parity/sc2-layout-tree/run.mjs --config reports/parity/sc2-layout-tree/config.json
node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/parity/sc2-layout-tree/evidence-apply-receipt.json --check
node scripts/migration/check-feature-ledger.mjs
```

The config identifies the retained output file. A new run changes the receipt's
digest; refresh the authored ledger reference before committing the new proof.
Do not overwrite an already accepted receipt without retaining its evidence.
