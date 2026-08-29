# Common containers

Product-owned multi-file container codecs. The PlayStation CUE/BIN contribution treats the CUE as
the candidate and asks the host for its exact BIN companion, then exposes bounded tracks,
namespaces and byte ranges without resolving filesystem paths inside portable code.

The supported subset is intentionally explicit in the contribution manifest. Historical
conversion decisions remain in inert `MIGRATION-NOTES-common-containers.json`.
