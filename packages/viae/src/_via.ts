import { IRowan, Processor } from "rowan";
import { Message } from "./message";
import { Disposer } from "./_disposer";
import { Log } from "./log";
import { MessageHeader, Wire } from "@viae/core";

export interface IVia<T> extends IRowan<T> {
  before(processor: Processor<T>): this;

  request(
    method: string,
    path: string,
    data: any,
    opts?: SendOptions): Promise<Message>;

  send(msg: Partial<Message<any>>, opts?: SendOptions): Promise<void>;
  intercept(id: string, handlers: Processor<T>[]): Disposer;
  createId(): string;

  readonly log: Log;
  readonly wire: Wire;

  on(event: "close", cb: () => void): void;
  on(event: "open", cb: () => void): void;
  on(event: "error", cb: (err: Error, ctx: T) => void): void;
}

export interface SendOptions {
  id?: string;
  encoding?: "none" | "msgpack" | "json" | "cbor",
  timeout?: number;
  head?: {[index: string]: any}
};

export interface CallOptions<T> extends SendOptions {
  method: string, 
  path: string, 
  data?: any,
  validate?(result: any) : result is T;
}