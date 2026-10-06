# viae

A bi-directional binary req/res and streaming framework over WebSocket.

[![NPM version][npm-image]][npm-url]
[![NPM downloads][npm-downloads]][npm-url]

Messages are serialised with CBOR by default and the encoding is negotiable per-response. Streams use a WHATWG-aligned credit-based backpressure protocol multiplexed over the same connection.

---

## Installation

```
npm install viae
```

---

## Quick start

### Server

Create a `Viae` instance by passing any object that implements `WireServer` (emits `"connection"` events with a `Wire`). The built-in `WebSocketWire` adapts the `ws` library or a browser `WebSocket`.

```ts
import { WebSocketServer } from "ws";
import { Api, Viae, WebSocketWire } from "viae";
import type { Wire } from "viae";

const wss = new WebSocketServer({ port: 8080 });

// Adapt the ws server so Viae can accept connections
const wireServer = {
  on(event: "connection", cb: (wire: Wire) => void) {
    wss.on("connection", (ws) => cb(WebSocketWire.wrap(ws as any)));
  }
};

const viae = new Viae(wireServer);

const api = new Api("/");
api.get({
  path: "/hello/:name",
  handler: ({ params }) => `Hello, ${params.name}`,
});

viae.use(api);
```

### Client

```ts
import WebSocket from "ws";
import { Via, WebSocketWire } from "viae";

const ws   = new WebSocket("ws://localhost:8080");
const wire = WebSocketWire.wrap(ws as any);
const via  = new Via({ wire });

await via.ready;

const result = await via.request<string>("GET", "/hello/world");
console.log(result.data); // "Hello, world"

wire.close();
```

---

## Routing with `Api`

`Api` is a method-based router. Mount it on a `Viae` instance (server-side) or a `Via` instance (client-side).

```ts
import { Api, Viae } from "viae";

const api = new Api("/");

api.get({
  path: "/hello/:name",
  handler: ({ params }) => `Hello, ${params.name}`,
});

viae.use(api);
```

### Generic context type

Supply a custom context interface as a type argument to get full type-safety for properties you attach during the request lifecycle:

```ts
interface AppContext extends Context {
  userId: string;
}

const api = new Api<AppContext>("/");

// guard — runs for every request under this router
api.use("*", async (ctx, next) => {
  ctx.userId = ctx.in.head.token as string; // ctx is typed as AppContext
  return next();
});

api.get({
  path: "/profile",
  handler: ({ ctx }) => ({ id: ctx.userId }),
});
```

### Guards

`api.use(path, handler)` registers a middleware that runs **in definition order** before any route handler whose path starts with `path`. Use `"*"` to match all paths under the router:

```ts
api.use("*", async (ctx, next) => {
  if (!ctx.in.head.token) throw new ViaeError(Status.Unauthorized, "missing token");
  return next();
});

api.use("/admin", async (ctx, next) => {
  if (!isAdmin(ctx)) throw new ViaeError(Status.Forbidden, "admins only");
  return next();
});
```

You can also nest a sub-`Api` as before:

```ts
root.use("/api", nested);
```

### Route options

| Option | Type | Description |
|---|---|---|
| `path` | `string` | Path pattern (path-to-regexp v6 syntax) |
| `handler` | `function` | Called with `{ data, head, raw, path, params, ctx }` |
| `params` | `ParamsSchema` | Per-param type descriptors — coerces and types path params (see below) |
| `validate` | `(v) => v is R` | Type guard run before handler; rejects with `400` on failure |
| `accept` | `"object" \| "stream"` | Expected data shape — `"stream"` receives a `ReadableStream`. Omitted accepts either shape |
| `end` | `boolean` | Whether the match must be terminal (default `true`) |
| `next` | `boolean` | When `true`, `next()` is passed to the handler as `next`. Default `false` — the handler receives no `next` |

Methods available: `api.get`, `api.post`, `api.put`, `api.delete`, `api.all`, `api.subscribe`.

### Param types

Path parameters are strings by default. Supply a `params` schema to coerce them at runtime and have them typed correctly in the handler:

