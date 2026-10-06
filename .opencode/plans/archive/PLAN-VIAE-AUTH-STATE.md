# Viae connection auth state: expose upgrade identity through Wire/Via

## Plan header

- Plan ID: `PLAN-VIAE-AUTH-STATE`
- Title: Viae connection auth state: expose upgrade identity through Wire/Via
- Status: `ARCHIVED`
- Scope: Add a minimal, transport-agnostic connection state/claims channel (adapter-provided on `Wire`, surfaced on `Via`/`ctx.connection`), upgrade metadata passthrough, and close-with-code/reason for auth rejections — no auth logic inside viae.
- Plan dependencies: None
- Created: 2026-10-06
- Last updated: 2026-10-06

## Objective

Connection-time auth is the primary gate and is delegated to the developer's `WireServer` adapter (HTTP upgrade semantics). What's missing is a way for the identity established at the upgrade to reach viae handlers. This plan adds one opaque state slot, upgrade metadata, and clean rejection codes; it deliberately does not implement sessions/JWT/cookies/revocation.

**Revision note:** critic rounds 1–2 findings resolved — typing story made honest (no half-generic), state resolution made presence-based, snapshot/mutation contract pinned, `upgrade` made readonly/wrap-only, per-argument `close` forwarding + first-wins documented, coverage gate declared manual, test placement moved to a dedicated spec, and the missing tests enumerated. Revocation/expiry confirmed as an explicitly user-land concern to be documented (user direction, 2026-10-06).

## Scope and out of scope

**In scope:**
- `Wire.state?: unknown` — adapter-set, opaque to viae (mutable before handoff; documented contract).
- `Wire.upgrade` — **readonly**, set only via `WebSocketWire.wrap(ws, upgrade?)`; opaque transport metadata (e.g. the `ws` `req`). Server-side only; `connect()` does not set it.
- `Wire.close(code?, reason?)` — per-argument passthrough.
- `ViaOptions.state?: unknown`, `Via.state: unknown` (readonly snapshot), `IVia.state: unknown`.
- README auth section + options row; AGENTS.md consumer notes; revocation intent documented as user-land.
- Tests in `test/wire.spec.ts`, `test/via.spec.ts`, and a new `test/auth-state.spec.ts` (adapter e2e).

**Out of scope:** auth helpers (JWT/session/cookie parsing), `ViaeOptions.state` factory, typed state threading through `Context`/`Api` generics, revocation/expiry machinery, close-code propagation via `Via.close` (lifecycle drain close).

## Decisions (Atlas)

