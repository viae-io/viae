/**
 * W5 cross-cutting hardening regression tests.
 *
 * Two harness levels are used deliberately:
 *  - An in-memory paired `StubWire` harness makes frame-level assertions
 *    (custom codex encoding, binary chunk encoding) without a real socket.
 *  - `TestWireServer` / `createTestClient` cover socket-level end-to-end
 *    behavior (guards, before() ordering, accept assertions, interleaving).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "eventemitter3";
import {
  Api,
  FrameEncoder,
  Status,
  Via,
  Viae,
  ViaeError,
  WireState,
  defaultCodex,
  type Codex,
  type Frame,
  type Wire,
  type WireServer,
} from "../src/index.js";
import { TestWireServer, closeAndWait, createTestClient, noopLog } from "./utils.js";

// ─── In-memory paired wire harness ──────────────────────────────────────────

function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data as ArrayBuffer);
}

/**
 * Stub wire. `send()` decodes the frame with a `FrameEncoder` (recording the
 * decoded frame plus the raw bytes) and forwards the original bytes to the
 * peer's `message` listeners on a microtask, as a real socket would.
 */
class StubWire extends EventEmitter implements Wire {
  readyState: WireState = WireState.OPEN;
  readonly url: string;
  readonly sent: Frame[] = [];
  readonly sentRaw: Uint8Array[] = [];
  peer?: StubWire;
  closeCalls = 0;
  private _encoder: FrameEncoder;

  constructor(url = "stub://wire", codex: Codex = defaultCodex) {
    super();
    this.url = url;
    this._encoder = new FrameEncoder(codex);
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== WireState.OPEN) throw new Error("wire is not open");
    const bytes = toUint8Array(data);
    const frame = this._encoder.decode(bytes);
    this.sent.push(frame);
    this.sentRaw.push(bytes.slice());
    const peer = this.peer;
    const copy = bytes.slice();
    queueMicrotask(() => {
      if (peer && peer.readyState === WireState.OPEN) peer.emit("message", copy);
    });
  }

  close(): void {
    if (this.readyState === WireState.CLOSED) return;
    this.closeCalls++;
    this.readyState = WireState.CLOSED;
    this.emit("close");
    this.peer?._remoteClose();
  }

  /** Close as observed from the far end; never loops back. */
  _remoteClose(): void {
    if (this.readyState === WireState.CLOSED) return;
    this.readyState = WireState.CLOSED;
    this.emit("close");
  }
}

class StubWireServer extends EventEmitter implements WireServer {}