```ts
api.get({
  path: "/items/:id",
  params: { id: { type: Number } },
  handler: ({ params }) => params.id * 2, // params.id is typed as number
});

api.get({
  path: "/flag/:enabled",
  params: { enabled: { type: Boolean } },
  handler: ({ params }) => params.enabled, // typed as boolean; "true"/"1" > true
});
```

Supported types:

| `type` | Coercion | Rejects with `400` if |
|---|---|---|
| `Number` | `Number(raw)` | `!Number.isFinite(n)` — `NaN`, `Infinity`, and `-Infinity` are rejected; finite forms such as `"0x10"` and `"1e3"` pass |
| `Boolean` | `"true"` / `"1"` > `true`, anything else > `false` | — |
| `String` | no-op (default) | — |

### Nested routers

Routers are composable. Parameters captured in a parent prefix are available in child handlers.

```ts
const root = new Api("/foo/:id");
const sub  = new Api("/");

sub.get({
  path: "/bar",
  handler: ({ params }) => `id is ${params.id}`,
});

root.use("/", sub);
viae.use(root);

// GET /foo/42/bar  >  "id is 42"
```

### Validation

```ts
api.post<number>({
  path: "/double",
  validate: (v): v is number => typeof v === "number",
  handler: ({ data }) => data * 2,
});
```

For `accept: "stream"` routes, `validate` runs lazily per chunk (through a
`TransformStream`). A failing chunk errors the response stream mid-flight
instead of returning `400`, because the response status has already been sent
once the stream is established.

### `ctx.reply()`

Instead of returning a value, you can call `ctx.reply()` directly to set the response data, status code, and encoding simultaneously:

```ts
api.get({
  path: "/info",
  handler: ({ ctx }) => {
    ctx.reply({ version: 1 }, { status: 200, type: "json" });
  },
});
```

| Option | Type | Description |
|---|---|---|
| `type` | `string` | Encoding name: `"cbor"` (default), `"json"`, `"binary"`, or any custom encoder registered in the codex |
| `status` | `number` | Response status code |

If both `ctx.reply()` and a return value are present the return value takes precedence for `data`.

### Error responses

Throw `ViaeError` to send a specific status code back to the caller:

```ts
import { ViaeError, Status } from "viae";

api.get({
  path: "/secret",
  handler: ({ head }) => {
    if (!head.token) throw new ViaeError(Status.Unauthorized, "missing token");
    return "classified";
  },
});
```

`ViaeError` responses keep the status and message you throw, wherever the error
originates (handler, guard, or middleware). Any other error becomes
`500 "internal error"` for the caller — the full detail is logged locally and
never sent to the peer.

---

## Streaming

Return a `ReadableStream` from a handler to stream chunks to the consumer. The framework multiplexes it over the existing connection using a credit-based backpressure protocol. Credits are set (not additive) — on each `PULL` the consumer tells the producer its current capacity, so the producer always has an accurate view of consumer capacity. The default window is 32 chunks.

### Server — streaming response

```ts
api.get({
  path: "/numbers",
  handler: () =>
    new ReadableStream<number>({
      start(controller) {
        for (let i = 0; i < 100; i++) controller.enqueue(i);
        controller.close();
      },
    }),
});
```

### Client — consuming a stream

Request with `accept: "stream"` to receive a `ReadableStream`:

```ts
const result = await via.request<ReadableStream<number>>(
  "GET", "/numbers", undefined, { accept: "stream" }
);

const reader = (result.data as ReadableStream<number>).getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(value);
}
```

Or pipe through the WHATWG Streams API:

```ts
await (result.data as ReadableStream<number>).pipeTo(
  new WritableStream({ write: (chunk) => console.log(chunk) })
);
```

When `accept` is supplied it is a validated assertion: `"stream"` rejects the request when the response is an object, and `"object"` rejects it when the response is a stream. Omit `accept` to accept either shape:

```ts
const stream = await via.request("GET", "/numbers", undefined, { accept: "stream" });
// rejects with "expected stream response but received object" if the server replies with an object
```

