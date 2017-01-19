
//export type WireStatus = "closed" | "closing" | "connecting" | "open";


/**
 * A basic interface defining a binary bi-directional communication wire. 
 */
export interface Wire {
  send(data: ArrayBuffer): void;
  close();

  on(event: "close", cb: () => void): void;
  on(event: "message", cb: (data: ArrayBuffer) => void): void;
  on(event: "error", cb: (err: any) => void): void;
}

/**
 * A basic interface defining a wire server
 */
export interface WireServer {
  on(event: "connection", cb: (connection: Wire) => void);
  on(event: "error", cb: (err: any) => void): void;
}