- **D1 — One opaque state slot; viae never interprets it.** `Wire.state` is set by the adapter (or passed as `ViaOptions.state` for direct construction). `Via.state` is a construction-time snapshot resolved by **presence**: `Object.hasOwn(opts, "state") ? opts.state : wire.state` — so an explicit `state: undefined` overrides a non-undefined `wire.state`. **Contract:** state must be set before the connection callback / `Via` construction; later `wire.state` mutations are ignored by `Via` (documented and tested). No `Via<S>` generic — `state` is `unknown` end-to-end; consumers narrow/cast once. Typed threading through `Context`/`Api` is deferred. `IVia.state` stays optional (`readonly state?: unknown`) to preserve structural compatibility for external mocks; `Via` declares it required.
- **D2 — Upgrade metadata is opaque, readonly, wrap-only.** `WebSocketWire.wrap(ws, upgrade?)` stores the second argument (e.g. `req`); `Wire.upgrade` is `readonly` in the interface. `connect()` cannot set it (a client has no upgrade request). Never read by viae internals.
- **D3 — Close code/reason are additive and per-argument.** `Wire.close(code?, reason?)`; `WebSocketWire` forwards as: both provided → `close(code, reason)`; only code → `close(code)`; only reason → `close(undefined, reason)`; neither → `close()`. The existing CLOSING guard means **first close wins**; subsequent calls while CLOSING are no-ops (documented). Docs recommend `1008` (policy violation) or application codes in `4000-4999` (e.g. `4401`) for server rejections; browsers may only *send* `1000`/`3000-4999` but receive any code. Note for docs: RFC 6455 close bodies require a status code, so transports (including `ws`) drop a reason sent without a code — always pass a code with a reason; `ws` also throws synchronously for out-of-range codes (viae does not validate or rewrite codes).
- **D4 — No `ViaeOptions.state` factory in this scope.** The adapter owns admission and sets `wire.state` before the callback; `Viae` does not forward a state override (documented). A viae-side admission factory is deferred.
- **D5 — No auth logic, no cookie parsing, no per-request token smuggling.** README/AGENTS examples stop encouraging `head.token` for connection identity; guards read `ctx.connection.state`.
- **D6 — Revocation and expiry are explicitly user-land (user direction).** WebSocket connections are stateful by design; viae provides no revocation machinery. Documentation states the intent and recommended patterns: (a) re-validate claims per request in guards against the authoritative store / an expiry timestamp in the claims (a snapshot cannot detect revocation by itself), optionally scheduling `wire.close` at expiry; (b) drop a connection with `via.close()` or `wire.close(1008|4401, reason)`; (c) sweep `Viae.connections`, inspect `via.state`, close revoked sessions; (d) on client reconnect, a fresh handshake re-authenticates server-side (new handshake → new `Via` → fresh `wire.state`), while the client's `Via.state` is developer-supplied and does **not** refresh on rebind — refresh by mutating the shared state object or constructing a new `Via`; reconnecting alone does not refresh `via.state`. No code for any of this beyond what already exists.

## Interfaces (contract sketch)

```ts
// wire.ts
interface Wire {
  /* ...existing... */
  /** Adapter-provided per-connection state (claims, grants). Opaque to viae.
   *  Set before handoff; later mutations are ignored by Via's snapshot. */
  state?: unknown;
  /** Adapter-provided upgrade metadata (e.g. the `ws` request). Opaque to viae. */
  readonly upgrade?: unknown;
  close(code?: number, reason?: string): void;
}
class WebSocketWire {
  static wrap(ws: WebSocket, upgrade?: unknown): WebSocketWire;
}

// via.ts
interface ViaOptions { /* ...existing... */ state?: unknown; }
class Via extends Rowan<Context> implements IVia {
  readonly state: unknown;
}
interface IVia { /* ...existing... */ readonly state?: unknown; }
```

## Work items

### A1 — Wire surface (owner: G1)

Files: `src/wire.ts`, `test/wire.spec.ts`.
1. `Wire.state?: unknown` (mutable optional, documented contract) and `readonly upgrade?: unknown`.
2. `WebSocketWire`: private `_upgrade` + getter; `wrap(ws, upgrade?)` sets it.
3. `close(code?, reason?)` with per-argument forwarding and the existing CLOSING guard (first close wins).
4. Tests: wrap-with-upgrade exposes it; `connect()` wires have no upgrade; stub ws records `close()` args for all four call shapes; second close while CLOSING is suppressed (first code retained) — the stub must transition to `CLOSING` on the first close to mirror real `ws`; `state` absent by default; an `@ts-expect-error` assignment in the spec proves `upgrade` is getter-only under `tsc`.

### A2 — Via state (owner: G1)

Files: `src/via.ts`, `test/via.spec.ts`.
1. `ViaOptions.state?: unknown`; `Via.state: unknown` readonly snapshot resolved by presence (`Object.hasOwn(opts, "state") ? opts.state : wire.state`); `IVia.state?: unknown` (optional for external mocks; `Via` declares it required).
2. No changes to lifecycle/heartbeat/reconnect/drain/caps/ownership logic.
3. Tests: direct `state` option; fallback to `wire.state`; explicit `state: undefined` overrides a set `wire.state`; absent both → `undefined`; a handler reaches the identical value via `ctx.connection.state` in a fake-wire round trip; a post-construction `wire.state` mutation does not change `via.state`; snapshot is stable across a reconnect rebind (existing fake `reconnect.wire` pattern); `viae.connections[0].state` equals the adapter-set claims (Viae-level test).

