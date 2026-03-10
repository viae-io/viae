import { type Message, type MessageHeader } from "./message.js";
import { Status } from "./status.js";

/**
 * WHATWG-aligned backpressure streaming protocol.
 *
 * Consumer → Producer:
 *   START(desiredSize: N)  – confirms the stream is open; grants N initial pull slots
 *   PULL(desiredSize: M)   – grants M more slots (one per chunk consumed, mirrors pull())
 *   COMPLETE               – acknowledges a terminal frame; producer may now clean up
 *   CANCEL(data?: reason)  – consumer-side abort; mirrors ReadableStream cancel(reason)
 *
 * Producer → Consumer:
 *   { status: 206, data }  – one chunk (Partial)
 *   { status: 200 }        – stream complete (normal)
 *   { status: 500, data }  – stream error
 *   CANCEL(data?: reason)  – producer-side abort (e.g. source errored before terminal sent)
 *
 * The producer holds its sid interceptor open after sending the terminal frame
 * until it receives COMPLETE (or CANCEL, or transport close).  This absorbs any
 * in-flight PULL frames that arrive after the terminal, preventing them from
 * being misrouted as new requests.
 *
 * The consumer side uses a BlockingQueue so that pull() is only ever called for
 * chunks that have actually arrived.  Once the queue closes (terminal received),
 * the next pull() gets done:true and calls controller.close() — after which the
 * ReadableStream never calls pull() again, guaranteeing no stray PULL frames.
 */

const DEFAULT_WINDOW = 32;

export interface StreamSender {
  readonly sid: string;
  readonly complete: Promise<void>;
}

export interface StreamTransport {
  send(msg: Partial<Message>): Promise<void>;
  intercept(id: string, handler: (msg: Message) => void | Promise<void>): () => void;
  createId(): string;
  /** True when the transport is closed or closing; used to suppress expected send failures. */
  readonly closed?: boolean;
  /** Optional: one-shot callback when the transport closes. Returns unsubscribe fn. */
  onClose?(cb: () => void): () => void;
}

/**
 * Blocking queue — suspends the caller in next() until a chunk arrives,
 * closes, or errors.  One waiter at a time (matches ReadableStream pull semantics).
 */
class BlockingQueue<T> {
  private _chunks: T[] = [];
  private _waiters: Array<{
    resolve: (r: IteratorResult<T, undefined>) => void;
    reject: (e: unknown) => void;
  }> = [];
  private _closed = false;
  private _error: unknown;
  private _hasError = false;

  push(chunk: T): void {
    if (this._waiters.length > 0) {
      this._waiters.shift()!.resolve({ value: chunk, done: false });
    } else {
      this._chunks.push(chunk);
    }
  }

  close(): void {
    this._closed = true;
    for (const w of this._waiters) w.resolve({ value: undefined, done: true });
    this._waiters = [];
  }

  abort(err: unknown): void {
    this._hasError = true;
    this._error = err;
    this._closed = true;
    for (const w of this._waiters) w.reject(err);
    this._waiters = [];
  }

  next(): Promise<IteratorResult<T, undefined>> {
    if (this._chunks.length > 0) return Promise.resolve({ value: this._chunks.shift()!, done: false });
    if (this._hasError) return Promise.reject(this._error);
    if (this._closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this._waiters.push({ resolve, reject }));
  }
}

/**
 * Create a ReadableStream backed by a remote multiplexed stream.
 *
 * pull() blocks on the BlockingQueue, so PULL is only ever sent for chunks
 * that have been truly consumed.  When the terminal arrives the queue closes,
 * the pending pull() resolves with done:true, and controller.close() is called —
 * no further pull() (and therefore no stray PULL frame) is possible after that point.
 */
