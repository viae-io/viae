/**
 * Connection lifecycle end-to-end tests (plan L6): heartbeat, reconnect,
 * protocol version, `maxCredit` and multi-connection drain over real
 * WebSocket sockets.
 *
 * Deliberately not duplicated here (already covered):
 * - stub-level heartbeat/reconnect/backpressure cases in `test/via.spec.ts`;
 * - single-connection `Viae.close` drain and `maxConnections` in
 *   `test/viae.spec.ts`.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import {
  Api,
  FrameEncoder,
  Status,
  Via,
  Viae,
  WebSocketWire,
  WireState,
  type Wire,
} from "../src/index.js";
import { TestWireServer, closeAndWait, createTestClient, noopLog } from "./utils.js";

/** Reject explicitly when `promise` does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, label: string, ms = 2000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Poll until `predicate` is true; reject explicitly on timeout (never hangs). */
async function waitFor(predicate: () => boolean, label: string, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`${label} was not satisfied within ${ms}ms`);
    await delay(10);
  }
}

/** Default v1 codec used to introspect captured socket frames. */
const encoder = new FrameEncoder();

type DecodedFrame = ReturnType<FrameEncoder["decode"]>;

/** Normalise the ArrayBuffer/Buffer payloads `ws` delivers into bytes. */
function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

/**
 * Decode every frame arriving on `wire` and hand it to `onFrame`. Decode
 * failures are recorded instead of thrown so a listener can never crash the
 * test process; callers assert the error list stays empty.
 */
function observeFrames(
  wire: Wire,
  onFrame: (frame: DecodedFrame) => void,
  decodeErrors: unknown[],
): void {
  wire.on("message", data => {
    try {
      onFrame(encoder.decode(toBytes(data)));
    } catch (err) {
      decodeErrors.push(err);
    }
  });
}