### A3 — Adapter e2e + docs (owner: G2, after A1/A2)

Files: `test/auth-state.spec.ts` (new), `README.md`, `AGENTS.md`.
1. `test/auth-state.spec.ts`: custom `WireServer` wrapper that authenticates before handoff — sets `wire.state = claims` and only calls the connection callback when authorized. The upgrade-passthrough assertion owns a raw `http.Server` + `WebSocketServer` (TestWireServer wraps internally without the request); the state/rejection e2e can wrap TestWireServer. Assert: a route handler reads the claims via `ctx.connection.state`; a rejected wire never produces a `Via`/`connection` event, asserted with a bounded negative wait (deadline that fails the test only if an event appears); `wire.upgrade` survives to the adapter via `wrap(ws, req)`.
2. README: new `### Connection state & auth` subsection documenting the two-layer model (adapter gate + per-request guards), `wire.state`/`Via.state`/`ctx.connection.state`, the pre-handoff mutation contract, `wire.close(code, reason)` rejection, upgrade passthrough, and the **revocation/expiry user-land intent** with the four recommended patterns from D6. Security notes: Origin allowlist (WS handshakes bypass CORS), cookie `SameSite` limitations, tokens in query strings leak to logs/proxies, Node clients can send `Authorization` while browsers cannot, reconnect re-authenticates server-side per handshake (new handshake → new `Via` → fresh `wire.state`) while the client's `Via.state` does not refresh on rebind. Add `state`/`upgrade` to the Via options/wire docs and a note that `head` is not the place for connection identity.
3. AGENTS.md: consumer bullets — claims channel (`wire.state` → `ctx.connection.state`), `wire.close(code, reason)` rejection pattern, revocation is user-land (recheck/drop/sweep), reconnect re-auth, no cookies/JWT in viae.

### A4 — Verification + closure (owner: Atlas)

`npm test`, `npm run build`, `npx tsc --noEmit -p tsconfig.json`, `npm run test:coverage` (thresholds manually verified against the printed c8 table — no `--check-coverage` flags exist: overall statements >= 93%, no source file below 85%), `git status --porcelain`; evidence recorded; plan archived.

## Dependencies

- A1 and A2 are one unit (G1); A3 depends on A1/A2 landing; A4 after A3.
- Non-plan prerequisite: current tree green (231/231 baseline).

## Acceptance criteria

1. An adapter can set `wire.state` before the connection callback and a route handler reads the identical value via `ctx.connection.state`; `viae.connections[0].state` matches; a rejected wire never creates a `Via` or `connection` event (bounded negative assertion).
2. The presence of `ViaOptions.state` (including an explicit `state: undefined`) overrides `wire.state`; absent both → `undefined`; snapshot semantics hold: post-construction `wire.state` mutations and reconnect rebinds do not change `via.state`.
3. `WebSocketWire.wrap(ws, upgrade)` exposes a readonly `wire.upgrade`; `connect()` has none; `close(code, reason)` forwards per-argument; omitting both preserves existing behavior exactly; a second close while CLOSING is a no-op (first code wins).
4. Docs describe the adapter-owned gate + per-request guard model; revocation/expiry is stated as user-land with the recommended patterns; no auth logic/cookie parsing is added; README no longer implies `head.token` is the identity channel.
5. All tests green (231 + new), build and full typecheck clean, coverage thresholds manually verified, README/AGENTS updated.
6. `Viae`/lifecycle behavior untouched: no changes to heartbeat, reconnect, drain, caps, or wire ownership semantics.

## Verification

