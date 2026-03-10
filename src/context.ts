import { type Message, type Request, type Response, isRequest } from "./message.js";
import { Status } from "./status.js";
import type { IVia } from "./via.js";
import type { Log } from "./log.js";

export interface ContextTask {
  readonly name: string;
  readonly complete: Promise<void>;
}

export interface ReplyOptions {
  /** Encoding name to use for this response (e.g. "json", "cbor", "binary"). */
  type?: string;
  /** HTTP-style status code for the response. */
  status?: number;
}

export interface Context {
  id: string;
  connection: IVia;
  log: Log;
  err?: unknown;

  in: Message;
  out?: Message;

  params: Record<string, string>;

  readonly tasks: ContextTask[];
  readonly complete: Promise<void>;

  isReq(inbound?: boolean): this is RequestContext;
  isRes(inbound?: boolean): this is ResponseContext;

  reply(data: unknown, opts?: ReplyOptions): void;

  onDispose(cb: () => void | Promise<void>): void;
  [Symbol.asyncDispose](): Promise<void>;

  [key: string]: unknown;
}

export interface RequestContext extends Context {
  in: Request;
  out: Response;
}

export interface ResponseContext extends Context {
  in: Response;
}

export class DefaultContext implements Context {
  private _disposers: (() => (Promise<void> | void))[] = [];
  private _tasks: ContextTask[] = [];

  id: string;
  connection: IVia;
  log: Log;
  in: Message;
  out?: Message;
  err?: unknown;
  params: Record<string, string> = {};

  [key: string]: unknown;

  constructor(init: { connection: IVia; in: Message; log: Log }) {
    this.id = init.in.id;
    this.connection = init.connection;
    this.log = init.log;
    this.in = init.in;

    if (this.isReq()) {
      this.out = {
        id: init.in.id,
        head: { status: Status.NotFound }
      };
    }
  }

  isReq(inbound = true): this is RequestContext {
    return inbound
      ? isRequest(this.in)
      : this.out !== undefined && this.out.head.status === undefined;
  }

  isRes(inbound = true): this is ResponseContext {
    return inbound
      ? this.in.head.status !== undefined
      : this.out !== undefined && this.out.head.status !== undefined;
  }

  reply(data: unknown, opts?: ReplyOptions): void {
    if (!this.out) return;
    this.out.data = data;
    if (opts?.status !== undefined) this.out.head.status = opts.status as Status;
    if (opts?.type) this.out.head.encoding = opts.type;
  }

  get tasks(): ContextTask[] {
    return this._tasks;
  }

  get complete(): Promise<void> {
    return Promise.all(this._tasks.map(x => x.complete)).then(() => void 0);
  }

  onDispose(cb: () => void | Promise<void>): void {
    this._disposers.push(cb);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await Promise.allSettled(this._disposers.map(fn => fn()));
    this._disposers = [];
  }
}
