import IWire from "./_wire";

/**
 * A basic interface defining a wire server
 */
export interface IWireServer {
  on(event: "connection", cb: (connection: IWire) => void);
}
