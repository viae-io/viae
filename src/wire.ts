/**
 * A basic interface defining a binary bi-directional communication wire.  
 */
export interface Wire {
  readonly state: "opening" | "open" | "closing" | "closed";
  readonly meta?: {
    remoteAddress?: string;
  };

  send(data: ArrayBuffer | ArrayBufferView): Promise<void>;
  close(): Promise<void>;

  on(event: "message", cb: (data: ArrayBuffer) => void): void;
  on(event: "open", cb: () => void): void;
  on(event: "closing", cb: () => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: any) => void): void;
}