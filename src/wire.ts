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
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;
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
 * WebSocket Wire - wraps a WebSocket instance as a Wire.
 * Works with both browser WebSocket and `ws` library.
 */
export class WebSocketWire extends EventEmitter implements Wire {
  private _ws?: WebSocket;

  get url(): string {
    if (!this._ws) return "";
    return (this._ws as any).url ?? (this._ws as any)._socket?.remoteAddress ?? "";
  }

  get readyState(): WireState {
    return this._ws?.readyState ?? WireState.CLOSED;
  }

  /** Wrap an existing WebSocket (server-side) */
  static wrap(ws: WebSocket): WebSocketWire {
    const wire = new WebSocketWire();
    wire._bind(ws);
    return wire;
  }

  /** Connect to a URL (client-side) */
  connect(url: string, WS: typeof WebSocket = WebSocket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WS(url);
      (ws as any).binaryType = "arraybuffer";

      const onOpen = () => {
        cleanup();
        this._bind(ws);
        resolve();
      };
      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };
      const onClose = () => {
        cleanup();
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

  private _bind(ws: WebSocket) {
    this._ws = ws;
    (ws as any).binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      this.emit("open");
    });
    ws.addEventListener("message", (ev: MessageEvent | { data: unknown }) => {
      const data = (ev as MessageEvent).data ?? (ev as any).data;
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
    if (!this._ws || this._ws.readyState !== WireState.OPEN) {
      throw new Error("wire is not open");
    }
    this._ws.send(data);
  }

  close(): void {
    if (this._ws && this._ws.readyState !== WireState.CLOSING) {
      this._ws.close();
    }
  }
}
