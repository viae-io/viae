import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "eventemitter3";
import {
  FrameEncoder,
  Status,
  Via,
  Viae,
  ViaeError,
  WebSocketWire,
  WireState,
  type Context,
  type ViaOptions,
  type Wire,
  type WireServer,
} from "../src/index.js";
import { TestWireServer, noopLog } from "./utils.js";

class TestWire extends EventEmitter implements Wire {
  readyState: WireState;
  readonly url = "test://wire";
  sent: Array<ArrayBuffer | ArrayBufferView> = [];
  closeCalls = 0;
  /** Controllable queued bytes for backpressure tests; undefined = unknown. */
  bufferedAmountValue: number | undefined = undefined;

  get bufferedAmount(): number | undefined {
    return this.bufferedAmountValue;
  }

  constructor(readyState = WireState.OPEN) {
    super();
    this.readyState = readyState;
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== WireState.OPEN) throw new Error("wire is not open");
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
    this.readyState = WireState.CLOSED;
    this.emit("close");
  }
}

class FakeWireServer extends EventEmitter implements WireServer {
}

/**
 * TestWire that answers heartbeat PINGs either as a new peer (PONG) or as a
 * legacy peer (a normal 404 response), like a real remote would.
 */
class ResponderWire extends TestWire {
  pings = 0;
  mode: "pong" | "legacy" = "pong";

  override send(data: ArrayBuffer | ArrayBufferView): void {
    super.send(data);
    let frame: ReturnType<FrameEncoder["decode"]>;
    try {
      frame = encoder.decode(data as Uint8Array);
    } catch {
      return;
    }
    if (frame.head?.method !== "PING") return;
    this.pings++;
    const reply = this.mode === "pong"
      ? { id: frame.id, head: { method: "PONG" } }
      : { id: frame.id, head: { status: 404 }, data: "not found" };
    queueMicrotask(() => {
      if (this.readyState === WireState.OPEN) this.emit("message", encode(reply));
    });
  }
}

const encoder = new FrameEncoder();

function encode(msg: { id: string; head?: Record<string, unknown>; data?: unknown }): Uint8Array {
  return encoder.encodeOwned({ id: msg.id, head: msg.head, data: msg.data });
}

function sentFrames(wire: TestWire) {
  return wire.sent.map(frame => encoder.decode(frame as Uint8Array));
}

function decodeSent(wire: TestWire, index = 0) {
  const data = wire.sent[index];
  assert.ok(data, `expected a sent frame at index ${index}`);
  return encoder.decode(data as Uint8Array);
}

