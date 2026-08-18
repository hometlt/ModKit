# 13. VFS Providers and Sources

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Решение

`@modkitx/vfs` является открытым механизмом виртуальных namespaces, mounts и overlays и сохраняет
canonical ownership текущих foundational providers. Он не обязан содержать реализацию каждого
возможного source: новые Git/GitHub/API/cloud/game-store/workshop/private systems могут подключаться
как extension providers. Перемещение уже существующих providers требует отдельного canonical
решения и не является условием v1.

Semantic codecs работают с `ArtifactSource`/VFS contracts и поэтому не меняются при
появлении нового transport/storage provider.

## 2. Разделение provider types

```text
SourceProvider
  materializes one address/revision as ArtifactSource

VfsProvider
  exposes hierarchical namespace: stat/list/open/watch/write

MountProvider
  creates a configured mount/session from URI + credentials + options

ContainerProvider
  opens an artifact and exposes child entries; may be adapted to a VFS mount

AssetCodec
  interprets assembled AssetInput as semantic AssetHandle
```

Одна extension может реализовать несколько offers, но registry contracts остаются
раздельными. ZIP/MPQ не обязаны притворяться remote filesystem; Git provider не обязан
знать SC2Map semantics.

## 3. Core contracts

```ts
type SourceAccess = 'read' | 'write' | 'list' | 'metadata' | 'random-access' | 'watch'
type VfsAccess = ReadonlySet<SourceAccess>

interface VfsProvider {
  readonly descriptor: VfsProviderDescriptor
  mount(request: MountRequest, context: MountContext): Promise<VfsMount>
}

interface VfsMount {
  readonly id: string
  readonly revision: string
  readonly access: VfsAccess

  stat(path: VirtualPath): Promise<VfsEntry | undefined>
  list(path: VirtualPath, page?: PageRequest): Promise<Page<VfsEntry>>
  open(path: VirtualPath, options?: OpenSourceOptions): Promise<ArtifactSource>
  watch?(path: VirtualPath, sink: ChangeSink): Promise<Disposable>
  beginWrite?(options: WriteTransactionOptions): Promise<VfsWriteTransaction>
  dispose(): Promise<void>
}
```

Core владеет:

- normalized virtual paths и traversal protection;
- mount table и explicit routing;
- overlays и writable owner selection;
- revision/provenance model;
- cancellation, paging и lifecycle;
- cache/credential/network brokers;
- provider catalog/resolution;
- permission and trust enforcement.

Core не владеет Git protocol, GitHub REST/GraphQL, OAuth конкретного сервиса, Steam
Workshop API или game-specific CASC discovery.

VFS mount может стать `namespace` origin целого asset/content-store subject либо открыть
отдельный child `ArtifactSource`. VFS не решает, какие entries образуют один bundle asset;
это делает codec input plan и workspace resolver. См.
[16-composite-assets-and-origins.md](16-composite-assets-and-origins.md).

## 4. Provider manifest

```json
{
  "schemaVersion": 1,
  "id": "org.example.sources/github",
  "provides": [
    {
      "contract": "common.vfs/mount",
      "contractVersion": "*",
      "schemes": ["github"],
      "sourceCapabilities": ["source.random-access", "source.revisioned"],
      "vfsCapabilities": ["list", "read", "watch"],
      "environments": ["node", "browser-worker"],
      "permissions": ["network.fetch", "credential.read"],
      "offline": "cached-read"
    }
  ]
}
```

Scheme является discovery hint, а не hardcoded switch в core. Несколько providers могут
предлагать один scheme/contract; workspace resolver выбирает реализацию по environment,
policy, conformance, user preference и lock.

## 5. Addresses, identity и revisions

VFS URI не является единственной identity subject/asset. Нужно разделять:

```text
address       где запросить content
source ID     стабильная identity внутри mounted provider
revision      commit/hash/etag/generation/content digest
virtual path  положение в workspace namespace
provenance    provider, mount, dependency/overlay layer
```

Примеры адресов могут выглядеть как `git+file:`, `github:`, `https:` или vendor-specific
URI, но public contracts используют parsed structured address. Credentials никогда не
включаются в URI, descriptor, provider-policy lock или cache key в открытом виде.

## 6. Credentials и network access

Provider запрашивает credential handle через host-owned `CredentialBroker`:

