# StarCraft II game discovery

Provider for `common.game/installation-discovery@1`. It verifies user-selected, platform-default
and Windows uninstall-registry candidates using the active CASC build record and the bounded
`SC2Data/config`, `SC2Data/data` and `SC2Data/indices` marker set.

This extension does not recursively scan disks, provision or launch the game, mount CASC content,
or enumerate Steam/Epic manifests. Mounting and dependency composition belong to the following
vertical-slice passes.