const tick = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe("Via connection lifecycle", () => {
  it("should apply the server timeout to each created Via", async () => {
    const server = new FakeWireServer();
    const viae = new Viae(server, { log: noopLog, timeout: 10 });
    const wire = new TestWire();

    server.emit("connection", wire);
    const via = viae.connections[0];

    await assert.rejects(via.request("GET", "/pending"), /request timeout/);
  });

  it("should reject a pending request when the wire closes", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });
    const pending = via.request("GET", "/pending");

    wire.emit("close");
    await assert.rejects(pending, /wire closed/);
  });

  it("should reject readiness when a connecting wire closes", async () => {
    const wire = new TestWire(WireState.CONNECTING);
    const via = new Via({ wire, log: noopLog });
    const pending = via.ready;

    wire.emit("close");
    await assert.rejects(pending, /wire closed/);
  });

  it("should close the wire after receiving a malformed frame", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });
    const errors: unknown[] = [];
    via.on("error", error => errors.push(error));

    wire.emit("message", Uint8Array.from([0x80]));

    assert.equal(wire.closeCalls, 1);
    assert.equal(errors.length, 1);
  });

  it("should contain a synchronous before-middleware throw and keep processing traffic", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });
    const errors: unknown[] = [];
    via.on("error", error => errors.push(error));

    let shouldThrow = true;
    via.before(() => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("before boom");
      }
      return Promise.resolve();
    });

    let handled = 0;
    via.use(async (ctx: Context) => {
      handled++;
      ctx.out!.head.status = Status.OK;
      ctx.out!.data = "ok";
    });

    // The synchronous throw must not escape the wire listener.
    assert.doesNotThrow(() => {
      wire.emit("message", encode({ id: "a", head: { method: "GET", path: "/a" } }));
    });

    assert.equal(handled, 0, "the throwing message must not reach handlers");
    assert.equal(errors.length, 1, "the throw should be surfaced as an error event");
    await tick();
    assert.equal(via.active.length, 0, "the failed context should be disposed");

    // Subsequent traffic on the same Via must work normally.
    wire.emit("message", encode({ id: "b", head: { method: "GET", path: "/b" } }));
    await tick();

    assert.equal(handled, 1);
    assert.equal(wire.sent.length, 1);
    const response = decodeSent(wire);
    assert.equal(response.head?.status, Status.OK);
    assert.equal(response.data, "ok");
    assert.equal(via.active.length, 0);
  });

  it("should treat a wire error as terminal for pending requests and in-flight streams", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });

    const pending = via.request("GET", "/pending", undefined, { id: "r1" });
    const streamRequest = via.request("GET", "/stream", undefined, { id: "r2", accept: "stream" });
    wire.emit("message", encode({ id: "r2", head: { status: Status.OK, sid: "s1" } }));

    const response = await streamRequest;
    assert.ok(response.data instanceof ReadableStream);
    const reader = (response.data as ReadableStream<unknown>).getReader();
    const reading = reader.read();

    wire.emit("error", new Error("wire exploded"));

    await assert.rejects(pending, /wire exploded/);
    await assert.rejects(reading, /stream transport closed/);

    // A wire error alone does not change readyState; it is still terminal.
    assert.equal(wire.readyState, WireState.OPEN);
  });

  it("should not let an inbound duplicate sid overwrite a pending request interceptor", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });

    const pending = via.request("GET", "/pending", undefined, { id: "dup" });

    // A hostile frame reusing the pending request id as a stream id must be
    // dropped instead of hijacking the request interceptor.
    wire.emit("message", encode({ id: "dup", head: { sid: "dup" } }));
    // The genuine response still resolves the request normally.
    wire.emit("message", encode({ id: "dup", head: { status: Status.OK }, data: "hello" }));

    const response = await pending;
    assert.equal(response.ok, true);
    assert.equal(response.data, "hello");
    await tick();
    assert.equal(via.active.length, 0);
  });

  it("should map unexpected handler errors to 500 internal error", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });
    via.use(async () => { throw new Error("secret detail"); });

    wire.emit("message", encode({ id: "e1", head: { method: "GET", path: "/err" } }));
    await tick();

    const response = decodeSent(wire);
    assert.equal(response.head?.status, Status.Error);
    assert.equal(response.data, "internal error");
  });

  it("should map a guard-thrown ViaeError to its own status and message", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });
    via.use(async () => { throw new ViaeError(Status.Unauthorized, "denied"); });

    wire.emit("message", encode({ id: "e2", head: { method: "GET", path: "/guard" } }));
    await tick();

    const response = decodeSent(wire);
    assert.equal(response.head?.status, Status.Unauthorized);
    assert.equal(response.data, "denied");
  });

  it("should reject an explicit stream accept when the response is an object", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });
    const pending = via.request("GET", "/obj", undefined, { id: "acc1", accept: "stream" });

    wire.emit("message", encode({ id: "acc1", head: { status: Status.OK }, data: "not a stream" }));

    await assert.rejects(pending, /expected stream response but received object/);
  });

  it("should reject an explicit object accept when the response is a stream and cancel it", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });
    const pending = via.request("GET", "/stream", undefined, { id: "acc2", accept: "object" });

    wire.emit("message", encode({ id: "acc2", head: { status: Status.OK, sid: "s9" } }));

    await assert.rejects(pending, /expected object response but received stream/);
    await tick();

    const cancelFrame = sentFrames(wire).find(frame => frame.head?.method === "CANCEL" && frame.id === "s9");
    assert.ok(cancelFrame, "the mismatched response stream should be cancelled");
  });

  it("should cancel an unconsumed response stream on asyncDispose", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });
    const pending = via.request<ReadableStream>("GET", "/stream", undefined, { id: "d1", accept: "stream" });
    wire.emit("message", encode({ id: "d1", head: { status: Status.OK, sid: "sd" } }));

    const response = await pending;
    await response[Symbol.asyncDispose]();

    const cancelFrame = sentFrames(wire).find(frame => frame.head?.method === "CANCEL" && frame.id === "sd");
    assert.ok(cancelFrame, "disposing an unconsumed response stream should cancel it");
  });

  it("should reject on request timeout and cancel the outbound stream body", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 25 });

    let bodyCancelled = false;
    const body = new ReadableStream<number>({
      pull(controller) { controller.enqueue(1); },
      cancel() { bodyCancelled = true; },
    });

    await assert.rejects(
      via.request("POST", "/upload", body, { id: "up1" }),
      /request timeout/,
    );

    await tick(50);
    assert.equal(bodyCancelled, true, "timeout should cancel the in-flight outbound body");
  });

  it("should not cancel the outbound body when the request completes normally", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000, streamOptions: { startTimeout: 0 } });

    let bodyCancelled = false;
    const body = new ReadableStream<number>({
      pull(controller) { controller.enqueue(1); },
      cancel() { bodyCancelled = true; },
    });

    const pending = via.request("POST", "/upload", body, { id: "ok1" });
    await tick();

    const header = sentFrames(wire).find(frame => frame.head?.sid !== undefined);
    assert.ok(header, "expected the outbound stream header frame");
    const sid = header!.head!.sid as string;

    wire.emit("message", encode({ id: sid, head: { method: "START", desiredSize: 1 } }));
    wire.emit("message", encode({ id: "ok1", head: { status: Status.OK }, data: "done" }));

    const response = await pending;
    assert.equal(response.ok, true);
    assert.equal(response.data, "done");

    await tick(30);
    assert.equal(bodyCancelled, false, "normal completion must not cancel the body");
  });

  it("should not crash when an error listener throws", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });
    let malformedListenerCalls = 0;
    via.on("error", () => {
      malformedListenerCalls++;
      throw new Error("listener boom");
    });

    assert.doesNotThrow(() => {
      wire.emit("message", Uint8Array.from([0x80]));
    });
    assert.equal(malformedListenerCalls, 1);

    const wire2 = new TestWire();
    const via2 = new Via({ wire: wire2, log: noopLog });
    let wireErrorListenerCalls = 0;
    via2.on("error", () => {
      wireErrorListenerCalls++;
      throw new Error("listener boom");
    });

    assert.doesNotThrow(() => {
      wire2.emit("error", new Error("wire exploded"));
    });
    assert.equal(wireErrorListenerCalls, 1);
  });
});