describe("Connection lifecycle e2e", () => {
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

  it("heartbeat: evicts a silent peer and closes the wire once with no disconnect", async () => {
    // No Viae is attached: nothing answers PING.
    const { via, wire } = await createTestClient(port, "localhost", {
      heartbeat: { interval: 50, timeout: 50 },
    });

    let closes = 0;
    let disconnects = 0;
    via.on("close", () => { closes++; });
    via.on("disconnect", () => { disconnects++; });

    const startedAt = Date.now();
    try {
      await waitFor(() => via.closed, "silent peer evicted by heartbeat", 2000);
      const elapsed = Date.now() - startedAt;
      assert.ok(
        elapsed < 1000,
        `eviction must happen within interval + timeout + slack (took ${elapsed}ms)`,
      );

      await waitFor(() => wire.readyState === WireState.CLOSED, "client wire reaches CLOSED", 2000);
      assert.equal(closes, 1, "the public close event must fire exactly once");
      assert.equal(disconnects, 0, "a permanent heartbeat close must not emit disconnect");
    } finally {
      await closeAndWait(wire);
    }
  });

  it("heartbeat: a responsive Viae peer stays alive across beats and keeps serving requests", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({ path: "/ping", handler: () => "pong" });
    viae.use(api);

    const decodeErrors: unknown[] = [];
    let pings = 0;
    server.on("connection", (wire: Wire) => {
      observeFrames(wire, frame => {
        if (frame.head?.method === "PING") pings++;
      }, decodeErrors);
    });

    const { via, wire } = await createTestClient(port, "localhost", {
      heartbeat: { interval: 50, timeout: 100 },
    });
    try {
      // Three PINGs prove the beat settled at least twice; a single missed
      // PONG would evict the connection after timeout (100ms).
      await waitFor(() => pings >= 3, "at least three heartbeat PINGs on the server wire", 3000);
      assert.equal(decodeErrors.length, 0, "every inbound frame must decode");
      assert.equal(via.closed, false, "a responsive peer must not be evicted");
      assert.equal(wire.readyState, WireState.OPEN, "the client wire must still be OPEN");

      const result = await withTimeout(
        via.request<string>("GET", "/ping"),
        "request after several beats",
        2000,
      );
      assert.equal(result.ok, true);
      assert.equal(result.data, "pong");
    } finally {
      await withTimeout(viae.close({ drainTimeout: 1000 }), "server close", 3000);
      await withTimeout(via.close(), "client close", 3000);
    }
  });

  it("reconnect: survives two forced drops, re-arms heartbeat and serves requests after each reconnect", async () => {
    const url = `ws://localhost:${port}`;
    const wires: WebSocketWire[] = [];
    const serverWires: Wire[] = [];
    const decodeErrors: unknown[] = [];
    server.on("connection", (wire: Wire) => { serverWires.push(wire); });

    let handlerStarts = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });

    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({
      path: "/slow",
      handler: async () => {
        handlerStarts++;
        await gate;
        return "slow-done";
      },
    });
    api.get({ path: "/echo", handler: ({ data }) => `echo:${String(data)}` });
    viae.use(api);

    const makeWire = async (): Promise<Wire> => {
      const wire = new WebSocketWire();
      await wire.connect(url);
      wires.push(wire);
      return wire;
    };

    const firstWire = await makeWire();
    const via = new Via({
      wire: firstWire,
      log: noopLog,
      timeout: 30_000,
      heartbeat: { interval: 50, timeout: 200 },
      reconnect: { wire: makeWire, minDelay: 20, maxDelay: 20, factor: 1, jitter: 0, maxAttempts: 10 },
    });

    let reconnected = 0;
    let disconnects = 0;
    via.on("reconnected", () => { reconnected++; });
    via.on("disconnect", () => { disconnects++; });

    try {
      await withTimeout(via.ready, "initial ready", 3000);

      for (let drop = 1; drop <= 2; drop++) {
        const pending = via.request<string>("GET", "/slow");
        await waitFor(() => handlerStarts >= drop, `server /slow handler start #${drop}`, 2000);

        const currentServerWire = serverWires[serverWires.length - 1];
        assert.ok(currentServerWire, `server wire #${drop} must be captured`);
        currentServerWire.close();

        await assert.rejects(
          withTimeout(pending, `in-flight request drop #${drop}`, 3000),
          /wire closed/,
          `the in-flight request must reject on drop #${drop}`,
        );
        assert.equal(via.closed, false, `drop #${drop} must be transient`);
        assert.equal(disconnects, drop, `disconnect must fire once per drop (#${drop})`);

        await waitFor(() => reconnected >= drop, `reconnect #${drop}`, 3000);
        await waitFor(() => serverWires.length >= drop + 1, `server accepted reconnect #${drop}`, 2000);
        assert.equal(via.closed, false, "the Via must stay open across a transient drop");

        const echo = await withTimeout(
          via.request<string>("GET", "/echo", `drop-${drop}`),
          `echo after reconnect #${drop}`,
          2000,
        );
        assert.equal(echo.ok, true, `echo #${drop} must succeed`);
        assert.equal(echo.data, `echo:drop-${drop}`);
      }

      assert.equal(wires.length, 3, "the factory must have produced two replacement wires");

      // Heartbeat must be re-armed on the newest wire after the second rebind.
      const newestServerWire = serverWires[serverWires.length - 1];
      assert.ok(newestServerWire, "newest server wire must be captured");
      let pings = 0;
      observeFrames(newestServerWire, frame => {
        if (frame.head?.method === "PING") pings++;
      }, decodeErrors);
      await waitFor(() => pings >= 1, "heartbeat PING after the second reconnect", 2000);
      assert.equal(decodeErrors.length, 0, "every inbound frame must decode");
      assert.equal(via.closed, false, "the re-armed heartbeat must not evict a responsive peer");

      await withTimeout(via.close(), "final via.close", 3000);
    } finally {
      releaseGate();
      await withTimeout(via.close(), "finally via.close", 3000);
      await withTimeout(viae.close({ drainTimeout: 2000 }), "finally viae.close", 4000);
    }
  });

  it("protocol version: a default v1 client permanently fails against a v2 server", async () => {
    const viae = new Viae(server, { log: noopLog, protocolVersion: 2 });
    const api = new Api("/");
    api.get({ path: "/hello", handler: () => "hello" });
    viae.use(api);

    const serverWires: Wire[] = [];
    server.on("connection", (wire: Wire) => { serverWires.push(wire); });

    const { via, wire } = await createTestClient(port);
    try {
      await assert.rejects(
        withTimeout(via.request<string>("GET", "/hello"), "mismatched request", 3000),
        /wire closed/,
        "the request must reject when the server rejects the frame version",
      );

      await waitFor(() => via.closed, "client closes permanently on protocol mismatch", 2000);
      assert.equal(serverWires.length, 1, "the server must have accepted exactly one socket");
      await waitFor(
        () => serverWires[0]!.readyState === WireState.CLOSED,
        "server connection closed",
        3000,
      );
      await waitFor(() => viae.connections.length === 0, "server connection removed", 3000);
    } finally {
      await closeAndWait(wire);
    }
  });

  it("protocol version: 0 on both peers interoperates without a version field", async () => {
    const viae = new Viae(server, { log: noopLog, protocolVersion: 0 });
    const api = new Api("/");
    api.get({ path: "/hello", handler: () => "legacy" });
    viae.use(api);

    const { via, wire } = await createTestClient(port, "localhost", { protocolVersion: 0 });
    try {
      const result = await withTimeout(
        via.request<string>("GET", "/hello"),
        "protocolVersion 0 request",
        2000,
      );
      assert.equal(result.ok, true);
      assert.equal(result.data, "legacy");
    } finally {
      await closeAndWait(wire);
    }
  });

  it("protocol version: a legacy v-less frame is accepted by a default v1 server over a raw socket", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({ path: "/hello", handler: () => "hi" });
    viae.use(api);

    const legacyEncoder = new FrameEncoder(undefined, { protocolVersion: 0 });
    const ws = new WebSocket(`ws://localhost:${port}`);
    const socketErrors: unknown[] = [];
    ws.on("error", err => socketErrors.push(err));

    try {
      await withTimeout(new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      }), "raw socket open", 2000);

      const reply = new Promise<DecodedFrame>((resolve, reject) => {
        ws.once("message", data => {
          try {
            resolve(legacyEncoder.decode(
              data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer),
            ));
          } catch (err) {
            reject(err);
          }
        });
      });

      ws.send(legacyEncoder.encodeOwned({
        id: "legacy-1",
        head: { method: "GET", path: "/hello" },
        data: undefined,
      }));

      const frame = await withTimeout(reply, "legacy frame reply", 2000);
      assert.equal(frame.id, "legacy-1", "the reply must carry the request id");
      assert.equal(frame.head?.status, Status.OK);
      assert.equal(frame.data, "hi");
      assert.equal(frame.head?.v, 1, "the default server must emit v:1 on a non-empty reply head");
      assert.equal(socketErrors.length, 0, "the raw socket must not error");
    } finally {
      ws.close();
    }
  });

  it("maxCredit: both peers configured at 2 stream all 7 ordered chunks across multiple windows", async () => {
    const viae = new Viae(server, { log: noopLog, streamOptions: { maxCredit: 2 } });
    const api = new Api("/");
    api.get({
      path: "/count",
      accept: "stream",
      handler: () => new ReadableStream<number>({
        start(controller) {
          for (let i = 0; i < 7; i++) controller.enqueue(i);
          controller.close();
        },
      }),
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port, "localhost", {
      streamOptions: { maxCredit: 2 },
    });
    try {
      const result = await withTimeout(
        via.request<ReadableStream<number>>("GET", "/count", undefined, { accept: "stream" }),
        "maxCredit stream request",
        3000,
      );
      assert.equal(result.ok, true);

      const reader = (result.data as ReadableStream<number>).getReader();
      const values: number[] = [];
      for (;;) {
        const next = await withTimeout(reader.read(), "maxCredit stream chunk", 3000);
        if (next.done) break;
        values.push(next.value as number);
      }
      assert.deepEqual(values, [0, 1, 2, 3, 4, 5, 6]);
    } finally {
      await closeAndWait(wire);
    }
  });

  it("maxCredit: a default client over-granting is failed fast by a maxCredit server", async () => {
    const viae = new Viae(server, { log: noopLog, streamOptions: { maxCredit: 2 } });
    const api = new Api("/");
    api.get({
      path: "/count",
      accept: "stream",
      handler: () => new ReadableStream<number>({
        start(controller) {
          controller.enqueue(1);
          controller.close();
        },
      }),
    });
    viae.use(api);

    // Default client: its first START grants the built-in 32-credit window.
    const { via, wire } = await createTestClient(port);
    try {
      const result = await withTimeout(
        via.request<ReadableStream<number>>("GET", "/count", undefined, { accept: "stream" }),
        "mismatched maxCredit stream request",
        3000,
      );
      assert.equal(result.ok, true);

      const reader = (result.data as ReadableStream<number>).getReader();
      const readError = await withTimeout(
        reader.read().then(() => undefined, (err: unknown) => err),
        "mismatched maxCredit stream read",
        3000,
      );
      assert.notEqual(readError, undefined, "the mismatched stream read must reject");
      assert.match(String(readError), /exceeds maxCredit/);
    } finally {
      await closeAndWait(wire);
    }
  });

  it("Viae.close: drains two in-flight requests on two connections, then closes both wires", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    let starts = 0;
    api.get({
      path: "/slow",
      handler: async () => {
        starts++;
        await delay(200);
        return "done";
      },
    });
    viae.use(api);

    const first = await createTestClient(port);
    const second = await createTestClient(port);
    try {
      await waitFor(() => viae.connections.length === 2, "both server connections registered", 3000);

      const firstRequest = first.via.request<string>("GET", "/slow");
      const secondRequest = second.via.request<string>("GET", "/slow");
      await waitFor(() => starts === 2, "both slow handlers started", 3000);

      const startedAt = Date.now();
      const closing = viae.close({ drainTimeout: 2000 });
      const [firstResult, secondResult] = await Promise.all([
        withTimeout(firstRequest, "first drained request", 3000),
        withTimeout(secondRequest, "second drained request", 3000),
      ]);
      assert.equal(firstResult.ok, true);
      assert.equal(firstResult.data, "done");
      assert.equal(secondResult.ok, true);
      assert.equal(secondResult.data, "done");

      await withTimeout(closing, "viae.close", 3000);
      const elapsed = Date.now() - startedAt;
      assert.ok(
        elapsed >= 150,
        `close() must wait for both in-flight handlers (took ${elapsed}ms)`,
      );
      assert.equal(viae.closed, true);

      await waitFor(() => first.wire.readyState === WireState.CLOSED, "first client wire closed", 3000);
      await waitFor(() => second.wire.readyState === WireState.CLOSED, "second client wire closed", 3000);
      await waitFor(() => viae.connections.length === 0, "server connections emptied", 3000);
    } finally {
      await closeAndWait(first.wire);
      await closeAndWait(second.wire);
    }
  });
});
