# SPEC — UVS: Universal Scenarios major 1 (1.0 / 1.1 / 1.2 / 1.3 / 1.4)

Status: **candidate**. Admission to `registered` requires the composition verifier and
kernel executing `../conformance/uvs-uvb/vectors.json`, plus one real SC2 trigger set
and one real Warzone scenario lowered and replayed. Normative artifacts:
[`schema/uvs.document.v1.schema.json`](schema/uvs.document.v1.schema.json) owns the structure;
the 1.0, 1.1, 1.2, 1.3 and 1.4 schema IDs are reference-only minor-version selectors.
Fixtures under
[`fixtures/`](fixtures/), executable assertions in `../conformance/schema-assertions.json`.
Design rationale (Russian): `../../design/DRAFT_SPEC_UVS.md`.

## 1. What UVS is

The reactive plane: flat automata of `event → pure condition → bounded actions`.
Sources: SC2 GUI triggers, Warzone events, native Multiverse authoring. Chart state
(current state, variables, armed timers, unfinished reactions) is world state — saved,
hashed, replayed.

## 2. Semantics (normative)

1. Events come from the engine vocabulary registered with the intrinsic table; unknown
   ids refuse at composition.
2. Conditions are pure: only read-class intrinsics; the verifier proves it against the
   table. Delay is a timer plus a `timer.fired` handler — waits do not exist inside
   expressions.
3. An action is an intrinsic call (1:1 with the table), a shipped-UVB function call, or
   a chart variable write. Reaction budgets are enforced per tick; exhaustion is a
   typed scenario error naming the chart.
4. Firing order on one event is `(composition rank, chart name)` — fixed here, never by
   the implementation. Save/restore between two reactions of one event preserves the
   remainder queue and the final state hash.
5. A non-portable source construct is a `refusal` action carrying the original fragment
   and a reason. Silent loss is forbidden; a refusal without its original is invalid at
   the schema.
6. A chart-local variable has the composition-wide ID `namespace/chart/variable`, using
   the names already declared in UVS. Two documents declaring the same `namespace/chart`
   refuse at composition, even when their local variables differ; a layer does not silently
   replace a chart. `scenario.var/set-var` take this qualified ID. The verified composition
   binds the declared concrete type and initializer, not an inferred host-language type.
   UVS 1.0 initializers are bool, exact-decimal i64/fixed64, bounded UTF-8 strref or
   nonzero exact-decimal `ref<refKind>`; UVS 1.2 additionally admits `list<ref<entity>>`
   as an exact canonical variable type. Other lists and nominal records require a versioned amendment. The foundation admits the bounded static-action execution profile
   below; other reactive constructs refuse before provider-open. Inert charts may bind their
   verified scalar variables to common State.
7. Composition checks handlers, not only variable initializers. The canonical event vocabulary,
   pure expression calls, concrete variable types, argument counts/types, target states and
   shipped UVB function signatures are verified before a receipt is issued. A condition must
   return bool; incompatible scalar/reference kinds cannot be implicitly cast. Argument and
   assignment expressions are pure too. A directly used intrinsic must be declared by that
   UVS artifact's UVP owner and its capability must be granted. `set-var` is the concrete typed
   shorthand for the existing `scenario.set-var@1` writer and requires that declaration/grant.
   Source logical reference addresses are not numeric kernel handles: declaration type checking
   does not prove their source binding or lifecycle. Exact literal normalization remains a
   lowering obligation. Declaration verification does not prove executable lowering or source
   parity. Constructs outside the declared execution profile still refuse before provider-open.
8. A reaction action cannot silently discard `result<T>`. Reaction actions have no syntax to consume the
   Result of a direct intrinsic or shipped function, so such actions refuse with
   `results-are-handled`. Call a shipped non-Result wrapper whose verified UVB explicitly
   handles the error, using the existing return/unwrap/fallback rules. There is no implicit
   success or blanket conversion of errors to false. The typed `set-var` shorthand is a
   checked assignment, not a discard of the underlying writer: its lowering must propagate
   failure before continuing the reaction or committing `goto`. Execution profiles preserve
   this rule. UVS 1.3 initializers explicitly consume `result<bool>` as defined in §7;
   this does not relax the rule for reaction actions.

## 3. Foundation scalar-expression execution profile

This is a subset of UVS 1.0, 1.1, 1.2, 1.3 and 1.4, not registration of the complete language or native-game parity.
The public receipt/resource/provider route admits states and subscriptions to the four active
kernel events: `entity.created`, `timer.fired`, `order.arrived`,
`assembly.installation-completed`. The private numeric transport tags join to the canonical
event registry; RuntimeSessionV2 continues to expose `id@version` unchanged.