describe("Via lifecycle controls", () => {
  it("should enforce a single Via per wire and allow a fresh claim after close", async () => {
    const wire = new TestWire();
    const via1 = new Via({ wire, log: noopLog });

    assert.throws(
      () => new Via({ wire, log: noopLog }),
      /wire is already bound to another Via/,
    );

    const closeCalls = wire.closeCalls;
    await via1.close();
    assert.equal(via1.closed, true);
    assert.equal(wire.closeCalls, closeCalls + 1);

    // The permanent close released the claim, so the wire can be reused.
    const via2 = new Via({ wire, log: noopLog });
    assert.equal(via2.closed, false);
    await via2.close();
  });

  it("should cap in-flight requests with 503 Busy without invoking the handler", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxInflightRequests: 1, timeout: 30_000 });

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const handled: string[] = [];
    via.use(async (ctx: Context) => {
      const path = ctx.in.head.path as string;
      handled.push(path);
      if (path === "/slow") {
        await gate;
        ctx.reply("slow done", { status: Status.OK });
      } else {
        ctx.reply("fast done", { status: Status.OK });
      }
    });

    wire.emit("message", encode({ id: "s1", head: { method: "GET", path: "/slow" } }));
    assert.equal(via.active.length, 1, "the slow request is counted in flight");

    wire.emit("message", encode({ id: "r2", head: { method: "GET", path: "/second" } }));
    wire.emit("message", encode({ id: "r3", head: { method: "GET", path: "/third" } }));
    await tick();

    assert.deepEqual(handled, ["/slow"], "over-cap requests must not reach handlers");
    const busy2 = sentFrames(wire).find(frame => frame.id === "r2");
    assert.equal(busy2?.head?.status, Status.Busy);
    assert.equal(busy2?.data, "busy");
    const busy3 = sentFrames(wire).find(frame => frame.id === "r3");
    assert.equal(busy3?.head?.status, Status.Busy);

    release();
    await tick();

    wire.emit("message", encode({ id: "ok", head: { method: "GET", path: "/after" } }));
    await tick();

    assert.deepEqual(handled, ["/slow", "/after"], "the counter must recover after the slow request completes");
    const slow = sentFrames(wire).find(frame => frame.id === "s1");
    assert.equal(slow?.head?.status, Status.OK);
  });

  it("should refuse an inbound request stream over the connection cap and recover slots", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxStreamsPerConnection: 1, timeout: 30_000 });
    const received: Context[] = [];
    via.use(async (ctx: Context) => {
      // Intercepted stream terminal frames also continue downstream; count
      // only genuine request frames.
      if (ctx.in.head.method === undefined) return;
      received.push(ctx);
      ctx.reply("ok", { status: Status.OK });
    });

    wire.emit("message", encode({ id: "a1", head: { method: "POST", path: "/up", sid: "sa" } }));
    await tick();

    wire.emit("message", encode({ id: "b1", head: { method: "POST", path: "/up", sid: "sb" } }));
    await tick();

    assert.equal(received.length, 1, "the over-cap request must not reach handlers");
    const busy = sentFrames(wire).find(frame => frame.id === "b1");
    assert.equal(busy?.head?.status, Status.Busy);
    assert.equal(busy?.data, "busy");
    const cancel = sentFrames(wire).find(frame => frame.id === "sb" && frame.head?.method === "CANCEL");
    assert.ok(cancel, "the announced remote stream must be cancelled");

    // A terminal frame completes the first stream and frees its slot.
    wire.emit("message", encode({ id: "sa", head: { status: Status.OK } }));
    await tick();

    wire.emit("message", encode({ id: "c1", head: { method: "POST", path: "/up", sid: "sc" } }));
    await tick();
    assert.equal(received.length, 2, "the slot must recover after the first stream completes");

    // Cancelling a stream frees its slot too.
    const second = received[1].in.data as ReadableStream;
    await second.cancel();
    wire.emit("message", encode({ id: "d1", head: { method: "POST", path: "/up", sid: "sd" } }));
    await tick();
    assert.equal(received.length, 3, "the slot must recover after a stream cancel");
  });

  it("should reject a pending request when an inbound response stream exceeds the cap", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxStreamsPerConnection: 1, timeout: 30_000 });

    const first = via.request<ReadableStream>("GET", "/s1", undefined, { id: "q1", accept: "stream" });
    wire.emit("message", encode({ id: "q1", head: { status: Status.OK, sid: "x1" } }));
    const response = await first;
    assert.ok(response.data instanceof ReadableStream);

    const second = via.request("GET", "/s2", undefined, { id: "q2", accept: "stream" });
    wire.emit("message", encode({ id: "q2", head: { status: Status.OK, sid: "x2" } }));

    await assert.rejects(second, (err: unknown) =>
      err instanceof ViaeError && err.status === Status.Busy && err.message === "too many streams");

    const cancel = sentFrames(wire).find(frame => frame.id === "x2" && frame.head?.method === "CANCEL");
    assert.ok(cancel, "the refused stream must be cancelled");

    await response[Symbol.asyncDispose]();
  });

  it("should replace an over-cap handler response stream with 503 Busy", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxStreamsPerConnection: 1, timeout: 30_000 });
    let sourceCancelled = false;
    const source = new ReadableStream({ cancel() { sourceCancelled = true; } });
    via.use(async (ctx: Context) => {
      if (ctx.in.head.path === "/stream") ctx.reply(source, { status: Status.OK });
    });

    // Occupy the single slot with an inbound request stream body.
    wire.emit("message", encode({ id: "occupy", head: { method: "POST", path: "/upload", sid: "occ" } }));
    await tick();

    wire.emit("message", encode({ id: "resp", head: { method: "GET", path: "/stream" } }));
    await tick();

    const response = sentFrames(wire).find(frame => frame.id === "resp");
    assert.equal(response?.head?.status, Status.Busy);
    assert.equal(response?.data, "busy");
    assert.equal(sourceCancelled, true, "the handler-returned stream must be released");
  });

  it("should reject an over-cap request-body stream send with ViaeError Busy", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxStreamsPerConnection: 1, timeout: 30_000 });
    wire.emit("message", encode({ id: "occupy2", head: { method: "POST", path: "/upload", sid: "occ2" } }));
    await tick();

    let bodyCancelled = false;
    const body = new ReadableStream<number>({
      pull() { /* keep the body pending */ },
      cancel() { bodyCancelled = true; },
    });
    await assert.rejects(
      via.request("POST", "/upload2", body, { id: "body1" }),
      (err: unknown) => err instanceof ViaeError && err.status === Status.Busy,
    );
    assert.equal(bodyCancelled, false, "the refused body must not be consumed");
  });

  it("should forward protocolVersion to the frame encoder with Via precedence", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, protocolVersion: 2 });
    await via.send({ id: "pv1", head: { status: Status.OK } });
    const encoderV2 = new FrameEncoder(undefined, { protocolVersion: 2 });
    const frame = encoderV2.decode(wire.sent[0] as Uint8Array);
    assert.equal(frame.head?.v, 2);

    // ViaOptions.protocolVersion wins over frameOptions.protocolVersion (0 disables).
    const wire2 = new TestWire();
    const via2 = new Via({ wire: wire2, log: noopLog, protocolVersion: 0, frameOptions: { protocolVersion: 3 } });
    await via2.send({ id: "pv2", head: { status: Status.OK } });
    assert.equal(decodeSent(wire2).head?.v, undefined);

    await via.close();
    await via2.close();
  });

  it("should not leak a stream slot when a duplicate sid registration throws", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxStreamsPerConnection: 1, timeout: 30_000 });
    const dispose = via.intercept("dup", [async (ctx: Context) => { ctx.reply("user"); }]);

    // Reusing an id already registered makes createIncomingStream throw.
    wire.emit("message", encode({ id: "d1", head: { method: "POST", path: "/up", sid: "dup" } }));
    await tick();

    // A legitimate stream must still fit: the failed registration must not
    // have consumed the single slot.
    wire.emit("message", encode({ id: "g1", head: { method: "POST", path: "/up", sid: "good" } }));
    await tick();

    const start = sentFrames(wire).find(frame => frame.id === "good" && frame.head?.method === "START");
    assert.ok(start, "a legitimate stream must be accepted after the duplicate-sid failure");
    dispose();
  });

  it("should pause sends above maxBufferedBytes and resume once drained", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxBufferedBytes: 4 });
    wire.bufferedAmountValue = 64;

    let settled = false;
    const sent = via.send({ id: "bp1", head: { status: Status.OK }, data: "one" });
    void sent.then(() => { settled = true; });

    await tick(20);
    assert.equal(wire.sent.length, 1, "the frame is written before waiting for the drain");
    assert.equal(settled, false, "the send must wait while the wire reports buffered bytes");

    wire.bufferedAmountValue = 4;
    await sent;
    assert.equal(settled, true);

    wire.bufferedAmountValue = 0;
    await via.send({ id: "bp2", head: { status: Status.OK }, data: "two" });
    assert.equal(wire.sent.length, 2);
  });

  it("should fail a send that is waiting for the buffer when the wire closes", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxBufferedBytes: 4 });
    wire.bufferedAmountValue = 128;

    const sent = via.send({ id: "bp3", head: { status: Status.OK }, data: "stuck" });
    await tick(10);

    wire.close();

    await assert.rejects(sent, /wire is not open/);
  });

  it("should not wait on bufferedAmount when maxBufferedBytes is disabled", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });
    wire.bufferedAmountValue = 10_000_000;

    const outcome = await Promise.race([
      via.send({ id: "bp4", head: { status: Status.OK }, data: "now" }).then(() => "sent" as const),
      tick(50).then(() => "timeout" as const),
    ]);

    assert.equal(outcome, "sent", "disabled backpressure must complete without waiting");
    assert.equal(wire.sent.length, 1);
  });

  it("should close idempotently, reject pending requests and skip public disconnect", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });
    const pending = via.request("GET", "/slow", undefined, { id: "p1" });

    let disconnects = 0;
    let closes = 0;
    via.on("disconnect", () => { disconnects++; });
    via.on("close", () => { closes++; });

    const first = via.close();
    const second = via.close();
    assert.equal(first, second, "close must return the same promise");
    assert.equal(via.closed, true, "closed flips when the terminal path starts");

    await first;
    assert.equal(via.closed, true);
    await assert.rejects(pending, /via closed/);
    assert.equal(disconnects, 0, "an intentional close must not emit public disconnect");
    assert.equal(closes, 1);
    assert.equal(wire.closeCalls, 1);
  });

  it("should wait for an in-flight handler before drain-close resolves", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let completed = false;
    via.use(async (ctx: Context) => {
      await gate;
      completed = true;
      ctx.reply("drained", { status: Status.OK });
    });

    wire.emit("message", encode({ id: "d1", head: { method: "GET", path: "/slow" } }));
    const closing = via.close({ drain: true, drainTimeout: 1000 });

    await tick(20);
    assert.equal(completed, false);
    assert.equal(via.closed, false, "closed must stay false while draining");

    release();
    await closing;

    assert.equal(completed, true);
    assert.equal(via.closed, true);
    const response = sentFrames(wire).find(frame => frame.id === "d1");
    assert.equal(response?.head?.status, Status.OK);
    assert.equal(response?.data, "drained");
  });

  it("should settle a pending stream read when the drain times out", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, timeout: 30_000 });
    // A handler that never completes keeps the drain waiting past its bound.
    via.use(async () => { await new Promise<void>(() => {}); });

    wire.emit("message", encode({ id: "h1", head: { method: "GET", path: "/hang" } }));

    const pending = via.request<ReadableStream>("GET", "/stream", undefined, { id: "st1", accept: "stream" });
    wire.emit("message", encode({ id: "st1", head: { status: Status.OK, sid: "sx" } }));
    const response = await pending;
    assert.ok(response.data instanceof ReadableStream);
    const reading = response.data.getReader().read();

    await via.close({ drain: true, drainTimeout: 20 });

    await assert.rejects(reading, /stream transport closed/);
    assert.equal(via.closed, true);
  });

  it("should validate resource limit options", async () => {
    const wire = new TestWire();
    const invalid: Array<Record<string, number>> = [
      { maxBufferedBytes: -1 },
      { maxBufferedBytes: 1.5 },
      { maxInflightRequests: -1 },
      { maxInflightRequests: Infinity },
      { maxStreamsPerConnection: -1 },
      { maxStreamsPerConnection: 2.5 },
    ];
    for (const opts of invalid) {
      assert.throws(() => new Via({ wire, log: noopLog, ...opts }), RangeError);
    }

    // A constructor that threw must not leak the wire ownership claim.
    const via = new Via({ wire, log: noopLog });
    assert.throws(() => via.close({ drain: true, drainTimeout: -1 }), RangeError);
    assert.throws(() => via.close({ drain: true, drainTimeout: 1.5 }), RangeError);
    assert.throws(() => via.close({ drain: true, drainTimeout: Infinity }), RangeError);
    await via.close();
  });
});

