# Viae beta hardening: security, recovery, feature, performance and test gaps

## Plan header

- Plan ID: `PLAN-VIAE-BETA-HARDENING`
- Title: Viae beta hardening: security, recovery, feature, performance and test gaps
- Status: `ARCHIVED`
- Scope: Close surgical security, recovery, feature, performance and testing gaps in the viae library (3.0.0-beta.5, branch major-rework) with regression tests, without breaking wire format or public API compatibility.
- Plan dependencies: None
- Created: 2026-10-05
- Last updated: 2026-10-05

## Objective

A five-dimension second opinion (feature, testing, performance, recovery, security) was performed against `src/` at commit `be93490`. This plan closes every surgical gap found whose fix is contained, reversible and wire-compatible: decoder amplification DoS, sync-throw process crashes, terminal wire-error handling, unbounded resource defaults, duplicate-id stream hijack, documented-behavior bugs, hot-path performance issues, and false-confidence tests. Architectural features (keepalive, reconnect, drain, wire backpressure, version negotiation, concurrency caps) are queued in `PLAN-VIAE-CONNECTION-LIFECYCLE` (DRAFT).

Baseline evidence (2026-10-05): `npm test` 110/110 pass; `npm run bench` runs (measures a bespoke codec, not the shipped FrameEncoder).

## Scope and out of scope

**In scope (this run):**

- Security: cbor-x decoder size limits; default max frame size; codex prototype-chain lookup; internal-error message leakage; duplicate stream id / interceptor overwrite; finite inbound stream queue defaults with raw-size accounting.
- Recovery: sync-throw containment in `Via._onMessage`; terminal wire `error` semantics (reject pending, abort streams, idempotent); request timeout/rejection cancels outbound stream bodies; response `asyncDispose` cancels unconsumed streams; outgoing stream failures surface via rejected `complete`; throwing listeners no longer create unhandled rejections; `WebSocketWire.connect` cleanup; optional producer idle timeout.
- Feature bugs vs README: guard-thrown `ViaeError` maps to its status; `ctx.reply(..., { status })` preserved; `next: false` respected; client `accept` becomes a validated assertion; request `encoding` propagates to bodyless streaming responses.
- Performance: lazy frame pool; `encodeOwned` on all outbound frames; `hasOwnKeys`; ASCII fast path in `readStr`; reused raw descriptor; JSON codec singletons; `_active` swap-remove; `BlockingQueue` head-index + stored sizes; `normalisePath` regex hoist + fast path; router async cleanup.
- Testing: rewrite two cannot-fail tests, add regression tests per fix, add real-FrameEncoder bench section, add `test:coverage` script, add cross-cutting e2e spec.
- Docs: README updated for changed defaults/behaviors and documented contracts.

**Out of scope (queued):** keepalive/ping-pong, reconnection, graceful shutdown/drain API, wire send backpressure/silent-loss recovery beyond error surfacing, connection/inflight caps, protocol version negotiation, producer-idle default-enabled, shortId hardening. These are tracked as work items in `PLAN-VIAE-CONNECTION-LIFECYCLE` (DRAFT). No publishing, no commits, no dependency changes.

## Dependencies

- Plan dependencies: None.
- Non-plan requirements: clean working tree at `be93490`; `npm test` green before changes (confirmed).

## Decisions (Atlas)

