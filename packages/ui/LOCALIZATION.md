# UI localization

Modkit UI uses one host-owned localizer in every VS Code, Electron, and browser composition. English is the reliable fallback, Russian is bundled, and hosts may select `auto` or a BCP-47 locale such as `ru-RU`.

Language packs are data, not executable extensions. They use the registered data-only contract `modkit/localization-contribution@1`. The Extension Manager finds the extension root, the application opens the declared catalog through its VFS, and the host verifies the catalog path, size and attested SHA-256 before parsing JSON. `parseUiCatalogDocument` then limits message count, key length, individual message length, and the aggregate decoded key-and-value size. Accessors are rejected without calling them, and missing messages fall back through the locale parents and then English. Catalog order is deterministic and defines override order.

By default a catalog can publish only the key prefix derived from the last part of its namespace: `org.example/example-ui` owns `example.*`, while `modkit/electron-app` owns `electron.*`. A host may explicitly grant other prefixes through `authorizedMessagePrefixes`; this is required for a global language pack that translates core UI keys. Ordinary extension packs should not receive those broader rights. When a catalog overrides a fallback message, it must preserve the same interpolation placeholder names. A host with its own application catalog may pass that English catalog as `fallbackCatalog` while validating another locale.

The contribution manifest lists resources and requests message prefixes. Requested prefixes are not permissions: every application intersects them with its own policy. Modkit's applications grant their known built-in message roots and the exact prefix owned by the catalog namespace. The v1 contract has no priority field, so an extension cannot move itself ahead of other packs.

```json
{
  "schemaVersion": 1,
  "contract": { "id": "modkit/localization-contribution", "major": 1 },
  "id": "org.example/german-ui",
  "displayName": "German UI",
  "spec": {
    "catalogs": [
      {
        "locale": "de",
        "path": "localization/messages.de.json",
        "messagePrefixes": ["app.", "example."]
      }
    ]
  }
}
```

```json
{
  "schema": "modkit/ui-message-catalog@1",
  "locale": "ru",
  "namespace": "org.example/example-ui",
  "messages": {
    "example.subject.title": "Объект"
  }
}
```

Core owns only the catalog parser, fallback rules, bundled English/Russian strings, and presentation helpers such as `contributionContractLabel`. Exact contribution contract identifiers remain in subject metadata and tooltips; labels such as “Codec Contributions” and “Кодеки” are presentation only.

English and Russian are compiled into Web, Electron and VS Code and do not depend on the Extension Manager. A missing, disabled, malformed or tampered external pack produces a diagnostic and leaves those built-in catalogs active. VS Code passes only validated catalogs to its webview, Electron passes them from main to renderer through its profile IPC, and the PWA routes bundled and user-extension resources through separate allowlisted VFS paths.
