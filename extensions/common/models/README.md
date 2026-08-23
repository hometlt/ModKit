# `common/models`

Model-family reference extension. OBJ reuses the proven MK2 rules for vertices, groups, materials
and polygon triangulation. glTF validates the 2.x JSON document and indexes scenes, nodes, meshes,
materials, textures and animations. UVM validates the Universal Verse core profile, decodes its
GLB accessors and publishes format-neutral scene primitives.

Every format remains a separate contribution entrypoint. Loading UVM imports only `codec-kit` and
its own bounded GLB reader; it does not load OBJ, glTF, or either format's parser. All three project
only current MK3 contracts, including `model-scene-source@1`, hierarchy and bounded bytes.

The convergence smoke opens the exact pinned UVM artifact produced from the synthetic StarCraft II
M3 corpus fixture. Its partial provenance is visible through the A-3 inspection operation, so the
A-2/A-3 route proves both renderable geometry and honest skeleton/animation/texture loss reporting.

The former `common-models` staging family is now merged here. DAE, PLY and STL keep their bounded
decoded-geometry implementations; its older GLB/glTF, OBJ and UVM routes were removed because the
native MK3 contributions in this package are richer and cover those formats without ambiguous
duplicate candidates. The inert `MIGRATION-NOTES-common-models.json` records that convergence.
