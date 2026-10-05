# Viae connection lifecycle: keepalive, reconnect, drain, backpressure, caps

## Plan header

- Plan ID: `PLAN-VIAE-CONNECTION-LIFECYCLE`
- Title: Viae connection lifecycle: keepalive, reconnect, drain, backpressure, caps
- Status: `ARCHIVED`
- Scope: Implement connection-level lifecycle capabilities for viae — heartbeat/eviction, client reconnect, graceful close/drain, wire backpressure, resource caps, protocol version field, `shortId` hardening, wire ownership — without breaking legacy wire peers.
- Plan dependencies: None
- Created: 2026-10-05
- Last updated: 2026-10-05

## Objective

Close the architectural gaps deferred by `PLAN-VIAE-BETA-HARDENING` (archived): detect and evict dead/half-open connections, survive transient disconnects with an opt-in client reconnect policy, shut down gracefully with bounded drain, apply real socket backpressure, bound per-connection resources, detect protocol major mismatches, and remove the multi-`Via`-per-wire footgun.

Baseline: hardening plan COMPLETE — 164/164 tests, build/typecheck clean, coverage 95.59% stmts. This plan starts from that frozen state.

**Revision note:** this plan was reviewed by an independent critic. All CRITICAL/MAJOR findings (credit desync, stream abort on transient drops, close/terminate idempotency, drain keyed on the wrong promise, outbound-cap error path, permanent-vs-transient reconnect classification, stale-wire events, heartbeat blocked by backpressure) are resolved in decisions D1–D13 below.

## Scope and out of scope

**In scope:** `Via` heartbeat (legacy-compatible protocol PING/PONG), reconnect policy with wire factory, `Via.close({drain})` / `Viae.close({drain})`, `Wire.bufferedAmount` + `Via.maxBufferedBytes`, caps (`maxInflightRequests`, `maxStreamsPerConnection`, `Viae.maxConnections`, `StreamOptions.maxCredit`), protocol version major field with validation, `shortId` via `crypto.getRandomValues`, single-`Via`-per-wire ownership, README/options documentation, regression + e2e tests.

**Out of scope:** protocol version negotiation handshake (v1 emits/validates a major only), stream resume across reconnect, request replay, per-stream `validate` → 400 remapping (documented contract), dependency changes, publishing/commits.

## Decisions (Atlas, final for implementation — revised after critic round 1)

