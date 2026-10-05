import { type Message, type MessageHeader } from "./message.js";
import { Status } from "./status.js";

/**
 * WHATWG-aligned backpressure streaming protocol.
 *
 * Consumer > Producer:
 *   START(desiredSize: N)  - opens the stream; sets the producer's initial credit to N
 *   PULL(desiredSize: M)   - sets the producer's credit to M
 *   CANCEL(data?: reason)  - consumer-side abort
 *
 * Producer > Consumer:
 *   { status: 206, data }  - one chunk (Partial)
 *   { status: 200 }        - stream complete
 *   { status: 500, data }  - stream error
 *   CANCEL(data?: reason)  - producer-side abort
 *
 * Credit is a SET operation, not additive. The producer sends at most the
 * currently granted number of chunks before waiting for another PULL.
 */

const DEFAULT_WINDOW = 32;
const DEFAULT_START_TIMEOUT = 3000;
const DEFAULT_IDLE_TIMEOUT = 0;
const DEFAULT_PRODUCER_IDLE_TIMEOUT = 0;
const DEFAULT_MAX_QUEUED_CHUNKS = 1024;
const DEFAULT_MAX_QUEUED_BYTES = 64 * 1024 * 1024;
const MAX_CREDIT = Number.MAX_SAFE_INTEGER;

function toCredit(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_CREDIT, Math.ceil(value));
}

