import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Next } from "rowan";
import { Router, normalisePath, type Context } from "../src/index.js";

const noopNext: Next = async () => {};

function createCtx(path: string, method = "GET"): Context {
  return {
    in: { head: { path, method } },
    params: {},
  } as unknown as Context;
}

describe("normalisePath", () => {
  it("returns / for empty input", () => {
    assert.equal(normalisePath(), "/");
    assert.equal(normalisePath(""), "/");
  });

  it("inserts a leading slash", () => {
    assert.equal(normalisePath("foo"), "/foo");
    assert.equal(normalisePath("foo", "bar"), "/foo/bar");
  });

  it("trims a trailing slash", () => {
    assert.equal(normalisePath("/foo/"), "/foo");
    assert.equal(normalisePath("/foo/bar/"), "/foo/bar");
  });

  it("collapses duplicate slashes", () => {
    assert.equal(normalisePath("//foo///bar//"), "/foo/bar");
    assert.equal(normalisePath("/foo", "/bar"), "/foo/bar");
  });

  it("leaves already-normalised paths unchanged (fast path)", () => {
    assert.equal(normalisePath("/foo/bar"), "/foo/bar");
    assert.equal(normalisePath("/"), "/");
  });
});

describe("Router", () => {
  it("matches an exact path via the fast path and exposes matchedPath to the handler", async () => {
    const router = new Router({ root: "/" });
    let called = false;
    let matchedInside: unknown;
    let pathInside: unknown;

    router.route({
      path: "/exact",
      method: null,
      process: [async (ctx: Context, next?: Next) => {
        called = true;
        matchedInside = ctx.in.head.matchedPath;
        pathInside = ctx.in.head.path;
        await next?.();
      }]
    });

    const ctx = createCtx("/exact");
    await router.process(ctx, noopNext);

    assert.equal(called, true);
    assert.equal(matchedInside, "/exact");
    assert.equal(pathInside, "/");
    assert.equal(ctx.in.head.path, "/exact");
    assert.equal(ctx.in.head.matchedPath, undefined);
  });

  it("matches any method when method is null", async () => {
    const router = new Router({ root: "/" });
    let called = false;

    router.route({
      path: "/any",
      method: null,
      process: [async (_ctx: Context, next?: Next) => {
        called = true;
        await next?.();
      }]
    });

    await router.process(createCtx("/any", "SUBSCRIBE"), noopNext);

    assert.equal(called, true);
  });

  it("matches a path prefix when end is false", async () => {
    const router = new Router({ root: "/" });
    let called = false;
    let pathInside: unknown;

    router.route({
      path: "/prefix",
      method: null,
      end: false,
      process: [async (ctx: Context, next?: Next) => {
        called = true;
        pathInside = ctx.in.head.path;
        await next?.();
      }]
    });

    await router.process(createCtx("/prefix/deep"), noopNext);

    assert.equal(called, true);
    assert.equal(pathInside, "/deep");
  });

  it("sets matchedPath and captures params for a pattern route", async () => {
    const router = new Router({ root: "/" });
    let matchedInside: unknown;

    router.route({
      path: "/users/:id",
      method: null,
      process: [async (ctx: Context, next?: Next) => {
        matchedInside = ctx.in.head.matchedPath;
        await next?.();
      }]
    });

    const ctx = createCtx("/users/42");
    await router.process(ctx, noopNext);

    assert.equal(matchedInside, "/users/42");
    assert.equal(ctx.params.id, "42");
    assert.equal(ctx.in.head.matchedPath, undefined);
  });

  it("restores head.path and matchedPath after a throwing middleware", async () => {
    const router = new Router({ root: "/api" });

    router.route({
      path: "/boom",
      method: null,
      process: [async (_ctx: Context, _next?: Next) => {
        throw new Error("boom");
      }]
    });

    const ctx = createCtx("/api/boom");
    await assert.rejects(router.process(ctx, noopNext), /boom/);

    assert.equal(ctx.in.head.path, "/api/boom");
    assert.equal(ctx.in.head.matchedPath, undefined);
    assert.equal(ctx.in.head.fullPath, "/api/boom");
  });
});