- **D1 — Heartbeat is protocol-level, opt-in.** `ViaOptions.heartbeat?: { interval?: number; timeout?: number }` (defaults 15000 / 5000 ms; off when absent; both must be positive finite when supplied). A beat sends `{ id, head: { method: "PING" } }`. Any inbound frame carrying the beat id resolves it (new peers answer `PONG`; legacy peers answer a normal 404 response — also liveness proof). **Additionally, any inbound frame received after the beat was sent counts as liveness evidence for that beat** (a slow-reading peer that is still sending cannot be evicted because its PONG is queued behind buffered data on the ordered WebSocket). Missed timeout → connection failure (reconnect if configured, else terminal + wire close). Eviction bound is `interval + timeout` + slack, not `timeout`. Heartbeat frames bypass `maxBufferedBytes` drain (D4) via a direct control-send path; ordering behind already-buffered data remains a physical limit, mitigated by the bidirectional liveness rule above.
- **D2 — PING is always answered, reserved handling.** PING/PONG are reserved methods in the Via absorb guard, handled unconditionally of local heartbeat config: `PING` → best-effort `PONG` reply via the drain-exempt control path + `delete ctx.out`; `PONG` → `delete ctx.out`. Beat resolvers consume their frame (existing `interceptFn` deletes `ctx.out`).
- **D3 — Reconnect is opt-in, client-oriented, and never replays.** `ViaOptions.reconnect?: { wire: () => Wire | Promise<Wire>; minDelay?: 100; maxDelay?: 10000; factor?: 2; jitter?: 0.2; maxAttempts?: Infinity }`. In-flight requests reject on drop; streams abort on drop; `ready` resolves when connected (waits through reconnecting), rejects only on permanent closure. Events: internal `drop` on every connection loss; public `disconnect` per drop; `reconnected` per successful re-bind; `close` **only** on permanent closure (no policy, permanent error, attempts exhausted, or explicit `close()`). New `closed: boolean` getter.
- **D4 — Backpressure is opt-in.** `Wire.bufferedAmount?: number` (optional readonly) + `WebSocketWire.bufferedAmount` getter (`this._ws ? this._ws.bufferedAmount : Infinity`). `ViaOptions.maxBufferedBytes?: number` (default 0 = disabled; must be a non-negative safe integer, else `RangeError`). When enabled and the wire exposes a finite `bufferedAmount`, each outbound `wire.send` is followed by a poll-drain loop (≥4 ms steps) until below threshold; if the wire leaves OPEN during the wait, the send fails. No timers when disabled. Control frames (PING/PONG) bypass the drain.
- **D5 — Caps are opt-in, reject with `503 Busy`, and are counted correctly.** New `Status.Busy = 503`.
  - `maxInflightRequests` (default 0): enforced by a middleware placed after `Catch` and before `IncomingStreamUpgrade` in the Via constructor chain (therefore ahead of all user/Viae middleware), so setting `ctx.out.head.status = Busy` still flows through `After`'s out-processing. Only non-reserved request frames (method defined, status undefined) are counted/rejected; over cap → `503 {data:"busy"}`, no further processing. Counter decremented in the shared context cleanup path.
  - `maxStreamsPerConnection` (default 0): counted by wrapping the `intercept` hook of the stream transport in `_asTransport()` (increment only after the underlying registration succeeds, decrement on the dispose the stream layer invokes on terminate; reset on drop). Enforcement is **direction-aware**:
    - **Inbound request carrying a stream body** (`ctx.out` exists): over cap → set `ctx.out` to `503 {data:"busy"}` (flows through `After`), plus best-effort `CANCEL` on the announced sid so the remote producer stops promptly instead of waiting for `startTimeout`.
    - **Inbound response carrying a stream header** (client-side `ResponseContext`, no `ctx.out`): over cap → do not create the stream; reject the pending request interceptor with `ViaeError(Status.Busy, "too many streams")` (immediate failure instead of a 120 s request timeout) and best-effort `CANCEL` on the sid.
    - **Outgoing streams**: over cap enforced **inside `OutgoingStreamUpgrade`** — response streams replace `ctx.out` with `503 {data:"busy"}` (and cancel the handler-returned `ReadableStream` so its source is released); request-body streams reject the local `send()` promise with `ViaeError(Status.Busy)`. Do not rely on `Catch` for the out path.
    - Note: a `503` response to an inbound request resolves the caller's `request()` with `ok:false` (it does not reject it); prompt producer teardown comes from the explicit `CANCEL` frame.
  - `ViaeOptions.maxConnections` (default 0): excess connections closed immediately, no Via created.
  - `StreamOptions.maxCredit` (default `Infinity`): applied to **both roles** to avoid credit desync — the consumer clamps its requested window (`START`/`PULL` desiredSize and its `granted` initialization) to `maxCredit`; the producer clamps grants to `maxCredit` and **fails fast** (protocol error + error frame) when a peer grants more than `maxCredit`, because a clamped-but-unaccompanied grant would otherwise deadlock. Document that both peers should configure compatible values.
