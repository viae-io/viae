/**
 * Viae server lifecycle tests (plan L4): `maxConnections`, `close({drainTimeout})`,
 * options passthrough. Socket-level, using `TestWireServer` / `createTestClient`.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import {
  Api,
  Status,
  Viae,
  WebSocketWire,
  WireState,
  type Via,
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

/** Wrap a raw client socket so its close state is observable as a `Wire`. */
function wrapClientSocket(url: string): Wire {
  return WebSocketWire.wrap(new WebSocket(url) as unknown as globalThis.WebSocket);
}

describe("Viae lifecycle", () => {
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

  it("maxConnections: 1 closes the excess client without a Via or connection event; the first keeps working", async () => {
    const viae = new Viae(server, { log: noopLog, maxConnections: 1 });
    const api = new Api("/");
    api.get({ path: "/ping", handler: () => "pong" });
    viae.use(api);

    const events: Via[] = [];
    viae.on("connection", connection => events.push(connection));

    const first = await createTestClient(port);
    try {
      assert.equal(events.length, 1, "the first connection must emit");
      assert.equal(viae.connections.length, 1);

      const excess = wrapClientSocket(`ws://localhost:${port}`);
      await waitFor(
        () => excess.readyState === WireState.CLOSED,
        "excess connection closed by the server",
        3000,
      );

      assert.equal(events.length, 1, "no connection event for the excess connection");
      assert.equal(viae.connections.length, 1, "no Via for the excess connection");

      const result = await withTimeout(first.via.request<string>("GET", "/ping"), "first request");
      assert.equal(result.ok, true);
      assert.equal(result.data, "pong");
    } finally {
      await closeAndWait(first.wire);
    }
  });

  it("rejects invalid maxConnections in the constructor", () => {
    assert.throws(() => new Viae(server, { maxConnections: -1 }), RangeError);
    assert.throws(() => new Viae(server, { maxConnections: 1.5 }), RangeError);
    assert.throws(() => new Viae(server, { maxConnections: Number.NaN }), RangeError);
  });

  it("close({ drainTimeout }) waits for an in-flight request, then closes the connection", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({
      path: "/slow",
      handler: async () => {
        markStarted();
        await delay(150);
        return "done";
      },
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      await waitFor(() => viae.connections.length === 1, "server connection registered");

      const request = via.request<string>("GET", "/slow");
      await withTimeout(started, "handler start");

      const closeStarted = Date.now();
      const closing = viae.close({ drainTimeout: 2000 });
      const result = await withTimeout(request, "drained request", 3000);
      assert.equal(result.ok, true);
      assert.equal(result.data, "done");

      await withTimeout(closing, "viae.close", 3000);
      const elapsed = Date.now() - closeStarted;
      assert.ok(elapsed >= 100, `close() must wait for the in-flight handler (took ${elapsed}ms)`);
      assert.equal(viae.closed, true);

      await waitFor(() => wire.readyState === WireState.CLOSED, "client wire closed by server", 3000);
      await waitFor(() => viae.connections.length === 0, "server connection removed");
    } finally {
      await closeAndWait(wire);
    }
  });

  it("refuses a client that connects after close() and reports closed", async () => {
    const viae = new Viae(server, { log: noopLog });
    const events: Via[] = [];
    viae.on("connection", connection => events.push(connection));

    await withTimeout(viae.close(), "viae.close");
    assert.equal(viae.closed, true);

    const late = wrapClientSocket(`ws://localhost:${port}`);
    await waitFor(
      () => late.readyState === WireState.CLOSED,
      "late connection closed by the server",
      3000,
    );

    assert.equal(events.length, 0, "no connection event after close()");
    assert.equal(viae.connections.length, 0);
  });

  it("close() is idempotent and returns a single promise", async () => {
    const viae = new Viae(server, { log: noopLog });
    const { wire } = await createTestClient(port);
    try {
      await waitFor(() => viae.connections.length === 1, "server connection registered");

      const first = viae.close();
      const second = viae.close({ drainTimeout: 123 });
      assert.equal(first, second, "subsequent close() calls return the stored promise");
      assert.equal(viae.closed, true);

      await withTimeout(first, "first close");
      const third = viae.close();
      assert.equal(third, first, "close() stays idempotent after it has resolved");
      await withTimeout(third, "third close");

      await waitFor(() => wire.readyState === WireState.CLOSED, "client wire closed by server");
      await waitFor(() => viae.connections.length === 0, "server connection removed");
    } finally {
      await closeAndWait(wire);
    }
  });

  it("close() with an active stream settles within drainTimeout and the stream read settles", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");
    api.get({
      path: "/infinite",
      accept: "stream",
      handler: () => {
        let i = 0;
        return new ReadableStream<number>({
          pull(controller) { controller.enqueue(i++); },
        });
      },
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      const result = await withTimeout(
        via.request<ReadableStream<number>>("GET", "/infinite", undefined, { accept: "stream" }),
        "stream request",
      );
      assert.equal(result.ok, true);
      const reader = (result.data as ReadableStream<number>).getReader();
      const firstChunk = await withTimeout(reader.read(), "first chunk");
      assert.equal(firstChunk.done, false);

      const drainTimeout = 300;
      const startedAt = Date.now();
      await withTimeout(viae.close({ drainTimeout }), "viae.close with an active stream", 3000);
      const elapsed = Date.now() - startedAt;
      assert.ok(
        elapsed >= 150,
        `close() must drain-wait before force-aborting the stream (took ${elapsed}ms)`,
      );

      const outcome = await withTimeout(
        reader.read().then(() => "settled", () => "settled"),
        "stream read after close",
      );
      assert.equal(outcome, "settled");
      await waitFor(() => viae.connections.length === 0, "server connection removed after drain expiry");
    } finally {
      await closeAndWait(wire);
    }
  });

  it("forwards maxInflightRequests to each connection (503 for a second concurrent request)", async () => {
    const viae = new Viae(server, { log: noopLog, maxInflightRequests: 1 });
    const api = new Api("/");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    api.get({
      path: "/slow",
      handler: async () => {
        markStarted();
        await gate;
        return "ok";
      },
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port);
    try {
      const first = via.request<string>("GET", "/slow");
      await withTimeout(started, "first handler start");

      const second = await withTimeout(via.request("GET", "/slow"), "second request");
      assert.equal(second.ok, false);
      assert.equal(second.head.status, Status.Busy);

      release();
      const firstResult = await withTimeout(first, "first request");
      assert.equal(firstResult.ok, true);
      assert.equal(firstResult.data, "ok");
    } finally {
      await closeAndWait(wire);
    }
  });
});