- D1 — Default `maxFrameSize` becomes 64 MiB (was unlimited) as defense in depth; opt-out remains `frameOptions.maxFrameSize = Number.MAX_SAFE_INTEGER`. Renegotiation type: hardening.
- D2 — Call cbor-x `setSizeLimits({ maxArraySize: 1_000_000, maxMapSize: 100_000, maxObjectSize: 100_000 })` once at codec module load. Process-global side effect, documented in code + README.
- D3 — Inbound stream queue defaults become 1024 chunks / 64 MiB (`Infinity` still accepted as explicit opt-out). Queue byte accounting uses the raw encoded data segment length as proxy when a decoded chunk is not binary.
- D4 — `Interceptor.intercept` throws on a duplicate id; `IncomingStreamUpgrade` drops such frames; dispose is identity-checked. `shortId` left unchanged (predictability no longer enables overwrite).
- D5 — `Catch` maps `ViaeError` to its status/message; unexpected errors return `500 "internal error"` to the peer, full detail logged locally.
- D6 — Request timeout/rejection cancels any in-flight outbound stream body; `RequestResponse[Symbol.asyncDispose]` cancels an unconsumed response stream before disposal.
- D7 — Wire `error` is terminal: rejects pending requests, aborts streams, idempotent with `close`; internal `_ev` emits are exception-safe.
- D8 — Client `accept` on `via.request` becomes a validated assertion only when explicitly provided (explicit mismatch rejects; default behavior unchanged).
- D9 — Response stream chunk encoding falls back to the request's `head.encoding` when the reply sets none (covers the README bodyless binary example).
- D10 — `producerIdleTimeout` added as an opt-in stream option (default `0` = disabled) to preserve the documented indefinite-backpressure contract; default-enabled deferred to the lifecycle plan.
- D11 — Architectural lifecycle features queued in `PLAN-VIAE-CONNECTION-LIFECYCLE` (DRAFT).
- D12 — Lazy stream `validate` (per-chunk, no 400 for forwarded streams) and stringified cancel/error reasons are documented contracts, not code changes.
- D13 — Power-of-two internal choices (queue 1024/64 MiB, frame 64 MiB, cbor 1M) are the recorded hardening defaults.
- D14 — All outbound frames use `encodeOwned` (remove pooled+slice double copy); pool allocated lazily on first `encode()`.
- D15 — Bench gains a real-FrameEncoder section; the legacy parallel-universe bench is preserved.

## Work items

### W1 — Codec hardening + hot path (owner: C1)

Files: `src/codec.ts`, `test/codec.spec.ts`, `bench/codec.bench.ts`.

1. cbor-x size limits at module load (D2).
2. `FrameEncoder.DEFAULT_MAX_FRAME_SIZE = 64 * 1024 * 1024` (D1) with doc comment + opt-out note.
3. Lazy `_pool` allocation on first `encode()`.
4. `hasOwnKeys` helper replacing `Object.keys().length` in `_prepare`.
5. ASCII fast path in `readStr`.
6. Reused property descriptor for non-enumerable `raw`.
7. Module-level JSON `TextEncoder`/`TextDecoder` singletons.
8. Tests: cbor amplification frame `9a 00 1e 84 80` rejects (≤1M limit); normal arrays/objects still round-trip; default frame size constant pinned; `maxFrameSize: 0` throws; empty-head encode unchanged.
9. Bench: add "FrameEncoder (library hot path)" section measuring `encode`, `encodeOwned`, `decode` for header-only request + 64 B CBOR payload.

### W2 — Via lifecycle, dispatch, error semantics (owner: C2)

Files: `src/via.ts`, `src/interceptor.ts`, `src/context.ts`, `src/wire.ts`, `test/via.spec.ts`.

