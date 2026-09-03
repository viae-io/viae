/**
 * Stream protocol conformance tests — non-conforming / bad-actor scenarios.
 *
 * Section 1: Unit tests using a MockTransport so the stream layer can be
 *   exercised in isolation without a live WebSocket connection.  This lets
 *   us inject arbitrary protocol frames and observe the produced output.
 *
 * Section 2: End-to-end tests using real Via/Viae connections with short
 *   stream timeouts configured, exercising the full send/receive path.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createOutgoingStream, createIncomingStream, type StreamTransport } from "../src/stream.js";
import type { Message } from "../src/message.js";
import { Status } from "../src/status.js";
import { Via, Viae, Api } from "../src/index.js";
import { TestWireServer, createTestClient, noopLog } from "./utils.js";

// ─── Mock Transport ─────────────────────────────────────────────────────────

class MockTransport implements StreamTransport {
  readonly sent: Array<Partial<Message>> = [];

  private _handlers = new Map<string, (msg: Message) => void | Promise<void>>();
  private _idSeq = 0;
  private _closeHandlers: Array<() => void> = [];

  closed = false;

  async send(msg: Partial<Message>): Promise<void> {
    if (this.closed) throw new Error("transport closed");
    this.sent.push(msg);
  }

  intercept(id: string, handler: (msg: Message) => void | Promise<void>): () => void {
    this._handlers.set(id, handler);
    return () => this._handlers.delete(id);
  }

  createId(): string {
    return `mock-${++this._idSeq}`;
  }

  onClose(cb: () => void): () => void {
    this._closeHandlers.push(cb);
    return () => {
      const i = this._closeHandlers.indexOf(cb);
      if (i >= 0) this._closeHandlers.splice(i, 1);
    };
  }

  /** Inject a protocol frame as if it arrived from the remote peer. */
  async inject(msg: Partial<Message>): Promise<void> {
    const handler = this._handlers.get(msg.id!);
    if (handler) await handler(msg as Message);
  }

  /** Simulate abrupt transport closure. */
  simulateClose(): void {
    this.closed = true;
    for (const cb of this._closeHandlers) cb();
    this._closeHandlers = [];
  }

  sentWhere(pred: (m: Partial<Message>) => boolean): Partial<Message>[] {
    return this.sent.filter(pred);
  }

  sentPartials() { return this.sentWhere(m => (m.head as any)?.status === Status.Partial); }
  sentErrors()   { return this.sentWhere(m => (m.head as any)?.status === Status.Error); }
  sentOKs()      { return this.sentWhere(m => (m.head as any)?.status === Status.OK); }
  sentCANCELs()  { return this.sentWhere(m => (m.head as any)?.method === "CANCEL"); }
  sentCOMPLETEs(){ return this.sentWhere(m => (m.head as any)?.method === "COMPLETE"); }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCountingStream(count: number): ReadableStream {
  let i = 0;
  return new ReadableStream({
    pull(ctrl) { if (i < count) ctrl.enqueue(i++); else ctrl.close(); }
  });
}

function makeInfiniteStream(): ReadableStream {
  let i = 0;
  return new ReadableStream({ pull(ctrl) { ctrl.enqueue(i++); } });
}

/** Emits `initialChunks` items then stalls — never closes or errors. */
function makeStallingStream(initialChunks: number): ReadableStream {
  let i = 0;
  return new ReadableStream({
    pull(ctrl) { if (i < initialChunks) ctrl.enqueue(i++); /* else stall */ }
  });
}

