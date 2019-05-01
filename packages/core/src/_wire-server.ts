import { Wire } from "./_wire";

/**
 * A basic interface defining a wire server
 */
export interface WireServer {
  on(event: "connection", cb: (connection: Wire) => void);
}
