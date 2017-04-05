/**
 * A basic interface defining a binary bi-directional communication wire. 
 */
export interface Wire {
  /** Session ID */
  sid?: string;

  send(data: ArrayBuffer): void;
  close();

  on(event: "message", cb: (data: ArrayBuffer) => void): void;
  on(event: "sid", cb: (sid: string) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: any) => void): void;

  [index: string]: any;
}

/**
 * A basic interface defining a wire server
 */
export interface WireServer {
  on(event: "connection", cb: (connection: Wire) => void);
}

