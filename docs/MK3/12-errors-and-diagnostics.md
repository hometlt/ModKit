# 12. Errors and Diagnostics

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Решение

Расширениям и codecs нужны собственные стабильные ошибки, но error type не является
capability. Capability сообщает, какие данные/API доступны; error сообщает, почему
операция, resolution или validation не завершились ожидаемым образом.

Core определяет три разные модели:

```text
ModkitError          control-flow failure: операция не может вернуть корректный результат
Diagnostic           user-visible observation: проблема, warning или hint
ResolutionResult     единственная wire-модель provider resolution, владелец — document 23
ResolutionViewState  host/UI projection install/permission/failure affordances
```

Они могут ссылаться друг на друга, но не должны заменять друг друга.

## 2. Семантика failure и absence

- `undefined` означает только отсутствие optional значения/capability.
- Missing optional provider/relation возвращает нормативный `ResolutionResult` из
  [23 §8](23-contract-identity-schema-resolution-and-lock.md#8-normative-candidate-provider-types-v1)
  и diagnostic.
- Corrupt input, I/O failure, broken invariant и missing hard prerequisite создают
  `ModkitError`.
- Scavenging parser может вернуть partial result, если contract это допускает, но обязан
  приложить diagnostics о пропущенных данных.
- User cancellation имеет отдельный stable code/category и не отображается как crash.

Этот документ не вводит вторую wire union. После получения `ResolutionResult` host может построить
presentation-only projection:

```ts
type ResolutionViewState<T> =
  | { readonly state: 'available'; readonly value: T }
  | { readonly state: 'missing'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly state: 'ambiguous'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly state: 'permission-required'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly state: 'installable'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly state: 'failed'; readonly diagnostics: readonly Diagnostic[] }
```

Mapping использует `UnresolvedReason`, local installed/catalog state и host policy. `installable` не
передаётся resolver-ом и не инициирует remote lookup; это UI affordance поверх отдельного catalog
API. Projection не сериализуется как lock/resolver result и не становится вторым contract owner.

## 3. Stable error coordinate

Error code квалифицируется publisher/extension namespace и не зависит от имени класса:

```text
org.modkitx.core/source-not-readable
org.modkitx.common.dds/invalid-subresource-offset
org.modkitx.blizzard.m3/unsupported-chunk-version
org.example.git-provider/authentication-required
```

Правила:

1. code стабилен для machine handling и telemetry grouping;
2. message может локализоваться и меняться;
3. новая семантика получает новый code;
4. provider implementation ID хранится отдельно от error code;
5. context использует JSON-compatible values и не содержит credentials/raw secrets;
6. extension error не обязан быть заранее известен core/UI.

## 4. Runtime error и serializable envelope

```ts
interface ModkitErrorOptions {
  readonly code: string
  readonly context?: Readonly<Record<string, JsonValue>>
  readonly hint?: string
  readonly cause?: unknown
  readonly provider?: ProviderRef
  readonly subject?: SubjectRef
  readonly source?: SourceRef
}

interface ErrorEnvelope {
  readonly schemaVersion: 1
  readonly code: string
  readonly message: string
  readonly context?: Readonly<Record<string, JsonValue>>
  readonly hint?: string
  readonly provider?: ProviderRef
  readonly subject?: SubjectRef
  readonly source?: SourceRef
  readonly cause?: ErrorEnvelope
  readonly stack?: string
}
```

`stack` передаётся только по debug/trust policy. После worker/process/RPC boundary host
восстанавливает общий `ModkitError`; consumer не должен полагаться на `instanceof`
extension-specific class. Проверка выполняется по stable `code` и structured context.

Extension вправе иметь удобный локальный subclass, но это implementation detail:

```ts
throw new ModkitError('M3 chunk points outside source', {
  code: 'org.modkitx.blizzard.m3/invalid-chunk-offset',
  context: { chunk: 'STC_', offset, sourceSize },
  hint: 'Проверьте, что файл не обрезан и соответствует заявленной версии.',
  cause,
})
```

## 5. Error definition registry

Extension может опубликовать metadata без активации runtime:

```json
{
  "$schema": "https://schemas.modkitx.org/error-definition.v1.json",
  "schemaVersion": 1,
  "code": "org.modkitx.blizzard.m3/invalid-chunk-offset",
  "defaultSeverity": "error",
  "category": "corrupt-input",
  "contextSchema": "./invalid-chunk-offset.schema.json",
  "messageKey": "errors.m3.invalidChunkOffset",
  "documentation": "./errors/INVALID_CHUNK_OFFSET.md",
  "retryable": false
}
```

Registry проверяет namespace ownership, unique code, JSON Schema, safe documentation
links и отсутствие secret-marked fields в telemetry projection. Unknown definition
показывается generic renderer по envelope; установка extension нужна только для richer
help/actions, но не для чтения самой ошибки.

Error definition не содержит executable recovery callback. Исправления регистрируются
отдельными code-action/operation contributions с requirements и permissions.

## 6. Diagnostic model

```ts
/** Non-negative decimal u64 on JSON/wire surfaces. */
type UInt64String = string & { readonly __brand: 'UInt64String' }

/** At least one complete coordinate system; empty and half ranges are unrepresentable. */
type SourceSpan =
  | {
      readonly byteOffset: UInt64String
      readonly byteLength: UInt64String
      readonly utf16Offset?: never
      readonly utf16Length?: never
      readonly line?: never
      readonly column?: never
    }
  | {
      readonly utf16Offset: number
      readonly utf16Length: number
      readonly line: number
      readonly column: number
      readonly byteOffset?: never
      readonly byteLength?: never
    }
  | {
      readonly byteOffset: UInt64String
      readonly byteLength: UInt64String
      readonly utf16Offset: number
      readonly utf16Length: number
      readonly line: number
      readonly column: number
    }

interface Diagnostic {
  readonly code: string
  readonly severity: 'error' | 'warning' | 'information' | 'hint'
  readonly message: string
  readonly subject?: SubjectRef
  readonly source?: SourceRef
  readonly range?: SourceSpan
  readonly semanticLocation?: SemanticLocation
  readonly related?: readonly DiagnosticRelatedInformation[]
  readonly context?: Readonly<Record<string, JsonValue>>
  readonly actions?: readonly ContributionRef[]
}
```

Byte coordinates count bytes and use decimal-u64 strings on the wire. Text coordinates count UTF-16
code units and use zero-based line/column. A producer may publish both complete systems when it knows
the mapping; consumers never infer or silently convert one system into the other.

Один error может породить несколько diagnostics: например, corrupt companion на relation,
disabled preview slot и workspace Problems entry. Diagnostics принадлежат revision;
результат для stale revision не публикуется.

LSP adapter только преобразует neutral diagnostic в protocol type. UI table/tree/property
grid используют тот же neutral diagnostic напрямую.

## 7. Logging, telemetry и privacy

- Library/extension code пишет через core logger и прикладывает `code`, provider/source
  refs и correlation ID.
- User-facing diagnostic не обязан содержать stack или internal exception text.
- Credential values, authorization headers, signed URLs и raw private content удаляются
  до serialization/logging.
- Повторное wrapping сохраняет `cause`, но не дублирует одинаковый diagnostic на каждом
  слое.
- Quarantine использует error category и crash metadata, а не разбор message string.

## 8. Package ownership

```text
@modkitx/core
  ModkitError, ErrorEnvelope, SourceSpan, Diagnostic, cancellation codes, logger primitives

@modkitx/assets
  subject/source/provider refs attached to errors, resolution states

scope-local embedded/installed extension catalog
  ErrorDefinition descriptors and documentation metadata

bundled-common or independent extension repository
  definitions/errors/<id>/contribution.manifest.json
  namespaced definitions, local subclasses, code-action contributions
```

`@modkitx/core` не импортирует extension registries. Catalog loader передаёт definitions
host-слою через общий registry API.

## 9. Migration

1. Инвентаризировать `null`/`undefined`/`false` failure paths и string-only throws.
2. Не менять semantic absence.
3. Назначить stable codes существующим hard failures.
4. Добавить structured context и сохранить original error через `cause`.
5. Ввести worker-safe serialization и redaction tests.
6. Зарегистрировать только ошибки, которым нужны schema/docs/localization/actions;
   простой internal invariant может использовать core definition.
7. Перевести UI/LSP на neutral diagnostics, не сравнивая message strings.

## 10. Acceptance criteria

- Extension-defined error проходит worker/process round-trip.
- Host отображает неизвестный namespaced code без runtime extension.
- `cause`, context, provider, subject и source provenance сохраняются по policy.
- Credentials и secret-marked context не появляются в logs/envelopes.
- Missing optional provider не превращается в thrown exception.
- Corrupt input не возвращается как `undefined` или пустой valid asset.
- LSP, CLI и workbench показывают одну semantic diagnostic с корректными locations.