describe("Via heartbeat", () => {
  it("should evict a silent peer within interval + timeout", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, heartbeat: { interval: 20, timeout: 20 } });
    let closes = 0;
    via.on("close", () => { closes++; });

    await tick(150);

    assert.equal(via.closed, true, "a silent peer must be evicted");
    assert.equal(closes, 1);
    assert.equal(wire.closeCalls, 1, "a heartbeat miss closes the wire");
  });

  it("should keep responsive and legacy-404 peers alive across multiple beats", async () => {
    for (const mode of ["pong", "legacy"] as const) {
      const wire = new ResponderWire();
      wire.mode = mode;
      const via = new Via({ wire, log: noopLog, heartbeat: { interval: 10, timeout: 30 } });

      await tick(90);

      assert.equal(via.closed, false, `a ${mode} peer must not be evicted`);
      assert.ok(wire.pings >= 3, `expected at least 3 beats for the ${mode} peer, got ${wire.pings}`);
      await via.close();
    }
  });

  it("should treat inbound traffic as liveness while the PONG is blocked by a saturated buffer", async () => {
    const wire = new TestWire();
    wire.bufferedAmountValue = 64;
    const via = new Via({
      wire,
      log: noopLog,
      heartbeat: { interval: 15, timeout: 30 },
      maxBufferedBytes: 4,
    });

    // Control frames bypass the drain even while the buffer is saturated.
    const control = await Promise.race([
      via.send({ id: "ctl1", head: { method: "PING" } }).then(() => "sent" as const),
      tick(60).then(() => "timeout" as const),
    ]);
    assert.equal(control, "sent", "control frames must bypass maxBufferedBytes");

    // The peer is actively sending, but its PONG is stuck behind buffered
    // data; its other frames must keep the beat alive.
    let keepAlives = 0;
    const timer = setInterval(() => {
      wire.emit("message", encode({ id: `ka${keepAlives++}`, head: { method: "PONG" } }));
    }, 8);
    try {
      await tick(110);
      assert.equal(via.closed, false, "an actively-sending peer must not be evicted");
      assert.ok(
        sentFrames(wire).some(frame => frame.head?.method === "PING"),
        "beats must still be sent while the buffer is saturated",
      );
    } finally {
      clearInterval(timer);
      await via.close();
    }
  });

  it("should answer PING with PONG and absorb PONG even when heartbeat is off", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog });

    wire.emit("message", encode({ id: "hb1", head: { method: "PING" } }));
    wire.emit("message", encode({ id: "hb2", head: { method: "PONG" } }));
    await tick();

    const pong = sentFrames(wire).find(frame => frame.id === "hb1");
    assert.equal(pong?.head?.method, "PONG", "PING must always be answered");
    assert.equal(sentFrames(wire).some(frame => frame.id === "hb2"), false, "PONG must be absorbed");
    await via.close();
  });

  it("should answer PING while the inflight cap is saturated", async () => {
    const wire = new TestWire();
    const via = new Via({ wire, log: noopLog, maxInflightRequests: 1, timeout: 30_000 });

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    via.use(async () => { await gate; });

    wire.emit("message", encode({ id: "slow", head: { method: "GET", path: "/slow" } }));
    wire.emit("message", encode({ id: "hb3", head: { method: "PING" } }));
    await tick();

    assert.equal(sentFrames(wire).find(frame => frame.id === "hb3")?.head?.method, "PONG");
    release();
    await tick();
    await via.close();
  });

  it("should validate heartbeat and reconnect options", async () => {
    const wire = new TestWire();
    const invalid: Array<Omit<ViaOptions, "wire">> = [
      { heartbeat: { interval: 0 } },
      { heartbeat: { interval: -1 } },
      { heartbeat: { interval: Number.POSITIVE_INFINITY } },
      { heartbeat: { timeout: 0 } },
      { heartbeat: { timeout: Number.NaN } },
      { reconnect: { wire: () => new TestWire(), minDelay: -1 } },
      { reconnect: { wire: () => new TestWire(), maxDelay: Number.POSITIVE_INFINITY } },
      { reconnect: { wire: () => new TestWire(), factor: 0 } },
      { reconnect: { wire: () => new TestWire(), jitter: 1.5 } },
      { reconnect: { wire: () => new TestWire(), jitter: -0.1 } },
      { reconnect: { wire: () => new TestWire(), maxAttempts: 0 } },
      { reconnect: { wire: () => new TestWire(), maxAttempts: 1.5 } },
    ];
    for (const opts of invalid) {
      assert.throws(() => new Via({ wire, log: noopLog, ...opts }), RangeError);
    }

    // Boundary values are accepted; a throwing constructor must not leak the
    // ownership claim.
    const via = new Via({
      wire,
      log: noopLog,
      heartbeat: { interval: 1, timeout: 1 },
      reconnect: {
        wire: () => new TestWire(),
        minDelay: 0,
        maxDelay: 0,
        factor: 0.5,
        jitter: 1,
        maxAttempts: Number.POSITIVE_INFINITY,
      },
    });
    await via.close();
  });
});

