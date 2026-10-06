import { Rowan, After, AfterIf, type Processor, Catch, type Next, type Middleware } from "rowan";
import { EventEmitter } from "eventemitter3";
import { type Wire, WireState } from "./wire.js";
import { type Message, type MessageHeader, type Response } from "./message.js";
import { type Context, DefaultContext } from "./context.js";
import { Interceptor } from "./interceptor.js";
import { Status } from "./status.js";
import type { Log } from "./log.js";
import { consoleLog } from "./log.js";
import { shortId } from "./util.js";
import { type Codex, FrameEncoder, type FrameEncoderOptions } from "./codec.js";
import { createOutgoingStream, createIncomingStream, type StreamTransport, type StreamOptions } from "./stream.js";
import { ViaeError } from "./error.js";

function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data as ArrayBuffer);
}

function isReadableStream(obj: unknown): obj is ReadableStream {
  if (obj == null) return false;
  if (obj instanceof ReadableStream) return true;
  if (typeof obj === "object" && typeof (obj as { getReader?: unknown }).getReader === "function") return true;
  return false;
}

/** Module-private wire ownership marker (D8): one Via per wire. */
const WIRE_OWNER = Symbol("viae.wireOwner");

/** Protocol methods reserved for streams/heartbeat; they bypass the inflight cap (D5). */
const RESERVED_METHODS = new Set(["PING", "PONG", "START", "PULL", "CANCEL", "COMPLETE"]);

const DEFAULT_DRAIN_TIMEOUT = 5000;
const BACKPRESSURE_POLL_MS = 4;
const DEFAULT_HEARTBEAT_INTERVAL = 15000;
const DEFAULT_HEARTBEAT_TIMEOUT = 5000;
const DEFAULT_RECONNECT_MIN_DELAY = 100;
const DEFAULT_RECONNECT_MAX_DELAY = 10000;
const DEFAULT_RECONNECT_FACTOR = 2;
const DEFAULT_RECONNECT_JITTER = 0.2;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function validateLimitOption(value: number | undefined, name: string): number {
  const resolved = value ?? 0;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}

function validatePositiveFinite(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return resolved;
}

function validateNonNegativeFinite(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
  return resolved;
}

function validateUnitInterval(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < 0 || resolved > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
  return resolved;
}

