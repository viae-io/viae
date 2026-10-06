import { EventEmitter } from "eventemitter3";

export enum WireState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export interface Wire {
  readonly readyState: WireState;
  readonly url: string;
  /**
   * Bytes queued by the underlying transport but not yet transmitted, when
   * the transport can report it.  `Infinity` (or an absent value) means the
   * buffer size is unknown and backpressure must not be applied.
   */
  readonly bufferedAmount?: number;
  /**
   * Adapter-provided per-connection state/claims (e.g. identity established at
   * the HTTP upgrade). Opaque to viae: never read or mutated internally. Set it
   * before handoff; later mutations are ignored by Via's construction-time
   * snapshot.
   */
  state?: unknown;
  /**
   * Adapter-provided upgrade metadata (e.g. the `ws` request). Opaque to viae.
   * Only server-side wires created via `WebSocketWire.wrap(ws, upgrade)` carry
   * it; client `connect()` wires never do.
   */
  readonly upgrade?: unknown;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  on(event: "message", cb: (data: ArrayBuffer | ArrayBufferView) => void): void;
  on(event: "open", cb: () => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
}

export interface WireServer {
  on(event: "connection", cb: (wire: Wire) => void): void;
}

/**
 * Minimal structural WebSocket surface accepted by `WebSocketWire.wrap`.
 *
 * Both the `ws` package's `WebSocket` and the global (DOM) `WebSocket`
 * satisfy it, so server adapters can wrap sockets without `as any` casts.
 * The `(...args: any[]) => void` listener signature is required for
 * DOM-style handler assignability.
 */
export interface WebSocketLike {
  readyState: number;
  bufferedAmount: number;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (...args: any[]) => void): void;
  removeEventListener(type: string, listener: (...args: any[]) => void): void;
}

/**
 * WebSocket Wire - wraps a WebSocket instance as a Wire.
 * Works with both browser WebSocket and `ws` library.
 */
export class WebSocketWire extends EventEmitter implements Wire {
  private _ws?: WebSocketLike;
  private _upgrade?: unknown;
  private _sendCallback = false;

  get url(): string {
    if (!this._ws) return "";
    return (this._ws as any).url ?? (this._ws as any)._socket?.remoteAddress ?? "";
  }

  get upgrade(): unknown {
    return this._upgrade;
  }

  get readyState(): WireState {
    return this._ws?.readyState ?? WireState.CLOSED;
  }

  get bufferedAmount(): number {
    return this._ws ? this._ws.bufferedAmount : Infinity;
  }

  /** Wrap an existing WebSocket (server-side) */
  static wrap(ws: WebSocketLike, upgrade?: unknown): WebSocketWire {
    const wire = new WebSocketWire();
    wire._upgrade = upgrade;
    wire._bind(ws);
    return wire;
  }

  /** Connect to a URL (client-side) */
  connect(url: string, WS: typeof WebSocket = WebSocket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WS(url);
      (ws as any).binaryType = "arraybuffer";

      const closeQuietly = () => {
        try {
          if (ws.readyState !== WireState.CLOSING && ws.readyState !== WireState.CLOSED) {
            ws.close();
          }
        } catch { /* the socket may already be unusable */ }
      };

      const onOpen = () => {
        cleanup();
        this._bind(ws);
        resolve();
      };
      const onError = (err: unknown) => {
        cleanup();
        closeQuietly();
        reject(err);
      };
      const onClose = () => {
        cleanup();
        closeQuietly();
        reject(new Error("connection closed"));
      };

      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError as EventListener);
        ws.removeEventListener("close", onClose);
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError as EventListener);
      ws.addEventListener("close", onClose);
    });
  }

  private _bind(ws: WebSocketLike) {
    this._ws = ws;
    /* The `ws` package implements an EventEmitter-style `on` and accepts a
       send callback that reports asynchronous failures.  The global WebSocket
       does not (empirically: `send.length` 1 vs 3, `.on` undefined), so never
       pass a callback to it. */
    this._sendCallback = typeof (ws as { on?: unknown }).on === "function";
    (ws as any).binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      this.emit("open");
    });
    ws.addEventListener("message", (...args: any[]) => {
      const ev = args[0] as MessageEvent | { data?: unknown };
      const data = (ev as MessageEvent).data ?? ev.data;
      this.emit("message", data);
    });
    ws.addEventListener("close", () => {
      this.emit("close");
      this._ws = undefined;
    });
    ws.addEventListener("error", (err: unknown) => {
      this.emit("error", err);
    });

    if (ws.readyState === WireState.OPEN) {
      /* Already open (e.g. server-side wrap) - emit asynchronously
         so listeners registered after wrap() can catch it */
      queueMicrotask(() => this.emit("open"));
    }
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    const ws = this._ws;
    if (!ws || ws.readyState !== WireState.OPEN) {
      throw new Error("wire is not open");
    }
    if (this._sendCallback) {
      (ws.send as unknown as (
        data: ArrayBuffer | ArrayBufferView,
        cb: (err?: Error) => void,
      ) => void)(data, (err) => {
        if (err) this.emit("error", err);
      });
    } else {
      ws.send(data);
    }
  }

  close(code?: number, reason?: string): void {
    if (this._ws && this._ws.readyState !== WireState.CLOSING) {
      if (code !== undefined && reason !== undefined) this._ws.close(code, reason);
      else if (code !== undefined) this._ws.close(code);
      else if (reason !== undefined) this._ws.close(undefined, reason);
      else this._ws.close();
    }
  }
}
