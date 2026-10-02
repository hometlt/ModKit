# ADR-WORLD-005 — RA2 / Tiberian Sun map frame

Status: frame contract defined, 02.10.2026; native qualification required.
Registry IDs: `ea/red-alert-2`, `ea/tiberian-sun`.

Map X and Y are the two horizontal cell axes; z is elevation. This left-handed
map frame converts by `(x,y,z) → (x,z,y)` to right-handed UVW; inverse identical.
Coordinates stay in leptons, 256 per cell; no physical scale is invented. The
native sparse diamond is occupancy, not a reason to rotate the world basis.
Rectangular heightfield origin is the transformed native grid minimum; missing
diamond cells use `noDataValue`. Native cell identities and sparse occupancy
remain source data. Bounds use the transformed occupied corners.

The game's isometric appearance is a camera: orthographic, azimuth 45 degrees,
elevation 30 degrees under the canonical camera convention. It is not baked
into terrain positions. The game/editor screen projection (FinalAlert
`ProjectCoords3d`) can qualify horizontal orientation and camera proportions;
the adapter must also qualify elevation decoding and cell placement from the
native corpus. GPL/AGPL references are specification/oracle only, never source
copied into MIT implementations. Separate RA2 and TS receipts are required.

Native screen cell sizes (60×30 RA2, 48×24 TS) establish projection aspect, not
metres per lepton. Scroll limits (`LocalSize`) are playable/view bounds; they
do not replace the stored map grid or erase cells outside the playable region.