function validateMaxAttempts(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (resolved === Infinity) return resolved;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive integer or Infinity`);
  }
  return resolved;
}

/** Wire listeners bound for one generation, kept so a stale wire can be unbound (D12). */
interface WireHandlers {
  wire: Wire;
  generation: number;
  onMessage: (data: ArrayBuffer | ArrayBufferView) => void;
  onOpen: () => void;
  onClose: () => void;
  onError: (err: unknown) => void;
}

/** Heartbeat tuning in milliseconds (D1). */
export interface HeartbeatOptions {
  /** Delay between beats. Default 15000. */
  interval?: number;
  /** Time allowed for liveness proof before the connection is failed. Default 5000. */
  timeout?: number;
}

/** Opt-in client reconnect policy (D3). */
export interface ReconnectOptions {
  /** Creates the replacement wire for each attempt. */
  wire: () => Wire | Promise<Wire>;
  /** Initial backoff delay in ms. Default 100. */
  minDelay?: number;
  /** Backoff ceiling in ms. Default 10000. */
  maxDelay?: number;
  /** Backoff multiplier. Default 2. */
  factor?: number;
  /** Backoff jitter ratio in [0, 1]. Default 0.2. */
  jitter?: number;
  /** Maximum consecutive attempts. Default Infinity. */
  maxAttempts?: number;
}

interface ReconnectPolicy {
  wire: () => Wire | Promise<Wire>;
  minDelay: number;
  maxDelay: number;
  factor: number;
  jitter: number;
  maxAttempts: number;
}

interface ReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface IVia<S = unknown> {
  readonly wire: Wire;
  readonly closed: boolean;
  /**
   * Per-connection state/claims snapshot, typed by the constructing `Via`
   * (`ViaOptions.state` infers `S`). Required: structural `IVia` mocks must
   * supply a `state` member.
   */
  readonly state: S;
  send(msg: Partial<Message>, opts?: SendOptions): Promise<void>;
  request<R>(method: string, path: string, data?: unknown, opts?: RequestOptions): Promise<RequestResponse<R>>;
  intercept(id: string, handlers: Processor<Context>[]): () => void;
  createId(): string;
  readonly log: Log;
  close(opts?: CloseOptions): Promise<void>;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
}

export interface CloseOptions {
  /** Wait for in-flight handlers and tasks before closing. Default: false. */
  drain?: boolean;
  /** Upper bound for the drain wait in milliseconds. Default: 5000. */
  drainTimeout?: number;
}

export interface ViaOptions<S = unknown> {
  wire: Wire;
  /**
   * Typed per-connection state/claims snapshot. When present (including an
   * explicit `undefined`) it overrides `wire.state`. Read once at construction;
   * later `wire.state` mutations are ignored by this Via.
   */
  state?: S;
  uuid?: () => string;
  log?: Log;
  timeout?: number;
  codex?: Codex;
  /** Optional frame resource limits. Omitted to preserve the historical limitless setting. */
  frameOptions?: FrameEncoderOptions;
  /** Protocol major version. Overrides `frameOptions.protocolVersion` when supplied (D6). */
  protocolVersion?: number;
  /**
   * Maximum concurrent inbound requests (non-reserved frames with a method and
   * no status). The excess is answered with `503 Busy` without running any
   * handler. Default 0 (disabled). Must be a non-negative safe integer.
   */
  maxInflightRequests?: number;
  /**
   * Maximum concurrent multiplexed streams per connection, in both directions.
   * The excess is refused with `503 Busy`. Default 0 (disabled). Must be a
   * non-negative safe integer.
   */
  maxStreamsPerConnection?: number;
  /**
   * Queue threshold in bytes for wire send backpressure. Only applies when the
   * wire reports a finite `bufferedAmount`. Default 0 (disabled). Must be a
   * non-negative safe integer.
   */
  maxBufferedBytes?: number;
  /**
   * Protocol-level heartbeat. Absent = off (no timers). When enabled, the Via
   * sends reserved `PING` frames and requires liveness within `timeout`; a miss
   * is a connection failure (reconnect when configured, else permanent close).
   */
  heartbeat?: HeartbeatOptions;
  /**
   * Opt-in client reconnect policy. When set, an unexpected connection loss
   * schedules a retry built from `wire()`; in-flight requests reject per drop
   * and are never replayed.
   */
  reconnect?: ReconnectOptions;
  /** Options forwarded to the stream layer (timeouts, highWaterMark). */
  streamOptions?: StreamOptions;
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
 * Response data type for `request<R>(..., { accept: "stream" })`.
 *
 * `R` may be a chunk type (wrapped into `ReadableStream<R>`) or an existing
 * `ReadableStream` type (passed through unchanged), so both the new-style
 * `request<number>(..., { accept: "stream" })` and every legacy
 * `request<ReadableStream<number>>(..., { accept: "stream" })` call site keep
 * their meaning.
 */
type StreamData<R> = R extends ReadableStream<any> ? R : ReadableStream<R>;

/**
 * Via - wraps a wire connection and processes inbound/outbound messages.
 * Opinionated: CBOR serialisation, credit-based stream backpressure.
 */
export class Via<S = unknown> extends Rowan<Context> implements IVia<S> {
  private _ev = new EventEmitter();
  private _active: Context[] = [];
  private _wire: Wire;
  private _uuid: () => string;
  private _log: Log;
  private _timeout: number;
  private _closed = false;
  private _closing = false;
  private _draining = false;
  private _closePromise?: Promise<void>;
  private _closedError?: Error;
  private _pendingRejectors = new Set<(error: Error) => void>();
  private _requestRejectors = new Map<string, (error: Error) => void>();
  private _interceptor = new Interceptor();
  private _before: Rowan<Context> = new Rowan<Context>();
  private _encoder: FrameEncoder;
  private _streamOptions: StreamOptions | undefined;
  /** Outgoing messages that may still carry cancellable work (e.g. request body streams). */
  private _outgoing = new Map<string, DefaultContext>();
  /** Current wire bind generation; incremented on every bind (D12). */
  private _generation = 0;
  /** Generation whose terminal path has already run (D9). */
  private _terminatedGeneration = -1;
  /** Listeners bound to the current wire, kept so a terminal wire can be unbound. */
  private _wireHandlers?: WireHandlers;
  /** Processing promise per active context, used by drain accounting (D10). */
  private _processing = new WeakMap<DefaultContext, Promise<void>>();
  /** Heartbeat tuning; undefined = off (D1). */
  private _heartbeat?: { interval: number; timeout: number };
  private _heartbeatTimer?: ReturnType<typeof setTimeout>;
  private _beatTimeout?: ReturnType<typeof setTimeout>;
  private _beatDispose?: () => void;
  private _beatId?: string;
  private _beatPending = false;
  /** Validated reconnect policy; undefined = every drop is permanent (D3). */
  private _reconnect?: ReconnectPolicy;
  private _reconnectTimer?: ReturnType<typeof setTimeout>;
  private _reconnectAttempt = 0;
  /** Generation whose transient drop path already ran (D12 dedupe). */
  private _droppedGeneration = -1;
  /** Callers waiting for the next OPEN, resolved on reconnect (D3). */
  private _readyWaiters: ReadyWaiter[] = [];
  /** Every wire claimed by this Via, released together on permanent close (D8). */
  private _claimedWires = new Set<Wire>();

  /** @internal Configured cap for concurrent inbound requests (0 = disabled). */
  _maxInflightRequests = 0;
  /** @internal Configured cap for multiplexed streams (0 = disabled). */
  _maxStreamsPerConnection = 0;
  /** @internal Configured wire buffer threshold (0 = disabled). */
  _maxBufferedBytes = 0;
  /** @internal Counted inbound requests currently in flight. */
  _inflightRequests = 0;
  /** @internal Contexts counted against `_maxInflightRequests`; released once in `_cleanup`. */
  _countedInflight = new WeakSet<DefaultContext>();
  /** @internal Number of currently registered multiplexed streams. */
  _streamCount = 0;

  readonly out: Rowan<Context> = new Rowan<Context>();

  /**
   * Per-connection state/claims snapshot, resolved once at construction (from
   * `ViaOptions.state` when present, else `wire.state`). Later `wire.state`
   * mutations and reconnect rebinds never change it. `S` is inferred from
   * `ViaOptions.state` (defaults to `unknown`).
   */
  readonly state: S;

  get wire() { return this._wire; }
  get active() { return this._active; }
  get closed() { return this._closed; }
  get log() { return this._log; }

  static Log: Log = consoleLog;

  constructor(opts: ViaOptions<S>) {
    super();
    const wire = this._wire = opts.wire;
    // `opts.state` is `S | undefined` under strictNullChecks; the presence
    // check keeps the runtime snapshot semantics and the cast asserts `S`.
    this.state = (Object.hasOwn(opts, "state") ? opts.state : wire.state) as S;
    this._log = opts.log ?? Via.Log;
    this._uuid = opts.uuid || shortId;
    this._timeout = opts.timeout ?? 120000;
    this._encoder = new FrameEncoder(opts.codex ?? undefined, {
      ...opts.frameOptions,
      protocolVersion: opts.protocolVersion ?? opts.frameOptions?.protocolVersion,
    });
    this._streamOptions = opts.streamOptions;
    // Validate limits before claiming the wire so a throwing constructor can
    // never leave a stale ownership claim behind.
    this._maxInflightRequests = validateLimitOption(opts.maxInflightRequests, "maxInflightRequests");
    this._maxStreamsPerConnection = validateLimitOption(opts.maxStreamsPerConnection, "maxStreamsPerConnection");
    this._maxBufferedBytes = validateLimitOption(opts.maxBufferedBytes, "maxBufferedBytes");
    if (opts.heartbeat !== undefined) {
      this._heartbeat = {
        interval: validatePositiveFinite(opts.heartbeat.interval, DEFAULT_HEARTBEAT_INTERVAL, "heartbeat.interval"),
        timeout: validatePositiveFinite(opts.heartbeat.timeout, DEFAULT_HEARTBEAT_TIMEOUT, "heartbeat.timeout"),
      };
    }
    if (opts.reconnect !== undefined) {
      const reconnect = opts.reconnect;
      if (typeof reconnect.wire !== "function") {
        throw new RangeError("reconnect.wire must be a function");
      }
      this._reconnect = {
        wire: reconnect.wire,
        minDelay: validateNonNegativeFinite(reconnect.minDelay, DEFAULT_RECONNECT_MIN_DELAY, "reconnect.minDelay"),
        maxDelay: validateNonNegativeFinite(reconnect.maxDelay, DEFAULT_RECONNECT_MAX_DELAY, "reconnect.maxDelay"),
        factor: validatePositiveFinite(reconnect.factor, DEFAULT_RECONNECT_FACTOR, "reconnect.factor"),
        jitter: validateUnitInterval(reconnect.jitter, DEFAULT_RECONNECT_JITTER, "reconnect.jitter"),
        maxAttempts: validateMaxAttempts(reconnect.maxAttempts, Infinity, "reconnect.maxAttempts"),
      };
    }

    this
      .use(this._before)
      .use(new After([
        this.out
          .use(new AfterIf((ctx: Context) => Promise.resolve(!!ctx.out), [
            new OutgoingStreamUpgrade(this._streamOptions, this),
            new Send(this._encoder, this)
          ]))
      ]))
      .use(new Catch((err: unknown, ctx: Context) => {
        ctx.err = err;
        this._log.error({ err }, "error during processing");
        if (ctx.out) {
          if (err instanceof ViaeError) {
            ctx.out.head.status = err.status;
            ctx.out.data = err.message;
          } else {
            ctx.out.head.status = Status.Error;
            // Never leak internal error detail to the peer; it is logged above.
            ctx.out.data = "internal error";
          }
        }
        return Promise.resolve();
      }))
      .use(new InflightLimit(this))
      .use(new IncomingStreamUpgrade(this._streamOptions, this))
      .use(this._interceptor)
      .use(async (ctx: Context, next: Next | undefined) => {
        /* Absorb stale in-flight stream protocol frames that arrive after their
           stream interceptor has been disposed.  Without this, DefaultContext
           creates a 404 ctx.out for any unrecognised METHOD frame, which After
           would then try to wire.send() — potentially after the wire has closed.
           These method names are reserved and can never be valid new requests. */
        const method = (ctx.in.head as { method?: string }).method;
        if (method === "PING") {
          // Always answered, regardless of the local heartbeat setting (D2).
          delete (ctx as Record<string, unknown>).out; // prevent a 404 response
          this._replyPong(ctx.in.id);
          return Promise.resolve();
        }
        if (method === "PONG") {
          delete (ctx as Record<string, unknown>).out;
          return Promise.resolve();
        }
        if (method === "START" || method === "PULL" || method === "CANCEL" || method === "COMPLETE") {
          delete (ctx as Record<string, unknown>).out; // prevent After from sending a 404
          return Promise.resolve();
        }
        return next?.();
      });

    Via._claimWire(wire, this);
    this._claimedWires.add(wire);
    this._bindWire(wire, this._generation);
    if (wire.readyState === WireState.OPEN) this._armHeartbeat();
  }

  /**
   * Resolve when the connection is OPEN. Waiters survive transient drops and
   * resolve after a reconnect; they reject only on permanent closure (D3).
   */
  get ready(): Promise<void> {
    if (this._closed) return Promise.reject(this._closedError ?? new Error("via closed"));
    if (this._wire.readyState === WireState.OPEN) return Promise.resolve();
    if (this._wire.readyState === WireState.CLOSED && !this._reconnect) {
      return Promise.reject(new Error("wire is closed"));
    }
    return new Promise<void>((resolve, reject) => {
      this._readyWaiters.push({ resolve, reject });
    });
  }

  /**
   * Bind wire listeners for a generation. Every handler no-ops when its
   * captured generation is no longer current, so events from a stale wire can
   * never affect a rebound one (D12).
   */
  private _bindWire(wire: Wire, generation: number): void {
    this._generation = generation;

    const onMessage = (data: ArrayBuffer | ArrayBufferView) => {
      if (generation !== this._generation) return;
      this._onMessage(data, generation);
    };
    const onOpen = () => {
      if (generation !== this._generation) return;
      this._safeEmit("open");
      this._resolveReady();
      this._armHeartbeat();
    };
    const onClose = () => {
      if (generation !== this._generation) return;
      this._terminate(undefined, generation);
    };
    const onError = (err: unknown) => {
      if (generation !== this._generation) return;
      this._terminate(err, generation);
    };

    this._wireHandlers = { wire, generation, onMessage, onOpen, onClose, onError };
    wire.on("message", onMessage);
    wire.on("open", onOpen);
    wire.on("close", onClose);
    wire.on("error", onError);
  }

  /** Remove the listeners bound for `generation` (no-op for a stale wire). */
  private _unbindWire(generation = this._generation): void {
    const handlers = this._wireHandlers;
    if (!handlers || handlers.generation !== generation) return;
    this._wireHandlers = undefined;
    handlers.wire.off("message", handlers.onMessage as (...args: unknown[]) => void);
    handlers.wire.off("open", handlers.onOpen);
    handlers.wire.off("close", handlers.onClose);
    handlers.wire.off("error", handlers.onError);
  }

  private _onMessage(data: ArrayBuffer | ArrayBufferView, generation: number) {
    // While closing without drain, inbound frames are no longer routed (D9).
    if (this._closed || (this._closing && !this._draining)) return;

    let frame: ReturnType<FrameEncoder["decode"]>;
    try {
      frame = this._encoder.decode(toUint8Array(data));
    } catch (err) {
      // Decode and protocol-version failures are permanent (D11): the frame
      // stream is unusable, so never retry.
      this._log.error({ err }, "invalid wire frame");
      this._handleTerminal(err, undefined, generation);
      try { this._wire.close(); } catch { /* wire may already be closed */ }
      return;
    }

    // Bidirectional heartbeat liveness (D1): any well-formed inbound frame that
    // arrives while a beat is pending proves the peer is alive, even when its
    // PONG is queued behind buffered data. A frame carrying the beat id is left
    // to the beat interceptor, which consumes it and settles the beat.
    if (this._beatPending && frame.id !== this._beatId) this._settleBeat();

    const msg: Message = {
      id: frame.id,
      head: (frame.head ?? {}) as MessageHeader,
      data: frame.data,
    };
    if (frame.raw !== undefined) msg.raw = frame.raw;

    const ctx = new DefaultContext({ connection: this, in: msg, log: this._log });
    ctx._activeIndex = this._active.length;
    this._active.push(ctx);

    let processing: Promise<void>;
    try {
      processing = this.process(ctx as Context);
    } catch (err) {
      // Rowan invokes synchronous user middleware in the emitter call stack;
      // contain the throw here so a bad wire listener can never crash the
      // process.
      this._log.error({ err }, "error processing message");
      this._safeEmit("error", err);
      void this._cleanup(ctx);
      return;
    }

    this._processing.set(ctx, processing);
    processing
      .then(() => ctx.complete)
      .catch(err => {
        this._log.error({ err }, "unhandled error");
        this._safeEmit("error", err);
      })
      .finally(() => this._cleanup(ctx));
  }

  /**
   * Emit an internal event without letting a throwing listener escape into
   * the wire's event emitter (which would become an uncaught exception or
   * unhandled rejection).
   */
  private _safeEmit(event: string, ...args: unknown[]): void {
    try {
      this._ev.emit(event, ...args);
    } catch (err) {
      this._log.error({ err }, `listener for "${event}" threw`);
    }
  }

  private _toError(err?: unknown): Error {
    if (err instanceof Error) return err;
    const message = (err as { message?: unknown } | undefined)?.message;
    if (typeof message === "string") return new Error(message);
    return err === undefined ? new Error("wire closed") : new Error(String(err));
  }

  /** Wire-level entry point for unexpected close/error events. */
  private _terminate(err?: unknown, generation = this._generation): void {
    this._handleDrop(err, generation);
  }

  /**
   * Unexpected connection loss. With a reconnect policy this is transient:
   * unbind the lost wire, abort in-flight work, emit `disconnect` and schedule
   * a retry. Without one — or during an intentional close — it falls through to
   * the permanent terminal path, preserving the historical behavior (D9).
   */
  private _handleDrop(reason?: unknown, generation = this._generation): void {
    if (this._closed) return;
    if (generation !== this._generation || this._terminatedGeneration === generation) return;
    if (this._droppedGeneration === generation) return;
    if (this._closing || !this._reconnect || this._closePromise) {
      this._handleTerminal(reason, undefined, generation);
      return;
    }

    this._droppedGeneration = generation;
    const lostWire = this._wireHandlers?.wire ?? this._wire;
    this._unbindWire(generation);
    this._clearHeartbeat();
    this._streamCount = 0;
    const error = this._toError(reason);
    this._rejectPending(error);
    // Per-connection interceptors (requests, streams, beats) do not survive a
    // reconnect; the next requests register fresh ones. The wire claim is kept
    // so this same Via may legitimately re-claim a rebuilt wire (D8).
    this._interceptor.dispose();
    if (reason !== undefined) this._safeEmit("error", reason);
    this._safeEmit("drop", error);
    this._safeEmit("disconnect", error);
    try { lostWire.close(); } catch { /* the wire may already be unusable */ }
    this._scheduleReconnect();
  }

  /**
   * Permanent closure. The first terminal handler for the current generation
   * records `_terminatedGeneration`, unbinds that wire synchronously and only
   * then performs cleanup, so an `error` followed by a `close` on the same
   * wire can never run the terminal path twice (D9).
   */
  private _handleTerminal(reason?: unknown, closeError?: Error, generation = this._generation): void {
    if (this._closed) return;
    if (generation !== this._generation || this._terminatedGeneration === generation) return;
    this._closed = true;
    this._terminatedGeneration = generation;
    this._clearHeartbeat();
    this._clearReconnectTimer();
    this._unbindWire(generation);
    this._streamCount = 0;
    for (const claimed of this._claimedWires) Via._releaseWire(claimed, this);
    this._claimedWires.clear();

    const error = closeError ?? this._toError(reason);
    this._closedError = error;
    this._rejectPending(error);
    this._rejectReady(error);
    this._interceptor.dispose();
    if (reason !== undefined) this._safeEmit("error", reason);
    this._safeEmit("drop", error);
    this._safeEmit("close");
  }

  private _rejectPending(error: Error): void {
    for (const reject of this._pendingRejectors) reject(error);
    this._pendingRejectors.clear();
  }

  /** Resolve every `ready` waiter (wire reached OPEN). */
  private _resolveReady(): void {
    if (this._readyWaiters.length === 0) return;
    const waiters = this._readyWaiters;
    this._readyWaiters = [];
    for (const waiter of waiters) waiter.resolve();
  }

  /** Reject every `ready` waiter (permanent closure). */
  private _rejectReady(error: Error): void {
    if (this._readyWaiters.length === 0) return;
    const waiters = this._readyWaiters;
    this._readyWaiters = [];
    for (const waiter of waiters) waiter.reject(error);
  }

  /* ── Heartbeat (D1) ───────────────────────────────────────── */

  /** Settle a pending beat and schedule the next one. */
  private _settleBeat(): void {
    if (!this._beatPending) return;
    this._clearBeat();
    this._scheduleNextBeat();
  }

  /** Clear the pending beat's timeout and interceptor without rescheduling. */
  private _clearBeat(): void {
    if (this._beatTimeout !== undefined) {
      clearTimeout(this._beatTimeout);
      this._beatTimeout = undefined;
    }
    if (this._beatDispose) {
      this._beatDispose();
      this._beatDispose = undefined;
    }
    this._beatId = undefined;
    this._beatPending = false;
  }

  /** Clear every heartbeat timer and interceptor (drop/close/reconnect). */
  private _clearHeartbeat(): void {
    if (this._heartbeatTimer !== undefined) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = undefined;
    }
    this._clearBeat();
  }

  /** Arm (or re-arm) the heartbeat loop for the current wire. */
  private _armHeartbeat(): void {
    if (!this._heartbeat || this._closed || this._closing) return;
    this._clearHeartbeat();
    this._scheduleNextBeat();
  }

  private _scheduleNextBeat(): void {
    if (!this._heartbeat || this._closed || this._closing) return;
    if (this._heartbeatTimer !== undefined) return;
    this._heartbeatTimer = setTimeout(() => {
      this._heartbeatTimer = undefined;
      this._sendBeat();
    }, this._heartbeat.interval);
  }

  private _sendBeat(): void {
    if (this._closed || this._closing || !this._heartbeat) return;
    if (this._wire.readyState !== WireState.OPEN) return;

    const id = this.createId();
    this._beatId = id;
    this._beatPending = true;
    try {
      this._beatDispose = this._interceptor.intercept({
        id,
        handlers: [(ctx: Context) => {
          // Consume the beat frame (a PONG, or a legacy peer's 404 response)
          // and settle the beat.
          this._settleBeat();
          delete (ctx as Record<string, unknown>).out;
          return Promise.resolve();
        }],
      });
    } catch (err) {
      this._log.debug({ err }, "heartbeat interceptor registration failed");
      this._clearBeat();
      this._scheduleNextBeat();
      return;
    }

    this._beatTimeout = setTimeout(() => {
      this._beatTimeout = undefined;
      this._onBeatTimeout();
    }, this._heartbeat.timeout);

    try {
      void Promise.resolve(this.send({ id, head: { method: "PING" } })).catch(err => {
        this._log.debug({ err }, "heartbeat ping failed");
      });
    } catch (err) {
      this._log.debug({ err }, "heartbeat ping failed");
    }
  }

  private _onBeatTimeout(): void {
    if (this._closed || this._closing || !this._beatPending) return;
    const error = new Error("heartbeat timeout");
    this._log.debug({ id: this._beatId }, "heartbeat timeout");
    this._clearBeat();
    if (this._reconnect && !this._closePromise) {
      this._handleDrop(error, this._generation);
      return;
    }
    this._handleTerminal(error, undefined, this._generation);
    try { this._wire.close(); } catch { /* the wire may already be unusable */ }
  }

  /** Best-effort PONG for an inbound PING via the control-send path (D2). */
  private _replyPong(id: string): void {
    try {
      void Promise.resolve(this.send({ id, head: { method: "PONG" } })).catch(() => {});
    } catch {
      // The transport is already unavailable.
    }
  }

  /* ── Reconnect (D3/D12) ───────────────────────────────────── */

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer !== undefined) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }
  }

  private _scheduleReconnect(): void {
    const policy = this._reconnect;
    if (!policy || this._closed || this._closing || this._reconnectTimer !== undefined) return;
    if (this._reconnectAttempt >= policy.maxAttempts) {
      this._handleTerminal(new Error("reconnect attempts exhausted"), undefined, this._generation);
      return;
    }
    const attempt = this._reconnectAttempt++;
    const base = Math.min(policy.maxDelay, policy.minDelay * Math.pow(policy.factor, attempt));
    const spread = base * policy.jitter;
    const wait = Math.max(0, base - spread + Math.random() * spread * 2);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = undefined;
      void this._attemptReconnect();
    }, wait);
  }

  private async _attemptReconnect(): Promise<void> {
    const policy = this._reconnect;
    if (!policy || this._closed || this._closing) return;

    let wire: Wire;
    try {
      wire = await policy.wire();
    } catch (err) {
      this._log.debug({ err }, "reconnect wire factory failed");
      this._scheduleReconnect();
      return;
    }
    if (this._closed || this._closing) {
      try { wire.close(); } catch { /* ignore */ }
      return;
    }

    try {
      Via._claimWire(wire, this);
    } catch (err) {
      this._log.debug({ err }, "reconnect wire is already owned");
      try { wire.close(); } catch { /* ignore */ }
      this._scheduleReconnect();
      return;
    }
    this._claimedWires.add(wire);

    // A previous failed attempt may still hold listeners on its wire.
    this._unbindWire();
    this._wire = wire;
    const generation = ++this._generation;
    this._bindWire(wire, generation);

    const opened = await this._waitForOpen(wire, generation);
    if (this._closed || this._closing || generation !== this._generation) return;
    if (!opened) {
      // The close/error path already scheduled the next attempt when the wire
      // failed; an already-closed wire emits no event, so cover that case too.
      if (this._droppedGeneration !== generation
        && this._terminatedGeneration !== generation
        && this._reconnectTimer === undefined) {
        this._scheduleReconnect();
      }
      return;
    }

    this._reconnectAttempt = 0;
    this._safeEmit("reconnected");
    this._armHeartbeat();
    this._resolveReady();
  }

  /** Resolve true when the wire reaches OPEN, false when it closes first. */
  private _waitForOpen(wire: Wire, generation: number): Promise<boolean> {
    if (wire.readyState === WireState.OPEN) return Promise.resolve(true);
    if (wire.readyState === WireState.CLOSED) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      const onOpen = () => {
        if (generation !== this._generation) {
          cleanup();
          resolve(false);
          return;
        }
        cleanup();
        resolve(true);
      };
      const onClose = () => {
        cleanup();
        resolve(false);
      };
      const cleanup = () => {
        wire.off("open", onOpen);
        wire.off("close", onClose);
      };
      wire.on("open", onOpen);
      wire.on("close", onClose);
    });
  }

  /**
   * Remove a context from the active list. Active order is unspecified:
   * contexts are swap-removed using their tracked index, falling back to a
   * linear lookup when the marker is stale.
   */
  private _removeActive(ctx: DefaultContext): void {
    const index = typeof ctx._activeIndex === "number" && this._active[ctx._activeIndex] === ctx
      ? ctx._activeIndex
      : this._active.indexOf(ctx);
    if (index >= 0) {
      const last = this._active.pop()!;
      if (last !== ctx) {
        this._active[index] = last;
        last._activeIndex = index;
      }
    }
    ctx._activeIndex = undefined;
  }

  private async _dispose(ctx: DefaultContext): Promise<void> {
    try {
      await ctx[Symbol.asyncDispose]();
    } catch (err) {
      this._log.error({ err }, "context disposal failed");
    }
  }

  private _cleanup(ctx: DefaultContext): Promise<void> {
    this._removeActive(ctx);
    if (this._countedInflight.delete(ctx)) {
      this._inflightRequests = Math.max(0, this._inflightRequests - 1);
    }
    this._processing.delete(ctx);
    return this._dispose(ctx);
  }

  /** Cancel any cancellable tasks (e.g. an outgoing request body stream). */
  private _cancelOutgoing(id: string, reason: unknown): void {
    const ctx = this._outgoing.get(id);
    if (!ctx) return;
    for (const task of ctx.tasks) {
      if (typeof task.cancel === "function") {
        try {
          task.cancel(reason);
        } catch (err) {
          this._log.error({ err }, "outgoing task cancellation failed");
        }
      }
    }
  }

  /**
   * Close the connection. Idempotent: the first call's promise is stored and
   * returned by every subsequent call.
   *
   * `drain: false` (default) rejects pending requests immediately and closes
   * the wire. `drain: true` lets active contexts finish (bounded by
   * `drainTimeout`) before the terminal close.
   */
  close(opts?: CloseOptions): Promise<void> {
    if (this._closePromise) return this._closePromise;
    const drain = opts?.drain ?? false;
    const drainTimeout = opts?.drainTimeout ?? DEFAULT_DRAIN_TIMEOUT;
    if (!Number.isSafeInteger(drainTimeout) || drainTimeout < 0) {
      throw new RangeError("drainTimeout must be a non-negative safe integer");
    }
    this._closing = true;
    this._closePromise = this._closeInternal(drain, drainTimeout);
    return this._closePromise;
  }

  private async _closeInternal(drain: boolean, drainTimeout: number): Promise<void> {
    if (drain) {
      this._draining = true;
      try {
        await this._whenIdle(drainTimeout);
      } finally {
        this._draining = false;
      }
    }
    await this._terminalClose();
  }

  /**
   * Resolve true when every context active at call time has finished
   * processing and all tasks it owned at that moment have completed; false
   * when `timeout` expires first. Tasks are snapshotted at drain time (D10)
   * rather than read from the cached `complete` getter.
   */
  private _whenIdle(timeout: number): Promise<boolean> {
    const waits: Promise<unknown>[] = [];
    for (const ctx of this._active) {
      const processing = this._processing.get(ctx as DefaultContext) ?? Promise.resolve();
      const tasks = ctx.tasks.map(task => task.complete);
      waits.push(Promise.all([processing, ...tasks]));
    }
    if (waits.length === 0) return Promise.resolve(true);

    return new Promise<boolean>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (idle: boolean) => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        resolve(idle);
      };
      Promise.all(waits).then(() => settle(true), () => settle(true));
      timer = setTimeout(() => settle(false), timeout);
    });
  }

  /**
   * Terminal close: emit the internal abort path (`drop`) plus public `close`,
   * dispose active contexts and the interceptor, then close the wire. An
   * intentional close never emits the public `disconnect` event (D9).
   */
  private async _terminalClose(): Promise<void> {
    this._handleTerminal(undefined, new Error("via closed"));
    const contexts = [...this._active];
    await Promise.allSettled(contexts.map(ctx => this._dispose(ctx as DefaultContext)));
    try {
      this._wire.close();
    } catch (err) {
      this._log.debug({ err }, "wire close failed");
    }
  }

  send(msg: Partial<Message>, opts?: SendOptions): Promise<void> {
    if (!msg.id) msg.id = shortId();
    if (!msg.head) msg.head = {};

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
    this._outgoing.set(msg.id!, ctx);
    const sent = this.out.process(ctx);
    /* Task completion (e.g. stream pump) and disposal run in the background so
       that send() resolves as soon as the message is on the wire.  This avoids
       deadlocking when the caller still needs to consume a response stream
       before the outgoing pump can finish (e.g. request-level echo). */
    sent
      .then(() => ctx.complete)
      .catch((err) => {
        this._safeEmit("error", err);
      })
      .finally(() => {
        if (this._outgoing.get(msg.id!) === ctx) this._outgoing.delete(msg.id!);
        return this._dispose(ctx);
      });
    return sent;
  }

  /**
   * Send a request and resolve its response.
   *
   * Typing is driven by `accept` when it is statically known:
   * - `{ accept: "stream" }` types `data` as `StreamData<R>` — `R` may be the
   *   chunk type (new style: `request<number>` → `ReadableStream<number>`) or
   *   an existing stream type (legacy: `request<ReadableStream<number>>`).
   * - `{ accept: "object" }` (or omitted) types `data` as `R`.
   * - A plain `RequestOptions` variable falls through to the permissive
   *   overload and types `data` as `R`.
   *
   * Omitting `accept` is permissive at runtime (either shape is accepted), so
   * `data` is typed as `R`; the specific overloads are precise only when
   * `accept` is statically known. No runtime behavior changes.
   */
  request<R>(
    method: string,
    path: string,
    data: unknown,
    opts: RequestOptions & { accept: "stream" },
  ): Promise<RequestResponse<StreamData<R>>>;
  request<R>(
    method: string,
    path: string,
    data?: unknown,
    opts?: RequestOptions & { accept?: "object" },
  ): Promise<RequestResponse<R>>;
  request<R>(
    method: string,
    path: string,
    data?: unknown,
    opts?: RequestOptions,
  ): Promise<RequestResponse<R>>;
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
    const rejectOnClose = (error: Error) => reject(error);
    this._pendingRejectors.add(rejectOnClose);
    this._requestRejectors.set(msg.id!, rejectOnClose);

    const dispose = this._interceptor.intercept({
      id: msg.id!,
      handlers: [(ctx: Context, next?: Next) => {
        const status = ctx.in.head.status as Status;

        if (status === Status.Partial) {
          return (next || (() => Promise.resolve()))();
        }

        const responseData = ctx.in.data;
        if (opts?.accept === "stream" && !isReadableStream(responseData)) {
          reject(new Error("expected stream response but received object"));
          return (next || (() => Promise.resolve()))();
        }
        if (opts?.accept === "object" && isReadableStream(responseData)) {
          responseData.cancel(new Error("expected object response but received stream")).catch(() => {});
          reject(new Error("expected object response but received stream"));
          return (next || (() => Promise.resolve()))();
        }

        resolve(
          Object.assign(
            {
              ok: status >= 200 && status < 300,
              async [Symbol.asyncDispose]() {
                const stream = (ctx as DefaultContext).in.data;
                if (isReadableStream(stream)) {
                  await stream.cancel(new Error("response disposed")).catch(() => {});
                }
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

    const clock = setTimeout(() => reject(new Error("request timeout")), opts?.timeout ?? this._timeout);

    try {
      try {
        await this.send(msg, opts);
        return await promise;
      } catch (error) {
        this._cancelOutgoing(msg.id!, error);
        // The terminal path may also have rejected the pending promise; observe
        // it so it can never surface as an unhandled rejection, and prefer the
        // close error when the connection ended while the request was pending.
        promise.catch(() => {});
        throw this._closedError ?? error;
      }
    } finally {
      this._pendingRejectors.delete(rejectOnClose);
      if (this._requestRejectors.get(msg.id!) === rejectOnClose) this._requestRejectors.delete(msg.id!);
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
        // Register first: a duplicate-sid throw must not consume a stream slot.
        const dispose = this._interceptor.interceptFn(id, handler);
        this._streamCount++;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this._streamCount = Math.max(0, this._streamCount - 1);
          dispose();
        };
      },
      createId: () => this.createId(),
      get closed() { return wire.readyState !== WireState.OPEN; },
      onClose: (cb: () => void) => {
        // Streams abort on any connection loss, including transient drops (D9).
        this._ev.on("drop", cb);
        return () => this._ev.off("drop", cb);
      },
    };
  }

  /** @internal True when the connection is at its maxStreamsPerConnection cap. */
  _streamCapReached(): boolean {
    return this._maxStreamsPerConnection > 0 && this._streamCount >= this._maxStreamsPerConnection;
  }

  /** @internal Reject a pending request by id (client-side stream cap, D5). */
  _rejectRequest(id: string, error: Error): void {
    const reject = this._requestRejectors.get(id);
    if (reject) reject(error);
  }

  /** @internal Best-effort CANCEL for an announced stream id we will not consume. */
  _sendCancel(sid: string, reason: string): void {
    try {
      void Promise.resolve(this.send({ id: sid, head: { method: "CANCEL" }, data: reason })).catch(() => {});
    } catch {
      // The transport is already unavailable.
    }
  }

  private static _claimWire(wire: Wire, owner: Via): void {
    const holder = wire as unknown as Record<symbol, Via | undefined>;
    const current = holder[WIRE_OWNER];
    if (current !== undefined && current !== owner) {
      throw new Error("wire is already bound to another Via");
    }
    holder[WIRE_OWNER] = owner;
  }

  private static _releaseWire(wire: Wire, owner: Via): void {
    const holder = wire as unknown as Record<symbol, Via | undefined>;
    if (holder[WIRE_OWNER] === owner) delete holder[WIRE_OWNER];
  }

  on(event: "close", cb: () => void): void;
  on(event: "open", cb: () => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  on(event: "disconnect", cb: (err: unknown) => void): void;
  on(event: "reconnected", cb: () => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  on(event: string, cb: (...args: unknown[]) => void) {
    this._ev.on(event, cb);
  }

  off(event: "close", cb: () => void): void;
  off(event: "open", cb: () => void): void;
  off(event: "error", cb: (err: unknown) => void): void;
  off(event: "disconnect", cb: (err: unknown) => void): void;
  off(event: "reconnected", cb: () => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void) {
    this._ev.off(event, cb);
  }
}

/* ── Middleware ─────────────────────────────────────────────── */

/** Serialise and send the outgoing message over the wire */
class Send implements Middleware<Context> {
  constructor(private _encoder: FrameEncoder, private _via: Via) {}

  process(ctx: Context, next: Next): Promise<void> {
    const out = ctx.out;
    if (out) {
      const frame = {
        id: out.id,
        head: out.head as Record<string, unknown>,
        data: out.data,
      };
      // Every outbound frame uses an owned buffer (D14) so asynchronous wire
      // boundaries never require a second copy of a pooled encode.
      const bytes = this._encoder.encodeOwned(frame);
      try {
        ctx.connection.wire.send(bytes);
      } catch (err) {
        return Promise.reject(err);
      }

      const max = this._via._maxBufferedBytes;
      // Control frames (PING/PONG) bypass the drain: they are tiny and a
      // saturated socket must not be able to evict a live connection (D1/D4).
      const method = out.head?.method;
      const control = method === "PING" || method === "PONG";
      if (!control && max > 0) {
        const buffered = ctx.connection.wire.bufferedAmount;
        if (typeof buffered === "number" && Number.isFinite(buffered) && buffered > max) {
          // Backpressure is opt-in and only when the wire reports a finite
          // buffer; control frames bypass this path (L5).
          return this._drain(ctx.connection.wire, max).then(() => next());
        }
      }
    }
    return next();
  }

  /** Poll until the wire queue drains below `max`, failing if it leaves OPEN. */
  private async _drain(wire: Wire, max: number): Promise<void> {
    for (;;) {
      if (wire.readyState !== WireState.OPEN) throw new Error("wire is not open");
      const buffered = wire.bufferedAmount;
      if (typeof buffered !== "number" || !Number.isFinite(buffered) || buffered <= max) return;
      await delay(BACKPRESSURE_POLL_MS);
    }
  }
}

/**
 * Caps concurrent non-reserved inbound requests (D5). Placed after `Catch`
 * and before `IncomingStreamUpgrade`, so the 503 still flows through
 * `After`'s out processing, no stream is created for a rejected frame, and
 * neither user nor Viae middleware runs for it.
 */
class InflightLimit implements Middleware<Context> {
  constructor(private _via: Via) {}

  process(ctx: Context, next: Next): Promise<void> {
    const via = this._via;
    const cap = via._maxInflightRequests;
    if (cap <= 0) return next();

    const head = ctx.in.head;
    if (head.method === undefined || head.status !== undefined) return next();
    if (RESERVED_METHODS.has(head.method)) return next();

    if (via._inflightRequests >= cap) {
      via.log.debug({ id: ctx.in.id, cap }, "maxInflightRequests reached; rejecting request");
      if (ctx.out) {
        ctx.out.head.status = Status.Busy;
        ctx.out.data = "busy";
      }
      return Promise.resolve();
    }

    via._inflightRequests++;
    via._countedInflight.add(ctx as DefaultContext);
    return next();
  }
}

/** 
 * If outgoing data is a ReadableStream, set up multiplexed stream sender 
 * with credit-based backpressure. Replaces the data with a stream id header.
 */
class OutgoingStreamUpgrade implements Middleware<Context> {
  constructor(private _opts: StreamOptions | undefined, private _via: Via) {}
  process(ctx: Context, next: Next): Promise<void> {
    if (!ctx.out || !isReadableStream(ctx.out.data)) return next();

    if (this._via._streamCapReached()) {
      // Enforced here rather than via a throw: `Catch` sits upstream of
      // `After`'s out processing, so a rejection would not produce a 503.
      if (ctx.out.head.status !== undefined) {
        const readable = ctx.out.data as ReadableStream;
        try {
          void Promise.resolve(readable.cancel(new Error("too many streams"))).catch(() => {});
        } catch { /* the source may already be locked or cancelled */ }
        this._via.log.debug({ id: ctx.out.id }, "maxStreamsPerConnection reached; refusing response stream");
        ctx.out.data = "busy";
        ctx.out.head.status = Status.Busy;
        return next();
      }
      return Promise.reject(new ViaeError(Status.Busy, "too many streams"));
    }

    const readable = ctx.out.data as ReadableStream;
    const transport = this._via._asTransport();
    const streamEncoding = ctx.out.head.encoding as string | undefined
      ?? ctx.in.head.encoding as string | undefined
      ?? this._opts?.encoding;

    const sender = createOutgoingStream(readable, transport, (value: unknown) => {
      return streamEncoding === undefined ? { data: value } : {
        data: value,
        head: { encoding: streamEncoding },
      };
    }, this._opts);

    ctx.out.head.sid = sender.sid;
    delete ctx.out.data;

    ctx.tasks.push({
      name: "OutgoingStream",
      complete: sender.complete,
      cancel: (reason?: unknown) => sender.cancel?.(reason),
    });

    return next();
  }
}

/** 
 * If incoming message has a stream id (sid), create a ReadableStream
 * with credit-based backpressure that pulls from the multiplexed stream.
 */
class IncomingStreamUpgrade implements Middleware<Context> {
  constructor(private _opts: StreamOptions | undefined, private _via: Via) {}
  process(ctx: Context, next: Next): Promise<void> {
    const sid = ctx.in.head.sid as string | undefined;
    if (!sid) return next();

    if (this._via._streamCapReached()) {
      if (ctx.out) {
        // Inbound request whose body is a stream: refuse it, then tell the
        // remote producer to stop instead of waiting for START (D5).
        this._via.log.debug({ sid }, "maxStreamsPerConnection reached; refusing inbound request stream");
        ctx.out.head.status = Status.Busy;
        ctx.out.data = "busy";
        this._via._sendCancel(sid, "too many streams");
        return Promise.resolve();
      }
      // Client receiving a response stream: fail the pending request now
      // instead of leaving it to the request timeout, and cancel the
      // announced stream id.
      this._via.log.debug({ sid }, "maxStreamsPerConnection reached; refusing inbound response stream");
      this._via._rejectRequest(ctx.in.id, new ViaeError(Status.Busy, "too many streams"));
      this._via._sendCancel(sid, "too many streams");
      return Promise.resolve();
    }

    const transport = this._via._asTransport();
    try {
      ctx.in.data = createIncomingStream(sid, transport, this._opts);
    } catch (err) {
      // A duplicate sid must never overwrite an existing interceptor (e.g. a
      // pending request). Drop the frame and prevent a 404 response.
      ctx.log.warn({ err, sid }, "dropping frame for duplicate stream id");
      delete (ctx as Record<string, unknown>).out;
      return Promise.resolve();
    }
    if (ctx.isReq() && this._opts?.cancelIncomingOnDispose) {
      const stream = ctx.in.data;
      ctx.onDispose(() => stream.cancel(new Error("request context disposed")).catch(() => {}));
    }

    return next();
  }
}