Conditions and arguments admit concrete bool/i64/fixed64/strref constants, declared chart
variables including implemented concrete reference kinds, short-circuit `and`/`or`/`not`,
scalar and same-kind reference equality/inequality, numeric ordered comparisons
and read-class calls whose concrete signature and execution profile are implemented. Numeric
literals are exact integer quantums; ordered string comparisons and logical reference literals
remain execution-profile refusals. `math.sin-turns/cos-turns@1` and `world.tick@1` are executable
pure calls; the tick comes from authoritative State, with an i64 overflow refusal.
Actions call captured non-Result UVB functions or assign the chart variable's exact implemented
type. Reference reads and assignments use the same canonical boxed-value codec and UVB
emitter as scalar variables. Definitions/players are checked against composition membership;
entity/job/timer handles against allocated State identities. The fresh composition has no
entity/job/timer identities, so initial references of those kinds refuse before provider-open.
Zero/null handles and implicit source-address conversions are not admitted.
Direct intrinsic actions follow §5; refusal actions and other events refuse before provider-open.
Source-language handlers still belong to their language owner.

Dynamic expressions lower to ordinary UVB functions through the same typed IR/emitter as Luau.
There is no UVS expression interpreter. Generated modules are structurally/profile verified
against the receipt-captured registry and grants, and may use only their source UVP package's
declared intrinsic requirements, including `scenario.var@1` for variable reads. Derived namespaces
are deterministic and collisions refuse. Derived UVB identities and the plan enter the private
binding digest; public receipt and frozen fixtures remain unchanged.

The immutable plan derives only from the receipt-captured UVS/UVB and composition ranks. It
binds chart ordering `(rank, name, qualified name)` using UTF-8 order. Within a chart/state,
handlers and actions retain authored array order. Before an event's first reaction, subscriptions
are selected from the current states. The selection stays fixed for that event, including
multiple handlers; a goto cannot replace its remaining cursors. A subsequent event, including
another event delivered in the same tick, selects states **after** all preceding reactions.
Conditions false skip both actions and goto. Action-generated events are due at a future tick;
there is no recursive same-tick callback stack.

Rust/WASM owns current states, pending delivered events, selected handler cursors and per-tick
reaction/fuel counters. They are saved and hashed in private `scenario` section v2 (`MVBC 19/20/21/22`,
kernel transport ABI 18); older inert binding profiles retain their v1 sections. Frozen UVB
fixtures and RuntimeSessionV2 do not change. A pending cursor prevents advancement to the next
tick. Internal `react(maximum,fuel)` commits one whole reaction at a time; an error retains the
failed cursor, names its chart/cause, and rolls back all its writes and goto. Earlier successful
reactions remain committed. Product `step(1)` encloses advancement and all reactions in the
existing tick snapshot/rollback boundary and publishes events only after success.

Admission budgets: 256 charts, 256 states per chart, 4096 total states/handlers/actions,
64 arguments per UVB call. Outstanding dispatch work shares the existing event budget.
At its cursor, a condition reads current State. False skips actions and goto. Each argument and
assignment expression evaluates in source order, observing preceding committed actions. Each
reaction shares instruction fuel across its condition, arguments, calls and writer actions; per-tick limits are
4096 reactions and 1,048,576 fuel units, preserved across incremental calls and save/restore.
Generated-expression limits are 4096 functions in total, 256 functions per module, 4096 nodes
per expression and bounded compiler/VM depth, 1 MiB per module, and the existing 256-module /
4 MiB binding limit. Private MVBC20 tags evaluator addresses; static bindings retain MVBC19.
This profile does not implement list/record or nullable reference assignments, mutable source globals,
resumable execution inside one action, or real SC2/Warzone trigger translation.

## 4. UVS 1.1 typed event fields (normative amendment)

`uv.version: "1.1"` adds the pure expression `{ "kind": "event", "name": "entity" }`.
Only `kind` and `name` are valid fields. The name resolves solely in the current handler's
canonical event payload in `../runtime/events.v1.json`; a previous handler or chart does not
introduce fields. Missing names, incompatible concrete types and unknown minor versions refuse.
UVS 1.0 refuses this expression at every nested level. Both versions use the same schema body,
variable projection, typed verifier and compiler; callers cannot infer a version from syntax.
UVS 1.1 `var` reads bind `scenario.var@1`, including its declared UVP requirement and read grant;
UVS 1.0 declaration semantics remain unchanged. Both execution profiles require that reader
authority when lowering a variable read.

