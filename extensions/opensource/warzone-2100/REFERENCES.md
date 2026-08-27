# Warzone 2100 implementation references

The installation provider is an independent implementation from documented platform behavior and
read-only evidence gathered from the installed game. It does not copy legacy Modkit discovery code.

- Official game repository: `WZ2100Project/warzone2100`, pinned locally at
  `cbb1eb1515da60893595eef2868f4dcef8c37f1c`, GPL-2.0-or-later.
- Official map library: `lib/wzmaplib` in that pinned repository.
- Historical map editor: `Warzone2100/WarzoneMapEditor`, pinned locally at
  `0ca80103623278996e1e8ece660c80507c090131`, GPL-2.0.
- Windows Store package identity observed during acceptance:
  `48148WZ2100Project.Warzone2100forWindows_4.7.0.0_x64__qsk72963svc8a`.

All game-specific discovery, archive, map, model, script and runtime adapters stay in this extension
so it can move to the future `WZ2100Project/Warzone2100` extension repository with its own license.
The neutral Modkit core owns only public contracts, host routing and conformance fixtures.
