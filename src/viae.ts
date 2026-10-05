import { Rowan, type Processor } from "rowan";
import { EventEmitter } from "eventemitter3";
import type { Wire, WireServer } from "./wire.js";
import type { Context } from "./context.js";
import { Via } from "./via.js";
import type { Log } from "./log.js";
import { consoleLog } from "./log.js";
import type { StreamOptions } from "./stream.js";
import type { Codex, FrameEncoderOptions } from "./codec.js";

/** Default upper bound for the per-connection drain wait in `Viae.close` (D10). */
const DEFAULT_DRAIN_TIMEOUT = 5000;

/**
 * Heartbeat policy forwarded to every connection (D13). Same shape as
 * `ViaOptions.heartbeat`; validation is left to `Via`.
 */
export interface ViaeHeartbeatOptions {
  /** Interval between heartbeats in milliseconds. */
  interval?: number;
  /** Reply deadline after each heartbeat in milliseconds. */
  timeout?: number;
}

/** Options for `Viae.close` (D3/D10). */
export interface ViaeCloseOptions {
  /** Upper bound for each connection's drain wait in milliseconds. Default: 5000. */
  drainTimeout?: number;
}

/** Options applied to the Via connections created by a Viae server. */
export interface ViaeOptions {
  log?: Log;
  middleware?: Processor<Context>[];
  /** Default timeout in milliseconds for requests on each created Via. */
  timeout?: number;
  streamOptions?: StreamOptions;
  frameOptions?: FrameEncoderOptions;
  codex?: Codex;
  /** Heartbeat policy forwarded to each connection (D13). */
  heartbeat?: ViaeHeartbeatOptions;
  /**
   * Maximum concurrent connections. `0` (default) is unlimited; excess
   * connections are closed immediately without creating a `Via` or emitting
   * `connection`. Must be a non-negative safe integer, else `RangeError`.
   */
  maxConnections?: number;
  /** Forwarded to each connection: maximum concurrent inbound requests (D13). */
  maxInflightRequests?: number;
  /** Forwarded to each connection: maximum concurrent multiplexed streams (D13). */
  maxStreamsPerConnection?: number;
  /** Forwarded to each connection: wire send backpressure threshold in bytes (D13). */
  maxBufferedBytes?: number;
  /** Forwarded to each connection: protocol major version (D13). */
  protocolVersion?: number;
}

/**
 * Viae - server that accepts wire connections and creates Via instances.
 * All registered middleware/routers apply to every inbound connection.
 */
export class Viae extends Rowan<Context> {
  private _connections: Via[] = [];
  private _ev = new EventEmitter();
  private _before: Rowan<Context> = new Rowan<Context>();
  private _maxConnections = 0;
  private _closed = false;
  private _closePromise?: Promise<void>;
  private _log: Log;

  static Log: Log = consoleLog;

  get connections(): Via[] {
    return [...this._connections];
  }

  /** True once `close()` has been called; new connections are refused (D10). */
  get closed(): boolean {
    return this._closed;
  }

  constructor(
    server: WireServer,
    opts?: ViaeOptions,
  ) {
    super(opts?.middleware);

    const maxConnections = opts?.maxConnections ?? 0;
    if (!Number.isSafeInteger(maxConnections) || maxConnections < 0) {
      throw new RangeError("maxConnections must be a non-negative safe integer");
    }
    this._maxConnections = maxConnections;
    this._log = opts?.log || Viae.Log;

    server.on("connection", (wire: Wire) => {
      const log = this._log;

      if (this._closed) {
        log.info(wire.url + " refused: server closed");
        this._closeRefused(wire, log, "server closed");
        return;
      }

      if (this._maxConnections > 0 && this._connections.length >= this._maxConnections) {
        log.warn(wire.url + ` refused: maxConnections (${this._maxConnections}) reached`);
        this._closeRefused(wire, log, "maxConnections reached");
        return;
      }

      const via = new Via({
        wire,
        log,
        timeout: opts?.timeout,
        streamOptions: opts?.streamOptions,
        frameOptions: opts?.frameOptions,
        codex: opts?.codex,
        maxInflightRequests: opts?.maxInflightRequests,
        maxStreamsPerConnection: opts?.maxStreamsPerConnection,
        maxBufferedBytes: opts?.maxBufferedBytes,
        protocolVersion: opts?.protocolVersion,
        // Forwarded via spread so this file stays compilable whether or not
        // the concurrent L5 workstream has landed `heartbeat` on `ViaOptions`
        // yet; spread properties skip excess-property checking.
        ...(opts?.heartbeat !== undefined ? { heartbeat: opts.heartbeat } : {}),
      });
      via.before(this._before);
      via.use(this);

      wire.on("close", () => {
        const idx = this._connections.indexOf(via);
        if (idx >= 0) this._connections.splice(idx, 1);
        log.info(wire.url + " disconnected");
      });

      via.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(wire.url + " error: " + msg);
      });

      this._connections.push(via);
      this._ev.emit("connection", via);
      log.info(wire.url + " connected");
    });
  }

  on(event: "connection", cb: (connection: Via) => void) {
    this._ev.on(event, cb);
  }

  before(processor: Processor<Context>): this {
    this._before.use(processor);
    return this;
  }

  /**
   * Close the server (D3/D10). Marks the server closed, refuses any connection
   * arriving from now on (closed immediately, no `Via`, no `connection` event),
   * then drain-closes every connection current at call time via
   * `via.close({ drain: true, drainTimeout })` and resolves once they have all
   * settled (`Promise.allSettled`). Idempotent: the first call's promise is
   * stored and returned by every subsequent call.
   *
   * Viae does not own the underlying `WireServer`/http server socket: callers
   * must close it themselves. Draining only ends the accepted connections.
   */
  close(opts?: ViaeCloseOptions): Promise<void> {
    if (this._closePromise) return this._closePromise;
    const drainTimeout = opts?.drainTimeout ?? DEFAULT_DRAIN_TIMEOUT;
    if (!Number.isSafeInteger(drainTimeout) || drainTimeout < 0) {
      throw new RangeError("drainTimeout must be a non-negative safe integer");
    }
    this._closed = true;
    const connections = [...this._connections];
    this._closePromise = Promise.allSettled(
      connections.map(via => via.close({ drain: true, drainTimeout })),
    ).then(results => {
      for (const result of results) {
        if (result.status === "rejected") {
          const err = result.reason;
          const msg = err instanceof Error ? err.message : String(err);
          this._log.error("connection close failed: " + msg);
        }
      }
    });
    return this._closePromise;
  }

  /** Best-effort immediate close for a connection Viae refuses to adopt. */
  private _closeRefused(wire: Wire, log: Log, reason: string): void {
    try {
      wire.close();
    } catch (err) {
      log.debug({ err }, `failed to close refused connection (${reason})`);
    }
  }
}