```ts
interface CredentialBroker {
  request(request: CredentialRequest): Promise<CredentialLease>
}
```

- Extension получает short-lived scoped lease, а не доступ ко всему secret store.
- Manifest объявляет service/audience/scopes до activation.
- Host показывает permission review и может отказать.
- Logs, diagnostics, lockfiles и error envelopes проходят redaction.
- Refresh/revocation принадлежат broker/host, не codec.
- Network requests идут через policy-aware broker, если environment требует sandboxing.

## 7. Overlay и write model

Типичный resolution order:

```text
unsaved editor overlay
workspace writable mount
declared dependency mounts
base content mounts
explicit optional remote fallback
```

Read provenance всегда видим. Write направляется только в выбранный writable owner.
Remote or archive source без transaction guarantees может поддерживать `export-only`, а
не притворяться атомарно writable.

```text
mutation mode: read-only | export-only | mutate
commit guarantee: atomic | transactional | recoverable | best-effort
```

Значения являются общими `MutationMode`/`CommitGuarantee` из
[25-subject-identity-editing-transactions-and-cache.md](25-subject-identity-editing-transactions-and-cache.md#9-mutation-mode-commit-guarantee-and-result-status).

## 8. Cache и offline behavior

Cache key включает provider ID/version, structured address, immutable revision или
validated ETag/content digest, request options и security partition.

Provider объявляет одну из policies:

```text
offline-none
metadata-only
cached-read
full-snapshot
local-authoritative
```

Host не должен silently подменять locked revision более новой remote version. Stale cache
отображается с provenance/diagnostic. Private caches изолируются по account/workspace и
не становятся общим artifact catalog без явного разрешения.

## 9. Examples

### Local Git repository

Mount фиксирует working tree или commit. Unsaved/editor overlay располагается выше Git
worktree. Commit/push являются explicit operations, а не побочным эффектом `source.save`.

### GitHub repository/API

Provider может быть read-only, paged и lazy. Для reproducibility lock хранит provider,
repository identity и commit SHA, но не access token.

### Website/API content source

Provider преобразует domain API objects в versioned virtual entries. Raw arbitrary URL
fetch не даёт автоматического trust/execute права вложенному content.

### Game content store

CASC, workshop или installed game provider публикует immutable/revisioned sources и
declared lookup rules. Game semantic extension разрешает logical references через
workspace, а не импортирует конкретный store implementation.

## 10. Security invariants

- Path traversal и case-collision policy проверяются на VFS boundary.
- Symlink/external redirect не выходит за granted scopes без новой permission.
- Remote reference не устанавливает и не активирует executable extension.
- Provider cannot fabricate broader permissions via returned capability descriptor.
- Listing, reads, watches и writes cancelable и bounded.
- Provider crash закрывает mount generation и допускает fallback/reopen.
- Untrusted content никогда не становится code только из-за file extension/media type.

## 11. Package and extension ownership

```text
packages/vfs
  contracts, paths, mounts, overlays, routing, registry interfaces

packages/assets
  ArtifactSource, SourceRef, source/asset resolution integration

packages/workspace
  mount composition, dependency layers, indexes, lock and policy

independent extension repository
  source-providers/<id>
  concrete providers and manifests

main-repo extensions/common/<id>
  only when provider belongs to bundled common policy
```

Distribution/catalog coordinates, not repository folder names, make provider available. Generic
Modkit can install/link Git/GitHub/API/store source extensions from independent artifacts according
to document 28; no authored VFS routing switch changes.

Current `packages/io`/game-loader paths — migration sources only. Target-first slices migrate their
consumers and delete replaced paths; no public facade changes target ownership.

## 12. Acceptance criteria

- Empty host запускается без remote/source extensions.
- Extension-defined VFS provider обнаруживается из manifest без eager runtime import.
- Один semantic SC2Map provider читает directory, MPQ mount и Git-backed workspace.
- Alternate compatible VFS provider выбирается/фиксируется переносимой provider-policy записью;
  exact target artifact/mount activation остаются install/machine-local state.
- Credentials отсутствуют в manifests, lockfiles, diagnostics, URLs и logs.
- Offline reopen использует ровно locked/cached revision либо возвращает actionable state.
- Removal/crash provider закрывает affected mount, но не завершает Modkit process.
- Path traversal, redirect scope escape и unbounded listing имеют conformance tests.
