import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { EventEmitter } from "eventemitter3";
import WebSocket, { WebSocketServer } from "ws";
import {
  Api,
  Viae,
  WebSocketWire,
  WireState,
  type Wire,
  type WireServer,
} from "../src/index.js";
import { TestWireServer, closeAndWait, createTestClient, noopLog } from "./utils.js";

/** Authorize hook: return claims to admit, or `null` to reject. */
type Authorize = (wire: Wire) => Record<string, unknown> | null;

/**
 * A `WireServer` that authenticates at the upgrade, before viae can see the
 * wire: accepted wires carry their claims on `wire.state`, rejected wires are
 * closed with a policy-violation code and never handed off.
 */
class AuthWireServer extends EventEmitter implements WireServer {
  private _inner = new TestWireServer();

  constructor(authorize: Authorize) {
    super();
    this._inner.on("connection", (wire: Wire) => {
      const claims = authorize(wire);
      if (claims === null) {
        wire.close(1008, "unauthorized");
        return;
      }
      wire.state = claims;
      this.emit("connection", wire);
    });
  }

  listen(port = 0, host = "localhost"): Promise<AddressInfo> {
    return this._inner.listen(port, host);
  }

  close(): Promise<void> {
    return this._inner.close();
  }
}

/** Reject when `promise` does not settle within `ms`; keeps waits bounded. */
function deadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not happen within ${ms}ms`)),
      ms,
    );
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Resolve `true` if a `connection` event appears before the deadline, `false`
 * otherwise: a bounded negative assertion that fails the test only when the
 * rejected wire is (incorrectly) adopted.
 */
function connectionAppeared(viae: Viae, waitMs = 200): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (appeared: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(appeared);
    };
    timer = setTimeout(() => settle(false), waitMs);
    viae.on("connection", () => settle(true));
  });
}

describe("adapter auth e2e", () => {
  it("should expose adapter-set claims to handlers, connections, and the wire", async () => {
    const claims = { sub: "alice", scopes: ["read"] };
    const server = new AuthWireServer(() => claims);
    const addr = await server.listen();

    const viae = new Viae(server, { log: noopLog });
    const api = new Api("/");

    let seenFromHandler: unknown;
    let seenVia: unknown;
    api.get({
      path: "/whoami",
      handler: ({ ctx }) => {
        seenFromHandler = ctx.connection.state;
        seenVia = ctx.connection;
        return ctx.connection.state;
      },
    });
    viae.use(api);

    const { via, wire } = await createTestClient(addr.port);
    try {
      const res = await via.request<unknown>("GET", "/whoami");
      assert.equal(res.ok, true);
      assert.deepEqual(res.data, claims);
      // Identity, not just structural equality: the handler sees the exact
      // object the adapter attached to `wire.state`.
      assert.equal(seenFromHandler, claims);
      assert.equal(viae.connections.length, 1);
      assert.equal(viae.connections[0].state, claims);
      assert.equal(seenVia, viae.connections[0]);
      assert.equal((wire as Wire).state, undefined, "client wire state is not set by the client");
    } finally {
      await via.close();
      await server.close();
    }
  });

  it("should never hand off a rejected wire and close it with 1008", async () => {
    const server = new AuthWireServer(() => null);
    const addr = await server.listen();
    const viae = new Viae(server, { log: noopLog });

    // Start the bounded negative wait before dialling so no event can slip past.
    const appeared = connectionAppeared(viae);

    const ws = new WebSocket(`ws://localhost:${addr.port}`);
    const closed = new Promise<{ code: number; reason: string }>(resolve => {
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    try {
      await deadline(
        new Promise<void>((resolve, reject) => {
          ws.once("open", () => resolve());
          ws.once("error", reject);
        }),
        2000,
        "client handshake",
      );

      assert.equal(await appeared, false, "rejected wire must not produce a connection event");
      assert.equal(viae.connections.length, 0, "rejected wire must not create a Via");

      const closeEvent = await deadline(closed, 2000, "client close");
      assert.equal(closeEvent.code, 1008);
      assert.equal(closeEvent.reason, "unauthorized");
    } finally {
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      await server.close();
    }
  });
});

describe("upgrade passthrough", () => {
  it("should expose the same upgrade request to the adapter via wire.upgrade", async () => {
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });
    const serverSockets: WebSocket[] = [];

    let resolveHandoff!: (value: { wire: WebSocketWire; req: unknown }) => void;
    const handoff = new Promise<{ wire: WebSocketWire; req: unknown }>(resolve => {
      resolveHandoff = resolve;
    });
    wss.on("connection", (ws: WebSocket, req: unknown) => {
      serverSockets.push(ws);
      const wire = WebSocketWire.wrap(ws, req);
      resolveHandoff({ wire, req });
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "localhost", () => resolve());
    });
    const addr = httpServer.address() as AddressInfo;

    const client = new WebSocket(`ws://localhost:${addr.port}`);
    const clientErrors: unknown[] = [];
    client.on("error", err => { clientErrors.push(err); });
    const opened = new Promise<void>(resolve => client.once("open", () => resolve()));
    const clientClosed = new Promise<void>(resolve => client.once("close", () => resolve()));

    try {
      const { wire, req } = await deadline(handoff, 2000, "upgrade handoff");
      await deadline(opened, 2000, "client open");
      assert.ok(req !== undefined && req !== null, "expected the ws upgrade request object");
      assert.equal(wire.upgrade, req);
      assert.equal((wire as Wire).state, undefined, "wrap does not invent state");
      assert.deepEqual(clientErrors, []);
    } finally {
      for (const serverSocket of serverSockets) {
        if (serverSocket.readyState !== WebSocket.CLOSED) serverSocket.terminate();
      }
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CLOSING) {
        client.terminate();
      }
      await deadline(clientClosed, 2000, "client close after teardown");
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        httpServer.close(err => (err ? reject(err) : resolve()));
      });
    }
  });

  it("should leave upgrade unset on a client connect() wire", async () => {
    const server = new TestWireServer();
    const addr = await server.listen();
    try {
      const wire = new WebSocketWire();
      await wire.connect(`ws://localhost:${addr.port}`);
      assert.equal(wire.readyState, WireState.OPEN);
      assert.equal(wire.upgrade, undefined);
      await closeAndWait(wire);
    } finally {
      await server.close();
    }
  });
});
