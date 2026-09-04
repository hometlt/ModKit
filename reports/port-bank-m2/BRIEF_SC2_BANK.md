# Port brief: sc2-bank

Pinned MK2 source: 1a14ba4eddd0ae88de273348ebd44cfb98a0581d.
Historical source audit: references/modkitmk2/extensions/blizzard/starcraft-2/codecs/sc2-bank/. Recheck current MK3 surfaces before editing.

## Preconditions

M1 accepted by the owner on 2026-09-04: «продолжай м2». Baseline Core `7ff0a9e2`,
Blizzard `3b3e64b1`. This brief authorizes M2 only; M3 awaits acceptance of M2.

- Owner has accepted the previous milestone; M1 does not start bank implementation.
- Resolve canonical source/test/data closure with copy-mk2; preserve all existing richer MK3 behavior.
- Bind each operation to an executable handler and a versioned receipt; no empty corpus or implementation stubs.

## Required obligations

- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/05d154295c0f920d: SC2BankEditor — high-level get/getAny/getString/getInt/getFixed/getFlag, set/setInt/setFixed/setString/setText/setFlag/setPoint, removeKey/removeSection, sort, sign, verify, serialize
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/0b8a8111a4bee7a5: sortBank — deterministic ASCII byte-order sort of sections/keys/nodes (for signature-stable comparisons)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/1366f797e4c93c82: typed value coercion/creation: coerceBankValue / makeBankValue for int, fixed, flag, point, string/text
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/195a72de94bde280: inspect — AssetDescriptor: identity, traits (structure.hierarchy, content.metadata), metadata groups (identity, signature), per-document operation gating
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/2accf19c17872afe: browser-safe /core entrypoint vs Node-only /node entrypoint (statically guarded against node:* imports)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/2c361e68d5fbe17f: open/read — parseBank via fast-xml-parser into typed SC2Bank (sections/keys/values/nodes), signature attr read
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/43798a3c1fb2eb43: edit.content / patchValue — raw-preserving single-key XML patch (same-type: attr value only, preserves quote style/order; type change: whole <Value> tag replaced)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/5d197c13ed496941: sha1Hex — self-contained SHA-1 implementation (no crypto/node dep, browser-portable)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/652c8ab5f4e58d1b: Node filesystem IO helpers: loadBankFile/saveBankFile (options: validate, signatureInfo, sign, createDirs)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/74260e4c491b45c3: recursive bank file discovery on a filesystem root (Node-only, maxDepth option)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/76a2e574f1e33647: source.save-as / serializeBank — full reformat serialize (canonical indent, optional sort, optional recompute signature)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/8c991e2fe9eddf98: signature inference from player Banks path (.../Banks/<authorId>/<bankName>.SC2Bank under .../<playerId>/Banks/) with PLAYER_OR_AUTHOR_ID_RE 999-S2-9-999 pattern; explicit override supported
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/9613a2f48123d984: BankList.xml parse/serialize + getBankListNames + matchBankListToDiscovered (case-insensitive name match against discovered local banks)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/a64d56c9c7aa0849: CLI (modkitx-bank): read/validate/verify/sign/set/list-banklist/discover, --json, --out, --sign/--no-sign, --require-signature, path-inferred or explicit signature options
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/aeff20fd6b1162e6: view.inspect operation handler returning descriptor.metadata
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/c82ea2cedc50fcbb: custom non-Value child nodes support (some maps use typed sub-elements instead of a single <Value>)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/d985ed421c3e42b1: detect — bounded structural <Bank> root sniff in 4096B header + .sc2bank extension + game-context evidence, confidence composition
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/dffea872f8e08161: asset.validate — structural validation: duplicate section/key, empty names, typed-value checks (int/fixed/flag/point regexes), unknown value type, mixed value+nodes, signature presence/verify
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/e40365a9cf02c976: export.raw — original XML bytes verbatim
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/e808d267b7804aa6: verify — verifyBankSignature (not a manifest operation, exposed on codec class only)
- [ ] legacy/codec-manifest/modkit/sc2-bank/feature/eb369e7ac8d1b000: save.sign — calculateBankSignature (custom payload+SHA1) then patchBankSignatureXml (patch existing or insert before </Bank>); throws ModkitError CONFIG_INVALID if no signatureInfo
- [ ] legacy/codec-manifest/modkit/sc2-bank/operation/asset.validate: asset.validate
- [ ] legacy/codec-manifest/modkit/sc2-bank/operation/edit.content: edit.content
- [ ] legacy/codec-manifest/modkit/sc2-bank/operation/export.raw: export.raw
- [ ] legacy/codec-manifest/modkit/sc2-bank/operation/save.sign: save.sign
- [ ] legacy/codec-manifest/modkit/sc2-bank/operation/source.save-as: source.save-as
- [ ] legacy/codec-manifest/modkit/sc2-bank/operation/view.inspect: view.inspect

## Verification and evidence

Run the exact declared MK2 suite and full pinned differential corpus. Record commands, cwd, counts, hashes and refusal taxonomy.
Use scaffold-parity-harness with explicit oracle and migrated adapters; fill public-surface assertions before claiming acceptance.
Each proof names its requirement, kind, adapterOperation and nonempty successful caseIds; operation proofs also name the executed native handler and its published contribution.
Apply a passing receipt through evidence:apply; rerun feature-ledger integrity and the explicit codec closure.
Keep family closure pending until every family obligation and acceptance surface passes.
