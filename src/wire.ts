/**
 * A basic interface defining a binary bi-directional communication wire. 
 */
export interface Wire {
  /** Session ID */
  sid?: string;

  /** Remote Address */
  address?: string;

  send(data: ArrayBuffer): void;
  close(dispose?: boolean);

  on(event: "message", cb: (data: ArrayBuffer) => void): void;
  on(event: "close", cb: (disposed?: boolean) => void): void;
  on(event: "error", cb: (err: any) => void): void;
  on(event: "open", cb: () => void): void;

  [index: string]: any;
}

/**
 * A basic interface defining a wire server
 */
export interface WireServer {
  on(event: "connection", cb: (connection: Wire) => void);
}