The foundation supports these existing canonical event contracts:

| Event | Original payload, in canonical parameter order |
| --- | --- |
| entity.created@1 | entity: ref\<entity\> |
| order.arrived@1 | entity: ref\<entity\> |
| timer.fired@1 | timer: ref\<timer\> |
| assembly.installation-completed@1 | entity: ref\<entity\>, job: strref |

`job` remains the decimal UTF-8 string required by the existing event version; it is not an
implicit `ref<job>` cast. A future typed job-reference event requires its own version amendment.
Reference equality/inequality is admitted only between the same concrete reference types.
Ordered comparisons remain numeric. An event field can feed a pure call or a captured shipped
UVB callback with the exact matching parameter type; scalar assignments retain their old limits.

Each dynamic expression in a 1.1 handler lowers through the shared IR/emitter to an ordinary UVB
function whose parameters are the entire canonical event payload. Arguments come from the
**original delivered event**, even after earlier actions, incremental dispatch or restore.
There is no ambient current-event variable, host callback or second expression VM. Conditions,
argument evaluators and actions continue to share the same authoritative State and fuel.
Mixed 1.0/1.1 compositions distinguish zero-argument and event-parameter evaluators in private
MVBC21; static plans retain MVBC19 and 1.0 dynamic plans retain MVBC20. ABI18, public event
versions, RuntimeSessionV2 and the scenario save section v2 are unchanged. The plan and derived
UVB identities enter the private binding digest. Cross-build save migration is not implied.

A delivered ID identifies an object that was allocated; it does not prove that it is still
active. Fired timers have already left the active timer map, and completed installation jobs
have left the job map. Payload decoding must never revive them. Comparing the identity or
handling `timer.cancel`'s Result remains valid; `timer.remaining` on an expired timer refuses
`invalid-reference`. Restore checks each pending/selected event's exact physical payload shape,
nonzero IDs and allocated-ID ranges, as well as the existing sequence/tick/cursor constraints.
Failure remains atomic at reaction and product-step boundaries.

Actual foundation-generated creation, arrival, timer and installation events are tested in
Node and Chrome, including handler continuation/save, mixed minor versions and current-State
reads. The ordinary Modkit worker verifies creation/timer callbacks and whole-tick rollback on
an expired-timer read. These checks prove the common execution path, not native-game handler
translation or completion of M1.

## 5. Direct intrinsic actions through UVB (execution profile)

The existing `intrinsic` action in UVS 1.0/1.1 uses the same captured canonical signature,
UVP requirement and capability checks as shipped UVB. Arguments remain pure expressions,
evaluated in authored order against current State. Mutation is permitted only in the action
body; changing an IR call node does not relax the condition/argument verifier's purity rules.
`result<T>` actions still refuse `results-are-handled`: the author must ship a checked UVB
wrapper. No Result is implicitly discarded or converted to success.

Lowering generates an ordinary non-Result UVB function with the intrinsic's concrete
parameters and return type. Its body emits the existing `call.intrinsic`, records the actual
registry reads/writes and returns the ordinary value to the existing action dispatch. It
does not create another action interpreter, new private plan tag or new ABI export. Functions
share the 4096 generated-function budget, 256-function chunks, module/byte limits and declared
requirements of the source UVS artifact. Source-map ordinals are explicitly virtual
`#uvs-action`; pure expression ordinals remain `#uvs-expression`.

Only implemented signatures and representable argument/value types are admitted. The current
mutating direct-action subset is `entity.create@1`, `timer.start@1`, `rng.roll@1` and
`rng.roll-fixed@1`; concrete supported read calls can also be actions. Optional arguments,
void UI calls, generic value/list/record arguments and unbound source reference literals
still require their respective execution support. Structurally registered `entity.destroy@1`
is not implemented by this VM and refuses. Intrinsic vocabulary registration and executable
admission are distinct: the foundation profile checks implemented names for **both** UVB 1
and UVB 2, including the result/list/Pos fast path. It never treats UVB 1 or the presence of
a wrapper opcode as permission to run every registered native.

Direct RNG/timer/entity creation uses the same State, ID allocators, future-event queue and
instruction fuel as all other actions. A failed later action restores every earlier write,
including RNG draws and allocated IDs, within the reaction. Product `step` still restores
the whole tick before publishing any event. The existing private bindings, scenario section
v2 and ABI18 remain unchanged; static direct actions require a generated UVB module and hence
use MVBC20, or MVBC21 when 1.1 event-parameter evaluators are also present.