function isBinaryChunk(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return ArrayBuffer.isView(value)
    || Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/**
 * Approximate wire size of a chunk. Binary chunks use their exact byte
 * length; other values fall back to the raw encoded segment length when the
 * transport provides it, otherwise one byte.
 */
function chunkSize(value: unknown, rawLength?: number): number {
  if (isBinaryChunk(value)) return value.byteLength;
  return rawLength ?? 1;
}

export interface StreamOptions {
  /** Internal queue highWaterMark for the consumer ReadableStream. Default: 32. */
  highWaterMark?: number;
  /**
   * Maximum number of chunks held outside the WHATWG stream queue while a
   * peer is sending faster than the consumer. Default: 1024. Set to 0 to
   * reject unsolicited chunks immediately, or to `Infinity` to opt out of
   * the chunk bound.
   */
  maxQueuedChunks?: number;
  /**
   * Approximate byte limit for queued chunks. Binary chunks are counted
   * exactly; other chunks use the raw encoded segment length when available,
   * otherwise one byte. Default: 64 MiB (64 * 1024 * 1024). Set to
   * `Infinity` to opt out of the byte bound.
   */
  maxQueuedBytes?: number;
  /**
   * Default data encoding for stream chunks when the enclosing message does
   * not specify one. The default remains "cbor" for compatibility.
   */
  encoding?: string;
  /**
   * Validate stream control frames strictly. The default is false so peers
   * using the historical permissive behavior remain interoperable.
   */
  strictProtocol?: boolean;
  /**
   * Cancel an incoming request body when its request context is disposed.
   * Defaults to false so handlers may transfer ownership of the stream.
   */
  cancelIncomingOnDispose?: boolean;
  /**
   * Max ms the producer waits for the consumer's initial START (or first PULL)
   * before aborting. Only applied on the first credit wait. Default: 3_000.
   * Set to 0 to disable.
   */
  startTimeout?: number;
  /**
   * Max ms the producer may go without protocol progress (a successful chunk
   * send or a received credit update) after the consumer's first credit. On
   * expiry the producer aborts the stream and terminates it with an error
   * frame. Default: 0 (disabled). Set to a positive value to enable.
   */
  producerIdleTimeout?: number;
  /**
   * Max ms the consumer waits for the next chunk while a read is blocked.
   * Default: 0 (disabled). Set to a positive value to enable.
   */
  idleTimeout?: number;
  /**
   * Upper bound on stream credit — the number of chunks a producer may have
   * in flight at once. Default: Infinity (unbounded). Must be a positive
   * safe integer or `Infinity`.
   *
   * Applied to both roles so the credit accounting stays consistent:
   * a consumer clamps the credit it requests (START/PULL desiredSize and its
   * initial window) to `maxCredit`, while a producer treats a grant larger
   * than `maxCredit` as a configuration mismatch and fails the stream fast
   * (protocol error + error frame) rather than silently clamping and
   * deadlocking against a peer that thinks it granted more. Configure the
   * same value on both peers.
   */
  maxCredit?: number;
}

export interface StreamSender {
  readonly sid: string;
  readonly complete: Promise<void>;
  /**
   * Stop the pump and cancel source reads. Best-effort sends a CANCEL frame
   * to the consumer when the transport is still open. Idempotent.
   */
  cancel(reason?: unknown): void;
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
 * Blocking queue - suspends next() until a chunk arrives, closes, or errors.
 * Bounded by finite defaults (1024 chunks / 64 MiB); callers can opt out of
 * either bound with `Infinity` through StreamOptions. Entries are stored with
 * their advertised size and read through a head index (no `Array.shift` on
 * the hot path), compacting the backing array periodically.
 */
interface QueueEntry<T> {
  value: T;
  size: number;
}

class BlockingQueue<T> {
  private _entries: Array<QueueEntry<T> | undefined> = [];
  private _head = 0;
  private _queuedBytes = 0;
  private _waiters: Array<{
    resolve: (result: IteratorResult<T, undefined>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private _closed = false;
  private _hasError = false;
  private _error: unknown;

  constructor(
    private readonly _maxChunks: number,
    private readonly _maxBytes: number,
  ) {}

  private get _queuedChunks(): number {
    return this._entries.length - this._head;
  }

  push(chunk: T, size: number): boolean {
    if (this._closed) return true;

    if (this._waiters.length > 0) {
      this._waiters.shift()!.resolve({ value: chunk, done: false });
      return true;
    }

    if (this._maxChunks !== Infinity && this._queuedChunks >= this._maxChunks) return false;
    if (this._maxBytes !== Infinity && this._queuedBytes + size > this._maxBytes) return false;

    this._entries.push({ value: chunk, size });
    this._queuedBytes += size;
    return true;
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    for (const waiter of this._waiters) waiter.resolve({ value: undefined, done: true });
    this._waiters = [];
  }

  abort(error: unknown): void {
    if (this._closed) return;
    this._closed = true;
    this._hasError = true;
    this._error = error;
    this._entries = [];
    this._head = 0;
    this._queuedBytes = 0;
    for (const waiter of this._waiters) waiter.reject(error);
    this._waiters = [];
  }

  get isEmpty(): boolean {
    return this._queuedChunks === 0;
  }

  next(onWait?: () => void): Promise<IteratorResult<T, undefined>> {
    if (this._hasError) return Promise.reject(this._error);

    if (this._head < this._entries.length) {
      const entry = this._entries[this._head]!;
      this._entries[this._head] = undefined;
      this._head++;
      this._queuedBytes -= entry.size;
      // Compact consumed slots before the backing array grows without bound.
      if (this._head > 64 && this._head * 2 >= this._entries.length) {
        this._entries = this._entries.slice(this._head);
        this._head = 0;
      }
      return Promise.resolve({ value: entry.value, done: false });
    }

    if (this._closed) return Promise.resolve({ value: undefined, done: true });

    // Register before onWait so a synchronous transport cannot strand the
    // requested chunk between the callback and waiter registration.
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this._waiters.push(waiter);
      try {
        onWait?.();
      } catch (error) {
        const index = this._waiters.indexOf(waiter);
        if (index >= 0) this._waiters.splice(index, 1);
        reject(error);
      }
    });
  }
}

function validateTimeout(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

function validateLimit(value: number, name: string): void {
  if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${name} must be a non-negative safe integer or Infinity`);
  }
}

function validatePositiveLimit(value: number, name: string): void {
  if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError(`${name} must be a positive safe integer or Infinity`);
  }
}

/** Create a ReadableStream backed by a remote multiplexed stream. */
export function createIncomingStream<T = unknown>(
  sid: string,
  transport: StreamTransport,
  options?: StreamOptions,
): ReadableStream<T> {
  const highWaterMark = options?.highWaterMark ?? DEFAULT_WINDOW;
  const idleTimeout = options?.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
  const maxQueuedChunks = options?.maxQueuedChunks ?? DEFAULT_MAX_QUEUED_CHUNKS;
  const maxQueuedBytes = options?.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
  const strictProtocol = options?.strictProtocol ?? false;
  const maxCredit = options?.maxCredit ?? Infinity;

  validateTimeout(highWaterMark, "highWaterMark");
  validateTimeout(idleTimeout, "idleTimeout");
  validateLimit(maxQueuedChunks, "maxQueuedChunks");
  validateLimit(maxQueuedBytes, "maxQueuedBytes");
  validatePositiveLimit(maxCredit, "maxCredit");

  const queue = new BlockingQueue<T>(maxQueuedChunks, maxQueuedBytes);
  let cancelled = false;
  let terminated = false;
  let started = false;
  let granted = 0;
  let controller: ReadableStreamDefaultController<T> | undefined;
  let aborted = false;
  let terminalError: unknown;
  let dispose: () => void = () => {};
  let offClose: (() => void) | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function sendBestEffort(msg: Partial<Message>): void {
    try {
      Promise.resolve(transport.send(msg)).catch(() => {});
    } catch {
      // The transport is already unavailable.
    }
  }

  function clearIdleTimer(): void {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function disposeStream(): void {
    clearIdleTimer();
    offClose?.();
    offClose = undefined;
    dispose();
  }

  function abortStream(error: unknown): void {
    if (terminated) return;
    terminated = true;
    aborted = true;
    terminalError = error;
    disposeStream();
    queue.abort(error);
    try { controller?.error(error); } catch { /* controller may already be terminal */ }
  }

  function closeStream(): void {
    if (terminated) return;
    terminated = true;
    disposeStream();
    queue.close();
  }

  function resetIdleTimer(): void {
    if (idleTimeout <= 0 || terminated || cancelled) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      if (terminated || cancelled) return;
      const error = new Error(`stream idle timeout: no data from producer within ${idleTimeout}ms`);
      abortStream(error);
      if (!transport.closed) {
        sendBestEffort({ id: sid, head: { method: "CANCEL" }, data: error.message });
      }
    }, idleTimeout);
  }

  dispose = transport.intercept(sid, async (msg: Message) => {
    if (terminated) return;
    const head = msg.head;
    if (!head || typeof head !== "object") {
      if (strictProtocol) abortStream(new Error("invalid stream frame head"));
      return;
    }

    const status = head.status;
    if (status === Status.Partial) {
      if (strictProtocol && head.method !== undefined) {
        const error = new Error(`invalid stream partial method: ${String(head.method)}`);
        abortStream(error);
        if (!transport.closed) {
          sendBestEffort({ id: sid, head: { method: "CANCEL" }, data: error.message });
        }
        return;
      }
      // A received chunk is progress. If it is buffered, the next pull will
      // decide when a new idle window should begin.
      clearIdleTimer();
      if (granted > 0) granted--;
      const data = msg.data as T;
      if (!queue.push(data, chunkSize(data, msg.raw?.byteLength))) {
        const limit = maxQueuedChunks !== Infinity && maxQueuedBytes !== Infinity
          ? `${maxQueuedChunks} chunks/${maxQueuedBytes} bytes`
          : maxQueuedChunks !== Infinity ? `${maxQueuedChunks} chunks` : `${maxQueuedBytes} bytes`;
        const error = new Error(`stream buffer exceeded ${limit}`);
        abortStream(error);
        if (!transport.closed) {
          sendBestEffort({ id: sid, head: { method: "CANCEL" }, data: error.message });
        }
      }
      return;
    }

    if (status === Status.Error) {
      abortStream(msg.data ?? new Error("stream error"));
      return;
    }

    if (head.method === "CANCEL") {
      abortStream(msg.data ?? new Error("stream cancelled by producer"));
      return;
    }

    if (strictProtocol && (head.method !== undefined || status !== Status.OK)) {
      const error = head.method !== undefined
        ? new Error(`invalid stream control method: ${String(head.method)}`)
        : new Error(`invalid stream terminal status: ${String(status)}`);
      abortStream(error);
      if (!transport.closed) {
        sendBestEffort({ id: sid, head: { method: "CANCEL" }, data: error.message });
      }
      return;
    }

    // Preserve the historical behavior for permissive peers: any remaining
    // status-bearing frame is a terminal frame.
    closeStream();
  });

  offClose = transport.onClose?.(() => {
    abortStream(new Error("stream transport closed"));
  });
  if (transport.closed) queueMicrotask(() => abortStream(new Error("stream transport closed")));

  return new ReadableStream<T>({
    async start(streamController) {
      controller = streamController;
      if (terminated || cancelled) {
        if (aborted) {
          try { streamController.error(terminalError); } catch { /* controller may already be terminal */ }
        }
        return;
      }

      try {
        started = true;
        // Never request more credit than the configured cap; a producer on
        // this connection is expected to enforce the same cap, so granting
        // more here would desynchronise the two sides' accounting.
        granted = Math.min(toCredit(highWaterMark), maxCredit);
        await transport.send({ id: sid, head: { method: "START", desiredSize: granted } });
      } catch (error) {
        abortStream(error);
        try { streamController.error(error); } catch { /* controller may already be terminal */ }
      }
    },

    async pull(streamController) {
      try {
        const result = await queue.next(() => {
          resetIdleTimer();
          const desiredSize = streamController.desiredSize;
          if (!started || granted > 0 || desiredSize == null || transport.closed) return;

          // CountQueuingStrategy can expose a fractional desiredSize. The wire
          // protocol carries whole chunk credits; zero still means one pending
          // read and therefore needs one credit. Never request more than the
          // configured cap, even when the local window is larger.
          const requestedCredit = Math.min(desiredSize > 0 ? toCredit(desiredSize) : 1, maxCredit);
          granted = requestedCredit;
          try {
            transport.send({ id: sid, head: { method: "PULL", desiredSize: requestedCredit } })
              .catch(abortStream);
          } catch (error) {
            abortStream(error);
            throw error;
          }
        });

        if (cancelled) return;
        if (result.done) streamController.close();
        else streamController.enqueue(result.value);
      } catch (error) {
        if (!cancelled) {
          abortStream(error);
          try { streamController.error(error); } catch { /* controller may already be terminal */ }
        }
      }
    },

    async cancel(reason?: unknown) {
      cancelled = true;
      terminated = true;
      clearIdleTimer();
      queue.abort(reason ?? new Error("stream cancelled"));
      disposeStream();

      if (!transport.closed) {
        const data = reason instanceof Error ? reason.message
          : reason != null ? String(reason) : undefined;
        try {
          await transport.send({
            id: sid,
            head: { method: "CANCEL" },
            ...(data !== undefined ? { data } : {}),
          });
        } catch (error) {
          if (!transport.closed) throw error;
        }
      }
    },
  }, new CountQueuingStrategy({ highWaterMark }));
}

/** Pump a ReadableStream over the wire as a multiplexed stream. */
export function createOutgoingStream(
  readable: ReadableStream,
  transport: StreamTransport,
  encodeChunk: (value: unknown) => Partial<Message>,
  options?: StreamOptions,
): StreamSender {
  const startTimeout = options?.startTimeout ?? DEFAULT_START_TIMEOUT;
  const producerIdleTimeout = options?.producerIdleTimeout ?? DEFAULT_PRODUCER_IDLE_TIMEOUT;
  const maxCredit = options?.maxCredit ?? Infinity;
  validateTimeout(startTimeout, "startTimeout");
  validateTimeout(producerIdleTimeout, "producerIdleTimeout");
  validatePositiveLimit(maxCredit, "maxCredit");

  const sid = transport.createId();
  const strictProtocol = options?.strictProtocol ?? false;
  const defaultEncoding = options?.encoding;
  const reader = readable.getReader();
  let credit = 0;
  let waitingForCredit: (() => void) | undefined;
  let cancelled = false;
  let protocolError: Error | undefined;
  let sourceDone = false;
  let receivedStart = false;
  let dispose: () => void = () => {};
  let offClose: (() => void) | undefined;
  let readerCancel: Promise<void> | undefined;
  let producerIdleTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>(resolve => { resolveStopped = resolve; });

  function cancelReader(reason?: unknown): void {
    if (readerCancel) return;
    try {
      readerCancel = Promise.resolve(reader.cancel(reason)).catch(() => {});
    } catch {
      readerCancel = Promise.resolve();
    }
  }

  function clearProducerIdleTimer(): void {
    if (producerIdleTimer !== undefined) {
      clearTimeout(producerIdleTimer);
      producerIdleTimer = undefined;
    }
  }

  function resetProducerIdleTimer(): void {
    if (producerIdleTimeout <= 0 || cancelled || protocolError) return;
    clearProducerIdleTimer();
    producerIdleTimer = setTimeout(() => {
      producerIdleTimer = undefined;
      if (cancelled || protocolError) return;
      failProtocol(`stream producer idle timeout: no progress for ${producerIdleTimeout}ms`);
    }, producerIdleTimeout);
  }

  function cancelStream(reason?: unknown): void {
    if (cancelled) return;
    cancelled = true;
    clearProducerIdleTimer();
    credit = 0;
    const waiter = waitingForCredit;
    waitingForCredit = undefined;
    waiter?.();
    resolveStopped();
    cancelReader(reason);
  }

  function failProtocol(message: string): void {
    if (protocolError || cancelled) return;
    protocolError = new Error(message);
    clearProducerIdleTimer();
    const waiter = waitingForCredit;
    waitingForCredit = undefined;
    waiter?.();
    resolveStopped();
    cancelReader(protocolError);
  }

  offClose = transport.onClose?.(() => {
    cancelStream(new Error("stream transport closed"));
  });

  dispose = transport.intercept(sid, (msg: Message) => {
    const head = msg.head;
    if (!head || typeof head !== "object") {
      if (strictProtocol) failProtocol("invalid stream frame head");
      return;
    }

    const method = head.method;
    if (method === "START" || method === "PULL") {
      if (strictProtocol && method === "START" && receivedStart) {
        failProtocol("duplicate stream START");
        return;
      }
      if (strictProtocol && method === "PULL" && !receivedStart) {
        failProtocol("stream PULL received before START");
        return;
      }
      if (method === "START") receivedStart = true;

      const desiredSize = head.desiredSize;
      const validCredit = typeof desiredSize === "number"
        && Number.isFinite(desiredSize)
        && desiredSize >= 0
        && desiredSize <= MAX_CREDIT
        && (!strictProtocol || Number.isSafeInteger(desiredSize));

      if (!validCredit) {
        if (strictProtocol) {
          failProtocol("invalid stream credit: desiredSize must be a non-negative safe integer");
        } else {
          // Match the historical `(desiredSize as number) || 0` fallback,
          // without allowing malformed values to create unbounded credit.
          credit = 0;
        }
        return;
      }

      const granted = Math.ceil(desiredSize);
      if (granted > maxCredit) {
        // A grant above the local cap is a configuration mismatch: granting
        // it would exceed this producer's bound, while clamping it silently
        // would leave a consumer waiting for a PULL that never comes (its
        // accounting still expects the full window). Fail fast instead.
        failProtocol(`granted credit ${granted} exceeds maxCredit ${maxCredit}`);
        return;
      }
      credit = Math.min(granted, maxCredit);
      resetProducerIdleTimer();
      if (waitingForCredit && credit > 0) {
        const waiter = waitingForCredit;
        waitingForCredit = undefined;
        waiter();
      }
      return;
    }

    if (method === "CANCEL") {
      cancelStream(msg.data);
      return;
    }

    if (strictProtocol && method !== undefined) {
      failProtocol(`invalid stream control method: ${String(method)}`);
    }
    // Unknown methods remain ignored for compatibility with existing peers.
  });

  function cancel(reason?: unknown): void {
    if (cancelled) return;
    cancelStream(reason);
    if (transport.closed) return;
    const data = reason instanceof Error ? reason.message
      : reason != null ? String(reason) : undefined;
    // Fire-and-forget: the pump is already stopped, so this intentionally
    // bypasses the cancelled-state guard inside sendFrame.
    try {
      Promise.resolve(transport.send({
        id: sid,
        head: { method: "CANCEL" },
        ...(data !== undefined ? { data } : {}),
      })).catch(() => {});
    } catch {
      // The transport is already unavailable.
    }
  }

  if (transport.closed) queueMicrotask(() => cancelStream(new Error("stream transport closed")));

  let startTimerArmed = true;
  function waitForCredit(): Promise<void> {
    if (protocolError) return Promise.reject(protocolError);
    if (credit > 0 || cancelled) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };

      waitingForCredit = () => {
        cleanup();
        resolve();
      };

      if (startTimerArmed && startTimeout > 0) {
        startTimerArmed = false;
        timer = setTimeout(() => {
          waitingForCredit = undefined;
          cleanup();
          reject(new Error(`stream start timeout: consumer did not start reading within ${startTimeout}ms`));
        }, startTimeout);
      }
    });
  }

  async function sendFrame(msg: Partial<Message>, allowAfterStop = false): Promise<boolean> {
    if (!allowAfterStop && (cancelled || transport.closed)) return false;

    let sent: Promise<void>;
    try {
      sent = Promise.resolve(transport.send(msg));
    } catch (error) {
      throw error;
    }

    if (allowAfterStop) {
      await sent;
      return true;
    }

    return Promise.race([
      sent.then(() => true),
      stopped.then(() => false),
    ]);
  }

  const complete = (async () => {
    try {
      while (!cancelled) {
        await waitForCredit();
        if (protocolError) throw protocolError;
        if (cancelled) break;

        const result = await Promise.race([
          reader.read(),
          stopped.then(() => ({ done: true, value: undefined } as IteratorResult<unknown>)),
        ]);
        if (protocolError) throw protocolError;
        if (cancelled) break;

        if (result.done) {
          sourceDone = true;
          if (!await sendFrame({ id: sid, head: { status: Status.OK } as MessageHeader })) {
            // A protocol error may have fired while the terminal frame was in
            // flight; route it through the catch so the error frame is sent.
            if (protocolError) throw protocolError;
          }
          break;
        }

        credit--;
        const chunk = encodeChunk(result.value);
        chunk.id = sid;
        chunk.head = {
          ...chunk.head,
          ...(defaultEncoding !== undefined && chunk.head?.encoding === undefined
            ? { encoding: defaultEncoding }
            : {}),
          status: Status.Partial,
        };
        if (!await sendFrame(chunk)) {
          if (protocolError) throw protocolError;
          break;
        }
        resetProducerIdleTimer();
      }
    } catch (error) {
      if (!cancelled || protocolError) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          const sent = await sendFrame(
            { id: sid, head: { status: Status.Error } as MessageHeader, data: message },
            !!protocolError,
          );
          if (!sent && !transport.closed) {
            await sendFrame({ id: sid, head: { method: "CANCEL" }, data: message }, true).catch(() => {});
          }
        } catch {
          if (!transport.closed) {
            await sendFrame({ id: sid, head: { method: "CANCEL" }, data: message }, true).catch(() => {});
          }
        }
        // Surface source, send and protocol failures through `complete`
        // (consumed by via.ts). A consumer-initiated CANCEL or a transport
        // close stays a clean resolve.
        throw error;
      }
    } finally {
      clearProducerIdleTimer();
      resolveStopped();
      offClose?.();
      offClose = undefined;
      dispose();
      if (!sourceDone && !cancelled) cancelReader(protocolError);
    }
  })();

  return { sid, complete, cancel };
}
