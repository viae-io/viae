# Viae typing ergonomics: generic connection state + inference polish

## Plan header

- Plan ID: `PLAN-VIAE-TYPING-ERGONOMICS`
- Title: Viae typing ergonomics: generic connection state + inference polish
- Status: `ARCHIVED`
- Scope: Make connection state generic (`IVia<S>`/`Via<S>`/`ViaOptions<S>` with required `state: S`), add `accept`-driven `request` overloads, introduce a structural `WebSocketLike` type for `wrap()`, and document the typed-claims pattern. Breaking changes are acceptable (beta).
- Plan dependencies: None
- Created: 2026-10-06
- Last updated: 2026-10-06

## Objective

The auth-state work shipped `state: unknown`. This plan makes the claims channel strongly typed with minimal, targeted surface: generic state on the Via layer, inference for streamed requests, and removal of `as any` friction for Node WebSocket users. `Context`/`Viae` generic threading is explicitly rejected (see D2) — the `AppContext` narrowing pattern delivers the same handler-side typing with zero internal churn.

## Scope and out of scope

**In scope:**
- `IVia<S = unknown>` with **required** `readonly state: S`; `ViaOptions<S = unknown> { state?: S }`; `Via<S = unknown> implements IVia<S>`; inference from `new Via({ wire, state: claims })`.
- `request` overloads: `{ accept: "stream" }` → `RequestResponse<StreamData<R>>` (legacy `ReadableStream<R>` args preserved; new chunk-type args wrapped); otherwise `RequestResponse<R>`; permissive fallback for plain `RequestOptions`.
- `WebSocketLike` structural interface for `WebSocketWire.wrap(ws, upgrade?)`.
- Docs: README typed-claims section + AGENTS bullet; breaking-change note.
- Type-level tests (`@ts-expect-error` probes) + runtime regression tests.

**Out of scope (deferred):**
- `Context<S>` / `RequestContext<S>` / `ResponseContext<S>` threading and Rowan/Api/Router generic plumbing.
- `Viae<S>` + a `ViaeOptions.state` admission factory (server-side typing stays via the `AppContext` assertion pattern; a sound async admission factory is its own design).
- Removing `Context`'s index signature (only coherent once `Context<S>` exists; keeps `viae.use` middleware ergonomic today).
- `MessageHeader` extras generics.

## Decisions (Atlas)

