import { Wire } from "./wire";

/**
 * A basic interface defining a wire server
 */
export interface WireServer {
  on(event: "connection", cb: (connection: Wire) => void);
}