## 6. UVS 1.2 entity-list State values

A variable may declare `type: "list<ref<entity>>"`, with a canonical array of nonzero
u64 decimal references as `initial`. There is one major-1 schema; the 1.2 ID only
selects the version. Earlier minors refuse this declaration. UVS 1.2 retains the
1.1 event-field scope, reader authority and Result obligations unchanged.

The type uses the existing UVB 2 canonical list codec and `EntityGroup` source type.
These are ordered values: duplicate entries are retained, assignments copy a value,
and there is no mutable group identity or alias. A native game's set/group object
requires its own explicit lowering; this amendment does not claim SC2 UnitGroup parity.

Foundation fresh compositions have no allocated entities, so the only executable
initializer is `[]`. Each written or restored member must identify an allocated
entity in that State. Identity is not a promise that the entity remains active.
Foundation bounds a list at 1024 members, using the existing UVB list budget; this is
an execution-profile ceiling, not a universal format-size limit. Pos, arbitrary
lists, records, optional and nullable references are not admitted to scenario storage.

An empty constant `[]` is executable in a typed list context; a nonempty constant
requires source/lifecycle binding and refuses before provider-open. List variables
can supply typed UVB arguments and typed `set-var` values. List comparison is not
defined by this profile. `mv.scenario.requireGroup/groupOr/setGroup` and captured
source symbols lower to the same scenario reader/writer and existing box operations.
`groupOr` handles a type mismatch of an existing variable; a missing variable still
refuses at the shared reader. A returned Result error is a value; VM failure rolls
back the call, failed reactions roll back their effects, and product step rolls
back its tick. The save format and RuntimeSessionV2 remain unchanged.

## 7. UVS 1.3 atomic fresh-State initialization

An optional `charts[].initialize` array contains ordered, captured UVB calls:

```json
{ "kind": "uvb", "module": "sample.bootstrap", "function": "start", "args": [] }
```

The shipped function MUST have zero parameters and return `void`, `bool` or
`result<bool>`. Its verified module owns its intrinsic requirements and capability
grants. Other action kinds, event fields, arguments and return types refuse. Earlier
UVS minors forbid `initialize`, including an empty array. UVS 1.3 retains the 1.1
event-field semantics and 1.2 variable types; its selector references the same schema.

After **all** composition variables and chart initial states have been created,
the kernel executes initializers in `(composition rank, chart name, qualified chart
ID)` order, retaining authored order within each array. Initialization runs before
a fresh State is exposed, while its tick remains zero. A `bool` return is an ordinary
successful callback result, including `false`. A `result<bool>` is explicitly consumed:
either `ok(true)` or `ok(false)` succeeds; `err` aborts initialization. Foundation
reports `scenario-initialization-failed` for that Result error; VM failures retain
their existing typed error code. Event reactions still cannot discard Results.

The entire phase is one transaction. A failed later initializer rolls back all
earlier variable writes, allocated entities/timers, RNG draws and queued events.
No partial State or startup event is published. Effects use the existing UVB VM,
captured composition and authoritative State. Events queued by successful startup
actions retain their normal future tick and are dispatched by normal stepping.

Foundation shares **1,048,576** instruction fuel across the whole phase, charging
one additional unit per call. Initializers and reaction actions share the existing
composition ceiling of 4096 declared actions. This is a bounded execution profile,
not an unbounded source-language initializer evaluator.

Restore replaces State with the validated saved snapshot; it MUST NOT replay the
initializers on that restored State. No initialization cursor or completion flag is
needed in saves, because partial startup State is never exposed. Initialization
targets/order contribute to binding identity, so changing the plan invalidates an
old save. Private MVBC22 adds the ordered function addresses to chart plans; older
MVBC19–21 bytes, scenario save section v2, public ABI18, RuntimeSessionV2 and frozen
UVB 1.1 remain unchanged. The WASM artifact digest changes with the implementation.

Native source global declarations, initializer expressions and map bootstrap
projection remain obligations of their language/game owners. This phase executes
already captured UVB and does not add a Galaxy/Lua parser, native VM, startup-event
intrinsic or second store.

## 8. UVS 1.4 authored initial reference addresses

A `ref<def>` or `ref<player>` variable MUST identify its initial target by an
authored address rather than a private numeric handle:

