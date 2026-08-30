# UI localization

Modkit UI uses one host-owned localizer in every VS Code, Electron, and browser composition. English is the reliable fallback, Russian is bundled, and hosts may select `auto` or a BCP-47 locale such as `ru-RU`.

Language packs are data, not executable extensions. A host reads JSON, passes the decoded value through `parseUiCatalogDocument`, and gives the validated document to `createUiLocalizer`. The host must reject the raw file before `JSON.parse` when it exceeds `UI_CATALOG_RECOMMENDED_MAXIMUM_JSON_BYTES`; the parser then limits message count, key length, individual message length, and the aggregate decoded key-and-value size. Accessors are rejected without calling them, and missing messages fall back through the locale parents and then English. Catalog order defines override order, so an application can statically import a pack or an extension manager can load the same JSON from disk, browser storage, or a CDN.

By default a catalog can publish only the key prefix derived from the last part of its namespace: `org.example/example-ui` owns `example.*`, while `org.modkitx/electron-app` owns `electron.*`. A host may explicitly grant other prefixes through `authorizedMessagePrefixes`; this is required for a global language pack that translates core UI keys. Ordinary extension packs should not receive those broader rights. When a catalog overrides a fallback message, it must preserve the same interpolation placeholder names. A host with its own application catalog may pass that English catalog as `fallbackCatalog` while validating another locale.

```json
{
  "schema": "org.modkitx/ui-message-catalog@1",
  "locale": "ru",
  "namespace": "org.example/example-ui",
  "messages": {
    "example.subject.title": "Объект"
  }
}
```

Core owns only the catalog parser, fallback rules, bundled English/Russian strings, and presentation helpers such as `contributionContractLabel`. Exact contribution contract identifiers remain in subject metadata and tooltips; labels such as “Codec Contributions” and “Кодеки” are presentation only.

The future `org.modkitx/localization-contribution@1` registry contract should point to this JSON wire format. It is intentionally not registered or activated here: extension discovery must validate trust and VFS access before passing catalog data to the UI package.
