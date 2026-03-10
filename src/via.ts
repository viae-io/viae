import { Rowan, After, AfterIf, type Processor, Catch, type Next, type Middleware } from "rowan";
import { EventEmitter } from "events";
import { type Wire, WireState } from "./wire.js";
import { type Message, type MessageHeader, type Response } from "./message.js";
import { type Context, DefaultContext } from "./context.js";
import { Interceptor } from "./interceptor.js";
import { Status } from "./status.js";
import type { Log } from "./log.js";
import { consoleLog } from "./log.js";
import { shortId } from "./util.js";
import { type Codex, FrameEncoder } from "./codec.js";
import { createOutgoingStream, createIncomingStream, type StreamTransport } from "./stream.js";

function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

function isReadableStream(obj: unknown): obj is ReadableStream {
  if (obj == null) return false;
  if (obj instanceof ReadableStream) return true;
  if (typeof obj === "object" && "getReader" in (obj as object)) return true;
  return false;
}

export interface IVia {
  readonly wire: Wire;
  send(msg: Partial<Message>, opts?: SendOptions): Promise<void>;
  request<R>(method: string, path: string, data?: unknown, opts?: RequestOptions): Promise<RequestResponse<R>>;
  intercept(id: string, handlers: Processor<Context>[]): () => void;
  createId(): string;
  readonly log: Log;
}

export interface ViaOptions {
  wire: Wire;
  uuid?: () => string;
  log?: Log;
  timeout?: number;
  codex?: Codex;
}

export interface SendOptions {
  encoding?: string;
  head?: Record<string, unknown>;
}

export interface RequestOptions extends SendOptions {
  timeout?: number;
  id?: string;
  accept?: "stream" | "object";
}

export interface RequestResponse<T = unknown> extends Response<T> {
  ok: boolean;
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Via - wraps a wire connection and processes inbound/outbound messages.
 * Opinionated: CBOR serialisation, credit-based stream backpressure.
 */
export class Via extends Rowan<Context> implements IVia {
  private _ev = new EventEmitter();
  private _active: Context[] = [];
  private _wire: Wire;
  private _uuid: () => string;
  private _log: Log;
  private _timeout: number;
  private _interceptor = new Interceptor();
  private _before: Rowan<Context> = new Rowan<Context>();
  private _encoder: FrameEncoder;

  readonly out: Rowan<Context> = new Rowan<Context>();

  get wire() { return this._wire; }
  get active() { return this._active; }
  get log() { return this._log; }

  static Log: Log = consoleLog;

  constructor(opts: ViaOptions) {
    super();
    const wire = this._wire = opts.wire;
    this._log = opts.log ?? Via.Log;
    this._uuid = opts.uuid || shortId;
    this._timeout = opts.timeout || 10000;
    this._encoder = opts.codex ? new FrameEncoder(opts.codex) : new FrameEncoder();

    this
      .use(this._before)
      .use(new After([
        this.out
          .use(new AfterIf((ctx: Context) => Promise.resolve(!!ctx.out), [
            new OutgoingStreamUpgrade(),
            new Send(this._encoder)
          ]))
      ]))
      .use(new Catch((err: unknown, ctx: Context) => {
        ctx.err = err;
        this._log.error({ err }, "error during processing");
        if (ctx.out) {
          ctx.out.head.status = Status.Error;
          ctx.out.data = err instanceof Error ? err.message : String(err);
        }
        return Promise.resolve();
      }))
      .use(new IncomingStreamUpgrade())
      .use(this._interceptor);

    wire.on("message", (data: ArrayBuffer | ArrayBufferView) => {
      this._onMessage(data);
    });
    wire.on("open", () => { this._ev.emit("open"); });
    wire.on("close", () => {
      this._interceptor.dispose();
      this._ev.emit("close");
    });
    wire.on("error", (err: unknown) => { this._ev.emit("error", err); });
  }

  get ready(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._wire.readyState === WireState.OPEN) return resolve();

      const handlerOpen = () => {
        this._wire.off("open", handlerOpen);
        this._wire.off("error", handlerError);
        resolve();
      };
      const handlerError = (err: unknown) => {
        this._wire.off("open", handlerOpen);
        this._wire.off("error", handlerError);
        reject(err);
      };

