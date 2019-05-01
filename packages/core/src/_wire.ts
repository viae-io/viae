/**
 * A basic interface defining a binary bi-directional communication wire.  
 */
export interface Wire {
  readonly state: "opening" | "open" | "closing" | "closed";
  readonly meta?: {
    remoteAddress?: string;
  };

  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;

  on(event: "message", cb: (data: ArrayBuffer | ArrayBufferView) => void): void;
  on(event: "open", cb: () => void): void;
  on(event: "closing", cb: () => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: any) => void): void;
}

export interface ConnectibleWire extends Wire {
  connect(url: string): Promise<void>;
}