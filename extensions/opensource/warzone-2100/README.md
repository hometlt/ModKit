# Warzone 2100

Final MK3 owner for Warzone 2100 formats. This slice implements the PIE model reader only. Maps,
WZ containers and the other Warzone staging routes remain outside this package until their own
migration slices.

The reader publishes decoded geometry, logical texture references and `ANIMOBJECT` tracks. It does
not infer animation from polygon texture animation flags or directive counts. PIE writing and 3DO
models are named remainders.