- **D6 — Protocol version is an additive head field, default-on with opt-out.** `FrameEncoderOptions.protocolVersion?: number` (default 1; must be `0` or a positive safe integer, else `RangeError`; `0` disables emission and validation). Precedence: `ViaOptions.protocolVersion` overrides `frameOptions.protocolVersion` (Via merges them into the encoder options). In `_prepare`, when a head exists, has own keys, and `head.v === undefined`, inject `v` into a **copied** head (caller's object is never mutated). `decode` validates `head.v` when present: must be a number equal to the configured major, else `Error("unsupported protocol version: <v>")`. Empty heads stay empty (`hasOwnKeys` gate) so `head: {}` byte-behavior is preserved. `v` is retained in decoded heads (it is part of the head); affected deep-equal tests are enumerated and updated deliberately.
- **D7 — `shortId` uses `crypto.getRandomValues`.** 8 random bytes → 16 lowercase hex chars; fallback to the legacy counter+random scheme only when the global crypto API is unavailable. Signature unchanged.
- **D8 — One `Via` per wire is enforced, with legitimate re-claim.** The first `Via` claims a module-private owner symbol on the wire; a *different* `Via` constructing on the same wire throws `Error("wire is already bound to another Via")`. The same `Via` may re-claim a rebuilt wire during reconnect; the claim is released on permanent close. Recorded bug-pattern fix (previously both instances double-handled every frame).
- **D9 — Drop vs permanent close, and stream aborts.** Every *unexpected* connection loss (wire close/error, heartbeat miss, protocol failure) emits an internal `drop` event; the stream transport's `onClose` hook subscribes to `drop`, so all active streams abort on any loss (the protocol has no resume). An intentional `Via.close()` triggers the internal abort path **without** emitting the public `disconnect` event; it emits `close` only. `close` is emitted only on permanent closure; `disconnect` only on unexpected drops. `_terminate` idempotency is explicit: the first terminal handler on a wire synchronously records `_terminatedGeneration = generation`, removes that wire's listeners, and only then performs async work; any further event (including `error` followed by `close` on the same generation) is ignored by generation equality. `Via.close()` uses separate `_closing`/`_closed` flags so the internal drop/abort path is never suppressed. With `drain: false`, new inbound frames are not routed once closing starts and pending requests are rejected; with `drain: true`, inbound requests continue to be processed until the drain bound.
- **D10 — Drain waits on processing + tasks, evaluated at drain time.** `Via.close({ drain, drainTimeout })` (default `drain: false`, `drainTimeout: 5000`) awaits, for each active context, its `process(ctx)` promise chained with its tasks **as of drain time** (not the cached `complete` getter). On expiry it force-aborts streams, disposes contexts, disposes the interceptor, closes the wire. Idempotent. `Viae.close(opts?)`: marks closed, immediately closes newly arriving connections, drains each connection via `via.close({drain:true, drainTimeout})`, `Promise.allSettled`, resolves when settled; the underlying server socket is not owned and is documented as such.
- **D11 — Permanent failures do not retry.** Decode failures/unsupported protocol version (and any error classified as protocol-level) terminate permanently — no reconnect loop. Transport-level losses are transient when a policy exists.
- **D12 — Reconnect is generation-safe.** Each wire bind gets a generation token; handlers capture it and no-op when stale; on drop, the wire's listeners are removed before scheduling a retry. A late `close` from an old wire can never kill the fresh connection or double-start the loop. Backoff = `min(maxDelay, minDelay * factor^n)` with `jitter` (±ratio), `maxAttempts`, cleared on `close()`.
- **D13 — Server passthrough.** `ViaeOptions` forwards `heartbeat`, `maxInflightRequests`, `maxStreamsPerConnection`, `maxBufferedBytes`, `protocolVersion` to each connection; `reconnect` is client-only.
- **D14 — Test determinism.** Reconnect tests force `jitter: 0` and small bounds; heartbeat tests use bounded values with fake timers where feasible, else `interval + timeout + slack`; no assertions depend on wall-clock ordering beyond bounded waits.

## Interfaces (contract sketch — keep these exact names)

```ts
// wire.ts
interface Wire { /* existing */ readonly bufferedAmount?: number; }
class WebSocketWire { get bufferedAmount(): number }

// via.ts
interface IVia { /* existing */ readonly closed: boolean; close(opts?: { drain?: boolean; drainTimeout?: number }): Promise<void>; on(event: string, cb: (...a: unknown[]) => void): void; off(event: string, cb: (...a: unknown[]) => void): void; }
interface ViaOptions {
  heartbeat?: { interval?: number; timeout?: number };
  reconnect?: { wire: () => Wire | Promise<Wire>; minDelay?: number; maxDelay?: number; factor?: number; jitter?: number; maxAttempts?: number };
  maxBufferedBytes?: number;
  maxInflightRequests?: number;
  maxStreamsPerConnection?: number;
  protocolVersion?: number;
}
class Via { get closed(): boolean; close(opts?: { drain?: boolean; drainTimeout?: number }): Promise<void>; }

// viae.ts
interface ViaeOptions { heartbeat?: ...; maxConnections?: number; maxInflightRequests?: number; maxStreamsPerConnection?: number; maxBufferedBytes?: number; protocolVersion?: number; }
class Viae { close(opts?: { drainTimeout?: number }): Promise<void>; }

// stream.ts
interface StreamOptions { maxCredit?: number; }

// codec.ts
interface FrameEncoderOptions { protocolVersion?: number; }

// status.ts
enum Status { /* existing */ Busy = 503 }
```

## Work items

### L1 — Foundations: status, wire buffer, shortId, protocol version (owner: F1)

Files: `src/status.ts`, `src/wire.ts`, `src/util.ts`, `src/codec.ts`, `src/index.ts`, `test/codec.spec.ts`, `test/util.spec.ts` (new), `test/wire.spec.ts` (new; new-test additions only — existing WebSocketWire tests stay in `test/via.spec.ts`).
1. `Status.Busy = 503`.
2. `Wire.bufferedAmount?: number`; `WebSocketWire` getter (D4).
3. `shortId` crypto scheme + fallback (D7).
4. `FrameEncoderOptions.protocolVersion` (D6): injection with copied head + `hasOwnKeys` gate; decode validation; `0` disables both.
5. Tests: emission (caller head not mutated), no injection for empty head or explicit `v`, decode accept v=1 / reject v=2 / accept absent / accept-any when `0`; golden fixture updates enumerated; `shortId` format `/^[0-9a-f]{16}$/` + 10k uniqueness + fallback path; `Status.Busy === 503`; stub-ws `bufferedAmount` (open value, closed → `Infinity`).

### L2 — Stream credit clamp + fail-fast (owner: F2)

Files: `src/stream.ts`, `test/stream-protocol.spec.ts`. Runs in parallel with L1.
1. `StreamOptions.maxCredit` (default `Infinity`; positive safe integer or `Infinity`, else `RangeError`).
2. Consumer clamps requested credit: `granted` initialization, `START`, and `PULL` desiredSize use `min(..., maxCredit)`.
3. Producer clamps incoming grants to `maxCredit`; a grant strictly greater than `maxCredit` fails fast via `failProtocol("granted credit N exceeds maxCredit M")` (error frame + source cancel) instead of silent clamp-and-hang.
4. Tests: both-sides configured → stream completes across multiple windows with chunk counts bounded by `maxCredit`; producer-only with over-granting consumer → rejected `complete` + error frame, no hang; `Infinity` default unchanged; invalid values throw.

### L3 — Via phase 1: ownership, caps, backpressure, close/drain, version passthrough (owner: F3; starts after L1 lands)

Files: `src/via.ts`, `test/via.spec.ts`.
1. Ownership claim (D8): different-Via throw; same-Via re-claim allowed (needed by L5); release on permanent close.
2. `protocolVersion` forwarded to `FrameEncoder`; extend `IVia` with `closed`/`close`/`on`/`off`.
3. Per-wire generation binding refactor: extract `_bindWire(wire, generation)`, keep handler refs, remove listeners on drop (needed by L5, harmless now) — small preparatory refactor, no behavior change without a policy.
4. `maxInflightRequests` middleware (D5) placed after `Catch`, before `IncomingStreamUpgrade`; counter in the shared cleanup path.
5. Stream counting via `_asTransport().intercept` wrapper: increment only **after** the underlying registration succeeds (a duplicate-sid throw must not leak a slot), decrement on the returned dispose; `maxStreamsPerConnection` enforcement is direction-aware per D5 — inbound request → 503 + CANCEL; inbound response → reject pending request with `ViaeError(Status.Busy)` + CANCEL; outgoing → replace response with 503 + cancel the source stream / reject request-body send.
6. `maxBufferedBytes` drain loop (D4) in the send path; control frames bypass.
7. `closed` getter; `close({drain, drainTimeout})` (D9/D10): `_closing`/`_closed` separation, drain on processing+tasks at drain time, force-abort on expiry, idempotent; intentional close emits `close` but not public `disconnect`; `drain: false` stops routing new inbound frames immediately, `drain: true` keeps processing until the bound.
8. Tests: second-Via throw + same-Via re-claim; inflight cap → 503, handler not invoked, counter recovers; stream cap inbound request → 503 + CANCEL and handler not invoked; stream cap inbound response (client direction) → pending `request()` rejects with `ViaeError(Status.Busy)` + CANCEL; duplicate-sid registration does not leak a stream slot; slots recover on completion/cancel; backpressure pauses while `bufferedAmount` high, resumed after drain, fails on close, no timers when disabled; close rejects pending, is idempotent, `closed` flips, no `disconnect` on intentional close, a pending stream read settles after drain expiry; bufferedAmount closed → `Infinity`.

### L4 — Viae server lifecycle (owner: F4; parallel with L5, after L3)

Files: `src/viae.ts`, `test/viae.spec.ts` (new).
1. Options passthrough (D13).
2. `maxConnections`: excess connection closed immediately, no Via created, logged.
3. `close({drainTimeout})` (D10): closed flag, new connections immediately closed, drain-close all current connections, `Promise.allSettled`, idempotent.
4. Tests: excess connection closed; close drains an in-flight slow request then closes; new connect after close is closed; idempotent; `Viae.close` with active streams settles within `drainTimeout`.

### L5 — Via phase 2: heartbeat + reconnect (owner: F5; same file as L3 — strictly after L3)

Files: `src/via.ts`, `test/via.spec.ts`.
1. Reserved PING/PONG absorb handling (D2) with drain-exempt control sends.
2. Heartbeat scheduler (D1): arm on open and **re-arm on every rebound wire** after reconnect, beat with unique id + scoped interceptor, timeout; any matching frame resolves; any inbound frame after the beat also counts as liveness; miss → drop path; timers/interceptors cleared on drop/close; off by default.
3. Internal `drop` event + stream transport `onClose` switch (D9).
4. Reconnect policy (D3/D11/D12): generation-safe retry loop with backoff/jitter/maxAttempts; permanent failures never retry; rebuild via factory; emit `disconnect`/`reconnected`; `ready` waiter list; `close()` disables.
5. Tests: heartbeat evicts a silent peer within `interval + timeout + slack`; responsive + legacy-404 peers stay alive ≥3 beats; an actively-sending peer is not evicted while its PONG is queued behind a saturated `maxBufferedBytes` stub; PING answered even with heartbeat off; heartbeat re-armed after reconnect; reconnect survives two forced drops, post-reconnect requests succeed; in-flight requests reject at each drop; streams abort on transient drop (pending read settles); attempts exhausted → `closed` + `ready` rejects; manual close stops retries; stale-wire close after re-bind does not kill the fresh connection; version-mismatch close does NOT trigger retry; no timer/listener leaks after close (assert listener counts on the stub wires).

### L6 — Integration e2e + docs (owner: F6; after L1–L5)

Files: `test/lifecycle.spec.ts` (new), `README.md`.
1. e2e: heartbeat eviction over real socket vs a swallow-noop peer; reconnect over a controllable factory; `Viae.close` drain with slow handler; maxConnections; backpressure stub; version mismatch closes; `protocolVersion: 0` interoperates with default peers; multi-Via throw; `maxCredit` end-to-end past multiple windows **with both peers configured** (plus the mismatch fail-fast case).
2. README: options tables (`heartbeat`, `reconnect`, caps, `maxBufferedBytes`, `protocolVersion`), `close()`/`closed`, `Status.Busy`, ownership rule, legacy compatibility notes (PING answered; `v` absent accepted; empty-head frames carry no `v`), and a prominent note that `maxCredit` must be configured on **both** peers — server-only configuration immediately fails default clients' streams on their first (32-credit) START.
3. Full verification: `npm test`, `npm run build`, `npx tsc --noEmit -p tsconfig.json`, `npm run test:coverage`, benches, `git status --porcelain`.

### L7 — Closure (owner: Atlas)

Acceptance verification, status/archive, index update, final report. No commit.

## Dependencies

- L1 → L3 (status/codec types). L2 runs parallel with L1. L3 → L5 (same file). L3 → L4 (close contract). L4 and L5 may run in parallel (different files). L6 after L1–L5.
- Non-plan prerequisite: hardening plan complete (met).

## Acceptance criteria

1. All existing tests remain green except the deliberately enumerated version-field fixture/head-shape updates (D6) and new-behavior tests; every assertion is falsifiable (no vacuous tests).
2. `npm run build` and `npx tsc --noEmit -p tsconfig.json` clean; `npm test` green; `npm run test:coverage` runs with overall statements ≥ 93% and no source file below 85% statements.
3. Heartbeat: silent peer evicted within `interval + timeout` + slack; responsive and legacy-404 peers stay alive; works with a saturated `maxBufferedBytes` wire; off by default; no timer/interceptor leaks after close.
4. Reconnect: survives ≥2 forced drops; in-flight requests reject per drop, no replay; `ready` resolves after reconnect and rejects on permanent closure; attempts exhausted and manual close stop retries; permanent protocol failures never retry; stale-wire events cannot kill the new connection.
5. Drain: `Viae.close`/`Via.close` wait for in-flight handlers (not just tasks) within the bound, then close; over-timeout force-close settles pending stream reads; idempotent; new connections refused after `Viae.close`.
6. Backpressure: outbound sends pause while `bufferedAmount` exceeds `maxBufferedBytes` and resume after drain; a close during drain fails the send; disabled → no timers, unchanged behavior; control frames bypass.
7. Caps: over-cap requests get 503 without handler invocation; stream cap recoverable after completion/cancel; excess connections closed; `maxCredit` consistent on both roles and fails fast on mismatched over-grant.
8. Version: default `v: 1` emitted on non-empty heads only; mismatched major fails permanently with a clear error; `0` disables emission+validation; legacy and empty-head frames interoperate; caller heads are never mutated.
9. `shortId` crypto-backed with fallback; different-Via-on-wire throws, same-Via reconnect re-claims; README documents all new behavior/defaults.
10. No wire-format break for peers that ignore unknown head keys.

## Verification

- `npm test`; `npm run build`; `npx tsc --noEmit -p tsconfig.json`.
- `npm run test:coverage` (record numbers against the thresholds in AC2).
- `npm run bench` / `npm run bench:stream` (record; no material regression).
- `test/lifecycle.spec.ts` + targeted specs per unit.
- Atlas final pass: frozen-tree run, diff scope, evidence recorded.

## Risks and mitigations

- **R1 Version field changes fixtures/head shape.** Gated on non-empty heads; decode retains `v`; affected tests enumerated; `0` opt-out covered.
- **R2 Heartbeat false evictions.** Opt-in, generous defaults, drain-exempt control path, reserved-method exempt from caps; bounded tests.
- **R3 Reconnect storms/leaks/stale wires.** Generation tokens, listener teardown, jittered bounded backoff, maxAttempts, permanent-failure classification, leak assertions.
- **R4 Drain deadlocks.** Processing+tasks-at-drain-time accounting, bounded by `drainTimeout`, force-abort path tested.
- **R5 Backpressure timers/poll loops.** Only armed when enabled; exits on drain/close; control frames exempt; close-during-drain test.
- **R6 maxCredit misconfiguration.** Both-role clamp + fail-fast on over-grant; documented both-peers requirement; mismatch test.
- **R7 Multi-Via throw breaking users.** Recorded bug-pattern fix; clear message; README note.
- **R8 Cap 503 reachability.** Middleware placement pinned after `Catch` (inside `After`'s wrap); tested that the 503 is emitted and the handler is not invoked.

## Verification evidence (Atlas, frozen tree, 2026-10-05)

All workstreams L1–L6 landed; final runs performed by Atlas:

- `npm test` → **231 pass / 0 fail** (32+ suites, ~7.3 s); baseline 164 → **+67 net-new tests** across L1–L6 plus the closure log test.
- `npm run build` → exit 0; `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npm run test:coverage` → **96.75% stmts / 83.84% branch / 95.26% funcs / 96.75% lines**; `src/log.ts` 100% (closure fix below); all files within the AC2 thresholds (overall ≥ 93%, no file below 85%).
- `npm run bench` → FrameEncoder hot path: header encode 1.90M ops/s, encodeOwned 1.14M, decode 1.39M; 64 B payload 1.04M / 696.8k / 624.8k.
- `npm run bench:stream` → 1 KiB–1 MiB: encode 767–4200 MiB/s; pump 70–2031 MiB/s.
- `git status --porcelain` → scoped files only (`src/*` modules, specs, `README.md`, `.opencode/`); no stray artifacts; no commits.

Acceptance criteria evidence:

1. Existing tests green with only the enumerated deliberate version-field fixture/head-shape updates (L1 report); no vacuous tests (L4/L5/L6 bounded waits fail explicitly; hardening round earlier removed the cannot-fail pair).
2. Build/typecheck clean; coverage thresholds met (above).
3. Heartbeat: silent-peer eviction within `interval + timeout` (L5 unit + L6 real-socket), responsive/legacy-404 peers alive ≥3 beats, saturated-buffer bidirectional liveness + PING/PONG drain bypass, PING answered with heartbeat off, off by default, listener/timer leak probe (L5).
4. Reconnect: two forced drops with per-drop rejection + `ready`/`reconnected`/heartbeat re-arm (L5 + L6 socket), stream abort on transient drop, attempts-exhausted → `closed` + `ready` rejects, manual close stops retries, stale-wire events ignored, version/decode failures never retry.
5. Drain: `Viae.close` waits for in-flight handlers (L4 unit + L6 two-connection socket test), over-timeout stream reads settle, idempotent, post-close connections refused.
6. Backpressure: pause/resume, close-during-drain failure, disabled arms no timers, control frames bypass (L3/L5; L6 documented why the socket-level duplicate is weaker than the stub-level suite).
7. Caps: 503 without handler invocation, direction-aware stream caps incl. client-side response rejection with `ViaeError(Busy)`, slot recovery, duplicate-sid no leak, `maxConnections` refusal, `maxCredit` both-role clamp + fail-fast mismatch.
8. Version: default `v: 1` on non-empty heads only, mismatched major permanent close, `0` opt-out round-trip, legacy v-less frame accepted, caller heads never mutated.
9. `shortId` 16-hex crypto + fallback; multi-`Via`-on-wire throws (L3); README documents all options/defaults/events/ownership/`Status.Busy`/legacy compatibility and the both-peers `maxCredit` requirement (L6).
10. No wire-format break for peers ignoring unknown head keys; fixtures updated deliberately.

Closure fix (recorded): `src/log.ts` was the only file below the AC2 per-file bar (81.25%, pre-existing, untouched by this plan). `makeLogFn` was exported and covered by a new `test/log.spec.ts` (4 tests) instead of weakening the threshold; now 100%.

Recorded deviations: `drainTimeout` is validated as a non-negative safe integer (stricter than the plan's "non-negative finite"); L6 skipped socket-level duplicates of backpressure/`maxConnections` with justification (stub/socket coverage already stronger); a request whose frame had not yet reached the wire at drop time rejects with `"wire is not open"` rather than the drop reason (pre-existing send-path nuance, asserted in L5 tests).

## Run registry

| Unit | Conductor session | Status | Scope |
|---|---|---|---|
| L1 / F1 | ses_ef244bf69ffe1ky0wljlos7Qxz | COMPLETE | status/wire/util/codec + specs |
| L2 / F2 | ses_ef244bf67ffeauUWnMJu3i9BBo | COMPLETE | stream maxCredit |
| L3 / F3 | ses_ef23f3039ffeC0VMd6m53xbVH5 | COMPLETE | via phase 1 |
| L4 / F4 | ses_ef2331fffffeeI6pWUR1EYwpxM | COMPLETE | viae lifecycle |
| L5 / F5 | ses_ef2331ffeffeUrg5RWJ9XBYM4s | COMPLETE | via phase 2 |
| L6 / F6 | ses_ef2216074ffeHG6gHjd5BmXZuV | COMPLETE | e2e + docs |
| L7 / Atlas | this session | COMPLETE | closure |

## Change log

- 2026-10-05: created as the DRAFT queue for architectural lifecycle features deferred by PLAN-VIAE-BETA-HARDENING (decisions D10/D11/D13).
- 2026-10-05: fleshed out into an executable plan (D1–D11, work items L1–L7).
- 2026-10-05: critic round 1; revised to D1–D14 resolving 1 CRITICAL + 7 MAJOR findings (credit desync, drop/stream-abort contract, close idempotency, drain accounting, outbound-cap path, permanent-vs-transient retry, stale-wire generations, heartbeat vs backpressure) plus MEDIUM plan contradictions.
- 2026-10-05: critic round 2; remaining blocking item (direction-aware `maxStreamsPerConnection` enforcement for client-side response streams) fixed in D5/L3.5/L3.8; minor clarifications folded (bidirectional heartbeat liveness, terminate dedupe ordering, validation ranges/precedence, counter leak edge, close/disconnect semantics, heartbeat re-arm). Verdict: READY. Activated for execution.
- 2026-10-05: L1–L6 executed and verified (231 tests, build/typecheck clean, coverage 96.75%, bench recorded); closure log fix brought `src/log.ts` to 100%; AC1–AC10 evidenced; status set COMPLETE; archived.
