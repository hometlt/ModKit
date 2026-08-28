# Warzone 2100 implementation references

The installation provider is an independent implementation from documented platform behavior and
read-only evidence gathered from the installed game. It does not copy legacy Modkit discovery code.

- Official game repository: `WZ2100Project/warzone2100`, pinned locally at
  `cbb1eb1515da60893595eef2868f4dcef8c37f1c`, GPL-2.0-or-later.
- Official map library: `lib/wzmaplib` in that pinned repository.
- Official model/stat binding loaders at that revision: `statsGetIMD`, `loadWeaponStats`,
  `loadBodyStats`, `loadPropulsionStats`, `loadSensorStats`, `loadECMStats` and
  `loadConstructStats` in `src/stats.cpp`, `loadStructureStats` in `src/structure.cpp`, and
  `loadFeatureStats` in `src/feature.cpp`.
- Historical map editor: `Warzone2100/WarzoneMapEditor`, pinned locally at
  `0ca80103623278996e1e8ece660c80507c090131`, GPL-2.0.
- Windows Store package identity observed during acceptance:
  `48148WZ2100Project.Warzone2100forWindows_4.7.0.0_x64__qsk72963svc8a`.
- The installed 4.7 `data/mp.wz` acceptance archive has SHA-256
  `d698475eaa7b3386c2465e5850e5609b0d524157280c7d659dc5f79cde6e5688`; its bounded last-wins
  namespace contains 619 physical and 619 effective entries, including 39 exact
  `multiplay/maps/<id>/game.map` candidates.
- Pinned `mp.wz/multiplay/maps/2c-highground` object-table SHA-256 values are
  `680dc6647d1602289035fd3d74e0b8ef2c42fae98a6139a05e51a8063ae90a62` for `droid.json`,
  `e2d95b97f69fdc6cd514b0e661fbb426d0f1ab59bd1ad75462cb28239ed3e090` for `struct.json`, and
  `94be6c97eb5ffbe5c570e298d2a43c5c5e2930c5fb4a197bd2ce9322fd89225e` for `feature.json`.

All game-specific discovery, archive, map, model, script and runtime adapters stay in this extension
so it can move to the future `WZ2100Project/Warzone2100` extension repository with its own license.
The neutral Modkit core owns only public contracts, host routing and conformance fixtures.