function createWirePair(codex: Codex = defaultCodex) {
  const a = new StubWire("stub://a", codex);
  const b = new StubWire("stub://b", codex);
  a.peer = b;
  b.peer = a;
  return { a, b };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, label: string, ms = 1500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function drain<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const out: T[] = [];
  for (;;) {
    const { done, value } = await withTimeout(reader.read(), "stream read");
    if (done) return out;
    out.push(value);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Frame-level tests (paired wire harness)
// ═══════════════════════════════════════════════════════════════════════════

describe("Hardening — frame-level (paired wire harness)", () => {
  it("should round-trip through a custom codex encoder and reject unknown encodings", async () => {
    const textEncoder = new TextEncoder();
    const textDecoder = new TextDecoder();
    const fooEncoder = {
      encode(value: unknown): Uint8Array {
        return textEncoder.encode("foo:" + JSON.stringify(value));
      },
      decode(data: Uint8Array): unknown {
        const text = textDecoder.decode(data);
        if (!text.startsWith("foo:")) throw new Error("foo decoder received non-foo data");
        return JSON.parse(text.slice(4));
      },
    };
    const fooCodex: Codex = { ...defaultCodex, foo: fooEncoder };

    const server = new StubWireServer();
    const viae = new Viae(server, { log: noopLog, codex: fooCodex });
    const api = new Api("/");
    api.post({
      path: "/echo-foo",
      handler: ({ data, ctx }) => {
        ctx.reply(data, { type: "foo" });
      },
    });
    viae.use(api);

    const { a: serverWire, b: clientWire } = createWirePair(fooCodex);
    server.emit("connection", serverWire);
    const via = new Via({ wire: clientWire, log: noopLog, codex: fooCodex });
    await via.ready;

    const payload = { hello: "world", n: 42 };
    const result = await withTimeout(
      via.request<typeof payload>("POST", "/echo-foo", payload, { encoding: "foo", timeout: 2000 }),
      "custom codex request",
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, payload);

    const requestFrame = clientWire.sent[0];
    assert.ok(requestFrame, "expected the client request frame");
    assert.equal(requestFrame.head?.encoding, "foo");
    assert.ok(
      textDecoder.decode(clientWire.sentRaw[0]).includes("foo:"),
      "the request data segment must be encoded by the foo encoder",
    );

    const responseFrame = serverWire.sent.find(frame => frame.head?.status === Status.OK);
    assert.ok(responseFrame, "expected the server response frame");
    assert.equal(responseFrame.head?.encoding, "foo");

    await assert.rejects(
      (async () => {
        await via.send(
          { id: "unknown-encoding", head: { method: "POST", path: "/" }, data: { a: 1 } },
          { encoding: "nope" },
        );
      })(),
      /unknown encoding: nope/,
    );
    assert.equal(clientWire.sent.length, 1, "a rejected send must not put bytes on the wire");
  });

  it("should stream bodyless binary chunks whose frames carry encoding binary (D9)", async () => {
    const server = new StubWireServer();
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({
      path: "/blob",
      handler: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from([1, 2, 3]));
            controller.enqueue(Uint8Array.from([4, 5]));
            controller.close();
          },
        }),
    });
    viae.use(api);

    const { a: serverWire, b: clientWire } = createWirePair();
    server.emit("connection", serverWire);
    const via = new Via({ wire: clientWire, log: noopLog });
    await via.ready;

    const result = await withTimeout(
      via.request<ReadableStream<Uint8Array>>("GET", "/blob", undefined, {
        accept: "stream",
        encoding: "binary",
        timeout: 2000,
      }),
      "binary stream request",
    );
    assert.equal(result.ok, true);

    const chunks = await drain(result.data as ReadableStream<Uint8Array>);
    assert.deepEqual(chunks.map(chunk => Array.from(chunk)), [[1, 2, 3], [4, 5]]);

    const requestFrame = clientWire.sent[0];
    assert.ok(requestFrame, "expected the client request frame");
    assert.equal(requestFrame.head?.encoding, "binary");
    assert.equal(requestFrame.data, undefined, "the GET request must be bodyless");

    const partials = serverWire.sent.filter(frame => frame.head?.status === Status.Partial);
    assert.equal(partials.length, 2, "expected two chunk frames");
    for (const partial of partials) {
      assert.equal(partial.head?.encoding, "binary");
    }
    assert.deepEqual(partials[0].data, Uint8Array.from([1, 2, 3]));
    assert.deepEqual(partials[1].data, Uint8Array.from([4, 5]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Socket-level end-to-end tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Hardening — end-to-end", () => {
  let server: TestWireServer;
  let port: number;

  beforeEach(async () => {
    server = new TestWireServer();
    const addr = await server.listen(0, "localhost");
    port = addr.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it("should map a guard-thrown ViaeError to 403 and hide unexpected guard errors (D5)", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.use("/admin", async () => {
      throw new ViaeError(Status.Forbidden, "nope");
    });
    api.get({ path: "/admin/secret", handler: () => "classified" });
    api.use("/boom", async () => {
      throw new Error("secret detail");
    });
    api.get({ path: "/boom/secret", handler: () => "classified" });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      const forbidden = await withTimeout(
        via.request("GET", "/admin/secret", undefined, { timeout: 2000 }),
        "forbidden request",
      );
      assert.equal(forbidden.ok, false);
      assert.equal(forbidden.head.status, Status.Forbidden);
      assert.equal(forbidden.data, "nope");

      const internal = await withTimeout(
        via.request("GET", "/boom/secret", undefined, { timeout: 2000 }),
        "boom request",
      );
      assert.equal(internal.ok, false);
      assert.equal(internal.head.status, Status.Error);
      assert.equal(internal.data, "internal error");
      assert.notEqual(internal.data, "secret detail");
    } finally {
      await closeAndWait(wire);
    }
  });

  it("should enforce frameOptions.maxFrameSize on inbound frames and close the server wire (D1)", async () => {
    const viae = new Viae(server, { log: noopLog, frameOptions: { maxFrameSize: 64 } });
    const api = new Api("/");
    api.get({ path: "/tiny", handler: () => "ok" });
    viae.use(api);

    const serverErrors: unknown[] = [];
    const serverCloses: Promise<void>[] = [];
    viae.on("connection", connection => {
      connection.on("error", err => serverErrors.push(err));
      serverCloses.push(withTimeout(
        new Promise<void>(resolve => connection.on("close", () => resolve())),
        "server connection close",
      ));
    });

    const { via, wire } = await createTestClient(port);
    try {
      /* A small frame still succeeds under the same cap. */
      const small = await withTimeout(
        via.request<string>("GET", "/tiny", undefined, { timeout: 2000 }),
        "small request",
      );
      assert.equal(small.ok, true);
      assert.equal(small.data, "ok");

      /* The oversized frame is rejected by the server decoder, which closes
         the wire; the client's pending request must reject rather than hang. */
      await assert.rejects(
        withTimeout(
          via.request("POST", "/tiny", "x".repeat(200), { timeout: 2000 }),
          "oversized request",
        ),
        /wire closed/,
      );

      await serverCloses[0];
      assert.ok(
        serverErrors.some(err => String(err).includes("frame exceeds maximum size of 64 bytes")),
        `expected the oversized frame to be rejected, got: ${serverErrors.map(String).join(", ")}`,
      );
      assert.equal(viae.connections.length, 0, "the server wire must have closed");
    } finally {
      await closeAndWait(wire);
    }
  });

  it("should run before() middleware, then use() middleware, then the route handler", async () => {
    const order: string[] = [];
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({
      path: "/order",
      handler: () => {
        order.push("handler");
        return order.slice();
      },
    });

    viae.before(async (_ctx, next) => {
      order.push("A");
      return next?.();
    });
    viae.use(async (_ctx, next) => {
      order.push("B");
      return next?.();
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      const result = await withTimeout(
        via.request<string[]>("GET", "/order", undefined, { timeout: 2000 }),
        "order request",
      );
      assert.deepEqual(result.data, ["A", "B", "handler"]);
    } finally {
      await closeAndWait(wire);
    }
  });

  it("should contain a sync-throwing before() middleware without crashing the server", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({ path: "/after-boom", handler: () => "alive" });
    viae.use(api);

    let beforeCalls = 0;
    viae.before((_ctx, next) => {
      beforeCalls++;
      if (beforeCalls === 1) throw new Error("before boom");
      return next ? next() : Promise.resolve();
    });

    const first = await createTestClient(port);
    try {
      /* The server never responds to the poisoned request: the client's
         bounded timeout is the only way out, so a hang becomes a failure. */
      await assert.rejects(
        withTimeout(
          first.via.request("GET", "/after-boom", undefined, { timeout: 300 }),
          "poisoned request",
        ),
        /request timeout/,
      );
      assert.equal(viae.connections.length, 1, "the server must still hold the connection");
    } finally {
      await closeAndWait(first.wire);
    }

    /* A subsequent request on a new connection must succeed. */
    const second = await createTestClient(port);
    try {
      const result = await withTimeout(
        second.via.request<string>("GET", "/after-boom", undefined, { timeout: 2000 }),
        "recovery request",
      );
      assert.equal(result.ok, true);
      assert.equal(result.data, "alive");
      assert.equal(beforeCalls, 2);
    } finally {
      await closeAndWait(second.wire);
    }
  });

  it("should reject an explicit stream accept when the server returns an object (D8)", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({ path: "/object", handler: () => "not a stream" });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      await assert.rejects(
        withTimeout(
          via.request("GET", "/object", undefined, { accept: "stream", timeout: 2000 }),
          "accept stream mismatch",
        ),
        /expected stream response but received object/,
      );
    } finally {
      await closeAndWait(wire);
    }
  });

  it("should reject an explicit object accept when the server returns a stream (D8)", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({
      path: "/stream",
      handler: () =>
        new ReadableStream<number>({
          start(controller) {
            controller.enqueue(1);
            controller.close();
          },
        }),
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      await assert.rejects(
        withTimeout(
          via.request("GET", "/stream", undefined, { accept: "object", timeout: 2000 }),
          "accept object mismatch",
        ),
        /expected object response but received stream/,
      );
    } finally {
      await closeAndWait(wire);
    }
  });

  it("should stay permissive when accept is omitted (D8)", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({
      path: "/stream",
      handler: () =>
        new ReadableStream<number>({
          start(controller) {
            controller.enqueue(1);
            controller.enqueue(2);
            controller.enqueue(3);
            controller.close();
          },
        }),
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      const result = await withTimeout(
        via.request<ReadableStream<number>>("GET", "/stream", undefined, { timeout: 2000 }),
        "permissive stream request",
      );
      assert.equal(result.ok, true);
      assert.ok(result.data instanceof ReadableStream, "omitted accept must keep stream responses");
      const values = await drain(result.data as ReadableStream<number>);
      assert.deepEqual(values, [1, 2, 3]);
    } finally {
      await closeAndWait(wire);
    }
  });

  it("should interleave reads from two live streams without cross-talk", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({
      path: "/seq/:base",
      handler: ({ params }) => {
        const base = Number(params.base);
        return new ReadableStream<number>({
          start(controller) {
            for (let i = 0; i < 8; i++) controller.enqueue(base + i);
            controller.close();
          },
        });
      },
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      const [first, second] = await Promise.all([
        withTimeout(
          via.request<ReadableStream<number>>("GET", "/seq/100", undefined, { accept: "stream", timeout: 2000 }),
          "first stream request",
        ),
        withTimeout(
          via.request<ReadableStream<number>>("GET", "/seq/200", undefined, { accept: "stream", timeout: 2000 }),
          "second stream request",
        ),
      ]);

      const reader1 = (first.data as ReadableStream<number>).getReader();
      const reader2 = (second.data as ReadableStream<number>).getReader();
      const got1: number[] = [];
      const got2: number[] = [];

      for (let i = 0; i < 8; i++) {
        const a = await withTimeout(reader1.read(), "stream 1 read");
        const b = await withTimeout(reader2.read(), "stream 2 read");
        assert.equal(a.done, false);
        assert.equal(b.done, false);
        assert.equal(typeof a.value, "number");
        assert.equal(typeof b.value, "number");
        got1.push(a.value as number);
        got2.push(b.value as number);
      }

      assert.deepEqual(got1, [100, 101, 102, 103, 104, 105, 106, 107]);
      assert.deepEqual(got2, [200, 201, 202, 203, 204, 205, 206, 207]);

      assert.equal((await withTimeout(reader1.read(), "stream 1 end")).done, true);
      assert.equal((await withTimeout(reader2.read(), "stream 2 end")).done, true);
    } finally {
      await closeAndWait(wire);
    }
  });
});
