/**
 * Binary stream fast-path benchmark.
 *
 * Measures the two CPU-heavy parts of a stream transfer independently:
 * frame encoding and the in-memory StreamTransport pump. It reports elapsed
 * time, chunks per second, and MiB/s so changes can be compared without a
 * network or WebSocket implementation affecting the result.
 *
 * Run with:
 *   npm run bench:stream
 */

import { FrameEncoder } from "../src/codec.js";
import { createOutgoingStream, type StreamTransport } from "../src/stream.js";
import type { Message } from "../src/message.js";

const KB = 1024;
const MB = 1024 * KB;
const WARMUP = 2_000;
const ITERATIONS = 20_000;

function formatRate(rate: number): string {
  if (rate >= 1_000_000) return `${(rate / 1_000_000).toFixed(2)}M`;
  if (rate >= 1_000) return `${(rate / 1_000).toFixed(1)}k`;
  return rate.toFixed(0);
}

function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MiB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function makeChunk(size: number, seed: number): Uint8Array {
  const chunk = new Uint8Array(size);
  chunk.fill(seed & 0xff);
  return chunk;
}

function benchmarkEncoding(chunkSize: number): { ns: number; bytes: number } {
  const encoder = new FrameEncoder();
  const chunk = makeChunk(chunkSize, 17);
  const frame = {
    id: "stream-id",
    head: { status: 206, encoding: "binary" },
    data: chunk,
  };

  for (let i = 0; i < WARMUP; i++) encoder.encodeOwned(frame);
  const start = process.hrtime.bigint();
  let bytes = 0;
  for (let i = 0; i < ITERATIONS; i++) bytes += encoder.encodeOwned(frame).byteLength;
  const elapsed = Number(process.hrtime.bigint() - start);
  return { ns: elapsed / ITERATIONS, bytes: bytes / ITERATIONS };
}

class BenchmarkTransport implements StreamTransport {
  closed = false;
  private _handler?: (msg: Message) => void | Promise<void>;
  private _nextId = 0;
  private _partials = 0;
  private _bytes = 0;
  private _encoder = new FrameEncoder();
  private _window = 32;
  private _remaining = 0;

  intercept(_id: string, handler: (msg: Message) => void | Promise<void>): () => void {
    this._handler = handler;
    return () => { this._handler = undefined; };
  }

  createId(): string {
    return `bench-${++this._nextId}`;
  }

  async send(msg: Partial<Message>): Promise<void> {
    if (msg.head?.status === 206) {
      const wire = this._encoder.encodeOwned({
        id: msg.id!,
        head: msg.head as Record<string, unknown>,
        data: msg.data,
      });
      this._encoder.decode(wire);
      this._partials++;
      if (msg.data instanceof Uint8Array) this._bytes += msg.data.byteLength;
      this._remaining--;
      if (this._remaining === 0) {
        this._remaining = this._window;
        await this._handler?.({
          id: msg.id!,
          head: { method: "PULL", desiredSize: this._window },
        });
      }
    } else if (msg.head?.status === 200) {
      this._encoder.encodeOwned({ id: msg.id!, head: msg.head as Record<string, unknown> });
    }
  }

  async start(window: number): Promise<void> {
    this._window = Math.max(1, Math.floor(window));
    this._remaining = this._window;
    await this._handler?.({
      id: "bench",
      head: { method: "START", desiredSize: this._window },
    });
  }

  get partials(): number { return this._partials; }
  get bytes(): number { return this._bytes; }
}

async function benchmarkPump(chunkSize: number, chunks: number): Promise<{ ns: number; bytes: number }> {
  const transport = new BenchmarkTransport();
  let index = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks) {
        controller.close();
      } else {
        controller.enqueue(makeChunk(chunkSize, index++));
      }
    },
  });

  const sender = createOutgoingStream(
    readable,
    transport,
    value => ({ data: value, head: { encoding: "binary" } }),
    { startTimeout: 0 },
  );
  const start = process.hrtime.bigint();
  // One extra credit is needed for the final reader.read() that observes
  // done=true after all chunks have been sent.
  await transport.start(32);
  await sender.complete;
  const elapsed = Number(process.hrtime.bigint() - start);
  return { ns: elapsed / chunks, bytes: transport.bytes };
}

console.log(`\nBinary stream benchmark | Node ${process.version}`);
console.log(`${ITERATIONS.toLocaleString()} encoding iterations`);
console.log("\nFrame encoding (owned binary frame)");
console.log("Chunk          ns/chunk       chunks/s       throughput");

for (const chunkSize of [1 * KB, 16 * KB, 256 * KB, 1 * MB]) {
  const result = benchmarkEncoding(chunkSize);
  const chunksPerSecond = 1e9 / result.ns;
  console.log(
    `${formatBytes(chunkSize).padEnd(14)}${result.ns.toFixed(0).padStart(12)}`
    + `${formatRate(chunksPerSecond).padStart(16)}`
    + `${formatBytes(chunksPerSecond * chunkSize).padStart(16)}/s`,
  );
}

console.log("\nStream pump (in-memory transport, 2,000 chunks)");
console.log("Chunk          ns/chunk       chunks/s       throughput");

for (const chunkSize of [1 * KB, 16 * KB, 256 * KB, 1 * MB]) {
  const result = await benchmarkPump(chunkSize, 2_000);
  const chunksPerSecond = 1e9 / result.ns;
  console.log(
    `${formatBytes(chunkSize).padEnd(14)}${result.ns.toFixed(0).padStart(12)}`
    + `${formatRate(chunksPerSecond).padStart(16)}`
    + `${formatBytes(chunksPerSecond * chunkSize).padStart(16)}/s`,
  );
}
