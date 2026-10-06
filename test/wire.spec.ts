import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WebSocketWire, WireState, type Wire } from "../src/wire.js";

type Listener = (...args: unknown[]) => void;

/** Minimal WebSocket stub, enough for WebSocketWire.wrap(). */
class StubWebSocket {
  readyState = WireState.OPEN;
  bufferedAmount = 4096;
  sent: Array<ArrayBuffer | ArrayBufferView> = [];
  closed = false;
  /** Every close() invocation, recorded as its exact argument list. */
  closeCalls: Array<[number?, string?]> = [];
  private _listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, cb: Listener): void {
    let set = this._listeners.get(type);
    if (!set) this._listeners.set(type, set = new Set());
    set.add(cb);
  }

  removeEventListener(type: string, cb: Listener): void {
    this._listeners.get(type)?.delete(cb);
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(...args: [code?: number, reason?: string]): void {
    this.closeCalls.push(args);
    this.closed = true;
    // Mirror `ws`: the first close moves to CLOSING synchronously, CLOSED later.
    this.readyState = WireState.CLOSING;
    queueMicrotask(() => {
      this.readyState = WireState.CLOSED;
    });
  }

  emit(type: string, event?: unknown): void {
    for (const cb of [...(this._listeners.get(type) ?? [])]) cb(event);
  }
}

/** Minimal WebSocket stub for WebSocketWire.connect(). */
class StubConnectWebSocket {
  readyState = WireState.CONNECTING;
  bufferedAmount = 0;
  binaryType = "";
  private _listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.readyState = WireState.OPEN;
      this.emit("open");
    });
  }

  addEventListener(type: string, cb: Listener): void {
    let set = this._listeners.get(type);
    if (!set) this._listeners.set(type, set = new Set());
    set.add(cb);
  }

  removeEventListener(type: string, cb: Listener): void {
    this._listeners.get(type)?.delete(cb);
  }

  send(): void {}

  close(): void {
    this.readyState = WireState.CLOSED;
  }

  emit(type: string, event?: unknown): void {
    for (const cb of [...(this._listeners.get(type) ?? [])]) cb(event);
  }
}

describe("Wire.bufferedAmount (D4)", () => {
  it("should report the wrapped socket's bufferedAmount while bound", () => {
    const ws = new StubWebSocket();
    const wire = WebSocketWire.wrap(ws);
    assert.equal(wire.bufferedAmount, 4096);
    ws.bufferedAmount = 17;
    assert.equal(wire.bufferedAmount, 17);
  });

  it("should report Infinity after the socket closes", () => {
    const ws = new StubWebSocket();
    const wire = WebSocketWire.wrap(ws);
    assert.equal(wire.bufferedAmount, 4096);
    ws.emit("close");
    assert.equal(wire.bufferedAmount, Infinity);
    assert.equal(wire.readyState, WireState.CLOSED);
  });

  it("should report Infinity for an unbound wire", () => {
    const wire = new WebSocketWire();
    assert.equal(wire.bufferedAmount, Infinity);
  });
});

describe("Wire state and upgrade (D1/D2)", () => {
  it("should expose the wrapped upgrade metadata by identity", () => {
    const upgrade = { headers: { authorization: "Bearer x" } };
    const wire = WebSocketWire.wrap(new StubWebSocket(), upgrade);
    assert.equal(wire.upgrade, upgrade);
  });

  it("should not set upgrade on a client connect() wire", async () => {
    const wire = new WebSocketWire();
    await wire.connect("ws://stub", StubConnectWebSocket as unknown as typeof WebSocket);
    assert.equal(wire.readyState, WireState.OPEN);
    assert.equal(wire.upgrade, undefined);
  });

  it("should leave state and upgrade undefined on a plain wrapped wire", () => {
    const wire: Wire = WebSocketWire.wrap(new StubWebSocket());
    assert.equal(wire.state, undefined);
    assert.equal(wire.upgrade, undefined);
  });

  it("should expose upgrade as a getter without a setter", () => {
    const wire = WebSocketWire.wrap(new StubWebSocket());
    assert.throws(() => {
      // @ts-expect-error `upgrade` is readonly: the getter has no setter.
      wire.upgrade = {};
    }, TypeError);
  });
});

describe("Wire.close(code, reason) (D3)", () => {
  it("should forward close arguments per argument", () => {
    const bothWs = new StubWebSocket();
    WebSocketWire.wrap(bothWs).close(4001, "denied");
    assert.deepEqual(bothWs.closeCalls, [[4001, "denied"]]);

    const codeWs = new StubWebSocket();
    WebSocketWire.wrap(codeWs).close(1008);
    assert.deepEqual(codeWs.closeCalls, [[1008]]);

    const reasonWs = new StubWebSocket();
    WebSocketWire.wrap(reasonWs).close(undefined, "denied");
    assert.deepEqual(reasonWs.closeCalls, [[undefined, "denied"]]);

    const neitherWs = new StubWebSocket();
    WebSocketWire.wrap(neitherWs).close();
    assert.deepEqual(neitherWs.closeCalls, [[]]);
  });

  it("should ignore a second close while CLOSING and retain the first code", () => {
    const ws = new StubWebSocket();
    const wire = WebSocketWire.wrap(ws);

    wire.close(4001, "first");
    assert.equal(ws.readyState, WireState.CLOSING);

    wire.close(4002, "second");
    assert.deepEqual(ws.closeCalls, [[4001, "first"]]);
  });
});