export function createIncomingStream<T = unknown>(
  sid: string,
  transport: StreamTransport,
  highWaterMark = DEFAULT_WINDOW,
): ReadableStream<T> {
  const queue = new BlockingQueue<T>();
  let cancelled = false;

  const dispose = transport.intercept(sid, async (msg: Message) => {
    const status = msg.head.status;
    if (status === Status.Partial) {
      queue.push(msg.data as T);
    } else if (status === Status.Error) {
      try {
        await transport.send({ id: sid, head: { method: "COMPLETE" } });
      } finally {
        dispose();
        queue.abort(msg.data ?? new Error("stream error"));
      }
    } else if (msg.head.method === "CANCEL") {
      /* Producer-side abort — treat as an error on the consumer */
      dispose();
      queue.abort(msg.data ?? new Error("stream cancelled by producer"));
    } else {
      /* Status.OK or any other terminal status */
      try {
        await transport.send({ id: sid, head: { method: "COMPLETE" } });
      } finally {
        dispose();
        queue.close();
      }
    }
  });

  return new ReadableStream<T>({
    async start(controller) {
      try {
        await transport.send({ id: sid, head: { method: "START", desiredSize: highWaterMark } });
      } catch (err) {
        dispose();
        queue.abort(err);
        controller.error(err);
      }
    },
    async pull(controller) {
      try {
        const result = await queue.next();
        if (cancelled) return;
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
          /* One chunk consumed → grant one more pull slot (mirrors WHATWG pull()) */
          try {
            await transport.send({ id: sid, head: { method: "PULL", desiredSize: 1 } });
          } catch (err) {
            /* Transport closed between chunk arrival and PULL send:
               producer will clean up via the transport close event. */
            if (!transport.closed) throw err;
          }
        }
      } catch (err) {
        if (!cancelled) controller.error(err);
      }
    },
    async cancel(reason?: unknown) {
      cancelled = true;
      queue.abort(reason ?? new Error("stream cancelled"));
      dispose();
      if (!transport.closed) {
        const data = reason instanceof Error ? reason.message
          : reason != null ? String(reason) : undefined;
        await transport.send({ id: sid, head: { method: "CANCEL" }, ...(data !== undefined ? { data } : {}) });
      }
    },
  }, new CountQueuingStrategy({ highWaterMark }));
}

/**
 * Pump a ReadableStream over the wire as a multiplexed stream.
 *
 * Waits for START before sending any chunks.  After sending the terminal frame,
 * holds the sid interceptor open until the consumer sends COMPLETE (absorbing any
 * in-flight PULL frames so they are never misrouted as new requests).
 */
export function createOutgoingStream(
  readable: ReadableStream,
  transport: StreamTransport,
  encodeChunk: (value: unknown) => Partial<Message>,
): StreamSender {
  const sid = transport.createId();
  let credit = 0;
  let waitingForCredit: (() => void) | undefined;
  let cancelled = false;

  let resolveComplete!: () => void;
  const completeAck = new Promise<void>(r => { resolveComplete = r; });

  const dispose = transport.intercept(sid, (msg: Message) => {
    const method = msg.head.method;
    if (method === "START" || method === "PULL") {
      credit += (msg.head.desiredSize as number) || 0;
      if (waitingForCredit && credit > 0) {
        const fn = waitingForCredit;
        waitingForCredit = undefined;
        fn();
      }
    } else if (method === "CANCEL") {
      cancelled = true;
      /* unblock any suspended waitForCredit() */
      const fn = waitingForCredit;
      waitingForCredit = undefined;
      fn?.();
      resolveComplete();
      reader.cancel(msg.data).catch(() => {});
      dispose();
    } else if (method === "COMPLETE") {
      resolveComplete();
      dispose();
    }
  });

  const reader = readable.getReader();

  function waitForCredit(): Promise<void> {
    if (credit > 0 || cancelled) return Promise.resolve();
    return new Promise<void>(resolve => { waitingForCredit = resolve; });
  }

  const complete = (async () => {
    let sentTerminal = false;
    let offClose: (() => void) | undefined;

    try {
      while (!cancelled) {
        await waitForCredit();
        if (cancelled) break;

        const { done, value } = await reader.read();
        if (cancelled) break; /* CANCEL may have arrived during the read */

        if (done) {
          await transport.send({ id: sid, head: { status: Status.OK } as MessageHeader });
          sentTerminal = true;
          break;
        }

        credit--;
        const chunk = encodeChunk(value);
        chunk.id = sid;
        chunk.head = { ...chunk.head, status: Status.Partial };
        await transport.send(chunk);
      }
    } catch (err) {
      if (!cancelled) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          await transport.send({ id: sid, head: { status: Status.Error } as MessageHeader, data: message });
          sentTerminal = true;
        } catch {
          /* error-status send failed; attempt best-effort CANCEL if transport is still open.
             If transport is closed the consumer will clean up via the close event. */
          if (!transport.closed) {
            await transport.send({ id: sid, head: { method: "CANCEL" }, data: message });
          }
        }
      }
    } finally {
      if (!sentTerminal) {
        /* Cancelled or error with closed wire — clean up immediately */
        dispose();
        resolveComplete(); /* idempotent */
      }
    }

    if (sentTerminal) {
      /* Keep the interceptor alive (to absorb in-flight PULLs) until the
         consumer acknowledges the terminal frame, or the transport closes. */
      offClose = transport.onClose?.(() => resolveComplete());
      try {
        await completeAck;
      } finally {
        offClose?.();
      }
    }
  })();

  return { sid, complete };
}

