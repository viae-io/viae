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

## Server

Create a `Viae` instance by passing any object that implements `WireServer` (emits `"connection"` events with a `Wire`). The built-in `WebSocketWire` adapts the `ws` library or a browser `WebSocket`.

```ts
import { WebSocketServer } from "ws";
import { Viae, WebSocketWire } from "viae";

const wss = new WebSocketServer({ port: 8080 });

// Adapt the ws server so Viae can accept connections
const wireServer = {
  on(event: "connection", cb: (wire: Wire) => void) {
    wss.on("connection", (ws) => cb(WebSocketWire.wrap(ws as any)));
  }
};

const viae = new Viae(wireServer);
```

### Logging

`Viae` and `Via` each have a static `Log` property that defaults to a `console`-backed implementation. Supply any object matching the `Log` interface (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) to redirect output:

```ts
import { Viae } from "viae";
import pino from "pino";

const logger = pino();
Viae.Log = logger; // applies to all future connections
```

Or pass per-instance:

```ts
const viae = new Viae(wireServer, { log: logger });
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
| `accept` | `"object" \| "stream"` | Expected data shape — `"stream"` receives a `ReadableStream` |
| `end` | `boolean` | Whether the match must be terminal (default `true`) |
| `next` | `boolean` | Whether `next()` is passed to the handler |

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
| `Number` | `Number(raw)` | `isNaN` |
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

---

## Streaming

Return a `ReadableStream` from a handler to stream chunks to the consumer. The framework multiplexes it over the existing connection using a credit-based backpressure protocol. Credits are set (not additive) — on each `PULL` the consumer tells the producer its current `controller.desiredSize`, so the producer always has an accurate view of consumer capacity. The default window is 32 chunks.

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

---

## Client

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

### `Via` options

| Option | Type | Description |
|---|---|---|
| `wire` | `Wire` | Required. The underlying transport. |
| `log` | `Log` | Logger instance. Defaults to `Via.Log` (console). |
| `timeout` | `number` | Request timeout in ms (default `10000`). |
| `codex` | `Codex` | Named encoder registry. Defaults to `defaultCodex` (cbor, json, binary). |

### Encoding

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
await via.send({ id: "abc", head: { method: "PING", path: "/" } });
```

---

## Middleware

Both `Viae` and `Via` extend `Rowan<Context>`, so arbitrary middleware can be inserted into the processing pipeline:

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
```

---

## License

MIT

[npm-url]: https://npmjs.org/package/viae
[npm-image]: http://img.shields.io/npm/v/viae.svg
[npm-downloads]: http://img.shields.io/npm/dm/viae.svg