### Cancellation and error propagation

Cancelling the consumer propagates back to the producer:

```ts
await reader.cancel(new Error("no longer needed"));
// > producer's ReadableStream cancel(reason) is called with the reason
```

A producer error propagates forward to the consumer:

```ts
// server side
api.get({
  path: "/fail",
  handler: () =>
    new ReadableStream({ start(c) { c.error(new Error("oops")); } }),
});

// client side
await assert.rejects(() => reader.read(), /oops/);
```

Cancellation and error reasons cross the wire as strings: an `Error` is reduced
to its `message`, and the opposite side receives that string — never the
original `Error` object — for both consumer cancels and producer errors.

For byte-oriented streams, opt into the pass-through binary codec. This keeps
each chunk as raw octets instead of wrapping it in CBOR:

```ts
const result = await via.request<ReadableStream<Uint8Array>>(
  "GET", "/blob", undefined, { accept: "stream", encoding: "binary" }
);
```

On a response, set the encoding when replying:

```ts
api.get({
  path: "/blob",
  handler: ({ ctx }) => ctx.reply(byteStream, { status: 200, type: "binary" }),
});
```

The default remains CBOR for compatibility. `StreamOptions.encoding` can also
be used to set the default for outgoing stream chunks. Inbound streams are
bounded by default — 1024 queued chunks and 64 MiB per stream — with `Infinity`
as an explicit opt-out. `strictProtocol` and `cancelIncomingOnDispose` remain
opt-in protocol and ownership controls.

### Stream options

Pass `streamOptions` to `Viae` (applies to every server connection) or `Via`:

| Option | Type | Default | Description |
|---|---|---|---|
| `highWaterMark` | `number` | `32` | Initial credit window (in chunks) for incoming streams. |
| `maxQueuedChunks` | `number` | `1024` | Max inbound chunks buffered outside the WHATWG stream queue before the stream aborts. `Infinity` opts out. |
| `maxQueuedBytes` | `number` | `64 MiB` | Approximate inbound byte cap. Binary chunks are counted exactly; other chunks use the encoded data-segment length. `Infinity` opts out. |
| `encoding` | `string` | `"cbor"` | Default chunk encoding when the enclosing message does not specify one. |
| `strictProtocol` | `boolean` | `false` | Strictly validate stream control frames; permissive fallbacks otherwise. |
| `cancelIncomingOnDispose` | `boolean` | `false` | Cancel an incoming request body when its request context is disposed. |
| `startTimeout` | `number` | `3000` | Max ms the producer waits for the consumer's initial credit. `0` disables. |
| `producerIdleTimeout` | `number` | `0` | Max ms the producer may go without progress (chunk sent or credit received) before aborting the stream. `0` disables, so indefinite backpressure remains the default. |
| `idleTimeout` | `number` | `0` | Max ms a consumer read waits for the next chunk. `0` disables. |
| `maxCredit` | `number` | `Infinity` | Upper bound on stream credit — the chunks a producer may have in flight at once. The consumer clamps the credit it requests (`START`/`PULL`); the producer fails the stream fast with a protocol error when a peer grants more. Configure the same value on both peers. |

> **Important:** `maxCredit` must be configured on **both** peers. A server-only
> configuration fails a default client's first `START` — a 32-credit grant from
> the default 32-chunk window — with `granted credit 32 exceeds maxCredit N`:
> the producer cancels the source and sends an error frame. A producer-only
> configuration fails the same way once a default consumer grants 32.

---

## Middleware