1. `_onMessage`: try/catch around `this.process(ctx)`; sync throw → log, exception-safe `error` emit, `_active` cleanup, ctx dispose; explicit `msg.raw` assignment instead of conditional spread.
2. Terminal wire handling (D7): single idempotent `_terminate(err?)` shared by `close`/`error`; on `error` reject pending with the error and abort streams; `_safeEmit` helper for internal events.
3. `Send` middleware: `encodeOwned` for every frame (D14).
4. `_active` index tracking + swap-remove (order becomes unspecified; comment it).
5. `request()`: `accept` assertion (D8); cancel outbound body on rejection/timeout via `_outgoing` map + optional `ContextTask.cancel`; `asyncDispose` cancels unconsumed response stream (D6).
6. `Catch`: `ViaeError` → own status/message; other errors → `500 "internal error"` (D5, import from `./error.js`).
7. `IncomingStreamUpgrade`: catch duplicate-id registration and drop the frame (D4).
8. `OutgoingStreamUpgrade`: encoding fallback `out.head.encoding ?? in.head.encoding ?? opts.encoding` (D9); register `cancel` task capability.
9. `Interceptor`: throw on duplicate id; identity-checked dispose (D4).
10. `context.ts`: optional `cancel?` on `ContextTask`; cached `complete` promise.
11. `wire.ts`: `connect()` closes the socket on error/close; `send` surfaces ws-lib callback errors (verify empirically for `ws` and global WebSocket).
12. Tests: sync-throw middleware (no crash, later traffic works); wire `error` rejects pending + aborts stream; duplicate-sid frame cannot overwrite a pending request interceptor; generic error → `500 "internal error"`; request timeout rejects outbound stream + removes interceptor; `asyncDispose` cancels response stream; `connect()` coverage (open + refused); throwing error listener does not crash.

### W3 — Api/router correctness + routing hot path (owner: C3)

Files: `src/api.ts`, `src/router.ts`, `src/normalise.ts`, `test/api.spec.ts`, `test/router.spec.ts` (new).