- **D1 — Required generic state; beta allows the break.** `IVia<S = unknown>` declares `readonly state: S` (required). `Via<S = unknown> implements IVia<S>`; `ViaOptions<S = unknown>` carries `state?: S`; construction-time resolution is unchanged in runtime terms — `this.state = (Object.hasOwn(opts, "state") ? opts.state : wire.state) as S` (the cast is required: `opts.state` is `S | undefined` under `strictNullChecks`). External structural mocks of `IVia` must add a `state` member — accepted.
- **D2 — No `Context<S>`/`Viae<S>` threading.** Handler-side typing already works via the existing context generic: `interface AppContext extends Context { connection: IVia<Claims> }` → `new Api<AppContext>(...)` → `ctx.connection.state.userId` typed, unknown keys rejected (verified with a compile probe under the repo's strict settings). Threading `S` through every internal signature buys no additional user-visible typing for `Api` users and risks variance/inference regressions; server-side `Viae` typing would additionally require a sound admission factory, deferred.
- **D3 — `request` overloads: inference for the new style, compatibility for the old.** Three overloads: (1) `{ accept: "stream" }` → `RequestResponse<StreamData<R>>` where `type StreamData<R> = R extends ReadableStream<any> ? R : ReadableStream<R>` — so both `request<number>(..., { accept: "stream" })` (new) and legacy `request<ReadableStream<number>>(..., { accept: "stream" })` (unchanged) type correctly, with no call-site churn; (2) `{ accept?: "object" }` → `RequestResponse<R>`; (3) permissive fallback `opts?: RequestOptions` → `RequestResponse<R>` so variables typed as plain `RequestOptions` keep compiling. Honest limitation (documented, not hidden): when `accept` is omitted the runtime is permissive (either shape), so overload 3 types `data` as `R` and a stream response is possible — this is an accepted, documented unsoundness; the specific overloads are precise only when `accept` is statically known. No runtime change.
- **D4 — `WebSocketLike` is structural and minimal, and the retype reaches internals.** Export an interface covering `readyState`, `bufferedAmount`, `send`, `close(code?, reason?)`, and `addEventListener(type: string, listener: (...args: any[]) => void)` / matching `removeEventListener` (the `any[]` listener is required for DOM-style handler assignability). `wrap(ws: WebSocketLike, upgrade?)` plus internal retypes: `_ws` and `_bind` take `WebSocketLike`; export the type from `src/index.ts`. Verify assignability with both the `ws` package and global/DOM WebSocket before finalizing. `connect()` typing stays as-is unless trivially compatible.
- **D5 — Type-level evidence, executed safely.** Add `@ts-expect-error` probes inside **non-executed blocks** (`if (false) { ... }` or never-called functions) so tsx-run tests do not throw while `tsc` still checks them; tests are included by `tsconfig.json` and an unused directive is a hard `TS2578`. Probes use optional-safe access (`data!` or `ReadableStream<R> | undefined`) because `RequestResponse.data` is optional. Runtime behavior must not change.
- **D6 — Docs state the changes.** README gains a short "Typed claims" subsection using the `AppContext` pattern; AGENTS.md gets one bullet. Note: `IVia` now requires `state`; `ViaOptions.state` infers `S`; `request` legacy call sites keep their meaning (the `StreamData<R>` conditional), new-style inference is `request<T>(..., { accept: "stream" })`, and omitted-`accept` remains permissive (documented). `IVia.request` itself stays non-overloaded (interface consumers keep today's `request<R>` typing) — one sentence in the plan/docs makes that explicit.

## Rowan assessment (2026-10-06)

`E:\Code\rowan` (v2.1.0) is user-owned and may take majors. Examined `src/rowan.ts`: `Rowan<Ctx = any>`, `Processor<Ctx>`, `Middleware<Ctx>`, `Handler<Ctx>` are already generic and variance-tolerant (method bivariance plus contravariant handler parameters), so even a future `Context<S>` threading in viae would not require Rowan changes. **No Rowan change is merited for T1–T4.** Cosmetic strictness items — `use(input, meta?: any)` → `Meta`, explicit `convertToMiddleware` return type, `Rowan<Ctx = any>` default — are recorded as non-goals; revisit only if `Context<S>` threading is pursued and friction actually appears.

## Interfaces (contract sketch)

```ts
// via.ts
interface IVia<S = unknown> { /* ...existing... */ readonly state: S; }
interface ViaOptions<S = unknown> { /* ...existing... */ state?: S; }
class Via<S = unknown> extends Rowan<Context> implements IVia<S> { readonly state: S; }
type StreamData<R> = R extends ReadableStream<any> ? R : ReadableStream<R>;
class Via<S> {
  request<R>(method: string, path: string, data: unknown, opts: RequestOptions & { accept: "stream" }): Promise<RequestResponse<StreamData<R>>>;
  request<R>(method: string, path: string, data?: unknown, opts?: RequestOptions & { accept?: "object" }): Promise<RequestResponse<R>>;
  request<R>(method: string, path: string, data?: unknown, opts?: RequestOptions): Promise<RequestResponse<R>>;
}

// wire.ts
interface WebSocketLike { readyState: number; bufferedAmount: number; send(data: ArrayBuffer | ArrayBufferView): void; close(code?: number, reason?: string): void; addEventListener(type: string, listener: (...args: any[]) => void): void; removeEventListener(type: string, listener: (...args: any[]) => void): void; }
class WebSocketWire { static wrap(ws: WebSocketLike, upgrade?: unknown): WebSocketWire; }
```

## Work items

### T1 — Generic state (owner: H1)

Files: `src/via.ts`, `test/via.spec.ts`.
1. `IVia<S = unknown>` + required `state: S`; `ViaOptions<S = unknown>`; `Via<S = unknown> implements IVia<S>`; keep the presence-based snapshot and all lifecycle logic untouched.
2. Tests: existing state tests keep passing; add type probes (`@ts-expect-error` for missing/unknown state member on an `IVia` mock; positive inference `new Via({ wire, state: { userId: "x" } })` → `state.userId` is `string`) and the `AppContext` pattern compile probe (typed `ctx.connection.state` + unknown key rejection) in a small type-test block.

### T2 — `request` overloads (owner: H1)

Files: `src/via.ts`, `test/via.spec.ts`.
1. Add the three overloads and the `StreamData<R>` conditional per D3 without changing the implementation body. The conditional deliberately preserves every legacy `request<ReadableStream<T>>(..., { accept: "stream" })` call site (no sweep required) while enabling `request<T>(..., { accept: "stream" })`.
2. Tests: non-executed type probes for new-style inference, legacy-style preservation, fallback with a plain `RequestOptions` variable, and omitted-`accept` permissiveness; runtime accept-assertion tests stay green.

### T3 — `WebSocketLike` (owner: H1)

Files: `src/wire.ts`, `src/index.ts`, `test/wire.spec.ts`, `README.md` examples (only where `as any` was used for `wrap`).
1. Define and export `WebSocketLike`; retype `wrap`, `_ws`, and `_bind` to it; adjust the `message` listener to the `(...args: any[]) => void` signature. Verify assignability with the `ws` package and global/DOM WebSocket (empirical probe) before finalizing.
2. Export `WebSocketLike` from `src/index.ts`.
3. Tests/probes: `wrap` still works with the existing stub; cast removal at real call sites (`test/utils.ts`, `test/auth-state.spec.ts`, `test/viae.spec.ts`, `test/stream-protocol.spec.ts`) is the evidence; `connect()` unchanged.

### T4 — Docs (owner: H1)

Files: `README.md`, `AGENTS.md`.
1. README: short "Typed claims" subsection under Connection state & auth — `interface AppContext extends Context { connection: IVia<Claims> }`, `new Api<AppContext>`, note the required-`state` break and `ViaOptions.state` inference; document the `request` typing story (new `request<T>(..., { accept: "stream" })`, legacy `request<ReadableStream<T>>` preserved, omitted-`accept` permissive) and that `IVia.request` stays non-overloaded; update quick-start and stream examples where `wrap(ws as any)` is now unnecessary via `WebSocketLike`.
2. AGENTS.md: one bullet on typed claims + `WebSocketLike`; note the beta break.

### T5 — Verification + closure (owner: Atlas)

`npm test`, `npm run build`, `npx tsc --noEmit -p tsconfig.json`, `npm run test:coverage` (manual thresholds), `git status --porcelain`; evidence recorded; archived.

## Dependencies

- T1–T4 are one workstream (same files); T5 after.
- Non-plan prerequisite: current tree green (248/248 baseline).

## Acceptance criteria

1. `new Via({ wire, state: claims })` infers `S`; `via.state` and `ctx.connection.state` are typed via `interface AppContext extends Context { connection: IVia<Claims> }`; unknown claim keys fail typecheck (`@ts-expect-error` probes consumed).
2. `request` with `{ accept: "stream" }` types `data` as `StreamData<R>` — both `request<number>` (new) and legacy `request<ReadableStream<number>>` call sites type correctly; plain `RequestOptions` variables still compile via the fallback overload; omitted-`accept` permissiveness is documented; runtime behavior unchanged (existing accept tests green). Probes are non-executed and use optional-safe access.
3. `WebSocketWire.wrap` accepts `ws`-package and global-WebSocket sockets without casts (compile probes), with upgrade passthrough intact.
4. All tests green (248 + new type/runtime tests), build and full typecheck clean, coverage thresholds manually verified, README/AGENTS updated.
5. No behavior changes outside typing; `Viae`/lifecycle/auth semantics untouched.

## Verification

- `npm test`; `npm run build`; `npx tsc --noEmit -p tsconfig.json`; `npm run test:coverage` (manual check).
- Compile probes are part of the checked test set; unused `@ts-expect-error` fails the typecheck.
- Atlas final pass: frozen-tree run + diff scope + evidence in this file.

## Risks and mitigations

- **R1 — Inference regressions from `Via<S>`**: default `S = unknown` keeps bare usage working; probes cover inference and explicit args; build/tests catch breakage.
- **R2 — Overload lying about runtime**: D3 pins runtime semantics; existing accept-assertion tests are the guard.
- **R3 — `WebSocketLike` not matching `ws` structurally**: empirical probe before finalizing; fall back to a structural union rather than casts.
- **R4 — `@ts-expect-error` rot**: unused directives fail `tsc`; probes live in specs included by `tsconfig.json`.

## Verification evidence (Atlas, frozen tree, 2026-10-06)

- `npm test` → **249 pass / 0 fail** (248 baseline + 1 new runtime stream-typing test); the 7 type probes are `if (false)` blocks, type-checked but not executed.
- `npm run build` → exit 0; `npx tsc --noEmit -p tsconfig.json` → exit 0 with all `@ts-expect-error` directives consumed (no TS2578).
- `npm run test:coverage` → overall statements **96.84%** (≥93%); lowest source file `api.ts` 91.91% (≥85%); `via.ts` 99.78%, `wire.ts` 96.41%.
- `git status --porcelain` → exactly the scoped files + plan artifacts; no commits.

Acceptance criteria evidence:

1. `IVia<S>`/`ViaOptions<S>`/`Via<S>` with required `state: S` and the cast constructor (`src/via.ts:136,162,243,324`); probes cover inference, unknown-key rejection, required-state mock rejection, and the `AppContext` narrowing pattern.
2. `request` overloads with `StreamData<R>` (`src/via.ts:237,1036`): probes cover new-style inference, legacy `request<ReadableStream<T>>` preservation (no double wrap), no-type-arg, plain-`RequestOptions` fallback, and omitted-`accept` permissiveness; runtime accept tests green; `IVia.request` non-overload guarded by a probe.
3. `WebSocketLike` exported (`src/wire.ts:53,89`, `src/index.ts:3`); casts removed at real call sites (`test/utils.ts`, `test/auth-state.spec.ts`, `test/viae.spec.ts`, `test/stream-protocol.spec.ts`, `test/wire.spec.ts`) and in README/AGENTS quick starts; `connect()` unchanged.
4. Docs: README "Typed claims" (`README.md:663`) + stream typing notes; AGENTS typed-claims and beta-break bullets.
5. No behavior changes outside typing; `Viae`/lifecycle/auth semantics untouched (`src/viae.ts`, `src/context.ts`, `src/stream.ts` unmodified); Rowan unchanged (no changes merited — assessment recorded above).

## Run registry

| Unit | Conductor session | Status | Scope |
|---|---|---|---|
| T1–T4 / H1 | ses_eef36d513ffeRqDaJNQ7mPxH72 | COMPLETE | via + wire + index + tests + docs |
| T5 / Atlas | this session | COMPLETE | verification + closure |

## Change log

- 2026-10-06: created from the typing assessment; user confirmed breaking changes are acceptable (beta) and that Rowan may take majors if merited. Rowan assessment recorded (no changes merited).
- 2026-10-06: critic round 1; revised — constructor cast fixed (D1), `request` overloads redesigned with the `StreamData<R>` conditional to preserve legacy call sites plus a permissive fallback and documented omitted-`accept` unsoundness (D3), `WebSocketLike` retype extended to internals + index export (D4), non-executed probes and optional-safe access pinned (D5), docs scope updated (D6).
- 2026-10-06: critic round 2; APPROVED (all cases empirically probed). Implemented and verified (249 tests, build/typecheck clean, coverage 96.84%); AC1–AC5 evidenced; status set COMPLETE; archived.