Both `Viae` and `Via` extend `Rowan<Context>`, so arbitrary middleware can be inserted into the processing pipeline. viae depends on [`rowan`](https://www.npmjs.com/package/rowan) but does not re-export it — import `Rowan`, `Middleware`, `Processor`, or `Next` from `rowan` directly when you need those types:

```ts
viae.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  ctx.log.info(`${ctx.in.head.method} ${ctx.in.head.path} ${Date.now() - start}ms`);
});
```

`before()` registers middleware that runs before the main pipeline — useful for auth or tracing:

```ts
viae.before(async (ctx, next) => {
  if (!ctx.in.head.token) {
    ctx.out!.head.status = Status.Unauthorized;
    return;
  }
  return next();
});
```

---

## Encodings

The `Codex` is a registry of named encoders. The default codex ships three:

| Name | Description |
|---|---|
| `"cbor"` | CBOR via cbor-x (default) |
| `"json"` | JSON via `JSON.stringify` / `JSON.parse` |
| `"binary"` | Pass-through for `ArrayBuffer` / `ArrayBufferView` |

The encoding is negotiated per-response via `head.encoding`. Pass `encoding` in `SendOptions` or use `ctx.reply({ type: "json" })` on the server side:

```ts
// explicit encoding on a via.send() call
await via.send({ id: "x", head: { method: "GET", path: "/blob" } }, { encoding: "binary" });
```

Register custom encoders by extending the codex:

```ts
import { defaultCodex, FrameEncoder } from "viae";

const myCodex = {
  ...defaultCodex,
  msgpack: {
    encode: (v) => /* ... */,
    decode: (b) => /* ... */,
  },
};

const via = new Via({ wire, codex: myCodex });
```

### Raw send

```ts
await via.send({ id: "abc", head: { method: "CUSTOM", path: "/" } });
```

`PING`, `PONG`, `START`, `PULL`, `CANCEL`, and `COMPLETE` are reserved control methods: they are consumed internally for heartbeat and stream control and are not valid request methods.

---

## Options reference

### `Via` options

| Option | Type | Description |
|---|---|---|
| `wire` | `Wire` | Required. The underlying transport. |
| `uuid` | `() => string` | Id generator for requests, responses, and streams. Defaults to `shortId`. |
| `log` | `Log` | Logger instance. Defaults to `Via.Log` (console). |
| `timeout` | `number` | Request timeout in ms (default `120000`). |
| `codex` | `Codex` | Named encoder registry. Defaults to `defaultCodex` (cbor, json, binary). |
| `frameOptions` | `FrameEncoderOptions` | Frame limits. `maxFrameSize` defaults to 64 MiB (64 * 1024 * 1024); opt out with `Number.MAX_SAFE_INTEGER`. |
| `streamOptions` | `StreamOptions` | Stream-layer options forwarded to each stream (queue caps, timeouts, encoding). See [Stream options](#stream-options). |
| `heartbeat` | `{ interval?: number; timeout?: number }` | Protocol-level keepalive. Off by default (no timers). When enabled, sends reserved `PING` frames every `interval` (default `15000` ms) and requires liveness proof within `timeout` (default `5000` ms). Any well-formed inbound frame counts as proof; a miss is a connection failure — reconnects when configured, otherwise permanent close plus wire close. |
| `reconnect` | `{ wire: () => Wire \| Promise<Wire>; minDelay?: number; maxDelay?: number; factor?: number; jitter?: number; maxAttempts?: number }` | Client-only reconnect policy. Off by default. Defaults: `minDelay` `100`, `maxDelay` `10000`, `factor` `2`, `jitter` `0.2`, `maxAttempts` `Infinity`. On unexpected loss, in-flight requests reject (never replayed), streams abort, `disconnect` fires, and a replacement wire is built from `wire()` with jittered exponential backoff. Permanent protocol failures never retry; `ready` waits through reconnects and rejects only on permanent closure. |
| `maxInflightRequests` | `number` | Maximum concurrent non-reserved inbound requests. Over-cap frames get `503 Busy` without running any handler. Default `0` (disabled). |
| `maxStreamsPerConnection` | `number` | Maximum concurrent multiplexed streams, in both directions. Over-cap streams are refused with `503 Busy`. Default `0` (disabled). |
| `maxBufferedBytes` | `number` | Wire backpressure threshold. Only applies when the wire reports a finite `bufferedAmount`; outbound non-control sends wait until it drains to or below the threshold. Control `PING`/`PONG` bypass the wait. Default `0` (disabled). |
| `protocolVersion` | `number` | Protocol major version, emitted as `v` on non-empty heads. An inbound `v` must match or the connection fails permanently; `0` disables emission and validation. Default `1`; overrides `frameOptions.protocolVersion`. |

### `Viae` options

`Viae` accepts the same `frameOptions`, `codex`, and `streamOptions` settings and
forwards them to each connection. Its `timeout` option sets the default request
timeout for every `Via` connection it creates.

| Option | Type | Description |
|---|---|---|
| `log` | `Log` | Logger for the server and every connection it creates. Defaults to `Viae.Log` (console). |
| `middleware` | `Processor<Context>[]` | Middleware applied to every inbound connection. |
| `timeout` | `number` | Default request timeout in ms for each server-created `Via` (default `120000`). |
| `frameOptions` | `FrameEncoderOptions` | Frame limits forwarded to each connection (`maxFrameSize` defaults to 64 MiB). |
| `codex` | `Codex` | Named encoder registry forwarded to each connection. |
| `streamOptions` | `StreamOptions` | Stream-layer options forwarded to each connection. See [Stream options](#stream-options). |
| `heartbeat` | `{ interval?: number; timeout?: number }` | Heartbeat policy forwarded to each connection. Defaults `15000` / `5000` ms; see [`Via` options](#via-options). |
| `maxConnections` | `number` | Maximum concurrent connections. `0` (default) is unlimited; excess connections are closed immediately, without creating a `Via` or emitting `connection`. |
| `maxInflightRequests` | `number` | Forwarded to each connection (default `0`, disabled). See [`Via` options](#via-options). |
| `maxStreamsPerConnection` | `number` | Forwarded to each connection (default `0`, disabled). See [`Via` options](#via-options). |
| `maxBufferedBytes` | `number` | Forwarded to each connection (default `0`, disabled). See [`Via` options](#via-options). |
| `protocolVersion` | `number` | Forwarded to each connection (default `1`). See [`Via` options](#via-options). |

`heartbeat`, `maxInflightRequests`, `maxStreamsPerConnection`,
`maxBufferedBytes`, and `protocolVersion` all apply to every connection `Viae`
creates; `reconnect` is client-only — there is no server-side reconnect policy.

### Logging

`Viae` and `Via` each have a static `Log` property that defaults to a `console`-backed implementation. Supply any object matching the `Log` interface (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) to redirect output:

```ts
import { Viae } from "viae";

// bring your own logger - anything with trace/debug/info/warn/error/fatal methods
Viae.Log = myLogger; // applies to all future connections
```

Or pass per-instance:

```ts
const viae = new Viae(wireServer, { log: myLogger });
```

---

## Connection lifecycle

### Closing

`Via.close(opts?)` closes a connection. `drain` defaults to `false`: pending
requests are rejected immediately and the wire is closed. With `drain: true`,
active handlers and their tasks are allowed to finish, bounded by
`drainTimeout` (default `5000` ms); on expiry any remaining streams are
force-aborted and the wire is closed. `close()` is idempotent — every call
returns the first call's promise.

```ts
await via.close({ drain: true, drainTimeout: 5000 });
console.log(via.closed); // true
```

`Via.closed` flips to `true` on permanent closure; `via.ready` resolves when
the wire is open, waits through transient drops, and rejects only on permanent
closure.

`Viae.close(opts?)` marks the server closed — new connections are refused and
closed immediately, without creating a `Via` or emitting `connection` — then
drain-closes every connection current at call time and resolves once they have
all settled. `drainTimeout` is per connection (default `5000` ms). It is
idempotent, and `Viae.closed` becomes `true`.

**`Viae` does not own the underlying `WireServer`/http server socket — callers
must close it themselves.** Draining only ends the accepted connections.

### Events

| Event | Fires |
|---|---|
| `open` | The wire reached `OPEN` (also after a reconnect; not emitted if the wire is already `OPEN` when bound). |
| `close` | Permanent closure only — an unexpected loss with no reconnect policy, attempts exhausted, a permanent protocol failure, or an explicit `close()`. |
| `disconnect` | A transient drop: an unexpected connection loss while a reconnect policy is configured. Without a policy the loss is permanent and only `close` fires. |
| `reconnected` | A replacement wire was built and reached `OPEN`. |
| `error` | A wire error, an unhandled processing error, or the reason for an unexpected drop. |

An intentional `close()` emits `close` but never `disconnect`.

### Caps

Optional per-connection caps reject excess work with `503 Busy`
(`Status.Busy`):

- `maxInflightRequests` — concurrent non-reserved inbound requests. Over-cap
  requests get `503` without running any handler.
- `maxStreamsPerConnection` — concurrent multiplexed streams, in both
  directions. Over-cap streams are refused with `503` (a best-effort `CANCEL`
  stops a peer that already announced the stream).
- `maxBufferedBytes` — outbound non-control sends wait while the wire reports a
  `bufferedAmount` above the threshold; `PING`/`PONG` bypass the wait.

### Heartbeat

No heartbeat timers run by default. When `heartbeat` is configured, each side
sends a reserved `PING` every `interval` and requires a liveness proof within
`timeout`; any well-formed inbound frame settles the beat. `PING` is answered
with `PONG` even by peers that have no heartbeat configured, so
heartbeat-capable peers can probe legacy ones — a legacy peer's normal `404`
also proves liveness. A miss is a connection failure: it reconnects when a
policy is configured, otherwise it is a permanent close plus wire close. See
[`Via` options](#via-options) for defaults.

### Reconnect

`reconnect` is a client-only policy, off by default. On an unexpected loss,
in-flight requests reject and are never replayed, streams abort, `disconnect`
fires, and a replacement wire is built from `wire()` with jittered exponential
backoff. Permanent protocol failures never retry, and `ready` waits through
reconnects, rejecting only on permanent closure. See
[`Via` options](#via-options) for the backoff defaults.

### Protocol version

By default non-empty heads carry `v: 1`. An inbound head carrying a `v` must
match the configured major or the connection fails permanently; heads without
`v` are accepted for legacy peers, and empty-head frames carry no `v`. Set
`protocolVersion: 0` to disable both emission and validation.

### Wire ownership

A wire may be bound to only one `Via`. Constructing a second, different `Via`
on the same wire throws `wire is already bound to another Via`. The same `Via`
may re-claim a replacement wire during reconnect.

---

## Resource limits & security

Secure defaults are applied on import:

- Frames are limited to 64 MiB by default, inbound and outbound, via
  `FrameEncoderOptions.maxFrameSize`. Opt out with
  `frameOptions: { maxFrameSize: Number.MAX_SAFE_INTEGER }`.
- The cbor-x decoder is initialised with size limits (`maxArraySize`
  1,000,000 / `maxMapSize` 100,000 / `maxObjectSize` 100,000) when `viae` is
  imported, rejecting decoder-amplification payloads such as truncated
  array-32 headers. Note that cbor-x size limits are process-global: importing
  `viae` changes decoding limits for every cbor-x consumer in the process.
- Inbound streams are bounded to 1024 queued chunks and 64 MiB per stream by
  default; either bound can be opted out of with `Infinity` via
  [`streamOptions`](#stream-options). The consumer aborts an over-limit stream
  and best-effort cancels the producer.
- Concurrency caps (`maxInflightRequests`, `maxStreamsPerConnection`) and wire
  backpressure (`maxBufferedBytes`) are available per connection; see
  [`Via` options](#via-options) and [Caps](#caps).

---

## Status codes

```ts
import { Status } from "viae";

Status.OK           // 200
Status.Partial      // 206  (stream chunk)
Status.BadRequest   // 400
Status.Unauthorized // 401
Status.Forbidden    // 403
Status.NotFound     // 404
Status.Error        // 500
Status.Busy         // 503
```

---

## License

MIT

[npm-url]: https://npmjs.org/package/viae
[npm-image]: http://img.shields.io/npm/v/viae.svg
[npm-downloads]: http://img.shields.io/npm/dm/viae.svg
