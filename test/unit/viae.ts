import { Viae } from '../../src';
import { assert, expect } from 'chai';
import { EventEmitter } from 'events';

describe("Viae", () => {
  it("should subscribe to wire-server connections", () => {
    let wasCalled = false;
    let ws = {
      on: (event: string, cb: Function) => {
        wasCalled = true;
      }
    }
    const viae = new Viae(ws);
    expect(wasCalled).to.be.true;
  });

  it("should add a via connection when server emits raw connection", () => {
    let ws = new EventEmitter();
    let wire = new EventEmitter();

    const viae = new Viae(ws);

    ws.emit("connection", wire);

    expect(viae.connections.length).to.equal(1);
    expect(viae.connections[0].wire).to.eq(wire);
  });

  it("should remove connection when wire closes", () => {
    let ws = new EventEmitter();
    let wire = new EventEmitter();

    const viae = new Viae(ws);

    ws.emit("connection", wire);

    expect(viae.connections.length).to.equal(1);

    wire.emit("close");

    expect(viae.connections.length).to.equal(0);
  });

  it("should emit new via connection when server emits raw connection", () => {
    let ws = new EventEmitter();
    let wire = new EventEmitter();

    const viae = new Viae(ws);

    let wasCalled = false;
    viae.on("connection", (via) => {
      wasCalled = true;
      expect(via.wire).to.eq(wire);
    });

    ws.emit("connection", wire);

    expect(wasCalled).to.be.true;
  });

  it("should add self as middleware on new connection ", () => {
    let ws = new EventEmitter();
    let wire = new EventEmitter();

    const viae = new Viae(ws);

    ws.emit("connection", wire);

    let via = viae.connections[0];
    let middleware = via["_app"]["_middleware"] as any[];

    let index = middleware.findIndex(x => x == viae);

    expect(index).to.not.be.equal(-1);
  });

  it("should apply plugins provided in ctor", () => {
    let ws = new EventEmitter();
    let wire = new EventEmitter();

    let wasCalled = false;

    const plugin = { plugin: () => { wasCalled = true; } }

    const viae = new Viae(ws, plugin);

    expect(wasCalled).to.be.true;
  });

  it("should call _app middleware with context when process called", async () => {
    const viae = new Viae(new EventEmitter());

    let wasCalled = true;

    viae["_app"] = {
      process: (x, e) => {
        wasCalled = true;
        return Promise.resolve();
      }
    } as any;

    await viae.process({} as any, undefined);

    expect(wasCalled).to.be.true;
  });

  it("should call _app middleware with error when process called", async () => {
    const viae = new Viae(new EventEmitter());

    let wasCalled = true;

    viae["_app"] = {
      process: (x, e) => {
        wasCalled = true;
        expect(e).to.not.be.undefined;
        return Promise.resolve();
      }
    } as any;

    try {
      await viae.process({} as any, Error("foo"))
    } catch (err) { }
    expect(wasCalled).to.be.true;
  });

  it("should clear $done and always call _after middleware when process called", async () => {
    const viae = new Viae(new EventEmitter());

    let wasCalled = true;

    viae["_app"] = {
      process: (x, e) => { x.$done = true; }
    } as any;

    viae["_before"] = {
      process: (x, e) => {
        wasCalled = true;
        expect(x.$done).to.be.undefined;
        return Promise.resolve();
      }
    } as any;

    try {
      await viae.process({} as any, undefined);
    } catch (err) {}

    expect(wasCalled).to.be.true;
  });

  it("should rethrow errors", async () => {
    const viae = new Viae(new EventEmitter());

    viae["_app"] = {
      process: (x, e) => {
        return Promise.reject("reason");
      }
    } as any;

    let wasCalled = false;

    await viae.process({} as any, undefined).catch(() => { wasCalled = true; });

    expect(wasCalled).to.be.true;
  });

  it("should add middleware into before handler when before called", async () => {
    const viae = new Viae(new EventEmitter());

    let wasCalled = false;
    let middleware = _ => { };

    viae["_before"] = {
      use: (x) => {
        wasCalled = true;
        expect(x).to.be.eq(middleware);
      }
    } as any;

    viae.before(middleware);

    expect(wasCalled).to.be.true;
  });

  it("should add middleware into app handler when use called with handler", async () => {
    const viae = new Viae(new EventEmitter());

    let wasCalled = false;
    let middleware = _ => { };

    viae["_app"] = {
      use: (x) => {
        wasCalled = true;
        expect(x).to.be.eq(middleware);
      }
    } as any;

    viae.use(middleware);

    expect(wasCalled).to.be.true;
  });

  it("should add plugin when use called with plugin", async () => {
    let ws = new EventEmitter();
    let wire = new EventEmitter();

    let wasCalled = false;

    const plugin = { plugin: () => { wasCalled = true; } }

    const viae = new Viae(ws);

    viae.use(plugin);

    expect(wasCalled).to.be.true;
  });

  it("should add middleware into after handler when after called", async () => {
    const viae = new Viae(new EventEmitter());

    let wasCalled = false;
    let middleware = _ => { };

    viae["_after"] = {
      use: (x) => {
        wasCalled = true;
        expect(x).to.be.eq(middleware);
      }
    } as any;

    viae.after(middleware);

    expect(wasCalled).to.be.true;
  });

  it("should add interceptor as first app handler", () => {
    const viae = new Viae(new EventEmitter());

    expect(viae["_app"]["_middleware"][0]).to.eq(viae["_interceptor"])
  });

  it("should add before handler to app handler after the interceptor", () => {
    const viae = new Viae(new EventEmitter());

    expect(viae["_app"]["_middleware"][1]).to.eq(viae["_before"])
  });
});