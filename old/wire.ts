/**
 * A basic interface defining a binary bi-directional communication wire.  
 */
export interface Wire {
  send(data: ArrayBuffer): void;
  close();

  on(event: "message", cb: (data: ArrayBuffer) => void): void;

  on(event: "open", cb: () => void): void;
  on(event: "closing", cb: () => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: any) => void): void;

  state: "opening" | "open" | "closing" | "closed";

  [index: string]: any;
}

/**
 * A basic interface defining a wire server
 */
export interface WireServer {
  on(event: "connection", cb: (connection: Wire) => void);
}

/** A reusable wire that can connect to a url */
export interface ConnectableWire extends Wire {
  connect(url: string);
}

