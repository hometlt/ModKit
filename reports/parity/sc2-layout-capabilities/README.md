# SC2 Layout capability and workspace verification parity

This differential proof targets only the MK2 Layout language capabilities row
`legacy/codec-manifest/modkit/sc2-layout/feature/f3b803a24538e2ef`.

The pinned oracle executes `LAYOUT_CAPABILITIES` and the unmodified
`DiagnosticsProvider.analyzeWorkspace` on synthetic documents, with its canonical
Store, schema and archive membership. No installed content or archive I/O is used.

The migrated arm starts the published MK3 LSP and checks the selected Layout
provider's actual capabilities. Layout-specific trigger characters come from its
published contribution rather than the server's union of all language triggers.
The former `sc2layout.analyzeWorkspace` action maps to the existing common Verify
Mod/projectDiagnostics route. Open-document pull diagnostics and closed-document
project diagnostics together must cover every document. Diagnostics retain every
message, severity and UTF-16 range; only URI presentation, codes and source labels
are normalized. A closed file contains an invalid schema value.

This is executable capability and workspace validation evidence. It does not
replace the separate proofs for completion, hover, references, symbols and colors,
or manual visual acceptance.

Run from Core, with the oracle's external dependencies on `NODE_PATH`:

```powershell
node reports/parity/sc2-layout-capabilities/run.mjs --config reports/parity/sc2-layout-capabilities/config.json
```

The output file is retained under `C:/MKTEMP`; only apply the resulting receipt
after every differential case passes. Never replace previously accepted evidence.
