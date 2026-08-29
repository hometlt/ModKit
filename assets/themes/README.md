# Static app themes

`modkit.themes.json` is the format-neutral theme input for the Web and Electron builds.

Each entry has an id, a user-facing label and a stylesheet path relative to the manifest:

```json
{
  "schemaVersion": 1,
  "themes": [{ "id": "example", "label": "Example", "stylesheet": "example/theme.css" }]
}
```

The core manifest contains only the themes owned by this repository. A specialized static build can
add independent theme packs by setting `MODKIT_APP_THEME_ROOTS` to one or more directories that each
contain a `modkit.themes.json`; separate multiple roots with the operating system path delimiter.
Both app build scripts consume the same variable.

The core manifest may use the reserved `modkit-ui.css` value for themes already implemented by the
shared UI stylesheet. External manifests always name a real relative CSS file.

The build refuses invalid or duplicate ids, duplicate roots, absolute or traversing paths, missing
CSS files, oversized inputs and more than 64 total themes. It copies accepted stylesheets beside the
app, embeds their ids and labels as inert JSON in the document, and generates the Web service-worker
theme cache entries from the same resolved set. The runtime picker reads only that build data.