1. Reply status preserved: set `200` before handler for non-`next` routes; remove post-handler assignment.
2. `isNext = opts.next === true`.
3. Number param coercion rejects non-finite (`Infinity`, `0x10`→16 stays? — decision: reject if `!Number.isFinite(Number(raw))`; hex parses finite and is accepted as today, only non-finite rejected).
4. Stream duck-typing requires `typeof getReader === "function"` (both `api.ts` and note for C2's `via.ts` helper).
5. `normalise.ts`: hoist regex, skip replace when no `//`.
6. `router.ts`: replace `.then/.catch` chain with `async` + `try/finally` (same behavior).
7. Tests: `ctx.reply("A",{status:201})` + return `"B"` → status 201, data `"B"`; `next:false` gets no `next` and responds 200; `next:true` falls through to a second route; `throw 403` numeric; `Number` param `/Infinity` → 400; duck-typed object with non-function `getReader` rejected as 400.
8. `test/router.spec.ts`: `normalisePath` cases (empty, leading, trailing, duplicate slashes, fast path); direct router end/method/prefix plus path restoration after a throwing middleware; `matchedPath` value.

### W4 — Stream resource bounds, cancellation, failure surfacing (owner: C4)

Files: `src/stream.ts`, `test/stream-protocol.spec.ts`, `test/stream.spec.ts`.

1. Defaults 1024 chunks / 64 MiB with `Infinity` opt-out; docs updated (D3).
2. `BlockingQueue` stores `{ value, size }` with head index + compaction; `push(chunk, size)`; size proxy = binary `byteLength`, else `msg.raw?.byteLength ?? 1`.
3. `StreamSender.cancel(reason?)` implemented + exported (D6): stops pump, cancels reader, best-effort CANCEL frame.
4. `producerIdleTimeout` option (default 0): armed after first credit; reset on successful chunk send and credit updates; fires into the protocol-error path (D10).
5. Outgoing `complete` rejects after best-effort error/CANCEL notification on source/send/protocol errors (consumer CANCEL stays a clean resolve).
6. Rewrite the two cannot-fail tests to assert observables (`viae.connections` empty after close; post-close read settles within a failing-on-timeout bound); fix `withTimeout` timer leak.
7. New tests: default chunk cap abort (1025th chunk); `maxQueuedChunks: 0` unsolicited-chunk abort; `producerIdleTimeout` fires; `sender.cancel` settles + emits CANCEL; `complete` rejects on source error; option validation RangeErrors (`idleTimeout: -1`, `highWaterMark: NaN`, `maxQueuedChunks: 1.5`).
8. Keep `strictProtocol` / timeouts defaults unchanged.

### W5 — Cross-cutting regression e2e + tooling + docs (owner: C5, runs after C1–C4)

Files: `test/hardening.spec.ts` (new), `test/utils.ts`, `package.json`, `README.md`, `.mocharc.json` (delete).

1. e2e: guard-thrown `ViaeError` → 401/403 (D5); frameOptions `maxFrameSize` plumbing closes wire on oversized frame (D1); custom codex e2e; `before()` ordering; sync-throwing `before` doesn't crash; bodyless binary GET stream chunks carry `encoding: "binary"` (D9); client `accept` mismatch rejects (D8); interleaved multi-stream reads have no cross-talk.
2. `test/utils.ts`: deterministic close helper if needed; keep noop logging behavior.
3. `package.json`: add `"test:coverage": "c8 --reporter=text --reporter=lcov npm test"`; run once, record numbers.
4. `README.md`: new secure defaults + opt-outs; `streamOptions` in option tables; `accept` assertion semantics; `ViaeError` vs generic internal error; Rowan peer-dependency note; lazy stream validate + string reason contracts (D12).
5. Delete stale `.mocharc.json` (suite is node:test).
6. Final: `npm test`, `npm run build`, `npm run bench`, `npm run bench:stream`; record results.

### W6 — Plan closure (owner: Atlas)

Mark statuses, update index, record evidence, final report. No commit.

## Dependencies

- W5 depends on W1–W4 landing.
- W2/W4 share the `StreamSender.cancel` contract (optional call on the Via side; implemented in stream.ts).
- All other work items are independent by file ownership.

## Acceptance criteria

1. All pre-existing tests still pass except the two rewritten cannot-fail tests and the outgoing-complete test, which are deliberately strengthened (recorded here); no test in the suite can pass without its assertions.
2. `npm run build` completes clean; `npm test` green including ≥ 20 new regression tests.
3. Security regressions are covered by named tests: cbor amplification rejected; >maxFrame default rejected; duplicate-sid hijack blocked; `encoding: "constructor"` rejected; queue cap enforced.
4. Recovery regressions are covered: sync throw no crash; wire error rejects pending/streams; timeout cancels outbound body; streaming dispose cancels reader.
5. Feature bugs fixed and pinned: guard `ViaeError`, reply status, `next:false`, accept assertion, request-encoding propagation.
6. Perf changes present (lazy pool, encodeOwned, hasOwnKeys, ASCII id path, swap-remove, head-index queue, normalise fast path) with bench section for the real `FrameEncoder`.
7. Coverage script runs and numbers are recorded; README reflects changed behavior; `PLAN-VIAE-CONNECTION-LIFECYCLE` exists as DRAFT.

## Verification

- `npm test` — full node:test suite (baseline 110 pass).
- `npm run build` — `tsc --build tsconfig.build.json`.
- `npm run bench` / `npm run bench:stream` — codec + stream benchmarks; record output.
- `npm run test:coverage` — c8 report; record summary.
- Targeted: each conductor runs its spec file(s) plus the full suite before reporting.
- Manual spot-check by Atlas of acceptance evidence + `git status`/diff scope at close.

## Deferred work (queued)

Tracked in `PLAN-VIAE-CONNECTION-LIFECYCLE` (DRAFT): keepalive/ping-pong, reconnection, graceful shutdown/drain, wire backpressure + silent-send loss, connection/inflight caps, protocol version negotiation, producer-idle default, shortId hardening, stream validate 400 mapping, multiple-Via-per-wire ownership.

## Run registry

| Unit | Conductor session | Status | Scope |
|---|---|---|---|
| W1 / C1 | ses_ef2851441ffeesoejvLfs81ueD | COMPLETE | codec + codec.spec + codec.bench |
| W2 / C2 | ses_ef2851440ffes34QWfxrifL0KI | COMPLETE | via/interceptor/context/wire + via.spec |
| W3 / C3 | ses_ef285143fffeUJovcomfwte3b7 | COMPLETE | api/router/normalise + api.spec + router.spec |
| W4 / C4 | ses_ef2851437ffejA7DkuRkiKjhPx | COMPLETE | stream + stream specs |
| W5 / C5 | ses_ef276b927ffeAFOKbm6iGDZMje | COMPLETE | hardening e2e + tooling + README |
| W6 / Atlas | this session | COMPLETE | closure + evidence + report |

## Verification evidence (Atlas, frozen tree, 2026-10-05)

All workstreams landed; final run performed by Atlas independently:

- `npm test` → **164 pass / 0 fail** (22 suites, ~6.2 s); baseline 110 → **+54 net-new tests**, zero failures.
- `npm run build` → exit 0; `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npm run bench` → real `FrameEncoder` section: header-only encode 1.85M ops/s, encodeOwned 1.28M, decode 1.55M; 64 B CBOR payload 1.11M / 723.5k / 662.3k; legacy section preserved.
- `npm run bench:stream` → runs (frame encode 829–4442 MiB/s; stream pump 88–2107 MiB/s, 1 KiB–1 MiB chunks).
- `npm run test:coverage` (c8) → **95.59% stmts / 83.01% branch / 92.81% funcs / 95.59% lines**; via.ts 99.45%, codec.ts 97.19%, router.ts 98.61%, stream.ts 91.97% statements.
- `git status --porcelain` → exactly the scoped files: 9 src modules, 5 modified specs + `test/router.spec.ts` + `test/hardening.spec.ts` new, `README.md`, `package.json`, `bench/codec.bench.ts`, `.mocharc.json` deleted; no stray artifacts; no commits.

Acceptance criteria evidence:

1. Cannot-fail tests rewritten to falsifiable assertions (stream-protocol close/start-timeout recovery; `withTimeout` leak fixed); full suite green — 164/164.
2. Build + typecheck clean; 54 net-new tests.
3. Security: cbor amplification rejects (`codec.spec` hardening block); default 64 MiB frame cap pinned + plumbing closes wire (`codec.spec`, `hardening.spec`); duplicate-sid hijack blocked (`via.spec`); `encoding: "constructor"/"__proto__"/...` rejects (`codec.spec` AC3 block); queue cap aborts 1025th chunk (`stream-protocol.spec`).
4. Recovery: sync throw contained (`via.spec`); wire `error` rejects pending + aborts streams (`via.spec`); timeout cancels outbound body and normal completion does not (`via.spec`); `asyncDispose` cancels response stream (`via.spec`).
5. Features: guard `ViaeError` → 403 / generic → 500 "internal error" (`hardening.spec`); reply status 201 preserved; `next:false`; non-finite Number params; `accept` assertions; bodyless binary chunk encoding (`hardening.spec` D9).
6. Perf markers verified in source: lazy pool, `encodeOwned` in `Send`, `hasOwnKeys`, ASCII `readStr`, swap-remove `_active`, head-index `BlockingQueue`, normalise fast path; bench measures the real `FrameEncoder`.
7. Coverage script added and run; README updated for defaults/contracts; `PLAN-VIAE-CONNECTION-LIFECYCLE` exists as DRAFT.

Deliberate semantics changes recorded: outgoing stream `complete` now rejects on source/send/protocol errors (start-timeout, zero-credit stall, malformed-credit strict tests aligned); generic server errors no longer echo internal messages; finite stream queue defaults replace historical `Infinity` (opt-out preserved).

## Change log

- 2026-10-05: created from five-dimension second-opinion sweep; decisions D1–D15 recorded; work items W1–W6 opened.
- 2026-10-05: W1–W5 completed and verified (164 tests, build/typecheck clean, coverage 95.59%); AC1–AC7 evidenced above; status set COMPLETE; archived.
