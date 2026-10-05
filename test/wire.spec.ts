import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WebSocketWire, WireState } from "../src/wire.js";

type Listener = (...args: unknown[]) => void;

/** Minimal WebSocket stub, enough for WebSocketWire.wrap(). */
class StubWebSocket {
  readyState = WireState.OPEN;
  bufferedAmount = 4096;
  sent: Array<ArrayBuffer | ArrayBufferView> = [];
  closed = false;
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

  close(): void {
    this.closed = true;
    this.readyState = WireState.CLOSED;
  }

  emit(type: string, event?: unknown): void {
    for (const cb of [...(this._listeners.get(type) ?? [])]) cb(event);
  }
}

describe("Wire.bufferedAmount (D4)", () => {
  it("should report the wrapped socket's bufferedAmount while bound", () => {
    const ws = new StubWebSocket();
    const wire = WebSocketWire.wrap(ws as unknown as WebSocket);
    assert.equal(wire.bufferedAmount, 4096);
    ws.bufferedAmount = 17;
    assert.equal(wire.bufferedAmount, 17);
  });

  it("should report Infinity after the socket closes", () => {
    const ws = new StubWebSocket();
    const wire = WebSocketWire.wrap(ws as unknown as WebSocket);
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
