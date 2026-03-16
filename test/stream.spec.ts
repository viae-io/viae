import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Viae, Api } from "../src/index.js";
import { TestWireServer, createTestClient } from "./utils.js";

describe("Stream", () => {
  let server: TestWireServer;
  let port: number;

  beforeEach(async () => {
    server = new TestWireServer();
    const addr = await server.listen(0, "localhost");
    port = addr.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it("should stream data with backpressure (ReadableStream response)", async () => {
    const viae = new Viae(server);
    const api = new Api("/");
    const chunks = [1, 2, 3, 4, 5];

    api.get({
      path: "/numbers",
      accept: "stream",      
      handler: () => new ReadableStream<number>({
        start(controller) {
          for (const n of chunks) controller.enqueue(n);
          controller.close();
        }
      })
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/numbers", undefined, { accept: "stream" });
      assert.equal(result.ok, true);

      const received: number[] = [];
      const reader = (result.data as ReadableStream<number>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(value as number);
      }

      assert.deepEqual(received, chunks);
    } finally {
      wire.close();
    }
  });

  it("should handle stream cancellation from consumer", async () => {
    const viae = new Viae(server);
    const api = new Api("/");
    let producerCancelled = false;

    api.get({
      path: "/infinite",
      handler: () => {
        let i = 0;
        return new ReadableStream<number>({
          pull(controller) { controller.enqueue(i++); },
          cancel() { producerCancelled = true; }
        });
      }
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/infinite", undefined, { accept: "stream" });
      const reader = (result.data as ReadableStream<number>).getReader();

      await reader.read();
      await reader.read();
      await reader.cancel();

      await new Promise(r => setTimeout(r, 100));
      assert.equal(producerCancelled, true);
    } finally {
      wire.close();
    }
  });

  it("should propagate a producer error to the consumer", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/error-stream",
      // Error is thrown immediately — enqueued chunks are dropped once errored
      handler: () => new ReadableStream<number>({
        start(controller) {
          controller.error(new Error("producer exploded"));
        }
      })
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/error-stream", undefined, { accept: "stream" });
      assert.equal(result.ok, true);

      const reader = (result.data as ReadableStream<number>).getReader();

      // The error is transmitted as a string over the wire; use a function validator
      await assert.rejects(
        () => reader.read(),
        (err: unknown) => {
          assert.ok(String(err).includes("producer exploded"), `unexpected error: ${String(err)}`);
          return true;
        },
      );
    } finally {
      wire.close();
    }
  });

  it("should handle a large stream beyond initial credit window", async () => {
    const viae = new Viae(server);
    const api = new Api("/");
    const TOTAL = 100; // well beyond the default credit (32)

    api.get({
      path: "/large",
      handler: () => {
        let i = 0;
        return new ReadableStream<number>({
          pull(controller) {
            if (i < TOTAL) controller.enqueue(i++);
            else controller.close();
          }
        });
      }
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/large", undefined, { accept: "stream" });
      assert.equal(result.ok, true);

      const received: number[] = [];
      const reader = (result.data as ReadableStream<number>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(value as number);
      }

      assert.equal(received.length, TOTAL);
      assert.deepEqual(received, Array.from({ length: TOTAL }, (_, i) => i));
    } finally {
      wire.close();
    }
  });

  it("should deliver a single-chunk stream", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/single",
      handler: () => new ReadableStream<string>({
        start(controller) {
          controller.enqueue("only");
          controller.close();
        }
      })
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<string>>("GET", "/single", undefined, { accept: "stream" });
      assert.equal(result.ok, true);

      const reader = (result.data as ReadableStream<string>).getReader();
      const first = await reader.read();
      const second = await reader.read();

      assert.equal(first.done, false);
      assert.equal(first.value, "only");
      assert.equal(second.done, true);
    } finally {
      wire.close();
    }
  });

  it("should handle concurrent streams on the same connection", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/seq/:id",
      handler: ({ params }) => {
        const base = parseInt(params.id, 10);
        return new ReadableStream<number>({
          start(controller) {
            for (let i = 0; i < 5; i++) controller.enqueue(base + i);
            controller.close();
          }
        });
      }
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    async function drainStream(stream: ReadableStream<number>): Promise<number[]> {
      const reader = stream.getReader();
      const out: number[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value);
      }
      return out;
    }

    try {
      const [r1, r2, r3] = await Promise.all([
        via.request<ReadableStream<number>>("GET", "/seq/0", undefined, { accept: "stream" }),
        via.request<ReadableStream<number>>("GET", "/seq/10", undefined, { accept: "stream" }),
        via.request<ReadableStream<number>>("GET", "/seq/20", undefined, { accept: "stream" }),
      ]);

      const [a, b, c] = await Promise.all([
        drainStream(r1.data as ReadableStream<number>),
        drainStream(r2.data as ReadableStream<number>),
        drainStream(r3.data as ReadableStream<number>),
      ]);

      assert.deepEqual(a, [0, 1, 2, 3, 4]);
      assert.deepEqual(b, [10, 11, 12, 13, 14]);
      assert.deepEqual(c, [20, 21, 22, 23, 24]);
    } finally {
      wire.close();
    }
  });

  it("should propagate a mid-stream producer cancellation to the consumer", async () => {
    const viae = new Viae(server);
    const api = new Api("/");
    let pullCount = 0;

    api.get({
      path: "/mid-cancel",
      handler: () => new ReadableStream<number>({
        pull(controller) {
          pullCount++;
          if (pullCount <= 3) {
            controller.enqueue(pullCount);
          } else {
            controller.error(new Error("producer cancelled mid-stream"));
          }
        }
      })
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/mid-cancel", undefined, { accept: "stream" });
      assert.equal(result.ok, true);

      const reader = (result.data as ReadableStream<number>).getReader();

      // Drain stream until error — chunks may or may not arrive before the error
      // depending on RS buffer scheduling, but the error must propagate
      let errorReceived: unknown;
      for (;;) {
        try {
          const { done } = await reader.read();
          if (done) {
            assert.fail("expected stream to error, not close cleanly");
          }
        } catch (err) {
          errorReceived = err;
          break;
        }
      }

      assert.ok(
        String(errorReceived).includes("producer cancelled mid-stream"),
        `unexpected error: ${String(errorReceived)}`
      );
    } finally {
      wire.close();
    }
  });

  it("should propagate cancel reason from consumer to producer", async () => {
    const viae = new Viae(server);
    const api = new Api("/");
    let cancelReason: unknown;

    api.get({
      path: "/cancel-reason",
      handler: () => {
        let i = 0;
        return new ReadableStream<number>({
          pull(controller) { controller.enqueue(i++); },
          cancel(reason) { cancelReason = reason; }
        });
      }
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/cancel-reason", undefined, { accept: "stream" });
      const reader = (result.data as ReadableStream<number>).getReader();

      // Read at least one chunk so the stream is established, then cancel with a reason
      await reader.read();
      await reader.cancel(new Error("consumer gave up"));

      await new Promise(r => setTimeout(r, 100));

      assert.ok(cancelReason !== undefined, "producer cancel() should have been called");
      // Reason is serialised as a string across the wire
      assert.ok(
        String(cancelReason).includes("consumer gave up"),
        `unexpected cancel reason: ${String(cancelReason)}`
      );
    } finally {
      wire.close();
    }
  });

  it("should propagate consumer WritableStream error to producer as cancel", async () => {
    const viae = new Viae(server);
    const api = new Api("/");
    let cancelReason: unknown;

    api.get({
      path: "/to-writable",
      handler: () => {
        let i = 0;
        return new ReadableStream<number>({
          pull(controller) { controller.enqueue(i++); },
          cancel(reason) { cancelReason = reason; }
        });
      }
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<ReadableStream<number>>("GET", "/to-writable", undefined, { accept: "stream" });
      assert.equal(result.ok, true);

      const readable = result.data as ReadableStream<number>;
      let writeCount = 0;
      const writable = new WritableStream<number>({
        write() {
          writeCount++;
          if (writeCount >= 2) throw new Error("sink exploded");
        }
      });

      // pipeTo propagates the WritableStream error back to the ReadableStream as a cancel
      await assert.rejects(
        () => readable.pipeTo(writable),
        (err: unknown) => {
          assert.ok(String(err).includes("sink exploded"), `unexpected: ${String(err)}`);
          return true;
        }
      );

      // Give the CANCEL frame time to reach the server
      await new Promise(r => setTimeout(r, 100));

      assert.ok(cancelReason !== undefined, "producer cancel() should have been called");
      // Reason arrives as a serialised string
      assert.ok(
        String(cancelReason).includes("sink exploded"),
        `unexpected cancel reason: ${String(cancelReason)}`
      );
    } finally {
      wire.close();
    }
  });

  it("should handle 10000 repeated requests with a 1KB payload", async () => {
    const viae = new Viae(server);
    const api = new Api("/");
    const ITERATIONS = 10_000;
    const PAYLOAD_SIZE = 1024;

    api.post({
      path: "/echo",
      handler: ({ data }) => data
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const payload = crypto.getRandomValues(new Uint8Array(PAYLOAD_SIZE));
        const result = await via.request<Uint8Array>("POST", "/echo", payload);
        assert.equal(result.ok, true);
        assert.deepEqual(result.data, payload);
      }
    } finally {
      wire.close();
    }
  });

  it("should send a 0-element stream from client — server drains it and responds", async () => {
    // Client sends an empty ReadableStream as the request body.
    // Server must drain it (receiving done=true immediately) and complete normally.
    const viae = new Viae(server);
    const api = new Api("/");
    let handlerCalled = false;

    api.post({
      path: "/empty-upload",
      accept: "stream",
      handler: async ({ data }) => {
        handlerCalled = true;
        const chunks: unknown[] = [];
        const reader = (data as ReadableStream).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        return chunks; // returns [] — a plain (non-stream) response
      }
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const empty = new ReadableStream({ start(controller) { controller.close(); } });
      const result = await via.request<unknown[]>("POST", "/empty-upload", empty);
      assert.equal(result.ok, true);
      assert.equal(handlerCalled, true, "handler must have been called");
      assert.deepEqual(result.data, [], "server must have seen zero chunks");
    } finally {
      wire.close();
    }
  });

  it("should echo an empty stream end-to-end without hanging", async () => {
    // Most thorough empty-stream test: client sends an empty ReadableStream AND
    // receives one back (echo).  Verifies both sides can send and receive a
    // 0-element stream and that all protocol state is cleaned up cleanly.
    const viae = new Viae(server);
    const api = new Api("/");

    api.post({
      path: "/echo-empty",
      accept: "stream",
      // Return the incoming stream directly — server sends back whatever it receives
      handler: ({ data }) => data as ReadableStream
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const empty = new ReadableStream({ start(controller) { controller.close(); } });
      const result = await via.request<ReadableStream>("POST", "/echo-empty", empty, { accept: "stream" });
      assert.equal(result.ok, true);

      // Drain the echoed response stream — it must close immediately with no chunks
      const received: unknown[] = [];
      const reader = (result.data as ReadableStream).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(value);
      }

      assert.deepEqual(received, [], "response stream must contain zero chunks");
    } finally {
      wire.close();
    }
  });

  it("should handle a single streaming request with 10000 chunks of 1KB", async () => {
    const viae = new Viae(server);
    const api = new Api("/");
    const CHUNKS = 10_000;
    const CHUNK_SIZE = 1024;

    api.post({
      path: "/echo-stream",
      accept: "stream",
      handler: ({ data }) => data
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      let sent = 0;
      const outgoing = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent < CHUNKS) {
            controller.enqueue(new Uint8Array(CHUNK_SIZE).fill(sent % 256));
            sent++;
          } else {
            controller.close();
          }
        }
      });

      const result = await via.request<ReadableStream<Uint8Array>>("POST", "/echo-stream", outgoing, { accept: "stream" });
      assert.equal(result.ok, true);

      const reader = (result.data as ReadableStream<Uint8Array>).getReader();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assert.equal((value as Uint8Array).length, CHUNK_SIZE);
        assert.equal((value as Uint8Array)[0], received % 256);
        received++;
      }

      assert.equal(received, CHUNKS);
    } finally {
      wire.close();
    }
  });

  // ── Size / chunk-size matrix ─────────────────────────────────────────────
  // Each scenario sends the full payload as a ReadableStream split into
  // fixed-size chunks, then echoes it back as a stream and verifies every byte.

  const KB = 1024;
  const MB = 1024 * KB;
  const streamScenarios: { totalBytes: number; chunkSize: number }[] = [
    { totalBytes:   5 * KB, chunkSize:   2 * KB },
    { totalBytes:   8 * KB, chunkSize:   4 * KB },
    { totalBytes:  16 * KB, chunkSize:   4 * KB },
    { totalBytes:  16 * KB, chunkSize:   8 * KB },
    { totalBytes:  32 * KB, chunkSize:   8 * KB },
    { totalBytes:  32 * KB, chunkSize:  16 * KB },
    { totalBytes:  64 * KB, chunkSize:  16 * KB },
    { totalBytes: 128 * KB, chunkSize:  32 * KB },
    { totalBytes: 256 * KB, chunkSize:  64 * KB },
    { totalBytes: 512 * KB, chunkSize: 128 * KB },
    { totalBytes:    1 * MB, chunkSize: 256 * KB },
  ];

  for (const { totalBytes, chunkSize } of streamScenarios) {
    const label = `${totalBytes / KB}KB total / ${chunkSize / KB}KB chunks`;

    it(`should stream ${label} (upload + echo)`, async () => {
      const viae = new Viae(server);
      const api = new Api("/");

      api.post({
        path: "/echo-bin",
        accept: "stream",
        handler: ({ data }) => data,
      });

      viae.use(api);
      const { via, wire } = await createTestClient(port);

      try {
        // Build a deterministic payload
        const payload = new Uint8Array(totalBytes);
        for (let i = 0; i < totalBytes; i++) payload[i] = i & 0xff;

        let offset = 0;
        const outgoing = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset >= totalBytes) { controller.close(); return; }
            const end = Math.min(offset + chunkSize, totalBytes);
            controller.enqueue(payload.slice(offset, end));
            offset = end;
          },
        });

        const result = await via.request<ReadableStream<Uint8Array>>(
          "POST", "/echo-bin", outgoing, { accept: "stream" }
        );
        assert.equal(result.ok, true);

        const reader = (result.data as ReadableStream<Uint8Array>).getReader();
        const parts: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value as Uint8Array);
        }

        // Reassemble and compare
        const received = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let pos = 0;
        for (const p of parts) { received.set(p, pos); pos += p.length; }

        assert.equal(received.length, totalBytes);
        assert.deepEqual(received, payload);
      } finally {
        wire.close();
      }
    });
  }
});