```json
{ "name": "definition", "type": "ref", "refKind": "def",
  "initial": { "address": "sample/unit/child" } }
```

For a player the same shape names an identity declared in the explicit player
setup of that verified launch. An address is an exact, nonempty UTF-8 string,
without NUL or leading/trailing whitespace, bounded by the existing canonical
strref codec at 1024 bytes. The object contains only `address`. Definition
addresses resolve through the one canonical UVD resolver's effective definition
index, including overlays/inheritance. Player addresses resolve through the
existing explicit player index. Readers MUST NOT mint an identity, guess an
alias, normalize case, use a fallback target or discover a target in presentation.

Declaration/composition verification validates the symbolic descriptor and
captures its immutable address. Executable binding proves the target exists
before any provider or resource session is created. A missing target refuses as
`binding-scenario-reference`; unsupported descriptor kinds refuse during
declaration verification.
An address does not create an entity, job or timer; these references still need
allocated State identities and cannot use this descriptor. This amendment does
not add a player table or change how a game owner supplies its launch players.

The existing binder assigns deterministic IDs once, then encodes the reference
through the same canonical value codec and writes the same typed UVS State.
Adding another definition/player may change private IDs without retargeting the
authored variable. Initializers see the bound values before they execute. State,
hash, save and restore contain the concrete references; the captured UVS document
and binding identity retain which authored targets produced them. Source aliases
use the same scenario reader/writer, with no second global reference store.

UVS 1.4 preserves the 1.1/1.2/1.3 event, entity-list and startup semantics. Its
minor ID selects the same major schema. Minors 1.0–1.3 retain their exact-decimal
reference initializers and forbid address objects; 1.4 forbids numeric initial
references for definitions/players. No opcode, intrinsic signature, private MVBC
version, WASM ABI or save layout changes. This is bootstrap binding infrastructure,
not proof of native Galaxy global declarations or actual MapScript execution.

## 9. UVS 1.5 nullable entity references in State

```json
{ "name": "last", "type": "ref<entity>?", "initial": null }
```

The fresh initializer MUST be `null`, without `refKind`. No entity identity exists
merely because a variable is declared. Decimal IDs, zero, objects, arrays and
booleans are not absent values. UVS 1.0–1.4 forbid this variable type. The 1.5
selector references the same major schema and retains all earlier semantics,
including mandatory authored addresses for initial definition/player references.

At runtime `None` and `Some(entity)` use the canonical typed-value codec in the
same authoritative State. A present reference MUST name a nonzero identity
already allocated in that State. An allocated identity remains valid in the
variable after its entity has been removed; removal does not clear the variable,
recycle the ID or restore a live entity. A game adapter must explicitly lower any
different native lifecycle rule.

UVS `set-var` can copy a variable with the same nullable type or assign a `const`
whose value is `null`. Equality/inequality compare presence and, when present,
identity, with no cross-kind cast. Conditions and dynamic reads lower through
the existing shared UVB compiler. Present numeric source constants still refuse:
they are not an authored reference-binding protocol.

Luau exposes `OptionalEntityRef`, contextual `nil`, `mv.option.entity(entity)`,
`hasEntity` and lazy `entityOr`. Scenario reads/writes use
`requireOptionalEntity`, `optionalEntityOr` and `setOptionalEntity`; source aliases
share these checked readers/writers. Assignment still requires a writable binding
inside a `ResultBool` function, with its error explicitly handled. Input and
returned present optional identities are checked inside the execution transaction;
VM traps, invalid optional inputs/outputs and fuel exhaustion roll back all
effects. A writer's `Result` error is an explicitly handled value: the rejected
write leaves that variable unchanged, but does not silently turn successful
earlier writes into a VM exception. Startup retains its explicit phase-wide
Result-error rollback rule from §7.

The same values participate in startup, events, state hashing, public saves and
restore. Restore does not rerun initializers. The canonical codec adds tag 7 and
UVB 2 adds `option.none`/`option.some` as specified in AMENDMENT_TYPED_VALUE.
Private bridge scalar tag 16 carries `u64` (zero denotes absence only in that
private nullable context). Kernel/bridge ABI is **19**, so an older WASM refuses
at open. Private MVBC22, saved scenario section v2, RuntimeSessionV2 and frozen
UVB 1.1 bytes remain unchanged; old nonnullable value bytes retain their tags.

This is shared nullable State infrastructure. It does not implement Galaxy
`UnitLastCreated`, its source-order update rule, native globals/bootstrap or
implicit conversion of native null handles. Those belong to native lowering.