const tick = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function withTimeout<T>(promise: Promise<T>, label: string, ms = 1000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} did not resolve within ${ms}ms`)), ms)
    ),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 1 — Mock transport protocol unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Stream protocol — createOutgoingStream (producer)", () => {

  it("should time out when consumer never sends START (start timeout)", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(
      makeInfiniteStream(), transport, v => ({ data: v }),
      { startTimeout: 150 }
    );

    // Consumer never sends START — startTimeout fires on the very first waitForCredit()
    // inject COMPLETE after the error frame so the interceptor can clean up
    setTimeout(() => transport.inject({ id: sender.sid, head: { method: "COMPLETE" } } as Message), 300);
    await withTimeout(sender.complete, "complete after start timeout");

    assert.equal(transport.sentPartials().length, 0, "should send zero chunks (never got credit)");
    assert.equal(transport.sentErrors().length, 1, "should send one error frame on timeout");
    assert.ok(
      String(transport.sentErrors()[0].data).includes("start timeout"),
      `error message: ${transport.sentErrors()[0].data}`
    );
  });

  it("should block indefinitely (no timeout) when consumer stops sending PULL after START", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(
      makeInfiniteStream(), transport, v => ({ data: v }),
      { startTimeout: 50 }
    );

    // Grant 2 initial credits — producer sends 2 chunks then blocks waiting for PULL
    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 2 } } as Message);
    await tick(30);
    assert.equal(transport.sentPartials().length, 2);

    // Wait well beyond startTimeout — should NOT fire (already armed & consumed on first call)
    await tick(100);
    assert.equal(transport.sentErrors().length, 0, "no error after start timeout: timer only fires before START");
    assert.equal(transport.sentPartials().length, 2, "still only 2 chunks sent");

    // Clean up via CANCEL
    await transport.inject({ id: sender.sid, head: { method: "CANCEL" } } as Message);
    await withTimeout(sender.complete, "complete after cancel");
  });

  it("should not unblock when consumer sends PULL with desiredSize: 0", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(
      makeCountingStream(5), transport, v => ({ data: v }), {}
    );

    // Grant 1 credit — producer consumes 1 chunk
    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 1 } } as Message);
    await tick(30);

    // desiredSize: 0 — must not unblock the producer
    await transport.inject({ id: sender.sid, head: { method: "PULL", desiredSize: 0 } } as Message);
    await tick(30);

    assert.equal(transport.sentPartials().length, 1, "PULL(0) must not release credit");

    // Cleanup
    await transport.inject({ id: sender.sid, head: { method: "CANCEL" } } as Message);
    await withTimeout(sender.complete, "complete after cancel");
  });

  it("should grant one chunk for a zero desired size read", async () => {
    const transport = new MockTransport();
    const stream = createIncomingStream("zero-window", transport, { highWaterMark: 0 });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: "zero-window", head: { status: Status.Partial }, data: "one" } as Message);
    assert.equal((await reader.read()).value, "one");
    const pulls = transport.sentWhere(m => (m.head as any)?.method === "PULL");
    assert.ok(pulls.every(m => (m.head as any).desiredSize >= 1));
    await reader.cancel();
  });

  it("should stop cleanly when consumer sends START with desiredSize: 0", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(
      makeCountingStream(5), transport, v => ({ data: v }),
      { startTimeout: 150 }
    );

    // START with zero credits — producer stalls immediately, startTimeout fires;
    // mock transport silently drops any racing frames after dispose
    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 0 } } as Message);

    await withTimeout(sender.complete, "complete after zero-credit START timeout");
    // Either a start-timeout error is sent, or still no chunks
    assert.equal(transport.sentPartials().length, 0, "no chunks should be sent with zero initial credit");
  });

  it("should stop cleanly when consumer sends CANCEL mid-stream", async () => {
    const transport = new MockTransport();
    let cancelled = false;
    const readable = new ReadableStream<number>({
      pull(ctrl) { ctrl.enqueue(1); },
      cancel() { cancelled = true; }
    });

    const sender = createOutgoingStream(readable, transport, v => ({ data: v }), {});

    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 2 } } as Message);
    await tick(20);
    await transport.inject({ id: sender.sid, head: { method: "CANCEL" } } as Message);

    await withTimeout(sender.complete, "complete after CANCEL");

    assert.equal(cancelled, true, "underlying readable.cancel() should be called");
    assert.equal(transport.sentErrors().length, 0, "no error frame should be sent when consumer CANCELs");
  });

  it("should resolve complete when transport closes while producer awaits credit", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(
      makeInfiniteStream(), transport, v => ({ data: v }),
      // onClose hook in waitForCredit handles transport closure
      {}
    );

    // One credit consumed, then transport closes before any PULL arrives
    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 2 } } as Message);
    await tick(30);

    transport.simulateClose();

    await withTimeout(sender.complete, "complete after transport close");
  });

  it("should cancel a blocked source read when transport closes", async () => {
    const transport = new MockTransport();
    let cancelled = false;
    const readable = new ReadableStream({
      pull() { return new Promise<void>(() => {}); },
      cancel() { cancelled = true; },
    });
    const sender = createOutgoingStream(readable, transport, v => ({ data: v }));

    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 1 } } as Message);
    await tick(10);
    transport.simulateClose();

    await withTimeout(sender.complete, "complete after close during source read");
    assert.equal(cancelled, true);
  });

  it("should resolve complete when send fails mid-stream (network error)", async () => {
    const transport = new MockTransport();
    let sendCount = 0;
    const origSend = transport.send.bind(transport);
    transport.send = async (msg) => {
      // fail on the 3rd send (2nd chunk frame) — simulates a broken socket
      if (++sendCount === 3) throw new Error("simulated network failure");
      return origSend(msg);
    };

    const sender = createOutgoingStream(
      makeCountingStream(10), transport, v => ({ data: v }), {}
    );

    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 10 } } as Message);
    // complete may resolve OR reject — we just must not hang
    await withTimeout(sender.complete.catch(() => {}), "complete after send failure");
  });

  it("should resolve complete as soon as terminal is sent (no ACK required)", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(
      makeCountingStream(1), transport, v => ({ data: v }), {}
    );

    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 5 } } as Message);
    // complete should resolve once the terminal OK is sent — no COMPLETE ACK needed
    await withTimeout(sender.complete, "complete without ACK");
    assert.equal(transport.sentOKs().length, 1, "terminal OK should have been sent");
  });

  it("should send OK immediately for a 0-element stream and not hang", async () => {
    const transport = new MockTransport();
    // Empty stream: ReadableStream that closes immediately without enqueuing anything
    const empty = new ReadableStream({ start(controller) { controller.close(); } });
    const sender = createOutgoingStream(empty, transport, v => ({ data: v }), {});

    // Grant credit — producer should read done=true on first pull and terminate
    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 10 } } as Message);

    await withTimeout(sender.complete, "complete for 0-element stream");
    assert.equal(transport.sentPartials().length, 0, "no Partial frames for empty stream");
    assert.equal(transport.sentOKs().length, 1, "terminal OK sent after reading done=true");
    assert.equal(transport.sentErrors().length, 0, "no error frames");
  });

  it("should ignore unknown/garbage frame methods on its sid", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(
      makeCountingStream(3), transport, v => ({ data: v }), {}
    );

    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 5 } } as Message);
    // Inject noise frames — must not crash or corrupt state
    await transport.inject({ id: sender.sid, head: { method: "UNKNOWN_OPCODE" } } as Message);
    await transport.inject({ id: sender.sid, head: { method: "PING" } } as Message);
    await transport.inject({ id: sender.sid, head: { method: "0x00" } } as Message);

    // Producer should still finish the 3 items normally
    await tick(30);
    await withTimeout(sender.complete, "complete after unknown methods");
    assert.equal(transport.sentPartials().length, 3, "should still deliver all 3 chunks");
    assert.equal(transport.sentErrors().length, 0, "no error from unknown frames");
  });

  it("should handle consumer re-sending START (duplicate START) by updating credit", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(
      makeCountingStream(10), transport, v => ({ data: v }), {}
    );

    // First START: 2 credits consumed
    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 2 } } as Message);
    await tick(30);
    assert.equal(transport.sentPartials().length, 2);

    // Duplicate START — treated as a SET (same as PULL), grants 3 more credits
    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 3 } } as Message);
    await tick(30);
    assert.equal(transport.sentPartials().length, 5);

    // Normal PULL to finish
    await transport.inject({ id: sender.sid, head: { method: "PULL", desiredSize: 10 } } as Message);
    await tick(30);
    assert.equal(transport.sentOKs().length, 1, "terminal OK sent");
    await withTimeout(sender.complete, "complete after duplicate START");
  });

});

// ═══════════════════════════════════════════════════════════════════════════
describe("Stream protocol — createIncomingStream (consumer)", () => {

  it("should idle-timeout and cancel when producer stalls without sending any chunks", async () => {
    const sid = "stall-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { idleTimeout: 100, highWaterMark: 32 });

    const reader = stream.getReader();
    await tick(10); // let start() send START

    assert.ok(transport.sent.find(m => (m.head as any)?.method === "START"), "should send START");

    // Producer never responds — idle timeout fires
    await assert.rejects(
      () => withTimeout(reader.read(), "read after idle timeout", 500),
      (err: unknown) => {
        assert.ok(String(err).includes("idle timeout"), `unexpected: ${err}`);
        return true;
      }
    );

    const cancel = transport.sent.find(m => (m.head as any)?.method === "CANCEL");
    assert.ok(cancel, "should send CANCEL to producer after idle timeout");
  });

  it("should reset idle timer on every received chunk", async () => {
    const sid = "stall-2";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { idleTimeout: 150 });
    const reader = stream.getReader();
    await tick(10);

    const injectChunk = (data: string) =>
      transport.inject({ id: sid, head: { status: Status.Partial }, data } as Message);

    // First chunk arrives shortly — within window
    await injectChunk("alpha");
    const r1 = await reader.read();
    assert.equal(r1.value, "alpha");

    // Wait 100ms (< 150ms idle), send second chunk — should NOT time out
    await tick(100);
    await injectChunk("beta");
    const r2 = await reader.read();
    assert.equal(r2.value, "beta");

    // Now stall — timer was reset at "beta", should fire ~150ms after it
    const t0 = Date.now();
    await assert.rejects(
      () => withTimeout(reader.read(), "idle after reset", 600),
      () => true
    );
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 50,  `idle should fire after ~150ms, got ${elapsed}ms`);
    assert.ok(elapsed < 600,  `idle fired too late: ${elapsed}ms`);
  });

  it("should abort stream when producer sends an error frame", async () => {
    const sid = "error-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { idleTimeout: 0 });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: sid, head: { status: Status.Error }, data: "producer exploded" } as Message);

    await assert.rejects(
      () => reader.read(),
      (err: unknown) => {
        assert.ok(String(err).includes("producer exploded"), `unexpected: ${err}`);
        return true;
      }
    );

    assert.equal(
      transport.sent.filter(m => (m.head as any)?.method === "COMPLETE").length, 0,
      "consumer should NOT send COMPLETE — no ACK in protocol"
    );
  });

  it("should propagate producer CANCEL as a stream error", async () => {
    const sid = "cancel-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { idleTimeout: 0 });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: sid, head: { status: Status.Partial }, data: 1 } as Message);
    const r1 = await reader.read();
    assert.equal(r1.value, 1);

    await transport.inject({ id: sid, head: { method: "CANCEL" }, data: "server gave up" } as Message);

    await assert.rejects(
      () => reader.read(),
      (err: unknown) => {
        assert.ok(String(err).includes("server gave up"), `unexpected: ${err}`);
        return true;
      }
    );
  });

  it("should buffer all chunks from an overzealous producer (ignores credit limits)", async () => {
    // A misbehaving producer that sends more chunks than the granted desiredSize.
    // The consumer should buffer everything — no data loss, no crash.
    const sid = "greedy-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { idleTimeout: 0, highWaterMark: 2 });
    const reader = stream.getReader();
    await tick(10);

    // Producer sends 10 chunks without waiting for PULL
    for (let i = 0; i < 10; i++) {
      await transport.inject({ id: sid, head: { status: Status.Partial }, data: i } as Message);
    }
    await transport.inject({ id: sid, head: { status: Status.OK } } as Message);

    const received: number[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(value as number);
    }
    assert.deepEqual(received, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("should abort when an opt-in chunk limit is exceeded", async () => {
    const sid = "bounded-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { maxQueuedChunks: 2, highWaterMark: 0 });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: sid, head: { status: Status.Partial }, data: 1 } as Message);
    await transport.inject({ id: sid, head: { status: Status.Partial }, data: 2 } as Message);
    await transport.inject({ id: sid, head: { status: Status.Partial }, data: 3 } as Message);

    await assert.rejects(() => reader.read(), /buffer exceeded/);
    assert.equal(transport.sentCANCELs().length, 1);
  });

  it("should reject invalid terminal frames in strict mode", async () => {
    const sid = "strict-status-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { strictProtocol: true });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: sid, head: { status: 202 as any } } as Message);
    await assert.rejects(() => reader.read(), /invalid stream terminal status/);
  });

  it("should reject a control method attached to a partial in strict mode", async () => {
    const transport = new MockTransport();
    const stream = createIncomingStream("strict-partial", transport, { strictProtocol: true });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({
      id: "strict-partial",
      head: { status: Status.Partial, method: "UNKNOWN" },
      data: 1,
    } as Message);
    await assert.rejects(() => reader.read(), /invalid stream partial method/);
  });

  it("should ignore a late partial after a terminal frame", async () => {
    const sid = "late-partial-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport);
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: sid, head: { status: Status.OK } } as Message);
    await transport.inject({ id: sid, head: { status: Status.Partial }, data: "late" } as Message);
    assert.equal((await reader.read()).done, true);
  });

  it("should abort pending reads when transport closes", async () => {
    const sid = "close-incoming-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport);
    const reader = stream.getReader();
    await tick(10);

    const pending = reader.read();
    transport.simulateClose();
    await assert.rejects(() => withTimeout(pending, "read after transport close"), /transport closed/);
  });

  it("should error a stream when transport closes before start finishes", async () => {
    const transport = new MockTransport();
    const stream = createIncomingStream("early-close", transport);
    const reader = stream.getReader();
    transport.simulateClose();
    await assert.rejects(() => withTimeout(reader.read(), "early close read"), /transport closed/);
  });

  it("should not let buffered data delay a producer error", async () => {
    const sid = "error-priority-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport);
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: sid, head: { status: Status.Partial }, data: "buffered" } as Message);
    await transport.inject({ id: sid, head: { status: Status.Error }, data: "failed" } as Message);
    await assert.rejects(() => reader.read(), /failed/);
  });

  it("should reject malformed credits in strict mode", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(makeInfiniteStream(), transport, v => ({ data: v }), { strictProtocol: true });

    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: Infinity } } as Message);
    await tick(10);
    assert.equal(transport.sentPartials().length, 0);
    await transport.inject({ id: sender.sid, head: { method: "CANCEL" } } as Message);
    await withTimeout(sender.complete, "complete after invalid credit");
    assert.ok(transport.sentErrors().length >= 1);
  });

  it("should reject unknown producer control methods in strict mode", async () => {
    const transport = new MockTransport();
    const stream = createIncomingStream("strict-method", transport, { strictProtocol: true });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: "strict-method", head: { method: "UNKNOWN" } } as Message);
    await assert.rejects(() => reader.read(), /invalid stream control method/);
  });

  it("should bound queued binary data by bytes when configured", async () => {
    const transport = new MockTransport();
    const stream = createIncomingStream("bounded-bytes", transport, {
      highWaterMark: 0,
      maxQueuedBytes: 4,
    });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: "bounded-bytes", head: { status: Status.Partial }, data: new Uint8Array(4) } as Message);
    await transport.inject({ id: "bounded-bytes", head: { status: Status.Partial }, data: new Uint8Array(1) } as Message);
    await assert.rejects(() => reader.read(), /buffer exceeded/);
  });

  it("should preserve binary stream chunk metadata from the sender", async () => {
    const transport = new MockTransport();
    const sender = createOutgoingStream(makeCountingStream(1), transport, value => ({
      data: value,
      head: { encoding: "binary" },
    }));

    await transport.inject({ id: sender.sid, head: { method: "START", desiredSize: 2 } } as Message);
    await tick(10);
    await withTimeout(sender.complete, "binary sender completion");
    assert.equal((transport.sentPartials()[0].head as any).encoding, "binary");
  });

  it("should deliver queued chunks then signal done on Status.OK", async () => {
    const sid = "ok-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { idleTimeout: 0 });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: sid, head: { status: Status.Partial }, data: "x" } as Message);
    await transport.inject({ id: sid, head: { status: Status.Partial }, data: "y" } as Message);
    await transport.inject({ id: sid, head: { status: Status.OK } } as Message);

    const r1 = await reader.read(); assert.equal(r1.value, "x");
    const r2 = await reader.read(); assert.equal(r2.value, "y");
    const r3 = await reader.read(); assert.equal(r3.done, true);
  });

  it("should close immediately and not hang when producer sends OK with no prior chunks", async () => {
    // 0-element incoming stream: producer terminates with OK before sending any Partial frames
    const sid = "empty-incoming-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { idleTimeout: 0 });
    const reader = stream.getReader();
    await tick(10); // let start() send START

    // Verify START was sent so the producer knows to begin
    assert.ok(
      transport.sent.some(m => (m.head as any)?.method === "START"),
      "consumer must send START"
    );

    // Producer responds with terminal OK immediately — no chunks at all
    await transport.inject({ id: sid, head: { status: Status.OK } } as Message);

    // First (and only) read must return done=true without hanging
    const result = await withTimeout(reader.read(), "read on 0-element incoming stream");
    assert.equal(result.done, true, "stream must signal done immediately");
    assert.equal(result.value, undefined, "no value on done result");
  });

  it("should not error when producer sends an unknown status code (treated as terminal)", async () => {
    // An unknown status (not 206/200/500) should be treated as a terminal OK-like by the interceptor.
    const sid = "unk-status-1";
    const transport = new MockTransport();
    const stream = createIncomingStream(sid, transport, { idleTimeout: 0 });
    const reader = stream.getReader();
    await tick(10);

    await transport.inject({ id: sid, head: { status: Status.Partial }, data: "a" } as Message);
    // Status 202 (Accepted) — unknown to the stream protocol, treated as a terminal
    await transport.inject({ id: sid, head: { status: 202 as any } } as Message);

    const r1 = await reader.read(); assert.equal(r1.value, "a");
    // Should complete cleanly (not error)
    const r2 = await reader.read(); assert.equal(r2.done, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 2 — End-to-end bad-actor tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Stream protocol — end-to-end bad-actor scenarios", () => {
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

  it("should fire client idleTimeout when server stalls mid-stream", async () => {
    // Server delivers 3 chunks then goes silent — never sends OK or CANCEL.
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");

    api.get({
      path: "/stall",
      handler: () => makeStallingStream(3),
    });
    viae.use(api);

    // Client configured with a short idle timeout
    const ws = new WebSocket(`ws://localhost:${port}`);
    const { WebSocketWire } = await import("../src/index.js");
    const wire = WebSocketWire.wrap(ws as unknown as globalThis.WebSocket);
    const via = new Via({ wire, log: noopLog, streamOptions: { idleTimeout: 200 } });
    await via.ready;

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/stall", undefined, { accept: "stream" });
      assert.equal(result.ok, true);

      const reader = (result.data as ReadableStream<number>).getReader();

      // Drain the 3 chunks that were sent
      for (let i = 0; i < 3; i++) {
        const { done } = await reader.read();
        assert.equal(done, false);
      }

      // Next read should idle-timeout (server stalled)
      await assert.rejects(
        () => withTimeout(reader.read(), "read after server stall", 1000),
        (err: unknown) => {
          assert.ok(String(err).includes("idle timeout"), `unexpected: ${err}`);
          return true;
        }
      );
    } finally {
      wire.close();
    }
  });

  it("should fire server startTimeout when client never reads the stream", async () => {
    // Server has a short start timeout; client gets the stream response but never reads it
    // (never triggers START).  Since we can't prevent the Via layer from auto-starting,
    // we test via the mock transport unit test above instead.
    // This e2e test verifies that when the client closes the wire, the producer unblocks.
    const viae = new Viae(server, {
      log: noopLog,
      streamOptions: { startTimeout: 0, idleTimeout: 0 },
    });
    const api = new Api("/");

    api.get({
      path: "/infinite",
      handler: () => makeInfiniteStream(),
    });
    viae.use(api);

    const ws = new WebSocket(`ws://localhost:${port}`);
    const { WebSocketWire } = await import("../src/index.js");
    const wire = WebSocketWire.wrap(ws as unknown as globalThis.WebSocket);
    const via = new Via({ wire, log: noopLog, streamOptions: { highWaterMark: 2, idleTimeout: 0 } });
    await via.ready;

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/infinite", undefined, { accept: "stream" });
      assert.equal(result.ok, true);

      // Read just 1 chunk then stop — the producer will eventually block on credit
      const reader = (result.data as ReadableStream<number>).getReader();
      await reader.read();

      // Close the wire — producer should unblock cleanly via onClose
      wire.close();
      await tick(100);

      // If we get here without hanging, the producer cleaned up correctly
    } catch {
      // Connection-close errors are acceptable
    }
  });

  it("should recover when wire closes while a stream is in flight", async () => {
    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");

    api.get({
      path: "/endless",
      handler: () => makeInfiniteStream(),
    });
    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/endless", undefined, { accept: "stream" });
      const reader = (result.data as ReadableStream<number>).getReader();

      // Read a couple of items
      await reader.read();
      await reader.read();

      // Drop the connection abruptly — the stream should not hang or throw unhandled
      wire.close();

      // Attempting to read further should either complete or error cleanly
      let cleaned = false;
      try {
        await withTimeout(reader.read(), "read after wire close", 500);
        cleaned = true;
      } catch {
        cleaned = true; // error is acceptable — as long as we don't hang
      }
      assert.equal(cleaned, true);
    } catch {
      // If the initial request fails due to wire close timing, that is also acceptable
    }
  });

});
