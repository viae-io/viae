import { IRowan, Processor } from "rowan";
import { Message } from "./message";
import { Disposer } from "./_disposer";
import { Log } from "./log";
import { Wire } from "./wire";

export interface IVia<T> extends IRowan<T> {
  before(processor: Processor<T>): this;

  request(msg: Partial<Message<any>>, opts?: SendOptions): Promise<Message>;
  send(msg: Partial<Message<any>>, opts?: SendOptions): Promise<void>;
  intercept(id: string, handlers: Processor<T>[]): Disposer;
  createId(): string;

  readonly log: Log;
  readonly wire: Wire;

  on(event: "close", cb: () => void): void;
  on(event: "open", cb: () => void): void;
  on(event: "error", cb: (err: Error, ctx: T) => void): void;


}

export type SendOptions = {
  encoding?: "none" | "msgpack" | "json",
  timeout?: number
};