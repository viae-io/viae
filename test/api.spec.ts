import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Api, Viae, Status, ViaeError, decodeData, encodeData, type Context } from "../src/index.js";
import { TestWireServer, createTestClient } from "./utils.js";

interface MyContext extends Context {
  foo: string;
}

describe("Api", () => {
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

  it("should match method and path and return data", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/",
      handler: ({ data }) => {
        return "Hello " + String(data);
      }
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      via.on("error", (err) => { throw err; });

      const result = await via.request<string>("GET", "/", "John");
      assert.equal(result.ok, true);
      assert.equal(result.data, "Hello John");
    } finally {
      wire.close();
    }
  });

  it("should match param", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/foo/:bar",
      handler: ({ params }) => {
        return "Hello " + String(params.bar);
      }
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      via.on("error", (err) => { throw err; });

      const result = await via.request<string>("GET", "/foo/John");
      assert.equal(result.ok, true);
      assert.equal(result.data, "Hello John");
    } finally {
      wire.close();
    }
  });

  it("should return 404 for unmatched routes", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/exists",
      handler: () => "found"
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request("GET", "/nope");
      assert.equal(result.ok, false);
      assert.equal(result.head.status, Status.NotFound);
    } finally {
      wire.close();
    }
  });

  it("should validate with type guard (object)", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    function isNumber(value: unknown): value is number {
      return typeof value === "number";
    }

    api.post<number>({
      path: "/double",
      validate: isNumber,
      handler: ({ data }) => {
        return data * 2;
      }
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const good = await via.request<number>("POST", "/double", 21);
      assert.equal(good.ok, true);
      assert.equal(good.data, 42);

      const bad = await via.request("POST", "/double", "not a number");
      assert.equal(bad.ok, false);
      assert.equal(bad.head.status, Status.BadRequest);
    } finally {
      wire.close();
    }
  });

  it("should handle errors thrown from handlers", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/fail",
      handler: () => {
        throw new ViaeError(Status.Forbidden, "no access");
      }
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request("GET", "/fail");
      assert.equal(result.ok, false);
      assert.equal(result.head.status, Status.Forbidden);
      assert.equal(result.data, "no access");
    } finally {
      wire.close();
    }
  });

  it("should support nested routers", async () => {
    const viae = new Viae(server);
    const root = new Api("/");
    const nested = new Api("/v1");

    nested.get({
      path: "/ping",
      handler: () => "pong"
    });

    root.use("/api", nested);
    viae.use(root);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<string>("GET", "/api/v1/ping");
      assert.equal(result.ok, true);
      assert.equal(result.data, "pong");
    } finally {
      wire.close();
    }
  });

  it("should capture multiple params in a deep path", async () => {
    const viae = new Viae(server);
    const api = new Api<MyContext>("/");

    api.use("*", async (ctx, next) => {
      ctx.foo = "bar";
      return next();
    });

    api.get({
      path: "/foo/bar/:myid",
      handler: ({ params, ctx }) => {
        ctx.reply(`id=${params.myid}`, { type: "json", status: 200 });
      }
    });

    viae.use(api);
    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<string>("GET", "/foo/bar/42");
      assert.equal(result.ok, true);
      assert.equal(result.data, "id=42");
    } finally {
      wire.close();
    }
  });

  it("should accumulate params across nested routers: /foo/:id/bar", async () => {
    const viae = new Viae(server);
    const root = new Api("/foo/:id");
    const sub = new Api("/");

    sub.get({
      path: "/bar",
      params: { id: { type: String } },
      handler: ({ params }) => `id=${params.id}`
    });

    root.use("/", sub);
    viae.use(root);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<string>("GET", "/foo/99/bar");
      assert.equal(result.ok, true);
      assert.equal(result.data, "id=99");
    } finally {
      wire.close();
    }
  });

  it("should convert Number param at runtime and type it", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/items/:id",
      params: { id: { type: Number } },
      handler: ({ params }) => {
        // params.id is typed as number
        return params.id * 2;
      }
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<number>("GET", "/items/21");
      assert.equal(result.ok, true);
      assert.equal(result.data, 42);
    } finally {
      wire.close();
    }
  });

  it("should reject non-numeric value for Number param", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/items/:id",
      params: { id: { type: Number } },
      handler: ({ params }) => params.id
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request("GET", "/items/notanumber");
      assert.equal(result.ok, false);
      assert.equal(result.head.status, Status.BadRequest);
    } finally {
      wire.close();
    }
  });

  it("should convert Boolean param at runtime", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/flag/:enabled",
      params: { enabled: { type: Boolean } },
      handler: ({ params }) => params.enabled
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const trueResult = await via.request<boolean>("GET", "/flag/true");
      assert.equal(trueResult.ok, true);
      assert.equal(trueResult.data, true);

      const falseResult = await via.request<boolean>("GET", "/flag/false");
      assert.equal(falseResult.ok, true);
      assert.equal(falseResult.data, false);
    } finally {
      wire.close();
    }
  });

  it("should keep the status set by ctx.reply while a returned value overrides only the data", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/reply-status",
      handler: ({ ctx }) => {
        ctx.reply("A", { status: 201 });
        return "B";
      }
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<string>("GET", "/reply-status");
      assert.equal(result.ok, true);
      assert.equal(result.head.status, 201);
      assert.equal(result.data, "B");
    } finally {
      wire.close();
    }
  });

  it("should not pass next to the handler when next is false", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    let receivedNext: unknown = "sentinel";

    api.get({
      path: "/no-next",
      next: false,
      handler: (opts) => {
        receivedNext = opts.next;
        return "done";
      }
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<string>("GET", "/no-next");
      assert.equal(receivedNext, undefined);
      assert.equal(result.ok, true);
      assert.equal(result.head.status, Status.OK);
      assert.equal(result.data, "done");
    } finally {
      wire.close();
    }
  });

  it("should fall through to the next matching route when a next:true handler calls next()", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    let firstRan = false;

    api.get({
      path: "/chain",
      next: true,
      handler: async ({ next }) => {
        firstRan = true;
        await next?.();
      }
    });

    api.get({
      path: "/chain",
      handler: () => "second"
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request<string>("GET", "/chain");
      assert.equal(firstRan, true);
      assert.equal(result.ok, true);
      assert.equal(result.head.status, Status.OK);
      assert.equal(result.data, "second");
    } finally {
      wire.close();
    }
  });

  it("should map a numeric throw to that status", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/throw-numeric",
      handler: () => {
        throw 403;
      }
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const result = await via.request("GET", "/throw-numeric");
      assert.equal(result.ok, false);
      assert.equal(result.head.status, Status.Forbidden);
    } finally {
      wire.close();
    }
  });

  it("should reject non-finite Number params and still accept finite numeric forms", async () => {
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/numbers/:id",
      params: { id: { type: Number } },
      handler: ({ params }) => params.id
    });

    viae.use(api);

    const { via, wire } = await createTestClient(port);

    try {
      const infinite = await via.request("GET", "/numbers/Infinity");
      assert.equal(infinite.ok, false);
      assert.equal(infinite.head.status, Status.BadRequest);

      const negativeInfinite = await via.request("GET", "/numbers/-Infinity");
      assert.equal(negativeInfinite.ok, false);
      assert.equal(negativeInfinite.head.status, Status.BadRequest);

      const notANumber = await via.request("GET", "/numbers/NaN");
      assert.equal(notANumber.ok, false);
      assert.equal(notANumber.head.status, Status.BadRequest);

      /* finite non-decimal forms keep the pre-existing Number() behavior: "0x10" -> 16 */
      const hex = await via.request<number>("GET", "/numbers/0x10");
      assert.equal(hex.ok, true);
      assert.equal(hex.data, 16);
    } finally {
      wire.close();
    }
  });

  it("should reject a decoded CBOR object whose getReader is not a function", async () => {
    const api = new Api("/");
    let handlerCalled = false;

    api.post({
      path: "/wants-stream",
      accept: "stream",
      handler: () => {
        handlerCalled = true;
        return "unreachable";
      }
    });

    /* Drive the Api middleware directly: the client-side stream duck-typing in
       via.ts treats any object with a `getReader` key as a stream and would fail
       before the request reached this guard. */
    const data = decodeData(encodeData({ getReader: "not-a-function" }));
    const ctx = {
      id: "unit-stream-guard",
      in: { id: "unit-stream-guard", head: { method: "POST", path: "/wants-stream" }, data },
      out: { id: "unit-stream-guard", head: {} },
      params: {},
    } as unknown as Context;

    await api.process(ctx, async () => {});

    assert.equal(handlerCalled, false);
    assert.equal(ctx.out?.head.status, Status.BadRequest);
    assert.equal(ctx.out?.data, "expected stream");
  });
});