      this._wire.on("open", handlerOpen);
      this._wire.on("error", handlerError);
    });
  }

  private _onMessage(data: ArrayBuffer | ArrayBufferView) {
    const raw = toUint8Array(data);
    const frame = this._encoder.decode(raw);

    const msg: Message = {
      id: frame.id,
      head: (frame.head ?? {}) as MessageHeader,
      data: frame.data,
    };

    const ctx = new DefaultContext({ connection: this, in: msg, log: this._log });
    this._active.push(ctx);

    this.process(ctx as Context)
      .then(() => ctx.complete)
      .catch(err => {
        this._log.error({ err }, "unhandled error");
        this._ev.emit("error", err);
      })
      .finally(() => {
        const index = this._active.indexOf(ctx);
        if (index >= 0) this._active.splice(index, 1);
        return (ctx as DefaultContext)[Symbol.asyncDispose]();
      });
  }

  send(msg: Partial<Message>, opts?: SendOptions): Promise<void> {
    if (!msg.id) msg.id = shortId();

    if (opts?.encoding) {
      msg.head = msg.head || {};
      msg.head.encoding = opts.encoding;
    }

    if (opts?.head && typeof opts.head === "object") {
      msg.head = { ...msg.head, ...opts.head };
    }

    if (!this._wire || this._wire.readyState !== WireState.OPEN) {
      return Promise.reject(new Error("wire is not open"));
    }

    const ctx = new DefaultContext({ connection: this, in: msg as Message, log: this._log });
    ctx.out = msg as Message;
    return this.out.process(ctx)
      .then(() => ctx.complete)
      .catch((err) => {
        this._ev.emit("error", err);
        throw err;
      })
      .finally(() => (ctx as DefaultContext)[Symbol.asyncDispose]());
  }

  async request<R>(
    method: string,
    path: string,
    data?: unknown,
    opts?: RequestOptions,
  ): Promise<RequestResponse<R>> {
    const msg: Partial<Message> = {
      id: opts?.id || shortId(),
      head: { method, path }
    };

    if (data !== undefined) msg.data = data;

    let reject!: (reason: unknown) => void;
    let resolve!: (value: RequestResponse<R>) => void;
    const promise = new Promise<RequestResponse<R>>((r, x) => { resolve = r; reject = x; });

    const dispose = this._interceptor.intercept({
      id: msg.id!,
      handlers: [(ctx: Context, next?: Next) => {
        const status = ctx.in.head.status as Status;

        resolve(
          Object.assign(
            {
              ok: status >= 200 && status < 300,
              async [Symbol.asyncDispose]() {
                await (ctx as DefaultContext).complete;
                await (ctx as DefaultContext)[Symbol.asyncDispose]();
              }
            },
            ctx.in,
          ) as RequestResponse<R>
        );
        return (next || (() => Promise.resolve()))();
      }]
    });

    const clock = setTimeout(() => reject(new Error("request timeout")), opts?.timeout || this._timeout);

    try {
      await this.send(msg, opts);
      return await promise;
    } finally {
      clearTimeout(clock);
      dispose();
    }
  }

  intercept(id: string, handlers: Processor<Context>[]): () => void {
    return this._interceptor.intercept({ id, handlers });
  }

  before(processor: Processor<Context>): this {
    this._before.use(processor);
    return this;
  }

  createId(): string {
    return this._uuid();
  }

  /** Expose IVia as a StreamTransport for the stream layer */
  _asTransport(): StreamTransport {
    const wire = this._wire;
    return {
      send: (msg: Partial<Message>) => this.send(msg),
      intercept: (id: string, handler: (msg: Message) => void | Promise<void>) => {
        return this._interceptor.interceptFn(id, handler);
      },
      createId: () => this.createId(),
      get closed() { return wire.readyState !== WireState.OPEN; },
      onClose: (cb: () => void) => {
        this._ev.once("close", cb);
        return () => this._ev.off("close", cb);
      },
    };
  }

  on(event: "close", cb: () => void): void;
  on(event: "open", cb: () => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  on(event: string, cb: (...args: unknown[]) => void) {
    this._ev.on(event, cb);
  }

  off(event: "close", cb: () => void): void;
  off(event: "open", cb: () => void): void;
  off(event: "error", cb: (err: unknown) => void): void;
  off(event: string, cb: (...args: unknown[]) => void) {
    this._ev.off(event, cb);
  }
}

/* ── Middleware ─────────────────────────────────────────────── */

/** Serialise and send the outgoing message over the wire */
class Send implements Middleware<Context> {
  constructor(private _encoder: FrameEncoder) {}
  process(ctx: Context, next: Next): Promise<void> {
    const out = ctx.out;
    if (out) {
      const frame = {
        id: out.id,
        head: out.head as Record<string, unknown>,
        data: out.data,
      };
      const bytes = this._encoder.encode(frame);
      ctx.connection.wire.send(bytes);
    }
    return next();
  }
}

/** 
 * If outgoing data is a ReadableStream, set up multiplexed stream sender 
 * with credit-based backpressure. Replaces the data with a stream id header.
 */
class OutgoingStreamUpgrade implements Middleware<Context> {
  process(ctx: Context, next: Next): Promise<void> {
    if (!ctx.out || !isReadableStream(ctx.out.data)) return next();

    const readable = ctx.out.data as ReadableStream;
    const transport = (ctx.connection as Via)._asTransport();

    const sender = createOutgoingStream(readable, transport, (value: unknown) => {
      return { data: value };
    });

    ctx.out.head.sid = sender.sid;
    delete ctx.out.data;

    ctx.tasks.push({ name: "OutgoingStream", complete: sender.complete });

    return next();
  }
}

/** 
 * If incoming message has a stream id (sid), create a ReadableStream
 * with credit-based backpressure that pulls from the multiplexed stream.
 */
class IncomingStreamUpgrade implements Middleware<Context> {
  process(ctx: Context, next: Next): Promise<void> {
    const sid = ctx.in.head.sid as string | undefined;
    if (!sid) return next();

    const transport = (ctx.connection as Via)._asTransport();
    ctx.in.data = createIncomingStream(sid, transport);

    return next();
  }
}
