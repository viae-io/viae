import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Api, Viae, Status, ViaeError, type Context } from "../src/index.js";
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
});
