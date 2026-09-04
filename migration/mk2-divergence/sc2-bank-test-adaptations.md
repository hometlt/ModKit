# SC2 bank: test relocation contracts (M2)

Owner accepted M1 and requested M2 on 2026-09-04. The MK2 oracle remains
`1a14ba4eddd0ae88de273348ebd44cfb98a0581d`.

These adaptations affect tests only. No parser, serializer, patcher, signature,
validation or other bank algorithm is changed. Exact before/after edits and hashes
are registered in `sc2.json`; the canonical-copy gate reconstructs every edit.

1. `core.spec.ts`: the browser import guard reads the same eight canonical source
   files from their relocated paths. SHA1 is read from codec-kit, its sole canonical
   destination. Both Node import assertions remain in force for every file.
2. `sc2-bank-manifest.test.ts`: the manifest path points to the copied legacy
   manifest alongside relocated production sources. Every original manifest
   assertion remains intact. Native MK3 manifest/activation tests are additional.
3. `codec.test.ts`: the three legacy registry tests execute the corresponding
   real MK3 host contracts: registered codec routing and operation inventory,
   rejection of an unknown source, and duplicate contribution rejection. The
   retired MK2 registry is not recreated. A test-only support module registers
   exactly three tests; the original detection, descriptor and operation cases
   remain intact. This is host integration evidence, not legacy resolver parity.

The public native adapter and real differential harness provide separate proof
of bank behavior. These relocated tests alone do not establish full M2 acceptance.