describe("Via reconnect", () => {
  it("should survive forced drops, reject in-flight requests per drop and re-arm heartbeat", async () => {
    const wires: ResponderWire[] = [];
    const makeWire = () => {
      const wire = new ResponderWire();
      wires.push(wire);
      return wire;
    };
    const via = new Via({
      wire: makeWire(),
      log: noopLog,
      timeout: 30_000,
      heartbeat: { interval: 10, timeout: 50 },
      reconnect: { wire: makeWire, minDelay: 2, maxDelay: 4, jitter: 0 },
    });

    let reconnected = 0;
    let disconnects = 0;
    via.on("reconnected", () => { reconnected++; });
    via.on("disconnect", () => { disconnects++; });

    // Drop 1: the in-flight request rejects and is never replayed.
    const pending1 = via.request("GET", "/one", undefined, { id: "r1" });
    await tick(); // let the request frame reach the wire before dropping it
    wires[0].close();
    await assert.rejects(pending1, /wire closed/);
    assert.equal(via.closed, false);
    assert.equal(disconnects, 1);

    await via.ready;
    assert.equal(reconnected, 1);
    const wire2 = wires[1];
    assert.ok(wire2, "the factory must have produced a replacement wire");
    assert.notEqual(wire2, wires[0]);

    // Post-reconnect requests succeed.
    const ok1 = via.request("GET", "/two", undefined, { id: "r2" });
    wire2.emit("message", encode({ id: "r2", head: { status: Status.OK }, data: "two" }));
    assert.equal((await ok1).data, "two");

    // Heartbeat is re-armed on the fresh wire.
    await tick(40);
    assert.ok(wire2.pings >= 1, "heartbeat must be re-armed after reconnect");

    // Drop 2.
    const pending2 = via.request("GET", "/three", undefined, { id: "r3" });
    await tick();
    wire2.close();
    await assert.rejects(pending2, /wire closed/);
    await via.ready;
    assert.equal(reconnected, 2);
    assert.equal(disconnects, 2);

    const wire3 = wires[2];
    assert.ok(wire3, "a second replacement wire must exist");
    const ok2 = via.request("GET", "/four", undefined, { id: "r4" });
    wire3.emit("message", encode({ id: "r4", head: { status: Status.OK }, data: "four" }));
    assert.equal((await ok2).data, "four");

    await via.close();
    assert.equal(via.closed, true);
  });

  it("should abort active streams on a transient drop", async () => {
    const wires: TestWire[] = [];
    wires[0] = new TestWire();
    const via = new Via({
      wire: wires[0],
      log: noopLog,
      timeout: 30_000,
      reconnect: {
        wire: () => {
          const wire = new TestWire();
          wires.push(wire);
          return wire;
        },
        minDelay: 2,
        maxDelay: 2,
        jitter: 0,
      },
    });

    const pending = via.request<ReadableStream>("GET", "/stream", undefined, { id: "s1", accept: "stream" });
    wires[0].emit("message", encode({ id: "s1", head: { status: Status.OK, sid: "sid1" } }));
    const response = await pending;
    const reading = (response.data as ReadableStream<unknown>).getReader().read();

    wires[0].close();

    await assert.rejects(reading, /stream transport closed/);
    assert.equal(via.closed, false, "the Via survives a transient drop");
    await via.ready;
    assert.equal(via.wire, wires[1]);
    await via.close();
  });

  it("should stop retrying and reject ready when attempts are exhausted", async () => {
    const wire = new TestWire();
    let factoryCalls = 0;
    const via = new Via({
      wire,
      log: noopLog,
      reconnect: {
        wire: () => {
          factoryCalls++;
          throw new Error("no replacement");
        },
        minDelay: 1,
        maxDelay: 2,
        jitter: 0,
        maxAttempts: 2,
      },
    });

    wire.close();
    const ready = assert.rejects(via.ready, /reconnect attempts exhausted/);

    await tick(60);

    assert.equal(via.closed, true);
    assert.equal(factoryCalls, 2, "exactly maxAttempts retries are started");
    await ready;

    await tick(40);
    assert.equal(factoryCalls, 2, "no further retries after exhaustion");
  });

  it("should stop the retry loop when close() is called during a retry", async () => {
    const wire = new TestWire();
    let factoryCalls = 0;
    const via = new Via({
      wire,
      log: noopLog,
      reconnect: {
        wire: () => {
          factoryCalls++;
          return new TestWire();
        },
        minDelay: 60,
        maxDelay: 60,
        jitter: 0,
      },
    });

    wire.close();
    await tick(5);
    assert.equal(factoryCalls, 0, "the first retry waits for the backoff");

    await via.close();
    assert.equal(via.closed, true);

    await tick(100);
    assert.equal(factoryCalls, 0, "a closed Via must not start retries");
  });

  it("should ignore stale-wire events after a rebind", async () => {
    const wire1 = new TestWire();
    const wire2 = new TestWire();
    const via = new Via({
      wire: wire1,
      log: noopLog,
      timeout: 30_000,
      reconnect: { wire: () => wire2, minDelay: 1, maxDelay: 1, jitter: 0 },
    });

    wire1.close();
    await via.ready;
    assert.equal(via.wire, wire2);
    assert.equal(via.closed, false);

    // Late events from the dead wire must not kill the fresh connection.
    wire1.emit("close");
    wire1.emit("error", new Error("stale boom"));
    await tick(10);
    assert.equal(via.closed, false);

    const pending = via.request("GET", "/fresh", undefined, { id: "f1" });
    wire2.emit("message", encode({ id: "f1", head: { status: Status.OK }, data: "fresh" }));
    assert.equal((await pending).data, "fresh");
    await via.close();
  });

  it("should not retry a permanent protocol failure", async () => {
    const wire = new TestWire();
    let factoryCalls = 0;
    const via = new Via({
      wire,
      log: noopLog,
      reconnect: {
        wire: () => {
          factoryCalls++;
          return new TestWire();
        },
        minDelay: 1,
        maxDelay: 1,
        jitter: 0,
      },
    });
    const errors: unknown[] = [];
    via.on("error", error => errors.push(error));

    const v2 = new FrameEncoder(undefined, { protocolVersion: 2 });
    wire.emit("message", v2.encodeOwned({ id: "bad", head: { method: "GET", path: "/x" } }));

    await tick(40);

    assert.equal(via.closed, true);
    assert.equal(factoryCalls, 0, "protocol failures must never trigger a retry");
    assert.equal(wire.closeCalls, 1);
    assert.match(String(errors[0]), /unsupported protocol version/);
  });

  it("should leave no wire listeners or heartbeat frames after close", async () => {
    const wire = new ResponderWire();
    const via = new Via({
      wire,
      log: noopLog,
      heartbeat: { interval: 5, timeout: 20 },
      reconnect: { wire: () => new ResponderWire(), minDelay: 1, maxDelay: 2, jitter: 0 },
    });

    await tick(30);
    assert.ok(wire.pings >= 1, "heartbeat must have run before close");

    await via.close();

    assert.equal(wire.listenerCount("message"), 0);
    assert.equal(wire.listenerCount("open"), 0);
    assert.equal(wire.listenerCount("close"), 0);
    assert.equal(wire.listenerCount("error"), 0);

    const sentAfterClose = wire.sent.length;
    await tick(40);
    assert.equal(wire.sent.length, sentAfterClose, "no heartbeat frames after close");
    assert.equal(via.closed, true);
  });
});

describe("WebSocketWire", () => {
  it("should connect, guard sends before open and tolerate double close", async () => {
    const server = new TestWireServer();
    const addr = await server.listen(0, "localhost");
    try {
      const wire = new WebSocketWire();
      assert.throws(() => wire.send(new Uint8Array([1])), /wire is not open/);

      await wire.connect(`ws://localhost:${addr.port}`);
      assert.equal(wire.readyState, WireState.OPEN);

      wire.send(Uint8Array.from([1, 2, 3]));

      assert.doesNotThrow(() => {
        wire.close();
        wire.close();
      });
      assert.notEqual(wire.readyState, WireState.OPEN);
    } finally {
      await server.close();
    }
  });

  it("should reject when the connection is refused", async () => {
    const wire = new WebSocketWire();
    await assert.rejects(wire.connect("ws://127.0.0.1:1"));
    assert.notEqual(wire.readyState, WireState.OPEN);
  });
});
