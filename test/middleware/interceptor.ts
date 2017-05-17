import { ViaMessage, ViaContext, Interceptor } from '../../src/index';
import { assert, expect } from 'chai';

export default function interceptorTests() {

  it("throws error if intercept called without id", () => {
    let interceptor = new Interceptor();
    expect(() => { interceptor.intercept(undefined, []); }).to.throw(Error);
  });
  it("throws error if intercept called with empty id", () => {
    let interceptor = new Interceptor();
    expect(() => { interceptor.intercept("", []); }).to.throw(Error);
  });
  it("throws error if intercept called without handlers", () => {
    let interceptor = new Interceptor();
    expect(() => { interceptor.intercept("abc", undefined); }).to.throw(Error);
  });
  it("throws error if intercept called with empty handlers", () => {
    let interceptor = new Interceptor();
    expect(() => { interceptor.intercept("abc", []); }).to.throw(Error);
  });

  it("does not affect unintercepted context (no interceptors)", async () => {
    const noop = function () { assert.fail("noop called"); };
    let ctx: ViaContext = {
      wire: undefined,
      res: { id: "abc" },
      req: undefined,
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    };

    let interceptor = new Interceptor();

    let result = await interceptor.process(ctx, undefined);

    expect(result).to.be.eql(undefined);
    expect(ctx).to.be.eql({
      wire: undefined,
      res: { id: "abc" },
      req: undefined,
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    });
  });

  it("does not affect unintercepted context with err", async () => {
    const noop = function () { assert.fail("noop called"); };
    let ctx: ViaContext = {
      wire: undefined,
      res: { id: "abc" },
      req: undefined,
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    };

    let interceptor = new Interceptor();

    try {
      await interceptor.process(ctx, Error("moo"));
    } catch (err) {
    }

    expect(ctx).to.be.eql({
      wire: undefined,
      res: { id: "abc" },
      req: undefined,
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    });
  });

  it("does not affect unintercepted context (with interceptors)", async () => {
    const noop = function () { assert.fail("noop called"); };
    let ctx: ViaContext = {
      wire: undefined,
      res: { id: "abc" },
      req: undefined,
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    };

    let interceptor = new Interceptor();

    interceptor.intercept("abcd", [(ctx) => { assert.fail("was intercepted"); }]);

    let result = await interceptor.process(ctx, undefined);

    expect(result).to.be.eql(undefined);
    expect(ctx).to.be.eql({
      wire: undefined,
      res: { id: "abc" },
      req: undefined,
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    });
  });

  it("can intercept context by response id", async () => {
    const noop = function () { assert.fail("noop called"); };
    let ctx: ViaContext = {
      wire: undefined,
      res: { id: "abc" },
      req: { id: "abc" },
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    };

    var wasIntercepted = false;

    let interceptor = new Interceptor();

    interceptor.intercept("abc", [(ctx) => { wasIntercepted = true; }]);

    let result = await interceptor.process(ctx, undefined);

    expect(wasIntercepted).to.be.eql(true);
  });

  it("can intercept context by request id", async () => {
    const noop = function () { assert.fail("noop called"); };
    let ctx: ViaContext = {
      wire: undefined,
      res: undefined,
      req: { id: "abc" },
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    };

    var wasIntercepted = false;

    let interceptor = new Interceptor();

    interceptor.intercept("abc", [(ctx) => { wasIntercepted = true; }]);

    let result = await interceptor.process(ctx, undefined);

    expect(wasIntercepted).to.be.eql(true);
  });
};