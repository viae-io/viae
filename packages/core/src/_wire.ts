export enum WireState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}
/**
 * A basic interface defining a binary bi-directional communication wire.  
 */
export interface Wire {
  readonly readyState: WireState
  readonly url: string;

  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;

  on(event: "message", cb: (data: ArrayBuffer | ArrayBufferView) => void): void;
  on(event: "open", cb: () => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: any) => void): void;
}

export interface ConnectibleWire extends Wire {
  connect(url: string): Promise<void>;
}