# ADR-WORLD-008 — game-facing Warzone orientation

Status: replacement frame contract defined, 02.10.2026; coordinated native
migration and new qualification required. Supersedes the orientation claim
of ADR-WORLD-002; its old corpus and tuple hashes remain historical.

The official Warzone renderer uses `(x,height,-y)` together with a mirrored
projection (`glm::scale(1,1,-1)` in `lib/ivis_opengl/piematrix.cpp`). A renderer
tuple alone omits that projection. `TASK_CORE_WORLD_RENDER_2026-09-30.md` U1
documents why the historical UVW mapping reflected the game-facing map.

New ID `warzone-map-native-game-view` is deliberately distinct. Native x east,
y south, z up maps to UVW `(x,z,y)`, inverse identical, forward source rows,
origin `[0,0,0]`, 128 source units per cell. Physical metres remain unknown.
Models PIE need the matching Z reflection and winding conversion; native
object rotation and inverse export need their own paired differential. Do not
change map terrain alone while leaving PIE, rotations or reverse writing old.

GAME-WARZONE performs one coordinated change to provider/converter, PIE↔UVM,
fixtures and receipts. Compare 2c-highground's top view with the game/minimap:
first row north, first column west. New tuple digests must be measured, never
obtained by relabelling the old hashes. Existing old-frame artifacts retain
their ID and historical evidence; no frozen Runtime vector is re-vectored here.
