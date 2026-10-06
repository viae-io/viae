# AGENTS.md - using viae

viae is a bi-directional binary req/res and streaming framework over WebSocket.
Server: `Viae`. Client: `Via`. Routing: `Api`. Default codec CBOR. Streams are
multiplexed on the same connection with credit-based backpressure.
TypeScript ESM. Install: `npm install viae`.

## Quick start

Server:

```ts
import { WebSocketServer } from "ws";
import type { Wire } from "viae";
import { Api, Viae, WebSocketWire } from "viae";

const wss = new WebSocketServer({ port: 8080 });
const wireServer = {
  on: (_e: "connection", cb: (wire: Wire) => void) =>
    wss.on("connection", (ws) => cb(WebSocketWire.wrap(ws))),
};
const viae = new Viae(wireServer);

const api = new Api("/");
api.get({ path: "/hello/:name", handler: ({ params }) => `Hello, ${params.name}` });
viae.use(api);
```

Client:

```ts
import WebSocket from "ws";
import { Via, WebSocketWire } from "viae";

const ws = new WebSocket("ws://localhost:8080");
const via = new Via({ wire: WebSocketWire.wrap(ws) });
await via.ready;
const res = await via.request<string>("GET", "/hello/world"); // res.data === "Hello, world"
```

## API map

- `via.request(method, path, data?, opts?)` -> `{ ok, head, data }`; opts: `timeout`, `id`, `accept` (`"stream" | "object"`), `encoding`, `head`.
- `via.send(msg, opts?)` fire-and-forget; `via.close({ drain?, drainTimeout? })`; `via.ready`; `via.closed`.
- Client wires: `WebSocketWire.wrap(ws)` or `new WebSocketWire().connect(url)`.
- Connection identity: adapter sets `wire.state` before handoff -> `via.state` / `ctx.connection.state`; `wire.upgrade` via `WebSocketWire.wrap(ws, req)`; reject with `wire.close(code, reason)` (e.g. `1008`, `4401`).
- Typed claims: `IVia<S>` / `Via<S>` / `ViaOptions<S>`; `new Via({ wire, state: claims })` infers `S`; server-side, `interface AppContext extends Context { connection: IVia<Claims> }` + `new Api<AppContext>` types `ctx.connection.state`. `WebSocketLike` is the structural socket type accepted by `WebSocketWire.wrap(ws, upgrade?)` - both the `ws` package and global `WebSocket` satisfy it, no casts needed.
- Events: `via.on("open" | "close" | "disconnect" | "reconnected" | "error", cb)`.
- `Api`: `get / post / put / delete / all / subscribe`; guards via `api.use(path, fn)`.
- Route opts: `path`, `handler({ data, head, raw, path, params, ctx })`, `params`, `validate`, `accept`, `end`, `next`.
- `ctx.reply(data, { status?, type? })`; a returned value overrides reply data only (status/type survive).
- Errors: `throw new ViaeError(Status.X, "msg")` -> that status; any other throw -> `500 "internal error"` (detail logged, not sent).
- Streaming both ways: return a `ReadableStream` from a handler, or pass one as `data`; consume with `{ accept: "stream" }`.
- Cancel/error reasons cross the wire as strings (an `Error` is reduced to its `message`).
- Middleware: `viae.use(fn)` / `viae.before(fn)`; types (`Rowan`, `Middleware`, `Processor`, `Next`) come from `rowan`, not viae.
- Logging: `Viae.Log = logger` or `new Via({ wire, log })`; interface: `trace/debug/info/warn/error/fatal`.

## Rules and gotchas

- Reserved methods - `PING PONG START PULL CANCEL COMPLETE` - are control frames; never valid request methods.
- Head is always CBOR; non-empty heads carry `v: 1`. A peer sending an unsupported `v` fails permanently; `protocolVersion: 0` disables.
- One `Via` per wire; binding a second throws. Reconnect (`reconnect: { wire: () => Wire }`, client-only, opt-in) rebuilds and re-claims.
- `via.state` is a construction-time snapshot: `ViaOptions.state` (even `undefined`) overrides `wire.state`; later `wire.state` mutations and reconnect rebinds do not refresh it.
- Beta break: `IVia.state` is required (was `state?: unknown`) - structural `IVia` mocks must add a `state` member. `request<T>(..., { accept: "stream" })` types `data` as `ReadableStream<T>`; legacy `request<ReadableStream<T>>(..., { accept: "stream" })` still works, omitted `accept` stays permissive, and `IVia.request` remains non-overloaded.
- Auth is adapter-owned - no cookies/JWT/session helpers; never smuggle identity via `head`. Set `wire.state` at the upgrade and read `ctx.connection.state` in guards.
- Revocation/expiry is user-land: recheck claims per request, drop with `via.close()` / `wire.close(1008|4401, reason)`, or sweep `viae.connections`. A client reconnect re-authenticates server-side; client `via.state` does not refresh on rebind.
- `accept`, when supplied, is an assertion, not a conversion: a mismatch rejects the request. Omit it to accept either shape.
- Streams: credit is SET (not additive). Configure `streamOptions.maxCredit` on BOTH peers or the stream fails fast with `granted credit N exceeds maxCredit M`.
- Stream queues are bounded by default: 1024 chunks / 64 MiB per stream (`Infinity` opts out). Streams abort on any connection drop; no resume.
- `heartbeat` is opt-in (defaults 15000/5000 ms); `PING` is answered even by peers without heartbeat configured.
- Events: `close` = permanent only; `disconnect` = transient drop under a reconnect policy; intentional `close()` never emits `disconnect`.
- `Via.close({ drain: true, drainTimeout })` waits for in-flight handlers. `Viae.close()` drains accepted connections but does NOT close your HTTP/ws server.
- Caps refuse excess work with `503 Busy`: `maxInflightRequests`, `maxStreamsPerConnection`, `maxBufferedBytes` (Via; Viae forwards them) and `maxConnections` (Viae).
- Frames are capped at 64 MiB by default (`frameOptions.maxFrameSize`). cbor-x decode size limits (1M array / 100k map) are process-global once viae is imported.
- Data encoding is per-response via `head.encoding`: `"cbor"` (default), `"json"`, `"binary"` (raw `ArrayBuffer` views), or custom via the `codex` option.
- `Status`: `OK 200`, `Partial 206`, `BadRequest 400`, `Unauthorized 401`, `Forbidden 403`, `NotFound 404`, `Error 500`, `Busy 503`.