- `npm test`; `npm run build`; `npx tsc --noEmit -p tsconfig.json`; `npm run test:coverage` (manual threshold check).
- Manual review of README/AGENTS additions against final code.
- Atlas final pass: frozen-tree run + diff scope + evidence in this file.

## Risks and mitigations

- **R1 — Naming collisions on WebSocketWire (extends EventEmitter):** `state`/`upgrade` are not EventEmitter members; all `Wire` fields are optional, so custom implementers (`TestWire`, `StubWire`) are unaffected.
- **R2 — Snapshot surprise:** documented contract + tests for post-handoff mutation and reconnect stability; refresh guidance in docs.
- **R3 — Close-code portability:** per-argument forwarding tested; docs recommend `1008`/`4000-4999`; viae never validates or rewrites codes.
- **R4 — Scope creep into auth/revocation:** acceptance criteria 4 and 6; any machinery request returns to Atlas.

## Verification evidence (Atlas, frozen tree, 2026-10-06)

- `npm test` → **248 pass / 0 fail** (231 baseline + 17 new: 6 wire, 7 via, 4 auth-state).
- `npm run build` → exit 0; `npx tsc --noEmit -p tsconfig.json` → exit 0 (the `@ts-expect-error` readonly proof is consumed).
- `npm run test:coverage` → overall statements **96.78%** (≥93%); lowest source file `api.ts` 91.91% (≥85%); `wire.ts` 96.04%, `via.ts` 99.77% — thresholds manually verified against the printed table.
- `git status --porcelain` → exactly the seven allowed files + Atlas-owned plan files; no commits.

Acceptance criteria evidence:

1. Adapter e2e (`test/auth-state.spec.ts`): authorized claims reach a route handler via `ctx.connection.state` and `viae.connections[0].state`; a rejected wire (close 1008) never produces a `Via`/`connection` event (bounded negative wait); `wire.upgrade === req` identity asserted over a raw ws server; `connect()` wires have no upgrade.
2. Snapshot semantics: direct option, wire fallback, explicit `state: undefined` override (presence-based `Object.hasOwn` at `src/via.ts:305`), absent-both, post-construction mutation ignored, reconnect-rebind stability (7 tests).
3. `Wire.close(code?, reason?)` per-argument forwarding + CLOSING first-wins (stub transitions CLOSING→CLOSED); omitted args preserve behavior; readonly `upgrade` getter with `@ts-expect-error` proof.
4. Docs: README `### Connection state & auth` (`README.md:600`) documents the two-layer model, snapshot/pre-handoff contract, rejection codes (reason-requires-code, first-close-wins), upgrade passthrough, D6 revocation/expiry user-land intent with recommended patterns, and security notes; `head.token` identity usage removed from all examples. AGENTS.md adds consumer bullets (`AGENTS.md:46,62-64`). No auth logic/cookie parsing added.
5. Tests/build/typecheck/coverage above; README/AGENTS updated.
6. `Viae`/lifecycle untouched: no changes to heartbeat, reconnect, drain, caps, or ownership (`src/viae.ts`, `src/context.ts` untouched; lifecycle tests unchanged).

## Run registry

| Unit | Conductor session | Status | Scope |
|---|---|---|---|
| A1–A3 / G1 | ses_eef81244effe1dCyxIQRN3Cqnt | COMPLETE | wire + via + tests + docs |
| A4 / Atlas | this session | COMPLETE | verification + closure |

## Change log

- 2026-10-06: created from the auth review; P0+P1 scope.
- 2026-10-06: critic round 1; revised (typing honesty, resolution semantics, snapshot/mutation contract, readonly upgrade, per-argument close + first-wins, manual coverage gate, dedicated spec file, missing tests). Revocation confirmed as user-land documentation per user direction.
- 2026-10-06: critic round 2; presence-based state resolution and reconnect-refresh wording fixed, minors folded. Implemented and verified (248 tests, build/typecheck clean, coverage 96.78%); AC1–AC6 evidenced; status set COMPLETE; archived.
